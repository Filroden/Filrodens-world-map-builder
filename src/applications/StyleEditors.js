import { FILRODENSWMB } from "../config.js";
import { getPinIconPickerList } from "../data/pinIcons.js";
import { labelFontGroups } from "../data/fonts.js";
import { Inspector } from "./Inspector.js";
import { InspectorFields } from "./InspectorFields.js";
import { MapDialogManager } from "./MapDialogManager.js";
import { MapStateManager } from "./MapStateManager.js";
import { PinStyles } from "./PinStyles.js";
import { ROUTE_THICKNESS_STEP, roundRouteThickness } from "../mesh/Schema.js";
import { platform } from "../platform/index.js";

const TEMPLATES = "modules/filrodens-world-map-builder/templates/parts/";

/** The localisation key of each stroke and fill pattern. */
const STROKE_LABELS = Object.freeze({ solid: "FILRODENSWMB.UI.StyleSolid", dashed: "FILRODENSWMB.UI.StyleDashed", dotted: "FILRODENSWMB.UI.StyleDotted" });
const PATTERN_LABELS = Object.freeze({ solid: "FILRODENSWMB.UI.StyleSolid", diagonal: "FILRODENSWMB.UI.StyleDiagonalHatch", crosshatch: "FILRODENSWMB.UI.StyleCrossHatch" });

/** The transports a route style can be for: any (none stored), road or sea. */
const TRANSPORT_CHOICES = Object.freeze([
    Object.freeze({ value: "", label: "FILRODENSWMB.UI.TransportAny" }),
    Object.freeze({ value: "road", label: "FILRODENSWMB.UI.TransportRoad" }),
    Object.freeze({ value: "sea", label: "FILRODENSWMB.UI.TransportSea" }),
]);

/** The border fields region styles held before borders belonged to the level, dropped when such a style is next changed. */
const LEGACY_REGION_FIELDS = Object.freeze(["lineColor", "lineThickness", "lineStyle", "smoothing"]);

/**
 * The map's styles in the inspector (see Inspector): a route style, a region fill, a label style
 * or a pin style, opened from its row in Styles and icons. The header names the style, its kind and
 * how many objects follow it ("Trunk road · route style · used by 14"); the body holds its name and
 * the fields a style of its kind carries (InspectorFields.STYLE_TYPES), nothing of any one object.
 *
 * As for objects, a field applies when it is committed. Changing a style changes every object that
 * follows it (the kind's cascade, MapDialogManager.QUICK_STYLE_CONFIG), and the style and those
 * objects change in one undo step: the undo snapshot holds the style lists (see
 * MapStateManager.getVectorStateSnapshot).
 *
 * A route style may be for one transport (`transport`: road or sea) or for any (none stored): the
 * Routes bar and a route's inspector offer it to routes of that transport. Changing it never moves
 * a route off the style.
 */
export class StyleEditors {
    /**
     * Opens the inspector on a style.
     * @param {object} app
     * @param {"Route"|"Region"|"Label"|"Pin"} type
     * @param {string} id
     * @param {object} [options] - As Inspector.open's.
     * @returns {Promise<boolean>}
     */
    static open(app, type, id, options) {
        const kind = this.KINDS[type];
        return kind ? Inspector.open(app, kind, { id }, options) : Promise.resolve(false);
    }

    /** A style of a type by id, or null. */
    static find(app, type, id) {
        const spec = InspectorFields.STYLE_TYPES[type];
        return (spec && (app.uiState[spec.registryKey] ?? []).find((style) => style.id === id)) ?? null;
    }

    /** How many objects follow a style. */
    static usageCount(app, type, id) {
        return MapDialogManager.QUICK_STYLE_CONFIG[type]?.getUsageCount(app, id) ?? 0;
    }

