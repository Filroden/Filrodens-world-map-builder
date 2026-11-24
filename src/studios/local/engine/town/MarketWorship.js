// The market (a square in a city, a widened main street in a town, a green in a village) and the
// places of worship (a great one by a city's market and one per few thousand people; one
// elsewhere), each in its own grounds facing a street. All of a place's places of worship face
// the same way, on a bearing of the place's own, so none is tied to one faith's custom.
import { centroid, chaikinClosed, dist, pointInPolygon, polygonArea, shrink } from "../Geometry.js";
import { rect } from "./Walls.js";
import { RESERVED, STREET } from "./Occupancy.js";

/** A town's market place: base area, area per person served, and the most (m²). */
const MARKET_BASE_M2 = 900;
const MARKET_M2_PER_HEAD = 0.7;
const MARKET_MAX_M2 = 6000;
/** A village green reaches this far (m) along each road from the centre, more in a larger village. */
const GREEN_BASE_ARM = 55;
const GREEN_PEOPLE_PER_M = 25;
const GREEN_MAX_ARM = 120;
/** The lane round a great place of worship's precinct, metres out from its wall. */
const PRECINCT_LANE = 5;
/** People per place of worship in a city; one in the suburbs serves this many times as many. */
const WORSHIP_PEOPLE = 3500;
const SUBURB_WORSHIP = 1.6;

export function buildMarket(T) {
    const { kind, roads, centre: C, occupancy, input } = T;
    const random = T.R("market");
    const dryNearCentre = (road) => {
        let s = 0;
        for (let k = road.points.length - 1; k > 0 && s < 170; k--) {
            if (T.wdAt(road.points[k]) < 4) return false;
            s += dist(road.points[k], road.points[k - 1]);
        }
        return true;
    };
    const dry = roads.filter(dryNearCentre);
    const main = (dry.length ? dry : roads).reduce((a, b) => (a && (a.cls !== "minor" || b.cls === "minor") ? a : b), null);
    const tangent = (() => {
        if (!main) return 0;
        const points = main.points;
        const a = points[Math.max(0, points.length - 8)];
        const b = points[points.length - 1];
        return Math.atan2(b[1] - a[1], b[0] - a[0]);
    })();
    T.mainRoad = main;
    T.marketAngle = tangent;
    let market;
    if (kind === "city") {
        market = { kind: "square", polygon: rect([C[0] - Math.cos(tangent) * 40, C[1] - Math.sin(tangent) * 40], tangent, 95, 62) };
    } else if (kind === "town") {
        // A market place the town grew round: a square where the roads meet, lying along the main
        // street, sized by the people it serves, a little out of true
        const area = Math.min(MARKET_MAX_M2, MARKET_BASE_M2 + input.population * MARKET_M2_PER_HEAD);
        const ratio = random.range(1.3, 1.9);
        const long = Math.sqrt(area * ratio);
        const short = area / long;
        const square = rect([C[0] - Math.cos(tangent) * long * 0.25, C[1] - Math.sin(tangent) * long * 0.25], tangent, long, short);
        market = { kind: "place", polygon: square.map((p) => [p[0] + random.range(-0.08, 0.08) * short, p[1] + random.range(-0.08, 0.08) * short]) };
    } else {
        // A green where the roads meet
        const arms = roads.map((road) => {
            const points = road.points;
            let s = 0;
            let k = points.length - 1;
            while (k > 0 && s < Math.min(GREEN_MAX_ARM, GREEN_BASE_ARM + input.population / GREEN_PEOPLE_PER_M)) {
                s += dist(points[k], points[k - 1]);
                k--;
            }
            return points[k];
        });
        const ring = arms.length >= 3 ? arms : [...arms, [C[0] + random.range(-60, 60), C[1] + random.range(40, 70)]];
        const c0 = centroid(ring);
        ring.sort((a, b) => Math.atan2(a[1] - c0[1], a[0] - c0[0]) - Math.atan2(b[1] - c0[1], b[0] - c0[0]));
        market = { kind: "green", polygon: chaikinClosed(shrink(ring, 8), 2), pond: [c0[0] + random.range(-12, 12), c0[1] + random.range(-12, 12), random.range(7, 11)] };
    }
    occupancy.stampPolygon(market.polygon, RESERVED);
    // By the water the market stands back from it: moved inland until it is dry, clear of the quay
    if (T.shore?.main && market.kind !== "green") {
        const u = T.shore.main.u;
        for (let step = 0; step < 40 && market.polygon.some((p) => T.wdAt(p) < 14); step++) market.polygon = market.polygon.map((p) => [p[0] - u[0] * 8, p[1] - u[1] * 8]);
    }
    T.market = market;
}

