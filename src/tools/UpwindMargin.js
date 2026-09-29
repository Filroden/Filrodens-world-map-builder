/**
 * The ground just beyond a regional map's left and right edges, as its parent map had it, so the
 * regional map's climate can look upwind past its own edge.
 *
 * A pixel's moisture depends on the elevation a set distance upwind along its row (see
 * ProceduralEngine.getMoistureAt). Near a map's left or right edge that point can fall outside
 * the map. The map at the top of a chain of crops has nothing there, and reads its own edge
 * column instead. A regional map does have something there: the rest of its parent. Without this
 * record it read its own edge column too, so in a strip one wind distance wide along its upwind
 * edges its rain shadows differed from its parent's, and so did its biomes.
 *
 * When a regional map is cropped, the parent's final elevation (the same elevation its climate
 * reads, with brush strokes, faults and rivers) is copied for a strip either side of the crop,
 * as wide as the parent's wind reach. The strips are kept at the parent's own resolution: that is
 * the detail the parent's climate saw there, and it keeps the record small. A crop of a regional
 * map fills any part of its strips beyond its parent's edges from the parent's own strips, so the
 * record stays right through crops of crops. Beyond the map at the top of the chain the strips
 * repeat that map's edge column, which is exactly what that map reads there itself.
 *
 * Stored with the map (`upwindMargin` in the saved data) with each strip's heights packed into
 * 16 bits, which is far finer than anything the climate can show. A map without the record
 * (every map that was never cropped, and regional maps made before it existed) reads its own
 * edge column as before, so nothing else changes.
 *
 * Nothing here touches Foundry globals, so it can be exercised directly from Node.
 */
export class UpwindMargin {
    /** Revision of the stored form, for any later change to it. */
    static FORMAT = 1;

    /** Largest value of a packed 16-bit height. */
    static #PACKED_MAX = 65535;

    /** Decoded records by stored record, so a map's strips are unpacked once, not per refresh. */
    static #decoded = new WeakMap();

    /**
     * Builds the record for a regional map about to be cropped out of a parent map.
     *
     * @param {object} parent - The parent map as it is now.
     * @param {Float32Array} parent.elevation - Its final elevation (what its climate reads).
     * @param {number} parent.width - Its width in pixels.
     * @param {number} parent.height - Its height in pixels.
     * @param {number} parent.windDistance - How far its climate looks upwind, in its pixels
     *   (ProceduralEngine.getWindDistance).
     * @param {object|null} [parent.margin] - Its own stored record, if it is a regional map.
     * @param {{x: number, y: number, width: number, height: number}} cropBox - The crop, in the parent's pixels.
     * @param {number} zoomScale - Regional pixels per parent pixel.
     * @returns {object|null} The record to store with the regional map, or null if the parent
     *   has no elevation to copy.
     */
    static build(parent, cropBox, zoomScale) {
        if (!parent?.elevation || !(parent.width > 0) || !(parent.height > 0) || !(zoomScale > 0)) return null;

        const parentMargin = this.decode(parent.margin);
        // A column or two more than the parent's own reach: the regional map's reach is the
        // parent's enlarged by the zoom and rounded to whole regional pixels, so it can end just
        // past the parent's reach, and a crop edge part-way through a parent pixel adds one more.
        const reach = Math.max(0, Math.ceil(parent.windDistance ?? 0)) + 2;
        const rowStart = Math.floor(cropBox.y);
        const rows = Math.floor(cropBox.y + cropBox.height) - rowStart + 1;
        const leftStart = Math.floor(cropBox.x) - reach;
        const rightStart = Math.floor(cropBox.x + cropBox.width);

        const readStrip = (start) => {
            const values = new Float32Array(rows * (reach + 1));
            for (let row = 0; row < rows; row++) {
                const parentY = Math.min(parent.height - 1, Math.max(0, rowStart + row));
                for (let col = 0; col <= reach; col++) {
                    values[row * (reach + 1) + col] = this.#parentElevationAt(parent, parentMargin, start + col, parentY);
                }
            }
            return values;
        };

        return {
            format: this.FORMAT,
            scale: zoomScale,
            cropX: cropBox.x,
            cropY: cropBox.y,
            rowStart,
            rows,
            cols: reach + 1,
            left: this.#pack(readStrip(leftStart), leftStart),
            right: this.#pack(readStrip(rightStart), rightStart),
        };
    }

