// RF2: the map's buffers (src/studios/world/app/TerrainBuffers.js) and its file read and written
// (src/studios/world/app/MapSerializer.js). The saves a browser makes are compared by
// design/checks/round-trip/; these hold the parts on their own: the settings lists, a fixture read
// and written twice the same, the session's settings never saved, and the buffers' sizes.
import "../mesh/foundry-stubs.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { installPlatform, platform } from "../../src/platform/index.js";

// No custom pin icons registered, so every fixture's pins are counted against the built-in set
installPlatform({ ...platform, settings: { ...platform.settings, get: () => undefined } });

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const { MapSerializer } = await import("../../src/studios/world/app/MapSerializer.js");
const { MapStateManager } = await import("../../src/studios/world/app/MapStateManager.js");
const { TerrainBuffers } = await import("../../src/studios/world/app/TerrainBuffers.js");

// The round-trip check's fixtures (claude/v5-rf2-plan.md §3)
const FIXTURES = ["tests/mesh/fixtures/p0jbva.json", "samples/tutorial/11-a-regional-map.json", "samples/tutorial/08-places-and-labels.json", "tests/data/fixtures/fwmb_eldoria.json", "tests/data/fixtures/fwmb_aethoria.json"];
const fixture = (path) => JSON.parse(readFileSync(join(ROOT, path), "utf8"));

/** A studio stand-in at the default frame, as the studio is before a map is loaded into it. */
function host() {
    const uiState = MapStateManager.buildDefaultUiState(2000, 1400);
    return { uiState, defaultUiState: structuredClone(uiState), regionLevels: [], mapWidth: 2000, mapHeight: 1400 };
}

/** A saved file read into a host, as MapStudio's #ingestMapPayload reads it. */
async function load(into, raw) {
    const payload = MapSerializer.prepare(raw);
    MapSerializer.readFrame(payload, into);
    const read = await MapSerializer.readContent(payload, into);
    into.brushEngine = { history: read.history };
    return into;
}

test("every setting is either saved with a map or of the session only, never both", () => {
    const defaults = Object.keys(MapStateManager.buildDefaultUiState(2000, 1400));
    const saved = new Set(MapSerializer.SAVED_SETTINGS);
    const session = new Set(MapSerializer.SESSION_SETTINGS);
    assert.equal(saved.size, MapSerializer.SAVED_SETTINGS.length, "no setting listed twice as saved");
    assert.equal(session.size, MapSerializer.SESSION_SETTINGS.length, "no setting listed twice as of the session");
    for (const key of saved) assert.ok(!session.has(key), `${key} is in both lists`);
    for (const key of defaults) assert.ok(saved.has(key) || session.has(key), `${key} is in neither list`);
    for (const key of session) assert.ok(defaults.includes(key), `${key} is of the session but has no default`);
});

test("the check on the lists finds what it looks for", () => {
    const defaults = new Set(Object.keys(MapStateManager.buildDefaultUiState(2000, 1400)));
    const listed = new Set([...MapSerializer.SAVED_SETTINGS, ...MapSerializer.SESSION_SETTINGS]);
    // Take a setting out of the lists and it is found missing
    const [first] = MapSerializer.SESSION_SETTINGS;
    listed.delete(first);
    assert.ok([...defaults].some((key) => !listed.has(key)));
});

test("reading a saved file sets every saved setting it holds, and no setting of the session", async () => {
    const before = host();
    for (const key of MapSerializer.SESSION_SETTINGS) before.uiState[key] = `kept ${key}`;
    const loaded = await load(before, fixture(FIXTURES[2]));
    for (const key of MapSerializer.SESSION_SETTINGS) {
        // The fault tool's thickness starts at the map's own default (see SESSION_SETTINGS)
        if (key === "faultThickness") assert.equal(typeof loaded.uiState[key], "number");
        else assert.equal(loaded.uiState[key], `kept ${key}`, `${key} changed on load`);
    }
    for (const key of MapSerializer.SAVED_SETTINGS) assert.notEqual(loaded.uiState[key], undefined, `${key} not set on load`);
});

for (const path of FIXTURES) {
    test(`${path}: read and written, then read and written again, gives the same file`, async () => {
        const first = MapSerializer.write(await load(host(), fixture(path))).payload;
        const second = MapSerializer.write(await load(host(), structuredClone(first))).payload;
        assert.deepEqual(second, first);
        // And keeps what the file said
        const raw = fixture(path);
        assert.equal(first.seed, raw.seed);
        assert.equal(first.mapWidth, raw.mapWidth);
        assert.equal(first.mapPins.length, (raw.mapPins ?? []).length);
        assert.equal(first.params.seaLevel, raw.params.seaLevel);
    });
}

