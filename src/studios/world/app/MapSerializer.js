import { FILRODENSWMB } from "../../../config.js";
import { LabelWidth } from "../../../kernel/util/LabelWidth.js";
import { Sanitize } from "../../../kernel/data/Sanitize.js";
import { findUnresolvedPinIcons } from "../../../kernel/data/pinIcons.js";
import { cleanUnit, unitFromSaved } from "../../../kernel/data/MapUnit.js";
import { SymbolScale } from "../../../kernel/util/SymbolScale.js";
import { platform } from "../../../platform/index.js";
import { TerrainVersion } from "../tools/TerrainVersion.js";
import { FaultThickness } from "../tools/FaultThickness.js";
import { scaleBarOnMap } from "../data/MapScale.js";
import { rebaseMap } from "../data/SymbolSizes.js";
import { addLocalLevelOnce } from "../data/LocalLevel.js";
import { refreshWaterRoutesOnce } from "../data/WaterRouteStyles.js";
import { showNamesOnce } from "../data/NameLevels.js";
import { GeneratorRevision } from "../generator/GeneratorRevision.js";
import { panelSettings } from "../generator/GeneratorSettings.js";
import { DetailLevel } from "./DetailLevel.js";
import { MapStateManager } from "./MapStateManager.js";
import { MeshIntegration } from "./MeshIntegration.js";
import { PinStyles } from "./PinStyles.js";
import { ThematicView } from "./ThematicView.js";
import { TerrainUpgrade } from "./TerrainUpgrade.js";

/**
 * A map's saved file read into the studio and written from it, and the studio's map made blank
 * (RF2): the file's side of loading, saving and clearing, with the migrations and every value's
 * fallback. The studio's own side (its canvas, layers, brush engine, notices, the world and its
 * access) stays in MapStudio, which calls these in turn.
 *
 * The host is the studio, or any object with its map fields: `uiState`, `defaultUiState`,
 * `mapWidth`, `mapHeight`, `regionLevels` and the map's lists. These read and write those fields
 * as MapStudio did, in the same order, so a map loads and saves exactly as before.
 */
export class MapSerializer {
    /**
     * The settings a map's file holds: read back into uiState when it is loaded (readFrame,
     * readContent, readReference) and written with it when it is saved (write, through
     * MapStateManager.getMapParameters for the generation settings).
     */
    static SAVED_SETTINGS = Object.freeze([
        "generationEngine", "terrainVersion", "world", "generatorStale", "generatorRevision", "generatorSettings",
        "cultures", "terrainUpgradeDismissed", "mapWidth", "mapHeight", "gridType", "gridSize", "gridVisible",
        "detailLevel", "avoidLabelOverlaps", "symbolSize", "hiddenLabelStyles", "hiddenLevels", "hideRegionFills",
        "customBiomes", "nextCustomBiomeId", "mapSeed", "flatTexture", "seaLevel", "globalTemp", "seasonOffset",
        "latTop", "latBottom", "globalMoisture", "noise.offsetX", "noise.offsetY", "noise.elevation.scale",
        "noise.elevation.octaves", "noise.elevation.stretch", "noise.moisture.scale", "noise.moisture.octaves",
        "noise.temperature.scale", "tectonicPlates", "coastlineFracture", "continentalGrouping", "shelfRange",
        "coastalPlain", "continentScale", "oceanScale", "oceanRidges", "riverDensity", "springsBaked",
        "contourInterval", "reliefShading", "reliefEmphasis", "seabedRelief", "waterClarity",
        "waterHue", "waterSaturation", "biomeAlphaActive", "biomeAlphaInactive", "maxLakeSize", "springAltOffset",
        "springMoistMin", "meanderJitter", "riverMeander", "riverWidthScale", "altCooling", "freezingThreshold",
        "customPinStyles", "customRouteStyles", "regionOpacity", "customRegionStyles", "customLabelStyles",
        "thematic", "mapUnit", "cartographyScaleEnable", "cartographyScaleMatchWorld", "cartographyScaleValue",
        "cartographyScaleInterval", "cartographyScaleMajorTicks", "cartographyScaleMinorTicks",
        "cartographyBorderEnable", "cartographyBorderStyle", "cartographyBorderColor", "cartographyScaleX",
        "cartographyScaleY", "noise.moistureOffset", "noise.tempOffset", "windDistance", "referenceImage",
        "referenceAlpha", "referenceScale", "referenceX", "referenceY"
    ]);

