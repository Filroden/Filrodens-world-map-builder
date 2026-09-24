import { FILRODENSWMB } from "../config.js";
import { BiomeRuleEngine } from "../generation/BiomeRuleEngine.js";
import { TerrainVersion } from "../tools/TerrainVersion.js";

export class MapStateManager {
    /**
     * Allocates the memory buffers required for procedural generation.
     * @param {Object} app - The MapStudioApp instance.
     */
    static allocateBuffers(app) {
        const totalPixels = app.mapWidth * app.mapHeight;

        app.baseElevationData = new Float32Array(totalPixels);
        app.currentElevationData = new Float32Array(totalPixels);
        app.currentMoistureData = new Float32Array(totalPixels);
        app.currentTemperatureData = new Float32Array(totalPixels);
        app.currentBiomeOverrides = new Uint8Array(totalPixels);
        app.currentSpringOverrides = new Uint8Array(totalPixels);
        app.bufferRiverMap = new Uint8Array(totalPixels);
        app.bufferWaterMask = new Float32Array(totalPixels);

        app.bufferBase = new Uint8Array(totalPixels * 4);
        app.bufferTopography = new Uint8Array(totalPixels * 4);
        app.bufferBiomes = new Uint8Array(totalPixels * 4);
        app.bufferContours = new Uint8Array(totalPixels * 4);
        // Kept in sync alongside bufferBiomes on every biome repaint (see MapStudioApp's
        // _repaintCanvas/#applyBrushStroke), but its own canvas layer stays hidden until the
        // "Preview Rule Coverage" button is hovered - see ProceduralEngine.createBiomesMap's
        // outFallbackBuffer parameter for what actually gets written into it.
        app.bufferBiomeFallback = new Uint8Array(totalPixels * 4);

        // The rebuild scratch buffer is created on demand at the map's current size (see
        // ProceduralOrchestrator); drop any left over from a map of a different size.
        app.bufferScratch = null;

        // Fresh buffers hold nothing from any earlier generation
        app.generationInputs = null;
        app.generationBase = null;
    }

    /**
     * Computes the next sequential ID for a new custom biome, and permanently reserves it by
     * advancing `state.nextCustomBiomeId` - the returned ID is never handed out again, even
     * once the biome that used it is deleted. Custom biome IDs are plain integers rather than
     * GUIDs (unlike Quick Styles) because they're written directly into the currentBiomeOverrides
     * raster buffer as pixel values, and reusing one isn't safe: onDeleteCustomBiome
     * (MapDialogManager) deliberately leaves a deleted biome's old ID sitting in painted pixels
     * and brush strokes rather than scrubbing it out, so undo/redo can restore the paint just by
     * bringing the biome back (see ProceduralEngine.resolveBiomeLookup's doc comment) - handing
     * that same ID to an unrelated new biome would make it silently inherit that leftover paint.
     *
     * `state.nextCustomBiomeId` is absent on maps saved before this counter existed; those fall
     * back to the old highest-existing-ID scheme, which is exactly as safe as it always was for
     * a map that has no already-deleted biome IDs to collide with yet.
     * @param {object} state - The map's uiState (read customBiomes, written back with the new counter).
     * @returns {number} The ID to assign to the new biome.
     */
    static getNextCustomBiomeId(state) {
        if (state.nextCustomBiomeId) {
            return state.nextCustomBiomeId++;
        }
        const currentIds = (state.customBiomes || []).map((biome) => biome.id);
        const id = currentIds.length > 0 ? Math.max(...currentIds) + 1 : FILRODENSWMB.LIMITS.CUSTOM_BIOME_START_ID;
        state.nextCustomBiomeId = id + 1;
        return id;
    }

