import { FILRODENSWMB } from "../config.js";
import { MinHeap } from "../mesh/MinHeap.js";
import { transportCost } from "../mesh/RouteEdits.js";
import { createRoute } from "../mesh/Schema.js";

/**
 * A run's trade network as routes on the display mesh. Each of the model's route chains (one
 * transport and one class; see RouteChains) becomes a route whose waypoints are the chain's model
 * cells, which are display cells too (the model sites are display sites). Each leg between two
 * waypoints is found on the display mesh with the transport's own cost (RouteEdits.transportCost),
 * so a road follows the valleys between its towns and a sea lane keeps to water.
 *
 * Routes are laid busiest class first, and a step over cells an earlier route of the same transport
 * already uses costs SHARED_STEP of its usual cost, so the minor roads join the trunk roads rather
 * than running beside them: coincident stretches are then drawn once (see RouteMerge).
 */

const CLASS_ORDER = Object.freeze({ trunk: 0, main: 1, minor: 2 });

/**
 * @param {import("../mesh/MeshSession.js").MeshSession} session - Needs mesh and aggregates.
 * @param {object} result - A generator run.
 * @param {object} options
 * @param {string} options.runId
 * @param {Function} options.idFactory
 * @param {function(string, string): object|null} options.styleFor - The route style for a transport and class.
 * @param {function(object): object} options.styleFields - A style's fields as written onto a route.
 * @param {Object<string, boolean>} [options.transports] - The kinds of route to lay (road, river,
 *     sea); all when left out.
 * @returns {object[]} The routes, in the mesh shape (Schema.createRoute).
 */
export function buildRoutes(session, result, { runId, idFactory, styleFor, styleFields, transports = {} }) {
    const finder = new LegFinder(session);
    const chains = result.routes
        .map((chain, index) => ({ ...chain, index }))
        .filter((chain) => transports[chain.transport] !== false)
        .sort((a, b) => CLASS_ORDER[a.class] - CLASS_ORDER[b.class] || a.index - b.index);
    const routes = [];
    for (const chain of chains) {
        const waypoints = finder.waypoints(chain.cells, chain.transport);
        if (waypoints.length < 2) continue;
        const legs = [];
        for (let k = 0; k + 1 < waypoints.length; k++) legs.push(finder.leg(waypoints[k], waypoints[k + 1], chain.transport));
        finder.share(legs, chain.transport);
        const style = styleFor(chain.transport, chain.class);
        routes.push(createRoute({
            name: "",
            mode: "terrain",
            transport: chain.transport,
            class: chain.class,
            waypoints,
            legs,
            visibility: "all",
            quickStyle: style?.id ?? "custom",
            ...(style ? styleFields(style) : {}),
            generated: { run: runId, kind: "route", tier: chain.class, sourceId: chain.index, edited: false, locked: false },
        }, idFactory));
    }
    return routes;
}

/**
 * Least-cost legs on the display mesh, one transport at a time, with the cells of the routes laid
 * so far made cheaper. The search space is reused (reset by a generation stamp), since a run lays
 * thousands of short legs and a fresh pair of arrays for each would cost more than the searches.
 */
class LegFinder {
    #stamp;
    #generation = 0;

    constructor(session) {
        this.session = session;
        this.mesh = session.mesh;
        const count = this.mesh.cellCount;
        this.dist = new Float64Array(count);
        this.prev = new Int32Array(count);
        this.#stamp = new Uint32Array(count);
        this.heap = new MinHeap(1024);
        this.shared = { road: new Set(), river: new Set(), sea: new Set() };
        this.costs = new Map();
    }

    /** The transport's cost and passability (without the shared discount, which is applied here). */
    #model(transport) {
        if (!this.costs.has(transport)) this.costs.set(transport, transportCost(this.session, transport, []));
        return this.costs.get(transport);
    }

    /**
     * A chain's cells as waypoints the transport may stand on: a cell it cannot stand on (a road's
     * cell over a coastal sliver of water, a sea lane's port town on land) moves to the nearest
     * cell it can, within SNAP_CELLS; repeats are dropped.
     */
    waypoints(cells, transport) {
        const { passable } = this.#model(transport);
        const out = [];
        for (const cell of cells) {
            const snapped = passable && !passable(cell) ? this.#nearest(cell, passable) : cell;
            if (snapped >= 0 && out.at(-1) !== snapped) out.push(snapped);
        }
        return out;
    }

    /** The nearest cell (by steps) a predicate accepts, or -1 beyond SNAP_CELLS steps. */
    #nearest(start, accepts) {
        const limit = FILRODENSWMB.GENERATOR.MATERIALISE.SNAP_CELLS;
        const seen = new Set([start]);
        let frontier = [start];
        for (let step = 0; step < limit && frontier.length; step++) {
            const next = [];
            for (const cell of frontier) {
                for (const neighbour of this.mesh.neighbours(cell)) {
                    if (seen.has(neighbour)) continue;
                    if (accepts(neighbour)) return neighbour;
                    seen.add(neighbour);
                    next.push(neighbour);
                }
            }
            frontier = next;
        }
        return -1;
    }

    /**
     * The least-cost leg between two waypoints, or the two alone (drawn straight) when none is
     * found within LEG_STRETCH times the straight line's cost.
     * @returns {number[]}
     */
    leg(from, to, transport) {
        if (from === to) return [from];
        const { cost, stepPassable } = this.#model(transport);
        const shared = this.shared[transport];
        const step = (a, b) => cost(a, b) * (shared.has(a) && shared.has(b) ? FILRODENSWMB.MESH.ROUTE.SHARED_STEP : 1);
        const limit = this.mesh.distance(from, to) * FILRODENSWMB.GENERATOR.MATERIALISE.LEG_STRETCH;
        return this.#search(from, to, step, stepPassable, limit) ?? [from, to];
    }

    /** Records a route's cells so later routes of its transport join it. */
    share(legs, transport) {
        const shared = this.shared[transport];
        for (const leg of legs) for (const cell of leg) shared.add(cell);
    }

    #search(from, to, cost, passable, limit) {
        const generation = this.#nextGeneration();
        const { dist, prev, heap, mesh } = this;
        const stamp = this.#stamp;
        heap.clear();
        stamp[from] = generation;
        dist[from] = 0;
        prev[from] = -1;
        heap.push(0, from);
        while (heap.size) {
            const cell = heap.pop();
            const reached = heap.lastPriority;
            if (reached > dist[cell]) continue;
            if (cell === to) return this.#path(from, to);
            for (const next of mesh.neighbours(cell)) {
                if (passable && next !== to && !passable(next)) continue;
                const total = reached + cost(cell, next);
                if (total > limit || (stamp[next] === generation && total >= dist[next])) continue;
                stamp[next] = generation;
                dist[next] = total;
                prev[next] = cell;
                heap.push(total, next);
            }
        }
        return null;
    }

    #path(from, to) {
        const cells = [to];
        let cell = to;
        while (cell !== from) {
            cell = this.prev[cell];
            cells.push(cell);
        }
        return cells.reverse();
    }

    #nextGeneration() {
        this.#generation++;
        if (this.#generation === 0xffffffff) {
            this.#stamp.fill(0);
            this.#generation = 1;
        }
        return this.#generation;
    }
}
