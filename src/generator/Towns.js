import { FILRODENSWMB } from "../config.js";
import { CELL_KIND, smooth } from "./CellValues.js";
import { portCost, travelCost } from "./CellGraph.js";
import { SearchSpace, searchAll } from "./Search.js";

/**
 * Stage 2: population and central places.
 *
 * Food capacity becomes people: x development (the era's share of land farmed), x health (a loss
 * in malaria country: hot, wet, flat and low, worse beside water), x the cultures' fit, x (1 -
 * plague). Security comes later, from the realms.
 *
 * Towns are placed tier by tier, largest first, by central place: each tier picks the cells that
 * can reach the most people within its travel radius (nearer people counting more), at least the
 * tier's spacing apart and away from every bigger town. A town whose catchment (the land nearer to
 * it than to any town of its tier or bigger) cannot support the tier's minimum is dropped, the
 * weakest half at a time so neighbours absorb its land, until the tier is stable. Travel runs by
 * land, navigable river and sea, so river and coastal places gain reach with no hand-weighted
 * bonus. Each town's population is the urban share of each catchment it heads, at its own tier and
 * every smaller one.
 *
 * The stage is a generator: it yields its progress (0 to 1) between pieces of work so the pipeline
 * can report it and stop when asked.
 */

/** How many potential searches run between progress reports. */
const REPORT_EVERY = 64;

/**
 * @typedef {object} Town
 * @property {number} cell
 * @property {number} tier - 0 city, 1 large town, 2 town.
 * @property {number} population
 * @property {string} origin - "centralPlace", "port" or "crossroads".
 */

/**
 * @param {import("./CellGraph.js").CellGraph} graph
 * @param {object} context
 * @param {import("./Cultures.js").CultureData} context.cultures
 * @param {{development: number, plague: number}} context.era
 * @param {{urbanisation: number}} context.world
 * @returns {Generator<number, {towns: Town[], cellPop: Float64Array, totalPop: number}>}
 */
export function* placeTowns(graph, { cultures, era, world }) {
    const cells = graph.cells;
    const { cellPop, totalPop } = population(cells, cultures, era);
    const cost = graph.costs(travelCost(graph, { portKm: portCost(cells) }));
    const tiers = scaledTiers(world.urbanisation);
    const landIds = [];
    for (let cell = 0; cell < cells.count; cell++) if (cells.kind[cell] === CELL_KIND.LAND && cells.landKm2[cell] > 0) landIds.push(cell);

    const state = { graph, cost, cellPop, landIds, tiers, towns: [], townAt: new Int32Array(cells.count).fill(-1), space: new SearchSpace(graph) };
    for (let tier = 0; tier < tiers.length; tier++) {
        const potential = yield* potentials(state, tier, (done) => (tier + done) / tiers.length);
        placeTier(state, tier, potential);
        pruneTier(state, tier);
    }
    const towns = sizeTowns(state);
    return { towns, cellPop, totalPop };
}

/** The tiers with the urbanisation setting applied to their urban shares. */
function scaledTiers(urbanisation = 1) {
    return FILRODENSWMB.GENERATOR.TOWNS.TIERS.map((tier) => ({ ...tier, urbanShare: tier.urbanShare * urbanisation }));
}

/** People per cell and in all. */
function population(cells, cultures, era) {
    const cellPop = new Float64Array(cells.count);
    let totalPop = 0;
    for (let cell = 0; cell < cells.count; cell++) {
        if (!cells.landKm2[cell]) continue;
        cellPop[cell] = cells.food[cell] * era.development * health(cells, cell) * cultures.popMult[cell] * (1 - era.plague);
        totalPop += cellPop[cell];
    }
    return { cellPop, totalPop };
}

/** 1 minus the malaria loss of a cell. */
function health(cells, cell) {
    const T = FILRODENSWMB.GENERATOR.TOWNS;
    const wetSide = cells.riverKm[cell] > 0 || cells.kind[cell] === CELL_KIND.LAKE ? 1 : T.MARSH_DRY_SHARE;
    const marsh = smooth(T.MARSH_TEMPERATURE[0], T.MARSH_TEMPERATURE[1], cells.temperature[cell])
        * smooth(T.MARSH_MOISTURE[0], T.MARSH_MOISTURE[1], cells.moisture[cell])
        * (1 - smooth(T.MARSH_RELIEF_M[0], T.MARSH_RELIEF_M[1], cells.reliefM[cell]))
        * (1 - smooth(T.MARSH_HEIGHT_M[0], T.MARSH_HEIGHT_M[1], cells.heightM[cell]))
        * wetSide;
    return 1 - T.MARSH_PENALTY * marsh;
}

