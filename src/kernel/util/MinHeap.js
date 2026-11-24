/**
 * A binary min-heap of (priority, cell) pairs held in typed arrays, for the least-cost searches
 * over the mesh. Keeping priorities and cells in two parallel typed arrays, rather than an array
 * of small arrays, avoids an allocation per push, which matters on a search that settles a few
 * hundred thousand cells.
 *
 * Entries are never updated in place: a search pushes a cell again whenever it finds a cheaper
 * way to it and skips stale entries as they come off the heap ("lazy deletion").
 *
 * Ties are broken by the cell id (lower first), so the order cells are settled in, and therefore
 * which of two equally cheap paths a search takes, never depends on the order entries were pushed.
 */
export class MinHeap {
    #priorities;
    #cells;
    #size = 0;

    constructor(capacity = 1024) {
        this.#priorities = new Float64Array(capacity);
        this.#cells = new Int32Array(capacity);
    }

    get size() {
        return this.#size;
    }

    clear() {
        this.#size = 0;
    }

    /** The smallest priority (only valid when size > 0). */
    peekPriority() {
        return this.#priorities[0];
    }

    push(priority, cell) {
        if (this.#size === this.#cells.length) this.#grow();
        let index = this.#size++;
        while (index > 0) {
            const parent = (index - 1) >> 1;
            if (!this.#before(priority, cell, parent)) break;
            this.#priorities[index] = this.#priorities[parent];
            this.#cells[index] = this.#cells[parent];
            index = parent;
        }
        this.#priorities[index] = priority;
        this.#cells[index] = cell;
    }

    /**
     * Removes the smallest entry and returns its cell; its priority is in lastPriority.
     * @returns {number}
     */
    pop() {
        const cell = this.#cells[0];
        this.lastPriority = this.#priorities[0];
        const size = --this.#size;
        if (size > 0) this.#siftDown(this.#priorities[size], this.#cells[size], size);
        return cell;
    }

    #siftDown(priority, cell, size) {
        let index = 0;
        for (;;) {
            const left = 2 * index + 1;
            if (left >= size) break;
            const right = left + 1;
            const child = right < size && this.#isBefore(right, left) ? right : left;
            if (!this.#before(this.#priorities[child], this.#cells[child], -1, priority, cell)) break;
            this.#priorities[index] = this.#priorities[child];
            this.#cells[index] = this.#cells[child];
            index = child;
        }
        this.#priorities[index] = priority;
        this.#cells[index] = cell;
    }

    /** Whether (priority, cell) comes before the entry at `slot`, or before (otherPriority, otherCell) when slot is -1. */
    #before(priority, cell, slot, otherPriority = this.#priorities[slot], otherCell = this.#cells[slot]) {
        return priority < otherPriority || (priority === otherPriority && cell < otherCell);
    }

    #isBefore(a, b) {
        return this.#before(this.#priorities[a], this.#cells[a], b);
    }

    #grow() {
        const priorities = new Float64Array(this.#cells.length * 2);
        const cells = new Int32Array(this.#cells.length * 2);
        priorities.set(this.#priorities);
        cells.set(this.#cells);
        this.#priorities = priorities;
        this.#cells = cells;
    }
}
