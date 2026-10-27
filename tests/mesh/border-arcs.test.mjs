// Borders derived from owner arrays: completeness, junctions, smoothing, classes, nesting, labels.
import assert from "node:assert/strict";
import { test } from "node:test";
import { arcsForLevel, borderSegments, chaikin, coincidentEdges, coincidentWith, labelAnchor, labelCandidates } from "../../src/mesh/BorderArcs.js";
import { UNCLAIMED } from "../../src/mesh/Schema.js";
import { P0_SKIP, flatAggregates, loadP0, smallMesh } from "./helpers.mjs";

/** Expected arc counts for the P0JBVA realm fixture (see the handoff for how they compare with the prototype). */
const P0_ARCS = { total: 122, sea: 80, tolerance: 0.1 };

/** Four quadrant regions over land, a lake in the middle claimed by region 0, and unclaimed sea on the right. */
function quadrantLevel() {
    const mesh = smallMesh();
    const aggregates = flatAggregates(mesh, { isWater: (x, y) => x > 340 || Math.hypot(x - 120, y - 80) < 25 });
    const owners = new Int32Array(mesh.cellCount).fill(UNCLAIMED);
    for (let cell = 0; cell < mesh.cellCount; cell++) {
        const [x, y] = [mesh.siteX(cell), mesh.siteY(cell)];
        if (x > 340) continue;
        owners[cell] = (x < 170 ? 0 : 1) + (y < 150 ? 0 : 2);
    }
    return { mesh, land: aggregates.land, owners };
}

/** Circumcentre ids that are endpoints of exactly one arc end, or more than two: the junctions. */
function endpointCounts(arcs) {
    const counts = new Map();
    for (const arc of arcs) {
        if (arc.closed) continue;
        for (const vertex of [arc.vertices[0], arc.vertices.at(-1)]) counts.set(vertex, (counts.get(vertex) ?? 0) + 1);
    }
    return counts;
}

const onMapEdge = (mesh, x, y) => x <= 1e-6 || y <= 1e-6 || x >= mesh.width - 1e-6 || y >= mesh.height - 1e-6;

function checkLevel(mesh, owners, land) {
    const arcs = arcsForLevel(mesh, owners, land);
    const segments = borderSegments(mesh, owners, land);

    // The arcs use every border half-edge exactly once
    const used = arcs.flatMap((arc) => [...new Set(arc.edges)]);
    const uniqueArcs = new Map();
    for (const arc of arcs) uniqueArcs.set(arc.vertices.join(), arc);
    const edgesOnce = [...uniqueArcs.values()].flatMap((arc) => [...arc.edges]).sort((a, b) => a - b);
    assert.deepEqual(edgesOnce, [...segments.edges].sort((a, b) => a - b), "arcs cover the half-edge scan exactly");
    assert.ok(used.length >= segments.length);

    // Every arc runs between the same two owners and one kind throughout
    const ownersOf = new Map();
    for (let s = 0; s < segments.length; s++) ownersOf.set(segments.edges[s], `${segments.kind[s]}|${segments.ownerA[s]}|${segments.ownerB[s]}`);
    for (const arc of uniqueArcs.values()) assert.equal(new Set(arc.edges.map((edge) => ownersOf.get(edge))).size, 1);

    // Arc ends are junctions (not exactly two arc ends meeting with the same owners and kind) or on the map edge
    const counts = endpointCounts([...uniqueArcs.values()]);
    for (const arc of arcs) {
        if (arc.closed) continue;
        const [x0, y0, x1, y1] = [arc.points[0], arc.points[1], arc.points.at(-2), arc.points.at(-1)];
        for (const [vertex, x, y] of [
            [arc.vertices[0], x0, y0],
            [arc.vertices.at(-1), x1, y1],
        ]) {
            const isJunction = counts.get(vertex) !== 2 || sameRunAt(uniqueArcs, vertex) === false;
            assert.ok(isJunction || onMapEdge(mesh, x, y), `arc end at ${x},${y} is neither a junction nor the map edge`);
        }
    }
    return arcs;
}

/** For a vertex where exactly two arc ends meet: true when both arcs have the same owners and kind (then it is not a junction). */
function sameRunAt(uniqueArcs, vertex) {
    const meeting = [...uniqueArcs.values()].filter((arc) => !arc.closed && (arc.vertices[0] === vertex || arc.vertices.at(-1) === vertex));
    return meeting.length === 2 && meeting[0].kind === meeting[1].kind && meeting[0].a === meeting[1].a && meeting[0].b === meeting[1].b;
}

