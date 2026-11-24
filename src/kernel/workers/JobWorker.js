/**
 * One module worker for whole jobs, shared by every studio (the kernel): a job of a second or more
 * runs in it with progress reports, and may be cancelled (rejected at once) or asked to stop early
 * with what it has. Jobs are told apart by id. The worker's module is the studio's own, its tasks
 * served by WorkerHost. The World studio's GenerationWorkers keeps one, apart from its band pool;
 * the Local studio keeps one for each version it builds at once.
 *
 * A job can only see a cancel or stop while it is paused (WorkerHost.pause): a worker handles one
 * message at a time. A job that cannot pause is ended by terminating its worker.
 */
export class JobWorker {
    #worker;
    #pending = new Map();
    #nextId = 1;
    #failure = null;

    /** @param {URL|string} url - The worker's module (a studio's own, served by WorkerHost). */
    constructor(url) {
        this.#worker = new Worker(url, { type: "module" });
        this.#worker.addEventListener("message", (event) => this.#onMessage(event.data));
        this.#worker.addEventListener("error", (event) => this.#fail(new Error(event.message || "A job worker could not start or crashed.")));
        this.#worker.addEventListener("messageerror", () => this.#fail(new Error("A job worker message could not be read.")));
    }

    get failed() {
        return this.#failure !== null;
    }

    /**
     * @param {string} task
     * @param {object} payload
     * @param {object} options
     * @param {function(object): void} [options.onProgress]
     * @param {AbortSignal} [options.signal]
     * @param {AbortSignal} [options.stopSignal] - Aborting asks the job to end early with what it
     *     has (a job that can, such as a generator run between its ages); it still resolves.
     * @param {Transferable[]} [options.transfer] - Buffers of the payload to move to the worker
     *     rather than copy (they are unusable here afterwards).
     * @returns {Promise<*>}
     */
    run(task, payload, { onProgress = null, signal = null, stopSignal = null, transfer = [] } = {}) {
        if (this.#failure) return Promise.reject(this.#failure);

        const id = this.#nextId++;
        return new Promise((resolve, reject) => {
            const job = { resolve, reject, onProgress, signal, onAbort: null };
            if (signal) {
                job.onAbort = () => this.#cancel(id);
                signal.addEventListener("abort", job.onAbort, { once: true });
            }
            this.#pending.set(id, job);
            this.#worker.postMessage({ id, task, payload }, transfer);
            const stop = () => this.#pending.has(id) && this.#worker.postMessage({ id, stop: true });
            if (stopSignal?.aborted) stop();
            else stopSignal?.addEventListener("abort", stop, { once: true });
        });
    }

    terminate() {
        this.#fail(new Error("A job worker was stopped."));
    }

    /**
     * Asks the worker to stop job `id` and rejects it at once: the worker's eventual reply (a
     * cancelled error, or the result if it was already on its way) is ignored.
     */
    #cancel(id) {
        const job = this.#pending.get(id);
        if (!job) return;
        this.#pending.delete(id);
        this.#worker.postMessage({ id, cancel: true });
        job.reject(abortError(job.signal));
    }

    #onMessage({ id, result, error, progress }) {
        const job = this.#pending.get(id);
        if (!job) return;

        if (progress) {
            job.onProgress?.(progress);
            return;
        }
        this.#pending.delete(id);
        job.signal?.removeEventListener("abort", job.onAbort);
        if (error) job.reject(new Error(error));
        else job.resolve(result);
    }

    #fail(error) {
        this.#failure = error;
        for (const job of this.#pending.values()) job.reject(error);
        this.#pending.clear();
        this.#worker.terminate();
    }
}

/** The error a cancelled job rejects with: the signal's own reason, or a standard AbortError. */
export function abortError(signal) {
    if (signal?.reason) return signal.reason;
    const error = new Error("The job was cancelled.");
    error.name = "AbortError";
    return error;
}
