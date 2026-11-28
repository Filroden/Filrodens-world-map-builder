/**
 * Finding drawn lines (custom rivers, faults, land mask outlines, a named river's course) near a
 * map point, within a reach measured on the screen, so a line is as easy to point at whatever the
 * zoom. Shared by the Select modes (PickTool) and Inspect (SurfaceKinds).
 */

/** How near a line or outline the pointer must be to reach it, in screen pixels. */
export const LINE_REACH_PX = 8;

/** How far a map point lies from the segment a–b. */
export function segmentDistance(x, y, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / length)) : 0;
    return Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy));
}

/** How far a map point lies from a line of points (Infinity for a line of fewer than two). */
export function lineDistance(points, x, y) {
    let best = Infinity;
    for (let i = 1; i < points.length; i++) best = Math.min(best, segmentDistance(x, y, points[i - 1], points[i]));
    return best;
}

/** The map distance LINE_REACH_PX covers at the current zoom. */
export function lineReach(app) {
    return LINE_REACH_PX / (app.canvasEngine?.stage?.scale?.x || 1);
}

/**
 * Every line (of the lists given, each `[kind, lines, extent?]`, where extent gives how far beyond
 * the line it reaches, in map pixels) within reach of a map point, nearest first, as
 * `{ kind, id, line, distance }`.
 * @param {object} app
 * @param {number} x
 * @param {number} y
 * @param {Array} lists
 * @returns {{kind: string, id: string, line: object, distance: number}[]}
 */
export function linesAt(app, x, y, lists) {
    const reach = lineReach(app);
    const found = [];
    for (const [kind, lines, extent] of lists) {
        for (const line of lines ?? []) {
            const within = Math.max(reach, extent?.(line) ?? 0);
            const distance = lineDistance(line.points, x, y);
            if (distance <= within) found.push({ kind, id: line.id, line, distance });
        }
    }
    return found.sort((a, b) => a.distance - b.distance);
}

/** The line nearest a map point within reach (see linesAt), as `{ kind, id }`, or null. */
export function nearestLine(app, x, y, lists) {
    const [first] = linesAt(app, x, y, lists);
    return first ? { kind: first.kind, id: first.id } : null;
}
