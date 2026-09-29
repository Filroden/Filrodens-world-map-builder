import { FILRODENSWMB } from "../config.js";

/**
 * The list of mouse and keyboard actions shown in the map's bottom corner while the pointer is
 * over the canvas. What is listed depends on what the canvas is doing: the tool in use and its
 * mode while editing, the regional map crop, the reference image, or an item held by the pointer.
 *
 * The lists themselves live in FILRODENSWMB.UI.CANVAS_HINTS. Working out the context and the
 * list are pure functions, so they can be checked outside Foundry; only render touches the page.
 * The actions are shown one per row (see .fwmb-map-hint), and each names the thing it acts on,
 * so every row reads on its own.
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
     * @param {boolean} [state.isMaskDrawing]  Whether the Scene tool is drawing land masks.
     * @param {string|null} [state.heldItem]  What the pointer holds: label, decoration, pin,
     *   region or mask (a land mask).
     * @returns {string}  A key of CANVAS_HINTS.CONTEXTS.
     */
    static resolveContext(state) {
        // The 3D view covers the flat map and takes every pointer gesture itself
        if (state.is3DView) return "view3d";
        const held = CanvasHints.#heldContext(state.heldItem);
        if (held) return held;
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
                return state.featureMode === "spring" ? "spring" : "line";
            case "infrastructure":
                return state.infraMode === "route" ? "line" : "pin";
            case "regions":
                return "region";
            case "labels":
                return "labels";
            case "cartography":
                return "cartography";
            case "scene":
                return state.isMaskDrawing ? "mask" : "view";
            default:
                return "view";
        }
    }

    /**
     * The localisation keys to show for a context, in reading order. The common actions (pan
     * and zoom) lead every list except a held item's, which describes only what can be done to
     * that item while it is held.
     *
     * @param {string} context  From resolveContext.
     * @returns {string[]}
     */
    static getKeys(context) {
        const { COMMON, CONTEXTS } = FILRODENSWMB.UI.CANVAS_HINTS;
        const own = CONTEXTS[context] ?? [];
        const suffixes = context.startsWith("held") ? own : [...COMMON, ...own];
        return suffixes.map((suffix) => `${CanvasHints.#KEY_PREFIX}${suffix}`);
    }


    /**
     * Fills the hint element with one element per action, in order. Text is set with
     * textContent, never as HTML, so a translation containing markup characters is shown as
     * written.
     *
     * @param {HTMLElement} element  The `.fwmb-map-hint` element.
     * @param {string[]} keys  From getKeys.
     * @param {(key: string) => string} localize
     */
    static render(element, keys, localize) {
        element.replaceChildren(...keys.map((key) => CanvasHints.#createItem(localize(key))));
    }

    static #createItem(text) {
        const item = document.createElement("span");
        item.className = "fwmb-map-hint-item";
        item.textContent = text;
        return item;
    }
}
