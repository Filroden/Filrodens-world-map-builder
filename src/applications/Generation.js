import { FILRODENSWMB } from "../config.js";
import { generateInBackground } from "../generator/Generate.js";
import { buildGeneratorPayload } from "../generator/GeneratorInput.js";
import { GeneratorRevision } from "../generator/GeneratorRevision.js";
import { materialise } from "../generator/Materialise.js";
import { createPoliticalSet } from "../generator/MaterialiseRegions.js";
import { panelSettings, resolveOutput } from "../generator/GeneratorSettings.js";
import { encodeModelRun } from "../generator/ModelRun.js";
import { platform } from "../platform/index.js";
import { DetailLevel } from "./DetailLevel.js";
import { FieldSpecs } from "./FieldSpecs.js";
import { MapDialogManager } from "./MapDialogManager.js";
import { MapStateManager } from "./MapStateManager.js";
import { PinStyles } from "./PinStyles.js";
import { Regeneration, isKept } from "./Regeneration.js";
import { VectorHistory } from "./VectorHistory.js";

/**
 * Running the generator on the open map and writing what it makes onto it: the input is gathered
 * from the studio, the run goes to the background worker under the processing overlay (with its
 * progress and Cancel), and the result becomes a Political layer set, routes and pins beside the
 * map's own content (see Materialise), as one undo step.
 *
 * The styles generated content uses are the map's own: route styles by id (see
 * GENERATOR.ROUTE_STYLES) and pin styles by tier (see PINS.DEFAULT_STYLES), each added from the
 * defaults when the map lacks it, so a map whose styles were edited keeps its look and one whose
 * styles were deleted gets them back for the run.
 */
/** The pin style tiers a run takes as seats: the settlements and castles the world model makes. */
const SEAT_KINDS = new Set(["capital", "city", "largeTown", "town", "fortifiedTown", "port", "castle"]);

/** How far (map pixels, each way) from a settlement pin's point a land pixel makes it a pin on land (see Generation.#onLand). */
const SEAT_SHORE_PX = 4;

