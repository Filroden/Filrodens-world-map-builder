// Regional maps cut from a map on the display mesh, and the exporters that read regions from it.
import "./foundry-stubs.mjs";
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { MeshSession } from "../../src/mesh/MeshSession.js";
import { decodeOwners } from "../../src/mesh/OwnerLayer.js";
import { extractRegionalVectors } from "../../src/mesh/RegionalMesh.js";
import { UNCLAIMED } from "../../src/mesh/Schema.js";
import { FIXTURES, P0_SKIP, isContiguous, loadP0, readJson } from "./helpers.mjs";

const CROP = { x: 500, y: 300, width: 400, height: 300 };
const ZOOM = 2;
const MAX_COVERAGE_GAP = 0.02;

let opened = null;
async function openV3() {
    opened ??= await MeshSession.open(readJson(join(FIXTURES, "v3-vectors.json")), { buffers: loadP0().buffers });
    return opened;
}

async function extract() {
    const { session, mapData } = await openV3();
    const childMapData = { mapWidth: CROP.width * ZOOM, mapHeight: CROP.height * ZOOM, seed: "P0JBVA-child", params: { latTop: 40, latBottom: 20 }, world: { zoom: ZOOM, areaFactor: 15 } };
    const result = extractRegionalVectors({ session, layerSets: mapData.layerSets, routes: mapData.mapRoutes, pins: [], childMapData, crop: CROP, zoom: ZOOM });
    return { ...result, session, mapData };
}

test("a regional map's cells take the owner of the parent cell under their site", { skip: P0_SKIP }, async () => {
    const { fields, owners, mesh, session } = await extract();
    assert.equal(fields.vectorSchemaVersion, 4);
    assert.equal(fields.mesh.cells, mesh.cellCount);
    for (const level of fields.layerSets.flatMap((set) => set.levels)) {
        const child = decodeOwners(owners[level.id]);
        assert.equal(child.length, mesh.cellCount);
        for (let cell = 0; cell < mesh.cellCount; cell += 97) {
            const parentOwner = session.ownerAt(level.id, mesh.siteX(cell) / ZOOM + CROP.x, mesh.siteY(cell) / ZOOM + CROP.y);
            const kept = level.regions.some((region) => region.key === parentOwner);
            assert.equal(child[cell], kept ? parentOwner : UNCLAIMED);
        }
    }
});

test("a region crossing the crop's edge keeps the part inside; regions outside are dropped", { skip: P0_SKIP }, async () => {
    const { fields, owners, session, mapData } = await extract();
    for (const level of mapData.layerSets.flatMap((set) => set.levels)) {
        const carried = fields.layerSets.flatMap((set) => set.levels).find((candidate) => candidate.id === level.id);
        for (const region of level.regions) {
            const box = session.regionBounds(level.id, region.key);
            const crossesEdge = box.minX < CROP.x && box.maxX > CROP.x && box.minY < CROP.y + CROP.height && box.maxY > CROP.y;
            const inChild = carried && decodeOwners(owners[level.id]).includes(region.key);
            if (crossesEdge && inChild) assert.ok(carried.regions.some((candidate) => candidate.id === region.id), `${region.name} survives`);
            if (!inChild) assert.ok(!carried?.regions.some((candidate) => candidate.id === region.id), `${region.name} is dropped`);
        }
    }
    assert.ok(fields.layerSets.length > 0, "at least one region reaches into the crop");
});

test("routes are re-traced on the regional mesh as contiguous legs", { skip: P0_SKIP }, async () => {
    const { fields, mesh } = await extract();
    for (const route of fields.mapRoutes) {
        assert.equal(route.legs.length, route.waypoints.length - 1);
        route.legs.forEach((leg, k) => {
            assert.equal(leg[0], route.waypoints[k]);
            assert.equal(leg.at(-1), route.waypoints[k + 1]);
            assert.ok(isContiguous(mesh, leg), `${route.name} leg ${k}`);
        });
    }
});

// ------------------------------------------------------------------ exporters

/** A Foundry square grid as far as GridDataExporter uses it. */
class SquareGridStub {
    constructor({ size }) {
        this.size = size;
    }

    getOffsetRange({ x, y, width, height }) {
        return [Math.floor(y / this.size), Math.floor(x / this.size), Math.ceil((y + height) / this.size), Math.ceil((x + width) / this.size)];
    }

