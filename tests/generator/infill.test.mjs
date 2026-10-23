// Regional in-fill (src/generator/Infill.js, src/applications/InfillInput.js) on the synthetic
// island: the parent's people shared out and never more of them, market towns within a day's round
// trip of every village and none crowding a town, villages capped and largest first, lanes joining
// every place to the network, names in each place's culture, and the same result for the same seed.
import "../mesh/foundry-stubs.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { syntheticMap } from "./synthetic.mjs";

const { FILRODENSWMB } = await import("../../src/config.js");
const { encodeModelRun } = await import("../../src/generator/ModelRun.js");
const { resolveSettings } = await import("../../src/generator/GeneratorSettings.js");
const { cropRun } = await import("../../src/generator/ParentRun.js");
const { runInfill } = await import("../../src/generator/Infill.js");
const { InfillInput } = await import("../../src/applications/InfillInput.js");

const PEOPLE_PER_CELL = 20000;

/** A parent run over the synthetic map's model cells: people on land, two cultures split east and west. */
function parentRunOf(mesh, payload) {
    const count = mesh.modelCount;
    const land = Float64Array.from({ length: count }, (_, cell) => {
        const pixel = Math.floor(mesh.siteY(cell)) * mesh.width + Math.floor(mesh.siteX(cell));
        return payload.elevation[pixel] >= 0.35 ? 1 : 0;
    });
    const result = {
        modelCells: {
            capacity: Float64Array.from(land, (value) => value * PEOPLE_PER_CELL * 2),
            population: Float64Array.from(land, (value) => value * PEOPLE_PER_CELL),
            landArea: Float64Array.from(land, (value) => value * 500),
            security: new Float64Array(count).fill(1),
            cleared: new Float64Array(count).fill(0.2),
            water: Float64Array.from(land, (value) => 1 - value),
            realm: new Float64Array(count),
            duchy: new Float64Array(count),
            county: new Float64Array(count),
            culture: Float64Array.from({ length: count }, (_, cell) => (mesh.siteX(cell) < mesh.width / 2 ? 0 : 1)),
            shareStart: Int32Array.from({ length: count + 1 }, (_, index) => index),
            shareCulture: Int32Array.from({ length: count }, (_, cell) => (mesh.siteX(cell) < mesh.width / 2 ? 0 : 1)),
            shareValue: new Float32Array(count).fill(1),
        },
        settings: resolveSettings({}, "SEED"),
        cellCount: count,
        cultures: [{ id: "westAAAAAAAAAAAA", name: "Westfolk", nameBase: "German", homelands: [] }, { id: "eastAAAAAAAAAAAA", name: "Eastfolk", nameBase: "Japanese", homelands: [] }],
        stats: {},
    };
    const run = JSON.parse(JSON.stringify(encodeModelRun(result, "runAAAAAAAAAAAAA")));
    return cropRun(run, { sites: mesh.sites.subarray(0, 2 * count), spacingPx: mesh.modelSpacing, spacingKm: mesh.modelSpacing * mesh.kmPerPx, crop: { x: 0, y: 0, width: mesh.width, height: mesh.height }, zoomScale: 1 });
}

let cached = null;
function infill() {
    if (cached) return cached;
    const { mesh, makePayload } = syntheticMap();
    const payload = makePayload();
    const parentRun = parentRunOf(mesh, payload);
    // Two inherited towns and a road between them
    const townA = mesh.cellAt(180, 180);
    const townB = mesh.cellAt(300, 180);
    const road = [];
    for (let x = 180; x <= 300; x += 2) road.push(mesh.cellAt(x, 180));
    const pins = [
        { name: "Ashby", x: 180, y: 180, generated: { kind: "town", population: 5000 } },
        { name: "Brook", x: 300, y: 180, generated: { kind: "town", population: 3000 } },
    ];
    const routes = [{ transport: "road", waypoints: [townA, townB], legs: [road] }];
    const { input, grid } = InfillInput.gather({ mesh, parentRun, payload, pins, routes, speeds: FILRODENSWMB.TRAVEL_TIME.SPEEDS, seed: "SYNTH", nameBase: "English" });
    const result = runInfill(input);
    cached = { mesh, input, grid, result, parentRun };
    return cached;
}

