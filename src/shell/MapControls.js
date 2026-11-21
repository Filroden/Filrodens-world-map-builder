import { FILRODENSWMB } from "../config.js";
import { setOn } from "./aria.js";
import { RangeDisplay } from "../kernel/util/RangeDisplay.js";

/**
 * The map controls (bottom end of the canvas) show what the map is showing, and what an export
 * will contain. The map region is drawn once, so its controls are never redrawn from a template
 * after that: every change to a view is written onto them here, from the studio's state, by
 * MapStudio#syncMapControls. Nothing else sets their state, so a control can never disagree with
 * the view it switches (a grid size change that turns the grid on shows on Map aids' Grid row).
 *
 * Since S0 step 6b they are three labelled menus (the CanvasOverlays card): **Visibility**,
 * **Show** (a row a part of the map, those with parts opening a submenu, and Detail) and
 * **Thematic views**. A Show row with parts reads its submenu's state in `data-state` (on, partial,
 * off), drawn as its tick, with the partial dot; a menu's button shows the dot while some of what
 * it holds is off.
 */

/** The layers switched on and off one by one with the toggleLayer action, in the controls' order. */
export const VIEW_LAYERS = Object.freeze([...FILRODENSWMB.STUDIO.VIEW_LAYERS, ...FILRODENSWMB.STUDIO.OVERLAY_LAYERS].filter((layer) => layer.action !== "toggleGrid").map((layer) => layer.id));

/** The map aids (Show's Map aids row): drawn over the map to work with, never the map's content. */
export const MAP_AIDS = Object.freeze(FILRODENSWMB.STUDIO.OVERLAY_LAYERS.map((layer) => layer.id ?? "grid"));

/** Whether all, some or none of a list of switches are on. */
export function groupState(values) {
    const on = values.filter(Boolean).length;
    if (on === values.length) return "on";
    return on === 0 ? "off" : "partial";
}

const ARIA_CHECKED = { on: "true", partial: "mixed", off: "false" };

/**
 * Each of Show's rows, as on, partial or off: Terrain and Biomes from their layers, Regions and
 * Labels from their rows, Places and routes and Cartography as they are, and Map aids from its
 * three. Detail is a choice, not a part, so it has none.
 *
 * @param {object} state - As for syncMapControls.
 * @returns {Object<string, string>} Row id → "on", "partial" or "off".
 */
export function showStates(state) {
    const rows = {};
    for (const group of state.terrainGroups) rows[group.id] = groupState(group.items.map((item) => item.on));
    for (const layer of FILRODENSWMB.STUDIO.VIEW_LAYERS) {
        const content = (state.contentGroups ?? []).find((group) => group.id === layer.id);
        rows[layer.id] = content ? content.state : state.layers[layer.id] ? "on" : "off";
    }
    rows.aids = groupState(MAP_AIDS.map((id) => (id === "grid" ? state.grid : state.layers[id])));
    return rows;
}

/**
 * Whether a menu's button shows the partial dot: Visibility while Everyone or GM only is off
 * (Hidden is off by default, so its being off is not news); Show while any part of the map's
 * content is not wholly shown (the map aids are off by default, so they do not count).
 *
 * @param {object} state - As for syncMapControls.
 * @returns {{visibility: boolean, show: boolean}}
 */
export function menuDots(state) {
    const rows = showStates(state);
    return {
        visibility: !state.viewFilters.all || !state.viewFilters.gm,
        show: Object.entries(rows).some(([id, value]) => id !== "aids" && value !== "on"),
    };
}

/**
 * Writes the studio's view state onto every map control in `root`.
 *
 * @param {ParentNode|null} root - The studio (or any element holding the map controls).
 * @param {object} state
 * @param {{all: boolean, gm: boolean, none: boolean}} state.viewFilters - The view filters.
 * @param {Object<string, boolean>} state.layers - Each of VIEW_LAYERS, shown or not.
 * @param {boolean} state.grid - Whether the grid is shown.
 * @param {{id: string, items: {key: string, on: boolean}[]}[]} state.terrainGroups - The terrain
 *   layer groups (Terrain, Biomes) and their layers.
 * @param {boolean} state.threeD - Whether the 3D view is showing.
 * @param {{id: string, state: string, rows: object[]}[]} [state.contentGroups] - The Labels and
 *   Regions submenus' rows (see ContentRows).
 * @param {number} state.detailLevel - The map's detail level (see DetailLevel).
 * @param {boolean} state.avoidOverlaps - Whether names avoid each other (see LabelLayout).
 * @param {{value: string, percent: number, auto: boolean, selected: boolean}[]} [state.symbolSizes] - The
 *   symbol size rows (see SymbolScale.choices), Auto first.
 * @param {{fill: string|null, rows: {id: string, disabled: boolean, title: string}[], opacity: number, note: string}} [state.thematic] - The
 *   thematic views' menu (see ThematicView.controlState).
 * @param {(level: number) => string} detailName - The name of a detail level, at Show's Detail row's end.
 * @param {(percent: number) => string} [autoLabel] - The Auto row's name for its value.
 */
