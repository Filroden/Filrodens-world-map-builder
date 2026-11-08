// Decorations the module draws (src/canvas/decorations): the compass rose's geometry (its points,
// rings, letters and reach, in the interface's letters), a new rose's defaults and faces, and how
// a regional map carries drawn decorations (at the same place relative to the map) while still
// cropping image decorations.
import assert from "node:assert/strict";
import { test } from "node:test";

const { FILRODENSWMB } = await import("../../src/config.js");
const { compassRose, reachOf } = await import("../../src/canvas/decorations/CompassGeometry.js");
const { DrawnDecoration } = await import("../../src/canvas/decorations/DrawnDecoration.js");
const { RegionalExtractor } = await import("../../src/applications/RegionalExtractor.js");

const COLORS = FILRODENSWMB.DECORATIONS.SCHEMES.parchment;
const rose = (fields = {}) => ({ radius: 100, design: "classic", points: 8, rings: 2, degreeRing: false, north: "letter", letters: "cardinal", letterSize: 0.22, backing: true, colors: COLORS, ...fields });

/** Every coordinate a shape list holds, as [x, y] pairs (circles by their reach). */
function coordinates(shapes) {
    const out = [];
    for (const shape of shapes) {
        if (shape.circle) out.push([Math.abs(shape.circle[0]) + shape.circle[2], Math.abs(shape.circle[1]) + shape.circle[2]]);
        else for (const [, ...n] of shape.path) for (let i = 0; i + 1 < n.length; i += 2) out.push([n[i], n[i + 1]]);
    }
    return out;
}

test("a rose of 4, 8, 16 or 32 points draws two tones for its main points and one for the small winds, within 1.3 radii", () => {
    // Two triangles per point of the first two tiers, one shape per small wind
    const expected = { 4: 8, 8: 16, 16: 24, 32: 40 };
    for (const points of [4, 8, 16, 32]) {
        const { shapes } = compassRose(rose({ points, rings: 0, backing: false }));
        const polygons = shapes.filter((shape) => shape.path);
        assert.equal(polygons.length, expected[points], `${points} points`);
        for (const [x, y] of coordinates(shapes)) assert.ok(Math.hypot(x, y) <= 130, `${points} points: within 1.3 radii`);
    }
});

test("the letters sit at their bearings in the interface's own letters, and the rose is the same every time", () => {
    const text = { N: "N", E: "O", S: "S", W: "W" };
    const { letters } = compassRose(rose(), text);
    assert.deepEqual(letters.map((l) => [l.key, l.text]), [["N", "N"], ["E", "O"], ["S", "S"], ["W", "W"]]);
    const at = Object.fromEntries(letters.map((l) => [l.key, l]));
    assert.ok(at.N.y < 0 && Math.abs(at.N.x) < 1e-9, "north is straight up");
    assert.ok(at.E.x > 0 && Math.abs(at.E.y) < 1e-9);
    assert.ok(at.S.y > 0 && at.W.x < 0);
    assert.equal(at.N.size, 22, "letters are their share of the radius");
    assert.deepEqual(compassRose(rose(), text), compassRose(rose(), text));
    assert.equal(compassRose(rose({ letters: "all" })).letters.length, 8);
    assert.equal(compassRose(rose({ letters: "none" })).letters.length, 0);
});

test("the backing disc is drawn first, the fleur-de-lis replaces N, and the arrow is one two-toned point", () => {
    const backed = compassRose(rose());
    assert.ok(backed.shapes[0].circle && backed.shapes[0].fill === COLORS.backing, "the disc lies behind everything");
    assert.ok(!compassRose(rose({ backing: false })).shapes.some((shape) => shape.fill === COLORS.backing && shape.circle));
    const fleur = compassRose(rose({ north: "fleur" }));
    assert.ok(!fleur.letters.some((l) => l.key === "N"));
    assert.equal(fleur.shapes.length, compassRose(rose()).shapes.length + 5, "a fleur-de-lis of five shapes");
    assert.ok(fleur.shapes.slice(-5).every((shape) => shape.fill === COLORS.letter), "the fleur-de-lis takes the letters' colour, as the N would");
    const haloed = compassRose(rose({ north: "fleur", halo: true }));
    assert.equal(haloed.shapes.length, fleur.shapes.length + 5, "with a halo, the fleur-de-lis drawn first in the backing's colour");
    assert.ok(haloed.shapes.slice(-10, -5).every((shape) => shape.fill === COLORS.backing && shape.stroke === COLORS.backing && shape.join === "round"));
    const ticks = compassRose(rose({ degreeRing: true }));
    assert.equal(ticks.shapes.length - backed.shapes.length, 1 + 72, "a degree ring: its circle and a tick every 5 degrees");
    const arrow = compassRose(rose({ design: "arrow", rings: 1 }));
    assert.equal(arrow.shapes.filter((shape) => shape.path).length, 2);
    assert.deepEqual(arrow.letters.map((l) => l.key), ["N"]);
});

