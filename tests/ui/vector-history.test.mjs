// The vector side of undo and redo: snapshots, owner patches, whole owner arrays and composite
// entries, stepping through them exactly in both directions, and the history's length limit.
import assert from "node:assert/strict";
import { test } from "node:test";

const { installPlatform, platform } = await import("../../src/platform/index.js");
installPlatform({ utils: { ...platform.utils, deepClone: (value) => structuredClone(value) } });

const { VectorHistory } = await import("../../src/applications/VectorHistory.js");
const { FILRODENSWMB } = await import("../../src/config.js");
const { addRegion, createLayerSet, createLevel } = await import("../../src/mesh/Schema.js");
const { deleteLevel } = await import("../../src/mesh/RegionEdits.js");
const { cellsInRect, smallSession } = await import("../mesh/helpers.mjs");

/** A studio stand-in with the state the vector snapshot reads, and a session with one painted level. */
async function studio() {
    const parent = createLevel({ id: "parent", name: "Parent" });
    const region = addRegion(parent, { id: "r1", name: "R1" });
    const child = createLevel({ id: "child", name: "Child", parentLevelId: "parent" });
    const grandchild = createLevel({ id: "grandchild", name: "Grandchild", parentLevelId: "child" });
    const layerSets = [createLayerSet({ id: "set", levels: [parent, child, grandchild] })];
    const session = await smallSession(layerSets);
    session.layer("parent").paint(cellsInRect(session.mesh, 100, 0, 200, 100), region.key);
    session.layer("child").paint(cellsInRect(session.mesh, 100, 0, 150, 100), 0);
    return {
        meshSession: session,
        layerSets,
        tectonicFaults: [],
        manualRivers: [],
        landMasks: [],
        mapPins: [],
        mapRoutes: [],
        mapLabels: [],
        mapDecorations: [],
        uiState: { customBiomes: [] },
        pinHistory: [],
        pinRedoStack: [],
        globalHistoryLedger: [],
        globalRedoLedger: [],
    };
}

test("an owners entry undoes and redoes exactly", async () => {
    const app = await studio();
    const layer = app.meshSession.layer("parent");
    const before = layer.owners.slice();
    const patch = layer.paint(cellsInRect(app.meshSession.mesh, 0, 150, 300, 300), 0);
    const after = layer.owners.slice();
    VectorHistory.push(app, VectorHistory.owners("parent", patch));
    assert.deepEqual(app.globalHistoryLedger, ["vector"]);

    assert.equal(VectorHistory.step(app, true), true);
    assert.deepEqual(app.meshSession.layer("parent").owners, before);
    assert.equal(VectorHistory.step(app, false), true);
    assert.deepEqual(app.meshSession.layer("parent").owners, after);
    assert.equal(VectorHistory.step(app, false), false, "nothing left to redo");
});

test("a composite entry (deleting a level) restores the level, its cells and its children's parent", async () => {
    const app = await studio();
    const cells = app.meshSession.layer("child").owners.slice();
    const before = VectorHistory.snapshot(app);
    const removed = deleteLevel(app.meshSession, app.layerSets, "child");
    VectorHistory.push(app, VectorHistory.composite([before, VectorHistory.levelOwners("child", removed.owners, null)]));
    assert.equal(app.layerSets[0].levels.find((level) => level.id === "grandchild").parentLevelId, "parent");

    VectorHistory.step(app, true);
    const restored = app.layerSets[0].levels;
    assert.deepEqual(restored.map((level) => level.id), ["parent", "child", "grandchild"]);
    assert.equal(restored[2].parentLevelId, "child");
    assert.deepEqual(app.meshSession.layer("child").owners, cells);
    assert.equal(app.meshSession.layerSets, app.layerSets, "the session draws the restored sets");

    VectorHistory.step(app, false);
    assert.deepEqual(app.layerSets[0].levels.map((level) => level.id), ["parent", "grandchild"]);
    assert.ok(!app.meshSession.layers.has("child"));
});

test("a composite of a snapshot and a patch steps both, in the right order, both ways", async () => {
    const app = await studio();
    const level = app.layerSets[0].levels[0];
    const before = VectorHistory.snapshot(app);
    const region = addRegion(level, { id: "r2", name: "R2" });
    const patch = app.meshSession.layer("parent").paint(cellsInRect(app.meshSession.mesh, 250, 0, 300, 100), region.key);
    VectorHistory.push(app, VectorHistory.composite([before, VectorHistory.owners("parent", patch)]));

    VectorHistory.step(app, true);
    assert.deepEqual(app.layerSets[0].levels[0].regions.map((entry) => entry.id), ["r1"]);
    assert.ok(!app.meshSession.layer("parent").owners.includes(region.key));
    VectorHistory.step(app, false);
    assert.deepEqual(app.layerSets[0].levels[0].regions.map((entry) => entry.id), ["r1", "r2"]);
    assert.ok(app.meshSession.layer("parent").owners.includes(region.key));
    assert.ok(VectorHistory.patchBounds(app, app.pinHistory.at(-1)), "the undo preview finds the painted cells");
});

test("the history keeps at most HISTORY_MAX entries, and a new edit clears redo", async () => {
    const app = await studio();
    for (let i = 0; i < FILRODENSWMB.LIMITS.HISTORY_MAX + 5; i++) VectorHistory.push(app, VectorHistory.snapshot(app));
    assert.equal(app.pinHistory.length, FILRODENSWMB.LIMITS.HISTORY_MAX);
    assert.equal(app.globalHistoryLedger.length, FILRODENSWMB.LIMITS.HISTORY_MAX);
    VectorHistory.step(app, true);
    assert.equal(app.pinRedoStack.length, 1);
    VectorHistory.push(app, VectorHistory.snapshot(app));
    assert.equal(app.pinRedoStack.length, 0);
    VectorHistory.push(app, VectorHistory.composite([]));
    VectorHistory.push(app, null);
    assert.equal(app.pinHistory.length, FILRODENSWMB.LIMITS.HISTORY_MAX, "empty entries are not recorded");
});