export class Generation {
    /**
     * Runs the generator with the map's Generate settings (see GeneratePanel) and adds its output
     * to the map. When the map already holds generated content, the user is asked first (the new
     * run is added beside it). Does nothing while the map's mesh or terrain is not ready, or when
     * other cancellable work is under way.
     * @param {object} app - The studio.
     * @returns {Promise<boolean>} Whether content was added.
     */
    static async run(app) {
        if (!app.meshSession?.aggregates || !app.currentElevationData) {
            platform.notify.warn(platform.i18n.localize("FILRODENSWMB.UI.GenerateNotReady"));
            return false;
        }
        const settings = panelSettings(app.uiState.generatorSettings);
        // Use the default styles, when the reader has not chosen, follows whether the map's styles are an older set
        settings.output.defaultStyles ??= this.stylesLookOlder(app);
        if (!(await this.#confirmAgain(app))) return false;
        let result;
        try {
            result = await app.runCancellable(this.#stageText(STAGES[0].id, 0), (signal, overlay) => this.#runWork(app, settings, signal, overlay));
        } catch (error) {
            console.error("FWMB | Generation failed:", error);
            platform.notify.error(platform.i18n.localize("FILRODENSWMB.UI.GenerateFailed"));
            return false;
        }
        return !!result;
    }

    /** The run under the overlay: the generator in the background, then the result written onto the map. */
    static async #runWork(app, settings, signal, overlay) {
        const progress = new RunProgress(overlay, (stage, pct, age, ages) => this.#stageText(stage, pct, age, ages));
        // Once an age has finished, the run can end keeping the ages finished
        const stop = new AbortController();
        let offered = 0;
        const onProgress = ({ stage, pct, age, ages }) => {
            progress.update(stage, pct, age, ages);
            const finished = (age ?? 1) - 1;
            if (finished > offered && !stop.signal.aborted) {
                offered = finished;
                overlay.keep?.(platform.i18n.format("FILRODENSWMB.UI.GenerateKeepAges", { count: finished }), () => {
                    stop.abort();
                    overlay.keep?.(null);
                });
            }
        };
        try {
            const result = await generateInBackground(() => this.payload(app, settings, { revision: GeneratorRevision.CURRENT, userRegions: this.userRegions(app, settings.output) }), { signal, stopSignal: stop.signal, onProgress }).catch((error) => {
                if (error?.name === "AbortError") return null;
                throw error;
            });
            if (!result) return null;
            progress.update(MATERIALISE_STAGE, FULL);
            await nextPaint();
            this.apply(app, result, settings.output);
            return result;
        } finally {
            progress.stop();
        }
    }

    /** The progress line: the age (when there are several), the stage's name and how far the run has come. */
    static #stageText(stage, pct, age = null, ages = null) {
        const line = platform.i18n.format("FILRODENSWMB.UI.GenerateProgress", { stage: platform.i18n.localize(`FILRODENSWMB.UI.GenerateStage${stage.charAt(0).toUpperCase()}${stage.slice(1)}`), pct: Math.round(pct) });
        return ages > 1 ? platform.i18n.format("FILRODENSWMB.UI.GenerateProgressAge", { age, ages, line }) : line;
    }

    /**
     * Before a run on a map that already holds generated content: a confirmation giving what the
     * run replaces and how much is kept (see Regeneration). True to go ahead (or when nothing would
     * be replaced).
     */
    static async #confirmAgain(app) {
        return this.#confirmReplacing(app, "FILRODENSWMB.UI.GenerateAgainTitle", "FILRODENSWMB.UI.GenerateAgainMessage");
    }

    static async #confirmReplacing(app, titleKey, messageKey) {
        const { removed, kept } = Regeneration.plan(app);
        if (!removed.realms && !removed.places && !removed.routes) return true;
        const format = (value) => value.toLocaleString(platform.i18n.lang);
        const shown = { ...Object.fromEntries(Object.entries(removed).map(([key, value]) => [key, format(value)])), kept: format(kept) };
        return MapDialogManager._confirmDialog(platform.i18n.localize(titleKey), platform.i18n.format(messageKey, shown));
    }

