import { UNCLAIMED } from "./Schema.js";

/**
 * One level's partition of the display mesh: for every cell, the key of the region that owns it,
 * or UNCLAIMED (-1). Regions carry no geometry of their own; exclaves, enclaves and holes are just
 * which cells hold which key.
 *
 * Every edit goes through `set`, which returns a patch listing only the cells whose owner changed
 * with their values before and after. Undo and redo apply a patch backwards or forwards, so the
 * history of a level costs memory in proportion to what was edited, never a copy of the whole
 * array per step.
 *
 * Also here: the run-length codec owner arrays are saved with, cell selection by polygon and by
 * brush, and the nesting rule between a level and its parent level.
 */

// ------------------------------------------------------------------ patches

/**
 * @typedef {object} OwnerPatch
 * @property {Int32Array} cells - The cells that changed, each once, in ascending order.
 * @property {Int32Array} before - Their owners before the edit.
 * @property {Int32Array} after - Their owners after it.
 */

const EMPTY_PATCH = Object.freeze({ cells: new Int32Array(0), before: new Int32Array(0), after: new Int32Array(0) });

/**
 * Combines two consecutive patches of the same layer into one (for example, the many small paints
 * of one brush stroke into a single undo step). A cell in both keeps the first patch's `before`
 * and the second's `after`; a cell that ends where it started is dropped.
 * @param {OwnerPatch} first
 * @param {OwnerPatch} second
 * @returns {OwnerPatch}
 */
export function mergePatches(first, second) {
    const before = new Map();
    const after = new Map();
    first.cells.forEach((cell, i) => {
        before.set(cell, first.before[i]);
        after.set(cell, first.after[i]);
    });
    second.cells.forEach((cell, i) => {
        if (!before.has(cell)) before.set(cell, second.before[i]);
        after.set(cell, second.after[i]);
    });
    const cells = [...before.keys()].filter((cell) => before.get(cell) !== after.get(cell)).sort((a, b) => a - b);
    return {
        cells: Int32Array.from(cells),
        before: Int32Array.from(cells, (cell) => before.get(cell)),
        after: Int32Array.from(cells, (cell) => after.get(cell)),
    };
}

/** True when a patch changes nothing. */
export function isEmptyPatch(patch) {
    return patch.cells.length === 0;
}

// ------------------------------------------------------------------ the layer

export class OwnerLayer {
    /**
     * @param {number|Int32Array} cellsOrOwners - A cell count (all unclaimed), or an owner array to
     *     wrap (not copied).
     */
    constructor(cellsOrOwners) {
        this.owners = typeof cellsOrOwners === "number" ? new Int32Array(cellsOrOwners).fill(UNCLAIMED) : cellsOrOwners;
    }

    /** A layer from a saved string (see encodeOwners). */
    static decode(text, cellCount) {
        const owners = decodeOwners(text);
        if (cellCount !== undefined && owners.length !== cellCount) throw new Error(`Owner array has ${owners.length} cells; the mesh has ${cellCount}.`);
        return new OwnerLayer(owners);
    }

    encode() {
        return encodeOwners(this.owners);
    }

    get cellCount() {
        return this.owners.length;
    }

    ownerOf(cell) {
        return this.owners[cell];
    }

    /**
     * Gives `cells` to `owner`. The basic edit every other one is made of.
     * @param {Iterable<number>} cells - Duplicates are allowed.
     * @param {number} owner - A region key, or UNCLAIMED.
     * @param {function(number): boolean} [allow] - Cells it returns false for are left alone (see withinParent).
     * @returns {OwnerPatch}
     */
    set(cells, owner, allow = null) {
        const changed = [];
        for (const cell of cells) {
            if (this.owners[cell] === owner || (allow && !allow(cell))) continue;
            changed.push(cell);
        }
        if (!changed.length) return EMPTY_PATCH;
        const unique = Int32Array.from(new Set(changed)).sort();
        const before = unique.map((cell) => this.owners[cell]);
        for (const cell of unique) this.owners[cell] = owner;
        return { cells: unique, before, after: new Int32Array(unique.length).fill(owner) };
    }

