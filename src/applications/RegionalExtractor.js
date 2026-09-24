import { FILRODENSWMB } from "../config.js";
import { MapStateManager } from "./MapStateManager.js";
import { TerrainVersion } from "../tools/TerrainVersion.js";

export class RegionalExtractor {
    /**
     * Orchestrates the mathematical scaling and data translation for a regional crop.
     * Returns a perfectly formatted payload ready to be saved to the database.
     */
    static createPayload(app, cropBox) {
        const state = foundry.utils.deepClone(app.uiState);

        // 1. Calculate Grid Snapping & Scale Factors
        const baseTargetWidth = state.regionalTargetWidth;
        const tempZoomScale = baseTargetWidth / cropBox.width;

        const targetGridSize = Math.max(10, Math.round(state.gridSize * tempZoomScale));
        const targetWidth = Math.max(targetGridSize, Math.round(baseTargetWidth / targetGridSize) * targetGridSize);

        const zoomScale = targetWidth / cropBox.width;
        const rawHeight = cropBox.height * zoomScale;
        const targetHeight = Math.max(targetGridSize, Math.round(rawHeight / targetGridSize) * targetGridSize);

        // 2. Mutate Map State Properties
        // A legacy regional parent does not record the size of the map at the top of its chain;
        // app.legacyRootSize holds it if it was found when the parent was loaded.
        const rootSize = app.legacyRootSize ?? null;
        const world = TerrainVersion.deriveChildWorld(state, cropBox, zoomScale, rootSize);
        const windDistance = TerrainVersion.getRegionalWindDistance(state, cropBox, rootSize);
        this.#applyScaleToState(state, cropBox, zoomScale, targetWidth, targetHeight, app.mapHeight);

        // A regional map is always built with the current terrain rules, whatever revision its
        // parent was made with, so it gets the corrected wind distance and the extra detail.
        // Both the world description and the wind distance are worked out from the parent's
        // unscaled state, since #applyScaleToState overwrites the size they are derived from.
        state.terrainVersion = FILRODENSWMB.TERRAIN_VERSION.CURRENT;
        state.world = world;
        state.windDistance = windDistance;

        // 3. Derive Map Parameters
        const { currentSeed, params: newParams } = MapStateManager.getDerivedMapParameters(state, app.customBiomeColors);

        // 4. Translate Spatial Vector Arrays
        const translate = (list) => this.#translateVectorList(list, cropBox, zoomScale, targetWidth, targetHeight);

        const newRegions = app.regionLayers
            .map((layer) => {
                const translatedLayer = foundry.utils.deepClone(layer);
                translatedLayer.regions = translate(layer.regions);
                return translatedLayer;
            })
            .filter((layer) => layer.regions.length > 0);

        // 5. Pack and Return the Payload
        return {
            seed: currentSeed,
            generationEngine: state.generationEngine,
            terrainVersion: state.terrainVersion,
            world: state.world,
            springsBaked: true,
            mapWidth: targetWidth,
            mapHeight: targetHeight,
            gridType: state.gridType,
            gridSize: state.gridSize,
            params: newParams,
            customBiomes: state.customBiomes,
            customRouteStyles: state.customRouteStyles,
            customLabelStyles: state.customLabelStyles,
            history: this.#translateHistory(app.brushEngine.history, cropBox, zoomScale, targetWidth, targetHeight),
            tectonicFaults: translate(app.tectonicFaults),
            manualRivers: translate(app.manualRivers),
            mapPins: translate(app.mapPins),
            mapRoutes: translate(app.mapRoutes),
            regionLayers: newRegions,
            mapLabels: translate(app.mapLabels),
            landMasks: state.generationEngine === "guided" ? this.#translateLandMasks(app.landMasks ?? [], cropBox, zoomScale) : [],
            mapDecorations: translate(app.mapDecorations),
            parentId: app.currentSaveId,
        };
    }

    static #applyScaleToState(state, cropBox, zoomScale, targetWidth, targetHeight, originalMapHeight) {
        state.mapWidth = targetWidth;
        state.mapHeight = targetHeight;

        state["noise.offsetX"] = (state["noise.offsetX"] + cropBox.x) * zoomScale;
        state["noise.offsetY"] = (state["noise.offsetY"] + cropBox.y) * zoomScale;
        state["noise.moistureOffset"] = (state["noise.moistureOffset"] || FILRODENSWMB.NOISE.OFFSET_MOISTURE) * zoomScale;
        state["noise.tempOffset"] = (state["noise.tempOffset"] || FILRODENSWMB.NOISE.OFFSET_TEMP) * zoomScale;
        // The wind distance is not scaled here. It is set by createPayload from
        // TerrainVersion.getRegionalWindDistance, because the right value depends on the crop's
        // shape rather than its zoom (getWindDistance already scales it by the map's size).

