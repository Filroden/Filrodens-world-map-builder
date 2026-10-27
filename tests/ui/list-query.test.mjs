// The long lists' search and filters, their rows drawn only when they change and marked after each draw (ListQuery), Mass Edit's Delete as one undo step, and
// the styles a run can set back to the defaults (Generation.resetStyles, stylesLookOlder).
import assert from "node:assert/strict";
import { test } from "node:test";

const { installPlatform, platform } = await import("../../src/platform/index.js");
let confirmAnswer = true;
installPlatform({
    i18n: { localize: (key) => key, format: (key, data) => `${key} ${JSON.stringify(data)}`, lang: "en" },
    notify: { info() {}, warn() {}, error() {} },
    utils: { ...platform.utils, randomID: () => "x", deepClone: (value) => structuredClone(value), mergeObject: (target, source) => Object.assign(target, source), escapeHtml: (text) => text },
    dialogs: { confirm: async () => confirmAnswer },
});

const { FILRODENSWMB } = await import("../../src/config.js");
const { ListQuery } = await import("../../src/applications/ListQuery.js");
const { MapDialogManager } = await import("../../src/applications/MapDialogManager.js");
const { Generation } = await import("../../src/applications/Generation.js");
const { VectorHistory } = await import("../../src/applications/VectorHistory.js");


/** A thousand-odd rows: every third generated, kinds by turn. */
function rows(count = 650) {
    const kinds = ["town", "city", "castle"];
    return Array.from({ length: count }, (_, index) => ({ id: `r${index}`, name: index % 10 === 0 ? `Ashford ${index}` : `Place ${index}`, generated: index % 3 === 0, kind: kinds[index % 3] }));
}

function studio(extra = {}) {
    let renders = 0;
    return {
        listQueries: {},
        view: { render: () => renders++ },
        get renders() {
            return renders;
        },
        ...extra,
    };
}

test("a list shows every row that matches its search and filters, and says how many match while filtered", () => {
    const app = studio();
    const all = rows();
    let view = ListQuery.view(app, "pin", all, { town: "T", city: "C", castle: "K" });
    assert.equal(view.rows.length, all.length, "nothing held back");
    assert.equal(view.controls.counted, null);

    const query = ListQuery.of(app, "pin");
    Object.assign(query, { search: "ASHFORD", origin: "generated", kind: "town" });
    view = ListQuery.view(app, "pin", all, { town: "T", city: "C", castle: "K" });
    assert.ok(view.rows.length > 0);
    assert.ok(view.rows.every((row) => row.name.startsWith("Ashford") && row.generated && row.kind === "town"));
    assert.match(view.controls.counted, /ListMatching/);
    query.kind = "gone";
    assert.equal(ListQuery.view(app, "pin", all, { town: "T" }).controls.kinds[0].selected, true, "a kind no longer offered falls back to all");
    query.search = "no such place";
    assert.equal(ListQuery.view(app, "pin", all, { town: "T" }).controls.noMatches, true);
});

test("a list's rows are rendered again only when what they show changes", async () => {
    const app = studio();
    let renders = 0;
    const previous = platform.templates;
    installPlatform({ templates: { render: async (_path, context) => `rows ${++renders} ${context.rows.length}` } });
    const shown = (row) => [row.id, row.name];
    const all = rows(5);
    const first = await ListQuery.html(app, "pin", "t", { rows: all, massEdit: false }, shown);
    const again = await ListQuery.html(app, "pin", "t", { rows: all.map((row) => ({ ...row })), massEdit: false }, shown);
    assert.equal(renders, 1, "the same rows: the kept HTML");
    assert.equal(again.version, first.version);
    const renamed = all.map((row, index) => (index === 2 ? { ...row, name: "Renamed" } : row));
    const changed = await ListQuery.html(app, "pin", "t", { rows: renamed, massEdit: false }, shown);
    assert.equal(renders, 2);
    assert.notEqual(changed.version, first.version);
    await ListQuery.html(app, "pin", "t", { rows: renamed, massEdit: true }, shown);
    assert.equal(renders, 3, "Mass Edit turned on changes the rows");
    installPlatform({ templates: previous });
});

test("after a draw, the row in the inspector is marked and Mass Edit's ticks follow its choice", async () => {
    const { Window } = await import("happy-dom");
    const window = new Window();
    globalThis.CSS ??= { escape: (text) => text };
    const document = window.document;
    document.body.innerHTML = `<div data-list-rows="pin" data-list-selected="b">${["a", "b", "c"].map((id) => `<div data-list-item data-id="${id}" aria-selected="${id === "a"}"><input type="checkbox" data-mass-type="pin"></div>`).join("")}</div>`;
    ListQuery.settle({ massEditSelection: { pin: new Set(["a", "c"]) } }, document.body);
    const rows = [...document.querySelectorAll("[data-list-item]")];
    assert.deepEqual(rows.map((row) => row.getAttribute("aria-selected")), ["false", "true", "false"]);
    assert.deepEqual(rows.map((row) => row.querySelector("input").checked), [true, false, true]);
    await window.happyDOM.close();
});

