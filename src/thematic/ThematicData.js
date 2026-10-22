import { FILRODENSWMB } from "../config.js";
import { decodeModelRun } from "../generator/ModelRun.js";

/**
 * The thematic layers' values: what the generator's last run left in each model cell (see
 * ModelRun), turned into one value per model cell, carried to the display cells, and placed on
 * the layer's fixed scale for drawing.
 *
 * Model cells are about 25 km across, so drawing each display cell in its model cell's value
 * shows the run's grid as blocks. A graded layer is blended instead: each display cell lies in a
 * triangle of three model sites (the model mesh's Delaunay triangulation), and takes their values
 * weighted by its barycentric coordinates, which is linear interpolation between the sites. It is
 * exact at every site and continuous across triangle edges, so it shows nothing the run did not
 * hold, only without the cell edges. A site with no value (a cell without land, for a value per
 * land area) is left out of the blend and the other weights rescaled; a display cell with none of
 * its three has no value. Weights are worked out once per mesh and shared by every layer.
 *
 * Scales are fixed rather than stretched to each map's own range, so the same colour is the same
 * value on every map (and on a regional map beside its parent).
 *
 * Nothing here touches PIXI, the DOM or Foundry, so it is tested in Node.
 */

/** The layers, by id (config THEMATIC.LAYERS). */
export const LAYERS = new Map(FILRODENSWMB.THEMATIC.LAYERS.map((layer) => [layer.id, layer]));

/**
 * How each layer's value is worked out for a model cell from the run's arrays (see
 * ModelRun.decodeModelRun); NaN where the cell has none.
 */
const MODEL_VALUE = Object.freeze({
    // People per km² of land
    population: (arrays, cell) => (arrays.landArea[cell] > 0 ? arrays.population[cell] / arrays.landArea[cell] : Number.NaN),
    // People the land could feed per km² of it
    capacity: (arrays, cell) => (arrays.landArea[cell] > 0 ? arrays.capacity[cell] / arrays.landArea[cell] : Number.NaN),
    // The share of the land cleared for farming (a cell that is mostly water has no value)
    cleared: (arrays, cell) => (arrays.water[cell] ? Number.NaN : arrays.cleared[cell]),
    // The share of the people lost to raiders and strife: the generator's security, turned round
    danger: (arrays, cell) => (arrays.water[cell] ? Number.NaN : 1 - arrays.security[cell]),
});

/** The layers drawn as classes rather than on a scale (see ThematicSource's culture methods). */
const CLASS_LAYERS = new Set(["culture"]);
const CULTURE = FILRODENSWMB.THEMATIC.CULTURE;
/** The most fading steps a culture's colour takes; fewer when many cultures share the 255 steps. */
const MAX_BANDS = 10;

/** Ramp steps a value can take: 1 to 255 (0 is "no value" in the drawn bytes). */
const STEPS = 255;
const BYTES_PER_COLOUR = 4;
const LOOKUP_SIZE = 256;
const VERTICES = 3;
/** How far outside a triangle (in barycentric terms) still counts as inside, for points on an edge. */
const EDGE_TOLERANCE = 1e-9;
/**
 * The longest side, in model spacings, a triangle may have and still be blended across. Inside the
 * map the model sites are evenly spread, so sides are about one spacing; along the map's edges the
 * triangulation's hull joins sites far apart with long thin triangles, and blending across one
 * would smear a value along the edge. A cell in such a triangle takes its own model cell's value.
 */
const MAX_SIDE_SPACINGS = 2.5;
/** The most triangles a walk to a point crosses (see containingTriangle); a few are usual. */
const WALK_LIMIT = 64;

// ------------------------------------------------------------------ scales and ramps

/**
 * Where a value sits on a layer's scale, from 0 (its min or below) to 1 (its max or above).
 * @param {{kind: string, min: number, max: number}} scale
 * @param {number} value
 * @returns {number} NaN for a value that is not a number.
 */
