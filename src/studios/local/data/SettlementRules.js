import { KERNEL_PARTS } from "../../../kernel/config.js";
import { Sanitize } from "../../../kernel/data/Sanitize.js";
import { FRAME } from "../engine/LocalInput.js";
import { LIES } from "../engine/CellContext.js";
import { FORMS, HOUSEHOLD_HEADS, LINEAGES, ORDERS, WIVES } from "../../../kernel/names/NameConventions.js";

/**
 * A settlement map's record read safely (L-surface, `claude/v5-l-surface-step2-plan.md` §3.1):
 * from a world's store, a world file or a backup. The engine builds a settlement from the record's
 * input alone, so the input is checked field by field against the shape the engine makes itself:
 * numbers finite and in range, the few words it branches on from its own lists, strings and lists
 * capped. A frame must be one of the engine's own sizes (it sizes the rasters the build allocates),
 * so a record can never ask the engine for more than it would make of its own accord.
 *
 * `check` never throws: a field it cannot trust in the input refuses the whole record (null),
 * since a settlement drawn from a damaged input would not be the one that was kept; a field of the
 * record round the input that is not one takes its default.
 *
 * Nothing here touches the host, so it runs in tests and in the world file's reading as it is.
 */

/** The record's own format and version. */
export const SETTLEMENT_FORMAT = "fwmb-settlement";
export const SETTLEMENT_VERSION = 1;

/** The settings a settlement map keeps (step 4 adds their controls), and their defaults. */
export const WALLS = Object.freeze(["auto", "on", "off"]);
export const LOOKS = Object.freeze(["atlas", "theme"]);

const ID = /^[A-Za-z0-9_-]{1,64}$/;
/** A word the engine reads as a kind or class ("minor", "riverMouth", "GRASSLAND"). */
const WORD = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const COLOUR = /^#[0-9a-f]{6}$/i;
const MAX_NAME = 200;
const MAX_SEED = 200;
const MAX_TEXT = 80;
/** Lists' longest, well past what the engine makes (6 neighbours, a handful of roads). */
const MAX = Object.freeze({ roads: 32, rivers: 16, stretches: 32, neighbours: 32, cultures: 32, sectors: 16, places: 128, way: 512, cells: 4096 });
/** The largest figure a supply holds (people and food), and a distance in km. */
const BIG = 1e12;
const FAR_KM = 1e5;
/** The frames the engine makes, in metres, and their pixels at its fixed detail. */
const FRAMES = FRAME.SIZES_KM.map(([w, h]) => ({ width: w * 1000, height: h * 1000, widthPx: Math.round((w * 1000) / FRAME.M_PER_PX), heightPx: Math.round((h * 1000) / FRAME.M_PER_PX) }));

/** Thrown inside a check to refuse the record; caught by `check`. */
class Refused extends Error {}
const refuse = (what) => {
    throw new Refused(what);
};

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const num = (value, min, max, what) => (Number.isFinite(value) && value >= min && value <= max ? value : refuse(what));
const int = (value, min, max, what) => (Number.isInteger(value) && value >= min && value <= max ? value : refuse(what));
const bool = (value, what) => (typeof value === "boolean" ? value : refuse(what));
const word = (value, what) => (typeof value === "string" && WORD.test(value) ? value : refuse(what));
const oneOf = (value, list, what) => (list.includes(value) ? value : refuse(what));
const text = (value, max, what) => (typeof value === "string" ? value.slice(0, max) : refuse(what));
const bearing = (value, what) => num(value, 0, 360, what);
const share = (value, what) => num(value, 0, 1, what);
const nullable = (value, check) => (value === null || value === undefined ? null : check(value));
const list = (value, max, check, what) => (Array.isArray(value) && value.length <= max ? value.map((each) => check(each)) : refuse(what));
const object = (value, what) => (isObject(value) ? value : refuse(what));
const point = (value) => (Array.isArray(value) && value.length === 2 ? [num(value[0], -BIG, BIG, "a point"), num(value[1], -BIG, BIG, "a point")] : refuse("a point"));

const river = (value) => {
    object(value, "a river");
    const out = { from: bearing(value.from, "a river's bearing"), to: bearing(value.to, "a river's bearing"), widthM: num(value.widthM ?? 10, 0, 1e5, "a river's width") };
    if ("upstreamKm" in value) out.upstreamKm = nullable(value.upstreamKm, (km) => num(km, 0, FAR_KM, "a river's length"));
    if ("rises" in value) out.rises = bool(value.rises, "a river's rising");
    if ("endsIn" in value) out.endsIn = nullable(value.endsIn, (end) => word(end, "a river's end"));
    return out;
};

const modes = (value) => {
    object(value, "a route's modes");
    const out = {};
    for (const key of ["land", "road", "river", "sea", "km", "onRouteKm"]) if (key in value) out[key] = num(value[key], 0, FAR_KM, "a route's distance");
    return out;
};

