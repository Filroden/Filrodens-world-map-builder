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
        this.rebuildFromHistory(app, engine, params, null, true);

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
        } else if (mode === "guided") {
            // Synchronous like every other mode. This pass is not awaited by its caller, so making
            // it async would defer the timing log below until after the brush history replay and
            // report that time as topography, and turn any error into an unhandled rejection.
            engine.generateGuidedTopography(app.mapWidth, app.mapHeight, params, app.landMasks, app.baseElevationData);
        } else {
            engine.generateTopography(app.mapWidth, app.mapHeight, params, app.baseElevationData, [], [], null);
        }

        const t1 = performance.now();
        console.log(`World Map Builder | Topography generated in ${(t1 - t0).toFixed(2)}ms`);
        app.renderTimer.record("Base topography", t1 - t0);
    }

    /**
     * Reconstructs currentElevationData: the brushed layer (base terrain with every raster brush
     * stroke applied) with the vector deformations on top.
     *
     * The brushed layer is kept by the brush engine and updated as strokes are finished, undone
     * and redone, so a rebuild normally just copies it and re-applies the vector features. It is
     * replayed from the base terrain, which is the slow part, only when it cannot be trusted: on a
     * full generation (the base terrain may have changed), or after something invalidated it.
     *
     * @param {object} app - The MapStudioApp instance.
     * @param {ProceduralEngine|null} engine - Engine to take the noise source from; created if omitted.
     * @param {object|null} params - Derived map parameters; derived from the UI state if omitted.
     * @param {object|null} bounds - Restricts the rebuild to a rectangle; null rebuilds the whole map.
     * @param {boolean} baseChanged - True when the base terrain was just regenerated, so the
     *   brushed layer must be replayed from it whatever state the layer is in.
     */
    static rebuildFromHistory(app, engine = null, params = null, bounds = null, baseChanged = false) {
        const startTime = performance.now();
        const activeEngine = engine ?? new ProceduralEngine(app.uiState.mapSeed);
        const activeParams = params ?? MapStateManager.getDerivedMapParameters(app.uiState, app.customBiomeColors).params;
        const activeBounds = ProceduralEngine.resolveBounds(bounds, app.mapWidth, app.mapHeight);

        // 1. Bring the brushed layer up to date, replaying the whole history only if it has to be
        const strokeCount = app.brushEngine?.history?.length ?? 0;
        let replayed = false;
        const refreshMs = this.#measureMs(() => {
            replayed = this.#refreshBrushedLayer(app, activeParams.seaLevel, baseChanged);
        });

        // 2-3. Reset the working terrain and biome overrides to the brushed layer
        const mergeMs = this.#measureMs(() => this.#resetToBrushedLayer(app, activeBounds));

        // 4-5. Deform the brushed terrain with the vector features
        const vectorMs = this.#measureMs(() => this.#applyVectorDeformations(app, activeEngine, activeParams, activeBounds));

        // Reported separately from the base topography time logged elsewhere, because on a map with
        // a long brush history the replay is usually the largest part of a rebuild.
        const brushSummary = replayed ? `${strokeCount} brush strokes replayed in ${refreshMs.toFixed(2)}ms` : `${strokeCount} brush strokes reused from the brushed layer`;
        console.log(`World Map Builder | History rebuilt in ${(performance.now() - startTime).toFixed(2)}ms (${brushSummary}, layers merged in ${mergeMs.toFixed(2)}ms, faults and rivers applied in ${vectorMs.toFixed(2)}ms)`);
        app.renderTimer.record(replayed ? "Brush history replay" : "Brush layer reused", refreshMs, `${strokeCount} strokes`);
        app.renderTimer.record("Brush layer merge", mergeMs);
        app.renderTimer.record("Faults and rivers", vectorMs);
    }

    /**
     * Makes sure the brush engine's brushed layer equals a full replay of the stroke history,
     * replaying it from the base terrain if it does not.
     *
     * @returns {boolean} True if the history had to be replayed.
     */
    static #refreshBrushedLayer(app, seaLevel, baseChanged) {
        const brushEngine = app.brushEngine;
        if (!brushEngine) return false;
        if (!baseChanged && brushEngine.isLayerCacheCurrent(seaLevel)) return false;

        brushEngine.rebuildLayerCache(app.baseElevationData, seaLevel);
        return true;
    }

    /**
     * Overwrites the working elevation and biome overrides, within the bounds, with the brushed
     * layer, discarding whatever vector deformations and live brush strokes they held. Without a
     * brush engine there are no strokes, so the working terrain is the base terrain with no
     * painted biomes.
     */
    static #resetToBrushedLayer(app, bounds) {
        const layer = app.brushEngine?.layerCache;
        const elevationSource = layer?.elevation ?? app.baseElevationData;

        this.#forEachBoundsRow(bounds, app.mapWidth, (start, end) => {
            app.currentElevationData.set(elevationSource.subarray(start, end), start);
        });

        // Painted biomes have no separate "base" layer: 0 is the sentinel createBiomesMap()
        // already treats as "no override, compute the biome normally", so with no strokes the
        // overrides are cleared. Without this reset, undoing a paint stroke would leave its
        // override sitting on pixels no remaining stroke touches.
        if (!app.currentBiomeOverrides) return;

        this.#forEachBoundsRow(bounds, app.mapWidth, (start, end) => {
            if (layer) {
                app.currentBiomeOverrides.set(layer.overrides.subarray(start, end), start);
            } else {
                app.currentBiomeOverrides.fill(0, start, end);
            }
        });
    }

    /**
     * Applies the vector features that deform terrain on top of the replayed brush strokes: tectonic
     * faults across both base and brushed terrain, then manual rivers carved into the final
     * deformed topography. The order matters because rivers must cut the terrain faults have
     * already reshaped.
     */
    static #applyVectorDeformations(app, engine, params, bounds) {
        if (app.tectonicFaults?.length > 0) {
            TectonicEngine.applyTectonicFaults(app.currentElevationData, app.mapWidth, app.mapHeight, app.tectonicFaults, engine.simplex, bounds);
        }

        if (app.manualRivers?.length > 0) {
            HydrologyEngine.carveManualRivers(app.currentElevationData, app.mapWidth, app.mapHeight, app.manualRivers, engine.simplex, params.seaLevel, bounds);
        }
    }

    /**
     * Runs `work` and returns how long it took, in milliseconds.
     */
    static #measureMs(work) {
        const start = performance.now();
        work();
        return performance.now() - start;
    }

    /**
     * Walks each row of a rectangular bounds region on a flattened 1D raster buffer, invoking
     * `rowFn(rowStart, rowEndExclusive)` with the touched span of that row. Shared by the
     * elevation and biome-override reset passes above, which both need to walk the same
     * region of their respective same-sized buffers.
     */
    static #forEachBoundsRow(bounds, mapWidth, rowFn) {
        for (let y = bounds.minY; y <= bounds.maxY; y++) {
            const rowOffset = y * mapWidth;
            rowFn(rowOffset + bounds.minX, rowOffset + bounds.maxX + 1);
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
        app.renderTimer.record("Climate", t1 - t0);
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
        app.renderTimer.record("Features (springs and rivers)", t1 - t0);
    }
}
