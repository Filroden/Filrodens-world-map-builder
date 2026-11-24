// The built-up ground as polygons (Ken, 2026-11-17): the houses, their plots and yards closed by
// BUILT_UP.CLOSE_M (filled out by that much and drawn back again), so the ground between a
// village's tofts, or between a town's blocks, is the place's ground and not the field it was
// built over. The renderer fills it under the ways and yards; fields still run beneath it, as the
// land budget counts them, but none shows through.
import { distanceTransform, polygonArea, simplify } from "../Geometry.js";

export const BUILT_UP = Object.freeze({
    /** How far gaps are closed across (m), by the kind of place: a gap under twice this is filled
     * (a village's tofts stand further apart than a town's blocks). */
    CLOSE_M: Object.freeze({ village: 45, town: 30, city: 25 }),
    /** The raster's square (m), and for a frame wider than LARGE_M a coarser one. */
    CELL_M: 4,
    LARGE_M: 9000,
    LARGE_CELL_M: 6,
    /** A piece smaller than this (m²) is not built-up ground (a lone cottage among fields). */
    LEAST_M2: 5000,
});

/** Buildings out among the fields: not the place's built-up ground. */
const COUNTRY = new Set(["farmhouse", "barn"]);

/** Fills `T.builtUp` with the built-up ground's outlines and holes (closed rings in metres, to fill even-odd). */
export function buildBuiltUp(T) {
    T.builtUp = [];
    if (T.input.cave) return;
    const polys = [];
    for (const b of T.buildings) if (!COUNTRY.has(b.kind) && !b.workedEstate && b.poly?.length > 2) polys.push(b.poly);
    for (const y of T.yards ?? []) if (y.poly?.length > 2) polys.push(y.poly);
    for (const p of T.plots ?? []) if (p?.length > 2) polys.push(p);
    if (!polys.length) return;
    const c = T.W > BUILT_UP.LARGE_M ? BUILT_UP.LARGE_CELL_M : BUILT_UP.CELL_M;
    const R = BUILT_UP.CLOSE_M[T.kind] ?? BUILT_UP.CLOSE_M.town;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const poly of polys) for (const p of poly) {
        if (p[0] < x0) x0 = p[0];
        if (p[1] < y0) y0 = p[1];
        if (p[0] > x1) x1 = p[0];
        if (p[1] > y1) y1 = p[1];
    }
    const pad = R + 3 * c;
    x0 -= pad;
    y0 -= pad;
    const NX = Math.ceil((x1 + pad - x0) / c) + 1;
    const NY = Math.ceil((y1 + pad - y0) / c) + 1;
    const mask = new Uint8Array(NX * NY);
    // Each polygon's cells (by their middles), and the cells of its corners, so a thin one counts
    for (const poly of polys) {
        let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
        for (const p of poly) {
            const i = Math.floor((p[0] - x0) / c), j = Math.floor((p[1] - y0) / c);
            mask[j * NX + i] = 1;
            if (i < bx0) bx0 = i;
            if (j < by0) by0 = j;
            if (i > bx1) bx1 = i;
            if (j > by1) by1 = j;
        }
        for (let j = by0; j <= by1; j++) {
            const y = y0 + (j + 0.5) * c;
            // (the polygon's crossings of this row)
            const xs = [];
            for (let k = 0; k < poly.length; k++) {
                const a = poly[k], b = poly[(k + 1) % poly.length];
                if ((a[1] > y) !== (b[1] > y)) xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
            }
            xs.sort((p, q) => p - q);
            for (let k = 0; k + 1 < xs.length; k += 2) {
                const i0 = Math.max(bx0, Math.ceil((xs[k] - x0) / c - 0.5));
                const i1 = Math.min(bx1, Math.floor((xs[k + 1] - x0) / c - 0.5));
                for (let i = i0; i <= i1; i++) mask[j * NX + i] = 1;
            }
        }
    }
    // Closing: out by R, then back by R. The distance (m) from the grown ground's edge is the field
    // whose level R is the closed ground's outline
    const d1 = distanceTransform(mask, NX, NY);
    const outside = new Uint8Array(NX * NY);
    for (let k = 0; k < NX * NY; k++) outside[k] = d1[k] * c > R ? 1 : 0;
    // (the raster's own border counts as outside, so every ring closes)
    for (let i = 0; i < NX; i++) outside[i] = outside[(NY - 1) * NX + i] = 1;
    for (let j = 0; j < NY; j++) outside[j * NX] = outside[j * NX + NX - 1] = 1;
    const g = distanceTransform(outside, NX, NY);
    for (let k = 0; k < NX * NY; k++) g[k] *= c;
    const rings = contourRings(g, NX, NY, R, (i, j) => [x0 + (i + 0.5) * c, y0 + (j + 0.5) * c]);
    for (const ring of rings) {
        const a = polygonArea(ring);
        // (holes are kept as rings too: the renderer fills them all even-odd, so a field enclosed by
        // the town shows; a hole smaller than a piece is filled)
        if (Math.abs(a) < BUILT_UP.LEAST_M2) continue;
        // (simplified in two halves: a closed line's ends meet, which the simplifier cannot take)
        const h = Math.floor(ring.length / 2);
        const s = [...simplify(ring.slice(0, h + 1), c * 0.35).slice(0, -1), ...simplify([...ring.slice(h), ring[0]], c * 0.35).slice(0, -1)];
        if (s.length >= 3) T.builtUp.push(s);
    }
}

