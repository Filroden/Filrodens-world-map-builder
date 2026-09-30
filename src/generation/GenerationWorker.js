/**
 * Background worker for GenerationWorkers: runs one band of rows of a whole-map generation or
 * painting pass and sends the rows back.
 *
 * Each task builds its own ProceduralEngine from the map's seed. The passes run here draw on the
 * engine's noise only, never on its random number streams, so an engine made here gives exactly
 * the values the main thread's engine gives.
 *
 * A message is `{ id, task, payload }`; the reply is `{ id, result }` (its buffers transferred,
 * not copied) or `{ id, error }`.
 */
import { ProceduralEngine } from "./ProceduralEngine.js";
import { LayerPainting } from "../canvas/LayerPainting.js";

/** One band's rows, newly allocated: `width` values per row. */
const bandBuffer = (width, rowStart, rowEnd) => new Float32Array((rowEnd - rowStart) * width);

/**
 * The detail pass of guided and current tectonic terrain (see ProceduralEngine.generateDetailRows).
 * The job's coastline field holds only the rows this band can read (see
 * ProceduralEngine.detailJobForRows); a sample outside them would come back as NaN, so the band
 * is checked for it and refused rather than returned with holes.
 */
function detailRows({ seed, width, height, params, job, rowStart, rowEnd }) {
    const rows = new ProceduralEngine(seed).generateDetailRows(width, height, params, job, rowStart, rowEnd, bandBuffer(width, rowStart, rowEnd));
    if (rows.some(Number.isNaN)) throw new Error(`rows ${rowStart} to ${rowEnd} read outside the coastline field they were given`);
    return { value: rows, transfer: [rows.buffer] };
}

/** Standard base terrain (see ProceduralEngine.generateTopographyRows). */
function topographyRows({ seed, width, params, rowStart, rowEnd }) {
    const rows = new ProceduralEngine(seed).generateTopographyRows(width, params, bandBuffer(width, rowStart, rowEnd), rowStart, rowEnd);
    return { value: rows, transfer: [rows.buffer] };
}

/** The surface texture over the band's part of `bounds` (see ProceduralEngine.generateSurfaceTexture). */
function surfaceTextureRows({ seed, width, height, params, rowStart, rowEnd, minX, maxX }) {
    const rows = bandBuffer(width, rowStart, rowEnd);
    new ProceduralEngine(seed).generateSurfaceTexture(width, height, params, rows, { minX, maxX, minY: rowStart, maxY: rowEnd - 1 }, rowStart);
    return { value: rows, transfer: [rows.buffer] };
}

/** Moisture and temperature (see ProceduralEngine.generateClimateRows). */
function climateRows({ seed, width, height, params, elevationRows, rowStart, rowEnd, upwindMargin }) {
    const moisture = bandBuffer(width, rowStart, rowEnd);
    const temperature = bandBuffer(width, rowStart, rowEnd);
    new ProceduralEngine(seed).generateClimateRows(elevationRows, width, height, params, moisture, temperature, rowStart, rowEnd, upwindMargin);
    return { value: { moisture, temperature }, transfer: [moisture.buffer, temperature.buffer] };
}

/** One band of the map's pixel layers (see LayerPainting.paintBand). */
function paintRows(payload) {
    const layers = LayerPainting.paintBand(payload);
    return { value: layers, transfer: Object.values(layers).map((buffer) => buffer.buffer) };
}

const TASKS = { detailRows, topographyRows, surfaceTextureRows, climateRows, paintRows };

self.addEventListener("message", (event) => {
    const { id, task, payload } = event.data;
    try {
        const run = TASKS[task];
        if (!run) throw new Error(`unknown task "${task}"`);

        const { value, transfer } = run(payload);
        self.postMessage({ id, result: value }, transfer);
    } catch (error) {
        self.postMessage({ id, error: error?.message ?? String(error) });
    }
});
