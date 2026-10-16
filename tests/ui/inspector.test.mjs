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
await templates.load(["parts/section.hbs", "parts/shared-range.hbs", "parts/style-picker.hbs", "parts/inspector-label.hbs", "parts/inspector-region.hbs", "parts/inspector-route.hbs"]);

/** What the next prompt (Save as…'s name) answers. */
const answers = { prompt: null };
let host = null;
let nextId = 0;
installPlatform({
    i18n,
    notify: { info: () => {}, warn: () => {}, error: () => {} },
    utils: { ...platform.utils, randomID: () => `n${++nextId}`, deepClone: (value) => structuredClone(value), mergeObject: (target, source) => Object.assign(target, source), escapeHtml: (text) => handlebars.escapeExpression(text) },
    templates,
    fonts: { list: () => ["Signika", "Noto Serif"] },
    dialogs: {
        confirm: async () => true,
        prompt: async () => answers.prompt,
        choose: async () => null,
        dismiss: ({ placement } = {}) => host && Overlay.dismissAll(host, placement),
        attach: () => () => {},
    },
});

const { Inspector } = await import("../../src/applications/Inspector.js");
const { RegionEditor } = await import("../../src/applications/RegionEditor.js");
const { RouteEditor } = await import("../../src/applications/RouteEditor.js");
const { RouteTool } = await import("../../src/applications/RouteTool.js");
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
        tectonicFaults: [],
        manualRivers: [],
        landMasks: [],
        mapPins: [],
        mapRoutes: [],
        mapLabels: [],
        mapDecorations: [],
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
            customRegionStyles: [{ id: "kingdom", name: "Kingdom", fillColor: "#aa3322", fillStyle: "diagonal" }],
            customLabelStyles: [{ id: "realm", name: "Realm", fontFamily: "Noto Serif", fontSize: 2, fillColor: "#112233", maxChars: 12, justify: "center" }],
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
