// The map controls show what the map shows (src/ui/MapControls.js), and nothing changes a view
// without telling them (MapStudio#syncMapControls).
//
// The controls are drawn from the real map.hbs, then marked from a view state as the studio does,
// in both their wide form and the Layers menu they fold into. The second half reads MapStudio's own
// source: every method that changes a view must also call #syncMapControls, which is the rule that
// keeps a toggle from disagreeing with the map (the map region is drawn once, so nothing else would
// ever correct it).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import Handlebars from "handlebars";
import { Window } from "happy-dom";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const window = new Window({ url: "http://localhost/" });
after(() => window.happyDOM.close());
const document = window.document;

const { FILRODENSWMB } = await import("../../src/config.js");
const { layersShown, syncMapControls, VIEW_LAYERS } = await import("../../src/ui/MapControls.js");
const { ThematicView } = await import("../../src/applications/ThematicView.js");

const TERRAIN_GROUPS = [
    { id: "terrain", icon: "elevation", tooltip: "LayerTerrain", items: [{ key: "elevation", label: "LayerElevation" }, { key: "relief", label: "LayerRelief" }, { key: "water", label: "LayerWater" }] },
    { id: "biomes", icon: "forest", tooltip: "LayerBiomes", items: [{ key: "landBiomes", label: "LayerLandBiomes" }, { key: "seaBiomes", label: "LayerSeaBiomes" }] },
];

/** The map region as the studio draws it, in a fresh document body. */
function drawMap() {
    const handlebars = Handlebars.create();
    handlebars.registerHelper("localize", (key) => key);
    handlebars.registerHelper("eq", (a, b) => a === b);
    handlebars.registerPartial("modules/filrodens-world-map-builder/templates/parts/shared-range.hbs", readFileSync(join(ROOT, "templates/parts/shared-range.hbs"), "utf8"));
    handlebars.registerPartial("modules/filrodens-world-map-builder/templates/parts/thematic-menu.hbs", readFileSync(join(ROOT, "templates/parts/thematic-menu.hbs"), "utf8"));
    const template = handlebars.compile(readFileSync(join(ROOT, "templates/map.hbs"), "utf8"));
    document.body.innerHTML = template({ uiState: { reliefEmphasis: 20 }, layerGroups: TERRAIN_GROUPS, viewLayers: FILRODENSWMB.STUDIO.VIEW_LAYERS, overlayLayers: FILRODENSWMB.STUDIO.OVERLAY_LAYERS, detailLevels: FILRODENSWMB.DETAIL.LEVELS, symbolSizes: FILRODENSWMB.SYMBOLS.SIZES.map((size) => ({ value: String(size), percent: Math.round(size * 100) })), thematic: ThematicView.menuContext() });
    return document.body;
}

/** A view state with everything shown, changed by `changes`. */
function viewState({ layers = {}, items = {}, ...changes } = {}) {
    return {
        viewFilters: { all: true, gm: true, none: false },
        layers: { ...Object.fromEntries(VIEW_LAYERS.map((id) => [id, true])), ...layers },
        grid: true,
        terrainGroups: TERRAIN_GROUPS.map((group) => ({ id: group.id, items: group.items.map((item) => ({ key: item.key, on: items[item.key] ?? true })) })),
        threeD: false,
        detailLevel: 3,
        avoidOverlaps: true,
        contentGroups: [
            { id: "regions", state: "on", rows: [] },
            { id: "labels", state: "on", rows: [] },
        ],
        ...changes,
    };
}

const label = (shown, total) => `Layers: ${shown} of ${total} shown`;
const detailLabel = (level) => `Detail: ${level}`;

