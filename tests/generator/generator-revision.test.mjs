// The generator revision a map follows (GeneratorRevision): a map saved before maps recorded one
// reads as the oldest, a new map and a new run as the current one, a regional map as its parent;
// what is worked out live from the map (Travel's network, Fill in's payload) follows the map's
// revision while a run asks for the current one; and the Generate panel's one notice says when the
// map keeps an older generator's rules.
import "../mesh/foundry-stubs.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

const { installPlatform, platform } = await import("../../src/platform/index.js");
installPlatform({
    i18n: { localize: (key) => key, format: (key, data) => `${key} ${JSON.stringify(data)}`, lang: "en" },
    notify: { info() {}, warn() {}, error() {} },
    utils: { ...platform.utils, deepClone: (value) => structuredClone(value) },
});

const { FILRODENSWMB } = await import("../../src/config.js");
const { GeneratorRevision } = await import("../../src/generator/GeneratorRevision.js");
const { runGenerator } = await import("../../src/generator/Pipeline.js");
const { encodeModelRun } = await import("../../src/generator/ModelRun.js");
const { cropRun } = await import("../../src/generator/ParentRun.js");
const { MapStateManager } = await import("../../src/applications/MapStateManager.js");
const { Generation } = await import("../../src/applications/Generation.js");
const { GeneratePanel } = await import("../../src/applications/GeneratePanel.js");
const { TravelNetwork } = await import("../../src/applications/TravelNetwork.js");
const { HEIGHT, WIDTH, syntheticMap } = await import("../generator/synthetic.mjs");

const { LEGACY, REVISION_2 } = FILRODENSWMB.GENERATOR.REVISIONS;
const CURRENT = FILRODENSWMB.GENERATOR.REVISION;

/** A studio stand-in on the synthetic island, its map state a new map's. */
function studio(uiState = MapStateManager.buildDefaultUiState(WIDTH, HEIGHT)) {
    const { mesh, buffers } = syntheticMap();
    return {
        uiState,
        meshSession: { mesh },
        currentElevationData: buffers.elevation,
        currentMoistureData: buffers.moisture,
        currentTemperatureData: buffers.temperature,
        bufferWaterMask: buffers.waterMask,
        currentBiomeOverrides: null,
        currentRiverData: null,
        customBiomeColors: {},
        layerSets: [],
        mapPins: [],
        mapRoutes: [],
        modelRun: null,
        currentParentId: null,
    };
}

test("the current revision is 2, and every named revision is in order", () => {
    assert.equal(CURRENT, 2);
    assert.equal(GeneratorRevision.CURRENT, CURRENT);
    assert.ok(LEGACY < REVISION_2 && REVISION_2 <= CURRENT);
    assert.ok(GeneratorRevision.follows(CURRENT, REVISION_2));
    assert.ok(!GeneratorRevision.follows(LEGACY, REVISION_2));
});

test("a map saved before the revision was recorded reads as the oldest; a recorded one reads as itself", () => {
    assert.equal(GeneratorRevision.of({}), LEGACY);
    assert.equal(GeneratorRevision.of(null), LEGACY);
    assert.equal(GeneratorRevision.of({ generatorRevision: 2 }), 2);
    for (const odd of ["2", 0, -1, 1.5, Number.NaN, null]) assert.equal(GeneratorRevision.of({ generatorRevision: odd }), LEGACY, String(odd));
    assert.ok(GeneratorRevision.isOlder({}));
    assert.ok(!GeneratorRevision.isOlder({ generatorRevision: CURRENT }));
});

test("a new map follows the current rules, and a regional map its parent's", () => {
    assert.equal(MapStateManager.buildDefaultUiState(WIDTH, HEIGHT).generatorRevision, CURRENT);
    assert.equal(GeneratorRevision.forRegional({ generatorRevision: CURRENT }), CURRENT);
    assert.equal(GeneratorRevision.forRegional({}), LEGACY, "a regional map of an older map reads its parent's run by its parent's rules");
});

test("a payload asks for the current rules unless it names others, and the run records what it followed", async () => {
    const { makePayload } = syntheticMap();
    const payload = makePayload();
    assert.equal(payload.revision, CURRENT);
    assert.equal(GeneratorRevision.ofPayload({}), CURRENT, "a payload is a request made now");
    const run = await runGenerator(payload, { pause: () => Promise.resolve() });
    assert.equal(run.revision, CURRENT);
    assert.equal(encodeModelRun(run, "r").revision, CURRENT);
    const older = await runGenerator({ ...makePayload(), revision: LEGACY }, { pause: () => Promise.resolve() });
    assert.equal(older.revision, LEGACY);
});

test("a regional map's copy of a run keeps the run's revision, and one without reads as the oldest", async () => {
    const { mesh, makePayload } = syntheticMap();
    const saved = encodeModelRun(await runGenerator(makePayload(), { pause: () => Promise.resolve() }), "r");
    const crop = { x: 0, y: 0, width: WIDTH, height: HEIGHT };
    const sites = mesh.sites.subarray(0, 2 * mesh.modelCount);
    const frame = { sites, spacingPx: mesh.modelSpacing, spacingKm: mesh.modelSpacing * mesh.kmPerPx, crop, zoomScale: 1 };
    assert.equal(cropRun(saved, frame).revision, CURRENT);
    const { revision: _revision, ...unrecorded } = saved;
    assert.equal(cropRun(unrecorded, frame).revision, LEGACY);
});

test("Travel and Fill in follow the map's revision, a run the current one, and Travel's network is rebuilt when it changes", async () => {
    const app = studio();
    assert.equal(Generation.payload(app).revision, CURRENT);
    app.uiState.generatorRevision = undefined;
    assert.equal(Generation.payload(app).revision, LEGACY, "an older map's live readers keep its rules");
    assert.equal(Generation.payload(app, undefined, { revision: GeneratorRevision.CURRENT }).revision, CURRENT, "what a run asks for");

    const graph = await TravelNetwork.graph(app);
    assert.ok(graph);
    assert.equal(TravelNetwork.ready(app), graph);
    app.uiState.generatorRevision = CURRENT;
    assert.equal(TravelNetwork.ready(app), null, "generating an older map again brings a new network");
});

test("the Generate panel shows one notice while the map keeps an older generator's rules", () => {
    const app = studio({ ...MapStateManager.buildDefaultUiState(WIDTH, HEIGHT), mapSeed: "S" });
    app.meshSession = null;
    let context = GeneratePanel.context(app);
    assert.equal(context.older, false);
    assert.equal(context.runBadge, null);

    delete app.uiState.generatorRevision;
    context = GeneratePanel.context(app);
    assert.equal(context.older, true, "with or without a run: Travel follows the map's rules too");
    assert.equal(context.runBadge, "FILRODENSWMB.UI.GenerateOlderRevision");

    app.modelRun = { run: "old", stats: {} };
    app.uiState.generatorStale = true;
    context = GeneratePanel.context(app);
    assert.equal(context.runBadge, "FILRODENSWMB.UI.GenerateOutOfDate", "out of date says more, so its badge shows");
    assert.equal(context.older, true, "the notice still shows beside it");
});
