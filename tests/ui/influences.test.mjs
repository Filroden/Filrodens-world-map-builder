// The Influences tool (InfluenceView, InfluencePainter) on the synthetic island: the panel's and
// bar's choices, Raise, Lower and Erase as one undo step each, Clear as one undo step, the overlay's
// base and tint, the land's capacity shown without a run, what Generate and Travel are given, and
// painting after a run showing it out of date, cleared by undo.
import "../mesh/foundry-stubs.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

const { installPlatform, platform } = await import("../../src/platform/index.js");
installPlatform({
    i18n: { localize: (key) => key, format: (key, data) => `${key} ${JSON.stringify(data)}`, lang: "en" },
    notify: { info() {}, warn() {}, error() {} },
    utils: { ...platform.utils, randomID: () => `g${Math.random().toString(36).slice(2, 18).padEnd(16, "0")}`, deepClone: (value) => structuredClone(value), mergeObject: (target, source) => Object.assign(target, source) },
});

const { MapStateManager } = await import("../../src/applications/MapStateManager.js");
const { Generation } = await import("../../src/applications/Generation.js");
const { InfluencePainter } = await import("../../src/applications/InfluencePainter.js");
const { InfluenceView, combinedByte, combinedLookup } = await import("../../src/applications/InfluenceView.js");
const { RunInputs } = await import("../../src/applications/RunInputs.js");
const { VectorHistory } = await import("../../src/applications/VectorHistory.js");
const { runGenerator } = await import("../../src/generator/Pipeline.js");
const { MeshSession } = await import("../../src/mesh/MeshSession.js");
const { HEIGHT, WIDTH, syntheticMap } = await import("../generator/synthetic.mjs");

/** A studio stand-in on the synthetic island, with the Influences tool open. */
function studio() {
    const { mesh, buffers, makePayload } = syntheticMap();
    const aggregates = mesh.aggregate({ elevation: buffers.elevation, waterMask: buffers.waterMask, seaLevel: makePayload().seaLevel });
    const meshSession = new MeshSession({ mesh, meshBlock: { seed: 7, spacing: 4, cells: mesh.cellCount, width: WIDTH, height: HEIGHT, version: 1 }, layerSets: [], owners: {}, aggregates });
    return {
        activeTool: "influences",
        uiState: { ...MapStateManager.buildDefaultUiState(WIDTH, HEIGHT), mapSeed: "SYNTH", seaLevel: 0.35, customBiomes: [], customRouteStyles: [], customPinStyles: [], brushSize: 30 },
        meshSession,
        currentElevationData: buffers.elevation,
        currentMoistureData: buffers.moisture,
        currentTemperatureData: buffers.temperature,
        bufferWaterMask: buffers.waterMask,
        currentBiomeOverrides: null,
        currentRiverData: null,
        customBiomeColors: {},
        layerSets: [],
        tectonicFaults: [],
        manualRivers: [],
        landMasks: [],
        mapPins: [],
        mapRoutes: [],
        mapLabels: [],
        mapDecorations: [],
        modelRun: null,
        pinHistory: [],
        pinRedoStack: [],
        globalHistoryLedger: [],
        globalRedoLedger: [],
        dirty: 0,
        markDirty() {
            this.dirty++;
        },
        _repaintVectors() {},
    };
}

/** A brush stroke through the tool, as the canvas hands it the primary button. */
function stroke(app, from, to, event = {}) {
    const tool = InfluencePainter.tool(app);
    tool.down(from.x, from.y, event);
    tool.move(to.x, to.y, event);
    tool.up(to.x, to.y, event);
}

const WEST = { x: 130, y: 180 };
const WEST_END = { x: 170, y: 180 };

test("the panel offers both kinds with a scale of the tints; the bar Raise, Lower and Erase with its strength and feather", () => {
    const app = studio();
    const context = InfluenceView.context(app);
    assert.deepEqual(context.kinds.map((kind) => kind.id), ["capacity", "security"]);
    assert.equal(context.kind, "capacity");
    assert.equal(context.legend.caption, "FILRODENSWMB.UI.InfluenceScaleCapacity");
    assert.match(context.legend.least, /"value":30\b/, "at the least, the land feeds 30%");
    assert.match(context.legend.none, /"value":100\b/);
    assert.match(context.legend.most, /"value":338\b/, "at the most, 338%");

    InfluenceView.chooseKind(app, "security");
    InfluenceView.chooseKind(app, "elsewhere");
    assert.equal(InfluenceView.kind(app), "security", "an unknown kind is ignored");
    assert.match(InfluenceView.context(app).legend.most, /"value":30\b/, "at the safest, strife is felt at 30%");
    assert.match(InfluenceView.context(app).legend.least, /"value":338\b/, "at the most dangerous, 338%");

    const bar = InfluencePainter.toolbarContext(app);
    assert.deepEqual(bar.modes.map((mode) => mode.value), ["raise", "lower", "erase"]);
    assert.equal(InfluencePainter.mode(app), "raise");
    assert.equal(bar.strength.value, 0.25);
    assert.equal(bar.feather.value, 0.4);
    app.uiState.influenceStrength = 7;
    app.uiState.influenceFeather = "x";
    assert.equal(InfluencePainter.strength(app), 1, "kept in range");
    assert.equal(InfluencePainter.feather(app), 0.4, "its default when not a number");
});

