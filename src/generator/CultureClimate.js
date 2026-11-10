import { FILRODENSWMB } from "../config.js";
import { BIOME_SIDE, BiomePlacement } from "../generation/BiomePlacement.js";

/**
 * A culture's climate: the temperature, moisture and height its people are at home in. It is one
 * of two, never both (`habitat.climate`):
 *
 * - **biomes**: the user names biomes (built-in and custom) and each becomes a climate zone worked
 *   out from the map as it is at every run (see biomeZones), so the culture follows later terrain,
 *   climate and biome edits. With none chosen there is no climate limit.
 * - **zones**: climate zones set by hand, each a row in the custom biome rule format (see
 *   BiomeRuleEngine): elevation, moisture and temperature, each a list of ranges.
 *
 * Either way a cell fits as well as its best zone (see Cultures.habitatFit), so a culture choosing
 * snow and rainforest fits both and not the climates between them. One band per measure spanning
 * both would fit nearly everything.
 *
 * A culture saved before the choice existed has neither: its single temperature, moisture and
 * height bands read as one zone (see climateOf), and the engine reads them exactly as it always
 * has, so its run does not change.
 *
 * Platform-neutral: the generation worker reads it beside the run, and the culture inspector for
 * its choices and its coverage warning.
 */

export const CLIMATES = FILRODENSWMB.GENERATOR.CULTURES.CLIMATES;

/** The share of each measure a biome's zone spans: its middle part, so a few odd pixels do not widen it. */
const ZONE_SPAN = 0.8;

/** Histogram bins per measure (the measures run 0 to 1), a thousandth each. */
const BINS = 1000;

/** Pixels read for a biome's zone: one in this many, as the zone is a spread, not an exact sum. */
const ZONE_STRIDE = 2;

/** The least fit at which a pixel counts as suiting a culture, for the coverage warning. */
const COVERAGE_FIT = 0.5;

/** A whole track on one axis of a zone: no limit there. */
const WHOLE = Object.freeze([0, 1, true, true]);

/** The built-in biomes that never show on dry land. */
const WATER_KEYS = new Set(["DEEP_OCEAN", "SHALLOW_OCEAN", "PACK_ICE", "ERASER"]);

/**
 * A culture's climate as the engine and the inspector read it.
 * @param {object} [habitat] - A map culture's habitat.
 * @returns {{mode: string, biomes: number[], zones: object[], legacy: boolean}} `legacy` when the
 *     habitat names no climate and its zone was read from its older bands.
 */
export function climateOf(habitat) {
    const biomes = Array.isArray(habitat?.biomes) ? habitat.biomes.filter(Number.isInteger) : [];
    const zones = Array.isArray(habitat?.zones) ? habitat.zones.filter(isRow) : [];
    if (habitat?.climate === CLIMATES.BIOMES) return { mode: CLIMATES.BIOMES, biomes, zones, legacy: false };
    if (habitat?.climate === CLIMATES.ZONES) return { mode: CLIMATES.ZONES, biomes, zones, legacy: false };
    return { mode: CLIMATES.ZONES, biomes, zones: [zoneFromBands(habitat)], legacy: true };
}

function isRow(row) {
    return !!row && ["elevation", "moisture", "temperature"].every((axis) => Array.isArray(row[axis]));
}

/**
 * One zone from a culture's older single bands (temperature and moisture 0 to 1, height in the
 * map's elevation from the sea level up), as a rule row; a band that is missing is the whole track.
 */
export function zoneFromBands(habitat) {
    const segment = (range) => (isBand(range) ? [Math.min(...range), Math.max(...range), false, false] : [...WHOLE]);
    return { elevation: [segment(habitat?.height)], moisture: [segment(habitat?.moisture)], temperature: [segment(habitat?.temperature)] };
}

function isBand(range) {
    return Array.isArray(range) && range.length === 2 && range.every((end) => typeof end === "number" && Number.isFinite(end));
}

/** Whether a culture's climate is its chosen biomes, with at least one chosen. */
export function usesBiomes(culture) {
    const climate = climateOf(culture?.habitat);
    return climate.mode === CLIMATES.BIOMES && climate.biomes.length > 0;
}

/** Whether any of the map's cultures takes its climate from biomes (so a biome edit changes its run). */
export function anyUsesBiomes(cultures) {
    return (Array.isArray(cultures) ? cultures : []).some(usesBiomes);
}

/**
 * The biomes a culture may choose: every built-in land biome, then the map's custom biomes that
 * may show on dry land, by id.
 * @param {object[]} [customBiomes]
 * @returns {number[]}
 */
export function landBiomeIds(customBiomes = []) {
    const ids = Object.entries(FILRODENSWMB.BIOME_IDS).filter(([key]) => !WATER_KEYS.has(key)).map(([, id]) => id);
    for (const biome of customBiomes ?? []) {
        if (!Number.isInteger(biome?.id)) continue;
        if (BiomePlacement.sidesOf(BiomePlacement.placementOfCustom(biome)) & BIOME_SIDE.LAND) ids.push(biome.id); // NOSONAR: a placement is BIOME_SIDE flags combined
    }
    return ids;
}

