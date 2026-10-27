import { FILRODENSWMB } from "../config.js";
import { CanvasHints } from "../canvas/CanvasHints.js";
import { LIBRARY_CREDITS, fontCredits } from "../data/credits.js";
import { Inspector } from "./Inspector.js";
import { platform } from "../platform/index.js";

/**
 * Help, in the inspector's column (see Inspector): About (the module's name and version, its
 * author with Sponsor, the repository, the licence, and the other host), Help (the changelog, the
 * wiki, the tutorial, reporting an issue, Copy version details, and the shortcuts,
 * a fold per tool, with Show all shortcuts) and Acknowledgements (src/data/credits.js, the fonts as
 * one fold). Every link opens in a new tab.
 *
 * Help shares the column with the inspector, one at a time, and leaves the panel, the bar, the
 * canvas mode and the selection as they are. It remembers one thing: what the inspector showed when
 * Help opened, which comes back when Help is closed (its ×, Escape, or the rail's Help button
 * again). Opening an object while Help shows replaces Help and forgets it, as does changing tool.
 * The rail's Help button is pressed while Help shows.
 */
export class HelpPanel {
    /** What the inspector showed when Help opened, by studio: `{ kind, ref }`. */
    static #covered = new WeakMap();

    /** Help's place in the inspector. */
    static KIND = Object.freeze({
        id: "help",
        template: "modules/filrodens-world-map-builder/templates/parts/inspector-help.hbs",
        find: () => HelpPanel.#HELP,
        header: () => ({ title: platform.i18n.localize("FILRODENSWMB.UI.Help"), subtitle: platform.i18n.format("FILRODENSWMB.UI.HelpVersion", { version: platform.module?.version ?? "" }), swatch: null }),
        context: (app) => HelpPanel.context(app),
        apply: () => false,
        actions: {
            copyVersion: (app) => HelpPanel.copyVersionDetails(app),
            showShortcuts: (app) => app.openShortcuts?.(),
        },
        closed: (app, _ref, { replaced }) => HelpPanel.#closed(app, replaced),
    });

    static #HELP = Object.freeze({ id: "help" });

    /** Whether Help shows in a studio. */
    static shows(app) {
        return Inspector.current(app)?.kind === this.KIND;
    }

    /** The rail's Help button: opens Help, or closes it (bringing back what it covered). */
    static async toggle(app) {
        if (this.shows(app)) {
            Inspector.close(app);
            return false;
        }
        return this.open(app);
    }

    /** Opens Help, remembering what the inspector showed. */
    static async open(app) {
        const current = Inspector.current(app);
        if (current && current.kind !== this.KIND) this.#covered.set(app, current);
        else this.#covered.delete(app);
        const opened = await Inspector.open(app, this.KIND, this.#HELP);
        this.#syncButton(app);
        return opened;
    }

    /** Forgets what Help covered (the tool changed, so it is no longer the tool's). */
    static forget(app) {
        this.#covered.delete(app);
    }

    /** Help closed: by its × or Escape, what it covered comes back; replaced by an object, nothing does. */
    static #closed(app, replaced) {
        const covered = this.#covered.get(app);
        this.#covered.delete(app);
        this.#syncButton(app);
        if (!replaced && covered) Inspector.open(app, covered.kind, covered.ref);
    }

    /** Presses the rail's Help button while Help shows, in place. */
    static #syncButton(app) {
        const button = app.root?.querySelector?.('[data-action="toggleHelp"]');
        button?.setAttribute("aria-pressed", String(this.shows(app)));
    }

    /** The template's context: the links, the shortcuts by tool and the credits. */
    static context() {
        const { HELP } = FILRODENSWMB;
        const host = platform.module?.host ?? "foundry";
        return {
            version: platform.module?.version ?? "",
            links: {
                sponsor: HELP.SPONSOR,
                repository: HELP.REPOSITORY,
                licence: HELP.LICENCE,
                otherHost: host === "web" ? { url: HELP.FOUNDRY_PACKAGE, label: "FILRODENSWMB.UI.HelpFoundryModule" } : { url: HELP.WEB_VERSION, label: "FILRODENSWMB.UI.HelpWebVersion" },
                changelog: HELP.CHANGELOG,
                wiki: HELP.WIKI,
                tutorial: HELP.TUTORIAL,
                issue: HELP.ISSUE,
            },
            shortcuts: CanvasHints.sheet((key) => platform.i18n.localize(key)).map((tool, index) => ({ ...tool, id: `helpShortcuts${index}` })),
            libraries: LIBRARY_CREDITS.map((credit) => ({ ...credit, link: credit.url ?? `${HELP.REPOSITORY}/tree/main/${credit.folder}` })),
            fonts: fontCredits(),
        };
    }

    /**
     * The facts a bug report needs, as plain text: the module's version, the host and its version,
     * the browser, the WebGL version and largest texture, and the map's size and cell count.
     * @returns {string}
     */
    static versionDetails(app) {
        const { i18n } = platform;
        const line = (key, value) => `${i18n.localize(key)}: ${value}`;
        const host = platform.module?.host === "web" ? i18n.localize("FILRODENSWMB.UI.HelpHostWeb") : `Foundry VTT ${platform.module?.hostVersion ?? ""}`.trim();
        const gl = this.#webgl();
        const cells = app.meshSession?.mesh?.cellCount;
        return [
            `${i18n.localize("FILRODENSWMB.UI.ControlTitle")} ${platform.module?.version ?? ""}`,
            line("FILRODENSWMB.UI.HelpDetailHost", host),
            line("FILRODENSWMB.UI.HelpDetailBrowser", globalThis.navigator?.userAgent ?? "unknown"),
            line("FILRODENSWMB.UI.HelpDetailWebGL", gl ? i18n.format("FILRODENSWMB.UI.HelpDetailWebGLValue", gl) : i18n.localize("FILRODENSWMB.UI.HelpDetailNone")),
            line("FILRODENSWMB.UI.HelpDetailMap", i18n.format("FILRODENSWMB.UI.HelpDetailMapValue", { width: app.mapWidth ?? "?", height: app.mapHeight ?? "?", cells: cells ?? "?" })),
        ].join("\n");
    }

    /** The browser's WebGL: its version and largest texture, or null. */
    static #webgl() {
        const canvas = globalThis.document?.createElement?.("canvas");
        if (!canvas?.getContext) return null;
        let version = 2;
        let gl = canvas.getContext("webgl2");
        if (!gl) {
            version = 1;
            gl = canvas.getContext("webgl");
        }
        if (!gl) return null;
        const size = gl.getParameter(gl.MAX_TEXTURE_SIZE);
        gl.getExtension("WEBGL_lose_context")?.loseContext();
        return { version, size };
    }

    /** Copy version details: the details on the clipboard, with a notice. */
    static async copyVersionDetails(app) {
        const text = this.versionDetails(app);
        try {
            await globalThis.navigator.clipboard.writeText(text);
            platform.notify.info(platform.i18n.localize("FILRODENSWMB.UI.HelpCopied"));
        } catch {
            platform.notify.warn(platform.i18n.localize("FILRODENSWMB.UI.HelpCopyFailed"));
        }
        return text;
    }
}
