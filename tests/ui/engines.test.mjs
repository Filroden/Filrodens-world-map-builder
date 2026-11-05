// The terrain engines' names and defaults: a new map uses Advanced (tectonics); the engine list
// runs Advanced, Guided, Flat, Legacy generation, each named with its terrain version (on every
// engine, Legacy generation included); a saved map with no engine recorded still loads as Legacy
// generation ("standard"), the only engine there was when such maps were made.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { installPlatform, platform } from "../../src/platform/index.js";

installPlatform({ ...platform, i18n: { localize: (key) => key, format: (key) => key, lang: "en" } });
const { FILRODENSWMB } = await import("../../src/config.js");
const { MapStateManager } = await import("../../src/applications/MapStateManager.js");
const { TerrainVersion } = await import("../../src/tools/TerrainVersion.js");

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (path) => readFileSync(join(ROOT, path), "utf8");

test("a new map uses Advanced (tectonics) at the current terrain version", () => {
    assert.equal(FILRODENSWMB.DEFAULTS.ENGINE, "advanced");
    const state = MapStateManager.buildDefaultUiState(1000, 1000);
    assert.equal(state.generationEngine, "advanced");
    assert.equal(state.terrainVersion, FILRODENSWMB.TERRAIN_VERSION.CURRENT);
});

test("every engine shows its terrain version, Legacy generation and Flat included", () => {
    for (const engine of ["advanced", "guided", "flat", "standard"]) {
        assert.equal(TerrainVersion.getDisplayVersion({ generationEngine: engine, terrainVersion: 2 }), 2, engine);
        assert.equal(TerrainVersion.getDisplayVersion({ generationEngine: engine }), FILRODENSWMB.TERRAIN_VERSION.LEGACY, `${engine} saved before terrain versions`);
    }
});

test("the engine list runs Advanced, Guided, Flat, Legacy generation, every option named with its version", () => {
    assert.deepEqual(Object.keys(TerrainVersion.ENGINE_NAMES), ["advanced", "guided", "flat", "standard"]);
    const template = read("templates/tools-scene.hbs");
    const options = [...template.matchAll(/<option value="(\w+)"[^>]*generationEngine[^>]*>\{\{engineLabels\.(\w+)\}\}<\/option>/g)];
    assert.deepEqual(
        options.map((match) => match[1]),
        ["advanced", "guided", "flat", "standard"],
    );
    for (const match of options) assert.equal(match[1], match[2], `the ${match[1]} option shows its own label`);
    const strings = JSON.parse(read("languages/en.json"));
    assert.equal(strings[TerrainVersion.ENGINE_NAMES.standard], "Legacy generation");
    assert.equal(strings[TerrainVersion.ENGINE_NAMES.flat], "Flat");
});

test("a saved map with no engine recorded loads as Legacy generation, not the new default", () => {
    const studio = read("src/applications/MapStudio.js");
    assert.match(studio, /this\.uiState\.generationEngine = payload\.generationEngine \|\| "standard";/);
    assert.match(read("src/ProceduralOrchestrator.js"), /app\.uiState\.generationEngine \|\| "standard"/);
});