test("a rose's reach covers its letters, and grows with its radius", () => {
    const geometry = compassRose(rose());
    const reach = reachOf(geometry);
    for (const letter of geometry.letters) assert.ok(reach >= Math.hypot(letter.x, letter.y) + letter.size / 2);
    assert.ok(Math.abs(reachOf(compassRose(rose({ radius: 200 }))) - 2 * reach) < 1e-6);
});

test("a new compass is a classic rose sized to the map, near its bottom right inside the border, in the default colours", () => {
    const made = DrawnDecoration.create("compass", { id: "roseAAAAAAAAAAAA", name: "Compass rose", mapWidth: 2000, mapHeight: 1600, inset: 30 });
    assert.equal(made.size, 144, "9% of the shorter side");
    assert.equal(made.x, Math.round(2000 - 30 - 144 * FILRODENSWMB.DECORATIONS.COMPASS.CORNER_RADII));
    assert.equal(made.y, Math.round(1600 - 30 - 144 * FILRODENSWMB.DECORATIONS.COMPASS.CORNER_RADII));
    assert.deepEqual(made.colors, { ...COLORS });
    assert.equal(made.fontFamily, "Cinzel");
    assert.deepEqual(DrawnDecoration.faces(made), [{ fontFamily: "Cinzel", bold: true, italic: false }]);
    assert.deepEqual(DrawnDecoration.faces({ ...made, letters: "none" }), []);
    assert.deepEqual(DrawnDecoration.faces({ id: "x", src: "a.png" }), [], "an image decoration has no faces");
    assert.ok(DrawnDecoration.isDrawn(made) && !DrawnDecoration.isDrawn({ src: "a.png" }));
    assert.ok(DrawnDecoration.canCreate("compass") && !DrawnDecoration.canCreate("image"));
});

test("a rose missing fields (an older or hand-edited map) takes its design's defaults", () => {
    const filled = DrawnDecoration.compassOf({ kind: "compass", design: "mariner", size: 90 });
    assert.deepEqual([filled.points, filled.north, filled.degreeRing, filled.fontFamily, filled.radius], [32, "fleur", true, "IM Fell English", 90]);
    assert.equal(DrawnDecoration.compassOf({ kind: "compass", design: "nonsense" }).design, "classic");
    assert.equal(DrawnDecoration.compassOf({ kind: "compass", colors: { dark: "#000000" } }).colors.dark, "#000000", "its own colours over the scheme's");
});

test("a regional map keeps a drawn decoration at the same place relative to the map and size relative to its shorter side, and crops images", () => {
    const parent = { width: 2000, height: 1600 };
    const target = { width: 1200, height: 900 };
    const compass = { id: "roseAAAAAAAAAAAA", type: "decoration", kind: "compass", x: 1700, y: 1248, size: 144, scale: 1 };
    const inside = { id: "imageAAAAAAAAAAA", type: "decoration", src: "a.png", x: 300, y: 300 };
    const outside = { id: "imageBBBBBBBBBBB", type: "decoration", src: "b.png", x: 1900, y: 100 };
    // A stand-in crop that keeps the parent's left half
    const translate = (list) => list.filter((item) => item.x <= parent.width / 2).map((item) => ({ ...item, x: item.x * 0.6, y: item.y * 0.6 }));
    const carried = RegionalExtractor.carryDecorations([inside, compass, outside], parent, target, translate);
    assert.deepEqual(carried.map((item) => item.id), ["imageAAAAAAAAAAA", "roseAAAAAAAAAAAA"], "the image outside the crop is dropped, the order kept");
    const rose = carried[1];
    assert.ok(Math.abs(rose.x / target.width - 0.85) < 1e-9 && Math.abs(rose.y / target.height - 0.78) < 1e-9);
    assert.equal(rose.size, 144 * (900 / 1600));
    assert.equal(compass.x, 1700, "the parent's decoration is left as it was");
});

