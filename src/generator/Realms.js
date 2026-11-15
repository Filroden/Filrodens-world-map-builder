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
 * @param {Set<number>|null} [context.keptSeats] - The age before's realm seats (see Pipeline): a
 *     duchy seated on one stays a kingdom's seat; more are chosen as usual, spaced from them.
 * @param {object} [context.partition] - An age's civil war, `unions` its union and those lasting from before, `barredSeats` the
 *     seats that may not be crowned and `collapseArea` a collapse's land (see AgeEvents).
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
export function powers(world) {
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

export const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] || 1;
};

// ------------------------------------------------------------------ counties

function buildCounties(state) {
    const { graph, cells, context } = state;
    const R = FILRODENSWMB.GENERATOR.REALMS;
    const seats = context.towns.filter((town) => town.tier <= 1);
    const flood = searchAll(graph, seats.map((town) => town.cell), state.localCost, { limit: R.COUNTY_REACH_KM });
    const counties = seats.map((town, id) => countyEntry(id, town.cell, town));
    const countyOfCell = Int32Array.from(flood.owner, (county, cell) => (cells.water[cell] ? -1 : county));
    absorbEnclaves(graph, countyOfCell);
    tallyCounties(state, counties, countyOfCell);
    return { list: counties, countyOfCell };
}

/** A county before its cells are tallied (see tallyCounties). */
export function countyEntry(id, seat, seatTown) {
    return { id, seat, seatTown, rural: 0, urban: 0, cells: 0, landKm2: 0, tax: 0 };
}

/** Each county's people, cells, land and tax base, from the cells it holds and the towns on them. */
export function tallyCounties(state, counties, countyOfCell) {
    const { cells, context } = state;
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
    for (const county of counties) county.tax = FILRODENSWMB.GENERATOR.REALMS.TAX_SHARE * (county.rural + county.urban);
}

/** Small unclaimed pockets of land enclosed by counties join the county around them most. */
export function absorbEnclaves(graph, countyOfCell) {
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
    applyRealmEvents(state, list, royal, kingdomOfDuchy);
    const members = royal.map(() => []);
    kingdomOfDuchy.forEach((kingdom, duchy) => {
        if (kingdom >= 0) members[kingdom].push(duchy);
    });
    return keepRealKingdoms(royal, members, kingdomOfDuchy, list);
}

/**
 * The royal duchies: the first run's seats when kept, otherwise the richest duchies greedily, each
 * at least the realm spacing from every earlier one. Only duchies `eligible` allows may be crowned
 * (all of them unless the map's own regions say otherwise; see UserRealms).
 */
export function royalDuchies(state, duchies, eligible = null) {
    const fixed = state.context.fixedSeats;
    const may = (duchy) => !eligible || eligible(duchy.id);
    if (fixed) return duchies.filter((duchy) => may(duchy) && fixed.has(duchy.seat)).map((duchy) => duchy.id);
    const kept = state.context.keptSeats;
    const byPower = duchies.filter(may).map((duchy) => duchy.id).sort((a, b) => (kept ? (kept.has(duchies[b].seat) ? 1 : 0) - (kept.has(duchies[a].seat) ? 1 : 0) : 0) || duchies[b].tax - duchies[a].tax || a - b);
    const blocked = new Uint8Array(state.graph.count);
    const space = new SearchSpace(state.graph);
    const royal = [];
    // Capital seats are crowns whatever the spacing, and so are a civil war's two rivals; a union's
    // partner and a collapsing realm's duchies never are (see AgeEvents)
    const seats = state.cells.seats;
    const isCapital = (duchy) => seats?.get(duchies[duchy].seat)?.kind === "capital";
    const { forced, barred } = eventSeats(state, duchies.filter(may));
    const first = (duchy) => isCapital(duchy) || forced.has(duchy);
    for (const duchy of byPower) {
        if (!first(duchy)) continue;
        royal.push(duchy);
        space.run([duchies[duchy].seat], state.cost, { limit: state.power.spacing, visit: (cell) => (blocked[cell] = 1) });
    }
    for (const duchy of byPower) {
        if (first(duchy) || barred(duchies[duchy].seat)) continue;
        if (blocked[duchies[duchy].seat]) continue;
        royal.push(duchy);
        space.run([duchies[duchy].seat], state.cost, { limit: state.power.spacing, visit: (cell) => (blocked[cell] = 1) });
    }
    return royal;
}

