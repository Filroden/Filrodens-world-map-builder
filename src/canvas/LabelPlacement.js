/**
 * Placing the map's names so they do not cover each other (greedy placement in priority order
 * over a grid index, then annealing among the labels that compete). Pure
 * geometry: no PIXI and no DOM, so it runs and is tested in Node.
 *
 * Each label is a box (centred on its point) with candidate positions in order of preference,
 * each with a cost. Fixed boxes (the pins' icons, and labels with their own position) stay where
 * they are, and the others keep clear of them. Placement has two passes:
 *
 * 1. Greedy, in the labels' order (the most important first): each takes its cheapest candidate
 *    that covers nothing already placed. A label that must be shown (a realm's name) with no free
 *    candidate pushes out labels that need not show (which then find another place or are dropped), or
 *    failing that takes the candidate that covers least; any other label with no free candidate
 *    is dropped.
 * 2. Annealing (Christensen, Marks and Shieber's choice): only the labels that compete for room are
 *    moved, at random, between their candidates and being dropped, keeping a move that lowers the
 *    total cost or, early on, sometimes one that raises it. The total counts each dropped label's
 *    weight, each candidate's cost and, heavily, every overlap. Then a last greedy pass makes sure
 *    nothing the annealing left overlapping is drawn over another.
 *
 * It is seeded, so the same labels are always placed the same way. Given the last result, labels
 * whose box and candidates have not changed start where they were, and only the labels near the
 * ones that changed are moved, so a dragged label or an added pin does not rearrange the map.
 */

/** Overlap costs this many times the weights of the two labels involved, per share of the smaller box. */
const OVERLAP_WEIGHT = 8;

/** Covering a soft box costs this much per share of the smaller box, times the soft box's weight. */
const SOFT_WEIGHT = 1;

/** A candidate's cost counts for this share of its label's weight. */
const CANDIDATE_WEIGHT = 0.2;

/** Annealing moves per competing label, and the most in one placement. */
const MOVES_PER_LABEL = 60;
const MAX_MOVES = 150000;

/** The starting temperature, as a share of the mean weight, and the share it falls to by the end. */
const START_TEMPERATURE = 0.5;
const END_TEMPERATURE = 0.002;

/** The grid's cells hold about this many label heights. */
const GRID_CELL_HEIGHTS = 3;

/** Two boxes nearer than this many map pixels touch (a label's own halo). */
const DEFAULT_PADDING = 2;

/** A small, fast seeded random source (mulberry32). */
function randomSource(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** The area two boxes share; each is { x, y, w, h } centred on x, y. */
function sharedArea(a, b, padding) {
    const width = Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2) + padding;
    if (width <= 0) return 0;
    const height = Math.min(a.y + a.h / 2, b.y + b.h / 2) - Math.max(a.y - a.h / 2, b.y - b.h / 2) + padding;
    return height <= 0 ? 0 : width * height;
}

/** A uniform grid of boxes, for finding the few a box might touch. */
class BoxGrid {
    #size;
    #cells = new Map();

    constructor(size) {
        this.#size = Math.max(1, size);
    }

    get size() {
        return this.#size;
    }

