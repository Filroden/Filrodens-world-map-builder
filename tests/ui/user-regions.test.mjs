// The map's own regions and Generate (RegionPanel.moveToPolitical, Generation.userRegions,
// MaterialiseRegions, Regeneration.merge), on the synthetic island: Move to Political set makes a
// Political set when the map has none and moves a region into it as one undo step; a moved region
// wins its land there, clears what lay below it and takes the parent holding most of it, or none (a
// lone county, which the Political set allows and the Independent field is offered for); a run is
// built round the moved regions and written into the map keeping their painted borders exactly,
// filling inside them and giving a lone region a parent the next run may change; what a run made of
// a drawn region kept on it read only (`modelled`), and a kept generated one refreshed.
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

const { Generation } = await import("../../src/studios/world/app/Generation.js");
const { Regeneration } = await import("../../src/studios/world/app/Regeneration.js");
const { RegionPanel } = await import("../../src/studios/world/app/RegionPanel.js");
const { RegionEditor } = await import("../../src/studios/world/app/RegionEditor.js");
const { GeneratedDetails } = await import("../../src/studios/world/app/GeneratedDetails.js");
const { VectorHistory } = await import("../../src/studios/world/app/VectorHistory.js");
const { runGenerator } = await import("../../src/studios/world/generator/Pipeline.js");
const { MeshSession } = await import("../../src/studios/world/mesh/MeshSession.js");
const { nestingProblems, paintAllow, settleParentKey } = await import("../../src/studios/world/mesh/RegionEdits.js");
const { UNCLAIMED, addRegion, createLayerSet, createLevel } = await import("../../src/studios/world/mesh/Schema.js");
const { typed } = await import("../../src/studios/world/data/MapRules.js");
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
async function generate(app, output = {}) {
    const userRegions = Generation.userRegions(app);
    const payload = syntheticMap().makePayload();
    const result = await runGenerator({ ...payload, settings: { ...payload.settings, output }, userRegions }, quick);
    Generation.apply(app, result, output);
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

    // What the run made of the drawn regions, read only, without making them generated
    assert.ok(!realm.generated && !county.generated, "the drawn regions stay the reader's");
    assert.equal(realm.modelled.kind, "realm");
    assert.equal(realm.modelled.run, app.modelRun.run);
    assert.ok(realm.modelled.population > 0);
    assert.ok(!("edited" in realm.modelled) && !("locked" in realm.modelled));
    assert.equal(county.modelled.kind, "county");
    const rows = GeneratedDetails.forRegion(app, realm);
    assert.ok(rows.some((row) => row.label === "FILRODENSWMB.UI.GeneratedPopulation"));
    assert.equal(rows.find((row) => row.label === "FILRODENSWMB.UI.GeneratedNextRun").value, "FILRODENSWMB.UI.GeneratedKeptRegion");
    // A generated duchy inside, edited, is kept by the next run and refreshed by it
    const duchy = inside[0];
    duchy.generated.edited = true;
    const firstRun = app.modelRun.run;

    // The next run places the lone county again rather than keeping the duchy it was given
    const kept = Regeneration.keptKeys(set);
    assert.ok(!kept[1].has(county.parentKey), "its duchy is not kept");
    await generate(app);
    assert.deepEqual(sorted(cellsOf(app, counties, county.key)), sorted(eastLand), "a second run keeps it as painted");
    assert.ok(duchies.regions.some((each) => each.key === county.parentKey), "with a parent of the new run's");
    assert.notEqual(app.modelRun.run, firstRun);
    assert.equal(realm.modelled.run, app.modelRun.run, "the drawn realm's figures are the new run's");
    assert.equal(duchy.generated.run, app.modelRun.run, "the edited duchy's figures are refreshed");
    assert.equal(duchy.generated.edited, true, "and it is still edited");
    assert.ok(duchies.regions.includes(duchy));
    // Remove generated content takes the figures and leaves the regions
    await Generation.removeGenerated(app);
    assert.ok(!("modelled" in realm) && !("modelled" in county));
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

test("a drawn realm's cultures reach the run: its first rules, a minority is reported in Results, and the region keeps them", async () => {
    const { GeneratePanel } = await import("../../src/studios/world/app/GeneratePanel.js");
    const app = studio();
    const land = landDisc(app, 330, 110, 85);
    const north = sketch(app, "Northreach", land);
    answers.prompt = "0";
    await RegionPanel.moveToPolitical(app, "sketch", [north.id]);
    const realm = political(app).levels[0].regions.find((each) => each.id === north.id);
    const cultures = [
        { id: "hill", name: "Hillfolk", color: "#a0522d", openness: 0.2, homelands: [{ x: 215, y: 175 }] },
        { id: "south", name: "Southrons", color: "#d9a520", openness: 0.8, homelands: [{ x: 300, y: 300 }] },
        { id: "sand", name: "Sandfolk", color: "#2e9e6b", openness: 0.5, habitat: { temperature: [0.68, 1] }, homelands: [{ x: 390, y: 290 }] },
    ];
    app.uiState.cultures = cultures;
    realm.cultures = typed("region", { cultures: [{ culture: "sand", share: null }] }, realm).cultures;
    const userRegions = Generation.userRegions(app);
    assert.deepEqual(userRegions.realms[0].cultures, [{ culture: "sand", share: null }], "the payload carries them");
    const result = await runGenerator({ ...syntheticMap().makePayload({ cultures }), userRegions }, quick);
    Generation.apply(app, result);
    assert.equal(result.realms.find((each) => each.user === realm.key).rulingCulture, 2, "the first culture rules");
    assert.deepEqual(realm.cultures, [{ culture: "sand", share: null }], "the run leaves them on the region");
    const notice = GeneratePanel.results(app).notices.find((each) => each.text === "FILRODENSWMB.UI.GenerateRegionMinorityHeading");
    assert.ok(notice, "Results names the minority");
    assert.equal(notice.items.length, 1);
    assert.match(notice.items[0], /Northreach/);
    assert.ok(typeof app.modelRun.inputs.cultures === "string", "the fingerprint keeps them");
});

test("the duchies and counties a run made inside a drawn realm are the run's: Remove generated content takes them, and the next run makes them again", async () => {
    const app = studio();
    const land = landDisc(app, 150, 180, 90);
    const west = sketch(app, "Westmarch", land);
    answers.prompt = "0";
    await RegionPanel.moveToPolitical(app, "sketch", [west.id]);
    await generate(app);
    const set = political(app);
    const [realms, duchies] = set.levels;
    const realm = realms.regions.find((each) => each.id === west.id);
    const inside = duchies.regions.filter((each) => each.parentKey === realm.key);
    assert.ok(inside.length > 0 && inside.every((each) => each.generated), "the run's duchies fill the drawn realm");
    const kept = Regeneration.keptKeys(set);
    assert.ok(kept[0].has(realm.key), "the drawn realm is kept");
    assert.ok(inside.every((each) => !kept[1].has(each.key)), "its generated duchies are not");
    assert.equal(Generation.userRegions(app).duchies.length, 0, "so the next run is not built round them");

    await Generation.removeGenerated(app);
    assert.ok(political(app).levels[0].regions.some((each) => each.id === west.id), "the drawn realm stays");
    assert.equal(political(app).levels[1].regions.length, 0, "the run's duchies inside it go");
    assert.equal(political(app).levels[2].regions.length, 0, "and its counties");
    assert.deepEqual(sorted(cellsOf(app, political(app).levels[0], realm.key)), sorted(land));

    // A locked generated duchy is kept for itself, not with the duchies beside it
    await generate(app);
    const again = political(app);
    const [duchy, ...beside] = again.levels[1].regions.filter((each) => each.parentKey === realm.key);
    duchy.generated.locked = true;
    const lockedKept = Regeneration.keptKeys(again);
    assert.ok(lockedKept[1].has(duchy.key) && beside.every((each) => !lockedKept[1].has(each.key)), "only the locked duchy");
    assert.equal(lockedKept[2].size, 0, "and none of the counties inside it");
});

test("a run without duchies and counties writes its realms into the Political set the map has, round the drawn realms, rather than a set of its own", async () => {
    const app = studio();
    const land = landDisc(app, 150, 180, 90);
    const west = sketch(app, "Westmarch", land);
    answers.prompt = "0";
    await RegionPanel.moveToPolitical(app, "sketch", [west.id]);
    await generate(app);
    const set = political(app);
    const realm = set.levels[0].regions.find((each) => each.id === west.id);
    const output = { duchies: false, counties: false };
    const { userRegions } = await generate(app, output);
    assert.deepEqual(userRegions.realms.map((each) => each.key), [realm.key], "the run is built round the drawn realm");
    assert.equal(app.layerSets.filter((each) => each.kind === "political").length, 1, "no second Political set");
    assert.equal(political(app), set, "the run wrote into the map's set");
    assert.equal(set.levels.length, 3, "which keeps its levels");
    assert.deepEqual(sorted(cellsOf(app, set.levels[0], realm.key)), sorted(land), "the drawn realm keeps exactly its land");
    assert.ok(set.levels[0].regions.filter((each) => each.generated).length > 0, "the run's realms are beside it");
    assert.equal(set.levels[1].regions.length + set.levels[2].regions.length, 0, "and no duchies or counties are left from the run before");
    for (const level of set.levels.slice(1)) assert.equal(nestingProblems(app.meshSession, level).length, 0, `${level.name} nest`);
});

test("there is only ever one Political set: a run of more levels than it holds adds the levels it lacks, as one undo step", async () => {
    const app = studio();
    const land = landDisc(app, 150, 180, 90);
    const west = sketch(app, "Westmarch", land);
    answers.prompt = "0";
    await RegionPanel.moveToPolitical(app, "sketch", [west.id]);
    await generate(app, { duchies: false, counties: false });
    const set = political(app);
    // A set of realms alone, as a run without duchies would have made it
    for (const level of set.levels.slice(1)) app.meshSession.removeLevelOwners(level.id);
    set.levels.length = 1;
    app.meshSession.setLayerSets(app.layerSets);
    const realmLevel = set.levels[0].id;

    await generate(app);
    assert.equal(app.layerSets.filter((each) => each.kind === "political").length, 1, "still one Political set");
    assert.equal(political(app), set);
    assert.equal(set.levels.length, 3, "with the duchies and counties added");
    assert.equal(set.levels[0].id, realmLevel, "under its own realms");
    assert.equal(set.levels[1].parentLevelId, realmLevel);
    assert.equal(set.levels[2].parentLevelId, set.levels[1].id);
    const realm = set.levels[0].regions.find((each) => each.id === west.id);
    assert.deepEqual(sorted(cellsOf(app, set.levels[0], realm.key)), sorted(land), "the drawn realm keeps its land");
    assert.ok(set.levels[1].regions.some((each) => each.parentKey === realm.key), "and is filled with the run's duchies");
    for (const level of set.levels.slice(1)) assert.equal(nestingProblems(app.meshSession, level).length, 0, `${level.name} nest`);
    VectorHistory.step(app, true);
    assert.equal(political(app).levels.length, 1, "undo takes the added levels away");
});

test("a kept duchy whose realm a run made is left unassigned when that realm goes, so the next run may take it into another", async () => {
    const app = studio();
    const land = landDisc(app, 330, 120, 45);
    const march = sketch(app, "Eastmarch", land);
    answers.prompt = "1";
    await RegionPanel.moveToPolitical(app, "sketch", [march.id]);
    await generate(app);
    const duchy = political(app).levels[1].regions.find((each) => each.id === march.id);
    assert.ok(Number.isInteger(duchy.parentKey) && duchy.parentFromRun, "the run put it in a realm of its own making");
    assert.ok(!Regeneration.keptKeys(political(app))[0].has(duchy.parentKey), "which is not kept with it");
    await Generation.removeGenerated(app);
    assert.equal(duchy.parentKey, null, "unassigned once its realm goes");
    assert.ok(!("parentFromRun" in duchy));
    await generate(app);
    assert.ok(Number.isInteger(duchy.parentKey) && duchy.parentFromRun, "the next run places it again");
});
