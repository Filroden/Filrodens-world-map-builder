// Influences painted on the map in the generator (see InfluenceLevels, CellValues and Feedback), on
// the synthetic island: none (absent, or every value 0) gives exactly the run without them; food
// capacity changes the land's food only in the cells painted, and more or fewer people live there,
// in every age; security makes painted land safer or more dangerous, a dangerous value even where
// nothing else threatens; and a damaged payload is no influence.
import "../mesh/foundry-stubs.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildModelCells } from "../../src/generator/CellValues.js";
import { influenceLevels, levelFactors } from "../../src/generator/InfluenceLevels.js";
import { modelBiomeRaster } from "../../src/generator/ModelBiomes.js";
import { runGenerator } from "../../src/generator/Pipeline.js";
import { FILRODENSWMB } from "../../src/config.js";
import { HEIGHT, WIDTH, syntheticMap } from "./synthetic.mjs";

const quick = { pause: () => Promise.resolve() };
const MAX = FILRODENSWMB.GENERATOR.INFLUENCES.LEVELS;
/** The painted box: the west of the island, clear of the ridge and the river. */
const BOX = { x0: 110, y0: 110, x1: 190, y1: 250 };

/** Values per pixel: `level` inside the box, 0 elsewhere. */
function boxLevels(level) {
    const levels = new Int8Array(WIDTH * HEIGHT);
    for (let y = BOX.y0; y < BOX.y1; y++) for (let x = BOX.x0; x < BOX.x1; x++) levels[y * WIDTH + x] = level;
    return levels;
}

const payloadWith = (influences, settings = {}) => ({ ...syntheticMap().makePayload(settings), influences });
const run = (influences, settings) => runGenerator(payloadWith(influences, settings), quick);
const cellsOf = (payload) => buildModelCells({ ...payload, biome: modelBiomeRaster(payload) });

/** The model cells with any pixel in the box, and those with none. */
function boxCells() {
    const { modelOf } = syntheticMap().makePayload();
    const inside = new Set();
    for (let y = BOX.y0; y < BOX.y1; y++) for (let x = BOX.x0; x < BOX.x1; x++) inside.add(modelOf[y * WIDTH + x]);
    return inside;
}

/** A run's people, and its mean danger (1 - security), over the land of some model cells. */
function figures(result, cells) {
    const { population, security, water } = result.modelCells;
    let people = 0;
    let danger = 0;
    let land = 0;
    for (const cell of cells) {
        if (water[cell]) continue;
        people += population[cell];
        danger += 1 - security[cell];
        land++;
    }
    return { people, danger: danger / land };
}

let base = null;
const baseRun = async () => (base ??= await run(null));

test("a value's factor runs from 1 / MAX_FACTOR to MAX_FACTOR, and none is exactly 1", () => {
    const factors = levelFactors();
    const top = FILRODENSWMB.GENERATOR.INFLUENCES.MAX_FACTOR;
    assert.equal(factors.length, 2 * MAX + 1);
    assert.equal(factors[MAX], 1);
    assert.ok(Math.abs(factors[2 * MAX] - top) < 1e-12);
    assert.ok(Math.abs(factors[0] - 1 / top) < 1e-12);
    for (let index = 1; index < factors.length; index++) assert.ok(factors[index] > factors[index - 1], "rising with the value");
});

test("no influences, or every value 0, gives exactly the run without them", async () => {
    const without = await baseRun();
    const zero = await run({ capacity: new Int8Array(WIDTH * HEIGHT), security: new Int8Array(WIDTH * HEIGHT) });
    assert.deepEqual(zero.stats, without.stats);
    assert.deepEqual(Array.from(zero.modelCells.population), Array.from(without.modelCells.population));
    assert.deepEqual(Array.from(zero.modelCells.security), Array.from(without.modelCells.security));
    assert.deepEqual(zero.places.map((place) => [place.cell, place.tier, place.population]), without.places.map((place) => [place.cell, place.tier, place.population]));
});

