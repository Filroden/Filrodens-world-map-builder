import { MapStateManager } from "./applications/MapStateManager.js";
import { ProceduralEngine } from "./generation/ProceduralEngine.js";
import { HydrologyEngine } from "./generation/HydrologyEngine.js";

export class ProceduralOrchestrator {
    /**
     * Executes the topography and history phases of map generation.
     * Note: Climate generation and Canvas rendering remain handled by the App controller.
     */
    static processTopographyPhase(app) {
        const { currentSeed, params } = MapStateManager.getMapParameters(app);
        const engine = new ProceduralEngine(currentSeed);

        // 1. Route Base Topography
        this.#routeTopographyPass(app, engine, params);

        // 2. Replay History & Features
        this.rebuildFromHistory(app, engine, params, null);

        // 3. Reset Ephemeral Overrides
        app.currentSpringOverrides.fill(0);
    }

    /**
     * Directs the topography generation based on the active engine mode.
     */
    static #routeTopographyPass(app, engine, params) {
        const mode = app.uiState.generationEngine || "standard";

        console.log(`World Map Builder | Generating Topography (${mode} mode)...`);
        const t0 = performance.now();

        if (mode === "flat") {
            // Bypass noise completely and create a flat canvas slightly above sea level
            app.baseElevationData.fill(params.seaLevel + 0.05);
        } else if (mode === "advanced") {
            // v2.1.0 Tectonic pipeline placeholder
            // engine.generateTectonicTopography(app.mapWidth, app.mapHeight, params, app.baseElevationData);
        } else {
            // Legacy v1 pipeline
            engine.generateTopography(app.mapWidth, app.mapHeight, params, app.baseElevationData, app.tectonicFaults, [], null);
        }

        const t1 = performance.now();
        console.log(`World Map Builder | Topography generated in ${(t1 - t0).toFixed(2)}ms`);
    }

    /**
     * Safely replays raster history and vector hydrology over the base topography.
     * Designed to be called independently during active brush strokes.
     */
    static rebuildFromHistory(app, engine, params, bounds = null) {
        // Instantiate engine/params if this was called independently by a brush stroke
        if (!engine || !params) {
            const mapParams = MapStateManager.getMapParameters(app);
            engine = new ProceduralEngine(mapParams.currentSeed);
            params = mapParams.params;
        }

        // Global array wipe
        app.currentElevationData.set(app.baseElevationData);
        app.currentBiomeOverrides.fill(0);

        // Replay Raster History
        if (app.brushEngine) {
            app.brushEngine.replayHistory(app.currentElevationData, app.currentBiomeOverrides, params.seaLevel, bounds);
        }

        // Carve Vector Hydrology
        if (app.manualRivers && app.manualRivers.length > 0) {
            HydrologyEngine.carveManualRivers(app.currentElevationData, app.mapWidth, app.mapHeight, app.manualRivers, engine.simplex, params.seaLevel, bounds);
        }
    }
}
