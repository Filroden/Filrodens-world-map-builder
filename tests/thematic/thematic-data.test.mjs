// The thematic layers' values (src/thematic/ThematicData.js): the fixed scales, the colour lookup,
// the blend that carries model-cell values to the display cells, a run's layers, and a run moved
// with its map (ModelRun.resampleModelRun).
import "../mesh/foundry-stubs.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { smallMesh } from "../mesh/helpers.mjs";

const { FILRODENSWMB } = await import("../../src/config.js");
const { LAYERS, ThematicSource, TradeIndex, blendValues, blendWeights, rampLookup, scalePosition, stepOf, tradeClassOf, tradeLines } = await import("../../src/thematic/ThematicData.js");
const { decodeModelRun, encodeModelRun, resampleModelRun } = await import("../../src/generator/ModelRun.js");
const { resolveSettings } = await import("../../src/generator/GeneratorSettings.js");

/** "#rrggbb" as [r, g, b]. */
const hexRgb = (hex) => [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));

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
        ...(values.trade ? { trade: values.trade } : {}),
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
    for (const layer of FILRODENSWMB.THEMATIC.LAYERS.filter((each) => each.legend === "ramp")) assert.ok(layer.ramp.length >= 2 && layer.ramp.every((colour) => /^#[0-9a-f]{6}$/.test(colour)), layer.id);
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

test("capacity is food per km² of land; cleared land and danger are shares, with no value on water", () => {
    const mesh = smallMesh();
    const run = runOf(mesh, { capacity: () => 600, landArea: () => 20, cleared: (cell, x) => (x < 200 ? 0.8 : 0.2), security: () => 0.75, water: (cell, x) => (x > 380 ? 1 : 0) });
    const source = ThematicSource.of(run, mesh);
    for (const id of ["capacity", "cleared", "danger"]) assert.ok(source.has(id), id);
    const capacity = source.modelValues("capacity");
    const cleared = source.modelValues("cleared");
    const danger = source.modelValues("danger");
    for (let cell = 0; cell < mesh.modelCount; cell++) {
        assert.equal(capacity[cell], 30);
        if (mesh.siteX(cell) > 380) {
            assert.ok(Number.isNaN(cleared[cell]) && Number.isNaN(danger[cell]), "a water cell has no share");
            continue;
        }
        assert.ok(Math.abs(cleared[cell] - (mesh.siteX(cell) < 200 ? 0.8 : 0.2)) < 0.01);
        assert.ok(Math.abs(danger[cell] - 0.25) < 0.01, "danger is the security turned round");
    }
    assert.equal(source.lookup("capacity"), source.lookup("capacity"), "a lookup is made once");
});

test("the culture layer: each model cell in its dominant culture's colour, fainter where its share is lower", () => {
    const mesh = smallMesh();
    const count = mesh.modelCount;
    const west = (cell) => mesh.siteX(cell) < 200;
    const mixed = (cell) => Math.abs(mesh.siteX(cell) - 200) < 40;
    const shareStart = [0];
    const shareCulture = [];
    const shareValue = [];
    for (let cell = 0; cell < count; cell++) {
        const own = west(cell) ? 0 : 1;
        if (mixed(cell)) shareCulture.push(own, 1 - own), shareValue.push(0.55, 0.45);
        else shareCulture.push(own), shareValue.push(1);
        shareStart.push(shareCulture.length);
    }
    const run = runOf(mesh, { culture: (cell) => (west(cell) ? 0 : 1) });
    const packed = JSON.parse(JSON.stringify(encodeModelRun({
        modelCells: { ...decodeModelRun(run), shareStart: Int32Array.from(shareStart), shareCulture: Int32Array.from(shareCulture), shareValue: Float32Array.from(shareValue) },
        settings: resolveSettings({}, "SEED"),
        cellCount: count,
        cultures: [{ id: "cultureAAAAAAAAA", name: "Westfolk", color: "#ff0000" }, { id: "cultureBBBBBBBBB", name: "Eastfolk", color: null }],
        stats: {},
    }, "runAAAAAAAAAAAAA")));
    const source = ThematicSource.of(packed, mesh);
    assert.ok(source.has("culture"));
    assert.ok(ThematicSource.isClassLayer("culture") && !ThematicSource.isClassLayer("population"));

    const bytes = source.displayBytes("culture");
    const lookup = source.lookup("culture");
    for (let cell = 0; cell < mesh.cellCount; cell++) {
        const model = mesh.parentOf[cell];
        const step = bytes[cell];
        const [r, g, b, a] = lookup.slice(step * 4, step * 4 + 4);
        if (west(model)) assert.deepEqual([r, g, b], [255, 0, 0], "the culture's own colour");
        else assert.deepEqual([r, g, b], hexRgb(FILRODENSWMB.THEMATIC.CULTURE.PALETTE[1]), "a culture without a colour takes the palette's");
        if (mixed(model)) assert.ok(a < 255, "a mixed cell is fainter");
        else assert.equal(a, 255);
    }
    const at = source.cultureAt(mesh.childrenOf(0)[0]);
    assert.equal(at.name, west(0) ? "Westfolk" : "Eastfolk");
    assert.deepEqual(source.cultureClasses().map((entry) => entry.name), ["Westfolk", "Eastfolk"]);
    assert.equal(source.cultureAt(-1), null);

    // With only the run's default culture, the layer says why it cannot be shown
    const single = ThematicSource.of(runOf(mesh, { culture: () => 0 }), mesh);
    assert.equal(single.missing("culture"), "cultures");
    assert.equal(single.has("culture"), false);
    const older = structuredClone(run);
    delete older.cells.landArea;
    assert.equal(ThematicSource.of(older, mesh).missing("population"), "run");
});

test("trade: saved per edge, drawn along the generated route joining its cells or else straight, quietest first", () => {
    const mesh = smallMesh();
    // Three model cells in a row along the middle, and a fourth far off
    const sites = [...Array(mesh.modelCount).keys()];
    const near = (x, y) => sites.reduce((a, b) => (Math.hypot(mesh.siteX(a) - x, mesh.siteY(a) - y) < Math.hypot(mesh.siteX(b) - x, mesh.siteY(b) - y) ? a : b));
    const [a, b, c] = [near(100, 150), near(115, 150), near(130, 150)];
    const far = near(350, 250);
    const trade = { from: Int32Array.of(a, b, c), to: Int32Array.of(b, c, far), kind: Uint8Array.of(0, 1, 2), value: Float32Array.of(1, 0.004, 0.06) };
    const run = runOf(mesh, { trade });
    const source = ThematicSource.of(run, mesh);
    assert.ok(source.hasTrade());
    const saved = source.trade();
    assert.deepEqual([...saved.from], [a, b, c]);
    assert.ok(Math.abs(saved.value[1] - 0.004) < 1e-6, "kept to a millionth");

    // A generated road from a to b with a leg through a display cell between them
    const middle = mesh.cellAt(107, 151);
    const road = { id: "r", generated: { run: "x" }, waypoints: [a, b], legs: [[a, middle, b]] };
    const old = { id: "o", generated: { run: "x", oldRoad: true }, waypoints: [b, c], legs: [[b, mesh.cellAt(122, 140), c]] };
    const lines = tradeLines(saved, mesh, [road, old]);
    assert.deepEqual(lines.map((line) => line.value.toFixed(3)), ["0.004", "0.060", "1.000"], "quietest first");
    const busiest = lines.at(-1);
    assert.equal(busiest.points.length, 12, "the leg's three cells, smoothed once: its two ends and two points for each of its two segments");
    assert.equal(busiest.cls, tradeClassOf(1));
    assert.equal(lines[0].points.length, 4, "an old road carries no trade: straight between the sites");
    assert.deepEqual([tradeClassOf(0.004), tradeClassOf(0.06), tradeClassOf(1)], [0, 2, 3]);

    const index = new TradeIndex(lines, mesh.width);
    assert.equal(index.nearest(mesh.siteX(a) + 1, mesh.siteY(a) + 2, 6), 2, "the busiest line under the pointer");
    assert.equal(index.nearest(10, 290, 6), -1);

    // A run without trade has none, and moving a run moves its trade, dropping edges moved off the map
    assert.equal(ThematicSource.of(runOf(mesh, {}), mesh).hasTrade(), false);
    const all = Int32Array.from({ length: mesh.modelCount }, (_, cell) => cell);
    const moved = decodeModelRun(resampleModelRun(run, all, (cell) => (cell === far ? -1 : cell)));
    assert.deepEqual([...moved.tradeFrom], [a, b]);
    assert.deepEqual([...moved.tradeKind], [0, 1]);
});
