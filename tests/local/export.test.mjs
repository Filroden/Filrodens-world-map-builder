// A settlement map's export (L-surface step 5): what the export dialogue is given of the map (the
// frame at 1.25 m a pixel, the presets, the scale to Finest read in metres a pixel, the file name)
// and how its image is drawn (the worker's tiles joined, the labels once over the whole, Cancel
// between tiles). Too large on a great city's town view at Finest.
import assert from "node:assert/strict";
import { test } from "node:test";

const { installPlatform } = await import("../../src/platform/index.js");
installPlatform({ i18n: { localize: (key) => key, format: (key, data) => `${key}${data ? JSON.stringify(data) : ""}`, lang: "en" } });
const { FILRODENSWMB } = await import("../../src/config.js");
const { ExportArea } = await import("../../src/kernel/export/ExportScale.js");
const { LocalExport } = await import("../../src/studios/local/app/LocalExport.js");

const frame = { width: 6000, height: 4500 };

test("the scale goes to Finest, 3.125× (0.4 m a pixel), unrounded; the steps below it as before", () => {
    const finest = LocalExport.ceiling();
    assert.equal(finest, 3.125);
    assert.equal(ExportArea.snapScale(9, finest), finest);
    assert.equal(ExportArea.snapScale(3.13, finest), finest, "past the last step: Finest");
    assert.equal(ExportArea.snapScale(3.11, finest), 3.1);
    assert.equal(ExportArea.snapScale(4), 4, "the World studio's ceiling as before");
    assert.equal(LocalExport.scaleName(finest), "FILRODENSWMB.UI.ExportFinest");
    assert.equal(LocalExport.scaleName(2), null);
    assert.deepEqual(
        LocalExport.stops().map((stop) => [stop.stop, stop.label ?? null, !!stop.minor]),
        [
            [0.25, "0.25×", false],
            [1, "1×", false],
            [2, "2×", false],
            [3.125, "FILRODENSWMB.UI.ExportFinest", false],
            [0.5, null, true],
        ],
    );
});

test("the map is the frame at 1.25 m a pixel; the presets are the town view, the whole frame and the view on the frame", () => {
    assert.deepEqual(LocalExport.mapOf(frame), { width: 4800, height: 3600 });
    const presets = LocalExport.presets(frame, { town: [-800, -600, 800, 600], screen: [-4000, -1000, 0, 1000] });
    assert.deepEqual(presets.map((preset) => preset.id), ["town", "hinterland", "screen"]);
    assert.deepEqual(presets[0].area, { x: 1760, y: 1320, width: 1280, height: 960 });
    assert.deepEqual(presets[1].area, { x: 0, y: 0, width: 4800, height: 3600 });
    assert.deepEqual(presets[2].area, { x: 0, y: 1000, width: 2400, height: 1600 }, "the part of the view on the frame");
    assert.equal(presets[0].what, "FILRODENSWMB.UI.ExportOfTheTownView");
    // A view wholly off the frame: the whole frame
    assert.deepEqual(LocalExport.areaOf([9000, 9000, 9100, 9100], frame), { x: 0, y: 0, width: 4800, height: 3600 });
});

test("the ground in km from a kilometre across, in m below; a pixel in m", () => {
    const measure = LocalExport.measure();
    assert.deepEqual(measure.lengths(1280, 960), { width: "1.6", height: "1.2", unit: "km" });
    assert.deepEqual(measure.lengths(512, 384), { width: "640", height: "480", unit: "m" });
    assert.deepEqual(measure.pixel(1), { distance: "1.25", unit: "m" });
    assert.deepEqual(measure.pixel(2), { distance: "0.63", unit: "m" });
    assert.deepEqual(measure.pixel(3.125), { distance: "0.4", unit: "m" });
});

test("the file name: the settlement, the preset or area, and the scale (Finest by name)", () => {
    assert.equal(LocalExport.fileName({ name: "Castford", preset: "town", scale: 2 }), "fwmb_castford_town-view_2x");
    assert.equal(LocalExport.fileName({ name: "Castford", preset: "hinterland", scale: 1 }), "fwmb_castford_hinterland-view_1x");
    assert.equal(LocalExport.fileName({ name: "Castford", preset: "screen", scale: 0.75 }), "fwmb_castford_view_0-75x");
    assert.equal(LocalExport.fileName({ name: "Castford", preset: "drawn", scale: 2 }), "fwmb_castford_area_2x");
    assert.equal(LocalExport.fileName({ name: "Grasshove Ford", preset: "town", scale: 3.125 }), "fwmb_grasshove_ford_town-view_finest");
});

