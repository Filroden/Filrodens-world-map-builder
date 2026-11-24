// Cave mode: a settlement underground, drawn by the town engine with rock as its barrier.
//
// - The rock (`buildCaveShore`) stands in for the sea: open floor in the chambers, the galleries,
//   the tunnels and the side caverns, rock everywhere else and in the pillars left standing.
//   Every stage that keeps out of the water keeps out of the rock the same way; the tunnels are
//   the roads' only way out of the frame, and a river runs through the rock in flooded tunnels.
// - Plans (CAVE.PLANS): one great chamber with side caverns round it; winding galleries that are
//   the place's streets, opening into halls where they meet; or a chamber with galleries snaking
//   out from it as tracks run out from a town.
// - The rock is the wall: a fort closes each tunnel where it opens into the chamber
//   (`buildTunnelForts`).
// - Dwellings of the rock (`buildCaveDwellings`): houses cut into the walls of the chambers and
//   galleries, and the largest pillars hollowed as great houses, before the free-standing houses.
// - Food (`buildCaveFarms`): fungus beds and fish ponds on the floor the houses leave, then in the
//   side caverns, each with a pool; what still does not fit is bought (the spill), recorded in the
//   place's supply.
import { chaikin, compass, dist, exitPoint, lerp, offsetPolyline, polygonArea, resample, segmentDistance } from "../Geometry.js";
import { CAVE } from "../CaveInput.js";
import { RESERVED, STREET, BUILDING } from "./Occupancy.js";
import { rect } from "./Walls.js";

/** A natural chamber's outline: lobes from a few low harmonics, alcoves and bays, and wander. */
const LOBES = [2, 6];
const LOBE_AMPLITUDE = [0.03, 0.12];
const ALCOVES = [2, 5];
const ALCOVE_DEPTH = [0.12, 0.34];
const ALCOVE_WIDTH = [0.12, 0.3];
const BAY_SHARE = 0.3;
const WANDER = 0.09;
const FINE_WANDER = 0.025;
/** A chamber is longer one way than the other by up to this ratio. */
const ELONGATION = [1, 1.5];
/** The lake takes this share of the main chamber's floor, part way out from its middle; each side
 * cavern's pool this share of its floor. */
const LAKE_SHARE = 0.05;
const POOL_SHARE = 0.1;
/** Hollowed pillars: one per so many people; their radius (m). Lesser pillars: per hectare of floor; radius. */
const HOLLOW_PEOPLE = 1600;
const HOLLOW_RADIUS = [24, 40];
const PILLARS_PER_HA = 0.35;
const PILLAR_RADIUS = [4, 14];
/** No pillar stands within this distance (m) of the chamber's middle (the plaza) or of a way. */
const PLAZA_CLEAR = 170;
const TUNNEL_CLEAR = 26;
/** Houses cut into the rock: spacing and size (m). */
const ROCK_CUT_W = [7, 11];
const ROCK_CUT_DEPTH = [7, 10];
/** The ground kept clear before a house cut into the rock (m). */
const DOORSTEP = 4;
/** The lane along the main chamber's wall, this far (m) from it. */
const WALL_LANE = 7;
/** People a hollowed pillar holds, in houses' worth. */
const HOLLOW_HOUSES = 8;
/** Galleries: step (m), turn (degrees a step), pull back to their heading, half widths (m) of the
 * first and of branches, branch spacing (m), length of a run (m), how deep branches go. */
const GALLERY_STEP = 18;
const GALLERY_TURN = 16;
const GALLERY_PULL = 0.05;
const GALLERY_HALF = [16, 14];
const GALLERY_BRANCH = [140, 260];
const GALLERY_RUN = [380, 900];
const GALLERY_DEPTH = 4;
/** Halls where galleries meet: one per so many people (a galleried place; a hybrid half as many),
 * and their floor (m²). */
const HALL_PEOPLE = 2500;
const HALL_M2 = [8000, 20000];
/** A stair's or shaft's landing chamber (m²); the mountainside outside a great gate reaches this
 * far (m) in from the frame's edge. */
const LANDING_M2 = 1600;
const OUTSIDE_DEPTH = 110;
/** With a town before the gate, the land before the mountain reaches this share of the frame's
 * short side in from its edge, for its fields as well as the hold's; the face wanders by this share
 * of that, broadly (straight by the gate, within FACE_STRAIGHT m of it) and finely (m). */
const OUTSIDE_TOWN_SHARE = 0.4;
/** Half the width of the way between twin chambers (m). */
const TWIN_WAY_HALF = 24;
const FACE_WANDER = 0.35;
const FACE_STRAIGHT = 500;
const FACE_FINE = 8;
/** Side caverns: each about the mean of this many, sized by the room they are to make. */
const SIDE_COUNT = [6, 14];
/** Farm plots: their size (m) and the gap round each. */
const PLOT_SIZE = [32, 22];
const PLOT_GAP = 3;
/** A side cavern's pool keeps this many times its radius (and a little more) from any way. */
const POOL_CLEAR = 1.3;
/** Ponds lie within this distance (m) of a lake, a pool or the river. */
const POND_REACH = 60;
/** Rows of beds in a fungus plot (m apart). */
const BED_ROW = 3.2;

/**
 * A natural chamber about `centre`, of about `area` m²: its radius by angle, outline and test.
 * Lobes, alcoves and bays make it irregular, as a cave enlarged by its people would still be.
 */