test("a stroke raises the land under the brush as one undo step, and undo takes it away", () => {
    const app = studio();
    stroke(app, WEST, WEST_END);
    const { influences } = app.meshSession;
    const cell = app.meshSession.mesh.cellAt(WEST.x + 20, WEST.y);
    const raised = influences.levelAt("capacity", cell);
    assert.ok(raised > 0, "raised under the brush");
    assert.equal(influences.any("security"), false);
    assert.equal(app.pinHistory.length, 1, "one undo step");
    assert.equal(app.dirty, 1);
    assert.ok(InfluenceView.context(app).kinds[0].painted);

    VectorHistory.step(app, true);
    assert.equal(influences.any(), false, "undone");
    VectorHistory.step(app, false);
    assert.equal(influences.levelAt("capacity", cell), raised, "and redone");

    // The same stroke again builds on it
    stroke(app, WEST, WEST_END);
    assert.ok(influences.levelAt("capacity", cell) > raised, "a second stroke adds more");
    VectorHistory.step(app, true);

    // Lower, and Shift with Raise, take it down again; Erase brings it back towards none
    app.uiState.influencePaintMode = "lower";
    stroke(app, WEST, WEST_END);
    assert.ok(Math.abs(influences.levelAt("capacity", cell)) <= 1, "lowered back by as much (to the nearest whole number)");
    app.uiState.influencePaintMode = "raise";
    stroke(app, WEST, WEST_END, { shiftKey: true });
    assert.ok(influences.levelAt("capacity", cell) < -raised + 2, "Shift lowers with Raise");
    app.uiState.influencePaintMode = "erase";
    app.uiState.influenceStrength = 1;
    stroke(app, WEST, WEST_END);
    assert.equal(influences.any(), false, "erased");
});

test("Clear takes away one kind, after asking, as one undo step", async () => {
    const app = studio();
    stroke(app, WEST, WEST_END);
    app.uiState.influenceKind = "security";
    stroke(app, WEST, WEST_END);
    const { influences } = app.meshSession;
    assert.equal(await InfluenceView.clear(app, "security", async () => false), false, "not without a yes");
    assert.ok(influences.any("security"));
    assert.equal(await InfluenceView.clear(app, "security", async () => true), true);
    assert.equal(influences.any("security"), false);
    assert.ok(influences.any("capacity"), "the other kind stays");
    VectorHistory.step(app, true);
    assert.ok(influences.any("security"), "undone");
    assert.equal(await InfluenceView.clear(app, "elsewhere", async () => true), false);
});

test("Generate is given the painting per pixel; Travel's network is not", () => {
    const app = studio();
    assert.equal(Generation.payload(app).influences, null, "nothing painted, nothing given");
    app.uiState.influenceStrength = 0.3;
    stroke(app, WEST, WEST_END);
    const payload = Generation.payload(app);
    assert.ok(payload.influences.capacity instanceof Int8Array);
    assert.equal(payload.influences.capacity.length, WIDTH * HEIGHT);
    assert.equal(payload.influences.security, null);
    assert.ok(payload.influences.capacity.some((level) => level > 0));
    assert.equal(Generation.payload(app, undefined, { influences: false }).influences, null);
});

test("painting after a run shows it out of date, and undoing the painting clears it", async () => {
    const app = studio();
    const result = await runGenerator(syntheticMap().makePayload(), { pause: () => Promise.resolve() });
    Generation.apply(app, result);
    assert.deepEqual(RunInputs.changed(app), []);
    assert.ok(RunInputs.KINDS.includes("influences"));
    stroke(app, WEST, WEST_END);
    assert.deepEqual(RunInputs.changed(app), ["influences"]);
    assert.equal(RunInputs.stale(app), true);
    assert.equal(InfluenceView.context(app).stale, true);
    VectorHistory.step(app, true);
    assert.deepEqual(RunInputs.changed(app), [], "undone, the run is up to date again");
    assert.equal(app.uiState.generatorStale === true, false, "not the lasting flag");

    // A run saved before influences were kept is not out of date by them
    stroke(app, WEST, WEST_END);
    delete app.modelRun.inputs.influences;
    assert.deepEqual(RunInputs.changed(app), []);
});

