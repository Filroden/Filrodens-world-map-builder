// The map's styles in the inspector (StyleEditors) and their lists in Styles and icons
// (StyleLists), drawn from the real templates in a happy-dom document: each kind opens from its
// row, focus staying on the row; a field change cascades to the objects that follow the style, as
// one undo step that puts back both the style and the objects; the add row names and makes a style
// with the bar's next-object fields; Rename, Duplicate and Delete (which says how many objects use
// the style, and leaves them Custom); Save as… is undone with its style; a route style's transport
// narrows the route pickers.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import Handlebars from "handlebars";
import { Window } from "happy-dom";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const window = new Window({ url: "http://localhost/" });
for (const name of Object.getOwnPropertyNames(window)) {
    if (/^[A-Z]/.test(name) && !(name in globalThis)) globalThis[name] = window[name];
}
Object.assign(globalThis, { window, document: window.document });
after(() => window.happyDOM.close());
const document = window.document;

const { installPlatform, platform } = await import("../../src/platform/index.js");
const { createWebTemplates, registerHelpers } = await import("../../src/platform/web/templates.js");
const { Overlay } = await import("../../src/ui/Overlay.js");
const { ListNav } = await import("../../src/ui/ListNav.js");
const { Idiomorph } = await import("../../vendor/idiomorph/idiomorph.esm.js");

const i18n = { localize: (key) => key, format: (key, data) => `${key} ${JSON.stringify(data)}`, lang: "en" };
const handlebars = Handlebars.create();
registerHelpers(handlebars, i18n);
const templates = createWebTemplates({ handlebars, prefix: "modules/filrodens-world-map-builder/templates/", fetchText: async (path) => readFileSync(join(ROOT, "templates", path), "utf8") });
await templates.load(["parts/section.hbs", "parts/shared-range.hbs", "parts/style-picker.hbs", "parts/font-picker.hbs", "parts/face-fields.hbs", "parts/label-fields.hbs", "parts/inspector-route.hbs", "parts/inspector-route-style.hbs", "parts/inspector-region-style.hbs", "parts/inspector-label-style.hbs", "parts/inspector-pin-style.hbs", "tools-library.hbs"]);

const answers = { prompt: null, confirm: true, confirmed: [] };
let host = null;
let nextId = 0;
installPlatform({
    i18n,
    notify: { info: () => {}, warn: () => {}, error: () => {} },
    utils: { ...platform.utils, randomID: () => `n${++nextId}`, deepClone: (value) => structuredClone(value), mergeObject: (target, source) => Object.assign(target, source), escapeHtml: (text) => handlebars.escapeExpression(text) },
    templates,
    fonts: { list: () => ["Noto Serif", "Sora", "Signika"] },
    settings: { get: () => [] },
    assets: { url: (path) => path, path: (path) => path },
    dialogs: {
        confirm: async (options) => {
            answers.confirmed.push(options);
            return answers.confirm;
        },
        prompt: async () => answers.prompt,
        choose: async () => null,
        dismiss: ({ placement } = {}) => host && Overlay.dismissAll(host, placement),
        attach: () => () => {},
    },
});

const { Inspector } = await import("../../src/applications/Inspector.js");
const { InspectorFields } = await import("../../src/applications/InspectorFields.js");
const { RouteEditor } = await import("../../src/applications/RouteEditor.js");
const { StyleEditors } = await import("../../src/applications/StyleEditors.js");
const { StyleLists } = await import("../../src/applications/StyleLists.js");
const { VectorHistory } = await import("../../src/applications/VectorHistory.js");
const { addRegion, createLayerSet, createLevel } = await import("../../src/mesh/Schema.js");
const { allLevels } = await import("../../src/mesh/LayerTree.js");

beforeEach(() => {
    answers.prompt = null;
    answers.confirm = true;
    answers.confirmed = [];
    document.body.innerHTML = "";
});

