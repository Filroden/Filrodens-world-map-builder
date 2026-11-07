/**
 * A map's natural features, found from its terrain alone (heights, the lake mask, biomes,
 * moisture and the traced rivers), so they can be named on any map: one never generated, a Flat
 * or Guided map, or one drawn by hand. Pure functions over plain arrays: no PIXI, no DOM.
 *
 * Kinds:
 * - water: oceans and seas (the open sea split where it narrows), gulfs and bays (water mostly
 *   enclosed by land, and inlets of the coast), lakes (the lake mask, and sea cut off from the
 *   map's edge);
 * - relief: mountains, hills and highlands (high or rugged ground, grouped);
 * - land: large areas of forest, jungle, desert or steppe, tundra, and plains (low, flat, open
 *   ground);
 * - rivers: the largest by flow, each labelled along its straightest stretch.
 *
 * Each feature has its cells (on its working grid), a place and angle for its label, and a
 * footprint (see footprintOf) by which a later run finds it again. Thresholds are shares of the
 * map's size, so a feature found on a 1,000 px map is found the same on a 4,000 px one.
 */

export const SETTINGS = Object.freeze({
    // Working grids: the map's pixels divided by these
    COARSE: 4,
    BAY_GRID: 2,
    // Seas: basins of the distance to land (watershed), kept apart where the strait between
    // them is narrower than this share of the shallower basin's widest point
    STRAIT_RATIO: 0.45,
    // A basin whose widest point is less than this share of the map's shorter side joins its neighbour
    MIN_BASIN_PEAK: 0.02,
    // Smallest named sea, as a share of the map's area
    MIN_SEA_AREA: 0.004,
    OCEAN_SHARE: 0.25,
    // A basin this enclosed by land (share of its edge on the coast) is a gulf, or a bay if small
    GULF_COAST_SHARE: 0.7,
    BAY_MAX_AREA: 0.004,
    // Sea with no way to the map's edge (all but this share of its edge is coast): a lake, or an inland sea if larger than this share of the map
    ENCLOSED_COAST_SHARE: 0.97,
    INLAND_SEA_AREA: 0.01,
    // Inlets: sea where this many of 16 rays (each this share of the shorter side long) reach land
    INLET_RAYS: 11,
    INLET_REACH: 0.05,
    MIN_INLET_AREA: 0.0004,
    // Lakes: smallest named lake (share of the map's area)
    MIN_LAKE_AREA: 0.00012,
    // Relief, in shares of the height from sea level to the map's highest land
    MOUNTAIN_HEIGHT: 0.5,
    HILL_HEIGHT: 0.28,
    // Ruggedness (the spread of heights within ROUGH_RADIUS coarse cells) that makes raised land hills rather than highlands
    ROUGH_RADIUS: 2,
    HILL_ROUGHNESS: 0.035,
    // Plains: open land lower than this share of the hills' height, and smoother than this share
    // of the map's land (a quantile of its ruggedness, since even flat land has some texture)
    PLAINS_HEIGHT: 0.6,
    PLAINS_ROUGHNESS: 0.35,
    // A cold desert is steppe where its land is this moist on average (the temperate desert band
    // runs to 0.25), or where this share of the land round it is grassland
    STEPPE_MOISTURE: 0.15,
    STEPPE_GRASS_BORDER: 0.4,
    // Grouping relief and land areas: closed (grown then shrunk) by this many coarse cells
    CLOSE_RADIUS: 2,
    MIN_RANGE_AREA: 0.0025,
    MIN_HILLS_AREA: 0.004,
    MIN_BIOME_AREA: 0.012,
    MIN_PLAINS_AREA: 0.015,
    // Rivers: named when their largest flow is at least this share of the map's largest, at most MAX_RIVERS
    RIVER_FLOW_SHARE: 0.12,
    MAX_RIVERS: 12,
    // Footprints: cells of this share of the map's shorter side (at least 4 px), and the river
    // points kept (at most)
    FOOTPRINT_CELL: 0.005,
    RIVER_POINTS: 48,
});

/** The built-in biome ids (BIOME_IDS) each land area is made of. */
const BIOME_AREAS = Object.freeze([
    Object.freeze({ kind: "forest", ids: Object.freeze([5, 7, 8]) }),
    Object.freeze({ kind: "jungle", ids: Object.freeze([10]) }),
    Object.freeze({ kind: "desert", ids: Object.freeze([9, 12]) }),
    Object.freeze({ kind: "tundra", ids: Object.freeze([4]) }),
]);
const HOT_DESERT = 12;
const GRASSLAND = 6;
const PLAINS_BIOMES = Object.freeze([6, 11]);
const SNOW = 3;

