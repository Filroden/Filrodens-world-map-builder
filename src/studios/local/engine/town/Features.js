// The finishing touches that make a place read as lived in: a street up to the door of every
// place of worship, castle and market that would otherwise stand alone inside its own lane; lanes
// that end at a wall rather than running through it where there is no gate; small parks inside
// the walls; and cemeteries outside the town by its roads.
import { centroid, chaikin, chaikinClosed, dist, lerp, pointInPolygon, polygonArea, segmentCross, segmentDistance } from "../Geometry.js";
import { FREE, RESERVED, STREET } from "./Occupancy.js";
import { rect } from "./Walls.js";

export const FEATURES = Object.freeze({
    /** A street within this distance (m) of a feature's door already serves it. */
    SERVED_M: 9,
    /** The longest street (m) drawn up to a feature's door. */
    APPROACH_MAX_M: 650,
    /** A lane meeting a wall stops this far (m) short of it on each side, where there is no gate. */
    WALL_GAP_M: 6,
    /** A gate within this distance (m) of a crossing lets the street through. */
    GATE_REACH_M: 25,
    /** Parks inside the walls: one per this much walled ground (ha), one to four. */
    PARK_HA: 15,
    PARK_MAX: 4,
    /** A park's radius (m): the one laid out before the houses, and the least a gap must offer. */
    PARK_RADIUS: [20, 30],
    PARK_MIN_GAP_M: 17,
    /** Cemeteries: a town has one, a city one more per this many people, up to four. */
    CEMETERY_PEOPLE: 15000,
    CEMETERY_MAX: 4,
    /** A cemetery's ground (ha): a base and a share by the people it serves, within these bounds. */
    CEMETERY_HA: [0.3, 1.6],
    CEMETERY_HA_PER_PERSON: 1 / 30000,
    /** How far (m) beyond the last houses a cemetery may lie. */
    CEMETERY_BEYOND_M: [20, 220],
});

// --------------------------------------------------------------- streets to the features' doors

/** The streets a door may join: every road and street but the suburbs' lanes (which may yet be
 * dropped where no house is built on them), the markets' and precincts' own rings and other doors. */
function joinable(T) {
    return T.streets.filter((s) => !s.suburb && !s.market && !s.precinct && !s.approach);
}

function nearestOn(streets, p) {
    const found = [];
    for (const street of streets) {
        const pts = street.points;
        let best = null;
        for (let k = 0; k + 1 < pts.length; k++) {
            const a = pts[k];
            const b = pts[k + 1];
            const ab = [b[0] - a[0], b[1] - a[1]];
            const len2 = ab[0] * ab[0] + ab[1] * ab[1] || 1;
            const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / len2));
            const q = [a[0] + ab[0] * t, a[1] + ab[1] * t];
            const d = dist(p, q);
            if (!best || d < best.d) best = { q, d, street };
        }
        if (best) found.push(best);
    }
    return found.sort((a, b) => a.d - b.d);
}

/**
 * A street from a door out to the nearest street it can reach without crossing water, rock, a
 * wall, a gatehouse, a castle or another feature's grounds.
 */
function approach(T, door, out, own, half, { streets = joinable(T), built = null } = {}) {
    const rings = [T.wall, T.outerWall].filter(Boolean).map((w) => w.polygon);
    // What a street may not cross: other grounds, the castle, gatehouses, a hold's landings
    const blocks = [
        ...(T.worship ?? []).map((w) => w.yard),
        ...(T.castle ? [T.castle.polygon] : []),
        ...[T.wall, T.outerWall].filter(Boolean).flatMap((w) => w.gates.map((g) => g.house)),
        ...(T.forts ?? []).map((f) => f.house),
        ...(T.estates ?? []).map((e) => e.poly),
    ];
    const insideOf = (p) => rings.map((ring) => pointInPolygon(p, ring)).join();
    // Step out of the door first, so the street meets it square on
    const start = [door[0] + out[0] * 4, door[1] + out[1] * 4];
    const side = insideOf(start);
    const candidates = nearestOn(streets, start).filter((c) => c.d <= FEATURES.APPROACH_MAX_M).slice(0, 10);
    // Prefer a street ahead of the door to one behind it
    candidates.sort((a, b) => a.d * (ahead(a) ? 1 : 1.8) - b.d * (ahead(b) ? 1 : 1.8));
    function ahead(c) {
        return (c.q[0] - door[0]) * out[0] + (c.q[1] - door[1]) * out[1] > 0;
    }
    for (const c of candidates) {
        if (c.d < FEATURES.SERVED_M) return null;
        // A short straight run out of the door, then on to the street, gently bent
        const lead = [door[0] + out[0] * Math.min(25, c.d * 0.35), door[1] + out[1] * Math.min(25, c.d * 0.35)];
        const line = chaikin([door, lead, c.q], 2);
        let ok = true;
        for (let k = 0; k + 1 < line.length && ok; k++) {
            const steps = Math.max(1, Math.ceil(dist(line[k], line[k + 1]) / 3));
            for (let u = 1; u <= steps; u++) {
                const p = lerp(line[k], line[k + 1], u / steps);
                if (own && pointInPolygon(p, own)) continue;
                if (T.seaAt(p) || T.wdAt(p) < half + 1 || insideOf(p) !== side) {
                    ok = false;
                    break;
                }
                if (blocks.some((poly) => poly !== own && pointInPolygon(p, poly)) || built?.(p, half)) {
                    ok = false;
                    break;
                }
            }
        }
        if (!ok) continue;
        return line;
    }
    return null;
}