/**
 * Each chosen biome's zone, from the map as it is: the middle ZONE_SPAN of the elevation,
 * moisture and temperature over the pixels showing it, as a rule row. A biome showing nowhere has
 * no zone (the map has none of it now, so it says nothing about the culture's climate).
 * @param {number[]} ids
 * @param {{shown: Uint8Array, elevation: ArrayLike<number>, moisture: ArrayLike<number>, temperature: ArrayLike<number>}} rasters -
 *     `shown`: the biome id each land pixel shows (0 for water).
 * @returns {object[]} Rows in the chosen biomes' order.
 */
export function biomeZones(ids, { shown, elevation, moisture, temperature }) {
    const wanted = new Map();
    for (const id of ids) if (!wanted.has(id)) wanted.set(id, { count: 0, elevation: new Uint32Array(BINS), moisture: new Uint32Array(BINS), temperature: new Uint32Array(BINS) });
    if (!wanted.size || !shown) return [];
    for (let pixel = 0; pixel < shown.length; pixel += ZONE_STRIDE) {
        const counts = wanted.get(shown[pixel]);
        if (!counts) continue;
        counts.count++;
        counts.elevation[binOf(elevation[pixel])]++;
        counts.moisture[binOf(moisture[pixel])]++;
        counts.temperature[binOf(temperature[pixel])]++;
    }
    return [...wanted.values()].filter((counts) => counts.count > 0).map((counts) => ({
        elevation: [middleOf(counts.elevation, counts.count)],
        moisture: [middleOf(counts.moisture, counts.count)],
        temperature: [middleOf(counts.temperature, counts.count)],
    }));
}

function binOf(value) {
    if (!Number.isFinite(value)) return 0;
    return Math.min(BINS - 1, Math.max(0, Math.floor(value * BINS)));
}

/** The middle ZONE_SPAN of a histogram, as a segment (its ends at the bins' edges). */
function middleOf(histogram, count) {
    const cut = ((1 - ZONE_SPAN) / 2) * count;
    let lo = 0;
    let below = 0;
    while (lo < BINS - 1 && below + histogram[lo] <= cut) below += histogram[lo++];
    let hi = BINS - 1;
    let above = 0;
    while (hi > lo && above + histogram[hi] <= cut) above += histogram[hi--];
    return [lo / BINS, (hi + 1) / BINS, false, false];
}

/**
 * The share of the map's land a culture's zones suit, for the warning that a climate taking in most
 * of the land does little to place the culture. A pixel counts when its climate fits the culture's
 * best zone at least COVERAGE_FIT, with the soft bands a run uses (GENERATOR.CULTURES.SOFT, heights
 * in elevation units): counting only pixels strictly inside a zone would leave out the margins a run
 * still settles, so even every biome chosen (each zone the middle of its biome's climate on all three
 * measures) took in barely more than half of the land. Water is never counted. Zero with no zones:
 * no climate limit is not a climate.
 * @param {object[]} zones - Rule rows.
 * @param {{elevation: ArrayLike<number>, moisture: ArrayLike<number>, temperature: ArrayLike<number>, isLand: function(number): boolean, seaLevel: number}} map
 * @param {number} [stride] - One in this many pixels read.
 * @returns {number} 0 to 1.
 */
export function zoneCoverage(zones, { elevation, moisture, temperature, isLand, seaLevel }, stride = 4) {
    if (!zones?.length) return 0;
    const { SOFT } = FILRODENSWMB.GENERATOR.CULTURES;
    const soft = { elevation: SOFT.heightM / FILRODENSWMB.MESH.METRES_PER_UNIT, moisture: SOFT.moisture, temperature: SOFT.temperature };
    let land = 0;
    let suited = 0;
    for (let pixel = 0; pixel < elevation.length; pixel += stride) {
        if (!isLand(pixel)) continue;
        land++;
        const values = { elevation: elevation[pixel], moisture: moisture[pixel], temperature: temperature[pixel] };
        if (zones.some((zone) => zoneFit(zone, values, soft, seaLevel) >= COVERAGE_FIT)) suited++;
    }
    return land ? suited / land : 0;
}

/** How well a pixel's climate fits a zone: each axis's best range, multiplied, as a run's fit (see Cultures.habitatFit). */
function zoneFit(zone, values, soft, seaLevel) {
    let fit = 1;
    for (const axis of ["elevation", "moisture", "temperature"]) {
        fit *= axisFit(zone[axis], values[axis], soft[axis], axis === "elevation" ? seaLevel : 0);
        if (fit < COVERAGE_FIT) return fit;
    }
    return fit;
}

/** The best of an axis's ranges at a value, easing to 0 over `soft` outside each; an end at or beyond its track's end is open. */
function axisFit(segments, value, soft, floor) {
    if (!segments?.length) return 1;
    let best = 0;
    for (const [min, max] of segments) {
        const below = min > floor ? min - value : 0;
        const above = max < 1 ? value - max : 0;
        const out = Math.max(below, above, 0);
        const t = Math.min(1, out / soft);
        best = Math.max(best, 1 - t * t * (3 - 2 * t));
    }
    return best;
}
