/**
 * Geometry shared by the brush engine and the passes that replay a whole stroke at once (see
 * RoughenStroke): where a stroke places its stamps, and how far a pixel lies from a stamp's
 * centre. Both must work these out identically, or a stroke replayed in one pass would no
 * longer match the same stroke painted stamp by stamp.
 */

/** Spacing between a stroke's stamps, as a share of the brush radius. */
const STAMP_SPACING_SHARE = 0.25;

/** The closest two stamps may be, in pixels, however small the brush. */
const MIN_STAMP_SPACING = 1;

/**
 * Two-argument Math.hypot, reproducing the algorithm V8 (Chromium, and so Foundry) implements it
 * with: divide both values by the larger, add their squares, take the square root and scale back
 * up. (V8 sums with Kahan compensation, which cannot change the result with only two terms.)
 *
 * Math.hypot is by far the most expensive call in the stamp loop, and this inline copy costs
 * about half as much. Plain sqrt(dx*dx + dy*dy) would be cheaper still, but it rounds differently
 * in roughly a third of pixels; that is invisible in the stored 32-bit elevation almost
 * everywhere, yet it is not guaranteed to be, and replayed terrain would no longer match what
 * earlier versions produced from the same strokes. This copy returns exactly what Math.hypot
 * returns in V8. Other engines may differ from it in the last bit, as they already may differ
 * from V8's own Math.hypot, which never mattered because the difference is far below the
 * precision of the stored elevation.
 *
 * @param {number} dx
 * @param {number} dy
 * @returns {number}
 */
export function exactHypot(dx, dy) {
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    const max = ax > ay ? ax : ay;
    if (max === 0) return 0;

    const nx = ax / max;
    const ny = ay / max;
    return Math.sqrt(nx * nx + ny * ny) * max;
}

/**
 * Distance between a stroke's stamps along its path: a quarter of the brush radius, so stamps
 * overlap heavily and the stroke reads as continuous, but never less than a pixel.
 *
 * @param {number} size - The brush radius.
 * @returns {number}
 */
export function stampSpacing(size) {
    return Math.max(MIN_STAMP_SPACING, size * STAMP_SPACING_SHARE);
}

/**
 * Every stamp a stroke places, as the brush engine places them while it is painted: one at the
 * first point, then, towards each later point, as many stamps as fit at the stamp spacing from
 * the last one placed. A point closer than one spacing to the last stamp places nothing, and the
 * next point is measured from that same last stamp, so slow pointer movements still add up.
 *
 * The stamps are returned as straight runs rather than one by one: run k starts at
 * (`fromX`, `fromY`) (the last stamp placed before it, which is not part of the run) and holds
 * `steps` stamps, stamp i (from 1) at `from + delta * ((i * spacing) / length)`. That is the
 * exact expression the brush engine evaluates for each stamp, so a stamp's position worked out
 * from a run is bit for bit the one the brush painted at.
 *
 * @param {{x: number, y: number}[]} points - The stroke's recorded points (at least one).
 * @param {number} size - The brush radius.
 * @returns {{first: {x: number, y: number}, spacing: number, runs: {fromX: number, fromY: number,
 *   dx: number, dy: number, length: number, steps: number}[]}}
 */
export function stampRuns(points, size) {
    const spacing = stampSpacing(size);
    const runs = [];
    let lastX = points[0].x;
    let lastY = points[0].y;

    for (let i = 1; i < points.length; i++) {
        const dx = points[i].x - lastX;
        const dy = points[i].y - lastY;
        const length = Math.hypot(dx, dy);
        if (length < spacing) continue;

        const steps = Math.floor(length / spacing);
        runs.push({ fromX: lastX, fromY: lastY, dx, dy, length, steps });

        const finalLerp = (steps * spacing) / length;
        lastX = lastX + dx * finalLerp;
        lastY = lastY + dy * finalLerp;
    }

    return { first: { x: points[0].x, y: points[0].y }, spacing, runs };
}
