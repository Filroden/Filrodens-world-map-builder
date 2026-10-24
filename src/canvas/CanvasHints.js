import { FILRODENSWMB } from "../config.js";

/**
 * The list of mouse and keyboard actions shown in the canvas's bottom start corner. What is listed
 * depends on what the canvas is doing: the tool in use and its mode while editing, the regional
 * map crop, the reference image, or an item held by the pointer.
 *
 * The lists themselves live in FILRODENSWMB.UI.CANVAS_HINTS. Working out the context and the
 * list are pure functions, so they can be checked outside Foundry; only render touches the page.
 * Each action is one item (see .fwmb-map-hint): items share a row while there is room, and each
 * names the thing it acts on, so every item reads on its own. The full list of shortcuts is the
 * keyboard shortcuts sheet (see sheet), opened with "?".
 */
export class CanvasHints {
    static #KEY_PREFIX = "FILRODENSWMB.UI.Hint";

    /**
     * Works out which list applies.
     *
     * @param {object} state
     * @param {boolean} [state.is3DView]  Whether the 3D view is showing instead of the flat map.
     * @param {boolean} state.isEditMode
     * @param {string} state.activeTool  The main tool (terrain, features, scene, ...).
     * @param {boolean} state.isCropMode  Whether the regional map crop is taking pointer input.
     * @param {boolean} state.isReferenceMode  Whether the reference image is taking pointer input.
     * @param {string} [state.featureMode]  Terrain Features mode: spring, river or fault.
     * @param {string} [state.infraMode]  Infrastructure mode: pin or route.
     * @param {string} [state.regionMode]  Regions mode: select, paint, erase or fill.
     * @param {string} [state.routeMode]  Routes mode (Infrastructure in Route mode): select, draw or edit.
     * @param {string|null} [state.pickMode]  Pins' or labels' mode (see PickTool): select or place.
     * @param {boolean} [state.selecting]  Whether a Select mode of PickTool's is on (rivers and
     *   faults, land masks, decorations).
     * @param {boolean} [state.isMaskDrawing]  Whether the Scene tool is drawing land masks.
     * @param {boolean} [state.pickingHomeland]  Whether the next click adds a culture's homeland (see CultureMarkers).
     * @param {boolean} [state.travelPicking]  Whether a click sets the Travel tool's start (see TravelView).
     * @param {string|null} [state.heldItem]  What the pointer holds: label, decoration, pin or
     *   mask (a land mask).
     * @returns {string}  A key of CANVAS_HINTS.CONTEXTS.
     */
    static resolveContext(state) {
        // The 3D view covers the flat map and takes every pointer gesture itself
        if (state.is3DView) return "view3d";
        const held = CanvasHints.#heldContext(state.heldItem);
        if (held) return held;
        if (state.pickingHomeland) return "homeland";
        if (state.travelPicking) return "travel";
        if (state.isReferenceMode) return "reference";
        if (state.isCropMode) return "crop";
        if (!state.isEditMode) return "view";
        return CanvasHints.#toolContext(state);
    }

