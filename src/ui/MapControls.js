import { FILRODENSWMB } from "../config.js";
import { setOn, setPressed } from "./aria.js";
import { RangeDisplay } from "../tools/RangeDisplay.js";

/**
 * The map controls (bottom end of the canvas) show what the map is showing, and what an export
 * will contain. The map region is drawn once, so its controls are never redrawn from a template
 * after that: every change to a view is written onto them here, from the studio's state, by
 * MapStudio#syncMapControls. Nothing else sets their state, so a control can never disagree with
 * the view it switches (a grid size change that turns the grid on shows on the Grid toggle).
 *
 * The same state appears twice: as the wide row of buttons, and as the rows of the Layers menu
 * that replaces most of them when the canvas is too narrow (see foldMapControls). Both carry the
 * same data-action and data attributes, so one pass marks both, each in the way its role reads it
 * (aria-pressed on a button, aria-checked on a menu row).
 */

/** The layers switched on and off one by one with the toggleLayer action, in the controls' order. */
export const VIEW_LAYERS = Object.freeze([...FILRODENSWMB.STUDIO.VIEW_LAYERS, ...FILRODENSWMB.STUDIO.OVERLAY_LAYERS].filter((layer) => layer.action !== "toggleGrid").map((layer) => layer.id));

/** Whether all, some or none of a list of switches are on. */
function groupState(values) {
    const on = values.filter(Boolean).length;
    if (on === values.length) return "on";
    return on === 0 ? "off" : "partial";
}

const ARIA_CHECKED = { on: "true", partial: "mixed", off: "false" };

/**
 * How many of the switches the Layers menu lists are on: every terrain layer, every view layer
 * and the grid. (The view filters and zoom stay outside the menu, so they do not count.)
 *
 * @param {object} state - As for syncMapControls.
 * @returns {{shown: number, total: number}}
 */
