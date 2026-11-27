// The stylesheets both hosts load (RF1): Foundry loads module.json's "styles", the web page its own
// <link> tags, and the two must be the same sheets in the same order, so the studio looks the same
// in both. The web page loads its own web/web-base.css first (the page's frame, which Foundry
// provides itself). Every sheet in styles/ is loaded, the fonts first.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { FONTS_SHEET, STUDIO_SHEET, THEME_SHEET, moduleStylesheets } from "../support/stylesheets.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** The stylesheets a page links, in order. */
function linkedStylesheets(html) {
    return [...html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*>/g)].map(([tag]) => /\bhref="([^"]+)"/.exec(tag)?.[1]);
}

test("module.json and the web page load the same stylesheets in the same order", () => {
    const web = linkedStylesheets(readFileSync(`${ROOT}web/index.html`, "utf8"));
    assert.equal(web[0], "web/web-base.css", "the web page's own sheet first");
    assert.deepEqual(web.slice(1), moduleStylesheets());
});

test("every sheet in styles/ is loaded, the fonts first and the studio's last", () => {
    const sheets = moduleStylesheets();
    const inFolder = readdirSync(`${ROOT}styles`, { recursive: true })
        .map((name) => `styles/${String(name).replaceAll("\\", "/")}`)
        .filter((name) => name.endsWith(".css"));
    assert.deepEqual([...sheets].sort(), inFolder.sort());
    assert.deepEqual(sheets, [FONTS_SHEET, THEME_SHEET, STUDIO_SHEET]);
});

test("the stylesheet check finds what it looks for", () => {
    assert.deepEqual(linkedStylesheets('<link rel="icon" href="a.svg" /><link rel="stylesheet" href="x.css" /><link href="y.css" rel="stylesheet">'), ["x.css", "y.css"]);
});
