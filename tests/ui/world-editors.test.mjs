// The world's own rail (S0 step 4a): its tools in the registry (the overview, the settings
// editors, the parts 4b and step 5 build), the editors' frame (WorldEditors: the head's reach
// line, the held banner and Revert changes, a group captured and put back), the world overview
// (WorldOverview: its line, its cards chosen as Worlds' are, the map in the inspector) and their
// templates, drawn in happy-dom.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import Handlebars from "handlebars";
import { Window } from "happy-dom";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const window = new Window({ url: "http://localhost/" });
for (const name of Object.getOwnPropertyNames(window)) {
    if (/^[A-Z]/.test(name) && !(name in globalThis)) globalThis[name] = window[name];
}
Object.assign(globalThis, { window, document: window.document });
const document = window.document;

const { installPlatform, platform } = await import("../../src/platform/index.js");
const { createWebTemplates, registerHelpers } = await import("../../src/platform/web/templates.js");
const { createWebStore, MemoryRecords } = await import("../../src/platform/web/store.js");
const i18n = { localize: (key) => key.replace("FILRODENSWMB.UI.", ""), format: (key, data) => `${key.replace("FILRODENSWMB.UI.", "")} ${Object.values(data).join(",")}`, lang: "en" };
const handlebars = Handlebars.create();
registerHelpers(handlebars, i18n);
const templates = createWebTemplates({ handlebars, prefix: "modules/filrodens-world-map-builder/templates/", fetchText: async (path) => readFileSync(join(ROOT, "templates", path), "utf8") });
await templates.load(["shell/parts/section.hbs", "shell/parts/shared-range.hbs", "world/parts/world-editor-head.hbs", "world/tools-worldOverview.hbs", "world/tools-worldSetup.hbs", "world/tools-worldClimate.hbs", "world/tools-worldNameStyle.hbs", "world/tools-worldBiomes.hbs", "world/parts/inspector-world-map.hbs", "shell/toolbar.hbs"]);
let next = 0;
installPlatform({ i18n, templates, module: { version: "5.0.0", host: "web", hostVersion: null }, store: createWebStore(new MemoryRecords(), { newId: () => `id${++next}` }), utils: { ...platform.utils } });

const { WORLD_EDITORS, WorldEditors } = await import("../../src/studios/world/app/WorldEditors.js");
const { WorldMapCard, WorldOverview } = await import("../../src/studios/world/app/WorldOverview.js");
const { WORLD_DEFINITION } = await import("../../src/studios/world/definition.js");

const render = async (path, context) => {
    const box = document.createElement("div");
    box.innerHTML = await platform.templates.render(`modules/filrodens-world-map-builder/templates/${path}`, context);
    return box;
};

const studio = () => ({
    uiState: {
        latTop: 60,
        latBottom: 20,
        mapUnit: "km",
        world: { areaFactor: 15 },
        generationEngine: "advanced",
        mapSeed: "P0JBVA",
        generatorSettings: { nameBase: "English", ages: [{}, {}, {}] },
        cultures: [{}, {}, {}, {}],
        customBiomes: [{ id: 14, name: "Moor" }],
        nextCustomBiomeId: 15,
        globalTemp: 0.5,
        seasonOffset: 0,
        altCooling: 0.4,
        freezingThreshold: 0.2,
        globalMoisture: 0.5,
        "noise.moisture.scale": 1200,
        customPinStyles: [{ id: "a" }, { id: "b", builtIn: true }],
    },
    customBiomeColors: { GRASSLAND: [1, 2, 3] },
    mapWidth: 1400,
    mapHeight: 1120,
});

test("the world's rail: the overview, the seven settings, the whole world, none on a map's rail", () => {
    const rail = WORLD_DEFINITION.worldRail("surface").map((stage) => `${stage.id}:${stage.tools.map((tool) => tool.id + (tool.later ? "(later)" : "")).join(",")}`);
    assert.deepEqual(rail, [
        "world:worldOverview",
        "worldSettings:worldSetup,worldCultures,worldAges,worldNameStyle,library,worldBiomes,worldClimate",
        "worldWhole:worldGenerateAll,worldCut(later)",
    ]);
    for (const tool of ["worldOverview", ...Object.keys(WORLD_EDITORS)]) {
        assert.ok(WORLD_DEFINITION.isWorldTool(tool), `${tool} is the world's`);
        assert.ok(WORLD_DEFINITION.offers(tool, "surface", "create") && WORLD_DEFINITION.offers(tool, "surface", "explore"), `${tool} in either mode`);
    }
    for (const mode of ["create", "explore"]) {
        const map = WORLD_DEFINITION.railStages("surface", mode).flatMap((stage) => stage.tools.map((tool) => tool.id));
        assert.ok(!map.some((tool) => WORLD_DEFINITION.isWorldTool(tool)), `none on the map's ${mode} rail`);
    }
    assert.ok(!WORLD_DEFINITION.isWorldTool("terrain") && !WORLD_DEFINITION.isWorldTool("manage"));
    assert.deepEqual(Object.values(WORLD_EDITORS).map((editor) => editor.group), ["setup", "cultures", "ages", "nameStyle", "styles", "biomes", "climate"]);
    assert.equal(WORLD_DEFINITION.tool("worldGenerateAll").act, "generateAll", "Generate all acts at once");
    assert.ok(WorldEditors.isAside("manage") && !WorldEditors.isAside("worldClimate"), "only Worlds closes back to the tool left");
});