test("a damaged payload is no influence: the wrong length, or not a typed array of values", () => {
    for (const bad of [new Int8Array(10), Array.from({ length: WIDTH * HEIGHT }, () => 2), new Float32Array(WIDTH * HEIGHT).fill(2), "3"]) {
        assert.equal(influenceLevels({ width: WIDTH, height: HEIGHT, influences: { capacity: bad } }, "capacity"), null);
    }
    // Values beyond the range are read as the largest
    const wild = boxLevels(127);
    const cells = cellsOf(payloadWith({ capacity: wild }));
    const top = cellsOf(payloadWith({ capacity: boxLevels(MAX) }));
    assert.deepEqual(Array.from(cells.food), Array.from(top.food));
});

test("food capacity changes the land's food in the cells painted, and nowhere else", () => {
    const plain = cellsOf(syntheticMap().makePayload());
    const half = Math.round(MAX / 2);
    const richer = cellsOf(payloadWith({ capacity: boxLevels(half) }));
    const inside = boxCells();
    let raised = 0;
    for (let cell = 0; cell < plain.count; cell++) {
        if (!inside.has(cell)) {
            assert.equal(richer.food[cell], plain.food[cell], `cell ${cell} outside the box keeps its food`);
            continue;
        }
        if (plain.food[cell] > 0) {
            assert.ok(richer.food[cell] > plain.food[cell], `cell ${cell} in the box feeds more`);
            assert.ok(richer.food[cell] <= plain.food[cell] * levelFactors()[MAX + half] * (1 + 1e-9), "never more than the value's factor");
            raised++;
        }
    }
    assert.ok(raised > 3);
});

test("more food capacity brings more people where it is painted, less brings fewer", async () => {
    const inside = boxCells();
    const without = figures(await baseRun(), inside).people;
    const richer = figures(await run({ capacity: boxLevels(MAX) }), inside).people;
    const poorer = figures(await run({ capacity: boxLevels(-MAX) }), inside).people;
    assert.ok(richer > without * 1.5, `richer ${Math.round(richer)} against ${Math.round(without)}`);
    assert.ok(poorer < without * 0.7, `poorer ${Math.round(poorer)} against ${Math.round(without)}`);
});

test("more dangerous painting raises the danger where it is painted, even in a quiet heartland, and safer painting lowers it", async () => {
    const inside = boxCells();
    // The island is one quiet realm: nothing threatens the box until it is painted
    const without = figures(await baseRun(), inside);
    const dangerous = await run({ security: boxLevels(-MAX) });
    const danger = figures(dangerous, inside);
    assert.ok(danger.danger > without.danger + 0.2, `more dangerous ${danger.danger} against ${without.danger}`);
    assert.ok(danger.people < without.people, "insecure land loses people");

    // The box's northern half made safer, beside the dangerous southern half that still threatens it
    const half = boxLevels(-MAX);
    const middle = Math.round((BOX.y0 + BOX.y1) / 2);
    for (let y = BOX.y0; y < middle; y++) for (let x = BOX.x0; x < BOX.x1; x++) half[y * WIDTH + x] = MAX;
    const north = new Set([...inside].filter((cell) => syntheticMap().mesh.siteY(cell) < middle - 10));
    const safer = figures(await run({ security: half }), north).danger;
    assert.ok(safer < figures(dangerous, north).danger, `the safer half ${safer} against ${figures(dangerous, north).danger}`);
});

test("influences apply in every age", async () => {
    const ages = { ages: [{ era: "earlyMedieval", strife: "peaceful" }, { era: "highMedieval", strife: "troubled" }] };
    const plain = await run(null, ages);
    const richer = await run({ capacity: boxLevels(MAX) }, ages);
    assert.equal(plain.ages.run, 2);
    const inBox = (cells) => cells.filter((cell) => boxCells().has(cell)).length;
    // The first age's places, kept in the run's history
    assert.ok(inBox(richer.history[0].places) > inBox(plain.history[0].places), "the first age has more places in the richer land");
});
