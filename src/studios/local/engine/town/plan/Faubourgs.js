// The suburbs beyond the outermost wall (Ken, 2026-11-15): grown, not planned. Land is cheapest by
// the wall and dearer by the gates and the roads; the ground was fields before it was built over,
// so its lanes follow the old strips and furlongs. Each furlong has its strips' own direction;
// lanes leave the roads (and then each other) square on, then bend to follow the strips, dog-legging
// where one furlong meets the next, and end where they meet another way or run out of ground.
// Lanes are closest by the wall (small, packed plots) and wider apart further out. Since Ken's
// review (2026-11-17) they wander off the strips, vary in length, more often end as dead ends
// than loop back, and branch into short side lanes, so a suburb grows as clusters.
import { dist, lerp, makeNoise } from "../../Geometry.js";

export const FAUBOURGS = Object.freeze({
    /** Furlongs about this far apart (m); their strips' direction within so much of square to the
     * nearest road (radians). */
    FURLONG_M: Object.freeze({ town: 120, city: 150 }),
    STRIP_TURN: 0.5,
    /** Lanes leave a way this far apart (m) by the wall, and this far apart far out, reached at this
     * distance (m) from the wall. */
    APART_NEAR: Object.freeze({ town: 40, city: 36 }),
    APART_FAR: Object.freeze({ town: 85, city: 75 }),
    FAR_M: Object.freeze({ town: 450, city: 700 }),
    /** Tracing: step (m), the most a lane turns a step (radians), the straight start (m), the longest
     * lane (m), the shortest kept (m), how near another way a lane joins it (m), how near a lane may
     * run beside another (m) and for how long (m). */
    STEP: 4,
    TURN: 0.16,
    STRAIGHT_M: 14,
    LONGEST_M: 200,
    SHORTEST_M: 26,
    JOIN_M: 7,
    BESIDE_M: 15,
    BESIDE_RUN_M: 14,
    /** Generations of lanes off lanes. */
    GENERATIONS: 4,
    // Slow growth, not a planned estate (Ken, 2026-11-17: the lanes read as rapid modern building,
    // straight runs closing in loops):
    /** A lane's heading wanders off the strips by up to this (radians), by a noise this long (m),
     * and leaves its way within this of square (radians). */
    WANDER: 0.32,
    WANDER_M: 90,
    LEAVE_TURN: 0.3,
    /** The longest lane by generation (m), each lane a random share of it, at least LENGTH_LEAST. */
    LONGEST_BY_GEN: Object.freeze([200, 130, 80, 55]),
    LENGTH_LEAST: 0.45,
    /** The chance a lane that meets another way joins it; otherwise it stops short as a dead end
     * (m short of the way). The first generation off the roads joins more often. */
    JOIN_CHANCE: Object.freeze([0.65, 0.35, 0.25, 0.2]),
    STOP_SHORT_M: 10,
    /** Lanes off lanes are seeded this much closer together, and fewer seeds are skipped. */
    BRANCH_APART: 0.95,
});

/**
 * Lanes over the suburbs' ground beyond the outermost wall.
 * @param ok (p) => whether a lane may run at p (the suburbs' ground, dry, clear of the walls)
 * @param wallDist (p) => metres from the outermost wall
 * @param taken {add(points, id), near(p, ids, within) => the nearest way point within `within` not in ids, or null}
 * @param starts [{points, id, half}] the ways lanes may leave from (the roads beyond the gates)
 */
