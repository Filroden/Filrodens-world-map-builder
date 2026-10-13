import { FILRODENSWMB } from "../config.js";
import { MapDialogManager } from "./MapDialogManager.js";
import { MapStateManager } from "./MapStateManager.js";
import { RegionPanel } from "./RegionPanel.js";
import { regionFillColor } from "../mesh/Schema.js";
import { platform } from "../platform/index.js";

const TEMPLATE = "modules/filrodens-world-map-builder/templates/dialogs/edit-regions.hbs";

/**
 * The region editor: a region's name, description, visibility, fill (its own colour and pattern,
 * or a region quick style) and label, with Delete and Merge Into beside Cancel and Save.
 *
 * It is docked along the edge of the studio rather than modal, so the map can be painted, panned
 * and zoomed while it is open. One region is edited at a time: opening another region's editor
 * closes the one open (discarding its unsaved changes, as Cancel would), and switching tool closes
 * it too. Opening it makes its region the region being edited, so painting goes into the region
 * whose details are showing.
 *
 * Nothing changes until Save, which is one undo step. The region is looked up again when the
 * editor closes, since it may have been deleted (by an undo, say) while the editor was open.
 */
export class RegionEditor {
    /**
     * Opens the editor for a region.
     * @param {object} app
     * @param {string} levelId
     * @param {string} regionId
     */
    static async open(app, levelId, regionId) {
        const region = this.#find(app, levelId, regionId);
        if (!region) return;
        platform.dialogs.dismiss({ placement: "docked" });
        RegionPanel.selectRegionById(app, levelId, regionId);

        const safeRegion = MapDialogManager._withLabelDefaults(app, region);
        const content = await platform.templates.render(TEMPLATE, {
            // A region without a fill of its own is drawn in its preset colour, which the editor
            // starts from so saving it unchanged keeps the region's look
            region: { ...safeRegion, fillColor: regionFillColor(region), fillStyle: region.fillStyle ?? "solid" },
            visibilities: RegionPanel.visibilityChoices(region.visibility),
            rotationRange: FILRODENSWMB.UI.ROTATION,
            fonts: platform.fonts.list(),
            palette: FILRODENSWMB.LABELS?.PRESETS || [],
            customLabelStyles: app.uiState.customLabelStyles || [],
            customRegionStyles: app.uiState.customRegionStyles || [],
        });

        const choice = await platform.dialogs.choose({
            placement: "docked",
            classes: ["fwmb", "fwmb-region-editor"],
            title: platform.i18n.format("FILRODENSWMB.UI.EditRegionTitle", { name: region.name }),
            content,
            onRender: (element) => this.#bind(app, element),
            buttons: this.#buttons(),
            dismissed: null,
        });
        await this.#finish(app, levelId, regionId, choice);
    }

    static #buttons() {
        const localize = (key) => platform.i18n.localize(key);
        return [
            { action: "delete", label: localize("FILRODENSWMB.UI.Delete"), icon: "fwmb-icon delete", tone: "negative", callback: () => ({ action: "delete" }) },
            { action: "merge", label: localize("FILRODENSWMB.UI.MergeInto"), icon: "fwmb-icon merge", tone: "caution", callback: () => ({ action: "merge" }) },
            { action: "cancel", label: localize("FILRODENSWMB.UI.Cancel"), icon: "fwmb-icon cancel", tone: "negative", callback: () => null },
            { action: "save", label: localize("FILRODENSWMB.UI.Save"), icon: "fwmb-icon accept", tone: "positive", default: true, callback: (form) => ({ action: "save", values: this.#read(form) }) },
        ];
    }

    static async #finish(app, levelId, regionId, choice) {
        if (!choice) return;
        if (choice.action === "delete") {
            await RegionPanel.deleteRegion(app, levelId, regionId);
            return;
        }
        if (choice.action === "merge") {
            await RegionPanel.mergeRegion(app, levelId, regionId);
            return;
        }
        const region = this.#find(app, levelId, regionId);
        if (!region) return;
        MapStateManager.pushVectorState(app);
        platform.utils.mergeObject(region, choice.values);
        app._repaintVectors();
        app.view?.render(["context", "editToolbar"]);
        app.markDirty();
    }

    static #find(app, levelId, regionId) {
        return app.regionLevels.find((level) => level.id === levelId)?.regions.find((candidate) => candidate.id === regionId) ?? null;
    }

    /** What the editor's fields hold, as region fields. */
    static #read(form) {
        const elements = form.elements;
        return {
            name: elements.regionName.value.trim() || elements.regionName.defaultValue,
            description: elements.regionDesc.value,
            visibility: elements.regionVisibility.value,
            quickStyle: elements.regionQuickStyle.value,
            fillColor: elements.regionFillTransparent.checked ? "transparent" : elements.regionFillColor.value,
            fillStyle: elements.regionFillStyle.value,
            label: MapDialogManager._extractLabelResultFields(form),
        };
    }

    /**
     * Choosing a quick style fills the fill fields from it; changing a fill field by hand leaves the
     * quick style for Custom. The label fields work as in every other editor.
     */
    static #bind(app, element) {
        const quickStyle = element.querySelector('select[name="regionQuickStyle"]');
        const transparent = element.querySelector('input[name="regionFillTransparent"]');
        const color = element.querySelector('input[name="regionFillColor"]');
        const style = element.querySelector('select[name="regionFillStyle"]');

        quickStyle?.addEventListener("change", () => {
            const chosen = (app.uiState.customRegionStyles ?? []).find((candidate) => candidate.id === quickStyle.value);
            if (!chosen) return;
            const isTransparent = chosen.fillColor === "transparent";
            if (transparent) transparent.checked = isTransparent;
            if (color) color.value = isTransparent ? "#000000" : chosen.fillColor;
            if (style) style.value = chosen.fillStyle;
        });
        const toCustom = () => {
            if (quickStyle) quickStyle.value = "custom";
        };
        transparent?.addEventListener("change", toCustom);
        color?.addEventListener("input", toCustom);
        style?.addEventListener("change", toCustom);

        MapDialogManager.bindLabelPropertiesDialog(element, app.uiState);
    }
}
