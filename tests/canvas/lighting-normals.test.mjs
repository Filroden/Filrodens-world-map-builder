// The 3D view's lighting normals (LightingNormals): a vertex's own slope plus its exaggerated
// broad slope, land and sea bed blurred apart, flat water lit flat.
import assert from "node:assert/strict";
import { test } from "node:test";

const { LightingNormals } = await import("../../src/canvas/LightingNormals.js");

const OPTIONS = { emphasis: 20, radiusPx: 25, tiltLimit: 0.6, fineGain: 1.5, seabedShare: 0.5 };
const COLS = 61;
const ROWS = 41;
const SPACING = 5;

/** A grid whose height at each vertex is `height(col, row)`. */
function grid(height, mask = null) {
    const heights = new Float32Array(COLS * ROWS);
    for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) heights[row * COLS + col] = height(col, row);
    return { heights, cols: COLS, rows: ROWS, spacingX: SPACING, spacingZ: SPACING, mask };
}

const normalAt = (normals, col, row) => {
    const i = (row * COLS + col) * 3;
    return [normals[i], normals[i + 1], normals[i + 2]];
};

/** How far a normal leans from straight up, as the gradient it stands for (|g| = tan of the tilt). */
const tilt = ([x, y, z]) => Math.hypot(x, z) / y;

test("flat ground faces straight up at any emphasis", () => {
    for (const emphasis of [0, 20, 30]) {
        const normals = LightingNormals.compute(grid(() => 10), { ...OPTIONS, emphasis });
        for (let i = 0; i < normals.length; i += 3) assert.deepEqual([normals[i], normals[i + 1], normals[i + 2]].map((v) => v + 0), [0, 1, 0]);
    }
});

test("at emphasis 0 a vertex is lit by its own slope alone, times the fine gain", () => {
    const slope = 0.1;
    const normals = LightingNormals.compute(grid((col) => 10 + col * SPACING * slope), { ...OPTIONS, emphasis: 0 });
    const [x, y, z] = normalAt(normals, 30, 20);
    assert.ok(Math.abs(-x / y - OPTIONS.fineGain * slope) < 1e-6, `gradient ${-x / y}`);
    assert.ok(Math.abs(z) < 1e-9);
});

test("a gentle broad ramp leans further as the emphasis rises, never past the soft cap", () => {
    const slope = 0.01;
    const ramp = grid((col) => 5 + col * SPACING * slope);
    const tilts = [0, 5, 10, 20, 30].map((emphasis) => tilt(normalAt(LightingNormals.compute(ramp, { ...OPTIONS, emphasis }), 30, 20)));
    for (let i = 1; i < tilts.length; i++) assert.ok(tilts[i] > tilts[i - 1], `tilts rise: ${tilts.join(", ")}`);
    const cap = OPTIONS.fineGain * slope + OPTIONS.tiltLimit;
    const steep = tilt(normalAt(LightingNormals.compute(grid((col) => 5 + col * SPACING * 2), { ...OPTIONS, emphasis: 30 }), 30, 20));
    assert.ok(steep - OPTIONS.fineGain * 2 < OPTIONS.tiltLimit, "the broad term adds less than the cap");
    assert.ok(tilts.at(-1) < cap, "a gentle ramp stays under the cap too");
});

test("a coast's drop does not tilt land far inland, since land and sea bed are blurred apart", () => {
    // Flat land at 10 on the left, sea bed at -40 on the right of column 30
    const coast = grid((col) => (col < 30 ? 10 : -40));
    const normals = LightingNormals.compute(coast, OPTIONS);
    // The land's blur holds the sea at 0, so only the land's own drop to 0 shows near the coast...
    const inland = tilt(normalAt(normals, 5, 20));
    assert.ok(inland < 1e-6, `well inland the ground is lit flat (${inland})`);
    // ...and the sea bed's steep -40 does not reach the land at all
    const together = LightingNormals.compute(grid((col) => (col < 30 ? 10 : 10)), OPTIONS);
    assert.ok(tilt(normalAt(together, 20, 20)) < 1e-6);
    const nearCoast = tilt(normalAt(normals, 25, 20));
    const landOnly = tilt(normalAt(LightingNormals.compute(grid((col) => (col < 30 ? 10 : -0.0001)), OPTIONS), 25, 20));
    assert.ok(Math.abs(nearCoast - landOnly) < 1e-3, "the land near the coast leans as if the sea were at its surface");
});

test("masked vertices (a lake's surface, lifted sea ice) take no broad slope", () => {
    const slope = 0.01;
    const mask = new Uint8Array(COLS * ROWS).fill(1);
    const normals = LightingNormals.compute(grid((col) => 5 + col * SPACING * slope, mask), OPTIONS);
    const [x, y] = normalAt(normals, 30, 20);
    assert.ok(Math.abs(-x / y - OPTIONS.fineGain * slope) < 1e-6);
    const lake = grid(() => 3, mask);
    const flat = LightingNormals.compute(lake, OPTIONS);
    assert.deepEqual(normalAt(flat, 30, 20).map((v) => v + 0), [0, 1, 0]);
});

test("edges and corners give finite unit normals, and the result can be written in place", () => {
    const hilly = grid((col, row) => 20 * Math.sin(col / 4) * Math.cos(row / 3) - 5);
    const out = new Float32Array(COLS * ROWS * 3);
    const normals = LightingNormals.compute(hilly, OPTIONS, out);
    assert.equal(normals, out);
    for (let i = 0; i < normals.length; i += 3) {
        const length = Math.hypot(normals[i], normals[i + 1], normals[i + 2]);
        assert.ok(Number.isFinite(length) && Math.abs(length - 1) < 1e-5 && normals[i + 1] > 0, `vertex ${i / 3}`);
    }
});

test("the blur keeps a constant field constant and spreads a spike evenly", () => {
    const values = new Float32Array(COLS * ROWS).fill(7);
    LightingNormals.blur(values, COLS, ROWS, 3, 2);
    assert.ok(values.every((v) => Math.abs(v - 7) < 1e-5));
    const spike = new Float32Array(COLS * ROWS);
    spike[20 * COLS + 30] = 1;
    LightingNormals.blur(spike, COLS, ROWS, 3, 3);
    assert.ok(Math.abs(spike[20 * COLS + 27] - spike[20 * COLS + 33]) < 1e-7 && spike[20 * COLS + 30] < 1);
});
