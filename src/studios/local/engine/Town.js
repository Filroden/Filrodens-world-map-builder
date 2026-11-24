/**
 * The local map engine: a settlement drawn at street scale from its one parent input
 * (LocalInput.js). Deterministic for its seed: every stage draws from its own seeded source, so
 * a change to one stage does not reshuffle the others.
 *
 * Coordinates are metres from the frame's centre, x east and y south (as map pixels).
 *
 * Stages: terrain and water (the river, and the sea or a lake); the centre and the crossing; the
 * approach roads; walls, gates and castle; the streets inside (wards); the waterfront (quays,
 * harbour, jetties); the suburbs round the walls; the market, back lanes and market ring;
 * places of worship; buildings;
 * fields and tracks; contours.
 */
import { bearingOfVector, centroid, dist, makeNoise, pointInPolygon, polygonArea, polylineLength, segmentDistance, stageRandom } from "./Geometry.js";
import { buildBuildings } from "./town/Buildings.js";
import { buildFields } from "./town/Fields.js";
import { buildMarket, buildWorship } from "./town/MarketWorship.js";
import { RESERVED, makeOccupancy } from "./town/Occupancy.js";
import { buildRoads, placeCentre } from "./town/Roads.js";
import { buildBackLanes, buildCore, buildMarketRing, buildSuburbs, buildWards } from "./town/Streets.js";
import { buildPort } from "./town/Port.js";
import { CAVE } from "./CaveInput.js";
import { buildCaveDwellings, buildCaveFarms, buildGalleryStreets, buildTunnelForts, buildWallLane, followTunnels } from "./town/Cave.js";
import { buildTerrain } from "./town/Terrain.js";
import { buildWalls, stampRoadsAndWalls, straightenGateStreets } from "./town/Walls.js";
import { buildPlan, buildTwinPlan, usesPlan } from "./town/plan/Plan.js";
import { buildWorkedEstates } from "./town/plan/Estates.js";
import { buildYards } from "./town/Yards.js";
import { chooseRoofs } from "./town/Roofs.js";
import { buildBuiltUp } from "./town/BuiltUp.js";
import { buildCemeteries, connectFeatures, endLanesAtWalls, fillParks, layOutPark, reachDoors } from "./town/Features.js";

/**
 * Plans by kind. frame and grid: a square frame's side (m) and its terrain cells across, used
 * when no frame is given and to set the terrain cell size (frame / grid); occ: occupancy cell (m); perBuilding: people per house (a city's is
 * higher: its houses inside the walls run to three storeys and take lodgers); plotW: frontage per
 * plot (m); depthB, widthB: house depth and width (m; null width fills the plot); plotDepth: the
 * plot behind the house (m); arablePerHead (ha); fieldSpacing: furlong width scale (m); approach:
 * roads at least; streetW, mainW: lane and main street widths (m); wardSpacing: ward seeds (m);
 * density: people per hectare inside walls; relief: terrain detail (m).
 */
export const PLANS = Object.freeze({
    village: { frame: 2400, grid: 400, occ: 1, perBuilding: 4.6, plotW: [14, 24], depthB: [7, 9], widthB: [13, 18], plotDepth: [45, 75], arablePerHead: 0.6, fieldSpacing: 140, approach: 3, streetW: 5, mainW: 6, relief: 18 },
    town: { frame: 2600, grid: 400, occ: 1, perBuilding: 5.5, plotW: [7, 12], depthB: [9, 14], widthB: null, plotDepth: [45, 85], arablePerHead: 0.35, fieldSpacing: 170, approach: 4, streetW: 6, mainW: 9, wardSpacing: 105, density: 170, relief: 18 },
    city: { frame: 3600, grid: 420, occ: 1.5, perBuilding: 6, plotW: [5.5, 10], depthB: [10, 17], widthB: null, plotDepth: [0, 0], arablePerHead: 0.12, fieldSpacing: 210, approach: 5, streetW: 5, mainW: 10, wardSpacing: 50, density: 210, relief: 28 },
});

// Revision 2 (the quality round, V0 to V6, 2026-11-14 to 2026-11-17): the plan-first layout core
// for towns and cities on the surface, on open cavern floors, before a hold's gate and in carved
// chambers; buildings that are not homes, back buildings and courts; estates and faubourgs; walls
// in a half-moon against a mountain; fields cut along the land's grain; frames to 24 × 18 km. A
// place built at revision 1 is built differently at revision 2 from the same seed. Revision 2 also
// takes in the changes made before the round's sign-off (2026-11-17): villages nucleated round
// their green, the upper tier kept by the landmarks, no fans of lanes, no bare stubs, churchyards'
// graves, a twin chamber's second chamber and a galleried place's hub on the plan, each roof's
// material, the built-up ground's outline, and the suburbs' lanes grown slowly. A revision is
// raised only against a released one (Ken, 2026-11-17: the live engine is revision 1, so the whole
// round is revision 2).
export const ENGINE_REVISION = 2;

