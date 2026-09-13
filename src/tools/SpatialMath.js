export class SpatialMath {
    /**
     * Calculates the closest segment on a vector path (like routes, faults, or rivers) to a given coordinate.
     *
     * @param {Array} vectorArray - The array of vector objects to check against.
     * @param {number} x - The target X coordinate on the canvas.
     * @param {number} y - The target Y coordinate on the canvas.
     * @param {number} threshold - The maximum distance (in pixels) to consider a valid snap.
     * @param {boolean} [smoothed=false] - When true, tests against the same Catmull-Rom curve
     *   StudioCanvas renders (e.g. routes, fault lines) instead of the straight chords between
     *   control points, so clicking on the visible curve actually registers as a hit.
     * @returns {Object|null} An object containing the vector, insertion index, distance, and projected coordinates, or null if nothing is within threshold.
     */
    static getClosestVectorSegment(vectorArray, x, y, threshold, smoothed = false) {
        if (!vectorArray || vectorArray.length === 0) return null;

        let closest = { vector: null, insertIndex: -1, dist: Infinity, projX: 0, projY: 0 };

        for (const vector of vectorArray) {
            if (vector.visibility === "none" || !vector.points || vector.points.length < 2) continue;

            if (smoothed) {
                const match = this.#closestPointOnTaggedPath(this.#buildOpenSpline(vector.points), x, y, threshold);
                if (match && match.dist < closest.dist) {
                    closest = { vector, insertIndex: match.insertIndex, dist: match.dist, projX: match.projX, projY: match.projY };
                }
                continue;
            }

            for (let i = 0; i < vector.points.length - 1; i++) {
                const p1 = vector.points[i];
                const p2 = vector.points[i + 1];

                const lengthSq = Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2);
                const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((x - p1.x) * (p2.x - p1.x) + (y - p1.y) * (p2.y - p1.y)) / lengthSq));

                const projX = p1.x + t * (p2.x - p1.x);
                const projY = p1.y + t * (p2.y - p1.y);
                const dist = Math.hypot(x - projX, y - projY);

                if (dist < closest.dist && dist <= threshold) {
                    closest = { vector, insertIndex: i + 1, dist, projX, projY };
                }
            }
        }

        return closest.vector ? closest : null;
    }

    /**
     * Calculates the closest segment on a polygon region to a given coordinate.
     * Regions drawn with `region.smoothing` enabled render as a closed Catmull-Rom curve
     * (see StudioCanvas#getClosedSplinePoints) once they have 3+ points and are no longer the
     * one actively being drawn, so this tests against that same curve in that case.
     *
     * @param {Array} regionLayers - The array of region layer objects.
     * @param {string|null} activeRegionId - The ID of the currently active region being drawn (to prevent closing the polygon prematurely).
     * @param {number} x - The target X coordinate on the canvas.
     * @param {number} y - The target Y coordinate on the canvas.
     * @param {number} threshold - The maximum distance (in pixels) to consider a valid snap.
     * @returns {Object|null} An object containing the region, insertion index, distance, and projected coordinates, or null if nothing is within threshold.
     */
    static getClosestRegionSegment(regionLayers, activeRegionId, x, y, threshold) {
        let closest = { region: null, insertIndex: -1, dist: Infinity, projX: 0, projY: 0 };

        for (const layer of regionLayers) {
            if (layer.visibility === "none") continue;

            for (const region of layer.regions) {
                if (region.visibility === "none" || !region.points || region.points.length < 2) continue;

                // Closed polygons check the segment returning to the start node
                const isClosed = region.points.length >= 3 && region.id !== activeRegionId;

                if (region.smoothing && isClosed) {
                    const match = this.#closestPointOnTaggedPath(this.#buildClosedSpline(region.points), x, y, threshold);
                    if (match && match.dist < closest.dist) {
                        closest = { region, insertIndex: match.insertIndex, dist: match.dist, projX: match.projX, projY: match.projY };
                    }
                    continue;
                }

                const limit = isClosed ? region.points.length : region.points.length - 1;

                for (let i = 0; i < limit; i++) {
                    const p1 = region.points[i];
                    const p2 = region.points[(i + 1) % region.points.length];

                    const lengthSquared = Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2);
                    let t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((x - p1.x) * (p2.x - p1.x) + (y - p1.y) * (p2.y - p1.y)) / lengthSquared));

                    const projX = p1.x + t * (p2.x - p1.x);
                    const projY = p1.y + t * (p2.y - p1.y);
                    const dist = Math.hypot(x - projX, y - projY);

                    if (dist < closest.dist && dist <= threshold) {
                        closest = { region, insertIndex: i + 1, dist, projX, projY };
                    }
                }
            }
        }

        return closest.region ? closest : null;
    }

    // --- Spline Hit-Testing Helpers ---
    // These mirror StudioCanvas's #getSplinePoints / #getClosedSplinePoints formulas exactly (same
    // Catmull-Rom coefficients, same resolution) so the clickable curve always matches the drawn
    // one. Each generated point is tagged with `insertIndex`: the position a new control point
    // should be spliced into the original `points` array if the user clicks there, using the same
    // convention as the straight-line loops above (segment starting at original index i splices at i+1).

    /**
     * Builds a Catmull-Rom curve through an open (non-looping) path, tagged for hit-testing.
     */
    static #buildOpenSpline(points, resolution = 20) {
        if (!points || points.length < 2) return [];
        if (points.length === 2) {
            return [
                { x: points[0].x, y: points[0].y, insertIndex: 1 },
                { x: points[1].x, y: points[1].y, insertIndex: 1 },
            ];
        }

        const tagged = [];
        const p = [points[0], ...points, points[points.length - 1]];

        for (let i = 1; i < p.length - 2; i++) {
            const insertIndex = i; // Splices between original nodes (i - 1) and i
            const p0 = p[i - 1];
            const p1 = p[i];
            const p2 = p[i + 1];
            const p3 = p[i + 2];

            for (let t = 0; t <= 1; t += 1 / resolution) {
                const t2 = t * t;
                const t3 = t2 * t;
                const x = 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
                const y = 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
                tagged.push({ x, y, insertIndex });
            }
        }
        return tagged;
    }

    /**
     * Builds a seamless, wrapped Catmull-Rom loop through a closed polygon, tagged for hit-testing.
     */
    static #buildClosedSpline(points, resolution = 20) {
        if (!points || points.length < 3) return [];

        const tagged = [];
        const n = points.length;
        const p = [points[n - 1], ...points, points[0], points[1]];

        for (let i = 1; i < p.length - 2; i++) {
            const insertIndex = i; // 1..n, matching getClosestRegionSegment's `i + 1` for a closed loop
            const p0 = p[i - 1];
            const p1 = p[i];
            const p2 = p[i + 1];
            const p3 = p[i + 2];

            for (let t = 0; t <= 1; t += 1 / resolution) {
                const t2 = t * t;
                const t3 = t2 * t;
                const x = 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
                const y = 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
                tagged.push({ x, y, insertIndex });
            }
        }
        return tagged;
    }

    /**
     * Finds the closest point on a tagged polyline (a dense curve approximation) to (x, y),
     * projecting onto each fine sub-segment exactly like the straight-line loops above.
     */
    static #closestPointOnTaggedPath(taggedPoints, x, y, threshold) {
        let best = null;

        for (let i = 0; i < taggedPoints.length - 1; i++) {
            const p1 = taggedPoints[i];
            const p2 = taggedPoints[i + 1];

            const lengthSq = Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2);
            const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((x - p1.x) * (p2.x - p1.x) + (y - p1.y) * (p2.y - p1.y)) / lengthSq));

            const projX = p1.x + t * (p2.x - p1.x);
            const projY = p1.y + t * (p2.y - p1.y);
            const dist = Math.hypot(x - projX, y - projY);

            if (dist <= threshold && (!best || dist < best.dist)) {
                const insertIndex = t >= 0.5 ? p2.insertIndex : p1.insertIndex;
                best = { dist, projX, projY, insertIndex };
            }
        }

        return best;
    }

    // --- Bounding Box API ---

    /**
     * Generates a mathematically empty bounding box.
     */
    static getEmptyBounds() {
        return { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
    }

    /**
     * Evaluates whether a bounding box contains valid spatial data.
     */
    static isValidBounds(bounds) {
        return bounds && bounds.minX !== Infinity && bounds.minX <= bounds.maxX && bounds.minY <= bounds.maxY;
    }

    /**
     * Merges two bounding boxes into a single box that encompasses both.
     */
    static mergeBounds(b1, b2) {
        if (!b1 && !b2) return this.getEmptyBounds();
        if (!b1) return b2;
        if (!b2) return b1;

        return {
            minX: Math.min(b1.minX, b2.minX),
            maxX: Math.max(b1.maxX, b2.maxX),
            minY: Math.min(b1.minY, b2.minY),
            maxY: Math.max(b1.maxY, b2.maxY),
        };
    }

    /**
     * Expands a bounding box by a given padding, safely clamping it to the map edges.
     */
    static padBounds(bounds, padX, padY, width, height) {
        if (!this.isValidBounds(bounds)) return bounds;

        return {
            minX: Math.max(0, Math.floor(bounds.minX - padX)),
            maxX: Math.min(width - 1, Math.ceil(bounds.maxX + padX)),
            minY: Math.max(0, Math.floor(bounds.minY - padY)),
            maxY: Math.min(height - 1, Math.ceil(bounds.maxY + padY)),
        };
    }

    /**
     * Intersects two bounding boxes. Returns empty bounds if they do not overlap.
     */
    static intersectBounds(b1, b2) {
        if (!b1 || !b2) return b1 || b2;
        const minX = Math.max(b1.minX, b2.minX);
        const maxX = Math.min(b1.maxX, b2.maxX);
        const minY = Math.max(b1.minY, b2.minY);
        const maxY = Math.min(b1.maxY, b2.maxY);

        if (minX > maxX || minY > maxY) return this.getEmptyBounds();
        return { minX, maxX, minY, maxY };
    }

    /**
     * Calculates the padded bounding box of a vector entity.
     */
    static getVectorBounds(entity, defaultPad = 40) {
        if (!entity?.points || entity.points.length === 0) return null;
        let minX = Infinity,
            maxX = -Infinity,
            minY = Infinity,
            maxY = -Infinity;
        for (const pt of entity.points) {
            minX = Math.min(minX, pt.x);
            maxX = Math.max(maxX, pt.x);
            minY = Math.min(minY, pt.y);
            maxY = Math.max(maxY, pt.y);
        }
        const pad = entity.thickness || entity.width || defaultPad;
        return {
            minX: Math.floor(minX - pad),
            maxX: Math.ceil(maxX + pad),
            minY: Math.floor(minY - pad),
            maxY: Math.ceil(maxY + pad),
        };
    }
}
