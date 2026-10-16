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

/**
 * The character ranges of each subset a family can ship, as in the @font-face rules. Every family
 * ships Latin (and Latin Extended where it has it); the wide-coverage fonts add their scripts.
 */
export const FONT_SUBSETS = Object.freeze({
    latin: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    "latin-ext": "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF",
    greek: "U+0370-0377, U+037A-037F, U+0384-038A, U+038C, U+038E-03A1, U+03A3-03FF",
    "greek-ext": "U+1F00-1FFF",
    cyrillic: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116",
    "cyrillic-ext": "U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F",
    devanagari: "U+0900-097F, U+1CD0-1CF9, U+200C-200D, U+20A8, U+20B9, U+20F0, U+25CC, U+A830-A839, U+A8E0-A8FF, U+11B00-11B09",
    arabic: "U+0600-06FF, U+0750-077F, U+0870-088E, U+0890-0891, U+0897-08E1, U+08E3-08FF, U+200C-200E, U+2010-2011, U+204F, U+2E41, U+FB50-FDFF, U+FE70-FE74, U+FE76-FEFC, U+102E0-102FB, U+10E60-10E7E, U+10EC2-10EC4, U+10EFC-10EFF, U+1EE00-1EE03, U+1EE05-1EE1F, U+1EE21-1EE22, U+1EE24, U+1EE27, U+1EE29-1EE32, U+1EE34-1EE37, U+1EE39, U+1EE3B, U+1EE42, U+1EE47, U+1EE49, U+1EE4B, U+1EE4D-1EE4F, U+1EE51-1EE52, U+1EE54, U+1EE57, U+1EE59, U+1EE5B, U+1EE5D, U+1EE5F, U+1EE61-1EE62, U+1EE64, U+1EE67-1EE6A, U+1EE6C-1EE72, U+1EE74-1EE77, U+1EE79-1EE7C, U+1EE7E, U+1EE80-1EE89, U+1EE8B-1EE9B, U+1EEA1-1EEA3, U+1EEA5-1EEA9, U+1EEAB-1EEBB, U+1EEF0-1EEF1",
    hebrew: "U+0307-0308, U+0590-05FF, U+200C-2010, U+20AA, U+25CC, U+FB1D-FB4F",
});

/**
 * The label fonts' categories, in the picker's order, each with its localisation key (see the
 * scoping in v4-label-fonts.md): book serifs for towns and regions (their italics for water), old
 * print for an antique atlas, engraved capitals for realms and oceans, calligraphic and blackletter
 * faces for fantasy and gothic realms, handwriting for notes, clean sans for modern maps, and the
 * wide-coverage Noto faces for names in other scripts.
 */
export const LABEL_FONT_CATEGORIES = Object.freeze([
    Object.freeze({ id: "book", label: "FILRODENSWMB.UI.FontCategoryBook" }),
    Object.freeze({ id: "old-print", label: "FILRODENSWMB.UI.FontCategoryOldPrint" }),
    Object.freeze({ id: "engraved", label: "FILRODENSWMB.UI.FontCategoryEngraved" }),
    Object.freeze({ id: "calligraphic", label: "FILRODENSWMB.UI.FontCategoryCalligraphic" }),
    Object.freeze({ id: "blackletter", label: "FILRODENSWMB.UI.FontCategoryBlackletter" }),
    Object.freeze({ id: "handwritten", label: "FILRODENSWMB.UI.FontCategoryHandwritten" }),
    Object.freeze({ id: "sans", label: "FILRODENSWMB.UI.FontCategorySans" }),
    Object.freeze({ id: "wide", label: "FILRODENSWMB.UI.FontCategoryWide" }),
]);

/**
 * The label font every host has: new labels use it, and a label naming a family the host lacks
 * (a Foundry world's font on the web, say) is drawn in it, its own family kept for when the map
 * returns to a host that has it. Noto Serif covers Latin, Greek and Cyrillic.
 */
