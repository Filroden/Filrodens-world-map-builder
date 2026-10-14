import { FILRODENSWMB } from "../config.js";
import { ROUTE_MODE, computeLeg, distanceField, extractPath, terrainCost } from "./RoutePath.js";
import { createRoute } from "./Schema.js";

/**
 * Making and changing routes by hand: the cost a transport pays for each step, a route being
 * placed waypoint by waypoint with a live preview of its next leg, the waypoints a traced stroke
 * becomes, and the edits to a finished route (moving, inserting and removing waypoints, splitting
 * a route in two, joining two routes, dropping needless waypoints, finding every leg again).
 *
 * Every function here works on route objects in the mesh shape (see Schema.createRoute) and
 * returns new legs rather than drawing anything; the caller records the change for undo. Legs
 * that cannot be found (a road between two islands, say) become the two waypoints alone, as
 * RoutePath.computeLegs does, so a route always stays whole.
 */

/**
 * How a transport may travel (see transportCost). River routes are not offered to be drawn by
 * hand (their cost here is only a preference for river cells, which does not make a line that
 * follows a river); the transport is kept for routes made by the generator.
 */
const PASSABLE = Object.freeze({
    road: (land) => (cell) => land[cell] === 1,
    sea: (land) => (cell) => land[cell] !== 1,
    river: () => null,
});

/**
 * The cost of a step for a transport, and where it may go: a road keeps to land, a sea route to
 * water, and a river route follows river cells and water, paying RIVER_LAND_STEP for a step over
 * land that has no river. A step along an existing route of the same transport (other than the
 * route being edited) costs SHARED_STEP of its usual cost, so new routes join the network.
 *
 * A road allowed to span water keeps its waypoints on land (`passable`) but may step over water
 * between them at SPAN_WATER_STEP times the usual cost, so it bridges a strait only when going
 * round would cost more, and only over water within half of SPAN_WATER_MAX_CELLS of a shore
 * (`stepPassable`), so it cannot bridge water wider than about that many cells.
 *
 * @param {import("./MeshSession.js").MeshSession} session
 * @param {string} transport - road, river or sea.
 * @param {Array} routes - The map's routes, whose cells existing routes are read from.
 * @param {string|null} [excludeRouteId] - The route being edited, whose own cells do not count.
 * @param {object} [options]
 * @param {boolean} [options.spanWater] - Whether a road may cross water between its waypoints.
 * @returns {{cost: function(number, number): number, passable: (function(number): boolean)|null, stepPassable: (function(number): boolean)|null}}
 *     `passable` is where a waypoint may be; `stepPassable` where a leg may go.
 */
export function transportCost(session, transport, routes, excludeRouteId = null, { spanWater = false } = {}) {
    const { mesh, aggregates } = session;
    const base = aggregates ? terrainCost(mesh, aggregates) : (a, b) => mesh.distance(a, b);
    const land = aggregates?.land;
    const river = aggregates?.riverCount;
    const shared = sharedCells(routes, transport, excludeRouteId);
    const { SHARED_STEP, RIVER_LAND_STEP, SPAN_WATER_STEP, SPAN_WATER_MAX_CELLS } = FILRODENSWMB.MESH.ROUTE;
    const onRiver = (cell) => !land || land[cell] !== 1 || (river && river[cell] > 0);
    const spanning = spanWater && transport === "road" && land;
    const shore = spanning ? session.shoreDistance() : null;
    const reach = SPAN_WATER_MAX_CELLS / 2;
    const cost = (a, b) => {
        let step = base(a, b);
        if (transport === "river" && !onRiver(b)) step *= RIVER_LAND_STEP;
        if (spanning && land[b] !== 1) step *= SPAN_WATER_STEP;
        if (shared.has(a) && shared.has(b)) step *= SHARED_STEP;
        return step;
    };
    const passable = land ? (PASSABLE[transport] ?? PASSABLE.road)(land) : null;
    const stepPassable = spanning ? (cell) => shore[cell] >= 0 && shore[cell] <= reach : passable;
    return { cost, passable, stepPassable };
}

/** The cells of every route of a transport, other than one route's. */
function sharedCells(routes, transport, excludeRouteId) {
    const cells = new Set();
    for (const route of routes ?? []) {
        if (route.id === excludeRouteId || route.transport !== transport) continue;
        for (const leg of route.legs ?? []) for (const cell of leg) cells.add(cell);
    }
    return cells;
}

