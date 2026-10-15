import { mustFoldMapControls } from "./MapControls.js";

/**
 * The studio's layout rules that depend on the room it is given rather than on the viewport.
 *
 * In Foundry the studio sits in a window that can be much narrower than the screen, so a media
 * query cannot see how much room it has. These observers measure the studio itself and write what
 * they find as attributes and custom properties, and the stylesheet does the rest:
 *
 * - `data-fwmb-width` on the studio: `wide` (1,400px or more), `compact` (1,200 to 1,399px: the
 *   compact rail, panel and inspector widths) or `narrow` (below 1,200px: the inspector lies over
 *   the canvas as well).
 * - `data-fwmb-short` on the studio while it is less than 680px high: the rail folds its
 *   occasional tools into More.
 * - `--fwmb-readout-w` on the map preview: the information bar's width, which the hint (top end)
 *   leaves free beside it.
 * - `--fwmb-end-inset` on the map preview while a docked panel lies over the canvas's end edge:
 *   how far the end-edge overlays (hint, undo/redo) move to stay clear of it.
 * - `data-fold` on the map controls when their full row does not fit beside undo/redo: the layer
 *   toggles give way to the Layers menu.
 * - `--fwmb-layer-menu-max` on the map preview: the height the map controls' menus may take
 *   before they scroll, which is the room above the controls.
 *
 * The panel and inspector stacking their fields (at 17.5rem or less) are container queries and
 * need nothing from here. Lengths written here are measured pixels, so they follow the page's zoom
 * and Foundry's interface scale as the rem lengths around them do.
 */
export const STUDIO_WIDTH = Object.freeze({ COMPACT_BELOW: 1400, NARROW_BELOW: 1200 });
export const STUDIO_SHORT_BELOW = 680;

/** The space kept between the canvas overlays, and between them and the canvas edge, in rem. */
const OVERLAY_GAP_REM = 0.5;

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
 * Whether a studio height in CSS pixels is short enough for the rail to fold its occasional tools.
 * @param {number} height
 * @returns {boolean}
 */
export function isShort(height) {
    return height < STUDIO_SHORT_BELOW;
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
        // The map controls are not watched: their width changes only when this folds them
        const targets = [this.#root, this.#preview, this.#readout, ...this.#dockedPanels];
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

    get #readout() {
        return this.#root.querySelector(".fwmb-canvas-readout");
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
        const { width, height } = root.getBoundingClientRect();
        // A studio not laid out yet (a window still opening) measures 0; nothing to decide yet
        if (width === 0) return;

        setAttribute(root, "data-fwmb-width", widthClass(width));
        if (isShort(height)) setAttribute(root, "data-fwmb-short", "");
        else root.removeAttribute("data-fwmb-short");

        const preview = this.#preview;
        if (!preview) return;
        const gap = OVERLAY_GAP_REM * Number.parseFloat(root.ownerDocument.defaultView.getComputedStyle(root.ownerDocument.documentElement).fontSize);

        const readout = this.#readout;
        if (readout) setProperty(preview, "--fwmb-readout-w", `${Math.ceil(readout.getBoundingClientRect().width)}px`);

        this.#updateEndInset(preview, gap);
        this.#foldControls(preview, gap);

        // The map controls' menus open upward and scroll once they would pass the canvas's top
        const controls = this.#controls;
        if (controls) {
            const room = preview.getBoundingClientRect().height - controls.getBoundingClientRect().height - 3 * gap;
            setProperty(preview, "--fwmb-layer-menu-max", `${Math.max(0, Math.floor(room))}px`);
        }
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
     * between the canvas's start edge and undo/redo. The full row is measured unfolded (no paint
     * happens in between, so nothing flickers).
     */
    #foldControls(preview, gap) {
        const controls = this.#controls;
        if (!controls || controls.offsetParent === null) return;
        const wasFolded = controls.hasAttribute("data-fold");
        if (wasFolded) controls.removeAttribute("data-fold");
        const wideWidth = controls.getBoundingClientRect().width;
        const historyWidth = this.#history?.getBoundingClientRect().width ?? 0;
        const endInset = Number.parseFloat(preview.style.getPropertyValue("--fwmb-end-inset")) || gap;
        const room = preview.getBoundingClientRect().width - gap - historyWidth - endInset - gap;
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
