// Quality round, V3: a surface settlement drawn on a 2D canvas in the layers the Local studio will
// draw (handoff §4): ground, fields, woods and trees, water, ways, plots and grounds, shadows,
// buildings, walls, landmarks, labels. Each layer is one function over the engine's plain output
// and a style object (Styles.js); nothing is a raster asset, so every size stays crisp.
//
// Plain JavaScript over a CanvasRenderingContext2D (or anything with its path and fill calls): no
// DOM, no Node. A view is a rectangle of the frame (metres from its centre) and a resolution; the
// drawing works in metres under the view's transform, so widths and sizes are in metres too.
import { ATLAS, CULTURE_DEFAULT, HEIGHTS, mix, rgba, shade } from "./Styles.js";

/** The layers, in the order they are drawn. */
export const LAYERS = Object.freeze(["ground", "fields", "trees", "built", "water", "ways", "grounds", "shadows", "buildings", "walls", "landmarks", "labels"]);

/**
 * Draws `town` into `ctx`.
 * @param view {rect: [x0, y0, x1, y1], mPerPx, widthPx, heightPx, title?: boolean}
 * @param style a style object (Styles.js)
 * @param options {cultures: {[name]: {roof, wall, wallMaterial}}, theme: null (the base appearance:
 *     roofs by their material) or "culture" (roofs and walls in each culture's colours), layers:
 *     names to draw, now: () => ms}
 * @returns the milliseconds each layer took
 */
export function drawTown(ctx, town, view, style, { cultures = {}, theme = null, layers = LAYERS, now = () => 0, outside = null, outsideStyle = ATLAS, links = null, levelIndex = null, level = null } = {}) {
    const m = view.mPerPx;
    const [x0, y0, x1, y1] = view.rect;
    const D = makeDrawing(ctx, town, view, style, cultures, theme);
    D.links = links;
    D.levelIndex = levelIndex;
    D.level = level;
    const times = {};
    const inMetres = () => {
        ctx.setTransform(1 / m, 0, 0, 1 / m, -x0 / m, -y0 / m);
        ctx.beginPath();
        ctx.rect(x0, y0, x1 - x0, y1 - y0);
        ctx.clip();
    };
    for (const name of LAYERS) {
        if (!layers.includes(name)) continue;
        // The town before a hold's gate (V5b), drawn as any surface town is, on the land open to the
        // sky before the mountain, over the level beneath; then the mountain's face over it
        if (name === "labels" && outside && D.cave?.outside) {
            const t0 = now();
            ctx.save();
            inMetres();
            ctx.beginPath();
            poly(ctx, D.cave.outside.poly);
            ctx.clip();
            drawTown(ctx, outside, view, outsideStyle, { cultures, theme, layers: layers.filter((n) => n !== "labels") });
            ctx.restore();
            ctx.save();
            inMetres();
            mountainFace(D);
            ctx.restore();
            times.outside = Math.round(now() - t0);
        }
        const t0 = now();
        ctx.save();
        if (name !== "labels") inMetres();
        DRAW[name](D);
        ctx.restore();
        times[name] = Math.round(now() - t0);
    }
    return times;
}

// ---------------------------------------------------------------- the drawing's shared state
function makeDrawing(ctx, town, view, style, cultures, theme = null) {
    const m = view.mPerPx;
    const [x0, y0, x1, y1] = view.rect;
    const pad = 40;
    const box = [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
    const visible = (pts) => {
        let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
        for (const p of pts) {
            if (p[0] < a) a = p[0];
            if (p[1] < b) b = p[1];
            if (p[0] > c) c = p[0];
            if (p[1] > d) d = p[1];
        }
        return c >= box[0] && a <= box[2] && d >= box[1] && b <= box[3];
    };
    const near = (p, r = 0) => p[0] + r >= box[0] && p[0] - r <= box[2] && p[1] + r >= box[1] && p[1] - r <= box[3];
    // Towards the light, in the drawing's axes (y grows southwards)
    const a = (style.lightBearing * Math.PI) / 180;
    const toLight = [Math.sin(a), -Math.cos(a)];
    // The ruling culture (the largest share) sets the walls' material; their colour only in the
    // culture view
    const mixList = [...(town.input.cultures ?? [])].sort((p, q) => q.share - p.share);
    const rulingStyle = cultures[mixList[0]?.name] ?? {};
    const ruling = { ...CULTURE_DEFAULT, wallMaterial: rulingStyle.wallMaterial ?? CULTURE_DEFAULT.wallMaterial, ...(theme === "culture" ? { wall: rulingStyle.wall ?? null } : {}) };
    // Underground (V5b): a carved level's cave, and its open floor (chambers, halls, galleries,
    // side caverns, tunnels and the ways between); or an open cavern floor
    const cave = town.shore?.cave ?? null;
    const floors = cave
        ? [...cave.chambers.map((c) => c.outline), ...(cave.halls ?? []).map((h) => h.outline ?? h.poly), ...cave.galleries.map((g) => g.poly), ...(cave.passages ?? []).map((q) => q.poly ?? q.outline), ...cave.sides.map((q) => q.outline), ...cave.tunnels.map((t) => t.poly), ...cave.sides.map((q) => q.branchPoly)].filter((f) => f?.length > 2)
        : null;
    return {
        ctx, town, style, m, box, visible, near, toLight, cultures, theme, ruling, cave, floors, onFloor: !!town.input.floor,
        // A line width in metres, never thinner than `minPx` pixels
        w: (metres, minPx = 0.6) => Math.max(metres, minPx * m),
    };
}

// ---------------------------------------------------------------- path helpers
function poly(ctx, pts, close = true) {
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0], pts[k][1]);
    if (close) ctx.closePath();
}
function line(ctx, pts) {
    poly(ctx, pts, false);
}
function circle(ctx, x, y, r) {
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, Math.PI * 2);
}
/** A repeatable number in [0, 1) from a position. */
function hash(x, y, s = 0) {
    const v = Math.sin(x * 12.9898 + y * 78.233 + s * 37.719) * 43758.5453;
    return v - Math.floor(v);
}
function centroid(pts) {
    let x = 0, y = 0;
    for (const p of pts) {
        x += p[0];
        y += p[1];
    }
    return [x / pts.length, y / pts.length];
}
function inside(p, pts) {
    let r = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j];
        if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) r = !r;
    }
    return r;
}
/** The convex hull of points (monotone chain). */
function hull(points) {
    const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [], upper = [];
    for (const q of p) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
        lower.push(q);
    }
    for (let i = p.length - 1; i >= 0; i--) {
        const q = p[i];
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
        upper.push(q);
    }
    return lower.slice(0, -1).concat(upper.slice(0, -1));
}
/** A shape's shadow on the ground: the shape swept away from the light by its height. */
function shadowOf(D, pts, height) {
    const L = height * D.style.shadowLength;
    const dx = -D.toLight[0] * L, dy = -D.toLight[1] * L;
    return hull([...pts, ...pts.map((p) => [p[0] + dx, p[1] + dy])]);
}

