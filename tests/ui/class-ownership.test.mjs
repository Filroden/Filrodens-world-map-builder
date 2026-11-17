// Every class the studio uses is the module's own, and every length in its stylesheets follows the
// length rule.
//
// Classes: a class that is not the module's (Foundry's form-group, a bare "active" or "small")
// lets a host's stylesheet reach into the studio, and looks different in Foundry and on the web.
// So every class token in the templates, and every class the scripts set, starts with "fwmb-".
// States are ARIA attributes (aria-pressed, aria-selected, aria-current, disabled) or fwmb-is-*.
//
// Lengths (Ken, 2026-11-17): text, containers, spacing (margins, padding, gaps), images and
// positioning are rem, so the studio follows the browser's zoom and Foundry's interface scale;
// strokes (borders and outlines), shadows and radii are px, so they stay crisp at any scale. The
// offsets of an absolutely placed element (top, right, bottom, left, inset) may be px where they
// must be. A 1px length is allowed anywhere (a hairline). A CSS triangle (a shape drawn
// from transparent borders) is an icon sized with the text, so its borders stay rem. Pixel values that
// are map data (a brush size, a line thickness) are numbers handed to the canvas, not CSS, and are not
// affected.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

function filesIn(folder, pattern) {
    const entries = readdirSync(join(ROOT, folder), { withFileTypes: true, recursive: true });
    return entries
        .filter((entry) => entry.isFile() && pattern.test(entry.name))
        .map((entry) => join(entry.parentPath ?? entry.path, entry.name))
        .map((path) => ({ name: relative(ROOT, path).replaceAll("\\", "/"), text: readFileSync(path, "utf8") }));
}

const lineOf = (text, index) => text.slice(0, index).split("\n").length;

/**
 * The class tokens of a class attribute's value. Handlebars expressions are dropped, so a
 * conditional class (`{{#if x}}fwmb-is-on{{/if}}`) keeps its literal text and a computed one
 * (`fwmb-icon--{{key}}`) keeps its literal prefix, which is what must be the module's.
 */
function classTokens(value) {
    return value
        .replace(/\{\{[\s\S]*?\}\}/g, " ")
        .split(/\s+/)
        .filter(Boolean);
}

test("every class in the templates is the module's own", () => {
    const foreign = [];
    for (const file of filesIn("templates", /\.hbs$/)) {
        for (const match of file.text.matchAll(/\bclass="((?:[^"{]|\{\{[\s\S]*?\}\})*)"/g)) {
            for (const token of classTokens(match[1])) {
                if (!token.startsWith("fwmb-")) foreign.push(`${file.name}:${lineOf(file.text, match.index)} ${token}`);
            }
        }
    }
    assert.deepEqual(foreign, [], `Classes that are not the module's own:\n${foreign.join("\n")}`);
});

