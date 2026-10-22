import { FILRODENSWMB } from "../config.js";
import { EDGE, politicalCost } from "./CellGraph.js";
import { townMix } from "./Cultures.js";
import { cellHostility } from "./Borders.js";
import { cultureBarrier, roadsFrom } from "./Realms.js";
import { biomeProperties } from "./ModelBiomes.js";
import { SearchSpace, searchAll } from "./Search.js";

/**
 * Stage 5, the feedback pass: security and clearing from the first realms and roads, then
 *   population = stage 2 population x clearing boost x security.
 *
 * Security is 1 - strife x threat x (1 - protection). The threat is the largest of a realm border
 * nearby (weighted by how hostile that border is), unclaimed land able to feed raiders, and the sea
 * on an exposed coast; protection comes from royal (full) and ducal (partial) seats nearby.
 * Distances are political travel costs.
 *
 * Clearing: each town clears the land around it (further for bigger towns) and roads clear their
 * own cells, raising forest cells towards the yield they would have as open land.
 *
 * Towns keep their places but are re-sized by their county's change in population. In insecure
 * counties people gather behind the walls of the county seat; towns that fall too small fade to
 * villages; insecure towns are walled; and castles go where busy roads cross insecure, rugged or
 * border ground, spaced apart.
 */

/**
 * @param {import("./CellGraph.js").CellGraph} graph
 * @param {object} context
 * @param {object[]} context.towns - The trade rounds' towns.
 * @param {Float64Array} context.cellPop - Stage 2's population.
 * @param {Float64Array} context.traffic
 * @param {object} context.realms - The first realms (buildRealms).
 * @param {import("./Cultures.js").CultureData} context.cultures
 * @param {number} context.strife
 * @param {Float64Array} [context.strifeAt] - Each cell's strife, where an invasion raises it (see Pipeline).
 */
export function feedbackPass(graph, context) {
    const road = roadsFrom(graph, context.traffic);
    const barrier = context.cultures.cultures.length > 1 ? cultureBarrier(context.cultures) : null;
    const cost = graph.costs(politicalCost(graph, { road, barrier }));
    const state = { graph, cells: graph.cells, context, road, cost, space: new SearchSpace(graph) };
    const threats = securityField(state);
    const cleared = clearing(state);
    const population = newPopulation(state, threats.security, cleared);
    const towns = resizeTowns(state, threats.security, population.cellPop);
    const castles = placeCastles(state, threats, towns);
    return { towns, castles, security: threats.security, cleared, cellPop: population.cellPop, totalPop: population.after, royalSeats: new Set(context.realms.realms.map((realm) => realm.seat)) };
}

// ------------------------------------------------------------------ security

function securityField(state) {
    const F = FILRODENSWMB.GENERATOR.FEEDBACK;
    const { graph, cells, context, cost } = state;
    const { border, wild } = threatSources(state);
    const hostility = cellHostility(context.realms.borders);
    const fromBorder = searchAll(graph, border, cost, { limit: F.THREAT_REACH * F.BORDER_KM });
    const fromWild = searchAll(graph, wild, cost, { limit: F.THREAT_REACH * F.WILD_KM }).best;
    const fromRoyal = searchAll(graph, context.realms.realms.map((realm) => realm.seat), cost, { limit: F.SEAT_REACH * F.SEAT_KM }).best;
    const fromDucal = searchAll(graph, context.realms.duchies.map((duchy) => duchy.seat), cost, { limit: F.SEAT_REACH * F.SEAT_KM }).best;
    const security = new Float64Array(cells.count).fill(1);
    for (let cell = 0; cell < cells.count; cell++) {
        if (cells.water[cell]) continue;
        const source = fromBorder.owner[cell];
        const borderThreat = Math.min(1, Math.exp(-fromBorder.best[cell] / F.BORDER_KM) * (source >= 0 ? hostility.get(border[source]) ?? 1 : 1));
        const wildThreat = Math.exp(-fromWild[cell] / F.WILD_KM);
        const raid = cells.coastal[cell] ? F.SEA_RAID * (1 - Math.min(1, cells.shelter[cell] / F.RAID_SHELTER)) : 0;
        const threat = Math.max(borderThreat, wildThreat, raid);
        const protection = Math.max(F.ROYAL_PROTECTION * Math.exp(-fromRoyal[cell] / F.SEAT_KM), F.DUCAL_PROTECTION * Math.exp(-fromDucal[cell] / F.SEAT_KM));
        security[cell] = 1 - (context.strifeAt ? context.strifeAt[cell] : context.strife) * threat * (1 - protection);
    }
    return { security, fromBorder: fromBorder.best };
}

