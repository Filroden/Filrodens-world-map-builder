import { FILRODENSWMB } from "../config.js";
import { panelSettings } from "../generator/GeneratorSettings.js";
import { nameBaseNames } from "../generator/Names.js";
import { platform } from "../platform/index.js";
import { Generation } from "./Generation.js";

/**
 * The Generate tool's panel (templates/tools-generate.hbs): the settings a run is made with, kept
 * with the map in uiState.generatorSettings (see GeneratorSettings.panelSettings), what a run is
 * expected to take, whether the last run is out of date, notices for maps where the result is
 * thin or inherited, and what the last run made.
 *
 * The panel's fields are named "generator.<path>" ("generator.world.density",
 * "generator.output.places.town"), so one handler writes them all (see handleInput).
 */

/** The prefix of the panel's field names. */
export const FIELD_PREFIX = "generator.";

/** The world sliders, in order: each setting (GENERATOR.WORLD) with its name and hint. */
const WORLD_FIELDS = Object.freeze([
    Object.freeze({ key: "density", label: "FILRODENSWMB.UI.GenerateDensity", hint: "FILRODENSWMB.UI.GenerateDensityHint" }),
    Object.freeze({ key: "urbanisation", label: "FILRODENSWMB.UI.GenerateUrbanization", hint: "FILRODENSWMB.UI.GenerateUrbanizationHint" }),
    Object.freeze({ key: "realmSpacing", label: "FILRODENSWMB.UI.GenerateRealmSpacing", hint: "FILRODENSWMB.UI.GenerateRealmSpacingHint" }),
    Object.freeze({ key: "fragmentation", label: "FILRODENSWMB.UI.GenerateFragmentation", hint: "FILRODENSWMB.UI.GenerateFragmentationHint" }),
]);

/** The Output section's switches: the settlement tiers and the kinds of route, each with its name. */
const PLACE_FIELDS = Object.freeze({ city: "FILRODENSWMB.UI.GeneratePlacesCity", largeTown: "FILRODENSWMB.UI.GeneratePlacesLargeTown", town: "FILRODENSWMB.UI.GeneratePlacesTown", castle: "FILRODENSWMB.UI.GeneratePlacesCastle" });
const ROUTE_FIELDS = Object.freeze({ road: "FILRODENSWMB.UI.GenerateRoutesRoad", river: "FILRODENSWMB.UI.GenerateRoutesRiver", sea: "FILRODENSWMB.UI.GenerateRoutesSea" });

const SECONDS_PER_MINUTE = 60;
const SLIDER_STEP = 0.05;


export class GeneratePanel {
    /** The map's Generate settings, valid and complete (written back so the panel and a run agree). */
    static settings(app) {
        app.uiState.generatorSettings = panelSettings(app.uiState.generatorSettings);
        return app.uiState.generatorSettings;
    }

    /**
     * The panel's context.
     * @param {object} app
     */
    static context(app) {
        const settings = this.settings(app);
        const hasRun = !!app.modelRun;
        const stale = hasRun && app.uiState.generatorStale === true;
        return {
            seed: settings.seed,
            mapSeed: String(app.uiState.mapSeed ?? ""),
            nameBases: this.nameBaseChoices(settings.nameBase),
            estimate: this.#estimate(app),
            stale,
            // The Generation section's badge: Out of date once what the last run read has changed
            runBadge: stale ? "FILRODENSWMB.UI.GenerateOutOfDate" : null,
            notices: this.#notices(app),
            hasRun,
            world: WORLD_FIELDS.map(({ key, label, hint }) => {
                const range = FILRODENSWMB.GENERATOR.WORLD[key];
                return { name: `${FIELD_PREFIX}world.${key}`, label, hint, value: settings.world[key], min: range.min, max: range.max, step: SLIDER_STEP, resetTo: String(range.default) };
            }),
            output: {
                duchies: settings.output.duchies,
                counties: settings.output.counties,
                labels: settings.output.labels,
                defaultStyles: settings.output.defaultStyles ?? Generation.stylesLookOlder(app),
                places: Object.entries(PLACE_FIELDS).map(([field, label]) => ({ name: `${FIELD_PREFIX}output.places.${field}`, label, checked: settings.output.places[field] })),
                routes: Object.entries(ROUTE_FIELDS).map(([field, label]) => ({ name: `${FIELD_PREFIX}output.routes.${field}`, label, checked: settings.output.routes[field] })),
            },
            results: hasRun ? this.results(app) : null,
            // Remove generated content, while anything a run made is on the map
            canRemove: Object.values(Generation.counts(app)).some((count) => count > 0),
        };
    }