/** The people every land cell reaches within the tier's reach, nearer people counting more. */
function* potentials(state, tierIndex, progress) {
    const { space, cost, cellPop, landIds } = state;
    const reach = state.tiers[tierIndex].reachKm;
    const potential = new Float64Array(state.graph.count);
    let sum = 0;
    const visit = (cell, reached) => (sum += cellPop[cell] * (1 - reached / reach));
    for (let index = 0; index < landIds.length; index++) {
        sum = 0;
        space.run([landIds[index]], cost, { limit: reach, visit });
        potential[landIds[index]] = sum;
        if (index % REPORT_EVERY === 0) yield progress(index / landIds.length);
    }
    return potential;
}

/** Places a tier's towns greedily by potential, spaced apart and away from bigger towns. */
function placeTier(state, tierIndex, potential) {
    const { space, cost, towns, townAt, landIds } = state;
    const spacing = state.tiers[tierIndex].spacingKm;
    const blocked = new Uint8Array(state.graph.count);
    const block = (cell) => (blocked[cell] = 1);
    if (towns.length) space.run(towns.map((town) => town.cell), cost, { limit: spacing, visit: block });
    const order = landIds.slice().sort((a, b) => potential[b] - potential[a] || a - b);
    for (const cell of order) {
        if (blocked[cell] || townAt[cell] >= 0) continue;
        townAt[cell] = towns.length;
        towns.push({ cell, tier: tierIndex, population: 0, origin: "centralPlace" });
        space.run([cell], cost, { limit: spacing, visit: block });
    }
}

/**
 * Which town of tier <= maxTier each cell is nearest to by travel (an index into towns, or -1).
 * @returns {Int32Array}
 */
function catchment(state, maxTier) {
    const sources = [];
    state.towns.forEach((town, index) => {
        if (town.tier <= maxTier) sources.push(index);
    });
    const { owner } = searchAll(state.graph, sources.map((index) => state.towns[index].cell), state.cost);
    return owner.map((source) => (source >= 0 ? sources[source] : -1));
}

/** The population of each town's catchment at a tier. */
function catchmentSums(state, maxTier) {
    const owner = catchment(state, maxTier);
    const sums = new Float64Array(state.towns.length);
    for (const cell of state.landIds) if (owner[cell] >= 0) sums[owner[cell]] += state.cellPop[cell];
    return sums;
}

/** Drops the tier's towns whose catchment cannot support it, the weakest half each pass. */
function pruneTier(state, tierIndex) {
    const tier = state.tiers[tierIndex];
    for (let pass = 0; pass < FILRODENSWMB.GENERATOR.TOWNS.PRUNE_PASSES; pass++) {
        const sums = catchmentSums(state, tierIndex);
        const weak = [];
        state.towns.forEach((town, index) => {
            if (town.tier === tierIndex && tier.urbanShare * sums[index] < tier.minPop) weak.push(index);
        });
        if (!weak.length) return;
        weak.sort((a, b) => sums[a] - sums[b] || a - b);
        const cut = new Set(weak.slice(0, Math.max(1, Math.ceil(weak.length / 2))));
        state.towns = state.towns.filter((_, index) => !cut.has(index));
        state.townAt.fill(-1);
        state.towns.forEach((town, index) => (state.townAt[town.cell] = index));
    }
}

/** Each town's population from the catchments it heads; the towns big enough to keep, largest first. */
function sizeTowns(state) {
    const { towns, tiers } = state;
    for (let tierIndex = 0; tierIndex < tiers.length; tierIndex++) {
        const sums = catchmentSums(state, tierIndex);
        towns.forEach((town, index) => {
            if (town.tier <= tierIndex) town.population += tiers[tierIndex].urbanShare * sums[index];
        });
    }
    const keep = FILRODENSWMB.GENERATOR.TOWNS.KEEP_SHARE;
    return towns.filter((town) => town.population >= tiers[town.tier].minPop * keep).sort((a, b) => b.population - a.population || a.cell - b.cell);
}
