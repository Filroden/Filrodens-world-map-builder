// The vendored fonts (src/data/fonts.js): every listed file exists, each family's licence sits
// beside its files, nothing in assets/fonts/ is left out of the list, and the stylesheet's
// @font-face rules describe exactly the faces the list holds. Then the label fonts: the list each
// host offers, the picker's groups, the default and the fallback for a family the host lacks, the
// faces a label is drawn in, the styles a new map starts with, and their credits in the README.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { DEFAULT_LABEL_FONT, FONT_FAMILIES, FONTS_FOLDER, LABEL_FONT_CATEGORIES, fontFaces, fontLicencePath, hasStyle, hasWeight, labelFontGroups, labelFontList, labelFontNames } from "../../src/data/fonts.js";
import { FILRODENSWMB } from "../../src/config.js";
import { LabelFonts } from "../../src/tools/LabelFonts.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const THEME = readFileSync(join(ROOT, "styles/fwmb-theme.css"), "utf8");

test("every face's file and every family's licence exist", () => {
    const missing = [];
    for (const family of FONT_FAMILIES) {
        for (const face of fontFaces(family)) if (!existsSync(join(ROOT, face.path))) missing.push(face.path);
        if (!existsSync(join(ROOT, fontLicencePath(family)))) missing.push(fontLicencePath(family));
    }
    assert.deepEqual(missing, []);
});

test("every file in the fonts folder is listed", () => {
    const listed = new Set(FONT_FAMILIES.flatMap((family) => [...fontFaces(family).map((face) => face.path), fontLicencePath(family)]));
    const extra = [];
    for (const folder of readdirSync(join(ROOT, FONTS_FOLDER))) {
        for (const name of readdirSync(join(ROOT, FONTS_FOLDER, folder))) {
            const path = `${FONTS_FOLDER}/${folder}/${name}`;
            if (!listed.has(path)) extra.push(path);
        }
    }
    assert.deepEqual(extra, []);
});

