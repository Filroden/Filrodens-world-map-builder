// The map's unit (MapUnit): the name every distance is shown with, how a saved map gets one, the
// round distances a scale bar matching the world draws, and a slider shown in the unit.
import assert from "node:assert/strict";
import { test } from "node:test";

const { FILRODENSWMB } = await import("../../src/config.js");
const { cleanUnit, formatDistance, kmPerPxOf, niceDistance, scaleBarOnMap, scaleBarTick, unitFromSaved, worldScaleTick } = await import("../../src/data/MapUnit.js");
const { effectiveKmPerPx } = await import("../../src/mesh/Schema.js");
const { RangeDisplay } = await import("../../src/tools/RangeDisplay.js");

test("a unit name is trimmed text, and an empty one is the default", () => {
    assert.equal(cleanUnit("  leagues "), "leagues");
    assert.equal(cleanUnit(""), FILRODENSWMB.MAP_UNIT.DEFAULT);
    assert.equal(cleanUnit("   "), "km");
    assert.equal(cleanUnit(undefined), "km");
    assert.equal(cleanUnit(42), "km");
});

test("a saved map's unit: its own, else its scale bar's text, with the old default Miles becoming km", () => {
    assert.deepEqual(unitFromSaved({ mapUnit: "leagues", params: { cartography: { scaleUnits: "Miles" } } }), { unit: "leagues", converted: false });
    assert.deepEqual(unitFromSaved({ params: { cartography: { scaleUnits: "Miles" } } }), { unit: "km", converted: true });
    assert.deepEqual(unitFromSaved({ params: { cartography: { scaleUnits: " Miles " } } }), { unit: "km", converted: true });
    // Only the untouched default is changed: any other text was the user's own
    assert.deepEqual(unitFromSaved({ params: { cartography: { scaleUnits: "miles" } } }), { unit: "miles", converted: false });
    assert.deepEqual(unitFromSaved({ params: { cartography: { scaleUnits: "Leagues" } } }), { unit: "Leagues", converted: false });
    assert.deepEqual(unitFromSaved({ params: { cartography: { scaleUnits: "" } } }), { unit: "km", converted: false });
    assert.deepEqual(unitFromSaved({ params: {} }), { unit: "km", converted: false });
    assert.deepEqual(unitFromSaved({ mapUnit: "  ", params: { cartography: { scaleUnits: "Miles" } } }), { unit: "km", converted: true });
    assert.deepEqual(unitFromSaved(null), { unit: "km", converted: false });
});

test("the round distance nearest to a distance is 1, 2 or 5 times a power of ten", () => {
    const cases = [
        [1, 1],
        [1.3, 1],
        [1.5, 2],
        [3, 2],
        [3.3, 5],
        [7, 5],
        [8, 10],
        [140, 100],
        [160, 200],
        [0.034, 0.05],
        [0.012, 0.01],
    ];
    for (const [km, expected] of cases) assert.equal(niceDistance(km), expected, `${km}`);
    assert.equal(niceDistance(0), 1);
    assert.equal(niceDistance(-5), 1);
});

test("a scale bar matching the world draws a round distance, its tick as long as that distance is", () => {
    const { value, intervalPx } = worldScaleTick(3.2, 100);
    assert.equal(value, 500, "100 px at 3.2 km per px is 320 km, nearest 500 on a log scale");
    assert.ok(Math.abs(intervalPx * 3.2 - value) < 1e-9);

    const state = { latTop: 60, latBottom: 20, world: null, cartographyScaleInterval: 100, cartographyScaleValue: 7, cartographyScaleMatchWorld: true };
    const kmPerPx = effectiveKmPerPx({ mapHeight: 1600, params: { latTop: 60, latBottom: 20 }, world: null });
    assert.equal(kmPerPxOf(state, 1600), kmPerPx);
    const matched = scaleBarTick(state, 1600);
    assert.equal(matched.value, niceDistance(100 * kmPerPx));
    assert.ok(Math.abs(matched.intervalPx * kmPerPx - matched.value) < 1e-9);

    // Off, the bar is the user's own
    assert.deepEqual(scaleBarTick({ ...state, cartographyScaleMatchWorld: false }, 1600), { value: 7, intervalPx: 100 });
    // A bigger area factor makes each pixel shorter, so the same interval measures less
    const smaller = scaleBarTick({ ...state, world: { areaFactor: 40 } }, 1600);
    assert.ok(smaller.value <= matched.value);
});

test("distances are shown whole from 10, to one place from 1 and two below", () => {
    const plain = (text) => text.replaceAll(/[^\d.]/g, "");
    assert.equal(plain(formatDistance(123.4)), "123");
    assert.equal(plain(formatDistance(3.24)), "3.2");
    assert.equal(plain(formatDistance(0.236)), "0.24");
    assert.equal(formatDistance(Number.NaN), "");
});

test("a slider stored in pixels shows its value in the map unit as it moves", () => {
    const output = { value: "" };
    const wrapper = { querySelector: () => output };
    const style = { setProperty() {} };
    const input = { value: "40", min: "0", max: "400", dataset: { displayScale: "3.2" }, style, closest: () => wrapper };
    RangeDisplay.sync(input);
    assert.equal(output.value.replaceAll(/[^\d.]/g, ""), "128");
    // Without a factor the slider shows its own value
    RangeDisplay.sync({ ...input, dataset: {} });
    assert.equal(output.value, "40");
});

test("a scale bar is moved in just far enough that all of it is on the map", () => {
    const bar = { cartographyScaleInterval: 100, cartographyScaleMajorTicks: 4, cartographyScaleValue: 10 };
    assert.deepEqual(scaleBarOnMap({ ...bar, cartographyScaleX: 200, cartographyScaleY: 900 }, 1000, 1000), { x: 200, y: 900 }, "on the map already");
    assert.deepEqual(scaleBarOnMap({ ...bar, cartographyScaleX: 50, cartographyScaleY: 3950 }, 1000, 1000), { x: 50, y: 950 }, "below the map");
    assert.deepEqual(scaleBarOnMap({ ...bar, cartographyScaleX: 900, cartographyScaleY: 10 }, 1000, 1000), { x: 550, y: 50 }, "its end past the right edge");
    assert.equal(scaleBarOnMap({ ...bar, cartographyScaleInterval: 400, cartographyScaleX: 300, cartographyScaleY: 500 }, 1000, 1000).x, 50, "wider than the map");
    assert.deepEqual(scaleBarOnMap(bar, 1000, 800), { x: 50, y: 750 }, "no place set");
});