    /**
     * The settings of the session only, never saved with a map: the tools' own choices (a brush,
     * the pin, label, route, region, fault and influence tools' settings), the regional tools'
     * sizes, travel, how far back the history goes and live feature updates. A map loaded keeps
     * them as they were, but for the fault tool's thickness, which starts at the map's own default.
     */
    static SESSION_SETTINGS = Object.freeze([
        "terrainBrushTool", "biomesBrushTool", "sceneBrushTool", "brushSize", "brushStrength", "brushFeather",
        "influenceKind", "influencePaintMode", "influenceStrength", "influenceFeather", "brushBiome",
        "activeFeatureMode", "faultType", "faultStrength", "faultStyle", "faultThickness", "riverWidth", "liveFeatureUpdates",
        "activeIcon", "activeInfraMode", "activePinStyle", "pinColor", "pinScale", "pinToolMode", "labelToolMode",
        "routeToolMode", "routeDetail", "routeColor", "routeThickness", "routeStyle", "routeOutline",
        "routeSmoothing", "routeMode", "routeSpanWater", "routeTransport", "activeRouteQuickStyle", "regionPresets",
        "regionPaintMode", "regionShowAll", "activeRegionQuickStyle", "labelFontFamily", "labelFontSize",
        "labelFillColor", "labelMaxChars", "labelJustify", "labelBold", "labelItalic", "activeLabelQuickStyle",
        "nextLabelText", "historyAge", "travel", "regionalTargetWidth", "regionalTargetHeight", "regionalInfill",
        "regionalAlignGrid"
    ]);

    /**
     * The saved file as it is read: a copy (never the store's own object), with the migrations
     * that run on every load until the map is saved again.
     * @param {object} rawPayload
     * @returns {object}
     */
    static prepare(rawPayload) {
        const payload = platform.utils.deepClone(rawPayload);
        // Pin and label sizes saved before the current size unit are scaled to it (see SymbolSizes).
        // The map is not marked as changed: until it is saved, the same scaling runs on every load.
        rebaseMap(payload);
        // Generated names that older runs hid are given back to their styles, once (see NameLevels)
        showNamesOnce(payload);
        // A map saved before the Local detail level keeps what Everything showed (see LocalLevel)
        addLocalLevelOnce(payload);
        // Water route styles still on their old defaults take the new look (see WaterRouteStyles)
        refreshWaterRoutesOnce(payload);
        return payload;
    }

    /**
     * The file's frame and flags into the host: its seed and engine, terrain and generator
     * revisions, the run it came from, its size and its map-wide display settings. Read before
     * the buffers are made, since they are made at this size.
     * @param {object} payload - From prepare.
     * @param {object} host
     */
    static readFrame(payload, host) {
        host.uiState.mapSeed = payload.seed;
        host.currentParentId = payload.parentId || null;

        host.uiState.generationEngine = payload.generationEngine || "standard";

        // The terrain rules this map was built with, so it regenerates exactly as it was saved.
        // A map saved before the revision number existed has none, and reads as the legacy
        // revision (see TerrainVersion). Only regional maps carry a world description.
        host.uiState.terrainVersion = TerrainVersion.getVersion(payload);
        host.uiState.world = payload.world ?? null;
        host.uiState.generatorStale = payload.generatorStale === true;
        // The generator rules the map follows; a map saved before they were recorded reads as the
        // oldest (see GeneratorRevision)
        host.uiState.generatorRevision = GeneratorRevision.of(payload);
        host.uiState.generatorSettings = panelSettings(payload.generatorSettings);
        host.uiState.cultures = Array.isArray(payload.cultures) ? payload.cultures : [];
        host.upwindMargin = payload.upwindMargin ?? null;
        host.parentRun = payload.parentRun ?? null;
        host.infillPending = payload.infillPending === true;
        host.infillInputs = payload.infillInputs ?? null;
        host.riverRoutesLaid = payload.riverRoutes === true;
        host.shoresPlaced = payload.shoresPlaced === true;
        host.uiState.terrainUpgradeDismissed = payload.terrainUpgradeDismissed === true;
        host.terrainUpgrade = null;

        host.mapWidth = payload.mapWidth;
        host.mapHeight = payload.mapHeight;

        host.uiState.mapWidth = host.mapWidth;
        host.uiState.mapHeight = host.mapHeight;
        // New faults on this map start at its own default thickness (see FaultThickness)
        host.uiState.faultThickness = FaultThickness.limits(host.mapWidth).default;
        host.uiState.gridType = payload.gridType || "square";
        // Raised to the smallest grid Foundry allows: a map saved with a smaller grid (the slider
        // used to go down to 10) would otherwise export a scene whose grid Foundry enlarges, while
        // its grid data describes the smaller cells
        host.uiState.gridSize = MapStateManager.gridSizeOf(payload.gridSize || 100);
        host.uiState.gridVisible = payload.gridVisible ?? false;
        host.uiState.detailLevel = DetailLevel.valid(payload.detailLevel);
        host.uiState.avoidLabelOverlaps = payload.avoidLabelOverlaps !== false;
        host.uiState.symbolSize = SymbolScale.valid(payload.symbolSize);
        host.uiState.hiddenLabelStyles = Array.isArray(payload.hiddenLabelStyles) ? [...payload.hiddenLabelStyles] : [];
        host.uiState.hiddenLevels = Array.isArray(payload.hiddenLevels) ? [...payload.hiddenLevels] : [];
        host.uiState.hideRegionFills = payload.hideRegionFills === true;
        host.uiState.thematic = ThematicView.valid(payload.thematic);
    }

