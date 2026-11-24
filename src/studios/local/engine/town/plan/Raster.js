// The plan's raster: a fine grid over the ground being laid out (the walled town, or a town's
// core), on which streets, grounds and barriers are stamped, so the blocks the network encloses can
// be read off as connected runs of free ground, and least-cost streets routed between points.
import { MinHeap } from "../../../../../kernel/util/MinHeap.js";
import { insideCuts, polygonCuts, segmentDistance } from "../../Geometry.js";

/** What a cell holds. Free ground is block; streets bound blocks; barriers bound them too but are
 * not frontage (the wall, the castle, grounds, the market, water, beyond the ring). */
export const CELL = Object.freeze({ FREE: 0, STREET: 1, BARRIER: 2 });

export function makeRaster(box, step) {
    const [x0, y0, x1, y1] = box;
    const NX = Math.max(2, Math.ceil((x1 - x0) / step));
    const NY = Math.max(2, Math.ceil((y1 - y0) / step));
    const cell = new Uint8Array(NX * NY);
    // The lowest rank of street stamped on a cell (0 main, 1 lesser, 2 lane), 9 for none
    const rank = new Uint8Array(NX * NY).fill(9);
    // The street (edge id + 1) stamped on a cell, so a cut knows which street it met
    const edge = new Int32Array(NX * NY);
    const R = {
        box, step, NX, NY, cell, rank, edge,
        x: (i) => x0 + (i + 0.5) * step,
        y: (j) => y0 + (j + 0.5) * step,
        at: (p) => {
            const i = Math.floor((p[0] - x0) / step);
            const j = Math.floor((p[1] - y0) / step);
            return i < 0 || j < 0 || i >= NX || j >= NY ? -1 : j * NX + i;
        },
        point: (k) => [x0 + ((k % NX) + 0.5) * step, y0 + (((k / NX) | 0) + 0.5) * step],
        /** Marks every cell within `half` of the polyline. */
        stampLine(points, half, value, { r = 9, id = -1 } = {}) {
            for (let k = 0; k + 1 < points.length; k++) {
                const a = points[k];
                const b = points[k + 1];
                const i0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - half - x0) / step));
                const i1 = Math.min(NX - 1, Math.floor((Math.max(a[0], b[0]) + half - x0) / step));
                const j0 = Math.max(0, Math.floor((Math.min(a[1], b[1]) - half - y0) / step));
                const j1 = Math.min(NY - 1, Math.floor((Math.max(a[1], b[1]) + half - y0) / step));
                for (let j = j0; j <= j1; j++) {
                    for (let i = i0; i <= i1; i++) {
                        if (segmentDistance([R.x(i), R.y(j)], a, b) > half) continue;
                        const m = j * NX + i;
                        if (value === CELL.STREET) {
                            if (cell[m] === CELL.BARRIER) continue;
                            cell[m] = CELL.STREET;
                            if (r < rank[m]) rank[m] = r;
                            if (id >= 0 && !edge[m]) edge[m] = id + 1;
                        } else if (cell[m] < value) cell[m] = value;
                    }
                }
            }
        },
        stampPolygon(poly, value) {
            const ys = poly.map((p) => p[1]);
            const j0 = Math.max(0, Math.floor((Math.min(...ys) - y0) / step));
            const j1 = Math.min(NY - 1, Math.floor((Math.max(...ys) - y0) / step));
            for (let j = j0; j <= j1; j++) {
                const cuts = polygonCuts(poly, R.y(j));
                if (!cuts.length) continue;
                for (let i = 0; i < NX; i++) {
                    if (!insideCuts(cuts, R.x(i))) continue;
                    const m = j * NX + i;
                    if (cell[m] < value) cell[m] = value;
                }
            }
        },
        /** Everything outside the polygon becomes barrier. */
        keepInside(poly) {
            for (let j = 0; j < NY; j++) {
                const cuts = polygonCuts(poly, R.y(j));
                for (let i = 0; i < NX; i++) if (!insideCuts(cuts, R.x(i))) cell[j * NX + i] = CELL.BARRIER;
            }
        },
    };
    return R;
}

/**
 * Connected runs of free cells (4-neighbour) among `seeds` (every cell if null) whose label is -1,
 * each with its cells, area and the streets it fronts. Labels start at `first`.
 */
