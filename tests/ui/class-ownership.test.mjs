// Every class the studio uses is the module's own, and every length in its stylesheets is in rem.
//
// Classes: a class that is not the module's (Foundry's form-group, a bare "active" or "small")
// lets a host's stylesheet reach into the studio, and looks different in Foundry and on the web.
// So every class token in the templates, and every class the scripts set, starts with "fwmb-".
// States are ARIA attributes (aria-pressed, aria-selected, aria-current, disabled) or fwmb-is-*.
//
// Lengths: the studio follows the browser's zoom and Foundry's interface scale only if its sizes
// are rem. The one exception is a 1px hairline and the 2px focus ring (an outline), which should
// stay crisp at any scale. Pixel values that are map data (a brush size, a line thickness) are
// numbers handed to the canvas, not CSS, and are not affected.
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

/** Every px length in a stylesheet's declarations (comments dropped), with its line. A 2px length
 * is allowed in an outline or outline-offset declaration only. */
function pxLengths(text) {
    const found = [];
    const code = text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
    const lines = code.split("\n");
    for (const declaration of code.matchAll(/([\w-]+)\s*:\s*([^;{}]+)/g)) {
        const isOutline = /^outline(-offset)?$/.test(declaration[1]);
        for (const [, number] of declaration[2].matchAll(/(-?\d*\.?\d+)px\b/g)) {
            const size = Math.abs(Number(number));
            if (size === 1 || (isOutline && size === 2)) continue;
            const line = code.slice(0, declaration.index).split("\n").length;
            found.push(`${line}: ${lines[line - 1].trim()}`);
        }
    }
    return found;
}

test("the stylesheets size everything in rem, apart from 1px hairlines and the 2px focus ring", () => {
    const found = [];
    for (const file of [...filesIn("styles", /\.css$/), ...filesIn("web", /\.css$/)]) {
        for (const where of pxLengths(file.text)) found.push(`${file.name}:${where}`);
    }
    assert.deepEqual(found, [], `px lengths:\n${found.join("\n")}`);
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
    assert.deepEqual(pxLengths("a {\n    width: 8px;\n    border: 1px solid;\n    outline: 2px solid;\n    border: 2px solid;\n}"), ["2: width: 8px;", "5: border: 2px solid;"]);
});
