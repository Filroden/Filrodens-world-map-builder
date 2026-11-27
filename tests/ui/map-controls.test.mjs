// The map controls show what the map shows (src/shell/MapControls.js), and nothing changes a view
// without telling them (MapStudio#syncMapControls).
//
// The controls are drawn from the real map.hbs, then marked from a view state as the studio does:
// the three menus (S0 step 6b), Show's rows and their submenus. The second half reads MapStudio's own
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
const { menuDots, showStates, syncMapControls, VIEW_LAYERS } = await import("../../src/shell/MapControls.js");
const { ThematicView } = await import("../../src/studios/world/app/ThematicView.js");

const TERRAIN_GROUPS = [
    { id: "terrain", icon: "elevation", tooltip: "LayerTerrain", items: [{ key: "elevation", label: "LayerElevation" }, { key: "relief", label: "LayerRelief" }, { key: "water", label: "LayerWater" }] },
    { id: "biomes", icon: "forest", tooltip: "LayerBiomes", items: [{ key: "landBiomes", label: "LayerLandBiomes" }, { key: "seaBiomes", label: "LayerSeaBiomes" }] },
];

/** The map region as the studio draws it, in a fresh document body. */
function drawMap() {
    const handlebars = Handlebars.create();
    handlebars.registerHelper("localize", (key) => key);
    handlebars.registerHelper("eq", (a, b) => a === b);
    handlebars.registerPartial("modules/filrodens-world-map-builder/templates/shell/parts/shared-range.hbs", readFileSync(join(ROOT, "templates/shell/parts/shared-range.hbs"), "utf8"));
    handlebars.registerPartial("modules/filrodens-world-map-builder/templates/world/parts/thematic-menu.hbs", readFileSync(join(ROOT, "templates/world/parts/thematic-menu.hbs"), "utf8"));
    const template = handlebars.compile(readFileSync(join(ROOT, "templates/world/map.hbs"), "utf8"));
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

const detailName = (level) => `Level ${level}`;

/** One of Show's rows, and its submenu. */
const showRow = (root, id) => root.querySelector(`[data-action="openShowPart"][data-show-part="${id}"]`);
const showPanel = (root, id) => root.querySelector(`[data-show-panel="${id}"]`);
const menuButton = (root, id) => root.querySelector(`.fwmb-layer-group[data-layer-group="${id}"] > [data-action="toggleLayerMenu"]`);

test("the map controls are three labelled menus, Visibility, Show and Thematic views, then the zoom (S0 step 6b), with a settlement map's own Thematic views beside them (L-surface step 3)", () => {
    const root = drawMap();
    const controls = root.querySelector(".fwmb-map-controls");
    const menus = [...controls.querySelectorAll(".fwmb-map-menu")];
    // The settlement map's group is shown only while one is open, in the three's place (the stylesheet's fwmb-is-settlement)
    assert.deepEqual(menus.map((button) => button.closest(".fwmb-layer-group").dataset.layerGroup), ["visibility", "show", "thematic", "settlementViews"]);
    assert.deepEqual(menus.map((button) => button.querySelector(".fwmb-map-menu-label").textContent), ["FILRODENSWMB.UI.Visibility", "FILRODENSWMB.UI.ShowMenu", "FILRODENSWMB.UI.ThematicLayers", "FILRODENSWMB.UI.SettlementViews"]);
    assert.ok(menus.every((button) => button.getAttribute("aria-haspopup") === "menu" && button.getAttribute("aria-label")), "named while folded too");
    assert.deepEqual([...controls.querySelectorAll(".fwmb-map-btn")].map((button) => button.dataset.action), ["zoomOut", "resetZoom", "zoomIn"], "no separate toggles left");
    assert.equal(controls.querySelector(".fwmb-map-controls-wide, .fwmb-map-controls-folded, [data-layer-group=layers]"), null, "v4's Layers menu is gone");
});

test("Show holds a row for each part of the map in today's order, Detail last, and Show the surface disabled", () => {
    const root = drawMap();
    const menu = root.querySelector('.fwmb-layer-group[data-layer-group="show"] > .fwmb-layer-menu:not(.fwmb-layer-submenu)');
    const rows = [...menu.querySelectorAll(":scope > button")].map((row) => row.dataset.showPart ?? row.dataset.layer ?? (row.getAttribute("aria-disabled") === "true" ? "surface" : "?"));
    assert.deepEqual(rows, ["terrain", "biomes", "infrastructure", "regions", "labels", "cartography", "aids", "detail", "surface"]);
    for (const id of ["terrain", "biomes", "regions", "labels", "aids", "detail"]) {
        assert.equal(showRow(root, id).getAttribute("aria-haspopup"), "menu", `${id} opens a submenu`);
        assert.ok(showPanel(root, id), `${id}'s submenu is drawn`);
    }
    assert.deepEqual([...showPanel(root, "aids").querySelectorAll("[data-action]")].map((row) => row.dataset.layer ?? row.dataset.action), ["closeShowPart", "contours", "toggleGrid", "reference"], "Back first (shown only when the submenu takes Show's place), then the aids");
    const surface = menu.querySelector('[aria-disabled="true"]');
    assert.match(surface.dataset.tooltip, /NotBuiltYet/);
});

test("every row reads the state it switches, and each Show row its submenu's, with the partial dot", () => {
    const root = drawMap();
    syncMapControls(root, viewState({ grid: false, layers: { cartography: false }, items: { relief: false } }), detailName);

    assert.equal(showPanel(root, "aids").querySelector('[data-action="toggleGrid"]').getAttribute("aria-checked"), "false");
    assert.equal(root.querySelector('[data-action="toggleLayer"][data-layer="cartography"]').getAttribute("aria-checked"), "false");
    assert.equal(root.querySelector('[data-action="toggleLayer"][data-layer="infrastructure"]').getAttribute("aria-checked"), "true");
    assert.equal(root.querySelector('[data-action="toggleViewFilter"][data-filter="none"]').getAttribute("aria-checked"), "false");

    // Terrain partly on: its row reads partial, with the dot; its All row mixed
    assert.equal(showRow(root, "terrain").dataset.state, "partial");
    assert.ok(showRow(root, "terrain").classList.contains("fwmb-is-partial"));
    assert.equal(showPanel(root, "terrain").querySelector('[data-terrain-layer="all"]').getAttribute("aria-checked"), "mixed");
    assert.equal(showPanel(root, "terrain").querySelector('[data-terrain-layer="relief"]').getAttribute("aria-checked"), "false");
    assert.equal(showRow(root, "biomes").dataset.state, "on");
    // Map aids: contours and reference on, the grid off
    assert.equal(showRow(root, "aids").dataset.state, "partial");
    // Show's button: the dot, since Terrain and Cartography are not wholly shown
    assert.ok(menuButton(root, "show").classList.contains("fwmb-is-partial"));
    assert.equal(menuButton(root, "visibility").classList.contains("fwmb-is-partial"), false, "Hidden off is the default, not news");
    assert.deepEqual(showStates(viewState({ grid: false, layers: { cartography: false }, items: { relief: false } })), { terrain: "partial", biomes: "on", infrastructure: "on", regions: "on", labels: "on", cartography: "off", aids: "partial" });
});

test("the menus' dots: Visibility while Everyone or GM only is off, Show while the content is not wholly shown (the map aids aside)", () => {
    assert.deepEqual(menuDots(viewState()), { visibility: false, show: false });
    assert.deepEqual(menuDots(viewState({ grid: false, layers: { contours: false, reference: false } })), { visibility: false, show: false }, "map aids off are the default");
    assert.deepEqual(menuDots(viewState({ viewFilters: { all: false, gm: true, none: true } })), { visibility: true, show: false });
    assert.deepEqual(menuDots(viewState({ contentGroups: [{ id: "regions", state: "off", rows: [] }, { id: "labels", state: "on", rows: [] }] })), { visibility: false, show: true });
    const root = drawMap();
    syncMapControls(root, viewState({ viewFilters: { all: true, gm: false, none: false } }), detailName);
    assert.ok(menuButton(root, "visibility").classList.contains("fwmb-is-partial"));
    assert.equal(menuButton(root, "show").classList.contains("fwmb-is-partial"), false);
});

test("the Labels and Regions submenus list their rows, marked, with the part's state on its Show row", () => {
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
    syncMapControls(root, viewState({ contentGroups: [regions, labels] }), detailName);
    const panel = showPanel(root, "regions");
    const rows = [...panel.querySelectorAll('[data-action="toggleContentRow"]')];
    assert.deepEqual(rows.map((row) => [row.dataset.contentKind, row.textContent.trim(), row.getAttribute("aria-checked")]), [
        ["all", "FILRODENSWMB.UI.LayerAll", "mixed"],
        ["set", "Political", "mixed"],
        ["level", "Realms", "true"],
        ["level", "Duchies", "false"],
    ]);
    assert.equal(rows[2].className, "fwmb-layer-menu-sub", "tiers sit indented under their set");
    assert.equal(showRow(root, "regions").dataset.state, "partial");
    assert.ok(showRow(root, "regions").classList.contains("fwmb-is-partial"));
    assert.equal(showPanel(root, "labels").querySelector('[data-content-row="label-style-realm"]').textContent.trim(), "Realm <b>", "a style's name is text, never markup");
    // Written again only when the rows change
    const first = panel.querySelector('[data-content-row="realms"]');
    syncMapControls(root, viewState({ contentGroups: [{ ...regions, rows: regions.rows.map((row) => ({ ...row, on: true, mixed: false })), state: "on" }, labels] }), detailName);
    assert.equal(panel.querySelector('[data-content-row="realms"]'), first);
    assert.equal(first.getAttribute("aria-checked"), "true");
    assert.equal(showRow(root, "regions").dataset.state, "on");
});

test("Detail, Show's last row, marks the map's one detail level and names it at the row's end", () => {
    const root = drawMap();
    syncMapControls(root, viewState({ detailLevel: 1, avoidOverlaps: false }), detailName);
    assert.equal(root.querySelector('[data-action="toggleLabelOverlaps"]').getAttribute("aria-checked"), "false", "Avoid overlaps is a switch in the same submenu");
    const rows = [...showPanel(root, "detail").querySelectorAll('[data-action="setDetailLevel"]')];
    assert.deepEqual(rows.map((row) => row.dataset.detailLevel), ["4", "3", "2", "1", "0"], "most detailed first");
    assert.deepEqual(rows.map((row) => row.getAttribute("aria-checked")), ["false", "false", "false", "true", "false"]);
    assert.ok(rows.every((row) => row.getAttribute("role") === "menuitemradio"));
    assert.equal(showRow(root, "detail").querySelector("[data-detail-name]").textContent, "Level 1");
});

test("Detail marks the map's symbol size, naming Auto with its value", () => {
    const root = drawMap();
    const choices = [{ value: "auto", percent: 163, auto: true, selected: true }, ...FILRODENSWMB.SYMBOLS.SIZES.map((size) => ({ value: String(size), percent: Math.round(size * 100), auto: false, selected: false }))];
    syncMapControls(root, viewState({ symbolSizes: choices }), detailName, (percent) => `Auto (${percent}%)`);
    const rows = [...root.querySelectorAll('[data-action="setSymbolSize"]')];
    assert.deepEqual(rows.map((row) => row.dataset.symbolSize), ["auto", ...FILRODENSWMB.SYMBOLS.SIZES.map(String)]);
    assert.deepEqual(rows.map((row) => row.getAttribute("aria-checked")), ["true", ...FILRODENSWMB.SYMBOLS.SIZES.map(() => "false")]);
    assert.equal(rows[0].querySelector("[data-symbol-auto]").textContent, "Auto (163%)");
    choices[0].selected = false;
    choices[2].selected = true;
    syncMapControls(root, viewState({ symbolSizes: choices }), detailName);
    assert.equal(rows[2].getAttribute("aria-checked"), "true");
    assert.equal(rows[0].getAttribute("aria-checked"), "false");
});

test("Thematic views marks the view drawn, the rows the run cannot show, its note and opacity, and names the view on its button", () => {
    const root = drawMap();
    const rows = (id) => [...root.querySelectorAll(`[data-action="setThematicFill"][data-thematic-layer="${id}"]`)];
    const count = root.querySelector("[data-thematic-count]");
    assert.equal(rows("population").length, 1, "one menu");

    syncMapControls(root, viewState({ thematic: { fill: null, rows: [{ id: "population", disabled: true, title: "Generate again" }], opacity: 0.7, note: "Generate this map to see these layers." } }), detailName);
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
    for (const input of root.querySelectorAll("[data-thematic-opacity]")) assert.equal(input.disabled, true, "no view drawn, nothing to fade");
    assert.ok(count.classList.contains("fwmb-hidden"), "no view, no name");

    syncMapControls(root, viewState({ thematic: { fill: "population", rows: [{ id: "population", disabled: false, title: "People" }], opacity: 0.4, note: "" } }), detailName);
    for (const row of rows("population")) assert.equal(row.getAttribute("aria-checked"), "true");
    for (const input of root.querySelectorAll("[data-thematic-opacity]")) {
        assert.equal(input.disabled, false);
        assert.equal(input.value, "0.4");
    }
    assert.equal(count.textContent, rows("population")[0].textContent.trim(), "the colour view's name on the button");
    assert.equal(count.classList.contains("fwmb-hidden"), false);

    // A line view alone names the button too, and its row is ticked
    syncMapControls(root, viewState({ thematic: { fill: null, rows: [], lines: [{ id: "trade", on: true, disabled: false, title: "Trade" }], opacity: 0.7, note: "" } }), detailName);
    const trade = root.querySelector('[data-action="toggleThematicLine"][data-thematic-line="trade"]');
    assert.equal(trade.getAttribute("aria-checked"), "true");
    assert.equal(count.textContent, trade.textContent.trim());
});

// --- Every change to a view goes through #syncMapControls ------------------------------------

const SOURCE = readFileSync(join(ROOT, "src/studios/world/app/MapStudio.js"), "utf8");

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
    assert.match(bodies.get("#ingestMapPayload"), /MapSerializer\.readFrame\([\s\S]*#setTerrainLayers\(/);
    // ...after the file's frame is read, which holds the grid setting and the detail level (RF2)
    const readFrame = readFileSync(join(ROOT, "src/studios/world/app/MapSerializer.js"), "utf8").match(/static readFrame\([\s\S]*?\n {4}\}\n/)[0];
    assert.match(readFrame, /gridVisible[\s\S]*detailLevel/);
    assert.match(bodies.get("#setTerrainLayers"), /this\.#syncMapControls\(\)/);
    // A tool that shows its own layer when picked
    assert.match(bodies.get("#ensureToolLayerVisible"), /this\.#syncMapControls\(\)/);
});
