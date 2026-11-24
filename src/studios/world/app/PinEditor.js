import { FILRODENSWMB } from "../../../config.js";
import { getPinIconPickerList } from "../../../kernel/data/pinIcons.js";
import { Inspector } from "./Inspector.js";
import { InspectorFields } from "./InspectorFields.js";
import { MapDialogManager } from "./MapDialogManager.js";
import { MapStateManager } from "./MapStateManager.js";
import { PinStyles } from "./PinStyles.js";
import { RegionPanel } from "./RegionPanel.js";
import { platform } from "../../../platform/index.js";
import { typed } from "../data/MapRules.js";
import { GeneratedDetails } from "./GeneratedDetails.js";
import { GeneratedEdits } from "./GeneratedEdits.js";
import { RandomNames } from "./RandomNames.js";
import { UserFigures } from "./UserFigures.js";
import { SettlementMaps } from "./SettlementMaps.js";

/** The pin's own fields a pin style sets, by their names in the form (the label's size is set by it too). */
const LOOK_FIELDS = Object.freeze({ pinColor: true, pinScale: true });

/**
 * A pin in the inspector (see Inspector): its name, description and visibility; its look (a pin
 * style, or its own icon, colour and scale); its Settlement card (its entered population, see
 * UserFigures; not on a castle's or a ruin's) and Settlement map card (SettlementMaps); its label;
 * and Focus view and Delete.
 *
 * A pin follows a pin style (its `pinStyle`) as other objects follow theirs: picking one writes
 * the style's icon, scale, colour and label fields onto the pin (PinStyles.apply); choosing an
 * icon, colour or scale by hand leaves it with no style (as the pin dialogue did). Save as… makes
 * a pin style of the pin's look and label size, and gives the pin that style.
 */
export class PinEditor {
    /**
     * Opens the inspector on a pin.
     * @param {object} app
     * @param {string} pinId
     * @returns {Promise<boolean>}
     */
    static open(app, pinId, options) {
        return Inspector.open(app, this.KIND, { id: pinId }, options);
    }

