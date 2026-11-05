/**
 * Sliders on a power curve: the slider's position runs evenly from 0 to 1, and the value it sets
 * is the position raised to a power (the curve), so the low end, where a setting's effect changes
 * fastest, takes more of the slider's travel. Coastline Fracture is one: its visible effect
 * (coastline length, how many islands) grows fastest near 0, and against the square of the
 * position it grows by about the same amount per step over the whole range.
 *
 * Such a slider (the shared-range partial's `curve`, see templates/parts/shared-range.hbs) holds
 * its position in `value` and the setting's exact value in `data-value`, which is what is read
 * and saved (see MapStateManager.getMapParameters). A position cannot always land on a stored
 * value exactly (0.1 is position 0.316...), so `data-value` keeps the stored value for as long as
 * the slider sits at that value's position; only a move to another position works out a new one.
 * A map opened and saved without touching the slider therefore keeps its value to the last digit.
 */
export class RangeCurve {
    /** The decimals a curved slider's value is rounded to (what it shows and saves). */
    static DECIMALS = 3;

    /**
     * The value a position sets.
     * @param {number} position - 0 to 1.
     * @param {number} curve - The power.
     * @returns {number}
     */
    static valueAt(position, curve) {
        const value = Math.max(0, Number(position) || 0) ** curve;
        return Number(value.toFixed(RangeCurve.DECIMALS));
    }

    /**
     * The position a value sits at.
     * @param {number} value
     * @param {number} curve - The power.
     * @returns {number}
     */
    static positionOf(value, curve) {
        return Math.max(0, Number(value) || 0) ** (1 / curve);
    }

    /** Whether an input is a curved slider. */
    static isCurved(input) {
        return input?.type === "range" && Number.parseFloat(input.dataset?.curve) > 0;
    }

    /**
     * A curved slider's value, after it has moved: the stored value while the slider still sits
     * at that value's position (within half a step), or the value of its new position.
     * @param {HTMLInputElement} input
     * @returns {number}
     */
    static settle(input) {
        const curve = Number.parseFloat(input.dataset.curve);
        const position = Number.parseFloat(input.value);
        const stored = Number.parseFloat(input.dataset.value);
        const step = Number.parseFloat(input.step) || 0.01;
        const value = Number.isFinite(stored) && Math.abs(RangeCurve.positionOf(stored, curve) - position) < step / 2 ? stored : RangeCurve.valueAt(position, curve);
        input.dataset.value = String(value);
        return value;
    }

    /**
     * Moves a curved slider to a value, as a double-click reset does: its position goes to the
     * nearest step, and its value is the one asked for.
     * @param {HTMLInputElement} input
     * @param {number} value
     */
    static setValue(input, value) {
        input.dataset.value = String(value);
        input.value = String(RangeCurve.positionOf(value, Number.parseFloat(input.dataset.curve)));
    }

    /** What a slider holds as its setting's value: `data-value` on a curved slider, else its own. */
    static read(input) {
        return RangeCurve.isCurved(input) ? input.dataset.value : input.value;
    }
}
