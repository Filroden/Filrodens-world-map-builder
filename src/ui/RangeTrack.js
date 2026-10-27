/**
 * A range on one track: a band between two handles, as the biome rule editor draws its ranges
 * (`.fwmb-rule-track`, `.fwmb-rule-fill`, `.fwmb-rule-handle`) and the culture inspector its
 * habitat bands. Both share the handles' behaviour:
 *
 * - **Drag** (`dragEdge`): a handle follows the pointer along the track and never crosses the
 *   other end; the caller writes the value and redraws.
 * - **Keys** (`stepKey`): the arrow keys move a handle one step, Page Up and Page Down ten, Home
 *   and End to the track's ends.
 *
 * A **band field** (the `parts/range-band.hbs` partial) is a form field built on them: its value
 * is a hidden input (`lo,hi`, named as the field), so a form reads it as any other field, and it
 * sends `change` when a drag ends, a key moves a handle, a quick pick is chosen or a double-click
 * returns it to its default (the whole track, no limit). `bind` listens on a container for every
 * band field inside it, drawn now or later; `syncAll` draws each from its value after the
 * container's content was (re)drawn.
 */

const PAGE_STEPS = 10;

/** The page's own Event (a popped-out window has its own). */
function eventOf(element, type) {
    const PageEvent = element.ownerDocument?.defaultView?.Event ?? Event;
    return new PageEvent(type, { bubbles: true });
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export class RangeTrack {
    /**
     * Drags one end of a range with the pointer, from a pointerdown on its handle.
     * @param {PointerEvent} event - The pointerdown.
     * @param {HTMLElement} handle
     * @param {HTMLElement} track
     * @param {object} options
     * @param {number} [options.min] - The track's start value.
     * @param {number} [options.max] - The track's end value.
     * @param {function(number): void} options.set - Called with each new value (the caller clamps against the other end and redraws).
     * @param {function(): void} [options.onEnd] - Called once the pointer is let go.
     */
    static dragEdge(event, handle, track, { min = 0, max = 1, set, onEnd = () => {} }) {
        event.preventDefault();
        handle.setPointerCapture?.(event.pointerId);
        const view = handle.ownerDocument?.defaultView ?? globalThis;
        const onMove = (moveEvent) => {
            const rect = track.getBoundingClientRect();
            if (rect.width <= 0) return;
            const share = clamp((moveEvent.clientX - rect.left) / rect.width, 0, 1);
            set(min + share * (max - min));
        };
        const onUp = (upEvent) => {
            handle.releasePointerCapture?.(upEvent.pointerId);
            view.removeEventListener("pointermove", onMove);
            view.removeEventListener("pointerup", onUp);
            onEnd();
        };
        view.addEventListener("pointermove", onMove);
        view.addEventListener("pointerup", onUp);
    }

    /**
     * A handle's value after a key, or null for a key that does not move it.
     * @param {KeyboardEvent} event
     * @param {number} value
     * @param {{min: number, max: number, step: number}} range
     * @returns {number|null}
     */
    static stepKey(event, value, { min, max, step }) {
        const moves = {
            ArrowLeft: -step,
            ArrowDown: -step,
            ArrowRight: step,
            ArrowUp: step,
            PageDown: -step * PAGE_STEPS,
            PageUp: step * PAGE_STEPS,
        };
        if (event.key === "Home") return min;
        if (event.key === "End") return max;
        if (!(event.key in moves)) return null;
        // Tracks run left to right in every language (as the sliders do), so the arrows do too
        return clamp(value + moves[event.key], min, max);
    }

    // ------------------------------------------------------------------ band fields

    /**
     * Listens on a container for its band fields: their handles' drags and keys, their quick picks
     * and the track's double-click.
     * @param {HTMLElement} root
     */
    static bind(root) {
        root.addEventListener("pointerdown", (event) => {
            const handle = event.target.closest?.("[data-band-edge]");
            const band = handle?.closest("[data-range-band]");
            if (!band || band.hasAttribute("data-disabled")) return;
            handle.focus?.();
            const edge = Number(handle.dataset.bandEdge);
            const range = this.#rangeOf(band);
            this.dragEdge(event, handle, band.querySelector("[data-band-track]"), {
                min: range.min,
                max: range.max,
                set: (value) => this.#setEdge(band, edge, value),
                onEnd: () => this.#commit(band),
            });
        });
        root.addEventListener("keydown", (event) => {
            const handle = event.target.closest?.("[data-band-edge]");
            const band = handle?.closest("[data-range-band]");
            if (!band || band.hasAttribute("data-disabled")) return;
            const edge = Number(handle.dataset.bandEdge);
            const value = this.stepKey(event, this.valueOf(band)[edge], this.#rangeOf(band));
            if (value === null) return;
            event.preventDefault();
            this.#setEdge(band, edge, value);
            this.#commit(band);
        });
        root.addEventListener("click", (event) => {
            const pick = event.target.closest?.("[data-band-zone]");
            const band = pick?.closest("[data-range-band]");
            if (!band) return;
            event.preventDefault();
            const [lo, hi] = pick.dataset.bandZone.split(",").map(Number);
            this.#write(band, [lo, hi]);
            this.#commit(band);
        });
        root.addEventListener("dblclick", (event) => {
            const band = event.target.closest?.("[data-range-band]");
            if (!band || !event.target.closest("[data-band-track]")) return;
            const { min, max } = this.#rangeOf(band);
            const [lo, hi] = this.valueOf(band);
            if (lo === min && hi === max) return;
            this.#write(band, [min, max]);
            this.#commit(band);
        });
    }

    /** Draws every band field in a container from its value. */
    static syncAll(root) {
        for (const band of root.querySelectorAll("[data-range-band]")) this.sync(band);
    }

    /** A band field's value as [lo, hi]; the whole track when it holds none. */
    static valueOf(band) {
        const { min, max } = this.#rangeOf(band);
        const parts = (band.querySelector("input[type=hidden]")?.value ?? "").split(",").map(Number);
        if (parts.length !== 2 || !parts.every(Number.isFinite)) return [min, max];
        return [clamp(Math.min(...parts), min, max), clamp(Math.max(...parts), min, max)];
    }

    /**
     * Draws a band field: its fill and handles at their places, the handles' values for assistive
     * technology, and the reading (each end through the field's own format; an end at the track's
     * end reads as the track's end word).
     */
    static sync(band) {
        const { min, max } = this.#rangeOf(band);
        const [lo, hi] = this.valueOf(band);
        const at = (value) => `${((value - min) / (max - min || 1)) * 100}%`;
        const fill = band.querySelector(".fwmb-rule-fill");
        if (fill) {
            fill.style.left = at(lo);
            fill.style.width = `${((hi - lo) / (max - min || 1)) * 100}%`;
        }
        band.querySelectorAll("[data-band-edge]").forEach((handle) => {
            const value = Number(handle.dataset.bandEdge) === 0 ? lo : hi;
            handle.style.left = at(value);
            handle.setAttribute("aria-valuemin", String(min));
            handle.setAttribute("aria-valuemax", String(max));
            handle.setAttribute("aria-valuenow", String(value));
            handle.setAttribute("aria-valuetext", this.#format(band, value));
        });
        const reading = band.querySelector("[data-band-reading]");
        if (reading) reading.textContent = lo === min && hi === max ? band.dataset.anyLabel ?? "" : `${this.#format(band, lo)} – ${this.#format(band, hi)}`;
    }

    static #rangeOf(band) {
        const number = (value, fallback) => (Number.isFinite(Number(value)) && value !== "" && value !== undefined ? Number(value) : fallback);
        const min = number(band.dataset.min, 0);
        const max = number(band.dataset.max, 1);
        return { min, max, step: number(band.dataset.step, (max - min) / 100) };
    }

    /** One end moved, never past the other; rounded to the field's step. */
    static #setEdge(band, edge, value) {
        const { min, step } = this.#rangeOf(band);
        const [lo, hi] = this.valueOf(band);
        const stepped = min + Math.round((value - min) / step) * step;
        const rounded = Number(stepped.toFixed(6));
        this.#write(band, edge === 0 ? [Math.min(rounded, hi), hi] : [lo, Math.max(rounded, lo)]);
    }

    static #write(band, [lo, hi]) {
        const input = band.querySelector("input[type=hidden]");
        if (input) input.value = `${lo},${hi}`;
        this.sync(band);
    }

    static #commit(band) {
        band.querySelector("input[type=hidden]")?.dispatchEvent(eventOf(band, "change"));
    }

    /** A value as the field reads it: a percentage of the track (data-format="percent"), or the number. */
    static #format(band, value) {
        const { min, max } = this.#rangeOf(band);
        if (value <= min && band.dataset.startLabel) return band.dataset.startLabel;
        if (value >= max && band.dataset.endLabel) return band.dataset.endLabel;
        if (band.dataset.format === "percent") return `${Math.round(value * 100)}%`;
        return String(Number(value.toFixed(2)));
    }
}
