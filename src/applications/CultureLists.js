import { FILRODENSWMB } from "../config.js";
import { CultureEditor } from "./CultureEditor.js";
import { Inspector } from "./Inspector.js";
import { MapStateManager } from "./MapStateManager.js";
import { ListNav } from "../ui/ListNav.js";
import { Sanitize } from "../data/Sanitize.js";
import { uniqueName } from "../mesh/LayerTree.js";
import { platform } from "../platform/index.js";

/**
 * The Generate panel's Cultures section: the map's cultures (uiState.cultures; see CultureInput
 * for what a run reads of them), and what their rows do. It works as the style lists of Styles and
 * icons do (see StyleLists):
 *
 * - **Open.** A row's click, or Enter, opens its culture in the inspector (see CultureEditor),
 *   focus staying on the row.
 * - **Add.** The list ends with "+ Culture". It puts a naming row at the list's foot with the next
 *   free name chosen; Enter (or leaving the field) makes the culture, as one undo step, and opens
 *   it in the inspector. Escape, or an empty name, records nothing. The list holds at most
 *   GENERATOR.CULTURES.MAX.
 * - **The row's menu.** Rename in its row; Duplicate adds "<name> copy" with its fields and
 *   homelands; Delete asks first. Each is one undo step.
 *
 * With no cultures the run uses the single default culture and the panel's Name style, which the
 * Generation section shows only then. Any change to the cultures marks a run made before it out
 * of date.
 *
 * The naming state lives on the studio (`app.cultureNaming`), so a redraw keeps it.
 */
export class CultureLists {
    static #NAMING_LABEL = "FILRODENSWMB.UI.CultureName";

