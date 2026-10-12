// Owner arrays: the codec, edits and their patches, selections, nesting, and the territory passes.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
    OwnerLayer,
    cellsInCircle,
    cellsInPolygon,
    connectedCells,
    decodeOwners,
    encodeOwners,
    mergePatches,
    nestingViolations,
    parentAssignments,
    pointInPolygon,
    withinParent,
} from "../../src/mesh/OwnerLayer.js";
import { UNCLAIMED } from "../../src/mesh/Schema.js";
import { claimWaters, fillUnclaimedLand, relaxBorders } from "../../src/mesh/Territory.js";
import { P0_SKIP, flatAggregates, loadP0, seededRandom, smallMesh } from "./helpers.mjs";

const MAX_LEVEL_BYTES = 50 * 1024;

// ------------------------------------------------------------------ codec

test("RLE codec round-trips random, all-equal and alternating arrays", () => {
    const random = seededRandom(3);
    const cases = [
        new Int32Array(0),
        new Int32Array(1000).fill(UNCLAIMED),
        new Int32Array(1000).fill(7),
        Int32Array.from({ length: 1001 }, (_, i) => (i % 2 ? 3 : UNCLAIMED)),
        Int32Array.from({ length: 5000 }, () => Math.floor(random() * 300) - 1),
        Int32Array.from({ length: 5000 }, () => Math.floor(random() * 2 ** 31) * (random() < 0.5 ? -1 : 1)),
        Int32Array.of(2147483647, -2147483648, 0, -1),
    ];
    for (const owners of cases) assert.deepEqual(decodeOwners(encodeOwners(owners)), owners);
});

test("RLE codec rejects corrupt data", () => {
    const text = encodeOwners(new Int32Array(100).fill(5));
    assert.throws(() => OwnerLayer.decode(text, 99), /99/);
    const bytes = atob(text);
    assert.throws(() => decodeOwners(btoa(bytes.slice(0, -1))), /corrupt/);
});

test("the P0JBVA realm layer encodes well under 50 kB", { skip: P0_SKIP }, () => {
    const { realms, mesh } = loadP0();
    const text = encodeOwners(realms);
    assert.equal(realms.length, mesh.cellCount);
    assert.ok(text.length < MAX_LEVEL_BYTES, `${text.length} bytes`);
    assert.deepEqual(decodeOwners(text), realms);
});

// ------------------------------------------------------------------ edits

test("paint and erase change exactly the given cells and undo restores", () => {
    const mesh = smallMesh();
    const layer = new OwnerLayer(mesh.cellCount);
    const first = layer.paint([5, 6, 7, 7], 2);
    assert.deepEqual([...first.cells], [5, 6, 7]);
    assert.deepEqual([...first.before], [UNCLAIMED, UNCLAIMED, UNCLAIMED]);
    const second = layer.paint([6, 7, 8], 3);
    assert.deepEqual([...second.cells], [6, 7, 8]);
    assert.deepEqual([...second.before], [2, 2, UNCLAIMED]);
    const third = layer.erase([5, 8, 9]);
    assert.deepEqual([...third.cells], [5, 8]);
    assert.equal(layer.paint([6], 3).cells.length, 0, "painting a cell its own owner changes nothing");

    const snapshot = layer.owners.slice();
    layer.revert(third);
    layer.revert(second);
    layer.revert(first);
    assert.ok(layer.owners.every((owner) => owner === UNCLAIMED));
    layer.apply(first);
    layer.apply(second);
    layer.apply(third);
    assert.deepEqual(layer.owners, snapshot);
});

test("merged patches undo a whole stroke in one step", () => {
    const layer = new OwnerLayer(20);
    const a = layer.paint([1, 2, 3], 4);
    const b = layer.paint([3, 4], 5);
    const c = layer.erase([1]);
    const stroke = mergePatches(mergePatches(a, b), c);
    assert.deepEqual([...stroke.cells], [2, 3, 4], "cell 1 ends where it started and drops out");
    layer.revert(stroke);
    assert.ok(layer.owners.every((owner) => owner === UNCLAIMED));
});

