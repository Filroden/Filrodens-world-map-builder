// The Local studio's workers (LocalWorkers, LocalWorker, LocalTasks) run in Node worker threads
// through the browser-style Worker shim: versions built side by side and kept there, framed as the
// engine frames them; the kept version's households worked out in its worker and its town and
// households copied back once; a cancelled version ending its worker; the same answers on the main
// thread where workers cannot be used. Node has no OffscreenCanvas, so the workers here say they
// cannot draw, and the drawing falls back to the main thread from the kept copy (a recording
// context stands in for a canvas); drawing in a worker is checked in a browser.
import "../support/web-worker-shim.mjs";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { LocalWorkers } from "../../src/studios/local/LocalWorkers.js";
import { PRINTS, inputOf, townPrint } from "./helpers.mjs";

const NAME = "Grironcairn";
const input = inputOf(NAME);
const recorded = PRINTS.places[NAME];

/** A canvas that records its drawing, for the main thread's fallback. */
class RecordingCanvas {
    calls = 0;
    constructor(width, height) {
        this.width = width;
        this.height = height;
    }
    getContext() {
        const canvas = this;
        return new Proxy({}, {
            get: (target, key) => (key in target ? target[key] : key === "canvas" ? canvas : key === "measureText" ? () => ({ width: 10 }) : () => void canvas.calls++),
            set: (target, key, value) => ((target[key] = value), true),
        });
    }
}

const workers = new LocalWorkers({ size: 2 });
after(() => workers.close());

test("the count leaves a core free: one on two cores, three on four, never more than four", () => {
    assert.deepEqual([1, 2, 4, 6, 16].map((cores) => LocalWorkers.count(cores)), [1, 1, 3, 4, 4]);
});

test("versions build side by side, each framed as the engine frames it", async () => {
    const [main, other] = await Promise.all([workers.build("default", input), workers.build("alt-1", { ...input, seed: `${input.seed}:alt1` })]);
    assert.deepEqual(main.townView.rect.map((v) => +v.toFixed(3)), recorded.townView.rect);
    assert.deepEqual([main.frame.width, main.frame.height], recorded.frame);
    assert.equal(main.engineRevision, 2);
    assert.ok(other.stats.houses > 0 && other.townView.rect.join() !== main.townView.rect.join(), "another seed, another town");
    assert.ok(main.timings.buildMs > 0 && main.timings.framingMs >= 0);
});

test("the kept version comes back once, as recorded, with its households named", async () => {
    const kept = await workers.keep("default");
    assert.equal(townPrint(kept.town), recorded.town);
    assert.equal(kept.households.totals.people, input.population);
    const head = kept.households.houses[0].members[0];
    assert.ok(head.given && head.sex, "the head has a given name and a sex");
    assert.equal(typeof kept.town.shore?.wetAt, "undefined", "no functions cross");
});

test("a worker that cannot draw: the kept version is drawn here, a version not kept cannot be", async () => {
    globalThis.OffscreenCanvas = RecordingCanvas;
    try {
        const view = { rect: [-300, -225, 300, 225], mPerPx: 1, widthPx: 600, heightPx: 450 };
        const tile = await workers.tile("default", view);
        assert.ok(tile.calls > 100, `drew ${tile.calls} calls`);
        await assert.rejects(workers.tile("alt-1", view), /only be drawn here once it is kept/);
    } finally {
        delete globalThis.OffscreenCanvas;
    }
});

test("on one worker the versions come back in the order asked for, the Default first", async () => {
    const one = new LocalWorkers({ size: 1 });
    try {
        const order = [];
        await Promise.all(["d", "a"].map((id, k) => one.build(id, { ...input, seed: `${input.seed}:order${k}` }).then(() => order.push(id))));
        assert.deepEqual(order, ["d", "a"]);
    } finally {
        one.close();
    }
});

test("a version cancelled while building ends its worker if nothing else on it is wanted", async () => {
    await workers.release(["alt-1"]);
    const solo = new LocalWorkers({ size: 1 });
    try {
        const building = solo.build("alt-2", { ...input, seed: `${input.seed}:alt2` });
        await new Promise((resolve) => setTimeout(resolve, 200));
        solo.cancel("alt-2");
        await assert.rejects(building);
        const again = await solo.build("alt-3", { ...input, seed: `${input.seed}:alt3` });
        assert.ok(again.stats.houses > 0, "a new worker builds the next version");
    } finally {
        solo.close();
    }
});

test("without workers, the main thread gives the same answers", async () => {
    const alone = new LocalWorkers({ workers: false });
    try {
        const built = await alone.build("default", input);
        assert.deepEqual(built.townView.rect.map((v) => +v.toFixed(3)), recorded.townView.rect);
        const kept = await alone.keep("default");
        assert.equal(townPrint(kept.town), recorded.town);
        assert.equal(kept.households.totals.people, input.population);
    } finally {
        alone.close();
    }
});
