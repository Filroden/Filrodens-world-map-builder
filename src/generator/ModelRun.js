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
 * `cells` also holds the last round's trade, per edge rather than per cell (tradeFrom, tradeTo,
 * tradeKind, tradeValue; see TRADE). `ages` is how many ages were asked for and run; `history`
 * holds each age before the last in brief, for the History tool to draw:
 *   - its era's development and plague, and its strife;
 *   - its places as cell, tier and seat triples, with their names (`placeNames`);
 *   - its castles, with their names and kinds of keep (`castleNames`, `castleKeeps`);
 *   - its realms' seats (one per realm, -1 for one moved off the map), names (`realmNames`) and
 *     people (`realmPeople`);
 *   - each cell's realm and main culture (as the run's `cultures` count them), packed as the
 *     cells' arrays are;
 *   - its roads, the land edges that carried its trade (`roadFrom`, `roadTo`, packed).
 * A run saved before the names, people, cultures and roads were kept lacks them.
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

/**
 * The last round's trade, one entry per edge that carried any: its two model cells, its transport
 * (0 road, 1 river, 2 sea) and its traffic as a share of the busiest edge's, kept to a millionth
 * (the busiest edge carries a thousand times the quietest's and more, so a coarser step would
 * round the quiet lanes away).
 */
const TRADE = Object.freeze({
    tradeFrom: Object.freeze({ source: "from", type: "index", scale: 1, offset: 0 }),
    tradeTo: Object.freeze({ source: "to", type: "index", scale: 1, offset: 0 }),
    tradeKind: Object.freeze({ source: "kind", type: "u8", scale: 1, offset: 0 }),
    tradeValue: Object.freeze({ source: "value", type: "u32", scale: 1e6, offset: 0 }),
});

/** The names of the arrays a saved run holds (the model cells', the culture shares' and the trade's). */
export const MODEL_RUN_ARRAYS = Object.freeze([...Object.keys(FIELDS), "shareStart", "shareCulture", "shareValue", ...Object.keys(TRADE)]);

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
    // Kept with the cells' arrays (they are packed the same way), though they run per edge
    if (result.trade) for (const [name, field] of Object.entries(TRADE)) cells[name] = packArray(result.trade[field.source], field);
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
        history: (result.history ?? []).map(encodeAge),
    };
}

/** How an age's roads are kept: model cell ids. */
const ROAD = Object.freeze({ type: "index", scale: 1, offset: 0 });

/** An earlier age in its saved form: its lists as plain arrays, its per-cell and road arrays packed. */
function encodeAge(age) {
    const { realm, culture, roadFrom, roadTo, ...rest } = age;
    const saved = { ...rest, places: Array.from(age.places), castles: Array.from(age.castles), seats: Array.from(age.seats), realm: packArray(realm, FIELDS.realm) };
    if (culture) saved.culture = packArray(culture, FIELDS.culture);
    if (roadFrom && roadTo) {
        saved.roadFrom = packArray(roadFrom, ROAD);
        saved.roadTo = packArray(roadTo, ROAD);
    }
    return saved;
}

/**
 * A saved earlier age's packed arrays as numbers: each cell's realm and culture (-1 for none), and
 * its roads' ends. An array the age lacks is null.
 * @param {object} age - One entry of a saved run's history.
 * @returns {{realm: Float64Array|null, culture: Float64Array|null, roadFrom: Float64Array|null, roadTo: Float64Array|null}}
 */
export function decodeAge(age) {
    const read = (packed) => (packed && TYPES[packed.type] ? unpackArray(packed) : null);
    return { realm: read(age?.realm), culture: read(age?.culture), roadFrom: read(age?.roadFrom), roadTo: read(age?.roadTo) };
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
    Object.assign(cells, movedTrade(arrays, targetOf));

    const moveCells = (list) => Array.from(list ?? [], targetOf).filter((cell) => cell >= 0);
    const history = (modelRun.history ?? []).map((age) => movedAge(age, take, targetOf));
    const cultures = (modelRun.cultures ?? []).map((culture) => ({ ...culture, homelands: moveCells(culture.homelands) }));
    return { ...modelRun, cultures, cells, history };
}

/**
 * An earlier age moved with its map: its per-cell arrays taken from their source cells, its places
 * and castles moved with their names (those moved off the map dropped with them), its seats moved
 * in place (-1 for one off the map, so each still stands at its realm's index), and its roads moved
 * as the trade's edges are.
 */
function movedAge(age, take, targetOf) {
    const moved = { ...age };
    const places = movedPlaces(age.places ?? [], targetOf, age.placeNames);
    moved.places = places.places;
    if (age.placeNames) moved.placeNames = places.names;
    const castles = [];
    const kept = [];
    (age.castles ?? []).forEach((cell, index) => {
        const target = targetOf(cell);
        if (target < 0) return;
        castles.push(target);
        kept.push(index);
    });
    moved.castles = castles;
    if (age.castleNames) moved.castleNames = kept.map((index) => age.castleNames[index]);
    if (age.castleKeeps) moved.castleKeeps = kept.map((index) => age.castleKeeps[index]);
    moved.seats = Array.from(age.seats ?? [], (cell) => (cell >= 0 ? targetOf(cell) : -1));
    const { realm, culture, roadFrom, roadTo } = decodeAge(age);
    if (realm) moved.realm = packArray(take(realm, EMPTY.realm), FIELDS.realm);
    if (culture) moved.culture = packArray(take(culture, EMPTY.culture), FIELDS.culture);
    if (roadFrom && roadTo) {
        const from = [];
        const to = [];
        for (let edge = 0; edge < roadFrom.length; edge++) {
            const a = targetOf(roadFrom[edge]);
            const b = targetOf(roadTo[edge]);
            if (a < 0 || b < 0 || a === b) continue;
            from.push(a);
            to.push(b);
        }
        moved.roadFrom = packArray(from, ROAD);
        moved.roadTo = packArray(to, ROAD);
    }
    return moved;
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

/**
 * The trade edges with their cells moved; an edge either end of which moved off the map, or whose
 * ends now share a cell, is dropped.
 */
function movedTrade(arrays, targetOf) {
    if (!arrays.tradeFrom || !arrays.tradeTo || !arrays.tradeKind || !arrays.tradeValue) return {};
    const kept = { from: [], to: [], kind: [], value: [] };
    for (let edge = 0; edge < arrays.tradeFrom.length; edge++) {
        const from = targetOf(arrays.tradeFrom[edge]);
        const to = targetOf(arrays.tradeTo[edge]);
        if (from < 0 || to < 0 || from === to) continue;
        kept.from.push(from);
        kept.to.push(to);
        kept.kind.push(arrays.tradeKind[edge]);
        kept.value.push(arrays.tradeValue[edge]);
    }
    return Object.fromEntries(Object.entries(TRADE).map(([name, field]) => [name, packArray(kept[field.source], field)]));
}

/**
 * A history's places (cell, tier, seat triples) with their cells moved, and their names with them;
 * those moved off the map are dropped.
 */
function movedPlaces(places, targetOf, names = null) {
    const moved = [];
    const movedNames = [];
    for (let index = 0; index + PLACE_FIELDS <= places.length; index += PLACE_FIELDS) {
        const cell = targetOf(places[index]);
        if (cell < 0) continue;
        moved.push(cell, places[index + 1], places[index + 2]);
        movedNames.push(names?.[index / PLACE_FIELDS] ?? "");
    }
    return { places: moved, names: movedNames };
}
