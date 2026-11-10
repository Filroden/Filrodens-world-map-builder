import { FILRODENSWMB } from "../config.js";
import { politicalCost } from "./CellGraph.js";
import { borderHostility } from "./Borders.js";
import { searchAll } from "./Search.js";
import { absorbEnclaves, applyRealmEvents, countyEntry, cultureBarrier, keepRealKingdoms, median, powers, realmEntry, roadsFrom, royalDuchies, tallyCounties } from "./Realms.js";

/**
 * Realms built round the map's own realms, duchies and counties (the user regions of its
 * Political set; see Generation.userRegions): Generate fills what the user left empty, inside and
 * round what they drew, never across it.
 *
 * The user's units arrive as model cells (each model cell given to the user region holding most of
 * its display cells), and each level is built with them as fixed units:
 * - Counties: every flood step from one user unit into another (or out of one, or into one) costs
 *   BARRIER times as much, so a generated county never crosses a user border; the model's pockets
 *   of unclaimed land, which join the county round them, are trimmed back to their seat's side of
 *   every user border. A user county is one county, seated at its largest town.
 * - Duchies: a user duchy holds every county inside it. Other counties join a duke by reach, as
 *   generated ones always do. The duchies' flood pays the barrier only at the borders of user
 *   realms, user duchies and the user counties that stand alone, so an ordinary user county may be
 *   reached across its own border like any other. A duke that could only reach a county across a
 *   user border (a user realm with no city of its own is reached from outside, since the duchies'
 *   flood has no limit) leaves it, with the other counties it reached that side, to a new duchy of
 *   that side, seated at its largest town.
 * - Kingdoms: a user realm holds every duchy inside it and its wilds (its land no county reached),
 *   crowned at a capital seat pin inside it, else its richest duchy's seat, else its largest town.
 *   No generated kingdom is crowned inside a user realm, nor reaches across its border. Other
 *   duchies join a kingdom by reach or stand alone, as generated ones always do.
 *
 * A user duchy in no user realm, and a user county in no user duchy or realm, is lone. Its
 * `independent` choice decides what it is: ticked, a state of its own (an independent realm, and
 * a lone county a duchy of its own too); unticked, one of Generate's own units, entering the
 * floods above it whole (a lone duchy may be crowned, or join the kingdom that reaches it, or
 * stand alone; a lone county joins the duchy that reaches it), so a generated realm may take it
 * but never cut through it.
 *
 * The result has the shape of Realms.buildRealms', with `user` (the user region's key) on every
 * unit that stands for a user region and `zone` on every county (the user regions it lies in, as
 * "realm,duchy,county" keys, or "c:<key>" for a user county), so the display can keep the exact
 * painted borders (see MaterialiseRegions).
 */

/** How many times dearer a flood step across a user border is: high enough that nothing short of the duchies' unlimited flood ever pays it. */
export const BARRIER = 1e6;

const NONE = -1;

/**
 * The user's units by model cell, from a payload's `userRegions` (see Generation.userRegions).
 * Null when there are none.
 * @param {{realms?: {key: number, cells: number[]}[], duchies?: {key: number, cells: number[], independent?: boolean}[], counties?: {key: number, cells: number[], independent?: boolean}[]}|null|undefined} given
 * @param {{count: number, water: Uint8Array, landKm2: Float64Array}} cells - The model cells.
 * @returns {object|null}
 */
