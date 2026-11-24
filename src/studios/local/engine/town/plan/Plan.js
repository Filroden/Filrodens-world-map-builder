// V2's plan-first layout core (Ken, 2026-11-14): a surface town or city laid out in the order a
// planner would, rather than in layers that do not know each other.
//
//  1. The programme from the people and the role: the walled ground (or a town's core), the gates
//     (one where each approach road meets the wall, more as the wall grows, each with a lesser road
//     out), the market's size, places of worship, the castle.
//  2. The focal points: the market where the roads converge, the castle on the high ground at the
//     wall (Walls.js), the great place of worship by the market, local ones spread through the
//     walled ground.
//  3. The main streets as one network: from every gate to the market (or to a main street that
//     already leads there), least-cost over the ground and smoothed, kept off one another so no
//     two run side by side.
//  4. Quarters: the ground the main streets divide, each with a character from what is in or beside
//     it (wealth in three tiers: upper by the castle or a place of worship away from the market,
//     middle on the market and the high streets, lower elsewhere, by the crafts and the water).
//  5. A lane round the inside of the wall; then the blocks the network encloses, each split by a
//     lane across its long axis, joining two streets, until it is its quarter's size and the town
//     has frontage for its houses (a close now and then in the quiet quarters).
//  6. The suburbs (Suburbs.js): ground along the roads beyond the gates, cheapest along the roads,
//     laid out as ladders of side lanes and back lanes off each road.
//  7. Plot and house styles by tier, for Buildings.js (`T.plan.styleAt`).
//
// Everything downstream (port, doors, parks, buildings, cemeteries, fields, households) is the
// engine as signed off, reading the same fields of T as before.
import { centroid, chaikin, dist, lerp, pointInPolygon, polygonArea, resample, segmentCross, segmentDistance, segmentIndex, simplify, stageRandom } from "../../Geometry.js";
import { CELL, axes, components, makeRaster, route } from "./Raster.js";
import { RESERVED, STREET } from "../Occupancy.js";
import { OUTER_WALL_PEOPLE, buildWalls, insideShare, rect, ringAround, towersOf } from "../Walls.js";
import { worshipShape } from "../MarketWorship.js";
import { buildPlanSuburbs } from "./Suburbs.js";
import { lesserRoad } from "./RoadsOut.js";
import { dryOver } from "../Walls.js";
export { dryOver };
import { CAVE } from "../../CaveInput.js";
import { ESTATES, estateCounts, layOutEstate, pickEstateBlocks, settleEstates } from "./Estates.js";

export const PLAN = Object.freeze({
    /** People per hectare inside the walls (the reference holds 4,000 to 6,000 in about 23 ha). */
    DENSITY: Object.freeze({ town: 240, city: 300 }),
    /** A great city's old town (inside its inner wall), more crowded with landmarks and grounds,
     * walled more loosely so its people fit (Ken, 2026-11-16). */
    GREAT_DENSITY: 250,
    /** A town's unwalled core: its share of the people and their density. */
    CORE_SHARE: 0.8,
    CORE_DENSITY: 150,
    /** Ground kept round the castle, market and places of worship, as a share of their own. */
    LANDMARK_ROOM: 1.3,
    /** The raster's cell (m). */
    STEP: Object.freeze({ town: 2, city: 2.5 }),
    /** Gates: one per so many metres of wall, at least, and at most so many more than the roads give. */
    GATE_SPACING: Object.freeze({ town: 420, city: 520 }),
    GATES_MIN: Object.freeze({ town: 2, city: 4 }),
    GATES_EXTRA_MAX: 3,
    /** Two gates closer than this (m) are one; an extra gate keeps this far (m) from the castle. */
    GATE_MERGE: 40,
    GATE_CASTLE_CLEAR: 60,
    /** The market: a town's base area and area a head, the most; a city's square. */
    MARKET: Object.freeze({ townBase: 900, townPerHead: 0.7, townMax: 6000, cityBase: 3200, cityPerHead: 0.1, cityMax: 9000 }),
    /** Main streets: how much cheaper an existing street is to follow, how far (m) another street
     * pushes a new one away and how strongly, and the wander of the ground's cost. */
    FOLLOW: 0.35,
    KEEP_OFF_M: 20,
    KEEP_OFF: 2.5,
    GRADE: 0.05,
    WANDER: 0.3,
    WANDER_M: 160,
    /** A street joins another it meets only this far (m) from its own start. */
    JOIN_AFTER_M: 50,
    /** ... and only where that street is this much nearer the market than the new one's start. */
    JOIN_PROGRESS: 0.6,
    JOIN_PROGRESS_LESSER: 0.85,
    /** Widths (m): main streets, lesser streets, lanes. */
    WIDTH: Object.freeze({ town: [9, 7, 4.5], city: [10, 7, 4.5] }),
    /** The lane round the inside of the wall, this far (m) in from the wall's line. */
    // (far enough in that small houses can back onto the wall between the lane and the wall)
    WALL_LANE_M: 16,
    /** A block narrower than this (m) is a strip (the row against the wall): lower tier, never cut. */
    STRIP_M: 13,
    CORE_LANE_M: 3,
    /** Blocks: the size each tier aims at (m²). */
    BLOCK_M2: Object.freeze({
        town: Object.freeze({ upper: 9000, middle: 5200, lower: 3200 }),
        city: Object.freeze({ upper: 7500, middle: 3800, lower: 2300 }),
    }),
    /** A block is not cut shorter than this (m), nor a lane made shorter than this (m). */
    BLOCK_MIN_LONG: 30,
    LANE_MIN: 18,
    SLIVER_M2: 300,
    /** Roads this close (m) outside the ring run on as one. */
    ROAD_MERGE_M: 45,
    /** A road this close (m) to the wall before its gate gets a gate of its own there. */
    ROAD_NEAR_WALL_M: 40,
    /** Closes (cul-de-sacs): at most this share of the lanes, and how far (share) across a block. */
    CLOSE_SHARE: 0.18,
    CLOSE_REACH: [0.5, 0.65],
    CLOSE_APART_M: 80,
    /** The lanes stop once the frontage would house this many times the people inside. */
    CAPACITY: Object.freeze({ town: 1.05, city: 0.7 }),
    /** ... and between a great city's rings. */
    RING_CAPACITY: 1.25,
    /** The share of a frontage houses take (corners, junctions, gaps). */
    // (a block's cells touching a street count a diagonal frontage about 4/π times over)
    // (calibrated on Lostshearmi and Weyfield: corners, junctions and wedge plots lose more in a town)
    FRONTAGE_USE: Object.freeze({ town: 0.48 / 1.27, city: 0.5 / 1.27 }),
    /** Tiers: the middle tier within so many metres of the market, or on a main street within so
     * many; upper quarters at most this share of the walled ground. */
    MIDDLE_M: Object.freeze({ town: 110, city: 200 }),
    HIGH_STREET_M: Object.freeze({ town: 230, city: 420 }),
    /** The checks: no two streets within a street's width of each other for longer than this (m). */
    SIDE_BY_SIDE_M: 30,
    /** A new lane keeps at least this far (m) from other streets along its length. */
    LANE_APART_M: 10,
    /** A park laid out with the plan (m, its radius). */
    PARK_RADIUS: [20, 30],
    PARK_SMALLEST: 15,
    UPPER_REACH: Object.freeze({ town: 110, city: 190 }),
    // A lane's end keeps this far (m) from another lane's end on the street they meet
    LANE_END_APART_M: 24,
    // ... when the two leave that point within about 35° of each other
    LANE_FAN_COS: Math.cos((35 * Math.PI) / 180),
    UPPER_SHARE: Object.freeze({ town: 0.2, city: 0.2 }),
    /** Local places of worship (a city's): one per so many people inside, spread through the walls. */
    WORSHIP_PEOPLE: 3500,
});

/** Plot and house styles by tier: plot frontage (m), house depth (m), terrace, detached house's
 * share of its plot, set back from the street (m), a wealth factor (deeper ranges), rear ranges. */
export const STYLE = Object.freeze({
    town: Object.freeze({
        upper: Object.freeze({ plotW: [16, 26], depth: [12, 16], terrace: false, detached: [0.55, 0.75], setback: [3, 6], rich: 1.5, ranges: 0.85 }),
        middle: Object.freeze({ plotW: [6, 9], depth: [11, 15], terrace: true, rich: 1.2, ranges: 0.9, backs: true }),
        lower: Object.freeze({ plotW: [5, 7], depth: [8, 11], terrace: true, rich: 1, ranges: 0.75, backs: true }),
    }),
    city: Object.freeze({
        upper: Object.freeze({ plotW: [18, 28], depth: [13, 18], terrace: false, detached: [0.55, 0.75], setback: [3, 6], rich: 1.6, ranges: 0.9 }),
        middle: Object.freeze({ plotW: [6.5, 9.5], depth: [13, 18], terrace: true, rich: 1.25, ranges: 0.9, backs: true }),
        lower: Object.freeze({ plotW: [5.5, 7.5], depth: [10, 14], terrace: true, rich: 1, ranges: 0.75, backs: true }),
    }),
});

/** The new core applies to surface towns and cities (not villages, caverns, open floors or the
 * town before a hold's gate, which keep the old path until it is proven). */
/** Streets keep this far (m) off a place of worship's yard (a main street's half width and a little). */
const YARD_MARGIN_M = 7;
/** ... and off the castle (a lane's half width and a little); its gate street leaves beyond it. */
const CASTLE_MARGIN_M = 3.5;

/** A polygon grown outwards from its centroid by about so many metres. */
function grownPoly(poly, margin) {
    const c = centroid(poly);
    return poly.map((p) => {
        const d = dist(p, c) || 1;
        return [c[0] + ((p[0] - c[0]) * (d + margin)) / d, c[1] + ((p[1] - c[1]) * (d + margin)) / d];
    });
}

export function usesPlan(T) {
    const { input, kind } = T;
    // (a carved place of galleries and halls too, its hub on the plan: pre-sign-off, 2026-11-17)
    return (kind === "town" || kind === "city") && input.layout !== "classic";
}

/**
 * A carved chamber's built ground: its outline drawn in towards the plaza until it holds the
 * chamber's houses at the cave's density (with room for the plaza, places of worship, pillars and
 * the lake), so the rest of its floor, out to the rock, is left for the fungus beds round it, as a
 * surface town's fields lie round it.
 */
function caveRing(T, cave, chamber = cave.main, c = T.centre) {
    const people = caveShare(T, cave, chamber) * T.input.population;
    // (at the plan's density, as a surface town's walls: the rest of the floor goes to beds)
    const want = (people / PLAN.DENSITY[T.kind]) * 10000 * CAVE_ROOM;
    // (a galleried place's hub is sized for its plaza and great place of worship: its built
    // ground is most of it)
    const k = T.input.cave.plan === "streets" ? HUB_RING : Math.min(1, Math.sqrt(want / chamber.area));
    return chamber.outline.map((p) => {
        let f = k;
        // (each point kept on the chamber's floor)
        while (f < 1 && !chamber.contains([c[0] + (p[0] - c[0]) * f, c[1] + (p[1] - c[1]) * f])) f = Math.min(1, f + 0.05);
        return [c[0] + (p[0] - c[0]) * f, c[1] + (p[1] - c[1]) * f];
    });
}

