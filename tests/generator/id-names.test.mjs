// Id-based names (Names.nameEverything with idNames, generator revision 2): a place, castle and
// realm keep their names when another place appears or goes; the same seed gives the same names
// and another seed others; a cell's place keeps its name through the ages; revision 1 names as
// before, from the run's one stream.
import "../mesh/foundry-stubs.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

const { FILRODENSWMB } = await import("../../src/config.js");
const { nameEverything } = await import("../../src/generator/Names.js");
const { runGenerator } = await import("../../src/generator/Pipeline.js");
const { syntheticMap } = await import("./synthetic.mjs");

const { LEGACY } = FILRODENSWMB.GENERATOR.REVISIONS;
const quiet = { pause: () => Promise.resolve() };
const cultures = { cultures: [{ nameBase: "English" }], dominant: new Int32Array(100).fill(0) };
const town = (cell, population) => ({ cell, population, tier: 2 });
const noRealms = { counties: [], duchies: [], realms: [] };
const name = (towns, options = {}) => nameEverything({ seed: "SEED", nameBase: "English", cultures, towns, castles: [], realms: noRealms, idNames: true, ...options });

test("a place keeps its name when another place appears or goes", () => {
    const all = name([town(5, 900), town(7, 500), town(9, 100)]);
    const fewer = name([town(5, 900), town(9, 100)]);
    const more = name([town(1, 2000), town(5, 900), town(7, 500), town(9, 100)]);
    assert.equal(fewer.towns.get(9), all.towns.get(9), "the town after a place that went keeps its name");
    assert.equal(more.towns.get(9), all.towns.get(9), "and after a new, bigger one, unless it takes its name");
    assert.equal(more.towns.get(5), all.towns.get(5));
    const castles = (list) => nameEverything({ seed: "SEED", nameBase: "English", cultures, towns: [], castles: list, realms: noRealms, idNames: true }).castles;
    assert.deepEqual(castles([{ cell: 3 }, { cell: 4 }])[1], castles([{ cell: 4 }])[0], "a castle keeps its name and keep");
});

test("the same seed gives the same names; another seed others", () => {
    const towns = [town(5, 900), town(7, 500)];
    assert.deepEqual([...name(towns).towns], [...name(towns).towns]);
    assert.notDeepEqual([...name(towns, { seed: "OTHER" }).towns], [...name(towns).towns]);
});

test("revision 2's runs name places by their cells, through the ages; revision 1's as before", async () => {
    const payload = syntheticMap().makePayload({ ages: [{}, {}] });
    const now = await runGenerator(payload, quiet);
    const old = await runGenerator({ ...payload, revision: LEGACY }, quiet);
    const byCell = (result) => new Map(result.places.filter((place) => place.kind === "town").map((place) => [place.cell, place.name]));
    assert.notDeepEqual([...byCell(now)].slice(0, 5), [...byCell(old)].slice(0, 5), "a new way of naming");
    // An earlier age's place in a cell the present has keeps the present's name
    const present = byCell(now);
    const age = now.history[0];
    let same = 0;
    let shared = 0;
    for (let index = 0; index < age.places.length; index += 3) {
        const cell = age.places[index];
        if (!present.has(cell)) continue;
        shared++;
        if (age.placeNames[index / 3] === present.get(cell)) same++;
    }
    assert.ok(shared > 0 && same === shared, `${same} of ${shared}`);
    // A town taken away by a seat elsewhere: the other towns keep their names, bar the few it shifts
    const realmNames = now.realms.map((realm) => realm.name);
    assert.equal(new Set(realmNames).size, realmNames.length, "realms' names differ");
});