    getVertices({ i, j }) {
        const [x, y, s] = [j * this.size, i * this.size, this.size];
        return [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }];
    }
}

async function exporterApp() {
    globalThis.foundry.grid = { SquareGrid: SquareGridStub };
    const { setupApp } = await import("../support/pipeline-setup.mjs");
    const v3 = readJson(join(FIXTURES, "v3-vectors.json"));
    const app = setupApp(v3);
    const { buffers } = loadP0();
    app.currentElevationData = buffers.elevation;
    app.currentMoistureData = new Float32Array(buffers.elevation.length).fill(0.5);
    app.currentTemperatureData = new Float32Array(buffers.elevation.length).fill(0.5);
    app.currentBiomeOverrides = new Uint8Array(buffers.elevation.length);
    app.bufferWaterMask = buffers.waterMask;
    app.uiState.gridType = "square";
    app.uiState.gridSize = 100;
    app.mapRoutes = [];
    return { app, v3 };
}

/**
 * The v3 fixture's region polygons in the form the grid exporter tests cells against (see
 * GridDataExporter.build's `regions`): a pixel is in a region when it lies inside the polygon's
 * raw points, as the exporter tested regions before they moved onto the display mesh.
 */
async function polygonRegions(regionLayers) {
    const { GridAggregator } = await import("../../src/generation/GridAggregator.js");
    return regionLayers.flatMap((layer) =>
        layer.regions.map((region) => ({
            id: region.id,
            name: region.name,
            visibility: layer.visibility === "gm" ? "gm" : region.visibility || "all",
            layer: { id: layer.id, name: layer.name },
            contains: (px, py) => GridAggregator.pointInPolygon(px, py, region.points),
            bounds: GridAggregator.getPolygonPixelBounds(region.points),
        })),
    );
}

test("grid data: region coverage from the cell raster matches the polygon test within 2%", { skip: P0_SKIP }, async () => {
    const { GridDataExporter } = await import("../../src/applications/GridDataExporter.js");
    const { app, v3 } = await exporterApp();
    const polygons = GridDataExporter.build(app, { regions: await polygonRegions(v3.regionLayers) });

    const { session, mapData } = await openV3();
    Object.assign(app, { meshSession: session, mapRoutes: mapData.mapRoutes });
    const mesh = GridDataExporter.build(app);

    // Where two polygons of a layer overlap, both used to claim the pixels; on the mesh the later
    // region owns them (as it was drawn on top). Cells holding such an overlap are left out.
    const overlapped = (cell) => {
        const perLayer = new Map();
        for (const region of cell.regions) perLayer.set(region.layer.id, (perLayer.get(region.layer.id) ?? 0) + region.coverage);
        return [...perLayer.values()].some((sum) => sum > 1 + 1e-9);
    };
    let gap = 0;
    let total = 0;
    for (const [offset, cell] of Object.entries(polygons.cells)) {
        if (overlapped(cell)) continue;
        const byId = new Map(mesh.cells[offset].regions.map((region) => [region.id, region.coverage]));
        for (const region of cell.regions) {
            gap += Math.abs(region.coverage - (byId.get(region.id) ?? 0));
            total += region.coverage;
        }
    }
    assert.ok(total > 0);
    assert.ok(gap / total <= MAX_COVERAGE_GAP, `coverage differs by ${((100 * gap) / total).toFixed(2)}%`);
    assert.equal(mesh.schemaVersion, polygons.schemaVersion, "same schema");
    assert.ok(Object.values(mesh.cells).some((cell) => cell.infrastructure.routes.length > 0), "routes on the mesh still mark the cells they cross");
});

test("scene notes for regions sit at the label anchor", { skip: P0_SKIP }, async () => {
    const { SceneExporter } = await import("../../src/platform/foundry/SceneExporter.js");
    const { session, mapData } = await openV3();
    const levels = structuredClone(mapData.layerSets.flatMap((set) => set.levels));
    levels[0].regions[0].journalPageId = "page";
    const anchors = SceneExporter.regionNoteAnchors({ meshSession: session, regionLevels: levels });
    assert.equal(anchors.length, 1);
    const expected = session.labelAnchor(levels[0].id, levels[0].regions[0].key);
    assert.deepEqual([anchors[0].x, anchors[0].y], [expected.x, expected.y]);
});
