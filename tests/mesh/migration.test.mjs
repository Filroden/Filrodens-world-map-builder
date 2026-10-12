// Migration of polygon regions and node routes to the version 4 mesh shapes.
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { MeshBuilder } from "../../src/mesh/MeshBuilder.js";
import { migrateMapData, regionsToOwners, routesToWaypoints } from "../../src/mesh/Migration.js";
import { pointInPolygon } from "../../src/mesh/OwnerLayer.js";
import { cellsAlongPolyline, toFlatPoints } from "../../src/mesh/RoutePath.js";
import { UNCLAIMED, VECTOR_SCHEMA_VERSION, validateOwners, validateVectorData } from "../../src/mesh/Schema.js";
import { FIXTURES, isContiguous, readJson, smallMesh } from "./helpers.mjs";

const MIN_IOU = 0.97;
let counter = 0;
const ids = () => `id${String(counter++).padStart(13, "0")}`;

test("a square region takes exactly the cells whose site is inside it", () => {
    const mesh = smallMesh();
    const square = [
        { x: 100, y: 80 },
        { x: 260, y: 80 },
        { x: 260, y: 220 },
        { x: 100, y: 220 },
    ];
    const { layerSet, owners } = regionsToOwners([{ id: "L1", name: "Layer", visibility: "all", regions: [{ id: "R1", name: "Square", points: square, fillColor: "#ff0000" }] }], mesh, { idFactory: ids });
    const level = layerSet.levels[0];
    const key = level.regions[0].key;
    for (let cell = 0; cell < mesh.cellCount; cell++) {
        const [x, y] = [mesh.siteX(cell), mesh.siteY(cell)];
        const inside = x > 100 && x < 260 && y > 80 && y < 220;
        assert.equal(owners[level.id][cell] === key, inside, `cell ${cell} at ${x},${y}`);
    }
});

test("overlapping regions: the later one wins; a tiny region keeps one cell", () => {
    const mesh = smallMesh();
    const box = (x0, y0, x1, y1) => [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
    ];
    const layer = {
        id: "L1",
        regions: [
            { id: "A", points: box(50, 50, 200, 200) },
            { id: "B", points: box(150, 50, 300, 200) },
            { id: "C", points: [[350, 250], [351, 250], [350.5, 251]] },
        ],
    };
    const { layerSet, owners } = regionsToOwners([layer], mesh, { idFactory: ids });
    const [a, b, c] = layerSet.levels[0].regions.map((region) => region.key);
    const levelOwners = owners.L1;
    assert.equal(levelOwners[mesh.cellAt(175, 125)], b);
    assert.equal(levelOwners[mesh.cellAt(100, 125)], a);
    assert.deepEqual([...levelOwners.keys()].filter((cell) => levelOwners[cell] === c), [mesh.cellAt(350.5, 250.333)]);
});

/** Pixels inside each region's polygon after later regions overwrite earlier ones (the old draw order). */
function polygonMasks(level, width, height) {
    const owner = new Int32Array(width * height).fill(UNCLAIMED);
    for (const region of level.regions) {
        const flat = toFlatPoints(region.legacy.points);
        let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
        for (let i = 0; i < flat.length; i += 2) [minX, maxX, minY, maxY] = [Math.min(minX, flat[i]), Math.max(maxX, flat[i]), Math.min(minY, flat[i + 1]), Math.max(maxY, flat[i + 1])];
        for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(height - 1, Math.ceil(maxY)); y++) {
            for (let x = Math.max(0, Math.floor(minX)); x <= Math.min(width - 1, Math.ceil(maxX)); x++) {
                if (pointInPolygon(flat, x + 0.5, y + 0.5)) owner[y * width + x] = region.key;
            }
        }
    }
    return owner;
}

