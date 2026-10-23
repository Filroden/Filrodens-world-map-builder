/**
 * Background worker for GenerationWorkers: runs one band of rows of a whole-map generation or
 * painting pass and sends the rows back, or one whole job (such as building a map's mesh) with
 * progress reports along the way.
 *
 * Each band task builds its own ProceduralEngine from the map's seed. The passes run here draw on
 * the engine's noise only, never on its random number streams, so an engine made here gives
 * exactly the values the main thread's engine gives.
 *
 * A message is `{ id, task, payload }`, or `{ id, cancel: true }` to stop job `id`. The reply is
 * `{ id, result }` (its buffers transferred, not copied) or `{ id, error, cancelled }`; a job may
 * send `{ id, progress: { stage, pct, text } }` any number of times before it. A job can only see
 * a cancel message while it is paused (see pause), since a worker handles one message at a time:
 * the long jobs pause between steps for exactly that reason.
 */
import { ProceduralEngine } from "./ProceduralEngine.js";
import { LayerPainting } from "../canvas/LayerPainting.js";
import { buildMeshData } from "../mesh/MeshBuilder.js";
import { runGenerator } from "../generator/Pipeline.js";
import { resultTransfer } from "../generator/GeneratorInput.js";
import { buildTravelGraph, travelGraphTransfer } from "../travel/TravelGraph.js";

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

/**
 * A map's mesh: sites, triangulation and cell raster (see MeshBuilder.buildMeshData), with
 * progress reports and the chance to cancel between steps.
 */
async function buildMesh(params, job) {
    const data = await buildMeshData(params, { onProgress: job.progress, isCancelled: job.isCancelled, pause });
    const transfer = [data.sites.buffer, data.triangles.buffer, data.halfedges.buffer, data.hull.buffer, data.cellRaster.buffer];
    // A typed array can share its buffer with another (Delaunator trims its arrays as views of
    // larger ones), and a buffer may only be listed once
    return { value: data, transfer: [...new Set(transfer)] };
}

/**
 * A generator run (settlements, routes and realms; see src/generator/Pipeline.js), with progress
 * reports and the chance to cancel between and within its stages.
 */
async function generate(payload, job) {
    const result = await runGenerator(payload, { onProgress: job.progress, isCancelled: job.isCancelled, isStopping: job.isStopping, pause });
    return { value: result, transfer: resultTransfer(result) };
}

/** The generator's travel network for the Travel tool (see TravelGraph). */
function travelGraph(payload) {
    const graph = buildTravelGraph(payload);
    return { value: graph, transfer: travelGraphTransfer(graph) };
}

const TASKS = { detailRows, topographyRows, surfaceTextureRows, climateRows, paintRows, buildMesh, generate, travelGraph };

/** Ids of jobs asked to stop (cancelled), and of jobs asked to end early with what they have. */
const cancelled = new Set();
const stopping = new Set();

/**
 * Lets the worker handle waiting messages (a cancel, above all) before continuing. A message
 * channel resolves on the next turn without the minimum delay timers have in browsers; but its
 * own messages can be run ahead of the job messages waiting (a cancel or stop would then only be
 * read once the run had ended), so at least every TIMER_YIELD_MS the pause is a timer, after
 * which the waiting messages are always read.
 */
const channel = typeof MessageChannel === "undefined" ? null : new MessageChannel();
const TIMER_YIELD_MS = 100;
let lastTimerYield = performance.now();
/** Jobs waiting to continue, in the order they paused (two jobs may run interleaved). */
const waiting = [];
if (channel) channel.port1.onmessage = () => waiting.shift()?.();
function pause() {
    if (!channel || performance.now() - lastTimerYield >= TIMER_YIELD_MS) {
        return new Promise((resolve) => setTimeout(() => {
            lastTimerYield = performance.now();
            resolve();
        }, 0));
    }
    return new Promise((resolve) => {
        waiting.push(resolve);
        channel.port2.postMessage(0);
    });
}

self.addEventListener("message", async (event) => {
    const { id, task, payload, cancel, stop } = event.data;
    if (cancel) {
        cancelled.add(id);
        return;
    }
    if (stop) {
        stopping.add(id);
        return;
    }

    const job = {
        progress: (progress) => self.postMessage({ id, progress }),
        isCancelled: () => cancelled.has(id),
        isStopping: () => stopping.has(id),
    };
    try {
        const run = TASKS[task];
        if (!run) throw new Error(`unknown task "${task}"`);

        const { value, transfer } = await run(payload, job);
        self.postMessage({ id, result: value }, transfer);
    } catch (error) {
        self.postMessage({ id, error: error?.message ?? String(error), cancelled: job.isCancelled() });
    } finally {
        cancelled.delete(id);
        stopping.delete(id);
    }
});
