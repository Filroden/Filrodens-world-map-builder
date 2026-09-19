/** Label of the catch-all row for time the phases above it did not account for. */
const UNMEASURED_LABEL = "Other (unmeasured)";

/** Gap, in characters, between a phase's label column and its timing column. */
const COLUMN_GAP = 2;

/**
 * Collects how long each phase of a full map render takes, so a single console summary can show
 * where the time went. The individual phases already log their own times as they finish, but
 * those lines only cover the work each phase does itself: they leave out the canvas repaint, the
 * pauses that let the processing overlay paint, and anything else between phases, which on a
 * large map makes the logged times add up to noticeably less than the render actually took.
 *
 * Phases are keyed by label, and a phase that runs more than once in a render adds up. Timing
 * only ever reads the clock, so it never changes what a render produces. The timer is not
 * re-entrant: renders that overlap share one set of phases, so their numbers blend together.
 */
export class RenderTimer {
    #startedAt = performance.now();
    #phases = new Map();

    /**
     * Starts timing a new render, discarding the phases of the previous one.
     */
    begin() {
        this.#phases.clear();
        this.#startedAt = performance.now();
    }

    /**
     * Adds an already-measured duration to a phase.
     *
     * @param {string} label - Phase name; repeated labels add up.
     * @param {number} milliseconds - Time taken.
     * @param {string} [note] - Optional detail shown beside the phase, such as how many items it processed.
     */
    record(label, milliseconds, note = "") {
        const phase = this.#phases.get(label) ?? { milliseconds: 0, note: "" };
        phase.milliseconds += milliseconds;
        if (note) phase.note = note;
        this.#phases.set(label, phase);
    }

    /**
     * Records the time since `since` against a phase and returns the current time, so consecutive
     * phases inside one function can be timed by chaining: `mark = timer.lap("A", mark)`.
     *
     * @param {string} label - Phase name; repeated labels add up.
     * @param {number} since - A performance.now() reading from when the phase started.
     * @param {string} [note] - Optional detail shown beside the phase.
     * @returns {number} The current performance.now() reading, to start the next phase from.
     */
    lap(label, since, note = "") {
        const now = performance.now();
        this.record(label, now - since, note);
        return now;
    }

    /**
     * Builds the multi-line summary of the render since begin(): one row per phase in the order
     * they first ran, its share of the total, and a final row for whatever time no phase claimed.
     *
     * @returns {string} The summary, ready to log.
     */
    summarise() {
        const total = performance.now() - this.#startedAt;
        const rows = [...this.#phases].map(([label, phase]) => ({ label, ...phase }));

        const measured = rows.reduce((sum, row) => sum + row.milliseconds, 0);
        rows.push({ label: UNMEASURED_LABEL, milliseconds: Math.max(0, total - measured), note: "" });

        const labelWidth = Math.max(...rows.map((row) => row.label.length)) + COLUMN_GAP;
        const lines = rows.map((row) => this.#formatRow(row, labelWidth, total));

        return `World Map Builder | Full render took ${total.toFixed(2)}ms\n${lines.join("\n")}`;
    }

    #formatRow(row, labelWidth, total) {
        const time = `${row.milliseconds.toFixed(1)}ms`.padStart(11);
        const share = `${total > 0 ? ((row.milliseconds / total) * 100).toFixed(1) : "0.0"}%`.padStart(6);
        const note = row.note ? `  (${row.note})` : "";

        return `    ${row.label.padEnd(labelWidth)}${time} ${share}${note}`;
    }
}
