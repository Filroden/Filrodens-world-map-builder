import { travelGraphInBackground } from "../generator/Generate.js";
import { Generation } from "./Generation.js";

/**
 * The open map's travel network (see TravelGraph), built in the background once and kept until
 * what it is built from changes: the mesh, or the land, climate and rivers the generator reads
 * (counted by MapStudio in `travelInputs`, as it marks a run out of date).
 */

/** Per studio: the network asked for, with what it was built from. */
const networks = new WeakMap();

export class TravelNetwork {
    /**
     * The network, once built.
     * @param {object} app
     * @returns {Promise<object|null>} null without terrain or a mesh.
     */
    static graph(app) {
        const mesh = app.meshSession?.mesh ?? null;
        if (!mesh || !app.currentElevationData) return Promise.resolve(null);
        const inputs = app.travelInputs ?? 0;
        const cached = networks.get(app);
        if (cached?.mesh === mesh && cached.inputs === inputs) return cached.promise;
        const entry = { mesh, inputs, promise: null, value: null };
        entry.promise = travelGraphInBackground(() => Generation.payload(app)).then((graph) => {
            entry.value = graph.count === mesh.modelCount ? graph : null;
            return entry.value;
        });
        // A failed build is not kept, so the next ask tries again
        entry.promise.catch(() => {
            if (networks.get(app) === entry) networks.delete(app);
        });
        networks.set(app, entry);
        return entry.promise;
    }

    /** The network if it is built and still current, else null (without starting a build). */
    static ready(app) {
        const cached = networks.get(app);
        return cached?.mesh === app.meshSession?.mesh && cached.inputs === (app.travelInputs ?? 0) ? cached.value : null;
    }
}
