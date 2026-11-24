// The centre, the crossing and the approach roads. The parent's roads are fixed: each leaves the
// frame at its bearing. Where the parent has fewer roads than a place of this size would have,
// lanes are added towards its nearest neighbours. All of them are traced back to the centre down
// one least-cost tree, so roads merge as they near the town and share the one bridge.
import { MinHeap } from "../../../../kernel/util/MinHeap.js";
import { angleBetween, chaikin, compass, dist, exitPoint, segmentDistance, simplify } from "../Geometry.js";
import { alongShore, shorePoint } from "./Shore.js";

/** A lane towards a neighbour is not added within this angle (degrees) of another road. */
const SAME_ROAD = 32;
/** A city has one more road for every so many people, up to so many more. */
const GREAT_PEOPLE_PER_ROAD = 40000;
const GREAT_EXTRA_ROADS = 4;
/** How much dearer the roughest ground is to cross than the easiest, and the size of its patches (m). */
const ROAD_WANDER = 1.6;
const ROAD_WANDER_M = 420;
/** Frames longer than this (m) scale the roads' wander and a brook's bends with their size. */
export const LARGE_FRAME_M = 6000;
/** Gradient at which a road's cost doubles (rise over run). */
const ROAD_GRADE = 0.04;

/** A way meeting a cavern's wall ends this far (m) short of it, at the tunnel's mouth. */
const WALL_FOOT = 4;

/** On a shore the centre stands this far (m) inland of the waterline: a port's market by its quays. */
const CENTRE_INLAND = { port: 70, other: 120 };

export function placeCentre(T) {
    const { river, kind, shore, input } = T;
    let centre0 = [0, 0];
    if (shore?.main) {
        // The town faces the water of its widest stretch, by the river's mouth if it has one
        const line = shore.main;
        const inland = input.shore?.centreInland ?? (input.port ? CENTRE_INLAND.port : CENTRE_INLAND.other) + (kind === "city" ? 30 : 0);
        // Below a mountain, before the hold's gate
        let t = input.shore?.centreNear ? alongShore(line, input.shore.centreNear) : 0;
        if (river.mouth && !river.brook) {
            const mouthAt = alongShore(line, river.mouth);
            // Beside the mouth, on the side of the frame's middle
            const side = mouthAt > 0 ? -1 : 1;
            t = mouthAt + side * (river.width / 2 + 90);
        }
        centre0 = shorePoint(line, t, inland);
    } else if (shore?.island) {
        centre0 = [0, 0];
    }
    // The crossing is on dry land, not out in the river's mouth
    const banks = river.line.filter((q) => !T.seaAt(q) && (!river.mouth || dist(q, river.mouth) > river.width + 40));
    let nearest = banks[0] ?? river.line[0];
    for (const q of banks) if (dist(q, centre0) < dist(nearest, centre0)) nearest = q;
    const span = dist(nearest, centre0) || 1;
    const away = [(centre0[0] - nearest[0]) / span, (centre0[1] - nearest[1]) / span];
    const offset = river.width / 2 + (kind === "city" ? 55 : 40);
    const onBank = [nearest[0] + away[0] * offset, nearest[1] + away[1] * offset];
    // A town by the sea keeps its waterfront place unless the river runs right by it
    // A cavern's middle is its plaza, whatever river crosses the chamber
    T.centre = river.brook || input.cave || (shore?.main && span > offset) ? centre0 : onBank;
    T.away = away;
    T.bridge = [
        [nearest[0] + away[0] * (river.width / 2 + 6), nearest[1] + away[1] * (river.width / 2 + 6)],
        [nearest[0] - away[0] * (river.width / 2 + 6), nearest[1] - away[1] * (river.width / 2 + 6)],
    ];
}