test("every class the scripts set is the module's own", () => {
    const foreign = [];
    // Literal class names handed to classList, or assigned as a className or inside HTML
    const patterns = [
        /classList\.(?:add|remove|toggle|contains)\(\s*(["'`])([^"'`$]+)\1/g,
        /className\s*=\s*(["'`])([^"'`]*)\1/g,
        /class=\\?(["'])([^"'\\]*)\\?\1/g,
    ];
    // src/hooks/ draws into Foundry's own sidebar, where its button takes Foundry's classes to match
    // the buttons beside it; nothing there is part of the studio
    for (const file of filesIn("src", /\.js$/).filter((entry) => !entry.name.startsWith("src/hooks/"))) {
        for (const pattern of patterns) {
            for (const match of file.text.matchAll(pattern)) {
                for (const token of classTokens(match[2].replace(/\$\{[^}]*\}/g, ""))) {
                    if (!token.startsWith("fwmb-")) foreign.push(`${file.name}:${lineOf(file.text, match.index)} ${token}`);
                }
            }
        }
    }
    assert.deepEqual(foreign, [], `Classes that are not the module's own:\n${foreign.join("\n")}`);
});

/** The properties that draw a stroke, a shadow or a corner: their lengths are px. */
const STROKE = /^(border(-(top|right|bottom|left|block|inline)(-(start|end))?)?(-width)?|border-([a-z-]+-)?radius|outline(-offset|-width)?|box-shadow|text-shadow|column-rule(-width)?|text-decoration-thickness|-webkit-text-stroke(-width)?)$/;

/** The offsets of a placed element, which may be px. */
const OFFSET = /^(top|right|bottom|left|inset(-(block|inline)(-(start|end))?)?)$/;

/** A rule that draws a triangle out of transparent borders. */
const TRIANGLE = /border[\w-]*\s*:[^;]*transparent/;

/** The classes of a selector's last compound selectors (one per comma-separated part). */
const lastClasses = (selector) => selector.split(",").flatMap((part) => [...(part.trim().split(/\s+/).pop() ?? "").matchAll(/\.(fwmb-[\w-]+)/g)].map((match) => match[1]));

/**
 * Every length in a stylesheet that breaks the rule, with its line: a px length outside a stroke,
 * shadow, radius or placed element's offset (other than 1px), or a rem length in a stroke, shadow
 * or radius (other than a triangle's borders, and
 * the borders of a rule restyling a triangle's class).
 */
function badLengths(text) {
    const code = text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
    const lines = code.split("\n");
    const rules = [...code.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    const triangles = new Set(rules.filter(([, , body]) => TRIANGLE.test(body)).flatMap(([, selector]) => lastClasses(selector)));
    const found = [];
    for (const rule of rules) {
        const [, selector, body] = rule;
        const triangle = TRIANGLE.test(body) || lastClasses(selector).some((name) => triangles.has(name));
        const bodyStart = rule.index + selector.length + 1;
        for (const declaration of body.matchAll(/(?<![\w-])([\w-]+)\s*:\s*([^;{}]+)/g)) {
            const [, property, value] = declaration;
            if (property.startsWith("--") || OFFSET.test(property)) continue;
            const strokeLengths = STROKE.test(property) && !(triangle && property.startsWith("border") && !property.includes("radius"));
            const bad = strokeLengths
                ? [...value.matchAll(/(-?\d*\.?\d+)rem\b/g)].filter(([, number]) => Number(number) !== 0)
                : [...value.matchAll(/(-?\d*\.?\d+)px\b/g)].filter(([, number]) => ![0, 1].includes(Math.abs(Number(number))));
            if (!bad.length) continue;
            const line = code.slice(0, bodyStart + declaration.index).split("\n").length;
            found.push(`${line}: ${lines[line - 1].trim()}`);
        }
    }
    return found;
}

test("the stylesheets size text and containers in rem, and strokes, shadows and radii in px", () => {
    const found = [];
    for (const file of [...filesIn("styles", /\.css$/), ...filesIn("web", /\.css$/)]) {
        for (const where of badLengths(file.text)) found.push(`${file.name}:${where}`);
    }
    assert.deepEqual(found, [], `Lengths against the rule:\n${found.join("\n")}`);
});

test("the templates' style attributes size nothing in px", () => {
    const found = [];
    for (const file of filesIn("templates", /\.hbs$/)) {
        for (const match of file.text.matchAll(/\bstyle="([^"]*)"/g)) {
            if (/\d\s*px\b/.test(match[1].replace(/\b1px\b/g, ""))) found.push(`${file.name}:${lineOf(file.text, match.index)} ${match[1]}`);
        }
    }
    assert.deepEqual(found, [], `px in style attributes:\n${found.join("\n")}`);
});

test("the checks find what they look for", () => {
    assert.deepEqual(classTokens('fwmb-btn {{#if on}}active{{/if}} fwmb-icon--{{key}}'), ["fwmb-btn", "active", "fwmb-icon--"]);
    const css = [
        ".fwmb-a {",
        "    width: 8px;",
        "    border: 1px solid;",
        "    outline: 2px solid;",
        "    border: 0.125rem solid;",
        "    border-radius: 6px;",
        "    height: 1px;",
        "    box-shadow: 0 0.5rem 1rem #000;",
        "    top: 4px;",
        "    padding: 4px;",
        "}",
        ".fwmb-t {",
        "    border-top: 0.375rem solid transparent;",
        "}",
        ".fwmb-b .fwmb-t {",
        "    border-top-width: 0.5rem;",
        "}",
    ].join("\n");
    assert.deepEqual(badLengths(css), ["2: width: 8px;", "5: border: 0.125rem solid;", "8: box-shadow: 0 0.5rem 1rem #000;", "10: padding: 4px;"]);
});
