// The terrain engines' names and defaults: a new map uses Advanced (tectonics); the engine list
// runs Advanced, Guided, Flat, each named with its terrain version, and offers Legacy terrain only
// on a map made with it; a saved map with no engine recorded still loads as Legacy terrain
// ("standard"), the only engine there was when such maps were made.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import Handlebars from "handlebars";
import { installPlatform, platform } from "../../src/platform/index.js";

const i18n = { localize: (key) => key, format: (key) => key, lang: "en" };
installPlatform({ ...platform, i18n });
const { FILRODENSWMB } = await import("../../src/config.js");
const { MapStateManager } = await import("../../src/studios/world/app/MapStateManager.js");
const { TerrainVersion } = await import("../../src/studios/world/tools/TerrainVersion.js");
const { createWebTemplates, registerHelpers } = await import("../../src/platform/web/templates.js");

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (path) => readFileSync(join(ROOT, path), "utf8");

const handlebars = Handlebars.create();
registerHelpers(handlebars, i18n);
const templates = createWebTemplates({ handlebars, prefix: "modules/filrodens-world-map-builder/templates/", fetchText: async (path) => read(join("templates", path)) });
await templates.load(["shell/parts/section.hbs", "world/parts/world-editor-head.hbs", "world/tools-worldSetup.hbs"]);

/** The engine list's options, value and label, as World setup draws it for a world on this engine. */
const engineOptions = async (generationEngine) => {
    const engineLabels = Object.fromEntries(Object.keys(TerrainVersion.ENGINE_NAMES).map((engine) => [engine, `label-${engine}`]));
    const html = await templates.render("modules/filrodens-world-map-builder/templates/world/tools-worldSetup.hbs", { uiState: { generationEngine }, engineLabels, worldEditor: {} });
    const select = html.match(/<select id="fwmb-generation-engine"[\s\S]*?<\/select>/)[0];
    return [...select.matchAll(/<option value="(\w+)"([^>]*)>([^<]*)<\/option>/g)].map(([, value, attrs, label]) => ({ value, selected: /selected/.test(attrs), label: label.trim() }));
};

test("a new map uses Advanced (tectonics) at the current terrain version", () => {
    assert.equal(FILRODENSWMB.DEFAULTS.ENGINE, "advanced");
    const state = MapStateManager.buildDefaultUiState(1000, 1000);
    assert.equal(state.generationEngine, "advanced");
    assert.equal(state.terrainVersion, FILRODENSWMB.TERRAIN_VERSION.CURRENT);
});

test("every engine shows its terrain version, Legacy terrain and Flat included", () => {
    for (const engine of ["advanced", "guided", "flat", "standard"]) {
        assert.equal(TerrainVersion.getDisplayVersion({ generationEngine: engine, terrainVersion: 2 }), 2, engine);
        assert.equal(TerrainVersion.getDisplayVersion({ generationEngine: engine }), FILRODENSWMB.TERRAIN_VERSION.LEGACY, `${engine} saved before terrain versions`);
    }
});

test("the engine list runs Advanced, Guided, Flat, every option named with its version", async () => {
    assert.deepEqual(Object.keys(TerrainVersion.ENGINE_NAMES), ["advanced", "guided", "flat", "standard"]);
    const options = await engineOptions("advanced");
    assert.deepEqual(
        options.map((option) => option.value),
        ["advanced", "guided", "flat"],
    );
    for (const option of options) assert.equal(option.label, `label-${option.value}`, `the ${option.value} option shows its own label`);
    assert.deepEqual(options.filter((option) => option.selected).map((option) => option.value), ["advanced"]);
    const strings = JSON.parse(read("languages/en.json"));
    assert.equal(strings[TerrainVersion.ENGINE_NAMES.standard], "Legacy terrain");
    assert.equal(strings[TerrainVersion.ENGINE_NAMES.flat], "Flat");
});

test("Legacy terrain is offered only on a map made with it, chosen there", async () => {
    for (const engine of ["advanced", "guided", "flat"]) {
        assert.ok(!(await engineOptions(engine)).some((option) => option.value === "standard"), `not on a ${engine} map`);
    }
    const options = await engineOptions("standard");
    assert.deepEqual(options.map((option) => option.value), ["advanced", "guided", "flat", "standard"]);
    assert.deepEqual(options.filter((option) => option.selected).map((option) => option.value), ["standard"]);
});

test("a saved map with no engine recorded loads as Legacy terrain, not the new default", () => {
    const studio = read("src/studios/world/app/MapStudio.js");
    assert.match(studio, /this\.uiState\.generationEngine = payload\.generationEngine \|\| "standard";/);
    assert.match(read("src/studios/world/ProceduralOrchestrator.js"), /app\.uiState\.generationEngine \|\| "standard"/);
});
