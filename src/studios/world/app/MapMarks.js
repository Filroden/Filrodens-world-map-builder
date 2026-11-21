import { GeneratorRevision } from "../generator/GeneratorRevision.js";
import { platform } from "../../../platform/index.js";
import { RunInputs } from "./RunInputs.js";

/** The marks a map can carry (the design system's StateMarks card), as they show: one set everywhere. */
const MARKS = Object.freeze({
    // What the run read has changed since (RunInputs.stale): the map's own edits included
    runEdited: Object.freeze({ kind: "stale", icon: "warning-mark", label: "FILRODENSWMB.UI.MarkOutOfDate" }),
    // Made by an older generator, whose rules it keeps until it is generated again (GeneratorRevision)
    older: Object.freeze({ kind: "older", icon: "history", label: "FILRODENSWMB.UI.MarkOlderGenerator" }),
    noRun: Object.freeze({ kind: "older", icon: "generate", label: "FILRODENSWMB.UI.MarkNoRun" }),
    // The world it belongs to: a held regional world whose parent changed what it shows (S0 step 5)
    regionalStale: Object.freeze({ kind: "stale", icon: "sync", label: "FILRODENSWMB.UI.MarkRegionalOutOfDate" }),
});

/**
 * A map's marks (S0 step 6, "marks everywhere"): one function from a map's state to its marks,
 * so the layer switcher's Surface segment, the overview's Surface map card and its inspector card,
 * and Peoples and realms' Run heading agree. Worlds' cards keep `WorldRecord.marks`, the world's half.
 */
export const MapMarks = Object.freeze({
    /**
     * The marks for a map's state, most pressing first. Pure.
     * @param {{hasRun?: boolean, runEdited?: boolean, older?: boolean, regionalStale?: boolean}} state
     * @param {{noRun?: boolean}} [options] - noRun: false leaves No run out (where a line says so already)
     * @returns {Array<{kind: string, icon: string, label: string}>} labels as localisation keys
     */
    of(state, { noRun = true } = {}) {
        const marks = [];
        if (state.regionalStale) marks.push(MARKS.regionalStale);
        if (!state.hasRun) {
            if (noRun) marks.push(MARKS.noRun);
        } else {
            if (state.runEdited) marks.push(MARKS.runEdited);
            if (state.older) marks.push(MARKS.older);
        }
        return marks;
    },

    /** The open Surface map's state, as `of` reads it. */
    state(app, { regionalStale = false } = {}) {
        const hasRun = !!app.modelRun || !!app.uiState?.parentRun;
        return {
            hasRun,
            runEdited: hasRun && RunInputs.stale(app),
            older: hasRun && GeneratorRevision.isOlder(app.uiState),
            regionalStale,
        };
    },

    /** Marks with their labels localised, for a template. */
    named(marks) {
        return marks.map((mark) => ({ ...mark, label: platform.i18n.localize(mark.label) }));
    },

    /** The kinds, for tests. */
    MARKS,
});