test("the search field waits for typing to pause; a filter redraws at once", async () => {
    const app = studio();
    const search = { dataset: { listQuery: "route", queryField: "search" }, value: "road" };
    assert.equal(ListQuery.handleInput(app, { type: "input", target: search }), true);
    assert.equal(ListQuery.of(app, "route").search, "road");
    assert.equal(app.renders, 0, "not yet");
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(app.renders, 1);
    ListQuery.handleInput(app, { type: "change", target: { dataset: { listQuery: "route", queryField: "origin" }, value: "handmade" } });
    assert.equal(ListQuery.of(app, "route").origin, "handmade");
    assert.equal(app.renders, 2);
    assert.equal(ListQuery.handleInput(app, { type: "change", target: { dataset: {}, value: "x" } }), false);
});

test("Mass Edit's Delete removes every chosen pin as one undo step, after asking", async () => {
    const app = {
        mapPins: [{ id: "a", icon: "dot" }, { id: "b", icon: "dot" }, { id: "c", icon: "dot" }],
        mapRoutes: [],
        mapLabels: [],
        tectonicFaults: [],
        manualRivers: [],
        landMasks: [],
        mapDecorations: [],
        layerSets: [],
        uiState: { customBiomes: [] },
        massEditSelection: { pin: new Set(["a", "c"]) },
        pinHistory: [],
        pinRedoStack: [],
        globalHistoryLedger: [],
        globalRedoLedger: [],
        _repaintVectors() {},
        markDirty() {},
    };
    confirmAnswer = false;
    assert.equal(await MapDialogManager.massDelete(app, "pin"), false);
    assert.equal(app.mapPins.length, 3);
    confirmAnswer = true;
    assert.equal(await MapDialogManager.massDelete(app, "pin"), true);
    assert.deepEqual(app.mapPins.map((pin) => pin.id), ["b"]);
    assert.equal(app.massEditSelection.pin.size, 0);
    assert.deepEqual(app.globalHistoryLedger, ["vector"]);
    VectorHistory.step(app, true);
    assert.deepEqual(app.mapPins.map((pin) => pin.id), ["a", "b", "c"]);
});

// ------------------------------------------------------------------ the styles a run uses

/** A map from an earlier version: its tier styles unmarked, at an older default set's scales. */
function olderMap() {
    const older = FILRODENSWMB.GENERATOR.OLDER_PIN_SCALES[0];
    const iconOf = (tier) => FILRODENSWMB.PINS.DEFAULT_STYLES.find((seed) => seed.tier === tier).icon;
    return {
        uiState: {
            customPinStyles: Object.entries(older).map(([tier, scale]) => ({ id: `style-${tier}`, name: `Old ${tier}`, icon: iconOf(tier), scale, color: "#ffffff", label: { fontSize: scale, visibility: "all", quickStyle: "custom" } })),
            customLabelStyles: [{ id: "label-style-realm", name: "Realm", fontFamily: "Cinzel", fontSize: 7.2, fillColor: "#DEDCD3", maxChars: 0, justify: "center", bold: true, italic: false }],
            customRouteStyles: [{ id: "route-style-trunk-road", name: "Trunk road", transport: "road", color: "#000000", thickness: 9, style: "solid", outline: true, smoothing: false }],
        },
        mapPins: [{ id: "p", icon: "star", pinStyle: "style-capital", scale: 4, label: { fontSize: 4 } }],
        mapRoutes: [{ id: "r", quickStyle: "route-style-trunk-road", thickness: 9 }],
        mapLabels: [],
        regionLevels: [{ regions: [{ id: "g", label: { quickStyle: "label-style-realm", fontSize: 7.2 } }] }],
    };
}

test("a map whose tier styles are an older default set is recognised; one with its own sizes is not", () => {
    const app = olderMap();
    assert.equal(Generation.stylesLookOlder(app), true);
    app.uiState.customPinStyles[0].scale = 5;
    assert.equal(Generation.stylesLookOlder(app), false);
    assert.equal(Generation.stylesLookOlder({ uiState: { customPinStyles: null } }), false);
});

test("Use the default styles sets the generated styles back, keeping their names, and restyles what follows them", () => {
    const app = olderMap();
    Generation.resetStyles(app);
    const capital = app.uiState.customPinStyles.find((style) => style.id === "style-capital");
    const seed = FILRODENSWMB.PINS.DEFAULT_STYLES.find((style) => style.tier === "capital");
    assert.deepEqual([capital.name, capital.tier, capital.scale, capital.label.quickStyle], ["Old capital", "capital", seed.scale, seed.labelStyle]);
    assert.equal(app.mapPins[0].scale, seed.scale, "the pin following it takes its look");
    const realm = FILRODENSWMB.LABELS.DEFAULT_STYLES.find((style) => style.id === "label-style-realm");
    assert.equal(app.uiState.customLabelStyles[0].fontSize, realm.fontSize);
    assert.equal(app.regionLevels[0].regions[0].label.fontSize, realm.fontSize);
    const trunk = FILRODENSWMB.ROUTES.DEFAULT_STYLES.find((style) => style.id === "route-style-trunk-road");
    assert.equal(app.uiState.customRouteStyles[0].thickness, trunk.thickness);
    assert.equal(app.mapRoutes[0].thickness, trunk.thickness);
    assert.equal(Generation.stylesLookOlder(app), false, "no longer an older set");
});
