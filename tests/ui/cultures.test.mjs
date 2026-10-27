// The Generate panel's cultures (CultureLists) and a culture in the inspector (CultureEditor),
// drawn from the real templates in a happy-dom document: the add row names and makes a culture
// with the default culture's fields and the panel's name style; Rename, Duplicate and Delete; each
// change one undo step that marks a run out of date; the inspector's fields, its habitat bands
// (RangeTrack: keys, quick picks, double-click to the whole track, kept as no limit) and Use auto.
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

const i18n = { localize: (key) => key, format: (key, data) => `${key} ${JSON.stringify(data)}`, lang: "en" };
const handlebars = Handlebars.create();
registerHelpers(handlebars, i18n);
const templates = createWebTemplates({ handlebars, prefix: "modules/filrodens-world-map-builder/templates/", fetchText: async (path) => readFileSync(join(ROOT, "templates", path), "utf8") });
await templates.load(["parts/section.hbs", "parts/shared-range.hbs", "parts/range-band.hbs", "parts/inspector-culture.hbs", "tools-generate.hbs"]);

const answers = { confirm: true };
const warnings = [];
let host = null;
let nextId = 0;
installPlatform({
    i18n,
    notify: { info: () => {}, warn: (message) => warnings.push(message), error: () => {} },
    utils: { ...platform.utils, randomID: () => `culture${++nextId}`, deepClone: (value) => structuredClone(value), mergeObject: (target, source) => Object.assign(target, source), escapeHtml: (text) => handlebars.escapeExpression(text) },
    templates,
    settings: { get: () => [] },
    dialogs: {
        confirm: async () => answers.confirm,
        prompt: async () => null,
        dismiss: ({ placement } = {}) => host && Overlay.dismissAll(host, placement),
        attach: () => () => {},
    },
});

const { FILRODENSWMB } = await import("../../src/config.js");
const { CultureEditor } = await import("../../src/applications/CultureEditor.js");
const { CultureLists } = await import("../../src/applications/CultureLists.js");
const { VectorHistory } = await import("../../src/applications/VectorHistory.js");
const { RangeTrack } = await import("../../src/ui/RangeTrack.js");
const { CultureMarkers } = await import("../../src/applications/CultureMarkers.js");
const { Inspector } = await import("../../src/applications/Inspector.js");
const { GeneratedDetails } = await import("../../src/applications/GeneratedDetails.js");
const { GeneratePanel } = await import("../../src/applications/GeneratePanel.js");

beforeEach(() => {
    answers.confirm = true;
    document.body.innerHTML = "";
});

function studio() {
    host = document.body.appendChild(document.createElement("div"));
    const app = {
        root: host,
        activeTool: "generate",
        layerSets: [],
        tectonicFaults: [],
        manualRivers: [],
        landMasks: [],
        mapPins: [],
        mapRoutes: [],
        mapLabels: [],
        mapDecorations: [],
        _expandedSections: new Set(),
        _collapsedSections: new Set(),
        uiState: { seaLevel: 0.4, generatorSettings: { nameBase: "Nordic" }, cultures: [], customBiomes: [] },
        // A 10 x 10 map: sea on its left half, land on its right
        mapWidth: 10,
        mapHeight: 10,
        currentElevationData: Float32Array.from({ length: 100 }, (_, index) => (index % 10 < 5 ? 0.2 : 0.6)),
        canvasEngine: { pickPointerTool: null, markers: null, homelandMarkers: { set(markers) { app.canvasEngine.markers = markers; } } },
        modelRun: { run: "earlier" },
        pinHistory: [],
        pinRedoStack: [],
        stale: 0,
        dirty: 0,
        cultureNaming: null,
        markGeneratorStale() {
            this.stale++;
        },
        markDirty() {
            this.dirty++;
        },
        _repaintVectors() {},
        view: { render: async (regions) => {
            if (regions.includes("context")) await drawPanel(app);
        } },
    };
    return app;
}

async function drawPanel(app) {
    let panel = app.root.querySelector(".fwmb-context-panel");
    if (!panel) {
        panel = app.root.appendChild(document.createElement("div"));
        panel.className = "fwmb-context-panel";
    }
    panel.innerHTML = await templates.render("modules/filrodens-world-map-builder/templates/tools-generate.hbs", { generate: { nameBases: [], world: [], output: { places: [], routes: [] } }, cultureList: CultureLists.context(app) });
}

