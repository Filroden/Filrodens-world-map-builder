import { NamesGenerator } from "../../vendor/azgaar-names/names-generator.js";
import { FILRODENSWMB } from "../config.js";
import { MinHeap } from "../mesh/MinHeap.js";
import { EDGE } from "./CellGraph.js";
import { stageRandom } from "./Random.js";
import { routeChains } from "./RouteChains.js";
import { travelCells, travelShape } from "../travel/TravelGraph.js";
import { edgeDays, flagRoute } from "../travel/TravelTime.js";

/**
 * Regional in-fill: villages and market towns between the places a regional map inherited from
 * its parent's run, joined to them by local lanes. Everything inherited stays as it is; in-fill only
 * adds, and never invents people the parent's run did not have.
 *
 * 1. **Cells:** the in-fill cells (finer than the generator's; see TravelGrid), with their land,
 *    food and travel figures from the regional map's own terrain (TravelGraph.travelCells).
 * 2. **People:** each parent cell's country people (its people less those of the inherited places
 *    in it) are shared among the in-fill cells inside it by the food each can grow.
 * 3. **Market towns:** a market serves the people within MARKET_REACH_DAYS on foot, along the
 *    tracks they would walk (a road's pace, slowed by hills). The settled cell beyond every town's
 *    reach with the most people round it becomes a market town if enough people beyond every
 *    town's reach live within its own (MARKET_MIN_SERVED), and so on. Markets therefore stand
 *    about a day's round trip apart where the land is settled, further apart where it is not, and
 *    none crowds an inherited town. Each draws MARKET_SHARE of the country people it serves.
 * 4. **Villages:** one in each settled cell with at least VILLAGE_MIN_POP country people (after
 *    its market's share), or, where that would be more than MAX_VILLAGES, spaced a step or more
 *    apart, each gathering the people round it (see placeVillages).
 * 5. **Lanes:** each market town is joined to the nearest inherited road or town, then each village
 *    to the nearest road, town, market or lane, along the quickest way on foot over land. The ways
 *    form one tree from the network, so lanes merge as they near it.
 * 6. **Names:** in the name base of the culture most of the parent cell's people belong to, none
 *    the same as a name already on the map (where avoidable).
 *
 * Deterministic for its seed.
 */

/**
 * @param {object} input
 * @param {object} input.payload - The generator's payload over the in-fill cells (see TravelNetwork).
 * @param {Int32Array} input.parentOf - Each in-fill cell's parent cell (-1 for none).
 * @param {{population: ArrayLike<number>, landArea?: ArrayLike<number>, cultureOf: ArrayLike<number>, nameBases: (string|null)[]}} input.parent -
 *     Each parent cell's people and main culture, and each culture's name base.
 * @param {{cell: number, population: number}[]} input.towns - The inherited places, by in-fill cell.
 * @param {{cells: number[], transport: string}[]} input.routes - The inherited routes, as the in-fill cells they pass through.
 * @param {Object<string, number>} input.speeds - The travel speeds (see TRAVEL_TIME.SPEEDS).
 * @param {string} input.seed
 * @param {string} input.nameBase - The name base where a culture names none.
 * @param {Iterable<string>} [input.names] - Names already on the map.
 * @param {object} [input.options] - Overrides of FILRODENSWMB.INFILL.
 * @returns {{places: {cell: number, tier: string, population: number, name: string}[], lanes: {cells: number[]}[], people: Float64Array, stats: object}}
 */
