// The fields: land use by budget, and the open fields' furlongs.
//
// The ground round the place is split first along its roads into sectors, and down the middle of
// each sector a field track runs out from the edge of the built-up area. The frame is cut along
// the roads and tracks into parcels, and each parcel split by straight lines into near-rectangles
// along its long axis (V4): small near the place, larger further out. Strips run the length of each field; a share run across it, as they did where the
// ground or the order of clearance turned them.
//
// Land use by budget: the arable the people need (more where the climate grows less), nearest the
// place first on gentle ground; meadow along the water; common pasture next; wood or waste beyond.
import { BUILDING, PLOT, RESERVED } from "./Occupancy.js";
import { bearingOfVector, centroid, chaikin, clipLinePolygon, compass, dist, lerp, poisson, pointInPolygon, polygonArea, segmentCross, segmentDistance, segmentIndex, shrink, splitByPolyline } from "../Geometry.js";

/** Field seed spacing: a share of the plan's spacing, from FIELD_NEAR times it by the place to
 * (FIELD_NEAR + FIELD_GROWTH) times it FIELD_GROWTH_M out and beyond, varied by noise. */
const FIELD_SPACING_SHARE = 0.6;
const FIELD_NEAR = 0.6;
const FIELD_GROWTH = 0.9;
const FIELD_GROWTH_M = 2000;
/** Field tracks: step (m); tracks off the roads
 * leave every so often (m) and run so far (m). Each step turns up to TRACK_TURN degrees and is
 * drawn back by TRACK_PULL of its drift from its first heading. */
const TRACK_STEP = 25;
const TRACK_TURN = 14;
const TRACK_PULL = 0.06;
const TRACK_BRANCH = [650, 1100];
const TRACK_LENGTH = [350, 1200];
/** A field's size: this many times the square of its spacing (V4). */
const FIELD_AREA = 2.8;
/** A piece is cut this far along its extent (a share), across its long axis or along it, whichever
 * leaves its pieces nearer this long over short; each cut turned up to FIELD_TURN off square. */
const FIELD_CUT = [0.38, 0.62];
const FIELD_ASPECT = 1.85;
const FIELD_TURN = 0.07;
/** How much a cut's choice weighs squareness against a furlong's shape. */
const FIELD_SQUARE_WEIGHT = 4;
/** A track ending among the fields runs on, straight, up to this far (m) to the next way or the frame (in effect, always). */
const TRACK_RUN_ON = 20000;
/** The ways cut the frame over again, at most this many times, until no parcel is cut further. */
const SPLIT_PASSES = 1;
/** A track is not drawn within this far (m) of the built ground, nor in runs shorter than this (m). */
const TRACK_CLEAR_M = 5;
const TRACK_RUN_MIN_M = 60;
/** The land's grain: square to the nearest road or track, wandering up to this many degrees over
 * this many metres; the first FIELD_GRAIN_DEPTH cuts of a parcel follow it, later ones each
 * piece's own long axis. */
const FIELD_GRAIN_WANDER = 15;
const FIELD_GRAIN_M = 700;
const FIELD_GRAIN_DEPTH = 2;
/** A piece filling less than this share of its own box, and smaller than this many fields, is an
 * awkward corner, farmed last (ODD_LAST later in the order), so it is left as rough ground unless
 * the land is needed. */
const ODD_SHAPE = 0.66;
const ODD_AREA = 1.5;
const ODD_LAST = 1200;
/** A wood's fringe of crowns along its outer edge: every so many metres, of this radius (m). */
const WOOD_EDGE = Object.freeze({ step: 7, r: [5, 8.5] });
/** Trees in the hedges of enclosed fields: a chance every so many metres, of this radius (m). */
const HEDGE_TREES = Object.freeze({ step: 14, chance: 0.12, r: [3.5, 5.5] });
/** Share of furlongs whose strips lie across them rather than along. */
const TURNED_SHARE = 0.25;
/** Strips (m apart): a selion's width. */
const STRIP_SPACING = [16, 22];
/** The headland round each furlong (m). */
const HEADLAND = 6;
/** Pasture for this share of the arable. */
const PASTURE_SHARE = 0.35;
/** Ploughland (ha, fallow included) that feeds one person for a year at a crop factor of 1. */
const ARABLE_HA_PER_FED = 0.6;
/** Gardens and market gardens (ha) that feed one person: dug and manured, they yield far more. */
const GARDEN_HA_PER_FED = 0.25;
/** The country people grow this much more than they eat: their store and what they sell (Supply.js RESERVE and COUNTRY_SURPLUS). */
const COUNTRY_GROWS = 1 + 0.15 + 0.2;
/**
 * The land nobody farms, by the built-in biome the place stands in (as the parent gives it): the
 * shares of common (rough grazing), wood, moor (moorland and heath) and dry (dry or sandy waste).
 * Common lies nearest the place, where its beasts are driven out each day; the rest lies beyond
 * in patches by noise. A proposal: the module would carry it beside GENERATOR.BIOMES.
 */
export const WILD_LAND = Object.freeze({
    SNOW: Object.freeze({ common: 0, wood: 0, moor: 0.85, dry: 0.15 }),
    TUNDRA: Object.freeze({ common: 0.25, wood: 0.05, moor: 0.7, dry: 0 }),
    TAIGA: Object.freeze({ common: 0.15, wood: 0.65, moor: 0.2, dry: 0 }),
    GRASSLAND: Object.freeze({ common: 0.45, wood: 0.3, moor: 0.2, dry: 0.05 }),
    DECIDUOUS_FOREST: Object.freeze({ common: 0.3, wood: 0.6, moor: 0.1, dry: 0 }),
    TEMPERATE_RAINFOREST: Object.freeze({ common: 0.2, wood: 0.7, moor: 0.1, dry: 0 }),
    TEMPERATE_DESERT: Object.freeze({ common: 0.35, wood: 0.05, moor: 0, dry: 0.6 }),
    TROPICAL_RAINFOREST: Object.freeze({ common: 0.1, wood: 0.9, moor: 0, dry: 0 }),
    SAVANNA: Object.freeze({ common: 0.55, wood: 0.2, moor: 0, dry: 0.25 }),
    SUBTROPICAL_DESERT: Object.freeze({ common: 0.1, wood: 0, moor: 0, dry: 0.9 }),
});
/** The tile of tree positions repeated across woods (m). */
const TREE_TILE_M = 480;
/** People per farmhouse. */
const FARM_PEOPLE_PER_HOUSE = 5;
/** Ground this close (m) to a building is the place's closes and gardens. */
const CLOSE_REACH = 22;

