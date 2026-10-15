// The studio's frame: the rail's tools and stages (FILRODENSWMB.STUDIO), the width and height
// rules StudioLayout writes, the hint's items and inks, and the keyboard shortcuts sheet, which is
// built from the same lists as the hint. Layout itself needs a browser and is checked by the smoke
// checks; here are the rules and the data behind it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const STRINGS = JSON.parse(readFileSync(join(ROOT, "languages/en.json"), "utf8"));
const CSS = readFileSync(join(ROOT, "styles/filrodens-world-map-builder.css"), "utf8");

const { FILRODENSWMB } = await import("../../src/config.js");
const { widthClass, isShort, STUDIO_WIDTH, STUDIO_SHORT_BELOW } = await import("../../src/ui/StudioLayout.js");
const { CanvasHints } = await import("../../src/canvas/CanvasHints.js");
const { MapStudio } = await import("../../src/applications/MapStudio.js");

const { TOOLS, STAGES, OCCASIONAL } = FILRODENSWMB.STUDIO;

test("the studio's width classes switch at 1,400 and 1,200px, and it is short below 680px", () => {
    assert.deepEqual([STUDIO_WIDTH.COMPACT_BELOW, STUDIO_WIDTH.NARROW_BELOW, STUDIO_SHORT_BELOW], [1400, 1200, 680]);
    assert.equal(widthClass(3840), "wide");
    assert.equal(widthClass(1400), "wide");
    assert.equal(widthClass(1399), "compact");
    assert.equal(widthClass(1200), "compact");
    assert.equal(widthClass(1199), "narrow");
    assert.equal(widthClass(1100), "narrow");
    assert.equal(isShort(679), true);
    assert.equal(isShort(680), false);
});

test("the rail holds the three stages in order, then the occasional tools", () => {
    assert.deepEqual(
        STAGES.map((stage) => [stage.id, stage.tools]),
        [
            ["shape", ["scene", "terrain", "biomes", "features"]],
            ["populate", ["regions", "infrastructure", "labels"]],
            ["finish", ["cartography", "export"]],
        ],
    );
    assert.deepEqual(
        OCCASIONAL.map((entry) => entry.tool ?? entry.action),
        ["reference", "library", "settings", "threeDView"],
    );
});

test("every tool on the rail has an icon with a mask and a name in en.json, and a panel", () => {
    const railTools = [...STAGES.flatMap((stage) => stage.tools), ...OCCASIONAL.filter((entry) => entry.tool).map((entry) => entry.tool), "manage"];
    for (const id of railTools) {
        const tool = TOOLS[id];
        assert.ok(tool, `${id} is in STUDIO.TOOLS`);
        assert.ok(STRINGS[tool.label], `${tool.label} is in en.json`);
        assert.match(CSS, new RegExp(`\\.fwmb-icon--${tool.icon} \\{`), `${tool.icon} has an icon mask`);
        assert.doesNotThrow(() => readFileSync(join(ROOT, `templates/tools-${id}.hbs`)), `templates/tools-${id}.hbs exists`);
    }
    for (const stage of STAGES) assert.ok(STRINGS[stage.label], `${stage.label} is in en.json`);
    for (const entry of OCCASIONAL.filter((item) => item.action)) {
        assert.ok(MapStudio.ACTIONS[entry.action], `${entry.action} has a handler`);
        assert.ok(STRINGS[entry.label], `${entry.label} is in en.json`);
    }
});

test("the map controls' toggles have names in en.json and icons with masks", () => {
    for (const layer of [...FILRODENSWMB.STUDIO.VIEW_LAYERS, ...FILRODENSWMB.STUDIO.OVERLAY_LAYERS]) {
        assert.ok(STRINGS[layer.label], `${layer.label} is in en.json`);
        assert.match(CSS, new RegExp(`\\.fwmb-icon--${layer.icon} \\{`), `${layer.icon} has an icon mask`);
    }
    assert.match(STRINGS["FILRODENSWMB.UI.LayersMenuCount"], /\{shown\}.*\{total\}/);
});

test("a hint lists the mode's actions first in the normal ink, then movement, muted", () => {
    const items = CanvasHints.getItems("regionPaint");
    assert.deepEqual(
        items.map((item) => [item.key.replace("FILRODENSWMB.UI.Hint", ""), item.more]),
        [
            ["RegionPaint", false],
            ["RegionPaintShift", false],
            ["Pan", true],
            ["Zoom", true],
        ],
    );
    // A held item's list has no movement; viewing has nothing but movement
    assert.ok(CanvasHints.getItems("heldPin").every((item) => !item.more));
    assert.ok(CanvasHints.getItems("view").every((item) => item.more));
});

test("the hint draws one item per action, movement muted", () => {
    const window = new Window();
    after(() => window.happyDOM.close());
    const element = window.document.createElement("div");
    CanvasHints.render(element, CanvasHints.getItems("terrain"), (key) => key);
    const children = [...element.children];
    assert.deepEqual(
        children.map((child) => [child.textContent, child.classList.contains("fwmb-more")]),
        [
            ["FILRODENSWMB.UI.HintPaintTerrain", false],
            ["FILRODENSWMB.UI.HintPan", true],
            ["FILRODENSWMB.UI.HintZoom", true],
        ],
    );
    assert.ok(children.every((child) => child.tagName === "SPAN"), "the hint holds nothing to click");
    assert.ok(MapStudio.ACTIONS.openShortcuts, "the shortcuts sheet still has its action");
});

test("the shortcuts sheet covers every hint context, and every string it uses exists", () => {
    const { CONTEXTS } = FILRODENSWMB.UI.CANVAS_HINTS;
    const { KEYS, SHEET } = FILRODENSWMB.UI.SHORTCUTS;
    const listed = SHEET.flatMap((tool) => tool.tables.map((table) => table.context));
    // "view" has no actions of its own (only movement, which "everywhere" lists)
    assert.deepEqual(Object.keys(CONTEXTS).filter((context) => context !== "view" && !listed.includes(context)), []);
    for (const context of Object.keys(KEYS)) assert.ok(context === "everywhere" || context in CONTEXTS, `${context} is a hint context`);

    const missing = [];
    const localize = (key) => {
        if (!(key in STRINGS)) missing.push(key);
        return key;
    };
    const sheet = CanvasHints.sheet(localize);
    assert.equal(sheet.length, SHEET.length);
    assert.ok(sheet.every((tool) => tool.tables.every((table) => table.rows.length > 0)), "no table is empty");
    assert.deepEqual(missing, []);
});
