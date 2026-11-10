import { FILRODENSWMB } from "../config.js";
import { habitatFit } from "./Cultures.js";
import { SearchSpace } from "./Search.js";

/**
 * An age's era and events in the model's own terms (see GENERATOR.ERAS and GENERATOR.EVENTS).
 *
 * Each event acts at the stage it belongs to, whatever order the age lists them in:
 *   1. people    invasion and arrival (see Pipeline.agePeople), migration and colonisation: who
 *                lives where
 *   2. capacity  the era's capacity and frontier, famine, disaster, plague (on top of the era's),
 *                trade boom: how many the land feeds, and the trade budget
 *   3. realms    civil war (a realm splits), union (a realm absorbs its strongest neighbour, for
 *                as long as its crown lasts in the ages after),
 *                collapse (a realm breaks into independent duchies)
 *   4. strife    invasion, civil war and collapse raise the strife felt in their land, the larger
 *                rise where several meet; a trade war sets realms' trade against each other in the
 *                final trade round
 *
 * A realm event acts on the realm holding its place (a point on the map): the age's first realm
 * pass runs once without the event to find it, then again with it, so the realm is one the user
 * sees in that age, and realm events work in a first age too. A place on land no realm holds takes
 * the realm whose land is nearest; with no place, the largest realm. A disaster centres on its
 * place, else on the age before's largest coastal or river town (floods and storms find them).
 *
 * With no events and one of the eras of before, nothing here changes the run.
 */

/**
 * @param {object} run - The run (cells, graph, settings, cellAt).
 * @param {object[]} ages - The run's ages (see GeneratorSettings).
 * @param {number} index - This age's.
 * @param {object|null} previous - The age before, as Pipeline's next() gives it.
 */
