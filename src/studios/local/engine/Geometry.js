// Geometry and seeded randomness for the local map engine: noise, polylines, polygons, sampling.
import { hashString, stageRandom as kernelStageRandom } from "../../../kernel/random/Random.js";

/**
 * A seeded random source for one stage: next(), range(a, b), pick(list), chance(p). The numbers are
 * the kernel's stream (`Random.stageRandom`), which the prototype's own gave exactly.
 */
export function stageRandom(seed, stage) {
    const next = kernelStageRandom(seed, stage);
    return {
        next,
        range: (a, b) => a + (b - a) * next(),
        pick: (list) => list[Math.floor(next() * list.length)],
        chance: (p) => next() < p,
    };
}

/** Smooth value noise in 0..1, seeded. */
export function makeNoise(seed) {
    const s = hashString(String(seed));
    const lattice = (ix, iy) => {
        let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ s;
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    };
    const smooth = (t) => t * t * (3 - 2 * t);
    const value = (x, y) => {
        const ix = Math.floor(x), iy = Math.floor(y), fx = smooth(x - ix), fy = smooth(y - iy);
        const a = lattice(ix, iy), b = lattice(ix + 1, iy), c = lattice(ix, iy + 1), d = lattice(ix + 1, iy + 1);
        return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
    };
    const fbm = (x, y, octaves = 4) => {
        let sum = 0, amp = 0.5, norm = 0, f = 1;
        for (let o = 0; o < octaves; o++) {
            sum += amp * value(x * f + o * 17.3, y * f - o * 9.1);
            norm += amp;
            amp *= 0.5;
            f *= 2.03;
        }
        return sum / norm;
    };
    return { value, fbm };
}

export const deg = (degrees) => (degrees * Math.PI) / 180;
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** Chaikin corner cutting on an open polyline (ends kept). */
export function chaikin(points, passes = 2) {
    let p = points;
    for (let k = 0; k < passes; k++) {
        if (p.length < 3) return p;
        const out = [p[0]];
        for (let i = 0; i + 1 < p.length; i++) {
            out.push(lerp(p[i], p[i + 1], 0.25), lerp(p[i], p[i + 1], 0.75));
        }
        out.push(p[p.length - 1]);
        p = out;
    }
    return p;
}

/** Chaikin on a closed ring. */
export function chaikinClosed(points, passes = 2) {
    let p = points;
    for (let k = 0; k < passes; k++) {
        const out = [];
        for (let i = 0; i < p.length; i++) {
            const a = p[i], b = p[(i + 1) % p.length];
            out.push(lerp(a, b, 0.25), lerp(a, b, 0.75));
        }
        p = out;
    }
    return p;
}

/** Douglas-Peucker simplification. */
export function simplify(points, tolerance) {
    if (points.length < 3) return points;
    const keep = new Uint8Array(points.length);
    keep[0] = keep[points.length - 1] = 1;
    const stack = [[0, points.length - 1]];
    while (stack.length) {
        const [i, j] = stack.pop();
        const [ax, ay] = points[i], [bx, by] = points[j];
        const vx = bx - ax, vy = by - ay, L = Math.hypot(vx, vy) || 1;
        let best = -1, bestD = tolerance;
        for (let k = i + 1; k < j; k++) {
            const d = Math.abs(vx * (points[k][1] - ay) - vy * (points[k][0] - ax)) / L;
            if (d > bestD) { bestD = d; best = k; }
        }
        if (best >= 0) { keep[best] = 1; stack.push([i, best], [best, j]); }
    }
    return points.filter((_, k) => keep[k]);
}

/** Arc-length walk along a polyline: calls visit(point, unitTangent, s) every `step(s)` metres. */
export function walk(points, stepAt, visit) {
    let s = 0, next = 0;
    for (let i = 0; i + 1 < points.length; i++) {
        const a = points[i], b = points[i + 1];
        const L = dist(a, b);
        if (L === 0) continue;
        const t = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
        while (next <= s + L) {
            const u = (next - s) / L;
            const step = stepAt(next);
            visit(lerp(a, b, u), t, next, step);
            next += step;
        }
        s += L;
    }
    return s;
}