// ---------------------------------------------------------------- layers
const DRAW = {
    ground(D) {
        const { ctx, style, town, box } = D;
        if (D.cave) return caveGround(D);
        ctx.fillStyle = style.ground;
        ctx.fillRect(box[0], box[1], box[2] - box[0], box[3] - box[1]);
        // Slight variation: soft patches by position, the same in every view
        ctx.fillStyle = rgba(style.groundVar, style.groundVarAlpha);
        const step = 140;
        ctx.beginPath();
        for (let y = Math.floor(box[1] / step) * step; y < box[3]; y += step) {
            for (let x = Math.floor(box[0] / step) * step; x < box[2]; x += step) {
                if (hash(x, y) < 0.45) continue;
                const r = 50 + 90 * hash(y, x, 1);
                circle(ctx, x + step * hash(x, y, 2), y + step * hash(x, y, 3), r);
            }
        }
        ctx.fill();
        // The built-up ground inside the walls: earth between the buildings
        if (town.wall) {
            ctx.fillStyle = style.town;
            ctx.beginPath();
            poly(ctx, (town.outerWall ?? town.wall).polygon);
            ctx.fill();
        }
    },

    fields(D) {
        const { ctx, style, town, visible, w } = D;
        for (const f of town.fields) {
            const shape = f.inner ?? f.poly;
            if (!visible(f.poly)) continue;
            if (f.use === "fungus") {
                // Fungus beds underground: the bed and its rows
                ctx.fillStyle = style.fungus;
                ctx.strokeStyle = style.fungusBed;
                ctx.lineWidth = w(1, 0.4);
                ctx.beginPath();
                poly(ctx, f.poly);
                ctx.fill();
                ctx.stroke();
                if (f.strips?.length) {
                    ctx.lineWidth = w(1.6, 0.4);
                    ctx.beginPath();
                    for (const q of f.strips) line(ctx, q);
                    ctx.stroke();
                }
                continue;
            }
            if (f.use === "pond") {
                ctx.fillStyle = style.water;
                ctx.strokeStyle = style.waterEdge;
                ctx.lineWidth = w(1.4, 0.5);
                ctx.beginPath();
                poly(ctx, f.poly);
                ctx.fill();
                ctx.stroke();
                continue;
            }
            if (f.use === "arable") {
                ctx.fillStyle = style.arable[f.great ?? 0];
                ctx.strokeStyle = style.strip;
                ctx.lineWidth = w(1.2, 0.4);
                ctx.beginPath();
                poly(ctx, shape);
                ctx.fill();
                ctx.stroke();
                if (f.strips?.length) {
                    const fallow = f.great === 2;
                    ctx.strokeStyle = fallow ? style.stripFallow : style.strip;
                    ctx.lineWidth = w(fallow ? 0.9 : 1.3, 0.3);
                    ctx.beginPath();
                    for (const s of f.strips) line(ctx, s);
                    ctx.stroke();
                }
            } else if (f.use === "meadow") {
                // Open meadow by the water, within a margin
                ctx.fillStyle = style.meadow;
                ctx.beginPath();
                poly(ctx, shrinkBy(f.poly, 2));
                ctx.fill();
                ctx.strokeStyle = style.meadowTuft;
                ctx.lineWidth = w(0.8, 0.3);
                ctx.beginPath();
                marks(D, f.poly, 30, (x, y) => {
                    ctx.moveTo(x - 4, y);
                    ctx.lineTo(x - 1.5, y - 4);
                    ctx.moveTo(x, y);
                    ctx.lineTo(x, y - 5);
                    ctx.moveTo(x + 4, y);
                    ctx.lineTo(x + 1.5, y - 4);
                });
                ctx.stroke();
            } else if (f.use === "pasture" || f.use === "close") {
                // Enclosed: a hedge round it (its trees are drawn with the trees)
                ctx.fillStyle = f.use === "close" ? style.close : style.pasture;
                ctx.beginPath();
                poly(ctx, f.poly);
                ctx.fill();
                ctx.strokeStyle = style.hedgerow;
                ctx.lineWidth = w(2.2, 0.6);
                ctx.lineJoin = "round";
                ctx.beginPath();
                poly(ctx, shrinkBy(f.poly, 1.2));
                ctx.stroke();
            } else if (f.use === "common" || f.use === "rough" || f.use === "moor" || f.use === "dry") {
                // (rough: an awkward corner between ways, grazed but not enclosed: drawn as common)
                ctx.fillStyle = style[f.use === "rough" ? "common" : f.use];
                ctx.beginPath();
                poly(ctx, f.poly);
                ctx.fill();
                ctx.strokeStyle = f.use === "common" || f.use === "rough" ? style.commonMark : f.use === "moor" ? style.heather : style.sand;
                ctx.lineWidth = w(f.use === "dry" ? 2.2 : 1.1, 0.4);
                ctx.lineCap = "round";
                ctx.beginPath();
                marks(D, f.poly, f.use === "dry" ? 22 : 34, (x, y) => {
                    if (f.use === "common" || f.use === "rough") {
                        ctx.moveTo(x - 4, y);
                        ctx.lineTo(x - 1.5, y - 4);
                        ctx.lineTo(x + 1, y);
                    } else if (f.use === "moor") {
                        ctx.moveTo(x - 5, y);
                        for (let k = 1; k <= 4; k++) ctx.lineTo(x - 5 + k * 2.5, y + (k % 2 ? -2.5 : 0));
                    } else {
                        ctx.moveTo(x, y);
                        ctx.lineTo(x + 0.1, y);
                    }
                });
                ctx.stroke();
            } else if (f.use === "garden") {
                ctx.fillStyle = style.garden;
                ctx.strokeStyle = style.hedge;
                ctx.lineWidth = w(1.2, 0.4);
                ctx.beginPath();
                poly(ctx, shape);
                ctx.fill();
                ctx.stroke();
                // Beds in rows across the garden, each on its own line
                ctx.save();
                ctx.beginPath();
                poly(ctx, shape);
                ctx.clip();
                const c = centroid(f.poly);
                const ang = hash(c[0], c[1]) * Math.PI;
                const t = [Math.cos(ang), Math.sin(ang)], n = [-t[1], t[0]];
                const reach = Math.max(...f.poly.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1])));
                ctx.strokeStyle = style.bed;
                ctx.lineWidth = w(2.2, 0.5);
                ctx.setLineDash([w(6, 1.5), w(3, 1)]);
                ctx.beginPath();
                for (let o = -reach; o <= reach; o += 9) {
                    ctx.moveTo(c[0] + n[0] * o - t[0] * reach, c[1] + n[1] * o - t[1] * reach);
                    ctx.lineTo(c[0] + n[0] * o + t[0] * reach, c[1] + n[1] * o + t[1] * reach);
                }
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.restore();
            } else if (f.use === "wood") {
                ctx.fillStyle = style.wood;
                ctx.beginPath();
                poly(ctx, f.poly);
                ctx.fill();
            }
        }
        // Contours, faint (underground, on the floor only)
        if (D.cave) {
            ctx.save();
            floorClip(D);
        }
        if (town.contours?.length) {
            ctx.strokeStyle = rgba(style.contour, style.contourAlpha);
            ctx.lineWidth = w(0.7, 0.35);
            ctx.beginPath();
            for (const s of town.contours) {
                if (!D.near(s[0], 5)) continue;
                ctx.moveTo(s[0][0], s[0][1]);
                ctx.lineTo(s[1][0], s[1][1]);
            }
            ctx.stroke();
        }
        if (D.cave) ctx.restore();
    },

    trees(D) {
        const all = [];
        for (const f of D.town.fields) if (f.trees && D.visible(f.poly)) for (const t of f.trees) all.push(t);
        drawTrees(D, all);
    },

    built(D) {
        // The built-up ground masks the fields beneath it: round every way, house and yard, so the
        // ground between buildings reads as the town's, not as the field it was
        const { ctx, style, town, visible } = D;
        ctx.strokeStyle = style.town;
        ctx.fillStyle = style.town;
        // The built-up ground closed over its gaps (engine/town/built-up.mjs; Ken, 2026-11-17), its
        // holes left open (even-odd), so no field shows between a village's tofts
        const rings = (town.builtUp ?? []).filter((r) => visible(r));
        if (rings.length) {
            // (a village's in the pasture's green, so it still reads as open ground: Ken, 2026-11-17)
            ctx.fillStyle = town.kind === "village" ? style.villageGround ?? style.pasture : style.town;
            ctx.beginPath();
            for (const r of rings) poly(ctx, r);
            ctx.fill("evenodd");
            ctx.fillStyle = style.town;
        }
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        const built = town.streets.filter((s) => !s.market && (s.suburb || s.rank <= 1 || s.lane) && visible(s.points));
        for (const s of built) {
            // An approach road far out among the fields is no built ground
            if (s.road && !town.wall && !s.suburb) continue;
            ctx.lineWidth = s.half * 2 + 16;
            ctx.beginPath();
            line(ctx, s.points);
            ctx.stroke();
        }
        // (V6: in pieces by place, as one path of a great city's every house and yard, stroked wide,
        // took a minute to fill)
        const under = [];
        for (const y of town.yards ?? []) if (visible(y.poly)) under.push(y.poly);
        for (const b of town.buildings) if (b.kind !== "farmhouse" && b.kind !== "barn" && !b.estate && visible(b.poly)) under.push(b.poly);
        ctx.lineWidth = 8;
        inPieces(D, under, (pts) => poly(ctx, pts), () => {
            ctx.fill();
            ctx.stroke();
        });
        // Each house's ground behind it: a garden for the better off, a yard for the poorer and
        // for trades (Ken, 2026-11-16), under the ways, so a way is never drawn over by a yard
        yardsAndGardens(D);
    },

    water(D) {
        const { ctx, style, town, w } = D;
        const rv = town.river;
        if (D.cave && rv?.line?.length && !rv.brook) {
            // A river through the rock runs in flooded tunnels, cut a little wider than the water
            ctx.lineJoin = "round";
            ctx.lineCap = "round";
            ctx.strokeStyle = style.rockEdge;
            ctx.lineWidth = rv.width + 9;
            ctx.beginPath();
            line(ctx, rv.line);
            ctx.stroke();
        }
        if (D.cave && rv?.line?.length && rv.brook) {
            ctx.save();
            floorClip(D);
        }
        if (rv?.line?.length) {
            ctx.lineJoin = "round";
            ctx.lineCap = "round";
            ctx.strokeStyle = style.waterEdge;
            ctx.lineWidth = rv.width + 3;
            ctx.beginPath();
            line(ctx, rv.line);
            ctx.stroke();
            ctx.strokeStyle = style.water;
            ctx.lineWidth = rv.width;
            ctx.stroke();
        }
        if (D.cave && rv?.line?.length && rv.brook) ctx.restore();
        const sh = town.shore;
        if (D.cave) {
            // The lake and the side caverns' pools lie wholly on the floor
            ctx.fillStyle = style.water;
            ctx.strokeStyle = style.waterEdge;
            ctx.lineWidth = w(2, 0.6);
            for (const wt of D.cave.waters) {
                if (!D.visible(wt.outline)) continue;
                ctx.beginPath();
                poly(ctx, wt.outline);
                ctx.fill();
                ctx.stroke();
            }
            return;
        }
        if (!sh) return;
        const W = town.frame.width, H = town.frame.height;
        const big = 4 * Math.max(W, H);
        if (sh.rock) {
            // A cavern's walls round an open floor: a lake between the floor and the walls (dark,
            // still water and its shallows), then the rock beyond, hatched
            const outer = [[-big, -big], [big, -big], [big, big], [-big, big]];
            const ring = sh.wallOutline ?? sh.island.outline;
            if (sh.water) {
                ctx.beginPath();
                poly(ctx, outer);
                poly(ctx, sh.island.outline);
                ctx.fillStyle = style.sea;
                ctx.fill("evenodd");
                ctx.save();
                ctx.clip("evenodd");
                ctx.strokeStyle = rgba(style.shallows, 0.6);
                ctx.lineWidth = 36;
                ctx.lineJoin = "round";
                ctx.beginPath();
                poly(ctx, sh.island.outline);
                ctx.stroke();
                ctx.restore();
                ctx.strokeStyle = style.waterEdge;
                ctx.lineWidth = w(1.6);
                ctx.beginPath();
                poly(ctx, sh.island.outline);
                ctx.stroke();
            }
            ctx.save();
            ctx.beginPath();
            poly(ctx, outer);
            poly(ctx, ring);
            ctx.fillStyle = style.rock;
            ctx.fill("evenodd");
            ctx.clip("evenodd");
            hatch(D);
            ctx.restore();
            // The wall's foot, and short hachures out into the rock, as a hold's mountain face is drawn
            ctx.strokeStyle = style.rockEdge;
            ctx.lineWidth = w(1.6);
            ctx.beginPath();
            for (let k = 0; k < ring.length; k += 2) {
                const p = ring[k];
                if (!D.near(p, 30)) continue;
                const r = Math.hypot(p[0], p[1]) || 1;
                const len = 10 + 14 * hash(p[0], p[1]);
                ctx.moveTo(p[0], p[1]);
                ctx.lineTo(p[0] * (1 + len / r), p[1] * (1 + len / r));
            }
            ctx.stroke();
            ctx.lineWidth = w(3);
            ctx.lineJoin = "round";
            ctx.beginPath();
            poly(ctx, ring);
            ctx.stroke();
            return;
        }
        ctx.beginPath();
        let shoreLines;
        if (sh.island) {
            poly(ctx, [[-big, -big], [big, -big], [big, big], [-big, big]]);
            poly(ctx, sh.island.outline);
            shoreLines = [[...sh.island.outline, sh.island.outline[0]]];
        } else {
            for (const ln of sh.lines) {
                const first = ln.points[0], last = ln.points[ln.points.length - 1];
                poly(ctx, [...ln.points, [last[0] + ln.u[0] * big, last[1] + ln.u[1] * big], [first[0] + ln.u[0] * big, first[1] + ln.u[1] * big]]);
            }
            shoreLines = sh.lines.flatMap((ln) => ln.coast);
        }
        const rule = sh.island ? "evenodd" : "nonzero";
        if (sh.mountain) {
            ctx.fillStyle = style.mountain;
            ctx.fill(rule);
            const ln = sh.lines[0];
            ctx.strokeStyle = style.mountainEdge;
            ctx.lineWidth = w(1.6);
            ctx.beginPath();
            for (let k = 0; k < ln.points.length; k += 2) {
                const p = ln.points[k];
                const len = 10 + 14 * hash(p[0], p[1]);
                ctx.moveTo(p[0], p[1]);
                ctx.lineTo(p[0] + ln.u[0] * len, p[1] + ln.u[1] * len);
            }
            ctx.stroke();
            ctx.lineWidth = w(3);
            ctx.beginPath();
            line(ctx, ln.points);
            ctx.stroke();
            return;
        }
        ctx.fillStyle = style.sea;
        ctx.fill(rule);
        ctx.save();
        ctx.clip(rule);
        ctx.lineJoin = "round";
        ctx.strokeStyle = rgba(style.shallows, 0.55);
        ctx.lineWidth = 90;
        ctx.beginPath();
        for (const l of shoreLines) line(ctx, l);
        ctx.stroke();
        ctx.strokeStyle = style.shallows;
        ctx.lineWidth = 36;
        ctx.stroke();
        ctx.restore();
        ctx.strokeStyle = style.waterEdge;
        ctx.lineWidth = w(1.6);
        ctx.beginPath();
        for (const l of shoreLines) line(ctx, l);
        ctx.stroke();
    },

    ways(D) {
        const { ctx, style, town, visible, w } = D;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        // Field tracks
        if (town.tracks?.length) {
            const tracks = town.tracks.filter(visible);
            ctx.strokeStyle = rgba(style.casing, 0.5);
            ctx.lineWidth = w(4.2, 0.8);
            ctx.beginPath();
            for (const t of tracks) line(ctx, t);
            ctx.stroke();
            ctx.strokeStyle = style.track;
            ctx.lineWidth = w(2.8, 0.5);
            ctx.stroke();
        }
        // The hierarchy by class (Ken, 2026-11-16): approach roads, earthen with a strong casing and
        // ruts; lesser roads; main streets paved, with kerbs; secondary streets; lanes and closes;
        // drives and paths. Within the walls a road is paved as a main street.
        const ways = town.streets.filter((s) => !s.market && visible(s.points));
        const classOf = (s) => (s.road ? (s.rank === 0 ? "approach" : "lesser") : s.plan === "main" || s.rank === 0 ? "main" : s.rank === 1 ? "secondary" : s.drive || s.path ? "path" : "lane");
        const CLASS = {
            approach: { casing: style.roadCasing, edge: w(3.2, 1), fill: style.roadEarth },
            lesser: { casing: style.roadCasing, edge: w(2.4, 0.9), fill: style.roadEarth },
            main: { casing: style.casing, edge: w(2.6, 0.9), fill: style.mainStreet },
            secondary: { casing: style.casing, edge: w(2, 0.8), fill: style.street },
            lane: { casing: style.casing, edge: w(1.4, 0.6), fill: style.lane },
            path: { casing: style.casing, edge: w(1, 0.5), fill: style.track },
        };
        const order = ["path", "lane", "secondary", "lesser", "main", "approach"];
        for (const cls of order) {
            ctx.strokeStyle = CLASS[cls].casing;
            for (const s of ways) {
                if (classOf(s) !== cls) continue;
                ctx.lineWidth = s.half * 2 + CLASS[cls].edge;
                ctx.beginPath();
                line(ctx, s.points);
                ctx.stroke();
            }
        }
        // Within the walls, the roads and main streets kerbed: the kerb drawn under every fill, so
        // a way joining one runs through its kerb (Ken, 2026-11-16)
        const walled = (town.outerWall ?? town.wall)?.polygon;
        const paved = ways.filter((s) => s.road || classOf(s) === "main");
        const withinWalls = (draw) => {
            ctx.save();
            if (walled) {
                ctx.beginPath();
                poly(ctx, walled);
                ctx.clip();
            }
            draw();
            ctx.restore();
        };
        withinWalls(() => {
            ctx.strokeStyle = style.kerb;
            for (const s of paved) {
                if (!walled && s.road) continue;
                ctx.lineWidth = s.half * 2;
                ctx.beginPath();
                line(ctx, s.points);
                ctx.stroke();
            }
        });
        const pavedHere = new Set(paved.filter((s) => walled || !s.road));
        const outsideWalls = (draw) => {
            ctx.save();
            if (walled) {
                const big = 4 * Math.max(town.frame.width, town.frame.height);
                ctx.beginPath();
                poly(ctx, [[-big, -big], [big, -big], [big, big], [-big, big]]);
                poly(ctx, walled);
                ctx.clip("evenodd");
                draw();
            }
            ctx.restore();
        };
        for (const cls of order) {
            ctx.strokeStyle = CLASS[cls].fill;
            for (const s of ways) {
                if (classOf(s) !== cls || pavedHere.has(s)) continue;
                ctx.lineWidth = s.half * 2;
                ctx.beginPath();
                line(ctx, s.points);
                ctx.stroke();
            }
            // A paved way's own fill only beyond the walls (within them it is paved below)
            outsideWalls(() => {
                ctx.strokeStyle = CLASS[cls].fill;
                for (const s of ways) {
                    if (classOf(s) !== cls || !pavedHere.has(s)) continue;
                    ctx.lineWidth = s.half * 2;
                    ctx.beginPath();
                    line(ctx, s.points);
                    ctx.stroke();
                }
            });
        }
        // Ruts down the approach and lesser roads outside the walls
        ctx.strokeStyle = rgba(style.rut, 0.9);
        ctx.lineWidth = w(0.6, 0.35);
        ctx.setLineDash([w(5, 1.5), w(3, 1)]);
        ctx.beginPath();
        for (const s of ways) if (s.road) line(ctx, s.points);
        ctx.stroke();
        ctx.setLineDash([]);
        // ... and their paving within the kerbs, over the ends of the ways that join them
        withinWalls(() => {
            ctx.strokeStyle = style.mainStreet;
            for (const s of paved) {
                if (!walled && s.road) continue;
                ctx.lineWidth = s.half * 2 - w(1.4, 0.6);
                ctx.beginPath();
                line(ctx, s.points);
                ctx.stroke();
            }
        });
        // The market and the focal squares, paved, their edge a kerb
        const squares = [town.market?.polygon, ...(town.plan?.squares ?? [])].filter(Boolean);
        for (const sq of squares) {
            if (!visible(sq)) continue;
            ctx.fillStyle = style.market;
            ctx.strokeStyle = style.casing;
            ctx.lineWidth = w(1, 0.5);
            ctx.beginPath();
            poly(ctx, sq);
            ctx.fill();
            ctx.stroke();
            paving(D, sq);
        }
        // A green with its pond
        if (town.market?.kind === "green") {
            ctx.fillStyle = style.park;
            ctx.beginPath();
            poly(ctx, town.market.polygon);
            ctx.fill();
            if (town.market.pond) {
                ctx.fillStyle = style.water;
                ctx.beginPath();
                circle(ctx, town.market.pond[0], town.market.pond[1], town.market.pond[2]);
                ctx.fill();
            }
        }
        // On an open floor: a way meeting the cavern's wall runs on into the rock, a short dark
        // passage between portal stones; one meeting the lake ends at a landing, a jetty out into it
        for (const road of (town.roads ?? []).filter((r) => r.tunnel || r.landing)) {
            const p = road.points[0];
            if (!D.near(p, TUNNEL_SHOWN)) continue;
            const r = Math.hypot(p[0], p[1]) || 1;
            const u = [p[0] / r, p[1] / r], n = [-u[1], u[0]];
            if (road.tunnel) {
                const into = [p[0] + u[0] * TUNNEL_SHOWN, p[1] + u[1] * TUNNEL_SHOWN];
                ctx.lineCap = "round";
                ctx.strokeStyle = style.rockEdge;
                ctx.lineWidth = road.width + 10;
                ctx.beginPath();
                line(ctx, [p, into]);
                ctx.stroke();
                ctx.strokeStyle = rgba(style.road, 0.55);
                ctx.lineWidth = road.width;
                ctx.setLineDash([10, 6]);
                ctx.beginPath();
                line(ctx, [p, into]);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.fillStyle = style.stone;
                ctx.strokeStyle = style.stoneEdge;
                ctx.lineWidth = w(1, 0.4);
                ctx.beginPath();
                for (const sg of [1, -1]) circle(ctx, p[0] + n[0] * sg * (road.width / 2 + 5), p[1] + n[1] * sg * (road.width / 2 + 5), 4);
                ctx.fill();
                ctx.stroke();
            } else {
                const out = [p[0] + u[0] * LANDING_SHOWN, p[1] + u[1] * LANDING_SHOWN];
                ctx.lineCap = "butt";
                ctx.strokeStyle = style.timberEdge;
                ctx.lineWidth = 9;
                ctx.beginPath();
                line(ctx, [p, out]);
                ctx.stroke();
                ctx.strokeStyle = style.timber;
                ctx.lineWidth = 6.5;
                ctx.stroke();
            }
        }
        // The bridge, where a way uses it
        const rv = town.river;
        if (town.bridge && rv && !rv.brook) {
            const mid = centroid(town.bridge);
            const used = town.streets.some((s) => s.points.some((q) => Math.hypot(q[0] - mid[0], q[1] - mid[1]) < rv.width / 2 + 25));
            if (used) {
                ctx.lineCap = "butt";
                ctx.strokeStyle = style.stoneEdge;
                ctx.lineWidth = 10;
                ctx.beginPath();
                line(ctx, town.bridge);
                ctx.stroke();
                ctx.strokeStyle = style.road;
                ctx.lineWidth = 7;
                ctx.stroke();
            }
        }
    },

    grounds(D) {
        const { ctx, style, town, visible, w } = D;
        // Places of worship's yards
        for (const ch of town.worship) {
            if (!visible(ch.yard)) continue;
            ctx.fillStyle = style.yard;
            ctx.strokeStyle = style.hedge;
            ctx.lineWidth = w(1.2, 0.4);
            ctx.beginPath();
            poly(ctx, ch.yard);
            ctx.fill();
            ctx.stroke();
            // A churchyard's graves
            if (ch.graves?.length) {
                ctx.fillStyle = rgba(style.grave, 0.75);
                ctx.beginPath();
                for (const g of ch.graves) poly(ctx, g);
                ctx.fill();
            }
        }
        // Cemeteries: walled, rows of graves, a path to the chapel
        for (const cem of town.cemeteries ?? []) {
            if (!visible(cem.poly)) continue;
            ctx.fillStyle = style.cemetery;
            ctx.strokeStyle = style.stoneEdge;
            ctx.lineWidth = w(1.8, 0.6);
            ctx.beginPath();
            poly(ctx, cem.poly);
            ctx.fill();
            ctx.stroke();
            if (cem.graves?.length) {
                ctx.fillStyle = rgba(style.grave, 0.75);
                ctx.beginPath();
                for (const g of cem.graves) poly(ctx, g);
                ctx.fill();
            }
            ctx.strokeStyle = style.lane;
            ctx.lineWidth = 2.4;
            ctx.beginPath();
            line(ctx, cem.path);
            ctx.stroke();
        }
        // Parks: a green, its paths
        for (const park of town.parks ?? []) {
            if (!visible(park.poly)) continue;
            ctx.fillStyle = style.park;
            ctx.strokeStyle = style.hedge;
            ctx.lineWidth = w(1.2, 0.4);
            ctx.beginPath();
            poly(ctx, park.poly);
            ctx.fill();
            ctx.stroke();
            ctx.strokeStyle = style.lane;
            ctx.lineWidth = 2.2;
            ctx.lineCap = "round";
            ctx.beginPath();
            for (const l of park.paths) line(ctx, l);
            ctx.stroke();
        }
        // Estates: grounds within a wall, a parterre behind the house, paths
        for (const e of town.estates ?? []) {
            if (!visible(e.poly)) continue;
            ctx.fillStyle = style.estate;
            ctx.strokeStyle = style.stoneEdge;
            ctx.lineWidth = w(1.6, 0.6);
            ctx.beginPath();
            poly(ctx, e.poly);
            ctx.fill();
            ctx.stroke();
            if (e.garden) {
                ctx.fillStyle = e.worked ? style.yard : style.parterre;
                ctx.strokeStyle = style.hedge;
                ctx.lineWidth = w(1, 0.4);
                ctx.beginPath();
                poly(ctx, e.garden);
                ctx.fill();
                ctx.stroke();
                if (!e.worked) parterre(D, e.garden);
            }
            ctx.strokeStyle = style.lane;
            ctx.lineWidth = 2.4;
            ctx.lineCap = "round";
            ctx.beginPath();
            for (const l of e.paths) line(ctx, l);
            ctx.stroke();
        }
        // The waterfront: quays, moles, jetties
        if (town.quays?.length) {
            ctx.strokeStyle = style.quay;
            ctx.lineWidth = 12;
            ctx.lineCap = "butt";
            ctx.beginPath();
            for (const q of town.quays) line(ctx, q.points);
            ctx.stroke();
        }
        for (const mole of town.moles ?? []) {
            ctx.lineCap = "round";
            ctx.strokeStyle = style.stoneEdge;
            ctx.lineWidth = mole.width + 2.5;
            ctx.beginPath();
            line(ctx, mole.points);
            ctx.stroke();
            ctx.strokeStyle = style.quay;
            ctx.lineWidth = mole.width;
            ctx.stroke();
        }
        if (town.jetties?.length) {
            ctx.lineCap = "butt";
            ctx.strokeStyle = style.timberEdge;
            ctx.lineWidth = 6.4;
            ctx.beginPath();
            for (const j of town.jetties) line(ctx, j.points);
            ctx.stroke();
            ctx.strokeStyle = style.timber;
            ctx.lineWidth = 4.6;
            ctx.stroke();
        }
        // The grounds' trees
        drawTrees(D, [...(town.parks ?? []).flatMap((p) => p.trees), ...(town.estates ?? []).flatMap((e) => e.trees), ...(town.cemeteries ?? []).flatMap((c) => c.trees ?? [])]);
    },

    shadows(D) {
        const { ctx, style, town, visible } = D;
        ctx.fillStyle = rgba(style.shadow, style.shadowAlpha);
        const shadows = [];
        for (const b of town.buildings) {
            // (a house cut into the rock or hollowed in a pillar casts none)
            if (b.hollow || b.rockCut || !visible(b.poly)) continue;
            shadows.push(shadowOf(D, b.poly, heightOf(b)));
        }
        for (const ch of town.worship) for (const part of ch.body) if (visible(part)) shadows.push(shadowOf(D, part, HEIGHTS.worship));
        if (town.castle) {
            if (town.castle.keep) shadows.push(shadowOf(D, town.castle.keep, HEIGHTS.keep));
            if (town.castle.palace) shadows.push(shadowOf(D, town.castle.palace, HEIGHTS.palace));
        }
        // (V6: tile by tile, each tile clipped, so a shadow two tiles share is darkened once)
        inTiles(D, shadows, (pts) => poly(ctx, pts), () => ctx.fill());
        // Walls cast theirs as a band
        const stone = D.ruling.wallMaterial !== "palisade";
        for (const ring of [town.wall, town.outerWall].filter(Boolean)) {
            const L = (stone ? HEIGHTS.wall : HEIGHTS.palisade) * style.shadowLength;
            ctx.strokeStyle = rgba(style.shadow, style.shadowAlpha);
            ctx.lineWidth = stone ? 5 : 2.5;
            ctx.lineCap = "round";
            ctx.beginPath();
            const v = ring.verts;
            for (let k = 0; k < v.length; k++) {
                const a = v[k], b = v[(k + 1) % v.length];
                if (a.onBank && b.onBank) continue;
                ctx.moveTo(a.p[0] - D.toLight[0] * L * 0.5, a.p[1] - D.toLight[1] * L * 0.5);
                ctx.lineTo(b.p[0] - D.toLight[0] * L * 0.5, b.p[1] - D.toLight[1] * L * 0.5);
            }
            ctx.stroke();
        }
    },

    buildings(D) {
        const { town, visible } = D;
        // Ranges take their house's culture
        const cut = [];
        for (const b of town.buildings) {
            if (b.hollow || !visible(b.poly)) continue;
            if (b.rockCut) {
                cut.push(b);
                continue;
            }
            roof(D, b.poly, roofColour(D, b), b.estate || b.kind === "warehouse" || b.kind === "barn" ? 1.15 : 1.35);
        }
        // Houses cut into the rock: their faces on the floor, their rooms in the rock behind
        if (cut.length) {
            const { ctx, style, w } = D;
            ctx.fillStyle = style.rockCut;
            ctx.strokeStyle = style.roofEdge;
            ctx.lineWidth = w(0.8, 0.4);
            ctx.lineJoin = "round";
            ctx.beginPath();
            for (const b of cut) poly(ctx, b.poly);
            ctx.fill();
            ctx.stroke();
            // the face: a lit line along the front
            ctx.strokeStyle = shade(style.rockCut, 0.25);
            ctx.lineWidth = w(1.2, 0.5);
            ctx.beginPath();
            for (const b of cut) line(ctx, [b.poly[0], b.poly[1]]);
            ctx.stroke();
        }
    },

    walls(D) {
        const { town } = D;
        for (const [k, ring] of [town.wall, town.outerWall].entries()) if (ring) wall(D, ring, k === 1);
    },

    landmarks(D) {
        const { ctx, style, town, visible, w } = D;
        if (D.cave) caveLandmarks(D);
        // Places of worship: the hall and its rooms, roofed
        for (const ch of town.worship) {
            if (!ch.body.some(visible)) continue;
            for (const part of ch.body) roof(D, part, style.worshipRoof, 1.6, style.worshipEdge);
        }
        // The market's stalls in rows, a cross in the middle
        if (town.market?.polygon && town.market.kind !== "green" && visible(town.market.polygon)) stalls(D, town.market.polygon, 1);
        for (const sq of town.plan?.squares ?? []) if (visible(sq)) stalls(D, sq, 0.4);
        // The castle: its ward, curtain, towers, keep and palace, and its gate
        const c = town.castle;
        if (c && visible(c.polygon)) {
            ctx.fillStyle = style.yard;
            ctx.beginPath();
            poly(ctx, c.polygon);
            ctx.fill();
            ctx.lineJoin = "round";
            ctx.strokeStyle = style.stoneEdge;
            ctx.lineWidth = 8;
            ctx.stroke();
            // A castle is of stone, whatever the town's own walls are
            ctx.strokeStyle = D.ruling.wallMaterial === "palisade" ? style.stone : wallColour(D);
            ctx.lineWidth = 5.4;
            ctx.stroke();
            if (c.palace) roof(D, c.palace, style.palaceRoof, 1.2);
            if (c.keep) roof(D, c.keep, style.keepRoof, 2, style.stoneEdge);
            const r = c.kind === "citadel" ? 11 : 9;
            for (const q of c.towers ?? c.polygon) tower(D, q, r);
            if (c.gate) gatehouse(D, c.gate, 9);
        }
        // Ships, and a harbour's light
        for (const ship of town.ships ?? []) {
            if (!D.near(ship.p, 30)) continue;
            const t = [Math.cos(ship.angle), Math.sin(ship.angle)], n = [-t[1], t[0]];
            const L = ship.length / 2, B = ship.width / 2;
            const at = (a, b) => [ship.p[0] + t[0] * a + n[0] * b, ship.p[1] + t[1] * a + n[1] * b];
            ctx.fillStyle = rgba(style.shadow, style.shadowAlpha * 0.8);
            ctx.beginPath();
            poly(ctx, [at(L, 0), at(L * 0.55, B), at(-L * 0.8, B), at(-L, B * 0.6), at(-L, -B * 0.6), at(-L * 0.8, -B), at(L * 0.55, -B)].map((p) => [p[0] - D.toLight[0] * 1.5, p[1] - D.toLight[1] * 1.5]));
            ctx.fill();
            ctx.fillStyle = style.timber;
            ctx.strokeStyle = style.timberEdge;
            ctx.lineWidth = w(0.8, 0.4);
            ctx.beginPath();
            poly(ctx, [at(L, 0), at(L * 0.55, B), at(-L * 0.8, B * 0.95), at(-L, B * 0.6), at(-L, -B * 0.6), at(-L * 0.8, -B * 0.95), at(L * 0.55, -B)]);
            ctx.fill();
            ctx.stroke();
            // A furled sail on a yard
            ctx.strokeStyle = style.paper;
            ctx.lineWidth = Math.max(0.8, B * 0.35);
            ctx.beginPath();
            line(ctx, [at(L * 0.1, -B * 1.2), at(L * 0.1, B * 1.2)]);
            ctx.stroke();
        }
        if (town.light) {
            ctx.fillStyle = style.stone;
            ctx.strokeStyle = style.stoneEdge;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            circle(ctx, town.light[0], town.light[1], 7);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = "#e8c35a";
            ctx.beginPath();
            circle(ctx, town.light[0], town.light[1], 3);
            ctx.fill();
        }
    },

    labels(D) {
        // The title, scale bar and north arrow, drawn in pixels over the view
        const { ctx, style, town, m } = D;
        const wPx = ctx.canvas ? ctx.canvas.width : 0, hPx = ctx.canvas ? ctx.canvas.height : 0;
        if (!wPx) return;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        const fs = hPx / 42;
        if (D.links) linkMarks(D);
        const under = D.cave || D.onFloor;
        const kindName = under ? (town.input.capital ? "Cavern capital" : { village: "Cavern village", town: "Cavern town", city: "Cavern city" }[town.kind]) : town.input.capital ? "Capital" : town.input.fortified ? "Fortified town" : town.input.port && town.shore ? (town.kind === "city" ? "Port city" : "Port") : { village: "Village", town: "Market town", city: town.wall ? "Walled city" : "City" }[town.kind];
        const sub = `${kindName}${D.level && D.level !== "Level" && !town.name.includes(D.level) ? ` · ${D.level}` : ""} · ${town.input.population.toLocaleString("en-GB")} people`;
        ctx.font = `${fs * 1.15}px ${style.font}`;
        const tw = Math.max(ctx.measureText(town.name).width, (ctx.font = `italic ${fs * 0.62}px ${style.font}`, ctx.measureText(sub).width));
        ctx.fillStyle = rgba(style.paper, 0.9);
        ctx.strokeStyle = style.ink;
        ctx.lineWidth = 1;
        ctx.fillRect(fs, fs * 0.8, tw + fs * 1.6, fs * 2.9);
        ctx.strokeRect(fs, fs * 0.8, tw + fs * 1.6, fs * 2.9);
        ctx.fillStyle = style.ink;
        ctx.font = `${fs * 1.15}px ${style.font}`;
        ctx.fillText(town.name, fs * 1.8, fs * 2.2);
        ctx.font = `italic ${fs * 0.62}px ${style.font}`;
        ctx.fillText(sub, fs * 1.8, fs * 3.2);
        // A scale bar about a sixth of the view's width
        const bar = niceBar((wPx * m) / 6);
        const bw = bar / m, bx = fs * 1.2, by = hPx - fs * 1.4;
        ctx.fillStyle = rgba(style.paper, 0.85);
        ctx.fillRect(bx - fs * 0.4, by - fs * 1.4, bw + fs * 3.8, fs * 2);
        ctx.fillStyle = style.ink;
        ctx.fillRect(bx, by - fs * 0.3, bw / 2, fs * 0.3);
        ctx.strokeRect(bx + bw / 2, by - fs * 0.3, bw / 2, fs * 0.3);
        ctx.font = `${fs * 0.55}px ${style.font}`;
        ctx.fillText("0", bx, by - fs * 0.55);
        ctx.textAlign = "center";
        ctx.fillText(bar >= 1000 ? `${bar / 1000} km` : `${bar} m`, bx + bw, by - fs * 0.55);
        // North
        const nx = wPx - fs * 1.8, ny = hPx - fs * 2.2;
        ctx.fillStyle = rgba(style.paper, 0.85);
        ctx.beginPath();
        circle(ctx, nx, ny - fs * 0.45, fs * 1.25);
        ctx.fill();
        ctx.fillStyle = style.ink;
        ctx.beginPath();
        poly(ctx, [[nx, ny - fs], [nx + fs * 0.4, ny + fs * 0.4], [nx, ny], [nx - fs * 0.4, ny + fs * 0.4]]);
        ctx.fill();
        ctx.font = `${fs * 0.7}px ${style.font}`;
        ctx.fillText("N", nx, ny - fs * 1.15);
        ctx.textAlign = "start";
    },
};

