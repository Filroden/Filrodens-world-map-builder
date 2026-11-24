// A lesser road out of an extra gate: least-cost over the terrain grid from the gate towards the
// frame's edge on the gate's own bearing, joining an approach road where it meets one (Ken: lesser
// roads run from gates round the wall to the local towns and villages).
import { MinHeap } from "../../../../../kernel/util/MinHeap.js";
import { bearingOfVector, chaikin, dist, pointInPolygon, segmentDistance, simplify } from "../../Geometry.js";

const WANDER = 1.6;
const WANDER_M = 420;
const GRADE = 0.04;
/** An approach road this cheap to follow, and joined once the lesser road is this far (m) out. */
const FOLLOW = 0.45;
const JOIN_AFTER_M = 260;
/** ... and within about 55° of its own heading (the cosine). */
const JOIN_AHEAD = 0.57;
/** Ground within this distance (m) of the wall is dearer, so a lesser road heads out, not round. */
const WALL_FOOT_M = 70;
const WALL_FOOT_COST = 3;
const BACK_COST = 2;

export function lesserRoad(T, gate, angle, ring) {
    const { NX, NY, g, W, H, terrain, river, P } = T;
    const out = [Math.cos(angle), Math.sin(angle)];
    const start = [gate.p[0] + out[0] * g * 1.5, gate.p[1] + out[1] * g * 1.5];
    const s0 = T.cellOf(start);
    if (s0 < 0) return null;
    // The frame's edge on the gate's bearing
    // (over land: a ray that reaches the water first gives no road)
    let edgeP = start;
    for (let s = 0; s < W + H; s += g) {
        const q = [start[0] + out[0] * s, start[1] + out[1] * s];
        if (!T.inFrame(q)) break;
        if (T.seaAt(q)) return null;
        edgeP = q;
    }
    const edgeTrue = edgeP;
    edgeP = [edgeP[0] - out[0] * g * 1.5, edgeP[1] - out[1] * g * 1.5];
    const target = T.cellOf(edgeP);
    const cellX = (i) => -W / 2 + (i + 0.5) * g;
    const cellY = (j) => -H / 2 + (j + 0.5) * g;
    // Approach roads' cells beyond the ring
    const onRoad = new Uint8Array(NX * NY);
    for (const road of T.roads) {
        const pts = road.outside ?? road.points;
        for (let k = 0; k + 1 < pts.length; k++) {
            const steps = Math.ceil(dist(pts[k], pts[k + 1]) / (g * 0.5)) + 1;
            for (let t = 0; t <= steps; t++) {
                const p = [pts[k][0] + ((pts[k + 1][0] - pts[k][0]) * t) / steps, pts[k][1] + ((pts[k + 1][1] - pts[k][1]) * t) / steps];
                const c = T.cellOf(p);
                if (c >= 0) onRoad[c] = 1;
            }
        }
    }
    for (const other of T.plan.lesserRoads) for (const p of other.outside) {
        const c = T.cellOf(p);
        if (c >= 0) onRoad[c] = 1;
    }
    const n = NX * NY;
    const distance = new Float64Array(n).fill(Infinity);
    const previous = new Int32Array(n).fill(-1);
    const heap = new MinHeap();
    distance[s0] = 0;
    heap.push(0, s0);
    const DI = [1, -1, 0, 0, 1, 1, -1, -1];
    const DJ = [0, 0, 1, -1, 1, -1, 1, -1];
    const LEN = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];
    const costCache = new Float32Array(n).fill(-1);
    const costAt = (k) => {
        if (costCache[k] >= 0) return costCache[k];
        const p = [cellX(k % NX), cellY((k / NX) | 0)];
        let c;
        if (pointInPolygon(p, ring) || (T.castle && pointInPolygon(p, T.castle.polygon))) c = Infinity;
        else if (terrain.water[k]) c = river.brook ? 6 : 4000;
        else c = 1 + WANDER * T.noise.fbm(p[0] / WANDER_M + 13.3, p[1] / WANDER_M + 7.7, 3);
        if (Number.isFinite(c) && ringDistance(p, ring) < WALL_FOOT_M) c *= WALL_FOOT_COST;
        // Turning back round the town is dearer than heading out
        if (Number.isFinite(c) && (p[0] - gate.p[0]) * out[0] + (p[1] - gate.p[1]) * out[1] < 0.3 * dist(p, gate.p)) c *= BACK_COST;
        if (onRoad[k] && Number.isFinite(c)) c *= FOLLOW;
        costCache[k] = c;
        return c;
    };
    const { height } = terrain;
    let end = -1;
    let joined = false;
    while (heap.size) {
        const k = heap.pop();
        if (heap.lastPriority > distance[k]) continue;
        const p = [cellX(k % NX), cellY((k / NX) | 0)];
        if (k === target) {
            end = k;
            break;
        }
        // It joins an approach road only ahead of it, not by turning back round the town
        const ahead = ((p[0] - gate.p[0]) * out[0] + (p[1] - gate.p[1]) * out[1]) / (dist(p, gate.p) || 1) > JOIN_AHEAD;
        if (onRoad[k] && ahead && dist(p, gate.p) > JOIN_AFTER_M && ringDistance(p, ring) > WALL_FOOT_M * 2) {
            end = k;
            joined = true;
            break;
        }
        const i = k % NX;
        const j = (k / NX) | 0;
        for (let s = 0; s < 8; s++) {
            const ni = i + DI[s];
            const nj = j + DJ[s];
            if (ni < 0 || nj < 0 || ni >= NX || nj >= NY) continue;
            const m = nj * NX + ni;
            const cm = costAt(m);
            if (!Number.isFinite(cm)) continue;
            const run = LEN[s] * g;
            const rise = Math.abs(height[m] - height[k]);
            const c = run * (1 + (rise / run / GRADE) ** 2) * Math.max(cm, costAt(k));
            if (distance[k] + c < distance[m]) {
                distance[m] = c + distance[k];
                previous[m] = k;
                heap.push(distance[m], m);
            }
        }
    }
    if (end < 0) return null;
    const path = [];
    for (let k = end; k >= 0; k = previous[k]) path.push(k);
    // From the far end to the gate, as the approach roads run
    let points = path.map((c) => [cellX(c % NX), cellY((c / NX) | 0)]);
    if (joined) {
        // Onto the road it meets, exactly
        const at = points[0];
        let best = null;
        for (const road of [...T.roads, ...T.plan.lesserRoads]) {
            const pts = road.outside ?? road.points;
            for (let k = 0; k + 1 < pts.length; k++) {
                const d = segmentDistance(at, pts[k], pts[k + 1]);
                if (!best || d < best.d) best = { d, a: pts[k], b: pts[k + 1] };
            }
        }
        if (best) {
            const ab = [best.b[0] - best.a[0], best.b[1] - best.a[1]];
            const L2 = ab[0] * ab[0] + ab[1] * ab[1] || 1;
            const t = Math.max(0, Math.min(1, ((at[0] - best.a[0]) * ab[0] + (at[1] - best.a[1]) * ab[1]) / L2));
            points[0] = [best.a[0] + ab[0] * t, best.a[1] + ab[1] * t];
        }
    } else points[0] = edgeTrue;
    points.push(gate.p);
    points = chaikin(simplify(points, g * 0.9), 3);
    if (points.length < 2) return null;
    const bearing = Math.round(bearingOfVector(points[0]));
    return { points, outside: points, cls: "minor", lesser: true, fixed: false, bearing, leaves: bearing, toward: null, width: P.streetW + 1, gate, joins: joined };
}

function ringDistance(p, ring) {
    let d = Infinity;
    for (let k = 0; k < ring.length; k++) d = Math.min(d, segmentDistance(p, ring[k], ring[(k + 1) % ring.length]));
    return d;
}
