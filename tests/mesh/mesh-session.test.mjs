// MeshSession: opening saved maps (migrating, decoding, rebuilding) and keeping derived data current.
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { MeshBuilder } from "../../src/mesh/MeshBuilder.js";
import { migrateMapData } from "../../src/mesh/Migration.js";
import { MeshSession, SESSION_WARNINGS } from "../../src/mesh/MeshSession.js";
import { createMeshBlock } from "../../src/mesh/Schema.js";
import { FIXTURES, P0_SKIP, loadP0, readJson } from "./helpers.mjs";

const v3 = () => readJson(join(FIXTURES, "v3-vectors.json"));
const counterIds = () => {
    let next = 0;
    return () => `id${String(next++).padStart(13, "0")}`;
};

/** Opens the v3 fixture once (with the P0JBVA terrain) and saves it, for the tests that start from a v4 map. */
let opened = null;
async function openedV3() {
    if (opened) return opened;
    const p0 = loadP0();
    const result = await MeshSession.open(v3(), { buffers: p0.buffers, idFactory: counterIds() });
    opened = { ...result, encoded: result.session.encodeOwners(), p0 };
    return opened;
}

test("opening a v3 map migrates it exactly as migrateMapData does", { skip: P0_SKIP }, async () => {
    const { session, mapData, migrated, changed } = await openedV3();
    assert.equal(migrated, true);
    assert.equal(changed, true);

    const block = createMeshBlock(v3());
    const direct = migrateMapData(v3(), MeshBuilder.fromMapData({ ...v3(), mesh: block }), { idFactory: counterIds() });
    assert.deepEqual(mapData.layerSets, direct.mapData.layerSets);
    assert.deepEqual(mapData.mapRoutes, direct.mapData.mapRoutes);
    for (const [levelId, owners] of Object.entries(direct.owners)) assert.deepEqual(session.layer(levelId).owners, owners, levelId);
    assert.equal(mapData.mesh.cells, session.mesh.cellCount);
});

test("opening a v4 map decodes its owners without migrating, and caches arcs", { skip: P0_SKIP }, async () => {
    const first = await openedV3();
    const { session, migrated, rebuilt, changed, warnings } = await MeshSession.open(first.mapData, { owners: first.encoded, buffers: first.p0.buffers });
    assert.equal(migrated, false);
    assert.equal(rebuilt, false);
    assert.equal(changed, false);
    assert.deepEqual(warnings, []);
    for (const level of session.levels()) {
        assert.deepEqual(session.layer(level.id).owners, first.session.layer(level.id).owners);
        const arcs = session.arcsFor(level.id);
        assert.ok(arcs.length > 0);
        assert.equal(session.arcsFor(level.id), arcs, "the second call returns the cached arcs");
    }
});

test("refreshAggregates after a band turns to sea changes exactly those cells and drops the arcs", { skip: P0_SKIP }, async () => {
    const first = await openedV3();
    const { session } = await MeshSession.open(first.mapData, { owners: first.encoded, buffers: first.p0.buffers });
    const level = [...session.levels()][0];
    const arcsBefore = session.arcsFor(level.id);
    const landBefore = Uint8Array.from(session.aggregates.land);

    // Sink a band of rows across the map below sea level
    const { buffers } = first.p0;
    const elevation = Float32Array.from(buffers.elevation);
    const bounds = { minX: 0, maxX: session.mesh.width - 1, minY: 500, maxY: 540 };
    for (let y = bounds.minY; y <= bounds.maxY; y++) for (let x = 0; x < session.mesh.width; x++) elevation[y * session.mesh.width + x] = buffers.seaLevel - 0.1;
    const changed = session.refreshAggregates({ ...buffers, elevation }, bounds);

    const expected = session.mesh.aggregate({ ...buffers, elevation });
    const differs = [];
    for (let cell = 0; cell < landBefore.length; cell++) if (landBefore[cell] !== expected.land[cell]) differs.push(cell);
    assert.ok(differs.length > 0);
    assert.deepEqual([...changed].filter((cell) => landBefore[cell] !== session.aggregates.land[cell]), differs);
    assert.deepEqual(session.aggregates.land, expected.land, "the bounded refresh equals a full one");
    assert.notEqual(session.arcsFor(level.id), arcsBefore, "arcs are rebuilt");
});

test("a stored mesh that no longer fits is rebuilt, its owners resampled, with a warning", { skip: P0_SKIP }, async () => {
    const first = await openedV3();
    const stale = structuredClone(first.mapData);
    stale.mesh.cells += 1;
    const { session, mapData, rebuilt, changed, warnings } = await MeshSession.open(stale, { owners: first.encoded, buffers: first.p0.buffers });
    assert.equal(rebuilt, true);
    assert.equal(changed, true);
    assert.equal(warnings[0].key, SESSION_WARNINGS.REBUILT);
    // The rebuilt mesh is the same mesh here, so resampling must give the owners back unchanged
    for (const level of session.levels()) assert.deepEqual(session.layer(level.id).owners, first.session.layer(level.id).owners);
    assert.deepEqual(
        mapData.mapRoutes.map((route) => route.waypoints),
        first.mapData.mapRoutes.map((route) => route.waypoints),
        "routes re-traced on the same mesh keep their waypoints",
    );
});

test("a map whose size changed is rebuilt from its migrated polygons", { skip: P0_SKIP }, async () => {
    const first = await openedV3();
    const resized = structuredClone(first.mapData);
    resized.mesh.width = resized.mapWidth - 10;
    const { session, mapData, rebuilt, warnings } = await MeshSession.open(resized, { owners: first.encoded, buffers: first.p0.buffers });
    assert.equal(rebuilt, true);
    assert.equal(warnings[0].key, SESSION_WARNINGS.REBUILT);
    assert.equal(mapData.mesh.width, mapData.mapWidth);
    for (const level of session.levels()) {
        for (const region of level.regions) assert.ok(session.layer(level.id).owners.includes(region.key), `${region.name} keeps its cells`);
    }
    assert.equal(mapData.mapRoutes.length, first.mapData.mapRoutes.length);
});
