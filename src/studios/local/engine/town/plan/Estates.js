// Estates (Ken, 2026-11-15): focal points of their own, each a great house in its grounds taking
// almost a block, counted apart from the other focal points. Fewer inside the inner wall than
// between a great city's rings, and a few beyond the walls, larger, as worked estates (a manor
// house with its farm buildings round a yard, a walled garden and an orchard).
import { centroid, dist, lerp, pointInPolygon, polygonArea, segmentDistance } from "../../Geometry.js";
import { dryOver, rect } from "../Walls.js";
import { CELL, axes } from "./Raster.js";
import { BUILDING, RESERVED, STREET } from "../Occupancy.js";

export const ESTATES = Object.freeze({
    /** One estate for so many people: inside the inner (or only) wall, between a great city's
     * rings (of the people the ring is meant for), and beyond the walls; at most so many. */
    PEOPLE: Object.freeze({ inner: 5000, ring: 2500, worked: 12000 }),
    MAX: Object.freeze({ inner: 4, ring: 12, worked: 6 }),
    /** Grounds (m²): the smallest and largest; and how far apart two estates stand (m). */
    GROUNDS: Object.freeze({ inner: [2200, 7000], ring: [3500, 10000], worked: [15000, 30000] }),
    APART_M: Object.freeze({ inner: 120, ring: 160, worked: 450 }),
    /** A worked estate lies this far (m) beyond the last houses, its drive to the road this long. */
    WORKED_BEYOND_M: [120, 900],
    WORKED_DRIVE_M: [30, 90],
});

/** How many estates a place has in each ring. */
export function estateCounts(T, insidePeople) {
    const { input, kind } = T;
    if (kind !== "city") return { inner: 0, ring: 0, worked: 0 };
    const P = ESTATES.PEOPLE, M = ESTATES.MAX;
    return {
        inner: T.wall ? Math.min(M.inner, Math.floor(insidePeople / P.inner)) : 0,
        ring: Math.min(M.ring, Math.round((input.population * 0.4) / P.ring)),
        worked: Math.min(M.worked, Math.max(1, Math.round(input.population / P.worked))),
    };
}

/**
 * Picks blocks for estates on a plan raster: the candidates in the order given, each with grounds
 * the largest rectangle on the block's axes that fits inside it (down to half its extent), at
 * least the smallest grounds, away from the estates already chosen. Returns {block, ground} for each.
 */
/** Grounds keep this far (m) inside their block, so no street's width runs over their wall. */
const GROUND_CLEAR_M = 2.5;

export function pickEstateBlocks(R, labels, candidates, count, where, chosen = [], worship = null, dry = null) {
    const [minA, maxA] = ESTATES.GROUNDS[where];
    const out = [];
    for (const b of candidates) {
        if (out.length >= count) break;
        if (b.area < minA * 1.15) continue;
        const ax = b.ax ?? axes(R, b.cells);
        if ([...chosen, ...out].some((e) => dist(e.ground.c, ax.c) < ESTATES.APART_M[where])) continue;
        if (worship?.some((w) => dist(centroid(w.yard), ax.c) < 80)) continue;
        const angle = Math.atan2(ax.u[1], ax.u[0]);
        // The block's middle may not be its fullest part: a few places along each axis are tried
        const middle = [(ax.uMin + ax.uMax) / 2, 0];
        const shifts = [[0, 0], [0.15, 0], [-0.15, 0], [0, 0.12], [0, -0.12], [0.28, 0], [-0.28, 0]];
        let found = null;
        for (let s = 0.9; s >= 0.4 && !found; s -= 0.05) {
            let L = ax.long * s, S = ax.short * s;
            if (L * S < minA) break;
            if (L * S > maxA) {
                const f = Math.sqrt(maxA / (L * S));
                L *= f;
                S *= f;
            }
            for (const [fu, fv] of shifts) {
                const c = [ax.c[0] + ax.u[0] * (middle[0] + fu * ax.long) + ax.v[0] * fv * ax.short, ax.c[1] + ax.u[1] * (middle[0] + fu * ax.long) + ax.v[1] * fv * ax.short];
                if (fits(R, labels, b.label, c, ax.u, ax.v, L + 2 * GROUND_CLEAR_M, S + 2 * GROUND_CLEAR_M) && (!dry || dry(rect(c, angle, L, S)))) {
                    found = { c, angle, long: L, short: S, poly: rect(c, angle, L, S) };
                    break;
                }
            }
        }
        if (found) out.push({ block: b, ground: found });
    }
    return out;
}

