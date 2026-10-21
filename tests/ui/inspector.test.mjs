// The inspector (src/applications/Inspector.js) with its region and route kinds (RegionEditor,
// RouteEditor), drawn from the real templates in a happy-dom document: changes apply at once, one
// undo step each, and only when something changed; a text field applies on Enter or when left,
// never per keystroke; a style picked fills its fields, a styled field changed makes the object
// Custom, and Save as… makes a style and connects the object to it; the inspector follows undo and
// closes when its object goes or the tool changes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import Handlebars from "handlebars";
import { Window } from "happy-dom";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const window = new Window({ url: "http://localhost/" });
// The page's globals as a browser has them, for idiomorph (see studio-view.test.mjs)
for (const name of Object.getOwnPropertyNames(window)) {
    if (/^[A-Z]/.test(name) && !(name in globalThis)) globalThis[name] = window[name];
}
Object.assign(globalThis, { window, document: window.document });
after(() => window.happyDOM.close());
const document = window.document;

const { installPlatform, platform } = await import("../../src/platform/index.js");
const { createWebTemplates, registerHelpers } = await import("../../src/platform/web/templates.js");
const { Overlay } = await import("../../src/ui/Overlay.js");

const i18n = { localize: (key) => key, format: (key, data) => `${key} ${JSON.stringify(data)}`, lang: "en" };
const handlebars = Handlebars.create();
registerHelpers(handlebars, i18n);
const templates = createWebTemplates({ handlebars, prefix: "modules/filrodens-world-map-builder/templates/", fetchText: async (path) => readFileSync(join(ROOT, "templates", path), "utf8") });
await templates.load(["parts/section.hbs", "parts/shared-range.hbs", "parts/style-picker.hbs", "parts/font-picker.hbs", "parts/face-fields.hbs", "parts/label-fields.hbs", "parts/inspector-generated.hbs", "parts/inspector-pin.hbs", "parts/inspector-label.hbs", "parts/inspector-region.hbs", "parts/inspector-route.hbs", "parts/inspector-river.hbs", "parts/inspector-fault.hbs", "parts/inspector-decoration.hbs", "parts/inspector-land-mask.hbs", "parts/inspector-level.hbs", "parts/inspector-set.hbs"]);

/** What the next prompt (Save as…'s name) answers. */
const answers = { prompt: null };
let host = null;
let nextId = 0;
installPlatform({
    i18n,
    notify: { info: () => {}, warn: () => {}, error: () => {} },
    utils: { ...platform.utils, randomID: () => `n${++nextId}`, deepClone: (value) => structuredClone(value), mergeObject: (target, source) => Object.assign(target, source), escapeHtml: (text) => handlebars.escapeExpression(text) },
    templates,
    fonts: { list: () => ["Signika", "Noto Serif", "EB Garamond"] },
    settings: { get: () => [] },
    assets: { url: (path) => path, path: (path) => path },
    dialogs: {
        confirm: async () => true,
        prompt: async () => answers.prompt,
        choose: async () => null,
        dismiss: ({ placement } = {}) => host && Overlay.dismissAll(host, placement),
        attach: () => () => {},
    },
});

const { FILRODENSWMB } = await import("../../src/config.js");
const { Inspector } = await import("../../src/applications/Inspector.js");
const { RegionEditor } = await import("../../src/applications/RegionEditor.js");
const { RouteEditor } = await import("../../src/applications/RouteEditor.js");
const { RouteTool } = await import("../../src/applications/RouteTool.js");
const { PinEditor } = await import("../../src/applications/PinEditor.js");
const { LabelEditor } = await import("../../src/applications/LabelEditor.js");
const { PickTool } = await import("../../src/applications/PickTool.js");
const { DecorationEditor, FaultEditor, LandMaskEditor, RiverEditor } = await import("../../src/applications/FeatureEditors.js");
const { LayerSetEditor, LevelEditor } = await import("../../src/applications/LayerEditors.js");
const { VectorHistory } = await import("../../src/applications/VectorHistory.js");
const { addRegion, createLayerSet, createLevel } = await import("../../src/mesh/Schema.js");
const { allLevels } = await import("../../src/mesh/LayerTree.js");
const { cellsInRect, smallSession } = await import("../mesh/helpers.mjs");

