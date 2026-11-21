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
import { RangeDisplay } from "../kernel/util/RangeDisplay.js";

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
/**
 * Board N1's footer for every dialogue (S0 step 8a): the way out (an action named cancel, or a
 * button marked `start`) at the start when there is anything else to press; a lone Close stays at
 * the end as the dialogue's one button.
 * @param {object[]} buttons
 */
function splitButtons(buttons = []) {
    if (buttons.length < 2) return buttons;
    return buttons.map((button) => (button.start === undefined && button.action === "cancel" ? { ...button, start: true } : button));
}

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
            footer: "split",
            buttons: splitButtons(typeof buttons === "function" ? buttons() : buttons),
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

    /**
     * A confirmation names its action (Ken, 2026-11-21): Cancel at the start, the action at the end.
     * A destructive action (the default: Delete, Discard, Revert) takes the negative tone; any other
     * is the primary. Cancel is the default either way, so focus opens on it and Enter (or a stray
     * key press) never confirms.
     * @param {object} options
     * @param {string} [options.confirmLabel] - The action's name (Confirm when none is given).
     * @param {string} [options.confirmIcon] - An icon class for the action.
     * @param {boolean} [options.destructive=true]
     */
    async function confirm({ confirmLabel, confirmIcon, destructive = true, ...options }) {
        return open(options, () => [
            { action: "cancel", label: localize("FILRODENSWMB.UI.Cancel"), start: true, default: true, callback: () => false },
            { action: "confirm", label: confirmLabel ?? localize("FILRODENSWMB.UI.Confirm"), icon: confirmIcon, tone: destructive ? "negative" : undefined, primary: !destructive, callback: () => true },
        ], false);
    }

    /**
     * A dialogue with fields: Cancel at the start, the action (the primary, which Enter in a lone
     * field presses) at the end, named for what it does.
     * @param {object} options
     * @param {string} [options.confirmLabel] - The action's name (Confirm when none is given).
     * @param {string} [options.confirmIcon] - An icon class for the action.
     */
    async function prompt({ onSubmit, confirmLabel, confirmIcon, ...options }) {
        return open(options, () => [
            { action: "cancel", label: localize("FILRODENSWMB.UI.Cancel"), start: true, callback: () => null },
            { action: "ok", label: confirmLabel ?? localize("FILRODENSWMB.UI.Confirm"), icon: confirmIcon, default: true, callback: onSubmit },
        ], null);
    }

    async function choose({ buttons, dismissed = null, ...options }) {
        return open(options, buttons, dismissed);
    }

    /**
     * Opens a dialogue its caller drives (the export dialogue): as open() does, with every
     * Overlay option, returning the Overlay itself, so the caller can enable its buttons, change
     * its footer's start line and close it; its `closed` promise resolves as open()'s would.
     */
    function show({ onRender, placement = DEFAULT_PLACEMENT, ...options }) {
        const host = hosts.at(-1);
        if (!host) throw new Error("Dialogues need an element to be drawn in: none is attached");
        return Overlay.show({
            ...options,
            host,
            placement,
            closeLabel: localize("FILRODENSWMB.UI.Close"),
            onRender: (element) => {
                onRender?.(element);
                RangeDisplay.syncAllFills(element);
            },
        });
    }

    function dismiss({ placement = null } = {}) {
        const host = hosts.at(-1);
        if (host) Overlay.dismissAll(host, placement);
    }

    return { confirm, prompt, choose, show, dismiss, attach };
}
