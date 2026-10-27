// Painting regions (RegionPaint): the brush, Erase and Fill, land only when painting, nesting
// inside a parent region, clearing the levels below, and one patch per level.
import assert from "node:assert/strict";
import { test } from "node:test";
import { UNCLAIMED, addRegion, createLayerSet, createLevel } from "../../src/mesh/Schema.js";
import { RegionStroke, STROKE_REFUSALS, cellsAlong, fillExtent, paintAction } from "../../src/mesh/RegionPaint.js";
import { cellsInRect, smallMesh, smallSession } from "./helpers.mjs";

let ids = 0;
const nextId = () => `p${++ids}`;

/**
 * Realms above Counties (constrained). West is painted over x 100-250 (land: water lies left of
 * x 100), East over x 250-400; Northwest is painted in West's top half.
 */
async function paintedMap({ nestingMode = "constrained" } = {}) {
    const realms = createLevel({ name: "Realms" }, nextId);
    const west = addRegion(realms, { name: "West" }, nextId);
    const east = addRegion(realms, { name: "East" }, nextId);
    const counties = createLevel({ name: "Counties", parentLevelId: realms.id, nestingMode }, nextId);
    const northwest = addRegion(counties, { name: "Northwest", parentKey: west.key }, nextId);
    const layerSets = [createLayerSet({ name: "Political", levels: [realms, counties] }, nextId)];
    const session = await smallSession(layerSets);
    const mesh = session.mesh;
    session.layer(realms.id).paint(cellsInRect(mesh, 100, 0, 250, 300), west.key);
    session.layer(realms.id).paint(cellsInRect(mesh, 250, 0, 400, 300), east.key);
    session.layer(counties.id).paint(cellsInRect(mesh, 100, 0, 250, 150), northwest.key);
    return { session, layerSets, realms, counties, west, east, northwest, mesh, land: session.aggregates.land };
}

/** A fresh, unpainted level of its own, for the simple cases. */
async function emptyLevel() {
    const level = createLevel({ name: "Zones" }, nextId);
    const region = addRegion(level, { name: "Zone" }, nextId);
    const layerSets = [createLayerSet({ name: "Zones", levels: [level] }, nextId)];
    const session = await smallSession(layerSets);
    return { session, layerSets, level, region, mesh: session.mesh, land: session.aggregates.land };
}

const owned = (session, levelId, key) => [...session.layer(levelId).owners.keys()].filter((cell) => session.layer(levelId).owners[cell] === key);

test("Shift turns each mode into its opposite", () => {
    assert.deepEqual(paintAction("paint", false), { erase: false });
    assert.deepEqual(paintAction("paint", true), { erase: true });
    assert.deepEqual(paintAction("erase", true), { erase: false });
    assert.deepEqual(paintAction("fill", false), { erase: false });
});

test("a fast brush stroke leaves no gaps between its discs", () => {
    const mesh = smallMesh();
    const cells = cellsAlong(mesh, 120, 150, 380, 150, 2);
    for (let x = 125; x < 380; x += 10) assert.ok(cells.has(mesh.cellAt(x, 150)), `the cell at x ${x} is covered`);
});

test("the brush paints land only, as one patch, and the patch undoes exactly", async () => {
    const { session, layerSets, level, region, land } = await emptyLevel();
    const before = session.layer(level.id).owners.slice();
    const stroke = new RegionStroke(session, layerSets, { level, region, mode: "paint" });
    assert.deepEqual(stroke.begin(150, 150), { ok: true });
    stroke.brush(150, 150, 50, 150, 12);
    stroke.brush(50, 150, 50, 200, 12);
    const { patches, parentKeyChanged, cleared } = stroke.end();
    assert.equal(patches.size, 1);
    assert.equal(parentKeyChanged, false);
    assert.equal(cleared, 0);
    const patch = patches.get(level.id);
    assert.ok(patch.cells.length > 0);
    assert.ok([...patch.cells].every((cell) => land[cell] === 1), "no water painted");
    session.layer(level.id).revert(patch);
    assert.deepEqual(session.layer(level.id).owners, before);
});

