import { FILRODENSWMB } from "../config.js";

/**
 * The model cells as a graph with one id per edge, so roads, sea lanes and traffic can be kept
 * per edge, and the cost functions every stage travels or claims land with.
 *
 * Everything is held in typed arrays: the adjacency in compressed rows (a cell's neighbours and
 * the edges to them, in the cell's own neighbour order), and per edge its two cells, its length in
 * effective km and its kind. Costs are handed to the searches as one Float64Array per cost model
 * (see Search.js), filled from the functions below, so a search never calls a function per step.
 *
 * All costs are in flat-km: the time it takes to walk one km over flat open ground.
 */

/** Edge kinds: between two land cells, along a navigable river, over water, and land to water. */
export const EDGE = Object.freeze({ LAND: 0, RIVER: 1, SEA: 2, PORT: 3 });

export class CellGraph {
    /**
     * @param {import("./CellValues.js").ModelCells} cells
     */
    constructor(cells) {
        this.cells = cells;
        this.count = cells.count;
        this.kmPerPx = cells.kmPerPx;
        this.#build();
    }

    #build() {
        const { cells, count } = this;
        const { neighbourStart, neighbourList } = cells;
        const slots = neighbourList.length;
        this.adjStart = neighbourStart;
        this.adjCell = neighbourList;
        this.adjEdge = new Int32Array(slots).fill(-1);
        const edgeA = new Int32Array(slots);
        const edgeB = new Int32Array(slots);
        let edges = 0;
        // An edge is made when its lower-numbered cell is visited, and the higher cell finds it
        // again by looking for its own id among the lower cell's neighbours
        for (let a = 0; a < count; a++) {
            for (let slot = neighbourStart[a]; slot < neighbourStart[a + 1]; slot++) {
                const b = neighbourList[slot];
                if (a < b) {
                    edgeA[edges] = a;
                    edgeB[edges] = b;
                    this.adjEdge[slot] = edges++;
                } else {
                    this.adjEdge[slot] = this.#slotEdge(b, a);
                }
            }
        }
        this.edgeCount = edges;
        this.edgeA = edgeA.slice(0, edges);
        this.edgeB = edgeB.slice(0, edges);
        this.edgeKm = new Float64Array(edges);
        this.edgeKind = new Uint8Array(edges);
        for (let edge = 0; edge < edges; edge++) {
            this.edgeKm[edge] = this.#siteDistance(this.edgeA[edge], this.edgeB[edge]) * this.kmPerPx;
            this.edgeKind[edge] = this.#kindOf(this.edgeA[edge], this.edgeB[edge]);
        }
    }

    /** The edge already made from `from` to `to` (to < from), found in `to`'s neighbour list. */
    #slotEdge(to, from) {
        for (let slot = this.adjStart[to]; slot < this.adjStart[to + 1]; slot++) {
            if (this.adjCell[slot] === from) return this.adjEdge[slot];
        }
        // The neighbour lists are symmetric (Delaunay neighbours), so this is never reached
        throw new Error(`model cells ${to} and ${from} are not neighbours both ways`);
    }

    #siteDistance(a, b) {
        const { x, y } = this.cells;
        return Math.hypot(x[a] - x[b], y[a] - y[b]);
    }

    #kindOf(a, b) {
        const { water, navigable } = this.cells;
        if (water[a] && water[b]) return EDGE.SEA;
        if (water[a] || water[b]) return EDGE.PORT;
        return navigable[a] && navigable[b] ? EDGE.RIVER : EDGE.LAND;
    }

    /** The edge between two cells, or -1 when they are not neighbours. */
    edge(a, b) {
        for (let slot = this.adjStart[a]; slot < this.adjStart[a + 1]; slot++) {
            if (this.adjCell[slot] === b) return this.adjEdge[slot];
        }
        return -1;
    }

    /** The cell at the other end of an edge from `cell`. */
    other(edge, cell) {
        return this.edgeA[edge] === cell ? this.edgeB[edge] : this.edgeA[edge];
    }

    /** The land cell of a port edge. */
    landOf(edge) {
        return this.cells.water[this.edgeA[edge]] ? this.edgeB[edge] : this.edgeA[edge];
    }

    /**
     * Fills an array of every edge's cost from a function of the edge.
     * @param {function(number): number} costOf
     * @param {Float64Array} [into]
     * @returns {Float64Array}
     */
    costs(costOf, into = new Float64Array(this.edgeCount)) {
        for (let edge = 0; edge < this.edgeCount; edge++) into[edge] = costOf(edge);
        return into;
    }
}

/** The relief term of a cell: 1 on flat ground, doubling at RELIEF_COST_M of local relief. */
export function reliefTerm(cells, cell) {
    return 1 + (cells.reliefM[cell] / FILRODENSWMB.GENERATOR.VALUES.RELIEF_COST_M) ** 1.5;
}

