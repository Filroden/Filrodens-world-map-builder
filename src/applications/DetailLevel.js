import { FILRODENSWMB } from "../config.js";
import { ContentRows } from "./ContentRows.js";
import { PinStyles } from "./PinStyles.js";

/**
 * The map's detail level (the map controls' Detail menu): Everything, Regional, Province or World.
 * A level shows every pin and region level whose own detail level is at or below it, and what it
 * hides is neither drawn, picked nor exported. Routes are shown at every level: a road leading
 * beyond what is shown invites a closer look. Labels follow their pin or region; route and
 * standalone labels are always shown. A pin's name has a level of its own, never below the pin's
 * (see ofName), so a tier's places can show before their names do.
 *
 * An item's detail level:
 * - a pin: its pin style's; a pin whose look was edited away from its style falls back to its
 *   generated tier's default style; any other pin is always shown;
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

    /**
     * The detail level from which a pin's name is drawn: its style's name level (`label.detailLevel`;
     * a style saved before it existed takes its tier's default, and one with no tier its own
     * level); a pin off its style, its generated tier's default; any other pin's name shows with
     * the pin. Never below the pin's own level.
     */
    static ofName(app, pin) {
        const own = this.ofPin(app, pin);
        const style = PinStyles.find(app, pin.pinStyle);
        const named = style ? PinStyles.nameLevel(style) : PinStyles.tierNameLevel(pin.generated?.tier);
        return Number.isFinite(named) ? Math.max(own, named) : own;
    }

    /** A region level's detail level, from its place in its set. */
    static ofLevel(set, level) {
        if (set?.kind !== "political") return ALWAYS;
        return Math.max(ALWAYS, set.levels.indexOf(level));
    }

    /**
     * What the map's detail level shows: the pins, the routes (all of them), a test for a pin's
     * name, and a test for a set's level, which also leaves out the levels turned off in the
     * Regions menu (see ContentRows). Everything returns the arrays it was given and names every pin.
     * @param {object} app
     * @returns {{pins: object[], routes: object[], showsName: function(object): boolean, showsLevel: function(object, object): boolean}}
     */
    static shown(app) {
        const level = this.current(app);
        const pins = app.mapPins ?? [];
        const routes = app.mapRoutes ?? [];
        const levelOn = ContentRows.levelShown(app);
        if (level === DETAIL.EVERYTHING) return { pins, routes, showsName: () => true, showsLevel: (_set, regionLevel) => levelOn(regionLevel) };
        return {
            pins: pins.filter((pin) => this.ofPin(app, pin) <= level),
            routes,
            showsName: (pin) => this.ofName(app, pin) <= level,
            showsLevel: (set, regionLevel) => levelOn(regionLevel) && this.ofLevel(set, regionLevel) <= level,
        };
    }

    /**
     * Whether a pin, route or region is shown at the map's detail level (a route always is), and
     * a region's level is on in the Regions menu.
     * @param {object} app
     * @param {string} type - "pin", "route" or "region".
     * @param {object} item - The pin or route; for a region, its level and set ({ set, level }).
     */
    static shows(app, type, item) {
        if (type === "region" && !ContentRows.levelShown(app)(item.level)) return false;
        const level = this.current(app);
        if (level === DETAIL.EVERYTHING) return true;
        if (type === "pin") return this.ofPin(app, item) <= level;
        if (type === "route") return true;
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
