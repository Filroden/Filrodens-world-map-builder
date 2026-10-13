/**
 * The option menus on list items: a .fwmb-dropdown holding its button and a .fwmb-dropdown-menu,
 * which the stylesheet shows while the dropdown has focus. A menu opens below its button, or above
 * it when the list it is in has too little room left below for it and more room above.
 */

/** Marks a dropdown whose menu opens above its button. */
const OPENS_UP = "fwmb-dropdown-up";

/** The nearest ancestor that scrolls its content, which is the room a menu has to open into. */
function scrollingAncestor(element) {
    const view = element.ownerDocument.defaultView;
    for (let node = element.parentElement; node; node = node.parentElement) {
        if (/(auto|scroll)/.test(view.getComputedStyle(node).overflowY)) return node;
    }
    return element.ownerDocument.documentElement;
}

/**
 * Chooses which way the menu of the dropdown holding `target` opens. Called as focus moves into
 * the dropdown, when its menu is shown and can be measured.
 *
 * @param {EventTarget} target - The element that took focus; anything outside a dropdown is ignored.
 */
export function placeDropdownMenu(target) {
    const dropdown = target?.closest?.(".fwmb-dropdown");
    const menu = dropdown?.querySelector(".fwmb-dropdown-menu");
    if (!menu) return;

    dropdown.classList.remove(OPENS_UP);
    const room = scrollingAncestor(dropdown).getBoundingClientRect();
    const button = dropdown.getBoundingClientRect();
    const menuBox = menu.getBoundingClientRect();
    const needed = menuBox.bottom - button.bottom;
    const below = room.bottom - button.bottom;
    const above = button.top - room.top;
    dropdown.classList.toggle(OPENS_UP, below < needed && above > below);
}