export function runInfill(input) {
    const options = { ...FILRODENSWMB.INFILL, ...(input.options ?? {}) };
    const timings = {};
    const time = (name, work) => {
        const start = performance.now();
        const result = work();
        timings[name] = Math.round(performance.now() - start);
        return result;
    };
    const [cells, cellGraph] = time("cells", () => travelCells(input.payload));
    const graph = travelShape(cells, cellGraph);
    const count = graph.count;

    const people = time("people", () => sharePeople(cells, input));
    const townCells = new Set(input.towns.map((town) => town.cell).filter((cell) => cell >= 0 && cell < count));

    // Days on foot, over the inherited roads (and rivers and sea routes, for reach)
    const flags = { road: new Uint8Array(graph.edgeA.length), river: new Uint8Array(graph.edgeA.length), sea: new Uint8Array(graph.edgeA.length) };
    for (const route of input.routes) flagRoute(graph, route.cells, flags[route.transport] ?? flags.road);
    const days = edgeDays(graph, { speeds: input.speeds, mode: "foot", road: flags.road, river: flags.river, lane: flags.sea, maxKm: 2.5 * meanEdgeKm(graph) });

    // A market's reach is measured along the tracks its people walk to it, so as if every step
    // over land had one (at a road's pace, slowed by hills), and by river and sea as usual
    const trackDays = edgeDays(graph, { speeds: input.speeds, mode: "foot", road: new Uint8Array(graph.edgeA.length).fill(1), river: flags.river, lane: flags.sea, maxKm: 2.5 * meanEdgeKm(graph) });
    const markets = time("markets", () => placeMarkets(graph, trackDays, people, townCells, options));
    const catchment = nearestOf(graph, trackDays, [...townCells, ...markets.map((market) => market.cell)]);
    const marketIndex = new Map(markets.map((market, index) => [market.cell, index]));
    // A market draws its share of the country people it serves
    const drawn = new Float64Array(markets.length);
    for (let cell = 0; cell < count; cell++) {
        const index = marketIndex.get(catchment.source[cell]);
        if (index === undefined || !(people[cell] > 0)) continue;
        const share = people[cell] * options.MARKET_SHARE;
        drawn[index] += share;
        people[cell] -= share;
    }
    markets.forEach((market, index) => (market.population = Math.max(options.MARKET_MIN_POP, Math.round(drawn[index]))));

    const taken = new Set([...townCells, ...markets.map((market) => market.cell)]);
    const { villages, villagesLeftOut, villageHops } = time("villages", () => placeVillages(graph, people, taken, options));

    const lanes = time("lanes", () => buildLanes(graph, cellGraph, days, { roadEdges: flags.road, townCells, markets, villages }));
    const places = [...markets, ...villages];
    time("names", () => namePlaces(places, input));
    return {
        places,
        lanes,
        people,
        stats: {
            cells: count,
            landCells: graph.water.reduce((sum, water) => sum + (water ? 0 : 1), 0),
            people: Math.round(people.reduce((sum, value) => sum + value, 0) + places.reduce((sum, place) => sum + (place.tier === "village" ? 0 : place.population), 0)),
            markets: markets.length,
            villages: villages.length,
            villagesLeftOut,
            villageHops,
            lanes: lanes.length,
            laneKm: Math.round(lanes.reduce((sum, lane) => sum + lane.km, 0)),
            timings,
        },
    };
}

/** The mean edge length, in km. */
function meanEdgeKm(graph) {
    let sum = 0;
    for (const km of graph.edgeKm) sum += km;
    return sum / Math.max(1, graph.edgeKm.length);
}

/**
 * Each in-fill cell's country people: its parent cell's people less those of the inherited places in
 * it, shared among the parent cell's land in-fill cells by the food each grows (evenly where none
 * grows any). A parent cell with no land in-fill cell (the regional map's coast differs) keeps its
 * people out of the in-fill, and one partly off the map brings only the share of its land on it.
 */
