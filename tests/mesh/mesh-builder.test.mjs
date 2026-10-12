// Sites, triangulation, neighbours, cell raster, model hierarchy and per-cell aggregates.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { generateSites, hashSites, Mesh, MeshBuilder } from "../../src/mesh/MeshBuilder.js";
import { createMeshBlock, resolveSpacing } from "../../src/mesh/Schema.js";
import { FIXTURES, P0_SKIP, flatAggregates, loadP0, readJson, seededRandom, smallMesh } from "./helpers.mjs";

const expected = readJson(join(FIXTURES, "expected-sites.json"));

test("sites are bit-for-bit the stored fixture (determinism)", () => {
    for (const { params, cells, modelCount, hash } of expected.cases) {
        const { sites, modelCount: models } = generateSites(params);
        assert.equal(sites.length / 2, cells, `cell count for ${JSON.stringify(params)}`);
        assert.equal(models, modelCount);
        assert.equal(hashSites(sites), hash);
    }
});

test("sampler source uses no engine-dependent maths", () => {
    const source = readFileSync(fileURLToPath(new URL("../../src/mesh/MeshBuilder.js", import.meta.url)), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
    const forbidden = source.match(/Math\.(sin|cos|tan|asin|acos|atan2?|exp|expm1|log\w*|pow|cbrt|hypot|random)\b/g);
    assert.equal(forbidden, null, `found ${forbidden}`);
});

test("sites keep the minimum spacing and leave no gap wider than 2r", () => {
    const mesh = smallMesh();
    // The nearest neighbour of every site is a Delaunay neighbour, so the shortest Delaunay edge
    // is the closest pair of sites overall.
    let shortest = Infinity;
    for (let cell = 0; cell < mesh.cellCount; cell++) for (const next of mesh.neighbours(cell)) shortest = Math.min(shortest, mesh.distance(cell, next));
    assert.ok(shortest >= mesh.spacing - 1e-9, `closest pair ${shortest}`);

    // The largest empty circle inside the map is centred on a Voronoi vertex (a circumcentre)
    const { circumcenters } = mesh.voronoi;
    let widest = 0;
    for (let v = 0; v < circumcenters.length / 2; v++) {
        const [x, y] = [circumcenters[2 * v], circumcenters[2 * v + 1]];
        if (x < 0 || y < 0 || x > mesh.width || y > mesh.height) continue;
        const nearest = mesh.cellAt(x, y);
        widest = Math.max(widest, Math.hypot(mesh.siteX(nearest) - x, mesh.siteY(nearest) - y));
    }
    assert.ok(widest < 2 * mesh.spacing, `widest empty circle radius ${widest}`);
});

test("model sites are the first sites, spaced at the model spacing", () => {
    const mesh = smallMesh();
    assert.ok(mesh.modelCount > 0 && mesh.modelCount < mesh.cellCount);
    for (let m = 0; m < mesh.modelCount; m++) {
        assert.equal(mesh.modelDelaunay.points[2 * m], mesh.siteX(m));
        for (const next of mesh.modelDelaunay.neighbors(m)) assert.ok(mesh.distance(m, next) >= mesh.modelSpacing - 1e-9);
    }
});

test("parentOf is the nearest model site and childrenOf inverts it", () => {
    const mesh = smallMesh();
    for (let cell = 0; cell < mesh.cellCount; cell++) {
        let best = Infinity;
        for (let m = 0; m < mesh.modelCount; m++) best = Math.min(best, mesh.distance(cell, m));
        assert.ok(Math.abs(mesh.distance(cell, mesh.parentOf[cell]) - best) < 1e-9, `cell ${cell}`);
    }
    let total = 0;
    for (let m = 0; m < mesh.modelCount; m++) {
        const children = mesh.childrenOf(m);
        total += children.length;
        assert.ok(children.includes(m), "a model cell contains its own site's display cell");
        for (const child of children) assert.equal(mesh.parentOf[child], m);
    }
    assert.equal(total, mesh.cellCount);
});

test("neighbours are the cells sharing a Voronoi edge inside the map, symmetrically", () => {
    const mesh = smallMesh();
    // d3's Voronoi.neighbors compares the clipped cell polygons edge by edge: slow, but exact
    for (let cell = 0; cell < mesh.cellCount; cell++) {
        const ours = [...mesh.neighbours(cell)].sort((a, b) => a - b);
        const theirs = [...mesh.voronoi.neighbors(cell)].sort((a, b) => a - b);
        assert.deepEqual(ours, theirs);
        for (const next of ours) assert.ok(mesh.neighbours(next).includes(cell));
    }
});

test("every pixel's cell is its nearest site (10,000 random pixels)", () => {
    const mesh = smallMesh();
    const raster = mesh.cellRaster;
    const random = seededRandom(7);
    for (let k = 0; k < 10000; k++) {
        const x = Math.floor(random() * mesh.width);
        const y = Math.floor(random() * mesh.height);
        const [px, py] = [x + 0.5, y + 0.5];
        let best = Infinity;
        for (let cell = 0; cell < mesh.cellCount; cell++) best = Math.min(best, (mesh.siteX(cell) - px) ** 2 + (mesh.siteY(cell) - py) ** 2);
        const found = raster[y * mesh.width + x];
        assert.ok(Math.abs((mesh.siteX(found) - px) ** 2 + (mesh.siteY(found) - py) ** 2 - best) < 1e-9, `pixel ${x},${y}`);
    }
});

test("every pixel's cell is its nearest site on P0JBVA (10,000 random pixels)", { skip: P0_SKIP }, () => {
    const { mesh } = loadP0();
    const raster = mesh.cellRaster;
    const random = seededRandom(11);
    for (let k = 0; k < 10000; k++) {
        const x = Math.floor(random() * mesh.width);
        const y = Math.floor(random() * mesh.height);
        const found = raster[y * mesh.width + x];
        const d = Math.hypot(mesh.siteX(found) - x - 0.5, mesh.siteY(found) - y - 0.5);
        // Brute force over the cells near the pixel (every site within d of it is in that window)
        for (let cell = 0; cell < mesh.cellCount; cell++) {
            const dx = mesh.siteX(cell) - x - 0.5;
            if (dx > d || dx < -d) continue;
            assert.ok(Math.hypot(dx, mesh.siteY(cell) - y - 0.5) >= d - 1e-9, `pixel ${x},${y}`);
        }
    }
});

test("packed cell raster bytes rebuild the ids", () => {
    const raster = Int32Array.of(0, 1, 255, 256, 65535, 65536, 123456);
    const bytes = MeshBuilder.packCellRaster(raster);
    for (let i = 0; i < raster.length; i++) assert.equal(bytes[4 * i] + bytes[4 * i + 1] * 256 + bytes[4 * i + 2] * 65536 + bytes[4 * i + 3] * 16777216, raster[i]);
});

test("aggregates classify land, water and rivers per cell", () => {
    const mesh = smallMesh();
    const left = (x) => x < 200;
    const aggregates = flatAggregates(mesh, { isWater: (x) => !left(x) });
    let pixels = 0;
    for (let cell = 0; cell < mesh.cellCount; cell++) {
        pixels += aggregates.count[cell];
        assert.ok(aggregates.count[cell] > 0);
        if (mesh.siteX(cell) < 195) assert.equal(aggregates.land[cell], 1);
        if (mesh.siteX(cell) > 205) assert.equal(aggregates.land[cell], 0);
    }
    assert.equal(pixels, mesh.width * mesh.height);

    const riverMap = new Uint8Array(mesh.width * mesh.height);
    for (let x = 0; x < mesh.width; x++) riverMap[150 * mesh.width + x] = 1;
    const withRiver = mesh.aggregate({ elevation: new Float32Array(mesh.width * mesh.height).fill(0.5), seaLevel: 0.35, riverMap });
    assert.ok(withRiver.riverCount[mesh.cellAt(100, 150.5)] > 0);
    assert.equal(withRiver.riverCount[mesh.cellAt(100, 50)], 0);
});

test("spacing widens above the cell cap and the mesh block records it", () => {
    assert.equal(resolveSpacing(2000, 1600), 4);
    const wide = resolveSpacing(8000, 8000);
    assert.ok(wide > 4 && (0.6 * 8000 * 8000) / (wide * wide) <= 500000);
    const block = createMeshBlock({ mapWidth: 8000, mapHeight: 8000, seed: "X" });
    assert.equal(block.spacing, wide);
    assert.equal(createMeshBlock({ mapWidth: 10, mapHeight: 10, seed: "X" }).seed, createMeshBlock({ mapWidth: 10, mapHeight: 10, seed: "X" }).seed);
});

test("a mesh rebuilt from the same block is identical", () => {
    const params = { width: 300, height: 200, spacing: 5, modelSpacing: 15, seed: 99 };
    const a = new Mesh(params);
    const b = new Mesh(params);
    assert.deepEqual(a.sites, b.sites);
    assert.deepEqual(a.parentOf, b.parentOf);
});