    /**
     * Remove generated content (the Results section): every generated realm, place and route not
     * kept goes, after a confirmation, as one undo step (see Regeneration). Returns whether anything went.
     * @param {object} app
     * @returns {Promise<boolean>}
     */
    static async removeGenerated(app) {
        const { removed } = Regeneration.plan(app);
        if (!removed.realms && !removed.places && !removed.routes) {
            platform.notify.info(platform.i18n.localize("FILRODENSWMB.UI.RemoveGeneratedNothing"));
            return false;
        }
        if (!(await this.#confirmReplacing(app, "FILRODENSWMB.UI.RemoveGeneratedTitle", "FILRODENSWMB.UI.RemoveGeneratedMessage"))) return false;
        const before = VectorHistory.snapshot(app);
        const removal = Regeneration.remove(app);
        // What the run gave hand-placed settlement pins goes with it; the pins stay
        for (const pin of app.mapPins ?? []) delete pin.modelled;
        const modelRunBefore = app.modelRun ?? null;
        app.modelRun = null;
        const owners = removal.owners.map((entry) => VectorHistory.levelOwners(entry.levelId, entry.before, entry.after));
        VectorHistory.push(app, VectorHistory.composite([before, ...owners, VectorHistory.modelRun(modelRunBefore, null)]));
        this.#afterChange(app);
        return true;
    }

    static #afterChange(app) {
        app._repaintVectors();
        app.view?.render(["context"]);
        app.markDirty();
    }

    /**
     * How much generated content the map holds, from any run: realms, places (pins) and routes.
     * @param {object} app
     * @returns {{realms: number, places: number, routes: number}}
     */
    static counts(app) {
        const generated = (item) => !!item?.generated;
        const regions = (app.layerSets ?? []).flatMap((set) => set.levels ?? []).flatMap((level) => level.regions ?? []);
        return {
            realms: regions.filter((region) => region.generated?.kind === "realm").length,
            places: (app.mapPins ?? []).filter(generated).length,
            routes: (app.mapRoutes ?? []).filter(generated).length,
        };
    }

    /**
     * The generator's input from the open map (see GeneratorInput). Every array is a copy, so it
     * may be moved to the worker. It follows the generator rules the map does (see
     * GeneratorRevision), as Travel and Fill in must; a run asks for the current ones.
     * @param {object} app
     * @param {object} [settings]
     * @param {{revision?: number, userRegions?: object|null}} [options] - revision: the rules to
     *     follow instead of the map's; userRegions: the map's own regions a run builds round (see
     *     userRegions), which only a run needs.
     */
    static payload(app, settings = panelSettings(app.uiState.generatorSettings), { revision = GeneratorRevision.of(app.uiState), userRegions = null } = {}) {
        const mesh = app.meshSession.mesh;
        const { params } = MapStateManager.getDerivedMapParameters(app.uiState, app.customBiomeColors);
        return buildGeneratorPayload({
            mesh,
            buffers: { elevation: app.currentElevationData, moisture: app.currentMoistureData, temperature: app.currentTemperatureData, waterMask: app.bufferWaterMask, biomeOverrides: app.currentBiomeOverrides },
            seaLevel: app.uiState.seaLevel,
            kmPerPx: mesh.kmPerPx,
            riverData: app.currentRiverData,
            biomeParams: { customBiomeRules: params.customBiomeRules, biomePalette: params.biomePalette, biomeSides: params.biomeSides },
            customBiomes: app.uiState.customBiomes ?? [],
            mapSeed: app.uiState.mapSeed,
            settings: { seed: settings.seed || undefined, nameBase: settings.nameBase, world: settings.world, ages: settings.ages, cultures: app.uiState.cultures ?? [] },
            seats: this.seats(app),
            revision,
            userRegions,
        });
    }

    /**
     * The map's own realms, duchies and counties, which a run builds round (see UserRealms): the
     * regions of the Political set the run writes into (Regeneration.target) that a run keeps
     * (Regeneration.keptKeys: hand-made, edited or locked, and the rest of a realm holding one), so
     * what the model is given is what the map will show. Each level by depth as `{ key, cells,
     * independent }`, its cells the model cells whose land display cells it holds most of
     * (cells outside every such region of the level count too, so a region holding a sliver of a
     * model cell does not take it).
     *
     * Null when there are none, and when the set's levels are not the chain of levels the run makes
     * (see Regeneration.chain and GeneratorSettings.resolveOutput), since the run could not then
     * be written into it.
     * @param {object} app
     * @param {object} [output] - The run's output settings.
     * @returns {{realms: object[], duchies: object[], counties: object[]}|null}
     */
    static userRegions(app, output = {}) {
        const levels = this.#userLevels(app, output);
        if (!levels) return null;
        const session = app.meshSession;
        const kept = Regeneration.keptKeys(Regeneration.target(app));
        const [realms, duchies, counties] = [0, 1, 2].map((depth) => (levels[depth] ? this.#modelRegions(session, levels[depth], kept[depth]) : []));
        return realms.length || duchies.length || counties.length ? { realms, duchies, counties } : null;
    }

    /**
     * The user regions on the display mesh, for writing the run (see MaterialiseRegions): each
     * level of the target set by depth, its owners and the keys of the regions it keeps. Called
     * once the run's replaced regions are gone, so the target's regions are those it keeps.
     */
    static #userDisplay(app, output) {
        const levels = this.#userLevels(app, output);
        if (!levels) return null;
        return levels.map((level) => ({ owners: app.meshSession.layer(level.id).owners, keys: new Set(level.regions.map((region) => region.key)) }));
    }

    /** The target set's levels by depth, when they are the levels the run makes; null otherwise. */
    static #userLevels(app, output) {
        const session = app.meshSession;
        const set = Regeneration.target(app);
        const levels = Regeneration.chain(set);
        if (!session?.mesh || !session.aggregates || !levels) return null;
        const made = resolveOutput(output);
        const count = 1 + (made.duchies ? 1 : 0) + (made.counties ? 1 : 0);
        return levels.length === count ? levels : null;
    }

    /** A level's kept regions by model cell (see userRegions). */
    static #modelRegions(session, level, keys) {
        const { mesh, aggregates } = session;
        const owners = session.layer(level.id).owners;
        const NONE = -1;
        const ownerOf = (cell) => (keys.has(owners[cell]) ? owners[cell] : NONE);
        // Only the model cells some user region touches need a tally
        const tallies = new Map();
        for (let cell = 0; cell < mesh.cellCount; cell++) {
            if (aggregates.land[cell] === 1 && ownerOf(cell) !== NONE) tallies.set(mesh.parentOf[cell], new Map());
        }
        for (let cell = 0; cell < mesh.cellCount; cell++) {
            const tally = aggregates.land[cell] === 1 ? tallies.get(mesh.parentOf[cell]) : undefined;
            if (!tally) continue;
            const owner = ownerOf(cell);
            tally.set(owner, (tally.get(owner) ?? 0) + 1);
        }
        const cellsOf = new Map();
        for (const [modelCell, tally] of tallies) {
            let best = NONE;
            let most = 0;
            for (const [owner, n] of tally) {
                if (n > most || (n === most && owner < best)) {
                    best = owner;
                    most = n;
                }
            }
            if (best === NONE) continue;
            if (!cellsOf.has(best)) cellsOf.set(best, []);
            cellsOf.get(best).push(modelCell);
        }
        return level.regions.filter((region) => keys.has(region.key)).map((region) => ({ key: region.key, cells: (cellsOf.get(region.key) ?? []).sort((a, b) => a - b), independent: region.independent === true }));
    }

