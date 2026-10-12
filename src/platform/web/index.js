/**
 * The web host's implementation of the platform services (see ../index.js for what each provides),
 * for the studio running in a plain web page.
 *
 * Nothing here reaches for the page's libraries by their global names: the page (web/main.js)
 * loads Handlebars and hands it in, with the language files, the template list and the module's
 * manifest it has read, so every service can also be built in a test.
 *
 * What the web version leaves out is expressed as data: `scene.available` is false (there is no
 * Foundry scene to export to), and `grid`, which only that export uses, is not offered.
 */
import { createOverlayDialogs } from "../../ui/dialogs.js";
import { createWebAssets } from "./assets.js";
import { createI18n } from "./i18n.js";
import { createNotifications } from "./notifications.js";
import { createWebSettings } from "./settings.js";
import { createWebStore } from "./store.js";
import { createWebTemplates, registerHelpers } from "./templates.js";
import * as utils from "./utils.js";

/** Font families offered for labels: ones every desktop browser has. */
const WEB_FONTS = Object.freeze(["Arial", "Georgia", "Times New Roman", "Trebuchet MS", "Verdana", "Courier New"]);

/**
 * @param {object} options
 * @param {Map<string, string>} options.strings - The language strings (see i18n.flattenStrings).
 * @param {string} options.lang - The language shown.
 * @param {object} options.handlebars - The Handlebars instance.
 * @param {(path: string) => Promise<string>} options.fetchTemplate - Reads a template by its path in templates/.
 * @param {object} options.records - Where saved maps are kept (see store.js).
 * @param {HTMLElement} options.frame - The page's .fwmb frame (notifications are drawn in it).
 * @param {{id: string, version: string}} options.manifest - From module.json.
 * @param {string} options.baseUrl - The page's base URL.
 * @param {Storage} [options.storage] - Where settings are kept (local storage by default).
 */
export function createWebPlatform({ strings, lang, handlebars, fetchTemplate, records, frame, manifest, baseUrl, storage }) {
    const i18n = createI18n(strings, lang);
    const prefix = `modules/${manifest.id}/templates/`;
    registerHelpers(handlebars, i18n);

    return {
        i18n,
        notify: createNotifications(frame, { closeLabel: i18n.localize("FILRODENSWMB.UI.Close") }),
        utils,
        templates: createWebTemplates({ handlebars, prefix, fetchText: fetchTemplate }),
        fonts: { list: () => [...WEB_FONTS] },
        dialogs: createOverlayDialogs({ localize: i18n.localize }),
        settings: createWebSettings(storage),
        store: createWebStore(records),
        assets: createWebAssets({ moduleId: manifest.id, baseUrl }),
        module: { version: manifest.version },
        grid: {
            create() {
                throw new Error("Grids are only used by the scene export, which the web version does not offer");
            },
        },
        scene: {
            available: false,
            async run() {
                throw new Error("The web version cannot export to a scene");
            },
        },
    };
}
