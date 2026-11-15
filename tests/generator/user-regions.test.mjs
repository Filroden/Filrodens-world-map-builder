// Realms built round the map's own realms, duchies and counties (UserRealms, from revision 2), on
// the synthetic island: no user regions gives the run without them, and revision 1 ignores them; a
// user realm holds exactly its land, no other realm is crowned inside it, and the run fills it with
// duchies of its own, crowned at a capital seat inside it; no generated county crosses a user
// county's border; a lone duchy or county ticked Independent is a state of its own and unticked
// joins a realm whole; and the ages before the present are not changed.
import "../mesh/foundry-stubs.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { FILRODENSWMB } from "../../src/config.js";
import { runGenerator } from "../../src/generator/Pipeline.js";
import { syntheticMap } from "./synthetic.mjs";

const { LEGACY } = FILRODENSWMB.GENERATOR.REVISIONS;
const quick = { pause: () => Promise.resolve() };
const run = (userRegions, extra = {}) => runGenerator({ ...syntheticMap().makePayload(extra.settings ?? {}), userRegions, seats: extra.seats ?? [], ...(extra.revision ? { revision: extra.revision } : {}) }, quick);

let base = null;
async function setup() {
    base ??= await run(null);
    return base;
}

/** The island's land model cells with their sites, for drawing regions by place. */
function landCells(result) {
    const { mesh } = syntheticMap();
    const list = [];
    for (let cell = 0; cell < result.cellCount; cell++) if (!result.modelCells.water[cell]) list.push({ cell, x: mesh.siteX(cell), y: mesh.siteY(cell) });
    return list;
}

const near = (result, x, y, radius) => landCells(result).filter((site) => Math.hypot(site.x - x, site.y - y) < radius).map((site) => site.cell);

/** The model cells a unit of the result holds, by its level's per-cell array. */
const holding = (array, index) => array.reduce((list, owner, cell) => (owner === index ? [...list, cell] : list), []);

test("with no user regions the run is the run without them, and revision 1 ignores them", async () => {
    const without = await setup();
    const empty = await run({ realms: [], duchies: [], counties: [] });
    assert.deepEqual({ ...empty, timings: null }, { ...without, timings: null });
    const west = near(without, 150, 180, 120);
    const legacy = await run({ realms: [{ key: 0, cells: west }] }, { revision: LEGACY });
    const legacyNone = await run(null, { revision: LEGACY });
    assert.deepEqual({ ...legacy, timings: null }, { ...legacyNone, timings: null }, "revision 1 builds no realm round them");
});

test("a user realm holds exactly its land, is filled with duchies of its own, and no other realm is crowned inside it", async () => {
    const without = await setup();
    // The west of the island, across the one kingdom's duchies
    const west = near(without, 150, 180, 120);
    const result = await run({ realms: [{ key: 7, cells: west }] });
    const realm = result.realms.findIndex((each) => each.user === 7);
    assert.ok(realm >= 0, "a realm stands for the user's");
    assert.deepEqual(holding(result.modelCells.realm, realm).sort((a, b) => a - b), [...west].sort((a, b) => a - b), "exactly its land");
    assert.ok(west.includes(result.realms[realm].seat), "crowned inside");
    result.realms.forEach((other, index) => index !== realm && assert.ok(!west.includes(other.seat), "no other crown inside"));
    const duchies = result.duchies.map((duchy, index) => ({ duchy, index })).filter(({ duchy }) => duchy.realm === realm);
    assert.ok(duchies.length > 0, "duchies inside");
    for (const { index } of duchies) assert.ok(holding(result.modelCells.duchy, index).every((cell) => west.includes(cell)), "its duchies lie inside it");
    for (let cell = 0; cell < result.cellCount; cell++) {
        if (result.modelCells.realm[cell] === realm) continue;
        assert.ok(!west.includes(cell) || result.modelCells.water[cell], "no other realm holds its land");
    }
});