export function buildRoads(T) {
    const { input, P, W, H, NX, NY, g, terrain, river, centre: C } = T;
    // A road may end at a point in the frame rather than its edge (a hold's great gate)
    const approaches = input.roads.map((road) => ({ bearing: road.bearing, cls: road.class ?? "minor", fixed: true, to: road.to ?? null }));
    for (const neighbour of input.neighbours) {
        if (approaches.length >= P.approach) break;
        if (approaches.some((road) => angleBetween(road.bearing, neighbour.bearing) < SAME_ROAD)) continue;
        approaches.push({ bearing: neighbour.bearing, cls: ["city", "capital", "largeTown"].includes(neighbour.tier) ? "main" : "minor", fixed: false, toward: neighbour.name });
    }
    // A place with no road at all still has a way out: down the valley
    if (!approaches.length) approaches.push({ bearing: input.relief.downhill ?? 180, cls: "minor", fixed: false });
    // A great city draws roads from all round: where its neighbours leave it short, more leave by
    // the widest gaps between those it has (over land)
    const wanted = P.approach + Math.min(GREAT_EXTRA_ROADS, Math.floor(input.population / GREAT_PEOPLE_PER_ROAD));
    const overLand = (bearing) => !T.shore || !T.seaAt(exitPoint([0, 0], compass(bearing), T.half, g * 1.5));
    for (let guard = 0; guard < 12 && approaches.length < wanted; guard++) {
        const bearings = approaches.map((road) => road.bearing).sort((a, b) => a - b);
        let best = null;
        for (let k = 0; k < bearings.length; k++) {
            const from = bearings[k];
            const gap = ((bearings[(k + 1) % bearings.length] - from + 360) % 360) || 360;
            for (const share of [0.5, 0.35, 0.65]) {
                const bearing = Math.round((from + gap * share) % 360);
                if (gap * Math.min(share, 1 - share) < SAME_ROAD || !overLand(bearing)) continue;
                if (!best || gap > best.gap) best = { bearing, gap };
                break;
            }
        }
        if (!best) break;
        approaches.push({ bearing: best.bearing, cls: input.population >= GREAT_PEOPLE_PER_ROAD ? "main" : "minor", fixed: false });
    }
    // By the sea a road must leave over land: a lane towards the water is dropped, and a parent's
    // road whose bearing meets the frame's edge in the water leaves at the nearest dry bearing
    if (T.shore) {
        const dryExit = (bearing) => !T.seaAt(exitPoint([0, 0], compass(bearing), T.half, g * 1.5));
        for (const approach of approaches) {
            approach.exitBearing = approach.bearing;
            if (approach.to || dryExit(approach.bearing)) continue;
            // On a cavern floor a way that meets the cavern's wall runs on into the rock as a
            // tunnel: the road ends at the wall's foot on its bearing (only the parent's own ways)
            if (T.shore.rock && approach.fixed) {
                const v = compass(approach.bearing);
                const d = T.shore.edgeAt(approach.bearing) - WALL_FOOT;
                approach.to = [v[0] * d, v[1] * d];
                // Into the rock as a tunnel; at a lake's shore it is a landing
                approach.tunnel = T.shore.waterAt(approach.bearing) >= T.shore.wallAt(approach.bearing);
                approach.landing = !approach.tunnel;
                continue;
            }
            approach.exitBearing = null;
            if (!approach.fixed) continue;
            for (let turn = 2; turn <= 120 && approach.exitBearing == null; turn += 2) {
                for (const sign of [1, -1]) {
                    const bearing = (approach.bearing + sign * turn + 360) % 360;
                    if (dryExit(bearing)) {
                        approach.exitBearing = bearing;
                        break;
                    }
                }
            }
        }
        for (let k = approaches.length - 1; k >= 0; k--) if (approaches[k].exitBearing == null) approaches.splice(k, 1);
    }

    const cells = NX * NY;
    const cost = new Float32Array(cells);
    const cellX = (i) => -W / 2 + (i + 0.5) * g;
    const cellY = (j) => -H / 2 + (j + 0.5) * g;
    // Ground that is dearer or cheaper to cross by patches (wet hollows, stony rises, old boundaries
    // a road went round), so the roads wind as real ones do rather than running ruler-straight
    // On a great frame broader patches are laid over them, growing with the frame, or the roads
    // average the small ones out and run straight from the middle like the spokes of a wheel
    const broadM = ROAD_WANDER_M * Math.max(1, Math.max(W, H) / LARGE_FRAME_M);
    for (let j = 0; j < NY; j++) {
        for (let i = 0; i < NX; i++) {
            const k = j * NX + i;
            let rough = 1 + ROAD_WANDER * T.noise.fbm(cellX(i) / ROAD_WANDER_M + 71.3, cellY(j) / ROAD_WANDER_M - 18.9, 3);
            if (broadM > ROAD_WANDER_M) rough += ROAD_WANDER * T.noise.fbm(cellX(i) / broadM - 33.7, cellY(j) / broadM + 52.1, 2);
            cost[k] = terrain.water[k] ? (river.brook ? 6 : 4000) : rough;
        }
    }
    // The bridge (or ford) is the one cheap way over
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) if (segmentDistance([cellX(i), cellY(j)], T.bridge[0], T.bridge[1]) < Math.max(5, g * 0.8)) cost[j * NX + i] = 1;
    const distance = new Float64Array(cells).fill(Infinity);
    const previous = new Int32Array(cells).fill(-1);
    const heap = new MinHeap();
    const start = T.cellOf(C);
    distance[start] = 0;
    heap.push(0, start);
    const DI = [1, -1, 0, 0, 1, 1, -1, -1];
    const DJ = [0, 0, 1, -1, 1, -1, 1, -1];
    const LEN = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];
    const { height } = terrain;
    // The search stops once every road's end is settled: a settled cell's way back never changes
    const ends = new Set(approaches.map((approach) => T.cellOf(approach.to ?? exitPoint([0, 0], compass(approach.exitBearing ?? approach.bearing), T.half, g * 1.5))));
    let open = ends.size;
    while (heap.size && open > 0) {
        const k = heap.pop();
        if (heap.lastPriority > distance[k]) continue;
        if (ends.has(k)) {
            ends.delete(k);
            open--;
        }
        const i = k % NX;
        const j = (k / NX) | 0;
        for (let s = 0; s < 8; s++) {
            const ni = i + DI[s];
            const nj = j + DJ[s];
            if (ni < 0 || nj < 0 || ni >= NX || nj >= NY) continue;
            const m = nj * NX + ni;
            const run = LEN[s] * g;
            const rise = Math.abs(height[m] - height[k]);
            const c = run * (1 + (rise / run / ROAD_GRADE) ** 2) * Math.max(cost[m], cost[k]);
            if (distance[k] + c < distance[m]) {
                distance[m] = distance[k] + c;
                previous[m] = k;
                heap.push(distance[m], m);
            }
        }
    }
    T.roads = approaches.map((approach) => {
        // The road leaves the frame where the parent's bearing from the place meets the edge
        const leaves = approach.exitBearing ?? approach.bearing;
        const edge = approach.to ?? exitPoint([0, 0], compass(leaves), T.half, g * 1.5);
        let k = T.cellOf(edge);
        const path = [];
        while (k >= 0) {
            path.push(k);
            k = previous[k];
        }
        const points = path.map((c) => [cellX(c % NX), cellY((c / NX) | 0)]);
        points[0] = approach.to ?? exitPoint([0, 0], compass(leaves), T.half, 0);
        points[points.length - 1] = C;
        return { points: chaikin(simplify(points, g * 0.9), 3), cls: approach.cls, fixed: approach.fixed, bearing: approach.bearing, leaves, toward: approach.toward ?? null, to: approach.to, tunnel: !!approach.tunnel, landing: !!approach.landing, width: approach.cls === "minor" ? P.streetW + 1 : P.mainW };
    });
}
