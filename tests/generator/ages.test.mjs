// Ages (Pipeline): a run grown through several ages, each starting from the one before: one age
// is the run of before; calm ages keep their towns, seats and roads; a plague and war-torn age loses
// towns; a culture arriving is absent before its age, and an invading one takes land; a stop keeps
// the ages finished; the earlier ages are kept, in brief, in the saved run and checked on import.
import "../mesh/foundry-stubs.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

const { runGenerator } = await import("../../src/generator/Pipeline.js");
const { decodeAge, encodeModelRun, unpackArray } = await import("../../src/generator/ModelRun.js");
const { RULES, clean, cleanContext } = await import("../../src/data/MapRules.js");
const { syntheticMap } = await import("./synthetic.mjs");

const quiet = { pause: () => Promise.resolve() };
const run = (settings, options = {}) => runGenerator(syntheticMap().makePayload(settings), { ...quiet, ...options });
const townCells = (result) => new Set(result.places.filter((place) => place.kind === "town").map((place) => place.cell));
const historyTowns = (age) => {
    const cells = [];
    for (let index = 0; index < age.places.length; index += 3) cells.push(age.places[index]);
    return cells;
};

let calm = null;
const twoCalmAges = async () => (calm ??= await run({ ages: [{}, {}] }));

test("one age is the run of before ages, with an empty history", async () => {
    const plain = await run({});
    const one = await run({ ages: [{ era: "highMedieval", strife: "troubled" }] });
    const { timings: _a, ...a } = plain;
    const { timings: _b, ...b } = one;
    assert.deepEqual(b, a);
    assert.deepEqual(plain.history, []);
    assert.deepEqual(plain.ages, { asked: 1, run: 1 });
});

test("calm ages carry their towns and realm seats on", async () => {
    const result = await twoCalmAges();
    assert.deepEqual(result.ages, { asked: 2, run: 2 });
    assert.equal(result.history.length, 1);
    const before = historyTowns(result.history[0]);
    const now = townCells(result);
    const kept = before.filter((cell) => now.has(cell)).length;
    assert.ok(kept / before.length > 0.9, `most towns carry on (${kept} of ${before.length})`);
    const seatsNow = new Set(result.realms.map((realm) => realm.seat));
    assert.ok(result.history[0].seats.some((seat) => seatsNow.has(seat)), "a realm seat carries on");
    assert.equal(unpackArray(encodeModelRun(result, "r").history[0].realm).length, result.cellCount);
});

test("earlier ages keep their names, cultures and roads", async () => {
    const result = await twoCalmAges();
    const age = result.history[0];
    assert.equal(age.placeNames.length, age.places.length / 3);
    assert.ok(age.placeNames.every((name) => name.length > 0), "every place is named");
    assert.equal(age.castleNames.length, age.castles.length);
    assert.equal(age.castleKeeps.length, age.castles.length);
    assert.equal(age.realmNames.length, age.seats.length);
    assert.ok(age.realmNames.every((name) => name.length > 0), "every realm is named");
    assert.equal(age.realmPeople.length, age.seats.length);
    assert.ok(age.realmPeople.every((people) => Number.isInteger(people) && people > 0), "every realm has people");
    const nowByCell = new Map(result.places.filter((place) => place.kind === "town").map((place) => [place.cell, place.name]));
    historyTowns(age).forEach((cell, index) => {
        if (nowByCell.has(cell)) assert.equal(age.placeNames[index], nowByCell.get(cell), "a town carrying on has its present name");
    });
    assert.equal(age.culture.length, result.cellCount);
    assert.ok(age.culture.some((culture) => culture === 0), "the default people hold land");
    assert.ok(age.roadFrom.length > 10 && age.roadFrom.length === age.roadTo.length, `roads kept (${age.roadFrom.length})`);
    assert.equal(age.cultureIds, undefined, "the age's own culture list is not kept");

    const saved = encodeModelRun(result, "r").history[0];
    const arrays = decodeAge(saved);
    assert.deepEqual(Array.from(arrays.culture), Array.from(age.culture));
    assert.deepEqual(Array.from(arrays.roadFrom), Array.from(age.roadFrom));
    assert.deepEqual(saved.placeNames, age.placeNames);
});

test("a plague and a war-torn age leaves fewer towns and fewer people", async () => {
    const calmResult = await twoCalmAges();
    const hard = await run({ ages: [{}, { era: "afterPlague", strife: "warTorn" }] });
    const lost = historyTowns(hard.history[0]).filter((cell) => !townCells(hard).has(cell));
    assert.ok(lost.length > 5, `towns lost (${lost.length})`);
    assert.ok(hard.stats.population < calmResult.stats.population * 0.85);
});

test("a culture arriving is absent from the ages before; one invading takes more land", async () => {
    const cultures = [{ id: "west", name: "West", homelands: [{ x: 120, y: 180 }] }, { id: "east", name: "East", homelands: [{ x: 380, y: 180 }] }];
    const share = (result, id) => {
        const index = result.cultures.findIndex((culture) => culture.id === id);
        let people = 0;
        let all = 0;
        for (const realm of result.realms) for (const [culture, part] of realm.cultures) {
            all += part * realm.population;
            if (culture === index) people += part * realm.population;
        }
        return people / all;
    };
    const late = await run({ cultures, ages: [{ event: { kind: "arrival", culture: "east" } }] });
    assert.ok(late.cultures.some((culture) => culture.id === "east"), "arriving in the first age is simply present");
    const arrival = await run({ cultures, ages: [{}, { event: { kind: "arrival", culture: "east" } }] }, {});
    const invasion = await run({ cultures, ages: [{}, { event: { kind: "invasion", culture: "east" } }] });
    assert.ok(share(invasion, "east") > share(arrival, "east"), "the invader holds more");
    const onlyLater = await run({ cultures, ages: [{}, { event: { kind: "arrival", culture: "east" } }] }, { isStopping: () => true });
    assert.deepEqual(onlyLater.cultures.map((culture) => culture.id), ["west"], "absent from the age before it arrives");
    // The age before the arrival counts its cells' cultures as the present does: West only
    const east = arrival.cultures.findIndex((culture) => culture.id === "east");
    const west = arrival.cultures.findIndex((culture) => culture.id === "west");
    const before = Array.from(arrival.history[0].culture);
    assert.ok(before.includes(west) && !before.includes(east), "the age before holds West and no East");
});

test("a run asked to stop ends with the ages finished; the saved history is checked on import", async () => {
    const stopped = await run({ ages: [{}, {}, {}] }, { isStopping: () => true });
    assert.deepEqual(stopped.ages, { asked: 3, run: 1 });
    const saved = JSON.parse(JSON.stringify(encodeModelRun(await twoCalmAges(), "runAAAAAAAAAAAAA")));
    const cleaned = clean(saved, RULES.modelRun, cleanContext(() => "x"));
    assert.deepEqual(cleaned.history, saved.history);
    assert.deepEqual(cleaned.ages, { asked: 2, run: 2 });
});
