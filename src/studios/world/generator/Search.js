import { MinHeap } from "../mesh/MinHeap.js";

/**
 * Least-cost searches over the cell graph: plain, multi-source (each cell goes to the source that
 * reaches it first, so every source's region is connected) and multiplicatively weighted (each
 * source's step costs are scaled, so a stronger source reaches further), bounded by a cost limit,
 * stopped at a target (with an A* estimate when one is given), and calling a visitor as each cell
 * is settled.
 *
 * A SearchSpace keeps its arrays between searches and only resets the cells a search touched (by
 * a generation stamp), so the thousands of small bounded searches the towns and trade stages run
 * cost what they visit rather than the whole graph each. searchAll returns fresh full arrays for
 * the few searches whose results are kept.
 *
 * Costs are a Float64Array per edge (see CellGraph.costs). Ties are settled by cell id (MinHeap),
 * so a search's result never depends on the order entries were pushed.
 */
export class SearchSpace {
    #stamp;
    #generation = 0;

    /** @param {import("./CellGraph.js").CellGraph} graph */
    constructor(graph) {
        this.graph = graph;
        const count = graph.count;
        this.best = new Float64Array(count);
        this.owner = new Int32Array(count);
        this.via = new Int32Array(count);
        this.#stamp = new Uint32Array(count);
        this.heap = new MinHeap(Math.max(1024, count));
    }

    /** The cost of reaching a cell in the last search (Infinity when it was not reached). */
    costTo(cell) {
        return this.#stamp[cell] === this.#generation ? this.best[cell] : Infinity;
    }

    /** The source that reached a cell in the last search (its index in `sources`), or -1. */
    ownerOf(cell) {
        return this.#stamp[cell] === this.#generation ? this.owner[cell] : -1;
    }

    /**
     * Runs one search.
     * @param {ArrayLike<number>} sources - The cells it starts from.
     * @param {Float64Array} cost - Cost per edge.
     * @param {object} [options]
     * @param {number} [options.limit] - Cells costing more than this (in scaled units) are not reached.
     * @param {Float64Array|number[]} [options.scale] - A multiplier of every step per source.
     * @param {number} [options.target] - Stop once this cell is settled.
     * @param {number} [options.estimatePerKm] - With a target: the least cost per km of any edge,
     *     so the straight-line distance to the target times it never overestimates (an admissible
     *     A* estimate, giving the same path cost as a plain search while settling far fewer cells).
     * @param {function(number, number, number): void} [options.visit] - (cell, cost, source) as each cell is settled.
     * @param {function(number, number): boolean} [options.stop] - (cell, cost) as each cell is
     *     settled, after visit: true ends the search there. Cells are settled cheapest first, so a
     *     search can stop once nothing further away could matter to it.
     * @returns {SearchSpace} this
     */
    run(sources, cost, { limit = Infinity, scale = null, target = -1, estimatePerKm = 0, visit = null, stop = null } = {}) {
        const generation = this.#nextGeneration();
        const { best, owner, via, heap, graph } = this;
        const stamp = this.#stamp;
        const estimate = this.#estimator(target, estimatePerKm);
        heap.clear();
        for (let source = 0; source < sources.length; source++) {
            const cell = sources[source];
            stamp[cell] = generation;
            best[cell] = 0;
            owner[cell] = source;
            via[cell] = -1;
            heap.push(estimate(cell), cell);
        }
        const { adjStart, adjCell, adjEdge } = graph;
        while (heap.size) {
            const cell = heap.pop();
            const reached = best[cell];
            if (heap.lastPriority > reached + estimate(cell)) continue;
            const source = owner[cell];
            if (visit) visit(cell, reached, source);
            if (cell === target || stop?.(cell, reached)) break;
            const factor = scale ? scale[source] : 1;
            for (let slot = adjStart[cell]; slot < adjStart[cell + 1]; slot++) {
                const next = adjCell[slot];
                const total = reached + cost[adjEdge[slot]] * factor;
                if (total > limit) continue;
                if (stamp[next] === generation && total >= best[next]) continue;
                stamp[next] = generation;
                best[next] = total;
                owner[next] = source;
                via[next] = adjEdge[slot];
                heap.push(total + estimate(next), next);
            }
        }
        return this;
    }

    /**
     * The edges from `from` to `to` along the last search's paths (it must have started at
     * `from`), or null when `to` was not reached.
     * @returns {number[]|null}
     */
    path(from, to) {
        if (this.ownerOf(to) < 0) return null;
        const edges = [];
        let cell = to;
        while (cell !== from) {
            const edge = this.via[cell];
            if (edge < 0) return null;
            edges.push(edge);
            cell = this.graph.other(edge, cell);
        }
        return edges.reverse();
    }

    #nextGeneration() {
        this.#generation++;
        if (this.#generation === 0xffffffff) {
            this.#stamp.fill(0);
            this.#generation = 1;
        }
        return this.#generation;
    }

    #estimator(target, perKm) {
        if (target < 0 || perKm <= 0) return () => 0;
        const { x, y } = this.graph.cells;
        const scale = this.graph.kmPerPx * perKm;
        const tx = x[target];
        const ty = y[target];
        return (cell) => Math.hypot(x[cell] - tx, y[cell] - ty) * scale;
    }
}

/**
 * One search whose results are kept: full arrays, Infinity and -1 where a cell was not reached.
 * @param {import("./CellGraph.js").CellGraph} graph
 * @param {ArrayLike<number>} sources
 * @param {Float64Array} cost
 * @param {object} [options] - As SearchSpace.run.
 * @returns {{best: Float64Array, owner: Int32Array, via: Int32Array}}
 */
export function searchAll(graph, sources, cost, options = {}) {
    const space = new SearchSpace(graph).run(sources, cost, options);
    const best = new Float64Array(graph.count);
    const owner = new Int32Array(graph.count);
    const via = new Int32Array(graph.count);
    for (let cell = 0; cell < graph.count; cell++) {
        best[cell] = space.costTo(cell);
        owner[cell] = space.ownerOf(cell);
        via[cell] = owner[cell] >= 0 ? space.via[cell] : -1;
    }
    return { best, owner, via };
}

/**
 * The least cost per km of any edge: the A* estimate's rate (see SearchSpace.run).
 * @param {import("./CellGraph.js").CellGraph} graph
 * @param {Float64Array} cost
 */
export function leastCostPerKm(graph, cost) {
    let least = Infinity;
    for (let edge = 0; edge < graph.edgeCount; edge++) {
        const km = graph.edgeKm[edge];
        if (km > 0) least = Math.min(least, cost[edge] / km);
    }
    return Number.isFinite(least) ? least : 0;
}
