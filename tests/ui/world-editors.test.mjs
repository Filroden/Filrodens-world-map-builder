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
await templates.load(["shell/parts/section.hbs", "shell/parts/shared-range.hbs", "shell/parts/page-head.hbs", "world/parts/world-editor-head.hbs", "world/tools-worldOverview.hbs", "world/tools-worldSetup.hbs", "world/tools-climate.hbs", "world/tools-scene.hbs", "world/tools-scene-foot.hbs", "world/parts/toolbar-unmade.hbs", "world/tools-worldBiomes.hbs", "world/parts/inspector-biome-builtin.hbs", "world/parts/inspector-world-map.hbs", "shell/toolbar.hbs"]);
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

test("the world's rail: World settings (the overview first) and All maps, none on a map's rail; Climate a Surface map tool", () => {
    const rail = WORLD_DEFINITION.worldRail("surface").map((stage) => `${stage.id}:${stage.tools.map((tool) => tool.id + (tool.later ? "(later)" : "")).join(",")}`);
    assert.deepEqual(rail, [
        "worldSettings:worldOverview,worldSetup,worldCultures,worldAges,library,worldBiomes",
        "worldWhole:worldGenerateAll,worldCut",
    ]);
    assert.equal(WORLD_DEFINITION.tool("worldNameStyle"), null, "the default naming style is Cultures'");
    assert.equal(WORLD_DEFINITION.tool("worldClimate"), null, "Climate base is the Surface map's Climate tool");
    // Climate: Shape, between Terrain and Biomes, with the Nexts on both sides
    assert.deepEqual(WORLD_DEFINITION.railStages("surface", "create")[0].tools.map((tool) => tool.id), ["scene", "terrain", "climate", "biomes", "features"]);
    assert.deepEqual([WORLD_DEFINITION.tool("terrain").next.tool, WORLD_DEFINITION.tool("climate").next.tool, WORLD_DEFINITION.tool("climate").icon], ["climate", "biomes", "temperature"]);
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
    assert.deepEqual(Object.values(WORLD_EDITORS).map((editor) => editor.groups.join("+")), ["setup", "cultures+nameStyle", "ages", "styles+icons", "biomes"]);
    assert.ok(WORLD_EDITORS.worldSetup.readBy.includes("climate"), "World setup's latitudes are read by Climate");
    // Every page's Read by names map tools that exist on the Surface map
    for (const [tool, editor] of Object.entries(WORLD_EDITORS)) {
        assert.ok(editor.readBy.length, `${tool} is read by a map tool`);
        for (const reader of editor.readBy) {
            const entry = WORLD_DEFINITION.tool(reader);
            assert.ok(entry && !WORLD_DEFINITION.isWorldTool(reader) && entry.stage && WORLD_DEFINITION.offers(reader, "surface", entry.mode), `${tool}: ${reader} is a Surface map tool`);
        }
    }
    assert.equal(WORLD_DEFINITION.tool("worldGenerateAll").act, "generateAll", "Generate all acts at once");
    assert.ok(WorldEditors.isAside("manage") && !WorldEditors.isAside("worldBiomes"), "only Worlds closes back to the tool left");
});