export function polylineLength(points) {
    let s = 0;
    for (let i = 0; i + 1 < points.length; i++) s += dist(points[i], points[i + 1]);
    return s;
}

export function pointInPolygon(p, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i], [xj, yj] = poly[j];
        if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}

/**
 * Where a polygon's edges cross the line at height y, as pointInPolygon works them out (the same
 * test and the same arithmetic), so a point on that line is inside exactly when an odd number of
 * them lie beyond it.
 */
export function polygonCuts(poly, y) {
    const cuts = [];
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
        if (yi > y !== yj > y) cuts.push(((xj - xi) * (y - yi)) / (yj - yi) + xi);
    }
    return cuts;
}

/** Whether a point at x on that line is inside, from the polygon's cuts. */
export function insideCuts(cuts, x) {
    let inside = false;
    for (let k = 0; k < cuts.length; k++) if (x < cuts[k]) inside = !inside;
    return inside;
}

export function polygonArea(poly) {
    let a = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]);
    return Math.abs(a / 2);
}

export function centroid(poly) {
    let x = 0, y = 0;
    for (const p of poly) { x += p[0]; y += p[1]; }
    return [x / poly.length, y / poly.length];
}

/** Shrinks a convex polygon towards its centroid by `by` metres (approximately, for headlands). */
export function shrink(poly, by) {
    const c = centroid(poly);
    return poly.map((p) => {
        const d = dist(p, c) || 1;
        const k = Math.max(0, (d - by) / d);
        return [c[0] + (p[0] - c[0]) * k, c[1] + (p[1] - c[1]) * k];
    });
}

/** Clips the infinite line through `o` with direction `t` to a convex polygon: [p, q] or null. */
export function clipLineConvex(o, t, poly) {
    let lo = -Infinity, hi = Infinity;
    const n = poly.length;
    // orientation of polygon
    const area2 = poly.reduce((acc, p, i) => { const q = poly[(i + 1) % n]; return acc + (p[0] * q[1] - q[0] * p[1]); }, 0);
    const sign = area2 > 0 ? 1 : -1;
    for (let i = 0; i < n; i++) {
        const a = poly[i], b = poly[(i + 1) % n];
        const ex = b[0] - a[0], ey = b[1] - a[1];
        // inside test: sign * cross(e, p - a) >= 0
        const num = sign * (ex * (o[1] - a[1]) - ey * (o[0] - a[0]));
        const den = sign * (ex * t[1] - ey * t[0]);
        if (Math.abs(den) < 1e-12) { if (num < 0) return null; continue; }
        const s = -num / den;
        if (den > 0) lo = Math.max(lo, s); else hi = Math.min(hi, s);
    }
    if (lo >= hi) return null;
    return [[o[0] + t[0] * lo, o[1] + t[1] * lo], [o[0] + t[0] * hi, o[1] + t[1] * hi]];
}

