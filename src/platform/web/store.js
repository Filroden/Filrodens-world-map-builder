/**
 * Saved maps on the web (the platform's `store` service), kept in the browser's IndexedDB. It
 * offers the same calls, with the same results, as Foundry's compendium store (see
 * ../foundry/store.js), so the studio's saving, loading and Map Management work unchanged.
 *
 * Each saved map is one record: its id, its name, the map data exactly as the studio saved it, and
 * the encoded owner arrays saved beside it. Keeping the map data's shape means a map moves between
 * Foundry and the web through the studio's JSON export and import, and the load-time upgrades run
 * on maps saved here as they do on maps saved in Foundry.
 *
 * The records go through a small store interface (get, put, delete, all) so the service can be
 * tested without a browser: MemoryRecords keeps them in a Map, IndexedDbRecords in IndexedDB.
 */
import { deepClone, randomID } from "./utils.js";

/** The database and its object store. */
const DATABASE = "fwmb-maps";
const STORE = "maps";
const DATABASE_VERSION = 1;

/** Records kept in memory (tests, and browsers where IndexedDB is refused). */
export class MemoryRecords {
    #records = new Map();

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

    constructor(db) {
        this.#db = db;
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
                if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: "id" });
            };
            request.onsuccess = () => resolve(new IndexedDbRecords(request.result));
            request.onerror = () => reject(request.error);
            request.onblocked = () => reject(new Error("The saved maps database is open in another window with an older version."));
        });
    }

    #request(mode, operate) {
        return new Promise((resolve, reject) => {
            const transaction = this.#db.transaction(STORE, mode);
            const request = operate(transaction.objectStore(STORE));
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
         * @param {{owners?: object|null}} [options] - Owner arrays by level id; null keeps those already saved.
         * @returns {Promise<{id: string, name: string}|null>}
         */
        async saveMapData(mapName, mapData, existingId = null, { owners = null } = {}) {
            if (!mapData) return null;
            const existing = existingId ? await records.get(existingId) : null;
            const record = { id: existing?.id ?? newId(), name: mapName, mapData: deepClone(mapData), owners: deepClone(owners ?? existing?.owners ?? {}) };
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

        async loadMapData(id) {
            return (await records.get(id))?.mapData ?? null;
        },

        async listMapData() {
            return (await records.all()).map((record) => ({ id: record.id, name: record.name, mapData: record.mapData ?? null }));
        },
    };
}