/**
 * The share of a carved place's people whose free-standing houses stand in its main chamber: the
 * plan's chamber share, less the houses cut into the rock, and split by floor with a twin chamber.
 */
/** How far out to its wall a galleried place's hub is built on (a share of its radius). */
const HUB_RING = 0.88;

/** Room in a chamber's built ground for the plaza, places of worship, pillars and the lake, over the houses. */
const CAVE_ROOM = 1.3;

function caveShare(T, cave, chamber = cave.main) {
    const P = CAVE.PLANS[T.input.cave.plan ?? "chamber"];
    const inChamber = Math.max(0.04, P.inChamber) * (1 - (T.input.cave.rockCut ?? P.rockCut));
    return cave.twin ? (inChamber * chamber.area) / (cave.main.area + cave.twin.area) : inChamber;
}

/** Half the width of the broad way between twin chambers, and the second chamber's square (m). */
const TWIN_WAY_HALF_M = 6;
const TWIN_SQUARE_M = [46, 34];

/**
 * A twin chamber's second chamber on the plan (pre-sign-off, 2026-11-17): its built ground drawn
 * in as the main chamber's is, for its share of the people; the broad way from the main chamber
 * runs in to a square at its middle, a street crosses it there, and blocks are cut by lanes as the
 * ground between a great city's rings is, until its frontage houses its share. Its floor round
 * the built ground is left for the beds. Returns the ring.
 */
export function buildTwinPlan(T) {
    const { shore, occupancy, plan, input } = T;
    const cave = shore.cave;
    const twin = cave.twin;
    const tc = twin.c;
    const ring = caveRing(T, cave, twin, tc);
    plan.twinRing = ring;
    const R = (p) => pointInPolygon(p, ring);
    // The square, turned to face the main chamber
    const toMain = Math.atan2(cave.main.c[1] - tc[1], cave.main.c[0] - tc[0]);
    const square = rect(tc, toMain, TWIN_SQUARE_M[0], TWIN_SQUARE_M[1]);
    plan.squares = [...(plan.squares ?? []), square];
    occupancy.stampPolygon(square, RESERVED);
    // The broad way: from the nearest of the main chamber's streets to the square's near side
    const near = [tc[0] + Math.cos(toMain) * (TWIN_SQUARE_M[0] / 2), tc[1] + Math.sin(toMain) * (TWIN_SQUARE_M[0] / 2)];
    let from = null;
    for (const s of T.streets) for (const q of s.points) if (pointInPolygon(q, plan.ring) && (!from || dist(q, near) < dist(from, near))) from = q;
    const ways = [];
    if (from) ways.push({ points: resample([from, near], 8), half: TWIN_WAY_HALF_M, rank: 0 });
    // A street across the chamber through the square, from wall to wall of the built ground
    const across = toMain + Math.PI / 2;
    for (const sgn of [1, -1]) {
        const u = [Math.cos(across) * sgn, Math.sin(across) * sgn];
        const start = [tc[0] + u[0] * (TWIN_SQUARE_M[1] / 2), tc[1] + u[1] * (TWIN_SQUARE_M[1] / 2)];
        const pts = [start];
        for (let d = 8; d < 2000; d += 8) {
            const q = [start[0] + u[0] * d, start[1] + u[1] * d];
            if (!R(q) || T.wdAt(q) < 6) break;
            pts.push(q);
        }
        if (pts.length >= 4) ways.push({ points: pts.slice(0, -1), half: PLAN.WIDTH[T.kind][1] / 2, rank: 1 });
    }
    // The way out of the square opposite the broad way
    {
        const u = [-Math.cos(toMain), -Math.sin(toMain)];
        const start = [tc[0] + u[0] * (TWIN_SQUARE_M[0] / 2), tc[1] + u[1] * (TWIN_SQUARE_M[0] / 2)];
        const pts = [start];
        for (let d = 8; d < 2000; d += 8) {
            const q = [start[0] + u[0] * d, start[1] + u[1] * d];
            if (!R(q) || T.wdAt(q) < 6) break;
            pts.push(q);
        }
        if (pts.length >= 4) ways.push({ points: pts.slice(0, -1), half: PLAN.WIDTH[T.kind][1] / 2, rank: 1 });
    }
    const houses = Math.round((caveShare(T, cave, twin) * input.population) / T.P.perBuilding);
    const cuts = cutRingBlocks(T, { outer: ring, inner: null, ways, squares: [square], houses, plotW: 10.5, seed: "plan-twin-lanes", estates: false });
    for (const w of ways) {
        T.streets.push({ points: w.points, half: w.half, rank: w.rank, plan: w.rank === 0 ? "main" : "lesser" });
        occupancy.stampPolyline(w.points, w.half, STREET);
    }
    for (const points of cuts) {
        T.streets.push({ points, half: PLAN.WIDTH[T.kind][2] / 2, rank: 2, lane: true, plan: "lane" });
        occupancy.stampPolyline(points, PLAN.WIDTH[T.kind][2] / 2, STREET);
    }
    return { ring, houses };
}

export function buildPlan(T) {
    const { input, kind } = T;
    const plan = { edges: [], closes: 0, lanes: 0, gates: [], lesserRoads: [], quarters: [], blocks: [] };
    T.plan = plan;
    // The walls take in the people at the plan's density, and room besides for the castle, the
    // market and the places of worship, which hold no houses
    const people = insideShare(kind, input.population) * input.population;
    const fort = input.capital ? 230 * 165 : kind === "city" ? 120 * 90 : input.fortified ? 78 * 58 : 0;
    const M = PLAN.MARKET;
    const marketM2 = kind === "city" ? Math.min(M.cityMax, M.cityBase + input.population * M.cityPerHead) : Math.min(M.townMax, M.townBase + input.population * M.townPerHead);
    const worshipM2 = kind === "city" ? 125 * 85 + Math.max(0, Math.round(people / PLAN.WORSHIP_PEOPLE) - 1) * 52 * 40 : 62 * 46;
    const parkM2 = input.walled ? Math.PI * PLAN.PARK_RADIUS[1] ** 2 : 0;
    // A city's estates inside the walls hold one household each on their grounds (Estates.js)
    const estatesM2 = kind === "city" && input.walled ? Math.min(ESTATES.MAX.inner, Math.floor(people / ESTATES.PEOPLE.inner)) * (ESTATES.GROUNDS.inner[0] + ESTATES.GROUNDS.inner[1]) / 2 : 0;
    const extraHa = ((fort + marketM2 + worshipM2 + parkM2 + estatesM2) * PLAN.LANDMARK_ROOM) / 10000;
    const density = kind === "city" && input.population >= OUTER_WALL_PEOPLE && input.walled ? PLAN.GREAT_DENSITY : PLAN.DENSITY[kind];
    T.P = { ...T.P, density: people / (people / density + extraHa) };
    // ------------------------------------------------------------ 1. walls or core
    // A carved chamber has no walls: the rock is its wall, and its main chamber is the plan's ring
    // (V5a: the plan-first core inside the chamber, its tunnels coming in where gates would be)
    const cave = input.cave ? T.shore.cave : null;
    if (cave) {
        T.wall = null;
        T.outerWall = null;
        T.castle = null;
    } else buildWalls(T);
    // A great city's outer wall is not laid out ahead of its suburbs: it is thrown round them once
    // they have grown (Ken, 2026-11-15; Suburbs.js), so the ground inside it is built up
    plan.outerWanted = !!T.outerWall;
    T.outerWall = null;
    const ring = T.wall?.polygon ?? (cave ? caveRing(T, cave) : coreRing(T));
    plan.ring = ring;
    T.core = ring;
    T.coreRadius = Math.max(...ring.map((p) => dist(p, T.centre)));
    const box = bounds(ring);
    T.inCore = (p) => p[0] >= box[0] && p[0] <= box[2] && p[1] >= box[1] && p[1] <= box[3] && pointInPolygon(p, ring);
    const share = T.wall ? T.wall.share : cave ? caveShare(T, cave) : PLAN.CORE_SHARE;
    plan.insideHouses = Math.round((share * input.population) / T.P.perBuilding);
    T.coreCap = plan.insideHouses;
    // ------------------------------------------------------------ 2. gates and roads
    setGates(T, ring);
    // ------------------------------------------------------------ 3. focal points
    placeMarket(T);
    placeWorship(T, ring);
    // ------------------------------------------------------------ 4. the raster
    const step = PLAN.STEP[kind];
    const R = makeRaster([box[0] - 12, box[1] - 12, box[2] + 12, box[3] + 12], step);
    plan.raster = R;
    R.keepInside(ring);
    if (T.wall) {
        const v = T.wall.verts;
        for (let k = 0; k < v.length; k++) {
            const a = v[k], b = v[(k + 1) % v.length];
            R.stampLine([a.p, b.p], 6, CELL.BARRIER);
        }
    }
    if (T.castle) R.stampPolygon(grownPoly(T.castle.polygon, CASTLE_MARGIN_M), CELL.BARRIER);
    R.stampPolygon(T.market.polygon, CELL.BARRIER);
    // The market's edge is a frontage: a street on the raster, so lanes may end on it
    plan.marketEdge = addEdge(T, R, [...T.market.polygon, T.market.polygon[0]], 2, 0, "market");
    // A place of worship's yard and a margin round it, so no street's width runs over it; its own
    // street leaves from the door beyond the margin
    for (const w of T.worship) R.stampPolygon(grownPoly(w.yard, YARD_MARGIN_M), CELL.BARRIER);
    // The river and the sea bound blocks; a brook is crossed anywhere (by a culvert or a ford) and
    // only kept clear of houses
    const wetNear = (p) => T.sdAt(p) < 4 || (!T.river.brook && T.rdAt(p) - T.river.width / 2 < 4);
    for (let k = 0; k < R.cell.length; k++) if (R.cell[k] === CELL.FREE && wetNear(R.point(k))) R.cell[k] = CELL.BARRIER;
    // The bridge is the one way over the river
    if (T.bridge && !T.river.brook) {
        const [b0, b1] = T.bridge;
        const L = dist(b0, b1) || 1;
        const u = [(b1[0] - b0[0]) / L, (b1[1] - b0[1]) / L];
        const ends = [[b0[0] - u[0] * 8, b0[1] - u[1] * 8], [b1[0] + u[0] * 8, b1[1] + u[1] * 8]];
        for (let k = 0; k < R.cell.length; k++) {
            const p = R.point(k);
            if (R.cell[k] === CELL.BARRIER && segmentDistance(p, ends[0], ends[1]) < 4 && pointInPolygon(p, ring)) R.cell[k] = CELL.FREE;
        }
    }
    // ------------------------------------------------------------ 5. main and lesser streets
    mainStreets(T, R);
    // ------------------------------------------------------------ 6. quarters and their character
    const qLabels = new Int32Array(R.NX * R.NY).fill(-1);
    plan.quarters = components(R, qLabels);
    plan.quarterOf = qLabels;
    characterOfQuarters(T, R);
    // ------------------------------------------------------------ 7. the lane inside the wall, blocks
    plan.estateCounts = estateCounts(T, people);
    wallLane(T, R);
    splitBlocks(T, R);
    delete plan.laneEndCache;
    // ------------------------------------------------------------ 8. streets, occupancy
    assembleStreets(T);
    // ------------------------------------------------------------ 8b. estates inside the walls
    if (plan.estatePicks?.length) {
        const random = T.R("estates-inner");
        settleEstates(T, plan.estatePicks.map(({ ground }) => layOutEstate(T, ground, "inner", random, R)));
    }
    // ------------------------------------------------------------ 9. suburbs
    if (!cave) buildPlanSuburbs(T, ring);
    // ------------------------------------------------------------ 10. styles
    plan.styleAt = (p, n) => styleAt(T, p, n);
    // The lesser roads are roads from here on (fields, cemeteries, households read T.roads)
    T.roads.push(...plan.lesserRoads);
    // Plain data from here on (no object refers back to another): gates by index, streets by id
    const gateIndex = new Map(plan.gates.map((g, k) => [g, k]));
    for (const road of T.roads) if (road.gate) road.gate = { index: gateIndex.get(road.gate), p: road.gate.p };
    for (const e of plan.edges) if (e.gate) e.gate = gateIndex.get(e.gate);
    plan.gates = plan.gates.map((g) => ({ p: g.p, dir: g.dir, extra: !!g.extra, onBank: !!g.onBank, street: g.street ? g.street.id : null, roads: g.roads.map((r) => r.bearing), merged: g.roads.some((r) => r.merged) }));
    plan.lesserRoads = plan.lesserRoads.map((r) => r.bearing);
    T.wards = [];
    T.backLanes = [];
}

