import { FILRODENSWMB } from "../../config.js";

/**
 * Coordinates that follow a feature's line: for any pixel near it, `along` (the distance along the
 * line to the nearest point on it) and `across` (the signed distance from the line: positive on
 * the side anticlockwise from the drawing direction, which on screen is the left-hand side).
 *
 * The line is the Catmull-Rom curve StudioCanvas draws through the points, so the terrain follows
 * exactly the curve the user sees, and every pixel is measured against its nearest point on the
 * whole curve (never against each segment separately, which would count pixels near a joint twice).
 *
 * Working these out exactly for every pixel is slow on a large map (a feature can reach hundreds
 * of pixels either side of a long line). They are instead worked out exactly on a grid of points a
 * few pixels apart and interpolated in between. Away from the line's ends and the inside of its
 * bends both are smooth (the distance across grows linearly, the distance along changes steadily),
 * so bilinear interpolation reproduces them closely. Two places are not smooth:
 *   - Past either end, the side changes abruptly straight ahead of the line. Features fade out to
 *     nothing at their ends (FeatureMath.endTaper, at `along` 0 and `length`), so nothing is drawn
 *     there to show it.
 *   - On the inside of a bend wider than the bend's radius, the nearest point jumps from one side
 *     of the bend to the other, and so does `along`. Anything read along the line (noise, wall
 *     positions) would show a seam. `along` is blurred over a share of the reach, which smooths
 *     the jump away rather than moving it (see #smoothAlong).
 */
export class LineField {
    /**
     * @param {{x: number, y: number}[]} points - The feature's control points, in map pixels.
     * @param {number} reach - How far from the line (in map pixels) the field is needed.
     * @param {number} width - The map's width in pixels.
     * @param {number} height - The map's height in pixels.
     */
    constructor(points, reach, width, height) {
        this.curve = LineField.splinePoints(points);
        this.reach = reach;
        this.length = LineField.#curveLength(this.curve);
        this.bounds = LineField.boundsOf(this.curve, reach, width, height);

        const settings = FILRODENSWMB.TECTONICS.FEATURES.LINE;
        this.step = Math.max(1, Math.min(settings.MAX_GRID_STEP, reach / settings.GRID_CELLS_PER_REACH));
        this.columns = Math.ceil((this.bounds.maxX - this.bounds.minX) / this.step) + 2;
        this.rows = Math.ceil((this.bounds.maxY - this.bounds.minY) / this.step) + 2;
        this.across = new Float32Array(this.columns * this.rows).fill(Number.NaN);
        this.along = new Float32Array(this.columns * this.rows);

        this.#measureGrid();
        this.#smoothAlong(Math.max(1, Math.round((reach * settings.ALONG_SMOOTHING) / this.step)));
    }

    /**
     * The Catmull-Rom points StudioCanvas#getSplinePoints draws through `points`: the ends are
     * repeated as invisible anchors so the curve passes exactly through the first and last points,
     * and points closer than 0.1 px to the previous one are dropped.
     */
    static splinePoints(points) {
        if (!points || points.length < 3) return points ? points.map((p) => ({ x: p.x, y: p.y })) : [];
        const resolution = FILRODENSWMB.TECTONICS.FEATURES.LINE.SPLINE_RESOLUTION;
        const anchored = [points[0], ...points, points.at(-1)];
        const curve = [];
        for (let i = 1; i < anchored.length - 2; i++) {
            for (let t = 0; t <= 1; t += 1 / resolution) {
                const point = LineField.#catmullRom(anchored[i - 1], anchored[i], anchored[i + 1], anchored[i + 2], t);
                const last = curve.at(-1);
                if (last && Math.abs(last.x - point.x) < MIN_POINT_GAP && Math.abs(last.y - point.y) < MIN_POINT_GAP) continue;
                curve.push(point);
            }
        }
        return curve;
    }

    /** The box around the curve widened by `reach`, clipped to the map. */
    static boundsOf(curve, reach, width, height) {
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        for (const point of curve) {
            minX = Math.min(minX, point.x);
            maxX = Math.max(maxX, point.x);
            minY = Math.min(minY, point.y);
            maxY = Math.max(maxY, point.y);
        }
        return {
            minX: Math.max(0, Math.floor(minX - reach)),
            maxX: Math.min(width - 1, Math.ceil(maxX + reach)),
            minY: Math.max(0, Math.floor(minY - reach)),
            maxY: Math.min(height - 1, Math.ceil(maxY + reach)),
        };
    }

