import { FILRODENSWMB } from "../config.js";
import { generateInBackground } from "../generator/Generate.js";
import { buildGeneratorPayload } from "../generator/GeneratorInput.js";
import { materialise } from "../generator/Materialise.js";
import { panelSettings } from "../generator/GeneratorSettings.js";
import { encodeModelRun } from "../generator/ModelRun.js";
import { platform } from "../platform/index.js";
import { DetailLevel } from "./DetailLevel.js";
import { FieldSpecs } from "./FieldSpecs.js";
import { MapDialogManager } from "./MapDialogManager.js";
import { MapStateManager } from "./MapStateManager.js";
import { PinStyles } from "./PinStyles.js";
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
        const progress = new RunProgress(overlay, (stage, pct) => this.#stageText(stage, pct));
        try {
            const result = await generateInBackground(() => this.payload(app, settings), { signal, onProgress: ({ stage, pct }) => progress.update(stage, pct) }).catch((error) => {
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

    /** The progress line: the stage's name and how far the run has come. */
    static #stageText(stage, pct) {
        return platform.i18n.format("FILRODENSWMB.UI.GenerateProgress", { stage: platform.i18n.localize(`FILRODENSWMB.UI.GenerateStage${stage.charAt(0).toUpperCase()}${stage.slice(1)}`), pct: Math.round(pct) });
    }

    /**
     * Before a run on a map that already holds generated content: a confirmation giving what is
     * there, since the new run is added beside it. True to go ahead (or when there is nothing).
     */
    static async #confirmAgain(app) {
        const counts = this.counts(app);
        if (!counts.realms && !counts.places && !counts.routes) return true;
        const shown = Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, value.toLocaleString(platform.i18n.lang)]));
        return MapDialogManager._confirmDialog(platform.i18n.localize("FILRODENSWMB.UI.GenerateAgainTitle"), platform.i18n.format("FILRODENSWMB.UI.GenerateAgainMessage", shown));
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
     * may be moved to the worker.
     * @param {object} app
     * @param {object} [settings]
     */
    static payload(app, settings = panelSettings(app.uiState.generatorSettings)) {
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
            settings: { seed: settings.seed || undefined, nameBase: settings.nameBase, world: settings.world },
        });
    }

    /**
     * Adds a run's output to the map as one undo step: the Political set and its levels' owner
     * arrays, the routes, the pins, any style the run needed that the map lacked, and the run's
     * model-cell outputs (app.modelRun).
     * @param {object} app
     * @param {object} result - A generator run.
     * @param {object} [output] - What to write (see GeneratorSettings.resolveOutput); all of it when left out.
     */
    static apply(app, result, output = {}) {
        const before = VectorHistory.snapshot(app);
        if (output.defaultStyles) this.resetStyles(app);
        this.#ensureLabelStyles(app);
        const session = app.meshSession;
        const runId = platform.utils.randomID();
        const made = materialise(session, result, {
            runId,
            idFactory: () => platform.utils.randomID(),
            layerSets: app.layerSets ?? [],
            names: this.#names(),
            watersPx: this.#watersPx(session.mesh.kmPerPx),
            routeStyleFor: this.#routeStyleFinder(app),
            routeStyleFields: (style) => MapDialogManager.routeStyleFields(style),
            pinStyleFor: this.#pinStyleFinder(app),
            applyPinStyle: (pin, style) => PinStyles.apply(app, pin, style),
            regionLabel: this.#regionLabels(app),
            output,
        });
        app.layerSets = [...(app.layerSets ?? []), made.set];
        session.setLayerSets(app.layerSets);
        app.mapRoutes.push(...made.routes);
        app.mapPins.push(...made.pins);
        const modelRunBefore = app.modelRun ?? null;
        app.modelRun = encodeModelRun(result, runId);
        app.uiState.generatorStale = false;
        app.activeLayerSetId = made.set.id;
        app.activeLevelId = made.set.levels[0].id;

        const levels = made.set.levels.map((level) => VectorHistory.levelOwners(level.id, null, made.owners[level.id]));
        VectorHistory.push(app, VectorHistory.composite([before, ...levels, VectorHistory.modelRun(modelRunBefore, app.modelRun)]));
        // The map is shown at the detail its scale leaves room for (a view setting, so not undone with the run)
        app.setDetailLevel?.(DetailLevel.forScale(session.mesh.kmPerPx), { repaint: false });
        app._repaintVectors();
        app.view?.render(["context"]);
        app.markDirty();
    }

    /** The localised words generated content is named with (title and castle name templates hold "{name}"). */
    static #names() {
        const word = (key) => platform.i18n.localize(key);
        return {
            set: word("FILRODENSWMB.UI.GeneratedPoliticalSet"),
            levels: [word("FILRODENSWMB.UI.GeneratedRealms"), word("FILRODENSWMB.UI.GeneratedDuchies"), word("FILRODENSWMB.UI.GeneratedCounties")],
            titles: { kingdom: word("FILRODENSWMB.UI.GeneratedKingdomTitle"), duchy: word("FILRODENSWMB.UI.GeneratedDuchyTitle"), county: word("FILRODENSWMB.UI.GeneratedCountyTitle") },
            castles: { castle: word("FILRODENSWMB.UI.GeneratedCastleName"), keep: word("FILRODENSWMB.UI.GeneratedKeepName"), hold: word("FILRODENSWMB.UI.GeneratedHoldName"), tower: word("FILRODENSWMB.UI.GeneratedTowerName") },
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
    static #routeStyleFinder(app) {
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
    static #pinStyleFinder(app) {
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
        const icon = FILRODENSWMB.PINS.DEFAULT_STYLES.find((seed) => seed.tier === tier)?.icon;
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

    update(stage, pct) {
        this.#overlay?.text(this.#format(stage, pct));
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
