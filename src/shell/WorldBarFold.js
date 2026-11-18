import { foldLevel } from "./BarFold.js";

/**
 * The world bar's folding (see templates/shell/worldbar.hbs). The bar is one row at every width the
 * studio supports and never wraps; when its contents are wider than the room it has, it folds in a
 * fixed order, each level keeping what the one before gave up:
 *
 * - 0: full map names;
 * - 1: short names;
 * - 2: Settlement maps leaves the bar for the layer menu;
 * - 3: the layer switcher becomes one menu button naming the map;
 * - 4: the world name ellipsises.
 *
 * Save world, the mode switch and World never fold. The template draws every form and the
 * stylesheet shows the one for the bar's data-fold, so a fold never redraws the bar. The choice is
 * the context bar's (BarFold.foldLevel): the first level whose natural width fits.
 */
export const WORLD_BAR_LEVELS = 5;

/**
 * The bar's natural width at each fold level, measured by laying it out at its content's width
 * (its spacer at none) and showing each level in turn. The browser does not paint in between, so
 * the measuring is never seen.
 *
 * @param {HTMLElement} bar - The world bar (.fwmb-worldbar).
 * @returns {number[]}
 */
export function measureWorldBarWidths(bar) {
    const widths = [];
    bar.classList.add("fwmb-is-measuring");
    try {
        for (let level = 0; level < WORLD_BAR_LEVELS; level++) {
            bar.dataset.fold = String(level);
            widths.push(bar.getBoundingClientRect().width);
        }
    } finally {
        bar.classList.remove("fwmb-is-measuring");
    }
    return widths;
}

/**
 * Folds the bar as far as it needs to fit the studio's width, and returns the level chosen.
 *
 * @param {HTMLElement} bar - The world bar.
 * @param {number} room - The width it has (the studio's).
 * @returns {number}
 */
export function applyWorldBarFold(bar, room) {
    const level = foldLevel(measureWorldBarWidths(bar), room);
    bar.dataset.fold = String(level);
    return level;
}
