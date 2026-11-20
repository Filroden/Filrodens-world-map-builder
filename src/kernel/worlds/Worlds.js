import { platform } from "../../platform/index.js";
import { MAP_TYPES, WorldRecord } from "./WorldRecord.js";
import { RegionalRecord } from "./RegionalRecord.js";

/**
 * The world records and their maps, over the platform's store (v5's family records; see
 * WorldRecord for the fields). Every studio's saving, listing, copying and deleting of worlds goes
 * through here, so the rules for revisions and for regional worlds are written once:
 *
 * - **Save** writes each map given and, if they changed, the world's settings. A map saved changed
 *   gets its `revision` raised by one and `savedAt` set; the settings saved changed raise
 *   `settingsRevision` and set `settingsSavedAt`. A held world writes only its own World setup:
 *   every other group is its parent's, read live.
 * - **Copy** (Save as, Duplicate) copies the world and its maps, not its regional worlds, which
 *   stay held by the original. A copy of a held world is held by the same parent.
 * - **Clone as new** copies a world as a world of its own: its settings are copied in as it reads
 *   them, and it is no longer held or cut from anything.
 * - **Delete** deletes the world and its maps. Its held regional worlds are moved up to its parent,
 *   still held, when it is held itself (they read the same settings); otherwise they are released
 *   as worlds of their own with a copy of the settings they read. Each keeps its own regional
 *   worlds under it. A regional world only cut from it (not held) loses the link.
 * - **Blobs** (a regional world's `cutBase`, see RegionalRecord) are kept with the map whose part of
 *   the record names them. Each save drops the blobs a map's record no longer names; a copy takes
 *   them along with its record; Clone as new and a release drop the record, and the blobs with it.
 *
 * The clock and the id maker can be replaced for tests.
 */
export class Worlds {
    /** Now, as saved times are written. */
    static now = () => new Date().toISOString();

    /** A new world's id (a Foundry id, so a world journal can be made with it). */
    static newWorldId = () => platform.utils.randomID();

    /** Every world record, by id. */
    static async all() {
        return new Map((await platform.store.listWorlds()).map((world) => [world.id, world]));
    }

    /** A world record, or null. */
    static async get(id) {
        return id ? platform.store.loadWorld(id) : null;
    }

    /** The world a saved map belongs to, or null (a map saved before v5 and not yet migrated). */
    static async ofMap(mapId) {
        const meta = mapId ? await platform.store.loadMapMeta(mapId) : null;
        return meta?.worldId ? Worlds.get(meta.worldId) : null;
    }

    /** The id of a world's map of a type (its Surface map by default), or null. */
    static mapOf(world, type = MAP_TYPES.SURFACE) {
        return world?.maps?.find((map) => map.type === type)?.id ?? null;
    }

    /** The settings a world reads (its own, or, while held, linked; see WorldRecord). */
    static async settingsOf(world, byId = null) {
        const worlds = byId ?? (await Worlds.all());
        return WorldRecord.effectiveSettings(world, (id) => worlds.get(id) ?? null);
    }

    /**
     * Every world as a tree for Worlds: worlds with no parent (or whose parent is no longer
     * saved) at the top, each with the regional worlds cut from it, each level sorted by name.
     * @returns {Promise<Array<{id: string, name: string, mapId: string|null, parentId: string|null, held: boolean, children: Array}>>}
     */
    static async tree() {
        const worlds = await Worlds.all();
        const byId = (id) => worlds.get(id) ?? null;
        const nodes = new Map(
            [...worlds.values()].map((world) => {
                const surface = (world.maps ?? []).find((map) => map.type === MAP_TYPES.SURFACE) ?? null;
                const setup = world.settings?.setup ?? {};
                const entry = RegionalRecord.forMap(world.regional, Worlds.mapOf(world));
                return [
                    world.id,
                    {
                        id: world.id,
                        name: world.name || "",
                        mapId: Worlds.mapOf(world),
                        parentId: world.parentWorldId ?? null,
                        held: world.held === true,
                        maps: (world.maps ?? []).map((map) => ({ ...map })),
                        thumbnail: surface?.thumbnail ?? null,
                        marks: WorldRecord.marks(world, byId),
                        // Why it is Out of date (RegionalRecord.staleness), and its zoom from its parent
                        stale: RegionalRecord.staleness(world, byId),
                        zoom: entry?.zoom ?? null,
                        // What Cut again… needs: the crop it was cut with, and whether v5 cut it
                        cropKnown: !!(entry?.crop?.parent && entry?.size),
                        migrated: world.regional?.migrated === true,
                        // World setup in brief, and when anything of the world was last saved changed
                        setup: { engine: typeof setup.engine === "string" ? setup.engine : null, seed: setup.seed ?? null, frame: setup.frame ?? null },
                        settingsSavedAt: world.settingsSavedAt ?? null,
                        children: [],
                    },
                ];
            }),
        );
        const roots = [];
        for (const node of nodes.values()) (nodes.get(node.parentId)?.children ?? roots).push(node);
        const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
        for (const node of nodes.values()) node.children.sort(byName);
        return roots.sort(byName);
    }