// ================================================================= the core of an unwalled town
function coreRing(T) {
    const people = T.input.population * PLAN.CORE_SHARE;
    const radius = Math.sqrt(((people / PLAN.CORE_DENSITY) * 10000) / Math.PI);
    const verts = ringAround(T, radius, 12, T.R("plan-core"));
    return verts.map((v) => v.p);
}

function bounds(poly) {
    const xs = poly.map((p) => p[0]);
    const ys = poly.map((p) => p[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

// ================================================================= gates
/**
 * One gate where each approach road first meets the ring coming in from the frame's edge (the road
 * is cut there and goes on as a main street); roads meeting the ring close together share a gate.
 * More gates as the wall grows, in the widest gaps between those it has, each with a lesser road
 * out towards the country. An unwalled core has the same openings, without gatehouses.
 */
function setGates(T, ring) {
    const { plan, kind, input } = T;
    const random = T.R("plan-gates");
    const gates = [];
    const n = ring.length;
    const edgeOnBank = (e) => T.wall && T.wall.verts[e].onBank && T.wall.verts[(e + 1) % n].onBank;
    const addGate = (p, dir, e) => {
        const old = gates.find((g) => dist(g.p, p) < PLAN.GATE_MERGE);
        if (old) return old;
        const gate = { p, dir, edge: e, roads: [], house: T.wall ? rect(p, dir, 16, 22) : null, onBank: edgeOnBank(e) };
        gates.push(gate);
        return gate;
    };
    // (a cavern's tunnels run through the rock to the chamber: none are merged outside it)
    if (!input.cave) mergeRoadsOutside(T, ring);
    for (const road of T.roads) {
        if (road.to) continue;
        const pts = road.points;
        let cut = null;
        for (let k = 0; k + 1 < pts.length && !cut; k++) {
            for (let e = 0; e < n; e++) {
                const x = segmentCross(pts[k], pts[k + 1], ring[e], ring[(e + 1) % n]);
                if (x && (!cut || x.s < cut.s)) cut = { k, s: x.s, p: x.p, e };
            }
        }
        if (!cut) continue;
        // A road that comes up to the wall and runs along its foot to a gate further round is given
        // its own gate where it first meets the wall instead (no road hugs the wall outside)
        for (let k = 1; k < cut.k; k++) {
            let best = null;
            for (let e = 0; e < n; e++) {
                const d = segmentDistance(pts[k], ring[e], ring[(e + 1) % n]);
                if (!best || d < best.d) best = { d, e };
            }
            if (best.d > PLAN.ROAD_NEAR_WALL_M) continue;
            if (edgeOnBank(best.e)) break;
            const g = nearestOnLine([ring[best.e], ring[(best.e + 1) % n]], pts[k]);
            if (T.castle && T.castle.polygon.some((q, e) => segmentDistance(g, q, T.castle.polygon[(e + 1) % 4]) < PLAN.GATE_CASTLE_CLEAR)) break;
            if (dist(g, cut.p) < PLAN.GATE_MERGE * 2) break;
            const a = ring[best.e], b = ring[(best.e + 1) % n];
            const dirIn = Math.atan2(g[1] - pts[k][1], g[0] - pts[k][0]);
            void a, b;
            const gate = addGate(g, dirIn, best.e);
            road.outside = [...pts.slice(0, k + 1), gate.p];
            road.gate = gate;
            gate.roads.push(road);
            cut.done = true;
            break;
        }
        if (cut.done) continue;
        const dir = Math.atan2(pts[cut.k + 1][1] - pts[cut.k][1], pts[cut.k + 1][0] - pts[cut.k][0]);
        const gate = addGate(cut.p, dir, cut.e);
        road.outside = [...pts.slice(0, cut.k + 1), gate.p];
        road.gate = gate;
        gate.roads.push(road);
    }
    // More gates by the wall's length and the people
    const perimeter = ring.reduce((a, p, k) => a + dist(p, ring[(k + 1) % n]), 0);
    let wanted = Math.max(gates.length, PLAN.GATES_MIN[kind], Math.round(perimeter / PLAN.GATE_SPACING[kind]));
    wanted = Math.min(wanted, gates.length + PLAN.GATES_EXTRA_MAX);
    const mid = centroid(ring);
    const bearingOf = (p) => Math.atan2(p[1] - mid[1], p[0] - mid[0]);
    for (let guard = 0; guard < 20 && gates.length < wanted; guard++) {
        const angles = gates.map((g) => bearingOf(g.p)).sort((a, b) => a - b);
        let best = null;
        if (!angles.length) best = { from: random.range(-Math.PI, Math.PI), gap: 2 * Math.PI };
        for (let k = 0; k < angles.length; k++) {
            const from = angles[k];
            const gap = k + 1 < angles.length ? angles[k + 1] - from : angles[0] + 2 * Math.PI - from;
            if (!best || gap > best.gap) best = { from, gap };
        }
        if (best.gap < Math.PI / 4) break;
        let placed = false;
        for (const share of [0.5, 0.4, 0.6, 0.3, 0.7]) {
            const a = best.from + best.gap * share;
            const hit = rayToRing(mid, a, ring);
            if (!hit || edgeOnBank(hit.e)) continue;
            const out = [Math.cos(a), Math.sin(a)];
            const beyond = [hit.p[0] + out[0] * 60, hit.p[1] + out[1] * 60];
            if (!T.inFrame(beyond) || T.wdAt(beyond) < 10 || T.wdAt(hit.p) < 10) continue;
            if (T.castle && T.castle.polygon.some((q, k) => segmentDistance(hit.p, q, T.castle.polygon[(k + 1) % 4]) < PLAN.GATE_CASTLE_CLEAR)) continue;
            if (gates.some((g) => dist(g.p, hit.p) < 120)) continue;
            const gate = addGate(hit.p, a, hit.e);
            gate.extra = true;
            const road = lesserRoad(T, gate, a, ring);
            if (!road) {
                // A gate with no way out is not built
                gates.splice(gates.indexOf(gate), 1);
                continue;
            }
            gate.roads.push(road);
            plan.lesserRoads.push(road);
            placed = true;
            break;
        }
        if (!placed) wanted--;
    }
    plan.gates = gates;
    plan.waterGates = T.wall ? T.wall.gates.filter((g) => g.water) : [];
    setWallGates(T);
}

/** The wall's gates are the plan's (and a sea wall's water gates); its towers are worked out again round them. */
function setWallGates(T) {
    if (!T.wall) return;
    const { plan } = T;
    T.wall.gates = [...plan.gates.map((g) => ({ p: g.p, dir: g.dir, road: g.roads[0] ?? null, house: g.house, extra: !!g.extra })), ...plan.waterGates];
    T.wall.towers = towersOf(T.wall.verts, T.wall.gates, stageRandom(T.input.seed, "towers"));
}

/** Approach roads that come within ROAD_MERGE_M of one another outside the ring become one from
 * there in (the later road joins the earlier), so no two roads run side by side to one gate. */
function mergeRoadsOutside(T, ring) {
    const order = { trunk: 0, main: 1, minor: 2 };
    const roads = T.roads.filter((r) => !r.to).sort((a, b) => (order[a.cls] ?? 3) - (order[b.cls] ?? 3));
    // (V6: where each road first comes inside the ring, found once rather than at every test; a
    // road's points change only after its own turn, so the earlier roads' stand)
    const firstIn = (r) => {
        const k = r.points.findIndex((q) => pointInPolygon(q, ring));
        return k < 0 ? Infinity : k;
    };
    const inAt = new Map();
    for (let b = 1; b < roads.length; b++) {
        const B = roads[b];
        const bIn = firstIn(B);
        for (let k = 0; k < B.points.length; k++) {
            const p = B.points[k];
            if (k >= bIn) break;
            let hit = null;
            for (let a = 0; a < b && !hit; a++) {
                const A = roads[a];
                if (!inAt.has(A) || inAt.get(A).points !== A.points) inAt.set(A, { points: A.points, k: firstIn(A) });
                const aIn = inAt.get(A).k;
                for (let m = 0; m + 1 < A.points.length; m++) {
                    if (m >= aIn) break;
                    if (segmentDistance(p, A.points[m], A.points[m + 1]) < PLAN.ROAD_MERGE_M) {
                        hit = { A, m };
                        break;
                    }
                }
            }
            if (!hit) continue;
            // Only where the two run on together (not where one crosses the other's line far out)
            const rest = B.points.slice(k);
            const restIn = rest.findIndex((q) => pointInPolygon(q, ring));
            if (restIn > 0 && hit.m < hit.A.points.length - 1) {
                const join = nearestOnLine([hit.A.points[hit.m], hit.A.points[hit.m + 1]], p);
                B.points = [...B.points.slice(0, k), join, ...hit.A.points.slice(hit.m + 1)];
                B.merged = true;
            }
            break;
        }
    }
}

function rayToRing(o, a, ring) {
    const far = [o[0] + Math.cos(a) * 1e5, o[1] + Math.sin(a) * 1e5];
    let best = null;
    for (let e = 0; e < ring.length; e++) {
        const x = segmentCross(o, far, ring[e], ring[(e + 1) % ring.length]);
        if (x && (!best || x.s < best.s)) best = { ...x, e };
    }
    return best;
}

// ================================================================= the market and places of worship
function placeMarket(T) {
    const { kind, input, centre: C, occupancy, plan } = T;
    const random = T.R("plan-market");
    // Along the main approach: the road of highest class, else the longest
    const order = { trunk: 0, main: 1, minor: 2 };
    const main = [...T.roads].filter((r) => r.gate).sort((a, b) => (order[a.cls] ?? 3) - (order[b.cls] ?? 3))[0];
    const angle = main ? Math.atan2(C[1] - main.gate.p[1], C[0] - main.gate.p[0]) : random.range(0, Math.PI);
    const M = PLAN.MARKET;
    const area = kind === "city" ? Math.min(M.cityMax, M.cityBase + input.population * M.cityPerHead) : Math.min(M.townMax, M.townBase + input.population * M.townPerHead);
    const ratio = random.range(1.3, 1.8);
    const long = Math.sqrt(area * ratio);
    const short = area / long;
    let c = C;
    let polygon = rect(c, angle, long, short).map((p) => [p[0] + random.range(-0.06, 0.06) * short, p[1] + random.range(-0.06, 0.06) * short]);
    // Inland of the water, and inside the ring
    const u = T.shore?.main?.u;
    for (let step = 0; step < 40 && (polygon.some((p) => T.wdAt(p) < 14 || !pointInPolygon(p, plan.ring)) || !dryOver(T, polygon, 6)); step++) {
        const toward = u ? [-u[0], -u[1]] : (() => {
            const m = centroid(plan.ring);
            const d = dist(m, c) || 1;
            return [(m[0] - c[0]) / d, (m[1] - c[1]) / d];
        })();
        polygon = polygon.map((p) => [p[0] + toward[0] * 6, p[1] + toward[1] * 6]);
        c = [c[0] + toward[0] * 6, c[1] + toward[1] * 6];
    }
    T.market = { kind: kind === "city" ? "square" : "place", polygon };
    T.marketAngle = angle;
    T.mainRoad = main ?? T.roads[0];
    occupancy.stampPolygon(polygon, RESERVED);
}

/** A city's great place of worship by the market; local ones through the walled ground (a town's
 * one near its market). All face one bearing of the place's own. */
function placeWorship(T, ring) {
    const { kind, input, occupancy, plan } = T;
    const random = T.R("plan-worship");
    const facing = random.range(-Math.PI, Math.PI);
    const marketC = centroid(T.market.polygon);
    const worship = [];
    const clearOf = (poly, margin) => {
        const grown = poly.map((p) => {
            const c = centroid(poly);
            const d = dist(p, c) || 1;
            return [c[0] + ((p[0] - c[0]) * (d + margin)) / d, c[1] + ((p[1] - c[1]) * (d + margin)) / d];
        });
        // Clear of the lane inside the wall (or round the core), which is laid later
        const laneClear = (T.wall ? PLAN.WALL_LANE_M : PLAN.CORE_LANE_M) + PLAN.WIDTH[kind][2] / 2 + 1.5;
        if (!grown.every((p) => pointInPolygon(p, ring) && T.wdAt(p) > laneClear)) return false;
        // Clear of the approach roads by their width, so no road runs over the yard (Ken, 2026-11-16)
        for (const road of T.roads) {
            const half = (road.width ?? 6) / 2 + 1.5;
            const pts = road.points;
            for (let k = 1; k < pts.length; k++) {
                if (grown.some((q, e) => segmentCross(pts[k - 1], pts[k], q, grown[(e + 1) % grown.length]))) return false;
                if (pointInPolygon(pts[k], grown) || grown.some((q, e) => segmentDistance(pts[k], q, grown[(e + 1) % grown.length]) < half)) return false;
            }
        }
        if (!dryOver(T, grown, 4)) return false;
        if (T.castle && grown.some((p) => pointInPolygon(p, T.castle.polygon))) return false;
        if (T.castle && T.castle.polygon.some((p) => pointInPolygon(p, grown))) return false;
        if (grown.some((p) => pointInPolygon(p, T.market.polygon)) || T.market.polygon.some((p) => pointInPolygon(p, grown))) return false;
        for (const g of plan.gates) if (pointInPolygon(g.p, grown) || grown.some((p) => dist(p, g.p) < 30)) return false;
        for (const w of worship) if (grown.some((p) => pointInPolygon(p, w.yard)) || w.yard.some((p) => pointInPolygon(p, grown))) return false;
        // Not over the line of a gate's way to the market
        for (const g of plan.gates) for (let t = 0.1; t < 0.95; t += 0.05) if (pointInPolygon(lerp(g.p, marketC, t), grown)) return false;
        return true;
    };
    const place = (target, size, yard, label, spiral = 3) => {
        for (let tries = 0; tries < 300; tries++) {
            const a = tries * 2.39996;
            const r = tries * spiral;
            const p = [target[0] + Math.cos(a) * r, target[1] + Math.sin(a) * r];
            const angle = facing + random.range(-0.1, 0.1);
            const yardPoly = rect(p, angle, yard[0], yard[1]);
            if (!clearOf(yardPoly, label === "great" ? 14 : 8)) continue;
            occupancy.stampPolygon(yardPoly, RESERVED);
            worship.push({ yard: yardPoly, body: worshipShape(p, angle, size[0], size[1], label === "great"), label });
            return true;
        }
        return false;
    };
    const mSize = Math.sqrt(polygonArea(T.market.polygon));
    if (kind === "city") {
        // Beside the market, off the side away from the main approach
        const t = T.marketAngle + Math.PI / 2;
        place([marketC[0] + Math.cos(t) * (mSize * 0.6 + 75), marketC[1] + Math.sin(t) * (mSize * 0.6 + 75)], [72, 26], [125, 85], "great");
        const inside = (T.wall?.share ?? PLAN.CORE_SHARE) * input.population;
        const local = Math.max(1, Math.round(inside / PLAN.WORSHIP_PEOPLE) - 1);
        const area = polygonArea(ring);
        const spacing = Math.sqrt(area / (local + 1)) * 0.75;
        const box = bounds(ring);
        const sites = [];
        for (let tries = 0; tries < local * 80 && sites.length < local; tries++) {
            const p = [random.range(box[0], box[2]), random.range(box[1], box[3])];
            if (!pointInPolygon(p, ring) || dist(p, marketC) < 170) continue;
            if ([...sites, ...worship.map((w) => centroid(w.yard))].some((q) => dist(p, q) < spacing)) continue;
            sites.push(p);
        }
        for (const site of sites) place(site, [30, 12], [52, 40], "local", 2);
    } else {
        const t = T.marketAngle + (random.chance(0.5) ? 1 : -1) * Math.PI / 2;
        place([marketC[0] + Math.cos(t) * (mSize * 0.55 + 45), marketC[1] + Math.sin(t) * (mSize * 0.55 + 45)], [36, 14], [62, 46], "local", 2.5);
    }
    T.worship = worship;
}

// ================================================================= the main streets
/** Gate to market for each gate, approach roads first (the highest class first); later streets
 * follow earlier ones where that is cheaper, and join one they meet rather than run beside it. */
function mainStreets(T, R) {
    const { plan, kind } = T;
    const [mainW, lesserW] = PLAN.WIDTH[kind];
    const n = R.NX * R.NY;
    const height = new Float32Array(n);
    const wander = new Float32Array(n);
    for (let k = 0; k < n; k++) {
        const p = R.point(k);
        height[k] = T.hAt(p);
        wander[k] = 1 + PLAN.WANDER * (T.noise.value(p[0] / PLAN.WANDER_M + 41.7, p[1] / PLAN.WANDER_M - 9.3) - 0.5) * 2;
    }
    // The cells beside the market, where a street arrives
    const marketNear = new Uint8Array(n);
    const mp = T.market.polygon;
    const mc = centroid(mp);
    const mb = bounds(mp);
    for (let k = 0; k < n; k++) {
        const p = R.point(k);
        if (p[0] < mb[0] - 8 || p[0] > mb[2] + 8 || p[1] < mb[1] - 8 || p[1] > mb[3] + 8) continue;
        if (R.cell[k] === CELL.BARRIER) continue;
        let d = Infinity;
        for (let e = 0; e < mp.length; e++) d = Math.min(d, segmentDistance(p, mp[e], mp[(e + 1) % mp.length]));
        if (d < R.step * 2.2) marketNear[k] = 1;
    }
    let streetDist = null;
    const refreshDistance = () => {
        const seeds = new Uint8Array(n);
        for (let k = 0; k < n; k++) seeds[k] = R.cell[k] === CELL.STREET ? 1 : 0;
        streetDist = distanceTransform2(seeds, R.NX, R.NY, R.step);
    };
    refreshDistance();
    const order = { trunk: 0, main: 1, minor: 2, lesser: 3 };
    const gates = [...plan.gates].sort((a, b) => Math.min(...a.roads.map((r) => order[r.cls] ?? 3), 9) - Math.min(...b.roads.map((r) => order[r.cls] ?? 3), 9));
    for (const gate of gates) {
        const lesser = gate.roads.every((r) => r.lesser) || !gate.roads.length;
        const rank = lesser ? 1 : 0;
        const half = (lesser ? lesserW : mainW) / 2;
        // The first cell inside the gate
        const mid = centroid(plan.ring);
        const inward = (() => {
            const d = dist(mid, gate.p) || 1;
            return [(mid[0] - gate.p[0]) / d, (mid[1] - gate.p[1]) / d];
        })();
        let startP = gate.p;
        let start = -1;
        for (let s = 2; s < 40; s += 1) {
            const q = [gate.p[0] + inward[0] * s, gate.p[1] + inward[1] * s];
            const k = R.at(q);
            if (k >= 0 && R.cell[k] !== CELL.BARRIER) {
                start = k;
                startP = q;
                break;
            }
        }
        if (start < 0) continue;
        const startPt = R.point(start);
        // A street joins another only where that one is well on its way to the market
        const toMarket = dist(startPt, mc);
        const isEnd = (k) => marketNear[k] || (R.cell[k] === CELL.STREET && R.rank[k] <= 1 && dist(R.point(k), startPt) > PLAN.JOIN_AFTER_M && dist(R.point(k), mc) < toMarket * (lesser ? PLAN.JOIN_PROGRESS_LESSER : PLAN.JOIN_PROGRESS));
        const costOf = (m, k) => {
            const c = R.cell[m];
            if (c === CELL.BARRIER) return m === start ? 1 : Infinity;
            let cost = wander[m];
            if (k >= 0) {
                const rise = Math.abs(height[m] - height[k]) / R.step;
                cost += (rise / PLAN.GRADE) ** 2;
            }
            if (c === CELL.STREET) return cost * PLAN.FOLLOW;
            const d = streetDist[m];
            if (d < PLAN.KEEP_OFF_M) cost *= 1 + PLAN.KEEP_OFF * (1 - d / PLAN.KEEP_OFF_M);
            return cost;
        };
        const path = route(R, start, isEnd, costOf);
        if (!path) continue;
        const endCell = path[path.length - 1];
        let points = path.map((k) => R.point(k));
        let endP;
        let joins = null;
        if (marketNear[endCell]) endP = nearestOnRing(mp, points[points.length - 1]);
        else {
            const id = R.edge[endCell] - 1;
            const e = plan.edges[id];
            endP = e ? nearestOnLine(e.points, points[points.length - 1]) : points[points.length - 1];
            joins = e ?? null;
        }
        points = smooth([gate.p, startP, ...points.slice(1, -1), endP], R.step);
        const edge = addEdge(T, R, points, half, rank, lesser ? "lesser" : "main", { gate, joins: joins?.id ?? null, market: !joins });
        gate.street = edge;
        refreshDistance();
    }
    // A gate whose street could not be laid is not built (with its lesser road); an approach road
    // whose could not runs straight on to the market
    for (const gate of [...plan.gates]) {
        if (gate.street) continue;
        if (gate.roads.every((r) => r.lesser)) {
            plan.gates.splice(plan.gates.indexOf(gate), 1);
            plan.lesserRoads = plan.lesserRoads.filter((r) => !gate.roads.includes(r));
        } else {
            const end = nearestOnRing(mp, gate.p);
            gate.street = addEdge(T, R, smooth([gate.p, lerp(gate.p, end, 0.5), end], R.step), mainW / 2, 0, "main", { gate, market: true });
        }
    }
    setWallGates(T);
    // Secondary streets: from each focal point's door (the castle's gate, a place of worship's
    // porch) to the nearest main street or the market
    for (const door of focalDoors(T)) {
        const k0 = R.at(door.out);
        if (k0 < 0 || R.cell[k0] === CELL.BARRIER) continue;
        // Already on a street: the door's own cell within a few metres of one
        const kd = R.at(door.p);
        if (streetDist[k0] < 6 && kd >= 0 && streetDist[kd] < 7) continue;
        const startPt = R.point(k0);
        const isEnd = (k) => marketNear[k] || (R.cell[k] === CELL.STREET && R.rank[k] <= 1 && dist(R.point(k), startPt) > 8);
        const costOf = (m, k) => {
            const c = R.cell[m];
            if (c === CELL.BARRIER) return Infinity;
            let cost = wander[m];
            if (k >= 0) cost += (Math.abs(height[m] - height[k]) / R.step / PLAN.GRADE) ** 2;
            if (c === CELL.STREET) return cost * PLAN.FOLLOW;
            const d = streetDist[m];
            if (d < PLAN.KEEP_OFF_M) cost *= 1 + PLAN.KEEP_OFF * (1 - d / PLAN.KEEP_OFF_M);
            return cost;
        };
        const path = route(R, k0, isEnd, costOf);
        if (!path || path.length < 3) continue;
        const endCell = path[path.length - 1];
        let points = path.map((k) => R.point(k));
        let endP;
        let joins = null;
        if (marketNear[endCell]) endP = nearestOnRing(mp, points[points.length - 1]);
        else {
            const e = plan.edges[R.edge[endCell] - 1];
            endP = e ? nearestOnLine(e.points, points[points.length - 1]) : points[points.length - 1];
            joins = e ?? null;
        }
        points = smooth([door.p, ...points.slice(0, -1), endP], R.step);
        addEdge(T, R, points, lesserW / 2, 1, "secondary", { joins: joins?.id ?? null, serves: door.what });
        refreshDistance();
    }
    // Each road goes on as its gate's street, and (where that street joins another) along that one
    // to the market, so a road is one line from the frame to the market
    for (const road of [...T.roads, ...plan.lesserRoads]) {
        if (!road.gate?.street) continue;
        const inner = [];
        let e = road.gate.street;
        for (let guard = 0; e && guard < 10; guard++) {
            const from = inner.length ? nearestIndex(e.points, inner[inner.length - 1]) : 0;
            inner.push(...e.points.slice(from + (inner.length ? 1 : 0)));
            e = e.joins != null ? plan.edges[e.joins] : null;
        }
        // ... and on to the market's middle, as every road ran to the centre before (what reads
        // T.roads, the fields and the households, keeps its meaning)
        road.points = [...road.outside, ...inner.slice(1), mc];
    }
}

/** The doors the secondary streets start from: the castle's side facing the town, each place of
 * worship's entrance end (a great one's gateway). */
function focalDoors(T) {
    const doors = [];
    const facing = (poly, toward) => {
        let best = null;
        for (let k = 0; k < poly.length; k++) {
            const m = lerp(poly[k], poly[(k + 1) % poly.length], 0.5);
            if (!best || dist(m, toward) < dist(best, toward)) best = m;
        }
        const c = centroid(poly);
        const d = dist(best, c) || 1;
        return { p: best, u: [(best[0] - c[0]) / d, (best[1] - c[1]) / d] };
    };
    if (T.castle) {
        const f = facing(T.castle.polygon, T.centre);
        doors.push({ p: f.p, out: [f.p[0] + f.u[0] * 8, f.p[1] + f.u[1] * 8], what: "castle" });
    }
    for (const w of T.worship) {
        const c = centroid(w.yard);
        const front = centroid(w.label === "great" ? w.body[3] : w.body[1]);
        const d = dist(front, c) || 1;
        const u = [(front[0] - c[0]) / d, (front[1] - c[1]) / d];
        let reach = 0;
        while (reach < 300 && pointInPolygon([c[0] + u[0] * reach, c[1] + u[1] * reach], w.yard)) reach += 1;
        const p = [c[0] + u[0] * reach, c[1] + u[1] * reach];
        doors.push({ p, out: [p[0] + u[0] * 8, p[1] + u[1] * 8], what: "worship" });
    }
    return doors;
}

function smooth(points, step) {
    const s = simplify(points, step * 1.6);
    const c = chaikin(s, 3);
    c[0] = points[0];
    c[c.length - 1] = points[points.length - 1];
    return c;
}

function addEdge(T, R, points, half, rank, kind, extra = {}) {
    const id = T.plan.edges.length;
    const edge = { id, points, half, rank, kind, ...extra };
    T.plan.edges.push(edge);
    R.stampLine(points, half, CELL.STREET, { r: rank, id });
    return edge;
}

function nearestOnLine(points, p) {
    let best = null;
    for (let k = 0; k + 1 < points.length; k++) {
        const a = points[k], b = points[k + 1];
        const ab = [b[0] - a[0], b[1] - a[1]];
        const L2 = ab[0] * ab[0] + ab[1] * ab[1] || 1;
        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / L2));
        const q = [a[0] + ab[0] * t, a[1] + ab[1] * t];
        const d = dist(p, q);
        if (!best || d < best.d) best = { q, d };
    }
    return best ? best.q : p;
}

function nearestOnRing(ring, p) {
    return nearestOnLine([...ring, ring[0]], p);
}

function nearestIndex(points, p) {
    let best = 0;
    for (let k = 1; k < points.length; k++) if (dist(points[k], p) < dist(points[best], p)) best = k;
    return best;
}

function distanceTransform2(seeds, NX, NY, step) {
    // Two-pass chamfer distance (3-4), in metres: quick and close enough for keeping streets apart
    const INF = 1e9;
    const d = new Float32Array(NX * NY);
    for (let k = 0; k < d.length; k++) d[k] = seeds[k] ? 0 : INF;
    const a = step, b = step * Math.SQRT2;
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
        const k = j * NX + i;
        let v = d[k];
        if (i > 0) v = Math.min(v, d[k - 1] + a);
        if (j > 0) {
            v = Math.min(v, d[k - NX] + a);
            if (i > 0) v = Math.min(v, d[k - NX - 1] + b);
            if (i < NX - 1) v = Math.min(v, d[k - NX + 1] + b);
        }
        d[k] = v;
    }
    for (let j = NY - 1; j >= 0; j--) for (let i = NX - 1; i >= 0; i--) {
        const k = j * NX + i;
        let v = d[k];
        if (i < NX - 1) v = Math.min(v, d[k + 1] + a);
        if (j < NY - 1) {
            v = Math.min(v, d[k + NX] + a);
            if (i < NX - 1) v = Math.min(v, d[k + NX + 1] + b);
            if (i > 0) v = Math.min(v, d[k + NX - 1] + b);
        }
        d[k] = v;
    }
    return d;
}

