import { ProceduralEngine, PAINT_HALO_ROWS } from "../generation/ProceduralEngine.js";
import { GenerationWorkers } from "../tools/GenerationWorkers.js";

/** The layer buffers the painters fill, by the names the painters' outputs are sent back under. */
const LAYERS = ["terrainAux", "surfaceBiomes", "biomeFallback", "underwaterBiomes", "contours"];

/**
 * Paints the map's pixel layers (the terrain's packed relief, depth and height, the biomes and
 * their rule-coverage preview, the underwater biomes, and the contour lines) into their buffers,
 * sharing a whole-map repaint between background workers where that is worthwhile (see
 * GenerationWorkers).
 *
 * A whole-map repaint (on every load and generation, and whenever the map's highest or lowest
 * point moves) runs the three painters over millions of pixels, over a second on a large map. Each
 * painter's pixel depends only on the inputs at that pixel and the rows directly above and below
 * it, so the map can be painted in bands of rows, each with a thin halo (PAINT_HALO_ROWS), and
 * comes out exactly as painting it whole.
 *
 * An area repaint (a brush stroke, an undo, the live brush on every pointer move) is small and is
 * always painted on the main thread, straight away.
 *
 * Because a shared repaint finishes later, two things can happen while it runs, and both are
 * handled here:
 * - An area is repainted on the main thread (the live brush paints on). The shared repaint read
 *   its inputs before that change, so once its bands are in, every area repainted meanwhile is
 *   painted again on top, and the newer paint is never lost.
 * - Another whole-map repaint starts. The newer one paints everything, so the older one's bands
 *   are dropped as they arrive, and it reports that it is no longer current.
 */
export class LayerPainting {
    // Counts whole-map repaints; a shared repaint whose number is no longer the latest is stale
    #wholeMapRepaints = 0;

    // The shared repaint under way: its number and the area repainted on the main thread since it
    // started (null for none), or null when none is under way
    #shared = null;

    /**
     * Paints the layers over `bounds`, or the whole map when bounds is null.
     *
     * @param {object} target - What to paint and with what (see #paintAlone for the fields).
     * @param {object|null} bounds - Area to repaint, or null for the whole map.
     * @returns {Promise<{current: boolean, shared: boolean, timings: object|null}>} Whether the
     *   buffers now hold this repaint (false if a newer whole-map repaint took over while it ran),
     *   whether it was shared between workers, and, for a repaint on the main thread, how long
     *   each painter took (`terrain`, `biomes`, `contours`, in milliseconds).
     */
    async paint(target, bounds) {
        if (bounds) {
            const timings = LayerPainting.#paintAlone(target, bounds);
            this.#noteAreaRepaint(bounds);
            return { current: true, shared: false, timings };
        }

        const number = ++this.#wholeMapRepaints;
        if (!GenerationWorkers.willShare(target.width * target.height)) {
            // Supersedes any shared repaint still under way
            this.#shared = null;
            return { current: true, shared: false, timings: LayerPainting.#paintAlone(target, null) };
        }

        this.#shared = { number, repainted: null };
        await GenerationWorkers.run({
            pixels: target.width * target.height,
            shared: () => this.#paintShared(target, number),
            alone: () => {
                if (this.#isLatest(number)) LayerPainting.#paintAlone(target, null);
            },
        });

        if (!this.#isLatest(number)) return { current: false, shared: true, timings: null };

        const repainted = this.#shared?.repainted;
        this.#shared = null;
        if (repainted) LayerPainting.#paintAlone(target, repainted);
        return { current: true, shared: true, timings: null };
    }

    #isLatest(number) {
        return number === this.#wholeMapRepaints;
    }

    /** Records an area painted on the main thread while a shared repaint is under way (see the class description). */
    #noteAreaRepaint(bounds) {
        if (!this.#shared) return;

        const earlier = this.#shared.repainted;
        this.#shared.repainted = earlier
            ? { minX: Math.min(earlier.minX, bounds.minX), maxX: Math.max(earlier.maxX, bounds.maxX), minY: Math.min(earlier.minY, bounds.minY), maxY: Math.max(earlier.maxY, bounds.maxY) }
            : { ...bounds };
    }

    /**
     * Paints the whole map in bands in workers (see the "paintRows" task in GenerationWorker.js).
     * Each band is sent its rows of every input plus PAINT_HALO_ROWS either side, and sends back
     * just its own rows of each layer, which are copied in unless a newer whole-map repaint has
     * started meanwhile.
     */
    #paintShared(target, number) {
        const { width, height, inputs, outputs } = target;
        const hasBiomes = LayerPainting.#hasBiomes(target);
        const rowsOf = (buffer, start, end) => buffer?.slice(start * width, end * width) ?? null;

        return GenerationWorkers.runBands(
            "paintRows",
            height,
            (rowStart, rowEnd) => {
                const haloStart = Math.max(0, rowStart - PAINT_HALO_ROWS);
                const haloEnd = Math.min(height, rowEnd + PAINT_HALO_ROWS);
                return {
                    ...target.settings,
                    seed: target.seed,
                    width,
                    height,
                    rowStart,
                    rowEnd,
                    haloStart,
                    hasBiomes,
                    elevation: rowsOf(inputs.elevation, haloStart, haloEnd),
                    waterMask: rowsOf(inputs.waterMask, haloStart, haloEnd),
                    moisture: hasBiomes ? rowsOf(inputs.moisture, haloStart, haloEnd) : null,
                    temperature: hasBiomes ? rowsOf(inputs.temperature, haloStart, haloEnd) : null,
                    overrides: rowsOf(inputs.overrides, haloStart, haloEnd),
                };
            },
            (rowStart, rowEnd, layers) => {
                if (!this.#isLatest(number)) return;
                for (const name of LAYERS) {
                    if (layers[name] && outputs[name]) outputs[name].set(layers[name], rowStart * width * 4);
                }
            },
        );
    }

    /** Whether there is a climate to paint biomes from (not before the first climate pass). */
    static #hasBiomes(target) {
        return Boolean(target.inputs.moisture && target.inputs.temperature);
    }

    /**
     * Runs the three painters over `bounds` (or the whole map) on the main thread.
     *
     * `target` holds: `engine` (a ProceduralEngine for the map's seed) and `seed`; `width` and
     * `height`; `settings` (`params`, `seaLevel`, `contourInterval`, `maxPeak`, `minTrough`);
     * `inputs` (`elevation`, `waterMask`, `moisture`, `temperature`, `overrides`) and `outputs`
     * (`terrainAux`, `surfaceBiomes`, `biomeFallback`, `underwaterBiomes`, `contours`), all whole
     * map buffers.
     *
     * @returns {{terrain: number, biomes: number, contours: number}} Milliseconds per painter.
     */
    static #paintAlone(target, bounds) {
        const { engine, width, height, settings, inputs, outputs } = target;
        const { params, seaLevel, contourInterval, maxPeak, minTrough } = settings;

        let mark = performance.now();
        const lap = () => {
            const now = performance.now();
            const elapsed = now - mark;
            mark = now;
            return elapsed;
        };

        engine.paintTerrainAux(inputs.elevation, width, height, seaLevel, inputs.waterMask, params, outputs.terrainAux, bounds, maxPeak, minTrough);
        const terrain = lap();

        if (LayerPainting.#hasBiomes(target)) {
            engine.createBiomesMap(inputs.elevation, inputs.moisture, inputs.temperature, inputs.overrides, width, height, seaLevel, inputs.waterMask, params, outputs.surfaceBiomes, bounds, outputs.biomeFallback, outputs.underwaterBiomes);
        }
        const biomes = lap();

        engine.createContourMap(inputs.elevation, width, height, contourInterval, seaLevel, outputs.contours, bounds);
        return { terrain, biomes, contours: lap() };
    }