test("the world's rail drawn: its tools open as the world's, Generate all acts, Cut regional world… off with why when it cannot cut", async () => {
    const railStages = WORLD_DEFINITION.worldRail("surface").map((stage) => ({ ...stage, tools: stage.tools.map((tool) => ({ ...tool, action: tool.act ?? "openWorldTool", disabled: false, tooltip: null })) }));
    const box = await render("shell/toolbar.hbs", { railWorld: true, railStages, railOccasional: [], activeTool: "worldBiomes" });
    assert.ok(box.querySelector("nav.fwmb-rail--world"));
    assert.deepEqual([...box.querySelectorAll(".fwmb-rail-stage")].map((stage) => stage.textContent), ["StageWorldSettings", "StageWorldWhole"]);
    assert.equal(box.querySelector('[aria-current="page"]').dataset.tool, "worldBiomes");
    assert.deepEqual([...box.querySelectorAll('[data-action="openWorldTool"]')].map((button) => button.dataset.tool), ["worldOverview", "worldSetup", "worldCultures", "worldAges", "library", "worldBiomes", "worldCut"]);
    assert.equal(box.querySelector('[data-action="generateAll"]').dataset.tool, "worldGenerateAll");
    assert.deepEqual([...box.querySelectorAll('.fwmb-rail-btn[aria-disabled="true"]')], [], "nothing drawn for later");
    // With no Surface map it can cut from, Cut regional world… is off with why (MapStudio's cutOff)
    const cutOff = railStages.map((stage) => ({ ...stage, tools: stage.tools.map((tool) => (tool.id === "worldCut" ? { ...tool, disabled: true, tooltip: "NeedsSurfaceMap" } : tool)) }));
    const offBox = await render("shell/toolbar.hbs", { railWorld: true, railStages: cutOff, railOccasional: [], activeTool: "worldOverview" });
    const off = [...offBox.querySelectorAll('.fwmb-rail-btn[aria-disabled="true"]')];
    assert.deepEqual(off.map((button) => [button.getAttribute("aria-label"), button.dataset.tooltip, button.dataset.action ?? null]), [["CutRegionalWorld", "NeedsSurfaceMap", null]]);
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
    assert.equal(WorldEditors.restore(app, captured, "climate"), false, "the climate has no Revert changes (Climate's sliders reset on a double-click)");
    assert.equal(app.uiState.globalTemp, 0.9);
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
    const head = (options) => WorldEditors.head({}, { tool: "worldAges", changed: false, heldCount: 0, heldBy: null, readBy, ...options });
    assert.deepEqual([head().changes, head({ changed: true }).changes], ["WorldNoChanges", "WorldChangedRuns"]);
    assert.deepEqual([head().canRevert, head({ changed: true }).canRevert], [false, true]);
    assert.deepEqual([head().heldReach, head({ heldCount: 1 }).heldReach, head({ heldCount: 2 }).heldReach], [null, "ReadByHeldOne 1", "ReadByHeld 2"]);
    const styles = WorldEditors.head({}, { tool: "library", changed: true, heldCount: 0, heldBy: null });
    assert.deepEqual([styles.undo, styles.canRevert, styles.changes], [true, false, "WorldStylesUndo"], "Styles and icons: Undo, not Revert changes");
    const held = head({ changed: true, heldBy: "Aethoria" });
    assert.deepEqual([held.held, held.canRevert, held.heldBanner], [true, false, "WorldHeldBanner Aethoria"]);
    assert.equal(WorldEditors.head({}, { tool: "worldSetup", changed: false, heldCount: 0, heldBy: "Aethoria" }).heldBanner, "WorldHeldSetup Aethoria");

    const page = async (worldEditor) => {
        const box = await render("shell/parts/page-head.hbs", { panel: { title: "WorldSetup", crumb: "Aethoria", worldEditor } });
        box.insertAdjacentHTML("beforeend", await platform.templates.render("modules/filrodens-world-map-builder/templates/world/tools-worldSetup.hbs", { worldEditor, uiState: studio().uiState, worldSetup: { width: 1400, height: 1120, sizeFixed: true } }));
        return box;
    };
    let box = await page(head());
    assert.match(box.querySelector(".fwmb-page-crumb").textContent, /Aethoria/);
    assert.equal(box.querySelector(".fwmb-page-title").textContent, "WorldSetup");
    assert.ok(box.querySelector(".fwmb-tag"), "the World tag");
    const revert = box.querySelector('[data-action="revertWorldGroup"]');
    assert.equal(revert.dataset.tool, "worldAges");
    assert.ok(revert.disabled, "nothing to revert yet");
    assert.equal(box.querySelector(".fwmb-page-changes").textContent, "WorldNoChanges");
    const go = box.querySelector('.fwmb-readby [data-action="goToMapTool"]');
    assert.deepEqual([go.dataset.tool, go.getAttribute("aria-label")], ["biomes", "Go to Biomes"]);
    assert.ok(!box.querySelector("fieldset.fwmb-world-editor").disabled);
    assert.ok(box.querySelector('input[name="latTop"]') && box.querySelector('input[name="worldAreaFactor"]'), "the frame's fields");

    box = await page(held);
    assert.ok(box.querySelector("fieldset.fwmb-world-editor").disabled, "read only on a held world");
    assert.match(box.querySelector(".fwmb-held").textContent, /WorldHeldBanner Aethoria/);
    assert.equal(box.querySelector('.fwmb-held [data-action="openParentSettings"]').textContent.trim(), "OpenParentSettings", "Open parent world settings opens the parent (S0 step 5)");
    assert.equal(box.querySelector('[data-action="revertWorldGroup"]'), null, "nothing to revert on a held world");

    box = await render("shell/parts/page-head.hbs", { panel: { title: "ToolLibrary", crumb: "Aethoria", worldEditor: styles } });
    assert.ok(box.querySelector('[data-action="undoBrush"]') && box.querySelector('[data-action="redoBrush"]'), "Undo and Redo in Styles and icons' head");
    box = await render("shell/parts/page-head.hbs", { panel: { title: "WorldOverview", crumb: "Aethoria", overview: true, worldEditor: { lede: "line" } } });
    assert.deepEqual([box.querySelector(".fwmb-tag"), box.querySelector(".fwmb-page-lede").textContent], [null, "line"], "the overview: its line, no tag");
});

