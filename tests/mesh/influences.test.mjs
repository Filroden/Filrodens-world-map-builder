// The influences painted on a map's cells (Influences): saved as the level owners are and read
// back, a damaged or foreign field left unpainted, per pixel for the generator, the brush's fade,
// raised and lowered on land only, building up as the brush moves and capped, erased anywhere,
// carried through a save and a rebuilt mesh.
import "./foundry-stubs.mjs";
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { MeshIntegration } from "../../src/applications/MeshIntegration.js";
import { INFLUENCE_KINDS, InfluenceStroke, Influences, MAX_INFLUENCE_LEVEL, brushWeight, validLevel } from "../../src/mesh/Influences.js";
import { MeshSession } from "../../src/mesh/MeshSession.js";
import { encodeOwners } from "../../src/mesh/OwnerLayer.js";
import { FIXTURES, P0_SKIP, cellsInRect, loadP0, readJson, smallMesh, smallSession } from "./helpers.mjs";

test("a value is a whole number from -100 to 100; anything else is kept in range or none", () => {
    assert.equal(MAX_INFLUENCE_LEVEL, 100);
    assert.deepEqual([20, -100, 170, -900, 1.8, "2", "x", Number.NaN, null].map(validLevel), [20, -100, 100, -100, 1, 2, 0, 0, 0]);
});

test("unpainted influences save nothing; painted ones save each kind painted and read back the same", () => {
    const mesh = smallMesh();
    const influences = new Influences(mesh.cellCount);
    assert.equal(influences.encode(), null, "a map never painted saves no field");
    assert.equal(influences.any(), false);
    influences.layer("capacity").set(cellsInRect(mesh, 200, 50, 260, 120), 40);
    const saved = influences.encode();
    assert.deepEqual(Object.keys(saved), ["capacity"], "only the kind painted");
    const back = new Influences(mesh.cellCount, saved);
    assert.deepEqual(back.layer("capacity").owners, influences.layer("capacity").owners);
    assert.equal(back.any("security"), false);
    assert.equal(back.count("capacity"), influences.count("capacity"));
});

test("a damaged or foreign field is no painting: text that does not decode, or the wrong number of cells", () => {
    const mesh = smallMesh();
    for (const bad of [{ capacity: "!!" }, { capacity: encodeOwners(new Int32Array(10).fill(2)) }, { capacity: 42 }, "x", []]) {
        const influences = new Influences(mesh.cellCount, bad);
        assert.equal(influences.any(), false, JSON.stringify(bad));
    }
    const wild = new Int32Array(mesh.cellCount).fill(999);
    const read = new Influences(mesh.cellCount, { security: encodeOwners(wild) });
    assert.ok(read.layer("security").owners.every((level) => level === MAX_INFLUENCE_LEVEL), "values beyond the range are kept within it");
});

test("the generator reads a kind per pixel, each pixel the value of the cell it lies in", () => {
    const mesh = smallMesh();
    const influences = new Influences(mesh.cellCount);
    assert.equal(influences.pixels(mesh, "capacity"), null, "nothing for a kind not painted");
    const cells = cellsInRect(mesh, 200, 50, 260, 120);
    influences.layer("capacity").set(cells, -40);
    const pixels = influences.pixels(mesh, "capacity");
    assert.equal(pixels.length, mesh.width * mesh.height);
    for (let pixel = 0; pixel < pixels.length; pixel += 97) assert.equal(pixels[pixel], influences.levelAt("capacity", mesh.cellRaster[pixel]));
    assert.ok(pixels.some((level) => level === -40));
});

test("the brush is solid out to its feather and fades to nothing at its edge", () => {
    assert.equal(brushWeight(0, 20, 0.4), 1);
    assert.equal(brushWeight(8, 20, 0.4), 1);
    assert.equal(brushWeight(14, 20, 0.4), 0.5);
    assert.equal(brushWeight(20, 20, 0.4), 0);
    assert.equal(brushWeight(21, 20, 0.4), 0);
    assert.ok(brushWeight(19.9, 20, 1) > 0, "a feather of 1 still fades over a sliver");
});

