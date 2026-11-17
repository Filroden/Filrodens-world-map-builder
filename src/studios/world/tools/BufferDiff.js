/**
 * Finds where two same-sized map rasters differ, and brings one up to date with the other.
 *
 * Rebuilding terrain replaces whole rasters, but usually only a small part of the map actually
 * ends up different. Knowing exactly which part lets the climate, river and repaint stages
 * work on that part alone instead of the whole map.
 *
 * Differences are found bit for bit, not by numeric comparison: a numeric `!==` treats -0 and +0
 * as equal and NaN as different from itself, and a stage that skipped a pixel because of that
 * could leave the map differing from a full rebuild. Comparing the raw bits has neither problem.
 */
export class BufferDiff {
    /**
     * Bounding box of every pixel where `a` and `b` differ.
     *
     * @param {Float32Array|Uint8Array} a - First raster, one element per pixel.
     * @param {Float32Array|Uint8Array} b - Second raster of the same type and size.
     * @param {number} width - Raster width in pixels.
     * @param {number} height - Raster height in pixels.
     * @returns {{minX: number, maxX: number, minY: number, maxY: number}|null} The box, or null if
     *   the rasters are identical.
     */
    static changedBounds(a, b, width, height) {
        return BufferDiff.#scan(a, b, width, height, null);
    }

    /**
     * Copies into `target` every pixel that differs from `source`, leaving matching pixels
     * untouched, and reports where they were. Afterwards `target` equals `source`.
     *
     * @param {Float32Array|Uint8Array} target - Raster to update.
     * @param {Float32Array|Uint8Array} source - Raster to copy the differences from.
     * @param {number} width - Raster width in pixels.
     * @param {number} height - Raster height in pixels.
     * @returns {{minX: number, maxX: number, minY: number, maxY: number}|null} Box around the
     *   pixels that changed, or null if nothing changed.
     */
    static adoptChanges(target, source, width, height) {
        return BufferDiff.#scan(target, source, width, height, (start, end) => {
            target.set(source.subarray(start, end), start);
        });
    }

    /**
     * Walks the rasters row by row. For each row with differences, reports the span from the first
     * to the last differing pixel (the pixels between are copied along with them, which is
     * harmless because differing spans are only ever copied from the newer raster) to
     * `onChangedSpan`, and grows the box.
     */
    static #scan(a, b, width, height, onChangedSpan) {
        const left = BufferDiff.#asComparable(a);
        const right = BufferDiff.#asComparable(b);
        const box = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };

        for (let y = 0; y < height; y++) {
            const rowStart = y * width;
            const rowEnd = rowStart + width;

            let first = rowStart;
            while (first < rowEnd && left[first] === right[first]) first++;
            if (first === rowEnd) continue;

            let last = rowEnd - 1;
            while (left[last] === right[last]) last--;

            onChangedSpan?.(first, last + 1);
            box.minX = Math.min(box.minX, first - rowStart);
            box.maxX = Math.max(box.maxX, last - rowStart);
            box.minY = Math.min(box.minY, y);
            box.maxY = y;
        }

        return box.minY === Infinity ? null : box;
    }

    /**
     * Float rasters are compared as raw 32-bit integers (see the class comment); byte rasters
     * already compare exactly.
     */
    static #asComparable(raster) {
        return raster instanceof Float32Array ? new Uint32Array(raster.buffer, raster.byteOffset, raster.length) : raster;
    }
}