const form = (app) => app.root.querySelector("dialog.fwmb-inspector .fwmb-overlay-body");
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const undo = (app) => VectorHistory.step(app, true);
const culture = (app, index = 0) => app.uiState.cultures[index];

async function addCulture(app, name) {
    await CultureLists.startAdding(app);
    return CultureLists.confirm(app, name);
}

test("the add row makes a culture with the default culture's fields and the panel's name style, opens it, and is one undo step", async () => {
    const app = studio();
    await drawPanel(app);
    assert.ok(app.root.querySelector(".fwmb-context-panel select[name='generator.nameBase']"), "with no cultures the Name style shows");
    await CultureLists.startAdding(app);
    assert.equal(app.root.querySelector("[data-culture-naming]").value, "FILRODENSWMB.UI.CultureNewName");
    const id = await CultureLists.confirm(app, "Hillfolk");
    const made = culture(app);
    const { FIELDS } = FILRODENSWMB.GENERATOR.CULTURES;
    assert.deepEqual({ ...made, id: undefined }, { id: undefined, name: "Hillfolk", color: FILRODENSWMB.REGIONS.PRESETS[0], nameBase: "Nordic", openness: FIELDS.openness.default, density: FIELDS.density.default, habitat: { temperature: null, moisture: null, height: null, relief: null, coast: 0, river: 0 }, homelands: [] });
    assert.equal(made.id, id);
    assert.ok(app.root.querySelector("dialog.fwmb-inspector--culture"), "opened in the inspector");
    assert.equal(app.stale, 1, "a run made before is out of date");
    assert.equal(app.root.querySelector(".fwmb-context-panel select[name='generator.nameBase']"), null, "each culture names its own places");
    const second = await addCulture(app, "Lowlanders");
    assert.notEqual(culture(app, 1).color, made.color, "the next unused colour");
    undo(app);
    assert.equal(app.uiState.cultures.length, 1);
    assert.ok(!app.uiState.cultures.some((each) => each.id === second));
    await CultureLists.startAdding(app);
    assert.equal(await CultureLists.confirm(app, "   "), null, "an empty name makes nothing");
    assert.equal(app.uiState.cultures.length, 1);
});

test("Rename, Duplicate and Delete are each one undo step", async () => {
    const app = studio();
    const id = await addCulture(app, "Hillfolk");
    culture(app).homelands = [{ x: 4, y: 5 }];
    await CultureLists.startRename(app, id);
    await CultureLists.confirm(app, "Hill folk");
    assert.equal(culture(app).name, "Hill folk");
    undo(app);
    assert.equal(culture(app).name, "Hillfolk");
    const copy = await CultureLists.duplicate(app, id);
    assert.equal(culture(app, 1).id, copy);
    assert.match(culture(app, 1).name, /StyleCopyName/);
    assert.deepEqual(culture(app, 1).homelands, [{ x: 4, y: 5 }], "with its homelands");
    answers.confirm = false;
    assert.equal(await CultureLists.delete(app, id), false, "asks first");
    answers.confirm = true;
    assert.equal(await CultureLists.delete(app, id), true);
    assert.deepEqual(app.uiState.cultures.map((each) => each.id), [copy]);
    undo(app);
    assert.deepEqual(app.uiState.cultures.map((each) => each.id), [id, copy]);
});

test("the inspector's fields apply as one undo step each, and a run made before is out of date", async () => {
    const app = studio();
    await addCulture(app, "Hillfolk");
    const stale = app.stale;
    const elements = form(app).elements;
    elements.cultureNameBase.value = "Dwarven";
    elements.cultureNameBase.dispatchEvent(new window.Event("change", { bubbles: true }));
    await settle();
    elements.cultureOpenness.value = "0.2";
    elements.cultureOpenness.dispatchEvent(new window.Event("change", { bubbles: true }));
    await settle();
    assert.equal(culture(app).nameBase, "Dwarven");
    assert.equal(culture(app).openness, 0.2);
    assert.ok(app.stale > stale);
    undo(app);
    assert.equal(culture(app).openness, 0.5);
    assert.equal(culture(app).nameBase, "Dwarven");
});

