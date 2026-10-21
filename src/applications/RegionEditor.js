import { FILRODENSWMB } from "../config.js";
import { Inspector } from "./Inspector.js";
import { InspectorFields } from "./InspectorFields.js";
import { MapStateManager } from "./MapStateManager.js";
import { MeshIntegration } from "./MeshIntegration.js";
import { RegionPanel } from "./RegionPanel.js";
import { regionFillColor } from "../mesh/Schema.js";
import { platform } from "../platform/index.js";
import { typed } from "../data/MapRules.js";

/** The fill patterns a region can have, with their names. */
const PATTERNS = Object.freeze({ solid: "FILRODENSWMB.UI.StyleSolid", diagonal: "FILRODENSWMB.UI.StyleDiagonalHatch", crosshatch: "FILRODENSWMB.UI.StyleCrossHatch" });

/** The fill fields a region style sets, by their names in the form. */
const FILL_FIELDS = Object.freeze({ regionFillColor: true, regionFillTransparent: true, regionFillStyle: true });

/**
 * A region in the inspector (see Inspector): its name, description and visibility, its fill (a
 * region style, or its own colour and pattern), its label, and Focus view, Merge into… and Delete.
 *
 * Opening it makes its region the one being painted, so the paint goes into the region whose
 * details are showing. A region without a fill of its own is drawn in its level's preset colour,
 * which the inspector shows as its colour, so changing anything else keeps its look.
 */
export class RegionEditor {
    /**
     * Opens the inspector on a region.
     * @param {object} app
     * @param {string} levelId
     * @param {string} regionId
     * @returns {Promise<boolean>}
     */
    static open(app, levelId, regionId, options) {
        return Inspector.open(app, this.KIND, { levelId, id: regionId }, options);
    }

    static #find(app, { levelId, id }) {
        return app.regionLevels.find((level) => level.id === levelId)?.regions.find((candidate) => candidate.id === id) ?? null;
    }

    /** The region's kind of inspector. */
    static KIND = Object.freeze({
        id: "region",
        template: "modules/filrodens-world-map-builder/templates/parts/inspector-region.hbs",
        find: (app, ref) => RegionEditor.#find(app, ref),
        opened: (app, _region, ref) => RegionPanel.selectRegionById(app, ref.levelId, ref.id),
        header: (app, region, ref) => ({
            title: region.name,
            subtitle: platform.i18n.format("FILRODENSWMB.UI.InspectorSubtitleRegion", { level: app.regionLevels.find((level) => level.id === ref.levelId)?.name ?? "" }),
            swatch: region.fillColor === "transparent" ? null : regionFillColor(region),
        }),
        context: (app, region) => RegionEditor.#context(app, region),
        apply: (app, region, ref, form, field) => RegionEditor.#apply(app, region, form, field),
        actions: {
            zoom: (app, region) => {
                const points = MeshIntegration.outlinePoints(app, region);
                if (points.length) app.canvasEngine?.zoomToFeature(points);
            },
            merge: (app, _region, ref) => RegionPanel.mergeRegion(app, ref.levelId, ref.id),
            delete: (app, _region, ref) => RegionPanel.deleteRegion(app, ref.levelId, ref.id),
            saveStyle: (app, region, ref, button) => RegionEditor.#saveStyle(app, region, button.dataset.styleType),
        },
    });

    static #context(app, region) {
        const fill = regionFillColor(region);
        const noFill = region.fillColor === "transparent";
        const label = InspectorFields.label(app, region);
        return {
            region,
            visibilities: RegionPanel.visibilityChoices(region.visibility),
            fillStyles: InspectorFields.styleChoices(app.uiState.customRegionStyles, region.quickStyle),
            fillStyleName: InspectorFields.styleName(app.uiState.customRegionStyles, region.quickStyle),
            fillHex: noFill || !fill ? "#000000" : fill,
            noFill,
            patterns: Object.entries(PATTERNS).map(([value, labelKey]) => ({ value, label: labelKey, selected: value === (region.fillStyle ?? "solid") })),
            label,
            labelChoices: InspectorFields.labelChoices(app, label),
            labelStyleName: InspectorFields.styleName(app.uiState.customLabelStyles, label.quickStyle),
            labelVisibilities: RegionPanel.visibilityChoices(label.visibility),
            palette: FILRODENSWMB.LABELS?.PRESETS || [],
        };
    }

    /** What the form holds, as region fields, once `field` has taken effect (see InspectorFields). */
    static read(app, region, form, field) {
        const elements = form.elements;
        const values = {
            name: elements.regionName.value.trim() || region.name,
            description: elements.regionDesc.value,
            visibility: elements.regionVisibility.value,
            quickStyle: elements.regionQuickStyle.value,
            fillColor: elements.regionFillTransparent.checked ? "transparent" : elements.regionFillColor.value,
            fillStyle: elements.regionFillStyle.value,
        };
        InspectorFields.settleStyle(values, field, {
            pickerField: "regionQuickStyle",
            styledFields: FILL_FIELDS,
            styles: app.uiState.customRegionStyles,
            fields: InspectorFields.STYLE_TYPES.Region.fields,
            key: "quickStyle",
        });
        values.label = InspectorFields.readLabel(form, field, app);
        return values;
    }

    /** Applies the form to the region as one undo step, when anything changed. */
    static #apply(app, region, form, field) {
        // Checked as an import is (see MapRules.typed): a value that fails its rule keeps the region's own
        const values = typed("region", this.read(app, region, form, field), region);
        // A region drawn in its preset colour holds no fill of its own until one is given
        const current = { ...region, fillColor: region.fillColor ?? regionFillColor(region), fillStyle: region.fillStyle ?? "solid", label: InspectorFields.label(app, region) };
        if (!InspectorFields.differs(current, values)) return false;
        MapStateManager.pushVectorState(app);
        const { label, ...fields } = values;
        Object.assign(region, fields);
        region.label = { ...region.label, ...label };
        this.#redraw(app);
        return true;
    }

    /** Save as…: a region style from the region's fill, or a label style from its label. */
    static async #saveStyle(app, region, type) {
        const source = type === "Label" ? InspectorFields.label(app, region) : { fillColor: region.fillColor ?? regionFillColor(region), fillStyle: region.fillStyle ?? "solid" };
        const id = await InspectorFields.saveStyleAs(app, type, source);
        if (!id) return;
        if (type === "Label") region.label = { ...source, ...region.label, quickStyle: id };
        else Object.assign(region, source, { quickStyle: id });
        this.#redraw(app);
    }

    static #redraw(app) {
        app._repaintVectors();
        app.view?.render(["context", "editToolbar"]);
        app.markDirty();
    }
}