beforeEach(() => {
    answers.prompt = null;
    document.body.innerHTML = "";
});

/** A studio stand-in with one level (West and East painted) and the Routes tool's settings. */
async function studio() {
    const realms = createLevel({ id: "realms", name: "Realms", opacity: 1 });
    addRegion(realms, { id: "west", name: "West", quickStyle: "custom" });
    addRegion(realms, { id: "east", name: "East", quickStyle: "custom" });
    const layerSets = [createLayerSet({ id: "political", name: "Political", levels: [realms] })];
    const session = await smallSession(layerSets);
    session.layer("realms").paint(cellsInRect(session.mesh, 100, 0, 250, 300), realms.regions[0].key);
    session.layer("realms").paint(cellsInRect(session.mesh, 250, 0, 400, 300), realms.regions[1].key);
    host = document.body.appendChild(document.createElement("div"));
    const app = {
        root: host,
        layerSets,
        meshSession: session,
        activeTool: "infrastructure",
        activeLayerSetId: "political",
        activeLevelId: "realms",
        activeRegionId: null,
        activeRouteId: null,
        tectonicFaults: [{ id: "spine", name: "Spine", type: "range", style: "fold", thickness: 120, strength: 0.6, color: "#aa0000", points: [{ x: 120, y: 200 }, { x: 260, y: 200 }] }],
        manualRivers: [{ id: "silver", name: "Silver", width: 4, points: [{ x: 100, y: 60 }, { x: 300, y: 60 }] }],
        landMasks: [{ id: "isle", name: "Isle", operation: "add", points: [{ x: 300, y: 300 }, { x: 380, y: 300 }, { x: 380, y: 380 }, { x: 300, y: 380 }] }],
        terrainUpdates: 0,
        requestTerrainUpdate() {
            this.terrainUpdates++;
        },
        mapPins: [{ id: "keep", name: "Old Keep", x: 150, y: 100, icon: "castle", scale: 1, color: "#ffffff", pinStyle: null, label: { quickStyle: "custom" } }],
        mapRoutes: [],
        mapLabels: [{ id: "sea", name: "Grey Sea", x: 50, y: 150, rotation: 0, quickStyle: "custom", fontFamily: "Noto Serif", fontSize: 1, fillColor: "#ffffff", maxChars: 0, justify: "left", visibility: "all" }],
        mapDecorations: [{ id: "rose", name: "Rose", src: "rose.webp", x: 40, y: 40, scale: 1, rotation: 0, opacity: 1 }],
        _expandedSections: new Set(),
        _collapsedSections: new Set(),
        uiState: {
            isEditMode: true,
            activeInfraMode: "route",
            routeToolMode: "draw",
            routeDetail: 1,
            routeColor: "#ff0000",
            routeThickness: 2,
            routeStyle: "solid",
            routeOutline: true,
            routeSmoothing: false,
            routeMode: "terrain",
            routeTransport: "road",
            activeRouteQuickStyle: "custom",
            customRouteStyles: [{ id: "trade", name: "Trade", color: "#00ff00", thickness: 3.5, style: "dashed", outline: false, smoothing: true }],
            customPinStyles: [{ id: "city", name: "City", icon: "star", scale: 2, color: "#ffcc00", label: { fontSize: 1.5, visibility: "all", quickStyle: "realm" }, detailLevel: 3 }],
            customRegionStyles: [{ id: "kingdom", name: "Kingdom", fillColor: "#aa3322", fillStyle: "diagonal" }],
            customLabelStyles: [{ id: "realm", name: "Realm", fontFamily: "Noto Serif", fontSize: 2, fillColor: "#112233", maxChars: 12, justify: "center", bold: false, italic: true }],
            customBiomes: [],
            labelFontFamily: "Signika",
            labelFontSize: 1,
            labelFillColor: "#ffffff",
            labelMaxChars: 0,
            labelJustify: "left",
        },
        get regionLevels() {
            return allLevels(this.layerSets);
        },
        pinHistory: [],
        pinRedoStack: [],
        globalHistoryLedger: [],
        globalRedoLedger: [],
        rendered: [],
        _repaintVectors() {},
        markDirty() {},
        view: { render: (regions) => app.rendered.push(...regions) },
        canvasEngine: { stage: { scale: { x: 1 } }, app: {}, routeOverlays: { setDraft() {}, setHandles() {} }, zoomToFeature() {} },
    };
    return { app, session };
}

