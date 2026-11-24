// The streets inside a town's core or a city's walls.
//
// - Cities: wards from a Voronoi of seeds spaced by where they stand, small near the market and
//   along the main streets, larger towards the walls, so blocks vary in size; their edges are the
//   lanes, a share of them never built so blocks merge.
// - Towns: back lanes behind the burgage plots on both sides of the main streets, and a ring of
//   lanes round the market, so the town builds up in depth rather than out along the roads.
import { Delaunay } from "../../../../../vendor/d3-delaunay/d3-delaunay.js";
import { dist, distanceTransform, insideCuts, offsetPolyline, pointInPolygon, polygonCuts, polylineLength, resample } from "../Geometry.js";
import { MinHeap } from "../../../../kernel/util/MinHeap.js";
import { ringAround } from "./Walls.js";
import { STREET } from "./Occupancy.js";

/** Ward seed spacing grows from this share of the plan's spacing at the market to (1 + it) at the wall. */
const WARD_SPACING_NEAR = 0.6;
const WARD_SPACING_GROWTH = 1.8;
/** Seeds within this distance (m) of a main street pack this much closer, for its narrow frontage blocks. */
const MAIN_STREET_REACH = 70;
const MAIN_STREET_PACKING = 0.75;
/** Town cores: people per hectare, and the share of the population inside. */
const TOWN_CORE_DENSITY = 85;
const TOWN_CORE_SHARE = 0.75;
/** A town's lanes are fewer: a lane is made only to reach plots, so many ward edges are never built. */
const TOWN_LANE_SKIP = 0.4;
/** Suburbs: people per hectare outside the walls; the ground they take is this many times what
 * their houses need (lanes, yards, gardens and gaps); the clear ground kept outside the wall (m). */
const SUBURB_DENSITY = 150;
const SUBURB_ROOM = 1.5;
const SUBURB_CLEAR = 22;
/** The growth cost of a metre (V2): along an approach road, along the foot of the wall, over open
 * ground; and how much it wanders (a share either way), so the suburbs' edge is not smooth. */
const GROWTH_COST = Object.freeze({ road: 0.3, wall: 0.55, open: 2.6 });
const GROWTH_WANDER = 0.5;
/** Side lanes off the approach roads beyond the wall: the first this far (m) out from the gate,
 * then every so many metres, on both sides at this chance, skewed from square by up to half this
 * angle (radians), and no longer than this. */
const SIDE_LANE_FIRST = [40, 90];
const SIDE_LANE_SPACING = [150, 260];
const SIDE_LANE_BOTH = 0.25;
const SIDE_LANE_SKEW = 1.0;
const SIDE_LANE_MAX = 280;
/** Lanes off lanes, in passes until there is frontage enough: from lanes this long, every so
 * many metres, at this chance on each side, no longer than SUB_LANE_MAX. */
const SUB_LANE_PASSES = Object.freeze([
    Object.freeze({ from: 140, spacing: [90, 140], chance: 0.55 }),
    Object.freeze({ from: 90, spacing: [70, 110], chance: 0.7 }),
    Object.freeze({ from: 60, spacing: [55, 85], chance: 0.85 }),
]);
const SUB_LANE_MAX = 200;
/** The share of a lane's frontage houses are expected to take (corners, junctions, gaps). */
const FRONTAGE_USE = 0.55;
/** Suburban plots are wider than the plan's and a share are left open (Buildings.js), by about this much. */
const SUBURB_PLOT_FACTOR = 1.5;
/** Spurs out from the lane round the wall. */
const RING_SPUR_SPACING = [110, 190];
const RING_SPUR_MAX = 140;
/** A second lane round the wall, this far beyond the first (m), where the suburbs reach it. */
const OUTER_RING_GAP = 55;
const OUTER_RING_MIN = 70;
/** A lane is walked in steps of this many metres, turning by up to half this angle (radians) a
 * step, kept this far from other ways once this far from its root, and dropped under this length. */
const LANE_STEP = 8;
const LANE_TURN = 0.26;
const LANE_CLEAR = 22;
const LANE_ROOT_FREE = 16;
const LANE_MIN = 40;
/** The growth cost wanders over this distance (m). */
const SUBURB_WANDER_M = 500;
/** Back lanes run this far (m) behind the main street's frontage. */
const BACK_LANE_DEPTH = [58, 72];
/** Cross lanes join the main street to its back lanes every so many metres. */
const CROSS_LANE_SPACING = [110, 150];
/** The lane ring round a town's market, metres out from its edge. */
const MARKET_RING = 42;

