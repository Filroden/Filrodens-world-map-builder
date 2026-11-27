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
import { allTrades, wordKey } from "../../src/studios/local/app/Households.js";
import { FORMS, HOUSEHOLD_HEADS, LINEAGES, ORDERS, WIVES } from "../../src/kernel/names/NameConventions.js";

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
// FILRODENSWMB's text, from every layer's part of it (RF1: src/config.js puts them together)
const CONFIG = ["src/kernel/config.js", "src/shell/config.js", "src/platform/config.js", "src/studios/world/config.js", "src/studios/local/config.js"].map((path) => readFileSync(join(ROOT, path), "utf8")).join("\n");
const STUDIO = readFileSync(join(ROOT, "src/studios/world/app/MapStudio.js"), "utf8");
const DEFINITION = readFileSync(join(ROOT, "src/studios/world/definition.js"), "utf8");
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
    // Each map tool's lede, by its id (definition.js's tool())
    { prefix: "FILRODENSWMB.UI.Lede", values: DEFINITION },
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
    "FILRODENSWMB.UI.CultureRelief",
    // An age's era, strife and event, by the preset's id (a key in GENERATOR.ERAS, GENERATOR.STRIFES)
    // or the event's kind
    { prefix: "FILRODENSWMB.UI.GenerateEra", values: CONFIG.replace(/(\w+):/g, '"$1":') },
    { prefix: "FILRODENSWMB.UI.GenerateStrife", values: CONFIG.replace(/(\w+):/g, '"$1":') },
    "FILRODENSWMB.UI.GenerateEvent",
    // What an era, strife or event does, and an event's kind and group, by the era's, kind's or group's id
    // (GENERATOR.ERAS, GENERATOR.EVENTS)
    { prefix: "FILRODENSWMB.UI.GenerateEraHint", values: CONFIG.replace(/(\w+):/g, '"$1":') },
    { prefix: "FILRODENSWMB.UI.GenerateStrifeHint", values: CONFIG.replace(/(\w+):/g, '"$1":') },
    { prefix: "FILRODENSWMB.UI.GenerateEventKind", values: CONFIG },
    { prefix: "FILRODENSWMB.UI.GenerateEventHint", values: CONFIG },
    { prefix: "FILRODENSWMB.UI.GenerateEventGroup", values: CONFIG.replace(/(\w+):/g, '"$1":') },
    "FILRODENSWMB.BIOMES.",
    // A settlement's lie in Make settlement map's From the pin, by the engine's LIES (CellContext)
    "FILRODENSWMB.UI.FromPinLie.",
    "FILRODENSWMB.UI.FromPinLie",
    // What changed on an Out of date settlement map, by its input's parts (SettlementRecord.PARTS)
    { prefix: "FILRODENSWMB.UI.SettlementChanged.", values: readFileSync(join(ROOT, "src/studios/local/data/SettlementRecord.js"), "utf8").replace(/(\w+):/g, '"$1":') },
    "FILRODENSWMB.UI.SettlementChanged",
    // Households and supply (step 3): a household's trade, its group, wealth and members' roles,
    // where a trade is drawn to and a house stands, a supply route's way and the household views,
    // by the engine's own words (tests/local/households.test.mjs holds that each has its string)
    { prefix: "FILRODENSWMB.UI.HouseholdTrade.", values: JSON.stringify([...allTrades().keys(), "miller's man"].map(wordKey)) },
    { prefix: "FILRODENSWMB.UI.HouseholdRole.", values: JSON.stringify(["servant", "apprentice", "journeyman", "miller's man", "lodger"].map(wordKey)) },
    "FILRODENSWMB.UI.HouseholdTrade",
    "FILRODENSWMB.UI.HouseholdRole",
    "FILRODENSWMB.UI.HouseholdGroup.",
    "FILRODENSWMB.UI.HouseholdGroup",
    "FILRODENSWMB.UI.HouseholdWealth.",
    "FILRODENSWMB.UI.HouseholdWealth",
    "FILRODENSWMB.UI.HouseholdWhere.",
    "FILRODENSWMB.UI.HouseholdWhere",
    "FILRODENSWMB.UI.HousePlace.",
    "FILRODENSWMB.UI.HousePlace",
    "FILRODENSWMB.UI.SupplyBy.",
    "FILRODENSWMB.UI.SupplyBy",
    "FILRODENSWMB.UI.SettlementView.",
    "FILRODENSWMB.UI.SettlementView",
    // Map setup's Walls and Look (L-surface step 4), by the record's own values
    "FILRODENSWMB.UI.SettlementWalls.",
    "FILRODENSWMB.UI.SettlementWalls",
    "FILRODENSWMB.UI.SettlementLook.",
    "FILRODENSWMB.UI.SettlementLook",
    // A culture's names settings (N3: CultureEditor's NAME_FIELDS), by the conventions' own values
    // ("given-first" as GivenFirst), each with its lower-case form for Automatic's words
    ...[["PersonForm", FORMS], ["PersonOrder", ORDERS], ["PersonLineage", LINEAGES], ["PersonSpouse", WIVES], ["PersonHeads", HOUSEHOLD_HEADS]].map(([stem, values]) => {
        const keys = values.map((value) => value.replace(/(^|-)(\w)/g, (_m, _d, c) => c.toUpperCase()));
        return { prefix: `FILRODENSWMB.UI.${stem}`, values: JSON.stringify([...keys, ...keys.map((key) => `${key}Lower`)]) };
    }),
    // The generator's stages, by their ids in GENERATOR.STAGES (and writing onto the map)
    { prefix: "FILRODENSWMB.UI.GenerateStage", values: CONFIG + '"materialise"' },
    // The name styles, by the name bases' names with their spaces taken out
    { prefix: "FILRODENSWMB.NameBase.", values: readFileSync(join(ROOT, "vendor/azgaar-names/name-bases.js"), "utf8").replaceAll(" ", "") },
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
    license: "licence", gray: "grey", urbanization: "urbanisation", behavior: "behaviour", favorite: "favourite", customize: "customise", organize: "organise",
    kilometer: "kilometre", kilometers: "kilometres", colonize: "colonise", colonization: "colonisation",
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

