/**
 * Saved maps on the web (the platform's `store` service), kept in the browser's IndexedDB. It
 * offers the same calls, with the same results, as Foundry's compendium store (see
 * ../foundry/store.js), so the studio's saving, loading and Map Management work unchanged.
 *
 * Each saved map is one record: its id, its name, the map data exactly as the studio saved it, and
 * the encoded owner arrays saved beside it. Keeping the map data's shape means a map moves between
 * Foundry and the web through the studio's JSON export and import, and the load-time upgrades run
 * on maps saved here as they do on maps saved in Foundry. From v5 a map's record also keeps its
 * `meta` (its world, map type, revision and the time of its last changed save; see Worlds), and
 * each world is a record of its own in a second object store (see Worlds for its fields), and each
 * settlement map (the Local studio's) a record of its own in a third, with its world's id: a
 * settlement map is part of its world, never a saved map.
 *
 * The records go through a small store interface (get, put, delete, all) so the service can be
 * tested without a browser: MemoryRecords keeps them in a Map, IndexedDbRecords in IndexedDB. Each
 * has a `worlds` beside it, the same interface over the world records.
 */
import { deepClone, randomID } from "./utils.js";

/** The database and its object store. */
const DATABASE = "fwmb-maps";
const STORE = "maps";
const WORLDS = "worlds";
const SETTLEMENTS = "settlements";
/** 2 adds the world records (v5), 3 the settlement maps (v5, L-surface). */
const DATABASE_VERSION = 3;

/** Records kept in memory (tests, and browsers where IndexedDB is refused). */
export class MemoryRecords {
    #records = new Map();
    #worlds = null;
    #settlements = null;

    /** The world records kept beside these (made when first asked for). */
    get worlds() {
        this.#worlds ??= new MemoryRecords();
        return this.#worlds;
    }

    /** The settlement maps kept beside these (made when first asked for). */
    get settlements() {
        this.#settlements ??= new MemoryRecords();
        return this.#settlements;
    }

    async get(id) {
        return deepClone(this.#records.get(id));
    }

    async put(record) {
        this.#records.set(record.id, deepClone(record));
    }

    async delete(id) {
        this.#records.delete(id);
    }

    async all() {
        return [...this.#records.values()].map(deepClone);
    }
}

/** Records in the browser's IndexedDB, keyed by id. Every read returns a fresh copy. */
export class IndexedDbRecords {
    #db;
    #store;
    #worlds = null;
    #settlements = null;

    constructor(db, store = STORE) {
        this.#db = db;
        this.#store = store;
    }

    /** The world records, in the same database. */
    get worlds() {
        this.#worlds ??= new IndexedDbRecords(this.#db, WORLDS);
        return this.#worlds;
    }

    /** The settlement maps, in the same database. */
    get settlements() {
        this.#settlements ??= new IndexedDbRecords(this.#db, SETTLEMENTS);
        return this.#settlements;
    }

    /**
     * Opens (creating if need be) the saved maps database.
     *
     * @param {IDBFactory} [factory]
     * @returns {Promise<IndexedDbRecords>}
     */
    static open(factory = globalThis.indexedDB) {
        return new Promise((resolve, reject) => {
            if (!factory) {
                reject(new Error("IndexedDB is not available"));
                return;
            }
            const request = factory.open(DATABASE, DATABASE_VERSION);
            request.onupgradeneeded = () => {
                for (const name of [STORE, WORLDS, SETTLEMENTS]) {
                    if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, { keyPath: "id" });
                }
            };
            request.onsuccess = () => resolve(new IndexedDbRecords(request.result));
            request.onerror = () => reject(request.error);
            request.onblocked = () => reject(new Error("The saved maps database is open in another window with an older version."));
        });
    }

    #request(mode, operate) {
        return new Promise((resolve, reject) => {
            const transaction = this.#db.transaction(this.#store, mode);
            const request = operate(transaction.objectStore(this.#store));
            transaction.oncomplete = () => resolve(request.result);
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error);
        });
    }

    get(id) {
        return this.#request("readonly", (store) => store.get(id));
    }

    put(record) {
        return this.#request("readwrite", (store) => store.put(record));
    }

    delete(id) {
        return this.#request("readwrite", (store) => store.delete(id));
    }

    all() {
        return this.#request("readonly", (store) => store.getAll());
    }
}

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });

