// A regional map's copy of its parent's run (src/generator/ParentRun.js): the parent's cells on the
// regional map and a margin round it, their sites moved into its pixels, their shares and trade
// kept; the copy as the thematic layers read it (RunCells); the parent's model sites placed again
// without its mesh; and a copy made for a regional map cut before maps carried one
// (ParentRunRecovery).
import "../mesh/foundry-stubs.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { smallMesh } from "../mesh/helpers.mjs";

const { FILRODENSWMB } = await import("../../src/config.js");
const { cropRun, parentRunSites } = await import("../../src/generator/ParentRun.js");
const { decodeModelRun, encodeModelRun } = await import("../../src/generator/ModelRun.js");
const { resolveSettings } = await import("../../src/generator/GeneratorSettings.js");
const { generateModelSites, generateSites } = await import("../../src/mesh/MeshBuilder.js");
const { ThematicSource } = await import("../../src/thematic/ThematicData.js");
const { RunCells } = await import("../../src/applications/RunCells.js");
const { ParentRunRecovery } = await import("../../src/applications/ParentRunRecovery.js");

/** A run of the small mesh's model cells: each cell's population is its index, its culture share its x. */
function runOf(mesh) {
    const count = mesh.modelCount;
    const column = (fill) => Float64Array.from({ length: count }, (_, cell) => fill(cell));
    // Trade between consecutive cells
    const trade = { from: [], to: [], kind: [], value: [] };
    for (let cell = 0; cell + 1 < count; cell += 7) {
        trade.from.push(cell);
        trade.to.push(cell + 1);
        trade.kind.push(cell % 3);
        trade.value.push(0.5);
    }
    const result = {
        modelCells: {
            capacity: column((cell) => cell * 2),
            population: column((cell) => cell),
            landArea: column(() => 400),
            security: column(() => 1),
            cleared: column((cell) => (cell % 2) * 0.5),
            water: column(() => 0),
            realm: column(() => 0),
            duchy: column(() => 0),
            county: column(() => 0),
            culture: column(() => 0),
            shareStart: Int32Array.from({ length: count + 1 }, (_, index) => index),
            shareCulture: new Int32Array(count),
            shareValue: new Float32Array(count).fill(1),
        },
        settings: resolveSettings({}, "SEED"),
        cellCount: count,
        cultures: [{ id: "folkAAAAAAAAAAAA", name: "Folk", nameBase: "english", homelands: [] }],
        stats: {},
        trade,
    };
    return JSON.parse(JSON.stringify(encodeModelRun(result, "runAAAAAAAAAAAAA")));
}

const modelSites = (mesh) => mesh.sites.subarray(0, 2 * mesh.modelCount);

test("a regional map's copy holds the parent's cells on it and round it, their sites in its pixels", () => {
    const mesh = smallMesh();
    const run = runOf(mesh);
    const crop = { x: 100, y: 80, width: 160, height: 120 };
    const zoomScale = 2.5;
    const copy = cropRun(run, { sites: modelSites(mesh), spacingPx: mesh.modelSpacing, spacingKm: mesh.modelSpacing * 2, crop, zoomScale });
    const margin = FILRODENSWMB.PARENT_RUN.MARGIN_CELLS * mesh.modelSpacing;
    const inside = [];
    for (let cell = 0; cell < mesh.modelCount; cell++) {
        const [x, y] = [mesh.siteX(cell), mesh.siteY(cell)];
        if (x >= crop.x - margin && x <= crop.x + crop.width + margin && y >= crop.y - margin && y <= crop.y + crop.height + margin) inside.push(cell);
    }
    assert.equal(copy.origin, "parent");
    assert.equal(copy.run, run.run);
    assert.equal(copy.cellCount, inside.length);
    assert.ok(copy.cellCount < mesh.modelCount);
    const arrays = decodeModelRun(copy);
    assert.deepEqual(Array.from(arrays.population), inside, "each cell keeps its own figures");
    const sites = parentRunSites(copy);
    inside.forEach((cell, index) => {
        assert.ok(Math.abs(sites[index * 2] - (mesh.siteX(cell) - crop.x) * zoomScale) <= 0.05, "x in the regional map's pixels");
        assert.ok(Math.abs(sites[index * 2 + 1] - (mesh.siteY(cell) - crop.y) * zoomScale) <= 0.05, "y in the regional map's pixels");
    });
    assert.ok(Array.from(sites).some((value) => value < 0), "the margin reaches off the map's top or left edge");
    assert.equal(copy.spacingPx, mesh.modelSpacing * zoomScale);
    assert.equal(copy.spacingKm, mesh.modelSpacing * 2);
    // Trade kept only between kept cells, renumbered
    const kept = new Set(inside);
    const expected = [];
    for (let cell = 0; cell + 1 < mesh.modelCount; cell += 7) if (kept.has(cell) && kept.has(cell + 1)) expected.push([inside.indexOf(cell), inside.indexOf(cell + 1)]);
    assert.deepEqual(Array.from(arrays.tradeFrom, (from, edge) => [from, arrays.tradeTo[edge]]), expected);
    assert.equal(arrays.shareStart.length, copy.cellCount + 1);
    assert.equal(cropRun(run, { sites: modelSites(mesh), spacingPx: mesh.modelSpacing, spacingKm: 1, crop: { x: 5000, y: 5000, width: 10, height: 10 }, zoomScale: 1 }), null, "no cell on the map, no copy");
});