export function scalePosition(scale, value) {
    if (!Number.isFinite(value)) return Number.NaN;
    let t;
    if (scale.kind === "log") t = value <= 0 ? 0 : Math.log(value / scale.min) / Math.log(scale.max / scale.min);
    else t = (value - scale.min) / (scale.max - scale.min);
    return Math.min(1, Math.max(0, t));
}

/** A position on the scale as a ramp step: 1 to 255. */
export function stepOf(position) {
    return 1 + Math.round(position * (STEPS - 1));
}

/** "#rrggbb" as [r, g, b]. */
function rgb(hex) {
    const number = Number.parseInt(hex.slice(1), 16);
    return [(number >> 16) & 0xff, (number >> 8) & 0xff, number & 0xff];
}

/**
 * A ramp as the drawn layer's lookup: 256 RGBA colours, the first transparent (no value), the rest
 * blended evenly between the ramp's colours.
 * @param {string[]} colours - Two or more "#rrggbb", from the scale's min to its max.
 * @returns {Uint8Array}
 */
export function rampLookup(colours) {
    const stops = colours.map(rgb);
    const bytes = new Uint8Array(LOOKUP_SIZE * BYTES_PER_COLOUR);
    for (let step = 1; step < LOOKUP_SIZE; step++) {
        const along = ((step - 1) / (STEPS - 1)) * (stops.length - 1);
        const index = Math.min(stops.length - 2, Math.floor(along));
        const t = along - index;
        const at = step * BYTES_PER_COLOUR;
        for (let channel = 0; channel < 3; channel++) bytes[at + channel] = Math.round(stops[index][channel] * (1 - t) + stops[index + 1][channel] * t);
        bytes[at + 3] = 255;
    }
    return bytes;
}

// ------------------------------------------------------------------ blending between model sites

const weightsByMesh = new WeakMap();

/**
 * For each display cell, the three model sites whose triangle holds it and their barycentric
 * weights; a cell outside every triangle (beyond the model sites' hull, at the map's edge), or in
 * one too long to blend across (see MAX_SIDE_SPACINGS), takes its own model cell at full weight.
 * Worked out once per mesh.
 * @param {import("../mesh/MeshBuilder.js").Mesh} mesh
 * @returns {{sites: Int32Array, weights: Float32Array}} Three entries per display cell.
 */
export function blendWeights(mesh) {
    if (weightsByMesh.has(mesh)) return weightsByMesh.get(mesh);
    const sites = new Int32Array(mesh.cellCount * VERTICES).fill(-1);
    const weights = new Float32Array(mesh.cellCount * VERTICES);
    const triangle = { a: 0, b: 0, c: 0, wa: 0, wb: 0, wc: 0 };
    const maxSideSq = (MAX_SIDE_SPACINGS * mesh.modelSpacing) ** 2;
    for (let cell = 0; cell < mesh.cellCount; cell++) {
        const at = cell * VERTICES;
        if (containingTriangle(mesh.modelDelaunay, mesh.parentOf[cell], mesh.siteX(cell), mesh.siteY(cell), triangle) && longestSideSq(mesh.modelDelaunay.points, triangle) <= maxSideSq) {
            sites.set([triangle.a, triangle.b, triangle.c], at);
            weights.set([triangle.wa, triangle.wb, triangle.wc], at);
        } else {
            sites[at] = mesh.parentOf[cell];
            weights[at] = 1;
        }
    }
    const result = { sites, weights };
    weightsByMesh.set(mesh, result);
    return result;
}

/**
 * Finds the triangle holding (x, y), starting beside model site `site` (the point's own model
 * cell, so the walk is short), and writes its corners and the point's barycentric weights into
 * `out`. The nearest site is not always a corner of the triangle holding a point, so the
 * triangles around it are not enough: this walks. From a triangle that does not hold the point,
 * the step is across the side facing the corner with the most negative weight (the side the point
 * lies beyond) into the neighbouring triangle, until one holds it. A side on the hull has no
 * neighbour, so a point beyond the hull ends the walk; WALK_LIMIT stops a walk that circles, which
 * this choice of side can do in rare arrangements.
 * @returns {boolean} Whether a triangle holds the point.
 */
