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

// ------------------------------------------------------------------ 5b: the report and the legend

const { Report, wrap } = await import("../../src/studios/local/app/Report.js");

/** A context that records what is drawn and measures half an em a letter. */
function recordingContext(width, height) {
    const calls = [];
    const ctx = new Proxy(
        { canvas: { width, height }, font: "16px serif", calls },
        {
            get(target, key) {
                if (key in target) return target[key];
                if (key === "measureText") return (text) => ({ width: String(text).length * (parseFloat(/(\d+(\.\d+)?)px/.exec(target.font)?.[1]) || 16) * 0.5 });
                return (...args) => calls.push([key, ...args]);
            },
            set(target, key, value) {
                target[key] = value;
                return true;
            },
        },
    );
    return ctx;
}

test("the report's file name has report_ before the preset", () => {
    assert.equal(LocalExport.fileName({ name: "Castford", preset: "drawn", scale: 2, kind: "report" }), "fwmb_castford_report_area_2x");
    assert.equal(LocalExport.fileName({ name: "Castford", preset: "town", scale: 1, kind: "map" }), "fwmb_castford_town-view_1x");
});

test("the sheet: the inset and block below an area wider than 4:3, beside a tall or square one", () => {
    const { SIDE_PX, INSET_PX, GAP_PX, MARGIN_PX } = FILRODENSWMB.LOCAL.EXPORT.REPORT;
    // A 2:1 map part: the two side by side under it
    const wide = Report.layout({ width: 3840, height: 1920 }, 600);
    assert.equal(wide.below, true);
    assert.deepEqual([wide.width, wide.height], [3840 + 2 * MARGIN_PX, MARGIN_PX + 1920 + GAP_PX + 600 + MARGIN_PX]);
    assert.equal(wide.inset.y, wide.block.y);
    assert.equal(wide.block.x, wide.inset.x + SIDE_PX + GAP_PX);
    // A 3:4 map part: the inset over the block beside it
    const tall = Report.layout({ width: 1500, height: 2000 }, 600);
    assert.equal(tall.below, false);
    assert.deepEqual([tall.width, tall.height], [MARGIN_PX + 1500 + GAP_PX + SIDE_PX + MARGIN_PX, 2000 + 2 * MARGIN_PX]);
    assert.equal(tall.block.y, tall.inset.y + INSET_PX + GAP_PX);
    // A map part smaller than the side: the paper grows round it, the map centred
    const small = Report.layout({ width: 400, height: 300 }, 900);
    assert.equal(small.height, 2 * MARGIN_PX + INSET_PX + GAP_PX + 900);
    assert.ok(small.map.y > MARGIN_PX);
    // Exactly 4:3 is beside
    assert.equal(Report.layout({ width: 1600, height: 1200 }, 500).below, false);
});

test("Too large is judged on the whole sheet, and its fits are the sheet's", () => {
    const map = { width: 20000, height: 20000 };
    const area = { x: 0, y: 0, width: 9000, height: 16000 };
    const sheet = (part) => Report.layout(part, 700);
    // The map part alone (144 million pixels) fits; with the inset and block beside it (157 million), it does not
    assert.ok(ExportArea.plan(map, area, 1).fits);
    const plan = ExportArea.plan(map, area, 1, { sheet });
    assert.equal(plan.fits, false);
    assert.deepEqual(plan.part, { width: 9000, height: 16000 });
    assert.ok(ExportArea.fits(sheet(ExportArea.size(area, plan.fitScale))), "the scale offered fits as a sheet");
    assert.ok(ExportArea.fits(sheet(ExportArea.size(plan.fitArea, 1))), "the area offered fits as a sheet");
});

test("the legend: up to 8 keys a column in 2 columns, then the rest counted", () => {
    const items = (n) => Array.from({ length: n }, (_, i) => ({ colour: "#123456", label: `Key ${i + 1}` }));
    assert.deepEqual(Report.legendColumns({ title: "Trade group", items: items(5) }).columns.map((column) => column.length), [5]);
    assert.deepEqual(Report.legendColumns({ title: "Trade group", items: items(11) }).columns.map((column) => column.length), [8, 3]);
    const many = Report.legendColumns({ title: "Culture", items: items(19) });
    assert.deepEqual([many.columns.map((column) => column.length), many.more], [[8, 8], 3]);
    // Drawn in the top-right corner, sized from the image's height
    const ctx = recordingContext(2000, 1500);
    Report.drawLegend(ctx, { title: "Culture", items: items(19) }, { paper: "#efe7d0", ink: "#3b2f25", font: "serif" }, "and 3 others");
    const box = ctx.calls.find((call) => call[0] === "fillRect");
    assert.ok(box[1] + box[3] <= 2000 - 1500 / 42 + 1e-6, "inside the right edge, as far in as the title box");
    assert.ok(box[2] < 100, "at the top");
    assert.ok(ctx.calls.some((call) => call[0] === "fillText" && call[1] === "and 3 others"));
    assert.equal(ctx.calls.filter((call) => call[0] === "fillText" && /^Key /.test(call[1])).length, 16);
});

