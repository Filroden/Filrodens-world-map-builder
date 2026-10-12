/**
 * Dialogues in Foundry, shown with DialogV2. The shared code asks for three kinds:
 *
 * - `confirm`: Yes or No. Resolves true or false.
 * - `prompt`: a form with one confirm button. Resolves with what `onSubmit(form)` returns, or null
 *   when the dialogue is closed without confirming.
 * - `choose`: a row of buttons. Resolves with the pressed button's `callback(form)` result (its
 *   `action` when it has no callback), or `dismissed` when the dialogue is closed.
 *
 * `content` is an HTML string (usually a rendered template). `onRender(element)` runs once the
 * dialogue is in the page, with its element, for wiring up previews and live controls. `classes`
 * are added to the dialogue's own element, as the module's stylesheet expects (most dialogues
 * carry "fwmb").
 */

/** Foundry's dialogue class, looked up when a dialogue opens (never when this file loads). */
const DialogV2 = () => foundry.applications.api.DialogV2;

/**
 * The DialogV2 options every kind shares.
 *
 * @param {object} options
 * @param {string} options.title - The window title (already localised).
 * @param {string} options.content - The body HTML.
 * @param {string[]} [options.classes] - Classes for the dialogue's element.
 * @param {string} [options.icon] - A window icon class.
 * @param {boolean} [options.resizable] - Whether the window can be resized.
 * @param {(element: HTMLElement) => void} [options.onRender]
 * @returns {object} DialogV2 options.
 */
function baseOptions({ title, content, classes, icon, resizable, onRender }) {
    const frame = { title };
    if (icon) frame.icon = icon;
    if (resizable) frame.resizable = true;

    const options = { window: frame, content };
    if (classes) options.classes = classes;
    if (onRender) options.render = (event) => onRender(event.target.element);
    return options;
}

/**
 * A Yes/No question.
 *
 * @param {object} options - See baseOptions.
 * @returns {Promise<boolean>} True for Yes; false for No or when closed.
 */
export function confirm(options) {
    return DialogV2().confirm({ ...baseOptions(options), rejectClose: false, modal: true });
}

/**
 * A form with one confirm button.
 *
 * @param {object} options - See baseOptions, plus:
 * @param {(form: HTMLFormElement) => unknown} [options.onSubmit] - Reads the result from the form.
 * @returns {Promise<unknown>} onSubmit's result, or null when closed without confirming.
 */
export function prompt({ onSubmit, ...options }) {
    const dialogOptions = baseOptions(options);
    if (onSubmit) dialogOptions.ok = { callback: (_event, button) => onSubmit(button.form) };
    return DialogV2().prompt(dialogOptions);
}

/**
 * A choice between buttons.
 *
 * @param {object} options - See baseOptions, plus:
 * @param {Array<{action: string, label: string, icon?: string, default?: boolean, callback?: (form: HTMLFormElement) => unknown}>} options.buttons
 * @param {unknown} [options.dismissed] - What closing the dialogue without a button resolves with.
 * @returns {Promise<unknown>}
 */
export function choose({ buttons, dismissed = null, ...options }) {
    return DialogV2().wait({
        ...baseOptions(options),
        buttons: buttons.map(({ callback, ...button }) => (callback ? { ...button, callback: (_event, element) => callback(element.form) } : button)),
        close: () => dismissed,
    });
}