const traded = (value, withPeople) => {
    object(value, "a trade");
    const out = { name: text(value.name, MAX_NAME, "a place's name"), tier: word(value.tier, "a place's tier"), amount: num(value.amount, -BIG, BIG, "an amount"), km: num(value.km, 0, FAR_KM, "a distance") };
    if (withPeople) out.people = num(value.people, 0, BIG, "a place's people");
    if ("modes" in value) out.modes = modes(value.modes);
    if ("way" in value) out.way = list(value.way, MAX.way, point, "a way");
    return out;
};

const supply = (value) => {
    object(value, "the supply");
    const figure = (key) => num(value[key], -BIG, BIG, `the supply's ${key}`);
    const out = { name: text(value.name, MAX_NAME, "the supply's name"), tier: word(value.tier, "the supply's tier") };
    for (const key of ["need", "eaten", "reserve", "own", "countryTotal", "imports", "exports", "balanceError"]) out[key] = figure(key);
    out.ownShare = share(value.ownShare, "the supply's own share");
    out.country = list(value.country ?? [], MAX.sectors, (sector) => {
        object(sector, "a sector");
        return {
            sector: word(sector.sector, "a sector"),
            amount: num(sector.amount, -BIG, BIG, "a sector's amount"),
            cells: int(sector.cells, 0, MAX.cells, "a sector's cells"),
            nearestKm: num(sector.nearestKm, 0, FAR_KM, "a sector's distance"),
            farthestKm: num(sector.farthestKm, 0, FAR_KM, "a sector's distance"),
            cost: num(sector.cost, 0, BIG, "a sector's cost"),
        };
    }, "the supply's country");
    out.fromPlaces = list(value.fromPlaces ?? [], MAX.places, (place) => traded(place, true), "the supply's places");
    out.out = nullable(value.out, (place) => traded(place, false));
    out.countryCells = list(value.countryCells ?? [], MAX.cells, (cell) => {
        object(cell, "a country cell");
        return { x: num(cell.x, -BIG, BIG, "a cell"), y: num(cell.y, -BIG, BIG, "a cell"), amount: num(cell.amount, -BIG, BIG, "a cell's amount") };
    }, "the supply's cells");
    if (value.withoutRun === true) out.withoutRun = true;
    return out;
};

const frame = (value) => {
    object(value, "the frame");
    const match = FRAMES.find((each) => each.width === value.width && each.height === value.height && each.widthPx === value.widthPx && each.heightPx === value.heightPx);
    return match ? { ...match } : refuse("the frame");
};

const culture = (value) => {
    object(value, "a culture");
    return {
        name: text(value.name, MAX_NAME, "a culture's name"),
        colour: typeof value.colour === "string" && COLOUR.test(value.colour) ? value.colour : "#9a8f7a",
        openness: share(value.openness ?? 0.5, "a culture's openness"),
        nameBase: text(value.nameBase ?? "English", MAX_TEXT, "a culture's name base"),
        share: share(value.share, "a culture's share"),
        ...namesOf(value),
    };
};

/** Each names setting's choices (N3), as the culture's in MapRules. */
const NAME_CHOICES = Object.freeze({ form: FORMS, order: ORDERS, lineage: LINEAGES, wife: WIVES });

/**
 * A culture's names settings (N3): only those chosen, as the input keeps them (see LocalInput's
 * cultures). An unknown value is left out, so it reads as Automatic, as it does on the world's
 * culture; it refuses nothing.
 */
function namesOf(value) {
    const out = {};
    if (value.names && typeof value.names === "object" && !Array.isArray(value.names)) {
        const names = Object.fromEntries(Object.entries(NAME_CHOICES).filter(([key, choices]) => choices.includes(value.names[key])).map(([key]) => [key, value.names[key]]));
        if (Object.keys(names).length) out.names = names;
    }
    if (HOUSEHOLD_HEADS.includes(value.heads)) out.heads = value.heads;
    return out;
}

/**
 * The engine's input, checked (see the class comment), or a Refused error.
 * @param {*} value
 * @returns {object}
 */
