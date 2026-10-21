import { FILRODENSWMB } from "../config.js";
import { getPinIconPickerList } from "../data/pinIcons.js";
import { labelFontGroups } from "../data/fonts.js";
import { InspectorFields } from "./InspectorFields.js";
import { MapDialogManager } from "./MapDialogManager.js";
import { PinStyles } from "./PinStyles.js";
import { regionFillColor } from "../mesh/Schema.js";
import { ROUTE_CLASSES, ROUTE_THICKNESS_STEP } from "../mesh/Schema.js";
import { platform } from "../platform/index.js";

const VISIBILITY = Object.freeze([
    Object.freeze({ value: "all", label: "FILRODENSWMB.UI.VisibleToAll" }),
    Object.freeze({ value: "gm", label: "FILRODENSWMB.UI.VisibleToGM" }),
    Object.freeze({ value: "none", label: "FILRODENSWMB.UI.VisibleToNone" }),
]);
const STROKES = Object.freeze([
    Object.freeze({ value: "solid", label: "FILRODENSWMB.UI.StyleSolid" }),
    Object.freeze({ value: "dashed", label: "FILRODENSWMB.UI.StyleDashed" }),
    Object.freeze({ value: "dotted", label: "FILRODENSWMB.UI.StyleDotted" }),
]);
const PATTERNS = Object.freeze([
    Object.freeze({ value: "solid", label: "FILRODENSWMB.UI.StyleSolid" }),
    Object.freeze({ value: "diagonal", label: "FILRODENSWMB.UI.StyleDiagonalHatch" }),
    Object.freeze({ value: "crosshatch", label: "FILRODENSWMB.UI.StyleCrossHatch" }),
]);
const JUSTIFY = Object.freeze([
    Object.freeze({ value: "left", label: "FILRODENSWMB.UI.JustifyLeft" }),
    Object.freeze({ value: "center", label: "FILRODENSWMB.UI.JustifyCenter" }),
    Object.freeze({ value: "right", label: "FILRODENSWMB.UI.JustifyRight" }),
]);
const CLASSES = Object.freeze([
    Object.freeze({ value: "", label: "FILRODENSWMB.UI.RouteClassNone" }),
    ...ROUTE_CLASSES.map((value) => Object.freeze({ value, label: `FILRODENSWMB.UI.RouteClass${value[0].toUpperCase()}${value.slice(1)}` })),
]);

/** A style picker's choices: Custom, then the list's styles by name. */
const styleOptions = (registryKey) => (app) => [
    { value: "custom", label: "FILRODENSWMB.UI.Custom" },
    ...[...(app.uiState[registryKey] ?? [])].sort((a, b) => a.name.localeCompare(b.name)).map((style) => ({ value: style.id, name: style.name })),
];

/**
 * The fields a label carries (a standalone label's, or the label of a pin, route or region), as
 * the inspector's label fields hold them, rotation aside (it belongs to each label).
 * @param {"label"|"item"} store - Where the fields are kept: an owner's `label`, or the label itself.
 */
const labelFields = (store) => [
    { key: "quickStyle", store, type: "style", styleType: "Label", label: "FILRODENSWMB.UI.InspectorStyle", inspector: ["labelQuickStyle"], options: styleOptions("customLabelStyles") },
    { key: "fontFamily", store, type: "font", label: "FILRODENSWMB.UI.InspectorFont", inspector: ["labelFontFamily"], styled: true },
    { key: "bold", store, type: "bool", label: "FILRODENSWMB.UI.LabelBold", inspector: ["labelBold"], styled: true },
    { key: "italic", store, type: "bool", label: "FILRODENSWMB.UI.LabelItalic", inspector: ["labelItalic"], styled: true },
    { key: "visibility", store, type: "visibility", label: "FILRODENSWMB.UI.Visibility", inspector: ["labelVisibility"] },
    { key: "fontSize", store, type: "range", label: "FILRODENSWMB.UI.InspectorFontSize", inspector: ["labelFontSize"], min: 0.2, max: 20, step: 0.1, styled: true },
    { key: "fillColor", store, type: "color", label: "FILRODENSWMB.UI.InspectorColor", inspector: ["labelFillColor"], styled: true },
    { key: "justify", store, type: "select", label: "FILRODENSWMB.UI.InspectorJustify", inspector: ["labelJustify"], options: () => JUSTIFY, styled: true },
    { key: "maxChars", store, type: "number", label: "FILRODENSWMB.UI.LabelLineWidth", inspector: ["labelMaxChars"], min: 0, step: 1, unit: "FILRODENSWMB.UI.UnitCharacters", unitShort: "FILRODENSWMB.UI.UnitCharactersShort", hint: "FILRODENSWMB.UI.LabelLineWidthHint", styled: true },
];