export function buildWorship(T) {
    const { kind, input, centre: C, wall, streets, occupancy } = T;
    const random = T.R("worship");
    // The way every place of worship here faces
    const facing = random.range(-Math.PI, Math.PI);
    // The market's edge is a frontage too
    streets.push({ points: [...T.market.polygon, T.market.polygon[0]], half: 1.5, rank: 0, market: true });
    const worship = [];
    // A roadway through the grounds: places of worship are built in their own ground, roads go round them
    const roadSegments = streets.filter((street) => street.road);
    const acrossRoad = (poly) =>
        roadSegments.some((road) => {
            for (let k = 0; k + 1 < road.points.length; k++) {
                const a = road.points[k];
                const b = road.points[k + 1];
                const steps = Math.max(1, Math.ceil(dist(a, b) / 4));
                for (let u = 0; u <= steps; u++) if (pointInPolygon([a[0] + ((b[0] - a[0]) * u) / steps, a[1] + ((b[1] - a[1]) * u) / steps], poly)) return true;
            }
            return false;
        });
    const place = (target, size, yard, label, outside = false, faces = null) => {
        for (let tries = 0; tries < 400; tries++) {
            const a = tries * 2.39996;
            const r = 6 + tries * 2.2;
            const p = [target[0] + Math.cos(a) * r, target[1] + Math.sin(a) * r];
            const angle = (faces ?? facing) + random.range(-0.12, 0.12);
            const yardPoly = rect(p, angle, yard[0], yard[1]);
            if (outside ? !yardPoly.every((q) => T.suburbAt(q) && !pointInPolygon(q, wall.polygon)) : wall && !yardPoly.every((q) => pointInPolygon(q, wall.polygon))) continue;
            if (!occupancy.free(yardPoly, kind === "city") || acrossRoad(rect(p, angle, yard[0] + 2 * PRECINCT_LANE + 6, yard[1] + 2 * PRECINCT_LANE + 6))) continue;
            if (!streets.some((street) => street.points.some((q) => dist(q, p) < Math.max(yard[0], yard[1]) / 2 + 18))) continue;
            occupancy.stampPolygon(yardPoly, RESERVED);
            // Lanes that would cross the grounds are not built
            for (let k = streets.length - 1; k >= 0; k--) {
                const street = streets[k];
                if (street.rank !== 2 || street.points.length !== 2) continue;
                const [s0, s1] = street.points;
                if ([0, 0.25, 0.5, 0.75, 1].some((t) => pointInPolygon([s0[0] + (s1[0] - s0[0]) * t, s0[1] + (s1[1] - s0[1]) * t], yardPoly))) streets.splice(k, 1);
            }
            worship.push({ yard: yardPoly, body: worshipShape(p, angle, size[0], size[1], label === "great"), label });
            // A great place of worship stands in its precinct with a lane all round it
            if (label === "great") {
                const lane = rect(p, angle, yard[0] + 2 * PRECINCT_LANE, yard[1] + 2 * PRECINCT_LANE);
                const points = [...lane, lane[0]];
                streets.push({ points, half: 2.5, rank: 2, precinct: true });
                occupancy.stampPolyline(points, 2.5, STREET);
            }
            return true;
        }
        return false;
    };
    if (kind === "city") {
        const t = T.marketAngle;
        place([C[0] + Math.cos(t + 1.6) * 120, C[1] + Math.sin(t + 1.6) * 120], [72, 26], [125, 85], "great");
        // Places of worship spread through the built-up area: their sites thrown inside the walls
        // (or the core) no closer to each other than each one's share of the ground allows
        const inside = wall ? wall.share * input.population : input.population;
        const local = Math.max(2, Math.round(inside / WORSHIP_PEOPLE));
        const ground = wall?.polygon ?? T.core ?? null;
        const xs = ground ? ground.map((q) => q[0]) : [C[0] - 400, C[0] + 400];
        const ys = ground ? ground.map((q) => q[1]) : [C[1] - 400, C[1] + 400];
        const spacing = Math.sqrt((ground ? polygonArea(ground) : 640000) / local) * 0.7;
        const sites = [];
        for (let tries = 0; tries < local * 60 && sites.length < local; tries++) {
            const p = [random.range(Math.min(...xs), Math.max(...xs)), random.range(Math.min(...ys), Math.max(...ys))];
            if (ground && !pointInPolygon(p, ground)) continue;
            if (sites.some((q) => dist(p, q) < spacing) || dist(p, C) < 160) continue;
            sites.push(p);
        }
        for (const site of sites) place(site, [30, 12], [52, 40], "local");
        // The suburbs have theirs too, each serving more people than the old ones within the
        // walls, on the nearer suburban ground where the houses will stand
        if (wall && T.suburbAt) {
            const wanted = Math.round((input.population - inside) / (WORSHIP_PEOPLE * SUBURB_WORSHIP));
            const out = [];
            const reach = T.suburbReach;
            for (let tries = 0; tries < wanted * 200 && out.length < wanted; tries++) {
                const p = [random.range(-T.W / 2, T.W / 2), random.range(-T.H / 2, T.H / 2)];
                if (!T.suburbAt(p) || T.suburbRank(p) > reach * 0.6) continue;
                if ([...sites, ...out].some((q) => dist(p, q) < spacing)) continue;
                out.push(p);
            }
            for (const site of out) place(site, [30, 12], [52, 40], "local", true);
        }
    } else if (kind === "village" && T.market?.kind === "green" && !input.cave) {
        // A village's place of worship stands on its green, in its churchyard, its door to the green
        // (pre-sign-off, 2026-11-17: it had stood off in the fields, reached by a path): sited by
        // the green's edge furthest from the roads, its yard reaching back from the green
        const green = T.market.polygon;
        const gc = centroid(green);
        const roadPts = roads_(T);
        const edge = green.reduce((best, q) => {
            const d = Math.min(...roadPts.map((r) => dist(r, q)));
            return d > best.d ? { q, d } : best;
        }, { q: green[0], d: -1 }).q;
        const out = [edge[0] - gc[0], edge[1] - gc[1]];
        const L = Math.hypot(out[0], out[1]) || 1;
        const yard = [44, 34];
        const target = [edge[0] + (out[0] / L) * (yard[1] / 2 + 6), edge[1] + (out[1] / L) * (yard[1] / 2 + 6)];
        // (its entrance end towards the green, whatever the bearing the place's others would take:
        // the porch is at the hall's back along its angle)
        const facingGreen = Math.atan2(target[1] - gc[1], target[0] - gc[0]);
        if (!place(target, [24, 10], yard, "local", false, facingGreen)) place([C[0] + random.range(-60, 60), C[1] + random.range(-60, 60)], [24, 10], yard, "local");
        const w = worship[worship.length - 1];
        if (w) w.churchyard = true;
    } else {
        place([C[0] + random.range(-60, 60), C[1] + random.range(-60, 60)], kind === "town" ? [36, 14] : [24, 10], kind === "town" ? [62, 46] : [44, 34], "local");
        const w = worship[worship.length - 1];
        if (w && kind === "village") w.churchyard = true;
    }
    T.worship = worship;
}