    #keys(box) {
        const size = this.#size;
        const keys = [];
        const x0 = Math.floor((box.x - box.w / 2) / size);
        const x1 = Math.floor((box.x + box.w / 2) / size);
        const y0 = Math.floor((box.y - box.h / 2) / size);
        const y1 = Math.floor((box.y + box.h / 2) / size);
        for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) keys.push(`${gx},${gy}`);
        return keys;
    }

    add(id, box) {
        for (const key of this.#keys(box)) {
            if (!this.#cells.has(key)) this.#cells.set(key, new Set());
            this.#cells.get(key).add(id);
        }
    }

    remove(id, box) {
        for (const key of this.#keys(box)) this.#cells.get(key)?.delete(id);
    }

    /** The ids of every box in the cells a box covers. */
    near(box) {
        const found = new Set();
        for (const key of this.#keys(box)) for (const id of this.#cells.get(key) ?? []) found.add(id);
        return found;
    }
}

/**
 * @typedef {object} LabelRequest
 * @property {string} id - Unique among the labels.
 * @property {number} w - The label's width, in map pixels.
 * @property {number} h - The label's height, in map pixels.
 * @property {{x: number, y: number, cost: number}[]} candidates - Its possible centres, best first.
 * @property {number} weight - How much dropping it costs (a more important label weighs more).
 * @property {boolean} [mustShow] - Never dropped (a realm's name).
 * @property {string} [beside] - The id of a fixed box it may touch (a pin's name, its own pin's icon).
 * @property {boolean} [marker] - A fixed box that is a place's mark (a pin's icon).
 * @property {boolean} [overMarkers] - It may cover marks as if they were soft (a region's name runs
 *     over a place's dot when it must, as on a printed map; a place's name never does).
 * @property {boolean} [soft] - A fixed box others may cover when there is no better place (a minor
 *     place's icon): covering it costs a little, but never drops a label.
 * @property {boolean} [fixed] - Stays at its one candidate and is never dropped or moved: a pin's
 *     icon, or a label with its own position. Others keep clear of it.
 * @property {string} [key] - Everything about it that placing reads, to tell it changed since the last result.
 */

/**
 * Places labels around obstacles.
 * @param {LabelRequest[]} labels - In order of importance, the most important first.
 * @param {{x: number, y: number, w: number, h: number}[]} obstacles - Boxes that stay where they are.
 * @param {object} [options]
 * @param {number} [options.seed]
 * @param {number} [options.padding] - The gap two boxes keep, in map pixels.
 * @param {boolean} [options.anneal] - Refine the greedy result (default true).
 * @param {PlacementResult} [options.previous] - The last result, to start from.
 * @returns {PlacementResult}
 */
export function placeLabels(labels, obstacles = [], { seed = 1, padding = DEFAULT_PADDING, anneal = true, previous = null } = {}) {
    const started = Date.now();
    const state = new PlacementState(labels, obstacles, padding);
    const changed = state.changedSince(previous);
    if (previous && changed.size === 0) return previous.forLabels(labels);

    // After a small change only the labels near it are placed again; the rest keep their places
    const near = previous ? state.neighboursOf(changed) : null;
    state.greedy(previous, near);
    let moves = 0;
    if (anneal) {
        moves = state.anneal(near ?? state.competing(), randomSource(seed));
        state.settle(near);
    }
    return state.result({ moves, ms: Date.now() - started, near: near?.size ?? null });
}

/** A label's candidates (their indices), cheapest first (in their own order where costs tie). */
function byCost(label) {
    return [...label.candidates.keys()].sort((a, b) => label.candidates[a].cost - label.candidates[b].cost || a - b);
}

/** A label's entry in a result: its choice, where that puts it, and its key. */
function entryOf(label, index) {
    const candidate = label.candidates[index];
    const box = candidate ? { x: candidate.x, y: candidate.y, w: label.w, h: label.h } : null;
    return { index: candidate ? index : -1, x: candidate?.x, y: candidate?.y, box, key: label.key };
}

/** What placing gave: each label's chosen candidate (or -1, dropped). */
export class PlacementResult {
    /** @type {Map<string, {index: number, x: number, y: number, box: object|null, key: string}>} */
    chosen;

    /** @type {Set<string>} */
    dropped;

    stats;

    constructor(chosen, dropped, stats) {
        this.chosen = chosen;
        this.dropped = dropped;
        this.stats = stats;
    }

    /** Where a label goes, or null when it was dropped (or is not one of the labels placed). */
    position(id) {
        const entry = this.chosen.get(id);
        return entry && entry.index >= 0 ? { x: entry.x, y: entry.y } : null;
    }

    /** This result again, for labels whose candidates are the same (their positions recomputed from them). */
    forLabels(labels) {
        const chosen = new Map();
        const dropped = new Set();
        for (const label of labels) {
            const index = this.chosen.get(label.id)?.index ?? -1;
            chosen.set(label.id, entryOf(label, index));
            if (index < 0 && !label.fixed) dropped.add(label.id);
        }
        return new PlacementResult(chosen, dropped, { ...this.stats, reused: true });
    }
}

/** The labels, their choices and the grid of what is placed, while placing. */
class PlacementState {
    #labels;
    #obstacles;
    #padding;
    #grid;
    /** Each label's chosen candidate, or -1. */
    #choice;
    #meanWeight;

    constructor(labels, obstacles, padding) {
        this.#labels = labels;
        this.#obstacles = obstacles;
        this.#padding = padding;
        this.#choice = new Int32Array(labels.length).fill(-1);
        const heights = labels.map((label) => label.h).sort((a, b) => a - b);
        const typical = heights[Math.floor(heights.length / 2)] ?? 10;
        this.#grid = new BoxGrid(typical * GRID_CELL_HEIGHTS);
        obstacles.forEach((box, index) => this.#grid.add(-1 - index, box));
        this.#meanWeight = labels.reduce((sum, label) => sum + label.weight, 0) / Math.max(1, labels.length);
    }

    /**
     * The labels (by index) that are new or changed since a result (every label without one), and
     * where the labels since removed were, so the labels near them can use the room.
     * @returns {{indices: Set<number>, freed: {x: number, y: number, w: number, h: number}[], size: number}}
     */
    changedSince(previous) {
        const indices = new Set();
        this.#labels.forEach((label, index) => {
            if (!previous || label.key === undefined || previous.chosen.get(label.id)?.key !== label.key) indices.add(index);
        });
        const ids = new Set(this.#labels.map((label) => label.id));
        const freed = previous ? [...previous.chosen].filter(([id, entry]) => !ids.has(id) && entry.index >= 0).map(([, entry]) => entry.box) : [];
        return { indices, freed, size: indices.size + freed.length };
    }

    #box(index, choice = this.#choice[index]) {
        const label = this.#labels[index];
        const candidate = label.candidates[choice];
        return { x: candidate.x, y: candidate.y, w: label.w, h: label.h };
    }

    #place(index, choice) {
        if (this.#choice[index] >= 0) this.#grid.remove(index, this.#box(index));
        this.#choice[index] = choice;
        if (choice >= 0) this.#grid.add(index, this.#box(index));
    }

    /** What a box overlaps among what is placed (other than `self`): the overlap cost, weighted. */
    #overlapCost(index, box) {
        return this.#overlaps(index, box).cost;
    }

    /**
     * What a box covers among what is placed (other than its own label and the box it sits
     * beside): the weighted cost of it all, and whether any of it is hard (not a soft box).
     */
    #overlaps(index, box) {
        const { weight, beside, overMarkers } = this.#labels[index];
        let cost = 0;
        let hard = false;
        for (const other of this.#grid.near(box)) {
            if (other === index || (beside !== undefined && other >= 0 && this.#labels[other].id === beside)) continue;
            const otherLabel = other < 0 ? null : this.#labels[other];
            const otherBox = other < 0 ? this.#obstacles[-1 - other] : this.#box(other);
            const area = sharedArea(box, otherBox, this.#padding);
            if (area <= 0) continue;
            const share = area / Math.max(1, Math.min(box.w * box.h, otherBox.w * otherBox.h));
            if (otherLabel?.soft || (overMarkers && otherLabel?.marker)) {
                cost += SOFT_WEIGHT * share * otherLabel.weight;
                continue;
            }
            hard = true;
            cost += OVERLAP_WEIGHT * share * (weight + (otherLabel ? otherLabel.weight : weight));
        }
        return { cost, hard };
    }

    /** A label's own cost at a choice: dropped, or its candidate's cost plus what it overlaps. */
    #cost(index, choice) {
        const label = this.#labels[index];
        if (choice < 0) return label.mustShow ? Infinity : label.weight;
        return CANDIDATE_WEIGHT * label.weight * label.candidates[choice].cost + this.#overlapCost(index, this.#box(index, choice));
    }

    /** Pass 1: the fixed boxes, then each label in order takes its first free candidate (its last choice first, given one). */
    greedy(previous, near = null) {
        this.#placeFixed();
        // Labels away from the change go straight back to their last places
        if (near) {
            this.#labels.forEach((label, index) => {
                const before = previous.chosen.get(label.id);
                if (!label.fixed && !near.has(index) && before?.index >= 0) this.#place(index, before.index);
            });
        }
        this.#labels.forEach((label, index) => {
            if (label.fixed || (near && !near.has(index))) return;
            const before = previous?.chosen.get(label.id);
            const first = before && before.key === label.key && before.index >= 0 ? [before.index] : [];
            this.#takeBest(index, [...first, ...byCost(label)]);
        });
    }

    #placeFixed() {
        this.#labels.forEach((label, index) => {
            if (label.fixed && label.candidates.length) this.#place(index, 0);
        });
    }

    /**
     * A label takes the first of its choices (candidate indices, in order) that covers nothing
     * placed; else the one covering least of only soft boxes; else a label that must show takes
     * the one covering least, and any other stays dropped.
     */
    #takeBest(index, order) {
        let best = -1;
        let bestCost = Infinity;
        let bestHard = true;
        for (const choice of order) {
            const { cost, hard } = this.#overlaps(index, this.#box(index, choice));
            if (cost === 0) {
                this.#place(index, choice);
                return;
            }
            // A place covering only soft boxes beats any covering a hard one
            if ((bestHard && !hard) || (hard === bestHard && cost < bestCost)) {
                best = choice;
                bestCost = cost;
                bestHard = hard;
            }
        }
        if (best >= 0 && !bestHard) {
            this.#place(index, best);
            return;
        }
        if (!this.#labels[index].mustShow) return;
        if (!this.#evictFor(index, order)) this.#place(index, best);
    }

    /**
     * A label that must show, with no free place, takes the place where it covers only labels
     * that need not show (a city's name under a realm's), whatever they weigh, at the least cost
     * (theirs and its place's); they then take another place or are dropped. Two labels that must
     * show never push each other. Returns whether it found such a place.
     */
    #evictFor(index, order) {
        const label = this.#labels[index];
        let best = null;
        for (const choice of order) {
            const box = this.#box(index, choice);
            const covered = [];
            let movable = true;
            for (const other of this.#grid.near(box)) {
                if (other === index || other < 0 || this.#labels[other].id === label.beside) continue;
                const otherLabel = this.#labels[other];
                if (otherLabel.soft || (label.overMarkers && otherLabel.marker) || sharedArea(box, this.#box(other), this.#padding) <= 0) continue;
                if (otherLabel.fixed || otherLabel.mustShow) {
                    movable = false;
                    break;
                }
                covered.push(other);
            }
            if (!movable) continue;
            const cost = covered.reduce((sum, other) => sum + this.#labels[other].weight, CANDIDATE_WEIGHT * label.weight * label.candidates[choice].cost);
            if (!best || cost < best.cost) best = { choice, covered, cost };
        }
        if (!best) return false;
        for (const other of best.covered) this.#place(other, -1);
        this.#place(index, best.choice);
        for (const other of best.covered) this.#takeBest(other, byCost(this.#labels[other]));
        return true;
    }

    /** Labels (by index) any of whose candidates touch another label's candidates or an obstacle. */
    competing() {
        const reach = this.#reachGrid(true);
        const competing = new Set();
        this.#labels.forEach((label, index) => {
            const touches = label.candidates.some((_, choice) => this.#touching(reach, index, this.#box(index, choice)));
            if (touches) competing.add(index);
        });
        return competing;
    }

    /** The labels that changed, those whose candidates touch theirs, and those near the room freed. */
    neighboursOf(changed) {
        const reach = this.#reachGrid(false);
        const near = new Set(changed.indices);
        const add = (box) => {
            for (const other of reach.grid.near(box)) if (other >= 0 && sharedArea(box, reach.unions[other], this.#padding) > 0) near.add(other);
        };
        for (const index of changed.indices) for (const choice of this.#labels[index].candidates.keys()) add(this.#box(index, choice));
        for (const box of changed.freed) add(box);
        return near;
    }

    /** Whether a box touches another label's reach (all its candidates) or an obstacle. */
    #touching(reach, index, box) {
        for (const other of reach.grid.near(box)) {
            if (other === index) continue;
            const otherBox = other < 0 ? this.#obstacles[-1 - other] : reach.unions[other];
            if (sharedArea(box, otherBox, this.#padding) > 0) return true;
        }
        return false;
    }

    /** A grid of each label's reach (one box around all its candidates; fixed boxes too, if asked) and the obstacles. */
    #reachGrid(withFixed) {
        const unions = this.#labels.map((_, index) => this.#unionOf(index));
        const grid = new BoxGrid(this.#grid.size);
        unions.forEach((box, index) => {
            if (withFixed || !this.#labels[index].fixed) grid.add(index, box);
        });
        this.#obstacles.forEach((box, index) => grid.add(-1 - index, box));
        return { grid, unions };
    }

    /** One box around all of a label's candidates. */
    #unionOf(index) {
        const label = this.#labels[index];
        let x0 = Infinity;
        let y0 = Infinity;
        let x1 = -Infinity;
        let y1 = -Infinity;
        for (const candidate of label.candidates) {
            x0 = Math.min(x0, candidate.x - label.w / 2);
            x1 = Math.max(x1, candidate.x + label.w / 2);
            y0 = Math.min(y0, candidate.y - label.h / 2);
            y1 = Math.max(y1, candidate.y + label.h / 2);
        }
        return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
    }

    /** Pass 2: random moves among the given labels, cooling from START_TEMPERATURE. */
    anneal(movable, random) {
        const indices = [...movable].filter((index) => !this.#labels[index].fixed && this.#labels[index].candidates.length > 0).sort((a, b) => a - b);
        if (!indices.length) return 0;
        const moves = Math.min(MAX_MOVES, indices.length * MOVES_PER_LABEL);
        const start = START_TEMPERATURE * this.#meanWeight;
        const cooling = Math.pow(END_TEMPERATURE / START_TEMPERATURE, 1 / moves);
        let temperature = start;
        for (let move = 0; move < moves; move++, temperature *= cooling) {
            const index = indices[Math.floor(random() * indices.length)];
            const label = this.#labels[index];
            const options = label.candidates.length + (label.mustShow ? 0 : 1);
            const pick = Math.floor(random() * options);
            const choice = pick === label.candidates.length ? -1 : pick;
            const current = this.#choice[index];
            if (choice === current) continue;
            const delta = this.#cost(index, choice) - this.#cost(index, current);
            if (delta <= 0 || random() < Math.exp(-delta / temperature)) this.#place(index, choice);
        }
        return moves;
    }

    /**
     * The last pass, in order: a label keeps its choice if it covers nothing placed before it,
     * else takes a free candidate, else is dropped (a label that must show takes the least covered).
     */
    settle(near = null) {
        const kept = this.#choice.slice();
        const settling = (index) => !this.#labels[index].fixed && (!near || near.has(index));
        for (let index = 0; index < this.#labels.length; index++) if (settling(index)) this.#place(index, -1);
        this.#labels.forEach((label, index) => {
            if (!settling(index)) return;
            this.#takeBest(index, kept[index] >= 0 ? [kept[index], ...byCost(label)] : byCost(label));
        });
    }

    result(stats) {
        const chosen = new Map();
        const dropped = new Set();
        this.#labels.forEach((label, index) => {
            const choice = this.#choice[index];
            chosen.set(label.id, entryOf(label, choice));
            if (choice < 0 && !label.fixed) dropped.add(label.id);
        });
        return new PlacementResult(chosen, dropped, { ...stats, labels: this.#labels.length, placed: this.#labels.length - dropped.size });
    }
}