/** Every kind, with the label style group it is named in and the group it is matched within on a later run. */
export const FEATURE_KINDS = Object.freeze({
    ocean: Object.freeze({ style: "oceanSea", match: "water" }),
    sea: Object.freeze({ style: "oceanSea", match: "water" }),
    gulf: Object.freeze({ style: "gulfBayLake", match: "water" }),
    bay: Object.freeze({ style: "gulfBayLake", match: "water" }),
    lake: Object.freeze({ style: "gulfBayLake", match: "water" }),
    mountains: Object.freeze({ style: "mountains", match: "relief" }),
    hills: Object.freeze({ style: "hills", match: "relief" }),
    highlands: Object.freeze({ style: "hills", match: "relief" }),
    forest: Object.freeze({ style: "land", match: "land" }),
    jungle: Object.freeze({ style: "land", match: "land" }),
    desert: Object.freeze({ style: "land", match: "land" }),
    steppe: Object.freeze({ style: "land", match: "land" }),
    tundra: Object.freeze({ style: "land", match: "land" }),
    plains: Object.freeze({ style: "land", match: "land" }),
    river: Object.freeze({ style: "river", match: "river" }),
});

// ------------------------------------------------------------------ grids

/** The map's rasters on a grid `s` times coarser: land, sea and lake by majority, mean height and moisture, majority biome. */
export function coarsen(map, s) {
    const { W, H, elev, lake, biome, seaLevel, moisture = null } = map;
    const w = Math.ceil(W / s);
    const h = Math.ceil(H / s);
    const land = new Uint8Array(w * h);
    const sea = new Uint8Array(w * h);
    const lakes = new Uint8Array(w * h);
    const height = new Float32Array(w * h);
    const biomes = new Uint8Array(w * h);
    const wet = new Float32Array(w * h);
    const tally = new Uint16Array(16);
    for (let cy = 0; cy < h; cy++) {
        for (let cx = 0; cx < w; cx++) {
            let nLand = 0;
            let nSea = 0;
            let nLake = 0;
            let sum = 0;
            let count = 0;
            let damp = 0;
            tally.fill(0);
            for (let y = cy * s; y < Math.min(H, cy * s + s); y++) {
                for (let x = cx * s; x < Math.min(W, cx * s + s); x++) {
                    const i = y * W + x;
                    count++;
                    sum += elev[i];
                    if (moisture) damp += moisture[i];
                    if (lake[i]) nLake++;
                    else if (elev[i] < seaLevel) nSea++;
                    else {
                        nLand++;
                        tally[biome[i]]++;
                    }
                }
            }
            const c = cy * w + cx;
            height[c] = sum / count;
            wet[c] = damp / count;
            if (nLand >= nSea && nLand >= nLake) {
                land[c] = 1;
                let best = 0;
                for (let b = 1; b < 16; b++) if (tally[b] > tally[best]) best = b;
                biomes[c] = best;
            } else if (nSea >= nLake) sea[c] = 1;
            else lakes[c] = 1;
        }
    }
    return { w, h, s, land, sea, lake: lakes, height, biome: biomes, moisture: wet };
}

/** Squared Euclidean distance transform (Felzenszwalb and Huttenlocher) to the nearest cell where `isSource`. */
export function distanceTransform(w, h, isSource) {
    const INF = 1e12;
    const grid = new Float64Array(w * h);
    for (let i = 0; i < w * h; i++) grid[i] = isSource(i) ? 0 : INF;
    const n = Math.max(w, h);
    const f = new Float64Array(n);
    const d = new Float64Array(n);
    const v = new Int32Array(n);
    const z = new Float64Array(n + 1);
    const pass = (length) => {
        let k = 0;
        v[0] = 0;
        z[0] = -INF;
        z[1] = INF;
        for (let q = 1; q < length; q++) {
            let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
            while (s <= z[k]) {
                k--;
                s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
            }
            k++;
            v[k] = q;
            z[k] = s;
            z[k + 1] = INF;
        }
        k = 0;
        for (let q = 0; q < length; q++) {
            while (z[k + 1] < q) k++;
            d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
        }
    };
    for (let x = 0; x < w; x++) {
        for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
        pass(h);
        for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
    }
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) f[x] = grid[y * w + x];
        pass(w);
        for (let x = 0; x < w; x++) grid[y * w + x] = d[x];
    }
    const out = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) out[i] = Math.sqrt(grid[i]);
    return out;
}

/** Connected components (4-connected) of the cells where `inside`; returns labels (-1 outside) and component cell lists. */
export function components(w, h, inside) {
    const label = new Int32Array(w * h).fill(-1);
    const parts = [];
    const stack = [];
    for (let start = 0; start < w * h; start++) {
        if (label[start] >= 0 || !inside(start)) continue;
        const id = parts.length;
        const cells = [];
        label[start] = id;
        stack.push(start);
        while (stack.length) {
            const c = stack.pop();
            cells.push(c);
            const x = c % w;
            const y = (c - x) / w;
            for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
                if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                const n = ny * w + nx;
                if (label[n] < 0 && inside(n)) {
                    label[n] = id;
                    stack.push(n);
                }
            }
        }
        parts.push(cells);
    }
    return { label, parts };
}

/** Grows (dilate) then shrinks (erode) a mask by `r` cells (a square), joining parts that lie close together. */
export function close(w, h, mask, r) {
    const grow = new Uint8Array(w * h);
    const dist = distanceTransform(w, h, (i) => mask[i] === 1);
    for (let i = 0; i < w * h; i++) grow[i] = dist[i] <= r ? 1 : 0;
    const back = distanceTransform(w, h, (i) => grow[i] === 0);
    const out = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) out[i] = back[i] > r ? 1 : 0;
    // Never more than the grown mask, and never less than the original
    for (let i = 0; i < w * h; i++) if (mask[i]) out[i] = 1;
    return out;
}

