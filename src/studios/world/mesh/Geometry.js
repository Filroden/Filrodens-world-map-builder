/**
 * Small planar geometry helpers shared by the mesh modules.
 */

const PARALLEL = 0;

/**
 * Liang-Barsky clipping: the part of the segment p-q inside the rectangle [0, width] x [0, height],
 * as the parameters [t0, t1] along it (0 at p, 1 at q), or null when no part is inside.
 * @returns {number[]|null}
 */
export function clipSegment(px, py, qx, qy, width, height) {
    const dx = qx - px;
    const dy = qy - py;
    let t0 = 0;
    let t1 = 1;
    const tests = [
        [-dx, px],
        [dx, width - px],
        [-dy, py],
        [dy, height - py],
    ];
    for (const [p, q] of tests) {
        if (p === PARALLEL) {
            if (q < 0) return null;
            continue;
        }
        const t = q / p;
        if (p < 0) t0 = Math.max(t0, t);
        else t1 = Math.min(t1, t);
        if (t0 > t1) return null;
    }
    return [t0, t1];
}

/**
 * True when the segment p-q runs inside the rectangle for some length (touching it at a single
 * point, such as a corner, does not count).
 */
export function segmentCrossesRect(px, py, qx, qy, width, height) {
    const range = clipSegment(px, py, qx, qy, width, height);
    return range !== null && range[1] > range[0];
}
