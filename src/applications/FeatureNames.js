import { FILRODENSWMB } from "../config.js";
import { FEATURE_KINDS, findFeatures, fitLabel, footprintCell, footprintHas, footprintOf, matchFeatures, samplePoints } from "../names/FeatureDetection.js";
import { placeName } from "../names/PlaceNames.js";
import { modelBiomeRaster } from "../generator/ModelBiomes.js";
import { LabelWidth } from "../tools/LabelWidth.js";
import { SymbolScale } from "../tools/SymbolScale.js";
import { platform } from "../platform/index.js";
import { FieldSpecs } from "./FieldSpecs.js";
import { MapStateManager } from "./MapStateManager.js";
import { RandomNames } from "./RandomNames.js";

const { FEATURE_NAMES } = FILRODENSWMB;

/** The geographic label styles' ids, and the family's seeds (see LABELS.DEFAULT_STYLES). */
const FAMILY = new Set(Object.values(FEATURE_NAMES.STYLES));
const SEEDS = FILRODENSWMB.LABELS.DEFAULT_STYLES.filter((style) => FAMILY.has(style.id));

/** The last run's report, by studio (shown in the Labels panel while the map is open). */
const reports = new WeakMap();

/**
 * Name natural features, in the Labels tool: finds the map's features from its terrain (see
 * FeatureDetection) and names each with a standalone label in its geographic label style, fitted
 * inside it. A label it makes carries a `feature` record: the feature's kind, its footprint (to
 * find it again) and what the label was given (its place, turn, size, text and style).
 *
 * Running it again (after a terrain change, say) matches each feature found to the labels an
 * earlier run made (see FeatureDetection.matchFeatures):
 * - a label the reader has not changed is placed again on its feature, keeping its name;
 * - a label the reader moved, turned, resized, renamed or restyled is edited, and kept as it is;
 * - a label whose feature is no longer found stays, and is counted in the report;
 * - a feature not yet labelled is labelled, unless a label in one of the geographic styles
 *   already lies inside it (the reader's own name for it).
 *
 * The first run on a map adds the geographic styles it lacks, and retires the old Water style:
 * labels in it become Custom, keeping their look, and the style goes. One undo step.
 */
export class FeatureNames {
    /** The last run's report for the Labels panel, or null. */
    static lastReport(app) {
        return reports.get(app) ?? null;
    }

    /** Forgets the last run's report, as another map opens or a new one starts. */
    static forget(app) {
        reports.delete(app);
    }

    /**
     * The map's rasters, as FeatureDetection reads them, or null while its terrain is not ready.
     * @param {object} app
     */
    static inputs(app) {
        const { currentElevationData: elev, currentMoistureData: moisture, currentTemperatureData: temperature, bufferWaterMask: waterMask } = app;
        if (!elev || !moisture || !temperature || !waterMask || !app.mapWidth || !app.mapHeight) return null;
        const { params } = MapStateManager.getDerivedMapParameters(app.uiState, app.customBiomeColors ?? {});
        const biome = modelBiomeRaster({
            elevation: elev,
            moisture,
            temperature,
            waterMask,
            biomeOverrides: app.currentBiomeOverrides,
            seaLevel: params.seaLevel,
            biomeParams: { customBiomeRules: params.customBiomeRules, biomePalette: params.biomePalette, biomeSides: params.biomeSides },
            customBiomes: app.uiState.customBiomes ?? [],
        });
        const lake = new Uint8Array(elev.length);
        for (let i = 0; i < lake.length; i++) lake[i] = waterMask[i] > 0 ? 1 : 0;
        const flows = app.currentRiverData?.network?.flows;
        const rivers = (app.currentRiverData?.vectors ?? []).map((river) => ({
            id: river.id,
            path: (river.path ?? []).map((point) => [point.x, point.y, point.isLake ? 1 : 0]),
            flow: flows?.get(river.id) ? Array.from(flows.get(river.id)) : null,
        }));
        return { W: app.mapWidth, H: app.mapHeight, elev, moisture, lake, biome, seaLevel: params.seaLevel, rivers };
    }