/**
 * Closed rings where the field `v` crosses `level`, by marching squares over the cells' middles,
 * each point interpolated along its cell edge. Rings with the high side on their left run
 * anticlockwise in map axes (positive area by polygonArea).
 */
function contourRings(v, NX, NY, level, at) {
    // Each crossing point is keyed by its cell edge: horizontal edges (i, j)-(i+1, j) and vertical
    // edges (i, j)-(i, j+1)
    const pointOf = (key) => {
        const horizontal = key % 2 === 0;
        const e = Math.floor(key / 2);
        const i = e % NX, j = Math.floor(e / NX);
        const a = v[j * NX + i];
        const b = horizontal ? v[j * NX + i + 1] : v[(j + 1) * NX + i];
        const t = Math.max(0, Math.min(1, (level - a) / (b - a || 1e-9)));
        const p = at(i, j);
        const q = horizontal ? at(i + 1, j) : at(i, j + 1);
        return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    };
    const H = (i, j) => 2 * (j * NX + i);
    const V = (i, j) => 2 * (j * NX + i) + 1;
    const next = new Map();
    for (let j = 0; j + 1 < NY; j++) {
        for (let i = 0; i + 1 < NX; i++) {
            const a = v[j * NX + i] > level, b = v[j * NX + i + 1] > level;
            const d = v[(j + 1) * NX + i] > level, cc = v[(j + 1) * NX + i + 1] > level;
            const code = (a ? 1 : 0) | (b ? 2 : 0) | (cc ? 4 : 0) | (d ? 8 : 0);
            if (code === 0 || code === 15) continue;
            const top = H(i, j), right = V(i + 1, j), bottom = H(i, j + 1), left = V(i, j);
            const centre = (v[j * NX + i] + v[j * NX + i + 1] + v[(j + 1) * NX + i] + v[(j + 1) * NX + i + 1]) / 4 > level;
            // Segments from -> to, the high side kept on one hand throughout
            const segs = {
                1: [[left, top]], 2: [[top, right]], 3: [[left, right]], 4: [[right, bottom]],
                5: centre ? [[left, bottom], [right, top]] : [[left, top], [right, bottom]],
                6: [[top, bottom]], 7: [[left, bottom]], 8: [[bottom, left]], 9: [[bottom, top]],
                10: centre ? [[top, left], [bottom, right]] : [[top, right], [bottom, left]],
                11: [[bottom, right]], 12: [[right, left]], 13: [[right, top]], 14: [[top, left]],
            }[code];
            for (const [from, to] of segs) next.set(from, to);
        }
    }
    const rings = [];
    const seen = new Set();
    for (const start of next.keys()) {
        if (seen.has(start)) continue;
        const ring = [];
        let k = start;
        while (k !== undefined && !seen.has(k)) {
            seen.add(k);
            ring.push(pointOf(k));
            k = next.get(k);
        }
        if (ring.length >= 3) rings.push(ring);
    }
    return rings;
}