test("a setting of the session never reaches the saved file", async () => {
    const loaded = await load(host(), fixture(FIXTURES[2]));
    const saved = JSON.stringify(MapSerializer.write(loaded).payload);
    for (const key of MapSerializer.SESSION_SETTINGS) {
        const kept = loaded.uiState[key];
        loaded.uiState[key] = typeof kept === "number" ? kept + 7 : typeof kept === "boolean" ? !kept : `changed ${key}`;
        assert.equal(JSON.stringify(MapSerializer.write(loaded).payload), saved, `${key} reached the file`);
        loaded.uiState[key] = kept;
    }
});

test("a blank map has the defaults at its frame, and nothing drawn or inherited", async () => {
    const loaded = await load(host(), fixture(FIXTURES[1]));
    MapSerializer.blankSettings(loaded);
    MapSerializer.blankMap(loaded);
    assert.deepEqual(loaded.uiState, MapStateManager.buildDefaultUiState(loaded.mapWidth, loaded.mapHeight));
    for (const list of ["manualRivers", "tectonicFaults", "mapPins", "mapRoutes", "layerSets", "landMasks", "mapLabels", "mapDecorations"]) assert.deepEqual(loaded[list], [], list);
    for (const field of ["modelRun", "parentRun", "upwindMargin", "infillInputs", "terrainUpgrade", "legacyRootSize"]) assert.equal(loaded[field], null, field);
    assert.equal(loaded.infillPending, false);
});

test("the reference image is saved with its place and read back; a map without one has the defaults", () => {
    const into = host();
    MapSerializer.readReference(into, { src: "https://example.org/sketch.png", alpha: 0.4, scale: 2, x: 10, y: 20 });
    assert.deepEqual(MapSerializer.referenceOf(into.uiState), { src: "https://example.org/sketch.png", alpha: 0.4, scale: 2, x: 10, y: 20 });
    MapSerializer.readReference(into, null);
    assert.equal(MapSerializer.referenceOf(into.uiState), null);
    const defaults = MapStateManager.buildDefaultUiState(2000, 1400);
    assert.equal(into.uiState.referenceAlpha, defaults.referenceAlpha);
});

test("the terrain buffers are made at the map's size, of their types, and made afresh empty what was kept", () => {
    const terrain = new TerrainBuffers();
    for (const field of TerrainBuffers.FIELDS) assert.ok(field in terrain, field);
    terrain.generationBase = new Float32Array(4);
    terrain.bufferScratch = new Float32Array(4);
    terrain.allocate(30, 20);
    for (const field of TerrainBuffers.DATA) assert.equal(terrain[field].length, 600, field);
    assert.ok(terrain.currentElevationData instanceof Float32Array);
    assert.ok(terrain.currentBiomeOverrides instanceof Uint8Array);
    for (const field of ["bufferRivers", "bufferSurfaceBiomes", "bufferUnderwaterBiomes", "bufferTerrainAux", "bufferContours", "bufferBiomeFallback"]) assert.equal(terrain[field].length, 2400, field);
    for (const field of ["bufferScratch", "surfaceTexture", "generationInputs", "generationBase", "currentRiverData"]) assert.equal(terrain[field], null, field);
    assert.equal(terrain.surfaceTextureUnavailable, false);
    assert.deepEqual(terrain.forCanvas(), { surface: terrain.bufferSurfaceBiomes, underwater: terrain.bufferUnderwaterBiomes, aux: terrain.bufferTerrainAux, rivers: terrain.bufferRivers });
});

test("the studio reads and sets each buffer under its old name, on its terrain buffers", () => {
    class Studio {
        constructor() {
            this.terrain = new TerrainBuffers();
        }
    }
    TerrainBuffers.expose(Studio);
    const studio = Object.assign(new Studio(), { mapWidth: 4, mapHeight: 3 });
    MapStateManager.allocateBuffers(studio);
    assert.equal(studio.currentElevationData, studio.terrain.currentElevationData);
    assert.equal(studio.bufferRivers.length, 48);
    const raster = new Float32Array(12);
    studio.currentMoistureData = raster;
    assert.equal(studio.terrain.currentMoistureData, raster);
    // A stand-in with no terrain buffers is given the fields directly, as before
    const standIn = { mapWidth: 4, mapHeight: 3 };
    MapStateManager.allocateBuffers(standIn);
    assert.equal(standIn.bufferWaterMask.length, 12);
    assert.equal(standIn.generationBase, null);
});
