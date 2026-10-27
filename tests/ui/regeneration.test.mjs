// Generate again and Remove generated content (Regeneration, Generation): what earlier runs made
// is replaced in the same Political set, except what the reader has made their own (an edited or
// locked item; a region keeps its whole realm; everything hand-made), as one undo step; and the
// edit paths that mark an item as the reader's own (GeneratedEdits) on the canvas and in lists.
import "../mesh/foundry-stubs.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

const { installPlatform, platform } = await import("../../src/platform/index.js");

let nextId = 0;
let confirmAnswer = true;
installPlatform({
    i18n: { localize: (key) => key, format: (key, data) => `${key} ${JSON.stringify(data)}`, lang: "en" },
    notify: { info() {}, warn() {}, error() {} },
    utils: { ...platform.utils, randomID: () => `g${String(++nextId).padStart(15, "0")}`, deepClone: (value) => structuredClone(value), mergeObject: (target, source) => Object.assign(target, source) },
    dialogs: { confirm: async () => confirmAnswer },
});

const { Generation } = await import("../../src/applications/Generation.js");
const { Regeneration } = await import("../../src/applications/Regeneration.js");
const { GeneratedEdits } = await import("../../src/applications/GeneratedEdits.js");
const { VectorHistory } = await import("../../src/applications/VectorHistory.js");
const { MassEdit } = await import("../../src/applications/MassEdit.js");
const { RegionPanel } = await import("../../src/applications/RegionPanel.js");
const { runGenerator } = await import("../../src/generator/Pipeline.js");
const { MeshSession } = await import("../../src/mesh/MeshSession.js");
const { UNCLAIMED } = await import("../../src/mesh/Schema.js");
const { HEIGHT, WIDTH, syntheticMap } = await import("../generator/synthetic.mjs");

let result = null;
async function islandResult() {
    result ??= await runGenerator(syntheticMap().makePayload(), { pause: () => Promise.resolve() });
    return result;
}

function studio() {
    const { mesh, buffers, makePayload } = syntheticMap();
    const aggregates = mesh.aggregate({ elevation: buffers.elevation, waterMask: buffers.waterMask, seaLevel: makePayload().seaLevel });
    const meshSession = new MeshSession({ mesh, meshBlock: { seed: 7, spacing: 4, cells: mesh.cellCount, width: WIDTH, height: HEIGHT, version: 1 }, layerSets: [], owners: {}, aggregates });
    return {
        meshSession,
        layerSets: [],
        tectonicFaults: [],
        manualRivers: [],
        landMasks: [],
        mapPins: [{ id: "own-pin", name: "My inn", icon: "dot", x: 1, y: 1 }],
        mapRoutes: [],
        mapLabels: [],
        mapDecorations: [],
        modelRun: null,
        uiState: { customBiomes: [], customRouteStyles: [], customPinStyles: [] },
        pinHistory: [],
        pinRedoStack: [],
        globalHistoryLedger: [],
        globalRedoLedger: [],
        get regionLevels() {
            return this.layerSets.flatMap((set) => set.levels);
        },
        _repaintVectors() {},
        markDirty() {},
    };
}

const political = (app) => app.layerSets.filter((set) => set.kind === "political");
const ownersOf = (app, level) => Array.from(app.meshSession.layer(level.id).owners);
const generatedPins = (app) => app.mapPins.filter((pin) => pin.generated);

test("Generate again replaces the earlier run's content in the same Political set, as one undo step", async () => {
    const app = studio();
    const run = await islandResult();
    Generation.apply(app, run);
    const first = { set: political(app)[0], realm: political(app)[0].levels[0].regions[0].id, pins: generatedPins(app).map((pin) => pin.id) };
    assert.deepEqual(Regeneration.plan(app).removed, { realms: 1, places: first.pins.length, routes: app.mapRoutes.length });

    Generation.apply(app, run);
    assert.equal(political(app).length, 1, "one Political set");
    assert.equal(political(app)[0].id, first.set.id, "the same set");
    const [realms] = political(app)[0].levels;
    assert.equal(realms.regions.length, 1);
    assert.notEqual(realms.regions[0].id, first.realm, "the realm is the new run's");
    assert.ok(generatedPins(app).every((pin) => !first.pins.includes(pin.id)), "the places are the new run's");
    assert.ok(app.mapPins.some((pin) => pin.id === "own-pin"), "a hand-made pin stays");
    const owners = ownersOf(app, realms);
    assert.ok(owners.every((owner) => owner === UNCLAIMED || realms.regions.some((region) => region.key === owner)), "every owned cell is a region's");

    VectorHistory.step(app, true);
    const restored = political(app)[0];
    assert.equal(restored.levels[0].regions[0].id, first.realm, "undo brings the first run back");
    assert.deepEqual(generatedPins(app).map((pin) => pin.id), first.pins);
    assert.ok(ownersOf(app, restored.levels[0]).some((owner) => owner === restored.levels[0].regions[0].key));
});

