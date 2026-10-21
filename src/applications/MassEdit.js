import { FILRODENSWMB } from "../config.js";
import { FieldSpecs } from "./FieldSpecs.js";
import { MapDialogManager } from "./MapDialogManager.js";
import { MapStateManager } from "./MapStateManager.js";
import { RangeDisplay } from "../tools/RangeDisplay.js";
import { roundRouteThickness } from "../mesh/Schema.js";
import { platform } from "../platform/index.js";
import { typed } from "../data/MapRules.js";

const TEMPLATE = "modules/filrodens-world-map-builder/templates/dialogs/mass-edit.hbs";
const TITLES = Object.freeze({
    pin: "FILRODENSWMB.UI.MassEditPinsTitle",
    route: "FILRODENSWMB.UI.MassEditRoutesTitle",
    region: "FILRODENSWMB.UI.MassEditRegionsTitle",
    label: "FILRODENSWMB.UI.MassEditLabelsTitle",
});
/** The value of a select left as is. */
const KEEP = "";

/**
 * Mass edit: the inspector's fields for several pins, routes, regions or standalone labels at once
 * (see FieldSpecs), in one dialogue drawn from the kind's field descriptions: the item's fields,
 * then (for a pin, route or region) its label's.
 *
 * **A field changes only if you change it.** On opening, each field shows the value the chosen
 * items share, or Mixed when they differ: a select (and a three-way On / Off, and visibility) offers
 * "Leave as is" first; a number is empty with the placeholder Mixed; a slider sits at the first
 * item's value with its display reading Mixed; a colour shows a split swatch. Touching a field
 * marks its row changed and shows ↺, which returns it to how it opened. Apply writes only the
 * changed rows, to every chosen item, as one undo step.
 *
 * **Styles** follow the inspector's rules (InspectorFields.settleStyle): a style picked writes its
 * fields (the dialogue shows them at once, in the rows it fills), and a styled field changed by
 * hand makes the items Custom (the dialogue moves the style to Custom as it is touched).
 */
export class MassEdit {
    /**
     * Opens the dialogue on the chosen items of a kind and applies what is confirmed. Confirming
     * (with or without changes) ends the choosing; cancelling keeps it, to choose again.
     * @param {object} app
     * @param {"pin"|"route"|"region"|"label"} type
     * @returns {Promise<boolean>} Whether anything changed.
     */
    static async open(app, type) {
        const kind = FieldSpecs.KINDS[type];
        const items = this.items(app, type);
        if (!kind || items.length === 0) return false;
        const content = await platform.templates.render(TEMPLATE, this.context(app, type, items));
        const changes = await platform.dialogs.prompt({
            classes: ["fwmb", "fwmb-mass-edit"],
            title: platform.i18n.format(TITLES[type], { count: items.length }),
            content,
            onRender: (element) => this.bind(app, type, element),
            onSubmit: (form) => this.read(form),
        });
        if (!changes) return false;
        const changed = this.apply(app, type, items, changes);
        app.massEditMode[type] = false;
        app.massEditSelection[type].clear();
        app.view?.render(["context"]);
        return changed;
    }

    /** The items of a kind chosen for mass edit. */
    static items(app, type) {
        const ids = app.massEditSelection?.[type] ?? new Set();
        switch (type) {
            case "pin":
                return app.mapPins.filter((pin) => ids.has(pin.id));
            case "route":
                return app.mapRoutes.filter((route) => ids.has(route.id));
            case "region":
                return app.regionLevels.flatMap((level) => level.regions).filter((region) => ids.has(region.id));
            case "label":
                return app.mapLabels.filter((label) => ids.has(label.id));
            default:
                return [];
        }
    }

