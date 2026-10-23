import { FILRODENSWMB } from "../config.js";
import { platform } from "../platform/index.js";
import { decodeAge, decodeModelRun, packArray } from "../generator/ModelRun.js";
import { pastRealmLayer } from "../generator/MaterialiseRegions.js";
import { ageChanges, matchRealms, placeCells } from "../history/PastAge.js";
import { MeshSession } from "../mesh/MeshSession.js";
import { claimWaters } from "../mesh/RegionEdits.js";
import { UNCLAIMED, createLayerSet, createLevel, regionFillColor } from "../mesh/Schema.js";

/**
 * The History tool (templates/tools-history.hbs): the ages of the map's last generator run, and the
 * map as it was in the one chosen.
 *
 * The ages are numbered from 1, oldest first; the last is the present. The run keeps each earlier
 * age in brief (see ModelRun's history): its realms over the model cells, its places, castles and
 * roads, its names and its peoples. While the tool is open and an earlier age is chosen, that
 * age's realms are drawn in place of the map's own regions, from a layer set made for it here and
 * never saved, and the present's pins, routes and names are hidden. Leaving the tool shows the
 * present again, so nothing is edited while the past is shown.
 *
 * A past realm that carried on to the present (see PastAge.matchRealms) takes that realm's colour,
 * name and label look from the map, so a realm keeps its look from age to age; one that did not
 * takes the name the generator gave it and a colour of its own.
 */

/** Per studio: the past map last made, with what it was made from. */
const pasts = new WeakMap();
/** Per studio: the thematic run of the age shown (its cultures), with what it was made from. */
const runs = new WeakMap();
/** The id of the past map's layer set and level (never a map's own: those are random ids). */
const SET_ID = "history-set";
const LEVEL_ID = "history-realms";
/** How many names a list of changes gives before "and n more". */
const NAMES_SHOWN = 5;
const NO_VALUE = "–";
const PERCENT = 100;

const formatCount = (value) => Math.round(value).toLocaleString(platform.i18n.lang);

export class HistoryView {
    /** How many ages the map's run has (the present included), or 0 with no run. */
    static ageCount(app) {
        return app.modelRun ? (app.modelRun.history?.length ?? 0) + 1 : 0;
    }

    /**
     * The age chosen in the panel, from 1 (the present is the last), or null with no run. Until
     * one is chosen, and when the one chosen is no longer in the run, the age before the present.
     */
    static chosenAge(app) {
        const count = this.ageCount(app);
        if (!count) return null;
        const saved = app.uiState?.historyAge;
        if (Number.isInteger(saved) && saved >= 1 && saved <= count) return saved;
        return Math.max(1, count - 1);
    }

    /** The earlier age the map shows (an index into the run's history), or -1 for the present. */
    static shownIndex(app) {
        if (app.activeTool !== "history") return -1;
        const age = this.chosenAge(app);
        return age !== null && age < this.ageCount(app) ? age - 1 : -1;
    }

    /** Whether the map shows an earlier age. */
    static isPast(app) {
        return this.shownIndex(app) >= 0;
    }

    /**
     * Chooses the age the panel tells about and the map shows. Saved with the map, so the tool
     * opens on it again.
     * @param {object} app
     * @param {number} age - From 1.
     */
    static choose(app, age) {
        const count = this.ageCount(app);
        if (!Number.isInteger(age) || age < 1 || age > count) return false;
        app.uiState.historyAge = age;
        return true;
    }

    // ------------------------------------------------------------------ the past map