test("Erase takes land and water alike, and Shift with the brush erases", async () => {
    const { session, layerSets, level, region, land, mesh } = await emptyLevel();
    // Water claimed by hand (as a level's waters rule would), beside painted land
    session.layer(level.id).paint(cellsInRect(mesh, 60, 100, 140, 200), region.key);
    const both = owned(session, level.id, region.key);
    assert.ok(both.some((cell) => land[cell] === 1) && both.some((cell) => land[cell] !== 1));

    const shiftErase = new RegionStroke(session, layerSets, { level, region, mode: "paint", invert: true });
    shiftErase.begin(120, 150);
    shiftErase.brush(110, 150, 140, 150, 12);
    const taken = shiftErase.end().patches.get(level.id);
    assert.ok(taken.cells.length > 0 && [...taken.cells].every((cell) => land[cell] === 1), "Shift+Paint erases the land under the brush");

    const erase = new RegionStroke(session, layerSets, { level, region: null, mode: "erase" });
    assert.deepEqual(erase.begin(100, 150), { ok: true }, "erasing needs no region");
    erase.brush(60, 150, 140, 150, 60);
    erase.end();
    assert.equal(owned(session, level.id, region.key).length, 0, "land and water both erased");
});

test("painting needs a region, and a press off the map does nothing", async () => {
    const { session, layerSets, level } = await emptyLevel();
    assert.deepEqual(new RegionStroke(session, layerSets, { level, region: null, mode: "paint" }).begin(150, 150), { ok: false, reason: STROKE_REFUSALS.NO_REGION });
    assert.deepEqual(new RegionStroke(session, layerSets, { level, region: null, mode: "erase" }).begin(-5, 150), { ok: false, reason: STROKE_REFUSALS.OFF_MAP });
    assert.equal(session.isStroking, false);
});

test("a new child region takes the parent region it is first painted in, and stays inside it", async () => {
    const map = await paintedMap();
    const south = addRegion(map.counties, { name: "South" }, nextId);
    const outside = new RegionStroke(map.session, map.layerSets, { level: map.counties, region: south, mode: "paint" });
    assert.deepEqual(outside.begin(50, 150), { ok: false, reason: STROKE_REFUSALS.OUTSIDE_PARENT }, "water has no parent region");

    const stroke = new RegionStroke(map.session, map.layerSets, { level: map.counties, region: south, mode: "paint" });
    assert.equal(stroke.begin(200, 250).ok, true);
    stroke.brush(200, 250, 330, 250, 15);
    const { patches, parentKeyChanged } = stroke.end();
    assert.equal(parentKeyChanged, true);
    assert.equal(south.parentKey, map.west.key);
    const realms = map.session.layer(map.realms.id).owners;
    assert.ok([...patches.get(map.counties.id).cells].every((cell) => realms[cell] === map.west.key), "nothing painted in East");
});

test("painting a parent clears the child cells it takes, in the same stroke", async () => {
    const map = await paintedMap();
    const stroke = new RegionStroke(map.session, map.layerSets, { level: map.realms, region: map.east, mode: "paint" });
    stroke.begin(200, 75);
    stroke.brush(200, 75, 240, 75, 20);
    const { patches, cleared } = stroke.end();
    assert.ok(cleared > 0);
    assert.deepEqual([...patches.keys()].sort(), [map.counties.id, map.realms.id].sort());
    const counties = map.session.layer(map.counties.id).owners;
    assert.ok([...patches.get(map.realms.id).cells].every((cell) => counties[cell] === UNCLAIMED));
});

test("fill takes the connected land of the same owner, previewed by fillExtent, and Shift empties a region", async () => {
    const map = await paintedMap();
    const zone = addRegion(map.counties, { name: "Southwest" }, nextId);
    const extent = fillExtent(map.session, map.counties, zone, 200, 250);
    assert.equal(fillExtent(map.session, map.counties, zone, 50, 150).length, 0, "nothing over water");
    const fill = new RegionStroke(map.session, map.layerSets, { level: map.counties, region: zone, mode: "fill" });
    fill.begin(200, 250);
    fill.fill(200, 250);
    const filled = fill.end().patches.get(map.counties.id);
    const realms = map.session.layer(map.realms.id).owners;
    assert.ok(filled.cells.length > 0);
    assert.deepEqual([...filled.cells].sort((a, b) => a - b), [...extent].sort((a, b) => a - b), "the preview is what the fill takes");
    assert.ok([...filled.cells].every((cell) => realms[cell] === map.west.key && map.land[cell] === 1), "West's unassigned land only");
    assert.ok(!filled.cells.includes(map.mesh.cellAt(200, 75)), "Northwest is left alone");

    const empty = new RegionStroke(map.session, map.layerSets, { level: map.counties, region: zone, mode: "fill", invert: true });
    empty.begin(200, 75);
    empty.fill(200, 75);
    empty.end();
    assert.equal(owned(map.session, map.counties.id, map.northwest.key).length, 0);
});