/** A studio stand-in in Styles and icons, with a style of each kind and objects following them. */
function studio() {
    const realms = createLevel({ id: "realms", name: "Realms", opacity: 1 });
    addRegion(realms, { id: "west", name: "West", quickStyle: "kingdom", fillColor: "#aa3322", fillStyle: "diagonal" });
    addRegion(realms, { id: "east", name: "East", quickStyle: "custom" });
    host = document.body.appendChild(document.createElement("div"));
    const app = {
        root: host,
        activeTool: "library",
        layerSets: [createLayerSet({ id: "political", name: "Political", levels: [realms] })],
        tectonicFaults: [],
        manualRivers: [],
        landMasks: [],
        mapPins: [
            { id: "keep", name: "Keep", icon: "star", scale: 2, color: "#ffcc00", pinStyle: "city", label: { fontSize: 1.5, quickStyle: "custom" } },
            { id: "hut", name: "Hut", icon: "dot", scale: 1, color: "#ffffff", pinStyle: null, label: { quickStyle: "custom" } },
        ],
        mapRoutes: [
            { id: "kings-way", name: "King's Way", transport: "road", quickStyle: "trade", color: "#00ff00", thickness: 3.5, style: "dashed", outline: false, smoothing: true, label: { quickStyle: "realm" }, waypoints: [] },
            { id: "ferry", name: "Ferry", transport: "sea", quickStyle: "custom", color: "#0000ff", thickness: 1, style: "solid", label: { quickStyle: "custom" }, waypoints: [] },
        ],
        mapLabels: [{ id: "sea", name: "Grey Sea", quickStyle: "realm", fontFamily: "Noto Serif", fontSize: 2, fillColor: "#112233", maxChars: 12, justify: "center", bold: false, italic: true }],
        mapDecorations: [],
        _expandedSections: new Set(),
        _collapsedSections: new Set(),
        uiState: {
            routeColor: "#ff0000",
            routeThickness: 2,
            routeStyle: "solid",
            routeOutline: true,
            routeSmoothing: false,
            routeTransport: "sea",
            activeRouteQuickStyle: "custom",
            activeRegionQuickStyle: "custom",
            activeLabelQuickStyle: "custom",
            activePinStyle: "custom",
            activeIcon: "anchor",
            pinScale: 0.8,
            pinColor: "#123456",
            labelFontFamily: "Noto Serif",
            labelFontSize: 1,
            labelFillColor: "#ffffff",
            labelMaxChars: 0,
            labelJustify: "left",
            customRouteStyles: [
                { id: "trade", name: "Trade", transport: "road", color: "#00ff00", thickness: 3.5, style: "dashed", outline: false, smoothing: true },
                { id: "lane", name: "Lane", transport: "sea", color: "#3366ff", thickness: 1, style: "dashed", outline: false, smoothing: false },
                { id: "any", name: "Any way", color: "#999999", thickness: 1, style: "solid", outline: true, smoothing: false },
            ],
            customPinStyles: [{ id: "city", name: "City", icon: "star", scale: 2, color: "#ffcc00", label: { fontSize: 1.5, visibility: "all", quickStyle: "custom" }, detailLevel: 1 }],
            customRegionStyles: [{ id: "kingdom", name: "Kingdom", fillColor: "#aa3322", fillStyle: "diagonal" }],
            customLabelStyles: [{ id: "realm", name: "Realm", fontFamily: "Noto Serif", fontSize: 2, fillColor: "#112233", maxChars: 12, justify: "center", bold: false, italic: true }],
            customBiomes: [],
        },
        get regionLevels() {
            return allLevels(this.layerSets);
        },
        pinHistory: [],
        pinRedoStack: [],
        styleNaming: null,
        rendered: [],
        dirty: 0,
        _repaintVectors() {},
        markDirty() {
            this.dirty++;
        },
        view: { render: async (regions) => {
            app.rendered.push(...regions);
            if (regions.includes("context")) await drawLibrary(app);
        } },
        canvasEngine: null,
    };
    return app;
}

/** Draws Styles and icons' style lists into the studio, as the panel does. */
async function drawLibrary(app) {
    let panel = app.root.querySelector(".fwmb-context-panel");
    if (!panel) {
        panel = app.root.appendChild(document.createElement("div"));
        panel.className = "fwmb-context-panel";
    }
    // Morphed in place, as StudioView draws the panel, so focus survives a redraw
    Idiomorph.morph(panel, await templates.render("modules/filrodens-world-map-builder/templates/tools-library.hbs", { styleLists: StyleLists.context(app), builtinPinIcons: [], customPinIcons: [] }), { morphStyle: "innerHTML" });
    ListNav.settle(panel);
}

