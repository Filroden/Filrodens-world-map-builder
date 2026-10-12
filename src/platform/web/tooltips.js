/**
 * Tooltips on the web, in place of Foundry's tooltip manager: shows an element's data-tooltip
 * text after the pointer has rested on it briefly, below the element (or above it when there is
 * no room below), for every element inside the page's frame, the studio's dialogues included.
 *
 * The element is the one Foundry uses (#tooltip with the fwmb-tooltip class), so the module's
 * tooltip styles apply unchanged; web-base.css gives it the positioning Foundry's core stylesheet
 * gives it there. It is appended to <body> and fixed-positioned, so it shows above the studio and
 * above any dialogue inside it.
 *
 * The attribute is read as plain text (templates already localise it), as Foundry treats
 * data-tooltip; nothing is parsed as HTML.
 */

/** How long the pointer rests on an element before its tooltip shows (about what Foundry waits). */
const SHOW_DELAY_MS = 500;
/** Gap between the element and the tooltip. */
const OFFSET_PX = 8;
/** Closest the tooltip comes to the edge of the viewport. */
const EDGE_MARGIN_PX = 4;

export class WebTooltips {
    #root;
    #element;
    #target = null;
    #timer = null;

    /**
     * @param {HTMLElement} root - The element whose descendants' data-tooltip attributes are shown.
     */
    constructor(root) {
        this.#root = root;
        this.#element = document.getElementById("tooltip") ?? WebTooltips.#createElement();
        root.addEventListener("pointerover", this.#onPointerOver);
        root.addEventListener("pointerout", this.#onPointerOut);
        root.addEventListener("pointerdown", this.#hide);
        window.addEventListener("scroll", this.#hide, true);
    }

    static #createElement() {
        const element = document.createElement("aside");
        element.id = "tooltip";
        element.className = "fwmb-tooltip";
        element.setAttribute("role", "tooltip");
        element.hidden = true;
        document.body.append(element);
        return element;
    }

    #onPointerOver = (event) => {
        const target = event.target.closest?.("[data-tooltip]");
        if (!target || target === this.#target || !this.#root.contains(target)) return;
        this.#hide();
        this.#target = target;
        this.#timer = setTimeout(() => this.#show(target), SHOW_DELAY_MS);
    };

    #onPointerOut = (event) => {
        if (!this.#target) return;
        // Moving between children of the same element is not leaving it
        if (event.relatedTarget instanceof Node && this.#target.contains(event.relatedTarget)) return;
        this.#hide();
    };

    #show(target) {
        if (!target.isConnected) return;
        const text = target.dataset.tooltip;
        if (!text) return;
        this.#element.textContent = text;
        this.#element.hidden = false;
        this.#place(target.getBoundingClientRect(), this.#element.getBoundingClientRect());
    }

    /** Centres the tooltip under the element, flips it above when it would leave the viewport, and keeps it on screen sideways. */
    #place(anchor, tip) {
        const maxLeft = window.innerWidth - tip.width - EDGE_MARGIN_PX;
        const left = Math.min(Math.max(anchor.left + anchor.width / 2 - tip.width / 2, EDGE_MARGIN_PX), maxLeft);
        const below = anchor.bottom + OFFSET_PX;
        const fitsBelow = below + tip.height <= window.innerHeight - EDGE_MARGIN_PX;
        const top = fitsBelow ? below : Math.max(anchor.top - OFFSET_PX - tip.height, EDGE_MARGIN_PX);
        this.#element.style.left = `${left}px`;
        this.#element.style.top = `${top}px`;
    }

    #hide = () => {
        clearTimeout(this.#timer);
        this.#timer = null;
        this.#target = null;
        this.#element.hidden = true;
    };

    destroy() {
        this.#hide();
        this.#root.removeEventListener("pointerover", this.#onPointerOver);
        this.#root.removeEventListener("pointerout", this.#onPointerOut);
        this.#root.removeEventListener("pointerdown", this.#hide);
        window.removeEventListener("scroll", this.#hide, true);
    }
}
