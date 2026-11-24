// The sea or a lake in the frame, from the parent's reading of the settlement's cell: each
// stretch of the cell's border that is water becomes a shore across the frame on that side, so a
// coastal town has one, a town on a headland or peninsula two or more (the land between them),
// and an island town a shore all round. The town stands on the waterfront of the widest stretch.
//
// Each shore is a line across the frame at a set distance from its middle, perpendicular to the
// stretch's middle bearing, moved in and out along its length by noise: gently by the town, so
// its quays run straight, and more freely away from it. Water is the far side of any shore (the
// union of the stretches' waters), so whether a point is wet is exact, not read off a grid.
import { compass, dist } from "../Geometry.js";
import { buildCaveShore } from "./Cave.js";

/** The widest stretch's shore lies this far (m) from the frame's middle; the others further. */
const MAIN_SHORE_M = 170;
const OTHER_SHORE_M = 340;
/** The shore's wander (m): broad bays and headlands, and the small detail of the waterline. */
const BROAD_WANDER = 130;
const FINE_WANDER = 18;
/** By the town the broad wander fades to nothing over this distance (m) along the shore. */
const STRAIGHT_REACH = 650;
/** A lake read with no border stretches: its shore faces the lake's side across this share of the border. */
const LAKE_SHARE = 0.3;
/** An island's radius as a share of the frame's short side. */
const ISLAND_SHARE = 0.42;
/** Points along each shore (m apart). */
const SHORE_STEP = 10;

/**
 * @param {object} T - The town under construction (input, W, H, noise).
 * @returns {object|null} The shore: body (sea or lake), lines (one per stretch: unit `u` towards
 *     the water, `v` along the shore, distance at `t`), an island's outline, and `wetAt(p)`.
 */
export function buildShore(T) {
    const { input, W, H, noise } = T;
    if (input.cave) return buildCaveShore(T);
    const shore = input.shore;
    if (!shore) return null;
    const reach = Math.hypot(W, H) / 2 + 60;
    if (shore.face) return mountainShore(shore.face, reach);
    if (shore.walls) return cavernWalls(shore.walls, noise, shore.water ?? null);
    if (shore.island) {
        const R = ISLAND_SHARE * Math.min(W, H);
        const radiusAt = (angle) => R + BROAD_WANDER * 1.6 * (noise.fbm(Math.cos(angle) * 1.3 + 7, Math.sin(angle) * 1.3 - 3, 3) - 0.5) * 2 + FINE_WANDER * (noise.value(angle * 14, 5.5) - 0.5) * 2;
        const outline = [];
        const steps = Math.ceil((2 * Math.PI * R) / SHORE_STEP);
        for (let s = 0; s < steps; s++) {
            const a = (s / steps) * 2 * Math.PI;
            const r = radiusAt(a);
            outline.push([Math.cos(a) * r, Math.sin(a) * r]);
        }
        return {
            body: shore.body,
            lines: [],
            island: { outline, radiusAt },
            wetAt: (p) => Math.hypot(p[0], p[1]) > radiusAt(Math.atan2(p[1], p[0])),
            main: null,
        };
    }
    let stretches = shore.stretches?.length ? shore.stretches : null;
    if (!stretches) {
        const half = (LAKE_SHARE * 360) / 2;
        stretches = [{ from: (shore.side - half + 360) % 360, to: (shore.side + half) % 360, share: LAKE_SHARE }];
    }
    const widest = stretches.reduce((a, b) => (b.share > a.share ? b : a));
    const lines = stretches.map((stretch, index) => {
        const span = (stretch.to - stretch.from + 360) % 360 || 360;
        const bearing = (stretch.from + span / 2) % 360;
        const u = compass(bearing);
        const v = [-u[1], u[0]];
        const base = stretch === widest ? MAIN_SHORE_M : OTHER_SHORE_M;
        const at = (t) => {
            const fade = Math.min(1, (Math.abs(t) / STRAIGHT_REACH) ** 2);
            return base + fade * BROAD_WANDER * (noise.fbm(t / 700 + index * 13.7, 4.2 + index, 3) - 0.5) * 2 + FINE_WANDER * (noise.value(t / 90 + index * 5.1, 9.9) - 0.5) * 2;
        };
        const points = [];
        for (let t = -reach; t <= reach; t += SHORE_STEP) {
            const d = at(t);
            points.push([u[0] * d + v[0] * t, u[1] * d + v[1] * t]);
        }
        return { bearing, u, v, at, points, main: stretch === widest, share: stretch.share };
    });
    const beyond = (line, p) => p[0] * line.u[0] + p[1] * line.u[1] > line.at(p[0] * line.v[0] + p[1] * line.v[1]);
    const wetAt = (p) => lines.some((line) => beyond(line, p));
    // The real coast: each shore's runs that are not out in another stretch's water
    for (const line of lines) {
        line.coast = [];
        let run = [];
        for (const p of line.points) {
            if (lines.some((other) => other !== line && beyond(other, p))) {
                if (run.length > 1) line.coast.push(run);
                run = [];
            } else run.push(p);
        }
        if (run.length > 1) line.coast.push(run);
    }
    return { body: shore.body, lines, island: null, wetAt, main: lines.find((line) => line.main) };
}

/**
 * The foot of a mountain as a shore: the land before a hold's great gate, its rock the "water". The
 * face is the hold's own (Cave.js), in the same frame, so the town outside meets the mountain
 * exactly where the hold's gate opens: `face.contains(p)` is the open land, `face.at(t)` how far
 * the foot lies along its bearing at `t` across it.
 */
