// The tool panel and the context bar (v4 step 3): each tool's Next footer and state word
// (each tool's registered next and stateWord), the bar's fold order (BarFold) and the stylesheet's
// promise that the mode in use is never folded, and the strings and icons the panels and the bar
// name. Layout itself needs a browser and is checked by the smoke checks.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const STRINGS = JSON.parse(readFileSync(join(ROOT, "languages/en.json"), "utf8"));
const CSS = readFileSync(join(ROOT, "styles/filrodens-world-map-builder.css"), "utf8");
const STUDIO_SOURCE = readFileSync(join(ROOT, "src/studios/world/app/MapStudio.js"), "utf8");
const PICK_TOOL_SOURCE = readFileSync(join(ROOT, "src/studios/world/app/PickTool.js"), "utf8");

const { FILRODENSWMB } = await import("../../src/config.js");
const { foldLevel, FOLD_LEVELS } = await import("../../src/shell/BarFold.js");
const { PAINT_MODES } = await import("../../src/studios/world/mesh/RegionPaint.js");
const { ROUTE_TOOL_MODES } = await import("../../src/studios/world/app/RouteTool.js");

// The World studio's registration (src/studios/world/definition.js), in the shapes these checks read
const { WORLD_DEFINITION } = await import("../../src/studios/world/definition.js");
const TOOLS = Object.fromEntries(WORLD_DEFINITION.tools.map((tool) => [tool.id, tool]));
const STAGES = WORLD_DEFINITION.stages.map((stage) => ({ ...stage, tools: WORLD_DEFINITION.tools.filter((tool) => tool.stage === stage.id).map((tool) => tool.id) }));
const NEXT = Object.fromEntries(WORLD_DEFINITION.tools.map((tool) => [tool.id, tool.next]));
const STATE_WORD = Object.fromEntries(WORLD_DEFINITION.tools.map((tool) => [tool.id, tool.stateWord]));
const { STATE_WORDS, FOLD_RANK } = FILRODENSWMB.STUDIO;

/** Every template under templates/, as [path, text]. */
function templates(dir = join(ROOT, "templates")) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return templates(path);
        return entry.name.endsWith(".hbs") ? [[path, readFileSync(path, "utf8")]] : [];
    });
}

test("every tool has a Next entry and a state word entry", () => {
    for (const tool of Object.keys(TOOLS)) {
        assert.ok(tool in NEXT, `${tool} has a NEXT entry`);
        assert.ok(tool in STATE_WORD, `${tool} has a STATE_WORD entry`);
    }
});

test("every map tool with a panel has a lede, about a sentence long, in en.json (S0 step 6)", () => {
    // The world's tools draw their own page lede (WorldEditors), and the 3D view and Worlds have no panel of their own
    const without = ["threeD", "manage", "worldOverview", "worldSetup", "worldCultures", "worldAges", "library", "worldBiomes", "worldGenerateAll"];
    for (const tool of Object.values(TOOLS)) {
        if (without.includes(tool.id)) {
            assert.equal(tool.lede, null, `${tool.id} has no lede`);
            continue;
        }
        assert.ok(tool.lede, `${tool.id} has a lede`);
        const text = STRINGS[tool.lede];
        assert.ok(text, `${tool.lede} is in en.json`);
        assert.ok(text.length <= 120 && /\.$/.test(text), `${tool.lede} is one sentence of about 100 characters`);
    }
});

test("Next follows the stages' order, ends at the last tool, and gives its reason", () => {
    // An optional stage's tools are outside the order of work
    const order = STAGES.filter((stage) => !stage.optional).flatMap((stage) => stage.tools);
    for (const [index, tool] of order.entries()) {
        const next = NEXT[tool];
        if (index === order.length - 1) {
            assert.equal(next, null, `${tool}, the last tool, has no Next`);
            continue;
        }
        assert.equal(next?.tool, order[index + 1], `${tool} leads to ${order[index + 1]}`);
        assert.ok(STRINGS[next.reason], `${next.reason} is in en.json`);
    }
    for (const tool of Object.keys(TOOLS).filter((id) => !order.includes(id))) {
        assert.equal(NEXT[tool], null, `${tool}, outside the stages, has no Next`);
    }
});

test("every state word has its name, start and stop buttons and paused line in en.json", () => {
    const words = new Set(Object.values(STATE_WORD).flatMap((entry) => (entry === null ? [] : typeof entry === "string" ? [entry] : Object.values(entry))));
    for (const word of words) {
        const suffix = STATE_WORDS[word];
        assert.ok(suffix, `${word} has its key suffix`);
        for (const part of ["StateWord", "StateStart", "StateStop", "StatePaused"]) {
            assert.ok(STRINGS[`FILRODENSWMB.UI.${part}${suffix}`], `${part}${suffix} is in en.json`);
        }
    }
});

test("the bar folds to the least level at which it fits, or the last when none does", () => {
    assert.equal(FOLD_LEVELS, 4);
    assert.equal(foldLevel([800, 700, 600, 500], 900), 0);
    assert.equal(foldLevel([800, 700, 600, 500], 800), 0);
    assert.equal(foldLevel([800, 700, 600, 500], 650), 2);
    assert.equal(foldLevel([800, 700, 600, 500], 520), 3);
    assert.equal(foldLevel([800, 700, 600, 500], 100), 3);
});

test("the stylesheet never folds, or takes the label from, the mode in use", () => {
    const rules = [...CSS.matchAll(/([^{}]*\[data-fold[^{}]*\.fwmb-mode[^{}]*)\{([^}]*)\}/g)];
    assert.ok(rules.length >= 2, "the bar has fold rules for its modes");
    for (const [, selector, body] of rules) {
        if (!/display:\s*none|fwmb-mode-label/.test(body + selector)) continue;
        assert.match(selector, /:not\(\[aria-checked="true"\]\)/, `${selector.trim()} spares the mode in use`);
    }
});