const form = (app) => app.root.querySelector("dialog.fwmb-inspector .fwmb-overlay-body");
const field = (app, name) => form(app).elements[name];
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
async function commit(app, name, value) {
    const input = field(app, name);
    if (input.type === "checkbox") input.checked = value;
    else input.value = value;
    input.dispatchEvent(new window.Event("change", { bubbles: true }));
    await settle();
}
const steps = (app) => app.pinHistory.length;
const row = (app, type, id) => app.root.querySelector(`[data-style-list="${type}"] [data-list-item][data-id="${id}"]`);

test("every kind opens from its row in the inspector, with the style's name, kind and usage in its header, focus staying on the row", async () => {
    const app = studio();
    await drawLibrary(app);
    for (const [type, id, kind, field] of [["Route", "trade", "route-style", "styleStroke"], ["Region", "kingdom", "region-style", "styleFillStyle"], ["Label", "realm", "label-style", "styleFontFamily"], ["Pin", "city", "pin-style", "styleDetailLevel"]]) {
        const target = row(app, type, id);
        target.focus();
        await StyleEditors.open(app, type, id, { keepFocus: true });
        await settle();
        const dialog = app.root.querySelector("dialog.fwmb-inspector");
        assert.ok(dialog.classList.contains(`fwmb-inspector--${kind}`), kind);
        assert.equal(form(app).elements[field] !== undefined, true, `${kind} has ${field}`);
        assert.match(dialog.querySelector(".fwmb-overlay-header .fwmb-kind").textContent, /InspectorSubtitleStyle/);
        assert.equal(document.activeElement?.dataset.id, id, "focus stays on the row");
        assert.equal(row(app, type, id).getAttribute("aria-selected"), "true", "the row is marked as shown");
    }
    // The label style's usage: the standalone label and the route's label
    assert.equal(StyleEditors.usageCount(app, "Label", "realm"), 2);
});

test("a route style's field cascades to its routes, one undo step that puts back the style and the routes", async () => {
    const app = studio();
    await StyleEditors.open(app, "Route", "trade");
    const style = app.uiState.customRouteStyles[0];
    const road = app.mapRoutes[0];
    await commit(app, "styleColor", "#abcdef");
    assert.equal(style.color, "#abcdef");
    assert.equal(road.color, "#abcdef", "the route that follows it changes");
    assert.equal(app.mapRoutes[1].color, "#0000ff", "a route that does not is left alone");
    assert.equal(steps(app), 1);
    // The same value again records nothing
    await commit(app, "styleColor", "#abcdef");
    assert.equal(steps(app), 1);

    VectorHistory.step(app, true);
    assert.equal(app.uiState.customRouteStyles[0].color, "#00ff00", "undo puts the style back");
    assert.equal(app.mapRoutes[0].color, "#00ff00", "and its route");
    VectorHistory.step(app, false);
    assert.equal(app.uiState.customRouteStyles[0].color, "#abcdef");
    assert.equal(app.mapRoutes[0].color, "#abcdef");
});

test("a route style's transport is Road, Sea or Any; changing it moves no route off the style", async () => {
    const app = studio();
    await StyleEditors.open(app, "Route", "trade");
    assert.deepEqual([...field(app, "styleTransport").options].map((option) => option.value), ["", "road", "sea"]);
    await commit(app, "styleTransport", "sea");
    assert.equal(app.uiState.customRouteStyles[0].transport, "sea");
    assert.equal(app.mapRoutes[0].quickStyle, "trade", "the road keeps its style");
    assert.equal(app.mapRoutes[0].transport, "road", "and its own transport");
    await commit(app, "styleTransport", "");
    assert.equal("transport" in app.uiState.customRouteStyles[0], false, "Any stores none");
});

test("the route pickers offer the styles for the route's (or the bar's) transport, keeping one a route follows", async () => {
    const app = studio();
    const names = (choices) => choices.filter((choice) => choice.name).map((choice) => choice.name);
    const styles = app.uiState.customRouteStyles;
    assert.deepEqual(names(InspectorFields.styleChoices(styles, null, InspectorFields.forTransport("road"))), ["Trade", "Any way"]);
    assert.deepEqual(names(InspectorFields.styleChoices(styles, null, InspectorFields.forTransport("sea"))), ["Lane", "Any way"]);
    // A sea route following the road style still shows it
    assert.deepEqual(names(InspectorFields.styleChoices(styles, "trade", InspectorFields.forTransport("sea"))), ["Trade", "Lane", "Any way"]);

    await RouteEditor.open(app, "ferry");
    const offered = [...field(app, "routeQuickStyle").options].map((option) => option.textContent.trim());
    assert.deepEqual(offered.slice(1), ["Lane", "Any way"]);
});

