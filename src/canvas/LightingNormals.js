/**
 * The normals the 3D view lights its terrain by (see Scene3D): each vertex is lit as if its slope
 * were its own slope plus an exaggerated broad slope, measured from the heights blurred over a
 * radius. The mesh's heights stay true; only how it is lit changes, so land that rises gently over
 * large areas (a Guided continent's plains and coastal ramps) reads as relief rather than as flat.
 *
 * Pure: no Three.js, so it runs (and is tested) in Node.
 */
export class LightingNormals {
    /**
     * @param {object} grid
     * @param {Float32Array} grid.heights - Each vertex's height (0 is the sea's surface), row by row
     *   from the map's top, `cols` to a row.
     * @param {number} grid.cols
     * @param {number} grid.rows
     * @param {number} grid.spacingX - The distance between neighbouring vertices across, in the
     *   heights' units.
     * @param {number} grid.spacingZ - The same down the map.
     * @param {Uint8Array} [grid.mask] - Vertices raised onto a flat water surface (a lake, or sea ice
     *   lifted onto the sea), which take only their own slope so they stay evenly lit.
     * @param {object} options
     * @param {number} options.emphasis - How strongly the broad slope is added (0: not at all).
     * @param {number} options.radiusPx - How far the broad slope is measured over, in the heights'
     *   horizontal units.
     * @param {number} options.tiltLimit - A soft cap on the broad slope's added tilt, as a gradient
     *   (1 = 45°).
     * @param {number} options.fineGain - How strongly a vertex's own slope counts.
     * @param {number} options.seabedShare - The share of the emphasis the sea bed takes.
     * @param {Float32Array} [out] - Written in place when given (cols × rows × 3).
     * @returns {Float32Array} x, y, z per vertex.
     */
    static compute({ heights, cols, rows, spacingX, spacingZ, mask = null }, { emphasis, radiusPx, tiltLimit, fineGain, seabedShare }, out = new Float32Array(cols * rows * 3)) {
        const count = cols * rows;
        // Land and the sea bed are blurred apart, each with the other held at the sea's surface,
        // so a coast's drop spreads no halo inland or out to sea
        const land = new Float32Array(count);
        const sea = new Float32Array(count);
        for (let i = 0; i < count; i++) {
            const h = heights[i];
            if (h >= 0) land[i] = h;
            else sea[i] = h;
        }
        const radiusX = Math.max(0, Math.round(radiusPx / spacingX));
        const radiusZ = Math.max(0, Math.round(radiusPx / spacingZ));
        const broad = emphasis > 0;
        if (broad) {
            LightingNormals.blur(land, cols, rows, radiusX, radiusZ);
            LightingNormals.blur(sea, cols, rows, radiusX, radiusZ);
        }

        const soften = (g) => g / (1 + Math.abs(g) / tiltLimit);
        for (let row = 0; row < rows; row++) {
            const up = Math.max(0, row - 1);
            const down = Math.min(rows - 1, row + 1);
            const dz = (down - up) * spacingZ || 1;
            for (let col = 0; col < cols; col++) {
                const left = Math.max(0, col - 1);
                const right = Math.min(cols - 1, col + 1);
                const dx = (right - left) * spacingX || 1;
                const i = row * cols + col;

                let gx = (fineGain * (heights[row * cols + right] - heights[row * cols + left])) / dx;
                let gz = (fineGain * (heights[down * cols + col] - heights[up * cols + col])) / dz;
                if (broad && !mask?.[i]) {
                    const onLand = heights[i] >= 0;
                    const field = onLand ? land : sea;
                    const gain = onLand ? emphasis : emphasis * seabedShare;
                    gx += soften((gain * (field[row * cols + right] - field[row * cols + left])) / dx);
                    gz += soften((gain * (field[down * cols + col] - field[up * cols + col])) / dz);
                }

                const length = Math.hypot(gx, 1, gz);
                out[i * 3] = -gx / length;
                out[i * 3 + 1] = 1 / length;
                out[i * 3 + 2] = -gz / length;
            }
        }
        return out;
    }

    /**
     * Blurs a grid in place: three passes of a separable box blur (close to a Gaussian), its edges
     * clamped.
     * @param {Float32Array} values
     * @param {number} cols
     * @param {number} rows
     * @param {number} radiusX - In vertices.
     * @param {number} radiusZ - In vertices.
     */
    static blur(values, cols, rows, radiusX, radiusZ) {
        const line = new Float32Array(Math.max(cols, rows));
        const blurred = new Float32Array(Math.max(cols, rows));
        for (let pass = 0; pass < 3; pass++) {
            if (radiusX > 0) {
                for (let row = 0; row < rows; row++) {
                    for (let col = 0; col < cols; col++) line[col] = values[row * cols + col];
                    LightingNormals.#boxLine(line, blurred, cols, radiusX);
                    for (let col = 0; col < cols; col++) values[row * cols + col] = blurred[col];
                }
            }
            if (radiusZ > 0) {
                for (let col = 0; col < cols; col++) {
                    for (let row = 0; row < rows; row++) line[row] = values[row * cols + col];
                    LightingNormals.#boxLine(line, blurred, rows, radiusZ);
                    for (let row = 0; row < rows; row++) values[row * cols + col] = blurred[row];
                }
            }
        }
    }

    /** One box blur along a line of `length` values, its ends clamped (a running sum). */
    static #boxLine(source, target, length, radius) {
        const at = (index) => source[Math.max(0, Math.min(length - 1, index))];
        const width = 2 * radius + 1;
        let sum = 0;
        for (let offset = -radius; offset <= radius; offset++) sum += at(offset);
        for (let index = 0; index < length; index++) {
            target[index] = sum / width;
            sum += at(index + radius + 1) - at(index - radius);
        }
    }
}
