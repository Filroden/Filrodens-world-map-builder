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
 * 2. **People:** each parent cell's country people (its people less those the inherited places drew
 *    from it) are shared among the in-fill cells inside it by the food each can grow. A town of the
 *    generator's tiers drew its people from the country within its tier's reach, as the run sized
 *    it, so it takes the same share of every parent cell there; a smaller place, its own cell's.
 * 3. **Near the network:** market towns and villages stand only within ROUTE_REACH_KM over land of
 *    an inherited road, river route or town (a big town further: TOWN_REACH_SCALE by its tier);
 *    beyond, the country people live in hamlets and farms (building even a track to the nearest
 *    road is costly, so settlement follows the roads). A map with no inherited road, river or town
 *    has no such limit.
 * 4. **Market towns:** a market serves the people within MARKET_REACH_DAYS on foot, along the
 *    tracks they would walk (a road's pace, slowed by hills). The settled cell beyond every town's
 *    reach, and further than that times the square root of the map's area factor from every
 *    market, with the most people round it becomes a market town if enough people beyond them all
 *    live within its reach (MARKET_MIN_SERVED), and so on. Markets so fill the gaps between the
 *    inherited towns but stand further apart as the area factor shows fewer places. Each draws
 *    MARKET_SHARE of the country people it serves, over the square root of the area factor, so it
 *    stays a market town's size though it serves more of them.
 * 5. **Villages:** about one settled cell in the map's area factor, picked by chance weighted by
 *    its country people (after its market's share), so they cluster in rich country without
 *    falling on a pattern; each holds its own cell's people (see placeVillages).
 * 6. **Lanes:** each market town is joined to the nearest inherited road or town, then each village
 *    to the nearest road, town, market or lane, along the quickest way on foot over land. The ways
 *    form one tree from the network, so lanes merge as they near it.
 * 7. **Names:** in the name base of the culture most of the parent cell's people belong to, none
 *    the same as a name already on the map (where avoidable).
 *
 * Deterministic for its seed.
 */

/**
 * @param {object} input
 * @param {object} input.payload - The generator's payload over the in-fill cells (see TravelNetwork).
 * @param {Int32Array} input.parentOf - Each in-fill cell's parent cell (-1 for none).
 * @param {{population: ArrayLike<number>, landArea?: ArrayLike<number>, cultureOf: ArrayLike<number>, nameBases: (string|null)[], sites?: ArrayLike<number>, kmPerPx?: number, mapSize?: {width: number, height: number}}} input.parent -
 *     Each parent cell's people and main culture, each culture's name base, and where each cell
 *     lies (x, y pairs in map pixels) with the run's km per map pixel and the map's size in pixels.
 * @param {{cell: number, population: number, x?: number, y?: number}[]} input.towns - The inherited places, by in-fill cell, with where each stands.
 * @param {{cells: number[], transport: string}[]} input.routes - The inherited routes, as the in-fill cells they pass through.
 * @param {Object<string, number>} input.speeds - The travel speeds (see TRAVEL_TIME.SPEEDS).
 * @param {string} input.seed
 * @param {string} input.nameBase - The name base where a culture names none.
 * @param {Uint8Array} [input.dry] - Each cell's flag: 1 where a place could stand clear of the drawn rivers (see InfillInput.dryCell).
 * @param {number} [input.areaFactor] - The map's area factor: about one settled cell in this many has a village (see placeVillages).
 * @param {Iterable<string>} [input.names] - Names already on the map.
 * @param {object} [input.options] - Overrides of FILRODENSWMB.INFILL.
 * @returns {{places: {cell: number, tier: string, population: number, name: string}[], lanes: {cells: number[]}[], people: Float64Array, stats: object}}
 */
export function runInfill(input) {
    const options = { ...FILRODENSWMB.INFILL, areaFactor: input.areaFactor ?? FILRODENSWMB.MESH.AREA_FACTOR, ...(input.options ?? {}) };
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
    const near = time("reach", () => nearNetwork(graph, flags, townReach(input.towns, count, options), options.ROUTE_REACH_KM));
    // A cell wholly under a river as the map draws it has nowhere for a place to stand
    if (input.dry) for (let cell = 0; cell < count; cell++) if (!input.dry[cell]) near[cell] = 0;
    const markets = time("markets", () => placeMarkets(graph, trackDays, people, townCells, near, options));
    const catchment = nearestOf(graph, trackDays, [...townCells, ...markets.map((market) => market.cell)]);
    const marketIndex = new Map(markets.map((market, index) => [market.cell, index]));
    // A market draws its share of the country people it serves
    const drawn = new Float64Array(markets.length);
    for (let cell = 0; cell < count; cell++) {
        const index = marketIndex.get(catchment.source[cell]);
        if (index === undefined || !(people[cell] > 0)) continue;
        const share = (people[cell] * options.MARKET_SHARE) / Math.sqrt(Math.max(1, options.areaFactor));
        drawn[index] += share;
        people[cell] -= share;
    }
    markets.forEach((market, index) => (market.population = Math.max(options.MARKET_MIN_POP, Math.round(drawn[index]))));

    const taken = new Set([...townCells, ...markets.map((market) => market.cell)]);
    const { villages, villagesLeftOut } = time("villages", () => placeVillages(graph, people, taken, near, options, stageRandom(input.seed, "infill-villages")));

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
            people: Math.round(people.reduce((sum, value) => sum + value, 0) + places.reduce((sum, place) => sum + (place.tier === "marketTown" ? place.population : 0), 0)),
            markets: markets.length,
            villages: villages.length,
            villagesLeftOut,
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
 * Each in-fill cell's country people: its parent cell's people less those the inherited places drew
 * from it (see townDraw), shared among the parent cell's land in-fill cells by the food each grows
 * (evenly where none grows any). A parent cell with no land in-fill cell (the regional map's coast
 * differs) keeps its people out of the in-fill, and one partly off the map brings only the share of
 * its land on it.
 */
function sharePeople(cells, { parentOf, parent, towns }) {
    const count = cells.count;
    const parents = parent.population.length;
    const landKm2 = new Float64Array(parents);
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
    const onMapPeople = Float64Array.from({ length: parents }, (_, owner) => (landCells[owner] > 0 ? parent.population[owner] * onMap[owner] : 0));
    const townPeople = townDraw(towns, { parentOf, parent, count, onMapPeople });
    const people = new Float64Array(count);
    for (let cell = 0; cell < count; cell++) {
        const owner = parentOf[cell];
        if (owner < 0 || cells.water[cell]) continue;
        const country = Math.max(0, onMapPeople[owner] - townPeople[owner]);
        people[cell] = country * (food[owner] > 0 ? Math.max(0, cells.food[cell]) / food[owner] : 1 / landCells[owner]);
    }
    return people;
}

/**
 * The people the inherited places drew from each parent cell.
 *
 * A town big enough for one of the generator's tiers (GENERATOR.TOWNS.TIERS, the largest whose
 * minimum it reaches) was sized from the people of its catchment, as far as that tier's reach: a
 * capital of 200,000 draws on a whole realm, not on the 25 km cell it stands in. So it takes the
 * same share of every parent cell within that reach, as much as they hold. Where most of its reach
 * lies beyond the map, the part beyond is taken to hold its share of the people (as many for its
 * area as the part on the map), so the map's cells give only theirs. A smaller place (a village or
 * market town an earlier fill-in made) holds its own cell's people.
 *
 * Without where the parent cells lie, every place draws on its own cell.
 */
function townDraw(towns, { parentOf, parent, count, onMapPeople }) {
    const parents = onMapPeople.length;
    const drawn = new Float64Array(parents);
    const sites = parent.sites;
    const kmPerPx = parent.kmPerPx;
    const tiers = FILRODENSWMB.GENERATOR.TOWNS.TIERS;
    for (const town of towns) {
        const owner = town.cell >= 0 && town.cell < count ? parentOf[town.cell] : -1;
        if (owner < 0 || !(town.population > 0)) continue;
        const tier = tiers.find((candidate) => town.population >= candidate.minPop);
        if (!tier || !sites || !(kmPerPx > 0) || !Number.isFinite(town.x) || !Number.isFinite(town.y)) {
            drawn[owner] += town.population;
            continue;
        }
        const reachPx = tier.reachKm / kmPerPx;
        const within = [];
        let reachPeople = 0;
        for (let cell = 0; cell < parents; cell++) {
            if (!(onMapPeople[cell] > 0)) continue;
            if (Math.hypot(sites[2 * cell] - town.x, sites[2 * cell + 1] - town.y) > reachPx) continue;
            within.push(cell);
            reachPeople += onMapPeople[cell];
        }
        if (!(reachPeople > 0)) {
            drawn[owner] += town.population;
            continue;
        }
        // The part of its reach beyond the map gave the rest
        const onMapShare = parent.mapSize ? discOnMap(town.x, town.y, reachPx, parent.mapSize) : 1;
        const share = Math.min(1, (town.population * onMapShare) / reachPeople);
        for (const cell of within) drawn[cell] += onMapPeople[cell] * share;
    }
    return drawn;
}

/** The share of a disc (centre and radius in map pixels) that lies on the map, sampled on a grid. */
function discOnMap(cx, cy, radius, { width, height }) {
    const STEPS = 48;
    let inside = 0;
    let onMap = 0;
    for (let i = 0; i < STEPS; i++) {
        for (let j = 0; j < STEPS; j++) {
            const x = cx - radius + ((i + 0.5) / STEPS) * 2 * radius;
            const y = cy - radius + ((j + 0.5) / STEPS) * 2 * radius;
            if (Math.hypot(x - cx, y - cy) > radius) continue;
            inside++;
            if (x >= 0 && x <= width && y >= 0 && y <= height) onMap++;
        }
    }
    return inside ? onMap / inside : 1;
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
 * How much further than ROUTE_REACH_KM each town's cell reaches, in km: a town of the generator's
 * tiers (the largest whose minimum it reaches) by its tier's TOWN_REACH_SCALE, any other none.
 * @returns {Map<number, number>} Each town cell's extra reach.
 */
function townReach(towns, count, options) {
    const tiers = FILRODENSWMB.GENERATOR.TOWNS.TIERS;
    const scales = options.TOWN_REACH_SCALE ?? [];
    const extra = new Map();
    for (const town of towns) {
        if (!(town.cell >= 0 && town.cell < count)) continue;
        const tier = tiers.findIndex((candidate) => town.population >= candidate.minPop);
        const more = tier >= 0 ? Math.max(0, (scales[tier] ?? 1) - 1) * options.ROUTE_REACH_KM : 0;
        extra.set(town.cell, Math.max(extra.get(town.cell) ?? 0, more));
    }
    return extra;
}

/**
 * The cells within `limitKm` over land of the inherited network: a road or river route, or a town,
 * a town's cell reaching further by its extra reach (1 where a place may stand). All of them when
 * there is no network at all.
 * @param {Map<number, number>} townCells - Each town cell's extra reach, in km.
 */
function nearNetwork(graph, flags, townCells, limitKm) {
    const count = graph.count;
    const near = new Uint8Array(count);
    const best = new Float64Array(count).fill(Infinity);
    const heap = new MinHeap(1024);
    const start = (cell) => {
        if (cell >= 0 && cell < count && best[cell] > 0) {
            best[cell] = 0;
            heap.push(0, cell);
        }
    };
    for (let edge = 0; edge < graph.edgeA.length; edge++) {
        if (!flags.road[edge] && !flags.river[edge]) continue;
        start(graph.edgeA[edge]);
        start(graph.edgeB[edge]);
    }
    // A town starts as far below zero as it reaches beyond the limit
    for (const [cell, extra] of townCells) {
        if (cell >= 0 && cell < count && best[cell] > -extra) {
            best[cell] = -extra;
            heap.push(-extra, cell);
        }
    }
    if (!heap.size) return near.fill(1);
    while (heap.size) {
        const km = heap.peekPriority();
        const cell = heap.pop();
        if (km > best[cell]) continue;
        near[cell] = 1;
        for (let slot = graph.adjStart[cell]; slot < graph.adjStart[cell + 1]; slot++) {
            const edge = graph.adjEdge[slot];
            const kind = graph.edgeKind[edge];
            if (kind === EDGE.SEA || kind === EDGE.PORT) continue;
            const next = graph.adjCell[slot];
            const arrive = km + graph.edgeKm[edge];
            if (arrive <= limitKm && arrive < best[next]) {
                best[next] = arrive;
                heap.push(arrive, next);
            }
        }
    }
    return near;
}

/**
 * Market towns: the settled cells near the network and beyond every town's reach
 * (MARKET_REACH_DAYS) and every market's (that times the square root of the area factor), most
 * people round them first, each becoming a market when enough people beyond every town's and
 * market's reach (MARKET_MIN_SERVED) live within its own. Reach only grows as markets are added,
 * so a cell passed over stays passed over, and each cell is tried once. Markets fill the gaps
 * between the inherited towns as before, but stand further apart from one another.
 */
function placeMarkets(graph, days, people, townCells, near, options) {
    const count = graph.count;
    const score = new Float64Array(count);
    const candidates = [];
    for (let cell = 0; cell < count; cell++) {
        if (!near[cell] || !(people[cell] >= options.VILLAGE_MIN_POP)) continue;
        let sum = people[cell];
        for (let slot = graph.adjStart[cell]; slot < graph.adjStart[cell + 1]; slot++) sum += people[graph.adjCell[slot]];
        score[cell] = sum;
        candidates.push(cell);
    }
    candidates.sort((a, b) => score[b] - score[a] || a - b);
    const limit = options.MARKET_REACH_DAYS;
    const spacing = limit * Math.sqrt(Math.max(1, options.areaFactor));
    const towns = nearestOf(graph, days, townCells);
    const others = nearestOf(graph, days, []);
    const unserved = (cell) => towns.best[cell] > limit && others.best[cell] > spacing;
    const markets = [];
    for (const cell of candidates) {
        if (!unserved(cell)) continue;
        if (servedWithin(graph, days, cell, limit, (other) => (unserved(other) ? people[other] : 0)) < options.MARKET_MIN_SERVED) continue;
        markets.push({ cell, tier: "marketTown", population: 0 });
        others.add(cell);
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
 * Villages: about one in `areaFactor` of the settled cells near the network (the share a map's
 * area factor shows; see MESH.AREA_FACTOR), picked by chance weighted by the cell's country
 * people, so dense country has more of them but none fall on a regular pattern (a weighted
 * sample: each cell's key is u^(1/w) for a draw u and its people w, highest first). A village is
 * never next to another village, a town or a market. It holds its own cell's country people (at
 * least VILLAGE_MIN_POP, at most VILLAGE_MAX_POP), and with at least LARGE_VILLAGE_POP is a large
 * village (shown a detail level sooner); the people of the cells without one live in hamlets and
 * farms. At most MAX_VILLAGES.
 */
function placeVillages(graph, people, taken, near, options, random) {
    const count = graph.count;
    const settled = (cell) => !graph.water[cell] && !taken.has(cell) && people[cell] > 0;
    const neighbours = (cell, visit) => {
        for (let slot = graph.adjStart[cell]; slot < graph.adjStart[cell + 1]; slot++) visit(graph.adjCell[slot]);
    };
    // The log of u^(1/w), which sorts the same and does not underflow
    const key = new Float64Array(count);
    const candidates = [];
    for (let cell = 0; cell < count; cell++) {
        // One draw per cell whatever it holds, so a change in one cell's people moves no other's draw
        const draw = random();
        if (!near[cell] || !settled(cell) || people[cell] < options.VILLAGE_MIN_POP) continue;
        key[cell] = Math.log(Math.max(draw, Number.MIN_VALUE)) / people[cell];
        candidates.push(cell);
    }
    candidates.sort((a, b) => key[b] - key[a] || a - b);
    const wanted = Math.ceil(candidates.length / Math.max(1, options.areaFactor));
    const target = Math.min(options.MAX_VILLAGES, wanted);

    const blocked = new Uint8Array(count);
    const block = (cell) => {
        blocked[cell] = 1;
        neighbours(cell, (other) => (blocked[other] = 1));
    };
    for (const cell of taken) if (cell >= 0 && cell < count) block(cell);
    const picked = [];
    for (const cell of candidates) {
        if (picked.length >= target) break;
        if (blocked[cell]) continue;
        picked.push(cell);
        block(cell);
    }

    const villages = picked
        .map((cell) => {
            const population = Math.round(Math.min(people[cell], options.VILLAGE_MAX_POP));
            return { cell, tier: population >= options.LARGE_VILLAGE_POP ? "largeVillage" : "village", population };
        })
        .sort((a, b) => b.population - a.population || a.cell - b.cell);
    return { villages, villagesLeftOut: Math.max(0, wanted - target) };
}

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