// ---------------------------------------------------------------- pieces
// ---------------------------------------------------------------- drawing in pieces (V6)
/** The side (m) of the tiles a great place's many shapes are drawn in. */
const TILE_M = 240;

/** The tile each shape's first point falls in. */
function tileKey(p) {
    return `${Math.floor(p[0] / TILE_M)},${Math.floor(p[1] / TILE_M)}`;
}

/**
 * Draws opaque shapes in pieces, one path a tile (by each shape's first point): the same picture
 * as one path, as the shapes are opaque, but a canvas fills many small paths far faster than one
 * vast one (a great city's every house and yard).
 */
function inPieces(D, shapes, add, paint) {
    const { ctx } = D;
    const tiles = new Map();
    for (const s of shapes) {
        const k = tileKey(s[0]);
        let list = tiles.get(k);
        if (!list) tiles.set(k, (list = []));
        list.push(s);
    }
    for (const list of tiles.values()) {
        ctx.beginPath();
        for (const s of list) add(s);
        paint();
    }
}

/**
 * Draws see-through shapes tile by tile, each tile clipped to itself and taking every shape that
 * reaches it, so where shapes overlap (shadows of joined houses) they darken once, as in one path.
 */
function inTiles(D, shapes, add, paint) {
    const { ctx } = D;
    const tiles = new Map();
    for (const s of shapes) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const p of s) {
            if (p[0] < x0) x0 = p[0];
            if (p[0] > x1) x1 = p[0];
            if (p[1] < y0) y0 = p[1];
            if (p[1] > y1) y1 = p[1];
        }
        for (let i = Math.floor(x0 / TILE_M); i <= Math.floor(x1 / TILE_M); i++) {
            for (let j = Math.floor(y0 / TILE_M); j <= Math.floor(y1 / TILE_M); j++) {
                const k = `${i},${j}`;
                let list = tiles.get(k);
                if (!list) tiles.set(k, (list = { i, j, shapes: [] }));
                list.shapes.push(s);
            }
        }
    }
    for (const { i, j, shapes: list } of tiles.values()) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(i * TILE_M, j * TILE_M, TILE_M, TILE_M);
        ctx.clip();
        ctx.beginPath();
        for (const s of list) add(s);
        paint();
        ctx.restore();
    }
}