/** Centroid, principal axis (degrees, 0 = east, clockwise as y runs down) and elongation of cells. */
export function shapeOf(cells, w) {
    let sx = 0;
    let sy = 0;
    for (const c of cells) {
        sx += c % w;
        sy += Math.floor(c / w);
    }
    const cx = sx / cells.length;
    const cy = sy / cells.length;
    let xx = 0;
    let yy = 0;
    let xy = 0;
    for (const c of cells) {
        const dx = (c % w) - cx;
        const dy = Math.floor(c / w) - cy;
        xx += dx * dx;
        yy += dy * dy;
        xy += dx * dy;
    }
    xx /= cells.length;
    yy /= cells.length;
    xy /= cells.length;
    const trace = xx + yy;
    const det = xx * yy - xy * xy;
    const l1 = trace / 2 + Math.sqrt(Math.max(0, (trace * trace) / 4 - det));
    const l2 = Math.max(1e-6, trace - l1);
    const angle = (Math.atan2(2 * xy, xx - yy) / 2) * (180 / Math.PI);
    return { cx, cy, angle, elongation: Math.sqrt(l1 / l2), length: 4 * Math.sqrt(l1) };
}

/** An angle turned to read left to right (between -90 and 90), and limited to ±limit degrees. */
function readable(angle, limit = 60) {
    let a = ((angle % 180) + 180) % 180;
    if (a > 90) a -= 180;
    return Math.max(-limit, Math.min(limit, a));
}

/** The cell of `cells` nearest a point, preferring cells deep inside (by `depth`, if given). */
function anchorOf(cells, w, cx, cy, depth = null) {
    let best = cells[0];
    let score = Infinity;
    for (const c of cells) {
        const dx = (c % w) - cx;
        const dy = Math.floor(c / w) - cy;
        const s = Math.hypot(dx, dy) - (depth ? depth[c] * 1.5 : 0);
        if (s < score) {
            score = s;
            best = c;
        }
    }
    return best;
}

// ------------------------------------------------------------------ water

/**
 * The sea split into basins: a watershed of the distance to land, flooded from the widest water
 * down. Two basins meeting are joined unless they meet in a strait narrower than STRAIT_RATIO of
 * the shallower one's widest point; basins too narrow ever to be a sea of their own always join.
 */
export function seaBasins(g, settings = SETTINGS) {
    const { w, h, sea } = g;
    // Distance to land or lake; the map's edge is not land (the sea goes on beyond it)
    const dist = distanceTransform(w, h, (i) => !sea[i]);
    const order = [];
    for (let i = 0; i < w * h; i++) if (sea[i]) order.push(i);
    order.sort((a, b) => dist[b] - dist[a]);
    const parent = new Int32Array(w * h).fill(-1);
    const peak = new Float32Array(w * h);
    const find = (i) => {
        while (parent[i] !== i) {
            parent[i] = parent[parent[i]];
            i = parent[i];
        }
        return i;
    };
    const minPeak = (settings.MIN_BASIN_PEAK * Math.min(w, h));
    const owner = new Int32Array(w * h).fill(-1);
    const straits = [];
    for (const p of order) {
        const x = p % w;
        const y = (p - x) / w;
        const roots = new Set();
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                const nx = x + dx;
                const ny = y + dy;
                if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                const n = ny * w + nx;
                if (owner[n] >= 0) roots.add(find(owner[n]));
            }
        }
        if (!roots.size) {
            parent[p] = p;
            peak[p] = dist[p];
            owner[p] = p;
            continue;
        }
        const list = [...roots].sort((a, b) => peak[b] - peak[a]);
        let main = list[0];
        for (const other of list.slice(1)) {
            const a = find(main);
            const b = find(other);
            if (a === b) continue;
            const lower = Math.min(peak[a], peak[b]);
            if (lower < minPeak || dist[p] >= settings.STRAIT_RATIO * lower) {
                const [keep, drop] = peak[a] >= peak[b] ? [a, b] : [b, a];
                parent[drop] = keep;
                main = keep;
            } else straits.push({ cell: p, width: dist[p] * 2, a, b });
        }
        owner[p] = find(main);
    }
    const basinOf = new Int32Array(w * h).fill(-1);
    const ids = new Map();
    const basins = [];
    for (const p of order) {
        const root = find(owner[p]);
        if (!ids.has(root)) {
            ids.set(root, basins.length);
            basins.push({ root, peak: peak[root], cells: [] });
        }
        const id = ids.get(root);
        basinOf[p] = id;
        basins[id].cells.push(p);
    }
    return { dist, basinOf, basins, straits };
}

