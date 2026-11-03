import { FILRODENSWMB } from "../config.js";
import { RiverNetwork } from "./RiverNetwork.js";
import { CatmullRom } from "../tools/CatmullRom.js";

/**
 * Custom rivers from terrain revision 3 on (see TerrainVersion.usesGuidedRivers): a river that
 * follows the land within a corridor round the line drawn, rather than the line itself.
 *
 * - **The corridor's line** wanders either side of the drawn line, by smooth waves seeded by the
 *   river and measured along the line in baseline pixels from its first point, tapering to the
 *   drawn line at both ends. Because nothing in it depends on the map's own pixels, a regional
 *   map's corridor lies where its parent's does.
 * - **The trough** (carve): the land within the corridor is lowered towards a bed that falls
 *   steadily along the corridor's line, more the nearer the line, keeping a share of its own relief
 *   even on the floor, so the land falls towards the river in a broad, uneven trough rather than
 *   a groove. The trough never cuts deeper than MAX_CUT.
 * - **Cutting through high ground** (the river's `cutThrough`): where the land rises across the
 *   line more than the trough cuts, a gorge a few river widths wide is cut down to the bed, so
 *   the river runs through a range rather than over it.
 * - **The trace** (forTrace, traced by ProceduralEngine#traceGuided): the river rises at the
 *   line's higher end and is traced as any river is, held within the corridor (narrowed to the
 *   gorge where one is cut). Past the line's lower end it is traced on freely, to the sea or
 *   another river.
 * - **The width:** it rises as a headwater, gathering the flow a river drawn under revision 2
 *   starts with gradually along its course within the corridor (`lateral`, see RiverNetwork), so
 *   it reaches that width by the line's end.
 *
 * The direction a river flows is the river's own `reversed` where it has one (a regional map's
 * rivers carry their parent's, see RegionalExtractor), and otherwise from the higher of the
 * line's two ends.
 */