test("World setup: the world's frame only, its size set while the world has no maps and fixed once one is made", async () => {
    const context = { worldEditor: WorldEditors.head({}, { tool: "worldSetup", changed: false, heldCount: 0, heldBy: null }), uiState: studio().uiState, engineLabels: {}, worldSetup: { width: 1400, height: 1120, sizeFixed: true } };
    let box = await render("world/tools-worldSetup.hbs", context);
    assert.deepEqual([...box.querySelectorAll("[data-section]")].map((section) => section.dataset.section), ["worldScale"], "the frame alone: the engine and seed are Map setup's");
    assert.equal(box.querySelector('[name="generationEngine"], [name="terrainEngine"], [name="mapSeed"]'), null);
    const scale = box.querySelector('[data-section="worldScale"]');
    assert.ok(scale.querySelector('[name="latTop"]') && scale.querySelector('[name="worldAreaFactor"]') && scale.querySelector('[name="mapUnitName"]'));
    assert.match(scale.textContent, /1400 × 1120[\s\S]*WorldSizeFixed/, "the size, fixed once a map is made");
    assert.equal(box.querySelector('[name="mapWidth"]'), null);
    // A world being made (board N2): its name, its size, Cancel and Create world
    box = await render("world/tools-worldSetup.hbs", { ...context, worldSetup: { creating: true, name: "Northreach", width: 1000, height: 800, sizeFixed: false } });
    assert.equal(box.querySelector('[name="newWorldName"]').value, "Northreach");
    assert.deepEqual([box.querySelector('[name="mapWidth"]').value, box.querySelector('[name="mapHeight"]').value], ["1000", "800"]);
    assert.deepEqual([...box.querySelectorAll(".fwmb-page-bar [data-action]")].map((button) => button.dataset.action), ["cancelNewWorld", "createWorld"]);
});

test("Map setup: the Surface map's terrain engine and seed, made again only from Make the Surface map again…, or made at its foot before it exists", async () => {
    const terrain = (choice) => ({ uiState: studio().uiState, engineLabels: { advanced: "A", guided: "G", flat: "F" }, landMasks: [], terrainChoice: { engine: "advanced", seed: "P0JBVA", flatTexture: false, made: true, changed: false, held: false, badge: "BadgeMakesMapAgain", ...choice } });
    let box = await render("world/tools-scene.hbs", terrain());
    const section = box.querySelector('[data-section="terrainChoice"]');
    assert.equal(box.querySelector("[data-section]"), section, "Terrain first");
    assert.deepEqual([section.querySelector('[name="terrainEngine"]').value, section.querySelector('[name="terrainSeed"]').value], ["advanced", "P0JBVA"]);
    const again = section.querySelector('[data-action="makeSurfaceMap"]');
    assert.equal(again.textContent.trim(), "MakeMapAgain");
    assert.equal(again.getAttribute("aria-disabled"), "true", "off until the engine or seed differs");
    box = await render("world/tools-scene.hbs", terrain({ changed: true }));
    assert.equal(box.querySelector('[data-action="makeSurfaceMap"]').getAttribute("aria-disabled"), null);
    box = await render("world/tools-scene.hbs", terrain({ engine: "flat" }));
    assert.ok(!box.querySelector('[name="terrainSeed"]') && box.querySelector('[name="terrainFlatTexture"]'), "Flat: no seed, its textured ground");
    // Before the map exists (board N4): the fields, no Make again, nor the regional map; Make Surface map at the foot
    box = await render("world/tools-scene.hbs", terrain({ made: false, badge: null }));
    assert.equal(box.querySelector('[data-action="makeSurfaceMap"]'), null);
    assert.equal(box.querySelector('[data-section="regionalMap"]'), null);
    box = await render("world/tools-scene-foot.hbs", terrain({ made: false }));
    assert.equal(box.querySelector('[data-action="makeSurfaceMap"]').textContent.trim(), "MakeSurfaceMap");
    box = await render("world/tools-scene.hbs", terrain({ held: true }));
    assert.ok(box.querySelector('[data-section="terrainChoice"] fieldset').disabled, "read only on a held regional world");
});

