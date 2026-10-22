import { NamesGenerator } from "../../vendor/azgaar-names/names-generator.js";
import { FILRODENSWMB } from "../config.js";
import { stageRandom } from "./Random.js";

/**
 * Stage 6: names for every settlement, castle, county, duchy and realm, from Azgaar's Markov-chain
 * name generator and its name bases (vendor/azgaar-names). Each place takes the name base of its
 * dominant culture (the default culture takes the run's name style).
 *
 * Names are deterministic for the run's seed (the stage's own random source), and places are named
 * largest first, so the important names stay put when small places come and go. A name is tried
 * again a few times to avoid a duplicate, then a duplicate is accepted (real maps have those too).
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
 * @returns {{towns: Map<number, string>, castles: {name: string, keep: string}[], counties: string[], duchies: string[], realms: {name: string, capital: string}[], former: {towns: Map<number, string>, castles: {name: string, keep: string}[]}}}
 */
export function nameEverything({ seed, nameBase, cultures, towns, castles, realms, former = null }) {
    const generator = new NamesGenerator(stageRandom(seed, "names"));
    const baseAt = baseChooser(generator, nameBase, cultures, towns);
    const used = new Set();
    const unique = (make, pool = used) => {
        let name = make();
        for (let attempt = 0; attempt < FILRODENSWMB.GENERATOR.NAME_RETRIES && pool.has(name); attempt++) name = make();
        pool.add(name);
        return name;
    };

    const townNames = new Map();
    for (const town of [...towns].sort((a, b) => b.population - a.population || a.cell - b.cell)) {
        townNames.set(town.cell, unique(() => generator.getBase(baseAt(town.cell))));
    }
    const words = FILRODENSWMB.GENERATOR.CASTLE_WORDS;
    const castleNames = castles.map((castle) => ({
        name: unique(() => generator.getBaseShort(baseAt(castle.cell))),
        keep: words[Math.floor(generator.rng() * words.length)],
    }));
    const seatName = (cell) => townNames.get(cell) ?? unique(() => generator.getBase(baseAt(cell)));
    const countyNames = realms.counties.map((county) => seatName(county.seat));
    const duchyNames = realms.duchies.map((duchy) => seatName(duchy.seat));
    // A realm may share its capital's name, but not another realm's
    const realmNames = new Set();
    const realmList = realms.realms.map((realm) => {
        const capital = seatName(realm.seat);
        const name = realm.kind === "kingdom" ? unique(() => generator.getState(capital, baseAt(realm.seat)), realmNames) : capital;
        return { name, capital };
    });
    const baseOf = (name) => {
        const index = generator.indexOf(name);
        return index >= 0 ? index : Math.max(0, generator.indexOf(nameBase));
    };
    const formerTowns = new Map();
    for (const town of [...(former?.towns ?? [])].sort((a, b) => b.population - a.population || a.cell - b.cell)) {
        formerTowns.set(town.cell, unique(() => generator.getBase(baseOf(town.nameBase))));
    }
    const formerCastles = (former?.castles ?? []).map((castle) => ({
        name: unique(() => generator.getBaseShort(baseOf(castle.nameBase))),
        keep: words[Math.floor(generator.rng() * words.length)],
    }));
    return { towns: townNames, castles: castleNames, counties: countyNames, duchies: duchyNames, realms: realmList, former: { towns: formerTowns, castles: formerCastles } };
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