/** Seas, oceans, gulfs and bays from the basins; small basins join the neighbour they share most edge with. */
export function waterBodies(g, settings = SETTINGS) {
    const { w, h, sea } = g;
    const { dist, basinOf, basins } = seaBasins(g, settings);
    const totalSea = sea.reduce((a, b) => a + b, 0);
    const minArea = settings.MIN_SEA_AREA * w * h;
    // Merge small basins into their largest-bordering neighbour, smallest first
    const order = basins.map((b, i) => i).sort((a, b) => basins[a].cells.length - basins[b].cells.length);
    const alias = basins.map((_, i) => i);
    const resolve = (i) => {
        while (alias[i] !== i) i = alias[i];
        return i;
    };
    const sizes = basins.map((b) => b.cells.length);
    for (const i of order) {
        if (sizes[resolve(i)] >= minArea || resolve(i) !== i) continue;
        const shared = new Map();
        for (const c of basins[i].cells) {
            const x = c % w;
            const y = (c - x) / w;
            for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
                if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                const n = basinOf[ny * w + nx];
                if (n < 0) continue;
                const r = resolve(n);
                if (r !== i) shared.set(r, (shared.get(r) ?? 0) + 1);
            }
        }
        if (!shared.size) continue;
        const target = [...shared.entries()].sort((a, b) => b[1] - a[1])[0][0];
        alias[i] = target;
        sizes[target] += sizes[i];
    }
    const groups = new Map();
    basins.forEach((basin, i) => {
        const r = resolve(i);
        if (!groups.has(r)) groups.set(r, []);
        groups.get(r).push(...basin.cells);
    });
    const label = new Int32Array(w * h).fill(-1);
    const bodies = [];
    for (const cells of groups.values()) {
        if (cells.length < minArea) continue;
        const id = bodies.length;
        for (const c of cells) label[c] = id;
        bodies.push({ cells });
    }
    for (const body of bodies) {
        const id = bodies.indexOf(body);
        let coast = 0;
        let other = 0;
        let edge = 0;
        let deepest = body.cells[0];
        for (const c of body.cells) {
            if (dist[c] > dist[deepest]) deepest = c;
            const x = c % w;
            const y = (c - x) / w;
            for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
                if (nx < 0 || ny < 0 || nx >= w || ny >= h) {
                    edge++;
                    continue;
                }
                const n = ny * w + nx;
                if (!sea[n]) coast++;
                else if (label[n] !== id) other++;
            }
        }
        const sides = coast + other + edge;
        body.coastShare = coast / sides;
        body.edgeShare = edge / sides;
        body.area = body.cells.length;
        body.deepest = deepest;
        body.width = dist[deepest] * 2;
        const shape = shapeOf(body.cells, w);
        body.shape = shape;
        // Water cut off from the map's edge and the open sea is an inland sea, or a lake if small
        if (body.edgeShare === 0 && body.coastShare >= settings.ENCLOSED_COAST_SHARE) body.kind = body.area >= settings.INLAND_SEA_AREA * w * h ? "sea" : "lake";
        else if (body.area >= settings.OCEAN_SHARE * totalSea && body.edgeShare > 0.05) body.kind = "ocean";
        else if (body.coastShare >= settings.GULF_COAST_SHARE) body.kind = body.area <= settings.BAY_MAX_AREA * w * h ? "bay" : "gulf";
        else body.kind = "sea";
        // The label: at the widest water near the body's middle, along its length when it is long
        const anchor = anchorOf(body.cells, w, shape.cx, shape.cy, dist);
        body.label = { x: ((anchor % w) + 0.5) * g.s, y: (Math.floor(anchor / w) + 0.5) * g.s, angle: shape.elongation > 1.8 ? readable(shape.angle, 45) : 0, room: dist[anchor] * 2 * g.s };
    }
    return { bodies, label, dist };
}

/** Inlets of the coast: sea from which most directions reach land within a short distance. */
export function inlets(map, settings = SETTINGS) {
    const g = coarsen(map, settings.BAY_GRID);
    const { w, h, sea } = g;
    const reach = Math.round((settings.INLET_REACH * Math.min(map.W, map.H)) / g.s);
    const dist = distanceTransform(w, h, (i) => !sea[i]);
    const inlet = new Uint8Array(w * h);
    const RAYS = 16;
    const dirs = Array.from({ length: RAYS }, (_, k) => [Math.cos((k * 2 * Math.PI) / RAYS), Math.sin((k * 2 * Math.PI) / RAYS)]);
    for (let i = 0; i < w * h; i++) {
        if (!sea[i] || dist[i] > reach) continue;
        const x0 = i % w;
        const y0 = (i - x0) / w;
        let hits = 0;
        for (let k = 0; k < RAYS; k++) {
            const [dx, dy] = dirs[k];
            for (let t = 1; t <= reach; t++) {
                const x = Math.round(x0 + dx * t);
                const y = Math.round(y0 + dy * t);
                if (x < 0 || y < 0 || x >= w || y >= h) break;
                if (!sea[y * w + x]) {
                    hits++;
                    break;
                }
            }
            if (hits + (RAYS - 1 - k) < settings.INLET_RAYS) break;
        }
        if (hits >= settings.INLET_RAYS) inlet[i] = 1;
    }
    const { parts } = components(w, h, (i) => inlet[i] === 1);
    const minArea = settings.MIN_INLET_AREA * w * h;
    return {
        grid: g,
        inlets: parts
            .filter((cells) => cells.length >= minArea)
            .map((cells) => {
                const shape = shapeOf(cells, w);
                const anchor = anchorOf(cells, w, shape.cx, shape.cy, dist);
                return {
                    kind: "bay",
                    cells,
                    area: cells.length,
                    shape,
                    label: { x: ((anchor % w) + 0.5) * g.s, y: (Math.floor(anchor / w) + 0.5) * g.s, angle: shape.elongation > 2 ? readable(shape.angle, 45) : 0, room: dist[anchor] * 2 * g.s },
                };
            }),
    };
}