// ================================================================= quarters
function characterOfQuarters(T, R) {
    const { plan, kind } = T;
    const marketC = centroid(T.market.polygon);
    const ringArea = polygonArea(plan.ring);
    const near = (cells, poly, within) => {
        // Any of the quarter's cells within `within` m of the polygon
        const b = bounds(poly);
        for (let s = 0; s < cells.length; s += 3) {
            const p = R.point(cells[s]);
            if (p[0] < b[0] - within || p[0] > b[2] + within || p[1] < b[1] - within || p[1] > b[3] + within) continue;
            if (pointInPolygon(p, poly)) return true;
            for (let e = 0; e < poly.length; e++) if (segmentDistance(p, poly[e], poly[(e + 1) % poly.length]) < within) return true;
        }
        return false;
    };
    for (const q of plan.quarters) {
        const ax = axes(R, q.cells);
        q.centre = ax.c;
        q.dMarket = dist(ax.c, marketC);
        q.byMarket = near(q.cells, T.market.polygon, 14);
        q.byCastle = !!T.castle && near(q.cells, T.castle.polygon, 30);
        q.byWorship = T.worship.some((w) => near(q.cells, w.yard, 24));
        q.byWater = q.cells.some((k, s) => s % 5 === 0 && T.wdAt(R.point(k)) < 30);
        q.tier = null;
    }
    // Upper quarters: by the castle or a place of worship, not on the market; nearest those first,
    // up to UPPER_SHARE of the walled ground
    // (pre-sign-off, 2026-11-17, in a city: and the quiet quarters a street away from them, within the upper
    // tier's reach, so the upper tier has ground enough; it had fallen as blocks grew, Graymoutht's
    // from 53 houses to 28, most of its frontage taken by the grounds it sits beside)
    for (const q of plan.quarters) q.nearLandmark = T.kind === "city" && !q.byCastle && !q.byWorship && ((T.castle && near(q.cells, T.castle.polygon, PLAN.UPPER_REACH[T.kind])) || T.worship.some((w) => !w.suburb && near(q.cells, w.yard, PLAN.UPPER_REACH[T.kind])));
    const candidates = plan.quarters.filter((q) => (q.byCastle || q.byWorship || q.nearLandmark) && !q.byMarket && q.area > 2000).sort((a, b) => Number(b.byCastle || b.byWorship) - Number(a.byCastle || a.byWorship) || b.dMarket - a.dMarket);
    let upperArea = 0;
    for (const q of candidates) {
        if (upperArea + q.area > ringArea * PLAN.UPPER_SHARE[T.kind] && upperArea > 0) continue;
        q.tier = "upper";
        upperArea += q.area;
    }
    // A place with a castle or a place of worship but no quiet quarter by it takes the quarter by
    // the castle (or the farthest from the market by a place of worship) anyway
    if (!upperArea) {
        const q = plan.quarters.filter((x) => x.area > 2000 && (x.byCastle || x.byWorship)).sort((a, b) => Number(b.byCastle) - Number(a.byCastle) || b.dMarket - a.dMarket)[0];
        if (q) q.tier = "upper";
    }
    void kind;
}

