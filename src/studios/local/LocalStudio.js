/**
 * The Local studio: settlement maps, made from a settlement pin (L-surface builds it). In S0 it is
 * registered with no tools, so the shell's registration is seen to hold for a second studio: it
 * opens empty (`claude/v5-roadmap.md` §7). Nothing in the interface opens it until L-surface:
 * Settlement maps in the world bar stays disabled until then.
 */
import { defineStudio } from "../../shell/StudioRegistry.js";

export const LOCAL_DEFINITION = defineStudio({
    id: "local",
    label: "FILRODENSWMB.UI.StudioLocal",
    mapTypes: ["settlement"],
    stages: [
        { id: "shape", label: "FILRODENSWMB.UI.StageShape" },
        { id: "populate", label: "FILRODENSWMB.UI.StagePopulate", numbered: false },
        { id: "finish", label: "FILRODENSWMB.UI.StageFinish" },
    ],
    tools: [],
});

/** The Local studio's controller: nothing to draw yet. */
class LocalStudioController {
    root = null;

    /** @param {import("../../shell/Shell.js").Shell} shell */
    constructor(shell) {
        this.shell = shell;
    }

    mount(root) {
        this.root = root;
    }

    get isDirty() {
        return false;
    }

    async canClose() {
        return true;
    }

    destroy() {
        this.root = null;
    }
}

export const LocalStudio = Object.freeze({
    definition: LOCAL_DEFINITION,
    create: (shell) => new LocalStudioController(shell),
});
