import { FILRODENSWMB } from "../config.js";

/**
 * A generator run's model-cell outputs as saved with a map (its `modelRun`, kept beside the map
 * data rather than in it, as the owner arrays are): what each model cell held (capacity,
 * population, land area, security, clearing, realm, duchy, county, water, dominant culture and the
 * culture shares) for the thematic layers and later runs to read, with the run's settings and
 * figures.
 *
 * Each array is quantised to the smallest type that keeps what matters (people as whole numbers,
 * land area to a tenth of a km², shares and security to 1/255, unit indices offset by one so -1
 * fits an unsigned type) and stored
 * as base64 of its little-endian bytes. Every platform the module runs on is little-endian, which
 * is what makes the byte order fixed.
 *
 * Shape: { version, run, revision, seed, settings, cellCount, cultures, stats,
 *          cells: { <name>: { type, scale, offset, data } }, ages, history }
 *
 * `ages` is how many ages were asked for and run; `history` holds each age before the last in
 * brief (its era's development and plague, its strife, its places as cell, tier and seat triples,
 * its castles and realm seats, and each cell's realm, packed as the cells' arrays are), for the
 * history layer to read.
 */

export const MODEL_RUN_VERSION = 1;

/** Array types by name, with the largest value each holds. */
const TYPES = Object.freeze({
    u8: Object.freeze({ Array: Uint8Array, max: 0xff }),
    u16: Object.freeze({ Array: Uint16Array, max: 0xffff }),
    u32: Object.freeze({ Array: Uint32Array, max: 0xffffffff }),
});

const UNIT = 255;

/** How each output is kept: its source in the run's model cells and its quantisation. */
const FIELDS = Object.freeze({
    capacity: Object.freeze({ type: "u32", scale: 1, offset: 0 }),
    population: Object.freeze({ type: "u32", scale: 1, offset: 0 }),
    // km² of land: a regional map's cells hold a few km², so tenths keep their density honest
    landArea: Object.freeze({ type: "u32", scale: 10, offset: 0 }),
    security: Object.freeze({ type: "u8", scale: UNIT, offset: 0 }),
    cleared: Object.freeze({ type: "u8", scale: UNIT, offset: 0 }),
    water: Object.freeze({ type: "u8", scale: 1, offset: 0 }),
    realm: Object.freeze({ type: "index", scale: 1, offset: 1 }),
    duchy: Object.freeze({ type: "index", scale: 1, offset: 1 }),
    county: Object.freeze({ type: "index", scale: 1, offset: 1 }),
    culture: Object.freeze({ type: "index", scale: 1, offset: 1 }),
});

/** The names of the arrays a saved run holds (the model cells' and the culture shares'). */
export const MODEL_RUN_ARRAYS = Object.freeze([...Object.keys(FIELDS), "shareStart", "shareCulture", "shareValue"]);

// ------------------------------------------------------------------ bytes and base64

function bytesToBase64(bytes) {
    const CHUNK = 0x8000;
    let binary = "";
    for (let start = 0; start < bytes.length; start += CHUNK) binary += String.fromCharCode(...bytes.subarray(start, start + CHUNK));
    return btoa(binary);
}

function base64ToBytes(text) {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return bytes;
}

/** The smallest unsigned type holding every value of an index or count array, plus one. */
function indexType(values) {
    let most = 0;
    for (const value of values) most = Math.max(most, value + 1);
    if (most <= TYPES.u8.max) return "u8";
    return most <= TYPES.u16.max ? "u16" : "u32";
}

/**
 * One array packed: each value times `scale`, plus `offset`, rounded and clamped to the type.
 * @returns {{type: string, scale: number, offset: number, data: string}}
 */
export function packArray(values, { type, scale = 1, offset = 0 }) {
    const resolved = type === "index" ? indexType(values) : type;
    const { Array: Typed, max } = TYPES[resolved];
    const packed = new Typed(values.length);
    for (let index = 0; index < values.length; index++) packed[index] = Math.min(max, Math.max(0, Math.round(values[index] * scale + offset)));
    return { type: resolved, scale, offset, data: bytesToBase64(new Uint8Array(packed.buffer)) };
}

/**
 * One array unpacked to numbers ((stored - offset) / scale).
 * @returns {Float64Array}
 */
export function unpackArray({ type, scale, offset, data }) {
    const { Array: Typed } = TYPES[type];
    const bytes = base64ToBytes(data);
    const stored = new Typed(bytes.buffer, 0, Math.floor(bytes.length / Typed.BYTES_PER_ELEMENT));
    return Float64Array.from(stored, (value) => (value - offset) / scale);
}

// ------------------------------------------------------------------ a run

/**
 * The saved form of a run.
 * @param {object} result - A generator run (Pipeline.runGenerator).
 * @param {string} runId - The id its generated content carries.
 * @returns {object}
 */