export function userZones(given, cells) {
    if (!given) return null;
    const lists = { realms: cleanList(given.realms), duchies: cleanList(given.duchies), counties: cleanList(given.counties) };
    if (!lists.realms.length && !lists.duchies.length && !lists.counties.length) return null;
    const count = cells.count;
    const realm = unitOfCell(lists.realms, count);
    const duchy = unitOfCell(lists.duchies, count);
    const county = unitOfCell(lists.counties, count);
    // Lone: a duchy mostly in no user realm; a county mostly in no user duchy or realm
    const loneDuchy = lists.duchies.map((_, index) => majorityOf(cellsWhere(duchy, index), realm) === NONE);
    const loneCounty = lists.counties.map((_, index) => {
        const own = cellsWhere(county, index);
        return majorityOf(own, duchy) === NONE && majorityOf(own, realm) === NONE;
    });
    const ownDuchy = (d) => d >= 0 && loneDuchy[d] && lists.duchies[d].independent;
    const ownCounty = (c) => c >= 0 && loneCounty[c] && lists.counties[c].independent;
    const zoneIds = (keyOf) => {
        const ids = new Map();
        return Int32Array.from({ length: count }, (_, cell) => {
            const key = keyOf(cell);
            if (!ids.has(key)) ids.set(key, ids.size);
            return ids.get(key);
        });
    };
    const key = (list, index) => (index >= 0 ? list[index].key : NONE);
    return {
        realm,
        duchy,
        county,
        realms: lists.realms,
        duchies: lists.duchies,
        counties: lists.counties,
        loneDuchy,
        loneCounty,
        // Where each level's floods meet a border they may not cross (see BARRIER)
        countyZone: zoneIds((cell) => `${realm[cell]},${duchy[cell]},${county[cell]}`),
        duchyZone: zoneIds((cell) => `${realm[cell]},${duchy[cell]},${ownCounty(county[cell]) ? county[cell] : NONE}`),
        realmZone: zoneIds((cell) => `${realm[cell]},${ownDuchy(duchy[cell]) ? duchy[cell] : NONE},${ownCounty(county[cell]) ? county[cell] : NONE}`),
        /** The user regions a cell lies in, by their keys (see the result's county `zone`). */
        keysAt: (cell) => (county[cell] >= 0 ? `c:${lists.counties[county[cell]].key}` : `${key(lists.realms, realm[cell])},${key(lists.duchies, duchy[cell])},${NONE}`),
        ownDuchy,
        ownCounty,
        water: cells.water,
        landKm2: cells.landKm2,
    };
}

/** A user region list with whole-number cells only (a damaged payload's entries are dropped). */
function cleanList(list) {
    if (!Array.isArray(list)) return [];
    return list.filter((region) => Number.isInteger(region?.key) && Array.isArray(region.cells)).map((region) => ({ key: region.key, cells: region.cells.filter(Number.isInteger), independent: region.independent === true }));
}

/** Each cell's unit in a list (the last to name a cell holds it), or NONE. */
function unitOfCell(list, count) {
    const of = new Int32Array(count).fill(NONE);
    list.forEach((region, index) => {
        for (const cell of region.cells) if (cell >= 0 && cell < count) of[cell] = index;
    });
    return of;
}

function cellsWhere(of, index) {
    const found = [];
    for (let cell = 0; cell < of.length; cell++) if (of[cell] === index) found.push(cell);
    return found;
}

/**
 * The value `of` gives most of `cells` (NONE counts too, so a unit mostly outside every unit of
 * that level is outside), ties to the lowest; NONE for no cells.
 */
function majorityOf(cells, of) {
    const counts = new Map();
    for (const cell of cells) counts.set(of[cell], (counts.get(of[cell]) ?? 0) + 1);
    let best = NONE;
    let most = 0;
    for (const [value, n] of counts) {
        if (n > most || (n === most && value < best)) {
            best = value;
            most = n;
        }
    }
    return best;
}

/** Multiplies a step's cost by BARRIER where it crosses between zones. */
function zoneBarrier(zone, other = null) {
    return (a, b) => (zone[a] === zone[b] ? 1 : BARRIER) * (other ? other(a, b) : 1);
}

/**
 * Realms, duchies and counties round the user's units (see above): Realms.buildRealms with
 * `context.userZones` (see userZones).
 * @param {import("./CellGraph.js").CellGraph} graph
 * @param {object} context - As Realms.buildRealms', with userZones.
 * @returns {object} As Realms.buildRealms'.
 */
export function buildRealmsAround(graph, context) {
    const zones = context.userZones;
    const cells = graph.cells;
    const road = roadsFrom(graph, context.traffic);
    const culture = context.cultures.cultures.length > 1 ? cultureBarrier(context.cultures) : null;
    const cost = (zone, withCulture) => graph.costs(politicalCost(graph, { road, barrier: zoneBarrier(zone, withCulture ? culture : null) }));
    const state = {
        graph,
        cells,
        context,
        zones,
        townAt: new Map(context.towns.map((town) => [town.cell, town])),
        countyCost: cost(zones.countyZone, false),
        duchyCost: cost(zones.duchyZone, true),
        kingdomCost: cost(zones.realmZone, true),
        power: powers(context.world),
    };
    const counties = zoneCounties(state);
    const duchies = zoneDuchies(state, counties);
    const kingdoms = zoneKingdoms(state, duchies);
    const result = assemble(state, counties, duchies, kingdoms);
    result.borders = borderHostility({ graph, realmOfCell: result.realmOfCell, realms: result.realms, cultures: context.cultures });
    return result;
}

