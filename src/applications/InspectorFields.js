import { FILRODENSWMB } from "../config.js";
import { labelFontGroups } from "../data/fonts.js";
import { MapDialogManager } from "./MapDialogManager.js";
import { CanvasTransforms } from "../tools/CanvasTransforms.js";
import { platform } from "../platform/index.js";

/**
 * What the inspector's kinds share: the label fields a pin, route or region carries, the style
 * picker beside a styled kind's fields, and Save as…, which makes a style from an object's fields.
 *
 * **Styles.** Four kinds have styles: route lines, region fills, labels and pins. An object either
 * follows a style (its `quickStyle`, or a pin's `pinStyle`, names it, and its styled fields hold
 * the style's values) or is Custom. Picking a style in the inspector copies the style's fields onto
 * the object; changing any styled field by hand makes it Custom, so the style never claims an
 * object that no longer looks like it. Save as… names a new style made from the object's fields
 * and connects the object to it. Styles are kept with the map's settings, outside the undo history
 * (as when they are made in Styles and icons); the object's connection to one is undone with it.
 */
export class InspectorFields {
    /** The label fields a label style carries, and so the ones that make a label Custom when changed. */
    static LABEL_STYLE_FIELDS = Object.freeze(["fontFamily", "fontSize", "fillColor", "maxChars", "justify", "bold", "italic"]);

    /**
     * The styles each styled kind can pick from, by the Save as… button's `data-style-type`: the
     * map's list of them (in uiState) and the fields a style of that type carries.
     */
    static STYLE_TYPES = Object.freeze({
        Region: { registryKey: "customRegionStyles", fields: ["fillColor", "fillStyle"], nameKey: "FILRODENSWMB.UI.NewRegionStyleName" },
        Route: { registryKey: "customRouteStyles", fields: ["color", "thickness", "style", "outline", "smoothing"], nameKey: "FILRODENSWMB.UI.NewRouteStyleName" },
        Label: { registryKey: "customLabelStyles", fields: InspectorFields.LABEL_STYLE_FIELDS, nameKey: "FILRODENSWMB.UI.NewLabelStyleName" },
        Pin: { registryKey: "customPinStyles", fields: ["icon", "scale", "color", "label", "detailLevel"], nameKey: "FILRODENSWMB.UI.NewPinStyleName" },
    });

    /**
     * The label of a pin, route or region as the inspector shows it: its own fields over the
     * defaults new labels get (the bar's), with its rotation wrapped into the slider's range.
     */
    static label(app, entity) {
        const label = MapDialogManager._withLabelDefaults(app, entity).label;
        return { ...label, visibility: label.visibility ?? "all" };
    }

    /** The context the label fields partial (parts/label-fields.hbs) needs, besides the label. */
    static labelChoices(app, label) {
        return {
            fontGroups: labelFontGroups(platform.fonts.list(), "FILRODENSWMB.UI.FontCategoryOther"),
            // A family the host lacks stays chosen (the label keeps it), shown as missing
            fontMissing: !!label.fontFamily && !platform.fonts.list().includes(label.fontFamily),
            labelStyles: this.styleChoices(app.uiState.customLabelStyles, label.quickStyle),
            rotationRange: FILRODENSWMB.UI.ROTATION,
            justifications: ["left", "center", "right"].map((value) => ({ value, label: `FILRODENSWMB.UI.Justify${value === "center" ? "Center" : value === "left" ? "Left" : "Right"}`, selected: value === label.justify })),
        };
    }

    /**
     * A style picker's choices: Custom, then every style of the list, with the one named selected
     * (Custom when it names none of them).
     *
     * @param {{id: string, name: string}[]|undefined} styles
     * @param {string|null|undefined} selected
     * @returns {{value: string, name: string|null, selected: boolean}[]}
     */
    static styleChoices(styles, selected) {
        const list = styles ?? [];
        const known = list.some((style) => style.id === selected);
        return [{ value: "custom", name: null, selected: !known }, ...list.map((style) => ({ value: style.id, name: style.name, selected: style.id === selected }))];
    }