    /** The kind of each style type, by its inspector kind's id. */
    static #kind(type, { id, subtitleKey, swatch, context, read, actions = {} }) {
        return Object.freeze({
            id,
            type,
            template: `${TEMPLATES}inspector-${id}.hbs`,
            find: (app, ref) => StyleEditors.find(app, type, ref.id),
            header: (app, style) => ({
                title: style.name,
                subtitle: platform.i18n.format("FILRODENSWMB.UI.InspectorSubtitleStyle", { kind: platform.i18n.localize(subtitleKey), count: StyleEditors.usageCount(app, type, style.id) }),
                swatch: swatch(style),
            }),
            context: (app, style) => ({ ...context(app, style), palette: FILRODENSWMB.LABELS?.PRESETS || [] }),
            apply: (app, style, _ref, form) => StyleEditors.#apply(app, type, style, read(app, style, form.elements)),
            actions,
        });
    }

    /**
     * Applies a style's fields as read from the form, as one undo step, when anything changed:
     * the style changes, and every object that follows it (the cascade).
     */
    static #apply(app, type, style, values) {
        const name = values.name.trim();
        values.name = name || style.name;
        if (!InspectorFields.differs(this.#current(type, style), values)) return false;
        MapStateManager.pushVectorState(app);
        Object.assign(style, values);
        if (type === "Route" && !values.transport) delete style.transport;
        if (type === "Region") for (const key of LEGACY_REGION_FIELDS) delete style[key];
        MapDialogManager.QUICK_STYLE_CONFIG[type].onCascade(app, style.id, style);
        this.#redraw(app);
        return true;
    }

    /** A style's fields as the form shows them, for comparing with what the form holds. */
    static #current(type, style) {
        switch (type) {
            case "Route":
                return { ...style, transport: style.transport ?? "", outline: style.outline !== false, smoothing: style.smoothing === true };
            case "Label":
                return { ...style, maxChars: style.maxChars ?? 0, bold: style.bold !== false, italic: style.italic === true };
            case "Pin":
                return { ...style, label: { fontSize: style.label?.fontSize ?? style.scale, visibility: style.label?.visibility ?? "all", quickStyle: style.label?.quickStyle ?? PinStyles.NONE } };
            default:
                return style;
        }
    }

    /** After a change: the map's objects, the panel's rows (the style's look and count) and the bar's choices. */
    static #redraw(app) {
        app._repaintVectors();
        app.view?.render(["context", "editToolbar"]);
        app.markDirty();
    }

    static #choices(labels, selected) {
        return Object.entries(labels).map(([value, label]) => ({ value, label, selected: value === selected }));
    }

    static ROUTE = StyleEditors.#kind("Route", {
        id: "route-style",
        subtitleKey: "FILRODENSWMB.UI.StyleKindRoute",
        swatch: (style) => style.color ?? null,
        context: (_app, style) => ({
            style: { ...style, outline: style.outline !== false, smoothing: style.smoothing === true },
            transports: TRANSPORT_CHOICES.map((choice) => ({ ...choice, selected: choice.value === (style.transport ?? "") })),
            strokes: StyleEditors.#choices(STROKE_LABELS, style.style ?? "solid"),
            thicknessStep: ROUTE_THICKNESS_STEP,
        }),
        read: (_app, _style, elements) => ({
            name: elements.styleName.value,
            transport: elements.styleTransport.value,
            color: elements.styleColor.value,
            thickness: roundRouteThickness(elements.styleThickness.value),
            style: elements.styleStroke.value,
            outline: elements.styleOutline.checked,
            smoothing: elements.styleSmoothing.checked,
        }),
    });

    static REGION = StyleEditors.#kind("Region", {
        id: "region-style",
        subtitleKey: "FILRODENSWMB.UI.StyleKindRegion",
        swatch: (style) => (style.fillColor && style.fillColor !== "transparent" ? style.fillColor : null),
        context: (_app, style) => ({
            style,
            noFill: style.fillColor === "transparent",
            fillHex: style.fillColor && style.fillColor !== "transparent" ? style.fillColor : "#000000",
            patterns: StyleEditors.#choices(PATTERN_LABELS, style.fillStyle ?? "solid"),
        }),
        read: (_app, _style, elements) => ({
            name: elements.styleName.value,
            fillColor: elements.styleFillTransparent.checked ? "transparent" : elements.styleFillColor.value,
            fillStyle: elements.styleFillStyle.value,
        }),
    });

    static LABEL = StyleEditors.#kind("Label", {
        id: "label-style",
        subtitleKey: "FILRODENSWMB.UI.StyleKindLabel",
        swatch: (style) => style.fillColor ?? null,
        context: (_app, style) => ({
            style: { ...style, maxChars: style.maxChars ?? 0, bold: style.bold !== false, italic: style.italic === true },
            fontGroups: labelFontGroups(platform.fonts.list(), "FILRODENSWMB.UI.FontCategoryOther"),
            fontMissing: !!style.fontFamily && !platform.fonts.list().includes(style.fontFamily),
            face: InspectorFields.faceChoices(style.fontFamily),
            justifications: ["left", "center", "right"].map((value) => ({ value, label: `FILRODENSWMB.UI.Justify${value === "center" ? "Center" : value === "left" ? "Left" : "Right"}`, selected: value === (style.justify ?? "left") })),
        }),
        read: (_app, _style, elements) => ({
            name: elements.styleName.value,
            fontFamily: elements.styleFontFamily.value,
            fontSize: Number(elements.styleFontSize.value) || 1,
            fillColor: elements.styleFillColor.value,
            maxChars: Math.max(0, Math.round(Number(elements.styleMaxChars.value) || 0)),
            justify: elements.styleJustify.value,
            bold: elements.styleBold.checked,
            italic: elements.styleItalic.checked,
        }),
    });

    static PIN = StyleEditors.#kind("Pin", {
        id: "pin-style",
        subtitleKey: "FILRODENSWMB.UI.StyleKindPin",
        swatch: (style) => style.color ?? null,
        context: (app, style) => {
            const icons = getPinIconPickerList(style.icon).map((entry) => ({ ...entry, selected: entry.key === style.icon }));
            return {
                style: { ...style, label: { fontSize: style.label?.fontSize ?? style.scale, visibility: style.label?.visibility ?? "all" } },
                icons,
                icon: icons.find((entry) => entry.selected) ?? { key: style.icon, label: style.icon, isCustom: false },
                detailLevels: PinStyles.detailLevelChoices(style.detailLevel),
                labelVisibilities: PinStyles.visibilityChoices(style.label?.visibility),
                labelStyles: InspectorFields.styleChoices(app.uiState.customLabelStyles, style.label?.quickStyle),
            };
        },
        read: (_app, style, elements) => ({
            name: elements.styleName.value,
            icon: style.icon,
            color: elements.styleColor.value,
            scale: Number(elements.styleScale.value) || FILRODENSWMB.PINS.DEFAULT_SCALE,
            detailLevel: Number(elements.styleDetailLevel.value) || 0,
            label: {
                fontSize: Number(elements.styleLabelSize.value) || FILRODENSWMB.PINS.DEFAULT_SCALE,
                visibility: elements.styleLabelVisibility.value,
                quickStyle: elements.styleLabelQuickStyle.value,
            },
        }),
        actions: {
            // An icon chosen in the grid: the style's icon, and its pins'. One undo step.
            pickIcon: (app, style, _ref, button) => {
                const icon = button.dataset.icon;
                if (!icon || icon === style.icon) return;
                MapStateManager.pushVectorState(app);
                style.icon = icon;
                MapDialogManager.QUICK_STYLE_CONFIG.Pin.onCascade(app, style.id, style);
                StyleEditors.#redraw(app);
            },
        },
    });

    /** Each style type's inspector kind. */
    static KINDS = Object.freeze({ Route: StyleEditors.ROUTE, Region: StyleEditors.REGION, Label: StyleEditors.LABEL, Pin: StyleEditors.PIN });
}
