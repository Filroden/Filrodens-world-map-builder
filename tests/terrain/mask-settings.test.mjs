// A guided map's land masks with their own coast settings (MaskSettings): masks with none, an
// Ocean mask's kept settings, Sharp edge on its own and any mask on the legacy coastline rules
// shape the map exactly as before; a mask's own setting applies inside it and fades beyond its
// edge, sooner with Sharp edge, and the land it does not reach is shaped exactly as before; a
// Land mask on top covers what lies beneath with the map's values where it has none of its own,
// while a Coast only mask lays only its own; a Coast only mask shapes no land; the sea takes the
// nearest coast's settings; the bands the workers take match the whole map; and a regional map
// reads its parent's values.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { installPlatform, platform } from "../../src/platform/index.js";

installPlatform({ ...platform, i18n: { localize: (key) => key, format: (key) => key, lang: "en" } });
const { FILRODENSWMB } = await import("../../src/config.js");
const { MapStateManager } = await import("../../src/applications/MapStateManager.js");
const { ProceduralEngine } = await import("../../src/generation/ProceduralEngine.js");
const { MaskSettings } = await import("../../src/generation/MaskSettings.js");
const { typed, clean, cleanContext, RULES } = await import("../../src/data/MapRules.js");

const W = 500;
const H = 400;
const { LEGACY, REVISION_3 } = FILRODENSWMB.TERRAIN_VERSION;

/** Points round an ellipse, with a seeded wobble. */
function blob(cx, cy, rx, ry, count, seed, wobble = 0.12) {
    let s = seed;
    const next = () => (s = (s * 16807) % 2147483647) / 2147483647;
    return Array.from({ length: count }, (_, i) => {
        const a = (i / count) * Math.PI * 2;
        const r = 1 + (next() - 0.5) * 2 * wobble;
        return { x: Math.round(cx + Math.cos(a) * rx * r), y: Math.round(cy + Math.sin(a) * ry * r) };
    });
}

// A continent in the west (A), two overlapping islands in the north east (C, D) with an Ocean
// mask cutting across them (R), and two islands across a strait in the south east (E, F)
const SHAPES = {
    A: blob(130, 200, 95, 140, 28, 11),
    C: blob(325, 112, 65, 55, 20, 37),
    D: blob(395, 130, 65, 58, 20, 41),
    R: [
        { x: 322, y: 60 },
        { x: 418, y: 175 },
        { x: 410, y: 182 },
        { x: 314, y: 67 },
    ],
    E: blob(308, 300, 52, 55, 20, 53, 0.05),
    F: blob(435, 300, 52, 55, 20, 59, 0.05),
};
const masks = (settings = {}) =>
    Object.entries(SHAPES).map(([id, points]) => ({ id: `mask${id}`, name: id, operation: id === "R" ? "subtract" : "add", points, ...(settings[id] ?? {}) }));

/** The map's derived settings, on the top map or in a crop's frame. */
function paramsFor(terrainVersion, world = null) {
    const state = { ...MapStateManager.buildDefaultUiState(W, H), terrainVersion, world, seaLevel: 0.4, generationEngine: "guided", coastlineFracture: 0.2, shelfRange: 0.15, coastalPlain: 0.05 };
    return MapStateManager.getDerivedMapParameters(state, {}).params;
}

/** Guided terrain from the masks, and the job it was made from. */
function run(landMasks, { terrainVersion = REVISION_3, world = null } = {}) {
    const params = paramsFor(terrainVersion, world);
    const engine = new ProceduralEngine("MASKS");
    const job = engine.prepareGuidedDetail(W, H, params, landMasks);
    const elevation = new Float32Array(W * H);
    engine.generateDetailRows(W, H, params, job, 0, H, elevation);
    return { elevation, job, params };
}

const fingerprint = (elevation) => createHash("sha256").update(Buffer.from(elevation.buffer)).digest("hex").slice(0, 16);
const insideOf = (points, x, y) => ProceduralEngine.isPointInPolygon(x, y, points);
/** A settings field's value (its difference from the map's) at a world point, as the engine reads it. */
function settingAt(field, key, x, y) {
    const gx = Math.round((x - field.u0) * field.cellsPerPixel);
    const gy = Math.round((y - field.v0) * field.cellsPerPixel);
    return field.settings[key][gy * field.width + gx];
}

test("masks with no settings of their own, an Ocean mask's kept settings, Sharp edge alone and the legacy rules shape the map exactly as before", () => {
    // Fingerprints taken before masks had settings
    const before = run(masks());
    assert.equal(fingerprint(before.elevation), "40ff4ee75ad69d74");
    assert.equal(before.job.field.settings, undefined, "no fields where no mask overrides anything");
    assert.equal(fingerprint(run(masks({ R: { coastlineFracture: 1, shelfRange: 0.9 } })).elevation), "40ff4ee75ad69d74", "an Ocean mask's settings are ignored");
    assert.equal(fingerprint(run(masks({ C: { sharpEdge: true } })).elevation), "40ff4ee75ad69d74", "Sharp edge alone changes nothing");
    const legacy = { terrainVersion: LEGACY };
    assert.equal(fingerprint(run(masks(), legacy).elevation), "91e67ce201918c06");
    assert.equal(fingerprint(run(masks({ C: { coastlineFracture: 1 } }), legacy).elevation), "91e67ce201918c06", "the legacy coastline rules have no mask settings");
});

