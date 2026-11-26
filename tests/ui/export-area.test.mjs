// The export dialogue's arithmetic (ExportArea, S0 step 7): the scale's steps, the image's size,
// the recommendation, Too large's two nearest fits, the presets and aspects, and the file name.
import "../mesh/foundry-stubs.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { FILRODENSWMB } from "../../src/config.js";
import { ExportArea } from "../../src/kernel/export/ExportScale.js";

const MAP = { width: 2000, height: 1600 };
const WHOLE = { x: 0, y: 0, width: 2000, height: 1600 };

test("the scale moves in steps of 0.05 from 0.25 to the ceiling", () => {
    assert.equal(ExportArea.snapScale(1.234), 1.25);
    assert.equal(ExportArea.snapScale(0.76), 0.75);
    assert.equal(ExportArea.snapScale(0.1), FILRODENSWMB.EXPORT_PNG.SCALE.MIN);
    assert.equal(ExportArea.snapScale(9), 4);
    assert.equal(ExportArea.snapScale(9, 8), 8, "a ceiling of the map type's own");
    assert.equal(ExportArea.snapScale("abc"), 1, "not a number: 1x");
});

test("the image is the area at the scale, in whole pixels", () => {
    assert.deepEqual(ExportArea.size(WHOLE, 2), { width: 4000, height: 3200 });
    assert.deepEqual(ExportArea.size({ x: 10, y: 10, width: 333, height: 101 }, 0.75), { width: 250, height: 76 });
    assert.deepEqual(ExportArea.size({ x: 0, y: 0, width: 1, height: 1 }, 0.25), { width: 1, height: 1 }, "never under a pixel");
});

test("the recommendation is the smallest whole stop that makes the smallest name readable, whatever the area", () => {
    assert.deepEqual(ExportArea.recommend(7), { scale: 2, kind: "reaches", px: 7, scaledPx: 14 });
    assert.equal(ExportArea.recommend(11.76).kind, "enough", "a name that reads as 12 px is enough");
    assert.equal(ExportArea.recommend(11.76).scale, 1);
    assert.deepEqual(ExportArea.recommend(null), { scale: 1, kind: "none" });
    assert.deepEqual(ExportArea.recommend(2), { scale: 4, kind: "short", px: 2, scaledPx: 8 });
    assert.equal(ExportArea.recommend(2, 3).scale, 3, "never past the ceiling");
});

test("an area that fits says so; one too large offers the largest scale that fits and the largest area that fits", () => {
    const fits = ExportArea.plan(MAP, WHOLE, 4);
    assert.deepEqual(fits, { width: 8000, height: 6400, part: { width: 8000, height: 6400 }, fits: true, fitScale: null, fitArea: null });
    // 16,384 px on a side: 2000 x 8.25 = 16,500 is past it
    const large = ExportArea.plan({ width: 2000, height: 600 }, { x: 0, y: 0, width: 2000, height: 600 }, 8.25);
    assert.equal(large.fits, false);
    assert.equal(large.fitScale, 8.15, "the largest step at which the area fits");
    assert.ok(ExportArea.fits(ExportArea.size(large.fitArea, 8.25)), "the area that fits does, at the scale chosen");
    near(large.fitArea.width / large.fitArea.height, 2000 / 600, 0.01, "of the same aspect");
    // Past the pixels in all (150 million): 2000 x 1600 at 9.5 is 289 million
    const many = ExportArea.plan(MAP, WHOLE, 9.5);
    assert.equal(many.fits, false);
    assert.ok(ExportArea.fits(ExportArea.size(WHOLE, many.fitScale)));
    assert.ok(!ExportArea.fits(ExportArea.size(WHOLE, Math.round((many.fitScale + 0.05) * 100) / 100)), "and the next step does not");
    const area = many.fitArea;
    assert.ok(Math.abs(area.x + area.width / 2 - 1000) <= 1 && Math.abs(area.y + area.height / 2 - 800) <= 1, "centred on the area chosen");
    // A scene's graphics card limit
    assert.equal(ExportArea.plan(MAP, WHOLE, 4, { maxSide: 4096 }).fits, false);
    assert.equal(ExportArea.plan(MAP, WHOLE, 4, { maxSide: 4096 }).fitScale, 2, "2.05 would make 4,100 px");
});

test("an area stays on the map, moved rather than cut", () => {
    assert.deepEqual(ExportArea.clip({ x: -50, y: 1500, width: 300, height: 200 }, MAP), { x: 0, y: 1400, width: 300, height: 200 });
    assert.deepEqual(ExportArea.clip({ x: 5, y: 5, width: 5000, height: 0.2 }, MAP), { x: 0, y: 5, width: 2000, height: 1 });
});

test("the presets: the whole map, and what is on screen clipped to the map", () => {
    assert.deepEqual(ExportArea.preset("whole", MAP), WHOLE);
    assert.deepEqual(ExportArea.preset("screen", MAP, { x: -100, y: 200, width: 900, height: 600 }), { x: 0, y: 200, width: 800, height: 600 });
    assert.deepEqual(ExportArea.preset("screen", MAP, { x: 3000, y: 0, width: 100, height: 100 }), WHOLE, "a view off the map: the whole map");
    assert.deepEqual(ExportArea.preset("screen", MAP, null), WHOLE);
});