test("a region fill, a label style and a pin style cascade to what follows them", async () => {
    const app = studio();
    await StyleEditors.open(app, "Region", "kingdom");
    await commit(app, "styleFillStyle", "crosshatch");
    assert.equal(app.regionLevels[0].regions[0].fillStyle, "crosshatch");
    assert.notEqual(app.regionLevels[0].regions[1].fillStyle, "crosshatch");

    await StyleEditors.open(app, "Label", "realm");
    await commit(app, "styleFontSize", "3");
    assert.equal(app.mapLabels[0].fontSize, 3);
    assert.equal(app.mapRoutes[0].label.fontSize, 3, "an owned label follows too");

    await StyleEditors.open(app, "Pin", "city");
    await commit(app, "styleScale", "3");
    assert.equal(app.mapPins[0].scale, 3);
    assert.equal(app.mapPins[1].scale, 1);
    form(app).querySelector('[data-inspector-action="pickIcon"][data-icon="castle"]').click();
    await settle();
    await settle();
    assert.equal(app.uiState.customPinStyles[0].icon, "castle");
    assert.equal(app.mapPins[0].icon, "castle");
    assert.equal(steps(app), 4);
});

test("a label style in a family without an italic shows Italic disabled, its setting kept", async () => {
    const app = studio();
    await StyleEditors.open(app, "Label", "realm");
    assert.equal(field(app, "styleItalic").disabled, false);
    await commit(app, "styleFontFamily", "Sora");
    assert.equal(app.uiState.customLabelStyles[0].italic, true, "the setting is kept");
    await Inspector.refresh(app);
    assert.equal(field(app, "styleItalic").disabled, true);
    assert.equal(field(app, "styleItalic").checked, true);
    assert.match(field(app, "styleItalic").closest("label").dataset.tooltipText, /FontNoItalic/);
});

test("the add row names a new style with the bar's next-object fields, then opens it, focus on its row", async () => {
    const app = studio();
    await drawLibrary(app);
    await StyleLists.startAdding(app, "Route");
    const input = app.root.querySelector("[data-style-naming]");
    assert.ok(input, "a naming row");
    assert.equal(input.value, "FILRODENSWMB.UI.NewRouteStyleName");
    assert.equal(document.activeElement, input);

    // Escape: nothing made, nothing recorded
    await StyleLists.cancel(app);
    assert.equal(app.root.querySelector("[data-style-naming]"), null);
    assert.equal(steps(app), 0);

    await StyleLists.startAdding(app, "Route");
    const id = await StyleLists.confirm(app, "Ferry lane");
    const style = app.uiState.customRouteStyles.find((candidate) => candidate.id === id);
    assert.deepEqual({ ...style, id: undefined }, { id: undefined, name: "Ferry lane", color: "#ff0000", thickness: 2, style: "solid", outline: true, smoothing: false, transport: "sea" });
    assert.equal(steps(app), 1);
    assert.ok(Inspector.shows(app, "route-style", id));
    assert.equal(document.activeElement?.dataset.id, id);

    // An empty name makes nothing
    await StyleLists.startAdding(app, "Pin");
    assert.equal(await StyleLists.confirm(app, "  "), null);
    assert.equal(app.uiState.customPinStyles.length, 1);

    // A new pin style starts as the next pin: the bar's icon, colour and scale
    await StyleLists.startAdding(app, "Pin");
    const pinId = await StyleLists.confirm(app, "Harbour");
    const pin = app.uiState.customPinStyles.find((candidate) => candidate.id === pinId);
    assert.deepEqual([pin.icon, pin.color, pin.scale], ["anchor", "#123456", 0.8]);
});