/** Bridson Poisson-disc sampling in a w x h box centred on the origin. */
export function poisson(w, h, r, random, accept = () => true) {
    const cell = r / Math.SQRT2, gw = Math.ceil(w / cell), gh = Math.ceil(h / cell);
    const grid = new Int32Array(gw * gh).fill(-1);
    const pts = [], active = [];
    const put = (p) => { const i = pts.length; pts.push(p); active.push(i); grid[Math.floor((p[1] + h / 2) / cell) * gw + Math.floor((p[0] + w / 2) / cell)] = i; };
    const ok = (p) => {
        if (p[0] < -w / 2 || p[0] >= w / 2 || p[1] < -h / 2 || p[1] >= h / 2) return false;
        const gx = Math.floor((p[0] + w / 2) / cell), gy = Math.floor((p[1] + h / 2) / cell);
        for (let y = Math.max(0, gy - 2); y <= Math.min(gh - 1, gy + 2); y++)
            for (let x = Math.max(0, gx - 2); x <= Math.min(gw - 1, gx + 2); x++) {
                const j = grid[y * gw + x];
                if (j >= 0 && dist(pts[j], p) < r) return false;
            }
        return true;
    };
    put([(random() - 0.5) * w * 0.2, (random() - 0.5) * h * 0.2]);
    while (active.length) {
        const k = Math.floor(random() * active.length), base = pts[active[k]];
        let found = false;
        for (let tries = 0; tries < 20; tries++) {
            const a = random() * Math.PI * 2, rr = r * (1 + random());
            const p = [base[0] + Math.cos(a) * rr, base[1] + Math.sin(a) * rr];
            if (ok(p)) { put(p); found = true; break; }
        }
        if (!found) active.splice(k, 1);
    }
    return pts.filter(accept);
}

/** A unit vector for a compass bearing (0 north, clockwise) in map axes (x east, y south). */
export function compass(bearing) {
    const a = deg(bearing);
    return [Math.sin(a), -Math.cos(a)];
}

/** The compass bearing (0 north, clockwise) of a vector in map axes. */
export function bearingOfVector(v) {
    return ((Math.round((Math.atan2(v[0], -v[1]) * 180) / Math.PI) % 360) + 360) % 360;
}

/** The smallest angle between two bearings, in degrees. */
export function angleBetween(a, b) {
    const d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
}

/** Where a ray from `from` along unit `t` leaves the frame (half its sides, [x, y] or one for a square), less `inset`. */
export function exitPoint(from, t, half, inset = 0) {
    const halves = Array.isArray(half) ? half : [half, half];
    let reach = Infinity;
    for (const axis of [0, 1]) {
        if (Math.abs(t[axis]) < 1e-9) continue;
        const wall = t[axis] > 0 ? halves[axis] - inset : -halves[axis] + inset;
        const s = (wall - from[axis]) / t[axis];
        if (s > 0 && s < reach) reach = s;
    }
    return [from[0] + t[0] * reach, from[1] + t[1] * reach];
}

/** Distance from a point to a segment. */
export function segmentDistance(p, a, b) {
    const vx = b[0] - a[0], vy = b[1] - a[1], LL = vx * vx + vy * vy || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / LL));
    return Math.hypot(p[0] - a[0] - t * vx, p[1] - a[1] - t * vy);
}

/**
 * Segments bucketed on a grid, for asking "is any segment within this distance of a point?" without
 * trying them all (V6). Each segment is filed in every cell its box, grown by `reach`, touches, so
 * the answer is exactly the one trying every segment gives, for any distance up to `reach`.
 * @param {{a:number[], b:number[], within?:number}[]} segments
 * @param {number} reach - The largest distance that will be asked (m).
 * @param {number} [cell] - The grid's square (m).
 */
export function segmentIndex(segments, reach, cell = 64) {
    const grid = new Map();
    for (const sg of segments) {
        const x0 = Math.floor((Math.min(sg.a[0], sg.b[0]) - reach) / cell), x1 = Math.floor((Math.max(sg.a[0], sg.b[0]) + reach) / cell);
        const y0 = Math.floor((Math.min(sg.a[1], sg.b[1]) - reach) / cell), y1 = Math.floor((Math.max(sg.a[1], sg.b[1]) + reach) / cell);
        for (let i = x0; i <= x1; i++) {
            for (let j = y0; j <= y1; j++) {
                const k = i * 100003 + j;
                let list = grid.get(k);
                if (!list) grid.set(k, (list = []));
                list.push(sg);
            }
        }
    }
    const at = (p) => grid.get(Math.floor(p[0] / cell) * 100003 + Math.floor(p[1] / cell)) ?? [];
    return {
        /** Whether any segment lies within `within` of p (each segment's own `within` if not given). */
        near(p, within) {
            for (const sg of at(p)) if (segmentDistance(p, sg.a, sg.b) < (within ?? sg.within)) return true;
            return false;
        },
        /** Whether every segment lies further than its own `clear` from p. */
        clearOf(p) {
            for (const sg of at(p)) if (segmentDistance(p, sg.a, sg.b) <= sg.clear) return false;
            return true;
        },
    };
}