export function buildCore(T) {
    const { input, kind, wall, centre: C } = T;
    T.core = wall?.polygon ?? null;
    if (!T.core && kind === "town") {
        const radius = Math.sqrt((((input.population * TOWN_CORE_SHARE) / TOWN_CORE_DENSITY) * 10000) / Math.PI);
        T.core = ringAround(T, radius, 10, T.R("core")).map((v) => v.p);
    }
    // A larger village gathers round its green and main street rather than straggling along its
    // roads: its core is the ground its houses would fill at a village's density, with back lanes
    // behind the crofts and a second row of tofts along them (pre-sign-off, 2026-11-17)
    if (!T.core && kind === "village" && !input.cave && input.population >= VILLAGE.BACK_LANES_FROM) {
        const radius = Math.sqrt(((input.population / VILLAGE.DENSITY) * 10000) / Math.PI);
        // (a plain ring round the centre: a brook through the village does not cut it short)
        T.core = Array.from({ length: 24 }, (_, k) => [C[0] + Math.cos((k / 24) * 2 * Math.PI) * radius, C[1] + Math.sin((k / 24) * 2 * Math.PI) * radius]);
    }
    T.coreRadius = T.core ? Math.max(...T.core.map((p) => dist(p, C))) : 0;
}

/** A village's core: from this many people, at this density (people a hectare); its back lanes run
 * this far (m) behind the road's frontage, the crofts' depth. */
export const VILLAGE = Object.freeze({ BACK_LANES_FROM: 450, DENSITY: 45, BACK_LANE_DEPTH: [62, 80] });

/** Variable-spacing dart throwing: seeds no closer than the smaller of their two spacings. */
function variableSeeds(T, spacingAt, accept, stage = "ward-seeds") {
    const { W, H, R } = T;
    const random = R(stage);
    const seeds = [];
    const cell = 30;
    const columns = Math.ceil(W / cell);
    const buckets = new Map();
    const key = (p) => Math.floor((p[1] + H / 2) / cell) * columns + Math.floor((p[0] + W / 2) / cell);
    const reach = 4;
    const tries = Math.round((W * H) / 120);
    for (let t = 0; t < tries; t++) {
        const p = [(random.next() - 0.5) * W, (random.next() - 0.5) * H];
        if (!accept(p)) continue;
        const r = spacingAt(p);
        const i0 = Math.floor((p[0] + W / 2) / cell);
        const j0 = Math.floor((p[1] + H / 2) / cell);
        let ok = true;
        for (let j = j0 - reach; j <= j0 + reach && ok; j++) {
            for (let i = i0 - reach; i <= i0 + reach && ok; i++) {
                for (const q of buckets.get(j * columns + i) ?? []) {
                    if (dist(p, q.p) < Math.min(r, q.r)) {
                        ok = false;
                        break;
                    }
                }
            }
        }
        if (!ok) continue;
        const entry = { p, r };
        seeds.push(p);
        const k = key(p);
        if (!buckets.has(k)) buckets.set(k, []);
        buckets.get(k).push(entry);
    }
    return seeds;
}

