import { FILRODENSWMB } from "../config.js";
import { EDGE } from "../generator/CellGraph.js";
import { MinHeap } from "../mesh/MinHeap.js";

/**
 * Travel times over the generator's travel network (see TravelGraph), for the Travel tool. The
 * network's relative costs are the generator's own (CellGraph.travelCost), so the times explain
 * the roads, trade and realms a run made; speeds turn them into days.
 *
 * A land speed is a day's distance on a road over level ground. The generator's land costs are
 * made to compare ways rather than to time them (its forest on hills costs several times its open
 * plain), so pace takes them softened (TRAVEL_TIME.TERRAIN): a road step is slowed by its relief
 * term, and a step off the road is OFF_ROAD of the road's pace on open level ground, slowed by its
 * land cost (cover and relief), each to the power TERRAIN. Every way is still ranked as the
 * generator ranks it. A river step takes its length over the downstream or upstream speed,
 * whichever way it runs (or the road beside it, when quicker); a sea step its length over the sea
 * speed; a step between land and water half of each, with the harbour's loading cost as time on
 * open level ground.
 *
 * Times run one way, from the start outward: going up a river is slower than coming down it.
 */

const T = FILRODENSWMB.GENERATOR.TRAVEL;

/**
 * The run's roads (pairs of model cells) as a flag per edge of the graph. A pair that is not an
 * edge (the mesh rebuilt since the run) is counted as missing and left out.
 * @returns {{road: Uint8Array, missing: number}}
 */
export function roadEdges(graph, roadFrom, roadTo) {
    const road = new Uint8Array(graph.edgeA.length);
    let missing = 0;
    for (let at = 0; at < (roadFrom?.length ?? 0); at++) {
        const edge = edgeBetween(graph, roadFrom[at], roadTo[at]);
        if (edge >= 0) road[edge] = 1;
        else missing += 1;
    }
    return { road, missing };
}

/** The edge between two cells, or -1. */
export function edgeBetween(graph, a, b) {
    if (!(a >= 0 && a < graph.count)) return -1;
    for (let slot = graph.adjStart[a]; slot < graph.adjStart[a + 1]; slot++) if (graph.adjCell[slot] === b) return graph.adjEdge[slot];
    return -1;
}

/**
 * Whether a river step from cell `a` to cell `b` runs downstream (1), upstream (-1) or neither
 * can be told (0): the end with the longer river above it is downstream, and with equal lengths
 * the lower one.
 */
export function riverDirection(graph, a, b) {
    const { riverKm, heightM } = graph;
    if (riverKm[b] !== riverKm[a]) return riverKm[b] > riverKm[a] ? 1 : -1;
    if (heightM[b] !== heightM[a]) return heightM[b] < heightM[a] ? 1 : -1;
    return 0;
}

/**
 * Each edge's time in days, each way: `out` from its first cell (edgeA) to its second, `back` the
 * other way.
 * @param {object} graph - See TravelGraph.
 * @param {object} options
 * @param {{foot: number, wagon: number, mount: number, riverDown: number, riverUp: number, sea: number}} options.speeds - Per day, in km.
 * @param {string} options.mode - The way over land (a key of speeds).
 * @param {Uint8Array} [options.road] - 1 for each edge with a road (see roadEdges).
 * @param {Set<number>} [options.towns] - Cells with a town, whose harbours load faster.
 * @returns {{out: Float64Array, back: Float64Array}}
 */
export function edgeDays(graph, { speeds, mode, road = null, towns = null }) {
    const { edgeA, edgeB, edgeKm, edgeKind, water, landCost, reliefTerm, portKm } = graph;
    const count = edgeA.length;
    const out = new Float64Array(count);
    const back = new Float64Array(count);
    const { OFF_ROAD, TERRAIN } = FILRODENSWMB.TRAVEL_TIME;
    const road1 = speeds[mode];
    const open = road1 * OFF_ROAD;
    const slow = (cost) => Math.max(1, cost) ** TERRAIN;
    const roadDays = (a, b, km) => (km * 0.5 * (slow(reliefTerm[a]) + slow(reliefTerm[b]))) / road1;
    const groundDays = (a, b, km) => (km * 0.5 * (slow(landCost[a]) + slow(landCost[b]))) / open;
    for (let edge = 0; edge < count; edge++) {
        const a = edgeA[edge];
        const b = edgeB[edge];
        const km = edgeKm[edge];
        const built = road?.[edge] === 1;
        let forward;
        let backward;
        switch (edgeKind[edge]) {
            case EDGE.SEA:
                forward = backward = km / speeds.sea;
                break;
            case EDGE.PORT: {
                const land = water[a] ? b : a;
                const ashore = built ? (km * 0.5 * slow(reliefTerm[land])) / road1 : (km * 0.5 * slow(landCost[land])) / open;
                const loading = (towns?.has(land) ? T.TOWN_PORT_KM : portKm[land]) / open;
                forward = backward = ashore + loading + (km * 0.5) / speeds.sea;
                break;
            }
            case EDGE.RIVER: {
                const direction = riverDirection(graph, a, b);
                const down = km / speeds.riverDown;
                const up = km / speeds.riverUp;
                const level = km / ((speeds.riverDown + speeds.riverUp) / 2);
                forward = direction > 0 ? down : direction < 0 ? up : level;
                backward = direction > 0 ? up : direction < 0 ? down : level;
                if (built) {
                    const overland = roadDays(a, b, km);
                    forward = Math.min(forward, overland);
                    backward = Math.min(backward, overland);
                }
                break;
            }
            default:
                forward = backward = built ? roadDays(a, b, km) : groundDays(a, b, km);
        }
        out[edge] = forward;
        back[edge] = backward;
    }
    return { out, back };
}