export function ageEvents(run, ages, index, previous) {
    const E = FILRODENSWMB.GENERATOR.EVENTS;
    const { cells, graph } = run;
    const list = ages[index].events ?? [];
    const has = (kind) => list.find((event) => event.kind === kind) ?? null;
    const cellOf = (event) => (event?.place ? run.cellAt(event.place) : -1);
    const age = { ...ages[index] };
    const world = { ...run.settings.world };
    const report = [];
    if (age.urbanisation) world.urbanisation *= age.urbanisation;
    if (age.fragmentation) world.fragmentation *= age.fragmentation;

    // ------------------------------------------------ capacity
    const factor = new Float64Array(cells.count).fill(1);
    let touched = false;
    const famine = has("famine");
    const marginal = age.frontier || famine ? marginality(cells) : null;
    if (age.capacity) {
        touched = true;
        factor.fill(age.capacity);
    }
    if (age.frontier) {
        touched = true;
        for (let cell = 0; cell < cells.count; cell++) factor[cell] *= 1 + age.frontier * marginal[cell];
    }
    if (has("plague")) age.plague = 1 - (1 - age.plague) * (1 - E.PLAGUE);
    if (famine) {
        touched = true;
        for (let cell = 0; cell < cells.count; cell++) factor[cell] *= 1 - (E.FAMINE_BASE + E.FAMINE_MARGINAL * marginal[cell]);
    }
    const disaster = has("disaster");
    if (disaster) {
        touched = true;
        const pinned = cellOf(disaster);
        const centre = pinned >= 0 ? pinned : disasterCentre(cells, previous);
        // Distance over the cells (land and water alike), not travel time: a flood or an eruption
        // reaches as far over hills as over plains
        const barred = new Uint8Array(cells.count);
        let hit = 0;
        new SearchSpace(graph).run([centre], graph.costs((edge) => graph.edgeKm[edge]), {
            limit: E.DISASTER_KM,
            visit: (cell, reached) => {
                factor[cell] *= 1 - E.DISASTER_LOSS * (1 - reached / E.DISASTER_KM);
                if (reached <= E.DISASTER_BAR_KM) barred[cell] = 1;
                hit++;
            },
        });
        age.barredCells = barred;
        report.push({ kind: "disaster", cell: centre, placed: pinned >= 0, cells: hit });
    }
    if (touched) age.cellFactor = factor;
    if (has("tradeBoom")) world.tradeBoom = E.TRADE_BOOM;

    // ------------------------------------------------ people
    const colonisation = has("colonisation");
    const migration = has("migration");
    /** The age's people with a colonist's homeland moved to the best land no realm held in the age before. */
    const people = (listed) => {
        if (!colonisation || !previous) return listed;
        return listed.map((culture) => {
            if (culture.id !== colonisation.culture) return culture;
            const home = emptiestFit(cells, previous, culture);
            if (home < 0) return culture;
            report.push({ kind: "colonisation", culture: culture.id, cell: home });
            return { ...culture, homelandCells: [home], homelandsGiven: 1 };
        });
    };
    /**
     * Each spreading culture's scale on its cost per cell, by its index in the age's list: a migrant
     * finds land another people held in the age before harder to spread into (it settles among
     * them rather than taking over); a colonist, land any realm held.
     */
    const scales = (listed) => {
        const map = new Map();
        if (!previous) return map;
        for (const [event, scaleAt] of [
            [migration, (cell, id) => (previous.dominantId[cell] !== null && previous.dominantId[cell] !== id ? E.MIGRATION_SPREAD : 1)],
            [colonisation, (cell) => (previous.realmOfCell[cell] >= 0 ? E.COLONY_SPREAD : 1)],
        ]) {
            if (!event) continue;
            const at = listed.findIndex((culture) => culture.id === event.culture);
            if (at >= 0) map.set(at, Float64Array.from({ length: cells.count }, (_, cell) => scaleAt(cell, event.culture)));
        }
        return map;
    };

    // ------------------------------------------------ realms
    const rise = new Float64Array(cells.count);
    let risen = false;
    const raise = (area, by) => {
        risen = true;
        for (let cell = 0; cell < cells.count; cell++) if (area[cell]) rise[cell] = Math.max(rise[cell], by);
    };
    const civilWar = has("civilWar");
    const union = has("union");
    const collapse = has("collapse");
    const anyRealmEvent = !!(civilWar || union || collapse);
    // A union made in an age before lasts while its crown does: its partner's seat is never crowned
    // again and its land goes to the crown (see lastingUnions)
    const carried = previous?.unions ?? [];
    const lasting = () => (carried.length ? { unions: carried.map(({ crownSeat, area }) => ({ crownSeat, area })), barredSeats: new Set(carried.map((entry) => entry.partnerSeat)) } : {});
    let extra = lasting();
    let made = null;
    /** The realm an event acts on among a realm pass's realms: its place's, the nearest to it, or the largest. */
    const target = (realms, event) => {
        const cell = cellOf(event);
        if (cell >= 0) {
            const held = realms.realmOfCell[cell];
            if (held >= 0) return held;
            const near = nearestRealm(graph, realms.realmOfCell, cell);
            if (near >= 0) return near;
        }
        return largestRealm(realms);
    };
    /** The realm events against an age's first realms (built without them): what the realm passes are given. */
    const resolveRealms = (realms) => {
        extra = lasting();
        if (!realms.realms.length) return extra;
        if (civilWar) {
            const realm = target(realms, civilWar);
            const area = areaOf(realms, realm);
            extra.partition = { area, crownSeats: null };
            raise(area, E.CIVIL_WAR_STRIFE);
            report.push({ kind: "civilWar", realm, seat: realms.realms[realm].seat, land: cellsOf(area), partition: extra.partition });
        }
        if (union) {
            const realm = target(realms, union);
            // A realm the map's own regions hold keeps exactly its land, so it can neither absorb nor be absorbed
            const partner = realms.realms[realm].user === undefined ? strongestNeighbour(graph, realms, realm) : -1;
            if (partner >= 0) {
                const partnerSeat = realms.realms[partner].seat;
                made = { home: areaOf(realms, realm), area: areaOf(realms, partner), partnerSeat };
                extra.unions = [...(extra.unions ?? []), { home: made.home, area: made.area }];
                extra.barredSeats = new Set([...(extra.barredSeats ?? []), partnerSeat]);
                report.push({ kind: "union", realm, partner, seat: realms.realms[realm].seat, partnerSeat, land: cellsOf(made.home), partnerLand: cellsOf(made.area) });
            } else report.push({ kind: "union", realm, partner: -1, seat: realms.realms[realm].seat, blocked: realms.realms[realm].user !== undefined ? "userRealm" : "noNeighbour" });
        }
        if (collapse) {
            const realm = target(realms, collapse);
            const area = areaOf(realms, realm);
            extra.collapseArea = area;
            raise(area, E.COLLAPSE_STRIFE);
            report.push({ kind: "collapse", realm, seat: realms.realms[realm].seat, land: cellsOf(area) });
        }
        return extra;
    };

    return {
        age,
        world,
        people,
        scales,
        report,
        /** Whether the age's first realm pass must run twice (see resolveRealms). */
        realmEvents: anyRealmEvent,
        resolveRealms,
        /** What the realm passes are given: the age's realm events, and the unions lasting from the ages before. */
        get realmExtra() {
            return extra;
        },
        /**
         * The unions the next age carries on (see lastingUnions): the ones from before whose crown
         * is still a realm's seat, and this age's, by the crown holding most of its partner's land.
         * @param {object} finalRealms - The age's final realms.
         */
        lastingUnions: (finalRealms) => lastingUnions(finalRealms, carried, made),
        /**
         * The age's strife at each cell, or null where it is the age's alike: the larger of an
         * invasion's rise (`invasion`, each cell's strife under it, or null) and the realm events'.
         */
        strifeAt: (invasion) => {
            if (!risen) return invasion;
            const strifeAt = new Float64Array(cells.count);
            for (let cell = 0; cell < cells.count; cell++) {
                const invaded = invasion ? invasion[cell] - age.strife : 0;
                strifeAt[cell] = Math.min(1, age.strife + Math.max(invaded, rise[cell]));
            }
            return strifeAt;
        },
        /** The final trade round's trade war against the age's first realms, or null. */
        tradeWar: (realms) => {
            const war = has("tradeWar");
            if (!war) return null;
            const cell = cellOf(war);
            let only = -1;
            if (cell >= 0 && realms.realms.length) {
                only = realms.realmOfCell[cell];
                if (only < 0) only = nearestRealm(graph, realms.realmOfCell, cell);
            }
            report.push({ kind: "tradeWar", realm: only });
            return { volume: E.TRADE_WAR_VOLUME, cost: E.TRADE_WAR_COST, realmOfCell: realms.realmOfCell, only };
        },
    };
}