export function buildWards(T) {
    const { P, kind, core, castle, roads, centre: C, occupancy } = T;
    T.wards = [];
    T.streets = roads.map((road) => ({ points: road.points, half: road.width / 2, rank: road.cls === "minor" ? 1 : 0, road: true }));
    if (!core || !P.wardSpacing) return;
    const random = T.R("wards");
    const mainStreets = roads.filter((road) => road.cls !== "minor").map((road) => road.points);
    const nearMain = (p) => mainStreets.some((points) => points.some((q) => dist(q, p) < MAIN_STREET_REACH));
    const spacingAt = (p) => {
        const out = Math.min(1, dist(p, C) / (T.coreRadius || 1));
        const base = P.wardSpacing * (WARD_SPACING_NEAR + WARD_SPACING_GROWTH * out);
        return kind === "city" && nearMain(p) ? base * MAIN_STREET_PACKING : base;
    };
    // A cavern's floor has a quicker test than its long outline
    // (a surface town's core is tested against its box first: most of the frame lies outside it)
    const box = [Math.min(...core.map((q) => q[0])), Math.max(...core.map((q) => q[0])), Math.min(...core.map((q) => q[1])), Math.max(...core.map((q) => q[1]))];
    const inCore = T.inCore ?? ((p) => p[0] >= box[0] && p[0] <= box[1] && p[1] >= box[2] && p[1] <= box[3] && pointInPolygon(p, core));
    const accept = (p) => inCore(p) && T.wdAt(p) > 10 && !(castle && pointInPolygon(p, castle.polygon));
    const seeds = kind === "city" ? variableSeeds(T, spacingAt, accept) : variableSeeds(T, () => P.wardSpacing, accept);
    if (seeds.length < 3) return;
    const voronoi = Delaunay.from(seeds).voronoi([-T.W / 2, -T.H / 2, T.W / 2, T.H / 2]);
    const seen = new Set();
    const jitter = (p) => [p[0] + (T.noise.value(p[0] * 0.37, p[1] * 0.37) - 0.5) * 7, p[1] + (T.noise.value(p[1] * 0.41 + 50, p[0] * 0.41) - 0.5) * 7];
    for (let c = 0; c < seeds.length; c++) {
        const poly = voronoi.cellPolygon(c);
        if (!poly) continue;
        T.wards.push(poly.slice(0, -1));
        for (let k = 0; k + 1 < poly.length; k++) {
            const a = poly[k];
            const b = poly[k + 1];
            const id = [a, b].map((p) => `${Math.round(p[0])},${Math.round(p[1])}`).sort().join("|");
            if (seen.has(id)) continue;
            seen.add(id);
            const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
            if (!inCore(a) || !inCore(b)) continue;
            if (dist(a, b) < 14) continue;
            if (T.wdAt(mid) < 8) continue;
            if (castle && [a, b, mid].some((p) => pointInPolygon(p, castle.polygon))) continue;
            // No lane runs right beside a road
            if (roads.some((road) => road.points.some((q) => dist(q, mid) < 20))) continue;
            // Some lanes are never built: blocks merge into larger ones with gardens behind
            if (random.chance(kind === "city" ? 0.22 : TOWN_LANE_SKIP)) continue;
            T.streets.push({ points: [jitter(a), jitter(b)], half: (kind === "town" ? 4 : P.streetW) / 2, rank: 2 });
        }
    }
    for (const street of T.streets) if (street.rank === 2) occupancy.stampPolyline(street.points, street.half, STREET);
}

/**
 * A town's back lanes: on both sides of each road's stretch through the core, a lane at plot depth
 * behind the frontage, joined to the road at its ends by short lanes, so the plots between are
 * burgages reaching back to a lane, as in the planned towns of the twelfth and thirteenth centuries.
 */
export function buildBackLanes(T) {
    const { kind, core, roads, occupancy, P } = T;
    if ((kind !== "town" && kind !== "village") || !core) return;
    const random = T.R("back-lanes");
    const depthRange = kind === "village" ? VILLAGE.BACK_LANE_DEPTH : BACK_LANE_DEPTH;
    T.backLanes = [];
    for (const road of roads) {
        const inside = resample(road.points, 8).filter((p) => pointInPolygon(p, core));
        if (inside.length < 6 || polylineLength(inside) < 120) continue;
        for (const side of [1, -1]) {
            const depth = P.mainW / 2 + random.range(depthRange[0], depthRange[1]);
            const lane = offsetPolyline(inside, depth * side);
            // Keep the longest run that stays dry and clear of the other roads
            const ok = lane.map((p) => T.wdAt(p) > 6 && !roads.some((other) => other !== road && other.points.some((q) => dist(q, p) < depth * 0.6)));
            let best = null;
            let run = [];
            for (let k = 0; k < lane.length; k++) {
                if (ok[k]) run.push(k);
                if (!ok[k] || k === lane.length - 1) {
                    if (run.length > (best?.length ?? 0)) best = run;
                    run = [];
                }
            }
            if (!best || best.length < 8) continue;
            const points = best.map((k) => lane[k]);
            // Joined to the road at both ends, and by cross lanes between the burgage blocks
            const joins = [best[0], best[best.length - 1]];
            let along = 0;
            let next = random.range(CROSS_LANE_SPACING[0], CROSS_LANE_SPACING[1]);
            for (let k = 1; k < best.length - 1; k++) {
                along += dist(lane[best[k]], lane[best[k - 1]]);
                if (along < next) continue;
                joins.push(best[k]);
                next = along + random.range(CROSS_LANE_SPACING[0], CROSS_LANE_SPACING[1]);
            }
            T.backLanes.push(points);
            T.streets.push({ points, half: 2, rank: 2, back: true });
            occupancy.stampPolyline(points, 2, STREET);
            for (const k of joins) {
                const join = [inside[k], lane[k]];
                T.streets.push({ points: join, half: 2, rank: 2 });
                occupancy.stampPolyline(join, 2, STREET);
            }
        }
    }
}

