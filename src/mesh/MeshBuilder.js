import { Delaunay } from "../../vendor/d3-delaunay/d3-delaunay.js";
import { FILRODENSWMB } from "../config.js";
import { segmentCrossesRect } from "./Geometry.js";
import { createMeshBlock, effectiveKmPerPx } from "./Schema.js";

/**
 * The display mesh: a Poisson-disc set of sites over the map, their Delaunay triangulation and
 * Voronoi cells, and everything derived from them that the region, border and route code needs.
 *
 * Two levels share one set of sites. The model sites (the generator's coarse mesh, about 25
 * effective km apart) are sampled first, then the display sites fill the gaps between them with
 * both sets in the same acceptance grid. So the model sites are display sites 0 to modelCount - 1,
 * and a model cell is exactly the set of display cells whose site is nearest that model site
 * (parentOf). Each group is then renumbered along a Hilbert curve, so cells close on the map have
 * close ids (see hilbertOrdered). Nothing about the mesh is stored with a map except { seed,
 * spacing, modelSpacingKm, version }: the sites are regenerated, bit for bit, from those.
 *
 * Determinism across JavaScript engines is what makes that possible. The sampler only uses
 * + - x / and Math.floor on doubles, which IEEE 754 defines exactly, plus integer operations in
 * mulberry32; it never calls Math.sin, Math.cos, Math.exp or similar, whose results are allowed to
 * differ between engines. The annulus around each active site is sampled by rejection from a
 * square for that reason. Do not "simplify" it to an angle and a radius. Delaunator and its robust
 * predicates are likewise pure arithmetic.
 */

/** Candidates tried around an active site before it is retired (Bridson's k). */
const BRIDSON_ATTEMPTS = 30;
/** The annulus is [r, 2r): candidates come from the square of half-width 2r around the site. */
const ANNULUS_OUTER = 2;
/** Grid cells either side of a candidate's cell that can hold a site closer than r. */
const GRID_REACH = 2;
/** Pixel centres are sampled, not pixel corners. */
const PIXEL_CENTRE = 0.5;

/**
 * mulberry32: a small, fast, seeded generator of [0, 1) built only from 32-bit integer operations,
 * so it gives the same sequence in every engine.
 * @param {number} seed
 * @returns {function(): number}
 */
