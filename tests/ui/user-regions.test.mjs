// The map's own regions and Generate (RegionPanel.moveToPolitical, Generation.userRegions,
// MaterialiseRegions, Regeneration.merge), on the synthetic island: Move to Political set makes a
// Political set when the map has none and moves a region into it as one undo step; a moved region
// wins its land there, clears what lay below it and takes the parent holding most of it, or none (a
// lone county, which the Political set allows and the Independent field is offered for); a run is
// built round the moved regions and written into the map keeping their painted borders exactly,
// filling inside them and giving a lone region a parent the next run may change.
import "../mesh/foundry-stubs.mjs";
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

const { installPlatform, platform } = await import("../../src/platform/index.js");

const answers = { prompt: null };
let nextId = 0;
installPlatform({
    i18n: { localize: (key) => key, format: (key, data) => `${key} ${JSON.stringify(data)}`, lang: "en" },
    notify: { info() {}, warn() {}, error() {} },
    utils: { ...platform.utils, randomID: () => `u${String(++nextId).padStart(15, "0")}`, deepClone: (value) => structuredClone(value), mergeObject: (target, source) => Object.assign(target, source) },
    templates: { render: async () => "" },
    fonts: { list: () => ["Signika", "EB Garamond", "Cinzel"] },
    dialogs: { confirm: async () => true, prompt: async () => answers.prompt },
});

const { Generation } = await import("../../src/applications/Generation.js");
const { Regeneration } = await import("../../src/applications/Regeneration.js");
const { RegionPanel } = await import("../../src/applications/RegionPanel.js");
const { RegionEditor } = await import("../../src/applications/RegionEditor.js");
const { VectorHistory } = await import("../../src/applications/VectorHistory.js");
const { runGenerator } = await import("../../src/generator/Pipeline.js");
const { MeshSession } = await import("../../src/mesh/MeshSession.js");
const { nestingProblems, paintAllow, settleParentKey } = await import("../../src/mesh/RegionEdits.js");
const { UNCLAIMED, addRegion, createLayerSet, createLevel } = await import("../../src/mesh/Schema.js");
const { typed } = await import("../../src/data/MapRules.js");
const { HEIGHT, WIDTH, syntheticMap } = await import("../generator/synthetic.mjs");

const quick = { pause: () => Promise.resolve() };

beforeEach(() => {
    answers.prompt = null;
});