test("an edited county keeps its whole realm; a locked place and an edited route stay; nothing is put on a kept place", async () => {
    const app = studio();
    const run = await islandResult();
    Generation.apply(app, run);
    const set = political(app)[0];
    const [realms, duchies, counties] = set.levels;
    const keptIds = set.levels.flatMap((level) => level.regions.map((region) => region.id));
    const keptOwners = set.levels.map((level) => ownersOf(app, level));
    counties.regions[0].generated.edited = true;
    const lockedPin = generatedPins(app)[0];
    lockedPin.generated.locked = true;
    const editedRoute = app.mapRoutes[0];
    editedRoute.generated.edited = true;

    const plan = Regeneration.plan(app);
    assert.equal(plan.removed.realms, 0, "the realm is kept");
    Generation.apply(app, run);

    const after = political(app)[0];
    assert.deepEqual(after.levels.flatMap((level) => level.regions.map((region) => region.id)).filter((id) => keptIds.includes(id)).sort(), [...keptIds].sort(), "the realm, its duchies and counties are kept");
    after.levels.forEach((level, depth) => {
        const now = ownersOf(app, level);
        keptOwners[depth].forEach((owner, cell) => {
            if (owner !== UNCLAIMED) assert.equal(now[cell], owner, "a kept region's cells are its own still");
        });
    });
    assert.ok(app.mapPins.includes(lockedPin));
    assert.equal(app.mapPins.filter((pin) => pin.cell === lockedPin.cell).length, 1, "no new place on the kept one's cell");
    assert.ok(app.mapRoutes.includes(editedRoute));
    assert.equal(realms.regions.length + duchies.regions.length >= 2, true);
});

test("Remove generated content takes what is not kept, drops a set left empty, and is one undo step", async () => {
    const app = studio();
    Generation.apply(app, await islandResult());
    const levels = political(app)[0].levels.map((level) => level.id);
    confirmAnswer = false;
    assert.equal(await Generation.removeGenerated(app), false, "a confirmation first");
    confirmAnswer = true;
    assert.equal(await Generation.removeGenerated(app), true);
    assert.equal(political(app).length, 0, "the empty set goes");
    assert.deepEqual(app.mapPins.map((pin) => pin.id), ["own-pin"]);
    assert.equal(app.mapRoutes.length, 0);
    assert.equal(app.modelRun, null);
    VectorHistory.step(app, true);
    assert.equal(political(app).length, 1);
    assert.deepEqual(political(app)[0].levels.map((level) => level.id), levels);
    assert.ok(ownersOf(app, political(app)[0].levels[0]).some((owner) => owner !== UNCLAIMED), "its cells come back");
    assert.equal(await Generation.removeGenerated(app), true);
    assert.equal(await Generation.removeGenerated(app), false, "nothing left to remove");
});

test("a stroke that changes a generated region's cells marks it, and undo unmarks it", () => {
    const app = studio();
    const level = { id: "lv", regions: [{ id: "a", key: 0, generated: { edited: false } }, { id: "b", key: 1, generated: { edited: false } }, { id: "c", key: 2 }] };
    app.layerSets = [{ id: "s", kind: "political", levels: [level] }];
    app.meshSession.setLayerSets(app.layerSets);
    const marked = GeneratedEdits.markPatched(app, new Map([["lv", { cells: [5], before: [0], after: [2] }]]));
    assert.deepEqual(marked, ["a"], "the region that lost cells; a hand-made one is not generated");
    VectorHistory.push(app, VectorHistory.edited(marked));
    VectorHistory.step(app, true);
    assert.equal(level.regions[0].generated.edited, false);
    VectorHistory.step(app, false);
    assert.equal(level.regions[0].generated.edited, true);
});

test("Mass Edit marks only for changes other than visibility; a region renamed in its list is marked", () => {
    const app = studio();
    const pins = [{ id: "p", icon: "dot", generated: { edited: false } }];
    app.mapPins = pins;
    MassEdit.apply(app, "pin", pins, [{ store: "item", key: "visibility", value: "gm" }]);
    assert.equal(pins[0].generated.edited, false);
    MassEdit.apply(app, "pin", pins, [{ store: "item", key: "color", value: "#123456" }]);
    assert.equal(pins[0].generated.edited, true);

    const region = { id: "r", key: 0, name: "Old", generated: { edited: false } };
    app.layerSets = [{ id: "s", name: "Political", kind: "political", levels: [{ id: "lv", name: "Realms", regions: [region] }] }];
    app.meshSession.setLayerSets(app.layerSets);
    RegionPanel.rename(app, "region:r", "New");
    assert.equal(region.generated.edited, true);
});
