/**
 * The settlement map's two framings of one build (P-towns V1, DE): the **town view**, a 4:3 window on
 * the built-up core at 0.4 to 1.25 m a pixel (a great city's on its outer wall), and the
 * **hinterland view**, the whole frame. Resolution is the viewer's and the export's; a framing is a
 * rectangle of the frame in metres and the resolution it opens at.
 *
 * From the prototype's `tools/town-view.mjs`, with the one measure it reads (the built-up core's
 * box, from `tools/measures.mjs`) worked out on a raster over the built ground only rather than the
 * whole frame: the same cells, the same box (checked on the promoted places), a tenth to a fiftieth
 * of the time.
 */
import { polygonCuts } from "./Geometry.js";

/** The core's raster: cells this many metres across, the buildings closed by CLOSE_M, pieces under
 * MIN_PIECE_HA dropped, then opened by OPEN_M so thin ribbons along the roads drop away. */
export const CORE = Object.freeze({ CELL_M: 2, CLOSE_M: 25, MIN_PIECE_HA: 1, OPEN_M: 40, PAD_M: 200 });

/** The country's buildings, which are not the built-up core's. */
const COUNTRY = new Set(["farmhouse", "barn"]);

/** The hinterland view: the whole frame at the drawing's own detail. */
export function hinterlandView(town, mPerPx = 1.25) {
    const W = town.frame.width;
    const H = town.frame.height;
    return { rect: [-W / 2, -H / 2, W / 2, H / 2], width: W, height: H, mPerPx, widthPx: Math.round(W / mPerPx), heightPx: Math.round(H / mPerPx) };
}

export const VIEW = Object.freeze({
    SHARE: 0.47,               // the middle of the agreed 40% to 55%
    ASPECT: 4 / 3,
    TARGET_PX: 4800,
    M_PER_PX: Object.freeze([0.4, 1.25]),
    MIN_WIDTH_M: 900,          // a hamlet's view still shows its fields round it
    // A great city (two rings) whose built-up core would take more than WALLED_FROM of its frame is
    // framed on its outer wall instead (its arms along the roads and shores would stretch the view
    // to the frame), the wall taking WALLED_SHARE of the view (Ken, 2026-11-16)
    WALLED_FROM: 0.75,
    WALLED_SHARE: 0.65,
});

/** The town view's rectangle (metres from the frame's centre) and resolution. */
export function townView(town, measures = { coreBox: coreBox(town) }) {
    const W = town.frame.width, H = town.frame.height;
    const fit = (box, share) => Math.max((box[2] - box[0]) / share, ((box[3] - box[1]) / share) * VIEW.ASPECT, VIEW.MIN_WIDTH_M);
    let box = measures.coreBox ?? [-100, -100, 100, 100];
    // A village straggles along its roads in ribbons the core drops: framed on its houses instead,
    // all but the furthest 5% (pre-sign-off, 2026-11-17)
    if (town.kind === "village") box = villageBox(town) ?? box;
    // Only where the built-up core would fill most of the frame does the outer wall frame it instead
    const ring = town.outerWall?.polygon;
    if (ring && fit(box, VIEW.SHARE) > VIEW.WALLED_FROM * Math.min(W, H * VIEW.ASPECT)) box = boxOf(ring);
    const share = box === measures.coreBox || !ring ? VIEW.SHARE : VIEW.WALLED_SHARE;
    const [x0, y0, x1, y1] = box;
    const cw = x1 - x0, ch = y1 - y0;
    let width = fit(box, share);
    width = Math.min(width, W, H * VIEW.ASPECT);
    const height = width / VIEW.ASPECT;
    const cx = Math.min(W / 2 - width / 2, Math.max(-W / 2 + width / 2, (x0 + x1) / 2));
    const cy = Math.min(H / 2 - height / 2, Math.max(-H / 2 + height / 2, (y0 + y1) / 2));
    const mPerPx = Math.min(VIEW.M_PER_PX[1], Math.max(VIEW.M_PER_PX[0], width / VIEW.TARGET_PX));
    return {
        rect: [cx - width / 2, cy - height / 2, cx + width / 2, cy + height / 2],
        width, height, mPerPx,
        widthPx: Math.round(width / mPerPx), heightPx: Math.round(height / mPerPx),
        coreShare: +(cw / width).toFixed(3), coreShareHeight: +(ch / height).toFixed(3),
    };
}