    /**
     * Gives each of `cells` its own new owner, `values[i]`, in one patch (used by the passes that
     * hand many cells to many regions at once, such as border relaxation).
     * @param {Int32Array|number[]} cells - Each cell at most once.
     * @param {Int32Array|number[]} values
     * @returns {OwnerPatch}
     */
    assign(cells, values) {
        const order = Array.from(cells.keys()).filter((i) => this.owners[cells[i]] !== values[i]);
        order.sort((a, b) => cells[a] - cells[b]);
        const changed = Int32Array.from(order, (i) => cells[i]);
        const before = changed.map((cell) => this.owners[cell]);
        const after = Int32Array.from(order, (i) => values[i]);
        changed.forEach((cell, i) => {
            this.owners[cell] = after[i];
        });
        return changed.length ? { cells: changed, before, after } : EMPTY_PATCH;
    }

    /** Paints cells into a region (see set). */
    paint(cells, owner, allow = null) {
        return this.set(cells, owner, allow);
    }

    /** Releases cells (see set). */
    erase(cells, allow = null) {
        return this.set(cells, UNCLAIMED, allow);
    }

    /**
     * Bucket fill: gives `owner` every cell connected to `start` through neighbours that share
     * start's current owner (and pass `passable`, for example "is land").
     * @param {import("./MeshBuilder.js").Mesh} mesh
     * @param {number} start
     * @param {number} owner
     * @param {object} [options]
     * @param {function(number): boolean} [options.passable]
     * @param {function(number): boolean} [options.allow]
     * @returns {OwnerPatch}
     */
    flood(mesh, start, owner, { passable = null, allow = null } = {}) {
        const target = this.owners[start];
        if (target === owner) return EMPTY_PATCH;
        const matches = (cell) => this.owners[cell] === target && (!passable || passable(cell));
        return this.set(connectedCells(mesh, start, matches), owner, allow);
    }

    /**
     * Gives `owner` every cell whose site lies inside a polygon (or releases them with UNCLAIMED).
     * @param {import("./MeshBuilder.js").Mesh} mesh
     * @param {Array<{x: number, y: number}>|Array<number[]>} polygon
     * @param {number} owner
     * @param {function(number): boolean} [allow]
     * @returns {OwnerPatch}
     */
    lasso(mesh, polygon, owner, allow = null) {
        return this.set(cellsInPolygon(mesh, polygon), owner, allow);
    }

    /** Applies a patch forwards (redo). */
    apply(patch) {
        patch.cells.forEach((cell, i) => {
            this.owners[cell] = patch.after[i];
        });
    }

    /** Applies a patch backwards (undo). */
    revert(patch) {
        patch.cells.forEach((cell, i) => {
            this.owners[cell] = patch.before[i];
        });
    }

    /** The cells a region owns. */
    cellsOf(owner) {
        const cells = [];
        this.owners.forEach((value, cell) => {
            if (value === owner) cells.push(cell);
        });
        return Int32Array.from(cells);
    }

    /** Number of cells per owner (UNCLAIMED included). */
    counts() {
        const counts = new Map();
        for (const owner of this.owners) counts.set(owner, (counts.get(owner) ?? 0) + 1);
        return counts;
    }

    /**
     * Gives the cells of one owner to another, in one patch (merging two regions, or deleting a
     * region by passing UNCLAIMED).
     */
    reassign(fromOwner, toOwner) {
        return this.set(this.cellsOf(fromOwner), toOwner);
    }
}

// ------------------------------------------------------------------ selection

/**
 * The cells connected to `start` through cells for which `matches` is true (start included if it
 * matches), by breadth-first search over the mesh.
 * @returns {Int32Array}
 */
export function connectedCells(mesh, start, matches) {
    if (!matches(start)) return new Int32Array(0);
    const seen = new Uint8Array(mesh.cellCount);
    const queue = [start];
    seen[start] = 1;
    for (let head = 0; head < queue.length; head++) {
        for (const next of mesh.neighbours(queue[head])) {
            if (seen[next] || !matches(next)) continue;
            seen[next] = 1;
            queue.push(next);
        }
    }
    return Int32Array.from(queue);
}

/** Accepts [{x, y}] or [[x, y]] polygons. */
function toFlatPolygon(polygon) {
    const flat = new Float64Array(polygon.length * 2);
    polygon.forEach((point, i) => {
        flat[2 * i] = Array.isArray(point) ? point[0] : point.x;
        flat[2 * i + 1] = Array.isArray(point) ? point[1] : point.y;
    });
    return flat;
}

/**
 * Even-odd point-in-polygon test (a horizontal ray crossing count), which is what makes a
 * self-intersecting lasso select the areas a fill would paint.
 * @param {Float64Array} flat - [x0, y0, x1, y1, ...], open or closed.
 */
