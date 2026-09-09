import { MapStateManager } from "./applications/MapStateManager.js";
import { ProceduralEngine } from "./generation/ProceduralEngine.js";
import { HydrologyEngine } from "./generation/HydrologyEngine.js";
import { SpatialMath } from "./tools/SpatialMath.js";

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

    /**
     * Executes the climate simulation phase.
     */
    static processClimatePhase(app, bounds = null) {
        const { currentSeed, params } = MapStateManager.getMapParameters(app);
        const engine = new ProceduralEngine(currentSeed);

        // Dynamically scale the wind distance relative to a baseline map resolution and map scale
        let activeBounds = bounds;
        if (activeBounds) {
            const baseWind = params.climate?.windDistance ?? FILRODENSWMB.CLIMATE.WIND_DISTANCE;
            const widthScale = app.mapWidth / FILRODENSWMB.LIMITS.BASELINE_DIMENSION;

            const latTop = params.latTop ?? 90;
            const latBottom = params.latBottom ?? -90;
            const latRange = Math.max(0.1, Math.abs(latTop - latBottom)); // Prevent Infinity
            const latScale = 180 / latRange;

            const dynamicWindDistance = Math.round(baseWind * widthScale * latScale);

            activeBounds = SpatialMath.padBounds(activeBounds, dynamicWindDistance, 0, app.mapWidth, app.mapHeight);
        }

        console.log("World Map Builder | Generating Climate Data...");
        const t0 = performance.now();

        engine.generateClimateData(app.currentElevationData, app.mapWidth, app.mapHeight, params, app.currentMoistureData, app.currentTemperatureData, activeBounds);

        const t1 = performance.now();
        console.log(`World Map Builder | Climate mapped in ${(t1 - t0).toFixed(2)}ms`);
    }

    /**
     * Executes the hydrological feature generation phase.
     */
    static processFeaturePhase(app) {
        const { currentSeed, params } = MapStateManager.getMapParameters(app);
        const engine = new ProceduralEngine(currentSeed);

        console.log("World Map Builder | Generating Features...");
        const t0 = performance.now();

        // Bake procedural springs into permanent pins on first load or new map generation
        if (!app.uiState.springsBaked) {
            if (app.uiState.generationEngine !== "flat") {
                const newSprings = engine.bakeProceduralSprings(app.currentElevationData, app.currentMoistureData, app.mapWidth, app.mapHeight, params);
                for (const s of newSprings) {
                    app.mapPins.push({
                        id: foundry.utils.randomID(),
                        name: "River Source",
                        x: s.x,
                        y: s.y,
                        type: "spring",
                        radius: 6,
                        visibility: "all",
                    });
                }
            }
            app.uiState.springsBaked = true;
            app.markDirty();
        }

        const dynamicPins = [...app.mapPins];

        // Ensure procedural water spawns exactly at the highest point of our manual carve
        const manualSprings = HydrologyEngine.getRiverSources(app.currentElevationData, app.mapWidth, app.manualRivers);
        dynamicPins.push(...manualSprings);

        app.currentRiverData = engine.generateRivers(
            app.currentElevationData,
            app.currentMoistureData,
            app.currentTemperatureData,
            dynamicPins,
            app.mapWidth,
            app.mapHeight,
            params,
            app.bufferRiverMap,
            app.bufferWaterMask,
        );

        const t1 = performance.now();
        console.log(`World Map Builder | Features generated in ${(t1 - t0).toFixed(2)}ms`);
    }
}