/**
 * The border cells (land beside another realm's land) and the wild cells (unclaimed land able to
 * feed raiders: barren peaks and deserts protect rather than threaten).
 */
function threatSources(state) {
    const { graph, cells, context } = state;
    const realm = context.realms.realmOfCell;
    const raiders = biomeProperties().raiders;
    const hosts = FILRODENSWMB.GENERATOR.FEEDBACK.WILD_HOSTS_PER_KM2;
    const border = [];
    const wild = [];
    for (let cell = 0; cell < cells.count; cell++) {
        if (cells.water[cell]) continue;
        if (realm[cell] < 0) {
            if (cells.landKm2[cell] > 0 && (context.cellPop[cell] / cells.landKm2[cell]) * raiders[cells.biome[cell]] >= hosts) wild.push(cell);
        } else if (bordersOtherRealm(graph, realm, cell)) border.push(cell);
    }
    return { border, wild };
}

function bordersOtherRealm(graph, realm, cell) {
    const { water } = graph.cells;
    for (let slot = graph.adjStart[cell]; slot < graph.adjStart[cell + 1]; slot++) {
        const next = graph.adjCell[slot];
        if (!water[next] && realm[next] >= 0 && realm[next] !== realm[cell]) return true;
    }
    return false;
}

// ------------------------------------------------------------------ clearing

function clearing(state) {
    const F = FILRODENSWMB.GENERATOR.FEEDBACK;
    const { graph, cells, road, cost, space } = state;
    const cleared = new Float64Array(cells.count);
    for (let edge = 0; edge < graph.edgeCount; edge++) {
        if (!road[edge]) continue;
        for (const cell of [graph.edgeA[edge], graph.edgeB[edge]]) if (!cells.water[cell]) cleared[cell] = Math.max(cleared[cell], F.ROAD_CLEAR);
    }
    for (const town of state.context.towns) {
        const reach = F.CLEAR_KM_PER_SQRT_POP * Math.sqrt(town.population);
        if (!(reach > 0)) continue;
        space.run([town.cell], cost, { limit: F.CLEAR_REACH * reach, visit: (cell, reached) => (cleared[cell] = Math.max(cleared[cell], Math.exp(-reached / reach))) });
    }
    return cleared;
}

// ------------------------------------------------------------------ population

function newPopulation(state, security, cleared) {
    const { cells, context } = state;
    const cover = biomeProperties().cover;
    const cellPop = new Float64Array(cells.count);
    let after = 0;
    for (let cell = 0; cell < cells.count; cell++) {
        const before = context.cellPop[cell];
        if (cells.water[cell] || !before) continue;
        const boost = 1 + (1 / cover[cells.biome[cell]] - 1) * cleared[cell];
        cellPop[cell] = before * boost * security[cell];
        after += cellPop[cell];
    }
    return { cellPop, after };
}

// ------------------------------------------------------------------ towns

/** Each county's population before and after, and its land-weighted security. */
function countyTotals(state, security, cellPop) {
    const { cells, context } = state;
    const countyOf = context.realms.countyOfCell;
    const count = context.realms.counties.length;
    const totals = { before: new Float64Array(count), after: new Float64Array(count), security: new Float64Array(count), land: new Float64Array(count) };
    for (let cell = 0; cell < cells.count; cell++) {
        const county = countyOf[cell];
        if (county < 0) continue;
        totals.before[county] += context.cellPop[cell];
        totals.after[county] += cellPop[cell];
        totals.security[county] += security[cell] * cells.landKm2[cell];
        totals.land[county] += cells.landKm2[cell];
    }
    return totals;
}

function resizeTowns(state, security, cellPop) {
    const F = FILRODENSWMB.GENERATOR.FEEDBACK;
    const { context } = state;
    const countyOf = context.realms.countyOfCell;
    const totals = countyTotals(state, security, cellPop);
    const towns = context.towns.map((town) => ({ ...town }));
    for (const town of towns) {
        const county = countyOf[town.cell];
        const ratio = county >= 0 && totals.before[county] ? totals.after[county] / totals.before[county] : security[town.cell];
        town.population *= ratio;
        if (town.tradePop) town.tradePop *= ratio;
        town.security = security[town.cell];
        town.fortified = security[town.cell] < F.FORTIFIED_BELOW;
    }
    concentrate(state, towns, totals);
    return keepTowns(state, towns, cellPop);
}