function fits(R, labels, label, c, u, v, L, S) {
    for (let a = -L / 2; a <= L / 2; a += R.step) {
        for (let b = -S / 2; b <= S / 2; b += R.step) {
            const k = R.at([c[0] + u[0] * a + v[0] * b, c[1] + u[1] * a + v[1] * b]);
            if (k < 0 || labels[k] !== label) return false;
        }
    }
    return true;
}

/** The side of the grounds nearest a street on the raster: the outward unit normal and its edge's middle. */
function frontOf(R, ground) {
    const { c, angle, long, short } = ground;
    const u = [Math.cos(angle), Math.sin(angle)];
    const v = [-u[1], u[0]];
    let best = null;
    for (const [d, half] of [[u, long / 2], [[-u[0], -u[1]], long / 2], [v, short / 2], [[-v[0], -v[1]], short / 2]]) {
        let reach = Infinity;
        for (let s = half; s < half + 60; s += R.step) {
            const k = R.at([c[0] + d[0] * s, c[1] + d[1] * s]);
            if (k >= 0 && R.cell[k] === CELL.STREET) {
                reach = s - half;
                break;
            }
        }
        // A long side facing the street is preferred a little
        const score = reach + (half === long / 2 ? 6 : 0);
        if (!best || score < best.score) best = { d, half, score, reach };
    }
    return best;
}

/**
 * Lays out an estate in its grounds: the great house along the front, set back behind a forecourt,
 * with wings; a drive from the gate; a formal garden behind with paths; trees round the edge. A
 * worked estate has its farm buildings round a yard to one side and an orchard. Returns
 * {estate, buildings}; the buildings' kinds are those the rest of the engine knows.
 */
export function layOutEstate(T, ground, where, random, R = null, frontHint = null) {
    const { c, angle, long, short } = ground;
    const u = [Math.cos(angle), Math.sin(angle)];
    const v = [-u[1], u[0]];
    const front = frontHint ?? (R ? frontOf(R, ground) : { d: v, half: short / 2 });
    const n = front.d;
    // Along the front
    const t = [-n[1], n[0]];
    const across = front.half === long / 2 ? short : long;
    const deep = front.half * 2;
    const at = (a, b) => [c[0] + t[0] * a + n[0] * (front.half - b), c[1] + t[1] * a + n[1] * (front.half - b)];
    const worked = where === "worked";
    const houseW = Math.min(across * 0.5, worked ? random.range(18, 24) : random.range(20, 30));
    const houseD = worked ? random.range(9, 11) : random.range(11, 14);
    const setback = Math.min(deep * 0.25, worked ? random.range(14, 22) : random.range(9, 16));
    const offset = worked ? -across * 0.18 : random.range(-0.06, 0.06) * across;
    const facing = Math.atan2(t[1], t[0]);
    const houseC = at(offset, setback + houseD / 2);
    const buildings = [];
    const house = rect(houseC, facing, houseW, houseD);
    buildings.push({ poly: house, kind: worked ? "farmhouse" : "house", tier: "upper", rank: 2, estate: true, plotDepth: deep });
    // Wings back from each end of the house (an estate's), or one (a worked estate's)
    const wings = worked ? [1] : random.chance(0.7) ? [-1, 1] : [random.chance(0.5) ? -1 : 1];
    const wingL = Math.min(deep * 0.3, random.range(10, 16));
    for (const side of wings) {
        const wc = at(offset + side * (houseW / 2 - 3.5), setback + houseD + wingL / 2 + 0.4);
        buildings.push({ poly: rect(wc, facing, 7, wingL), kind: "range", house: 0, estate: true });
    }
    const paths = [];
    const gate = at(offset, 0);
    paths.push([gate, at(offset, setback)]);
    const trees = [];
    // Behind the house: a formal garden (an estate's) or the yard and orchard (a worked estate's)
    const rear0 = setback + houseD + (worked ? 4 : wingL + 4);
    const rear1 = deep - 6;
    let garden = null;
    if (rear1 - rear0 > 14) {
        if (!worked) {
            const gw = Math.min(across - 14, houseW * 1.6);
            garden = [at(offset - gw / 2, rear0), at(offset + gw / 2, rear0), at(offset + gw / 2, rear1), at(offset - gw / 2, rear1)];
            const gm = (rear0 + rear1) / 2;
            paths.push([at(offset, rear0), at(offset, rear1)], [at(offset - gw / 2, gm), at(offset + gw / 2, gm)]);
            for (const a of [-gw / 4, gw / 4]) for (const b of [(rear0 + gm) / 2, (gm + rear1) / 2]) trees.push([...at(offset + a, b), random.range(1.6, 2.2)]);
        } else {
            // Farm buildings round a yard beside the house
            const yx = across * 0.22;
            const yw = Math.min(across * 0.42, 48);
            const yd = Math.min(deep * 0.45, 44);
            const y0 = setback - 2;
            const barnW = random.range(8, 10);
            // Two ranges down the sides of the yard and one across its back, clear of each other
            const sideL = yd - barnW - 1;
            buildings.push({ poly: rect(at(yx, y0 + sideL / 2), facing, barnW, sideL), kind: "barn", estate: true });
            buildings.push({ poly: rect(at(yx + yw - barnW, y0 + (sideL * 0.8) / 2), facing, barnW, sideL * 0.8), kind: "barn", estate: true });
            buildings.push({ poly: rect(at(yx + yw / 2 - barnW / 2, y0 + yd - barnW / 2), facing, yw + barnW, barnW), kind: "barn", estate: true });
            garden = [at(yx + barnW / 2, y0), at(yx + yw - barnW / 2, y0), at(yx + yw - barnW / 2, y0 + yd - barnW), at(yx + barnW / 2, y0 + yd - barnW)];
            // An orchard behind the house, in rows
            for (let a = -across / 2 + 8; a < yx - 6; a += 9) for (let b = rear0 + 6; b < rear1; b += 9) trees.push([...at(a + random.range(-1, 1), b + random.range(-1, 1)), random.range(2, 2.8)]);
        }
    }
    // Trees round the edge of the grounds, more thickly at the back
    for (let a = -across / 2 + 4; a <= across / 2 - 4; a += random.range(7, 11)) {
        trees.push([...at(a, deep - 3), random.range(2.4, 3.4)]);
        if (random.chance(0.3)) trees.push([...at(a, 3), random.range(2, 2.8)]);
    }
    for (let b = setback; b <= deep - 4; b += random.range(8, 12)) for (const a of [-across / 2 + 3, across / 2 - 3]) if (!worked || a < 0) trees.push([...at(a, b), random.range(2.2, 3.2)]);
    // No tree over a building
    const clear = trees.filter(([x, y, r]) => !buildings.some((bl) => pointInPolygon([x, y], bl.poly) || bl.poly.some((q, k) => segmentDistance([x, y], q, bl.poly[(k + 1) % bl.poly.length]) < r)));
    return {
        estate: { poly: ground.poly, where, worked, centre: c, house: centroid(house), gate, paths, trees: clear, garden, areaHa: +(polygonArea(ground.poly) / 10000).toFixed(2) },
        buildings,
    };
}

