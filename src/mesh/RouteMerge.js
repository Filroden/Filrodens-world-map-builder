import { routeCells } from "./RoutePath.js";

/**
 * Where several routes of one transport run over the same cells (a minor road joining a trunk
 * road, a sea lane following a busier one), the shared stretch is drawn once, by the route that
 * ranks highest: the busiest class first (trunk, main, minor, then routes without a class), then
 * the thickest, then by id so the choice is stable. Every other route draws only the stretches
 * no higher route has already drawn, so overlapping lines do not thicken or mix their colours.
 *
 * This is drawing only: each route keeps all its cells, so editing and exports see every route
 * whole.
 */

const CLASS_RANK = Object.freeze({ trunk: 0, main: 1, minor: 2 });
const UNRANKED = 3;

function rankOf(route) {
    return CLASS_RANK[route.class] ?? UNRANKED;
}

function compareRoutes(a, b) {
    return rankOf(a) - rankOf(b) || (b.thickness ?? 0) - (a.thickness ?? 0) || String(a.id).localeCompare(String(b.id));
}

/**
 * The stretches each route draws.
 * @param {object[]} routes - The routes drawn in this pass, each { id, transport, class, thickness, legs }.
 * @param {number} cellCount - The display mesh's cell count (to key a step between two cells).
 * @returns {Map<string, number[][]|null>} By route id: null when the route draws whole, otherwise
 *     its runs of cells left to draw (empty when another route draws all of it).
 */
export function routeRuns(routes, cellCount) {
    const claimed = new Map();
    const out = new Map();
    for (const route of [...routes].sort(compareRoutes)) {
        if (!route.legs?.length) {
            out.set(route.id, null);
            continue;
        }
        const transport = route.transport ?? "road";
        if (!claimed.has(transport)) claimed.set(transport, new Map());
        out.set(route.id, runsOf(route, routeCells(route.legs), claimed.get(transport), cellCount));
    }
    return out;
}

/**
 * Splits a route's cells where a higher route already drew the step, and claims the steps it
 * draws. A step the route itself claimed earlier (a route crossing back over itself) is drawn.
 */
function runsOf(route, cells, claimed, cellCount) {
    const runs = [];
    let run = null;
    let whole = true;
    for (let k = 0; k + 1 < cells.length; k++) {
        const a = cells[k];
        const b = cells[k + 1];
        const key = a < b ? a * cellCount + b : b * cellCount + a;
        const owner = claimed.get(key);
        if (owner !== undefined && owner !== route.id) {
            whole = false;
            run = null;
            continue;
        }
        claimed.set(key, route.id);
        if (!run) {
            run = [a];
            runs.push(run);
        }
        run.push(b);
    }
    return whole ? null : runs;
}
