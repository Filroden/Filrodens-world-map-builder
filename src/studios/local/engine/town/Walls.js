// Walls, gates and the castle. The ring holds the people meant to live inside at the plan's
// density, stops at the river bank or the shore (a quay closes that side) and widens until the
// area is right.
// Towers stand at the corners and every TOWER_SPACING metres along the runs between; each gate is
// a gatehouse astride the road.
import { dist, lerp, pointInPolygon, polygonArea, segmentCross, segmentDistance, stageRandom } from "../Geometry.js";
import { RESERVED, STREET } from "./Occupancy.js";

/** Towers along a run of wall, metres apart (60 to 80 m, as medieval town walls had). */
const TOWER_SPACING = [60, 80];
/** Castles: a capital's citadel with a palace, a city's castle, a fortified town's (m). */
const CASTLE = {
    capital: { kind: "citadel", length: 230, breadth: 165, keep: 34, palace: [70, 26], towers: true },
    city: { kind: "castle", length: 120, breadth: 90, keep: 24, palace: null, towers: false },
    fortified: { kind: "castle", length: 78, breadth: 58, keep: 18, palace: null, towers: false },
};
/** A port of this many people walls its waterfront too, this far (m) back from the shore, with a
 * water gate every so often (m) down to the quays; a smaller port's wall stops at the shore. */
const SEA_WALL_PEOPLE = 20000;
const SEA_WALL_SETBACK = 42;
const WATER_GATE_SPACING = 260;
/** By the water the ring reaches this much further along the shore than its radius (and less inland). */
const SHORE_STRETCH = 0.2;
/** ... and its middle lies this share of its radius inland of the centre. */
const RING_INLAND = 0.45;
/** How near (m) a mountain's face a wall ends: at its foot. */
const ROCK_FOOT_M = 2;
/** How far (m) from the rock a ring's middle below a mountain stands. */
const ROCK_CLEAR_M = 30;
/** Walls by the water enclose this much more ground, for the quays and warehouses along it. */
const WATERFRONT_ALLOWANCE = 1.25;
/** Share of a walled town's people inside its walls; a city's, from a small city to a great one. */
const INSIDE_TOWN = 0.87;
const INSIDE_CITY = [0.6, 0.25];
const CITY_FROM = 8000;
const CITY_GREAT = 25000;
/** A city of this many people has a second, outer wall round this share of its people (at this
 * many to the hectare), standing at least OUTER_CLEAR metres from the old wall. */
export const OUTER_WALL_PEOPLE = 50000;
const OUTER_SHARE = 0.4;
const OUTER_DENSITY = 190;
const OUTER_CLEAR = 150;