/** The box (m) round a block's cells. */
function cellsBox(R, block) {
    if (block.box) return block.box;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const c of block.cells) {
        const p = R.point(c);
        if (p[0] < x0) x0 = p[0];
        if (p[0] > x1) x1 = p[0];
        if (p[1] < y0) y0 = p[1];
        if (p[1] > y1) y1 = p[1];
    }
    return (block.box = [x0, y0, x1, y1]);
}

/** The box round a polygon. */
function boxOfPoly(poly) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of poly) {
        if (p[0] < x0) x0 = p[0];
        if (p[0] > x1) x1 = p[0];
        if (p[1] < y0) y0 = p[1];
        if (p[1] > y1) y1 = p[1];
    }
    return [x0, y0, x1, y1];
}

/** A block's tier, from its quarter, what it fronts and how near the market it is. */
function tierOfBlock(T, R, block) {
    const { plan, kind } = T;
    const ax = block.ax ?? axes(R, block.cells);
    block.ax = ax;
    const marketC = centroid(T.market.polygon);
    const d = dist(ax.c, marketC);
    const qLabel = plan.quarterOf[block.cells[Math.floor(block.cells.length / 2)]];
    const quarter = plan.quarters[qLabel];
    block.upperQuarter = quarter?.tier === "upper";
    if (ax.short < PLAN.STRIP_M) {
        block.strip = true;
        return "lower";
    }
    const onMain = block.minRank === 0;
    if (block.byLandmark === undefined) {
        const marks = [...(T.castle ? [T.castle.polygon] : []), ...T.worship.filter((w) => !w.suburb).map((w) => w.yard)];
        // (V6: a landmark whose box lies more than 25 m from the block's is passed over at once)
        const bb = cellsBox(R, block);
        block.byLandmark = marks.some((poly) => {
            const pb = boxOfPoly(poly);
            if (pb[0] > bb[2] + 25 || pb[2] < bb[0] - 25 || pb[1] > bb[3] + 25 || pb[3] < bb[1] - 25) return false;
            for (let s = 0; s < block.cells.length; s += 4) {
                const p = R.point(block.cells[s]);
                for (let e = 0; e < poly.length; e++) if (segmentDistance(p, poly[e], poly[(e + 1) % poly.length]) < 25) return true;
            }
            return false;
        });
    }
    // By the market and along the high streets; in a small town the distances shrink with its walls
    const middleM = Math.min(PLAN.MIDDLE_M[kind], T.coreRadius * 0.38);
    const highM = Math.min(PLAN.HIGH_STREET_M[kind], T.coreRadius * 0.7);
    if (d < middleM || (onMain && d < highM)) return "middle";
    // Upper: quiet blocks near the castle or a place of worship, in an upper quarter or beside it
    if (!onMain && d > middleM * 0.8) {
        const reach = PLAN.UPPER_REACH[kind];
        // (measured from the block's near side, so a large quiet block is not lost for its size)
        const dLand = Math.min(1e9, ...landmarks(T).map((poly) => distToPoly(ax.c, poly))) - (kind === "city" ? ax.short / 2 : 0);
        if ((quarter?.tier === "upper" && dLand < reach) || block.byLandmark) return "upper";
    }
    return "lower";
}

