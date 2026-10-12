/**
 * The map studio's window in Foundry: an ApplicationV2 that only frames the studio. It supplies the
 * window (its title, icon, size and resizing), draws one empty part (templates/studio.hbs, the
 * studio's frame) and mounts the studio in it; the studio draws and runs everything inside (see
 * MapStudio).
 *
 * Closing goes through the studio first: it may ask about unsaved changes, and the window only
 * closes once the studio agrees.
 */
import { FILRODENSWMB } from "../../config.js";
import { MapStudio } from "../../applications/MapStudio.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** How much of the browser window a new studio window covers, across and down. */
const OPENING_SIZE = Object.freeze({ width: 0.7, height: 0.9 });

export class MapStudioWindow extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        id: "fwmb-map-studio",
        classes: ["fwmb", "fwmb-layout"],
        position: { width: 1300, height: 900 },
        window: {
            title: "FILRODENSWMB.UI.ControlTitle",
            icon: "fwmb-icon map",
            resizable: true,
        },
    };

    static PARTS = {
        body: { template: `modules/${FILRODENSWMB.ID}/templates/studio.hbs` },
    };

    /** The studio in this window (null until the window is first drawn). */
    studio = null;

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
        if (this.studio) return;

        MapStudio.applyTextDirection(this.element);
        this.studio = new MapStudio();
        this.studio.mount(this.element.querySelector(".fwmb-studio"));
    }

    /**
     * Keeps the window from redrawing its content once the studio is in it. The studio redraws its
     * own regions, and replacing the window's content would throw away every region and the map's
     * canvas with it.
     */
    _replaceHTML(result, content, options) {
        if (this.studio) return;
        super._replaceHTML(result, content, options);
    }

    /** Closes the window once the studio agrees (it may ask about unsaved changes first). */
    async close(options) {
        if (this.studio) {
            if (!(await this.studio.canClose())) return;
            this.studio.destroy();
        }
        return super.close(options);
    }
}
