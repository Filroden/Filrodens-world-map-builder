/* global process */
// Timings on P0JBVA (2000 x 1600 at 4 px, about 120k cells) against the phase 1 budgets. Each
// figure is the best of a few runs, so a busy machine does not fail the test on one slow run.
// Run with: node --test --test-reporter=spec tests/mesh/performance.test.mjs
// The budgets describe a developer's machine, not a shared CI runner, so the test is skipped
// where CI is set (GitHub Actions sets it) unless FWMB_PERF is set too.
import assert from "node:assert/strict";
import { test } from "node:test";
import { arcsForLevel } from "../../src/mesh/BorderArcs.js";
import { generateSites, Mesh, MeshBuilder } from "../../src/mesh/MeshBuilder.js";
import { Delaunay } from "../../vendor/d3-delaunay/d3-delaunay.js";
import { decodeOwners, encodeOwners } from "../../src/mesh/OwnerLayer.js";
import { distanceField, terrainCost } from "../../src/mesh/RoutePath.js";
import { P0_SKIP, loadP0 } from "./helpers.mjs";

const CI_SKIP = process.env.CI && !process.env.FWMB_PERF ? "performance budgets are not checked on CI runners (set FWMB_PERF to run)" : false;
const BUDGET_MS = { sitesAndDelaunay: 1000, raster: 2000, arcs: 50, rleEncode: 20, rleDecode: 20, distanceField: 100 };
const RUNS = 3;

function best(work) {
    let fastest = Infinity;
    for (let run = 0; run < RUNS; run++) {
        const start = performance.now();
        work();
        fastest = Math.min(fastest, performance.now() - start);
    }
    return fastest;
}

/** The cell raster is built once per mesh, so each timing needs a mesh that has not built it. */
function timeRaster(freshMesh) {
    const start = performance.now();
    assert.equal(freshMesh.cellRaster.length, freshMesh.width * freshMesh.height);
    return performance.now() - start;
}

test("P0JBVA timings are within budget", { skip: P0_SKIP || CI_SKIP }, (t) => {
    const { mapData, mesh, realms, aggregates } = loadP0();
    const params = MeshBuilder.paramsFor(mapData);
    const timings = {
        sitesAndDelaunay: best(() => new Delaunay(generateSites(params).sites)),
        fullMeshBuild: best(() => new Mesh(params)),
        raster: Math.min(...[0, 1].map(() => timeRaster(new Mesh(params)))),
        arcs: best(() => arcsForLevel(mesh, realms, aggregates.land)),
        rleEncode: best(() => encodeOwners(realms)),
    };
    const text = encodeOwners(realms);
    timings.rleDecode = best(() => decodeOwners(text));
    const cost = terrainCost(mesh, aggregates);
    timings.distanceField = best(() => distanceField(mesh, cost, mesh.cellAt(1000, 800)));
    timings.cells = mesh.cellCount;
    timings.encodedBytes = text.length;
    t.diagnostic(JSON.stringify(Object.fromEntries(Object.entries(timings).map(([key, value]) => [key, Math.round(value * 10) / 10]))));
    for (const [key, budget] of Object.entries(BUDGET_MS)) assert.ok(timings[key] < budget, `${key} took ${timings[key].toFixed(1)} ms (budget ${budget} ms)`);
});
