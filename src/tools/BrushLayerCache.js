import { FILRODENSWMB } from "../config.js";

/** Edge length, in pixels, of the square tiles a stroke's undo patch is cut into. */
const PATCH_TILE_SIZE = 64;

/**
 * Upper bound on the memory all undo patches together may hold. When a new patch would take the
 * total past this, the oldest patches are dropped; undoing a stroke that lost its patch is still
 * correct, it just rebuilds the whole layer by replaying the history instead of restoring a tile.
 */
const PATCH_BUDGET_BYTES = 64 * 1024 * 1024;

/**
 * The brushed layer of a map: the base terrain with every raster brush stroke in the history
 * applied, and nothing else (no faults, no rivers).
 *
 * Rebuilding terrain after any brush edit used to mean starting from the base and replaying every
 * stroke ever painted, which on a map with thousands of strokes dominates the time of every stroke,
 * undo and redo. Keeping this layer alongside the working terrain turns that into a copy: the
 * working terrain is this layer with the vector features carved on top, so a rebuild only has to
 * copy it and carve again.
 *
 * The layer is only useful if it is exactly what a full replay would produce, so it is never
 * updated by anything except the operations below, each of which reproduces a replay's result:
 *
 * - A finished stroke is applied to it by replaying that stroke's recorded points, the same
 *   calls a full replay makes for that stroke.
 * - Undoing a stroke pastes back the pixels the stroke overwrote. Before a stroke is applied, the
 *   tiles it is about to touch are copied aside (a "patch"); pasting them back restores the layer
 *   to the exact state it had before the stroke, without replaying anything.
 * - Redoing a stroke applies it again, which records a fresh patch.
 *
 * Anything else that could change what a replay produces (a new base terrain, a different sea
 * level, strokes edited in place, an undo whose patch has been dropped) makes the layer invalid,
 * and it stays invalid until BrushEngine#rebuildLayerCache replays the history from the base.
 * Callers must check `valid` before trusting the buffers.
 */
export class BrushLayerCache {
    /** Base terrain plus every stroke's elevation changes. Allocated on the first rebuild. */
    elevation = null;

    /** Painted biome overrides from every biome stroke. Allocated on the first rebuild. */
    overrides = null;

    /** Whether `elevation` and `overrides` currently equal a full replay of the stroke history. */
    valid = false;

    /** Sea level the layer was built with. Biome paint tests elevation against it, so it is part of the result. */
    seaLevel = null;

    #width;
    #height;
    #tilesAcross;
    #patchBudgetBytes;
    #maxPatches;

    /** Undo patches by stroke, oldest first. */
    #patches = new Map();
    #patchBytes = 0;

    /** The patch being recorded while a stroke is applied, or null. */
    #recording = null;

    /**
     * @param {number} width - Map width in pixels.
     * @param {number} height - Map height in pixels.
     * @param {object} [options] - Limits, overridable so tests can exercise dropping patches.
     * @param {number} [options.patchBudgetBytes] - Memory all patches together may hold.
     * @param {number} [options.maxPatches] - How many patches to keep. Only as many strokes as the
     *   session undo history holds can ever be undone, so keeping more would be wasted memory.
     */
    constructor(width, height, { patchBudgetBytes = PATCH_BUDGET_BYTES, maxPatches = FILRODENSWMB.LIMITS.HISTORY_MAX } = {}) {
        this.#width = width;
        this.#height = height;
        this.#tilesAcross = Math.ceil(width / PATCH_TILE_SIZE);
        this.#patchBudgetBytes = patchBudgetBytes;
        this.#maxPatches = maxPatches;
    }

    /**
     * Restarts the layer from a base terrain with no strokes applied. The layer stays invalid
     * until markValid(), which the caller calls once it has replayed the stroke history into the
     * buffers.
     *
     * @param {Float32Array} baseElevation - The base terrain, same size as the map.
     * @param {number} seaLevel - Sea level the replay will use.
     */
    reset(baseElevation, seaLevel) {
        const pixels = this.#width * this.#height;
        this.elevation ??= new Float32Array(pixels);
        this.overrides ??= new Uint8Array(pixels);

        this.elevation.set(baseElevation);
        this.overrides.fill(0);
        this.seaLevel = seaLevel;
        this.valid = false;
        this.#discardAllPatches();
    }

    markValid() {
        this.valid = true;
    }

    /**
     * Marks the layer as no longer matching a full replay, and frees the undo patches, which
     * describe states of a layer that no longer exists.
     */
    invalidate() {
        this.valid = false;
        this.#recording = null;
        this.#discardAllPatches();
    }

    /**
     * Whether the layer can be used for a rebuild that uses `seaLevel`.
     *
     * @param {number} seaLevel - Sea level the rebuild will use.
     * @returns {boolean} True if the layer is valid and was built with the same sea level.
     */
    isCurrentFor(seaLevel) {
        return this.valid && this.seaLevel === seaLevel;
    }

