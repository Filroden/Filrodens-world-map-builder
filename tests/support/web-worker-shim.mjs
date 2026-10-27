// Gives Node a browser-style module Worker (new Worker(url, { type: "module" }) with
// addEventListener/postMessage/terminate, and `self` inside the worker), backed by
// worker_threads, so GenerationWorkers can be exercised outside Foundry. Import it before the
// engine. Node reports its core count through navigator.hardwareConcurrency already; set
// FWMB_CORES to pretend otherwise. The workers keep Node running, so a script using this ends
// with process.exit().
import { Worker as ThreadWorker } from "node:worker_threads";

const BOOTSTRAP = new URL("./web-worker-bootstrap.mjs", import.meta.url);

class ShimWorker {
    #thread;
    #listeners = { message: [], error: [], messageerror: [] };

    constructor(url) {
        this.#thread = new ThreadWorker(BOOTSTRAP, { workerData: { url: String(url) } });
        this.#thread.on("message", (data) => this.#listeners.message.forEach((listener) => listener({ data })));
        this.#thread.on("error", (error) => this.#listeners.error.forEach((listener) => listener({ message: error.message })));
    }

    addEventListener(type, listener) {
        this.#listeners[type]?.push(listener);
    }

    postMessage(message, transfer = []) {
        this.#thread.postMessage(message, transfer);
    }

    terminate() {
        this.#thread.terminate();
    }
}

globalThis.Worker = ShimWorker;
if (process.env.FWMB_CORES) Object.defineProperty(globalThis.navigator, "hardwareConcurrency", { value: Number(process.env.FWMB_CORES) });