/** A ring of lanes round a town's market, where it stays dry and clear of the roads. */
export function buildMarketRing(T) {
    const { kind, market, occupancy, roads } = T;
    if (kind !== "town" || !market) return;
    const ring = offsetRing(market.polygon, MARKET_RING);
    let run = [];
    const runs = [];
    for (const p of [...ring, ring[0]]) {
        const ok = T.wdAt(p) > 6 && !roads.some((road) => road.points.some((q) => dist(q, p) < 10));
        if (ok) run.push(p);
        else {
            if (run.length > 3) runs.push(run);
            run = [];
        }
    }
    if (run.length > 3) runs.push(run);
    for (const points of runs) {
        T.streets.push({ points, half: 2, rank: 2, ring: true });
        occupancy.stampPolyline(points, 2, STREET);
    }
}

/** A closed polygon pushed out from its centroid by `by` metres. */
function offsetRing(poly, by) {
    const c = [poly.reduce((a, p) => a + p[0], 0) / poly.length, poly.reduce((a, p) => a + p[1], 0) / poly.length];
    return poly.map((p) => {
        const d = dist(p, c) || 1;
        return [c[0] + ((p[0] - c[0]) * (d + by)) / d, c[1] + ((p[1] - c[1]) * (d + by)) / d];
    });
}

/**
 * The suburbs: most of a city's people, and a walled town's few, live outside the walls. They grow
 * out from the wall and furthest along the roads (ribbons out of each gate), by an edge that
 * wanders, so the built-up area beyond the walls has an organic outline rather than a ring. Their
 * lanes are the edges of a Voronoi of seeds through that ground, closer by the wall and the roads.
 */
