import { FILRODENSWMB } from "../config.js";
import { setOn, setPressed } from "./aria.js";

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
 * @param {number} state.detailLevel - The map's detail level (see DetailLevel).
 * @param {(shown: number, total: number) => string} layersLabel - The Layers button's name for a count.
 * @param {(level: number) => string} detailLabel - The Detail button's name for a level.
 */
export function syncMapControls(root, state, layersLabel, detailLabel) {
    if (!root) return;
    const each = (selector, apply) => root.querySelectorAll(selector).forEach(apply);

    each('[data-action="toggleViewFilter"]', (element) => setOn(element, state.viewFilters[element.dataset.filter]));
    each('[data-action="toggleLayer"]', (element) => setOn(element, state.layers[element.dataset.layer]));
    each('[data-action="toggleGrid"]', (element) => setOn(element, state.grid));
    each('[data-action="threeDView"]', (element) => setOn(element, state.threeD));

    // The Detail menu: one level chosen, named on its button
    each('[data-action="setDetailLevel"]', (row) => row.setAttribute("aria-checked", String(Number(row.dataset.detailLevel) === state.detailLevel)));
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
