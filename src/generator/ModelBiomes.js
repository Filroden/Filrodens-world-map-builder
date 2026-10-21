import { FILRODENSWMB } from "../config.js";
import { ProceduralEngine } from "../generation/ProceduralEngine.js";

/**
 * What the generator reads from biomes. The model knows only the built-in land biomes' meaning
 * (GENERATOR.BIOMES: farming, cover, travel and raiders), so every land pixel is reduced to the
 * built-in biome it behaves as:
 * - a built-in biome (by the climate, or painted) is itself;
 * - a custom biome (painted, or placed by its rules) behaves as the built-in biome its `behavesLike`
 *   names, or, when it names none, as the built-in biome the climate would give at that pixel.
 *
 * So a map whose custom biomes are left on "underlying biome" gives exactly the output it would
 * with no custom biomes at all: painting a custom biome changes nothing the model sees until it is
 * told how that biome behaves.
 */

/** Biome ids are small (built-in ids, see BIOME_IDS); the property tables are indexed by id. */
const SLOTS = Math.max(...Object.values(FILRODENSWMB.BIOME_IDS)) + 1;
const KEY_OF_ID = Object.freeze(Object.fromEntries(Object.entries(FILRODENSWMB.BIOME_IDS).map(([key, id]) => [id, key])));

let tables = null;

/**
 * The model properties of the built-in land biomes as tables indexed by biome id. Id 0 (water, or
 * nothing) and the water biomes take neutral values.
 * @returns {{slots: number, ids: number[], farming: Float64Array, cover: Float64Array, travel: Float64Array, raiders: Float64Array}}
 */
export function biomeProperties() {
    if (tables) return tables;
    const table = () => new Float64Array(SLOTS).fill(1);
    tables = { slots: SLOTS, ids: [], farming: table(), cover: table(), travel: table(), raiders: table() };
    for (const [key, properties] of Object.entries(FILRODENSWMB.GENERATOR.BIOMES)) {
        const id = FILRODENSWMB.BIOME_IDS[key];
        tables.ids.push(id);
        for (const name of ["farming", "cover", "travel", "raiders"]) tables[name][id] = properties[name];
    }
    tables.ids.sort((a, b) => a - b);
    return tables;
}

/** True for a built-in land biome key the model has properties for. */
export function isModelBiome(key) {
    return Object.hasOwn(FILRODENSWMB.GENERATOR.BIOMES, key);
}

/**
 * The built-in id each custom biome behaves as: its `behavesLike` key's id, or 0 for "the
 * underlying biome" (also the answer for a missing or unknown key).
 * @param {object[]} customBiomes
 * @returns {Map<number, number>}
 */
export function behavesLikeTable(customBiomes = []) {
    const table = new Map();
    for (const biome of customBiomes) {
        const key = biome?.behavesLike;
        table.set(biome?.id, isModelBiome(key) ? FILRODENSWMB.BIOME_IDS[key] : 0);
    }
    return table;
}

/**
 * The built-in biome id each land pixel behaves as (0 for water: sea or lake).
 *
 * @param {object} input
 * @param {Float32Array} input.elevation
 * @param {Float32Array} input.moisture
 * @param {Float32Array} input.temperature
 * @param {Float32Array} input.waterMask - Above 0 where a pixel is lake.
 * @param {Uint8Array|Uint16Array|null} input.biomeOverrides - Painted biome ids (0 for none).
 * @param {number} input.seaLevel
 * @param {object} input.biomeParams - { customBiomeRules, biomePalette, biomeSides }, as
 *     MapStateManager.getDerivedMapParameters compiles them for the biome layer.
 * @param {object[]} [input.customBiomes]
 * @returns {Uint8Array}
 */
export function modelBiomeRaster(input) {
    const { elevation, moisture, temperature, waterMask, biomeOverrides, seaLevel, biomeParams } = input;
    const behaves = behavesLikeTable(input.customBiomes);
    const out = new Uint8Array(elevation.length);
    const rules = biomeParams?.customBiomeRules ?? null;
    for (let pixel = 0; pixel < out.length; pixel++) {
        const height = elevation[pixel];
        if (height < seaLevel || waterMask[pixel] > 0) continue;
        const override = biomeOverrides ? biomeOverrides[pixel] : 0;
        const { land } = ProceduralEngine.resolveBiomeLookup(override, height, moisture[pixel], temperature[pixel], seaLevel, waterMask, pixel, rules, biomeParams?.biomePalette, biomeParams?.biomeSides);
        out[pixel] = modelIdOf(land, behaves, () => ProceduralEngine.getBiomeKey(height, moisture[pixel], temperature[pixel], seaLevel));
    }
    return out;
}

/**
 * The built-in id a resolved land biome behaves as.
 * @param {string|number} land - A built-in key, or a biome id (built-in or custom).
 * @param {Map<number, number>} behaves
 * @param {function(): string} underlying - The built-in key the climate gives here.
 */
function modelIdOf(land, behaves, underlying) {
    if (typeof land === "string") return idOfKey(land, underlying);
    if (KEY_OF_ID[land] && isModelBiome(KEY_OF_ID[land])) return land;
    const like = behaves.get(land) ?? 0;
    return like || idOfKey(underlying(), () => "GRASSLAND");
}

function idOfKey(key, fallback) {
    return isModelBiome(key) ? FILRODENSWMB.BIOME_IDS[key] : FILRODENSWMB.BIOME_IDS[fallback()];
}