    /**
     * The rest of the file into the host: the generation, climate, hydrology, display and
     * cartography settings, the style lists, the faults, rivers, pins, routes, masks, labels and
     * decorations (with the old visibility flags and missing styles made good), and the reference
     * image.
     * @param {object} payload - From prepare, after readFrame.
     * @param {object} host
     * @returns {Promise<{history: object[], unresolvedPins: number}>} The brush history to replay,
     *   and how many pins name an icon this world has not registered.
     */
    static async readContent(payload, host) {
        const p = payload.params;
        const c = p.cartography || {};

        host.uiState.seaLevel = p.seaLevel;
        host.uiState.tectonicPlates = p.tectonicPlates ?? FILRODENSWMB.GENERATION.TECTONIC_PLATES;
        host.uiState.coastlineFracture = p.coastlineFracture ?? FILRODENSWMB.GENERATION.COASTLINE_FRACTURE;
        host.uiState.continentalGrouping = p.continentalGrouping ?? FILRODENSWMB.GENERATION.CONTINENTAL_GROUPING;
        host.uiState.shelfRange = p.shelfRange ?? FILRODENSWMB.GENERATION.SHELF_RANGE;
        host.uiState.coastalPlain = p.coastalPlain ?? FILRODENSWMB.GENERATION.COASTAL_PLAIN;
        host.uiState.flatTexture = p.flatTexture === true;
        host.uiState.continentScale = p.continentScale ?? FILRODENSWMB.GENERATION.CONTINENT_SCALE;
        // Maps saved before Ocean Scale existed used Continent Scale for the sea too, so an
        // updated map starts with the same value on both sides.
        host.uiState.oceanScale = p.oceanScale ?? host.uiState.continentScale;
        host.uiState.oceanRidges = p.oceanRidges ?? FILRODENSWMB.GENERATION.OCEAN_RIDGES;
        host.uiState.globalTemp = p.globalTemp;
        host.uiState.seasonOffset = p.seasonOffset;
        host.uiState.latTop = p.latTop;
        host.uiState.latBottom = p.latBottom;
        host.uiState.globalMoisture = p.globalMoisture;
        host.uiState.riverDensity = p.riverDensity;
        host.uiState.springsBaked = payload.springsBaked ?? false;

        host.uiState["noise.offsetX"] = p.noise.offsetX;
        host.uiState["noise.offsetY"] = p.noise.offsetY;
        host.uiState["noise.moistureOffset"] = p.noise.moistureOffset ?? FILRODENSWMB.NOISE.OFFSET_MOISTURE;
        host.uiState["noise.tempOffset"] = p.noise.tempOffset ?? FILRODENSWMB.NOISE.OFFSET_TEMP;
        host.uiState.windDistance = p.climate?.windDistance ?? FILRODENSWMB.CLIMATE.WIND_DISTANCE;

        // Read after the wind distance, which is what identifies a legacy regional map
        host.legacyRootSize = TerrainVersion.isLegacyRegional(host.uiState) ? await TerrainUpgrade.resolveLegacyRootSize(payload) : null;

        host.uiState["noise.elevation.scale"] = 1 / p.noise.elevation.scale;
        host.uiState["noise.elevation.octaves"] = p.noise.elevation.octaves;
        host.uiState["noise.elevation.stretch"] = p.noise.elevation.stretch;
        host.uiState["noise.moisture.scale"] = 1 / p.noise.moisture.scale;
        host.uiState["noise.moisture.octaves"] = p.noise.moisture.octaves;

        host.uiState["noise.temperature.scale"] = p.noise.temperature?.scale ? 1 / p.noise.temperature.scale : FILRODENSWMB.NOISE.TEMPERATURE.SCALE;

        host.uiState.customBiomes = payload.customBiomes || [];
        // Falls back to undefined on a map saved before this counter existed, which
        // MapStateManager.getNextCustomBiomeId already treats as "derive it from the biomes
        // that came back above" - see that method's own doc comment for why a deleted biome's
        // ID must never come back into circulation, on a freshly loaded map any more than on
        // one that's stayed open the whole time.
        host.uiState.nextCustomBiomeId = payload.nextCustomBiomeId;
        host.uiState.customRouteStyles = payload.customRouteStyles || [];
        host.uiState.customLabelStyles = payload.customLabelStyles || [];
        host.uiState.customRegionStyles = payload.customRegionStyles || [];
        // A map saved before pin styles existed gets the default set; a map that has the key keeps its own, even emptied
        host.uiState.customPinStyles = Array.isArray(payload.customPinStyles) ? payload.customPinStyles : null;
        PinStyles.ensure(host);

        host.uiState.maxLakeSize = p.hydrology?.maxLakeSize ?? FILRODENSWMB.HYDROLOGY.MAX_LAKE_SIZE;
        host.uiState.springAltOffset = p.hydrology?.springAltOffset ?? FILRODENSWMB.HYDROLOGY.SPRING_ALTITUDE_OFFSET;
        host.uiState.springMoistMin = p.hydrology?.springMoistMin ?? FILRODENSWMB.HYDROLOGY.SPRING_MOISTURE_MIN;
        host.uiState.meanderJitter = p.hydrology?.meanderJitter ?? FILRODENSWMB.HYDROLOGY.MEANDER_JITTER;
        host.uiState.riverMeander = p.hydrology?.riverMeander ?? MapStateManager.riverMeanderFromJitter(host.uiState.meanderJitter);
        host.uiState.riverWidthScale = p.hydrology?.riverWidthScale ?? FILRODENSWMB.HYDROLOGY.CHANNELS.WIDTH;
        host.uiState.altCooling = p.climate?.altCooling ?? FILRODENSWMB.CLIMATE.ALTITUDE_COOLING;
        host.uiState.freezingThreshold = p.climate?.freezingThreshold ?? FILRODENSWMB.CLIMATE.FREEZING_THRESHOLD;
        host.uiState.contourInterval = p.display?.contourInterval ?? 0.1;
        host.uiState.reliefShading = p.display?.reliefShading ?? FILRODENSWMB.DISPLAY.RELIEF_SHADING;
        // Maps saved before Relief Emphasis take its default
        host.uiState.reliefEmphasis = p.display?.reliefEmphasis ?? FILRODENSWMB.DISPLAY.THREE_D.RELIEF.EMPHASIS;
        host.uiState.seabedRelief = p.display?.seabedRelief ?? FILRODENSWMB.DISPLAY.WATER.SEABED_RELIEF;
        host.uiState.waterClarity = p.display?.waterClarity ?? FILRODENSWMB.DISPLAY.WATER.CLARITY;
        host.uiState.waterHue = p.display?.waterHue ?? FILRODENSWMB.DISPLAY.WATER.HUE;
        host.uiState.waterSaturation = p.display?.waterSaturation ?? FILRODENSWMB.DISPLAY.WATER.SATURATION;
        host.uiState.biomeAlphaActive = p.display?.biomeAlphaActive ?? FILRODENSWMB.DISPLAY.BIOME_ALPHA_ACTIVE;
        host.uiState.biomeAlphaInactive = p.display?.biomeAlphaInactive ?? FILRODENSWMB.DISPLAY.BIOME_ALPHA_INACTIVE;
        host.uiState.regionOpacity = p.display?.regionOpacity ?? FILRODENSWMB.DISPLAY.REGION_OPACITY;
        host.uiState.cartographyScaleEnable = c.scaleEnable ?? host.defaultUiState.cartographyScaleEnable;
        // A map saved before it had a unit takes it from its scale bar's text, and keeps its
        // hand-set bar (see MapUnit.unitFromSaved)
        host.uiState.mapUnit = unitFromSaved(payload).unit;
        host.uiState.cartographyScaleMatchWorld = c.scaleMatchWorld === true;
        host.uiState.cartographyScaleInterval = c.scaleInterval ?? host.defaultUiState.cartographyScaleInterval;
        host.uiState.cartographyScaleValue = c.scaleValue ?? host.defaultUiState.cartographyScaleValue;
        host.uiState.cartographyScaleMajorTicks = c.scaleMajorTicks ?? host.defaultUiState.cartographyScaleMajorTicks;
        host.uiState.cartographyScaleMinorTicks = c.scaleMinorTicks ?? host.defaultUiState.cartographyScaleMinorTicks;
        host.uiState.cartographyScaleX = c.scaleX ?? host.defaultUiState.cartographyScaleX;
        host.uiState.cartographyScaleY = c.scaleY ?? host.defaultUiState.cartographyScaleY;
        // A bar left off the map (by a regional map cut before bars were brought onto it) comes back
        MapSerializer.keepScaleBarOnMap(host);
        host.uiState.cartographyBorderEnable = c.borderEnable ?? host.defaultUiState.cartographyBorderEnable;
        host.uiState.cartographyBorderStyle = c.borderStyle ?? host.defaultUiState.cartographyBorderStyle;
        host.uiState.cartographyBorderColor = c.borderColor ?? host.defaultUiState.cartographyBorderColor;

        // Legacy Visibility Migration
        const migrateVisibility = (arr) => {
            arr.forEach((item) => {
                if (item.hidden !== undefined) {
                    item.visibility = item.hidden ? "none" : "all";
                    delete item.hidden; // Clean up old data
                }
                if (item.label?.hidden !== undefined) {
                    item.label.visibility = item.label.hidden ? "none" : "all";
                    delete item.label.hidden;
                }
            });
        };

        if (payload.mapPins) migrateVisibility(payload.mapPins);

        if (payload.mapRoutes) {
            migrateVisibility(payload.mapRoutes);
            payload.mapRoutes.forEach((route) => {
                if (!route.quickStyle) route.quickStyle = "custom"; // Flag old routes as custom overrides

                // Heal legacy routes missing visual properties
                route.color = route.color || "#ffffff";
                route.thickness = route.thickness || 3;
                route.style = route.style || "solid";
            });
        }

        if (payload.mapLabels) migrateVisibility(payload.mapLabels);

        if (payload.mapDecorations) migrateVisibility(payload.mapDecorations);

        if (payload.regionLayers) {
            payload.regionLayers.forEach((layer) => {
                if (layer.hidden !== undefined) {
                    layer.visibility = layer.hidden ? "none" : "all";
                    delete layer.hidden;
                }
                if (layer.regions) {
                    migrateVisibility(layer.regions);
                    layer.regions.forEach((region) => {
                        if (!region.quickStyle) region.quickStyle = "custom"; // Flag old regions as custom overrides
                    });
                }
            });
        }

        host.customBiomeColors = p.customColors || {};

        host.tectonicFaults = payload.tectonicFaults || [];

        host.manualRivers = payload.manualRivers || [];
        if (payload.manualRivers) {
            payload.manualRivers.forEach((river) => {
                if (river.hidden !== undefined) {
                    river.visibility = river.hidden ? "none" : "all";
                    delete river.hidden;
                }
            });
        }
        // A map that a later revision would not change moves to it now (a revision 2 map with no
        // hotspot chain or custom river to revision 3, a revision 3 top map to revision 4; see
        // TerrainVersion.settledVersion), so anything added from here on is built by the current
        // rules. It looks exactly as it did, so the map is not marked as changed: the move is kept
        // with its next save, and until then it is made again on every load.
        const settled = TerrainVersion.settledVersion(host.uiState, host.tectonicFaults, host.manualRivers);
        if (settled !== null) host.uiState.terrainVersion = settled;

        // Guarantee every pin has a valid `color` property, defaulting to white for legacy maps
        host.mapPins = (payload.mapPins || []).map((pin) => {
            pin.color = pin.color || "#ffffff";
            return pin;
        });
        const { affectedPinCount } = findUnresolvedPinIcons(host.mapPins);

        host.mapRoutes = payload.mapRoutes || [];
        host.landMasks = payload.landMasks || [];
        host.mapLabels = payload.mapLabels || [];
        host.mapDecorations = payload.mapDecorations || [];

        // Label widths saved in pixels (before widths were measured in characters) become
        // characters, rounded up so no label wraps earlier than before (see LabelWidth). The map
        // is not marked as changed: until it is saved, the same conversion runs on every load.
        LabelWidth.migrateMap(
            // A map saved before layer sets existed still has its region layers here; they become
            // levels when the map's mesh session opens, keeping the labels converted now
            { mapLabels: host.mapLabels, mapPins: host.mapPins, mapRoutes: host.mapRoutes, regionLayers: payload.regionLayers ?? host.regionLevels, customLabelStyles: host.uiState.customLabelStyles },
            LabelWidth.rootFontSize(),
        );
        // The map's own reference image, or none for a map saved without one (or before maps
        // kept it), so the previous map's image is not left behind on this one
        MapSerializer.readReference(host, payload.reference);
        return { history: payload.history || [], unresolvedPins: affectedPinCount };
    }

