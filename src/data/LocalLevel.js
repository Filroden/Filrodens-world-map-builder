import { FILRODENSWMB } from "../config.js";

/**
 * The Detail menu gained Local, between Regional and Everything, so a regional map's filled-in
 * places can step in over three levels rather than all at once (see DetailLevel). Everything moved
 * from 3 to 4 and Local took 3. Once, as a map or a styles file saved before then is read:
 * - a map left on Everything stays on Everything;
 * - a Village style (or any style of a tier that now starts at Everything) that showed its pins or
 *   names only at Everything keeps doing so.
 *
 * Every other level 3 now means Local, which still shows at Everything, so nothing else changes
 * what Everything shows. The data is marked (`localLevel`), and a map is not marked as changed:
 * until it is saved the same pass runs on every load, with the same result.
 */

/** The old Everything, now Local. */
const OLD_EVERYTHING = 3;

/** The tiers whose default style now starts at Everything (see PINS.DEFAULT_STYLES). */
const EVERYTHING_TIERS = new Set(FILRODENSWMB.PINS.DEFAULT_STYLES.filter((style) => style.detailLevel === FILRODENSWMB.DETAIL.EVERYTHING).map((style) => style.tier));

/**
 * Moves the old Everything of pin styles of the tiers that now start at Everything.
 * @param {object[]} [pinStyles] - Changed in place.
 */
export function moveStyleLevels(pinStyles = []) {
    for (const style of pinStyles ?? []) {
        if (!style || !EVERYTHING_TIERS.has(style.tier)) continue;
        if (style.detailLevel === OLD_EVERYTHING) style.detailLevel = FILRODENSWMB.DETAIL.EVERYTHING;
        if (style.label?.detailLevel === OLD_EVERYTHING) style.label.detailLevel = FILRODENSWMB.DETAIL.EVERYTHING;
    }
}

/**
 * @param {object} mapData - A map's data as saved (its detail level and pin styles). Changed in place.
 * @returns {boolean} Whether it was moved.
 */
export function addLocalLevelOnce(mapData) {
    if (!mapData || mapData.localLevel === true) return false;
    mapData.localLevel = true;
    if (mapData.detailLevel === OLD_EVERYTHING) mapData.detailLevel = FILRODENSWMB.DETAIL.EVERYTHING;
    moveStyleLevels(mapData.customPinStyles);
    return true;
}
