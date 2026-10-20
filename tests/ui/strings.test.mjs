// The interface's strings (languages/en.json and en-gb.json): every key the code names exists and
// every key in en.json is used, either by name or through one of the families of keys the code
// builds from a value (a mode's name, a hint's suffix); en-gb.json holds only what British English
// spells differently, and holds all of it; en.json is US English; labels are in sentence case; no
// string sets an aside off with a dash; and no code falls back to hard-coded English when a key is
// missing.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const EN = JSON.parse(readFileSync(join(ROOT, "languages/en.json"), "utf8"));
const GB = JSON.parse(readFileSync(join(ROOT, "languages/en-gb.json"), "utf8"));

/** Every file under a folder (or the file itself) with one of the extensions. */
function files(path, extensions) {
    const full = join(ROOT, path);
    if (!statSync(full).isDirectory()) return [full];
    return readdirSync(full, { recursive: true })
        .map((name) => join(full, name))
        .filter((name) => extensions.some((extension) => name.endsWith(extension)));
}

const SOURCES = ["src", "templates", "web", "main.js", "module.json"].flatMap((path) => files(path, [".js", ".mjs", ".hbs", ".json", ".html"])).map((path) => ({ path, text: readFileSync(path, "utf8") }));
const SOURCE = SOURCES.map((file) => file.text).join("\n");
const CONFIG = readFileSync(join(ROOT, "src/config.js"), "utf8");
const STUDIO = readFileSync(join(ROOT, "src/applications/MapStudio.js"), "utf8");
/** Every quoted word in the code, which the families below look their values up in. */
const LITERALS = new Set([...SOURCE.matchAll(/["'`]([A-Za-z0-9_]+)["'`]/g)].map((match) => match[1]));

/**
 * The keys the code builds from a value rather than names: the family's prefix and where its
 * values come from. A key of a family is used when its value appears in the code as a quoted word
 * (as it is, or with its first letter lowered, as the code capitalises values such as "fill").
 */
const FAMILIES = [
    { prefix: "FILRODENSWMB.UI.Hint", values: CONFIG },
    { prefix: "FILRODENSWMB.UI.Shortcut", values: CONFIG },
    // The bar's groups and modes, named by suffix through MapStudio's ui(), mode() and the like
    { prefix: "FILRODENSWMB.UI.", values: STUDIO },
    "FILRODENSWMB.UI.Mode",
    "FILRODENSWMB.UI.RouteLeg",
    "FILRODENSWMB.UI.Transport",
    "FILRODENSWMB.UI.StateWord",
    "FILRODENSWMB.UI.StateStart",
    "FILRODENSWMB.UI.StateStop",
    "FILRODENSWMB.UI.StatePaused",
    "FILRODENSWMB.UI.LabelFilter_",
    "FILRODENSWMB.UI.Justify",
    "FILRODENSWMB.UI.PinDetailLevel",
    "FILRODENSWMB.UI.RouteClass",
    "FILRODENSWMB.UI.RuleEditorZone",
    "FILRODENSWMB.BIOMES.",
];

function usedByFamily(key) {
    return FAMILIES.some((family) => {
        const { prefix, values } = typeof family === "string" ? { prefix: family } : family;
        if (!key.startsWith(prefix)) return false;
        const value = key.slice(prefix.length);
        const lowered = value.charAt(0).toLowerCase() + value.slice(1);
        if (values) return values.includes(`"${value}"`) || values.includes(`"${lowered}"`);
        return LITERALS.has(value) || LITERALS.has(lowered) || LITERALS.has(value.toLowerCase());
    });
}

/** A style list's usage word for one ("1 route uses…") is its many word's key with "One" after it. */
const usedAsOne = (key) => key.endsWith("One") && SOURCE.includes(`"${key.slice(0, -3)}"`) && SOURCE.includes("}One`");

test("every key in en.json is used, by name or through a family of keys built from a value", () => {
    const unused = Object.keys(EN).filter((key) => !SOURCE.includes(key) && !usedByFamily(key) && !usedAsOne(key));
    assert.deepEqual(unused, [], "remove these from en.json (and en-gb.json), or name them in FAMILIES if the code builds them");
});

test("every key the code names is in en.json", () => {
    const namespaces = new Set(Object.keys(EN).map((key) => key.split(".")[1]));
    // Prefixes the code finishes with a value (see FAMILIES), and the style lists' usage words
    const prefixes = new Set(FAMILIES.map((family) => (typeof family === "string" ? family : family.prefix)));
    const missing = [];
    for (const { path, text } of SOURCES) {
        for (const [key] of text.matchAll(/FILRODENSWMB\.[A-Za-z]+\.[A-Za-z0-9_.]*[A-Za-z0-9_]/g)) {
            const segments = key.split(".");
            // Config constants share the namespace's name (FILRODENSWMB.LABELS.DEFAULT_TEXT, or a
            // method called on one, FILRODENSWMB.UI.VECTOR_TOOLS.includes): skip them
            if (!namespaces.has(segments[1]) || segments.slice(2).some((segment) => /^[A-Z0-9_]+$/.test(segment))) continue;
            if (key in EN || prefixes.has(key)) continue;
            missing.push(`${key} (${path.slice(ROOT.length)})`);
        }
    }
    assert.deepEqual(missing, []);
});

/** US spellings and their British forms, as en-gb.json must give them. */
const US_GB = {
    color: "colour", colors: "colours", colored: "coloured", center: "centre", centers: "centres", centered: "centred",
    initialization: "initialisation", randomize: "randomise", randomized: "randomised", recognized: "recognised",
    neighbor: "neighbour", neighbors: "neighbours", neighboring: "neighbouring", dialog: "dialogue", dialogs: "dialogues",
    license: "licence", gray: "grey", behavior: "behaviour", favorite: "favourite", customize: "customise", organize: "organise",
};
const swap = (text, table) => text.replace(/[A-Za-z]+/g, (word) => {
    const swapped = table[word.toLowerCase()];
    if (!swapped) return word;
    return word[0] === word[0].toUpperCase() ? swapped[0].toUpperCase() + swapped.slice(1) : swapped;
});
const GB_US = Object.fromEntries(Object.entries(US_GB).map(([us, gb]) => [gb, us]));

test("en.json is US English, and en-gb.json gives the British spelling of every string that differs, and nothing else", () => {
    const british = Object.entries(EN).filter(([, text]) => swap(text, GB_US) !== text).map(([key]) => key);
    assert.deepEqual(british, [], "en.json is written in US English");
    for (const [key, text] of Object.entries(GB)) {
        assert.ok(key in EN, `${key} in en-gb.json is in en.json`);
        assert.notEqual(text, EN[key], `${key} in en-gb.json differs from en.json`);
    }
    for (const [key, text] of Object.entries(EN)) {
        const gb = swap(text, US_GB);
        if (gb !== text) assert.equal(GB[key], gb, `${key} has its British spelling in en-gb.json`);
    }
});

/** Words that keep their capital inside a sentence-case label. */
const PROPER = new Set(
    `Foundry VTT Filroden Filroden's World Map Builder Delaunay Pixi Three Handlebars Material Symbols Pinhead Atkinson Hyperlegible
    Sora Barlow Semi Condensed Noto Serif Sans Ko-fi GitHub Sponsors Ctrl Shift Alt Enter Escape Esc Backspace Tab Space Home End
    American`.split(/\s+/),
);
const isLabel = (text) => text.length <= 70 && !/[.?!]$/.test(text.trim()) && !/[.?!] [A-Z{]/.test(text);

test("labels are in sentence case", () => {
    const titled = [];
    for (const [key, text] of Object.entries(EN)) {
        if (!isLabel(text) || text === "Filroden's World Map Builder") continue;
        // A word may start a label, or follow a colon, a sentence's end or a "+" (Ctrl+Click)
        const words = [...text.matchAll(/(^|[\s(/,-])([A-Z][a-z][A-Za-z'’]*)/g)].filter((match) => match.index > 0 && !/[:+]\s*$/.test(text.slice(0, match.index + match[1].length)));
        // A word with a capital inside it is a name (OrbitControls, GitHub), not a title-cased one
        const capitals = words.map((match) => match[2]).filter((word) => !PROPER.has(word) && !PROPER.has(word.replace(/['’]s$/, "")) && !/[A-Z]/.test(word.slice(1)));
        if (capitals.length) titled.push(`${key}: ${text}`);
    }
    assert.deepEqual(titled, []);
});

test("no string sets an aside off with a dash", () => {
    const dashed = Object.entries(EN).filter(([, text]) => / [-–—] /.test(text)).map(([key, text]) => `${key}: ${text}`);
    assert.deepEqual(dashed, [], "use brackets, a colon or a new sentence");
});

test("no code falls back to hard-coded English when a string is missing", () => {
    const fallbacks = SOURCES.filter(({ path }) => path.endsWith(".js")).flatMap(({ path, text }) => [...text.matchAll(/(?:localize|format)\([^)]*\)\s*\|\|\s*["'`]/g)].map((match) => `${path.slice(ROOT.length)}: ${match[0]}`));
    assert.deepEqual(fallbacks, []);
});