test("a habitat band moves with the keys and its quick picks, returns to no limit on double-click, and is kept in the map's elevation", async () => {
    const app = studio();
    await addCulture(app, "Hillfolk");
    const band = (name) => form(app).querySelector(`[data-range-band] input[name="${name}"]`).closest("[data-range-band]");
    // Temperature: the low end up ten steps with Page Up
    const low = band("habitatTemperature").querySelector('[data-band-edge="0"]');
    low.dispatchEvent(new window.KeyboardEvent("keydown", { key: "PageUp", bubbles: true }));
    await settle();
    assert.deepEqual(culture(app).habitat.temperature, [0.1, 1]);
    assert.equal(low.getAttribute("aria-valuenow"), "0.1");
    // Height: the Highland quick pick, from the sea level's quarters as the rule editor's
    const highland = [...band("habitatHeight").querySelectorAll("[data-band-zone]")].find((pick) => pick.textContent.includes("Highland"));
    highland.click();
    await settle();
    assert.deepEqual(culture(app).habitat.height, [0.7, 0.85]);
    assert.equal(band("habitatHeight").querySelector("[data-band-reading]").textContent, "70% – 85%");
    // Double-click: the whole track, kept as no limit
    band("habitatTemperature").querySelector("[data-band-track]").dispatchEvent(new window.MouseEvent("dblclick", { bubbles: true }));
    await settle();
    assert.equal(culture(app).habitat.temperature, null);
    assert.equal(band("habitatTemperature").querySelector("[data-band-reading]").textContent, "FILRODENSWMB.UI.CultureAny");
    undo(app);
    assert.deepEqual(culture(app).habitat.temperature, [0.1, 1]);
});

test("Use auto takes the culture's homelands away, as one undo step", async () => {
    const app = studio();
    const id = await addCulture(app, "Hillfolk");
    culture(app).homelands = [{ x: 4, y: 5 }, { x: 9, y: 9 }];
    await CultureEditor.open(app, id);
    form(app).querySelector('[data-inspector-action="autoHomelands"]').click();
    await settle();
    assert.deepEqual(culture(app).homelands, []);
    undo(app);
    assert.equal(culture(app).homelands.length, 2);
});

test("a handle's keys: a step, ten steps, the ends; never past the other end", () => {
    const range = { min: 0, max: 1, step: 0.01 };
    const key = (name) => ({ key: name });
    assert.equal(RangeTrack.stepKey(key("ArrowRight"), 0.5, range), 0.51);
    assert.equal(RangeTrack.stepKey(key("PageDown"), 0.5, range), 0.4);
    assert.equal(RangeTrack.stepKey(key("Home"), 0.5, range), 0);
    assert.equal(RangeTrack.stepKey(key("End"), 0.5, range), 1);
    assert.equal(RangeTrack.stepKey(key("ArrowUp"), 1, range), 1);
    assert.equal(RangeTrack.stepKey(key("a"), 0.5, range), null);
    const holder = document.body.appendChild(document.createElement("div"));
    holder.innerHTML = `<div data-range-band data-min="0" data-max="1" data-step="0.1"><div data-band-track><div class="fwmb-rule-fill"></div><div data-band-edge="0" tabindex="0"></div><div data-band-edge="1" tabindex="0"></div></div><input type="hidden" name="b" value="0.3,0.4"></div>`;
    RangeTrack.bind(holder);
    const lowEnd = holder.querySelector('[data-band-edge="0"]');
    lowEnd.dispatchEvent(new window.KeyboardEvent("keydown", { key: "End", bubbles: true }));
    assert.equal(holder.querySelector("input").value, "0.4,0.4", "the low end stops at the high one");
});

