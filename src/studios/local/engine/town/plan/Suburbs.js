// The suburbs in the plan-first core: quarters along the roads beyond the gates. Their ground is
// what a growth cost reaches from the gates, cheapest along the roads, then open ground (no cheaper
// foot of the wall, so no rings: Ken, 2026-11-14), sized for the people outside. Off each road a
// ladder of lanes: side lanes square to it every so often, and back lanes between neighbouring
// side lanes at a block's depth (and again further out in a city), so the suburbs fill in blocks
// from the road outwards; a side lane no back lane meets is a close.
import { MinHeap } from "../../../../../kernel/util/MinHeap.js";
import { centroid, chaikin, dist, distanceTransform, insideCuts, lerp, pointInPolygon, polygonCuts, resample, segmentDistance, segmentIndex, stageRandom } from "../../Geometry.js";
import { gatesOf, rect, towersOf } from "../Walls.js";
import { worshipShape } from "../MarketWorship.js";
import { RESERVED, STREET } from "../Occupancy.js";
import { cutRingBlocks, dryOver } from "./Plan.js";
import { growFaubourgs } from "./Faubourgs.js";

export const SUBURBS = Object.freeze({
    /** People per hectare of suburban ground, and how much more ground than the houses need. */
    DENSITY: 150,
    ROOM: 1.5,
    /** Growth cost of a metre: along a road, over open ground; its wander, and over what distance (m). */
    COST: Object.freeze({ road: 1.2, open: 2.6 }),
    WANDER: 0.5,
    WANDER_M: 500,
    /** A block's depth from a road to its back lane (m), side lanes every so many metres, the first
     * this far out from the gate, and how many back lanes deep a ladder may go. */
    DEPTH: Object.freeze({ town: [46, 56], city: [42, 52] }),
    SPACING: Object.freeze({ town: [95, 140], city: [80, 115] }),
    FIRST: [25, 55],
    RUNGS: Object.freeze({ town: 2, city: 3 }),
    /** Lanes keep this far (m) from other ways and from the wall. */
    CLEAR: 14,
    /** The growth cost the wall's foot starts at (the gates start at nothing). */
    WALL_START: 20,
    /** Back lanes behind the roads' side lanes (the web has taken their place). */
    RAILS: false,
    /** The web: spokes about this far apart (m) at the wall, cross lanes between two spokes this far
     * (m) out for the first, then this far apart, each pair its own; a share left out. */
    SPOKE_APART: Object.freeze({ town: [120, 170], city: [100, 150] }),
    WEB_FIRST: [35, 65],
    WEB_STEP: Object.freeze({ town: [55, 95], city: [48, 85] }),
    WEB_SKIP: 0.12,
    /** Focal points between a great city's rings: one per so many hectares of that ground; lanes
     * from their squares this long (m); the middle tier within this distance (m) of them. */
    FOCAL_HA: 28,
    FOCAL_LANE: [60, 140],
    FOCAL_MIDDLE_M: 110,
    /** Beyond the outermost wall, by distance (m) from it: packed small houses with cottages in their
     * yards, then joined small houses, then pairs on garden plots, then cottages on crofts. */
    VALUE_BANDS: Object.freeze({ town: [60, 160, 320], city: [110, 300, 620] }),
    /** A track along the wall's foot from each gate, so far (m) each way, so far (m) out from it. */
    FOOT_M: Object.freeze({ town: [90, 200], city: [160, 380] }),
    FOOT_OFF: [26, 40],
    WEB_SAG: 0.06,
    SPOKE_WANDER: 0.35,
    RUNG_SKEW: 0.22,
    WALL_CLEAR: 16,
    LANE_HALF: 2.25,
    /** Terraced high streets along a road within this distance (m) of its gate. */
    HIGH_STREET_M: Object.freeze({ town: 140, city: 450 }),
    /** People per suburban place of worship (a city's). */
    WORSHIP_PEOPLE: 5600,
    /** Larger homes within this distance (m) of a suburban place of worship. */
    UPPER_NEAR_WORSHIP_M: 90,
    /** A great city's outer wall, thrown round its grown suburbs: the share of the people it takes
     * in between the rings, at this many to the hectare; at least this far (m) from the old wall;
     * the share of the grown ground in each direction it takes in; corners. */
    OUTER: Object.freeze({ share: 0.4, density: 200, clear: 90, quantile: 0.8, bins: 72, corners: 24, smooth: 3 }),
});

