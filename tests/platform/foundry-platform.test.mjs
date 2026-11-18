// The Foundry implementation of the platform services: each one passes calls on to the Foundry API
// in the shape the module used before the services existed, so moving a call site onto a service
// changes nothing in Foundry. Foundry's classes are replaced by recorders here. The dialogues are
// shared by every host and tested with the studio's UI (tests/ui/dialogs.test.mjs).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

test("loading the platform touches no Foundry global", () => {
    // A fresh process with no Foundry globals at all, as on the web
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", 'const { platform } = await import("./src/platform/index.js"); console.log(Object.keys(platform).join(","));'], { cwd: ROOT, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "i18n,notify,utils,templates,fonts,dialogs,settings,store,assets,module,grid,scene,frame");
});

const { platform } = await import("../../src/platform/index.js");

test("dialogues are the shared overlay service and need an element to be drawn in", async () => {
    assert.equal(typeof platform.dialogs.attach, "function");
    // With nothing attached there is nowhere to draw: the call fails rather than hanging
    await assert.rejects(platform.dialogs.confirm({ title: "Delete?", content: "<p>Sure?</p>" }), /none is attached/);
});

test("the title goes to the attached window, whole ids and all, and nowhere once it detaches", () => {
    const titles = [];
    const window = { setTitle: (text) => titles.push(text) };
    assert.equal(platform.frame.idLength, undefined, "ids are shown whole");
    const detach = platform.frame.attach(window);
    platform.frame.setTitle("Map: Harbour");
    detach();
    platform.frame.setTitle("Map");
    assert.deepEqual(titles, ["Map: Harbour"]);
});

test("settings are namespaced to the module", () => {
    const calls = [];
    globalThis.game = { settings: { register: (...args) => calls.push(["register", ...args]), get: (...args) => calls.push(["get", ...args]), set: (...args) => calls.push(["set", ...args]) } };
    platform.settings.register("customPinIcons", { scope: "world" });
    platform.settings.get("customPinIcons");
    platform.settings.set("customPinIcons", []);
    assert.deepEqual(calls.map((call) => call.slice(0, 3)), [
        ["register", "filrodens-world-map-builder", "customPinIcons"],
        ["get", "filrodens-world-map-builder", "customPinIcons"],
        ["set", "filrodens-world-map-builder", "customPinIcons"],
    ]);
});

test("asset URLs route relative paths through Foundry and leave absolute ones alone", () => {
    globalThis.foundry = { ...globalThis.foundry, utils: { getRoute: (path) => `/prefix/${path}` } };
    assert.equal(platform.assets.url("icons/a.svg"), "/prefix/icons/a.svg");
    assert.equal(platform.assets.url("https://cdn.example/a.svg"), "https://cdn.example/a.svg");
    assert.equal(platform.assets.url("data:image/svg+xml;base64,AAAA"), "data:image/svg+xml;base64,AAAA");
    assert.equal(platform.assets.url(""), "");
});

test("grids are Foundry's own, odd-offset for hexes", () => {
    class SquareGrid {
        constructor(options) {
            this.options = options;
        }
    }
    class HexagonalGrid extends SquareGrid {}
    globalThis.foundry = { ...globalThis.foundry, grid: { SquareGrid, HexagonalGrid } };
    assert.deepEqual(platform.grid.create({ type: "square", size: 50 }).options, { size: 50 });
    assert.deepEqual(platform.grid.create({ type: "hexC", size: 60 }).options, { size: 60, columns: true, even: false });
    assert.deepEqual(platform.grid.create({ type: "hexR", size: 60 }).options, { size: 60, columns: false, even: false });
});

test("the language falls back to English before Foundry's localisation is ready", () => {
    globalThis.game = {};
    assert.equal(platform.i18n.lang, "en");
    globalThis.game = { i18n: { lang: "ar" } };
    assert.equal(platform.i18n.lang, "ar");
});