export class RiverCorridor {
    /**
     * How far the corridor reaches either side of the line, in map pixels.
     * @param {object} river - A custom river.
     * @param {number} scale - Map pixels per baseline pixel.
     * @returns {number}
     */
    static halfWidth(river, scale) {
        const hydrology = FILRODENSWMB.HYDROLOGY;
        const share = Math.min(hydrology.CORRIDOR_MAX, Math.max(hydrology.CORRIDOR_MIN, river.corridor ?? hydrology.CORRIDOR));
        return Math.max(share * RiverCorridor.#riverWidth(river), SHAPE.MIN_HALF_WIDTH * scale);
    }

    /**
     * Lowers the land along a custom river into its trough, and its gorge where it cuts through
     * high ground (see the class notes).
     *
     * @param {Float32Array} elevationData
     * @param {number} width
     * @param {number} height
     * @param {object} river - The custom river.
     * @param {number} seaLevel
     * @param {object|null} bounds - The part of the map being rebuilt, or null for all of it.
     * @param {number} scale - Map pixels per baseline pixel.
     */
    static carve(elevationData, width, height, river, seaLevel, bounds, scale) {
        const course = RiverCorridor.#course(elevationData, width, height, river, scale);
        if (!course) return;
        const { line, halfWidth } = course;
        const hydrology = FILRODENSWMB.HYDROLOGY;
        const depth = (hydrology.MANUAL_RIVER_DEPTHS?.[river.width] || hydrology.MANUAL_RIVER_DEFAULT_DEPTH) * hydrology.MANUAL_RIVER_VALLEY_DEPTH;
        const ground = (p) => RiverCorridor.#sample(elevationData, width, height, p);
        const { bed, fall } = RiverCorridor.#bed(line, ground, depth, seaLevel);
        const gorge = river.cutThrough === true ? RiverCorridor.#gorge(line, ground, bed, depth, fall, seaLevel) : null;

        // The trough's half-width at each point, varying along the river
        const waves = RiverCorridor.#waves(`${river.id}:width`);
        const halfWidths = line.map((p) => halfWidth * SHAPE.TROUGH * (1 + SHAPE.UNEVEN * RiverCorridor.#wave(waves, p.s)));
        const gorgeWidth = RiverCorridor.#riverWidth(river) * SHAPE.GORGE;
        const reach = Math.max(...halfWidths, gorgeWidth);
        const whole = RiverCorridor.#box(line, reach, width, height, null);
        const box = whole && bounds ? RiverCorridor.#clip(whole, bounds) : whole;
        if (!box) return;

        // Only a rebuild of the river's whole box sees its land as it was before the trough
        if (!bounds || RiverCorridor.#clip(whole, bounds) === whole) RiverCorridor.#remember(river, width, height, seaLevel, scale, { reversed: course.reversed, gorge: gorge?.high ?? null });

        const boxWidth = box.maxX - box.minX + 1;
        // How far each pixel comes down: the most any point of the line asks of it, applied once
        const lowering = new Float32Array(boxWidth * (box.maxY - box.minY + 1));
        // Stamped at a spacing in proportion to the trough's width (the gorge's where one is cut),
        // since the lowering is smooth along the line
        let travelled = Infinity;
        for (let i = 0; i < line.length; i++) {
            if (i > 0) travelled += Math.hypot(line[i].x - line[i - 1].x, line[i].y - line[i - 1].y);
            const cut = gorge?.cut[i] === 1;
            const spacing = Math.max(SHAPE.MIN_SPACING, (cut ? gorgeWidth : halfWidths[i]) * SHAPE.STAMP_SPACING);
            if (travelled < spacing && i < line.length - 1) continue;
            travelled = 0;
            RiverCorridor.#stamp(lowering, box, boxWidth, elevationData, width, line[i], halfWidths[i], bed[i], cut ? { width: gorgeWidth, floor: gorge.floor[i] } : null);
        }
        for (let y = box.minY; y <= box.maxY; y++) {
            for (let x = box.minX; x <= box.maxX; x++) {
                const amount = lowering[(y - box.minY) * boxWidth + (x - box.minX)];
                // Only ever lowers, and never clamps (see HydrologyEngine#carveRiverCrossSection)
                if (amount > 0) elevationData[y * width + x] -= amount;
            }
        }
    }

    /**
     * What the trace needs for a custom river (see ProceduralEngine#traceGuided): the corridor's
     * line as whole pixels from its higher end (from where it enters the map, to where it leaves
     * it), how far every pixel near it is from it and which pixel of the line is nearest, how far
     * the river may stray at each pixel of the line, and the flow it gathers along it.
     *
     * @param {Float32Array} elevationData - The terrain, with the custom rivers already carved.
     * @param {number} width
     * @param {number} height
     * @param {object} river - The custom river.
     * @param {number} scale - Map pixels per baseline pixel.
     * @param {number} seaLevel
     * @returns {object|null} `{ id, pixels, inflow, lateral, corridor }`, or null where the line
     *   barely touches the map.
     */
    static forTrace(elevationData, width, height, river, scale, seaLevel) {
        const carved = RiverCorridor.#recall(river, width, height, seaLevel, scale);
        const course = RiverCorridor.#course(elevationData, width, height, river, scale, carved?.reversed);
        if (!course) return null;
        const { line, halfWidth } = course;

        // The line's pixels, and for each the line point it came from
        const pixels = [];
        const from = [];
        for (let i = 0; i < line.length; i++) {
            const x = Math.floor(line[i].x);
            const y = Math.floor(line[i].y);
            if (x < 0 || y < 0 || x >= width || y >= height) {
                if (pixels.length > 0) break;
                continue;
            }
            const last = pixels.at(-1);
            if (last?.x === x && last.y === y) continue;
            pixels.push({ x, y });
            from.push(i);
        }
        if (pixels.length < 2) return null;

        // How far the river may stray from each pixel of the line: the corridor, or the gorge
        const gorgeLimit = RiverCorridor.#riverWidth(river) * SHAPE.GORGE * SHAPE.GORGE_STRAY;
        const limits = new Float32Array(pixels.length).fill(halfWidth);
        if (carved?.gorge) from.forEach((i, k) => carved.gorge[i] && (limits[k] = Math.min(halfWidth, gorgeLimit)));

        const reach = halfWidth * SHAPE.FIELD_REACH;
        const box = RiverCorridor.#box(pixels, reach, width, height, null);
        const boxWidth = box.maxX - box.minX + 1;
        const size = boxWidth * (box.maxY - box.minY + 1);
        const distance = new Float32Array(size).fill(Infinity);
        const nearest = new Int32Array(size).fill(-1);
        const reachSq = reach * reach;
        // Measured from every other pixel of the line where the corridor is wide: near enough
        const every = reach > SHAPE.FIELD_FINE ? 2 : 1;
        pixels.forEach((p, k) => {
            if (k % every !== 0 && k !== pixels.length - 1) return;
            const minX = Math.max(box.minX, Math.floor(p.x - reach));
            const maxX = Math.min(box.maxX, Math.ceil(p.x + reach));
            const minY = Math.max(box.minY, Math.floor(p.y - reach));
            const maxY = Math.min(box.maxY, Math.ceil(p.y + reach));
            for (let y = minY; y <= maxY; y++) {
                const dy = y - p.y;
                const row = (y - box.minY) * boxWidth - box.minX;
                for (let x = minX; x <= maxX; x++) {
                    const d = (x - p.x) * (x - p.x) + dy * dy;
                    if (d > reachSq || d >= distance[row + x]) continue;
                    distance[row + x] = d;
                    nearest[row + x] = k;
                }
            }
        });
        for (let i = 0; i < size; i++) distance[i] = Math.sqrt(distance[i]);

        // The flow a river drawn under revision 2 starts with (MANUAL_RIVER_START_SHARE of its
        // Width), gathered along the whole line instead: the share of it gathered on this map
        const target = RiverNetwork.inflowForWidth(RiverCorridor.#riverWidth(river) * FILRODENSWMB.HYDROLOGY.MANUAL_RIVER_START_SHARE, scale);
        const total = Math.abs(line.at(-1).s - line[0].s);
        const onMap = Math.abs(line[from.at(-1)].s - line[from[0]].s);
        return {
            id: river.id,
            pixels,
            // A regional map's river enters it carrying the flow it had gathered by then
            inflow: river.inflow ?? 0,
            lateral: total > 0 ? (target * onMap) / total : 0,
            corridor: {
                limits,
                box,
                boxWidth,
                distance,
                nearest,
                follow: Math.max(SHAPE.MIN_FOLLOW, Math.round(Math.min(halfWidth, RiverCorridor.#riverWidth(river) * SHAPE.FOLLOW_WIDTHS))),
            },
        };
    }

    /** Forgets what every river's trough was carved with (for tests). */
    static clearCache() {
        CARVED.clear();
    }

    // ----------------------------------------------------------------- the line

    /**
     * The line drawn through a river's points, sampled every SPLINE_STEP map pixels: the
     * centripetal Catmull-Rom curve (see CatmullRom), which never loops or overshoots however
     * unevenly the points are spaced, and which the canvas draws for the river.
     * @param {{x: number, y: number}[]} points
     * @returns {{x: number, y: number}[]}
     */
    static spline(points) {
        return CatmullRom.open(points ?? [], { centripetal: true, step: SPLINE_STEP }).map((p) => ({ x: p.x, y: p.y }));
    }

    /** A river's width on this map, in map pixels. */
    static #riverWidth(river) {
        return Math.max(1, Number(river.width) || 4) * (river.widthScale ?? 1);
    }

    /**
     * The corridor's line from the river's higher end: its spline moved sideways by the wander,
     * each point carrying `s`, its distance along the line from the first point drawn, in
     * baseline pixels.
     * @returns {{line: object[], halfWidth: number, reversed: boolean}|null}
     */
    static #course(elevationData, width, height, river, scale, known = undefined) {
        const spline = RiverCorridor.spline(river.points ?? []);
        if (spline.length < 2) return null;
        const halfWidth = RiverCorridor.halfWidth(river, scale);
        const along = new Float32Array(spline.length);
        for (let i = 1; i < spline.length; i++) along[i] = along[i - 1] + Math.hypot(spline[i].x - spline[i - 1].x, spline[i].y - spline[i - 1].y) / scale;
        const total = along.at(-1);
        if (!(total > 0)) return null;
        const waves = RiverCorridor.#waves(river.id ?? "river");
        const reach = halfWidth * SHAPE.WANDER;

        const line = spline.map((point, i) => {
            const a = Math.max(0, i - 2);
            const b = Math.min(spline.length - 1, i + 2);
            const length = Math.hypot(spline[b].x - spline[a].x, spline[b].y - spline[a].y) || 1;
            const nx = -(spline[b].y - spline[a].y) / length;
            const ny = (spline[b].x - spline[a].x) / length;
            const s = along[i];
            const ends = smoothstep(0, SHAPE.TAPER, s) * smoothstep(0, SHAPE.TAPER, total - s);
            const offset = reach * ends * RiverCorridor.#wave(waves, s);
            return { x: point.x + nx * offset, y: point.y + ny * offset, s };
        });
        const reversed = typeof river.reversed === "boolean" ? river.reversed : typeof known === "boolean" ? known : RiverCorridor.#higherAtEnd(elevationData, width, height, line);
        if (reversed) line.reverse();
        return { line, halfWidth, reversed };
    }

    /** Whether the line's last point on the map stands higher than its first. */
    static #higherAtEnd(elevationData, width, height, line) {
        const inside = (p) => p.x >= 0 && p.y >= 0 && p.x < width && p.y < height;
        const first = line.find(inside);
        const last = line.findLast(inside);
        if (!first || !last) return false;
        return RiverCorridor.#sample(elevationData, width, height, last) > RiverCorridor.#sample(elevationData, width, height, first);
    }

    static #sample(elevationData, width, height, p) {
        const x = Math.min(width - 1, Math.max(0, Math.floor(p.x)));
        const y = Math.min(height - 1, Math.max(0, Math.floor(p.y)));
        return elevationData[y * width + x];
    }

    // ----------------------------------------------------------------- the trough

    /**
     * The bed the trough falls to along the line, from its higher end: `depth` below the land,
     * never rising, and falling at least a steady share of the way to its end at every step, so a
     * river traced along it always runs downhill (a bed that only never rose would lie dead flat
     * wherever the land rose across the line, and the trace would wander there). It stays above
     * the sea on land.
     * @returns {{bed: Float32Array, fall: number}}
     */
    static #bed(line, ground, depth, seaLevel) {
        const n = line.length;
        const start = ground(line[0]) - depth;
        const end = Math.max(seaLevel + MIN_ABOVE_SEA, ground(line[n - 1]) - depth);
        const fall = Math.max(MIN_FALL, ((start - end) / n) * SHAPE.STEADY_FALL);
        const bed = new Float32Array(n);
        let running = start;
        for (let i = 0; i < n; i++) {
            const here = ground(line[i]);
            running = Math.min(running - (i > 0 ? fall : 0), here - depth);
            if (here > seaLevel) running = Math.max(running, seaLevel + MIN_ABOVE_SEA);
            bed[i] = running;
        }
        return { bed, fall };
    }

    /**
     * Where the land rises across the line (above the lowest it has been, less the trough's
     * depth), and the floor a gorge is cut to there: the lowest the land has been, falling on
     * steadily through the rise so the river can run down it. `high` marks the stretches where
     * it rises by more than the trough could cut, a little either side: there the trace is held
     * within the gorge, so the river runs through it rather than leaving it dry.
     * @returns {{cut: Uint8Array, high: Uint8Array, floor: Float32Array}}
     */
    static #gorge(line, ground, bed, depth, fall, seaLevel) {
        const n = line.length;
        const cut = new Uint8Array(n);
        const rise = new Uint8Array(n);
        const floor = new Float32Array(n);
        let lowest = Infinity;
        let running = Infinity;
        for (let i = 0; i < n; i++) {
            const natural = ground(line[i]) - depth;
            const rising = natural > lowest;
            running = rising ? Math.min(running - fall, lowest) : natural;
            floor[i] = Math.max(bed[i], seaLevel + MIN_ABOVE_SEA, running);
            cut[i] = rising ? 1 : 0;
            rise[i] = natural > lowest + SHAPE.MAX_CUT ? 1 : 0;
            lowest = Math.min(lowest, natural);
        }
        const spread = Math.max(1, Math.round(n * SHAPE.GORGE_LEAD));
        const high = new Uint8Array(n);
        let last = -Infinity;
        for (let i = 0; i < n; i++) if (rise[i]) last = i;
        for (let i = n - 1, next = Infinity; i >= 0; i--) {
            if (rise[i]) next = i;
            high[i] = next - i <= spread ? 1 : 0;
        }
        for (let i = 0, previous = -Infinity; i < n; i++) {
            if (rise[i]) previous = i;
            if (i - previous <= spread) high[i] = 1;
        }
        return { cut, high: last >= 0 ? high : new Uint8Array(n), floor };
    }

    /**
     * Records how far the land round one point of the line comes down, keeping the most asked
     * of each pixel. The land keeps a share of its height above the bed that grows from FLOOR_KEEP
     * on the trough's floor to all of it at its edge; where a gorge is cut, the land within it
     * comes down to the gorge's floor.
     */
    static #stamp(lowering, box, boxWidth, elevationData, width, p, w, bed, gorge) {
        const reach = Math.max(w, gorge?.width ?? 0);
        const minX = Math.max(box.minX, Math.floor(p.x - reach));
        const maxX = Math.min(box.maxX, Math.ceil(p.x + reach));
        const minY = Math.max(box.minY, Math.floor(p.y - reach));
        const maxY = Math.min(box.maxY, Math.ceil(p.y + reach));
        const reachSq = reach * reach;
        const troughSq = w * w;
        const toStep = (CUT_STEPS - 1) / w;
        for (let y = minY; y <= maxY; y++) {
            const dy = y + 0.5 - p.y;
            const row = (y - box.minY) * boxWidth - box.minX;
            for (let x = minX; x <= maxX; x++) {
                const dx = x + 0.5 - p.x;
                const distanceSq = dx * dx + dy * dy;
                if (distanceSq >= reachSq) continue;
                const at = row + x;
                // Nothing here can ask for more than the trough's deepest cut, but a gorge
                if (!gorge && lowering[at] >= SHAPE.MAX_CUT) continue;
                const here = elevationData[y * width + x];
                let amount = 0;
                if (distanceSq < troughSq && here > bed) amount = Math.min(SHAPE.MAX_CUT, (here - bed) * CUT_SHARE[Math.floor(Math.sqrt(distanceSq) * toStep)]);
                if (gorge && here > gorge.floor) {
                    const g = Math.sqrt(distanceSq) / gorge.width;
                    if (g < 1) amount = Math.max(amount, (here - gorge.floor) * (1 - smoothstep(SHAPE.GORGE_FLOOR, 1, g)));
                }
                if (amount > lowering[at]) lowering[at] = amount;
            }
        }
    }

    // ----------------------------------------------------------------- what the trough was carved with

    /**
     * The trace runs on the carved terrain, where the land the trough and gorge were worked out
     * from is gone, so the carve remembers which way the river runs and where its gorge is cut.
     * Kept for the few rivers most recently carved, by everything that shapes them.
     */
    static #remember(river, width, height, seaLevel, scale, carved) {
        const key = RiverCorridor.#key(river, width, height, seaLevel, scale);
        CARVED.delete(key);
        CARVED.set(key, carved);
        while (CARVED.size > CACHE_SIZE) CARVED.delete(CARVED.keys().next().value);
    }