    /** The name styles, by their localised names, with the chosen one marked (also a culture's Name style). */
    static nameBaseChoices(chosen) {
        return nameBaseNames()
            .map((name) => ({ value: name, label: platform.i18n.localize(`FILRODENSWMB.NameBase.${name.replaceAll(" ", "")}`), selected: name === chosen }))
            .sort((a, b) => a.label.localeCompare(b.label));
    }

    /**
     * What a run on this map is expected to take, in seconds (see GENERATOR.ESTIMATE), with the
     * figure to show and its unit; null before the map's mesh is ready.
     * @returns {{seconds: number, value: number, unit: string, long: boolean}|null}
     */
    static #estimate(app) {
        const seconds = this.estimateSeconds(app.meshSession?.mesh);
        if (seconds === null) return null;
        const { WARN_SECONDS } = FILRODENSWMB.GENERATOR.ESTIMATE;
        const minutes = seconds >= SECONDS_PER_MINUTE;
        return {
            seconds,
            value: minutes ? Math.round(seconds / SECONDS_PER_MINUTE) : Math.max(1, Math.round(seconds)),
            unit: minutes ? "FILRODENSWMB.UI.UnitMinutes" : "FILRODENSWMB.UI.UnitSeconds",
            long: seconds > WARN_SECONDS,
        };
    }

    /**
     * The expected time of a run on a mesh, in seconds; null without one.
     * @param {{width: number, height: number, modelCount: number, cellCount: number}|null|undefined} mesh
     * @returns {number|null}
     */
    static estimateSeconds(mesh) {
        if (!mesh?.modelCount) return null;
        const { PER_PIXEL, CELL_FACTOR, CELL_POWER, PER_DISPLAY_CELL } = FILRODENSWMB.GENERATOR.ESTIMATE;
        return mesh.width * mesh.height * PER_PIXEL + CELL_FACTOR * mesh.modelCount ** CELL_POWER + mesh.cellCount * PER_DISPLAY_CELL;
    }

    /**
     * The notices the panel shows: on a regional map holding content generated on the map it was
     * cut from, that in-fill is the way to refine it; on a map covering a small area, that it will
     * get few realms and only the larger settlements.
     * @returns {string[]} Localisation keys.
     */
    static #notices(app) {
        const notices = [];
        const ownRun = app.modelRun?.run ?? null;
        const inherited = (item) => item?.generated && item.generated.run !== ownRun;
        const regions = (app.layerSets ?? []).flatMap((set) => set.levels ?? []).flatMap((level) => level.regions ?? []);
        if (app.currentParentId && [...(app.mapPins ?? []), ...(app.mapRoutes ?? []), ...regions].some(inherited)) notices.push("FILRODENSWMB.UI.GenerateInheritedNotice");
        const land = this.landModelCells(app.meshSession);
        if (land !== null && land < FILRODENSWMB.GENERATOR.SMALL_WORLD_LAND_CELLS) notices.push("FILRODENSWMB.UI.GenerateSmallWorldNotice");
        return notices;
    }

    /**
     * About how many of the map's model cells are land: the model cells whose own display cell is
     * land (a model cell's site is a display site). Null before the map's mesh is ready.
     * @returns {number|null}
     */
    static landModelCells(session) {
        const land = session?.aggregates?.land;
        if (!land) return null;
        let count = 0;
        for (let cell = 0; cell < session.mesh.modelCount; cell++) count += land[cell] === 1 ? 1 : 0;
        return count;
    }

    /**
     * What the last run left on the map: its realms, duchies and counties, places by tier, routes
     * by kind, and the people it counted. Items deleted since are not counted.
     * @param {object} app
     * @returns {{rows: {label: string, value: number}[]}}
     */
    static results(app) {
        const run = app.modelRun?.run;
        const ofRun = (item) => item?.generated?.run === run;
        const regions = (app.layerSets ?? []).flatMap((set) => set.levels ?? []).flatMap((level) => level.regions ?? []).filter(ofRun);
        const pins = (app.mapPins ?? []).filter(ofRun);
        const routes = (app.mapRoutes ?? []).filter(ofRun);
        const count = (list, test) => list.filter(test).length;
        const T = FILRODENSWMB.GENERATOR.PIN_TIERS;
        const rows = [
            ["FILRODENSWMB.UI.GenerateResultRealms", count(regions, (region) => region.generated.kind === "realm")],
            ["FILRODENSWMB.UI.GenerateResultDuchies", count(regions, (region) => region.generated.kind === "duchy")],
            ["FILRODENSWMB.UI.GenerateResultCounties", count(regions, (region) => region.generated.kind === "county")],
            ["FILRODENSWMB.UI.GenerateResultCapitals", count(pins, (pin) => pin.generated.tier === T.capital)],
            ["FILRODENSWMB.UI.GenerateResultCities", count(pins, (pin) => pin.generated.tier === T.city)],
            ["FILRODENSWMB.UI.GenerateResultTowns", count(pins, (pin) => pin.generated.kind !== "castle" && ![T.capital, T.city].includes(pin.generated.tier))],
            ["FILRODENSWMB.UI.GenerateResultCastles", count(pins, (pin) => pin.generated.kind === "castle")],
            ["FILRODENSWMB.UI.GenerateResultRoads", count(routes, (route) => route.transport === "road")],
            ["FILRODENSWMB.UI.GenerateResultRiverTrade", count(routes, (route) => route.transport === "river")],
            ["FILRODENSWMB.UI.GenerateResultSeaLanes", count(routes, (route) => route.transport === "sea")],
        ];
        const population = Number(app.modelRun?.stats?.population) || 0;
        return {
            rows: rows.map(([label, value]) => ({ label, value: value.toLocaleString(platform.i18n.lang) })),
            population: population.toLocaleString(platform.i18n.lang),
        };
    }

    /**
     * A field of the panel changed: its value is written into the map's settings (a slider when it
     * is let go, a text field when it is left, a tick or a choice at once), the map is marked
     * changed, and the panel redrawn where the change alters it.
     * @param {object} app
     * @param {Event} event
     * @returns {boolean} Whether the field was the panel's.
     */
    static handleInput(app, event) {
        const target = event.target;
        const name = target?.name ?? "";
        if (!name.startsWith(FIELD_PREFIX)) return false;
        const isText = target.type === "text";
        if ((target.type === "range" || isText) && event.type === "input") return true;
        const path = name.slice(FIELD_PREFIX.length).split(".");
        const settings = this.settings(app);
        let value = target.value;
        if (target.type === "checkbox") value = target.checked;
        else if (target.type === "range" || target.type === "number") value = Number(target.value);
        setPath(settings, path, value);
        app.uiState.generatorSettings = panelSettings(settings);
        app.markDirty();
        // Turning duchies off takes counties with them, which the panel shows
        if (path[0] === "output") app.view?.render(["context"]);
        return true;
    }

    /** Randomise: a new seed for the next run. */
    static randomizeSeed(app) {
        this.settings(app).seed = platform.utils.randomID();
        app.markDirty();
        app.view?.render(["context"]);
    }

    /** Remove generated content: what runs made and the reader has not kept goes (see Regeneration). */
    static async removeGenerated(app) {
        const done = await Generation.removeGenerated(app);
        if (done) app.view?.render(["context"]);
        return done;
    }

    /** Generate (or Generate again): the run, then the panel redrawn with its results. */
    static async generate(app) {
        const done = await Generation.run(app);
        if (done) app.view?.render(["context"]);
        return done;
    }
}

/** Keys that would reach an object's prototype rather than its own fields. */
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Writes a value at a path of plain objects ("world", "density"), making the objects on the way.
 * A path through a prototype key is ignored.
 */
function setPath(target, path, value) {
    if (path.some((key) => UNSAFE_KEYS.has(key))) return;
    let node = target;
    for (const key of path.slice(0, -1)) {
        if (!node[key] || typeof node[key] !== "object") node[key] = {};
        node = node[key];
    }
    node[path.at(-1)] = value;
}
