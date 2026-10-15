/**
 * The studio's dialogues, drawn inside the studio with Overlay, for every host. The shared code
 * asks for three kinds:
 *
 * - `confirm`: No or Yes. Resolves true for Yes; false for No or when the dialogue is dismissed.
 * - `prompt`: a form with Cancel and Confirm. Resolves with what `onSubmit(form)` returns (the
 *   button's action, "ok", when there is no onSubmit), or null for Cancel or when the dialogue is
 *   dismissed.
 * - `choose`: a row of buttons, drawn in the order given (negative choices first, the positive
 *   one last; see Overlay), each with a `tone` for its colour. Resolves with the pressed button's
 *   `callback(form)` result (its `action` when it has no callback), or `dismissed` when the
 *   dialogue is dismissed.
 *
 * Every kind takes `title` (already localised) and `content` (an HTML string, usually a rendered
 * template), and optionally:
 *
 * - `classes`: added to the dialogue's element, for its own styles.
 * - `icon`: an icon class shown before the title.
 * - `resizable`: whether the dialogue can be resized by its corner.
 * - `onRender(element)`: runs once the dialogue is in the page, with its element, for wiring up
 *   previews and live controls.
 * - `placement`: "modal" (the default) or "docked" (see Overlay).
 *
 * A slider in a dialogue returns on double-click to the value it had when the dialogue opened,
 * unless the template gives it a default of its own (`data-default`, for a neutral value such as
 * no rotation).
 *
 * Dialogues are drawn in the element most recently attached with `attach(element)` (the studio's
 * root, attached while the studio is open). Detaching an element dismisses the dialogues still
 * open in it. `dismiss({ placement })` closes the dialogues open there (only those in one
 * placement, when given), as if each had been closed without a button.
 */
import { Overlay } from "./Overlay.js";
import { RangeDisplay } from "../tools/RangeDisplay.js";

/** Where a dialogue is drawn when the caller does not say. */
const DEFAULT_PLACEMENT = "modal";

/** Gives each slider without a default of its own the value it opens with as its default (see StudioView's double-click reset). */
function rememberOpeningValues(element) {
    for (const slider of element.querySelectorAll('input[type="range"]:not([data-default])')) slider.dataset.default = slider.value;
}

/**
 * Creates the dialogue service.
 *
 * @param {object} options
 * @param {(key: string) => string} options.localize - Translates the module's string keys (the
 *     buttons' labels and the close control's name).
 * @returns {{confirm: Function, prompt: Function, choose: Function, dismiss: Function, attach: (element: HTMLElement) => () => void}}
 */
export function createOverlayDialogs({ localize }) {
    /** Attached elements, most recent last; dialogues open in the last one. */
    const hosts = [];

    function attach(element) {
        hosts.push(element);
        return function detach() {
            const index = hosts.lastIndexOf(element);
            if (index !== -1) hosts.splice(index, 1);
            Overlay.dismissAll(element);
        };
    }

    /**
     * Opens a dialogue in the attached element. `buttons` is a list, or a function returning one
     * for the kinds whose labels are translated here. The kinds below are async, so any failure
     * reaches the caller as a rejection.
     */
    function open({ title, content, classes, icon, resizable, onRender, placement = DEFAULT_PLACEMENT }, buttons, dismissed) {
        const host = hosts.at(-1);
        if (!host) throw new Error("Dialogues need an element to be drawn in: none is attached");

        return Overlay.open({
            host,
            placement,
            title,
            icon,
            content,
            buttons: typeof buttons === "function" ? buttons() : buttons,
            classes,
            resizable,
            dismissed,
            closeLabel: localize("FILRODENSWMB.UI.Close"),
            onRender: (element) => {
                rememberOpeningValues(element);
                onRender?.(element);
                // Sliders show their value and filled track from the values the content holds
                RangeDisplay.syncAllFills(element);
            },
        });
    }

    async function confirm(options) {
        return open(options, () => [
            // No is the default, so Enter (or a stray key press) never confirms a deletion
            { action: "no", label: localize("FILRODENSWMB.UI.No"), icon: "fwmb-icon fwmb-icon--cancel", tone: "negative", default: true, callback: () => false },
            { action: "yes", label: localize("FILRODENSWMB.UI.Yes"), icon: "fwmb-icon fwmb-icon--accept", tone: "positive", callback: () => true },
        ], false);
    }

    async function prompt({ onSubmit, ...options }) {
        return open(options, () => [
            { action: "cancel", label: localize("FILRODENSWMB.UI.Cancel"), icon: "fwmb-icon fwmb-icon--cancel", tone: "negative", callback: () => null },
            { action: "ok", label: localize("FILRODENSWMB.UI.Confirm"), icon: "fwmb-icon fwmb-icon--accept", tone: "positive", default: true, callback: onSubmit },
        ], null);
    }

    async function choose({ buttons, dismissed = null, ...options }) {
        return open(options, buttons, dismissed);
    }

    function dismiss({ placement = null } = {}) {
        const host = hosts.at(-1);
        if (host) Overlay.dismissAll(host, placement);
    }

    return { confirm, prompt, choose, dismiss, attach };
}
