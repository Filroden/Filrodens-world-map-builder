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

test("the theme's light and dark blocks, and its gold and teal blocks, define the same tokens", () => {
    const theme = files.find((file) => file.name === "styles/fwmb-theme.css").text;
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
    const theme = files.find((file) => file.name === "styles/fwmb-theme.css").text;
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

/** The pairs the interface puts together and the contrast each needs (the design system's list). */
const CONTRAST_PAIRS = [
    ["text-primary", "bg-base", 7],
    ["text-primary", "bg-panel", 7],
    ["text-secondary", "bg-panel", 4.5],
    ["text-muted", "bg-panel", 4.5],
    ["text-muted", "bg-base", 4.5],
    ["text-primary", "bg-highlight", 4.5],
    ["accent-main", "bg-panel", 4.5],
    ["accent-main", "bg-base", 4.5],
    ["accent-secondary", "bg-panel", 4.5],
    ["text-inverse", "fill-accent", 4.5],
    ["text-inverse", "fill-secondary", 4.5],
    ["text-inverse", "fill-positive", 4.5],
    ["text-inverse", "fill-caution", 4.5],
    ["text-inverse", "fill-negative", 4.5],
    ["color-danger", "bg-panel", 4.5],
    ["color-warning", "bg-panel", 4.5],
    ["color-success", "bg-panel", 4.5],
    ["badge-text", "badge-bg", 4.5],
    ["border-strong", "bg-panel", 3],
    ["border-focus", "bg-panel", 3],
    ["range-fill", "range-track", 3],
    ["overlay-text", "overlay-bg", 7],
    ["overlay-muted", "overlay-bg", 4.5],
    ["overlay-accent", "overlay-bg", 4.5],
    ["overlay-accent-secondary", "overlay-bg", 4.5],
    // The canvas surround against a black and a white map border and against the overlays drawn on it
    ["canvas-surround", "#000000", 3],
    ["canvas-surround", "#ffffff", 3],
    ["canvas-surround", "overlay-bg", 3],
];

test("every colour pair passes its WCAG AA contrast in all four themes", () => {
    const theme = files.find((file) => file.name === "styles/fwmb-theme.css").text;
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

