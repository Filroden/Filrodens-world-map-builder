import { FILRODENSWMB } from "../config.js";
import { MapStateManager } from "./MapStateManager.js";

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
        this.#applyScaleToState(state, cropBox, zoomScale, targetWidth, targetHeight, app.mapHeight);

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
        state.windDistance = (state.windDistance || FILRODENSWMB.CLIMATE.WIND_DISTANCE) * zoomScale;

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