test("a mask's own fracture changes its coast, and the land no mask reaches is shaped exactly as before", () => {
    const before = run(masks());
    const after = run(masks({ D: { coastlineFracture: 1 } }));
    assert.ok(after.job.field.settings.fracture, "a fracture field");
    assert.equal(after.job.field.settings.plain, undefined, "and none for the settings no mask overrides");
    let changedInD = 0;
    let changedInA = 0;
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const i = y * W + x;
            if (after.elevation[i] === before.elevation[i]) continue;
            if (insideOf(SHAPES.D, x, y)) changedInD++;
            if (insideOf(SHAPES.A, x, y)) changedInA++;
        }
    }
    assert.ok(changedInD > 1000, `D's land is reshaped (${changedInD} pixels)`);
    // (The open sea may change a little anywhere, as it takes its nearest coast's fracture)
    assert.equal(changedInA, 0, "the continent in the west, far from D, is untouched to the last bit");
    // Inside D its full value (as a difference from the map's 0.2); far away, exactly 0
    const { field } = after.job;
    assert.ok(Math.abs(settingAt(field, "fracture", 395, 130) - 0.8) < 1e-6);
    assert.equal(settingAt(field, "fracture", 130, 200), 0);
});

test("later masks lie on top, and a mask's value fades beyond its edge, much sooner with Sharp edge", () => {
    const overlap = run(masks({ C: { coastlineFracture: 0.05 }, D: { coastlineFracture: 1 } })).job.field;
    // Where C and D overlap (away from R's channel), D (later in the list) decides
    const [x0, y0] = [365, 140];
    assert.ok(insideOf(SHAPES.C, x0, y0) && insideOf(SHAPES.D, x0, y0) && !insideOf(SHAPES.R, x0, y0));
    assert.ok(Math.abs(settingAt(overlap, "fracture", x0, y0) - 0.8) < 1e-6);

    // On C's land just beyond D's edge, the blended value still holds much of D's; with Sharp
    // edge, little or none of it
    const blended = run(masks({ D: { coastalPlain: 0.8 } })).job.field;
    const sharp = run(masks({ D: { coastalPlain: 0.8, sharpEdge: true } })).job.field;
    // A land point of C just west of D's edge, 12 px from it
    const [x, y] = edgeNeighbour(SHAPES.D, SHAPES.C, 12);
    const fullDelta = 0.75;
    assert.ok(settingAt(blended, "plain", x, y) > 0.3 * fullDelta, `blended: ${settingAt(blended, "plain", x, y)}`);
    assert.ok(settingAt(sharp, "plain", x, y) < 0.01, `sharp: ${settingAt(sharp, "plain", x, y)}`);
});

/** A point inside `other` but outside `mask`, `gap` px from `mask`'s nearest edge. */
function edgeNeighbour(mask, other, gap) {
    for (let x = 250; x < W; x++) {
        for (let y = 0; y < H; y++) {
            if (!insideOf(other, x, y) || insideOf(mask, x, y)) continue;
            const distance = Math.min(...mask.map((a, i) => segmentDistance(x, y, a, mask[(i + 1) % mask.length])));
            if (Math.abs(distance - gap) < 0.5) return [x, y];
        }
    }
    throw new Error("no such point");
}
function segmentDistance(x, y, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy));
}

test("a Land mask covers what lies beneath it with all its settings, the map's where it has none; a Coast only mask lays only its own", () => {
    // A Coast only mask on A's east coast with wide plains, and a small Land mask over part of it
    const coast = { id: "maskK", name: "K", operation: "settings", points: blob(220, 200, 40, 60, 12, 7), coastalPlain: 0.8 };
    const land = { id: "maskL", name: "L", operation: "add", points: blob(235, 200, 22, 22, 10, 9) };
    const at = [240, 200];
    assert.ok(insideOf(coast.points, ...at) && insideOf(land.points, ...at));
    // L on top (later in the list): the map's plains inside it, though it has none of its own
    const onTop = run([...masks(), coast, land]).job.field;
    assert.equal(settingAt(onTop, "plain", ...at), 0);
    // L beneath K: K's plains, as a Coast only mask lays its own over whatever lies beneath
    const beneath = run([...masks(), land, coast]).job.field;
    assert.ok(Math.abs(settingAt(beneath, "plain", ...at) - 0.75) < 1e-6);
    // L on top with its own fracture: its fracture, and still the map's plains
    const ownFracture = run([...masks(), coast, { ...land, coastlineFracture: 0.6 }]).job.field;
    assert.ok(Math.abs(settingAt(ownFracture, "fracture", ...at) - 0.4) < 1e-6);
    assert.equal(settingAt(ownFracture, "plain", ...at), 0);
});