    /**
     * The section's rows: each culture with its swatch, its name style's name and whether the
     * inspector shows it, the naming row where one is open, and whether another may be added.
     * @param {object} app
     */
    static context(app) {
        const shown = Inspector.current(app);
        const naming = app.cultureNaming ?? null;
        const cultures = app.uiState.cultures ?? [];
        const rows = cultures.map((culture) => {
            if (naming?.id === culture.id) return { naming: true, value: naming.value, label: this.#NAMING_LABEL };
            return {
                id: culture.id,
                name: culture.name,
                color: culture.color,
                names: platform.i18n.localize(`FILRODENSWMB.NameBase.${String(culture.nameBase ?? "").replaceAll(" ", "")}`),
                homelands: (culture.homelands ?? []).length,
                selected: shown?.kind === CultureEditor.KIND && shown.ref.id === culture.id,
            };
        });
        if (naming && !naming.id) rows.push({ naming: true, value: naming.value, label: this.#NAMING_LABEL });
        return { rows, count: cultures.length, empty: cultures.length === 0 && !naming, canAdd: cultures.length < FILRODENSWMB.GENERATOR.CULTURES.MAX };
    }

    /** + Culture: a naming row at the list's foot. */
    static async startAdding(app) {
        if ((app.uiState.cultures ?? []).length >= FILRODENSWMB.GENERATOR.CULTURES.MAX) return;
        app.cultureNaming = { id: null, value: uniqueName(platform.i18n.localize("FILRODENSWMB.UI.CultureNewName"), app.uiState.cultures ?? []) };
        await this.#focusNaming(app);
    }

    /** Rename: the culture's row becomes its naming row. */
    static async startRename(app, id) {
        const culture = CultureEditor.find(app, id);
        if (!culture) return;
        app.cultureNaming = { id, value: culture.name };
        await this.#focusNaming(app);
    }

    /** Lets go of a culture being named, making nothing (a tool change, a map opened). */
    static reset(app) {
        app.cultureNaming = null;
    }

    /** Escape in the naming row: the row goes, and nothing is recorded. */
    static async cancel(app) {
        const naming = app.cultureNaming;
        if (!naming) return;
        app.cultureNaming = null;
        await app.view?.render(["context"]);
        this.focusRow(app, naming.id);
    }

    /**
     * Enter in the naming row, or focus leaving it: the culture is made (or renamed) with the name
     * typed, as one undo step. A new culture opens in the inspector. An empty name makes nothing.
     * @returns {Promise<string|null>} The id of the culture made or renamed, or null.
     */
    static async confirm(app, value) {
        const naming = app.cultureNaming;
        if (!naming) return null;
        app.cultureNaming = null;
        const name = Sanitize.text(String(value ?? ""))?.trim().slice(0, Sanitize.textLimit("name")) ?? "";
        let id = null;
        if (name && naming.id) {
            const culture = CultureEditor.find(app, naming.id);
            if (culture && culture.name !== name) {
                MapStateManager.pushVectorState(app);
                culture.name = name;
                this.#changed(app);
            }
            id = culture?.id ?? null;
            await Inspector.refresh(app);
        } else if (name) {
            id = this.#add(app, CultureEditor.defaults(app, name));
            await CultureEditor.open(app, id, { keepFocus: true });
        }
        await app.view?.render(["context"]);
        this.focusRow(app, id ?? naming.id);
        return id;
    }

    /** Duplicate: "<name> copy" with the culture's fields and homelands, opened in the inspector. */
    static async duplicate(app, id) {
        const culture = CultureEditor.find(app, id);
        if (!culture || (app.uiState.cultures ?? []).length >= FILRODENSWMB.GENERATOR.CULTURES.MAX) return null;
        const { id: _id, ...fields } = structuredClone(culture);
        const name = uniqueName(platform.i18n.format("FILRODENSWMB.UI.StyleCopyName", { name: culture.name }), app.uiState.cultures ?? []);
        const copy = this.#add(app, { ...fields, name });
        await CultureEditor.open(app, copy, { keepFocus: true });
        await app.view?.render(["context"]);
        this.focusRow(app, copy);
        return copy;
    }

    /**
     * Delete, once confirmed: the culture goes. Places a run named after it keep their names (their
     * generated details still name the culture, as it was). One undo step.
     * @returns {Promise<boolean>} Whether it was deleted.
     */
    static async delete(app, id) {
        const culture = CultureEditor.find(app, id);
        if (!culture) return false;
        const message = platform.i18n.format("FILRODENSWMB.UI.CultureDeleteConfirm", { name: culture.name });
        const confirmed = await platform.dialogs.confirm({ title: platform.i18n.format("FILRODENSWMB.UI.CultureDeleteTitle", { name: culture.name }), content: `<p>${Sanitize.escapeHtml(message)}</p>` });
        if (!confirmed) return false;
        MapStateManager.pushVectorState(app);
        app.uiState.cultures = (app.uiState.cultures ?? []).filter((candidate) => candidate.id !== id);
        this.#changed(app);
        await Inspector.refresh(app);
        await app.view?.render(["context"]);
        this.focusRow(app, null);
        return true;
    }

    /** Adds a culture as one undo step, returning its id. */
    static #add(app, fields) {
        const culture = { id: platform.utils.randomID(), ...fields };
        MapStateManager.pushVectorState(app);
        app.uiState.cultures ??= [];
        app.uiState.cultures.push(culture);
        this.#changed(app);
        return culture.id;
    }

    /** The cultures changed: the map is unsaved, and a run made before is out of date. */
    static #changed(app) {
        app.markGeneratorStale?.();
        app.markDirty();
    }

    /** Moves focus to a culture's row, or into the list when it is not there. */
    static focusRow(app, id) {
        const list = app.root?.querySelector("[data-culture-list]");
        if (!list) return;
        const target = (id && list.querySelector(`[data-list-item][data-id="${CSS.escape(id)}"]`)) || list.querySelector('[data-list-item][tabindex="0"]') || list.querySelector("[data-list-item]");
        if (target) ListNav.moveTo(list, target);
    }

    /** The naming field's keys: Enter makes the culture, Escape lets it go. Returns whether the key was the field's. */
    static handleKey(app, event) {
        const field = event.target;
        if (!field?.matches?.("[data-culture-naming]")) return false;
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
        return false;
    }

    /** Focus leaving the naming field makes the culture, as Enter does, unless it left the window. */
    static handleFocusOut(app, event) {
        const field = event.target;
        if (!field?.matches?.("[data-culture-naming]") || !app.cultureNaming) return;
        const naming = app.cultureNaming;
        const commit = () => {
            if (app.cultureNaming !== naming) return;
            if (field.ownerDocument.activeElement === field) return;
            this.confirm(app, field.value);
        };
        if (event.relatedTarget) commit();
        else setTimeout(commit, 0);
    }

    /** What is typed in the naming field is kept with the naming state, so a redraw keeps it. */
    static handleInput(app, event) {
        if (event.target?.matches?.("[data-culture-naming]") && app.cultureNaming) app.cultureNaming.value = event.target.value;
    }

    static async #focusNaming(app) {
        await app.view?.render(["context"]);
        const field = app.root?.querySelector("[data-culture-naming]");
        if (!field) return;
        field.focus();
        field.select();
        field.scrollIntoView?.({ block: "nearest" });
    }
}