export function buildPlanSuburbs(T, ring) {
    const { input, kind, plan, occupancy, castle, NX, NY, g, W, H } = T;
    const random = T.R("plan-suburbs");
    const share = T.wall ? T.wall.share : 0.8;
    const outsidePeople = input.population * (1 - share);
    const needM2 = (outsidePeople / SUBURBS.DENSITY) * 10000;
    const cells = NX * NY;
    const cellX = (i) => -W / 2 + (i + 0.5) * g;
    const cellY = (j) => -H / 2 + (j + 0.5) * g;
    // Roads beyond the ring, each from its gate outwards
    const outward = [...T.roads.filter((r) => r.outside), ...plan.lesserRoads].map((road) => ({ road, points: [...road.outside].reverse() }));
    const roadCells = new Uint8Array(cells);
    for (const { points } of outward) {
        for (let k = 0; k + 1 < points.length; k++) {
            const steps = Math.ceil(dist(points[k], points[k + 1]) / (g * 0.5)) + 1;
            for (let t = 0; t <= steps; t++) {
                const c = T.cellOf(lerp(points[k], points[k + 1], t / steps));
                if (c >= 0) roadCells[c] = 1;
            }
        }
    }
    const insideGrid = new Uint8Array(cells);
    const withinOuter = new Uint8Array(cells);
    const dryGrid = new Uint8Array(cells);
    const ringSeeds = new Uint8Array(cells);
    for (let j = 0; j < NY; j++) {
        const y = cellY(j);
        const cuts = polygonCuts(ring, y);
        const outerCuts = T.outerWall ? polygonCuts(T.outerWall.polygon, y) : null;
        const castleCuts = castle ? polygonCuts(castle.polygon, y) : null;
        for (let i = 0; i < NX; i++) {
            const k = j * NX + i;
            const p = [cellX(i), y];
            insideGrid[k] = insideCuts(cuts, p[0]) ? 1 : 0;
            withinOuter[k] = outerCuts && insideCuts(outerCuts, p[0]) ? 1 : 0;
            dryGrid[k] = T.wdAt(p) > 8 && !(castleCuts && insideCuts(castleCuts, p[0])) ? 1 : 0;
        }
    }
    for (let k = 0; k < cells; k++) {
        const i = k % NX, j = (k / NX) | 0;
        if (!insideGrid[k]) continue;
        if ((i > 0 && !insideGrid[k - 1]) || (i < NX - 1 && !insideGrid[k + 1]) || (j > 0 && !insideGrid[k - NX]) || (j < NY - 1 && !insideGrid[k + NX])) ringSeeds[k] = 1;
    }
    const fromRing = distanceTransform(ringSeeds, NX, NY);
    const stepCost = new Float32Array(cells);
    for (let k = 0; k < cells; k++) {
        stepCost[k] = roadCells[k] ? SUBURBS.COST.road : SUBURBS.COST.open;
        stepCost[k] *= 1 + SUBURBS.WANDER * (T.noise.value(cellX(k % NX) / SUBURBS.WANDER_M + 13.1, cellY((k / NX) | 0) / SUBURBS.WANDER_M - 2.9) - 0.5);
    }
    const DI = [1, -1, 0, 0, 1, 1, -1, -1];
    const DJ = [0, 0, 1, -1, 1, -1, 1, -1];
    const LEN = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];
    // The growth cost from the gates (and the focal points, and later the wall's foot)
    const grow = (focalPoints) => {
        const cost = new Float64Array(cells).fill(Infinity);
        const heap = new MinHeap();
        for (const f of focalPoints) {
            const k = T.cellOf(f.p);
            if (k >= 0) {
                cost[k] = 0;
                heap.push(0, k);
            }
        }
        for (const gate of plan.gates) {
            const d = [Math.cos(gate.dir ?? 0), Math.sin(gate.dir ?? 0)];
            const out = [[gate.p[0] + d[0] * g * 2, gate.p[1] + d[1] * g * 2], [gate.p[0] - d[0] * g * 2, gate.p[1] - d[1] * g * 2]].find((q) => !pointInPolygon(q, ring));
            const k = out ? T.cellOf(out) : -1;
            if (k >= 0) {
                cost[k] = 0;
                heap.push(0, k);
            }
        }
        // The ground at the wall's foot grows too, later than the roads from the gates (Ken: the
        // suburbs spread round the walls in every direction, reaching furthest along the roads)
        for (let k = 0; k < cells; k++) if (!insideGrid[k] && fromRing[k] <= 1.5 && dryGrid[k]) {
            const start = heap.size ? SUBURBS.WALL_START : 0;
            if (start < cost[k]) {
                cost[k] = start;
                heap.push(start, k);
            }
        }
        while (heap.size) {
            const k = heap.pop();
            if (heap.lastPriority > cost[k]) continue;
            const i = k % NX, j = (k / NX) | 0;
            for (let s = 0; s < 8; s++) {
                const ni = i + DI[s], nj = j + DJ[s];
                if (ni < 0 || nj < 0 || ni >= NX || nj >= NY) continue;
                const m = nj * NX + ni;
                if (insideGrid[m] || !dryGrid[m]) continue;
                const c = cost[k] + LEN[s] * g * stepCost[m];
                if (c < cost[m]) {
                    cost[m] = c;
                    heap.push(c, m);
                }
            }
        }
        return cost;
    };
    // ------------------------------------------------------------ a great city's outer wall
    // (Ken, 2026-11-15: thrown round the suburbs that grew outside the old wall, not laid out
    // ahead of them, so the ground between the rings is built up)
    if (plan.outerWanted) {
        T.outerWall = outerWallRound(T, ring, grow([]), { cells, cellX, cellY, insideGrid, dryGrid });
        for (let j = 0; j < NY; j++) {
            const cuts = polygonCuts(T.outerWall.polygon, cellY(j));
            for (let i = 0; i < NX; i++) withinOuter[j * NX + i] = insideCuts(cuts, cellX(i)) ? 1 : 0;
        }
    }
    // ------------------------------------------------------------ focal points between two rings
    // (Ken: the ground inside a great city's outer wall is laid out as suburbs grown from focal
    // points of their own: a square with a place of worship beside it, each a growth source)
    const focals = T.outerWall ? placeFocals(T, ring, outward, random) : [];
    plan.squares = focals.map((f) => f.plaza);
    const cost = grow(focals);
    const zoneArea = (limit) => {
        let n = 0;
        for (let k = 0; k < cells; k++) if (!insideGrid[k] && dryGrid[k] && (withinOuter[k] || cost[k] < limit)) n++;
        return n * g * g;
    };
    let lo = 10, hi = (W + H) * SUBURBS.COST.open;
    for (let s = 0; s < 22; s++) {
        const mid = (lo + hi) / 2;
        if (zoneArea(mid) < needM2 * SUBURBS.ROOM) lo = mid;
        else hi = mid;
    }
    const R0 = (lo + hi) / 2;
    const zone = new Uint8Array(cells);
    for (let k = 0; k < cells; k++) zone[k] = !insideGrid[k] && dryGrid[k] && (withinOuter[k] || cost[k] < R0) ? 1 : 0;
    T.suburbReach = R0;
    T.suburbAt = (p) => {
        const k = T.cellOf(p);
        return k >= 0 && zone[k] === 1;
    };
    T.suburbRank = (p) => {
        const k = T.cellOf(p);
        if (k < 0) return 1e9;
        const c = Number.isFinite(cost[k]) ? cost[k] : fromRing[k] * g * SUBURBS.COST.open + R0;
        // Inside a great city's outer wall the ground fills before the roads beyond it
        return withinOuter[k] ? c * 0.02 : c;
    };
    // ------------------------------------------------------------ ladders off the roads
    const BUCKET = 20;
    const taken = new Map();
    const keyOf = (i, j) => i * 100003 + j;
    const add = (points, id) => {
        for (const p of resample(points, 5)) {
            const key = keyOf(Math.floor(p[0] / BUCKET), Math.floor(p[1] / BUCKET));
            if (!taken.has(key)) taken.set(key, []);
            taken.get(key).push({ p, id });
        }
    };
    const clearOf = (p, ids, within) => {
        const i = Math.floor(p[0] / BUCKET), j = Math.floor(p[1] / BUCKET);
        for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (const q of taken.get(keyOf(i + di, j + dj)) ?? []) if (!ids.has(q.id) && dist(q.p, p) < within) return false;
        return true;
    };
    outward.forEach(({ points }, r) => add(points, `road${r}`));
    // Beyond the web, along the roads: side lanes one block deep (closes), no back lanes
    const lanes = [];
    // The web: spokes out from the walls (the roads, and lanes between them) joined by cross lanes
    // at depths of their own between each pair, so the suburbs close round the walls in irregular
    // blocks and never in rings; the ladders below then add closes along the roads beyond it
    // Each focal point's square is a frontage, with lanes out from its corners and one to the
    // nearest road, before the web, so the web's lanes keep clear of them
    for (const [fi, f] of focals.entries()) {
        T.streets.push({ points: [...f.plaza, f.plaza[0]], half: 1.5, rank: 1, market: true, square: true });
        const ids = new Set([`focal${fi}`]);
        const c = f.p;
        const star = [];
        for (const q of f.plaza) {
            const d = dist(q, c) || 1;
            const u = [(q[0] - c[0]) / d, (q[1] - c[1]) / d];
            const len = random.range(SUBURBS.FOCAL_LANE[0], SUBURBS.FOCAL_LANE[1]);
            const pts = [q];
            for (let s2 = 8; s2 <= len; s2 += 8) {
                const r = [q[0] + u[0] * s2, q[1] + u[1] * s2];
                if (!T.inFrame(r) || T.wdAt(r) < 10 || !T.suburbAt(r) || pointInPolygon(r, ring) || nearRing2(r, ring, SUBURBS.WALL_CLEAR) || nearRing2(r, T.outerWall.polygon, 14)) break;
                pts.push(r);
            }
            if (pts.length >= 4) star.push({ points: pts, id: `focal${fi}-${star.length}`, focal: true });
        }
        // The way to the nearest road
        let best = null;
        for (const { points } of outward) for (const q of points) if (!pointInPolygon(q, ring) && pointInPolygon(q, T.outerWall.polygon)) {
            const d = dist(q, c);
            if (!best || d < best.d) best = { d, q };
        }
        if (best && best.d < 500) {
            const from = f.plaza.reduce((a2, q) => (dist(q, best.q) < dist(a2, best.q) ? q : a2));
            star.push({ points: [from, lerp(from, best.q, 0.5), best.q], id: `focal${fi}-road`, focal: true });
        }
        for (const l of star) {
            lanes.push(l);
            add(l.points, l.id);
        }
        void ids;
    }
    const web = buildWeb({ T, random, outward, ring, taken: { add, clearOf }, kind });
    for (const lane of web) lanes.push(lane);
    for (const l of web) add(l.points, l.id);
    // ------------------------------------------------------------ beyond the outermost wall
    // (Ken, 2026-11-15): lanes grown off the roads and then off each other, following the old
    // fields' strips; closest by the wall, where the land is cheapest
    const outerRing = T.outerWall ? T.outerWall.polygon : ring;
    const outerSeeds = new Uint8Array(cells);
    for (let k = 0; k < cells; k++) {
        const inside = T.outerWall ? withinOuter[k] || insideGrid[k] : insideGrid[k];
        if (!inside) continue;
        const i = k % NX, j = (k / NX) | 0;
        const inn = (m) => (T.outerWall ? withinOuter[m] || insideGrid[m] : insideGrid[m]);
        if ((i > 0 && !inn(k - 1)) || (i < NX - 1 && !inn(k + 1)) || (j > 0 && !inn(k - NX)) || (j < NY - 1 && !inn(k + NX))) outerSeeds[k] = 1;
    }
    const fromOuter = T.outerWall ? distanceTransform(outerSeeds, NX, NY) : fromRing;
    const wallDist = (p) => {
        const k = T.cellOf(p);
        return k >= 0 ? fromOuter[k] * g : 1e9;
    };
    T.outerWallDist = wallDist;
    const okOut = (p) => T.inFrame(p) && T.suburbAt(p) && T.wdAt(p) > 10 && !pointInPolygon(p, outerRing) && !nearRing2(p, outerRing, SUBURBS.WALL_CLEAR) && !pointInPolygon(p, ring);
    const roadPoints = [];
    for (const { points } of outward) {
        for (let k = 1; k < points.length; k++) {
            const L = dist(points[k - 1], points[k]) || 1;
            roadPoints.push({ p: points[k], t: [(points[k][0] - points[k - 1][0]) / L, (points[k][1] - points[k - 1][1]) / L] });
        }
    }
    const nearPt = (p, ids, within) => {
        const i = Math.floor(p[0] / BUCKET), j = Math.floor(p[1] / BUCKET);
        let best = null;
        for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (const q of taken.get(keyOf(i + di, j + dj)) ?? []) {
            if (ids.has(q.id)) continue;
            const d = dist(q.p, p);
            if (d < within && (!best || d < best.d)) best = { d, p: q.p };
        }
        return best ? best.p : null;
    };
    // Tracks along the foot of the wall from each gate, some way each side (never all round, so
    // never a ring), as lanes grew round the outside of a wall from its gates
    const foots = [];
    {
        const gatesOut = (T.outerWall ? T.outerWall.gates : plan.gates).map((gt) => gt.p);
        const C = centroid(outerRing);
        const L = outerRing.length;
        // The wall's line, densely
        const line = resample([...outerRing, outerRing[0]], 6);
        const nearestIdx = (p) => line.reduce((best, q, k) => (dist(q, p) < dist(line[best], p) ? k : best), 0);
        void L;
        for (const [gi, gp] of gatesOut.entries()) {
            const k0 = nearestIdx(gp);
            for (const dir of [1, -1]) {
                const reach = random.range(SUBURBS.FOOT_M[kind][0], SUBURBS.FOOT_M[kind][1]);
                const off0 = random.range(SUBURBS.FOOT_OFF[0], SUBURBS.FOOT_OFF[1]);
                const pts = [];
                for (let s2 = 0, k = k0; s2 < reach; s2 += 6, k = (k + dir + line.length) % line.length) {
                    const q = line[k];
                    const d = dist(q, C) || 1;
                    const off = off0 + 8 * (T.noise.value(q[0] / 120 + gi * 7.3, q[1] / 120 - dir) - 0.5);
                    const r = [q[0] + ((q[0] - C[0]) / d) * off, q[1] + ((q[1] - C[1]) / d) * off];
                    if (s2 > 20 && !okOut(r)) break;
                    pts.push(r);
                }
                if (pts.length >= 10) foots.push({ points: chaikin(pts, 2), id: `foot${gi}-${dir}`, half: SUBURBS.LANE_HALF });
            }
        }
    }
    for (const f of foots) {
        add(f.points, f.id);
        lanes.push({ points: f.points, id: f.id, faubourg: true, foot: true });
    }
    const faubourgs = growFaubourgs({
        T, random, kind, ok: okOut, wallDist, roadPoints,
        taken: { add, near: nearPt },
        starts: [...outward.map(({ road, points }, r) => ({ points: resample(points, 4), id: `road${r}`, half: road.width / 2 })), ...foots],
    });
    for (const lane of faubourgs) lanes.push(lane);
    // Between the rings, blocks cut by lanes as the walled town's are, until its frontage houses
    // its share of the people (Ken, 2026-11-15)
    if (T.outerWall) {
        const ways = [...outward.map(({ points, road }) => ({ points, half: road.width / 2, rank: 0 })), ...lanes.map((l) => ({ points: l.points, half: SUBURBS.LANE_HALF, rank: 2 }))];
        const houses = Math.round((input.population * SUBURBS.OUTER.share) / T.P.perBuilding);
        const cuts = cutRingBlocks(T, { outer: T.outerWall.polygon, inner: ring, ways, squares: plan.squares, houses, plotW: 10.5 });
        cuts.forEach((points, k) => lanes.push({ points, id: `ring${k}`, ringLane: true }));
    }
    for (const l of lanes) {
        const street = { points: l.points, half: SUBURBS.LANE_HALF, rank: 2, suburb: true, lane: true, plan: l.web ? "web" : l.spoke ? "spoke" : l.rail ? "rail" : l.faubourg ? "faubourg" : "rung", close: !!l.close, grown: !!l.faubourg };
        T.streets.push(street);
        occupancy.stampPolyline(l.points, SUBURBS.LANE_HALF, STREET);
    }
    plan.suburbLanes = lanes.length;
    // ------------------------------------------------------------ places of worship in a city's suburbs
    const worshipC = [];
    if (kind === "city") {
        const wanted = Math.round(outsidePeople / SUBURBS.WORSHIP_PEOPLE);
        const rails = lanes.filter((l) => l.web || (l.rail && l.depth === 1)).sort((a, b) => T.suburbRank(a.points[0]) - T.suburbRank(b.points[0]));
        const spacing = 380;
        for (const l of rails) {
            if (worshipC.length >= wanted) break;
            const m = l.points[Math.floor(l.points.length / 2)];
            if ([...worshipC, ...T.worship.map((w) => centroid(w.yard))].some((q) => dist(q, m) < spacing)) continue;
            // Between a great city's rings the focal points have theirs
            if (T.outerWall && pointInPolygon(m, T.outerWall.polygon)) continue;
            const a = l.points[0], b = l.points[l.points.length - 1];
            const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
            const n = [-Math.sin(angle), Math.cos(angle)];
            for (const side of [1, -1]) {
                const c = [m[0] + n[0] * side * 24, m[1] + n[1] * side * 24];
                const yard = rect(c, angle, 52, 36);
                if (!occupancy.free(yard) || !yard.every((p) => T.suburbAt(p)) || !dryOver(T, yard, 4)) continue;
                occupancy.stampPolygon(yard, RESERVED);
                T.worship.push({ yard, body: worshipShape(c, angle, 30, 12, false), label: "local", suburb: true });
                worshipC.push(c);
                break;
            }
        }
    }
    // ------------------------------------------------------------ suburban styles
    const highM = SUBURBS.HIGH_STREET_M[kind];
    const gateDist = (p) => Math.min(...plan.gates.map((gt) => dist(gt.p, p)));
    const outerPoly = T.outerWall?.polygon;
    plan.suburbStyle = (p) => {
        // Round a focal point's square, its shops and inns; elsewhere inside the outer wall, the
        // lower tier's joined houses
        if (focals.some((f) => dist(f.p, p) < SUBURBS.FOCAL_MIDDLE_M)) return { tier: "middle", plotW: [5.5, 8.5], depth: [11, 15], terrace: true, rich: 1.15, ranges: 0.7, suburb: true, high: true };
        // Between the rings (Ken, 2026-11-15): the middle tier's ground. Terraces along the roads;
        // elsewhere pairs of houses on wider plots with gardens behind, and here and there a
        // detached house on a larger plot
        if (outerPoly && pointInPolygon(p, outerPoly)) {
            if (roadNear(outward, p, 14)) return { tier: "middle", plotW: [6, 9], depth: [11, 15], terrace: true, rich: 1.2, ranges: 0.7, suburb: true, high: true };
            if (T.noise.value(p[0] / 140 + 31.7, p[1] / 140 - 8.3) > 0.68) return { tier: "middle", plotW: [14, 19], depth: [10, 13], terrace: false, detached: [0.55, 0.7], setback: [2, 5], rich: 1.35, ranges: 0.5, suburb: true, high: true, plotDepth: [22, 30] };
            return { tier: "middle", plotW: [9, 12.5], depth: [10, 13], terrace: false, semi: true, rich: 1.2, ranges: 0.4, suburb: true, high: true, plotDepth: [18, 26] };
        }
        if (worshipC.some((c) => dist(c, p) < SUBURBS.UPPER_NEAR_WORSHIP_M)) return { tier: "upper", plotW: [16, 24], depth: [11, 15], terrace: false, detached: [0.5, 0.7], setback: [3, 6], rich: 1.4, ranges: 0.6, suburb: true };
        // Beyond the outermost wall, by the land's value (Ken, 2026-11-15): dearer by the gates and
        // along the roads; cheapest by the wall, where small houses are packed close with cottages
        // in their yards (the slums, and where newcomers first stay), plots growing with distance
        // into cottages with gardens and then crofts
        if (gateDist(p) < highM && roadNear(outward, p, 14)) return { tier: "middle", plotW: kind === "city" ? [5.5, 8.5] : [6.5, 10], depth: [10, 14], terrace: true, rich: 1.15, ranges: 0.6, suburb: true, high: true };
        const [b0, b1, b2] = SUBURBS.VALUE_BANDS[kind];
        const dw = T.outerWallDist ? T.outerWallDist(p) : 0;
        if (dw < b0) return { tier: "lower", plotW: [4, 5.5], depth: [7, 10], terrace: true, backs: true, rich: 0.8, ranges: 0.2, suburb: true, high: true, slum: true };
        if (dw < b1) return { tier: "lower", plotW: [5, 7], depth: [8, 11], terrace: true, rich: 1, ranges: 0.4, suburb: true, high: true };
        if (roadNear(outward, p, 14)) return { tier: "lower", plotW: [6, 9], depth: [9, 12], terrace: true, rich: 1.1, ranges: 0.5, suburb: true, high: true };
        if (dw < b2) return { tier: "lower", plotW: [8, 11], depth: [8, 10], terrace: false, semi: true, rich: 1, ranges: 0.3, suburb: true, high: true, plotDepth: [16, 24] };
        return { tier: "lower", plotW: [13, 20], depth: [8, 10], terrace: false, detached: [0.4, 0.55], setback: [2, 6], rich: 1.05, ranges: 0.4, suburb: true, high: true, plotDepth: [30, 45] };
    };
}

