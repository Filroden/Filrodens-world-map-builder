// The world's own rail (S0 step 4a; its two groups, step 4c-1): its tools in the registry (the
// overview, the settings pages, what acts on all maps), the pages' frame (WorldEditors: the head's
// changes and Revert changes, Read by, the held banner, a group captured and put back), the world
// overview (WorldOverview: its line, its two groups of cards chosen as Worlds' are, the map in the
// inspector) and their templates, drawn in happy-dom.
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
await templates.load(["shell/parts/section.hbs", "shell/parts/shared-range.hbs", "shell/parts/page-head.hbs", "world/parts/world-editor-head.hbs", "world/tools-worldOverview.hbs", "world/tools-worldSetup.hbs", "world/tools-worldClimate.hbs", "world/tools-worldBiomes.hbs", "world/parts/inspector-biome-builtin.hbs", "world/parts/inspector-world-map.hbs", "shell/toolbar.hbs"]);
let next = 0;
installPlatform({ i18n, templates, module: { version: "5.0.0", host: "web", hostVersion: null }, store: createWebStore(new MemoryRecords(), { newId: () => `id${++next}` }), utils: { ...platform.utils } });

const { WORLD_EDITORS, WorldEditors } = await import("../../src/studios/world/app/WorldEditors.js");
const { WorldMapCard, WorldOverview } = await import("../../src/studios/world/app/WorldOverview.js");
const { WORLD_DEFINITION } = await import("../../src/studios/world/definition.js");
const { BiomeEditor } = await import("../../src/studios/world/app/BiomeEditor.js");
const { FILRODENSWMB } = await import("../../src/config.js");

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

test("the world's rail: World settings (the overview first, Climate base until step 4c-2) and All maps, none on a map's rail", () => {
    const rail = WORLD_DEFINITION.worldRail("surface").map((stage) => `${stage.id}:${stage.tools.map((tool) => tool.id + (tool.later ? "(later)" : "")).join(",")}`);
    assert.deepEqual(rail, [
        "worldSettings:worldOverview,worldSetup,worldCultures,worldAges,library,worldBiomes,worldClimate",
        "worldWhole:worldGenerateAll,worldCut(later)",
    ]);
    assert.equal(WORLD_DEFINITION.tool("worldNameStyle"), null, "the default naming style is Cultures'");
    assert.deepEqual([WORLD_DEFINITION.tool("worldCultures").icon, WORLD_DEFINITION.tool("worldGenerateAll").icon], ["groups", "run"]);
    for (const tool of ["worldOverview", ...Object.keys(WORLD_EDITORS)]) {
        assert.ok(WORLD_DEFINITION.isWorldTool(tool), `${tool} is the world's`);
        assert.ok(WORLD_DEFINITION.offers(tool, "surface", "create") && WORLD_DEFINITION.offers(tool, "surface", "explore"), `${tool} in either mode`);
    }
    for (const mode of ["create", "explore"]) {
        const map = WORLD_DEFINITION.railStages("surface", mode).flatMap((stage) => stage.tools.map((tool) => tool.id));
        assert.ok(!map.some((tool) => WORLD_DEFINITION.isWorldTool(tool)), `none on the map's ${mode} rail`);
    }
    assert.ok(!WORLD_DEFINITION.isWorldTool("terrain") && !WORLD_DEFINITION.isWorldTool("manage"));
    assert.deepEqual(Object.values(WORLD_EDITORS).map((editor) => editor.groups.join("+")), ["setup", "cultures+nameStyle", "ages", "styles+icons", "biomes", "climate"]);
    // Every page's Read by names map tools that exist on the Surface map
    for (const [tool, editor] of Object.entries(WORLD_EDITORS)) {
        assert.ok(editor.readBy.length, `${tool} is read by a map tool`);
        for (const reader of editor.readBy) {
            const entry = WORLD_DEFINITION.tool(reader);
            assert.ok(entry && !WORLD_DEFINITION.isWorldTool(reader) && entry.stage && WORLD_DEFINITION.offers(reader, "surface", entry.mode), `${tool}: ${reader} is a Surface map tool`);
        }
    }
    assert.equal(WORLD_DEFINITION.tool("worldGenerateAll").act, "generateAll", "Generate all acts at once");
    assert.ok(WorldEditors.isAside("manage") && !WorldEditors.isAside("worldClimate"), "only Worlds closes back to the tool left");
});

