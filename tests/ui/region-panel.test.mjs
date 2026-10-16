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
    dialogs: { confirm: async () => answers.confirm, prompt: async () => answers.prompt, choose: async () => null, attach: () => () => {}, dismiss: () => {} },
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

/** The lists as "heading: rows", a row by its name (an add row as its action), for comparing. */
const outline = (app, inspected) => {
    const { sets, levels } = RegionPanel.context(app, inspected);
    const row = (entry) => (entry.type === "naming" ? `naming ${entry.value}` : entry.type === "unassigned" ? `unassigned ${entry.count}` : entry.count === null || entry.count === undefined ? entry.name : `${entry.name} (${entry.count})`);
    const empty = (entry) => (!entry.empty ? [] : entry.empty.key.endsWith("ChooseParentRegion") ? [`(choose in ${entry.empty.name})`] : ["(empty)"]);
    const list = (title, entry) => `${title}: ${[...entry.rows.map(row), ...empty(entry), ...(entry.add ? [`+${entry.add.action}`] : [])].join(", ")}`;
    return [
        list("Sets", sets),
        ...levels.map((entry) => {
            if (entry.type === "addLayer") return entry.levelId ? `+layer below ${entry.name}` : `+layer in ${entry.name}`;
            return list(entry.parentName ? `${entry.name} in ${entry.parentName}` : entry.name, entry);
        }),
    ];
};

test("the lists cascade: sets, the set's top layers, then each layer below filtered to the region chosen above", async () => {
    const { app } = await studio();
    assert.deepEqual(outline(app), ["Sets: Political, Other, +addLayerSet", "Realms in Political: East (0), West (1), +addRegion", "Counties: (choose in Realms)", "+layer below Counties", "Zones in Political: (empty), +addRegion", "+layer below Zones"], "a layer below shows before a region is chosen above, asking for one; each row counts the regions inside it");
    assert.equal(app.activeLayerSetId, "political");

    RegionPanel.selectRegionById(app, "realms", "west");
    assert.deepEqual(outline(app).slice(1, 4), ["Realms in Political: East (0), West (1), +addRegion", "Counties in West: Northwest, +addRegion", "+layer below Counties"]);
    const { levels } = RegionPanel.context(app);
    const counties = levels.find((entry) => entry.id === "counties");
    assert.deepEqual([counties.parentName, counties.add.parentId, counties.add.labelName, counties.hasParent], ["West", "west", "West", true]);
    assert.equal(levels[0].add.labelName, "Political", "a top layer's + Region names its set");
    assert.ok(counties.unassignedCells > 0, "East's land and West's lower half have no county");

    RegionPanel.selectRegionById(app, "realms", "east");
    assert.deepEqual(outline(app)[2], "Counties in East: (empty), +addRegion", "only the chosen parent's children are listed");
    const empty = RegionPanel.context(app).levels.find((entry) => entry.id === "counties").empty;
    assert.deepEqual(empty, { key: "FILRODENSWMB.UI.NoRegionsInParentYet", name: "East" });

    RegionPanel.selectRegionById(app, "counties", "northwest");
    assert.equal(app.regionPath.get("realms"), "west", "choosing a region chooses its parent in the list above");

    RegionPanel.selectSetById(app, "other");
    assert.deepEqual(outline(app), ["Sets: Political, Other, +addLayerSet", "+layer in Other"], "a set without layers offers its first");
});

test("regions without a single parent sit folded in Unassigned at the end of every list of their level", async () => {
    const { app } = await studio();
    const counties = app.layerSets[0].levels[1];
    addRegion(counties, { id: "loose", name: "Loose" });
    RegionPanel.selectRegionById(app, "realms", "east");
    assert.deepEqual(outline(app)[2], "Counties in East: unassigned 1, +addRegion");
    RegionPanel.toggleUnassigned(app, "counties");
    assert.deepEqual(outline(app)[2], "Counties in East: unassigned 1, Loose, +addRegion");
    assert.deepEqual(RegionPanel.listedRegionIds(app, "counties"), ["loose"], "Mass Edit's Select all takes what the list shows");
});