/**
 * One leg between two waypoints in a mode, for a transport (see transportCost): the least-cost
 * path for "terrain", the straight line's cells for "direct", a drawn line's cells for "trace".
 * @returns {number[]|null} null when no path exists (a terrain leg to a waypoint the transport
 *     cannot reach, or across water it cannot bridge).
 */
export function tryLeg(session, routes, route, from, to, { mode = route.mode, polyline = null } = {}) {
    if (mode === ROUTE_MODE.TERRAIN) {
        const { cost, passable, stepPassable } = transportCost(session, route.transport, routes, route.id, { spanWater: route.spanWater });
        if (passable && !(passable(from) && passable(to))) return null;
        const { prev } = distanceField(session.mesh, cost, from, { target: to, passable: stepPassable });
        const path = extractPath(prev, from, to);
        return path ? Array.from(path) : null;
    }
    const leg = computeLeg(mode, session.mesh, from, to, { polyline });
    return leg ? Array.from(leg) : null;
}

/**
 * As tryLeg, for callers that must keep a route whole (re-pathing, removing a waypoint, joining
 * two routes): a leg that cannot be found is the two waypoints alone, drawn straight.
 * @returns {number[]}
 */
export function findLeg(session, routes, route, from, to, options = {}) {
    return tryLeg(session, routes, route, from, to, options) ?? [from, to];
}

// ------------------------------------------------------------------ placing a route

/**
 * A route being placed: waypoints are added one by one, each joined to the one before by a leg in
 * the route's mode, and the leg from the last waypoint to any cell can be previewed as the
 * pointer moves. For a terrain route the preview reads a distance field from the last waypoint,
 * worked out once per waypoint, so each preview is a walk back along its links rather than a
 * search.
 */
export class RouteDraft {
    #session;
    #routes;
    #route;
    #field = null;

    /**
     * @param {import("./MeshSession.js").MeshSession} session
     * @param {Array} routes - The map's routes (for the shared-step cost).
     * @param {object} fields - The new route's fields (see Schema.createRoute): style, mode, transport.
     * @param {Function} [idFactory]
     */
    constructor(session, routes, fields, idFactory = undefined) {
        this.#session = session;
        this.#routes = routes;
        this.#route = createRoute({ ...fields, waypoints: [], legs: [] }, idFactory);
    }

    /** The route so far (its waypoints and legs). */
    get route() {
        return this.#route;
    }

    /** The last waypoint placed, or -1. */
    get last() {
        return this.#route.waypoints.at(-1) ?? -1;
    }

    /** Whether the route can be finished: two waypoints or more. */
    get canFinish() {
        return this.#route.waypoints.length >= 2;
    }