    /**
     * The action, from the Labels panel: finds and names the map's features as one undo step, and
     * reports what it did.
     * @returns {Promise<object|null>} The report, or null when the terrain is not ready.
     */
    static async run(app) {
        const map = this.inputs(app);
        if (!map) {
            platform.notify.warn(platform.i18n.localize("FILRODENSWMB.UI.FeatureNamesNotReady"));
            return null;
        }
        platform.notify.info(platform.i18n.localize("FILRODENSWMB.UI.FeatureNamesWorking"));
        // Let the notice show before the work, which takes a second or two on a large map
        await new Promise((resolve) => setTimeout(resolve, 0));
        const report = this.apply(app, map);
        reports.set(app, report);
        app._repaintVectors?.();
        app.view?.render(["context"]);
        app.markDirty?.();
        platform.notify.info(platform.i18n.format("FILRODENSWMB.UI.FeatureNamesDone", report));
        return report;
    }

    /**
     * Finds the features of `map` (see inputs) and names them on the map, as one undo step.
     * @returns {{added: number, replaced: number, kept: number, gone: number, skipped: number, retired: number}}
     */
    static apply(app, map) {
        const cell = footprintCell(map.W, map.H);
        // Which rivers have room for a name is judged at the usual character width, not the face's
        // measured one, so a face still loading never changes which rivers are found
        const riverName = this.#sizePx(app, this.#style(app, "river").fontSize) * FEATURE_NAMES.CHAR_RATIO * FEATURE_NAMES.RIVER_NAME_CHARACTERS;
        const features = findFeatures(map, { riverLabelLength: () => riverName });
        for (const feature of features) feature.footprint = footprintOf(feature, cell);

        MapStateManager.pushVectorState(app);
        const retired = this.#ensureStyles(app);
        app.mapLabels ??= [];
        const made = app.mapLabels.filter((label) => label.feature && FEATURE_KINDS[label.feature.kind]);
        const matched = matchFeatures(features, made.map((label) => ({ kind: label.feature.kind, footprint: label.feature })), FEATURE_NAMES.MATCH);
        const report = { added: 0, replaced: 0, kept: 0, gone: made.length - matched.size, skipped: 0, retired };
        // The reader's own names in the family: a feature with one inside it is left to it
        const own = app.mapLabels.filter((label) => !label.feature && FAMILY.has(label.quickStyle));
        // A new name is not one the map's labels already have
        const used = new Set(app.mapLabels.map((label) => label.name));

        features.forEach((feature, index) => {
            const label = matched.has(index) ? made[matched.get(index)] : null;
            if (label) {
                if (this.edited(label)) report.kept += 1;
                else {
                    // A feature that is now of another kind (a sea become part of the ocean) takes that kind's name
                    this.#place(app, label, feature, label.feature.kind === feature.kind ? label.name : this.#name(app, feature, label.id, used));
                    report.replaced += 1;
                }
                return;
            }
            const style = FEATURE_NAMES.STYLES[FEATURE_KINDS[feature.kind].style];
            if (own.some((other) => other.quickStyle === style && footprintHas(feature.footprint, other.x, other.y))) {
                report.skipped += 1;
                return;
            }
            const created = { id: platform.utils.randomID(), visibility: "all" };
            const name = this.#name(app, feature, created.id, used);
            this.#place(app, created, feature, name);
            app.mapLabels.push(created);
            report.added += 1;
        });
        return report;
    }

    /**
     * Whether the reader has changed a feature label since the action placed it: its place, turn,
     * size, text or style.
     */
    static edited(label) {
        const given = label.feature;
        if (!given) return true;
        const near = (a, b) => Math.abs((a ?? 0) - (b ?? 0)) < 0.5;
        return !near(label.x, given.x) || !near(label.y, given.y) || !near(label.rotation, given.rotation) || label.fontSize !== given.fontSize || label.name !== given.text || label.quickStyle !== given.style;
    }

