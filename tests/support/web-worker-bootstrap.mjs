// Worker side of web-worker-shim.mjs: provides a browser-style \`self\`, then loads the real worker.
import { parentPort, workerData } from "node:worker_threads";

const listeners = [];
globalThis.self = {
    postMessage: (message, transfer) => parentPort.postMessage(message, transfer),
    addEventListener: (type, listener) => {
        if (type === "message") listeners.push(listener);
    },
};
parentPort.on("message", (data) => {
    for (const listener of listeners) listener({ data });
});
await import(workerData.url);