export function chamber(centre, area, random, noise, salt, { elongate = true } = {}) {
    const lobes = [];
    for (let k = LOBES[0]; k <= LOBES[1]; k++) if (random.chance(0.7)) lobes.push({ k, a: random.range(LOBE_AMPLITUDE[0], LOBE_AMPLITUDE[1]) / Math.sqrt(k - 1), phase: random.range(0, 2 * Math.PI) });
    const alcoves = Array.from({ length: Math.floor(random.range(ALCOVES[0], ALCOVES[1] + 1)) }, () => ({
        at: random.range(-Math.PI, Math.PI),
        depth: random.range(ALCOVE_DEPTH[0], ALCOVE_DEPTH[1]) * (random.chance(BAY_SHARE) ? -0.6 : 1),
        width: random.range(ALCOVE_WIDTH[0], ALCOVE_WIDTH[1]),
    }));
    const e = elongate ? random.range(ELONGATION[0], ELONGATION[1]) : 1;
    const axis = random.range(0, Math.PI);
    const shape = (a) => {
        const ellipse = 1 / Math.hypot(Math.cos(a - axis) / Math.sqrt(e), Math.sin(a - axis) * Math.sqrt(e));
        let r = 1;
        for (const lobe of lobes) r += lobe.a * Math.cos(lobe.k * a + lobe.phase);
        for (const alcove of alcoves) {
            const d = Math.atan2(Math.sin(a - alcove.at), Math.cos(a - alcove.at));
            r += alcove.depth * Math.exp(-((d / alcove.width) ** 2));
        }
        r += WANDER * (noise.fbm(Math.cos(a) * 1.6 + salt, Math.sin(a) * 1.6 - salt, 3) - 0.5) * 2 + FINE_WANDER * (noise.value(a * 18 + salt, 3.3) - 0.5) * 2;
        return ellipse * Math.max(0.45, r);
    };
    const ring = (rAt, step) => {
        const out = [];
        const n = Math.max(36, Math.ceil((2 * Math.PI * rAt(0)) / step));
        for (let s = 0; s < n; s++) {
            const a = (s / n) * 2 * Math.PI - Math.PI;
            const r = rAt(a);
            out.push([centre[0] + Math.cos(a) * r, centre[1] + Math.sin(a) * r]);
        }
        return out;
    };
    // Scaled to its area
    const unit = ring(shape, 0.02);
    const scale = Math.sqrt(area / polygonArea(unit));
    const rAt = (a) => scale * shape(a);
    const outline = ring(rAt, Math.max(4, Math.min(8, scale / 40)));
    const radii = outline.map((p) => dist(p, centre));
    const rMin = Math.min(...radii);
    const rMax = Math.max(...radii);
    // Squared distances first, well clear of either bound, so most points need no square root
    const sureIn = (rMin * 0.98) ** 2 * (1 - 1e-9);
    const sureOut = (rMax * 1.02) ** 2 * (1 + 1e-9);
    const contains = (p) => {
        const dx = p[0] - centre[0];
        const dy = p[1] - centre[1];
        const s = dx * dx + dy * dy;
        if (s < sureIn) return true;
        if (s > sureOut) return false;
        const d = dist(p, centre);
        if (d < rMin * 0.98) return true;
        if (d > rMax * 1.02) return false;
        return d < rAt(Math.atan2(p[1] - centre[1], p[0] - centre[0]));
    };
    return { c: centre, rAt, outline, rMin, rMax, contains, area: polygonArea(outline) };
}

/** Buckets of way segments, for quick tests of whether a point is in a way. */
export function wayIndex(ways, cell = 80) {
    const buckets = new Map();
    for (const way of ways) {
        for (let k = 0; k + 1 < way.points.length; k++) {
            const a = way.points[k];
            const b = way.points[k + 1];
            const reach = way.half + 2;
            for (let j = Math.floor((Math.min(a[1], b[1]) - reach) / cell); j <= Math.floor((Math.max(a[1], b[1]) + reach) / cell); j++) {
                for (let i = Math.floor((Math.min(a[0], b[0]) - reach) / cell); i <= Math.floor((Math.max(a[0], b[0]) + reach) / cell); i++) {
                    const key = i * 65536 + j;
                    if (!buckets.has(key)) buckets.set(key, []);
                    buckets.get(key).push({ a, b, half: way.half, way });
                }
            }
        }
    }
    // Numeric keys (frames are far smaller than 65,536 cells a side)
    const near = (p) => buckets.get(Math.floor(p[0] / cell) * 65536 + Math.floor(p[1] / cell)) ?? [];
    return {
        inside: (p) => near(p).some((s) => segmentDistance(p, s.a, s.b) < s.half),
        distance: (p, except = null) => {
            let best = Infinity;
            for (const s of near(p)) if (s.way !== except) best = Math.min(best, segmentDistance(p, s.a, s.b) - s.half);
            return best;
        },
    };
}

/**
 * The rock and open floor of a cavern settlement's frame, as a shore-like record for the terrain
 * stage: `wetAt` is true in the rock and the water.
 */