/**
 * What each kind's mass edit offers (see MassEdit): one description per editable field, from
 * which the dialogue is drawn, Mixed or shared values read, and changes applied. Mass edit is the
 * inspector's fields for several items at once, so a field here names the inspector fields it
 * stands for (`inspector`), and a test checks every field of a kind's inspector is here, except
 * those that belong to each item (`perItem`: its name, description, text, rotation, how its new
 * legs are found).
 *
 * A field is `{ key, store, type, label, inspector, ... }`:
 * - `store`: "item" (the object's own field) or "label" (its label's).
 * - `type`: style (a style picker), select, bool, visibility, color, fill (a colour or none),
 *   range, number, font or icon; with `options(app)`, `min`/`max`/`step`, `unit` as each needs.
 * - `styled`: a field the item's style sets, so changing it by hand makes the item Custom, as in
 *   the inspector (InspectorFields.settleStyle).
 *
 * Each kind gives the item's style (`style`: the style type, the item's key for it, and the
 * fields a picked style writes) and `current(app, item)`, its fields as the inspector shows them
 * (defaults filled in), from which a field reads Mixed or a shared value.
 */
export class FieldSpecs {
    static KINDS = Object.freeze({
        pin: Object.freeze({
            legend: "FILRODENSWMB.UI.MassEditFieldsPins",
            hasLabel: true,
            style: { type: "Pin", key: "pinStyle", none: null, write: (app, style) => ({ pinStyle: style.id, ...PinStyles.fields(app, style) }) },
            perItem: ["pinName", "pinDesc", "labelRotation"],
            fields: [
                { key: "pinStyle", store: "item", type: "style", styleType: "Pin", label: "FILRODENSWMB.UI.InspectorStyle", inspector: ["pinStyle"], options: styleOptions("customPinStyles") },
                { key: "visibility", store: "item", type: "visibility", label: "FILRODENSWMB.UI.Visibility", inspector: ["pinVisibility"] },
                { key: "icon", store: "item", type: "icon", label: "FILRODENSWMB.UI.InspectorIcon", inspector: [], styled: true },
                { key: "color", store: "item", type: "color", label: "FILRODENSWMB.UI.InspectorColor", inspector: ["pinColor"], styled: true },
                { key: "scale", store: "item", type: "range", label: "FILRODENSWMB.UI.InspectorScale", inspector: ["pinScale"], min: 0.2, max: 16, step: 0.1, styled: true },
                ...labelFields("label"),
            ],
            current: (app, pin) => ({ ...pin, pinStyle: pin.pinStyle ?? "custom", visibility: pin.visibility ?? "all", scale: pin.scale ?? FILRODENSWMB.PINS.DEFAULT_SCALE, color: pin.color ?? FILRODENSWMB.PINS.DEFAULT_STYLE_COLOR, label: InspectorFields.label(app, pin) }),
        }),
        route: Object.freeze({
            legend: "FILRODENSWMB.UI.MassEditFieldsRoutes",
            hasLabel: true,
            style: { type: "Route", key: "quickStyle", none: "custom", write: (_app, style) => ({ quickStyle: style.id, ...MapDialogManager.routeStyleFields(style) }) },
            perItem: ["routeName", "routeDesc", "routeMode", "routeSpanWater", "routeDetail", "labelRotation"],
            fields: [
                { key: "quickStyle", store: "item", type: "style", styleType: "Route", label: "FILRODENSWMB.UI.InspectorStyle", inspector: ["routeQuickStyle"], options: styleOptions("customRouteStyles") },
                { key: "visibility", store: "item", type: "visibility", label: "FILRODENSWMB.UI.Visibility", inspector: ["routeVisibility"] },
                { key: "class", store: "item", type: "select", label: "FILRODENSWMB.UI.InspectorClass", inspector: ["routeClass"], options: () => CLASSES },
                { key: "color", store: "item", type: "color", label: "FILRODENSWMB.UI.InspectorColor", inspector: ["routeColor"], styled: true },
                { key: "style", store: "item", type: "select", label: "FILRODENSWMB.UI.InspectorStroke", inspector: ["routeStyle"], options: () => STROKES, styled: true },
                { key: "thickness", store: "item", type: "range", label: "FILRODENSWMB.UI.InspectorThickness", inspector: ["routeThickness"], min: ROUTE_THICKNESS_STEP, max: 10, step: ROUTE_THICKNESS_STEP, styled: true },
                { key: "outline", store: "item", type: "bool", label: "FILRODENSWMB.UI.InspectorOutline", inspector: ["routeOutline"], styled: true },
                { key: "smoothing", store: "item", type: "bool", label: "FILRODENSWMB.UI.InspectorSmoothing", inspector: ["routeSmoothing"], styled: true },
                ...labelFields("label"),
            ],
            current: (app, route) => ({ ...route, visibility: route.visibility ?? "all", class: route.class ?? "", style: route.style ?? "solid", outline: route.outline !== false, smoothing: route.smoothing === true, label: InspectorFields.label(app, route) }),
        }),
        region: Object.freeze({
            legend: "FILRODENSWMB.UI.MassEditFieldsRegions",
            hasLabel: true,
            style: { type: "Region", key: "quickStyle", none: "custom", write: (_app, style) => ({ quickStyle: style.id, fillColor: style.fillColor, fillStyle: style.fillStyle ?? "solid" }) },
            perItem: ["regionName", "regionDesc", "labelRotation"],
            fields: [
                { key: "quickStyle", store: "item", type: "style", styleType: "Region", label: "FILRODENSWMB.UI.InspectorStyle", inspector: ["regionQuickStyle"], options: styleOptions("customRegionStyles") },
                { key: "visibility", store: "item", type: "visibility", label: "FILRODENSWMB.UI.Visibility", inspector: ["regionVisibility"] },
                { key: "fillColor", store: "item", type: "fill", label: "FILRODENSWMB.UI.InspectorColor", inspector: ["regionFillColor", "regionFillTransparent"], styled: true },
                { key: "fillStyle", store: "item", type: "select", label: "FILRODENSWMB.UI.InspectorPattern", inspector: ["regionFillStyle"], options: () => PATTERNS, styled: true },
                ...labelFields("label"),
            ],
            current: (app, region) => ({ ...region, visibility: region.visibility ?? "all", fillColor: region.fillColor ?? regionFillColor(region) ?? "#000000", fillStyle: region.fillStyle ?? "solid", label: InspectorFields.label(app, region) }),
        }),
        label: Object.freeze({
            legend: "FILRODENSWMB.UI.MassEditFieldsLabels",
            hasLabel: false,
            style: { type: "Label", key: "quickStyle", none: "custom", write: (_app, style) => ({ quickStyle: style.id, ...FieldSpecs.labelStyleFields(style) }) },
            perItem: ["labelName", "labelRotation"],
            fields: labelFields("item"),
            current: (_app, label) => ({ ...label, quickStyle: label.quickStyle ?? "custom", visibility: label.visibility ?? "all", maxChars: label.maxChars ?? 0, justify: label.justify ?? "left", bold: label.bold !== false, italic: label.italic === true }),
        }),
    });

    /** The fields a label style writes onto a label. */
    static labelStyleFields(style) {
        return Object.fromEntries(InspectorFields.LABEL_STYLE_FIELDS.map((name) => [name, name === "bold" ? style.bold !== false : name === "italic" ? style.italic === true : style[name]]));
    }

    /** The label style fields for an owned label (the label's own style). */
    static labelStyle = Object.freeze({ type: "Label", key: "quickStyle", none: "custom", write: (_app, style) => ({ quickStyle: style.id, ...FieldSpecs.labelStyleFields(style) }) });

    /** A field's choices for its select, where it has them (fonts and pin icons from the host). */
    static options(app, field) {
        if (field.type === "visibility") return VISIBILITY;
        if (field.type === "font") return labelFontGroups(platform.fonts.list(), "FILRODENSWMB.UI.FontCategoryOther");
        if (field.type === "icon") return getPinIconPickerList().map((entry) => ({ key: entry.key, localized: entry.label, path: entry.path, isCustom: entry.isCustom }));
        return field.options?.(app) ?? [];
    }
}
