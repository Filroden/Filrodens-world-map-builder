import { EDGE } from "./CellGraph.js";

/**
 * The map's own routes (drawn by hand, or generated and kept by a run) as the model's roads, sea
 * lanes and traded rivers, so the run's trade may use them (with the userRoutes rule, see
 * GeneratorRevision.rules).
 *
 * Each route arrives as the model cells its drawn line passes through, in order (see
 * Generation.userRoutes). Each step between two of them becomes the model edge joining them, or,
 * where two cells in a row are not neighbours (the drawn line clips a third cell's corner too
 * thinly to enter it), the two edges through the neighbour they share with the shortest way. What
 * an edge becomes is decided by the route's transport and the edge's kind:
 *
 * - A road is built on every land and river edge it follows (a road beside a river costs the
 *   cheaper of the two, as a road the model builds does). Its line is read over land cells only:
 *   a coastal model cell can count as water (under half its pixels land) while the road runs along
 *   its land, and stepping into it would be a landing, not a road.
 * - A sea route is a sea lane on every water edge it follows and on the landings at its ends.
 * - A river route makes every land edge it follows a navigable river (the edge's kind becomes
 *   RIVER, so it carries trade at the river's cost without being built, and its trade is drawn and
 *   chained as river trade), and lanes on any water and landings it reaches (a lake, a river mouth).
 *
 * A route's class (trunk, main, minor) does not change what it becomes: the model's built roads and
 * lanes have one cost each, and the class of a generated route comes from the trade it carries.
 *
 * Every edge a route acts on is `covered`, so the run lays no route of its own along it: the map
 * already has one there (see Pipeline.assembleResult), and the trade layer draws the trade on it
 * along the map's route (see ThematicData.tradeLines).
 */

/**
 * What a transport makes of each edge kind it follows: "built" (a road or lane), "river", "covered"
 * (already what the route says: a river route along a navigable river), or nothing.
 */
const ACTIONS = Object.freeze({
    road: Object.freeze({ [EDGE.LAND]: "built", [EDGE.RIVER]: "built" }),
    sea: Object.freeze({ [EDGE.SEA]: "built", [EDGE.PORT]: "built" }),
    river: Object.freeze({ [EDGE.LAND]: "river", [EDGE.RIVER]: "covered", [EDGE.SEA]: "built", [EDGE.PORT]: "built" }),
});

/**
 * @param {{transport: string, cells: number[]}[]|null|undefined} routes - From the payload.
 * @param {import("./CellGraph.js").CellGraph} graph
 * @returns {{built: Uint8Array, rivers: number[], covered: Uint8Array}|null} The edges built as
 *     roads and lanes, the land edges made rivers, and every edge a route acts on; null when the
 *     routes act on none.
 */
export function userRoutes(routes, graph) {
    if (!routes?.length) return null;
    const found = { built: new Uint8Array(graph.edgeCount), rivers: new Set(), covered: new Uint8Array(graph.edgeCount), any: false };
    for (const route of routes) {
        const actions = ACTIONS[route?.transport];
        if (!actions) continue;
        const keep = route.transport === "road" ? (cell) => !graph.cells.water[cell] : () => true;
        const cells = routeCells(route.cells, graph.count, keep);
        for (let at = 1; at < cells.length; at++) {
            for (const edge of stepEdges(graph, cells[at - 1], cells[at], keep)) markEdge(found, actions[graph.edgeKind[edge]], edge);
        }
    }
    if (!found.any) return null;
    return { built: found.built, rivers: [...found.rivers].sort((a, b) => a - b), covered: found.covered };
}

/** Makes the land edges a river route follows navigable rivers in the graph itself. */
export function applyUserRivers(graph, rivers) {
    for (const edge of rivers) graph.edgeKind[edge] = EDGE.RIVER;
}

/** A copy of a run's traffic without the edges the map's routes cover (see userRoutes). */
export function uncoveredTraffic(traffic, covered) {
    if (!covered) return traffic;
    return Float64Array.from(traffic, (value, edge) => (covered[edge] ? 0 : value));
}

/** The route's cells the transport reads, valid ids only, with repeats in a row dropped. */
function routeCells(cells, count, keep) {
    const out = [];
    for (const cell of cells ?? []) {
        if (!(Number.isInteger(cell) && cell >= 0 && cell < count) || !keep(cell)) continue;
        if (out.at(-1) !== cell) out.push(cell);
    }
    return out;
}

/** The edge between two cells, or the two through the neighbour they share with the shortest way; none if neither. */
function stepEdges(graph, a, b, keep) {
    const direct = graph.edge(a, b);
    if (direct >= 0) return [direct];
    let best = null;
    let bestKm = Infinity;
    for (let slot = graph.adjStart[a]; slot < graph.adjStart[a + 1]; slot++) {
        const middle = graph.adjCell[slot];
        if (!keep(middle)) continue;
        const onward = graph.edge(middle, b);
        if (onward < 0) continue;
        const km = graph.edgeKm[graph.adjEdge[slot]] + graph.edgeKm[onward];
        if (km < bestKm) {
            bestKm = km;
            best = [graph.adjEdge[slot], onward];
        }
    }
    return best ?? [];
}

function markEdge(found, action, edge) {
    if (!action) return;
    if (action === "river") found.rivers.add(edge);
    else if (action === "built") found.built[edge] = 1;
    found.covered[edge] = 1;
    found.any = true;
}
