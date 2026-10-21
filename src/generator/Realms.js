import { FILRODENSWMB } from "../config.js";
import { EDGE, politicalCost } from "./CellGraph.js";
import { closedness } from "./Cultures.js";
import { borderHostility } from "./Borders.js";
import { SearchSpace, searchAll } from "./Search.js";

/**
 * Stage 4: realms and the feudal hierarchy, three nested levels built over a political version of
 * the travel graph (roads as built, water harder to hold than to sail):
 * - counties: every city and large town is a seat, claiming the land it reaches first up to
 *   COUNTY_REACH_KM; land beyond every seat's reach is unclaimed, except small pockets enclosed by
 *   one county's neighbourhood, which become its wilds;
 * - duchies: every city is a seat; each county joins the duchy that reaches its seat first, with
 *   each duke's reach scaled by his tax base (bigger lords reach further);
 * - kingdoms: the richest duchies, spaced apart, become kingdoms; every other duchy joins the
 *   kingdom that reaches its seat first, scaled by royal tax base, or stays independent when no
 *   king reaches it. A kingdom left with too few duchies is an independent duchy.
 *
 * Borders are never drawn: they are where the floods meet, so mountains, deserts and open sea
 * (expensive to cross) become borders and rivers and roads (cheap) hold land together. Cultures
 * add a barrier to duchies and kingdoms (not counties: a local lord rules minorities too).
 *
 * The second run (after the feedback pass) keeps the first run's realm seats rather than picking
 * them again by power, so the dynasties survive the changes in tax base.
 */

/**
 * @param {import("./CellGraph.js").CellGraph} graph
 * @param {object} context
 * @param {object[]} context.towns
 * @param {Float64Array} context.cellPop
 * @param {Float64Array} context.traffic - Trade per edge (edges with trade are roads).
 * @param {import("./Cultures.js").CultureData} context.cultures
 * @param {{realmSpacing: number, fragmentation: number}} context.world
 * @param {Set<number>|null} [context.fixedSeats] - Realm seat cells to keep.
 */
export function buildRealms(graph, context) {
    const cells = graph.cells;
    const road = roadsFrom(graph, context.traffic);
    const barrier = context.cultures.cultures.length > 1 ? cultureBarrier(context.cultures) : null;
    const cost = graph.costs(politicalCost(graph, { road, barrier }));
    const localCost = barrier ? graph.costs(politicalCost(graph, { road })) : cost;
    const state = { graph, cells, context, cost, localCost, power: powers(context.world) };
    const counties = buildCounties(state);
    const duchies = buildDuchies(state, counties);
    const kingdoms = buildKingdoms(state, counties, duchies);
    const result = assignCells(state, counties, duchies, kingdoms);
    result.borders = borderHostility({ graph, realmOfCell: result.realmOfCell, realms: result.realms, cultures: context.cultures });
    return result;
}

/** The power exponents with fragmentation applied (above 1, wealth carries a lord less far). */
function powers(world) {
    const R = FILRODENSWMB.GENERATOR.REALMS;
    const fragmentation = world.fragmentation ?? 1;
    return { duchy: R.DUCHY_POWER / fragmentation, kingdom: R.KINGDOM_POWER / fragmentation, spacing: R.KINGDOM_SPACING_KM * (world.realmSpacing ?? 1) };
}

/** Land and port edges that carried trade are roads. */
export function roadsFrom(graph, traffic) {
    const road = new Uint8Array(graph.edgeCount);
    for (let edge = 0; edge < graph.edgeCount; edge++) {
        const kind = graph.edgeKind[edge];
        if (traffic[edge] > 0 && (kind === EDGE.LAND || kind === EDGE.PORT)) road[edge] = 1;
    }
    return road;
}

/** Stepping into land held by another culture costs more, the more closed either culture is. */
export function cultureBarrier(cultures) {
    const k = FILRODENSWMB.GENERATOR.CULTURES.BARRIER;
    return (a, b) => 1 + k * closedness(cultures.cultures, cultures.dominant[a], cultures.dominant[b]);
}

const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] || 1;
};

// ------------------------------------------------------------------ counties