// ---------------------------------------------------------------- underground (V5b)
/** How far (m) a way meeting an open floor's wall is drawn on into the rock, and a landing's jetty out into the water. */
const TUNNEL_SHOWN = 220;
const LANDING_SHOWN = 40;

/** The rock's grain: parallel strokes across what is drawn, the same in every view. */
function hatch(D, step = 14, angle = 35, width = 2.2) {
    const { ctx, style, box } = D;
    const a = (angle * Math.PI) / 180;
    const t = [Math.cos(a), Math.sin(a)], n = [-t[1], t[0]];
    const c = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
    const reach = Math.hypot(box[2] - box[0], box[3] - box[1]) / 2 + step;
    const o0 = Math.floor((c[0] * n[0] + c[1] * n[1] - reach) / step) * step;
    ctx.strokeStyle = style.rockHatch;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (let o = o0; o <= o0 + 2 * reach + step; o += step) {
        // the line n·p = o, through the box
        const q = [n[0] * o, n[1] * o];
        const along = (c[0] - q[0]) * t[0] + (c[1] - q[1]) * t[1];
        ctx.moveTo(q[0] + t[0] * (along - reach), q[1] + t[1] * (along - reach));
        ctx.lineTo(q[0] + t[0] * (along + reach), q[1] + t[1] * (along + reach));
    }
    ctx.stroke();
}