        state["noise.elevation.scale"] *= zoomScale;
        state["noise.moisture.scale"] *= zoomScale;
        state["noise.temperature.scale"] = (state["noise.temperature.scale"] || FILRODENSWMB.NOISE.TEMPERATURE.SCALE) * zoomScale;

        const originalLatTop = state.latTop;
        const latRange = Math.abs(originalLatTop - state.latBottom);
        state.latTop = originalLatTop - (cropBox.y / originalMapHeight) * latRange;
        state.latBottom = originalLatTop - ((cropBox.y + cropBox.height) / originalMapHeight) * latRange;
        state.gridSize = Math.max(10, Math.round(state.gridSize * zoomScale));

        if (state.cartographyScaleEnable && state.cartographyScaleX !== undefined) {
            state.cartographyScaleX = (state.cartographyScaleX - cropBox.x) * zoomScale;
            state.cartographyScaleY = (state.cartographyScaleY - cropBox.y) * zoomScale;
            state.cartographyScaleInterval = Math.round(state.cartographyScaleInterval * zoomScale);

            state.cartographyScaleX = Math.max(FILRODENSWMB.UI.REGIONAL_CROP.PADDING, Math.min(state.cartographyScaleX, targetWidth - FILRODENSWMB.UI.REGIONAL_CROP.PADDING));
            state.cartographyScaleY = Math.max(FILRODENSWMB.UI.REGIONAL_CROP.PADDING, Math.min(state.cartographyScaleY, targetHeight - FILRODENSWMB.UI.REGIONAL_CROP.PADDING));
        }
    }

    static #translateHistory(history, cropBox, zoomScale, targetWidth, targetHeight) {
        const newHistory = [];
        for (const stroke of history) {
            const translatedStroke = foundry.utils.deepClone(stroke);
            translatedStroke.size *= zoomScale;
            let isVisible = false;

            for (const pt of translatedStroke.points) {
                pt.x = (pt.x - cropBox.x) * zoomScale;
                pt.y = (pt.y - cropBox.y) * zoomScale;

                if (pt.x + translatedStroke.size >= 0 && pt.x - translatedStroke.size <= targetWidth && pt.y + translatedStroke.size >= 0 && pt.y - translatedStroke.size <= targetHeight) {
                    isVisible = true;
                }
            }
            if (isVisible) newHistory.push(translatedStroke);
        }
        return newHistory;
    }

    /**
     * Converts every land mask into the regional map's pixels, keeping all of them.
     *
     * Unlike other vector features, a land mask cannot be dropped just because none of its points
     * falls inside the crop: a crop taken from the middle of a large continent has no mask points
     * inside it at all, yet the continent's mask is exactly what makes it land. Masks wholly
     * outside the crop still shape it too, since guided terrain is shaped by coastlines up to
     * Continent Scale away. Keeping them all is what lets the regional map build the same
     * coastline its parent did (see ProceduralEngine.generateGuidedTopography); the terrain
     * pass works out which ones are near enough to matter.
     */
    static #translateLandMasks(landMasks, cropBox, zoomScale) {
        return landMasks.map((mask) => {
            const translated = foundry.utils.deepClone(mask);
            translated.points = translated.points.map((point) => ({
                x: (point.x - cropBox.x) * zoomScale,
                y: (point.y - cropBox.y) * zoomScale,
            }));
            return translated;
        });
    }

    static #translateVectorList(list, cropBox, zoomScale, targetWidth, targetHeight) {
        const newList = [];
        const buffer = FILRODENSWMB.LIMITS.OVERFLOW_BUFFER;

        for (const item of list) {
            const translated = foundry.utils.deepClone(item);
            let isVisible = false;

            if (translated.label?.x !== undefined) {
                translated.label.x = (translated.label.x - cropBox.x) * zoomScale;
                translated.label.y = (translated.label.y - cropBox.y) * zoomScale;
            }

            if (translated.x !== undefined && translated.y !== undefined) {
                translated.x = (translated.x - cropBox.x) * zoomScale;
                translated.y = (translated.y - cropBox.y) * zoomScale;

                if (translated.x >= -buffer && translated.x <= targetWidth + buffer && translated.y >= -buffer && translated.y <= targetHeight + buffer) {
                    isVisible = true;
                }
            } else if (translated.points) {
                for (const pt of translated.points) {
                    pt.x = (pt.x - cropBox.x) * zoomScale;
                    pt.y = (pt.y - cropBox.y) * zoomScale;

                    if (pt.x >= 0 && pt.x <= targetWidth && pt.y >= 0 && pt.y <= targetHeight) {
                        isVisible = true;
                    }
                }
            }

            if (isVisible) newList.push(translated);
        }
        return newList;
    }
}
