import { FILRODENSWMB } from "../config.js";
import { DrawnDecoration } from "../canvas/decorations/DrawnDecoration.js";
import { compassThumbnail } from "../canvas/decorations/DecorationSvg.js";
import { InspectorFields } from "./InspectorFields.js";
import { labelFontGroups } from "../data/fonts.js";
import { platform } from "../platform/index.js";

/**
 * A compass rose's own fields in the inspector (see DecorationEditor): its design, chosen from
 * thumbnails of the three; the design's options (points, rings, the degree ring, the north marker,
 * the letters, upright letters, the backing disc and its opacity, the letters' halo); its colours,
 * one by one or all at once from a colour scheme; and its letters' font, bold and size.
 *
 * The north arrow has fewer options than the two roses: one ring or none, the N alone, and no
 * accent colour. Choosing another design gives the rose that design's own points, rings, north
 * marker and letter font, and keeps its colours, letters and backing.
 */

const { COMPASS, SCHEMES } = FILRODENSWMB.DECORATIONS;

/** The colours a design uses, in the order shown. */
const COLOR_KEYS = Object.freeze({
    rose: Object.freeze(["light", "dark", "line", "accent", "letter", "backing"]),
    arrow: Object.freeze(["light", "dark", "line", "letter", "backing"]),
});

/** The names of each choice, by its value. */
const LABELS = Object.freeze({
    designs: Object.freeze({ classic: "FILRODENSWMB.UI.CompassDesignClassic", mariner: "FILRODENSWMB.UI.CompassDesignMariner", arrow: "FILRODENSWMB.UI.CompassDesignArrow" }),
    rings: Object.freeze(["FILRODENSWMB.UI.CompassRings0", "FILRODENSWMB.UI.CompassRings1", "FILRODENSWMB.UI.CompassRings2"]),
    north: Object.freeze({ letter: "FILRODENSWMB.UI.CompassNorthLetter", fleur: "FILRODENSWMB.UI.CompassNorthFleur" }),
    letters: Object.freeze({ none: "FILRODENSWMB.UI.CompassLettersNone", cardinal: "FILRODENSWMB.UI.CompassLettersCardinal", all: "FILRODENSWMB.UI.CompassLettersAll" }),
    // The north arrow carries the N alone
    arrowLetters: Object.freeze({ none: "FILRODENSWMB.UI.CompassLettersNone", cardinal: "FILRODENSWMB.UI.CompassLettersCardinalNorth" }),
    colors: Object.freeze({
        light: "FILRODENSWMB.UI.CompassColorLight",
        dark: "FILRODENSWMB.UI.CompassColorDark",
        line: "FILRODENSWMB.UI.CompassColorLine",
        accent: "FILRODENSWMB.UI.CompassColorAccent",
        letter: "FILRODENSWMB.UI.CompassColorLetter",
        backing: "FILRODENSWMB.UI.CompassColorBacking",
    }),
    schemes: Object.freeze({
        parchment: "FILRODENSWMB.UI.ColorSchemeParchment",
        seaChart: "FILRODENSWMB.UI.ColorSchemeSeaChart",
        ink: "FILRODENSWMB.UI.ColorSchemeInk",
        slate: "FILRODENSWMB.UI.ColorSchemeSlate",
        crimson: "FILRODENSWMB.UI.ColorSchemeCrimson",
    }),
});

/** A design's own shape and letter fields, applied when the design is chosen. */
const DESIGN_FIELDS = Object.freeze(["points", "rings", "degreeRing", "north", "fontFamily", "bold"]);

const capitalised = (text) => text.charAt(0).toUpperCase() + text.slice(1);

