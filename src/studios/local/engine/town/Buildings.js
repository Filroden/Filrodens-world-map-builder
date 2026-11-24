// Buildings along every frontage. Candidates every plot width along both sides of every street,
// nearest the centre first (outside the walls last, from the wall and the roads outwards, on the
// suburbs' own ground);
// each is placed if its plot is free, until the people are housed. Villages have tofts and crofts
// with barns behind; towns have burgage plots reaching back towards the back lanes; a city's
// houses inside the walls stand shoulder to shoulder in terraces, with back houses round the yards.
import { dist, pointInPolygon, polygonArea, segmentDistance, simplify, walk } from "../Geometry.js";
import { BUILDING, FREE, PLOT, RESERVED, STREET, WATER } from "./Occupancy.js";

/** Cottage plots along a town's lanes: frontage, plot depth and house depth (m). */
const COTTAGE_PLOT_W = [5.5, 8];
const COTTAGE_PLOT_DEPTH = [12, 22];
const COTTAGE_DEPTH = [6, 8];
/** A village plot's width is one, two or three times the usual; the wider, the larger the house. */
const WEALTH_SHARES = [0.73, 0.22, 0.05];
const WEALTH_WIDTH = [1, 1.25, 1.45];
/** Chance a village frontage slot is left as a gap. */
const VILLAGE_GAP = 0.08;
/** A city's suburban plots: yard and garden depth behind the house (m). */
const SUBURB_PLOT_DEPTH = [8, 20];
/** Plots inside a walled town reach this far back (m), towards the middle of the block. */
const WALLED_PLOT_DEPTH = [18, 32];
/** How far back a frontage's free run is looked for (m), and the shallowest house it will take. */
const FREE_RUN_MAX = 90;
const MIN_HOUSE_DEPTH = 5.5;
/** Suburban frontage (V2): plots this many times the plan's width, a share left open, and a share
 * of houses built eaves-on to the street (wider than deep). */
const SUBURB_PLOT_SPREAD = [1, 1.6];
const SUBURB_GAP = 0.12;
const SUBURB_EAVES_ON = 0.35;
const EAVES_ON_DEPTH = [5, 7];
/** Wealth by ward and frontage (Ken, 2026-11-14): plots widen up to this many times near the
 * market, on the main streets near it, and by the castle or the great place of worship, within
 * these distances (m). */
const WEALTH_MAX = 1.8;
const WEALTH_MARKET_M = 140;
const WEALTH_MAIN_M = 280;
const WEALTH_LANDMARK_M = 100;
/** Rear ranges behind houses inside the walls (or a town's core): a share of houses (more for the
 * wealthy), along one side of the plot from the house's back, this wide and long (m). */
const RANGE_SHARE = [0.55, 0.9];
const RANGE_WIDTH = [3.5, 6];
const RANGE_LENGTH = [6, 15];
/** Where a frontage plot will not take a house (a corner, a junction), a narrower one is tried. */
const NARROW_SHARE = 0.55;
/** A frontage beyond the suburbs' ground is built only once every frontage on it is taken, so a
 * place hemmed in by rock or water still houses everyone. */
const OUTSIDE_SUBURB_PENALTY = 5e7;
/** Warehouses along a quay: frontage and depth (m). */
const WAREHOUSE_W = [11, 17];
const WAREHOUSE_DEPTH = [12, 20];
/** Neighbouring buildings may touch: overlaps under this many metres are a shared wall. */
const PARTY_WALL_SLACK = 0.05;
/** ... and in the plan-first core, whose wedge plots on curved streets meet at a slight angle. */
const PLAN_SLACK = 0.35;
/** The gap and corner filler (plan-first core): open frontage runs of this many metres, built this deep at most. */
const GAP_MIN = 2.5;
/** ... a wing of a house no further than this (m) from it. */
const GAP_HOUSE_M = 18;
const GAP_MAX = 16;
const GAP_DEPTH = 11;
/** ... its shallower end at least this deep (m) and this share of the deeper end's depth. */
const GAP_END_MIN = 3;
const GAP_END_SHARE = 0.55;
/** A corner fill whose back follows the street round the corner: its depth (m, least and most),
 * its front (m), its area (m², big enough to live in), the share of its run whose back is on that
 * street, and the tolerance its outline is simplified to (m). */
const CORNER = Object.freeze({ deep: [5, 11], front: 5, area: 30, alongShare: 0.4, simplify: 0.6 });
/** A building's corners all within this many degrees of square (no rhombuses or kites). */
const SQUARE_TOLERANCE_DEG = 30;
/** ... a gap fill, which may splay round a bend or a corner, within this many. */
const GAP_TOLERANCE_DEG = 42;
/** A terrace keeps one depth along a street, varying smoothly over this many metres. */
const TERRACE_DEPTH_WAVE = 90;
/** Inside a planned town, how much later (in priority) a street's frontage is built, by its rank. */
const RANK_FIRST = [0, 70, 140];
/** Houses in a stretch of terrace built at one turn. */
const TERRACE_STRETCH = 18;
/** Buildings that are not homes (Ken, 2026-11-16), on the frontage inside the walls the houses
 * leave open, once the people are housed: inns by the gates and on the main streets out from the market
 * (one per so many people inside, with a stable behind), halls by the market (guild and market
 * halls), and workshops, stores and stables on the other streets. Width and depth (m). */
const WORKS = Object.freeze({
    inn: Object.freeze({ people: 450, w: [12, 18], d: [11, 15], nearGate: 90, nearMarket: 260, offMarket: 50 }),
    hall: Object.freeze({ people: 4000, w: [14, 22], d: [13, 19], nearMarket: 140 }),
    workshop: Object.freeze({ w: [6, 12], d: [7, 11] }),
    stable: Object.freeze({ w: [5, 7], d: [9, 15] }),
});
/** A back building at the far end of a plot inside the walls (a workshop, a store, a stable):
 * a share of plots with this much free depth behind the house and its range (m). */
const BACK_BUILDING = Object.freeze({ share: 0.45, freeM: 9, w: [4.5, 8], d: [4, 6.5] });
/** The ground inside blocks (plan-first core), on a lattice this far apart (m), at least this far
 * from a street (m): where the walls cannot otherwise hold their people, back houses round courts
 * (homes, lower tier); once they are housed, outbuildings (stores, workshops, sheds) in a share
 * of the open ground, each kept this far (m) from other buildings so the yards stay reachable. */
const COURTS = Object.freeze({ spacing: 6, fromStreet: 9, clear: 1.2, house: Object.freeze({ w: [5, 7], d: [6, 9] }), shed: Object.freeze({ w: [4, 7], d: [3.5, 6] }), sheds: Object.freeze({ lower: 0.9, middle: 0.7 }) });

