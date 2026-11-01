import { FILRODENSWMB } from "../config.js";
import { ProceduralEngine } from "../generation/ProceduralEngine.js";

/**
 * What the generator reads from biomes. The model knows the built-in land biomes' meaning
 * (GENERATOR.BIOMES: farming, cover, travel and raiders, the properties GENERATOR.BIOME_PROPERTIES
 * lists), so every land pixel is reduced to a biome whose numbers it knows:
 * - a built-in biome (by the climate, or painted) is itself;
 * - a custom biome with numbers of its own (`properties`) is itself, with those numbers; a number
 *   it leaves out comes from the built-in biome it behaves like, or is the property's neutral
 *   default when it behaves like none;
 * - any other custom biome behaves as the built-in biome its `behavesLike` names, or, when it
 *   names none, as the built-in biome the climate would give at that pixel.
 *
 * So a map whose custom biomes are left on "underlying biome" with no numbers of their own gives
 * exactly the output it would with no custom biomes at all: painting a custom biome changes
 * nothing the model sees until it is told how that biome behaves.
 */

/** Built-in biome ids are small (see BIOME_IDS); custom ids follow them, below 256. */
const SLOTS = Math.max(...Object.values(FILRODENSWMB.BIOME_IDS)) + 1;
const KEY_OF_ID = Object.freeze(Object.fromEntries(Object.entries(FILRODENSWMB.BIOME_IDS).map(([key, id]) => [id, key])));

/** The property keys, in GENERATOR.BIOME_PROPERTIES' order. */
export const PROPERTY_KEYS = Object.freeze(FILRODENSWMB.GENERATOR.BIOME_PROPERTIES.map((property) => property.key));

/** The last tables made, with the custom biomes they were made for (a run asks many times). */
let cached = { signature: null, tables: null };

/**
 * The model properties of the built-in land biomes, and of the custom biomes with numbers of their
 * own, as tables indexed by biome id. Id 0 (water, or nothing), the water biomes and custom biomes
 * without numbers take neutral values (their pixels are reduced to a built-in id first).
 * @param {object[]} [customBiomes] - The run's custom biomes (`{ id, behavesLike, properties }`).
 * @returns {{slots: number, ids: number[], farming: Float64Array, cover: Float64Array, travel: Float64Array, raiders: Float64Array}}
 */
export function biomeProperties(customBiomes = []) {
    const own = ownNumbers(customBiomes);
    const signature = JSON.stringify([...own]);
    if (cached.signature === signature) return cached.tables;
    const slots = Math.max(SLOTS, ...[...own.keys()].map((id) => id + 1));
    const table = () => new Float64Array(slots).fill(1);
    const tables = { slots, ids: [] };
    for (const key of PROPERTY_KEYS) tables[key] = table();
    for (const [key, properties] of Object.entries(FILRODENSWMB.GENERATOR.BIOMES)) {
        const id = FILRODENSWMB.BIOME_IDS[key];
        tables.ids.push(id);
        for (const name of PROPERTY_KEYS) tables[name][id] = properties[name];
    }
    for (const [id, numbers] of own) {
        tables.ids.push(id);
        for (const name of PROPERTY_KEYS) tables[name][id] = numbers[name];
    }
    tables.ids.sort((a, b) => a - b);
    cached = { signature, tables };
    return tables;
}

/**
 * Each custom biome with numbers of its own, by id, with every property filled: its own number,
 * else the built-in biome it behaves like's, else the property's default.
 * @param {object[]} customBiomes
 * @returns {Map<number, Record<string, number>>}
 */
export function ownNumbers(customBiomes = []) {
    const own = new Map();
    for (const biome of customBiomes) {
        const properties = biome?.properties;
        if (!properties || typeof properties !== "object" || !(biome.id >= SLOTS && biome.id <= 255)) continue;
        const like = isModelBiome(biome.behavesLike) ? FILRODENSWMB.GENERATOR.BIOMES[biome.behavesLike] : null;
        const numbers = {};
        for (const property of FILRODENSWMB.GENERATOR.BIOME_PROPERTIES) {
            const value = Number(properties[property.key]);
            numbers[property.key] = Number.isFinite(value) ? Math.min(property.max, Math.max(property.min, value)) : (like?.[property.key] ?? property.default);
        }
        own.set(biome.id, numbers);
    }
    return own;
}

/**
 * A custom biome's numbers as the dialogue starts them: its own, or those of the built-in biome
 * it behaves like, or the defaults.
 * @param {object} biome
 * @returns {Record<string, number>}
 */
export function startingNumbers(biome) {
    const like = isModelBiome(biome?.behavesLike) ? FILRODENSWMB.GENERATOR.BIOMES[biome.behavesLike] : null;
    const numbers = {};
    for (const property of FILRODENSWMB.GENERATOR.BIOME_PROPERTIES) numbers[property.key] = biome?.properties?.[property.key] ?? like?.[property.key] ?? property.default;
    return numbers;
}

/** True for a built-in land biome key the model has properties for. */
export function isModelBiome(key) {
    return Object.hasOwn(FILRODENSWMB.GENERATOR.BIOMES, key);
}

/**
 * The id each custom biome is read as: its own id when it has numbers of its own, else its
 * `behavesLike` key's id, or 0 for "the underlying biome" (also the answer for a missing or
 * unknown key).
 * @param {object[]} customBiomes
 * @returns {Map<number, number>}
 */
export function behavesLikeTable(customBiomes = []) {
    const table = new Map();
    const own = ownNumbers(customBiomes);
    for (const biome of customBiomes) {
        const key = biome?.behavesLike;
        // A biome with numbers of its own is read as itself (see biomeProperties)
        if (own.has(biome?.id)) table.set(biome.id, biome.id);
        else table.set(biome?.id, isModelBiome(key) ? FILRODENSWMB.BIOME_IDS[key] : 0);
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
 * The id a resolved land biome is read as: a built-in biome or a custom biome with numbers of
 * its own as itself, any other custom biome as the built-in biome it behaves as.
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
