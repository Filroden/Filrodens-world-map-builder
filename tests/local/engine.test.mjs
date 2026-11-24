// The Local studio's engine and renderer are pure (T7 and V3, promoted): the engine imports only
// itself, the kernel's seeded stream and priority queue and the vendored d3-delaunay, the renderer
// only itself, and neither touches Node, Foundry or the DOM. The engine's stream is the kernel's
// (the prototype's gave the same numbers). And a great city builds in a worker with a browser
// worker's stack, which the prototype's code could not (claude/v5-l-surface-step1-plan.md §8 item 3).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { stageRandom as kernelStageRandom } from "../../src/kernel/random/Random.js";
import { stageRandom } from "../../src/studios/local/engine/Geometry.js";
import { hinterlandView } from "../../src/studios/local/engine/Framing.js";
import { buildTown } from "../../src/studios/local/engine/Town.js";
import { PRINTS, inputOf } from "./helpers.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..");
const local = join(repo, "src", "studios", "local");

function files(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith(".js") ? [join(dir, e.name)] : []));
}

/** A file's code without its comments. */
const codeOf = (file) =>
    readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");

/** The repository paths a file imports. */
function importsOf(file) {
    const found = [];
    for (const m of codeOf(file).matchAll(/(?:import|export)\s[^;]*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)) {
        const spec = m[1] ?? m[2];
        found.push(spec.startsWith(".") ? relative(repo, resolve(dirname(file), spec)).split("\\").join("/") : spec);
    }
    return found;
}

const PLATFORM = ["process", "require(", "Buffer", "document", "window", "game.", "foundry.", "canvas.", "ui.notifications", "fetch(", "localStorage", "Deno"];

function touchesNoPlatform(file) {
    const code = codeOf(file);
    for (const name of PLATFORM) {
        const pattern = new RegExp(`(^|[^\\w.])${name.replace(/[.()]/g, "\\$&")}`, "m");
        assert.ok(!pattern.test(code), `${relative(repo, file)}: uses ${name}`);
    }
}

test("the engine imports only itself, the kernel's stream and priority queue and d3-delaunay, and touches no platform", () => {
    const allowed = new Set(["src/kernel/random/Random.js", "src/kernel/util/MinHeap.js", "vendor/d3-delaunay/d3-delaunay.js"]);
    for (const file of files(join(local, "engine"))) {
        for (const target of importsOf(file)) assert.ok(target.startsWith("src/studios/local/engine/") || allowed.has(target), `${relative(repo, file)}: imports ${target}`);
        touchesNoPlatform(file);
    }
});

test("the renderer imports only itself and touches no platform", () => {
    for (const file of files(join(local, "render"))) {
        for (const target of importsOf(file)) assert.ok(target.startsWith("src/studios/local/render/"), `${relative(repo, file)}: imports ${target}`);
        touchesNoPlatform(file);
    }
});

test("the engine's streams are the kernel's numbers, with the prototype's range, pick and chance", () => {
    for (const [seed, stage] of [["P0JBVA:fx00000000004289", "terrain"], ["P0JBVA:fx00000000005547:alt1", "people:heads"], ["Ølstad", "fields"]]) {
        const ours = stageRandom(seed, stage);
        const kernel = kernelStageRandom(seed, stage);
        for (let k = 0; k < 200; k++) assert.equal(ours.next(), kernel());
        const again = stageRandom(seed, stage);
        const twin = kernelStageRandom(seed, stage);
        assert.equal(again.range(2, 5), 2 + 3 * twin());
        assert.equal(again.pick(["a", "b", "c"]), ["a", "b", "c"][Math.floor(twin() * 3)]);
        assert.equal(again.chance(0.5), twin() < 0.5);
    }
});

test("the hinterland view is the whole frame", () => {
    const town = buildTown(inputOf("Lostshearmi"));
    const view = hinterlandView(town);
    assert.deepEqual(view.rect, [-town.frame.width / 2, -town.frame.height / 2, town.frame.width / 2, town.frame.height / 2]);
    assert.equal(view.widthPx, Math.round(town.frame.width / 1.25));
});

test("a great city builds in a worker with a browser worker's stack, as on the main thread", async () => {
    // Quickward (249,025 people, 43,365 buildings): the prototype's code ran out of stack here, at
    // half a megabyte, spreading every building into one call; the port loops instead
    const { stack } = PRINTS;
    const source = `
        import { parentPort, workerData } from "node:worker_threads";
        const { buildTown } = await import(workerData.town);
        const { townPrint, inputOf } = await import(workerData.helpers);
        try { parentPort.postMessage({ print: townPrint(buildTown(inputOf(workerData.name))) }); }
        catch (error) { parentPort.postMessage({ error: String(error) }); }`;
    const result = await new Promise((done, fail) => {
        const worker = new Worker(source, {
            eval: true,
            type: "module",
            workerData: { name: stack.name, town: new URL("../../src/studios/local/engine/Town.js", import.meta.url).href, helpers: new URL("./helpers.mjs", import.meta.url).href },
            resourceLimits: { stackSizeMb: 0.5 },
        });
        worker.once("message", (message) => {
            worker.terminate();
            done(message);
        });
        worker.once("error", fail);
    });
    assert.equal(result.error, undefined, result.error);
    assert.equal(result.print, stack.town, `${stack.name}: the worker's town differs`);
});
