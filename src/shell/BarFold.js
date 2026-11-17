/**
 * The context bar's folding (see parts/edit-map-tools.hbs). The bar is one row at every width the
 * studio supports and never wraps; when its contents are wider than the room it has, it folds in a
 * fixed order, each level keeping what the one before gave up:
 *
 * - 0: everything shown;
 * - 1: the least-used modes (marked data-fold-rank, from STUDIO.FOLD_RANK) move into More;
 * - 2: the modes not in use show their icon only;
 * - 3: the sliders' labels give way to icons.
 *
 * The mode in use is never folded and keeps its label, and the state readout always stays. The
 * templates draw every form, and the stylesheet shows the one for the bar's data-fold, so a fold
 * never redraws the bar.
 */
export const FOLD_LEVELS = 4;

/**
 * The least fold level at which the bar fits: the first whose width is within the room available,
 * or the last when none is.
 *
 * @param {number[]} widths - The bar's natural width at each fold level, from 0 up.
 * @param {number} available - The room the bar has.
 * @returns {number}
 */
export function foldLevel(widths, available) {
    const fits = widths.findIndex((width) => width <= available);
    return fits === -1 ? widths.length - 1 : fits;
}

/**
 * The width an element's contents need, laid out in one row with nothing stretched: its children's
 * widths (the bar's main part measured by its own children, since it is what clips), the gaps
 * between them and its inline padding.
 */
function naturalWidth(element) {
    const view = element.ownerDocument.defaultView;
    const style = view.getComputedStyle(element);
    const gap = Number.parseFloat(style.columnGap) || 0;
    let total = (Number.parseFloat(style.paddingInlineStart) || 0) + (Number.parseFloat(style.paddingInlineEnd) || 0);
    let shown = 0;
    for (const child of element.children) {
        const width = child.classList.contains("fwmb-bar-main") ? naturalWidth(child) : child.getBoundingClientRect().width;
        if (width === 0) continue;
        total += width;
        shown++;
    }
    return total + gap * Math.max(0, shown - 1);
}

/**
 * The bar's natural width at each fold level, measured by showing each in turn. The browser does
 * not paint in between, so the measuring is never seen.
 *
 * @param {HTMLElement} bar - The context bar (.fwmb-edit-toolbar).
 * @returns {number[]}
 */
export function measureFoldWidths(bar) {
    const widths = [];
    for (let level = 0; level < FOLD_LEVELS; level++) {
        bar.dataset.fold = String(level);
        widths.push(naturalWidth(bar));
    }
    return widths;
}

/**
 * Folds the bar as far as it needs to fit the room it has, and returns the level chosen.
 *
 * @param {HTMLElement} bar - The context bar.
 * @returns {number}
 */
export function applyBarFold(bar) {
    const room = bar.clientWidth;
    const level = foldLevel(measureFoldWidths(bar), room);
    bar.dataset.fold = String(level);
    return level;
}

/**
 * The arrow keys move between the modes of a radio group on the bar, wrapping round at either end
 * and skipping modes the fold has hidden or that are disabled. Focus moves; Space or Enter chooses.
 *
 * @param {KeyboardEvent} event
 * @returns {boolean} Whether the key was used.
 */
export function moveAlongModes(event) {
    const current = event.target.closest?.('.fwmb-modes [role="radio"]');
    if (!current) return false;
    const rtl = current.ownerDocument.defaultView.getComputedStyle(current).direction === "rtl";
    const steps = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1, ArrowDown: 1, ArrowUp: -1 };
    if (!(event.key in steps)) return false;
    const modes = [...current.closest(".fwmb-modes").querySelectorAll('[role="radio"]')].filter((mode) => !mode.disabled && mode.getClientRects().length > 0);
    const index = modes.indexOf(current);
    modes[(index + steps[event.key] + modes.length) % modes.length]?.focus();
    return true;
}
