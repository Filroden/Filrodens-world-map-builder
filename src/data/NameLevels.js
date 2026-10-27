import { FILRODENSWMB } from "../config.js";

/**
 * Runs before names followed the detail level hid the label of every generated pin below a city
 * (GENERATOR.LABELLED_TIERS), so neither the Detail menu nor the pin styles could show them. Once,
 * as a map saved before then is opened, those labels are given back to their styles:
 * - only pins of a run that named its capitals (a run made with names switched off hid every
 *   label on purpose, so its pins are left alone);
 * - only pins not edited since the run;
 * - only labels that are hidden, below a city's tier.
 *
 * A shown label then follows its style's visibility, and appears from the style's name level
 * (see DetailLevel.ofName). The map is marked (`nameLevels`), and is not marked as changed: until
 * it is saved the same pass runs on every load, with the same result.
 */

/**
 * @param {object} mapData - A map's data as saved (its pins and pin styles). Changed in place.
 * @returns {number} How many labels were shown again.
 */
export function showNamesOnce(mapData) {
    if (!mapData || mapData.nameLevels === true) return 0;
    mapData.nameLevels = true;
    const pins = Array.isArray(mapData.mapPins) ? mapData.mapPins : [];
    const named = new Set(FILRODENSWMB.GENERATOR.LABELLED_TIERS);
    const namingRuns = new Set(pins.filter((pin) => pin?.generated && named.has(pin.generated.tier) && pin.label?.visibility !== "none").map((pin) => pin.generated.run));
    const styles = new Map((mapData.customPinStyles ?? []).map((style) => [style?.id, style]));
    let shown = 0;
    for (const pin of pins) {
        const generated = pin?.generated;
        if (!generated || generated.edited || named.has(generated.tier) || !namingRuns.has(generated.run)) continue;
        if (pin.label?.visibility !== "none") continue;
        pin.label.visibility = styles.get(pin.pinStyle)?.label?.visibility ?? "all";
        shown++;
    }
    return shown;
}