/** Lakes: the lake mask's larger parts, on the bay grid. */
export function lakes(map, settings = SETTINGS) {
    const g = coarsen(map, settings.BAY_GRID);
    const { w, h, lake } = g;
    const dist = distanceTransform(w, h, (i) => !lake[i]);
    const { parts } = components(w, h, (i) => lake[i] === 1);
    const minArea = settings.MIN_LAKE_AREA * w * h;
    return {
        grid: g,
        lakes: parts
            .filter((cells) => cells.length >= minArea)
            .map((cells) => {
                const shape = shapeOf(cells, w);
                const anchor = anchorOf(cells, w, shape.cx, shape.cy, dist);
                return { kind: "lake", cells, area: cells.length, shape, label: { x: ((anchor % w) + 0.5) * g.s, y: (Math.floor(anchor / w) + 0.5) * g.s, angle: shape.elongation > 2 ? readable(shape.angle, 45) : 0, room: dist[anchor] * 2 * g.s } };
            }),
    };
}

// ------------------------------------------------------------------ relief and biome areas

/** Mountains, hills and highlands on the coarse grid. */
export function relief(g, seaLevel, settings = SETTINGS) {
    const { w, h, land, height } = g;
    let top = seaLevel;
    for (let i = 0; i < w * h; i++) if (land[i] && height[i] > top) top = height[i];
    const norm = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) norm[i] = land[i] ? (height[i] - seaLevel) / (top - seaLevel) : 0;
    // Ruggedness: the spread (max - min) of normalised height within a small square
    const rough = new Float32Array(w * h);
    const r = settings.ROUGH_RADIUS;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = y * w + x;
            if (!land[i]) continue;
            let lo = Infinity;
            let hi = -Infinity;
            for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r); yy++) {
                for (let xx = Math.max(0, x - r); xx <= Math.min(w - 1, x + r); xx++) {
                    const v = norm[yy * w + xx];
                    if (v < lo) lo = v;
                    if (v > hi) hi = v;
                }
            }
            rough[i] = hi - lo;
        }
    }
    const high = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) high[i] = land[i] && (norm[i] >= settings.MOUNTAIN_HEIGHT || g.biome[i] === SNOW) ? 1 : 0;
    const highClosed = close(w, h, high, settings.CLOSE_RADIUS);
    const features = [];
    const mountainParts = components(w, h, (i) => highClosed[i] === 1 && land[i] === 1);
    const taken = new Uint8Array(w * h);
    for (const cells of mountainParts.parts) {
        if (cells.length < settings.MIN_RANGE_AREA * w * h) continue;
        for (const c of cells) taken[c] = 1;
        features.push(reliefFeature("mountains", cells, w, g.s, norm, rough));
    }
    const raised = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) raised[i] = land[i] && !taken[i] && norm[i] >= settings.HILL_HEIGHT ? 1 : 0;
    const raisedClosed = close(w, h, raised, settings.CLOSE_RADIUS);
    const hillParts = components(w, h, (i) => raisedClosed[i] === 1 && land[i] === 1 && !taken[i]);
    for (const cells of hillParts.parts) {
        if (cells.length < settings.MIN_HILLS_AREA * w * h) continue;
        for (const c of cells) taken[c] = 1;
        const f = reliefFeature("hills", cells, w, g.s, norm, rough);
        f.kind = f.roughness >= settings.HILL_ROUGHNESS ? "hills" : "highlands";
        features.push(f);
    }
    return { features, norm, rough, taken };
}

function reliefFeature(kind, cells, w, s, norm, rough) {
    const shape = shapeOf(cells, w);
    let sumH = 0;
    let sumR = 0;
    for (const c of cells) {
        sumH += norm[c];
        sumR += rough[c];
    }
    const anchor = anchorOf(cells, w, shape.cx, shape.cy);
    return {
        kind,
        cells,
        area: cells.length,
        shape,
        height: sumH / cells.length,
        roughness: sumR / cells.length,
        label: { x: ((anchor % w) + 0.5) * s, y: (Math.floor(anchor / w) + 0.5) * s, angle: shape.elongation > 1.6 ? readable(shape.angle, 60) : 0, room: shape.length * s },
    };
}

/**
 * Large areas of one kind of land (forest, jungle, desert or steppe, tundra), closed and grouped,
 * and plains: low, flat, open land (grassland or savanna) off the relief. A desert mostly hot is
 * always a desert; a cold one is steppe where its land is moist or runs into grassland.
 * @param {object} g - The coarse grid (see coarsen).
 * @param {{norm: Float32Array, rough: Float32Array, taken: Uint8Array}} relief - From relief().
 */
