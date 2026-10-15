/**
 * A dialogue drawn inside the studio: a <dialog> element appended to a host element (the studio's
 * root), in one of two placements:
 *
 * - "modal": centred over a scrim that covers the studio, so nothing behind it can be used until
 *   the dialogue is closed.
 * - "docked": a panel along the end edge of the studio, with no scrim, so the map and the rest of
 *   the studio stay usable while it is open.
 *
 * The <dialog> is opened with show(), never showModal(). showModal() moves the dialogue into the
 * browser's top layer, above everything else on the page: in Foundry that includes the tooltip
 * element, other windows and the notification area, so tooltips inside the dialogue would not
 * appear and no other window could be raised above it. With show(), the dialogue stays inside the
 * studio's own element and stacks with the window it belongs to; the modal placement supplies its
 * own scrim, and focus is kept inside the dialogue by hand (both of which the top layer would have
 * done).
 *
 * The dialogue's content is wrapped in a <form>, which the buttons' callbacks read from. A button
 * press resolves open()'s promise with the button's callback result (its action when it has no
 * callback); closing the dialogue any other way (Escape, the close control, or the host going away)
 * resolves it with the `dismissed` value.
 *
 * Buttons are drawn in the order given. By convention the negative choices come first and the
 * positive one last, so in a left-to-right language it sits on the right; the button row follows
 * the text direction, so a right-to-left language mirrors it.
 *
 * A modal dialogue opens centred (by CSS) and can be moved by dragging its header, within the
 * host. The first move or resize fixes its position as an offset in the host, so from then on a
 * resize grows the dialogue from its fixed corner with the pointer, instead of around its centre.
 */

/** What Tab moves between: the controls a keyboard user can reach. */
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Single-line fields in which Enter confirms the dialogue (as it submits a form in a page). */
const ENTER_SUBMITS = new Set(["text", "number", "search", "email", "url", "tel", "password"]);

/** How near a bottom corner (in pixels) a press counts as taking hold of the resize handle. */
const RESIZE_CORNER = 18;

/** The space (in pixels) a placed dialogue leaves below itself when it can, as the CSS does. */
const EDGE_GAP = 16;

/** The dialogues open in each host, so they can all be dismissed when the host goes away. */
const openByHost = new WeakMap();

/** Gives each dialogue's title a unique id for aria-labelledby. */
let titleCount = 0;

/**
 * @typedef {object} OverlayButton
 * @property {string} action - Identifies the button; open() resolves with it when there is no callback.
 * @property {string} label - The button's text (already localised).
 * @property {string} [icon] - An icon class shown before the label.
 * @property {boolean} [default] - The button Enter presses; also styled as the primary button.
 * @property {"positive"|"caution"|"negative"} [tone] - What the button does, which picks its colour:
 *     positive goes ahead, negative gives something up (No, Cancel, Discard), and caution steps
 *     back without losing anything when a negative choice sits beside it. Without one, the button
 *     takes the accent colour.
 * @property {(form: HTMLFormElement) => unknown} [callback] - Reads the result from the dialogue's form.
 */