/** Whether a four-cornered footprint is convex with every corner within SQUARE_TOLERANCE_DEG of
 * a right angle. */
function squareEnough(poly, tolerance = SQUARE_TOLERANCE_DEG) {
    if (poly.length !== 4) return true;
    const lo = Math.cos(((90 + tolerance) * Math.PI) / 180), hi = Math.cos(((90 - tolerance) * Math.PI) / 180);
    let sign = 0;
    for (let k = 0; k < 4; k++) {
        const a = poly[(k + 3) % 4], b = poly[k], c = poly[(k + 1) % 4];
        const u = [a[0] - b[0], a[1] - b[1]], v = [c[0] - b[0], c[1] - b[1]];
        const lu = Math.hypot(u[0], u[1]), lv = Math.hypot(v[0], v[1]);
        if (lu < 0.5 || lv < 0.5) return false;
        const cos = (u[0] * v[0] + u[1] * v[1]) / (lu * lv);
        if (cos < lo || cos > hi) return false;
        const cross = Math.sign(u[0] * v[1] - u[1] * v[0]);
        if (sign && cross !== sign) return false;
        sign = cross;
    }
    return true;
}

function centre(poly) {
    let x = 0, y = 0;
    for (const p of poly) {
        x += p[0];
        y += p[1];
    }
    return [x / poly.length, y / poly.length];
}