function input(value) {
    object(value, "the input");
    const kind = oneOf(value.kind, ["village", "town", "city"], "the kind of place");
    return {
        id: typeof value.id === "string" && ID.test(value.id) ? value.id : refuse("the place's id"),
        name: text(value.name, MAX_NAME, "the place's name"),
        seed: text(value.seed, MAX_SEED, "the seed"),
        population: int(value.population, 0, KERNEL_PARTS.USER_FIGURES.MAX_POPULATION, "the population"),
        tier: word(value.tier, "the tier"),
        kind,
        walled: bool(value.walled, "walled"),
        capital: bool(value.capital, "capital"),
        fortified: bool(value.fortified, "fortified"),
        port: bool(value.port, "port"),
        riverPort: bool(value.riverPort, "river port"),
        shore: nullable(value.shore, (shore) => {
            object(shore, "the shore");
            return {
                body: oneOf(shore.body, ["sea", "lake"], "the shore's water"),
                side: bearing(shore.side, "the shore's side"),
                stretches: nullable(shore.stretches, (stretches) => list(stretches, MAX.stretches, (each) => (object(each, "a stretch"), { from: bearing(each.from, "a stretch"), to: bearing(each.to, "a stretch"), share: share(each.share, "a stretch") }), "the shore's stretches")),
                island: bool(shore.island, "an island"),
            };
        }),
        roads: list(value.roads, MAX.roads, (road) => (object(road, "a road"), { bearing: bearing(road.bearing, "a road's bearing"), class: word(road.class, "a road's class") }), "the roads"),
        waterRoutes: list(value.waterRoutes, MAX.roads, (route) => (object(route, "a water route"), { bearing: bearing(route.bearing, "a route's bearing"), transport: word(route.transport, "a route's transport"), class: word(route.class, "a route's class") }), "the water routes"),
        river: nullable(value.river, river),
        otherRivers: list(value.otherRivers, MAX.rivers, river, "the other rivers"),
        water: nullable(value.water, (water) => (object(water, "the water"), { body: word(water.body, "the water"), chosenBy: text(water.chosenBy ?? "", MAX_TEXT, "the water"), side: bearing(water.side, "the water's side") })),
        kindOfPlace: word(value.kindOfPlace, "the kind of place"),
        relief: (() => {
            const relief = object(value.relief, "the relief");
            return { heightM: num(relief.heightM, -1e4, 1e5, "the height"), slopeMPerKm: num(relief.slopeMPerKm, 0, 1e5, "the slope"), downhill: nullable(relief.downhill, (b) => bearing(b, "downhill")), lie: oneOf(relief.lie, LIES, "the lie") };
        })(),
        climate: (() => {
            const climate = object(value.climate, "the climate");
            return { temperature: share(climate.temperature, "the temperature"), moisture: share(climate.moisture, "the moisture") };
        })(),
        biome: word(value.biome, "the biome"),
        neighbours: list(value.neighbours, MAX.neighbours, (each) => (object(each, "a neighbour"), { name: text(each.name, MAX_NAME, "a neighbour's name"), tier: word(each.tier, "a neighbour's tier"), km: num(each.km, 0, FAR_KM, "a neighbour's distance"), bearing: bearing(each.bearing, "a neighbour's bearing") }), "the neighbours"),
        frame: frame(value.frame),
        frameShare: share(value.frameShare, "the frame's share"),
        ownShare: nullable(value.ownShare, (s) => share(s, "the own share")),
        ownFood: nullable(value.ownFood, (food) => num(food, 0, BIG, "the own food")),
        supply: nullable(value.supply, supply),
        countryDensity: num(value.countryDensity, 0, 1e7, "the country's density"),
        security: num(value.security, 0, 1, "the security"),
        cultures: (() => {
            const cultures = list(value.cultures, MAX.cultures, culture, "the cultures");
            return cultures.length ? cultures : refuse("the cultures");
        })(),
    };
}

/** The input's fingerprint by part (see the Local studio's OutOfDate): 8 hex each, or left out. */
const PRINT = /^[0-9a-f]{8}$/;

export class SettlementRules {
    /**
     * The engine's input checked alone (see the class comment).
     * @param {*} value
     * @returns {object|null}
     */
    static input(value) {
        try {
            return input(value);
        } catch (error) {
            if (error instanceof Refused) return null;
            throw error;
        }
    }

    /**
     * A settlement map's record read safely, or null when it cannot be trusted (no usable id, pin
     * or input). Unsafe keys are dropped first (Sanitize.plainTree's walk).
     * @param {*} raw
     * @returns {object|null}
     */
    static check(raw) {
        let tree;
        try {
            tree = Sanitize.plainTree(raw);
        } catch {
            return null;
        }
        if (!isObject(tree) || tree.format !== SETTLEMENT_FORMAT) return null;
        if (!Number.isInteger(tree.version) || tree.version < 1 || tree.version > SETTLEMENT_VERSION) return null;
        if (!ID.test(tree.id ?? "") || !ID.test(tree.pinId ?? "")) return null;
        const checked = SettlementRules.input(tree.input);
        if (!checked) return null;
        const parts = {};
        if (isObject(tree.parts)) for (const [key, print] of Object.entries(tree.parts)) if (WORD.test(key) && PRINT.test(print ?? "")) parts[key] = print;
        const date = (value) => (typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value)) ? value : null);
        return {
            format: SETTLEMENT_FORMAT,
            version: SETTLEMENT_VERSION,
            engineRevision: Number.isInteger(tree.engineRevision) && tree.engineRevision >= 1 ? tree.engineRevision : 1,
            id: tree.id,
            pinId: tree.pinId,
            sourceMapId: ID.test(tree.sourceMapId ?? "") ? tree.sourceMapId : null,
            name: typeof tree.name === "string" && tree.name.trim() ? tree.name.trim().slice(0, MAX_NAME) : checked.name,
            // The kept version's seed is the input's own
            seed: checked.seed,
            keptAt: date(tree.keptAt),
            input: checked,
            parts,
            settings: { walls: WALLS.includes(tree.settings?.walls) ? tree.settings.walls : "auto" },
            look: LOOKS.includes(tree.look) ? tree.look : "atlas",
            revision: Number.isInteger(tree.revision) && tree.revision >= 1 ? tree.revision : 1,
            savedAt: date(tree.savedAt),
        };
    }
}