function mountainShore(face, reach) {
    // Towards the rock, and across it the other way, so a point's place along the line is -t
    const u = [-face.u[0], -face.u[1]];
    const v = [-face.v[0], -face.v[1]];
    const at = (t) => -face.at(-t);
    const points = [];
    for (let t = -reach; t <= reach; t += SHORE_STEP) {
        const d = at(t);
        points.push([u[0] * d + v[0] * t, u[1] * d + v[1] * t]);
    }
    const line = { bearing: (face.bearing + 180) % 360, u, v, at, points, main: true, share: 1, coast: [points] };
    return { body: "mountain", mountain: true, lines: [line], island: null, wetAt: (p) => !face.contains(p), main: line };
}

/**
 * A cavern's walls round a place on its open floor, as an island's shore is drawn but inside out:
 * the floor is the "island", the rock beyond the walls its "water". The layer gives the distance
 * from the place to the wall every few degrees (up to its reach, beyond which the wall is out of
 * sight); between them the wall is joined smoothly, and wanders a little in and out as rock does.
 */
const WALL = Object.freeze({ WANDER: 0.08, FINE: 14, STEP_DEG: 0.5, BEYOND: 4 });
/** A vector's bearing (degrees clockwise from north), unrounded, so the wall runs smoothly. */
const exactBearing = (v) => (((Math.atan2(v[0], -v[1]) * 180) / Math.PI) % 360 + 360) % 360;

/** A ring round the place from the layer's readings (a distance every few degrees, capped at its
 * reach, beyond which it lies off the map), joined smoothly and wandering a little. */
function ringFrom(readings, noise, wander, fine, salt) {
    const n = readings.distancesM.length;
    const step = 360 / n;
    const at = (k) => {
        const d = readings.distancesM[((k % n) + n) % n];
        // At the layer's reach it is further than it could see: well beyond the map
        return d >= readings.reachM ? readings.reachM * WALL.BEYOND : d;
    };
    return (bearing) => {
        const f = (((bearing % 360) + 360) % 360) / step;
        const k = Math.floor(f);
        const t = f - k;
        // Smoothly between the layer's readings (a cosine ease, so the ring has no corners at them)
        const e = (1 - Math.cos(Math.PI * t)) / 2;
        const d = at(k) * (1 - e) + at(k + 1) * e;
        const b = (bearing * Math.PI) / 180;
        return d * (1 + wander * (noise.fbm(Math.cos(b) * 2.1 + 41 + salt, Math.sin(b) * 2.1 - 17, 3) - 0.5) * 2) + fine * (noise.value(bearing / 3 + 5.5 + salt, 12.1) - 0.5) * 2;
    };
}

/** A lake's or dark sea's shore wanders less than rock does. */
const WATER = Object.freeze({ WANDER: 0.05, FINE: 8 });

function cavernWalls(walls, noise, water) {
    const wallAt = ringFrom(walls, noise, WALL.WANDER, WALL.FINE, 0);
    // A lake or dark sea: water from its shore out to the walls (the layer gives the distance to it)
    const waterAt = water ? ringFrom(water, noise, WATER.WANDER, WATER.FINE, 7.3) : () => Infinity;
    // The first edge on a bearing: the water's shore, or the wall. The town's land ends there, so
    // the engine treats that edge as an island's shore; the wall beyond is drawn as rock.
    const edgeAt = (bearing) => Math.min(waterAt(bearing), wallAt(bearing));
    const radiusAt = (angle) => edgeAt(exactBearing([Math.cos(angle), Math.sin(angle)]));
    const ring = (at) => {
        const points = [];
        for (let b = 0; b < 360; b += WALL.STEP_DEG) {
            const v = compass(b);
            const r = at(b);
            points.push([v[0] * r, v[1] * r]);
        }
        return points;
    };
    return {
        body: "rock",
        rock: true,
        lines: [],
        island: { outline: ring(edgeAt), radiusAt },
        wallOutline: ring(wallAt),
        wallAt,
        waterAt,
        edgeAt,
        water: water ? { kind: water.kind, outline: ring((b) => Math.min(waterAt(b), wallAt(b) + 50)) } : null,
        rockAt: (p) => Math.hypot(p[0], p[1]) > wallAt(exactBearing(p)),
        waterOnly: (p) => {
            const r = Math.hypot(p[0], p[1]);
            const b = exactBearing(p);
            return r > waterAt(b) && r <= wallAt(b);
        },
        wetAt: (p) => Math.hypot(p[0], p[1]) > edgeAt(exactBearing(p)),
        main: null,
    };
}

/** The point on a shore line `inset` metres inland at position `t` along it. */
export function shorePoint(line, t, inset = 0) {
    const d = line.at(t) - inset;
    return [line.u[0] * d + line.v[0] * t, line.u[1] * d + line.v[1] * t];
}

/** Where along a shore line a point lies. */
export function alongShore(line, p) {
    return p[0] * line.v[0] + p[1] * line.v[1];
}

/** The nearest distance from a point to any shore's waterline (the island's outline included). */
export function shoreDistance(shore, p) {
    let best = Infinity;
    const lines = shore.island ? [{ points: shore.island.outline }] : shore.lines;
    for (const line of lines) for (const q of line.points) best = Math.min(best, dist(p, q));
    return best;
}
