import { FILRODENSWMB } from "../config.js";

/**
 * How big a map's pins and labels are drawn, beyond their own sizes.
 *
 * Pins and labels already grow with the map's pixel size (see SYMBOLS), so they are the same share
 * of any map. A regional map, though, shows less of its world: its places are further apart in
 * its pixels, and names the size of its parent's look sparse and small. Symbol size multiplies
 * every pin and label by:
 * - Auto (the default): the square root of how much the map is magnified against its whole
 *   world, from 1 up to SYMBOLS.AUTO_MAX. The magnification is the world's zoom times the root
 *   map's size over this map's size, so it combines the regional zoom with the map's own
 *   resolution: a top map is 1 at any size, and a regional map of the same crop at more pixels
 *   gets the same value (its symbols are already bigger in pixels).
 * - or a size chosen in the Detail menu (one of SYMBOLS.SIZES), saved with the map.
 *
 * The square root lets a regional map name more of its places while it still looks more open
 * than its parent.
 */
export class SymbolScale {
    /**
     * How much a map is magnified against its whole world (1 for a top map).
     * @param {object|null} world - The map's world description (uiState.world); null for a top map.
     * @param {number} width - The map's width in pixels.
     * @param {number} height
     * @returns {number}
     */
    static magnification(world, width, height) {
        const zoom = Number(world?.zoom);
        if (!(zoom > 0)) return 1;
        const size = Math.max(width, height);
        // A regional map made before the root's size was kept: taken as the size of its parent
        const rootW = Number(world.rootW) > 0 ? world.rootW : width;
        const rootH = Number(world.rootH) > 0 ? world.rootH : height;
        return size > 0 ? (zoom * Math.max(rootW, rootH)) / size : 1;
    }

    /** The Auto symbol size of a map (see the class description). */
    static auto(world, width, height) {
        const value = Math.sqrt(this.magnification(world, width, height));
        return Math.min(FILRODENSWMB.SYMBOLS.AUTO_MAX, Math.max(1, value));
    }

    /** A saved symbol size made valid: a number within SYMBOLS.RANGE, or null for Auto. */
    static valid(value) {
        if (value === null || value === undefined || value === "") return null;
        const number = Number(value);
        if (!Number.isFinite(number)) return null;
        const [min, max] = FILRODENSWMB.SYMBOLS.RANGE;
        return Math.min(max, Math.max(min, number));
    }

    /**
     * The symbol size a map draws at: its chosen size, or Auto.
     * @param {object} uiState - The map's state (its symbolSize, world, mapWidth and mapHeight).
     * @param {number} [width]
     * @param {number} [height]
     * @returns {number}
     */
    static of(uiState, width = uiState?.mapWidth, height = uiState?.mapHeight) {
        return this.valid(uiState?.symbolSize) ?? this.auto(uiState?.world ?? null, width, height);
    }

    /**
     * A name's outline (stroke thickness) and shadow (distance and blur), in pixels, for a name
     * this many pixels tall: in proportion to it, within LABELS.HALO's limits.
     * @param {number} sizePx
     * @returns {{stroke: number, shadow: number}}
     */
    static labelHalo(sizePx) {
        const { STROKE, STROKE_MIN, STROKE_MAX, SHADOW, SHADOW_MIN, SHADOW_MAX } = FILRODENSWMB.LABELS.HALO;
        const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
        const size = Number(sizePx) > 0 ? sizePx : 0;
        return { stroke: clamp(size * STROKE, STROKE_MIN, STROKE_MAX), shadow: clamp(size * SHADOW, SHADOW_MIN, SHADOW_MAX) };
    }

    /**
     * The Detail menu's symbol size rows: Auto (with its value) and each of SYMBOLS.SIZES, the
     * chosen one marked.
     * @param {object} uiState
     * @returns {{value: string, percent: number, auto: boolean, selected: boolean}[]}
     */
    static choices(uiState) {
        const chosen = this.valid(uiState?.symbolSize);
        const percent = (value) => Math.round(value * 100);
        return [
            { value: "auto", percent: percent(this.auto(uiState?.world ?? null, uiState?.mapWidth, uiState?.mapHeight)), auto: true, selected: chosen === null },
            ...FILRODENSWMB.SYMBOLS.SIZES.map((size) => ({ value: String(size), percent: percent(size), auto: false, selected: chosen === size })),
        ];
    }
}