export function biomeAreas(g, relief, settings = SETTINGS) {
    const { w, h, land, biome } = g;
    const out = [];
    const area = (kind, cells) => {
        const shape = shapeOf(cells, w);
        const anchor = anchorOf(cells, w, shape.cx, shape.cy);
        return { kind, cells, area: cells.length, shape, label: { x: ((anchor % w) + 0.5) * g.s, y: (Math.floor(anchor / w) + 0.5) * g.s, angle: shape.elongation > 1.8 ? readable(shape.angle, 45) : 0, room: shape.length * g.s } };
    };
    const grouped = (mask, minArea) => {
        const closed = close(w, h, mask, settings.CLOSE_RADIUS);
        return components(w, h, (i) => closed[i] === 1 && land[i] === 1).parts.filter((cells) => cells.length >= minArea * w * h);
    };
    for (const kind of BIOME_AREAS) {
        const ids = new Set(kind.ids);
        const mask = new Uint8Array(w * h);
        for (let i = 0; i < w * h; i++) mask[i] = land[i] && ids.has(biome[i]) ? 1 : 0;
        for (const cells of grouped(mask, settings.MIN_BIOME_AREA)) out.push(area(kind.kind === "desert" ? desertKind(g, cells, settings) : kind.kind, cells));
    }
    if (relief) {
        const plains = new Uint8Array(w * h);
        const low = settings.HILL_HEIGHT * settings.PLAINS_HEIGHT;
        const ruggedness = [];
        for (let i = 0; i < w * h; i++) if (land[i]) ruggedness.push(relief.rough[i]);
        ruggedness.sort((a, b) => a - b);
        const smooth = ruggedness.length ? ruggedness[Math.floor(ruggedness.length * settings.PLAINS_ROUGHNESS)] : 0;
        for (let i = 0; i < w * h; i++) plains[i] = land[i] && !relief.taken[i] && PLAINS_BIOMES.includes(biome[i]) && relief.norm[i] < low && relief.rough[i] < smooth ? 1 : 0;
        for (const cells of grouped(plains, settings.MIN_PLAINS_AREA)) out.push(area("plains", cells));
    }
    return out;
}

/** A desert area's kind: desert when mostly hot or dry, steppe when moist or bordered by grassland. */
function desertKind(g, cells, settings) {
    const { w, h, biome, land, moisture } = g;
    let hot = 0;
    let damp = 0;
    for (const c of cells) {
        if (biome[c] === HOT_DESERT) hot++;
        damp += moisture[c];
    }
    if (hot >= cells.length / 2) return "desert";
    const inside = new Set(cells);
    let border = 0;
    let grass = 0;
    for (const c of cells) {
        const x = c % w;
        const y = (c - x) / w;
        for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const n = ny * w + nx;
            if (inside.has(n) || !land[n]) continue;
            border++;
            if (biome[n] === GRASSLAND) grass++;
        }
    }
    return damp / cells.length >= settings.STEPPE_MOISTURE || (border > 0 && grass / border >= settings.STEPPE_GRASS_BORDER) ? "steppe" : "desert";
}

// ------------------------------------------------------------------ rivers

/**
 * The rivers worth naming: the largest by flow (at least RIVER_FLOW_SHARE of the largest, at most
 * MAX_RIVERS), each with a label along the straightest stretch of its lower two thirds that is
 * long enough for its name (`labelLength`, in map pixels, a function of the river).
 */