    static #recall(river, width, height, seaLevel, scale) {
        return CARVED.get(RiverCorridor.#key(river, width, height, seaLevel, scale)) ?? null;
    }

    static #key(river, width, height, seaLevel, scale) {
        return JSON.stringify([river.id, river.points, river.width, river.widthScale, river.corridor, river.cutThrough, river.reversed, width, height, seaLevel, scale]);
    }

    // ----------------------------------------------------------------- helpers

    static #box(points, reach, width, height, bounds) {
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const p of points) {
            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x);
            maxY = Math.max(maxY, p.y);
        }
        const box = {
            minX: Math.max(0, Math.floor(minX - reach)),
            minY: Math.max(0, Math.floor(minY - reach)),
            maxX: Math.min(width - 1, Math.ceil(maxX + reach)),
            maxY: Math.min(height - 1, Math.ceil(maxY + reach)),
        };
        if (box.minX > box.maxX || box.minY > box.maxY) return null;
        return bounds ? RiverCorridor.#clip(box, bounds) : box;
    }

    /** `box` within `bounds`: the same object when it lies wholly inside, null when they do not meet. */
    static #clip(box, bounds) {
        if (box.minX >= bounds.minX && box.minY >= bounds.minY && box.maxX <= bounds.maxX && box.maxY <= bounds.maxY) return box;
        const clipped = { minX: Math.max(box.minX, bounds.minX), minY: Math.max(box.minY, bounds.minY), maxX: Math.min(box.maxX, bounds.maxX), maxY: Math.min(box.maxY, bounds.maxY) };
        return clipped.minX <= clipped.maxX && clipped.minY <= clipped.maxY ? clipped : null;
    }

    /** Three sine waves of different lengths, with phases from the seed: smooth, irregular wander. */
    static #waves(seed) {
        let hash = 2166136261;
        for (const char of String(seed)) hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 16777619);
        const next = () => {
            hash = Math.imul(hash ^ (hash >>> 15), 2246822507) ^ Math.imul(hash ^ (hash >>> 13), 3266489909);
            return ((hash >>> 0) % 100000) / 100000;
        };
        return SHAPE.WAVES.map(([length, amount]) => ({ length: length * (0.8 + 0.4 * next()), amount, phase: next() * TURN }));
    }

    static #wave(waves, s) {
        let sum = 0;
        for (const wave of waves) sum += wave.amount * Math.sin((s / wave.length) * TURN + wave.phase);
        return sum;
    }
}

