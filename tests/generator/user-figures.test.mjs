// Entered populations on settlement pins (UC phase 1; see UserFigures, Pipeline.seatsOf, Trade), on
// the synthetic island: a seat with no entered figure is as it was; a town is held to its entered
// figure, above or below what the run would make, the people it lacks drawn from the round's
// townspeople and the people it has too many given to other towns or left in the countryside; a
// figure the round's townspeople cannot reach is reported short; a pin with a town's figure but no
// settlement style is a seat of its own, tiered by its people; and the ages before the present are
// not changed.
import "../mesh/foundry-stubs.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildGeneratorPayload } from "../../src/studios/world/generator/GeneratorInput.js";
import { encodeModelRun } from "../../src/studios/world/generator/ModelRun.js";
import { runGenerator } from "../../src/studios/world/generator/Pipeline.js";
import { syntheticMap } from "./synthetic.mjs";

const quick = { pause: () => Promise.resolve() };
const run = (seats, settings = {}) => runGenerator({ ...syntheticMap().makePayload(settings), seats }, quick);

let base = null;
async function setup() {
    base ??= await run([]);
    return base;
}

const towns = (result) => result.places.filter((place) => place.kind === "town");
const townAt = (result, cell) => towns(result).find((town) => town.cell === cell);
const townspeople = (result) => towns(result).reduce((sum, town) => sum + town.population, 0);
/** The base run's towns, largest first. */
const ranked = (result) => towns(result).sort((a, b) => b.population - a.population || a.cell - b.cell);

test("a payload carries an entered population only where a seat has one", () => {
    const { mesh, buffers, rivers } = syntheticMap();
    const payload = buildGeneratorPayload({ mesh, buffers, seaLevel: 0.35, kmPerPx: 2, riverData: rivers, mapSeed: "SYNTH", seats: [{ cell: 1, kind: "town", pin: "a" }, { cell: 2, kind: "town", pin: "b", target: 5000 }] });
    assert.ok(!("target" in payload.seats[0]), "none on a seat without one, so a map without entered figures sends what it always did");
    assert.equal(payload.seats[1].target, 5000);
});

test("a seat with no entered figure builds as it did, and reports nothing new", async () => {
    const result = await setup();
    const town = ranked(result)[3];
    const plain = await run([{ cell: town.cell, kind: "town", pin: "t" }]);
    assert.deepEqual(Object.keys(plain.seats).sort(), ["unhonoured", "used"], "no short or givenUp without entered figures");
});

test("a town is brought up to its entered population, the people drawn from the other towns", async () => {
    const result = await setup();
    const town = ranked(result)[3];
    const target = town.population * 3;
    const entered = await run([{ cell: town.cell, kind: "town", pin: "up", target }]);
    assert.equal(townAt(entered, town.cell).population, target, "it reaches its figure");
    assert.equal(entered.seats.short, undefined, "and is not reported short");
    const others = (r) => townspeople(r) - townAt(r, town.cell).population;
    assert.ok(others(entered) < others(result), "the other towns have fewer townspeople between them");
});

test("a town above its entered population gives the rest to other towns or the countryside, and says where", async () => {
    const result = await setup();
    const city = ranked(result)[0];
    const target = Math.round(city.population / 3);
    const entered = await run([{ cell: city.cell, kind: "city", pin: "down", target }]);
    assert.equal(townAt(entered, city.cell).population, target, "held to its figure");
    const [given] = entered.seats.givenUp;
    assert.equal(given.pin, "down");
    assert.ok(given.toTowns > 0, "some went to other towns");
    assert.ok(given.toTowns + given.toCountry > 0);
    assert.equal(townAt(entered, city.cell).tier, 0, "the style's tier stands: a city of fewer people is still a city");
    assert.deepEqual(encodeModelRun(entered, "r").seats.givenUp, entered.seats.givenUp, "the map keeps it with the run, for Results");
});

test("a figure the round's townspeople cannot reach is reported short, with what the land and trade supported", async () => {
    const result = await setup();
    const town = ranked(result).at(-1);
    const target = 2_000_000;
    const entered = await run([{ cell: town.cell, kind: "town", pin: "huge", target }]);
    const [short] = entered.seats.short;
    assert.equal(short.pin, "huge");
    assert.equal(short.entered, target);
    assert.equal(short.made, townAt(entered, town.cell).population);
    assert.ok(short.made < target && short.made > town.population, "it took every townsperson trade could spare, short of the figure");
    assert.deepEqual(encodeModelRun(entered, "r").seats.short, entered.seats.short, "the map keeps it with the run, for Results");
});

test("a pin with a town's entered population but no settlement style is a seat, tiered by its people", async () => {
    const result = await setup();
    const used = new Set(result.places.map((place) => place.cell));
    const cell = [...Array(result.cellCount).keys()].find((c) => !result.modelCells.water[c] && !used.has(c) && result.modelCells.population[c] > 0);
    const entered = await run([{ cell, kind: "entered", pin: "new", target: 6000 }]);
    const town = townAt(entered, cell);
    assert.ok(town, "a town stands on it");
    assert.equal(town.population, 6000);
    assert.equal(town.tier, 1, "6,000 people make a large town");
    assert.deepEqual(town.seat, ["new"]);
    const none = await run([{ cell, kind: "entered", pin: "new" }]);
    assert.equal(townAt(none, cell), undefined, "with no figure it is no seat");
});

test("entered populations hold in the present age only", async () => {
    const ages = [{}, {}];
    const before = await run([], { ages });
    const town = ranked(before)[3];
    const entered = await run([{ cell: town.cell, kind: "town", pin: "up", target: town.population * 3 }], { ages });
    assert.equal(townAt(entered, town.cell).population, town.population * 3);
    const plainSeat = await run([{ cell: town.cell, kind: "town", pin: "up" }], { ages });
    assert.deepEqual(entered.history[0], plainSeat.history[0], "the age before is the same as with the seat and no figure");
});
