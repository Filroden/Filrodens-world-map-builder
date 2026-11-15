import { NamesGenerator } from "../../vendor/azgaar-names/names-generator.js";
import { FILRODENSWMB } from "../config.js";
import { nameStream } from "../names/PlaceNames.js";
import { stageRandom } from "./Random.js";

/**
 * Stage 6: names for every settlement, castle, county, duchy and realm, from Azgaar's Markov-chain
 * name generator and its name bases (vendor/azgaar-names). Each place takes the name base of its
 * dominant culture (the default culture takes the run's name style).
 *
 * Names are deterministic for the run's seed. From generator revision 2 (`idNames`), each place,
 * castle and realm draws its name from a stream of its own, seeded by the run's seed and the
 * item's key (a town or ruin by its cell, a castle by its cell, a realm by its seat; see itemKey),
 * as the map's own items' suggestions are (PlaceNames.nameStream): a place keeps its name when
 * another place appears or goes, and a place standing in the same cell in several ages has the same
 * name in each (for the same name base). Before revision 2 the whole run drew from one stream in
 * order, so a place's name depended on every place named before it.
 *
 * Places are named largest first. A name is tried again a few times to avoid a duplicate (a new
 * roll of the item's own stream), then a duplicate is accepted (real maps have those too); so a
 * place's name changes only when a larger place takes it first.
 *
 * Only the names themselves are made here. The words around them ("Kingdom of", "Castle") are the
 * interface's, in the user's language, so a castle carries the kind of keep it is rather than an
 * English word, and a realm its state name rather than a title.
 */

/** The names of the 43 bases, in the generator's order (the Name style choices). */
export function nameBaseNames() {
    return new NamesGenerator(() => 0).nameBases.map((base) => base.name);
}

/**
 * @param {object} context
 * @param {string} context.seed
 * @param {string} context.nameBase - The base used where a culture names none it knows.
 * @param {import("./Cultures.js").CultureData} context.cultures
 * @param {object[]} context.towns
 * @param {{cell: number}[]} context.castles
 * @param {object} context.realms - buildRealms's result.
 * @param {{towns: {cell: number, population: number, nameBase: string}[], castles: {cell: number, nameBase: string}[]}} [context.former] -
 *     The places the age before the present left (ruins and abandoned castles; see FormerAge), each
 *     named in the name base of the people living there then. They are named after everything
 *     else, so the present's names are the same with or without them.
 * @param {{cultures: import("./Cultures.js").CultureData, towns: object[], castles: {cell: number}[], realms: object}[]} [context.history] -
 *     The ages before the present, oldest first: each age's cultures, towns, castles and realms.
 *     They are named last of all (so every other name is the same with or without them), newest
 *     age first: a place keeps the name its cell's place has in the present, as an age-before ruin
 *     or in a later age, and anything else is named in the name base of the people living there
 *     in that age.
 * @param {boolean} [context.idNames] - Each item named from a stream of its own (generator revision 2).
 * @returns {{towns: Map<number, string>, castles: {name: string, keep: string}[], counties: string[], duchies: string[], realms: {name: string, capital: string}[], former: {towns: Map<number, string>, castles: {name: string, keep: string}[]}, history: {places: Map<number, string>, castles: {name: string, keep: string}[], realms: string[]}[]}}
 */
