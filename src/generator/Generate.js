import { GenerationWorkers } from "../tools/GenerationWorkers.js";
import { payloadTransfer } from "./GeneratorInput.js";
import { runGenerator } from "./Pipeline.js";
import { buildTravelGraph } from "../travel/TravelGraph.js";

/**
 * Runs the generator in the background worker (the `generate` task), or on the main thread where
 * workers are unavailable or the worker fails; both give the same result.
 *
 * The input is passed as a function that builds it, not as the input itself: its buffers are
 * transferred to the worker (not copied), which leaves them unusable here, so a fallback to the
 * main thread builds them again (or uses them as they are, when they were never sent).
 *
 * @param {function(): import("./GeneratorInput.js").GeneratorPayload} makePayload
 * @param {object} [options]
 * @param {function({stage: string, pct: number}): void} [options.onProgress]
 * @param {AbortSignal} [options.signal] - Aborting rejects at once with an AbortError.
 * @param {AbortSignal} [options.stopSignal] - Aborting ends the run after the age under way, with
 *     the ages finished (see Pipeline.runGenerator).
 * @returns {Promise<object>} The run's result (see Pipeline.runGenerator).
 */
export function generateInBackground(makePayload, { onProgress = null, signal = null, stopSignal = null } = {}) {
    const payload = makePayload();
    return GenerationWorkers.runOne("generate", payload, {
        onProgress,
        signal,
        stopSignal,
        transfer: payloadTransfer(payload),
        alone: ({ onProgress: report, isCancelled, isStopping }) => runGenerator(isDetached(payload) ? makePayload() : payload, { onProgress: report, isCancelled, isStopping }),
    });
}

/** True once the payload's buffers have been transferred away (a detached buffer has no bytes). */
function isDetached(payload) {
    return payload.elevation.byteLength === 0;
}

/**
 * Builds the generator's travel network for the Travel tool (see TravelGraph) in the background
 * worker, or on the main thread as generateInBackground does.
 * @param {function(): import("./GeneratorInput.js").GeneratorPayload} makePayload
 * @returns {Promise<object>}
 */
export function travelGraphInBackground(makePayload) {
    const payload = makePayload();
    return GenerationWorkers.runOne("travelGraph", payload, {
        transfer: payloadTransfer(payload),
        alone: () => buildTravelGraph(isDetached(payload) ? makePayload() : payload),
    });
}