test("Raise builds up on land as the brush moves, faded by the feather, the same however the moves arrive", async () => {
    const session = await smallSession();
    const { mesh, influences } = session;
    const land = session.aggregates.land;
    const stroke = (options, path) => {
        const each = new InfluenceStroke(influences, mesh, land, { kind: "capacity", strength: 0.8, feather: 0.4, ...options });
        for (const [x0, y0, x1, y1] of path) each.brush(x0, y0, x1, y1, 30);
        return each.end();
    };
    const centre = mesh.cellAt(250, 150);
    const edge = [...cellsInRect(mesh, 270, 145, 276, 155)][0];
    // A click is one dab: an eighth of the strength at the core, less towards the edge
    const patch = stroke({ mode: "raise" }, [[250, 150, 250, 150]]);
    assert.ok(patch.cells.every((cell) => land[cell] === 1), "only land");
    assert.equal(influences.levelAt("capacity", centre), 10);
    assert.ok(influences.levelAt("capacity", edge) >= 0 && influences.levelAt("capacity", edge) < 10, "fading towards the edge");

    // One pass of a solid brush adds about the strength; back and forth builds up, to the most
    influences.restoreKind("capacity", null);
    stroke({ mode: "raise", feather: 1 }, [[200, 150, 300, 150]]);
    const once = influences.levelAt("capacity", centre);
    assert.ok(once >= 70 && once <= 90, `one pass ${once}`);
    stroke({ mode: "raise", feather: 1 }, [[200, 150, 300, 150], [300, 150, 200, 150]]);
    assert.equal(influences.levelAt("capacity", centre), 100, "capped at the most");

    // What a stroke adds depends on the ground it covers, not on how many moves report it
    const whole = () => {
        influences.restoreKind("capacity", null);
        stroke({ mode: "raise", strength: 0.3 }, [[200, 150, 300, 150]]);
        return Int32Array.from(influences.layer("capacity").owners);
    };
    const one = whole();
    influences.restoreKind("capacity", null);
    stroke({ mode: "raise", strength: 0.3 }, Array.from({ length: 20 }, (_, at) => [200 + at * 5, 150, 205 + at * 5, 150]));
    assert.deepEqual(influences.layer("capacity").owners, one);

    // Lower takes away, down to the least; Shift swaps Raise and Lower
    influences.restoreKind("capacity", null);
    stroke({ mode: "raise", strength: 1, invert: true }, [[250, 150, 250, 150]]);
    assert.equal(influences.levelAt("capacity", centre), -12, "Shift lowers with Raise (an eighth of the most, to the nearest whole number)");
    for (let pass = 0; pass < 3; pass++) stroke({ mode: "lower", strength: 1, feather: 1 }, [[200, 150, 300, 150]]);
    assert.equal(influences.levelAt("capacity", centre), -100, "capped at the least");

    // Undo puts the stroke back cell by cell
    const before = Int32Array.from(influences.layer("capacity").owners);
    const last = stroke({ mode: "raise" }, [[220, 150, 280, 150]]);
    influences.layer("capacity").revert(last);
    assert.deepEqual(influences.layer("capacity").owners, before);
});

test("Erase brings any value back towards none as it moves, on land and water alike", async () => {
    const session = await smallSession();
    const { mesh, influences } = session;
    const land = session.aggregates.land;
    const centre = mesh.cellAt(250, 150);
    const water = [...cellsInRect(mesh, 0, 140, 90, 160)].find((cell) => land[cell] === 0);
    influences.layer("security").set([centre], -60);
    influences.layer("security").set([water], 40);
    const erase = (x, times = 1) => {
        const each = new InfluenceStroke(influences, mesh, land, { kind: "security", mode: "erase", strength: 0.8, feather: 0.9 });
        assert.equal(each.erases, true);
        for (let at = 0; at < times; at++) each.brush(x, 150, x, 150, 10);
        each.end();
    };
    erase(250);
    assert.equal(influences.levelAt("security", centre), -50, "an eighth of the strength taken off, towards none");
    erase(250);
    erase(250);
    erase(250);
    erase(250);
    erase(250);
    erase(250);
    assert.equal(influences.levelAt("security", centre), 0, "and no further than none");
    erase(mesh.siteX(water));
    assert.equal(influences.levelAt("security", water), 30, "water painted by hand in a saved map is cleared too");
    assert.equal(influences.any("capacity"), false, "another kind is left alone");
});

test("moved with the terrain, each cell takes the value under its source point, and none from off the map", () => {
    const mesh = smallMesh();
    const influences = new Influences(mesh.cellCount);
    influences.layer("capacity").set(cellsInRect(mesh, 0, 0, mesh.width, mesh.height), 30);
    const same = influences.resampled(mesh, mesh);
    assert.deepEqual(same.layer("capacity").owners, influences.layer("capacity").owners);
    const shifted = influences.resampled(mesh, mesh, (x, y) => [x - 100, y]);
    for (const cell of cellsInRect(mesh, 0, 0, 90, mesh.height)) assert.equal(shifted.levelAt("capacity", cell), 0, "revealed land is unpainted");
    for (const cell of cellsInRect(mesh, 110, 0, mesh.width, mesh.height)) assert.equal(shifted.levelAt("capacity", cell), 30);
    for (const kind of INFLUENCE_KINDS) assert.ok(shifted.layer(kind));
});

test("a save carries the influences, a map opened again has them, and so does one whose mesh is rebuilt", { skip: P0_SKIP }, async () => {
    const v3 = readJson(join(FIXTURES, "v3-vectors.json"));
    const { session, mapData } = await MeshSession.open(v3, { buffers: loadP0().buffers });
    const app = { meshSession: session, layerSets: mapData.layerSets, mapRoutes: mapData.mapRoutes, mapPins: mapData.mapPins };
    const empty = {};
    MeshIntegration.preparePayload(app, empty);
    assert.ok(!("influences" in empty), "nothing painted, nothing saved");

    const cells = cellsInRect(session.mesh, 600, 600, 800, 800);
    session.influences.layer("security").set(cells, -70);
    const payload = { ...mapData };
    const owners = MeshIntegration.preparePayload(app, payload);
    assert.deepEqual(Object.keys(payload.influences), ["security"]);

    const reopened = await MeshSession.open(payload, { owners, buffers: loadP0().buffers });
    assert.equal(reopened.rebuilt, false);
    assert.deepEqual(reopened.session.influences.layer("security").owners, session.influences.layer("security").owners);

    // A stored block that no longer fits: the mesh is built again and the painting follows the land
    const misfit = structuredClone(payload);
    misfit.mesh.cells = 1;
    const rebuilt = await MeshSession.open(misfit, { owners, buffers: loadP0().buffers });
    assert.equal(rebuilt.rebuilt, true);
    assert.equal(rebuilt.session.influences.count("security"), session.influences.count("security"));
});