test("every control in both forms reads the state it switches", () => {
    const root = drawMap();
    syncMapControls(root, viewState({ grid: false, layers: { cartography: false }, items: { relief: false } }), label, detailLabel);

    const wide = root.querySelector(".fwmb-map-controls-wide");
    const menu = root.querySelector('.fwmb-layer-group[data-layer-group="layers"] .fwmb-layer-menu');

    // Buttons read aria-pressed, menu rows aria-checked
    assert.equal(root.querySelector('.fwmb-map-btn[data-action="toggleGrid"]').getAttribute("aria-pressed"), "false");
    assert.equal(menu.querySelector('[data-action="toggleGrid"]').getAttribute("aria-checked"), "false");
    assert.equal(wide.querySelector('[data-layer="cartography"]').getAttribute("aria-pressed"), "false");
    assert.equal(menu.querySelector('[data-layer="cartography"]').getAttribute("aria-checked"), "false");
    assert.equal(wide.querySelector('[data-layer="infrastructure"]').getAttribute("aria-pressed"), "true");
    assert.equal(root.querySelector('[data-action="toggleViewFilter"][data-filter="none"]').getAttribute("aria-pressed"), "false");

    // A group partly on: its wide button is not pressed and shows the dot; its rows read mixed
    const terrainButton = wide.querySelector('.fwmb-layer-group[data-layer-group="terrain"] > [data-action="toggleLayerMenu"]');
    assert.equal(terrainButton.getAttribute("aria-pressed"), "false");
    assert.ok(terrainButton.classList.contains("fwmb-is-partial"));
    for (const row of root.querySelectorAll('[data-layer-group="terrain"][data-terrain-layer="all"]')) assert.equal(row.getAttribute("aria-checked"), "mixed");
    assert.equal(menu.querySelector('[data-terrain-layer="relief"]').getAttribute("aria-checked"), "false");
    assert.equal(menu.querySelector('[data-terrain-layer="water"]').getAttribute("aria-checked"), "true");

    // The Layers button counts every listed switch, and shows the dot while any is off
    const layersButton = root.querySelector('.fwmb-layer-group[data-layer-group="layers"] > [data-action="toggleLayerMenu"]');
    assert.equal(layersButton.getAttribute("aria-label"), "Layers: 9 of 12 shown");
    assert.equal(layersButton.dataset.tooltip, "Layers: 9 of 12 shown");
    assert.ok(layersButton.classList.contains("fwmb-is-partial"));
});

test("a state with everything on reads pressed throughout, with no dot", () => {
    const root = drawMap();
    syncMapControls(root, viewState(), label, detailLabel);
    // Detail and the thematic layers are choices, not layers switched on and off
    for (const button of root.querySelectorAll('.fwmb-layer-group:not([data-layer-group="detail"]):not([data-layer-group="thematic"]) > .fwmb-map-btn[data-action="toggleLayerMenu"]')) {
        assert.equal(button.getAttribute("aria-pressed"), "true");
        assert.equal(button.classList.contains("fwmb-is-partial"), false);
    }
    assert.deepEqual(layersShown(viewState()), { shown: 12, total: 12 });
});

test("the Labels and Regions menus list their rows in both forms, marked, with the group's state on its button", () => {
    const root = drawMap();
    const regions = {
        id: "regions",
        state: "partial",
        rows: [
            { kind: "set", key: "political", label: "Political", on: false, mixed: true },
            { kind: "level", key: "realms", label: "Realms", on: true, sub: true },
            { kind: "level", key: "duchies", label: "Duchies", on: false, sub: true },
        ],
    };
    const labels = { id: "labels", state: "on", rows: [{ kind: "style", key: "label-style-realm", label: "Realm <b>", on: true }] };
    syncMapControls(root, viewState({ contentGroups: [regions, labels] }), label, detailLabel);
    const wideMenu = root.querySelector('.fwmb-map-controls-wide .fwmb-layer-group[data-layer-group="regions"] .fwmb-layer-menu');
    const rows = [...wideMenu.querySelectorAll('[data-action="toggleContentRow"]')];
    assert.deepEqual(rows.map((row) => [row.dataset.contentKind, row.textContent.trim(), row.getAttribute("aria-checked")]), [
        ["all", "FILRODENSWMB.UI.LayerAll", "mixed"],
        ["set", "Political", "mixed"],
        ["level", "Realms", "true"],
        ["level", "Duchies", "false"],
    ]);
    assert.equal(rows[2].className, "fwmb-layer-menu-sub", "levels sit indented under their set");
    const button = root.querySelector('.fwmb-map-controls-wide .fwmb-layer-group[data-layer-group="regions"] > [data-action="toggleLayerMenu"]');
    assert.equal(button.getAttribute("aria-pressed"), "false");
    assert.ok(button.classList.contains("fwmb-is-partial"));
    const folded = root.querySelector('.fwmb-layer-group[data-layer-group="layers"] .fwmb-layer-menu');
    assert.equal(folded.querySelector('[data-content-group="regions"][data-content-row="duchies"]').className, "fwmb-layer-menu-sub2", "one step further in the folded menu");
    assert.equal(folded.querySelector('[data-content-group="labels"][data-content-row="label-style-realm"]').textContent.trim(), "Realm <b>", "a style's name is text, never markup");
    // Written again only when the rows change
    const first = wideMenu.querySelector('[data-content-row="realms"]');
    syncMapControls(root, viewState({ contentGroups: [{ ...regions, rows: regions.rows.map((row) => ({ ...row, on: true, mixed: false })), state: "on" }, labels] }), label, detailLabel);
    assert.equal(wideMenu.querySelector('[data-content-row="realms"]'), first);
    assert.equal(first.getAttribute("aria-checked"), "true");
});

