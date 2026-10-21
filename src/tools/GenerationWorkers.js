/**
 * Shares the heaviest whole-map generation passes between background workers, one band of rows
 * each, so a large map is generated on every core of the machine instead of one.
 *
 * Only passes where every pixel depends on nothing but its position and data prepared beforehand
 * are shared (see the tasks in GenerationWorker.js): the per-pixel pass of guided and current
 * tectonic terrain, standard terrain, the surface texture, the climate, and a whole-map repaint of
 * the pixel layers (see LayerPainting). Each band runs exactly
 * the code a whole-map pass runs, on its own rows, so the result is the same bit for bit however
 * the rows are divided, and whether or not workers are used at all.
 *
 * Workers are only a speed-up. Every caller also passes the ordinary single-threaded pass, which
 * runs instead when workers cannot be used: in an environment without them, on a machine with
 * too few cores to gain anything, for a pass too small to be worth the hand-over, or after a
 * worker has failed (then workers stay off for the rest of the session, with a console warning,
 * so a broken worker cannot slow every generation down by failing each time).
 *
 * The browser gives module workers no shared memory here (Foundry is not cross-origin isolated,
 * so SharedArrayBuffer is unavailable), so each band's inputs are copied to its worker and its
 * results transferred back. Callers keep those copies small by sending only what a band reads.
 */

/** At most this many workers, however many cores the machine has (beyond this, memory for the copied inputs outweighs the gain). */
const MAX_WORKERS = 8;

/** Cores left for the main thread and the browser. */
const RESERVED_CORES = 1;

/** Fewer workers than this gain too little over the main thread to be worth the hand-over. */
const MIN_WORKERS = 2;

/**
 * Bands per worker. Rows differ in cost (sea under a mid-ocean ridge costs more than plain
 * land), so a few bands each let a worker that finishes early take the next band instead of
 * waiting for the slowest.
 */
const BANDS_PER_WORKER = 3;

/** Passes over fewer pixels than this run on the main thread: handing them over would cost more than it saves. */
const MIN_SHARED_PIXELS = 500_000;

/** The worker's module, next to the engine it runs. */
const WORKER_URL = new URL("../generation/GenerationWorker.js", import.meta.url);

/**
 * A fixed set of module workers, each running one task at a time; tasks wait in order for the
 * next free worker.
 */
class WorkerPool {
    #workers = [];
    #idle = [];
    #queue = [];
    #pending = new Map();
    #nextId = 1;
    #failure = null;