    /**
     * A feature's name: its kind's form, in the language of the people living there, unlike any in
     * `used` (rerolled a few times, as Name all does), which it joins.
     */
    static #name(app, feature, labelId, used) {
        const cells = [];
        for (const point of samplePoints(feature)) {
            const at = app.meshSession?.cellAt(point.x, point.y) ?? -1;
            if (at >= 0) cells.push(at);
        }
        const nameBase = RandomNames.nameBaseAt(app, cells);
        const descriptor = { forms: (FEATURE_NAMES.FORMS[feature.kind] ?? []).map((form) => platform.i18n.localize(form)), always: true, short: true };
        const draw = (roll) => placeName({ mapSeed: String(app.uiState?.mapSeed ?? ""), itemId: labelId, roll, nameBase, descriptor });
        let name = draw(0);
        for (let roll = 1; roll <= FILRODENSWMB.PLACE_NAMES.RETRIES && used.has(name); roll++) name = draw(roll);
        used.add(name);
        return name;
    }

    /**
     * Writes a feature's label: its text, its group's style, its place and turn fitted inside the
     * feature (a river along its stretch), and the record of what it was given.
     */
    static #place(app, label, feature, name) {
        const style = this.#style(app, FEATURE_KINDS[feature.kind].style);
        let { x, y, angle } = feature.label;
        if (feature.cells) {
            const px = this.#sizePx(app, style.fontSize);
            const water = FEATURE_KINDS[feature.kind].match === "water";
            const fitted = fitLabel(feature.cells, feature.grid, app.mapWidth, app.mapHeight, this.#textWidth(app, name, style), px * 1.2, { maxAngle: water ? FEATURE_NAMES.MAX_ANGLE.water : FEATURE_NAMES.MAX_ANGLE.land });
            ({ x, y, angle } = fitted);
        }
        const round = (value) => Math.round(value * 10) / 10;
        Object.assign(label, FieldSpecs.labelStyleFields(style), { name, quickStyle: style.id, x: round(x), y: round(y), rotation: round(angle) });
        label.feature = { kind: feature.kind, ...feature.footprint, x: label.x, y: label.y, rotation: label.rotation, fontSize: label.fontSize, text: name, style: style.id };
    }

    /** A group's geographic style on the map (or its seed, before the map has it). */
    static #style(app, group) {
        const id = FEATURE_NAMES.STYLES[group];
        const style = (app.uiState.customLabelStyles ?? []).find((candidate) => candidate.id === id) ?? SEEDS.find((seed) => seed.id === id);
        return { ...style, id };
    }

    /** A label size's height in map pixels, as the canvas draws it (see StudioCanvas#labelText). */
    static #sizePx(app, fontSize) {
        const scale = (Math.max(app.mapWidth, app.mapHeight) / FILRODENSWMB.LIMITS.BASELINE_DIMENSION) * SymbolScale.of(app.uiState, app.mapWidth, app.mapHeight);
        return (fontSize || FILRODENSWMB.LABELS.UNSET_SIZE) * FILRODENSWMB.SYMBOLS.UNIT * LabelWidth.rootFontSize() * scale;
    }

    /** A name's width in map pixels, in a style: its characters at the face's measured width. */
    static #textWidth(app, text, style) {
        let ratio = FEATURE_NAMES.CHAR_RATIO;
        try {
            ratio = LabelWidth.charRatio(style.fontFamily, `${style.italic ? "italic " : ""}${style.bold ? "bold" : "normal"}`) || ratio;
        } catch {
            // A host that cannot measure (no canvas) keeps the usual share
        }
        return text.length * this.#sizePx(app, style.fontSize) * ratio;
    }

    /**
     * Gives the map the geographic styles it lacks, and retires the Water style: labels in it
     * (standalone and owned) take its look as their own and become Custom, and it leaves the
     * map's styles. Returns how many labels were changed.
     */
    static #ensureStyles(app) {
        const styles = (app.uiState.customLabelStyles ??= []);
        for (const { nameKey, ...seed } of SEEDS) if (!styles.some((style) => style.id === seed.id)) styles.push({ ...seed, name: platform.i18n.localize(nameKey) });
        const water = styles.find((style) => style.id === FEATURE_NAMES.RETIRED_STYLE);
        if (!water) return 0;
        let retired = 0;
        const retire = (label) => {
            if (label?.quickStyle !== water.id) return;
            Object.assign(label, FieldSpecs.labelStyleFields(water), { quickStyle: "custom" });
            retired += 1;
        };
        for (const label of app.mapLabels ?? []) retire(label);
        for (const owner of [...(app.mapPins ?? []), ...(app.mapRoutes ?? []), ...(app.regionLevels ?? []).flatMap((level) => level.regions)]) retire(owner.label);
        app.uiState.customLabelStyles = styles.filter((style) => style !== water);
        return retired;
    }
}
