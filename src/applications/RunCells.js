import { cropRun, parentRunSites } from "../generator/ParentRun.js";
import { cellsFromSites } from "../travel/TravelGrid.js";

/**
 * The run whose cells the studio reads for the map's figures (the thematic layers, the Travel
 * tool's farmland, in-fill), with those cells on the map: the map's own run on its model cells, or
 * for a regional map with none, its copy of its parent's run (`app.parentRun`, see ParentRun) on
 * the parent's cells, whose sites it keeps.
 *
 * The cells are given as the mesh-like object ThematicSource reads (`modelCount`, `cellCount`,
 * `parentOf` for each display cell's run cell, `modelDelaunay`, `modelSpacing`, `siteX` and `siteY`
 * for display cells, and `modelSiteX` and `modelSiteY` for run cells): the map's own mesh for its
 * own run.
 */

/** Per studio: the parent's cells last worked out, with the copy and mesh they were worked out from. */
const parentCells = new WeakMap();

export class RunCells {
    /**
     * @param {object} app
     * @returns {{run: object, cells: object, inherited: boolean}|null} null when the map has neither.
     */
    static of(app) {
        const mesh = app.meshSession?.mesh ?? null;
        if (!mesh) return null;
        if (app.modelRun) return { run: app.modelRun, cells: mesh, inherited: false };
        const parentRun = app.parentRun ?? null;
        if (!parentRun) return null;
        const cached = parentCells.get(app);
        if (cached?.parentRun === parentRun && cached.mesh === mesh) return cached.value;
        const value = { run: parentRun, cells: cellsFromSites(mesh, parentRunSites(parentRun), parentRun.spacingPx), inherited: true };
        parentCells.set(app, { parentRun, mesh, value });
        return value;
    }

    /**
     * What a regional map cut from this map inherits of its run: this map's own run's cells, or its
     * copy of its parent's, on the regional map (see ParentRun.cropRun). Null with neither, or when
     * the own run is not on this mesh.
     * @param {object} app
     * @param {{x: number, y: number, width: number, height: number}} crop - The regional map's area in this map's pixels.
     * @param {number} zoomScale - Regional map pixels per pixel of this map.
     */
    static forRegion(app, crop, zoomScale) {
        const mesh = app.meshSession?.mesh ?? null;
        if (mesh && app.modelRun?.cellCount === mesh.modelCount) {
            const sites = mesh.sites.subarray(0, 2 * mesh.modelCount);
            return cropRun(app.modelRun, { sites, spacingPx: mesh.modelSpacing, spacingKm: mesh.modelSpacing * mesh.kmPerPx, crop, zoomScale });
        }
        if (app.parentRun) return cropRun(app.parentRun, { sites: parentRunSites(app.parentRun), spacingPx: app.parentRun.spacingPx, spacingKm: app.parentRun.spacingKm, crop, zoomScale });
        return null;
    }
}