/** Clips to a carved level's open floor. */
function floorClip(D) {
    const { ctx } = D;
    ctx.beginPath();
    for (const f of D.floors) if (D.visible(f)) poly(ctx, f);
    ctx.clip("nonzero");
}

/**
 * A carved level's ground: the rock and its grain, then the open floor over it (chambers, halls,
 * galleries, side caverns, tunnels and the ways between), each edged in the rock's edge first so
 * the floors meet without seams; and the land open to the sky before a hold's gate.
 */
function caveGround(D) {
    const { ctx, style, box, floors, cave } = D;
    ctx.fillStyle = style.rock;
    ctx.fillRect(box[0], box[1], box[2] - box[0], box[3] - box[1]);
    hatch(D);
    const seen = floors.filter((f) => D.visible(f));
    ctx.lineJoin = "round";
    ctx.strokeStyle = style.rockEdge;
    ctx.lineWidth = 9;
    ctx.beginPath();
    for (const f of seen) poly(ctx, f);
    ctx.stroke();
    ctx.fillStyle = style.caveFloor;
    ctx.fill("nonzero");
    // A lighter wash just inside the walls, as lamplight falls on the floor
    ctx.save();
    ctx.clip("nonzero");
    ctx.strokeStyle = rgba(style.rockEdge, 0.35);
    ctx.lineWidth = 10;
    ctx.beginPath();
    for (const f of seen) poly(ctx, f);
    ctx.stroke();
    ctx.restore();
    if (cave.outside) {
        ctx.fillStyle = style.surface;
        ctx.beginPath();
        poly(ctx, cave.outside.poly);
        ctx.fill();
    }
}