/** The reference to a saved map the studio keeps after saving, renaming or duplicating it. */
const summary = (record) => ({ id: record.id, name: record.name });

/**
 * The store service over a set of records.
 *
 * @param {MemoryRecords|IndexedDbRecords} records
 * @param {object} [options]
 * @param {() => string} [options.newId]
 */
export function createWebStore(records, { newId = randomID } = {}) {
    const worlds = records.worlds;
    const settlements = records.settlements;
    const ofWorld = async (worldId) => (await settlements.all()).filter((entry) => entry.worldId === worldId);
    return {
        /** Nothing to prepare: the database is created when it is opened. */
        async initializeCompendium() {},

        /**
         * Every saved map as a tree for Map Management: maps at the top level, each with the
         * regional maps cut from it as its children (when the parent is still saved), each level
         * sorted by name.
         *
         * @returns {Promise<Array<{id: string, name: string, parentId: string|null, children: Array}>>}
         */
        async getSavedMaps() {
            const entries = (await records.all()).map((record) => ({ id: record.id, name: record.name || "", parentId: record.mapData?.parentId || null, children: [] }));
            const byId = new Map(entries.map((entry) => [entry.id, entry]));
            const roots = [];
            for (const entry of entries) {
                const parent = entry.parentId ? byId.get(entry.parentId) : null;
                (parent ? parent.children : roots).push(entry);
            }
            for (const entry of entries) entry.children.sort(byName);
            return roots.sort(byName);
        },

        /**
         * Saves a map: a new record, or the record with existingId overwritten (when it exists).
         *
         * @param {string} mapName
         * @param {object} mapData
         * @param {string|null} [existingId]
         * @param {{owners?: object|null, modelRun?: object|null, meta?: object|null}} [options] - Owner
         *     arrays by level id (null keeps those already saved), the generator's saved outputs
         *     (left out keeps those already saved; null removes them), and the map's world record
         *     fields (null keeps those already saved; see Worlds).
         * @returns {Promise<{id: string, name: string}|null>}
         */
        async saveMapData(mapName, mapData, existingId = null, { owners = null, modelRun = undefined, meta = null } = {}) {
            if (!mapData) return null;
            const existing = existingId ? await records.get(existingId) : null;
            const run = modelRun === undefined ? (existing?.modelRun ?? null) : modelRun;
            const record = { id: existing?.id ?? newId(), name: mapName, mapData: deepClone(mapData), owners: deepClone(owners ?? existing?.owners ?? {}), modelRun: deepClone(run) };
            const kept = meta ?? existing?.meta;
            if (kept) record.meta = deepClone(kept);
            // A save writes the map's data; its blobs are written and dropped by their own calls
            if (existing?.blobs) record.blobs = existing.blobs;
            await records.put(record);
            return summary(record);
        },

        async deleteSavedMap(id) {
            if (!(await records.get(id))) return false;
            await records.delete(id);
            return true;
        },

        async renameSavedMap(id, newName) {
            const record = await records.get(id);
            if (!record) return false;
            record.name = newName;
            await records.put(record);
            return summary(record);
        },

        /** Copies a saved map under a new name (the shared code names it, in the reader's language). */
        async duplicateSavedMap(id, name) {
            const record = await records.get(id);
            if (!record) return null;
            const copy = { ...record, id: newId(), name: name ?? record.name };
            await records.put(copy);
            return summary(copy);
        },

        /** Writes fields of a saved map's data, leaving the rest of it as it was saved. */
        async updateMapDataFields(id, fields) {
            const record = await records.get(id);
            if (!record) return false;
            record.mapData = { ...record.mapData, ...deepClone(fields) };
            await records.put(record);
            return true;
        },

        async loadMapOwners(id) {
            return (await records.get(id))?.owners ?? {};
        },

        /** The generator's saved outputs of a map (see ModelRun), or null. */
        async loadMapModelRun(id) {
            return deepClone((await records.get(id))?.modelRun ?? null);
        },

        async loadMapData(id) {
            return (await records.get(id))?.mapData ?? null;
        },

        async listMapData() {
            return (await records.all()).map((record) => ({ id: record.id, name: record.name, mapData: record.mapData ?? null, meta: record.meta ?? null, hasModelRun: !!record.modelRun }));
        },

        // ------------------------------------------------------------ v5: the map's world fields

        /** A map's world record fields (see Worlds), or null for a map saved before v5. */
        async loadMapMeta(id) {
            return deepClone((await records.get(id))?.meta ?? null);
        },

        /** Writes a map's world record fields, leaving its data as it was saved. */
        async saveMapMeta(id, meta) {
            const record = await records.get(id);
            if (!record) return false;
            record.meta = deepClone(meta);
            await records.put(record);
            return true;
        },

        /** Every saved map's id, name and world fields, without its data. */
        async listMaps() {
            return (await records.all()).map((record) => ({ id: record.id, name: record.name || "", meta: record.meta ?? null }));
        },

        // ------------------------------------------------------------ v5: a map's blobs

        /** Keeps a blob with a map (see Blobs): its gzipped bytes, by hash. */
        async saveMapBlob(id, hash, bytes) {
            const record = await records.get(id);
            if (!record) return false;
            record.blobs = { ...(record.blobs ?? {}), [hash]: new Uint8Array(bytes) };
            await records.put(record);
            return true;
        },

        /** A blob kept with a map, or null. */
        async loadMapBlob(id, hash) {
            const bytes = (await records.get(id))?.blobs?.[hash];
            return bytes ? new Uint8Array(bytes) : null;
        },

        /** The hashes of the blobs kept with a map. */
        async listMapBlobs(id) {
            return Object.keys((await records.get(id))?.blobs ?? {});
        },

        /** Drops every blob kept with a map but those named (what its record still names). */
        async keepMapBlobs(id, keep) {
            const record = await records.get(id);
            if (!record?.blobs) return true;
            const wanted = new Set(keep);
            const blobs = Object.fromEntries(Object.entries(record.blobs).filter(([hash]) => wanted.has(hash)));
            if (Object.keys(blobs).length === Object.keys(record.blobs).length) return true;
            if (Object.keys(blobs).length) record.blobs = blobs;
            else delete record.blobs;
            await records.put(record);
            return true;
        },

        // ------------------------------------------------------------ v5: the world records

        /** Every world record (see Worlds). */
        async listWorlds() {
            return worlds.all();
        },

        async loadWorld(id) {
            return (await worlds.get(id)) ?? null;
        },

        /** Saves a world record, given its id (see Worlds.newWorldId). */
        async saveWorld(record) {
            if (!record?.id) return null;
            await worlds.put(deepClone(record));
            return summary(record);
        },

        async deleteWorld(id) {
            if (!(await worlds.get(id))) return false;
            await worlds.delete(id);
            return true;
        },

        // ------------------------------------------------------------ v5: a world's settlement maps

        /** A world's settlement maps (the Local studio's records), in no order. */
        async listSettlementMaps(worldId) {
            return (await ofWorld(worldId)).map((entry) => deepClone(entry.record));
        },

        /** A world's settlement map, or null. */
        async loadSettlementMap(worldId, id) {
            const entry = await settlements.get(id);
            return entry?.worldId === worldId ? deepClone(entry.record) : null;
        },

        /**
         * Writes a world's settlement map (its record's id names it), alone: the world's other
         * settlement maps are left as they are. The page (Foundry's readable page) is not kept here.
         */
        async saveSettlementMap(worldId, record) {
            if (!worldId || !record?.id) return null;
            await settlements.put({ id: record.id, worldId, record: deepClone(record) });
            return { id: record.id };
        },

        async deleteSettlementMap(worldId, id) {
            const entry = await settlements.get(id);
            if (entry?.worldId !== worldId) return false;
            await settlements.delete(id);
            return true;
        },

        /** Deletes every settlement map of a world (as the world is deleted). */
        async deleteSettlementMaps(worldId) {
            for (const entry of await ofWorld(worldId)) await settlements.delete(entry.id);
            return true;
        },
    };
}
