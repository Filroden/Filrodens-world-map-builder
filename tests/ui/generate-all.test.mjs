// Generate all and the single Generate's guard (S0 step 4b; boards S2 and B4): the order maps run
// in (surface, underground, aerial, settlement maps), what Generate all runs, leaves as it is and
// leaves out (held regional worlds), its dialogue; the guard's decision (run at once, the chain,
// this map only, or ask) with the kept answer, its dialogue and Ask each time; the reserved styles
// (ReservedStyles), shown apart in Styles and icons and never deleted; Peoples and realms' Read from
// the world and Generate all.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import Handlebars from "handlebars";
import { Window } from "happy-dom";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const window = new Window({ url: "http://localhost/" });
for (const name of Object.getOwnPropertyNames(window)) {
    if (/^[A-Z]/.test(name) && !(name in globalThis)) globalThis[name] = window[name];
}
Object.assign(globalThis, { window, document: window.document });
const document = window.document;

const { installPlatform, platform } = await import("../../src/platform/index.js");
const { createWebTemplates, registerHelpers } = await import("../../src/platform/web/templates.js");
const i18n = { localize: (key) => key.replace("FILRODENSWMB.UI.", ""), format: (key, data) => `${key.replace("FILRODENSWMB.UI.", "")} ${Object.values(data).join(",")}`, lang: "en" };
const handlebars = Handlebars.create();
registerHelpers(handlebars, i18n);
const templates = createWebTemplates({ handlebars, prefix: "modules/filrodens-world-map-builder/templates/", fetchText: async (path) => readFileSync(join(ROOT, "templates", path), "utf8") });
await templates.load(["shell/parts/section.hbs", "world/dialogs/generate-all.hbs", "world/dialogs/generate-guard.hbs", "world/parts/world-editor-head.hbs", "world/tools-library.hbs"]);
const settings = new Map();
const chosen = [];
let answer = null;
installPlatform({
    i18n,
    templates,
    notify: { info: () => {}, warn: () => {}, error: () => {} },
    settings: { register: () => {}, get: (key) => settings.get(key), set: async (key, value) => settings.set(key, value) },
    dialogs: { confirm: async () => true, prompt: async () => null, dismiss: () => {}, attach: () => () => {}, choose: async (options) => { chosen.push(options); return answer; } },
    utils: { ...platform.utils },
});

const { FILRODENSWMB } = await import("../../src/config.js");
const { GenerateAll, MAP_ORDER } = await import("../../src/studios/world/app/GenerateAll.js");
const { GenerateGuard, GUARD_SETTING } = await import("../../src/studios/world/app/GenerateGuard.js");
const { ReservedStyles, StyleLists } = await import("../../src/studios/world/app/StyleLists.js");
const { WorldEditors } = await import("../../src/studios/world/app/WorldEditors.js");

const render = async (path, context) => {
    const box = document.createElement("div");
    box.innerHTML = await platform.templates.render(`modules/filrodens-world-map-builder/templates/${path}`, context);
    return box;
};
const map = (id, type, state) => ({ id, type, name: id, state });

test("maps run surface first, then underground, aerial and settlement maps, each type in the order given", () => {
    assert.deepEqual(MAP_ORDER, ["surface", "underground", "aerial", "settlement"]);
    const ordered = GenerateAll.order([map("town", "settlement"), map("sky", "aerial"), map("deeps", "underground"), map("mines", "underground"), map("land", "surface"), map("odd", "unknown")]);
    assert.deepEqual(ordered.map((each) => each.id), ["land", "deeps", "mines", "sky", "town", "odd"]);
});