export function buildCaveShore(T) {
    const { input, noise, W, H } = T;
    const random = T.R("cavern");
    const plan = input.cave.plan ?? "chamber";
    // Two great chambers side by side share the floor: the first holds the plaza
    const twinShare = plan === "twin" ? random.range(0.38, 0.48) : 0;
    const main = chamber([0, 0], input.cave.floorM2 * (1 - twinShare), random, noise, 5.1);
    const chambers = [main];
    let twin = null;
    if (twinShare) {
        const area = input.cave.floorM2 * twinShare;
        const r = Math.sqrt(area / Math.PI);
        for (let tries = 0; tries < 40 && !twin; tries++) {
            const bearing = random.range(0, 360);
            if (input.roads.some((road) => Math.abs(((road.bearing - bearing + 540) % 360) - 180) < 40)) continue;
            const u = compass(bearing);
            const a = Math.atan2(u[1], u[0]);
            const d = main.rAt(a) + r * 1.1 + random.range(40, 120);
            const c = [u[0] * d, u[1] * d];
            if (Math.abs(c[0]) > W / 2 - r * 1.4 - 40 || Math.abs(c[1]) > H / 2 - r * 1.4 - 40) continue;
            twin = chamber(c, area, random, noise, 7.7);
            twin.twin = true;
        }
        if (twin) chambers.push(twin);
    }
    const inCore = (p) => main.contains(p) || (twin ? twin.contains(p) : false);
    const inChamber = (p) => chambers.some((c) => c.contains(p));
    const margin = (p, by) => Math.abs(p[0]) < W / 2 - by && Math.abs(p[1]) < H / 2 - by;
    // A hold's stairs and shafts land in small chambers of their own, the same on every level
    const landings = (input.cave.landings ?? []).map((c, k) => {
        const landing = chamber(c, LANDING_M2, random, noise, 90 + k * 1.3, { elongate: false });
        landing.landing = true;
        chambers.push(landing);
        return landing;
    });
    const nearLanding = (p, by) => landings.some((l) => dist(l.c, p) < l.rMax + by);
    // A great gate onto the surface: the mountainside outside it, beyond the gate road's tunnel
    let outside = null;
    if (input.cave.gate) {
        // The foot of the mountain's face, drawn as a coast is: a line across the frame on the
        // gate's side, wandering into spurs and bays, straighter by the gate
        const u = compass(input.cave.gate.bearing);
        const v = [-u[1], u[0]];
        const edge = exitPoint([0, 0], u, T.half, 0);
        const depth = input.cave.townOutside ? OUTSIDE_TOWN_SHARE * Math.min(W, H) : OUTSIDE_DEPTH;
        const reachOut = edge[0] * u[0] + edge[1] * u[1] - depth;
        const at = (t) => {
            const fade = Math.min(1, (Math.abs(t) / FACE_STRAIGHT) ** 2);
            return reachOut + fade * FACE_WANDER * depth * (noise.fbm(t / 520 + 31.1, 6.6, 3) - 0.5) * 2 + FACE_FINE * (noise.value(t / 70 + 2.2, 4.4) - 0.5) * 2;
        };
        const span = Math.hypot(W, H) / 2 + 40;
        const face = [];
        for (let t = -span; t <= span; t += 10) face.push([u[0] * at(t) + v[0] * t, u[1] * at(t) + v[1] * t]);
        // The open land: the face and far beyond it, past the frame's corners (a drawing clips it)
        const far = Math.hypot(W, H);
        const poly = [...face, [face[face.length - 1][0] + u[0] * far, face[face.length - 1][1] + u[1] * far], [face[0][0] + u[0] * far, face[0][1] + u[1] * far]];
        outside = {
            bearing: input.cave.gate.bearing,
            u,
            v,
            reach: reachOut,
            depth,
            at,
            face: face.filter((p) => Math.abs(p[0]) <= W / 2 && Math.abs(p[1]) <= H / 2),
            poly,
            into: (p) => p[0] * u[0] + p[1] * u[1] - at(p[0] * v[0] + p[1] * v[1]),
            contains: (p) => p[0] * u[0] + p[1] * u[1] > at(p[0] * v[0] + p[1] * v[1]),
        };
    }
    // How far a point lies inside the mountainside (negative while it is under the rock)
    const intoOutside = (p) => (outside ? outside.into(p) : -Infinity);

    // The main ways: from inside the chamber out to the frame's edge on each tunnel's bearing,
    // bending a little on the way
    const tunnels = input.roads.map((road, index) => {
        const v = compass(road.bearing);
        const a = Math.atan2(v[1], v[0]);
        const start = [v[0] * main.rAt(a) * 0.8, v[1] * main.rAt(a) * 0.8];
        const end = exitPoint([0, 0], v, T.half, -30);
        const length = dist(start, end);
        const n = [-v[1], v[0]];
        const points = [];
        const steps = Math.max(6, Math.ceil(length / 60));
        for (let s = 0; s <= steps; s++) {
            const t = s / steps;
            const p = lerp(start, end, t);
            const off = length * 0.035 * (noise.fbm(t * 2.2 + index * 7.3, index * 3.1 + 0.7, 2) - 0.5) * 2 * Math.sin(Math.PI * t);
            points.push([p[0] + n[0] * off, p[1] + n[1] * off]);
        }
        const mouth = [v[0] * main.rAt(a), v[1] * main.rAt(a)];
        return { bearing: road.bearing, points, half: CAVE.TUNNEL_HALF, mouth, poly: corridor(points, CAVE.TUNNEL_HALF) };
    });
    const tunnelIndex = wayIndex(tunnels);

    // Galleries: winding wide ways out from the chamber, branching, ending where they meet another
    // or reach as far as the place reaches
    const galleries = plan === "chamber" ? [] : growGalleries(T, main, tunnels, random, landings, intoOutside);
    const galleryIndex = wayIndex(galleries);
    // Halls where galleries meet or bend, each a chamber of its own
    if (plan !== "chamber") {
        const wanted = Math.round(input.population / HALL_PEOPLE / (plan === "hybrid" ? 2 : 1));
        const spots = galleries.flatMap((g) => g.points.filter((_, k) => k > 3 && k % 6 === 0));
        for (let tries = 0; tries < wanted * 40 && chambers.filter((c) => c.hall).length < wanted && spots.length; tries++) {
            const c = spots[Math.floor(random.next() * spots.length)];
            const area = random.range(HALL_M2[0], HALL_M2[1]);
            const r = Math.sqrt(area / Math.PI);
            if (!margin(c, r * 1.4 + 40)) continue;
            if (chambers.some((other) => dist(other.c, c) < other.rMax + r * 1.4 + 50)) continue;
            if (tunnels.some(() => tunnelIndex.distance(c) < r * 1.3)) continue;
            const hall = chamber(c, area, random, noise, chambers.length * 3.3 + 0.7);
            hall.hall = true;
            chambers.push(hall);
        }
    }

    // Side caverns: farm chambers off the tunnels, the galleries and the chamber, each joined by a
    // passage and with a pool for fish and water, until they make room for their share of the beds
    const sides = [];
    const targetCount = Math.round(random.range(SIDE_COUNT[0], SIDE_COUNT[1]) * Math.min(1, Math.sqrt(input.population / 20000)) + 2);
    const meanArea = input.cave.sideM2 / targetCount;
    const anchors = [];
    for (const tunnel of tunnels) for (const p of tunnel.points.slice(2)) if (!main.contains(p)) anchors.push({ p, n: normalAt(tunnel.points, p) });
    for (const g of galleries) for (const p of g.points.slice(3).filter((_, k) => k % 4 === 0)) anchors.push({ p, n: normalAt(g.points, p) });
    for (let k = 0; k < main.outline.length; k += 6) {
        const p = main.outline[k];
        const d = dist(p, main.c) || 1;
        anchors.push({ p, n: [(p[0] - main.c[0]) / d, (p[1] - main.c[1]) / d], radial: true });
    }
    let sideArea = 0;
    for (let tries = 0; tries < 900 && sideArea < input.cave.sideM2 && anchors.length; tries++) {
        const anchor = anchors[Math.floor(random.next() * anchors.length)];
        const area = Math.min(input.cave.sideM2 - sideArea + meanArea * 0.3, meanArea * random.range(0.6, 1.4));
        const r = Math.sqrt(area / Math.PI);
        const side = anchor.radial ? 1 : random.chance(0.5) ? 1 : -1;
        const off = r + random.range(40, 110);
        const c = [anchor.p[0] + anchor.n[0] * side * off, anchor.p[1] + anchor.n[1] * side * off];
        if (!margin(c, r * 1.35 + 20) || intoOutside(c) > -(r * 1.35 + 40)) continue;
        if (chambers.some((ch) => dist(ch.c, c) < ch.rAt(Math.atan2(c[1] - ch.c[1], c[0] - ch.c[0])) + r * 1.35 + 40)) continue;
        if (sides.some((s) => dist(s.c, c) < s.chamber.rMax + r * 1.35 + 40)) continue;
        if (tunnelIndex.distance(c) < r * 1.35 + 25 || galleryIndex.distance(c) < r * 1.35 + 25) continue;
        const cave = chamber(c, area, random, noise, 40 + sides.length * 2.9, { elongate: true });
        // Its pool, part way out from its middle, never across a gallery or a tunnel that runs past
        // (a side cavern may reach one; its water must not cut the way): turned round the middle
        // until it is clear, else the cavern has none
        const pr = Math.sqrt((POOL_SHARE * cave.area) / Math.PI);
        let pa = random.range(-Math.PI, Math.PI);
        let pool = null;
        for (let turn = 0; turn < 6 && !pool; turn++, pa += Math.PI / 3) {
            const pc = [c[0] + Math.cos(pa) * cave.rAt(pa) * 0.4, c[1] + Math.sin(pa) * cave.rAt(pa) * 0.4];
            if (galleryIndex.distance(pc) < pr * POOL_CLEAR + 12 || tunnelIndex.distance(pc) < pr * POOL_CLEAR + 12) continue;
            pool = blob(pc, pr, noise, 60 + sides.length * 1.7);
        }
        const branch = [anchor.p, c];
        sides.push({ c, r, chamber: cave, outline: cave.outline, pool, branch, branchPoly: corridor(branch, CAVE.BRANCH_HALF) });
        sideArea += cave.area;
    }
    // In a single chamber, a landing beyond its wall has a passage to the chamber's middle
    const cores = [main, twin].filter(Boolean);
    const nearestCore = (p) => cores.reduce((a, b) => (dist(b.c, p) < dist(a.c, p) ? b : a));
    const passages = plan === "chamber" || plan === "twin" ? landings.filter((l) => !inCore(l.c)).map((l) => ({ points: [l.c, lerp(l.c, nearestCore(l.c).c, 0.97)], half: CAVE.BRANCH_HALF })) : [];
    // Twin chambers are joined by a broad way
    if (twin) passages.push({ points: [main.c, twin.c], half: TWIN_WAY_HALF });
    const branches = [...sides.map((s) => ({ points: s.branch, half: CAVE.BRANCH_HALF })), ...passages];
    const branchIndex = wayIndex(branches);
    const inSide = (p) => sides.some((s) => s.chamber.contains(p));
    const openAt = (p) => inChamber(p) || tunnelIndex.inside(p) || galleryIndex.inside(p) || branchIndex.inside(p) || inSide(p) || (outside ? outside.contains(p) : false);

    // The lake in the main chamber, part way out from the middle (a galleried place's hub is too
    // small for one: its water is in the side caverns' pools and the river)
    let lake = null;
    if (plan !== "streets") {
        const at = random.range(-Math.PI, Math.PI);
        const r = Math.sqrt((LAKE_SHARE * main.area) / Math.PI);
        const out = random.range(0.42, 0.6) * main.rAt(at);
        lake = blob([Math.cos(at) * out, Math.sin(at) * out], r, noise, -8.2);
        // Never over a stair's or shaft's landing: the lake is dropped rather than moved
        if (nearLanding(lake.c, r * 1.4 + 20)) lake = null;
    }
    const waters = [lake, ...sides.map((s) => s.pool)].filter(Boolean);
    const lakeAt = (p) => waters.some((w) => w.contains(p)) && openAt(p);

    // Pillars: the largest hollowed as great houses, in the main chamber and the halls, the rest
    // left as rock
    const pillars = [];
    const hollowCount = Math.round(input.population / HOLLOW_PEOPLE);
    const halls = chambers.filter((c) => c.hall);
    const wanted = [];
    for (let k = 0; k < hollowCount; k++) wanted.push({ hollow: true, in: halls.length && k % 2 === 1 && plan !== "chamber" ? halls[k % halls.length] : plan === "streets" && halls.length ? halls[k % halls.length] : main });
    for (const c of chambers) for (let k = 0; k < Math.round((c.area / 10000) * PILLARS_PER_HA); k++) wanted.push({ hollow: false, in: c });
    // Nor on the way in from each tunnel to the plaza, where the roads will run
    const approachIndex = wayIndex(tunnels.map((t) => ({ points: [t.points[0], main.c], half: CAVE.TUNNEL_HALF })));
    const ways = (p, r) => tunnelIndex.distance(p) > r + TUNNEL_CLEAR && approachIndex.distance(p) > r + TUNNEL_CLEAR * 2 && galleryIndex.distance(p) > r + 4 && branchIndex.distance(p) > r + 12;
    const tryIn = (ch, hollow, [lo, hi]) => {
        const clear = ch === main ? Math.min(PLAZA_CLEAR, main.rMin * 0.4) : 0;
        for (let tries = 0; tries < 60; tries++) {
            const r = Math.min(random.range(lo, hi), ch.rMin * (ch.hall ? 0.3 : 0.35));
            const a = random.range(-Math.PI, Math.PI);
            const d = Math.sqrt(random.next()) * ch.rMax;
            const c = [ch.c[0] + Math.cos(a) * d, ch.c[1] + Math.sin(a) * d];
            if (d < clear + r) continue;
            if (ch.rAt(Math.atan2(c[1] - ch.c[1], c[0] - ch.c[0])) - d < r + 15) continue;
            if (waters.some((w) => dist(c, w.c) < w.r * 1.35 + r + 12)) continue;
            if (!ways(c, r)) continue;
            if (nearLanding(c, r + 25)) continue;
            if (pillars.some((p) => dist(p.c, c) < p.r + r + 18)) continue;
            pillars.push({ c, r, hollow, outline: circle(c, r) });
            return true;
        }
        return false;
    };
    for (const want of wanted) {
        // A great house is tried in its own chamber first, then in any other with room for it
        const order = want.hollow ? [want.in, ...chambers.filter((c) => c !== want.in)] : [want.in];
        order.some((ch) => tryIn(ch, want.hollow, want.hollow ? HOLLOW_RADIUS : PILLAR_RADIUS));
    }
    const pillarCell = 60;
    const pillarBuckets = new Map();
    const bucketPillars = () => {
        pillarBuckets.clear();
        for (const p of pillars) {
            for (let j = Math.floor((p.c[1] - p.r) / pillarCell); j <= Math.floor((p.c[1] + p.r) / pillarCell); j++) {
                for (let i = Math.floor((p.c[0] - p.r) / pillarCell); i <= Math.floor((p.c[0] + p.r) / pillarCell); i++) {
                    const key = i * 65536 + j;
                    if (!pillarBuckets.has(key)) pillarBuckets.set(key, []);
                    pillarBuckets.get(key).push(p);
                }
            }
        }
    };
    bucketPillars();
    const inPillar = (p) => (pillarBuckets.get(Math.floor(p[0] / pillarCell) * 65536 + Math.floor(p[1] / pillarCell)) ?? []).some((q) => dist(p, q.c) < q.r);
    // A river runs through the rock in flooded tunnels: its course is laid by the terrain stage,
    // which tells the rock where it is (`floodWith`)
    let flood = null;
    const rockAt = (p) => (!openAt(p) && !(flood && flood.inside(p))) || inPillar(p);
    // Air shafts up to the surface, on the chambers' floors, clear of everything else
    const airShafts = [];
    for (let tries = 0; tries < 400 && airShafts.length < (input.cave.airShafts ?? 0); tries++) {
        const ch = chambers.filter((c) => !c.landing)[Math.floor(random.next() * chambers.filter((c) => !c.landing).length)];
        const a = random.range(-Math.PI, Math.PI);
        const p = [ch.c[0] + Math.cos(a) * ch.rMin * random.range(0.3, 0.8), ch.c[1] + Math.sin(a) * ch.rMin * random.range(0.3, 0.8)];
        if (rockAt(p) || lakeAt(p) || nearLanding(p, 30) || dist(p, main.c) < Math.min(120, main.rMin * 0.4) || airShafts.some((q) => dist(q, p) < 150) || !ways(p, 8)) continue;
        airShafts.push(p);
    }
    return {
        body: "rock",
        lines: [],
        island: null,
        main: null,
        cave: { plan, outline: main.outline, radiusAt: main.rAt, main, twin, chambers, halls, galleries, passages, radiusM: input.cave.radiusM, floorHa: (main.area + (twin ? twin.area : 0)) / 10000, tunnels, sides, lake, waters, pillars, landings, outside, airShafts },
        wetAt: (p) => rockAt(p) || lakeAt(p) || (flood ? flood.inside(p) : false),
        rockAt,
        lakeAt,
        openAt,
        inMain: main.contains,
        inCore,
        inChamber,
        inSide,
        inGallery: galleryIndex.inside,
        // A pillar a road was laid through after all is cut away
        clearPillarsFrom(lines, by) {
            const before = pillars.length;
            for (let k = pillars.length - 1; k >= 0; k--) {
                const q = pillars[k];
                if (lines.some((line) => line.some((a, j) => j + 1 < line.length && segmentDistance(q.c, a, line[j + 1]) < q.r + by))) pillars.splice(k, 1);
            }
            if (pillars.length !== before) bucketPillars();
        },
        floodWith(river) {
            flood = wayIndex([{ points: river.line, half: river.width / 2 + 2 }]);
        },
    };
}

