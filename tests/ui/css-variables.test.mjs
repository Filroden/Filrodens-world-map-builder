// The module's CSS custom properties: every --fwmb-* property the stylesheets, templates and
// scripts read is defined somewhere (an undefined one makes the declaration that reads it fall
// back silently, as a label's colour did in the light theme); the theme's four themes define the
// same tokens, with the same values whichever way a theme is chosen; and every pair of colours
// the interface puts together passes its WCAG AA contrast in all four themes.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { THEME_SHEET } from "../support/stylesheets.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SOURCES = [
    ["styles", /\.css$/],
    ["web", /\.(css|html|js)$/],
    ["templates", /\.hbs$/],
    ["src", /\.js$/],
    [".", /^main\.js$/],
];

function filesIn(folder, pattern) {
    const path = join(ROOT, folder);
    const entries = readdirSync(path, { withFileTypes: true, recursive: folder !== "." });
    return entries.filter((entry) => entry.isFile() && pattern.test(entry.name)).map((entry) => join(entry.parentPath ?? entry.path, entry.name));
}

const files = SOURCES.flatMap(([folder, pattern]) => filesIn(folder, pattern)).map((path) => ({
    name: relative(ROOT, path).replaceAll("\\", "/"),
    text: readFileSync(path, "utf8"),
}));

