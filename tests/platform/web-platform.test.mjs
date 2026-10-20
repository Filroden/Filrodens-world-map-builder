// The web host's platform services (src/platform/web): each behaves as the Foundry service it
// stands in for does, where the shared code depends on it. The DOM parts run in happy-dom; the
// whole site is checked in a browser by the web smoke check.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import Handlebars from "handlebars";
import { Window } from "happy-dom";

const window = new Window({ url: "http://localhost/site/" });
for (const name of Object.getOwnPropertyNames(window)) {
    if (/^[A-Z]/.test(name) && !(name in globalThis)) globalThis[name] = window[name];
}
Object.assign(globalThis, { window, document: window.document, customElements: window.customElements });
after(() => window.happyDOM.close());

const utils = await import("../../src/platform/web/utils.js");
const { chooseLanguage, createI18n, flattenStrings } = await import("../../src/platform/web/i18n.js");
const { createWebSettings } = await import("../../src/platform/web/settings.js");
const { createWebStore, MemoryRecords } = await import("../../src/platform/web/store.js");
const { createWebTemplates, registerHelpers } = await import("../../src/platform/web/templates.js");
const { createWebAssets } = await import("../../src/platform/web/assets.js");
const { FilePickerElement } = await import("../../src/platform/web/FilePickerElement.js");
const { createWebPlatform } = await import("../../src/platform/web/index.js");

// --- utils

test("random ids are 16 letters and digits", () => {
    const ids = new Set(Array.from({ length: 50 }, utils.randomID));
    assert.equal(ids.size, 50);
    for (const id of ids) assert.match(id, /^[A-Za-z0-9]{16}$/);
});

test("deepClone copies plain data and shares everything else, as Foundry's does", () => {
    const raster = new Float32Array(4);
    const original = { a: [1, { b: 2 }], raster, when: new Date(0) };
    const copy = utils.deepClone(original);
    assert.deepEqual(copy.a, original.a);
    assert.notEqual(copy.a[1], original.a[1]);
    assert.equal(copy.raster, raster);
    assert.notEqual(copy.when, original.when);
});

test("mergeObject merges objects deeply, replaces anything else and expands dotted keys", () => {
    const target = { name: "Pin", label: { color: "#fff", size: 1 }, points: [1, 2] };
    const result = utils.mergeObject(target, { "label.size": 2, points: [3], extra: true });
    assert.equal(result, target);
    assert.deepEqual(target, { name: "Pin", label: { color: "#fff", size: 2 }, points: [3], extra: true });
});

test("escapeHtml escapes what would end an attribute or start a tag", () => {
    assert.equal(utils.escapeHtml(`Bob's "map" <b>&`), "Bob&#x27;s &quot;map&quot; &lt;b&gt;&amp;");
    assert.equal(utils.escapeHtml(null), "");
});

test("readForm reads named fields as Foundry's form data does", () => {
    document.body.innerHTML = `<form>
        <input name="mapSeed" value="ABC"><input name="mapWidth" type="number" value="1200">
        <input name="show" type="checkbox" checked><input name="hide" type="checkbox">
        <input name="engine" type="radio" value="flat"><input name="engine" type="radio" value="guided" checked>
        <input name="off" value="x" disabled><button name="go">Go</button></form>`;
    assert.deepEqual(utils.readForm(document.querySelector("form")), { mapSeed: "ABC", mapWidth: 1200, show: true, hide: false, engine: "guided" });
});

test("debounce runs once, after calls stop", async () => {
    let calls = 0;
    const run = utils.debounce(() => calls++, 10);
    run();
    run();
    run();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(calls, 1);
});

// --- i18n

test("the language is the reader's first preference the module has, by code then by language", () => {
    const available = [
        { lang: "en", path: "languages/en.json" },
        { lang: "en-GB", path: "languages/en-gb.json" },
    ];
    assert.equal(chooseLanguage(available, ["en-GB", "en"]).lang, "en-GB");
    assert.equal(chooseLanguage(available, ["en-US"]).lang, "en");
    assert.equal(chooseLanguage(available, ["fr-FR", "en-gb"]).lang, "en-GB");
    assert.equal(chooseLanguage(available, ["de"]).lang, "en", "falls back to English");
});

test("strings come from flat or nested files, later files winning, with {name} placeholders", () => {
    const strings = flattenStrings({ "A.Colour": "Color", "A.Count": "{count} maps" }, { A: { Colour: "Colour" } });
    const i18n = createI18n(strings, "en-GB");
    assert.equal(i18n.localize("A.Colour"), "Colour");
    assert.equal(i18n.format("A.Count", { count: 3 }), "3 maps");
    assert.equal(i18n.format("A.Count"), "{count} maps");
    assert.equal(i18n.localize("A.Missing"), "A.Missing");
});