/** The roads' segments, indexed once per set of roads (V6). */
const ROAD_INDEX = new WeakMap();
const ROAD_REACH_M = 20;

function roadNear(outward, p, within) {
    if (within > ROAD_REACH_M) {
        for (const { points } of outward) for (let k = 0; k + 1 < points.length; k++) if (segmentDistance(p, points[k], points[k + 1]) < within) return true;
        return false;
    }
    let index = ROAD_INDEX.get(outward);
    if (!index) ROAD_INDEX.set(outward, (index = segmentIndex(outward.flatMap(({ points }) => points.slice(1).map((b, k) => ({ a: points[k], b }))), ROAD_REACH_M)));
    return index.near(p, within);
}

function nearRing2(p, ring, within) {
    for (let k = 0; k < ring.length; k++) if (segmentDistance(p, ring[k], ring[(k + 1) % ring.length]) < within) return true;
    return false;
}

/**
 * The web round a ring of walls: the roads beyond its gates are its spokes, and more spokes run
 * out between them (radially, wandering a little) from just beyond the wall's foot; between each
 * pair of neighbouring spokes cross lanes at depths drawn afresh for that pair, so no two pairs'
 * lanes line up into a ring. A spoke is trimmed to the cross lanes that meet it (a short tail beyond
 * the last is a close), and dropped if none meets it.
 */