export function buildFields(T) {
    const { P, W, H, input, centre: C, wall, river, roads } = T;
    const random = T.R("fields");
    const built = builtDistance(T);
    const builtAt = (p) => {
        const k = T.cellOf(p);
        return k < 0 ? 1e9 : built[k];
    };
    // Sectors between the roads, by each road's bearing from the centre where it leaves the town
    const roadBearings = roads.map((road) => bearingFromCentre(road, C)).sort((a, b) => a - b);
    const sectorBounds = roadBearings.length >= 2 ? roadBearings : [0, 120, 240];
    const sectors = sectorBounds.map((from, k) => {
        const to = sectorBounds[(k + 1) % sectorBounds.length];
        const span = (to - from + 360) % 360 || 360;
        const middle = (from + span / 2) % 360;
        // Along the track (radial) or across it, by sector, with a little noise
        const grain = random.chance(0.5) ? middle : (middle + 90) % 360;
        return { from, span, middle, grain: grain + random.range(-12, 12) };
    });
    // Field tracks: one out through each sector from the edge of the built-up area, and others
    // leaving the roads now and then; each winds as it goes and ends where it ends (at the frame,
    // the water, or simply out among the fields), so the land is not cut into wedges
    let reachBuilt = 150;
    for (const b of T.buildings) reachBuilt = Math.max(reachBuilt, dist(b.poly[0], C));
    reachBuilt *= 0.85;
    const rt = T.R("tracks");
    const winding = (start, bearing, length, salt) => {
        // A random walk that keeps its general heading: each step turns a little, and is drawn back
        // towards the heading it set out on
        const points = [start];
        let p = start;
        let heading = bearing;
        for (let s = 0, k = 0; s < length; s += TRACK_STEP, k++) {
            heading += TRACK_TURN * (T.noise.fbm(k * 0.09 + salt, salt * 0.61 + 3.3, 2) - 0.5) * 2 + (bearing - heading) * TRACK_PULL;
            const d = compass(heading);
            p = [p[0] + d[0] * TRACK_STEP, p[1] + d[1] * TRACK_STEP];
            if (!T.inFrame(p) || T.wdAt(p) < 6) break;
            points.push(p);
        }
        return points.length > 2 ? chaikin(points, 2) : points;
    };
    T.tracks = [];
    sectors.forEach((sector, k) => {
        if (sector.span <= 50) return;
        const t = compass(sector.middle);
        const start = [C[0] + t[0] * reachBuilt, C[1] + t[1] * reachBuilt];
        T.tracks.push(winding(start, sector.middle, rt.range(0.6, 1.2) * Math.max(W, H), 11 + k * 7.7));
    });
    roads.forEach((road, k) => {
        const points = road.points;
        let run = rt.range(TRACK_BRANCH[0], TRACK_BRANCH[1]) * 0.6;
        for (let j = points.length - 1; j > 0; j--) {
            const segment = dist(points[j], points[j - 1]);
            run -= segment;
            if (run > 0) continue;
            run = rt.range(TRACK_BRANCH[0], TRACK_BRANCH[1]);
            const at = points[j - 1];
            if (dist(at, C) < reachBuilt) continue;
            const along = bearingOfVector([points[j - 1][0] - points[j][0], points[j - 1][1] - points[j][1]]);
            const side = rt.chance(0.5) ? 1 : -1;
            T.tracks.push(winding(at, along + side * rt.range(60, 110), rt.range(TRACK_LENGTH[0], TRACK_LENGTH[1]), 40 + k * 5.3 + j * 0.71));
        }
    });
    T.tracks = T.tracks.filter((points) => points.length > 4);

    // Furlongs: seeds thrown into each half of each sector (between a road and its track), closer
    // near the place (its oldest, most divided land) and further apart out towards the waste, set
    // further apart along the sector's grain than across it; the Voronoi of all of them gives
    // fields of mixed size and shape, each then cut to its own half-sector, so roads and tracks
    // bound them
    const temperature = input.climate?.temperature ?? 0.5;
    const moisture = input.climate?.moisture ?? 0.5;
    // On an open cavern floor no weather reaches the beds: the floor's biome sets their yield instead
    const floor = input.floor ?? null;
    const cropFactor = floor ? 1 : Math.max(0.35, Math.min(1, (temperature - 0.25) / 0.25) * Math.min(1, (moisture - 0.12) / 0.3));
    const arablePerFed = floor ? floor.haPerFed : ARABLE_HA_PER_FED;
    // The land budget: the place's own share of its food (the supply plan's), as ploughland or,
    // for a city, gardens and market gardens; pasture beside it; then the country people's farms
    // within the frame at their density in the parent's cell; wood and waste beyond
    const own = input.ownFood ?? input.population * (P.arablePerHead / ARABLE_HA_PER_FED);
    // (a city on a cavern floor farms beds round it as any place there does, not market gardens)
    const gardens = T.kind === "city" && !floor;
    const budget = {
        garden: gardens ? (own * GARDEN_HA_PER_FED * 10000) / cropFactor : 0,
        arable: gardens ? 0 : (own * arablePerFed * 10000) / cropFactor,
    };
    budget.pasture = (budget.garden + budget.arable) * PASTURE_SHARE;
    // The country people live on the frame's land, not its water
    const sea = T.terrain.sea;
    const landShare = T.shore ? 1 - sea.reduce((a, b) => a + b, 0) / sea.length : 1;
    const countryPeople = (input.countryDensity ?? 0) * ((W / 1000) * (H / 1000)) * landShare;
    budget.countryArable = (countryPeople * COUNTRY_GROWS * ARABLE_HA_PER_FED * 10000) / cropFactor;
    budget.countryPasture = budget.countryArable * PASTURE_SHARE;
    const wanted = { ...budget };
    // Seeds over the whole frame, spaced by distance from the place and stretched along the grain
    // of the sector they fall in
    const sectorAt = (p) => {
        const bearing = bearingOfVector([p[0] - C[0], p[1] - C[1]]);
        return sectors.find((sector) => (bearing - sector.from + 360) % 360 < sector.span) ?? sectors[0];
    };
    // Fields (V4, 2026-11-16): the frame is cut along the roads and tracks into parcels, and each
    // parcel split, again and again, by straight lines across its long axis or along it, whichever
    // leaves the nearer the shape of a furlong (FIELD_ASPECT), until each piece is its field size:
    // small near the place (its oldest, most divided land), larger out towards the waste.
    const fieldArea = (p) => {
        const out = Math.min(1, dist(p, C) / FIELD_GROWTH_M);
        const r = P.fieldSpacing * FIELD_SPACING_SHARE * (FIELD_NEAR + FIELD_GROWTH * out) * (0.75 + 0.5 * T.noise.value(p[0] / 300 + 40, p[1] / 300 - 13));
        return FIELD_AREA * r * r;
    };
    const frame = [[-W / 2, -H / 2], [W / 2, -H / 2], [W / 2, H / 2], [-W / 2, H / 2]];
    const boxOf = (points) => {
        const xs = points.map((q) => q[0]);
        const ys = points.map((q) => q[1]);
        return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    };
    // A track that ends among the fields runs on, straight, to the next way or the frame's edge
    // (a hedge or a headland), so no parcel has a track stopping in its middle
    const runOn = (points, others) => {
        const extend = (end, before) => {
            const d = [end[0] - before[0], end[1] - before[1]];
            const L = Math.hypot(d[0], d[1]) || 1;
            const far = [end[0] + (d[0] / L) * TRACK_RUN_ON, end[1] + (d[1] / L) * TRACK_RUN_ON];
            let best = null;
            const consider = (a, b) => {
                const x = segmentCross(end, far, a, b);
                if (x && x.s > 1e-4 && (!best || x.s < best.s)) best = x;
            };
            for (const o of others) for (let k = 1; k < o.length; k++) consider(o[k - 1], o[k]);
            for (let k = 0; k < 4; k++) consider(frame[k], frame[(k + 1) % 4]);
            if (!best) return null;
            const to = [best.p[0] + (d[0] / L) * 0.5, best.p[1] + (d[1] / L) * 0.5];
            return dryTo(end, to) ? to : null;
        };
        const out = points.slice();
        const tail = extend(out[out.length - 1], out[out.length - 2]);
        if (tail) out.push(tail);
        const head = extend(out[0], out[1]);
        if (head) out.unshift(head);
        return out;
    };
    // Not where the run lies out in the water (a field may run down into a lake or the sea)
    const dryTo = (from, to) => {
        for (let k = 1; k <= 8; k++) if (T.sdAt(lerp(from, to, k / 8)) < 6) return false;
        return true;
    };
    const roadLines = roads.map((road) => road.points);
    // (each taken from its end at the place outwards)
    const outward = roadLines.map((pts) => (dist(pts[0], C) <= dist(pts[pts.length - 1], C) ? pts : pts.slice().reverse()));
    // Each way's ends pushed a few metres on, so a way ending on the frame's edge, on another way
    // or at the place (where the roads all meet) crosses it rather than touching it
    const overrun = (pts) => {
        if (pts.length < 2) return pts;
        const push = (a, b) => {
            const L = dist(a, b) || 1;
            return [a[0] + ((a[0] - b[0]) / L) * 3, a[1] + ((a[1] - b[1]) / L) * 3];
        };
        return [push(pts[0], pts[1]), ...pts, push(pts[pts.length - 1], pts[pts.length - 2])];
    };
    // The roads all set out from the place to the frame's edge, so the frame is first cut into the
    // sectors between them: each a road out, the frame's edge round to the next road, and that road
    // back. (Where a road does not reach the edge, the roads are cut in as lines instead.)
    const perimeterAt = (p) => {
        // Distance round the frame's edge, counter-clockwise from its top-left corner
        const [x, y] = p;
        const dx = [Math.abs(x + W / 2), Math.abs(y - H / 2), Math.abs(x - W / 2), Math.abs(y + H / 2)];
        const side = dx.indexOf(Math.min(...dx));
        if (side === 0) return y + H / 2;
        if (side === 1) return H + (x + W / 2);
        if (side === 2) return H + W + (H / 2 - y);
        return 2 * H + W + (W / 2 - x);
    };
    const corners = [[-W / 2, H / 2, H], [W / 2, H / 2, H + W], [W / 2, -H / 2, 2 * H + W], [-W / 2, -H / 2, 0]];
    const onEdge = (p) => Math.min(Math.abs(p[0] + W / 2), Math.abs(p[0] - W / 2), Math.abs(p[1] + H / 2), Math.abs(p[1] - H / 2)) < 1;
    const sectorsCut = outward.length >= 2 && outward.every((pts) => onEdge(pts[pts.length - 1]));
    const roadWays = [];
    let parcels0 = [frame];
    if (sectorsCut) {
        const P2 = 2 * (W + H);
        const sorted = outward.map((pts) => ({ pts, at: perimeterAt(pts[pts.length - 1]) })).sort((a, b) => a.at - b.at);
        parcels0 = sorted.map((a, k) => {
            const b = sorted[(k + 1) % sorted.length];
            const span = (b.at - a.at + P2) % P2 || P2;
            const between = corners.filter(([, , c]) => ((c - a.at + P2) % P2) > 0 && ((c - a.at + P2) % P2) < span).sort((p, q) => ((p[2] - a.at + P2) % P2) - ((q[2] - a.at + P2) % P2)).map(([x, y]) => [x, y]);
            return [...a.pts, ...between, ...b.pts.slice().reverse().slice(0, -1)];
        }).filter((q) => Math.abs(polygonArea(q)) > 20);
    } else {
        for (let k = 0; k + 1 < outward.length; k += 2) roadWays.push([...outward[k].slice().reverse(), ...outward[k + 1].slice(1)]);
        if (outward.length % 2 === 1) roadWays.push(outward.length > 1 ? [...outward[outward.length - 1].slice().reverse(), ...outward[0].slice(1)] : outward[0]);
    }
    // A track runs on only to a way already laid (a road or an earlier track), so every way ends on
    // a line that is already a parcel's edge when it is cut
    const laid = [...roadLines];
    T.tracks = T.tracks.map((points) => {
        const out = runOn(points, laid);
        laid.push(out);
        return out;
    });
    const ways = [...roadWays, ...T.tracks].map((points) => ({ points: overrun(points), box: boxOf(overrun(points)) }));
    // Parcels: the frame cut by every way
    // (over again until nothing more is cut: a way can slip past a parcel that a later way's cut
    // has yet to shape)
    let parcels = parcels0;
    for (let pass = 0; pass < SPLIT_PASSES; pass++) {
        const before = parcels.length;
        for (const way of ways) {
            const next = [];
            for (const piece of parcels) {
                const box = boxOf(piece);
                if (way.box[0] > box[2] || way.box[2] < box[0] || way.box[1] > box[3] || way.box[3] < box[1]) {
                    next.push(piece);
                    continue;
                }
                // Only the way's run near this parcel, one point either side so it reaches across
                const pts = way.points;
                let first = -1, last = -1;
                for (let k = 0; k + 1 < pts.length; k++) {
                    const a = pts[k], b = pts[k + 1];
                    if (Math.max(a[0], b[0]) >= box[0] && Math.min(a[0], b[0]) <= box[2] && Math.max(a[1], b[1]) >= box[1] && Math.min(a[1], b[1]) <= box[3]) {
                        if (first < 0) first = k;
                        last = k + 1;
                    }
                }
                if (first < 0) {
                    next.push(piece);
                    continue;
                }
                next.push(...splitByPolyline(piece, pts.slice(Math.max(0, first - 1), Math.min(pts.length, last + 2))));
            }
            // (a cut along an edge a parcel already has leaves only slivers of no area)
            parcels = next.filter((q) => Math.abs(polygonArea(q)) > 20);
        }
        if (parcels.length === before) break;
    }
    // The land's grain: furlongs were laid out back from the way that served them, so a piece's
    // grain runs square to its nearest road or track, wandering a little by a broad noise
    const segs = [];
    for (const way of ways) for (let k = 1; k < way.points.length; k++) segs.push([way.points[k - 1], way.points[k]]);
    const SEG_BUCKET = 200;
    const segAt = new Map();
    segs.forEach((sg, idx) => {
        const x0 = Math.floor(Math.min(sg[0][0], sg[1][0]) / SEG_BUCKET), x1 = Math.floor(Math.max(sg[0][0], sg[1][0]) / SEG_BUCKET);
        const y0 = Math.floor(Math.min(sg[0][1], sg[1][1]) / SEG_BUCKET), y1 = Math.floor(Math.max(sg[0][1], sg[1][1]) / SEG_BUCKET);
        for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) {
            const key = i * 65536 + j;
            if (!segAt.has(key)) segAt.set(key, []);
            segAt.get(key).push(idx);
        }
    });
    const grainAt = (p) => {
        let best = null, bd = Infinity;
        const i0 = Math.floor(p[0] / SEG_BUCKET), j0 = Math.floor(p[1] / SEG_BUCKET);
        for (let r = 0; r <= 4 && !best; r++) {
            for (let i = i0 - r; i <= i0 + r; i++) for (let j = j0 - r; j <= j0 + r; j++) {
                if (Math.max(Math.abs(i - i0), Math.abs(j - j0)) !== r) continue;
                for (const idx of segAt.get(i * 65536 + j) ?? []) {
                    const d = segmentDistance(p, segs[idx][0], segs[idx][1]);
                    if (d < bd) { bd = d; best = segs[idx]; }
                }
            }
        }
        const wander = (FIELD_GRAIN_WANDER * Math.PI / 180) * (T.noise.fbm(p[0] / FIELD_GRAIN_M + 7.1, p[1] / FIELD_GRAIN_M - 2.3, 2) - 0.5) * 2;
        let a;
        if (best) {
            const t = [best[1][0] - best[0][0], best[1][1] - best[0][1]];
            a = Math.atan2(t[1], t[0]) + Math.PI / 2;
        } else a = (sectorAt(p).grain * Math.PI) / 180;
        return [Math.cos(a + wander), Math.sin(a + wander)];
    };
    const cells = [];
    const reach = Math.hypot(W, H);
    const split = (poly, depth) => {
        const area = polygonArea(poly);
        if (area < 400) return;
        const m = centroid(poly);
        const wantArea = fieldArea(m) * (0.8 + 0.45 * random.next());
        if (area <= wantArea || depth > 18) {
            addPiece(poly);
            return;
        }
        // Cuts tried: across and along the land's grain here (square to the nearest way, while the
        // parcel is still large) and the piece's own long axis; the one kept leaves its pieces
        // nearest a furlong's shape (FIELD_ASPECT) and squarest at the corners
        const f = random.range(FIELD_CUT[0], FIELD_CUT[1]);
        const turn = random.range(-FIELD_TURN, FIELD_TURN);
        const axes = depth < FIELD_GRAIN_DEPTH ? [grainAt(m), longAxis(poly)] : [longAxis(poly)];
        let best = null;
        for (const u of axes) {
            const v = [-u[1], u[0]];
            let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
            for (const q of poly) {
                const a = (q[0] - m[0]) * u[0] + (q[1] - m[1]) * u[1];
                const b = (q[0] - m[0]) * v[0] + (q[1] - m[1]) * v[1];
                u0 = Math.min(u0, a); u1 = Math.max(u1, a); v0 = Math.min(v0, b); v1 = Math.max(v1, b);
            }
            for (const across of [true, false]) {
                const base = across ? v : u;
                const d = [base[0] * Math.cos(turn) - base[1] * Math.sin(turn), base[0] * Math.sin(turn) + base[1] * Math.cos(turn)];
                const at = across ? [m[0] + u[0] * (u0 + (u1 - u0) * f), m[1] + u[1] * (u0 + (u1 - u0) * f)] : [m[0] + v[0] * (v0 + (v1 - v0) * f), m[1] + v[1] * (v0 + (v1 - v0) * f)];
                const cut = splitByPolyline(poly, [[at[0] - d[0] * reach, at[1] - d[1] * reach], [at[0] + d[0] * reach, at[1] + d[1] * reach]]);
                if (cut.length < 2) continue;
                let score = 0;
                for (const piece of cut) {
                    const sh = shapeOf(piece);
                    score += (Math.abs(Math.log(sh.aspect / FIELD_ASPECT)) + FIELD_SQUARE_WEIGHT * (1 - sh.rect)) * Math.abs(polygonArea(piece));
                }
                if (!best || score < best.score) best = { score, pieces: cut };
            }
        }
        const pieces = best?.pieces ?? [];
        if (pieces.length < 2) {
            addPiece(poly);
            return;
        }
        for (const piece of pieces) split(piece, depth + 1);
    };
    for (const parcel of parcels) split(parcel, 0);
    function addPiece(poly) {
        if (poly.length < 3) return;
        const area = polygonArea(poly);
        if (area < 400) return;
        const m = centroid(poly);
        if (wall && pointInPolygon(m, wall.polygon)) return;
        // The ground where the roads meet is the place itself (its green or market), not a field
        if (pointInPolygon(C, poly)) return;
        let nearBuilt = Infinity;
        let wet = 0;
        for (const q of [m, ...poly]) {
            nearBuilt = Math.min(nearBuilt, builtAt(q));
            if (T.wdAt(q) < 2) wet++;
        }
        // A field the shore cuts is drawn under the water; only its dry part counts
        if (wet > poly.length / 2 || T.seaAt(m)) return;
        const slope = Math.abs(T.hAt([m[0] + 20, m[1]]) - T.hAt([m[0] - 20, m[1]])) / 40 + Math.abs(T.hAt([m[0], m[1] + 20]) - T.hAt([m[0], m[1] - 20])) / 40;
        const rank = dist(m, C) * (1 + slope * 8) * (0.8 + 0.4 * T.noise.fbm(m[0] / 650 + 11, m[1] / 650 - 4, 3)) + (nearBuilt < CLOSE_REACH ? -1e6 : 0);
        // An awkward corner left between ways (a sliver or a wedge) is left as rough ground, a
        // copse or waste, rather than ploughed or grazed (V4), unless the land is needed
        const ax = longAxis(poly);
        let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
        for (const q of poly) {
            const a = (q[0] - m[0]) * ax[0] + (q[1] - m[1]) * ax[1];
            const b = -(q[0] - m[0]) * ax[1] + (q[1] - m[1]) * ax[0];
            a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b);
        }
        const odd = area / Math.max(1, (a1 - a0) * (b1 - b0)) < ODD_SHAPE && area < ODD_AREA * fieldArea(m);
        // (they are farmed last, only where the place's land would otherwise fall short)
        cells.push({ poly, m, nearBuilt, rank: rank + (odd && nearBuilt >= CLOSE_REACH ? ODD_LAST : 0), odd, area: T.shore ? area * (1 - wet / (poly.length + 1)) : area, sector: sectorAt(m) });
    }
    cells.sort((a, b) => a.rank - b.rank);
    // The three great fields by sector order round the place; one lies fallow
    const greatOf = new Map(sectors.map((sector, k) => [sector, k % 3]));
    const fields = [];
    for (const cell of cells) {
        const { poly, m } = cell;
        let use;
        if (cell.nearBuilt < CLOSE_REACH) use = "close";
        else if (T.rdAt(m) < river.width / 2 + (river.brook ? 55 : 110)) use = "meadow";
        else {
            // An awkward corner, where it is used, is grazed rough rather than ploughed or hedged
            const take = ["garden", "arable", "pasture", "countryArable", "countryPasture"].find((key) => budget[key] > 0);
            if (take) budget[take] -= cell.area;
            // Beyond the farmed land: the wild land, sorted by kind once all of it is known
            use = take ? { garden: "garden", arable: "arable", pasture: "pasture", countryArable: "arable", countryPasture: "pasture" }[take] : "wild";
            if (cell.odd && use === "pasture") use = "rough";
            cell.owner = take?.startsWith("country") ? "country" : "own";
        }
        const field = { poly, use, centre: m, owner: cell.owner ?? "own", area: cell.area };
        if (use === "arable") {
            field.great = greatOf.get(cell.sector) ?? 0;
            // Strips run the length of the field (most of them), across it on the rest
            const turned = random.chance(TURNED_SHARE);
            const axis = longAxis(poly);
            const grain = turned ? [-axis[1], axis[0]] : axis;
            const inner = shrink(poly, HEADLAND);
            const n = [-grain[1], grain[0]];
            const strips = [];
            const spacing = random.range(STRIP_SPACING[0], STRIP_SPACING[1]);
            const reach = Math.max(...inner.map((q) => dist(q, m)));
            for (let o = -reach; o <= reach; o += spacing) {
                for (const segment of clipLinePolygon([m[0] + n[0] * o, m[1] + n[1] * o], grain, inner)) if (dist(segment[0], segment[1]) > 12) strips.push(segment);
            }
            field.inner = inner;
            field.strips = strips;
        }
        if (use === "close" || use === "garden") field.inner = shrink(poly, use === "garden" ? 3 : 4);
        fields.push(field);
    }
    sortWildLand(T, fields, C);
    // Trees from one tile of Poisson points repeated across the frame, so a wood is planted over its
    // whole ground at the cost of one tile
    const tile = poisson(TREE_TILE_M, TREE_TILE_M, 13, random.next);
    for (const field of fields) {
        if (field.use !== "wood") continue;
        const inner = shrink(field.poly, 4);
        const xs = inner.map((q) => q[0]);
        const ys = inner.map((q) => q[1]);
        const xMin = Math.min(...xs);
        const xMax = Math.max(...xs);
        const yMin = Math.min(...ys);
        const yMax = Math.max(...ys);
        const trees = [];
        // The tile is centred on its origin, so it reaches half a tile either way: start a tile
        // early and run a tile past, or a band along each tile's far side goes unplanted
        for (let ty = Math.floor(yMin / TREE_TILE_M) * TREE_TILE_M; ty < yMax + TREE_TILE_M; ty += TREE_TILE_M) {
            for (let tx = Math.floor(xMin / TREE_TILE_M) * TREE_TILE_M; tx < xMax + TREE_TILE_M; tx += TREE_TILE_M) {
                for (const q of tile) {
                    const p = [q[0] + tx, q[1] + ty];
                    if (p[0] < xMin || p[0] > xMax || p[1] < yMin || p[1] > yMax) continue;
                    if (pointInPolygon(p, inner)) trees.push([p[0], p[1], 6 + 3 * ((Math.sin(p[0] * 12.9898 + p[1] * 78.233) * 43758.5453) % 1 + 1) % 1]);
                }
            }
        }
        field.trees = trees;
        field.inner = inner;
    }
    // The tracks cut the fields wherever they run, but where one runs on into the built ground (its
    // houses, yards and streets) or inside the walls it is not drawn there: a field track stops at
    // the edge of the place, where its lanes take over (Ken, 2026-11-16)
    T.tracks = trimTracks(T, T.tracks);
    edgeTrees(T, fields, random);
    T.fields = fields;
    T.sectors = sectors;
    T.cropFactor = cropFactor;
    // What of the place's own land fits the frame, and what is clipped (named in its supply)
    const ha = (m2) => Math.max(0, m2) / 10000;
    const perFed = ((gardens ? GARDEN_HA_PER_FED : arablePerFed) * 10000) / cropFactor;
    const ownWanted = wanted.garden + wanted.arable;
    const ownClipped = Math.max(0, budget.garden) + Math.max(0, budget.arable);
    T.land = {
        frameHa: ha(W * H),
        ownFood: own,
        ownWantedHa: ha(ownWanted),
        ownDrawnHa: ha(ownWanted - ownClipped),
        ownClippedHa: ha(ownClipped),
        ownFedDrawn: (ownWanted - ownClipped) / perFed,
        ownFedClipped: ownClipped / perFed,
        gardens,
        pastureDrawnHa: ha(wanted.pasture - Math.max(0, budget.pasture)),
        countryPeople,
        countryArableHa: ha(wanted.countryArable - Math.max(0, budget.countryArable)),
    };
    placeFarmsteads(T, fields, countryPeople);
}

