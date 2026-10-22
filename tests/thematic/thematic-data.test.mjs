// The thematic layers' values (src/thematic/ThematicData.js): the fixed scales, the colour lookup,
// the blend that carries model-cell values to the display cells, a run's layers, and a run moved
// with its map (ModelRun.resampleModelRun).
import "../mesh/foundry-stubs.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { smallMesh } from "../mesh/helpers.mjs";

const { FILRODENSWMB } = await import("../../src/config.js");
const { LAYERS, ThematicSource, blendValues, blendWeights, rampLookup, scalePosition, stepOf } = await import("../../src/thematic/ThematicData.js");
const { decodeModelRun, encodeModelRun, resampleModelRun } = await import("../../src/generator/ModelRun.js");
const { resolveSettings } = await import("../../src/generator/GeneratorSettings.js");

/** A run of the small mesh's model cells, its arrays from a function of each cell's site. */
function runOf(mesh, values) {
    const count = mesh.modelCount;
    const column = (name, fallback) => Float64Array.from({ length: count }, (_, cell) => values[name]?.(cell, mesh.siteX(cell), mesh.siteY(cell)) ?? fallback);
    const result = {
        modelCells: {
            capacity: column("capacity", 0),
            population: column("population", 0),
            landArea: column("landArea", 0),
            security: column("security", 1),
            cleared: column("cleared", 0),
            water: column("water", 0),
            realm: column("realm", -1),
            duchy: column("duchy", -1),
            county: column("county", -1),
            culture: column("culture", -1),
            shareStart: Int32Array.from({ length: count + 1 }, (_, index) => index),
            shareCulture: new Int32Array(count),
            shareValue: new Float32Array(count).fill(1),
        },
        settings: resolveSettings({}, "SEED"),
        cellCount: count,
        cultures: [{ name: "Folk", nameBase: "english", homelands: [0, 5] }],
        stats: {},
    };
    return JSON.parse(JSON.stringify(encodeModelRun(result, "runAAAAAAAAAAAAA")));
}

test("scales are fixed: linear or logarithmic between their ends, clamped beyond them", () => {
    const log = { kind: "log", min: 0.5, max: 100 };
    assert.equal(scalePosition(log, 0.5), 0);
    assert.equal(scalePosition(log, 100), 1);
    assert.ok(Math.abs(scalePosition(log, Math.sqrt(50)) - 0.5) < 1e-12, "the geometric middle is half way");
    assert.equal(scalePosition(log, 0), 0, "nobody at all is the lowest colour");
    assert.equal(scalePosition(log, 5000), 1);
    assert.ok(Number.isNaN(scalePosition(log, Number.NaN)));
    assert.equal(scalePosition({ kind: "linear", min: 0, max: 1 }, 0.25), 0.25);
    assert.equal(stepOf(0), 1);
    assert.equal(stepOf(1), 255);
});

