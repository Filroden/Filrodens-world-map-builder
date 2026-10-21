// Builds the P0JBVA terrain rasters the mesh tests read, by running the module's own generation
// pipeline on fixtures/p0jbva.json outside Foundry (the same code the Studio runs on load, on the
// main thread). The rasters are derived data, so they are not kept in the repository: this script
// rebuilds them in about 10 s, locally and in CI.
//
//   node tests/mesh/fixtures/build-p0jbva.mjs                # always rebuild
//   node tests/mesh/fixtures/build-p0jbva.mjs --if-missing   # only when a raster is absent (npm test)
//
// Writes fixtures/p0jbva/p0.{meta.json, elev.f32, water.f32, river.u8}: elevation, the water mask
// (> 0 where a pixel is lake) and the river map (> 0 where a pixel is river), the buffers
// MeshIntegration.terrainBuffers hands to Mesh.aggregate; and p0.{moist.f32, temp.f32, rivers.json}:
// moisture, temperature and the traced rivers with their flow, which the generator reads.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import "../foundry-stubs.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "p0jbva");
const prefix = join(out, "p0");
const RASTERS = ["meta.json", "elev.f32", "water.f32", "river.u8", "moist.f32", "temp.f32", "rivers.json"];

if (process.argv.includes("--if-missing") && RASTERS.every((name) => existsSync(`${prefix}.${name}`))) {
    console.log("P0JBVA rasters present; not rebuilt (drop --if-missing to force)");
    process.exit(0);
}

const { ProceduralOrchestrator } = await import("../../../src/ProceduralOrchestrator.js");
const { setupApp } = await import("../../support/pipeline-setup.mjs");

const payload = JSON.parse(readFileSync(join(here, "p0jbva.json"), "utf8"));
const app = setupApp(payload);
app.markDirty = () => {};

const started = performance.now();
await ProceduralOrchestrator.processTopographyPhase(app);
await ProceduralOrchestrator.processClimatePhase(app, null);
ProceduralOrchestrator.processFeaturePhase(app, false);
console.log(`pipeline ${(performance.now() - started).toFixed(0)} ms`);

mkdirSync(out, { recursive: true });
writeFileSync(`${prefix}.elev.f32`, Buffer.from(app.currentElevationData.buffer));
writeFileSync(`${prefix}.water.f32`, Buffer.from(app.bufferWaterMask.buffer));
writeFileSync(`${prefix}.river.u8`, Buffer.from(app.bufferRiverMap.buffer));
writeFileSync(`${prefix}.moist.f32`, Buffer.from(app.currentMoistureData.buffer));
writeFileSync(`${prefix}.temp.f32`, Buffer.from(app.currentTemperatureData.buffer));
writeFileSync(`${prefix}.rivers.json`, JSON.stringify(riverRecord(app.currentRiverData)));
writeFileSync(`${prefix}.meta.json`, JSON.stringify({ W: app.mapWidth, H: app.mapHeight, seaLevel: app.uiState.seaLevel, latTop: app.uiState.latTop, latBottom: app.uiState.latBottom }));
console.log(`P0JBVA rasters written to ${out}`);
process.exit(0);

/**
 * The traced rivers as JSON: each river's id, whether it joins another, its path as [x, y, lake]
 * points and its flow at each point (see tests/generator/helpers.mjs, which turns it back into the
 * shape the Studio holds).
 */
function riverRecord(riverData) {
    const flows = riverData?.network?.flows;
    const rivers = (riverData?.vectors ?? []).map((river) => ({
        id: river.id,
        mergeInto: river.mergeInto ?? null,
        path: river.path.map((point) => [point.x, point.y, point.isLake ? 1 : 0]),
        flow: flows?.get(river.id) ? Array.from(flows.get(river.id)) : null,
    }));
    return { pixelsPerBaseline: riverData?.network?.pixelsPerBaseline ?? 1, rivers };
}