test("the world's rail drawn: its tools open as the world's, Generate all acts, the part to come disabled with its tooltip", async () => {
    const railStages = WORLD_DEFINITION.worldRail("surface").map((stage) => ({ ...stage, tools: stage.tools.map((tool) => ({ ...tool, action: tool.act ?? "openWorldTool", disabled: !!tool.later, tooltip: tool.later ? "later" : null })) }));
    const box = await render("shell/toolbar.hbs", { railWorld: true, railStages, railOccasional: [], activeTool: "worldClimate" });
    assert.ok(box.querySelector("nav.fwmb-rail--world"));
    assert.deepEqual([...box.querySelectorAll(".fwmb-rail-stage")].map((stage) => stage.textContent), ["StageWorldSettings", "StageWorldWhole"]);
    assert.equal(box.querySelector('[aria-current="page"]').dataset.tool, "worldClimate");
    assert.deepEqual([...box.querySelectorAll('[data-action="openWorldTool"]')].map((button) => button.dataset.tool), ["worldOverview", "worldSetup", "worldCultures", "worldAges", "library", "worldBiomes", "worldClimate"]);
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

test("a page's head: what this sitting changed, Revert changes or Undo, Read by and the held banner", async () => {
    const readBy = [{ tool: "biomes", icon: "forest", name: "Biomes", map: "Surface map", goLabel: "Go to Biomes", disabled: false, tooltip: null }];
    const head = (options) => WorldEditors.head({}, { tool: "worldClimate", changed: false, heldCount: 0, heldBy: null, readBy, ...options });
    assert.deepEqual([head().changes, head({ changed: true }).changes], ["WorldNoChanges", "WorldChangedRuns"]);
    assert.deepEqual([head().canRevert, head({ changed: true }).canRevert], [false, true]);
    assert.deepEqual([head().heldReach, head({ heldCount: 1 }).heldReach, head({ heldCount: 2 }).heldReach], [null, "ReadByHeldOne 1", "ReadByHeld 2"]);
    const styles = WorldEditors.head({}, { tool: "library", changed: true, heldCount: 0, heldBy: null });
    assert.deepEqual([styles.undo, styles.canRevert, styles.changes], [true, false, "WorldStylesUndo"], "Styles and icons: Undo, not Revert changes");
    const held = head({ changed: true, heldBy: "Aethoria" });
    assert.deepEqual([held.held, held.canRevert, held.heldBanner], [true, false, "WorldHeldBanner Aethoria"]);
    assert.equal(WorldEditors.head({}, { tool: "worldSetup", changed: false, heldCount: 0, heldBy: "Aethoria" }).heldBanner, "WorldHeldSetup Aethoria");

    const page = async (worldEditor) => {
        const box = await render("shell/parts/page-head.hbs", { panel: { title: "WorldClimate", crumb: "Aethoria", worldEditor } });
        box.insertAdjacentHTML("beforeend", await platform.templates.render("modules/filrodens-world-map-builder/templates/world/tools-worldClimate.hbs", { worldEditor, uiState: studio().uiState }));
        return box;
    };
    let box = await page(head());
    assert.match(box.querySelector(".fwmb-page-crumb").textContent, /Aethoria/);
    assert.equal(box.querySelector(".fwmb-page-title").textContent, "WorldClimate");
    assert.ok(box.querySelector(".fwmb-tag"), "the World tag");
    const revert = box.querySelector('[data-action="revertWorldGroup"]');
    assert.equal(revert.dataset.tool, "worldClimate");
    assert.ok(revert.disabled, "nothing to revert yet");
    assert.equal(box.querySelector(".fwmb-page-changes").textContent, "WorldNoChanges");
    const go = box.querySelector('.fwmb-readby [data-action="goToMapTool"]');
    assert.deepEqual([go.dataset.tool, go.getAttribute("aria-label")], ["biomes", "Go to Biomes"]);
    assert.ok(!box.querySelector("fieldset.fwmb-world-editor").disabled);
    assert.ok(box.querySelector('input[name="globalTemp"]') && box.querySelector('input[name="noise.moisture.scale"]'), "Climate and Moisture's sliders");

    box = await page(held);
    assert.ok(box.querySelector("fieldset.fwmb-world-editor").disabled, "read only on a held world");
    assert.match(box.querySelector(".fwmb-held").textContent, /WorldHeldBanner Aethoria/);
    assert.equal(box.querySelector('.fwmb-held [aria-disabled="true"]').textContent.trim(), "OpenParentSettings", "Open parent world settings waits for step 5");
    assert.equal(box.querySelector('[data-action="revertWorldGroup"]'), null, "nothing to revert on a held world");

    box = await render("shell/parts/page-head.hbs", { panel: { title: "ToolLibrary", crumb: "Aethoria", worldEditor: styles } });
    assert.ok(box.querySelector('[data-action="undoBrush"]') && box.querySelector('[data-action="redoBrush"]'), "Undo and Redo in Styles and icons' head");
    box = await render("shell/parts/page-head.hbs", { panel: { title: "WorldOverview", crumb: "Aethoria", overview: true, worldEditor: { lede: "line" } } });
    assert.deepEqual([box.querySelector(".fwmb-tag"), box.querySelector(".fwmb-page-lede").textContent], [null, "line"], "the overview: its line, no tag");
});

test("World setup: the world's frame first (its size read only), then the new world's fields with their button", async () => {
    const context = { worldEditor: WorldEditors.head({}, { tool: "worldSetup", changed: false, heldCount: 0, heldBy: null }), uiState: studio().uiState, engineLabels: {}, worldSetup: { isNew: false, width: 1400, height: 1120 } };
    let box = await render("world/tools-worldSetup.hbs", context);
    const generation = box.querySelector('[data-section="generation"]');
    assert.ok(generation.querySelector('[name="generationEngine"]') && generation.querySelector('[name="mapSeed"]') && generation.querySelector('[name="mapWidth"]'));
    assert.equal(generation.querySelector('[data-action="applyResolution"]').textContent.trim(), "CreateNewWorld");
    const scale = box.querySelector('[data-section="worldScale"]');
    assert.ok(scale.querySelector('[name="latTop"]') && scale.querySelector('[name="worldAreaFactor"]') && scale.querySelector('[name="mapUnitName"]'));
    assert.deepEqual([...box.querySelectorAll("[data-section]")].map((section) => section.dataset.section), ["worldScale", "generation"], "the frame first");
    assert.match(scale.textContent, /1400 × 1120[\s\S]*WorldSizeFixed/, "the size, fixed once a map is made");
    box = await render("world/tools-worldSetup.hbs", { ...context, worldSetup: { isNew: true, width: 1400, height: 1120 } });
    assert.equal(box.querySelector('[data-action="applyResolution"]').textContent.trim(), "CreateWorld", "New world's button");
});

test("the overview's line", () => {
    const app = studio();
    assert.equal(WorldOverview.line(app), "EngineShortAdvanced · OverviewSeed P0JBVA · 1400 × 1120 · OverviewAreaFactor 15 · OverviewLatitudes 60° North,20° North · OverviewNotSaved");
    app.isDirty = true;
    assert.match(WorldOverview.line(app, ["WorldClimate"]), /OverviewUnsavedGroups WorldClimate$/);
});

test("the overview's two groups: what is in the world, and the regional worlds cut from it; cards chosen as Worlds' are", async () => {
    const app = studio();
    const overview = { ...(await WorldOverview.context(app)) };
    overview.regional = [{ id: "w2", mapId: "m2", name: "Westmarch", thumbnail: null, marks: [], meta: "1 map", selected: true }];
    const box = await render("world/tools-worldOverview.hbs", { overview });
    const titles = (selector) => [...box.querySelectorAll(`${selector} .fwmb-card-title`)].map((title) => title.textContent.trim());
    assert.deepEqual(titles(".fwmb-world-group:not(.fwmb-world-group--related)"), ["LayerSurfaceFull", "AddMap"]);
    assert.deepEqual(titles(".fwmb-world-group--related"), ["Westmarch", "CutRegionalWorld"]);
    assert.match(box.querySelector(".fwmb-world-group--related .fwmb-card-opens").textContent, /OverviewOpensOwn/, "a regional world opens as its own world");
    assert.equal(box.querySelector('[data-action="selectMapCard"]').getAttribute("aria-current"), "false");
    const regional = box.querySelector('[data-action="selectWorld"]');
    assert.deepEqual([regional.dataset.worldId, regional.getAttribute("aria-current")], ["w2", "true"]);
    assert.equal(box.querySelectorAll('.fwmb-overview [aria-disabled="true"]').length, 2, "Add a map and Cut regional world… wait for their steps");
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

test("Biomes' table: built-in then custom, the four numbers Generate reads, a custom biome taking another's saying so", async () => {
    const app = studio();
    app.uiState.customBiomes = [{ id: 14, name: "Moor", color: [10, 20, 30], behavesLike: "TAIGA", rules: [{}] }, { id: 15, name: "Witchwood", code: "WW", color: [1, 2, 3], properties: { farming: 0.6, cover: 0.7, travel: 2.2, raiders: 1.5 } }];
    const list = [
        { key: "GRASSLAND", label: "FILRODENSWMB.BIOMES.GRASSLAND", hex: "#010203", isCustom: false, placement: "land" },
        { key: "OCEAN_DEEP", label: "FILRODENSWMB.BIOMES.OCEAN_DEEP", hex: "#000010", isCustom: false, placement: "underwater" },
        { id: 14, label: "Moor", hex: "#0a141e", isCustom: true, placement: "land" },
        { id: 15, label: "Witchwood", hex: "#010203", isCustom: true, placement: "land" },
    ];
    const table = BiomeEditor.table(app, list);
    const grass = FILRODENSWMB.GENERATOR.BIOMES.GRASSLAND;
    assert.deepEqual(table.rows[0].numbers, [grass.farming, grass.cover, grass.travel, grass.raiders].map(String));
    assert.deepEqual(table.rows[1].numbers, ["–", "–", "–", "–"], "a water biome has none");
    assert.match(table.rows[2].behaves, /^BiomeBehavesLikeRow /);
    assert.deepEqual([table.rows[2].hasRules, table.rows[3].numbers, table.rows[3].code], [true, ["0.6", "0.7", "2.2", "1.5"], "WW"]);
    assert.equal(table.count, "BiomeTableCount 2,2");
    const box = await render("world/tools-worldBiomes.hbs", { biomeTable: table, worldEditor: WorldEditors.head({}, { tool: "worldBiomes", changed: false, heldCount: 0, heldBy: null }) });
    assert.deepEqual([...box.querySelectorAll("tbody tr")].map((row) => row.dataset.action), ["editBuiltInBiome", "editBuiltInBiome", "editCustomBiome", "editCustomBiome"]);
    assert.equal(box.querySelectorAll("thead th.fwmb-num").length, 4);
    assert.equal(box.querySelector('tbody tr:nth-child(3) td[colspan="4"]').textContent.trim().startsWith("BiomeBehavesLikeRow"), true);
    assert.ok(box.querySelector('.fwmb-page-bar [data-action="openBiomeRuleEditor"]'), "the rule editor at the head");
});

test("a built-in biome in the inspector: its colour, where it lies, its numbers read only", async () => {
    const app = studio();
    const biome = BiomeEditor.builtIn(app, "GRASSLAND");
    assert.deepEqual([biome.hex, biome.properties.length], ["#010203", 4]);
    assert.equal(BiomeEditor.builtIn(app, "NOT_A_BIOME"), null);
    const box = await render("world/parts/inspector-biome-builtin.hbs", BiomeEditor.BUILT_IN.context(app, biome));
    assert.equal(box.querySelector('input[name="biomeColor"]').value, "#010203");
    assert.equal(box.querySelectorAll(".fwmb-biome-reading").length, 4);
    assert.ok(box.querySelector('[data-action="openBiomeRuleEditor"]'));
    let painted = false;
    app._repaintCanvas = () => (painted = true);
    app.markDirty = () => {};
    assert.equal(BiomeEditor.BUILT_IN.apply(app, biome, null, { elements: { biomeColor: { value: "#ff0000" } } }), true);
    assert.deepEqual([app.customBiomeColors.GRASSLAND, painted], [[255, 0, 0], true]);
});

test("the map side's Go blocks to the world's pages: the scale bar, Natural features and every style picker", async () => {
    await templates.load(["world/tools-cartography.hbs", "world/tools-labels.hbs", "world/parts/style-picker.hbs", "world/parts/state-block.hbs", "shell/parts/list-query.hbs"]);
    const goes = (box, section) => [...box.querySelectorAll(`${section} .fwmb-goto [data-action="openWorldTool"]`)].map((button) => button.dataset.tool);
    let box = await render("world/tools-cartography.hbs", { uiState: {}, labelList: { rows: [] } });
    assert.deepEqual(goes(box, '[data-section="scaleBar"]'), ["worldSetup"], "the area factor and unit");
    box = await render("world/tools-labels.hbs", { uiState: {}, labelList: { rows: [] } });
    assert.deepEqual(goes(box, '[data-section="featureNames"]'), ["worldCultures"], "the default naming style");
    box = await render("world/parts/style-picker.hbs", { name: "pinStyle", choices: [], type: "Pin" });
    assert.deepEqual(goes(box, ""), ["library"], "Styles and icons");
});