/** The door of a place of worship: the middle of its grounds' edge at its entrance end. */
function worshipDoor(w) {
    const c = centroid(w.yard);
    // The porch (or a great one's gateway) stands at the entrance end
    const front = w.label === "great" ? w.body[3] : w.body[1];
    const f = centroid(front);
    const len = dist(f, c) || 1;
    const out = [(f[0] - c[0]) / len, (f[1] - c[1]) / len];
    let reach = 0;
    while (reach < 400 && pointInPolygon([c[0] + out[0] * reach, c[1] + out[1] * reach], w.yard)) reach += 1;
    return { door: [c[0] + out[0] * reach, c[1] + out[1] * reach], out, reach };
}

/** The middle of the polygon's edge facing a point, and the way out through it. */
function edgeFacing(poly, toward) {
    let best = null;
    const c = centroid(poly);
    for (let k = 0; k < poly.length; k++) {
        const m = lerp(poly[k], poly[(k + 1) % poly.length], 0.5);
        const d = dist(m, toward);
        if (!best || d < best.d) best = { m, d };
    }
    const len = dist(best.m, c) || 1;
    return { door: best.m, out: [(best.m[0] - c[0]) / len, (best.m[1] - c[1]) / len] };
}

/**
 * Every place of worship, the castle and the market is reached by a street. A great place of
 * worship's precinct lane gets a way in from its gateway; the castle a gate facing the town.
 */
export function connectFeatures(T) {
    const add = (line, half, serves) => {
        T.streets.push({ points: line, half, rank: 2, approach: true, serves });
        T.occupancy.stampPolyline(line, half, STREET);
    };
    for (const w of T.worship ?? []) {
        const { door, out } = worshipDoor(w);
        const great = w.label === "great";
        // A great one's door opens on its precinct lane; the way in runs from the lane outwards
        const from = great ? [door[0] + out[0] * 5, door[1] + out[1] * 5] : door;
        w.door = from;
        const line = approach(T, from, out, great ? null : w.yard, great ? 3.5 : 2.5);
        if (line) add(line, great ? 3.5 : 2.5, "worship");
    }
    if (T.castle) {
        const c = T.castle;
        const { door, out } = edgeFacing(c.polygon, T.centre);
        c.gate = { p: door, dir: Math.atan2(out[1], out[0]), house: rect(door, Math.atan2(out[1], out[0]), 14, 20) };
        const line = approach(T, door, out, c.polygon, 3.5);
        if (line) add(line, 3.5, "castle");
    }
    if (T.market && T.market.polygon) {
        const near = nearestOn(T.streets.filter((s) => !s.market && !s.approach), centroid(T.market.polygon));
        const touching = T.market.polygon.some((p) => nearestOn(T.streets.filter((s) => !s.market), p)[0]?.d < FEATURES.SERVED_M + 4);
        if (!touching && near[0]) {
            const { door, out } = edgeFacing(T.market.polygon, near[0].q);
            const line = approach(T, door, out, T.market.polygon, 3.5);
            if (line) add(line, 3.5, "market");
        }
    }
}

/**
 * After the houses: a place of worship in the suburbs whose nearest streets lay within the walls,
 * or along suburban lanes no house was built on, has none at its door. Its way runs to the nearest
 * street now drawn on its own side of the walls, between the houses.
 */
