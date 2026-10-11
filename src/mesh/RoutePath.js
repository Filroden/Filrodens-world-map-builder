import { FILRODENSWMB } from "../config.js";
import { chaikin } from "./BorderArcs.js";
import { MinHeap } from "./MinHeap.js";

/**
 * Routes on the display mesh. A route is a list of waypoint cells; each leg between consecutive
 * waypoints is a chain of neighbouring cells found in one of three modes:
 *
 * - "terrain": the least-cost path under a cost function (by default distance, made dearer by
 *   climbing and by water; the generator can supply its own travel cost instead).
 * - "direct": the cells the straight line between the two waypoints passes through.
 * - "trace": the cells a line the user drew passes through.
 *
 * Legs include both of their waypoints, so consecutive legs share their junction cell, and two
 * routes through the same waypoint share that exact cell. The drawn line runs through the cells'
 * sites, optionally smoothed with the same corner cutting the borders use.
 */

export const ROUTE_MODE = Object.freeze({ TERRAIN: "terrain", DIRECT: "direct", TRACE: "trace" });

/** Points per spacing when a drawn line is walked to find the cells it crosses. */
const TRACE_SAMPLES_PER_SPACING = 4;

// ------------------------------------------------------------------ costs

/**
 * The default cost of a step between neighbouring cells: the distance between their sites,
 * x (1 + metres climbed or descended / RELIEF_M_PER_STEP), x WATER_STEP when either cell is
 * water. Water is allowed but dear, so a land route goes round a lake rather than across it while
 * a route between two islands still exists.
 *
 * @param {import("./MeshBuilder.js").Mesh} mesh
 * @param {import("./MeshBuilder.js").CellAggregates} aggregates
 * @param {object} [settings] - Overrides of config MESH.ROUTE_COST.
 * @returns {function(number, number): number}
 */
export function terrainCost(mesh, aggregates, settings = {}) {
    const { RELIEF_M_PER_STEP, WATER_STEP } = { ...FILRODENSWMB.MESH.ROUTE_COST, ...settings };
    const metresPerUnit = FILRODENSWMB.MESH.METRES_PER_UNIT;
    const { meanElevation, land } = aggregates;
    return (a, b) => {
        const climbMetres = Math.abs(meanElevation[a] - meanElevation[b]) * metresPerUnit;
        const water = land[a] && land[b] ? 1 : WATER_STEP;
        return mesh.distance(a, b) * (1 + climbMetres / RELIEF_M_PER_STEP) * water;
    };
}

/** The plain distance between sites. */
export function distanceCost(mesh) {
    return (a, b) => mesh.distance(a, b);
}

// ------------------------------------------------------------------ search

/**
 * Least-cost distance field from one cell (Dijkstra). With a target, the search stops as soon as
 * the target is settled; without one it covers every reachable cell (for a live preview of every
 * possible end point).
 *
 * @param {import("./MeshBuilder.js").Mesh} mesh
 * @param {function(number, number): number} cost - Cost of the step from a cell to a neighbour (non-negative).
 * @param {number} start
 * @param {object} [options]
 * @param {number} [options.target]
 * @param {number} [options.limit] - Cells costlier than this are not reached.
 * @param {function(number): boolean} [options.passable] - Cells the search may enter.
 * @returns {{dist: Float64Array, prev: Int32Array}} dist is Infinity, and prev -1, where not reached.
 */
export function distanceField(mesh, cost, start, { target = -1, limit = Infinity, passable = null } = {}) {
    const dist = new Float64Array(mesh.cellCount).fill(Infinity);
    const prev = new Int32Array(mesh.cellCount).fill(-1);
    const heap = new MinHeap();
    dist[start] = 0;
    heap.push(0, start);
    while (heap.size) {
        const cell = heap.pop();
        const reached = heap.lastPriority;
        if (reached > dist[cell]) continue;
        if (cell === target) break;
        for (const next of mesh.neighbours(cell)) {
            if (passable && !passable(next)) continue;
            const total = reached + cost(cell, next);
            if (total >= dist[next] || total > limit) continue;
            dist[next] = total;
            prev[next] = cell;
            heap.push(total, next);
        }
    }
    return { dist, prev };
}

/**
 * The cells from start to target along a distance field's `prev` links, both included.
 * @returns {Int32Array|null} null when the target was not reached.
 */
export function extractPath(prev, start, target) {
    const cells = [target];
    let cell = target;
    while (cell !== start) {
        cell = prev[cell];
        if (cell < 0) return null;
        cells.push(cell);
    }
    return Int32Array.from(cells.reverse());
}