    constructor(size) {
        for (let i = 0; i < size; i++) {
            const worker = new Worker(WORKER_URL, { type: "module" });
            worker.addEventListener("message", (event) => this.#onMessage(worker, event.data));
            worker.addEventListener("error", (event) => this.#fail(new Error(event.message || "A generation worker could not start or crashed.")));
            worker.addEventListener("messageerror", () => this.#fail(new Error("A generation worker's message could not be read.")));
            this.#workers.push(worker);
            this.#idle.push(worker);
        }
    }

    get size() {
        return this.#workers.length;
    }

    /**
     * Runs a task on the next free worker.
     *
     * @param {string} task - The task's name (see GenerationWorker.js).
     * @param {object} payload - The task's inputs (copied to the worker).
     * @returns {Promise<*>} The task's result.
     */
    run(task, payload) {
        if (this.#failure) return Promise.reject(this.#failure);

        return new Promise((resolve, reject) => {
            this.#queue.push({ id: this.#nextId++, task, payload, resolve, reject });
            this.#dispatch();
        });
    }

    #dispatch() {
        while (this.#idle.length > 0 && this.#queue.length > 0) {
            const worker = this.#idle.pop();
            const job = this.#queue.shift();
            this.#pending.set(job.id, { ...job, worker });
            try {
                worker.postMessage({ id: job.id, task: job.task, payload: job.payload });
            } catch (error) {
                // The payload could not be copied (it holds something a worker cannot receive)
                this.#pending.delete(job.id);
                this.#idle.push(worker);
                job.reject(error);
            }
        }
    }

    #onMessage(worker, { id, result, error }) {
        const job = this.#pending.get(id);
        if (!job) return;

        this.#pending.delete(id);
        this.#idle.push(worker);
        if (error) {
            job.reject(new Error(error));
        } else {
            job.resolve(result);
        }
        this.#dispatch();
    }

    /** A worker failed outside any task: every task waiting or under way fails, and so will every later one. */
    #fail(error) {
        this.#failure = error;
        for (const job of [...this.#pending.values(), ...this.#queue]) job.reject(error);
        this.#pending.clear();
        this.#queue = [];
        for (const worker of this.#workers) worker.terminate();
    }
}

/**
 * One module worker for whole jobs (see GenerationWorkers.runOne), kept apart from the band pool so
 * a job of a second or more never holds up the bands of a generation running meanwhile. Jobs are
 * told apart by id; each may report progress before its result, and may be cancelled.
 */
class JobWorker {
    #worker;
    #pending = new Map();
    #nextId = 1;
    #failure = null;

    constructor() {
        this.#worker = new Worker(WORKER_URL, { type: "module" });
        this.#worker.addEventListener("message", (event) => this.#onMessage(event.data));
        this.#worker.addEventListener("error", (event) => this.#fail(new Error(event.message || "The job worker could not start or crashed.")));
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
     * @param {Transferable[]} [options.transfer] - Buffers of the payload to move to the worker
     *     rather than copy (they are unusable here afterwards).
     * @returns {Promise<*>}
     */
    run(task, payload, { onProgress = null, signal = null, transfer = [] } = {}) {
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
        });
    }

    terminate() {
        this.#fail(new Error("The job worker was stopped."));
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
function abortError(signal) {
    if (signal?.reason) return signal.reason;
    const error = new Error("The job was cancelled.");
    error.name = "AbortError";
    return error;
}

export class GenerationWorkers {
    static #pool = null;
    static #disabled = false;
    static #jobWorker = null;
    static #jobsDisabled = false;

    /**
     * How many workers this machine gets: one per core, less one for the main thread, capped.
     * Zero where workers are unavailable.
     */
    static #workerCount() {
        if (typeof Worker === "undefined") return 0;

        const cores = globalThis.navigator?.hardwareConcurrency ?? 0;
        const count = Math.min(MAX_WORKERS, cores - RESERVED_CORES);
        return count >= MIN_WORKERS ? count : 0;
    }

    /**
     * Whether a pass over `pixels` pixels will be shared between workers.
     *
     * @param {number} pixels
     * @returns {boolean}
     */
    static willShare(pixels) {
        return !this.#disabled && pixels >= MIN_SHARED_PIXELS && this.#workerCount() > 0;
    }

    /**
     * Runs a pass, shared between workers where that is worthwhile and possible, and otherwise
     * (or if the shared run fails) on the main thread. Both must produce the same result.
     *
     * @param {object} pass
     * @param {number} pass.pixels - How many pixels the pass covers.
     * @param {function(): Promise<void>} pass.shared - Runs the pass in workers (see runBands).
     * @param {function(): void} pass.alone - Runs the pass on the main thread.
     * @returns {Promise<void>}
     */
    static async run({ pixels, shared, alone }) {
        if (!this.willShare(pixels)) {
            alone();
            return;
        }

        try {
            await shared();
        } catch (error) {
            this.#disable(error);
            alone();
        }
    }

    /**
     * Divides rows 0 to `height` (exclusive) into bands, runs `task` on each in a worker, and
     * hands each band's result to `receive` as it arrives. Bands are disjoint, so the order in
     * which they arrive cannot change the outcome.
     *
     * @param {string} task - The task's name (see GenerationWorker.js).
     * @param {number} height - Number of rows.
     * @param {function(number, number): object} payloadFor - The task's inputs for rows rowStart
     *   to rowEnd (exclusive).
     * @param {function(number, number, *): void} receive - Takes a band's rows and its result.
     * @returns {Promise<void>}
     */
    static async runBands(task, height, payloadFor, receive) {
        const pool = this.#ensurePool();
        const bandCount = Math.min(height, pool.size * BANDS_PER_WORKER);

        const bands = [];
        for (let band = 0; band < bandCount; band++) {
            const rowStart = Math.floor((band * height) / bandCount);
            const rowEnd = Math.floor(((band + 1) * height) / bandCount);
            if (rowEnd > rowStart) bands.push({ rowStart, rowEnd });
        }

        await Promise.all(bands.map(({ rowStart, rowEnd }) => pool.run(task, payloadFor(rowStart, rowEnd)).then((result) => receive(rowStart, rowEnd, result))));
    }

    /**
     * Runs one whole job (not divided into bands) in a background worker, reporting its progress
     * and letting it be cancelled. Where workers cannot be used, or after the job worker has failed
     * once (workers then stay off for jobs for the rest of the session, with a console warning),
     * `alone` runs the same job on the main thread instead; both must give the same result.
     *
     * A cancelled job rejects at once with the signal's reason (an AbortError by default),
     * whichever way it runs. An error thrown by the task itself is not a worker failure: it rejects
     * as it would on the main thread.
     *
     * @param {string} task - The task's name (see GenerationWorker.js).
     * @param {object} payload - The task's inputs (copied to the worker).
     * @param {object} [options]
     * @param {function({stage: string, pct: number, text?: string}): void} [options.onProgress]
     * @param {AbortSignal} [options.signal]
     * @param {function({onProgress: Function, isCancelled: function(): boolean}): Promise<*>} [options.alone]
     * @param {Transferable[]} [options.transfer] - Buffers of the payload to move to the worker
     *     rather than copy. The payload is unusable afterwards, so `alone` must not rely on it: a
     *     job that transfers builds its own inputs again if it falls back to the main thread.
     * @returns {Promise<*>} The task's result.
     */
    static async runOne(task, payload, { onProgress = null, signal = null, alone = null, transfer = [] } = {}) {
        if (signal?.aborted) throw abortError(signal);
        const worker = this.#ensureJobWorker();
        if (!worker) return this.#runAlone(alone, { onProgress, signal });

        try {
            return await worker.run(task, payload, { onProgress, signal, transfer });
        } catch (error) {
            if (signal?.aborted || !worker.failed) throw error;
            this.#disableJobs(error);
            return this.#runAlone(alone, { onProgress, signal });
        }
    }

    /** Stops the job worker (jobs then start a new one when next asked for). */
    static terminateJobs() {
        this.#jobWorker?.terminate();
        this.#jobWorker = null;
    }

    static async #runAlone(alone, { onProgress, signal }) {
        if (!alone) throw new Error("No worker is available and the job has no main-thread fallback.");
        const result = await alone({ onProgress, isCancelled: () => !!signal?.aborted });
        if (signal?.aborted) throw abortError(signal);
        return result;
    }

    static #ensureJobWorker() {
        if (this.#jobsDisabled || typeof Worker === "undefined") return null;
        if (this.#jobWorker?.failed) this.#jobWorker = null;
        try {
            this.#jobWorker ??= new JobWorker();
        } catch (error) {
            this.#disableJobs(error);
            return null;
        }
        return this.#jobWorker;
    }

    static #disableJobs(error) {
        this.#jobsDisabled = true;
        console.warn(`FWMB | Background jobs are unavailable (${error.message}), so they will run on the main thread, which pauses the window while they do.`);
    }

    static #ensurePool() {
        this.#pool ??= new WorkerPool(this.#workerCount());
        return this.#pool;
    }

    /** Stops using workers for the rest of the session, after one failed. */
    static #disable(error) {
        this.#disabled = true;
        console.warn(`FWMB | Background generation is unavailable (${error.message}), so maps will generate on the main thread only, which is slower on large maps.`);
    }
}