    /**
     * Builds the baseline state for a new map based on its resolution.
     */
    static buildDefaultUiState(width, height) {
        const baseline = Math.max(FILRODENSWMB.DEFAULTS.MAP_WIDTH, FILRODENSWMB.DEFAULTS.MAP_HEIGHT) || FILRODENSWMB.LIMITS.BASELINE_DIMENSION;
        const maxDim = Math.max(width, height);
        const ratio = maxDim / baseline;

        return {
            generationEngine: "standard",

            // A new map is always built with the current terrain generation rules, and is never
            // a regional map until RegionalExtractor makes one (see TerrainVersion).
            terrainVersion: FILRODENSWMB.TERRAIN_VERSION.CURRENT,
            world: null,
            // Set when the owner of a legacy map declined updating it and asked not to be asked
            // again (see TerrainUpgrade.dismiss); never true for a map built at the current revision.
            terrainUpgradeDismissed: false,

            mapWidth: width,
            mapHeight: height,
            gridType: "square",
            gridSize: 50,
            gridVisible: false,

            terrainBrushTool: "raise",
            biomesBrushTool: "paint",
            sceneBrushTool: "crop",

            brushSize: 20,
            brushStrength: 0.02,
            brushFeather: 0.4,
            brushBiome: FILRODENSWMB.BIOME_IDS.GRASSLAND,
            customBiomes: [],
            nextCustomBiomeId: FILRODENSWMB.LIMITS.CUSTOM_BIOME_START_ID,

            mapSeed: FILRODENSWMB.DEFAULTS.SEED,
            seaLevel: FILRODENSWMB.DEFAULTS.SEA_LEVEL,
            globalTemp: FILRODENSWMB.DEFAULTS.GLOBAL_TEMP,
            seasonOffset: 0,
            latTop: FILRODENSWMB.DEFAULTS.LAT_TOP,
            latBottom: FILRODENSWMB.DEFAULTS.LAT_BOTTOM,
            globalMoisture: FILRODENSWMB.DEFAULTS.GLOBAL_MOISTURE,
            "noise.offsetX": 0,
            "noise.offsetY": 0,

            "noise.elevation.scale": Math.min(Math.max(FILRODENSWMB.LIMITS.NOISE_SCALE_MIN, Math.round(FILRODENSWMB.NOISE.ELEVATION.SCALE * ratio)), FILRODENSWMB.LIMITS.NOISE_SCALE_MAX),
            "noise.elevation.octaves": FILRODENSWMB.NOISE.ELEVATION.OCTAVES,
            "noise.elevation.stretch": FILRODENSWMB.NOISE.ELEVATION.STRETCH,
            "noise.moisture.scale": Math.min(Math.max(FILRODENSWMB.LIMITS.NOISE_SCALE_MIN, Math.round(FILRODENSWMB.NOISE.MOISTURE.SCALE * ratio)), FILRODENSWMB.LIMITS.NOISE_SCALE_MAX),
            "noise.moisture.octaves": FILRODENSWMB.NOISE.MOISTURE.OCTAVES,
            "noise.temperature.scale": Math.min(Math.max(FILRODENSWMB.LIMITS.NOISE_SCALE_MIN, Math.round(FILRODENSWMB.NOISE.TEMPERATURE.SCALE * ratio)), FILRODENSWMB.LIMITS.NOISE_SCALE_MAX),

            tectonicPlates: FILRODENSWMB.GENERATION.TECTONIC_PLATES,
            coastlineFracture: FILRODENSWMB.GENERATION.COASTLINE_FRACTURE,
            continentalGrouping: FILRODENSWMB.GENERATION.CONTINENTAL_GROUPING,
            shelfRange: FILRODENSWMB.GENERATION.SHELF_RANGE,
            coastalPlain: FILRODENSWMB.GENERATION.COASTAL_PLAIN,
            continentScale: FILRODENSWMB.GENERATION.CONTINENT_SCALE,
            oceanScale: FILRODENSWMB.GENERATION.OCEAN_SCALE,
            oceanRidges: FILRODENSWMB.GENERATION.OCEAN_RIDGES,

            activeFeatureMode: "spring",
            riverDensity: FILRODENSWMB.HYDROLOGY.RIVER_DENSITY,
            springsBaked: false,
            faultType: "convergent",
            faultThickness: FILRODENSWMB.TECTONICS?.DEFAULT_THICKNESS || 40,
            faultStrength: FILRODENSWMB.TECTONICS?.DEFAULT_STRENGTH || 0.25,
            riverWidth: 4,
            liveFeatureUpdates: true,

            contourInterval: FILRODENSWMB.DISPLAY.CONTOUR_INTERVAL,
            biomeAlphaActive: FILRODENSWMB.DISPLAY.BIOME_ALPHA_ACTIVE,
            biomeAlphaInactive: FILRODENSWMB.DISPLAY.BIOME_ALPHA_INACTIVE,
            maxLakeSize: FILRODENSWMB.HYDROLOGY.MAX_LAKE_SIZE,
            springAltOffset: FILRODENSWMB.HYDROLOGY.SPRING_ALTITUDE_OFFSET,
            springMoistMin: FILRODENSWMB.HYDROLOGY.SPRING_MOISTURE_MIN,
            meanderJitter: FILRODENSWMB.HYDROLOGY.MEANDER_JITTER,
            altCooling: FILRODENSWMB.CLIMATE.ALTITUDE_COOLING,
            freezingThreshold: FILRODENSWMB.CLIMATE.FREEZING_THRESHOLD,

            activeIcon: "map_pin",
            activeInfraMode: "pin",
            pinColor: "#ffffff",
            pinScale: 1,
            routeColor: "#ffffff",
            routeThickness: 3,
            routeStyle: "solid",
            activeRouteQuickStyle: "custom",
            customRouteStyles: [],

            referenceImage: "",
            referenceAlpha: 0.5,
            referenceScale: 1,
            referenceX: width / 2,
            referenceY: height / 2,

            regionMode: "draw",
            regionPresets: FILRODENSWMB.REGIONS.PRESETS,
            regionFillColor: "#c6af53",
            regionFillStyle: "solid",
            regionLineColor: "#ffffff",
            regionLineThickness: 2,
            regionLineStyle: "solid",
            regionSmoothing: true,
            regionOpacity: 0.5,
            activeRegionQuickStyle: "custom",
            customRegionStyles: [],

            labelFontFamily: FILRODENSWMB.LABELS?.DEFAULT_FONT,
            labelFontSize: FILRODENSWMB.LABELS?.DEFAULT_SIZE,
            labelFillColor: FILRODENSWMB.LABELS?.DEFAULT_COLOR,
            labelMaxWidth: 0,
            labelJustify: "left",
            activeLabelQuickStyle: "custom",
            nextLabelText: game.i18n.localize(FILRODENSWMB.LABELS?.DEFAULT_TEXT) || "New Label",
            customLabelStyles: [],

            cartographyScaleEnable: false,
            cartographyScaleUnits: "Miles",
            cartographyScaleValue: 1,
            cartographyScaleInterval: 100,
            cartographyScaleMajorTicks: 4,
            cartographyScaleMinorTicks: 4,
            cartographyBorderEnable: false,
            cartographyBorderStyle: "solid",
            cartographyBorderColor: "#000000",
            cartographyScaleX: 50,
            cartographyScaleY: height - 50,

            regionalTargetWidth: 1000,
            regionalTargetHeight: 1000,
        };
    }

