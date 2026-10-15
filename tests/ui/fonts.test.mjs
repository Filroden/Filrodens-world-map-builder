// The vendored fonts (src/data/fonts.js): every listed file exists, each family's licence sits
// beside its files, nothing in assets/fonts/ is left out of the list, and the stylesheet's
// @font-face rules describe exactly the faces the list holds.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { FONT_FAMILIES, FONTS_FOLDER, fontFaces, fontLicencePath } from "../../src/data/fonts.js";

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