    /**
     * Paints one band of rows, as a worker does (see the "paintRows" task in GenerationWorker.js):
     * `band` holds the band's inputs from row `haloStart` on, and the layers come back holding
     * rows `rowStart` to `rowEnd` (exclusive) only. The layers are painted in buffers covering
     * the halo rows too, since the painters write a margin around the rows asked for.
     *
     * @param {object} band - The worker task's payload.
     * @returns {object} The band's rows of each layer painted, by name (see LAYERS).
     */
    static paintBand(band) {
        const { seed, width, height, rowStart, rowEnd, haloStart, hasBiomes, params, seaLevel, contourInterval, maxPeak, minTrough } = band;
        const engine = new ProceduralEngine(seed);
        const rows = band.elevation.length / width;
        const layer = () => new Uint8Array(rows * width * 4);
        const painted = { terrainAux: layer(), contours: layer() };
        const bounds = { minX: 0, maxX: width - 1, minY: rowStart, maxY: rowEnd - 1 };

        engine.paintTerrainAux(band.elevation, width, height, seaLevel, band.waterMask, params, painted.terrainAux, bounds, maxPeak, minTrough, haloStart);
        if (hasBiomes) {
            Object.assign(painted, { surfaceBiomes: layer(), biomeFallback: layer(), underwaterBiomes: layer() });
            engine.createBiomesMap(band.elevation, band.moisture, band.temperature, band.overrides, width, height, seaLevel, band.waterMask, params, painted.surfaceBiomes, bounds, painted.biomeFallback, painted.underwaterBiomes, haloStart);
        }
        engine.createContourMap(band.elevation, width, height, contourInterval, seaLevel, painted.contours, bounds, haloStart);

        const from = (rowStart - haloStart) * width * 4;
        const to = (rowEnd - haloStart) * width * 4;
        return Object.fromEntries(Object.entries(painted).map(([name, buffer]) => [name, buffer.slice(from, to)]));
    }
}
