import { FILRODENSWMB } from "../config.js";
import { platform } from "../platform/index.js";
import { DetailLevel } from "./DetailLevel.js";

/**
 * What a run of Generate recorded about a place or region (its `generated` details), as the rows
 * of the inspector's read-only Generated section and of a scene export's journal page. The
 * figures stay in `generated`; the description is the user's own.
 */

/** A realm's rank, by the generator's kind of realm. */
const RANKS = Object.freeze({ kingdom: "FILRODENSWMB.UI.GeneratedRankKingdom", independent: "FILRODENSWMB.UI.GeneratedRankIndependent" });

/** The depth of the realms and counties in a generated Political set. */
const REALMS = 0;
const COUNTIES = 2;

/** Each settlement tier's name, from its default pin style. */
const TIER_NAMES = new Map(FILRODENSWMB.PINS.DEFAULT_STYLES.map((style) => [style.tier, style.name]));

export class GeneratedDetails {
    /**
     * A generated pin's rows, or null for a pin no run made.
     * @param {object} app
     * @param {object} pin
     * @returns {{label: string, value: string}[]|null}
     */
    static forPin(app, pin) {
        const generated = pin.generated;
        if (!generated) return null;
        const tierName = TIER_NAMES.get(generated.tier);
        return this.#rows([
            ["FILRODENSWMB.UI.GeneratedPlace", tierName ? platform.i18n.localize(tierName) : null],
            ["FILRODENSWMB.UI.GeneratedPopulation", this.#count(generated.population)],
            ["FILRODENSWMB.UI.GeneratedShownFrom", this.#levelName(DetailLevel.ofPin(app, pin))],
        ]);
    }

    /**
     * A generated region's rows, or null for a region no run made: its rank (realms), population,
     * the duchies and counties beneath it, and the detail level it is shown from.
     * @param {object} app
     * @param {object} region
     * @returns {{label: string, value: string}[]|null}
     */
    static forRegion(app, region) {
        const generated = region.generated;
        if (!generated) return null;
        const place = this.#placeOf(app, region);
        const below = place ? this.#beneath(place.set, place.depth, region.key) : [];
        return this.#rows([
            ["FILRODENSWMB.UI.GeneratedRank", RANKS[generated.tier] ? platform.i18n.localize(RANKS[generated.tier]) : null],
            ["FILRODENSWMB.UI.GeneratedPopulation", this.#count(generated.population)],
            ["FILRODENSWMB.UI.GeneratedDuchies", place?.depth === REALMS ? this.#count(below[0]) : null],
            ["FILRODENSWMB.UI.GeneratedCounties", place ? this.#count(below[COUNTIES - place.depth - 1]) : null],
            ["FILRODENSWMB.UI.GeneratedShownFrom", place ? this.#levelName(DetailLevel.ofLevel(place.set, place.level)) : null],
        ]);
    }

    /**
     * The pins, regions and routes a scene export gives journal pages, each with its page text.
     * A generated item has a page only while the map's detail level shows it (a run makes thousands
     * of places); its page holds its description, then its generated figures as plain lines. Others
     * have one as before: when they have a name or a description.
     * @param {object} app
     * @returns {{pins: {item: object, text: string}[], regions: {item: object, text: string}[], routes: {item: object, text: string}[]}}
     */
    static journalPages(app) {
        const page = (item, rows) => ({ item, text: this.#pageText(item.description, rows) });
        const wanted = (item) => !!(item.name || item.description);
        const pins = (app.mapPins ?? []).filter((pin) => wanted(pin) && (!pin.generated || DetailLevel.shows(app, "pin", pin))).map((pin) => page(pin, this.forPin(app, pin)));
        const regions = [];
        for (const set of app.layerSets ?? []) {
            for (const level of set.levels) {
                const shown = DetailLevel.shows(app, "region", { set, level });
                for (const region of level.regions) if (wanted(region) && (!region.generated || shown)) regions.push(page(region, this.forRegion(app, region)));
            }
        }
        const routes = (app.mapRoutes ?? []).filter(wanted).map((route) => page(route, null));
        return { pins, regions, routes };
    }

    /** A page's plain text: the description, then a line for each generated figure. */
    static #pageText(description, rows) {
        const figures = (rows ?? []).map((row) => `${row.label}: ${row.value}`).join("\n");
        return [description?.trim(), figures].filter(Boolean).join("\n\n");
    }

    /** The rows whose value is known, localised. */
    static #rows(entries) {
        return entries.filter(([, value]) => value !== null && value !== undefined).map(([label, value]) => ({ label: platform.i18n.localize(label), value }));
    }

    static #count(value) {
        return Number.isFinite(value) ? Math.round(value).toLocaleString(platform.i18n.lang) : null;
    }

    static #levelName(level) {
        const choice = FILRODENSWMB.DETAIL.LEVELS.find((entry) => entry.value === level);
        return choice ? platform.i18n.localize(choice.label) : null;
    }

    /** The set and level holding a region, and the level's depth in the set. */
    static #placeOf(app, region) {
        for (const set of app.layerSets ?? []) {
            const depth = set.levels.findIndex((level) => level.regions.includes(region));
            if (depth !== -1) return { set, level: set.levels[depth], depth };
        }
        return null;
    }

    /**
     * How many regions lie beneath a region on each level below its own, in a generated set whose
     * levels nest one inside the next.
     * @returns {number[]} One count per level below.
     */
    static #beneath(set, depth, key) {
        const counts = [];
        let keys = new Set([key]);
        for (let below = depth + 1; below < set.levels.length; below++) {
            const children = set.levels[below].regions.filter((child) => keys.has(child.parentKey));
            counts.push(children.length);
            keys = new Set(children.map((child) => child.key));
        }
        return counts;
    }
}