export const DEFAULT_LABEL_FONT = "Noto Serif";

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
    // The label fonts, by category in the picker's order (LABEL_FONT_CATEGORIES), then by name
    Object.freeze({
        id: "alegreya",
        name: "Alegreya",
        category: "book",
        ui: false,
        weights: Object.freeze([400,  700]),
        styles: Object.freeze(["normal",  "italic"]),
        subsets: Object.freeze(["latin",  "latin-ext"]),
        licence: "OFL-1.1",
        copyright: "Copyright 2011 The Alegreya Project Authors",
        source: "https://github.com/huertatipografica/Alegreya",
    }),
    Object.freeze({
        id: "alegreya-sc",
        name: "Alegreya SC",
        category: "book",
        ui: false,
        weights: Object.freeze([400,  700]),
        styles: Object.freeze(["normal",  "italic"]),
        subsets: Object.freeze(["latin",  "latin-ext"]),
        licence: "OFL-1.1",
        copyright: "Copyright 2011 The Alegreya Project Authors",
        source: "https://github.com/huertatipografica/Alegreya",
    }),
    Object.freeze({
        id: "cormorant-garamond",
        name: "Cormorant Garamond",
        category: "book",
        ui: false,
        weights: Object.freeze([400,  700]),
        styles: Object.freeze(["normal",  "italic"]),
        subsets: Object.freeze(["latin",  "latin-ext"]),
        licence: "OFL-1.1",
        copyright: "Copyright 2015 The Cormorant Project Authors (github.com/CatharsisFonts/Cormorant)",
        source: "https://fonts.google.com/specimen/Cormorant+Garamond",
    }),
    Object.freeze({
        id: "eb-garamond",
        name: "EB Garamond",
        category: "book",
        ui: false,
        weights: Object.freeze([400,  700]),
        styles: Object.freeze(["normal",  "italic"]),
        subsets: Object.freeze(["latin",  "latin-ext"]),
        licence: "OFL-1.1",
        copyright: "Copyright 2017 The EB Garamond Project Authors",
        source: "https://github.com/octaviopardo/EBGaramond12",
    }),
    Object.freeze({
        id: "spectral",
        name: "Spectral",
        category: "book",
        ui: false,
        weights: Object.freeze([400,  700]),
        styles: Object.freeze(["normal",  "italic"]),
        subsets: Object.freeze(["latin",  "latin-ext"]),
        licence: "OFL-1.1",
        copyright: "Copyright 2017 The Spectral Project Authors",
        source: "https://github.com/productiontype/Spectral",
    }),
    Object.freeze({
        id: "im-fell-dw-pica",
        name: "IM Fell DW Pica",
        category: "old-print",
        ui: false,
        weights: Object.freeze([400]),
        styles: Object.freeze(["normal",  "italic"]),
        subsets: Object.freeze(["latin"]),
        licence: "OFL-1.1",
        copyright: "Copyright Google Inc.",
        source: "https://fonts.google.com/specimen/IM+Fell+DW+Pica",
    }),
    Object.freeze({
        id: "im-fell-dw-pica-sc",
        name: "IM Fell DW Pica SC",
        category: "old-print",
        ui: false,
        weights: Object.freeze([400]),
        styles: Object.freeze(["normal"]),
        subsets: Object.freeze(["latin"]),
        licence: "OFL-1.1",
        copyright: "Copyright Google Inc.",
        source: "https://fonts.google.com/specimen/IM+Fell+DW+Pica+SC",
    }),
    Object.freeze({
        id: "im-fell-english",
        name: "IM Fell English",
        category: "old-print",
        ui: false,
        weights: Object.freeze([400]),
        styles: Object.freeze(["normal",  "italic"]),
        subsets: Object.freeze(["latin"]),
        licence: "OFL-1.1",
        copyright: "Copyright Google Inc.",
        source: "https://fonts.google.com/specimen/IM+Fell+English",
    }),
    Object.freeze({
        id: "cinzel",
        name: "Cinzel",
        category: "engraved",
        ui: false,
        weights: Object.freeze([400,  700]),
        styles: Object.freeze(["normal"]),
        subsets: Object.freeze(["latin",  "latin-ext"]),
        licence: "OFL-1.1",
        copyright: "Copyright 2020 The Cinzel Project Authors",
        source: "https://github.com/NDISCOVER/Cinzel",
    }),
    Object.freeze({
        id: "cinzel-decorative",
        name: "Cinzel Decorative",
        category: "engraved",
        ui: false,
        weights: Object.freeze([400,  700]),
        styles: Object.freeze(["normal"]),
        subsets: Object.freeze(["latin",  "latin-ext"]),
        licence: "OFL-1.1",
        copyright: "Copyright 2012 Natanael Gama (info@ndiscovered.com), with Reserved Font Name 'Cinzel'",
        source: "https://fonts.google.com/specimen/Cinzel+Decorative",
    }),
    Object.freeze({
        id: "marcellus-sc",
        name: "Marcellus SC",
        category: "engraved",
        ui: false,
        weights: Object.freeze([400]),
        styles: Object.freeze(["normal"]),
        subsets: Object.freeze(["latin",  "latin-ext"]),
        licence: "OFL-1.1",
        copyright: "Copyright (c) 2012 by Brian J. Bonislawsky DBA Astigmatic (AOETI) (astigma@astigmatic.com), with Reserved Font Name \"Marcellus\"",
        source: "https://fonts.google.com/specimen/Marcellus+SC",
    }),
    Object.freeze({
        id: "almendra",
        name: "Almendra",
        category: "calligraphic",
        ui: false,
        weights: Object.freeze([400,  700]),
        styles: Object.freeze(["normal",  "italic"]),
        subsets: Object.freeze(["latin",  "latin-ext"]),
        licence: "OFL-1.1",
        copyright: "Copyright (c) 2011-2012, Ana Sanfelippo (anasanfe@gmail.com), with Reserved Font Name 'Almendra'",
        source: "https://fonts.google.com/specimen/Almendra",
    }),
    Object.freeze({
        id: "almendra-sc",
        name: "Almendra SC",
        category: "calligraphic",
        ui: false,
        weights: Object.freeze([400]),
        styles: Object.freeze(["normal"]),
        subsets: Object.freeze(["latin"]),
        licence: "OFL-1.1",
        copyright: "Copyright (c) 2011 by Ana Sanfelippo (anasanfe@gmail.com). Reserved Font Names \"Almendra\" \"Almendra SC\"",
        source: "https://fonts.google.com/specimen/Almendra+SC",
    }),
    Object.freeze({
        id: "medievalsharp",
        name: "MedievalSharp",
        category: "calligraphic",
        ui: false,
        weights: Object.freeze([400]),
        styles: Object.freeze(["normal"]),
        subsets: Object.freeze(["latin",  "latin-ext"]),
        licence: "OFL-1.1",
        copyright: "Copyright (c) 2011, Wojciech 'wmk69' Kalinowski (wmk69@o2.pl)",
        source: "https://fonts.google.com/specimen/MedievalSharp",
    }),
    Object.freeze({
        id: "uncial-antiqua",
        name: "Uncial Antiqua",
        category: "calligraphic",
        ui: false,
        weights: Object.freeze([400]),
        styles: Object.freeze(["normal"]),
        subsets: Object.freeze(["latin",  "latin-ext"]),
        licence: "OFL-1.1",
        copyright: "Copyright (c) 2011 by Brian J. Bonislawsky DBA Astigmatic (AOETI) (astigma@astigmatic.com), with Reserved Font Name \"Uncial Antiqua\"",
        source: "https://fonts.google.com/specimen/Uncial+Antiqua",
    }),
    Object.freeze({
        id: "grenze-gotisch",
        name: "Grenze Gotisch",
        category: "blackletter",
        ui: false,
        weights: Object.freeze([400,  700]),
        styles: Object.freeze(["normal"]),
        subsets: Object.freeze(["latin",  "latin-ext"]),
        licence: "OFL-1.1",
        copyright: "Copyright 2020 The Grenze Gotisch Project Authors",
        source: "https://github.com/Omnibus-Type/Grenze-Gotisch",
    }),
    Object.freeze({
        id: "pirata-one",
        name: "Pirata One",
        category: "blackletter",
        ui: false,
        weights: Object.freeze([400]),
        styles: Object.freeze(["normal"]),
        subsets: Object.freeze(["latin",  "latin-ext"]),
        licence: "OFL-1.1",
        copyright: "Copyright (c) 2012, Rodrigo Fuenzalida (hello@rfuenzalida.com), Nicolas Massi (www.taip.com.ar / abc.taip.com.ar / nmassi@gmail.com), with Reserved Font Name 'Pirata'",
        source: "https://fonts.google.com/specimen/Pirata+One",
    }),
    Object.freeze({
        id: "unifrakturmaguntia",
        name: "UnifrakturMaguntia",
        category: "blackletter",
        ui: false,
        weights: Object.freeze([400]),
        styles: Object.freeze(["normal"]),
        subsets: Object.freeze(["latin"]),
        licence: "OFL-1.1",
        copyright: "Copyright (c) 2010 j. 'mach' wust (j.mach.wust@gmail.com) with Reserved Font Name UnifrakturMaguntia. Copyright (c) 2009 Peter Wiegel (wiegel@peter-wiegel.de).",
        source: "https://fonts.google.com/specimen/UnifrakturMaguntia",
    }),
    Object.freeze({
        id: "kalam",
        name: "Kalam",
        category: "handwritten",
        ui: false,
        weights: Object.freeze([400,  700]),
        styles: Object.freeze(["normal"]),
        subsets: Object.freeze(["latin",  "latin-ext",  "devanagari"]),
        licence: "OFL-1.1",
        copyright: "Copyright (c) 2014 Indian Type Foundry (info@indiantypefoundry.com)",
        source: "https://fonts.google.com/specimen/Kalam",
    }),
    Object.freeze({
        id: "tangerine",
        name: "Tangerine",
        category: "handwritten",
        ui: false,
        weights: Object.freeze([400,  700]),
        styles: Object.freeze(["normal"]),
        subsets: Object.freeze(["latin"]),
        licence: "OFL-1.1",
        copyright: "Copyright (c) 2010 by Toshi Omagari. All rights reserved.",
        source: "https://fonts.google.com/specimen/Tangerine",
    }),
    Object.freeze({
        id: "alegreya-sans",
        name: "Alegreya Sans",
        category: "sans",
        ui: false,
        weights: Object.freeze([400,  700]),
        styles: Object.freeze(["normal",  "italic"]),
        subsets: Object.freeze(["latin",  "latin-ext"]),
        licence: "OFL-1.1",
        copyright: "Copyright 2013 The Alegreya Sans Project Authors",
        source: "https://github.com/huertatipografica/Alegreya-Sans",
    }),
    Object.freeze({
        id: "alegreya-sans-sc",
        name: "Alegreya Sans SC",
        category: "sans",
        ui: false,
        weights: Object.freeze([400,  700]),
        styles: Object.freeze(["normal",  "italic"]),
        subsets: Object.freeze(["latin",  "latin-ext"]),
        licence: "OFL-1.1",
        copyright: "Copyright 2013 The Alegreya Sans Project Authors",
        source: "https://github.com/huertatipografica/Alegreya-Sans",
    }),
    Object.freeze({
        id: "josefin-sans",
        name: "Josefin Sans",
        category: "sans",
        ui: false,
        weights: Object.freeze([400,  700]),
        styles: Object.freeze(["normal",  "italic"]),
        subsets: Object.freeze(["latin",  "latin-ext"]),
        licence: "OFL-1.1",
        copyright: "Copyright 2010 The Josefin Sans Project Authors, with Reserved Font Name \"Josefin Sans\".",
        source: "https://github.com/ThomasJockin/JosefinSansFont-master",
    }),
    Object.freeze({
        id: "noto-naskh-arabic",
        name: "Noto Naskh Arabic",
        category: "wide",
        ui: false,
        weights: Object.freeze([400,  700]),
        styles: Object.freeze(["normal"]),
        subsets: Object.freeze(["latin",  "latin-ext",  "arabic"]),
        licence: "OFL-1.1",
        copyright: "Copyright 2022 The Noto Project Authors",
        source: "https://github.com/notofonts/arabic",
    }),
    Object.freeze({
        id: "noto-serif",
        name: "Noto Serif",
        category: "wide",
        ui: false,
        weights: Object.freeze([400,  700]),
        styles: Object.freeze(["normal",  "italic"]),
        subsets: Object.freeze(["latin",  "latin-ext",  "greek",  "greek-ext",  "cyrillic",  "cyrillic-ext"]),
        licence: "OFL-1.1",
        copyright: "Copyright 2022 The Noto Project Authors",
        source: "https://github.com/notofonts/latin-greek-cyrillic",
    }),
    Object.freeze({
        id: "noto-serif-hebrew",
        name: "Noto Serif Hebrew",
        category: "wide",
        ui: false,
        weights: Object.freeze([400,  700]),
        styles: Object.freeze(["normal"]),
        subsets: Object.freeze(["latin",  "latin-ext",  "hebrew"]),
        licence: "OFL-1.1",
        copyright: "Copyright 2022 The Noto Project Authors",
        source: "https://github.com/notofonts/hebrew",
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

/** The vendored label fonts' names, in the picker's order. */
export function labelFontNames() {
    return FONT_FAMILIES.filter((family) => !family.ui).map((family) => family.name);
}

/**
 * The label font list for a host: the vendored fonts first, then the host's own (a Foundry world's
 * fonts) that are not among them.
 *
 * @param {string[]} [hostFonts]
 * @returns {string[]}
 */
export function labelFontList(hostFonts = []) {
    const vendored = labelFontNames();
    const known = new Set(vendored);
    return [...vendored, ...hostFonts.filter((name) => typeof name === "string" && name && !known.has(name) && known.add(name))];
}

/**
 * The label fonts of a list grouped for the picker: the vendored fonts by category, then the
 * host's own under `otherLabel`. Each font knows whether it has bold and italic faces.
 *
 * @param {string[]} names - The fonts offered (platform.fonts.list()).
 * @param {string} otherLabel - The localisation key of the group of the host's own fonts.
 * @returns {{label: string, fonts: {name: string, bold: boolean, italic: boolean}[]}[]}
 */
export function labelFontGroups(names, otherLabel) {
    const byName = new Map(FONT_FAMILIES.filter((family) => !family.ui).map((family) => [family.name, family]));
    const groups = LABEL_FONT_CATEGORIES.map((category) => ({ label: category.label, id: category.id, fonts: [] }));
    const other = { label: otherLabel, id: "other", fonts: [] };
    for (const name of names) {
        const family = byName.get(name);
        const entry = { name, bold: family ? family.weights.includes(700) : true, italic: family ? family.styles.includes("italic") : true };
        (groups.find((group) => group.id === family?.category) ?? other).fonts.push(entry);
    }
    return [...groups, other].filter((group) => group.fonts.length > 0);
}