test("an aspect reshapes the area about its centre, keeping its size where the map has room", () => {
    assert.equal(ExportArea.ratio("free", MAP), null);
    assert.equal(ExportArea.ratio("map", MAP), 1.25);
    assert.equal(ExportArea.ratio("square", MAP), 1);
    const square = ExportArea.withAspect({ x: 400, y: 400, width: 800, height: 200 }, 1, MAP);
    assert.deepEqual(square, { x: 600, y: 300, width: 400, height: 400 });
    const wide = ExportArea.withAspect(WHOLE, 16 / 9, MAP);
    assert.deepEqual(wide, { x: 0, y: 238, width: 2000, height: 1125 }, "as wide as the map allows");
    assert.deepEqual(ExportArea.withAspect({ x: 1, y: 2, width: 3, height: 4 }, null, MAP), { x: 1, y: 2, width: 3, height: 4 }, "Free leaves it");
});

test("the file name: the name, where, and the scale", () => {
    assert.equal(ExportArea.fileName({ name: "Tutorial world", preset: "whole", scale: 2 }), "fwmb_tutorial_world_2x");
    assert.equal(ExportArea.fileName({ name: "Tutorial world", preset: "drawn", scale: 4 }), "fwmb_tutorial_world_area_4x");
    assert.equal(ExportArea.fileName({ name: "The Age of Ash!", preset: "screen", scale: 0.75 }), "fwmb_the_age_of_ash_view_0-75x");
    assert.equal(ExportArea.fileName({ name: "", preset: "whole", scale: 1 }), "fwmb_map_1x");
});

function near(actual, expected, tolerance, message) {
    assert.ok(Math.abs(actual - expected) <= tolerance, `${message ?? ""} ${actual} vs ${expected}`);
}

const { SceneArea } = await import("../../src/kernel/export/ExportScale.js");

test("a scene's area snaps to whole square cells with its corner on a grid corner, kept on the map", () => {
    const grid = { type: "square", size: 50 };
    const snapped = SceneArea.snap({ x: 130, y: 70, width: 610, height: 440 }, grid, MAP);
    assert.deepEqual(snapped, { area: { x: 150, y: 50, width: 600, height: 450 }, cells: { across: 12, down: 9 } });
    const edge = SceneArea.snap({ x: 1990, y: 1590, width: 300, height: 300 }, grid, MAP);
    assert.ok(edge.area.x + edge.area.width <= 2000 && edge.area.y + edge.area.height <= 1600 && edge.cells.across >= 1, `kept on the map (${JSON.stringify(edge)})`);
    assert.deepEqual(SceneArea.snap({ x: 3.4, y: 5.6, width: 100.2, height: 80 }, { type: "none", size: 50 }, MAP).area, { x: 3, y: 6, width: 100, height: 80 }, "a gridless map keeps the area as drawn");
});

test("a hex grid's area starts every two rows (or columns), so row parity is kept, and its offsets are even", () => {
    const rows = { type: "hexR", size: 50 };
    const rowStep = (50 * Math.sqrt(3)) / 2;
    const snapped = SceneArea.snap({ x: 120, y: 100, width: 400, height: 300 }, rows, MAP);
    near(snapped.area.y / (rowStep * 2), Math.round(snapped.area.y / (rowStep * 2)), 1e-9, "the corner on a two-row period");
    assert.equal(snapped.area.x % 50, 0);
    assert.equal(SceneArea.offset(snapped.area, rows).i % 2, 0, "an even row offset");
    assert.equal(snapped.cells.down, Math.round(300 / rowStep));
    const columns = { type: "hexC", size: 50 };
    const cut = SceneArea.snap({ x: 300, y: 120, width: 400, height: 300 }, columns, MAP);
    assert.equal(SceneArea.offset(cut.area, columns).j % 2, 0, "an even column offset");
    assert.deepEqual(SceneArea.offset({ x: 150, y: 50 }, { type: "square", size: 50 }), { i: 1, j: 3 });
});

test("a scene's scale makes each cell whole pixels, never smaller than the least grid size", () => {
    assert.deepEqual(SceneArea.scale(2, { type: "square", size: 50 }, 20), { scale: 2, cell: 100, floor: 0.4 });
    assert.deepEqual(SceneArea.scale(1.05, { type: "square", size: 50 }, 20), { scale: 1.06, cell: 53, floor: 0.4 }, "52.5 px rounds to 53");
    assert.equal(SceneArea.scale(0.25, { type: "square", size: 50 }, 20).cell, 20, "the floor");
    assert.deepEqual(SceneArea.scale(0.3, { type: "none", size: 50 }, 20), { scale: 0.3, cell: null, floor: 0 });
    assert.ok(SceneArea.same({ x: 1, y: 2, width: 3, height: 4, scale: 2 }, { x: 1.2, y: 2, width: 3, height: 4, scale: 2.0004 }));
    assert.ok(!SceneArea.same({ x: 1, y: 2, width: 3, height: 4, scale: 2 }, { x: 1, y: 2, width: 3, height: 4, scale: 1.96 }));
    assert.ok(!SceneArea.same(null, { x: 1 }));
});
