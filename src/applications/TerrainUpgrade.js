import { TerrainVersion } from "../tools/TerrainVersion.js";
import { MapStateManager } from "./MapStateManager.js";
import { ProceduralEngine } from "../generation/ProceduralEngine.js";
import { loadMapData, updateMapDataFields } from "../data/compendium.js";

/**
 * Offers a map built with an older revision of the terrain generation rules the chance to be
 * rebuilt with the current ones, and works out whether doing so would visibly change it.
 *
 * Saved maps store settings, not pixels, so a map regenerates from its settings every time it is
 * opened. A map built with legacy rules keeps regenerating with them (see TerrainVersion) until
 * its owner chooses to update it. Only legacy regional maps, and legacy guided maps that are not
 * the baseline size, can change under the current rules; everything else regenerates
 * identically, so nothing is offered for it.
 *
 * The update is applied to the open map only. It becomes permanent when the map is saved, and
 * reloading the map without saving restores the original.
 */
export class TerrainUpgrade {
    /**
     * How many parent maps to follow when looking for the map at the top of a chain of crops.
     * Real chains are a handful of crops deep; the limit only guards against a malformed chain
     * that loops back on itself.
     */
    static MAX_PARENT_DEPTH = 32;

    /**
     * Finds the size of the map at the top of a legacy regional map's chain of crops, by following
     * its parent maps. Legacy regional maps did not record it, and the corrected wind distance
     * depends on its shape (see TerrainVersion.getWindDistanceFor).
     *
     * The walk stops at the first map that knows the answer: a map that was never cropped (it is
     * the top map), or a current-revision regional map that recorded the top map's size. It gives
     * up, returning null, if a parent has been deleted, or if it reaches a regional map with no
     * parent (a standalone copy made with Promote, which drops the link to its parent).
     *
     * @param {object} payload - The legacy regional map's saved data.
     * @returns {Promise<{width: number, height: number}|null>} The top map's size, or null.
     */
    static async resolveLegacyRootSize(payload) {
        let current = payload;

        for (let depth = 0; depth < this.MAX_PARENT_DEPTH; depth++) {
            const known = this.#knownRootSize(current);
            if (known) return known;
            if (!current.parentId) return null;

            current = await loadMapData(current.parentId);
            if (!current) return null;
        }

        return null;
    }

