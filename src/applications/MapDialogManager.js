import { FILRODENSWMB } from "../config.js";
import { labelFontGroups } from "../data/fonts.js";
import { MapStateManager } from "./MapStateManager.js";
import { ColorMath } from "../tools/ColorMath.js";
import { BiomePlacement } from "../generation/BiomePlacement.js";
import { RuleEditorDialog } from "./RuleEditorDialog.js";
import { TerrainVersion } from "../tools/TerrainVersion.js";
import { TectonicFeatureEngine } from "../generation/TectonicFeatureEngine.js";
import { RangeDisplay } from "../tools/RangeDisplay.js";
import { CanvasTransforms } from "../tools/CanvasTransforms.js";
import {
    getCustomPinIconById,
    getPinIconPickerList,
    addCustomPinIcon,
    updateCustomPinIcon,
    removeCustomPinIconEntry,
    setBuiltinPinIconDisabled,
    setAllBuiltinPinIconsDisabled,
    findPinIconUsage,
    revertPinIconUsage,
} from "../data/pinIcons.js";
import { ROUTE_THICKNESS_STEP, roundRouteThickness } from "../mesh/Schema.js";
import { PinStyles } from "./PinStyles.js";
import { positionPopoverMenu } from "../ui/dropdowns.js";
import { platform } from "../platform/index.js";

export class MapDialogManager {
    /**
     * Shows a standard Yes/No confirmation dialogue.
     */
    static async _confirmDialog(title, content) {
        return platform.dialogs.confirm({
            title: title || platform.i18n.localize("FILRODENSWMB.UI.Warning"),
            content: `<p>${content || platform.i18n.localize("FILRODENSWMB.UI.DeleteConfirm")}</p>`,
        });
    }

    /**
     * Prompts for a single line of text via a minimal form.
     */
    static async _promptTextValue(title, label, defaultValue) {
        // The value is escaped because it is often an existing name (a map or layer name) that
        // may contain quotes, which would otherwise end the attribute early and cut the name short
        const safeValue = platform.utils.escapeHtml(defaultValue ?? "");
        return platform.dialogs.prompt({
            title,
            content: `<label>${label}</label><input type="text" id="fwmb-prompt-input" value="${safeValue}">`,
            onSubmit: (form) => form.elements["fwmb-prompt-input"].value,
        });
    }

    /**
     * Prompts the user with a 3-way choice for unsaved changes (Save, Discard, Cancel).
     * Returns the chosen action as a string.
     */
    static async promptUnsavedChanges() {
        return platform.dialogs.choose({
            title: platform.i18n.localize("FILRODENSWMB.UI.Warning"),
            content: `<p>${platform.i18n.localize("FILRODENSWMB.UI.UnsavedChangesWarning")}</p>`,
            buttons: [
                { action: "discard", label: platform.i18n.localize("FILRODENSWMB.UI.Discard"), icon: "fwmb-icon fwmb-icon--delete", tone: "negative" },
                { action: "cancel", label: platform.i18n.localize("FILRODENSWMB.UI.Cancel"), icon: "fwmb-icon fwmb-icon--cancel", tone: "caution" },
                { action: "save", label: platform.i18n.localize("FILRODENSWMB.UI.Save"), icon: "fwmb-icon fwmb-icon--save", tone: "positive", default: true },
            ],
            dismissed: "cancel",
        });
    }

    /**
     * Asks to save the open map before a regional map is cut from it, because it has never been
     * saved or has unsaved changes. A regional map is listed under the saved map it was cut from,
     * and is built from the map as it is now, so without a save it would have no parent in the
     * Map Management list, or would not match the parent saved there. There is no Discard: the
     * regional map is built from the changes, so they must be kept to make it.
     *
     * @param {boolean} neverSaved - Whether the map has never been saved (rather than having
     *   unsaved changes), which picks the title and message.
     * @returns {Promise<boolean>} True to save and carry on, false to stop.
     */
    static async promptSaveBeforeRegionalMap(neverSaved) {
        const message = neverSaved ? "FILRODENSWMB.UI.RegionalMapSaveFirstNew" : "FILRODENSWMB.UI.RegionalMapSaveFirstChanged";
        const title = neverSaved ? "FILRODENSWMB.UI.SaveUnsavedMap" : "FILRODENSWMB.UI.SaveExistingMap";
        const choice = await platform.dialogs.choose({
            title: platform.i18n.localize(title),
            content: `<p>${platform.i18n.localize(message)}</p>`,
            buttons: [
                { action: "cancel", label: platform.i18n.localize("FILRODENSWMB.UI.Cancel"), icon: "fwmb-icon fwmb-icon--cancel", tone: "negative" },
                { action: "save", label: platform.i18n.localize("FILRODENSWMB.UI.Save"), icon: "fwmb-icon fwmb-icon--save", tone: "positive", default: true },
            ],
            dismissed: "cancel",
        });
        return choice === "save";
    }

    /**
     * Offers to update a map built with older terrain generation rules (see TerrainUpgrade).
     *
     * Lists only the changes this map would actually see, explains that the update is not saved
     * until the map is, and (when opened automatically on load) lets the user stop being asked
     * for this map. Closing the dialog counts as keeping the original.
     *
     * @param {{kind: string, resized?: boolean, changesTerrain: boolean, changesBiomes: boolean, changesFaults?: boolean, convertsFaults?: boolean, removesSlip?: boolean, changesRivers?: boolean, changesChannels?: boolean}} impact - What the
     *   update changes, and why (see TerrainUpgrade.assess).
     * @param {boolean} allowDismiss - Whether to show the "don't ask again" option.
     * @returns {Promise<{apply: boolean, dismiss: boolean}>} The user's choice.
     */
    static async promptTerrainUpgrade(impact, allowDismiss) {
        const content = await platform.templates.render("modules/filrodens-world-map-builder/templates/dialogs/terrain-upgrade.hbs", {
            isRegional: impact.kind === "regional",
            isTectonics: impact.kind === "tectonics",
            isFaults: impact.kind === "faults",
            isRivers: impact.kind === "rivers",
            changesRivers: impact.changesRivers === true,
            changesChannels: impact.changesChannels === true,
            convertsFaults: impact.convertsFaults === true,
            removesSlip: impact.removesSlip === true,
            fracture: impact.fracture,
            fractureChanges: impact.fracture !== undefined && impact.fracture.before !== impact.fracture.after,
            resized: impact.resized === true,
            changesTerrain: impact.changesTerrain,
            changesBiomes: impact.changesBiomes,
            changesFaults: impact.changesFaults,
            allowDismiss,
        });

        const readDismiss = (form) => form?.elements?.dismissUpgrade?.checked === true;

        return platform.dialogs.choose({
            classes: ["fwmb"],
            title: platform.i18n.localize("FILRODENSWMB.UI.TerrainUpdateTitle"),
            content,
            buttons: [
                {
                    action: "keep",
                    label: platform.i18n.localize("FILRODENSWMB.UI.TerrainUpdateKeep"),
                    icon: "fwmb-icon fwmb-icon--cancel",
                    tone: "negative",
                    callback: (form) => ({ apply: false, dismiss: readDismiss(form) }),
                },
                {
                    action: "apply",
                    label: platform.i18n.localize("FILRODENSWMB.UI.TerrainUpdateApply"),
                    icon: "fwmb-icon fwmb-icon--sync",
                    tone: "positive",
                    default: true,
                    callback: () => ({ apply: true, dismiss: false }),
                },
            ],
            dismissed: { apply: false, dismiss: false },
        });
    }

    /**
     * Fills a dialogue's line fields from a route quick style: colour, thickness, style, outline and
     * smoothing. Each field is optional, since the mass-edit dialogue and the route quick style editor offer
     * different sets of them. The thickness slider's value display follows the slider.
     * @param {object} style - A route quick style.
     * @param {{color?: HTMLInputElement, thickness?: HTMLInputElement, style?: HTMLSelectElement, outline?: HTMLInputElement, smoothing?: HTMLInputElement}} fields
     */
    static applyRouteStyleToFields(style, fields) {
        if (fields.color) fields.color.value = style.color;
        if (fields.thickness) {
            fields.thickness.value = style.thickness;
            RangeDisplay.sync(fields.thickness);
        }
        if (fields.style) fields.style.value = style.style;
        if (fields.outline) fields.outline.checked = style.outline !== false;
        if (fields.smoothing) fields.smoothing.checked = style.smoothing === true;
    }

    /** The line fields a route quick style carries, as they are copied onto each route that uses it. */
    static routeStyleFields(style) {
        return { color: style.color, thickness: style.thickness, style: style.style, outline: style.outline !== false, smoothing: style.smoothing === true };
    }

