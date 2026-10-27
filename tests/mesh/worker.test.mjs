// The single-job worker protocol (GenerationWorkers.runOne) with the buildMesh task, run in a Node
// worker thread through the investigation harness's browser-style Worker shim.
import "../support/web-worker-shim.mjs";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { GenerationWorkers } from "../../src/tools/GenerationWorkers.js";
import { buildMeshData } from "../../src/mesh/MeshBuilder.js";

const params = { width: 800, height: 600, spacing: 4, modelSpacing: 12, seed: 42 };
const CANCEL_PROMPTNESS_MS = 100;

after(() => GenerationWorkers.terminateJobs());

test("progress arrives in order and the result equals the main-thread build", async () => {
    const progress = [];
    const data = await GenerationWorkers.runOne("buildMesh", params, { onProgress: (report) => progress.push(report) });
    assert.ok(progress.length > 3);
    assert.deepEqual(
        progress.map((report) => report.pct),
        [...progress.map((report) => report.pct)].sort((a, b) => a - b),
        "percentages never go back",
    );
    assert.deepEqual(progress[0].stage, "sites");
    assert.equal(progress.at(-1).pct, 100);

    const local = await buildMeshData(params);
    assert.deepEqual(data.sites, local.sites);
    assert.deepEqual(data.cellRaster, local.cellRaster);
    assert.deepEqual(Array.from(data.triangles), Array.from(local.triangles));
});

test("cancelling rejects at once, and the worker carries on with the next job", async () => {
    const controller = new AbortController();
    let abortedAt = 0;
    const job = GenerationWorkers.runOne("buildMesh", { ...params, width: 2000, height: 1600 }, {
        signal: controller.signal,
        onProgress: ({ stage }) => {
            if (stage === "raster" && !abortedAt) {
                abortedAt = performance.now();
                controller.abort();
            }
        },
    });
    await assert.rejects(job, (error) => error.name === "AbortError");
    assert.ok(performance.now() - abortedAt < CANCEL_PROMPTNESS_MS, "rejected promptly");

    const next = await GenerationWorkers.runOne("buildMesh", params);
    assert.equal(next.cellRaster.length, params.width * params.height);
});

test("an already aborted signal never starts the job", async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(GenerationWorkers.runOne("buildMesh", params, { signal: controller.signal }), (error) => error.name === "AbortError");
});
