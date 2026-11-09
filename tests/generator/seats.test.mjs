// Settlement pins as seats a run must build on (Pipeline.seatsOf, from revision 2), on the synthetic
// island: a seat of each kind honoured at its tier, a capital crowned, a fortified town walled, a
// castle placed, a port on a coast that can load ships made a port and one that cannot kept as a
// town and reported, a seat on water reported; a seat in a poor place given its tier's people by
// trade, the townspeople in all staying what trade supports; seats ignored at revision 1; and no
// seats giving the run without them.
import "../mesh/foundry-stubs.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { FILRODENSWMB } from "../../src/config.js";
import { buildModelCells } from "../../src/generator/CellValues.js";
import { GeneratorRevision } from "../../src/generator/GeneratorRevision.js";
import { modelBiomeRaster } from "../../src/generator/ModelBiomes.js";
import { runGenerator } from "../../src/generator/Pipeline.js";
import { syntheticMap } from "./synthetic.mjs";

const { LEGACY, REVISION_2 } = FILRODENSWMB.GENERATOR.REVISIONS;
const quick = { pause: () => Promise.resolve() };
const run = (seats, revision = REVISION_2) => runGenerator({ ...syntheticMap().makePayload(), seats, revision }, quick);
const townSum = (result) => result.places.filter((place) => place.kind === "town").reduce((sum, place) => sum + place.population, 0);

let base = null;
let cells = null;
async function setup() {
    if (base) return;
    base = await run([]);
    const payload = syntheticMap().makePayload();
    cells = buildModelCells({ ...payload, biome: modelBiomeRaster(payload) }, {}, GeneratorRevision.rules(REVISION_2));
    cells.wet = Uint8Array.from(cells.water, (water, cell) => (water || cells.waterShare[cell] >= FILRODENSWMB.GENERATOR.PORTS.WATER_SHARE ? 1 : 0));
}

/** Land cells with no place in the run without seats, at least `gap` model cells' sites from every place, best first by `score`. */
function emptyLand(score, gap = 2) {
    const taken = base.places.map((place) => place.cell);
    const spacing = syntheticMap().mesh.modelSpacing;
    const far = (cell) => taken.every((other) => Math.hypot(cells.x[cell] - cells.x[other], cells.y[cell] - cells.y[other]) >= gap * spacing);
    const list = [];
    for (let cell = 0; cell < cells.count; cell++) if (!cells.water[cell] && cells.landKm2[cell] > 0 && far(cell)) list.push(cell);
    return list.sort((a, b) => score(b) - score(a) || a - b);
}

test("with no seats the run is the run without them, and revision 1 ignores seats", async () => {
    await setup();
    const none = await runGenerator({ ...syntheticMap().makePayload(), seats: [] }, quick);
    assert.deepEqual({ ...none, timings: null }, { ...base, timings: null });
    assert.equal(base.seats, null);
    const [cell] = emptyLand((c) => cells.food[c]);
    const legacy = await run([{ cell, kind: "city", pin: "p" }], LEGACY);
    const legacyNone = await run([], LEGACY);
    assert.deepEqual(legacy.stats, legacyNone.stats, "revision 1 has no seats");
    assert.equal(legacy.seats, null);
});

test("a seat of each kind is honoured on empty land, and the place carries its pins", async () => {
    await setup();
    const [city, largeTown, town, fortified, castle] = emptyLand((c) => cells.food[c]);
    const coast = emptyLand((c) => (cells.coastal[c] && cells.wet[c] ? 1 : 0), 1).find((c) => cells.coastal[c] && cells.wet[c]);
    const seats = [
        { cell: city, kind: "city", pin: "city" },
        { cell: largeTown, kind: "largeTown", pin: "large" },
        { cell: town, kind: "town", pin: "town" },
        { cell: fortified, kind: "fortifiedTown", pin: "walled" },
        { cell: castle, kind: "castle", pin: "castle" },
        { cell: coast, kind: "port", pin: "port" },
    ];
    const result = await run(seats);
    const at = (cell, kind = "town") => result.places.find((place) => place.cell === cell && place.kind === kind);
    assert.ok(at(city).tier <= 0, "a city");
    assert.ok(at(largeTown).tier <= 1, "a large town or bigger");
    assert.ok(at(town), "a town");
    assert.equal(at(fortified).fortified, true, "walled");
    assert.ok(at(castle, "castle"), "a castle");
    assert.equal(at(coast).port, true, "a port");
    assert.deepEqual(at(city).seat, ["city"]);
    assert.deepEqual(at(castle, "castle").seat, ["castle"]);
    assert.equal(result.seats.used, seats.length);
    assert.deepEqual(result.seats.unhonoured, []);
});

test("a capital seat is a realm's seat", async () => {
    await setup();
    const town = base.places.find((place) => place.kind === "town" && !place.capital && place.tier === 0) ?? base.places.find((place) => place.kind === "town" && !place.capital);
    const result = await run([{ cell: town.cell, kind: "capital", pin: "capital" }]);
    const place = result.places.find((each) => each.cell === town.cell && each.kind === "town");
    assert.equal(place.capital, true);
    assert.ok(result.realms.some((realm) => realm.seat === town.cell));
    assert.deepEqual(result.seats.unhonoured, []);
});

test("a port that cannot load ships is kept as a town and reported, and a seat on water is reported", async () => {
    await setup();
    const [inland] = emptyLand((c) => (cells.coastal[c] ? -1 : cells.food[c]));
    const water = cells.water.findIndex((w) => w === 1);
    const result = await run([{ cell: inland, kind: "port", pin: "dry" }, { cell: water, kind: "town", pin: "wet" }]);
    const place = result.places.find((each) => each.cell === inland && each.kind === "town");
    assert.ok(place, "kept as a town");
    assert.equal(place.port, false);
    assert.deepEqual(result.seats.unhonoured.map(({ pin, reason }) => [pin, reason]).sort(), [["dry", "dry"], ["wet", "water"]]);
});

test("a city seat in a poor place lives by trade: it has its tier's people, and the townspeople in all stay what trade supports", async () => {
    await setup();
    const [poor] = emptyLand((c) => -cells.food[c]);
    const result = await run([{ cell: poor, kind: "city", pin: "poor" }]);
    const place = result.places.find((each) => each.cell === poor && each.kind === "town");
    const cityMin = FILRODENSWMB.GENERATOR.TOWNS.TIERS[0].minPop;
    assert.ok(place.population >= cityMin * 0.99, `${place.population} people`);
    assert.ok(Math.abs(townSum(result) / townSum(base) - 1) < 0.1, `townspeople ${townSum(result)} against ${townSum(base)}`);
});