export function buildBuildings(T) {
    const { P, kind, input, streets, centre: C, core, wall, occupancy } = T;
    const random = T.R("buildings");
    // Wealth by ward and frontage: 1 for an ordinary plot, up to WEALTH_MAX
    const marketC = T.market?.polygon ? centroidOf(T.market.polygon) : C;
    const landmarks = [...(T.castle?.polygon ? [centroidOf(T.castle.polygon)] : []), ...(T.worship ?? []).filter((w) => w.label === "great").map((w) => centroidOf(w.yard))];
    const wealthAt = (p, rank) => {
        const dm = dist(p, marketC);
        let w = Math.max(0, 1 - dm / WEALTH_MARKET_M);
        if (rank === 0) w = Math.max(w, 0.6 * Math.max(0, 1 - dm / WEALTH_MAIN_M));
        for (const q of landmarks) w = Math.max(w, 0.7 * Math.max(0, 1 - dist(p, q) / WEALTH_LANDMARK_M));
        return 1 + (WEALTH_MAX - 1) * w;
    };
    const coreAt = (p) => (core ? (T.inCore ? T.inCore(p) : pointInPolygon(p, core)) : true);
    // Candidates by street side. A terrace (a city street inside the walls) is built as one run
    // from end to end once its turn comes, so its houses stand shoulder to shoulder; elsewhere each
    // plot takes its own turn, nearest the centre first.
    const entries = [];
    for (const street of streets) {
        for (const side of [1, -1]) {
            const run = [];
            const backs = [];
            const runId = entries.length;
            // A town's lanes are lined with cottages on small plots: the homes of labourers, smiths
            // and others who bought their food at market rather than growing it
            // (not inside a town's walls, where the lanes are built up as the streets are: V2)
            const cottages = !T.plan && kind === "town" && street.rank === 2 && !(wall && street.points.some((q) => coreAt(q)));
            // The plan-first core (V2) gives each frontage a style by its block's tier
            let style = null;
            const sub = !!wall || !!T.plan;
            const plotW = cottages ? COTTAGE_PLOT_W : P.plotW;
            // A village's plots vary: some double or triple width, for its better-off households,
            // and now and then a gap (a paddock or an empty toft)
            let wealth = 0;
            // A quay is lined with warehouses, wider than houses
            const warehouse = !!street.quay;
            const stepAt = (s) => {
                if (warehouse) return random.range(WAREHOUSE_W[0], WAREHOUSE_W[1]);
                if (T.plan) {
                    const p = pointAlong(street.points, s);
                    const q = pointAlong(street.points, s + 1);
                    const L = dist(p, q) || 1;
                    const n = [(-(q[1] - p[1]) / L) * side, ((q[0] - p[0]) / L) * side];
                    style = T.plan.styleAt([p[0] + n[0] * (street.half + 0.8), p[1] + n[1] * (street.half + 0.8)], n);
                    if (style) return random.range(style.plotW[0], style.plotW[1]);
                }
                wealth = kind === "village" ? pickWealth(random) : 0;
                const base = random.range(plotW[0], plotW[1]) * (wealth + 1);
                if (kind === "village" || cottages) return base;
                const p = pointAlong(street.points, s);
                const inside = coreAt(p);
                if (inside) return base * wealthAt(p, street.rank);
                // Suburban plots vary more (a city's and a walled town's)
                return sub ? base * random.range(SUBURB_PLOT_SPREAD[0], SUBURB_PLOT_SPREAD[1]) : base;
            };
            walk(street.points, stepAt, (p, t, s, step) => {
                if (kind === "village" && !warehouse && random.chance(VILLAGE_GAP)) return;
                // The lane round the inside of a wall (or a core's edge) is built on its inner side only
                if (street.plan === "wall" && !coreAt([p[0] - t[1] * side * (street.half + 4), p[1] + t[0] * side * (street.half + 4)])) return;
                if (sub && !warehouse && !coreAt(p) && !style?.high && random.chance(SUBURB_GAP)) return;
                const n = [-t[1] * side, t[0] * side];
                const front = [p[0] + n[0] * (street.half + 0.8), p[1] + n[1] * (street.half + 0.8)];
                const fromCentre = dist(front, C);
                const inCore = core ? (T.inCore ? T.inCore(front) : pointInPolygon(front, core)) : true;
                let priority = fromCentre + random.range(0, 30) + (street.rank === 1 ? 25 : 0);
                // Inside a planned town the larger streets' frontage is taken first, so a corner
                // block faces its main street rather than its side lane (Ken, 2026-11-16)
                if (T.plan && inCore) priority += RANK_FIRST[Math.min(2, street.rank ?? 2)];
                // Outside the walls, nearest the wall first: suburbs huddle round it rather than
                // straggling out along the roads
                if (sub && !inCore && !warehouse) {
                    // Suburbs fill from the wall and the roads outwards, only on their own ground
                    priority += 900 + 2 * (T.suburbRank?.(front) ?? distanceToRing(front, wall?.polygon ?? T.plan.ring)) + (T.suburbAt && !T.suburbAt(front) ? OUTSIDE_SUBURB_PENALTY : 0);
                }
                if (!sub && !inCore) priority += 2 * fromCentre;
                // Joined frontages inside a city's walls, and along a town's main streets inside its
                // walls or core (V2)
                const terrace = style && !warehouse ? !!style.terrace : inCore && !warehouse && !cottages && (kind === "city" || (kind === "town" && (street.rank <= 1 || !!wall)));
                const rich = style ? style.rich : inCore && !cottages ? wealthAt(front, street.rank) : 1;
                let n2 = null;
                if (T.plan) {
                    const q0 = pointAlong(street.points, s + step);
                    const q1 = pointAlong(street.points, s + step + 1);
                    const L2 = dist(q0, q1);
                    if (L2 > 0.5) n2 = [(-(q1[1] - q0[1]) / L2) * side, ((q1[0] - q0[0]) / L2) * side];
                }
                run.push({ front, t, n, n2, step, priority, rank: street.rank, terrace, runId, index: run.length, cottage: cottages, wealth, warehouse, suburb: sub && !inCore, inCore, rich, style: warehouse ? null : style });
                if (terrace && (!T.plan || style?.backs)) {
                    const back = random.range(17, 24);
                    // Never across the wall from its own frontage
                    if (T.plan && coreAt([front[0] + n[0] * (back + 6), front[1] + n[1] * (back + 6)]) !== inCore) return;
                    backs.push({ front: [front[0] + n[0] * back, front[1] + n[1] * back], t, n, step, priority: priority + 350, rank: 3, back: true, inCore });
                }
            });
            // A terrace is built a stretch at a time (a long road's frontage would otherwise take the
            // average turn of its whole length, so its end by the gate would wait for its far end)
            const terraced = run.filter((c) => c.terrace);
            for (let k0 = 0; k0 < terraced.length; ) {
                let k1 = k0 + 1;
                while (k1 < terraced.length && k1 - k0 < TERRACE_STRETCH && terraced[k1].index === terraced[k1 - 1].index + 1) k1++;
                const part = terraced.slice(k0, k1);
                entries.push({ priority: part.reduce((a, c) => a + c.priority, 0) / part.length, run: part });
                k0 = k1;
            }
            for (const c of run) if (!c.terrace) entries.push({ priority: c.priority, run: [c] });
            for (const c of backs) entries.push({ priority: c.priority, run: [c] });
        }
    }
    const lattice = T.plan ? interiorLattice() : [];
    // Back houses round courts inside the walls: after every frontage and back house inside, and
    // before the suburbs, so they are built only where the walls are still short of their people
    for (const q of lattice) entries.push({ priority: q.priority, run: [{ ...q, court: true }] });
    entries.sort((a, b) => a.priority - b.priority);
    const candidates = entries.flatMap((entry) => entry.run);
    const target = Math.round(input.population / P.perBuilding);
    // A cavern's dwellings of the rock are made first, and count towards the people housed
    const buildings = T.buildings ? [...T.buildings] : [];
    const plots = [];
    // Each plot's house (its index among the buildings)
    const plotHouses = [];
    const quad = (o, t, n, w, d) => [o, [o[0] + t[0] * w, o[1] + t[1] * w], [o[0] + t[0] * w + n[0] * d, o[1] + t[1] * w + n[1] * d], [o[0] + n[0] * d, o[1] + n[1] * d]];
    // A candidate on a curved street (the plan-first core) has its sides square to the street at
    // each end, so the plots along the inside of a bend do not overlap: wedges, not rectangles
    const normalAlong = (c, a) => {
        if (!c.n2) return c.n;
        const f = Math.max(0, Math.min(1.5, a / (c.step || 1)));
        const v = [c.n[0] + (c.n2[0] - c.n[0]) * f, c.n[1] + (c.n2[1] - c.n[1]) * f];
        const L = Math.hypot(v[0], v[1]) || 1;
        return [v[0] / L, v[1] / L];
    };
    const quadC = (c, o, w, d) => {
        if (!c.n2) return quad(o, c.t, c.n, w, d);
        const a = (o[0] - c.front[0]) * c.t[0] + (o[1] - c.front[1]) * c.t[1];
        // How far behind the frontage the origin stands (a set-back house, a rear range)
        const back = (o[0] - c.front[0]) * c.n[0] + (o[1] - c.front[1]) * c.n[1];
        const n0 = normalAlong(c, a);
        const n1 = normalAlong(c, a + w);
        const f0 = [c.front[0] + c.t[0] * a + n0[0] * back, c.front[1] + c.t[1] * a + n0[1] * back];
        const f1 = [c.front[0] + c.t[0] * (a + w) + n1[0] * back, c.front[1] + c.t[1] * (a + w) + n1[1] * back];
        return [f0, f1, [f1[0] + n1[0] * d, f1[1] + n1[1] * d], [f0[0] + n0[0] * d, f0[1] + n0[1] * d]];
    };
    const insetC = (c, o, w, d, by, start = by, end = by) => quadC(c, [o[0] + c.t[0] * start + c.n[0] * by, o[1] + c.t[1] * start + c.n[1] * by], w - start - end, d - 2 * by);
    // The last house built in each terrace run, so the next one may share its party wall
    const lastInRun = new Map();
    // Placed buildings by 20 m square, for the exact test the occupancy grid is too coarse to make
    const placed = new Map();
    const bucketKey = (p) => `${Math.floor(p[0] / 20)},${Math.floor(p[1] / 20)}`;
    const clashes = (poly) => {
        const [cx, cy] = [(poly[0][0] + poly[2][0]) / 2, (poly[0][1] + poly[2][1]) / 2];
        for (let dj = -1; dj <= 1; dj++) {
            for (let di = -1; di <= 1; di++) {
                for (const other of placed.get(`${Math.floor(cx / 20) + di},${Math.floor(cy / 20) + dj}`) ?? []) if (convexOverlap(poly, other, T.plan ? PLAN_SLACK : PARTY_WALL_SLACK)) return true;
            }
        }
        return false;
    };
    // Street centre lines by 40 m square, so no house reaches into a street the grid let it touch
    const streetSegments = new Map();
    for (const street of streets) {
        if (street.market) continue;
        for (let k = 0; k + 1 < street.points.length; k++) {
            const a = street.points[k];
            const b = street.points[k + 1];
            const steps = Math.max(1, Math.ceil(dist(a, b) / 40));
            const keys = new Set();
            for (let u = 0; u <= steps; u++) keys.add(`${Math.floor((a[0] + ((b[0] - a[0]) * u) / steps) / 40)},${Math.floor((a[1] + ((b[1] - a[1]) * u) / steps) / 40)}`);
            for (const key of keys) {
                if (!streetSegments.has(key)) streetSegments.set(key, []);
                streetSegments.get(key).push({ a, b, half: street.half });
            }
        }
    }
    // The river's banks are kept the same exact way (the occupancy grid's water is only as fine as the terrain grid)
    const line = T.river.line;
    for (let k = 0; k + 1 < line.length; k++) {
        const a = line[k];
        const b = line[k + 1];
        // Keyed all along its length (a long straight reach of a brook spans several squares)
        const steps = Math.max(1, Math.ceil(dist(a, b) / 40));
        const keys = new Set();
        for (let u = 0; u <= steps; u++) keys.add(`${Math.floor((a[0] + ((b[0] - a[0]) * u) / steps) / 40)},${Math.floor((a[1] + ((b[1] - a[1]) * u) / steps) / 40)}`);
        for (const key of keys) {
            if (!streetSegments.has(key)) streetSegments.set(key, []);
            streetSegments.get(key).push({ a, b, half: T.river.width / 2 + 1.2 });
        }
    }
    const onStreet = (poly) => {
        // Nothing stands in the sea or a lake, tested exactly at its corners and middle
        if (T.shore && (poly.some((p) => T.seaAt(p)) || T.seaAt([(poly[0][0] + poly[2][0]) / 2, (poly[0][1] + poly[2][1]) / 2]))) return true;
        const c = [(poly[0][0] + poly[2][0]) / 2, (poly[0][1] + poly[2][1]) / 2];
        const probes = [c, ...poly.map((p) => [p[0] + (c[0] - p[0]) * 0.08, p[1] + (c[1] - p[1]) * 0.08])];
        const i = Math.floor(c[0] / 40);
        const j = Math.floor(c[1] / 40);
        for (let dj = -1; dj <= 1; dj++) {
            for (let di = -1; di <= 1; di++) {
                for (const segment of streetSegments.get(`${i + di},${j + dj}`) ?? []) if (probes.some((p) => segmentDistance(p, segment.a, segment.b) < segment.half - 0.2)) return true;
            }
        }
        return false;
    };
    const record = (poly) => {
        const key = bucketKey([(poly[0][0] + poly[2][0]) / 2, (poly[0][1] + poly[2][1]) / 2]);
        if (!placed.has(key)) placed.set(key, []);
        placed.get(key).push(poly);
    };
    /** Metres back from a candidate's frontage (along its normal) before a street, water, the wall
     * or reserved ground, up to FREE_RUN_MAX. */
    const freeRun = (c) => {
        for (let d = 1; d < FREE_RUN_MAX; d += 1) {
            const p = [c.front[0] + c.n[0] * d, c.front[1] + c.n[1] * d];
            const v = occupancy.at(p);
            if (v === STREET || v === WATER || v === RESERVED || v < 0) return d;
            if (wall && !pointInPolygon(p, (T.outerWall && !c.inCore ? T.outerWall : wall).polygon) && c.inCore) return d;
        }
        return FREE_RUN_MAX;
    };
    // Inns and halls (Ken, 2026-11-16): their share of the frontage by the market and the gates is
    // taken as the houses are built, so they stand where travellers and traders come
    const worksLeft = { inn: 0, hall: 0 };
    if (T.plan) {
        const inside = Math.max(1, (T.plan.insideHouses ?? 0) * (P.perBuilding ?? 6));
        worksLeft.inn = Math.max(1, Math.round(inside / WORKS.inn.people));
        worksLeft.hall = kind === "city" ? Math.max(1, Math.round(inside / WORKS.hall.people)) : 0;
    }
    const gatePoints = (T.plan?.gates ?? []).map((g) => g.p);
    const marketPts = T.market?.polygon ?? [];
    const nearMarket = (p, m) => marketPts.length > 2 && (pointInPolygon(p, marketPts) || marketPts.some((q, k) => segmentDistance(p, q, marketPts[(k + 1) % marketPts.length]) < m));
    const workType = (c) => {
        if (!T.plan || !c.inCore || c.back || c.warehouse || c.rank > 1 || c.style?.tier === "upper") return null;
        if (worksLeft.hall > 0 && nearMarket(c.front, WORKS.hall.nearMarket)) return "hall";
        if (worksLeft.inn > 0 && (gatePoints.some((g) => dist(g, c.front) < WORKS.inn.nearGate) || (c.rank === 0 && !nearMarket(c.front, WORKS.inn.offMarket) && nearMarket(c.front, WORKS.inn.nearMarket)))) return "inn";
        return null;
    };
    const placeWork = (c, type) => {
        const W = WORKS[type];
        const run = freeRun(c);
        const d = Math.min(random.range(W.d[0], W.d[1]), run - 1);
        if (d < MIN_HOUSE_DEPTH) return false;
        let placed = null;
        for (let w = random.range(W.w[0], W.w[1]); w >= Math.max(4, W.w[0] * 0.6); w -= 2) {
            if (!occupancy.free(insetC(c, c.front, w, d, 0.3))) continue;
            const poly = quadC(c, c.front, w, d);
            if (!squareEnough(poly) || clashes(poly) || onStreet(poly)) continue;
            if (wall && pointInPolygon(poly[2], wall.polygon) !== pointInPolygon(c.front, wall.polygon)) continue;
            placed = { poly, w };
            break;
        }
        if (!placed) return false;
        record(placed.poly);
        occupancy.stampPolygon(insetC(c, c.front, placed.w, d, 0.1), BUILDING);
        const index = buildings.length;
        buildings.push({ poly: placed.poly, kind: type, rank: c.rank, ...(c.style?.tier ? { tier: c.style.tier } : {}) });
        if (type in worksLeft) worksLeft[type]--;
        // An inn's stable range behind it, round its yard
        if (type === "inn" && run - d > 14) {
            const sw = random.range(5, 7), sl = Math.min(random.range(10, 16), run - d - 4);
            const r0 = [c.front[0] + c.n[0] * (d + 4) + c.t[0] * 0.2, c.front[1] + c.n[1] * (d + 4) + c.t[1] * 0.2];
            const st = quad(r0, c.t, c.n, sw, sl);
            const test = quad([r0[0] + c.t[0] * 0.3 + c.n[0] * 0.3, r0[1] + c.t[1] * 0.3 + c.n[1] * 0.3], c.t, c.n, sw - 0.6, sl - 0.6);
            if (squareEnough(st) && occupancy.free(test, false, true) && !clashes(st) && !onStreet(st)) {
                record(st);
                occupancy.stampPolygon(test, BUILDING);
                buildings.push({ poly: st, kind: "stable", of: index });
            }
        }
        return true;
    };
    let houses = 0;
    // A place whose chamber is to hold only its share of the houses (CAVE.PLANS) builds the rest
    // along its galleries first, and fills the chamber further only if they are full
    let inCoreBuilt = 0;
    const deferred = [];
    const queue = (function* () {
        for (const c of candidates) yield [c, true];
        for (const c of deferred) yield [c, false];
    })();
    for (const [c, first] of queue) {
        if (houses >= target - (T.housesBefore ?? 0) || c.priority > 1e8) break;
        if (first && T.coreCap != null && c.inCore && inCoreBuilt >= T.coreCap) {
            deferred.push(c);
            continue;
        }
        const plotWidth = c.step - 0.3;
        if (c.warehouse) {
            // A warehouse fills its frontage to a set depth, with no garden behind
            const depthW = random.range(WAREHOUSE_DEPTH[0], WAREHOUSE_DEPTH[1]);
            const poly = insetC(c, c.front, plotWidth, depthW, 0.3);
            if (!occupancy.free(poly) || clashes(poly) || onStreet(poly)) continue;
            record(poly);
            occupancy.stampPolygon(poly, BUILDING);
            buildings.push({ poly, kind: "warehouse" });
            continue;
        }
        // An inn or a hall in its share of the frontage by the market and the gates
        const work = workType(c);
        if (work && random.chance(work === "hall" ? 0.5 : 0.3) && placeWork(c, work)) continue;
        // Terraces: one depth along the street, varying slowly, and no gaps between neighbours
        const depthB = c.style?.depth ?? (c.cottage ? COTTAGE_DEPTH : P.depthB);
        let depthHere = c.terrace ? depthB[0] + (depthB[1] - depthB[0]) * T.noise.value(c.front[0] / TERRACE_DEPTH_WAVE, c.front[1] / TERRACE_DEPTH_WAVE) : random.range(depthB[0], depthB[1]);
        // The wealthy build deeper as well as wider
        if (c.rich > 1) depthHere *= 1 + 0.35 * (c.rich - 1);
        // Some suburban houses stand eaves-on to the street: wide and shallow
        const eavesOn = c.suburb && !c.cottage && !c.style?.semi && !c.style?.detached && random.chance(SUBURB_EAVES_ON);
        if (eavesOn) depthHere = random.range(EAVES_ON_DEPTH[0], EAVES_ON_DEPTH[1]);
        let width = c.style?.semi ? plotWidth * random.range(0.72, 0.86) : c.style?.detached ? plotWidth * random.range(c.style.detached[0], c.style.detached[1]) : c.terrace ? c.step : P.widthB ? Math.min(plotWidth - 2, random.range(P.widthB[0], P.widthB[1]) * WEALTH_WIDTH[c.wealth]) : c.suburb ? plotWidth - random.range(0.5, eavesOn ? 1.5 : 3) : plotWidth - (random.chance(0.55) ? 0 : random.range(0.3, 1.4));
        const backAt = [c.front[0] + c.n[0] * depthHere, c.front[1] + c.n[1] * depthHere];
        if (wall && pointInPolygon(c.front, wall.polygon) !== pointInPolygon(backAt, wall.polygon)) continue;
        if (T.outerWall && pointInPolygon(c.front, T.outerWall.polygon) !== pointInPolygon(backAt, T.outerWall.polygon)) continue;
        // A city's suburban houses have yards and gardens behind them, as those within the walls do not
        // Inside a town's walls a plot reaches only towards its block's middle, so the next street's
        // frontage stays free (V2)
        const plotDepth = c.style?.plotDepth ? c.style.plotDepth : c.cottage ? COTTAGE_PLOT_DEPTH : c.suburb ? SUBURB_PLOT_DEPTH : wall && c.inCore && P.plotDepth[1] > 0 ? WALLED_PLOT_DEPTH : P.plotDepth;
        let depth = plotDepth[1] > 0 ? random.range(plotDepth[0], plotDepth[1]) : depthHere;
        // Inside the walls, a plot reaches at most halfway to the next street or ground behind it,
        // so the blocks are shared between their frontages; a house no deeper than the run allows
        if (c.inCore && kind !== "village") {
            const run = freeRun(c);
            if (plotDepth[1] > 0) depth = Math.min(depth, Math.max(depthHere, run / 2));
            if (run < depthHere + 1) depthHere = Math.max(MIN_HOUSE_DEPTH, run - 1);
        }
        // A house on a garden plot (between a great city's rings) may take the end of a neighbour's
        // garden at a corner: gardens give way to houses
        const overGardens = !!c.style?.plotDepth;
        while (depth >= depthHere + 3 && !occupancy.free(insetC(c, c.front, plotWidth, depth, 0.8))) depth -= 4;
        if (!occupancy.free(insetC(c, c.front, plotWidth, depth, 0.8))) {
            depth = depthHere;
            if (!occupancy.free(insetC(c, c.front, plotWidth, depthHere, 0.6), false, overGardens)) {
                // A corner or junction: a narrower house at the near end of the plot, inside the
                // walls, so the frontage is not left open
                if (!c.inCore || c.warehouse) continue;
                width = Math.max(3.5, plotWidth * NARROW_SHARE);
                depthHere = Math.max(depthB[0], depthHere * 0.8);
                depth = depthHere;
                if (!occupancy.free(insetC(c, c.front, width, depthHere, 0.4))) continue;
            }
        }
        // A terrace house shares a party wall with the one before it in the run: that side is tested
        // a full occupancy cell in, so the cell the neighbour's wall marked does not block it
        // A pair of houses (semi-detached): the first stands at its plot's far end, the second at its
        // near end, so the two share a party wall across the plots' line
        const pairSecond = !!c.style?.semi && c.index % 2 === 1;
        const sharesWall = (c.terrace && lastInRun.get(c.runId) === c.index - 1) || (pairSecond && lastInRun.get(c.runId) === c.index - 1);
        if (!occupancy.free(insetC(c, c.front, width, depthHere, 0.3, sharesWall ? occupancy.step : 0.3, 0.3), false, overGardens)) continue;
        const offset = c.style?.semi ? (pairSecond ? 0 : plotWidth - width) : P.widthB || c.style?.detached ? random.range(1, Math.max(1, plotWidth - width - 1)) : 0;
        // A detached house may stand back from the street behind a front garden
        const setback = c.style?.setback ? Math.min(random.range(c.style.setback[0], c.style.setback[1]), Math.max(0, depth - depthHere - 2)) : 0;
        const origin = [c.front[0] + c.t[0] * offset + c.n[0] * setback, c.front[1] + c.t[1] * offset + c.n[1] * setback];
        const poly = quadC(c, origin, width, depthHere);
        if ((T.plan && !squareEnough(poly)) || clashes(poly) || onStreet(poly)) continue;
        // A back house round a court keeps a passage round it, so the court is reached
        if (c.court && !occupancy.free(quad([origin[0] - c.t[0] * COURTS.clear - c.n[0] * COURTS.clear, origin[1] - c.t[1] * COURTS.clear - c.n[1] * COURTS.clear], c.t, c.n, width + 2 * COURTS.clear, depthHere + 2 * COURTS.clear), false, true)) continue;
        record(poly);
        if (plotDepth[1] > 0) {
            const plot = quadC(c, c.front, plotWidth, depth);
            occupancy.stampPolygon(plot, PLOT);
            plots.push(plot);
            plotHouses.push(buildings.length);
        }
        occupancy.stampPolygon(c.terrace ? insetC(c, origin, width, depthHere, 0.1) : poly, BUILDING);
        const houseIndex = buildings.length;
        buildings.push({ poly, kind: "house", rank: c.rank, back: !!c.back, terrace: !!c.terrace, plotDepth: depth, ...(c.style?.tier ? { tier: c.style.tier } : {}) });
        if (c.terrace || c.style?.semi) lastInRun.set(c.runId, c.index);
        houses++;
        if (c.inCore) inCoreBuilt++;
        // A rear range along one side of the plot, behind a house inside the walls: a workshop,
        // a kitchen, a store, so the blocks fill towards their middles in L and T shapes
        if (c.inCore && !c.back && !c.cottage && kind !== "village") {
            const share = c.style ? c.style.ranges : RANGE_SHARE[0] + (RANGE_SHARE[1] - RANGE_SHARE[0]) * Math.min(1, (c.rich - 1) / (WEALTH_MAX - 1));
            if (random.chance(share)) {
                // In the plan-first core a range is a compact wing (an L), not a long strip
                const rw = T.plan ? Math.min(width * 0.7, random.range(4.5, 7.5)) : Math.min(width * 0.5, random.range(RANGE_WIDTH[0], RANGE_WIDTH[1]));
                const rl = (T.plan ? random.range(6, 13) : random.range(RANGE_LENGTH[0], RANGE_LENGTH[1])) * c.rich;
                const left = random.chance(0.5);
                const along = left ? 0 : width - rw;
                const r0 = [origin[0] + c.t[0] * along + c.n[0] * depthHere, origin[1] + c.t[1] * along + c.n[1] * depthHere];
                const range = quad(r0, c.t, c.n, rw, rl);
                // Tested a cell clear of the house's back, which it shares
                const test = quad([r0[0] + c.n[0] * occupancy.step + c.t[0] * 0.3, r0[1] + c.n[1] * occupancy.step + c.t[1] * 0.3], c.t, c.n, rw - 0.6, rl - occupancy.step - 0.3);
                if (rl > 3 && squareEnough(range) && occupancy.free(test, false, true) && !clashes(range) && !onStreet(range) && !(wall && !pointInPolygon(range[2], (T.outerWall ?? wall).polygon) !== !pointInPolygon(c.front, (T.outerWall ?? wall).polygon))) {
                    record(range);
                    occupancy.stampPolygon(test, BUILDING);
                    buildings.push({ poly: range, kind: "range", house: houseIndex });
                }
            }
            // A back building at the plot's far end, across its width: the yard between
            if (T.plan && plotDepth[1] > 0 && depth - depthHere >= BACK_BUILDING.freeM + (c.style?.detached ? 6 : 0) && random.chance(BACK_BUILDING.share)) {
                const bd = random.range(BACK_BUILDING.d[0], BACK_BUILDING.d[1]);
                const bw = Math.min(plotWidth - 0.6, random.range(BACK_BUILDING.w[0], BACK_BUILDING.w[1]));
                const along = random.range(0.3, Math.max(0.3, plotWidth - bw - 0.3));
                const b0 = [c.front[0] + c.n[0] * (depth - bd - 0.4) + c.t[0] * along, c.front[1] + c.n[1] * (depth - bd - 0.4) + c.t[1] * along];
                const back = quad(b0, c.t, c.n, bw, bd);
                const test = quad([b0[0] + c.t[0] * 0.3 + c.n[0] * 0.3, b0[1] + c.t[1] * 0.3 + c.n[1] * 0.3], c.t, c.n, bw - 0.6, bd - 0.6);
                if (squareEnough(back) && occupancy.free(test, false, true) && !clashes(back) && !onStreet(back) && !(wall && pointInPolygon(back[2], wall.polygon) !== pointInPolygon(c.front, wall.polygon))) {
                    record(back);
                    occupancy.stampPolygon(test, BUILDING);
                    buildings.push({ poly: back, kind: "range", house: houseIndex, back: true });
                }
            }
        }
        // A barn or byre behind some village houses, inside the croft
        const barns = kind === "village" && depth > depthHere + 20 ? (random.chance(0.5) ? 1 : 0) + (c.wealth > 0 ? 1 : 0) : 0;
        for (let b = 0; b < barns; b++) {
            const bw = random.range(6, 8);
            const bl = random.range(10, 15);
            const along = b === 0 ? random.range(1, Math.max(1, plotWidth / (barns || 1) - bl - 1)) : plotWidth / 2 + random.range(1, Math.max(1, plotWidth / 2 - bl - 1));
            const back = depthHere + random.range(5, 10);
            const q0 = [c.front[0] + c.n[0] * back + c.t[0] * along, c.front[1] + c.n[1] * back + c.t[1] * along];
            const barn = quadC(c, q0, bl, bw);
            if (!clashes(barn)) {
                record(barn);
                buildings.push({ poly: barn, kind: "barn" });
            }
        }
    }
    if (T.plan) buildWorks();
    if (T.plan) fillGaps();
    if (T.plan) fillInteriors();
    T.plots = plots;
    T.plotHouses = plotHouses;

    /**
     * Points inside the blocks of the plan-first core, away from the streets, each facing its
     * nearest street (n points away from it), with its block's tier. Read before any house is
     * built, so a point's distance from the streets is the plan's own.
     */
    function interiorLattice() {
        const out = [];
        const R = T.plan.raster;
        const box = R.box;
        const dirs = Array.from({ length: 16 }, (_, k) => [Math.cos((k * Math.PI) / 8), Math.sin((k * Math.PI) / 8)]);
        for (let y = box[1] + COURTS.spacing / 2; y < box[3]; y += COURTS.spacing) {
            for (let x = box[0] + COURTS.spacing / 2; x < box[2]; x += COURTS.spacing) {
                const p = [x + random.range(-1.2, 1.2), y + random.range(-1.2, 1.2)];
                if (!coreAt(p) || occupancy.at(p) !== FREE) continue;
                let best = null;
                for (const d of dirs) {
                    for (let r = 1; r <= COURTS.fromStreet + 30; r += 1) {
                        const v = occupancy.at([p[0] + d[0] * r, p[1] + d[1] * r]);
                        if (v === STREET || v === WATER || v === RESERVED || v < 0) {
                            if (!best || r < best.r) best = { r, d };
                            break;
                        }
                    }
                }
                if (!best || best.r < COURTS.fromStreet) continue;
                if (wall && !pointInPolygon(p, wall.polygon)) continue;
                const n = [-best.d[0], -best.d[1]];
                const style = T.plan.styleAt(p, null);
                if (!style || style.tier === "upper") continue;
                const t = [-n[1], n[0]];
                out.push({ front: p, t, n, n2: null, step: 7, priority: 640 + 0.5 * dist(p, C) + random.range(0, 20), rank: 3, terrace: false, runId: -1, index: 0, back: true, inCore: true, rich: 1, tier: style.tier, style: { tier: style.tier, plotW: COURTS.house.w, depth: COURTS.house.d, plotDepth: [0, 0], terrace: false, rich: 1, ranges: 0 } });
            }
        }
        return out;
    }

    /** Outbuildings in the open ground inside the blocks, once the people are housed. */
    function fillInteriors() {
        for (const q of lattice) {
            if (!random.chance(COURTS.sheds[q.tier] ?? 0)) continue;
            if (occupancy.at(q.front) !== FREE && occupancy.at(q.front) !== PLOT) continue;
            const w = random.range(COURTS.shed.w[0], COURTS.shed.w[1]), d = random.range(COURTS.shed.d[0], COURTS.shed.d[1]);
            const o = [q.front[0] - q.t[0] * w / 2, q.front[1] - q.t[1] * w / 2];
            const poly = quad(o, q.t, q.n, w, d);
            const room = quad([o[0] - q.t[0] * COURTS.clear - q.n[0] * COURTS.clear, o[1] - q.t[1] * COURTS.clear - q.n[1] * COURTS.clear], q.t, q.n, w + 2 * COURTS.clear, d + 2 * COURTS.clear);
            if (!occupancy.free(room, false, true) || clashes(poly) || onStreet(poly)) continue;
            record(poly);
            occupancy.stampPolygon(poly, BUILDING);
            buildings.push({ poly, kind: "shed", tier: q.tier });
        }
    }

    /**
     * Buildings that are not homes (Ken, 2026-11-16), once the people are housed: the frontage
     * inside the walls (or a town's core) still open is built with inns by the market and the
     * gates, halls by the market, and workshops, stores and stables elsewhere. Upper-tier frontage
     * is left to its gardens. Each stands as a house would, its depth what the block allows.
     */
    function buildWorks() {
        const order = candidates.filter((c) => c.inCore && !c.warehouse && !c.back && c.priority < 1e8 && c.style?.tier !== "upper").sort((a, b) => a.priority - b.priority);
        for (const c of order) {
            if (occupancy.at(c.front) !== FREE) continue;
            placeWork(c, workType(c) ?? (c.rank === 2 && random.chance(0.25) ? "stable" : "workshop"));
        }
    }

    /**
     * The plan-first core's last pass: short stretches of frontage left open between two buildings
     * or at a corner (where a house's depth along one street blocks the next, or a plot's rectangle
     * cannot turn) are built over by a wing of the house beside them, cut to the ground that is free:
     * a trapezoid, or at a corner a house whose back follows the street round it (two sides on
     * streets), so corners close and rows run on.
     */
    function fillGaps() {
        const houseAt = new Map();
        buildings.forEach((b, k) => {
            if (b.kind !== "house") return;
            const c = centre(b.poly);
            const key = `${Math.floor(c[0] / 20)},${Math.floor(c[1] / 20)}`;
            if (!houseAt.has(key)) houseAt.set(key, []);
            houseAt.get(key).push(k);
        });
        const nearestHouse = (p) => {
            let best = -1, bd = Infinity;
            const i = Math.floor(p[0] / 20), j = Math.floor(p[1] / 20);
            for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (const k of houseAt.get(`${i + di},${j + dj}`) ?? []) {
                const d = dist(centre(buildings[k].poly), p);
                if (d < bd) [bd, best] = [d, k];
            }
            return best;
        };
        const runFrom = (p, n, max) => {
            for (let d = 0.5; d < max; d += 0.5) {
                const q = [p[0] + n[0] * d, p[1] + n[1] * d];
                const v = occupancy.at(q);
                if (v === STREET || v === WATER || v === RESERVED || v === BUILDING || v < 0 || !coreAt(q)) return d;
            }
            return max;
        };
        for (const street of streets) {
            if (street.market || street.suburb || street.road) continue;
            if (!street.points.some((q) => coreAt(q))) continue;
            const L = street.points.reduce((a, q, k) => (k ? a + dist(q, street.points[k - 1]) : 0), 0);
            for (const side of [1, -1]) {
                const fronts = [];
                for (let s = 0; s <= L; s += 1) {
                    const p = pointAlong(street.points, s);
                    const q = pointAlong(street.points, Math.min(L, s + 1));
                    const r = pointAlong(street.points, Math.max(0, s - 1));
                    const len = dist(r, q) || 1;
                    const n = [(-(q[1] - r[1]) / len) * side, ((q[0] - r[0]) / len) * side];
                    const f = [p[0] + n[0] * (street.half + 0.8), p[1] + n[1] * (street.half + 0.8)];
                    fronts.push({ s, f, n, v: occupancy.at(f), core: coreAt(f) });
                }
                for (let k = 0; k < fronts.length; k++) {
                    if (fronts[k].v !== FREE && fronts[k].v !== PLOT) continue;
                    if (!fronts[k].core) continue;
                    let m = k;
                    while (m + 1 < fronts.length && (fronts[m + 1].v === FREE || fronts[m + 1].v === PLOT) && fronts[m + 1].core) m++;
                    const run = m - k;
                    const before = fronts[k - 1]?.v, after = fronts[m + 1]?.v;
                    k = m;
                    // A gap between buildings, or between a building and the street round the corner
                    const closed = (v) => v === BUILDING || v === STREET;
                    // (a short side between two streets is closed too, as a wing of the house round its corner)
                    if (run < GAP_MIN || run > GAP_MAX || !(closed(before) && closed(after))) continue;
                    const a = fronts[k - run], b = fronts[m];
                    const dA = Math.min(runFrom(a.f, a.n, GAP_DEPTH), GAP_DEPTH) - 0.6;
                    const dB = Math.min(runFrom(b.f, b.n, GAP_DEPTH), GAP_DEPTH) - 0.6;
                    // A trapezoid only: both ends deep enough, and not much deeper at one end than
                    // the other (no triangles, Ken, 2026-11-16)
                    const A = a.f, B = b.f;
                    let poly;
                    if (Math.min(dA, dB) < GAP_END_MIN) {
                        // At a corner, where the street round it closes the shallow end: a house
                        // whose back follows that street, so two of its sides front streets (a
                        // triangle or a splayed corner, Ken, 2026-11-16), if it is big enough to live in
                        const shallowA = dA < dB;
                        if ((shallowA ? before : after) !== STREET) continue;
                        const deep = Math.min(Math.max(dA, dB), CORNER.deep[1]);
                        if (deep < CORNER.deep[0] || dist(A, B) < CORNER.front) continue;
                        const backs = [];
                        let onStreetBack = 0;
                        for (let i = k - run; i <= m; i++) {
                            const f = fronts[i];
                            const r = runFrom(f.f, f.n, deep + 1) - 0.6;
                            const d = Math.max(0, Math.min(r, deep));
                            if (r < deep) onStreetBack++;
                            backs.push([f.f[0] + f.n[0] * d, f.f[1] + f.n[1] * d]);
                        }
                        // The back must follow the other street over a good part of the run
                        if (onStreetBack < (run + 1) * CORNER.alongShare) continue;
                        // The outline: the front, then the back from B's end round to A's, simplified
                        poly = [A, ...simplify([B, ...backs.reverse()], CORNER.simplify)];
                        // (a back point that has come back to the front itself is dropped)
                        poly = poly.filter((q, i) => i === 0 || dist(q, poly[i - 1]) > 0.3);
                        if (poly.length < 3 || Math.abs(polygonArea(poly)) < CORNER.area) continue;
                    } else {
                        // (a gap much deeper at one end is built to the shallower end's depth)
                        const even = Math.min(dA, dB) >= Math.max(dA, dB) * GAP_END_SHARE;
                        const da = even ? dA : Math.min(dA, dB), db = even ? dB : Math.min(dA, dB);
                        poly = [A, B, [B[0] + b.n[0] * db, B[1] + b.n[1] * db], [A[0] + a.n[0] * da, A[1] + a.n[1] * da]];
                    }
                    const c = centre(poly);
                    const test = poly.map((q) => [q[0] + (c[0] - q[0]) * 0.12, q[1] + (c[1] - q[1]) * 0.12]);
                    if (!squareEnough(poly, GAP_TOLERANCE_DEG) || !occupancy.free(test, false, true) || clashes(poly) || onStreet(poly)) continue;
                    const house = nearestHouse(c);
                    if (house < 0 || dist(centre(buildings[house].poly), c) > GAP_HOUSE_M) continue;
                    record(poly);
                    occupancy.stampPolygon(test, BUILDING);
                    buildings.push({ poly, kind: "range", house, fill: true });
                }
            }
        }
    }
    T.buildings = buildings;
    T.target = target;
    // Suburban lanes no house was built along are not drawn: they were only ways the suburb might
    // have grown
    const fronts = new Map();
    for (const b of buildings) {
        const c = [(b.poly[0][0] + b.poly[2][0]) / 2, (b.poly[0][1] + b.poly[2][1]) / 2];
        const key = `${Math.floor(c[0] / 30)},${Math.floor(c[1] / 30)}`;
        if (!fronts.has(key)) fronts.set(key, []);
        fronts.get(key).push(c);
    }
    const linedAt = (street, p) => {
        const i = Math.floor(p[0] / 30);
        const j = Math.floor(p[1] / 30);
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if ((fronts.get(`${i + di},${j + dj}`) ?? []).some((c) => dist(c, p) < street.half + 14)) return true;
        return false;
    };
    // and a lane grown out from another way (V2's faubourgs) ends where its houses do
    const kept = [];
    for (const street of T.streets) {
        if (!street.suburb) {
            kept.push(street);
            continue;
        }
        const lined = street.points.map((p) => linedAt(street, p));
        if (!lined.some(Boolean)) continue;
        if (street.grown && !lined[lined.length - 1]) {
            const last = lined.lastIndexOf(true);
            const pts = street.points.slice(0, Math.min(street.points.length, last + 2));
            if (pts.length >= 2) kept.push({ ...street, points: pts, close: true });
            continue;
        }
        kept.push(street);
    }
    T.streets = kept;
}

