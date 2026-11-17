/** Label of the catch-all row for time the phases above it did not account for. */
const UNMEASURED_LABEL = "Other (unmeasured)";

/** Gap, in characters, between a phase's label column and its timing column. */
const COLUMN_GAP = 2;

/**
 * Collects how long each phase of a map render or edit takes, so a single console summary can
 * show where the time went. The individual phases already log their own times as they finish,
 * but those lines only cover the work each phase does itself: they leave out the canvas repaint,
 * the pauses that let the processing overlay paint, and anything else between phases, which on a
 * large map makes the logged times add up to noticeably less than the run actually took.
 *
 * A run is whatever a caller wraps in begin() and end(). Generation steps chain into each other
 * (a full render runs the climate step, which runs the features step), and each of those steps
 * can also be a run of its own when triggered alone, so begin() and end() nest: only the
 * outermost pair starts the clock and produces the summary, and the steps inside it just add
 * their phases to it.
 *
 * Phases are keyed by label, and a phase that runs more than once in a run adds up and is shown
 * with its run count, which makes repeated work such as a second full repaint visible. Timing only
 * ever reads the clock, so it never changes what a run produces. Runs that overlap in time,
 * because one starts while another is waiting on the overlay, are treated as one run, and
 * anything recorded while a run is open counts towards it.
 */
export class RenderTimer {
    #startedAt = performance.now();
    #phases = new Map();
    #title = "";
    #depth = 0;

    /**
     * Opens a run. If no run is open this starts a new one, discarding the phases of the
     * previous run; otherwise the caller is a step inside the open run and nothing is reset.
     *
     * @param {string} title - Names the run in the summary. Only the outermost call's title is used.
     */
    begin(title) {
        if (this.#depth === 0) {
            this.#phases.clear();
            this.#startedAt = performance.now();
            this.#title = title;
        }
        this.#depth++;
    }

    /**
     * Closes a run opened with begin().
     *
     * @returns {string|null} The summary if this closed the outermost run, otherwise null.
     */
    end() {
        this.#depth = Math.max(0, this.#depth - 1);
        return this.#depth === 0 ? this.#summarise() : null;
    }

    /**
     * Adds an already-measured duration to a phase.
     *
     * @param {string} label - Phase name; repeated labels add up.
     * @param {number} milliseconds - Time taken.
     * @param {string} [note] - Optional detail shown beside the phase, such as how many items it processed.
     */
    record(label, milliseconds, note = "") {
        const phase = this.#phases.get(label) ?? { milliseconds: 0, note: "", runs: 0 };
        phase.milliseconds += milliseconds;
        phase.runs++;
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
     * Builds the multi-line summary of the run since it began: one row per phase in the order
     * they first ran, its share of the total, and a final row for whatever time no phase claimed.
     *
     * @returns {string} The summary, ready to log.
     */
    #summarise() {
        const total = performance.now() - this.#startedAt;
        const rows = [...this.#phases].map(([label, phase]) => ({ label, ...phase }));

        const measured = rows.reduce((sum, row) => sum + row.milliseconds, 0);
        rows.push({ label: UNMEASURED_LABEL, milliseconds: Math.max(0, total - measured), note: "", runs: 1 });

        const labelWidth = Math.max(...rows.map((row) => row.label.length)) + COLUMN_GAP;
        const lines = rows.map((row) => this.#formatRow(row, labelWidth, total));

        return `FWMB | ${this.#title} took ${total.toFixed(2)}ms\n${lines.join("\n")}`;
    }

    #formatRow(row, labelWidth, total) {
        const time = `${row.milliseconds.toFixed(1)}ms`.padStart(11);
        const share = `${total > 0 ? ((row.milliseconds / total) * 100).toFixed(1) : "0.0"}%`.padStart(6);
        const details = [row.note, row.runs > 1 ? `${row.runs} runs` : ""].filter(Boolean).join(", ");
        const note = details ? `  (${details})` : "";

        return `    ${row.label.padEnd(labelWidth)}${time} ${share}${note}`;
    }
}