/**
 * The unions an age hands on to the next: each `{ crownSeat, partnerSeat, area }` (the partner's
 * land when it was absorbed), kept while its crown is still a realm's seat. This age's union is
 * carried by the realm that holds most of its partner's land, when that realm is seated in the
 * absorbing realm's land.
 */
function lastingUnions(finalRealms, carried, made) {
    const seats = new Set(finalRealms.realms.map((realm) => realm.seat));
    const kept = carried.filter((entry) => seats.has(entry.crownSeat));
    if (!made) return kept;
    const held = new Map();
    for (let cell = 0; cell < made.area.length; cell++) {
        const realm = finalRealms.realmOfCell[cell];
        if (made.area[cell] && realm >= 0) held.set(realm, (held.get(realm) ?? 0) + 1);
    }
    const holder = [...held.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
    const crownSeat = holder === undefined ? -1 : finalRealms.realms[holder].seat;
    if (crownSeat >= 0 && made.home[crownSeat]) kept.push({ crownSeat, partnerSeat: made.partnerSeat, area: made.area });
    return kept;
}

/** 0 on land at least as productive per km² as the median land cell, rising to 1 on land that grows nothing. */
function marginality(cells) {
    const density = [];
    for (let cell = 0; cell < cells.count; cell++) if (!cells.water[cell] && cells.landKm2[cell] > 0) density.push(cells.food[cell] / cells.landKm2[cell]);
    density.sort((a, b) => a - b);
    const median = density[Math.floor(density.length / 2)] || 1;
    const out = new Float64Array(cells.count);
    for (let cell = 0; cell < cells.count; cell++) {
        if (cells.water[cell] || !(cells.landKm2[cell] > 0)) continue;
        out[cell] = Math.min(1, Math.max(0, 1 - cells.food[cell] / cells.landKm2[cell] / median));
    }
    return out;
}

/** The largest coastal or river town of the age before; else the coastal cell growing the most food. */
function disasterCentre(cells, previous) {
    const towns = (previous?.towns ?? []).filter((town) => cells.coastal[town.cell] || cells.navigable[town.cell]);
    if (towns.length) return towns.reduce((a, b) => (b.population > a.population ? b : a)).cell;
    let best = 0;
    for (let cell = 0; cell < cells.count; cell++) if (cells.coastal[cell] && cells.food[cell] > cells.food[best]) best = cell;
    return best;
}

/** The realm with the most people (ties to the first). */
function largestRealm(realms) {
    let best = 0;
    realms.realms.forEach((realm, index) => {
        if (realm.pop > realms.realms[best].pop) best = index;
    });
    return best;
}

/** The cells of an area, as a list. */
function cellsOf(area) {
    const list = [];
    for (let cell = 0; cell < area.length; cell++) if (area[cell]) list.push(cell);
    return Int32Array.from(list);
}

function areaOf(realms, realm) {
    return Uint8Array.from(realms.realmOfCell, (owner) => (owner === realm ? 1 : 0));
}

/**
 * The neighbouring realm with the most people (ties to the longer shared border), leaving out
 * realms the map's own regions hold; a realm with no neighbour on land (an island) takes the
 * nearest across the water. -1 for none.
 */
function strongestNeighbour(graph, realms, realm) {
    const owner = realms.realmOfCell;
    const may = (other) => other >= 0 && other !== realm && realms.realms[other].user === undefined;
    const border = new Map();
    for (let cell = 0; cell < graph.count; cell++) {
        if (owner[cell] !== realm) continue;
        for (let slot = graph.adjStart[cell]; slot < graph.adjStart[cell + 1]; slot++) {
            const other = owner[graph.adjCell[slot]];
            if (may(other)) border.set(other, (border.get(other) ?? 0) + 1);
        }
    }
    const pop = (index) => realms.realms[index].pop;
    const best = [...border.entries()].sort((a, b) => pop(b[0]) - pop(a[0]) || b[1] - a[1] || a[0] - b[0])[0]?.[0];
    if (best !== undefined) return best;
    const sources = [];
    for (let cell = 0; cell < graph.count; cell++) if (owner[cell] === realm) sources.push(cell);
    let nearest = -1;
    let nearestKm = Infinity;
    new SearchSpace(graph).run(sources, graph.costs((edge) => graph.edgeKm[edge]), {
        limit: 1e9,
        visit: (cell, reached) => {
            if (may(owner[cell]) && reached < nearestKm) {
                nearestKm = reached;
                nearest = owner[cell];
            }
        },
    });
    return nearest;
}

/** The best cell for a culture (its fit x food) on land no realm held in the age before, else anywhere; -1 for none. */
function emptiestFit(cells, previous, culture) {
    const resolved = { ...FILRODENSWMB.GENERATOR.CULTURES.DEFAULT, ...culture, habitat: culture.habitat ?? {} };
    for (const empty of [true, false]) {
        let best = -1;
        let bestScore = -1;
        for (let cell = 0; cell < cells.count; cell++) {
            if (cells.water[cell] || !(cells.landKm2[cell] > 0)) continue;
            if (empty && previous.realmOfCell[cell] >= 0) continue;
            const score = habitatFit(resolved, cells, cell) * cells.food[cell];
            if (score > bestScore) {
                bestScore = score;
                best = cell;
            }
        }
        if (best >= 0) return best;
    }
    return -1;
}

/** The realm holding the cell nearest `from` (by distance over the cells) that any realm holds; -1 for none. */
function nearestRealm(graph, realmOfCell, from) {
    let best = -1;
    let bestKm = Infinity;
    new SearchSpace(graph).run([from], graph.costs((edge) => graph.edgeKm[edge]), {
        limit: 1e9,
        visit: (cell, reached) => {
            if (realmOfCell[cell] >= 0 && reached < bestKm) {
                bestKm = reached;
                best = realmOfCell[cell];
            }
        },
    });
    return best;
}