/** Winding galleries out from the chamber: their total length the place's need, as a tree of
 * runs that branch, and end where they meet another way, the frame's margin or the place's reach. */
function growGalleries(T, main, tunnels, random, landings = [], intoOutside = () => -Infinity) {
    const { input, noise, W, H } = T;
    const target = input.cave.galleryM;
    const reach = input.cave.reachM;
    const galleries = [];
    let total = 0;
    const cell = 60;
    const seen = new Map();
    const key = (p) => `${Math.floor(p[0] / cell)},${Math.floor(p[1] / cell)}`;
    const nearOther = (p, own, by) => {
        const i = Math.floor(p[0] / cell);
        const j = Math.floor(p[1] / cell);
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) for (const q of seen.get(`${i + di},${j + dj}`) ?? []) if (q.id !== own && dist(q.p, p) < by) return q.p;
        return null;
    };
    const tunnelIndex = wayIndex(tunnels);
    // Out from the chamber's wall at headings spread round it, clear of the tunnels
    const count = Math.max(3, Math.min(9, Math.round(target / 1800)));
    const base = random.range(0, 2 * Math.PI);
    // The landings of a hold's stairs and shafts first, each a gallery making for the hub
    const heads = landings.filter((l) => !main.contains(l.c)).map((l) => ({ p: l.c, heading: Math.atan2(main.c[1] - l.c[1], main.c[0] - l.c[0]), depth: 0, half: GALLERY_HALF[1], toward: main.c }));
    for (let k = 0; k < count; k++) {
        const a = base + (k / count) * 2 * Math.PI + random.range(-0.2, 0.2);
        const start = [main.c[0] + Math.cos(a) * main.rAt(a) * 0.9, main.c[1] + Math.sin(a) * main.rAt(a) * 0.9];
        heads.push({ p: start, heading: a, depth: 0, half: GALLERY_HALF[0] });
    }
    let id = 0;
    let restarts = 0;
    while ((total < target || heads.some((h) => h.toward)) && restarts < 300) {
        // When every run has ended short of the length wanted, another sets out from a gallery
        if (!heads.length) {
            restarts++;
            // Only a gallery long enough to branch from (a landing's run can be a step or two)
            const long = galleries.filter((g) => g.points.length >= 5);
            const from = long[Math.floor(random.next() * long.length)];
            if (!from) break;
            const at = Math.floor(random.range(2, from.points.length - 2));
            const a = from.points[at - 1];
            const b = from.points[at + 1];
            const heading = Math.atan2(b[1] - a[1], b[0] - a[0]) + (random.chance(0.5) ? 1 : -1) * random.range(1.2, 1.9);
            const p0 = from.points[at];
            heads.push({ p: [p0[0] + Math.cos(heading) * from.half, p0[1] + Math.sin(heading) * from.half], heading, depth: 1, half: GALLERY_HALF[1] });
        }
        const head = heads.shift();
        const own = id++;
        const points = [head.p];
        let p = head.p;
        let heading = head.heading;
        const toward = head.toward ?? null;
        const run = toward ? Infinity : random.range(GALLERY_RUN[0], GALLERY_RUN[1]) / (1 + 0.4 * head.depth);
        let nextBranch = random.range(GALLERY_BRANCH[0], GALLERY_BRANCH[1]);
        let s = 0;
        for (let k = 0; k < 600 && s < run && (toward || total + s < target); k++) {
            // A landing's gallery keeps making for the hub, winding a little on the way
            const aim = toward ? Math.atan2(toward[1] - p[1], toward[0] - p[0]) : head.heading;
            const pull = toward ? 0.25 : GALLERY_PULL;
            heading += ((GALLERY_TURN * Math.PI) / 180) * (toward ? 0.6 : 1) * (noise.fbm(k * 0.11 + own * 3.7, own * 1.3 + 9.1, 2) - 0.5) * 2 + Math.atan2(Math.sin(aim - heading), Math.cos(aim - heading)) * pull;
            const q = [p[0] + Math.cos(heading) * GALLERY_STEP, p[1] + Math.sin(heading) * GALLERY_STEP];
            if (Math.abs(q[0]) > W / 2 - 60 || Math.abs(q[1]) > H / 2 - 60) break;
            if (!toward && Math.hypot(q[0], q[1]) > reach) break;
            if (intoOutside(q) > -60) break;
            if ((toward || k > 3) && main.contains(q)) {
                if (toward) points.push(q);
                break;
            }
            if (k > 2 && tunnelIndex.distance(q) < head.half) break;
            const meet = k > 3 ? nearOther(q, own, head.half * 1.6) : null;
            if (meet) {
                points.push(meet);
                s += dist(p, meet);
                break;
            }
            points.push(q);
            s += GALLERY_STEP;
            p = q;
            if (s > nextBranch && head.depth < GALLERY_DEPTH) {
                nextBranch = s + random.range(GALLERY_BRANCH[0], GALLERY_BRANCH[1]);
                const turn = random.range(0.9, 1.6) * (random.chance(0.5) ? 1 : -1);
                heads.push({ p, heading: heading + turn, depth: head.depth + 1, half: GALLERY_HALF[1] });
            }
        }
        if (points.length < (toward ? 2 : 4)) continue;
        const line = chaikin(points, 2);
        galleries.push({ points: line, half: head.half, depth: head.depth, poly: corridor(line, head.half) });
        for (const q of resample(line, 20)) {
            const k2 = key(q);
            if (!seen.has(k2)) seen.set(k2, []);
            seen.get(k2).push({ p: q, id: own });
        }
        total += s;
    }
    return galleries;
}

