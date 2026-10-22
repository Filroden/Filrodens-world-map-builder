// The map's area factor (what a pixel measures in km, without moving anything), the content
// transform that keeps regions and routes over the same ground when the noise is panned or
// rescaled (MeshIntegration.transformContent), and the noise frame itself (NoiseTransform) with
// the undo entry that steps the terrain back along with everything on it.
import "./foundry-stubs.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { MeshIntegration } from "../../src/applications/MeshIntegration.js";
import { NoiseTransform } from "../../src/applications/NoiseTransform.js";
import { VectorHistory } from "../../src/applications/VectorHistory.js";
import { MeshBuilder } from "../../src/mesh/MeshBuilder.js";
import { RouteDraft } from "../../src/mesh/RouteEdits.js";
import { addRegion, createLayerSet, createLevel, createMeshBlock, effectiveKmPerPx } from "../../src/mesh/Schema.js";
import { TerrainVersion } from "../../src/tools/TerrainVersion.js";
import { decodeModelRun, encodeModelRun } from "../../src/generator/ModelRun.js";
import { resolveSettings } from "../../src/generator/GeneratorSettings.js";
import { cellsInRect, isContiguous, smallSession } from "./helpers.mjs";

const mapData = (world) => ({ mapWidth: 1000, mapHeight: 500, seed: "AREA", params: { latTop: 60, latBottom: -60 }, world });

test("a top map's world may hold only its area factor: the rest is filled in", () => {
    const state = { mapWidth: 1000, mapHeight: 500, world: { areaFactor: 4 }, terrainVersion: 2 };
    assert.deepEqual(TerrainVersion.resolveWorld(state), { zoom: 1, originX: 0, originY: 0, rootW: 1000, rootH: 500, areaFactor: 4 });
    const regional = { mapWidth: 1000, mapHeight: 500, world: { zoom: 2, originX: 100, originY: 50, rootW: 2000, rootH: 1000, areaFactor: 4 } };
    assert.deepEqual(TerrainVersion.resolveWorld(regional), regional.world, "a regional world is kept whole");
});

test("the area factor changes what a pixel measures, not the mesh", () => {
    const base = effectiveKmPerPx(mapData(null));
    assert.ok(Math.abs(effectiveKmPerPx(mapData({ areaFactor: 16 })) - effectiveKmPerPx(mapData({ areaFactor: 4 })) / 2) < 1e-9, "four times the area factor halves the km per pixel");
    assert.equal(effectiveKmPerPx(mapData({ areaFactor: 15 })), base, "15 is the default");
    assert.equal(effectiveKmPerPx(mapData({ areaFactor: 400 })), effectiveKmPerPx(mapData({ areaFactor: 40 })), "out of range is clamped");

    const block = createMeshBlock(mapData(null));
    const before = MeshBuilder.paramsFor({ ...mapData({ areaFactor: 15 }), mesh: block });
    const after = MeshBuilder.paramsFor({ ...mapData({ areaFactor: 40 }), mesh: block });
    assert.equal(after.spacing, before.spacing);
    assert.equal(after.modelSpacing, before.modelSpacing, "the mesh block keeps the spacing the map was built with");
    assert.equal(after.seed, before.seed);
    assert.notEqual(after.kmPerPx, before.kmPerPx);
});

/** A studio stand-in with one region painted over x 150 to 250 and one two-waypoint road. */
async function studio() {
    const level = createLevel({ id: "realms", name: "Realms" });
    const west = addRegion(level, { id: "west", name: "West" });
    const layerSets = [createLayerSet({ id: "set", name: "Political", levels: [level] })];
    const session = await smallSession(layerSets);
    session.layer("realms").paint(cellsInRect(session.mesh, 150, 0, 250, 300), west.key);
    const draft = new RouteDraft(session, [], { name: "Road", transport: "road", mode: "direct" }, () => "r1");
    draft.add(session.cellAt(150, 150));
    draft.add(session.cellAt(300, 150));
    const app = { meshSession: session, layerSets, mapRoutes: [draft.finish()], mapPins: [], mapLabels: [], mapDecorations: [], tectonicFaults: [], manualRivers: [], landMasks: [], pinHistory: [], pinRedoStack: [], globalHistoryLedger: [], globalRedoLedger: [], uiState: { customBiomes: [] }, get regionLevels() { return [level]; } };
    return { app, session, west };
}

const ownedX = (session, key) => {
    const owners = session.layer("realms").owners;
    const xs = [];
    for (let cell = 0; cell < owners.length; cell++) if (owners[cell] === key) xs.push(session.mesh.siteX(cell));
    return { min: Math.min(...xs), max: Math.max(...xs), count: xs.length };
};