/** A village of this many people or more has a manor beyond its houses. */
const VILLAGE_MANOR_FROM = 350;

/** Outside a hold's gate, the town's houses keep this far (m) from the gate road. */
const OUTSIDE_VERGE = 40;

/** The ground kept clear about a stair's or shaft's landing (m). */
const LANDING_CLEAR = 12;
const circleOf = (c, r) => Array.from({ length: 16 }, (_, k) => [c[0] + Math.cos((k / 16) * 2 * Math.PI) * r, c[1] + Math.sin((k / 16) * 2 * Math.PI) * r]);

/** A house's depth underground (m). */
const CAVE_HOUSE_DEPTH = [7, 10];

/** The terrain grid holds at most this many cells (720 square). */
const MAX_TERRAIN_CELLS = 720 * 720;

/**
 * @param {ReturnType<import("./local-input.mjs").localInput>} input
 * @returns {object} The drawn place: terrain, river, roads, wall, streets, market, places of worship,
 *     buildings, plots, fields, tracks, contours, and what it honours of the parent.
 */
export function buildTown(input) {
    const P = PLANS[input.kind];
    // The frame comes from LocalInput.js as width and height in metres; the terrain grid keeps the
    // plan's cell size whatever the frame
    const frame = input.frame ?? { width: P.frame, height: P.frame };
    const W = frame.width;
    const H = frame.height;
    // Coarser on the largest frames, so the terrain's searches and contours stay quick
    const g = Math.max(P.frame / P.grid, Math.sqrt((W * H) / MAX_TERRAIN_CELLS));
    const NX = Math.round(W / g);
    const NY = Math.round(H / g);
    const T = {
        input,
        kind: input.kind,
        // Houses underground are shallower, cut back from the galleries and chambers they face
        P: input.cave ? { ...P, depthB: CAVE_HOUSE_DEPTH } : P,
        W,
        H,
        // The long side, for what scales with the frame's size rather than its shape
        S: Math.max(W, H),
        half: [W / 2, H / 2],
        NX,
        NY,
        g: W / NX,
        inFrame: (p) => Math.abs(p[0]) < W / 2 && Math.abs(p[1]) < H / 2,
        R: (stage) => stageRandom(input.seed, stage),
        noise: makeNoise(`${input.seed}:terrain`),
        timings: {},
    };
    const cave = !!input.cave;
    if (cave) T.quays = T.moles = T.jetties = T.ships = [];
    const time = (name, run) => {
        const started = performance.now();
        run(T);
        T.timings[name] = Math.round(performance.now() - started);
    };
    time("terrain", buildTerrain);
    time("roads", (t) => {
        placeCentre(t);
        buildRoads(t);
        if (cave) followTunnels(t);
    });
    time("layout", (t) => {
        makeOccupancy(t);
        if (cave) {
            // The cavern is the wall: forts close the tunnels, and the wards fill its floor
            t.wall = null;
            t.outerWall = null;
            t.castle = null;
            // (the plan-first core stamps its own ways)
            if (!usesPlan(t)) stampRoadsAndWalls(t);
            // A hold's landings, air shafts and the mountainside outside its gate are kept clear
            const cave = t.shore.cave;
            for (const l of cave.landings) t.occupancy.stampPolygon(circleOf(l.c, LANDING_CLEAR), RESERVED);
            for (const p of cave.airShafts) t.occupancy.stampPolygon(circleOf(p, 5), RESERVED);
            // Outside, only the gate road's verge is kept from the cavern's houses (the open land is
            // too large to stamp; the town before the gate is built there by the surface engine)
            if (cave.outside) {
                const road = t.roads.find((r) => r.bearing === cave.outside.bearing);
                const out = road ? road.points.filter((p) => cave.outside.contains(p)) : [];
                if (out.length > 1) t.occupancy.stampPolyline(out, OUTSIDE_VERGE, RESERVED);
            }
            if (usesPlan(t)) {
                // The plan-first core in the main chamber (V5a), its tunnels coming in where gates
                // would be; a twin chamber's wards as before; the galleries' streets
                buildPlan(t);
                buildTunnelForts(t);
                // A twin chamber's second chamber on the plan too (pre-sign-off, 2026-11-17)
                const twin = t.shore.cave.twin ? buildTwinPlan(t) : null;
                // The plan's built ground is the core (its houses first, and the works and sheds
                // only there), the chamber's floor round it left for the beds
                const ring = t.plan.ring;
                t.core = ring;
                t.inCore = twin ? (p) => pointInPolygon(p, ring) || pointInPolygon(p, twin.ring) : (p) => pointInPolygon(p, ring);
                t.coreCap = t.plan.insideHouses + (twin?.houses ?? 0);
                t.coreRadius = Math.max(...ring.map((p) => dist(p, t.centre)));
                buildGalleryStreets(t);
                // The lane round each chamber's wall, before the houses cut into it
                buildWallLane(t);
            } else {
            buildTunnelForts(t);
            t.core = t.shore.cave.outline;
            t.inCore = t.shore.inCore;
            // A galleried place's chamber holds only its share of the free-standing houses
            const share = CAVE.PLANS[input.cave.plan ?? "chamber"].inChamber;
            t.coreCap = share < 1 ? Math.round((input.population / t.P.perBuilding) * Math.max(0.04, share)) : null;
            t.coreRadius = Math.max(...t.core.map((p) => dist(p, t.centre)));
            buildWards(t);
            buildGalleryStreets(t);
            buildWallLane(t);
            }
        } else if (usesPlan(t)) {
            buildPlan(t);
            buildPort(t);
        } else {
            buildWalls(t);
            straightenGateStreets(t);
            stampRoadsAndWalls(t);
            buildCore(t);
            buildWards(t);
            buildPort(t);
            buildSuburbs(t);
        }
        if (!t.plan) {
            buildMarket(t);
            buildBackLanes(t);
            buildMarketRing(t);
            buildWorship(t);
        }
    });
    time("features", (t) => {
        connectFeatures(t);
        if (!cave) {
            endLanesAtWalls(t);
            layOutPark(t);
        } else t.parks = [];
    });
    time("buildings", (t) => {
        if (cave) {
            buildCaveDwellings(t);
        }
        buildBuildings(t);
        if (!cave) reachDoors(t);
        dropBareStubs(t);
    });
    time("parks", fillParks);
    time("cemeteries", buildCemeteries);
    // Worked estates beyond the walls, larger, with their farm buildings (Ken, 2026-11-15)
    // (a village of some size has its manor, a worked estate just beyond its houses: 2026-11-17)
    time("estates", (t) => !cave && (t.plan ? buildWorkedEstates(t, t.plan.estateCounts?.worked ?? 0) : t.kind === "village" && t.input.population >= VILLAGE_MANOR_FROM && buildWorkedEstates(t, 1)));
    time("fields", cave ? buildCaveFarms : buildFields);
    // Every house's yard or garden behind it (V3)
    time("yards", (t) => !cave && buildYards(t));
    // What each roof is made of, by the place and the spot (pre-sign-off, 2026-11-17)
    time("roofs", chooseRoofs);
    // The built-up ground, closed over the gaps between houses, plots and yards (Ken, 2026-11-17)
    time("builtUp", buildBuiltUp);
    time("contours", (t) => {
        t.contourInterval = t.kind === "city" ? 5 : 2.5;
        t.contours = marchingSquares(t.terrain.height, t.NX, t.NY, t.g, t.W, t.H, t.contourInterval);
    });
    return result(T);
}

