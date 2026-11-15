// A culture's climate from its chosen biomes or from zones set by hand (CultureClimate): an older
// culture's single bands give exactly the run they always did, and so does the same climate as one
// zone; chosen biomes become zones worked out from the map at the run, so a culture choosing a
// biome settles where it shows; several zones fit each of them and not the climates between; an
// unknown biome is dropped quietly; and a realm's ruling culture is its capital's people.
import "../mesh/foundry-stubs.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { FILRODENSWMB } from "../../src/config.js";
import { biomeZones, climateOf, landBiomeIds, zoneCoverage, zoneFromBands } from "../../src/generator/CultureClimate.js";
import { engineCultures, engineZones } from "../../src/generator/CultureInput.js";
import { habitatFit } from "../../src/generator/Cultures.js";
import { modelBiomeRaster } from "../../src/generator/ModelBiomes.js";
import { runGenerator } from "../../src/generator/Pipeline.js";
import { syntheticMap, WIDTH } from "./synthetic.mjs";

const { BIOME_IDS } = FILRODENSWMB;
const { CLIMATES, FIT_FLOOR } = FILRODENSWMB.GENERATOR.CULTURES;
const quick = { pause: () => Promise.resolve() };

/** A culture of the island, with its homeland left to the run. */
const culture = (id, habitat = {}) => ({ id, name: id, color: "#808080", nameBase: "Human Generic", openness: 0.3, density: 1, habitat: { coast: 0, river: 0, ...habitat }, homelands: [] });

/** The biome each of the island's pixels shows. */
function islandShown() {
    const payload = syntheticMap().makePayload();
    const shown = new Uint8Array(payload.elevation.length);
    modelBiomeRaster(payload, shown);
    return { payload, shown };
}

test("a culture saved before the climate choice reads its bands as one zone; a new choice names its climate", () => {
    const old = climateOf({ temperature: [0.2, 0.5], moisture: null, height: [0.5, 0.8] });
    assert.equal(old.legacy, true);
    assert.equal(old.mode, CLIMATES.ZONES);
    assert.deepEqual(old.zones, [{ elevation: [[0.5, 0.8, false, false]], moisture: [[0, 1, true, true]], temperature: [[0.2, 0.5, false, false]] }]);
    assert.deepEqual(climateOf({ climate: "biomes", biomes: [7, "x", 8] }), { mode: CLIMATES.BIOMES, biomes: [7, 8], zones: [], legacy: false });
    assert.equal(climateOf({ climate: "zones", zones: [{ elevation: [] }] }).zones.length, 0, "a row without its three axes is dropped");
    const ids = landBiomeIds([{ id: 40, placement: "land" }, { id: 41, placement: "underwater" }, { id: 42, placement: "landOverwater" }]);
    assert.ok(ids.includes(BIOME_IDS.TAIGA) && ids.includes(40) && ids.includes(42));
    assert.ok(!ids.includes(41) && !ids.includes(BIOME_IDS.DEEP_OCEAN) && !ids.includes(BIOME_IDS.PACK_ICE), "only biomes that show on dry land");
});

test("zones become the engine's bands: heights in metres above the sea, a whole track no limit, none for no zones", () => {
    const zones = engineZones([{ elevation: [[0.5, 1, false, true]], moisture: [[0, 1, true, true]], temperature: [[0.1, 0.3, false, false], [0.7, 0.9, false, false]] }], 0.4, 10000);
    assert.equal(Math.round(zones[0].heightM[0][0]), 1000);
    assert.equal(zones[0].heightM[0][1], Infinity);
    assert.equal(zones[0].moisture, null);
    assert.deepEqual(zones[0].temperature, [[0.1, 0.3], [0.7, 0.9]]);
    assert.equal(engineZones([], 0.4, 10000), null);
    const PAYLOAD = { width: 1, height: 1, modelOf: Int32Array.from([0]), seaLevel: 0.4, metresPerUnit: 10000 };
    const [old] = engineCultures([culture("old", { temperature: [0, 0.5], height: [0.5, 1] })], PAYLOAD);
    assert.deepEqual(old.habitat.temperature, [-Infinity, 0.5], "an older culture keeps its single bands");
    assert.equal(old.habitat.zones, undefined);
    const [none] = engineCultures([culture("none", { climate: "biomes", biomes: [] })], PAYLOAD);
    assert.equal(none.habitat.biomes, undefined, "no biome chosen: no climate limit");
    assert.equal(none.habitat.temperature, undefined);
});