export function growFaubourgs({ T, random, kind, ok, wallDist, taken, starts, roadPoints }) {
    const F = FAUBOURGS;
    // ---------------------------------------------------------------- furlongs: strip directions
    const fm = F.FURLONG_M[kind];
    const seeds = [];
    const box = [-T.W / 2, -T.H / 2, T.W / 2, T.H / 2];
    for (let y = box[1] + fm / 2; y < box[3]; y += fm) {
        for (let x = box[0] + fm / 2; x < box[2]; x += fm) {
            const p = [x + random.range(-0.4, 0.4) * fm, y + random.range(-0.4, 0.4) * fm];
            if (!ok(p)) continue;
            // Square to the nearest road, turned a little each its own way
            let best = null;
            for (const q of roadPoints) {
                const d = dist(p, q.p);
                if (!best || d < best.d) best = { d, q };
            }
            if (!best) continue;
            const along = best.q.t;
            const a = Math.atan2(along[0], -along[1]) + random.range(-F.STRIP_TURN, F.STRIP_TURN);
            seeds.push({ p, a });
        }
    }
    const SB = fm * 1.5;
    const seedBuckets = new Map();
    for (const s of seeds) {
        const key = `${Math.floor(s.p[0] / SB)},${Math.floor(s.p[1] / SB)}`;
        if (!seedBuckets.has(key)) seedBuckets.set(key, []);
        seedBuckets.get(key).push(s);
    }
    const stripAt = (p) => {
        const i = Math.floor(p[0] / SB), j = Math.floor(p[1] / SB);
        let best = null;
        for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (const s of seedBuckets.get(`${i + di},${j + dj}`) ?? []) {
            const d = dist(p, s.p);
            if (!best || d < best.d) best = { d, s };
        }
        return best ? best.s.a : null;
    };
    const apartAt = (p) => {
        const f = Math.min(1, wallDist(p) / F.FAR_M[kind]);
        return F.APART_NEAR[kind] + (F.APART_FAR[kind] - F.APART_NEAR[kind]) * f;
    };
    // ---------------------------------------------------------------- tracing
    const lanes = [];
    let serial = 0;
    const wander = makeNoise(`${T.input.seed}:faubourg-wander`);
    const trace = (base, p0, dir0, fromId, gen) => {
        const id = `fb${serial++}`;
        const longest = F.LONGEST_BY_GEN[Math.min(gen, F.LONGEST_BY_GEN.length - 1)] * random.range(F.LENGTH_LEAST, 1);
        const joins = random.chance(F.JOIN_CHANCE[Math.min(gen, F.JOIN_CHANCE.length - 1)]);
        const lean = random.range(-0.5, 0.5);
        const ids = new Set([id, fromId]);
        const pts = [base, p0];
        // (leaving a little off square)
        const t0 = random.range(-F.LEAVE_TURN, F.LEAVE_TURN);
        let d = [dir0[0] * Math.cos(t0) - dir0[1] * Math.sin(t0), dir0[0] * Math.sin(t0) + dir0[1] * Math.cos(t0)];
        let p = p0;
        let len = 0;
        let beside = 0;
        let joined = false;
        while (len < Math.min(F.LONGEST_M, longest)) {
            // Square on at first, then turning towards the strips' direction (either way along it)
            if (len >= F.STRAIGHT_M) {
                const a0 = stripAt(p);
                // (the strips' line, wandering slowly, so the lane bends as a path worn over years)
                const a = a0 === null ? null : a0 + F.WANDER * (2 * wander.value(p[0] / F.WANDER_M + lean * 7, p[1] / F.WANDER_M) - 1 + lean);
                if (a !== null) {
                    let v = [Math.cos(a), Math.sin(a)];
                    if (v[0] * d[0] + v[1] * d[1] < 0) v = [-v[0], -v[1]];
                    const cross = d[0] * v[1] - d[1] * v[0];
                    const dot = d[0] * v[0] + d[1] * v[1];
                    const turn = Math.max(-F.TURN, Math.min(F.TURN, Math.atan2(cross, dot)));
                    d = [d[0] * Math.cos(turn) - d[1] * Math.sin(turn), d[0] * Math.sin(turn) + d[1] * Math.cos(turn)];
                }
            }
            const q = [p[0] + d[0] * F.STEP, p[1] + d[1] * F.STEP];
            if (!ok(q)) break;
            // Meeting another way: join it there
            const hit = taken.near(q, len < F.STRAIGHT_M ? new Set([...ids, ...roadIds]) : ids, F.JOIN_M);
            if (hit && len >= F.STRAIGHT_M * 0.5) {
                if (joins || len < F.STRAIGHT_M) {
                    pts.push(hit);
                    len += dist(p, hit);
                    joined = true;
                } else {
                    // A dead end short of the other way: a track into the plots, not a loop
                    const back = Math.round(F.STOP_SHORT_M / F.STEP);
                    pts.splice(Math.max(2, pts.length - back));
                    len -= back * F.STEP;
                }
                break;
            }
            // Running beside another way: stop short of it
            if (len >= F.STRAIGHT_M && taken.near(q, ids, F.BESIDE_M)) {
                beside += F.STEP;
                if (beside >= F.BESIDE_RUN_M) {
                    pts.splice(Math.max(1, pts.length - Math.round(beside / F.STEP)));
                    len -= beside;
                    break;
                }
            } else beside = 0;
            pts.push(q);
            len += F.STEP;
            p = q;
        }
        if (len < F.SHORTEST_M || pts.length < 4) return null;
        // Keep every other point, then smooth corners a little
        const thin = pts.filter((_, k) => k % 2 === 0 || k === pts.length - 1);
        const lane = { points: thin, id, faubourg: true, close: !joined };
        taken.add(thin, id);
        lanes.push(lane);
        return lane;
    };
    // Seeds along a way: both sides, apart by the land's value, nearest the wall first
    const seedAlong = (way, half, gen) => {
        const pts = way.points;
        const out = [];
        let s = random.range(8, 24);
        let acc = 0;
        for (let k = 1; k < pts.length; k++) {
            const a = pts[k - 1], b = pts[k];
            const L = dist(a, b);
            if (L < 1e-6) continue;
            const t = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
            while (s <= acc + L) {
                const p = lerp(a, b, (s - acc) / L);
                for (const side of [1, -1]) {
                    if (random.chance(gen ? 0.25 : 0.12)) continue;
                    const n = [-t[1] * side, t[0] * side];
                    out.push({ base: p, p: [p[0] + n[0] * (half + 0.5), p[1] + n[1] * (half + 0.5)], n, from: way.id, w: wallDist(p) });
                }
                s += apartAt(p) * (gen ? F.BRANCH_APART : 1) * random.range(0.8, 1.25);
            }
            acc += L;
        }
        return out;
    };
    const roadIds = new Set(starts.map((w) => w.id));
    let front = [];
    for (const way of starts) front.push(...seedAlong(way, way.half, 0));
    for (let gen = 0; gen < F.GENERATIONS && front.length; gen++) {
        // Nearest the wall first, so the packed ground by the wall is laid out before the far lanes
        front.sort((x, y) => x.w - y.w);
        const made = [];
        for (const sd of front) {
            // (roads that share their way out of a gate do not stop each other's lanes)
            if (!ok(sd.p) || taken.near(sd.p, gen === 0 ? roadIds : new Set([sd.from]), F.JOIN_M + 2)) continue;
            const lane = trace(sd.base, sd.p, sd.n, sd.from, gen);
            if (lane) made.push(lane);
        }
        front = [];
        for (const lane of made) front.push(...seedAlong(lane, 2.25, gen + 1));
    }
    return lanes;
}
