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

const TERRAIN_GROUPS = [
    { id: "terrain", icon: "elevation", tooltip: "LayerTerrain", items: [{ key: "elevation", label: "LayerElevation" }, { key: "relief", label: "LayerRelief" }, { key: "water", label: "LayerWater" }] },
    { id: "biomes", icon: "forest", tooltip: "LayerBiomes", items: [{ key: "landBiomes", label: "LayerLandBiomes" }, { key: "seaBiomes", label: "LayerSeaBiomes" }] },
];

/** The map region as the studio draws it, in a fresh document body. */
function drawMap() {
    const handlebars = Handlebars.create();
    handlebars.registerHelper("localize", (key) => key);
    handlebars.registerHelper("eq", (a, b) => a === b);
    const template = handlebars.compile(readFileSync(join(ROOT, "templates/map.hbs"), "utf8"));
    document.body.innerHTML = template({ layerGroups: TERRAIN_GROUPS, viewLayers: FILRODENSWMB.STUDIO.VIEW_LAYERS, overlayLayers: FILRODENSWMB.STUDIO.OVERLAY_LAYERS });
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
        ...changes,
    };
}

const label = (shown, total) => `Layers: ${shown} of ${total} shown`;

test("every control in both forms reads the state it switches", () => {
    const root = drawMap();
    syncMapControls(root, viewState({ grid: false, layers: { labels: false }, items: { relief: false } }), label);

    const wide = root.querySelector(".fwmb-map-controls-wide");
    const menu = root.querySelector('.fwmb-layer-group[data-layer-group="layers"] .fwmb-layer-menu');

    // Buttons read aria-pressed, menu rows aria-checked
    assert.equal(root.querySelector('.fwmb-map-btn[data-action="toggleGrid"]').getAttribute("aria-pressed"), "false");
    assert.equal(menu.querySelector('[data-action="toggleGrid"]').getAttribute("aria-checked"), "false");
    assert.equal(wide.querySelector('[data-layer="labels"]').getAttribute("aria-pressed"), "false");
    assert.equal(menu.querySelector('[data-layer="labels"]').getAttribute("aria-checked"), "false");
    assert.equal(wide.querySelector('[data-layer="regions"]').getAttribute("aria-pressed"), "true");
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
    syncMapControls(root, viewState(), label);
    for (const button of root.querySelectorAll('.fwmb-map-btn[data-action="toggleLayerMenu"]')) {
        assert.equal(button.getAttribute("aria-pressed"), "true");
        assert.equal(button.classList.contains("fwmb-is-partial"), false);
    }
    assert.deepEqual(layersShown(viewState()), { shown: 12, total: 12 });
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
const VIEW_CHANGES = [/this\.uiState\s*=(?!=)/, /this\.#layerVisibility\[[^\]]+\]\s*=(?!=)/, /this\.viewFilters\[[^\]]+\]\s*=(?!=)/, /this\.uiState\.gridVisible\s*=(?!=)/, /this\.#terrainLayers\s*=(?!=)/, /this\.scene3D\s*=(?!=)/];

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
    assert.match(bodies.get("#ingestMapPayload"), /gridVisible[\s\S]*#setTerrainLayers\(/);
    assert.match(bodies.get("#setTerrainLayers"), /this\.#syncMapControls\(\)/);
    // A tool that shows its own layer when picked
    assert.match(bodies.get("#ensureToolLayerVisible"), /this\.#syncMapControls\(\)/);
});