/** The point `s` metres along a polyline (its end beyond its length). */
function pointAlong(points, s) {
    for (let k = 0; k + 1 < points.length; k++) {
        const L = dist(points[k], points[k + 1]);
        if (s <= L) return [points[k][0] + ((points[k + 1][0] - points[k][0]) * s) / (L || 1), points[k][1] + ((points[k + 1][1] - points[k][1]) * s) / (L || 1)];
        s -= L;
    }
    return points[points.length - 1];
}

function centroidOf(poly) {
    let x = 0, y = 0;
    for (const p of poly) { x += p[0]; y += p[1]; }
    return [x / poly.length, y / poly.length];
}

/** Separating-axis test for two convex polygons, each allowed to overlap the other by `slack` metres. */
function convexOverlap(a, b, slack) {
    for (const poly of [a, b]) {
        for (let k = 0; k < poly.length; k++) {
            const p = poly[k];
            const q = poly[(k + 1) % poly.length];
            const length = dist(p, q) || 1;
            const axis = [-(q[1] - p[1]) / length, (q[0] - p[0]) / length];
            let aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity;
            for (const v of a) {
                const d = v[0] * axis[0] + v[1] * axis[1];
                if (d < aMin) aMin = d;
                if (d > aMax) aMax = d;
            }
            for (const v of b) {
                const d = v[0] * axis[0] + v[1] * axis[1];
                if (d < bMin) bMin = d;
                if (d > bMax) bMax = d;
            }
            if (aMax - slack <= bMin || bMax - slack <= aMin) return false;
        }
    }
    return true;
}

function pickWealth(random) {
    const roll = random.next();
    if (roll < WEALTH_SHARES[2]) return 2;
    if (roll < WEALTH_SHARES[2] + WEALTH_SHARES[1]) return 1;
    return 0;
}

/** Distance from a point to a closed ring of points. */
function distanceToRing(p, ring) {
    let best = Infinity;
    for (let k = 0; k < ring.length; k++) best = Math.min(best, segmentDistance(p, ring[k], ring[(k + 1) % ring.length]));
    return best;
}