test("the v3 fixture migrates: version, legacy data, counts, valid shapes and matching areas", () => {
    const v3 = readJson(join(FIXTURES, "v3-vectors.json"));
    const { mapData, owners, mesh } = migrateMapData(v3, null, { idFactory: ids });

    assert.equal(mapData.vectorSchemaVersion, VECTOR_SCHEMA_VERSION);
    assert.deepEqual(validateVectorData(mapData), []);
    assert.ok(!("regionLayers" in mapData));
    assert.ok("regionLayers" in v3, "the input map is left as it was");
    assert.equal(mapData.mesh.cells, mesh.cellCount);

    // Counts preserved
    const levels = mapData.layerSets[0].levels;
    assert.equal(levels.length, v3.regionLayers.length);
    levels.forEach((level, i) => {
        assert.equal(level.regions.length, v3.regionLayers[i].regions.length);
        assert.deepEqual(validateOwners(owners[level.id], level, mesh.cellCount), []);
        level.regions.forEach((region, j) => {
            const old = v3.regionLayers[i].regions[j];
            assert.equal(region.id, old.id);
            assert.deepEqual(region.legacy.points, old.points);
            assert.equal(region.visibility, old.visibility);
            assert.ok(owners[level.id].includes(region.key), `${region.name} owns cells`);
        });
    });
    assert.equal(mapData.mapRoutes.length, v3.mapRoutes.length);
    assert.equal(mapData.mapPins.length, v3.mapPins.length);

    // Areas match within one cell band: IoU of the region's pixels against its polygon's
    const raster = mesh.cellRaster;
    for (const level of levels) {
        const expected = polygonMasks(level, mesh.width, mesh.height);
        for (const region of level.regions) {
            let [both, either] = [0, 0];
            for (let pixel = 0; pixel < raster.length; pixel++) {
                const inPolygon = expected[pixel] === region.key;
                const inRegion = owners[level.id][raster[pixel]] === region.key;
                if (inPolygon && inRegion) both++;
                if (inPolygon || inRegion) either++;
            }
            if (either < 2000) continue; // a region a few cells across has no meaningful overlap ratio
            assert.ok(both / either >= MIN_IOU, `${region.name}: IoU ${(both / either).toFixed(3)}`);
        }
    }
});

test("migrated routes trace the old lines and keep their look", () => {
    const v3 = readJson(join(FIXTURES, "v3-vectors.json"));
    const { mapData, mesh } = migrateMapData(v3, null, { idFactory: ids });
    mapData.mapRoutes.forEach((route, i) => {
        const old = v3.mapRoutes[i];
        assert.equal(route.id, old.id);
        assert.equal(route.mode, "trace");
        assert.equal(route.smoothing, true);
        assert.equal(route.outline, true);
        assert.deepEqual(route.legacy.points, old.points);
        route.legs.forEach((leg) => assert.ok(isContiguous(mesh, leg)));
        // The route covers the cells the old polyline crossed
        const crossed = cellsAlongPolyline(mesh, toFlatPoints(old.points));
        const cells = new Set(route.legs.flat());
        const covered = [...crossed].filter((cell) => cells.has(cell)).length / crossed.length;
        assert.ok(covered >= 0.95, `${route.name}: ${(covered * 100).toFixed(0)}%`);
    });
    // King's Road and Salt Way share the node at (900, 450), so they share that waypoint cell
    const [kings, salt] = mapData.mapRoutes;
    assert.ok(kings.waypoints.includes(salt.waypoints[0]));
    // Two nodes in one cell (Jitter Lane repeats its first node) merge into one waypoint
    assert.equal(mapData.mapRoutes[2].waypoints.length, 2);
    // Pins gain their cell
    for (const pin of mapData.mapPins) assert.equal(pin.cell, mesh.cellAt(pin.x, pin.y));
});

test("migration is a no-op on a version 4 map, and the mesh it builds is reproducible", () => {
    const v3 = readJson(join(FIXTURES, "v3-vectors.json"));
    const first = migrateMapData(v3, null, { idFactory: ids });
    const again = migrateMapData(first.mapData);
    assert.equal(again.mapData, first.mapData);
    assert.deepEqual(again.owners, {});
    const rebuilt = MeshBuilder.fromMapData(first.mapData);
    assert.deepEqual(rebuilt.sites, first.mesh.sites);
});

test("routes with fewer than two nodes migrate to the same shape", () => {
    const mesh = smallMesh();
    const routes = routesToWaypoints(
        [
            { id: "a", points: [] },
            { id: "b", points: [{ x: 10, y: 10 }] },
        ],
        mesh,
        { idFactory: ids },
    );
    assert.deepEqual(routes[0].waypoints, []);
    assert.deepEqual(routes[1].waypoints, [mesh.cellAt(10, 10)]);
    assert.deepEqual(routes[1].legs, []);
});
