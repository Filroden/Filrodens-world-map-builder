/**
 * The main thread's side of the Local studio's workers: a settlement's versions built side by side
 * in background workers (the kernel's JobWorker running LocalWorker.js), each worker keeping the
 * versions it built so their tiles can be drawn there as the canvas pans and zooms.
 *
 * - **How many:** one a core less one, between VERSION_WORKERS.MIN and MAX (FILRODENSWMB.LOCAL), so a
 *   core is always left for the window; versions are given to the least busy worker in the order
 *   asked for, so the Default, asked for first, starts first.
 * - **Kept:** the version the user keeps has its households worked out in its worker and its town
 *   and households copied back once (keep); the others never come to the main thread.
 * - **Cancelled:** a build cannot pause, so a version cancelled while building ends its worker if
 *   nothing else on that worker is still wanted, and is otherwise dropped when it finishes; a new
 *   worker starts when next needed.
 * - **Without workers** (none in this environment, or after one failed), the same tasks run on the
 *   main thread (LocalTasks); **without an OffscreenCanvas** in the workers, the versions come back
 *   as plain towns and are drawn on the main thread.
 */
import { FILRODENSWMB } from "../../config.js";
import { JobWorker } from "../../kernel/workers/JobWorker.js";
import { TASKS, drawView } from "./LocalTasks.js";

/** The worker's module. */
const WORKER_URL = new URL("./LocalWorker.js", import.meta.url);

/** A canvas on the main thread: off screen where it can be, else an element. */
function mainCanvas(width, height) {
    if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
    const canvas = globalThis.document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
}

/** What a picture drawn on the main thread is sent as: an ImageBitmap where it can be. */
function pictureOf(canvas) {
    return typeof canvas.transferToImageBitmap === "function" ? canvas.transferToImageBitmap() : canvas;
}

export class LocalWorkers {
    /**
     * How many workers build versions on a machine with `cores` cores.
     * @param {number} [cores]
     */
    static count(cores = globalThis.navigator?.hardwareConcurrency ?? 1) {
        const { MIN, MAX, RESERVED_CORES } = FILRODENSWMB.LOCAL.VERSION_WORKERS;
        return Math.max(MIN, Math.min(MAX, cores - RESERVED_CORES));
    }

    #url;
    #slots;
    #useWorkers;
    /** Each version's slot, by id. */
    #where = new Map();
    /** Versions cancelled while building, dropped when their build ends. */
    #cancelled = new Set();
    /** The kept versions' plain copies, by id (drawn here when the workers cannot draw). */
    #kept = new Map();

    /**
     * @param {object} [options]
     * @param {URL|string} [options.url] - The worker's module.
     * @param {number} [options.size] - How many workers.
     * @param {boolean} [options.workers] - Whether to use workers at all.
     */
    constructor({ url = WORKER_URL, size = LocalWorkers.count(), workers = typeof Worker !== "undefined" } = {}) {
        this.#url = url;
        this.#useWorkers = workers;
        this.#slots = Array.from({ length: Math.max(1, size) }, () => ({ worker: null, ready: null, canDraw: null, ids: new Set(), busy: 0 }));
    }

    /** How many workers there are. */
    get size() {
        return this.#slots.length;
    }

    /**
     * Builds a version. Resolves with its framings, figures and timings, and its thumbnail (an
     * ImageBitmap, or a canvas where none can be made) when a size is asked for.
     * @param {string} id - The version's id, unique among those held.
     * @param {object} input - The engine's input (with the version's seed).
     * @param {object} [options]
     * @param {{widthPx: number, heightPx: number, style?: object}} [options.thumbnail]
     */
    async build(id, input, { thumbnail = null } = {}) {
        const slot = this.#slots.reduce((best, s) => (s.busy < best.busy ? s : best));
        this.#where.set(id, slot);
        slot.ids.add(id);
        slot.busy++;
        let result;
        try {
            result = await this.#run(slot, "build", { id, input, thumbnail });
        } finally {
            slot.busy--;
        }
        if (this.#cancelled.has(id)) {
            this.#cancelled.delete(id);
            await this.release([id]);
            const error = new Error(`version ${id} was cancelled`);
            error.name = "AbortError";
            throw error;
        }
        // A worker with no OffscreenCanvas sends the plain town: its thumbnail is drawn here
        if (thumbnail && !result.thumbnail && result.town) {
            const view = result.townView;
            const mPerPx = Math.max(view.width / thumbnail.widthPx, view.height / thumbnail.heightPx);
            const cx = (view.rect[0] + view.rect[2]) / 2;
            const cy = (view.rect[1] + view.rect[3]) / 2;
            const rect = [cx - (thumbnail.widthPx * mPerPx) / 2, cy - (thumbnail.heightPx * mPerPx) / 2, cx + (thumbnail.widthPx * mPerPx) / 2, cy + (thumbnail.heightPx * mPerPx) / 2];
            result.thumbnail = pictureOf(drawView(result.town, { rect, mPerPx, widthPx: thumbnail.widthPx, heightPx: thumbnail.heightPx }, { style: thumbnail.style, makeCanvas: mainCanvas }));
            delete result.town;
        }
        return result;
    }