function landmarks(T) {
    return [...(T.castle ? [T.castle.polygon] : []), ...T.worship.filter((w) => !w.suburb).map((w) => w.yard)];
}

function distToPoly(p, poly) {
    if (pointInPolygon(p, poly)) return 0;
    let d = Infinity;
    for (let e = 0; e < poly.length; e++) d = Math.min(d, segmentDistance(p, poly[e], poly[(e + 1) % poly.length]));
    return d;
}

// ================================================================= the lane inside the wall
function wallLane(T, R) {
    const { plan, kind } = T;
    const ring = plan.ring;
    // A town's core has a back lane round its edge where a walled town has the lane inside its wall
    const inner = offsetRingInward(ring, T.wall ? PLAN.WALL_LANE_M : PLAN.CORE_LANE_M);
    const dense = [];
    for (let k = 0; k < inner.length; k++) {
        const a = inner[k], b = inner[(k + 1) % inner.length];
        const steps = Math.max(1, Math.ceil(dist(a, b) / 4));
        for (let u = 0; u < steps; u++) dense.push(lerp(a, b, u / steps));
    }
    // Start the walk at a point that is not usable, so runs do not wrap
    const usable = (p) => {
        const k = R.at(p);
        if (k < 0) return false;
        if (R.cell[k] === CELL.BARRIER) return false;
        if (T.wdAt(p) < 6) return false;
        if (T.castle && T.castle.polygon.some((q, e) => segmentDistance(p, q, T.castle.polygon[(e + 1) % 4]) < 6)) return false;
        return true;
    };
    // Where a main or lesser street runs along the wall, the lane gives way to it (it still crosses them)
    const mains = T.plan.edges.filter((e) => e.rank <= 1 && e.kind !== "market");
    const near = dense.map((p) => mains.some((e) => e.points.some((q, k) => k + 1 < e.points.length && segmentDistance(p, q, e.points[k + 1]) < e.half + PLAN.WIDTH[kind][2] / 2 + 3)));
    const blocked = new Uint8Array(dense.length);
    for (let k = 0; k < dense.length; k++) {
        if (!near[k]) continue;
        let m = k;
        while (m < dense.length && near[m]) m++;
        if ((m - k) * 4 > 16) for (let q = k; q < m; q++) blocked[q] = 1;
        k = m;
    }
    // Not along a stretch the water closes (the quay's side of a port, a river bank)
    if (T.wall) {
        const v = T.wall.verts;
        for (let k = 0; k < dense.length; k++) {
            let best = null;
            for (let e = 0; e < ring.length; e++) {
                const d = segmentDistance(dense[k], ring[e], ring[(e + 1) % ring.length]);
                if (!best || d < best.d) best = { d, e };
            }
            if (v[best.e].onBank && v[(best.e + 1) % v.length].onBank) blocked[k] = 1;
        }
    }
    const usable0 = usable;
    const usableAt = (p, idx) => !blocked[idx] && usable0(p);
    let first = dense.findIndex((p, idx) => !usableAt(p, idx));
    if (first < 0) first = 0;
    const runs = [];
    let run = [];
    for (let s = 0; s <= dense.length; s++) {
        const idx = (first + s) % dense.length;
        const p = dense[idx];
        if (usableAt(p, idx) && s < dense.length) run.push(p);
        else {
            if (run.length * 4 >= 30) runs.push(run);
            run = [];
        }
    }
    // A run all round the wall closes on itself
    if (runs.length === 0 && run.length) runs.push([...dense, dense[0]]);
    const half = PLAN.WIDTH[kind][2] / 2;
    for (const points of runs) {
        const pts = smooth(points, R.step);
        addEdge(T, R, pts, half, 2, "wall");
    }
}

function offsetRingInward(ring, by) {
    const area = ring.reduce((a, p, k) => a + p[0] * ring[(k + 1) % ring.length][1] - ring[(k + 1) % ring.length][0] * p[1], 0);
    const sign = area > 0 ? 1 : -1;
    const n = ring.length;
    const lines = ring.map((a, k) => {
        const b = ring[(k + 1) % n];
        const L = dist(a, b) || 1;
        // Inward normal: for counter-clockwise (in these axes, positive area) it is the left of travel
        const nn = [(-(b[1] - a[1]) / L) * sign, ((b[0] - a[0]) / L) * sign];
        return { a: [a[0] + nn[0] * by, a[1] + nn[1] * by], b: [b[0] + nn[0] * by, b[1] + nn[1] * by] };
    });
    return lines.map((l, k) => {
        const m = lines[(k + n - 1) % n];
        const x = lineIntersection(m.a, m.b, l.a, l.b);
        return x && dist(x, l.a) < by * 4 ? x : l.a;
    });
}

function lineIntersection(a, b, c, d) {
    const r = [b[0] - a[0], b[1] - a[1]];
    const s = [d[0] - c[0], d[1] - c[1]];
    const den = r[0] * s[1] - r[1] * s[0];
    if (Math.abs(den) < 1e-9) return null;
    const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
    return [a[0] + r[0] * t, a[1] + r[1] * t];
}

// ================================================================= blocks and their lanes
/** A block larger than this (m²) is cut before it may be an estate. */
const ESTATE_BLOCK_MAX = 14000;

