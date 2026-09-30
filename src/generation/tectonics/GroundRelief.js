/**
 * The ground's own relief near a feature: each pixel's height minus the average height around it.
 *
 * A mountain range raises and enlarges this (so it is made of the land's own hills, only bigger)
 * and a rift's sediment partly buries it. It is measured on the ground before any feature, so it
 * is the same wherever and in whatever order features are applied.
 */
export class GroundRelief {
    /**
     * @param {Float32Array} ground - The whole map's ground before any feature.
     * @param {number} width - The map's width in pixels.
     * @param {number} height - The map's height in pixels.
     * @param {{minX: number, maxX: number, minY: number, maxY: number}} bounds - Where it is needed.
     * @param {number} radius - The averaging radius in map pixels (the box is 2 * radius + 1 wide).
     * @returns {{at: function(number, number): number}} The relief at a map pixel inside `bounds`.
     */
    static measure(ground, width, height, bounds, radius) {
        // A summed-area table over the bounds widened by the radius, so each average costs four reads
        const minX = Math.max(0, bounds.minX - radius);
        const maxX = Math.min(width - 1, bounds.maxX + radius);
        const minY = Math.max(0, bounds.minY - radius);
        const maxY = Math.min(height - 1, bounds.maxY + radius);
        const columns = maxX - minX + 2;
        const rows = maxY - minY + 2;
        const table = new Float64Array(columns * rows);
        for (let y = minY; y <= maxY; y++) {
            let rowSum = 0;
            const row = (y - minY + 1) * columns;
            const above = (y - minY) * columns;
            for (let x = minX; x <= maxX; x++) {
                rowSum += ground[y * width + x];
                table[row + x - minX + 1] = table[above + x - minX + 1] + rowSum;
            }
        }

        const sum = (x0, y0, x1, y1) => table[y1 * columns + x1] - table[y0 * columns + x1] - table[y1 * columns + x0] + table[y0 * columns + x0];
        return {
            at: (x, y) => {
                const x0 = Math.max(minX, x - radius) - minX;
                const x1 = Math.min(maxX, x + radius) - minX + 1;
                const y0 = Math.max(minY, y - radius) - minY;
                const y1 = Math.min(maxY, y + radius) - minY + 1;
                const mean = sum(x0, y0, x1, y1) / ((x1 - x0) * (y1 - y0));
                return ground[y * width + x] - mean;
            },
        };
    }
}
