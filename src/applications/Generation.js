import { FILRODENSWMB } from "../config.js";
import { generateInBackground } from "../generator/Generate.js";
import { buildGeneratorPayload } from "../generator/GeneratorInput.js";
import { materialise } from "../generator/Materialise.js";
import { encodeModelRun } from "../generator/ModelRun.js";
import { platform } from "../platform/index.js";
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
     * Runs the generator with the given settings (the defaults when none) and adds its output to
     * the map. Does nothing while the map's mesh or terrain is not ready, or when other cancellable
     * work is under way.
     * @param {object} app - The studio.
     * @param {object} [settings] - See GeneratorSettings.
     * @returns {Promise<boolean>} Whether content was added.
     */
    static async run(app, settings = {}) {
        if (!app.meshSession?.aggregates || !app.currentElevationData) {
            platform.notify.warn(platform.i18n.localize("FILRODENSWMB.UI.GenerateNotReady"));
            return false;
        }
        let result;
        try {
            result = await app.runCancellable(this.#progressText(0), (signal, overlay) =>
                generateInBackground(() => this.payload(app, settings), { signal, onProgress: ({ pct }) => overlay?.text(this.#progressText(pct)) }).catch((error) => {
                    if (error?.name === "AbortError") return null;
                    throw error;
                }),
            );
        } catch (error) {
            console.error("FWMB | Generation failed:", error);
            platform.notify.error(platform.i18n.localize("FILRODENSWMB.UI.GenerateFailed"));
            return false;
        }
        if (!result) return false;
        this.apply(app, result);
        return true;
    }

    static #progressText(pct) {
        return platform.i18n.format("FILRODENSWMB.UI.GeneratingWorld", { pct });
    }

    /**
     * The generator's input from the open map (see GeneratorInput). Every array is a copy, so it
     * may be moved to the worker.
     * @param {object} app
     * @param {object} [settings]
     */
    static payload(app, settings = {}) {
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
            settings,
        });
    }

    /**
     * Adds a run's output to the map as one undo step: the Political set and its levels' owner
     * arrays, the routes, the pins, any style the run needed that the map lacked, and the run's
     * model-cell outputs (app.modelRun).
     * @param {object} app
     * @param {object} result - A generator run.
     */
    static apply(app, result) {
        const before = VectorHistory.snapshot(app);
        this.#ensureLabelStyles(app);
        const session = app.meshSession;
        const runId = platform.utils.randomID();
        const output = materialise(session, result, {
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
        });
        app.layerSets = [...(app.layerSets ?? []), output.set];
        session.setLayerSets(app.layerSets);
        app.mapRoutes.push(...output.routes);
        app.mapPins.push(...output.pins);
        const modelRunBefore = app.modelRun ?? null;
        app.modelRun = encodeModelRun(result, runId);
        app.uiState.generatorStale = false;
        app.activeLayerSetId = output.set.id;
        app.activeLevelId = output.set.levels[0].id;

        const levels = output.set.levels.map((level) => VectorHistory.levelOwners(level.id, null, output.owners[level.id]));
        VectorHistory.push(app, VectorHistory.composite([before, ...levels, VectorHistory.modelRun(modelRunBefore, app.modelRun)]));
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
            const marked = styles.find((style) => style.tier === tier);
            if (marked) return marked;
            const seed = defaults.find((style) => style.tier === tier);
            if (!seed) return null;
            const unmarked = styles.find((style) => !style.tier && style.icon === seed.icon);
            if (unmarked) {
                unmarked.tier = tier;
                return unmarked;
            }
            styles.push(seed);
            return seed;
        };
    }
}
