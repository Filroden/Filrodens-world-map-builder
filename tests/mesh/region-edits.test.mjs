// Region and level edits that change cells: deleting and merging regions, deleting levels and sets,
// nesting while painting, repairing nesting, and filling a child level inside its parents.
import assert from "node:assert/strict";
import { test } from "node:test";
import { UNCLAIMED, addRegion, createLayerSet, createLevel } from "../../src/mesh/Schema.js";
import {
    assignToParents,
    autoAssign,
    clearBelow,
    deleteLevel,
    deleteRegion,
    deleteSet,
    levelCounts,
    mergeRegion,
    nestingProblems,
    paintAllow,
    settleParentKey,
    unassignedCount,
} from "../../src/mesh/RegionEdits.js";
import { cellsInRect, smallSession } from "./helpers.mjs";

let ids = 0;
const nextId = () => `id${++ids}`;

/**
 * Realms (West over x 100-250, East over x 250-400; water lies left of x 100) above Counties
 * (Northwest in West's top half, Northeast in East's top half), constrained.
 */
async function nestedMap({ nestingMode = "constrained" } = {}) {
    const realms = createLevel({ name: "Realms" }, nextId);
    const west = addRegion(realms, { name: "West" }, nextId);
    const east = addRegion(realms, { name: "East" }, nextId);
    const counties = createLevel({ name: "Counties", parentLevelId: realms.id, nestingMode }, nextId);
    const northwest = addRegion(counties, { name: "Northwest", parentKey: west.key }, nextId);
    const northeast = addRegion(counties, { name: "Northeast", parentKey: east.key }, nextId);
    const set = createLayerSet({ name: "Political", levels: [realms, counties] }, nextId);
    const layerSets = [set];
    const session = await smallSession(layerSets);
    const mesh = session.mesh;
    session.layer(realms.id).paint(cellsInRect(mesh, 100, 0, 250, 300), west.key);
    session.layer(realms.id).paint(cellsInRect(mesh, 250, 0, 400, 300), east.key);
    session.layer(counties.id).paint(cellsInRect(mesh, 100, 0, 250, 150), northwest.key);
    session.layer(counties.id).paint(cellsInRect(mesh, 250, 0, 400, 150), northeast.key);
    return { session, layerSets, set, realms, counties, west, east, northwest, northeast, mesh };
}

const count = (owners, key) => owners.reduce((sum, owner) => sum + (owner === key ? 1 : 0), 0);

test("deleting a region unclaims its cells at its level only", async () => {
    const map = await nestedMap();
    const westCells = count(map.session.layer(map.realms.id).owners, map.west.key);
    const countiesBefore = map.session.layer(map.counties.id).owners.slice();
    const result = deleteRegion(map.session, map.realms.id, map.west.id);
    assert.equal(result.patch.cells.length, westCells);
    assert.ok(result.patch.after.every((owner) => owner === UNCLAIMED));
    assert.ok(!map.realms.regions.includes(map.west));
    assert.deepEqual(map.session.layer(map.counties.id).owners, countiesBefore, "child cells stay");
    assert.equal(deleteRegion(map.session, map.realms.id, "missing"), null);
});

test("merging moves the cells and the child regions' parent", async () => {
    const map = await nestedMap();
    const before = count(map.session.layer(map.realms.id).owners, map.east.key);
    const westCells = count(map.session.layer(map.realms.id).owners, map.west.key);
    mergeRegion(map.session, map.realms.id, map.west.id, map.east.id);
    assert.equal(count(map.session.layer(map.realms.id).owners, map.east.key), before + westCells);
    assert.equal(map.northwest.parentKey, map.east.key);
    assert.equal(mergeRegion(map.session, map.realms.id, map.east.id, map.east.id), null);
});