function buildWeb({ T, random, outward, ring, taken, kind }) {
    const lanes = [];
    // Only between a great city's rings: beyond the outermost wall the suburbs grow as faubourgs
    // (Faubourgs.js)
    const bases = T.outerWall ? [{ ring, bound: T.outerWall.polygon }] : [];
    for (const [bi, base] of bases.entries()) {
        const O = centroid(base.ring);
        const ringD = (p) => {
            let d = Infinity;
            for (let k = 0; k < base.ring.length; k++) d = Math.min(d, segmentDistance(p, base.ring[k], base.ring[(k + 1) % base.ring.length]));
            return d;
        };
        const inBound = (p) => !base.bound || (pointInPolygon(p, base.bound) && !nearRing2(p, base.bound, 14));
        const ok = (p, ids) => T.inFrame(p) && T.suburbAt(p) && T.wdAt(p) > 10 && !pointInPolygon(p, base.ring) && ringD(p) >= SUBURBS.WALL_CLEAR && inBound(p) && !(T.castle && pointInPolygon(p, T.castle.polygon)) && taken.clearOf(p, ids, SUBURBS.CLEAR);
        // Spokes: the roads beyond this ring's gates, as far as the next ring
        const spokes = [];
        outward.forEach(({ points }, r) => {
            const line = resample(points, 4);
            const part = [];
            for (const p of line) {
                if (pointInPolygon(p, base.ring)) {
                    if (part.length) break;
                    continue;
                }
                if (base.bound && !pointInPolygon(p, base.bound)) break;
                part.push(p);
            }
            if (part.length < 5) return;
            const probe = part[Math.min(part.length - 1, 15)];
            spokes.push({ id: `road${r}`, road: true, points: part, depth: part.map(ringD), angle: Math.atan2(probe[1] - O[1], probe[0] - O[0]) });
        });
        // More spokes in the gaps between them
        const radius = Math.sqrt(Math.abs(polygonAreaOf(base.ring)) / Math.PI);
        const [a0, a1] = SUBURBS.SPOKE_APART[kind];
        const roadAngles = spokes.map((sp) => sp.angle).sort((a, b) => a - b);
        const gaps = roadAngles.length ? roadAngles.map((a, k) => [a, k + 1 < roadAngles.length ? roadAngles[k + 1] : roadAngles[0] + 2 * Math.PI]) : [[0, 2 * Math.PI]];
        let n = 0;
        for (const [from, to] of gaps) {
            const arc = (to - from) * (radius + 60);
            const count = Math.max(0, Math.round(arc / random.range(a0, a1)) - 1);
            for (let c = 1; c <= count; c++) {
                const a = from + ((to - from) * (c + random.range(-0.2, 0.2))) / (count + 1);
                const hit = rayHit(O, a, base.ring);
                if (!hit) continue;
                const id = `spoke${bi}-${n++}`;
                const ids = new Set([id]);
                const out = [Math.cos(a), Math.sin(a)];
                let p = [hit[0] + out[0] * (SUBURBS.WALL_CLEAR + 3), hit[1] + out[1] * (SUBURBS.WALL_CLEAR + 3)];
                if (!ok(p, ids)) continue;
                const pts = [p];
                const phase = random.range(0, 100);
                for (let step = 0; step < 400; step++) {
                    const radial = Math.atan2(p[1] - O[1], p[0] - O[0]);
                    const turn = SUBURBS.SPOKE_WANDER * (T.noise.value(phase + step * 0.06, phase) - 0.5) * 2;
                    const q = [p[0] + Math.cos(radial + turn) * 8, p[1] + Math.sin(radial + turn) * 8];
                    if (!ok(q, ids)) break;
                    pts.push(q);
                    p = q;
                }
                if (pts.length < 7) continue;
                const line = resample(chaikin(pts, 2), 4);
                spokes.push({ id, road: false, points: line, depth: line.map(ringD), angle: a });
            }
        }
        spokes.sort((a, b) => a.angle - b.angle);
        const atDepth = (sp, t) => {
            for (let k = 0; k < sp.points.length; k++) if (sp.depth[k] >= t) return k;
            return -1;
        };
        const [w0, w1] = SUBURBS.WEB_STEP[kind];
        const meets = new Map(spokes.map((sp) => [sp.id, []]));
        for (let k = 0; k < spokes.length; k++) {
            const A = spokes[k], B = spokes[(k + 1) % spokes.length];
            if (A === B) break;
            let gap = B.angle - A.angle;
            if (gap <= 0) gap += 2 * Math.PI;
            if (gap > 1.6) continue;
            let t = random.range(SUBURBS.WEB_FIRST[0], SUBURBS.WEB_FIRST[1]);
            for (let guard = 0; guard < 60; guard++, t += random.range(w0, w1)) {
                const ia = atDepth(A, t), ib = atDepth(B, t);
                if (ia < 0 || ib < 0) break;
                if (random.chance(SUBURBS.WEB_SKIP) && guard > 0) continue;
                const pa = A.points[ia], pb = B.points[ib];
                const L = dist(pa, pb);
                if (L < 25 || L > 320) continue;
                // It sags a little towards the town, as a web's threads do
                const m = lerp(pa, pb, 0.5);
                const dm = dist(m, O) || 1;
                const mid = [m[0] - ((m[0] - O[0]) / dm) * L * SUBURBS.WEB_SAG, m[1] - ((m[1] - O[1]) / dm) * L * SUBURBS.WEB_SAG];
                const id = `web${bi}-${k}-${guard}`;
                const ids = new Set([A.id, B.id, id]);
                const pts = [pa, lerp(pa, mid, 0.5), mid, lerp(mid, pb, 0.5), pb];
                let fine = true;
                const dense = resample(pts, 5);
                for (const q of dense.slice(2, -2)) if (!ok(q, ids)) {
                    fine = false;
                    break;
                }
                if (!fine) continue;
                const line = chaikin(pts, 2);
                lanes.push({ points: line, id, web: true });
                taken.add(line, id);
                meets.get(A.id).push(ia);
                meets.get(B.id).push(ib);
            }
        }
        // Spokes cut to the lanes that meet them; a tail beyond the last is a close
        for (const sp of spokes) {
            if (sp.road) continue;
            const at = meets.get(sp.id);
            if (!at.length) continue;
            const first = Math.min(...at), last = Math.max(...at);
            const tail = Math.min(sp.points.length - 1, last + Math.round(random.range(0, 8)));
            // (from the wall's foot: a spoke runs in towards the wall, so the suburbs reach it
            // along their spokes without a lane round it)
            void first;
            const pts = sp.points.slice(0, tail + 1);
            if (pts.length < 3) continue;
            lanes.push({ points: pts, id: sp.id, spoke: true, close: tail > last + 2 });
            taken.add(pts, sp.id);
        }
    }
    return lanes;
}