test("Add homeland: the next click on land adds one as an undo step; water is refused; Escape and closing end it", async () => {
    const app = studio();
    const id = await addCulture(app, "Hillfolk");
    const button = () => form(app).querySelector('[data-inspector-action="addHomeland"]');
    button().click();
    await settle();
    assert.ok(app.canvasEngine.pickPointerTool, "the click goes to the pick, editing or not");
    assert.equal(button().getAttribute("aria-pressed"), "true");
    warnings.length = 0;
    app.canvasEngine.pickPointerTool.down(2, 3);
    assert.equal(warnings.length, 1, "water is refused");
    assert.deepEqual(culture(app).homelands, []);
    app.canvasEngine.pickPointerTool.down(7.4, 3.6);
    await settle();
    assert.deepEqual(culture(app).homelands, [{ x: 7, y: 4 }]);
    assert.equal(app.canvasEngine.pickPointerTool, null, "one click, one homeland");
    // The studio redraws the inspector after the panel (see MapStudio's afterRegionsDrawn)
    await Inspector.refresh(app);
    assert.match(form(app).querySelector(".fwmb-homeland-row").textContent, /CultureHomelandAt/);
    undo(app);
    assert.deepEqual(culture(app).homelands, []);
    // Escape ends a pick; so does the inspector closing
    CultureMarkers.togglePick(app, id);
    assert.equal(CultureMarkers.handleKey(app, { key: "Escape" }), true);
    assert.equal(app.canvasEngine.pickPointerTool, null);
    CultureMarkers.togglePick(app, id);
    Inspector.close(app);
    await settle();
    assert.equal(app.canvasEngine.pickPointerTool, null);
});

test("Remove takes one homeland away, as one undo step", async () => {
    const app = studio();
    await addCulture(app, "Hillfolk");
    culture(app).homelands = [{ x: 6, y: 1 }, { x: 8, y: 8 }];
    await CultureEditor.open(app, culture(app).id);
    form(app).querySelector('[data-inspector-action="removeHomeland"][data-index="0"]').click();
    await settle();
    assert.deepEqual(culture(app).homelands, [{ x: 8, y: 8 }]);
    undo(app);
    assert.equal(culture(app).homelands.length, 2);
});

test("the markers: given homelands filled, a run's placed homeland hollow, only in the Generate tool", async () => {
    const app = studio();
    await addCulture(app, "Hillfolk");
    await addCulture(app, "Lowlanders");
    culture(app).homelands = [{ x: 6, y: 1 }];
    app.meshSession = { mesh: { cellCount: 50, siteX: (cell) => cell, siteY: (cell) => cell + 1 } };
    app.modelRun = { run: "r", cultures: [{ id: culture(app).id, homelands: [3], homelandsAuto: false }, { id: culture(app, 1).id, homelands: [9], homelandsAuto: true }] };
    CultureMarkers.update(app);
    assert.deepEqual(app.canvasEngine.markers, [{ x: 6, y: 1, color: culture(app).color, filled: true }, { x: 9, y: 10, color: culture(app, 1).color, filled: false }]);
    app.activeTool = "regions";
    CultureMarkers.update(app);
    assert.deepEqual(app.canvasEngine.markers, []);
});

test("generated details name cultures by id (a deleted one as the run knew it), with the mix; Results give each culture's share", () => {
    const app = studio();
    app.uiState.cultures = [{ id: "hill", name: "Hillfolk", color: "#aa0000" }];
    app.modelRun = { run: "r", cultures: [{ id: "hill", name: "Hill people" }, { id: "gone", name: "Old folk", color: "#00aa00" }], stats: { population: 1000 } };
    const pin = { generated: { run: "r", kind: "town", tier: "town", population: 500, culture: "hill", mix: [{ culture: "hill", share: 0.7 }, { culture: "gone", share: 0.27 }, { culture: "hill", share: 0.03 }] } };
    const rows = GeneratedDetails.forPin(app, pin);
    const cultures = rows.find((row) => row.label === "FILRODENSWMB.UI.GeneratedCultures");
    assert.match(cultures.value, /Hillfolk.*70.*Old folk.*27/);
    assert.ok(!cultures.value.includes("3"), "under 5% left out");
    assert.equal(GeneratedDetails.cultureName(app, 0), "Hill people", "an older run's index");
    assert.equal(GeneratedDetails.cultureName(app, null), null);
    app.layerSets = [{ kind: "political", levels: [{ regions: [
        { key: 0, name: "A", generated: { run: "r", kind: "realm", population: 300, culture: "hill", mix: [{ culture: "hill", share: 1 }] } },
        { key: 1, name: "B", generated: { run: "r", kind: "realm", population: 100, culture: "gone", mix: [{ culture: "gone", share: 1 }] } },
    ] }] }];
    const shares = GeneratePanel.results(app).cultures;
    assert.deepEqual(shares.map((entry) => [entry.name, entry.color]), [["Hillfolk", "#aa0000"], ["Old folk", "#00aa00"]]);
    assert.match(shares[0].share, /75/);
});