/**
 * An age's realm events' seats (see AgeEvents): the duchies a civil war forces to be crowns (the
 * richest seated in the realm's land, and its rival, the one splitting the realm most evenly with
 * it; see evenRival), kept on the partition for the
 * realm passes after, and whether a seat is barred from a crown
 * (a union's partner's, and every seat in a collapsing realm's land).
 */
function eventSeats(state, candidates) {
    const { partition, barredSeats = null, collapseArea = null } = state.context;
    const forced = new Set();
    if (partition) {
        const inside = candidates.filter((duchy) => partition.area[duchy.seat]).sort((a, b) => b.tax - a.tax || a.id - b.id);
        if (inside.length) {
            forced.add(inside[0].id);
            const rival = evenRival(state, inside, inside.slice(1));
            if (rival) forced.add(rival.id);
        }
        partition.crownSeats ??= [...forced].map((id) => candidates.find((duchy) => duchy.id === id).seat);
    }
    return { forced, barred: (cell) => !!(collapseArea?.[cell] || barredSeats?.has(cell)) };
}

/**
 * A civil war's rival crown among `candidates`: the one that, with the realm's first crown
 * (`inside[0]`), splits the realm's duchies (`inside`, each going to the nearer) most evenly by tax
 * base, ties to the richer. Null with no candidate.
 */
function evenRival(state, inside, candidates) {
    let best = null;
    let bestShare = -1;
    const total = inside.reduce((sum, duchy) => sum + duchy.tax, 0) || 1;
    for (const candidate of candidates) {
        const near = searchAll(state.graph, [inside[0].seat, candidate.seat], state.cost);
        let rival = 0;
        for (const duchy of inside) if (near.owner[duchy.seat] === 1) rival += duchy.tax;
        const share = Math.min(rival, total - rival) / total;
        if (share > bestShare + 1e-9) {
            best = candidate;
            bestShare = share;
        }
    }
    return best;
}

/**
 * An age's realm events on the kingdoms' duchies (see AgeEvents), in every realm pass of the age:
 * a union's partner's duchies go to its crown (seated in the absorbing realm's land in its own age,
 * the union's crown seat in the ages after); a civil war's
 * duchies go to whichever of its two crowns is nearer (not by wealth), so the land splits between
 * them; a collapsing realm's duchies stand alone. Only duchies `may` allows are moved (all of them
 * unless the map's own regions hold some; see UserRealms).
 */
export function applyRealmEvents(state, list, royal, kingdomOfDuchy, may = () => true) {
    const { unions = null, partition, collapseArea } = state.context;
    const free = (index) => may(index) && !royal.includes(index);
    for (const union of unions ?? []) {
        // The crown: a lasting union's own seat, or this age's crowned in the absorbing realm's land
        const crown = union.home ? royal.findIndex((duchy) => union.home[list[duchy].seat]) : royal.findIndex((duchy) => list[duchy].seat === union.crownSeat);
        if (crown >= 0) list.forEach((duchy, index) => {
            if (union.area[duchy.seat] && free(index)) kingdomOfDuchy[index] = crown;
        });
    }
    if (partition?.crownSeats?.length > 1) {
        const crowns = royal.map((duchy, index) => (partition.crownSeats.includes(list[duchy].seat) ? index : -1)).filter((index) => index >= 0);
        if (crowns.length > 1) {
            const near = searchAll(state.graph, crowns.map((index) => list[royal[index]].seat), state.cost);
            list.forEach((duchy, index) => {
                if (partition.area[duchy.seat] && free(index) && near.owner[duchy.seat] >= 0) kingdomOfDuchy[index] = crowns[near.owner[duchy.seat]];
            });
        }
    }
    if (collapseArea) list.forEach((duchy, index) => {
        if (collapseArea[duchy.seat] && free(index)) kingdomOfDuchy[index] = -1;
    });
}

/** Kingdoms holding too few duchies are really independent duchies. */
export function keepRealKingdoms(royal, members, kingdomOfDuchy, duchies) {
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

export function realmEntry(kind, seat, duchyList, pop, landKm2, duchies) {
    const counties = duchyList.reduce((sum, duchy) => sum + duchies.list[duchy].counties.length, 0);
    return { kind, seat, duchies: duchyList.slice(), counties, pop, landKm2 };
}
