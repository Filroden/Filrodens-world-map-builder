import { FILRODENSWMB } from "../config.js";

/**
 * A guided map's land masks can carry their own coast settings: Coastline Fracture
 * (`coastlineFracture`), Coastal Plains (`coastalPlain`) and Continental Shelf (`shelfRange`), in
 * the units of the map's own, and `sharpEdge`. A setting a mask leaves out follows the map's.
 * A Land mask ("add") shapes land and carries settings; a Coast only mask ("settings") carries
 * settings and shapes no land; an Ocean mask ("subtract") carries none (any it kept from being a
 * Land mask are ignored), so the coast it cuts takes the settings of the land beside it.
 *
 * This works out, for each setting some mask overrides, a field over the coastline field's grid
 * (in world pixels, so a regional map reads its parent's values) holding how far the value that
 * applies at each cell differs from the map's own. The per-pixel pass adds it to the map's value
 * where a mask overrides that setting (see ProceduralEngine#applyGuidedDetail). Where no mask
 * reaches, the difference is exactly 0, so the land there is shaped exactly as the map's own
 * value shapes it; with no mask overriding anything there are no fields at all, and the map is
 * shaped exactly as it was before masks had settings.
 *
 * - **On land, the mask list's order decides,** later masks on top. Each mask lays its value over
 *   whatever lies beneath (the map's value, or a mask below): fully inside itself, fading out
 *   beyond its edge (see MASK_SETTINGS). The fade lies outside the mask, so the mask's own coast
 *   takes its full value. A Land mask lays every setting, its own where it has one and the map's
 *   where it does not, so it covers whatever lies beneath it (as the inspector says, a setting it
 *   leaves unticked follows the map). A Coast only mask lays only the settings it has: it shapes
 *   no land, so it has nothing to cover with the map's values.
 * - **At sea, the nearest coast decides:** a sea cell takes the value of the nearest land cell (a
 *   shelf belongs to the coast it fringes), then values blend at sea, so the sea between two
 *   coasts about equally near takes a mix.
 */
export class MaskSettings {
    /** Each setting: its key in the fields, its field on a mask and on the map, and the map's default. */
    static KEYS = Object.freeze([
        Object.freeze({ key: "fracture", field: "coastlineFracture", fallback: () => FILRODENSWMB.GENERATION.COASTLINE_FRACTURE }),
        Object.freeze({ key: "plain", field: "coastalPlain", fallback: () => FILRODENSWMB.GENERATION.COASTAL_PLAIN }),
        Object.freeze({ key: "shelf", field: "shelfRange", fallback: () => FILRODENSWMB.GENERATION.SHELF_RANGE }),
    ]);

    /** The mask operation of a Coast only mask, which carries settings and shapes no land. */
    static COAST_ONLY = "settings";

    /** Whether a mask shapes land or ocean (a Land or Ocean mask), rather than only carrying settings. */
    static shapesLand(mask) {
        return mask.operation !== MaskSettings.COAST_ONLY;
    }

    /** Whether a mask overrides `field` (one of KEYS' fields). Ocean masks override nothing. */
    static overrides(mask, field) {
        return mask.operation !== "subtract" && typeof mask[field] === "number" && Number.isFinite(mask[field]);
    }

    /** Whether any mask overrides any setting. */
    static anyOverride(masks) {
        return (masks ?? []).some((mask) => MaskSettings.KEYS.some(({ field }) => MaskSettings.overrides(mask, field)));
    }

