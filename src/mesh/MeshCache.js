import { FILRODENSWMB } from "../config.js";

/**
 * Keeps the costliest part of a mesh (its sites, triangulation and cell raster; see
 * MeshBuilder.buildMeshData) between sessions, so reopening a map reads its mesh back instead of
 * building it again.
 *
 * A mesh is fully determined by its parameters, so the key is made of exactly those (seed,
 * display spacing, model spacing, map size) plus the algorithm version: any change to one of them
 * is a different key, and an entry can never be read back for the wrong mesh. Nothing needs
 * invalidating; old entries simply stop being read, and only the MAX_ENTRIES most recently used
 * are kept.
 *
 * The cache is only a speed-up. Every failure (no IndexedDB in this environment, a full disk, a
 * private window, a corrupt entry) is reported once on the console and then behaves as a miss or a
 * skipped write, so the mesh is built as if there were no cache.
 *
 * Storage goes through a small store interface (get, put, delete and keys, each in a named
 * namespace) so the eviction logic can be tested without a browser: MemoryStore keeps entries in
 * Maps, IndexedDbStore in the browser's IndexedDB.
 */

/** Namespace holding the mesh data, by key. */
const DATA = "rasters";
/** Namespace holding when each key was last used, kept apart so a read does not rewrite megabytes. */
const USAGE = "usage";

/**
 * The cache key of a mesh: `${seed}:${spacing}:${modelSpacing}:${width}:${height}:${version}`.
 * The model spacing is part of it because the display sites are sampled around the model sites.
 * @param {{seed: number, spacing: number, modelSpacing: number, width: number, height: number}} params
 * @param {number} [version]
 * @returns {string}
 */
export function meshCacheKey({ seed, spacing, modelSpacing, width, height }, version = FILRODENSWMB.MESH.ALGORITHM_VERSION) {
    return `${seed}:${spacing}:${modelSpacing}:${width}:${height}:${version}`;
}

/** A store kept in memory (tests, and environments without IndexedDB if one is wanted). */
export class MemoryStore {
    #spaces = new Map();

    #space(name) {
        if (!this.#spaces.has(name)) this.#spaces.set(name, new Map());
        return this.#spaces.get(name);
    }

    async get(space, key) {
        return this.#space(space).get(key);
    }

    async put(space, key, value) {
        this.#space(space).set(key, value);
    }

    async delete(space, key) {
        this.#space(space).delete(key);
    }

    async keys(space) {
        return [...this.#space(space).keys()];
    }
}

/** A store in the browser's IndexedDB: one object store per namespace, keyed out of line. */
export class IndexedDbStore {
    #db;

    constructor(db) {
        this.#db = db;
    }

    /**
     * Opens (creating if need be) the cache's database.
     * @param {IDBFactory} [factory]
     * @returns {Promise<IndexedDbStore|null>} null where IndexedDB is unavailable.
     */
    static open(factory = globalThis.indexedDB) {
        if (!factory) return Promise.resolve(null);
        const { DATABASE } = FILRODENSWMB.MESH.CACHE;
        return new Promise((resolve, reject) => {
            const request = factory.open(DATABASE, 1);
            request.onupgradeneeded = () => {
                for (const space of [DATA, USAGE]) if (!request.result.objectStoreNames.contains(space)) request.result.createObjectStore(space);
            };
            request.onsuccess = () => resolve(new IndexedDbStore(request.result));
            request.onerror = () => reject(request.error);
            request.onblocked = () => reject(new Error("The mesh cache database is blocked by another window."));
        });
    }

    #request(space, mode, operate) {
        return new Promise((resolve, reject) => {
            const transaction = this.#db.transaction(space, mode);
            const request = operate(transaction.objectStore(space));
            transaction.oncomplete = () => resolve(request.result);
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error);
        });
    }

    get(space, key) {
        return this.#request(space, "readonly", (store) => store.get(key));
    }

    put(space, key, value) {
        return this.#request(space, "readwrite", (store) => store.put(value, key));
    }

    delete(space, key) {
        return this.#request(space, "readwrite", (store) => store.delete(key));
    }

    keys(space) {
        return this.#request(space, "readonly", (store) => store.getAllKeys());
    }
}

export class MeshCache {
    #store;
    #maxEntries;
    #clock;
    #warned = false;

    /**
     * @param {object} store - A MemoryStore, an IndexedDbStore, or anything with the same four methods.
     * @param {object} [options]
     * @param {number} [options.maxEntries]
     * @param {function(): number} [options.clock] - Time source for "last used" (tests pass a counter).
     */
    constructor(store, { maxEntries = FILRODENSWMB.MESH.CACHE.MAX_ENTRIES, clock = () => Date.now() } = {}) {
        this.#store = store;
        this.#maxEntries = maxEntries;
        this.#clock = clock;
    }

    /**
     * The cache in this browser's IndexedDB, or null where there is none.
     * @returns {Promise<MeshCache|null>}
     */
    static async openDefault() {
        try {
            const store = await IndexedDbStore.open();
            return store ? new MeshCache(store) : null;
        } catch (error) {
            console.warn(`FWMB | The mesh cache is unavailable (${error?.message ?? error}); meshes will be built each time a map opens.`);
            return null;
        }
    }

    /**
     * The cached mesh data for these parameters, or null.
     * @param {object} params - Mesh constructor parameters.
     * @returns {Promise<import("./MeshBuilder.js").MeshData|null>}
     */
    async read(params) {
        const key = meshCacheKey(params);
        try {
            const entry = await this.#store.get(DATA, key);
            if (!isUsableEntry(entry, params)) return null;
            await this.#store.put(USAGE, key, this.#clock());
            return entry;
        } catch (error) {
            this.#warn(error);
            return null;
        }
    }

    /**
     * Stores mesh data for these parameters, then drops the least recently used entries beyond
     * the limit.
     * @param {object} params
     * @param {import("./MeshBuilder.js").MeshData} data
     * @returns {Promise<boolean>} Whether it was stored.
     */
    async write(params, data) {
        const key = meshCacheKey(params);
        const { sites, modelCount, triangles, halfedges, hull, cellRaster } = data;
        try {
            await this.#store.put(DATA, key, { sites, modelCount, triangles, halfedges, hull, cellRaster });
            await this.#store.put(USAGE, key, this.#clock());
            await this.#evict();
            return true;
        } catch (error) {
            this.#warn(error);
            return false;
        }
    }

    /** The cached keys, most recently used first. */
    async keys() {
        const keys = await this.#store.keys(USAGE);
        const used = await Promise.all(keys.map(async (key) => [key, (await this.#store.get(USAGE, key)) ?? 0]));
        // Ties (two uses in the same millisecond) go to the key that sorts later, so the order never
        // depends on the store's own iteration order
        used.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : -1));
        return used.map(([key]) => key);
    }

    async #evict() {
        const keys = await this.keys();
        for (const key of keys.slice(this.#maxEntries)) {
            await this.#store.delete(DATA, key);
            await this.#store.delete(USAGE, key);
        }
    }

    #warn(error) {
        if (this.#warned) return;
        this.#warned = true;
        console.warn(`FWMB | The mesh cache could not be used (${error?.message ?? error}); meshes will be built instead.`);
    }
}

/** An entry is only used when its arrays have the sizes these parameters need. */
function isUsableEntry(entry, { width, height }) {
    if (!entry?.sites || !entry.cellRaster || !entry.triangles || !entry.halfedges || !entry.hull) return false;
    return entry.cellRaster.length === width * height && Number.isInteger(entry.modelCount) && entry.sites.length % 2 === 0;
}