export function syncMapControls(root, state, detailName, autoLabel = (percent) => `${percent}%`) {
    if (!root) return;
    const each = (selector, apply) => root.querySelectorAll(selector).forEach(apply);

    each('[data-action="toggleViewFilter"]', (element) => setOn(element, state.viewFilters[element.dataset.filter]));
    each('[data-action="toggleLayer"]', (element) => setOn(element, state.layers[element.dataset.layer]));
    each('[data-action="toggleGrid"]', (element) => setOn(element, state.grid));
    each('[data-action="threeDView"]', (element) => setOn(element, state.threeD));

    for (const group of state.contentGroups ?? []) syncContentGroup(root, group);
    if (state.thematic) syncThematic(root, state.thematic);

    // Detail: one level chosen, named at the end of Show's Detail row
    each('[data-action="setDetailLevel"]', (row) => row.setAttribute("aria-checked", String(Number(row.dataset.detailLevel) === state.detailLevel)));
    each("[data-detail-name]", (element) => (element.textContent = detailName(state.detailLevel)));
    each('[data-action="toggleLabelOverlaps"]', (row) => setOn(row, state.avoidOverlaps));
    for (const choice of state.symbolSizes ?? []) {
        each(`[data-action="setSymbolSize"][data-symbol-size="${choice.value}"]`, (row) => {
            row.setAttribute("aria-checked", String(choice.selected));
            const name = choice.auto ? row.querySelector("[data-symbol-auto]") : null;
            if (name) name.textContent = autoLabel(choice.percent);
        });
    }

    for (const group of state.terrainGroups) {
        const status = groupState(group.items.map((item) => item.on));
        each(`[data-action="toggleTerrainLayer"][data-layer-group="${group.id}"][data-terrain-layer="all"]`, (row) => row.setAttribute("aria-checked", ARIA_CHECKED[status]));
        for (const item of group.items) {
            each(`[data-action="toggleTerrainLayer"][data-layer-group="${group.id}"][data-terrain-layer="${item.key}"]`, (row) => setOn(row, item.on));
        }
    }

    // Show's rows with parts: their tick and dot from their submenus
    for (const [id, value] of Object.entries(showStates(state))) {
        each(`[data-action="openShowPart"][data-show-part="${id}"]`, (row) => {
            row.dataset.state = value;
            row.classList.toggle("fwmb-is-partial", value === "partial");
        });
    }

    // The menus' buttons: the partial dot while some of what they hold is off
    const dots = menuDots(state);
    each('.fwmb-layer-group[data-layer-group="visibility"] > [data-action="toggleLayerMenu"]', (button) => button.classList.toggle("fwmb-is-partial", dots.visibility));
    each('.fwmb-layer-group[data-layer-group="show"] > [data-action="toggleLayerMenu"]', (button) => button.classList.toggle("fwmb-is-partial", dots.show));
}

/**
 * The thematic views' menu: the colour view chosen
 * (None when none is drawn), the line views shown, the views the map's run cannot show marked
 * disabled with the reason as their tooltip, the note at its head, the opacity slider (idle while
 * no colour view is drawn), and the view shown named on the button.
 *
 * @param {ParentNode} root
 * @param {{fill: string|null, rows: {id: string, disabled: boolean, title: string}[], lines?: {id: string, on: boolean, disabled: boolean, title: string}[], opacity: number, note: string}} thematic
 */
