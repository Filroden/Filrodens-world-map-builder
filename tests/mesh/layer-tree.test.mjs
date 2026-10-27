// The structure of layer sets: parents, order, moving, removing and inserting levels.
import assert from "node:assert/strict";
import { test } from "node:test";
import { childLevels, descendantLevels, insertLevel, levelDepth, moveLevel, parentCandidates, removeLevel, setParent, uniqueName } from "../../src/mesh/LayerTree.js";
import { validateVectorData } from "../../src/mesh/Schema.js";

/** A set: realms > duchies > counties, and a separate "zones" top level. */
function politicalSet() {
    const level = (id, parentLevelId = null) => ({ id, name: id, parentLevelId, regions: [], nextKey: 0, nestingMode: "constrained", visibility: "all" });
    return { id: "set", kind: "custom", visibility: "all", levels: [level("realms"), level("duchies", "realms"), level("counties", "duchies"), level("zones")] };
}

const ids = (set) => set.levels.map((level) => level.id);

/** The set as Schema.validateVectorData sees it (a parent always before its children). */
function isValid(set) {
    const mapData = { vectorSchemaVersion: 4, mesh: { seed: 1, spacing: 4, modelSpacingKm: 25 }, layerSets: [set] };
    return validateVectorData(mapData).filter((error) => error.includes("parent")).length === 0;
}

test("children, descendants and depth follow the parent links", () => {
    const set = politicalSet();
    assert.deepEqual(childLevels(set, null).map((level) => level.id), ["realms", "zones"]);
    assert.deepEqual(descendantLevels(set, "realms").map((level) => level.id), ["duchies", "counties"]);
    assert.equal(levelDepth(set, set.levels[2]), 2);
    assert.deepEqual(parentCandidates(set, "duchies").map((level) => level.id), ["realms", "zones"], "a level cannot take itself or a level below it");
});

test("giving a level a later parent moves it and its subtree after that parent", () => {
    const set = politicalSet();
    assert.equal(setParent(set, "duchies", "zones"), true);
    assert.deepEqual(ids(set), ["realms", "zones", "duchies", "counties"]);
    assert.ok(isValid(set));
    assert.equal(setParent(set, "realms", "counties"), true, "a former ancestor can go below");
    assert.deepEqual(ids(set), ["zones", "duchies", "counties", "realms"]);
    assert.ok(isValid(set));
});

test("a parent below the level, or the level itself, is refused", () => {
    const set = politicalSet();
    assert.equal(setParent(set, "realms", "counties"), false);
    assert.equal(setParent(set, "realms", "realms"), false);
    assert.equal(setParent(set, "realms", "elsewhere"), false);
    assert.deepEqual(ids(set), ["realms", "duchies", "counties", "zones"]);
    assert.equal(setParent(set, "counties", null), true, "a level can become a top level");
    assert.ok(isValid(set));
});

test("moving a level among its siblings takes its subtree along and never changes a parent", () => {
    const set = politicalSet();
    assert.equal(moveLevel(set, "zones", -1), true);
    assert.deepEqual(ids(set), ["zones", "realms", "duchies", "counties"]);
    assert.equal(moveLevel(set, "zones", -1), false, "already first");
    assert.equal(moveLevel(set, "duchies", 1), false, "no sibling below");
    assert.equal(moveLevel(set, "zones", 1), true);
    assert.deepEqual(ids(set), ["realms", "duchies", "counties", "zones"]);
    assert.ok(isValid(set));
});

test("removing a level gives its children its parent", () => {
    const set = politicalSet();
    const removed = removeLevel([set], "duchies");
    assert.equal(removed.index, 1);
    assert.deepEqual(ids(set), ["realms", "counties", "zones"]);
    assert.equal(set.levels[1].parentLevelId, "realms");
    assert.equal(removeLevel([set], "missing"), null);
});

test("a new child level goes at the end of its parent's subtree", () => {
    const set = politicalSet();
    insertLevel(set, { id: "baronies", parentLevelId: "realms", regions: [] });
    assert.deepEqual(ids(set), ["realms", "duchies", "counties", "baronies", "zones"]);
    insertLevel(set, { id: "top", parentLevelId: null, regions: [] });
    assert.equal(ids(set).at(-1), "top");
    assert.ok(isValid(set));
});

test("unique names number the base name", () => {
    assert.equal(uniqueName("Level", []), "Level");
    assert.equal(uniqueName("Level", [{ name: "Level" }, { name: "Level 2" }]), "Level 3");
});