    /**
     * Builds a safe copy of an entity inheriting the current global label defaults.
     */
    static _withLabelDefaults(app, entity) {
        const safe = { ...entity };

        const defaults = {
            quickStyle: "custom",
            fontFamily: app.uiState.labelFontFamily || FILRODENSWMB.LABELS.DEFAULT_FONT,
            fontSize: app.uiState.labelFontSize || 1,
            fillColor: app.uiState.labelFillColor || "#ffffff",
            maxChars: app.uiState.labelMaxChars || 0,
            justify: app.uiState.labelJustify || "left",
            bold: app.uiState.labelBold !== false,
            italic: app.uiState.labelItalic === true,
            rotation: 0,
        };

        safe.label = { ...defaults, ...(safe.label || {}) };
        // The copy only feeds the dialogue, so wrapping the angle here changes nothing stored
        safe.label.rotation = CanvasTransforms.normalizeAngle(safe.label.rotation);

        return safe;
    }

    /**
     * Helper to bind shared label property inputs across different dialogues.
     */
    static bindLabelPropertiesDialog(html, uiState) {
        const labelQuickStyleSelect = html.querySelector('select[name="labelQuickStyle"]');
        const labelFontFamilySelect = html.querySelector('select[name="labelFontFamily"]');
        const labelFontSizeInput = html.querySelector('input[name="labelFontSize"]');
        const labelColorInput = html.querySelector('input[name="labelFillColor"]');
        const labelMaxCharsInput = html.querySelector('input[name="labelMaxChars"]');
        const labelJustifySelect = html.querySelector('select[name="labelJustify"]');

        labelQuickStyleSelect?.addEventListener("change", (e) => {
            const styleId = e.target.value;
            if (styleId === "custom") return;

            const styleData = uiState.customLabelStyles.find((s) => s.id === styleId);
            if (!styleData) return;

            if (labelFontFamilySelect) labelFontFamilySelect.value = styleData.fontFamily;
            if (labelColorInput) labelColorInput.value = styleData.fillColor;
            if (labelMaxCharsInput) labelMaxCharsInput.value = styleData.maxChars;
            if (labelJustifySelect) labelJustifySelect.value = styleData.justify;

            if (labelFontSizeInput) {
                labelFontSizeInput.value = styleData.fontSize;
                RangeDisplay.sync(labelFontSizeInput);
            }
        });

        const revertLabelToCustom = () => {
            if (labelQuickStyleSelect) labelQuickStyleSelect.value = "custom";
        };

        // The slider's value display is kept current by the shared range listener (RangeDisplay)
        labelFontSizeInput?.addEventListener("input", revertLabelToCustom);

        labelFontFamilySelect?.addEventListener("change", revertLabelToCustom);
        labelColorInput?.addEventListener("input", revertLabelToCustom);
        labelMaxCharsInput?.addEventListener("input", revertLabelToCustom);
        labelJustifySelect?.addEventListener("change", revertLabelToCustom);
    }

    /**
     * Sets an `.fwmb-icon` glyph element to render a given pin icon key correctly, whether
     * it's a built-in (a compiled `.fwmb-icon--<key>` CSS class already exists for it) or a
     * custom icon (no compiled class exists for runtime-registered data, so its mask is set
     * inline instead, straight from its resolved path).
     */
    static _applyIconGlyph(element, key, path, isCustom) {
        if (!element) return;

        if (isCustom) {
            element.className = "fwmb-icon";
            element.style.setProperty("--fwmb-mask", `url('${path}')`);
        } else {
            element.className = `fwmb-icon fwmb-icon--${key}`;
            element.style.removeProperty("--fwmb-mask");
        }
    }

    /**
     * Wires a dialogue's icon picker (the custom select of pin icons): its trigger opens the grid,
     * and choosing an icon writes its key to the hidden input, shows it on the trigger and closes
     * the grid. The picker's parts are found by id prefix: `${prefix}-select`, `${prefix}-icon-input`
     * and `${prefix}-trigger-icon`.
     *
     * Where the browser supports popovers the grid opens as one, drawn in the top layer against
     * the trigger (see positionPopoverMenu), so the dialogue's layout does not move while it is
     * open; it closes on a choice, on Escape, or on a press anywhere else. Without popovers the
     * grid opens in place below the trigger.
     * @param {HTMLElement} html
     * @param {string} prefix
     * @param {function(string): void} [onChoose] - Called with the chosen icon's key.
     * @returns {{choose: function(string): void}|null} A way to pick an icon from script (a style
     *     choosing it, say), or null without a picker.
     */
    static _bindIconPicker(html, prefix, onChoose = null) {
        const trigger = html.querySelector(`#${prefix}-select .fwmb-select-trigger`);
        const optionsMenu = html.querySelector(`#${prefix}-select .fwmb-select-options`);
        const hiddenInput = html.querySelector(`#${prefix}-icon-input`);
        const triggerIcon = html.querySelector(`#${prefix}-trigger-icon`);
        if (!trigger || !optionsMenu || !hiddenInput) return null;

        const buttons = [...optionsMenu.querySelectorAll("button")];
        const show = (button) => {
            hiddenInput.value = button.dataset.icon;
            this._applyIconGlyph(triggerIcon, button.dataset.icon, button.dataset.path, button.dataset.custom === "true");
            buttons.forEach((other) => other.setAttribute("aria-pressed", String(other === button)));
        };
        const { toggle, close } = this.#pickerMenu(trigger, optionsMenu);
        trigger.addEventListener("click", toggle);
        for (const button of buttons) {
            button.addEventListener("click", () => {
                show(button);
                close();
                onChoose?.(button.dataset.icon);
            });
        }
        return {
            choose: (key) => {
                const button = buttons.find((candidate) => candidate.dataset.icon === key);
                if (button) show(button);
            },
        };
    }