function boxOf(points) {
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** The box round a village's houses, all but the furthest 5% from its centre. */
function villageBox(town) {
    const pts = town.buildings.filter((b) => b.kind === "house").map((b) => b.poly[0]);
    if (pts.length < 3) return null;
    const c = town.centre ?? [0, 0];
    const d = pts.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1])).sort((a, b) => a - b);
    const cut = d[Math.floor(d.length * 0.95)];
    return boxOf(pts.filter((p) => Math.hypot(p[0] - c[0], p[1] - c[1]) <= cut));
}

/**
 * The built-up core's box in metres from the frame's centre, or null: every roof but the country's
 * (and the halls of places of worship), closed, the walled ground counted as built up, then opened.
 * The raster covers the built ground padded by PAD_M on the frame's own grid, so its cells are the
 * cells a raster over the whole frame would have.
 */
export function coreBox(town) {
    const roofs = [];
    for (const b of town.buildings) if (!COUNTRY.has(b.kind)) roofs.push(b.poly);
    for (const w of town.worship ?? []) for (const p of w.body ?? []) roofs.push(p);
    const ring = town.outerWall ?? town.wall;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const poly of ring ? [...roofs, ring.polygon] : roofs) {
        for (const [x, y] of poly) {
            if (x < x0) x0 = x;
            if (y < y0) y0 = y;
            if (x > x1) x1 = x;
            if (y > y1) y1 = y;
        }
    }
    if (x0 > x1) return null;
    const { CELL_M, PAD_M } = CORE;
    const W = town.frame.width, H = town.frame.height;
    const snap = (v, origin) => origin + Math.floor((v - origin) / CELL_M) * CELL_M;
    const gx0 = Math.max(-W / 2, snap(x0 - PAD_M, -W / 2));
    const gy0 = Math.max(-H / 2, snap(y0 - PAD_M, -H / 2));
    const NX = Math.ceil((Math.min(W / 2, x1 + PAD_M) - gx0) / CELL_M);
    const NY = Math.ceil((Math.min(H / 2, y1 + PAD_M) - gy0) / CELL_M);
    const G = { x0: gx0, y0: gy0, NX, NY, cell: CELL_M };
    const roofMask = new Uint8Array(NX * NY);
    for (const poly of roofs) fill(G, roofMask, poly);
    let wall = null;
    if (ring) {
        wall = new Uint8Array(NX * NY);
        fill(G, wall, ring.polygon);
        // Water inside the ring is not walled ground
        if (town.shore?.wetAt) {
            for (let k = 0; k < wall.length; k++) {
                if (!wall[k]) continue;
                const i = k % NX, j = (k - i) / NX;
                if (town.shore.wetAt([gx0 + (i + 0.5) * CELL_M, gy0 + (j + 0.5) * CELL_M])) wall[k] = 0;
            }
        }
    }
    const cells = coreCells(roofMask, wall, NX, NY);
    return cells ? [gx0 + cells[0] * CELL_M, gy0 + cells[1] * CELL_M, gx0 + cells[2] * CELL_M, gy0 + cells[3] * CELL_M] : null;
}

/** The core's box in cells: the roofs closed, the walled ground added, opened by OPEN_M. */
function coreCells(roofs, wall, NX, NY) {
    const { CELL_M, CLOSE_M, MIN_PIECE_HA, OPEN_M } = CORE;
    const mass = close(roofs, NX, NY, CLOSE_M / CELL_M, (MIN_PIECE_HA * 10000) / (CELL_M * CELL_M));
    const r2 = (OPEN_M / CELL_M) ** 2;
    const built = new Uint8Array(NX * NY);
    for (let k = 0; k < built.length; k++) built[k] = mass[k] || (wall && wall[k]) ? 1 : 0;
    const notBuilt = new Uint8Array(NX * NY);
    for (let k = 0; k < built.length; k++) notBuilt[k] = built[k] ? 0 : 1;
    const dIn = sqDistance(notBuilt, NX, NY);
    const eroded = new Uint8Array(NX * NY);
    for (let k = 0; k < built.length; k++) eroded[k] = dIn[k] > r2 ? 1 : 0;
    const dOut = sqDistance(eroded, NX, NY);
    let minI = Infinity, maxI = -Infinity, minJ = Infinity, maxJ = -Infinity;
    for (let j = 0; j < NY; j++) {
        for (let i = 0; i < NX; i++) {
            if (dOut[j * NX + i] > r2 || !built[j * NX + i]) continue;
            if (i < minI) minI = i;
            if (i > maxI) maxI = i;
            if (j < minJ) minJ = j;
            if (j > maxJ) maxJ = j;
        }
    }
    return maxI >= minI ? [minI, minJ, maxI + 1, maxJ + 1] : null;
}