function sharePeople(cells, { parentOf, parent, towns }) {
    const count = cells.count;
    const parents = parent.population.length;
    const landKm2 = new Float64Array(parents);
    const townPeople = new Float64Array(parents);
    for (const town of towns) {
        const owner = town.cell >= 0 && town.cell < count ? parentOf[town.cell] : -1;
        if (owner >= 0) townPeople[owner] += town.population;
    }
    const food = new Float64Array(parents);
    const landCells = new Float64Array(parents);
    for (let cell = 0; cell < count; cell++) {
        const owner = parentOf[cell];
        if (owner < 0 || cells.water[cell]) continue;
        food[owner] += Math.max(0, cells.food[cell]);
        landCells[owner] += 1;
        landKm2[owner] += cells.landKm2[cell];
    }
    // A parent cell at the map's edge lies partly off it: only the share of its land on the map
    // brings its people
    const onMap = Float64Array.from({ length: parents }, (_, owner) => (parent.landArea?.[owner] > 0 ? Math.min(1, landKm2[owner] / parent.landArea[owner]) : 1));
    const people = new Float64Array(count);
    for (let cell = 0; cell < count; cell++) {
        const owner = parentOf[cell];
        if (owner < 0 || cells.water[cell]) continue;
        const country = Math.max(0, parent.population[owner] * onMap[owner] - townPeople[owner]);
        people[cell] = country * (food[owner] > 0 ? Math.max(0, cells.food[cell]) / food[owner] : 1 / landCells[owner]);
    }
    return people;
}

/** The step from `from` to `to` along an edge, in days (the edge's way of travel that direction). */
const stepDays = (graph, days, edge, from) => (graph.edgeA[edge] === from ? days.out[edge] : days.back[edge]);

/**
 * Each cell's nearest source on foot, walking from the cell to the source: its days and source.
 * Sources may be added one at a time (`add`), each search going only where it is nearer.
 */
function nearestOf(graph, days, sources) {
    const count = graph.count;
    const best = new Float64Array(count).fill(Infinity);
    const source = new Int32Array(count).fill(-1);
    const heap = new MinHeap(1024);
    const add = (start) => {
        if (!(start >= 0 && start < count) || best[start] === 0) return;
        best[start] = 0;
        source[start] = start;
        heap.push(0, start);
        while (heap.size) {
            const time = heap.peekPriority();
            const cell = heap.pop();
            if (time > best[cell]) continue;
            for (let slot = graph.adjStart[cell]; slot < graph.adjStart[cell + 1]; slot++) {
                const next = graph.adjCell[slot];
                // The walk runs from `next` towards the source
                const arrive = time + stepDays(graph, days, graph.adjEdge[slot], next);
                if (arrive < best[next]) {
                    best[next] = arrive;
                    source[next] = start;
                    heap.push(arrive, next);
                }
            }
        }
    };
    for (const start of sources) add(start);
    return { best, source, add };
}

/**
 * Market towns: the settled cells beyond every town's reach, most people round them first, each
 * becoming a market when enough people beyond every town's reach (MARKET_MIN_SERVED) live within
 * its own. Reach only grows as markets are added, so a cell passed over stays passed over, and
 * each cell is tried once.
 */
function placeMarkets(graph, days, people, townCells, options) {
    const count = graph.count;
    const score = new Float64Array(count);
    const candidates = [];
    for (let cell = 0; cell < count; cell++) {
        if (!(people[cell] >= options.VILLAGE_MIN_POP)) continue;
        let sum = people[cell];
        for (let slot = graph.adjStart[cell]; slot < graph.adjStart[cell + 1]; slot++) sum += people[graph.adjCell[slot]];
        score[cell] = sum;
        candidates.push(cell);
    }
    candidates.sort((a, b) => score[b] - score[a] || a - b);
    const reach = nearestOf(graph, days, townCells);
    const limit = options.MARKET_REACH_DAYS;
    const markets = [];
    for (const cell of candidates) {
        if (reach.best[cell] <= limit) continue;
        if (servedWithin(graph, days, cell, limit, (other) => (reach.best[other] > limit ? people[other] : 0)) < options.MARKET_MIN_SERVED) continue;
        markets.push({ cell, tier: "marketTown", population: 0 });
        reach.add(cell);
    }
    return markets;
}

/** The people within `limit` days' walk of a cell (walking to it), counted by `count(cell)`. */
function servedWithin(graph, days, start, limit, count) {
    const best = new Map([[start, 0]]);
    const heap = new MinHeap(64);
    heap.push(0, start);
    let total = 0;
    while (heap.size) {
        const time = heap.peekPriority();
        const cell = heap.pop();
        if (time > best.get(cell)) continue;
        total += count(cell);
        for (let slot = graph.adjStart[cell]; slot < graph.adjStart[cell + 1]; slot++) {
            const next = graph.adjCell[slot];
            const arrive = time + stepDays(graph, days, graph.adjEdge[slot], next);
            if (arrive <= limit && arrive < (best.get(next) ?? Infinity)) {
                best.set(next, arrive);
                heap.push(arrive, next);
            }
        }
    }
    return total;
}