export function encodeModelRun(result, runId) {
    const cells = {};
    for (const [name, field] of Object.entries(FIELDS)) cells[name] = packArray(result.modelCells[name], field);
    cells.shareStart = packArray(result.modelCells.shareStart, { type: "index" });
    cells.shareCulture = packArray(result.modelCells.shareCulture, { type: "index", offset: 1 });
    cells.shareValue = packArray(result.modelCells.shareValue, { type: "u8", scale: UNIT });
    return {
        version: MODEL_RUN_VERSION,
        run: runId,
        revision: result.revision ?? FILRODENSWMB.GENERATOR.REVISION,
        seed: result.settings.seed,
        settings: structuredClone(result.settings),
        cellCount: result.cellCount,
        // The run's cultures in the order the cells' shares count them: each map culture's id (null
        // for the default culture), so a culture renamed or deleted since is still found, its name
        // and colour as they were, and its homeland cells
        cultures: result.cultures.map(({ id = null, name, color = null, nameBase, homelands = [], homelandsAuto = false, homelandsLeftOut = 0 }) => ({ id, name, color, nameBase, homelands, homelandsAuto, homelandsLeftOut })),
        stats: { ...result.stats },
        cells,
        ages: { asked: result.ages?.asked ?? 1, run: result.ages?.run ?? 1 },
        history: (result.history ?? []).map((age) => ({ ...age, places: Array.from(age.places), castles: Array.from(age.castles), seats: Array.from(age.seats), realm: packArray(age.realm, FIELDS.realm) })),
    };
}

/**
 * A saved run's arrays as numbers, by name (see MODEL_RUN_ARRAYS); an array missing from it is
 * left out.
 * @param {object} modelRun
 * @returns {Object<string, Float64Array>}
 */
export function decodeModelRun(modelRun) {
    const out = {};
    for (const name of MODEL_RUN_ARRAYS) {
        const packed = modelRun?.cells?.[name];
        if (packed && TYPES[packed.type]) out[name] = unpackArray(packed);
    }
    return out;
}

// ------------------------------------------------------------------ moving a run with its map

/** What a model cell that comes from beyond the map holds: open water, no one, in no unit. */
const EMPTY = Object.freeze({ water: 1, realm: -1, duchy: -1, county: -1, culture: -1 });
/** Values per history place: cell, tier, seat. */
const PLACE_FIELDS = 3;

/**
 * A run moved with its map, when the terrain is panned or rescaled (see MapStudio's noise frame):
 * the mesh's cells stay where they are and the land moves under them, so each model cell takes
 * what the run held in the model cell its site came from (`sourceOf`), as the region owners do.
 * A cell whose site came from beyond the map holds open water. The history's places, castles and
 * seats, and the cultures' homelands, are cells that moved, so each goes to the model cell its
 * old site lands on (`targetOf`), and is dropped when that is off the map.
 *
 * The run is otherwise kept as it was (its settings, figures and ages), and the original is not
 * changed, so it can be put back by an undo.
 *
 * @param {object} modelRun - A saved run.
 * @param {Int32Array} sourceOf - For each model cell, the cell it takes its values from, or -1.
 * @param {function(number): number} targetOf - Where an old model cell's site lands, or -1.
 * @returns {object} The moved run.
 */
export function resampleModelRun(modelRun, sourceOf, targetOf) {
    const arrays = decodeModelRun(modelRun);
    const count = sourceOf.length;
    const take = (values, empty) => Float64Array.from({ length: count }, (_, cell) => (sourceOf[cell] < 0 ? empty : values[sourceOf[cell]]));

    const cells = {};
    for (const [name, field] of Object.entries(FIELDS)) {
        if (arrays[name]) cells[name] = packArray(take(arrays[name], EMPTY[name] ?? 0), field);
    }
    Object.assign(cells, resampledShares(arrays, sourceOf));

    const moveCells = (list) => Array.from(list ?? [], targetOf).filter((cell) => cell >= 0);
    const history = (modelRun.history ?? []).map((age) => ({
        ...age,
        places: movedPlaces(age.places ?? [], targetOf),
        castles: moveCells(age.castles),
        seats: moveCells(age.seats),
        realm: age.realm ? packArray(take(unpackArray(age.realm), EMPTY.realm), FIELDS.realm) : age.realm,
    }));
    const cultures = (modelRun.cultures ?? []).map((culture) => ({ ...culture, homelands: moveCells(culture.homelands) }));
    return { ...modelRun, cultures, cells, history };
}

/** The culture shares, each cell's run taken from its source cell (none for a cell from beyond the map). */
function resampledShares({ shareStart, shareCulture, shareValue }, sourceOf) {
    if (!shareStart || !shareCulture || !shareValue) return {};
    const start = [0];
    const culture = [];
    const value = [];
    for (const source of sourceOf) {
        if (source >= 0) {
            for (let index = shareStart[source]; index < shareStart[source + 1]; index++) {
                culture.push(shareCulture[index]);
                value.push(shareValue[index]);
            }
        }
        start.push(culture.length);
    }
    return {
        shareStart: packArray(start, { type: "index" }),
        shareCulture: packArray(culture, { type: "index", offset: 1 }),
        shareValue: packArray(value, { type: "u8", scale: UNIT }),
    };
}

/** A history's places (cell, tier, seat triples) with their cells moved, those moved off the map dropped. */
function movedPlaces(places, targetOf) {
    const moved = [];
    for (let index = 0; index + PLACE_FIELDS <= places.length; index += PLACE_FIELDS) {
        const cell = targetOf(places[index]);
        if (cell >= 0) moved.push(cell, places[index + 1], places[index + 2]);
    }
    return moved;
}
