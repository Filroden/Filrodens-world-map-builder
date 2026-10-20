/**
 * The studio's colour theme: light or dark, and the gold or teal hue, chosen in the studio itself
 * (the rail's Appearance menu, see AppearanceMenu) and kept as the reader's own settings, the same
 * in Foundry and on the web.
 *
 * The module's colour tokens (styles/fwmb-theme.css) are defined on theme and hue selectors, so
 * they apply to whatever element carries them and everything inside it. The choice is written as
 * two attributes, data-fwmb-theme and data-fwmb-hue, on the elements the hosts register here: the
 * studio's frame (in Foundry the window, so its header follows too) and <body> (where Foundry
 * draws its tooltip, and the web page its own). The attribute selectors are more specific than the
 * host's theme classes (Foundry's theme-light and theme-dark, which may sit on the same elements),
 * so the reader's choice wins wherever it is set.
 *
 * "auto" leaves light or dark to the host: the attribute is removed, and the host's own theme
 * classes decide (Foundry's interface theme, or on the web the system preference).
 */
import { platform } from "../platform/index.js";

/** The settings' keys (in Foundry, under the module's namespace). */
export const THEME_SETTINGS = Object.freeze({ MODE: "themeMode", HUE: "themeHue" });

/** The choices each setting offers, the first being its default. */
export const THEME_CHOICES = Object.freeze({
    themeMode: Object.freeze(["auto", "light", "dark"]),
    themeHue: Object.freeze(["gold", "teal"]),
});

const MODE_ATTRIBUTE = "data-fwmb-theme";
const HUE_ATTRIBUTE = "data-fwmb-hue";

/** The elements the theme is written on. */
const targets = new Set();

/** A setting's stored value, or its default when the stored value is not one of its choices. */
function read(key) {
    const choices = THEME_CHOICES[key];
    let value;
    try {
        value = platform.settings.get(key);
    } catch {
        value = undefined;
    }
    return choices.includes(value) ? value : choices[0];
}

/** The current choice: `{ mode, hue }`. */
export function currentTheme() {
    return { mode: read(THEME_SETTINGS.MODE), hue: read(THEME_SETTINGS.HUE) };
}

/** Writes the current choice on every registered element. */
export function applyTheme() {
    const { mode, hue } = currentTheme();
    for (const element of targets) {
        if (mode === "auto") element.removeAttribute(MODE_ATTRIBUTE);
        else element.setAttribute(MODE_ATTRIBUTE, mode);
        element.setAttribute(HUE_ATTRIBUTE, hue);
    }
}

/**
 * Registers the two settings. Both are the reader's own (client scope) and are not listed in
 * Foundry's settings sheet: the studio offers them. The hue keeps the key it has always had, so a
 * choice made before carries over.
 */
export function registerThemeSettings() {
    for (const key of Object.values(THEME_SETTINGS)) {
        platform.settings.register(key, {
            scope: "client",
            config: false,
            type: String,
            default: THEME_CHOICES[key][0],
            onChange: () => applyTheme(),
        });
    }
}

/**
 * Has the theme written on an element, now and whenever it changes.
 *
 * @param {HTMLElement} element
 * @returns {() => void} Stops writing on it (and removes what was written).
 */
export function attachTheme(element) {
    targets.add(element);
    applyTheme();
    return () => {
        targets.delete(element);
        element.removeAttribute(MODE_ATTRIBUTE);
        element.removeAttribute(HUE_ATTRIBUTE);
    };
}

/**
 * Stores a new choice for one of the settings (which applies it).
 *
 * @param {string} key - THEME_SETTINGS.MODE or THEME_SETTINGS.HUE.
 * @param {string} value - One of the setting's choices; anything else is ignored.
 * @returns {Promise<boolean>} Whether it was stored.
 */
export async function setTheme(key, value) {
    if (!THEME_CHOICES[key]?.includes(value)) return false;
    await platform.settings.set(key, value);
    // A host whose settings do not call onChange still shows the change
    applyTheme();
    return true;
}
