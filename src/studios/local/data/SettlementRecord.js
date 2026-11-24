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
 * renames the map without making it Out of date (Ken, 2026-11-24).
 *
 * Pure: no host, no DOM.
 */

/** The input's fields in each part, as Out of date names them. */
export const PARTS = Object.freeze({
    people: Object.freeze(["population"]),
    style: Object.freeze(["tier", "kind", "walled", "capital", "fortified", "port", "riverPort"]),
    routes: Object.freeze(["roads", "waterRoutes"]),
    rivers: Object.freeze(["river", "otherRivers", "water", "shore"]),
    ground: Object.freeze(["relief", "climate", "biome", "kindOfPlace", "frame"]),
    cultures: Object.freeze(["cultures"]),
    run: Object.freeze(["supply", "countryDensity", "security", "frameShare", "ownShare", "ownFood", "neighbours"]),
});

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
        return { id: record.id, pinId: record.pinId, sourceMapId: record.sourceMapId, name: record.name, tier: record.input.tier, people: record.input.population, parts: { ...record.parts }, stale: [...stale], revision: record.revision, savedAt: record.savedAt };
    }
}
