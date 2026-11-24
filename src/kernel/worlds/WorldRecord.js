import { RegionalRecord } from "./RegionalRecord.js";

/**
 * The world record (v5's family records; `claude/v5-s0-shell-handoff.md` §4) and the version gate
 * that tells a store written before it.
 *
 * A world record, kept by the store beside the maps it names:
 *
 *     {
 *       id, name,
 *       formatVersion: 5,
 *       settings: { setup, cultures, ages, nameStyle, styles, biomes, climate, icons },
 *       settingsRevision, settingsSavedAt,   // raised and set by each save that changes the settings
 *       maps: [{ id, type }],                // the world's maps; in S0 its Surface map only
 *       settlements: [card],                 // its settlement maps (L-surface; see settlementCard),
 *                                            // each kept by the store as part of the world (a
 *                                            // page of its journal in Foundry), never a saved map
 *       parentWorldId,                       // the world it was cut from, or null
 *       held,                                // a regional world still held by its parent: its
 *                                            // settings, all but its World setup, are read from
 *                                            // the top of its held chain (see settingsSource)
 *       regional,                            // a regional world's record, or null (step 2b)
 *       migration,                           // how a world made from a 4.3 map was made, or absent
 *     }
 *
 * And beside each map's data, its `meta`: `{ worldId, mapType, studio, revision, savedAt }`, where
 * `studio` is absent for the World studio's maps, `revision` rises by one with each save of the map
 * changed, and `savedAt` is when that save was (an ISO date; null for a map migrated from 4.3, whose
 * last save v5 did not see).
 *
 * The settings' groups are the shell's: every studio's world has them. What each group holds in a
 * map's data is the studio's (the World studio's is WorldSettings).
 */

/** The world record's format; a store with maps but no world records was written before it. */
export const WORLD_FORMAT = 5;

/** Every group of a world's settings, in the order the editors list them. */
export const WORLD_GROUPS = Object.freeze(["setup", "cultures", "ages", "nameStyle", "styles", "biomes", "climate", "icons"]);

/** The groups a held regional world takes from the world above it: all but its own World setup. */
export const LINKED_GROUPS = Object.freeze(WORLD_GROUPS.filter((group) => group !== "setup"));

/** The map types a world can hold; S0 makes only the Surface map. */
export const MAP_TYPES = Object.freeze({ SURFACE: "surface" });

/** A settlement map's type (the Local studio's): part of its world, not one of its `maps`. */
export const SETTLEMENT_TYPE = "settlement";

/** The parts of a settlement map's input its card keeps a fingerprint of (see the Local studio's OutOfDate). */
export const SETTLEMENT_PARTS = Object.freeze(["people", "style", "routes", "rivers", "ground", "cultures", "run"]);

/** A record id (Foundry's and the web's random ids, and ids a test gives). */
const ID = /^[A-Za-z0-9_-]{1,64}$/;
/** An 8-hex fingerprint. */
const PRINT = /^[0-9a-f]{8}$/;
/** The longest name a card keeps. */
const MAX_NAME = 200;
/** The most people a card shows (well past any settlement). */
const MAX_PEOPLE = 1e8;

const copy = (value) => (value === undefined ? undefined : structuredClone(value));