    static #heldContext(heldItem) {
        if (!heldItem) return null;
        const context = `held${heldItem.charAt(0).toUpperCase()}${heldItem.slice(1)}`;
        return FILRODENSWMB.UI.CANVAS_HINTS.CONTEXTS[context] ? context : null;
    }

    static #toolContext(state) {
        switch (state.activeTool) {
            case "terrain":
                return "terrain";
            case "biomes":
                return "biomes";
            case "features":
                if (state.featureMode === "select") return "featureSelect";
                return state.featureMode === "spring" ? "spring" : "line";
            case "infrastructure":
                return state.infraMode === "route" ? CanvasHints.#modeContext("route", state.routeMode, "draw") : CanvasHints.#modeContext("pin", state.pickMode, "place");
            case "regions":
                return CanvasHints.#modeContext("region", state.regionMode, "select");
            case "labels":
                return CanvasHints.#modeContext("label", state.pickMode, "place");
            case "cartography":
                return state.selecting ? "cartographySelect" : "cartography";
            case "scene":
                if (state.selecting) return "maskSelect";
                return state.isMaskDrawing ? "mask" : "view";
            default:
                return "view";
        }
    }

    /**
     * A tool's list for its mode (the tool's prefix and the capitalised mode, such as regionPaint
     * or routeDraw), or the list of its fallback mode when the mode has none.
     */
    static #modeContext(prefix, mode, fallback) {
        const name = (candidate) => `${prefix}${candidate.charAt(0).toUpperCase()}${candidate.slice(1)}`;
        const context = name(mode ?? fallback);
        return FILRODENSWMB.UI.CANVAS_HINTS.CONTEXTS[context] ? context : name(fallback);
    }

    /**
     * The localisation keys to show for a context, in reading order, each marked with whether it
     * is a "more" item (shown in the muted ink): the context's own actions come first in the normal
     * ink, then the common movement (pan and zoom), muted. A held item's list describes only what
     * can be done to that item while it is held, so it has no movement.
     *
     * On a touch screen each action a finger can make is worded for the finger (CANVAS_HINTS.TOUCH):
     * "Tap" for a click, "Press and hold" for a right-click, a second finger for the wheel.
     *
     * @param {string} context  From resolveContext.
     * @param {object} [options]
     * @param {boolean} [options.touch]  Whether the screen is a touch screen (see isTouchScreen).
     * @returns {{key: string, more: boolean}[]}
     */
    static getItems(context, { touch = false } = {}) {
        const { COMMON, CONTEXTS, TOUCH } = FILRODENSWMB.UI.CANVAS_HINTS;
        const item = (suffix, more) => ({ key: `${CanvasHints.#KEY_PREFIX}${(touch && TOUCH[suffix]) || suffix}`, more });
        const own = (CONTEXTS[context] ?? []).map((suffix) => item(suffix, false));
        if (context.startsWith("held")) return own;
        return [...own, ...COMMON.map((suffix) => item(suffix, true))];
    }

    /**
     * Whether the window's main pointer is a finger: no hovering pointer and a coarse one. A
     * laptop with a touch screen and a mouse or trackpad keeps the mouse's wording.
     *
     * @param {Window} [view]
     * @returns {boolean}
     */
    static isTouchScreen(view = globalThis) {
        return !!view.matchMedia?.("(hover: none) and (pointer: coarse)")?.matches;
    }

    /**
     * The localisation keys of a context's actions, in reading order (see getItems).
     *
     * @param {string} context  From resolveContext.
     * @returns {string[]}
     */
    static getKeys(context) {
        return CanvasHints.getItems(context).map((item) => item.key);
    }

    /**
     * The keyboard shortcuts sheet: one table per tool, with a caption per mode, each listing the
     * mode's own canvas actions (the hint's items) followed by its keyboard shortcuts. Movement and
     * the shortcuts that work everywhere head the sheet in a table of their own, so no table
     * repeats them. Built from the same lists as the hint (CANVAS_HINTS) plus SHORTCUTS.
     *
     * @param {(key: string) => string} localize
     * @returns {{title: string, tables: {caption: string|null, rows: string[]}[]}[]}
     */
    static sheet(localize) {
        const { COMMON, CONTEXTS } = FILRODENSWMB.UI.CANVAS_HINTS;
        const { KEYS, SHEET } = FILRODENSWMB.UI.SHORTCUTS;
        const hint = (suffix) => localize(`${CanvasHints.#KEY_PREFIX}${suffix}`);
        const key = (suffix) => localize(`FILRODENSWMB.UI.Shortcut${suffix}`);
        return SHEET.map((tool) => ({
            title: localize(tool.title),
            tables: tool.tables.map((table) => {
                const actions = table.context === "everywhere" ? COMMON : (CONTEXTS[table.context] ?? []);
                return {
                    caption: table.caption ? localize(table.caption) : null,
                    rows: [...actions.map(hint), ...(KEYS[table.context] ?? []).map(key)],
                };
            }),
        }));
    }

    /**
     * Fills the hint element with one element per action, in order. Text is set with textContent,
     * never as HTML, so a translation containing markup characters is shown as written.
     *
     * @param {HTMLElement} element  The `.fwmb-map-hint` element.
     * @param {{key: string, more: boolean}[]} items  From getItems.
     * @param {(key: string) => string} localize
     */
    static render(element, items, localize) {
        const doc = element.ownerDocument;
        element.replaceChildren(...items.map((item) => CanvasHints.#createItem(doc, localize(item.key), item.more)));
    }

    static #createItem(doc, text, more) {
        const item = doc.createElement("span");
        item.className = more ? "fwmb-map-hint-item fwmb-more" : "fwmb-map-hint-item";
        item.textContent = text;
        return item;
    }
}