test("Climate, a Surface map tool: Temperature and Moisture, a Go to World setup, read only on a held regional world", async () => {
    let box = await render("world/tools-climate.hbs", { uiState: studio().uiState });
    assert.deepEqual([...box.querySelectorAll("[data-section]")].map((section) => section.dataset.section), ["climate", "moisture"]);
    assert.ok(box.querySelector('input[name="globalTemp"]') && box.querySelector('input[name="noise.moisture.scale"]'));
    assert.equal(box.querySelector('[data-action="openWorldTool"]').dataset.tool, "worldSetup");
    assert.ok(!box.querySelector("fieldset").disabled);
    box = await render("world/tools-climate.hbs", { uiState: studio().uiState, climateHeld: "ClimateHeld Aethoria" });
    assert.ok(box.querySelector("fieldset").disabled);
    assert.match(box.querySelector(".fwmb-held").textContent, /ClimateHeld Aethoria/);
});

test("the overview's line", () => {
    const app = studio();
    assert.equal(WorldOverview.line(app), "EngineShortAdvanced · OverviewSeed P0JBVA · 1400 × 1120 · OverviewAreaFactor 15 · OverviewLatitudes 60° North,20° North · OverviewNotSaved");
    app.isDirty = true;
    assert.match(WorldOverview.line(app, ["ToolClimate"]), /OverviewUnsavedGroups ToolClimate$/);
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
    assert.equal(box.querySelectorAll('.fwmb-overview [aria-disabled="true"]').length, 1, "Add a map waits for its step");
    assert.equal(box.querySelector('.fwmb-overview [data-action="openWorldTool"][data-tool="worldCut"]').querySelector(".fwmb-card-title").textContent, "CutRegionalWorld", "Cut regional world… opens the crop");
    // Off, with why, when the Surface map cannot be cut from
    const off = await render("world/tools-worldOverview.hbs", { overview: { ...overview, cutOff: "NeedsSurfaceMap" } });
    const cut = [...off.querySelectorAll(".fwmb-world-group--related .fwmb-card--add")][0];
    assert.deepEqual([cut.getAttribute("aria-disabled"), cut.dataset.tooltip, cut.dataset.action ?? null], ["true", "NeedsSurfaceMap", null]);
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

test("Revert changes on Cultures and Ages keeps the map's homelands and events' places; making the map again keeps the world's settings but not its points", () => {
    const app = studio();
    app.uiState.cultures = [{ id: "hill", name: "Hillfolk", homelands: [{ x: 1, y: 1 }] }];
    app.uiState.generatorSettings.ages = [{ id: "age-1", events: [{ kind: "realmEvent", place: { x: 2, y: 2 } }] }];
    const captured = WorldEditors.capture(app);
    app.uiState.cultures[0].name = "Highlanders";
    app.uiState.cultures[0].homelands = [{ x: 9, y: 9 }];
    app.uiState.generatorSettings.ages[0].events[0].place = { x: 5, y: 5 };
    WorldEditors.restore(app, captured, "cultures");
    WorldEditors.restore(app, captured, "ages");
    assert.equal(app.uiState.cultures[0].name, "Hillfolk", "the culture put back");
    assert.deepEqual(app.uiState.cultures[0].homelands, [{ x: 9, y: 9 }], "its homelands on this map as they are now");
    assert.deepEqual(app.uiState.generatorSettings.ages[0].events[0].place, { x: 5, y: 5 });

    const world = WorldEditors.captureWorld(app);
    Object.assign(app.uiState, { cultures: [], globalTemp: 0.1, customPinStyles: [] });
    app.uiState.generatorSettings.ages = [{}];
    WorldEditors.restoreWorld(app, world);
    assert.deepEqual([app.uiState.cultures[0].name, app.uiState.globalTemp, app.uiState.customPinStyles.length, app.uiState.latTop], ["Hillfolk", 0.5, 2, 60], "the world's settings, the climate and styles with them");
    assert.equal("homelands" in app.uiState.cultures[0], false, "what was drawn on the map goes with it");
    assert.equal("place" in app.uiState.generatorSettings.ages[0].events[0], false);
});
