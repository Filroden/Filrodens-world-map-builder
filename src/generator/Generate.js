import { GenerationWorkers } from "../tools/GenerationWorkers.js";
import { payloadTransfer } from "./GeneratorInput.js";
import { runGenerator } from "./Pipeline.js";

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
 * @returns {Promise<object>} The run's result (see Pipeline.runGenerator).
 */
export function generateInBackground(makePayload, { onProgress = null, signal = null } = {}) {
    const payload = makePayload();
    return GenerationWorkers.runOne("generate", payload, {
        onProgress,
        signal,
        transfer: payloadTransfer(payload),
        alone: ({ onProgress: report, isCancelled }) => runGenerator(isDetached(payload) ? makePayload() : payload, { onProgress: report, isCancelled }),
    });
}

/** True once the payload's buffers have been transferred away (a detached buffer has no bytes). */
function isDetached(payload) {
    return payload.elevation.byteLength === 0;
}
