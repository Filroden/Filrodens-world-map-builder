// Cultures on the map's own regions (UC phase 2; see RegionCultures, Cultures.regionCultures), on
// the synthetic island with four cultures and a drawn realm in the north-east: a region with no
// cultures (or only deleted ones) changes nothing; a culture given a region is seeded there and
// holds most of it without swamping the land round it; one that fits the land badly can end a
// ruling minority, which is reported; given shares are held exactly, an Unassigned rest left to the
// spread; the first culture rules a realm and an independent county; and the ages before the
// present are not changed.
import "../mesh/foundry-stubs.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeModelRun } from "../../src/studios/world/generator/ModelRun.js";
import { runGenerator } from "../../src/studios/world/generator/Pipeline.js";
import { cleanCultures } from "../../src/studios/world/generator/RegionCultures.js";
import { syntheticMap } from "./synthetic.mjs";

const quick = { pause: () => Promise.resolve() };
const CULTURES = [
    { id: "hill", name: "Hillfolk", color: "#a0522d", openness: 0.2, homelands: [{ x: 215, y: 175 }] },
    { id: "west", name: "Westmen", color: "#3b6fb6", openness: 0.6, homelands: [{ x: 90, y: 160 }] },
    { id: "south", name: "Southrons", color: "#d9a520", openness: 0.8, homelands: [{ x: 300, y: 300 }] },
    { id: "sand", name: "Sandfolk", color: "#2e9e6b", openness: 0.5, habitat: { temperature: [0.68, 1] }, homelands: [{ x: 390, y: 290 }] },
];
const INDEX = Object.fromEntries(CULTURES.map((culture, index) => [culture.id, index]));
const run = (userRegions, settings = {}) => runGenerator({ ...syntheticMap().makePayload({ cultures: CULTURES, ...settings }), userRegions, seats: [] }, quick);

let base = null;
let realmLand = null;
async function setup() {
    if (base) return base;
    const without = await run(null);
    const { mesh } = syntheticMap();
    realmLand = [];
    for (let cell = 0; cell < without.cellCount; cell++) if (!without.modelCells.water[cell] && Math.hypot(mesh.siteX(cell) - 330, mesh.siteY(cell) - 110) < 85) realmLand.push(cell);
    base = await run({ realms: [{ key: 7, cells: realmLand }] });
    return base;
}

const realm = (cultures) => ({ realms: [{ key: 7, cells: realmLand, ...(cultures ? { cultures } : {}) }] });

/** Each culture's share of the people of the cells given (or of all land but them, with `outside`). */
function peopleShares(result, cells, { outside = false } = {}) {
    const m = result.modelCells;
    const inside = new Set(cells);
    const totals = CULTURES.map(() => 0);
    for (let cell = 0; cell < result.cellCount; cell++) {
        if (m.water[cell] || inside.has(cell) === outside) continue;
        for (let entry = m.shareStart[cell]; entry < m.shareStart[cell + 1]; entry++) totals[m.shareCulture[entry]] += m.shareValue[entry] * m.population[cell];
    }
    const sum = totals.reduce((a, b) => a + b, 0) || 1;
    return totals.map((value) => value / sum);
}

const cellShares = (result, cell) => {
    const m = result.modelCells;
    const shares = new Map();
    for (let entry = m.shareStart[cell]; entry < m.shareStart[cell + 1]; entry++) shares.set(m.shareCulture[entry], m.shareValue[entry]);
    return shares;
};
const userRealm = (result) => result.realms.find((each) => each.user === 7);

test("a region with no cultures, or only cultures the world no longer has, changes nothing", async () => {
    const without = await setup();
    const empty = await run(realm([]));
    assert.deepEqual({ ...empty, timings: null }, { ...without, timings: null });
    const deleted = await run(realm([{ culture: "gone", share: null }]));
    assert.deepEqual({ ...deleted, timings: null }, { ...without, timings: null }, "a deleted culture is ignored");
    assert.ok(!("regionCultures" in without), "and nothing is reported");
});