test("the label fonts are the vendored ones, then the world's own that are not among them", async () => {
    const { labelFontNames } = await import("../../src/kernel/data/fonts.js");
    const vendored = labelFontNames();
    globalThis.CONFIG = {};
    assert.deepEqual(platform.fonts.list(), vendored);
    globalThis.CONFIG = { fontFamilies: ["Roboto", "Noto Serif", "Signika", "Roboto"] };
    assert.deepEqual(platform.fonts.list(), [...vendored, "Roboto", "Signika"]);
});

test("installPlatform replaces the services callers read", async () => {
    const { installPlatform } = await import("../../src/platform/index.js");
    const original = platform.notify;
    const messages = [];
    installPlatform({ notify: { info: (text) => messages.push(text) } });
    platform.notify.info("hello");
    installPlatform({ notify: original });
    assert.deepEqual(messages, ["hello"]);
});

test("a save marks every key the flag no longer holds for deletion, nested ones too", async () => {
    const { withStaleKeysDeleted } = await import("../../src/platform/foundry/store.js");
    const DELETE = { deleted: true };
    const stored = { seed: "s", cultures: [1], params: { globalTemp: 0.5, noise: { scale: 1, octaves: 3 }, seaLevel: 0.3 }, generatorSettings: { ages: [{}], output: { labels: true } }, list: [{ a: 1, b: 2 }] };
    const next = { params: { noise: { octaves: 4 }, seaLevel: 0.4 }, generatorSettings: { output: { labels: false } }, list: [{ a: 1 }], added: 1 };
    assert.deepEqual(withStaleKeysDeleted(stored, next, () => DELETE), {
        seed: DELETE,
        cultures: DELETE,
        params: { globalTemp: DELETE, noise: { scale: DELETE, octaves: 4 }, seaLevel: 0.4 },
        generatorSettings: { ages: DELETE, output: { labels: false } },
        // Arrays are written as they are, never compared item by item
        list: [{ a: 1 }],
        added: 1,
    });
    assert.deepEqual(next.params, { noise: { octaves: 4 }, seaLevel: 0.4 }, "what is to be saved is not changed");
});


test("a map's blobs are base64 in a flag on its journal, kept and dropped by hash", async () => {
    const store = await import("../../src/platform/foundry/store.js");
    const { FILRODENSWMB } = await import("../../src/config.js");
    const id = FILRODENSWMB.ID;
    class ForcedDeletion {}
    const doc = { flags: { [id]: { mapData: {} } }, updates: [] };
    doc.update = async (changes) => {
        doc.updates.push(changes);
        for (const [path, value] of Object.entries(changes)) {
            const keys = path.split(".").slice(1);
            let node = doc;
            for (const key of ["flags", ...keys.slice(0, -1)]) node = node[key] ??= {};
            if (value instanceof ForcedDeletion) delete node[keys.at(-1)];
            else node[keys.at(-1)] = value;
        }
    };
    const pack = { getDocument: async (wanted) => (wanted === "m1" ? doc : null) };
    globalThis.foundry = { data: { operators: { ForcedDeletion } } };
    globalThis.game = { packs: { get: () => pack } };
    try {
        const a = "a".repeat(32);
        const b = "b".repeat(32);
        assert.equal(await store.saveMapBlob("m1", a, new Uint8Array([1, 2, 255])), true);
        await store.saveMapBlob("m1", b, new Uint8Array([7]));
        assert.deepEqual(Object.keys(doc.updates[0]), [`flags.${id}.blobs.${a}`]);
        assert.equal(typeof doc.flags[id].blobs[a], "string");
        assert.deepEqual(await store.loadMapBlob("m1", a), new Uint8Array([1, 2, 255]));
        assert.equal(await store.loadMapBlob("m1", "c".repeat(32)), null);
        assert.deepEqual((await store.listMapBlobs("m1")).sort(), [a, b]);
        await store.keepMapBlobs("m1", [a]);
        assert.deepEqual(await store.listMapBlobs("m1"), [a]);
        const count = doc.updates.length;
        await store.keepMapBlobs("m1", [a]);
        assert.equal(doc.updates.length, count, "nothing to drop writes nothing");
        assert.equal(await store.saveMapBlob("missing", a, new Uint8Array([1])), false);
    } finally {
        delete globalThis.foundry;
        delete globalThis.game;
    }
});