export function components(R, labels, seeds = null, first = 0) {
    const { NX, NY, cell, rank, edge } = R;
    const out = [];
    const queue = new Int32Array(seeds ? seeds.length : NX * NY);
    const total = seeds ? seeds.length : NX * NY;
    for (let s = 0; s < total; s++) {
        const start = seeds ? seeds[s] : s;
        if (cell[start] !== CELL.FREE || labels[start] !== -1) continue;
        const label = first + out.length;
        let head = 0;
        let tail = 0;
        queue[tail++] = start;
        labels[start] = label;
        const cells = [];
        let minRank = 9;
        const fronts = new Set();
        let streetTouch = 0;
        let barrierTouch = 0;
        while (head < tail) {
            const k = queue[head++];
            cells.push(k);
            const i = k % NX;
            const j = (k / NX) | 0;
            const ns = [i > 0 ? k - 1 : -1, i < NX - 1 ? k + 1 : -1, j > 0 ? k - NX : -1, j < NY - 1 ? k + NX : -1];
            for (const m of ns) {
                if (m < 0) {
                    barrierTouch++;
                    continue;
                }
                if (cell[m] === CELL.FREE) {
                    if (labels[m] === -1) {
                        labels[m] = label;
                        queue[tail++] = m;
                    }
                } else if (cell[m] === CELL.STREET) {
                    streetTouch++;
                    if (rank[m] < minRank) minRank = rank[m];
                    if (edge[m]) fronts.add(edge[m] - 1);
                } else barrierTouch++;
            }
        }
        out.push({ label, cells, area: cells.length * R.step * R.step, minRank, fronts, streetTouch, barrierTouch });
    }
    return out;
}

/** A block's middle and its long and short axes (unit vectors), from its cells. */
export function axes(R, cells) {
    let sx = 0, sy = 0;
    for (const k of cells) {
        const p = R.point(k);
        sx += p[0];
        sy += p[1];
    }
    const c = [sx / cells.length, sy / cells.length];
    let xx = 0, xy = 0, yy = 0;
    for (const k of cells) {
        const p = R.point(k);
        const dx = p[0] - c[0], dy = p[1] - c[1];
        xx += dx * dx;
        xy += dx * dy;
        yy += dy * dy;
    }
    const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
    const u = [Math.cos(angle), Math.sin(angle)];
    const v = [-u[1], u[0]];
    // Extent along each axis
    let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
    for (const k of cells) {
        const p = R.point(k);
        const a = (p[0] - c[0]) * u[0] + (p[1] - c[1]) * u[1];
        const b = (p[0] - c[0]) * v[0] + (p[1] - c[1]) * v[1];
        if (a < uMin) uMin = a;
        if (a > uMax) uMax = a;
        if (b < vMin) vMin = b;
        if (b > vMax) vMax = b;
    }
    return { c, u, v, long: uMax - uMin, short: vMax - vMin, uMin, uMax };
}

/**
 * The cheapest way over the raster from `from` to any cell `isEnd` accepts, 8-neighbour, a step's
 * cost its length times `costOf` at both ends (Infinity is impassable). Returns cell indices from
 * `from` to the end, or null.
 */
export function route(R, from, isEnd, costOf) {
    const { NX, NY } = R;
    const n = NX * NY;
    const distance = new Float64Array(n).fill(Infinity);
    const previous = new Int32Array(n).fill(-1);
    const heap = new MinHeap();
    distance[from] = 0;
    heap.push(0, from);
    const DI = [1, -1, 0, 0, 1, 1, -1, -1];
    const DJ = [0, 0, 1, -1, 1, -1, 1, -1];
    const LEN = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];
    let end = -1;
    while (heap.size) {
        const k = heap.pop();
        if (heap.lastPriority > distance[k]) continue;
        if (k !== from && isEnd(k)) {
            end = k;
            break;
        }
        const i = k % NX;
        const j = (k / NX) | 0;
        const ck = costOf(k, -1);
        for (let s = 0; s < 8; s++) {
            const ni = i + DI[s];
            const nj = j + DJ[s];
            if (ni < 0 || nj < 0 || ni >= NX || nj >= NY) continue;
            const m = nj * NX + ni;
            const cm = costOf(m, k);
            if (!Number.isFinite(cm)) continue;
            const c = distance[k] + LEN[s] * R.step * (ck + cm) * 0.5;
            if (c < distance[m]) {
                distance[m] = c;
                previous[m] = k;
                heap.push(c, m);
            }
        }
    }
    if (end < 0) return null;
    const path = [];
    for (let k = end; k >= 0; k = previous[k]) path.push(k);
    return path.reverse();
}