/**
 * The tracks' runs outside the built ground: a point is in the place where a building, a yard or
 * reserved ground (a cemetery, an estate) lies within TRACK_CLEAR_M of it, or inside the walls. Runs shorter than
 * TRACK_RUN_MIN_M are dropped.
 */
function trimTracks(T, tracks) {
    const { occupancy, wall } = T;
    const blocked = (p) => {
        if (wall && pointInPolygon(p, (T.outerWall ?? wall).polygon)) return true;
        for (let dy = -TRACK_CLEAR_M; dy <= TRACK_CLEAR_M; dy += TRACK_CLEAR_M) {
            for (let dx = -TRACK_CLEAR_M; dx <= TRACK_CLEAR_M; dx += TRACK_CLEAR_M) {
                const v = occupancy.at([p[0] + dx, p[1] + dy]);
                if (v === BUILDING || v === PLOT || v === RESERVED) return true;
            }
        }
        return false;
    };
    const out = [];
    for (const track of tracks) {
        // Finer points, so a run ends close to where the built ground begins
        const pts = [];
        for (let k = 1; k < track.length; k++) {
            const a = track[k - 1], b = track[k];
            const n = Math.max(1, Math.ceil(dist(a, b) / 4));
            for (let j = 0; j < n; j++) pts.push(lerp(a, b, j / n));
        }
        pts.push(track[track.length - 1]);
        let run = [];
        const flush = () => {
            let L = 0;
            for (let k = 1; k < run.length; k++) L += dist(run[k - 1], run[k]);
            if (L >= TRACK_RUN_MIN_M) out.push(simplifyRun(run));
            run = [];
        };
        for (const p of pts) {
            if (blocked(p)) flush();
            else run.push(p);
        }
        flush();
    }
    return out;
}

