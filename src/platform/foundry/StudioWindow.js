/**
 * The studio's window in Foundry: an ApplicationV2 that only frames the studio. It supplies the
 * window (its title, icon, size and resizing), draws one empty part (templates/shell/studio.hbs, the
 * studio's frame) and mounts the shell in it with the studios the module offers; the shell and its
 * open studio draw and run everything inside (see Shell).
 *
 * Closing goes through the shell first: its studio may ask about unsaved changes, and the window
 * only closes once it agrees.
 *
 * The studio sets the window's title (the open map and whether it has unsaved changes) through
 * the platform's frame service, which passes it to the window attached to it (see setTitle).
 */
import { FILRODENSWMB } from "../../config.js";
import { Shell } from "../../shell/Shell.js";
import { attachTheme } from "../../shell/Theme.js";
import { STUDIOS } from "../../studios/index.js";
import { foundryFrame } from "./index.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** How much of the browser window a new studio window covers, across and down. */
const OPENING_SIZE = Object.freeze({ width: 0.7, height: 0.9 });

export class StudioWindow extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        id: "fwmb-map-studio",
        classes: ["fwmb", "fwmb-layout"],
        position: { width: 1300, height: 900 },
        window: {
            title: "FILRODENSWMB.UI.ControlTitle",
            icon: "fwmb-icon fwmb-icon--map",
            resizable: true,
        },
    };

    static PARTS = {
        body: { template: `modules/${FILRODENSWMB.ID}/templates/shell/studio.hbs` },
    };

    /** The shell in this window (null until the window is first drawn). */
    shell = null;

    /** Stops the colour theme being written on the window (see Theme.attachTheme). */
    #detachTheme = null;

    /** Stops the studio's title reaching this window (see foundryFrame.attach). */
    #detachFrame = null;

    /** @param {object} [options] - ApplicationV2 options; the size defaults to most of the browser window. */
    constructor(options = {}) {
        options.position = foundry.utils.mergeObject(options.position || {}, {
            width: window.innerWidth * OPENING_SIZE.width,
            height: window.innerHeight * OPENING_SIZE.height,
        });
        super(options);
    }

    /** Mounts the studio in the window's frame the first time the window is drawn. */
    _onRender(context, options) {
        super._onRender(context, options);
        if (this.shell) return;

        Shell.applyTextDirection(this.element);
        // The window as a whole follows the studio's colour theme, its header included
        this.#detachTheme = attachTheme(this.element);
        this.#detachFrame = foundryFrame.attach(this);
        this.shell = new Shell({ studios: STUDIOS });
        this.shell.mount(this.element.querySelector(".fwmb-studio"));
    }

    /**
     * Keeps the window from redrawing its content once the studio is in it. The studio redraws its
     * own regions, and replacing the window's content would throw away every region and the map's
     * canvas with it.
     */
    _replaceHTML(result, content, options) {
        if (this.shell) return;
        super._replaceHTML(result, content, options);
    }

    /**
     * Shows `text` as the window's title. It is kept in the window's options too, so the title
     * stays when Foundry draws the window's frame again (minimising and restoring it, say).
     *
     * @param {string} text - The title, already localised.
     */
    setTitle(text) {
        this.options.window.title = text;
        if (this.window?.title) this.window.title.textContent = text;
    }

    /** Closes the window once the studio agrees (it may ask about unsaved changes first). */
    async close(options) {
        if (this.shell) {
            if (!(await this.shell.canClose())) return;
            this.shell.destroy();
        }
        this.#detachTheme?.();
        this.#detachTheme = null;
        this.#detachFrame?.();
        this.#detachFrame = null;
        return super.close(options);
    }
}