/** The largest thumbnail a map's card keeps (a data URL), well past the 320px images the studio makes. */
const MAX_THUMBNAIL = 256 * 1024;
const THUMBNAIL = /^data:image\/(?:webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/;

export class WorldRecord {
    /** A new world's pin icons: the built-ins only, none hidden. */
    /**
     * What Worlds shows of a map, kept on its entry in the world's `maps` (S0 step 3b): its
     * thumbnail (a small image drawn at each save), whether it has a run, and whether an older
     * generator made it. Read safely: a field that is not one is left out.
     * @param {*} card
     * @returns {{thumbnail?: string, run?: boolean, older?: boolean}}
     */
    static mapCard(card) {
        const out = {};
        if (!card || typeof card !== "object") return out;
        if (typeof card.thumbnail === "string" && card.thumbnail.length <= MAX_THUMBNAIL && THUMBNAIL.test(card.thumbnail)) out.thumbnail = card.thumbnail;
        if (typeof card.run === "boolean") out.run = card.run;
        if (typeof card.older === "boolean") out.older = card.older;
        // The map's revision and last changed save, as its record has them (shown in Worlds)
        if (Number.isInteger(card.revision) && card.revision >= 1) out.revision = card.revision;
        if (typeof card.savedAt === "string" && card.savedAt.length <= 40 && Number.isFinite(Date.parse(card.savedAt))) out.savedAt = card.savedAt;
        return out;
    }

    /**
     * What a world keeps of each of its settlement maps (L-surface), on its record's `settlements`:
     * enough to list it (its name, its pin's tier and people), to find its pin and the map it was
     * made from, and to tell whether it is Out of date without loading it (its input's
     * fingerprint by part, and the parts that differed at the last save). Read safely: a field
     * that is not one is left out, and a card without a usable id is null.
     * @param {*} card
     * @returns {object|null}
     */
    static settlementCard(card) {
        if (!card || typeof card !== "object" || !ID.test(card.id ?? "")) return null;
        const out = { id: card.id };
        if (ID.test(card.pinId ?? "")) out.pinId = card.pinId;
        if (ID.test(card.sourceMapId ?? "")) out.sourceMapId = card.sourceMapId;
        if (typeof card.name === "string") out.name = card.name.trim().slice(0, MAX_NAME);
        if (typeof card.tier === "string" && /^[A-Za-z]{1,40}$/.test(card.tier)) out.tier = card.tier;
        if (Number.isFinite(card.people) && card.people >= 0) out.people = Math.min(MAX_PEOPLE, Math.round(card.people));
        if (card.parts && typeof card.parts === "object" && !Array.isArray(card.parts)) {
            const parts = {};
            for (const part of SETTLEMENT_PARTS) if (PRINT.test(card.parts[part] ?? "")) parts[part] = card.parts[part];
            if (Object.keys(parts).length) out.parts = parts;
        }
        if (Array.isArray(card.stale)) out.stale = SETTLEMENT_PARTS.filter((part) => card.stale.includes(part));
        if (Number.isInteger(card.revision) && card.revision >= 1) out.revision = card.revision;
        if (typeof card.savedAt === "string" && card.savedAt.length <= 40 && Number.isFinite(Date.parse(card.savedAt))) out.savedAt = card.savedAt;
        return out;
    }

    /** A world's settlement map cards, read safely (each once). */
    static settlementCards(world) {
        const seen = new Set();
        const cards = [];
        for (const raw of Array.isArray(world?.settlements) ? world.settlements : []) {
            const card = WorldRecord.settlementCard(raw);
            if (!card || seen.has(card.id)) continue;
            seen.add(card.id);
            cards.push(card);
        }
        return cards;
    }

    /**
     * A world's state marks, as Worlds shows them (one set everywhere, S0 step 6 brings the rest):
     * `held` (a regional world reading its parent's settings), `older` (its Surface map made with
     * an older generator), `noRun` (its Surface map has no run yet), and, given every world,
     * `stale` (a held regional world Out of date, see RegionalRecord.staleness).
     * @param {object} world
     * @param {function(string): (object|null)} [byId] - Any world record by id (no `stale` without it).
     * @returns {string[]}
     */
    static marks(world, byId = null) {
        const surface = (world?.maps ?? []).find((map) => map.type === MAP_TYPES.SURFACE);
        const marks = [];
        if (world?.held) marks.push("held");
        // An older generator matters to a map it has run on
        if (surface?.older && surface.run !== false) marks.push("older");
        if (surface && surface.run === false && !world?.held) marks.push("noRun");
        if (byId && RegionalRecord.staleness(world, byId).length) marks.push("stale");
        return marks;
    }

    static emptyIcons() {
        return { custom: [], disabled: [] };
    }

    /**
     * A new world record.
     * @param {object} fields
     * @param {string} fields.id
     * @param {string} fields.name
     * @param {object} [fields.settings]
     * @param {Array<{id: string, type: string}>} [fields.maps]
     * @param {string|null} [fields.parentWorldId]
     * @param {boolean} [fields.held]
     * @returns {object}
     */
    static create({ id, name, settings = {}, maps = [], parentWorldId = null, held = false }) {
        return {
            id,
            name,
            formatVersion: WORLD_FORMAT,
            settings: { icons: WorldRecord.emptyIcons(), ...copy(settings) },
            settingsRevision: 1,
            settingsSavedAt: null,
            // Each map's card (what Worlds shows of it) as checked, with its id and type
            maps: maps.map((map) => ({ ...WorldRecord.mapCard(map), id: map.id, type: map.type })),
            settlements: [],
            parentWorldId,
            held: held === true,
            regional: null,
        };
    }

    /** The format a record was written in: absent or not a whole number reads as before v5 (0). */
    static formatOf(record) {
        return Number.isInteger(record?.formatVersion) && record.formatVersion > 0 ? record.formatVersion : 0;
    }

    /**
     * The world a held world's settings come from: the first world above it that is not held,
     * however far up (itself when it is not held). A parent no longer saved ends the climb, as does
     * a loop, which only a damaged store could hold.
     * @param {object} world
     * @param {(id: string) => object|null} byId
     * @returns {object}
     */
    static settingsSource(world, byId) {
        let source = world;
        const seen = new Set([world?.id]);
        while (source?.held && source.parentWorldId) {
            const parent = byId(source.parentWorldId);
            if (!parent || seen.has(parent.id)) break;
            seen.add(parent.id);
            source = parent;
        }
        return source;
    }

    /**
     * The settings a world reads: its own, or, while held, its own World setup with every other
     * group from the world its settings come from.
     * @param {object} world
     * @param {(id: string) => object|null} byId
     * @returns {object}
     */
    static effectiveSettings(world, byId) {
        const source = WorldRecord.settingsSource(world, byId);
        if (source === world || !source) return copy(world?.settings ?? {});
        return WorldRecord.linked(world.settings, source.settings);
    }

    /**
     * A held regional world's settings: its own World setup, every other group from `source`.
     * @param {object} own
     * @param {object} source
     * @returns {object}
     */
    static linked(own, source) {
        const settings = { setup: copy(own?.setup ?? {}) };
        for (const group of LINKED_GROUPS) settings[group] = copy(source?.[group] ?? (group === "icons" ? WorldRecord.emptyIcons() : {}));
        return settings;
    }

    /**
     * The groups in which two sets of settings differ.
     * @param {object} a
     * @param {object} b
     * @returns {string[]}
     */
    static changedGroups(a, b) {
        return WORLD_GROUPS.filter((group) => stableJson(a?.[group] ?? null) !== stableJson(b?.[group] ?? null));
    }
}

/** JSON with every object's keys in order, so two equal values always compare equal. */
export function stableJson(value) {
    return JSON.stringify(value, (_key, node) => (node && typeof node === "object" && !Array.isArray(node) ? Object.fromEntries(Object.keys(node).sort().map((key) => [key, node[key]])) : node));
}