function normalAt(points, p) {
    let at = 0;
    for (let k = 0; k < points.length; k++) if (dist(points[k], p) < dist(points[at], p)) at = k;
    const a = points[Math.max(0, at - 1)];
    const b = points[Math.min(points.length - 1, at + 1)];
    const d = dist(a, b) || 1;
    return [-(b[1] - a[1]) / d, (b[0] - a[0]) / d];
}

function circle(c, r) {
    const n = Math.max(12, Math.ceil((2 * Math.PI * r) / 3));
    return Array.from({ length: n }, (_, k) => [c[0] + Math.cos((k / n) * 2 * Math.PI) * r, c[1] + Math.sin((k / n) * 2 * Math.PI) * r]);
}

/** A rounded patch of water about `c`. */
function blob(c, r, noise, salt) {
    const rAt = (a) => r * (1 + 0.3 * (noise.fbm(Math.cos(a) * 1.5 + salt, Math.sin(a) * 1.5 - salt, 3) - 0.5) * 2);
    const n = Math.max(24, Math.ceil((2 * Math.PI * r) / 6));
    const outline = Array.from({ length: n }, (_, k) => {
        const a = (k / n) * 2 * Math.PI;
        return [c[0] + Math.cos(a) * rAt(a), c[1] + Math.sin(a) * rAt(a)];
    });
    return { c, r, outline, contains: (p) => dist(p, c) < r * 1.4 && dist(p, c) < rAt(Math.atan2(p[1] - c[1], p[0] - c[0])) };
}