export function ringAround(T, radius, corners, random, { seaWall = false } = {}) {
    const { river, noise } = T;
    // By the water the ring's middle lies inland of the town's centre (its market by the quays),
    // so the walled town reaches back from the waterfront as well as along it
    const u = T.shore?.main?.u;
    // Below a mountain it reaches the other way, back to the rock, which closes the ring
    // (but its middle stays on the land, short of the rock, however large the ring is asked to be)
    // (Ken, 2026-11-16: a town against a mountain walls a half-moon, its wall running from the rock
    // round to the rock, so the ring's middle stands near the foot of the face)
    const shift = T.shore?.mountain ? -Math.max(0, T.sdAt(T.centre) - ROCK_CLEAR_M) : radius * RING_INLAND;
    const C = u ? [T.centre[0] - u[0] * shift, T.centre[1] - u[1] * shift] : T.centre;
    const verts = [];
    const rotation = random.range(0, 6.28);
    for (let v = 0; v < corners; v++) {
        const a = rotation + (v / corners) * Math.PI * 2 + random.range(-0.12, 0.12);
        // By the water the ring is drawn out along the shore, as a port town spreads along its
        // waterfront rather than back from it
        const along = T.shore?.main ? Math.atan2(T.shore.main.v[1], T.shore.main.v[0]) : 0;
        const stretch = T.shore?.main ? 1 + SHORE_STRETCH * Math.cos(2 * (a - along)) : 1;
        let r = radius * stretch * (1 + 0.16 * (noise.value(v * 0.7, 3.3) - 0.5) * 2);
        let onBank = false;
        let seaSide = false;
        let onRock = false;
        const mountain = !!T.shore?.mountain;
        for (let s = 0; s <= r; s += mountain ? 2 : 4) {
            const p = [C[0] + Math.cos(a) * s, C[1] + Math.sin(a) * s];
            const fromRiver = T.rdAt(p) - river.width / 2;
            // A brook is walled across (a culvert takes it under), so only a river stops the ring
            const atRiver = !river.brook && fromRiver < 9;
            // A large port's wall stands back from the shore, with the quays and warehouses outside it
            // (a mountain's rock closes the ring at the face's foot)
            const atSea = !atRiver && T.sdAt(p) < (mountain ? ROCK_FOOT_M : seaWall ? SEA_WALL_SETBACK : 9);
            if (atRiver || atSea) {
                onRock = mountain && atSea;
                r = onRock ? s : Math.max(30, s - 2);
                // On a river's bank, or a smaller port's shore, a quay closes the ring; a large port's
                // waterfront is walled
                onBank = atRiver || !seaWall;
                seaSide = atSea && seaWall;
                break;
            }
        }
        verts.push({ p: [C[0] + Math.cos(a) * r, C[1] + Math.sin(a) * r], onBank, seaSide, onRock });
    }
    if (T.shore?.mountain && u) wallToRock(T, verts, u);
    return verts;
}

/**
 * Below a mountain a wall runs from the rock round to the rock: from each last tower on the land,
 * the wall goes the shortest way to the face (straight into the rock, along the face's normal), so
 * the town is walled as a half-moon with the most ground for the least wall (Ken, 2026-11-16).
 */
function wallToRock(T, verts, u) {
    const n = verts.length;
    const footFrom = (p) => {
        for (let s = 0; s < 400; s += 2) {
            const q = [p[0] + u[0] * s, p[1] + u[1] * s];
            if (T.sdAt(q) < ROCK_FOOT_M) return q;
        }
        return null;
    };
    const moved = new Set();
    for (let k = 0; k < n; k++) {
        const v = verts[k];
        if (v.onRock) continue;
        for (const j of [(k + 1) % n, (k - 1 + n) % n]) {
            const w = verts[j];
            if (!w.onRock || moved.has(j)) continue;
            const foot = footFrom(v.p);
            if (foot) w.p = foot;
            moved.add(j);
        }
    }
}

/**
 * The share of a walled place's people living inside its walls. A walled town keeps most of its
 * people inside; a city outgrows its walls, so most of a city's people live in the suburbs beyond
 * them (from INSIDE_CITY[0] of a city of CITY_FROM people to INSIDE_CITY[1] from CITY_GREAT on,
 * by the logarithm of its size).
 */
export function insideShare(kind, population) {
    if (kind !== "city") return INSIDE_TOWN;
    const u = Math.max(0, Math.min(1, Math.log(population / CITY_FROM) / Math.log(CITY_GREAT / CITY_FROM)));
    return INSIDE_CITY[0] + (INSIDE_CITY[1] - INSIDE_CITY[0]) * u;
}

/** A ring of wall holding `area` m², widened over a few passes until it does. */
export function ringOfArea(T, area, corners, stage, options) {
    const radius = Math.sqrt(area / Math.PI);
    let verts = null;
    let tryRadius = radius;
    for (let pass = 0; pass < 4; pass++) {
        verts = ringAround(T, tryRadius, corners, stageRandom(T.input.seed, stage), options);
        const got = polygonArea(verts.map((v) => v.p));
        if (got > area * 0.92) break;
        tryRadius *= Math.sqrt(area / got);
    }
    return { verts, polygon: verts.map((v) => v.p), radius };
}