test("a culture given a region is seeded there: it holds most of it, rules it, and the land round it barely changes", async () => {
    const without = await setup();
    const result = await run(realm([{ culture: "south", share: null }]));
    const before = peopleShares(without, realmLand);
    const inside = peopleShares(result, realmLand);
    assert.ok(inside[INDEX.south] > 0.8, `Southrons hold most of the realm (${inside[INDEX.south].toFixed(2)})`);
    assert.ok(inside[INDEX.south] > before[INDEX.south] + 0.3, "far more than before");
    const outBefore = peopleShares(without, realmLand, { outside: true });
    const outAfter = peopleShares(result, realmLand, { outside: true });
    for (const culture of CULTURES) assert.ok(Math.abs(outAfter[INDEX[culture.id]] - outBefore[INDEX[culture.id]]) < 0.1, `${culture.name} outside the realm within 10 points`);
    assert.equal(userRealm(result).rulingCulture, INDEX.south, "the first culture rules");
    assert.equal(result.cultures[INDEX.south].homelands.length, without.cultures[INDEX.south].homelands.length, "the seed is no reported homeland");
});

test("a culture that fits the region badly can end a minority: it still rules, and the run reports it", async () => {
    await setup();
    const result = await run(realm([{ culture: "sand", share: null }]));
    const inside = peopleShares(result, realmLand);
    assert.ok(inside[INDEX.sand] < 0.5, `Sandfolk a minority (${inside[INDEX.sand].toFixed(2)})`);
    assert.equal(userRealm(result).rulingCulture, INDEX.sand, "the first culture rules whatever the capital's people");
    assert.equal(result.regionCultures.minority.length, 1);
    const [row] = result.regionCultures.minority;
    assert.deepEqual({ level: row.level, key: row.key, culture: row.culture }, { level: "realm", key: 7, culture: "sand" });
    assert.ok(row.share < 0.5);
    assert.deepEqual(encodeModelRun(result, "r").regionCultures, result.regionCultures, "kept with the saved run");
});

test("given shares are held exactly in every cell of the region, and an Unassigned rest is left to the spread", async () => {
    await setup();
    const result = await run(realm([{ culture: "south", share: 60 }, { culture: "hill", share: 40 }]));
    for (const cell of realmLand) {
        const shares = cellShares(result, cell);
        assert.ok(Math.abs(shares.get(INDEX.south) - 0.6) < 0.01 && Math.abs(shares.get(INDEX.hill) - 0.4) < 0.01, `cell ${cell}: 60 / 40`);
        assert.equal(shares.size, 2, "no one else");
    }
    assert.equal(userRealm(result).rulingCulture, INDEX.south);

    const partial = await run(realm([{ culture: "west", share: 50 }]));
    let mixed = 0;
    for (const cell of realmLand) {
        const shares = cellShares(partial, cell);
        assert.ok(shares.get(INDEX.west) >= 0.5 - 0.01, `cell ${cell}: Westmen at least their half`);
        if (shares.size > 1) mixed++;
    }
    assert.ok(mixed > realmLand.length / 2, "the rest is the spread's, so other peoples share the cells");
});

test("the first culture of an independent county rules its state", async () => {
    const without = await setup();
    const { mesh } = syntheticMap();
    const land = [];
    for (let cell = 0; cell < without.cellCount; cell++) if (!without.modelCells.water[cell] && Math.hypot(mesh.siteX(cell) - 300, mesh.siteY(cell) - 150) < 40) land.push(cell);
    const result = await run({ counties: [{ key: 4, cells: land, independent: true, cultures: [{ culture: "west", share: null }, { culture: "hill", share: null }] }] });
    const county = result.counties.findIndex((each) => each.user === 4);
    const state = result.realms[result.duchies[result.counties[county].duchy].realm];
    assert.equal(state.kind, "independent");
    assert.equal(state.rulingCulture, INDEX.west);
});

test("region cultures hold in the present age only: the age before is as without them", async () => {
    await setup();
    const settings = { ages: [{ era: "earlyMedieval" }, { era: "highMedieval" }] };
    const without = await run(realm(null), settings);
    const result = await run(realm([{ culture: "south", share: 100 }]), settings);
    assert.ok(result.history.length >= 1, "an age before");
    assert.deepEqual(result.history[0], without.history[0], "the age before unchanged");
    assert.notDeepEqual(result.modelCells.shareCulture, without.modelCells.shareCulture, "the present's cultures changed");
});

test("a region's cultures are cleaned: each once, whole shares all given or none", () => {
    assert.deepEqual(cleanCultures([{ culture: "a", share: 60.4 }, { culture: "a", share: 10 }, { culture: "b", share: 30 }]), [{ culture: "a", share: 60 }, { culture: "b", share: 30 }]);
    assert.deepEqual(cleanCultures([{ culture: "a", share: 60 }, { culture: "b" }]), [{ culture: "a", share: null }, { culture: "b", share: null }]);
    assert.deepEqual(cleanCultures([{ culture: 3 }, null, "x"]), []);
});
