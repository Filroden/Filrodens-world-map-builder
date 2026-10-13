// The module's CSS custom properties: every --fwmb-* property the stylesheets, templates and
// scripts read is defined somewhere (an undefined one makes the declaration that reads it fall
// back silently, as a label's colour did in the light theme), and the theme's light and dark
// blocks (and its gold and teal blocks) define the same tokens, so none is missing in one theme.
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