/** Where each --fwmb-* property is read, as "file:line" lists keyed by name. */
function readsOf(file, into) {
    file.text.split("\n").forEach((line, index) => {
        for (const [, name] of line.matchAll(/var\(\s*(--fwmb-[\w-]+)/g)) {
            if (!into.has(name)) into.set(name, []);
            into.get(name).push(`${file.name}:${index + 1}`);
        }
    });
}

/** The --fwmb-* properties a file defines: declared in CSS or a style attribute, or named in a
 * script (which sets it at run time, as the range slider's fill and a pin's icon mask are). */
function definitionsOf(file, into) {
    for (const [, name] of file.text.matchAll(/(--fwmb-[\w-]+)\s*:/g)) into.add(name);
    if (!file.name.endsWith(".js")) return;
    for (const [, name] of file.text.matchAll(/["'`](--fwmb-[\w-]+)["'`]/g)) into.add(name);
}

test("every --fwmb-* custom property that is read is defined", () => {
    const reads = new Map();
    const defined = new Set();
    for (const file of files) {
        readsOf(file, reads);
        definitionsOf(file, defined);
    }
    const missing = [...reads].filter(([name]) => !defined.has(name)).map(([name, where]) => `${name} (${where.join(", ")})`);
    assert.deepEqual(missing, [], `Undefined custom properties:\n${missing.join("\n")}`);
});

/** The tokens defined by the theme rule whose selector contains the text given. */
function tokensOf(theme, selectorText) {
    const rule = [...theme.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(([, selector]) => selector.includes(selectorText));
    assert.ok(rule, `No theme rule for ${selectorText}`);
    return [...rule[2].matchAll(/(--fwmb-[\w-]+)\s*:/g)].map(([, name]) => name).sort();
}

test("the theme's light and dark blocks, and its gold and blue (stored as teal) blocks, define the same tokens", () => {
    const theme = files.find((file) => file.name === THEME_SHEET).text;
    assert.deepEqual(tokensOf(theme, '[data-fwmb-theme="light"]'), tokensOf(theme, '[data-fwmb-theme="dark"]'));
    assert.deepEqual(tokensOf(theme, '[data-fwmb-hue="teal"]'), tokensOf(theme, '[data-fwmb-hue="gold"]'));
});

const THEMES = [
    ["gold", "dark"],
    ["gold", "light"],
    ["teal", "dark"],
    ["teal", "light"],
];

/** Every rule of the theme stylesheet whose selector names a hue or a theme class, with its tokens. */
function themeRules(css) {
    return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .map(([, selector, body]) => ({
            selector: selector.replace(/\/\*[\s\S]*?\*\//g, "").trim(),
            tokens: Object.fromEntries([...body.matchAll(/(--fwmb-[\w-]+)\s*:\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()])),
        }))
        .filter((rule) => /data-fwmb-hue|theme-(dark|light)/.test(rule.selector));
}

/** The tokens of one theme, from the rule that applies the reader's explicit choice. */
function themeTokens(css, hue, mode) {
    const rule = themeRules(css).find((candidate) => candidate.selector.includes(`[data-fwmb-theme="${mode}"][data-fwmb-hue="${hue}"]`));
    assert.ok(rule, `No theme rule for ${hue} ${mode}`);
    return rule.tokens;
}

test("every way of choosing a theme gives the same tokens", () => {
    const theme = files.find((file) => file.name === THEME_SHEET).text;
    for (const [hue, mode] of THEMES) {
        const expected = themeTokens(theme, hue, mode);
        const rules = themeRules(theme).filter((rule) => rule.selector.includes(`theme-${mode}`) && (rule.selector.includes(`"${hue}"`) || (hue === "gold" && !rule.selector.includes('"teal"'))));
        assert.ok(rules.length >= 2, `${hue} ${mode}: the automatic rules are missing`);
        for (const rule of rules) assert.deepEqual(rule.tokens, expected, `${hue} ${mode}: ${rule.selector}`);
    }
});

/** WCAG relative luminance of a #rrggbb colour. */
function luminance(hex) {
    const channel = (offset) => {
        const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a, b) {
    const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (high + 0.05) / (low + 0.05);
}

/**
 * The pairs the interface puts together and the contrast each needs: v5's (the design system's
 * Contrast card), then v4's that v5 does not already cover, as design/tokens/gen-tokens.py checks
 * them. v4's white text on the accent fill no longer holds in gold light by design: its fill is a
 * bright gold that takes dark text (text-on-accent).
 */
const CONTRAST_PAIRS = [
    ["text-primary", "bg-panel", 7], // Primary text on the world bar (panel)
    ["accent-main", "bg-panel", 3], // World bar icons (accent) on the panel
    ["text-secondary", "bg-base", 4.5], // Layer names (secondary) on the switcher (base)
    ["text-primary", "bg-selected", 4.5], // Current layer: primary text on selected
    ["accent-secondary", "bg-selected", 3], // Current layer: bar and icon (secondary) on selected
    ["text-on-accent", "fill-accent", 4.5], // Mode switch: text on the accent fill
    ["fill-accent-edge", "bg-panel", 3], // Accent fill edge on the panel
    ["text-on-accent", "fill-accent-hover", 4.5], // Accent fill hover: text on it
    ["color-warning", "bg-panel", 4.5], // Out of date mark (warning) on the panel
    ["color-warning", "bg-base", 4.5], // Out of date mark on the switcher (base)
    ["text-secondary", "bg-panel", 4.5], // Older generator mark (secondary) on the panel
    ["accent-main", "bg-panel", 4.5], // Held mark (accent) on the panel
    ["color-success", "bg-panel", 4.5], // Up to date mark (success) on the panel
    ["accent-secondary", "bg-raised", 3], // Unsaved dot (secondary) on raised
    ["text-primary", "bg-raised", 4.5], // Settlement bar: primary text on raised
    ["text-muted", "bg-raised", 4.5], // Settlement bar: menu head (muted) on raised
    ["text-secondary", "bg-panel", 4.5], // Lede (secondary) on the panel
    ["text-secondary", "bg-base", 4.5], // Go block: secondary text on base
    ["accent-secondary", "bg-raised", 4.5], // Go button: secondary accent on raised
    ["accent-secondary-hover", "bg-selected", 4.5], // Go button hover: secondary hover on selected
    ["text-secondary", "bg-base", 4.5], // Action notice: secondary text on base
    ["color-warning", "bg-base", 3], // Action notice: warning icon and edge on base
    ["text-primary", "bg-highlight", 4.5], // Held banner: primary title on highlight
    ["text-secondary", "bg-highlight", 4.5], // Held banner: secondary text on highlight
    ["accent-main", "bg-highlight", 3], // Held banner: accent icon and edge on highlight
    ["text-muted", "bg-selected", 4.5], // Selected row: muted meta on selected
    ["accent-secondary", "bg-selected", 4.5], // Selected row: secondary accent on selected
    ["accent-secondary", "bg-panel", 4.5], // Working state text (secondary) on the panel
    ["text-muted", "bg-panel", 4.5], // Card meta (muted) on the panel
    ["text-primary", "bg-raised", 4.5], // Chips: primary text on raised
    ["text-muted", "bg-base", 4.5], // Stats: muted label on base
    ["text-muted", "bg-panel", 4.5], // Households card: muted key on the panel
    ["text-secondary", "bg-raised", 4.5], // Tags: secondary text on raised (header)
    ["color-danger", "bg-raised", 4.5], // Delete: danger text on raised
    ["text-inverse", "fill-negative", 4.5], // Delete hover: white on negative fill
    ["text-inverse", "fill-secondary", 4.5], // Reserved badge: white on secondary fill
    ["border-strong", "bg-panel", 3], // Swatch ring (strong border) on the panel
    ["overlay-accent-secondary", "overlay-control", 3], // Open map menu (overlay secondary) on overlay control
    ["overlay-accent-secondary", "overlay-bg", 4.5], // Overlay secondary text on overlay
    ["overlay-accent", "overlay-control", 3], // Partial dot (overlay accent) on overlay control
    ["text-on-accent", "fill-accent", 4.5], // Map button pressed: icon on the accent fill
    ["text-primary", "bg-base", 7], // Primary text on base
    ["text-muted", "bg-panel", 4.5], // Muted text on the panel
    ["accent-main", "bg-base", 4.5], // Accent text on base
    ["accent-secondary", "bg-panel", 4.5], // Secondary accent on the panel
    ["text-inverse", "fill-positive", 4.5], // White on the positive fill
    ["text-inverse", "fill-caution", 4.5], // White on the caution fill
    ["color-danger", "bg-panel", 4.5], // Danger text on the panel
    ["badge-text", "badge-bg", 4.5], // Badge text on badge
    ["border-focus", "bg-panel", 3], // Focus ring on the panel
    ["range-fill", "range-track", 3], // Range fill on its track
    ["overlay-text", "overlay-bg", 7], // Overlay text on overlay
    ["overlay-muted", "overlay-bg", 4.5], // Overlay muted on overlay
    ["overlay-accent", "overlay-bg", 4.5], // Overlay accent on overlay
    ["canvas-surround", "#000000", 3], // Canvas surround against a black border
    ["canvas-surround", "#ffffff", 3], // Canvas surround against a white border
    ["canvas-surround", "overlay-bg", 3], // Canvas surround against the overlays
];

test("every colour pair passes its WCAG AA contrast in all four themes", () => {
    const theme = files.find((file) => file.name === THEME_SHEET).text;
    const failures = [];
    for (const [hue, mode] of THEMES) {
        const tokens = themeTokens(theme, hue, mode);
        for (const [foreground, background, needed] of CONTRAST_PAIRS) {
            const colour = (name) => (name.startsWith("#") ? name : tokens[`--fwmb-${name}`]);
            const ratio = contrast(colour(foreground), colour(background));
            if (!(ratio >= needed)) failures.push(`${hue} ${mode}: ${foreground} on ${background} is ${ratio.toFixed(2)}:1, needs ${needed}:1`);
        }
    }
    assert.deepEqual(failures, []);
});