/** A lane no longer than this (m) that serves nothing is taken away. */
const BARE_STUB_M = 90;

/**
 * Lanes that lead nowhere and serve nothing: a short lane with a loose end and no more than one
 * building along it is dropped (pre-sign-off, 2026-11-17). A short lane joining two streets is
 * kept, however bare: it is a way through.
 */
function dropBareStubs(T) {
    // (segments and building centres bucketed, so each short lane tries only what lies near it)
    const CELL = 32;
    const key = (i, j) => i * 100003 + j;
    const segs = new Map();
    const ways = [...T.streets, ...(T.roads ?? [])].filter((o) => o.points?.length > 1);
    ways.forEach((o, id) => {
        const within = (o.half ?? 3) + 4;
        for (let i = 0; i + 1 < o.points.length; i++) {
            const a = o.points[i], b = o.points[i + 1];
            const x0 = Math.floor((Math.min(a[0], b[0]) - within) / CELL), x1 = Math.floor((Math.max(a[0], b[0]) + within) / CELL);
            const y0 = Math.floor((Math.min(a[1], b[1]) - within) / CELL), y1 = Math.floor((Math.max(a[1], b[1]) + within) / CELL);
            for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
                const k = key(x, y);
                let list = segs.get(k);
                if (!list) segs.set(k, (list = []));
                list.push({ id, a, b, within });
            }
        }
    });
    const centres = new Map();
    for (const b of T.buildings) {
        const c = centroid(b.poly);
        const k = key(Math.floor(c[0] / CELL), Math.floor(c[1] / CELL));
        let list = centres.get(k);
        if (!list) centres.set(k, (list = []));
        list.push(c);
    }
    const near = (p, s, within) => {
        for (let i = 0; i + 1 < s.points.length; i++) if (segmentDistance(p, s.points[i], s.points[i + 1]) < within) return true;
        return false;
    };
    const keep = [];
    T.streets.forEach((s, id) => {
        if (s.rank < 2 || s.road || polylineLength(s.points) > BARE_STUB_M) {
            keep.push(s);
            return;
        }
        const joined = (e) => (segs.get(key(Math.floor(e[0] / CELL), Math.floor(e[1] / CELL))) ?? []).some((sg) => sg.id !== id && segmentDistance(e, sg.a, sg.b) < sg.within);
        const loose = !joined(s.points[0]) || !joined(s.points[s.points.length - 1]);
        let served = 0;
        if (loose) {
            const reach = s.half + 16;
            const xs = s.points.map((p) => p[0]), ys = s.points.map((p) => p[1]);
            const seen = new Set();
            for (let x = Math.floor((Math.min(...xs) - reach) / CELL); x <= Math.floor((Math.max(...xs) + reach) / CELL) && served <= 1; x++) {
                for (let y = Math.floor((Math.min(...ys) - reach) / CELL); y <= Math.floor((Math.max(...ys) + reach) / CELL) && served <= 1; y++) {
                    for (const c of centres.get(key(x, y)) ?? []) {
                        if (seen.has(c)) continue;
                        seen.add(c);
                        if (near(c, s, reach) && ++served > 1) break;
                    }
                }
            }
        }
        if (!(loose && served <= 1)) keep.push(s);
    });
    T.streets = keep;
}