/** Drops points of a run that lie nearly on the line between their neighbours. */
function simplifyRun(run) {
    if (run.length < 3) return run;
    const out = [run[0]];
    for (let k = 1; k + 1 < run.length; k++) {
        const a = out[out.length - 1], b = run[k], c = run[k + 1];
        if (segmentDistance(b, a, c) > 0.4 || dist(a, b) > 40) out.push(b);
    }
    out.push(run[run.length - 1]);
    return out;
}

/**
 * Trees at the edges (V4): a wood's outer edge as a fringe of larger crowns, so it reads as clumps
 * rather than a cut block; and now and then a tree in the hedges of the enclosed fields (pasture,
 * meadow, closes). Edges a wood shares with another wood, or that run along water, are skipped.
 */
function edgeTrees(T, fields, random) {
    const woods = fields.filter((f) => f.use === "wood");
    const boxOf = (poly) => {
        const xs = poly.map((q) => q[0]);
        const ys = poly.map((q) => q[1]);
        return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    };
    const woodBoxes = woods.map((f) => boxOf(f.poly));
    const inWood = (p, self) => woods.some((f, k) => f !== self && p[0] >= woodBoxes[k][0] && p[0] <= woodBoxes[k][2] && p[1] >= woodBoxes[k][1] && p[1] <= woodBoxes[k][3] && pointInPolygon(p, f.poly));
    const along = (f, step, visit) => {
        const poly = f.poly;
        const sign = polygonArea(poly) >= 0 ? 1 : -1;
        for (let e = 0; e < poly.length; e++) {
            const a = poly[e], b = poly[(e + 1) % poly.length];
            const L = dist(a, b);
            if (L < 1) continue;
            const t = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
            // The outward normal (by the ring's winding)
            const n = [t[1] * sign, -t[0] * sign];
            for (let s0 = random.range(0, step); s0 < L; s0 += step) visit([a[0] + t[0] * s0, a[1] + t[1] * s0], n);
        }
    };
    // Clear of the roads and the tracks: no tree stands on a way
    const waySegs = new Map();
    for (const line of [...T.roads.map((r) => r.points), ...(T.tracks ?? [])]) {
        for (let k = 1; k < line.length; k++) {
            const a = line[k - 1], b = line[k];
            const x0 = Math.floor(Math.min(a[0], b[0]) / 50), x1 = Math.floor(Math.max(a[0], b[0]) / 50);
            const y0 = Math.floor(Math.min(a[1], b[1]) / 50), y1 = Math.floor(Math.max(a[1], b[1]) / 50);
            for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) {
                const key = i * 65536 + j;
                if (!waySegs.has(key)) waySegs.set(key, []);
                waySegs.get(key).push([a, b]);
            }
        }
    }
    const onWay = (p, r) => {
        const i = Math.floor(p[0] / 50), j = Math.floor(p[1] / 50);
        for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (const [a, b] of waySegs.get((i + di) * 65536 + j + dj) ?? []) if (segmentDistance(p, a, b) < r + 5) return true;
        return false;
    };
    for (const f of woods) {
        const fringe = [];
        along(f, WOOD_EDGE.step, (p, n) => {
            if (inWood([p[0] + n[0] * 5, p[1] + n[1] * 5], f) || T.wdAt(p) < 4) return;
            const r = random.range(WOOD_EDGE.r[0], WOOD_EDGE.r[1]);
            if (onWay(p, r)) return;
            // Each crown a little in from the edge or out over it, so the outline wanders
            const o = random.range(-0.6, 0.35) * r;
            fringe.push([p[0] - n[0] * (r * 0.6 + o), p[1] - n[1] * (r * 0.6 + o), r]);
        });
        // (the wood's own trees too: none over a road or track along its edge)
        f.trees = [...(f.trees ?? []).filter((t) => !onWay(t, t[2] - 4)), ...fringe];
    }
    for (const f of fields) {
        if (f.use !== "pasture" && f.use !== "meadow" && f.use !== "close") continue;
        const trees = [];
        along(f, HEDGE_TREES.step, (p) => {
            if (!random.chance(HEDGE_TREES.chance) || T.wdAt(p) < 4 || T.sdAt?.(p) < 4) return;
            const r = random.range(HEDGE_TREES.r[0], HEDGE_TREES.r[1]);
            if (onWay(p, r) || T.occupancy.at(p) !== 0) return;
            trees.push([p[0], p[1], r]);
        });
        if (trees.length) f.trees = trees;
    }
}