/** A way's corridor as a polygon: its two sides joined at the ends. */
export function corridor(points, half) {
    const left = offsetPolyline(points, half);
    const right = offsetPolyline(points, -half);
    return [...left, ...right.reverse()];
}

/**
 * Each road out of the chamber keeps to its tunnel: from where the tunnel opens off the chamber's
 * floor to the frame's edge it runs down the tunnel's middle, rather than the least-cost path's
 * cells, which can graze the rock beside it.
 */
export function followTunnels(T) {
    const { shore } = T;
    for (const road of T.roads) {
        const tunnel = shore.cave.tunnels.find((t) => t.bearing === road.bearing);
        if (!tunnel) continue;
        const start = tunnel.points[0];
        const reach = Math.hypot(start[0], start[1]);
        const outer = tunnel.points.slice().reverse().filter((p) => T.inFrame(p));
        const at = road.points.findIndex((p) => Math.hypot(p[0], p[1]) < reach && shore.inMain(p));
        if (at < 0 || !outer.length) continue;
        road.points = [exitPoint([0, 0], compass(road.leaves), T.half, 0), ...outer, ...road.points.slice(at)];
    }
    shore.clearPillarsFrom(T.roads.map((road) => road.points), CAVE.TUNNEL_HALF);
}

/** A fort where each tunnel opens into the chamber: a gatehouse across the way and a tower each side. */
export function buildTunnelForts(T) {
    const { shore, roads, occupancy } = T;
    T.forts = [];
    for (const road of roads) {
        // Where the road comes in out of the rock: the first point inside the main chamber
        const at = road.points.findIndex((p) => shore.inMain(p));
        if (at <= 0) continue;
        const p = road.points[at];
        const q = road.points[Math.max(0, at - 3)];
        const dir = Math.atan2(p[1] - q[1], p[0] - q[0]);
        const house = rect(p, dir, 14, CAVE.TUNNEL_HALF * 2 + 8);
        const n = [-Math.sin(dir), Math.cos(dir)];
        const towers = [1, -1].map((s) => [p[0] + n[0] * s * (CAVE.TUNNEL_HALF + 6), p[1] + n[1] * s * (CAVE.TUNNEL_HALF + 6)]);
        T.forts.push({ p, dir, house, towers, bearing: road.bearing });
        occupancy.stampPolygon(rect(p, dir, 30, CAVE.TUNNEL_HALF * 2 + 30), RESERVED);
        occupancy.clearPolyline(road.points, road.width / 2, RESERVED, STREET);
    }
    // The great gate where the gate road's tunnel opens onto the mountainside
    const outside = shore.cave.outside;
    const gateRoad = outside && roads.find((road) => road.bearing === outside.bearing);
    if (gateRoad) {
        const into = (p) => p[0] * outside.u[0] + p[1] * outside.u[1] - outside.reach;
        const at = gateRoad.points.findIndex((p, k) => k > 0 && into(p) <= 0);
        if (at > 0) {
            const a = gateRoad.points[at - 1];
            const b = gateRoad.points[at];
            const t = into(a) / (into(a) - into(b));
            const p = lerp(a, b, t);
            const dir = Math.atan2(b[1] - a[1], b[0] - a[0]);
            const n = [-Math.sin(dir), Math.cos(dir)];
            T.gate = { p, dir, house: rect(p, dir, 20, CAVE.TUNNEL_HALF * 2 + 22), towers: [1, -1].map((s) => [p[0] + n[0] * s * (CAVE.TUNNEL_HALF + 12), p[1] + n[1] * s * (CAVE.TUNNEL_HALF + 12)]) };
            // With a town of its own outside, the gate road ends at the gate: the town's road meets it there
            if (T.input.cave.townOutside) gateRoad.points = [p, ...gateRoad.points.slice(at)];
        }
    }
}