/** The mountain's foot before a hold's gate, drawn as a coast is: its line, and hachures up the face into the rock. */
function mountainFace(D) {
    const { ctx, style, w } = D;
    const o = D.cave.outside;
    ctx.strokeStyle = style.rockEdge;
    ctx.lineWidth = w(1.6);
    ctx.beginPath();
    for (let k = 0; k < o.face.length; k += 2) {
        const p = o.face[k];
        const len = 10 + 14 * hash(p[0], p[1]);
        ctx.moveTo(p[0], p[1]);
        ctx.lineTo(p[0] - o.u[0] * len, p[1] - o.u[1] * len);
    }
    ctx.stroke();
    ctx.lineWidth = w(3);
    ctx.lineJoin = "round";
    ctx.beginPath();
    line(ctx, o.face);
    ctx.stroke();
}

/** A carved level's landmarks: the pillars of rock left standing (the largest hollowed as great
 * houses, their windows round the outside and a court within), the great gate onto the mountainside,
 * and the forts closing the tunnels. */
function caveLandmarks(D) {
    const { ctx, style, town, cave, w } = D;
    for (const pillar of cave.pillars) {
        if (!D.near(pillar.c, pillar.r)) continue;
        // its shadow, its rock and grain, its edge
        ctx.fillStyle = rgba(style.shadow, style.shadowAlpha);
        ctx.beginPath();
        poly(ctx, shadowOf(D, pillar.outline, 14));
        ctx.fill();
        ctx.save();
        ctx.beginPath();
        poly(ctx, pillar.outline);
        ctx.fillStyle = style.rock;
        ctx.fill();
        ctx.clip();
        hatch(D, 7, 35, 1.4);
        ctx.restore();
        ctx.strokeStyle = style.rockEdge;
        ctx.lineWidth = w(2.4, 0.8);
        ctx.beginPath();
        poly(ctx, pillar.outline);
        ctx.stroke();
        if (!pillar.hollow) continue;
        // windows round the outside, lit; a court within, roofed round
        ctx.strokeStyle = style.link;
        ctx.lineWidth = w(2.2, 0.6);
        ctx.setLineDash([3, 5]);
        ctx.beginPath();
        circle(ctx, pillar.c[0], pillar.c[1], pillar.r * 0.78);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = style.roof;
        ctx.strokeStyle = style.roofEdge;
        ctx.lineWidth = w(1, 0.4);
        ctx.beginPath();
        circle(ctx, pillar.c[0], pillar.c[1], pillar.r * 0.4);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = style.caveFloor;
        ctx.beginPath();
        circle(ctx, pillar.c[0], pillar.c[1], pillar.r * 0.18);
        ctx.fill();
    }
    const fortLike = [...(town.forts ?? []).map((f) => ({ ...f, r: 7, half: 8, width: 9 })), ...(town.gate ? [{ ...town.gate, r: 11, half: 11, width: 11 }] : [])];
    for (const f of fortLike) {
        if (!D.near(f.p, 40)) continue;
        roof(D, f.house, style.stone, 1.3, style.stoneEdge);
        for (const q of f.towers) tower(D, q, f.r);
        // the passage through
        const t = [Math.cos(f.dir), Math.sin(f.dir)];
        ctx.strokeStyle = style.road;
        ctx.lineWidth = f.width;
        ctx.lineCap = "butt";
        ctx.beginPath();
        line(ctx, [[f.p[0] - t[0] * f.half, f.p[1] - t[1] * f.half], [f.p[0] + t[0] * f.half, f.p[1] + t[1] * f.half]]);
        ctx.stroke();
    }
}

/** The stairs, shafts and air shafts on this level, marked at the same points on every level they
 * join, with a label beside each (drawn in pixels, placed where it overlaps nothing). */
function linkMarks(D) {
    const { ctx, style, m, town } = D;
    const [x0, y0] = [D.box[0] + 40, D.box[1] + 40];
    const k = D.levelIndex;
    const mine = D.links.filter((l) => k == null || l.joins.includes(k));
    if (!mine.length) return;
    const hPx = ctx.canvas ? ctx.canvas.height : 1000;
    // (sized to the picture, as the title is)
    const s = Math.max(7, hPx / 260);
    const fs = s * 1.5;
    const items = mine.map((l) => {
        const other = l.joins.find((j) => j !== k);
        const text = `${l.kind === "air" ? "air" : l.kind} ${other === "surface" ? "up to the surface" : k == null ? "" : other < k ? "up" : "down"}`.trim();
        return { x: (l.p[0] - x0) / m, y: (l.p[1] - y0) / m, s, text, l };
    });
    void town;
    ctx.font = `${fs}px ${style.font}`;
    const spots = placeLabels(ctx, items, fs);
    for (const [i, it] of items.entries()) {
        const { x, y, l } = it;
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = style.linkEdge;
        ctx.fillStyle = style.link;
        if (l.kind === "stair") {
            ctx.fillRect(x - s, y - s, 2 * s, 2 * s);
            ctx.strokeRect(x - s, y - s, 2 * s, 2 * s);
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let j = 1; j < 4; j++) {
                ctx.moveTo(x - s, y - s + (j * 2 * s) / 4);
                ctx.lineTo(x + s, y - s + (j * 2 * s) / 4);
            }
            ctx.stroke();
        } else if (l.kind === "shaft") {
            ctx.fillRect(x - s, y - s, 2 * s, 2 * s);
            ctx.strokeRect(x - s, y - s, 2 * s, 2 * s);
            ctx.beginPath();
            ctx.moveTo(x - s, y - s);
            ctx.lineTo(x + s, y + s);
            ctx.moveTo(x + s, y - s);
            ctx.lineTo(x - s, y + s);
            ctx.stroke();
        } else {
            ctx.strokeStyle = style.link;
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.arc(x, y, s * 0.8, 0, Math.PI * 2);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(x, y, s * 0.25, 0, Math.PI * 2);
            ctx.fill();
        }
        const at = spots[i];
        ctx.textAlign = at.anchor;
        ctx.lineWidth = 3;
        ctx.strokeStyle = style.rock;
        ctx.strokeText(it.text, at.tx, at.ty);
        ctx.fillStyle = style.link;
        ctx.fillText(it.text, at.tx, at.ty);
    }
    ctx.textAlign = "start";
}

/** Places labels beside their marks: right, left, above or below, whichever overlaps no other
 * label or mark; else the least crowded. */
export function placeLabels(ctx, items, fontSize) {
    const boxes = items.map(({ x, y, s }) => [x - s, y - s, x + s, y + s]);
    const overlap = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
    return items.map(({ x, y, s, text }) => {
        const wd = ctx.measureText ? ctx.measureText(text).width : text.length * fontSize * 0.55;
        const h = fontSize;
        const spots = [[x + s * 1.4, y + h * 0.35, "left"], [x - s * 1.4, y + h * 0.35, "right"], [x, y - s * 1.4, "center"], [x, y + s * 1.4 + h * 0.8, "center"], [x + s * 1.2, y - s * 1.2, "left"], [x - s * 1.2, y + s * 1.2 + h * 0.8, "right"]];
        const boxOf = ([tx, ty, anchor]) => {
            const left = anchor === "left" ? tx : anchor === "right" ? tx - wd : tx - wd / 2;
            return [left, ty - h * 0.85, left + wd, ty + h * 0.2];
        };
        let best = spots[0], least = Infinity;
        for (const spot of spots) {
            const b = boxOf(spot);
            const crowd = boxes.reduce((a, o) => a + overlap(b, o), 0);
            if (crowd < least) {
                least = crowd;
                best = spot;
            }
            if (crowd === 0) break;
        }
        boxes.push(boxOf(best));
        return { tx: best[0], ty: best[1], anchor: best[2] };
    });
}

function heightOf(b) {
    if (b.estate && b.kind === "house") return HEIGHTS.grand;
    return HEIGHTS[b.kind] ?? HEIGHTS.house;
}

function roofColour(D, b) {
    const { style, town, cultures, theme } = D;
    let base;
    if (b.kind === "barn") base = style.barn;
    else if (b.kind === "warehouse") base = style.warehouse;
    else {
        // Outbuildings (ranges, workshops, stables, sheds) a shade lighter; inns and halls a shade
        // deeper, so they read as larger buildings of the same town
        const lesser = b.kind === "range" || b.kind === "workshop" || b.kind === "stable" || b.kind === "shed";
        // The culture view (a thematic view, not the base appearance: Ken, 2026-11-17) colours each
        // roof by its household's culture
        const culture = theme === "culture" ? b.culture ?? (b.kind === "range" && Number.isInteger(b.house) ? town.buildings[b.house]?.culture : null) : null;
        const own = culture ? cultures[culture]?.roof : null;
        // Otherwise by what the roof is made of: straw, tile or slate (engine/town/roofs.mjs)
        const material = b.roof === "thatch" ? style.thatch : b.roof === "slate" ? style.slate : null;
        if (own) base = lesser ? shade(own, -0.06) : own;
        else if (material) base = b.estate ? shade(material, -0.08) : lesser ? shade(material, -0.06) : material;
        else base = b.estate ? style.grandRoof : lesser ? style.rangeRoof : style.roof;
        if (b.kind === "inn" || b.kind === "hall") base = shade(base, -0.1);
    }
    // A small spread, by building, so a roofscape is not one flat colour
    const c = centroid(b.poly);
    return shade(base, (hash(c[0], c[1], 5) - 0.5) * 2 * style.roofSpread);
}

/**
 * A roof over a footprint: four corners make two pitches and a ridge along the long axis (hipped
 * where the footprint is near square, or `hipAt` long over short); each pitch lit by how it faces
 * the light. Other shapes are drawn flat.
 */
