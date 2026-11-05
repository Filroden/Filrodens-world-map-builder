import { FILRODENSWMB } from "../config.js";

/**
 * The colour a region or region fill style had before No fill was ticked, so clearing No fill
 * brings that colour back rather than whatever the colour box happened to hold.
 *
 * No fill is saved as the fill colour "transparent", which leaves no colour behind, and a colour
 * box cannot show "transparent", so without this it shows black and clearing No fill paints the
 * region black. The colour is remembered for the session, by the item's id, when No fill is
 * ticked; an item whose colour was never seen this session (a map just opened) shows its region
 * preset instead, the colour it would have had with no fill chosen.
 */
export class FillMemory {
    static #colours = new Map();

    /**
     * Remembers an item's colour as No fill is ticked.
     * @param {string} id - The region's or style's id.
     * @param {string} colour - The colour the colour box held.
     */
    static remember(id, colour) {
        if (id && colour && colour !== "transparent") this.#colours.set(id, colour);
    }

    /**
     * The colour to show in an item's colour box: its own fill, or with No fill the colour it had
     * before, or its preset.
     * @param {{id?: string, key?: number, fillColor?: string}} item - A region or region style.
     * @returns {string}
     */
    static shown(item) {
        const fill = item?.fillColor;
        if (fill && fill !== "transparent") return fill;
        const presets = FILRODENSWMB.REGIONS.PRESETS;
        return this.#colours.get(item?.id) ?? presets[(item?.key ?? 0) % presets.length];
    }
}
