/**
 * Generic spatial-aggregation primitives used to summarise the map's raster buffers and vector
 * entities (regions, pins, routes) into the individual cells of a Scene's grid, for
 * GridDataExporter's per-cell exploration data layer.
 *
 * Deliberately independent of Foundry's own Grid classes: every method here works from a plain
 * polygon (an array of `{x, y}` points in the same pixel space as the map's raster buffers) and
 * plain pixel coordinates, however the caller obtained them - a live Foundry Grid instance's
 * `getVertices()` result, or a hand-built shape for a test. That keeps this module runnable and
 * testable in a plain Node script outside a Foundry environment, which is where its own
 * correctness (point-in-polygon edge cases, vote tie-breaking, segment intersection) is verified.
 */
export class GridAggregator {
    /**
     * Standard ray-casting point-in-polygon test. Works for any simple polygon - convex or
     * concave, a square or hexagonal grid cell, or an arbitrary hand-drawn region boundary.
     * @param {number} x
     * @param {number} y
     * @param {{x: number, y: number}[]} polygon
     * @returns {boolean}
     */
    static pointInPolygon(x, y, polygon) {
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const xi = polygon[i].x,
                yi = polygon[i].y;
            const xj = polygon[j].x,
                yj = polygon[j].y;

            const straddlesScanline = yi > y !== yj > y;
            if (!straddlesScanline) continue;

            const intersectionX = ((xj - xi) * (y - yi)) / (yj - yi) + xi;
            if (x < intersectionX) inside = !inside;
        }
        return inside;
    }

    /**
     * Axis-aligned bounding box of a polygon, floored/ceiled outward to whole pixel indices so a
     * caller iterating pixel coordinates never misses a vertex that falls between two pixels.
     * @param {{x: number, y: number}[]} polygon
     * @returns {{minX: number, minY: number, maxX: number, maxY: number}}
     */
    static getPolygonPixelBounds(polygon) {
        let minX = Infinity,
            minY = Infinity,
            maxX = -Infinity,
            maxY = -Infinity;

        for (const point of polygon) {
            if (point.x < minX) minX = point.x;
            if (point.x > maxX) maxX = point.x;
            if (point.y < minY) minY = point.y;
            if (point.y > maxY) maxY = point.y;
        }

        return { minX: Math.floor(minX), minY: Math.floor(minY), maxX: Math.ceil(maxX), maxY: Math.ceil(maxY) };
    }

    /**
     * Cheap rectangle-overlap test, used to discard a region, pin or route segment before paying
     * for an accurate polygon test against it - most of a large map's regions and routes never
     * come near any given cell.
     * @param {{minX: number, minY: number, maxX: number, maxY: number}} a
     * @param {{minX: number, minY: number, maxX: number, maxY: number}} b
     * @returns {boolean}
     */
    static boundsOverlap(a, b) {
        return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
    }

    /**
     * True if the segment p1->p2 crosses, touches, or lies inside `polygon`. Used to decide
     * whether a route (a poly-line, tested one segment at a time) passes through a grid cell.
     * @param {{x: number, y: number}} p1
     * @param {{x: number, y: number}} p2
     * @param {{x: number, y: number}[]} polygon
     * @returns {boolean}
     */
    static segmentIntersectsPolygon(p1, p2, polygon) {
        if (GridAggregator.pointInPolygon(p1.x, p1.y, polygon)) return true;
        if (GridAggregator.pointInPolygon(p2.x, p2.y, polygon)) return true;

        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            if (GridAggregator.#segmentsIntersect(p1, p2, polygon[j], polygon[i])) return true;
        }
        return false;
    }

    /** Signed area of the triangle a-b-c; sign indicates which side of line a-b point c falls on. */
    static #cross(a, b, c) {
        return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    }

    /** True if `point` lies within the axis-aligned bounding box of segment a-b, given they're collinear. */
    static #onSegment(a, b, point) {
        return Math.min(a.x, b.x) <= point.x && point.x <= Math.max(a.x, b.x) && Math.min(a.y, b.y) <= point.y && point.y <= Math.max(a.y, b.y);
    }

    /**
     * Standard orientation-based segment intersection test (handles the general crossing case and
     * the collinear/touching edge cases).
     */
    static #segmentsIntersect(p1, p2, p3, p4) {
        const d1 = GridAggregator.#cross(p3, p4, p1);
        const d2 = GridAggregator.#cross(p3, p4, p2);
        const d3 = GridAggregator.#cross(p1, p2, p3);
        const d4 = GridAggregator.#cross(p1, p2, p4);

        const straddle = ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
        if (straddle) return true;

        if (d1 === 0 && GridAggregator.#onSegment(p3, p4, p1)) return true;
        if (d2 === 0 && GridAggregator.#onSegment(p3, p4, p2)) return true;
        if (d3 === 0 && GridAggregator.#onSegment(p1, p2, p3)) return true;
        if (d4 === 0 && GridAggregator.#onSegment(p1, p2, p4)) return true;
        return false;
    }
}

/**
 * Tallies categorical samples (a resolved biome id, a terrain band, ...) and reports the most
 * frequent one once sampling is done - the "majority vote" a grid cell's field is decided by,
 * since a cell almost always straddles more than one source pixel.
 *
 * Ties are broken by first appearance: `Map` preserves insertion order, and the winner search
 * below only replaces the current leader on a strictly greater count, so among two values with
 * equal counts the one first sampled wins. This makes a tied cell's result depend only on pixel
 * scan order (always top-left to bottom-right, see GridDataExporter), not on iteration order of
 * an unordered structure - the same cell always resolves the same way.
 */
export class VoteTally {
    #counts = new Map();
    #sampleCount = 0;

    /**
     * Records one sample. A `null`/`undefined` value is ignored rather than counted, so a caller
     * can pass through "this pixel has no opinion" without it skewing the vote.
     * @param {*} value
     */
    add(value) {
        if (value === null || value === undefined) return;
        this.#sampleCount++;
        this.#counts.set(value, (this.#counts.get(value) || 0) + 1);
    }

    /**
     * @returns {{value: *, sampleCount: number, agreeCount: number}} `value` is `null` if nothing
     * was ever sampled. `agreeCount` is how many of the samples agreed with the winner, which a
     * caller can compare against `sampleCount` to gauge how mixed the cell actually is.
     */
    get winner() {
        if (this.#sampleCount === 0) return { value: null, sampleCount: 0, agreeCount: 0 };

        let winner = null;
        let winnerCount = -1;
        for (const [value, count] of this.#counts) {
            if (count > winnerCount) {
                winner = value;
                winnerCount = count;
            }
        }
        return { value: winner, sampleCount: this.#sampleCount, agreeCount: winnerCount };
    }
}