test("deleting a level hands its owners back encoded and re-parents its children", async () => {
    const map = await nestedMap();
    const third = createLevel({ name: "Baronies", parentLevelId: map.counties.id }, nextId);
    map.set.levels.push(third);
    map.session.setLayerSets(map.layerSets);
    const counts = levelCounts(map.session, map.layerSets, map.counties.id);
    assert.deepEqual(counts.regions, 2);
    assert.equal(counts.childLevels, 1);

    const array = map.session.layer(map.counties.id).owners.slice();
    const removed = deleteLevel(map.session, map.layerSets, map.counties.id);
    assert.equal(third.parentLevelId, map.realms.id);
    assert.ok(!map.session.layers.has(map.counties.id));
    map.session.restoreLevelOwners(map.counties.id, removed.owners);
    assert.deepEqual(map.session.layer(map.counties.id).owners, array, "the encoded array restores exactly");
});

test("deleting a set removes every level's owners", async () => {
    const map = await nestedMap();
    const removed = deleteSet(map.session, map.layerSets, map.set.id);
    assert.equal(removed.levels.length, 2);
    assert.equal(map.layerSets.length, 0);
    assert.equal(map.session.layers.size, 0);
});

test("a constrained child region is painted only inside its parent region", async () => {
    const map = await nestedMap();
    const fresh = addRegion(map.counties, { name: "South" }, nextId);
    const southWest = cellsInRect(map.mesh, 120, 200, 140, 220)[0];
    assert.deepEqual(settleParentKey(map.session, map.counties, fresh, southWest), { allowed: true, changed: true });
    assert.equal(fresh.parentKey, map.west.key);

    const allow = paintAllow(map.session, map.counties, fresh);
    const brush = cellsInRect(map.mesh, 200, 160, 300, 300);
    const patch = map.session.layer(map.counties.id).paint(brush, fresh.key, allow);
    const realmOwners = map.session.layer(map.realms.id).owners;
    assert.ok(patch.cells.length > 0);
    assert.ok([...patch.cells].every((cell) => realmOwners[cell] === map.west.key), "nothing outside West");

    const homeless = addRegion(map.counties, { name: "Lost" }, nextId);
    const water = cellsInRect(map.mesh, 10, 10, 40, 40)[0];
    assert.equal(settleParentKey(map.session, map.counties, homeless, water).allowed, false, "no parent region under the first cell");
    assert.equal(paintAllow(map.session, map.realms, map.west), null, "a top level paints anywhere");
});

test("painting a parent clears the child cells it takes, down to a free level", async () => {
    const map = await nestedMap();
    const third = createLevel({ name: "Baronies", parentLevelId: map.counties.id, nestingMode: "free" }, nextId);
    const barony = addRegion(third, { name: "Barony" }, nextId);
    map.set.levels.push(third);
    map.session.setLayerSets(map.layerSets);
    map.session.layer(third.id).paint(cellsInRect(map.mesh, 100, 0, 250, 150), barony.key);

    const taken = map.session.layer(map.realms.id).paint(cellsInRect(map.mesh, 150, 0, 250, 300), map.east.key);
    const recorded = new Map();
    const cleared = clearBelow(map.session, map.layerSets, map.realms.id, taken.cells, (levelId, patch) => recorded.set(levelId, patch));
    const counties = map.session.layer(map.counties.id).owners;
    assert.ok(cleared > 0);
    assert.ok([...taken.cells].every((cell) => counties[cell] === UNCLAIMED), "counties under the taken cells are cleared");
    assert.ok(recorded.has(map.counties.id));
    assert.ok(!recorded.has(third.id), "a free level keeps its cells");
});

test("nesting problems are counted and fixed by assigning regions to their parents", async () => {
    const map = await nestedMap({ nestingMode: "free" });
    // Northwest spills over into East
    map.session.layer(map.counties.id).paint(cellsInRect(map.mesh, 250, 0, 280, 100), map.northwest.key);
    const problems = nestingProblems(map.session, map.counties);
    assert.ok(problems.length > 0);
    const fixed = assignToParents(map.session, map.counties);
    assert.equal(fixed.patch.cells.length, problems.length);
    assert.equal(nestingProblems(map.session, map.counties).length, 0);
    assert.equal(map.northwest.parentKey, map.west.key);
});