test("the world's rail drawn: its tools open as the world's, Generate all acts, the part to come disabled with its tooltip", async () => {
    const railStages = WORLD_DEFINITION.worldRail("surface").map((stage) => ({ ...stage, tools: stage.tools.map((tool) => ({ ...tool, action: tool.act ?? "openWorldTool", disabled: !!tool.later, tooltip: tool.later ? "later" : null })) }));
    const box = await render("shell/toolbar.hbs", { railWorld: true, railStages, railOccasional: [], activeTool: "worldClimate" });
    assert.ok(box.querySelector("nav.fwmb-rail--world"));
    assert.deepEqual([...box.querySelectorAll(".fwmb-rail-stage")].map((stage) => stage.textContent), ["StageWorld", "StageWorldSettings", "StageWorldWhole"]);
    assert.equal(box.querySelector('[aria-current="page"]').dataset.tool, "worldClimate");
    assert.deepEqual([...box.querySelectorAll('[data-action="openWorldTool"]')].map((button) => button.dataset.tool), ["worldOverview", "worldSetup", "worldCultures", "worldAges", "worldNameStyle", "library", "worldBiomes", "worldClimate"]);
    assert.equal(box.querySelector('[data-action="generateAll"]').dataset.tool, "worldGenerateAll");
    const off = [...box.querySelectorAll('.fwmb-rail-btn[aria-disabled="true"]')];
    assert.deepEqual(off.map((button) => button.getAttribute("aria-label")), ["CutRegionalWorld"]);
    assert.ok(off.every((button) => !button.dataset.action && button.dataset.tooltip === "later"));
});

test("a group captured and put back: each editor's state, the biome colours included", () => {
    const app = studio();
    const captured = WorldEditors.capture(app);
    Object.assign(app.uiState, { latTop: 10, mapUnit: "leagues", globalTemp: 0.9, "noise.moisture.scale": 300, customBiomes: [], nextCustomBiomeId: 20 });
    app.uiState.world.areaFactor = 4;
    app.uiState.generatorSettings.nameBase = "French";
    app.customBiomeColors = {};
    assert.equal(WorldEditors.restore(app, captured, "setup"), true);
    assert.deepEqual([app.uiState.latTop, app.uiState.mapUnit, app.uiState.world.areaFactor], [60, "km", 15]);
    assert.equal(app.uiState.globalTemp, 0.9, "only the group asked for");
    WorldEditors.restore(app, captured, "climate");
    assert.deepEqual([app.uiState.globalTemp, app.uiState["noise.moisture.scale"]], [0.5, 1200]);
    WorldEditors.restore(app, captured, "nameStyle");
    assert.equal(app.uiState.generatorSettings.nameBase, "English");
    assert.deepEqual(app.uiState.generatorSettings.ages.length, 3, "the rest of the generator's settings kept");
    WorldEditors.restore(app, captured, "biomes");
    assert.deepEqual([app.uiState.customBiomes.map((biome) => biome.id), app.uiState.nextCustomBiomeId, app.customBiomeColors], [[14], 15, { GRASSLAND: [1, 2, 3] }]);
    app.uiState.customBiomes[0].name = "Heath";
    assert.equal(captured.biomes.customBiomes[0].name, "Moor", "put back as a copy, not shared");
    app.uiState.cultures = [];
    app.uiState.generatorSettings.ages = [{}];
    WorldEditors.restore(app, captured, "cultures");
    WorldEditors.restore(app, captured, "ages");
    assert.deepEqual([app.uiState.cultures.length, app.uiState.generatorSettings.ages.length, app.uiState.generatorSettings.nameBase], [4, 3, "English"], "cultures and ages put back, the name style kept");
    assert.equal(WorldEditors.restore(app, null, "setup"), false);
});