/** The galleries' streets: one down the middle of each, the place's high streets. */
export function buildGalleryStreets(T) {
    const { shore, occupancy } = T;
    for (const g of shore.cave.galleries) {
        const street = { points: g.points, half: 3.5, rank: 1, gallery: true };
        T.streets.push(street);
        occupancy.stampPolyline(g.points, street.half, STREET);
    }
}

/** The lane along the main chamber's wall, where the floor beside it is open. */
export function buildWallLane(T) {
    for (const ch of [T.shore.cave.main, T.shore.cave.twin].filter(Boolean)) wallLane(T, ch);
}

function wallLane(T, ch) {
    const { occupancy } = T;
    const c = ch.c;
    const ring = ch.outline.map((p) => {
        const d = dist(p, c) || 1;
        return [c[0] + ((p[0] - c[0]) * (d - WALL_LANE)) / d, c[1] + ((p[1] - c[1]) * (d - WALL_LANE)) / d];
    });
    let run = [];
    const runs = [];
    for (const p of [...ring, ring[0]]) {
        if (!T.seaAt(p) && T.wdAt(p) > 3 && T.occupancy.at(p) !== RESERVED) run.push(p);
        else {
            if (run.length > 6) runs.push(run);
            run = [];
        }
    }
    if (run.length > 6) runs.push(run);
    for (const points of runs) {
        T.streets.push({ points, half: 2.5, rank: 2, wallLane: true });
        occupancy.stampPolyline(points, 2.5, STREET);
    }
}

/**
 * Houses cut into the walls of the chambers and galleries, and the hollowed pillars, made before
 * the free-standing houses (which then house the rest). Each house cut into the rock keeps a
 * doorstep clear before it.
 */
export function buildCaveDwellings(T) {
    const { shore, input, P, occupancy } = T;
    const random = T.R("rock-houses");
    const buildings = [];
    const target = Math.round(input.population / P.perBuilding);
    const hollow = shore.cave.pillars.filter((p) => p.hollow);
    for (const p of hollow) buildings.push({ poly: p.outline, kind: "house", hollow: true, rank: 1 });
    // The walls: each chamber's (facing out from its middle), and each gallery's two sides
    const sites = [];
    for (const ch of shore.cave.chambers) {
        const o = ch.outline;
        for (let k = 0; k < o.length; k++) {
            const a = o[k];
            const b = o[(k + 1) % o.length];
            const mid = lerp(a, b, 0.5);
            const d = dist(mid, ch.c) || 1;
            sites.push({ mid, along: unit([b[0] - a[0], b[1] - a[1]]), out: [(mid[0] - ch.c[0]) / d, (mid[1] - ch.c[1]) / d], length: dist(a, b) });
        }
    }
    for (const g of shore.cave.galleries) {
        const line = resample(g.points, 6);
        for (let k = 1; k + 1 < line.length; k++) {
            const along = unit([line[k + 1][0] - line[k - 1][0], line[k + 1][1] - line[k - 1][1]]);
            const n = [-along[1], along[0]];
            for (const side of [1, -1]) sites.push({ mid: [line[k][0] + n[0] * side * (g.half + 0.2), line[k][1] + n[1] * side * (g.half + 0.2)], along, out: [n[0] * side, n[1] * side], length: 6 });
        }
    }
    // Nearest the place's middle first, until their share is cut
    sites.sort((a, b) => Math.hypot(a.mid[0], a.mid[1]) - Math.hypot(b.mid[0], b.mid[1]) + random.range(-30, 30));
    const quota = Math.round(target * (input.cave.rockCut ?? 0.12));
    const placedCut = [];
    for (const site of sites) {
        if (placedCut.length >= quota) break;
        const { mid, along, out } = site;
        const w = random.range(ROCK_CUT_W[0], ROCK_CUT_W[1]);
        const d = random.range(ROCK_CUT_DEPTH[0], ROCK_CUT_DEPTH[1]);
        const face = [mid[0] - out[0] * 0.5, mid[1] - out[1] * 0.5];
        const poly = [
            [face[0] - along[0] * w * 0.5, face[1] - along[1] * w * 0.5],
            [face[0] + along[0] * w * 0.5, face[1] + along[1] * w * 0.5],
            [face[0] + along[0] * w * 0.5 + out[0] * d, face[1] + along[1] * w * 0.5 + out[1] * d],
            [face[0] - along[0] * w * 0.5 + out[0] * d, face[1] - along[1] * w * 0.5 + out[1] * d],
        ];
        // In the rock behind the face, clear of every way and each other, with open dry floor
        // before it
        const front = [mid[0] - out[0] * (WALL_LANE + 1), mid[1] - out[1] * (WALL_LANE + 1)];
        if (!poly.slice(2).every((q) => shore.rockAt(q)) || !shore.rockAt(lerp(poly[2], poly[3], 0.5)) || shore.openAt(lerp(poly[2], poly[3], 0.5))) continue;
        if (!shore.openAt(front) || T.seaAt(front)) continue;
        if (T.roads.some((road) => road.points.some((q) => dist(q, mid) < CAVE.TUNNEL_HALF + w + 8))) continue;
        if (placedCut.some((q) => dist(q, mid) < w + 1.5)) continue;
        if (occupancy.at(front) === RESERVED) continue;
        placedCut.push(mid);
        buildings.push({ poly, kind: "house", rockCut: true, rank: 2 });
        occupancy.stampPolygon(poly, BUILDING);
        occupancy.stampPolygon(rect(lerp(face, front, 0.35), Math.atan2(along[1], along[0]), w, DOORSTEP * 2), RESERVED);
    }
    T.buildings = buildings;
    // What these house, in houses' worth, so the free-standing houses house the rest
    T.housesBefore = placedCut.length + hollow.length * HOLLOW_HOUSES;
}

/** Whether two convex polygons overlap (separating axes). */
function overlaps(a, b) {
    for (const poly of [a, b]) {
        for (let k = 0; k < poly.length; k++) {
            const p = poly[k];
            const q = poly[(k + 1) % poly.length];
            const axis = [-(q[1] - p[1]), q[0] - p[0]];
            const project = (pts) => pts.map((r) => r[0] * axis[0] + r[1] * axis[1]);
            const pa = project(a);
            const pb = project(b);
            if (Math.max(...pa) <= Math.min(...pb) + 0.01 || Math.max(...pb) <= Math.min(...pa) + 0.01) return false;
        }
    }
    return true;
}

function unit(v) {
    const d = Math.hypot(v[0], v[1]) || 1;
    return [v[0] / d, v[1] / d];
}

/**
 * Fungus beds and fish ponds by budget: plots on the open floor the houses leave, ponds by the
 * water first, beds from the chambers' walls inwards, then in the side caverns; whatever does not
 * fit is bought from the parent's trade (the spill).
 */
