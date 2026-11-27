// One window per world (WL), as the studio shows it: Worlds marking a world open for editing in
// another tab or window, with Rename, Delete… and Cut again… off saying why; the world bar's View
// only mark and a world page's notice with Edit here; and the rules that keep a world open view only
// from writing (its world settings read only, no runs, no settlement maps made, made again or
// deleted). The studio's own opening and closing need a browser: the two-tab check in the progress
// doc covers them.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import Handlebars from "handlebars";
import { Window } from "happy-dom";
import { createLockHub } from "../support/world-locks.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const window = new Window({ url: "http://localhost/" });
for (const name of Object.getOwnPropertyNames(window)) {
    if (/^[A-Z]/.test(name) && !(name in globalThis)) globalThis[name] = window[name];
}
Object.assign(globalThis, { window, document: window.document });
after(() => window.happyDOM.close());
const document = window.document;

const { installPlatform, platform } = await import("../../src/platform/index.js");
const { createWebTemplates, registerHelpers } = await import("../../src/platform/web/templates.js");
const { createWebStore, MemoryRecords } = await import("../../src/platform/web/store.js");
const i18n = { localize: (key) => key.replace("FILRODENSWMB.UI.", ""), format: (key, data) => `${key.replace("FILRODENSWMB.UI.", "")} ${Object.values(data).join(",")}`, lang: "en" };
const handlebars = Handlebars.create();
registerHelpers(handlebars, i18n);
const PREFIX = "modules/filrodens-world-map-builder/templates/";
const templates = createWebTemplates({ handlebars, prefix: PREFIX, fetchText: async (path) => readFileSync(join(ROOT, "templates", path), "utf8") });
await templates.load(["world/tools-manage.hbs", "world/parts/inspector-world.hbs", "shell/worldbar.hbs", "shell/parts/page-head.hbs"]);

let next = 0;
const newId = () => `id${String(++next).padStart(4, "0")}`;
let hub;
let here;
let there;
let store;
function install(tab) {
    installPlatform({
        i18n,
        templates,
        module: { version: "5.0.0", host: "web", hostVersion: null },
        store,
        worldLocks: tab,
        notify: { info: () => {}, warn: () => {}, error: () => {} },
        settings: { register: () => {}, get: () => null, set: async () => {} },
        dialogs: { dismiss: () => {}, attach: () => () => {} },
        utils: { ...platform.utils, randomID: newId },
    });
}
beforeEach(() => {
    store = createWebStore(new MemoryRecords(), { newId });
    hub = createLockHub();
    here = hub.tab("here");
    there = hub.tab("there");
    install(here);
});
store = createWebStore(new MemoryRecords(), { newId });
install(null);

const { Worlds } = await import("../../src/kernel/worlds/Worlds.js");
const { WorldAccess } = await import("../../src/kernel/worlds/WorldAccess.js");
const { WorldsPanel, WorldEditor } = await import("../../src/studios/world/app/WorldsPanel.js");
const { WorldEditors } = await import("../../src/studios/world/app/WorldEditors.js");
const { Generation } = await import("../../src/studios/world/app/Generation.js");
const { GenerateAll } = await import("../../src/studios/world/app/GenerateAll.js");
const { SettlementMaps } = await import("../../src/studios/world/app/SettlementMaps.js");

const surface = () => ({ id: null, type: "surface", data: { mapWidth: 10, mapHeight: 10 }, owners: {}, modelRun: null, changed: true, card: { run: true } });

/** Aethoria with Westmarch held under it, and a world of its own beside them. */
async function worlds() {
    const top = (await Worlds.save({ world: null, name: "Aethoria", settings: {}, maps: [surface()] })).world;
    const region = (await Worlds.save({ world: null, name: "Westmarch", settings: {}, maps: [surface()] })).world;
    await store.saveWorld({ ...region, parentWorldId: top.id, held: true, regional: { maps: [{ mapId: region.maps[0].id, crop: { parent: { x: 0, y: 0, width: 5, height: 5 } }, size: { width: 10, height: 10 } }] } });
    const other = (await Worlds.save({ world: null, name: "Old Map", settings: {}, maps: [surface()] })).world;
    return { top, region, other };
}

/** Opens a world for editing in the other tab. */
async function openThere(worldId) {
    install(there);
    await WorldAccess.claim(worldId);
    install(here);
}

const app = () => ({ root: null, world: null, view: { render: () => {} }, calls: [] });

async function inspector(studio, worldId) {
    const world = WorldsPanel.find(studio, worldId);
    const box = document.createElement("div");
    box.innerHTML = await platform.templates.render(`${PREFIX}world/parts/inspector-world.hbs`, WorldEditor.context(studio, world));
    return box;
}