/** A built road's cost per km between two land cells: relief only, at the road discount. */
function roadPerKm(cells, a, b) {
    return 0.5 * (reliefTerm(cells, a) + reliefTerm(cells, b)) * FILRODENSWMB.GENERATOR.TRAVEL.ROAD_FACTOR;
}

/** Off-road cost per km between two land cells: their mean land cost (cover and relief). */
function groundPerKm(cells, a, b) {
    return 0.5 * (cells.landCost[a] + cells.landCost[b]);
}

/**
 * Travel cost per edge (towns, trade, cultures). A built road costs its relief only, at the road
 * discount (forest is cut through once a road exists); an established sea lane costs LANE_FACTOR;
 * stepping between land and water adds portKm(land cell). A river edge without a road is the river
 * cost alone; with one, whichever is cheaper.
 *
 * @param {CellGraph} graph
 * @param {object} options
 * @param {function(number): number} options.portKm - Loading cost at a land cell.
 * @param {Uint8Array} [options.road] - 1 for each edge with a road or lane.
 * @returns {function(number): number}
 */
export function travelCost(graph, { portKm, road = null }) {
    const { cells, edgeA, edgeB, edgeKm, edgeKind } = graph;
    const { SEA_COST, RIVER_COST, ROAD_FACTOR, LANE_FACTOR } = FILRODENSWMB.GENERATOR.TRAVEL;
    return (edge) => {
        const a = edgeA[edge];
        const b = edgeB[edge];
        const km = edgeKm[edge];
        const built = road ? road[edge] : 0;
        switch (edgeKind[edge]) {
            case EDGE.SEA:
                return km * SEA_COST * (built ? LANE_FACTOR : 1);
            case EDGE.PORT: {
                const land = graph.landOf(edge);
                const ground = built ? reliefTerm(cells, land) * ROAD_FACTOR : cells.landCost[land];
                return km * 0.5 * (ground + SEA_COST) + portKm(land);
            }
            case EDGE.RIVER:
                return km * (built ? Math.min(RIVER_COST, roadPerKm(cells, a, b)) : RIVER_COST);
            default:
                return km * (built ? roadPerKm(cells, a, b) : groundPerKm(cells, a, b));
        }
    };
}

/**
 * Political cost per edge (realms and security): travel with the roads as built, but water is
 * harder to hold than to sail (x SEA_HOLD, + CROSSING_KM for each landing). `barrier(a, b)`, when
 * given, multiplies the cost of stepping between two cells (culture edges).
 *
 * @param {CellGraph} graph
 * @param {object} options
 * @param {Uint8Array} options.road
 * @param {function(number, number): number} [options.barrier]
 * @returns {function(number): number}
 */
export function politicalCost(graph, { road, barrier = null }) {
    const { cells, edgeA, edgeB, edgeKm, edgeKind } = graph;
    const { SEA_COST, RIVER_COST, ROAD_FACTOR } = FILRODENSWMB.GENERATOR.TRAVEL;
    const { SEA_HOLD, CROSSING_KM } = FILRODENSWMB.GENERATOR.REALMS;
    const base = (edge) => {
        const a = edgeA[edge];
        const b = edgeB[edge];
        const km = edgeKm[edge];
        switch (edgeKind[edge]) {
            case EDGE.SEA:
                return km * SEA_COST * SEA_HOLD;
            case EDGE.PORT: {
                const land = graph.landOf(edge);
                const ground = road[edge] ? reliefTerm(cells, land) * ROAD_FACTOR : cells.landCost[land];
                return km * 0.5 * (ground + SEA_COST * SEA_HOLD) + CROSSING_KM;
            }
            case EDGE.RIVER:
                return km * RIVER_COST;
            default:
                return km * (road[edge] ? roadPerKm(cells, a, b) : groundPerKm(cells, a, b));
        }
    };
    return barrier ? (edge) => base(edge) * barrier(edgeA[edge], edgeB[edge]) : base;
}

/**
 * The loading cost at a land cell: a sheltered harbour or river mouth is cheaper than an open
 * coast, and (with `townAt`) a town that already has quays is cheaper still.
 * @param {import("./CellValues.js").ModelCells} cells
 * @param {Int32Array} [townAt] - The town in each cell, or -1.
 * @returns {function(number): number}
 */
export function portCost(cells, townAt = null) {
    const { PORT_KM, SHELTERED_PORT_KM, SHELTERED, TOWN_PORT_KM } = FILRODENSWMB.GENERATOR.TRAVEL;
    return (cell) => {
        if (townAt && townAt[cell] >= 0) return TOWN_PORT_KM;
        return cells.mouthKm[cell] > 0 || cells.shelter[cell] >= SHELTERED ? SHELTERED_PORT_KM : PORT_KM;
    };
}