/** Sum of a cost function along a path. */
export function pathCost(path, cost) {
    let total = 0;
    for (let i = 1; i < path.length; i++) total += cost(path[i - 1], path[i]);
    return total;
}

// ------------------------------------------------------------------ geometry helpers

/** Distance from (x, y) to the segment (ax, ay)-(bx, by). */
export function distanceToSegment(x, y, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / lengthSq)) : 0;
    const ex = ax + t * dx - x;
    const ey = ay + t * dy - y;
    return Math.sqrt(ex * ex + ey * ey);
}

/** Distance from (x, y) to a polyline (flat [x0, y0, x1, y1, ...]). */
export function distanceToPolyline(x, y, polyline) {
    if (polyline.length < 4) return Math.hypot(x - polyline[0], y - polyline[1]);
    let best = Infinity;
    for (let i = 0; i + 3 < polyline.length; i += 2) {
        best = Math.min(best, distanceToSegment(x, y, polyline[i], polyline[i + 1], polyline[i + 2], polyline[i + 3]));
    }
    return best;
}

/** Accepts [{x, y}], [[x, y]] or flat arrays. */
export function toFlatPoints(points) {
    if (!points.length || typeof points[0] === "number") return Float64Array.from(points);
    return Float64Array.from(points.flatMap((point) => (Array.isArray(point) ? [point[0], point[1]] : [point.x, point.y])));
}

/**
 * The cells a polyline passes through, in order, each run of the same cell listed once. The line
 * is walked in steps of a quarter spacing, each lookup starting from the last cell found.
 * @param {import("./MeshBuilder.js").Mesh} mesh
 * @param {ArrayLike<number>} polyline - Flat [x0, y0, ...].
 * @returns {Int32Array}
 */
export function cellsAlongPolyline(mesh, polyline) {
    const cells = [];
    const step = mesh.spacing / TRACE_SAMPLES_PER_SPACING;
    let hint = mesh.cellAt(polyline[0], polyline[1]);
    const visit = (x, y) => {
        hint = mesh.cellAt(x, y, hint);
        if (cells.at(-1) !== hint) cells.push(hint);
    };
    visit(polyline[0], polyline[1]);
    for (let i = 0; i + 3 < polyline.length; i += 2) {
        const [ax, ay, bx, by] = [polyline[i], polyline[i + 1], polyline[i + 2], polyline[i + 3]];
        const samples = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
        for (let k = 1; k <= samples; k++) visit(ax + ((bx - ax) * k) / samples, ay + ((by - ay) * k) / samples);
    }
    return Int32Array.from(cells);
}

// ------------------------------------------------------------------ legs

/**
 * A "terrain" leg: the least-cost path.
 * @returns {Int32Array|null} null when the target cannot be reached.
 */
export function legTerrain(mesh, cost, from, to) {
    if (from === to) return Int32Array.of(from);
    const { prev } = distanceField(mesh, cost, from, { target: to });
    return extractPath(prev, from, to);
}

/**
 * The cells a line passes through, as a contiguous path from `from` to `to`.
 *
 * The crossed cells of a line are already a chain of neighbours, except where the line passes
 * so close to a Voronoi vertex that a sample skips a sliver of a cell; such gaps are bridged by the
 * shortest path between the two cells. Wherever the chain comes back to a cell it has already
 * visited (a line that doubles back, or crosses itself), the loop in between is cut out, so a
 * scribble becomes a simple path and no cell appears twice. The waypoints are joined to the ends
 * of the line the same way when the line does not start or end in them.
 *
 * Following the crossed cells exactly, rather than searching a corridor around the line, is what
 * makes a traced or direct leg reproduce the line: a shortest path through a corridor cuts the
 * corners of the zigzag of cells a straight line crosses and drifts to one side of it.
 *
 * @param {import("./MeshBuilder.js").Mesh} mesh
 * @param {ArrayLike<number>|Array} polyline
 * @param {number} from
 * @param {number} to
 * @returns {Int32Array}
 */
export function legAlongLine(mesh, polyline, from, to) {
    const line = toFlatPoints(polyline);
    const path = new SimplePath();
    for (const cell of [from, ...cellsAlongPolyline(mesh, line), to]) {
        const last = path.last;
        if (last === cell) continue;
        if (last >= 0 && !mesh.neighbours(last).includes(cell)) {
            const bridge = legTerrain(mesh, distanceCost(mesh), last, cell);
            for (let i = 1; i < bridge.length; i++) path.add(bridge[i]);
            continue;
        }
        path.add(cell);
    }
    return path.toArray();
}

