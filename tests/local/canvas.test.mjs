// The settlement map's canvas (SettlementCanvas) on a page without layout (happy-dom), its
// element's size and its resize stood in for: before it is shown it draws nothing and asks for no
// tiles, and the framing asked for waits until it has a size (measured as one pixel, it asked for
// tiles thousands of km a side, and the reopened map crashed the page); no tile is asked for at a
// level no sharper than the coarse picture; and its pictures are clipped to the frame (a tile at
// its edge runs past it).
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { Window } from "happy-dom";

const window = new Window({ url: "http://localhost/" });
const observers = [];
Object.assign(globalThis, {
    window,
    document: window.document,
    devicePixelRatio: 1,
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    ResizeObserver: class {
        constructor(callback) {
            this.callback = callback;
            observers.push(this);
        }
        observe() {}
        disconnect() {}
    },
});
after(() => window.happyDOM.close());
// A 2D context that draws nothing and records its rectangles, clips and pictures
const drawn = [];
window.HTMLCanvasElement.prototype.getContext = function () {
    return new Proxy({}, { get: (target, key) => (key in target ? target[key] : (...args) => ["rect", "clip", "drawImage", "restore"].includes(key) && drawn.push([key, ...args])), set: (target, key, value) => ((target[key] = value), true) });
};

const { FILRODENSWMB } = await import("../../src/config.js");
const { SettlementCanvas } = await import("../../src/studios/local/app/SettlementCanvas.js");

const FRAME = { width: 6000, height: 4500 };
const TOWN = [-600, -450, 600, 450];
const COARSE_M = Math.max(FRAME.width, FRAME.height) / FILRODENSWMB.LOCAL.CANVAS.COARSE_PX;

/** An element whose size the test sets. */
function host(width, height) {
    const element = window.document.createElement("div");
    window.document.body.append(element);
    const size = { width, height };
    Object.defineProperty(element, "clientWidth", { get: () => size.width });
    Object.defineProperty(element, "clientHeight", { get: () => size.height });
    return { element, size };
}

/** A canvas over a host, each view it asks for kept, every picture blank. */
function canvasOver(element) {
    const asked = [];
    const canvas = new SettlementCanvas(element, { frame: FRAME, draw: async (view) => (asked.push(view), {}) });
    return { canvas, asked };
}

const frames = (n = 4) => new Promise((resolve) => setTimeout(resolve, n * 5));

test("before it has a size it asks for no tiles, and shows the framing once it has one", async () => {
    const { element, size } = host(0, 0);
    const { canvas, asked } = canvasOver(element);
    try {
        canvas.show(TOWN, { home: true });
        await frames();
        assert.equal(asked.length, 0, "nothing drawn while hidden");
        // The frame shows it: the resize arrives
        size.width = 1200;
        size.height = 900;
        observers.at(-1).callback([]);
        await frames();
        assert.ok(Math.abs(canvas.view.mPerPx - 1) < 1e-9, `the town view fits: ${canvas.view.mPerPx} m a pixel`);
        assert.ok(asked.length > 0, "tiles asked for once shown");
        assert.ok(asked.every((view) => view.mPerPx < COARSE_M && view.rect[2] - view.rect[0] <= FRAME.width), `every tile within the frame's scale: ${JSON.stringify(asked.map((v) => v.mPerPx))}`);
    } finally {
        canvas.destroy();
    }
});

test("zoomed out past the coarse picture's detail, it asks for no tiles", async () => {
    const { element } = host(800, 600);
    const { canvas, asked } = canvasOver(element);
    try {
        canvas.show([-FRAME.width, -FRAME.height, FRAME.width, FRAME.height]);
        await frames();
        assert.ok(canvas.view.mPerPx > COARSE_M, "the view is coarser than the coarse picture");
        assert.equal(asked.length, 0);
        canvas.zoom(64);
        await frames();
        assert.ok(asked.length > 0 && asked.every((view) => view.mPerPx < COARSE_M), "zoomed in, sharper tiles");
    } finally {
        canvas.destroy();
    }
});

test("its pictures are clipped to the frame: a tile at its edge runs past it", async () => {
    const { element } = host(1200, 900);
    const { canvas, asked } = canvasOver(element);
    try {
        // The frame's bottom right corner, at a tile level
        canvas.show([2400, 1800, 3600, 2700]);
        await frames();
        assert.ok(asked.some((view) => view.rect[2] > FRAME.width / 2 || view.rect[3] > FRAME.height / 2), "a tile runs past the frame's edge");
        drawn.length = 0;
        canvas.zoom(1.0001);
        await frames();
        const { rect, mPerPx } = canvas.view;
        const clip = drawn.findIndex(([key]) => key === "clip");
        const frameRect = drawn[clip - 1];
        assert.equal(frameRect[0], "rect");
        // The frame's right and bottom edges, in canvas pixels
        assert.ok(Math.abs(frameRect[1] + frameRect[3] - (FRAME.width / 2 - rect[0]) / mPerPx) < 1e-6);
        assert.ok(Math.abs(frameRect[2] + frameRect[4] - (FRAME.height / 2 - rect[1]) / mPerPx) < 1e-6);
        const images = drawn.map(([key], i) => (key === "drawImage" ? i : -1)).filter((i) => i >= 0);
        const restore = drawn.findIndex(([key], i) => key === "restore" && i > clip);
        assert.ok(images.length > 0 && images.every((i) => i > clip && i < restore), "every picture drawn inside the clip");
    } finally {
        canvas.destroy();
    }
});