test("each list's chosen row is its tab stop, and the region being painted is worked on", async () => {
    const { app } = await studio();
    RegionPanel.selectRegionById(app, "realms", "west");
    app.uiState.isEditMode = true;
    app.activeTool = "regions";
    const { sets, levels } = RegionPanel.context(app);
    const west = levels[0].rows.find((row) => row.id === "west");
    assert.deepEqual([west.selected, west.working, west.stateWord, west.tabStop], [true, true, "FILRODENSWMB.UI.TreeStatePainting", true]);
    assert.equal(sets.rows.find((row) => row.tabStop)?.id, "political");
    const counties = levels.find((entry) => entry.id === "counties");
    assert.equal(counties.rows[0].tabStop, true, "a list with nothing chosen starts at its first row");
    assert.equal(levels.find((entry) => entry.id === "zones").add.tabStop, true, "an empty list's tab stop is its add row");
});

test("choosing a set, a level and a region keeps the three together", async () => {
    const { app } = await studio();
    RegionPanel.context(app);
    RegionPanel.selectLevelById(app, "counties");
    assert.equal(app.activeLevelId, "counties");
    RegionPanel.selectRegionById(app, "counties", "northwest");
    assert.equal(app.activeRegionId, "northwest");
    RegionPanel.selectRegionById(app, null, null);
    assert.equal(app.activeRegionId, null);
    assert.equal(app.regionPath.has("counties"), false, "letting go of a region forgets it in its list");
    assert.equal(app.regionPath.get("realms"), "west", "the list above keeps its choice");

    RegionPanel.selectSetById(app, "other");
    RegionPanel.context(app);
    assert.equal(app.activeLevelId, null, "the other set has no levels");
    assert.equal(app.pinHistory.length, 0, "choosing is not an edit");
});

test("a new set comes with its top level; a new region in a filtered list is made inside its parent", async () => {
    const { app } = await studio();
    RegionPanel.context(app);
    const set = RegionPanel.createSet(app, "Cultures");
    assert.deepEqual(app.layerSets.map((entry) => entry.name), ["Political", "Other", "Cultures"]);
    assert.deepEqual(app.layerSets[2].levels.map((level) => [level.name, level.parentLevelId]), [['FILRODENSWMB.UI.LayerName {"tier":1}', null]]);
    assert.equal(app.activeLayerSetId, set);

    const made = RegionPanel.createRegion(app, "counties", "Southwest", "west");
    const southwest = app.layerSets[0].levels[1].regions.find((region) => region.id === made.id);
    const westKey = app.layerSets[0].levels[0].regions.find((region) => region.id === "west").key;
    assert.equal(southwest.parentKey, westKey, "made with its parent, not on its first painting");
    assert.deepEqual([app.activeLevelId, app.activeRegionId, app.regionPath.get("realms")], ["counties", made.id, "west"]);
    assert.equal(southwest.fillColor, null, "a new region takes its preset colour");

    assert.equal(app.pinHistory.length, 2);
    VectorHistory.step(app, true);
    VectorHistory.step(app, true);
    assert.equal(app.layerSets.length, 2);
    assert.equal(app.layerSets[0].levels[1].regions.length, 1);
});

test("+ Layer below makes the next layer, named by its tier, with no regions, as one undo step", async () => {
    const { app } = await studio();
    RegionPanel.selectRegionById(app, "counties", "northwest");
    const parishes = RegionPanel.addLayerBelow(app, { levelId: "counties" });
    const level = app.layerSets[0].levels.find((candidate) => candidate.id === parishes);
    assert.deepEqual([level.name, level.parentLevelId, level.regions.length], ['FILRODENSWMB.UI.LayerName {"tier":3}', "counties", 0]);
    assert.deepEqual(levelIds(app), ["realms", "counties", parishes, "zones"], "after its parent's subtree");
    assert.equal(app.activeLevelId, parishes);
    assert.ok(outline(app).includes('FILRODENSWMB.UI.LayerName {"tier":3} in Northwest: (empty), +addRegion'));

    const first = RegionPanel.addLayerBelow(app, { setId: "other" });
    assert.deepEqual(app.layerSets[1].levels.map((candidate) => [candidate.id, candidate.name, candidate.parentLevelId]), [[first, 'FILRODENSWMB.UI.LayerName {"tier":1}', null]]);
    assert.equal(app.pinHistory.length, 2);
    VectorHistory.step(app, true);
    VectorHistory.step(app, true);
    assert.deepEqual(levelIds(app), ["realms", "counties", "zones"]);
});