function rayHit(o, a, ring) {
    const far = [o[0] + Math.cos(a) * 1e5, o[1] + Math.sin(a) * 1e5];
    let best = null;
    for (let k = 0; k < ring.length; k++) {
        const p = ring[k], q = ring[(k + 1) % ring.length];
        const r = [far[0] - o[0], far[1] - o[1]], s2 = [q[0] - p[0], q[1] - p[1]];
        const den = r[0] * s2[1] - r[1] * s2[0];
        if (Math.abs(den) < 1e-9) continue;
        const t = ((p[0] - o[0]) * s2[1] - (p[1] - o[1]) * s2[0]) / den;
        const u = ((p[0] - o[0]) * r[1] - (p[1] - o[1]) * r[0]) / den;
        if (t >= 0 && u >= 0 && u <= 1 && (!best || t < best.t)) best = { t, p: [o[0] + r[0] * t, o[1] + r[1] * t] };
    }
    return best ? best.p : null;
}

function polygonAreaOf(poly) {
    let a = 0;
    for (let k = 0; k < poly.length; k++) a += poly[k][0] * poly[(k + 1) % poly.length][1] - poly[(k + 1) % poly.length][0] * poly[k][1];
    return a / 2;
}

/** Focal points spread round the ground between the inner ring and the outer wall, at about its
 * middle and clear of the roads: a square (paved, with frontage round it) and a place of worship. */
