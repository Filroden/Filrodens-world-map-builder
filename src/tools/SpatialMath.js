import { FILRODENSWMB } from "../config.js";
import { CatmullRom } from "./CatmullRom.js";

export class SpatialMath {
    /**
     * Calculates the closest segment on a vector path (like routes, faults, or rivers) to a given coordinate.
     *
     * @param {Array} vectorArray - The array of vector objects to check against.
     * @param {number} x - The target X coordinate on the canvas.
     * @param {number} y - The target Y coordinate on the canvas.
     * @param {number} threshold - The maximum distance (in pixels) to consider a valid snap.
     * @param {boolean} [smoothed=false] - When true, tests against the same Catmull-Rom curve
     *   StudioCanvas renders (fault lines, custom rivers) instead of the straight chords between
     *   control points, so clicking on the visible curve actually registers as a hit.
     * @param {boolean} [centripetal=false] - The centripetal curve rather than the uniform one,
     *   as the map's terrain revision draws it (see TerrainVersion.usesCentripetalLines).
     * @returns {Object|null} An object containing the vector, insertion index, distance, and projected coordinates, or null if nothing is within threshold.
     */
    static getClosestVectorSegment(vectorArray, x, y, threshold, smoothed = false, centripetal = false) {
        if (!vectorArray || vectorArray.length === 0) return null;

        let closest = { vector: null, insertIndex: -1, dist: Infinity, projX: 0, projY: 0 };

        for (const vector of vectorArray) {
            if (vector.visibility === "none" || !vector.points || vector.points.length < 2) continue;

            if (smoothed) {
                const match = this.#closestPointOnTaggedPath(this.#buildOpenSpline(vector.points, centripetal), x, y, threshold);
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
     * Calculates the closest segment on a polygon region (a land mask, drawn with straight sides)
     * to a given coordinate.
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
                const isClosed = region.points.length >= FILRODENSWMB.LIMITS.MIN_POLYGON_VERTICES && region.id !== activeRegionId;

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

    /**
     * The curve StudioCanvas draws through an open path (see CatmullRom), each sample tagged with
     * `insertIndex`: where a new control point is spliced into `points` if the user clicks there,
     * by the same convention as the straight-line loop above (the stretch starting at point i
     * splices at i + 1). Two points make a straight line.
     */
    static #buildOpenSpline(points, centripetal = false, resolution = 20) {
        if (!points || points.length < 2) return [];
        if (points.length === 2) {
            return [
                { x: points[0].x, y: points[0].y, insertIndex: 1 },
                { x: points[1].x, y: points[1].y, insertIndex: 1 },
            ];
        }
        return CatmullRom.open(points, { centripetal, resolution }).map((p) => ({ x: p.x, y: p.y, insertIndex: p.span + 1 }));
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
