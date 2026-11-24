// Quality round, V3 (Ken, 2026-11-16): every house has its ground behind it. Where the buildings
// stage gave it a plot (the suburbs, the cottages), that plot; otherwise the open ground behind its
// back wall, as deep as is free, up to a depth by its tier, so a block's middle is shared out among
// the houses round it as yards and gardens. Whether a ground is drawn as a yard or a garden is the
// drawing's choice, from the house's wealth and trade.
import { RESERVED } from "./Occupancy.js";

export const YARDS = Object.freeze({
    /** The deepest ground behind a house (m), by tier. */
    DEPTH: Object.freeze({ upper: 30, middle: 18, lower: 12, none: 14 }),
    /** Ground shallower than this (m) is no yard. */
    SHALLOWEST: 2.5,
});

const FREE = 0;
const PLOT = 5;
const BUILDING = 4;

export function buildYards(T) {
    const { occupancy, buildings } = T;
    const yards = [];
    const owned = new Set();
    (T.plots ?? []).forEach((poly, k) => {
        const house = T.plotHouses?.[k];
        if (house === undefined) return;
        owned.add(house);
        yards.push({ poly, house });
    });
    // A house's rear ranges stand in its yard
    const rangesOf = new Map();
    for (const b of buildings) if (b.kind === "range" && Number.isInteger(b.house)) {
        if (!rangesOf.has(b.house)) rangesOf.set(b.house, []);
        rangesOf.get(b.house).push(b.poly);
    }
    const inside = (p, pts) => {
        let r = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
            const [xi, yi] = pts[i], [xj, yj] = pts[j];
            if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) r = !r;
        }
        return r;
    };
    const houseBuckets = new Map();
    buildings.forEach((h, k) => {
        if (h.kind !== "house" && h.kind !== "warehouse") return;
        const xs = h.poly.map((p) => p[0]), ys = h.poly.map((p) => p[1]);
        for (let i = Math.floor(Math.min(...xs) / 20); i <= Math.floor(Math.max(...xs) / 20); i++)
            for (let j = Math.floor(Math.min(...ys) / 20); j <= Math.floor(Math.max(...ys) / 20); j++) {
                const key = `${i},${j}`;
                if (!houseBuckets.has(key)) houseBuckets.set(key, []);
                houseBuckets.get(key).push(k);
            }
    });
    buildings.forEach((b, index) => {
        if (b.kind !== "house" || owned.has(index) || b.estate || b.poly.length !== 4) return;
        // Open ground, or a rear range (anyone's: a yard runs on under the ranges round it), but
        // never another house
        const open = (q) => {
            const v = occupancy.at(q);
            if (v === FREE) return true;
            if (v !== BUILDING) return false;
            const key = `${Math.floor(q[0] / 20)},${Math.floor(q[1] / 20)}`;
            return !(houseBuckets.get(key) ?? []).some((h) => h !== index && inside(q, buildings[h].poly)) && !inside(q, b.poly);
        };
        const [p0, , p2, p3] = b.poly;
        const L = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]) || 1;
        const n = [(p3[0] - p0[0]) / L, (p3[1] - p0[1]) / L];
        const most = YARDS.DEPTH[b.tier ?? "none"] ?? YARDS.DEPTH.none;
        let depth = 0;
        for (let s = 1; s <= most; s += 1) {
            const free = [0.15, 0.5, 0.85].every((f) => {
                // (past the grid cells the house's own back wall marks)
                const o = s - 0.5 + occupancy.step;
                const q = [p3[0] + (p2[0] - p3[0]) * f + n[0] * o, p3[1] + (p2[1] - p3[1]) * f + n[1] * o];
                return open(q);
            });
            if (!free) break;
            depth = s;
        }
        if (depth < YARDS.SHALLOWEST) return;
        const poly = [p3, p2, [p2[0] + n[0] * depth, p2[1] + n[1] * depth], [p3[0] + n[0] * depth, p3[1] + n[1] * depth]];
        occupancy.stampPolygon(poly, PLOT);
        yards.push({ poly, house: index });
    });
    T.yards = yards;
    void RESERVED;
}
