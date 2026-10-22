import { FILRODENSWMB } from "../config.js";
import { EDGE, portCost, travelCost } from "./CellGraph.js";
import { affinity, townMix } from "./Cultures.js";
import { SearchSpace, leastCostPerKm } from "./Search.js";

/**
 * Stage 3: trade rounds and routes.
 *
 * Towns are linked by a gravity model (trade grows with the two places' sizes and falls with the
 * square of the cost between them): each city with its strongest city partners plus a spanning
 * tree so no city is cut off, each large town with its strongest city or large-town partners, and
 * each town with its nearest bigger place (its market). Each link is laid as a least-cost path,
 * strongest first, and a road or sea lane, once built, makes the way cheaper for the links after it,
 * so the network concentrates into trunk routes. Navigable rivers carry trade without being built.
 *
 * The trade through and transferring at each cell (crossroads, ports) then becomes extra townspeople:
 * a share of the population spread by trade score, recomputed each round from the towns' base
 * sizes rather than added up. A busy cell with no town near it becomes a trade town; a trade town
 * that loses its trade fades away; towns are re-tiered by population but never below their base
 * tier. The next round re-links with the new sizes over the roads already built.
 *
 * The final round (after the feedback pass) starts from the roads and lanes already built and the
 * towns as the feedback pass left them, their trade share removed so it is recomputed, and traders
 * avoid insecure ground.
 *
 * Like every stage, this is a generator yielding its progress (0 to 1).
 */

/** How many link paths are laid between progress reports. */
const REPORT_EVERY = 32;

/**
 * @param {import("./CellGraph.js").CellGraph} graph
 * @param {object} context
 * @param {object[]} context.towns - Stage 2's towns, or the feedback pass's (final round).
 * @param {Float64Array} context.cellPop
 * @param {number} context.totalPop
 * @param {import("./Cultures.js").CultureData} context.cultures
 * @param {{urbanisation: number}} context.world
 * @param {object} [context.final] - { traffic (the earlier rounds' traffic per edge), security, royalSeats: Set }
 * @param {Uint8Array} [context.built] - Edges the age before built as roads and lanes (see Pipeline):
 *     the first round starts from them.
 * @returns {Generator<number, {towns: object[], traffic: Float64Array, newRoadKm: number}>}
 */
export function* tradeRounds(graph, context) {
    const state = createState(graph, context);
    const rounds = context.final ? 1 : FILRODENSWMB.GENERATOR.TRADE.ROUNDS;
    for (let round = 0; round < rounds; round++) {
        yield* tradeRound(state, (done) => (round + done) / rounds);
    }
    return finishTowns(state);
}

function createState(graph, context) {
    const cells = graph.cells;
    const final = context.final ?? null;
    const towns = final ? finalTowns(context.towns, final.royalSeats) : context.towns.map((town) => ({ ...town, stage2Pop: town.population }));
    const state = {
        graph,
        cells,
        context,
        final,
        towns,
        townAt: new Int32Array(cells.count).fill(-1),
        road: new Uint8Array(graph.edgeCount),
        traffic: new Float64Array(graph.edgeCount),
        space: new SearchSpace(graph),
        mixed: context.cultures.cultures.length > 1,
        tierMin: FILRODENSWMB.GENERATOR.TOWNS.TIERS.map((tier) => tier.minPop),
        newRoadKm: 0,
    };
    if (final) preloadRoads(state, final.traffic);
    else if (context.built) for (let edge = 0; edge < graph.edgeCount; edge++) if (context.built[edge]) state.road[edge] = 1;
    indexTowns(state);
    return state;
}

/** The towns entering the final round: their trade share removed, realm seats kept as cities. */
function finalTowns(towns, royalSeats) {
    return towns.map((town) => {
        const base = Math.max(0, town.population - (town.tradePop ?? 0));
        return { ...town, population: base, stage2Pop: base, tier: royalSeats.has(town.cell) ? 0 : Math.max(town.tier, tierOfPopulation(base)), baseTier: undefined };
    });
}