function syncThematic(root, thematic) {
    const rows = new Map(thematic.rows.map((row) => [row.id, row]));
    root.querySelectorAll('[data-action="setThematicFill"]').forEach((element) => {
        const id = element.dataset.thematicLayer;
        element.setAttribute("aria-checked", String(id === (thematic.fill ?? "none")));
        const row = rows.get(id);
        if (!row) return;
        element.setAttribute("aria-disabled", String(row.disabled));
        element.dataset.tooltip = row.title;
    });
    root.querySelectorAll("[data-thematic-note]").forEach((element) => {
        element.textContent = thematic.note;
        element.classList.toggle("fwmb-hidden", !thematic.note);
    });
    root.querySelectorAll("[data-thematic-opacity]").forEach((input) => {
        input.value = String(thematic.opacity);
        input.disabled = !thematic.fill && !thematic.bands;
        RangeDisplay.sync(input);
    });
    for (const line of thematic.lines ?? []) {
        root.querySelectorAll(`[data-action="toggleThematicLine"][data-thematic-line="${line.id}"]`).forEach((element) => {
            element.setAttribute("aria-checked", String(line.on));
            element.setAttribute("aria-disabled", String(line.disabled));
            element.dataset.tooltip = line.title;
        });
    }
    // The view shown names the button (the CanvasOverlays card: "its name as the count"): the
    // colour view, else the line views shown
    const names = [];
    if (thematic.fill) names.push(nameOf(root.querySelector(`[data-action="setThematicFill"][data-thematic-layer="${thematic.fill}"]`)));
    else for (const line of thematic.lines ?? []) if (line.on) names.push(nameOf(root.querySelector(`[data-action="toggleThematicLine"][data-thematic-line="${line.id}"]`)));
    const count = names.filter(Boolean).join(", ");
    root.querySelectorAll("[data-thematic-count]").forEach((element) => {
        element.textContent = count;
        element.classList.toggle("fwmb-hidden", !count);
    });
}

/** A menu row's name, as drawn. */
function nameOf(row) {
    return row?.textContent.trim() ?? "";
}

/**
 * Whether the map controls must fold, their three menus to icon buttons: when the whole row,
 * labelled, is wider than the room the canvas leaves it beside the hint at its narrowest.
 *
 * @param {number} wideWidth - The width of the controls with every toggle shown.
 * @param {number} room - The canvas width less the hint's narrowest width and the margins around and between them.
 * @returns {boolean}
 */
export function mustFoldMapControls(wideWidth, room) {
    return wideWidth > room;
}

/**
 * One of the Labels and Regions submenus (see ContentRows): its rows written when they change
 * (styles and tiers come and go with the map), then each marked, the All row with them.
 *
 * @param {ParentNode} root
 * @param {{id: string, state: string, rows: {kind: string, key: string, label: string, on: boolean, mixed?: boolean, sub?: boolean, separator?: boolean}[]}} group
 */
function syncContentGroup(root, group) {
    const signature = group.rows.map((row) => `${row.kind}:${row.key}:${row.label}`).join("|");
    for (const container of root.querySelectorAll(`[data-content-rows="${group.id}"]`)) {
        if (container.dataset.signature !== signature) writeContentRows(container, group);
        container.dataset.signature = signature;
    }
    for (const row of group.rows) {
        root.querySelectorAll(`[data-action="toggleContentRow"][data-content-group="${group.id}"][data-content-kind="${row.kind}"]`).forEach((element) => {
            if (element.dataset.contentRow === row.key) element.setAttribute("aria-checked", row.mixed ? "mixed" : String(row.on));
        });
    }
    root.querySelectorAll(`[data-action="toggleContentRow"][data-content-group="${group.id}"][data-content-kind="all"]`).forEach((element) => element.setAttribute("aria-checked", ARIA_CHECKED[group.state]));
}

/**
 * A submenu's rows as buttons (data-content-indent indents them further); a row marked separator
 * (Regions' Fills) has a rule above it.
 */
function writeContentRows(container, group) {
    const indent = Number(container.dataset.contentIndent ?? 0);
    const doc = container.ownerDocument;
    const rows = group.rows.map((row) => {
        const button = doc.createElement("button");
        button.type = "button";
        button.setAttribute("role", "menuitemcheckbox");
        button.setAttribute("aria-checked", "false");
        Object.assign(button.dataset, { action: "toggleContentRow", contentGroup: group.id, contentKind: row.kind, contentRow: row.key });
        const depth = indent + (row.sub ? 1 : 0);
        if (depth) button.className = depth > 1 ? "fwmb-layer-menu-sub2" : "fwmb-layer-menu-sub";
        const check = doc.createElement("span");
        check.className = "fwmb-layer-check";
        check.setAttribute("aria-hidden", "true");
        button.append(check, doc.createTextNode(row.label));
        if (!row.separator) return [button];
        const rule = doc.createElement("div");
        rule.className = "fwmb-layer-menu-sep";
        rule.setAttribute("role", "separator");
        return [rule, button];
    });
    container.replaceChildren(...rows.flat());
}
