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

// ------------------------------------------------------------------ strokes and level arrays

test("a stroke marks cells for the fill as it goes, rebuilds borders once at its end and merges its patches", async () => {
    const { createLayerSet, createLevel, addRegion } = await import("../../src/mesh/Schema.js");
    const { smallSession, cellsInRect } = await import("./helpers.mjs");
    const level = createLevel({ id: "lv" });
    const region = addRegion(level, { id: "r" });
    const session = await smallSession([createLayerSet({ levels: [level] })]);
    session.layer("lv").paint(cellsInRect(session.mesh, 200, 100, 260, 160), region.key);
    session.ownersChanged("lv");
    const arcs = session.arcsFor("lv");
    session.takeOwnerChanges("lv");

    session.beginStroke();
    const first = session.layer("lv").paint(cellsInRect(session.mesh, 260, 100, 280, 160), region.key);
    session.strokeEdit("lv", first);
    const second = session.layer("lv").paint(cellsInRect(session.mesh, 270, 100, 300, 160), region.key);
    session.strokeEdit("lv", second);
    const undone = session.layer("lv").erase(cellsInRect(session.mesh, 290, 100, 300, 160));
    session.strokeEdit("lv", undone);
    assert.ok(session.isStroking);
    assert.ok(session.takeOwnerChanges("lv"), "the fill is told which cells changed");
    assert.equal(session.arcsFor("lv"), arcs, "borders stay as they were during the stroke");

    const merged = session.endStroke().get("lv");
    assert.notEqual(session.arcsFor("lv"), arcs, "borders are rebuilt once the stroke ends");
    const expected = cellsInRect(session.mesh, 260, 100, 290, 160);
    assert.deepEqual([...merged.cells].sort((a, b) => a - b), expected.sort((a, b) => a - b), "cells painted and then erased are not in the merged patch");
    assert.ok(merged.before.every((owner) => owner === -1));
});

test("a level's owners can be taken out of the session and put back", async () => {
    const { createLayerSet, createLevel } = await import("../../src/mesh/Schema.js");
    const { smallSession, cellsInRect } = await import("./helpers.mjs");
    const level = createLevel({ id: "lv" });
    const session = await smallSession([createLayerSet({ levels: [level] })]);
    session.layer("lv").paint(cellsInRect(session.mesh, 0, 0, 50, 50), 3);
    const array = session.layer("lv").owners.slice();
    const encoded = session.removeLevelOwners("lv");
    assert.ok(!session.layers.has("lv"));
    assert.equal(session.removeLevelOwners("lv"), null);
    session.restoreLevelOwners("lv", encoded);
    assert.deepEqual(session.layer("lv").owners, array);
    assert.throws(() => session.restoreLevelOwners("lv", new Int32Array(3)), /cells/);
});

test("fields added after version 4 first shipped get their defaults on load", async () => {
    const { normaliseVectorData, roundRouteThickness } = await import("../../src/mesh/Schema.js");
    const mapData = {
        params: { display: { regionOpacity: 0.7 } },
        layerSets: [{ id: "s", levels: [{ id: "l", opacity: 0.5, style: { lineColor: "#123456" }, regions: [{ id: "r", key: 0 }] }] }, { id: "t", opacity: 0.2, levels: [{ id: "m", opacity: 0.4, regions: [] }] }],
        mapRoutes: [{ id: "a", thickness: 2.4, transport: "camel" }, { id: "b", outline: false, smoothing: true }],
        mapPins: [{ id: "p" }],
    };
    normaliseVectorData(mapData);
    assert.equal(mapData.layerSets[0].opacity, 1, "a set saved without an opacity starts at 1");
    assert.equal(mapData.layerSets[0].levels[0].opacity, 0.35, "its levels take on the map's old region opacity");
    assert.equal(mapData.layerSets[1].opacity, 0.2, "a set keeps its own");
    assert.equal(mapData.layerSets[1].levels[0].opacity, 0.4, "and so do its levels");
    const level = mapData.layerSets[0].levels[0];
    assert.equal(level.nestingMode, "constrained");
    assert.equal(level.style.lineColor, "#123456");
    assert.equal(level.style.seaLineStyle, "dashed");
    assert.equal(level.regions[0].parentKey, null);
    assert.deepEqual([mapData.mapRoutes[0].thickness, mapData.mapRoutes[0].transport, mapData.mapRoutes[0].outline], [2.5, "road", true]);
    assert.deepEqual([mapData.mapRoutes[1].outline, mapData.mapRoutes[1].smoothing, mapData.mapRoutes[1].thickness], [false, true, 2]);
    assert.equal(mapData.mapPins[0].pinStyle, null);
    assert.equal(roundRouteThickness(0.05), 0.25, "never below one step");
});
