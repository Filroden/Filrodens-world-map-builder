/**
 * Runs the map's refreshes (regenerating the terrain, the climate, the rivers and the canvas)
 * one at a time, combining requests that arrive while one is running.
 *
 * A refresh is asynchronous: it pauses so the processing overlay can be painted, then runs a long
 * synchronous stage, pauses again for the next stage, and so on. Started independently, a second
 * refresh begins at the first pause of the one already running. The two then take turns, each
 * repeating much of the other's work, and every refresh requested after them joins in. On a large
 * map, a user working quickly could build up minutes of refreshes this way, with a save or a close
 * queued behind all of them.
 *
 * Here, each kind of refresh can be waiting at most once. A request for a kind that is already
 * waiting is merged into it (its area added to the waiting one's, for example) and shares its
 * result, instead of adding another run. A request for a kind that is running is not merged into
 * that run, since the run may already have read the state the request is about; it waits to run
 * again afterwards. Waiting refreshes run in the order they were first requested, each reading the
 * map's state when it starts, so the result is the same as running every request in turn, without
 * the repeats.
 *
 * A refresh must never request a refresh of its own through the queue and wait for it: the
 * request would wait for the refresh that made it, which never finishes. A refresh that runs
 * another stage as part of its own work calls that stage directly.
 */
export class RefreshQueue {
    /** Refreshes waiting to run, oldest first: `{ kind, args, promise, resolve, reject }`. */
    #waiting = [];

    /** Whether a refresh is running (see #drain). */
    #running = false;

    #steps;
    #isStopped;

    /**
     * @param {Object<string, {run: Function, merge: Function}>} steps - For each kind of refresh:
     *   `run(args)` performs it and returns a promise; `merge(waitingArgs, newArgs)` returns the
     *   arguments of a waiting refresh with a new request of the same kind merged in.
     * @param {object} [options]
     * @param {Function} [options.isStopped] - Returns true once refreshes should no longer run (the
     *   window has closed). Refreshes still waiting then finish without running.
     */
    constructor(steps, { isStopped = () => false } = {}) {
        this.#steps = steps;
        this.#isStopped = isStopped;
    }

    /** Whether a refresh is running or waiting. */
    get busy() {
        return this.#running || this.#waiting.length > 0;
    }

    /**
     * Asks for a refresh.
     *
     * @param {string} kind - Which refresh, one of the kinds given to the constructor.
     * @param {object} [args] - What the refresh needs, merged with a waiting request of the same kind.
     * @returns {Promise<*>} Settles when the refresh that covers this request has run.
     */
    request(kind, args = {}) {
        const step = this.#steps[kind];
        if (!step) throw new Error(`FWMB | Unknown refresh "${kind}".`);

        const waiting = this.#waiting.find((entry) => entry.kind === kind);
        if (waiting) {
            waiting.args = step.merge(waiting.args, args);
            return waiting.promise;
        }

        const entry = { kind, args };
        entry.promise = new Promise((resolve, reject) => {
            entry.resolve = resolve;
            entry.reject = reject;
        });
        this.#waiting.push(entry);

        if (!this.#running) this.#drain();
        return entry.promise;
    }

    /**
     * Runs waiting refreshes until none are left. A refresh that fails rejects only the requests
     * it covered; the ones after it still run.
     */
    async #drain() {
        this.#running = true;
        try {
            while (this.#waiting.length > 0) {
                const entry = this.#waiting.shift();
                if (this.#isStopped()) {
                    entry.resolve(undefined);
                    continue;
                }

                try {
                    entry.resolve(await this.#steps[entry.kind].run(entry.args));
                } catch (error) {
                    entry.reject(error);
                }
            }
        } finally {
            this.#running = false;
        }
    }
}
