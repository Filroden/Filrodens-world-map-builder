import { Idiomorph } from "../../vendor/idiomorph/idiomorph.esm.js";
import { Overlay } from "../ui/Overlay.js";
import { RangeDisplay } from "../tools/RangeDisplay.js";
import { RangeTrack } from "../ui/RangeTrack.js";
import { platform } from "../platform/index.js";

/**
 * The inspector: the selected object's fields, docked at the studio's end edge (see Overlay's
 * docked placement). It takes its own column and pushes the canvas narrower at every width; below
 * 1,400px of studio width it is narrower itself and stacks its fields (see the stylesheet).
 *
 * One object is inspected at a time. Opening another replaces it, and switching tool closes it
 * (MapStudio dismisses the docked dialogues when the tool changes), as Escape and its close
 * control do. Focus moves into it when it opens and goes back where it was when it closes.
 *
 * **Changes apply at once.** There is no Save or Cancel: each field applies when it is committed
 * (a field's change event: a select or checkbox at once, a text field on Enter or when it is left,
 * a slider when it is released, a colour when its picker closes), and each is one undo step. The
 * kind reads the whole form and writes only what differs from the object, so a field committed
 * twice with the same value (Enter, then leaving the field) records nothing the second time. The
 * fields are then drawn again from the object, so whatever the change implies (a style picked
 * filling the style's fields, a styled field moving the style picker to Custom, the header's name)
 * shows at once. Redrawing morphs the form in place (idiomorph), so focus and a half-typed value in
 * another field survive it.
 *
 * Each kind of object is a plain object: RegionEditor, RouteEditor, PinEditor, LabelEditor,
 * RiverEditor, FaultEditor, DecorationEditor, LandMaskEditor (FeatureEditors.js), LevelEditor and
 * LayerSetEditor (LayerEditors.js) each hold one:
 *
 * - `id`: the kind's name ("region").
 * - `template`: the body's template path (`templates/parts/inspector-<kind>.hbs`).
 * - `find(app, ref)`: the object, or null once it has gone (deleted, or undone away).
 * - `context(app, object, ref)`: the template's context.
 * - `header(app, object, ref)`: `{ title, subtitle, swatch }` for the header.
 * - `opened(app, object, ref)`: optional; makes the object the one being worked on.
 * - `apply(app, object, ref, form, field)`: reads the form and applies what changed as one undo
 *   step, returning whether anything did. `field` is the name of the field committed.
 * - `actions`: optional buttons in the body (`data-inspector-action="name"`), each
 *   `(app, object, ref, button) => unknown`; the inspector is drawn again after one runs (or closed,
 *   if the object has gone).
 * - `closed(app, ref, { replaced })`: optional; called once the inspector has closed, `replaced`
 *   when another object opened in its place (Help uses it to bring back what it covered).
 *
 * Besides objects, the column shows Help (HelpPanel), a kind with nothing to apply.
 *
 * `ref` names the object: `{ id }`, plus whatever else the kind needs to find it (a region's level).
 */
export class Inspector {
    /** The inspector open in each studio: `{ kind, ref, overlay, defaults }`. */
    static #open = new WeakMap();

    /** The latest open() under way in each studio; an earlier one still being drawn gives way. */
    static #opening = new WeakMap();