export function reachDoors(T) {
    const rings = [T.wall, T.outerWall].filter(Boolean).map((w) => w.polygon);
    const insideOf = (p) => rings.map((ring) => pointInPolygon(p, ring)).join();
    const streets = T.streets.filter((s) => !s.market && !s.precinct);
    const left = (T.worship ?? []).filter((w) => w.door && !nearestOn(streets, w.door).some((c) => c.d < FEATURES.SERVED_M));
    if (!left.length) return;
    const SIZE = 40;
    const buckets = new Map();
    for (const b of T.buildings) {
        const c = centroid(b.poly);
        const k = Math.floor(c[0] / SIZE) * 65536 + Math.floor(c[1] / SIZE);
        if (!buckets.has(k)) buckets.set(k, []);
        buckets.get(k).push(b.poly);
    }
    // A point of a way is built over if a building stands within the way's half width of it
    const built = (p, clear) => {
        const i = Math.floor(p[0] / SIZE);
        const j = Math.floor(p[1] / SIZE);
        for (let di = -1; di <= 1; di++) {
            for (let dj = -1; dj <= 1; dj++) {
                for (const poly of buckets.get((i + di) * 65536 + j + dj) ?? []) {
                    if (pointInPolygon(p, poly)) return true;
                    for (let k = 0; k < poly.length; k++) if (segmentDistance(p, poly[k], poly[(k + 1) % poly.length]) < clear) return true;
                }
            }
        }
        return false;
    };
    for (const w of left) {
        const great = w.label === "great";
        const half = great ? 3.5 : 2.5;
        // Its own door first; where houses stand before it, a way in through the grounds' other sides
        const c = centroid(w.yard);
        const doors = [{ door: w.door, out: worshipDoor(w).out }];
        if (!great) {
            for (let k = 0; k < w.yard.length; k++) {
                const m = lerp(w.yard[k], w.yard[(k + 1) % w.yard.length], 0.5);
                const len = dist(m, c) || 1;
                doors.push({ door: m, out: [(m[0] - c[0]) / len, (m[1] - c[1]) / len] });
            }
        }
        let done = false;
        for (const { door, out } of doors) {
            const side = insideOf([door[0] + out[0] * 4, door[1] + out[1] * 4]);
            const line = approach(T, door, out, great ? null : w.yard, half, { streets: streets.filter((s) => s.points.some((p) => insideOf(p) === side)), built });
            if (!line) continue;
            w.door = door;
            T.streets.push({ points: line, half, rank: 2, approach: true, serves: "worship" });
            T.occupancy.stampPolyline(line, half, STREET);
            done = true;
            break;
        }
        // No straight way between the houses: a path that winds through the open ground between them
        for (const { door, out } of done ? [] : doors) {
            const line = windingWay(T, door, out, PATH_HALF_M, built);
            if (!line) continue;
            w.door = door;
            T.streets.push({ points: line, half: PATH_HALF_M, rank: 2, approach: true, serves: "worship" });
            T.occupancy.stampPolyline(line, PATH_HALF_M, STREET);
            break;
        }
    }
}

/** A winding path's half width (m), and how far (m) it may search for a street. */
const PATH_HALF_M = 2;
const PATH_REACH_M = 220;

/**
 * A path from a door to the nearest street over open ground only (no house, garden, wall, water
 * or grounds), found on the occupancy grid with room for its width, then smoothed.
 */