/**
 * The wild land's kinds by the biome's shares (WILD_LAND), by area: common nearest the place
 * (by distance, roughened by noise), then wood, moor and dry ground in patches by a second noise.
 */
function sortWildLand(T, fields, C) {
    const wild = fields.filter((field) => field.use === "wild");
    // The biome already carries the height (the climate cools with it), so it alone decides
    const shares = T.input.floor?.wild ?? WILD_LAND[T.input.biome] ?? WILD_LAND.GRASSLAND;
    const total = wild.reduce((a, f) => a + f.area, 0);
    let commonLeft = total * shares.common;
    const near = wild.map((f) => ({ f, key: dist(f.centre, C) * (0.7 + 0.6 * T.noise.fbm(f.centre[0] / 500 + 31, f.centre[1] / 500 - 9, 3)) })).sort((a, b) => a.key - b.key);
    const rest = [];
    for (const { f } of near) {
        // (a piece goes to whichever kind it leaves nearer its share)
        if (commonLeft > f.area / 2) {
            f.use = "common";
            commonLeft -= f.area;
        } else rest.push(f);
    }
    // The rest in patches: ordered by a smooth noise, cut into wood, moor and dry by their shares
    const others = ["wood", "moor", "dry"].filter((kind) => shares[kind] > 0);
    const othersTotal = others.reduce((a, kind) => a + shares[kind], 0) || 1;
    rest.sort((a, b) => T.noise.fbm(b.centre[0] / 700 - 21, b.centre[1] / 700 + 5, 3) - T.noise.fbm(a.centre[0] / 700 - 21, a.centre[1] / 700 + 5, 3));
    const restArea = rest.reduce((a, f) => a + f.area, 0);
    let done = 0;
    let k = 0;
    let bound = others.length ? (restArea * shares[others[0]]) / othersTotal : Infinity;
    for (const f of rest) {
        while (k < others.length - 1 && done + f.area / 2 >= bound) {
            k++;
            bound += (restArea * shares[others[k]]) / othersTotal;
        }
        f.use = others[k] ?? "common";
        done += f.area;
    }
}

