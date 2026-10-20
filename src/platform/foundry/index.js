/**
 * Foundry VTT's implementation of the platform services (see ../index.js for what each provides).
 *
 * Every service reaches Foundry's globals inside its methods, never while this file loads, so
 * importing it on another host (or in a Node test that stubs only some globals) is harmless.
 */
import { FILRODENSWMB } from "../../config.js";
import { labelFontList } from "../../data/fonts.js";
import { createOverlayDialogs } from "../../ui/dialogs.js";
import * as store from "./store.js";

/** Offered when Foundry's font list is not available yet. */

const i18n = {
    localize: (key) => game.i18n.localize(key),
    format: (key, data) => game.i18n.format(key, data),
    /** Falls back to English while Foundry's localisation is still starting up. */
    get lang() {
        return game?.i18n?.lang || "en";
    },
};

/** The studio's dialogues are drawn inside the studio, the same in Foundry as on any other host. */
const dialogs = createOverlayDialogs({ localize: (key) => i18n.localize(key) });

const notify = {
    info: (text, options) => ui.notifications.info(text, options),
    warn: (text, options) => ui.notifications.warn(text, options),
    error: (text, options) => ui.notifications.error(text, options),
};

const utils = {
    randomID: () => foundry.utils.randomID(),
    deepClone: (value) => foundry.utils.deepClone(value),
    debounce: (fn, delay) => foundry.utils.debounce(fn, delay),
    mergeObject: (target, source, options) => foundry.utils.mergeObject(target, source, options),
    escapeHtml: (text) => Handlebars.escapeExpression(text),
    readForm: (form) => new foundry.applications.ux.FormDataExtended(form).object,
};

const templates = {
    render: (path, context) => foundry.applications.handlebars.renderTemplate(path, context),
};

const fonts = {
    // The vendored label fonts, then the world's own (Foundry's core fonts and any the world adds)
    list: () => labelFontList(CONFIG.fontFamilies ?? []),
};

/** The module's world settings, by the key under the module's namespace. */
const settings = {
    register: (key, config) => game.settings.register(FILRODENSWMB.ID, key, config),
    get: (key) => game.settings.get(FILRODENSWMB.ID, key),
    set: (key, value) => game.settings.set(FILRODENSWMB.ID, key, value),
};

const assets = {
    /**
     * A stored asset path made root-relative (with any route prefix Foundry is configured with),
     * so it resolves the same from any page or stylesheet. Complete URLs (http, https, and the data
     * URLs a map made in the web version holds for its images) are returned unchanged.
     */
    url: (path) => (!path || /^(?:https?|data|blob):/i.test(path) ? path : foundry.utils.getRoute(path)),
};

const moduleInfo = {
    get version() {
        return game.modules.get(FILRODENSWMB.ID)?.version || "unknown";
    },
    host: "foundry",
    get hostVersion() {
        return game.version ?? "unknown";
    },
};

/**
 * Grids for the grid data export, from Foundry's own grid classes. FWMB only uses the odd-offset
 * hex variants (HEXODDR for "hexR", HEXODDQ for "hexC"), so `even` is always false; `columns`
 * selects flat-top, column-offset hexes ("hexC") over pointy-top, row-offset ones ("hexR").
 */
const grid = {
    create({ type, size }) {
        if (type === "square") return new foundry.grid.SquareGrid({ size });
        return new foundry.grid.HexagonalGrid({ size, columns: type === "hexC", even: false });
    },
};

/**
 * The studio's window. The window attaches itself when it mounts the studio (and detaches when it
 * closes), and the studio's title goes to whichever window is attached; saved map ids are shown
 * whole, since Foundry's are short.
 */
export const foundryFrame = {
    idLength: undefined,
    window: null,
    attach(application) {
        this.window = application;
        return () => {
            if (this.window === application) this.window = null;
        };
    },
    setTitle(text) {
        this.window?.setTitle(text);
    },
};

/**
 * Exporting a map to a Foundry scene. The exporter is loaded when it is first used, which keeps
 * it (and the grid data export it builds on) out of the start-up path.
 */
const scene = {
    available: true,
    async run(app, config, playerBlob, gmBlob) {
        const { SceneExporter } = await import("./SceneExporter.js");
        return SceneExporter.run(app, config, playerBlob, gmBlob);
    },
};

export const foundryPlatform = Object.freeze({ i18n, notify, utils, templates, fonts, dialogs, settings, store, assets, module: moduleInfo, grid, scene, frame: foundryFrame });