/** Two gates closer than this (m) are one. */
const GATE_MERGE_M = 24;

/** Gates wherever the approach roads cross a ring (a road that winds out and in again has one at
 * each crossing, so no road runs through a wall). */
export function gatesOf(roads, polygon) {
    const gates = [];
    // Not on a road from a point within the frame (a hold's great gate, where the mountain is the wall)
    for (const road of roads.filter((r) => !r.to)) {
        for (let k = 0; k + 1 < road.points.length; k++) {
            const a = road.points[k];
            const b = road.points[k + 1];
            // Every crossing of the ring, even a segment that clips a corner out and in again
            for (let e = 0; e < polygon.length; e++) {
                const x = segmentCross(a, b, polygon[e], polygon[(e + 1) % polygon.length]);
                if (!x) continue;
                const p = x.p;
                // The same road crossing again close by, or two roads meeting at the wall, share one gate
                if (gates.some((g) => dist(g.p, p) < (g.road === road ? GATE_MERGE_M : 18))) continue;
                const dir = Math.atan2(b[1] - a[1], b[0] - a[0]);
                gates.push({ p, dir, road, house: rect(p, dir, 16, 22) });
            }
        }
    }
    return gates;
}

/** Towers at every corner off the bank, and along each run at TOWER_SPACING, clear of the gates. */
export function towersOf(verts, gates, random) {
    const towers = [];
    for (let k = 0; k < verts.length; k++) {
        const a = verts[k];
        const b = verts[(k + 1) % verts.length];
        if (a.onBank && b.onBank) continue;
        if (!a.onBank) towers.push(a.p);
        const length = dist(a.p, b.p);
        const spacing = random.range(TOWER_SPACING[0], TOWER_SPACING[1]);
        const count = Math.floor(length / spacing);
        for (let t = 1; t <= count; t++) {
            const p = lerp(a.p, b.p, t / (count + 1));
            if (gates.some((gate) => dist(gate.p, p) < 25)) continue;
            towers.push(p);
        }
    }
    return towers;
}

