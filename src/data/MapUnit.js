import { FILRODENSWMB } from "../config.js";
import { effectiveKmPerPx } from "../mesh/Schema.js";

/**
 * The map's unit: the name every distance the studio shows is labelled with (the scale bar, a
 * layer's territorial waters, the scale beside the area factor).
 *
 * The unit is a name only. Everything the module works out from the map's scale is measured in
 * kilometres (see Schema.effectiveKmPerPx), and a distance is shown as that number of kilometres
 * followed by the map's name for the unit. A map whose owner calls the unit "leagues" therefore
 * reads its figures as leagues of one kilometre each: the name changes the wording, never the
 * number. Converting between real units was deliberately left out, because the world's size is
 * itself a free choice (its latitudes and area factor), so a unit with its own size would only
 * be a second way of setting the same scale.
 *
 * Nothing here touches the DOM or Foundry, so it is tested in Node.
 */

const UNIT = FILRODENSWMB.MAP_UNIT;

/** Decimal places shown for a distance, by its size: whole numbers from 10 up. */
const WHOLE_FROM = 10;
const TENTHS_FROM = 1;
const DECIMAL_BASE = 10;
/** The scale bar's interval when a map has none (as the bar has always drawn). */
const DEFAULT_INTERVAL_PX = 100;

/**
 * A unit name made usable: trimmed text, or the default when there is none.
 * @param {*} value
 * @returns {string}
 */
export function cleanUnit(value) {
    const text = typeof value === "string" ? value.trim() : "";
    return text || UNIT.DEFAULT;
}

/**
 * The unit a saved map uses, and whether it was changed on the way in.
 *
 * A map saved before it had a unit only has the scale bar's units text, which was free text
 * labelling a hand-set bar. That text becomes the unit, except the bar's old built-in "Miles",
 * which most maps carry untouched: kept, it would label kilometre figures as miles, so such a map
 * takes the default unit instead and the caller is told (`converted`), so it can say so and mark
 * the map as changed.
 *
 * @param {object} payload - A map's data as saved.
 * @returns {{unit: string, converted: boolean}}
 */
export function unitFromSaved(payload) {
    if (typeof payload?.mapUnit === "string" && payload.mapUnit.trim()) return { unit: payload.mapUnit.trim(), converted: false };

    const legacy = payload?.params?.cartography?.scaleUnits;
    const text = typeof legacy === "string" ? legacy.trim() : "";
    if (text === UNIT.LEGACY_DEFAULT) return { unit: UNIT.DEFAULT, converted: true };
    return { unit: cleanUnit(text), converted: false };
}

/**
 * Kilometres per map pixel for the studio's current state (its latitudes and world), as the
 * mesh and the generator use them.
 * @param {object} state - The studio's uiState (latTop, latBottom, world).
 * @param {number} mapHeight
 * @returns {number}
 */
export function kmPerPxOf(state, mapHeight) {
    return effectiveKmPerPx({ mapHeight, params: { latTop: state?.latTop, latBottom: state?.latBottom }, world: state?.world ?? null });
}

/**
 * A distance as shown beside the unit's name: whole numbers from 10, one decimal place from 1, two
 * below that, with the reader's own digit grouping and decimal mark.
 * @param {number} km
 * @returns {string}
 */
export function formatDistance(km) {
    if (!Number.isFinite(km)) return "";
    const size = Math.abs(km);
    let digits = 2;
    if (size >= WHOLE_FROM) digits = 0;
    else if (size >= TENTHS_FROM) digits = 1;
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: digits }).format(km);
}

/**
 * The round distance nearest to a given one: 1, 2 or 5 (UNIT.NICE_STEPS) times a power of ten,
 * compared on a logarithmic scale so that, say, 3.3 rounds to 5 rather than 2 only when it is
 * proportionally closer.
 * @param {number} km - Greater than 0.
 * @returns {number}
 */
export function niceDistance(km) {
    if (!(km > 0)) return UNIT.NICE_STEPS[0];
    const power = Math.floor(Math.log10(km));
    let best = null;
    // The steps of this decade and the first of the next, so 8 can round up to 10
    for (const exponent of [power, power + 1]) {
        for (const step of UNIT.NICE_STEPS) {
            const candidate = step * DECIMAL_BASE ** exponent;
            const distance = Math.abs(Math.log(candidate / km));
            if (best === null || distance < best.distance) best = { candidate, distance };
        }
    }
    return Number(best.candidate.toPrecision(1));
}

/**
 * The scale bar's major tick when it matches the world's scale: the round distance nearest to
 * what the bar's own interval measures, and the interval in pixels that measures exactly that.
 * The bar's interval is kept as the length the user wants a tick to be, so the drawn tick stays
 * close to it whatever the map's scale.
 * @param {number} kmPerPx
 * @param {number} intervalPx - The bar's interval as set.
 * @returns {{value: number, intervalPx: number}}
 */
export function worldScaleTick(kmPerPx, intervalPx) {
    const value = niceDistance(intervalPx * kmPerPx);
    return { value, intervalPx: value / kmPerPx };
}

/**
 * The scale bar's tick as it is drawn: from the world's scale when the bar matches it, otherwise
 * the bar's own interval and value.
 * @param {object} state - The studio's uiState.
 * @param {number} mapHeight
 * @returns {{value: number, intervalPx: number}}
 */
export function scaleBarTick(state, mapHeight) {
    const intervalPx = state.cartographyScaleInterval || DEFAULT_INTERVAL_PX;
    if (state.cartographyScaleMatchWorld === true) return worldScaleTick(kmPerPxOf(state, mapHeight), intervalPx);
    return { value: state.cartographyScaleValue || 1, intervalPx };
}