    /**
     * The map's settlement pins as seats a run must build on: every pin on the map whose style has
     * a settlement tier the world model makes (SEAT_KINDS), hand-placed or generated and kept
     * (edited or locked); a generated pin a run would replace is no seat. Each by the model cell
     * its display cell lies in, with the pin's point and whether it stands on land (see #onLand),
     * so a pin on a coast in a model cell the model counts as sea is built on the land beside it
     * (see Pipeline.seatsOf).
     * @param {object} app
     * @returns {{cell: number, kind: string, pin: string, x: number, y: number, land: boolean|null}[]}
     */
    static seats(app) {
        const session = app.meshSession;
        if (!session?.mesh) return [];
        const styles = new Map((app.uiState.customPinStyles ?? []).map((style) => [style.id, style]));
        const seats = [];
        for (const pin of app.mapPins ?? []) {
            if (pin.generated && !isKept(pin)) continue;
            const kind = styles.get(pin.pinStyle)?.tier;
            if (!SEAT_KINDS.has(kind) || !Number.isFinite(pin.x) || !Number.isFinite(pin.y)) continue;
            const display = session.cellAt(pin.x, pin.y);
            if (!(display >= 0)) continue;
            seats.push({ cell: session.mesh.parentOf[display], kind, pin: pin.id, x: pin.x, y: pin.y, land: this.#onLand(app, display, pin) });
        }
        return seats;
    }

    /**
     * Whether a settlement pin stands on land, for its seat (see Pipeline.seatsOf): its display
     * cell is land, or there is a land pixel within SEAT_SHORE_PX of its point. The second counts a
     * pin dropped just off a coast (its icon sits on the shore, its point in the water) as the
     * coastal settlement it plainly is. Null without the terrain to tell.
     */
    static #onLand(app, display, pin) {
        if (app.meshSession?.aggregates?.land[display] === 1) return true;
        const elevation = app.currentElevationData;
        const width = app.mapWidth ?? app.meshSession?.mesh?.width;
        if (!elevation || !width) return app.meshSession?.aggregates ? false : null;
        const height = elevation.length / width;
        const water = app.bufferWaterMask;
        const seaLevel = app.uiState.seaLevel;
        const cx = Math.floor(pin.x);
        const cy = Math.floor(pin.y);
        for (let y = Math.max(0, cy - SEAT_SHORE_PX); y <= Math.min(height - 1, cy + SEAT_SHORE_PX); y++) {
            for (let x = Math.max(0, cx - SEAT_SHORE_PX); x <= Math.min(width - 1, cx + SEAT_SHORE_PX); x++) {
                const pixel = y * width + x;
                if (elevation[pixel] >= seaLevel && !(water?.[pixel] > 0)) return true;
            }
        }
        return false;
    }

    /**
     * Writes a run's output onto the map as one undo step: what earlier runs made and the reader
     * has not kept is replaced (see Regeneration), and the run's regions go into the Political set
     * that remains (a new one when none does), with its routes, its pins (none on a kept pin's
     * cell), any style the run needed that the map lacked, and its model-cell outputs (app.modelRun).
     * @param {object} app
     * @param {object} result - A generator run.
     * @param {object} [output] - What to write (see GeneratorSettings.resolveOutput); all of it when left out.
     */
    static apply(app, result, output = {}) {
        const before = VectorHistory.snapshot(app);
        if (output.defaultStyles) this.resetStyles(app);
        this.#ensureLabelStyles(app);
        const removal = Regeneration.remove(app, { keepLatest: true });
        const session = app.meshSession;
        // The map's own regions the run was built round, as they stand once the rest has gone
        const userRegions = result.realms.some((realm) => realm.user !== undefined) || result.counties.some((county) => county.zone !== undefined) ? this.#userDisplay(app, output) : null;
        const runId = platform.utils.randomID();
        const made = materialise(session, result, {
            runId,
            idFactory: () => platform.utils.randomID(),
            layerSets: app.layerSets ?? [],
            names: this.#names(),
            watersPx: this.#watersPx(session.mesh.kmPerPx),
            routeStyleFor: this.routeStyleFinder(app),
            routeStyleFields: (style) => MapDialogManager.routeStyleFields(style),
            pinStyleFor: this.pinStyleFinder(app),
            applyPinStyle: (pin, style) => PinStyles.apply(app, pin, style),
            regionLabel: this.#regionLabels(app),
            output,
            userRegions,
        });
        const owners = removal.owners.map((entry) => VectorHistory.levelOwners(entry.levelId, entry.before, entry.after));
        const merged = removal.target ? Regeneration.merge(app, removal.target, made.set) : null;
        let set = made.set;
        if (merged) {
            set = removal.target;
            owners.push(...merged.map((entry) => VectorHistory.levelOwners(entry.levelId, entry.before, entry.after)));
        } else {
            // A kept set the run could not write into (its levels differ) goes if it was left empty
            if (removal.target?.levels.every((level) => level.regions.length === 0)) owners.push(...this.#dropSet(app, removal.target));
            for (const level of made.set.levels) for (const region of level.regions) delete region.standsFor;
            app.layerSets = [...(app.layerSets ?? []), made.set];
            session.setLayerSets(app.layerSets);
            owners.push(...made.set.levels.map((level) => VectorHistory.levelOwners(level.id, null, made.owners[level.id])));
        }
        app.mapRoutes.push(...made.routes);
        this.#writeSeats(app, made.seated ?? []);
        app.mapPins.push(...Regeneration.placesBeside(app, made.pins));
        const modelRunBefore = app.modelRun ?? null;
        const revisionBefore = GeneratorRevision.of(app.uiState);
        app.modelRun = encodeModelRun(result, runId);
        // From now on the map follows the rules it was generated with (see GeneratorRevision)
        app.uiState.generatorRevision = GeneratorRevision.ofPayload(result);
        app.uiState.generatorStale = false;
        app.activeLayerSetId = set.id;
        app.activeLevelId = set.levels[0].id;

        VectorHistory.push(app, VectorHistory.composite([before, ...owners, VectorHistory.modelRun(modelRunBefore, app.modelRun, { before: revisionBefore, after: app.uiState.generatorRevision })]));
        // The map is shown at the detail its scale leaves room for (a view setting, so not undone with the run)
        app.setDetailLevel?.(DetailLevel.forScale(session.mesh.kmPerPx), { repaint: false });
        app._repaintVectors();
        app.view?.render(["context"]);
        app.markDirty();
    }

    /**
     * What the run gave the places it built on settlement pins (see Generation.seats): a hand-placed
     * pin keeps them as `modelled` (it stays the reader's, never moved or removed by a run); a kept
     * generated pin has its generated figures refreshed, keeping its name, place and style.
     */
    static #writeSeats(app, seated) {
        const byId = new Map((app.mapPins ?? []).map((pin) => [pin.id, pin]));
        for (const { pins, figures } of seated) {
            for (const id of pins) {
                const pin = byId.get(id);
                if (!pin) continue;
                if (!pin.generated) {
                    pin.modelled = { ...figures };
                    continue;
                }
                const { tier: _tier, capital: _capital, fortified: _fortified, port: _port, ...refreshed } = figures;
                for (const key of ["mix", "ages", "formerCapital"]) delete pin.generated[key];
                Object.assign(pin.generated, refreshed);
            }
        }
    }

    /**
     * An empty Political set as a run makes one (its three levels, named and drawn as a run's; see
     * MaterialiseRegions.createPoliticalSet), with the label styles generated regions use added
     * when the map lacks them, so a later run writes into it and keeps its levels' looks. Not added
     * to the map: the caller does that, inside its own undo step.
     * @param {object} app
     * @returns {object}
     */
    static newPoliticalSet(app) {
        this.#ensureLabelStyles(app);
        return createPoliticalSet({ names: this.#names(), watersPx: this.#watersPx(app.meshSession.mesh.kmPerPx), idFactory: () => platform.utils.randomID() });
    }

    /** Removes a set and its levels' owner arrays; returns the undo entries that bring them back. */
    static #dropSet(app, set) {
        const session = app.meshSession;
        const entries = set.levels.map((level) => VectorHistory.levelOwners(level.id, session.removeLevelOwners(level.id), null));
        app.layerSets = app.layerSets.filter((each) => each !== set);
        session.setLayerSets(app.layerSets);
        return entries;
    }

    /** The localised words generated content is named with (title and castle name templates hold "{name}"). */
    static #names() {
        const word = (key) => platform.i18n.localize(key);
        return {
            set: word("FILRODENSWMB.UI.GeneratedPoliticalSet"),
            levels: [word("FILRODENSWMB.UI.GeneratedRealms"), word("FILRODENSWMB.UI.GeneratedDuchies"), word("FILRODENSWMB.UI.GeneratedCounties")],
            titles: { kingdom: word("FILRODENSWMB.UI.GeneratedKingdomTitle"), duchy: word("FILRODENSWMB.UI.GeneratedDuchyTitle"), county: word("FILRODENSWMB.UI.GeneratedCountyTitle") },
            castles: { castle: word("FILRODENSWMB.UI.GeneratedCastleName"), keep: word("FILRODENSWMB.UI.GeneratedKeepName"), hold: word("FILRODENSWMB.UI.GeneratedHoldName"), tower: word("FILRODENSWMB.UI.GeneratedTowerName") },
            formerCapital: word("FILRODENSWMB.UI.GeneratedFormerCapitalName"),
        };
    }

    /** The realms' territorial waters: MESH.CLAIM_KM in map pixels, on the level editor's step. */
    static #watersPx(kmPerPx) {
        const { STEP_PX, MAX_PX } = FILRODENSWMB.MESH.WATERS;
        const px = FILRODENSWMB.MESH.CLAIM_KM / kmPerPx;
        return Math.min(MAX_PX, Math.max(STEP_PX, Math.round(px / STEP_PX) * STEP_PX));
    }