/** The faces the stylesheet declares, in the same shape as fontFaces() plus the family name. */
function declaredFaces(css) {
    return [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(([, body]) => {
        const read = (property) => body.match(new RegExp(`${property}\\s*:\\s*([^;]+);`))?.[1].trim();
        return {
            family: read("font-family").replaceAll('"', ""),
            weight: Number(read("font-weight")),
            style: read("font-style"),
            path: read("src").match(/url\("\.\.\/([^"]+)"\)/)?.[1],
            unicodeRange: read("unicode-range"),
        };
    });
}

test("the stylesheet's @font-face rules are the registry's faces", () => {
    const key = (face) => JSON.stringify([face.family, face.weight, face.style, face.path, face.unicodeRange]);
    const expected = FONT_FAMILIES.flatMap((family) => fontFaces(family).map((face) => ({ family: family.name, ...face })))
        .map(key)
        .sort();
    assert.deepEqual(declaredFaces(THEME).map(key).sort(), expected);
});

test("every family carries its licence and credit", () => {
    for (const family of FONT_FAMILIES) {
        assert.equal(family.licence, "OFL-1.1", family.name);
        assert.ok(family.copyright && family.source, `${family.name} needs its copyright line and source`);
        assert.match(readFileSync(join(ROOT, fontLicencePath(family)), "utf8"), /SIL OPEN FONT LICENSE Version 1\.1/);
    }
});

const STRINGS = JSON.parse(readFileSync(join(ROOT, "languages/en.json"), "utf8"));
const README = readFileSync(join(ROOT, "README.md"), "utf8");
// Every vendored family is a label font; the interface's own are the picker's "Studio faces"
const labelFamilies = FONT_FAMILIES;

test("every label font is in a category with a name, and every family is credited in the README", () => {
    const categories = new Set(LABEL_FONT_CATEGORIES.map((category) => category.id));
    for (const category of LABEL_FONT_CATEGORIES) assert.ok(STRINGS[category.label], `${category.label} is in en.json`);
    for (const family of labelFamilies) {
        assert.ok(categories.has(family.category), `${family.name}'s category ${family.category}`);
        assert.ok(README.includes(`[${family.name}](${family.source})`) && README.includes(`(${fontLicencePath(family)})`), `${family.name} has its README row`);
    }
});

test("the default label font is vendored and covers Greek and Cyrillic", () => {
    const family = labelFamilies.find((candidate) => candidate.name === DEFAULT_LABEL_FONT);
    assert.ok(family);
    for (const subset of ["latin", "latin-ext", "greek", "cyrillic"]) assert.ok(family.subsets.includes(subset), subset);
    assert.equal(FILRODENSWMB.LABELS.DEFAULT_FONT, DEFAULT_LABEL_FONT);
});

test("a host's label fonts are the vendored ones first, then its own that are not among them, once each", () => {
    assert.deepEqual(labelFontList(), labelFontNames());
    assert.deepEqual(labelFontList(["Signika", "EB Garamond", "Signika", ""]), [...labelFontNames(), "Signika"]);
});

test("the picker groups the fonts by category in order, the host's own last", () => {
    const groups = labelFontGroups(["Signika", "Cinzel", "EB Garamond", "Alegreya", "Kalam"], "Other");
    assert.deepEqual(groups.map((group) => [group.id, group.fonts.map((font) => font.name)]), [["book", ["EB Garamond", "Alegreya"]], ["engraved", ["Cinzel"]], ["handwritten", ["Kalam"]], ["other", ["Signika"]]]);
    assert.deepEqual(groups[0].fonts[0], { name: "EB Garamond", bold: true, italic: true });
    assert.equal(groups[1].fonts[0].italic, false, "Cinzel has no italic of its own");
});

test("the studio's own faces are label fonts, first in the picker, with regular, bold and the italics vendored", () => {
    const studio = FONT_FAMILIES.filter((family) => family.ui);
    assert.deepEqual(studio.map((family) => family.name), ["Atkinson Hyperlegible", "Sora", "Barlow Semi Condensed"]);
    for (const family of studio) {
        assert.equal(family.category, "studio");
        assert.ok(family.weights.includes(400) && family.weights.includes(700), `${family.name} has regular and bold`);
    }
    assert.equal(LABEL_FONT_CATEGORIES[0].id, "studio");
    const groups = labelFontGroups(["EB Garamond", "Sora", "Barlow Semi Condensed", "Atkinson Hyperlegible"], "Other");
    assert.deepEqual(groups[0], { label: "FILRODENSWMB.UI.FontCategoryStudio", id: "studio", fonts: [{ name: "Sora", bold: true, italic: false }, { name: "Barlow Semi Condensed", bold: true, italic: true }, { name: "Atkinson Hyperlegible", bold: true, italic: true }] });
    // Barlow's italic is only in the label weights, not the interface's 500 and 600
    const barlow = FONT_FAMILIES.find((family) => family.id === "barlow-semi-condensed");
    assert.deepEqual([...new Set(fontFaces(barlow).filter((face) => face.style === "italic").map((face) => face.weight))], [400, 700]);
});

test("what a family can be drawn in: a vendored family's own faces, a host's font anything", () => {
    assert.equal(hasStyle("Sora", "italic"), false);
    assert.equal(hasStyle("EB Garamond", "italic"), true);
    assert.equal(hasWeight("Uncial Antiqua", 700), false);
    assert.equal(hasWeight("Cinzel", 700), true);
    assert.equal(hasStyle("Signika", "italic"), true, "a host's own font");
});

test("a label in a family without an italic (or bold) face is drawn upright (or regular), its setting kept", () => {
    LabelFonts.setAvailable(null);
    const label = { fontFamily: "Sora", bold: true, italic: true };
    assert.equal(LabelFonts.spec(label), 'normal bold 16px "Sora"');
    assert.equal(label.italic, true);
    assert.equal(LabelFonts.spec({ fontFamily: "Uncial Antiqua", italic: true }), 'normal normal 16px "Uncial Antiqua"');
    assert.equal(LabelFonts.spec({ fontFamily: "Barlow Semi Condensed", italic: true }), 'italic bold 16px "Barlow Semi Condensed"');
});

test("a label is drawn bold unless it says otherwise, upright unless italic, in its family or the default", () => {
    LabelFonts.setAvailable(["EB Garamond", DEFAULT_LABEL_FONT]);
    try {
        assert.equal(LabelFonts.spec({ fontFamily: "EB Garamond" }), 'normal bold 16px "EB Garamond"');
        assert.equal(LabelFonts.spec({ fontFamily: "EB Garamond", bold: false, italic: true }, 20), 'italic normal 20px "EB Garamond"');
        assert.equal(LabelFonts.family({ fontFamily: "Signika" }), DEFAULT_LABEL_FONT, "a family the host lacks is drawn in the default");
        assert.equal(LabelFonts.family({}), DEFAULT_LABEL_FONT);
        assert.deepEqual(LabelFonts.missing([{ fontFamily: "Signika" }, { fontFamily: "EB Garamond" }, { fontFamily: "Signika" }, {}]), ["Signika"]);
    } finally {
        LabelFonts.setAvailable(null);
    }
});

test("a new map's label styles use vendored families, and their names are localised", () => {
    const names = new Set(labelFontNames());
    for (const style of FILRODENSWMB.LABELS.DEFAULT_STYLES) {
        assert.ok(names.has(style.fontFamily), `${style.id}'s ${style.fontFamily}`);
        assert.ok(STRINGS[style.nameKey], `${style.nameKey} is in en.json`);
        assert.equal(typeof style.bold, "boolean");
        assert.equal(typeof style.italic, "boolean");
        const family = labelFamilies.find((candidate) => candidate.name === style.fontFamily);
        if (style.italic) assert.ok(family.styles.includes("italic"), `${style.fontFamily} has an italic`);
    }
});
