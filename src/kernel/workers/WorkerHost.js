/**
 * The worker's side of the kernel's workers (WorkerPool, JobWorker): the message loop that runs a
 * studio's tasks, with progress, cancelling and stopping, and the pause that lets a long job read
 * the messages waiting. A studio's worker module imports it and serves its own tasks; nothing here
 * knows any studio.
 *
 * A message is `{ id, task, payload }`, or `{ id, cancel: true }` / `{ id, stop: true }` for job
 * `id`. A job may send `{ id, progress: { stage, pct, text } }` any number of times before its
 * reply. A job can only see a cancel or stop while it is paused (see pause), since a worker handles
 * one message at a time.
 */

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
export function pause() {
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

/**
 * Serves a worker module's tasks: each `{ id, task, payload }` message runs `tasks[task](payload,
 * job)`, which returns `{ value, transfer }`; the reply is `{ id, result }` with `transfer`'s
 * buffers moved, or `{ id, error, cancelled }`. `{ id, cancel: true }` and `{ id, stop: true }`
 * mark a job for its own checks (`job.isCancelled`, `job.isStopping`), seen while it pauses.
 * @param {Object<string, function(object, object): ({value: *, transfer?: Transferable[]}|Promise<{value: *, transfer?: Transferable[]}>)>} tasks
 */
export function serveTasks(tasks) {
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
            const run = tasks[task];
            if (!run) throw new Error(`unknown task "${task}"`);

            const { value, transfer = [] } = await run(payload, job);
            self.postMessage({ id, result: value }, transfer);
        } catch (error) {
            self.postMessage({ id, error: error?.message ?? String(error), cancelled: job.isCancelled() });
        } finally {
            cancelled.delete(id);
            stopping.delete(id);
        }
    });
}