    /**
     * Opens the inspector on an object, replacing whatever it showed.
     *
     * @param {object} app - The studio.
     * @param {object} kind - The object's kind (see above).
     * @param {object} ref - Names the object.
     * @param {{created?: boolean, keepFocus?: boolean}} [options] - `created`: the object was just
     *   made on the map, so focus stays there and the next click goes on placing or drawing.
     *   `keepFocus`: it was opened from a list's row, where focus stays, so the reader can go on
     *   through the list.
     * @returns {Promise<boolean>} Whether it opened (false when the object is not on the map).
     */
    static async open(app, kind, ref, { created = false, keepFocus = false } = {}) {
        const object = kind.find(app, ref);
        if (!object) return false;
        // One docked dialogue at a time: the inspector replaces any other, and the one open
        this.close(app, { replaced: true });
        platform.dialogs.dismiss({ placement: "docked" });
        kind.opened?.(app, object, ref);
        if (!app.root) return false;

        const token = {};
        this.#opening.set(app, token);
        const content = await platform.templates.render(kind.template, this.#context(app, kind, object, ref));
        // Another object opened while this one was being drawn: the later one wins
        if (this.#opening.get(app) !== token || !app.root) return false;
        this.#opening.delete(app);
        const header = kind.header(app, object, ref);
        const overlay = Overlay.show({
            host: app.root,
            placement: "docked",
            title: header.title,
            header: { swatch: header.swatch ?? null, subtitle: header.subtitle ?? null },
            content,
            classes: ["fwmb", "fwmb-inspector", `fwmb-inspector--${kind.id}`],
            closeLabel: platform.i18n.localize("FILRODENSWMB.UI.Close"),
            focus: created || keepFocus ? "none" : "dialogue",
        });
        const state = { kind, ref, overlay, defaults: new Map() };
        this.#open.set(app, state);
        this.#rememberDefaults(state);
        RangeDisplay.syncAllFills(overlay.body);
        RangeTrack.syncAll(overlay.body);
        this.#bind(app, state);
        overlay.closed.then(() => {
            if (this.#open.get(app) === state) this.#open.delete(app);
            app.refreshLayout?.();
            this.#markRows(app);
            kind.closed?.(app, ref, { replaced: state.replaced === true });
        });
        app.refreshLayout?.();
        this.#markRows(app);
        return true;
    }

    /**
     * The panel's lists mark the row of the object the inspector shows (see MapStudio's
     * `inspected` context), so they are drawn again whenever it opens, changes or closes.
     */
    static #markRows(app) {
        app.view?.render(["context"]);
    }

    /**
     * Which object the inspector shows, as the panel's lists look for it: its id under its kind's
     * name ("pin", "river"…), or for a label under "label" plus its owner's type ("labelcustom",
     * "labelpin"…). Empty when the inspector is closed.
     * @returns {Record<string, string>}
     */
    static inspected(app) {
        const state = this.#open.get(app);
        if (!state) return {};
        const key = state.kind.id === "label" ? `label${state.ref.type ?? "custom"}` : state.kind.id;
        return { [key]: state.ref.id };
    }

    /** What the inspector shows: `{ kind, ref }`, or null when it is closed. */
    static current(app) {
        const state = this.#open.get(app);
        return state ? { kind: state.kind, ref: state.ref } : null;
    }

    /** Whether the inspector shows this object. */
    static shows(app, kindId, id) {
        const state = this.#open.get(app);
        return !!state && state.kind.id === kindId && state.ref.id === id;
    }

    /**
     * Closes the inspector, if open.
     * @param {object} app
     * @param {{replaced?: boolean}} [options] - `replaced`: another kind is opening in its place
     *   (see the kind's `closed`).
     */
    static close(app, { replaced = false } = {}) {
        const state = this.#open.get(app);
        if (!state) return;
        this.#open.delete(app);
        state.replaced = replaced;
        state.overlay.dismiss();
    }

    /**
     * Draws the inspector again from its object, after the object changed elsewhere (an undo, the
     * bar, a list's menu), or closes it when the object has gone.
     *
     * @returns {Promise<void>}
     */
    static async refresh(app) {
        const state = this.#open.get(app);
        if (!state) return;
        const object = state.kind.find(app, state.ref);
        if (!object) {
            this.close(app);
            return;
        }
        const content = await platform.templates.render(state.kind.template, this.#context(app, state.kind, object, state.ref));
        if (this.#open.get(app) !== state || !state.overlay.element) return;
        Idiomorph.morph(state.overlay.body, content, { morphStyle: "innerHTML" });
        // A select the reader has used keeps its own choice when its options' selected attributes
        // change, so each option is told whether it is chosen, as the object now says
        for (const option of state.overlay.body.querySelectorAll("option")) option.selected = option.hasAttribute("selected");
        // So is a checkbox, as the object now says
        for (const box of state.overlay.body.querySelectorAll('input[type="checkbox"]')) box.checked = box.hasAttribute("checked");
        state.overlay.setHeader(state.kind.header(app, object, state.ref));
        this.#rememberDefaults(state);
        // The morph takes away the sliders' filled tracks and the bands' handles' places (styles
        // the template does not write)
        RangeDisplay.syncAllFills(state.overlay.body);
        RangeTrack.syncAll(state.overlay.body);
    }

    /**
     * The kind's template context, with which collapsible sections the reader has opened or
     * closed (shared with the panel's, see MapStudio#rememberSectionState), so a redraw keeps them
     * as they were left.
     */
    static #context(app, kind, object, ref) {
        const keys = (set) => Object.fromEntries([...(set ?? [])].map((key) => [key, true]));
        return { ...kind.context(app, object, ref), expandedSections: keys(app._expandedSections), collapsedSections: keys(app._collapsedSections) };
    }

    /** Remembers a section of the inspector opened or closed by the reader (see #context). */
    static #rememberSection(app, details) {
        const key = details.dataset.section;
        if (!key || !app._expandedSections || !app._collapsedSections) return;
        const [add, remove] = details.open ? [app._expandedSections, app._collapsedSections] : [app._collapsedSections, app._expandedSections];
        add.add(key);
        remove.delete(key);
    }

    /**
     * A slider in the inspector returns on double-click to the value it had when the inspector
     * opened on this object, as in a dialogue, unless the template gives it a default of its own.
     * The values are kept across redraws, which would otherwise drop them.
     */
    static #rememberDefaults(state) {
        for (const slider of state.overlay.body.querySelectorAll('input[type="range"]')) {
            if (slider.hasAttribute("data-default") && !state.defaults.has(slider.name)) continue;
            if (!state.defaults.has(slider.name)) state.defaults.set(slider.name, slider.value);
            slider.dataset.default = state.defaults.get(slider.name);
        }
    }

    static #bind(app, state) {
        const dialog = state.overlay.element;
        // Band fields (a culture's habitat): their handles, keys, quick picks and reset send change
        RangeTrack.bind(dialog);
        dialog.addEventListener("change", (event) => {
            if (event.target.name) this.#commit(app, state, event.target.name);
        });
        // Enter in a text field commits it, as leaving it does
        dialog.addEventListener(
            "keydown",
            (event) => {
                const field = event.target;
                if (event.key === "Enter" && field.localName === "input" && field.type !== "checkbox" && field.name) this.#commit(app, state, field.name);
            },
            true,
        );
        // A double-click returns a slider to its default and commits it. The reset is made here, not
        // left to the studio's own handler (see StudioView), which runs later in the event: a
        // reader's double-click runs pending work between the two, so a commit queued here would
        // read the slider before it was reset. The studio's handler then finds it already reset.
        dialog.addEventListener("dblclick", (event) => {
            const field = event.target;
            if (field.localName !== "input" || field.type !== "range" || !field.name) return;
            if (field.dataset.default !== undefined && field.value !== field.dataset.default) {
                field.value = field.dataset.default;
                RangeDisplay.sync(field);
            }
            this.#commit(app, state, field.name);
        });
        // A section's toggle does not bubble, so it is caught on its way down
        dialog.addEventListener(
            "toggle",
            (event) => {
                if (event.target.localName === "details") this.#rememberSection(app, event.target);
            },
            true,
        );
        dialog.addEventListener("click", (event) => {
            const button = event.target.closest?.("[data-inspector-action]");
            if (!button || !dialog.contains(button)) return;
            // A checkbox (Lock) keeps its own toggle: cancelling it makes the browser put the box
            // back as it was once the click is over, which can be after the action's refresh has
            // already drawn it ticked, so the tick vanished (seen in the tutorial recordings)
            if (!(button.localName === "input" && button.type === "checkbox")) event.preventDefault();
            this.#runAction(app, state, button);
        });
    }

    static #commit(app, state, field) {
        if (this.#open.get(app) !== state) return;
        const object = state.kind.find(app, state.ref);
        if (!object) {
            this.close(app);
            return;
        }
        if (state.kind.apply(app, object, state.ref, state.overlay.body, field)) this.refresh(app);
    }

    static async #runAction(app, state, button) {
        const action = state.kind.actions?.[button.dataset.inspectorAction];
        const object = state.kind.find(app, state.ref);
        if (!action || !object) return;
        await action(app, object, state.ref, button);
        if (this.#open.get(app) === state) await this.refresh(app);
    }
}