test("a Coast only mask shapes no land: alone it changes nothing, with a setting it changes the coast inside it", () => {
    const coast = { id: "maskK", name: "K", operation: "settings", points: blob(220, 200, 40, 60, 12, 7) };
    assert.equal(fingerprint(run([...masks(), coast]).elevation), fingerprint(run(masks()).elevation));
    assert.ok(!MaskSettings.shapesLand(coast));
    const rugged = run([...masks(), { ...coast, coastlineFracture: 1 }]);
    const before = run(masks());
    let changed = 0;
    for (let y = 140; y < 260; y++) for (let x = 180; x < 260; x++) if (rugged.elevation[y * W + x] !== before.elevation[y * W + x]) changed++;
    assert.ok(changed > 500, `A's east coast inside the mask is reshaped (${changed} pixels)`);
});

test("at sea the nearest coast decides: each side of a strait takes its own coast's shelf, the middle a mix", () => {
    const { field } = run(masks({ E: { shelfRange: 0 }, F: { shelfRange: 1 } })).job;
    const east = { x: 498, y: 300 };
    const west = { x: 250, y: 300 };
    assert.ok(Math.abs(settingAt(field, "shelf", east.x, east.y) - 0.85) < 0.05, "off F's far coast: F's shelf");
    assert.ok(Math.abs(settingAt(field, "shelf", west.x, west.y) + 0.15) < 0.05, "off E's far coast: E's shelf");
    // In the strait, between the two
    const strait = settingAt(field, "shelf", 372, 300);
    assert.ok(strait > -0.1 && strait < 0.8, `the strait: ${strait}`);
});

test("bands cut as the workers cut them match the whole map, with mask settings", () => {
    const whole = run(masks({ D: { coastlineFracture: 1, coastalPlain: 0.5 }, F: { shelfRange: 1 } }));
    const banded = new Float32Array(W * H);
    for (let b = 0; b < 5; b++) {
        const rowStart = Math.floor((b * H) / 5);
        const rowEnd = Math.floor(((b + 1) * H) / 5);
        const job = ProceduralEngine.detailJobForRows(whole.job, whole.params, rowStart, rowEnd);
        const rows = new Float32Array(W * (rowEnd - rowStart));
        new ProceduralEngine("MASKS").generateDetailRows(W, H, whole.params, job, rowStart, rowEnd, rows);
        banded.set(rows, rowStart * W);
    }
    assert.ok(
        banded.every((value, i) => Object.is(value, whole.elevation[i])),
        "every pixel",
    );
});

test("a regional map reads its parent's settings at the same world points", () => {
    const settings = { D: { coastlineFracture: 1 }, F: { shelfRange: 1 } };
    const parent = run(masks(settings)).job.field;
    // A ×2 crop of the east half: its masks in its own pixels, as RegionalExtractor makes them
    const crop = { zoom: 2, x: 250, y: 100 };
    const world = { zoom: crop.zoom, originX: crop.x, originY: crop.y, rootW: W, rootH: H };
    const cropped = masks(settings).map((mask) => ({ ...mask, points: mask.points.map((p) => ({ x: (p.x - crop.x) * crop.zoom, y: (p.y - crop.y) * crop.zoom })) }));
    const regional = run(cropped, { world }).job.field;
    let worst = 0;
    for (const key of ["fracture", "shelf"]) {
        for (let y = 110; y < 290; y += 7) {
            for (let x = 260; x < 490; x += 7) worst = Math.max(worst, Math.abs(settingAt(regional, key, x, y) - settingAt(parent, key, x, y)));
        }
    }
    assert.ok(worst < 0.12, `largest difference ${worst}`);
});

test("a land mask's settings, Sharp edge and the Coast only type are kept on load and in the inspector's rules", () => {
    const saved = { id: "testMaskAAAAAAA1", name: "Q", operation: "settings", points: SHAPES.C, coastlineFracture: 0.6, coastalPlain: 0.4, shelfRange: 0.3, sharpEdge: true };
    assert.deepEqual(clean(saved, RULES.landMask, cleanContext(() => "testMaskBBBBBBB2")), saved);
    assert.deepEqual(typed("landMask", { coastlineFracture: null, operation: "settings" }, saved), { coastlineFracture: null, operation: "settings" });
    assert.equal(typed("landMask", { operation: "lake" }, saved).operation, "settings", "an unknown type keeps the current one");
    assert.deepEqual(MaskSettings.inputsOf({ operation: "add" }), [], "a mask with no settings adds nothing to the terrain's inputs");
    assert.deepEqual(MaskSettings.inputsOf({ operation: "subtract", coastlineFracture: 1 }), [], "nor does an Ocean mask's kept setting");
    assert.deepEqual(MaskSettings.inputsOf(saved), [[["coastlineFracture", 0.6], ["coastalPlain", 0.4], ["shelfRange", 0.3]], true]);
});
