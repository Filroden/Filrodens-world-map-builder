/**
 * The fonts the module ships (assets/fonts/), one entry per family.
 *
 * This is the one list of vendored fonts. The stylesheet's @font-face rules (styles/fwmb-theme.css)
 * are written from the same data, and tests/ui/fonts.test.mjs checks that the two agree, that every
 * file exists, and that each family's licence sits beside its files. The credits shown in the
 * README come from it too.
 *
 * The files are the unmodified WOFF2 distributions (Fontsource builds of the Google Fonts
 * releases), split by script: a Latin file and a Latin Extended file per weight, joined by
 * unicode-range so the browser fetches the second only when a character in it is drawn. They are
 * used as published and never re-subset: several Open Font License fonts declare Reserved Font
 * Names, and a modified file of one of those would have to be renamed.
 *
 * `ui: true` marks the interface fonts. They draw the studio itself and are not offered as label
 * fonts; the label fonts join this list with `ui: false`.
 */

/** The character ranges of the two subsets every family ships, as in the @font-face rules. */
export const FONT_SUBSETS = Object.freeze({
    latin: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    "latin-ext": "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF",
});

/** Where the font folders are, relative to the module's root. */
export const FONTS_FOLDER = "assets/fonts";

export const FONT_FAMILIES = Object.freeze([
    Object.freeze({
        id: "atkinson-hyperlegible",
        name: "Atkinson Hyperlegible",
        category: "sans",
        ui: true,
        role: "interface",
        weights: Object.freeze([400, 700]),
        styles: Object.freeze(["normal"]),
        subsets: Object.freeze(["latin", "latin-ext"]),
        licence: "OFL-1.1",
        copyright: "Copyright 2020 Braille Institute of America, Inc.",
        source: "https://github.com/googlefonts/atkinson-hyperlegible",
    }),
    Object.freeze({
        id: "sora",
        name: "Sora",
        category: "sans",
        ui: true,
        role: "titles",
        weights: Object.freeze([600, 700]),
        styles: Object.freeze(["normal"]),
        subsets: Object.freeze(["latin", "latin-ext"]),
        licence: "OFL-1.1",
        copyright: "Copyright 2019 The Sora Project Authors",
        source: "https://github.com/sora-xor/sora-font",
    }),
    Object.freeze({
        id: "barlow-semi-condensed",
        name: "Barlow Semi Condensed",
        category: "sans",
        ui: true,
        role: "readouts",
        weights: Object.freeze([500, 600]),
        styles: Object.freeze(["normal"]),
        subsets: Object.freeze(["latin", "latin-ext"]),
        licence: "OFL-1.1",
        copyright: "Copyright 2017 The Barlow Project Authors",
        source: "https://github.com/jpt/barlow",
    }),
]);

/**
 * Every face of a family: one per weight, style and subset, with its file's path from the module's
 * root (`assets/fonts/sora/sora-latin-600-normal.woff2`) and the subset's character ranges.
 *
 * @param {object} family - An entry of FONT_FAMILIES.
 * @returns {{weight: number, style: string, subset: string, path: string, unicodeRange: string}[]}
 */
export function fontFaces(family) {
    const faces = [];
    for (const weight of family.weights) {
        for (const style of family.styles) {
            for (const subset of family.subsets) {
                faces.push({
                    weight,
                    style,
                    subset,
                    path: `${FONTS_FOLDER}/${family.id}/${family.id}-${subset}-${weight}-${style}.woff2`,
                    unicodeRange: FONT_SUBSETS[subset],
                });
            }
        }
    }
    return faces;
}

/** The licence file beside a family's fonts, from the module's root. */
export function fontLicencePath(family) {
    return `${FONTS_FOLDER}/${family.id}/OFL.txt`;
}