function result(T) {
    const houses = T.buildings.filter((b) => b.kind === "house");
    const wall = T.wall;
    return {
        engineRevision: ENGINE_REVISION,
        name: T.input.name,
        kind: T.kind,
        frame: { width: T.W, height: T.H },
        input: T.input,
        centre: T.centre,
        terrain: T.terrain,
        river: T.river,
        bridge: T.bridge,
        roads: T.roads,
        wall,
        outerWall: T.outerWall,
        forts: T.forts ?? [],
        gate: T.gate ?? null,
        landings: T.shore?.cave?.landings.map((l) => l.c) ?? [],
        airShafts: T.shore?.cave?.airShafts ?? [],
        supply: T.supply ?? null,
        castle: T.castle,
        shore: T.shore,
        quays: T.quays,
        moles: T.moles,
        jetties: T.jetties,
        ships: T.ships,
        light: T.light,
        core: T.core,
        wards: T.wards,
        streets: T.streets,
        market: T.market,
        worship: T.worship,
        parks: T.parks ?? [],
        cemeteries: T.cemeteries ?? [],
        estates: T.estates ?? [],
        buildings: T.buildings,
        plots: T.plots,
        yards: T.yards ?? [],
        builtUp: T.builtUp ?? [],
        fields: T.fields,
        tracks: T.tracks,
        contours: T.contours,
        contourInterval: T.contourInterval,
        land: T.land,
        honours: honours(T),
        plan: T.plan ? planOut(T.plan) : null,
        timings: T.timings,
        stats: {
            houses: houses.length,
            target: T.target,
            peoplePerHouse: +(T.input.population / Math.max(1, houses.length)).toFixed(2),
            terraced: houses.filter((b) => b.terrace).length,
            barns: T.buildings.filter((b) => b.kind === "barn").length,
            farmhouses: T.buildings.filter((b) => b.kind === "farmhouse").length,
            farmsteads: T.farmsteads,
            frameKm: [+(T.W / 1000).toFixed(2), +(T.H / 1000).toFixed(2)],
            gardens: T.fields.filter((f) => f.use === "garden").length,
            plots: T.plots.length,
            roads: T.roads.length,
            lanes: T.streets.filter((s) => s.rank === 2).length,
            suburbLanes: T.streets.filter((s) => s.suburb).length,
            backLanes: T.streets.filter((s) => s.back).length,
            fields: T.fields.length,
            furlongs: T.fields.filter((f) => f.use === "arable").length,
            strips: T.fields.reduce((a, f) => a + (f.strips?.length ?? 0), 0),
            tracks: T.tracks.length,
            wallLengthM: wall ? Math.round(wall.polygon.reduce((a, p, k) => a + dist(p, wall.polygon[(k + 1) % wall.polygon.length]), 0)) : 0,
            wallAreaHa: wall ? +(polygonArea(wall.polygon) / 10000).toFixed(1) : 0,
            towers: wall?.towers.length ?? 0,
            gates: wall?.gates.length ?? 0,
            insideShare: wall ? +wall.share.toFixed(2) : null,
            housesInside: wall ? houses.filter((b) => pointInPolygon(centroid(b.poly), wall.polygon)).length : null,
            outerWallLengthM: T.outerWall ? Math.round(T.outerWall.polygon.reduce((a, p, k) => a + dist(p, T.outerWall.polygon[(k + 1) % T.outerWall.polygon.length]), 0)) : 0,
            placesOfWorship: T.worship.length,
            warehouses: T.buildings.filter((b) => b.kind === "warehouse").length,
            quayM: Math.round((T.quays ?? []).reduce((a, q) => a + q.points.reduce((b, p, k) => b + (k ? dist(p, q.points[k - 1]) : 0), 0), 0)),
            jetties: T.jetties?.length ?? 0,
            ships: T.ships?.length ?? 0,
            harbour: (T.moles?.length ?? 0) > 0,
            cropFactor: +T.cropFactor.toFixed(2),
        },
    };
}