test("snow and rainforest as two zones fit both and not the climates between", () => {
    const cells = { temperature: [0.05, 0.9, 0.5], moisture: [0.3, 0.9, 0.6], heightM: [100, 100, 100], reliefM: [0, 0, 0], coastal: [0, 0, 0], riverKm: [0, 0, 0] };
    const snow = { elevation: [[0, 1, true, true]], moisture: [[0.2, 0.4, false, false]], temperature: [[0, 0.1, true, false]] };
    const jungle = { elevation: [[0, 1, true, true]], moisture: [[0.8, 1, false, true]], temperature: [[0.8, 1, false, true]] };
    const zoned = { habitat: { zones: engineZones([snow, jungle], 0.3, 10000) } };
    assert.equal(habitatFit(zoned, cells, 0), 1, "snow");
    assert.equal(habitatFit(zoned, cells, 1), 1, "rainforest");
    assert.equal(habitatFit(zoned, cells, 2), FIT_FLOOR, "the temperate land between fits neither");
    // One band per measure spanning both would fit the land between as well
    const spanning = { habitat: { temperature: [0, 1], moisture: [0.2, 1] } };
    assert.equal(habitatFit(spanning, cells, 2), 1);
});

test("an older culture's bands and the same climate as one zone give exactly the run they always did", async () => {
    const { makePayload } = syntheticMap();
    const bands = { temperature: [0.45, 0.6], moisture: [0.4, 0.7], height: [0.4, 0.6], relief: null };
    const old = await runGenerator(makePayload({ cultures: [culture("hill", bands), culture("vale")] }), quick);
    const zoned = await runGenerator(makePayload({ cultures: [culture("hill", { climate: "zones", zones: [zoneFromBands(bands)], relief: null }), culture("vale", { climate: "biomes", biomes: [] })] }), quick);
    for (const key of Object.keys(old.modelCells)) assert.deepEqual(zoned.modelCells[key], old.modelCells[key], key);
    assert.deepEqual(zoned.places, old.places);
    assert.deepEqual(zoned.realms, old.realms);
});

test("each chosen biome is a zone: the middle of its climate on the map as it is", () => {
    const { payload, shown } = islandShown();
    const [forest] = biomeZones([BIOME_IDS.DECIDUOUS_FOREST, BIOME_IDS.SNOW], { shown, elevation: payload.elevation, moisture: payload.moisture, temperature: payload.temperature });
    assert.equal(biomeZones([BIOME_IDS.SNOW], { shown, elevation: payload.elevation, moisture: payload.moisture, temperature: payload.temperature }).length, 0, "a biome the map does not show has no zone");
    // The island's forest is its wet west: moisture 0.65 falling east by 0.35 over the map
    const [lo, hi] = forest.moisture[0];
    assert.ok(lo > 0.55 && hi <= 0.66, `moisture ${lo} to ${hi}`);
    const map = { elevation: payload.elevation, moisture: payload.moisture, temperature: payload.temperature, seaLevel: payload.seaLevel, isLand: (pixel) => shown[pixel] > 0 };
    assert.ok(zoneCoverage([forest], map) < 0.3, "the forest's climate takes in little of the island");
    assert.ok(zoneCoverage([zoneFromBands({})], map) > 0.99, "no limit takes in all of it");
    assert.equal(zoneCoverage([], map), 0);
});

test("a culture choosing a biome settles where it shows; an unknown biome is dropped quietly", async () => {
    const { makePayload, mesh } = syntheticMap();
    const plain = await runGenerator(makePayload({ cultures: [culture("wood", { climate: "biomes", biomes: [] }), culture("plain", { climate: "biomes", biomes: [] })] }), quick);
    const chosen = await runGenerator(makePayload({ cultures: [culture("wood", { climate: "biomes", biomes: [BIOME_IDS.DECIDUOUS_FOREST] }), culture("plain", { climate: "biomes", biomes: [] })] }), quick);
    const unknown = await runGenerator(makePayload({ cultures: [culture("wood", { climate: "biomes", biomes: [250] }), culture("plain", { climate: "biomes", biomes: [] })] }), quick);
    const westOf = (result) => {
        const cells = [];
        result.modelCells.culture.forEach((holder, cell) => {
            if (holder === 0) cells.push(mesh.siteX(cell));
        });
        return cells.reduce((sum, x) => sum + x, 0) / cells.length;
    };
    assert.ok(westOf(chosen) < westOf(plain) - WIDTH * 0.05, `the forest people's land lies further west (${Math.round(westOf(chosen))} against ${Math.round(westOf(plain))})`);
    for (const key of Object.keys(plain.modelCells)) assert.deepEqual(unknown.modelCells[key], plain.modelCells[key], key);
    assert.deepEqual(unknown.places, plain.places);
});

test("a realm's ruling culture is its capital's people", async () => {
    const { makePayload } = syntheticMap();
    const result = await runGenerator(makePayload({ cultures: [culture("west"), culture("east")] }), quick);
    for (const realm of result.realms) {
        const capital = result.places.find((place) => place.kind === "town" && place.cell === realm.seat);
        assert.equal(realm.rulingCulture, capital ? capital.culture : result.modelCells.culture[realm.seat]);
        assert.ok(realm.rulingCulture === 0 || realm.rulingCulture === 1);
    }
});