    static #find(app, { id }) {
        return app.mapPins?.find((pin) => pin.id === id) ?? null;
    }

    /** The pin's kind of inspector. */
    static KIND = Object.freeze({
        id: "pin",
        template: "modules/filrodens-world-map-builder/templates/world/parts/inspector-pin.hbs",
        find: (app, ref) => PinEditor.#find(app, ref),
        header: (_app, pin) => ({ title: pin.name, subtitle: platform.i18n.localize("FILRODENSWMB.UI.InspectorSubtitlePin"), swatch: pin.color ?? null, mark: PinEditor.#mark(pin) }),
        context: (app, pin) => PinEditor.#context(app, pin),
        apply: (app, pin, _ref, form, field) => PinEditor.#apply(app, pin, form, field),
        actions: {
            zoom: (app, pin) => app.canvasEngine?.zoomToFeature([pin]),
            pickIcon: (app, pin, _ref, button) => PinEditor.#pickIcon(app, pin, button.dataset.icon),
            delete: (app, pin) => MapDialogManager.deleteEntityById(app, "pin", pin.id),
            lock: (app, pin) => GeneratedEdits.toggleLock(app, pin),
            clearFigures: (app, pin) => PinEditor.#clearFigures(app, pin),
            randomName: (app, pin) => RandomNames.press(app, "pin", pin),
            saveStyle: (app, pin, _ref, button) => PinEditor.#saveStyle(app, pin, button.dataset.styleType),
            placeLabel: (app, pin) => InspectorFields.placeLabel(app, pin),
            // Its settlement map (L-surface): made (asking for a population first), or opened
            makeSettlementMap: (app, pin) => SettlementMaps.make(app, pin.id),
            openSettlementMap: (app, pin) => {
                const card = SettlementMaps.pinCard(app, pin);
                return card?.id ? SettlementMaps.open(app, card.id) : null;
            },
            // Deleted (L-surface step 2b), after its confirmation; on a held regional world, its
            // parent's opened there, or made there
            deleteSettlementMap: (app, pin) => {
                const card = SettlementMaps.pinCard(app, pin);
                return card?.card ? SettlementMaps.deleteMap(app, card.id) : null;
            },
            openSettlementMapInOwner: (app, pin) => {
                const card = SettlementMaps.pinCard(app, pin);
                return card?.heldOwn ? app.openWorldAt(card.ownerId, { settlementId: card.id }) : null;
            },
            makeSettlementMapInOwner: (app, pin) => SettlementMaps.makeInOwner(app, pin.id),
        },
    });

    static #context(app, pin) {
        const label = InspectorFields.label(app, pin);
        const icons = getPinIconPickerList(pin.icon).map((entry) => ({ ...entry, selected: entry.key === pin.icon }));
        const pinStyle = PinStyles.find(app, pin.pinStyle);
        return {
            pin: { ...pin, scale: pin.scale ?? FILRODENSWMB.PINS.DEFAULT_SCALE, color: pin.color ?? FILRODENSWMB.PINS.DEFAULT_STYLE_COLOR },
            visibilities: RegionPanel.visibilityChoices(pin.visibility),
            pinStyles: InspectorFields.styleChoices(PinStyles.list(app), pinStyle?.id ?? null),
            pinStyleName: pinStyle?.name ?? null,
            icons,
            icon: icons.find((entry) => entry.selected) ?? { key: pin.icon, label: pin.icon, isCustom: false },
            label,
            labelChoices: InspectorFields.labelChoices(app, label),
            labelStyleName: InspectorFields.styleName(app.uiState.customLabelStyles, label.quickStyle),
            labelVisibilities: RegionPanel.visibilityChoices(label.visibility),
            palette: FILRODENSWMB.LABELS?.PRESETS || [],
            settlement: this.#settlement(pin, pinStyle),
            // Its Settlement map card (L-surface), under the Settlement card
            settlementMap: SettlementMaps.pinCard(app, pin),
            generated: GeneratedDetails.forPin(app, pin),
            generatedLocked: pin.generated?.locked === true,
            // An entered population keeps a generated pin: Lock ticked and held (see UserFigures)
            generatedLockHeld: !!pin.generated && UserFigures.has(pin),
            // A hand-placed settlement pin a run built on: its figures, without Lock (it is the reader's own)
            generatedModelled: !pin.generated && !!pin.modelled,
        };
    }

    /**
     * The Settlement card's context (see UserFigures): the entered population, else the run's
     * figure as the field's placeholder; whether the figure is a village's (below a town's size).
     * Null for a pin with no people of its own (a castle's or a ruin's).
     */
    static #settlement(pin, pinStyle) {
        if (!UserFigures.takes(pinStyle?.tier ?? null)) return null;
        const entered = UserFigures.population(pin);
        const made = UserFigures.made(pin);
        const lang = platform.i18n.lang;
        return {
            value: entered ?? "",
            placeholder: entered === null && made !== null ? platform.i18n.format("FILRODENSWMB.UI.InspectorPopulationMade", { count: made.toLocaleString(lang) }) : "",
            entered: entered !== null,
            village: entered !== null && entered < UserFigures.TOWN_MIN,
            townMin: UserFigures.TOWN_MIN.toLocaleString(lang),
            max: UserFigures.MAX,
        };
    }

    /** The inspector header's mark: Entered, while the pin has an entered population. */
    static #mark(pin) {
        if (!UserFigures.has(pin)) return null;
        return { kind: "entered", icon: "edit", label: platform.i18n.localize("FILRODENSWMB.UI.MarkEntered"), tooltip: platform.i18n.localize("FILRODENSWMB.UI.MarkEnteredHint") };
    }

    /**
     * The Population field committed: the figure entered (a whole number), or, emptied, none. One
     * undo step when it changed. A run's figures are left as they are.
     */
    static #applyPopulation(app, pin, form) {
        const value = UserFigures.parse(form.elements.pinPopulation.value);
        if (value === UserFigures.population(pin)) return false;
        MapStateManager.pushVectorState(app);
        if (value === null) delete pin.userFigures;
        else pin.userFigures = { ...(pin.userFigures ?? {}), population: value };
        this.#redraw(app);
        return true;
    }

    /** Clear entered figures: the pin back to the model's figures. One undo step. */
    static #clearFigures(app, pin) {
        if (!pin.userFigures) return;
        MapStateManager.pushVectorState(app);
        delete pin.userFigures;
        this.#redraw(app);
    }

    /** Applies the form to the pin as one undo step, when anything changed. */
    static #apply(app, pin, form, field) {
        if (field === "pinPopulation") return this.#applyPopulation(app, pin, form);
        const elements = form.elements;
        // Checked as an import is (see MapRules.typed): a value that fails its rule keeps the pin's own
        const values = typed(
            "pin",
            {
                name: elements.pinName.value.trim() || pin.name,
                description: elements.pinDesc.value,
                visibility: elements.pinVisibility.value,
                color: elements.pinColor.value,
                scale: Number(elements.pinScale.value) || FILRODENSWMB.PINS.DEFAULT_SCALE,
                label: InspectorFields.readLabel(form, field, app),
            },
            pin,
        );
        const current = { ...pin, visibility: pin.visibility ?? "all", label: InspectorFields.label(app, pin) };

        if (field === "pinStyle") {
            const style = PinStyles.find(app, elements.pinStyle.value);
            if (!style && !pin.pinStyle) return false;
            MapStateManager.pushVectorState(app);
            if (style) PinStyles.apply(app, pin, style);
            else pin.pinStyle = null;
            GeneratedEdits.mark(pin);
            this.#redraw(app);
            return true;
        }
        if (!InspectorFields.differs(current, values)) return false;
        MapStateManager.pushVectorState(app);
        GeneratedEdits.markIfSubstantive(pin, field);
        const { label, ...fields } = values;
        if (fields.name !== pin.name) RandomNames.markTyped(pin);
        Object.assign(pin, fields);
        pin.label = { ...pin.label, ...label };
        if (LOOK_FIELDS[field]) pin.pinStyle = null;
        this.#redraw(app);
        return true;
    }

    /** An icon chosen in the grid: the pin's icon, leaving its style. One undo step. */
    static #pickIcon(app, pin, icon) {
        if (!icon || icon === pin.icon) return;
        MapStateManager.pushVectorState(app);
        pin.icon = icon;
        pin.pinStyle = null;
        GeneratedEdits.mark(pin);
        this.#redraw(app);
    }

    /** Save as…: a pin style from the pin's look and label size, or a label style from its label. */
    static async #saveStyle(app, pin, type) {
        if (type === "Label") {
            const source = InspectorFields.label(app, pin);
            const id = await InspectorFields.saveStyleAs(app, "Label", source);
            if (!id) return;
            pin.label = { ...source, ...pin.label, quickStyle: id };
            this.#redraw(app);
            return;
        }
        const label = InspectorFields.label(app, pin);
        const source = {
            icon: pin.icon,
            scale: pin.scale ?? FILRODENSWMB.PINS.DEFAULT_SCALE,
            color: pin.color ?? FILRODENSWMB.PINS.DEFAULT_STYLE_COLOR,
            label: { fontSize: label.fontSize, visibility: label.visibility, quickStyle: label.quickStyle ?? PinStyles.NONE },
            detailLevel: FILRODENSWMB.PINS.DETAIL_LEVELS.at(-1),
        };
        const id = await InspectorFields.saveStyleAs(app, "Pin", source);
        if (!id) return;
        pin.pinStyle = id;
        this.#redraw(app);
    }

    static #redraw(app) {
        app._repaintVectors();
        app.view?.render(["context", "editToolbar"]);
        app.markDirty();
    }
}