/** The roads and lanes the earlier rounds' traffic used (rivers carry trade without a road). */
function preloadRoads(state, traffic) {
    for (let edge = 0; edge < state.graph.edgeCount; edge++) {
        if (traffic[edge] > 0 && state.graph.edgeKind[edge] !== EDGE.RIVER) state.road[edge] = 1;
    }
}

function indexTowns(state) {
    state.townAt.fill(-1);
    state.towns.forEach((town, index) => (state.townAt[town.cell] = index));
}

function tierOfPopulation(population) {
    const [city, large] = FILRODENSWMB.GENERATOR.TOWNS.TIERS.map((tier) => tier.minPop);
    if (population >= city) return 0;
    return population >= large ? 1 : 2;
}

/** The edge cost model for this round (ports at existing towns are cheaper; danger in the final round). */
function edgeCostFunction(state) {
    const base = travelCost(state.graph, { portKm: portCost(state.cells, state.townAt), road: state.road });
    const security = state.final?.security;
    if (!security) return base;
    const { edgeA, edgeB } = state.graph;
    const danger = FILRODENSWMB.GENERATOR.TRADE.DANGER;
    return (edge) => base(edge) * (1 + danger * (1 - 0.5 * ((security[edgeA[edge]] || 1) + (security[edgeB[edge]] || 1))));
}

/** One trade round: pick the links, lay them, turn trade into townspeople. */
function* tradeRound(state, progress) {
    state.traffic.fill(0);
    const costOf = edgeCostFunction(state);
    state.costOf = costOf;
    state.cost = state.graph.costs(costOf);
    // Roads only make edges cheaper, and no edge can fall below a sea lane's cost per km, so this
    // rate stays a safe A* estimate while the round builds roads
    const { SEA_COST, LANE_FACTOR } = FILRODENSWMB.GENERATOR.TRAVEL;
    state.estimatePerKm = Math.min(leastCostPerKm(state.graph, state.cost), SEA_COST * LANE_FACTOR);
    const mixes = state.mixed ? state.towns.map((town) => townMix(state.context.cultures, state.cells, state.context.cellPop, town.cell, 3 - town.tier)) : null;
    const gravity = (i, j, cost) => (state.towns[i].population * state.towns[j].population) / Math.max(cost, FILRODENSWMB.GENERATOR.TRADE.GRAVITY_FLOOR_KM) ** 2 * (mixes ? affinity(state.context.cultures.cultures, mixes[i], mixes[j]) : 1);
    const pairs = new Map();
    yield* cityPairs(state, pairs, gravity, (done) => progress(0.2 * done));
    largeTownPairs(state, pairs, gravity);
    marketPairs(state, pairs, gravity);
    const flows = yield* layLinks(state, pairs, (done) => progress(0.2 + 0.8 * done));
    tradeToTownspeople(state, flows);
}

/** Records a pair's volume (the larger of two) and whether it is only a town's market link. */
function addPair(pairs, i, j, volume, local = false) {
    const key = i < j ? `${i}-${j}` : `${j}-${i}`;
    const old = pairs.get(key);
    pairs.set(key, { i: Math.min(i, j), j: Math.max(i, j), volume: Math.max(old?.volume ?? 0, volume), local: (old?.local ?? true) && local });
}

function townsOfTier(state, tier) {
    const list = [];
    state.towns.forEach((town, index) => {
        if (town.tier === tier) list.push(index);
    });
    return list;
}