function roof(D, pts, colour, hipAt = 1.35, edge = D.style.roofEdge) {
    const { ctx, style, toLight, w } = D;
    ctx.lineJoin = "round";
    if (pts.length !== 4) {
        // A roof hipped from every eave to one apex (a corner house on a splayed or triangular plot)
        const apex = centroid(pts);
        for (let k = 0; k < pts.length; k++) {
            const p = pts[k], q = pts[(k + 1) % pts.length];
            const em = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
            const v = [em[0] - apex[0], em[1] - apex[1]];
            const L = Math.hypot(v[0], v[1]) || 1;
            ctx.fillStyle = shade(colour, style.facetContrast * ((v[0] * toLight[0] + v[1] * toLight[1]) / L));
            ctx.beginPath();
            poly(ctx, [p, q, apex]);
            ctx.fill();
        }
        ctx.strokeStyle = rgba(style.ridge, 0.55);
        ctx.lineWidth = w(0.35, 0.25);
        ctx.beginPath();
        for (const p of pts) line(ctx, [p, apex]);
        ctx.stroke();
        ctx.strokeStyle = edge;
        ctx.lineWidth = w(0.45, 0.3);
        ctx.beginPath();
        poly(ctx, pts);
        ctx.stroke();
        return;
    }
    let [a, b, c, d] = pts;
    const L1 = (Math.hypot(b[0] - a[0], b[1] - a[1]) + Math.hypot(c[0] - d[0], c[1] - d[1])) / 2;
    const L2 = (Math.hypot(c[0] - b[0], c[1] - b[1]) + Math.hypot(a[0] - d[0], a[1] - d[1])) / 2;
    // The long axis runs a → b
    if (L2 > L1) [a, b, c, d] = [b, c, d, a];
    const long = Math.max(L1, L2), short = Math.min(L1, L2);
    let r0 = [(d[0] + a[0]) / 2, (d[1] + a[1]) / 2];
    let r1 = [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2];
    const hip = long / Math.max(0.1, short) < hipAt;
    if (hip) {
        const t = Math.min(0.48, short / 2 / Math.max(0.1, long));
        [r0, r1] = [[r0[0] + (r1[0] - r0[0]) * t, r0[1] + (r1[1] - r0[1]) * t], [r1[0] + (r0[0] - r1[0]) * t, r1[1] + (r0[1] - r1[1]) * t]];
    }
    const mid = [(r0[0] + r1[0]) / 2, (r0[1] + r1[1]) / 2];
    const lit = (edgeMid) => {
        const v = [edgeMid[0] - mid[0], edgeMid[1] - mid[1]];
        const L = Math.hypot(v[0], v[1]) || 1;
        return shade(colour, style.facetContrast * ((v[0] * toLight[0] + v[1] * toLight[1]) / L));
    };
    const facets = [[[a, b, r1, r0], [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]], [[c, d, r0, r1], [(c[0] + d[0]) / 2, (c[1] + d[1]) / 2]]];
    if (hip) facets.push([[b, c, r1], [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2]], [[d, a, r0], [(d[0] + a[0]) / 2, (d[1] + a[1]) / 2]]);
    for (const [f, em] of facets) {
        ctx.fillStyle = lit(em);
        ctx.beginPath();
        poly(ctx, f);
        ctx.fill();
    }
    // The ridge (and hips), then the eaves
    ctx.strokeStyle = rgba(style.ridge, 0.55);
    ctx.lineWidth = w(0.35, 0.25);
    ctx.beginPath();
    line(ctx, [r0, r1]);
    if (hip) {
        line(ctx, [a, r0, d]);
        line(ctx, [b, r1, c]);
    }
    ctx.stroke();
    ctx.strokeStyle = edge;
    ctx.lineWidth = w(0.45, 0.3);
    ctx.beginPath();
    poly(ctx, [a, b, c, d]);
    ctx.stroke();
}

const WORK = new Set(["metal", "leather", "building", "transport", "food", "cloth", "trade", "mining", "light"]);
const WELL_OFF = new Set(["prosperous", "wealthy"]);

/**
 * Each house's ground behind it: gardens (green, hedged, with beds and a tree or two where there
 * is room) for the upper tier and the better off; yards (packed earth, fenced) for the rest, a
 * working yard (with a stack or two) for a trade's house.
 */
function yardsAndGardens(D) {
    const { ctx, style, town, visible, w } = D;
    const yards = town.yards?.length ? town.yards : (town.plots ?? []).map((poly) => ({ poly, house: -1 }));
    const gardens = [], plain = [], work = [];
    for (const y of yards) {
        if (!visible(y.poly)) continue;
        const h = town.buildings[y.house];
        if (h && (h.tier === "upper" || WELL_OFF.has(h.wealth))) gardens.push(y);
        else if (h && WORK.has(h.group)) work.push(y);
        else plain.push(y);
    }
    ctx.lineJoin = "round";
    for (const [list, fill, edge] of [[plain, style.yardGround, style.fence], [work, style.workYard, style.fence], [gardens, style.gardenGround, style.gardenEdge]]) {
        if (!list.length) continue;
        ctx.fillStyle = fill;
        ctx.strokeStyle = edge;
        ctx.lineWidth = w(0.5, 0.3);
        inPieces(D, list.map((y) => y.poly), (pts) => poly(ctx, pts), () => {
            ctx.fill();
            ctx.stroke();
        });
    }
    // A working yard's stacks (timber, barrels, stone)
    ctx.fillStyle = shade(style.workYard, -0.22);
    ctx.beginPath();
    for (const y of work) {
        const c = centroid(y.poly);
        if (hash(c[0], c[1], 11) > 0.6) continue;
        const q = [c[0] * 0.6 + y.poly[2][0] * 0.4, c[1] * 0.6 + y.poly[2][1] * 0.4];
        poly(ctx, [[q[0] - 1.2, q[1] - 1.2], [q[0] + 1.2, q[1] - 1.2], [q[0] + 1.2, q[1] + 1.2], [q[0] - 1.2, q[1] + 1.2]]);
    }
    ctx.fill();
    // A garden's beds, in rows from the house back, and its trees
    ctx.strokeStyle = style.gardenBed;
    ctx.lineWidth = w(1.2, 0.4);
    ctx.setLineDash([w(2.5, 0.8), w(1.5, 0.6)]);
    ctx.beginPath();
    const trees = [];
    for (const y of gardens) {
        const [a, b, c, d] = y.poly;
        const depth = Math.hypot(d[0] - a[0], d[1] - a[1]);
        const width = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (depth < 5 || width < 3) continue;
        const rows = Math.max(1, Math.floor(width / 2.6) - 1);
        const at = (u, v) => [a[0] + (b[0] - a[0]) * u + (d[0] - a[0]) * v, a[1] + (b[1] - a[1]) * u + (d[1] - a[1]) * v];
        for (let r = 1; r <= rows; r++) {
            const u = r / (rows + 1);
            line(ctx, [at(u, 0.15), at(u, 0.55)]);
        }
        const m = centroid(y.poly);
        if (depth * width > 70) trees.push([...at(0.3 + 0.4 * hash(m[0], m[1], 12), 0.78), 2 + 1.4 * hash(m[1], m[0], 13)]);
        if (depth * width > 260) trees.push([...at(0.7 - 0.4 * hash(m[0], m[1], 14), 0.88), 2.2 + hash(m[0], m[1], 15)]);
        void c;
    }
    ctx.stroke();
    ctx.setLineDash([]);
    // A fruit tree now and then in a yard with room for one (Ken: trees fill the gaps in blocks)
    for (const y of plain) {
        const area = Math.abs(polyArea(y.poly));
        const m = centroid(y.poly);
        if (area > 55 && hash(m[0], m[1], 16) < 0.3) trees.push([m[0] * 0.4 + y.poly[2][0] * 0.3 + y.poly[3][0] * 0.3, m[1] * 0.4 + y.poly[2][1] * 0.3 + y.poly[3][1] * 0.3, 1.6 + hash(m[1], m[0], 17)]);
    }
    drawTrees(D, trees);
}

function polyArea(pts) {
    let a = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
    return a / 2;
}

/** Trees: a soft shadow, the crown, its lit side towards the light. */
function drawTrees(D, trees) {
    const { ctx, style, toLight, near, w } = D;
    const shown = trees.filter((t) => near(t, t[2] + 4));
    if (!shown.length) return;
    ctx.fillStyle = rgba(style.shadow, style.shadowAlpha * 0.9);
    ctx.beginPath();
    for (const [x, y, r] of shown) circle(ctx, x - toLight[0] * r * 0.7, y - toLight[1] * r * 0.7, r);
    ctx.fill();
    ctx.fillStyle = style.tree;
    ctx.strokeStyle = style.treeEdge;
    ctx.lineWidth = w(0.5, 0.3);
    ctx.beginPath();
    for (const [x, y, r] of shown) circle(ctx, x, y, r);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = style.treeLit;
    ctx.beginPath();
    for (const [x, y, r] of shown) circle(ctx, x + toLight[0] * r * 0.3, y + toLight[1] * r * 0.3, r * 0.55);
    ctx.fill();
}

/** A polygon pulled in towards its centre by about so many metres (a margin inside its edge). */
function shrinkBy(pts, m) {
    const c = centroid(pts);
    return pts.map((p) => {
        const d = Math.hypot(p[0] - c[0], p[1] - c[1]) || 1;
        const k = Math.max(0, (d - m) / d);
        return [c[0] + (p[0] - c[0]) * k, c[1] + (p[1] - c[1]) * k];
    });
}

/** Marks scattered over a shape on a jittered grid. */
function marks(D, pts, step, draw) {
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    let row = 0;
    for (let y = Math.min(...ys) + step / 2; y < Math.max(...ys); y += step * 0.85, row++) {
        for (let x = Math.min(...xs) + ((row % 2) * step) / 2; x < Math.max(...xs); x += step) {
            const q = [x + (hash(x, y) - 0.5) * step * 0.3, y + (hash(y, x) - 0.5) * step * 0.3];
            if (D.near(q) && inside(q, pts)) draw(q[0], q[1]);
        }
    }
}

/** Paving: a light grid of setts across a square. */
function paving(D, pts) {
    const { ctx, style, w } = D;
    ctx.save();
    ctx.beginPath();
    poly(ctx, pts);
    ctx.clip();
    const c = centroid(pts);
    const e = [pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]];
    const L = Math.hypot(e[0], e[1]) || 1;
    const t = [e[0] / L, e[1] / L], n = [-t[1], t[0]];
    const reach = Math.max(...pts.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1])));
    ctx.strokeStyle = rgba(style.paving, 0.8);
    ctx.lineWidth = w(0.4, 0.25);
    ctx.beginPath();
    for (let o = -reach; o <= reach; o += 4) {
        ctx.moveTo(c[0] + n[0] * o - t[0] * reach, c[1] + n[1] * o - t[1] * reach);
        ctx.lineTo(c[0] + n[0] * o + t[0] * reach, c[1] + n[1] * o + t[1] * reach);
        ctx.moveTo(c[0] + t[0] * o - n[0] * reach, c[1] + t[1] * o - n[1] * reach);
        ctx.lineTo(c[0] + t[0] * o + n[0] * reach, c[1] + t[1] * o + n[1] * reach);
    }
    ctx.stroke();
    ctx.restore();
}