// ------------------------------------------------------------------ seats

/** The town with the most people among `list`, else the cell with the most people; -1 for none. */
function seatOf(state, list) {
    let best = -1;
    let bestTown = -1;
    for (const cell of list) {
        const people = state.townAt.get(cell)?.population ?? -1;
        if (people > bestTown) {
            best = cell;
            bestTown = people;
        }
    }
    if (bestTown >= 0) return best;
    return list.reduce((top, cell) => (top < 0 || state.context.cellPop[cell] > state.context.cellPop[top] ? cell : top), -1);
}

/** A user unit's land cells (by its index in `of`). */
function landOf(state, of, index) {
    const { water, landKm2 } = state.zones;
    return cellsWhere(of, index).filter((cell) => !water[cell] && landKm2[cell] > 0);
}

// ------------------------------------------------------------------ counties

/** Counties that never cross a user border, and one county for each user county. */
function zoneCounties(state) {
    const { graph, cells, context, zones } = state;
    const R = FILRODENSWMB.GENERATOR.REALMS;
    // Cities and large towns seat counties, except inside a user county (that county is the user's)
    const seats = context.towns.filter((town) => town.tier <= 1 && zones.county[town.cell] === NONE);
    const flood = searchAll(graph, seats.map((town) => town.cell), state.countyCost, { limit: R.COUNTY_REACH_KM });
    const list = seats.map((town, id) => countyEntry(id, town.cell, town));
    const countyOfCell = Int32Array.from(flood.owner, (county, cell) => (cells.water[cell] ? NONE : county));
    absorbEnclaves(graph, countyOfCell);
    // A pocket joined across a user border goes back: a generated county keeps its seat's side
    for (let cell = 0; cell < cells.count; cell++) {
        const county = countyOfCell[cell];
        if (county >= 0 && zones.countyZone[cell] !== zones.countyZone[list[county].seat]) countyOfCell[cell] = NONE;
    }
    zones.counties.forEach((region, index) => {
        const land = landOf(state, zones.county, index);
        if (!land.length) return;
        const seat = seatOf(state, land);
        const entry = countyEntry(list.length, seat, state.townAt.get(seat) ?? null);
        entry.user = index;
        list.push(entry);
        for (const cell of land) countyOfCell[cell] = entry.id;
    });
    tallyCounties(state, list, countyOfCell);
    return { list, countyOfCell };
}

// ------------------------------------------------------------------ duchies

/** The user realm and user duchy each county lies in (by most of its cells), and its cells. */
function countyPlaces(state, counties) {
    const { zones } = state;
    const cellsOf = counties.list.map(() => []);
    counties.countyOfCell.forEach((county, cell) => county >= 0 && cellsOf[county].push(cell));
    return counties.list.map((county, index) => ({
        cells: cellsOf[index],
        realm: majorityOf(cellsOf[index], zones.realm),
        duchy: majorityOf(cellsOf[index], zones.duchy),
        // A lone user county ticked Independent: a state of its own
        ownState: county.user !== undefined && zones.ownCounty(county.user),
    }));
}

function duchyEntry(id, seat, seatCounty, extra = {}) {
    return { id, seat, seatCounty, counties: [], tax: 0, pop: 0, landKm2: 0, ...extra };
}