/** The strongest partners of each city, plus a spanning tree over the cities. */
function* cityPairs(state, pairs, gravity, progress) {
    const cities = townsOfTier(state, 0);
    const between = cities.map(() => new Float64Array(cities.length));
    const cityCells = new Set(cities.map((index) => state.towns[index].cell));
    for (let a = 0; a < cities.length; a++) {
        // Only the costs between cities are needed, so each search ends once every city is settled
        let found = 0;
        const stop = (cell) => cityCells.has(cell) && ++found === cityCells.size;
        state.space.run([state.towns[cities[a]].cell], state.cost, { stop });
        for (let b = 0; b < cities.length; b++) between[a][b] = state.space.costTo(state.towns[cities[b]].cell);
        const partners = strongest(cities, a, between[a], gravity, FILRODENSWMB.GENERATOR.TRADE.CITY_PARTNERS);
        for (const [b, volume] of partners) addPair(pairs, cities[a], cities[b], volume);
        yield progress(a / Math.max(1, cities.length));
    }
    spanningTree(cities, between, (a, b, cost) => addPair(pairs, cities[a], cities[b], gravity(cities[a], cities[b], cost)));
}

/** The `count` strongest partners of list[a] by gravity, from its costs to each of the list. */
function strongest(list, a, costs, gravity, count) {
    const partners = [];
    for (let b = 0; b < list.length; b++) {
        if (b !== a && Number.isFinite(costs[b])) partners.push([b, gravity(list[a], list[b], costs[b])]);
    }
    return partners.sort((x, y) => y[1] - x[1] || x[0] - y[0]).slice(0, count);
}

/** Prim's tree over each group of cities that can reach one another, by travel cost. */
function spanningTree(cities, between, link) {
    const unseen = new Set(cities.keys());
    while (unseen.size) {
        const start = unseen.values().next().value;
        unseen.delete(start);
        const tree = [start];
        for (;;) {
            const best = nearestOutside(tree, unseen, between);
            if (!best) break;
            link(best.from, best.to, best.cost);
            tree.push(best.to);
            unseen.delete(best.to);
        }
    }
}

function nearestOutside(tree, unseen, between) {
    let best = null;
    for (const from of tree) {
        for (const to of unseen) {
            const cost = between[from][to];
            if (Number.isFinite(cost) && (!best || cost < best.cost)) best = { from, to, cost };
        }
    }
    return best;
}

/**
 * Each large town's strongest city or large-town partners within reach.
 *
 * Gravity falls with cost, so the search from each large town stops as soon as no place further
 * away could beat the partners already found: once even the largest candidate, at the cost now
 * reached, would trade less than the weakest partner kept. Places are settled cheapest first, so
 * this gives exactly the partners a search of the whole reach would.
 */
function largeTownPairs(state, pairs, gravity) {
    const T = FILRODENSWMB.GENERATOR.TRADE;
    const large = townsOfTier(state, 1);
    const candidates = [...townsOfTier(state, 0), ...large];
    const candidateAt = new Map(candidates.map((index) => [state.towns[index].cell, index]));
    const largest = candidates.reduce((most, index) => Math.max(most, state.towns[index].population), 0);
    for (const index of large) {
        const partners = new PartnerList(T.LARGE_PARTNERS);
        const own = state.towns[index].population;
        const visit = (cell, cost) => {
            const other = candidateAt.get(cell);
            if (other !== undefined && other !== index) partners.offer(other, gravity(index, other, cost));
        };
        const stop = (_cell, cost) => partners.full() && (own * largest) / Math.max(cost, T.GRAVITY_FLOOR_KM) ** 2 < partners.weakest();
        state.space.run([state.towns[index].cell], state.cost, { limit: T.PARTNER_REACH_KM, visit, stop });
        for (const [other, volume] of partners.list()) addPair(pairs, index, other, volume);
    }
}

/** The strongest few partners offered, by volume (the lower town index first on a tie). */
class PartnerList {
    #size;
    #entries = [];

    constructor(size) {
        this.#size = size;
    }