    /**
     * Saves a world and the maps given.
     *
     * @param {object} options
     * @param {object|null} options.world - The world as saved last, or null for a new one.
     * @param {string} options.name - The world's name (its maps are named after it).
     * @param {object} options.settings - The world's settings as they are now (for a held world,
     *     only its setup is written).
     * @param {Array<{id: string|null, type: string, data: object, owners?: object, modelRun?: object|null, summary?: object, changed: boolean, card?: object}>} options.maps
     *     Each map, with `card` what Worlds shows of it (WorldRecord.mapCard: its thumbnail, whether
     *     it has a run, whether an older generator made it); left out keeps the world's.
     * @param {boolean} [options.asNew=false] - Save as a new world (Save as): a held world's copy is
     *     held by the same parent.
     * @param {object|null} [options.regional] - The held world's record as the open map changed it
     *     (its inherited strokes, see StrokeHistory); left out keeps the saved one.
     * @param {boolean} [options.settingsChanged] - Whether the settings changed since the world was
     *     opened, when the caller knows better than a comparison with the saved record can (a map's
     *     load fills in defaults the record never held, which are not a change of the user's).
     * @returns {Promise<{world: object, maps: Array<{id: string, type: string}>}|null>}
     */
    static async save({ world, name, settings, maps, asNew = false, settingsChanged = undefined, regional = undefined }) {
        const stamp = Worlds.now();
        const fresh = !world || asNew;
        const record = fresh
            ? WorldRecord.create({ id: Worlds.newWorldId(), name, parentWorldId: world?.parentWorldId ?? null, held: world?.held === true })
            : structuredClone(world);
        if (fresh && world) record.regional = structuredClone(world.regional ?? null);
        if (regional !== undefined) record.regional = structuredClone(regional);
        record.name = name;

        const stored = fresh ? null : world.settings;
        const next = record.held ? { setup: structuredClone(settings?.setup ?? {}) } : structuredClone(settings ?? {});
        const changed = settingsChanged ?? WorldRecord.changedGroups(stored, next).length > 0;
        if (fresh || changed) {
            if (!fresh) record.settingsRevision = (record.settingsRevision ?? 1) + 1;
            record.settingsSavedAt = stamp;
        }
        record.settings = next;

        const savedMaps = [];
        for (const map of maps) {
            const existingId = fresh ? null : map.id;
            const previous = existingId ? await platform.store.loadMapMeta(existingId) : null;
            const changed = !previous || map.changed === true;
            const meta = {
                worldId: record.id,
                mapType: map.type,
                revision: previous ? (previous.revision ?? 1) + (changed ? 1 : 0) : 1,
                savedAt: changed ? stamp : (previous.savedAt ?? null),
            };
            if (map.studio) meta.studio = map.studio;
            const saved = await platform.store.saveMapData(name, map.data, existingId, { owners: map.owners ?? null, modelRun: map.modelRun, meta, summary: map.summary ?? null });
            if (!saved) return null;
            savedMaps.push({ id: saved.id, type: map.type, from: map.id ?? null, card: map.card ?? null, revision: meta.revision, savedAt: meta.savedAt });
        }
        if (fresh && record.regional) {
            // Save as: the copy's maps take their part of the record, and its blobs, under their new ids
            const renamed = new Map(savedMaps.filter((map) => map.from).map((map) => [map.from, map.id]));
            for (const [from, to] of renamed) await Worlds.#copyBlobs(record.regional, from, to);
            record.regional = RegionalRecord.remap(record.regional, renamed);
        }
        for (const map of savedMaps) await Worlds.#keepBlobs(record, map.id);
        // Each map's card (WorldRecord.mapCard): as the save gives it, else as the world held it
        const held = new Map((record.maps ?? []).map((entry) => [entry.type, entry]));
        record.maps = mergeMaps(record.maps, savedMaps.map(({ id, type, card, revision, savedAt }) => ({ ...WorldRecord.mapCard({ ...(card ?? held.get(type)), revision, savedAt }), id, type })));

        if (!(await platform.store.saveWorld(record))) return null;
        return { world: record, maps: savedMaps.map(({ id, type }) => ({ id, type })) };
    }

    /**
     * Copies a saved world and its maps under a new name (Save as, Duplicate). Its regional worlds
     * are not copied; a held world's copy is held by the same parent.
     * @param {string} worldId
     * @param {string} name
     * @returns {Promise<object|null>} The copy's record.
     */
    static async copy(worldId, name) {
        const world = await Worlds.get(worldId);
        if (!world) return null;
        const copy = { ...structuredClone(world), id: Worlds.newWorldId(), name, settingsRevision: 1, settingsSavedAt: Worlds.now() };
        delete copy.migration;
        const renamed = new Map();
        copy.maps = await Worlds.#copyMaps(world, copy, name, renamed);
        // The copied maps carry their blobs (the store copies a map whole); the record follows them
        copy.regional = RegionalRecord.remap(copy.regional ?? null, renamed);
        await platform.store.saveWorld(copy);
        return copy;
    }