test("a pan moves regions and routes with the terrain, and the undo entries put them back", async () => {
    const { app, session, west } = await studio();
    const before = ownedX(session, west.key);
    const snapshot = VectorHistory.snapshot(app);
    const entries = MeshIntegration.transformContent(app, (x, y) => [x + 60, y], (x, y) => [x - 60, y]);
    assert.equal(entries.length, 1, "one entry per level");

    const after = ownedX(session, west.key);
    assert.ok(Math.abs(after.min - (before.min + 60)) <= session.mesh.spacing * 2 && Math.abs(after.max - (before.max + 60)) <= session.mesh.spacing * 2, `the region moved right by 60 (${before.min}-${before.max} to ${after.min}-${after.max})`);
    const road = app.mapRoutes[0];
    assert.equal(road.id, "r1", "the route keeps its identity");
    const near = (cell, x, y) => Math.hypot(session.mesh.siteX(cell) - x, session.mesh.siteY(cell) - y) <= session.mesh.spacing * 1.5;
    assert.ok(near(road.waypoints[0], 210, 150), "its start moved with it");
    assert.ok(near(road.waypoints.at(-1), 360, 150));
    assert.ok(road.legs.every((leg) => isContiguous(session.mesh, leg)));

    VectorHistory.push(app, VectorHistory.composite([snapshot, ...entries]));
    VectorHistory.step(app, true);
    assert.deepEqual(ownedX(session, west.key), before, "undo restores the owners");
    assert.ok(near(app.mapRoutes[0].waypoints[0], 150, 150), "and the route");
    VectorHistory.step(app, false);
    assert.deepEqual(ownedX(session, west.key), after, "redo moves them again");
});

test("a pan moves the generator's saved run with the regions, in the same undo step", async () => {
    const { app, session } = await studio();
    const mesh = session.mesh;
    const count = mesh.modelCount;
    // People in proportion to each model site's x, so a move shows as a change of value under a site
    const column = (value) => Float64Array.from({ length: count }, (_, cell) => value(cell));
    const result = {
        modelCells: {
            capacity: column(() => 0),
            population: column((cell) => Math.round(mesh.siteX(cell))),
            landArea: column(() => 1),
            security: column(() => 1),
            cleared: column(() => 0),
            water: column(() => 0),
            realm: column(() => 0),
            duchy: column(() => -1),
            county: column(() => -1),
            culture: column(() => -1),
            shareStart: new Int32Array(count + 1),
            shareCulture: new Int32Array(0),
            shareValue: new Float32Array(0),
        },
        settings: resolveSettings({}, "SEED"),
        cellCount: count,
        cultures: [],
        stats: {},
    };
    const run = JSON.parse(JSON.stringify(encodeModelRun(result, "runAAAAAAAAAAAAA")));
    app.modelRun = run;
    const snapshot = VectorHistory.snapshot(app);
    const entries = MeshIntegration.transformContent(app, (x, y) => [x + 60, y], (x, y) => [x - 60, y]);
    assert.equal(entries.length, 2, "the level's owners and the run");
    assert.notEqual(app.modelRun, run);

    const moved = decodeModelRun(app.modelRun);
    for (let cell = 0; cell < count; cell++) {
        const x = mesh.siteX(cell);
        // A site well inside takes the people of the site 60 px to its left (within a model spacing)
        if (x > 60 + mesh.modelSpacing * 2) assert.ok(Math.abs(moved.population[cell] - (x - 60)) <= mesh.modelSpacing * 1.5, `cell ${cell} at ${x}: ${moved.population[cell]}`);
        // A site whose source lies beyond the map's edge is open water with no one
        if (x < 60 - mesh.spacing * 2) assert.equal(moved.water[cell], 1);
    }

    VectorHistory.push(app, VectorHistory.composite([snapshot, ...entries]));
    VectorHistory.step(app, true);
    assert.equal(app.modelRun, run, "undo puts the run back as it was");
});