/** A path that cuts out the loop whenever it returns to a cell it already holds. */
class SimplePath {
    #cells = [];
    #position = new Map();

    get last() {
        return this.#cells.length ? this.#cells[this.#cells.length - 1] : -1;
    }

    add(cell) {
        const earlier = this.#position.get(cell);
        if (earlier === undefined) {
            this.#position.set(cell, this.#cells.length);
            this.#cells.push(cell);
            return;
        }
        for (let i = earlier + 1; i < this.#cells.length; i++) this.#position.delete(this.#cells[i]);
        this.#cells.length = earlier + 1;
    }

    toArray() {
        return Int32Array.from(this.#cells);
    }
}

/**
 * A "direct" leg: the cells the straight segment between the two waypoints' sites passes through.
 * @returns {Int32Array}
 */
export function legDirect(mesh, from, to) {
    return legAlongLine(mesh, [mesh.siteX(from), mesh.siteY(from), mesh.siteX(to), mesh.siteY(to)], from, to);
}

/**
 * A "trace" leg: the cells the drawn line passes through between two waypoints (see legAlongLine).
 * @param {import("./MeshBuilder.js").Mesh} mesh
 * @param {ArrayLike<number>|Array} polyline - The part of the drawn line between the two waypoints.
 * @param {number} from
 * @param {number} to
 * @returns {Int32Array}
 */
export function legTrace(mesh, polyline, from, to) {
    if (from === to) return Int32Array.of(from);
    return legAlongLine(mesh, polyline, from, to);
}

/**
 * One leg in a route's mode.
 * @param {string} mode
 * @param {import("./MeshBuilder.js").Mesh} mesh
 * @param {number} from
 * @param {number} to
 * @param {object} [options]
 * @param {function(number, number): number} [options.cost] - For "terrain" (default: distance).
 * @param {ArrayLike<number>|Array} [options.polyline] - For "trace" (default: straight).
 * @returns {Int32Array|null}
 */
export function computeLeg(mode, mesh, from, to, { cost = null, polyline = null } = {}) {
    if (mode === ROUTE_MODE.DIRECT) return legDirect(mesh, from, to);
    if (mode === ROUTE_MODE.TRACE) return legTrace(mesh, polyline ?? [mesh.siteX(from), mesh.siteY(from), mesh.siteX(to), mesh.siteY(to)], from, to);
    return legTerrain(mesh, cost ?? distanceCost(mesh), from, to);
}

/**
 * All of a route's legs from its waypoints.
 * @param {{mode: string, waypoints: number[]}} route
 * @param {import("./MeshBuilder.js").Mesh} mesh
 * @param {object} [options]
 * @param {function(number, number): number} [options.cost]
 * @param {Array} [options.polylines] - For "trace": the drawn line of each leg.
 * @returns {number[][]} null legs (unreachable) become the two waypoints alone.
 */
export function computeLegs(route, mesh, { cost = null, polylines = [] } = {}) {
    const legs = [];
    for (let k = 0; k + 1 < route.waypoints.length; k++) {
        const [from, to] = [route.waypoints[k], route.waypoints[k + 1]];
        const leg = computeLeg(route.mode, mesh, from, to, { cost, polyline: polylines[k] ?? null });
        legs.push(leg ? Array.from(leg) : [from, to]);
    }
    return legs;
}

/**
 * The cells of a whole route in order, with each junction cell listed once.
 * @param {number[][]} legs
 * @returns {number[]}
 */
export function routeCells(legs) {
    const cells = [];
    for (const leg of legs) for (const cell of leg) if (cells.at(-1) !== cell) cells.push(cell);
    return cells;
}

/**
 * The drawable line of a route: through its cells' sites, corner-cut when smoothing is on.
 * @param {import("./MeshBuilder.js").Mesh} mesh
 * @param {number[][]} legs
 * @param {boolean} [smoothing]
 * @returns {Float64Array} Flat [x0, y0, ...].
 */
export function routePolyline(mesh, legs, smoothing = false) {
    const points = [];
    for (const cell of routeCells(legs)) points.push(mesh.siteX(cell), mesh.siteY(cell));
    return Float64Array.from(smoothing ? chaikin(points, false, FILRODENSWMB.MESH.CHAIKIN_PASSES) : points);
}