/**
 * The country people's homes: farmsteads and hamlets of one to three houses, each with a barn,
 * among their fields, at a field corner near a road or track where one is close.
 */
function placeFarmsteads(T, fields, countryPeople) {
    const random = T.R("farmsteads");
    const { occupancy } = T;
    let houses = Math.round(countryPeople / FARM_PEOPLE_PER_HOUSE);
    T.farmsteads = 0;
    // The ways' points by 100 m square, so the nearest is found among a few
    const wayBuckets = new Map();
    for (const q of [...T.roads.map((road) => road.points), ...(T.tracks ?? [])].flat()) {
        const key = `${Math.floor(q[0] / 100)},${Math.floor(q[1] / 100)}`;
        if (!wayBuckets.has(key)) wayBuckets.set(key, []);
        wayBuckets.get(key).push(q);
    }
    const nearestWay = (p) => {
        const i = Math.floor(p[0] / 100);
        const j = Math.floor(p[1] / 100);
        let best = Infinity;
        for (let r = 0; r <= 3 && best > r * 100; r++) {
            for (let dj = -r; dj <= r; dj++) {
                for (let di = -r; di <= r; di++) {
                    if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
                    for (const q of wayBuckets.get(`${i + di},${j + dj}`) ?? []) best = Math.min(best, dist(p, q));
                }
            }
        }
        return best;
    };
    // The roads, exactly: the occupancy grid holds them only as finely as its squares
    const roadSegments = T.roads.flatMap((road) => road.points.slice(1).map((q, k) => ({ a: road.points[k], b: q, clear: road.width / 2 + 1 })));
    // (V6: the segments indexed, so each point tries only those near it)
    const roadIndex = segmentIndex(roadSegments, roadSegments.reduce((m, s) => Math.max(m, s.clear), 1));
    const offRoads = (poly) => [centroid(poly), ...poly].every((p) => !T.seaAt(p) && roadIndex.clearOf(p));
    const country = fields.filter((field) => field.owner === "country" && field.use === "arable");
    const farmPolys = [];
    // Spread through the country fields rather than all in the nearest
    const step = Math.max(1, Math.floor(country.length / Math.max(1, houses / 2)));
    for (let k = 0; k < country.length && houses > 0; k += step) {
        const field = country[k];
        const corner = field.poly.reduce((best, p) => (nearestWay(p) < nearestWay(best) ? p : best), field.poly[0]);
        const towards = [field.centre[0] - corner[0], field.centre[1] - corner[1]];
        const length = Math.hypot(towards[0], towards[1]) || 1;
        const t = [towards[0] / length, towards[1] / length];
        const n = [-t[1], t[0]];
        const size = Math.min(houses, 1 + Math.floor(random.next() * 3));
        let placed = 0;
        for (let h = 0; h < size; h++) {
            const origin = [corner[0] + t[0] * (14 + h * 22) + n[0] * random.range(-6, 6), corner[1] + t[1] * (14 + h * 22) + n[1] * random.range(-6, 6)];
            const house = rect(origin, Math.atan2(t[1], t[0]) + Math.PI / 2, random.range(10, 14), random.range(6, 8));
            const barn = rect([origin[0] + n[0] * 14, origin[1] + n[1] * 14], Math.atan2(t[1], t[0]), random.range(10, 14), random.range(6, 7));
            if (!occupancy.free(house) || !occupancy.free(barn) || !offRoads(house) || !offRoads(barn)) continue;
            // The grid holds buildings only as finely as its squares: test the farms' own shapes exactly
            if (farmPolys.some((q) => [house, barn].some((p) => convexOverlap(p, q, 0)))) continue;
            farmPolys.push(house, barn);
            occupancy.stampPolygon(house, BUILDING);
            occupancy.stampPolygon(barn, BUILDING);
            T.buildings.push({ poly: house, kind: "farmhouse" }, { poly: barn, kind: "barn" });
            placed++;
        }
        if (placed) T.farmsteads++;
        houses -= placed;
    }
}