function placeFocals(T, ring, outward, random) {
    const outer = T.outerWall.polygon;
    const between = Math.abs(polygonAreaOf(outer)) - Math.abs(polygonAreaOf(ring));
    const n = Math.max(2, Math.round(between / (SUBURBS.FOCAL_HA * 10000)));
    const O = centroid(ring);
    const start = random.range(0, 2 * Math.PI);
    const focals = [];
    const nearRoad = (p, within) => outward.some(({ points }) => points.some((q, k) => k + 1 < points.length && segmentDistance(p, q, points[k + 1]) < within));
    for (let k = 0; k < n; k++) {
        for (let tries = 0; tries < 12; tries++) {
            const a = start + ((k + random.range(-0.25, 0.25)) / n) * 2 * Math.PI + (tries ? random.range(-0.4, 0.4) : 0);
            const pi = rayHit(O, a, ring), po = rayHit(O, a, outer);
            if (!pi || !po) continue;
            const p = lerp(pi, po, random.range(0.4, 0.6));
            if (T.wdAt(p) < 40 || nearRoad(p, 50) || focals.some((f) => dist(f.p, p) < 220)) continue;
            if (T.castle && pointInPolygon(p, T.castle.polygon)) continue;
            const angle = a + Math.PI / 2;
            const plazaD = random.range(30, 40);
            const plaza = rect(p, angle, random.range(40, 55), plazaD);
            if (!T.occupancy.free(plaza) || !dryOver(T, plaza, 4)) continue;
            const u = [Math.cos(a), Math.sin(a)];
            // The yard stands on the square, its entrance end towards it, so its door opens onto it
            const wc = [p[0] + u[0] * (plazaD / 2 + 19), p[1] + u[1] * (plazaD / 2 + 19)];
            const yard = rect(wc, angle, 52, 36);
            if (!T.occupancy.free(yard) || T.wdAt(wc) < 30 || !dryOver(T, yard, 4)) continue;
            let body = worshipShape(wc, a, 30, 12, false);
            if (dist(centroid(body[1]), p) > dist(wc, p)) body = worshipShape(wc, a + Math.PI, 30, 12, false);
            T.occupancy.stampPolygon(plaza, RESERVED);
            T.occupancy.stampPolygon(yard, RESERVED);
            T.worship.push({ yard, body, label: "local", suburb: true });
            focals.push({ p, plaza });
            break;
        }
    }
    return focals;
}