/**
 * Villages: the settled cells with the most country people first, each blocking the cells within
 * `hops` steps of it, the fewest hops (0, one per cell) that keep them to MAX_VILLAGES; so where
 * there are too many for one per cell they thin out evenly, a walk further apart, rather than the
 * sparser country losing all of its own. Each village gathers the country people of the settled
 * cells nearest it within those steps (at most VILLAGE_MAX_POP; the rest live in its hamlets and
 * farms), and needs VILLAGE_MIN_POP of them. Past MAX_VILLAGES even so, the largest are kept.
 */
function placeVillages(graph, people, taken, options) {
    const count = graph.count;
    const settled = (cell) => !graph.water[cell] && !taken.has(cell) && people[cell] > 0;
    const candidates = [];
    for (let cell = 0; cell < count; cell++) if (settled(cell)) candidates.push(cell);
    candidates.sort((a, b) => people[b] - people[a] || a - b);
    const within = (start, hops, visit) => {
        let ring = [start];
        const seen = new Set(ring);
        for (let step = 0; step <= hops && ring.length; step++) {
            for (const cell of ring) visit(cell, step);
            if (step === hops) break;
            const next = [];
            for (const cell of ring) {
                for (let slot = graph.adjStart[cell]; slot < graph.adjStart[cell + 1]; slot++) {
                    const other = graph.adjCell[slot];
                    if (seen.has(other) || graph.water[other]) continue;
                    seen.add(other);
                    next.push(other);
                }
            }
            ring = next;
        }
    };
    let picked = [];
    let hops = 0;
    for (; hops <= MAX_VILLAGE_HOPS; hops++) {
        const blocked = new Uint8Array(count);
        picked = [];
        for (const cell of candidates) {
            if (blocked[cell] || people[cell] < options.VILLAGE_MIN_POP / (hops + 1)) continue;
            picked.push(cell);
            within(cell, hops, (other) => (blocked[other] = 1));
        }
        if (picked.length <= options.MAX_VILLAGES) break;
    }
    hops = Math.min(hops, MAX_VILLAGE_HOPS);
    // Each settled cell's people go to the nearest village within those steps
    const gathered = new Float64Array(count);
    const owner = new Int32Array(count).fill(-1);
    const step = new Float64Array(count).fill(Infinity);
    for (const village of picked) {
        within(village, hops, (other, distance) => {
            if (settled(other) && distance < step[other]) {
                step[other] = distance;
                owner[other] = village;
            }
        });
    }
    for (let cell = 0; cell < count; cell++) if (owner[cell] >= 0) gathered[owner[cell]] += people[cell];
    let villages = picked
        .filter((cell) => gathered[cell] >= options.VILLAGE_MIN_POP)
        .map((cell) => ({ cell, tier: "village", population: Math.round(Math.min(gathered[cell], options.VILLAGE_MAX_POP)) }))
        .sort((a, b) => b.population - a.population || a.cell - b.cell);
    const villagesLeftOut = Math.max(0, villages.length - options.MAX_VILLAGES);
    villages = villages.slice(0, options.MAX_VILLAGES);
    return { villages, villagesLeftOut, villageHops: hops };
}

/** The furthest apart villages thin out to (steps between cells). */
const MAX_VILLAGE_HOPS = 3;

/**
 * The lanes: each market joined to the nearest inherited road or town, then each village to the
 * nearest road, town, market or lane, along the quickest way on foot over land; chained between
 * places, junctions and ends (see RouteChains), each with its cells and length.
 */