    /**
     * The map as a save writes it: its data (the generation settings, every vector list, the
     * styles and the display mesh's block and layer sets), its encoded owner arrays by level id, and
     * the generator's saved outputs (null when the map has no run). Reads the panel's fields first,
     * as every save does (see MapStateManager.getMapParameters).
     * @param {object} host
     * @returns {{payload: object, owners: Object<string, string>, modelRun: object|null}}
     */
    static write(host) {
        const { currentSeed, params } = MapStateManager.getMapParameters(host);
        const payload = {
            seed: currentSeed,
            generationEngine: host.uiState.generationEngine,
            terrainVersion: host.uiState.terrainVersion,
            sizeRevision: FILRODENSWMB.SYMBOLS.REVISION,
            nameLevels: true,
            localLevel: true,
            waterRoutes: true,
            world: host.uiState.world,
            mapUnit: cleanUnit(host.uiState.mapUnit),
            generatorStale: host.uiState.generatorStale === true,
            generatorRevision: GeneratorRevision.of(host.uiState),
            generatorSettings: panelSettings(host.uiState.generatorSettings),
            cultures: platform.utils.deepClone(host.uiState.cultures ?? []),
            upwindMargin: host.upwindMargin ?? null,
            parentRun: host.parentRun ?? null,
            infillPending: host.infillPending === true,
            infillInputs: host.infillInputs ?? null,
            riverRoutes: host.riverRoutesLaid === true,
            shoresPlaced: host.shoresPlaced === true,
            terrainUpgradeDismissed: host.uiState.terrainUpgradeDismissed === true,
            springsBaked: host.uiState.springsBaked,
            mapWidth: host.mapWidth,
            mapHeight: host.mapHeight,
            gridType: host.uiState.gridType,
            gridSize: host.uiState.gridSize,
            gridVisible: host.uiState.gridVisible,
            detailLevel: DetailLevel.current(host),
            avoidLabelOverlaps: host.uiState.avoidLabelOverlaps !== false,
            symbolSize: SymbolScale.valid(host.uiState.symbolSize),
            hiddenLabelStyles: [...(host.uiState.hiddenLabelStyles ?? [])],
            hiddenLevels: [...(host.uiState.hiddenLevels ?? [])],
            hideRegionFills: host.uiState.hideRegionFills === true,
            thematic: ThematicView.setting(host),
            params: params,
            customBiomes: host.uiState.customBiomes,
            nextCustomBiomeId: host.uiState.nextCustomBiomeId,
            customRouteStyles: host.uiState.customRouteStyles,
            customLabelStyles: host.uiState.customLabelStyles,
            customRegionStyles: host.uiState.customRegionStyles,
            customPinStyles: host.uiState.customPinStyles,
            history: host.brushEngine?.history || [],
            tectonicFaults: host.tectonicFaults,
            manualRivers: host.manualRivers,
            mapPins: host.mapPins,
            mapRoutes: host.mapRoutes,
            landMasks: host.landMasks,
            mapLabels: host.mapLabels,
            mapDecorations: host.mapDecorations,
            // The reference image with its place, size and opacity, so it is there again when the
            // map is opened; null when the map has none
            reference: MapSerializer.referenceOf(host.uiState),
            parentId: host.currentParentId,
        };

        // The display mesh's block, layer sets and owner arrays (see MeshIntegration)
        const owners = MeshIntegration.preparePayload(host, payload);
        return { payload, owners, modelRun: host.modelRun ?? null };
    }

