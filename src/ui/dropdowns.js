/**
 * The option menus on list items: a .fwmb-dropdown holding its button and a .fwmb-dropdown-menu,
 * open while focus is inside the dropdown.
 *
 * Where the browser supports popovers, an open menu is shown as one (see bindDropdownMenus): a
 * popover is drawn in the page's top layer, above everything and outside every scrolling list and
 * fieldset, so a menu in a short list is never cut off by the list's edge. It is placed against
 * its button, below it, or above it when there is more room there, and kept inside the studio. A
 * popover is used rather than a fixed position because Foundry's windows are drawn with effects
 * (a backdrop filter) that turn a fixed position into one relative to the window, not the page.
 *
 * Without popovers the stylesheet shows the menu below its button inside its list, or above it
 * when the list has too little room left below (see placeDropdownMenu).
 */

/** Marks a dropdown whose menu opens above its button (the layout without popovers). */
const OPENS_UP = "fwmb-dropdown-up";

/** Marks a dropdown whose menu opens beside its button rather than below or above it (the rail's More). */
const BESIDE = "fwmb-dropdown--beside";

/** The space between a menu and its button, in rem. */
const MENU_GAP_REM = 0.25;

/** The nearest ancestor that scrolls its content, which is the room a menu has to open into. */
function scrollingAncestor(element) {
    const view = element.ownerDocument.defaultView;
    for (let node = element.parentElement; node; node = node.parentElement) {
        if (/(auto|scroll)/.test(view.getComputedStyle(node).overflowY)) return node;
    }
    return element.ownerDocument.documentElement;
}

/**
 * Chooses which way the menu of the dropdown holding `target` opens, for the layout without
 * popovers. Called as focus moves into the dropdown, when its menu is shown and can be measured.
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

const supportsPopover = (menu) => typeof menu.showPopover === "function";

const isOpen = (menu) => menu.matches(":popover-open");

/** The box a popover menu must stay inside: the studio, or the window outside one. */
function roomFor(dropdown) {
    const studio = dropdown.closest(".fwmb-studio");
    if (studio) return studio.getBoundingClientRect();
    const view = dropdown.ownerDocument.defaultView;
    return { top: 0, left: 0, right: view.innerWidth, bottom: view.innerHeight };
}

/**
 * Places an open popover menu against its dropdown's button: below it, or above it when there is
 * more room above than below and it does not fit below, aligned with the button's end edge (its
 * right in a left-to-right page); or, for a dropdown marked to open beside its button, at the
 * button's end side with their bottoms aligned. Then moved back inside the room where it would
 * overflow.
 */
export function positionPopoverMenu(dropdown, menu) {
    const view = dropdown.ownerDocument.defaultView;
    const gap = MENU_GAP_REM * Number.parseFloat(view.getComputedStyle(dropdown.ownerDocument.documentElement).fontSize);
    const room = roomFor(dropdown);
    const button = dropdown.getBoundingClientRect();
    const { width, height } = menu.getBoundingClientRect();

    const rtl = view.getComputedStyle(dropdown).direction === "rtl";
    let top;
    let left;
    if (dropdown.classList.contains(BESIDE)) {
        // Beside its button (the rail's More): at its end side, bottoms aligned, so it grows upward
        top = button.bottom - height;
        left = rtl ? button.left - gap - width : button.right + gap;
    } else {
        const below = room.bottom - button.bottom;
        const above = button.top - room.top;
        const opensUp = below < height + gap && above > below;
        top = opensUp ? button.top - gap - height : button.bottom + gap;
        left = rtl ? button.left : button.right - width;
    }

    menu.style.top = `${clamp(top, room.top, room.bottom - height)}px`;
    menu.style.left = `${clamp(left, room.left, room.right - width)}px`;
}

/** `value` kept within min and max; min wins when the range is empty (a menu taller than the room starts at its top). */
function clamp(value, min, max) {
    return Math.max(min, Math.min(value, max));
}

function openMenu(target) {
    const dropdown = target?.closest?.(".fwmb-dropdown");
    const menu = dropdown?.querySelector(":scope > .fwmb-dropdown-menu");
    if (!menu) return;
    if (!supportsPopover(menu)) {
        placeDropdownMenu(target);
        return;
    }
    if (!menu.hasAttribute("popover")) menu.popover = "manual";
    if (!isOpen(menu)) menu.showPopover();
    positionPopoverMenu(dropdown, menu);
}

function closeMenu(menu) {
    if (menu && supportsPopover(menu) && menu.hasAttribute("popover") && isOpen(menu)) menu.hidePopover();
}

function closeAllMenus(root) {
    for (const menu of root.querySelectorAll(".fwmb-dropdown-menu[popover]")) closeMenu(menu);
}

/**
 * Opens and closes the option menus in `root`:
 * - focus moving into a dropdown opens its menu, and focus leaving the dropdown closes it;
 * - choosing an entry closes the menu (the entry's action still runs);
 * - Escape closes it, and scrolling anything closes every open menu, since a popover stays where
 *   it was placed while its button moves away with the list.
 *
 * @param {HTMLElement} root
 * @returns {() => void} Removes the listeners.
 */
export function bindDropdownMenus(root) {
    const onFocusIn = (event) => openMenu(event.target);
    const onFocusOut = (event) => {
        const dropdown = event.target.closest?.(".fwmb-dropdown");
        if (dropdown && !dropdown.contains(event.relatedTarget)) closeMenu(dropdown.querySelector(":scope > .fwmb-dropdown-menu"));
    };
    const onClick = (event) => {
        // A dropdown's own menu (the Appearance menu, a menu of its own, stays open as it is used)
        const entry = event.target.closest?.(".fwmb-dropdown > .fwmb-dropdown-menu button");
        if (!entry) return;
        closeMenu(entry.closest(".fwmb-dropdown-menu"));
        entry.blur();
    };
    const onKeyDown = (event) => {
        if (event.key !== "Escape") return;
        const dropdown = event.target.closest?.(".fwmb-dropdown");
        if (!dropdown) return;
        closeMenu(dropdown.querySelector(":scope > .fwmb-dropdown-menu"));
        dropdown.blur();
        event.target.blur?.();
    };
    const onScroll = () => closeAllMenus(root);

    root.addEventListener("focusin", onFocusIn);
    root.addEventListener("focusout", onFocusOut);
    root.addEventListener("click", onClick);
    root.addEventListener("keydown", onKeyDown);
    root.addEventListener("scroll", onScroll, true);
    return () => {
        root.removeEventListener("focusin", onFocusIn);
        root.removeEventListener("focusout", onFocusOut);
        root.removeEventListener("click", onClick);
        root.removeEventListener("keydown", onKeyDown);
        root.removeEventListener("scroll", onScroll, true);
    };
}
