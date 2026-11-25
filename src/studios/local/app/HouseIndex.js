/**
 * The homes of a settlement map found by a point (step 3): pointing at a house reads its household.
 * Built once from the homes' footprints the worker sends back (LocalTasks.footprintsOf: every point
 * in one array, in metres from the frame's centre, and where each home's points start), as a grid
 * of cells HOUSEHOLDS.INDEX_CELL_M a side, each listing the homes whose bounds reach it; a point is
 * then tested against the few footprints of its cell.
 */
import { FILRODENSWMB } from "../../../config.js";

export class HouseIndex {
    #points;
    #offsets;
    #cell;
    #x0;
    #y0;
    #cols;
    #rows;
    /** Each grid cell's homes (an array of home numbers, or undefined). */
    #grid;

    /**
     * @param {{points: Float32Array, offsets: Uint32Array}} homes
     * @param {object} [options]
     * @param {number} [options.cell] - The grid's cell, in metres.
     */
    constructor({ points, offsets }, { cell = FILRODENSWMB.LOCAL.HOUSEHOLDS.INDEX_CELL_M } = {}) {
        this.#points = points;
        this.#offsets = offsets;
        this.#cell = cell;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (let i = 0; i < points.length; i += 2) {
            if (points[i] < x0) x0 = points[i];
            if (points[i] > x1) x1 = points[i];
            if (points[i + 1] < y0) y0 = points[i + 1];
            if (points[i + 1] > y1) y1 = points[i + 1];
        }
        if (!Number.isFinite(x0)) x0 = y0 = x1 = y1 = 0;
        this.#x0 = x0;
        this.#y0 = y0;
        this.#cols = Math.max(1, Math.ceil((x1 - x0) / cell) + 1);
        this.#rows = Math.max(1, Math.ceil((y1 - y0) / cell) + 1);
        this.#grid = new Array(this.#cols * this.#rows);
        for (let home = 0; home < this.size; home++) {
            const [a, b, c, d] = this.bounds(home);
            for (let row = this.#row(b); row <= this.#row(d); row++) {
                for (let col = this.#col(a); col <= this.#col(c); col++) (this.#grid[row * this.#cols + col] ??= []).push(home);
            }
        }
    }

    /** How many homes it holds. */
    get size() {
        return Math.max(0, this.#offsets.length - 1);
    }

    /** A home's footprint, as [[x, y], …] in metres. */
    footprint(home) {
        const out = [];
        for (let k = this.#offsets[home]; k < this.#offsets[home + 1]; k++) out.push([this.#points[2 * k], this.#points[2 * k + 1]]);
        return out;
    }

    /** A home's bounds: [x0, y0, x1, y1] in metres. */
    bounds(home) {
        let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
        for (let k = this.#offsets[home]; k < this.#offsets[home + 1]; k++) {
            const x = this.#points[2 * k];
            const y = this.#points[2 * k + 1];
            if (x < a) a = x;
            if (x > c) c = x;
            if (y < b) b = y;
            if (y > d) d = y;
        }
        return [a, b, c, d];
    }

    /**
     * The home whose footprint holds a point, or -1.
     * @param {number} x - Metres from the frame's centre.
     * @param {number} y
     */
    at(x, y) {
        const col = Math.floor((x - this.#x0) / this.#cell);
        const row = Math.floor((y - this.#y0) / this.#cell);
        if (col < 0 || row < 0 || col >= this.#cols || row >= this.#rows) return -1;
        for (const home of this.#grid[row * this.#cols + col] ?? []) if (this.#inside(home, x, y)) return home;
        return -1;
    }

    #col(x) {
        return Math.min(this.#cols - 1, Math.max(0, Math.floor((x - this.#x0) / this.#cell)));
    }

    #row(y) {
        return Math.min(this.#rows - 1, Math.max(0, Math.floor((y - this.#y0) / this.#cell)));
    }

    /** Whether a point lies inside a home's footprint (even and odd crossings). */
    #inside(home, x, y) {
        const start = this.#offsets[home];
        const end = this.#offsets[home + 1];
        let inside = false;
        for (let k = start, j = end - 1; k < end; j = k++) {
            const xi = this.#points[2 * k], yi = this.#points[2 * k + 1];
            const xj = this.#points[2 * j], yj = this.#points[2 * j + 1];
            if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
        }
        return inside;
    }
}
