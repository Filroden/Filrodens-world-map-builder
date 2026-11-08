import { FILRODENSWMB } from "../config.js";
import { DrawnDecoration } from "../canvas/decorations/DrawnDecoration.js";
import { cartoucheThumbnail } from "../canvas/decorations/DecorationSvg.js";
import { InspectorFields } from "./InspectorFields.js";
import { labelFontGroups } from "../data/fonts.js";
import { platform } from "../platform/index.js";

/**
 * A cartouche's own fields in the inspector (see DecorationEditor): its design, chosen from
 * thumbnails of the three; its title (the map's name, or one of its own) and subtitle, with the
 * subtitle's size, font and italic; its colours, one by one or all at once from a colour scheme;
 * and its title's font, bold, capitals and the widest it may grow, with a hint when its text does
 * not fit.
 *
 * Choosing another design gives the cartouche that design's own title font and bold, and keeps
 * its title, colours and sizes. Only the ribbon has a shade colour (its tails), and only the
 * plaque and frame an accent (their inner rules and ornaments).
 */

const { CARTOUCHE, SCHEMES } = FILRODENSWMB.DECORATIONS;

/** The colours a design uses, in the order shown (all of them, for a colour scheme). */
const COLOR_KEYS = Object.freeze({
    all: Object.freeze(["fill", "line", "accent", "shade", "text"]),
    ribbon: Object.freeze(["fill", "line", "shade", "text"]),
    flat: Object.freeze(["fill", "line", "accent", "text"]),
});

/** The names of each choice, by its value. */
const LABELS = Object.freeze({
    designs: Object.freeze({ plaque: "FILRODENSWMB.UI.CartoucheDesignPlaque", ribbon: "FILRODENSWMB.UI.CartoucheDesignRibbon", frame: "FILRODENSWMB.UI.CartoucheDesignFrame" }),
    sources: Object.freeze({ map: "FILRODENSWMB.UI.CartoucheTitleMap", custom: "FILRODENSWMB.UI.CartoucheTitleCustom" }),
    colors: Object.freeze({
        fill: "FILRODENSWMB.UI.CartoucheColorFill",
        line: "FILRODENSWMB.UI.CompassColorLine",
        accent: "FILRODENSWMB.UI.CompassColorAccent",
        shade: "FILRODENSWMB.UI.CartoucheColorShade",
        text: "FILRODENSWMB.UI.CartoucheColorText",
    }),
    schemes: Object.freeze({
        parchment: "FILRODENSWMB.UI.ColorSchemeParchment",
        seaChart: "FILRODENSWMB.UI.ColorSchemeSeaChart",
        ink: "FILRODENSWMB.UI.ColorSchemeInk",
        slate: "FILRODENSWMB.UI.ColorSchemeSlate",
        crimson: "FILRODENSWMB.UI.ColorSchemeCrimson",
    }),
});

/** A design's own fields, applied when the design is chosen. */
const DESIGN_FIELDS = Object.freeze(["fontFamily", "bold"]);

const capitalised = (text) => text.charAt(0).toUpperCase() + text.slice(1);

export class CartoucheFields {
    /**
     * The template's context for a cartouche.
     * @param {object} decoration
     * @param {{overflow?: boolean}} [state] - `overflow`: its text did not fit when last drawn.
     */
    static context(decoration, { overflow = false } = {}) {
        const panel = DrawnDecoration.cartoucheOf(decoration);
        const choices = (values, selected, labels) => values.map((value) => ({ value, label: labels[value], selected: value === selected }));
        const fonts = platform.fonts.list();
        const groups = labelFontGroups(fonts, "FILRODENSWMB.UI.FontCategoryOther");
        const hasSubtitle = panel.subtitle.trim() !== "";
        return {
            designs: CARTOUCHE.DESIGNS.map((design) => ({
                value: design,
                label: LABELS.designs[design],
                selected: design === panel.design,
                thumbnail: cartoucheThumbnail({ ...panel, design }),
            })),
            sources: choices(CARTOUCHE.TITLE_SOURCES, panel.titleSource, LABELS.sources),
            custom: panel.titleSource === "custom",
            title: panel.title,
            subtitle: panel.subtitle,
            hasSubtitle,
            subtitleSize: panel.subtitleSize,
            subtitleSizeRange: { min: CARTOUCHE.SUBTITLE_SIZE.MIN, max: CARTOUCHE.SUBTITLE_SIZE.MAX, step: 0.05 },
            subtitleFontFamily: panel.subtitleFontFamily,
            subtitleFontMissing: !fonts.includes(panel.subtitleFontFamily),
            subtitleItalic: panel.subtitleItalic,
            subtitleFace: InspectorFields.faceChoices(panel.subtitleFontFamily),
            colors: COLOR_KEYS[panel.design === "ribbon" ? "ribbon" : "flat"].map((key) => ({ key, name: `cartoucheColor${capitalised(key)}`, label: LABELS.colors[key], value: panel.colors[key] })),
            schemes: Object.keys(SCHEMES).map((value) => ({ value, label: LABELS.schemes[value] })),
            fontGroups: groups,
            fontFamily: panel.fontFamily,
            fontMissing: !fonts.includes(panel.fontFamily),
            bold: panel.bold,
            face: InspectorFields.faceChoices(panel.fontFamily),
            capitals: panel.capitals,
            maxWidth: panel.maxWidth,
            maxWidthRange: { min: CARTOUCHE.MAX_WIDTH.MIN, max: CARTOUCHE.MAX_WIDTH.MAX, step: 0.05 },
            overflow,
        };
    }

    /**
     * The fields a commit of `field` changes, read from the form; an empty object for a field that
     * is not the cartouche's own. A colour scheme with nothing chosen changes nothing. Titles are
     * plain text, trimmed.
     * @param {object} decoration
     * @param {HTMLFormControlsCollection} elements
     * @param {string} field
     * @returns {object}
     */
    static read(decoration, elements, field) {
        const panel = DrawnDecoration.cartoucheOf(decoration);
        const value = elements[field]?.value;
        const checked = elements[field]?.checked;
        switch (field) {
            case "cartoucheDesign":
                return { design: value, ...pick(CARTOUCHE.DEFAULTS[value] ?? {}, DESIGN_FIELDS) };
            case "cartoucheTitleSource":
                return { titleSource: value };
            case "cartoucheTitle":
                return { title: String(value ?? "").trim() };
            case "cartoucheSubtitle":
                return { subtitle: String(value ?? "").trim() };
            case "cartoucheSubtitleSize":
                return { subtitleSize: Number(value) };
            case "cartoucheSubtitleFont":
                return { subtitleFontFamily: value };
            case "cartoucheSubtitleItalic":
                return { subtitleItalic: checked };
            case "cartoucheScheme":
                return SCHEMES[value] ? { colors: pick(SCHEMES[value], COLOR_KEYS.all) } : {};
            case "cartoucheFont":
                return { fontFamily: value };
            case "cartoucheBold":
                return { bold: checked };
            case "cartoucheCapitals":
                return { capitals: checked };
            case "cartoucheMaxWidth":
                return { maxWidth: Number(value) };
            default: {
                // One colour: the cartouche's colours as they are drawn, with this one changed
                const key = COLOR_KEYS.all.find((each) => field === `cartoucheColor${capitalised(each)}`);
                return key ? { colors: { ...pick(panel.colors, COLOR_KEYS.all), [key]: value } } : {};
            }
        }
    }
}

/** The fields of `source` named in `keys` that it has. */
function pick(source, keys) {
    return Object.fromEntries(keys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
}