    /** The name of the style an object follows, for its group's badge, or null when it is Custom. */
    static styleName(styles, id) {
        return (styles ?? []).find((style) => style.id === id)?.name ?? null;
    }

    /**
     * Reads the label fields of an inspector's form (see parts/label-fields.hbs), as the label
     * they describe once `field` (the field just committed) has taken effect: picking a label style
     * fills the styled fields from it, and changing a styled field makes the label Custom.
     *
     * @param {HTMLFormElement} form
     * @param {string} field
     * @param {object} app
     * @returns {object} The label's fields.
     */
    static readLabel(form, field, app) {
        const elements = form.elements;
        const label = {
            quickStyle: elements.labelQuickStyle.value,
            fontFamily: elements.labelFontFamily.value,
            fontSize: Number(elements.labelFontSize.value) || 1,
            fillColor: elements.labelFillColor.value,
            maxChars: Math.max(0, Math.round(Number(elements.labelMaxChars.value) || 0)),
            justify: elements.labelJustify.value,
            bold: elements.labelBold.checked,
            italic: elements.labelItalic.checked,
        };
        if (elements.labelRotation) label.rotation = CanvasTransforms.normalizeAngle(elements.labelRotation.value);
        if (elements.labelVisibility) label.visibility = elements.labelVisibility.value;
        return this.settleStyle(label, field, {
            pickerField: "labelQuickStyle",
            styledFields: { labelFontFamily: true, labelFontSize: true, labelFillColor: true, labelMaxChars: true, labelJustify: true, labelBold: true, labelItalic: true },
            styles: app.uiState.customLabelStyles,
            fields: this.LABEL_STYLE_FIELDS,
            key: "quickStyle",
        });
    }

    /**
     * Settles an object's style after one field was committed: a style picked copies its fields
     * onto `values`; a styled field changed makes `values` Custom. For the label fields, and the
     * kinds whose own fields are styled (a route's line, a region's fill).
     *
     * @param {object} values - The object's fields as the form holds them.
     * @param {string} field - The field committed.
     * @param {{pickerField: string, styledFields: Record<string, boolean>, styles: object[], fields: string[], key: string}} spec
     * @returns {object} `values`, settled.
     */
    static settleStyle(values, field, { pickerField, styledFields, styles, fields, key }) {
        if (field === pickerField) {
            const style = (styles ?? []).find((candidate) => candidate.id === values[key]);
            if (style) for (const name of fields) if (style[name] !== undefined) values[name] = style[name];
        } else if (styledFields[field]) {
            values[key] = "custom";
        }
        return values;
    }

    /**
     * Whether `values` would change `object`: any of its fields differs, compared by value (a
     * nested object such as a label compared field by field).
     */
    static differs(object, values) {
        return Object.entries(values).some(([name, value]) => {
            const current = object?.[name];
            if (value && typeof value === "object") return this.differs(current ?? {}, value);
            return current !== value;
        });
    }

    /**
     * Save as…: asks for a name and makes a style of `type` from `source`'s styled fields, added to
     * the map's styles. Resolves with the new style's id, or null when the name was not given.
     *
     * @param {object} app
     * @param {"Region"|"Route"|"Label"|"Pin"} type
     * @param {object} source - The fields to copy (an object, or its label).
     * @returns {Promise<string|null>}
     */
    static async saveStyleAs(app, type, source) {
        const spec = this.STYLE_TYPES[type];
        if (!spec) return null;
        const localize = (key) => platform.i18n.localize(key);
        const name = await MapDialogManager._promptTextValue(localize("FILRODENSWMB.UI.SaveStyleTitle"), localize("FILRODENSWMB.UI.StyleName"), localize(spec.nameKey));
        if (!name?.trim()) return null;
        const style = { id: platform.utils.randomID(), name: name.trim() };
        for (const field of spec.fields) if (source[field] !== undefined) style[field] = structuredClone(source[field]);
        app.uiState[spec.registryKey] ??= [];
        app.uiState[spec.registryKey].push(style);
        return style.id;
    }
}