    /** The map's own value of a setting. */
    static #mapValue(params, { field, fallback }) {
        return params[field] ?? fallback();
    }

    /**
     * The map's parameters with each setting raised to the largest any mask gives it, for the
     * coastline field's margins (how far beyond the map the warp and bands can reach).
     */
    static widest(masks, params) {
        const out = { ...params };
        for (const setting of MaskSettings.KEYS) {
            for (const mask of masks) if (MaskSettings.overrides(mask, setting.field)) out[setting.field] = Math.max(out[setting.field] ?? setting.fallback(), mask[setting.field]);
        }
        return out;
    }

    /**
     * Terrain inputs of a mask's settings, for the caches that decide when terrain must be
     * generated again: nothing for a mask with none, so such a mask describes itself exactly as
     * it did before masks had settings.
     */
    static inputsOf(mask) {
        const own = MaskSettings.KEYS.filter(({ field }) => MaskSettings.overrides(mask, field)).map(({ field }) => [field, mask[field]]);
        return own.length > 0 ? [own, mask.sharpEdge === true] : [];
    }

    /**
     * @param {object} options
     * @param {object} options.grid - The coastline field's grid (u0, v0, cellsPerPixel, width, height).
     * @param {Array<{mask: object, bounds: {minX: number, minY: number, maxX: number, maxY: number}, inside: function(): Uint8Array}>} options.masks
     *   The valid masks in list order: each mask, its bounding box in world pixels, and its inside
     *   on the grid (1 inside).
     * @param {Uint8Array} options.ownership - Land (1) or sea (0) for every cell of the grid.
     * @param {object} options.params - The map's parameters.
     * @param {number} options.scale - The frame's resolution scale (MASK_SETTINGS' lengths are in baseline pixels).
     * @returns {{fracture?: Float32Array, plain?: Float32Array, shelf?: Float32Array}|null} For each
     *   setting some mask overrides, its difference from the map's value at each cell; null when no
     *   mask overrides anything.
     */
    static build({ grid, masks, ownership, params, scale }) {
        if (!MaskSettings.anyOverride(masks.map(({ mask }) => mask))) return null;
        const shape = FILRODENSWMB.GENERATION.MASK_SETTINGS;
        const warpAmplitude = FILRODENSWMB.GENERATION.WARP.AMPLITUDE;
        const insides = new Map();
        const insideOf = (entry) => {
            if (!insides.has(entry)) insides.set(entry, entry.inside());
            return insides.get(entry);
        };
        const fields = {};
        for (const setting of MaskSettings.KEYS) {
            if (!masks.some(({ mask }) => MaskSettings.overrides(mask, setting.field))) continue;
            // Worked out as differences from the map's value, so cells no mask reaches stay exactly 0
            const mapValue = MaskSettings.#mapValue(params, setting);
            const values = new Float64Array(grid.width * grid.height);
            for (const entry of masks) {
                const { mask } = entry;
                // A Land mask lays the map's value where it has none of its own; a Coast only mask
                // lays only its own; an Ocean mask lays nothing
                const own = MaskSettings.overrides(mask, setting.field);
                if (!own && mask.operation !== "add" && mask.operation !== undefined) continue;
                const value = own ? mask[setting.field] - mapValue : 0;
                // A change of fracture fades over a width in proportion to the change, and the band
                // widths over FADE, unless the mask asks for a sharp edge
                const fade = mask.sharpEdge === true ? () => shape.SHARP_FADE * scale : setting.key === "fracture" ? (change) => Math.max(shape.FADE, Math.abs(change) * warpAmplitude) * scale : () => shape.FADE * scale;
                MaskSettings.#layer(values, grid, entry, insideOf, value, fade);
            }
            MaskSettings.#seaFromCoast(values, grid, ownership, shape.SEA_BLEND * scale);
            fields[setting.key] = Float32Array.from(values);
        }
        return fields;
    }

    /**
     * Lays one mask's value over `values`: fully inside it, fading out beyond its edge over
     * `fadeFor(change)` world pixels, for the change from the value beneath.
     */
    static #layer(values, grid, entry, insideOf, value, fadeFor) {
        const { bounds } = entry;
        const [lo, hi] = MaskSettings.#range(values);
        const reach = Math.max(fadeFor(value - lo), fadeFor(value - hi));
        const cell = (world, origin) => (world - origin) * grid.cellsPerPixel;
        const x0 = Math.max(0, Math.floor(cell(bounds.minX - reach, grid.u0)));
        const x1 = Math.min(grid.width - 1, Math.ceil(cell(bounds.maxX + reach, grid.u0)));
        const y0 = Math.max(0, Math.floor(cell(bounds.minY - reach, grid.v0)));
        const y1 = Math.min(grid.height - 1, Math.ceil(cell(bounds.maxY + reach, grid.v0)));
        if (x1 < x0 || y1 < y0) return;
        const box = { x0, y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
        // Nothing within reach differs from this value (a Land mask laying the map's value where no
        // mask has changed it): nothing to lay, and no need to find the mask's inside
        if (MaskSettings.#uniform(values, grid.width, box, value)) return;
        const distances = MaskSettings.#distanceToInside(insideOf(entry), grid.width, box);

        for (let y = 0; y < box.height; y++) {
            for (let x = 0; x < box.width; x++) {
                const at = (box.y0 + y) * grid.width + box.x0 + x;
                const distance = distances[y * box.width + x] / grid.cellsPerPixel;
                const weight = distance === 0 ? 1 : 1 - MaskSettings.#smoothstep(0, fadeFor(value - values[at]), distance);
                if (weight > 0) values[at] += (value - values[at]) * weight;
            }
        }
    }

    /**
     * The distance, in grid cells, from every cell of `box` to the nearest cell inside the mask
     * (0 inside), by an exact Euclidean distance transform over the box (Felzenszwalb and
     * Huttenlocher: one pass down the columns, one along the rows).
     */
    static #distanceToInside(inside, gridWidth, box) {
        const { x0, y0, width, height } = box;
        const FAR = 1e20;
        const squared = new Float64Array(width * height);
        for (let y = 0; y < height; y++) {
            const row = (y0 + y) * gridWidth + x0;
            for (let x = 0; x < width; x++) squared[y * width + x] = inside[row + x] ? 0 : FAR;
        }
        const longest = Math.max(width, height);
        const f = new Float64Array(longest);
        const d = new Float64Array(longest);
        const v = new Int32Array(longest);
        const z = new Float64Array(longest + 1);
        for (let x = 0; x < width; x++) {
            for (let y = 0; y < height; y++) f[y] = squared[y * width + x];
            MaskSettings.#transform1d(f, height, d, v, z);
            for (let y = 0; y < height; y++) squared[y * width + x] = d[y];
        }
        const out = new Float32Array(width * height);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) f[x] = squared[y * width + x];
            MaskSettings.#transform1d(f, width, d, v, z);
            for (let x = 0; x < width; x++) out[y * width + x] = d[x] >= FAR ? Infinity : Math.sqrt(d[x]);
        }
        return out;
    }

    /** The squared distance transform of `f` (n values) into `d`, along one line. */
    static #transform1d(f, n, d, v, z) {
        let k = 0;
        v[0] = 0;
        z[0] = -Infinity;
        z[1] = Infinity;
        for (let q = 1; q < n; q++) {
            let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
            while (s <= z[k]) {
                k--;
                s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
            }
            k++;
            v[k] = q;
            z[k] = s;
            z[k + 1] = Infinity;
        }
        k = 0;
        for (let q = 0; q < n; q++) {
            while (z[k + 1] < q) k++;
            d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
        }
    }

    /** Whether every value in `box` is `value`. */
    static #uniform(values, gridWidth, box, value) {
        for (let y = 0; y < box.height; y++) {
            const row = (box.y0 + y) * gridWidth + box.x0;
            for (let x = 0; x < box.width; x++) if (values[row + x] !== value) return false;
        }
        return true;
    }

    /** The lowest and highest of `values`. */
    static #range(values) {
        let lo = Infinity;
        let hi = -Infinity;
        for (const value of values) {
            if (value < lo) lo = value;
            if (value > hi) hi = value;
        }
        return [lo, hi];
    }

    /**
     * Each sea cell takes the value of the nearest land cell (two chamfer passes carrying the
     * value), then sea values blend over `blend` world pixels (a box blur, twice, over sea cells
     * only), so the sea between two coasts takes a mix while the land keeps its layered values.
     */
    static #seaFromCoast(values, grid, ownership, blend) {
        const { width, height } = grid;
        const size = width * height;
        const distance = new Float32Array(size);
        for (let i = 0; i < size; i++) distance[i] = ownership[i] ? 0 : Infinity;
        const carried = Float64Array.from(values);
        const diagonal = Math.SQRT2;
        const relax = (i, j, step) => {
            if (distance[j] + step < distance[i]) {
                distance[i] = distance[j] + step;
                carried[i] = carried[j];
            }
        };
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const i = y * width + x;
                if (x > 0) relax(i, i - 1, 1);
                if (y > 0) {
                    relax(i, i - width, 1);
                    if (x > 0) relax(i, i - width - 1, diagonal);
                    if (x < width - 1) relax(i, i - width + 1, diagonal);
                }
            }
        }
        for (let y = height - 1; y >= 0; y--) {
            for (let x = width - 1; x >= 0; x--) {
                const i = y * width + x;
                if (x < width - 1) relax(i, i + 1, 1);
                if (y < height - 1) {
                    relax(i, i + width, 1);
                    if (x < width - 1) relax(i, i + width + 1, diagonal);
                    if (x > 0) relax(i, i + width - 1, diagonal);
                }
            }
        }
        const radius = Math.max(1, Math.round(blend * grid.cellsPerPixel));
        let current = carried;
        for (let pass = 0; pass < 2; pass++) current = MaskSettings.#blurSea(current, width, height, ownership, radius);
        for (let i = 0; i < size; i++) if (!ownership[i]) values[i] = current[i];
    }

    /** One box blur of the sea cells, along the rows and then the columns; land cells pass through. */
    static #blurSea(source, width, height, ownership, radius) {
        const across = new Float64Array(source.length);
        const out = new Float64Array(source.length);
        for (let y = 0; y < height; y++) {
            let sum = 0;
            let count = 0;
            const row = y * width;
            for (let x = -radius; x < width; x++) {
                const add = x + radius;
                if (add < width && !ownership[row + add]) {
                    sum += source[row + add];
                    count++;
                }
                const drop = x - radius - 1;
                if (drop >= 0 && !ownership[row + drop]) {
                    sum -= source[row + drop];
                    count--;
                }
                if (x >= 0) across[row + x] = ownership[row + x] || count === 0 ? source[row + x] : sum / count;
            }
        }
        for (let x = 0; x < width; x++) {
            let sum = 0;
            let count = 0;
            for (let y = -radius; y < height; y++) {
                const add = y + radius;
                if (add < height && !ownership[add * width + x]) {
                    sum += across[add * width + x];
                    count++;
                }
                const drop = y - radius - 1;
                if (drop >= 0 && !ownership[drop * width + x]) {
                    sum -= across[drop * width + x];
                    count--;
                }
                if (y >= 0) out[y * width + x] = ownership[y * width + x] || count === 0 ? across[y * width + x] : sum / count;
            }
        }
        return out;
    }

    static #smoothstep(edge0, edge1, x) {
        const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
        return t * t * (3 - 2 * t);
    }
}
