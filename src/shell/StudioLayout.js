import { applyBarFold } from "./BarFold.js";
import { mustFoldMapControls } from "./MapControls.js";

/**
 * The studio's layout rules that depend on the room it is given rather than on the viewport.
 *
 * In Foundry the studio sits in a window that can be much narrower than the screen, so a media
 * query cannot see how much room it has. These observers measure the studio itself and write what
 * they find as attributes and custom properties, and the stylesheet does the rest:
 *
 * - `data-fwmb-width` on the studio: `wide` (1,400px or more), `compact` (1,200 to 1,399px: the
 *   compact rail, panel and inspector widths) or `narrow` (below 1,200px: the same widths; kept
 *   for rules that need the narrowest studio).
 * - `data-fwmb-short` on the studio while the whole rail would not fit its height: the rail folds
 *   its occasional tools into More (`""`), and should that still not fit, its file actions too
 *   (`"files"`). Help, last, never folds. The rail is measured rather than given a fixed height,
 *   since its length depends on the host (full screen on the web) and the width (stage names).
 * - `--fwmb-controls-w` on the map preview: the map controls' width (bottom end), which the hint
 *   (bottom start) leaves free beside it.
 * - `--fwmb-hint-h` on the map preview: the hint's height, which the information bar (top start)
 *   stops short of.
 * - `--fwmb-history-w` on the map preview: undo/redo's width (top end), which the information bar
 *   leaves free beside it.
 * - `--fwmb-end-inset` on the map preview should a docked panel ever lie over the canvas's end
 *   edge: how far the end-edge overlays (undo/redo, map controls) move to stay clear of it. The
 *   inspector takes its own column at every width, so today this stays at its resting value.
 * - `data-fold` on the map controls when their full row does not fit beside the hint at its
 *   narrowest: the layer toggles give way to the Layers menu.
 * - `data-fold` on the context bar (0 to 3): how far it folds to stay on one row (see BarFold).
 * - `--fwmb-layer-menu-max` on the map preview: the height the map controls' menus may take
 *   before they scroll, which is the room above the controls.
 *
 * The panel and inspector stacking their fields (at 17.5rem or less) are container queries and
 * need nothing from here. Lengths written here are measured pixels, so they follow the page's zoom
 * and Foundry's interface scale as the rem lengths around them do.
 */
export const STUDIO_WIDTH = Object.freeze({ COMPACT_BELOW: 1400, NARROW_BELOW: 1200 });

/** How far the rail folds, least first: nothing, the occasional tools, then the file actions too. */
export const RAIL_FOLDS = Object.freeze([null, "", "files"]);

/** The space kept between the canvas overlays, and between them and the canvas edge, in rem. */
const OVERLAY_GAP_REM = 0.5;

/** The narrowest the hint gets beside the map controls, in rem (see .fwmb-map-hint). */
const HINT_MIN_REM = 10;

/**
 * The width class for a studio width in CSS pixels.
 * @param {number} width
 * @returns {"wide"|"compact"|"narrow"}
 */
export function widthClass(width) {
    if (width >= STUDIO_WIDTH.COMPACT_BELOW) return "wide";
    return width >= STUDIO_WIDTH.NARROW_BELOW ? "compact" : "narrow";
}

/**
 * How far the rail folds: the least fold it fits at, or the most if it fits at none.
 * @param {(fold: string|null) => boolean} overflowsAt - Whether the rail overflows at a fold.
 * @returns {string|null} The `data-fwmb-short` value, null for none.
 */
export function railFold(overflowsAt) {
    const most = RAIL_FOLDS.at(-1);
    return RAIL_FOLDS.find((fold) => fold === most || !overflowsAt(fold));
}

export class StudioLayout {
    #root;
    #resize = null;
    #mutations = null;
    #observed = new Set();

    /** @param {HTMLElement} root - The studio (`.fwmb-studio`). */
    constructor(root) {
        this.#root = root;
    }

    /** Starts measuring, and measures once at once. Safe to call again after the map is drawn. */
    start() {
        const view = this.#root.ownerDocument.defaultView;
        if (!this.#resize && view?.ResizeObserver) {
            this.#resize = new view.ResizeObserver(() => this.update());
            // Docked panels come and go as children of the studio
            this.#mutations = new view.MutationObserver(() => this.#observeAll());
            this.#mutations.observe(this.#root, { childList: true });
        }
        this.#observeAll();
        this.update();
    }

    stop() {
        this.#resize?.disconnect();
        this.#mutations?.disconnect();
        this.#resize = null;
        this.#mutations = null;
        this.#observed.clear();
    }

    /** Observes the studio and every part whose size the layout depends on. */
    #observeAll() {
        if (!this.#resize) return;
        // The map controls are not watched: their width changes only when this folds them. The
        // hint is, since its height changes with the tool and mode
        const targets = [this.#root, this.#preview, this.#hint, this.#bar, ...this.#dockedPanels];
        for (const target of targets) {
            if (target && !this.#observed.has(target)) {
                this.#resize.observe(target);
                this.#observed.add(target);
            }
        }
        for (const target of [...this.#observed]) {
            if (!target.isConnected) {
                this.#resize.unobserve(target);
                this.#observed.delete(target);
            }
        }
        this.update();
    }

    get #preview() {
        return this.#root.querySelector(".fwmb-map-preview");
    }

    get #hint() {
        return this.#root.querySelector(".fwmb-map-hint");
    }

