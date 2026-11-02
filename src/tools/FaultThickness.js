import { FILRODENSWMB } from "../config.js";

/**
 * The range Fault line thickness offers, set by the map's width: up to MAX_SHARE of it, with
 * DEFAULT_SHARE as a new fault's thickness (see FILRODENSWMB.TECTONICS.THICKNESS).
 *
 * A fixed range did not fit every map: its top end (1000 pixels in the inspector) was half of a
 * 2000 pixel map, wide enough for a hotspot chain to build a continent, and its default too
 * narrow for a hotspot's islands. A fault already thicker than the range (drawn before it, or
 * widened by a regional map's zoom) keeps its thickness: the range stretches to hold it, so
 * editing anything else about the fault never narrows it.
 */
export class FaultThickness {
    /**
     * @param {number} mapWidth - The map's width in pixels.
     * @param {number} [current] - A thickness the range must hold (the fault's own).
     * @returns {{min: number, max: number, step: number, default: number}}
     */
    static limits(mapWidth, current = 0) {
        const settings = FILRODENSWMB.TECTONICS.THICKNESS;
        const round = (value) => Math.max(settings.MIN, Math.round(value / settings.STEP) * settings.STEP);
        const width = Number(mapWidth) || FILRODENSWMB.LIMITS.BASELINE_DIMENSION;
        return {
            min: settings.MIN,
            max: Math.max(round(width * settings.MAX_SHARE), Number(current) || 0),
            step: settings.STEP,
            default: round(width * settings.DEFAULT_SHARE),
        };
    }
}