function windingWay(T, door, out, half, built) {
    const occ = T.occupancy;
    const [MX, MY] = occ.size;
    const O = occ.step;
    const grid = occ.grid;
    const start = occ.index(door[0] + out[0] * (half + 2), door[1] + out[1] * (half + 2));
    if (start < 0) return null;
    const r = Math.ceil(half / O);
    const reach = Math.ceil(PATH_REACH_M / O);
    const si = start % MX;
    const sj = Math.floor(start / MX);
    const open = (i, j) => {
        for (let dj = -r; dj <= r; dj++) {
            for (let di = -r; di <= r; di++) {
                const ii = i + di;
                const jj = j + dj;
                if (ii < 0 || jj < 0 || ii >= MX || jj >= MY) return false;
                const v = grid[jj * MX + ii];
                if (v !== FREE && v !== STREET) return false;
            }
        }
        return true;
    };
    const from = new Map([[start, -1]]);
    const queue = [start];
    let found = -1;
    for (let head = 0; head < queue.length && found < 0; head++) {
        const m = queue[head];
        const i = m % MX;
        const j = Math.floor(m / MX);
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const ii = i + di;
            const jj = j + dj;
            const n = jj * MX + ii;
            if (Math.abs(ii - si) > reach || Math.abs(jj - sj) > reach || from.has(n)) continue;
            // Reaching a street ends the search; otherwise only open ground with room is walked
            if (ii >= 0 && jj >= 0 && ii < MX && jj < MY && grid[n] === STREET && head > 0) {
                from.set(n, m);
                found = n;
                break;
            }
            if (!open(ii, jj)) continue;
            from.set(n, m);
            queue.push(n);
        }
    }
    if (found < 0) return null;
    const cells = [];
    for (let m = found; m >= 0; m = from.get(m)) cells.push([-T.W / 2 + ((m % MX) + 0.5) * O, -T.H / 2 + (Math.floor(m / MX) + 0.5) * O]);
    cells.reverse();
    // Every few cells a point, so the stair-steps of the grid smooth into a curve; more points
    // where the smoothed curve would cut a corner too close to a house
    for (const every of [6, 3, 1]) {
        const line = chaikin([door, ...cells.filter((_, k) => k % every === 0), cells[cells.length - 1]], every > 1 ? 3 : 0);
        let clear = true;
        for (let k = 0; k + 1 < line.length && clear; k++) {
            const steps = Math.max(1, Math.ceil(dist(line[k], line[k + 1])));
            for (let u = 0; u <= steps && clear; u++) {
                const p = lerp(line[k], line[k + 1], u / steps);
                if (dist(p, door) > half + 2 && built(p, half)) clear = false;
            }
        }
        if (clear) return line;
    }
    return null;
}

// --------------------------------------------------------------- lanes end at a wall without a gate

/**
 * A lane that meets a wall where there is no gate stops short of it on either side, so no street
 * runs through a wall. The roads have gates wherever they cross.
 */
export function endLanesAtWalls(T) {
    const rings = [T.wall, T.outerWall].filter(Boolean);
    if (!rings.length) return;
    const edges = [];
    for (const ring of rings) {
        const v = ring.verts;
        for (let k = 0; k < v.length; k++) {
            const a = v[k];
            const b = v[(k + 1) % v.length];
            if (a.onBank && b.onBank) continue;
            edges.push({ a: a.p, b: b.p, gates: ring.gates });
        }
    }
    const gap = FEATURES.WALL_GAP_M;
    const out = [];
    for (const street of T.streets) {
        if (street.road || street.market) {
            out.push(street);
            continue;
        }
        const pieces = [];
        let piece = [street.points[0]];
        for (let k = 0; k + 1 < street.points.length; k++) {
            const a = street.points[k];
            const b = street.points[k + 1];
            const cuts = [];
            for (const e of edges) {
                const x = segmentCross(a, b, e.a, e.b);
                if (!x) continue;
                if (e.gates.some((g) => dist(g.p, x.p) < FEATURES.GATE_REACH_M)) continue;
                cuts.push(x.s);
            }
            const len = dist(a, b) || 1;
            for (const s of cuts.sort((p, q) => p - q)) {
                const before = Math.max(0, s - gap / len);
                const after = Math.min(1, s + gap / len);
                piece.push(lerp(a, b, before));
                pieces.push(piece);
                piece = [lerp(a, b, after)];
            }
            piece.push(b);
        }
        pieces.push(piece);
        if (pieces.length === 1) {
            out.push(street);
            continue;
        }
        for (const p of pieces) {
            const length = p.reduce((s, q, k) => (k ? s + dist(q, p[k - 1]) : 0), 0);
            if (p.length >= 2 && length >= 10) out.push({ ...street, points: p, ring: false });
        }
    }
    T.streets = out;
}

// --------------------------------------------------------------- parks inside the walls

function ringOf(c, r) {
    return Array.from({ length: 20 }, (_, k) => [c[0] + Math.cos((k / 20) * Math.PI * 2) * r, c[1] + Math.sin((k / 20) * Math.PI * 2) * r]);
}

