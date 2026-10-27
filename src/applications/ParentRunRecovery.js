import { platform } from "../platform/index.js";
import { cropRun, parentRunSites } from "../generator/ParentRun.js";
import { MeshBuilder, generateModelSites } from "../mesh/MeshBuilder.js";
import { TerrainVersion } from "../tools/TerrainVersion.js";

/**
 * A copy of the parent's run (see ParentRun) for a regional map cut before regional maps carried
 * one: read from the map it was cut from, when that map is saved and still holds the run the
 * regional map's generated content came from. The parent's model cells are placed again from its
 * mesh's stored parameters (generateModelSites), without building its mesh.
 *
 * The copy is kept in the open map and saved with it the next time it is saved; the map is not
 * marked as changed for it, since nothing the user made has changed.
 */
export class ParentRunRecovery {
    /**
     * @param {object} app
     * @returns {Promise<boolean>} Whether a copy was made.
     */
    static async recover(app) {
        if (app.parentRun || app.modelRun || !app.currentParentId) return false;
        const runs = this.inheritedRuns(app);
        if (!runs.size) return false;
        const mapId = app.currentSaveId;
        try {
            const [parentData, parentRun] = await Promise.all([platform.store.loadMapData(app.currentParentId), platform.store.loadMapModelRun(app.currentParentId)]);
            const copy = parentData ? this.copyFrom(parentData, parentRun, runs, { world: app.uiState?.world, mapWidth: app.mapWidth, mapHeight: app.mapHeight }) : null;
            // The user may have opened another map while the parent was read
            if (!copy || app.currentSaveId !== mapId || app.parentRun || app.modelRun) return false;
            app.parentRun = copy;
            return true;
        } catch (error) {
            console.warn("FWMB | The run of the map this was cut from could not be read:", error);
            return false;
        }
    }

    /** The runs the map's generated content came from (each item's `generated.run`). */
    static inheritedRuns(app) {
        const runs = new Set();
        const regions = (app.layerSets ?? []).flatMap((set) => set.levels ?? []).flatMap((level) => level.regions ?? []);
        for (const item of [...(app.mapPins ?? []), ...(app.mapRoutes ?? []), ...regions]) if (item?.generated?.run) runs.add(item.generated.run);
        return runs;
    }

    /**
     * The regional map's copy, from its parent's saved data and run (or the parent's own copy of
     * its parent's, for a parent that was itself a regional map not generated), or null when the
     * parent no longer holds a run the regional map's content came from, or the two cannot be
     * lined up.
     * @param {object} parentData - The parent's saved map data.
     * @param {object|null} parentRun - The parent's saved run.
     * @param {Set<string>} runs - The runs the regional map's content came from.
     * @param {{world: object, mapWidth: number, mapHeight: number}} child - The regional map.
     * @returns {object|null}
     */
    static copyFrom(parentData, parentRun, runs, child) {
        const frame = this.frame(parentData, child);
        if (!frame) return null;
        if (parentRun && runs.has(parentRun.run)) {
            const params = MeshBuilder.paramsFor(parentData);
            const sites = generateModelSites(params);
            if (sites.length !== parentRun.cellCount * 2) return null;
            return cropRun(parentRun, { sites, spacingPx: params.modelSpacing, spacingKm: params.modelSpacing * params.kmPerPx, ...frame });
        }
        const inherited = parentData.parentRun;
        if (inherited && runs.has(inherited.run)) return cropRun(inherited, { sites: parentRunSites(inherited), spacingPx: inherited.spacingPx, spacingKm: inherited.spacingKm, ...frame });
        return null;
    }

    /**
     * Where the regional map lies in its parent's pixels, from the two maps' places in the world
     * (see TerrainVersion.deriveChildWorld): its crop and zoom. Null when either place is unknown
     * (a regional map from before maps recorded it).
     */
    static frame(parentData, child) {
        const parent = TerrainVersion.resolveWorld(parentData);
        const own = TerrainVersion.resolveWorld(child);
        if (![parent.zoom, parent.originX, parent.originY, own.zoom, own.originX, own.originY].every(Number.isFinite) || !(parent.zoom > 0)) return null;
        const zoomScale = own.zoom / parent.zoom;
        if (!(zoomScale > 0)) return null;
        const crop = { x: (own.originX - parent.originX) * parent.zoom, y: (own.originY - parent.originY) * parent.zoom, width: child.mapWidth / zoomScale, height: child.mapHeight / zoomScale };
        return { crop, zoomScale };
    }
}