    /**
     * The line coordinates of map pixel (x, y), written into `out` ({across, along}). Returns false
     * when the pixel lies beyond the reach (or so close to its edge that part of the grid cell
     * around it does, where every feature has long since faded out).
     */
    sample(x, y, out) {
        const gx = (x - this.bounds.minX) / this.step;
        const gy = (y - this.bounds.minY) / this.step;
        const column = Math.floor(gx);
        const row = Math.floor(gy);
        if (column < 0 || row < 0 || column >= this.columns - 1 || row >= this.rows - 1) return false;

        const i00 = row * this.columns + column;
        const i10 = i00 + 1;
        const i01 = i00 + this.columns;
        const i11 = i01 + 1;
        const a = this.across;
        if (Number.isNaN(a[i00]) || Number.isNaN(a[i10]) || Number.isNaN(a[i01]) || Number.isNaN(a[i11])) return false;

        const fx = gx - column;
        const fy = gy - row;
        out.across = LineField.#bilinear(a[i00], a[i10], a[i01], a[i11], fx, fy);
        out.along = LineField.#bilinear(this.along[i00], this.along[i10], this.along[i01], this.along[i11], fx, fy);
        return true;
    }

    /**
     * The curve moved to its left (anticlockwise) side, for features that place things along a
     * line parallel to their own. `offset` is a distance in pixels, or a function giving it from
     * the distance along the curve, for a parallel line that follows a feature's varying width.
     */
    offsetCurve(offset) {
        const curve = this.curve;
        const offsetAt = typeof offset === "function" ? offset : () => offset;
        let along = 0;
        return curve.map((point, i) => {
            if (i > 0) along += Math.hypot(point.x - curve[i - 1].x, point.y - curve[i - 1].y);
            const distance = offsetAt(along);
            const before = curve[Math.max(0, i - 1)];
            const after = curve[Math.min(curve.length - 1, i + 1)];
            const length = Math.hypot(after.x - before.x, after.y - before.y) || 1;
            const dx = (after.x - before.x) / length;
            const dy = (after.y - before.y) / length;
            // Left of (dx, dy) in screen coordinates (y pointing down) is (dy, -dx)
            return { x: point.x + dy * distance, y: point.y - dx * distance };
        });
    }

    // --- Grid measurement ---

