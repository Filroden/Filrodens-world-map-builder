/**
 * The change one tectonic feature makes to the ground, over the box it can reach.
 *
 * Every feature is worked out from the ground beneath it before any feature was applied (see
 * TectonicFeatureEngine), so its change can be kept and reused as long as its settings and that
 * ground stay the same, and features combine by adding their changes in any order.
 */
export class FeatureDelta {
    /**
     * @param {{minX: number, maxX: number, minY: number, maxY: number}} bounds - Inclusive box,
     *   inside the map.
     */
    constructor(bounds) {
        this.bounds = bounds;
        this.width = bounds.maxX - bounds.minX + 1;
        this.height = bounds.maxY - bounds.minY + 1;
        this.data = new Float32Array(Math.max(0, this.width * this.height));
    }

    /** Index into `data` of map pixel (x, y), which must lie inside the bounds. */
    indexOf(x, y) {
        return (y - this.bounds.minY) * this.width + (x - this.bounds.minX);
    }

    /**
     * Adds the change to `elevation` (the whole map), only within `limit` when one is given.
     *
     * @param {Float32Array} elevation - The map's elevation, changed in place.
     * @param {number} mapWidth - The map's width in pixels.
     * @param {object|null} limit - Inclusive box to restrict the change to, or null.
     */
    addTo(elevation, mapWidth, limit = null) {
        const { minX, maxX, minY, maxY } = this.bounds;
        const x0 = limit ? Math.max(minX, limit.minX) : minX;
        const x1 = limit ? Math.min(maxX, limit.maxX) : maxX;
        const y0 = limit ? Math.max(minY, limit.minY) : minY;
        const y1 = limit ? Math.min(maxY, limit.maxY) : maxY;
        for (let y = y0; y <= y1; y++) {
            let source = this.indexOf(x0, y);
            let target = y * mapWidth + x0;
            for (let x = x0; x <= x1; x++) elevation[target++] += this.data[source++];
        }
    }
}

/**
 * A per-pixel value over a box, worked out the first time each pixel asks for it.
 *
 * Neighbouring volcanoes overlap, and the world-space noise that textures them (lava flows,
 * erosion) depends only on the pixel, so without this every overlapping volcano would read the
 * same noise again.
 */
export class LazyField {
    /**
     * @param {FeatureDelta} layout - Supplies the box and indexing.
     * @param {function(number, number): number} fn - The value at map pixel (x, y).
     */
    constructor(layout, fn) {
        this.layout = layout;
        this.fn = fn;
        this.values = new Float32Array(layout.data.length).fill(Number.NaN);
    }

    at(x, y) {
        const index = this.layout.indexOf(x, y);
        let value = this.values[index];
        if (Number.isNaN(value)) {
            value = this.fn(x, y);
            this.values[index] = value;
        }
        return value;
    }
}