    /**
     * The settings of a blank map in the host's frame: the defaults, and the built-in biomes'
     * colours at theirs (so the panel's fields read them).
     * @param {object} host
     */
    static blankSettings(host) {
        host.defaultUiState = MapStateManager.buildDefaultUiState(host.mapWidth, host.mapHeight);
        host.uiState = platform.utils.deepClone(host.defaultUiState);
        host.customBiomeColors = {};
        Object.entries(FILRODENSWMB.BIOMES).forEach(([key, rgb]) => {
            host.customBiomeColors[key] = rgb;
        });
    }

    /**
     * Nothing drawn on the host's map: no faults, rivers, pins, routes, layer sets, run, masks,
     * labels or decorations, and nothing inherited from a parent map.
     * @param {object} host
     */
    static blankMap(host) {
        // A new map is built with the current terrain rules, so there is nothing to update
        host.terrainUpgrade = null;
        host.legacyRootSize = null;
        // A new map is not a crop of anything, so has no parent ground beyond its edges, nor a
        // parent's run
        host.upwindMargin = null;
        host.parentRun = null;
        host.infillPending = false;
        host.infillInputs = null;
        host.riverRoutesLaid = false;
        host.shoresPlaced = false;

        host.manualRivers = [];
        host.tectonicFaults = [];
        host.mapPins = [];
        host.mapRoutes = [];
        host.layerSets = [];
        host.modelRun = null;
        host.landMasks = [];
        host.mapLabels = [];
        host.mapDecorations = [];
    }