function buildCounties(state) {
    const { graph, cells, context } = state;
    const R = FILRODENSWMB.GENERATOR.REALMS;
    const seats = context.towns.filter((town) => town.tier <= 1);
    const flood = searchAll(graph, seats.map((town) => town.cell), state.localCost, { limit: R.COUNTY_REACH_KM });
    const counties = seats.map((town, id) => ({ id, seat: town.cell, seatTown: town, rural: 0, urban: 0, cells: 0, landKm2: 0, tax: 0 }));
    const countyOfCell = Int32Array.from(flood.owner, (county, cell) => (cells.water[cell] ? -1 : county));
    absorbEnclaves(graph, countyOfCell);
    for (let cell = 0; cell < cells.count; cell++) {
        const county = countyOfCell[cell];
        if (county < 0) continue;
        counties[county].rural += context.cellPop[cell];
        counties[county].cells++;
        counties[county].landKm2 += cells.landKm2[cell];
    }
    for (const town of context.towns) {
        const county = countyOfCell[town.cell];
        if (county >= 0) counties[county].urban += town.population;
    }
    for (const county of counties) county.tax = R.TAX_SHARE * (county.rural + county.urban);
    return { list: counties, countyOfCell };
}

/** Small unclaimed pockets of land enclosed by counties join the county around them most. */
function absorbEnclaves(graph, countyOfCell) {
    const { water } = graph.cells;
    const seen = new Uint8Array(graph.count);
    for (let start = 0; start < graph.count; start++) {
        if (seen[start] || water[start] || countyOfCell[start] >= 0) continue;
        const { pocket, around } = unclaimedPocket(graph, countyOfCell, seen, start);
        if (pocket.length > FILRODENSWMB.GENERATOR.REALMS.ENCLAVE_MAX_CELLS || !around.size) continue;
        const best = [...around.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
        for (const cell of pocket) countyOfCell[cell] = best;
    }
}

/** The connected unclaimed land around `start`, and how often each county borders it. */
function unclaimedPocket(graph, countyOfCell, seen, start) {
    const { water } = graph.cells;
    const pocket = [start];
    const around = new Map();
    seen[start] = 1;
    for (let index = 0; index < pocket.length; index++) {
        const cell = pocket[index];
        for (let slot = graph.adjStart[cell]; slot < graph.adjStart[cell + 1]; slot++) {
            const next = graph.adjCell[slot];
            if (water[next]) continue;
            const county = countyOfCell[next];
            if (county >= 0) around.set(county, (around.get(county) ?? 0) + 1);
            else if (!seen[next]) {
                seen[next] = 1;
                pocket.push(next);
            }
        }
    }
    return { pocket, around };
}

// ------------------------------------------------------------------ duchies

function buildDuchies(state, counties) {
    const seats = counties.list.filter((county) => county.seatTown.tier === 0);
    const medianTax = median(seats.map((county) => county.tax));
    const scale = seats.map((county) => (medianTax / county.tax) ** state.power.duchy);
    const flood = searchAll(state.graph, seats.map((county) => county.seat), state.cost, { scale });
    const duchies = seats.map((county, id) => ({ id, seat: county.seat, seatCounty: county.id, counties: [], tax: 0, pop: 0, landKm2: 0 }));
    const duchyOfCounty = Int32Array.from(counties.list, (county) => flood.owner[county.seat]);
    // A ducal seat's own county is always its own
    seats.forEach((county, id) => (duchyOfCounty[county.id] = id));
    counties.list.forEach((county, index) => {
        const duchy = duchies[duchyOfCounty[index]];
        if (!duchy) return;
        duchy.counties.push(index);
        duchy.tax += county.tax;
        duchy.pop += county.rural + county.urban;
        duchy.landKm2 += county.landKm2;
    });
    return { list: duchies, duchyOfCounty };
}

// ------------------------------------------------------------------ kingdoms

function buildKingdoms(state, counties, duchies) {
    const R = FILRODENSWMB.GENERATOR.REALMS;
    const list = duchies.list;
    const royal = royalDuchies(state, list);
    const medianTax = median(royal.map((duchy) => list[duchy].tax));
    const scale = royal.map((duchy) => (medianTax / list[duchy].tax) ** state.power.kingdom);
    const flood = searchAll(state.graph, royal.map((duchy) => list[duchy].seat), state.cost, { scale, limit: R.KINGDOM_REACH_KM });
    const kingdomOfDuchy = Int32Array.from(list, (duchy) => flood.owner[duchy.seat]);
    royal.forEach((duchy, index) => (kingdomOfDuchy[duchy] = index));
    const members = royal.map(() => []);
    kingdomOfDuchy.forEach((kingdom, duchy) => {
        if (kingdom >= 0) members[kingdom].push(duchy);
    });
    return keepRealKingdoms(royal, members, kingdomOfDuchy, list);
}

/**
 * The royal duchies: the first run's seats when kept, otherwise the richest duchies greedily, each
 * at least the realm spacing from every earlier one.
 */
function royalDuchies(state, duchies) {
    const fixed = state.context.fixedSeats;
    if (fixed) return duchies.filter((duchy) => fixed.has(duchy.seat)).map((duchy) => duchy.id);
    const byPower = duchies.map((duchy) => duchy.id).sort((a, b) => duchies[b].tax - duchies[a].tax || a - b);
    const blocked = new Uint8Array(state.graph.count);
    const space = new SearchSpace(state.graph);
    const royal = [];
    for (const duchy of byPower) {
        if (blocked[duchies[duchy].seat]) continue;
        royal.push(duchy);
        space.run([duchies[duchy].seat], state.cost, { limit: state.power.spacing, visit: (cell) => (blocked[cell] = 1) });
    }
    return royal;
}

/** Kingdoms holding too few duchies are really independent duchies. */
function keepRealKingdoms(royal, members, kingdomOfDuchy, duchies) {
    const minimum = FILRODENSWMB.GENERATOR.REALMS.MIN_KINGDOM_DUCHIES;
    const kept = [];
    const renumber = new Map();
    royal.forEach((duchy, index) => {
        if (members[index].length < minimum) return;
        renumber.set(index, kept.length);
        kept.push({ id: kept.length, seatDuchy: duchy, seat: duchies[duchy].seat, duchies: members[index], tax: 0, pop: 0, landKm2: 0 });
    });
    for (let duchy = 0; duchy < kingdomOfDuchy.length; duchy++) {
        const kingdom = renumber.get(kingdomOfDuchy[duchy]);
        kingdomOfDuchy[duchy] = kingdom ?? -1;
        if (kingdom === undefined) continue;
        kept[kingdom].tax += duchies[duchy].tax;
        kept[kingdom].pop += duchies[duchy].pop;
        kept[kingdom].landKm2 += duchies[duchy].landKm2;
    }
    return { list: kept, kingdomOfDuchy };
}

// ------------------------------------------------------------------ per-cell result

/**
 * The realms (kingdoms first, then independent duchies as realms of their own) and every cell's
 * county, duchy and realm.
 */
function assignCells(state, counties, duchies, kingdoms) {
    const { cells } = state;
    const independents = [];
    duchies.list.forEach((duchy, index) => {
        if (kingdoms.kingdomOfDuchy[index] < 0) independents.push(index);
    });
    const realmOfDuchy = Int32Array.from(kingdoms.kingdomOfDuchy);
    independents.forEach((duchy, index) => (realmOfDuchy[duchy] = kingdoms.list.length + index));
    const realms = [
        ...kingdoms.list.map((kingdom) => realmEntry("kingdom", kingdom.seat, kingdom.duchies, kingdom.pop, kingdom.landKm2, duchies)),
        ...independents.map((duchy) => realmEntry("independent", duchies.list[duchy].seat, [duchy], duchies.list[duchy].pop, duchies.list[duchy].landKm2, duchies)),
    ];
    const duchyOfCell = new Int32Array(cells.count).fill(-1);
    const realmOfCell = new Int32Array(cells.count).fill(-1);
    for (let cell = 0; cell < cells.count; cell++) {
        const county = counties.countyOfCell[cell];
        const duchy = county >= 0 ? duchies.duchyOfCounty[county] : -1;
        if (duchy < 0) continue;
        duchyOfCell[cell] = duchy;
        realmOfCell[cell] = realmOfDuchy[duchy];
    }
    return {
        counties: counties.list.map((county) => ({ seat: county.seat, pop: county.rural + county.urban, landKm2: county.landKm2, tax: county.tax })),
        duchies: duchies.list.map((duchy) => ({ seat: duchy.seat, counties: duchy.counties, pop: duchy.pop, landKm2: duchy.landKm2, tax: duchy.tax })),
        realms,
        countyOfCell: counties.countyOfCell,
        duchyOfCell,
        realmOfCell,
        duchyOfCounty: duchies.duchyOfCounty,
        realmOfDuchy,
    };
}

function realmEntry(kind, seat, duchyList, pop, landKm2, duchies) {
    const counties = duchyList.reduce((sum, duchy) => sum + duchies.list[duchy].counties.length, 0);
    return { kind, seat, duchies: duchyList.slice(), counties, pop, landKm2 };
}
