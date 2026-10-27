// The credits (src/data/credits.js): every vendored folder (vendor/ and assets/fonts/) has an
// entry whose licence file is there, every entry's text is in en.json, and the README's
// third-party table is the one written from them (scripts/credits-readme.mjs).
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { FONT_LICENCE, LIBRARY_CREDITS, fontCredits } from "../../src/data/credits.js";
import { writtenReadme } from "../../scripts/credits-readme.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const STRINGS = JSON.parse(readFileSync(join(ROOT, "languages/en.json"), "utf8"));
const credits = [...LIBRARY_CREDITS, ...fontCredits()];

test("every folder of vendor/ and assets/fonts/ has a credit, and every credit's licence file is there", () => {
    const folders = new Set(credits.map((credit) => credit.folder));
    for (const parent of ["vendor", "assets/fonts"]) {
        for (const name of readdirSync(join(ROOT, parent))) assert.ok(folders.has(`${parent}/${name}`), `${parent}/${name} has a credit`);
    }
    for (const credit of credits) assert.ok(existsSync(join(ROOT, credit.folder, credit.licenceFile)), `${credit.folder}/${credit.licenceFile} exists`);
    assert.ok(fontCredits().every((credit) => credit.licence === FONT_LICENCE));
});

test("every library's description is in en.json", () => {
    for (const credit of LIBRARY_CREDITS) assert.ok(STRINGS[credit.what], `${credit.what} is in en.json`);
});

test("the README's third-party table is the one written from the credits", () => {
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    assert.equal(writtenReadme(readme, STRINGS), readme, "run node scripts/credits-readme.mjs");
});