function rect(c, angle, w, h) {
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => [c[0] + x * ca - y * sa, c[1] + x * sa + y * ca]);
}

/** A piece's shape: its aspect (long over short) and how much of its box (on its long axis) it fills. */
function shapeOf(poly) {
    const m = centroid(poly);
    const u = longAxis(poly);
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const q of poly) {
        const a = (q[0] - m[0]) * u[0] + (q[1] - m[1]) * u[1];
        const b = -(q[0] - m[0]) * u[1] + (q[1] - m[1]) * u[0];
        a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b);
    }
    const L = Math.max(a1 - a0, b1 - b0), S = Math.max(1e-6, Math.min(a1 - a0, b1 - b0));
    return { aspect: L / S, rect: Math.abs(polygonArea(poly)) / Math.max(1, (a1 - a0) * (b1 - b0)) };
}

/** A polygon's long axis (unit vector), from the spread of its corners. */
function longAxis(poly) {
    const c = centroid(poly);
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (const p of poly) {
        sxx += (p[0] - c[0]) ** 2;
        syy += (p[1] - c[1]) ** 2;
        sxy += (p[0] - c[0]) * (p[1] - c[1]);
    }
    const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    return [Math.cos(angle), Math.sin(angle)];
}

/** The road's bearing from the centre, read where it is 250 m out (or at its far end). */
function bearingFromCentre(road, C) {
    const points = road.points;
    for (let k = points.length - 1; k >= 0; k--) if (dist(points[k], C) > 250) return bearingOfVector([points[k][0] - C[0], points[k][1] - C[1]]);
    return bearingOfVector([points[0][0] - C[0], points[0][1] - C[1]]);
}