test("the copy is read on the regional map as a run on the parent's cells; its own run comes first", () => {
    const parent = smallMesh();
    const run = runOf(parent);
    const crop = { x: 0, y: 0, width: 400, height: 300 };
    // The same mesh as the regional map, at no zoom: each display cell lies in the parent cell of its own model parent
    const copy = cropRun(run, { sites: modelSites(parent), spacingPx: parent.modelSpacing, spacingKm: 24, crop, zoomScale: 1 });
    const app = { meshSession: { mesh: parent }, modelRun: null, parentRun: copy };
    const read = RunCells.of(app);
    assert.equal(read.inherited, true);
    assert.equal(read.run, copy);
    assert.equal(RunCells.of(app), read, "worked out once");
    let agree = 0;
    for (let cell = 0; cell < parent.cellCount; cell++) if (read.cells.parentOf[cell] === parent.parentOf[cell]) agree++;
    assert.ok(agree / parent.cellCount > 0.99, `${agree} of ${parent.cellCount} display cells in the same cell`);
    const source = ThematicSource.of(copy, read.cells);
    assert.ok(source?.has("population"), "the thematic layers read it");
    app.modelRun = run;
    assert.deepEqual(RunCells.of(app), { run, cells: parent, inherited: false }, "a regional map generated itself reads its own run");
    // A regional map cut from this map gets the own run's cells
    const nested = RunCells.forRegion(app, { x: 50, y: 50, width: 100, height: 75 }, 4);
    assert.equal(nested.run, run.run);
    app.modelRun = null;
    const fromCopy = RunCells.forRegion(app, { x: 50, y: 50, width: 100, height: 75 }, 4);
    assert.equal(fromCopy.cellCount, nested.cellCount, "or, with none, its copy's, the same cells");
    const [a, b] = [parentRunSites(fromCopy), parentRunSites(nested)];
    assert.ok(a.every((value, index) => Math.abs(value - b[index]) <= 0.5), "at the same places (to the copy's tenth of a pixel, enlarged)");
});

test("a map's model sites are placed again, exactly, without its display sites", () => {
    for (const params of [{ width: 400, height: 300, spacing: 4, modelSpacing: 12, seed: 42 }, { width: 333, height: 517, spacing: 5, modelSpacing: 31.7, seed: 7 }]) {
        const { sites, modelCount } = generateSites(params);
        assert.deepEqual(generateModelSites(params), sites.subarray(0, modelCount * 2));
    }
});

test("a regional map cut before maps carried a copy gets one from its saved parent", () => {
    const mesh = smallMesh();
    const run = runOf(mesh);
    // A saved parent whose mesh block places the small mesh's model sites
    const parentData = { mapWidth: 400, mapHeight: 300, seed: "S", params: { latTop: 60, latBottom: -60 }, world: { areaFactor: 15 }, mesh: { seed: 42, spacing: 4, modelSpacingPx: 12, modelSpacingKm: 24, width: 400, height: 300 } };
    // The regional map: a quarter of the parent, four times larger
    const child = { world: { zoom: 4, originX: 100, originY: 80, rootW: 400, rootH: 300 }, mapWidth: 400, mapHeight: 300 };
    const runs = new Set([run.run]);
    const frame = ParentRunRecovery.frame(parentData, child);
    assert.deepEqual(frame, { crop: { x: 100, y: 80, width: 100, height: 75 }, zoomScale: 4 });
    const copy = ParentRunRecovery.copyFrom(parentData, run, runs, child);
    const expected = cropRun(run, { sites: modelSites(mesh), spacingPx: 12, spacingKm: copy.spacingKm, ...frame });
    assert.deepEqual(copy, expected);
    assert.equal(ParentRunRecovery.copyFrom(parentData, run, new Set(["otherAAAAAAAAAAA"]), child), null, "the parent has been generated again since");
    assert.equal(ParentRunRecovery.copyFrom({ ...parentData, mesh: { ...parentData.mesh, seed: 43 } }, run, runs, child), null, "the parent's cells cannot be placed again");
    // A parent that is itself a regional map, not generated, passes on its own copy
    const grandchild = { world: { zoom: 8, originX: 110, originY: 90, rootW: 400, rootH: 300 }, mapWidth: 400, mapHeight: 300 };
    const passed = ParentRunRecovery.copyFrom({ ...child, mesh: parentData.mesh, parentRun: copy }, null, runs, grandchild);
    assert.equal(passed.run, run.run);
    assert.ok(passed.cellCount > 0 && passed.cellCount < copy.cellCount);
    assert.equal(ParentRunRecovery.frame(parentData, { world: { zoom: 2, originX: null, originY: null }, mapWidth: 10, mapHeight: 10 }), null, "an older regional map whose place is not known");
});