    /**
     * Unpacks a stored record into the form sampleAt reads. The result is cached against the
     * stored object, so repeated climate refreshes of the same map unpack it once.
     *
     * @param {object|null|undefined} stored - A record from build (as saved with a map).
     * @returns {object|null} The unpacked record, or null if there is none or it is not readable.
     */
    static decode(stored) {
        if (!stored || typeof stored !== "object" || stored.format !== this.FORMAT) return null;
        if (this.#decoded.has(stored)) return this.#decoded.get(stored);

        const size = stored.rows * stored.cols;
        const left = this.#unpack(stored.left, size);
        const right = this.#unpack(stored.right, size);
        const decoded = left && right && stored.scale > 0 ? { scale: stored.scale, cropX: stored.cropX, cropY: stored.cropY, rowStart: stored.rowStart, rows: stored.rows, cols: stored.cols, left, right } : null;

        this.#decoded.set(stored, decoded);
        return decoded;
    }

    /**
     * The parent's elevation at a column of the regional map beyond its left or right edge.
     *
     * The regional pixel is placed within the parent by the centre of the pixel, which picks
     * the parent pixel it lies in, as the parent's own climate would have read it. Rows and
     * columns beyond the stored strips (past the top map's edges) repeat the nearest stored one.
     *
     * @param {object} margin - A record from decode.
     * @param {number} x - Regional pixel column, below 0 or at least the map's width.
     * @param {number} y - Regional pixel row.
     * @returns {number} The elevation.
     */
    static sampleAt(margin, x, y) {
        const strip = x < 0 ? margin.left : margin.right;
        const parentX = Math.floor(margin.cropX + (x + 0.5) / margin.scale);
        const parentY = Math.floor(margin.cropY + (y + 0.5) / margin.scale);
        const col = Math.min(margin.cols - 1, Math.max(0, parentX - strip.start));
        const row = Math.min(margin.rows - 1, Math.max(0, parentY - margin.rowStart));
        return strip.values[row * margin.cols + col];
    }

    /**
     * The parent's elevation at one of its own pixels, which may lie beyond its left or right
     * edge: there it comes from the parent's own record if it is a regional map, and otherwise
     * repeats its edge column, just as its climate reads it.
     */
    static #parentElevationAt(parent, parentMargin, x, y) {
        if (x >= 0 && x < parent.width) return parent.elevation[y * parent.width + x];
        if (parentMargin) return this.sampleAt(parentMargin, x, y);
        return parent.elevation[y * parent.width + Math.min(parent.width - 1, Math.max(0, x))];
    }

    /** Packs a strip's heights into 16 bits across the strip's own range, as base64. */
    static #pack(values, start) {
        let min = Infinity;
        let max = -Infinity;
        for (const value of values) {
            if (value < min) min = value;
            if (value > max) max = value;
        }
        const range = max - min;
        const packed = new Uint16Array(values.length);
        if (range > 0) {
            for (let i = 0; i < values.length; i++) packed[i] = Math.round(((values[i] - min) / range) * this.#PACKED_MAX);
        }
        return { start, min, max, data: this.#toBase64(new Uint8Array(packed.buffer)) };
    }

    /** Unpacks a strip packed by #pack, or null if it does not hold `size` heights. */
    static #unpack(strip, size) {
        if (!strip || typeof strip.data !== "string") return null;
        const bytes = this.#fromBase64(strip.data);
        if (bytes.length !== size * 2) return null;

        const packed = new Uint16Array(bytes.buffer, bytes.byteOffset, size);
        const range = strip.max - strip.min;
        const values = new Float32Array(size);
        for (let i = 0; i < size; i++) values[i] = strip.min + (packed[i] / this.#PACKED_MAX) * range;
        return { start: strip.start, values };
    }

    static #toBase64(bytes) {
        // In chunks: String.fromCharCode cannot take a whole large strip as arguments at once
        const CHUNK = 0x8000;
        let binary = "";
        for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
        return btoa(binary);
    }

    static #fromBase64(text) {
        const binary = atob(text);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
    }
}
