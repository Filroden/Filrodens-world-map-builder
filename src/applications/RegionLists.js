import { LayerSetEditor, LevelEditor } from "./LayerEditors.js";
import { RegionEditor } from "./RegionEditor.js";
import { RegionPanel } from "./RegionPanel.js";
import { FILRODENSWMB } from "../config.js";

/** The accessible names of the naming row's field, by what it names. */
const NAMING_LABELS = Object.freeze({
    set: "FILRODENSWMB.UI.NameNewSet",
    region: "FILRODENSWMB.UI.NameNewRegion",
    rename: "FILRODENSWMB.UI.Rename",
});

/**
 * The Regions lists' behaviour on the page (the lists themselves are RegionPanel.sections):
 *
 * - **Naming.** An add row (+ Set, + Region in <parent>) or a
 *   Rename puts a row in naming state, with its name field focused and the next free name
 *   chosen. Enter (or leaving the field) makes the entry, as one undo step, then chooses it and
 *   opens it in the inspector, focus going back to its row; a new region also becomes the region
 *   painted. Escape, or an empty name, takes the row away and records nothing. A level is renamed
 *   in its heading the same way. The naming state lives on the studio (`app.regionNaming`), so a
 *   redraw of the panel keeps the row and what was typed in it.
 * - **Keys.** Each list is one tab stop (see RegionPanel.context). Up and Down move through its
 *   rows and its add row, Home and End to the first and last; Enter opens a row in the inspector
 *   (or opens and closes Unassigned, as Right and Left do).
 */
export class RegionLists {
    /**
     * Starts naming a new entry: a set, or a region of a layer's list (inside the region the list
     * is filtered to).
     * @param {object} app
     * @param {"set"|"region"} kind
     * @param {{levelId?: string, parentId?: string}} [where]
     */
    static async startNaming(app, kind, { levelId = null, parentId = null } = {}) {
        if (kind === "region" && !levelId) return;
        const naming = { kind, levelId, parentId, label: NAMING_LABELS[kind] };
        if (kind === "set") naming.value = RegionPanel.suggestedName(app, "set");
        if (kind === "region") {
            naming.value = RegionPanel.suggestedName(app, "region", { levelId });
            naming.swatch = this.#nextSwatch(app, RegionPanel.objectOf(app, `level:${levelId}`));
        }
        app.regionNaming = naming;
        await this.#focusNaming(app);
    }

    /**
     * + Layer below (or + Layer in a set with none): the next layer, made at once with its default
     * name ("Layer <tier>", renamable from its heading) and opened in the inspector, focus going to
     * its heading.
     */
    static async addLayer(app, { setId = null, levelId = null }) {
        const id = RegionPanel.addLayerBelow(app, { setId, levelId });
        if (!id) return;
        await LevelEditor.open(app, id, { created: true });
        await app.view?.render(["context"]);
        this.focusRow(app, `level:${id}`);
    }

    /** Starts renaming a set, level or region in its own row or heading (its key). */
    static async startRename(app, key) {
        const object = RegionPanel.objectOf(app, key);
        if (!object) return;
        app.regionNaming = { kind: "rename", key, value: object.name, swatch: null, label: NAMING_LABELS.rename };
        await this.#focusNaming(app);
    }

    /** Whether an entry is being named. */
    static isNaming(app) {
        return !!app.regionNaming;
    }

    /** Lets go of an entry being named, making nothing (a tool change, a map opened). */
    static reset(app) {
        app.regionNaming = null;
    }

    /** Escape in the naming row: the row goes, and nothing is recorded. */
    static async cancel(app) {
        const naming = app.regionNaming;
        if (!naming) return;
        app.regionNaming = null;
        await app.view?.render(["context"]);
        this.focusRow(app, naming.kind === "rename" ? naming.key : null);
    }

    /**
     * Enter in the naming row, or focus leaving it: the entry is made (or renamed) with the name
     * typed, then chosen and opened in the inspector. An empty name makes nothing.
     * @param {object} app
     * @param {string} value - What the naming field holds.
     * @returns {Promise<string|null>} The key of the row made or renamed, or null.
     */
    static async confirm(app, value) {
        const naming = app.regionNaming;
        if (!naming) return null;
        app.regionNaming = null;
        const name = String(value ?? "").trim();
        if (!name) {
            await app.view?.render(["context"]);
            return null;
        }
        let key = null;
        switch (naming.kind) {
            case "set": {
                const id = RegionPanel.createSet(app, name);
                key = `set:${id}`;
                await LayerSetEditor.open(app, id, { created: true });
                break;
            }
            case "region": {
                const region = RegionPanel.createRegion(app, naming.levelId, name, naming.parentId);
                if (!region) break;
                key = `region:${region.id}`;
                await RegionEditor.open(app, region.levelId, region.id, { created: true });
                break;
            }
            case "rename":
                key = naming.key;
                if (!RegionPanel.rename(app, key, name)) await app.view?.render(["context"]);
                break;
        }
        await app.view?.render(["context"]);
        this.focusRow(app, key);
        return key;
    }

