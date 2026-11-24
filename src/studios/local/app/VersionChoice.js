import { FILRODENSWMB } from "../../../config.js";
import { LAYERS } from "../render/CanvasTown.js";

/**
 * What a settlement's pictures draw: every layer but its title, scale bar and north arrow (the
 * labels layer), which the canvas draws once over its tiles, and a version's card has its name.
 */
export const PICTURE_LAYERS = Object.freeze(LAYERS.filter((name) => name !== "labels"));

/**
 * Make settlement map's four versions (L-surface, board L2): the **Default** (the map's seed and the
 * pin's id, or a seed the user types) and **Alt. version 1 to 3** (random seeds), built side by side
 * in the Local studio's workers, the Default first. Each card is waiting (for a free worker),
 * drawing (with a progress bar the engine cannot report, so guessed from its people:
 * LOCAL.BUILD_ESTIMATE), ready (its thumbnail) or failed.
 *
 * Nothing is kept until `keep`: the versions not kept are released from their workers, and
 * `destroy` releases them all (Cancel, or leaving the choice any other way).
 */

/** A version's id among those the workers hold: unique for the session. */
let made = 0;
const newVersionId = () => `v${Date.now().toString(36)}${(made++).toString(36)}`;

/** Letters for a random seed: no 0, O, 1 or I, so one read off a card can be typed back. */
const SEED_LETTERS = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/** A random seed for an alternative: four letters, then the pin's id, as the Default is the map's seed then the pin's id. */
export function randomSeed(pinId, random = Math.random) {
    let word = "";
    for (let i = 0; i < 4; i++) word += SEED_LETTERS[Math.floor(random() * SEED_LETTERS.length)];
    return `${word}:${pinId}`;
}

/** How long a version is guessed to take (ms): see LOCAL.BUILD_ESTIMATE. */
export function estimateMs(population) {
    const { BASE_MS, MS_PER_PERSON } = FILRODENSWMB.LOCAL.BUILD_ESTIMATE;
    return BASE_MS + MS_PER_PERSON * Math.max(0, population ?? 0);
}

export class VersionChoice {
    /** The four cards, in order: { index, seed, id, input, state, startedAt, result, thumbnail, error }. */
    slots = [];
    /** The card chosen (its radio), or null. */
    selected = 0;

    #workers;
    #inputFor;
    #pinId;
    #onChange;
    #destroyed = false;
    /** Builds asked for and not yet back, in the order asked (the workers take them so). */
    #queue = [];

    /**
     * @param {object} options
     * @param {import("../LocalWorkers.js").LocalWorkers} options.workers
     * @param {(seed: string) => object} options.inputFor - The engine's input for a seed.
     * @param {string} options.pinId
     * @param {string} options.defaultSeed
     * @param {string[]} [options.alternatives] - The alternatives' seeds (random by default).
     * @param {() => void} options.onChange - Told when a card changes.
     */
    constructor({ workers, inputFor, pinId, defaultSeed, alternatives = null, onChange }) {
        this.#workers = workers;
        this.#inputFor = inputFor;
        this.#pinId = pinId;
        this.#onChange = onChange;
        const seeds = [defaultSeed, ...(alternatives ?? [1, 2, 3].map(() => randomSeed(pinId)))];
        this.slots = seeds.map((seed, index) => ({ index, seed }));
        for (const slot of this.slots) this.#start(slot);
    }

    /** The chosen card, when it is ready to keep. */
    get chosen() {
        const slot = this.slots[this.selected];
        return slot?.state === "ready" ? slot : null;
    }

    /** Whether any card is still waiting or drawing. */
    get busy() {
        return this.slots.some((slot) => slot.state === "waiting" || slot.state === "drawing");
    }

