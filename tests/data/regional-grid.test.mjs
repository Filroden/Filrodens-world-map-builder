// A regional map's grid (RegionalExtractor.planCrop) and a scene's grid scale (SceneExporter.gridScale):
// the regional map keeps its parent's grid size in pixels, its zoom is a whole number when there is a
// grid, so the two grids line up, and the scene's ruler measures each cell at the map's own scale.
import assert from "node:assert/strict";
import { test } from "node:test";

const { RegionalExtractor } = await import("../../src/applications/RegionalExtractor.js");
const { SceneExporter } = await import("../../src/platform/foundry/SceneExporter.js");
const { kmPerPxOf } = await import("../../src/data/MapUnit.js");

const PARENT = { width: 2000, height: 1600 };
const plan = (crop, width, grid) => RegionalExtractor.planCrop(crop, width, grid, PARENT.width, PARENT.height);
const isWhole = (value, step) => Math.abs(value / step - Math.round(value / step)) < 1e-6;

test("a regional map keeps its parent's grid size, at a whole-number zoom, with every parent grid line one of its own", () => {
    const grid = { type: "square", size: 50 };
    const result = plan({ x: 510, y: 430, width: 500, height: 400 }, 2000, grid);
    assert.equal(result.gridSize, 50);
    assert.equal(result.zoomScale, 4);
    assert.equal(result.targetWidth, 2000);
    assert.equal(result.cropBox.width, 500);
    assert.ok(isWhole(result.cropBox.x, 50) && isWhole(result.cropBox.y, 50), "the corner is on a parent cell corner");
    // Each parent grid line inside the crop falls on a regional grid line
    for (let line = Math.ceil(result.cropBox.x / 50) * 50; line < result.cropBox.x + result.cropBox.width; line += 50) {
        assert.ok(isWhole((line - result.cropBox.x) * result.zoomScale, result.gridSize));
    }
});

test("the zoom rounds to a whole number, and the crop grows or shrinks round what was drawn to fit the width asked for", () => {
    const drawn = { x: 700, y: 600, width: 300, height: 240 };
    const result = plan(drawn, 1000, { type: "square", size: 50 });
    assert.equal(result.zoomScale, 3, "1000 / 300 is 3.33");
    assert.equal(result.targetWidth, 1000, "the width asked for is kept");
    assert.ok(Math.abs(result.cropBox.width - 1000 / 3) < 1e-9);
    assert.equal(result.targetHeight, 720);
    const drawnCentre = drawn.x + drawn.width / 2;
    const centre = result.cropBox.x + result.cropBox.width / 2;
    assert.ok(Math.abs(centre - drawnCentre) <= 25, "centred where it was drawn, to within half a cell");
});

test("a regional map of a regional map keeps the same grid size", () => {
    const grid = { type: "square", size: 50 };
    const first = plan({ x: 500, y: 400, width: 500, height: 400 }, 2000, grid);
    const second = RegionalExtractor.planCrop({ x: 500, y: 400, width: 500, height: 400 }, 2000, { type: "square", size: first.gridSize }, first.targetWidth, first.targetHeight);
    assert.equal(second.gridSize, 50);
    assert.equal(second.zoomScale, 4);
});

test("on a hex grid the corner is a start of the parent's pattern and the zoom is whole, so every parent hex centre is a regional one", () => {
    for (const type of ["hexR", "hexC"]) {
        const result = plan({ x: 333, y: 271, width: 400, height: 300 }, 1600, { type, size: 50 });
        const period = type === "hexR" ? { x: 50, y: 50 * Math.sqrt(3) } : { x: 50 * Math.sqrt(3), y: 50 };
        assert.equal(result.gridSize, 50);
        assert.ok(Number.isInteger(result.zoomScale));
        assert.ok(isWhole(result.cropBox.x, period.x) && isWhole(result.cropBox.y, period.y), `${type}: the corner starts the pattern`);
        // A parent pattern point lands on a regional one: a whole number of regional periods from the corner
        assert.ok(isWhole(period.x * result.zoomScale, period.x) && isWhole(period.y * result.zoomScale, period.y));
    }
});

test("a crop already fitted plans to itself, so snapping it again changes nothing", () => {
    const grid = { type: "square", size: 50 };
    const first = plan({ x: 713, y: 588, width: 287, height: 233 }, 1500, grid);
    const again = plan(first.cropBox, 1500, grid);
    assert.deepEqual(again, first);
});

test("the zoom is at least enough for the parent to fill the width asked for", () => {
    const result = plan({ x: 0, y: 0, width: 1900, height: 1500 }, 3000, { type: "square", size: 50 });
    assert.equal(result.zoomScale, 2, "3000 / 1900 rounds to 2, which the parent can fill");
    const wide = plan({ x: 0, y: 0, width: 2000, height: 1600 }, 5000, { type: "square", size: 50 });
    assert.equal(wide.zoomScale, 3, "2.5 rounds to 3, the least that fills 5000 from 2000");
    assert.equal(wide.targetWidth, 5000);
});

test("a gridless parent keeps the zoom the crop and width give", () => {
    const result = plan({ x: 700, y: 600, width: 300, height: 240 }, 1000, { type: "none", size: 50 });
    assert.ok(Math.abs(result.zoomScale - 1000 / 300) < 1e-9);
    assert.equal(result.cropBox.x, 700);
    assert.equal(result.gridSize, 50);
});

test("a scene's grid measures one cell at the map's scale, in the map's unit", () => {
    const uiState = { latTop: 60, latBottom: -60, world: null, mapUnit: "leagues" };
    const app = { uiState, mapHeight: 1600 };
    const scale = SceneExporter.gridScale(app, 50);
    assert.equal(scale.units, "leagues");
    assert.equal(scale.distance, Number((50 * kmPerPxOf(uiState, 1600)).toPrecision(3)));

    // A regional map four times closer: the same 50 pixels cover a quarter of the ground
    const regional = SceneExporter.gridScale({ uiState: { ...uiState, latTop: 15, latBottom: -15 }, mapHeight: 1600 }, 50);
    assert.ok(Math.abs(regional.distance - scale.distance / 4) <= scale.distance * 0.01);

    assert.equal(SceneExporter.gridScale({ uiState: { mapUnit: "" }, mapHeight: 1600 }, 50).units, "km", "no unit named, the default");
});

test("a scene's scale is a whole number from 1", () => {
    assert.equal(SceneExporter.sceneScale(2), 2);
    assert.equal(SceneExporter.sceneScale("3"), 3);
    assert.equal(SceneExporter.sceneScale(0), 1);
    assert.equal(SceneExporter.sceneScale(undefined), 1);
    assert.equal(SceneExporter.sceneScale(Number.NaN), 1);
});