/** In insecure counties, smaller towns lose people to the county seat, behind its walls. */
function concentrate(state, towns, totals) {
    const F = FILRODENSWMB.GENERATOR.FEEDBACK;
    const { realms, strife } = state.context;
    const townAt = new Map(towns.map((town) => [town.cell, town]));
    const seatCells = new Set(realms.counties.map((county) => county.seat));
    for (const town of towns) {
        const county = realms.countyOfCell[town.cell];
        if (county < 0 || seatCells.has(town.cell)) continue;
        const seat = townAt.get(realms.counties[county].seat);
        if (!seat) continue;
        const countySecurity = totals.security[county] / totals.land[county];
        const moved = (town.population * F.CONCENTRATION * (1 - countySecurity)) / Math.max(0.01, strife) * 0.5;
        town.population -= moved;
        seat.population += moved;
    }
}

/** Towns big enough to stay towns, re-tiered (demotion allowed now); realm seats stay cities. */
function keepTowns(state, towns, cellPop) {
    const tiers = FILRODENSWMB.GENERATOR.TOWNS.TIERS;
    const keep = FILRODENSWMB.GENERATOR.TOWNS.KEEP_SHARE;
    const kept = towns.filter((town) => town.population >= tiers[2].minPop * keep);
    for (const town of kept) {
        town.tier = tierOf(town.population);
        town.tradePop = Math.min(town.population, town.tradePop ?? 0);
    }
    const seats = new Set(state.context.realms.realms.map((realm) => realm.seat));
    for (const town of kept) if (seats.has(town.cell)) town.tier = 0;
    if (state.context.cultures.cultures.length > 1) {
        for (const town of kept) {
            town.mix = townMix(state.context.cultures, state.cells, cellPop, town.cell, 3 - town.tier);
            town.culture = town.mix[0][0];
        }
    }
    return kept.sort((a, b) => b.population - a.population || a.cell - b.cell);
}

function tierOf(population) {
    const [city, large] = FILRODENSWMB.GENERATOR.TOWNS.TIERS.map((tier) => tier.minPop);
    if (population >= city) return 0;
    return population >= large ? 1 : 2;
}

// ------------------------------------------------------------------ castles

/** Castles at insecure choke points on busy roads: border crossings, passes and river crossings. */
function placeCastles(state, threats, towns) {
    const F = FILRODENSWMB.GENERATOR.FEEDBACK;
    const { cells, cost, space } = state;
    const blocked = new Uint8Array(cells.count);
    for (const town of towns) if (town.fortified) blocked[town.cell] = 1;
    const castles = [];
    for (const candidate of castleCandidates(state, threats)) {
        if (blocked[candidate.cell]) continue;
        castles.push({ cell: candidate.cell, reason: candidate.reason, security: threats.security[candidate.cell] });
        space.run([candidate.cell], cost, { limit: F.CASTLE_SPACING_KM, visit: (cell) => (blocked[cell] = 1) });
    }
    return castles;
}

/** The cells of the busier roads where a castle would make sense, best first. */
function castleCandidates(state, threats) {
    const F = FILRODENSWMB.GENERATOR.FEEDBACK;
    const { graph, cells, road, context } = state;
    const roads = [];
    for (let edge = 0; edge < graph.edgeCount; edge++) if (road[edge] && graph.edgeKind[edge] !== EDGE.SEA) roads.push(edge);
    roads.sort((a, b) => context.traffic[b] - context.traffic[a] || a - b);
    const busy = roads.slice(0, Math.floor(roads.length * F.CASTLE_TRAFFIC_RANK));
    const candidates = [];
    for (const edge of busy) {
        for (const cell of [graph.edgeA[edge], graph.edgeB[edge]]) {
            const security = threats.security[cell];
            if (cells.water[cell] || security >= F.CASTLE_SECURITY) continue;
            const pass = cells.reliefM[cell] > F.CASTLE_PASS_RELIEF_M;
            const border = threats.fromBorder[cell] < F.CASTLE_BORDER_KM;
            const crossing = cells.navigable[cell] === 1;
            if (!pass && !border && !crossing) continue;
            const score = context.traffic[edge] * (1 - security) * (pass ? F.CASTLE_SCORE : 1) * (border ? F.CASTLE_SCORE : 1);
            candidates.push({ cell, score, reason: castleReason(border, pass) });
        }
    }
    return candidates.sort((a, b) => b.score - a.score || a.cell - b.cell);
}

function castleReason(border, pass) {
    if (border) return "border";
    return pass ? "pass" : "riverCrossing";
}
