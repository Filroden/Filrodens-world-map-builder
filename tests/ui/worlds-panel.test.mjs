// Worlds (WorldsPanel, S0 step 3b), drawn from the real templates in happy-dom over a web store:
// a card per world of its own (thumbnail or icon, marks, its line, its regional worlds counted),
// Search keeping families and naming the regional worlds that matched as chips, the head and foot;
// and a world in the inspector (WorldEditor): its family's tree, its maps and setup, what it is,
// Open, the actions a world of its kind has, and renaming through its Name field.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import Handlebars from "handlebars";
import { Window } from "happy-dom";

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
const { Overlay } = await import("../../src/shell/Overlay.js");
const i18n = { localize: (key) => key.replace("FILRODENSWMB.UI.", ""), format: (key, data) => `${key.replace("FILRODENSWMB.UI.", "")} ${Object.values(data).join(",")}`, lang: "en" };
const handlebars = Handlebars.create();
registerHelpers(handlebars, i18n);
const templates = createWebTemplates({ handlebars, prefix: "modules/filrodens-world-map-builder/templates/", fetchText: async (path) => readFileSync(join(ROOT, "templates", path), "utf8") });
await templates.load(["world/tools-manage.hbs", "world/tools-manage-head.hbs", "world/tools-manage-foot.hbs", "world/parts/inspector-world.hbs"]);

const settings = new Map();
let host = null;
let next = 0;
const newId = () => `id${String(++next).padStart(4, "0")}`;
function install() {
    settings.clear();
    installPlatform({
        i18n,
        templates,
        module: { version: "5.0.0", host: "web", hostVersion: null },
        store: createWebStore(new MemoryRecords(), { newId }),
        settings: { register: () => {}, get: (key) => settings.get(key) ?? null, set: async (key, value) => settings.set(key, value) },
        dialogs: { dismiss: ({ placement } = {}) => host && Overlay.dismissAll(host, placement), attach: () => () => {} },
        utils: { ...platform.utils, randomID: newId },
    });
}
install();

const { Worlds } = await import("../../src/kernel/worlds/Worlds.js");
const { WorldRecord } = await import("../../src/kernel/worlds/WorldRecord.js");
const { WorldsPanel, WorldEditor } = await import("../../src/studios/world/app/WorldsPanel.js");
const { Inspector } = await import("../../src/studios/world/app/Inspector.js");

const THUMB = "data:image/webp;base64,UklGRg==";
const surface = (card) => ({ id: null, type: "surface", data: { mapWidth: 10, mapHeight: 10 }, owners: {}, modelRun: null, changed: true, card });
const SETUP = { setup: { engine: "advanced", seed: 4242, frame: { width: 1200, height: 800 } } };

/** Aethoria (a run, a thumbnail) with Westmarch held under it; Old Map on its own, older and with no run. */
async function worlds() {
    const top = await Worlds.save({ world: null, name: "Aethoria", settings: SETUP, maps: [surface({ thumbnail: THUMB, run: true, older: false })] });
    const region = await Worlds.save({ world: null, name: "Westmarch", settings: {}, maps: [surface({ run: false })] });
    await platform.store.saveWorld({ ...region.world, parentWorldId: top.world.id, held: true });
    const coast = await Worlds.save({ world: null, name: "Westmarch coast", settings: {}, maps: [surface({ run: true, older: true })] });
    await platform.store.saveWorld({ ...coast.world, parentWorldId: region.world.id, held: true });
    const old = await Worlds.save({ world: null, name: "Old Map", settings: {}, maps: [surface({ run: false, older: true })] });
    return { top: top.world, region: region.world, coast: coast.world, old: old.world };
}

function studio(world = null) {
    document.body.innerHTML = '<div class="fwmb-studio"></div>';
    host = document.querySelector(".fwmb-studio");
    const calls = [];
    const app = {
        root: host,
        world,
        view: { render: () => {} },
        worldAction: (...args) => calls.push(args),
        openWorld: (...args) => calls.push(["open", ...args]),
        calls,
    };
    return app;
}

async function draw(app) {
    const context = { worlds: await WorldsPanel.context(app) };
    const box = document.createElement("div");
    box.innerHTML = await platform.templates.render("modules/filrodens-world-map-builder/templates/world/tools-manage-head.hbs", context);
    box.insertAdjacentHTML("beforeend", await platform.templates.render("modules/filrodens-world-map-builder/templates/world/tools-manage.hbs", context));
    const foot = document.createElement("div");
    foot.className = "fwmb-panel-foot";
    foot.innerHTML = await platform.templates.render("modules/filrodens-world-map-builder/templates/world/tools-manage-foot.hbs", context);
    box.append(foot);
    return box;
}