test("Generate all runs what needs a run, leaves what is up to date, and leaves held regional worlds out", async () => {
    const plan = GenerateAll.plan({ maps: [map("deeps", "underground", "stale"), map("land", "surface", "noRun"), map("sky", "aerial", "current")], held: ["Westmarch"] });
    assert.deepEqual(plan.run.map((each) => each.id), ["land", "deeps"]);
    assert.deepEqual(plan.current.map((each) => each.id), ["sky"]);
    assert.deepEqual(plan.held, ["Westmarch"]);
    const box = await render("world/dialogs/generate-all.hbs", GenerateAll.context(plan));
    assert.deepEqual([...box.querySelectorAll(".fwmb-steps li")].map((item) => item.textContent.trim()), ["land · GenerateAllNoRun", "deeps · GenerateAllStale"]);
    assert.match(box.textContent, /GenerateAllUpToDate sky/);
    assert.match(box.textContent, /GenerateAllHeld Westmarch/);
    assert.ok(box.querySelector('.fwmb-start input[name="saveWhenDone"]'), "Save world when it finishes, at the footer's start");
    const none = await render("world/dialogs/generate-all.hbs", GenerateAll.context(GenerateAll.plan({ maps: [map("land", "surface", "current")] })));
    assert.match(none.textContent, /GenerateAllNothing/);
    assert.equal(none.querySelector('[name="saveWhenDone"]'), null);
});

test("the open world's Surface map as Generate all sees it, and the Run button's count", () => {
    assert.equal(GenerateAll.mapsOf({ modelRun: null })[0].state, "noRun");
    assert.equal(GenerateAll.buttonLabel({ modelRun: null }), "GenerateAllCount 1");
});

test("the guard: at once when nothing it reads needs a run, else the kept answer or the question", () => {
    const reads = [map("deeps", "underground", "stale"), map("land", "surface", "stale"), map("sky", "aerial", "current")];
    assert.deepEqual(GenerateGuard.decide({ reads: [map("land", "surface", "current")] }), { action: "run", chain: [] });
    assert.deepEqual(GenerateGuard.decide({ reads: [] }), { action: "run", chain: [] }, "S0: no map reads another");
    const asked = GenerateGuard.decide({ reads, preference: "ask" });
    assert.deepEqual([asked.action, asked.chain.map((each) => each.id)], ["ask", ["land", "deeps"]]);
    assert.deepEqual(GenerateGuard.decide({ reads, preference: "chain" }).chain.map((each) => each.id), ["land", "deeps"]);
    assert.deepEqual(GenerateGuard.decide({ reads, preference: "only" }), { action: "only", chain: [] });
    settings.set(GUARD_SETTING, "nonsense");
    assert.equal(GenerateGuard.preference(), "ask", "an unknown kept answer asks");
});

test("the guard's dialogue: two choices with their times, Ask each time at the footer; unticked, the answer is kept", async () => {
    const box = await render("world/dialogs/generate-guard.hbs", GenerateGuard.context({ target: "Deeps", chain: [map("Surface map", "surface", "stale")], chainTime: "about 2 min", onlyTime: "about 1 min" }));
    const choices = [...box.querySelectorAll(".fwmb-choice")];
    assert.deepEqual(choices.map((card) => card.querySelector("input").value), ["chain", "only"]);
    assert.deepEqual([...choices[0].querySelectorAll(".fwmb-steps li")].map((item) => item.textContent.trim()), ["Surface map", "Deeps"]);
    assert.match(choices[0].textContent, /about 2 min/);
    assert.match(choices[1].textContent, /about 1 min/);
    assert.ok(box.querySelector('.fwmb-start input[name="askEachTime"]').checked);
    choices[1].querySelector("input").checked = true;
    GenerateGuard.bindChoices(box);
    assert.deepEqual(choices.map((card) => card.getAttribute("aria-checked")), ["false", "true"]);

    settings.delete(GUARD_SETTING);
    answer = { choice: "only", remember: true };
    assert.deepEqual(await GenerateGuard.ask({ target: "Deeps", chain: [] }), answer);
    assert.equal(settings.get(GUARD_SETTING), "only");
    // The button reads the choice from the dialogue (its footer holds Ask each time)
    const dialog = document.createElement("dialog");
    dialog.append(box);
    const form = box.appendChild(document.createElement("form"));
    box.querySelector('input[name="askEachTime"]').checked = false;
    assert.deepEqual(chosen.at(-1).buttons.at(-1).callback(form), { choice: "only", remember: true });
    answer = null;
    chosen.length = 0;
    assert.deepEqual(await GenerateGuard.before({}, "Surface map"), [], "S0: no map reads another, so Generate runs at once");
    assert.equal(chosen.length, 0, "without asking");
});