/** Places a road across the land by clicks in Draw mode, finished with Enter. */
function placeRoad(app) {
    const tool = RouteTool.tool(app);
    const press = { shiftKey: false, ctrlKey: false, altKey: false, metaKey: false };
    for (const [x, y] of [[150, 50], [250, 150], [350, 250]]) {
        tool.down(x, y, press);
        tool.up(x, y, press);
    }
    RouteTool.handleKey(app, { key: "Enter" });
    return app.mapRoutes.at(-1);
}

/** The open inspector's form and a field of it by name. */
const form = (app) => app.root.querySelector("dialog.fwmb-inspector .fwmb-overlay-body");
const field = (app, name) => form(app).elements[name];

/** Sets a field's value (or checkbox) and commits it, as the reader would. */
async function commit(app, name, value) {
    const input = field(app, name);
    if (input.type === "checkbox") input.checked = value;
    else input.value = value;
    input.dispatchEvent(new window.Event("change", { bubbles: true }));
    await settle();
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const steps = (app) => app.pinHistory.length;

test("a region opens with its fields, its name and level in the header, and becomes the one painted", async () => {
    const { app } = await studio();
    assert.equal(await RegionEditor.open(app, "realms", "west"), true);
    const dialog = app.root.querySelector("dialog.fwmb-inspector");
    assert.ok(dialog.classList.contains("fwmb-overlay-docked"));
    assert.equal(dialog.querySelector(".fwmb-overlay-header h2").textContent, "West");
    assert.match(dialog.querySelector(".fwmb-overlay-header .fwmb-kind").textContent, /Realms/);
    assert.equal(field(app, "regionName").value, "West");
    assert.equal(app.activeRegionId, "west");
    assert.equal(dialog.querySelector(".fwmb-overlay-footer").hidden, true, "no Save or Cancel");
});

test("a field applies when committed, as one undo step, and only when it changed something", async () => {
    const { app } = await studio();
    await RegionEditor.open(app, "realms", "west");
    const region = app.regionLevels[0].regions[0];

    await commit(app, "regionVisibility", "gm");
    assert.equal(region.visibility, "gm");
    assert.equal(steps(app), 1);

    // The same value committed again (Enter, then leaving the field) records nothing
    await commit(app, "regionVisibility", "gm");
    assert.equal(steps(app), 1);

    VectorHistory.step(app, true);
    await Inspector.refresh(app);
    assert.equal(app.regionLevels[0].regions[0].visibility ?? "all", "all");
    assert.equal(field(app, "regionVisibility").value, "all", "the inspector follows the undo");
});

test("a text field applies on Enter or when left, never per keystroke, and renames the header", async () => {
    const { app } = await studio();
    await RegionEditor.open(app, "realms", "west");
    const name = field(app, "regionName");
    name.value = "Westmarch";
    name.dispatchEvent(new window.Event("input", { bubbles: true }));
    assert.equal(app.regionLevels[0].regions[0].name, "West", "typing changes nothing");
    assert.equal(steps(app), 0);

    name.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await settle();
    assert.equal(app.regionLevels[0].regions[0].name, "Westmarch");
    assert.equal(steps(app), 1);
    assert.equal(app.root.querySelector(".fwmb-inspector .fwmb-overlay-header h2").textContent, "Westmarch");

    // Leaving the field afterwards commits the same value: nothing more
    name.dispatchEvent(new window.Event("change", { bubbles: true }));
    await settle();
    assert.equal(steps(app), 1);
});

test("picking a style fills its fields, and a styled field changed makes the object Custom", async () => {
    const { app } = await studio();
    await RegionEditor.open(app, "realms", "west");
    const region = app.regionLevels[0].regions[0];

    await commit(app, "regionQuickStyle", "kingdom");
    assert.deepEqual([region.quickStyle, region.fillColor, region.fillStyle], ["kingdom", "#aa3322", "diagonal"]);
    assert.equal(field(app, "regionFillStyle").value, "diagonal", "the style's fields show at once");
    assert.ok(form(app).querySelector(".fwmb-badge--style")?.textContent.includes("Kingdom"));

    await commit(app, "regionFillStyle", "solid");
    assert.equal(region.quickStyle, "custom");
    assert.equal(field(app, "regionQuickStyle").value, "custom");
    assert.equal(steps(app), 2);
});

test("the label's style works the same way, inside the label section", async () => {
    const { app } = await studio();
    await RegionEditor.open(app, "realms", "west");
    const region = app.regionLevels[0].regions[0];
    await commit(app, "labelQuickStyle", "realm");
    assert.deepEqual([region.label.quickStyle, region.label.fontFamily, region.label.fontSize, region.label.justify], ["realm", "Noto Serif", 2, "center"]);
    await commit(app, "labelFillColor", "#ffffff");
    assert.equal(region.label.quickStyle, "custom");
    assert.equal(region.label.fontFamily, "Noto Serif", "the rest of the label stays as the style left it");
});

test("Save as… makes a style from the object's fields and connects the object to it", async () => {
    const { app } = await studio();
    await RegionEditor.open(app, "realms", "west");
    await commit(app, "regionFillColor", "#336699");
    answers.prompt = "Sea kingdom";
    form(app).querySelector('[data-inspector-action="saveStyle"][data-style-type="Region"]').click();
    await settle();
    await settle();
    const style = app.uiState.customRegionStyles.at(-1);
    assert.deepEqual([style.name, style.fillColor, style.fillStyle], ["Sea kingdom", "#336699", "solid"]);
    assert.equal(app.regionLevels[0].regions[0].quickStyle, style.id);
    assert.equal(field(app, "regionQuickStyle").value, style.id);

    // No name given: nothing is made
    const count = app.uiState.customRegionStyles.length;
    answers.prompt = null;
    form(app).querySelector('[data-inspector-action="saveStyle"][data-style-type="Region"]').click();
    await settle();
    assert.equal(app.uiState.customRegionStyles.length, count);
});

test("the inspector closes when its object goes, and when anything else is docked (a tool switch)", async () => {
    const { app } = await studio();
    await RegionEditor.open(app, "realms", "west");
    form(app).querySelector('[data-inspector-action="delete"]').click();
    await settle();
    await settle();
    await settle();
    assert.equal(app.regionLevels[0].regions.some((region) => region.id === "west"), false);
    assert.equal(Inspector.current(app), null);
    assert.equal(app.root.querySelector("dialog.fwmb-inspector"), null);

    await RegionEditor.open(app, "realms", "east");
    platform.dialogs.dismiss({ placement: "docked" });
    await settle();
    assert.equal(Inspector.current(app), null);
});

test("opening another object replaces the one shown", async () => {
    const { app } = await studio();
    await RegionEditor.open(app, "realms", "west");
    await RegionEditor.open(app, "realms", "east");
    assert.equal(app.root.querySelectorAll("dialog.fwmb-inspector").length, 1);
    assert.ok(Inspector.shows(app, "region", "east"));
});

test("a route's line fields apply one step each; its Trace detail is the bar's setting, not the route's", async () => {
    const { app } = await studio();
    const route = placeRoad(app);
    const before = steps(app);
    await RouteEditor.open(app, route.id);
    assert.equal(field(app, "routeName").value, route.name);

    await commit(app, "routeThickness", "4");
    assert.equal(route.thickness, 4);
    assert.equal(steps(app), before + 1);

    await commit(app, "routeQuickStyle", "trade");
    assert.deepEqual([route.quickStyle, route.color, route.thickness, route.style, route.outline, route.smoothing], ["trade", "#00ff00", 3.5, "dashed", false, true]);
    await commit(app, "routeOutline", true);
    assert.equal(route.quickStyle, "custom");
    assert.equal(steps(app), before + 3);

    await commit(app, "routeDetail", "4");
    assert.equal(app.uiState.routeDetail, 4);
    assert.equal(steps(app), before + 3, "the Trace detail is not an undo step");
});

test("Simplify and Re-path are one undo step each", async () => {
    const { app } = await studio();
    const route = placeRoad(app);
    await RouteEditor.open(app, route.id);
    const before = steps(app);
    form(app).querySelector('[data-inspector-action="repath"]').click();
    await settle();
    form(app).querySelector('[data-inspector-action="simplify"]').click();
    await settle();
    assert.equal(steps(app), before + 2);
});

test("a pin's style writes its look and label onto it; a colour or icon chosen by hand leaves the style", async () => {
    const { app } = await studio();
    const pin = app.mapPins[0];
    await PinEditor.open(app, "keep");
    assert.equal(field(app, "pinName").value, "Old Keep");

    await commit(app, "pinStyle", "city");
    assert.deepEqual([pin.pinStyle, pin.icon, pin.scale, pin.color, pin.label.fontSize, pin.label.quickStyle, pin.label.fontFamily], ["city", "star", 2, "#ffcc00", 1.5, "realm", "Noto Serif"]);
    assert.ok(form(app).querySelector('[data-icon="star"][aria-selected="true"]'), "the style's icon is the one shown chosen");

    await commit(app, "pinColor", "#00ff00");
    assert.equal(pin.pinStyle, null);
    await commit(app, "pinStyle", "city");
    form(app).querySelector('[data-inspector-action="pickIcon"][data-icon="castle"]').click();
    await settle();
    await settle();
    assert.deepEqual([pin.icon, pin.pinStyle], ["castle", null]);
    assert.equal(steps(app), 4);
});

test("Save as… makes a pin style of the pin's look and label size, and the pin follows it", async () => {
    const { app } = await studio();
    const pin = app.mapPins[0];
    await PinEditor.open(app, "keep");
    answers.prompt = "Keep";
    form(app).querySelector('[data-inspector-action="saveStyle"][data-style-type="Pin"]').click();
    await settle();
    await settle();
    const style = app.uiState.customPinStyles.at(-1);
    assert.deepEqual([style.name, style.icon, style.scale, style.color], ["Keep", "castle", 1, "#ffffff"]);
    assert.equal(pin.pinStyle, style.id);
});

test("a standalone label's text, face and style apply one step each; Bold and Italic are label fields", async () => {
    const { app } = await studio();
    const label = app.mapLabels[0];
    await LabelEditor.open(app, { type: "custom", id: "sea" });
    assert.equal(field(app, "labelName").value, "Grey Sea");
    assert.equal(field(app, "labelBold").checked, true, "a label without Bold is drawn bold, as labels always were");

    await commit(app, "labelItalic", true);
    assert.equal(label.italic, true);
    await commit(app, "labelBold", false);
    assert.equal(label.bold, false);
    await commit(app, "labelQuickStyle", "realm");
    assert.deepEqual([label.quickStyle, label.fontSize, label.bold, label.italic, label.justify], ["realm", 2, false, true, "center"]);
    await commit(app, "labelBold", true);
    assert.equal(label.quickStyle, "custom", "Bold is styled, so changing it leaves the style");
    assert.equal(steps(app), 4);
    assert.ok(form(app).querySelector('[data-inspector-action="delete"]'), "a standalone label can be deleted here");
});

test("the font picker groups the fonts, each named in its own face", async () => {
    const { app } = await studio();
    await LabelEditor.open(app, { type: "custom", id: "sea" });
    const picker = field(app, "labelFontFamily");
    const groups = [...picker.querySelectorAll("optgroup")].map((group) => group.label);
    assert.deepEqual(groups, ["FILRODENSWMB.UI.FontCategoryBook", "FILRODENSWMB.UI.FontCategoryWide", "FILRODENSWMB.UI.FontCategoryOther"]);
    assert.match(picker.querySelector('option[value="EB Garamond"]').getAttribute("style"), /font-family: "EB Garamond"/);
    assert.equal(picker.value, "Noto Serif");
});

test("an owned label shows its owner, links to it and has no Delete; its fields are the owner's label", async () => {
    const { app } = await studio();
    const pin = app.mapPins[0];
    await LabelEditor.open(app, { type: "pin", id: "keep" });
    assert.ok(form(app).querySelector(".fwmb-inspector-owner").textContent.includes("Old Keep"));
    assert.equal(form(app).querySelector('[data-inspector-action="delete"]'), null);
    await commit(app, "labelVisibility", "gm");
    assert.equal(pin.label.visibility, "gm");

    app._onChangeTool = (_event, target) => (app.activeTool = target.dataset.tool);
    app.activeTool = "labels";
    form(app).querySelector('[data-inspector-action="goToOwner"]').click();
    await settle();
    await settle();
    assert.equal(app.activeTool, "infrastructure");
    assert.ok(Inspector.shows(app, "pin", "keep"));
});

test("a pin's label fields apply to the pin's label, one step each", async () => {
    const { app } = await studio();
    const pin = app.mapPins[0];
    await PinEditor.open(app, "keep");
    await commit(app, "labelFontSize", "2.5");
    await commit(app, "labelItalic", true);
    await commit(app, "labelFillColor", "#123456");
    await commit(app, "labelFontFamily", "EB Garamond");
    assert.deepEqual([pin.label.fontSize, pin.label.italic, pin.label.fillColor, pin.label.fontFamily], [2.5, true, "#123456", "EB Garamond"]);
    assert.equal(steps(app), 4);
});

test("a double-click returns a slider to its default and applies it, before the studio's own reset runs", async () => {
    const { app } = await studio();
    const pin = app.mapPins[0];
    await PinEditor.open(app, "keep");
    await commit(app, "labelFontSize", "3");
    const slider = field(app, "labelFontSize");
    assert.equal(slider.dataset.default, "1", "the slider's default is its value when the inspector opened");
    // The studio's handler (StudioView) listens further up and would reset the slider later in the event
    let resetLater = null;
    app.root.addEventListener("dblclick", (event) => (resetLater = event.target.value));
    slider.dispatchEvent(new window.MouseEvent("dblclick", { bubbles: true }));
    assert.equal(pin.label.fontSize, 1, "applied at once, from the reset value");
    assert.equal(resetLater, "1", "already reset when the studio's handler sees it");
    assert.equal(form(app).querySelector('input[name="labelFontSize"]').closest(".fwmb-range").querySelector("output").value, "1", "the value shown follows");
    assert.equal(steps(app), 2);
});

/** The canvas's items for PickTool: a pin and a label, each with its reach. */
function pickable(app) {
    const items = [
        { entityType: "pin", entityId: "keep", x: 150, y: 100, radius: 10 },
        { entityType: "label", entityId: "sea", parentType: "custom", x: 50, y: 150, radius: 20 },
        { entityType: "label", entityId: "keep", parentType: "pin", x: 170, y: 80, radius: 10 },
    ];
    app.canvasEngine.hitTest = (x, y, type) => items.find((item) => item.entityType === type && Math.hypot(item.x - x, item.y - y) <= item.radius) ?? null;
}

test("pins and labels have Select (the default) and Place; Select picks without editing, Place edits", () => {
    const { app } = { app: { activeTool: "labels", uiState: { activeInfraMode: "pin" } } };
    assert.equal(PickTool.mode(app), "select");
    assert.deepEqual(PickTool.toolbarModes(app).map((entry) => [entry.value, entry.active, entry.icon]), [["select", true, "select"], ["place", false, "insert-text"]]);
    assert.equal(PickTool.setMode(app, "place"), true);
    assert.equal(PickTool.mode(app), "place");
    assert.equal(PickTool.tool(app), null, "Place leaves the map to placing and moving");
    app.activeTool = "infrastructure";
    assert.equal(PickTool.mode(app), "select", "each tool keeps its own mode");
    app.uiState.activeInfraMode = "route";
    assert.equal(PickTool.which(app), null, "Route mode has its own Select (RouteTool)");
    assert.equal(PickTool.setMode(app, "place"), false);
    app.activeTool = "infrastructure";
    app.uiState.activeInfraMode = "pin";
    PickTool.settleForEditing(app);
    assert.equal(PickTool.mode(app), "place", "editing starts in Place");
});

test("in Select, a click on a pin or label opens it, a click away or Escape closes it", async () => {
    const { app } = await studio();
    pickable(app);
    app.activeTool = "infrastructure";
    app.uiState.activeInfraMode = "pin";
    app.uiState.isEditMode = false;
    const tool = PickTool.tool(app);
    tool.down(152, 98);
    await settle();
    await settle();
    assert.ok(Inspector.shows(app, "pin", "keep"));
    tool.down(400, 400);
    assert.equal(Inspector.current(app), null);
    assert.equal(steps(app), 0, "picking changes nothing");

    app.activeTool = "labels";
    tool.doubleClick(170, 80);
    await settle();
    await settle();
    assert.deepEqual(Inspector.current(app)?.ref, { type: "pin", id: "keep", layerId: null }, "a pin's label opens as the pin's label");
    assert.ok(form(app).querySelector('[data-inspector-action="goToOwner"]'));
    assert.equal(PickTool.handleKey(app, { key: "Escape" }), true);
    assert.equal(Inspector.current(app), null);
    assert.equal(PickTool.handleKey(app, { key: "Escape" }), false, "nothing left to close");
});

test("a river's name and width apply one step each; only a new width carves the terrain again", async () => {
    const { app } = await studio();
    const river = app.manualRivers[0];
    await RiverEditor.open(app, "silver");
    await commit(app, "riverName", "Silverrun");
    assert.equal(app.terrainUpdates, 0);
    await commit(app, "riverWidth", "8");
    assert.deepEqual([river.name, river.width, app.terrainUpdates, steps(app)], ["Silverrun", 8, 1, 2]);
});

test("a fault's type shows that type's settings at their defaults, drops the old ones, and shapes the terrain", async () => {
    const { app } = await studio();
    const fault = app.tectonicFaults[0];
    app.uiState.terrainVersion = FILRODENSWMB.TERRAIN_VERSION.CURRENT;
    await FaultEditor.open(app, "spine");
    assert.ok(field(app, "faultStyle"), "a range shows its style");
    await commit(app, "faultDesc", "The old mountains");
    assert.equal(app.terrainUpdates, 0, "a description is only words");
    await commit(app, "faultType", "hotspot");
    assert.equal(fault.type, "hotspot");
    assert.equal(fault.style, undefined, "the range's style goes");
    assert.ok(fault.spacing > 0, "a hotspot's settings start at their defaults");
    assert.ok(field(app, "spacing") && !field(app, "faultStyle"), "the inspector shows the new type's settings");
    await commit(app, "spacing", "2");
    assert.deepEqual([fault.spacing, app.terrainUpdates, steps(app)], [2, 2, 3]);
});

test("a decoration's look applies one step each; a land mask's type shapes the land again", async () => {
    const { app } = await studio();
    await DecorationEditor.open(app, "rose");
    await commit(app, "decorationOpacity", "0.5");
    await commit(app, "decorationVisibility", "gm");
    assert.deepEqual([app.mapDecorations[0].opacity, app.mapDecorations[0].visibility, app.mapDecorations[0].scale], [0.5, "gm", 1]);

    await LandMaskEditor.open(app, "isle");
    await commit(app, "maskName", "Isle of Mist");
    assert.equal(app.terrainUpdates, 0);
    await commit(app, "maskOperation", "subtract");
    assert.deepEqual([app.landMasks[0].name, app.landMasks[0].operation, app.terrainUpdates, steps(app)], ["Isle of Mist", "subtract", 1, 4]);
});

test("a set and a level open as the active ones; their fields apply one step each, and Copy style fills a level's borders", async () => {
    const { app } = await studio();
    const other = createLevel({ id: "duchies", name: "Duchies", style: { lineColor: "#123456", lineThickness: 3, lineStyle: "dotted" } });
    app.layerSets[0].levels.push(other);
    const set = app.layerSets[0];
    await LayerSetEditor.open(app, "political");
    assert.equal(app.activeLayerSetId, "political");
    await commit(app, "setOpacity", "0.4");
    await commit(app, "setWaterTint", false);
    assert.deepEqual([set.opacity, set.waterTint, steps(app)], [0.4, false, 2]);

    const realms = set.levels[0];
    await LevelEditor.open(app, "realms");
    assert.equal(app.activeLevelId, "realms");
    await commit(app, "levelName", "Kingdoms");
    await commit(app, "levelCopyStyle", "duchies");
    assert.deepEqual([realms.name, realms.style.lineColor, realms.style.lineThickness, realms.style.lineStyle], ["Kingdoms", "#123456", 3, "dotted"]);
    assert.equal(field(app, "levelCopyStyle").value, "", "Copy style is a one-off, not a setting");
    assert.equal(steps(app), 4);
});

test("Select on rivers and faults, land masks and decorations picks what is under the pointer", async () => {
    const { app } = await studio();
    pickable(app);
    app.canvasEngine.hitTest = (x, y, type) => (type === "decoration" && Math.hypot(x - 40, y - 40) < 20 ? { entityType: "decoration", entityId: "rose" } : null);
    app.activeTool = "features";
    app.uiState.activeFeatureMode = "select";
    const tool = PickTool.tool(app);
    tool.down(200, 63);
    await settle();
    assert.ok(Inspector.shows(app, "river", "silver"), "a click near the river picks it");
    tool.down(200, 204);
    await settle();
    assert.ok(Inspector.shows(app, "fault", "spine"));
    tool.down(200, 140);
    await settle();
    assert.ok(Inspector.shows(app, "fault", "spine"), "a click in a fault's area of effect picks it");
    tool.down(30, 330);
    await settle();
    assert.equal(Inspector.current(app), null, "a click away closes it");

    app.activeTool = "scene";
    app.uiState.generationEngine = "guided";
    app.uiState.sceneMode = "select";
    tool.down(340, 340);
    await settle();
    assert.ok(Inspector.shows(app, "landMask", "isle"), "a click inside a land mask picks it");

    app.activeTool = "cartography";
    app.uiState.cartographyMode = "select";
    tool.down(45, 42);
    await settle();
    assert.ok(Inspector.shows(app, "decoration", "rose"));
    app.uiState.cartographyMode = "move";
    assert.equal(PickTool.tool(app), null, "Move leaves decorations to be dragged");
    assert.equal(steps(app), 0, "picking changes nothing");
});

test("the lists learn which object the inspector shows, a label by its owner's type", async () => {
    const { app } = await studio();
    assert.deepEqual(Inspector.inspected(app), {});
    await PinEditor.open(app, "keep");
    assert.deepEqual(Inspector.inspected(app), { pin: "keep" });
    await LabelEditor.open(app, { type: "pin", id: "keep" });
    assert.deepEqual(Inspector.inspected(app), { labelpin: "keep" });
    assert.ok(app.rendered.includes("context"), "the panel is drawn again to mark the row");
    Inspector.close(app);
    await settle();
    assert.deepEqual(Inspector.inspected(app), {});
});
