// The studio's colour theme (src/ui/Theme.js): two of the reader's own settings, written as
// attributes on the elements the host registers, kept up to date when they change.
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { Window } from "happy-dom";

const window = new Window({ url: "http://localhost/" });
for (const name of Object.getOwnPropertyNames(window)) {
    if (/^[A-Z]/.test(name) && !(name in globalThis)) globalThis[name] = window[name];
}
Object.assign(globalThis, { window, document: window.document });
after(() => window.happyDOM.close());

const { installPlatform } = await import("../../src/platform/index.js");
const { createWebSettings } = await import("../../src/platform/web/settings.js");
const { applyTheme, attachTheme, currentTheme, registerThemeSettings, setTheme, THEME_SETTINGS } = await import("../../src/ui/Theme.js");

let storage;
const detachers = [];

function fakeStorage(initial = {}) {
    const values = new Map(Object.entries(initial));
    return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), values };
}

function useSettings(initial) {
    storage = fakeStorage(initial);
    installPlatform({ settings: createWebSettings(storage) });
    registerThemeSettings();
}

beforeEach(() => {
    while (detachers.length) detachers.pop()();
    useSettings();
});

const attach = (element) => detachers.push(attachTheme(element));

test("by default the host decides light or dark, and the hue is gold", () => {
    const frame = document.createElement("div");
    attach(frame);
    assert.deepEqual(currentTheme(), { mode: "auto", hue: "gold" });
    assert.equal(frame.hasAttribute("data-fwmb-theme"), false);
    assert.equal(frame.getAttribute("data-fwmb-hue"), "gold");
});

test("a choice is written on every registered element and kept in the settings", async () => {
    const frame = document.createElement("div");
    attach(frame);
    attach(document.body);
    assert.equal(await setTheme(THEME_SETTINGS.MODE, "dark"), true);
    assert.equal(await setTheme(THEME_SETTINGS.HUE, "teal"), true);
    for (const element of [frame, document.body]) {
        assert.equal(element.getAttribute("data-fwmb-theme"), "dark");
        assert.equal(element.getAttribute("data-fwmb-hue"), "teal");
    }
    assert.equal(storage.values.get("fwmb.themeMode"), '"dark"');

    await setTheme(THEME_SETTINGS.MODE, "auto");
    assert.equal(frame.hasAttribute("data-fwmb-theme"), false, "automatic hands light or dark back to the host");
});

test("values that are not choices are ignored, and a stored one falls back to the default", async () => {
    assert.equal(await setTheme(THEME_SETTINGS.HUE, "purple"), false);
    assert.equal(await setTheme("other", "dark"), false);
    useSettings({ "fwmb.themeHue": '"purple"' });
    assert.equal(currentTheme().hue, "gold");
});

test("a hue chosen before (the same setting key) carries over", () => {
    useSettings({ "fwmb.themeHue": '"teal"' });
    const frame = document.createElement("div");
    attach(frame);
    assert.equal(frame.getAttribute("data-fwmb-hue"), "teal");
});

test("a change made through the settings themselves (their onChange) is applied", async () => {
    const frame = document.createElement("div");
    attach(frame);
    const { platform } = await import("../../src/platform/index.js");
    await platform.settings.set(THEME_SETTINGS.MODE, "light");
    assert.equal(frame.getAttribute("data-fwmb-theme"), "light");
});

test("detaching an element stops the theme being written on it and removes it", async () => {
    const frame = document.createElement("div");
    const detach = attachTheme(frame);
    await setTheme(THEME_SETTINGS.MODE, "dark");
    detach();
    assert.equal(frame.hasAttribute("data-fwmb-theme"), false);
    await setTheme(THEME_SETTINGS.MODE, "light");
    applyTheme();
    assert.equal(frame.hasAttribute("data-fwmb-theme"), false);
});