/**
 * The quickest time from a start to every cell (Infinity where none reaches), with the edge each
 * cell was reached by (-1 for the start and the unreached).
 * @returns {{start: number, days: Float64Array, via: Int32Array}}
 */
export function travelFrom(graph, { out, back }, start) {
    const days = new Float64Array(graph.count).fill(Infinity);
    const via = new Int32Array(graph.count).fill(-1);
    if (!(start >= 0 && start < graph.count)) return { start, days, via };
    const heap = new MinHeap(1024);
    days[start] = 0;
    heap.push(0, start);
    while (heap.size) {
        const time = heap.peekPriority();
        const cell = heap.pop();
        if (time > days[cell]) continue;
        for (let slot = graph.adjStart[cell]; slot < graph.adjStart[cell + 1]; slot++) {
            const next = graph.adjCell[slot];
            const edge = graph.adjEdge[slot];
            const step = graph.edgeA[edge] === cell ? out[edge] : back[edge];
            const arrive = time + step;
            if (arrive < days[next]) {
                days[next] = arrive;
                via[next] = edge;
                heap.push(arrive, next);
            }
        }
    }
    return { start, days, via };
}

/**
 * The quickest way from the start to a cell: its cells in order, and each step's way of travel
 * ("land", "river" or "sea"; a step between land and water counts as sea). Empty when the cell is
 * not reached.
 * @returns {{cells: number[], steps: string[]}}
 */
export function wayTo(graph, reach, cell) {
    if (!(cell >= 0 && cell < graph.count) || !Number.isFinite(reach.days[cell])) return { cells: [], steps: [] };
    const cells = [cell];
    const steps = [];
    let at = cell;
    while (at !== reach.start && reach.via[at] >= 0) {
        const edge = reach.via[at];
        const kind = graph.edgeKind[edge];
        steps.push(kind === EDGE.RIVER ? "river" : kind === EDGE.SEA || kind === EDGE.PORT ? "sea" : "land");
        at = graph.edgeA[edge] === at ? graph.edgeB[edge] : graph.edgeA[edge];
        cells.push(at);
    }
    return { cells: cells.reverse(), steps: steps.reverse() };
}

/**
 * Lines at each whole day: where the time crosses the day, across each triangle of the model
 * sites (time taken as varying evenly inside a triangle). A triangle with a corner no one reaches
 * gives no line.
 * @param {ArrayLike<number>} triangles - Corner cells, three per triangle.
 * @param {function(number): number} xOf - A cell's site.
 * @param {function(number): number} yOf
 * @param {Float64Array} days - Each cell's time.
 * @param {number} maxDays - The last day drawn.
 * @returns {{day: number, segments: number[]}[]} Each day's segments as x1, y1, x2, y2 runs.
 */
export function dayRings(triangles, xOf, yOf, days, maxDays) {
    const rings = Array.from({ length: maxDays }, (_, at) => ({ day: at + 1, segments: [] }));
    for (let at = 0; at + 2 < triangles.length; at += 3) {
        const corners = [triangles[at], triangles[at + 1], triangles[at + 2]];
        const values = corners.map((cell) => days[cell]);
        if (!values.every(Number.isFinite)) continue;
        const low = Math.min(...values);
        const high = Math.max(...values);
        for (let day = Math.max(1, Math.ceil(low)); day <= Math.min(maxDays, high); day++) {
            const points = [];
            for (let side = 0; side < 3; side++) {
                const [i, j] = [side, (side + 1) % 3];
                const [vi, vj] = [values[i], values[j]];
                // Each crossing counted on the side where one end is below the day and the other at or above it
                if ((vi < day) === (vj < day)) continue;
                const share = (day - vi) / (vj - vi);
                points.push(xOf(corners[i]) + share * (xOf(corners[j]) - xOf(corners[i])), yOf(corners[i]) + share * (yOf(corners[j]) - yOf(corners[i])));
            }
            if (points.length === 4) rings[day - 1].segments.push(...points);
        }
    }
    return rings;
}