    /**
     * Copies a world as a world of its own (Clone as new, which v4.3 called Leave parent): its
     * settings copied in as it reads them, no longer held or cut from anything.
     * @param {string} worldId
     * @param {string} name
     * @returns {Promise<object|null>}
     */
    static async cloneAsNew(worldId, name) {
        const world = await Worlds.get(worldId);
        if (!world) return null;
        const settings = await Worlds.settingsOf(world);
        const copy = { ...structuredClone(world), id: Worlds.newWorldId(), name, settings, settingsRevision: 1, settingsSavedAt: Worlds.now(), parentWorldId: null, held: false, regional: null };
        delete copy.migration;
        copy.maps = await Worlds.#copyMaps(world, copy, name);
        // No record, so no blobs
        for (const map of copy.maps) await Worlds.#keepBlobs(copy, map.id);
        await platform.store.saveWorld(copy);
        return copy;
    }

    /** Renames a world and its maps. */
    static async rename(worldId, name) {
        const world = await Worlds.get(worldId);
        if (!world) return null;
        for (const map of world.maps ?? []) await platform.store.renameSavedMap(map.id, name);
        return platform.store.saveWorld({ ...world, name });
    }

    /**
     * What deleting a world does to its regional worlds, for the confirmation to name.
     * @param {string} worldId
     * @returns {Promise<{movedUp: object[], released: object[], unlinked: object[]}>} The worlds
     *     moved up to its parent, still held; those released as worlds of their own; and those
     *     only cut from it.
     */
    static async deletePlan(worldId) {
        const worlds = await Worlds.all();
        const world = worlds.get(worldId);
        const children = [...worlds.values()].filter((other) => other.parentWorldId === worldId);
        const heldChildren = children.filter((child) => child.held);
        const movesUp = world?.held === true && !!world.parentWorldId && worlds.has(world.parentWorldId);
        return {
            movedUp: movesUp ? heldChildren : [],
            released: movesUp ? [] : heldChildren,
            unlinked: children.filter((child) => !child.held),
        };
    }

    /**
     * Deletes a world and its maps, its regional worlds dealt with as deletePlan says.
     * @param {string} worldId
     * @returns {Promise<boolean>}
     */
    static async delete(worldId) {
        const worlds = await Worlds.all();
        const world = worlds.get(worldId);
        if (!world) return false;
        const plan = await Worlds.deletePlan(worldId);
        const byId = (id) => worlds.get(id) ?? null;
        for (const child of plan.movedUp) await platform.store.saveWorld({ ...child, parentWorldId: world.parentWorldId });
        for (const child of plan.released) {
            const settings = WorldRecord.effectiveSettings(child, byId);
            const released = { ...child, settings, parentWorldId: null, held: false, regional: null, settingsSavedAt: Worlds.now() };
            for (const map of child.maps ?? []) await Worlds.#keepBlobs(released, map.id);
            await platform.store.saveWorld(released);
        }
        for (const child of plan.unlinked) await platform.store.saveWorld({ ...child, parentWorldId: null });
        for (const map of world.maps ?? []) await platform.store.deleteSavedMap(map.id);
        return platform.store.deleteWorld(worldId);
    }

    /** Drops the blobs kept with a map that its world's record no longer names. */
    static async #keepBlobs(world, mapId) {
        if (typeof platform.store.keepMapBlobs !== "function") return;
        await platform.store.keepMapBlobs(mapId, RegionalRecord.blobsOf(world.regional, mapId));
    }

    /** Copies the blobs a record names for one map to another map (Save as). */
    static async #copyBlobs(regional, from, to) {
        for (const hash of RegionalRecord.blobsOf(regional, from)) {
            const bytes = await platform.store.loadMapBlob(from, hash);
            if (bytes) await platform.store.saveMapBlob(to, hash, bytes);
        }
    }

    /** Duplicates a world's maps for a copy of it, each made the copy's at revision 1. */
    static async #copyMaps(world, copy, name, renamed = new Map()) {
        const stamp = Worlds.now();
        const maps = [];
        for (const map of world.maps ?? []) {
            const duplicate = await platform.store.duplicateSavedMap(map.id, name);
            if (!duplicate) continue;
            const previous = await platform.store.loadMapMeta(map.id);
            await platform.store.saveMapMeta(duplicate.id, { ...(previous ?? {}), worldId: copy.id, mapType: map.type, revision: 1, savedAt: stamp });
            maps.push({ ...WorldRecord.mapCard(map), id: duplicate.id, type: map.type });
            renamed.set(map.id, duplicate.id);
        }
        return maps;
    }
}

/** A world's map list with the maps just saved in it (by type: a world has one map of each type in S0). */
function mergeMaps(current, saved) {
    const byType = new Map((current ?? []).map((map) => [map.type, map]));
    for (const map of saved) byType.set(map.type, map);
    return [...byType.values()];
}