function buildLanes(graph, cellGraph, days, { roadEdges, townCells, markets, villages }) {
    const count = graph.count;
    // Over land only, the same either way: a lane does not take ship
    const cost = new Float64Array(graph.edgeA.length);
    for (let edge = 0; edge < cost.length; edge++) {
        const kind = graph.edgeKind[edge];
        cost[edge] = kind === EDGE.SEA || kind === EDGE.PORT ? Infinity : 0.5 * (days.out[edge] + days.back[edge]);
    }
    const network = new Uint8Array(count);
    for (let edge = 0; edge < roadEdges.length; edge++) {
        if (!roadEdges[edge]) continue;
        network[graph.edgeA[edge]] = 1;
        network[graph.edgeB[edge]] = 1;
    }
    for (const cell of townCells) network[cell] = 1;
    const lane = new Float64Array(graph.edgeA.length);
    const join = (places) => {
        const sources = [];
        for (let cell = 0; cell < count; cell++) if (network[cell]) sources.push(cell);
        // With no road or town at all, the largest place starts the network
        if (!sources.length && places.length) {
            network[places[0].cell] = 1;
            sources.push(places[0].cell);
        }
        const via = treeFrom(graph, cost, sources);
        for (const place of places) {
            let cell = place.cell;
            while (!network[cell] && via[cell] >= 0) {
                const edge = via[cell];
                lane[edge] = 1;
                network[cell] = 1;
                cell = graph.edgeA[edge] === cell ? graph.edgeB[edge] : graph.edgeA[edge];
            }
        }
    };
    join(markets);
    join(villages);
    const nodes = [...townCells, ...markets.map((market) => market.cell), ...villages.map((village) => village.cell)];
    return routeChains(cellGraph, lane, nodes).map((chain) => {
        let km = 0;
        for (let at = 1; at < chain.cells.length; at++) {
            const edge = cellGraph.edge(chain.cells[at - 1], chain.cells[at]);
            if (edge >= 0) km += graph.edgeKm[edge];
        }
        return { cells: chain.cells, km };
    });
}

/** The quickest-way tree from a set of cells: each cell's edge towards its nearest source (-1 for a source or none). */
function treeFrom(graph, cost, sources) {
    const count = graph.count;
    const best = new Float64Array(count).fill(Infinity);
    const via = new Int32Array(count).fill(-1);
    const heap = new MinHeap(1024);
    for (const cell of sources) {
        best[cell] = 0;
        heap.push(0, cell);
    }
    while (heap.size) {
        const time = heap.peekPriority();
        const cell = heap.pop();
        if (time > best[cell]) continue;
        for (let slot = graph.adjStart[cell]; slot < graph.adjStart[cell + 1]; slot++) {
            const next = graph.adjCell[slot];
            const edge = graph.adjEdge[slot];
            const arrive = time + cost[edge];
            if (arrive < best[next]) {
                best[next] = arrive;
                via[next] = edge;
                heap.push(arrive, next);
            }
        }
    }
    return via;
}

/**
 * Names, largest place first, each in the name base of its parent cell's main culture, retried a
 * few times to avoid a name already used (on the map or by in-fill).
 */
function namePlaces(places, { parentOf, parent, seed, nameBase, names = [] }) {
    const generator = new NamesGenerator(stageRandom(seed, "infill"));
    const fallback = Math.max(0, generator.indexOf(nameBase));
    const baseOf = (cell) => {
        const culture = parentOf[cell] >= 0 ? parent.cultureOf[parentOf[cell]] : -1;
        const index = culture >= 0 && parent.nameBases[culture] ? generator.indexOf(parent.nameBases[culture]) : -1;
        return index >= 0 ? index : fallback;
    };
    const used = new Set(names);
    const order = places.map((place, index) => index).sort((a, b) => places[b].population - places[a].population || places[a].cell - places[b].cell);
    for (const index of order) {
        const base = baseOf(places[index].cell);
        let name = generator.getBase(base);
        for (let attempt = 0; attempt < FILRODENSWMB.GENERATOR.NAME_RETRIES && used.has(name); attempt++) name = generator.getBase(base);
        used.add(name);
        places[index].name = name;
    }
}