/** Distance from the built-up area on the terrain grid (two-pass chamfer). */
function builtDistance(T) {
    const { NX, NY, g } = T;
    const d = new Float32Array(NX * NY).fill(1e9);
    for (const b of T.buildings) {
        const k = T.cellOf(centroid(b.poly));
        if (k >= 0) d[k] = 0;
    }
    for (const place of T.worship) {
        const k = T.cellOf(centroid(place.yard));
        if (k >= 0) d[k] = 0;
    }
    const a = g;
    const b = g * Math.SQRT2;
    for (let j = 0; j < NY; j++) {
        for (let i = 0; i < NX; i++) {
            const k = j * NX + i;
            if (i > 0) d[k] = Math.min(d[k], d[k - 1] + a);
            if (j > 0) d[k] = Math.min(d[k], d[k - NX] + a);
            if (i > 0 && j > 0) d[k] = Math.min(d[k], d[k - NX - 1] + b);
            if (i < NX - 1 && j > 0) d[k] = Math.min(d[k], d[k - NX + 1] + b);
        }
    }
    for (let j = NY - 1; j >= 0; j--) {
        for (let i = NX - 1; i >= 0; i--) {
            const k = j * NX + i;
            if (i < NX - 1) d[k] = Math.min(d[k], d[k + 1] + a);
            if (j < NY - 1) d[k] = Math.min(d[k], d[k + NX] + a);
            if (i < NX - 1 && j < NY - 1) d[k] = Math.min(d[k], d[k + NX + 1] + b);
            if (i > 0 && j < NY - 1) d[k] = Math.min(d[k], d[k + NX - 1] + b);
        }
    }
    return d;
}


/** Separating-axis test for two convex shapes, each shrunk by `slack` metres (touching allowed). */
function convexOverlap(a, b, slack) {
    for (const poly of [a, b]) {
        for (let k = 0; k < poly.length; k++) {
            const p = poly[k];
            const q = poly[(k + 1) % poly.length];
            const L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
            const axis = [-(q[1] - p[1]) / L, (q[0] - p[0]) / L];
            let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
            for (const v of a) { const d = v[0] * axis[0] + v[1] * axis[1]; a0 = Math.min(a0, d); a1 = Math.max(a1, d); }
            for (const v of b) { const d = v[0] * axis[0] + v[1] * axis[1]; b0 = Math.min(b0, d); b1 = Math.max(b1, d); }
            if (a1 - slack <= b0 + slack || b1 - slack <= a0 + slack) return false;
        }
    }
    return true;
}