    /**
     * Starts recording the pixels `stroke` overwrites. Call noteFootprint() for each stamp before
     * it is drawn, then commitPatch() when the stroke is done.
     *
     * @param {object} stroke - The stroke about to be applied to the layer.
     */
    beginPatch(stroke) {
        this.#recording = { stroke, tiles: new Map(), bytes: 0 };
    }

    /**
     * Copies aside every tile a stamp is about to touch that the stroke has not touched yet, so
     * each tile is saved exactly once, in the state it had before the stroke.
     *
     * @param {{minX: number, maxX: number, minY: number, maxY: number}} footprint - Pixel area the
     *   stamp may write, already clipped to the map.
     */
    noteFootprint(footprint) {
        const recording = this.#recording;
        if (!recording) return;

        const buffer = this.#bufferFor(recording.stroke);
        if (!buffer) return;

        const lastTileX = Math.floor(footprint.maxX / PATCH_TILE_SIZE);
        const lastTileY = Math.floor(footprint.maxY / PATCH_TILE_SIZE);

        for (let tileY = Math.floor(footprint.minY / PATCH_TILE_SIZE); tileY <= lastTileY; tileY++) {
            for (let tileX = Math.floor(footprint.minX / PATCH_TILE_SIZE); tileX <= lastTileX; tileX++) {
                this.#saveTile(recording, buffer, tileX, tileY);
            }
        }
    }

    /**
     * Stores the patch being recorded, then drops the oldest patches if that takes the stored
     * total past its limits.
     */
    commitPatch() {
        const recording = this.#recording;
        this.#recording = null;
        if (!recording) return;

        this.discardPatch(recording.stroke);
        this.#patches.set(recording.stroke, recording);
        this.#patchBytes += recording.bytes;
        this.#enforceLimits();
    }

    /**
     * Restores the layer to the state it had before `stroke` was applied, and consumes the
     * patch (redoing the stroke records a new one).
     *
     * @param {object} stroke - The stroke being undone.
     * @returns {boolean} False if there is no patch for the stroke, in which case nothing was
     *   changed and the caller must invalidate the layer.
     */
    revert(stroke) {
        const patch = this.#patches.get(stroke);
        if (!patch) return false;

        const buffer = this.#bufferFor(stroke);
        for (const [tileIndex, saved] of patch.tiles) {
            this.#pasteTile(buffer, tileIndex, saved);
        }

        this.discardPatch(stroke);
        return true;
    }

    /**
     * Forgets the patch for a stroke, for example because the stroke was removed from the redo
     * stack and can never be undone or redone again.
     *
     * @param {object} stroke - The stroke whose patch to drop.
     */
    discardPatch(stroke) {
        const patch = this.#patches.get(stroke);
        if (!patch) return;

        this.#patchBytes -= patch.bytes;
        this.#patches.delete(stroke);
    }

    /**
     * Which of the layer's two buffers a stroke writes to: terrain strokes change elevation,
     * biome strokes change the overrides, and any other layer changes nothing.
     */
    #bufferFor(stroke) {
        if (stroke.layer === "terrain") return this.elevation;
        if (stroke.layer === "biome") return this.overrides;
        return null;
    }

    /** Rectangle of the map a tile covers; tiles on the right and bottom edges are clipped. */
    #tileRect(tileIndex) {
        const x = (tileIndex % this.#tilesAcross) * PATCH_TILE_SIZE;
        const y = Math.floor(tileIndex / this.#tilesAcross) * PATCH_TILE_SIZE;

        return { x, y, width: Math.min(PATCH_TILE_SIZE, this.#width - x), height: Math.min(PATCH_TILE_SIZE, this.#height - y) };
    }

    #saveTile(recording, buffer, tileX, tileY) {
        const tileIndex = tileY * this.#tilesAcross + tileX;
        if (recording.tiles.has(tileIndex)) return;

        const { x, y, width, height } = this.#tileRect(tileIndex);
        const saved = new buffer.constructor(width * height);

        for (let row = 0; row < height; row++) {
            const start = (y + row) * this.#width + x;
            saved.set(buffer.subarray(start, start + width), row * width);
        }

        recording.tiles.set(tileIndex, saved);
        recording.bytes += saved.byteLength;
    }

    #pasteTile(buffer, tileIndex, saved) {
        const { x, y, width, height } = this.#tileRect(tileIndex);

        for (let row = 0; row < height; row++) {
            buffer.set(saved.subarray(row * width, (row + 1) * width), (y + row) * this.#width + x);
        }
    }

    /** Drops the oldest patches until the stored total is within the count and memory limits. */
    #enforceLimits() {
        for (const stroke of this.#patches.keys()) {
            if (this.#patches.size <= this.#maxPatches && this.#patchBytes <= this.#patchBudgetBytes) return;
            this.discardPatch(stroke);
        }
    }

    #discardAllPatches() {
        this.#patches.clear();
        this.#patchBytes = 0;
    }
}