    /**
     * Generates a deep-cloned snapshot of the current vector state.
     *
     * Custom Biomes (`uiState.customBiomes` - name/code/colour/rules) are included here too,
     * even though they're `uiState` rather than a `MapStudioApp` vector array like the rest of
     * this snapshot - every biome-add/edit/delete action calls `pushVectorState` before
     * applying its change (see MapDialogManager), which only works if a biome change is part of
     * what gets undone. Leaving `customBiomes` out would make Ctrl+Z after renaming, recolouring
     * or editing the auto-generation rules of a custom biome have no effect on it at all.
     */
    static getVectorStateSnapshot(app) {
        return {
            tectonicFaults: foundry.utils.deepClone(app.tectonicFaults),
            activeFaultId: app.activeFaultId,
            manualRivers: foundry.utils.deepClone(app.manualRivers),
            activeRiverId: app.activeRiverId,
            landMasks: foundry.utils.deepClone(app.landMasks || []),
            activeLandMaskId: app.activeLandMaskId,
            pins: foundry.utils.deepClone(app.mapPins),
            routes: foundry.utils.deepClone(app.mapRoutes),
            regionLayers: foundry.utils.deepClone(app.regionLayers),
            mapLabels: foundry.utils.deepClone(app.mapLabels),
            mapDecorations: foundry.utils.deepClone(app.mapDecorations),
            activeRouteId: app.activeRouteId,
            activeRegionId: app.activeRegionId,
            customBiomes: foundry.utils.deepClone(app.uiState?.customBiomes || []),
        };
    }