    /**
     * The map of the earlier age shown: a session on the map's own mesh holding one layer set
     * with the age's realms, the realms' regions by key, and what each carried on as. Made once
     * per run, mesh and age, and kept while they stay the same.
     * @returns {{index: number, session: MeshSession, level: object, regions: object[], carried: Int32Array}|null}
     */
    static pastMap(app) {
        const index = this.shownIndex(app);
        if (index < 0 || !app.meshSession?.aggregates) return null;
        const modelRun = app.modelRun;
        const mesh = app.meshSession.mesh;
        const cached = pasts.get(app);
        // The map's own realms lend their look, so a change to them is a change to the past map
        const present = this.#presentRealms(app);
        const look = present ? JSON.stringify([present.set.visibility, present.set.opacity, present.set.waterTint, present.level.style, present.level.opacity, present.level.visibility, present.level.watersPx, present.level.regions.map((region) => [region.generated?.sourceId, region.name, region.fillColor, region.label, region.visibility])]) : "";
        if (cached && cached.modelRun === modelRun && cached.mesh === mesh && cached.index === index && cached.look === look) return cached.map;
        const map = this.#makePastMap(app, index, present);
        pasts.set(app, { modelRun, mesh, index, look, map });
        return map;
    }

    /**
     * The layer set, level and owners of an earlier age's realms. The set and level copy the
     * map's realm level (its look, waters and visibility), so the past is drawn as the present is.
     */
    static #makePastMap(app, index, present) {
        const modelRun = app.modelRun;
        const age = modelRun.history[index];
        const { realm } = decodeAge(age);
        if (!realm) return null;
        const cells = this.#cells(app);
        const seats = age.seats ?? [];
        const carried = this.#carried(app, index, realm);

        const set = createLayerSet({
            id: SET_ID,
            name: present?.set.name ?? "",
            kind: "political",
            visibility: present?.set.visibility ?? "all",
            waterTint: present?.set.waterTint ?? true,
            opacity: present?.set.opacity ?? 1,
        });
        const level = createLevel({
            id: LEVEL_ID,
            name: present?.level.name ?? "",
            titleTemplate: present?.level.titleTemplate,
            visibility: present?.level.visibility ?? "all",
            opacity: present?.level.opacity,
            watersPx: present?.level.watersPx,
            style: present?.level.style,
        });
        // A realm of its own takes the label look of the map's kingdoms (else of any realm)
        const presentRegions = present ? [...present.bySource.values()] : [];
        const kingdom = presentRegions.find((region) => region.generated?.tier === "kingdom") ?? presentRegions[0] ?? null;
        const colours = this.#spareColours(carried, present);
        const regions = seats.map((_, key) => {
            const match = carried[key] >= 0 ? present?.bySource.get(carried[key]) ?? null : null;
            return {
                id: `${LEVEL_ID}-${key}`,
                key,
                name: match?.name ?? age.realmNames?.[key] ?? "",
                description: "",
                fillColor: match ? regionFillColor(match) : colours.get(key),
                fillStyle: null,
                quickStyle: match?.quickStyle ?? kingdom?.quickStyle ?? null,
                parentKey: null,
                visibility: match?.visibility ?? "all",
                label: structuredClone(match?.label ?? kingdom?.label ?? null),
                journalPageId: null,
                generated: null,
            };
        });
        level.regions = regions;
        level.nextKey = regions.length;
        set.levels = [level];

