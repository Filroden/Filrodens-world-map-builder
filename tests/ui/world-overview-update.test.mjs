// Bringing a world up to date from its overview (L-surface step 4b; board L4b): the notice at the
// head of the In group listing what Generate all would run, only when something needs a run, and
// not on a held regional world or a world with no Surface map; Generate again on each of the
// world's own Out of date rows (not an up-to-date one, one whose pin has gone, or a held world's
// parent's), making that map again from its pin without opening it; the marks' tooltips saying
// what changed; the rows without the settlement icon.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import Handlebars from "handlebars";
import { Window } from "happy-dom";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const window = new Window({ url: "http://localhost/" });
Object.assign(globalThis, { window, document: window.document });
const document = window.document;

const { installPlatform, platform } = await import("../../src/platform/index.js");
const { createWebTemplates, registerHelpers } = await import("../../src/platform/web/templates.js");
const i18n = { localize: (key) => key.replace("FILRODENSWMB.UI.", ""), format: (key, data) => `${key.replace("FILRODENSWMB.UI.", "")} ${Object.values(data).join(",")}`, lang: "en" };
const handlebars = Handlebars.create();
registerHelpers(handlebars, i18n);
const templates = createWebTemplates({ handlebars, prefix: "modules/filrodens-world-map-builder/templates/", fetchText: async (path) => readFileSync(join(ROOT, "templates", path), "utf8") });
await templates.load(["world/tools-worldOverview.hbs"]);
installPlatform({ i18n, templates, notify: { info: () => {}, warn: () => {}, error: () => {} }, utils: { ...platform.utils } });

const { GenerateAll } = await import("../../src/studios/world/app/GenerateAll.js");
const { SettlementMaps } = await import("../../src/studios/world/app/SettlementMaps.js");

/** A world with three settlement maps of its own and a stand-in for the Local studio's controller. */
function world({ held = false, modelRun = null } = {}) {
    const states = new Map([
        ["castford", { changed: [], pinGone: false }],
        ["holloway", { changed: ["people", "supply"], pinGone: false, people: { was: 420, now: 600 } }],
        ["oldweir", { changed: [], pinGone: true }],
    ]);
    const made = [];
    const rendered = [];
    const controller = {
        cards: () => [
            { id: "castford", pinId: "p1", name: "Castford", tier: "town", people: 2900 },
            { id: "holloway", pinId: "p2", name: "Holloway", tier: "village", people: 420 },
            { id: "oldweir", pinId: "p3", name: "Old Weir", tier: "village", people: 600 },
        ],
        states: () => states,
        stateOf: (id) => states.get(id) ?? null,
        describe: (state) => state.changed.join(" and "),
        regenerate: async (ids) => {
            made.push(...ids);
            for (const id of ids) states.set(id, { changed: [], pinGone: false });
            return ids.length;
        },
        destroy() {},
    };
    const app = {
        world: { id: "w1", name: "Tutorial world", held, maps: [] },
        mapPins: [
            { id: "p1", name: "Castford" },
            { id: "p2", name: "Holloway" },
        ],
        modelRun,
        shell: { registry: { get: (id) => (id === "local" ? { create: () => controller } : null) } },
        view: { render: (regions) => rendered.push(regions) },
    };
    SettlementMaps.controller(app);
    return { app, made, rendered, states };
}

const render = async (overview) => {
    const box = document.createElement("div");
    box.innerHTML = await platform.templates.render("modules/filrodens-world-map-builder/templates/world/tools-worldOverview.hbs", { overview: { maps: [], regional: [], settlementsHere: true, ...overview } });
    return box;
};

