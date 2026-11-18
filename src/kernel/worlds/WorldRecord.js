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

const copy = (value) => (value === undefined ? undefined : structuredClone(value));

export class WorldRecord {
    /** A new world's pin icons: the built-ins only, none hidden. */
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
            maps: maps.map(({ id: mapId, type }) => ({ id: mapId, type })),
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