    /**
     * The dialogue's context: a section of rows for the item's fields and, for a kind with a
     * label, one for its label's, each row with the shared value or Mixed.
     */
    static context(app, type, items) {
        const kind = FieldSpecs.KINDS[type];
        const currents = items.map((item) => kind.current(app, item));
        const rows = (store) => kind.fields.filter((field) => field.store === store).map((field) => this.#row(app, field, currents));
        const sections = [{ legend: kind.legend, rows: rows("item") }];
        if (kind.hasLabel) sections.push({ legend: "FILRODENSWMB.UI.InspectorLabel", rows: rows("label") });
        return { count: items.length, sections, palette: FILRODENSWMB.LABELS?.PRESETS || [] };
    }

    /** One field's row: its control's choices, and the value the items share (or Mixed). */
    static #row(app, field, currents) {
        const values = currents.map((current) => (field.store === "label" ? current.label?.[field.key] : current[field.key]));
        const first = values[0];
        const mixed = values.some((value) => JSON.stringify(value) !== JSON.stringify(first));
        const name = `${field.store}.${field.key}`;
        const row = {
            ...field,
            name,
            id: `fwmb-mass-${field.store}-${field.key}`,
            mixed,
            styleRow: field.type === "style",
            [`is${field.type[0].toUpperCase()}${field.type.slice(1)}`]: true,
        };
        const shared = mixed ? null : first;
        switch (field.type) {
            case "style":
            case "select":
            case "visibility":
                row.options = FieldSpecs.options(app, field).map((option) => ({ ...option, selected: !mixed && String(option.value) === String(shared ?? "") }));
                row.value = mixed ? KEEP : String(shared ?? "");
                break;
            case "bool":
                row.options = [
                    { value: "true", label: "FILRODENSWMB.UI.On", selected: !mixed && shared === true },
                    { value: "false", label: "FILRODENSWMB.UI.Off", selected: !mixed && shared === false },
                ];
                row.value = mixed ? KEEP : String(shared === true);
                break;
            case "font":
                row.groups = FieldSpecs.options(app, field).map((group) => ({ ...group, fonts: group.fonts.map((font) => ({ ...font, selected: !mixed && font.name === shared })) }));
                row.value = mixed ? KEEP : shared;
                break;
            case "icon": {
                const icons = FieldSpecs.options(app, field);
                row.icons = icons.map((icon) => ({ ...icon, selected: !mixed && icon.key === shared }));
                row.icon = mixed ? null : (icons.find((icon) => icon.key === shared) ?? { key: shared });
                row.value = mixed ? KEEP : shared;
                break;
            }
            case "fill":
                row.none = !mixed && shared === "transparent";
                row.value = shared && shared !== "transparent" ? shared : first && first !== "transparent" ? first : "#000000";
                break;
            case "color":
                row.value = first ?? "#000000";
                break;
            case "range":
                row.value = first ?? field.min;
                break;
            case "number":
                row.value = mixed ? "" : (shared ?? "");
                break;
        }
        // What ↺ puts back
        row.initial = JSON.stringify({ value: row.value, none: row.none ?? false });
        return row;
    }