/**
 * Exact Euclidean distance transform (Felzenszwalb and Huttenlocher) of an NX x NY grid: for every
 * cell, the distance in cells to the nearest cell marked in `seeds`. Linear in the cells, so a
 * river's distance field costs milliseconds rather than a search per cell.
 * @param {Uint8Array} seeds
 * @param {number} NX - Cells across.
 * @param {number} [NY] - Cells down (as many as across if left out).
 * @returns {Float32Array}
 */
export function distanceTransform(seeds, NX, NY = NX) {
    const INF = 1e20;
    const most = Math.max(NX, NY);
    const f = new Float64Array(most);
    const d = new Float64Array(most);
    const v = new Int32Array(most);
    const z = new Float64Array(most + 1);
    const grid = new Float64Array(NX * NY);
    for (let k = 0; k < NX * NY; k++) grid[k] = seeds[k] ? 0 : INF;
    const pass = (N, get, set) => {
        for (let q = 0; q < N; q++) f[q] = get(q);
        let k = 0;
        v[0] = 0;
        z[0] = -INF;
        z[1] = INF;
        for (let q = 1; q < N; q++) {
            let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
            while (s <= z[k]) {
                k--;
                s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
            }
            k++;
            v[k] = q;
            z[k] = s;
            z[k + 1] = INF;
        }
        k = 0;
        for (let q = 0; q < N; q++) {
            while (z[k + 1] < q) k++;
            d[q] = (q - v[k]) ** 2 + f[v[k]];
        }
        for (let q = 0; q < N; q++) set(q, d[q]);
    };
    for (let x = 0; x < NX; x++) pass(NY, (y) => grid[y * NX + x], (y, value) => (grid[y * NX + x] = value));
    for (let y = 0; y < NY; y++) pass(NX, (x) => grid[y * NX + x], (x, value) => (grid[y * NX + x] = value));
    const out = new Float32Array(NX * NY);
    for (let k = 0; k < NX * NY; k++) out[k] = Math.sqrt(grid[k]);
    return out;
}

/** A polyline offset sideways by `by` metres (positive to the left of travel in map axes). */
export function offsetPolyline(points, by) {
    return points.map((p, k) => {
        const a = points[Math.max(0, k - 1)], b = points[Math.min(points.length - 1, k + 1)];
        const L = dist(a, b) || 1;
        const n = [(b[1] - a[1]) / L, -(b[0] - a[0]) / L];
        return [p[0] + n[0] * by, p[1] + n[1] * by];
    });
}

/** A polyline resampled every `step` metres. */
export function resample(points, step) {
    const out = [];
    walk(points, () => step, (p) => out.push(p));
    if (out.length && dist(out[out.length - 1], points[points.length - 1]) > step * 0.25) out.push(points[points.length - 1]);
    return out;
}

/** Where segments a-b and c-d cross: {s along a-b, t along c-d, p}, or null (ends half-open). */
export function segmentCross(a, b, c, d) {
    const rx = b[0] - a[0], ry = b[1] - a[1], sx = d[0] - c[0], sy = d[1] - c[1];
    const den = rx * sy - ry * sx;
    if (Math.abs(den) < 1e-12) return null;
    const qx = c[0] - a[0], qy = c[1] - a[1];
    const s = (qx * sy - qy * sx) / den;
    const t = (qx * ry - qy * rx) / den;
    if (s < 0 || s >= 1 || t < 0 || t >= 1) return null;
    return { s, t, p: [a[0] + rx * s, a[1] + ry * s] };
}

