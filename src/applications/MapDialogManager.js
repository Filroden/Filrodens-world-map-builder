import { FILRODENSWMB } from "../config.js";
import { MapStateManager } from "./MapStateManager.js";
import { MassEdit } from "./MassEdit.js";
import { ColorMath } from "../tools/ColorMath.js";
import { BiomePlacement } from "../generation/BiomePlacement.js";
import { RuleEditorDialog } from "./RuleEditorDialog.js";
import { CanvasTransforms } from "../tools/CanvasTransforms.js";
import {
    getCustomPinIconById,
    addCustomPinIcon,
    updateCustomPinIcon,
    removeCustomPinIconEntry,
    setBuiltinPinIconDisabled,
    setAllBuiltinPinIconsDisabled,
    findPinIconUsage,
    revertPinIconUsage,
} from "../data/pinIcons.js";
import { PinStyles } from "./PinStyles.js";
import { positionPopoverMenu } from "../ui/dropdowns.js";
import { platform } from "../platform/index.js";
import { Sanitize } from "../data/Sanitize.js";
import { typed } from "../data/MapRules.js";

/** How many over-limit texts the export's refusal lists before counting the rest. */
const OVER_LIMIT_SHOWN = 20;

export class MapDialogManager {
    /**
     * Shows a standard Yes/No confirmation dialogue. The message is plain text: it often names
     * something the user typed or a file brought in (a layer, a set, a custom icon), so it is
     * escaped before it becomes the dialogue's markup, and no message carries markup of its own.
     */
    static async _confirmDialog(title, content) {
        const message = Sanitize.escapeHtml(content || platform.i18n.localize("FILRODENSWMB.UI.DeleteConfirm"));
        return platform.dialogs.confirm({
            title: title || platform.i18n.localize("FILRODENSWMB.UI.Warning"),
            content: `<p>${message}</p>`,
        });
    }

    /**
     * Says why an export was refused: the texts longer than an export allows, one per line, so
     * the user knows exactly what to shorten (see MapRules.overLimit). The list stops after
     * OVER_LIMIT_SHOWN lines, with a count of the rest. An entry naming its `map` (a backup's
     * check of every map) is listed under that map's name.
     * @param {{where?: string, item?: string, field?: string, length: number, limit: number, map?: string}[]} entries
     */
    static async showOverLimit(entries) {
        const { i18n } = platform;
        const escape = Sanitize.escapeHtml;
        const line = (entry) => (entry.map ? i18n.format("FILRODENSWMB.UI.LimitLineInMap", { map: entry.map, line: Sanitize.limitLine(entry, i18n) }) : Sanitize.limitLine(entry, i18n));
        const shown = entries.slice(0, OVER_LIMIT_SHOWN).map((entry) => `<li>${escape(line(entry))}</li>`);
        const rest = entries.length - shown.length;
        const more = rest > 0 ? `<p>${escape(i18n.format("FILRODENSWMB.UI.ImportRefusedMore", { count: rest }))}</p>` : "";
        await platform.dialogs.choose({
            classes: ["fwmb"],
            title: i18n.localize("FILRODENSWMB.UI.ExportRefusedTitle"),
            content: `<p>${escape(i18n.localize("FILRODENSWMB.UI.ExportRefusedIntro"))}</p><ul class="fwmb-limit-list">${shown.join("")}</ul>${more}`,
            buttons: [{ action: "close", label: i18n.localize("FILRODENSWMB.UI.Close"), default: true }],
        });
    }