test("a new map starts with one set holding Layer 1", async () => {
    const [set] = RegionPanel.starterLayerSets();
    assert.deepEqual([set.name, set.levels.map((level) => [level.name, level.parentLevelId])], ["FILRODENSWMB.UI.StarterSetName", [['FILRODENSWMB.UI.LayerName {"tier":1}', null]]]);
});

test("renaming is one undo step, and a new entry's row offers the next free name", async () => {
    const { app } = await studio();
    RegionPanel.context(app);
    assert.equal(RegionPanel.rename(app, "level:zones", "Zones"), false, "the same name changes nothing");
    assert.equal(RegionPanel.rename(app, "level:zones", "Climate zones"), true);
    assert.equal(RegionPanel.rename(app, "set:political", "Politics"), true);
    assert.equal(RegionPanel.rename(app, "region:west", "Westmarch"), true);
    assert.deepEqual([app.layerSets[0].name, app.layerSets[0].levels[2].name, app.layerSets[0].levels[0].regions.find((region) => region.id === "west").name], ["Politics", "Climate zones", "Westmarch"]);
    assert.equal(app.pinHistory.length, 3);
    VectorHistory.step(app, true);
    assert.equal(app.layerSets[0].levels[0].regions.find((region) => region.id === "west").name, "West");

    assert.equal(RegionPanel.suggestedName(app, "set"), "FILRODENSWMB.UI.NewSetName");
    app.layerSets[1].name = "FILRODENSWMB.UI.NewSetName";
    assert.equal(RegionPanel.suggestedName(app, "set"), "FILRODENSWMB.UI.NewSetName 2");
    app.regionNaming = { kind: "region", levelId: "zones", value: "Coast" };
    assert.ok(outline(app).includes("Climate zones in Politics: naming Coast, +addRegion"), "the naming row takes the place of the empty state");
    app.regionNaming = { kind: "rename", key: "region:east", value: "East" };
    assert.ok(outline(app)[1].startsWith("Realms in Politics: naming East, "), "a row being renamed is named in place");
    app.regionNaming = { kind: "rename", key: "level:zones", value: "Zones" };
    assert.equal(RegionPanel.context(app).levels.find((entry) => entry.id === "zones").renaming.value, "Zones", "a level is renamed in its heading");
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
    RegionPanel.selectRegionById(app, "realms", "west");
    const counties = RegionPanel.context(app).levels.find((entry) => entry.id === "counties");
    assert.ok(counties.unassignedCells > 0, "East's land stays unassigned: it has no county");
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
    const added = RegionPanel.createRegion(app, "realms", "North");
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

test("an entry named in its row is made on Enter, and Escape or an empty name makes nothing", async () => {
    const { RegionLists } = await import("../../src/applications/RegionLists.js");
    const { app } = await studio();
    RegionPanel.selectRegionById(app, "realms", "east");

    await RegionLists.startNaming(app, "region", { levelId: "counties", parentId: "east" });
    assert.equal(app.regionNaming.value, "FILRODENSWMB.UI.NewRegionName", "the next free name is offered");
    await RegionLists.cancel(app);
    assert.equal(app.regionNaming, null);
    assert.equal(app.pinHistory.length, 0, "Escape records nothing");

    await RegionLists.startNaming(app, "region", { levelId: "counties", parentId: "east" });
    assert.equal(await RegionLists.confirm(app, "   "), null, "an empty name makes nothing");
    assert.equal(app.pinHistory.length, 0);

    await RegionLists.startNaming(app, "region", { levelId: "counties", parentId: "east" });
    const key = await RegionLists.confirm(app, "  Eastmoor ");
    const eastmoor = app.layerSets[0].levels[1].regions.at(-1);
    assert.deepEqual([key, eastmoor.name, app.activeRegionId], [`region:${eastmoor.id}`, "Eastmoor", eastmoor.id], "a new region is the one being painted");

    await RegionLists.startRename(app, "set:political");
    assert.equal(app.regionNaming.value, "Political", "a rename starts from the name it has");
    await RegionLists.confirm(app, "Politics");
    assert.equal(app.layerSets[0].name, "Politics");
    assert.equal(app.pinHistory.length, 2, "each entry and rename is one undo step");
});