// --- settings

function fakeStorage() {
    const values = new Map();
    return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), values };
}

test("settings read their default until set, are kept in storage and call onChange", async () => {
    const storage = fakeStorage();
    const changed = [];
    const settings = createWebSettings(storage);
    settings.register("themeHue", { default: "gold", onChange: (value) => changed.push(value) });
    settings.register("customPinIcons", { default: [] });
    assert.equal(settings.get("themeHue"), "gold");
    settings.get("customPinIcons").push("changed");
    assert.deepEqual(settings.get("customPinIcons"), [], "the default is not changed through what get returns");
    await settings.set("themeHue", "teal");
    assert.equal(settings.get("themeHue"), "teal");
    assert.equal(storage.values.get("fwmb.themeHue"), '"teal"');
    assert.deepEqual(changed, ["teal"]);
    assert.throws(() => settings.get("unknown"), /not registered/);
});

test("settings fall back to memory when storage refuses writes", async () => {
    const refusing = {
        getItem: () => null,
        setItem: () => {
            throw new Error("quota");
        },
    };
    const settings = createWebSettings(refusing);
    settings.register("x", { default: 1 });
    await settings.set("x", 2);
    assert.equal(settings.get("x"), 2);
});

// --- store

test("saving creates a map, saving with its id overwrites it, and owners are kept unless given", async () => {
    let next = 0;
    const store = createWebStore(new MemoryRecords(), { newId: () => `id${++next}` });
    const first = await store.saveMapData("Island", { seed: 1 }, null, { owners: { level: "AAA" } });
    assert.deepEqual(first, { id: "id1", name: "Island" });
    const again = await store.saveMapData("Island (edited)", { seed: 2 }, "id1");
    assert.equal(again.id, "id1");
    assert.deepEqual(await store.loadMapData("id1"), { seed: 2 });
    assert.deepEqual(await store.loadMapOwners("id1"), { level: "AAA" });
    assert.equal((await store.saveMapData("Lost", { seed: 3 }, "gone")).id, "id2", "an id that is not saved makes a new map");
    assert.equal(await store.saveMapData("Empty", null), null);
});

test("saved maps are listed as a tree: regional maps under the map they were cut from, by name", async () => {
    let next = 0;
    const store = createWebStore(new MemoryRecords(), { newId: () => `id${++next}` });
    await store.saveMapData("World", {});
    await store.saveMapData("b Region", { parentId: "id1" });
    await store.saveMapData("a Region", { parentId: "id1" });
    await store.saveMapData("Orphan", { parentId: "deleted" });
    const tree = await store.getSavedMaps();
    assert.deepEqual(
        tree.map((map) => map.name),
        ["Orphan", "World"],
    );
    assert.deepEqual(
        tree[1].children.map((map) => map.name),
        ["a Region", "b Region"],
    );
});

test("rename, duplicate, delete and field updates work on saved maps", async () => {
    let next = 0;
    const store = createWebStore(new MemoryRecords(), { newId: () => `id${++next}` });
    await store.saveMapData("Island", { seed: 1, pins: [] });
    assert.deepEqual(await store.renameSavedMap("id1", "Isle"), { id: "id1", name: "Isle" });
    assert.deepEqual(await store.duplicateSavedMap("id1", "Isle (copy)"), { id: "id2", name: "Isle (copy)" }, "the copy takes the name it is given");
    assert.equal(await store.updateMapDataFields("id1", { dismissed: true }), true);
    assert.deepEqual(await store.loadMapData("id1"), { seed: 1, pins: [], dismissed: true });
    assert.deepEqual(await store.loadMapData("id2"), { seed: 1, pins: [] }, "the copy is its own map");
    assert.equal(await store.deleteSavedMap("id2"), true);
    assert.equal(await store.deleteSavedMap("id2"), false);
    assert.equal(await store.renameSavedMap("none", "x"), false);
    assert.deepEqual((await store.listMapData()).map((entry) => entry.id), ["id1"]);
});

test("changing loaded map data does not change the saved map", async () => {
    const store = createWebStore(new MemoryRecords());
    const { id } = await store.saveMapData("Island", { parentId: "p" });
    const loaded = await store.loadMapData(id);
    delete loaded.parentId;
    assert.deepEqual(await store.loadMapData(id), { parentId: "p" });
});

// --- templates

