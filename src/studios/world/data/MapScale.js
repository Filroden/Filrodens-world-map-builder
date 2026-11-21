/**
 * The map's scale as the World studio reads it from its state: kilometres per map pixel, and the
 * scale bar's tick and place. The unit's name and how distances are written are the kernel's (MapUnit); the
 * scale itself comes from the map's latitudes and world (see Schema.effectiveKmPerPx).
 */
import { cleanUnit, worldScaleTick } from "../../../kernel/data/MapUnit.js";
import { effectiveKmPerPx } from "../mesh/Schema.js";

/** The scale bar's interval when a map has none (as the bar has always drawn). */
const DEFAULT_INTERVAL_PX = 100;
/** How far the scale bar keeps from the map's edges, in pixels: room for its labels above it. */
const SCALE_BAR_MARGIN_PX = 50;

/**
 * Kilometres per map pixel for the studio's current state (its latitudes and world), as the
 * mesh and the generator use them.
 * @param {object} state - The studio's uiState (latTop, latBottom, world).
 * @param {number} mapHeight
 * @returns {number}
 */
export function kmPerPxOf(state, mapHeight) {
    return effectiveKmPerPx({ mapHeight, params: { latTop: state?.latTop, latBottom: state?.latBottom }, world: state?.world ?? null });
}

/**
 * The scale bar's tick as it is drawn: from the world's scale when the bar matches it, otherwise
 * the bar's own interval and value.
 * @param {object} state - The studio's uiState.
 * @param {number} mapHeight
 * @returns {{value: number, intervalPx: number}}
 */
export function scaleBarTick(state, mapHeight) {
    const intervalPx = state.cartographyScaleInterval || DEFAULT_INTERVAL_PX;
    if (state.cartographyScaleMatchWorld === true) return worldScaleTick(kmPerPxOf(state, mapHeight), intervalPx);
    return { value: state.cartographyScaleValue || 1, intervalPx };
}

/**
 * Where the scale bar can stand so that all of it is on the map: its position as set, moved in
 * just far enough that the bar and its labels clear the edges by MARGIN_PX. A bar wider than the
 * map starts at the margin.
 * @param {object} state - The studio's uiState (the bar's position, interval and ticks).
 * @param {number} mapWidth
 * @param {number} mapHeight
 * @returns {{x: number, y: number}}
 */
export function scaleBarOnMap(state, mapWidth, mapHeight) {
    const margin = SCALE_BAR_MARGIN_PX;
    const width = scaleBarTick(state, mapHeight).intervalPx * (state.cartographyScaleMajorTicks || 4);
    const x = Number.isFinite(state.cartographyScaleX) ? state.cartographyScaleX : margin;
    const y = Number.isFinite(state.cartographyScaleY) ? state.cartographyScaleY : mapHeight - margin;
    return {
        x: Math.max(margin, Math.min(x, mapWidth - margin - width)),
        y: Math.max(margin, Math.min(y, mapHeight - margin)),
    };
}

/** Significant figures kept in a scene's grid distance: enough for the ruler, without a long tail of digits. */
const GRID_DISTANCE_FIGURES = 3;

/**
 * The ground one grid cell covers, as Foundry's grid distance and units: the cell's width at the
 * map's scale, to three significant figures, in the map's unit. A regional map keeps its parent's
 * grid size in pixels, so its cells measure less. The same at any export scale: a cell is the same
 * piece of the map.
 * @param {object} state - The studio's uiState (latitudes, world, map unit).
 * @param {number} mapHeight
 * @param {number} gridSize - The grid's size in map pixels.
 * @returns {{distance: number, units: string}|{}} Nothing when the scale cannot be worked out.
 */
export function gridDistanceOf(state, mapHeight, gridSize) {
    const distance = gridSize * kmPerPxOf(state, mapHeight);
    if (!(distance > 0) || !Number.isFinite(distance)) return {};
    return { distance: Number(distance.toPrecision(GRID_DISTANCE_FIGURES)), units: cleanUnit(state?.mapUnit) };
}