    offer(town, volume) {
        this.#entries.push([town, volume]);
        this.#entries.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
        if (this.#entries.length > this.#size) this.#entries.pop();
    }

    full() {
        return this.#entries.length >= this.#size;
    }

    weakest() {
        return this.#entries.at(-1)[1];
    }

    list() {
        return this.#entries;
    }
}

/** Each town's link to its nearest bigger place (its market): local trade. */
function marketPairs(state, pairs, gravity) {
    const markets = [...townsOfTier(state, 0), ...townsOfTier(state, 1)];
    if (!markets.length) return;
    const space = state.space.run(markets.map((index) => state.towns[index].cell), state.cost, { limit: FILRODENSWMB.GENERATOR.TRADE.MARKET_REACH_KM });
    for (const index of townsOfTier(state, 2)) {
        const cell = state.towns[index].cell;
        const source = space.ownerOf(cell);
        if (source >= 0) addPair(pairs, index, markets[source], gravity(index, markets[source], space.costTo(cell)), true);
    }
}

/**
 * Lays every link, strongest first, building roads and lanes as it goes; returns the trade
 * passing through and transferring at each cell.
 */
function* layLinks(state, pairs, progress) {
    const links = [...pairs.values()].sort((a, b) => b.volume - a.volume || a.i - b.i || a.j - b.j);
    const flows = { through: new Float64Array(state.graph.count), transfer: new Float64Array(state.graph.count) };
    for (let index = 0; index < links.length; index++) {
        layLink(state, links[index], flows);
        if (index % REPORT_EVERY === 0) yield progress(index / links.length);
    }
    return flows;
}

function layLink(state, link, flows) {
    const { graph, cells } = state;
    const from = state.towns[link.i].cell;
    const to = state.towns[link.j].cell;
    state.space.run([from], state.cost, { target: to, estimatePerKm: state.estimatePerKm });
    const path = state.space.path(from, to);
    if (!path) return;
    let cell = from;
    for (const edge of path) {
        state.traffic[edge] += link.volume;
        buildRoad(state, edge);
        const next = graph.other(edge, cell);
        // A town's road to its market is local trade, already counted in the urban shares
        if (!link.local) {
            if (graph.edgeKind[edge] === EDGE.PORT) flows.transfer[cells.water[cell] ? next : cell] += link.volume;
            else if (next !== to) flows.through[next] += link.volume;
        }
        cell = next;
    }
}

/** Marks an edge as built (rivers need no road) and makes it cheaper for the links after it. */
function buildRoad(state, edge) {
    const kind = state.graph.edgeKind[edge];
    if (kind === EDGE.RIVER || state.road[edge]) return;
    if (kind !== EDGE.SEA) state.newRoadKm += state.graph.edgeKm[edge];
    state.road[edge] = 1;
    state.cost[edge] = state.costOf(edge);
}

/** Each land cell's trade score: through trade (at towns and junctions only) and port transfers. */
function tradeScores(state, flows) {
    const T = FILRODENSWMB.GENERATOR.TRADE;
    const { graph, cells } = state;
    const degree = new Uint8Array(graph.count);
    for (let edge = 0; edge < graph.edgeCount; edge++) {
        if (state.traffic[edge] > 0 && graph.edgeKind[edge] !== EDGE.SEA) {
            degree[graph.edgeA[edge]]++;
            degree[graph.edgeB[edge]]++;
        }
    }
    const score = new Float64Array(graph.count);
    let total = 0;
    for (let cell = 0; cell < graph.count; cell++) {
        if (cells.water[cell]) continue;
        const through = state.townAt[cell] >= 0 || degree[cell] >= T.JUNCTION_DEGREE ? flows.through[cell] : 0;
        score[cell] = (through + T.PORT_WEIGHT * flows.transfer[cell]) ** T.EXPONENT;
        total += score[cell];
    }
    return { score, total };
}

/** True when a town lies within NEW_TOWN_GAP steps of a cell. */
function nearTown(state, cell) {
    const { adjStart, adjCell } = state.graph;
    let frontier = [cell];
    const seen = new Set(frontier);
    for (let step = 0; step < FILRODENSWMB.GENERATOR.TRADE.NEW_TOWN_GAP; step++) {
        const next = [];
        for (const at of frontier) {
            for (let slot = adjStart[at]; slot < adjStart[at + 1]; slot++) {
                const neighbour = adjCell[slot];
                if (seen.has(neighbour)) continue;
                if (state.townAt[neighbour] >= 0) return true;
                seen.add(neighbour);
                next.push(neighbour);
            }
        }
        frontier = next;
    }
    return false;
}

/** Turns the round's trade into townspeople, new trade towns and promotions. */
function tradeToTownspeople(state, flows) {
    const { score, total } = tradeScores(state, flows);
    if (!(total > 0)) {
        for (const town of state.towns) town.population = town.stage2Pop;
        retier(state);
        recordTrade(state, score, flows);
        return;
    }
    const budget = FILRODENSWMB.GENERATOR.TRADE.URBAN_SHARE * (state.context.world.urbanisation ?? 1) * state.context.totalPop;
    for (const town of state.towns) town.population = town.stage2Pop;
    const byScore = [];
    for (let cell = 0; cell < score.length; cell++) if (score[cell] > 0) byScore.push(cell);
    byScore.sort((a, b) => score[b] - score[a] || a - b);
    for (const cell of byScore) {
        const added = (budget * score[cell]) / total;
        if (state.townAt[cell] >= 0) state.towns[state.townAt[cell]].population += added;
        else if (added >= state.tierMin[2] && !nearTown(state, cell)) createTradeTown(state, cell, added, flows);
    }
    // Trade towns from an earlier round that no longer get enough trade fade away
    state.towns = state.towns.filter((town) => town.stage2Pop > 0 || town.population >= state.tierMin[2]);
    indexTowns(state);
    retier(state);
    recordTrade(state, score, flows);
}

function createTradeTown(state, cell, population, flows) {
    const origin = flows.transfer[cell] > flows.through[cell] ? "port" : "crossroads";
    state.towns.push({ cell, population, tier: 2, origin, stage2Pop: 0 });
    state.townAt[cell] = state.towns.length - 1;
}

/** Re-tiers by population; a town keeps at least its base tier, and realm seats stay cities. */
function retier(state) {
    const royal = state.final?.royalSeats;
    for (const town of state.towns) {
        town.baseTier ??= town.tier;
        if (royal?.has(town.cell)) town.baseTier = 0;
        town.tier = Math.min(tierOfPopulation(town.population), town.baseTier);
    }
}

function recordTrade(state, score, flows) {
    for (const town of state.towns) {
        town.trade = score[town.cell];
        town.port = flows.transfer[town.cell] > 0;
        town.transfer = flows.transfer[town.cell];
        town.through = flows.through[town.cell];
    }
}

/** The towns as the round leaves them, largest first, with their trade share and context. */
function finishTowns(state) {
    const { cells, final } = state;
    let most = 0;
    for (const value of state.traffic) most = Math.max(most, value);
    const traffic = new Float64Array(state.traffic.length);
    if (most > 0) for (let edge = 0; edge < traffic.length; edge++) traffic[edge] = state.traffic[edge] / most;
    for (const town of state.towns) {
        town.tradePop = Math.max(0, town.population - town.stage2Pop);
        town.coastal = cells.coastal[town.cell] === 1;
        town.navigable = cells.navigable[town.cell] === 1;
        if (final) describeNewTown(state, town);
    }
    const towns = state.towns.sort((a, b) => b.population - a.population || a.cell - b.cell);
    return { towns, traffic, newRoadKm: state.newRoadKm };
}

/** Final round: a town this round created gets a culture mix and security like the rest. */
function describeNewTown(state, town) {
    const cultures = state.context.cultures;
    if (state.mixed && !town.mix) {
        town.mix = townMix(cultures, state.cells, state.context.cellPop, town.cell, 3 - town.tier);
        town.culture = town.mix[0][0];
    }
    if (town.security == null) {
        town.security = state.final.security[town.cell] ?? 1;
        town.fortified = town.security < FILRODENSWMB.GENERATOR.FEEDBACK.FORTIFIED_BELOW;
    }
}