export function layersShown(state) {
    const values = [...state.terrainGroups.flatMap((group) => group.items.map((item) => item.on)), ...VIEW_LAYERS.map((id) => state.layers[id]), state.grid];
    return { shown: values.filter(Boolean).length, total: values.length };
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
 *   Regions menus' rows (see ContentRows).
 * @param {number} state.detailLevel - The map's detail level (see DetailLevel).
 * @param {boolean} state.avoidOverlaps - Whether names avoid each other (see LabelLayout).
 * @param {{value: string, percent: number, auto: boolean, selected: boolean}[]} [state.symbolSizes] - The
 *   symbol size rows (see SymbolScale.choices), Auto first.
 * @param {{fill: string|null, rows: {id: string, disabled: boolean, title: string}[], opacity: number, note: string}} [state.thematic] - The
 *   thematic layers' menu (see ThematicView.controlState).
 * @param {(percent: number) => string} [autoLabel] - The Auto row's name for its value.
 * @param {(shown: number, total: number) => string} layersLabel - The Layers button's name for a count.
 * @param {(level: number) => string} detailLabel - The Detail button's name for a level.
 */
export function syncMapControls(root, state, layersLabel, detailLabel, autoLabel = (percent) => `${percent}%`) {
    if (!root) return;
    const each = (selector, apply) => root.querySelectorAll(selector).forEach(apply);

    each('[data-action="toggleViewFilter"]', (element) => setOn(element, state.viewFilters[element.dataset.filter]));
    each('[data-action="toggleLayer"]', (element) => setOn(element, state.layers[element.dataset.layer]));
    each('[data-action="toggleGrid"]', (element) => setOn(element, state.grid));
    each('[data-action="threeDView"]', (element) => setOn(element, state.threeD));

    for (const group of state.contentGroups ?? []) syncContentGroup(root, group);
    if (state.thematic) syncThematic(root, state.thematic);

    // The Detail menu: one level chosen, named on its button
    each('[data-action="setDetailLevel"]', (row) => row.setAttribute("aria-checked", String(Number(row.dataset.detailLevel) === state.detailLevel)));
    each('[data-action="toggleLabelOverlaps"]', (row) => setOn(row, state.avoidOverlaps));
    for (const choice of state.symbolSizes ?? []) {
        each(`[data-action="setSymbolSize"][data-symbol-size="${choice.value}"]`, (row) => {
            row.setAttribute("aria-checked", String(choice.selected));
            const name = choice.auto ? row.querySelector("[data-symbol-auto]") : null;
            if (name) name.textContent = autoLabel(choice.percent);
        });
    }
    each('.fwmb-layer-group[data-layer-group="detail"] > [data-action="toggleLayerMenu"]', (button) => {
        const label = detailLabel(state.detailLevel);
        button.setAttribute("aria-label", label);
        button.dataset.tooltip = label;
    });

    for (const group of state.terrainGroups) {
        const status = groupState(group.items.map((item) => item.on));
        // The wide control: one button opening the group's own list
        each(`.fwmb-layer-group[data-layer-group="${group.id}"] > [data-action="toggleLayerMenu"]`, (button) => {
            setPressed(button, status === "on");
            button.classList.toggle("fwmb-is-partial", status === "partial");
        });
        // The group's "All" row (wide list) and its group row (Layers menu)
        each(`[data-action="toggleTerrainLayer"][data-layer-group="${group.id}"][data-terrain-layer="all"]`, (row) => row.setAttribute("aria-checked", ARIA_CHECKED[status]));
        for (const item of group.items) {
            each(`[data-action="toggleTerrainLayer"][data-layer-group="${group.id}"][data-terrain-layer="${item.key}"]`, (row) => setOn(row, item.on));
        }
    }

    // The Layers button that stands in for the layer toggles when the controls are folded
    const { shown, total } = layersShown(state);
    each('.fwmb-layer-group[data-layer-group="layers"] > [data-action="toggleLayerMenu"]', (button) => {
        setPressed(button, shown > 0);
        button.classList.toggle("fwmb-is-partial", shown > 0 && shown < total);
        const label = layersLabel(shown, total);
        button.setAttribute("aria-label", label);
        button.dataset.tooltip = label;
    });
}

/**
 * The thematic layers' menu: the colour layer chosen
 * (None when none is drawn), the line layers shown, the layers the map's run cannot show marked
 * disabled with the reason as their tooltip, the note at its head, the opacity slider (idle while
 * no colour layer is drawn), and the button pressed while any layer is drawn.
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
    const anyShown = !!thematic.fill || (thematic.lines ?? []).some((line) => line.on);
    root.querySelectorAll('.fwmb-layer-group[data-layer-group="thematic"] > [data-action="toggleLayerMenu"]').forEach((button) => setPressed(button, anyShown));
}

/**
 * Whether the map controls must fold their layer toggles into the Layers menu: when the whole row
 * of buttons is wider than the room the canvas leaves it beside the hint at its narrowest.
 *
 * @param {number} wideWidth - The width of the controls with every toggle shown.
 * @param {number} room - The canvas width less the hint's narrowest width and the margins around and between them.
 * @returns {boolean}
 */
export function mustFoldMapControls(wideWidth, room) {
    return wideWidth > room;
}

/**
 * One of the Labels and Regions menus (see ContentRows): its rows written into the wide menu and
 * the folded Layers menu when they change (styles and levels come and go with the map), then
 * each marked, the All row and the group's button with them.
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
    root.querySelectorAll(`.fwmb-layer-group[data-layer-group="${group.id}"] > [data-action="toggleLayerMenu"]`).forEach((button) => {
        setPressed(button, group.state === "on");
        button.classList.toggle("fwmb-is-partial", group.state === "partial");
    });
}

/**
 * A menu's rows as buttons, indented one step further in the folded Layers menu
 * (data-content-indent); a row marked separator (Regions' Fills) has a rule above it.
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