export function buildWalls(T) {
    const { input, P, kind, centre: C, roads } = T;
    T.wall = null;
    T.outerWall = null;
    T.castle = null;
    if (!input.walled) return;
    const share = insideShare(kind, input.population);
    const inside = share * input.population;
    const seaWall = !!T.shore && input.population >= SEA_WALL_PEOPLE;
    // By the water the walls take in the waterfront too (quays and warehouses, not houses)
    const allowance = T.shore ? WATERFRONT_ALLOWANCE : 1;
    const area = (inside / (P.density ?? 170)) * 10000 * allowance;
    const wall = { ...ringOfArea(T, area, kind === "city" ? 17 : 12, "walls", { seaWall }), seaWall, share };
    const verts = wall.verts;
    wall.gates = gatesOf(roads, wall.polygon);
    // Water gates through a sea wall, down to the quays: along each run of wall facing the water,
    // one every WATER_GATE_SPACING metres (at least one on any run of length)
    if (seaWall) {
        const n = verts.length;
        const start = verts.findIndex((v, k) => v.seaSide && !verts[(k - 1 + n) % n].seaSide);
        const runs = [];
        if (start >= 0) {
            let run = [];
            for (let step = 0; step <= n; step++) {
                const v = verts[(start + step) % n];
                if (v.seaSide) run.push(v.p);
                else if (run.length) {
                    runs.push(run);
                    run = [];
                }
            }
            if (run.length) runs.push(run);
        }
        for (const run of runs) {
            const length = run.reduce((a, p, k) => a + (k ? dist(p, run[k - 1]) : 0), 0);
            if (length < 120) continue;
            const count = Math.max(1, Math.floor(length / WATER_GATE_SPACING));
            for (let g = 1; g <= count; g++) {
                // The point that far along the run, and the run's direction there
                let left = (length * g) / (count + 1);
                let k = 1;
                while (k < run.length - 1 && left > dist(run[k - 1], run[k])) left -= dist(run[k - 1], run[k++]);
                const a = run[k - 1];
                const b = run[k];
                const p = lerp(a, b, Math.min(1, left / (dist(a, b) || 1)));
                if (wall.gates.some((gate) => dist(gate.p, p) < 80)) continue;
                const along = Math.atan2(b[1] - a[1], b[0] - a[0]);
                let dir = along + Math.PI / 2;
                if (Math.cos(dir) * (p[0] - C[0]) + Math.sin(dir) * (p[1] - C[1]) < 0) dir += Math.PI;
                wall.gates.push({ p, dir, road: null, water: true, house: rect(p, dir, 12, 16) });
            }
        }
    }
    // The castle on the highest ground at the wall, away from the gates: a capital's citadel with
    // its palace, a city's castle, a fortified town's smaller one
    const fort = input.capital ? CASTLE.capital : kind === "city" ? CASTLE.city : input.fortified ? CASTLE.fortified : null;
    if (fort) {
        // The highest corner whose castle stands clear of the river and brook (Ken, 2026-11-15)
        const siteOf = (v) => {
            const pull = fort.length / Math.max(fort.length, dist(v.p, C)) * 0.5;
            const centre = lerp(v.p, C, Math.min(0.35, Math.max(0.08, pull)));
            const angle = Math.atan2(C[1] - centre[1], C[0] - centre[0]);
            return { centre, angle, polygon: rect(centre, angle, fort.length, fort.breadth) };
        };
        const order = verts.filter((v) => !v.onBank && !wall.gates.some((gate) => dist(gate.p, v.p) < fort.length * 0.6 + 60)).map((v) => ({ v, h: T.hAt(v.p) })).sort((a, b) => b.h - a.h);
        const best = order.find(({ v }) => dryOver(T, siteOf(v).polygon, 3)) ?? order[0];
        if (best) {
            const { centre, angle, polygon } = siteOf(best.v);
            // The keep stands at the castle's outer end, the palace (a capital's) across its ward
            const keepAt = lerp(centre, best.v.p, 0.25);
            const palaceAt = [centre[0] + Math.cos(angle) * fort.length * 0.2, centre[1] + Math.sin(angle) * fort.length * 0.2];
            T.castle = {
                centre,
                polygon,
                angle,
                kind: fort.kind,
                keep: rect(keepAt, angle, fort.keep, fort.keep),
                palace: fort.palace ? rect(palaceAt, angle + Math.PI / 2, fort.palace[0], fort.palace[1]) : null,
                towers: fort.towers ? polygon.flatMap((p, k) => [p, lerp(p, polygon[(k + 1) % 4], 0.5)]) : polygon,
            };
        }
    }
    wall.towers = towersOf(verts, wall.gates, stageRandom(input.seed, "towers"));
    T.wall = wall;
    // A great city that outgrew its first walls built a second ring round the nearer suburbs; many
    // of its people still live beyond it
    if (input.population >= OUTER_WALL_PEOPLE) {
        const between = input.population * OUTER_SHARE;
        const outerArea = area + (between / OUTER_DENSITY) * 10000;
        const outer = ringOfArea(T, outerArea, 26, "outer-walls", { seaWall: false });
        // It stands well clear of the old wall everywhere
        const Cr = outer.verts.reduce((a, v) => [a[0] + v.p[0] / outer.verts.length, a[1] + v.p[1] / outer.verts.length], [0, 0]);
        for (const v of outer.verts) {
            const tooNear = (p) => pointInPolygon(p, wall.polygon) || wall.polygon.some((q, k) => segmentDistance(p, q, wall.polygon[(k + 1) % wall.polygon.length]) < OUTER_CLEAR);
            for (let push = 0; push < 60 && tooNear(v.p); push++) {
                const d = dist(v.p, Cr) || 1;
                v.p = [Cr[0] + ((v.p[0] - Cr[0]) * (d + 20)) / d, Cr[1] + ((v.p[1] - Cr[1]) * (d + 20)) / d];
            }
        }
        outer.polygon = outer.verts.map((v) => v.p);
        outer.gates = gatesOf(roads, outer.polygon);
        outer.towers = towersOf(outer.verts, outer.gates, stageRandom(input.seed, "outer-towers"));
        T.outerWall = outer;
    }
}