export function pointInPolygon(flat, x, y) {
    let inside = false;
    const count = flat.length / 2;
    for (let i = 0, j = count - 1; i < count; j = i++) {
        const xi = flat[2 * i];
        const yi = flat[2 * i + 1];
        const xj = flat[2 * j];
        const yj = flat[2 * j + 1];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}

function polygonBounds(flat) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < flat.length; i += 2) {
        minX = Math.min(minX, flat[i]);
        maxX = Math.max(maxX, flat[i]);
        minY = Math.min(minY, flat[i + 1]);
        maxY = Math.max(maxY, flat[i + 1]);
    }
    return { minX, minY, maxX, maxY };
}

/**
 * The cells whose site lies inside a polygon. Sites outside the polygon's bounding box are
 * skipped before the exact test.
 * @param {import("./MeshBuilder.js").Mesh} mesh
 * @param {Array<{x: number, y: number}>|Array<number[]>} polygon
 * @returns {Int32Array}
 */
export function cellsInPolygon(mesh, polygon) {
    if (polygon.length < 3) return new Int32Array(0);
    const flat = toFlatPolygon(polygon);
    const { minX, minY, maxX, maxY } = polygonBounds(flat);
    const cells = [];
    for (let cell = 0; cell < mesh.cellCount; cell++) {
        const x = mesh.siteX(cell);
        const y = mesh.siteY(cell);
        if (x < minX || x > maxX || y < minY || y > maxY) continue;
        if (pointInPolygon(flat, x, y)) cells.push(cell);
    }
    return Int32Array.from(cells);
}

/**
 * The cells whose site lies within `radius` of (x, y), always including the cell under the point
 * (so a brush smaller than a cell still paints). Grows outwards from that cell, so the cost
 * depends on the brush, not the map.
 * @returns {Int32Array}
 */
export function cellsInCircle(mesh, x, y, radius, hint = 0) {
    const centre = mesh.cellAt(x, y, hint);
    const radiusSq = radius * radius;
    const inside = (cell) => {
        const dx = mesh.siteX(cell) - x;
        const dy = mesh.siteY(cell) - y;
        return dx * dx + dy * dy <= radiusSq;
    };
    // The disc's cells are connected through cells inside it, except that the centre cell's site
    // may itself lie outside a tiny disc: the search starts from the centre regardless.
    const seen = new Set([centre]);
    const queue = [centre];
    for (let head = 0; head < queue.length; head++) {
        for (const next of mesh.neighbours(queue[head])) {
            if (seen.has(next) || !inside(next)) continue;
            seen.add(next);
            queue.push(next);
        }
    }
    return Int32Array.from(queue);
}

// ------------------------------------------------------------------ nesting

/**
 * The parent region each child region belongs to: the parent owner holding most of its cells
 * (ties to the lower key, so the answer does not depend on cell order). Unclaimed parent cells
 * count as a candidate too, so a child region drawn mostly outside every parent maps to UNCLAIMED.
 * @param {Int32Array} childOwners
 * @param {Int32Array} parentOwners
 * @returns {Map<number, number>}
 */
export function parentAssignments(childOwners, parentOwners) {
    const tallies = new Map();
    childOwners.forEach((child, cell) => {
        if (child === UNCLAIMED) return;
        if (!tallies.has(child)) tallies.set(child, new Map());
        const tally = tallies.get(child);
        const parent = parentOwners[cell];
        tally.set(parent, (tally.get(parent) ?? 0) + 1);
    });
    const assignments = new Map();
    for (const [child, tally] of tallies) assignments.set(child, majority(tally));
    return assignments;
}

function majority(tally) {
    let best = UNCLAIMED;
    let bestCount = -1;
    for (const [owner, count] of tally) {
        if (count > bestCount || (count === bestCount && owner < best)) {
            best = owner;
            bestCount = count;
        }
    }
    return best;
}

/**
 * The child cells that break the nesting rule: a claimed child cell whose parent cell is not owned
 * by the parent region its region belongs to (see parentAssignments), including a child cell over
 * unclaimed parent ground.
 * @param {Int32Array} childOwners
 * @param {Int32Array} parentOwners
 * @param {Map<number, number>} [assignments] - Child key to parent key; worked out if omitted.
 * @returns {Int32Array}
 */