test("assign gives many cells many owners in one patch", () => {
    const layer = new OwnerLayer(10);
    layer.paint([0, 1], 1);
    const patch = layer.assign([3, 1, 0], [2, 2, 1]);
    assert.deepEqual([...patch.cells], [1, 3]);
    assert.deepEqual([...patch.before], [1, UNCLAIMED]);
    assert.deepEqual([...patch.after], [2, 2]);
});

test("flood fills the connected cells of the start's owner only", () => {
    const mesh = smallMesh();
    const layer = new OwnerLayer(mesh.cellCount);
    // A wall of owner 1 down the middle splits the unclaimed ground in two
    const wall = [];
    for (let cell = 0; cell < mesh.cellCount; cell++) if (Math.abs(mesh.siteX(cell) - 200) < 12) wall.push(cell);
    layer.paint(wall, 1);
    const start = mesh.cellAt(50, 150);
    const patch = layer.flood(mesh, start, 2);
    const expected = [];
    for (let cell = 0; cell < mesh.cellCount; cell++) if (mesh.siteX(cell) < 188 && layer.ownerOf(cell) !== 1) expected.push(cell);
    assert.deepEqual([...patch.cells], expected);
    for (let cell = 0; cell < mesh.cellCount; cell++) if (mesh.siteX(cell) > 212) assert.equal(layer.ownerOf(cell), UNCLAIMED);
    assert.equal(layer.flood(mesh, start, 2).cells.length, 0);

    const landOnly = new OwnerLayer(mesh.cellCount);
    const top = landOnly.flood(mesh, start, 4, { passable: (cell) => mesh.siteY(cell) < 150 });
    assert.ok(top.cells.every((cell) => mesh.siteY(cell) < 150 || cell === start));
});

test("lasso takes the cells whose site is inside the polygon", () => {
    const mesh = smallMesh();
    const layer = new OwnerLayer(mesh.cellCount);
    const square = [
        { x: 100, y: 100 },
        { x: 200, y: 100 },
        { x: 200, y: 200 },
        { x: 100, y: 200 },
    ];
    const patch = layer.lasso(mesh, square, 6);
    const expected = [];
    for (let cell = 0; cell < mesh.cellCount; cell++) {
        const [x, y] = [mesh.siteX(cell), mesh.siteY(cell)];
        if (x > 100 && x < 200 && y > 100 && y < 200) expected.push(cell);
    }
    assert.deepEqual([...patch.cells], expected);
    assert.deepEqual([...cellsInPolygon(mesh, square.map(({ x, y }) => [x, y]))], expected);
    assert.equal(pointInPolygon(Float64Array.of(0, 0, 10, 0, 10, 10, 0, 10), 5, 5), true);
    assert.equal(pointInPolygon(Float64Array.of(0, 0, 10, 0, 10, 10, 0, 10), 15, 5), false);
});

test("a brush takes the cells within its radius, and at least the one under it", () => {
    const mesh = smallMesh();
    const cells = cellsInCircle(mesh, 150, 150, 20);
    const expected = [];
    for (let cell = 0; cell < mesh.cellCount; cell++) if (Math.hypot(mesh.siteX(cell) - 150, mesh.siteY(cell) - 150) <= 20) expected.push(cell);
    assert.deepEqual([...cells].sort((a, b) => a - b), expected);
    assert.deepEqual([...cellsInCircle(mesh, 150, 150, 0.1)], [mesh.cellAt(150, 150)]);
});

test("connectedCells stays inside the predicate", () => {
    const mesh = smallMesh();
    const left = connectedCells(mesh, mesh.cellAt(10, 10), (cell) => mesh.siteX(cell) < 100);
    assert.ok(left.length > 100 && left.every((cell) => mesh.siteX(cell) < 100));
});

// ------------------------------------------------------------------ nesting