export function buildSuburbs(T) {
    const { input, wall, roads, occupancy, castle, NX, NY, g, W, H } = T;
    if (!wall) return;
    const random = T.R("suburbs");
    const outside = input.population * (1 - wall.share);
    const needM2 = (outside / SUBURB_DENSITY) * 10000;
    const cellX = (i) => -W / 2 + (i + 0.5) * g;
    const cellY = (j) => -H / 2 + (j + 0.5) * g;
    const cells = NX * NY;
    const wallSeeds = new Uint8Array(cells);
    const roadCells = new Uint8Array(cells);
    const mark = (seeds, a, b) => {
        const steps = Math.ceil(dist(a, b) / (g * 0.5)) + 1;
        for (let t = 0; t <= steps; t++) {
            const k = T.cellOf([a[0] + ((b[0] - a[0]) * t) / steps, a[1] + ((b[1] - a[1]) * t) / steps]);
            if (k >= 0) seeds[k] = 1;
        }
    };
    const ringPoints = wall.polygon;
    for (let k = 0; k < ringPoints.length; k++) mark(wallSeeds, ringPoints[k], ringPoints[(k + 1) % ringPoints.length]);
    for (const road of roads) for (let k = 0; k + 1 < road.points.length; k++) if (!pointInPolygon(road.points[k], wall.polygon)) mark(roadCells, road.points[k], road.points[k + 1]);
    const fromWallGrid = distanceTransform(wallSeeds, NX, NY);
    const insideGrid = new Uint8Array(cells);
    // Between an outer wall and the old one is suburb ground throughout
    const withinOuter = new Uint8Array(cells);
    const dryGrid = new Uint8Array(cells);
    for (let j = 0; j < NY; j++) {
        // Each row's crossings of the walls and the castle, worked out once for the whole row
        const y = cellY(j);
        const wallCuts = polygonCuts(wall.polygon, y);
        const outerCuts = T.outerWall ? polygonCuts(T.outerWall.polygon, y) : null;
        const castleCuts = castle ? polygonCuts(castle.polygon, y) : null;
        for (let i = 0; i < NX; i++) {
            const k = j * NX + i;
            const p = [cellX(i), y];
            fromWallGrid[k] *= g;
            insideGrid[k] = insideCuts(wallCuts, p[0]) ? 1 : 0;
            withinOuter[k] = outerCuts && insideCuts(outerCuts, p[0]) ? 1 : 0;
            dryGrid[k] = T.wdAt(p) > 8 && !(castleCuts && insideCuts(castleCuts, p[0])) ? 1 : 0;
        }
    }
    // The growth cost: the cheapest way out from a gate, cheap along the approach roads, dearer
    // along the foot of the wall, dearest over open ground, so the suburbs push out along the roads
    // first and fill in by the gates and round the wall after (Ken, 2026-11-14)
    const stepCost = new Float32Array(cells);
    for (let k = 0; k < cells; k++) {
        stepCost[k] = roadCells[k] ? GROWTH_COST.road : fromWallGrid[k] < SUBURB_CLEAR + OUTER_RING_GAP + 12 ? GROWTH_COST.wall : GROWTH_COST.open;
        // A little wander, so the edge of the built ground is not a smooth curve
        stepCost[k] *= 1 + GROWTH_WANDER * (T.noise.value(cellX(k % NX) / SUBURB_WANDER_M + 13.1, cellY((k / NX) | 0) / SUBURB_WANDER_M - 2.9) - 0.5);
    }
    const cost = new Float64Array(cells).fill(Infinity);
    const heap = new MinHeap();
    const sources = [];
    for (const gate of wall.gates ?? []) {
        if (gate.water) continue;
        // The gate's outer side: whichever of the two points beside it lies outside the ring
        const d = [Math.cos(gate.dir ?? 0), Math.sin(gate.dir ?? 0)];
        const out = [[gate.p[0] + d[0] * g * 2, gate.p[1] + d[1] * g * 2], [gate.p[0] - d[0] * g * 2, gate.p[1] - d[1] * g * 2]].find((q) => !pointInPolygon(q, wall.polygon));
        const k = out ? T.cellOf(out) : -1;
        if (k >= 0) sources.push(k);
    }
    // Each road also grows from where it leaves the ring (a ring may have no gate on a road, as
    // before a hold's great gate), and a ring with neither grows from its whole foot
    for (const road of roads) {
        const out = road.points.find((p, k) => k > 0 && !pointInPolygon(p, wall.polygon) && pointInPolygon(road.points[k - 1], wall.polygon));
        const k = out ? T.cellOf(out) : -1;
        if (k >= 0) sources.push(k);
    }
    if (!sources.length) for (let k = 0; k < cells; k++) if (!insideGrid[k] && fromWallGrid[k] <= g * 1.5) sources.push(k);
    for (const k of sources) {
        cost[k] = 0;
        heap.push(0, k);
    }
    const DI = [1, -1, 0, 0, 1, 1, -1, -1];
    const DJ = [0, 0, 1, -1, 1, -1, 1, -1];
    const LEN = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];
    while (heap.size) {
        const k = heap.pop();
        if (heap.lastPriority > cost[k]) continue;
        const i = k % NX;
        const j = (k / NX) | 0;
        for (let s = 0; s < 8; s++) {
            const ni = i + DI[s];
            const nj = j + DJ[s];
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
    // The suburbs' ground: everything cheaper to reach than the cost that gives it room for the
    // people outside (SUBURB_ROOM times what their houses need)
    const zoneArea = (limit) => {
        let n = 0;
        for (let k = 0; k < cells; k++) if (!insideGrid[k] && dryGrid[k] && (withinOuter[k] || cost[k] < limit)) n++;
        return n * g * g;
    };
    let lo = 10;
    let hi = (W + H) * GROWTH_COST.open;
    for (let step = 0; step < 22; step++) {
        const mid = (lo + hi) / 2;
        if (zoneArea(mid) < needM2 * SUBURB_ROOM) lo = mid;
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
    // Houses are built cheapest first; within an outer wall all its ground is near
    // (ground the growth never reaches ranks by its distance from the wall over open ground)
    T.suburbRank = (p) => {
        const k = T.cellOf(p);
        if (k < 0) return 1e9;
        const c = Number.isFinite(cost[k]) ? cost[k] : fromWallGrid[k] * GROWTH_COST.open + R0;
        return withinOuter[k] ? Math.min(c, R0 * 0.5) : c;
    };
    // The lane outside the wall, kept where it is dry and off the far bank
    const ring = wall.polygon.map((p) => {
        const d = dist(p, T.centre) || 1;
        return [T.centre[0] + ((p[0] - T.centre[0]) * (d + SUBURB_CLEAR)) / d, T.centre[1] + ((p[1] - T.centre[1]) * (d + SUBURB_CLEAR)) / d];
    });
    const dense = [];
    for (let k = 0; k < ring.length; k++) {
        const a = ring[k];
        const b = ring[(k + 1) % ring.length];
        const steps = Math.max(1, Math.ceil(dist(a, b) / 12));
        for (let u = 0; u < steps; u++) dense.push([a[0] + ((b[0] - a[0]) * u) / steps, a[1] + ((b[1] - a[1]) * u) / steps]);
    }
    const dry = (p) => T.wdAt(p) > 8;
    let run = [];
    const runs = [];
    for (const p of [...dense, dense[0]]) {
        if (dry(p) && !(castle && pointInPolygon(p, castle.polygon)) && T.inFrame(p)) run.push(p);
        else {
            if (run.length > 4) runs.push(run);
            run = [];
        }
    }
    if (run.length > 4) runs.push(run);
    for (const points of runs) {
        T.streets.push({ points, half: 2.5, rank: 2, suburb: true, ring: true });
        occupancy.stampPolyline(points, 2.5, STREET);
    }
    // The second lane round the wall, only where the suburbs' ground reaches it
    const outerRing = wall.polygon.map((p) => {
        const d = dist(p, T.centre) || 1;
        const out = SUBURB_CLEAR + OUTER_RING_GAP;
        return [T.centre[0] + ((p[0] - T.centre[0]) * (d + out)) / d, T.centre[1] + ((p[1] - T.centre[1]) * (d + out)) / d];
    });
    const outerDense = [];
    for (let k = 0; k < outerRing.length; k++) {
        const a = outerRing[k];
        const b = outerRing[(k + 1) % outerRing.length];
        const steps = Math.max(1, Math.ceil(dist(a, b) / 12));
        for (let u = 0; u < steps; u++) outerDense.push([a[0] + ((b[0] - a[0]) * u) / steps, a[1] + ((b[1] - a[1]) * u) / steps]);
    }
    const nearRoad = (p) => roads.some((road) => road.points.some((q) => dist(q, p) < 14));
    run = [];
    for (const p of [...outerDense, outerDense[0]]) {
        if (dry(p) && T.suburbAt(p) && !nearRoad(p) && !(castle && pointInPolygon(p, castle.polygon)) && T.inFrame(p) && !(T.outerWall && !pointInPolygon(p, T.outerWall.polygon) && pointInPolygon(T.centre, T.outerWall.polygon) && false)) run.push(p);
        else {
            if (run.length * 12 >= OUTER_RING_MIN) {
                T.streets.push({ points: run, half: 2, rank: 2, suburb: true, lane: true });
                occupancy.stampPolyline(run, 2, STREET);
                runs.push(run);
            }
            run = [];
        }
    }
    if (run.length * 12 >= OUTER_RING_MIN) {
        T.streets.push({ points: run, half: 2, rank: 2, suburb: true, lane: true });
        occupancy.stampPolyline(run, 2, STREET);
        runs.push(run);
    }
    // Frontage enough for the houses outside, at the plan's plot width, both sides, with room to spare
    const housesOutside = outside / T.P.perBuilding;
    const wantM = (housesOutside * SUBURB_PLOT_FACTOR * (T.P.plotW[0] + T.P.plotW[1])) / 2 / (2 * FRONTAGE_USE);
    growSuburbLanes(T, random, runs, wantM);
}

/**
 * Side lanes into the suburbs' ground: off each approach road beyond the wall every so often, on
 * one side or both, running out roughly square to it while the ground is suburb; in a city, lanes
 * off the longer side lanes too; and short spurs off the lane round the wall. Lanes keep clear of
 * the other ways, the wall and the water, and end where the suburbs end; the buildings stage
 * trims each to its last house.
 */
function growSuburbLanes(T, random, ringRuns, wantM = 0) {
    const { wall, roads, occupancy, castle, kind } = T;
    const BUCKET = 20;
    const taken = new Map();
    const keyOf = (p) => Math.floor(p[0] / BUCKET) * 100003 + Math.floor(p[1] / BUCKET);
    const add = (points, id) => {
        for (const p of resample(points, 6)) {
            const key = keyOf(p);
            if (!taken.has(key)) taken.set(key, []);
            taken.get(key).push({ p, id });
        }
    };
    const clearOf = (p, id, within) => {
        const i = Math.floor(p[0] / BUCKET), j = Math.floor(p[1] / BUCKET);
        for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (const q of taken.get((i + di) * 100003 + j + dj) ?? []) if (q.id !== id && dist(q.p, p) < within) return false;
        return true;
    };
    roads.forEach((road, r) => add(road.points.filter((p) => !pointInPolygon(p, wall.polygon)), `road${r}`));
    ringRuns.forEach((points, r) => add(points, `ring${r}`));
    let lanes = 0;
    const ok = (p) => T.inFrame(p) && T.wdAt(p) > 10 && T.suburbAt(p) && !pointInPolygon(p, wall.polygon) && !(castle && pointInPolygon(p, castle.polygon)) && !(T.outerWall && segmentNearRing(p, T.outerWall.polygon, 10));
    /** A lane from a root, heading out along `dir`, wandering a little; null if too short. */
    const grow = (root, dir, maxLength, id) => {
        const points = [root];
        let heading = Math.atan2(dir[1], dir[0]);
        let p = root;
        for (let s = 0; s < maxLength; s += LANE_STEP) {
            heading += (random.next() - 0.5) * LANE_TURN;
            const q = [p[0] + Math.cos(heading) * LANE_STEP, p[1] + Math.sin(heading) * LANE_STEP];
            if (!ok(q)) break;
            // Clear of other ways, once away from its root
            if (s > LANE_ROOT_FREE && !clearOf(q, id, LANE_CLEAR)) break;
            points.push(q);
            p = q;
        }
        return points.length * LANE_STEP >= LANE_MIN ? points : null;
    };
    const place = (points, id, extra = {}) => {
        add(points, id);
        T.streets.push({ points, half: 2, rank: 2, suburb: true, lane: true, ...extra });
        occupancy.stampPolyline(points, 2, STREET);
        lanes++;
        return points;
    };
    function ringSpurs(ringRuns) {
        // Short spurs out from the lane round the wall, where the ground by the wall fills in
        for (const [r, points] of ringRuns.entries()) {
            let next = random.range(RING_SPUR_SPACING[0], RING_SPUR_SPACING[1]);
            walkLine(points, (p, t, s) => {
                if (s < next) return;
                next = s + random.range(RING_SPUR_SPACING[0], RING_SPUR_SPACING[1]);
                if (!T.suburbAt(p)) return;
                // Outwards: the side away from the wall's middle
                const n = [-t[1], t[0]];
                const away = dist([p[0] + n[0] * 10, p[1] + n[1] * 10], T.centre) > dist(p, T.centre) ? n : [-n[0], -n[1]];
                const id = `spur${r}-${Math.round(s)}`;
                const lane = grow([p[0] + away[0] * 3, p[1] + away[1] * 3], away, RING_SPUR_MAX, id);
                if (lane) place(lane, id);
            });
        }
    }
    const sideLanes = [];
    roads.forEach((road, r) => {
        // Only the road's stretch beyond the wall, from the gate outwards
        const pts = road.points;
        const outsideRuns = [];
        let cur = [];
        for (const p of pts) {
            if (pointInPolygon(p, wall.polygon)) {
                if (cur.length > 1) outsideRuns.push(cur);
                cur = [];
            } else cur.push(p);
        }
        if (cur.length > 1) outsideRuns.push(cur);
        for (const run of outsideRuns) {
            // Run outwards from the wall
            const outward = segmentNearRing(run[0], wall.polygon, 60) ? run : [...run].reverse();
            let next = random.range(SIDE_LANE_FIRST[0], SIDE_LANE_FIRST[1]);
            walkLine(outward, (p, t, s) => {
                if (s < next) return;
                next = s + random.range(SIDE_LANE_SPACING[0], SIDE_LANE_SPACING[1]);
                if (!T.suburbAt(p)) return;
                const sides = random.chance(SIDE_LANE_BOTH) ? [1, -1] : [random.chance(0.5) ? 1 : -1];
                for (const side of sides) {
                    const angle = (random.next() - 0.5) * SIDE_LANE_SKEW;
                    const n = [-t[1] * side, t[0] * side];
                    const dir = [n[0] * Math.cos(angle) - n[1] * Math.sin(angle), n[0] * Math.sin(angle) + n[1] * Math.cos(angle)];
                    const root = [p[0] + n[0] * (road.width / 2 + 1), p[1] + n[1] * (road.width / 2 + 1)];
                    const id = `side${r}-${Math.round(s)}-${side}`;
                    const points = grow(root, dir, SIDE_LANE_MAX, id);
                    if (points) sideLanes.push({ points: place(points, id), along: t });
                }
            });
        }
    });
    // Spurs off the lane round the wall come before any further lanes, so the ground by the wall
    // fills in before the suburbs spread further
    ringSpurs(ringRuns);
    // Frontage so far: the roads beyond the wall within the suburbs' ground, both lanes round the
    // wall and every lane
    const frontage = () => {
        let m = 0;
        for (const st of T.streets) {
            if (!st.suburb && !st.road) continue;
            for (let k = 1; k < st.points.length; k++) {
                const a = st.points[k - 1], b = st.points[k];
                if (st.road && (pointInPolygon(a, wall.polygon) || !T.suburbAt(a))) continue;
                m += dist(a, b);
            }
        }
        return m;
    };
    // Lanes off the longer lanes, running back alongside the road, in passes closer each time
    // until there is frontage enough (a city's always take the first pass)
    const parents = [...sideLanes];
    for (let pass = 0; pass < SUB_LANE_PASSES.length; pass++) {
        if (frontage() >= wantM && !(kind === "city" && pass === 0)) break;
        const { spacing, chance, from } = SUB_LANE_PASSES[pass];
        const grown = [];
        for (const [k, lane] of parents.entries()) {
            if (lane.points.length * LANE_STEP < from) continue;
            let next = random.range(spacing[0], spacing[1]);
            walkLine(lane.points, (p, t, s) => {
                if (s < next) return;
                next = s + random.range(spacing[0], spacing[1]);
                for (const side of [1, -1]) {
                    if (!random.chance(chance)) continue;
                    const n = [-t[1] * side, t[0] * side];
                    const id = `sub${pass}-${k}-${Math.round(s)}-${side}`;
                    const points = grow([p[0] + n[0] * 3, p[1] + n[1] * 3], n, SUB_LANE_MAX, id);
                    if (points) grown.push({ points: place(points, id) });
                }
            });
        }
        for (const g of grown) parents.push(g);
    }
    T.suburbFrontage = { wantM: Math.round(wantM), haveM: Math.round(frontage()) };
    T.suburbLanes = lanes;
}

/** Calls visit(point, unit tangent, distance along) every metre or so along a polyline. */
function walkLine(points, visit) {
    let s = 0;
    for (let k = 0; k + 1 < points.length; k++) {
        const a = points[k], b = points[k + 1];
        const L = dist(a, b);
        if (!L) continue;
        const t = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
        for (let u = 0; u < L; u += 2) visit([a[0] + t[0] * u, a[1] + t[1] * u], t, s + u);
        s += L;
    }
}

/** Whether a point lies within `within` metres of a closed ring. */
function segmentNearRing(p, ring, within) {
    for (let k = 0; k < ring.length; k++) {
        const a = ring[k], b = ring[(k + 1) % ring.length];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const L2 = dx * dx + dy * dy || 1;
        const u = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
        if (Math.hypot(p[0] - a[0] - u * dx, p[1] - a[1] - u * dy) < within) return true;
    }
    return false;
}