        const layer = pastRealmLayer(app.meshSession, realm, cells.water ?? new Float64Array(realm.length), seats);
        const session = new MeshSession({ mesh: app.meshSession.mesh, meshBlock: app.meshSession.meshBlock, layerSets: [set], owners: { [LEVEL_ID]: layer.owners }, aggregates: app.meshSession.aggregates });
        claimWaters(session, level);
        return { index, session, level, regions, carried, presentLevel: present?.level ?? null };
    }

    /**
     * The map's level filter (see DetailLevel.shown) for the past map: its realms are shown when
     * the map's own realm level is (on in the Regions menu, at the detail level), since they stand
     * in for it.
     * @param {object} past - pastMap's answer.
     * @param {function(object, object): boolean} showsLevel
     */
    static levelFilter(past, showsLevel) {
        return (set, level) => (level.id === LEVEL_ID && past.presentLevel ? showsLevel(set, past.presentLevel) : showsLevel(set, level));
    }

    /** Which present realm each realm of an earlier age carried on as (see PastAge.matchRealms), or -1. */
    static #carried(app, index, realm = decodeAge(app.modelRun.history[index]).realm) {
        const seats = app.modelRun.history[index].seats ?? [];
        const present = this.#cells(app).realm;
        return realm && present ? matchRealms(realm, seats, present) : new Int32Array(seats.length).fill(-1);
    }

    /**
     * An earlier age's realm names as the tool shows them: a realm that carried on to the present
     * by the present realm's name on the map, any other by the name the generator gave it.
     */
    static #realmNames(app, index, realm) {
        const age = app.modelRun.history[index];
        const carried = this.#carried(app, index, realm);
        const present = this.#presentRealms(app);
        return (age.seats ?? []).map((_, key) => (carried[key] >= 0 ? present?.bySource.get(carried[key])?.name : null) || age.realmNames?.[key] || null);
    }

    /**
     * Colours for the past realms that did not carry on: the region presets, least used first
     * (counting the colours the realms that carried on keep), the most populous realm first.
     */
    static #spareColours(carried, present) {
        const presets = FILRODENSWMB.REGIONS.PRESETS;
        const used = new Map(presets.map((colour) => [colour, 0]));
        carried.forEach((to) => {
            const region = to >= 0 ? present?.bySource.get(to) : null;
            if (region) used.set(regionFillColor(region), (used.get(regionFillColor(region)) ?? 0) + 1);
        });
        const colours = new Map();
        carried.forEach((to, key) => {
            if (to >= 0 && present?.bySource.has(to)) return;
            const choice = presets.reduce((best, colour) => ((used.get(colour) ?? 0) < (used.get(best) ?? 0) ? colour : best));
            colours.set(key, choice);
            used.set(choice, (used.get(choice) ?? 0) + 1);
        });
        return colours;
    }

    /**
     * The map's realms made by the run: the first level of a layer set holding them, and its
     * regions by the realm they came from. Null when they have been deleted.
     */
    static #presentRealms(app) {
        const runId = app.modelRun?.run;
        if (!runId) return null;
        for (const set of app.meshSession?.layerSets ?? []) {
            const level = set.levels[0];
            const regions = level?.regions.filter((region) => region.generated?.run === runId && region.generated.kind === "realm") ?? [];
            if (regions.length) return { set, level, bySource: new Map(regions.map((region) => [region.generated.sourceId, region])) };
        }
        return null;
    }

    /** The run's present arrays (decoded once per run). */
    static #cells(app) {
        const cached = runs.get(app);
        if (cached?.cellsOf === app.modelRun) return cached.cells;
        const cells = decodeModelRun(app.modelRun);
        runs.set(app, { ...cached, cellsOf: app.modelRun, cells });
        return cells;
    }

    // ------------------------------------------------------------------ the thematic layers

    /**
     * The run as the thematic layers read it while an earlier age is shown: that age's cultures
     * only (each cell wholly its main culture, since an earlier age keeps no shares), so Culture
     * shows the age and the layers kept for the present only have no data. Null while the present
     * is shown.
     */
    static thematicRun(app) {
        const index = this.shownIndex(app);
        if (index < 0) return null;
        const cached = runs.get(app);
        if (cached?.thematicOf === app.modelRun && cached.thematicIndex === index) return cached.thematic;
        const modelRun = app.modelRun;
        const age = modelRun.history[index];
        const cells = { water: modelRun.cells.water, landArea: modelRun.cells.landArea };
        if (age.culture) {
            cells.culture = age.culture;
            cells.shareStart = packArray(new Array(modelRun.cellCount + 1).fill(0), { type: "index" });
            cells.shareCulture = packArray([], { type: "index", offset: 1 });
            cells.shareValue = packArray([], { type: "u8", scale: 255 });
        }
        const thematic = { ...modelRun, run: `${modelRun.run}:age${index + 1}`, cells };
        runs.set(app, { ...runs.get(app), thematicOf: modelRun, thematicIndex: index, thematic });
        return thematic;
    }

    // ------------------------------------------------------------------ the information bar

    /** The realm under the pointer in the age shown, in the information bar; hidden for the present. */
    static readout(app, x, y) {
        const element = app.root?.querySelector("[data-history-readout]");
        if (!element) return;
        const past = this.pastMap(app);
        element.classList.toggle("fwmb-hidden", !past);
        if (!past) return;
        const key = x === null || y === null ? UNCLAIMED : past.session.ownerAt(LEVEL_ID, x, y);
        const region = key === UNCLAIMED ? null : past.regions[key];
        element.querySelector("[data-history-value]").textContent = region?.name || NO_VALUE;
    }

    // ------------------------------------------------------------------ the panel

    /** Centres the map on a realm of the age shown (the panel's realm list). */
    static focusRealm(app, key) {
        const past = this.pastMap(app);
        const bounds = past?.session.regionBounds(LEVEL_ID, key);
        if (!bounds) return;
        app.canvasEngine?.zoomToFeature([{ x: bounds.minX, y: bounds.minY }, { x: bounds.maxX, y: bounds.maxY }]);
    }

    /** The panel's context. */
    static context(app) {
        const count = this.ageCount(app);
        if (count < 2) return { ages: null, note: platform.i18n.localize(count ? "FILRODENSWMB.UI.HistoryOneAge" : "FILRODENSWMB.UI.HistoryNoRun") };
        const chosen = this.chosenAge(app);
        const settings = app.modelRun.settings?.ages ?? [];
        const ages = Array.from({ length: count }, (_, at) => ({
            number: at + 1,
            label: platform.i18n.format(at + 1 === count ? "FILRODENSWMB.UI.GenerateAgePresent" : "FILRODENSWMB.UI.GenerateAgeNumber", { number: at + 1 }),
            meta: this.#eraLine(settings[at]),
            chosen: at + 1 === chosen,
        }));
        const realms = this.#realmRows(app, chosen);
        return {
            ages,
            note: null,
            brief: this.#brief(app, chosen, settings[chosen - 1]),
            realms,
            // The realms list marks those gone by the present, and says so above them
            someFell: realms.some((realm) => realm.fell),
            changes: this.#changes(app, chosen),
            isPresent: chosen === count,
        };
    }

    /** An age's era and strife in a line ("High medieval · Troubled"). */
    static #eraLine(age) {
        if (!age) return "";
        const name = (prefix, id) => (id && id !== "custom" ? platform.i18n.localize(`${prefix}${id.charAt(0).toUpperCase()}${id.slice(1)}`) : null);
        return [name("FILRODENSWMB.UI.GenerateEra", age.era), name("FILRODENSWMB.UI.GenerateStrife", age.strifeName)].filter(Boolean).join(" · ");
    }

    /** The age in brief: its era, strife and event, and how many realms, places, castles and people it had. */
    static #brief(app, number, settings) {
        const modelRun = app.modelRun;
        const rows = [];
        const name = (prefix, id) => (id && id !== "custom" ? platform.i18n.localize(`${prefix}${id.charAt(0).toUpperCase()}${id.slice(1)}`) : null);
        const era = name("FILRODENSWMB.UI.GenerateEra", settings?.era);
        const strife = name("FILRODENSWMB.UI.GenerateStrife", settings?.strifeName);
        if (era) rows.push({ label: "FILRODENSWMB.UI.GenerateEra", value: era });
        if (strife) rows.push({ label: "FILRODENSWMB.UI.GenerateStrife", value: strife });
        const event = settings?.event;
        const culture = event ? modelRun.cultures?.find((entry) => entry.id === event.culture) : null;
        if (culture) rows.push({ label: "FILRODENSWMB.UI.GenerateEvent", value: platform.i18n.format(`FILRODENSWMB.UI.GenerateEvent${event.kind.charAt(0).toUpperCase()}${event.kind.slice(1)}`, { name: culture.name }) });
        const counts = this.#counts(app, number);
        rows.push({ label: "FILRODENSWMB.UI.HistoryRealms", value: formatCount(counts.realms) });
        rows.push({ label: "FILRODENSWMB.UI.HistoryPlaces", value: formatCount(counts.places) });
        rows.push({ label: "FILRODENSWMB.UI.HistoryCastles", value: formatCount(counts.castles) });
        if (counts.people !== null) rows.push({ label: "FILRODENSWMB.UI.GenerateResultPopulation", value: formatCount(counts.people) });
        return rows;
    }

    /** An age's counts: from its brief for an earlier age, from the run's figures for the present. */
    static #counts(app, number) {
        const modelRun = app.modelRun;
        if (number === this.ageCount(app)) {
            const stats = modelRun.stats ?? {};
            return {
                realms: (stats.kingdoms ?? 0) + (stats.independents ?? 0),
                places: (stats.cities ?? 0) + (stats.largeTowns ?? 0) + (stats.towns ?? 0),
                castles: stats.castles ?? 0,
                people: Number.isFinite(stats.population) ? stats.population : null,
            };
        }
        const age = modelRun.history[number - 1];
        return {
            realms: age.seats?.length ?? 0,
            places: (age.places?.length ?? 0) / 3,
            castles: age.castles?.length ?? 0,
            people: age.realmPeople ? age.realmPeople.reduce((sum, people) => sum + people, 0) : null,
        };
    }

    /**
     * The realms of the age, most people first: their colour, name, people and capital, and (for
     * an earlier age) whether they carried on to the present. An earlier age's rows centre the map
     * on their realm.
     */
    static #realmRows(app, number) {
        if (number === this.ageCount(app)) return this.#presentRealmRows(app);
        const past = this.pastMap(app);
        const age = app.modelRun.history[number - 1];
        if (!past) return [];
        const seatNames = new Map();
        for (let at = 0; at + 2 < (age.places?.length ?? 0); at += 3) seatNames.set(age.places[at], age.placeNames?.[at / 3] ?? "");
        return past.regions
            .map((region) => ({
                key: region.key,
                name: region.name || NO_VALUE,
                color: region.fillColor,
                people: age.realmPeople?.[region.key] ?? null,
                capital: seatNames.get(age.seats[region.key]) || null,
                fell: past.carried[region.key] < 0,
                focusable: true,
            }))
            .sort((a, b) => (b.people ?? 0) - (a.people ?? 0) || a.key - b.key)
            .map((row) => ({ ...row, people: row.people === null ? null : formatCount(row.people) }));
    }

    /** The present's realms: the map's own, with the capitals the run placed in them. */
    static #presentRealmRows(app) {
        const present = this.#presentRealms(app);
        if (!present) return [];
        const cells = this.#cells(app);
        const capitals = new Map();
        for (const pin of app.mapPins ?? []) {
            if (pin.generated?.run !== app.modelRun.run || pin.generated.tier !== FILRODENSWMB.GENERATOR.PIN_TIERS.capital || !Number.isInteger(pin.cell)) continue;
            const realm = cells.realm?.[pin.cell];
            if (realm >= 0) capitals.set(realm, pin.name);
        }
        return [...present.bySource]
            .map(([source, region]) => ({ key: null, name: region.name || NO_VALUE, color: regionFillColor(region), people: region.generated.population ?? null, capital: capitals.get(source) ?? null, fell: false, focusable: false }))
            .sort((a, b) => (b.people ?? 0) - (a.people ?? 0))
            .map((row) => ({ ...row, people: row.people === null ? null : formatCount(row.people) }));
    }

    /**
     * What changed: for an earlier age, by the age after it; for the present, since the age before
     * it. Realms that rose and fell by name, places founded and lost by count, and each people's
     * share of the land.
     */
    static #changes(app, number) {
        const count = this.ageCount(app);
        const from = number === count ? number - 1 : number;
        const modelRun = app.modelRun;
        const earlier = this.#ageState(app, from);
        const later = this.#ageState(app, from + 1);
        if (!earlier || !later) return null;
        const result = ageChanges(earlier, later, modelRun.cultures?.length ?? 0);
        const names = (list, nameOf) => {
            const named = list.map(nameOf).filter(Boolean);
            if (!named.length) return platform.i18n.localize("FILRODENSWMB.UI.HistoryNone");
            const shown = named.slice(0, NAMES_SHOWN).join(", ");
            return named.length > NAMES_SHOWN ? platform.i18n.format("FILRODENSWMB.UI.HistoryMore", { names: shown, count: named.length - NAMES_SHOWN }) : shown;
        };
        // With no culture of the map's own, the one default people holds all the land in every age
        const hasCultures = (modelRun.cultures ?? []).some((culture) => culture.id != null);
        const peoples = (hasCultures ? result.peoples ?? [] : [])
            .map(({ culture, from: before, to: after }) => ({
                name: modelRun.cultures[culture]?.name ?? NO_VALUE,
                color: modelRun.cultures[culture]?.color ?? null,
                value: platform.i18n.format("FILRODENSWMB.UI.HistoryShareChange", { from: Math.round(before * PERCENT), to: Math.round(after * PERCENT) }),
            }));
        return {
            title: platform.i18n.format(number === count ? "FILRODENSWMB.UI.HistoryChangesSince" : "FILRODENSWMB.UI.HistoryChangesBy", { number: number === count ? number - 1 : number + 1 }),
            rows: [
                // Lists of names take the full width, under their label
                { label: "FILRODENSWMB.UI.HistoryRealmsFell", value: names(result.fell, (realm) => earlier.realmName(realm)), wide: true },
                { label: "FILRODENSWMB.UI.HistoryRealmsRose", value: names(result.rose, (realm) => later.realmName(realm)), wide: true },
                { label: "FILRODENSWMB.UI.HistoryPlacesFounded", value: formatCount(result.founded) },
                { label: "FILRODENSWMB.UI.HistoryPlacesLost", value: formatCount(result.lost) },
            ],
            peoples,
        };
    }

    /**
     * An age as the changes compare it: its realms over the model cells, seats, places and
     * cultures, and its realms' names. The present's places are the run's town pins on the map.
     */
    static #ageState(app, number) {
        const modelRun = app.modelRun;
        const count = this.ageCount(app);
        if (number < 1 || number > count) return null;
        if (number === count) {
            const cells = this.#cells(app);
            if (!cells.realm) return null;
            const present = this.#presentRealms(app);
            const places = new Set();
            for (const pin of app.mapPins ?? []) if (pin.generated?.run === modelRun.run && pin.generated.kind === "town" && Number.isInteger(pin.cell)) places.add(pin.cell);
            let realmCount = 0;
            for (const realm of cells.realm) if (realm + 1 > realmCount) realmCount = realm + 1;
            return { realm: cells.realm, realmCount, seats: [], places, culture: cells.culture ?? null, realmName: (realm) => present?.bySource.get(realm)?.name ?? null };
        }
        const age = modelRun.history[number - 1];
        const { realm, culture } = decodeAge(age);
        if (!realm) return null;
        const names = this.#realmNames(app, number - 1, realm);
        return {
            realm,
            realmCount: age.seats?.length ?? 0,
            seats: age.seats ?? [],
            places: placeCells(age.places ?? []),
            culture,
            realmName: (key) => names[key],
        };
    }
}
