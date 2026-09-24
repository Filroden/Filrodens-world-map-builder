/**
 * Keeps a range slider's value display and its filled portion in step with the slider.
 *
 * The tool panels draw each slider with the shared-range partial (templates/parts/shared-range.hbs),
 * which puts the value in an <output> above the slider inside a .fwmb-range wrapper; the compact
 * sliders in the edit toolbar and in dialogues put it after the slider inside a
 * .fwmb-slider-group. Either way the <output> is found through the nearest of those two wrappers,
 * so neither layout depends on the other's element order.
 *
 * main.js calls this for every slider inside an FWMB window or dialogue, so no template needs its
 * own inline handler to keep its value display current.
 *
 * The filled portion of the track (from the minimum up to the thumb) is drawn in CSS from a
 * custom property, --fwmb-range-fill, holding the thumb's position as a percentage. Only Firefox
 * can colour that portion of a native range input by itself (::-moz-range-progress); Chromium,
 * which Foundry's desktop app runs on, cannot, so the percentage has to be supplied from here
 * and refreshed whenever the value changes.
 *
 * Nothing here touches Foundry globals, so it works on any element tree.
 */
export class RangeDisplay {
    static #WRAPPER_SELECTOR = ".fwmb-range, .fwmb-slider-group";
    static #FILL_PROPERTY = "--fwmb-range-fill";
    static #FULL_PERCENT = 100;
    // What a range input uses as its maximum when none is set (the HTML default)
    static #DEFAULT_MAX = 100;

    /**
     * Refreshes one slider's value display and filled portion from its current value.
     *
     * @param {HTMLInputElement} input - A range input.
     */
    static sync(input) {
        const output = input.closest(RangeDisplay.#WRAPPER_SELECTOR)?.querySelector("output");
        if (output) output.value = input.value;

        input.style.setProperty(RangeDisplay.#FILL_PROPERTY, `${RangeDisplay.#fillPercent(input)}%`);
    }

    /**
     * Sets the filled portion of every range slider inside an element, without touching their
     * value displays (which the template has already written, possibly formatted).
     *
     * @param {HTMLElement} root - The element to search, such as the application's root element.
     */
    static syncAllFills(root) {
        for (const input of root.querySelectorAll('input[type="range"]')) {
            input.style.setProperty(RangeDisplay.#FILL_PROPERTY, `${RangeDisplay.#fillPercent(input)}%`);
        }
    }

    /**
     * How far along its track a slider's thumb sits, from 0 at its minimum to 100 at its maximum.
     * A slider whose minimum and maximum are equal reads as empty rather than dividing by zero.
     */
    static #fillPercent(input) {
        const min = Number.parseFloat(input.min) || 0;
        const max = Number.parseFloat(input.max);
        const value = Number.parseFloat(input.value);
        const span = (Number.isNaN(max) ? RangeDisplay.#DEFAULT_MAX : max) - min;
        if (span <= 0 || Number.isNaN(value)) return 0;

        const fraction = Math.min(1, Math.max(0, (value - min) / span));
        return fraction * RangeDisplay.#FULL_PERCENT;
    }
}