test("Generate all on a held regional world has nothing to run", async () => {
    chosen.length = 0;
    assert.equal(await GenerateAll.open({ world: { held: true } }), false);
    assert.equal(chosen.length, 0, "no dialogue");
});

test("reserved styles: what a generator looks up, said on each lock; Delete refused", async () => {
    const { PINS, GENERATOR } = FILRODENSWMB;
    const tier = PINS.DEFAULT_STYLES[0];
    assert.match(ReservedStyles.reason("Pin", { id: "p1", tier: tier.tier }), /ReservedPinTier/);
    assert.equal(ReservedStyles.reason("Pin", { id: "p2" }), null, "a pin style of the reader's own");
    assert.equal(ReservedStyles.reason("Route", { id: GENERATOR.ROUTE_STYLES.road.trunk }), "ReservedRoute");
    assert.equal(ReservedStyles.reason("Route", { id: "route-style-track" }), null, "a default no generator looks up");
    assert.equal(ReservedStyles.reason("Label", { id: GENERATOR.REGION_LABEL_STYLES.realm }), "ReservedRegionLabel");
    assert.equal(ReservedStyles.reason("Label", { id: "label-style-settlement" }), "ReservedPlaceLabel");
    assert.equal(ReservedStyles.reason("Label", { id: "label-style-river" }), "ReservedFeatureLabel");
    assert.equal(ReservedStyles.reason("Region", { id: "anything" }), null);

    const app = {
        uiState: { customPinStyles: [{ id: "p1", name: "Capital", tier: tier.tier, icon: "star" }, { id: "p2", name: "Mine", icon: "star" }], customRouteStyles: [{ id: GENERATOR.ROUTE_STYLES.road.trunk, name: "Trunk road" }], customRegionStyles: [], customLabelStyles: [] },
        mapPins: [], mapRoutes: [], mapLabels: [], layerSets: [],
    };
    const lists = StyleLists.context(app);
    const pins = lists.find((list) => list.type === "Pin");
    assert.deepEqual([pins.rows.map((row) => row.name), pins.reserved.map((row) => row.name), pins.count], [["Mine"], ["Capital"], 2], "the reader's own, then the reserved under their heading");
    assert.deepEqual(lists.find((list) => list.type === "Route").reserved.map((row) => row.name), ["Trunk road"]);
    const box = await render("world/tools-library.hbs", { worldEditor: WorldEditors.head({}, { tool: "library", changed: true, heldCount: 0, heldBy: null }), styleLists: lists, builtinPinIcons: [], customPinIcons: [] });
    // One table grouped by kind (S0 step 4c-1, board C7): a body a kind, the reserved after the reader's own
    const pinList = box.querySelector('tbody[data-style-list="Pin"]');
    assert.ok(pinList.querySelector(".fwmb-table-group"));
    const reservedRows = [...pinList.querySelectorAll("tr.fwmb-is-reserved")];
    assert.equal(reservedRows.length, 1);
    assert.equal(reservedRows[0].querySelectorAll('[data-action="deleteStyle"]').length, 0, "no Delete");
    assert.match(reservedRows[0].querySelector(".fwmb-table-lock").textContent, /ReservedPinTier/, "the lock says what uses it");
    assert.equal(pinList.querySelectorAll('tr[data-list-item]:not(.fwmb-is-reserved) [data-action="deleteStyle"]').length, 1, "the reader's own keeps Delete");
    assert.equal(box.querySelector('[data-action="revertWorldGroup"]'), null, "Styles and icons keeps the map's undo");
    assert.ok(box.querySelector('.fwmb-page-bar [data-action="importSettings"]') && box.querySelector('.fwmb-page-bar [data-action="exportSettings"]'), "Import and Export styles at the head");
    const { StyleLists: Lists } = await import("../../src/studios/world/app/StyleLists.js");
    assert.equal(await Lists.delete(app, "Route", GENERATOR.ROUTE_STYLES.road.trunk), false, "Delete refused");
    assert.equal(app.uiState.customRouteStyles.length, 1);
});
