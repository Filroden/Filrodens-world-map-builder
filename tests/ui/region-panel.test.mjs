// The Regions panel's controller (RegionPanel): what the panel lists, keeping the set, level and
// region being edited valid, and the level, set and region commands, each one undo step.
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

const { installPlatform, platform } = await import("../../src/platform/index.js");

/** Answers for the next dialogues: confirm and prompt return these (prompt's onSubmit is not run). */
const answers = { confirm: true, prompt: null };
const notices = [];
let nextId = 0;
installPlatform({
    i18n: { localize: (key) => key, format: (key, data) => `${key} ${JSON.stringify(data)}`, lang: "en" },
    notify: { info: (text) => notices.push(text), warn: (text) => notices.push(text), error: (text) => notices.push(text) },
    utils: { ...platform.utils, randomID: () => `n${++nextId}`, deepClone: (value) => structuredClone(value), escapeHtml: (text) => String(text) },
    templates: { render: async () => "" },
    dialogs: { confirm: async () => answers.confirm, prompt: async () => answers.prompt, choose: async () => null, attach: () => () => {} },
});

const { RegionPanel } = await import("../../src/applications/RegionPanel.js");
const { VectorHistory } = await import("../../src/applications/VectorHistory.js");
const { addRegion, createLayerSet, createLevel } = await import("../../src/mesh/Schema.js");
const { allLevels } = await import("../../src/mesh/LayerTree.js");
const { cellsInRect, smallSession } = await import("../mesh/helpers.mjs");

beforeEach(() => {
    answers.confirm = true;
    answers.prompt = null;
    notices.length = 0;
});

/**
 * A studio stand-in holding one set: Realms (West and East, over x 100-250 and 250-400) above
 * Counties (Northwest painted in West's top half; East has no county yet), plus a second, empty set.
 */
async function studio() {
    const realms = createLevel({ id: "realms", name: "Realms", opacity: 1 });
    const west = addRegion(realms, { id: "west", name: "West" });
    const east = addRegion(realms, { id: "east", name: "East" });
    const counties = createLevel({ id: "counties", name: "Counties", parentLevelId: "realms", opacity: 1 });
    const northwest = addRegion(counties, { id: "northwest", name: "Northwest", parentKey: west.key });
    const zones = createLevel({ id: "zones", name: "Zones", opacity: 1 });
    const layerSets = [createLayerSet({ id: "political", name: "Political", levels: [realms, counties, zones] }), createLayerSet({ id: "other", name: "Other" })];
    const session = await smallSession(layerSets);
    session.layer("realms").paint(cellsInRect(session.mesh, 100, 0, 250, 300), west.key);
    session.layer("realms").paint(cellsInRect(session.mesh, 250, 0, 400, 300), east.key);
    session.layer("counties").paint(cellsInRect(session.mesh, 100, 0, 250, 150), northwest.key);

    const app = {
        layerSets,
        meshSession: session,
        activeLayerSetId: null,
        activeLevelId: null,
        activeRegionId: null,
        tectonicFaults: [],
        manualRivers: [],
        landMasks: [],
        mapPins: [],
        mapRoutes: [],
        mapLabels: [],
        mapDecorations: [],
        uiState: { customBiomes: [], customRegionStyles: [] },
        massEditSelection: { region: new Set() },
        pinHistory: [],
        pinRedoStack: [],
        globalHistoryLedger: [],
        globalRedoLedger: [],
        renders: [],
        dirty: false,
        cancelled: false,
        get regionLevels() {
            return allLevels(this.layerSets);
        },
        _repaintVectors() {},
        markDirty() {
            this.dirty = true;
        },
        view: { render: (regions) => app.renders.push(regions) },
        // The overlay itself is the studio's; here the work runs at once, cancelled on request
        async runCancellable(_message, work) {
            const controller = new AbortController();
            if (app.cancelled) controller.abort();
            return work(controller.signal);
        },
    };
    return { app, session };
}

/** A panel control inside a level's row. */
const levelControl = (levelId) => ({ closest: (selector) => (selector === "[data-level-id]" ? { dataset: { levelId } } : null) });

/** A panel control inside a layer set's row. */
const setControl = (setId) => ({ closest: (selector) => (selector === "[data-set-id]" ? { dataset: { setId } } : null) });

/** A panel control inside a region's row. */
const regionControl = (levelId, id) => ({ closest: (selector) => (selector === ".fwmb-list-item" ? { dataset: { id, layerId: levelId } } : null) });

const levelIds = (app) => app.layerSets[0].levels.map((level) => level.id);