    /**
     * A card's progress, 0 to 1: a drawing card's guessed from the time since it started, short of
     * full until it is ready.
     */
    progress(slot, now = performance.now()) {
        if (slot.state === "ready") return 1;
        if (slot.state !== "drawing" || !slot.startedAt) return 0;
        return Math.min(FILRODENSWMB.LOCAL.BUILD_ESTIMATE.MOST, (now - slot.startedAt) / estimateMs(slot.input?.population));
    }

    /** Chooses a card (its radio). */
    pick(index) {
        if (!this.slots[index]) return;
        this.selected = index;
        this.#onChange();
    }

    /** A seed typed for the Default: it is drawn again from that seed. */
    setDefaultSeed(seed) {
        const text = String(seed ?? "").trim();
        if (!text || text === this.slots[0].seed) return false;
        this.#replace(0, text);
        return true;
    }

    /** Three new alternatives: the three drawn again from new random seeds. */
    newAlternatives() {
        for (const index of [1, 2, 3]) this.#replace(index, randomSeed(this.#pinId));
        if (this.selected > 0) this.selected = 0;
        this.#onChange();
    }

    /**
     * Keeps the chosen version: the others released. Resolves with the kept card (its version id,
     * input and build result), or null when none is ready.
     */
    keep() {
        const slot = this.chosen;
        if (!slot) return null;
        this.#release(this.slots.filter((other) => other !== slot));
        this.#destroyed = true;
        return slot;
    }

    /** Every version released (Cancel, or leaving the choice). */
    destroy() {
        if (this.#destroyed) return;
        this.#destroyed = true;
        this.#release(this.slots);
    }

    // ------------------------------------------------------------------

    #replace(index, seed) {
        const old = this.slots[index];
        this.#release([old]);
        const slot = { index, seed };
        this.slots[index] = slot;
        this.#start(slot);
        this.#onChange();
    }

    #release(slots) {
        const ids = [];
        for (const slot of slots) {
            if (!slot?.id) continue;
            this.#queue = this.#queue.filter((entry) => entry !== slot);
            slot.thumbnail?.close?.();
            if (slot.state === "ready") ids.push(slot.id);
            else if (slot.state === "waiting" || slot.state === "drawing") this.#workers.cancel(slot.id);
            slot.state = "released";
        }
        if (ids.length) this.#workers.release(ids).catch(() => {});
    }

    /** Builds a card's version, its thumbnail at the card's size. */
    #start(slot) {
        slot.id = newVersionId();
        slot.state = "waiting";
        slot.result = null;
        slot.thumbnail = null;
        slot.error = null;
        try {
            slot.input = this.#inputFor(slot.seed);
        } catch (error) {
            slot.state = "failed";
            slot.error = error;
            console.error("FWMB | A settlement's input could not be read:", error);
            return;
        }
        this.#queue.push(slot);
        this.#markStarted();
        const { widthPx, heightPx } = FILRODENSWMB.LOCAL.THUMBNAIL;
        this.#workers
            .build(slot.id, slot.input, { thumbnail: { widthPx, heightPx, style: { name: "atlas" }, layers: PICTURE_LAYERS } })
            .then((result) => {
                if (slot.state === "released" || this.#destroyed) {
                    result.thumbnail?.close?.();
                    return;
                }
                slot.result = result;
                slot.thumbnail = result.thumbnail ?? null;
                slot.state = "ready";
            })
            .catch((error) => {
                if (slot.state === "released" || error?.name === "AbortError") return;
                slot.state = "failed";
                slot.error = error;
                console.error("FWMB | A settlement version could not be drawn:", error);
            })
            .finally(() => {
                this.#queue = this.#queue.filter((entry) => entry !== slot);
                this.#markStarted();
                if (!this.#destroyed || slot.state === "ready") this.#onChange();
            });
    }

    /** The builds the workers are on now: as many of the queue's first as there are workers. */
    #markStarted() {
        const now = performance.now();
        this.#queue.forEach((slot, rank) => {
            if (rank < this.#workers.size && slot.state === "waiting") {
                slot.state = "drawing";
                slot.startedAt = now;
            }
        });
    }
}