/** Records estates: their grounds reserved on the occupancy grid, their buildings placed before
 * the houses (counting towards them), their drives as lanes. */
export function settleEstates(T, laid) {
    const { occupancy } = T;
    T.estates = T.estates ?? [];
    T.buildings = T.buildings ?? [];
    for (const { estate, buildings } of laid) {
        occupancy.stampPolygon(estate.poly, RESERVED);
        for (const b of buildings) occupancy.stampPolygon(b.poly, BUILDING);
        const base = T.buildings.length;
        for (const b of buildings) T.buildings.push(b.kind === "range" ? { ...b, house: base + b.house } : b);
        T.housesBefore = (T.housesBefore ?? 0) + buildings.filter((b) => b.kind === "house").length;
        T.estates.push(estate);
    }
}

/**
 * Worked estates beyond the walls and the last houses, after the houses are built: grounds by a
 * road (and off it by a drive), clear of everything placed, fields laid round them after.
 */
export function buildWorkedEstates(T, count) {
    if (!count) return;
    const { occupancy } = T;
    const random = T.R("estates-worked");
    const houses = T.buildings.filter((b) => b.kind === "house").map((b) => b.poly[0]);
    const cell = 60;
    const buckets = new Map();
    for (const c of houses) {
        const key = `${Math.floor(c[0] / cell)},${Math.floor(c[1] / cell)}`;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(c);
    }
    const nearestHouse = (p, limit) => {
        let best = Infinity;
        const reach = Math.ceil(limit / cell);
        const i0 = Math.floor(p[0] / cell), j0 = Math.floor(p[1] / cell);
        for (let dj = -reach; dj <= reach; dj++) for (let di = -reach; di <= reach; di++) for (const q of buckets.get(`${i0 + di},${j0 + dj}`) ?? []) best = Math.min(best, dist(p, q));
        return best;
    };
    const rings = [T.wall, T.outerWall].filter(Boolean).map((w) => w.polygon);
    const [near] = ESTATES.WORKED_BEYOND_M;
    const [minA, maxA] = ESTATES.GROUNDS.worked;
    // Spots round the town beyond its walls, nearest first, each with a drive to the nearest road
    // (Ken: worked estates just beyond the town, not out at the frame's edge)
    const rings0 = [T.wall, T.outerWall].filter(Boolean).map((w) => w.polygon);
    const roadPts = T.roads.flatMap((road) => road.points.filter((p) => rings0.every((ring) => !pointInPolygon(p, ring))).map((p) => ({ p, road })));
    const nearestRoad = (p) => {
        let best = null;
        for (const q of roadPts) {
            const d = dist(p, q.p);
            if (!best || d < best.d) best = { d, ...q };
        }
        return best;
    };
    const outer = (T.outerWall ?? T.wall)?.polygon ?? T.core;
    const r0 = outer ? Math.max(...outer.map((p) => dist(p, T.centre))) : 300;
    const candidates = [];
    for (let r = r0 + 120; r < r0 + 2200; r += 90) {
        for (let k = 0; k < 48; k++) {
            const a = ((k + random.range(-0.3, 0.3)) / 48) * 2 * Math.PI;
            const c = [T.centre[0] + Math.cos(a) * r, T.centre[1] + Math.sin(a) * r];
            if (!T.inFrame(c)) continue;
            const area = random.range(minA, maxA);
            const L = Math.sqrt(area * random.range(1.2, 1.6));
            const S = area / L;
            const d = nearestHouse(c, 260);
            if (d < near * 0.5 + L / 2) continue;
            const rd = nearestRoad(c);
            if (!rd || rd.d < S / 2 + 20 || rd.d > S / 2 + ESTATES.WORKED_DRIVE_M[1] * 3) continue;
            // Its front to the road
            const toRoad = [(rd.p[0] - c[0]) / rd.d, (rd.p[1] - c[1]) / rd.d];
            candidates.push({ c, angle: Math.atan2(toRoad[0], -toRoad[1]), L, S, road: rd.p, n: [-toRoad[0], -toRoad[1]], d: r });
        }
    }
    // Nearest the town first, a little shuffled
    for (const cand of candidates) cand.key = cand.d * (1 + 0.25 * random.next());
    candidates.sort((x, y) => x.key - y.key);
    const laid = [];
    for (const cand of candidates) {
        if (laid.length >= count) break;
        if (laid.some((e) => dist(e.estate.centre, cand.c) < ESTATES.APART_M.worked)) continue;
        const poly = rect(cand.c, cand.angle, cand.L, cand.S);
        if (!poly.every((p) => T.inFrame(p) && !T.seaAt(p) && T.wdAt(p) > 10 && rings.every((ring) => !pointInPolygon(p, ring)))) continue;
        if (!dryOver(T, poly, 6)) continue;
        if (!occupancy.free(poly)) continue;
        if (poly.some((p) => nearestHouse(p, 80) < 30)) continue;
        // The front faces the road
        const ground = { c: cand.c, angle: cand.angle, long: cand.L, short: cand.S, poly };
        const front = { d: [-cand.n[0], -cand.n[1]], half: cand.S / 2 };
        const one = layOutEstate(T, ground, "worked", random, null, front);
        const driveEnd = one.estate.gate;
        const drive = [cand.road, lerp(cand.road, driveEnd, 0.5), driveEnd];
        if (drive.some((p) => T.wdAt(p) < 6)) continue;
        // The drive crosses only open ground (past the road's own edge)
        let open = true;
        for (let k = 0; k + 1 < drive.length && open; k++) {
            const steps = Math.ceil(dist(drive[k], drive[k + 1]) / 2);
            for (let u = 0; u <= steps && open; u++) {
                const q = lerp(drive[k], drive[k + 1], u / steps);
                if (dist(q, cand.road) < 10 || pointInPolygon(q, poly)) continue;
                for (const o of [[0, 0], [2.5, 0], [-2.5, 0], [0, 2.5], [0, -2.5]]) if (occupancy.at([q[0] + o[0], q[1] + o[1]]) !== 0) open = false;
            }
        }
        if (!open) continue;
        occupancy.stampPolygon(poly, RESERVED);
        for (const b of one.buildings) occupancy.stampPolygon(b.poly, BUILDING);
        occupancy.stampPolyline(drive, 2, STREET);
        T.streets.push({ points: drive, half: 2, rank: 2, lane: true, drive: true });
        const base = T.buildings.length;
        for (const b of one.buildings) T.buildings.push(b.kind === "range" ? { ...b, house: base + b.house } : b);
        T.estates = T.estates ?? [];
        T.estates.push(one.estate);
        laid.push(one);
    }
}
