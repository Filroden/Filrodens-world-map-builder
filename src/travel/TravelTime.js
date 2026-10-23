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
 * term, and a step off the road goes at a share of the road's pace (see groundPace), slowed by its
 * land cost. Every way is still ranked as the generator ranks it. Ships keep to the run's sea
 * routes and river boats to its traded rivers; elsewhere a small boat is all there is (see
 * edgeDays).
 *
 * Times run one way, from the start outward: going up a river is slower than coming down it, and
 * going aboard waits for passage where coming ashore does not.
 */

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

/**
 * Flags the edges a route passes along, given the cells it passes through in order (repeats
 * allowed). Two cells in a row that are not neighbours (the route clipped a third cell's corner
 * between them) are joined through the neighbour they share nearest the pair, so the route keeps
 * no gaps.
 * @param {object} graph - See TravelGraph.
 * @param {Iterable<number>} cells - Travel cells; any out of range is passed over.
 * @param {Uint8Array} flags - Set to 1 for each edge passed along.
 */
export function flagRoute(graph, cells, flags) {
    let previous = -1;
    for (const cell of cells) {
        if (!(Number.isInteger(cell) && cell >= 0 && cell < graph.count)) continue;
        if (previous >= 0 && cell !== previous) {
            const edge = edgeBetween(graph, previous, cell);
            if (edge >= 0) flags[edge] = 1;
            else {
                const between = sharedNeighbour(graph, previous, cell);
                if (between >= 0) {
                    flags[edgeBetween(graph, previous, between)] = 1;
                    flags[edgeBetween(graph, between, cell)] = 1;
                }
            }
        }
        previous = cell;
    }
}

