/**
 * The open map's rasters and the buffers made from them, owned in one place: allocated for the
 * map's size, and cleared, here (RF2). The studio holds one as `app.terrain`, and keeps every
 * field's old name as an accessor onto it (see TerrainBuffers.expose), so the code that reads
 * `app.currentElevationData` or `app.bufferRivers` is unchanged.
 */
export class TerrainBuffers {
    /** The rasters a map's terrain is worked out in, one value per pixel. */
    static DATA = Object.freeze(["baseElevationData", "currentElevationData", "currentMoistureData", "currentTemperatureData", "currentBiomeOverrides", "currentSpringOverrides", "currentRoughness"]);

    /** The images and masks made from them, for the canvas, the mesh and the tools. */
    static IMAGES = Object.freeze(["bufferRiverMap", "bufferWaterMask", "bufferRivers", "bufferSurfaceBiomes", "bufferUnderwaterBiomes", "bufferTerrainAux", "bufferContours", "bufferBiomeFallback"]);

    /** What is made on demand, or kept from the last generation, and emptied when the buffers are made afresh. */
    static ON_DEMAND = Object.freeze(["bufferScratch", "surfaceTexture", "surfaceTextureUnavailable", "generationInputs", "generationBase", "currentRiverData"]);

    /** Every field, under the name the studio has always given it. */
    static FIELDS = Object.freeze([...TerrainBuffers.DATA, ...TerrainBuffers.IMAGES, ...TerrainBuffers.ON_DEMAND]);

    constructor() {
        for (const field of TerrainBuffers.FIELDS) this[field] = null;
        this.surfaceTextureUnavailable = false;
    }

    /**
     * Makes every raster and image afresh for a map of the given size, and drops what was made on
     * demand or kept from an earlier generation (they belonged to the map before).
     * @param {number} width
     * @param {number} height
     */
    allocate(width, height) {
        const totalPixels = width * height;

        this.baseElevationData = new Float32Array(totalPixels);
        this.currentElevationData = new Float32Array(totalPixels);
        this.currentMoistureData = new Float32Array(totalPixels);
        this.currentTemperatureData = new Float32Array(totalPixels);
        this.currentBiomeOverrides = new Uint8Array(totalPixels);
        this.currentSpringOverrides = new Uint8Array(totalPixels);
        // How much of the surface texture the working terrain carries (see BrushLayerCache)
        this.currentRoughness = new Uint8Array(totalPixels);
        this.bufferRiverMap = new Uint8Array(totalPixels);
        this.bufferWaterMask = new Float32Array(totalPixels);
        // The river image the terrain shader draws rivers from (see RiverNetwork.rasterise)
        this.bufferRivers = new Uint8Array(totalPixels * 4);

        // The terrain's three images (see TerrainShading): the biomes on land and on the water's
        // surface, the biomes of the beds under water, and the packed relief, depth and height
        this.bufferSurfaceBiomes = new Uint8Array(totalPixels * 4);
        this.bufferUnderwaterBiomes = new Uint8Array(totalPixels * 4);
        this.bufferTerrainAux = new Uint8Array(totalPixels * 4);
        this.bufferContours = new Uint8Array(totalPixels * 4);
        // Kept in sync alongside the biome buffers on every biome repaint (see MapStudio's
        // _repaintCanvas/#applyBrushStroke), but its own canvas layer stays hidden until the
        // "Preview Rule Coverage" button is hovered - see ProceduralEngine.createBiomesMap's
        // outFallbackBuffer parameter for what actually gets written into it.
        this.bufferBiomeFallback = new Uint8Array(totalPixels * 4);

        // The rebuild scratch buffer and the surface texture are created on demand at the map's
        // current size (see ProceduralOrchestrator); drop any left over from a map of a different size.
        this.bufferScratch = null;
        this.surfaceTexture = null;
        this.surfaceTextureUnavailable = false;

        // Fresh buffers hold nothing from any earlier generation
        this.generationInputs = null;
        this.generationBase = null;
        this.currentRiverData = null;
    }

    /** The terrain images the painters fill, as the canvas's terrain shader takes them. */
    forCanvas() {
        return { surface: this.bufferSurfaceBiomes, underwater: this.bufferUnderwaterBiomes, aux: this.bufferTerrainAux, rivers: this.bufferRivers };
    }

    /**
     * Gives a class (the studio) every field's old name as an accessor onto its instances'
     * `terrain`, so reading or setting `app.bufferRivers` reads or sets `app.terrain.bufferRivers`.
     * @param {Function} owner - The class whose instances hold a TerrainBuffers as `terrain`.
     */
    static expose(owner) {
        for (const field of TerrainBuffers.FIELDS) {
            Object.defineProperty(owner.prototype, field, {
                configurable: true,
                get() {
                    return this.terrain[field];
                },
                set(value) {
                    this.terrain[field] = value;
                },
            });
        }
    }
}