    /**
     * Binds the dialogue's rows: a touched row is marked changed (a select back on Leave as is is
     * not), ↺ puts a row back as it opened, a style picked fills the rows it sets, and a styled
     * row touched moves its style to Custom.
     */
    static bind(app, type, element) {
        const kind = FieldSpecs.KINDS[type];
        const rowOf = (target) => target.closest?.("[data-mass-row]");
        const rows = new Map([...element.querySelectorAll("[data-mass-row]")].map((row) => [row.dataset.massRow, row]));
        const setChanged = (row, changed, fromStyle = false) => {
            row.classList.toggle("fwmb-is-changed", changed);
            row.classList.toggle("fwmb-is-mixed", !changed && row.dataset.mixed === "true");
            row.querySelector("[data-mass-reset]").hidden = !changed;
            if (fromStyle) row.dataset.fromStyle = "true";
            else delete row.dataset.fromStyle;
        };
        const onTouch = (event) => {
            const row = rowOf(event.target);
            if (!row || event.target.matches("[data-mass-reset]")) return;
            const value = this.#value(row);
            // A select back on Leave as is, or a number emptied, leaves the field as it is
            const keep = value === KEEP && !!row.querySelector('select, input[type="number"]');
            setChanged(row, !keep);
            row.querySelector(".fwmb-select-trigger")?.classList.remove("fwmb-is-mixed");
            if (row.matches("[data-style-row]")) {
                if (!keep && value !== "custom") this.#fillFromStyle(app, kind, row, value, rows, setChanged);
                return;
            }
            // A styled field changed by hand leaves the style
            if (row.matches("[data-styled]") && !keep) {
                const store = row.dataset.massRow.split(".")[0];
                const styleRow = [...rows.values()].find((candidate) => candidate.matches("[data-style-row]") && candidate.dataset.massRow.startsWith(`${store}.`));
                if (styleRow) {
                    styleRow.querySelector("select").value = "custom";
                    // Marked changed only when the items were not all Custom already
                    setChanged(styleRow, JSON.parse(styleRow.dataset.initial).value !== "custom");
                }
            }
        };
        element.addEventListener("input", onTouch);
        element.addEventListener("change", onTouch);
        element.addEventListener("click", (event) => {
            const reset = event.target.closest?.("[data-mass-reset]");
            if (!reset) return;
            const row = rowOf(reset);
            this.#restore(row);
            setChanged(row, false);
        });
        // The pin icon grid: a popover against its trigger, its choice a change of the row
        MapDialogManager._bindIconPicker(element, "fwmb-mass-edit-pin", () => {
            const input = element.querySelector("#fwmb-mass-edit-pin-icon-input");
            input?.dispatchEvent(new Event("change", { bubbles: true }));
        });
        for (const row of rows.values()) setChanged(row, false);
    }

