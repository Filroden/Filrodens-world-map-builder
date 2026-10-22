import { FILRODENSWMB } from "../config.js";
import { platform } from "../platform/index.js";
import { DetailLevel } from "./DetailLevel.js";
import { Regeneration } from "./Regeneration.js";

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

/** A route's transport and class, by name. */
const TRANSPORTS = Object.freeze({ road: "FILRODENSWMB.UI.TransportRoad", river: "FILRODENSWMB.UI.TransportRiver", sea: "FILRODENSWMB.UI.TransportSea" });
const CLASSES = Object.freeze({ trunk: "FILRODENSWMB.UI.RouteClassTrunk", main: "FILRODENSWMB.UI.RouteClassMain", minor: "FILRODENSWMB.UI.RouteClassMinor" });

/** The least share of a culture mix shown (smaller shares are left out of the line). */
const MIX_MIN_SHARE = 0.05;

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
            ["FILRODENSWMB.UI.GeneratedCultures", this.#cultures(app, generated)],
            ["FILRODENSWMB.UI.GeneratedFormerly", this.#formerly(generated)],
            ["FILRODENSWMB.UI.GeneratedHistory", this.#history(generated)],
            ["FILRODENSWMB.UI.GeneratedFormerCapital", Number.isInteger(generated.formerCapital) ? platform.i18n.format("FILRODENSWMB.UI.GeneratedInAge", { age: generated.formerCapital }) : null],
            ["FILRODENSWMB.UI.GeneratedShownFrom", this.#levelName(DetailLevel.ofPin(app, pin))],
            ["FILRODENSWMB.UI.GeneratedNextRun", this.#fate(pin)],
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
            ["FILRODENSWMB.UI.GeneratedTitle", place ? this.#titleOf(region, place) : null],
            ["FILRODENSWMB.UI.GeneratedRank", RANKS[generated.tier] ? platform.i18n.localize(RANKS[generated.tier]) : null],
            ["FILRODENSWMB.UI.GeneratedPopulation", this.#count(generated.population)],
            [generated.mix ? "FILRODENSWMB.UI.GeneratedCultures" : "FILRODENSWMB.UI.GeneratedCulture", this.#cultures(app, generated)],
            ["FILRODENSWMB.UI.GeneratedDuchies", place?.depth === REALMS ? this.#count(below[0]) : null],
            ["FILRODENSWMB.UI.GeneratedCounties", place ? this.#count(below[COUNTIES - place.depth - 1]) : null],
            ["FILRODENSWMB.UI.GeneratedShownFrom", place ? this.#levelName(DetailLevel.ofLevel(place.set, place.level)) : null],
            ["FILRODENSWMB.UI.GeneratedNextRun", this.#fate(region, place)],
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

    /**
     * A generated route's rows, or null for a route no run made: its kind and class, and what
     * Generate again does with it.
     * @param {object} app
     * @param {object} route
     * @returns {{label: string, value: string}[]|null}
     */
    static forRoute(app, route) {
        if (!route.generated) return null;
        return this.#rows([
            ["FILRODENSWMB.UI.GeneratedRouteKind", route.generated.oldRoad ? platform.i18n.localize("FILRODENSWMB.UI.RouteStyleOldRoad") : TRANSPORTS[route.transport] ? platform.i18n.localize(TRANSPORTS[route.transport]) : null],
            ["FILRODENSWMB.UI.GeneratedRouteClass", CLASSES[route.class] ? platform.i18n.localize(CLASSES[route.class]) : null],
            ["FILRODENSWMB.UI.GeneratedNextRun", this.#fate(route)],
        ]);
    }

    /** What Generate again does with an item: keeps it (edited, locked, or with its realm) or replaces it. */
    static #fate(item, place = null) {
        if (item.generated.locked) return platform.i18n.localize("FILRODENSWMB.UI.GeneratedKeptLocked");
        if (item.generated.edited) return platform.i18n.localize("FILRODENSWMB.UI.GeneratedKeptEdited");
        if (place && Regeneration.keptKeys(place.set)[place.depth].has(item.key)) return platform.i18n.localize("FILRODENSWMB.UI.GeneratedKeptRealm");
        return platform.i18n.localize("FILRODENSWMB.UI.GeneratedReplaced");
    }

    /**
     * A region's full title, from its level's title template ("Kingdom of {name}"): the name alone
     * is drawn, its level's look showing its rank. An independent duchy takes the duchy title.
     */
    static #titleOf(region, place) {
        const independent = place.depth === REALMS && region.generated?.tier === "independent";
        const template = (independent ? place.set.levels[REALMS + 1]?.titleTemplate : null) ?? place.level.titleTemplate;
        return template?.includes("{name}") ? template.replaceAll("{name}", region.name) : null;
    }

    /**
     * A culture's name as generated details name it: by the map culture's id (its name now, or as
     * the run that made the item knew it, if it has since been deleted), or by an older run's index
     * into its own cultures. Null for the default culture of a run with no cultures.
     * @param {object} app
     * @param {string|number|null} ref
     * @returns {string|null}
     */
    static cultureName(app, ref) {
        const known = app.modelRun?.cultures ?? [];
        if (typeof ref === "string") return (app.uiState?.cultures ?? []).find((culture) => culture.id === ref)?.name || known.find((culture) => culture.id === ref)?.name || null;
        if (Number.isInteger(ref)) return known[ref]?.name || null;
        return null;
    }

    /**
     * An item's cultures as one line: its mix ("Hillfolk 70%, Lowlanders 30%", shares under
     * MIX_MIN_SHARE left out), or its one culture's name; null with no cultures.
     */
    static #cultures(app, generated) {
        if (Array.isArray(generated.mix) && generated.mix.length) {
            const parts = generated.mix
                .filter((entry) => entry.share >= MIX_MIN_SHARE)
                .map((entry) => ({ name: this.cultureName(app, entry.culture), share: Math.round(entry.share * 100) }))
                .filter((entry) => entry.name)
                .map((entry) => platform.i18n.format("FILRODENSWMB.UI.GeneratedCultureShare", { name: entry.name, share: entry.share }));
            if (parts.length) return parts.join(", ");
        }
        return this.cultureName(app, generated.culture);
    }

    /** What a ruin was in the age before the present ("Large town in age 2, 6,500 people"); null for anything else. */
    static #formerly(generated) {
        if (generated.kind !== "ruin" || !Number.isInteger(generated.formerTier)) return null;
        const what = platform.i18n.format("FILRODENSWMB.UI.GeneratedInAgeOf", { what: this.#sizeName(generated.formerTier), age: generated.formerAge });
        const people = this.#count(generated.formerPopulation);
        return people ? platform.i18n.format("FILRODENSWMB.UI.GeneratedFormerlyPeople", { what, people }) : what;
    }

    /**
     * A place's ages as one line, from its tier in each age (-1 for none): runs of the same tier
     * ("Town in ages 1–2", "City since age 3"), a ruin's end ("Ruin since age 3"), joined.
     * Null with one age.
     */
    static #history(generated) {
        const ages = generated.ages;
        if (!Array.isArray(ages) || ages.length < 2) return null;
        const last = ages.length - 1;
        const parts = [];
        for (let start = 0; start <= last;) {
            let end = start;
            while (end < last && ages[end + 1] === ages[start]) end++;
            const tier = ages[start];
            const reachesNow = end === last;
            let what = null;
            if (tier >= 0) what = this.#sizeName(tier);
            else if (reachesNow && start > 0 && generated.kind === "ruin") what = platform.i18n.localize("FILRODENSWMB.UI.PinStyleRuin");
            if (what) {
                const since = reachesNow && (start > 0 || end > start);
                const key = since ? "FILRODENSWMB.UI.GeneratedSinceAge" : start === end ? "FILRODENSWMB.UI.GeneratedInAgeOf" : "FILRODENSWMB.UI.GeneratedInAgesOf";
                parts.push(platform.i18n.format(key, { what, age: start + 1, from: start + 1, to: end + 1 }));
            }
            start = end + 1;
        }
        return parts.length ? parts.join(" · ") : null;
    }

    /** A settlement size's name: 0 city, 1 large town, 2 town. */
    static #sizeName(tier) {
        return platform.i18n.localize(["FILRODENSWMB.UI.PinStyleCity", "FILRODENSWMB.UI.PinStyleLargeTown", "FILRODENSWMB.UI.PinStyleTown"][tier] ?? "FILRODENSWMB.UI.PinStyleTown");
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