function splitBlocks(T, R) {
    const { plan, kind } = T;
    const random = T.R("plan-lanes");
    const labels = new Int32Array(R.NX * R.NY).fill(-1);
    let blocks = components(R, labels);
    // Slivers (between the lane and the wall, at sharp junctions) are not blocks
    for (const b of blocks) if (b.area < PLAN.SLIVER_M2) for (const k of b.cells) {
        R.cell[k] = CELL.BARRIER;
        labels[k] = -1;
    }
    blocks = blocks.filter((b) => b.area >= PLAN.SLIVER_M2);
    let next = blocks.length;
    // A park in the walled ground (or the core), laid out with the plan: a quiet block away from
    // the market, wide enough for a green
    if (reservePark(T, R, blocks, labels)) {
        labels.fill(-1);
        blocks = components(R, labels).filter((b) => b.area >= PLAN.SLIVER_M2);
        next = blocks.length;
    }
    const style = STYLE[kind];
    const half = PLAN.WIDTH[kind][2] / 2;
    const capacityOf = (b) => (b.streetTouch * R.step * PLAN.FRONTAGE_USE[kind]) / ((style[b.tier].plotW[0] + style[b.tier].plotW[1]) / 2);
    for (const b of blocks) b.tier = tierOfBlock(T, R, b);
    let capacity = blocks.reduce((a, b) => a + capacityOf(b), 0);
    const wanted = plan.insideHouses * PLAN.CAPACITY[kind];
    const stuck = new Set();
    // Estates inside the walls (Ken, 2026-11-15): great houses in their grounds, each taking almost
    // a block. A block on its way to being cut that is about an estate's size, quiet (the upper
    // tier's, or far from the market) and not on the market, is taken as one instead
    plan.estatePicks = [];
    const wantEstates = plan.estateCounts?.inner ?? 0;
    const mc = centroid(T.market.polygon);
    const quietFor = (b) => !b.fronts.has(plan.marketEdge.id) && (b.tier === "upper" || dist((b.ax ?? (b.ax = axes(R, b.cells))).c, mc) > T.coreRadius * 0.45);
    const tryEstate = (b) => {
        if (plan.estatePicks.length >= wantEstates || !quietFor(b) || b.area > ESTATE_BLOCK_MAX) return false;
        const got = pickEstateBlocks(R, labels, [b], 1, "inner", plan.estatePicks, T.worship, (poly) => dryOver(T, poly, 4));
        if (!got.length) return false;
        plan.estatePicks.push(got[0]);
        stuck.add(b.label);
        capacity -= capacityOf(b);
        return true;
    };
    for (let guard = 0; guard < 2000; guard++) {
        // Past the frontage the town needs, only the upper tier's blocks are still cut to size
        const full = capacity >= wanted;
        let pick = null;
        for (const b of blocks) {
            // ... and the blocks of an upper quarter, so it keeps its quiet blocks off the main
            // streets however few lanes the rest of the town needs
            const quiet = b.tier === "upper" || b.upperQuarter;
            if (stuck.has(b.label) || b.strip || (full && !quiet)) continue;
            const ratio = b.area / PLAN.BLOCK_M2[kind][full && quiet ? "upper" : b.tier];
            // Short of frontage, blocks are cut below their tier's size (down to about half of it)
            if (ratio > (full ? 1.15 : 0.6) && (!pick || ratio > pick.ratio)) pick = { b, ratio };
        }
        if (!pick) break;
        const b = pick.b;
        if (tryEstate(b)) continue;
        const cut = cutBlock(T, R, b, labels, random);
        if (!cut) {
            stuck.add(b.label);
            continue;
        }
        const close = cut.close;
        const edge = addEdge(T, R, cut.points, half, 2, close ? "close" : "lane");
        edge.close = close;
        edge.toWater = !!cut.toWater;
        if (close) plan.closes++;
        plan.lanes++;
        // The block's cells again, split in two (or more)
        for (const k of b.cells) labels[k] = -1;
        const parts = components(R, labels, b.cells, next);
        next += parts.length;
        blocks = blocks.filter((x) => x !== b);
        capacity -= capacityOf(b);
        for (const p of parts) {
            p.tier = tierOfBlock(T, R, p);
            capacity += capacityOf(p);
            blocks.push(p);
        }
    }
    // Short of estates still: the largest quiet blocks left, the upper tier's first
    if (plan.estatePicks.length < wantEstates) {
        const order = blocks.filter((b) => !stuck.has(b.label)).sort((x, y) => (x.tier === "upper" ? 0 : 1) - (y.tier === "upper" ? 0 : 1) || y.area - x.area);
        for (const b of order) if (plan.estatePicks.length < wantEstates) tryEstate(b);
    }
    plan.blocks = blocks.map((b) => ({ label: b.label, area: b.area, tier: b.tier, centre: b.ax?.c ?? axes(R, b.cells).c, fronts: b.minRank }));
    plan.blockLabels = labels;
    plan.blockList = blocks;
    plan.capacity = Math.round(capacity);
}

function reservePark(T, R, blocks, labels) {
    const { plan } = T;
    if (!T.wall) return;
    const random = T.R("plan-park");
    const r0 = random.range(PLAN.PARK_RADIUS[0], PLAN.PARK_RADIUS[1]);
    const marketC = centroid(T.market.polygon);
    const order = [...blocks].sort((a, b) => b.area - a.area);
    // A small walled town's blocks may only take a smaller green
    for (const r of [r0, PLAN.PARK_RADIUS[0], PLAN.PARK_SMALLEST]) for (const b of order) {
        const ax = axes(R, b.cells);
        if (dist(ax.c, marketC) < r + 60 || ax.short < 2 * r + 24) continue;
        // Every cell of the green and a margin round it in this block
        const reach = r + 6;
        let fits = true;
        for (let y = -reach; y <= reach && fits; y += R.step) for (let x = -reach; x <= reach && fits; x += R.step) {
            if (x * x + y * y > reach * reach) continue;
            const k = R.at([ax.c[0] + x, ax.c[1] + y]);
            if (k < 0 || labels[k] !== b.label) fits = false;
        }
        if (!fits) continue;
        if (!dryOver(T, Array.from({ length: 16 }, (_, k) => [ax.c[0] + Math.cos((k / 16) * 2 * Math.PI) * reach, ax.c[1] + Math.sin((k / 16) * 2 * Math.PI) * reach]), 2)) continue;
        plan.park = { c: ax.c, r };
        const ring = Array.from({ length: 24 }, (_, k) => [ax.c[0] + Math.cos((k / 24) * 2 * Math.PI) * (r + 2), ax.c[1] + Math.sin((k / 24) * 2 * Math.PI) * (r + 2)]);
        R.stampPolygon(ring, CELL.BARRIER);
        // The block is the same block, its middle taken
        const kept = b.cells.filter((k) => R.cell[k] === CELL.FREE);
        for (const k of b.cells) if (R.cell[k] !== CELL.FREE) labels[k] = -1;
        b.cells = kept;
        b.area = kept.length * R.step * R.step;
        return true;
    }
    return false;
}

/** A lane across the block's long axis, joining the streets either side (or a close from one). */
function cutBlock(T, R, b, labels, random) {
    const { plan } = T;
    const ax = b.ax ?? axes(R, b.cells);
    if (ax.long < PLAN.BLOCK_MIN_LONG * 2) {
        return null;
    }
    const allowClose = b.tier === "upper" && b.area > PLAN.BLOCK_M2[T.kind].upper * 1.6 && plan.closes < Math.max(1, (plan.lanes + 1) * PLAN.CLOSE_SHARE);
    const offsets = [0, 0.1, -0.1, 0.2, -0.2, 0.28, -0.28].map((f) => (f + random.range(-0.05, 0.05)) * ax.long);
    // A slight skew from square, and failing that, more
    const base = random.range(-0.12, 0.12);
    const tries = [];
    for (const turn of [0, 0.3, -0.3, 0.55, -0.55]) for (const off of offsets) tries.push({ off, skew: base + turn });
    let fallback = null;
    for (const { off, skew } of tries) {
        const v = [ax.v[0] * Math.cos(skew) - ax.v[1] * Math.sin(skew), ax.v[0] * Math.sin(skew) + ax.v[1] * Math.cos(skew)];
        const c = [ax.c[0] + ax.u[0] * off, ax.c[1] + ax.u[1] * off];
        const k0 = R.at(c);
        if (k0 < 0 || labels[k0] !== b.label) {
            continue;
        }
        const ends = [1, -1].map((sgn) => trace(R, c, [v[0] * sgn, v[1] * sgn], labels, b.label));
        if (ends.some((e) => !e)) continue;
        const [ea, eb] = ends;
        // Each part keeps a fair share of the block
        let left = 0;
        for (const k of b.cells) {
            const p = R.point(k);
            if ((p[0] - c[0]) * ax.u[0] + (p[1] - c[1]) * ax.u[1] < 0) left++;
        }
        const share = left / b.cells.length;
        if (share < 0.2 || share > 0.8) {
            continue;
        }
        // A lane may run down to the water's edge (a landing, a quay)
        for (const e of [ea, eb]) if (!e.street && T.wdAt(e.p) < 8) e.water = true;
        if ((ea.street || ea.water) && (eb.street || eb.water) && (ea.street || eb.street)) {
            const a = snapToEdge(T, ea);
            const z = snapToEdge(T, eb);
            if (dist(a, z) < PLAN.LANE_MIN) {
                continue;
            }
            const m = lerp(a, z, 0.5);
            const bend = random.range(-0.06, 0.06) * dist(a, z);
            const mid = [m[0] + ax.u[0] * bend, m[1] + ax.u[1] * bend];
            const points = smooth([a, lerp(a, mid, 0.5), mid, lerp(mid, z, 0.5), z], R.step);
            if (besideAnother(T, points)) continue;
            const lane = { points, close: false, toWater: !!(ea.water || eb.water) };
            // A lane that would fan out from another's end is the last choice: cut after cut through
            // wedge-shaped blocks had spread thin lanes from one point (Freyshield's castle;
            // pre-sign-off, 2026-11-17). Cities only: a town's few lanes do not fan
            if (T.kind === "city" && laneEndsCrowd(T, a, z)) {
                fallback ??= lane;
                continue;
            }
            return lane;
        }
        if (allowClose && (ea.street || eb.street) && !plan.edges.some((e) => e.close && dist(e.points[e.points.length - 1], c) < PLAN.CLOSE_APART_M)) {
            const from = ea.street ? ea : eb;
            const a = snapToEdge(T, from);
            const reach = random.range(PLAN.CLOSE_REACH[0], PLAN.CLOSE_REACH[1]);
            const span = dist(ea.p, eb.p);
            const dir = [(c[0] - a[0]) / (dist(c, a) || 1), (c[1] - a[1]) / (dist(c, a) || 1)];
            const z = [a[0] + dir[0] * span * reach, a[1] + dir[1] * span * reach];
            if (dist(a, z) < PLAN.LANE_MIN * 1.5) continue;
            return { points: smooth([a, lerp(a, z, 0.5), z], R.step), close: true };
        }
    }
    return fallback;
}

/**
 * Whether a lane from a to z would leave from another lane's end at a narrow angle to it: the
 * signature of a fan, where cut after cut through wedge-shaped blocks spreads thin lanes out from
 * one point. Lanes meeting at a wide angle (a crossroads, a T) are left alone.
 */
function laneEndsCrowd(T, a, z) {
    // (the lanes' ends and their first heading, kept while no edge is added)
    const { plan } = T;
    let cache = plan.laneEndCache;
    if (!cache || cache.edges !== plan.edges || cache.n !== plan.edges.length) {
        const ends = [];
        for (const e of plan.edges) {
            if (e.kind !== "lane" && e.kind !== "close") continue;
            const n = e.points.length;
            for (const [q, q2] of [[e.points[0], e.points[Math.min(n - 1, 3)]], [e.points[n - 1], e.points[Math.max(0, n - 4)]]]) {
                const u = [q2[0] - q[0], q2[1] - q[1]];
                const L = Math.hypot(u[0], u[1]) || 1;
                ends.push(q[0], q[1], u[0] / L, u[1] / L);
            }
        }
        cache = plan.laneEndCache = { edges: plan.edges, n: plan.edges.length, ends };
    }
    const { ends } = cache;
    const R2 = PLAN.LANE_END_APART_M * PLAN.LANE_END_APART_M;
    for (const [p, p2] of [[a, z], [z, a]]) {
        let v0 = p2[0] - p[0], v1 = p2[1] - p[1];
        const L = Math.hypot(v0, v1) || 1;
        v0 /= L;
        v1 /= L;
        for (let k = 0; k < ends.length; k += 4) {
            const dx = p[0] - ends[k], dy = p[1] - ends[k + 1];
            if (dx * dx + dy * dy >= R2) continue;
            if (ends[k + 2] * v0 + ends[k + 3] * v1 > PLAN.LANE_FAN_COS) return true;
        }
    }
    return false;
}

