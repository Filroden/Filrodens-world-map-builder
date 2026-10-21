import { FILRODENSWMB } from "../config.js";
import { getPinIconPickerList } from "../data/pinIcons.js";
import { Inspector } from "./Inspector.js";
import { InspectorFields } from "./InspectorFields.js";
import { MapDialogManager } from "./MapDialogManager.js";
import { MapStateManager } from "./MapStateManager.js";
import { PinStyles } from "./PinStyles.js";
import { RegionPanel } from "./RegionPanel.js";
import { platform } from "../platform/index.js";
import { typed } from "../data/MapRules.js";
import { GeneratedDetails } from "./GeneratedDetails.js";

/** The pin's own fields a pin style sets, by their names in the form (the label's size is set by it too). */
const LOOK_FIELDS = Object.freeze({ pinColor: true, pinScale: true });

/**
 * A pin in the inspector (see Inspector): its name, description and visibility; its look (a pin
 * style, or its own icon, colour and scale); its label; and Focus view and Delete.
 *
 * A pin follows a pin style (its `pinStyle`) as other objects follow theirs: picking one writes
 * the style's icon, scale, colour and label fields onto the pin (PinStyles.apply); choosing an
 * icon, colour or scale by hand leaves it with no style (as the pin dialogue did). Save as… makes
 * a pin style of the pin's look and label size, and gives the pin that style.
 */
export class PinEditor {
    /**
     * Opens the inspector on a pin.
     * @param {object} app
     * @param {string} pinId
     * @returns {Promise<boolean>}
     */
    static open(app, pinId, options) {
        return Inspector.open(app, this.KIND, { id: pinId }, options);
    }

    static #find(app, { id }) {
        return app.mapPins?.find((pin) => pin.id === id) ?? null;
    }

    /** The pin's kind of inspector. */
    static KIND = Object.freeze({
        id: "pin",
        template: "modules/filrodens-world-map-builder/templates/parts/inspector-pin.hbs",
        find: (app, ref) => PinEditor.#find(app, ref),
        header: (_app, pin) => ({ title: pin.name, subtitle: platform.i18n.localize("FILRODENSWMB.UI.InspectorSubtitlePin"), swatch: pin.color ?? null }),
        context: (app, pin) => PinEditor.#context(app, pin),
        apply: (app, pin, _ref, form, field) => PinEditor.#apply(app, pin, form, field),
        actions: {
            zoom: (app, pin) => app.canvasEngine?.zoomToFeature([pin]),
            pickIcon: (app, pin, _ref, button) => PinEditor.#pickIcon(app, pin, button.dataset.icon),
            delete: (app, pin) => MapDialogManager.deleteEntityById(app, "pin", pin.id),
            saveStyle: (app, pin, _ref, button) => PinEditor.#saveStyle(app, pin, button.dataset.styleType),
        },
    });

    static #context(app, pin) {
        const label = InspectorFields.label(app, pin);
        const icons = getPinIconPickerList(pin.icon).map((entry) => ({ ...entry, selected: entry.key === pin.icon }));
        const pinStyle = PinStyles.find(app, pin.pinStyle);
        return {
            pin: { ...pin, scale: pin.scale ?? FILRODENSWMB.PINS.DEFAULT_SCALE, color: pin.color ?? FILRODENSWMB.PINS.DEFAULT_STYLE_COLOR },
            visibilities: RegionPanel.visibilityChoices(pin.visibility),
            pinStyles: InspectorFields.styleChoices(PinStyles.list(app), pinStyle?.id ?? null),
            pinStyleName: pinStyle?.name ?? null,
            icons,
            icon: icons.find((entry) => entry.selected) ?? { key: pin.icon, label: pin.icon, isCustom: false },
            label,
            labelChoices: InspectorFields.labelChoices(app, label),
            labelStyleName: InspectorFields.styleName(app.uiState.customLabelStyles, label.quickStyle),
            labelVisibilities: RegionPanel.visibilityChoices(label.visibility),
            palette: FILRODENSWMB.LABELS?.PRESETS || [],
            generated: GeneratedDetails.forPin(app, pin),
        };
    }

    /** Applies the form to the pin as one undo step, when anything changed. */
    static #apply(app, pin, form, field) {
        const elements = form.elements;
        // Checked as an import is (see MapRules.typed): a value that fails its rule keeps the pin's own
        const values = typed(
            "pin",
            {
                name: elements.pinName.value.trim() || pin.name,
                description: elements.pinDesc.value,
                visibility: elements.pinVisibility.value,
                color: elements.pinColor.value,
                scale: Number(elements.pinScale.value) || FILRODENSWMB.PINS.DEFAULT_SCALE,
                label: InspectorFields.readLabel(form, field, app),
            },
            pin,
        );
        const current = { ...pin, visibility: pin.visibility ?? "all", label: InspectorFields.label(app, pin) };

        if (field === "pinStyle") {
            const style = PinStyles.find(app, elements.pinStyle.value);
            if (!style && !pin.pinStyle) return false;
            MapStateManager.pushVectorState(app);
            if (style) PinStyles.apply(app, pin, style);
            else pin.pinStyle = null;
            this.#redraw(app);
            return true;
        }
        if (!InspectorFields.differs(current, values)) return false;
        MapStateManager.pushVectorState(app);
        const { label, ...fields } = values;
        Object.assign(pin, fields);
        pin.label = { ...pin.label, ...label };
        if (LOOK_FIELDS[field]) pin.pinStyle = null;
        this.#redraw(app);
        return true;
    }

    /** An icon chosen in the grid: the pin's icon, leaving its style. One undo step. */
    static #pickIcon(app, pin, icon) {
        if (!icon || icon === pin.icon) return;
        MapStateManager.pushVectorState(app);
        pin.icon = icon;
        pin.pinStyle = null;
        this.#redraw(app);
    }

    /** Save as…: a pin style from the pin's look and label size, or a label style from its label. */
    static async #saveStyle(app, pin, type) {
        if (type === "Label") {
            const source = InspectorFields.label(app, pin);
            const id = await InspectorFields.saveStyleAs(app, "Label", source);
            if (!id) return;
            pin.label = { ...source, ...pin.label, quickStyle: id };
            this.#redraw(app);
            return;
        }
        const label = InspectorFields.label(app, pin);
        const source = {
            icon: pin.icon,
            scale: pin.scale ?? FILRODENSWMB.PINS.DEFAULT_SCALE,
            color: pin.color ?? FILRODENSWMB.PINS.DEFAULT_STYLE_COLOR,
            label: { fontSize: label.fontSize, visibility: label.visibility, quickStyle: label.quickStyle ?? PinStyles.NONE },
            detailLevel: FILRODENSWMB.PINS.DETAIL_LEVELS.at(-1),
        };
        const id = await InspectorFields.saveStyleAs(app, "Pin", source);
        if (!id) return;
        pin.pinStyle = id;
        this.#redraw(app);
    }

    static #redraw(app) {
        app._repaintVectors();
        app.view?.render(["context", "editToolbar"]);
        app.markDirty();
    }
}
