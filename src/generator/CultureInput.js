import { FILRODENSWMB } from "../config.js";

/**
 * The map's cultures (as the Cultures section and the culture inspector keep them) in the form the
 * engine reads (see Cultures.js). Platform-neutral, so it runs in the generation worker beside the
 * run, with the payload's own raster and sea level.
 *
 * A map's culture: { id, name, color, nameBase, openness, density,
 *   habitat: { temperature, moisture, height, relief, coast, river }, homelands }
 * - temperature and moisture: [lo, hi] on 0 to 1, or null for no limit;
 * - height: [lo, hi] in the map's elevation (0 to 1, as the biome rule editor and the Elev readout
 *   show it), from the sea level up; null for no limit;
 * - relief: [lo, hi], the height a cell spans, in the same units, 0 to RELIEF_MAX; null for none;
 * - coast and river: -1 (avoids) to 1 (seeks), 0 for no preference;
 * - homelands: map points ({ x, y } in map pixels), each a starting place; none for Auto.
 *
 * A band at a track's end is open there (a height band reaching the top fits every summit), so a
 * full track is no limit. Heights become metres above the sea, as the engine measures them.
 */

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const isNumber = (value) => typeof value === "number" && Number.isFinite(value);

/** A [lo, hi] band from a map culture's, or null when it is missing, malformed or open at both ends. */
function bandOf(range, min, max) {
    if (!Array.isArray(range) || range.length !== 2 || !range.every(isNumber)) return null;
    const lo = clamp(Math.min(range[0], range[1]), min, max);
    const hi = clamp(Math.max(range[0], range[1]), min, max);
    const openLo = lo <= min;
    const openHi = hi >= max;
    if (openLo && openHi) return null;
    return [openLo ? -Infinity : lo, openHi ? Infinity : hi];
}

/** A band's ends in metres (scale, after taking `offset` away), keeping open ends open. */
function inMetres(band, offset, scale) {
    return band ? band.map((end) => (Number.isFinite(end) ? (end - offset) * scale : end)) : null;
}

/** The model cell under a map point, or -1 off the map. */
function modelCellAt(point, payload) {
    if (!point || !isNumber(point.x) || !isNumber(point.y)) return -1;
    const x = Math.floor(point.x);
    const y = Math.floor(point.y);
    if (x < 0 || y < 0 || x >= payload.width || y >= payload.height) return -1;
    return payload.modelOf[y * payload.width + x];
}

/**
 * The engine's cultures for a run.
 * @param {object[]} list - The map's cultures.
 * @param {{width: number, height: number, modelOf: Int32Array, seaLevel: number, metresPerUnit: number}} payload
 * @returns {object[]} Each with id, name, color, nameBase, openness, density, habitat (temperature,
 *     moisture, heightM, reliefM, coast, river), homelandCells and homelandsGiven (how many points it had).
 */
export function engineCultures(list, payload) {
    const { FIELDS, DEFAULT } = FILRODENSWMB.GENERATOR.CULTURES;
    const metres = payload.metresPerUnit ?? FILRODENSWMB.MESH.METRES_PER_UNIT;
    const sea = payload.seaLevel;
    return (Array.isArray(list) ? list : []).map((culture) => {
        const habitat = culture?.habitat ?? {};
        const number = (value, field) => (isNumber(value) ? clamp(value, FIELDS[field].min, FIELDS[field].max) : FIELDS[field].default);
        const points = Array.isArray(culture?.homelands) ? culture.homelands : [];
        return {
            id: typeof culture?.id === "string" ? culture.id : null,
            name: typeof culture?.name === "string" ? culture.name : "",
            color: typeof culture?.color === "string" ? culture.color : DEFAULT.color,
            nameBase: typeof culture?.nameBase === "string" && culture.nameBase ? culture.nameBase : DEFAULT.nameBase,
            openness: number(culture?.openness, "openness"),
            density: number(culture?.density, "density"),
            habitat: {
                temperature: bandOf(habitat.temperature, 0, 1),
                moisture: bandOf(habitat.moisture, 0, 1),
                heightM: inMetres(bandOf(habitat.height, sea, 1), sea, metres),
                reliefM: inMetres(bandOf(habitat.relief, 0, FIELDS.relief.max), 0, metres),
                coast: number(habitat.coast, "coast"),
                river: number(habitat.river, "river"),
            },
            homelandCells: points.map((point) => modelCellAt(point, payload)).filter((cell) => cell >= 0),
            homelandsGiven: points.length,
        };
    });
}