/** The neighbour two cells share, the one with the shortest way through it, or -1. */
function sharedNeighbour(graph, a, b) {
    let best = -1;
    let bestKm = Infinity;
    for (let slot = graph.adjStart[a]; slot < graph.adjStart[a + 1]; slot++) {
        const middle = graph.adjCell[slot];
        const onward = edgeBetween(graph, middle, b);
        if (onward < 0) continue;
        const km = graph.edgeKm[graph.adjEdge[slot]] + graph.edgeKm[onward];
        if (km < bestKm) {
            bestKm = km;
            best = middle;
        }
    }
    return best;
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
 * Off-road pace at a cell for a way of travel: the share of the road's pace on open level ground
 * (more where the land is cleared for farming, see TRAVEL_TIME.OFF_ROAD), slowed by the cell's
 * land cost softened by TRAVEL_TIME.TERRAIN.
 * @param {object} graph - See TravelGraph.
 * @param {{speeds: Object<string, number>, mode: string, cleared?: ArrayLike<number>}} options
 * @param {number} cell
 * @returns {number} Km a day.
 */
export function groundPace(graph, { speeds, mode, cleared = null }, cell) {
    const { OFF_ROAD, TERRAIN } = FILRODENSWMB.TRAVEL_TIME;
    const share = OFF_ROAD[mode] ?? OFF_ROAD.foot;
    const farmed = Math.min(1, Math.max(0, cleared?.[cell] ?? 0));
    return (speeds[mode] * (share.wild + (share.cleared - share.wild) * farmed)) / Math.max(1, graph.landCost[cell]) ** TERRAIN;
}

/**
 * Each edge's time in days, each way: `out` from its first cell (edgeA) to its second, `back` the
 * other way.
 *
 * A sea step on the run's sea routes goes at the ship's speed, any other at a small boat's. A river
 * step on a river the run traded along goes at the river boat's speed for its direction; on any
 * other river no faster than a small boat. Going aboard at sea waits for passage (a town's harbour
 * briefly, elsewhere on the coast for days); coming ashore does not.
 *
 * @param {object} graph - See TravelGraph.
 * @param {object} options
 * @param {{foot: number, wagon: number, mount: number, riverDown: number, riverUp: number, sea: number, boat: number}} options.speeds - Per day, in km.
 * @param {string} options.mode - The way over land (a key of speeds).
 * @param {Uint8Array} [options.road] - 1 for each edge with a road (see roadEdges).
 * @param {Uint8Array} [options.lane] - 1 for each edge on a sea route.
 * @param {Uint8Array} [options.river] - 1 for each river edge the run traded along.
 * @param {Set<number>} [options.towns] - Cells with a town, whose harbours give passage soon.
 * @param {ArrayLike<number>} [options.cleared] - Each cell's share of land cleared for farming.
 * @param {number} [options.maxKm] - Edges longer than this are not travelled: the thin triangles
 *     along the map's edge join cells far apart, and a step along one would skip what lies between.
 * @returns {{out: Float64Array, back: Float64Array}}
 */
export function edgeDays(graph, options) {
    const { speeds, mode, road = null, lane = null, river = null, towns = null, maxKm = Infinity } = options;
    const { edgeA, edgeB, edgeKm, edgeKind, water, reliefTerm } = graph;
    const { TERRAIN, HARBOUR_DAYS, SHORE_DAYS } = FILRODENSWMB.TRAVEL_TIME;
    const count = edgeA.length;
    const out = new Float64Array(count);
    const back = new Float64Array(count);
    const road1 = speeds[mode];
    const boat = speeds.boat ?? speeds.sea;
    const pace = new Float64Array(graph.count);
    for (let cell = 0; cell < graph.count; cell++) pace[cell] = water[cell] ? 0 : groundPace(graph, options, cell);
    const slow = (cost) => Math.max(1, cost) ** TERRAIN;
    const roadDays = (a, b, km) => (km * 0.5 * (slow(reliefTerm[a]) + slow(reliefTerm[b]))) / road1;
    const groundDays = (a, b, km) => km * 0.5 * (1 / pace[a] + 1 / pace[b]);
    for (let edge = 0; edge < count; edge++) {
        const a = edgeA[edge];
        const b = edgeB[edge];
        const km = edgeKm[edge];
        const built = road?.[edge] === 1;
        let forward;
        let backward;
        if (km > maxKm) {
            out[edge] = back[edge] = Infinity;
            continue;
        }
        switch (edgeKind[edge]) {
            case EDGE.SEA:
                forward = backward = km / (lane?.[edge] === 1 ? speeds.sea : boat);
                break;
            case EDGE.PORT: {
                const land = water[a] ? b : a;
                const ashore = built ? (km * 0.5 * slow(reliefTerm[land])) / road1 : (km * 0.5) / pace[land];
                const afloat = (km * 0.5) / (lane?.[edge] === 1 ? speeds.sea : boat);
                const wait = towns?.has(land) ? HARBOUR_DAYS : SHORE_DAYS;
                // Going aboard is from the land cell to the water cell
                forward = ashore + afloat + (land === a ? wait : 0);
                backward = ashore + afloat + (land === b ? wait : 0);
                break;
            }
            case EDGE.RIVER: {
                const direction = riverDirection(graph, a, b);
                const traded = river?.[edge] === 1;
                const at = (speed) => km / (traded ? speed : Math.min(speed, boat));
                const down = at(speeds.riverDown);
                const up = at(speeds.riverUp);
                const level = at((speeds.riverDown + speeds.riverUp) / 2);
                forward = direction > 0 ? down : direction < 0 ? up : level;
                backward = direction > 0 ? up : direction < 0 ? down : level;
                const overland = built ? roadDays(a, b, km) : groundDays(a, b, km);
                forward = Math.min(forward, overland);
                backward = Math.min(backward, overland);
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
 * Lines at each band's edge (every `interval` days): where the time crosses it, across each
 * triangle of the model sites (time taken as varying evenly inside a triangle). A triangle with a
 * corner no one reaches gives no line.
 * @param {ArrayLike<number>} triangles - Corner cells, three per triangle.
 * @param {function(number): number} xOf - A cell's site.
 * @param {function(number): number} yOf
 * @param {Float64Array} days - Each cell's time.
 * @param {number} maxDays - The number of lines drawn.
 * @param {number} [interval] - Days between lines.
 * @returns {{day: number, segments: number[]}[]} Each line's day and its segments as x1, y1, x2, y2 runs.
 */
export function dayRings(triangles, xOf, yOf, days, maxDays, interval = 1) {
    const rings = Array.from({ length: maxDays }, (_, at) => ({ day: (at + 1) * interval, segments: [] }));
    for (let at = 0; at + 2 < triangles.length; at += 3) {
        const corners = [triangles[at], triangles[at + 1], triangles[at + 2]];
        // In bands, so each line falls at a whole number
        const values = corners.map((cell) => days[cell] / interval);
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

/**
 * A ring's segments joined into lines where they meet (the two triangles on either side of a side
 * give the same crossing point), so a ring is drawn as a few long lines rather than many short
 * ones.
 * @param {number[]} segments - x1, y1, x2, y2 runs (see dayRings).
 * @returns {number[][]} Each line's points as x, y pairs.
 */
export function joinSegments(segments) {
    const count = Math.floor(segments.length / 4);
    // Points closer than this are one point (rounding apart, the two triangles agree)
    const key = (x, y) => `${Math.round(x * 1000)},${Math.round(y * 1000)}`;
    const ends = new Map();
    const endKey = (segment, end) => key(segments[segment * 4 + end * 2], segments[segment * 4 + end * 2 + 1]);
    for (let segment = 0; segment < count; segment++) {
        for (const end of [0, 1]) {
            const at = endKey(segment, end);
            if (!ends.has(at)) ends.set(at, []);
            ends.get(at).push(segment * 2 + end);
        }
    }
    const used = new Uint8Array(count);
    // From a segment's end, the next unused segment meeting it, as segment * 2 + its end there
    const next = (segment, end) => {
        for (const other of ends.get(endKey(segment, end)) ?? []) if (!used[other >> 1]) return other;
        return -1;
    };
    const lines = [];
    for (let first = 0; first < count; first++) {
        if (used[first]) continue;
        used[first] = 1;
        const forward = [];
        const extend = (segment, end, into) => {
            let joint = next(segment, end);
            while (joint >= 0) {
                const other = joint >> 1;
                const far = 1 - (joint & 1);
                used[other] = 1;
                into.push(segments[other * 4 + far * 2], segments[other * 4 + far * 2 + 1]);
                joint = next(other, far);
            }
        };
        extend(first, 1, forward);
        const backward = [];
        extend(first, 0, backward);
        const line = [];
        for (let at = backward.length - 2; at >= 0; at -= 2) line.push(backward[at], backward[at + 1]);
        line.push(segments[first * 4], segments[first * 4 + 1], segments[first * 4 + 2], segments[first * 4 + 3]);
        for (const value of forward) line.push(value);
        lines.push(line);
    }
    return lines;
}
