// The map's cultures in the engine's form (CultureInput): bands to the engine's units (heights in
// metres above the sea, open ends at a track's ends, a full track no limit), homelands from map
// points to model cells, and a run's cultures named by the map culture's id; and a run with no
// cultures is unchanged by them: a map culture set as the default gives the same output.
import "../mesh/foundry-stubs.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

const { FILRODENSWMB } = await import("../../src/config.js");
const { engineCultures } = await import("../../src/generator/CultureInput.js");
const { cultureId, cultureMix } = await import("../../src/generator/CultureIds.js");
const { runGenerator } = await import("../../src/generator/Pipeline.js");
const { syntheticMap } = await import("./synthetic.mjs");

const PAYLOAD = { width: 4, height: 2, modelOf: Int32Array.from([0, 0, 1, 1, 2, 2, 3, 3]), seaLevel: 0.4, metresPerUnit: 10000 };

test("bands become the engine's: open at a track's ends, heights in metres above the sea, none for a full track", () => {
    const [culture] = engineCultures([{ id: "elves", name: "Elves", habitat: { temperature: [0, 0.5], moisture: [0, 1], height: [0.5, 1], relief: [0.05, 0.1], coast: 2, river: -0.5 } }], PAYLOAD);
    assert.deepEqual(culture.habitat.temperature, [-Infinity, 0.5]);
    assert.equal(culture.habitat.moisture, null, "the whole track: no limit");
    assert.equal(Math.round(culture.habitat.heightM[0]), 1000);
    assert.equal(culture.habitat.heightM[1], Infinity, "reaching the top fits every summit");
    assert.deepEqual(culture.habitat.reliefM.map(Math.round), [500, 1000]);
    assert.equal(culture.habitat.coast, 1, "kept within -1 to 1");
    assert.equal(culture.habitat.river, -0.5);
    assert.equal(culture.openness, FILRODENSWMB.GENERATOR.CULTURES.FIELDS.openness.default);
    assert.equal(culture.nameBase, FILRODENSWMB.GENERATOR.CULTURES.DEFAULT.nameBase);
    const [swapped] = engineCultures([{ habitat: { temperature: [0.8, 0.2], height: "high" } }], PAYLOAD);
    assert.deepEqual(swapped.habitat.temperature, [0.2, 0.8]);
    assert.equal(swapped.habitat.heightM, null);
});

test("homelands are the model cells under their points; points off the map are skipped", () => {
    const [culture] = engineCultures([{ homelands: [{ x: 2.6, y: 0.2 }, { x: 1, y: 1 }, { x: 9, y: 0 }, { x: "a", y: 0 }] }], PAYLOAD);
    assert.deepEqual(culture.homelandCells, [1, 2]);
    assert.equal(culture.homelandsGiven, 4);
});

test("a run names its cultures by the map's ids; the default culture has none", () => {
    const result = { cultures: [{ id: "elves" }, { id: "dwarves" }] };
    assert.equal(cultureId(result, 1), "dwarves");
    assert.equal(cultureId(result, null), null);
    assert.deepEqual(cultureMix(result, [[1, 0.7], [0, 0.3]]), { mix: [{ culture: "dwarves", share: 0.7 }, { culture: "elves", share: 0.3 }] });
    assert.deepEqual(cultureMix({ cultures: [{ id: null }] }, [[0, 1]]), {}, "no cultures: no mix");
});

test("a map culture set as the default gives the same run as no cultures, with its id on the result", async () => {
    const { makePayload } = syntheticMap();
    const quiet = { pause: () => Promise.resolve() };
    const plain = await runGenerator(makePayload(), quiet);
    const defaultCulture = { id: "people", name: "People", color: "#8a8a8a", nameBase: "Human Generic", openness: 0.5, density: 1, habitat: { temperature: null, moisture: null, height: null, relief: null, coast: 0, river: 0 }, homelands: [] };
    const named = await runGenerator(makePayload({ cultures: [defaultCulture] }), quiet);
    for (const key of Object.keys(plain.modelCells)) assert.deepEqual(named.modelCells[key], plain.modelCells[key], key);
    assert.deepEqual(named.places, plain.places);
    assert.deepEqual(named.realms.map((realm) => realm.name), plain.realms.map((realm) => realm.name));
    assert.equal(plain.cultures[0].id, null);
    assert.equal(named.cultures[0].id, "people");
    assert.equal(named.cultures[0].homelands.length, 1, "Auto placed one homeland");
});

test("a run reports each culture's homelands: placed for it or given, and how many points were left out; duchies and counties name their largest culture", async () => {
    const { makePayload, mesh } = syntheticMap();
    const quiet = { pause: () => Promise.resolve() };
    // One point in the sea (the island's corner) and one off the map: both left out, so one is placed
    const sea = { id: "sea", name: "Sea", homelands: [{ x: 2, y: 2 }, { x: -50, y: 10 }] };
    const land = { id: "land", name: "Land", homelands: [{ x: 240, y: 180 }, { x: 2, y: 3 }] };
    const result = await runGenerator(makePayload({ cultures: [sea, land] }), quiet);
    const [first, second] = result.cultures;
    assert.equal(first.homelandsAuto, true);
    assert.equal(first.homelandsLeftOut, 2);
    assert.equal(second.homelandsAuto, false);
    assert.equal(second.homelandsLeftOut, 1);
    assert.equal(second.homelands.length, 1);
    assert.ok(mesh.cellCount > second.homelands[0]);
    assert.ok(result.duchies.every((duchy) => duchy.culture === 0 || duchy.culture === 1));
    assert.ok(result.counties.every((county) => county.culture === 0 || county.culture === 1));
});
