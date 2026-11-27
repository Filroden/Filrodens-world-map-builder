/**
 * The studio shell: what every studio shares, whatever map it shows. A host (a Foundry window, or
 * the web page) makes one with the studios it offers, mounts it in the studio's frame, asks
 * canClose() before closing and calls destroy() when it does.
 *
 * The shell opens one studio at a time (the World studio unless told otherwise), creating its
 * controller from the studio's registration and mounting it in the frame. It never imports a
 * studio: the hosts pass the studios in (src/studios/index.js), and the shell knows each only by
 * its definition (see StudioRegistry).
 *
 * In S0's step 1 the shell takes the frame's own work (the text direction, the dialogues drawn
 * inside the frame, the label fonts the host has); the World studio's controller still draws the
 * regions. The world bar and the regions' drawing come to the shell in step 3, the rail, panels,
 * Help and the inspector's host in step 6 (`claude/v5-s0-shell-handoff.md` §10).
 */
import { SHELL_PARTS } from "./config.js";
import { platform } from "../platform/index.js";
import { LabelFonts } from "../kernel/util/LabelFonts.js";
import { StudioRegistry } from "./StudioRegistry.js";

export class Shell {
    /** The studios this shell can open. */
    registry;

    /** The open studio's definition (see StudioRegistry.defineStudio). */
    definition;

    /** The open studio's controller, made by its create(); null until mounted. */
    studio = null;

    /** The studio's frame (null until mounted, and once destroyed). */
    root = null;

    /** Stops dialogues being drawn in the frame (see platform.dialogs.attach). */
    #detachDialogs = null;

    /**
     * @param {object} options
     * @param {Array<{definition: object, create: Function}>} options.studios - The studios offered.
     * @param {string} [options.studio] - The studio to open (the first registered by default).
     */
    constructor({ studios, studio } = {}) {
        this.registry = new StudioRegistry(studios ?? []);
        const id = studio ?? this.registry.ids()[0];
        const entry = this.registry.get(id);
        if (!entry) throw new Error(`Shell: no studio "${id}"`);
        this.#entry = entry;
        this.definition = entry.definition;
    }

    /** The open studio's registration ({definition, create}). */
    #entry;

    /**
     * Registers each studio's own settings (the World studio's: the Generate guard's kept answer),
     * at the host's start, before any setting is read.
     * @param {Array<{registerSettings?: Function}>} studios
     */
    static registerSettings(studios) {
        for (const studio of studios) studio.registerSettings?.();
    }

    /**
     * Runs what each studio prepares before any studio opens (the World studio makes saved maps
     * into worlds, for one), in the order the studios are given. A studio whose preparation fails
     * is reported and the others still run, so the studio can still open.
     *
     * @param {Array<{definition: object, prepare?: Function}>} studios
     * @returns {Promise<Array<*>>} Each studio's result (null for one with nothing to prepare, or
     *     one whose preparation failed).
     */
    static async prepare(studios) {
        const results = [];
        for (const studio of studios) {
            try {
                results.push(studio.prepare ? await studio.prepare() : null);
            } catch (error) {
                console.error(`FWMB | Preparing the ${studio.definition?.id} studio failed:`, error);
                results.push(null);
            }
        }
        return results;
    }

    /**
     * Gives an element the reading direction of the host's language: right to left for the
     * languages that read so, the element marked for the stylesheets as well (fwmb-rtl). The hosts
     * call it on their frame, so its own controls (a window's header) follow the studio's direction.
     *
     * @param {HTMLElement} element
     */
    static applyTextDirection(element) {
        const rtlLanguages = SHELL_PARTS.RTL_LANGUAGES || [];
        // Falls back to "en" when the host's localisation is not ready yet (see platform.i18n.lang)
        if (!rtlLanguages.includes(platform.i18n.lang)) return;

        element.setAttribute("dir", "rtl");
        element.classList.add("fwmb-rtl");
    }

    /**
     * Mounts the open studio in the frame, once.
     *
     * @param {HTMLElement} root - The studio's frame (an empty element with the "fwmb-studio" class).
     */
    mount(root) {
        if (this.root) throw new Error("Shell: already mounted");
        this.root = root;
        root.dataset.fwmbStudio = this.definition.id;
        // Dialogues are drawn inside the studio while it is open
        this.#detachDialogs = platform.dialogs.attach(root);
        // Labels naming a family this host lacks are drawn in the default label font (see LabelFonts)
        LabelFonts.setAvailable(platform.fonts.list());
        this.studio = this.#entry.create(this);
        this.studio.mount(root);
    }

    /** Whether the open studio has changes not yet saved. */
    get isDirty() {
        return !!this.studio?.isDirty;
    }

    /**
     * Whether the host may close: the open studio decides (it may ask about unsaved changes).
     * @returns {Promise<boolean>}
     */
    async canClose() {
        return this.studio ? this.studio.canClose() : true;
    }

    /** Shuts the studio down as its host closes; called once, after canClose() answered true. */
    destroy() {
        // A dialogue still open is dismissed first, so whatever opened it carries on as if it were
        // cancelled while the studio can still answer
        this.#detachDialogs?.();
        this.#detachDialogs = null;
        this.studio?.destroy();
        this.studio = null;
        this.root = null;
    }
}