/** Marks the cells whose centres lie inside a polygon. */
function fill(G, data, poly) {
    let minY = Infinity, maxY = -Infinity;
    for (const p of poly) {
        if (p[1] < minY) minY = p[1];
        if (p[1] > maxY) maxY = p[1];
    }
    const j0 = Math.max(0, Math.floor((minY - G.y0) / G.cell));
    const j1 = Math.min(G.NY - 1, Math.ceil((maxY - G.y0) / G.cell));
    for (let j = j0; j <= j1; j++) {
        const y = G.y0 + (j + 0.5) * G.cell;
        const cuts = polygonCuts(poly, y).sort((a, b) => a - b);
        for (let k = 0; k + 1 < cuts.length; k += 2) {
            const i0 = Math.max(0, Math.ceil((cuts[k] - G.x0) / G.cell - 0.5));
            const i1 = Math.min(G.NX - 1, Math.floor((cuts[k + 1] - G.x0) / G.cell - 0.5));
            for (let i = i0; i <= i1; i++) data[j * G.NX + i] = 1;
        }
    }
}

/** Squared Euclidean distance (in cells²) from every cell to the nearest set cell (Felzenszwalb). */
function sqDistance(mask, NX, NY) {
    const INF = 1e12;
    const f = new Float64Array(Math.max(NX, NY));
    const d = new Float64Array(Math.max(NX, NY));
    const v = new Int32Array(Math.max(NX, NY));
    const z = new Float64Array(Math.max(NX, NY) + 1);
    const out = new Float64Array(NX * NY);
    const pass = (n) => {
        let k = 0;
        v[0] = 0; z[0] = -INF; z[1] = INF;
        for (let q = 1; q < n; q++) {
            let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
            while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
            k++; v[k] = q; z[k] = s; z[k + 1] = INF;
        }
        k = 0;
        for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) ** 2 + f[v[k]]; }
    };
    for (let i = 0; i < NX; i++) {
        for (let j = 0; j < NY; j++) f[j] = mask[j * NX + i] ? 0 : INF;
        pass(NY);
        for (let j = 0; j < NY; j++) out[j * NX + i] = d[j];
    }
    for (let j = 0; j < NY; j++) {
        for (let i = 0; i < NX; i++) f[i] = out[j * NX + i];
        pass(NX);
        for (let i = 0; i < NX; i++) out[j * NX + i] = d[i];
    }
    return out;
}

/** The mask closed by r cells, then pieces under minCells dropped. */
function close(mask, NX, NY, r, minCells) {
    const r2 = r * r;
    const d1 = sqDistance(mask, NX, NY);
    const grown = new Uint8Array(NX * NY);
    for (let k = 0; k < grown.length; k++) grown[k] = d1[k] <= r2 ? 1 : 0;
    const outside = new Uint8Array(NX * NY);
    for (let k = 0; k < grown.length; k++) outside[k] = grown[k] ? 0 : 1;
    const d2 = sqDistance(outside, NX, NY);
    const closed = new Uint8Array(NX * NY);
    for (let k = 0; k < closed.length; k++) closed[k] = d2[k] > r2 ? 1 : 0;
    // Drop small pieces
    const seen = new Int32Array(NX * NY);
    const stack = [];
    let label = 0;
    for (let k = 0; k < closed.length; k++) {
        if (!closed[k] || seen[k]) continue;
        label++;
        const members = [];
        stack.push(k); seen[k] = label;
        while (stack.length) {
            const c = stack.pop();
            members.push(c);
            const i = c % NX, j = (c - i) / NX;
            if (i > 0 && closed[c - 1] && !seen[c - 1]) { seen[c - 1] = label; stack.push(c - 1); }
            if (i < NX - 1 && closed[c + 1] && !seen[c + 1]) { seen[c + 1] = label; stack.push(c + 1); }
            if (j > 0 && closed[c - NX] && !seen[c - NX]) { seen[c - NX] = label; stack.push(c - NX); }
            if (j < NY - 1 && closed[c + NX] && !seen[c + NX]) { seen[c + NX] = label; stack.push(c + NX); }
        }
        if (members.length < minCells) for (const c of members) closed[c] = 0;
    }
    return closed;
}

