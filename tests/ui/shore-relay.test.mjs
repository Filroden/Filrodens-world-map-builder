// A regional map's inherited ports and river towns brought onto its own shore (ShoreRelay): from
// revision 2, once as it opens, an inherited port pin moves to the nearest land beside water in its
// parent cell, and a river town beside its parent cell's navigable river; a kept pin, a town with
// no river in its parent cell, a pin already in place and a revision 1 map stay as they are.
import "../mesh/foundry-stubs.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

const { FILRODENSWMB } = await import("../../src/config.js");
const { ShoreRelay } = await import("../../src/applications/ShoreRelay.js");
const { RunCells } = await import("../../src/applications/RunCells.js");
const { MeshSession } = await import("../../src/mesh/MeshSession.js");
const { HEIGHT, WIDTH, syntheticMap } = await import("../generator/synthetic.mjs");
const { parentRunOf } = await import("../generator/infill-helpers.mjs");

function studio(revision = 2) {
    const { mesh, buffers, makePayload } = syntheticMap();
    const payload = makePayload();
    const aggregates = mesh.aggregate({ elevation: buffers.elevation, waterMask: buffers.waterMask, seaLevel: payload.seaLevel });
    const meshSession = new MeshSession({ mesh, meshBlock: { seed: 7, spacing: 4, cells: mesh.cellCount, width: WIDTH, height: HEIGHT, version: 1 }, layerSets: [], owners: {}, aggregates });
    return { meshSession, parentRun: parentRunOf(mesh, payload), currentParentId: "parentAAAAAAAAAA", modelRun: null, mapPins: [], uiState: { generatorRevision: revision }, currentRiverData: null };
}

const town = (id, cell, mesh, tier = "town", extra = {}) => ({ id, name: id, x: mesh.siteX(cell), y: mesh.siteY(cell), cell, generated: { run: "runAAAAAAAAAAAAA", kind: "town", tier, population: 2000, edited: false, locked: false, ...extra } });

test("an inherited port moves onto the shore of its parent cell, nearest where it stood; kept and revision 1 ports stay", () => {
    const app = studio();
    const { mesh, aggregates } = app.meshSession;
    const land = aggregates.land;
    const { parentOf } = RunCells.of(app).cells;
    const shore = (cell) => land[cell] === 1 && mesh.neighbours(cell).some((next) => land[next] !== 1);
    // A land cell off the shore whose parent cell reaches the coast
    let inland = -1;
    for (let cell = 0; cell < mesh.cellCount && inland < 0; cell++) {
        if (land[cell] !== 1 || shore(cell) || parentOf[cell] < 0) continue;
        let coastal = false;
        for (let other = 0; other < mesh.cellCount && !coastal; other++) if (parentOf[other] === parentOf[cell] && shore(other)) coastal = true;
        if (coastal) inland = cell;
    }
    assert.ok(inland >= 0, "the island has a coastal parent cell with land off its shore");
    app.mapPins = [town("port", inland, mesh, FILRODENSWMB.GENERATOR.PIN_TIERS.port), town("kept", inland, mesh, FILRODENSWMB.GENERATOR.PIN_TIERS.port, { edited: true })];
    assert.equal(ShoreRelay.needed(app), true);
    const moved = ShoreRelay.run(app);
    assert.equal(moved.ports, 1);
    const [port, kept] = app.mapPins;
    assert.ok(shore(port.cell), "on the shore");
    assert.equal(parentOf[port.cell], parentOf[inland], "in its own parent cell");
    assert.deepEqual([port.x, port.y], [mesh.siteX(port.cell), mesh.siteY(port.cell)]);
    assert.equal(kept.cell, inland, "an edited pin is the reader's own");
    assert.equal(ShoreRelay.run(app).ports, 0, "a port on the shore stays");

    assert.equal(ShoreRelay.needed(studio(1)), false, "a revision 1 map keeps its ports");
    assert.equal(ShoreRelay.needed({ ...app, shoresPlaced: true }), false, "once");
    assert.equal(ShoreRelay.needed({ ...app, currentParentId: null }), false, "a map of its own");
});

test("a town whose parent cell holds a navigable river moves beside it; one without stays", () => {
    const app = studio();
    const { mesh, aggregates } = app.meshSession;
    const land = aggregates.land;
    const { parentOf } = RunCells.of(app).cells;
    // A big river across the island's middle, west to east
    const path = [];
    for (let x = 120; x <= 360; x++) path.push({ x, y: 180 });
    app.currentRiverData = { vectors: [{ id: 1, path }], network: { pixelsPerBaseline: 1, flows: new Map([[1, path.map(() => (FILRODENSWMB.GENERATOR.VALUES.NAVIGABLE_KM * 2) / mesh.kmPerPx)]]) } };
    // The display cells the river runs through, and a town off it in a parent cell it crosses
    const riverCells = new Set(path.map((point) => mesh.cellRaster[point.y * mesh.width + point.x]));
    const near = (cell) => riverCells.has(cell) || mesh.neighbours(cell).some((next) => riverCells.has(next));
    const crossed = new Set([...riverCells].map((cell) => parentOf[cell]));
    let off = -1;
    for (let cell = 0; cell < mesh.cellCount && off < 0; cell++) if (crossed.has(parentOf[cell]) && land[cell] === 1 && !near(cell)) off = cell;
    assert.ok(off >= 0, "a town off the river in a parent cell it crosses");
    const parent = parentOf[off];
    let dry = -1;
    for (let cell = 0; cell < mesh.cellCount && dry < 0; cell++) if (land[cell] === 1 && Math.abs(mesh.siteY(cell) - 180) > 80 && parentOf[cell] >= 0) dry = cell;
    app.mapPins = [town("river", off, mesh), town("dry", dry, mesh)];
    const moved = ShoreRelay.run(app);
    assert.equal(moved.rivers, 1);
    const [river, stay] = app.mapPins;
    assert.ok(near(river.cell), "beside the river");
    assert.equal(parentOf[river.cell], parent);
    assert.equal(stay.cell, dry, "no river in its parent cell");

    // A small river is no navigable river
    const small = studio();
    small.currentRiverData = { vectors: [{ id: 1, path }], network: { pixelsPerBaseline: 1, flows: new Map([[1, path.map(() => 1)]]) } };
    small.mapPins = [town("river", off, small.meshSession.mesh)];
    assert.equal(ShoreRelay.run(small).rivers, 0);
});
