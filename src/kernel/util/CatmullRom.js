/**
 * The Catmull-Rom curves drawn through the points of a line the user places (fault lines and
 * tectonic features, custom rivers): one place for the curve, so what the canvas draws, what a
 * click on the line hits and what the terrain is built along cannot drift apart.
 *
 * Two forms, chosen by the map's terrain revision (see TerrainVersion.usesCentripetalLines):
 *
 * - **Uniform** (revisions 1 and 2): the first and last points are repeated as invisible anchors,
 *   so the curve passes through them. It is sampled exactly as before revision 3 (same formula,
 *   same steps, t added up step by step), so a map made then keeps its terrain to the last digit. Where two points lie
 *   close together beside long stretches it can overshoot, loop or turn back.
 * - **Centripetal** (alpha 0.5; revision 3 on): the knots are spaced by the square root of each
 *   stretch's length (Barry and Goldman's form), so the curve never loops or overshoots, however
 *   unevenly the points are spaced, and sits a little tighter to them. A point closer than
 *   MIN_GAP to the one before is left out, since a stretch of no length would divide by zero;
 *   each end is anchored on its point mirrored through the next one, so the curve still passes
 *   through the first and last points.
 *
 * Every sample carries `span`: the index, in the points given, of the point its stretch starts at,
 * so a click on the curve inserts a new point in the right place even when points were left out.
 */
export class CatmullRom {
    /** Points closer than this (map pixels) to the one before are left out of a centripetal curve. */
    static MIN_GAP = 0.5;

    /**
     * The curve through `points`, open at both ends.
     *
     * @param {{x: number, y: number}[]} points - At least two.
     * @param {object} [options]
     * @param {boolean} [options.centripetal] - The centripetal form (revision 3 on) rather than the uniform one.
     * @param {number} [options.resolution] - Samples per stretch, t from 0 to 1 inclusive (as the
     *   canvas draws), so each stretch's last sample is the next one's first.
     * @param {number|null} [options.step] - Instead, a sample every `step` map pixels along each
     *   stretch (t from 0, short of 1), ending on the last point.
     * @param {number} [options.dedupe] - Leave out samples closer than this on both axes to the one
     *   kept before (0 keeps every sample).
     * @returns {{x: number, y: number, span: number}[]}
     */
    static open(points, { centripetal = false, resolution = 20, step = null, dedupe = 0 } = {}) {
        if (!points || points.length < 2) return [];
        const kept = centripetal ? CatmullRom.#kept(points) : points.map((p, index) => ({ x: p.x, y: p.y, index }));
        if (kept.length < 2) return kept.map((p) => ({ x: p.x, y: p.y, span: 0 }));

        const first = kept[0];
        const last = kept.at(-1);
        const anchored = centripetal ? [CatmullRom.#mirror(first, kept[1]), ...kept, CatmullRom.#mirror(last, kept.at(-2))] : [first, ...kept, last];
        const stretch = centripetal ? CatmullRom.#centripetal : CatmullRom.#uniform;

        const curve = [];
        const push = (x, y, span) => {
            const before = curve.at(-1);
            if (dedupe > 0 && before && Math.abs(before.x - x) < dedupe && Math.abs(before.y - y) < dedupe) return;
            curve.push({ x, y, span });
        };
        for (let i = 1; i < anchored.length - 2; i++) {
            const at = stretch(anchored[i - 1], anchored[i], anchored[i + 1], anchored[i + 2]);
            const span = anchored[i].index;
            const steps = step ? Math.max(1, Math.floor(Math.hypot(anchored[i + 1].x - anchored[i].x, anchored[i + 1].y - anchored[i].y) / step)) : resolution;
            if (centripetal) {
                // Counted in whole steps, so no sample falls a hair short of the next point (the
                // stretch's own end is its last sample when sampled by resolution)
                const count = step ? steps : steps + 1;
                for (let k = 0; k < count; k++) {
                    const p = at(k / steps);
                    push(p.x, p.y, span);
                }
            } else if (step) {
                // The uniform curve adds up t, exactly as it always has (see the class notes)
                for (let t = 0; t < 1; t += 1 / steps) {
                    const p = at(t);
                    push(p.x, p.y, span);
                }
            } else {
                for (let t = 0; t <= 1; t += 1 / resolution) {
                    const p = at(t);
                    push(p.x, p.y, span);
                }
            }
        }
        // Adding up t in steps of 1 / resolution falls just past 1, so the uniform curve (kept as it
        // was) stops a step short of the last point; the centripetal one, counted in whole steps,
        // ends on it
        if (step) curve.push({ x: last.x, y: last.y, span: kept.at(-2).index });
        return curve;
    }

    /** The points a centripetal curve keeps, each with its index in the points given. */
    static #kept(points) {
        const kept = [];
        points.forEach((p, index) => {
            const before = kept.at(-1);
            if (before && Math.hypot(p.x - before.x, p.y - before.y) < CatmullRom.MIN_GAP) return;
            kept.push({ x: p.x, y: p.y, index });
        });
        return kept;
    }

    /** `end` mirrored through `next`: the anchor beyond an end of a centripetal curve. */
    static #mirror(end, next) {
        return { x: 2 * end.x - next.x, y: 2 * end.y - next.y };
    }

    /** One uniform stretch from p1 (t = 0) to p2 (t = 1), with the module's formula of old. */
    static #uniform(p0, p1, p2, p3) {
        return (t) => {
            const t2 = t * t;
            const t3 = t2 * t;
            const x = 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
            const y = 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
            return { x, y };
        };
    }

    /** One centripetal stretch from p1 (u = 0) to p2 (u = 1). */
    static #centripetal(p0, p1, p2, p3) {
        const knot = (a, b) => Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y));
        const t1 = knot(p0, p1);
        const t2 = t1 + knot(p1, p2);
        const t3 = t2 + knot(p2, p3);
        const lerp = (a, b, ta, tb, t) => ({ x: ((tb - t) * a.x + (t - ta) * b.x) / (tb - ta), y: ((tb - t) * a.y + (t - ta) * b.y) / (tb - ta) });
        return (u) => {
            const t = t1 + (t2 - t1) * u;
            const a1 = lerp(p0, p1, 0, t1, t);
            const a2 = lerp(p1, p2, t1, t2, t);
            const a3 = lerp(p2, p3, t2, t3, t);
            return lerp(lerp(a1, a2, 0, t2, t), lerp(a2, a3, t1, t3, t), t1, t2, t);
        };
    }
}