test("the notice lists what Generate all would run, in its order, with Generate all… and its count", async () => {
    const { app } = world();
    const update = GenerateAll.overview(app);
    assert.equal(update.title, "OverviewUpdateTitle 2");
    assert.deepEqual(update.maps.map((map) => [map.name, map.line]), [
        ["LayerSurfaceFull", "GenerateAllNoRun"],
        ["GenerateAllSettlementName Holloway", "GenerateAllStale"],
    ]);
    assert.equal(update.label, "GenerateAllCount 2");
    const box = await render({ update });
    const notice = box.querySelector(".fwmb-overview-update");
    assert.ok(notice, "at the head of the In group");
    assert.equal(notice.closest("section").getAttribute("aria-labelledby"), "fwmb-overview-in");
    assert.deepEqual([...notice.querySelectorAll(".fwmb-overview-update-list li")].map((item) => item.textContent.trim()), ["LayerSurfaceFull · GenerateAllNoRun", "GenerateAllSettlementName Holloway · GenerateAllStale"]);
    assert.equal(notice.querySelector(".fwmb-overview-update-list").getAttribute("aria-label"), "OverviewUpdateList");
    const button = notice.querySelector('[data-action="generateAll"]');
    assert.ok(button?.classList.contains("fwmb-btn--primary"));
    assert.equal(button.textContent.trim(), "GenerateAllCount 2");
});

test("no notice when nothing needs a run, on a held regional world, or on a world with no Surface map", async () => {
    const held = world({ held: true });
    assert.equal(GenerateAll.overview(held.app), null, "a held world's runs are its parent's");
    const empty = world();
    empty.app.surfaceMade = false;
    assert.equal(GenerateAll.overview(empty.app), null, "Make the Surface map first");
    const one = world();
    one.states.set("holloway", { changed: [], pinGone: false });
    const update = GenerateAll.overview(one.app);
    assert.equal(update.title, "OverviewUpdateTitleOne");
    assert.equal((await render({ update: null })).querySelector(".fwmb-overview-update"), null);
});

test("Generate again only on the world's own Out of date rows, the marks saying what changed; the rows without the settlement icon", async () => {
    const { app } = world();
    const rows = SettlementMaps.overview(app);
    assert.deepEqual(rows.map((row) => [row.name, row.again]), [
        ["Castford", false],
        ["Holloway", true],
        ["Old Weir", false],
    ]);
    assert.equal(rows[1].marks[0].tooltip, "SettlementMarkChanged people and supply");
    assert.equal(rows[2].marks[0].tooltip, "SettlementPinGoneLine Old Weir,LayerSurfaceFull");
    const box = await render({ settlements: rows });
    const again = [...box.querySelectorAll('[data-action="regenerateSettlementMap"]')];
    assert.deepEqual(again.map((button) => button.dataset.settlementId), ["holloway"]);
    assert.equal(again[0].getAttribute("aria-label"), "GenerateAgainNamed Holloway");
    assert.equal(again[0].getAttribute("data-tooltip"), "GenerateAgainNamed Holloway");
    assert.ok(again[0].querySelector(".fwmb-compact-label"), "its word kept for screen readers where it shows its icon alone");
    const row = again[0].closest("tr");
    assert.deepEqual([...row.querySelectorAll(".fwmb-settlement-actions .fwmb-btn")].map((button) => button.dataset.action), ["regenerateSettlementMap", "openSettlementMap", "deleteSettlementMap"]);
    assert.equal(row.querySelector('th[scope="row"] .fwmb-icon'), null, "no settlement icon before the name");
    assert.equal(row.querySelector(".fwmb-state-mark").getAttribute("data-tooltip"), "SettlementMarkChanged people and supply");
    assert.equal(row.querySelector(".fwmb-state-mark .fwmb-compact-label").textContent, "MarkOutOfDate");
});

test("a row's Generate again makes that map again from its pin, then draws the lists again; nothing for a map up to date or whose pin has gone", async () => {
    const { app, made, rendered } = world();
    assert.equal(await SettlementMaps.regenerate(app, "castford"), false, "up to date");
    assert.equal(await SettlementMaps.regenerate(app, "oldweir"), false, "its pin gone: nothing to make it from");
    assert.equal(await SettlementMaps.regenerate(app, "elsewhere"), false, "not this world's");
    assert.deepEqual(made, []);
    assert.equal(await SettlementMaps.regenerate(app, "holloway"), true);
    assert.deepEqual(made, ["holloway"]);
    assert.deepEqual(rendered.at(-1), ["worldbar", "context"]);
    assert.equal(SettlementMaps.overview(app).find((row) => row.id === "holloway").again, false, "up to date once made again");
});
