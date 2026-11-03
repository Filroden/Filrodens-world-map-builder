// The Catmull-Rom curves drawn through the lines a user places (CatmullRom): before terrain
// revision 3, the uniform curve exactly as the module sampled it, so a revision 2 map's tectonic
// features and custom rivers regenerate to the last digit; from revision 3 on, the centripetal
// curve, which never loops, passes through both ends, copes with points on top of each other, and
// is the curve a click on the line is tested against.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { installPlatform, platform } from "../../src/platform/index.js";

installPlatform({ ...platform, i18n: { localize: (key) => key, format: (key) => key, lang: "en" } });
const { FILRODENSWMB } = await import("../../src/config.js");
const { MapStateManager } = await import("../../src/applications/MapStateManager.js");
const { ProceduralEngine } = await import("../../src/generation/ProceduralEngine.js");
const { TectonicFeatureEngine } = await import("../../src/generation/TectonicFeatureEngine.js");
const { LineField } = await import("../../src/generation/tectonics/LineField.js");
const { CatmullRom } = await import("../../src/tools/CatmullRom.js");
const { SpatialMath } = await import("../../src/tools/SpatialMath.js");

const { REVISION_2, REVISION_3 } = FILRODENSWMB.TERRAIN_VERSION;
const p = (x, y) => ({ x, y });
// Two clicks close together between long stretches: the uniform curve loops there
const LOOPING = [p(40, 200), p(260, 120), p(270, 125), p(262, 132), p(480, 220)];
// Lines as people draw them: even, uneven, a point placed twice, a sharp turn
const LINES = [LOOPING, [p(690, 1530), p(820, 1500), p(950, 1490), p(1080, 1475), p(1240, 1450)], [p(10, 10), p(80, 40), p(80, 40), p(200, 30)], [p(0, 0), p(300, 0), p(305, 4), p(0, 8)], [p(5, 5), p(60, 9), p(61, 70)]];

/** The uniform curve as the canvas and LineField sampled it before CatmullRom (the module's code of old). */
function oldCanvasCurve(points) {
    const curve = [];
    const anchored = [points[0], ...points, points.at(-1)];
    for (let i = 1; i < anchored.length - 2; i++) {
        const [p0, p1, p2, p3] = [anchored[i - 1], anchored[i], anchored[i + 1], anchored[i + 2]];
        for (let t = 0; t <= 1; t += 1 / 20) {
            const t2 = t * t;
            const t3 = t2 * t;
            const x = 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
            const y = 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
            const last = curve.at(-1);
            if (last && Math.abs(last.x - x) < 0.1 && Math.abs(last.y - y) < 0.1) continue;
            curve.push({ x, y });
        }
    }
    return curve;
}

/** The uniform curve as HydrologyEngine sampled it before CatmullRom. */
function oldRiverCurve(points, step) {
    const curve = [];
    const anchored = [points[0], ...points, points.at(-1)];
    for (let i = 1; i < anchored.length - 2; i++) {
        const [p0, p1, p2, p3] = [anchored[i - 1], anchored[i], anchored[i + 1], anchored[i + 2]];
        const steps = Math.max(1, Math.floor(Math.hypot(p2.x - p1.x, p2.y - p1.y) / step));
        for (let t = 0; t < 1; t += 1 / steps) {
            const t2 = t * t;
            const t3 = t2 * t;
            const x = 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
            const y = 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
            curve.push({ x, y });
        }
    }
    curve.push({ x: points.at(-1).x, y: points.at(-1).y });
    return curve;
}

const xy = (curve) => curve.map(({ x, y }) => ({ x, y }));

/** Where a sampled curve crosses itself (stretches not next to each other) or turns straight back. */
function loops(curve) {
    let count = 0;
    for (let i = 1; i < curve.length; i++) {
        for (let j = i + 3; j < curve.length; j++) {
            const [a, b, c, d] = [curve[i - 1], curve[i], curve[j - 1], curve[j]];
            const den = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
            if (Math.abs(den) < 1e-12) continue;
            const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / den;
            const u = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / den;
            if (t > 0 && t < 1 && u > 0 && u < 1) count++;
        }
    }
    for (let i = 2; i < curve.length; i++) {
        const [a, b, c] = [curve[i - 2], curve[i - 1], curve[i]];
        if ((b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) < 0) count++;
    }
    return count;
}

test("the uniform curve is sampled exactly as it was before revision 3", () => {
    for (const points of LINES) {
        assert.deepEqual(xy(CatmullRom.open(points, { dedupe: 0.1 })), oldCanvasCurve(points));
        assert.deepEqual(LineField.splinePoints(points), oldCanvasCurve(points));
        assert.deepEqual(xy(CatmullRom.open(points, { step: 0.25 })), oldRiverCurve(points, 0.25));
    }
});