    /**
     * Adds a waypoint at a cell, with the leg from the one before. A cell that is the last
     * waypoint, that the transport cannot reach, or that no leg can be found to (across water a
     * road cannot bridge, say) adds nothing: a route being drawn never gains a leg it cannot
     * really follow.
     * @returns {boolean} Whether the waypoint was added.
     */
    add(cell) {
        if (cell < 0 || cell === this.last) return false;
        if (!this.#reachable(cell)) return false;
        const previous = this.last;
        const leg = previous >= 0 ? this.#legTo(cell) : null;
        if (previous >= 0 && !leg) return false;
        if (leg) this.#route.legs.push(leg);
        this.#route.waypoints.push(cell);
        this.#field = null;
        return true;
    }

    /** Takes the last waypoint back (and the leg to it). */
    undoLast() {
        if (!this.#route.waypoints.length) return;
        this.#route.waypoints.pop();
        this.#route.legs.pop();
        this.#field = null;
    }

    /**
     * The leg the next click would add, from the last waypoint to a cell, or null when there is
     * no last waypoint, the cell is the last waypoint, or the transport cannot reach it.
     * @returns {number[]|null}
     */
    preview(cell) {
        if (this.last < 0 || cell < 0 || cell === this.last || !this.#reachable(cell)) return null;
        return this.#legTo(cell);
    }

    /** Finishes the route: it is returned with its legs, or null when it has fewer than two waypoints. */
    finish() {
        return this.canFinish ? this.#route : null;
    }

    #reachable(cell) {
        const { passable } = this.#costAndPassable();
        return !passable || passable(cell);
    }

    /** The leg from the last waypoint to a cell, or null when none can be found. */
    #legTo(cell) {
        const from = this.last;
        if (this.#route.mode !== ROUTE_MODE.TERRAIN) return tryLeg(this.#session, this.#routes, this.#route, from, cell);
        const field = this.#distanceField(from);
        const path = extractPath(field.prev, from, cell);
        return path ? Array.from(path) : null;
    }

    #costAndPassable() {
        return transportCost(this.#session, this.#route.transport, this.#routes, this.#route.id, { spanWater: this.#route.spanWater });
    }

    #distanceField(from) {
        if (this.#field?.from !== from) {
            const { cost, stepPassable } = this.#costAndPassable();
            this.#field = { from, ...distanceField(this.#session.mesh, cost, from, { passable: stepPassable }) };
        }
        return this.#field;
    }
}

// ------------------------------------------------------------------ strokes and simplifying

/**
 * The points of a flat polyline that keep its shape within a tolerance (Ramer-Douglas-Peucker):
 * the ends always, and between them every point that lies further than the tolerance from the
 * straight line between the points kept on either side of it. Points closer than that to the line
 * are left out, so a tolerance of 0 keeps every bend and a large one keeps only the ends.
 * @param {ArrayLike<number>} points - Flat [x0, y0, x1, y1, ...].
 * @param {number} tolerance - In the points' own units.
 * @returns {number[]} The kept points' indices (0 for the first point), in order.
 */
export function simplifyPolyline(points, tolerance) {
    const count = points.length >> 1;
    if (count < 3) return count ? [...Array(count).keys()] : [];
    const keep = new Uint8Array(count);
    keep[0] = keep[count - 1] = 1;
    const stack = [[0, count - 1]];
    while (stack.length) {
        const [first, last] = stack.pop();
        const furthest = furthestFromChord(points, first, last);
        if (furthest.distance <= tolerance) continue;
        keep[furthest.index] = 1;
        stack.push([first, furthest.index], [furthest.index, last]);
    }
    const kept = [];
    for (let i = 0; i < count; i++) if (keep[i]) kept.push(i);
    return kept;
}

/** The point between two of a flat polyline that lies furthest from the line between them. */
function furthestFromChord(points, first, last) {
    const [ax, ay] = [points[first * 2], points[first * 2 + 1]];
    const [bx, by] = [points[last * 2], points[last * 2 + 1]];
    const [dx, dy] = [bx - ax, by - ay];
    const length = Math.hypot(dx, dy);
    let best = { index: first, distance: -1 };
    for (let i = first + 1; i < last; i++) {
        const [px, py] = [points[i * 2] - ax, points[i * 2 + 1] - ay];
        // The perpendicular distance to the chord, or the distance to the point when the chord has no length
        const distance = length ? Math.abs(px * dy - py * dx) / length : Math.hypot(px, py);
        if (distance > best.distance) best = { index: i, distance };
    }
    return best;
}

/**
 * The indices that break a flat polyline's kept runs so that no run between two kept points is
 * longer (along the polyline) than `maxGap`: each run over the limit gains points spread evenly
 * along it. A long straight stroke has no bends to keep, yet a route found freely between its two
 * ends could wander far from it; the extra points keep the route near the stroke.
 * @param {ArrayLike<number>} points - Flat [x0, y0, ...].
 * @param {number[]} kept - Kept indices, ascending (see simplifyPolyline).
 * @param {number} maxGap - In the points' own units; 0 or less adds nothing.
 * @returns {number[]} Indices, ascending, kept ones included.
 */
export function fillGaps(points, kept, maxGap) {
    if (!(maxGap > 0) || kept.length < 2) return kept;
    const result = [kept[0]];
    for (let k = 1; k < kept.length; k++) {
        const [first, last] = [kept[k - 1], kept[k]];
        const lengths = runLengths(points, first, last);
        const runLength = lengths.at(-1);
        const pieces = Math.ceil(runLength / maxGap);
        let next = 1;
        for (let i = first + 1; i < last && next < pieces; i++) {
            if (lengths[i - first] < (runLength * next) / pieces) continue;
            result.push(i);
            next++;
        }
        result.push(last);
    }
    return result;
}

/** The distance along a flat polyline from point `first` to each point up to `last` (index 0 is 0). */
function runLengths(points, first, last) {
    const lengths = [0];
    for (let i = first + 1; i <= last; i++) {
        lengths.push(lengths.at(-1) + Math.hypot(points[i * 2] - points[i * 2 - 2], points[i * 2 + 1] - points[i * 2 - 1]));
    }
    return lengths;
}

/**
 * The waypoints a traced stroke becomes: the cells at the stroke's bends (see simplifyPolyline),
 * with more along any long run between bends (see fillGaps), each cell once in a row. Nothing of
 * the stroke itself is kept: the route is made of these waypoints and the legs found between them
 * like any other.
 * @param {import("./MeshSession.js").MeshSession} session
 * @param {ArrayLike<number>} stroke - Flat [x0, y0, ...] map points.
 * @param {number} tolerancePx - How far the stroke may stray from the line between two kept bends, in map pixels.
 * @param {number} [maxGapPx] - The longest run of stroke between two waypoints, in map pixels (none by default).
 * @returns {number[]} Cells, in stroke order.
 */
export function strokeWaypoints(session, stroke, tolerancePx, maxGapPx = 0) {
    const cells = [];
    for (const index of fillGaps(stroke, simplifyPolyline(stroke, tolerancePx), maxGapPx)) {
        const cell = session.cellAt(stroke[index * 2], stroke[index * 2 + 1]);
        if (cell >= 0 && cell !== cells.at(-1)) cells.push(cell);
    }
    return cells;
}

/**
 * Drops the waypoints of a route that barely bend the line through its waypoints (those within
 * the tolerance of the line between their kept neighbours, see simplifyPolyline) and finds the
 * legs between the waypoints left again. The ends always stay.
 * @param {import("./MeshSession.js").MeshSession} session
 * @param {Array} routes - The map's routes (see transportCost).
 * @param {object} route
 * @param {number} tolerancePx - In map pixels.
 * @returns {boolean} Whether any waypoint was dropped.
 */
export function simplifyRoute(session, routes, route, tolerancePx) {
    const { mesh } = session;
    const sites = route.waypoints.flatMap((cell) => [mesh.siteX(cell), mesh.siteY(cell)]);
    const kept = simplifyPolyline(sites, tolerancePx);
    if (kept.length === route.waypoints.length) return false;
    route.waypoints = kept.map((index) => route.waypoints[index]);
    repathRoute(session, routes, route);
    return true;
}

// ------------------------------------------------------------------ editing a route

/**
 * Moves a waypoint to a cell and finds the leg on each side of it again in the route's mode. The
 * first and last waypoints have one leg. A cell from which a leg cannot be found (across water
 * the road cannot bridge, say) is refused.
 * @returns {boolean} Whether anything changed.
 */
export function moveWaypoint(session, routes, route, index, cell) {
    if (cell < 0 || route.waypoints[index] === undefined || route.waypoints[index] === cell) return false;
    const waypoints = route.waypoints.slice();
    waypoints[index] = cell;
    const legs = route.legs.slice();
    // A move that would leave a leg with no way to follow is refused, so the waypoint stays put
    if (index > 0) legs[index - 1] = tryLeg(session, routes, route, waypoints[index - 1], cell);
    if (index < waypoints.length - 1) legs[index] = tryLeg(session, routes, route, cell, waypoints[index + 1]);
    if (legs.some((leg) => !leg)) return false;
    route.waypoints = waypoints;
    route.legs = legs;
    return true;
}

/**
 * Makes a cell of a leg a waypoint, splitting the leg's cells there without finding either half
 * again, so the route keeps its line and gains a handle on it.
 * @param {number} legIndex
 * @param {number} cell - A cell of that leg (other than its ends).
 * @returns {number} The new waypoint's index, or -1 when the cell is not inside the leg.
 */
export function insertWaypoint(route, legIndex, cell) {
    const leg = route.legs[legIndex];
    const at = leg ? leg.indexOf(cell) : -1;
    if (at <= 0 || at >= leg.length - 1) return -1;
    const waypoints = route.waypoints.slice();
    waypoints.splice(legIndex + 1, 0, cell);
    const legs = route.legs.slice();
    legs.splice(legIndex, 1, leg.slice(0, at + 1), leg.slice(at));
    route.waypoints = waypoints;
    route.legs = legs;
    return legIndex + 1;
}

/**
 * Removes a waypoint. An inner waypoint's two legs become one, found again between its
 * neighbours; an end waypoint takes its one leg with it. A route keeps at least two waypoints.
 * @returns {boolean} Whether the waypoint was removed.
 */
export function removeWaypoint(session, routes, route, index) {
    if (route.waypoints.length <= 2 || route.waypoints[index] === undefined) return false;
    const waypoints = route.waypoints.slice();
    const legs = route.legs.slice();
    waypoints.splice(index, 1);
    if (index === 0) legs.shift();
    else if (index === route.waypoints.length - 1) legs.pop();
    else legs.splice(index - 1, 2, findLeg(session, routes, route, waypoints[index - 1], waypoints[index]));
    route.waypoints = waypoints;
    route.legs = legs;
    return true;
}

/**
 * Splits a route at an inner waypoint into two routes that share it: the first keeps the route's
 * identity and the legs before the waypoint, the second (a copy of its fields, named after it) the
 * legs after.
 * @returns {object|null} The new second route, or null for an end waypoint.
 */
export function splitRoute(route, index, idFactory = undefined, secondName = null) {
    if (index <= 0 || index >= route.waypoints.length - 1) return null;
    // The second route gets its own copy of the label, so editing one route's label later leaves the other's alone
    const label = route.label ? structuredClone(route.label) : null;
    const second = createRoute({ ...route, id: undefined, name: secondName ?? route.name, label, waypoints: route.waypoints.slice(index), legs: route.legs.slice(index), generated: null }, idFactory);
    delete second.legacy;
    route.waypoints = route.waypoints.slice(0, index + 1);
    route.legs = route.legs.slice(0, index);
    return second;
}

/**
 * Joins a second route onto the end of the first: the first's last waypoint must be the second's
 * first (the second may be reversed to make it so). The first takes the second's waypoints and
 * legs; the second is left for the caller to remove.
 * @returns {boolean} Whether the routes met and were joined.
 */
export function joinRoutes(first, second) {
    const end = first.waypoints.at(-1);
    let waypoints = second.waypoints;
    let legs = second.legs;
    if (waypoints[0] !== end && waypoints.at(-1) === end) {
        waypoints = waypoints.slice().reverse();
        legs = legs.map((leg) => leg.slice().reverse()).reverse();
    }
    if (waypoints[0] !== end) return false;
    first.waypoints = [...first.waypoints, ...waypoints.slice(1)];
    first.legs = [...first.legs, ...legs];
    return true;
}

/** Finds every leg of a route again in its (new) mode, for a transport change or "re-path all legs". */
export function repathRoute(session, routes, route) {
    const legs = [];
    for (let k = 0; k + 1 < route.waypoints.length; k++) legs.push(findLeg(session, routes, route, route.waypoints[k], route.waypoints[k + 1]));
    route.legs = legs;
}

/**
 * The leg of a route nearest a map point and the cell of it nearest the point, for inserting a
 * waypoint where a leg was clicked.
 * @returns {{legIndex: number, cell: number, distance: number}|null}
 */
export function nearestLegCell(session, route, x, y) {
    const { mesh } = session;
    let best = null;
    route.legs.forEach((leg, legIndex) => {
        for (const cell of leg) {
            const distance = Math.hypot(mesh.siteX(cell) - x, mesh.siteY(cell) - y);
            if (!best || distance < best.distance) best = { legIndex, cell, distance };
        }
    });
    return best;
}

/**
 * The waypoint of a route nearest a map point, within a reach.
 * @returns {number} Its index, or -1.
 */
export function waypointAt(session, route, x, y, reach) {
    const { mesh } = session;
    let best = -1;
    let bestDistance = reach;
    route.waypoints.forEach((cell, index) => {
        const distance = Math.hypot(mesh.siteX(cell) - x, mesh.siteY(cell) - y);
        if (distance <= bestDistance) {
            best = index;
            bestDistance = distance;
        }
    });
    return best;
}