export class Overlay {
    /**
     * Opens a dialogue in `host`.
     *
     * @param {object} options
     * @param {HTMLElement} options.host - The element the dialogue is drawn in (the studio's root).
     * @param {"modal" | "docked"} [options.placement]
     * @param {string} options.title - The heading (already localised).
     * @param {string} [options.icon] - An icon class shown before the title.
     * @param {string | HTMLElement} options.content - The body: HTML or an element.
     * @param {OverlayButton[]} [options.buttons]
     * @param {string[]} [options.classes] - Classes added to the <dialog> element.
     * @param {boolean} [options.resizable] - Whether the dialogue can be resized by its corner.
     * @param {string} [options.closeLabel] - The close control's accessible name.
     * @param {unknown} [options.dismissed] - What closing without a button resolves with.
     * @param {(element: HTMLDialogElement) => void} [options.onRender] - Runs once the dialogue is in the page.
     * @returns {Promise<unknown>}
     */
    static open(options) {
        return new Promise((resolve) => new Overlay(options, resolve).#show(options.onRender));
    }

    /**
     * Closes every dialogue open in `host` (or only those in one placement), each resolving with its
     * `dismissed` value. For a host that is about to go away, so no caller is left waiting on a
     * dialogue that has gone with it, and for an editor that is only ever open once (a docked
     * editor replacing the one before).
     *
     * @param {HTMLElement} host
     * @param {"modal" | "docked" | null} [placement] - Only dialogues in this placement; null for all.
     */
    static dismissAll(host, placement = null) {
        for (const overlay of [...(openByHost.get(host) ?? [])]) {
            if (!placement || overlay.#placement === placement) overlay.dismiss();
        }
    }

    #host;
    #placement;
    #buttons;
    #dismissed;
    #resolve;
    #dialog;
    #scrim = null;
    #previousFocus = null;

    /** Whether the dialogue has been moved or resized, so its position is fixed (see #place). */
    #placed = false;

    /** Keeps a placed dialogue inside the host when the host changes size. */
    #hostObserver = null;

    constructor({ host, placement = "modal", title, icon, content, buttons = [], classes = [], resizable = false, closeLabel = "Close", dismissed = null }, resolve) {
        this.#host = host;
        this.#placement = placement;
        this.#buttons = buttons;
        this.#dismissed = dismissed;
        this.#resolve = resolve;
        this.#dialog = this.#build({ title, icon, content, classes, resizable, closeLabel });
    }

    /** The dialogue's element (null once it has closed). */
    get element() {
        return this.#dialog.isConnected ? this.#dialog : null;
    }

    #build({ title, icon, content, classes, resizable, closeLabel }) {
        const doc = this.#host.ownerDocument;
        const dialog = doc.createElement("dialog");
        dialog.classList.add("fwmb-overlay", `fwmb-overlay-${this.#placement}`, ...classes);
        if (resizable) dialog.classList.add("fwmb-overlay-resizable");

        const titleId = `fwmb-overlay-title-${++titleCount}`;
        dialog.setAttribute("aria-labelledby", titleId);
        dialog.append(this.#buildHeader(doc, titleId, title, icon, closeLabel), this.#buildBody(doc, content), this.#buildFooter(doc));
        return dialog;
    }

    #buildHeader(doc, titleId, title, icon, closeLabel) {
        const header = doc.createElement("header");
        header.className = "fwmb-overlay-header";
        if (icon) {
            const glyph = doc.createElement("i");
            glyph.className = icon;
            header.append(glyph);
        }

        const heading = doc.createElement("h2");
        heading.id = titleId;
        heading.textContent = title ?? "";

        const close = doc.createElement("button");
        close.type = "button";
        close.className = "fwmb-overlay-close";
        close.dataset.overlayAction = "close";
        close.setAttribute("aria-label", closeLabel);
        close.innerHTML = '<i class="fwmb-icon fwmb-icon--cancel"></i>';

        header.append(heading, close);
        return header;
    }

    /**
     * The content, inside a form. The form is laid out by the module's own stylesheet alone (see
     * .fwmb-overlay-body): it carries none of Foundry's form classes, whose flex rules would size
     * the fields in ways the module's grid and stacked rows do not expect, so a dialogue looks the
     * same in Foundry and on the web. The body scrolls with the module's own scrollbar.
     */
    #buildBody(doc, content) {
        const form = doc.createElement("form");
        form.className = "fwmb-overlay-body fwmb-scrollable";
        form.method = "dialog";
        if (typeof content === "string") form.innerHTML = content;
        else if (content) form.append(content);
        // The body scrolls up and down only. It hides any sideways overflow, but focusing a field
        // that reaches past its edge still scrolls it sideways (hidden overflow can be scrolled by
        // script and by focus), which would cut off the start of every row; that scroll is undone.
        form.addEventListener("scroll", () => {
            if (form.scrollLeft !== 0) form.scrollLeft = 0;
        });
        return form;
    }