    /**
     * Prompts for a single line of text via a minimal form. The field stops at the limit of its
     * kind of text (FILRODENSWMB.LIMITS.TEXT), and the answer is cut to it as well.
     * @param {string} title
     * @param {string} label - Plain text.
     * @param {string} defaultValue
     * @param {"name"|"description"|"label"} [kind]
     */
    static async _promptTextValue(title, label, defaultValue, kind = "name") {
        // The value is escaped because it is often an existing name (a map or layer name) that
        // may contain quotes, which would otherwise end the attribute early and cut the name short
        const safeValue = platform.utils.escapeHtml(defaultValue ?? "");
        const limit = Sanitize.textLimit(kind);
        const answer = await platform.dialogs.prompt({
            title,
            content: `<label>${Sanitize.escapeHtml(label)}</label><input type="text" id="fwmb-prompt-input" value="${safeValue}" maxlength="${limit}">`,
            onSubmit: (form) => form.elements["fwmb-prompt-input"].value,
        });
        return typeof answer === "string" ? answer.slice(0, limit) : answer;
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
            fontSize: app.uiState.labelFontSize || FILRODENSWMB.LABELS.DEFAULT_SIZE,
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

                // Only a source the studio would accept is previewed (see Sanitize.imageSource)
                const updatePreview = () => {
                    const path = Sanitize.imageSource(pathInput.value.trim(), { remote: true });
                    if (path) previewImg.src = path;
                    previewImg.hidden = !path;
                };

                pathInput.addEventListener("input", updatePreview);
                pathInput.addEventListener("change", updatePreview);
            },
            onSubmit: (form) => {
                const name = Sanitize.typedText(form.elements["iconName"].value.trim(), "name");
                const typedPath = form.elements["iconPath"].value.trim();
                const path = Sanitize.imageSource(typedPath, { remote: true });
                if (typedPath && !path) platform.notify.error(platform.i18n.localize("FILRODENSWMB.UI.ImageSourceInvalid"));
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
     * The map's styles, by type: where each type's list is kept, the bar's choice of style for the
     * next object, the fields a new style starts with, and how a style reaches the objects that
     * follow it: the cascade (a change written onto them), the disconnect (a deleted style leaves
     * them Custom, keeping their look) and the usage count. The styles are edited in the inspector
     * (StyleEditors) and listed in Styles and icons (StyleLists). Custom biomes, edited in their
     * dialogue, are the last entry.
     */
    static get QUICK_STYLE_CONFIG() {
        const labelStyleFields = (style) => ({
            fontFamily: style.fontFamily,
            fontSize: style.fontSize,
            fillColor: style.fillColor,
            maxChars: style.maxChars,
            justify: style.justify,
            bold: style.bold !== false,
            italic: style.italic === true,
        });
        // The style the bar has chosen for the next object of a kind, if any
        const barStyle = (app, registryKey, activeStateKey) => (app.uiState[registryKey] ?? []).find((style) => style.id === app.uiState[activeStateKey]) ?? null;
        return {
            Label: {
                registryKey: "customLabelStyles",
                activeStateKey: "activeLabelQuickStyle",
                // A new style starts as the next label would: the bar's style, or the bar's own fields
                getDefaults: (app) => {
                    const style = barStyle(app, "customLabelStyles", "activeLabelQuickStyle");
                    if (style) return labelStyleFields(style);
                    return {
                        fontFamily: app.uiState.labelFontFamily || FILRODENSWMB.LABELS.DEFAULT_FONT,
                        fontSize: app.uiState.labelFontSize || FILRODENSWMB.LABELS.DEFAULT_SIZE,
                        fillColor: app.uiState.labelFillColor || "#000000",
                        maxChars: app.uiState.labelMaxChars || 0,
                        justify: app.uiState.labelJustify || "left",
                        bold: app.uiState.labelBold !== false,
                        italic: app.uiState.labelItalic === true,
                    };
                },
                onCascade: (app, id, result) => {
                    const aestheticProperties = labelStyleFields(result);
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
                // Mirrors onDisconnect's traversal (standalone labels, plus the label every pin,
                // route and region carries), counting instead of resetting
                getUsageCount: (app, id) => {
                    let count = app.mapLabels.filter((lbl) => lbl.quickStyle === id).length;
                    const isAttachedMatch = (ent) => ent.label && ent.label.quickStyle === id;
                    count += app.mapPins.filter(isAttachedMatch).length;
                    count += app.mapRoutes.filter(isAttachedMatch).length;
                    for (const level of app.regionLevels) count += level.regions.filter(isAttachedMatch).length;
                    return count;
                },
            },
            Route: {
                registryKey: "customRouteStyles",
                activeStateKey: "activeRouteQuickStyle",
                // As the next route would be drawn: the bar's style or its own line, for the bar's transport
                getDefaults: (app) => {
                    const style = barStyle(app, "customRouteStyles", "activeRouteQuickStyle");
                    const state = app.uiState;
                    const line = style ? this.routeStyleFields(style) : this.routeStyleFields({ color: state.routeColor, thickness: state.routeThickness, style: state.routeStyle, outline: state.routeOutline, smoothing: state.routeSmoothing });
                    return { ...line, transport: state.routeTransport || "road" };
                },
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
            },
            Pin: {
                registryKey: "customPinStyles",
                activeStateKey: "activePinStyle",
                // As the next pin would be placed: the bar's style, or its icon, colour and scale
                getDefaults: (app) => {
                    const style = PinStyles.active(app);
                    if (style) return { icon: style.icon, scale: style.scale, color: style.color, label: structuredClone(style.label ?? { fontSize: style.scale, visibility: "all", quickStyle: PinStyles.NONE }), detailLevel: style.detailLevel ?? FILRODENSWMB.PINS.DETAIL_LEVELS.at(-1) };
                    return {
                        icon: app.uiState.activeIcon || FILRODENSWMB.PIN_ICONS.DEFAULT,
                        scale: app.uiState.pinScale ?? FILRODENSWMB.PINS.DEFAULT_SCALE,
                        color: app.uiState.pinColor || FILRODENSWMB.PINS.DEFAULT_STYLE_COLOR,
                        label: { fontSize: app.uiState.pinScale ?? FILRODENSWMB.PINS.DEFAULT_SCALE, visibility: "all", quickStyle: PinStyles.NONE },
                        detailLevel: FILRODENSWMB.PINS.DETAIL_LEVELS.at(-1),
                    };
                },
                onCascade: (app, id, result) => PinStyles.cascade(app, { ...result, id }),
                onDisconnect: (app, id) => PinStyles.disconnect(app, id),
                getUsageCount: (app, id) => PinStyles.usageCount(app, id),
            },
            // Region styles hold a region's fill only: a region's border belongs to its level
            Region: {
                registryKey: "customRegionStyles",
                activeStateKey: "activeRegionQuickStyle",
                // As the next region would be filled with the bar's style, or the default fill
                getDefaults: (app) => {
                    const style = barStyle(app, "customRegionStyles", "activeRegionQuickStyle");
                    return style ? { fillColor: style.fillColor, fillStyle: style.fillStyle ?? "solid" } : { fillColor: "#c6af53", fillStyle: "solid" };
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
                // Checked as an import is (see MapRules.typed)
                onExtract: (form, fallbackName) => ({
                    ...typed("customBiome", {
                        name: form.elements["biomeName"].value.trim() || fallbackName,
                        code: form.elements["biomeCode"].value.trim() || null,
                        color: ColorMath.hexToRgb(form.elements["biomeColor"].value),
                        placement: form.elements["biomePlacement"].value,
                    }),
                    // Superseded by `placement`, which takes priority over it anyway (see
                    // BiomePlacement.placementOfCustom); cleared so an older map's flag is not
                    // carried forward once the biome has been edited
                    solidOverWater: undefined,
                }),
            },
        };
    }

    /**
     * The choices for a custom biome's Placement select, in the order they are offered, with the
     * biome's current placement selected.
     * @param {string} selected - One of FILRODENSWMB.BIOME_PLACEMENT.
     * @returns {Array<{value: string, label: string, selected: boolean}>}
     */
    static #biomePlacementChoices(selected) {
        return Object.values(FILRODENSWMB.BIOME_PLACEMENT).map((value) => ({ value, label: BiomePlacement.labelOf(value), selected: value === selected }));
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
                name: Sanitize.typedText(form.elements["fwmb-dec-name"].value.trim() || defaultName, "name"),
                src: form.elements["fwmb-dec-src"].value.trim(),
            }),
        });

        if (!result) return;
        // A path into the host's data, an image picked on the web (already checked as it was read),
        // or a typed address; anything else is refused before it reaches the canvas
        if (result.src && !Sanitize.imageSource(result.src, { remote: true })) {
            platform.notify.error(platform.i18n.localize("FILRODENSWMB.UI.ImageSourceInvalid"));
            return;
        }

        if (result?.src) {
            MapStateManager.pushVectorState(app);

            const spawnX = app.mapWidth / 2;
            const spawnY = app.mapHeight / 2;

            app.mapDecorations.push({
                id: platform.utils.randomID(),
                type: "decoration",
                name: result.name || platform.i18n.localize("FILRODENSWMB.UI.UnnamedDecoration"),
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

    /** The lists Mass Edit can delete from, with the noun its confirmation counts. */
    static #MASS_DELETE = Object.freeze({
        pin: "FILRODENSWMB.UI.MassDeletePins",
        route: "FILRODENSWMB.UI.MassDeleteRoutes",
        label: "FILRODENSWMB.UI.MassDeleteLabels",
    });

    /**
     * Mass Edit's Delete: every pin, route or standalone label chosen in its list, after a
     * confirmation giving how many, as one undo step. The choice is cleared afterwards.
     * @param {object} app
     * @param {string} type - "pin", "route" or "label".
     * @returns {Promise<boolean>} Whether anything was deleted.
     */
    static async massDelete(app, type) {
        const config = FILRODENSWMB.ENTITY_CONFIG[type];
        const selection = app.massEditSelection?.[type];
        if (!config || !this.#MASS_DELETE[type] || !selection?.size) return false;
        const count = selection.size.toLocaleString(platform.i18n.lang);
        const confirmed = await this._confirmDialog(platform.i18n.localize("FILRODENSWMB.UI.MassDeleteTitle"), platform.i18n.format(this.#MASS_DELETE[type], { count }));
        if (!confirmed) return false;

        MapStateManager.pushVectorState(app);
        app[config.stateKey] = app[config.stateKey].filter((item) => !selection.has(item.id));
        if (config.activeKey && selection.has(app[config.activeKey])) app[config.activeKey] = null;
        if (type === "route") for (const id of selection) app.meshSession?.forgetRoute(id);
        selection.clear();

        app._repaintVectors();
        app.view?.render(["context"]);
        app.markDirty();
        return true;
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
        await this.deleteLandMaskById(app, target.closest(".fwmb-list-item").dataset.id);
    }

    /**
     * Deletes one land mask after the standard confirmation, as one undo step, and shapes the land
     * again: from its list's delete button or the inspector.
     * @returns {Promise<boolean>} Whether it was deleted.
     */
    static async deleteLandMaskById(app, id) {
        if (!app.landMasks.some((mask) => mask.id === id)) return false;
        const confirmed = await this._confirmDialog();
        if (!confirmed) return false;

        MapStateManager.pushVectorState(app);
        app.landMasks = app.landMasks.filter((mask) => mask.id !== id);
        if (app.activeLandMaskId === id) app.activeLandMaskId = null;

        app._repaintVectors();
        app.requestTerrainUpdate();
        app.view?.render(["context"]);
        app.markDirty();
        return true;
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

    // --- MASS EDIT ---

    /** Mass edit of the chosen items of a kind (see MassEdit). */
    static onMassEdit(app, _event, target) {
        return MassEdit.open(app, target.dataset.type);
    }

    // --- EDIT ACTIONS ---

    static async onEditCustomPinIcon(app, event, target) {
        const id = target.closest(".fwmb-list-item").dataset.id;
        const icon = getCustomPinIconById(id);
        if (!icon) return;

        const result = await this._promptPinIconDialog(icon, "FILRODENSWMB.UI.Edit");
        if (!result) return;

        await updateCustomPinIcon(id, result);
        app.view?.render(["context"]);
    }
}
