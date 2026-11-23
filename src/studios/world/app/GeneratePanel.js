import { GenerateGuard } from "./GenerateGuard.js";
import { WorldEditors } from "./WorldEditors.js";
import { FILRODENSWMB } from "../../../config.js";
import { GeneratorRevision } from "../generator/GeneratorRevision.js";
import { panelSettings } from "../generator/GeneratorSettings.js";
import { nameBaseNames } from "../generator/Names.js";
import { AgeEditor } from "./AgeEditor.js";
import { GeneratedDetails } from "./GeneratedDetails.js";
import { platform } from "../../../platform/index.js";
import { Generation } from "./Generation.js";
import { Inspector } from "./Inspector.js";
import { Regeneration, isKept } from "./Regeneration.js";
import { RunInputs } from "./RunInputs.js";
import { MapMarks } from "./MapMarks.js";

/** Why a run could not build on a settlement pin as its style asked (see Pipeline.markSeatPlaces), in the order the notices list them. */
const SEAT_REASONS = Object.freeze(["water", "islet", "dry", "notCapital", "noPlace"]);
/** Each reason's notice: its heading and its tooltip. */
const SEAT_NOTICE = Object.freeze({
    water: { heading: "FILRODENSWMB.UI.GenerateSeatWaterHeading", hint: "FILRODENSWMB.UI.GenerateSeatWaterHint" },
    islet: { heading: "FILRODENSWMB.UI.GenerateSeatIsletHeading", hint: "FILRODENSWMB.UI.GenerateSeatIsletHint" },
    dry: { heading: "FILRODENSWMB.UI.GenerateSeatDryHeading", hint: "FILRODENSWMB.UI.GenerateSeatDryHint" },
    notCapital: { heading: "FILRODENSWMB.UI.GenerateSeatNotCapitalHeading", hint: "FILRODENSWMB.UI.GenerateSeatNotCapitalHint" },
    noPlace: { heading: "FILRODENSWMB.UI.GenerateSeatNoPlaceHeading", hint: "FILRODENSWMB.UI.GenerateSeatNoPlaceHint" },
});

/** What each kind of the run's fingerprint names when it has changed since (see RunInputs), in its order. */
const CHANGED_KINDS = Object.freeze({
    routes: "FILRODENSWMB.UI.GenerateChangedRoutes",
    seats: "FILRODENSWMB.UI.GenerateChangedSeats",
    regions: "FILRODENSWMB.UI.GenerateChangedRegions",
    cultures: "FILRODENSWMB.UI.GenerateChangedCultures",
    rivers: "FILRODENSWMB.UI.GenerateChangedRivers",
    features: "FILRODENSWMB.UI.GenerateChangedFeatures",
    influences: "FILRODENSWMB.UI.GenerateChangedInfluences",
});