    #buildFooter(doc) {
        const footer = doc.createElement("footer");
        footer.className = "fwmb-overlay-footer";
        for (const button of this.#buttons) {
            const element = doc.createElement("button");
            element.type = "button";
            element.className = "fwmb-btn";
            element.dataset.overlayAction = button.action;
            if (button.default) element.classList.add("fwmb-btn--primary");
            if (button.tone) element.dataset.tone = button.tone;
            if (button.icon) {
                const glyph = doc.createElement("i");
                glyph.className = button.icon;
                element.append(glyph);
            }
            element.append(doc.createTextNode(button.label));
            footer.append(element);
        }
        footer.hidden = this.#buttons.length === 0;
        return footer;
    }

    #show(onRender) {
        this.#previousFocus = this.#host.ownerDocument.activeElement;
        if (this.#placement === "modal") {
            this.#scrim = this.#host.ownerDocument.createElement("div");
            this.#scrim.className = "fwmb-overlay-scrim";
            this.#host.append(this.#scrim);
        }
        this.#host.append(this.#dialog);
        this.#dialog.addEventListener("click", this.#onClick);
        this.#dialog.addEventListener("keydown", this.#onKeydown);
        this.#dialog.addEventListener("submit", this.#onSubmit);
        if (this.#placement === "modal") this.#makeMovable();
        this.#dialog.show();

        if (!openByHost.has(this.#host)) openByHost.set(this.#host, new Set());
        openByHost.get(this.#host).add(this);

        onRender?.(this.#dialog);
        this.#focusFirst();
    }

    /** Focus goes to the first field, or failing that the default button, then any control. */
    #focusFirst() {
        const field = this.#dialog.querySelector(".fwmb-overlay-body :is(input, select, textarea):not([disabled], [type='hidden'])");
        const target = field ?? this.#dialog.querySelector(".fwmb-overlay-footer .fwmb-btn--primary") ?? this.#dialog.querySelector(FOCUSABLE);
        target?.focus();
    }

    /** Lets the header move the dialogue, and a resize start from where the dialogue is. */
    #makeMovable() {
        this.#dialog.querySelector(".fwmb-overlay-header").addEventListener("pointerdown", this.#onHeaderPointerDown);
        this.#dialog.addEventListener("pointerdown", this.#onCornerPointerDown);
        const ResizeObserver = this.#host.ownerDocument.defaultView?.ResizeObserver;
        if (!ResizeObserver) return;
        this.#hostObserver = new ResizeObserver(() => {
            if (this.#placed) this.#moveTo(this.#dialog.offsetLeft, this.#dialog.offsetTop);
        });
        this.#hostObserver.observe(this.#host);
    }

    /** Fixes the dialogue where it is now, as an offset in the host, instead of centring it. */
    #place() {
        if (this.#placed) return;
        const box = this.#dialog.getBoundingClientRect();
        const host = this.#host.getBoundingClientRect();
        this.#placed = true;
        this.#dialog.classList.add("fwmb-overlay-placed");
        this.#moveTo(box.left - host.left - this.#host.clientLeft, box.top - host.top - this.#host.clientTop);
    }

    /**
     * Moves a placed dialogue to an offset in the host, kept inside the host. Its size is limited
     * to the space between there and the host's far edges (leaving a gap below where there is
     * room), but never below its current size, so moving it never squeezes it.
     */
    #moveTo(left, top) {
        const { offsetWidth: width, offsetHeight: height } = this.#dialog;
        const { clientWidth: hostWidth, clientHeight: hostHeight } = this.#host;
        const x = Math.min(Math.max(0, left), Math.max(0, hostWidth - width));
        const y = Math.min(Math.max(0, top), Math.max(0, hostHeight - height));
        Object.assign(this.#dialog.style, {
            left: `${x}px`,
            top: `${y}px`,
            maxWidth: `${hostWidth - x}px`,
            maxHeight: `${Math.min(hostHeight - y, Math.max(height, hostHeight - y - EDGE_GAP))}px`,
        });
    }

    /** Dragging the header (but not its close control) moves the dialogue with the pointer. */
    #onHeaderPointerDown = (event) => {
        if (event.button !== 0 || event.target.closest("button")) return;
        event.preventDefault();
        this.#place();

        const header = event.currentTarget;
        const start = { x: event.clientX, y: event.clientY, left: this.#dialog.offsetLeft, top: this.#dialog.offsetTop };
        const onMove = (move) => this.#moveTo(start.left + move.clientX - start.x, start.top + move.clientY - start.y);
        const onEnd = () => {
            header.removeEventListener("pointermove", onMove);
            header.removeEventListener("pointerup", onEnd);
            header.removeEventListener("pointercancel", onEnd);
        };
        header.setPointerCapture?.(event.pointerId);
        header.addEventListener("pointermove", onMove);
        header.addEventListener("pointerup", onEnd);
        header.addEventListener("pointercancel", onEnd);
    };

    /**
     * A press on a bottom corner of a resizable dialogue is the browser's resize handle taking
     * hold. The dialogue is placed first, so the resize moves only the corner being dragged.
     */
    #onCornerPointerDown = (event) => {
        if (this.#placed || !this.#dialog.classList.contains("fwmb-overlay-resizable")) return;
        const box = this.#dialog.getBoundingClientRect();
        const nearBottom = box.bottom - event.clientY <= RESIZE_CORNER;
        const nearSide = box.right - event.clientX <= RESIZE_CORNER || event.clientX - box.left <= RESIZE_CORNER;
        if (nearBottom && nearSide) this.#place();
    };

    #onClick = (event) => {
        const control = event.target.closest?.("[data-overlay-action]");
        if (!control || !this.#dialog.contains(control)) return;
        event.preventDefault();
        if (control.dataset.overlayAction === "close") this.dismiss();
        else this.#press(control.dataset.overlayAction);
    };

    /** A submit (Enter in a lone field) counts as the default button; the form never submits itself. */
    #onSubmit = (event) => {
        event.preventDefault();
        this.#pressDefault();
    };

    /**
     * Keys pressed in a dialogue belong to it, so none of them travel on to the page. In Foundry
     * this matters: its keybindings listen on the window and act on any key whose target is not a
     * text field (Tab cycles through tokens on the canvas, Escape closes the top window), and they
     * cancel the browser's own handling when they do. The studio's own shortcuts (undo and redo)
     * stay out of the dialogue too. The dialogue moves focus itself, so Tab works the same whatever
     * has focus and whatever else on the page listens for it.
     */
    #onKeydown = (event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
            event.preventDefault();
            this.dismiss();
        } else if (event.key === "Tab") {
            event.preventDefault();
            this.#moveFocus(event.shiftKey ? -1 : 1);
        } else if (event.key === "Enter" && Overlay.#enterSubmits(event.target)) {
            event.preventDefault();
            this.#pressDefault();
        }
    };

    static #enterSubmits(target) {
        return target?.localName === "input" && ENTER_SUBMITS.has(target.type);
    }

    /** Moves focus to the next (or, with step -1, previous) control, wrapping at either end. */
    #moveFocus(step) {
        const focusable = [...this.#dialog.querySelectorAll(FOCUSABLE)].filter((element) => !element.closest("[hidden]") && element.getClientRects().length > 0);
        if (focusable.length === 0) return;
        const current = focusable.indexOf(this.#host.ownerDocument.activeElement);
        // Nothing in the dialogue focused yet: Tab starts at the first control, Shift+Tab at the last
        let start = current;
        if (current === -1) start = step > 0 ? -1 : 0;
        focusable[(start + step + focusable.length) % focusable.length].focus();
    }

    #pressDefault() {
        const button = this.#buttons.find((candidate) => candidate.default) ?? this.#buttons[0];
        if (button) this.#press(button.action);
    }

    #press(action) {
        const button = this.#buttons.find((candidate) => candidate.action === action);
        if (!button) return;
        const form = this.#dialog.querySelector(".fwmb-overlay-body");
        this.#close(button.callback ? button.callback(form) : action);
    }

    /** Closes the dialogue as Escape would, resolving with its `dismissed` value. */
    dismiss() {
        this.#close(this.#dismissed);
    }

    /** Removes the dialogue (and its scrim), returns focus to where it was and resolves with `value`. */
    #close(value) {
        if (!this.#dialog.isConnected) return;
        this.#dialog.removeEventListener("click", this.#onClick);
        this.#dialog.removeEventListener("keydown", this.#onKeydown);
        this.#dialog.removeEventListener("submit", this.#onSubmit);
        this.#hostObserver?.disconnect();
        this.#dialog.close();
        this.#dialog.remove();
        this.#scrim?.remove();
        openByHost.get(this.#host)?.delete(this);

        if (this.#previousFocus?.isConnected && typeof this.#previousFocus.focus === "function") this.#previousFocus.focus();
        this.#resolve(value);
    }
}