test("a ramp's lookup leaves step 0 empty and runs from its first colour to its last", () => {
    const lookup = rampLookup(["#000000", "#ff8000"]);
    assert.equal(lookup.length, 256 * 4);
    assert.deepEqual([...lookup.slice(0, 4)], [0, 0, 0, 0], "no value is transparent");
    assert.deepEqual([...lookup.slice(4, 8)], [0, 0, 0, 255]);
    assert.deepEqual([...lookup.slice(255 * 4)], [255, 128, 0, 255]);
    for (const layer of FILRODENSWMB.THEMATIC.LAYERS) assert.ok(layer.ramp.length >= 2 && layer.ramp.every((colour) => /^#[0-9a-f]{6}$/.test(colour)), layer.id);
});

test("the blend between model sites reproduces a value that varies evenly across the map", () => {
    const mesh = smallMesh();
    const blend = blendWeights(mesh);
    assert.equal(blendWeights(mesh), blend, "worked out once per mesh");
    // A linear value is reproduced exactly inside every triangle; outside the sites' hull a cell
    // takes its own model cell's value
    const modelValues = Float64Array.from({ length: mesh.modelCount }, (_, cell) => 3 * mesh.siteX(cell) - mesh.siteY(cell));
    const values = blendValues(modelValues, blend);
    let inside = 0;
    for (let cell = 0; cell < mesh.cellCount; cell++) {
        const weights = blend.weights.subarray(cell * 3, cell * 3 + 3);
        if (blend.sites[cell * 3 + 1] < 0) continue;
        inside++;
        assert.ok(Math.abs(weights[0] + weights[1] + weights[2] - 1) < 1e-5);
        assert.ok(Math.abs(values[cell] - (3 * mesh.siteX(cell) - mesh.siteY(cell))) < 1e-2, `cell ${cell}`);
    }
    assert.ok(inside > mesh.cellCount * 0.9, `${inside} of ${mesh.cellCount} inside the model sites' hull`);
});

test("a site with no value is left out of the blend, and a cell with none of its three has none", () => {
    const mesh = smallMesh();
    const blend = blendWeights(mesh);
    const half = Float64Array.from({ length: mesh.modelCount }, (_, cell) => (mesh.siteX(cell) < 200 ? 10 : Number.NaN));
    const values = blendValues(half, blend);
    for (let cell = 0; cell < mesh.cellCount; cell++) {
        if (mesh.siteX(cell) < 150) assert.equal(values[cell], 10, "inside the valued half the value is whole, not diluted");
        if (mesh.siteX(cell) > 260) assert.ok(Number.isNaN(values[cell]));
    }
});

test("population is people per km² of land, and a run of another mesh has no layers", () => {
    const mesh = smallMesh();
    const run = runOf(mesh, { population: () => 400, landArea: (cell, x) => (x < 200 ? 20 : 0) });
    const source = ThematicSource.of(run, mesh);
    assert.ok(source.has("population"));
    const model = source.modelValues("population");
    for (let cell = 0; cell < mesh.modelCount; cell++) assert.equal(model[cell], mesh.siteX(cell) < 200 ? 20 : Number.NaN);
    const bytes = source.displayBytes("population");
    assert.equal(source.displayBytes("population"), bytes, "kept once worked out");
    const step = stepOf(scalePosition(LAYERS.get("population").scale, 20));
    for (let cell = 0; cell < mesh.cellCount; cell++) {
        if (mesh.siteX(cell) < 150) assert.equal(bytes[cell], step);
        if (mesh.siteX(cell) > 260) assert.equal(bytes[cell], 0, "no land, no value");
    }
    assert.equal(source.valueAt("population", -1), Number.NaN);

    assert.equal(ThematicSource.of({ ...run, cellCount: mesh.modelCount + 1 }, mesh), null);
    assert.equal(ThematicSource.of(null, mesh), null);
    const older = structuredClone(run);
    delete older.cells.landArea;
    assert.equal(ThematicSource.of(older, mesh).has("population"), false, "a run saved before land areas cannot show density");
});

test("a run moved with its map takes each cell's values from where its site came from, and moves its places", () => {
    const mesh = smallMesh();
    const run = runOf(mesh, { population: (cell) => cell, landArea: () => 1, realm: (cell) => cell % 3 });
    run.history = [{ development: 0.5, plague: 0, strife: 0.2, places: [0, 1, 1, 5, 2, 0], castles: [3], seats: [0], realm: run.cells.realm }];

    // The identity move changes nothing
    const all = Int32Array.from({ length: mesh.modelCount }, (_, cell) => cell);
    const same = resampleModelRun(run, all, (cell) => cell);
    assert.deepEqual(decodeModelRun(same), decodeModelRun(run));
    assert.deepEqual(same.history[0].places, run.history[0].places);

    // A move: cell c takes cell (c + 1)'s values, the last comes from beyond the map; places move back one
    const shifted = Int32Array.from({ length: mesh.modelCount }, (_, cell) => (cell + 1 < mesh.modelCount ? cell + 1 : -1));
    const moved = resampleModelRun(run, shifted, (cell) => cell - 1);
    const arrays = decodeModelRun(moved);
    assert.equal(arrays.population[0], 1);
    assert.equal(arrays.population[mesh.modelCount - 1], 0, "from beyond the map: no one");
    assert.equal(arrays.water[mesh.modelCount - 1], 1, "and open water");
    assert.equal(arrays.realm[mesh.modelCount - 1], -1);
    assert.equal(arrays.shareStart.length, mesh.modelCount + 1);
    assert.equal(arrays.shareCulture.length, mesh.modelCount - 1, "the cell from beyond the map has no culture shares");
    assert.deepEqual(moved.history[0].places, [4, 2, 0], "the place in cell 0 moved off the map; cell 5's to 4");
    assert.deepEqual(moved.history[0].castles, [2]);
    assert.deepEqual(moved.history[0].seats, []);
    assert.deepEqual(moved.cultures[0].homelands, [4]);
    assert.equal(decodeModelRun(run).population[0], 0, "the original run is untouched, for undo");
});
