import { FILRODENSWMB } from "../config.js";
import { EDGE } from "./CellGraph.js";

/**
 * The trade network as routes: every edge that carried trade in the last round, chained between
 * nodes (towns, and cells where the network does not simply continue: junctions and dead ends),
 * then split wherever the transport or the class changes, so each route has one transport and one
 * class and can take one style.
 *
 * Transport by edge kind: land edges are roads, river edges river trade, and both water edges and
 * the landing between water and land sea lanes (a lane runs from the port town's own cell). Class by
 * traffic rank: the busiest TRUNK_SHARE of the edges are trunk routes, up to MAIN_SHARE main, the
 * rest minor.
 */

const TRANSPORT_OF_KIND = Object.freeze({ [EDGE.LAND]: "road", [EDGE.RIVER]: "river", [EDGE.SEA]: "sea", [EDGE.PORT]: "sea" });

/**
 * @param {import("./CellGraph.js").CellGraph} graph
 * @param {Float64Array} traffic - Trade per edge in the last round.
 * @param {Iterable<number>} nodeCells - Cells that always end a chain (towns).
 * @returns {{cells: number[], transport: string, class: string}[]}
 */
export function routeChains(graph, traffic, nodeCells) {
    const used = [];
    for (let edge = 0; edge < graph.edgeCount; edge++) if (traffic[edge] > 0) used.push(edge);
    const classOf = classes(used, traffic);
    const degree = new Int32Array(graph.count);
    for (const edge of used) {
        degree[graph.edgeA[edge]]++;
        degree[graph.edgeB[edge]]++;
    }
    const towns = new Set(nodeCells);
    const isNode = (cell) => towns.has(cell) || degree[cell] !== 2;
    const walker = { graph, traffic, classOf, isNode, seen: new Uint8Array(graph.edgeCount) };
    const chains = [];
    for (let cell = 0; cell < graph.count; cell++) {
        if (!degree[cell] || !isNode(cell)) continue;
        forEachUsedEdge(walker, cell, (edge) => {
            if (!walker.seen[edge]) chains.push(...splitChain(walker, walkChain(walker, cell, edge)));
        });
    }
    chains.push(...closedLoops(walker));
    return chains;
}

/** Each used edge's class by traffic rank (the busiest first; the lower edge id first on a tie). */
function classes(used, traffic) {
    const { TRUNK_SHARE, MAIN_SHARE } = FILRODENSWMB.GENERATOR.ROUTES;
    const ranked = used.slice().sort((a, b) => traffic[b] - traffic[a] || a - b);
    const classOf = new Map();
    ranked.forEach((edge, rank) => {
        let name = "minor";
        if (rank < TRUNK_SHARE * ranked.length) name = "trunk";
        else if (rank < MAIN_SHARE * ranked.length) name = "main";
        classOf.set(edge, name);
    });
    return classOf;
}

function forEachUsedEdge(walker, cell, callback) {
    const { graph, traffic } = walker;
    for (let slot = graph.adjStart[cell]; slot < graph.adjStart[cell + 1]; slot++) {
        const edge = graph.adjEdge[slot];
        if (traffic[edge] > 0) callback(edge);
    }
}

/** Follows the network from a node along `edge` to the next node: { cells, edges }. */
function walkChain(walker, start, edge) {
    const { graph, seen, isNode } = walker;
    const cells = [start];
    const edges = [];
    let current = start;
    let step = edge;
    while (step >= 0 && !seen[step]) {
        seen[step] = 1;
        edges.push(step);
        current = graph.other(step, current);
        cells.push(current);
        if (isNode(current)) break;
        step = nextUnseen(walker, current);
    }
    return { cells, edges };
}

function nextUnseen(walker, cell) {
    let found = -1;
    forEachUsedEdge(walker, cell, (edge) => {
        if (found < 0 && !walker.seen[edge]) found = edge;
    });
    return found;
}

/** Splits a chain wherever its transport or class changes. */
function splitChain(walker, { cells, edges }) {
    const pieces = [];
    const transportOf = (edge) => TRANSPORT_OF_KIND[walker.graph.edgeKind[edge]];
    let start = 0;
    for (let index = 1; index <= edges.length; index++) {
        const ends = index === edges.length || transportOf(edges[index]) !== transportOf(edges[start]) || walker.classOf.get(edges[index]) !== walker.classOf.get(edges[start]);
        if (!ends) continue;
        pieces.push({ cells: cells.slice(start, index + 1), transport: transportOf(edges[start]), class: walker.classOf.get(edges[start]) });
        start = index;
    }
    return pieces;
}

/** Rings with no node on them (every cell continuing the network) are walked from their lowest cell. */
function closedLoops(walker) {
    const { graph, traffic, seen } = walker;
    const chains = [];
    for (let edge = 0; edge < graph.edgeCount; edge++) {
        if (traffic[edge] > 0 && !seen[edge]) chains.push(...splitChain(walker, walkChain(walker, graph.edgeA[edge], edge)));
    }
    return chains;
}