    /** A style picked: the rows it sets show its values, marked changed. */
    static #fillFromStyle(app, kind, styleRow, id, rows, setChanged) {
        const store = styleRow.dataset.massRow.split(".")[0];
        const spec = store === "label" ? FieldSpecs.labelStyle : kind.style;
        const style = (app.uiState[MapDialogManager.QUICK_STYLE_CONFIG[spec.type].registryKey] ?? []).find((candidate) => candidate.id === id);
        if (!style) return;
        const written = spec.write(app, style);
        const fill = (prefix, values) => {
            for (const [key, value] of Object.entries(values)) {
                if (key === "label" && value && typeof value === "object") {
                    fill("label", value);
                    continue;
                }
                const row = rows.get(`${prefix}.${key}`);
                if (!row || row === styleRow || value === undefined) continue;
                this.#show(row, value);
                setChanged(row, true, true);
            }
        };
        fill(store, written);
    }

    /** Shows a value in a row's control. */
    static #show(row, value) {
        const control = row.querySelector("[name]");
        const none = row.querySelector('[name$=".none"]');
        if (none) {
            none.checked = value === "transparent";
            if (value !== "transparent") control.value = value;
            return;
        }
        if (control.type === "hidden") {
            control.value = value;
            const button = row.querySelector(`.fwmb-select-options [data-icon="${CSS.escape(value)}"]`);
            MapDialogManager._applyIconGlyph(row.querySelector("#fwmb-mass-edit-pin-trigger-icon"), value, button?.dataset.path, button?.dataset.custom === "true");
            row.querySelector(".fwmb-select-trigger")?.classList.remove("fwmb-is-mixed");
            return;
        }
        control.value = typeof value === "boolean" ? String(value) : value;
        if (control.type === "range") RangeDisplay.sync(control);
    }

    /** Puts a row back as it opened (Leave as is, Mixed, or the shared value). */
    static #restore(row) {
        const initial = JSON.parse(row.dataset.initial);
        const control = row.querySelector("[name]");
        const none = row.querySelector('[name$=".none"]');
        if (none) none.checked = initial.none;
        control.value = initial.value;
        if (control.type === "range") {
            RangeDisplay.sync(control);
            const output = row.querySelector("output");
            if (output && row.dataset.mixed === "true") output.value = platform.i18n.localize("FILRODENSWMB.UI.Mixed");
        }
        if (control.type === "hidden") {
            // The icon grid shows the icon the items share again, or Mixed
            const button = row.querySelector(`.fwmb-select-options [data-icon="${CSS.escape(initial.value)}"]`);
            const glyph = row.querySelector("#fwmb-mass-edit-pin-trigger-icon");
            if (button) MapDialogManager._applyIconGlyph(glyph, initial.value, button.dataset.path, button.dataset.custom === "true");
            row.querySelector(".fwmb-select-trigger").classList.toggle("fwmb-is-mixed", !initial.value);
        }
    }

    /** What a row's control holds, as its value in the form. */
    static #value(row) {
        const control = row.querySelector("[name]");
        const none = row.querySelector('[name$=".none"]');
        if (none?.checked) return "transparent";
        return control.value;
    }

    /**
     * The changed rows as `{ store, key, value }`, the values read as their fields hold them. A
     * row a picked style filled is left to the style.
     * @param {HTMLFormElement} form
     */
    static read(form) {
        const changes = [];
        for (const row of form.querySelectorAll("[data-mass-row].fwmb-is-changed")) {
            if (row.dataset.fromStyle === "true") continue;
            const [store, key] = row.dataset.massRow.split(".");
            changes.push({ store, key, value: this.#value(row) });
        }
        return changes;
    }

    /**
     * Writes the changes to every item as one undo step: a style picked writes its fields first,
     * then the fields changed by hand, and a styled field changed by hand makes the item Custom.
     * @returns {boolean} Whether anything changed.
     */
    static apply(app, type, items, changes) {
        if (!changes.length) return false;
        const kind = FieldSpecs.KINDS[type];
        const fields = new Map(kind.fields.map((field) => [`${field.store}.${field.key}`, field]));
        MapStateManager.pushVectorState(app);
        for (const item of items) {
            if (kind.hasLabel) {
                this.#applyStore(app, item, kind.style, changes.filter((change) => change.store === "item"), fields, "item", type);
                const label = { ...(item.label ?? {}) };
                if (changes.some((change) => change.store === "label")) {
                    this.#applyStore(app, label, FieldSpecs.labelStyle, changes.filter((change) => change.store === "label"), fields, "label", "ownedLabel");
                    item.label = { ...(item.label ?? {}), ...label };
                }
            } else {
                this.#applyStore(app, item, kind.style, changes, fields, "item", type);
            }
        }
        app._repaintVectors();
        app.markDirty();
        return true;
    }

    /**
     * @param {string} ruleKind - The MapRules kind of `target` ("pin", "route", "region", "label",
     *     or "ownedLabel" for an item's label): each value is checked as an import is (see
     *     MapRules.typed), and one that fails its rule leaves the field as it was.
     */
    static #applyStore(app, target, styleSpec, changes, fields, store, ruleKind) {
        if (!changes.length) return;
        const styleChange = changes.find((change) => change.key === styleSpec.key);
        let toStyle = null;
        if (styleChange) {
            const style = (app.uiState[MapDialogManager.QUICK_STYLE_CONFIG[styleSpec.type].registryKey] ?? []).find((candidate) => candidate.id === styleChange.value);
            if (style) {
                toStyle = style;
                const written = styleSpec.write(app, style);
                const { label, ...own } = written;
                Object.assign(target, own);
                if (label && store === "item") target.label = { ...(target.label ?? {}), ...label };
            } else target[styleSpec.key] = styleSpec.none;
        }
        let styledByHand = false;
        for (const change of changes) {
            if (change === styleChange) continue;
            const field = fields.get(`${store}.${change.key}`);
            if (!field) continue;
            const value = this.#parse(field, change.value);
            target[change.key] = typed(ruleKind, { [change.key]: value }, target)[change.key];
            if (field.styled) styledByHand = true;
        }
        if (styledByHand && !toStyle) target[styleSpec.key] = styleSpec.none;
    }

    /** A form value as its field stores it. */
    static #parse(field, value) {
        switch (field.type) {
            case "bool":
                return value === "true";
            case "range":
                return field.key === "thickness" ? roundRouteThickness(value) : Number(value);
            case "number":
                return Math.max(0, Math.round(Number(value) || 0));
            case "select":
                return field.key === "class" ? value || null : value;
            default:
                return value;
        }
    }
}
