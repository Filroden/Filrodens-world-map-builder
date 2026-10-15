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
