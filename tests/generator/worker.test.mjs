// The generator in the background worker (the `generate` task through GenerationWorkers.runOne),
// run in a Node worker thread through the browser-style Worker shim: the same result as on the
// main thread, progress, cancelling, and the input's buffers moved rather than copied.
import "../support/web-worker-shim.mjs";
import "../mesh/foundry-stubs.mjs";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { GenerationWorkers } from "../../src/tools/GenerationWorkers.js";
import { generateInBackground } from "../../src/generator/Generate.js";
import { runGenerator } from "../../src/generator/Pipeline.js";
import { syntheticMap } from "./synthetic.mjs";

const CANCEL_PROMPTNESS_MS = 100;

after(() => GenerationWorkers.terminateJobs());

test("the worker gives exactly the main thread's result, reporting progress in order", async () => {
    const progress = [];
    let sent = null;
    const result = await generateInBackground(() => (sent = syntheticMap().makePayload()), { onProgress: (report) => progress.push(report) });
    const local = await runGenerator(syntheticMap().makePayload(), { pause: () => Promise.resolve() });
    const { timings: _workerTimings, ...worker } = result;
    const { timings: _localTimings, ...main } = local;
    assert.deepEqual(worker, main);
    assert.ok(progress.length > 3);
    const pcts = progress.map((report) => report.pct);
    assert.deepEqual(pcts, [...pcts].sort((a, b) => a - b));
    assert.equal(pcts.at(-1), 100);
    assert.equal(sent.elevation.byteLength, 0, "the input's buffers were moved to the worker, not copied");
});

test("cancelling rejects at once, and the worker carries on with the next run", async () => {
    const controller = new AbortController();
    let abortedAt = 0;
    const run = generateInBackground(() => syntheticMap().makePayload(), {
        signal: controller.signal,
        onProgress: ({ stage }) => {
            if (stage === "towns" && !abortedAt) {
                abortedAt = performance.now();
                controller.abort();
            }
        },
    });
    await assert.rejects(run, (error) => error.name === "AbortError");
    assert.ok(performance.now() - abortedAt < CANCEL_PROMPTNESS_MS, "rejected promptly");
    const next = await generateInBackground(() => syntheticMap().makePayload());
    assert.ok(next.realms.length >= 1);
});

test("an already aborted signal never starts the run", async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(generateInBackground(() => syntheticMap().makePayload(), { signal: controller.signal }), (error) => error.name === "AbortError");
});

test("asked to stop, the worker ends once an age has finished, with the ages finished; progress names the age", async () => {
    const reports = [];
    const full = await generateInBackground(() => syntheticMap().makePayload({ ages: [{}, {}] }), { onProgress: (report) => reports.push(report) });
    assert.deepEqual(full.ages, { asked: 2, run: 2 });
    assert.ok(reports.some((report) => report.ages === 2 && report.age === 2));
    // Asked from the start: the first age always runs, then the run ends
    const stop = new AbortController();
    stop.abort();
    const result = await generateInBackground(() => syntheticMap().makePayload({ ages: [{}, {}, {}] }), { stopSignal: stop.signal });
    assert.deepEqual(result.ages, { asked: 3, run: 1 });
    assert.equal(result.history.length, 0);
    // Asked part-way through the second age: the worker reads it while it runs, lets that age go
    const later = new AbortController();
    const partway = await generateInBackground(() => syntheticMap().makePayload({ ages: [{}, {}, {}, {}, {}, {}] }), {
        stopSignal: later.signal,
        onProgress: ({ age }) => age === 2 && later.abort(),
    });
    assert.ok(partway.ages.run < 6, `stopped early (${partway.ages.run} of 6 ages)`);
    assert.equal(partway.history.length, partway.ages.run - 1);
});
