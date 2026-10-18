import { InspectorFields } from "./InspectorFields.js";
import { MapDialogManager } from "./MapDialogManager.js";
import { MapStateManager } from "./MapStateManager.js";
import { StyleEditors } from "./StyleEditors.js";
import { Inspector } from "./Inspector.js";
import { ListNav } from "../ui/ListNav.js";
import { getPinIconPickerList } from "../data/pinIcons.js";
import { uniqueName } from "../mesh/LayerTree.js";
import { platform } from "../platform/index.js";

/** The style types in Styles and icons' order, each with its section and its strings. */
const LISTS = Object.freeze([
    Object.freeze({ type: "Pin", section: "pinStyles", title: "FILRODENSWMB.UI.SettingsPinQuickStyles", add: "FILRODENSWMB.UI.AddPinQuickStyle", users: "FILRODENSWMB.UI.StyleUsersPin" }),
    Object.freeze({ type: "Route", section: "routeStyles", title: "FILRODENSWMB.UI.SettingsRouteQuickStyles", add: "FILRODENSWMB.UI.AddRouteQuickStyle", users: "FILRODENSWMB.UI.StyleUsersRoute" }),
    Object.freeze({ type: "Region", section: "regionStyles", title: "FILRODENSWMB.UI.SettingsRegionQuickStyles", add: "FILRODENSWMB.UI.AddRegionQuickStyle", users: "FILRODENSWMB.UI.StyleUsersRegion" }),
    Object.freeze({ type: "Label", section: "labelStyles", title: "FILRODENSWMB.UI.SettingsLabelQuickStyles", add: "FILRODENSWMB.UI.AddLabelQuickStyle", users: "FILRODENSWMB.UI.StyleUsersLabel" }),
]);

/**
 * The style lists of Styles and icons (pin, route and label styles and region fills), and what
 * their rows do:
 *
 * - **Open.** A row's click, or Enter, opens its style in the inspector, focus staying on the row
 *   (see StyleEditors).
 * - **Add.** Each list ends with an add row ("+ Route style"). It puts a naming row at the list's
 *   foot, its name field focused with the next free name chosen. Enter (or leaving the field)
 *   makes the style, as one undo step, with the fields the bar would give the next object of its
 *   kind, and opens it in the inspector, focus going back to its row. Escape, or an empty name,
 *   takes the row away and records nothing.
 * - **The row's menu.** Rename names it in its row the same way; Duplicate adds "<name> copy" and
 *   opens it; Delete asks first, saying how many objects use the style (they keep its look, as
 *   Custom). Each is one undo step.
 *
 * The naming state lives on the studio (`app.styleNaming`), so a redraw of the panel keeps the
 * row and what was typed in it.
 */
export class StyleLists {
    /** The localisation key naming each style type's naming field. */
    static #NAMING_LABEL = "FILRODENSWMB.UI.StyleName";