    /**
     * Captures the current state of all non-destructive vector arrays and pushes them to the history stack.
     */
    static pushVectorState(app) {
        app.pinHistory.push(this.getVectorStateSnapshot(app));

        if (app.pinHistory.length > FILRODENSWMB.LIMITS.HISTORY_MAX) {
            app.pinHistory.shift();
        }

        app.pinRedoStack = [];

        // Push to the Global Ledger and clear forward redos
        if (!app.globalHistoryLedger) app.globalHistoryLedger = [];
        app.globalHistoryLedger.push("vector");
        app.globalRedoLedger = [];

        if (app.globalHistoryLedger.length > FILRODENSWMB.LIMITS.HISTORY_MAX) {
            app.globalHistoryLedger.shift();
        }
    }

    /**
     * Restores the vector arrays and active IDs from a history snapshot.
     */
    static restoreVectorStateSnapshot(app, state) {
        app.tectonicFaults = state.tectonicFaults || app.tectonicFaults;
        app.activeFaultId = state.activeFaultId || null;
        app.manualRivers = state.manualRivers || app.manualRivers;
        app.activeRiverId = state.activeRiverId || null;
        app.landMasks = state.landMasks || app.landMasks || [];
        app.activeLandMaskId = state.activeLandMaskId || null;
        app.mapPins = state.pins || app.mapPins;
        app.mapRoutes = state.routes || app.mapRoutes;
        app.regionLayers = state.regionLayers || app.regionLayers;
        app.mapLabels = state.mapLabels || app.mapLabels;
        app.mapDecorations = state.mapDecorations || app.mapDecorations;
        app.activeRouteId = state.activeRouteId || null;
        app.activeRegionId = state.activeRegionId || null;
        app.uiState.customBiomes = state.customBiomes || app.uiState.customBiomes;
    }

    /**
     * Syncs the active UI state from the DOM, then gets derived map parameters.
     */
    static getMapParameters(app) {
        for (const key of Object.keys(app.uiState)) {
            const input = app.element.querySelector(`[name="${key}"]`);
            if (!input) continue;

            if (key === "mapSeed" || key === "gridType" || key === "generationEngine") {
                app.uiState[key] = input.value;
            } else {
                const parsed = Number.parseFloat(input.value);
                if (!Number.isNaN(parsed)) {
                    app.uiState[key] = parsed;
                }
            }
        }

        return this.getDerivedMapParameters(app.uiState, app.customBiomeColors);
    }