test("the panel lists the first set's level tree and settles on its first level", async () => {
    const { app } = await studio();
    const context = RegionPanel.context(app);
    assert.equal(app.activeLayerSetId, "political");
    assert.equal(app.activeLevelId, "realms");
    assert.deepEqual(context.sets.map((set) => [set.id, set.isActive, set.levelCount, set.canMoveUp, set.canMoveDown]), [["political", true, 3, false, true], ["other", false, 0, true, false]]);

    const [realms, counties, zones] = context.levels;
    assert.deepEqual([realms.depth, counties.depth, zones.depth], [0, 1, 0]);
    assert.deepEqual([realms.canMoveUp, realms.canMoveDown, zones.canMoveDown], [false, true, false]);
    assert.equal(counties.canMoveUp || counties.canMoveDown, false, "an only child cannot move");
    assert.ok(counties.unassigned > 0, "East's land and West's lower half have no county");
    assert.equal(counties.problems, 0);
    assert.deepEqual(context.regions.map((region) => region.name), ["East", "West"], "regions are listed by name");
    assert.match(context.regions[0].swatch, /^#/);
});

test("choosing a set, a level and a region keeps the three together", async () => {
    const { app } = await studio();
    RegionPanel.context(app);
    RegionPanel.selectLevelById(app, "counties");
    assert.equal(app.activeLevelId, "counties");
    RegionPanel.selectRegion(app, regionControl("counties", "northwest"));
    assert.equal(app.activeRegionId, "northwest");
    RegionPanel.selectRegion(app, regionControl("counties", "northwest"));
    assert.equal(app.activeRegionId, null, "a second click lets go of the region");

    RegionPanel.selectSetById(app, "other");
    const context = RegionPanel.context(app);
    assert.equal(app.activeLevelId, null, "the other set has no levels");
    assert.deepEqual(context.levels, []);
    assert.equal(app.pinHistory.length, 0, "choosing is not an edit");
});

test("new levels go at the end of the set or below their parent, and each is one undo step", async () => {
    const { app } = await studio();
    RegionPanel.context(app);
    answers.prompt = "Shires";
    const child = await RegionPanel.addChildLevel(app, levelControl("realms"));
    assert.equal(child, app.activeLevelId);
    assert.equal(app.layerSets[0].levels.find((level) => level.id === child).name, "Shires", "a new level is named first");
    assert.deepEqual(levelIds(app), ["realms", "counties", child, "zones"]);
    assert.equal(app.layerSets[0].levels[2].parentLevelId, "realms");

    answers.prompt = "  ";
    assert.equal(await RegionPanel.addLevel(app), null, "no name, no level");
    answers.prompt = "Duchies";
    await RegionPanel.addLevel(app);
    assert.equal(levelIds(app).at(-1), app.activeLevelId);
    assert.equal(app.pinHistory.length, 2);
    VectorHistory.step(app, true);
    VectorHistory.step(app, true);
    assert.deepEqual(levelIds(app), ["realms", "counties", "zones"]);
});

test("moving a level carries its subtree, and a refused move records nothing", async () => {
    const { app } = await studio();
    RegionPanel.context(app);
    RegionPanel.moveLevel(app, levelControl("zones"), -1);
    assert.deepEqual(levelIds(app), ["zones", "realms", "counties"]);
    RegionPanel.moveLevel(app, levelControl("zones"), -1);
    assert.equal(app.pinHistory.length, 1);
});

test("deleting a level asks first, and undo brings it and its cells back", async () => {
    const { app, session } = await studio();
    RegionPanel.context(app);
    const cells = session.layer("realms").owners.slice();
    answers.confirm = false;
    await RegionPanel.deleteLevel(app, levelControl("realms"));
    assert.deepEqual(levelIds(app), ["realms", "counties", "zones"]);

    answers.confirm = true;
    await RegionPanel.deleteLevel(app, levelControl("realms"));
    assert.deepEqual(levelIds(app), ["counties", "zones"]);
    assert.equal(app.layerSets[0].levels[0].parentLevelId, null, "Counties moves up to the top");
    RegionPanel.context(app);
    assert.equal(app.activeLevelId, "counties", "the active level settles on one that exists");

    VectorHistory.step(app, true);
    assert.deepEqual(levelIds(app), ["realms", "counties", "zones"]);
    assert.deepEqual(session.layer("realms").owners, cells);
});

test("deleting a set takes all its levels in one undo step", async () => {
    const { app, session } = await studio();
    RegionPanel.context(app);
    await RegionPanel.deleteSet(app, setControl("political"));
    assert.deepEqual(app.layerSets.map((set) => set.id), ["other"]);
    assert.ok(!session.layers.has("realms"));
    VectorHistory.step(app, true);
    assert.equal(app.layerSets.length, 2);
    assert.ok(session.layers.has("realms"));
});

test("auto-assign fills a child level in one undo step, and a cancelled run records nothing", async () => {
    const { app } = await studio();
    RegionPanel.context(app);
    app.cancelled = true;
    await RegionPanel.autoAssign(app, levelControl("counties"));
    assert.equal(app.pinHistory.length, 0);

    app.cancelled = false;
    await RegionPanel.autoAssign(app, levelControl("counties"));
    assert.equal(app.pinHistory.length, 1);
    assert.equal(notices.length, 1);
    RegionPanel.selectLevelById(app, "counties");
    const counties = RegionPanel.context(app).levels.find((level) => level.id === "counties");
    assert.ok(counties.unassigned > 0, "East's land stays unassigned: it has no county");
});

test("a level's edit applies a new parent and re-parents the level's regions, as one undo step", async () => {
    const { app } = await studio();
    RegionPanel.context(app);
    const counties = app.layerSets[0].levels[1];
    RegionPanel.applyLevelEdit(app, app.layerSets[0], counties, { name: "Shires", titleTemplate: "Shire of {name}", parentLevelId: "zones", nestingMode: "free", visibility: "gm", opacity: 0.5, watersPx: counties.watersPx, style: { ...counties.style, lineThickness: 2.25 } });
    assert.deepEqual(levelIds(app), ["realms", "zones", "counties"]);
    assert.equal(counties.name, "Shires");
    assert.equal(counties.style.lineThickness, 2.25);
    assert.equal(counties.regions[0].parentKey, null, "Zones has no region under Northwest");
    VectorHistory.step(app, true);
    assert.deepEqual(levelIds(app), ["realms", "counties", "zones"]);
    assert.equal(app.layerSets[0].levels[1].name, "Counties");
});

test("new, merged and deleted regions are each one undo step", async () => {
    const { app, session } = await studio();
    RegionPanel.context(app);
    RegionPanel.addRegion(app);
    const added = RegionPanel.activeRegion(app);
    assert.equal(added.fillColor, null, "a new region takes its preset colour");
    assert.equal(app.layerSets[0].levels[0].regions.length, 3);

    answers.prompt = "east";
    const westKey = app.layerSets[0].levels[0].regions.find((region) => region.id === "west").key;
    assert.equal(await RegionPanel.mergeRegion(app, ...RegionPanel.regionIdsOf(regionControl("realms", "west"))), true);
    assert.ok(!session.layer("realms").owners.includes(westKey));
    assert.equal(app.activeRegionId, "east");

    assert.equal(await RegionPanel.deleteRegion(app, "realms", "east"), true);
    assert.deepEqual(app.layerSets[0].levels[0].regions.map((region) => region.id), [added.id]);
    VectorHistory.step(app, true);
    VectorHistory.step(app, true);
    assert.ok(session.layer("realms").owners.includes(westKey));
    assert.equal(app.pinHistory.length, 1, "only the new region's step is left");
});

test("sets move and change visibility from their rows, each one undo step", async () => {
    const { app, session } = await studio();
    RegionPanel.context(app);
    RegionPanel.moveSet(app, setControl("other"), -1);
    assert.deepEqual(app.layerSets.map((set) => set.id), ["other", "political"]);
    assert.equal(session.layerSets, app.layerSets, "the session draws the sets in their new order");
    RegionPanel.moveSet(app, setControl("other"), -1);
    RegionPanel.toggleSetVisibility(app, setControl("political"));
    assert.equal(app.layerSets[1].visibility, "gm");
    assert.equal(app.pinHistory.length, 2, "the refused move records nothing");
    VectorHistory.step(app, true);
    VectorHistory.step(app, true);
    assert.deepEqual(app.layerSets.map((set) => [set.id, set.visibility]), [["political", "all"], ["other", "all"]]);
});

test("deleting the level being painted leaves the map drawn for the level that takes its place", async () => {
    const { describeLevels } = await import("../../src/canvas/RegionLevelLayers.js");
    const { app, session } = await studio();
    RegionPanel.context(app);
    RegionPanel.selectLevelById(app, "counties");
    const drawnFor = (levelId) => describeLevels(session, () => true, levelId).map((entry) => entry.level.id);
    assert.deepEqual(drawnFor("counties"), ["realms", "counties"], "the painted level and its parent");
    await RegionPanel.deleteLevel(app, levelControl("counties"));
    assert.equal(app.activeLevelId, "realms", "settled before the map was redrawn");
    assert.deepEqual(drawnFor("counties"), ["realms", "zones"], "a level that has gone focuses nothing");
});
