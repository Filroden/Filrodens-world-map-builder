import { currentTheme, setTheme, THEME_CHOICES, THEME_SETTINGS } from "./Theme.js";
import { positionPopoverMenu } from "./dropdowns.js";
import { platform } from "../platform/index.js";

/** The localisation key of each choice, by setting. */
const CHOICE_LABELS = Object.freeze({
    themeMode: Object.freeze({ auto: "FILRODENSWMB.UI.ThemeModeAuto", light: "FILRODENSWMB.UI.ThemeModeLight", dark: "FILRODENSWMB.UI.ThemeModeDark" }),
    themeHue: Object.freeze({ gold: "FILRODENSWMB.Settings.ThemeHue.Gold", teal: "FILRODENSWMB.Settings.ThemeHue.Teal" }),
});
const GROUP_LABELS = Object.freeze({ themeMode: "FILRODENSWMB.UI.AppearanceMode", themeHue: "FILRODENSWMB.UI.AppearanceHue" });

/**
 * The rail's Appearance menu: the reader's colour theme (see Theme.js), two groups of
 * `menuitemradio` items, Mode (Auto, Light, Dark) and Hue (Gold, Teal), applied at once. It opens
 * from its rail button as a popover in the top layer, beside the button, so the rail does not clip
 * it. Up, Down, Home and End move through its items; Space or Enter chooses one, leaving the menu
 * open; Escape (or Tab, or a press outside) closes it, Escape returning focus to the button. The
 * button's tooltip names the current choice ("Appearance: Dark, Teal").
 *
 * When the studio is short the occasional tools fold into More, and the two groups sit inline
 * there, under the menu's own name (see toolbar.hbs). Both lists are kept in step, in place.
 */
export class AppearanceMenu {
    /** The open menu's studio root, if any. */
    static #open = null;

    /**
     * The menu's groups as toolbar.hbs draws them, and the button's name.
     * @returns {{tooltip: string, groups: {key: string, label: string, items: {value: string, label: string, checked: boolean}[]}[]}}
     */
    static context() {
        const theme = currentTheme();
        const chosen = { themeMode: theme.mode, themeHue: theme.hue };
        return {
            tooltip: this.#tooltip(theme),
            groups: Object.values(THEME_SETTINGS).map((key) => ({
                key,
                label: GROUP_LABELS[key],
                items: THEME_CHOICES[key].map((value) => ({ value, label: CHOICE_LABELS[key][value], checked: chosen[key] === value })),
            })),
        };
    }

    static #tooltip({ mode, hue }) {
        const { i18n } = platform;
        return i18n.format("FILRODENSWMB.UI.AppearanceTooltip", { mode: i18n.localize(CHOICE_LABELS.themeMode[mode]), hue: i18n.localize(CHOICE_LABELS.themeHue[hue]) });
    }

    /** The rail button's click: opens the menu, or closes it when open. */
    static toggle(root, button) {
        if (this.isOpen(root)) this.close(root);
        else this.open(root, button);
    }

    static isOpen(root) {
        return !!root && this.#open === root && !!this.#menu(root)?.matches(":popover-open");
    }

    static #menu(root) {
        return root?.querySelector?.(".fwmb-appearance-menu") ?? null;
    }

    static #button(root) {
        return root?.querySelector?.('[data-action="toggleAppearance"]') ?? null;
    }

    /** Opens the menu beside its button, focus on the item chosen in the first group. */
    static open(root, button = this.#button(root)) {
        const menu = this.#menu(root);
        if (!menu || !button) return;
        if (typeof menu.showPopover === "function") {
            if (!menu.matches(":popover-open")) menu.showPopover();
            positionPopoverMenu(button.closest(".fwmb-appearance") ?? button, menu);
        } else menu.classList.remove("fwmb-hidden");
        button.setAttribute("aria-expanded", "true");
        this.#open = root;
        const doc = root.ownerDocument;
        doc.addEventListener("pointerdown", this.#onPointerDown, true);
        (menu.querySelector('[role="menuitemradio"][aria-checked="true"]') ?? menu.querySelector('[role="menuitemradio"]'))?.focus();
    }

    /** Closes the menu; with `returnFocus`, focus goes back to its button. */
    static close(root, { returnFocus = false } = {}) {
        const menu = this.#menu(root);
        const button = this.#button(root);
        if (menu?.matches?.(":popover-open")) menu.hidePopover();
        else menu?.classList.add("fwmb-hidden");
        button?.setAttribute("aria-expanded", "false");
        if (this.#open === root) this.#open = null;
        root?.ownerDocument?.removeEventListener("pointerdown", this.#onPointerDown, true);
        if (returnFocus) button?.focus();
    }

    static #onPointerDown = (event) => {
        const root = AppearanceMenu.#open;
        if (!root) return;
        if (event.target.closest?.(".fwmb-appearance-menu, [data-action='toggleAppearance']")) return;
        AppearanceMenu.close(root);
    };

    /**
     * A choice (from the menu or from More): stores it, which applies it, then shows it in both
     * lists and in the button's tooltip.
     * @param {HTMLElement} root
     * @param {HTMLElement} item - Carries data-theme-key and data-value.
     */
    static async choose(root, item) {
        const { themeKey, value } = item.dataset;
        if (!(await setTheme(themeKey, value))) return;
        this.sync(root);
    }

    /** Shows the current choice in every list of the studio, and in the button's name. */
    static sync(root) {
        if (!root) return;
        const theme = currentTheme();
        const chosen = { themeMode: theme.mode, themeHue: theme.hue };
        for (const item of root.querySelectorAll("[data-theme-key]")) item.setAttribute("aria-checked", String(chosen[item.dataset.themeKey] === item.dataset.value));
        const button = this.#button(root);
        if (button) {
            const tooltip = this.#tooltip(theme);
            button.setAttribute("aria-label", tooltip);
            button.dataset.tooltip = tooltip;
        }
    }

    /**
     * The open menu's keys. Returns whether the key was the menu's, so the studio leaves it alone.
     * @param {HTMLElement} root
     * @param {KeyboardEvent} event
     */
    static handleKey(root, event) {
        const menu = event.target.closest?.(".fwmb-appearance-menu");
        if (!menu) return false;
        const items = [...menu.querySelectorAll('[role="menuitemradio"]')];
        const index = items.indexOf(event.target);
        const moveTo = (next) => items[(next + items.length) % items.length]?.focus();
        switch (event.key) {
            case "ArrowDown":
                moveTo(index + 1);
                return true;
            case "ArrowUp":
                moveTo(index - 1);
                return true;
            case "Home":
                moveTo(0);
                return true;
            case "End":
                moveTo(items.length - 1);
                return true;
            case "Enter":
            case " ":
                if (index !== -1) this.choose(root, event.target);
                return true;
            case "Escape":
                this.close(root, { returnFocus: true });
                return true;
            case "Tab":
                this.close(root);
                this.#button(root)?.focus();
                return true;
            default:
                return false;
        }
    }
}