/** Duchies: generated by reach, user duchies holding the counties inside them, split where a duke reached across a user border. */
function zoneDuchies(state, counties) {
    const { zones } = state;
    const places = countyPlaces(state, counties);
    // Cities seat duchies, except in a user duchy (that duchy is the user's) or a county standing alone
    const seats = counties.list.filter((county, index) => county.seatTown?.tier === 0 && places[index].duchy === NONE && !places[index].ownState);
    const medianTax = median(seats.map((county) => county.tax));
    const scale = seats.map((county) => (medianTax / county.tax) ** state.power.duchy);
    const flood = searchAll(state.graph, seats.map((county) => county.seat), state.duchyCost, { scale });
    const list = seats.map((county, id) => duchyEntry(id, county.seat, county.id));
    const seatDuchy = new Map(seats.map((county, id) => [county.id, id]));
    const userDuchy = zones.duchies.map((_, index) => {
        const land = landOf(state, zones.duchy, index);
        if (!land.length) return NONE;
        list.push(duchyEntry(list.length, seatOf(state, land), NONE, { user: index }));
        return list.length - 1;
    });
    const split = new Map();
    const duchyOfCounty = new Int32Array(counties.list.length).fill(NONE);
    counties.list.forEach((county, index) => {
        const place = places[index];
        if (!place.cells.length) return;
        if (place.duchy >= 0 && userDuchy[place.duchy] >= 0) duchyOfCounty[index] = userDuchy[place.duchy];
        else if (place.ownState) {
            list.push(duchyEntry(list.length, county.seat, index, { lone: true }));
            duchyOfCounty[index] = list.length - 1;
        } else if (seatDuchy.has(index)) duchyOfCounty[index] = seatDuchy.get(index);
        else duchyOfCounty[index] = reachedDuchy(state, list, split, county, flood.owner[county.seat]);
    });
    tallyDuchies(counties, list, duchyOfCounty);
    return { list, duchyOfCounty, places };
}

/**
 * The duchy a county joins by reach: the duke whose flood reached its seat, unless he reached it
 * across a user border, in which case a duchy of the county's own side (one per duke and side,
 * seated at its largest town) takes it.
 */
function reachedDuchy(state, list, split, county, owner) {
    if (owner < 0) return NONE;
    const zone = state.zones.duchyZone;
    if (zone[list[owner].seat] === zone[county.seat]) return owner;
    const key = `${owner}:${zone[county.seat]}`;
    if (!split.has(key)) {
        list.push(duchyEntry(list.length, county.seat, county.id));
        split.set(key, list.length - 1);
    }
    const duchy = list[split.get(key)];
    if ((state.townAt.get(county.seat)?.population ?? 0) > (state.townAt.get(duchy.seat)?.population ?? 0)) {
        duchy.seat = county.seat;
        duchy.seatCounty = county.id;
    }
    return duchy.id;
}

function tallyDuchies(counties, list, duchyOfCounty) {
    counties.list.forEach((county, index) => {
        const duchy = list[duchyOfCounty[index]];
        if (!duchy) return;
        duchy.counties.push(index);
        duchy.tax += county.tax;
        duchy.pop += county.rural + county.urban;
        duchy.landKm2 += county.landKm2;
    });
}

// ------------------------------------------------------------------ kingdoms

/** Kingdoms over the duchies in no user realm, by reach; none crowned in a user realm or a state of its own. */
function zoneKingdoms(state, duchies) {
    const R = FILRODENSWMB.GENERATOR.REALMS;
    const { zones } = state;
    const list = duchies.list;
    const realmOf = list.map((duchy) => majorityOf(duchy.counties.flatMap((county) => duchies.places[county].cells), zones.realm));
    // A lone user duchy ticked Independent, and a lone county's own duchy, stand alone
    const ownState = list.map((duchy) => duchy.lone === true || (duchy.user !== undefined && zones.ownDuchy(duchy.user)));
    const eligible = (duchy) => realmOf[duchy] === NONE && !ownState[duchy];
    const royal = royalDuchies({ ...state, cost: state.kingdomCost }, list, eligible);
    const medianTax = median(royal.map((duchy) => list[duchy].tax));
    const scale = royal.map((duchy) => (medianTax / list[duchy].tax) ** state.power.kingdom);
    const flood = searchAll(state.graph, royal.map((duchy) => list[duchy].seat), state.kingdomCost, { scale, limit: R.KINGDOM_REACH_KM });
    const kingdomOfDuchy = Int32Array.from(list, (duchy, index) => (eligible(index) ? flood.owner[duchy.seat] : NONE));
    royal.forEach((duchy, index) => (kingdomOfDuchy[duchy] = index));
    applyRealmEvents({ ...state, cost: state.kingdomCost }, list, royal, kingdomOfDuchy, eligible);
    const members = royal.map(() => []);
    kingdomOfDuchy.forEach((kingdom, duchy) => {
        if (kingdom >= 0) members[kingdom].push(duchy);
    });
    return { ...keepRealKingdoms(royal, members, kingdomOfDuchy, list), realmOf };
}