function containingTriangle(delaunay, site, x, y, out) {
    const { triangles, halfedges, inedges, points } = delaunay;
    const start = inedges[site];
    if (start === -1) return false;
    let t = Math.floor(start / 3) * 3;
    for (let step = 0; step < WALK_LIMIT; step++) {
        const a = triangles[t];
        const b = triangles[t + 1];
        const c = triangles[t + 2];
        if (!barycentric(points, a, b, c, x, y, out)) return false;
        const { wa, wb, wc } = out;
        if (wa >= -EDGE_TOLERANCE && wb >= -EDGE_TOLERANCE && wc >= -EDGE_TOLERANCE) {
            Object.assign(out, { a, b, c });
            return true;
        }
        // Half-edge t runs a to b (facing c), t + 1 b to c (facing a), t + 2 c to a (facing b)
        let across = t;
        if (wa <= wb && wa <= wc) across = t + 1;
        else if (wb <= wc) across = t + 2;
        const twin = halfedges[across];
        if (twin === -1) return false;
        t = Math.floor(twin / 3) * 3;
    }
    return false;
}

/** The square of a triangle's longest side. */
function longestSideSq(points, { a, b, c }) {
    const sq = (p, q) => (points[2 * p] - points[2 * q]) ** 2 + (points[2 * p + 1] - points[2 * q + 1]) ** 2;
    return Math.max(sq(a, b), sq(b, c), sq(c, a));
}

/** The barycentric weights of (x, y) in triangle (a, b, c), written into out (they may be negative: the point outside); false for a triangle with no area. */
function barycentric(points, a, b, c, x, y, out) {
    const ax = points[2 * a];
    const ay = points[2 * a + 1];
    const bx = points[2 * b];
    const by = points[2 * b + 1];
    const cx = points[2 * c];
    const cy = points[2 * c + 1];
    const area = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (area === 0) return false;
    out.wa = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / area;
    out.wb = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / area;
    out.wc = 1 - out.wa - out.wb;
    return true;
}

/**
 * Model-cell values carried to the display cells by the blend (see the module comment).
 * @param {Float64Array} modelValues - NaN where a model cell has no value.
 * @param {{sites: Int32Array, weights: Float32Array}} blend
 * @returns {Float64Array} NaN where a display cell has none.
 */
export function blendValues(modelValues, { sites, weights }) {
    const cells = sites.length / VERTICES;
    const out = new Float64Array(cells);
    for (let cell = 0; cell < cells; cell++) {
        let sum = 0;
        let weight = 0;
        for (let vertex = cell * VERTICES; vertex < (cell + 1) * VERTICES; vertex++) {
            const site = sites[vertex];
            if (site < 0) continue;
            const value = modelValues[site];
            if (!Number.isFinite(value)) continue;
            sum += value * weights[vertex];
            weight += weights[vertex];
        }
        out[cell] = weight > 0 ? sum / weight : Number.NaN;
    }
    return out;
}

// ------------------------------------------------------------------ a run's layers

/**
 * The thematic layers of one saved run on one mesh. Each layer's values are worked out when first
 * asked for and kept, so switching between layers is a lookup.
 */
export class ThematicSource {
    #arrays;
    #mesh;
    #cultures;
    #values = new Map();
    #bytes = new Map();
    #lookups = new Map();
    #dominant = null;

    /**
     * @param {object} modelRun - A saved run (see ModelRun).
     * @param {import("../mesh/MeshBuilder.js").Mesh} mesh - The map's display mesh, whose model cells the run's are.
     */
    constructor(modelRun, mesh) {
        this.#arrays = decodeModelRun(modelRun);
        this.#mesh = mesh;
        this.#cultures = Array.isArray(modelRun.cultures) ? modelRun.cultures : [];
    }

