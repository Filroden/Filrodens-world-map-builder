// Shared loading for the generator tests: the P0JBVA map's generator input (its mesh, terrain,
// climate and rivers, from the fixtures rebuilt by tests/mesh/fixtures/build-p0jbva.mjs), and the
// settlement prototype's figures on the same map (fixtures/prototype-baseline.json).
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MeshBuilder } from "../../src/mesh/MeshBuilder.js";
import { effectiveKmPerPx } from "../../src/mesh/Schema.js";
import { buildGeneratorPayload } from "../../src/generator/GeneratorInput.js";

const here = dirname(fileURLToPath(import.meta.url));
const MESH_FIXTURES = join(here, "..", "mesh", "fixtures");
const RASTERS = join(MESH_FIXTURES, "p0jbva", "p0");

export const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
export const BASELINE = readJson(join(here, "fixtures", "prototype-baseline.json"));

/** Present when the P0JBVA rasters (with climate and rivers) have been built; tests that need them skip otherwise. */
export const GENERATOR_SKIP = ["elev.f32", "moist.f32", "temp.f32", "rivers.json"].every((name) => existsSync(`${RASTERS}.${name}`))
    ? false
    : "P0JBVA rasters missing: run node tests/mesh/fixtures/build-p0jbva.mjs";

/** The rivers file in the shape the Studio holds them (app.currentRiverData). */
function riverData(record) {
    const flows = new Map();
    const vectors = record.rivers.map((river) => {
        if (river.flow) flows.set(river.id, Float32Array.from(river.flow));
        return { id: river.id, mergeInto: river.mergeInto, path: river.path.map(([x, y, lake]) => ({ x, y, isLake: lake === 1 })) };
    });
    return { vectors, network: { flows, pixelsPerBaseline: record.pixelsPerBaseline } };
}

let p0 = null;
/** The P0JBVA map, its mesh and what the generator is given (built once per test file). */
export function loadP0Generator() {
    if (p0) return p0;
    const mapData = readJson(join(MESH_FIXTURES, "p0jbva.json"));
    mapData.mesh = readJson(join(MESH_FIXTURES, "p0jbva-realms.json")).mesh;
    const mesh = MeshBuilder.fromMapData(mapData);
    const f32 = (name) => new Float32Array(readFileSync(`${RASTERS}.${name}.f32`).buffer.slice(0));
    const buffers = { elevation: f32("elev"), moisture: f32("moist"), temperature: f32("temp"), waterMask: f32("water") };
    const rivers = riverData(readJson(`${RASTERS}.rivers.json`));
    const makePayload = (settings = {}) =>
        buildGeneratorPayload({ mesh, buffers, seaLevel: mapData.params.seaLevel, kmPerPx: effectiveKmPerPx(mapData), riverData: rivers, mapSeed: mapData.seed, settings });
    p0 = { mapData, mesh, buffers, rivers, makePayload };
    return p0;
}
