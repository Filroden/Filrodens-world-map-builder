import { FILRODENSWMB } from "../config.js";
import { Inspector } from "./Inspector.js";
import { InspectorFields } from "./InspectorFields.js";
import { MapDialogManager } from "./MapDialogManager.js";
import { MapStateManager } from "./MapStateManager.js";
import { MeshIntegration } from "./MeshIntegration.js";
import { PinEditor } from "./PinEditor.js";
import { RegionEditor } from "./RegionEditor.js";
import { RegionPanel } from "./RegionPanel.js";
import { RouteEditor } from "./RouteEditor.js";
import { platform } from "../platform/index.js";

/** What a label can belong to: its localisation key, its icon, and the tool its own inspector is opened in. */
const OWNERS = Object.freeze({
    pin: { kind: "FILRODENSWMB.UI.InspectorOwnerPin", icon: "place", tool: "infrastructure", infraMode: "pin" },
    route: { kind: "FILRODENSWMB.UI.InspectorOwnerRoute", icon: "timeline", tool: "infrastructure", infraMode: "route" },
    region: { kind: "FILRODENSWMB.UI.InspectorOwnerRegion", icon: "pentagon", tool: "regions" },
});

/**
 * A label in the inspector (see Inspector): a standalone label (the Labels tool's own, `type`
 * "custom") or the label of a pin, route or region (`type` "pin", "route" or "region").
 *
 * A standalone label's fields are its own: its text, visibility and look, with Focus view and
 * Delete. An owned label's text is its owner's name, so it shows what it belongs to and a link
 * to the owner's own inspector (in the owner's tool), then its look, whose visibility hides the
 * label apart from its owner. It has no Delete: it goes with its owner.
 *
 * `ref` is `{ type, id, layerId }` (the layer only for a region's label), as the Labels tool's
 * list rows and the canvas name a label.
 */
export class LabelEditor {
    /**
     * Opens the inspector on a label.
     * @param {object} app
     * @param {{type: string, id: string, layerId?: string}} ref
     * @returns {Promise<boolean>}
     */
    static open(app, ref) {
        return Inspector.open(app, this.KIND, { type: ref.type ?? "custom", id: ref.id, layerId: ref.layerId ?? null });
    }

    /** The label's object: the standalone label, or the pin, route or region that owns it. */
    static #find(app, { type, id, layerId }) {
        if (type === "custom") return app.mapLabels?.find((label) => label.id === id) ?? null;
        if (type === "pin") return app.mapPins?.find((pin) => pin.id === id) ?? null;
        if (type === "route") return app.mapRoutes?.find((route) => route.id === id) ?? null;
        if (type === "region") return app.regionLevels?.find((level) => level.id === layerId)?.regions.find((region) => region.id === id) ?? null;
        return null;
    }

    /** The label's fields with their defaults: a standalone label's own, an owner's `label`. */
    static #label(app, object, ref) {
        return InspectorFields.label(app, ref.type === "custom" ? { label: object } : object);
    }

    /** The label's kind of inspector. */
    static KIND = Object.freeze({
        id: "label",
        template: "modules/filrodens-world-map-builder/templates/parts/inspector-label.hbs",
        find: (app, ref) => LabelEditor.#find(app, ref),
        header: (app, object, ref) => ({
            title: object.name,
            subtitle: ref.type === "custom" ? platform.i18n.localize("FILRODENSWMB.UI.InspectorSubtitleLabel") : platform.i18n.format("FILRODENSWMB.UI.InspectorSubtitleOwnedLabel", { kind: platform.i18n.localize(OWNERS[ref.type].kind) }),
            swatch: LabelEditor.#label(app, object, ref).fillColor,
        }),
        context: (app, object, ref) => LabelEditor.#context(app, object, ref),
        apply: (app, object, ref, form, field) => LabelEditor.#apply(app, object, ref, form, field),
        actions: {
            zoom: (app, object, ref) => {
                const points = ref.type === "custom" || ref.type === "pin" ? [object] : MeshIntegration.outlinePoints(app, object);
                if (points.length) app.canvasEngine?.zoomToFeature(points);
            },
            goToOwner: (app, object, ref) => LabelEditor.#goToOwner(app, object, ref),
            delete: (app, object) => MapDialogManager.deleteEntityById(app, "label", object.id),
            saveStyle: (app, object, ref) => LabelEditor.#saveStyle(app, object, ref),
        },
    });

    static #context(app, object, ref) {
        const label = this.#label(app, object, ref);
        const standalone = ref.type === "custom";
        return {
            standalone,
            text: object.name,
            ownerKind: standalone ? null : platform.i18n.localize(OWNERS[ref.type].kind),
            ownerIcon: standalone ? null : OWNERS[ref.type].icon,
            visibilities: RegionPanel.visibilityChoices(label.visibility),
            ownedVisibilities: standalone ? null : RegionPanel.visibilityChoices(label.visibility),
            label,
            labelChoices: InspectorFields.labelChoices(app, label),
            labelStyleName: InspectorFields.styleName(app.uiState.customLabelStyles, label.quickStyle),
            palette: FILRODENSWMB.LABELS?.PRESETS || [],
        };
    }

    /** Applies the form to the label as one undo step, when anything changed. */
    static #apply(app, object, ref, form, field) {
        const fields = InspectorFields.readLabel(form, field, app);
        const current = this.#label(app, object, ref);
        const name = ref.type === "custom" ? form.elements.labelName.value.trim() || object.name : object.name;
        if (!InspectorFields.differs(current, fields) && name === object.name) return false;
        MapStateManager.pushVectorState(app);
        if (ref.type === "custom") Object.assign(object, fields, { name });
        else object.label = { ...object.label, ...fields };
        this.#redraw(app);
        return true;
    }

    /** Save as…: a label style from the label's look, which the label then follows. */
    static async #saveStyle(app, object, ref) {
        const source = this.#label(app, object, ref);
        const id = await InspectorFields.saveStyleAs(app, "Label", source);
        if (!id) return;
        MapStateManager.pushVectorState(app);
        if (ref.type === "custom") object.quickStyle = id;
        else object.label = { ...source, ...object.label, quickStyle: id };
        this.#redraw(app);
    }

    /** "Go to": the owner's own inspector, in the owner's tool. */
    static async #goToOwner(app, object, ref) {
        const owner = OWNERS[ref.type];
        if (!owner) return;
        if (owner.infraMode) app.uiState.activeInfraMode = owner.infraMode;
        if (app.activeTool !== owner.tool) app._onChangeTool?.(null, { dataset: { tool: owner.tool } });
        if (ref.type === "pin") await PinEditor.open(app, object.id);
        else if (ref.type === "route") await RouteEditor.open(app, object.id);
        else await RegionEditor.open(app, ref.layerId, object.id);
    }

    static #redraw(app) {
        app._repaintVectors();
        app.view?.render(["context", "editToolbar"]);
        app.markDirty();
    }
}
