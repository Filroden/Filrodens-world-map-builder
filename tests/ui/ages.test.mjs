// The Generate panel's Ages list and an age in the inspector (AgeEditor, AgeEventRows), drawn from
// the real templates in a happy-dom document: each age a row in brief opening it in the inspector;
// + Age opening the new present; the era, strife and events in their sections, each change one
// undo step marking a run out of date; events added, changed and removed; a place chosen on the
// map (water refused) and its marker; the age staying open as it moves.
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
await templates.load(["parts/section.hbs", "parts/shared-range.hbs", "parts/range-band.hbs", "parts/inspector-age.hbs", "tools-generate.hbs"]);

// A dialogue choice: `choose(options)` answers it (the rule editor's), by default with Cancel
const answers = { confirm: true, choose: async () => "cancel" };
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
        choose: (options) => answers.choose(options),
        prompt: async () => null,
        dismiss: ({ placement } = {}) => host && Overlay.dismissAll(host, placement),
        attach: () => () => {},
    },
});

const { VectorHistory } = await import("../../src/applications/VectorHistory.js");
const { Inspector } = await import("../../src/applications/Inspector.js");
const { GeneratePanel } = await import("../../src/applications/GeneratePanel.js");
const { AgeEditor } = await import("../../src/applications/AgeEditor.js");
const { AgeEventRows } = await import("../../src/applications/AgeEventRows.js");