/**
 * A place of worship's plan, of no one faith: a hall with a porch at its entrance end and a
 * smaller room at the far end; a great one has a court before its hall with a gateway, and a
 * range along each side of the court. The body's first part is the hall.
 */
/** Points along the place's roads near its centre. */
function roads_(T) {
    return T.roads.flatMap((r) => r.points.filter((p) => dist(p, T.centre) < 400));
}

export function worshipShape(c, angle, length, width, great) {
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    const at = (t) => [c[0] + ca * length * t, c[1] + sa * length * t];
    if (!great) {
        return [rect(at(0.06), angle, length * 0.72, width), rect(at(-0.38), angle, length * 0.12, width * 0.5), rect(at(0.44), angle, length * 0.12, width * 0.66)];
    }
    // The hall takes the far half; the court, ringed by two side ranges and a gateway, the near half
    const ranges = width * 0.25;
    return [
        rect(at(0.22), angle, length * 0.52, width),
        rect([at(-0.24)[0] - sa * (width / 2 - ranges / 2), at(-0.24)[1] + ca * (width / 2 - ranges / 2)], angle, length * 0.4, ranges),
        rect([at(-0.24)[0] + sa * (width / 2 - ranges / 2), at(-0.24)[1] - ca * (width / 2 - ranges / 2)], angle, length * 0.4, ranges),
        rect(at(-0.46), angle, length * 0.08, width * 0.4),
    ];
}
