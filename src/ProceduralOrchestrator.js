import { MapStateManager } from "./applications/MapStateManager.js";
import { ProceduralEngine } from "./generation/ProceduralEngine.js";
import { HydrologyEngine } from "./generation/HydrologyEngine.js";
import { TectonicEngine } from "./generation/TectonicEngine.js";
import { SpatialMath } from "./tools/SpatialMath.js";
import { FILRODENSWMB } from "./config.js";

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
            app.baseElevationData.fill(params.seaLevel + 0.05);
        } else if (mode === "advanced") {
            engine.generateTectonicTopography(app.mapWidth, app.mapHeight, params, app.baseElevationData);
        } else {
            engine.generateTopography(app.mapWidth, app.mapHeight, params, app.baseElevationData, [], [], null);
        }

        const t1 = performance.now();
        console.log(`World Map Builder | Topography generated in ${(t1 - t0).toFixed(2)}ms`);
    }

    /**
     * Reconstructs currentElevationData from baseElevationData, replaying
     * raster brush strokes and applying vector deformations on top.
     */
    static rebuildFromHistory(app, engine = null, params = null, bounds = null) {
        const activeEngine = engine ?? new ProceduralEngine(app.uiState.mapSeed);
        const activeParams = params ?? MapStateManager.getDerivedMapParameters(app.uiState, app.customBiomeColors).params;
        const activeBounds = ProceduralEngine.resolveBounds(bounds, app.mapWidth, app.mapHeight);

        // 1. Reset current elevation from pristine base elevation within the target bounds
        for (let y = activeBounds.minY; y <= activeBounds.maxY; y++) {
            const rowOffset = y * app.mapWidth;
            const start = rowOffset + activeBounds.minX;
            const end = rowOffset + activeBounds.maxX + 1;
            app.currentElevationData.set(app.baseElevationData.subarray(start, end), start);
        }

        // 2. Replay all raster brush strokes
        if (app.brushEngine?.history?.length > 0) {
            app.brushEngine.replayHistory(app.currentElevationData, app.currentBiomeOverrides, activeBounds);
        }

        // 3. Apply vector faults across both base and brushed terrain
        if (app.tectonicFaults?.length > 0) {
            TectonicEngine.applyTectonicFaults(app.currentElevationData, app.mapWidth, app.mapHeight, app.tectonicFaults, activeEngine.simplex, activeBounds);
        }

        // 4. Carve manual rivers into the final deformed topography
        if (app.manualRivers?.length > 0) {
            HydrologyEngine.carveManualRivers(app.currentElevationData, app.mapWidth, app.mapHeight, app.manualRivers, activeEngine.simplex, activeParams.seaLevel, activeBounds);
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