    /**
     * The layers of a run, or null when there is no run or it does not belong to this mesh (its
     * model cells are not the mesh's).
     * @returns {ThematicSource|null}
     */
    static of(modelRun, mesh) {
        if (!modelRun || !mesh || modelRun.cellCount !== mesh.modelCount) return null;
        return new ThematicSource(modelRun, mesh);
    }

    /**
     * Whether the run holds what a layer is worked out from (an older run may lack an array). The
     * culture layer also needs a culture of the map's own: with none, the run's one default
     * culture covers the land and the layer would be one colour.
     */
    has(layerId) {
        return this.missing(layerId) === null;
    }

    /**
     * Why the run cannot show a layer: "run" when it lacks an array the layer is worked out from
     * (it was saved before the layer existed), "cultures" when the map had no culture of its own;
     * null when it can.
     * @returns {"run"|"cultures"|null}
     */
    missing(layerId) {
        const layer = LAYERS.get(layerId);
        if (!layer || !(MODEL_VALUE[layerId] || CLASS_LAYERS.has(layerId))) return "run";
        // The arrays' lengths were checked when the run was loaded (see MapImport)
        if (!layer.needs.every((name) => this.#arrays[name] !== undefined)) return "run";
        if (layerId === "culture" && !this.#cultures.some((culture) => culture?.id != null)) return "cultures";
        return null;
    }

    /** Whether a layer is drawn as classes (a key-and-label legend) rather than on a scale. */
    static isClassLayer(layerId) {
        return CLASS_LAYERS.has(layerId);
    }

    /** A layer's value in each model cell (NaN for none). */
    modelValues(layerId) {
        const compute = MODEL_VALUE[layerId];
        return Float64Array.from({ length: this.#mesh.modelCount }, (_, cell) => compute(this.#arrays, cell));
    }

    /** A layer's value in each display cell (NaN for none), blended between model sites. */
    displayValues(layerId) {
        if (!this.#values.has(layerId)) this.#values.set(layerId, blendValues(this.modelValues(layerId), blendWeights(this.#mesh)));
        return this.#values.get(layerId);
    }

    /**
     * A layer as the drawn layer reads it: one byte per display cell, 0 for no value, else its
     * step (a ramp step, or a culture's fading step; see cultureStep).
     */
    displayBytes(layerId) {
        if (this.#bytes.has(layerId)) return this.#bytes.get(layerId);
        if (CLASS_LAYERS.has(layerId)) {
            this.#bytes.set(layerId, this.#cultureBytes());
            return this.#bytes.get(layerId);
        }
        const { scale } = LAYERS.get(layerId);
        const values = this.displayValues(layerId);
        const bytes = new Uint8Array(values.length);
        for (let cell = 0; cell < values.length; cell++) {
            const position = scalePosition(scale, values[cell]);
            if (!Number.isNaN(position)) bytes[cell] = stepOf(position);
        }
        this.#bytes.set(layerId, bytes);
        return bytes;
    }

    /** A layer's value in a display cell, NaN for none (a graded layer's; see cultureAt for culture). */
    valueAt(layerId, cell) {
        if (!(cell >= 0 && cell < this.#mesh.cellCount)) return Number.NaN;
        return this.displayValues(layerId)[cell];
    }

    /** A layer's colour lookup for the drawn layer (see rampLookup and cultureLookup). */
    lookup(layerId) {
        if (!this.#lookups.has(layerId)) this.#lookups.set(layerId, CLASS_LAYERS.has(layerId) ? this.#cultureLookup() : rampLookup(LAYERS.get(layerId).ramp));
        return this.#lookups.get(layerId);
    }

    // ------------------------------------------------------------------ culture

    /**
     * Each model cell's dominant culture (an index into the run's cultures, -1 for none) and the
     * share of its people that culture holds (from the run's sparse shares).
     */
    #dominantCultures() {
        if (this.#dominant) return this.#dominant;
        const { culture, shareStart, shareCulture, shareValue } = this.#arrays;
        const count = this.#mesh.modelCount;
        const index = new Int32Array(count).fill(-1);
        const share = new Float32Array(count);
        for (let cell = 0; cell < count; cell++) {
            const dominant = culture[cell];
            if (!(dominant >= 0) || dominant >= this.#cultures.length) continue;
            index[cell] = dominant;
            share[cell] = 1;
            for (let entry = shareStart[cell]; entry < shareStart[cell + 1]; entry++) if (shareCulture[entry] === dominant) share[cell] = shareValue[entry];
        }
        this.#dominant = { index, share };
        return this.#dominant;
    }

    /** How many fading steps each culture has: the 255 steps shared out, at most MAX_BANDS each. */
    #bands() {
        return Math.max(1, Math.min(MAX_BANDS, Math.floor(STEPS / Math.max(1, this.#cultures.length))));
    }

    /** A culture and its share as a step: 1 + culture × bands + band (fainter bands for lower shares). */
    #cultureStep(index, share) {
        const bands = this.#bands();
        const strength = Math.min(1, Math.max(0, (share - CULTURE.SHARE_FAINT) / (CULTURE.SHARE_FULL - CULTURE.SHARE_FAINT)));
        return 1 + index * bands + Math.round(strength * (bands - 1));
    }

    /**
     * The culture layer per display cell: its model cell's step (a class is not blended, so the
     * layer keeps the run's cells).
     */
    #cultureBytes() {
        const { index, share } = this.#dominantCultures();
        const bytes = new Uint8Array(this.#mesh.cellCount);
        for (let cell = 0; cell < bytes.length; cell++) {
            const model = this.#mesh.parentOf[cell];
            if (index[model] >= 0) bytes[cell] = this.#cultureStep(index[model], share[model]);
        }
        return bytes;
    }

    /** Each culture's colour at each of its fading steps, faintest first. */
    #cultureLookup() {
        const bytes = new Uint8Array(LOOKUP_SIZE * BYTES_PER_COLOUR);
        const bands = this.#bands();
        this.#cultures.forEach((_, index) => {
            const [r, g, b] = rgb(this.cultureColor(index));
            for (let band = 0; band < bands; band++) {
                const step = 1 + index * bands + band;
                if (step >= LOOKUP_SIZE) return;
                const alpha = bands > 1 ? CULTURE.ALPHA_FAINT + ((1 - CULTURE.ALPHA_FAINT) * band) / (bands - 1) : 1;
                bytes.set([r, g, b, Math.round(alpha * 255)], step * BYTES_PER_COLOUR);
            }
        });
        return bytes;
    }

    /** A culture's colour as the run recorded it, or one from the palette for a culture with none. */
    cultureColor(index) {
        const color = this.#cultures[index]?.color;
        return typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color) ? color : CULTURE.PALETTE[index % CULTURE.PALETTE.length];
    }

    /**
     * The culture in a display cell: its index in the run's cultures, its name as the run recorded
     * it, and the share of the cell's people it holds; null for none.
     */
    cultureAt(cell) {
        if (!(cell >= 0 && cell < this.#mesh.cellCount)) return null;
        const { index, share } = this.#dominantCultures();
        const model = this.#mesh.parentOf[cell];
        if (!(index[model] >= 0)) return null;
        return { index: index[model], name: this.#cultures[index[model]]?.name ?? "", share: share[model] };
    }

    /** The cultures dominant somewhere on land, in the run's order, for the legend. */
    cultureClasses() {
        const { index } = this.#dominantCultures();
        const seen = new Set();
        for (let cell = 0; cell < index.length; cell++) if (index[cell] >= 0 && !this.#arrays.water[cell]) seen.add(index[cell]);
        return [...seen].sort((a, b) => a - b).map((at) => ({ index: at, name: this.#cultures[at]?.name ?? "", color: this.cultureColor(at) }));
    }
}