export function nestingViolations(childOwners, parentOwners, assignments = parentAssignments(childOwners, parentOwners)) {
    const cells = [];
    childOwners.forEach((child, cell) => {
        if (child === UNCLAIMED) return;
        const parent = assignments.get(child) ?? UNCLAIMED;
        if (parent === UNCLAIMED || parentOwners[cell] !== parent) cells.push(cell);
    });
    return Int32Array.from(cells);
}

/**
 * An `allow` predicate for edits on a child level that keeps a region inside its parent region:
 * only cells the parent level gives to `parentKey` may be painted.
 * @param {Int32Array} parentOwners
 * @param {number} parentKey
 */
export function withinParent(parentOwners, parentKey) {
    return (cell) => parentOwners[cell] === parentKey;
}

// ------------------------------------------------------------------ codec

/**
 * Encodes an owner array for saving: runs of (value, length) in cell order, each number as a
 * LEB128 varint (values zigzag-encoded so -1 takes one byte), preceded by the array length, then
 * base64. Owner arrays are long runs of the same region in whatever order the sampler produced the
 * cells, and neighbouring sites are close in that order often enough that a level of a 120k-cell
 * map with a few dozen regions encodes to a few tens of kB.
 * @param {Int32Array} owners
 * @returns {string}
 */
export function encodeOwners(owners) {
    const writer = new VarintWriter(owners.length);
    writer.writeUnsigned(owners.length);
    let index = 0;
    while (index < owners.length) {
        const value = owners[index];
        let end = index + 1;
        while (end < owners.length && owners[end] === value) end++;
        writer.writeUnsigned(zigzag(value));
        writer.writeUnsigned(end - index);
        index = end;
    }
    return bytesToBase64(writer.bytes());
}

/**
 * Decodes encodeOwners' output.
 * @param {string} text
 * @returns {Int32Array}
 */
export function decodeOwners(text) {
    const reader = new VarintReader(base64ToBytes(text));
    const length = reader.readUnsigned();
    const owners = new Int32Array(length);
    let index = 0;
    while (index < length) {
        const value = unzigzag(reader.readUnsigned());
        const run = reader.readUnsigned();
        if (run === 0 || index + run > length) throw new Error("Owner data is corrupt (a run overflows the array).");
        owners.fill(value, index, index + run);
        index += run;
    }
    return owners;
}

const zigzag = (value) => (value >= 0 ? value * 2 : -value * 2 - 1);
const unzigzag = (value) => (value % 2 === 0 ? value / 2 : -(value + 1) / 2);

const VARINT_PAYLOAD = 0x7f;
const VARINT_MORE = 0x80;
const VARINT_SHIFT = 128;
const MAX_VARINT_BYTES = 5;

/** Little-endian base-128 varints into a growing byte buffer. */
class VarintWriter {
    #buffer;
    #length = 0;

    constructor(sizeHint) {
        this.#buffer = new Uint8Array(Math.max(64, sizeHint >> 4));
    }

    writeUnsigned(value) {
        if (this.#length + MAX_VARINT_BYTES > this.#buffer.length) this.#grow();
        let rest = value;
        while (rest >= VARINT_MORE) {
            this.#buffer[this.#length++] = (rest % VARINT_SHIFT) | VARINT_MORE;
            rest = Math.floor(rest / VARINT_SHIFT);
        }
        this.#buffer[this.#length++] = rest;
    }

    bytes() {
        return this.#buffer.subarray(0, this.#length);
    }

    #grow() {
        const larger = new Uint8Array(this.#buffer.length * 2);
        larger.set(this.#buffer);
        this.#buffer = larger;
    }
}

class VarintReader {
    #bytes;
    #position = 0;

    constructor(bytes) {
        this.#bytes = bytes;
    }

    readUnsigned() {
        let value = 0;
        let scale = 1;
        for (let count = 0; count < MAX_VARINT_BYTES; count++) {
            if (this.#position >= this.#bytes.length) throw new Error("Owner data is corrupt (it ends inside a number).");
            const byte = this.#bytes[this.#position++];
            value += (byte & VARINT_PAYLOAD) * scale;
            if (byte < VARINT_MORE) return value;
            scale *= VARINT_SHIFT;
        }
        throw new Error("Owner data is corrupt (a number is too long).");
    }
}

/** Characters per String.fromCharCode call: well below every engine's argument limit. */
const BASE64_CHUNK = 0x8000;

function bytesToBase64(bytes) {
    let binary = "";
    for (let i = 0; i < bytes.length; i += BASE64_CHUNK) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + BASE64_CHUNK));
    return btoa(binary);
}

function base64ToBytes(text) {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}