export function mulberry32(seed) {
    let state = seed | 0;
    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * The background grid Bridson's algorithm checks candidates against: cells of side r/√2, so each
 * holds at most one site.
 */
class AcceptanceGrid {
    constructor(width, height, radius) {
        this.radius = radius;
        this.radiusSq = radius * radius;
        this.cellSize = radius * Math.SQRT1_2;
        this.columns = Math.ceil(width / this.cellSize);
        this.rows = Math.ceil(height / this.cellSize);
        this.slots = new Int32Array(this.columns * this.rows).fill(-1);
    }

    insert(index, x, y) {
        this.slots[Math.floor(y / this.cellSize) * this.columns + Math.floor(x / this.cellSize)] = index;
    }

    /** True when no site in `points` is closer than the radius to (x, y). */
    isClear(points, x, y) {
        const gx = Math.floor(x / this.cellSize);
        const gy = Math.floor(y / this.cellSize);
        const y0 = Math.max(0, gy - GRID_REACH);
        const y1 = Math.min(this.rows - 1, gy + GRID_REACH);
        const x0 = Math.max(0, gx - GRID_REACH);
        const x1 = Math.min(this.columns - 1, gx + GRID_REACH);
        for (let row = y0; row <= y1; row++) {
            const base = row * this.columns;
            for (let column = x0; column <= x1; column++) {
                const index = this.slots[base + column];
                if (index < 0) continue;
                const dx = points[2 * index] - x;
                const dy = points[2 * index + 1] - y;
                if (dx * dx + dy * dy < this.radiusSq) return false;
            }
        }
        return true;
    }
}

/**
 * Bridson's Poisson-disc fill. Grows `points` (a flat [x0, y0, x1, y1, ...] array) from the sites
 * listed in `active` until no active site can place a new neighbour. Active sites are picked at
 * random and retired by swapping in the last one, which keeps each step O(1) and the order of
 * picks fully determined by the generator.
 */
function poissonFill(points, active, grid, rng, width, height) {
    while (active.length) {
        const slot = Math.floor(rng() * active.length);
        const placed = tryPlaceAround(points, grid, rng, active[slot], width, height);
        if (placed >= 0) {
            active.push(placed);
            continue;
        }
        active[slot] = active[active.length - 1];
        active.pop();
    }
}

/**
 * Tries BRIDSON_ATTEMPTS candidates around one site; returns the new site's index, or -1.
 *
 * Each candidate is drawn from the square of half-width 2r around the site and rejected unless it
 * lies in the annulus [r, 2r) and on the map; a rejected draw still counts as an attempt. This is
 * the trig-free sampling the determinism of the whole mesh rests on (see the module comment).
 */
function tryPlaceAround(points, grid, rng, site, width, height) {
    const px = points[2 * site];
    const py = points[2 * site + 1];
    const radius = grid.radius;
    const innerSq = grid.radiusSq;
    const outerSq = ANNULUS_OUTER * ANNULUS_OUTER * innerSq;
    const span = 2 * ANNULUS_OUTER;
    for (let attempt = 0; attempt < BRIDSON_ATTEMPTS; attempt++) {
        const dx = (rng() * span - ANNULUS_OUTER) * radius;
        const dy = (rng() * span - ANNULUS_OUTER) * radius;
        const distanceSq = dx * dx + dy * dy;
        if (distanceSq < innerSq || distanceSq >= outerSq) continue;
        const x = px + dx;
        const y = py + dy;
        if (x < 0 || y < 0 || x >= width || y >= height || !grid.isClear(points, x, y)) continue;
        const index = points.length / 2;
        points.push(x, y);
        grid.insert(index, x, y);
        return index;
    }
    return -1;
}

/**
 * Samples the sites: model sites at modelSpacing from the map centre, then display sites at
 * spacing filling around them.
 *
 * @param {{width: number, height: number, spacing: number, modelSpacing: number, seed: number}} params - Sizes in pixels.
 * @returns {{sites: Float64Array, modelCount: number}}
 */
export function generateSites({ width, height, spacing, modelSpacing, seed }) {
    const rng = mulberry32(seed);
    const points = [width / 2, height / 2];

    // A model spacing below the display spacing would put model sites closer than the display
    // grid allows; the model mesh then simply is the display mesh.
    const modelRadius = Math.max(modelSpacing, spacing);
    const modelGrid = new AcceptanceGrid(width, height, modelRadius);
    modelGrid.insert(0, points[0], points[1]);
    poissonFill(points, [0], modelGrid, rng, width, height);
    const modelCount = points.length / 2;

    const displayGrid = new AcceptanceGrid(width, height, spacing);
    const active = [];
    for (let index = 0; index < modelCount; index++) {
        displayGrid.insert(index, points[2 * index], points[2 * index + 1]);
        active.push(index);
    }
    poissonFill(points, active, displayGrid, rng, width, height);
    return { sites: hilbertOrdered(points, modelCount, width, height), modelCount };
}

/**
 * Index of the integer point (x, y) along a Hilbert curve filling a side x side square (side a
 * power of two). Integer operations only.
 */
export function hilbertIndex(x, y, side) {
    let index = 0;
    let px = x;
    let py = y;
    for (let s = side >> 1; s > 0; s >>= 1) {
        const rx = (px & s) > 0 ? 1 : 0;
        const ry = (py & s) > 0 ? 1 : 0;
        index += s * s * ((3 * rx) ^ ry);
        // Rotate the quadrant so the curve inside it runs the right way
        if (ry === 0) {
            if (rx === 1) {
                px = s - 1 - px;
                py = s - 1 - py;
            }
            const swap = px;
            px = py;
            py = swap;
        }
    }
    return index;
}

/**
 * Reorders the model sites among themselves, and the display sites among themselves, along a
 * Hilbert curve through the map's pixels, so the model sites stay first.
 *
 * Bridson places consecutive sites all over its frontier, so in sampling order neighbouring cells
 * have unrelated ids. Along a space-filling curve, cells next to each other on the map are mostly
 * next to each other in id, which is what lets a level's owner array collapse into long runs (an
 * order of magnitude smaller once encoded) and keeps the searches' memory access local. Sites are
 * at least `spacing` (4 or more) pixels apart, so no two share a pixel and the order is total.
 */
function hilbertOrdered(points, modelCount, width, height) {
    let side = 1;
    while (side < Math.max(width, height)) side <<= 1;
    const count = points.length / 2;
    const keys = new Float64Array(count);
    for (let i = 0; i < count; i++) keys[i] = hilbertIndex(Math.floor(points[2 * i]), Math.floor(points[2 * i + 1]), side);
    const byCurve = (a, b) => keys[a] - keys[b];
    const order = [
        ...Array.from({ length: modelCount }, (_, i) => i).sort(byCurve),
        ...Array.from({ length: count - modelCount }, (_, i) => i + modelCount).sort(byCurve),
    ];
    const sites = new Float64Array(points.length);
    order.forEach((source, target) => {
        sites[2 * target] = points[2 * source];
        sites[2 * target + 1] = points[2 * source + 1];
    });
    return sites;
}

/**
 * FNV-1a hash of the sites' bytes, as an 8-digit hex string. Two engines that sample the same
 * sites give the same hash; the determinism test compares it with a stored value.
 * @param {Float64Array} sites
 * @returns {string}
 */
export function hashSites(sites) {
    const bytes = new Uint8Array(sites.buffer, sites.byteOffset, sites.byteLength);
    let hash = 2166136261;
    for (const byte of bytes) {
        hash ^= byte;
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Builds a compressed adjacency list (CSR) from the triangulation: neighbours of cell c are
 * list[start[c]] to list[start[c + 1] - 1]. Every interior Delaunay edge appears as two half-edges
 * (one per direction); a hull edge appears once, so its reverse direction is added by hand.
 *
 * Only cells whose Voronoi cells share an edge inside the map are neighbours. Along the map's
 * edge the triangulation can join two hull sites with a long, thin triangle whose shared Voronoi
 * edge lies wholly outside the map; inside the map those cells do not touch, and treating them as
 * neighbours would let a fill or a route jump along the map's edge past the cells between them
 * (see sharesEdgeInside).
 */
function buildNeighbours(mesh) {
    const { triangles, halfedges, cellCount } = mesh;
    const inside = new Uint8Array(halfedges.length);
    for (let edge = 0; edge < halfedges.length; edge++) {
        const twin = halfedges[edge];
        if (twin >= 0 && twin < edge) inside[edge] = inside[twin];
        else inside[edge] = sharesEdgeInside(mesh, edge) ? 1 : 0;
    }
    const degree = new Int32Array(cellCount + 1);
    const forEachDirectedEdge = (visit) => {
        for (let edge = 0; edge < triangles.length; edge++) {
            if (!inside[edge]) continue;
            const from = triangles[edge];
            const to = triangles[nextHalfedge(edge)];
            visit(from, to);
            if (halfedges[edge] < 0) visit(to, from);
        }
    };
    forEachDirectedEdge((from) => degree[from + 1]++);
    for (let cell = 0; cell < cellCount; cell++) degree[cell + 1] += degree[cell];

    const start = degree;
    const list = new Int32Array(start[cellCount]);
    const fill = start.slice(0, cellCount);
    forEachDirectedEdge((from, to) => {
        list[fill[from]++] = to;
    });
    return { start, list, inside };
}

const nextHalfedge = (edge) => (edge % 3 === 2 ? edge - 2 : edge + 1);
const previousHalfedge = (edge) => (edge % 3 === 0 ? edge + 2 : edge - 1);

/**
 * Whether the Voronoi edge dual to a Delaunay half-edge runs inside the map. For an interior edge
 * it is the segment between the circumcentres of the two triangles; for a hull edge it is the ray
 * from the hull triangle's circumcentre away from the triangle's third site. Most edges have both
 * circumcentres inside the map and need no clipping.
 */
function sharesEdgeInside(mesh, edge) {
    const { width, height, halfedges, triangles, sites } = mesh;
    const circumcentres = mesh.voronoi.circumcenters;
    const t = Math.floor(edge / 3);
    const [cx, cy] = [circumcentres[2 * t], circumcentres[2 * t + 1]];
    const twin = halfedges[edge];
    if (twin >= 0) {
        const u = Math.floor(twin / 3);
        const [dx, dy] = [circumcentres[2 * u], circumcentres[2 * u + 1]];
        if (isInside(cx, cy, width, height) && isInside(dx, dy, width, height)) return true;
        return segmentCrossesRect(cx, cy, dx, dy, width, height);
    }
    const [a, b, c] = [triangles[edge], triangles[nextHalfedge(edge)], triangles[previousHalfedge(edge)]];
    let nx = sites[2 * a + 1] - sites[2 * b + 1];
    let ny = sites[2 * b] - sites[2 * a];
    // Point the ray away from the third site of the triangle (the outside of the hull)
    if (nx * (sites[2 * c] - sites[2 * a]) + ny * (sites[2 * c + 1] - sites[2 * a + 1]) > 0) [nx, ny] = [-nx, -ny];
    const reach = (2 * (width + height)) / Math.sqrt(nx * nx + ny * ny);
    return segmentCrossesRect(cx, cy, cx + nx * reach, cy + ny * reach, width, height);
}

const isInside = (x, y, width, height) => x >= 0 && y >= 0 && x <= width && y <= height;

/** Groups display cells by model cell, as a CSR list (see buildNeighbours). */
function buildChildren(parentOf, modelCount) {
    const start = new Int32Array(modelCount + 1);
    for (const parent of parentOf) start[parent + 1]++;
    for (let model = 0; model < modelCount; model++) start[model + 1] += start[model];
    const list = new Int32Array(parentOf.length);
    const fill = start.slice(0, modelCount);
    for (let cell = 0; cell < parentOf.length; cell++) list[fill[parentOf[cell]]++] = cell;
    return { start, list };
}

/**
 * The built mesh. Cells are indexed 0 to cellCount - 1; model cells 0 to modelCount - 1 (model
 * cell m's site is display site m).
 */
export class Mesh {
    #voronoi = null;
    #cellRaster = null;
    #children;

    /**
     * @param {object} params
     * @param {number} params.width - Map width in pixels.
     * @param {number} params.height - Map height in pixels.
     * @param {number} params.spacing - Display spacing in pixels.
     * @param {number} params.modelSpacing - Model spacing in pixels.
     * @param {number} params.seed
     * @param {number} [params.kmPerPx] - Effective km per pixel (for claims and route costs).
     * @param {MeshData|null} [prebuilt] - Sites, triangulation and optionally the cell raster of
     *     exactly these parameters, made elsewhere (a worker, or the raster cache; see
     *     buildMeshData). The mesh then skips sampling and Delaunay, which are its costliest steps.
     *     Nothing checks that they match the parameters: pass only what buildMeshData produced
     *     from the same ones.
     */
    constructor({ width, height, spacing, modelSpacing, seed, kmPerPx = 1 }, prebuilt = null) {
        this.width = width;
        this.height = height;
        this.spacing = spacing;
        this.modelSpacing = modelSpacing;
        this.seed = seed;
        this.kmPerPx = kmPerPx;

        const { sites, modelCount } = prebuilt ?? generateSites({ width, height, spacing, modelSpacing, seed });
        this.sites = sites;
        this.cellCount = sites.length / 2;
        this.modelCount = modelCount;

        this.delaunay = prebuilt ? delaunayFromTriangulation(sites, prebuilt) : new Delaunay(sites);
        if (prebuilt?.cellRaster) this.adoptCellRaster(prebuilt.cellRaster);
        this.triangles = this.delaunay.triangles;
        this.halfedges = this.delaunay.halfedges;

        const neighbours = buildNeighbours(this);
        this.neighbourStart = neighbours.start;
        this.neighbourList = neighbours.list;
        // 1 for each half-edge whose two cells meet inside the map (see sharesEdgeInside)
        this.edgeInside = neighbours.inside;

        this.modelDelaunay = new Delaunay(sites.subarray(0, 2 * modelCount));
        this.parentOf = this.#nearestModelSites();
        this.#children = buildChildren(this.parentOf, modelCount);
    }

    /** The neighbours of a cell (a view into a shared array: do not modify). */
    neighbours(cell) {
        return this.neighbourList.subarray(this.neighbourStart[cell], this.neighbourStart[cell + 1]);
    }

    /** The display cells making up a model cell (a view into a shared array: do not modify). */
    childrenOf(modelCell) {
        return this.#children.list.subarray(this.#children.start[modelCell], this.#children.start[modelCell + 1]);
    }

    siteX(cell) {
        return this.sites[2 * cell];
    }

    siteY(cell) {
        return this.sites[2 * cell + 1];
    }

    /** Distance between two cells' sites, in pixels. */
    distance(a, b) {
        const dx = this.sites[2 * a] - this.sites[2 * b];
        const dy = this.sites[2 * a + 1] - this.sites[2 * b + 1];
        return Math.sqrt(dx * dx + dy * dy);
    }

    /**
     * The cell containing a point (the nearest site). `hint`, a cell near the point, makes the
     * search start there; a walk from a nearby cell is far faster than from cell 0.
     */
    cellAt(x, y, hint = 0) {
        return this.delaunay.find(x, y, hint);
    }

    /** The Voronoi diagram, clipped to the map, built on first use. */
    get voronoi() {
        this.#voronoi ??= this.delaunay.voronoi([0, 0, this.width, this.height]);
        return this.#voronoi;
    }

    /** A cell's polygon, clipped to the map: [[x, y], ...] closed (first point repeated). */
    cellPolygon(cell) {
        return this.voronoi.cellPolygon(cell);
    }

    /**
     * The cell under every pixel's centre, row by row (Int32Array of width x height). Built once
     * and cached. Each lookup starts from the previous pixel's cell (the one above, at the start
     * of a row), so the walk is a step or two and the whole raster costs about a second on a
     * 2000 x 1600 map.
     */
    get cellRaster() {
        this.#cellRaster ??= this.#buildCellRaster();
        return this.#cellRaster;
    }

    /** True when the cell raster has been built (it is the one large derived array). */
    get hasCellRaster() {
        return this.#cellRaster !== null;
    }

    /**
     * Uses a cell raster made elsewhere (by buildMeshData, in a worker or from the cache) instead
     * of building one. It must be the raster of this mesh: width x height cell ids.
     * @param {Int32Array} raster
     */
    adoptCellRaster(raster) {
        if (raster.length !== this.width * this.height) throw new Error(`A cell raster of ${raster.length} pixels does not fit a ${this.width} x ${this.height} map.`);
        this.#cellRaster = raster;
    }

    #buildCellRaster() {
        const raster = new Int32Array(this.width * this.height);
        rasteriseRows(this.delaunay, this.width, raster, 0, this.height);
        return raster;
    }

    /**
     * For every display cell, the model site nearest its own site. Cells are visited breadth
     * first over the display mesh and each search starts from the answer for the cell it was
     * reached from, which is the same model site or one next to it. Visiting them in site order
     * instead makes every search walk across the map, since Bridson places consecutive sites far
     * apart.
     */
    #nearestModelSites() {
        const parentOf = new Int32Array(this.cellCount).fill(-1);
        const queue = new Int32Array(this.cellCount);
        let head = 0;
        let tail = 0;
        for (let seed = 0; seed < this.cellCount; seed++) {
            if (parentOf[seed] >= 0) continue;
            parentOf[seed] = this.modelDelaunay.find(this.siteX(seed), this.siteY(seed), 0);
            queue[tail++] = seed;
            while (head < tail) {
                const cell = queue[head++];
                for (const next of this.neighbours(cell)) {
                    if (parentOf[next] >= 0) continue;
                    parentOf[next] = this.modelDelaunay.find(this.siteX(next), this.siteY(next), parentOf[cell]);
                    queue[tail++] = next;
                }
            }
        }
        return parentOf;
    }

    /**
     * Per-cell summaries of the map's terrain buffers, read through the cell raster.
     *
     * A pixel is land when it is at or above sea level and not lake; a cell is land when more than
     * half its pixels are. A pixel counts as river when the river map marks it, or, if an upstream
     * length raster is given instead, when that length reaches riverKmThreshold.
     *
     * @param {object} buffers
     * @param {Float32Array} buffers.elevation - Height per pixel (0 to 1).
     * @param {number} buffers.seaLevel
     * @param {Float32Array} [buffers.waterMask] - Above 0 where a pixel is lake.
     * @param {Uint8Array} [buffers.riverMap] - Above 0 where a pixel is river.
     * @param {Float32Array} [buffers.riverKm] - Upstream river length per pixel (effective km).
     * @param {number} [buffers.riverKmThreshold]
     * @returns {CellAggregates}
     */
    aggregate(buffers) {
        return aggregateCells(this, buffers);
    }
}

/**
 * @typedef {object} CellAggregates
 * @property {Int32Array} count - Pixels per cell.
 * @property {Int32Array} landCount
 * @property {Int32Array} riverCount
 * @property {Float32Array} meanElevation - Mean height of all the cell's pixels (0 to 1).
 * @property {Float32Array} landFraction
 * @property {Uint8Array} land - 1 for a land cell.
 * @property {number} seaLevel
 */

function aggregateCells(mesh, buffers) {
    const sums = accumulateRows(mesh, buffers, 0, mesh.height);
    return finishAggregates(mesh, buffers, sums);
}

/**
 * Pixel sums per cell over rows rowStart to rowEnd (exclusive): pixel count, land count, river
 * count and summed elevation. Arrays are full size; cells with no pixel in the rows stay 0.
 * Shared by the whole-map aggregates and the bounded refresh of a band (see MeshSession).
 */
export function accumulateRows(mesh, { elevation, seaLevel, waterMask = null, riverMap = null, riverKm = null, riverKmThreshold = FILRODENSWMB.MESH.RELAX.RIVER_KM }, rowStart, rowEnd) {
    const n = mesh.cellCount;
    const raster = mesh.cellRaster;
    const count = new Int32Array(n);
    const landCount = new Int32Array(n);
    const riverCount = new Int32Array(n);
    const elevationSum = new Float64Array(n);
    const isRiver = riverPredicate(riverMap, riverKm, riverKmThreshold);

    const end = rowEnd * mesh.width;
    for (let pixel = rowStart * mesh.width; pixel < end; pixel++) {
        const cell = raster[pixel];
        const height = elevation[pixel];
        count[cell]++;
        elevationSum[cell] += height;
        if (height >= seaLevel && !(waterMask && waterMask[pixel] > 0)) landCount[cell]++;
        if (isRiver(pixel)) riverCount[cell]++;
    }
    return { count, landCount, riverCount, elevationSum };
}

/**
 * Turns pixel sums into the per-cell aggregates. With `cells`, only those cells are finished
 * (into `into`, the aggregates being updated); otherwise every cell, into new arrays.
 */
export function finishAggregates(mesh, { elevation, seaLevel, waterMask = null }, sums, cells = null, into = null) {
    const n = mesh.cellCount;
    const out = into ?? { count: sums.count, landCount: sums.landCount, riverCount: sums.riverCount, meanElevation: new Float32Array(n), landFraction: new Float32Array(n), land: new Uint8Array(n), seaLevel };
    const finish = (cell) => {
        // A cell too thin to hold a pixel centre takes its site's pixel
        if (sums.count[cell] === 0) fillFromSite(mesh, cell, { elevation, seaLevel, waterMask }, sums);
        out.count[cell] = sums.count[cell];
        out.landCount[cell] = sums.landCount[cell];
        out.riverCount[cell] = sums.riverCount[cell];
        out.meanElevation[cell] = sums.elevationSum[cell] / sums.count[cell];
        out.landFraction[cell] = sums.landCount[cell] / sums.count[cell];
        out.land[cell] = sums.landCount[cell] * 2 > sums.count[cell] ? 1 : 0;
    };
    if (cells) for (const cell of cells) finish(cell);
    else for (let cell = 0; cell < n; cell++) finish(cell);
    out.seaLevel = seaLevel;
    return out;
}

function riverPredicate(riverMap, riverKm, threshold) {
    if (riverMap) return (pixel) => riverMap[pixel] > 0;
    if (riverKm) return (pixel) => riverKm[pixel] >= threshold;
    return () => false;
}

function fillFromSite(mesh, cell, { elevation, seaLevel, waterMask }, sums) {
    const x = Math.min(mesh.width - 1, Math.floor(mesh.siteX(cell)));
    const y = Math.min(mesh.height - 1, Math.floor(mesh.siteY(cell)));
    const pixel = y * mesh.width + x;
    sums.count[cell] = 1;
    sums.elevationSum[cell] = elevation[pixel];
    sums.landCount[cell] = elevation[pixel] >= seaLevel && !(waterMask && waterMask[pixel] > 0) ? 1 : 0;
}

/**
 * Writes the cell under each pixel centre of rows rowStart to rowEnd (exclusive) into `raster`.
 * Each lookup starts from the previous pixel's cell, or the cell above at the start of a row, so
 * the walk is a step or two; a band continues from the row before it, so splitting the raster into
 * bands gives exactly the raster built in one go.
 */
function rasteriseRows(delaunay, width, raster, rowStart, rowEnd) {
    let hint = rowStart > 0 ? raster[(rowStart - 1) * width] : 0;
    for (let y = rowStart; y < rowEnd; y++) {
        const row = y * width;
        if (y > 0) hint = raster[row - width];
        for (let x = 0; x < width; x++) {
            hint = delaunay.find(x + PIXEL_CENTRE, y + PIXEL_CENTRE, hint);
            raster[row + x] = hint;
        }
    }
}

/**
 * A Delaunay object for sites whose triangulation was computed elsewhere, so it need not be
 * computed again. Sets exactly the fields d3-delaunay's own constructor and _init set (points,
 * triangles, halfedges, hull, inedges and the hull index) by the same rules, which is all that
 * find, neighbors and voronoi read.
 *
 * d3-delaunay replaces a collinear set of sites with jittered ones; a mesh's sites are a
 * Poisson-disc fill and never collinear, and a triangulation that came from one is refused rather
 * than reproduced, since its triangles would not match these sites.
 *
 * @param {Float64Array} sites
 * @param {{triangles: Uint32Array|Int32Array, halfedges: Int32Array, hull: Uint32Array|Int32Array}} triangulation
 * @returns {Delaunay}
 */
export function delaunayFromTriangulation(sites, { triangles, halfedges, hull }) {
    if (hull.length <= 2) throw new Error("A prebuilt triangulation needs at least three hull sites.");
    const delaunay = Object.create(Delaunay.prototype);
    const count = sites.length / 2;
    delaunay.points = sites;
    delaunay.triangles = triangles;
    delaunay.halfedges = halfedges;
    delaunay.hull = hull;
    delaunay.inedges = new Int32Array(count).fill(-1);
    delaunay._hullIndex = new Int32Array(count).fill(-1);
    for (let edge = 0; edge < halfedges.length; edge++) {
        const site = triangles[nextHalfedge(edge)];
        if (halfedges[edge] === -1 || delaunay.inedges[site] === -1) delaunay.inedges[site] = edge;
    }
    for (let i = 0; i < hull.length; i++) delaunay._hullIndex[hull[i]] = i;
    return delaunay;
}

/**
 * @typedef {object} MeshData
 * @property {Float64Array} sites
 * @property {number} modelCount
 * @property {Uint32Array|Int32Array} triangles
 * @property {Int32Array} halfedges
 * @property {Uint32Array|Int32Array} hull
 * @property {Int32Array} [cellRaster]
 */

/** Rows of the cell raster built between progress reports (and chances to cancel). */
const RASTER_ROWS_PER_STEP = 64;

/** Share of a build's progress each stage reaches when it ends. */
const BUILD_PROGRESS = Object.freeze({ SITES: 30, TRIANGULATION: 40, RASTER: 100 });

/** Raised by buildMeshData when it is cancelled. */
export class MeshBuildCancelled extends Error {
    constructor() {
        super("The mesh build was cancelled.");
        this.name = "MeshBuildCancelled";
    }
}

/**
 * Builds what a Mesh needs from its parameters: the sites, their triangulation and the cell
 * raster. This is the slow part of a mesh (about a third of a second on a 2000 x 1600 map, a
 * second at 4000 x 3200) and touches nothing but its inputs, so it can run in a worker; the main
 * thread then builds the Mesh from the result (new Mesh(params, data)) without repeating it.
 *
 * Between stages, and every RASTER_ROWS_PER_STEP rows of the raster, it reports progress and
 * awaits `pause`, which is where a worker lets a cancel message in; when `isCancelled` then
 * answers true it stops with MeshBuildCancelled. The arithmetic is the same however often it
 * pauses, so the result is the same bit for bit wherever and however it runs.
 *
 * @param {object} params - Mesh constructor parameters (see Mesh).
 * @param {object} [options]
 * @param {function({stage: string, pct: number}): void} [options.onProgress]
 * @param {function(): boolean} [options.isCancelled]
 * @param {function(): Promise<void>} [options.pause] - Default: resolves at once.
 * @returns {Promise<MeshData>}
 */
export async function buildMeshData(params, { onProgress = null, isCancelled = () => false, pause = () => Promise.resolve() } = {}) {
    const checkpoint = async (stage, pct) => {
        onProgress?.({ stage, pct });
        await pause();
        if (isCancelled()) throw new MeshBuildCancelled();
    };
    await checkpoint("sites", 0);
    const { sites, modelCount } = generateSites(params);
    await checkpoint("triangulation", BUILD_PROGRESS.SITES);
    const delaunay = new Delaunay(sites);
    await checkpoint("raster", BUILD_PROGRESS.TRIANGULATION);

    const { width, height } = params;
    const cellRaster = new Int32Array(width * height);
    const rasterShare = BUILD_PROGRESS.RASTER - BUILD_PROGRESS.TRIANGULATION;
    for (let row = 0; row < height; row += RASTER_ROWS_PER_STEP) {
        rasteriseRows(delaunay, width, cellRaster, row, Math.min(height, row + RASTER_ROWS_PER_STEP));
        await checkpoint("raster", BUILD_PROGRESS.TRIANGULATION + Math.round((rasterShare * Math.min(height, row + RASTER_ROWS_PER_STEP)) / height));
    }
    return { sites, modelCount, triangles: delaunay.triangles, halfedges: delaunay.halfedges, hull: delaunay.hull, cellRaster };
}

/**
 * Builds the meshes and works out their parameters from a map.
 */
export class MeshBuilder {
    /**
     * Builds the mesh described by a map's stored mesh block (or a fresh block if it has none).
     * @param {object} mapData - Needs mapWidth, mapHeight; uses mesh, seed and params.latTop/latBottom.
     * @returns {Mesh}
     */
    static fromMapData(mapData) {
        return new Mesh(MeshBuilder.paramsFor(mapData));
    }

    /**
     * The constructor parameters of a map's mesh.
     * @param {object} mapData
     */
    static paramsFor(mapData) {
        const block = mapData.mesh ?? createMeshBlock(mapData);
        const kmPerPx = effectiveKmPerPx(mapData);
        return {
            width: mapData.mapWidth,
            height: mapData.mapHeight,
            spacing: block.spacing,
            // A block made before the pixel spacing was stored works it out from km, which is
            // what it was made with (see Schema.createMeshBlock)
            modelSpacing: block.modelSpacingPx ?? block.modelSpacingKm / kmPerPx,
            seed: block.seed,
            kmPerPx,
        };
    }

    /**
     * The cell raster as RGBA8 bytes for a GPU texture: each pixel's 32-bit cell id, little-endian,
     * in R, G, B, A (a shader rebuilds it as r + g x 256 + b x 65536; A is 0 below 16.7 M cells).
     * This is a view of the same memory, not a copy. Every platform the module runs on is
     * little-endian, which is what makes the byte order fixed.
     * @param {Int32Array} raster
     * @returns {Uint8Array}
     */
    static packCellRaster(raster) {
        return new Uint8Array(raster.buffer, raster.byteOffset, raster.byteLength);
    }
}
