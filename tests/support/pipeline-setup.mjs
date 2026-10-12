// Builds a MapStudio stand-in for a saved map, as app-pipeline.mjs does, for investigation scripts.
const { FILRODENSWMB } = await import("../../src/config.js");
const { MapStateManager } = await import("../../src/applications/MapStateManager.js");
const { ProceduralOrchestrator } = await import("../../src/ProceduralOrchestrator.js");
const { ProceduralEngine } = await import("../../src/generation/ProceduralEngine.js");
const { BrushEngine } = await import("../../src/tools/BrushEngine.js");
const { RenderTimer } = await import("../../src/tools/RenderTimer.js");
const { TerrainVersion } = await import("../../src/tools/TerrainVersion.js");

export function setupApp(payload) {
    const p = payload.params;
    const W = payload.mapWidth, H = payload.mapHeight;
    const uiState = { ...MapStateManager.buildDefaultUiState(W, H) };
    Object.assign(uiState, {
        mapSeed: payload.seed, generationEngine: payload.generationEngine, terrainVersion: TerrainVersion.getVersion(payload), world: payload.world ?? null,
        mapWidth: W, mapHeight: H, seaLevel: p.seaLevel, tectonicPlates: p.tectonicPlates ?? FILRODENSWMB.GENERATION.TECTONIC_PLATES,
        coastlineFracture: p.coastlineFracture ?? FILRODENSWMB.GENERATION.COASTLINE_FRACTURE, continentalGrouping: p.continentalGrouping ?? FILRODENSWMB.GENERATION.CONTINENTAL_GROUPING,
        shelfRange: p.shelfRange ?? FILRODENSWMB.GENERATION.SHELF_RANGE, coastalPlain: p.coastalPlain ?? FILRODENSWMB.GENERATION.COASTAL_PLAIN, flatTexture: p.flatTexture === true,
        continentScale: p.continentScale ?? FILRODENSWMB.GENERATION.CONTINENT_SCALE, oceanScale: p.oceanScale ?? p.continentScale ?? FILRODENSWMB.GENERATION.CONTINENT_SCALE,
        oceanRidges: p.oceanRidges ?? FILRODENSWMB.GENERATION.OCEAN_RIDGES, globalTemp: p.globalTemp, seasonOffset: p.seasonOffset, latTop: p.latTop, latBottom: p.latBottom,
        globalMoisture: p.globalMoisture, riverDensity: p.riverDensity, springsBaked: payload.springsBaked ?? false,
        "noise.offsetX": p.noise.offsetX, "noise.offsetY": p.noise.offsetY, "noise.moistureOffset": p.noise.moistureOffset ?? FILRODENSWMB.NOISE.OFFSET_MOISTURE,
        "noise.tempOffset": p.noise.tempOffset ?? FILRODENSWMB.NOISE.OFFSET_TEMP, windDistance: p.climate?.windDistance ?? FILRODENSWMB.CLIMATE.WIND_DISTANCE,
        "noise.elevation.scale": 1 / p.noise.elevation.scale, "noise.elevation.octaves": p.noise.elevation.octaves, "noise.elevation.stretch": p.noise.elevation.stretch,
        "noise.moisture.scale": 1 / p.noise.moisture.scale, "noise.moisture.octaves": p.noise.moisture.octaves,
        "noise.temperature.scale": p.noise.temperature?.scale ? 1 / p.noise.temperature.scale : FILRODENSWMB.NOISE.TEMPERATURE.SCALE,
        customBiomes: payload.customBiomes || [], maxLakeSize: p.hydrology?.maxLakeSize ?? FILRODENSWMB.HYDROLOGY.MAX_LAKE_SIZE,
        springAltOffset: p.hydrology?.springAltOffset ?? FILRODENSWMB.HYDROLOGY.SPRING_ALTITUDE_OFFSET, springMoistMin: p.hydrology?.springMoistMin ?? FILRODENSWMB.HYDROLOGY.SPRING_MOISTURE_MIN,
        meanderJitter: p.hydrology?.meanderJitter ?? FILRODENSWMB.HYDROLOGY.MEANDER_JITTER, altCooling: p.climate?.altCooling ?? FILRODENSWMB.CLIMATE.ALTITUDE_COOLING,
        freezingThreshold: p.climate?.freezingThreshold ?? FILRODENSWMB.CLIMATE.FREEZING_THRESHOLD, contourInterval: p.display?.contourInterval ?? 0.1,
        reliefShading: p.display?.reliefShading ?? FILRODENSWMB.DISPLAY.RELIEF_SHADING,
    });
    
    const app = {
        element: { querySelector: () => null },
        uiState, mapWidth: W, mapHeight: H, customBiomeColors: p.customColors || {}, tectonicFaults: payload.tectonicFaults || [], tectonicFeatureCache: {},
        manualRivers: payload.manualRivers || [], mapPins: payload.mapPins || [], landMasks: payload.landMasks || [], renderTimer: new RenderTimer(),
    };
    MapStateManager.allocateBuffers(app);
    app.brushEngine = new BrushEngine(W, H);
    app.brushEngine.surfaceTexture = () => ProceduralOrchestrator.getSurfaceTexture(app);
    app.brushEngine.surfaceTextureAmplitude = ProceduralEngine.getSurfaceTextureAmplitude();
    app.brushEngine.history = payload.history || [];
    
    return app;
}