/** A new lane that would run alongside another street (within LANE_APART_M) for more than
 * a few metres away from its ends is not laid: the block is too thin that way. */
function besideAnother(T, points) {
    const dense = resample(points, 2);
    // Only the streets whose box comes near the new lane's
    const m0 = PLAN.LANE_APART_M;
    const bx = [Math.min(...points.map((p) => p[0])) - m0, Math.min(...points.map((p) => p[1])) - m0, Math.max(...points.map((p) => p[0])) + m0, Math.max(...points.map((p) => p[1])) + m0];
    const near = T.plan.edges.filter((e) => {
        if (e.kind === "market") return false;
        const b = e.box ?? (e.box = [Math.min(...e.points.map((p) => p[0])), Math.min(...e.points.map((p) => p[1])), Math.max(...e.points.map((p) => p[0])), Math.max(...e.points.map((p) => p[1]))]);
        return b[0] <= bx[2] && b[2] >= bx[0] && b[1] <= bx[3] && b[3] >= bx[1];
    });
    // (V6: their segments indexed, so each point of the lane tries only those near it)
    const index = segmentIndex(near.flatMap((e) => e.points.slice(1).map((b, m) => ({ a: e.points[m], b }))), PLAN.LANE_APART_M, 32);
    let run = 0;
    for (let k = 0; k < dense.length; k++) {
        const p = dense[k];
        const nearEnd = dist(p, points[0]) < 10 || dist(p, points[points.length - 1]) < 10;
        const close = !nearEnd && index.near(p, PLAN.LANE_APART_M);
        run = close ? run + 2 : 0;
        if (run > 18) return true;
    }
    return false;
}

/** Walks from c along d through the block until it leaves it: what it met, and where. */
function trace(R, c, d, labels, label) {
    for (let s = 0; s < 600; s += R.step * 0.5) {
        const p = [c[0] + d[0] * s, c[1] + d[1] * s];
        const k = R.at(p);
        if (k < 0) return null;
        if (labels[k] === label) continue;
        if (R.cell[k] === CELL.STREET) return { p, street: true, edge: R.edge[k] - 1 };
        if (R.cell[k] === CELL.FREE) return null;
        return { p, street: false };
    }
    return null;
}

function snapToEdge(T, hit) {
    if (!hit.street) return hit.p;
    const e = T.plan.edges[hit.edge];
    return e ? nearestOnLine(e.points, hit.p) : hit.p;
}

// ================================================================= streets for the rest of the engine
function assembleStreets(T) {
    const { plan, occupancy } = T;
    const streets = [];
    const rankOf = (cls) => (cls === "minor" ? 1 : 0);
    for (const road of T.roads) {
        const outside = road.outside ?? road.points;
        streets.push({ points: outside, half: road.width / 2, rank: rankOf(road.cls), road: true });
    }
    for (const road of plan.lesserRoads) streets.push({ points: road.outside, half: road.width / 2, rank: 1, road: true, lesser: true });
    for (const e of plan.edges.filter((x) => x.kind !== "market")) streets.push({ points: e.points, half: e.half, rank: e.rank, plan: e.kind, close: !!e.close });
    // The market's edge is a frontage too
    streets.push({ points: [...T.market.polygon, T.market.polygon[0]], half: 1.5, rank: 0, market: true });
    T.streets = streets;
    // Occupancy: the ways, then the walls, gatehouses and castle, then the gates opened again
    for (const s of streets) if (!s.market) occupancy.stampPolyline(s.points, s.half, STREET);
    if (T.wall) {
        if (T.castle) occupancy.stampPolygon(T.castle.polygon, RESERVED);
        for (const ring of [T.wall, T.outerWall].filter(Boolean)) {
            const { verts } = ring;
            for (let k = 0; k < verts.length; k++) {
                const a = verts[k], b = verts[(k + 1) % verts.length];
                if (a.onBank && b.onBank) continue;
                occupancy.stampPolyline([a.p, b.p], 5, RESERVED);
            }
            for (const gate of ring.gates) occupancy.stampPolygon(gate.house, RESERVED);
        }
        for (const s of streets) if (s.road || s.plan === "main" || s.plan === "lesser") occupancy.clearPolyline(s.points, s.half, RESERVED, STREET, (p) => T.castle && pointInPolygon(p, T.castle.polygon));
    }
}

// ================================================================= styles for Buildings.js
function styleAt(T, p, n) {
    const { plan, kind } = T;
    const R = plan.raster;
    if (T.inCore(p)) {
        let label = -1;
        for (let s = 0; s <= 6 && label < 0; s += 1) {
            const k = R.at(n ? [p[0] + n[0] * s, p[1] + n[1] * s] : p);
            if (k >= 0) label = plan.blockLabels[k];
        }
        const block = plan.blockList.find((b) => b.label === label);
        const tier = block?.tier ?? "lower";
        return { tier, ...STYLE[kind][tier] };
    }
    return plan.suburbStyle?.(p) ?? null;
}

export { insideShare };

// ================================================================= the ground between two rings
/**
 * The ground between a great city's rings, once its outer wall is thrown round it, is cut into
 * blocks as the walled town's is (Ken, 2026-11-15: built up inside both rings): its streets (the
 * roads, the lanes the suburbs laid, a lane round the inside of the outer wall) bound blocks, and
 * the largest is cut across its long axis by a lane joining the streets either side, until the
 * frontage would house the houses wanted there. Returns the new lanes' points.
 */
export function cutRingBlocks(T, { outer, inner, ways, squares, houses, plotW, seed = "plan-ring-lanes", estates = true }) {
    const { plan } = T;
    const saved = plan.edges;
    plan.edges = [];
    const step = 3;
    const box = bounds(outer);
    const R = makeRaster([box[0] - 12, box[1] - 12, box[2] + 12, box[3] + 12], step);
    R.keepInside(outer);
    for (let k = 0; k < outer.length; k++) R.stampLine([outer[k], outer[(k + 1) % outer.length]], 6, CELL.BARRIER);
    if (inner) {
        R.stampPolygon(inner, CELL.BARRIER);
        for (let k = 0; k < inner.length; k++) R.stampLine([inner[k], inner[(k + 1) % inner.length]], 8, CELL.BARRIER);
    }
    if (T.castle) R.stampPolygon(grownPoly(T.castle.polygon, CASTLE_MARGIN_M), CELL.BARRIER);
    // A place of worship's yard and a margin round it, so no street's width runs over it; its own
    // street leaves from the door beyond the margin
    for (const w of T.worship) R.stampPolygon(grownPoly(w.yard, YARD_MARGIN_M), CELL.BARRIER);
    for (const sq of squares) {
        R.stampPolygon(sq, CELL.BARRIER);
        addEdge(T, R, [...sq, sq[0]], 1.5, 1, "market");
    }
    for (let k = 0; k < R.cell.length; k++) if (R.cell[k] === CELL.FREE && T.wdAt(R.point(k)) < 6) R.cell[k] = CELL.BARRIER;
    for (const w of ways) addEdge(T, R, w.points, w.half, w.rank, w.rank === 0 ? "main" : "lane");
    // A lane round the inside of the outer wall
    const wallLane = offsetRingInward(outer, PLAN.WALL_LANE_M);
    const laneHalf = PLAN.WIDTH[T.kind][2] / 2;
    const out = [];
    {
        // Laid only where it runs over free ground (it gives way to the roads at the gates)
        let run = [];
        const flush = () => {
            if (run.length >= 3) {
                addEdge(T, R, run, laneHalf, 2, "lane");
                out.push(run);
            }
            run = [];
        };
        const dense = resample([...wallLane, wallLane[0]], 6);
        for (const p of dense) {
            const k = R.at(p);
            if (k >= 0 && R.cell[k] === CELL.FREE && T.wdAt(p) > 10) run.push(p);
            else flush();
        }
        flush();
    }
    const random = T.R(seed);
    const labels = new Int32Array(R.NX * R.NY).fill(-1);
    let blocks = components(R, labels).filter((b) => b.area >= PLAN.SLIVER_M2);
    let next = blocks.length;
    const BLOCK = 5200;
    const use = PLAN.FRONTAGE_USE.city;
    const capacityOf = (b) => (b.streetTouch * step * use) / plotW;
    for (const b of blocks) b.tier = "middle";
    let capacity = blocks.reduce((a, b) => a + capacityOf(b), 0);
    const wanted = houses * PLAN.RING_CAPACITY;
    const stuck = new Set();
    // Estates (Ken, 2026-11-15): a block about an estate's size, away from the squares, is taken as
    // one rather than cut, until the ring has its count; those blocks are not cut
    const laid = [];
    const picks = [];
    const count = estates ? (T.plan.estateCounts?.ring ?? 0) : 0;
    const sqC = squares.map((q) => centroid(q));
    const random2 = T.R("estates-ring");
    const tryEstate = (b) => {
        if (picks.length >= count || b.area > ESTATE_BLOCK_MAX) return false;
        const ax = b.ax ?? (b.ax = axes(R, b.cells));
        if (sqC.some((q) => dist(q, ax.c) < 90)) return false;
        const got = pickEstateBlocks(R, labels, [b], 1, "ring", picks, T.worship, (poly) => dryOver(T, poly, 4));
        if (!got.length) return false;
        picks.push(got[0]);
        stuck.add(b.label);
        capacity -= capacityOf(b);
        laid.push(layOutEstate(T, got[0].ground, "ring", random2, R));
        return true;
    };
    for (let guard = 0; guard < 3000 && capacity < wanted; guard++) {
        let pick = null;
        for (const b of blocks) {
            if (stuck.has(b.label)) continue;
            const ratio = b.area / BLOCK;
            if (ratio > 0.6 && (!pick || ratio > pick.ratio)) pick = { b, ratio };
        }
        if (!pick) break;
        const b = pick.b;
        if (tryEstate(b)) continue;
        const cut = cutBlock(T, R, b, labels, random);
        if (!cut || cut.close) {
            stuck.add(b.label);
            continue;
        }
        addEdge(T, R, cut.points, laneHalf, 2, "lane");
        out.push(cut.points);
        for (const k of b.cells) labels[k] = -1;
        const parts = components(R, labels, b.cells, next);
        next += parts.length;
        blocks = blocks.filter((x) => x !== b);
        capacity -= capacityOf(b);
        for (const p of parts) {
            p.tier = "middle";
            capacity += capacityOf(p);
            blocks.push(p);
        }
    }
    if (picks.length < count) for (const b of [...blocks].sort((x, y) => y.area - x.area)) if (!stuck.has(b.label)) tryEstate(b);
    plan.edges = saved;
    delete plan.laneEndCache;
    plan.ringCapacity = Math.round(capacity);
    settleEstates(T, laid);
    return out;
}