test("the image's tiles: the area at the scale in whole pixels, each tile's view in metres, side by side", () => {
    const area = { x: 1760, y: 1320, width: 1280, height: 960 };
    const image = LocalExport.views(area, 2, frame, 2048);
    assert.deepEqual([image.width, image.height], [2560, 1920]);
    assert.equal(image.tiles.length, 2);
    assert.deepEqual(image.whole, { rect: [-800, -600, 800, 600], mPerPx: 0.625, widthPx: 2560, heightPx: 1920 });
    const [a, b] = image.tiles;
    assert.equal(a.view.rect[2], b.view.rect[0], "the tiles meet");
    assert.deepEqual([a.view.widthPx + b.view.widthPx, a.view.heightPx], [2560, 1920]);
    // The estimates' samples: inside the image, its quarters' middles
    const { views, pixels } = LocalExport.samples(area, 2, frame);
    assert.equal(pixels, 2560 * 1920);
    assert.equal(views.length, FILRODENSWMB.EXPORT_FORMATS.ESTIMATE.TILES);
    for (const view of views) assert.ok(view.rect[0] >= -800 && view.rect[2] <= 800 && view.rect[1] >= -600 && view.rect[3] <= 600);
});

/** A canvas that records what is drawn on it. */
function recordingCanvas(width, height) {
    const drawn = [];
    const ctx = { canvas: null, drawImage: (picture, x, y) => drawn.push([picture.name, x, y]), save() {}, restore() {} };
    const canvas = { width, height, drawn, getContext: () => ctx };
    ctx.canvas = canvas;
    return canvas;
}

test("drawing: each tile from the worker, joined in its place, then the labels once over the whole", async () => {
    const asked = [];
    const closed = [];
    const labelled = [];
    const progress = [];
    const area = { x: 0, y: 0, width: 4800, height: 3600 };
    const canvas = await LocalExport.draw({
        area,
        scale: 1,
        frame,
        tileLimit: 2048,
        makeCanvas: recordingCanvas,
        tile: async (view) => (asked.push(view), { name: `tile${asked.length}`, close: () => closed.push(asked.length) }),
        labels: (ctx, view) => labelled.push([ctx.canvas.width, view]),
        onTile: (index) => progress.push(index),
    });
    assert.deepEqual([canvas.width, canvas.height], [4800, 3600]);
    assert.equal(asked.length, 6, "3 by 2 tiles of at most 2,048 px");
    assert.deepEqual(canvas.drawn.slice(0, 2), [["tile1", 0, 0], ["tile2", 2048, 0]]);
    assert.equal(closed.length, 6, "each tile's picture let go once drawn");
    assert.equal(labelled.length, 1, "the labels once");
    assert.deepEqual(labelled[0], [4800, { rect: [-3000, -2250, 3000, 2250], mPerPx: 1.25, widthPx: 4800, heightPx: 3600 }]);
    assert.deepEqual(progress, [0, 1, 2, 3, 4, 5, 6]);
});

test("drawing: Cancel stops between tiles, and nothing is joined", async () => {
    const controller = new AbortController();
    let asked = 0;
    const canvas = await LocalExport.draw({
        area: { x: 0, y: 0, width: 4800, height: 3600 },
        scale: 1,
        frame,
        tileLimit: 2048,
        makeCanvas: recordingCanvas,
        signal: controller.signal,
        tile: async () => {
            asked++;
            if (asked === 2) controller.abort();
            return { name: "tile", close() {} };
        },
        labels: () => assert.fail("no labels once cancelled"),
    });
    assert.equal(canvas, null);
    assert.equal(asked, 2);
});

test("Too large: a great city's town view at Finest offers a scale that fits and an area that fits", () => {
    // A town view of 9 by 6.75 km: 7,200 by 5,400 px at 1×, 22,500 by 16,875 at Finest
    const big = { width: 24000, height: 18000 };
    const town = LocalExport.presets(big, { town: [-4500, -3375, 4500, 3375] })[0].area;
    const map = LocalExport.mapOf(big);
    const plan = ExportArea.plan(map, town, LocalExport.ceiling());
    assert.equal(plan.fits, false);
    assert.ok(plan.fitScale > 1 && plan.fitScale < LocalExport.ceiling(), `${plan.fitScale}`);
    assert.ok(ExportArea.fits(ExportArea.size(town, plan.fitScale)));
    assert.ok(ExportArea.fits(ExportArea.size(plan.fitArea, LocalExport.ceiling())));
});