    /**
     * The reference image as a map saves it, with its place, size and opacity; null when the map
     * has none.
     * @param {object} uiState
     * @returns {object|null}
     */
    static referenceOf(uiState) {
        const { referenceImage, referenceAlpha, referenceScale, referenceX, referenceY } = uiState;
        return referenceImage ? { src: referenceImage, alpha: referenceAlpha, scale: referenceScale, x: referenceX, y: referenceY } : null;
    }

    /**
     * A saved reference image into the host's settings, its source made safe; the defaults when
     * there is none.
     * @param {object} host
     * @param {object|null} reference
     */
    static readReference(host, reference) {
        const defaults = MapStateManager.buildDefaultUiState(host.mapWidth, host.mapHeight);
        const src = reference?.src ? Sanitize.imageSource(reference.src, { remote: true }) : null;
        host.uiState.referenceImage = src ?? "";
        host.uiState.referenceAlpha = Number.isFinite(reference?.alpha) && src ? reference.alpha : defaults.referenceAlpha;
        host.uiState.referenceScale = Number.isFinite(reference?.scale) && src ? reference.scale : defaults.referenceScale;
        host.uiState.referenceX = Number.isFinite(reference?.x) && src ? reference.x : defaults.referenceX;
        host.uiState.referenceY = Number.isFinite(reference?.y) && src ? reference.y : defaults.referenceY;
    }

    /** The scale bar brought back onto the map where it was left off it (see MapScale.scaleBarOnMap). */
    static keepScaleBarOnMap(host) {
        const { x, y } = scaleBarOnMap(host.uiState, host.mapWidth, host.mapHeight);
        host.uiState.cartographyScaleX = x;
        host.uiState.cartographyScaleY = y;
    }
}