test("nesting check flags child cells outside their parent region", () => {
    const mesh = smallMesh();
    const parent = new OwnerLayer(mesh.cellCount);
    const child = new OwnerLayer(mesh.cellCount);
    for (let cell = 0; cell < mesh.cellCount; cell++) parent.owners[cell] = mesh.siteX(cell) < 200 ? 0 : 1;
    // Child 10 sits inside parent 0 but spills over x = 200 to x = 220
    const spill = [];
    for (let cell = 0; cell < mesh.cellCount; cell++) {
        const [x, y] = [mesh.siteX(cell), mesh.siteY(cell)];
        if (x > 100 && x < 220 && y < 100) child.owners[cell] = 10;
        if (x >= 200 && x < 220 && y < 100) spill.push(cell);
    }
    // Child 11 lies wholly in parent 1
    for (let cell = 0; cell < mesh.cellCount; cell++) if (mesh.siteX(cell) > 300 && mesh.siteY(cell) > 200) child.owners[cell] = 11;

    const assignments = parentAssignments(child.owners, parent.owners);
    assert.equal(assignments.get(10), 0);
    assert.equal(assignments.get(11), 1);
    assert.deepEqual([...nestingViolations(child.owners, parent.owners)], spill);

    // Painting through withinParent cannot cross the parent's border
    const patch = child.paint(cellsInCircle(mesh, 200, 150, 40), 12, withinParent(parent.owners, 0));
    assert.ok(patch.cells.length > 0 && patch.cells.every((cell) => parent.owners[cell] === 0));
});

// ------------------------------------------------------------------ territory

test("unowned land joins the nearest region; relaxation moves only the border band", () => {
    const mesh = smallMesh();
    const aggregates = flatAggregates(mesh, { isWater: (x) => x > 330 });
    const layer = new OwnerLayer(mesh.cellCount);
    layer.paint([mesh.cellAt(50, 150)], 0);
    layer.paint([mesh.cellAt(250, 150)], 1);
    fillUnclaimedLand(mesh, layer, aggregates.land);
    for (let cell = 0; cell < mesh.cellCount; cell++) {
        if (!aggregates.land[cell]) assert.equal(layer.ownerOf(cell), UNCLAIMED);
        else assert.notEqual(layer.ownerOf(cell), UNCLAIMED);
    }
    const before = layer.owners.slice();
    const rings = 2;
    const patch = relaxBorders(mesh, layer, aggregates, { RINGS: rings });
    // Ring distance of every land cell from the old border; only cells within RINGS may change
    const ring = new Int32Array(mesh.cellCount).fill(-1);
    let frontier = [];
    for (let cell = 0; cell < mesh.cellCount; cell++) {
        if (aggregates.land[cell] && mesh.neighbours(cell).some((next) => aggregates.land[next] && before[next] !== before[cell])) {
            ring[cell] = 0;
            frontier.push(cell);
        }
    }
    for (let step = 1; step <= rings; step++) {
        const next = [];
        for (const cell of frontier) for (const n of mesh.neighbours(cell)) if (aggregates.land[n] && ring[n] < 0) next.push(n), (ring[n] = step);
        frontier = next;
    }
    assert.ok(patch.cells.length > 0, "a straight border across flat ground still settles somewhere");
    for (const cell of patch.cells) assert.ok(ring[cell] >= 0, `cell ${cell} moved but was not in the border band`);
});

test("territorial waters stop at the claim distance", () => {
    const mesh = smallMesh();
    const aggregates = flatAggregates(mesh, { isWater: (x) => x > 200 });
    const layer = new OwnerLayer(mesh.cellCount);
    for (let cell = 0; cell < mesh.cellCount; cell++) if (aggregates.land[cell]) layer.owners[cell] = 3;
    const limit = 40;
    claimWaters(mesh, layer, aggregates.land, limit);
    for (let cell = 0; cell < mesh.cellCount; cell++) {
        if (aggregates.land[cell]) continue;
        if (mesh.siteX(cell) > 200 + limit + 2 * mesh.spacing) assert.equal(layer.ownerOf(cell), UNCLAIMED, `cell at ${mesh.siteX(cell)}`);
        if (mesh.siteX(cell) < 200 + limit - 2 * mesh.spacing) assert.equal(layer.ownerOf(cell), 3, `cell at ${mesh.siteX(cell)}`);
    }
});

test("P0JBVA realms: every realm keeps land and the layer is a valid partition", { skip: P0_SKIP }, () => {
    const { realms, aggregates, realmCount } = loadP0();
    const landPerRealm = new Map();
    realms.forEach((owner, cell) => {
        if (owner !== UNCLAIMED && aggregates.land[cell]) landPerRealm.set(owner, (landPerRealm.get(owner) ?? 0) + 1);
    });
    assert.equal(landPerRealm.size, realmCount);
});