const titles = (box) => [...box.querySelectorAll(".fwmb-worlds-cards .fwmb-card-title")].map((title) => title.textContent);

beforeEach(() => install());

test("a card per world of its own: its thumbnail or its map type's icon, its line, marks and regional worlds counted", async () => {
    await worlds();
    const box = await draw(studio());
    assert.deepEqual(titles(box), ["Aethoria", "Old Map"]);
    const [top, old] = box.querySelectorAll(".fwmb-worlds-cards .fwmb-card");
    assert.equal(top.querySelector("img").getAttribute("src"), THUMB);
    assert.equal(old.querySelector("img"), null);
    assert.match(top.querySelector(".fwmb-card-line").textContent, /^EngineShortAdvanced · WorldMapsOne · WorldSavedToday$/);
    assert.match(top.textContent, /WorldRegionalCount 2/);
    assert.deepEqual([...old.querySelectorAll(".fwmb-state-mark")].map((mark) => mark.textContent.trim()), ["MarkNoRun"]);
    assert.equal(box.querySelector(".fwmb-worlds-match"), null, "no chips without a search");
    assert.equal(box.querySelector('[data-action="worldsView"]'), null, "no List or Cards choice");
});

test("Search keeps a family when a world in it matches, and names its regional worlds that matched", async () => {
    const { coast } = await worlds();
    const app = studio();
    app.listQueries = { worlds: { search: "coast", origin: "all", kind: "all" } };
    let box = await draw(app);
    assert.deepEqual(titles(box), ["Aethoria"]);
    assert.deepEqual([...box.querySelectorAll(".fwmb-worlds-match")].map((chip) => [chip.dataset.worldId, chip.textContent]), [[coast.id, "Westmarch coast"]]);
    app.listQueries.worlds.search = "west";
    box = await draw(app);
    assert.deepEqual([...box.querySelectorAll(".fwmb-worlds-match")].map((chip) => chip.textContent), ["Westmarch", "Westmarch coast"]);
    app.listQueries.worlds.search = "old";
    box = await draw(app);
    assert.deepEqual(titles(box), ["Old Map"]);
    assert.equal(box.querySelector(".fwmb-worlds-match"), null, "the top world matched, so no chips");
    app.listQueries.worlds.search = "nowhere";
    box = await draw(app);
    assert.equal(box.querySelectorAll(".fwmb-card").length, 0);
    assert.match(box.textContent, /WorldsNoMatches/);
});

test("an empty store says so with New world; the foot offers New world, Import world, Back up all and Restore", async () => {
    const box = await draw(studio());
    assert.match(box.textContent, /NoSavedWorlds/);
    assert.ok(box.querySelector('.fwmb-worlds-empty [data-action="newWorld"]'));
    assert.deepEqual([...box.querySelectorAll(".fwmb-panel-foot [data-action]")].map((button) => button.dataset.action), ["newWorld", "importMapJson", "backUpMaps", "restoreBackup"]);
    assert.equal((await WorldsPanel.context(studio())).summary, "WorldsSavedWeb");
});

test("the summary says where the worlds are kept and how many there are", async () => {
    await worlds();
    assert.equal((await WorldsPanel.context(studio())).summary, "WorldsSavedWeb · WorldsCount 2 · WorldRegionalCount 2");
});

