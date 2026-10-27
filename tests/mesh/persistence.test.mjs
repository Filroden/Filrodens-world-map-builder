// Saving and loading a map on the display mesh: the compendium flags, and the JSON file format.
import "./foundry-stubs.mjs";
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { MeshIntegration } from "../../src/applications/MeshIntegration.js";
import { saveMapData } from "../../src/platform/foundry/store.js";
import { MapJson } from "../../src/data/MapJson.js";
import { MeshSession } from "../../src/mesh/MeshSession.js";
import { decodeOwners } from "../../src/mesh/OwnerLayer.js";
import { deleteLevel, deleteRegion } from "../../src/mesh/RegionEdits.js";
import { FIXTURES, P0_SKIP, loadP0, readJson } from "./helpers.mjs";
import { stubCompendium } from "./foundry-stubs.mjs";

const FLAG = "filrodens-world-map-builder";

/** A Studio stand-in holding the v3 fixture opened on its mesh, as MeshIntegration.finishLoad leaves it. */
async function openApp(areaFactor = 15) {
    const v3 = readJson(join(FIXTURES, "v3-vectors.json"));
    v3.world = { zoom: 1, originX: 0, originY: 0, rootW: v3.mapWidth, rootH: v3.mapHeight, areaFactor };
    const { session, mapData } = await MeshSession.open(v3, { buffers: loadP0().buffers });
    const app = { meshSession: session, layerSets: mapData.layerSets, mapRoutes: mapData.mapRoutes, mapPins: mapData.mapPins };
    return { app, v3, mapData };
}

/** The payload the Studio's save builds, before MeshIntegration adds the mesh fields. */
function savePayload(app, v3, mapData) {
    const { regionLayers: _unused, ...rest } = v3;
    return { ...rest, world: mapData.world, mapPins: app.mapPins, mapRoutes: app.mapRoutes };
}

test("save writes owners beside the map data, removes stale keys, and loads back identically", { skip: P0_SKIP }, async () => {
    const { app, v3, mapData } = await openApp();
    const payload = savePayload(app, v3, mapData);
    const owners = MeshIntegration.preparePayload(app, payload);
    assert.equal(payload.vectorSchemaVersion, 4);
    assert.ok(!("regionLayers" in payload));
    assert.deepEqual(Object.keys(owners).sort(), app.layerSets[0].levels.map((level) => level.id).sort());

    // The stored map is the v3 one, with an owner array of a level that no longer exists
    const doc = stubCompendium("map1", { [FLAG]: { mapData: v3, owners: { goneLevel: "AA==" } } });
    await saveMapData("Map", payload, "map1", { owners });
    const stored = doc.flags[FLAG];
    assert.ok(!("regionLayers" in stored.mapData), "the old region layers are removed");
    assert.ok(!("goneLevel" in stored.owners), "a deleted level's owners are removed");
    assert.deepEqual(stored.owners, owners);

    const reopened = await MeshSession.open(stored.mapData, { owners: stored.owners, buffers: loadP0().buffers });
    assert.equal(reopened.changed, false);
    for (const level of app.meshSession.levels()) assert.deepEqual(reopened.session.layer(level.id).owners, app.meshSession.layer(level.id).owners);
    assert.deepEqual(reopened.mapData.mapRoutes, JSON.parse(JSON.stringify(app.mapRoutes)));
    assert.equal(reopened.mapData.world.areaFactor, 15);
});

test("deleting a level removes its owners at the next save", { skip: P0_SKIP }, async () => {
    const { app, v3, mapData } = await openApp();
    const firstOwners = MeshIntegration.preparePayload(app, savePayload(app, v3, mapData));
    const doc = stubCompendium("map1", { [FLAG]: { mapData: v3, owners: firstOwners } });

    const levels = app.layerSets[0].levels;
    const removed = levels.at(-1);
    assert.ok(deleteLevel(app.meshSession, app.layerSets, removed.id).owners, "the deleted level's owners come back encoded, for undo");
    const payload = savePayload(app, v3, mapData);
    const owners = MeshIntegration.preparePayload(app, payload);
    await saveMapData("Map", payload, "map1", { owners });
    assert.ok(!(removed.id in doc.flags[FLAG].owners));
    assert.equal(doc.flags[FLAG].mapData.layerSets[0].levels.length, levels.length);
});

test("a deleted region's cells become unclaimed, and a key no region holds is saved unclaimed", { skip: P0_SKIP }, async () => {
    const { app } = await openApp();
    const level = app.layerSets[0].levels[0];
    const [first, second] = level.regions;
    deleteRegion(app.meshSession, level.id, first.id);
    assert.ok(!app.meshSession.layer(level.id).owners.includes(first.key), "deleting a region releases its cells");

    // A region taken out of the level without its cells (as an inconsistent edit would leave it)
    level.regions.splice(level.regions.indexOf(second), 1);
    const owners = MeshIntegration.preparePayload(app, {});
    assert.ok(app.meshSession.layer(level.id).owners.includes(second.key), "the live array is left alone");
    assert.ok(!decodeOwners(owners[level.id]).includes(second.key), "the saved array holds no key without a region");
});

for (const [given, expected] of [
    [1, 1],
    [15, 15],
    [40, 40],
    [99, 40],
    [0, 1],
    [2.6, 3],
    ["many", 15],
]) {
    test(`JSON export and import keep owners, with area factor ${given} read as ${expected}`, () => {
        const mapData = { seed: "S", params: {}, mapWidth: 10, mapHeight: 10, world: { zoom: 1, areaFactor: given }, layerSets: [] };
        const owners = { levelA: "CgIA", levelB: "AA==" };
        const file = JSON.parse(JSON.stringify(MapJson.toExport(mapData, owners)));
        assert.deepEqual(file.owners, owners);
        const imported = MapJson.fromImport(file);
        assert.deepEqual(imported.owners, owners);
        assert.ok(!("owners" in imported.mapData));
        assert.equal(imported.mapData.world.areaFactor, expected);
    });
}

test("a JSON file from before owners existed imports with none", () => {
    const { mapData, owners } = MapJson.fromImport({ seed: "S", params: {}, regionLayers: [] });
    assert.deepEqual(owners, {});
    assert.deepEqual(mapData.regionLayers, []);
});
