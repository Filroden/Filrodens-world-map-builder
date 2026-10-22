import { platform } from "../platform/index.js";

/**
 * The rows of the map controls' Labels and Regions menus: which names and which region levels
 * the map shows, saved with the map (uiState.hiddenLabelStyles, uiState.hiddenLevels) and
 * followed by exports.
 *
 * - Labels: one row per label style the map's names use, and No style for names in none (or in a
 *   style since deleted). Turning a row off hides every name in that style; the names left are
 *   placed again, with the room freed.
 * - Regions: each layer set, its levels indented below it. Turning a level off hides its fill,
 *   borders and names in the view, without changing what players or the GM are shown (its saved
 *   visibility); a set's row turns all its levels on or off.
 * - Regions also ends with Fills (uiState.hideRegionFills): off draws every level's borders alone,
 *   at full strength, so a map can show where its regions lie without their colour. It is not a
 *   level, so All and the menu's state leave it out.
 *
 * Each menu's All row turns every row off when all are on, and every row on otherwise. A style
 * or level new to the map starts shown.
 */

/** The No style row's key: names in no style, or in one since deleted. */
export const NO_STYLE = "custom";

const GROUPS = Object.freeze({ labels: "hiddenLabelStyles", regions: "hiddenLevels" });

export class ContentRows {
    /** A group's hidden keys (style or level ids), as a set. */
    static hidden(app, group) {
        return new Set(app.uiState?.[GROUPS[group]] ?? []);
    }

    /** The row a label counts under: its style, if the map holds it, else No style. */
    static labelKey(app, labelData) {
        const id = labelData?.quickStyle;
        return id && (app.uiState?.customLabelStyles ?? []).some((style) => style.id === id) ? id : NO_STYLE;
    }

    /** Whether a label's row is on (its name may be drawn). */
    static labelShown(app) {
        const hidden = this.hidden(app, "labels");
        if (!hidden.size) return () => true;
        return (labelData) => !hidden.has(this.labelKey(app, labelData));
    }

    /** Whether the Regions menu's Fills row is on (the levels' fills are drawn). */
    static fillsShown(app) {
        return app.uiState?.hideRegionFills !== true;
    }

    /** Whether a region level's row is on. */
    static levelShown(app) {
        const hidden = this.hidden(app, "regions");
        return (level) => !hidden.has(level.id);
    }

    /**
     * Each menu's rows, with whether each is on, and the menu's own state (all on, some, none).
     * @param {object} app
     * @returns {{id: string, state: string, rows: {kind: string, key: string, label: string, on: boolean, sub?: boolean, separator?: boolean}[]}[]}
     */
    static groups(app) {
        return [this.#labelGroup(app), this.#regionGroup(app)];
    }

    static #labelGroup(app) {
        const hidden = this.hidden(app, "labels");
        const used = this.#stylesInUse(app);
        const styles = app.uiState?.customLabelStyles ?? [];
        const rows = styles.filter((style) => used.has(style.id)).map((style) => ({ kind: "style", key: style.id, label: style.name ?? style.id, on: !hidden.has(style.id) }));
        if (used.has(NO_STYLE)) rows.push({ kind: "style", key: NO_STYLE, label: platform.i18n.localize("FILRODENSWMB.UI.StyleNone"), on: !hidden.has(NO_STYLE) });
        return { id: "labels", state: stateOf(rows), rows };
    }

    /** The rows' keys of every name the map has (standalone labels, and named pins, routes and regions). */
    static #stylesInUse(app) {
        const used = new Set();
        const add = (labelData) => used.add(this.labelKey(app, labelData));
        for (const label of app.mapLabels ?? []) if (label.name) add(label);
        for (const pin of app.mapPins ?? []) if (pin.icon && pin.name) add(pin.label);
        for (const route of app.mapRoutes ?? []) if (route.name) add(route.label);
        for (const set of app.layerSets ?? []) for (const level of set.levels) for (const region of level.regions) if (region.name) add(region.label);
        return used;
    }

    static #regionGroup(app) {
        const hidden = this.hidden(app, "regions");
        const rows = [];
        for (const set of app.layerSets ?? []) {
            if (!set.levels.length) continue;
            const levels = set.levels.map((level) => ({ kind: "level", key: level.id, label: level.name, on: !hidden.has(level.id), sub: true }));
            rows.push({ kind: "set", key: set.id, label: set.name, on: levels.every((row) => row.on), mixed: levels.some((row) => row.on) && !levels.every((row) => row.on) }, ...levels);
        }
        const levels = rows.filter((row) => row.kind === "level");
        if (rows.length) rows.push({ kind: "fills", key: "fills", label: platform.i18n.localize("FILRODENSWMB.UI.RegionFills"), on: this.fillsShown(app), separator: true });
        return { id: "regions", state: stateOf(levels), rows };
    }

    /**
     * A row clicked: All, a style, a set or a level. Returns whether anything changed.
     * @param {object} app
     * @param {string} group - "labels" or "regions".
     * @param {string} kind - "all", "style", "set", "level" or "fills".
     * @param {string} [key]
     */
    static toggle(app, group, kind, key) {
        const field = GROUPS[group];
        if (!field) return false;
        if (kind === "fills") {
            app.uiState.hideRegionFills = this.fillsShown(app);
            return true;
        }
        const hidden = this.hidden(app, group);
        const { rows } = this.groups(app).find((entry) => entry.id === group);
        const keys = rows.filter((row) => row.kind === "style" || row.kind === "level").map((row) => row.key);
        if (kind === "all") {
            const allOn = keys.every((each) => !hidden.has(each));
            app.uiState[field] = allOn ? keys : [];
            return true;
        }
        const affected = kind === "set" ? (app.layerSets ?? []).find((set) => set.id === key)?.levels.map((level) => level.id) ?? [] : [key];
        if (!affected.length) return false;
        const turnOn = affected.some((each) => hidden.has(each));
        for (const each of affected) {
            if (turnOn) hidden.delete(each);
            else hidden.add(each);
        }
        app.uiState[field] = [...hidden];
        return true;
    }

    /** A tool showing its own content: every row of its group back on when all were off. Returns whether anything changed. */
    static ensureShown(app, group) {
        const entry = this.groups(app).find((each) => each.id === group);
        if (!entry || entry.state !== "off") return false;
        app.uiState[GROUPS[group]] = [];
        return true;
    }
}

/** A menu's state from its rows: all on, some on, or none (a menu with no rows counts as on). */
function stateOf(rows) {
    const on = rows.filter((row) => row.on).length;
    if (on === rows.length) return "on";
    return on === 0 ? "off" : "partial";
}