    /** Opens or closes a level's Unassigned row. */
    static toggleUnassigned(app, levelId) {
        if (!levelId) return;
        RegionPanel.toggleUnassigned(app, levelId);
        app.view?.render(["context"]);
    }

    /**
     * Moves focus to a row (by its key) or a level's heading, or into the lists when it is not
     * there.
     */
    static focusRow(app, key) {
        const panel = app.root?.querySelector(".fwmb-region-panel");
        if (!panel) return;
        const target = (key && panel.querySelector(`[data-list-key="${CSS.escape(key)}"]`)) || panel.querySelector('.fwmb-region-list [tabindex="0"]');
        if (!target) return;
        const list = target.closest(".fwmb-region-list");
        if (list) this.#moveTo(list, target);
        else (target.localName === "details" ? target.querySelector(":scope > summary") : target).focus();
    }

    /**
     * The lists' keys (see the class comment). Returns whether the key was the lists', so the
     * studio leaves it alone.
     * @param {object} app
     * @param {KeyboardEvent} event
     * @returns {boolean}
     */
    static handleKey(app, event) {
        const target = event.target;
        if (target?.matches?.("[data-list-naming]")) return this.#namingKey(app, event, target);
        const list = target?.closest?.(".fwmb-region-list");
        if (!list || !target.matches("[data-list-item]") || event.altKey || event.ctrlKey || event.metaKey) return false;

        const items = [...list.querySelectorAll("[data-list-item]")];
        const index = items.indexOf(target);
        const unassigned = target.dataset.listKey?.startsWith("unassigned:");
        switch (event.key) {
            case "ArrowDown":
                if (index < items.length - 1) this.#moveTo(list, items[index + 1]);
                return true;
            case "ArrowUp":
                if (index > 0) this.#moveTo(list, items[index - 1]);
                return true;
            case "Home":
                this.#moveTo(list, items[0]);
                return true;
            case "End":
                this.#moveTo(list, items.at(-1));
                return true;
            case "ArrowRight":
            case "ArrowLeft":
                if (!unassigned) return false;
                if ((target.getAttribute("aria-expanded") === "true") !== (event.key === "ArrowRight")) this.toggleUnassigned(app, target.dataset.levelId);
                return true;
            case "Enter":
                // An add button is a button: the browser presses it
                if (target.localName === "button") return false;
                if (unassigned) this.toggleUnassigned(app, target.dataset.levelId);
                else this.#open(app, target);
                return true;
            default:
                return false;
        }
    }

    /**
     * Focus leaving the naming field makes the entry, as Enter does, unless the focus left the
     * window (the field is still the focused element once the window is back).
     */
    static handleFocusOut(app, event) {
        const field = event.target;
        if (!field?.matches?.("[data-list-naming]") || !app.regionNaming) return;
        const naming = app.regionNaming;
        const commit = () => {
            if (app.regionNaming !== naming) return;
            if (field.ownerDocument.activeElement === field) return;
            this.confirm(app, field.value);
        };
        if (event.relatedTarget) commit();
        else setTimeout(commit, 0);
    }

    /** What is typed in the naming field is kept with the naming state, so a redraw keeps it. */
    static handleInput(app, event) {
        if (event.target?.matches?.("[data-list-naming]") && app.regionNaming) app.regionNaming.value = event.target.value;
    }

    static #namingKey(app, event, field) {
        if (event.key === "Enter") {
            event.stopPropagation();
            this.confirm(app, field.value);
            return true;
        }
        if (event.key === "Escape") {
            event.stopPropagation();
            this.cancel(app);
            return true;
        }
        // Space in a field in a level's heading would otherwise fold the list
        if (event.key === " ") event.stopPropagation();
        return false;
    }

    /** Enter on a row: its inspector (a region is chosen and painted, as a click does). */
    static #open(app, row) {
        const [type, id] = (row.dataset.listKey ?? "").split(":");
        if (type === "set") LayerSetEditor.open(app, id);
        else if (type === "level") LevelEditor.open(app, id);
        else if (type === "region") RegionEditor.open(app, row.dataset.layerId, id);
    }

    /** Draws the naming row and puts the cursor in it, its name chosen so typing replaces it. */
    static async #focusNaming(app) {
        await app.view?.render(["context"]);
        const field = app.root?.querySelector("[data-list-naming]");
        if (!field) return;
        field.focus();
        field.select();
        field.scrollIntoView?.({ block: "nearest" });
    }

    /** Makes an item its list's tab stop and focuses it. */
    static #moveTo(list, item) {
        for (const other of list.querySelectorAll('[data-list-item][tabindex="0"]')) if (other !== item) other.tabIndex = -1;
        item.tabIndex = 0;
        item.focus();
        item.scrollIntoView?.({ block: "nearest" });
    }

    /** The colour a new region of a level will be filled with (the level's next preset, or the bar's style). */
    static #nextSwatch(app, level) {
        const style = (app.uiState?.customRegionStyles ?? []).find((candidate) => candidate.id === app.uiState.activeRegionQuickStyle);
        if (style?.fillColor) return style.fillColor;
        const presets = FILRODENSWMB.REGIONS.PRESETS;
        return level ? presets[level.nextKey % presets.length] : null;
    }
}