/**
 * Words that keep their capital inside a sentence-case label (Create and Explore are the studio's
 * two modes, named; Surface, Geology, Underground and Aerial name a world's kinds of map).
 */
const PROPER = new Set(
    `Foundry VTT Filroden Filroden's World Map Builder Delaunay Pixi Three Handlebars Material Symbols Pinhead Atkinson Hyperlegible
    Sora Barlow Semi Condensed Noto Serif Sans Ko-fi GitHub Sponsors Ctrl Shift Alt Enter Escape Esc Backspace Tab Space Home End
    American Political Create Explore Surface Geology Underground Aerial`.split(/\s+/),
);
/**
 * Strings that are the pattern of a proper name rather than a label: the generator names a castle
 * "{name} Castle", and the keep word is part of the name, capital and all; so are Random name's
 * forms ("{name} Coast", "Port {name}"; the NameForm keys).
 */
const NAME_PATTERNS = new Set(["FILRODENSWMB.UI.GeneratedCastleName", "FILRODENSWMB.UI.GeneratedKeepName", "FILRODENSWMB.UI.GeneratedHoldName", "FILRODENSWMB.UI.GeneratedTowerName"]);
const isNamePattern = (key) => NAME_PATTERNS.has(key) || key.startsWith("FILRODENSWMB.UI.NameForm");
const isLabel = (text) => text.length <= 70 && !/[.?!]$/.test(text.trim()) && !/[.?!] [A-Z{]/.test(text);

test("labels are in sentence case", () => {
    const titled = [];
    for (const [key, text] of Object.entries(EN)) {
        if (!isLabel(text) || text === "Filroden's World Map Builder" || isNamePattern(key)) continue;
        // A word may start a label, or follow a colon, a sentence's end, a "+" (Ctrl+Click) or a
        // menu path's "›" (World › Climate base: each step is the name of a menu's item)
        const words = [...text.matchAll(/(^|[\s(/,-])([A-Z][a-z][A-Za-z'’]*)/g)].filter((match) => match.index > 0 && !/[:+›]\s*$/.test(text.slice(0, match.index + match[1].length)));
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

/**
 * Names inside sentences are quoted (roadmap decision 40): a thing's name (a world's, map's,
 * settlement's, pin's, region's, tier's, set's, culture's, style's, icon's, biome's or file's) that
 * sits among other words is set in curly quotation marks in the string itself, so translators use
 * their own marks; a name standing alone is bare. These placeholders carry such names wherever they
 * appear ({name} also carries a tool's or a font's name in the keys exempt below).
 */
const NAME_PLACEHOLDERS = ["name", "world", "owner", "parent", "source", "place", "level", "set", "tier"];

/**
 * Where a name placeholder stands alone and stays bare, by key or by key prefix:
 * - strings that make a name (a title, a landform's, a copy's, an older map's, a file's);
 * - a name heading a row, its figures or its role after it (household members, seat and minority
 *   lines, shares, the history's event captions, "Capital: …", a world's menu "…: the world's menu");
 * - a title or label then its value after a mark ("Generate all · …", "Settlement map: …",
 *   "region · …"), or a name with a note in brackets after it ("… (its rank now)");
 * - placeholders that are not a thing's name there: a tool's label (Go to, Not built yet), a font,
 *   a tier's number, a phrase ("A house on the market"), the template token {name} itself.
 */
const BARE_PREFIXES = ["FILRODENSWMB.UI.NameForm", "FILRODENSWMB.UI.Generated", "FILRODENSWMB.UI.GenerateEvent", "FILRODENSWMB.UI.GenerateSeat", "FILRODENSWMB.UI.Household", "FILRODENSWMB.UI.WindowTitle", "FILRODENSWMB.UI.InspectorSubtitle"];
const BARE_KEYS = new Set([
    "UI.FontMissing", "UI.ThematicCultureValue", "UI.HistoryCapital", "UI.HistoryExportName", "UI.TravelExportName", "UI.TravelExportNameNoPlace",
    "UI.RangeBandFrom", "UI.RangeBandTo", "UI.GenerateRegionMinorityItem", "UI.StyleCopyName", "UI.SaveAsCopyName", "UI.LayerName",
    "UI.LevelTitleTemplateHint", "UI.WorldNameMenuHint", "UI.NotBuiltYet", "UI.GoTo", "UI.GoToOn", "UI.GenerateAllTitle", "UI.CutAgainOldName",
    "JOURNAL.WorldHeldBy", "UI.StandaloneMapName", "UI.CopyMapName", "UI.RegionalMapName", "UI.NumberedMapName", "UI.RestoreSummaryFailure",
    "UI.EngineVersion", "UI.GenerateAllSettlementName", "UI.FromPinSettlement", "UI.HouseNamedAt", "UI.HouseAt",
    "UI.MoveAsMissing", "UI.MoveAsCurrent", "UI.LabelOwnerRegionMeta",
].map((key) => `FILRODENSWMB.${key}`));
const isBare = (key) => BARE_KEYS.has(key) || BARE_PREFIXES.some((prefix) => key.startsWith(prefix));

test("names inside sentences are in curly quotation marks; names standing alone are bare", () => {
    assert.deepEqual([...BARE_KEYS].filter((key) => !(key in EN)), [], "a bare key no longer in en.json");
    const placeholder = new RegExp(`\\{(${NAME_PLACEHOLDERS.join("|")})\\}`, "g");
    for (const [file, strings] of [["en.json", EN], ["en-gb.json", GB]]) {
        const unquoted = [];
        const straight = [];
        for (const [key, text] of Object.entries(strings)) {
            for (const match of text.matchAll(placeholder)) {
                const before = text[match.index - 1];
                const after = text[match.index + match[0].length];
                if (before === '"' || after === '"' || before === "'" && after === "'") straight.push(`${key}: ${text}`);
                else if (!isBare(key) && !(before === "“" && after === "”")) unquoted.push(`${key}: ${text}`);
            }
        }
        assert.deepEqual([...new Set(straight)], [], `${file}: straight quotation marks round a name`);
        assert.deepEqual([...new Set(unquoted)], [], `${file}: a name inside a sentence, unquoted (quote it, or add the key to the bare list on purpose)`);
    }
});

test("no possessive is put on a quoted name", () => {
    assert.deepEqual(Object.entries(EN).filter(([, text]) => /”['’]s\b/.test(text)).map(([key, text]) => `${key}: ${text}`), [], "reword: “the map of “…”” rather than “…”’s map");
});