    /**
     * How a picker's grid opens and closes: as a popover placed against its trigger where the
     * browser has them, otherwise in place by its hidden class.
     * @returns {{toggle: function(): void, close: function(): void}}
     */
    static #pickerMenu(trigger, menu) {
        if (typeof menu.showPopover !== "function") {
            return {
                toggle: () => menu.classList.toggle("fwmb-hidden"),
                close: () => menu.classList.add("fwmb-hidden"),
            };
        }
        menu.popover = "manual";
        menu.classList.remove("fwmb-hidden");
        const isOpen = () => menu.matches(":popover-open");
        const close = () => {
            if (isOpen()) menu.hidePopover();
        };
        const open = () => {
            menu.showPopover();
            positionPopoverMenu(trigger, menu);
        };
        const document = menu.ownerDocument;
        // A press outside the picker, or Escape, closes it; the listeners live only while it is open
        const onPointerDown = (event) => {
            if (!trigger.contains(event.target) && !menu.contains(event.target)) close();
        };
        const onKeyDown = (event) => {
            if (event.key === "Escape") {
                close();
                event.stopPropagation();
            }
        };
        menu.addEventListener("toggle", (event) => {
            const listen = event.newState === "open" ? "addEventListener" : "removeEventListener";
            document[listen]("pointerdown", onPointerDown, true);
            document[listen]("keydown", onKeyDown, true);
        });
        return { toggle: () => (isOpen() ? close() : open()), close };
    }

    /**
     * Shared Add/Edit dialogue for a single custom pin icon: name, a native file-picker path,
     * and a live preview of the raw SVG against a black background so the GM can confirm
     * it's genuinely solid white before accepting. Pins are coloured by tinting their sprite,
     * which multiplies every pixel by the pin's colour, so only white areas take the colour
     * exactly (this is a visual self-check, not an automated one).
     */
    static async _promptPinIconDialog(icon, titleKey) {
        const content = await platform.templates.render("modules/filrodens-world-map-builder/templates/dialogs/edit-pin-icon.hbs", { icon });

        return platform.dialogs.prompt({
            classes: ["fwmb"],
            title: platform.i18n.localize(titleKey),
            content,
            onRender: (html) => {
                const pathInput = html.querySelector('[name="iconPath"]');
                const previewImg = html.querySelector("#fwmb-pin-icon-preview-img");
                if (!pathInput || !previewImg) return;

                const updatePreview = () => {
                    const path = pathInput.value.trim();
                    previewImg.src = path;
                    previewImg.hidden = !path;
                };

                pathInput.addEventListener("input", updatePreview);
                pathInput.addEventListener("change", updatePreview);
            },
            onSubmit: (form) => {
                const name = form.elements["iconName"].value.trim();
                const path = form.elements["iconPath"].value.trim();
                return name && path ? { name, path } : null;
            },
        });
    }

    /**
     * Unified pipeline for editing vector entities to remove boilerplate. `onRender(element)`, when
     * given, runs once the dialogue is in the page; `onExtract(form, fallbackName)` reads the
     * changes from its form.
     */
    static async _processEditDialog(app, entity, options = {}) {
        const { titleKey, template, htmlContent, context = {}, onRender, onExtract, onSave, triggersTerrain = false, repaintCanvas = false, renderParts = ["context"] } = options;

        const content = template ? await platform.templates.render(template, context) : htmlContent;

        const result = await platform.dialogs.prompt({
            classes: ["fwmb"],
            title: platform.i18n.localize(titleKey) || titleKey,
            content: content,
            onRender,
            onSubmit: (form) => (onExtract ? onExtract(form, entity.name) : null),
        });

        if (result) {
            MapStateManager.pushVectorState(app);

            platform.utils.mergeObject(entity, result);
            if (onSave) onSave(entity, result);
            if (repaintCanvas) app._repaintCanvas();
            else app._repaintVectors();
            if (triggersTerrain) app.requestTerrainUpdate();
            app.view?.render(renderParts);
            app.markDirty();
        }
    }

    /**
     * Unified Configuration for all Add/Edit/Delete Quick Style operations.
     */
    static get QUICK_STYLE_CONFIG() {
        return {
            Label: {
                registryKey: "customLabelStyles",
                activeStateKey: "activeLabelQuickStyle",
                template: "modules/filrodens-world-map-builder/templates/dialogs/edit-label-quick-style.hbs",
                getDefaults: (app) => ({
                    name: "New Label Style",
                    fontFamily: app.uiState.labelFontFamily || FILRODENSWMB.LABELS.DEFAULT_FONT,
                    fontSize: app.uiState.labelFontSize || 1,
                    fillColor: app.uiState.labelFillColor || "#000000",
                    maxChars: app.uiState.labelMaxChars || 0,
                    justify: app.uiState.labelJustify || "left",
                    bold: app.uiState.labelBold !== false,
                    italic: app.uiState.labelItalic === true,
                }),
                getContext: (app, style) => ({
                    style,
                    fontGroups: labelFontGroups(platform.fonts.list(), "FILRODENSWMB.UI.FontCategoryOther"),
                    fontMissing: !!style.fontFamily && !platform.fonts.list().includes(style.fontFamily),
                    palette: FILRODENSWMB.LABELS?.PRESETS || [],
                }),
                onExtract: (form, fallbackName) => ({
                    name: form.elements["styleName"].value.trim() || fallbackName,
                    fontFamily: form.elements["styleFontFamily"].value,
                    fontSize: Number(form.elements["styleFontSize"].value) || 1,
                    fillColor: form.elements["styleFillColor"].value,
                    maxChars: Number(form.elements["styleMaxChars"].value) || 0,
                    justify: form.elements["styleJustify"].value,
                    bold: form.elements["styleBold"]?.checked !== false,
                    italic: form.elements["styleItalic"]?.checked === true,
                }),
                onCascade: (app, id, result) => {
                    const aestheticProperties = {
                        fontFamily: result.fontFamily,
                        fontSize: result.fontSize,
                        fillColor: result.fillColor,
                        maxChars: result.maxChars,
                        justify: result.justify,
                        bold: result.bold !== false,
                        italic: result.italic === true,
                    };

                    for (const lbl of app.mapLabels) {
                        if (lbl.quickStyle === id) platform.utils.mergeObject(lbl, aestheticProperties);
                    }
                    const updateAttached = (ent) => {
                        if (ent.label && ent.label.quickStyle === id) platform.utils.mergeObject(ent.label, aestheticProperties);
                    };
                    app.mapPins.forEach(updateAttached);
                    app.mapRoutes.forEach(updateAttached);
                    app.regionLevels.forEach((level) => level.regions.forEach(updateAttached));
                },
                onDisconnect: (app, id) => {
                    for (const lbl of app.mapLabels) if (lbl.quickStyle === id) lbl.quickStyle = "custom";
                    const disconnectAttached = (ent) => {
                        if (ent.label && ent.label.quickStyle === id) ent.label.quickStyle = "custom";
                    };
                    app.mapPins.forEach(disconnectAttached);
                    app.mapRoutes.forEach(disconnectAttached);
                    app.regionLevels.forEach((level) => level.regions.forEach(disconnectAttached));
                },
                // Mirrors onDisconnect's traversal (standalone Custom Labels, plus the attached
                // `.label` sub-object every pin/route/region carries) but tallies matches instead
                // of resetting them - powers the usage count shown on this style's card.
                getUsageCount: (app, id) => {
                    let count = app.mapLabels.filter((lbl) => lbl.quickStyle === id).length;
                    const isAttachedMatch = (ent) => ent.label && ent.label.quickStyle === id;
                    count += app.mapPins.filter(isAttachedMatch).length;
                    count += app.mapRoutes.filter(isAttachedMatch).length;
                    for (const level of app.regionLevels) count += level.regions.filter(isAttachedMatch).length;
                    return count;
                },
                onUpdateActiveUI: (app, result) => {
                    app.uiState.labelFontFamily = result.fontFamily;
                    app.uiState.labelFontSize = result.fontSize;
                    app.uiState.labelFillColor = result.fillColor;
                    app.uiState.labelMaxChars = result.maxChars;
                    app.uiState.labelJustify = result.justify;
                    app.uiState.labelBold = result.bold !== false;
                    app.uiState.labelItalic = result.italic === true;
                },
            },
            Route: {
                registryKey: "customRouteStyles",
                activeStateKey: "activeRouteQuickStyle",
                template: "modules/filrodens-world-map-builder/templates/dialogs/edit-route-quick-style.hbs",
                getDefaults: () => ({
                    name: "New Quick Style",
                    color: "#ffffff",
                    thickness: 2,
                    style: "solid",
                    outline: true,
                    smoothing: false,
                }),
                getContext: (app, style) => ({
                    style: { ...style, outline: style.outline !== false, smoothing: style.smoothing === true },
                    thicknessStep: ROUTE_THICKNESS_STEP,
                    palette: FILRODENSWMB.LABELS?.PRESETS || [],
                }),
                onExtract: (form, fallbackName) => ({
                    name: form.elements["styleName"].value.trim() || fallbackName,
                    color: form.elements["styleColor"].value,
                    thickness: roundRouteThickness(form.elements["styleThickness"].value),
                    style: form.elements["styleStyle"].value,
                    outline: form.elements["styleOutline"].checked,
                    smoothing: form.elements["styleSmoothing"].checked,
                }),
                onCascade: (app, id, result) => {
                    const aestheticProperties = this.routeStyleFields(result);
                    for (const route of app.mapRoutes) {
                        if (route.quickStyle === id) platform.utils.mergeObject(route, aestheticProperties);
                    }
                },
                onDisconnect: (app, id) => {
                    for (const route of app.mapRoutes) if (route.quickStyle === id) route.quickStyle = "custom";
                },
                getUsageCount: (app, id) => app.mapRoutes.filter((route) => route.quickStyle === id).length,
                onUpdateActiveUI: (app, result) => {
                    app.uiState.routeColor = result.color;
                    app.uiState.routeThickness = result.thickness;
                    app.uiState.routeStyle = result.style;
                    app.uiState.routeOutline = result.outline !== false;
                    app.uiState.routeSmoothing = result.smoothing === true;
                },
            },
            // Region quick styles hold a region's fill only: a region's border belongs to its level
            // (the level's line style), so the line and smoothing fields older styles carry are
            // dropped when such a style is next saved (see onSave)
            Pin: {
                registryKey: "customPinStyles",
                activeStateKey: "activePinStyle",
                template: "modules/filrodens-world-map-builder/templates/dialogs/edit-pin-quick-style.hbs",
                getDefaults: (app) => ({
                    name: "New Pin Style",
                    icon: app.uiState.activeIcon || FILRODENSWMB.PIN_ICONS.DEFAULT,
                    scale: app.uiState.pinScale ?? FILRODENSWMB.PINS.DEFAULT_SCALE,
                    color: app.uiState.pinColor || FILRODENSWMB.PINS.DEFAULT_STYLE_COLOR,
                    label: { fontSize: app.uiState.pinScale ?? FILRODENSWMB.PINS.DEFAULT_SCALE, visibility: "all", quickStyle: PinStyles.NONE },
                    detailLevel: FILRODENSWMB.PINS.DETAIL_LEVELS.at(-1),
                }),
                getContext: (app, style) => {
                    const icons = getPinIconPickerList(style.icon).map((entry) => ({ key: entry.key, localized: entry.label, path: entry.path, isCustom: entry.isCustom, selected: entry.key === style.icon }));
                    const current = icons.find((entry) => entry.selected);
                    return {
                        style,
                        icons,
                        pinIconPath: current?.path || "",
                        pinIconIsCustom: current?.isCustom || false,
                        palette: FILRODENSWMB.LABELS?.PRESETS || [],
                        customLabelStyles: app.uiState.customLabelStyles || [],
                        detailLevels: PinStyles.detailLevelChoices(style.detailLevel),
                        visibilities: PinStyles.visibilityChoices(style.label?.visibility),
                    };
                },
                onRender: (html) => this._bindIconPicker(html, "fwmb-pin-style"),
                onExtract: (form, fallbackName) => ({
                    name: form.elements["styleName"].value.trim() || fallbackName,
                    icon: form.elements["styleIcon"].value,
                    scale: Number(form.elements["styleScale"].value) || FILRODENSWMB.PINS.DEFAULT_SCALE,
                    color: form.elements["styleColor"].value,
                    label: {
                        fontSize: Number(form.elements["styleLabelSize"].value) || FILRODENSWMB.PINS.DEFAULT_SCALE,
                        visibility: form.elements["styleLabelVisibility"].value,
                        quickStyle: form.elements["styleLabelQuickStyle"].value,
                    },
                    detailLevel: Number(form.elements["styleDetailLevel"].value) || 0,
                }),
                onCascade: (app, id, result) => PinStyles.cascade(app, { id, ...result }),
                onDisconnect: (app, id) => PinStyles.disconnect(app, id),
                getUsageCount: (app, id) => PinStyles.usageCount(app, id),
                onUpdateActiveUI: (app, result) => PinStyles.readIntoToolbar(app, result),
            },
            Region: {
                registryKey: "customRegionStyles",
                activeStateKey: "activeRegionQuickStyle",
                template: "modules/filrodens-world-map-builder/templates/dialogs/edit-region-quick-style.hbs",
                getDefaults: () => ({
                    name: "New Region Style",
                    fillColor: "#c6af53",
                    fillStyle: "solid",
                }),
                getContext: (app, style) => ({
                    style,
                    palette: FILRODENSWMB.LABELS?.PRESETS || [],
                }),
                onExtract: (form, fallbackName) => ({
                    name: form.elements["styleName"].value.trim() || fallbackName,
                    fillColor: form.elements["styleFillTransparent"].checked ? "transparent" : form.elements["styleFillColor"].value,
                    fillStyle: form.elements["styleFillStyle"].value,
                }),
                onSave: (style) => {
                    for (const key of MapDialogManager.#LEGACY_REGION_STYLE_FIELDS) delete style[key];
                },
                onCascade: (app, id, result) => {
                    const aestheticProperties = { fillColor: result.fillColor, fillStyle: result.fillStyle };
                    for (const level of app.regionLevels) {
                        for (const region of level.regions) if (region.quickStyle === id) platform.utils.mergeObject(region, aestheticProperties);
                    }
                },
                onDisconnect: (app, id) => {
                    for (const level of app.regionLevels) {
                        for (const region of level.regions) if (region.quickStyle === id) region.quickStyle = "custom";
                    }
                },
                getUsageCount: (app, id) => app.regionLevels.reduce((sum, level) => sum + level.regions.filter((region) => region.quickStyle === id).length, 0),
            },
            Biome: {
                registryKey: "customBiomes",
                template: "modules/filrodens-world-map-builder/templates/dialogs/edit-biome.hbs",
                getDefaults: (app) => ({
                    name: `Custom Biome ${app.uiState.customBiomes.length + 1}`,
                    code: null,
                    color: [128, 128, 128],
                    placement: FILRODENSWMB.BIOME_PLACEMENT.LAND,
                }),
                getContext: (app, biome) => ({
                    biome: { ...biome, hex: ColorMath.rgbToHex(biome.color) },
                    palette: FILRODENSWMB.LABELS?.PRESETS || [],
                    placements: this.#biomePlacementChoices(BiomePlacement.placementOfCustom(biome)),
                }),
                onExtract: (form, fallbackName) => ({
                    name: form.elements["biomeName"].value.trim() || fallbackName,
                    code: form.elements["biomeCode"].value.trim() || null,
                    color: ColorMath.hexToRgb(form.elements["biomeColor"].value),
                    placement: form.elements["biomePlacement"].value,
                    // Superseded by `placement`, which takes priority over it anyway (see
                    // BiomePlacement.placementOfCustom); cleared so an older map's flag is not
                    // carried forward once the biome has been edited
                    solidOverWater: undefined,
                }),
            },
        };
    }

    /** The border fields region quick styles held before borders belonged to the level. */
    static #LEGACY_REGION_STYLE_FIELDS = ["lineColor", "lineThickness", "lineStyle", "smoothing"];

    /**
     * The choices for a custom biome's Placement select, in the order they are offered, with the
     * biome's current placement selected.
     * @param {string} selected - One of FILRODENSWMB.BIOME_PLACEMENT.
     * @returns {Array<{value: string, label: string, selected: boolean}>}
     */
    static #biomePlacementChoices(selected) {
        return Object.values(FILRODENSWMB.BIOME_PLACEMENT).map((value) => ({ value, label: BiomePlacement.labelOf(value), selected: value === selected }));
    }

    /**
     * Unified configuration for Mass Edit: applying visual properties to every entity
     * currently selected via a type's Select checkboxes, in one batch. Mirrors the shape of
     * QUICK_STYLE_CONFIG above so the two systems stay easy to read side-by-side, but each
     * entry describes an opt-in FIELD LIST instead of a single style object - only fields the
     * GM ticks in the Mass Edit dialogue are applied, everything else is left untouched on every
     * selected entity (a deliberate design choice: mass edit never overwrites a property the
     * GM didn't explicitly opt into). The "quickStyle" field, where present, is a bundle:
     * ticking it applies both the chosen style's id and its resolved aesthetic properties
     * together, exactly as picking a Quick Style does in the single-item edit dialogues. Any
     * other checked field is extracted and merged in afterwards (see _extractMassEditPatch),
     * so an explicit per-field value always wins over whatever the quick style would have set.
     */
    static get MASS_EDIT_CONFIG() {
        // Small helper factory: given a customXStyles registry key, returns a lookup function
        // for "find the style with this id", shared by every type's quickStyle field below.
        const resolveStyle = (registryKey) => (app, id) => (app.uiState[registryKey] || []).find((s) => s.id === id);

        // Pins, Routes, and Regions each carry an attached label (the same `label{...}`
        // sub-object their single-item edit dialogues expose as a second "Label Properties"
        // fieldset) - Mass Edit should be able to batch those fields too, not just the
        // entity's own visual properties.
        const labelFields = () => [
            {
                checkboxName: "applyLabelQuickStyle",
                extract: (form, app) => {
                    const id = form.elements["labelQuickStyle"].value;
                    const style = id !== "custom" ? resolveStyle("customLabelStyles")(app, id) : null;
                    return style
                        ? {
                              label: {
                                  quickStyle: id,
                                  fontFamily: style.fontFamily,
                                  fontSize: style.fontSize,
                                  fillColor: style.fillColor,
                                  maxChars: style.maxChars,
                                  justify: style.justify,
                              },
                          }
                        : { label: { quickStyle: "custom" } };
                },
            },
            { checkboxName: "applyLabelFontFamily", extract: (form) => ({ label: { fontFamily: form.elements["labelFontFamily"].value } }) },
            { checkboxName: "applyLabelFontSize", extract: (form) => ({ label: { fontSize: Number(form.elements["labelFontSize"].value) || 1 } }) },
            { checkboxName: "applyLabelFillColor", extract: (form) => ({ label: { fillColor: form.elements["labelFillColor"].value } }) },
            { checkboxName: "applyLabelMaxChars", extract: (form) => ({ label: { maxChars: Number(form.elements["labelMaxChars"].value) || 0 } }) },
            { checkboxName: "applyLabelJustify", extract: (form) => ({ label: { justify: form.elements["labelJustify"].value } }) },
        ];

        // The dialogue context (fonts, the Label Quick Style registry, and starting field
        // values) needed to render that shared fieldset - merged into each owning type's own
        // getContext() result below.
        const getLabelContext = (app) => ({
            fonts: platform.fonts.list(),
            customLabelStyles: app.uiState.customLabelStyles || [],
            labelDefaults: this.QUICK_STYLE_CONFIG.Label.getDefaults(app),
        });

        return {
            pin: {
                titleKey: "FILRODENSWMB.UI.MassEditPinsTitle",
                template: "modules/filrodens-world-map-builder/templates/dialogs/mass-edit-pins.hbs",
                getEntities: (app, ids) => app.mapPins.filter((p) => ids.has(p.id)),
                getContext: (app) => {
                    const icons = getPinIconPickerList().map((entry) => ({ key: entry.key, localized: entry.label, path: entry.path, isCustom: entry.isCustom }));
                    return {
                        icons,
                        defaultIcon: icons[0] || null,
                        pinStyles: PinStyles.choices(app, null),
                        palette: FILRODENSWMB.LABELS?.PRESETS || [],
                        ...getLabelContext(app),
                    };
                },
                onRender: (html, app) => {
                    this._bindIconPicker(html, "fwmb-mass-edit-pin");
                    this.bindLabelPropertiesDialog(html, app.uiState);
                },
                fields: [
                    {
                        // A style brings its icon, colour, scale and label fields with it; "no style" only lets the pins go
                        checkboxName: "applyPinStyle",
                        extract: (form, app) => {
                            const style = PinStyles.find(app, form.elements["massPinStyle"].value);
                            return style ? { pinStyle: style.id, ...PinStyles.fields(app, style) } : { pinStyle: null };
                        },
                    },
                    { checkboxName: "applyIcon", extract: (form) => ({ icon: form.elements["massIcon"].value }) },
                    { checkboxName: "applyColor", extract: (form) => ({ color: form.elements["massColor"].value }) },
                    { checkboxName: "applyScale", extract: (form) => ({ scale: Number(form.elements["massScale"].value) || 1 }) },
                    ...labelFields(),
                ],
            },
            route: {
                titleKey: "FILRODENSWMB.UI.MassEditRoutesTitle",
                template: "modules/filrodens-world-map-builder/templates/dialogs/mass-edit-routes.hbs",
                getEntities: (app, ids) => app.mapRoutes.filter((r) => ids.has(r.id)),
                getContext: (app) => ({
                    customRouteStyles: app.uiState.customRouteStyles || [],
                    palette: FILRODENSWMB.LABELS?.PRESETS || [],
                    defaults: this.QUICK_STYLE_CONFIG.Route.getDefaults(),
                    thicknessStep: ROUTE_THICKNESS_STEP,
                    ...getLabelContext(app),
                }),
                onRender: (html, app) => {
                    const quickStyleSelect = html.querySelector('select[name="massQuickStyle"]');
                    const fields = {
                        color: html.querySelector('input[name="massColor"]'),
                        thickness: html.querySelector('input[name="massThickness"]'),
                        style: html.querySelector('select[name="massStyle"]'),
                        outline: html.querySelector('input[name="massOutline"]'),
                        smoothing: html.querySelector('input[name="massSmoothing"]'),
                    };

                    quickStyleSelect?.addEventListener("change", (e) => {
                        const style = resolveStyle("customRouteStyles")(app, e.target.value);
                        if (style) this.applyRouteStyleToFields(style, fields);
                    });
                    this.bindLabelPropertiesDialog(html, app.uiState);
                },
                fields: [
                    {
                        checkboxName: "applyQuickStyle",
                        extract: (form, app) => {
                            const id = form.elements["massQuickStyle"].value;
                            const style = id !== "custom" ? resolveStyle("customRouteStyles")(app, id) : null;
                            return style ? { quickStyle: id, ...this.routeStyleFields(style) } : { quickStyle: "custom" };
                        },
                    },
                    { checkboxName: "applyColor", extract: (form) => ({ color: form.elements["massColor"].value }) },
                    { checkboxName: "applyThickness", extract: (form) => ({ thickness: roundRouteThickness(form.elements["massThickness"].value) }) },
                    { checkboxName: "applyStyle", extract: (form) => ({ style: form.elements["massStyle"].value }) },
                    { checkboxName: "applyOutline", extract: (form) => ({ outline: form.elements["massOutline"].checked }) },
                    { checkboxName: "applySmoothing", extract: (form) => ({ smoothing: form.elements["massSmoothing"].checked }) },
                    ...labelFields(),
                ],
            },
            region: {
                titleKey: "FILRODENSWMB.UI.MassEditRegionsTitle",
                template: "modules/filrodens-world-map-builder/templates/dialogs/mass-edit-regions.hbs",
                getEntities: (app, ids) => app.regionLevels.flatMap((level) => level.regions).filter((r) => ids.has(r.id)),
                getContext: (app) => ({
                    customRegionStyles: app.uiState.customRegionStyles || [],
                    palette: FILRODENSWMB.LABELS?.PRESETS || [],
                    defaults: this.QUICK_STYLE_CONFIG.Region.getDefaults(),
                    ...getLabelContext(app),
                }),
                onRender: (html, app) => {
                    const quickStyleSelect = html.querySelector('select[name="massQuickStyle"]');
                    const fillTransparentCheckbox = html.querySelector('input[name="massFillTransparent"]');
                    const fillColorInput = html.querySelector('input[name="massFillColor"]');
                    const fillStyleSelect = html.querySelector('select[name="massFillStyle"]');

                    quickStyleSelect?.addEventListener("change", (e) => {
                        const style = resolveStyle("customRegionStyles")(app, e.target.value);
                        if (!style) return;
                        const isTransparent = style.fillColor === "transparent";
                        if (fillTransparentCheckbox) fillTransparentCheckbox.checked = isTransparent;
                        if (fillColorInput) fillColorInput.value = isTransparent ? "#000000" : style.fillColor;
                        if (fillStyleSelect) fillStyleSelect.value = style.fillStyle;
                    });
                    this.bindLabelPropertiesDialog(html, app.uiState);
                },
                fields: [
                    {
                        checkboxName: "applyQuickStyle",
                        extract: (form, app) => {
                            const id = form.elements["massQuickStyle"].value;
                            const style = id !== "custom" ? resolveStyle("customRegionStyles")(app, id) : null;
                            return style ? { quickStyle: id, fillColor: style.fillColor, fillStyle: style.fillStyle } : { quickStyle: "custom" };
                        },
                    },
                    {
                        checkboxName: "applyFillColor",
                        extract: (form) => ({ fillColor: form.elements["massFillTransparent"].checked ? "transparent" : form.elements["massFillColor"].value }),
                    },
                    { checkboxName: "applyFillStyle", extract: (form) => ({ fillStyle: form.elements["massFillStyle"].value }) },
                    ...labelFields(),
                ],
            },
            label: {
                titleKey: "FILRODENSWMB.UI.MassEditLabelsTitle",
                template: "modules/filrodens-world-map-builder/templates/dialogs/mass-edit-labels.hbs",
                getEntities: (app, ids) => app.mapLabels.filter((l) => ids.has(l.id)),
                getContext: (app) => ({
                    customLabelStyles: app.uiState.customLabelStyles || [],
                    fonts: platform.fonts.list(),
                    palette: FILRODENSWMB.LABELS?.PRESETS || [],
                    defaults: this.QUICK_STYLE_CONFIG.Label.getDefaults(app),
                }),
                onRender: (html, app) => {
                    const quickStyleSelect = html.querySelector('select[name="massQuickStyle"]');
                    const fontFamilySelect = html.querySelector('select[name="massFontFamily"]');
                    const fontSizeInput = html.querySelector('input[name="massFontSize"]');
                    const colorInput = html.querySelector('input[name="massFillColor"]');
                    const maxCharsInput = html.querySelector('input[name="massMaxChars"]');
                    const justifySelect = html.querySelector('select[name="massJustify"]');

                    quickStyleSelect?.addEventListener("change", (e) => {
                        const style = resolveStyle("customLabelStyles")(app, e.target.value);
                        if (!style) return;
                        if (fontFamilySelect) fontFamilySelect.value = style.fontFamily;
                        if (colorInput) colorInput.value = style.fillColor;
                        if (maxCharsInput) maxCharsInput.value = style.maxChars;
                        if (justifySelect) justifySelect.value = style.justify;
                        if (fontSizeInput) {
                            fontSizeInput.value = style.fontSize;
                            RangeDisplay.sync(fontSizeInput);
                        }
                    });
                },
                fields: [
                    {
                        checkboxName: "applyQuickStyle",
                        extract: (form, app) => {
                            const id = form.elements["massQuickStyle"].value;
                            const style = id !== "custom" ? resolveStyle("customLabelStyles")(app, id) : null;
                            return style
                                ? { quickStyle: id, fontFamily: style.fontFamily, fontSize: style.fontSize, fillColor: style.fillColor, maxChars: style.maxChars, justify: style.justify }
                                : { quickStyle: "custom" };
                        },
                    },
                    { checkboxName: "applyFontFamily", extract: (form) => ({ fontFamily: form.elements["massFontFamily"].value }) },
                    { checkboxName: "applyFontSize", extract: (form) => ({ fontSize: Number(form.elements["massFontSize"].value) || 1 }) },
                    { checkboxName: "applyFillColor", extract: (form) => ({ fillColor: form.elements["massFillColor"].value }) },
                    { checkboxName: "applyMaxChars", extract: (form) => ({ maxChars: Number(form.elements["massMaxChars"].value) || 0 }) },
                    { checkboxName: "applyJustify", extract: (form) => ({ justify: form.elements["massJustify"].value }) },
                ],
            },
        };
    }

    // --- ADD ACTIONS ---

    static async onAddCustomBiome(app, _event, _target) {
        const config = this.QUICK_STYLE_CONFIG.Biome;
        const newBiome = config.getDefaults(app);

        await this._processEditDialog(app, newBiome, {
            titleKey: "FILRODENSWMB.UI.AddCustomBiome",
            template: config.template,
            context: config.getContext(app, newBiome),
            repaintCanvas: true,
            renderParts: ["context", "toolbar"],
            onExtract: (form) => config.onExtract(form, newBiome.name),
            onSave: (entity, result) => {
                const id = MapStateManager.getNextCustomBiomeId(app.uiState);
                // rules starts empty - a freshly created biome has no auto-generation rules
                // yet, so it simply never matches and falls straight through to the built-in
                // defaults until the rule editor is used to add some.
                app.uiState.customBiomes.push({ id, ...result, rules: [] });
            },
        });
    }

    static async onEditCustomBiome(app, event, target) {
        const config = this.QUICK_STYLE_CONFIG.Biome;
        const id = Number(target.closest(".fwmb-list-item").dataset.id);
        const biome = app.uiState.customBiomes.find((b) => b.id === id);
        if (!biome) return;

        await this._processEditDialog(app, biome, {
            titleKey: "FILRODENSWMB.UI.Edit",
            template: config.template,
            context: config.getContext(app, biome),
            repaintCanvas: true,
            renderParts: ["context", "toolbar"],
            onExtract: (form) => config.onExtract(form, biome.name),
        });
    }

    /**
     * Opens the Biome Rule Stacker (see RuleEditorDialog) - a dedicated large dialogue for
     * reviewing and editing custom biomes' auto-generation rules against the built-in
     * defaults. Delegates entirely to RuleEditorDialog, which is
     * kept in its own file rather than grown here given how large this feature is expected
     * to become - see that file's own doc comment.
     */
    static async onOpenBiomeRuleEditor(app, _event, _target) {
        await RuleEditorDialog.open(app);
    }

    static async onAddCustomPinIcon(app, _event, _target) {
        const result = await this._promptPinIconDialog({ name: "", path: "" }, "FILRODENSWMB.UI.AddCustomPinIcon");
        if (!result) return;

        await addCustomPinIcon(result);
        app.view?.render(["context"]);
    }

    static async onToggleBuiltinPinIcon(app, event, target) {
        const key = target.dataset.key;
        if (!key) return;

        await setBuiltinPinIconDisabled(key, target.checked);
        app.view?.render(["context"]);
    }

    static async onHideAllBuiltinPinIcons(app, _event, _target) {
        await setAllBuiltinPinIconsDisabled(true);
        app.view?.render(["context"]);
    }

    static async onRevealAllBuiltinPinIcons(app, _event, _target) {
        await setAllBuiltinPinIconsDisabled(false);
        app.view?.render(["context"]);
    }

    static async onAddDecoration(app, _event, _target) {
        if (!app.canvasEngine?.isEditMode) return;

        const defaultName = `Decoration ${app.mapDecorations.length + 1}`;

        const content = await platform.templates.render("modules/filrodens-world-map-builder/templates/dialogs/add-decoration.hbs", { defaultName });

        const result = await platform.dialogs.prompt({
            classes: ["fwmb"],
            title: platform.i18n.localize("FILRODENSWMB.UI.AddDecoration"),
            content: content,
            onSubmit: (form) => ({
                name: form.elements["fwmb-dec-name"].value.trim() || defaultName,
                src: form.elements["fwmb-dec-src"].value,
            }),
        });

        if (!result) return;

        if (result?.src) {
            MapStateManager.pushVectorState(app);

            const spawnX = app.mapWidth / 2;
            const spawnY = app.mapHeight / 2;

            app.mapDecorations.push({
                id: platform.utils.randomID(),
                type: "decoration",
                name: result.name || "Unnamed Decoration",
                src: result.src,
                x: spawnX,
                y: spawnY,
                rotation: 0,
                scale: 1,
                visibility: "all",
            });

            app._repaintVectors();
            app.view?.render(["context"]);
            app.markDirty();
        }
    }

    static async onAddQuickStyle(app, event, target) {
        const type = target.dataset.action.replace("add", "").replace("QuickStyle", ""); // e.g. "Label"
        const config = this.QUICK_STYLE_CONFIG[type];
        if (!config) return;

        const newStyle = config.getDefaults(app);

        await this._processEditDialog(app, newStyle, {
            titleKey: `FILRODENSWMB.UI.Add${type}QuickStyle`,
            template: config.template,
            context: config.getContext(app, newStyle),
            renderParts: ["context", "toolbar"],
            onRender: config.onRender,
            onExtract: (form) => config.onExtract(form, newStyle.name),
            onSave: (entity, result) => {
                const id = platform.utils.randomID();
                app.uiState[config.registryKey].push({ id, ...result });
            },
        });
    }

    // --- DELETE ACTIONS ---

    /**
     * Deleting a custom biome only ever touches `uiState.customBiomes` - it deliberately does
     * NOT zero out `currentBiomeOverrides` or scrub the biome's id out of `brushEngine.history`/
     * `redoStack`, even though painted pixels and strokes referencing this id are left behind.
     * An earlier version of this method did that scrubbing, but it was a direct, permanent
     * mutation of raster data that the undo/redo system has no way to know about or reverse
     * (see MapStateManager.getVectorStateSnapshot/restoreVectorStateSnapshot - only the vector
     * `uiState.customBiomes` array is snapshotted, never the raster buffers or brush strokes),
     * so undoing a delete brought the biome back in the list while its paint stayed lost, and a
     * later redo could leave a stale, no-longer-existent id sitting in the raster data with
     * nothing to render it. ProceduralEngine.resolveBiomeLookup now treats exactly that case -
     * an override id that doesn't resolve to any current biome - as if the pixel had never been
     * painted, so leaving the old id in place is safe: it just falls through to the map's normal
     * auto-generated biome for as long as the id stays deleted, and paints itself back in for
     * free (no restore code needed here) if the biome ever comes back, whether via undo or by
     * being recreated. This also means the id itself must stay "spent" rather than being reused -
     * see MapStateManager.getNextCustomBiomeId.
     */
    static async onDeleteCustomBiome(app, event, target) {
        const id = Number(target.closest(".fwmb-list-item").dataset.id);

        const confirmed = await this._confirmDialog(undefined, platform.i18n.localize("FILRODENSWMB.UI.DeleteBiomeConfirm"));
        if (!confirmed) return;

        MapStateManager.pushVectorState(app);
        app.uiState.customBiomes = app.uiState.customBiomes.filter((c) => c.id !== id);

        if (Number(app.uiState.brushBiome) === id) {
            app.uiState.brushBiome = FILRODENSWMB.BIOME_IDS.GRASSLAND;
            app.view?.render(["toolbar"]);
        }

        app._repaintCanvas();
        app.view?.render(["toolbar", "context"]);
        app.markDirty();
    }

    static async onRemoveCustomPinIcon(app, event, target) {
        const id = target.closest(".fwmb-list-item").dataset.id;
        const icon = getCustomPinIconById(id);
        if (!icon) return;

        const usage = await findPinIconUsage(id, app.mapPins);

        const content =
            usage.totalCount > 0
                ? platform.i18n.format("FILRODENSWMB.UI.RemovePinIconInUseWarning", { name: icon.name, count: usage.totalCount })
                : platform.i18n.format("FILRODENSWMB.UI.RemovePinIconConfirm", { name: icon.name });

        const confirmed = await this._confirmDialog(platform.i18n.localize("FILRODENSWMB.UI.RemovePinIcon"), content);
        if (!confirmed) return;

        if (usage.totalCount > 0) {
            if (usage.liveCount > 0) MapStateManager.pushVectorState(app);
            await revertPinIconUsage(id, app.mapPins);
        }

        await removeCustomPinIconEntry(id);

        if (usage.liveCount > 0) {
            app._repaintVectors();
            app.markDirty();
        }

        app.view?.render(["context"]);
    }

    static async onDeleteEntity(app, event, target) {
        // Strip 'delete' from the action (e.g. 'deleteRiver' -> 'river')
        const action = target.dataset.action.replace("delete", "");
        const entityType = action.charAt(0).toLowerCase() + action.slice(1);

        // Look up the unified config
        const config = FILRODENSWMB.ENTITY_CONFIG[entityType];
        if (!config) return;

        await this.deleteEntityById(app, entityType, target.closest(".fwmb-list-item").dataset.id);
    }

    /**
     * Deletes one pin, river, fault, decoration or label (by ENTITY_CONFIG's type) after the
     * standard confirmation, as one undo step: from its list's delete button or the inspector.
     * @param {object} app
     * @param {string} entityType - A key of FILRODENSWMB.ENTITY_CONFIG.
     * @param {string} id
     * @returns {Promise<boolean>} Whether it was deleted.
     */
    static async deleteEntityById(app, entityType, id) {
        const config = FILRODENSWMB.ENTITY_CONFIG[entityType];
        if (!config || !app[config.stateKey]?.some((item) => item.id === id)) return false;

        const confirmed = await this._confirmDialog();
        if (!confirmed) return false;

        MapStateManager.pushVectorState(app);

        app[config.stateKey] = app[config.stateKey].filter((item) => item.id !== id);

        if (config.activeKey && app[config.activeKey] === id) {
            app[config.activeKey] = null;
        }

        app._repaintVectors();
        if (config.triggersTerrain) app.requestTerrainUpdate(null, app.debouncedGenerateTerrain);

        app.view?.render(["context"]);
        app.markDirty();
        return true;
    }

    static async onDeleteLandMask(app, event, target) {
        const id = target.closest(".fwmb-list-item").dataset.id;

        const confirmed = await this._confirmDialog();
        if (!confirmed) return;

        MapStateManager.pushVectorState(app);

        app.landMasks = app.landMasks.filter((m) => m.id !== id);

        if (app.activeLandMaskId === id) {
            app.activeLandMaskId = null;
        }

        app._repaintVectors();
        app.requestTerrainUpdate();
        app.view?.render(["context"]);
        app.markDirty();
    }

    /**
     * Bulk-deletes every land mask on the current map (both "add" landmass masks and
     * "subtract" ocean-hole masks) after a single confirmation, instead of requiring one
     * onDeleteLandMask call per shape. Mirrors that method's undo tracking and repaint/terrain/
     * dirty sequence exactly - just clears the whole array at once rather than filtering out a
     * single id. A no-op when there's nothing to delete (the toolbar button is also disabled in
     * that case, but this guards direct calls too).
     */
    static async onDeleteAllLandMasks(app, _event, _target) {
        if (app.landMasks.length === 0) return;

        const confirmed = await this._confirmDialog(
            platform.i18n.localize("FILRODENSWMB.UI.DeleteAllLandMasksTitle"),
            platform.i18n.format("FILRODENSWMB.UI.DeleteAllLandMasksConfirm", { count: app.landMasks.length }),
        );
        if (!confirmed) return;

        MapStateManager.pushVectorState(app);

        app.landMasks = [];
        app.activeLandMaskId = null;

        app._repaintVectors();
        app.requestTerrainUpdate();
        app.view?.render(["context"]);
        app.markDirty();
    }

    static async onDeleteQuickStyle(app, event, target) {
        const type = target.dataset.action.replace("delete", "").replace("QuickStyle", "");
        const config = this.QUICK_STYLE_CONFIG[type];
        if (!config) return;

        const id = target.closest(".fwmb-list-item").dataset.id;
        const confirmed = await this._confirmDialog();
        if (!confirmed) return;

        MapStateManager.pushVectorState(app);

        app.uiState[config.registryKey] = app.uiState[config.registryKey].filter((s) => s.id !== id);

        if (config.onDisconnect) config.onDisconnect(app, id);

        if (app.uiState[config.activeStateKey] === id) {
            app.uiState[config.activeStateKey] = "custom";
            app.view?.render(["toolbar", "context"]);
        }

        app.markDirty();
        app.view?.render(["context", "toolbar"]);
    }

    // --- MASS EDIT ---

    /**
     * Wires up the opt-in checkboxes in a Mass Edit dialogue. Every field row is a `.fwmb-form-group`
     * containing one gate checkbox (name starting "apply...") plus the field(s) it controls;
     * this leaves every other control in that row disabled until its checkbox is ticked, which
     * both prevents an accidental submit of a field the GM never meant to touch and gives free
     * "this field is inactive" styling from the existing global `:disabled` rules. The custom
     * pin-icon picker in the Pins dialogue isn't a native input, so it can't be disabled the same
     * way - it's instead toggled via the `.fwmb-mass-edit-locked` CSS class (pointer-events
     * off, dimmed), applied to any `.fwmb-custom-select` found in the same row.
     */
    static bindMassEditToggles(html) {
        html.querySelectorAll('input[type="checkbox"][name^="apply"]').forEach((gate) => {
            const row = gate.closest(".fwmb-form-group");
            if (!row) return;

            const controls = Array.from(row.querySelectorAll("input, select, textarea")).filter((el) => el !== gate);
            const customSelect = row.querySelector(".fwmb-custom-select");

            const syncLockState = () => {
                controls.forEach((el) => (el.disabled = !gate.checked));
                if (customSelect) customSelect.classList.toggle("fwmb-mass-edit-locked", !gate.checked);
            };

            gate.addEventListener("change", syncLockState);
            syncLockState();
        });
    }

    /**
     * Builds the patch object to merge into every selected entity from a submitted Mass Edit
     * form: walks the type's declared field list in order and, for each one whose checkbox is
     * ticked, merges in whatever that field's `extract` returns. Fields are declared with the
     * "quickStyle" bundle first and individual properties after, so an explicitly ticked
     * property always overwrites the value the quick style would otherwise have set - see
     * MASS_EDIT_CONFIG's doc comment for the reasoning.
     */
    static _extractMassEditPatch(form, fields, app) {
        const patch = {};
        for (const field of fields) {
            const gate = form.elements[field.checkboxName];
            if (!gate?.checked) continue;
            // A recursive merge, not a shallow Object.assign: two different ticked fields can
            // both contribute to the same nested key (e.g. two label fields both writing into
            // `patch.label`), and a shallow assign would let the second one silently wipe out
            // whatever the first had already set there.
            platform.utils.mergeObject(patch, field.extract(form, app));
        }
        return patch;
    }

    /**
     * Opens the Mass Edit dialogue for one entity type and applies whatever the GM confirms to
     * every currently-selected entity of that type in a single batch. Cancelling the dialogue
     * leaves the selection and every entity untouched - Select mode stays active so the GM can
     * adjust their selection and try again. Confirming it (even with nothing ticked) always
     * exits Select mode and clears the selection: by design, completing the Mass Edit dialogue
     * is the second way out of Select mode, alongside toggling Select off directly.
     */
    static async onMassEdit(app, event, target) {
        const type = target.dataset.type;
        const config = this.MASS_EDIT_CONFIG[type];
        if (!config) return;

        const selection = app.massEditSelection[type];
        const entities = config.getEntities(app, selection);
        if (entities.length === 0) return;

        const context = { count: entities.length, ...config.getContext(app) };
        const content = await platform.templates.render(config.template, context);

        const result = await platform.dialogs.prompt({
            classes: ["fwmb"],
            title: platform.i18n.format(config.titleKey, { count: entities.length }),
            content: content,
            onRender: (dialogHtml) => {
                this.bindMassEditToggles(dialogHtml);
                if (config.onRender) config.onRender(dialogHtml, app);
            },
            onSubmit: (form) => this._extractMassEditPatch(form, config.fields, app),
        });

        if (!result) return;

        if (Object.keys(result).length > 0) {
            MapStateManager.pushVectorState(app);
            entities.forEach((entity) => platform.utils.mergeObject(entity, result));
            app._repaintVectors();
            app.markDirty();
        }

        app.massEditMode[type] = false;
        app.massEditSelection[type].clear();
        app.view?.render(["context"]);
    }

    // --- EDIT ACTIONS ---

    static async onEditDecoration(app, event, target, explicitId = null) {
        const id = explicitId || target.closest(".fwmb-list-item").dataset.id;
        const dec = app.mapDecorations.find((d) => d.id === id);
        if (!dec) return;

        await this._processEditDialog(app, dec, {
            titleKey: "FILRODENSWMB.UI.Edit",
            template: "modules/filrodens-world-map-builder/templates/dialogs/edit-decoration.hbs",
            context: {
                decoration: {
                    name: dec.name,
                    opacity: dec.opacity ?? 1,
                    // Snapped to the slider's grid, so the value shown matches the slider's position
                    // even for a scale saved before scales were stepped (1.157625 shows as 1.15)
                    scale: CanvasTransforms.stepValue(dec.scale ?? 1, 0, FILRODENSWMB.UI.WHEEL_RESIZE.DECORATION_SCALE),
                    rotation: CanvasTransforms.normalizeAngle(dec.rotation),
                },
                scaleRange: FILRODENSWMB.UI.WHEEL_RESIZE.DECORATION_SCALE,
                rotationRange: FILRODENSWMB.UI.ROTATION,
            },
            onExtract: (form) => ({
                name: form.elements["decorationName"].value,
                opacity: Number(form.elements["decorationOpacity"].value),
                scale: Number(form.elements["decorationScale"].value) || 1,
                rotation: CanvasTransforms.normalizeAngle(form.elements["decorationRotation"].value),
            }),
        });
    }

    static async onEditFault(app, event, target, explicitId = null) {
        const id = explicitId || target.closest(".fwmb-list-item").dataset.id;
        const fault = app.tectonicFaults.find((f) => f.id === id);
        if (!fault) return;

        const currentMap = TerrainVersion.getVersion(app.uiState) >= FILRODENSWMB.TERRAIN_VERSION.CURRENT;

        await this._processEditDialog(app, fault, {
            titleKey: "FILRODENSWMB.UI.EditFault",
            template: "modules/filrodens-world-map-builder/templates/dialogs/edit-tectonics.hbs",
            context: {
                fault,
                tectonicTypes: TectonicFeatureEngine.typeOptions(currentMap, fault.type),
                rangeStyles: Object.entries(FILRODENSWMB.TECTONICS.FEATURES.RANGE_STYLES).map(([styleId, label]) => ({ id: styleId, label })),
                settings: this.#featureSettings(fault),
                isFeature: TectonicFeatureEngine.isFeatureType(fault.type),
            },
            onRender: (html) => this.#watchFaultType(html),
            onExtract: (form) => this.#extractFault(form),
            onSave: (entity, result) => {
                this.#finishFaultEdit(entity, result);
                if (app.activeFaultId === id) {
                    app.uiState.faultType = entity.type;
                    app.uiState.faultThickness = entity.thickness;
                    app.uiState.faultStrength = entity.strength;
                    if (entity.style) app.uiState.faultStyle = entity.style;
                    app.view?.render(["editToolbar"]);
                }
            },
            triggersTerrain: true,
        });
    }

    /**
     * The settings of every tectonic feature type for the edit dialogue: the fault's own values
     * where it has them, the defaults otherwise, so switching type in the dialogue shows sensible
     * starting values.
     */
    static #featureSettings(fault) {
        const features = FILRODENSWMB.TECTONICS.FEATURES;
        return {
            style: fault.style ?? features.RANGE.DEFAULT_STYLE,
            arcDistance: fault.arcDistance ?? features.SUBDUCTION.DEFAULT_ARC_DISTANCE,
            trenchDepth: fault.trenchDepth ?? features.SUBDUCTION.DEFAULT_TRENCH_DEPTH,
            floorTexture: fault.floorTexture ?? features.RIFT.DEFAULT_FLOOR_TEXTURE,
            volcanoes: fault.volcanoes ?? 0,
            spacing: fault.spacing ?? features.HOTSPOT.DEFAULT_SPACING,
            spacingTrend: fault.spacingTrend ?? features.HOTSPOT.DEFAULT_SPACING_TREND,
            scatter: fault.scatter ?? features.HOTSPOT.DEFAULT_SCATTER,
            variation: fault.variation ?? features.HOTSPOT.DEFAULT_VARIATION,
            pulses: fault.pulses ?? features.HOTSPOT.DEFAULT_PULSES,
            vents: fault.vents ?? features.HOTSPOT.DEFAULT_VENTS,
            drowned: fault.drowned ?? features.HOTSPOT.DEFAULT_DROWNED,
        };
    }

    /** The settings each tectonic feature type reads, beyond thickness and strength. */
    static #FEATURE_FIELDS = {
        range: ["style"],
        subduction: ["arcDistance", "trenchDepth"],
        rift: ["floorTexture", "volcanoes"],
        hotspot: ["spacing", "spacingTrend", "scatter", "variation", "pulses", "vents", "drowned"],
    };

    /**
     * Shows the dialogue's settings for the chosen fault type and hides the rest, now and whenever
     * the type changes (see edit-tectonics.hbs).
     */
    static #watchFaultType(html) {
        const select = html.querySelector('select[name="faultType"]');
        if (!select) return;
        const update = () => {
            for (const section of html.querySelectorAll("[data-fault-types]")) {
                section.hidden = !section.dataset.faultTypes.split(" ").includes(select.value);
            }
        };
        select.addEventListener("change", update);
        update();
    }

    /**
     * Reads the edit dialogue: the shared fields, plus the settings of the chosen type only, so
     * a fault never keeps settings of a type it no longer is.
     */
    static #extractFault(form) {
        const elements = form.elements;
        const type = elements["faultType"].value;
        const result = {
            name: elements["faultName"].value,
            description: elements["faultDesc"].value,
            type,
            thickness: Number(elements["faultThickness"].value),
            strength: Number(elements["faultStrength"].value),
            reversed: elements["faultReverse"]?.checked === true,
        };
        for (const field of this.#FEATURE_FIELDS[type] ?? []) {
            const input = field === "style" ? elements["faultStyle"] : elements[field];
            if (input) result[field] = field === "style" ? input.value : Number(input.value);
        }
        return result;
    }

    /**
     * Completes an edited fault after the dialogue's values are merged into it: its colour, whether
     * it is a tectonic feature, and dropping settings of other types. Its direction is a setting
     * (`reversed`, see TectonicFeatureEngine), kept only while it is on and only for a feature.
     */
    static #finishFaultEdit(fault, result) {
        fault.color = TectonicFeatureEngine.colorOf(fault.type);
        if (!result.reversed || !TectonicFeatureEngine.isFeatureType(fault.type)) delete fault.reversed;

        const keep = new Set(this.#FEATURE_FIELDS[fault.type] ?? []);
        for (const fields of Object.values(this.#FEATURE_FIELDS)) {
            for (const field of fields) if (!keep.has(field)) delete fault[field];
        }

        if (TectonicFeatureEngine.isFeatureType(fault.type)) fault.revision = FILRODENSWMB.TECTONICS.FEATURES.REVISION;
        else delete fault.revision;
    }

    static async onEditCustomPinIcon(app, event, target) {
        const id = target.closest(".fwmb-list-item").dataset.id;
        const icon = getCustomPinIconById(id);
        if (!icon) return;

        const result = await this._promptPinIconDialog(icon, "FILRODENSWMB.UI.Edit");
        if (!result) return;

        await updateCustomPinIcon(id, result);
        app.view?.render(["context"]);
    }

    static async onEditQuickStyle(app, event, target) {
        const type = target.dataset.action.replace("edit", "").replace("QuickStyle", "");
        const config = this.QUICK_STYLE_CONFIG[type];
        if (!config) return;

        const id = target.closest(".fwmb-list-item").dataset.id;
        const style = app.uiState[config.registryKey].find((s) => s.id === id);
        if (!style) return;

        await this._processEditDialog(app, style, {
            titleKey: "FILRODENSWMB.UI.Edit",
            template: config.template,
            context: config.getContext(app, style),
            renderParts: ["context", "toolbar"],
            onRender: config.onRender,
            onExtract: (form) => config.onExtract(form, style.name),
            onSave: (entity, result) => {
                config.onSave?.(entity, result);
                if (config.onCascade) config.onCascade(app, id, result);

                if (app.uiState[config.activeStateKey] === id) {
                    if (config.onUpdateActiveUI) config.onUpdateActiveUI(app, result);
                }
            },
        });
    }

    static async onEditRiver(app, event, target, explicitId = null) {
        const id = explicitId || target.closest(".fwmb-list-item").dataset.id;
        const river = app.manualRivers.find((r) => r.id === id);
        if (!river) return;

        await this._processEditDialog(app, river, {
            titleKey: "FILRODENSWMB.UI.EditRiver",
            template: "modules/filrodens-world-map-builder/templates/dialogs/edit-rivers.hbs",
            context: { river },
            onExtract: (form) => ({
                name: form.elements["riverName"].value,
                width: Number(form.elements["riverWidth"].value),
            }),
            onSave: (entity, result) => {
                if (app.activeRiverId === id) {
                    app.uiState.riverWidth = result.width;
                    app.view?.render(["toolbar"]);
                }
            },
            triggersTerrain: true,
        });
    }

    /**
     * Opens the edit dialogue for a guided-mode land mask: its name, and whether it marks land
     * ("add") or an ocean hole ("subtract").
     *
     * The name is only a label, so renaming never touches the terrain. Changing the type does
     * change what the guided generator produces, so that alone requests a terrain update.
     */
    static async onEditLandMask(app, event, target, explicitId = null) {
        const id = explicitId || target.closest(".fwmb-list-item").dataset.id;

        // Finish any mask still being drawn first (discarding it if it never became a shape), as
        // that shape may be the one being opened, and its nodes must not keep growing underneath
        // the dialogue.
        if (app._finishActiveLandMask()) app.requestTerrainUpdate();

        const mask = app.landMasks.find((m) => m.id === id);
        if (!mask) return;

        const previousOperation = mask.operation === "subtract" ? "subtract" : "add";

        await this._processEditDialog(app, mask, {
            titleKey: "FILRODENSWMB.UI.EditLandMaskDetails",
            template: "modules/filrodens-world-map-builder/templates/dialogs/edit-land-masks.hbs",
            context: { mask },
            onExtract: (form, fallbackName) => ({
                name: form.elements["maskName"].value.trim() || fallbackName,
                operation: form.elements["maskOperation"].value === "subtract" ? "subtract" : "add",
            }),
            onSave: (entity, result) => {
                if (result.operation !== previousOperation) app.requestTerrainUpdate();
            },
        });
    }
}