    /**
     * Finds, for every grid point within the reach, its signed distance to the nearest point on the
     * curve and how far along the curve that point is. Each segment only visits the grid points in
     * its own box widened by the reach, and a point keeps whichever segment is nearest.
     */
    #measureGrid() {
        const distanceSq = new Float32Array(this.columns * this.rows).fill(Infinity);
        const reachSq = this.reach * this.reach;
        let start = 0;
        for (let i = 0; i < this.curve.length - 1; i++) {
            const a = this.curve[i];
            const b = this.curve[i + 1];
            const segmentLength = Math.hypot(b.x - a.x, b.y - a.y);
            if (segmentLength > 0) this.#measureSegment(a, b, segmentLength, start, distanceSq, reachSq);
            start += segmentLength;
        }
    }

    #measureSegment(a, b, segmentLength, start, distanceSq, reachSq) {
        const { minX, minY } = this.bounds;
        const firstColumn = Math.max(0, Math.floor((Math.min(a.x, b.x) - this.reach - minX) / this.step));
        const lastColumn = Math.min(this.columns - 1, Math.ceil((Math.max(a.x, b.x) + this.reach - minX) / this.step));
        const firstRow = Math.max(0, Math.floor((Math.min(a.y, b.y) - this.reach - minY) / this.step));
        const lastRow = Math.min(this.rows - 1, Math.ceil((Math.max(a.y, b.y) + this.reach - minY) / this.step));
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const lengthSq = segmentLength * segmentLength;

        for (let row = firstRow; row <= lastRow; row++) {
            const y = minY + row * this.step;
            for (let column = firstColumn; column <= lastColumn; column++) {
                const x = minX + column * this.step;
                const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / lengthSq));
                const px = x - (a.x + t * dx);
                const py = y - (a.y + t * dy);
                const dSq = px * px + py * py;
                const index = row * this.columns + column;
                if (dSq > reachSq || dSq >= distanceSq[index]) continue;
                distanceSq[index] = dSq;
                // The anticlockwise (left) side on screen has a negative cross product, since
                // y points down
                const cross = dx * (y - a.y) - dy * (x - a.x);
                this.across[index] = cross < 0 ? Math.sqrt(dSq) : -Math.sqrt(dSq);
                this.along[index] = start + t * segmentLength;
            }
        }
    }

    /**
     * Box-blurs `along` over the grid points inside the reach (two separable passes). Points
     * outside the reach are neither read nor written, so the blur never pulls in the value 0 they
     * hold and the ends of the line keep their true distances.
     */
    #smoothAlong(radius) {
        const scratch = new Float32Array(this.along.length);
        this.#blurPass(this.along, scratch, radius, true);
        this.#blurPass(scratch, this.along, radius, false);
    }

    #blurPass(source, target, radius, horizontal) {
        const lines = horizontal ? this.rows : this.columns;
        const size = horizontal ? this.columns : this.rows;
        const indexOf = horizontal ? (line, i) => line * this.columns + i : (line, i) => i * this.columns + line;
        const inside = (index) => !Number.isNaN(this.across[index]);

        for (let line = 0; line < lines; line++) {
            let sum = 0;
            let count = 0;
            for (let i = -radius; i < size + radius; i++) {
                const entering = i + radius;
                if (entering < size && inside(indexOf(line, entering))) {
                    sum += source[indexOf(line, entering)];
                    count++;
                }
                const leaving = i - radius - 1;
                if (leaving >= 0 && leaving < size && inside(indexOf(line, leaving))) {
                    sum -= source[indexOf(line, leaving)];
                    count--;
                }
                if (i < 0 || i >= size) continue;
                const index = indexOf(line, i);
                target[index] = inside(index) && count > 0 ? sum / count : source[index];
            }
        }
    }

    // --- Helpers ---

    static #catmullRom(p0, p1, p2, p3, t) {
        const t2 = t * t;
        const t3 = t2 * t;
        const axis = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        return { x: axis(p0.x, p1.x, p2.x, p3.x), y: axis(p0.y, p1.y, p2.y, p3.y) };
    }

    static #curveLength(curve) {
        let length = 0;
        for (let i = 1; i < curve.length; i++) length += Math.hypot(curve[i].x - curve[i - 1].x, curve[i].y - curve[i - 1].y);
        return length;
    }

    static #bilinear(v00, v10, v01, v11, fx, fy) {
        const top = v00 + (v10 - v00) * fx;
        const bottom = v01 + (v11 - v01) * fx;
        return top + (bottom - top) * fy;
    }
}

/**
 * A function of the distance along a line, sampled once per baseline pixel and interpolated.
 *
 * Several features vary smoothly along their line (the range's crest wanders, the rift's basins
 * deepen and shallow). That noise depends only on the distance along the line, so reading it
 * afresh for every pixel across the feature repeats the same work hundreds of times; a table
 * reads it once per baseline pixel of length instead.
 */
export class AlongTable {
    /**
     * @param {number} length - The line's length in map pixels.
     * @param {number} perPixel - Baseline pixels per map pixel.
     * @param {function(number): number} fn - The function, of the distance along in baseline pixels.
     */
    constructor(length, perPixel, fn) {
        this.perPixel = perPixel;
        const samples = Math.ceil(length * perPixel) + 2;
        this.values = new Float32Array(samples);
        for (let i = 0; i < samples; i++) this.values[i] = fn(i);
    }

    /** The value at `along` map pixels along the line. */
    at(along) {
        const position = Math.max(0, along * this.perPixel);
        const i = Math.min(this.values.length - 2, Math.floor(position));
        const f = Math.min(1, position - i);
        return this.values[i] + (this.values[i + 1] - this.values[i]) * f;
    }
}

const MIN_POINT_GAP = 0.1;