test("a rescale about the noise origin stretches the regions, and a route pushed off the map is cut to what remains", async () => {
    const { app, session, west } = await studio();
    const before = ownedX(session, west.key);
    const ratio = 1.5;
    MeshIntegration.transformContent(app, (x, y) => [x * ratio, y * ratio], (x, y) => [x / ratio, y / ratio]);
    const after = ownedX(session, west.key);
    assert.ok(after.min > before.min + 50 && after.max > before.max + 100, `the region moved out and widened (${before.min}-${before.max} to ${after.min}-${after.max})`);

    // The road now runs from x 225 to 450 on a 400 px map; its far end is cut at the edge
    const road = app.mapRoutes[0];
    assert.equal(app.mapRoutes.length, 1);
    assert.ok(session.mesh.siteX(road.waypoints.at(-1)) <= session.mesh.width && session.mesh.siteX(road.waypoints.at(-1)) > 380, `the far end now lies at the map's edge (${session.mesh.siteX(road.waypoints.at(-1))})`);
    assert.ok(road.legs.every((leg) => isContiguous(session.mesh, leg)));
    MeshIntegration.transformContent(app, (x, y) => [x + 1000, y], (x, y) => [x - 1000, y]);
    assert.equal(app.mapRoutes.length, 0, "a route moved wholly off the map is gone");
});

test("a change of noise frame is a scale about the noise origin and a shift, and its inverse", () => {
    const pan = NoiseTransform.between({ offsetX: 0, offsetY: 0, scale: 400 }, { offsetX: 50, offsetY: -20, scale: 400 });
    assert.deepEqual(pan.toTarget(100, 100), [50, 120], "panning the noise east moves the content west");
    assert.deepEqual(pan.toSource(50, 120), [100, 100]);

    const zoom = NoiseTransform.between({ offsetX: 10, offsetY: 0, scale: 400 }, { offsetX: 10, offsetY: 0, scale: 800 });
    assert.equal(zoom.ratio, 2);
    assert.deepEqual(zoom.toTarget(100, 100), [210, 200], "the content scales about the noise origin");
    assert.deepEqual(zoom.toSource(210, 200), [100, 100]);
});

test("the noise entry puts the frame and the brush strokes back on undo, and forward again on redo", () => {
    const stroke = { points: [{ x: 100, y: 100 }, { x: 140, y: 100 }], size: 20 };
    const app = { uiState: { "noise.offsetX": 0, "noise.offsetY": 0, "noise.elevation.scale": 400 }, brushEngine: { history: [stroke], redoStack: [], invalidated: 0, invalidateLayerCache() { this.invalidated++; } }, pinHistory: [], pinRedoStack: [], globalHistoryLedger: [], globalRedoLedger: [] };
    const before = NoiseTransform.current(app);
    const after = { offsetX: 50, offsetY: 0, scale: 800 };
    NoiseTransform.apply(app, after);
    assert.deepEqual(NoiseTransform.current(app), after);
    assert.deepEqual(stroke.points.map((p) => p.x), [150, 230], "the strokes moved with the terrain");
    assert.equal(stroke.size, 40, "and grew with it");
    VectorHistory.push(app, VectorHistory.noise(before, after));

    VectorHistory.step(app, true);
    assert.deepEqual(NoiseTransform.current(app), before, "undo restores the frame");
    assert.deepEqual(stroke.points.map((p) => p.x), [100, 100 + 40], "and the strokes");
    assert.equal(stroke.size, 20);
    VectorHistory.step(app, false);
    assert.deepEqual(NoiseTransform.current(app), after, "redo moves it again");
    assert.equal(app.brushEngine.invalidated, 3, "the brushed layer is rebuilt each time");
});

test("a region painted up to the map's edge keeps a one-cell fringe over the ground a pan reveals, and is whole again when panned back", async () => {
    const { app, session, west } = await studio();
    const layer = session.layer("realms");
    layer.paint(cellsInRect(session.mesh, 0, 0, 100, 300), west.key);
    const before = ownedX(session, west.key);
    assert.ok(before.min < session.mesh.spacing, "the region reaches the west edge");

    MeshIntegration.transformContent(app, (x, y) => [x + 60, y], (x, y) => [x - 60, y]);
    const moved = ownedX(session, west.key);
    assert.ok(moved.min > 60 - session.mesh.spacing * 2 && moved.min < 60, `the region reaches one cell into the revealed strip, no further (${moved.min})`);
    assert.ok(moved.count > before.count && moved.count - before.count < before.count * 0.1, `so it grew by a fringe, not by the strip (${before.count} to ${moved.count})`);

    MeshIntegration.transformContent(app, (x, y) => [x - 60, y], (x, y) => [x + 60, y]);
    const back = ownedX(session, west.key);
    assert.ok(Math.abs(back.count - before.count) <= before.count * 0.02, `back where it was, within a cell's jitter (${before.count} cells before, ${back.count} after)`);
    assert.ok(back.min < session.mesh.spacing, "and still reaching the edge");
});