beforeEach(() => {
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
        uiState: { seaLevel: 0.4, generatorSettings: { ages: [{ era: "earlyMedieval", strife: "peaceful" }, { era: "highMedieval", strife: "troubled", event: { kind: "invasion", culture: "hill" } }] }, cultures: [{ id: "hill", name: "Hillfolk" }, { id: "vale", name: "Valefolk" }], customBiomes: [] },
        // A 10 x 10 map: sea on its left half, land on its right
        mapWidth: 10,
        mapHeight: 10,
        currentElevationData: Float32Array.from({ length: 100 }, (_, index) => (index % 10 < 5 ? 0.2 : 0.6)),
        canvasEngine: { pickPointerTool: null, markers: null, homelandMarkers: { set(markers) { app.canvasEngine.markers = markers; } } },
        pinHistory: [],
        pinRedoStack: [],
        stale: 0,
        markGeneratorStale() {
            this.stale++;
        },
        markDirty() {},
        _repaintVectors() {},
        view: { render: async (regions) => {
            if (regions.includes("context")) {
                await drawPanel(app);
                await Inspector.refresh(app);
            }
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
    const generate = GeneratePanel.context(app);
    panel.innerHTML = await templates.render("modules/filrodens-world-map-builder/templates/tools-generate.hbs", { generate, cultureList: { rows: [] } });
}

const body = (app) => app.root.querySelector("dialog.fwmb-inspector .fwmb-overlay-body");
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const undo = (app) => VectorHistory.step(app, true);
const ages = (app) => app.uiState.generatorSettings.ages;
const present = (app) => ages(app).at(-1);
async function choose(app, name, value) {
    const field = body(app).querySelector(`[name="${name}"]`);
    field.value = value;
    field.dispatchEvent(new window.Event("change", { bubbles: true }));
    await settle();
}
async function press(app, action, index = null) {
    const selector = index === null ? `[data-inspector-action="${action}"]` : `[data-inspector-action="${action}"][data-index="${index}"]`;
    body(app).querySelector(selector).click();
    await settle();
    await settle();
}

test("the Ages list: each age a row in brief, opening it in the inspector; + Age opens the new present", async () => {
    const app = studio();
    await drawPanel(app);
    const rows = [...app.root.querySelectorAll(".fwmb-age-row")];
    assert.equal(rows.length, 2);
    assert.match(rows[1].textContent, /GenerateAgePresent/);
    assert.match(rows[1].textContent, /GenerateAgeEventsOne/);
    await AgeEditor.open(app, rows[1].dataset.id);
    assert.ok(app.root.querySelector("dialog.fwmb-inspector--age"), "opened in the inspector");
    await drawPanel(app);
    assert.equal(app.root.querySelectorAll('.fwmb-age-row[aria-selected="true"]').length, 1, "its row marked");
    assert.deepEqual([...body(app).querySelectorAll("details")].map((section) => section.dataset.section), ["ageEra", "ageStrife", "ageEvents", `ageEvent-${rows[1].dataset.id}-invasion`]);
    GeneratePanel.editAges(app, "add");
    await settle();
    await settle();
    assert.equal(ages(app).length, 3);
    assert.ok(Inspector.shows(app, "age", present(app).id), "the new present opens");
    undo(app);
    assert.equal(ages(app).length, 2, "one undo step");
});

test("an age's era, strife and events apply as one undo step each, marking a run out of date, and the age stays open as it moves", async () => {
    const app = studio();
    await drawPanel(app);
    const id = present(app).id;
    await AgeEditor.open(app, id);
    assert.match(body(app).textContent, /GenerateEraHintHighMedieval/, "what the era does, under it");
    await choose(app, "ageEra", "darkAge");
    assert.equal(present(app).era, "darkAge");
    assert.match(body(app).textContent, /GenerateEraHintDarkAge/);
    await choose(app, "ageStrife", "warTorn");
    assert.equal(present(app).strife, "warTorn");
    assert.match(body(app).textContent, /GenerateStrifeHintWarTorn/);
    assert.equal(app.stale, 2);
    undo(app);
    assert.equal(present(app).strife, "troubled");
    // An event added, made a civil war, another added, the culture of a peoples event changed
    assert.match(body(app).textContent, /GenerateEventsNoRun/, "before a run, how events find their realm");
    await press(app, "addEvent");
    assert.deepEqual(present(app).events.map((event) => event.kind), ["invasion", "arrival"]);
    const boxes = body(app).querySelectorAll("details.fwmb-age-event");
    assert.equal(boxes.length, 2, "each event a folding section of its own");
    assert.match(boxes[1].querySelector(".fwmb-age-event-summary").textContent, /GenerateEventGroupPeoples · Valefolk/, "its summary: its group and its culture");
    // Folded, it stays folded when the inspector is drawn again
    boxes[1].open = false;
    boxes[1].dispatchEvent(new window.Event("toggle"));
    await Inspector.refresh(app);
    assert.equal(body(app).querySelectorAll("details.fwmb-age-event")[1].open, false);
    assert.equal(body(app).querySelectorAll("details.fwmb-age-event")[0].open, true);
    assert.equal(present(app).events[1].culture, "vale", "the culture no other peoples event names");
    await choose(app, "event.1.kind", "civilWar");
    assert.deepEqual(present(app).events, [{ kind: "invasion", culture: "hill" }, { kind: "civilWar", place: null }]);
    assert.equal(body(app).querySelector('[name="event.0.kind"] option[value="civilWar"]').disabled, true, "a kind already in the age");
    await choose(app, "event.0.kind", "famine");
    assert.deepEqual(present(app).events.map((event) => event.kind), ["famine", "civilWar"], "events stay in the order added");
    await choose(app, "event.0.kind", "migration");
    await choose(app, "event.0.culture", "vale");
    assert.deepEqual(present(app).events[0], { kind: "migration", culture: "vale" });
    // Choose on map: water refused, land sets the place, and the marker shows
    await press(app, "pickPlace", 1);
    assert.ok(AgeEventRows.picking(app, id, 1));
    assert.match(body(app).querySelector('[data-inspector-action="pickPlace"]').textContent, /GenerateEventPlacePicking/);
    app.canvasEngine.pickPointerTool.down(1, 1);
    assert.equal(present(app).events[1].place, null, "water refused");
    app.canvasEngine.pickPointerTool.down(8, 3);
    await settle();
    assert.deepEqual(present(app).events[1].place, { x: 8, y: 3 });
    assert.equal(AgeEventRows.picking(app), false, "the pick ends");
    assert.deepEqual(AgeEventRows.markers(app).map(({ x, y }) => [x, y]), [[8, 3]]);
    await settle();
    assert.match(body(app).textContent, /GenerateEventPlaceChosen/);
    await press(app, "clearPlace", 1);
    assert.equal(present(app).events[1].place, null);
    await press(app, "removeEvent", 0);
    assert.deepEqual(present(app).events.map((event) => event.kind), ["civilWar"]);
    undo(app);
    assert.equal(present(app).events.length, 2, "Remove is one undo step");
    // Moved earlier, the age stays open under its new name
    GeneratePanel.editAges(app, "up", 1);
    await settle();
    await settle();
    assert.ok(Inspector.shows(app, "age", id));
    assert.equal(ages(app)[0].id, id);
});

test("a regional map holding its parent's run: no Generate, the world and ages read only (each age opening read only), Output left out; Clone as new brings them back", async () => {
    const { Generation } = await import("../../src/applications/Generation.js");
    const app = studio();
    Object.assign(app, { currentParentId: "parent", parentRun: { run: "parentRun" }, modelRun: null });
    app.uiState.generatorSettings.ages[1].events = [{ kind: "invasion", culture: "hill" }, { kind: "civilWar", place: { x: 8, y: 3 } }];
    await drawPanel(app);
    const panel = app.root.querySelector(".fwmb-context-panel");
    assert.equal(panel.querySelector('[data-action="generateWorld"]'), null, "no Generate");
    assert.match(panel.textContent, /GenerateHeldNotice/);
    assert.match(panel.textContent, /GenerateHeldBadge/);
    assert.doesNotMatch(panel.textContent, /GenerateInheritedNotice|GenerateOlderRevisionHint/, "no notice about generating here");
    assert.equal(panel.querySelector('[name="generator.seed"]'), null, "no seed");
    const nameStyle = panel.querySelector('[name="generator.nameBase"]');
    assert.ok(nameStyle && !nameStyle.disabled, "the default name style, still live: Fill in and Name all use it");
    assert.match(panel.textContent, /GenerateDefaultNameStyle/);
    assert.equal(panel.querySelector('[data-section="generateOutput"]'), null, "no Output");
    const sliders = [...panel.querySelectorAll('input[name^="generator.world."]')];
    assert.equal(sliders.length, 4);
    assert.ok(sliders.every((slider) => slider.disabled), "the world sliders read only");
    assert.equal(panel.querySelectorAll('[data-action="moveAgeUp"], [data-action="removeAge"], [data-action="addAge"]').length, 0, "the ages cannot be moved, removed or added");
    assert.match(panel.textContent, /GenerateAgesHeldHint/);
    // Each age opens, read only
    const id = present(app).id;
    await AgeEditor.open(app, id);
    assert.match(body(app).textContent, /AgeHeldNotice/);
    assert.ok([...body(app).querySelectorAll("select")].every((select) => select.disabled), "every choice read only");
    assert.equal(body(app).querySelectorAll("[data-inspector-action]").length, 0, "no + Event, Remove, Choose on map or Clear");
    assert.equal(AgeEditor.change(app, id, (age) => (age.era = "darkAge")), false);
    assert.equal(present(app).era, "highMedieval");
    // Nothing writes the settings, and Generate is refused with a warning
    const before = JSON.stringify(app.uiState.generatorSettings);
    GeneratePanel.handleInput(app, { type: "change", target: { name: "generator.world.density", type: "range", value: "2" } });
    GeneratePanel.editAges(app, "add");
    GeneratePanel.randomizeSeed(app);
    assert.equal(JSON.stringify(app.uiState.generatorSettings), before);
    GeneratePanel.handleInput(app, { type: "change", target: { name: "generator.nameBase", type: "select-one", value: "French" } });
    assert.equal(app.uiState.generatorSettings.nameBase, "French", "the default name style still writes");
    warnings.length = 0;
    assert.equal(await Generation.run(app), false);
    assert.deepEqual(warnings, ["FILRODENSWMB.UI.GenerateHeldByParentWarn"]);
    // A map of its own (Clone as new drops its parent): Generate is back, with the carried settings
    Inspector.close(app);
    app.currentParentId = null;
    await drawPanel(app);
    assert.ok(panel.querySelector('[data-action="generateWorld"]'));
    assert.ok(panel.querySelector('[data-section="generateOutput"]'));
    assert.ok([...panel.querySelectorAll('input[name^="generator.world."]')].every((slider) => !slider.disabled));
    assert.equal(AgeEditor.change(app, id, (age) => (age.era = "darkAge")), true);
});

test("the cut carries the parent's Generate settings: its own seed, an event's place moved onto the regional map or dropped outside it", async () => {
    const { RegionalExtractor } = await import("../../src/applications/RegionalExtractor.js");
    const settings = {
        seed: "Parent's seed",
        nameBase: "French",
        world: { density: 1.5, urbanisation: 0.8, realmSpacing: 1.2, fragmentation: 0.6 },
        output: { counties: false, places: { castle: false }, labels: false },
        ages: [
            { id: "age-a", era: "darkAge", strife: "warTorn", events: [{ kind: "plague" }] },
            { id: "age-b", era: "advancement", strife: "troubled", events: [{ kind: "invasion", culture: "hill" }, { kind: "civilWar", place: { x: 150, y: 120 } }, { kind: "disaster", place: { x: 10, y: 10 } }] },
        ],
    };
    const carried = RegionalExtractor.carrySettings(settings, { x: 100, y: 100, width: 100, height: 50 }, 4, 400, 200);
    assert.equal(carried.seed, "", "the regional map's own seed");
    assert.equal(carried.nameBase, "French");
    assert.deepEqual(carried.world, settings.world);
    assert.equal(carried.output.counties, false);
    assert.equal(carried.output.places.castle, false);
    assert.equal(carried.output.labels, false);
    assert.deepEqual(carried.ages.map(({ id, era, strife }) => [id, era, strife]), [["age-a", "darkAge", "warTorn"], ["age-b", "advancement", "troubled"]]);
    assert.deepEqual(carried.ages[0].events, [{ kind: "plague" }]);
    assert.deepEqual(carried.ages[1].events, [{ kind: "invasion", culture: "hill" }, { kind: "civilWar", place: { x: 200, y: 80 } }, { kind: "disaster", place: null }], "inside moved, outside dropped to the fallback");
    assert.equal(settings.ages[1].events[1].place.x, 150, "the parent's own settings untouched");
    assert.equal(RegionalExtractor.carrySettings(undefined, { x: 0, y: 0 }, 2, 10, 10).ages.length, 1, "a parent with no settings gives the defaults");
});
