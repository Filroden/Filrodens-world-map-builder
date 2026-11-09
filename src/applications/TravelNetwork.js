import { FILRODENSWMB } from "../config.js";
import { travelGraphInBackground } from "../generator/Generate.js";
import { GeneratorRevision } from "../generator/GeneratorRevision.js";
import { travelCellOfPixels, travelGrid } from "../travel/TravelGrid.js";
import { Generation } from "./Generation.js";

/**
 * The open map's travel network (see TravelGraph), built in the background once and kept until
 * what it is built from changes: the mesh, the land, climate and rivers the generator reads
 * (counted by MapStudio in `travelInputs`, as it marks a run out of date), or the generator rules
 * the map follows (see GeneratorRevision), which a run on an older map brings up to date. It is
 * built over the map's travel cells (see TravelGrid), which the network carries as `grid`.
 */

/** Per studio: the network asked for, with what it was built from. */
const networks = new WeakMap();

/** What a network is built from besides the mesh: the counted inputs and the map's generator rules. */
const inputsOf = (app) => `${app.travelInputs ?? 0}:${GeneratorRevision.of(app.uiState)}`;
/** Per mesh: its travel cells. */
const grids = new WeakMap();

/** The mesh's travel cells, worked out once. */
function gridFor(mesh) {
    if (!grids.has(mesh)) grids.set(mesh, travelGrid(mesh, { cellPx: FILRODENSWMB.TRAVEL_TIME.CELL_PX, maxCells: FILRODENSWMB.TRAVEL_TIME.MAX_CELLS }));
    return grids.get(mesh);
}

export class TravelNetwork {
    /**
     * The network, once built.
     * @param {object} app
     * @returns {Promise<object|null>} null without terrain or a mesh.
     */
    static graph(app) {
        const mesh = app.meshSession?.mesh ?? null;
        if (!mesh || !app.currentElevationData) return Promise.resolve(null);
        const inputs = inputsOf(app);
        const cached = networks.get(app);
        if (cached?.mesh === mesh && cached.inputs === inputs) return cached.promise;
        const entry = { mesh, inputs, promise: null, value: null };
        const grid = gridFor(mesh);
        const makePayload = () => {
            const payload = Generation.payload(app);
            if (grid.coarse) return payload;
            // The travel cells in the model cells' place, with relief measured as on the generator's
            const kmPerPx = payload.kmPerPx;
            return { ...payload, modelSites: Float64Array.from(grid.sites), modelOf: travelCellOfPixels(mesh, grid), reliefScale: Math.max(1, FILRODENSWMB.MESH.MODEL_SPACING_KM / (grid.spacingPx * kmPerPx)) };
        };
        entry.promise = travelGraphInBackground(makePayload).then((graph) => {
            entry.value = graph.count === grid.count ? Object.assign(graph, { grid }) : null;
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
        return cached?.mesh === app.meshSession?.mesh && cached.inputs === inputsOf(app) ? cached.value : null;
    }
}