/**
 * Inside the walls the roads run more directly from each gate to the market than the terrain
 * search draws them: a street laid out between two fixed points, with a slight bend, wherever
 * that keeps clear of the river.
 */
export function straightenGateStreets(T) {
    const { wall, centre: C } = T;
    if (!wall) return;
    const rs = stageRandom(T.input.seed, "gate-streets");
    for (const gate of wall.gates) {
        const road = gate.road;
        if (!road) continue;
        const at = road.points.findIndex((p) => pointInPolygon(p, wall.polygon));
        if (at < 0) continue;
        const from = gate.p;
        const length = dist(from, C);
        const n = [-(C[1] - from[1]) / length, (C[0] - from[0]) / length];
        // A gentle bow and a lesser kink or two, so no two main streets run alike
        const bow = rs.range(-0.08, 0.08) * length;
        const kink = rs.range(-0.035, 0.035) * length;
        const phase = rs.range(0, Math.PI);
        const street = [];
        const steps = Math.max(4, Math.ceil(length / 15));
        for (let t = 0; t <= steps; t++) {
            const u = t / steps;
            const p = lerp(from, C, u);
            const off = bow * Math.sin(Math.PI * u) + kink * Math.sin(3 * Math.PI * u + phase) * Math.sin(Math.PI * u);
            street.push([p[0] + n[0] * off, p[1] + n[1] * off]);
        }
        if (street.some((p) => T.wdAt(p) < road.width)) continue;
        road.points = [...road.points.slice(0, at), ...street];
    }
}

/**
 * True where no part of a polygon lies within `margin` metres of a river, brook or the sea: its
 * whole area is sampled, not just its corners, as a brook may run between them (Ken, 2026-11-15:
 * no focal point over a river).
 */
export function dryOver(T, poly, margin = 4, step = 3) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of poly) {
        x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]);
    }
    for (const p of poly) if (T.wdAt(p) <= margin) return false;
    for (let y = y0 + step / 2; y < y1; y += step) for (let x = x0 + step / 2; x < x1; x += step) if (pointInPolygon([x, y], poly) && T.wdAt([x, y]) <= margin) return false;
    return true;
}

/** Stamps the roads, then the walls, gatehouses and castle over them, then opens the gates. */
export function stampRoadsAndWalls(T) {
    const { roads, wall, castle, occupancy } = T;
    for (const road of roads) occupancy.stampPolyline(road.points, road.width / 2, STREET);
    if (!wall) return;
    if (castle) occupancy.stampPolygon(castle.polygon, RESERVED);
    for (const ring of [wall, T.outerWall].filter(Boolean)) {
        const { verts } = ring;
        for (let k = 0; k < verts.length; k++) {
            const a = verts[k];
            const b = verts[(k + 1) % verts.length];
            if (a.onBank && b.onBank) continue;
            occupancy.stampPolyline([a.p, b.p], 5, RESERVED);
        }
        for (const gate of ring.gates) occupancy.stampPolygon(gate.house, RESERVED);
    }
    // The roads open the wall again at the gates (but not through the castle)
    for (const road of roads) occupancy.clearPolyline(road.points, road.width / 2, RESERVED, STREET, (p) => castle && pointInPolygon(p, castle.polygon));
}

export function rect(c, angle, w, h) {
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => [c[0] + x * ca - y * sa, c[1] + x * sa + y * ca]);
}