export function buildCaveFarms(T) {
    const { shore, input, occupancy, W, H } = T;
    const random = T.R("cave-farms");
    const grain = random.range(0, Math.PI);
    const t = [Math.cos(grain), Math.sin(grain)];
    const n = [-t[1], t[0]];
    const need = input.cave.need;
    // What the beds and ponds are to grow: the need, less what is bought in and what the fields
    // of the town before the gate grow for it
    const target = input.cave.foodTarget ?? need;
    const outsideFed = input.cave.outsideFed ?? 0;
    // Ground (m²) one person fed takes as beds, and as ponds
    const bedGround = CAVE.FUNGUS_M2_PER_FED * CAVE.BED_GROUND;
    const pondGround = bedGround / CAVE.POND_YIELD;
    let pondBudget = CAVE.POND_SHARE * target * bedGround;
    const waters = shore.cave.waters;
    const toWater = (p) => Math.min(T.rdAt(p) - T.river.width / 2, ...waters.map((w) => dist(p, w.c) - w.r));
    const cells = [];
    const reach = Math.hypot(W, H) / 2;
    // Whole plots first, then half plots in the gaps they leave by walls, pools and houses
    const whole = new Map();
    const lay = (pw, ph, size) => {
        for (let u = -reach; u < reach; u += pw + PLOT_GAP) {
            for (let v = -reach; v < reach; v += ph + PLOT_GAP) {
                const c = [t[0] * u + n[0] * v, t[1] * u + n[1] * v];
                if (!T.inFrame(c)) continue;
                const poly = rect(c, grain, pw, ph);
                if (!poly.every((q) => T.inFrame(q))) continue;
                const where = shore.inChamber(c) ? "main" : shore.inSide(c) ? "side" : "way";
                if (where === "way") continue;
                const probes = [c, ...poly, ...poly.map((q) => lerp(q, c, 0.5))];
                if (probes.some((q) => T.seaAt(q) || T.wdAt(q) < 2)) continue;
                if (!occupancy.free(poly)) continue;
                const key = `${Math.floor(c[0] / 40)},${Math.floor(c[1] / 40)}`;
                if (size === 1) {
                    const [i, j] = key.split(",").map(Number);
                    let covered = false;
                    for (let dj = -1; dj <= 1 && !covered; dj++) for (let di = -1; di <= 1 && !covered; di++) covered = (whole.get(`${i + di},${j + dj}`) ?? []).some((other) => overlaps(other.poly, poly));
                    if (covered) continue;
                }
                const cell = { c, poly, where, wet: toWater(c), w: pw, h: ph, size };
                cells.push(cell);
                if (size === 2) {
                    if (!whole.has(key)) whole.set(key, []);
                    whole.get(key).push(cell);
                }
            }
        }
    };
    lay(PLOT_SIZE[0], PLOT_SIZE[1], 2);
    lay(PLOT_SIZE[0] / 2, PLOT_SIZE[1] / 2, 1);
    // Chambers first: ponds by the water, then beds from the walls inwards, so they lie round the
    // town rather than among its houses; then the side caverns, ponds by their pools first
    const order = (cell) => (cell.where === "side" ? 2e6 : 0) + (cell.wet < POND_REACH ? cell.wet : 1e6 - Math.hypot(cell.c[0], cell.c[1]));
    cells.sort((a, b) => order(a) - order(b));
    let fedLeft = target;
    const fields = [];
    const got = { main: 0, side: 0, ponds: 0, beds: 0 };
    for (const cell of cells) {
        if (fedLeft <= 0) break;
        const { w: pw, h: ph } = cell;
        const area = pw * ph;
        const pond = pondBudget > 0 && cell.wet < POND_REACH;
        const fed = pond ? area / pondGround : area / bedGround;
        fedLeft -= fed;
        got[cell.where] += fed;
        const field = { poly: cell.poly, use: pond ? "pond" : "fungus", centre: cell.c, owner: "own", area, where: cell.where };
        if (pond) {
            pondBudget -= area;
            got.ponds += fed;
        } else {
            got.beds += fed;
            const rows = [];
            for (let o = -ph / 2 + 2; o <= ph / 2 - 2; o += BED_ROW) rows.push([[cell.c[0] + n[0] * o - t[0] * (pw / 2 - 2), cell.c[1] + n[1] * o - t[1] * (pw / 2 - 2)], [cell.c[0] + n[0] * o + t[0] * (pw / 2 - 2), cell.c[1] + n[1] * o + t[1] * (pw / 2 - 2)]]);
            field.strips = rows;
        }
        occupancy.stampPolygon(cell.poly, RESERVED);
        fields.push(field);
    }
    T.fields = fields;
    T.tracks = [];
    T.sectors = [];
    T.cropFactor = 1;
    T.farmsteads = 0;
    const fedDrawn = Math.min(need - outsideFed, got.main + got.side);
    const imported = Math.max(0, need - fedDrawn - outsideFed);
    const ha = (m2) => m2 / 10000;
    const galleryM = shore.cave.galleries.reduce((a, g) => a + g.points.reduce((b, p, k) => b + (k ? dist(p, g.points[k - 1]) : 0), 0), 0);
    T.land = {
        cave: true,
        plan: shore.cave.plan,
        frameHa: ha(W * H),
        floorHa: ha(shore.cave.main.area),
        hallsHa: ha(shore.cave.halls.reduce((a, h) => a + h.area, 0)),
        galleryKm: +(galleryM / 1000).toFixed(1),
        sideHa: ha(shore.cave.sides.reduce((a, s) => a + s.chamber.area, 0)),
        ownFood: need,
        ownWantedHa: ha(need * bedGround),
        fungusHa: ha(fields.filter((f) => f.use === "fungus").reduce((a, f) => a + f.area, 0)),
        pondHa: ha(fields.filter((f) => f.use === "pond").reduce((a, f) => a + f.area, 0)),
        fedMain: Math.round(Math.min(need, got.main)),
        fedSide: Math.round(Math.min(need - Math.min(need, got.main), got.side)),
        fedOutside: outsideFed,
        fedImported: Math.round(imported),
        importShare: input.cave.importShare ?? 0,
        ownFedDrawn: fedDrawn,
        countryPeople: 0,
    };
    // The supply: a cavern's own beds and ponds, and the spill bought from the parent's trade
    T.supply = { own: Math.round(fedDrawn + outsideFed), countryTotal: 0, fromPlaces: [], out: null, imports: Math.round(imported), exports: 0, need: Math.round(need), balanceError: 0 };
}