function parkShape(T, c, r, random) {
    const ring = [];
    const n = 14;
    for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const rr = r * (0.86 + random.range(0, 0.14));
        ring.push([c[0] + Math.cos(a) * rr, c[1] + Math.sin(a) * rr]);
    }
    const poly = chaikinClosed(ring, 2);
    // Trees round its edge and a few in the middle; two paths across it
    const trees = [];
    for (let k = 0; k < poly.length; k += 2) if (random.chance(0.55)) trees.push([...lerp(poly[k], c, random.range(0.12, 0.22)), random.range(2.6, 4.2)]);
    for (let k = 0; k < Math.round(r / 8); k++) {
        const a = random.range(0, Math.PI * 2);
        const d = random.range(0.15, 0.55) * r;
        trees.push([c[0] + Math.cos(a) * d, c[1] + Math.sin(a) * d, random.range(3, 5)]);
    }
    const a0 = random.range(0, Math.PI);
    const paths = [0, Math.PI / 2 + random.range(-0.4, 0.4)].map((da) => {
        const t = [Math.cos(a0 + da), Math.sin(a0 + da)];
        return [[c[0] - t[0] * r * 0.85, c[1] - t[1] * r * 0.85], c, [c[0] + t[0] * r * 0.85, c[1] + t[1] * r * 0.85]];
    });
    return { poly, centre: c, radius: r, trees, paths };
}

/** Clear ground round a point: the largest radius (up to `max`) with nothing on it. */
function clearance(T, c, max) {
    const { occupancy } = T;
    let r = 0;
    for (let rr = 6; rr <= max; rr += 4) {
        for (let k = 0; k < 16; k++) {
            const a = (k / 16) * Math.PI * 2;
            if (occupancy.at([c[0] + Math.cos(a) * rr, c[1] + Math.sin(a) * rr]) !== FREE) return r;
        }
        r = rr;
    }
    return r;
}

function wallDistance(polygon, p) {
    let d = Infinity;
    for (let k = 0; k < polygon.length; k++) d = Math.min(d, segmentDistance(p, polygon[k], polygon[(k + 1) % polygon.length]));
    return d;
}

/**
 * One small park laid out before the houses, so even a crowded walled town has one: a green by a
 * street, clear of the market and the wall.
 */
export function layOutPark(T) {
    const { wall, occupancy } = T;
    T.parks = [];
    if (!wall || T.input.cave) return;
    const random = T.R("parks");
    const [r0, r1] = FEATURES.PARK_RADIUS;
    const r = random.range(r0, r1);
    // The plan-first core lays its park out with the blocks
    if (T.plan?.park) {
        const { c, r: rp } = T.plan.park;
        occupancy.stampPolygon(ringOf(c, rp + 2 * occupancy.step), RESERVED);
        T.parks.push(parkShape(T, c, rp, random));
        return;
    }
    const xs = wall.polygon.map((p) => p[0]);
    const ys = wall.polygon.map((p) => p[1]);
    const marketC = T.market?.polygon ? centroid(T.market.polygon) : T.centre;
    for (let tries = 0; tries < 600; tries++) {
        const c = [random.range(Math.min(...xs), Math.max(...xs)), random.range(Math.min(...ys), Math.max(...ys))];
        if (!pointInPolygon(c, wall.polygon) || wallDistance(wall.polygon, c) < r + 25 || dist(c, marketC) < r + 70) continue;
        if (T.castle && pointInPolygon(c, T.castle.polygon)) continue;
        if (clearance(T, c, r + 4) < r) continue;
        // Beside a street, so it is reached
        const near = nearestOn(T.streets.filter((s) => !s.market), c)[0];
        if (!near || near.d > r + 14) continue;
        const park = parkShape(T, c, r, random);
        // Kept a little wider than it is drawn, as the grid holds it only as finely as its squares
        occupancy.stampPolygon(ringOf(c, r + 2 * occupancy.step), RESERVED);
        T.parks.push(park);
        return;
    }
}