/** A parterre: beds in a cross of paths, with a basin at the middle. */
function parterre(D, pts) {
    const { ctx, style } = D;
    const c = centroid(pts);
    ctx.fillStyle = shade(style.estate, -0.08);
    ctx.beginPath();
    for (const p of pts) {
        // A bed in each quarter, inset from the paths and the edge
        const q = [(p[0] * 0.55 + c[0] * 0.45), (p[1] * 0.55 + c[1] * 0.45)];
        circle(ctx, q[0], q[1], 2.6);
    }
    ctx.fill();
    ctx.fillStyle = style.water;
    ctx.strokeStyle = style.stoneEdge;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    circle(ctx, c[0], c[1], 2.2);
    ctx.fill();
    ctx.stroke();
}

/** Stalls in rows across a market, with awnings of a few colours; a cross or well in the middle. */
function stalls(D, pts, density) {
    const { ctx, style, toLight } = D;
    const c = centroid(pts);
    const e = [pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]];
    const L = Math.hypot(e[0], e[1]) || 1;
    const t = [e[0] / L, e[1] / L], n = [-t[1], t[0]];
    const reach = Math.max(...pts.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1])));
    const shrink = pts.map((p) => [c[0] + (p[0] - c[0]) * 0.82, c[1] + (p[1] - c[1]) * 0.82]);
    const angle = Math.atan2(t[1], t[0]);
    const placed = [];
    for (let a = -reach; a <= reach; a += 7) {
        for (let b = -reach; b <= reach; b += 9) {
            const q = [c[0] + t[0] * a + n[0] * b, c[1] + t[1] * a + n[1] * b];
            if (Math.hypot(q[0] - c[0], q[1] - c[1]) < 7 || !inside(q, shrink) || hash(q[0], q[1], 9) > 0.55 * density) continue;
            placed.push(q);
        }
    }
    for (const q of placed) {
        const s = [
            [q[0] - t[0] * 1.6 - n[0] * 1.2, q[1] - t[1] * 1.6 - n[1] * 1.2],
            [q[0] + t[0] * 1.6 - n[0] * 1.2, q[1] + t[1] * 1.6 - n[1] * 1.2],
            [q[0] + t[0] * 1.6 + n[0] * 1.2, q[1] + t[1] * 1.6 + n[1] * 1.2],
            [q[0] - t[0] * 1.6 + n[0] * 1.2, q[1] - t[1] * 1.6 + n[1] * 1.2],
        ];
        ctx.fillStyle = rgba(style.shadow, style.shadowAlpha);
        ctx.beginPath();
        poly(ctx, s.map((p) => [p[0] - toLight[0] * 1.1, p[1] - toLight[1] * 1.1]));
        ctx.fill();
        ctx.fillStyle = style.stalls[Math.floor(hash(q[0], q[1], 4) * style.stalls.length)];
        ctx.strokeStyle = rgba(style.roofEdge, 0.7);
        ctx.lineWidth = 0.3;
        ctx.beginPath();
        poly(ctx, s);
        ctx.fill();
        ctx.stroke();
    }
    void angle;
    // The cross (or well) at the middle
    ctx.fillStyle = style.stone;
    ctx.strokeStyle = style.stoneEdge;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    circle(ctx, c[0], c[1], 2.8 * Math.max(0.6, density));
    ctx.fill();
    ctx.stroke();
}

function wallColour(D) {
    return D.ruling.wall ?? D.style.stone;
}

/** A town wall in its culture's material: stone with round towers, or earth bank and palisade. */
function wall(D, ring, outer) {
    const { ctx, style, ruling } = D;
    const v = ring.verts;
    const runs = [];
    for (let k = 0; k < v.length; k++) {
        const a = v[k], b = v[(k + 1) % v.length];
        if (a.onBank && b.onBank) continue;
        runs.push([a.p, b.p]);
    }
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (ruling.wallMaterial === "palisade") {
        // The bank, wide and earthen, then the palisade along its crest: posts as a dashed dark line
        ctx.strokeStyle = style.bankEdge;
        ctx.lineWidth = outer ? 11 : 13;
        ctx.beginPath();
        for (const r of runs) line(ctx, r);
        ctx.stroke();
        ctx.strokeStyle = style.bank;
        ctx.lineWidth = outer ? 9 : 11;
        ctx.stroke();
        ctx.strokeStyle = ruling.wall ?? style.palisade;
        ctx.lineWidth = 2.2;
        ctx.setLineDash([1.1, 0.5]);
        ctx.lineCap = "butt";
        ctx.stroke();
        ctx.setLineDash([]);
        // Each tower square to the wall it stands on
        for (const q of ring.towers) timberTower(D, q, outer ? 4.5 : 5.5, wallAngleAt(runs, q));
        for (const g of ring.gates) gatehouse(D, g, outer ? 10 : 12, true);
        return;
    }
    const colour = wallColour(D);
    ctx.strokeStyle = style.stoneEdge;
    ctx.lineWidth = outer ? 6.2 : 7.2;
    ctx.beginPath();
    for (const r of runs) line(ctx, r);
    ctx.stroke();
    ctx.strokeStyle = colour;
    ctx.lineWidth = outer ? 4.2 : 5;
    ctx.stroke();
    // The wall-walk's lit edge
    ctx.strokeStyle = rgba(shade(colour, 0.3), 0.8);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const [a, b] of runs) {
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const n = [-(b[1] - a[1]) / L, (b[0] - a[0]) / L];
        const s = n[0] * D.toLight[0] + n[1] * D.toLight[1] >= 0 ? 1 : -1;
        const o = (outer ? 1.4 : 1.7) * s;
        line(ctx, [[a[0] + n[0] * o, a[1] + n[1] * o], [b[0] + n[0] * o, b[1] + n[1] * o]]);
    }
    ctx.stroke();
    // A seaward wall along the quays is a parapet (none where the wall ends against a mountain's rock)
    const quay = [];
    for (let k = 0; k < v.length; k++) if (v[k].onBank && v[(k + 1) % v.length].onBank && !(v[k].onRock && v[(k + 1) % v.length].onRock)) quay.push([v[k].p, v[(k + 1) % v.length].p]);
    if (quay.length) {
        ctx.strokeStyle = colour;
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 3]);
        ctx.beginPath();
        for (const r of quay) line(ctx, r);
        ctx.stroke();
        ctx.setLineDash([]);
    }
    for (const q of ring.towers) tower(D, q, outer ? 5 : 6);
    for (const g of ring.gates) gatehouse(D, g, outer ? 10 : 12);
}

/** A round stone tower: its shadow, the drum lit from one side, the edge. */
function tower(D, q, r) {
    const { ctx, style, toLight } = D;
    const colour = D.ruling.wallMaterial === "palisade" ? style.stone : wallColour(D);
    const L = HEIGHTS.tower * style.shadowLength;
    ctx.fillStyle = rgba(style.shadow, style.shadowAlpha);
    ctx.beginPath();
    poly(ctx, hull(Array.from({ length: 16 }, (_, k) => {
        const a = (k / 16) * Math.PI * 2;
        const p = [q[0] + Math.cos(a) * r, q[1] + Math.sin(a) * r];
        return k % 2 ? p : [p[0] - toLight[0] * L, p[1] - toLight[1] * L];
    }).concat(Array.from({ length: 16 }, (_, k) => [q[0] + Math.cos((k / 16) * Math.PI * 2) * r, q[1] + Math.sin((k / 16) * Math.PI * 2) * r]))));
    ctx.fill();
    ctx.fillStyle = colour;
    ctx.strokeStyle = style.stoneEdge;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    circle(ctx, q[0], q[1], r);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = rgba(shade(colour, 0.35), 0.7);
    ctx.beginPath();
    circle(ctx, q[0] + toLight[0] * r * 0.3, q[1] + toLight[1] * r * 0.3, r * 0.55);
    ctx.fill();
}

/** A square timber tower on a bank. */
function timberTower(D, q, s, angle = 0) {
    const { ctx, style, ruling } = D;
    const u = [Math.cos(angle), Math.sin(angle)], v = [-u[1], u[0]];
    const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [q[0] + (u[0] * a + v[0] * b) * s, q[1] + (u[1] * a + v[1] * b) * s]);
    ctx.fillStyle = rgba(style.shadow, style.shadowAlpha);
    ctx.beginPath();
    poly(ctx, shadowOf(D, pts, HEIGHTS.timberTower));
    ctx.fill();
    roof(D, pts, ruling.wall ?? style.timber, 2, style.timberEdge);
}

/** The bearing of the wall's run nearest a point (radians). */
function wallAngleAt(runs, q) {
    let best = null;
    for (const [a, b] of runs) {
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const L2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / L2));
        const d = Math.hypot(a[0] + dx * t - q[0], a[1] + dy * t - q[1]);
        if (!best || d < best.d) best = { d, angle: Math.atan2(dy, dx) };
    }
    return best ? best.angle : 0;
}

/** A gatehouse over its passage: the house, two flanking towers (stone) or posts (timber). */
function gatehouse(D, g, depth, timber = false) {
    const { ctx, style } = D;
    if (!g.house) return;
    const colour = timber ? D.ruling.wall ?? style.timber : D.ruling.wallMaterial === "palisade" ? style.stone : wallColour(D);
    roof(D, g.house, colour, 2, timber ? style.timberEdge : style.stoneEdge);
    const t = [Math.cos(g.dir ?? 0), Math.sin(g.dir ?? 0)];
    // The passage through it
    ctx.strokeStyle = style.road;
    ctx.lineWidth = 4.6;
    ctx.lineCap = "butt";
    ctx.beginPath();
    line(ctx, [[g.p[0] - t[0] * depth, g.p[1] - t[1] * depth], [g.p[0] + t[0] * depth, g.p[1] + t[1] * depth]]);
    ctx.stroke();
}

function niceBar(m) {
    const steps = [20, 50, 100, 200, 250, 500, 1000, 2000];
    return steps.reduce((a, b) => (Math.abs(b - m) < Math.abs(a - m) ? b : a));
}

export { mix };