test("auto-assign fills unclaimed land inside each parent only, and a cancelled run changes nothing", async () => {
    const map = await nestedMap();
    const unassigned = unassignedCount(map.session, map.counties);
    assert.ok(unassigned > 0);
    const before = map.session.layer(map.counties.id).owners.slice();

    const controller = new AbortController();
    controller.abort();
    assert.equal(await autoAssign(map.session, map.counties, { signal: controller.signal, pause: async () => {} }), null);
    assert.deepEqual(map.session.layer(map.counties.id).owners, before);

    const result = await autoAssign(map.session, map.counties, { pause: async () => {} });
    assert.ok(result.patch.cells.length > 0);
    const counties = map.session.layer(map.counties.id).owners;
    const realms = map.session.layer(map.realms.id).owners;
    for (const cell of result.patch.cells) {
        const parent = counties[cell] === map.northwest.key ? map.west.key : map.east.key;
        assert.equal(realms[cell], parent, "a filled cell lies inside its region's parent");
    }
    assert.equal(unassignedCount(map.session, map.counties), 0);
});

/** Two realms side by side on a coast (water left of x 100), with an enclosed lake inside West. */
async function coastalMap(watersPx) {
    const realms = createLevel({ name: "Realms", watersPx }, nextId);
    const west = addRegion(realms, { name: "West" }, nextId);
    const east = addRegion(realms, { name: "East" }, nextId);
    const layerSets = [createLayerSet({ name: "Political", levels: [realms] }, nextId)];
    const isLake = (x, y) => x >= 180 && x < 220 && y >= 200 && y < 240;
    const session = await smallSession(layerSets, {}, { isWater: (x, y) => x < 100 || isLake(x, y) });
    const mesh = session.mesh;
    const land = session.aggregates.land;
    const landOnly = (cells) => cells.filter((cell) => land[cell] === 1);
    session.layer(realms.id).paint(landOnly(cellsInRect(mesh, 100, 0, 250, 150)), west.key);
    session.layer(realms.id).paint(landOnly(cellsInRect(mesh, 100, 150, 250, 300)), east.key);
    return { session, realms, west, east, mesh, land };
}

test("territorial waters go to the nearest coast up to the limit, split between neighbours, and lakes are claimed whole", async () => {
    const { claimWaters } = await import("../../src/mesh/RegionEdits.js");
    const map = await coastalMap(30);
    const result = claimWaters(map.session, map.realms);
    const owners = map.session.layer(map.realms.id).owners;
    assert.ok(result.patch.cells.length > 0);
    // 30 px out to sea: claimed near the coast, open further out
    assert.equal(owners[map.mesh.cellAt(90, 75)], map.west.key);
    assert.equal(owners[map.mesh.cellAt(90, 225)], map.east.key);
    assert.equal(owners[map.mesh.cellAt(20, 150)], UNCLAIMED, "beyond the limit");
    assert.equal(owners[map.mesh.cellAt(200, 220)], map.east.key, "the lake inside East is East's");
    const sea = cellsInRect(map.mesh, 85, 0, 100, 300).filter((cell) => map.land[cell] !== 1 && Math.abs(map.mesh.siteY(cell) - 150) > 10);
    assert.ok(sea.every((cell) => owners[cell] === (map.mesh.siteY(cell) < 150 ? map.west.key : map.east.key)), "the strip splits along the coast's halfway line");

    map.realms.watersPx = 0;
    claimWaters(map.session, map.realms);
    assert.ok(cellsInRect(map.mesh, 0, 0, 400, 300).every((cell) => map.land[cell] === 1 || owners[cell] === UNCLAIMED), "no water at all at 0");
});