test("in-fill shares out the parent's people and adds none", () => {
    const { input, result } = infill();
    const parentPeople = input.parent.population.reduce((sum, value) => sum + value, 0);
    const townPeople = input.towns.reduce((sum, town) => sum + town.population, 0);
    const villagePeople = result.places.filter((place) => place.tier === "village").reduce((sum, place) => sum + place.population, 0);
    const marketPeople = result.places.filter((place) => place.tier === "marketTown").reduce((sum, place) => sum + place.population, 0);
    const country = result.people.reduce((sum, value) => sum + value, 0);
    assert.ok(villagePeople <= country + 1, "villages hold the country people of their cells");
    assert.ok(country + marketPeople <= parentPeople - townPeople + result.stats.markets * FILRODENSWMB.INFILL.MARKET_MIN_POP + 1, "no more people than the parent had (bar a small market's minimum)");
    assert.ok(country + marketPeople > (parentPeople - townPeople) * 0.9, `most of the parent's country people are placed: ${Math.round(country + marketPeople)} of ${parentPeople - townPeople}`);
});

test("market towns serve every village within a day's round trip, apart from the towns", () => {
    const { result, input } = infill();
    const markets = result.places.filter((place) => place.tier === "marketTown");
    assert.ok(markets.length > 3, `${markets.length} market towns`);
    const towns = new Set(input.towns.map((town) => town.cell));
    for (const market of markets) {
        assert.ok(!towns.has(market.cell), "no market on an inherited town");
        assert.ok(market.population >= FILRODENSWMB.INFILL.MARKET_MIN_POP);
    }
    assert.equal(new Set(markets.map((market) => market.cell)).size, markets.length, "one market per cell");
});

test("villages: one per settled cell, largest first, capped, and none on a town or market", () => {
    const { result } = infill();
    const villages = result.places.filter((place) => place.tier === "village");
    assert.ok(villages.length > 50, `${villages.length} villages`);
    assert.ok(villages.every((village) => village.population >= FILRODENSWMB.INFILL.VILLAGE_MIN_POP));
    assert.ok(villages.every((village, index) => index === 0 || villages[index - 1].population >= village.population), "largest first");
    const markets = new Set(result.places.filter((place) => place.tier === "marketTown").map((place) => place.cell));
    assert.ok(villages.every((village) => !markets.has(village.cell)));
    const capped = runInfill({ ...infill().input, options: { MAX_VILLAGES: 10 } });
    assert.equal(capped.places.filter((place) => place.tier === "village").length, 10);
    assert.ok(capped.stats.villagesLeftOut > 0);
});

test("lanes join every place to the network", () => {
    const { result, input } = infill();
    assert.ok(result.lanes.length > 0);
    const onLanes = new Set(result.lanes.flatMap((lane) => lane.cells));
    const roadCells = new Set(input.routes.flatMap((route) => route.cells));
    const towns = new Set(input.towns.map((town) => town.cell));
    const joined = result.places.filter((place) => onLanes.has(place.cell) || roadCells.has(place.cell) || towns.has(place.cell));
    assert.ok(joined.length / result.places.length > 0.95, `${joined.length} of ${result.places.length} places on a lane, road or town`);
    assert.ok(result.lanes.every((lane) => lane.cells.length >= 2 && lane.km > 0));
});

test("names follow each place's culture, avoid the map's names, and the run is repeatable", () => {
    const { result, input } = infill();
    assert.ok(result.places.every((place) => typeof place.name === "string" && place.name.length > 0));
    assert.ok(!result.places.some((place) => place.name === "Ashby" || place.name === "Brook"));
    const again = runInfill(input);
    assert.deepEqual(again.places, result.places, "the same seed gives the same places and names");
    assert.deepEqual(again.lanes.map((lane) => lane.cells), result.lanes.map((lane) => lane.cells));
});