test("the information block: its rows wrapped to its width, its height from them", () => {
    const panel = {
        totals: [
            { value: "2,900", label: "people" },
            { value: "512", label: "houses" },
        ],
        country: "And 1,200 people in 180 farmhouses round it.",
        cultures: [{ name: "Anglic", colour: "#aa3322", label: "Anglic 2,600 (90%)" }],
        groups: [
            { label: "Crafts", count: "120" },
            { label: "Trade", count: "80" },
            { label: "Farming", count: "40" },
        ],
        moreGroups: [],
        supply: { rows: [{ label: "Its own fields", value: "60%" }], standIn: false },
    };
    const measure = (font) => (text) => String(text).length * parseFloat(/(\d+)px/.exec(font)[1]) * 0.5;
    const rows = Report.blockRows({ heading: "Castford", sub: "market town of 2,900 people", panel, titles: { totals: "Totals", cultures: "Cultures", trades: "Trades", supply: "Supply in a normal year" }, foot: "Seed abc · kept 26 Nov 2026" }, "serif", measure);
    assert.deepEqual(
        rows.map((row) => row.kind),
        ["heading", "text", "title", "text", "text", "title", "swatch", "title", "pairs", "pairs", "title", "pair", "rule", "text"],
    );
    assert.deepEqual(rows[8].cells, [["Crafts", "120"], ["Trade", "80"]]);
    assert.equal(Report.blockHeight(rows), Math.ceil(2 * FILRODENSWMB.LOCAL.EXPORT.REPORT.PAD_PX + rows.reduce((sum, row) => sum + row.height, 0)));
    // A long line wraps; a word wider than the width stays whole
    assert.deepEqual(wrap("one two three four", 9 * 4, (text) => text.length * 4), ["one two", "three", "four"]);
    assert.deepEqual(wrap("unbreakable", 10, (text) => text.length * 4), ["unbreakable"]);
    const ctx = recordingContext(800, 1000);
    Report.drawBlock(ctx, rows, { x: 40, y: 40, width: 720, height: Report.blockHeight(rows) }, { paper: "#efe7d0", ink: "#3b2f25", font: "serif" });
    assert.ok(ctx.calls.some((call) => call[0] === "fillText" && call[1] === "Castford"));
    assert.ok(ctx.calls.some((call) => call[0] === "fillText" && call[1] === "SUPPLY IN A NORMAL YEAR"));
});

test("the inset: its box holds the frame and everything drawn, at least four frames across, at the inset's aspect", () => {
    const { SIDE_PX, INSET_PX } = FILRODENSWMB.LOCAL.EXPORT.REPORT;
    const at = { x: 500, y: 400 };
    const frame = { width: 10, height: 7.5 };
    const alone = Report.insetBox(at, frame);
    assert.ok(Math.abs(alone.width / alone.height - SIDE_PX / INSET_PX) < 1e-9);
    assert.ok(alone.width >= 40 && alone.height >= 30);
    assert.ok(SIDE_PX / alone.width <= FILRODENSWMB.LOCAL.EXPORT.REPORT.INSET_MAX_SCALE + 1e-9, "never drawn past 2×, so the map's pins and names keep their size");
    const big = Report.insetBox(at, { width: 200, height: 150 });
    assert.ok(Math.abs(big.width - 800) < 1e-9, "four frames across, when that is wider");
    assert.ok(Math.abs(alone.x + alone.width / 2 - 500) < 1e-9, "round the settlement");
    const far = Report.insetBox(at, frame, [[120, 80], [940, 410], [500, 720]]);
    for (const [x, y] of [[120, 80], [940, 410], [500, 720]]) assert.ok(x > far.x && x < far.x + far.width && y > far.y && y < far.y + far.height);
    // Drawn: the picture, the cells, a line in and one out, the frame and the key (the map's own labels name the places)
    const ctx = recordingContext(1600, 1200);
    const inset = { picture: { width: 720, height: 540 }, area: far, scale: SIDE_PX / far.width, at, frame, cells: [{ x: 505, y: 402, amount: 3 }], ways: [{ name: "Holloway", amount: 400, way: [[640, 410], [520, 400], [500, 400]] }], out: { name: "Kingsport", amount: 100, way: [[500, 400], [500, 520]] } };
    Report.drawInset(ctx, { x: 0, y: 0, width: SIDE_PX, height: INSET_PX }, inset, { paper: "#efe7d0", ink: "#3b2f25", font: "serif" }, { foodIn: "Food in", soldOn: "Sold on" });
    const texts = ctx.calls.filter((call) => call[0] === "fillText").map((call) => call[1]);
    assert.deepEqual(texts, ["Food in", "Sold on"]);
    assert.ok(ctx.calls.filter((call) => call[0] === "strokeRect").length >= 2, "the frame, on a paper edge");
    // On a held world's map: no lines, and where they are
    const held = recordingContext(1600, 1200);
    Report.drawInset(held, { x: 0, y: 0, width: SIDE_PX, height: INSET_PX }, { ...inset, cells: [], ways: [], out: null }, { paper: "#efe7d0", ink: "#3b2f25", font: "serif" }, { foodIn: "Food in", soldOn: "Sold on", note: "Supply lines are on Tutorial world's map" });
    assert.deepEqual(held.calls.filter((call) => call[0] === "fillText").map((call) => call[1]), ["Supply lines are on Tutorial world's map"]);
});