test("the modes that fold are modes their tool draws", () => {
    const drawn = {
        terrain: [...STUDIO_SOURCE.matchAll(/brush\("([A-Za-z]+)"/g)].map((match) => match[1]),
        features: [...STUDIO_SOURCE.matchAll(/feature\("([A-Za-z]+)"/g)].map((match) => match[1]),
        regions: PAINT_MODES,
        route: ROUTE_TOOL_MODES,
    };
    for (const [group, modes] of Object.entries(FOLD_RANK)) {
        assert.ok(modes.length > 0, `${group} folds something`);
        // Folding every mode would leave the bar nothing but More
        assert.ok(modes.length < drawn[group].length, `${group} keeps a mode on the bar`);
        for (const mode of modes) assert.ok(drawn[group].includes(mode), `${group}'s ${mode} is a mode the studio draws`);
    }
});

test("the bar's group names and mode labels are in en.json", () => {
    const keys = new Set([...STUDIO_SOURCE.matchAll(/ui\("(Modes?[A-Za-z]+)"\)/g)].map((match) => match[1]));
    for (const [, key] of STUDIO_SOURCE.matchAll(/(?:brush|feature)\("[A-Za-z]+", "(Mode[A-Za-z]+)"/g)) keys.add(key);
    // The region modes' labels are named after the modes
    for (const mode of PAINT_MODES) keys.add(`Mode${mode.charAt(0).toUpperCase()}${mode.slice(1)}`);
    for (const key of ["ModeSelect", "ModeDraw", "ModeWaypoints"]) keys.add(key);
    assert.ok(keys.size > 10, "the studio's mode labels were found");
    for (const key of keys) assert.ok(STRINGS[`FILRODENSWMB.UI.${key}`], `${key} is in en.json`);
});

test("every key a template passes to a section, the bar or a range is in en.json", () => {
    for (const [path, text] of templates()) {
        for (const [, key] of text.matchAll(/\b(?:title|badge|label|hint|addLabel)="(FILRODENSWMB\.[A-Za-z.]+)"/g)) {
            assert.ok(STRINGS[key], `${key} (${path.slice(ROOT.length)}) is in en.json`);
        }
    }
});

test("every icon the templates and the bar name has a mask, and every mask's file exists", () => {
    const masks = new Map([...CSS.matchAll(/\.fwmb-icon--([a-z0-9_-]+) \{\s*--fwmb-mask: url\("\.\.\/([^"]+)"\)/g)].map((match) => [match[1], match[2]]));
    for (const [icon, file] of masks) assert.ok(existsSync(join(ROOT, file)), `${icon}'s ${file} exists`);
    const named = new Set();
    for (const [, text] of templates()) {
        for (const [, icon] of text.matchAll(/\bicon="([a-z0-9_-]+)"/g)) named.add(icon);
        for (const [, icon] of text.matchAll(/fwmb-icon--([a-z0-9_-]+)/g)) named.add(icon);
    }
    // The bar's mode icons, from the studio's mode groups
    const groups = STUDIO_SOURCE.slice(STUDIO_SOURCE.indexOf("#barModeGroups() {"), STUDIO_SOURCE.indexOf("#barContext() {"));
    for (const [, icon] of groups.matchAll(/(?:(?<!group\()ui\("[A-Za-z]+"\)|cropTip), "([a-z0-9_-]+)"/g)) named.add(icon);
    for (const [, icon] of groups.matchAll(/(?:brush|feature)\("\w+", "\w+", "\w+", "([a-z0-9_-]+)"/g)) named.add(icon);
    // The Select and Place modes of pins and labels, from PickTool
    for (const [, icons] of PICK_TOOL_SOURCE.matchAll(/icons: \{([^}]+)\}/g)) for (const [, icon] of icons.matchAll(/"([a-z0-9_-]+)"/g)) named.add(icon);
    assert.ok(named.has("edit-arrow-up") && named.has("format-paint") && named.has("insert-text"), "the bar's mode icons were found");
    for (const icon of named) assert.ok(masks.has(icon), `fwmb-icon--${icon} has a mask`);
});

/** Every template under templates/, by its path from the root. */
function templateFiles(dir = join(ROOT, "templates")) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? templateFiles(join(dir, entry.name)) : entry.name.endsWith(".hbs") ? [join(dir, entry.name)] : []));
}

test("every button with no words of its own has a name or a tooltip, unless the code writes its words (L-surface step 6's sweep)", () => {
    // Buttons whose words the code fills in: the export dialogue's two fits, the cover's keep button
    const FILLED = ['data-export-fit="scale"', 'data-export-fit="area"', 'data-action="keepProcessing"'];
    const unnamed = [];
    for (const file of templateFiles()) {
        for (const [, attributes, inner] of readFileSync(file, "utf8").matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
            if (/aria-label=|aria-labelledby=|data-tooltip=|title=/.test(attributes) || FILLED.some((mark) => attributes.includes(mark))) continue;
            const words = inner.replace(/<(span|i) class="fwmb-icon[^"]*"[^>]*>\s*<\/\1>/g, "").replace(/<[^>]+>/g, "").replace(/\{\{[#/]?(if|unless|else|each)[^}]*\}\}/g, "");
            if (!words.trim()) unnamed.push(`${file.slice(ROOT.length)}: <button${attributes}>`);
        }
    }
    assert.deepEqual(unnamed, []);
});