test("the Detail menu marks the map's one detail level and names it on its button", () => {
    const root = drawMap();
    syncMapControls(root, viewState({ detailLevel: 1, avoidOverlaps: false }), label, detailLabel);
    assert.equal(root.querySelector('[data-action="toggleLabelOverlaps"]').getAttribute("aria-checked"), "false", "Avoid overlaps is a switch in the same menu");
    const rows = [...root.querySelectorAll('[data-action="setDetailLevel"]')];
    assert.deepEqual(rows.map((row) => row.dataset.detailLevel), ["3", "2", "1", "0"], "most detailed first");
    assert.deepEqual(rows.map((row) => row.getAttribute("aria-checked")), ["false", "false", "true", "false"]);
    assert.ok(rows.every((row) => row.getAttribute("role") === "menuitemradio"));
    const button = root.querySelector('.fwmb-layer-group[data-layer-group="detail"] > [data-action="toggleLayerMenu"]');
    assert.equal(button.getAttribute("aria-label"), "Detail: 1");
    assert.equal(root.querySelector(".fwmb-map-controls-wide [data-action=\"setDetailLevel\"]"), null, "not folded into the Layers menu");
});

test("the Detail menu marks the map's symbol size, naming Auto with its value", () => {
    const root = drawMap();
    const choices = [{ value: "auto", percent: 163, auto: true, selected: true }, ...FILRODENSWMB.SYMBOLS.SIZES.map((size) => ({ value: String(size), percent: Math.round(size * 100), auto: false, selected: false }))];
    syncMapControls(root, viewState({ symbolSizes: choices }), label, detailLabel, (percent) => `Auto (${percent}%)`);
    const rows = [...root.querySelectorAll('[data-action="setSymbolSize"]')];
    assert.deepEqual(rows.map((row) => row.dataset.symbolSize), ["auto", ...FILRODENSWMB.SYMBOLS.SIZES.map(String)]);
    assert.deepEqual(rows.map((row) => row.getAttribute("aria-checked")), ["true", ...FILRODENSWMB.SYMBOLS.SIZES.map(() => "false")]);
    assert.equal(rows[0].querySelector("[data-symbol-auto]").textContent, "Auto (163%)");
    choices[0].selected = false;
    choices[2].selected = true;
    syncMapControls(root, viewState({ symbolSizes: choices }), label, detailLabel);
    assert.equal(rows[2].getAttribute("aria-checked"), "true");
    assert.equal(rows[0].getAttribute("aria-checked"), "false");
});

test("the thematic layers' menu, beside Detail, marks the layer drawn, the rows the run cannot show, its note and its opacity", () => {
    const root = drawMap();
    const rows = (id) => [...root.querySelectorAll(`[data-action="setThematicFill"][data-thematic-layer="${id}"]`)];
    const button = root.querySelector('.fwmb-layer-group[data-layer-group="thematic"] > [data-action="toggleLayerMenu"]');
    assert.equal(rows("population").length, 1, "one menu, shown at every width");
    assert.ok(button.closest(".fwmb-map-control-group").querySelector('[data-layer-group="detail"]'), "in Detail's group");
    assert.equal(button.closest(".fwmb-map-controls-wide, .fwmb-map-controls-folded"), null, "not folded away");

    syncMapControls(root, viewState({ thematic: { fill: null, rows: [{ id: "population", disabled: true, title: "Generate again" }], opacity: 0.7, note: "Generate this map to see these layers." } }), label, detailLabel);
    for (const row of rows("none")) assert.equal(row.getAttribute("aria-checked"), "true");
    for (const row of rows("population")) {
        assert.equal(row.getAttribute("aria-checked"), "false");
        assert.equal(row.getAttribute("aria-disabled"), "true");
        assert.equal(row.dataset.tooltip, "Generate again");
    }
    for (const note of root.querySelectorAll("[data-thematic-note]")) {
        assert.equal(note.textContent, "Generate this map to see these layers.");
        assert.equal(note.classList.contains("fwmb-hidden"), false);
    }
    for (const input of root.querySelectorAll("[data-thematic-opacity]")) assert.equal(input.disabled, true, "no layer drawn, nothing to fade");
    assert.equal(button.getAttribute("aria-pressed"), "false");

    syncMapControls(root, viewState({ thematic: { fill: "population", rows: [{ id: "population", disabled: false, title: "People" }], opacity: 0.4, note: "" } }), label, detailLabel);
    for (const row of rows("population")) assert.equal(row.getAttribute("aria-checked"), "true");
    for (const row of rows("none")) assert.equal(row.getAttribute("aria-checked"), "false");
    for (const note of root.querySelectorAll("[data-thematic-note]")) assert.equal(note.classList.contains("fwmb-hidden"), true);
    for (const input of root.querySelectorAll("[data-thematic-opacity]")) {
        assert.equal(input.disabled, false);
        assert.equal(input.value, "0.4");
        assert.equal(input.closest(".fwmb-range").querySelector("output").value, "0.4");
    }
    assert.equal(button.getAttribute("aria-pressed"), "true");

    // A line layer alone presses the button too, and its row is ticked
    syncMapControls(root, viewState({ thematic: { fill: null, rows: [], lines: [{ id: "trade", on: true, disabled: false, title: "Trade" }], opacity: 0.7, note: "" } }), label, detailLabel);
    const trade = [...root.querySelectorAll('[data-action="toggleThematicLine"][data-thematic-line="trade"]')];
    assert.equal(trade.length, 1);
    for (const element of trade) assert.equal(element.getAttribute("aria-checked"), "true");
    assert.equal(button.getAttribute("aria-pressed"), "true");
});