export class CompassFields {
    /**
     * The template's context for a compass rose.
     * @param {object} decoration
     */
    static context(decoration) {
        const rose = DrawnDecoration.compassOf(decoration);
        const arrow = rose.design === "arrow";
        const choices = (values, selected, label) => values.map((value) => ({ value, label: label(value), selected: value === selected }));
        const fonts = platform.fonts.list();
        return {
            arrow,
            designs: COMPASS.DESIGNS.map((design) => ({
                value: design,
                label: LABELS.designs[design],
                selected: design === rose.design,
                // Each design drawn in this rose's own colours, with its own shape
                thumbnail: compassThumbnail({ ...rose, design, ...pick(COMPASS.DEFAULTS[design], DESIGN_FIELDS) }),
            })),
            points: choices(COMPASS.POINTS, rose.points, (value) => platform.i18n.format("FILRODENSWMB.UI.CompassPointsValue", { count: value })),
            rings: choices(arrow ? [0, 1] : [0, 1, 2], Math.min(rose.rings, arrow ? 1 : 2), (value) => LABELS.rings[value]),
            degreeRing: rose.degreeRing,
            north: choices(COMPASS.NORTH, rose.north, (value) => LABELS.north[value]),
            letters: choices(arrow ? ["none", "cardinal"] : COMPASS.LETTERS, rose.letters, (value) => (arrow ? LABELS.arrowLetters : LABELS.letters)[value]),
            upright: rose.upright,
            backing: rose.backing,
            backingOpacity: rose.backingOpacity,
            halo: rose.halo,
            colors: COLOR_KEYS[arrow ? "arrow" : "rose"].map((key) => ({ key, name: `compassColor${capitalised(key)}`, label: LABELS.colors[key], value: rose.colors[key] })),
            schemes: Object.keys(SCHEMES).map((value) => ({ value, label: LABELS.schemes[value] })),
            fontFamily: rose.fontFamily,
            fontGroups: labelFontGroups(fonts, "FILRODENSWMB.UI.FontCategoryOther"),
            fontMissing: !fonts.includes(rose.fontFamily),
            bold: rose.bold,
            face: InspectorFields.faceChoices(rose.fontFamily),
            letterSize: rose.letterSize,
            letterSizeRange: { min: COMPASS.LETTER_SIZE.MIN, max: COMPASS.LETTER_SIZE.MAX, step: 0.01 },
        };
    }

    /**
     * The fields a commit of `field` changes, read from the form; an empty object for a field that
     * is not the compass's own. A colour scheme with nothing chosen changes nothing.
     * @param {object} decoration
     * @param {HTMLFormControlsCollection} elements
     * @param {string} field
     * @returns {object}
     */
    static read(decoration, elements, field) {
        const rose = DrawnDecoration.compassOf(decoration);
        const value = elements[field]?.value;
        const checked = elements[field]?.checked;
        switch (field) {
            case "compassDesign":
                return { design: value, ...pick(COMPASS.DEFAULTS[value] ?? {}, DESIGN_FIELDS) };
            case "compassPoints":
                return { points: Number(value) };
            case "compassRings":
                return { rings: Number(value) };
            case "compassDegreeRing":
                return { degreeRing: checked };
            case "compassNorth":
                return { north: value };
            case "compassLetters":
                return { letters: value };
            case "compassUpright":
                return { upright: checked };
            case "compassBacking":
                return { backing: checked };
            case "compassBackingOpacity":
                return { backingOpacity: Number(value) };
            case "compassHalo":
                return { halo: checked };
            case "compassScheme":
                return SCHEMES[value] ? { colors: pick(SCHEMES[value], COLOR_KEYS.rose) } : {};
            case "compassFont":
                return { fontFamily: value };
            case "compassBold":
                return { bold: checked };
            case "compassLetterSize":
                return { letterSize: Number(value) };
            default: {
                // One colour: the rose's colours as they are drawn, with this one changed
                const key = COLOR_KEYS.rose.find((each) => field === `compassColor${capitalised(each)}`);
                return key ? { colors: { ...pick(rose.colors, COLOR_KEYS.rose), [key]: value } } : {};
            }
        }
    }
}

/** The fields of `source` named in `keys` that it has. */
function pick(source, keys) {
    return Object.fromEntries(keys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
}
