// The Regions tool's pointer input (RegionPainter): Select picks the region under the pointer, a
// drag paints one undo step with the waters that follow it, a refused stroke explains itself,
// Fill previews what it would take, and the docked editor replaces any editor already docked.
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

const { installPlatform, platform } = await import("../../src/platform/index.js");

const notices = [];
const dialogs = { dismissed: [], opened: [] };
let nextId = 0;
installPlatform({
    i18n: { localize: (key) => key, format: (key, data) => `${key} ${JSON.stringify(data)}`, lang: "en" },
    notify: { info: (text) => notices.push(text), warn: (text) => notices.push(text), error: (text) => notices.push(text) },
    utils: { ...platform.utils, randomID: () => `n${++nextId}`, deepClone: (value) => structuredClone(value), mergeObject: (target, source) => Object.assign(target, source) },
    templates: { render: async () => "" },
    fonts: { list: () => [] },
    dialogs: {
        confirm: async () => true,
        prompt: async () => null,
        choose: async (options) => {
            dialogs.opened.push(options);
            return null;
        },
        dismiss: (options) => dialogs.dismissed.push(options),
        attach: () => () => {},
    },
});

const { RegionPainter } = await import("../../src/applications/RegionPainter.js");
const { RegionPanel } = await import("../../src/applications/RegionPanel.js");
const { VectorHistory } = await import("../../src/applications/VectorHistory.js");
const { addRegion, createLayerSet, createLevel } = await import("../../src/mesh/Schema.js");
const { allLevels } = await import("../../src/mesh/LayerTree.js");
const { cellsInRect, smallSession } = await import("../mesh/helpers.mjs");

beforeEach(() => {
    notices.length = 0;
    dialogs.dismissed.length = 0;
    dialogs.opened.length = 0;
});

/** A studio stand-in with one level (claiming 10 px of sea) holding West, painted over x 150-250, and an unpainted East. */
async function studio() {
    const level = createLevel({ id: "realms", name: "Realms", watersPx: 10 });
    const west = addRegion(level, { id: "west", name: "West" });
    addRegion(level, { id: "east", name: "East" });
    const layerSets = [createLayerSet({ id: "set", name: "Political", levels: [level] })];
    const session = await smallSession(layerSets);
    session.layer("realms").paint(cellsInRect(session.mesh, 150, 0, 250, 300), west.key);
    const overlays = { preview: null };
    const app = {
        layerSets,
        meshSession: session,
        activeTool: "regions",
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
        uiState: { customBiomes: [], customRegionStyles: [], customLabelStyles: [], regionPaintMode: "select", brushSize: 10 },
        massEditSelection: { region: new Set() },
        pinHistory: [],
        pinRedoStack: [],
        globalHistoryLedger: [],
        globalRedoLedger: [],
        root: null,
        get regionLevels() {
            return allLevels(this.layerSets);
        },
        _repaintVectors() {},
        markDirty() {},
        view: { render: () => {} },
        canvasEngine: {
            stage: { scale: { x: 1 } },
            app: {},
            updateBrushCursor() {},
            renderRegionLevels() {},
            regionOverlays: {
                setOutline() {},
                setPreview: (arcs) => (overlays.preview = arcs),
            },
        },
    };
    RegionPanel.context(app);
    return { app, session, overlays };
}

const owned = (session, key) => session.layer("realms").owners.filter((owner) => owner === key).length;
const press = { shiftKey: false };

test("Select picks the region under the pointer, and unclaimed ground lets go of it", async () => {
    const { app } = await studio();
    const tool = RegionPainter.tool(app);
    tool.down(200, 150, press);
    assert.equal(app.activeRegionId, "west");
    tool.down(350, 150, press);
    assert.equal(app.activeRegionId, null);
});

test("a drag paints the active region as one undo step, and its waters follow", async () => {
    const { app, session } = await studio();
    RegionPainter.setMode(app, { dataset: { mode: "paint" } });
    RegionPanel.selectRegionById(app, "realms", "east");
    const east = app.layerSets[0].levels[0].regions[1];
    const tool = RegionPainter.tool(app);
    tool.down(110, 100, press);
    tool.move(130, 120, press);
    tool.move(160, 140, press);
    tool.up(160, 140, press);
    const land = session.aggregates.land;
    const owners = session.layer("realms").owners;
    const eastCells = [...owners.keys()].filter((cell) => owners[cell] === east.key);
    assert.ok(eastCells.some((cell) => land[cell] === 1));
    assert.ok(eastCells.some((cell) => land[cell] !== 1), "the coast painted claims the sea beside it");
    assert.equal(app.pinHistory.length, 1, "the stroke and its waters are one step");
    assert.equal(app.pinHistory[0].kind, "composite");
    assert.equal(session.isStroking, false);
    VectorHistory.step(app, true);
    assert.equal(owned(session, east.key), 0, "undone together");
});

test("painting with no region chosen explains itself and changes nothing", async () => {
    const { app } = await studio();
    RegionPainter.setMode(app, { dataset: { mode: "paint" } });
    RegionPainter.tool(app).down(300, 100, press);
    RegionPainter.tool(app).up(300, 100, press);
    assert.deepEqual(notices, ["FILRODENSWMB.UI.WarnNoActiveRegion"]);
    assert.equal(app.pinHistory.length, 0);
});

test("Fill previews the land a click would take once the pointer rests, and clears when it leaves", async () => {
    const { app, overlays } = await studio();
    RegionPanel.selectRegionById(app, "realms", "east");
    RegionPainter.setMode(app, { dataset: { mode: "fill" } });
    app.root = { ownerDocument: { defaultView: globalThis } };
    const tool = RegionPainter.tool(app);
    tool.hover(300, 100, press);
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.ok(overlays.preview?.length > 0, "an outline of the unclaimed land");
    tool.leave();
    assert.deepEqual(overlays.preview, []);
    tool.down(300, 100, press);
    assert.equal(app.pinHistory.length, 1);
});

test("the docked editor makes its region the one painted, and closes any editor already docked", async () => {
    const { app } = await studio();
    RegionPainter.setMode(app, { dataset: { mode: "select" } });
    RegionPainter.tool(app).doubleClick(200, 150, press);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(dialogs.dismissed, [{ placement: "docked" }]);
    assert.equal(dialogs.opened[0].placement, "docked");
    assert.equal(app.activeRegionId, "west");
});
