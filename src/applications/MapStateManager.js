import { FILRODENSWMB } from "../config.js";

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
    }

    /**
     * Builds the baseline state for a new map based on its resolution.
     */
    static buildDefaultUiState(width, height) {
        const baseline = Math.max(FILRODENSWMB.DEFAULTS.MAP_WIDTH, FILRODENSWMB.DEFAULTS.MAP_HEIGHT) || FILRODENSWMB.LIMITS.BASELINE_DIMENSION;
        const maxDim = Math.max(width, height);
        const ratio = maxDim / baseline;

        return {
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
            snapToPoints: true,
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
     */
    static getVectorStateSnapshot(app) {
        return {
            tectonicFaults: foundry.utils.deepClone(app.tectonicFaults),
            activeFaultId: app.activeFaultId,
            manualRivers: foundry.utils.deepClone(app.manualRivers),
            activeRiverId: app.activeRiverId,
            pins: foundry.utils.deepClone(app.mapPins),
            routes: foundry.utils.deepClone(app.mapRoutes),
            regionLayers: foundry.utils.deepClone(app.regionLayers),
            mapLabels: foundry.utils.deepClone(app.mapLabels),
            mapDecorations: foundry.utils.deepClone(app.mapDecorations),
            activeRouteId: app.activeRouteId,
            activeRegionId: app.activeRegionId,
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
        app.mapPins = state.pins || app.mapPins;
        app.mapRoutes = state.routes || app.mapRoutes;
        app.regionLayers = state.regionLayers || app.regionLayers;
        app.mapLabels = state.mapLabels || app.mapLabels;
        app.mapDecorations = state.mapDecorations || app.mapDecorations;
        app.activeRouteId = state.activeRouteId || null;
        app.activeRegionId = state.activeRegionId || null;
    }

    /**
     * Syncs the active UI state from the DOM, then gets derived map parameters.
     */
    static getMapParameters(app) {
        for (const key of Object.keys(app.uiState)) {
            const input = app.element.querySelector(`[name="${key}"]`);
            if (!input) continue;

            if (key === "mapSeed" || key === "gridType") {
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

        const params = {
            seaLevel: state.seaLevel,
            globalTemp: state.globalTemp,
            seasonOffset: state.seasonOffset,
            latTop: state.latTop,
            latBottom: state.latBottom,
            globalMoisture: state.globalMoisture,
            riverDensity: state.riverDensity,
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
            customColors: customBiomeColors,
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