test("a capital seat inside a user realm crowns it", async () => {
    const without = await setup();
    const west = near(without, 150, 180, 120);
    const town = without.places.find((place) => place.kind === "town" && place.tier === 2 && west.includes(place.cell));
    const result = await run({ realms: [{ key: 1, cells: west }] }, { seats: [{ cell: town.cell, kind: "capital", pin: "capital" }] });
    const realm = result.realms.find((each) => each.user === 1);
    assert.equal(realm.seat, town.cell);
    assert.deepEqual(result.seats.unhonoured, []);
});

test("no generated county crosses a user county's border, and the user county is one county", async () => {
    const without = await setup();
    const county = near(without, 300, 150, 40);
    const result = await run({ counties: [{ key: 3, cells: county }] });
    const index = result.counties.findIndex((each) => each.user === 3);
    assert.deepEqual(holding(result.modelCells.county, index).sort((a, b) => a - b), [...county].sort((a, b) => a - b));
    result.counties.forEach((other, at) => {
        if (at === index) return;
        assert.ok(holding(result.modelCells.county, at).every((cell) => !county.includes(cell)), `county ${at} stays outside`);
    });
});

test("a lone duchy ticked Independent is a state of its own; unticked it joins a realm whole", async () => {
    const without = await setup();
    const land = near(without, 330, 200, 55);
    const ticked = await run({ duchies: [{ key: 2, cells: land, independent: true }] });
    const own = ticked.duchies.findIndex((duchy) => duchy.user === 2);
    const state = ticked.realms[ticked.duchies[own].realm];
    assert.equal(state.kind, "independent");
    assert.deepEqual(state.duchies, [own], "a state of one duchy");
    assert.deepEqual(holding(ticked.modelCells.duchy, own).sort((a, b) => a - b), [...land].sort((a, b) => a - b));

    const unticked = await run({ duchies: [{ key: 2, cells: land }] });
    const duchy = unticked.duchies.findIndex((each) => each.user === 2);
    const realm = unticked.realms[unticked.duchies[duchy].realm];
    assert.equal(realm.kind, "kingdom", "the island's kingdom takes it");
    assert.ok(realm.duchies.length > 1);
    assert.deepEqual(holding(unticked.modelCells.duchy, duchy).sort((a, b) => a - b), [...land].sort((a, b) => a - b), "whole");
});

test("a lone county ticked Independent is a state of its own; unticked it joins a duchy whole", async () => {
    const without = await setup();
    const land = near(without, 300, 150, 40);
    const ticked = await run({ counties: [{ key: 4, cells: land, independent: true }] });
    const own = ticked.counties.findIndex((county) => county.user === 4);
    const duchy = ticked.counties[own].duchy;
    assert.deepEqual(ticked.duchies[duchy].counties, [own], "a duchy of its own");
    assert.equal(ticked.realms[ticked.duchies[duchy].realm].kind, "independent");

    const unticked = await run({ counties: [{ key: 4, cells: land }] });
    const county = unticked.counties.findIndex((each) => each.user === 4);
    const joined = unticked.duchies[unticked.counties[county].duchy];
    assert.ok(joined.counties.length > 1, "a duchy with other counties takes it");
    assert.equal(unticked.realms[joined.realm].kind, "kingdom");
    assert.deepEqual(holding(unticked.modelCells.county, county).sort((a, b) => a - b), [...land].sort((a, b) => a - b), "whole");
});

test("user regions hold in the present age only: the ages before are as without them", async () => {
    const settings = { ages: [{ era: "earlyMedieval" }, { era: "highMedieval" }] };
    const without = await run(null, { settings });
    const west = near(without, 150, 180, 120);
    const result = await run({ realms: [{ key: 0, cells: west }] }, { settings });
    assert.ok(result.history.length >= 1, "an age before");
    assert.deepEqual(result.history[0].realm, without.history[0].realm, "the age before's realms unchanged");
    assert.notDeepEqual(result.modelCells.realm, without.modelCells.realm, "the present's built round the realm");
});
