import { FILRODENSWMB } from "../config.js";
import { landKind, placeName, settlementKind } from "../names/PlaceNames.js";
import { ProceduralEngine } from "../generation/ProceduralEngine.js";
import { ThematicSource } from "../thematic/ThematicData.js";
import { setOfLevel } from "../mesh/LayerTree.js";
import { getPinIconLabel } from "../data/pinIcons.js";
import { platform } from "../platform/index.js";
import { MapStateManager } from "./MapStateManager.js";
import { PinStyles } from "./PinStyles.js";
import { RunCells } from "./RunCells.js";

const { PLACE_NAMES } = FILRODENSWMB;

/** A built-in biome's key by its id (a painted biome is looked up by id). */
const BIOME_KEYS = new Map(Object.entries(FILRODENSWMB.BIOME_IDS).map(([key, value]) => [value, key]));

/** Per studio: the run's culture layer, with the run and cells it was read from. */
const cultureSources = new WeakMap();

/**
 * What Name all's dialogue starts with ticked: regions and pins, and every name but a generated
 * one. Routes start unticked, since a generated map's routes are unnamed and naming them all would
 * label thousands of roads.
 */
const NAME_ALL_START = Object.freeze({ kinds: Object.freeze(["region", "pin"]), sources: Object.freeze(["unnamed", "random", "default"]) });

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Random names for regions, pins and routes (see PlaceNames): Random name in the inspector, which
 * rerolls the item's name on each press, and Name all on the Generate panel, for every kind of item
 * and kind of name the reader ticks.
 *
 * Every way of naming records where the name came from (`nameSource`): typed in the inspector or a
 * list's row ("typed"), Random name or Name all ("random", with `nameRoll`, so the suggestion can
 * be drawn again), Generate ("generated"), or the name an item starts with ("default"). Each is
 * written inside the change's own undo step, so undo puts the source back with the name.
 *
 * A random name does not make a generated item the reader's own (generated.edited): Generate
 * again still replaces it, so trying out names never keeps a region's borders or a place from the
 * next run. A typed name does, as any substantive edit does.
 *
 * A name is drawn in the name base of the people living at the item when the map has a run (a
 * region's commonest culture over its cells, a pin's cell's, a route's ends'), else in the map's
 * Name style, and a share of suggestions add a word that fits the item (see #descriptor).
 */
export class RandomNames {
    // ------------------------------------------------------------------ name sources

    /**
     * Where an item's name came from, for Name all: its saved `nameSource`, or for an older item
     * (which saves none) what can be told from it. A generated item edited before sources were
     * kept may have had its name typed, so it is kept ("kept"); a hand-made item with a name other
     * than its kind's default is the reader's ("typed").
     * @param {object} item
     * @param {(name: string, item: object) => boolean} [isDefault] - The kind's default names.
     * @returns {"unnamed"|"random"|"default"|"generated"|"typed"|"kept"}
     */
    static sourceOf(item, isDefault = null) {
        const source = item?.nameSource;
        if (source === "typed") return "typed";
        if (source === "random") return "random";
        if (!String(item?.name ?? "").trim()) return "unnamed";
        if (source === "generated" || source === "default") return source;
        if (item?.generated) return item.generated.edited || item.generated.locked ? "kept" : "generated";
        return isDefault?.(item.name, item) ? "default" : "typed";
    }

    /** Marks a name the reader typed (inside the caller's undo step). */
    static markTyped(item) {
        item.nameSource = "typed";
        delete item.nameRoll;
    }

    /**
     * Whether a name is its kind's default in the interface's language: "Region" or "Route" with a
     * number or none, and a pin's style's name or its icon's.
     */
    static defaultNameTest(app, kind) {
        if (kind === "pin") {
            return (name, pin) => name === PinStyles.find(app, pin.pinStyle)?.name || name === getPinIconLabel(pin.icon ?? FILRODENSWMB.PINS.DEFAULT_ICON) || name === getPinIconLabel(FILRODENSWMB.PINS.DEFAULT_ICON);
        }
        const key = kind === "route" ? "FILRODENSWMB.UI.NewRouteName" : "FILRODENSWMB.UI.NewRegionName";
        const pattern = new RegExp(`^${escapeRegExp(platform.i18n.localize(key))}(?: \\d+)?$`);
        return (name) => pattern.test(name);
    }

    // ------------------------------------------------------------------ suggestions

    /**
     * The name an item is offered for a roll.
     * @param {object} app
     * @param {"region"|"pin"|"route"} kind
     * @param {object} item
     * @param {object} [ref] - A region's `{ levelId }`.
     * @param {{roll?: number, summary?: object}} [options] - `summary`: a region's (see #regionSummaries), when already worked out.
     * @returns {string}
     */
    static suggest(app, kind, item, ref = {}, { roll = 0, summary = null } = {}) {
        const region = kind === "region" ? (summary ?? this.#regionSummaries(app, ref.levelId).get(item.key) ?? null) : null;
        return placeName({
            mapSeed: String(app.uiState?.mapSeed ?? ""),
            itemId: item.id,
            roll,
            nameBase: this.#nameBase(app, kind, item, region),
            descriptor: this.#descriptor(app, kind, item, ref, region),
        });
    }

    /** The item's next name: one past its last roll (or its first), unlike any in `used` or its own. */
    static #next(app, kind, item, ref, summary, used = null) {
        let roll = item.nameSource === "random" && Number.isInteger(item.nameRoll) ? item.nameRoll + 1 : 0;
        let name = this.suggest(app, kind, item, ref, { roll, summary });
        for (let attempt = 0; attempt < PLACE_NAMES.RETRIES && (name === item.name || used?.has(name)); attempt++) name = this.suggest(app, kind, item, ref, { roll: ++roll, summary });
        return { name, roll };
    }

    /**
     * Random name: the item's next suggestion, as one undo step.
     * @returns {boolean} Whether the name changed.
     */
    static reroll(app, kind, item, ref = {}) {
        const summary = kind === "region" ? (this.#regionSummaries(app, ref.levelId).get(item.key) ?? null) : null;
        const { name, roll } = this.#next(app, kind, item, ref, summary);
        if (!name || name === item.name) return false;
        MapStateManager.pushVectorState(app);
        this.#name(item, name, roll);
        return true;
    }

    static #name(item, name, roll) {
        item.name = name;
        item.nameSource = "random";
        item.nameRoll = roll;
    }

    /** Random name pressed in the inspector: the item's next name, drawn on the map. */
    static press(app, kind, item, ref = {}) {
        if (!this.reroll(app, kind, item, ref)) return false;
        app._repaintVectors?.();
        app.view?.render(["context", "editToolbar"]);
        app.markDirty?.();
        return true;
    }

    // ------------------------------------------------------------------ Name all

    /**
     * The items Name all can name, by kind, each with its group: a region's level (no name used
     * twice in a level), or the whole map for pins and routes. River sources are not named.
     */
    static #groups(app, kinds) {
        const groups = [];
        if (kinds.includes("region")) for (const set of app.layerSets ?? []) for (const level of set.levels) groups.push({ kind: "region", ref: { levelId: level.id }, items: level.regions });
        if (kinds.includes("pin")) groups.push({ kind: "pin", ref: {}, items: (app.mapPins ?? []).filter((pin) => !pin.type) });
        if (kinds.includes("route")) groups.push({ kind: "route", ref: {}, items: app.mapRoutes ?? [] });
        return groups;
    }

    /** Each group's items whose name a choice of sources takes. */
    static #targets(app, groups, sources) {
        const tests = new Map();
        // Only the sources Name all offers: a typed name, or an edited generated one, never
        sources = sources.filter((source) => Object.hasOwn(PLACE_NAMES.NAME_ALL_SOURCES, source));
        return groups.map((group) => {
            if (!tests.has(group.kind)) tests.set(group.kind, this.defaultNameTest(app, group.kind));
            const test = tests.get(group.kind);
            return { ...group, targets: group.items.filter((item) => sources.includes(this.sourceOf(item, test))) };
        });
    }

    /**
     * How many items Name all would name, for the kinds and sources ticked.
     * @param {object} app
     * @param {{kinds: string[], sources: string[]}} choice
     */
    static nameAllCount(app, { kinds = [], sources = [] }) {
        return this.#targets(app, this.#groups(app, kinds), sources).reduce((sum, group) => sum + group.targets.length, 0);
    }

    /**
     * Name all: a random name for every item of the kinds ticked whose name is of a source ticked,
     * as one undo step. A name already used in its group moves the item on to its next roll (a few
     * times, then the name is kept), and an item already randomly named is rerolled. A name the
     * reader typed is never replaced, whatever is ticked.
     * @param {object} app
     * @param {{kinds: string[], sources: string[]}} choice
     * @returns {number} How many items were named.
     */
    static nameAll(app, { kinds = [], sources = [] }) {
        const plans = [];
        for (const group of this.#targets(app, this.#groups(app, kinds), sources)) {
            if (!group.targets.length) continue;
            const summaries = group.kind === "region" ? this.#regionSummaries(app, group.ref.levelId) : null;
            const used = new Set(group.items.filter((item) => !group.targets.includes(item)).map((item) => item.name));
            for (const item of group.targets) {
                const { name, roll } = this.#next(app, group.kind, item, group.ref, summaries?.get(item.key) ?? null, used);
                used.add(name);
                plans.push({ item, name, roll });
            }
        }
        if (!plans.length) return 0;
        MapStateManager.pushVectorState(app);
        for (const { item, name, roll } of plans) this.#name(item, name, roll);
        return plans.length;
    }

    /**
     * Name all on the Generate panel: asks which kinds of item and which names, with how many items
     * that would name as the ticks change, then names them as one undo step.
     */
    static async openNameAll(app) {
        const box = (map, ticked) => Object.entries(map).map(([value, label]) => ({ value, label, checked: ticked.includes(value) }));
        const content = await platform.templates.render("modules/filrodens-world-map-builder/templates/dialogs/name-all.hbs", {
            kinds: box(PLACE_NAMES.NAME_ALL_KINDS, NAME_ALL_START.kinds),
            sources: box(PLACE_NAMES.NAME_ALL_SOURCES, NAME_ALL_START.sources),
        });
        const read = (root) => ({
            kinds: [...root.querySelectorAll('input[name="nameAllKind"]:checked')].map((input) => input.value),
            sources: [...root.querySelectorAll('input[name="nameAllSource"]:checked')].map((input) => input.value),
        });
        const choice = await platform.dialogs.prompt({
            classes: ["fwmb"],
            title: platform.i18n.localize("FILRODENSWMB.UI.NameAllTitle"),
            content,
            onRender: (element) => {
                const update = () => {
                    const count = this.nameAllCount(app, read(element));
                    const shown = element.querySelector("[data-name-all-count]");
                    if (shown) shown.textContent = platform.i18n.format("FILRODENSWMB.UI.NameAllCount", { count });
                    const confirm = element.querySelector('[data-overlay-action="ok"]');
                    if (confirm) confirm.disabled = count === 0;
                };
                element.addEventListener("change", update);
                update();
            },
            onSubmit: (form) => read(form),
        });
        const named = choice ? this.nameAll(app, choice) : 0;
        if (!named) return 0;
        platform.notify.info(platform.i18n.format("FILRODENSWMB.UI.NameAllDone", { count: named }));
        app._repaintVectors?.();
        app.view?.render(["context", "editToolbar"]);
        app.markDirty?.();
        return named;
    }

    // ------------------------------------------------------------------ name bases

    /**
     * The name base an item is named in: the commonest culture at it in the map's run (a region's
     * cells, a pin's cell, a route's two ends), in that culture's Name style as the map has it now,
     * else the map's Name style.
     */
    static #nameBase(app, kind, item, region) {
        if (kind === "region") return this.#baseOfVotes(app, region?.cultures ?? new Map());
        return this.nameBaseAt(app, this.#cellsOf(app, kind, item));
    }

    /**
     * The name base of the people living in display cells: their commonest culture in the map's
     * run, in its Name style as the map has it now, else the map's Name style.
     * @param {object} app
     * @param {Iterable<number>} cells
     */
    static nameBaseAt(app, cells) {
        const culture = this.#cultures(app);
        const votes = new Map();
        if (culture) {
            for (const cell of cells) {
                const at = culture.source.cultureAt(cell);
                if (at) votes.set(at.index, (votes.get(at.index) ?? 0) + 1);
            }
        }
        return this.#baseOfVotes(app, votes);
    }

    /** The name base of the culture with the most votes (cells by the run's culture index). */
    static #baseOfVotes(app, votes) {
        const fallback = app.uiState?.generatorSettings?.nameBase || FILRODENSWMB.GENERATOR.DEFAULT_NAME_BASE;
        const culture = this.#cultures(app);
        if (!culture) return fallback;
        let best = -1;
        for (const [index, count] of votes) if (best < 0 || count > votes.get(best) || (count === votes.get(best) && index < best)) best = index;
        // The culture as the map has it now, so a Name style changed since the run is used at
        // once: the run's own record only for a culture since deleted, and the map's Name style
        // for the run's default culture (one with no id of the map's)
        const recorded = best >= 0 ? culture.run.cultures?.[best] : null;
        if (!recorded || recorded.id == null) return fallback;
        const current = (app.uiState?.cultures ?? []).find((each) => each.id === recorded.id);
        const base = current ? current.nameBase : recorded.nameBase;
        return typeof base === "string" && base ? base : fallback;
    }

    /** The run's culture layer (the map's own run, or its copy of its parent's), or null with none. */
    static #cultures(app) {
        const found = RunCells.of(app);
        if (!found) return null;
        const cached = cultureSources.get(app);
        if (cached?.run === found.run && cached.cells === found.cells) return cached.value;
        const source = ThematicSource.of(found.run, found.cells);
        const value = source ? { run: found.run, source } : null;
        cultureSources.set(app, { run: found.run, cells: found.cells, value });
        return value;
    }

    /** The display cells a pin, route or custom river is read at: a pin's own, a route's first and last waypoints, a river's first and last points. */
    static #cellsOf(app, kind, item) {
        if (kind === "river") {
            const points = item.points ?? [];
            const ends = points.length ? [points[0], points.at(-1)] : [];
            const cells = ends.map((point) => app.meshSession?.cellAt(point.x, point.y) ?? -1).filter((cell) => cell >= 0);
            return [...new Set(cells)];
        }
        if (kind === "pin") {
            const cell = Number.isInteger(item.cell) && item.cell >= 0 ? item.cell : (app.meshSession?.cellAt(item.x, item.y) ?? -1);
            return cell >= 0 ? [cell] : [];
        }
        const waypoints = item.waypoints ?? [];
        return waypoints.length ? [...new Set([waypoints[0], waypoints.at(-1)])] : [];
    }

    // ------------------------------------------------------------------ descriptors

    /**
     * The words that fit an item, for the share of suggestions that add one: a region's land
     * (and, in a top layer, a realm's form of the name), a pin's kind of place, a route's transport.
     */
    static #descriptor(app, kind, item, ref, region) {
        const forms = (key) => (key ? (PLACE_NAMES.FORMS[key] ?? []).map((form) => platform.i18n.localize(form)) : []);
        if (kind === "region") {
            const top = !setOfLevel(app.layerSets ?? [], ref.levelId)?.levels.find((level) => level.id === ref.levelId)?.parentLevelId;
            return { forms: forms(region ? landKind(region) : null), realm: top, short: true };
        }
        if (kind === "pin") return { forms: forms(settlementKind(item, PinStyles.find(app, item.pinStyle)?.tier ?? null)) };
        // A custom river's name always says what it is, as Name natural features names a river
        if (kind === "river") return { forms: (FILRODENSWMB.FEATURE_NAMES.FORMS.river ?? []).map((form) => platform.i18n.localize(form)), always: true, short: true };
        return { forms: forms(Object.hasOwn(PLACE_NAMES.FORMS, item.transport) ? item.transport : "road"), short: true };
    }

    /**
     * Each region of a level, summed over its cells: its land (in all, beside water, in the
     * mountain band, in the highland and upland bands, by land kind), whether it is an island
     * (no land beside it outside the region), and its cultures (cells by the run's culture index).
     * One pass over the level's cells serves every region in it.
     * @returns {Map<number, {land: number, coastal: number, island: boolean, mountain: number, hill: number, biomes: Object<string, number>, cultures: Map<number, number>}>}
     */
    static #regionSummaries(app, levelId) {
        const summaries = new Map();
        const session = app.meshSession;
        const mesh = session?.mesh;
        if (!mesh || !levelId) return summaries;
        const owners = session.layer(levelId).owners;
        const aggregates = session.aggregates;
        const culture = this.#cultures(app);
        const biomeAt = this.#biomeReader(app);
        const { MOUNTAIN, UPLAND } = FILRODENSWMB.GRID_DATA.TERRAIN_BAND_OFFSETS;
        const summaryOf = (key) => {
            if (!summaries.has(key)) summaries.set(key, { land: 0, coastal: 0, island: true, mountain: 0, hill: 0, biomes: {}, cultures: new Map() });
            return summaries.get(key);
        };
        for (let cell = 0; cell < mesh.cellCount; cell++) {
            const key = owners[cell];
            if (key < 0) continue;
            const summary = summaryOf(key);
            const at = culture?.source.cultureAt(cell);
            if (at) summary.cultures.set(at.index, (summary.cultures.get(at.index) ?? 0) + 1);
            if (!aggregates || aggregates.land[cell] !== 1) continue;
            summary.land += 1;
            let coastal = false;
            for (const next of mesh.neighbours(cell)) {
                if (aggregates.land[next] !== 1) coastal = true;
                else if (owners[next] !== key) summary.island = false;
            }
            if (coastal) summary.coastal += 1;
            const height = aggregates.meanElevation[cell] - aggregates.seaLevel;
            if (height >= MOUNTAIN) summary.mountain += 1;
            else if (height >= UPLAND) summary.hill += 1;
            const biome = biomeAt?.(mesh.siteX(cell), mesh.siteY(cell));
            const landKindOf = biome ? PLACE_NAMES.BIOME_KINDS[biome] : null;
            if (landKindOf) summary.biomes[landKindOf] = (summary.biomes[landKindOf] ?? 0) + 1;
        }
        return summaries;
    }

    /**
     * Reads the biome shown at a map point, as the biome layer resolves it (a painted biome, a
     * custom rule, or the built-in one); its key for a built-in biome, else null. Null when the
     * map's terrain is not loaded.
     */
    static #biomeReader(app) {
        const { currentElevationData: elevation, currentMoistureData: moisture, currentTemperatureData: temperature, currentBiomeOverrides: overrides } = app;
        if (!elevation || !moisture || !temperature || !app.mapWidth) return null;
        let params;
        try {
            params = MapStateManager.getDerivedMapParameters(app.uiState, app.customBiomeColors ?? {}).params;
        } catch {
            return null;
        }
        const width = app.mapWidth;
        return (x, y) => {
            const index = Math.floor(y) * width + Math.floor(x);
            if (!(index >= 0 && index < elevation.length)) return null;
            const { visible } = ProceduralEngine.resolveBiomeLookup(overrides?.[index] ?? 0, elevation[index], moisture[index], temperature[index], params.seaLevel, app.bufferWaterMask, index, params.customBiomeRules, params.biomePalette, params.biomeSides);
            const key = typeof visible === "number" ? BIOME_KEYS.get(visible) : visible;
            return typeof key === "string" ? key : null;
        };
    }
}
