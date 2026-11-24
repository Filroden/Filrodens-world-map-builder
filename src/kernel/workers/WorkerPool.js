/**
 * A fixed set of module workers, each running one task at a time; tasks wait in order for the next
 * free worker. Shared by every studio (the kernel): a studio gives its own worker module, whose
 * tasks WorkerHost serves. The World studio's GenerationWorkers shares a whole-map pass between
 * them in bands.
 *
 * If a worker fails outside any task, every task waiting or under way fails, and so does every
 * later one, so the caller can fall back to the main thread once rather than fail each time.
 */
export class WorkerPool {
    #workers = [];
    #idle = [];
    #queue = [];
    #pending = new Map();
    #nextId = 1;
    #failure = null;

    /**
     * @param {URL|string} url - The worker's module (a studio's own, served by WorkerHost).
     * @param {number} size - How many workers.
     */
    constructor(url, size) {
        for (let i = 0; i < size; i++) {
            const worker = new Worker(url, { type: "module" });
            worker.addEventListener("message", (event) => this.#onMessage(worker, event.data));
            worker.addEventListener("error", (event) => this.#fail(new Error(event.message || "A background worker could not start or crashed.")));
            worker.addEventListener("messageerror", () => this.#fail(new Error("A background worker's message could not be read.")));
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
     * @param {string} task - The task's name (see the worker's module).
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