test("Rename renames in the row, Duplicate adds a copy and opens it, each one undo step", async () => {
    const app = studio();
    await drawLibrary(app);
    await StyleLists.startRename(app, "Label", "realm");
    assert.equal(app.root.querySelector("[data-style-naming]").value, "Realm");
    await StyleLists.confirm(app, "Kingdoms");
    assert.equal(app.uiState.customLabelStyles[0].name, "Kingdoms");
    assert.equal(steps(app), 1);

    const copy = await StyleLists.duplicate(app, "Label", "realm");
    const style = app.uiState.customLabelStyles.find((candidate) => candidate.id === copy);
    assert.equal(style.name, 'FILRODENSWMB.UI.StyleCopyName {"name":"Kingdoms"}');
    assert.equal(style.fontSize, 2);
    assert.ok(Inspector.shows(app, "label-style", copy));
    const again = await StyleLists.duplicate(app, "Label", "realm");
    assert.match(app.uiState.customLabelStyles.find((candidate) => candidate.id === again).name, / 2$/, "a second copy is numbered");
    assert.equal(steps(app), 3);
});

test("Delete asks first with the usage count, then leaves the objects Custom with their look, one undo step", async () => {
    const app = studio();
    await StyleEditors.open(app, "Route", "trade");
    app.uiState.activeRouteQuickStyle = "trade";

    answers.confirm = false;
    assert.equal(await StyleLists.delete(app, "Route", "trade"), false);
    assert.match(answers.confirmed[0].content, /StyleDeleteUsedOne/);
    assert.equal(app.uiState.customRouteStyles.length, 3);

    answers.confirm = true;
    assert.equal(await StyleLists.delete(app, "Route", "trade"), true);
    assert.equal(app.uiState.customRouteStyles.some((style) => style.id === "trade"), false);
    assert.equal(app.mapRoutes[0].quickStyle, "custom");
    assert.equal(app.mapRoutes[0].color, "#00ff00", "the route keeps its look");
    assert.equal(app.uiState.activeRouteQuickStyle, "custom", "the bar lets it go");
    assert.equal(Inspector.current(app), null, "its inspector closes");
    assert.equal(steps(app), 1);

    VectorHistory.step(app, true);
    assert.ok(app.uiState.customRouteStyles.some((style) => style.id === "trade"), "undo brings it back");
    assert.equal(app.mapRoutes[0].quickStyle, "trade", "with its route");
});

test("Save as… is one undo step with its style: undo takes the style away", async () => {
    const app = studio();
    await RouteEditor.open(app, "ferry");
    answers.prompt = "Ferry";
    form(app).querySelector('[data-inspector-action="saveStyle"][data-style-type="Route"]').click();
    await settle();
    await settle();
    const style = app.uiState.customRouteStyles.at(-1);
    assert.equal(style.name, "Ferry");
    assert.equal(style.transport, "sea", "the style is for the route's transport");
    assert.equal(app.mapRoutes[1].quickStyle, style.id);
    assert.equal(steps(app), 1);
    VectorHistory.step(app, true);
    assert.equal(app.uiState.customRouteStyles.some((candidate) => candidate.id === style.id), false);
    assert.equal(app.mapRoutes[1].quickStyle, "custom");
});

test("a new map starts with the road and sea lane route styles and their two label styles", async () => {
    const { MapStateManager } = await import("../../src/applications/MapStateManager.js");
    const state = MapStateManager.buildDefaultUiState(400, 300);
    assert.deepEqual(state.customRouteStyles.map((style) => [style.name, style.transport, style.thickness, style.style, style.outline]), [
        ["FILRODENSWMB.UI.RouteStyleTrunkRoad", "road", 3, "solid", true],
        ["FILRODENSWMB.UI.RouteStyleMainRoad", "road", 2, "solid", true],
        ["FILRODENSWMB.UI.RouteStyleMinorRoad", "road", 1.25, "solid", false],
        ["FILRODENSWMB.UI.RouteStyleTrack", "road", 1, "dotted", false],
        ["FILRODENSWMB.UI.RouteStyleSeaLane", "sea", 1.5, "dashed", false],
        ["FILRODENSWMB.UI.RouteStyleMinorSeaLane", "sea", 1, "dashed", false],
    ]);
    assert.ok(state.customRouteStyles.every((style) => style.smoothing === false && !("nameKey" in style)));
    const road = state.customLabelStyles.find((style) => style.id === "label-style-road");
    const lane = state.customLabelStyles.find((style) => style.id === "label-style-sea-lane");
    assert.deepEqual([road.fontFamily, road.fontSize, road.fillColor, road.bold, road.italic], ["Barlow Semi Condensed", 0.8, "#5a3a1e", false, false]);
    assert.deepEqual([lane.fontFamily, lane.fontSize, lane.fillColor, lane.bold, lane.italic], ["Noto Serif", 0.8, "#2e5f8a", false, true]);
});