test("a world in the inspector: its family's tree, its maps and setup, what it is, Open and its actions", async () => {
    const { top, region, coast, old } = await worlds();
    const app = studio({ id: top.id });
    await WorldsPanel.context(app);
    const body = async (world) => {
        const box = document.createElement("div");
        box.innerHTML = await platform.templates.render(WorldEditor.template, WorldEditor.context(app, WorldsPanel.find(app, world.id)));
        return box;
    };
    const actions = (box) => [...box.querySelectorAll("[data-inspector-action]:not([data-world-id])")].map((button) => button.dataset.inspectorAction);
    const tree = (box) => [...box.querySelectorAll(".fwmb-worlds-family [role=treeitem]")].map((row) => `${row.getAttribute("aria-level")}:${row.querySelector(".fwmb-name").textContent}${row.getAttribute("aria-selected") === "true" ? "*" : ""}`);

    const topBox = await body(top);
    assert.deepEqual(tree(topBox), ["1:Aethoria*", "2:Westmarch", "3:Westmarch coast"]);
    assert.deepEqual(actions(topBox), ["open", "duplicate", "exportWorld", "delete"]);
    assert.ok(topBox.querySelector('[data-inspector-action="open"]').disabled, "the world open now cannot be opened again");
    assert.match(topBox.querySelector(".fwmb-worlds-map").textContent, /LayerSurfaceFull[\s\S]*WorldSavedToday · WorldMapRevision 1/);
    assert.deepEqual([...topBox.querySelectorAll(".fwmb-worlds-setup dd")].map((value) => value.textContent), ["EngineShortAdvanced", "1200 × 800", "4242"]);

    const coastBox = await body(coast);
    assert.deepEqual(tree(coastBox), ["1:Aethoria", "2:Westmarch", "3:Westmarch coast*"], "the whole family, from the top");
    assert.deepEqual([...coastBox.querySelectorAll(".fwmb-worlds-family [data-inspector-action=showWorld]")].map((row) => row.dataset.worldId), [top.id, region.id], "every other row chooses its world");
    assert.deepEqual(actions(coastBox), ["open", "cloneAsNew", "duplicate", "exportWorld", "delete"]);
    assert.ok(coastBox.querySelector(".fwmb-action-row[disabled]").textContent.includes("WorldCutAgain"), "Cut again is shown, off");
    assert.match(coastBox.textContent, /WorldAboutHeld Westmarch/);
    assert.match(coastBox.querySelector(".fwmb-worlds-map").textContent, /MarkOlderGenerator/);
    assert.equal(WorldEditor.header(app, WorldsPanel.find(app, region.id)).subtitle, "WorldKindRegional");

    assert.equal((await body(old)).querySelector(".fwmb-worlds-family"), null, "a world alone has no family to show");
});

test("the family's tree marks what the search found", async () => {
    const { top } = await worlds();
    const app = studio();
    app.listQueries = { worlds: { search: "coast", origin: "all", kind: "all" } };
    await WorldsPanel.context(app);
    assert.deepEqual(WorldEditor.family(app, WorldsPanel.find(app, top.id)).filter((row) => row.match).map((row) => row.name), ["Westmarch coast"]);
});

test("the inspector's actions and Name field go to the studio's world actions", async () => {
    const { region } = await worlds();
    const app = studio();
    await WorldsPanel.context(app);
    const world = WorldsPanel.find(app, region.id);
    WorldEditor.actions.open(app, world);
    WorldEditor.actions.cloneAsNew(app, world);
    const form = document.createElement("form");
    form.innerHTML = '<input name="worldName" value="  Eastmarch ">';
    assert.equal(WorldEditor.apply(app, world, { id: region.id }, form), false);
    form.elements.worldName.value = "Westmarch";
    WorldEditor.apply(app, world, { id: region.id }, form);
    form.elements.worldName.value = "  ";
    WorldEditor.apply(app, world, { id: region.id }, form);
    const mapId = region.maps[0].id;
    assert.deepEqual(app.calls, [["open", mapId, "Westmarch"], ["promote", mapId, "Westmarch"], ["rename", mapId, "Westmarch", "Eastmarch"]]);
});

test("choosing a regional world shows it in the inspector and lights its family's card", async () => {
    const { top, coast } = await worlds();
    const app = studio();
    await WorldsPanel.context(app);
    assert.equal(await WorldsPanel.select(app, coast.id), true);
    assert.deepEqual(Inspector.current(app).ref, { id: coast.id });
    const box = await draw(app);
    assert.equal(box.querySelector('.fwmb-card[aria-current="true"]').dataset.worldId, top.id);
    assert.equal(await WorldsPanel.select(app, "gone"), false);
    Inspector.close(app);
});

test("a card's saved line: today, yesterday, or the date", () => {
    const now = Date.parse("2026-11-19T12:00:00");
    assert.equal(WorldsPanel.savedLabel(Date.parse("2026-11-19T08:00:00"), now), "WorldSavedToday");
    assert.equal(WorldsPanel.savedLabel(Date.parse("2026-11-18T23:00:00"), now), "WorldSavedYesterday");
    // The date in the reader's own form: day and month this year, the year added otherwise
    assert.match(WorldsPanel.savedLabel(Date.parse("2026-11-02T10:00:00"), now), /^WorldSavedOn (2 Nov|Nov 2)$/);
    assert.match(WorldsPanel.savedLabel(Date.parse("2025-10-28T10:00:00"), now), /^WorldSavedOn .*2025$/);
});

test("a held world copied by a save keeps the card its map had (WorldRecord.create)", () => {
    const record = WorldRecord.create({ id: "w", name: "W", maps: [{ id: "m", type: "surface", thumbnail: THUMB, run: true, junk: 1 }] });
    assert.deepEqual(record.maps, [{ thumbnail: THUMB, run: true, id: "m", type: "surface" }]);
});