test("Worlds marks a world open for editing elsewhere; its Rename and Delete… are off, saying why", async () => {
    const { other } = await worlds();
    await openThere(other.id);
    const studio = app();
    const context = await WorldsPanel.context(studio);
    const card = context.cards.find((each) => each.id === other.id);
    assert.deepEqual(
        card.marks.map((mark) => [mark.label, mark.tooltip]),
        [["MarkOpenElsewhere", "MarkOpenElsewhereHint"]],
    );
    const box = await inspector(studio, other.id);
    const name = box.querySelector('input[name="worldName"]');
    assert.equal(name.hasAttribute("readonly"), true);
    assert.equal(name.dataset.tooltip, "CloseElsewhereFirst");
    const remove = box.querySelector(".fwmb-foot-danger button");
    assert.equal(remove.getAttribute("aria-disabled"), "true");
    assert.equal(remove.dataset.inspectorAction, undefined, "Delete… does nothing");
    assert.ok(box.querySelector('[data-inspector-action="open"]'), "Open stays: it opens view only");

    // Its Name field committed anyway changes nothing
    const form = document.createElement("form");
    form.innerHTML = '<input name="worldName" value="Renamed">';
    WorldEditor.apply(studio, WorldsPanel.find(studio, other.id), { id: other.id }, form);
    assert.equal((await Worlds.get(other.id)).name, "Old Map");
});

test("a parent's Delete… is off while a regional world it would rewrite is open elsewhere, naming it", async () => {
    const { top, region } = await worlds();
    await openThere(region.id);
    const studio = app();
    await WorldsPanel.context(studio);
    const box = await inspector(studio, top.id);
    assert.equal(box.querySelector(".fwmb-foot-danger button").dataset.tooltip, "CloseElsewhereFirstNamed Westmarch");
    assert.equal(box.querySelector('input[name="worldName"]').hasAttribute("readonly"), false, "the parent itself may be renamed");
});

test("Cut again… is off while the regional world or the world it is cut from is open elsewhere", async () => {
    const { top, region } = await worlds();
    const studio = app();
    await WorldsPanel.context(studio);
    const node = { ...WorldsPanel.find(studio, region.id), cropKnown: true };
    assert.equal(WorldEditor.cutAgain(studio, node).off, undefined);
    await openThere(top.id);
    await WorldsPanel.context(studio);
    assert.equal(WorldEditor.cutAgain(studio, { ...WorldsPanel.find(studio, region.id), cropKnown: true }).off, "CloseElsewhereFirstNamed Aethoria");
});

test("the world bar shows View only beside the name, its line the tooltip, with Save world off", async () => {
    const box = document.createElement("div");
    const line = "ViewOnlyHint Aethoria,ViewOnlyPlaceWeb";
    box.innerHTML = await platform.templates.render(`${PREFIX}shell/worldbar.hbs`, { worldBar: { name: "Aethoria", fold: "0", layers: [], current: {}, viewOnly: line, savesOff: line, saved: true } });
    const mark = box.querySelector(".fwmb-worldbar-view");
    assert.equal(mark.dataset.tooltip, line);
    assert.equal(mark.querySelector(".fwmb-fold-full").textContent, "ViewOnlyMark");
    assert.equal(box.querySelector(".fwmb-save").getAttribute("aria-disabled"), "true");
    assert.equal(box.querySelector('.fwmb-save[data-action="saveMap"]'), null);
    // Not open view only: no mark
    box.innerHTML = await platform.templates.render(`${PREFIX}shell/worldbar.hbs`, { worldBar: { name: "Aethoria", fold: "0", layers: [], current: {}, saved: true } });
    assert.equal(box.querySelector(".fwmb-worldbar-view"), null);
});

test("a world page shows the notice with Edit here, and its fields and Revert changes are off", async () => {
    const box = document.createElement("div");
    const notice = { title: "View only", icon: "visibility", lines: ["ViewOnlyFree Aethoria"], actions: [{ action: "editHere", label: "Edit here", icon: "edit" }] };
    box.innerHTML = await platform.templates.render(`${PREFIX}shell/parts/page-head.hbs`, { panel: { title: "World setup", crumb: "Aethoria", notice, worldEditor: { lede: "", locked: true, changes: "No changes", tool: "worldSetup" } } });
    assert.ok(box.querySelector('.fwmb-panel-notice [data-action="editHere"]'));
    assert.equal(box.querySelector('[data-action="revertWorldGroup"]'), null);
    assert.equal(box.querySelector(".fwmb-page-changes"), null);
    const setup = readFileSync(join(ROOT, "templates/world/tools-worldSetup.hbs"), "utf8");
    assert.match(setup, /\{\{#if worldEditor\.locked\}\} disabled\{\{\/if\}\}/, "the page's fieldset is disabled when locked");
});

test("a world open view only writes nothing: its settings read only, no runs, no settlement maps made, made again or deleted", async () => {
    const viewing = { viewOnly: true, world: { id: "w" }, mapPins: [{ id: "p" }], meshSession: { mesh: {} } };
    assert.equal(WorldEditors.readOnly(viewing), true);
    assert.equal(WorldEditors.readOnly({ world: { id: "w" } }), false);
    const head = WorldEditors.head(viewing, { tool: "worldAges", changed: true, heldCount: 0, heldBy: null });
    assert.deepEqual([head.locked, head.held, head.canRevert], [true, false, false], "its pages' fields off, with no held banner and nothing to revert");
    assert.equal(await Generation.run(viewing), false);
    assert.equal(await GenerateAll.open(viewing), false);
    assert.equal(GenerateAll.overview(viewing), null);
    assert.equal(await SettlementMaps.make(viewing, "p"), false);
    assert.equal(await SettlementMaps.deleteMap(viewing, "s"), false);
    assert.equal(await SettlementMaps.regenerate(viewing, "s"), false);
    assert.equal(await SettlementMaps.regenerateStale(viewing), 0);
});