test("the Layers menu lists every wide toggle, in the same order", () => {
    const root = drawMap();
    const key = (element) => [element.dataset.action, element.dataset.layer ?? "", element.dataset.layerGroup ?? "", element.dataset.terrainLayer ?? ""].join(":");
    const wide = [...root.querySelectorAll(".fwmb-map-controls-wide [data-action]")].filter((element) => element.dataset.action !== "toggleLayerMenu");
    const menu = [...root.querySelectorAll('.fwmb-layer-group[data-layer-group="layers"] .fwmb-layer-menu [data-action]')];
    assert.deepEqual(menu.map(key), wide.map(key));
});

// --- Every change to a view goes through #syncMapControls ------------------------------------

const SOURCE = readFileSync(join(ROOT, "src/applications/MapStudio.js"), "utf8");

/** The bodies of MapStudio's methods, by name (a method starts at a line indented four spaces). */
function methodBodies(source) {
    const bodies = new Map();
    const starts = [...source.matchAll(/^ {4}(?:static )?(?:async )?([#\w]+)\s*\([^)]*\)\s*\{\s*$/gm)];
    for (const [index, match] of starts.entries()) {
        const end = starts[index + 1]?.index ?? source.length;
        bodies.set(match[1], source.slice(match.index, end));
    }
    return bodies;
}

/** What changes a view: the state the map controls show, written. */
const VIEW_CHANGES = [/this\.uiState\s*=(?!=)/, /this\.#layerVisibility\[[^\]]+\]\s*=(?!=)/, /this\.viewFilters\[[^\]]+\]\s*=(?!=)/, /this\.uiState\.gridVisible\s*=(?!=)/, /this\.#terrainLayers\s*=(?!=)/, /this\.scene3D\s*=(?!=)/, /this\.uiState\.detailLevel\s*=(?!=)/, /this\.uiState\.avoidLabelOverlaps\s*=(?!=)/, /this\.uiState\.symbolSize\s*=(?!=)/, /this\.uiState\.thematic\s*=(?!=)/];

test("every method that changes a view calls #syncMapControls", () => {
    const bodies = methodBodies(SOURCE);
    assert.ok(bodies.size > 100, `found ${bodies.size} methods`);
    const changing = [...bodies].filter(([, body]) => VIEW_CHANGES.some((pattern) => pattern.test(body)));
    assert.ok(changing.length >= 8, `found ${changing.length} methods that change a view`);
    const silent = changing
        .filter(([name, body]) => name !== "destroy" && name !== "constructor" && !body.includes("this.#syncMapControls()") && !body.includes("this.#setTerrainLayers("))
        .map(([name]) => name);
    assert.deepEqual(silent, [], "these change a view without updating the map controls");
});

test("a grid type or size change turns the grid on, and the map controls follow", () => {
    const body = methodBodies(SOURCE).get("#updateGridSettings");
    assert.match(body, /this\.uiState\.gridVisible = true/);
    assert.match(body, /this\.#syncMapControls\(\)/);
});

test("loading or starting a map, and switching tool, bring the map controls up to date", () => {
    const bodies = methodBodies(SOURCE);
    // A loaded map's grid setting and every terrain layer, through #setTerrainLayers
    assert.match(bodies.get("#ingestMapPayload"), /gridVisible[\s\S]*detailLevel[\s\S]*#setTerrainLayers\(/);
    assert.match(bodies.get("#setTerrainLayers"), /this\.#syncMapControls\(\)/);
    // A tool that shows its own layer when picked
    assert.match(bodies.get("#ensureToolLayerVisible"), /this\.#syncMapControls\(\)/);
});