/** More parks in the ground the houses left open inside the walls, up to one per so many hectares. */
export function fillParks(T) {
    const { wall, occupancy } = T;
    if (!wall || T.input.cave) return;
    const random = T.R("parks-more");
    const ha = polygonArea(wall.polygon) / 10000;
    const wanted = Math.max(1, Math.min(FEATURES.PARK_MAX, Math.round(ha / FEATURES.PARK_HA)));
    const xs = wall.polygon.map((p) => p[0]);
    const ys = wall.polygon.map((p) => p[1]);
    // The buildings and streets near a spot, bucketed, for the exact room round it
    const cell = 50;
    const buckets = new Map();
    const put = (a, b) => {
        const key = `${Math.floor((a[0] + b[0]) / 2 / cell)},${Math.floor((a[1] + b[1]) / 2 / cell)}`;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push([a, b]);
    };
    for (const b of T.buildings) for (let k = 0; k < b.poly.length; k++) put(b.poly[k], b.poly[(k + 1) % b.poly.length]);
    for (const st of T.streets) for (let k = 0; k + 1 < st.points.length; k++) {
        // Long street segments go in every bucket they pass through
        const n = Math.max(1, Math.ceil(dist(st.points[k], st.points[k + 1]) / cell));
        for (let u = 0; u < n; u++) put(lerp(st.points[k], st.points[k + 1], u / n), lerp(st.points[k], st.points[k + 1], (u + 1) / n));
    }
    const room = (c, max) => {
        let best = max;
        const reach = Math.ceil((max + cell) / cell);
        const i0 = Math.floor(c[0] / cell);
        const j0 = Math.floor(c[1] / cell);
        for (let dj = -reach; dj <= reach; dj++) for (let di = -reach; di <= reach; di++) for (const [a, b] of buckets.get(`${i0 + di},${j0 + dj}`) ?? []) best = Math.min(best, segmentDistance(c, a, b) - 4);
        return best;
    };
    const spots = [];
    for (let y = Math.min(...ys); y <= Math.max(...ys); y += 20) {
        for (let x = Math.min(...xs); x <= Math.max(...xs); x += 20) {
            const c = [x, y];
            if (!pointInPolygon(c, wall.polygon) || occupancy.at(c) !== FREE) continue;
            if (T.castle && pointInPolygon(c, T.castle.polygon)) continue;
            const r = Math.min(clearance(T, c, 46), wallDistance(wall.polygon, c) - 10, room(c, 46));
            if (r >= FEATURES.PARK_MIN_GAP_M) spots.push({ c, r });
        }
    }
    spots.sort((a, b) => b.r - a.r || a.c[0] - b.c[0] || a.c[1] - b.c[1]);
    for (const s of spots) {
        if (T.parks.length >= wanted) break;
        if (T.parks.some((p) => dist(p.centre, s.c) < p.radius + s.r + 60)) continue;
        if (clearance(T, s.c, s.r) < s.r - 4) continue;
        const park = parkShape(T, s.c, s.r, random);
        occupancy.stampPolygon(park.poly, RESERVED);
        T.parks.push(park);
    }
}

// --------------------------------------------------------------- cemeteries outside the town

/**
 * A town's cemeteries: walled grounds by its roads just beyond its houses (and outside its walls),
 * sized by the people each serves. A village buries in its place of worship's yard.
 */
/**
 * Graves in rows across a rectangle (centre c, its long side along angle), a path left clear down
 * its middle, none where away(p) says so.
 */
function graveRows(c, angle, long, deep, random, away = () => false) {
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    const graves = [];
    for (let u = -long / 2 + 6; u <= long / 2 - 6; u += 4.5) {
        if (Math.abs(u) < 4) continue;
        for (let v = -deep / 2 + 6; v <= deep / 2 - 6; v += 3.2) {
            if (random.chance(0.18)) continue;
            const p = [c[0] + ca * u - sa * v, c[1] + sa * u + ca * v];
            if (away(p)) continue;
            graves.push(rect(p, angle + Math.PI / 2, 1.1, 2.2));
        }
    }
    return graves;
}

/**
 * A churchyard's graves (pre-sign-off, 2026-11-17): rows across the yard of a place of worship
 * flagged churchyard, clear of the building and of the way from its door to the street.
 */
function churchyardGraves(T, random) {
    for (const w of T.worship ?? []) {
        if (!w.churchyard) continue;
        const y = w.yard;
        const c = centroid(y);
        const e1 = dist(y[0], y[1]);
        const e2 = dist(y[1], y[2]);
        const along = e1 >= e2 ? [y[0], y[1]] : [y[1], y[2]];
        const angle = Math.atan2(along[1][1] - along[0][1], along[1][0] - along[0][0]);
        const bc = centroid(w.body[0]);
        // The door faces the nearest street
        let door = null;
        for (const s of T.streets) for (const q of s.points) if (!door || dist(q, bc) < dist(door, bc)) door = q;
        const nearBody = (p) => w.body.some((part) => pointInPolygon(p, part) || part.some((q, k) => segmentDistance(p, q, part[(k + 1) % part.length]) < 3));
        const onPath = (p) => door && segmentDistance(p, bc, door) < 3;
        w.graves = graveRows(c, angle, Math.max(e1, e2) + 4, Math.min(e1, e2) + 4, random, (p) => nearBody(p) || onPath(p)).filter((g) => g.every((q) => pointInPolygon(q, y)));
    }
}