test("a thumbnail holds numbers and #rrggbb colours only, whatever the shapes carry", async () => {
    const { svgShapes, compassThumbnail } = await import("../../src/canvas/decorations/DecorationSvg.js");
    const data = svgShapes([{ path: [["M", 1.234, 2], ["L", 3, NaN], ["Z"]], fill: "red;background:url(x)", stroke: "#AbCdEf", width: 0.5 }, { circle: [0, 0, 5], fill: "#123456" }], 10);
    assert.equal(data.viewBox, "-10 -10 20 20");
    assert.deepEqual(data.shapes[0], { circle: null, d: "M1.23 2 L3 0 Z", fill: "none", stroke: "#AbCdEf", width: 0.5, join: "miter", opacity: 1 });
    assert.deepEqual(data.shapes[1].circle, { cx: 0, cy: 0, r: 5 });
    const rose = DrawnDecoration.compassOf({ kind: "compass", design: "mariner", size: 140 });
    const thumbnail = compassThumbnail(rose);
    assert.ok(thumbnail.shapes.length > 40);
    assert.ok(thumbnail.shapes.every((shape) => (shape.d ?? "").match(/^[MLCQZ0-9 .-]*$/)), "paths are commands and numbers");
});

// A stand-in measure: every character half its size wide
const measure = (text, size) => text.length * size * 0.5;

test("a title is fitted: at its size, then shrunk, then on two balanced lines, and reported when even that is too long", async () => {
    const { fitTitle, MIN_SHRINK } = await import("../../src/canvas/decorations/CartoucheGeometry.js");
    const widths = { minWidth: 80, maxWidth: 300 };
    const short = fitTitle(measure, "Isla", 20, widths);
    assert.deepEqual([short.size, short.lines, short.textWidth, short.overflow], [20, ["Isla"], 80, false], "a short name gets the narrowest panel");
    const longer = fitTitle(measure, "The Northern Reaches", 20, widths);
    assert.deepEqual([longer.size, longer.textWidth], [20, 200], "a longer one widens it");
    const shrunk = fitTitle(measure, "The Kingdom of the Northern Reaches", 20, widths);
    assert.equal(shrunk.lines.length, 1);
    assert.ok(shrunk.size < 20 && shrunk.size >= 20 * MIN_SHRINK && shrunk.textWidth <= 300, "then the text shrinks");
    const two = fitTitle(measure, "The United Kingdom of the Northern Reaches and the Isles", 20, widths);
    assert.deepEqual(two.lines, ["The United Kingdom of the", "Northern Reaches and the Isles"], "then two lines, the longer as short as it can be");
    assert.equal(two.overflow, false);
    const word = fitTitle(measure, "Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch", 20, widths);
    assert.deepEqual([word.size, word.overflow, word.textWidth], [20 * MIN_SHRINK, true, measure("Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch", 20 * MIN_SHRINK)], "one word too long is reported, its panel holding it");
});

