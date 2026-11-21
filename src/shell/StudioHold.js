/**
 * Holds a studio while work reads its map (S0 step 7b: an export drawing its tiles from the live
 * canvas, in the dialogue or after Close and keep drawing). While held, the studio's root carries
 * `data-fwmb-exporting`, and every control in it that would change the map or what it shows waits:
 * buttons and menu items are marked aria-disabled, fields are disabled, each with a tooltip saying
 * why, and a press on any of them goes no further. Controls whose action the hold allows (pan and
 * zoom, Save world, Help, Appearance, the keyboard shortcuts) stay free, as do a modal dialogue's
 * (the export's own), the dialogues' own close buttons, and anything marked `data-fwmb-hold-free`
 * (the export's progress toast). Reading stays free: the panels scroll and their sections open.
 *
 * The studio redraws its parts while held (a tool's panel, the world bar), so the hold watches
 * the root and marks what is drawn afresh; when it ends, every control is put back as it was.
 */

/** What can be pressed or changed. */
const CONTROLS = "button, input, select, textarea, file-picker, [data-action], [role='menuitem'], [role='menuitemradio'], [role='menuitemcheckbox'], [role='radio'], [role='tab'], [role='slider'], [role='checkbox'], [data-reorder-handle], [data-band-edge]";

/** Fields, which are disabled outright rather than marked. */
const FIELDS = new Set(["input", "select", "textarea", "file-picker"]);

/** Where the hold leaves controls alone. */
const FREE = "dialog.fwmb-overlay-modal, [data-fwmb-hold-free], [data-overlay-action]";

const MARK = "data-fwmb-held";
const ATTRIBUTE = "data-fwmb-exporting";

export class StudioHold {
    #root;
    #reason = null;
    #allowed = new Set();
    #observer = null;
    #queued = false;

    /** @param {HTMLElement} root - The studio's root. */
    constructor(root) {
        this.#root = root;
        root.addEventListener("click", this.#onPress, true);
        root.addEventListener("pointerdown", this.#onPress, true);
        root.addEventListener("keydown", this.#onKey, true);
    }

    /** Whether the studio is held. */
    get held() {
        return this.#reason !== null;
    }

    /**
     * Holds the studio, or ends the hold.
     * @param {{reason: string, allowed?: Iterable<string>}|null} hold - The tooltip saying why,
     *     and the actions (data-action names) that stay free; null ends the hold.
     */
    set(hold) {
        if (hold) {
            this.#reason = hold.reason;
            this.#allowed = new Set(hold.allowed ?? []);
            this.#root.setAttribute(ATTRIBUTE, "");
            this.#apply();
            if (!this.#observer && typeof MutationObserver === "function") {
                this.#observer = new MutationObserver(() => this.#queue());
                this.#observer.observe(this.#root, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "aria-disabled", MARK] });
            }
            return;
        }
        this.#observer?.disconnect();
        this.#observer = null;
        this.#reason = null;
        this.#allowed = new Set();
        this.#root.removeAttribute(ATTRIBUTE);
        for (const element of this.#root.querySelectorAll(`[${MARK}]`)) StudioHold.#release(element);
    }

    /** Whether an action is refused while held (the action dispatcher asks before calling it). */
    refuses(action) {
        return this.held && !this.#allowed.has(action);
    }

    /** Whether a control waits while held. */
    #waits(element) {
        if (element.closest(FREE)) return false;
        const action = element.closest("[data-action]")?.dataset.action;
        return !(action && this.#allowed.has(action));
    }

    #queue() {
        if (this.#queued) return;
        this.#queued = true;
        queueMicrotask(() => {
            this.#queued = false;
            if (this.held) this.#apply();
        });
    }

    /** Marks every control that waits: idempotent, so its own changes set nothing more in motion. */
    #apply() {
        for (const element of this.#root.querySelectorAll(CONTROLS)) {
            if (!this.#waits(element)) continue;
            if (!element.hasAttribute(MARK)) {
                // What it was before the hold, to put back after (a redraw drops the mark, so a
                // control drawn afresh is recorded as it is drawn)
                const field = FIELDS.has(element.localName);
                element.setAttribute(MARK, JSON.stringify({ disabled: field ? element.disabled === true : null, aria: element.getAttribute("aria-disabled"), tooltip: element.dataset.tooltip ?? null }));
            }
            if (FIELDS.has(element.localName)) {
                if (!element.disabled) element.disabled = true;
            } else if (element.getAttribute("aria-disabled") !== "true") element.setAttribute("aria-disabled", "true");
            if (element.dataset.tooltip !== this.#reason) element.dataset.tooltip = this.#reason;
        }
    }

    static #release(element) {
        let was = {};
        try {
            was = JSON.parse(element.getAttribute(MARK)) ?? {};
        } catch {
            // A mark that cannot be read: the control is freed as if it had been enabled
        }
        element.removeAttribute(MARK);
        if (was.disabled !== null && was.disabled !== undefined) element.disabled = was.disabled;
        if (was.aria === null || was.aria === undefined) element.removeAttribute("aria-disabled");
        else element.setAttribute("aria-disabled", was.aria);
        if (was.tooltip === null || was.tooltip === undefined) delete element.dataset.tooltip;
        else element.dataset.tooltip = was.tooltip;
    }

    /** A press on a control that waits goes no further (its own listeners never hear it). */
    #onPress = (event) => {
        if (!this.held) return;
        const control = event.target.closest?.(`[${MARK}]`);
        if (!control || !this.#root.contains(control)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
    };

    /**
     * Enter and Space on a control that waits do nothing, nor the arrows on a slider, a list's drag
     * handle or a range's edge (which move them); other keys (Tab, the arrows elsewhere) go on.
     */
    #onKey = (event) => {
        if (!this.held) return;
        const arrows = event.key.startsWith("Arrow") && event.target.closest?.("[role='slider'], [data-reorder-handle], [data-band-edge], input[type='range']");
        if (event.key !== "Enter" && event.key !== " " && !arrows) return;
        if (!event.target.closest?.(`[${MARK}]`)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
    };

    destroy() {
        this.set(null);
        this.#root.removeEventListener("click", this.#onPress, true);
        this.#root.removeEventListener("pointerdown", this.#onPress, true);
        this.#root.removeEventListener("keydown", this.#onKey, true);
    }
}