test("an editor's head: what reads it, what this sitting changed, Revert changes, and the held banner", async () => {
    const head = (options) => WorldEditors.head({}, { tool: "worldClimate", changed: false, heldCount: 0, heldBy: null, ...options });
    assert.equal(head().reach, "WorldReach LayerSurfaceFull");
    assert.equal(head({ heldCount: 1 }).reach, "WorldReachHeldOne LayerSurfaceFull,1");
    assert.equal(head({ heldCount: 2 }).reach, "WorldReachHeld LayerSurfaceFull,2");
    assert.deepEqual([head().canRevert, head({ changed: true }).canRevert, head({ changed: true }).changedLine], [false, true, "WorldChangedRuns"]);
    assert.equal(WorldEditors.head({}, { tool: "worldNameStyle", changed: true, heldCount: 0, heldBy: null }).changedLine, "WorldChangedNames");
    const held = head({ changed: true, heldBy: "Aethoria" });
    assert.deepEqual([held.held, held.canRevert, held.heldBanner], [true, false, "WorldHeldBanner Aethoria"]);
    assert.equal(WorldEditors.head({}, { tool: "worldSetup", changed: false, heldCount: 0, heldBy: "Aethoria" }).heldBanner, "WorldHeldSetup Aethoria");

    let box = await render("world/tools-worldClimate.hbs", { worldEditor: head(), uiState: studio().uiState });
    const revert = box.querySelector('[data-action="revertWorldGroup"]');
    assert.equal(revert.dataset.group, "climate");
    assert.ok(revert.disabled, "nothing to revert yet");
    assert.ok(!box.querySelector("fieldset.fwmb-world-editor").disabled);
    assert.ok(box.querySelector('input[name="globalTemp"]') && box.querySelector('input[name="noise.moisture.scale"]'), "Climate and Moisture's sliders");

    box = await render("world/tools-worldClimate.hbs", { worldEditor: held, uiState: studio().uiState });
    assert.ok(box.querySelector("fieldset.fwmb-world-editor").disabled, "read only on a held world");
    assert.match(box.querySelector(".fwmb-held").textContent, /WorldHeldBanner Aethoria/);
    assert.equal(box.querySelector('[data-action="revertWorldGroup"]'), null, "nothing to revert on a held world");
});

test("World setup: the new world's fields with their button, then this world's", async () => {
    const context = { worldEditor: WorldEditors.head({}, { tool: "worldSetup", changed: false, heldCount: 0, heldBy: null }), uiState: studio().uiState, engineLabels: {}, worldSetup: { isNew: false } };
    let box = await render("world/tools-worldSetup.hbs", context);
    const generation = box.querySelector('[data-section="generation"]');
    assert.ok(generation.querySelector('[name="generationEngine"]') && generation.querySelector('[name="mapSeed"]') && generation.querySelector('[name="mapWidth"]'));
    assert.equal(generation.querySelector('[data-action="applyResolution"]').textContent.trim(), "CreateNewWorld");
    const scale = box.querySelector('[data-section="worldScale"]');
    assert.ok(scale.querySelector('[name="latTop"]') && scale.querySelector('[name="worldAreaFactor"]') && scale.querySelector('[name="mapUnitName"]'));
    box = await render("world/tools-worldSetup.hbs", { ...context, worldSetup: { isNew: true } });
    assert.equal(box.querySelector('[data-action="applyResolution"]').textContent.trim(), "CreateWorld", "New world's button");
});

test("the overview's line", () => {
    const app = studio();
    assert.equal(WorldOverview.line(app), "EngineShortAdvanced · OverviewSeed P0JBVA · 1400 × 1120 · OverviewAreaFactor 15 · OverviewLatitudes 60° North,20° North · OverviewNotSaved");
    app.isDirty = true;
    assert.match(WorldOverview.line(app, ["WorldClimate"]), /OverviewUnsavedGroups WorldClimate$/);
});

test("the overview's cards are chosen as Worlds' are, beside no tools of its own", async () => {
    const app = studio();
    const overview = { ...(await WorldOverview.context(app)) };
    overview.regional = [{ id: "w2", mapId: "m2", name: "Westmarch", thumbnail: null, marks: [], meta: "1 map", selected: true }];
    const box = await render("world/tools-worldOverview.hbs", { overview });
    const titles = [...box.querySelectorAll(".fwmb-overview-main .fwmb-card-title")].map((title) => title.textContent.trim());
    assert.deepEqual(titles, ["LayerSurfaceFull", "AddMap", "Westmarch", "CutRegionalWorld"]);
    assert.equal(box.querySelector('[data-action="selectMapCard"]').getAttribute("aria-current"), "false");
    const regional = box.querySelector('[data-action="selectWorld"]');
    assert.deepEqual([regional.dataset.worldId, regional.getAttribute("aria-current")], ["w2", "true"]);
    assert.equal(box.querySelectorAll('.fwmb-overview-main [aria-disabled="true"]').length, 2, "Add a map and Cut regional world… wait for their steps");
    assert.match(box.textContent, /OverviewSettlementsLater/);
    assert.equal(box.querySelector(".fwmb-overview-side"), null, "the world's tools are its rail's");
});

test("the Surface map in the inspector, from its card: its state, when saved, and Show map", async () => {
    const app = { ...studio(), inWorld: true, world: { name: "Aethoria", maps: [{ type: "surface", savedAt: new Date().toISOString(), revision: 3 }] } };
    const map = WorldMapCard.find(app, { id: "surface" });
    assert.deepEqual([map.name, map.meta], ["LayerSurfaceFull", "OverviewNoRun"]);
    assert.match(map.saved, /WorldSavedToday · WorldMapRevision 3/);
    assert.equal(WorldMapCard.header(app, map).subtitle, "Aethoria");
    assert.equal(WorldMapCard.find({ ...app, inWorld: false }, { id: "surface" }), null, "gone once a map is being worked on");
    const box = await render("world/parts/inspector-world-map.hbs", WorldMapCard.context(app, map));
    assert.ok(box.querySelector('[data-inspector-action="showMap"]'));
    let shown = false;
    WorldMapCard.actions.showMap({ showMap: () => (shown = true) });
    assert.ok(shown);
});
