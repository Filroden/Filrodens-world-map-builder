// Shared loading for the mesh tests: small synthetic meshes, and the P0JBVA map
// (fixtures/p0jbva.json) with its terrain rasters (derived data, rebuilt by
// fixtures/build-p0jbva.mjs) and its realm layer (fixtures/p0jbva-realms.json).
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Mesh, MeshBuilder } from "../../src/mesh/MeshBuilder.js";
import { decodeOwners } from "../../src/mesh/OwnerLayer.js";

const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURES = join(here, "fixtures");
const RASTERS = join(FIXTURES, "p0jbva", "p0");

export const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

/** Present when the P0JBVA rasters have been built; tests that need them skip otherwise. */
export const P0_SKIP = existsSync(`${RASTERS}.elev.f32`) ? false : "P0JBVA rasters missing: run node tests/mesh/fixtures/build-p0jbva.mjs";

/** A small mesh on a 400 x 300 map (about 4,500 cells), built once per test file. */
let small = null;
export function smallMesh() {
    small ??= new Mesh({ width: 400, height: 300, spacing: 4, modelSpacing: 12, seed: 42, kmPerPx: 2 });
    return small;
}

/** Flat land everywhere at a given height (or with water where `isWater(x, y)`). */
export function flatAggregates(mesh, { height = 0.4, seaLevel = 0.35, isWater = null } = {}) {
    const elevation = new Float32Array(mesh.width * mesh.height).fill(height);
    if (isWater) {
        for (let y = 0; y < mesh.height; y++) for (let x = 0; x < mesh.width; x++) if (isWater(x, y)) elevation[y * mesh.width + x] = seaLevel - 0.1;
    }
    return mesh.aggregate({ elevation, seaLevel });
}

let p0 = null;
/** The P0JBVA map, its mesh, terrain aggregates and realm owners. */
export function loadP0() {
    if (p0) return p0;
    const mapData = readJson(join(FIXTURES, "p0jbva.json"));
    const realms = readJson(join(FIXTURES, "p0jbva-realms.json"));
    mapData.mesh = realms.mesh;
    const mesh = MeshBuilder.fromMapData(mapData);
    const f32 = (name) => new Float32Array(readFileSync(`${RASTERS}.${name}.f32`).buffer.slice(0));
    const riverMap = new Uint8Array(readFileSync(`${RASTERS}.river.u8`));
    // The same buffers MeshIntegration.terrainBuffers hands to the session in the Studio
    const buffers = { elevation: f32("elev"), waterMask: f32("water"), riverMap, seaLevel: mapData.params.seaLevel };
    const aggregates = mesh.aggregate(buffers);
    p0 = { mapData, mesh, buffers, aggregates, realms: decodeOwners(realms.owners), realmText: realms.owners, realmCount: realms.regions };
    return p0;
}

/** A seeded random source for test data. */
export function seededRandom(seed) {
    let state = seed | 0;
    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** True when a and b are neighbouring cells. */
export const areNeighbours = (mesh, a, b) => mesh.neighbours(a).includes(b);

/** Asserts a path is a chain of neighbouring cells. */
export function isContiguous(mesh, path) {
    for (let i = 1; i < path.length; i++) if (!areNeighbours(mesh, path[i - 1], path[i])) return false;
    return true;
}

/**
 * A mesh session on the small mesh (see smallMesh) with water down its left quarter (or where
 * `isWater(x, y)` says), holding the given layer sets (each level starts unclaimed unless `owners`
 * gives its array).
 */
export async function smallSession(layerSets = [], owners = {}, { isWater = (x) => x < smallMesh().width / 4 } = {}) {
    const { MeshSession } = await import("../../src/mesh/MeshSession.js");
    const mesh = smallMesh();
    const aggregates = flatAggregates(mesh, { isWater });
    const block = { seed: 42, spacing: 4, cells: mesh.cellCount, modelSpacingKm: 25, modelSpacingPx: 12, width: mesh.width, height: mesh.height, version: 1 };
    return new MeshSession({ mesh, meshBlock: block, layerSets, owners, aggregates });
}

/** The cells of a mesh whose site lies in the rectangle [x0, x1) x [y0, y1). */
export function cellsInRect(mesh, x0, y0, x1, y1) {
    const cells = [];
    for (let cell = 0; cell < mesh.cellCount; cell++) {
        const [x, y] = [mesh.siteX(cell), mesh.siteY(cell)];
        if (x >= x0 && x < x1 && y >= y0 && y < y1) cells.push(cell);
    }
    return cells;
}