/** The plan-first core's own record (V2): its network, quarters, blocks and the raster they were
 * read from (for the checks and the review overlay). */
function planOut(plan) {
    const { styleAt, suburbStyle, blockLabels, quarterOf, raster, ...rest } = plan;
    return { ...rest, raster: { box: raster.box, step: raster.step, NX: raster.NX, NY: raster.NY }, blockLabels, quarterOf, quarters: plan.quarters.map(({ cells, fronts, ...q }) => ({ ...q, cells: cells.length })), blockList: plan.blockList.map((b) => ({ label: b.label, tier: b.tier, area: b.area, minRank: b.minRank })) };
}

/** What the drawn map shows of its parent input, measured from the drawing (for the harness). */
function honours(T) {
    const edgeBearing = (p) => bearingOfVector(p);
    const line = T.river.line;
    return {
        // A parent's road whose bearing meets the frame's edge in the water leaves at the nearest dry bearing
        roads: T.roads.map((road) => ({ wanted: road.bearing, leaves: road.leaves ?? road.bearing, fixed: road.fixed, drawn: edgeBearing(road.points[0]) })),
        river: T.river.brook && !T.input.river ? null : { wantedIn: T.river.inBearing, drawnIn: edgeBearing(line[0]), wantedOut: T.river.mouth ? null : T.river.outBearing, drawnOut: T.river.mouth ? null : edgeBearing(line[line.length - 1]), mouth: T.river.mouth, widthM: T.river.width, wantedWidthM: T.input.river?.widthM ?? null },
    };
}

function marchingSquares(h, NX, NY, g, W, H, interval) {
    const segments = [];
    const x = (i) => -W / 2 + (i + 0.5) * g;
    const y = (j) => -H / 2 + (j + 0.5) * g;
    // Cell by cell, only the levels that cross it
    for (let j = 0; j + 1 < NY; j++) {
        for (let i = 0; i + 1 < NX; i++) {
            const v = [h[j * NX + i], h[j * NX + i + 1], h[(j + 1) * NX + i + 1], h[(j + 1) * NX + i]];
            const lo = Math.min(v[0], v[1], v[2], v[3]);
            const hi = Math.max(v[0], v[1], v[2], v[3]);
            const first = Math.ceil(lo / interval) * interval;
            if (first > hi) continue;
            const p = [[x(i), y(j)], [x(i + 1), y(j)], [x(i + 1), y(j + 1)], [x(i), y(j + 1)]];
            for (let level = first; level <= hi; level += interval) {
                const major = Math.abs(Math.round(level / interval) % 4) === 0;
                const cross = [];
                for (let e = 0; e < 4; e++) {
                    const a = v[e];
                    const b = v[(e + 1) % 4];
                    if (a < level !== b < level) {
                        const t = (level - a) / (b - a);
                        cross.push([p[e][0] + (p[(e + 1) % 4][0] - p[e][0]) * t, p[e][1] + (p[(e + 1) % 4][1] - p[e][1]) * t]);
                    }
                }
                if (cross.length >= 2) segments.push([cross[0], cross[1], major]);
                if (cross.length === 4) segments.push([cross[2], cross[3], major]);
            }
        }
    }
    return segments;
}
