export class SpatialMath {
    /**
     * Calculates the closest segment on a vector path (like routes, faults, or rivers) to a given coordinate.
     *
     * @param {Array} vectorArray - The array of vector objects to check against.
     * @param {number} x - The target X coordinate on the canvas.
     * @param {number} y - The target Y coordinate on the canvas.
     * @param {number} threshold - The maximum distance (in pixels) to consider a valid snap.
     * @returns {Object|null} An object containing the vector, insertion index, distance, and projected coordinates, or null if nothing is within threshold.
     */
    static getClosestVectorSegment(vectorArray, x, y, threshold) {
        if (!vectorArray || vectorArray.length === 0) return null;

        let closest = { vector: null, insertIndex: -1, dist: Infinity, projX: 0, projY: 0 };

        for (const vector of vectorArray) {
            if (vector.visibility === "none" || !vector.points || vector.points.length < 2) continue;

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
