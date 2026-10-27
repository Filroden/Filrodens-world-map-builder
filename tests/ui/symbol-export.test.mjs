// Symbol size (SymbolScale): Auto from how much a map is magnified against its world, a chosen
// size, and names' outlines in proportion to them; and the PNG export's scales (ExportScale): what
// each makes, which are allowed, the recommendation and its reason, and the tiles.
import "../mesh/foundry-stubs.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { FILRODENSWMB } from "../../src/config.js";
import { SymbolScale } from "../../src/tools/SymbolScale.js";
import { ExportScale } from "../../src/tools/ExportScale.js";
import { RULES, clean, cleanContext } from "../../src/data/MapRules.js";

const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-3, `${message ?? ""} ${actual} vs ${expected}`);

test("a top map's Auto is 100% at any size; a regional map's grows with the square root of its magnification, up to the limit", () => {
    for (const size of [1000, 2000, 4000]) assert.equal(SymbolScale.auto(null, size, size / 2), 1, `${size} px`);
    // The P0JBVA region: 3000 px at zoom 4 of a 2000 x 1600 world, showing 3/8 of its width
    const region = { zoom: 4, rootW: 2000, rootH: 1600 };
    near(SymbolScale.magnification(region, 3000, 1680), 8 / 3);
    near(SymbolScale.auto(region, 3000, 1680), Math.sqrt(8 / 3), "about 163%");
    near(SymbolScale.auto(region, 6000, 3360), Math.sqrt(4 / 3), "the same crop at twice the pixels: its symbols are already bigger in pixels");
    assert.equal(SymbolScale.auto({ zoom: 64, rootW: 2000, rootH: 2000 }, 2000, 2000), FILRODENSWMB.SYMBOLS.AUTO_MAX);
    assert.equal(SymbolScale.auto({ zoom: 0.5, rootW: 2000, rootH: 2000 }, 2000, 2000), 1, "never below 100%");
    near(SymbolScale.auto({ zoom: 4 }, 2000, 2000), 2, "a regional map saved without its root's size: taken as its parent's size");
});

test("a chosen size is used over Auto, kept within its range, and saved", () => {
    const region = { world: { zoom: 4, rootW: 2000, rootH: 1600 }, mapWidth: 3000, mapHeight: 1680 };
    near(SymbolScale.of({ ...region, symbolSize: null }), Math.sqrt(8 / 3));
    assert.equal(SymbolScale.of({ ...region, symbolSize: 1.25 }), 1.25);
    assert.equal(SymbolScale.valid(9), FILRODENSWMB.SYMBOLS.RANGE[1]);
    assert.equal(SymbolScale.valid("lots"), null);
    const choices = SymbolScale.choices({ ...region, symbolSize: 1.5 });
    assert.deepEqual(choices.map((choice) => [choice.value, choice.percent, choice.selected]), [["auto", 163, false], ["0.75", 75, false], ["1", 100, false], ["1.25", 125, false], ["1.5", 150, true], ["2", 200, false], ["2.5", 250, false]]);
    const context = cleanContext(() => "x");
    assert.equal(clean({ symbolSize: 1.5 }, RULES.map, context).symbolSize, 1.5);
    assert.equal(clean({ symbolSize: null }, RULES.map, context).symbolSize, null);
    assert.equal(clean({ symbolSize: 50 }, RULES.map, context).symbolSize, FILRODENSWMB.SYMBOLS.RANGE[1], "out of range is kept within it");
    assert.equal(clean({ symbolSize: "big" }, RULES.map, context).symbolSize, undefined, "not a number is dropped (Auto)");
});

test("a name's outline and shadow are in proportion to it, within their limits", () => {
    const halo = (px) => SymbolScale.labelHalo(px);
    near(halo(7.2).stroke, 1, "a small town's name: the thinnest outline");
    near(halo(7.2).shadow, 0.6);
    near(halo(14.4).stroke, 1.8);
    near(halo(14.4).shadow, 1.2);
    assert.deepEqual(halo(48), { stroke: 3, shadow: 2 }, "a realm's name: as before");
    assert.deepEqual(halo(0), { stroke: 1, shadow: 0.5 });
});

test("the export recommends the smallest allowed scale that makes the smallest name readable, and says why", () => {
    const region = ExportScale.plan({ width: 3000, height: 1680, smallestLabelPx: 7.2 });
    assert.deepEqual(region.options.map((option) => [option.scale, option.width, option.height, option.allowed]), [[1, 3000, 1680, true], [2, 6000, 3360, true], [3, 9000, 5040, true], [4, 12000, 6720, true]]);
    assert.equal(region.recommended, 2);
    assert.deepEqual(region.options.map((option) => option.recommended), [false, true, false, false]);
    assert.deepEqual(region.reason, { kind: "reaches", px: 7.2, scaledPx: 14.4, scale: 2 });
    assert.deepEqual(ExportScale.plan({ width: 3000, height: 1680, smallestLabelPx: 14.4 }).reason.kind, "enough");
    assert.equal(ExportScale.plan({ width: 3000, height: 1680, smallestLabelPx: 11.76 }).recommended, 1, "a name that reads as 12 px is enough");
    const none = ExportScale.plan({ width: 3000, height: 1680, smallestLabelPx: null });
    assert.equal(none.recommended, 1);
    assert.equal(none.reason.kind, "none");
    // A large map: 3x passes a side's limit and 4x the pixels' too
    const large = ExportScale.plan({ width: 6000, height: 6000, smallestLabelPx: 2 });
    assert.deepEqual(large.options.map((option) => option.allowed), [true, true, false, false]);
    assert.equal(large.recommended, 2);
    assert.deepEqual(large.reason, { kind: "short", px: 2, scaledPx: 4, scale: 2 });
});

test("a scene's scales stop at the graphics card's largest texture, the recommendation with them", () => {
    const scene = ExportScale.plan({ width: 3000, height: 1680, smallestLabelPx: 4, maxSide: 8192 });
    assert.deepEqual(scene.options.map((option) => option.allowed), [true, true, false, false], "6000 fits 8192; 9000 does not");
    assert.equal(scene.recommended, 2);
    assert.equal(scene.reason.kind, "short");
    assert.deepEqual(ExportScale.plan({ width: 3000, height: 1680, smallestLabelPx: 4, maxSide: 100_000 }).options.map((option) => option.allowed), [true, true, true, true], "never past the PNG's own limit");
});

test("the tiles cover the image exactly, none larger than the limit", () => {
    const tiles = ExportScale.tiles(9000, 5040, 4096);
    assert.equal(tiles.length, 6);
    assert.ok(tiles.every((tile) => tile.width <= 4096 && tile.height <= 4096));
    assert.equal(tiles.reduce((sum, tile) => sum + tile.width * tile.height, 0), 9000 * 5040);
    assert.deepEqual(tiles.at(-1), { x: 8192, y: 4096, width: 808, height: 944 });
    assert.deepEqual(ExportScale.tiles(100, 50, 4096), [{ x: 0, y: 0, width: 100, height: 50 }]);
});