// ------------------------------------------------------------------ per-cell result

/**
 * The realms (kingdoms, then user realms, then duchies standing alone) and every cell's county,
 * duchy and realm; a user realm also holds its land no county reached.
 */
function assemble(state, counties, duchies, kingdoms) {
    const { cells, zones, context } = state;
    const userRealms = zones.realms.map((_, index) => landOf(state, zones.realm, index));
    const realmOfDuchy = Int32Array.from(kingdoms.kingdomOfDuchy);
    const userRealmIndex = userRealms.map(() => NONE);
    let next = kingdoms.list.length;
    userRealms.forEach((land, index) => {
        if (land.length) userRealmIndex[index] = next++;
    });
    const independents = [];
    duchies.list.forEach((duchy, index) => {
        const inRealm = kingdoms.realmOf[index];
        if (inRealm >= 0) realmOfDuchy[index] = userRealmIndex[inRealm];
        else if (kingdoms.kingdomOfDuchy[index] < 0) {
            realmOfDuchy[index] = next + independents.length;
            independents.push(index);
        }
    });
    const duchyOfCell = new Int32Array(cells.count).fill(NONE);
    const realmOfCell = new Int32Array(cells.count).fill(NONE);
    for (let cell = 0; cell < cells.count; cell++) {
        const county = counties.countyOfCell[cell];
        const duchy = county >= 0 ? duchies.duchyOfCounty[county] : NONE;
        if (duchy >= 0) {
            duchyOfCell[cell] = duchy;
            realmOfCell[cell] = realmOfDuchy[duchy];
        }
        // A user realm's wilds are its own
        if (zones.realm[cell] >= 0 && !cells.water[cell] && userRealmIndex[zones.realm[cell]] >= 0) realmOfCell[cell] = userRealmIndex[zones.realm[cell]];
    }
    const userRealmEntries = [];
    userRealms.forEach((land, index) => {
        if (!land.length) return;
        const own = duchies.list.map((_, duchy) => duchy).filter((duchy) => realmOfDuchy[duchy] === userRealmIndex[index]);
        const entry = realmEntry("kingdom", userRealmSeat(state, land, own, duchies.list), own, 0, 0, duchies);
        for (const cell of land) {
            entry.pop += context.cellPop[cell] + (state.townAt.get(cell)?.population ?? 0);
            entry.landKm2 += cells.landKm2[cell];
        }
        entry.user = zones.realms[index].key;
        userRealmEntries.push(entry);
    });
    const realms = [
        ...kingdoms.list.map((kingdom) => realmEntry("kingdom", kingdom.seat, kingdom.duchies, kingdom.pop, kingdom.landKm2, duchies)),
        ...userRealmEntries,
        ...independents.map((duchy) => realmEntry("independent", duchies.list[duchy].seat, [duchy], duchies.list[duchy].pop, duchies.list[duchy].landKm2, duchies)),
    ];
    return {
        counties: counties.list.map((county) => withUser({ seat: county.seat, pop: county.rural + county.urban, landKm2: county.landKm2, tax: county.tax, zone: zones.keysAt(county.seat) }, county.user, zones.counties)),
        duchies: duchies.list.map((duchy) => withUser({ seat: duchy.seat, counties: duchy.counties, pop: duchy.pop, landKm2: duchy.landKm2, tax: duchy.tax }, duchy.user, zones.duchies)),
        realms,
        countyOfCell: counties.countyOfCell,
        duchyOfCell,
        realmOfCell,
        duchyOfCounty: duchies.duchyOfCounty,
        realmOfDuchy,
    };
}

/** A unit standing for a user region carries that region's key as `user`. */
function withUser(unit, index, list) {
    if (index !== undefined) unit.user = list[index].key;
    return unit;
}

/**
 * A user realm's seat: a capital seat pin inside it (the largest town among several), else the
 * seat of its duchy with the most people, else its largest town.
 */
function userRealmSeat(state, land, own, duchies) {
    const seats = state.cells.seats;
    const capitals = seats ? land.filter((cell) => seats.get(cell)?.kind === "capital") : [];
    if (capitals.length) return seatOf(state, capitals);
    if (own.length) return duchies[own.reduce((best, duchy) => (duchies[duchy].pop > duchies[best].pop ? duchy : best))].seat;
    return seatOf(state, land);
}
