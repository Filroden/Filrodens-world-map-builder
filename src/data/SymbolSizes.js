import { FILRODENSWMB } from "../config.js";

/**
 * Pins and labels are sized in SYMBOLS.UNIT steps of what size 1 meant before size revision
 * SYMBOLS.REVISION, so that size 1 suits a map holding thousands of places. A map (or a styles
 * file) saved before then holds the older sizes; they are scaled up once as it is read, so it
 * looks exactly as it did. A label size left unset draws at LABELS.UNSET_SIZE, which is the old
 * default scaled the same way.
 */

/** How much an older size grows to look the same. */
const GROWTH = 1 / FILRODENSWMB.SYMBOLS.UNIT;

/** Whether data saved at `revision` (absent before sizes had a revision) needs its sizes scaled. */
export function needsRebase(revision) {
    return !(Number(revision) >= FILRODENSWMB.SYMBOLS.REVISION);
}

function grow(target, field) {
    if (target && typeof target === "object" && Number.isFinite(target[field])) target[field] *= GROWTH;
}

function growLabelOf(owner) {
    grow(owner?.label, "fontSize");
}

/**
 * Scales a pin style's or a label style's sizes from an older revision.
 * @param {object[]} [pinStyles]
 * @param {object[]} [labelStyles]
 */
export function rebaseStyles(pinStyles = [], labelStyles = []) {
    for (const style of pinStyles ?? []) {
        grow(style, "scale");
        growLabelOf(style);
    }
    for (const style of labelStyles ?? []) grow(style, "fontSize");
}

/**
 * Scales a saved map's pin and label sizes when it was saved before the current revision, and
 * marks it current. A pin with no scale is given the older default (1) scaled, as it drew.
 * Changes the data in place.
 * @param {object} mapData - A map's data as saved (its pins, routes, labels, regions and styles).
 * @returns {boolean} Whether it was scaled.
 */
export function rebaseMap(mapData) {
    if (!mapData || !needsRebase(mapData.sizeRevision)) return false;
    for (const pin of mapData.mapPins ?? []) {
        pin.scale = Number.isFinite(pin.scale) ? pin.scale * GROWTH : GROWTH;
        growLabelOf(pin);
    }
    for (const route of mapData.mapRoutes ?? []) growLabelOf(route);
    for (const label of mapData.mapLabels ?? []) grow(label, "fontSize");
    const levels = (mapData.layerSets ?? []).flatMap((set) => set.levels ?? []);
    for (const region of [...levels, ...(mapData.regionLayers ?? [])].flatMap((level) => level.regions ?? [])) growLabelOf(region);
    rebaseStyles(mapData.customPinStyles, mapData.customLabelStyles);
    mapData.sizeRevision = FILRODENSWMB.SYMBOLS.REVISION;
    return true;
}
