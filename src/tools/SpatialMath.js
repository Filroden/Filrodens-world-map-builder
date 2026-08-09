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
}