    /**
     * The four lists as Styles and icons draws them: each style with its preview, its usage count
     * and whether the inspector shows it, the naming row where one is open, and the add row.
     * @param {object} app
     * @returns {object[]}
     */
    static context(app) {
        const shown = Inspector.current(app);
        const naming = app.styleNaming ?? null;
        const byName = (a, b) => (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" });
        return LISTS.map((list) => {
            const spec = InspectorFields.STYLE_TYPES[list.type];
            const styles = [...(app.uiState[spec.registryKey] ?? [])].sort(byName);
            const rows = styles.map((style) => {
                if (naming?.type === list.type && naming.id === style.id) return { naming: true, value: naming.value, label: this.#NAMING_LABEL };
                return {
                    id: style.id,
                    name: style.name,
                    usageCount: StyleEditors.usageCount(app, list.type, style.id),
                    selected: shown?.kind === StyleEditors.KINDS[list.type] && shown.ref.id === style.id,
                    preview: this.#preview(list.type, style),
                };
            });
            if (naming?.type === list.type && !naming.id) rows.push({ naming: true, value: naming.value, label: this.#NAMING_LABEL });
            return { ...list, count: styles.length, rows, empty: styles.length === 0 && !naming };
        });
    }

    /** A row's preview: a route's line, a region's fill, "Aa" in a label style's face, a pin's icon. */
    static #preview(type, style) {
        switch (type) {
            case "Route":
                return { line: true, color: style.color, thickness: style.thickness ?? 2, stroke: style.style ?? "solid" };
            case "Region":
                return { fill: true, color: style.fillColor === "transparent" ? null : style.fillColor };
            case "Label":
                return { text: true, family: style.fontFamily, color: style.fillColor, weight: style.bold === false ? "normal" : "bold", slant: style.italic ? "italic" : "normal" };
            default:
                return { icon: true, key: style.icon, ...this.#iconSource(style.icon) };
        }
    }

    /** Whether a pin style's icon is an uploaded image, and its path. */
    static #iconSource(icon) {
        const entry = getPinIconPickerList(icon).find((candidate) => candidate.key === icon);
        return { isCustom: entry?.isCustom ?? false, path: entry?.path ?? "" };
    }

    /** + <type> style: a naming row at the list's foot. */
    static async startAdding(app, type) {
        const spec = InspectorFields.STYLE_TYPES[type];
        if (!spec) return;
        app.styleNaming = { type, id: null, value: uniqueName(platform.i18n.localize(spec.nameKey), app.uiState[spec.registryKey] ?? []) };
        await this.#focusNaming(app);
    }

    /** Rename: the style's row becomes its naming row. */
    static async startRename(app, type, id) {
        const style = StyleEditors.find(app, type, id);
        if (!style) return;
        app.styleNaming = { type, id, value: style.name };
        await this.#focusNaming(app);
    }

    /** Lets go of a style being named, making nothing (a tool change, a map opened). */
    static reset(app) {
        app.styleNaming = null;
    }

    /** Escape in the naming row: the row goes, and nothing is recorded. */
    static async cancel(app) {
        const naming = app.styleNaming;
        if (!naming) return;
        app.styleNaming = null;
        await app.view?.render(["context"]);
        this.focusRow(app, naming.type, naming.id);
    }

    /**
     * Enter in the naming row, or focus leaving it: the style is made (or renamed) with the name
     * typed, as one undo step. A new style opens in the inspector. An empty name makes nothing.
     * @param {object} app
     * @param {string} value
     * @returns {Promise<string|null>} The id of the style made or renamed, or null.
     */
    static async confirm(app, value) {
        const naming = app.styleNaming;
        if (!naming) return null;
        app.styleNaming = null;
        const name = String(value ?? "").trim();
        let id = null;
        if (name && naming.id) {
            const style = StyleEditors.find(app, naming.type, naming.id);
            if (style && style.name !== name) {
                MapStateManager.pushVectorState(app);
                style.name = name;
                app.markDirty();
            }
            id = style?.id ?? null;
            await Inspector.refresh(app);
        } else if (name) {
            const config = MapDialogManager.QUICK_STYLE_CONFIG[naming.type];
            id = this.#add(app, naming.type, { ...config.getDefaults(app), name });
            await StyleEditors.open(app, naming.type, id, { keepFocus: true });
        }
        await app.view?.render(["context", "editToolbar"]);
        this.focusRow(app, naming.type, id ?? naming.id);
        return id;
    }

    /** Duplicate: "<name> copy" (or "<name> copy 2"…), with the style's fields, opened in the inspector. */
    static async duplicate(app, type, id) {
        const style = StyleEditors.find(app, type, id);
        if (!style) return null;
        const spec = InspectorFields.STYLE_TYPES[type];
        const { id: _id, ...fields } = structuredClone(style);
        const name = uniqueName(platform.i18n.format("FILRODENSWMB.UI.StyleCopyName", { name: style.name }), app.uiState[spec.registryKey] ?? []);
        const copy = this.#add(app, type, { ...fields, name });
        await StyleEditors.open(app, type, copy, { keepFocus: true });
        await app.view?.render(["context", "editToolbar"]);
        this.focusRow(app, type, copy);
        return copy;
    }

    /**
     * Delete, once confirmed in a dialogue that says how many objects use the style: the style
     * goes and they become Custom, keeping their look. One undo step.
     * @returns {Promise<boolean>} Whether it was deleted.
     */
    static async delete(app, type, id) {
        const style = StyleEditors.find(app, type, id);
        const config = MapDialogManager.QUICK_STYLE_CONFIG[type];
        if (!style || !config) return false;
        const count = StyleEditors.usageCount(app, type, id);
        const users = LISTS.find((list) => list.type === type).users;
        const name = platform.utils.escapeHtml(style.name);
        const key = count === 0 ? "FILRODENSWMB.UI.StyleDeleteUnused" : count === 1 ? "FILRODENSWMB.UI.StyleDeleteUsedOne" : "FILRODENSWMB.UI.StyleDeleteUsed";
        const message = platform.i18n.format(key, { count, name, one: platform.i18n.localize(`${users}One`), many: platform.i18n.localize(users) });
        const confirmed = await platform.dialogs.confirm({ title: platform.i18n.format("FILRODENSWMB.UI.StyleDeleteTitle", { name }), content: `<p>${message}</p>` });
        if (!confirmed) return false;
        MapStateManager.pushVectorState(app);
        app.uiState[config.registryKey] = (app.uiState[config.registryKey] ?? []).filter((candidate) => candidate.id !== id);
        config.onDisconnect(app, id);
        if (app.uiState[config.activeStateKey] === id) app.uiState[config.activeStateKey] = "custom";
        app._repaintVectors();
        app.markDirty();
        await Inspector.refresh(app);
        await app.view?.render(["context", "editToolbar"]);
        this.focusRow(app, type, null);
        return true;
    }

    /** Adds a style to its list as one undo step, returning its id. */
    static #add(app, type, fields) {
        const spec = InspectorFields.STYLE_TYPES[type];
        const style = { id: platform.utils.randomID(), ...fields };
        MapStateManager.pushVectorState(app);
        app.uiState[spec.registryKey] ??= [];
        app.uiState[spec.registryKey].push(style);
        app.markDirty();
        return style.id;
    }

    /** Moves focus to a style's row, or into its list when it is not there. */
    static focusRow(app, type, id) {
        const list = app.root?.querySelector(`[data-style-list="${type}"]`);
        if (!list) return;
        const target = (id && list.querySelector(`[data-list-item][data-id="${CSS.escape(id)}"]`)) || list.querySelector('[data-list-item][tabindex="0"]') || list.querySelector("[data-list-item]");
        if (target) ListNav.moveTo(list, target);
    }

    /**
     * The naming field's keys: Enter makes the style, Escape lets it go. Returns whether the key
     * was the field's, so the studio leaves it alone.
     */
    static handleKey(app, event) {
        const field = event.target;
        if (!field?.matches?.("[data-style-naming]")) return false;
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

    /**
     * Focus leaving the naming field makes the style, as Enter does, unless the focus left the
     * window (the field is still the focused element once the window is back).
     */
    static handleFocusOut(app, event) {
        const field = event.target;
        if (!field?.matches?.("[data-style-naming]") || !app.styleNaming) return;
        const naming = app.styleNaming;
        const commit = () => {
            if (app.styleNaming !== naming) return;
            if (field.ownerDocument.activeElement === field) return;
            this.confirm(app, field.value);
        };
        if (event.relatedTarget) commit();
        else setTimeout(commit, 0);
    }

    /** What is typed in the naming field is kept with the naming state, so a redraw keeps it. */
    static handleInput(app, event) {
        if (event.target?.matches?.("[data-style-naming]") && app.styleNaming) app.styleNaming.value = event.target.value;
    }

    /** Draws the naming row and puts the cursor in it, its name chosen so typing replaces it. */
    static async #focusNaming(app) {
        await app.view?.render(["context"]);
        const field = app.root?.querySelector("[data-style-naming]");
        if (!field) return;
        field.focus();
        field.select();
        field.scrollIntoView?.({ block: "nearest" });
    }
}
