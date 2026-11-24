// Terrain and water: a height field that keeps the parent's slope and lie, with seeded detail, the
// sea or a lake where the parent's cell has one (Shore.js), and the river (or a brook) with its
// valley. The river enters and leaves the frame at the bearings the parent's cell gives; between
// them its course is generated. A river that ends in the sea or a lake runs towards it and stops
// at its mouth.
import { chaikin, compass, distanceTransform, exitPoint, lerp } from "../Geometry.js";
import { buildShore } from "./Shore.js";
import { LARGE_FRAME_M } from "./Roads.js";

/** Brook width (m) where the parent has no river through the cell. */
const BROOK_WIDTH_M = 4;
/** Besides its bends, a river swings across its valley by up to this share of its length in the
 * frame (not one running down to the sea, which keeps its course to the mouth). */
const RIVER_SWING = 0.06;
/** A brook's bends: wavelength and amplitude (m). */
const BROOK_MEANDER_M = 380;
const BROOK_MEANDER_AMP = 50;
/** River widths are kept within these bounds (m). */
const WIDTH_RANGE_M = [6, 170];
/** Steepest plane slope the frame keeps (rise over run). */
const MAX_GRADE = 0.04;

export function buildTerrain(T) {
    const { input, P, S, W, H, NX, NY, g, R, noise } = T;
    const rr = R("river");
    const shore = buildShore(T);
    T.shore = shore;
    // ------------------------------------------------ the river's course
    const river = input.river
        ? { width: Math.max(WIDTH_RANGE_M[0], Math.min(WIDTH_RANGE_M[1], input.river.widthM)), brook: false, from: input.river.from, to: input.river.to }
        : brookCourse(input, rr, shore?.mountain ? null : (shore?.main?.bearing ?? null));
    // A river that rises or ends in the cell still crosses the frame: the missing end is opposite
    // the given one, so the frame shows the reach of it nearest the town
    const towardsWater = shore?.main ? shore.main.bearing : null;
    const inBearing = river.from ?? (river.to + 180) % 360;
    const outBearing = river.to ?? towardsWater ?? (river.from + 180) % 360;
    const half = T.half;
    const enter = exitPoint([0, 0], compass(inBearing), half, -g);
    const leave = exitPoint([0, 0], compass(outBearing), half, -g);
    // It passes the frame's middle at a little distance on a seeded side, so the town stands on
    // one bank with room for its market
    const chord = [leave[0] - enter[0], leave[1] - enter[1]];
    const chordLength = Math.hypot(chord[0], chord[1]) || 1;
    const normal = [-chord[1] / chordLength, chord[0] / chordLength];
    const side = rr.chance(0.5) ? 1 : -1;
    // Under the ground a river keeps further from the chamber's middle, clear of its plaza
    const passGap = river.brook ? rr.range(140, 260) : river.width / 2 + (T.kind === "city" ? 70 : 55) + (input.cave ? input.cave.radiusM * 0.35 : 0);
    // When in and out are nearly the same side the chord is short: the course bends through the middle
    const bend = chordLength < S * 0.5 ? [0, 0] : null;
    const pass = bend ?? [normal[0] * side * passGap, normal[1] * side * passGap];
    const guide = chaikin([enter, lerp(enter, pass, 0.5), pass, lerp(pass, leave, 0.5), leave], 3);
    // Meanders: waves along the course, fading to nothing at the frame's edge so it keeps its bearings
    // A brook's bends grow with a great frame, or it crosses one nearly straight
    const grow = river.brook ? Math.max(1, Math.max(W, H) / LARGE_FRAME_M) : 1;
    const L1 = (river.brook ? BROOK_MEANDER_M * grow : Math.max(500, river.width * 11)) * rr.range(0.9, 1.3);
    const A1 = Math.max(river.brook ? BROOK_MEANDER_AMP * grow : 35, river.width * rr.range(0.8, 1.4));
    const ph1 = rr.range(0, 6.28);
    const A2 = A1 * 0.35;
    const L2 = L1 * rr.range(0.3, 0.45);
    const ph2 = rr.range(0, 6.28);
    const dense = [];
    let total = 0;
    for (let k = 0; k + 1 < guide.length; k++) total += Math.hypot(guide[k + 1][0] - guide[k][0], guide[k + 1][1] - guide[k][1]);
    let s = 0;
    for (let k = 0; k < guide.length; k++) {
        if (k) s += Math.hypot(guide[k][0] - guide[k - 1][0], guide[k][1] - guide[k - 1][1]);
        const a = guide[Math.max(0, k - 1)];
        const b = guide[Math.min(guide.length - 1, k + 1)];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const n = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
        const fade = Math.sin(Math.PI * Math.min(1, Math.max(0, s / total)));
        // Two waves and a wander, so the bends are not all alike
        const wander = A1 * 0.8 * (noise.fbm(s / (L1 * 0.8) + ph1, ph2 + 4.4, 3) - 0.5) * 2 + (shore ? 0 : total * RIVER_SWING) * (noise.fbm(s / (total / 2.5) + ph2, ph1 - 7.7, 2) - 0.5) * 2;
        const lateral = fade * (A1 * Math.sin((s / L1) * 6.283 + ph1) + A2 * Math.sin((s / L2) * 6.283 + ph2) + wander);
        dense.push([guide[k][0] + n[0] * lateral, guide[k][1] + n[1] * lateral]);
    }
    river.line = chaikin(dense, 2);
    // Through rock it runs in flooded tunnels, which the rock is told of
    if (input.river?.flooded && shore?.floodWith) shore.floodWith(river);
    river.inBearing = inBearing;
    river.outBearing = outBearing;
    // Where it reaches the sea or a lake it ends, a little way out so its mouth opens into the water
    river.mouth = null;
    if (shore?.mountain) {
        // Below a mountain a brook springs from its foot: its course begins where it leaves the rock
        let k = 0;
        while (k < river.line.length - 2 && shore.wetAt(river.line[k])) k++;
        river.line = river.line.slice(Math.max(0, k - 1));
        river.spring = river.line[Math.min(1, river.line.length - 1)];
    } else if (shore) {
        const wet = river.line.findIndex((p) => shore.wetAt(p));
        if (wet > 0) {
            river.line = river.line.slice(0, Math.min(river.line.length, wet + 2));
            river.mouth = river.line[wet];
        }
    }

    // ------------------------------------------------ distance to the river (exact transform)
    const cellX = (i) => -W / 2 + (i + 0.5) * g;
    const cellY = (j) => -H / 2 + (j + 0.5) * g;
    const seeds = new Uint8Array(NX * NY);
    for (let k = 0; k + 1 < river.line.length; k++) {
        const a = river.line[k];
        const b = river.line[k + 1];
        const steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (g * 0.4)) + 1;
        for (let t = 0; t <= steps; t++) {
            const p = lerp(a, b, t / steps);
            const i = Math.floor((p[0] + W / 2) / g);
            const j = Math.floor((p[1] + H / 2) / g);
            if (i >= 0 && j >= 0 && i < NX && j < NY) seeds[j * NX + i] = 1;
        }
    }
    const riverDist = distanceTransform(seeds, NX, NY);
    for (let k = 0; k < riverDist.length; k++) riverDist[k] *= g;
    // The sea or lake on the grid, and each cell's distance to it
    const sea = new Uint8Array(NX * NY);
    let seaDist = null;
    if (shore) {
        for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) sea[j * NX + i] = shore.wetAt([cellX(i), cellY(j)]) ? 1 : 0;
        seaDist = distanceTransform(sea, NX, NY);
        for (let k = 0; k < seaDist.length; k++) seaDist[k] *= g;
    }

    // ------------------------------------------------ height
    const { slopeMPerKm, downhill, lie } = input.relief;
    const grade = Math.min(MAX_GRADE, (slopeMPerKm ?? 0) / 1000);
    const down = compass(downhill ?? 180);
    const valleyDepth = river.brook ? 5 : 8 + river.width * 0.12;
    const valleyWidth = river.brook ? 90 : 160 + river.width * 1.5;
    const relief = P.relief;
    // The cell's lie: a hill town gets a rise under it; a valley town a broad trough along the slope
    const hill = lie === "hill" ? relief * 1.6 : 0;
    const trough = lie === "valley" ? relief * 1.2 : 0;
    const heightAt = (x, y, rd) => {
        const plane = -grade * (x * down[0] + y * down[1]);
        const detail = relief * (noise.fbm(x / 900 + 3.1, y / 900 - 7.7) - 0.5) * 2;
        const rise = hill * Math.exp(-((x * x + y * y) / (S * 0.22) ** 2));
        const across = -x * down[1] + y * down[0];
        const sink = trough * Math.exp(-((across / (S * 0.2)) ** 2));
        return plane + detail + rise - sink - valleyDepth * Math.exp(-((rd / valleyWidth) ** 2));
    };
    const height = new Float32Array(NX * NY);
    const water = new Uint8Array(NX * NY);
    for (let j = 0; j < NY; j++) {
        for (let i = 0; i < NX; i++) {
            const k = j * NX + i;
            // The land falls a little to the water's edge
            // (and rises to the foot of a mountain)
            const shoreDip = seaDist ? (shore.mountain ? -8 : 4) * Math.exp(-seaDist[k] / 150) : 0;
            height[k] = heightAt(cellX(i), cellY(j), riverDist[k]) - shoreDip;
            water[k] = riverDist[k] < river.width / 2 || sea[k] ? 1 : 0;
        }
    }
    T.river = river;
    T.terrain = { NX, NY, g, height, water, riverDist, sea, seaDist };
    T.cellOf = (p) => {
        const i = Math.floor((p[0] + W / 2) / g);
        const j = Math.floor((p[1] + H / 2) / g);
        return i < 0 || j < 0 || i >= NX || j >= NY ? -1 : j * NX + i;
    };
    T.hAt = (p) => {
        const k = T.cellOf(p);
        return k < 0 ? 0 : height[k];
    };
    // Distance to the river's centreline, interpolated between grid cells so banks are smooth
    T.rdAt = (p) => {
        const fx = (p[0] + W / 2) / g - 0.5;
        const fy = (p[1] + H / 2) / g - 0.5;
        const i = Math.floor(fx);
        const j = Math.floor(fy);
        if (i < 0 || j < 0 || i >= NX - 1 || j >= NY - 1) {
            const k = T.cellOf(p);
            return k < 0 ? 1e9 : riverDist[k];
        }
        const u = fx - i;
        const v = fy - j;
        const at = (a, b) => riverDist[(j + b) * NX + i + a];
        return at(0, 0) * (1 - u) * (1 - v) + at(1, 0) * u * (1 - v) + at(0, 1) * (1 - u) * v + at(1, 1) * u * v;
    };
    T.seaAt = (p) => (shore ? shore.wetAt(p) : false);
    // Distance from the shore alone (the sea or lake, not the river)
    T.sdAt = (p) => {
        if (!shore) return 1e9;
        if (shore.wetAt(p)) return -1;
        const k = T.cellOf(p);
        return k < 0 ? 1e9 : Math.max(0.5, seaDist[k] - g / 2);
    };
    // Distance from the nearest water's edge (river bank or shore), negative or nought in the water
    T.wdAt = (p) => {
        const fromRiver = T.rdAt(p) - river.width / 2;
        if (!shore) return fromRiver;
        if (shore.wetAt(p)) return -1;
        const k = T.cellOf(p);
        const fromSea = k < 0 ? 1e9 : Math.max(0.5, seaDist[k] - g / 2);
        return Math.min(fromRiver, fromSea);
    };
}

/** A brook where the parent has no river: it runs downhill across the frame, near the place (into the sea or lake where there is one). */
function brookCourse(input, rr, towardsWater) {
    const downhill = towardsWater ?? input.relief.downhill ?? rr.range(0, 360);
    const out = (downhill + rr.range(-30, 30) + 360) % 360;
    const from = (out + 180 + rr.range(-35, 35) + 360) % 360;
    return { width: BROOK_WIDTH_M, brook: true, from: Math.round(from), to: Math.round(out) };
}

