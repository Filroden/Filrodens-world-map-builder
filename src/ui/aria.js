/**
 * The studio's interactive states are ARIA attributes rather than classes, so the same attribute
 * tells assistive technology and the stylesheet what a control is doing. These helpers keep the
 * attribute's value a literal "true" or "false" string, which is what the stylesheet's attribute
 * selectors (for example `[aria-pressed="true"]`) match on.
 */

/**
 * Marks a toggle button as on or off.
 * @param {Element|null|undefined} element
 * @param {boolean} pressed
 */
export function setPressed(element, pressed) {
    element?.setAttribute("aria-pressed", String(Boolean(pressed)));
}

/**
 * Whether a toggle button is on.
 * @param {Element|null|undefined} element
 * @returns {boolean}
 */
export function isPressed(element) {
    return element?.getAttribute("aria-pressed") === "true";
}

/**
 * Flips a toggle button and returns its new state.
 * @param {Element} element
 * @returns {boolean}
 */
export function togglePressed(element) {
    const pressed = !isPressed(element);
    setPressed(element, pressed);
    return pressed;
}

/**
 * Marks a control as on or off in the way its role reads it: a menu row that can be ticked
 * (role menuitemcheckbox) with aria-checked, any other toggle with aria-pressed. The same state
 * can then be shown both by a button and by its row in a menu.
 * @param {Element|null|undefined} element
 * @param {boolean} on
 */
export function setOn(element, on) {
    if (!element) return;
    const attribute = element.getAttribute("role") === "menuitemcheckbox" ? "aria-checked" : "aria-pressed";
    element.setAttribute(attribute, String(Boolean(on)));
}