/**
 * A great city's outer wall, round the ground its suburbs grew over (cheapest first by the growth
 * cost): in each direction from the old town's middle, the radius that takes in OUTER.quantile of
 * the grown ground there, smoothed round the ring and kept OUTER.clear from the old wall; the
 * growth limit is raised until the ring between the walls holds its share of the people. Its gates
 * are wherever the approach and lesser roads cross it; it is stamped on the occupancy grid.
 */
function outerWallRound(T, ring, cost, { cells, cellX, cellY, insideGrid, dryGrid }) {
    const { input, plan, occupancy } = T;
    const O = SUBURBS.OUTER;
    const C = centroid(ring);
    const B = O.bins;
    const binOf = (x, y) => ((Math.round((Math.atan2(y - C[1], x - C[0]) / (2 * Math.PI)) * B) % B) + B) % B;
    const inner = [];
    for (let b = 0; b < B; b++) {
        const hit = rayHit(C, (b / B) * 2 * Math.PI, ring);
        inner.push(hit ? dist(hit, C) : 0);
    }
    const margin = 150;
    const frameR = (a) => {
        // How far from C the frame lets the wall go in this direction
        const d = [Math.cos(a), Math.sin(a)];
        let r = Infinity;
        for (const [lim, comp] of [[T.W / 2 - margin - C[0], d[0]], [-T.W / 2 + margin - C[0], d[0]], [T.H / 2 - margin - C[1], d[1]], [-T.H / 2 + margin - C[1], d[1]]]) if (comp !== 0 && lim / comp > 0) r = Math.min(r, lim / comp);
        return r;
    };
    const target = Math.abs(polygonAreaOf(ring)) + ((input.population * O.share) / O.density) * 10000;
    const cellsByCost = [];
    for (let k = 0; k < cells; k++) if (!insideGrid[k] && dryGrid[k] && Number.isFinite(cost[k])) cellsByCost.push(k);
    cellsByCost.sort((a, b) => cost[a] - cost[b]);
    const profileAt = (n) => {
        const per = Array.from({ length: B }, () => []);
        for (let m = 0; m < n; m++) {
            const k = cellsByCost[m];
            const x = cellX(k % T.NX), y = cellY((k / T.NX) | 0);
            per[binOf(x, y)].push(Math.hypot(x - C[0], y - C[1]));
        }
        const raw = per.map((list, b) => {
            if (!list.length) return inner[b] + O.clear;
            list.sort((a, c) => a - c);
            return Math.max(inner[b] + O.clear, list[Math.floor((list.length - 1) * O.quantile)]);
        });
        // Smoothed round the ring, never nearer the old wall than OUTER.clear nor past the frame
        return raw.map((_, b) => {
            let sum = 0, w = 0;
            for (let d = -O.smooth; d <= O.smooth; d++) {
                const wt = O.smooth + 1 - Math.abs(d);
                sum += raw[(b + d + B) % B] * wt;
                w += wt;
            }
            const a = (b / B) * 2 * Math.PI;
            return Math.min(frameR(a), Math.max(inner[b] + O.clear, sum / w));
        });
    };
    const polyOf = (profile) => {
        const pts = [];
        for (let c = 0; c < O.corners; c++) {
            const u = (c / O.corners) * B;
            const b0 = Math.floor(u) % B, b1 = (b0 + 1) % B, f = u - Math.floor(u);
            const r = profile[b0] * (1 - f) + profile[b1] * f;
            const a = (u / B) * 2 * Math.PI;
            pts.push([C[0] + Math.cos(a) * r, C[1] + Math.sin(a) * r]);
        }
        return pts;
    };
    let lo = 1, hi = cellsByCost.length;
    for (let s = 0; s < 24 && hi - lo > 1; s++) {
        const mid = Math.floor((lo + hi) / 2);
        if (Math.abs(polygonAreaOf(polyOf(profileAt(mid)))) < target) lo = mid;
        else hi = mid;
    }
    const polygon = polyOf(profileAt(hi));
    // A little wander along each run, so the ring is not a smooth curve
    const random = stageRandom(input.seed, "outer-walls");
    for (let k = 0; k < polygon.length; k++) {
        const p = polygon[k];
        const d = dist(p, C) || 1;
        const r = d * (1 + random.range(-0.02, 0.02));
        polygon[k] = [C[0] + ((p[0] - C[0]) * r) / d, C[1] + ((p[1] - C[1]) * r) / d];
    }
    const verts = polygon.map((p) => ({ p, onBank: false, seaSide: false }));
    const outer = { verts, polygon, grown: true };
    outer.gates = gatesOf([...T.roads, ...plan.lesserRoads], polygon);
    outer.towers = towersOf(verts, outer.gates, stageRandom(input.seed, "outer-towers"));
    for (let k = 0; k < verts.length; k++) occupancy.stampPolyline([verts[k].p, verts[(k + 1) % verts.length].p], 5, RESERVED);
    for (const gate of outer.gates) occupancy.stampPolygon(gate.house, RESERVED);
    for (const road of [...T.roads, ...plan.lesserRoads]) occupancy.clearPolyline(road.outside ?? road.points, road.width / 2, RESERVED, STREET, (p) => T.castle && pointInPolygon(p, T.castle.polygon));
    return outer;
}