/**
 * The Generate tool's panel (templates/world/tools-generate.hbs): the settings a run is made with, kept
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
        // Out of date: what the run read has changed, the map's own routes, pins, regions and rivers included
        const stale = RunInputs.stale(app);
        // A map made with an older generator keeps its rules (in Travel and Fill in too) until it
        // is generated again: one notice for every change since (see GeneratorRevision)
        const older = GeneratorRevision.isOlder(app.uiState);
        // On a regional map holding its parent's run, Fill in only: the settings carried from the
        // parent are shown read only, for when the map leaves its parent (see Generation.heldByParent)
        const held = Generation.heldByParent(app);
        return {
            held,
            seed: settings.seed,
            mapSeed: String(app.uiState.mapSeed ?? ""),
            nameBases: this.nameBaseChoices(settings.nameBase),
            estimate: this.#estimate(app),
            stale,
            // What of the map's own the run read has changed since, named (UC, board U3)
            staleWhat: stale ? this.#changedSince(app) : null,
            older,
            // The Generation section's heading: fill in only on a map holding its parent's run; else
            // the run's mark (MapMarks, as the layer switcher and the overview show it): Out of date
            // once what the last run read has changed, else Older generator
            runBadge: held ? "FILRODENSWMB.UI.GenerateHeldBadge" : null,
            runMark: held ? null : (MapMarks.named(MapMarks.of({ hasRun, runEdited: stale, older }, { noRun: false }))[0] ?? null),
            notices: this.#notices(app),
            hasRun,
            world: WORLD_FIELDS.map(({ key, label, hint }) => {
                const range = FILRODENSWMB.GENERATOR.WORLD[key];
                return { name: `${FIELD_PREFIX}world.${key}`, label, hint, value: settings.world[key], min: range.min, max: range.max, step: SLIDER_STEP, resetTo: held ? null : String(range.default), disabled: held };
            }),
            output: {
                duchies: settings.output.duchies,
                counties: settings.output.counties,
                labels: settings.output.labels,
                // What the age before the present leaves, offered with more than one age
                history: settings.output.history,
                showHistory: settings.ages.length > 1,
                defaultStyles: settings.output.defaultStyles ?? Generation.stylesLookOlder(app),
                places: Object.entries(PLACE_FIELDS).map(([field, label]) => ({ name: `${FIELD_PREFIX}output.places.${field}`, label, checked: settings.output.places[field] })),
                routes: Object.entries(ROUTE_FIELDS).map(([field, label]) => ({ name: `${FIELD_PREFIX}output.routes.${field}`, label, checked: settings.output.routes[field] })),
            },
            ages: this.#ages(app, settings.ages, held),
            results: hasRun ? this.results(app) : null,
            // Remove generated content, while anything a run made is on the map
            canRemove: Object.values(Generation.counts(app)).some((count) => count > 0),
        };
    }

    /**
     * The Ages section's rows, oldest first (the last is the present): each age's name, its era,
     * strife and how many events in brief (see AgeEditor.summary), whether the inspector shows it,
     * and whether it can move or go.
     */
    static #ages(app, ages, held = false) {
        const shown = Inspector.current(app);
        return {
            // Read only: each row still opens its age in the inspector, read only too
            held,
            rows: ages.map((age, index) => ({
                index,
                id: age.id,
                label: AgeEditor.label(ages, index),
                summary: AgeEditor.summary(age),
                // The Ages and events page's columns (S0 step 4c-1, board C6)
                ...AgeEditor.columns(app, age),
                selected: shown?.kind === AgeEditor.KIND && shown.ref.id === age.id,
                canUp: index > 0,
                canDown: index < ages.length - 1,
                canRemove: ages.length > 1,
                held,
            })),
            canAdd: !held && ages.length < FILRODENSWMB.GENERATOR.MAX_AGES,
            count: ages.length,
            // As the cultures' table: more than a few rows may scroll (WorldEditors.SCROLL_ROWS)
            scrolls: ages.length > WorldEditors.SCROLL_ROWS,
        };
    }

    /**
     * The Ages section's commands: add an age (a copy of the present's era and strife, with no
     * events, which becomes the present and opens in the inspector), remove one, or move one
     * earlier or later; each one undo step. Saved with the map; a run made before is out of date.
     * @param {object} app
     * @param {"add"|"remove"|"up"|"down"} command
     * @param {number} [index]
     */
    static editAges(app, command, index = -1) {
        if (Generation.heldByParent(app)) return;
        const settings = this.settings(app);
        const ages = settings.ages.map((age) => ({ ...age }));
        let opened = null;
        if (command === "add" && ages.length < FILRODENSWMB.GENERATOR.MAX_AGES) {
            const { id: _id, ...present } = ages.at(-1);
            ages.push({ ...present, events: [] });
            opened = ages.length - 1;
        } else if (command === "remove" && ages.length > 1 && ages[index]) ages.splice(index, 1);
        else if ((command === "up" || command === "down") && ages[index]) {
            const other = command === "up" ? index - 1 : index + 1;
            if (!ages[other]) return;
            [ages[index], ages[other]] = [ages[other], ages[index]];
        } else return;
        if (WorldEditors.readOnly(app)) return false;
        settings.ages = ages;
        app.uiState.generatorSettings = panelSettings(settings);
        app.markGeneratorStale?.();
        app.markDirty();
        app.view?.render(["context"]);
        if (opened !== null) AgeEditor.open(app, app.uiState.generatorSettings.ages[opened].id, { keepFocus: true });
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
        const once = this.estimateSeconds(app.meshSession?.mesh);
        if (once === null) return null;
        // Each age runs the stages again (the model cells are built once, a small part of a run)
        const seconds = once * this.settings(app).ages.length;
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
     * get few realms and only the larger settlements; and, after a run, each culture whose
     * homelands were not all on land (some left out, and one placed for it when none was left),
     * and the settlement pins it could not build on as their styles asked, grouped by why.
     * @returns {(string|{text: string, hint?: string, items?: string[]})[]} Localisation keys, or
     *     text already put together (with a group's tooltip and the names it lists).
     */
    static #notices(app) {
        const notices = [];
        const ownRun = app.modelRun?.run ?? null;
        const inherited = (item) => item?.generated && item.generated.run !== ownRun;
        const regions = (app.layerSets ?? []).flatMap((set) => set.levels ?? []).flatMap((level) => level.regions ?? []);
        // Held by its parent, the map cannot be generated, so the notice has nothing to warn of
        if (app.currentParentId && !Generation.heldByParent(app) && [...(app.mapPins ?? []), ...(app.mapRoutes ?? []), ...regions].some(inherited)) notices.push("FILRODENSWMB.UI.GenerateInheritedNotice");
        const land = this.landModelCells(app.meshSession);
        if (land !== null && land < FILRODENSWMB.GENERATOR.SMALL_WORLD_LAND_CELLS && !Generation.heldByParent(app)) notices.push("FILRODENSWMB.UI.GenerateSmallWorldNotice");
        const ages = app.modelRun?.ages;
        if (ages && ages.run < ages.asked) notices.push({ text: platform.i18n.format("FILRODENSWMB.UI.GenerateAgesStoppedNotice", { run: ages.run, asked: ages.asked }) });
        for (const culture of app.modelRun?.cultures ?? []) {
            if (!(culture.homelandsLeftOut > 0)) continue;
            const key = culture.homelandsAuto ? "FILRODENSWMB.UI.GenerateHomelandsPlacedNotice" : "FILRODENSWMB.UI.GenerateHomelandsLeftOutNotice";
            notices.push({ text: platform.i18n.format(key, { name: culture.name, count: culture.homelandsLeftOut }) });
        }
        return notices;
    }

    /**
     * The map's own items the last run read that have changed since, as one sentence ("Changed
     * since: settlement pins and their entered populations, and routes."), or null when none has
     * (a change to the terrain, climate or settings is said by the hint alone).
     */
    static #changedSince(app) {
        const kinds = RunInputs.changed(app).filter((kind) => CHANGED_KINDS[kind]);
        if (!kinds.length) return null;
        const list = new Intl.ListFormat(platform.i18n.lang, { type: "conjunction" }).format(kinds.map((kind) => platform.i18n.localize(CHANGED_KINDS[kind])));
        return platform.i18n.format("FILRODENSWMB.UI.GenerateChangedSince", { list });
    }

    /**
     * What the last run did with the settlement pins, for the Results section (board U3): one
     * notice per reason it could not build on a pin as its style asked (in SEAT_REASONS' order),
     * then, with entered populations (see UserFigures), the pins it could not bring to their figure
     * and the pins whose towns gave up people to keep to theirs. Each is a heading, a tooltip with
     * the detail, and the pins (with their figures) in alphabetical order. Pins deleted since are
     * left out, and a notice with none left is not given.
     */
    static #seatNotices(app) {
        const byId = new Map((app.mapPins ?? []).map((pin) => [pin.id, pin]));
        const unnamed = platform.i18n.localize("FILRODENSWMB.UI.GenerateSeatUnnamed");
        const nameOf = (id) => byId.get(id).name || unnamed;
        const lang = platform.i18n.lang;
        const count = (value) => Math.round(value).toLocaleString(lang);
        const names = new Map(SEAT_REASONS.map((reason) => [reason, []]));
        const seats = app.modelRun?.seats;
        for (const { pin, reason } of seats?.unhonoured ?? []) {
            if (byId.has(pin) && names.has(reason)) names.get(reason).push(nameOf(pin));
        }
        const notices = SEAT_REASONS.filter((reason) => names.get(reason).length).map((reason) => {
            const { heading, hint } = SEAT_NOTICE[reason];
            return { text: platform.i18n.localize(heading), hint: platform.i18n.localize(hint), items: names.get(reason).sort((a, b) => a.localeCompare(b)) };
        });
        const byName = (a, b) => a.name.localeCompare(b.name);
        const short = (seats?.short ?? []).filter(({ pin }) => byId.has(pin)).map((entry) => ({ ...entry, name: nameOf(entry.pin) })).sort(byName);
        if (short.length) {
            notices.push({
                text: platform.i18n.localize("FILRODENSWMB.UI.GenerateSeatShortHeading"),
                hint: platform.i18n.localize("FILRODENSWMB.UI.GenerateSeatShortHint"),
                items: short.map(({ name, entered, made }) => platform.i18n.format("FILRODENSWMB.UI.GenerateSeatShortItem", { name, entered: count(entered), made: count(made) })),
            });
        }
        const given = (seats?.givenUp ?? []).filter(({ pin }) => byId.has(pin)).map((entry) => ({ ...entry, name: nameOf(entry.pin) })).sort(byName);
        if (given.length) {
            notices.push({
                text: platform.i18n.localize("FILRODENSWMB.UI.GenerateSeatGivenHeading"),
                hint: platform.i18n.localize("FILRODENSWMB.UI.GenerateSeatGivenHint"),
                items: given.map(({ name, toTowns, toCountry }) => {
                    if (!toCountry) return platform.i18n.format("FILRODENSWMB.UI.GenerateSeatGivenTowns", { name, towns: count(toTowns) });
                    if (!toTowns) return platform.i18n.format("FILRODENSWMB.UI.GenerateSeatGivenCountry", { name, country: count(toCountry) });
                    return platform.i18n.format("FILRODENSWMB.UI.GenerateSeatGivenBoth", { name, towns: count(toTowns), country: count(toCountry) });
                }),
            });
        }
        return notices;
    }

    /**
     * The regions whose chosen cultures the run could not make most of their people (UC phase 2;
     * see generator/RegionCultures): each region of the run's Political set whose first culture
     * holds under half its people, with that culture and its share, in alphabetical order. Regions
     * deleted since are left out, and the notice with none left is not given.
     */
    static #regionNotices(app) {
        const minority = app.modelRun?.regionCultures?.minority ?? [];
        const levels = Regeneration.chain(Regeneration.target(app));
        if (!minority.length || !levels) return [];
        const DEPTH = { realm: 0, duchy: 1, county: 2 };
        const unnamed = platform.i18n.localize("FILRODENSWMB.UI.GenerateSeatUnnamed");
        const items = minority
            .map(({ level, key, culture, share }) => {
                const region = levels[DEPTH[level]]?.regions.find((candidate) => candidate.key === key);
                if (!region) return null;
                const name = region.name || unnamed;
                return { name, text: platform.i18n.format("FILRODENSWMB.UI.GenerateRegionMinorityItem", { name, culture: GeneratedDetails.cultureName(app, culture) ?? platform.i18n.localize("FILRODENSWMB.UI.RegionCultureDeleted"), share: Math.round(share * 100) }) };
            })
            .filter(Boolean)
            .sort((a, b) => a.name.localeCompare(b.name));
        if (!items.length) return [];
        return [{ text: platform.i18n.localize("FILRODENSWMB.UI.GenerateRegionMinorityHeading"), hint: platform.i18n.localize("FILRODENSWMB.UI.GenerateRegionMinorityHint"), items: items.map((item) => item.text) }];
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
            ["FILRODENSWMB.UI.GenerateResultTowns", count(pins, (pin) => pin.generated.kind === "town" && ![T.capital, T.city].includes(pin.generated.tier))],
            ["FILRODENSWMB.UI.GenerateResultCastles", count(pins, (pin) => pin.generated.kind === "castle")],
            ["FILRODENSWMB.UI.GenerateResultRoads", count(routes, (route) => route.transport === "road" && !route.generated.oldRoad)],
            ["FILRODENSWMB.UI.GenerateResultRiverTrade", count(routes, (route) => route.transport === "river")],
            ["FILRODENSWMB.UI.GenerateResultSeaLanes", count(routes, (route) => route.transport === "sea")],
        ];
        // What the age before left, when it left anything
        const former = [
            ["FILRODENSWMB.UI.GenerateResultRuins", count(pins, (pin) => pin.generated.kind === "ruin")],
            ["FILRODENSWMB.UI.GenerateResultAbandonedCastles", count(pins, (pin) => pin.generated.kind === "abandonedCastle")],
            ["FILRODENSWMB.UI.GenerateResultOldRoads", count(routes, (route) => route.generated.oldRoad === true)],
        ];
        if (former.some(([, value]) => value > 0)) rows.push(...former);
        // The settlement pins it built on, when there were any
        const seats = (app.mapPins ?? []).filter((pin) => pin.modelled?.run === run || (pin.generated?.run === run && isKept(pin))).length;
        if (seats > 0) rows.push(["FILRODENSWMB.UI.GenerateResultSeats", seats]);
        const population = Number(app.modelRun?.stats?.population) || 0;
        return {
            rows: rows.map(([label, value]) => ({ label, value: value.toLocaleString(platform.i18n.lang) })),
            population: population.toLocaleString(platform.i18n.lang),
            cultures: this.#cultureShares(app, regions),
            // What the run did with the settlement pins (moved here from Run: UC, board U3)
            notices: [...this.#seatNotices(app), ...this.#regionNotices(app)],
        };
    }

    /**
     * Each culture's share of the people of the run's realms still on the map, largest first (its
     * realms' people by culture), with its name and colour; none for a run with no cultures.
     * @returns {{name: string, color: string|null, share: string}[]}
     */
    static #cultureShares(app, regions) {
        const totals = new Map();
        let sum = 0;
        for (const region of regions) {
            const { kind, mix, population } = region.generated;
            if (kind !== "realm" || !Array.isArray(mix) || !Number.isFinite(population)) continue;
            for (const { culture, share } of mix) {
                totals.set(culture, (totals.get(culture) ?? 0) + share * population);
                sum += share * population;
            }
        }
        if (!sum) return [];
        const known = app.modelRun?.cultures ?? [];
        const colorOf = (id) => (app.uiState.cultures ?? []).find((culture) => culture.id === id)?.color ?? known.find((culture) => culture.id === id)?.color ?? null;
        return [...totals.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([id, value]) => ({ name: GeneratedDetails.cultureName(app, id) ?? "", color: colorOf(id), share: platform.i18n.format("FILRODENSWMB.UI.GeneratePercent", { value: Math.round((value / sum) * 100) }) }));
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
        // The settings carried from the parent are read only while the map holds its parent's run,
        // bar the default name style, which names what Fill in and Name all add there too
        if (Generation.heldByParent(app) && name !== `${FIELD_PREFIX}nameBase`) return true;
        const path = name.slice(FIELD_PREFIX.length).split(".");
        const settings = this.settings(app);
        let value = target.value;
        if (target.type === "checkbox") value = target.checked;
        else if (target.type === "range" || target.type === "number") value = Number(target.value);
        setPath(settings, path, value);
        app.uiState.generatorSettings = panelSettings(settings);
        app.markDirty();
        // Turning duchies off takes counties with them, which the panel shows; an age's change
        // changes what a run makes
        if (path[0] === "output") app.view?.render(["context"]);
        if (path[0] === "ages" || path[0] === "world") app.markGeneratorStale?.();
        return true;
    }

    /** Randomise: a new seed for the next run. */
    static randomizeSeed(app) {
        if (Generation.heldByParent(app)) return;
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
        // The guard: a map that reads another out-of-date map asks first (none does in S0; see GenerateGuard)
        const first = await GenerateGuard.before(app, platform.i18n.localize("FILRODENSWMB.UI.LayerSurfaceFull"));
        if (first === null) return false;
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
