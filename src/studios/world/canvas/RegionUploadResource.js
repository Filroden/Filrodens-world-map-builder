const BYTES_PER_PIXEL = 4;

/**
 * Remembers which rows of a texture have been changed since it was last uploaded to the GPU.
 *
 * The changed rows of several updates are merged into one band (the lowest and highest row that
 * changed), which is what makes a texture that is updated many times between two renders cost one
 * upload. Nothing recorded and "everything changed" are kept apart on purpose: a texture that
 * has never been uploaded, or whose contents are in doubt, must be sent whole.
 */
export class RowRangeTracker {
    #everything = true;
    #minRow = Infinity;
    #maxRow = -Infinity;

    /** Records that any row may have changed. */
    markEverything() {
        this.#everything = true;
    }

    /**
     * Records that the rows from minRow to maxRow, both included, changed.
     *
     * @param {number} minRow - First changed row.
     * @param {number} maxRow - Last changed row.
     */
    markRows(minRow, maxRow) {
        if (this.#everything) return;

        this.#minRow = Math.min(this.#minRow, minRow);
        this.#maxRow = Math.max(this.#maxRow, maxRow);
    }

    /**
     * Returns what changed since the last call and starts recording again from nothing.
     *
     * @returns {{minRow: number, maxRow: number}|null} The band of changed rows, or null when the
     *     whole texture has to be sent (everything changed, or nothing was recorded).
     */
    take() {
        const hasBand = !this.#everything && this.#minRow <= this.#maxRow;
        const band = hasBand ? { minRow: this.#minRow, maxRow: this.#maxRow } : null;

        this.#everything = false;
        this.#minRow = Infinity;
        this.#maxRow = -Infinity;
        return band;
    }
}

// One class per PIXI namespace, so a test stand-in and the real thing never share one
const resourceClasses = new WeakMap();

/**
 * Returns the texture resource class that sends only the changed rows of a pixel buffer to the GPU.
 *
 * The class is built on first use, from the PIXI namespace it is given, so that this module can be
 * loaded before PIXI is available and can be tested with a stand-in.
 *
 * PIXI 7's BufferResource copies and uploads its whole buffer every time it is updated. On a large
 * map that is about 31 MB per layer, however small the edited area is. This resource keeps the
 * same buffer, but write() copies only the rows that changed into it, and upload() sends only the
 * band of rows that changed since the last upload. The band spans the full width: a row range is
 * one contiguous piece of the buffer, so it needs no unpack state that later uploads would have
 * to reset.
 *
 * It falls back to what BufferResource does, a whole upload, whenever it cannot be sure the
 * texture on the GPU matches what it last saw: the first upload, a size change, a texture the
 * GPU had to recreate (for example after a lost context), a pixel buffer that is not the one it
 * last copied from, and an update nobody recorded. The changed rows are recorded once for the
 * resource, not per renderer, so it assumes the single renderer that the map canvas has.
 *
 * This is written against PIXI 7's BufferResource.upload(renderer, baseTexture, glTexture).
 *
 * @param {object} pixi - The PIXI namespace.
 * @returns {Function} The resource class, a subclass of PIXI.BufferResource.
 */
export function getRegionUploadResource(pixi) {
    if (resourceClasses.has(pixi)) return resourceClasses.get(pixi);

    const RegionUploadResource = class extends pixi.BufferResource {
        #rows = new RowRangeTracker();
        #source = null;

        /**
         * Brings the texture's copy of the pixels up to date with the pixel buffer and records which
         * rows that touched. The caller still has to call update() on the base texture.
         *
         * A repaint area is only trusted when the pixel buffer is the same object as last time, since
         * a different one may differ anywhere.
         *
         * @param {Uint8Array} pixelBuffer - The RGBA pixels of the whole map, in the texture's size.
         * @param {{minY: number, maxY: number}|null} bounds - The rows that may differ from what was
         *     copied last time, or null when any of them may.
         */
        write(pixelBuffer, bounds = null) {
            const isSameSource = pixelBuffer === this.#source;
            this.#source = pixelBuffer;

            if (!bounds || !isSameSource) {
                this.data.set(pixelBuffer);
                this.#rows.markEverything();
                return;
            }

            const minRow = Math.max(0, Math.floor(bounds.minY));
            const maxRow = Math.min(this.height - 1, Math.ceil(bounds.maxY));
            if (minRow > maxRow) return;

            const rowBytes = this.width * BYTES_PER_PIXEL;
            const start = minRow * rowBytes;
            this.data.set(pixelBuffer.subarray(start, (maxRow + 1) * rowBytes), start);
            this.#rows.markRows(minRow, maxRow);
        }

        /**
         * Uploads the changed band of rows, or the whole texture when it has to be sent whole.
         *
         * @param {object} renderer - The PIXI renderer.
         * @param {object} baseTexture - The texture this resource belongs to.
         * @param {object} glTexture - The renderer's GPU texture for it.
         * @returns {boolean} True once the upload is done.
         */
        upload(renderer, baseTexture, glTexture) {
            const band = this.#rows.take();
            const width = baseTexture.realWidth;
            const height = baseTexture.realHeight;
            const isOnGpu = glTexture.width === width && glTexture.height === height && glTexture.dirtyId >= 0;
            if (!band || !isOnGpu) return super.upload(renderer, baseTexture, glTexture);

            const gl = renderer.gl;
            const rowBytes = width * BYTES_PER_PIXEL;
            const rows = this.data.subarray(band.minRow * rowBytes, (band.maxRow + 1) * rowBytes);

            gl.pixelStorei(gl.UNPACK_ALIGNMENT, this.unpackAlignment);
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, baseTexture.alphaMode === pixi.ALPHA_MODES.UNPACK);
            gl.texSubImage2D(baseTexture.target, 0, 0, band.minRow, width, band.maxRow - band.minRow + 1, baseTexture.format, glTexture.type, rows);
            return true;
        }
    };

    resourceClasses.set(pixi, RegionUploadResource);
    return RegionUploadResource;
}