export function namedRivers(rivers, labelLength, settings = SETTINGS) {
    const flows = rivers.map((river) => Math.max(0, ...(river.flow ?? [0])));
    const biggest = Math.max(...flows, 1);
    const chosen = rivers
        .map((river, i) => ({ river, flow: flows[i] }))
        .filter(({ river, flow }) => flow >= settings.RIVER_FLOW_SHARE * biggest && river.path.length > 20)
        .sort((a, b) => b.flow - a.flow)
        .slice(0, settings.MAX_RIVERS);
    return chosen.map(({ river, flow }) => {
        const path = river.path;
        const need = labelLength(river);
        let best = null;
        // Arc length along the path
        const along = [0];
        for (let i = 1; i < path.length; i++) along.push(along[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
        const total = along.at(-1);
        for (let i = 0, j = 0; i < path.length; i++) {
            if (path[i][2]) continue;
            while (j < path.length - 1 && along[j] - along[i] < need) j++;
            if (along[j] - along[i] < need) break;
            let lake = false;
            for (let k = i; k <= j; k++) if (path[k][2]) lake = true;
            if (lake) continue;
            const chord = Math.hypot(path[j][0] - path[i][0], path[j][1] - path[i][1]);
            const straight = chord / (along[j] - along[i]);
            const middle = (along[i] + along[j]) / 2 / total;
            // Prefer straight stretches, in the middle and lower course (away from the source)
            const score = straight - 0.35 * Math.abs(middle - 0.6);
            if (!best || score > best.score) best = { score, i, j, straight };
        }
        const label = best
            ? (() => {
                  const a = path[best.i];
                  const b = path[best.j];
                  const angle = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
                  return { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, angle: readable(angle, 75), straight: best.straight, along: [best.i, best.j] };
              })()
            : null;
        return { kind: "river", id: river.id, flow, length: total, path, label };
    });
}

// ------------------------------------------------------------------ fitting a straight label

/**
 * The best place and angle for a straight name of `width` x `height` map pixels inside a feature's
 * area: tried at its deepest cells and its middle, turned from -60 to 60 degrees, scored by how
 * much of the name lies inside the area (and on the map), less a little for steep angles and for
 * straying from the middle. A ring or bent range is labelled along one of its arms rather than
 * across the land it encloses.
 * @returns {{x: number, y: number, angle: number, inside: number}}
 */
export function fitLabel(cells, grid, W, H, width, height, { maxAngle = 60, step = 10 } = {}) {
    const { w, s } = grid;
    const h = Math.ceil(H / s);
    const mask = new Uint8Array(w * h);
    for (const c of cells) mask[c] = 1;
    const depth = distanceTransform(w, h, (i) => !mask[i]);
    const shape = shapeOf(cells, w);
    // Candidates: the deepest cells, spread out, and the cell nearest the middle
    const byDepth = [...cells].sort((a, b) => depth[b] - depth[a]);
    const chosen = [];
    const spacing = Math.max(2, height / s);
    for (const c of byDepth) {
        if (chosen.length >= 40) break;
        const x = c % w;
        const y = Math.floor(c / w);
        if (chosen.every((o) => Math.hypot((o % w) - x, Math.floor(o / w) - y) >= spacing)) chosen.push(c);
    }
    chosen.push(anchorOf(cells, w, shape.cx, shape.cy, depth));
    const inside = (x, y) => {
        if (x < 0 || y < 0 || x >= W || y >= H) return -1;
        return mask[Math.floor(y / s) * w + Math.floor(x / s)] ? 1 : 0;
    };
    let best = null;
    const reach = Math.max(1, shape.length * s);
    for (const c of chosen) {
        const cx = ((c % w) + 0.5) * s;
        const cy = (Math.floor(c / w) + 0.5) * s;
        for (let angle = -maxAngle; angle <= maxAngle; angle += step) {
            const a = (angle * Math.PI) / 180;
            const ux = Math.cos(a);
            const uy = Math.sin(a);
            let score = 0;
            let count = 0;
            for (let i = 0; i <= 10; i++) {
                const t = (i / 10 - 0.5) * width;
                for (const v of [-0.5, 0, 0.5]) {
                    const k = inside(cx + ux * t - uy * v * height, cy + uy * t + ux * v * height);
                    score += k < 0 ? -2 : k;
                    count++;
                }
            }
            const share = score / count;
            const total = share - 0.0015 * Math.abs(angle) - 0.15 * (Math.hypot(cx - (shape.cx + 0.5) * s, cy - (shape.cy + 0.5) * s) / reach);
            if (!best || total > best.total) best = { x: cx, y: cy, angle, inside: share, total };
        }
    }
    return { x: best.x, y: best.y, angle: best.angle, inside: Math.round(best.inside * 100) / 100 };
}

// ------------------------------------------------------------------ every feature of a map

/**
 * Every natural feature of a map. An inlet already found as a gulf, bay or lake of its own is
 * not found twice.
 * @param {{W: number, H: number, elev: Float32Array, lake: Uint8Array, biome: Uint8Array, moisture?: Float32Array, seaLevel: number, rivers: {id: number, path: number[][], flow: number[]|null}[]}} map -
 *     The map's rasters (a pixel each: height, 1 for lake, the built-in biome a land pixel
 *     behaves as, moisture), its effective sea level, and its traced rivers (each point
 *     `[x, y, isLake]`, with the flow along it).
 * @param {object} [options]
 * @param {function(object): number} [options.riverLabelLength] - How long a river's name is, in map pixels.
 * @returns {object[]} Features: `{ kind, cells, grid, area, label: {x, y, angle, room}, ... }`,
 *     a river with `path` and `flow` in place of cells.
 */
export function findFeatures(map, { riverLabelLength = () => Math.min(map.W, map.H) * 0.06 } = {}, settings = SETTINGS) {
    const coarse = coarsen(map, settings.COARSE);
    const water = waterBodies(coarse, settings);
    const bays = inlets(map, settings);
    const lakeList = lakes(map, settings);
    const raised = relief(coarse, map.seaLevel, settings);
    const areas = biomeAreas(coarse, raised, settings);
    const rivers = namedRivers(map.rivers ?? [], riverLabelLength, settings);
    const features = [];
    for (const body of water.bodies) features.push({ ...body, grid: coarse });
    for (const inlet of bays.inlets) {
        const g = bays.grid;
        const inside = inlet.cells.filter((c) => {
            const cx = Math.floor((((c % g.w) + 0.5) * g.s) / coarse.s);
            const cy = Math.floor(((Math.floor(c / g.w) + 0.5) * g.s) / coarse.s);
            const id = water.label[cy * coarse.w + cx];
            return id >= 0 && ["bay", "gulf", "lake"].includes(water.bodies[id].kind);
        }).length;
        if (inside / inlet.cells.length < 0.5) features.push({ ...inlet, grid: g });
    }
    for (const lake of lakeList.lakes) features.push({ ...lake, grid: lakeList.grid });
    for (const feature of raised.features) features.push({ ...feature, grid: coarse });
    for (const feature of areas) features.push({ ...feature, grid: coarse });
    for (const river of rivers) if (river.label) features.push({ ...river, grid: { w: map.W, s: 1 } });
    return features;
}

/**
 * Points spread over a feature, in map pixels (every `every`-th cell; a river's course), from
 * which the people living there are read.
 */
export function samplePoints(feature, every = 8) {
    if (feature.path) return feature.path.filter((_, i) => i % every === 0).map(([x, y]) => ({ x, y }));
    const { w, s } = feature.grid;
    const points = [];
    for (let i = 0; i < feature.cells.length; i += every) {
        const c = feature.cells[i];
        points.push({ x: ((c % w) + 0.5) * s, y: (Math.floor(c / w) + 0.5) * s });
    }
    return points;
}

// ------------------------------------------------------------------ footprints and matching

/** A footprint's cell size for a map, in pixels. */
export function footprintCell(W, H, settings = SETTINGS) {
    return Math.max(4, Math.round(Math.min(W, H) * settings.FOOTPRINT_CELL));
}

/**
 * What a label keeps of its feature to find it again on a later run: an area's cells on a grid
 * of `cell` pixels as runs (`[row, first column, length, ...]`), or a river's course as at most
 * RIVER_POINTS points.
 * @returns {{cell: number, runs: number[]}|{path: {x: number, y: number}[]}}
 */
export function footprintOf(feature, cell, settings = SETTINGS) {
    if (feature.path) {
        const step = Math.max(1, Math.ceil(feature.path.length / settings.RIVER_POINTS));
        const points = feature.path.filter((_, i) => i % step === 0 || i === feature.path.length - 1);
        return { path: points.map(([x, y]) => ({ x: Math.round(x), y: Math.round(y) })) };
    }
    const { w, s } = feature.grid;
    const keys = new Set();
    for (const c of feature.cells) keys.add(Math.floor(((Math.floor(c / w) + 0.5) * s) / cell) * 1e6 + Math.floor((((c % w) + 0.5) * s) / cell));
    const sorted = [...keys].sort((a, b) => a - b);
    const runs = [];
    for (const key of sorted) {
        const row = Math.floor(key / 1e6);
        const column = key % 1e6;
        const n = runs.length;
        if (n && runs[n - 3] === row && runs[n - 2] + runs[n - 1] === column) runs[n - 1]++;
        else runs.push(row, column, 1);
    }
    return { cell, runs };
}

/** A footprint's cells as a set of `row * 1e6 + column`. */
function footprintSet({ runs }) {
    const set = new Set();
    for (let i = 0; i + 2 < runs.length; i += 3) for (let k = 0; k < runs[i + 2]; k++) set.add(runs[i] * 1e6 + runs[i + 1] + k);
    return set;
}

/**
 * How much two footprints are the same feature, from 0 to 1: areas by intersection over union
 * (on the same cell size; otherwise 0), rivers by the share of the shorter course's points that
 * lie within two footprint cells of the other's.
 */
export function overlap(a, b) {
    if (a?.path && b?.path) {
        const [short, long] = a.path.length <= b.path.length ? [a.path, b.path] : [b.path, a.path];
        if (!short.length) return 0;
        const reach = 36;
        let near = 0;
        for (const p of short) if (long.some((q) => (p.x - q.x) ** 2 + (p.y - q.y) ** 2 <= reach * reach)) near++;
        return near / short.length;
    }
    if (!a?.runs || !b?.runs || a.cell !== b.cell) return 0;
    const first = footprintSet(a);
    const second = footprintSet(b);
    let shared = 0;
    for (const key of first) if (second.has(key)) shared++;
    const union = first.size + second.size - shared;
    return union ? shared / union : 0;
}

/**
 * Pairs features found now with labels a run made before: within the same match group, by
 * overlap at least `threshold`, best pairs first, each feature with at most one label and each
 * label with at most one feature.
 * @param {{kind: string, footprint: object}[]} found
 * @param {{kind: string, footprint: object}[]} before
 * @returns {Map<number, number>} Index in `found` to index in `before`.
 */
export function matchFeatures(found, before, threshold = 0.5) {
    const pairs = [];
    found.forEach((feature, i) => {
        const group = FEATURE_KINDS[feature.kind]?.match;
        before.forEach((old, j) => {
            if (FEATURE_KINDS[old.kind]?.match !== group) return;
            const score = overlap(feature.footprint, old.footprint);
            if (score >= threshold) pairs.push({ i, j, score });
        });
    });
    pairs.sort((a, b) => b.score - a.score || a.i - b.i || a.j - b.j);
    const matched = new Map();
    const taken = new Set();
    for (const { i, j } of pairs) {
        if (matched.has(i) || taken.has(j)) continue;
        matched.set(i, j);
        taken.add(j);
    }
    return matched;
}

/** Whether a map point lies inside a footprint (an area's cells, or within reach of a river's course). */
export function footprintHas(footprint, x, y) {
    if (footprint?.path) return footprint.path.some((p) => (p.x - x) ** 2 + (p.y - y) ** 2 <= 36 * 36);
    if (!footprint?.runs) return false;
    const row = Math.floor(y / footprint.cell);
    const column = Math.floor(x / footprint.cell);
    const { runs } = footprint;
    for (let i = 0; i + 2 < runs.length; i += 3) if (runs[i] === row && column >= runs[i + 1] && column < runs[i + 1] + runs[i + 2]) return true;
    return false;
}