    /**
     * Adds the label styles generated content uses (the political levels' and the settlement tiers')
     * from the defaults when the map lacks them, so pin styles that name them take their look.
     */
    static #ensureLabelStyles(app) {
        app.uiState.customLabelStyles ??= [];
        const styles = app.uiState.customLabelStyles;
        const wanted = new Set([...Object.values(FILRODENSWMB.GENERATOR.REGION_LABEL_STYLES), ...FILRODENSWMB.PINS.DEFAULT_STYLES.map((tier) => tier.labelStyle).filter(Boolean)]);
        for (const seed of FILRODENSWMB.LABELS.DEFAULT_STYLES) {
            if (!wanted.has(seed.id) || styles.some((style) => style.id === seed.id)) continue;
            const { nameKey, ...fields } = seed;
            styles.push({ ...fields, name: platform.i18n.localize(nameKey) });
        }
    }

    /** The label look of each political level's regions: its label style's fields, by kind. */
    static #regionLabels(app) {
        const styles = app.uiState.customLabelStyles ?? [];
        return (kind) => {
            const style = styles.find((candidate) => candidate.id === FILRODENSWMB.GENERATOR.REGION_LABEL_STYLES[kind]);
            return style ? { quickStyle: style.id, ...FieldSpecs.labelStyleFields(style) } : {};
        };
    }

    /** Finds (or adds from the defaults) the route style of a transport and class. */
    static routeStyleFinder(app) {
        app.uiState.customRouteStyles ??= [];
        const styles = app.uiState.customRouteStyles;
        return (transport, routeClass) => {
            const id = FILRODENSWMB.GENERATOR.ROUTE_STYLES[transport]?.[routeClass];
            if (!id) return null;
            let style = styles.find((candidate) => candidate.id === id);
            if (style) return style;
            const seed = FILRODENSWMB.ROUTES.DEFAULT_STYLES.find((candidate) => candidate.id === id);
            if (!seed) return null;
            const { nameKey, ...fields } = seed;
            style = { ...fields, name: platform.i18n.localize(nameKey) };
            styles.push(style);
            return style;
        };
    }

    /**
     * Finds (or adds from the defaults) the pin style of a tier: the style marked with the tier;
     * failing that, a style of a map made before styles were marked, recognised by its default
     * icon, which is marked now; failing that, the default style, added.
     */
    static pinStyleFinder(app) {
        PinStyles.ensure(app);
        const styles = app.uiState.customPinStyles;
        const defaults = PinStyles.defaults();
        return (tier) => {
            const found = this.#tierStyle(styles, tier);
            if (found) return found;
            const seed = defaults.find((style) => style.tier === tier);
            if (!seed) return null;
            styles.push(seed);
            return seed;
        };
    }

    /**
     * The map's pin style of a tier: the one marked with it, or failing that one of a map made
     * before styles were marked, recognised by the tier's default icon (and marked now); null when
     * there is neither.
     */
    static #tierStyle(styles, tier) {
        const marked = styles.find((style) => style.tier === tier);
        if (marked) return marked;
        // Only the older tiers (on the plain default colour) can be on a map from before marking
        const seed = FILRODENSWMB.PINS.DEFAULT_STYLES.find((candidate) => candidate.tier === tier);
        const icon = seed && !seed.color ? seed.icon : null;
        const unmarked = icon ? styles.find((style) => !style.tier && style.icon === icon) : null;
        if (unmarked) unmarked.tier = tier;
        return unmarked ?? null;
    }

    /**
     * Whether the map's settlement pin styles are still one of the module's older default sets
     * (GENERATOR.OLDER_PIN_SCALES), which suit an earlier scale: the Generate panel then starts
     * with Use the default styles on.
     * @param {object} app
     * @returns {boolean}
     */
    static stylesLookOlder(app) {
        const styles = app.uiState.customPinStyles ?? [];
        const MATCH = 1e-6;
        return FILRODENSWMB.GENERATOR.OLDER_PIN_SCALES.some((set) => {
            const compared = Object.entries(set).map(([tier, scale]) => {
                const style = styles.find((candidate) => candidate.tier === tier) ?? styles.find((candidate) => !candidate.tier && candidate.icon === FILRODENSWMB.PINS.DEFAULT_STYLES.find((seed) => seed.tier === tier)?.icon);
                return style ? Math.abs(style.scale - scale) < MATCH : null;
            });
            const found = compared.filter((match) => match !== null);
            return found.length >= FILRODENSWMB.GENERATOR.OLDER_PIN_SCALES_MIN && found.every(Boolean);
        });
    }

    /**
     * Use the default styles: the styles generated content takes (the settlement tiers' pin
     * styles, the political levels' and settlements' label styles, and the generated route styles)
     * are set back to the module's defaults, keeping their names, and everything that follows them
     * takes their new look. Part of the run's undo step.
     * @param {object} app
     */
    static resetStyles(app) {
        const config = MapDialogManager.QUICK_STYLE_CONFIG;
        const reset = (style, fields, type) => {
            Object.assign(style, fields);
            config[type].onCascade(app, style.id, style);
        };
        const labelIds = new Set([...Object.values(FILRODENSWMB.GENERATOR.REGION_LABEL_STYLES), ...FILRODENSWMB.PINS.DEFAULT_STYLES.map((tier) => tier.labelStyle).filter(Boolean)]);
        for (const { id, nameKey: _name, ...fields } of FILRODENSWMB.LABELS.DEFAULT_STYLES) {
            const style = labelIds.has(id) ? (app.uiState.customLabelStyles ?? []).find((candidate) => candidate.id === id) : null;
            if (style) reset(style, fields, "Label");
        }
        const routeIds = new Set(Object.values(FILRODENSWMB.GENERATOR.ROUTE_STYLES).flatMap((byClass) => Object.values(byClass)));
        for (const { id, nameKey: _name, ...fields } of FILRODENSWMB.ROUTES.DEFAULT_STYLES) {
            const style = routeIds.has(id) ? (app.uiState.customRouteStyles ?? []).find((candidate) => candidate.id === id) : null;
            if (style) reset(style, fields, "Route");
        }
        const styles = app.uiState.customPinStyles ?? [];
        const generatedTiers = new Set(Object.values(FILRODENSWMB.GENERATOR.PIN_TIERS));
        for (const { id: _id, name: _name, ...fields } of PinStyles.defaults()) {
            const style = generatedTiers.has(fields.tier) ? this.#tierStyle(styles, fields.tier) : null;
            if (style) reset(style, fields, "Pin");
        }
    }
}

