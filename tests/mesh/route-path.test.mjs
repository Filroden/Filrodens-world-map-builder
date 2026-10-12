// Route legs on the mesh: least-cost, direct and traced, and the drawn line.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
    cellsAlongPolyline,
    computeLegs,
    distanceCost,
    distanceField,
    distanceToPolyline,
    extractPath,
    legDirect,
    legTerrain,
    legTrace,
    pathCost,
    routeCells,
    routePolyline,
    terrainCost,
} from "../../src/mesh/RoutePath.js";
import { P0_SKIP, flatAggregates, isContiguous, loadP0, seededRandom, smallMesh } from "./helpers.mjs";

test("a terrain leg costs exactly the distance field's value at its target", () => {
    const mesh = smallMesh();
    // Hills: height varies across the map so the cheapest path is not the straight one
    const elevation = new Float32Array(mesh.width * mesh.height);
    for (let y = 0; y < mesh.height; y++) for (let x = 0; x < mesh.width; x++) elevation[y * mesh.width + x] = 0.4 + 0.05 * Math.sin(x / 30) * Math.cos(y / 25);
    const aggregates = mesh.aggregate({ elevation, seaLevel: 0.35 });
    const cost = terrainCost(mesh, aggregates);
    const random = seededRandom(5);
    for (let k = 0; k < 20; k++) {
        const from = Math.floor(random() * mesh.cellCount);
        const to = Math.floor(random() * mesh.cellCount);
        const field = distanceField(mesh, cost, from);
        const leg = legTerrain(mesh, cost, from, to);
        assert.equal(leg[0], from);
        assert.equal(leg.at(-1), to);
        assert.ok(isContiguous(mesh, leg));
        assert.ok(Math.abs(pathCost(leg, cost) - field.dist[to]) < 1e-9 * Math.max(1, field.dist[to]));
        assert.deepEqual(extractPath(field.prev, from, to), legTerrain(mesh, cost, from, to));
    }
});

test("a terrain leg goes round water when it is dearer than the detour", () => {
    const mesh = smallMesh();
    const aggregates = flatAggregates(mesh, { isWater: (x, y) => x > 180 && x < 220 && y < 220 });
    const leg = legTerrain(mesh, terrainCost(mesh, aggregates), mesh.cellAt(100, 100), mesh.cellAt(300, 100));
    assert.ok(leg.every((cell) => aggregates.land[cell]));
    const field = distanceField(mesh, distanceCost(mesh), mesh.cellAt(100, 100), { limit: 50 });
    assert.equal(field.dist[mesh.cellAt(300, 100)], Infinity, "the limit stops the search");
});

test("a direct leg is the cells the straight segment passes through", () => {
    const mesh = smallMesh();
    const random = seededRandom(9);
    let worst = 0;
    for (let k = 0; k < 50; k++) {
        const from = Math.floor(random() * mesh.cellCount);
        const to = Math.floor(random() * mesh.cellCount);
        const leg = legDirect(mesh, from, to);
        assert.equal(leg[0], from);
        assert.equal(leg.at(-1), to);
        assert.ok(isContiguous(mesh, leg));
        const segment = [mesh.siteX(from), mesh.siteY(from), mesh.siteX(to), mesh.siteY(to)];
        const crossed = new Set(cellsAlongPolyline(mesh, segment));
        const onLine = [...leg].filter((cell) => crossed.has(cell)).length;
        // The rest bridge the rare gap where the segment grazes a Voronoi vertex
        assert.ok(onLine / leg.length >= 0.95, `${onLine} of ${leg.length} cells are on the segment`);
        for (const cell of leg) assert.ok(crossed.has(cell) || mesh.neighbours(cell).some((next) => crossed.has(next)));
        // A site is never more than 2 spacings from any point of its cell (no gap is wider than 2r)
        for (const cell of leg) worst = Math.max(worst, distanceToPolyline(mesh.siteX(cell), mesh.siteY(cell), segment));
    }
    assert.ok(worst < 2 * mesh.spacing, `furthest site ${worst.toFixed(2)} px from the segment`);
});

test("a trace leg reproduces the cells of the line it follows", () => {
    const mesh = smallMesh();
    const line = [];
    for (let t = 0; t <= 100; t++) line.push(40 + t * 3, 150 + 60 * Math.sin(t / 12));
    const crossed = cellsAlongPolyline(mesh, line);
    const from = crossed[0];
    const to = crossed.at(-1);
    const leg = legTrace(mesh, line, from, to);
    assert.ok(isContiguous(mesh, leg));
    assert.equal(leg[0], from);
    assert.equal(leg.at(-1), to);
    const onLeg = new Set(leg);
    const covered = [...crossed].filter((cell) => onLeg.has(cell)).length / crossed.length;
    assert.ok(covered >= 0.9, `${(covered * 100).toFixed(0)}% of the crossed cells`);
    for (const cell of leg) assert.ok(distanceToPolyline(mesh.siteX(cell), mesh.siteY(cell), line) <= 1.5 * mesh.spacing);
});

test("a scribbled line that doubles back is not followed back and forth", () => {
    const mesh = smallMesh();
    const line = [50, 150, 200, 150, 150, 150, 300, 150];
    const leg = legTrace(mesh, line, mesh.cellAt(50, 150), mesh.cellAt(300, 150));
    assert.equal(new Set(leg).size, leg.length, "no cell is visited twice");
    assert.ok(leg.length < (250 / mesh.spacing) * 1.6);
});

test("legs are contiguous, run between their waypoints and share junction cells", () => {
    const mesh = smallMesh();
    const aggregates = flatAggregates(mesh);
    const cost = terrainCost(mesh, aggregates);
    const junction = mesh.cellAt(200, 150);
    const routes = [
        { mode: "terrain", waypoints: [mesh.cellAt(20, 20), junction, mesh.cellAt(380, 40)] },
        { mode: "direct", waypoints: [mesh.cellAt(30, 280), junction, mesh.cellAt(390, 290)] },
        { mode: "trace", waypoints: [mesh.cellAt(200, 10), junction] },
    ];
    for (const route of routes) {
        const legs = computeLegs(route, mesh, { cost });
        assert.equal(legs.length, route.waypoints.length - 1);
        legs.forEach((leg, k) => {
            assert.equal(leg[0], route.waypoints[k]);
            assert.equal(leg.at(-1), route.waypoints[k + 1]);
            assert.ok(isContiguous(mesh, leg));
        });
        const cells = routeCells(legs);
        assert.ok(cells.includes(junction));
        assert.ok(isContiguous(mesh, cells));
        const line = routePolyline(mesh, legs, true);
        assert.deepEqual([line[0], line[1]], [mesh.siteX(route.waypoints[0]), mesh.siteY(route.waypoints[0])], "smoothing keeps the route's ends");
    }
});

test("P0JBVA: a cross-continent terrain leg avoids the sea", { skip: P0_SKIP }, () => {
    const { mesh, aggregates } = loadP0();
    const cost = terrainCost(mesh, aggregates);
    const [from, to] = [mesh.cellAt(300, 300), mesh.cellAt(900, 1300)];
    assert.ok(aggregates.land[from] && aggregates.land[to]);
    const leg = legTerrain(mesh, cost, from, to);
    assert.ok(isContiguous(mesh, leg));
    const water = leg.filter((cell) => !aggregates.land[cell]).length;
    assert.ok(water / leg.length < 0.05, `${water} water cells of ${leg.length}`);
});
