// A run added to the open map (Generation.apply) on the synthetic island: the political set, routes,
// pins and model run arrive together as one undo step, which undoes and redoes exactly, and the
// styles the run needs are found by tier (or added from the defaults) without touching the map's own.
import "../mesh/foundry-stubs.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

const { installPlatform, platform } = await import("../../src/platform/index.js");

let nextId = 0;
installPlatform({
    i18n: { localize: (key) => key, format: (key, data) => `${key} ${JSON.stringify(data)}`, lang: "en" },
    notify: { info() {}, warn() {}, error() {} },
    utils: { ...platform.utils, randomID: () => `g${String(++nextId).padStart(15, "0")}`, deepClone: (value) => structuredClone(value), mergeObject: (target, source) => Object.assign(target, source) },
});

const { Generation } = await import("../../src/applications/Generation.js");
const { VectorHistory } = await import("../../src/applications/VectorHistory.js");
const { FILRODENSWMB } = await import("../../src/config.js");
const { runGenerator } = await import("../../src/generator/Pipeline.js");
const { MeshSession } = await import("../../src/mesh/MeshSession.js");
const { UNCLAIMED } = await import("../../src/mesh/Schema.js");
const { HEIGHT, WIDTH, syntheticMap } = await import("../generator/synthetic.mjs");

let result = null;
async function islandResult() {
    result ??= await runGenerator(syntheticMap().makePayload(), { pause: () => Promise.resolve() });
    return result;
}

/** A studio stand-in on the synthetic island, with one map pin style the user made. */
function studio() {
    const { mesh, buffers, makePayload } = syntheticMap();
    const aggregates = mesh.aggregate({ elevation: buffers.elevation, waterMask: buffers.waterMask, seaLevel: makePayload().seaLevel });
    const meshSession = new MeshSession({ mesh, meshBlock: { seed: 7, spacing: 4, cells: mesh.cellCount, width: WIDTH, height: HEIGHT, version: 1 }, layerSets: [], owners: {}, aggregates });
    let dirty = 0;
    return {
        meshSession,
        layerSets: [],
        tectonicFaults: [],
        manualRivers: [],
        landMasks: [],
        mapPins: [],
        mapRoutes: [],
        mapLabels: [],
        mapDecorations: [],
        modelRun: null,
        uiState: { customBiomes: [], customRouteStyles: [], customPinStyles: [{ id: "mine", name: "Mine", icon: "my_icon", scale: 1, color: "#ffffff" }] },
        pinHistory: [],
        pinRedoStack: [],
        globalHistoryLedger: [],
        globalRedoLedger: [],
        _repaintVectors() {},
        markDirty() {
            dirty++;
        },
        get dirtyCount() {
            return dirty;
        },
    };
}

/** What the map holds that a run adds to. */
function contents(app) {
    return {
        sets: app.layerSets.length,
        routes: app.mapRoutes.length,
        pins: app.mapPins.length,
        run: app.modelRun?.run ?? null,
        levels: app.layerSets.flatMap((set) => set.levels.map((level) => level.id)),
    };
}

test("a run arrives as one undo step that undoes and redoes exactly", async () => {
    const app = studio();
    const run = await islandResult();
    Generation.apply(app, run);
    const after = contents(app);
    assert.equal(after.sets, 1);
    assert.equal(after.routes > 0, true);
    assert.equal(after.pins, run.places.length);
    assert.ok(after.run);
    assert.deepEqual(app.globalHistoryLedger, ["vector"], "one step");
    assert.equal(app.activeLayerSetId, app.layerSets[0].id);
    const realms = after.levels[0];
    const owned = app.meshSession.layer(realms).owners.slice();
    assert.ok(owned.some((owner) => owner !== UNCLAIMED));

    assert.equal(VectorHistory.step(app, true), true);
    assert.deepEqual(contents(app), { sets: 0, routes: 0, pins: 0, run: null, levels: [] });

    assert.equal(VectorHistory.step(app, false), true);
    assert.deepEqual(contents(app), after);
    assert.deepEqual(app.meshSession.layer(realms).owners, owned, "the realms' cells come back");
});

test("pin styles are found by tier, the user's own styles are left alone, and route styles come from the defaults", async () => {
    const app = studio();
    Generation.apply(app, await islandResult());
    const styles = app.uiState.customPinStyles;
    const mine = styles.find((style) => style.id === "mine");
    assert.equal(mine.tier, undefined, "a style the user made is not given a tier");
    const tiers = new Set(app.mapPins.map((pin) => pin.generated.tier));
    for (const tier of tiers) assert.ok(styles.some((style) => style.tier === tier), `a style for ${tier}`);
    const routeStyleIds = new Set(app.uiState.customRouteStyles.map((style) => style.id));
    for (const route of app.mapRoutes) assert.ok(routeStyleIds.has(route.quickStyle), route.quickStyle);
    assert.ok(app.mapRoutes.every((route) => route.quickStyle === FILRODENSWMB.GENERATOR.ROUTE_STYLES[route.transport][route.class]));
});

test("generated regions and pins take the label styles made for them, added from the defaults when the map lacks them", async () => {
    const app = studio();
    Generation.apply(app, await islandResult());
    const labelStyles = app.uiState.customLabelStyles;
    const { REGION_LABEL_STYLES } = FILRODENSWMB.GENERATOR;
    for (const id of [...Object.values(REGION_LABEL_STYLES), "label-style-capital", "label-style-settlement"]) assert.ok(labelStyles.some((style) => style.id === id), id);
    const [realms, duchies, counties] = app.layerSets[0].levels;
    const realmStyle = labelStyles.find((style) => style.id === REGION_LABEL_STYLES.realm);
    for (const region of realms.regions) assert.deepEqual([region.label.quickStyle, region.label.fontSize, region.label.fontFamily, region.label.visibility], [realmStyle.id, realmStyle.fontSize, realmStyle.fontFamily, "all"]);
    assert.ok(duchies.regions.every((region) => region.label.quickStyle === REGION_LABEL_STYLES.duchy && region.label.visibility === "none"));
    assert.ok(counties.regions.every((region) => region.label.quickStyle === REGION_LABEL_STYLES.county && region.label.visibility === "none"));
    const capital = app.mapPins.find((pin) => pin.generated.tier === "capital");
    const capitalStyle = labelStyles.find((style) => style.id === "label-style-capital");
    assert.deepEqual([capital.label.quickStyle, capital.label.fontFamily], [capitalStyle.id, capitalStyle.fontFamily]);
});

test("the default pin styles rank by tier: no settlement's pin is larger than a capital's", () => {
    const scale = Object.fromEntries(FILRODENSWMB.PINS.DEFAULT_STYLES.map((style) => [style.tier, style.scale]));
    for (const tier of ["city", "largeTown", "town", "village", "castle", "fortifiedTown", "port"]) assert.ok(scale[tier] <= scale.capital, tier);
    assert.ok(scale.city >= scale.largeTown && scale.largeTown >= scale.town && scale.town >= scale.village);
});
