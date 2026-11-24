import { hashString } from "../../../kernel/random/Random.js";
import { stableJson } from "../../../kernel/worlds/WorldRecord.js";
import { ENGINE_REVISION } from "../engine/Town.js";
import { SETTLEMENT_FORMAT, SETTLEMENT_VERSION } from "./SettlementRules.js";

/**
 * A settlement map's record (`claude/v5-l-surface-step2-plan.md` §3.1): what is kept of a settlement
 * map once a version is kept. Nothing generated is stored: the engine's whole input as taken, the
 * kept version's seed (the input's own), and the map's settings. The map always rebuilds exactly
 * from its record, so a parent's change reaches it only through Generate again.
 *
 *     { format, version, engineRevision, id, pinId, sourceMapId, name, seed, keptAt, input, parts,
 *       settings: { walls }, look, revision, savedAt }
 *
 * `parts` is the input's fingerprint by part (PARTS): what Out of date compares with the input the
 * parent would give now, naming what changed. The place's name is in no part, so renaming the pin
 * renames the map without making it Out of date (Ken, 2026-11-24). The parts hold what the input
 * is made from, never what the engine works out from it (its plan, walls, frame and own share
 * follow its people and tier), so a change is named once, by its cause.
 *
 * **Its supply** is not fingerprinted: the run's supply plan is worked over every place, so any
 * place's change moves every other's a little (on the fixture, a town's people raised a fifth moved
 * each of the others' figures by up to 12%). Its main figures (SUPPLY_FIGURES: the country's people
 * a km², and what the place needs from its own country, other places, imports and exports, as
 * shares of its need) are kept on the card and compared within LOCAL.SUPPLY_TOLERANCE.
 *
 * Pure: no host, no DOM.
 */

/** The input's fields in each part, as Out of date names them. */
export const PARTS = Object.freeze({
    people: Object.freeze(["population"]),
    style: Object.freeze(["tier", "capital", "fortified", "port", "riverPort"]),
    routes: Object.freeze(["roads", "waterRoutes"]),
    rivers: Object.freeze(["river", "otherRivers", "water", "shore"]),
    ground: Object.freeze(["relief", "climate", "biome", "kindOfPlace"]),
    cultures: Object.freeze(["cultures"]),
    run: Object.freeze(["security", "neighbours"]),
});

/** Every part Out of date can name: the fingerprinted ones, then "supply" (compared by its figures). */
export const OUT_OF_DATE_PARTS = Object.freeze([...Object.keys(PARTS), "supply"]);

/** The supply's main figures, as SettlementRecord.supplyOf gives them. */
export const SUPPLY_FIGURES = Object.freeze(["density", "country", "bought", "imports", "exports"]);

/** Names inside a part that are the places' own (the supply names its place and its trade partners). */
const NAME_KEYS = new Set(["name"]);

/** A part's fingerprint: its fields' values with the places' names left out, hashed (8 hex). */
function printOf(input, fields) {
    const values = fields.map((field) => withoutNames(input?.[field] ?? null));
    return (hashString(stableJson(values)) >>> 0).toString(16).padStart(8, "0");
}

/** A value with every `name` field left out, at any depth (a neighbour renamed is not a change). */
function withoutNames(value) {
    if (Array.isArray(value)) return value.map(withoutNames);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !NAME_KEYS.has(key)).map(([key, each]) => [key, withoutNames(each)]));
    return value;
}

export class SettlementRecord {
    /**
     * The input's fingerprint by part.
     * @param {object} input
     * @returns {Record<string, string>}
     */
    static parts(input) {
        return Object.fromEntries(Object.entries(PARTS).map(([part, fields]) => [part, printOf(input, fields)]));
    }

    /**
     * The parts whose fingerprint differs between two sets (a part missing from either counts as
     * unchanged: a record saved before the part existed is not Out of date for it).
     * @param {Record<string, string>} saved
     * @param {Record<string, string>} now
     * @returns {string[]}
     */
    static changed(saved, now) {
        return Object.keys(PARTS).filter((part) => saved?.[part] && now?.[part] && saved[part] !== now[part]);
    }

    /**
     * Its supply's main figures (see the class comment): the country's people a km², and the
     * shares of its need it takes from its own country, buys from other places, imports and
     * exports. Null on an input with no supply.
     * @param {object} input
     * @returns {{density: number, country: number, bought: number, imports: number, exports: number}|null}
     */
    static supplyOf(input) {
        const supply = input?.supply;
        if (!supply || !(supply.need > 0)) return null;
        const share = (amount) => Math.round(((Number(amount) || 0) / supply.need) * 1000) / 1000;
        const bought = (supply.fromPlaces ?? []).reduce((sum, from) => sum + (Number(from?.amount) || 0), 0);
        return { density: Math.round((Number(input.countryDensity) || 0) * 100) / 100, country: share(supply.countryTotal), bought: share(bought), imports: share(supply.imports), exports: share(supply.exports) };
    }

    /**
     * Whether its supply changed past the tolerance (a share of its need by more than
     * SUPPLY_TOLERANCE.SHARE, the country's density by more than SUPPLY_TOLERANCE.DENSITY of
     * itself). Either missing (a map kept before its figures were kept, a map with no run) counts
     * as unchanged.
     * @param {object|null} saved
     * @param {object|null} now
     * @param {{SHARE: number, DENSITY: number}} tolerance
     */
    static supplyChanged(saved, now, tolerance) {
        if (!saved || !now) return false;
        for (const figure of SUPPLY_FIGURES) {
            if (!Number.isFinite(saved[figure]) || !Number.isFinite(now[figure])) continue;
            if (figure === "density") {
                if (Math.abs(now.density - saved.density) > tolerance.DENSITY * Math.max(1, saved.density)) return true;
            } else if (Math.abs(now[figure] - saved[figure]) > tolerance.SHARE) return true;
        }
        return false;
    }

    /**
     * A new record for a kept version.
     * @param {object} fields
     * @param {string} fields.id
     * @param {string} fields.pinId
     * @param {string|null} fields.sourceMapId
     * @param {string} fields.name
     * @param {object} fields.input - The kept version's input (its seed the version's).
     * @param {string} [fields.keptAt]
     * @returns {object}
     */
    static create({ id, pinId, sourceMapId = null, name, input, keptAt = new Date().toISOString() }) {
        return {
            format: SETTLEMENT_FORMAT,
            version: SETTLEMENT_VERSION,
            engineRevision: ENGINE_REVISION,
            id,
            pinId,
            sourceMapId,
            name,
            seed: input.seed,
            keptAt,
            input: structuredClone(input),
            parts: SettlementRecord.parts(input),
            settings: { walls: "auto" },
            look: "atlas",
            revision: 1,
            savedAt: null,
        };
    }

    /**
     * What the world keeps of a record (WorldRecord.settlementCard): its name, its pin's tier and
     * people, and its parts.
     * @param {object} record
     * @param {string[]} [stale] - The parts Out of date at this save.
     */
    static card(record, stale = []) {
        const card = { id: record.id, pinId: record.pinId, sourceMapId: record.sourceMapId, name: record.name, tier: record.input.tier, people: record.input.population, parts: { ...record.parts }, stale: [...stale], revision: record.revision, savedAt: record.savedAt };
        const supply = SettlementRecord.supplyOf(record.input);
        if (supply) card.supply = supply;
        return card;
    }
}