function smoothstep(edge0, edge1, x) {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
}

const TURN = Math.PI * 2;
// Spacing, in map pixels, of the points the drawn line is sampled at (as HydrologyEngine's)
const SPLINE_STEP = 0.25;
// The least a bed falls per line sample, and how far above the sea it stays on land
const MIN_FALL = 0.000002;
const MIN_ABOVE_SEA = 0.0005;
// What the most recent carves were made with (see #remember), and how many are kept
const CARVED = new Map();
const CACHE_SIZE = 64;

/** The corridor's shape. Lengths are in baseline pixels unless they say otherwise. */
const SHAPE = Object.freeze({
    // The smallest half-width
    MIN_HALF_WIDTH: 8,
    // How far the line wanders, as a share of the half-width, and over what distance it tapers
    // to the drawn line at each end
    WANDER: 0.55,
    TAPER: 60,
    // The wander's waves: [length, share]
    WAVES: [
        [240, 0.55],
        [110, 0.3],
        [55, 0.15],
    ],
    // The trough: its half-width as a share of the corridor's, and how much that varies along the
    // river; the share of it that is floor, the share of its height above the bed the land keeps
    // on the floor (so the floor keeps the land's texture and draws no groove along the line), and
    // how sharply the land rises beyond the floor
    TROUGH: 1.6,
    UNEVEN: 0.35,
    FLOOR: 0.08,
    FLOOR_KEEP: 0.1,
    TROUGH_EXPONENT: 1.4,
    // The trough is stamped every STAMP_SPACING of its half-width along the line (at least
    // MIN_SPACING map pixels apart)
    STAMP_SPACING: 0.08,
    MIN_SPACING: 1,
    // The deepest the trough cuts into the land (of the height range), and the share of the
    // average fall from source to end the bed keeps at every step
    MAX_CUT: 0.03,
    STEADY_FALL: 0.5,
    // The gorge: its half-width in river widths, the share of it that is flat floor before its
    // walls rise, and how far the river may stray within it (a share of its half-width)
    GORGE: 2,
    GORGE_FLOOR: 0.3,
    GORGE_STRAY: 1,
    // How far before and after a rise the trace is held within the gorge, as a share of the line
    GORGE_LEAD: 0.02,
    // How far round the line the trace's distance field reaches, as a share of the half-width
    FIELD_REACH: 1.6,
    // Beyond this reach (map pixels), the field is measured from every other pixel of the line
    FIELD_FINE: 24,
    // How far the trace follows the line where the land would take it out of the corridor, in
    // river widths (no more than the half-width, and at least MIN_FOLLOW map pixels)
    FOLLOW_WIDTHS: 6,
    MIN_FOLLOW: 6,
});

/**
 * The share of the land's height above the bed the trough takes away, by distance from the line
 * as a share of the trough's half-width (CUT_STEPS steps from 0 to 1): the land keeps FLOOR_KEEP
 * of it on the floor, rising to all of it at the edge.
 */
const CUT_STEPS = 512;
const CUT_SHARE = Float32Array.from({ length: CUT_STEPS }, (_, step) => {
    const d = Math.max(0, (step / (CUT_STEPS - 1) - SHAPE.FLOOR) / (1 - SHAPE.FLOOR));
    return 1 - (SHAPE.FLOOR_KEEP + (1 - SHAPE.FLOOR_KEEP) * Math.min(1, Math.pow(d, SHAPE.TROUGH_EXPONENT) * (3 - 2 * d)));
});