/** Proper crossings between segments of different arcs (shared endpoints excluded), on a bucket grid. */
function countCrossings(arcs, cellSize = 16) {
    const buckets = new Map();
    const segments = [];
    arcs.forEach((arc, a) => {
        for (let i = 0; i + 3 < arc.points.length; i += 2) {
            const s = { arc: a, ax: arc.points[i], ay: arc.points[i + 1], bx: arc.points[i + 2], by: arc.points[i + 3] };
            const index = segments.push(s) - 1;
            for (let gx = Math.floor(Math.min(s.ax, s.bx) / cellSize); gx <= Math.floor(Math.max(s.ax, s.bx) / cellSize); gx++) {
                for (let gy = Math.floor(Math.min(s.ay, s.by) / cellSize); gy <= Math.floor(Math.max(s.ay, s.by) / cellSize); gy++) {
                    const key = gx * 100000 + gy;
                    if (!buckets.has(key)) buckets.set(key, []);
                    buckets.get(key).push(index);
                }
            }
        }
    });
    const orient = (ax, ay, bx, by, cx, cy) => Math.sign((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
    const crossings = new Set();
    for (const list of buckets.values()) {
        for (let i = 0; i < list.length; i++) {
            for (let j = i + 1; j < list.length; j++) {
                const [p, q] = [segments[list[i]], segments[list[j]]];
                if (p.arc === q.arc) continue;
                const o1 = orient(p.ax, p.ay, p.bx, p.by, q.ax, q.ay);
                const o2 = orient(p.ax, p.ay, p.bx, p.by, q.bx, q.by);
                const o3 = orient(q.ax, q.ay, q.bx, q.by, p.ax, p.ay);
                const o4 = orient(q.ax, q.ay, q.bx, q.by, p.bx, p.by);
                if (o1 * o2 < 0 && o3 * o4 < 0) crossings.add(`${Math.min(list[i], list[j])},${Math.max(list[i], list[j])}`);
            }
        }
    }
    return crossings.size;
}

test("quadrant level: arcs cover the scan, end at junctions or the map edge", () => {
    const { mesh, owners, land } = quadrantLevel();
    const arcs = checkLevel(mesh, owners, land);
    assert.ok(arcs.some((arc) => arc.cls === "land"));
    // The lake inside region 0 is region 0's own water: its shore draws no border
    assert.ok(!arcs.some((arc) => arc.kind === "shore" && (arc.a === UNCLAIMED || arc.b === UNCLAIMED)));
    // The coast against unclaimed sea at x = 340 is coastline, not a border
    for (const arc of arcs) if (arc.a === UNCLAIMED) assert.notEqual(arc.kind, "shore");
});

test("no arc crosses another, smoothed or not", () => {
    const { mesh, owners, land } = quadrantLevel();
    assert.equal(countCrossings(arcsForLevel(mesh, owners, land, { passes: 0 })), 0);
    assert.equal(countCrossings(arcsForLevel(mesh, owners, land)), 0);
    assert.equal(countCrossings(arcsForLevel(mesh, owners, land, { passes: 3 })), 0);
});

test("smoothing keeps the end points and closes rings", () => {
    const open = [0, 0, 10, 0, 10, 10, 20, 10];
    const smoothed = chaikin(open, false, 2);
    assert.deepEqual(smoothed.slice(0, 2), [0, 0]);
    assert.deepEqual(smoothed.slice(-2), [20, 10]);
    const ring = [0, 0, 10, 0, 10, 10, 0, 10, 0, 0];
    const closed = chaikin(ring, true, 1);
    assert.deepEqual(closed.slice(0, 2), closed.slice(-2));

    const { mesh, owners, land } = quadrantLevel();
    const raw = arcsForLevel(mesh, owners, land, { passes: 0 });
    const smooth = arcsForLevel(mesh, owners, land, { passes: 1 });
    raw.forEach((arc, i) => {
        if (arc.closed) return;
        assert.deepEqual([smooth[i].points[0], smooth[i].points[1]], [arc.points[0], arc.points[1]]);
        assert.deepEqual([smooth[i].points.at(-2), smooth[i].points.at(-1)], [arc.points.at(-2), arc.points.at(-1)]);
    });
});

test("an island region inside another is one closed ring", () => {
    const mesh = smallMesh();
    const land = new Uint8Array(mesh.cellCount).fill(1);
    const owners = new Int32Array(mesh.cellCount).fill(0);
    for (let cell = 0; cell < mesh.cellCount; cell++) if (Math.hypot(mesh.siteX(cell) - 200, mesh.siteY(cell) - 150) < 40) owners[cell] = 1;
    const arcs = arcsForLevel(mesh, owners, land);
    assert.equal(arcs.length, 1);
    assert.ok(arcs[0].closed);
    assert.deepEqual([arcs[0].points[0], arcs[0].points[1]], [arcs[0].points.at(-2), arcs[0].points.at(-1)]);
});

test("borders reaching the map edge are clipped to it", () => {
    const { mesh, owners, land } = quadrantLevel();
    for (const arc of arcsForLevel(mesh, owners, land)) {
        for (let i = 0; i < arc.points.length; i += 2) {
            assert.ok(arc.points[i] >= -1e-9 && arc.points[i] <= mesh.width + 1e-9);
            assert.ok(arc.points[i + 1] >= -1e-9 && arc.points[i + 1] <= mesh.height + 1e-9);
        }
    }
});

test("a child level leaves out the border its parent draws", () => {
    const { mesh, land } = quadrantLevel();
    const parent = new Int32Array(mesh.cellCount);
    const child = new Int32Array(mesh.cellCount);
    for (let cell = 0; cell < mesh.cellCount; cell++) {
        parent[cell] = mesh.siteX(cell) < 200 ? 0 : 1;
        child[cell] = parent[cell] * 10 + (mesh.siteY(cell) < 150 ? 0 : 1);
    }
    const parentArcs = arcsForLevel(mesh, parent, land);
    const childAll = arcsForLevel(mesh, child, land);
    const childOwn = arcsForLevel(mesh, child, land, { exclude: coincidentEdges(parentArcs) });
    const parentEdges = coincidentEdges(parentArcs);
    const ownEdges = coincidentEdges(childOwn);
    for (const edge of ownEdges) assert.ok(!parentEdges.has(edge));
    assert.equal(ownEdges.size + parentEdges.size, coincidentEdges(childAll).size, "together they draw every child border once");
    const masks = coincidentWith(childAll, parentArcs);
    assert.ok(masks.some((mask) => mask.includes(1)) && masks.some((mask) => mask.includes(0)));
});

test("label anchor is the deepest cell of the largest part", () => {
    const mesh = smallMesh();
    const owners = new Int32Array(mesh.cellCount).fill(UNCLAIMED);
    for (let cell = 0; cell < mesh.cellCount; cell++) {
        const [x, y] = [mesh.siteX(cell), mesh.siteY(cell)];
        if (x > 50 && x < 250 && y > 100 && y < 200) owners[cell] = 5; // main part, 200 x 100
        if (x > 320 && x < 360 && y > 20 && y < 60) owners[cell] = 5; // a small exclave
    }
    const anchor = labelAnchor(mesh, owners, 5);
    assert.ok(Math.abs(anchor.y - 150) < 10, `y ${anchor.y}`);
    assert.ok(anchor.x > 90 && anchor.x < 210, `x ${anchor.x}`);
    assert.equal(owners[anchor.cell], 5);
    assert.equal(labelAnchor(mesh, owners, 9), null);
});

test("a region offers its anchor first, then other deep places spread across it", () => {
    const mesh = smallMesh();
    const owners = new Int32Array(mesh.cellCount).fill(UNCLAIMED);
    for (let cell = 0; cell < mesh.cellCount; cell++) {
        const [x, y] = [mesh.siteX(cell), mesh.siteY(cell)];
        if (x > 20 && x < 330 && y > 100 && y < 200) owners[cell] = 5; // a long band, 310 x 100
    }
    const anchor = labelAnchor(mesh, owners, 5);
    const places = labelCandidates(mesh, owners, 5);
    assert.ok(places.length > 1 && places.length <= 6, `${places.length} places`);
    assert.deepEqual([places[0].x, places[0].y], [anchor.x, anchor.y], "the anchor first");
    assert.ok(places.every((place) => owners[place.cell] === 5 && place.depth * 3 >= anchor.depth), "deep cells of the region");
    const spread = Math.max(...places.map((place) => place.x)) - Math.min(...places.map((place) => place.x));
    assert.ok(spread > 100, `spread across the band (${spread})`);
    assert.deepEqual(labelCandidates(mesh, owners, 9), []);
});

test("P0JBVA realm borders: counts, coverage and no crossings", { skip: P0_SKIP }, () => {
    const { mesh, realms, aggregates } = loadP0();
    const arcs = checkLevel(mesh, realms, aggregates.land);
    const sea = arcs.filter((arc) => arc.cls === "sea").length;
    assert.ok(Math.abs(arcs.length - P0_ARCS.total) <= P0_ARCS.total * P0_ARCS.tolerance, `${arcs.length} arcs`);
    assert.ok(Math.abs(sea - P0_ARCS.sea) <= P0_ARCS.sea * P0_ARCS.tolerance, `${sea} sea arcs`);
    assert.equal(countCrossings(arcs), 0);
});