/** A studio stand-in on the island, with a Custom set of one layer (no Political set yet). */
function studio() {
    const { mesh, buffers, makePayload } = syntheticMap();
    const aggregates = mesh.aggregate({ elevation: buffers.elevation, waterMask: buffers.waterMask, seaLevel: makePayload().seaLevel });
    const level = createLevel({ id: "sketch", name: "Sketch" });
    const custom = createLayerSet({ id: "custom", name: "My regions", levels: [level] });
    const meshSession = new MeshSession({ mesh, meshBlock: { seed: 7, spacing: 4, cells: mesh.cellCount, width: WIDTH, height: HEIGHT, version: 1 }, layerSets: [custom], owners: {}, aggregates });
    return {
        meshSession,
        layerSets: [custom],
        tectonicFaults: [],
        manualRivers: [],
        landMasks: [],
        mapPins: [],
        mapRoutes: [],
        mapLabels: [],
        mapDecorations: [],
        modelRun: null,
        uiState: { customBiomes: [], customRouteStyles: [], customPinStyles: [], customRegionStyles: [] },
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

/** The island's land display cells within a radius of a point. */
function landDisc(app, x, y, radius) {
    const { mesh, aggregates } = app.meshSession;
    const cells = [];
    for (let cell = 0; cell < mesh.cellCount; cell++) if (aggregates.land[cell] === 1 && Math.hypot(mesh.siteX(cell) - x, mesh.siteY(cell) - y) < radius) cells.push(cell);
    return cells;
}

/** Paints a new region of the sketch layer over cells. */
function sketch(app, name, cells) {
    const level = app.layerSets[0].levels[0];
    const region = addRegion(level, { name });
    app.meshSession.ownersChanged(level.id, app.meshSession.layer(level.id).set(cells, region.key));
    return region;
}

const political = (app) => app.layerSets.find((set) => set.kind === "political");
const cellsOf = (app, level, key) => Array.from(app.meshSession.layer(level.id).cellsOf(key)).filter((cell) => app.meshSession.aggregates.land[cell] === 1);
const sorted = (list) => [...list].sort((a, b) => a - b);

/** Generates the island with the map's own regions, as Generate does, and writes the run onto it. */
async function generate(app) {
    const userRegions = Generation.userRegions(app, {});
    const result = await runGenerator({ ...syntheticMap().makePayload(), userRegions }, quick);
    Generation.apply(app, result);
    return { result, userRegions };
}

test("Move to Political set makes a Political set when there is none and moves the region into it, as one undo step", async () => {
    const app = studio();
    const west = landDisc(app, 150, 180, 90);
    const region = sketch(app, "Westmarch", west);
    answers.prompt = "0";
    assert.equal(await RegionPanel.moveToPolitical(app, "sketch", [region.id]), true);

    const set = political(app);
    assert.ok(set, "a Political set");
    assert.deepEqual(set.levels.map((level) => level.name), ["FILRODENSWMB.UI.GeneratedRealms", "FILRODENSWMB.UI.GeneratedDuchies", "FILRODENSWMB.UI.GeneratedCounties"]);
    assert.ok(Regeneration.chain(set), "its three levels nest as a run's");
    assert.ok(app.uiState.customLabelStyles.some((style) => style.id === "label-style-duchy"), "the generated label styles are added");
    const [realms] = set.levels;
    const moved = realms.regions.find((each) => each.id === region.id);
    assert.ok(moved, "the same region, in Realms");
    assert.deepEqual(sorted(cellsOf(app, realms, moved.key)), sorted(west), "with its land");
    assert.equal(app.layerSets[0].levels[0].regions.length, 0, "it left its layer, which stays");
    assert.equal(app.meshSession.layer("sketch").cellsOf(region.key).length, 0);

    VectorHistory.step(app, true);
    assert.equal(political(app), undefined, "undo takes the new set away");
    const back = app.layerSets[0].levels[0].regions.find((each) => each.id === region.id);
    assert.ok(back, "and brings the region back");
    assert.deepEqual(sorted(cellsOf(app, app.layerSets[0].levels[0], back.key)), sorted(west));
    VectorHistory.step(app, false);
    assert.ok(political(app).levels[0].regions.some((each) => each.id === region.id), "redo moves it again");
});

test("a moved region wins its land, clears what lay below it, and belongs to the parent holding most of it", async () => {
    const app = studio();
    await generate(app);
    const set = political(app);
    const [realms, duchies, counties] = set.levels;
    const land = landDisc(app, 300, 170, 45);
    const region = sketch(app, "Marchland", land);
    const generatedBefore = duchies.regions.filter((each) => each.generated).map((each) => each.id);
    answers.prompt = "1";
    await RegionPanel.moveToPolitical(app, "sketch", [region.id]);

    const moved = duchies.regions.find((each) => each.id === region.id);
    const owners = app.meshSession.layer(duchies.id).owners;
    assert.ok(land.every((cell) => owners[cell] === moved.key), "it holds all its land at Duchies");
    assert.ok(land.every((cell) => app.meshSession.layer(counties.id).owners[cell] === UNCLAIMED), "the counties under it are cleared");
    const realmOwners = app.meshSession.layer(realms.id).owners;
    const realmKey = realmOwners[land[0]];
    assert.equal(moved.parentKey, realmKey, "its parent is the realm holding its land");
    const marked = duchies.regions.filter((each) => generatedBefore.includes(each.id) && each.generated.edited);
    assert.deepEqual(marked, [], "the generated duchies it cut are not marked edited");
});

test("a county moved outside every realm stands alone in the Political set, offered Independent, and a Custom set's region may not", async () => {
    const app = studio();
    const westLand = landDisc(app, 150, 180, 90);
    const west = sketch(app, "Westmarch", westLand);
    answers.prompt = "0";
    await RegionPanel.moveToPolitical(app, "sketch", [west.id]);
    const east = sketch(app, "Eastholm", landDisc(app, 340, 180, 40));
    answers.prompt = "2";
    await RegionPanel.moveToPolitical(app, "sketch", [east.id]);
    const set = political(app);
    const [, , counties] = set.levels;
    const county = counties.regions.find((each) => each.id === east.id);
    assert.equal(county.parentKey, null, "in no duchy");
    assert.equal(nestingProblems(app.meshSession, counties).length, 0, "a lone county breaks no nesting in the Political set");

    const context = RegionEditor.KIND.context(app, county, { levelId: counties.id, id: county.id });
    assert.equal(context.independent?.hint, "FILRODENSWMB.UI.RegionIndependentCountyHint", "Independent is offered");
    assert.equal(context.canMoveToPolitical, false, "a Political region is not moved again");
    const westContext = RegionEditor.KIND.context(app, set.levels[0].regions[0], { levelId: set.levels[0].id, id: west.id });
    assert.equal(westContext.independent, null, "a realm has no Independent choice");

    // A new county may be painted on land no duchy holds in the Political set, but not in a Custom set
    const fresh = addRegion(counties, { name: "New" });
    const outside = landDisc(app, 380, 120, 10)[0];
    assert.equal(settleParentKey(app.meshSession, counties, fresh, outside).allowed, true);
    assert.equal(paintAllow(app.meshSession, counties, fresh, outside)(outside), true);
    const customChild = createLevel({ id: "custom-child", name: "Below", parentLevelId: "sketch" });
    app.layerSets[0].levels.push(customChild);
    app.meshSession.setLayerSets(app.layerSets);
    assert.equal(settleParentKey(app.meshSession, customChild, addRegion(customChild, { name: "Child" }), outside).allowed, false);
});

test("a run is built round the moved regions, keeps their painted borders exactly and fills inside them", async () => {
    const app = studio();
    const westLand = landDisc(app, 150, 180, 90);
    const west = sketch(app, "Westmarch", westLand);
    answers.prompt = "0";
    await RegionPanel.moveToPolitical(app, "sketch", [west.id]);
    const eastLand = landDisc(app, 340, 180, 40);
    const east = sketch(app, "Eastholm", eastLand);
    answers.prompt = "2";
    await RegionPanel.moveToPolitical(app, "sketch", [east.id]);
    const set = political(app);
    const [realms, duchies, counties] = set.levels;
    counties.regions.find((each) => each.id === east.id).independent = true;

    const { userRegions, result } = await generate(app);
    assert.deepEqual(userRegions.realms.map((each) => each.key), [realms.regions.find((each) => each.id === west.id).key]);
    assert.equal(userRegions.counties[0].independent, true);
    assert.equal(political(app), set, "the run wrote into the set");
    const realm = realms.regions.find((each) => each.id === west.id);
    const county = counties.regions.find((each) => each.id === east.id);
    assert.deepEqual(sorted(cellsOf(app, realms, realm.key)), sorted(westLand), "the realm keeps exactly its painted land");
    assert.deepEqual(sorted(cellsOf(app, counties, county.key)), sorted(eastLand), "and the county");
    const inside = duchies.regions.filter((each) => each.parentKey === realm.key);
    assert.ok(inside.length > 0, "the run's duchies fill the realm");
    for (const level of [duchies, counties]) assert.equal(nestingProblems(app.meshSession, level).length, 0, `${level.name} nest`);
    assert.ok(set.levels.flatMap((level) => level.regions).every((each) => !("standsFor" in each)), "nothing the run carried is left on the regions");
    assert.equal(county.parentFromRun, true, "the lone county's duchy is the run's");
    const state = result.realms.find((each) => each.kind === "independent" && result.duchies[result.counties.find((c) => c.user === county.key).duchy].realm === result.realms.indexOf(each));
    assert.ok(state, "the ticked county is a state of its own");

    // The next run places the lone county again rather than keeping the duchy it was given
    const kept = Regeneration.keptKeys(set);
    assert.ok(!kept[1].has(county.parentKey), "its duchy is not kept");
    await generate(app);
    assert.deepEqual(sorted(cellsOf(app, counties, county.key)), sorted(eastLand), "a second run keeps it as painted");
    assert.ok(duchies.regions.some((each) => each.key === county.parentKey), "with a parent of the new run's");
});

test("Independent and a run's parent are kept to their rules", () => {
    assert.deepEqual(typed("region", { independent: "yes", parentFromRun: 1 }, { independent: true, parentFromRun: true }), { independent: true, parentFromRun: true });
    assert.deepEqual(typed("region", { independent: false, parentFromRun: true }, {}), { independent: false, parentFromRun: true });
});

test("a whole layer moves as one undo step, and nothing moves when the choice is cancelled", async () => {
    const app = studio();
    const first = sketch(app, "North", landDisc(app, 200, 120, 50));
    const second = sketch(app, "South", landDisc(app, 200, 240, 50));
    answers.prompt = "0";
    assert.equal(await RegionPanel.moveToPolitical(app, "sketch", null), true);
    const [realms] = political(app).levels;
    assert.deepEqual(realms.regions.map((region) => region.id), [first.id, second.id]);
    const steps = app.pinHistory.length;
    VectorHistory.step(app, true);
    assert.equal(app.pinHistory.length, steps - 1, "one step");
    assert.deepEqual(app.layerSets[0].levels[0].regions.map((region) => region.id).sort(), [first.id, second.id].sort());
    answers.prompt = null;
    assert.equal(await RegionPanel.moveToPolitical(app, "sketch", null), false, "cancelled, nothing moves");
});

test("a Political region changes rank within its set as one undo step, offered only the other ranks", async () => {
    const app = studio();
    const land = landDisc(app, 300, 170, 45);
    const region = sketch(app, "Marchland", land);
    answers.prompt = "0";
    await RegionPanel.moveToPolitical(app, "sketch", [region.id]);
    const [realms, duchies] = political(app).levels;
    assert.equal(RegionPanel.canChangeRank(app, realms.id), true);
    assert.equal(RegionPanel.canChangeRank(app, "sketch"), false, "not in a Custom set");
    answers.prompt = "0";
    assert.equal(await RegionPanel.changeRank(app, realms.id, region.id), false, "its own rank is not offered");
    answers.prompt = "1";
    assert.equal(await RegionPanel.changeRank(app, realms.id, region.id), true);
    const duchy = duchies.regions.find((each) => each.id === region.id);
    assert.ok(duchy && !realms.regions.some((each) => each.id === region.id), "now a duchy");
    assert.deepEqual(sorted(cellsOf(app, duchies, duchy.key)), sorted(land), "with its land");
    assert.equal(duchy.parentKey, null, "in no realm: a lone duchy");
    VectorHistory.step(app, true);
    assert.ok(realms.regions.some((each) => each.id === region.id) || political(app).levels[0].regions.some((each) => each.id === region.id), "undo makes it a realm again");
});