    /**
     * The top map's size as far as one saved map knows it on its own, or null if it does not.
     */
    static #knownRootSize(payload) {
        const state = this.#stateFromPayload(payload);
        const world = TerrainVersion.resolveWorld(state);
        if (world.rootW && world.rootH) return { width: world.rootW, height: world.rootH };
        return null;
    }

    /**
     * The handful of uiState fields TerrainVersion reads, taken from a saved map's data.
     */
    static #stateFromPayload(payload) {
        return {
            terrainVersion: payload.terrainVersion,
            world: payload.world ?? null,
            windDistance: payload.params?.climate?.windDistance,
            mapWidth: payload.mapWidth,
            mapHeight: payload.mapHeight,
        };
    }

    /**
     * Works out whether updating the open map to the current terrain rules would visibly change
     * it, and how. Three kinds of map can change, for different reasons, and the update is
     * described to the user differently for each (`kind`):
     *
     * - "tectonics": a legacy tectonic map. The current revision replaces its engine outright, so
     *   the update builds entirely new continents from the same seed and settings; nothing
     *   needs measuring.
     *
     * - "coastline": a legacy map whose engine's coastline rules have changed (a guided map). Its
     *   coastal profile is always rebuilt, so its relief and ocean depths change whatever its
     *   size and nothing needs measuring. If it is not the baseline size (`resized`), its
     *   coastline settings, which were fixed pixel sizes, are also scaled to its size, and its
     *   Coastline Fracture is lowered to keep its coastline's shape (reported as `fracture`).
     *
     * - "regional": a legacy regional map. Its base terrain gains finer detail, but only in
     *   standard mode (the only engine whose base terrain is built from the elevation noise that
     *   takes extra octaves; no legacy regional map can be guided). Its biomes can change in any
     *   mode: the corrected wind distance moves rain shadows, and moisture and temperature gain
     *   finer detail too. Whether any biome actually changes depends on the terrain the map
     *   really has (a flat map with no hand-edited terrain has no slopes for the wind to act on),
     *   so it is measured on the open map rather than assumed from its engine; see
     *   #changesBiomes. This must run once the map has finished generating, since it reads the
     *   current moisture, temperature and elevation.
     *
     * @param {object} app - The MapStudioApp instance, with a legacy map open.
     * @returns {{kind: string, plan: object, resized?: boolean, fracture?: {before: number, after: number}, changesTerrain: boolean, changesBiomes: boolean}|null}
     *   What the update would apply and change, or null if it would change nothing visible.
     */
    static assess(app) {
        const state = app.uiState;

        if (TerrainVersion.isLegacyReplacedEngine(state)) {
            return { kind: "tectonics", plan: TerrainVersion.planUpgrade(state), changesTerrain: true, changesBiomes: true };
        }

        if (TerrainVersion.isLegacyCoastline(state)) {
            const plan = TerrainVersion.planUpgrade(state);
            const resized = TerrainVersion.isLegacyResized(state);
            const fracture = { before: state.coastlineFracture, after: plan.coastlineFracture ?? state.coastlineFracture };
            return { kind: "coastline", plan, resized, fracture, changesTerrain: true, changesBiomes: true };
        }

        if (!TerrainVersion.isLegacyRegional(state)) return null;

        const plan = TerrainVersion.planUpgrade(state, app.legacyRootSize);
        const changesTerrain = state.generationEngine === "standard" && TerrainVersion.getExtraOctaves({ ...state, ...plan }) > 0;
        const changesBiomes = this.#changesBiomes(app, plan);

        if (!changesTerrain && !changesBiomes) return null;
        return { kind: "regional", plan, changesTerrain, changesBiomes };
    }

    /**
     * Whether any pixel of the open map would show a different biome with the updated climate
     * settings, on the terrain it has now.
     *
     * The updated moisture and temperature are worked out one pixel at a time (see
     * ProceduralEngine.getMoistureAt) and compared with the biome the map shows now, stopping at
     * the first difference. That avoids allocating map-sized buffers, and in practice stops
     * within the first few rows, since extra detail octaves change biome borders almost
     * everywhere. Only a map with no difference anywhere is read in full.
     */
    static #changesBiomes(app, plan) {
        const width = app.mapWidth;
        const height = app.mapHeight;
        const current = MapStateManager.getDerivedMapParameters(app.uiState, app.customBiomeColors).params;
        const updated = MapStateManager.getDerivedMapParameters({ ...app.uiState, ...plan }, app.customBiomeColors).params;

        const engine = new ProceduralEngine(app.uiState.mapSeed);
        const climate = engine.prepareClimate(width, height, updated);
        const elevationData = app.currentElevationData;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const index = y * width + x;
                const before = this.#biomeAt(app, current, index, app.currentMoistureData[index], app.currentTemperatureData[index]);
                const after = this.#biomeAt(app, updated, index, engine.getMoistureAt(climate, elevationData, x, y), engine.getTemperatureAt(climate, elevationData, x, y));
                if (before !== after) return true;
            }
        }

        return false;
    }

    /**
     * The biome a pixel resolves to, by the same rules the biome layer is painted with (painted
     * overrides first, then custom biome rules, then the built-in biomes).
     */
    static #biomeAt(app, params, index, moisture, temperature) {
        const overrideId = app.currentBiomeOverrides ? app.currentBiomeOverrides[index] : 0;
        const { lookupKey } = ProceduralEngine.resolveBiomeLookup(
            overrideId,
            app.currentElevationData[index],
            moisture,
            temperature,
            params.seaLevel,
            app.bufferWaterMask,
            index,
            params.customBiomeRules,
            params.biomePalette,
            params.solidOverWater,
        );
        return lookupKey;
    }

    /**
     * Applies an update to the open map and regenerates it. The map is marked as having unsaved
     * changes, so the update is kept only if the map is saved.
     *
     * The changed settings (revision, wind distance, world description, and Coastline Fracture
     * where the plan changes it) are all read when the generation inputs are compared, so the
     * regeneration always rebuilds the base terrain rather than reusing the one on screen.
     *
     * The side panel is re-rendered before generating. Generation reads every setting back from
     * the panel's inputs first (see MapStateManager.getMapParameters), so a slider still showing
     * the old Coastline Fracture would otherwise put it straight back.
     *
     * @param {object} app - The MapStudioApp instance.
     * @param {object} plan - The settings to apply, from assess().
     */
    static async apply(app, plan) {
        app.uiState.terrainVersion = plan.terrainVersion;
        app.uiState.windDistance = plan.windDistance;
        app.uiState.world = plan.world;
        if (plan.coastlineFracture !== undefined) app.uiState.coastlineFracture = plan.coastlineFracture;
        app.uiState.terrainUpgradeDismissed = false;

        await app.render({ parts: ["context"] });
        await app.generateTerrain();
        app.markDirty();
    }

    /**
     * Records that the owner of the open map does not want to be asked about updating it again.
     *
     * It is written to the saved map immediately, on its own, rather than with the next save:
     * otherwise closing the map without saving would forget the choice and ask again next time.
     * It is also kept on the open map's state, so a later save writes it back rather than
     * dropping it.
     *
     * @param {object} app - The MapStudioApp instance, with a saved map open.
     */
    static async dismiss(app) {
        app.uiState.terrainUpgradeDismissed = true;
        if (!app.currentSaveId) return;

        await updateMapDataFields(app.currentSaveId, { terrainUpgradeDismissed: true });
    }
}