    get #bar() {
        return this.#root.querySelector(".fwmb-edit-toolbar");
    }

    get #controls() {
        return this.#root.querySelector(".fwmb-map-controls");
    }

    get #history() {
        return this.#root.querySelector(".fwmb-map-history");
    }

    get #dockedPanels() {
        return [...this.#root.querySelectorAll(":scope > .fwmb-overlay-docked")];
    }

    /** Measures and writes every rule. */
    update() {
        const root = this.#root;
        if (!root.isConnected) return;
        const { width } = root.getBoundingClientRect();
        // A studio not laid out yet (a window still opening) measures 0; nothing to decide yet
        if (width === 0) return;

        setAttribute(root, "data-fwmb-width", widthClass(width));
        this.#foldRail();

        const bar = this.#bar;
        if (bar && bar.offsetParent !== null) applyBarFold(bar);

        const preview = this.#preview;
        if (!preview) return;
        const gap = OVERLAY_GAP_REM * Number.parseFloat(root.ownerDocument.defaultView.getComputedStyle(root.ownerDocument.documentElement).fontSize);

        this.#updateEndInset(preview, gap);
        this.#foldControls(preview, gap);

        // The hint leaves the map controls their room, and the information bar stops above the hint
        const controls = this.#controls;
        if (controls) setProperty(preview, "--fwmb-controls-w", `${Math.ceil(controls.getBoundingClientRect().width)}px`);
        const hint = this.#hint;
        if (hint) setProperty(preview, "--fwmb-hint-h", `${Math.ceil(hint.getBoundingClientRect().height)}px`);
        // The information bar narrows before it would reach undo/redo, beside it at the top
        const history = this.#history;
        if (history) setProperty(preview, "--fwmb-history-w", `${Math.ceil(history.getBoundingClientRect().width)}px`);

        // The map controls' menus open upward and scroll once they would pass the canvas's top
        if (controls) {
            const room = preview.getBoundingClientRect().height - controls.getBoundingClientRect().height - 3 * gap;
            setProperty(preview, "--fwmb-layer-menu-max", `${Math.max(0, Math.floor(room))}px`);
        }
    }

    /**
     * Folds the rail as far as it must to fit the studio's height (see railFold). Each fold is
     * tried and measured in turn within this one task, so only the last is ever drawn.
     */
    #foldRail() {
        const root = this.#root;
        const rail = root.querySelector(".fwmb-toolbar");
        // A rail not laid out (hidden, or no layout at all) keeps its fold
        if (!rail || rail.clientHeight === 0) return;
        const at = (fold) => {
            if (fold === null) root.removeAttribute("data-fwmb-short");
            else root.setAttribute("data-fwmb-short", fold);
        };
        const fold = railFold((fold) => {
            at(fold);
            return rail.scrollHeight > rail.clientHeight + 1;
        });
        at(fold);
    }

    /**
     * A docked panel that overlaps the canvas pushes the end-edge overlays clear of it: they sit
     * the overlap plus the usual gap from the canvas's end edge.
     */
    #updateEndInset(preview, gap) {
        const canvas = preview.getBoundingClientRect();
        const rtl = preview.ownerDocument.defaultView.getComputedStyle(preview).direction === "rtl";
        let overlap = 0;
        for (const panel of this.#dockedPanels) {
            const box = panel.getBoundingClientRect();
            if (box.width === 0 || box.bottom <= canvas.top || box.top >= canvas.bottom) continue;
            overlap = Math.max(overlap, rtl ? box.right - canvas.left : canvas.right - box.left);
        }
        if (overlap > 0) {
            setProperty(preview, "--fwmb-end-inset", `${Math.ceil(overlap + gap)}px`);
            preview.classList.add("fwmb-map-preview--covered-end");
        } else {
            preview.style.removeProperty("--fwmb-end-inset");
            preview.classList.remove("fwmb-map-preview--covered-end");
        }
    }

    /**
     * Folds the map controls' layer toggles into the Layers menu when the full row does not fit
     * beside the hint at its narrowest. The full row is measured unfolded (no paint happens in
     * between, so nothing flickers).
     */
    #foldControls(preview, gap) {
        const controls = this.#controls;
        if (!controls || controls.offsetParent === null) return;
        const wasFolded = controls.hasAttribute("data-fold");
        if (wasFolded) controls.removeAttribute("data-fold");
        const wideWidth = controls.getBoundingClientRect().width;
        const hintWidth = HINT_MIN_REM * (gap / OVERLAY_GAP_REM);
        const endInset = Number.parseFloat(preview.style.getPropertyValue("--fwmb-end-inset")) || gap;
        const room = preview.getBoundingClientRect().width - gap - hintWidth - endInset - gap;
        if (mustFoldMapControls(wideWidth, room)) controls.setAttribute("data-fold", "");
    }
}

/** Sets an attribute only when it changes, so the observers are not woken by their own writes. */
function setAttribute(element, name, value) {
    if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}

function setProperty(element, name, value) {
    if (element.style.getPropertyValue(name) !== value) element.style.setProperty(name, value);
}