export function nameEverything({ seed, nameBase, cultures, towns, castles, realms, former = null, history = [], idNames = false }) {
    const generator = new NamesGenerator(stageRandom(seed, "names"));
    const baseAt = baseChooser(generator, nameBase, cultures, towns);
    const used = new Set();
    // An item's draws (see itemKey): its own stream from revision 2, each try a new roll of it;
    // before, the run's one stream
    const item = (key, make) => {
        let roll = 0;
        return () => {
            if (idNames) generator.rng = nameStream(seed, key, roll++);
            return make();
        };
    };
    const unique = (make, pool = used) => {
        let name = make();
        for (let attempt = 0; attempt < FILRODENSWMB.GENERATOR.NAME_RETRIES && pool.has(name); attempt++) name = make();
        pool.add(name);
        return name;
    };

    const townNames = new Map();
    for (const town of [...towns].sort((a, b) => b.population - a.population || a.cell - b.cell)) {
        townNames.set(town.cell, unique(item(itemKey("town", town.cell), () => generator.getBase(baseAt(town.cell)))));
    }
    const words = FILRODENSWMB.GENERATOR.CASTLE_WORDS;
    // A castle's keep word follows its name in the same stream
    const castleName = (cell, base) => ({
        name: unique(item(itemKey("castle", cell), () => generator.getBaseShort(base))),
        keep: words[Math.floor(generator.rng() * words.length)],
    });
    const castleNames = castles.map((castle) => castleName(castle.cell, baseAt(castle.cell)));
    const seatName = (cell) => townNames.get(cell) ?? unique(item(itemKey("town", cell), () => generator.getBase(baseAt(cell))));
    const countyNames = realms.counties.map((county) => seatName(county.seat));
    const duchyNames = realms.duchies.map((duchy) => seatName(duchy.seat));
    // A realm may share its capital's name, but not another realm's
    const realmNames = new Set();
    const realmList = realms.realms.map((realm) => {
        const capital = seatName(realm.seat);
        const name = realm.kind === "kingdom" ? unique(item(itemKey("realm", realm.seat), () => generator.getState(capital, baseAt(realm.seat))), realmNames) : capital;
        return { name, capital };
    });
    const baseOf = (name) => {
        const index = generator.indexOf(name);
        return index >= 0 ? index : Math.max(0, generator.indexOf(nameBase));
    };
    const formerTowns = new Map();
    for (const town of [...(former?.towns ?? [])].sort((a, b) => b.population - a.population || a.cell - b.cell)) {
        formerTowns.set(town.cell, unique(item(itemKey("town", town.cell), () => generator.getBase(baseOf(town.nameBase)))));
    }
    const formerCastles = (former?.castles ?? []).map((castle) => castleName(castle.cell, baseOf(castle.nameBase)));

    // The ages before the present. A cell's place is one place through the ages, so once named it
    // keeps its name in every earlier age it stood in
    const knownTowns = new Map([...townNames, ...formerTowns]);
    const knownCastles = new Map();
    castles.forEach((castle, index) => knownCastles.set(castle.cell, castleNames[index]));
    (former?.castles ?? []).forEach((castle, index) => knownCastles.set(castle.cell, formerCastles[index]));
    const historyNames = new Array(history.length);
    for (let at = history.length - 1; at >= 0; at--) {
        const age = history[at];
        const ageBaseAt = baseChooser(generator, nameBase, age.cultures, age.towns);
        const places = new Map();
        for (const town of [...age.towns].sort((a, b) => b.population - a.population || a.cell - b.cell)) {
            if (!knownTowns.has(town.cell)) knownTowns.set(town.cell, unique(item(itemKey("town", town.cell), () => generator.getBase(ageBaseAt(town.cell)))));
            places.set(town.cell, knownTowns.get(town.cell));
        }
        const ageCastles = age.castles.map((castle) => {
            if (!knownCastles.has(castle.cell)) knownCastles.set(castle.cell, castleName(castle.cell, ageBaseAt(castle.cell)));
            return knownCastles.get(castle.cell);
        });
        const ageRealms = age.realms.realms.map((realm) => {
            if (!knownTowns.has(realm.seat)) knownTowns.set(realm.seat, unique(item(itemKey("town", realm.seat), () => generator.getBase(ageBaseAt(realm.seat)))));
            const capital = knownTowns.get(realm.seat);
            return realm.kind === "kingdom" ? unique(item(itemKey("realm", realm.seat), () => generator.getState(capital, ageBaseAt(realm.seat))), realmNames) : capital;
        });
        historyNames[at] = { places, castles: ageCastles, realms: ageRealms };
    }
    return { towns: townNames, castles: castleNames, counties: countyNames, duchies: duchyNames, realms: realmList, former: { towns: formerTowns, castles: formerCastles }, history: historyNames };
}

/**
 * An item's key for its own name stream (see nameEverything): its kind and its model cell (a realm's
 * by its seat). Model cells are fixed for a map's mesh, so the key is the same in every run and age.
 */
function itemKey(kind, cell) {
    return `run:${kind}:${cell}`;
}

/** The name base index for a cell: its town's culture, else the cell's dominant culture, else `nameBase`. */
function baseChooser(generator, nameBase, cultures, towns) {
    const fallback = Math.max(0, generator.indexOf(nameBase));
    const cultureBase = cultures.cultures.map((culture) => {
        const index = generator.indexOf(culture.nameBase);
        return index >= 0 ? index : fallback;
    });
    if (cultureBase.length === 1) return () => cultureBase[0];
    const townCulture = new Map(towns.map((town) => [town.cell, town.culture ?? -1]));
    return (cell) => {
        const culture = townCulture.get(cell) ?? -1;
        if (culture >= 0) return cultureBase[culture];
        return cultures.dominant[cell] >= 0 ? cultureBase[cultures.dominant[cell]] : fallback;
    };
}