test("a revision 2 map's tectonic features are built exactly as before", () => {
    // Taken from the module before CatmullRom; revision 3 builds them along the centripetal curve
    const before = { range: "798ecd5f40d02afb", rift: "56d34f989e0173b2", subduction: "fbb44d6c54f6164e", hotspot: "681fb4a887635d58" };
    const SIZE = 500;
    const simplex = new ProceduralEngine("LINES").simplex;
    const points = [p(60, 300), p(200, 180), p(212, 190), p(330, 260), p(440, 120)];
    const render = (type, terrainVersion) => {
        const state = { ...MapStateManager.buildDefaultUiState(SIZE, SIZE), terrainVersion, seaLevel: 0.4, generationEngine: "advanced" };
        const params = MapStateManager.getDerivedMapParameters(state, {}).params;
        const fault = { id: type, type, revision: FILRODENSWMB.TECTONICS.FEATURES.REVISION, thickness: 60, strength: 0.5, points };
        const ground = new Float32Array(SIZE * SIZE);
        const floor = type === "hotspot" ? 0.15 : 0.55;
        for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) ground[y * SIZE + x] = floor + 0.05 * simplex.noise2D(x / 90, y / 90);
        const elevation = ground.slice();
        TectonicFeatureEngine.apply(elevation, ground, [fault], { width: SIZE, height: SIZE, simplex, seaLevel: 0.4, frame: { zoom: 1, originX: 0, originY: 0, rootSize: SIZE }, params });
        return createHash("sha256").update(Buffer.from(elevation.buffer)).digest("hex").slice(0, 16);
    };
    for (const [type, hash] of Object.entries(before)) {
        assert.equal(render(type, REVISION_2), hash, `${type} at revision 2`);
        assert.notEqual(render(type, REVISION_3), hash, `${type} at revision 3 follows the centripetal curve`);
    }
});

test("the centripetal curve never loops where the uniform one does", () => {
    assert.ok(loops(CatmullRom.open(LOOPING, { step: 0.25 })) > 0, "the uniform curve loops on this line (or the test shows nothing)");
    // (The fourth line turns straight back on purpose, so it is left out here)
    for (const points of LINES.filter((_, i) => i !== 3)) assert.equal(loops(CatmullRom.open(points, { centripetal: true, step: 0.25 })), 0, JSON.stringify(points));
});

test("the centripetal curve passes through every point, the first and last included", () => {
    for (const points of LINES) {
        for (const sampling of [{ resolution: 20 }, { step: 0.25 }]) {
            const curve = CatmullRom.open(points, { centripetal: true, ...sampling });
            assert.ok(Math.hypot(curve[0].x - points[0].x, curve[0].y - points[0].y) < 1e-9, "starts on the first point");
            assert.ok(Math.hypot(curve.at(-1).x - points.at(-1).x, curve.at(-1).y - points.at(-1).y) < 1e-9, "ends on the last point");
            for (const point of points) assert.ok(Math.min(...curve.map((q) => Math.hypot(q.x - point.x, q.y - point.y))) < 0.3, `passes through ${JSON.stringify(point)}`);
        }
    }
});

test("points on top of each other are left out of the centripetal curve, which still names the points given", () => {
    const points = [p(10, 10), p(80, 40), p(80.2, 40), p(200, 30), p(260, 90)];
    const curve = CatmullRom.open(points, { centripetal: true, resolution: 20 });
    assert.ok(curve.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y)));
    // The point placed again is left out: no stretch starts at it, and the next starts at the point after
    assert.deepEqual([...new Set(curve.map((q) => q.span))], [0, 1, 3]);
    // A click on the last stretch inserts a point after the fourth point given
    const hit = SpatialMath.getClosestVectorSegment([{ points }], 230, 60, 20, true, true);
    assert.equal(hit.insertIndex, 4);
});

test("a click on a line is tested against the curve that is drawn", () => {
    for (const centripetal of [false, true]) {
        const points = LOOPING;
        const drawn = CatmullRom.open(points, { centripetal, resolution: 20 });
        for (const target of [p(150, 170), p(265, 128), p(400, 190)]) {
            const hit = SpatialMath.getClosestVectorSegment([{ points }], target.x, target.y, 40, true, centripetal);
            assert.ok(hit, `${centripetal}: a hit near ${JSON.stringify(target)}`);
            // The point hit lies on the drawn curve's polyline
            let nearest = Infinity;
            for (let i = 1; i < drawn.length; i++) {
                const [a, b] = [drawn[i - 1], drawn[i]];
                const length = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
                const t = length ? Math.max(0, Math.min(1, ((hit.projX - a.x) * (b.x - a.x) + (hit.projY - a.y) * (b.y - a.y)) / length)) : 0;
                nearest = Math.min(nearest, Math.hypot(hit.projX - (a.x + t * (b.x - a.x)), hit.projY - (a.y + t * (b.y - a.y))));
            }
            assert.ok(nearest < 1e-9, `${centripetal}: the hit is ${nearest} px off the drawn curve`);
        }
    }
});