/** The point at a fractional index along a polyline (index 2.5: halfway along its third segment). */
export function pointAtIndex(line, at) {
    const k = Math.min(line.length - 2, Math.max(0, Math.floor(at)));
    return lerp(line[k], line[k + 1], at - k);
}

/** The polyline from a fractional index on. */
function lineFrom(line, at) {
    const k = Math.min(line.length - 2, Math.floor(at));
    return [pointAtIndex(line, at), ...line.slice(k + 1)];
}

/**
 * A simple polygon cut along a polyline into pieces: wherever the line crosses the polygon from
 * one side to the other, the polygon is split along it (so a field crossed by a winding road
 * becomes two fields bounded by the road itself). A line that only touches or ends inside cuts
 * nothing.
 * @param {number[][]} poly
 * @param {number[][]} line
 * @returns {number[][][]}
 */
/** A line may cross a polygon this many times over before the rest of it is ignored. */
const SPLIT_DEPTH = 60;

export function splitByPolyline(poly, line, depth = 0) {
    if (depth > SPLIT_DEPTH || line.length < 2) return [poly];
    const n = poly.length;
    const hits = [];
    for (let j = 0; j + 1 < line.length; j++) {
        for (let i = 0; i < n; i++) {
            const cross = segmentCross(line[j], line[j + 1], poly[i], poly[(i + 1) % n]);
            if (cross) hits.push({ at: j + cross.s, edge: i, t: cross.t, p: cross.p });
        }
    }
    if (hits.length < 2) return [poly];
    hits.sort((x, y) => x.at - y.at);
    for (let k = 0; k + 1 < hits.length; k++) {
        const h0 = hits[k];
        const h1 = hits[k + 1];
        if (h1.at - h0.at < 1e-7) continue;
        if (!pointInPolygon(pointAtIndex(line, (h0.at + h1.at) / 2), poly)) continue;
        const chord = [];
        for (let j = Math.floor(h0.at) + 1; j < h1.at; j++) chord.push(line[j]);
        const walk = (from, to) => {
            const out = [];
            if (from.edge === to.edge && to.t > from.t) return out;
            let e = (from.edge + 1) % n;
            for (let guard = 0; guard <= n; guard++) {
                out.push(poly[e]);
                if (e === to.edge) break;
                e = (e + 1) % n;
            }
            return out;
        };
        const one = [h0.p, ...walk(h0, h1), h1.p, ...chord.slice().reverse()];
        const two = [h1.p, ...walk(h1, h0), h0.p, ...chord];
        const rest = lineFrom(line, h1.at + 1e-6);
        return [...splitByPolyline(one, rest, depth + 1), ...splitByPolyline(two, rest, depth + 1)];
    }
    return [poly];
}

/** The pieces of the infinite line through `o` along unit `t` that lie inside a simple polygon. */
export function clipLinePolygon(o, t, poly) {
    const n = poly.length;
    const params = [];
    for (let i = 0; i < n; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % n];
        const ex = b[0] - a[0], ey = b[1] - a[1];
        const den = t[0] * ey - t[1] * ex;
        if (Math.abs(den) < 1e-12) continue;
        const qx = a[0] - o[0], qy = a[1] - o[1];
        const s = (qx * ey - qy * ex) / den;
        const u = (qx * t[1] - qy * t[0]) / den;
        if (u >= 0 && u < 1) params.push(s);
    }
    params.sort((x, y) => x - y);
    const out = [];
    for (let k = 0; k + 1 < params.length; k += 2) out.push([[o[0] + t[0] * params[k], o[1] + t[1] * params[k]], [o[0] + t[0] * params[k + 1], o[1] + t[1] * params[k + 1]]]);
    return out;
}