export function buildCemeteries(T) {
    T.cemeteries = [];
    const { input, kind, occupancy, buildings } = T;
    if (input.cave) return;
    const random = T.R("cemeteries");
    churchyardGraves(T, T.R("churchyards"));
    if (kind === "village") return;
    const count = kind === "city" ? Math.min(FEATURES.CEMETERY_MAX, 1 + Math.floor(input.population / FEATURES.CEMETERY_PEOPLE)) : 1;
    const serves = input.population / count;
    const ha = Math.max(FEATURES.CEMETERY_HA[0], Math.min(FEATURES.CEMETERY_HA[1], FEATURES.CEMETERY_HA[0] + serves * FEATURES.CEMETERY_HA_PER_PERSON));
    const area = ha * 10000;
    // The houses, bucketed, to find how far a spot lies beyond them
    const cell = 40;
    const buckets = new Map();
    for (const b of buildings) {
        if (b.kind !== "house") continue;
        const c = b.poly[0];
        const key = `${Math.floor(c[0] / cell)},${Math.floor(c[1] / cell)}`;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(c);
    }
    const nearestHouse = (p, limit) => {
        let best = Infinity;
        const reach = Math.ceil(limit / cell);
        const i0 = Math.floor(p[0] / cell);
        const j0 = Math.floor(p[1] / cell);
        for (let dj = -reach; dj <= reach; dj++) for (let di = -reach; di <= reach; di++) for (const q of buckets.get(`${i0 + di},${j0 + dj}`) ?? []) best = Math.min(best, dist(p, q));
        return best;
    };
    const rings = [T.wall, T.outerWall].filter(Boolean).map((w) => w.polygon);
    const [near, far0] = FEATURES.CEMETERY_BEYOND_M;
    // Where a great city's suburbs leave no ground of the full size by its roads, a smaller one
    // a little further out
    // Each pass's spots are tried before the next, smaller one is looked for
    for (const [shrinkBy, reachBy, nearBy = 1] of [[1, 1], [0.6, 1.6], [0.35, 2.4]]) {
        if (T.cemeteries.length >= count) break;
        const far = far0 * reachBy;
        const candidates = [];
        for (const road of T.roads) {
            const pts = road.points;
            for (let k = 1; k + 1 < pts.length; k += 2) {
                const a = pts[k - 1];
                const b = pts[k + 1];
                const len = dist(a, b) || 1;
                const t = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
                const n = [-t[1], t[0]];
                const long = Math.sqrt(area * shrinkBy * random.range(1.2, 1.7));
                const deep = (area * shrinkBy) / long;
                for (const side of [1, -1]) {
                    const off = road.width / 2 + 6 + deep / 2;
                    const c = [pts[k][0] + n[0] * side * off, pts[k][1] + n[1] * side * off];
                    const d = nearestHouse(c, far + 80);
                    if (d < near * nearBy + deep / 2 || d > far + deep / 2) continue;
                    candidates.push({ c, angle: Math.atan2(t[1], t[0]), long, deep, d, road: pts[k], side });
                }
            }
        }
        // Nearest the town first, with a little chance in the order
        const order = (c) => dist(c.c, T.centre) * (1 + 0.1 * Math.sin(c.c[0] * 0.13 + c.c[1] * 0.07));
        candidates.sort((x, y) => order(x) - order(y));
        placeAll(candidates);
    }

    // A great city whose houses line every road out to the frame: a cemetery in the open ground
    // between its roads, beside no house, with a path to the nearest street
    if (!T.cemeteries.length) {
        const streetPts = T.streets.filter((st) => !st.market).flatMap((st) => st.points);
        const outer = rings.length ? rings[rings.length - 1] : null;
        const r0 = outer ? Math.max(...outer.map((p) => dist(p, T.centre))) : 200;
        const long = Math.sqrt(area * 0.5 * 1.4), deep = (area * 0.5) / long;
        const spots = [];
        for (let r = r0 + 80; r < r0 + 3000 && spots.length < 400; r += 70) {
            for (let k = 0; k < 40; k++) {
                const a = ((k + random.range(-0.3, 0.3)) / 40) * 2 * Math.PI;
                const c = [T.centre[0] + Math.cos(a) * r, T.centre[1] + Math.sin(a) * r];
                if (!T.inFrame(c) || nearestHouse(c, 120) < deep / 2 + 14) continue;
                let best = null;
                for (const q of streetPts) {
                    const d = dist(q, c);
                    if (!best || d < best.d) best = { d, q };
                }
                if (!best || best.d > deep / 2 + 70) continue;
                spots.push({ c, q: best.q, d: best.d });
            }
        }
        for (const sp of spots) {
            if (T.cemeteries.length) break;
            const toward = [(sp.q[0] - sp.c[0]) / sp.d, (sp.q[1] - sp.c[1]) / sp.d];
            const angle = Math.atan2(toward[0], -toward[1]);
            const poly = rect(sp.c, angle, long, deep);
            if (!poly.every((p) => T.inFrame(p) && !T.seaAt(p) && T.wdAt(p) > 8 && rings.every((ring) => !pointInPolygon(p, ring))) || !occupancy.free(poly)) continue;
            const gate = [sp.c[0] + toward[0] * (deep / 2), sp.c[1] + toward[1] * (deep / 2)];
            let clear = true;
            for (let u = 0.05; u < 0.92 && clear; u += 0.05) if (occupancy.at(lerp(gate, sp.q, u)) !== FREE) clear = false;
            if (!clear) continue;
            occupancy.stampPolygon(poly, RESERVED);
            occupancy.stampPolyline([gate, sp.q], 1.5, STREET);
            T.streets.push({ points: [sp.q, gate], half: 1.5, rank: 2, lane: true, path: true });
            const back = [sp.c[0] - toward[0] * (deep / 2 - 8), sp.c[1] - toward[1] * (deep / 2 - 8)];
            const chapel = rect(lerp(back, sp.c, 0.15), Math.atan2(toward[1], toward[0]), 12, 7);
            const inner = rect(sp.c, angle, long - 6, deep - 6);
            const chapelAt = lerp(back, sp.c, 0.15);
            const graves = graveRows(sp.c, angle, long, deep, T.R("cemetery-fallback"), (p) => dist(p, chapelAt) < 10);
            T.cemeteries.push({ poly, centre: sp.c, angle, graves, trees: inner.map((q) => [q[0], q[1], 3]), path: [gate, back], gate, chapel, areaHa: +(polygonArea(poly) / 10000).toFixed(2) });
        }
    }
    function placeAll(candidates) {
        for (const cand of candidates) {
            if (T.cemeteries.length >= count) break;
            if (T.cemeteries.some((c) => dist(c.centre, cand.c) < 250)) continue;
            const poly = rect(cand.c, cand.angle, cand.long, cand.deep);
            if (!poly.every((p) => T.inFrame(p) && !T.seaAt(p) && T.wdAt(p) > 8 && rings.every((ring) => !pointInPolygon(p, ring)))) continue;
            if (!occupancy.free(poly)) continue;
            if (poly.some((p) => nearestHouse(p, 40) < 12)) continue;
            occupancy.stampPolygon(poly, RESERVED);
            // Graves in rows across it, a path down the middle from the gate on the road, and a chapel
            const ca = Math.cos(cand.angle);
            const sa = Math.sin(cand.angle);
            const toRoad = [sa * cand.side, -ca * cand.side];
            const gate = [cand.c[0] + toRoad[0] * (cand.deep / 2), cand.c[1] + toRoad[1] * (cand.deep / 2)];
            const back = [cand.c[0] - toRoad[0] * (cand.deep / 2 - 8), cand.c[1] - toRoad[1] * (cand.deep / 2 - 8)];
            const chapelAt = lerp(back, cand.c, 0.15);
            const chapel = rect(chapelAt, Math.atan2(toRoad[1], toRoad[0]), 12, 7);
            const graves = [];
            for (let u = -cand.long / 2 + 6; u <= cand.long / 2 - 6; u += 4.5) {
                if (Math.abs(u) < 4) continue;
                for (let v = -cand.deep / 2 + 6; v <= cand.deep / 2 - 6; v += 3.2) {
                    if (random.chance(0.18)) continue;
                    const p = [cand.c[0] + ca * u - sa * v, cand.c[1] + sa * u + ca * v];
                    if (dist(p, chapelAt) < 10) continue;
                    graves.push(rect(p, cand.angle + Math.PI / 2, 1.1, 2.2));
                }
            }
            // Yews at its corners and a few along its wall
            const inner = rect(cand.c, cand.angle, cand.long - 6, cand.deep - 6);
            const trees = inner.map((q) => [q[0], q[1], random.range(2.6, 3.6)]);
            for (let k = 0; k < 4; k++) if (random.chance(0.6)) trees.push([...lerp(inner[k], inner[(k + 1) % 4], random.range(0.25, 0.75)), random.range(2.4, 3.2)]);
            T.cemeteries.push({ poly, centre: cand.c, angle: cand.angle, graves, trees, path: [gate, back], gate, chapel, areaHa: +(polygonArea(poly) / 10000).toFixed(2) });
        }
    }
}