    /** The version kept: its households worked out, and its town and households, plain. */
    async keep(id) {
        const result = await this.#run(this.#slotOf(id), "keep", { id });
        this.#kept.set(id, result.town);
        return result;
    }

    /**
     * A rectangle of a version drawn at a resolution: an ImageBitmap (or a canvas).
     * @param {string} id
     * @param {{rect: number[], mPerPx: number, widthPx: number, heightPx: number}} view
     * @param {object} [options] - style, cultures, theme, layers (see LocalTasks.drawView).
     */
    async tile(id, view, options = {}) {
        const slot = this.#slotOf(id);
        if (slot.canDraw === false) {
            const town = this.#kept.get(id);
            if (!town) throw new Error(`version ${id} can only be drawn here once it is kept`);
            return pictureOf(drawView(town, view, { ...options, makeCanvas: mainCanvas }));
        }
        return (await this.#run(slot, "tile", { id, view, ...options })).bitmap;
    }

    /**
     * Cancels a version still building: its worker is ended if nothing else on it is wanted, and the
     * version is otherwise dropped when its build ends. Its build() rejects with an AbortError.
     */
    cancel(id) {
        const slot = this.#where.get(id);
        if (!slot) return;
        this.#cancelled.add(id);
        const wanted = [...slot.ids].filter((other) => !this.#cancelled.has(other));
        if (!wanted.length && slot.worker) {
            slot.worker.terminate();
            slot.worker = null;
            slot.ready = null;
            slot.canDraw = null;
            for (const other of slot.ids) this.#where.delete(other);
            slot.ids.clear();
        }
    }

    /** Versions dropped from their workers. */
    async release(ids) {
        const bySlot = new Map();
        for (const id of ids) {
            const slot = this.#where.get(id);
            this.#where.delete(id);
            this.#kept.delete(id);
            if (!slot) continue;
            slot.ids.delete(id);
            if (!bySlot.has(slot)) bySlot.set(slot, []);
            bySlot.get(slot).push(id);
        }
        await Promise.all([...bySlot].map(([slot, list]) => (slot.worker || !this.#useWorkers ? this.#run(slot, "release", { ids: list }) : null)));
    }

    /** Every worker ended and every version dropped. */
    close() {
        for (const slot of this.#slots) {
            slot.worker?.terminate();
            slot.worker = null;
            slot.ids.clear();
        }
        if (!this.#useWorkers) TASKS.release({ ids: [...this.#where.keys()] });
        this.#where.clear();
        this.#kept.clear();
        this.#cancelled.clear();
    }

    #slotOf(id) {
        const slot = this.#where.get(id);
        if (!slot) throw new Error(`no version ${id} is held`);
        return slot;
    }

    /**
     * Runs a task on a slot's worker (started if need be), or on this thread. Tasks reach a worker
     * in the order they were asked for, so the Default, asked for first, is built first.
     */
    async #run(slot, task, payload) {
        if (this.#useWorkers && !slot.worker) {
            try {
                slot.worker = new JobWorker(this.#url);
                slot.ready = slot.worker.run("hello", {}).then(({ canDraw }) => {
                    slot.canDraw = canDraw;
                });
            } catch (error) {
                this.#noWorkers(slot, error);
            }
        }
        if (slot.worker) {
            const worker = slot.worker;
            try {
                await slot.ready;
            } catch (error) {
                if (slot.worker === worker) this.#noWorkers(slot, error);
            }
        }
        if (!slot.worker) {
            slot.canDraw ??= typeof OffscreenCanvas !== "undefined";
            return TASKS[task](payload).value;
        }
        return slot.worker.run(task, payload);
    }

    /** Workers are off for the rest of the session, after one could not start. */
    #noWorkers(slot, error) {
        this.#useWorkers = false;
        slot.worker = null;
        slot.ready = null;
        console.warn(`FWMB | Settlement maps cannot use background workers (${error.message}), so they are built on the main thread, which pauses the window while they are.`);
    }
}
