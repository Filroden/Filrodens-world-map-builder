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
    assert.equal(result.stdout.trim(), "i18n,notify,utils,templates,fonts,dialogs,settings,store,assets,module,grid,scene");
});

const { platform } = await import("../../src/platform/index.js");

test("dialogues are the shared overlay service and need an element to be drawn in", async () => {
    assert.equal(typeof platform.dialogs.attach, "function");
    // With nothing attached there is nowhere to draw: the call fails rather than hanging
    await assert.rejects(platform.dialogs.confirm({ title: "Delete?", content: "<p>Sure?</p>" }), /none is attached/);
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

test("fonts fall back to a fixed list when Foundry's is not set", () => {
    globalThis.CONFIG = {};
    assert.deepEqual(platform.fonts.list(), ["Signika", "Modesto Condensed", "Arial"]);
    globalThis.CONFIG = { fontFamilies: ["Roboto"] };
    assert.deepEqual(platform.fonts.list(), ["Roboto"]);
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