test("the overlay: the base layer in its shades with the painting's tint, nothing where neither is", async () => {
    // No base and no painting: nothing drawn; painting alone: its own byte, however faint; a base alone and painted differ
    assert.equal(combinedByte(0, 0), 0);
    assert.ok(combinedByte(0, 1) > 0, "the faintest painting shows");
    assert.notEqual(combinedByte(200, 0), combinedByte(200, 40));
    assert.notEqual(combinedByte(200, 0), combinedByte(40, 0));
    const bytes = new Set();
    for (let base = 0; base < 256; base++) for (let level = -100; level <= 100; level++) bytes.add(combinedByte(base, level));
    assert.ok(Math.max(...bytes) < 256, "every byte fits the lookup");

    const ramp = new Uint8Array(256 * 4).fill(255);
    const lookup = combinedLookup(ramp);
    const at = (byte) => Array.from(lookup.subarray(byte * 4, byte * 4 + 4));
    assert.deepEqual(at(combinedByte(100, 0)), [255, 255, 255, 255], "a base without painting is its own shade");
    assert.ok(at(combinedByte(100, 100))[0] < at(combinedByte(100, 20))[0], "more painting tints more strongly");
    assert.ok(at(combinedByte(0, -20))[3] < at(combinedByte(0, -100))[3], "with no base, fainter painting is fainter");
    assert.equal(combinedLookup(null)[combinedByte(0, 0) * 4 + 3], 0);

    // With no run, food capacity is judged against the land's capacity, worked out in the background
    const app = studio();
    assert.equal(InfluenceView.context(app).base, "FILRODENSWMB.UI.InfluenceBaseCapacityBuilding");
    assert.equal(InfluenceView.display(app, 0.5).values.every((byte) => byte === 0), true, "nothing to show yet");
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (let tries = 0; tries < 50 && InfluenceView.context(app).base.endsWith("Building"); tries++) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(InfluenceView.context(app).base, "FILRODENSWMB.UI.InfluenceBaseCapacityLive");
    const display = InfluenceView.display(app, 0.5);
    assert.equal(display.values.length, app.meshSession.mesh.cellCount);
    assert.ok(display.values.some((byte) => byte > 0), "the land's capacity shows");
    assert.equal(display.opacity, 0.5);

    // Security has no danger until a run: the land drawn as Danger's no danger, the painting over it
    InfluenceView.chooseKind(app, "security");
    assert.equal(InfluenceView.context(app).base, "FILRODENSWMB.UI.InfluenceBaseDangerNone");
    const { land } = app.meshSession.aggregates;
    const plain = InfluenceView.display(app, 1).values;
    assert.ok(plain.every((byte, cell) => (land[cell] === 1 ? byte > 0 : byte === 0)), "every land cell drawn, and nothing else");
    assert.equal(new Set(plain.filter((byte) => byte > 0)).size, 1, "all at no danger");
    stroke(app, WEST, WEST_END);
    assert.ok(new Set(InfluenceView.display(app, 1).values.filter((byte) => byte > 0)).size > 1, "the painting shows over it");

    // After a run, the run's own layers
    Generation.apply(app, await runGenerator(syntheticMap().makePayload(), { pause: () => Promise.resolve() }));
    assert.equal(InfluenceView.context(app).base, "FILRODENSWMB.UI.InfluenceBaseDangerRun");
    InfluenceView.chooseKind(app, "capacity");
    assert.equal(InfluenceView.context(app).base, "FILRODENSWMB.UI.InfluenceBaseCapacityRun");
});

test("the information bar reads what the painting under the pointer does", () => {
    const app = studio();
    app.uiState.influencePaintMode = "lower";
    app.uiState.influenceStrength = 1;
    // Back and forth until the land is lowered to the least
    const scrub = () => {
        for (let pass = 0; pass < 4; pass++) stroke(app, pass % 2 ? WEST_END : WEST, pass % 2 ? WEST : WEST_END);
    };
    scrub();
    const cell = app.meshSession.mesh.cellAt(WEST.x + 20, WEST.y);
    assert.match(InfluenceView.readout(app, cell), /InfluenceReadoutCapacity .*"percent":30\b/);
    InfluenceView.chooseKind(app, "security");
    scrub();
    assert.match(InfluenceView.readout(app, cell), /InfluenceReadoutSecurity .*"percent":338/, "more dangerous: strife felt at 338%");
    assert.match(InfluenceView.readout(app, app.meshSession.mesh.cellAt(400, 60)), /InfluenceReadoutNone/);
    assert.equal(InfluenceView.readout(app, -1), null);
});