    /**
     * Converts raw state strings/numbers into the final parameters needed by ProceduralEngine.
     */
    static getDerivedMapParameters(state, customBiomeColors) {
        const compiledPalette = {};
        for (const [key, id] of Object.entries(FILRODENSWMB.BIOME_IDS)) {
            const rgb = customBiomeColors[key] || FILRODENSWMB.BIOMES[key] || [0, 0, 0];
            compiledPalette[id] = rgb;
            compiledPalette[key] = rgb;
        }
        for (const cb of state.customBiomes || []) {
            compiledPalette[cb.id] = cb.color;
        }

        // Custom biomes default to rendering transparent below sea level, exactly like the
        // map's own auto-generated biomes there - but a biome meant to represent something
        // like pack ice or a floating landmass needs to stay visible over water instead, the
        // way the built-in PACK_ICE biome always has. This map only lists the biomes that
        // opted into that (a sparse id -> true lookup), so ProceduralEngine.resolveBiomeLookup
        // can check it in O(1) per pixel without touching the ones that didn't.
        const solidOverWater = {};
        for (const cb of state.customBiomes || []) {
            if (cb.solidOverWater) solidOverWater[cb.id] = true;
        }

        const params = {
            seaLevel: state.generationEngine === "advanced" ? 0.35 : state.seaLevel,
            tectonicPlates: state.tectonicPlates,
            coastlineFracture: state.coastlineFracture,
            continentalGrouping: state.continentalGrouping,
            shelfRange: state.shelfRange,
            coastalPlain: state.coastalPlain,
            continentScale: state.continentScale,
            oceanScale: state.oceanScale,
            oceanRidges: state.oceanRidges,
            globalTemp: state.globalTemp,
            seasonOffset: state.seasonOffset,
            latTop: state.latTop,
            latBottom: state.latBottom,
            globalMoisture: state.globalMoisture,
            riverDensity: state.riverDensity,
            // Values that depend on the map's terrain revision, already resolved into plain
            // numbers so the generation engines never need to know which revision they serve.
            terrain: TerrainVersion.getTerrainParams(state),
            noise: {
                offsetX: state["noise.offsetX"],
                offsetY: state["noise.offsetY"],
                moistureOffset: state["noise.moistureOffset"] ?? FILRODENSWMB.NOISE.OFFSET_MOISTURE,
                tempOffset: state["noise.tempOffset"] ?? FILRODENSWMB.NOISE.OFFSET_TEMP,
                elevation: {
                    scale: 1 / state["noise.elevation.scale"],
                    octaves: state["noise.elevation.octaves"],
                    stretch: state["noise.elevation.stretch"],
                },
                moisture: {
                    scale: 1 / state["noise.moisture.scale"],
                    octaves: state["noise.moisture.octaves"],
                },
                temperature: {
                    scale: 1 / (state["noise.temperature.scale"] || FILRODENSWMB.NOISE.TEMPERATURE.SCALE),
                    octaves: FILRODENSWMB.NOISE.TEMPERATURE.OCTAVES,
                },
            },
            hydrology: {
                maxLakeSize: state.maxLakeSize,
                springAltOffset: state.springAltOffset,
                springMoistMin: state.springMoistMin,
                meanderJitter: state.meanderJitter,
            },
            climate: {
                altCooling: state.altCooling,
                freezingThreshold: state.freezingThreshold,
                windDistance: state.windDistance ?? FILRODENSWMB.CLIMATE.WIND_DISTANCE,
            },
            biomePalette: compiledPalette,
            solidOverWater,
            customColors: customBiomeColors,
            // Compiled once per generation, not per pixel - see BiomeRuleEngine's own doc
            // comment for why. Custom biomes with no rules yet (rules: [] or undefined)
            // simply contribute zero rows, so this is a no-op until rules actually exist.
            customBiomeRules: BiomeRuleEngine.compile(state.customBiomes || []),
            display: {
                contourInterval: state.contourInterval,
                biomeAlphaActive: state.biomeAlphaActive,
                biomeAlphaInactive: state.biomeAlphaInactive,
            },
            cartography: {
                scaleEnable: state.cartographyScaleEnable,
                scaleUnits: state.cartographyScaleUnits,
                scaleInterval: state.cartographyScaleInterval,
                scaleValue: state.cartographyScaleValue,
                scaleMajorTicks: state.cartographyScaleMajorTicks,
                scaleMinorTicks: state.cartographyScaleMinorTicks,
                scaleX: state.cartographyScaleX,
                scaleY: state.cartographyScaleY,
                borderEnable: state.cartographyBorderEnable,
                borderStyle: state.cartographyBorderStyle,
                borderColor: state.cartographyBorderColor,
            },
        };

        return { currentSeed: state.mapSeed, params };
    }
}
