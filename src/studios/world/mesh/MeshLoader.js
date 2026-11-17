import { GenerationWorkers } from "../tools/GenerationWorkers.js";
import { MeshCache } from "./MeshCache.js";
import { buildMeshData } from "./MeshBuilder.js";

/**
 * Gets the costly part of a mesh (see MeshBuilder.buildMeshData) the fastest way available: from
 * the raster cache if this mesh was built before in this browser, otherwise in a background
 * worker (so the window keeps drawing its progress), otherwise on the main thread. A mesh built
 * here is written to the cache for next time without holding up the caller.
 *
 * Every route gives the same data bit for bit, so which one ran never shows in the result.
 */
export class MeshLoader {
    #cache;

    /**
     * @param {MeshCache|null} cache - null to always build.
     */
    constructor(cache) {
        this.#cache = cache;
    }

    /** A loader using this browser's IndexedDB cache where there is one. */
    static async create() {
        return new MeshLoader(await MeshCache.openDefault());
    }

    /**
     * @param {object} params - Mesh constructor parameters.
     * @param {object} [options]
     * @param {function({stage: string, pct?: number, cached?: boolean}): void} [options.onProgress]
     * @param {AbortSignal} [options.signal]
     * @returns {Promise<import("./MeshBuilder.js").MeshData>}
     */
    async load(params, { onProgress = null, signal = null } = {}) {
        const cached = await this.#cache?.read(params);
        if (cached) {
            onProgress?.({ stage: "cache", pct: 100, cached: true });
            return cached;
        }

        const payload = { width: params.width, height: params.height, spacing: params.spacing, modelSpacing: params.modelSpacing, seed: params.seed };
        const data = await GenerationWorkers.runOne("buildMesh", payload, {
            onProgress,
            signal,
            alone: ({ onProgress: report, isCancelled }) => buildMeshData(payload, { onProgress: report, isCancelled, pause: nextFrame }),
        });
        // Not awaited: the map can open while the cache is written
        this.#cache?.write(params, data);
        return data;
    }
}

/**
 * Yields to the browser between steps of a main-thread build, so the progress overlay is repainted
 * as the build advances. Outside a browser it resolves at once.
 */
function nextFrame() {
    if (typeof requestAnimationFrame !== "function") return Promise.resolve();
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
