import { FILRODENSWMB } from "../config.js";
import { PinStyles } from "./PinStyles.js";

/**
 * The map's detail level (the map controls' Detail menu): Everything, Regional, Province or World.
 * A level shows every pin, route and region level whose own detail level is at or below it, and
 * what it hides is neither drawn, picked nor exported. Labels follow their pin, route or region;
 * standalone labels are always shown.
 *
 * An item's detail level:
 * - a pin: its pin style's; a pin whose look was edited away from its style falls back to its
 *   generated tier's default style; any other pin is always shown;
 * - a route: its class (DETAIL.ROUTE_CLASSES: trunk and main routes from World, minor routes from
 *   Province); a route without one is always shown;
 * - a region level: its place in a Political set (Realms, Duchies, Counties); levels of other sets
 *   are always shown.
 *
 * The level is saved with the map (uiState.detailLevel); a map without one shows everything.
 */

const { DETAIL } = FILRODENSWMB;
const ALWAYS = 0;

/** Each tier's default detail level, for a generated pin no longer on its style. */
const TIER_LEVELS = new Map(FILRODENSWMB.PINS.DEFAULT_STYLES.map((style) => [style.tier, style.detailLevel]));

/** The detail levels a map can be set to, most detailed first. */
const VALUES = DETAIL.LEVELS.map((level) => level.value);

export class DetailLevel {
    /** A saved value made valid: one of the levels, else Everything. */
    static valid(value) {
        return VALUES.includes(value) ? value : DETAIL.EVERYTHING;
    }

    /** The map's detail level. */
    static current(app) {
        return this.valid(app.uiState?.detailLevel);
    }

    /** A pin's detail level. */
    static ofPin(app, pin) {
        const styled = PinStyles.find(app, pin.pinStyle)?.detailLevel;
        if (Number.isFinite(styled)) return styled;
        return TIER_LEVELS.get(pin.generated?.tier) ?? ALWAYS;
    }

    /** A route's detail level. */
    static ofRoute(route) {
        return DETAIL.ROUTE_CLASSES[route.class] ?? ALWAYS;
    }

    /** A region level's detail level, from its place in its set. */
    static ofLevel(set, level) {
        if (set?.kind !== "political") return ALWAYS;
        return Math.max(ALWAYS, set.levels.indexOf(level));
    }

    /**
     * What the map's detail level shows: the pins and routes, and a test for a set's level.
     * Everything returns the arrays it was given.
     * @param {object} app
     * @returns {{pins: object[], routes: object[], showsLevel: function(object, object): boolean}}
     */
    static shown(app) {
        const level = this.current(app);
        const pins = app.mapPins ?? [];
        const routes = app.mapRoutes ?? [];
        if (level === DETAIL.EVERYTHING) return { pins, routes, showsLevel: () => true };
        return {
            pins: pins.filter((pin) => this.ofPin(app, pin) <= level),
            routes: routes.filter((route) => this.ofRoute(route) <= level),
            showsLevel: (set, regionLevel) => this.ofLevel(set, regionLevel) <= level,
        };
    }

    /**
     * Whether a pin, route or region is shown at the map's detail level.
     * @param {object} app
     * @param {string} type - "pin", "route" or "region".
     * @param {object} item - The pin or route; for a region, its level and set ({ set, level }).
     */
    static shows(app, type, item) {
        const level = this.current(app);
        if (level === DETAIL.EVERYTHING) return true;
        if (type === "pin") return this.ofPin(app, item) <= level;
        if (type === "route") return this.ofRoute(item) <= level;
        return this.ofLevel(item.set, item.level) <= level;
    }

    /**
     * The level a run starts the map at: the most detailed whose places are still
     * DETAIL.MIN_SPACING_PX map pixels apart at the map's scale, from each tier's typical spacing.
     * With every tier far enough apart, everything is shown.
     * @param {number} kmPerPx - The map's effective kilometres per pixel.
     * @returns {number}
     */
    static forScale(kmPerPx) {
        if (!(kmPerPx > 0)) return DETAIL.EVERYTHING;
        const tiers = FILRODENSWMB.GENERATOR.TOWNS.TIERS;
        let shown = ALWAYS;
        for (let tier = 1; tier < tiers.length; tier++) {
            if (tiers[tier].spacingKm / kmPerPx < DETAIL.MIN_SPACING_PX) return shown;
            shown = tier;
        }
        return DETAIL.EVERYTHING;
    }

    /** The Detail menu's rows, with the chosen one marked. */
    static choices(app) {
        const level = this.current(app);
        return DETAIL.LEVELS.map((choice) => ({ ...choice, selected: choice.value === level }));
    }
}