test("a cartouche grows with its text, a subtitle and a second line, in each design", async () => {
    const { cartouche } = await import("../../src/canvas/decorations/CartoucheGeometry.js");
    for (const design of ["plaque", "ribbon", "frame"]) {
        const panel = (fields) => cartouche({ design, textWidth: 100, titleSize: 20, colors: COLORS, ...fields });
        const base = panel();
        assert.ok(panel({ textWidth: 200 }).width > base.width, `${design}: wider text, wider panel`);
        const subtitled = panel({ subtitleSize: 9 });
        assert.ok(subtitled.height > base.height && subtitled.subtitle.y > subtitled.title.y, `${design}: a subtitle adds height, below the title`);
        assert.equal(base.subtitle, null);
        assert.ok(panel({ lines: 2 }).height > base.height, `${design}: two lines add height`);
        assert.ok(base.shapes.every((shape) => [shape.fill, shape.stroke].every((paint) => paint === undefined || /^#[0-9a-f]{6}$/i.test(paint))));
    }
});

test("a new cartouche is a plaque at the top centre showing the map's name; its title follows the map unless it has its own", () => {
    const made = DrawnDecoration.create("cartouche", { id: "plateAAAAAAAAAAA", name: "Cartouche", mapWidth: 2000, mapHeight: 1600, inset: 30 });
    assert.deepEqual([made.kind, made.design, made.size, made.x, made.titleSource, made.fontFamily, made.bold], ["cartouche", "plaque", 56, 1000, "map", "Cinzel", true]);
    assert.equal(made.y, Math.round(30 + 56 * FILRODENSWMB.DECORATIONS.CARTOUCHE.TOP_TITLES));
    assert.ok(DrawnDecoration.canCreate("cartouche"));
    const panel = DrawnDecoration.cartoucheOf(made);
    const names = { mapName: "Islemark", untitled: "Unnamed map" };
    assert.equal(DrawnDecoration.titleOf(panel, names), "Islemark");
    assert.equal(DrawnDecoration.titleOf(panel, { mapName: null, untitled: "Unnamed map" }), "Unnamed map", "a map never saved");
    assert.equal(DrawnDecoration.titleOf({ ...panel, titleSource: "custom", title: "The Reach" }, names), "The Reach");
    assert.equal(DrawnDecoration.titleOf({ ...panel, titleSource: "custom", title: "  " }, names), "Islemark", "an empty title of its own shows the map's name");
    assert.equal(DrawnDecoration.titleOf({ ...panel, capitals: true }, names), "ISLEMARK");
    assert.deepEqual(DrawnDecoration.faces(made), [{ fontFamily: "Cinzel", bold: true, italic: false }], "no subtitle, one face");
    assert.deepEqual(DrawnDecoration.faces({ ...made, subtitle: "A survey" })[1], { fontFamily: "EB Garamond", bold: false, italic: true });
    assert.equal(DrawnDecoration.cartoucheOf({ kind: "cartouche", design: "frame" }).fontFamily, "Cinzel Decorative", "a missing font takes its design's");
});

test("a cartouche's layout keeps within its widest share of the map, widens for its subtitle, and reports text that cannot fit", () => {
    const panel = (fields) => DrawnDecoration.cartoucheOf({ kind: "cartouche", size: 20, maxWidth: 0.4, ...fields });
    const map = { mapWidth: 1000 };
    const plain = DrawnDecoration.layoutCartouche(panel(), "Islemark", measure, map);
    assert.equal(plain.overflow, false);
    const subtitled = DrawnDecoration.layoutCartouche(panel({ subtitle: "Being a true survey of the coasts" }), "Islemark", measure, map);
    assert.ok(subtitled.geometry.width > plain.geometry.width, "the subtitle widens the panel");
    assert.ok(subtitled.geometry.width <= 0.4 * 1000 + 20 * 2, "within its widest, give or take its ends");
    const long = DrawnDecoration.layoutCartouche(panel({ maxWidth: 0.1 }), "Llanfairpwllgwyngyllgogerychwyrndrobwll", measure, map);
    assert.equal(long.overflow, true);
    assert.ok(long.geometry.width > measure("Llanfairpwllgwyngyllgogerychwyrndrobwll", 20 * 0.6), "the panel holds text that cannot fit, rather than it spilling out");
    const scaled = DrawnDecoration.layoutCartouche(panel({ maxWidth: 0.2 }), "Islemark Reaches", measure, { mapWidth: 1000, scale: 2 });
    assert.equal(scaled.overflow, false);
    assert.ok(scaled.geometry.width * 2 <= 0.2 * 1000 + 20 * 4, "a scaled cartouche keeps within its share when drawn at its scale");
});

test("a cartouche's thumbnail holds numbers and #rrggbb colours only", async () => {
    const { cartoucheThumbnail } = await import("../../src/canvas/decorations/DecorationSvg.js");
    for (const design of ["plaque", "ribbon", "frame"]) {
        const thumbnail = cartoucheThumbnail(DrawnDecoration.cartoucheOf({ kind: "cartouche", design, colors: { text: "url(x)" } }));
        assert.match(thumbnail.viewBox, /^-?[0-9.]+ -?[0-9.]+ [0-9.]+ [0-9.]+$/);
        assert.ok(thumbnail.shapes.every((shape) => /^(#[0-9a-f]{6}|none)$/i.test(shape.fill) && /^(#[0-9a-f]{6}|none)$/i.test(shape.stroke)));
        assert.equal(thumbnail.shapes.at(-1).stroke, "none", "a bad colour is drawn as none");
    }
});
