// The occupancy grid: what stands on each square metre or so of the frame, so nothing is placed
// over a street, the water or anything already built. Kept items are stamped first, so a re-run
// never builds over them.
import { insideCuts as insideRow, polygonCuts as crossings, segmentDistance } from "../Geometry.js";

export const FREE = 0;
export const STREET = 1;
export const WATER = 2;
/** Walls, castle, yards and the market. */
export const RESERVED = 3;
export const BUILDING = 4;
export const PLOT = 5;

export function makeOccupancy(T) {
    const { W, H, P, river } = T;
    const O = P.occ;
    const MX = Math.ceil(W / O);
    const MY = Math.ceil(H / O);
    const grid = new Uint8Array(MX * MY);
    const index = (x, y) => {
        const i = Math.floor((x + W / 2) / O);
        const j = Math.floor((y + H / 2) / O);
        return i < 0 || j < 0 || i >= MX || j >= MY ? -1 : j * MX + i;
    };
    const occupancy = {
        grid,
        size: [MX, MY],
        step: O,
        index,
        at: (p) => {
            const m = index(p[0], p[1]);
            return m < 0 ? -1 : grid[m];
        },
        stampPolyline(points, half, value) {
            for (let k = 0; k + 1 < points.length; k++) {
                const a = points[k];
                const b = points[k + 1];
                const x0 = Math.min(a[0], b[0]) - half;
                const x1 = Math.max(a[0], b[0]) + half;
                const y0 = Math.min(a[1], b[1]) - half;
                const y1 = Math.max(a[1], b[1]) + half;
                for (let y = y0; y <= y1; y += O) {
                    for (let x = x0; x <= x1; x += O) {
                        if (segmentDistance([x, y], a, b) > half) continue;
                        const m = index(x, y);
                        if (m >= 0 && grid[m] < value) grid[m] = value;
                    }
                }
            }
        },
        /** Overwrites `from` with `to` along a polyline (gates opening a wall). */
        clearPolyline(points, half, from, to, keep = () => false) {
            for (let k = 0; k + 1 < points.length; k++) {
                const a = points[k];
                const b = points[k + 1];
                const x0 = Math.min(a[0], b[0]) - half;
                const x1 = Math.max(a[0], b[0]) + half;
                const y0 = Math.min(a[1], b[1]) - half;
                const y1 = Math.max(a[1], b[1]) + half;
                for (let y = y0; y <= y1; y += O) {
                    for (let x = x0; x <= x1; x += O) {
                        if (segmentDistance([x, y], a, b) > half || keep([x, y])) continue;
                        const m = index(x, y);
                        if (m >= 0 && grid[m] === from) grid[m] = to;
                    }
                }
            }
        },
        stampPolygon(poly, value) {
            const xs = poly.map((p) => p[0]);
            const ys = poly.map((p) => p[1]);
            const xMin = Math.min(...xs);
            const xMax = Math.max(...xs);
            for (let y = Math.min(...ys); y <= Math.max(...ys); y += O / 2) {
                const cuts = crossings(poly, y);
                if (!cuts.length) continue;
                for (let x = xMin; x <= xMax; x += O / 2) {
                    if (!insideRow(cuts, x)) continue;
                    const m = index(x, y);
                    if (m >= 0 && grid[m] < value) grid[m] = value;
                }
            }
        },
        /** True when nothing stands inside the polygon (streets, or plots, allowed if asked). */
        free(poly, allowStreet = false, allowPlot = false) {
            const xs = poly.map((p) => p[0]);
            const ys = poly.map((p) => p[1]);
            const xMin = Math.min(...xs);
            const xMax = Math.max(...xs);
            for (let y = Math.min(...ys); y <= Math.max(...ys); y += O * 0.9) {
                const cuts = crossings(poly, y);
                if (!cuts.length) continue;
                for (let x = xMin; x <= xMax; x += O * 0.9) {
                    if (!insideRow(cuts, x)) continue;
                    const m = index(x, y);
                    if (m < 0) return false;
                    if (grid[m] && !(allowStreet && grid[m] === STREET) && !(allowPlot && grid[m] === PLOT)) return false;
                }
            }
            return true;
        },
    };
    // The river is marked along its course, not by testing every square of the frame against it
    occupancy.stampPolyline(river.line, river.width / 2 + 2, WATER);
    // The sea or lake, square by square of the terrain grid (buildings test the shore exactly).
    // Each terrain square covers the same occupancy columns in every row and the same rows in
    // every column, so those are worked out once, by the same arithmetic as a point's index.
    if (T.shore) {
        const { sea, NX, NY, g } = T.terrain;
        const columns = [];
        for (let i = 0; i < NX; i++) {
            const x0 = -W / 2 + i * g;
            const list = [];
            for (let x = x0; x < x0 + g; x += O) {
                const c = Math.floor((x + O / 2 + W / 2) / O);
                if (c >= 0 && c < MX) list.push(c);
            }
            columns.push(list);
        }
        const rows = [];
        for (let j = 0; j < NY; j++) {
            const y0 = -H / 2 + j * g;
            const list = [];
            for (let y = y0; y < y0 + g; y += O) {
                const r = Math.floor((y + O / 2 + H / 2) / O);
                if (r >= 0 && r < MY) list.push(r);
            }
            rows.push(list);
        }
        const fills = (i, j) => {
            if (!sea[j * NX + i]) return false;
            const x0 = -W / 2 + i * g;
            const y0 = -H / 2 + j * g;
            // Underground, the galleries are only a few cells wide: a cell is rock only if it is
            // rock at every corner, and what stands at the edge is tested exactly
            const inner = i > 0 && j > 0 && i < NX - 1 && j < NY - 1 && sea[j * NX + i - 1] && sea[j * NX + i + 1] && sea[(j - 1) * NX + i] && sea[(j + 1) * NX + i];
            return !(T.input.cave && !inner && ![[x0, y0], [x0 + g, y0], [x0, y0 + g], [x0 + g, y0 + g]].every((q) => T.shore.wetAt(q)));
        };
        // Runs of filled squares along a row become one fill of the grid's row, where their
        // columns follow on without a gap
        for (let j = 0; j < NY; j++) {
            let i = 0;
            while (i < NX) {
                if (!fills(i, j) || !columns[i].length) {
                    i++;
                    continue;
                }
                const from = columns[i][0];
                let to = columns[i][columns[i].length - 1];
                i++;
                while (i < NX && columns[i].length && columns[i][0] === to + 1 && fills(i, j)) {
                    to = columns[i][columns[i].length - 1];
                    i++;
                }
                for (const r of rows[j]) grid.fill(WATER, r * MX + from, r * MX + to + 1);
            }
        }
    }
    T.occupancy = occupancy;
}
