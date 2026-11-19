// The world bar (templates/shell/worldbar.hbs, S0 step 3): its fold order, the parts that never
// fold, and the first-opening notice's text (FirstOpening). The bar's measuring and the modes are
// checked in a browser (the step's web checks).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { foldLevel } from "../../src/shell/BarFold.js";
import { WORLD_BAR_LEVELS } from "../../src/shell/WorldBarFold.js";
import { FirstOpening } from "../../src/studios/world/app/FirstOpening.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const CSS = readFileSync(`${ROOT}styles/filrodens-world-map-builder.css`, "utf8");
const TEMPLATE = readFileSync(`${ROOT}templates/shell/worldbar.hbs`, "utf8");
const EN = JSON.parse(readFileSync(`${ROOT}languages/en.json`, "utf8"));

test("the bar folds as little as it can: the first level that fits, the last when none does", () => {
    const widths = [1700, 1500, 1380, 1210, 1020, 900];
    assert.equal(WORLD_BAR_LEVELS, widths.length);
    assert.equal(foldLevel(widths, 1800), 0);
    assert.equal(foldLevel(widths, 1600), 1);
    assert.equal(foldLevel(widths, 1400), 2);
    assert.equal(foldLevel(widths, 1100), 4);
    assert.equal(foldLevel(widths, 700), 5);
});

test("each fold has its form in the stylesheet, and Save world, the modes and World never fold", () => {
    const foldRules = [...CSS.matchAll(/\.fwmb-worldbar(?::not\()?(?::is\()?\[data-fold[^{]*\{[^}]*\}/g)].map((match) => match[0]);
    assert.ok(foldRules.length >= 5, "the folds' rules");
    for (const rule of foldRules) {
        for (const never of [".fwmb-save", ".fwmb-mode-switch", ".fwmb-worldbar-world"]) assert.ok(!rule.includes(never), `${never} is never folded: ${rule.slice(0, 80)}`);
    }
    // Open world and Save as into the menu from 1, short names from 2, Settlement maps gone from 3,
    // the layer menu from 4, the name shortened at 5
    assert.match(CSS, /\.fwmb-worldbar:not\(\[data-fold="0"\]\) \.fwmb-worldbar-files \{\s*display: none;/);
    assert.match(CSS, /\.fwmb-worldbar\[data-fold="0"\] \.fwmb-fold-menu \{\s*display: none;/);
    assert.match(CSS, /\.fwmb-worldbar:not\(\[data-fold="0"\], \[data-fold="1"\]\) \.fwmb-fold-short \{\s*display: inline;/);
    assert.match(CSS, /\.fwmb-worldbar:is\(\[data-fold="3"\], \[data-fold="4"\], \[data-fold="5"\]\) \.fwmb-worldbar-settlements \{\s*display: none;/);
    assert.match(CSS, /\.fwmb-worldbar:is\(\[data-fold="4"\], \[data-fold="5"\]\) \.fwmb-layers-menu \{\s*display: flex;/);
    assert.match(CSS, /\.fwmb-worldbar\[data-fold="5"\] \.fwmb-worldbar-menu \{\s*max-width:/);
    for (const part of ["fwmb-world-menu", "fwmb-save", "fwmb-worldbar-files", "fwmb-layers", "fwmb-layers-menu", "fwmb-worldbar-settlements", "fwmb-mode-switch", "fwmb-worldbar-world"]) assert.ok(TEMPLATE.includes(part), `the template draws ${part}`);
});

test("parts later tracks fill are drawn disabled, keeping their tooltips (aria-disabled, never disabled)", () => {
    assert.ok(!/\sdisabled[\s>]/.test(TEMPLATE), "no part is disabled outright, so its tooltip still shows");
    assert.match(EN["FILRODENSWMB.UI.NotBuiltYet"], /\{name\}/);
});

const i18n = { localize: (key) => EN[key] ?? key, format: (key, data) => (EN[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(data[name])), lang: "en" };

test("a world made from a 4.3 map is told what changed, and that it opened in Explore when it did", () => {
    const plain = FirstOpening.context({ held: false, migration: { from: "4.3", changed: [] } }, { explore: true, source: null, link: "https://example.com" }, i18n);
    assert.deepEqual(plain.items, [EN["FILRODENSWMB.UI.FirstOpeningSurface"], EN["FILRODENSWMB.UI.FirstOpeningSettings"], EN["FILRODENSWMB.UI.FirstOpeningExplore"]]);
    assert.equal(plain.link, "https://example.com");
    const noRun = FirstOpening.context({ held: false, migration: { from: "4.3" } }, { explore: false, source: null, link: "" }, i18n);
    assert.equal(noRun.items.length, 2);
});

test("a held regional world is told where its settings come from, and what was taken or carried up", () => {
    const held = FirstOpening.context({ held: true, migration: { from: "4.3", changed: ["climate", "styles", "icons"], addedStyles: 2, addedBiomes: 1 } }, { explore: false, source: "Aethoria", link: "" }, i18n);
    assert.equal(held.items.length, 4);
    assert.match(held.items[1], /held by Aethoria/);
    assert.match(held.items[2], /Aethoria's are used now: Styles and icons and Climate base|Aethoria's are used now: Climate base and Styles and icons/);
    assert.match(held.items[3], /2 styles and 1 custom biomes it had of its own were added to Aethoria/);
    const unchanged = FirstOpening.context({ held: true, migration: { from: "4.3", changed: [] } }, { explore: false, source: "Aethoria", link: "" }, i18n);
    assert.equal(unchanged.items.length, 2);
});