test("templates render by their Foundry path, include each other by it, and use Foundry's helpers", async () => {
    const handlebars = Handlebars.create();
    const i18n = createI18n(new Map([["K.Hello", "Hello {name}"], ["K.Plain", "Plain"]]), "en");
    registerHelpers(handlebars, i18n);
    const files = {
        "page.hbs": `{{localize "K.Plain"}}|{{localize "K.Hello" name=who}}|{{#if (or (eq a 1) b)}}yes{{/if}}|{{numberFormat n decimals=1}}|{{> "modules/m/templates/parts/bit.hbs"}}`,
        "parts/bit.hbs": "bit",
        "late.hbs": "late {{x}}",
    };
    const fetched = [];
    const templates = createWebTemplates({ handlebars, prefix: "modules/m/templates/", fetchText: async (path) => (fetched.push(path), files[path]) });
    await templates.load(["page.hbs", "parts/bit.hbs"]);
    assert.equal(await templates.render("modules/m/templates/page.hbs", { who: "Ken", a: 1, n: 2.345 }), "Plain|Hello Ken|yes|2.3|bit");
    assert.equal(await templates.render("modules/m/templates/late.hbs", { x: 1 }), "late 1", "a template not loaded is fetched on first use");
    await templates.render("modules/m/templates/late.hbs", { x: 2 });
    assert.deepEqual(fetched.sort(), ["late.hbs", "page.hbs", "parts/bit.hbs"]);
});

// --- assets

test("asset paths become absolute URLs on the site; complete URLs are left alone", () => {
    const assets = createWebAssets({ moduleId: "m", baseUrl: "https://maps.example/site/" });
    assert.equal(assets.url("modules/m/assets/pinhead-icons/castle.svg"), "https://maps.example/site/assets/pinhead-icons/castle.svg");
    assert.equal(assets.url("/modules/m/assets/a.svg"), "https://maps.example/site/assets/a.svg");
    assert.equal(assets.url("data:image/png;base64,AAAA"), "data:image/png;base64,AAAA");
    assert.equal(assets.url("https://cdn.example/a.svg"), "https://cdn.example/a.svg");
    assert.equal(assets.url(""), "");
});

// --- the file picker

FilePickerElement.define(customElements, { browseLabel: "Browse" });

test("the file picker takes its value from the attribute or the property, and sends its own events", () => {
    document.body.innerHTML = '<form><file-picker name="iconPath" type="image" value="a.svg"></file-picker></form>';
    const picker = document.querySelector("file-picker");
    const field = picker.querySelector("input");
    assert.equal(picker.value, "a.svg");
    assert.equal(field.value, "a.svg");
    assert.equal(picker.querySelector("button").getAttribute("aria-label"), "Browse");

    picker.setAttribute("value", "b.svg");
    assert.equal(field.value, "b.svg");
    picker.value = "c.svg";
    assert.equal(picker.getAttribute("value"), "b.svg", "the property does not write the attribute");
    assert.equal(field.value, "c.svg");

    const seen = [];
    document.addEventListener("change", (event) => seen.push(event.target.localName));
    field.value = "typed.svg";
    field.dispatchEvent(new window.Event("change", { bubbles: true }));
    assert.equal(picker.value, "typed.svg");
    assert.deepEqual(seen, ["file-picker"]);
});

test("a folder picker has no browse button", () => {
    document.body.innerHTML = '<file-picker name="exportFolder" type="folder" value="exports"></file-picker>';
    assert.equal(document.querySelector("file-picker button"), null);
});

// --- the services together

test("the web platform has every service, without the scene export", () => {
    const frame = document.createElement("div");
    const services = createWebPlatform({
        strings: new Map(),
        lang: "en",
        handlebars: Handlebars.create(),
        fetchTemplate: async () => "",
        records: new MemoryRecords(),
        frame,
        manifest: { id: "m", version: "4.0.0" },
        baseUrl: "http://localhost/",
        storage: fakeStorage(),
    });
    assert.deepEqual(Object.keys(services), ["i18n", "notify", "utils", "templates", "fonts", "dialogs", "settings", "store", "assets", "module", "grid", "scene", "frame"]);
    assert.equal(services.scene.available, false);
    assert.equal(services.module.version, "4.0.0");
    services.notify.warn("Careful", { permanent: true });
    assert.equal(frame.querySelector(".fwmb-notification.fwmb-notification--warning span").textContent, "Careful");
    services.frame.setTitle("Map: Harbour");
    assert.equal(document.title, "Map: Harbour", "the studio's title is the page's");
    assert.equal(services.frame.idLength, 6, "a short id, to leave the name readable on a tab");
});
