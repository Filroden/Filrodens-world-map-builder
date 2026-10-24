import { FILRODENSWMB } from "../config.js";
import { RiverNetwork } from "../generation/RiverNetwork.js";
import { decodeModelRun } from "../generator/ModelRun.js";
import { parentRunSites } from "../generator/ParentRun.js";
import { cellsFromSites, travelCellOfPixels, travelGrid } from "../travel/TravelGrid.js";

/**
 * What in-fill reads of an open regional map (see Infill.runInfill), gathered on the main thread:
 * its in-fill cells (TravelGrid's finer cells, about INFILL.CELL_KM apart), the generator's payload
 * over them, each one's parent cell in its copy of its parent's run, the inherited places and
 * routes on them, and the travel speeds.
 */
export class InfillInput {
    /**
     * Whether in-fill is offered on a map: a regional map with its parent's run, whose generator
     * cells lie at least INFILL.MIN_PARENT_PX apart on it.
     * @param {object} app
     */
    static offered(app) {
        const mesh = app.meshSession?.mesh;
        const parentRun = app.parentRun;
        return !!(mesh && parentRun && parentRun.spacingPx >= FILRODENSWMB.INFILL.MIN_PARENT_PX);
    }

    /**
     * The in-fill cells of a mesh: about INFILL.CELL_KM apart, at most TRAVEL_TIME.MAX_CELLS.
     * @param {import("../mesh/MeshBuilder.js").Mesh} mesh
     */
    static grid(mesh) {
        return travelGrid(mesh, { cellPx: FILRODENSWMB.INFILL.CELL_KM / mesh.kmPerPx, maxCells: FILRODENSWMB.TRAVEL_TIME.MAX_CELLS });
    }

    /**
     * @param {object} source
     * @param {import("../mesh/MeshBuilder.js").Mesh} source.mesh
     * @param {object} source.parentRun - The regional map's copy of its parent's run (see ParentRun).
     * @param {object} source.payload - The generator's payload for the map (Generation.payload).
     * @param {object[]} source.pins
     * @param {object[]} source.routes
     * @param {Object<string, number>} source.speeds
     * @param {string} source.seed
     * @param {string} source.nameBase
     * @param {number} [source.areaFactor] - The map's area factor (see Infill.placeVillages).
     * @param {Uint8Array} [source.land] - Each display cell's land flag (the mesh's aggregates).
     * @param {Uint8Array} [source.riverImage] - The river image the map is painted from (see dryCell).
     * @param {object} [source.grid] - The in-fill cells, when already worked out.
     * @returns {{input: object, grid: object}}
     */
    static gather({ mesh, parentRun, payload, pins, routes, speeds, seed, nameBase, areaFactor, land = null, riverImage = null, grid = this.grid(mesh) }) {
        const reliefScale = Math.max(1, FILRODENSWMB.MESH.MODEL_SPACING_KM / (grid.spacingPx * mesh.kmPerPx));
        const finePayload = { ...payload, modelSites: Float64Array.from(grid.sites), modelOf: travelCellOfPixels(mesh, grid), reliefScale };
        // Each in-fill cell's parent cell: the one its site's display cell lies in
        const parentCells = cellsFromSites(mesh, parentRunSites(parentRun), parentRun.spacingPx);
        const parentOf = Int32Array.from(grid.siteCell, (display) => parentCells.of[display]);
        const arrays = decodeModelRun(parentRun);
        const cellOf = (x, y) => {
            const display = Number.isFinite(x) && Number.isFinite(y) ? mesh.cellAt(x, y) : -1;
            return display >= 0 ? grid.of[display] : -1;
        };
        const towns = [];
        for (const pin of pins ?? []) {
            if (pin?.generated?.kind !== "town") continue;
            const cell = cellOf(pin.x, pin.y);
            if (cell >= 0) towns.push({ cell, population: Number(pin.generated.population) || 0 });
        }
        const fineRoutes = (routes ?? []).map((route) => ({
            transport: route.transport ?? "road",
            cells: (route.legs?.length ? route.legs.flat() : (route.waypoints ?? [])).map((display) => (Number.isInteger(display) && display >= 0 && display < grid.of.length ? grid.of[display] : -1)),
        }));
        const input = {
            payload: finePayload,
            parentOf,
            parent: { population: arrays.population ?? new Float64Array(parentRun.cellCount), landArea: arrays.landArea ?? null, cultureOf: mainCultures(arrays, parentRun.cellCount), nameBases: (parentRun.cultures ?? []).map((culture) => culture?.nameBase ?? null) },
            towns,
            routes: fineRoutes,
            speeds,
            seed,
            nameBase,
            areaFactor,
            dry: land && riverImage ? this.#dryCells(mesh, grid, land, riverImage) : null,
            names: (pins ?? []).map((pin) => pin?.name).filter(Boolean),
        };
        return { input, grid };
    }

    /**
     * Whether a place could stand on a display cell: land, and clear of the rivers as the map draws
     * them (in a channel or within INFILL.RIVER_MARGIN_PX of one). On a closely cut map a river is
     * drawn far wider than the one pixel its course takes in the terrain's data, so the river image
     * the map is painted from decides; a map without one is all clear.
     * @param {import("../mesh/MeshBuilder.js").Mesh} mesh
     * @param {number} cell - A display cell.
     * @param {Uint8Array|null} land
     * @param {Uint8Array|null} riverImage
     */
    static dryCell(mesh, cell, land, riverImage) {
        if (land && !land[cell]) return false;
        if (!riverImage || riverImage.length !== mesh.width * mesh.height * 4) return true;
        const x = Math.min(mesh.width - 1, Math.max(0, Math.floor(mesh.siteX(cell))));
        const y = Math.min(mesh.height - 1, Math.max(0, Math.floor(mesh.siteY(cell))));
        return !RiverNetwork.isNearChannel(riverImage, y * mesh.width + x, FILRODENSWMB.INFILL.RIVER_MARGIN_PX);
    }

    /** Each in-fill cell's flag: 1 where at least one of its display cells is dry (see dryCell). */
    static #dryCells(mesh, grid, land, riverImage) {
        const dry = new Uint8Array(grid.count);
        for (let cell = 0; cell < grid.of.length; cell++) {
            const own = grid.of[cell];
            if (!dry[own] && this.dryCell(mesh, cell, land, riverImage)) dry[own] = 1;
        }
        return dry;
    }
}

/** Each parent cell's main culture (the largest share), or -1. */
function mainCultures({ shareStart, shareCulture, shareValue }, count) {
    const out = new Int32Array(count).fill(-1);
    if (!shareStart || !shareCulture || !shareValue) return out;
    for (let cell = 0; cell < count; cell++) {
        let best = -1;
        for (let index = shareStart[cell]; index < shareStart[cell + 1]; index++) if (best < 0 || shareValue[index] > shareValue[best]) best = index;
        out[cell] = best >= 0 ? shareCulture[best] : -1;
    }
    return out;
}