/** The run's stages, in order; writing onto the map follows them under its own name. */
const STAGES = FILRODENSWMB.GENERATOR.STAGES;
const MATERIALISE_STAGE = "materialise";
const FULL = 100;

/** Resolves once the window has painted (so the overlay shows a new line before blocking work). */
function nextPaint() {
    const frame = globalThis.requestAnimationFrame;
    if (!frame) return Promise.resolve();
    return new Promise((resolve) => frame(() => setTimeout(resolve, 0)));
}

/**
 * The overlay while a run works: the stage and percentage as its title, a bar showing how far it
 * has come, and a light-hearted line under it that changes every QUIP_MS (see GENERATOR.QUIPS).
 */
class RunProgress {
    #overlay;
    #format;
    #timer = null;
    #quip;

    constructor(overlay, format) {
        this.#overlay = overlay;
        this.#format = format;
        const { QUIPS, QUIP_MS } = FILRODENSWMB.GENERATOR;
        this.#quip = 0;
        this.#showQuip();
        this.#timer = setInterval(() => {
            this.#quip = (this.#quip + 1) % QUIPS.length;
            this.#showQuip();
        }, QUIP_MS);
    }

    update(stage, pct, age = null, ages = null) {
        this.#overlay?.text(this.#format(stage, pct, age, ages));
        this.#overlay?.progress?.(pct / FULL);
    }

    stop() {
        clearInterval(this.#timer);
        this.#overlay?.detail?.(null);
        this.#overlay?.progress?.(null);
    }

    #showQuip() {
        this.#overlay?.detail?.(platform.i18n.localize(FILRODENSWMB.GENERATOR.QUIPS[this.#quip]));
    }
}
