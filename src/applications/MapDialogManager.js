import { FILRODENSWMB } from "../config.js";
import { MapStateManager } from "./MapStateManager.js";
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

export class MapDialogManager {
    /**
     * Shows a standard Yes/No confirmation dialog.
     */
    static async _confirmDialog(title, content) {
        return foundry.applications.api.DialogV2.confirm({
            window: { title: title || game.i18n.localize("FILRODENSWMB.UI.Warning") },
            content: `<p>${content || game.i18n.localize("FILRODENSWMB.UI.DeleteConfirm")}</p>`,
            rejectClose: false,
            modal: true,
        });
    }

    /**
     * Prompts for a single line of text via a minimal DialogV2 form.
     */
    static async _promptTextValue(title, label, defaultValue) {
        return foundry.applications.api.DialogV2.prompt({
            window: { title: title },
            content: `<label>${label}</label><input type="text" id="fwmb-prompt-input" value="${defaultValue}">`,
            ok: { callback: (event, button) => button.form.elements["fwmb-prompt-input"].value },
        });
    }

    /**
     * Prompts the user with a 3-way choice for unsaved changes (Save, Discard, Cancel).
     * Returns the chosen action as a string.
     */
    static async promptUnsavedChanges() {
        return foundry.applications.api.DialogV2.wait({
            window: { title: game.i18n.localize("FILRODENSWMB.UI.Warning") },
            content: `<p>${game.i18n.localize("FILRODENSWMB.UI.UnsavedChangesWarning")}</p>`,
            buttons: [
                { action: "save", label: game.i18n.localize("FILRODENSWMB.UI.Save"), icon: "fwmb-icon save", default: true },
                { action: "discard", label: game.i18n.localize("FILRODENSWMB.UI.Discard"), icon: "fwmb-icon delete" },
                { action: "cancel", label: game.i18n.localize("FILRODENSWMB.UI.Cancel"), icon: "fwmb-icon cancel" },
            ],
            close: () => "cancel",
        });
    }

    /**
     * Builds a safe copy of an entity inheriting the current global label defaults.
     */
    static _withLabelDefaults(app, entity) {
        const safe = { ...entity };

        const defaults = {
            quickStyle: "custom",
            fontFamily: app.uiState.labelFontFamily || "Signika",
            fontSize: app.uiState.labelFontSize || 1,
            fillColor: app.uiState.labelFillColor || "#ffffff",
            maxWidth: app.uiState.labelMaxWidth || 0,
            justify: app.uiState.labelJustify || "left",
        };

        safe.label = { ...defaults, ...(safe.label || {}) };

        return safe;
    }

    /**
     * Extracts shared "label properties" form fields from a submitted dialog.
     */
    static _extractLabelResultFields(form) {
        return {
            quickStyle: form.elements["labelQuickStyle"].value,
            fontFamily: form.elements["labelFontFamily"].value,
            fontSize: Number(form.elements["labelFontSize"].value) || 1,
            fillColor: form.elements["labelFillColor"].value,
            maxWidth: Number(form.elements["labelMaxWidth"].value) || 0,
            justify: form.elements["labelJustify"].value,
        };
    }

    /**
     * Helper to bind shared label property inputs across different dialogs.
     */
    static bindLabelPropertiesDialog(html, uiState) {
        const labelQuickStyleSelect = html.querySelector('select[name="labelQuickStyle"]');
        const labelFontFamilySelect = html.querySelector('select[name="labelFontFamily"]');
        const labelFontSizeInput = html.querySelector('input[name="labelFontSize"]');
        const labelFontSizeOutput = html.querySelector('input[name="labelFontSize"] + output');
        const labelColorInput = html.querySelector('input[name="labelFillColor"]');
        const labelMaxWidthInput = html.querySelector('input[name="labelMaxWidth"]');
        const labelJustifySelect = html.querySelector('select[name="labelJustify"]');

        labelQuickStyleSelect?.addEventListener("change", (e) => {
            const styleId = e.target.value;
            if (styleId === "custom") return;

            const styleData = uiState.customLabelStyles.find((s) => s.id === styleId);
            if (!styleData) return;

            if (labelFontFamilySelect) labelFontFamilySelect.value = styleData.fontFamily;
            if (labelColorInput) labelColorInput.value = styleData.fillColor;
            if (labelMaxWidthInput) labelMaxWidthInput.value = styleData.maxWidth;
            if (labelJustifySelect) labelJustifySelect.value = styleData.justify;

            if (labelFontSizeInput) {
                labelFontSizeInput.value = styleData.fontSize;
                if (labelFontSizeOutput) labelFontSizeOutput.value = styleData.fontSize;
            }
        });

        const revertLabelToCustom = () => {
            if (labelQuickStyleSelect) labelQuickStyleSelect.value = "custom";
        };

        labelFontSizeInput?.addEventListener("input", (e) => {
            if (labelFontSizeOutput) labelFontSizeOutput.value = e.target.value;
            revertLabelToCustom();
        });

        labelFontFamilySelect?.addEventListener("change", revertLabelToCustom);
        labelColorInput?.addEventListener("input", revertLabelToCustom);
        labelMaxWidthInput?.addEventListener("input", revertLabelToCustom);
        labelJustifySelect?.addEventListener("change", revertLabelToCustom);
    }

    /**
     * Sets an `.fwmb-icon` glyph element to render a given pin icon key correctly, whether
     * it's a built-in (a compiled `.fwmb-icon.<key>` CSS class already exists for it) or a
     * custom icon (no compiled class exists for runtime-registered data, so its mask is set
     * inline instead, straight from its resolved path).
     */
    static _applyIconGlyph(element, key, path, isCustom) {
        if (!element) return;

        if (isCustom) {
            element.className = "fwmb-icon";
            element.style.setProperty("--fwmb-mask", `url('${path}')`);
        } else {
            element.className = `fwmb-icon ${key}`;
            element.style.removeProperty("--fwmb-mask");
        }
    }

    /**
     * Shared Add/Edit dialog for a single custom pin icon: name, a native file-picker path,
     * and a live preview of the raw SVG against a black background so the GM can confirm
     * it's genuinely solid white before accepting (see the "why custom icons must be solid
     * white" design note - this is a self-check, not an automated one).
     */
    static async _promptPinIconDialog(icon, titleKey) {
        const content = await foundry.applications.handlebars.renderTemplate("modules/filrodens-world-map-builder/templates/dialogs/edit-pin-icon.hbs", { icon });

        return foundry.applications.api.DialogV2.prompt({
            classes: ["fwmb"],
            window: { title: game.i18n.localize(titleKey) },
            content,
            render: (event) => {
                const html = event.target.element;
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
            ok: {
                callback: (evt, button) => {
                    const name = button.form.elements["iconName"].value.trim();
                    const path = button.form.elements["iconPath"].value.trim();
                    return name && path ? { name, path } : null;
                },
            },
        });
    }

    /**
     * Unified pipeline for editing vector entities to remove boilerplate.
     */
    static async _processEditDialog(app, entity, options = {}) {
        const { titleKey, template, htmlContent, context = {}, onRender, onExtract, onSave, triggersTerrain = false, renderParts = ["context"] } = options;

        const content = template ? await foundry.applications.handlebars.renderTemplate(template, context) : htmlContent;

        const result = await foundry.applications.api.DialogV2.prompt({
            classes: ["fwmb"],
            window: { title: game.i18n.localize(titleKey) || titleKey },
            content: content,
            render: (event) => {
                if (onRender) onRender(event.target, event.target.element);
            },
            ok: {
                callback: (event, button) => (onExtract ? onExtract(button.form, entity.name) : null),
            },
        });

        if (result) {
            MapStateManager.pushVectorState(app);

            foundry.utils.mergeObject(entity, result);
            if (onSave) onSave(entity, result);

            app._repaintVectors();
            if (triggersTerrain) app.requestTerrainUpdate();
            app.render({ parts: renderParts });
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
                    fontFamily: app.uiState.labelFontFamily || "Signika",
                    fontSize: app.uiState.labelFontSize || 1,
                    fillColor: app.uiState.labelFillColor || "#000000",
                    maxWidth: app.uiState.labelMaxWidth || 0,
                    justify: app.uiState.labelJustify || "left",
                }),
                getContext: (app, style) => ({
                    style,
                    fonts: CONFIG.fontFamilies || ["Signika", "Modesto Condensed", "Arial"],
                    palette: FILRODENSWMB.LABELS?.PRESETS || [],
                }),
                onRender: (dialogApp, html) => {
                    const range = html.querySelector('input[name="styleFontSize"]');
                    const output = html.querySelector("output");
                    if (range && output) range.addEventListener("input", (e) => (output.value = e.target.value));
                },
                onExtract: (form, fallbackName) => ({
                    name: form.elements["styleName"].value.trim() || fallbackName,
                    fontFamily: form.elements["styleFontFamily"].value,
                    fontSize: Number(form.elements["styleFontSize"].value) || 1,
                    fillColor: form.elements["styleFillColor"].value,
                    maxWidth: Number(form.elements["styleMaxWidth"].value) || 0,
                    justify: form.elements["styleJustify"].value,
                }),
                onCascade: (app, id, result) => {
                    const aestheticProperties = {
                        fontFamily: result.fontFamily,
                        fontSize: result.fontSize,
                        fillColor: result.fillColor,
                        maxWidth: result.maxWidth,
                        justify: result.justify,
                    };

                    for (const lbl of app.mapLabels) {
                        if (lbl.quickStyle === id) foundry.utils.mergeObject(lbl, aestheticProperties);
                    }
                    const updateAttached = (ent) => {
                        if (ent.label && ent.label.quickStyle === id) foundry.utils.mergeObject(ent.label, aestheticProperties);
                    };
                    app.mapPins.forEach(updateAttached);
                    app.mapRoutes.forEach(updateAttached);
                    app.regionLayers.forEach((layer) => layer.regions.forEach(updateAttached));
                },
                onDisconnect: (app, id) => {
                    for (const lbl of app.mapLabels) if (lbl.quickStyle === id) lbl.quickStyle = "custom";
                    const disconnectAttached = (ent) => {
                        if (ent.label && ent.label.quickStyle === id) ent.label.quickStyle = "custom";
                    };
                    app.mapPins.forEach(disconnectAttached);
                    app.mapRoutes.forEach(disconnectAttached);
                    app.regionLayers.forEach((layer) => layer.regions.forEach(disconnectAttached));
                },
                onUpdateActiveUI: (app, result) => {
                    app.uiState.labelFontFamily = result.fontFamily;
                    app.uiState.labelFontSize = result.fontSize;
                    app.uiState.labelFillColor = result.fillColor;
                    app.uiState.labelMaxWidth = result.maxWidth;
                    app.uiState.labelJustify = result.justify;
                },
            },
            Route: {
                registryKey: "customRouteStyles",
                activeStateKey: "activeRouteQuickStyle",
                template: "modules/filrodens-world-map-builder/templates/dialogs/edit-route-quick-style.hbs",
                getDefaults: () => ({
                    name: "New Quick Style",
                    color: "#ffffff",
                    thickness: 3,
                    style: "solid",
                }),
                getContext: (app, style) => ({
                    style,
                    palette: FILRODENSWMB.LABELS?.PRESETS || [],
                }),
                onExtract: (form, fallbackName) => ({
                    name: form.elements["styleName"].value.trim() || fallbackName,
                    color: form.elements["styleColor"].value,
                    thickness: Number(form.elements["styleThickness"].value) || 3,
                    style: form.elements["styleStyle"].value,
                }),
                onCascade: (app, id, result) => {
                    const aestheticProperties = {
                        color: result.color,
                        thickness: result.thickness,
                        style: result.style,
                    };

                    for (const route of app.mapRoutes) {
                        if (route.quickStyle === id) foundry.utils.mergeObject(route, aestheticProperties);
                    }
                },
                onDisconnect: (app, id) => {
                    for (const route of app.mapRoutes) if (route.quickStyle === id) route.quickStyle = "custom";
                },
                onUpdateActiveUI: (app, result) => {
                    app.uiState.routeColor = result.color;
                    app.uiState.routeThickness = result.thickness;
                    app.uiState.routeStyle = result.style;
                },
            },
            Region: {
                registryKey: "customRegionStyles",
                activeStateKey: "activeRegionQuickStyle",
                template: "modules/filrodens-world-map-builder/templates/dialogs/edit-region-quick-style.hbs",
                getDefaults: () => ({
                    name: "New Region Style",
                    fillColor: "#c6af53",
                    fillStyle: "solid",
                    lineColor: "#ffffff",
                    lineThickness: 2,
                    lineStyle: "solid",
                    smoothing: true,
                }),
                getContext: (app, style) => ({
                    style,
                    palette: FILRODENSWMB.LABELS?.PRESETS || [],
                }),
                onExtract: (form, fallbackName) => ({
                    name: form.elements["styleName"].value.trim() || fallbackName,
                    fillColor: form.elements["styleFillTransparent"].checked ? "transparent" : form.elements["styleFillColor"].value,
                    fillStyle: form.elements["styleFillStyle"].value,
                    lineColor: form.elements["styleLineColor"].value,
                    lineThickness: Number(form.elements["styleLineThickness"].value) || 2,
                    lineStyle: form.elements["styleLineStyle"].value,
                    smoothing: form.elements["styleSmoothing"].value === "true",
                }),
                onCascade: (app, id, result) => {
                    const aestheticProperties = {
                        fillColor: result.fillColor,
                        fillStyle: result.fillStyle,
                        lineColor: result.lineColor,
                        lineThickness: result.lineThickness,
                        lineStyle: result.lineStyle,
                        smoothing: result.smoothing,
                    };

                    app.regionLayers.forEach((layer) => {
                        layer.regions.forEach((region) => {
                            if (region.quickStyle === id) foundry.utils.mergeObject(region, aestheticProperties);
                        });
                    });
                },
                onDisconnect: (app, id) => {
                    app.regionLayers.forEach((layer) => {
                        layer.regions.forEach((region) => {
                            if (region.quickStyle === id) region.quickStyle = "custom";
                        });
                    });
                },
                onUpdateActiveUI: (app, result) => {
                    app.uiState.regionFillColor = result.fillColor;
                    app.uiState.regionFillStyle = result.fillStyle;
                    app.uiState.regionLineColor = result.lineColor;
                    app.uiState.regionLineThickness = result.lineThickness;
                    app.uiState.regionLineStyle = result.lineStyle;
                    app.uiState.regionSmoothing = result.smoothing;
                },
            },
        };
    }

    /**
     * Unified configuration for Mass Edit: applying visual properties to every entity
     * currently selected via a type's Select checkboxes, in one batch. Mirrors the shape of
     * QUICK_STYLE_CONFIG above so the two systems stay easy to read side-by-side, but each
     * entry describes an opt-in FIELD LIST instead of a single style object - only fields the
     * GM ticks in the Mass Edit dialog are applied, everything else is left untouched on every
     * selected entity (a deliberate design choice: mass edit never overwrites a property the
     * GM didn't explicitly opt into). The "quickStyle" field, where present, is a bundle:
     * ticking it applies both the chosen style's id and its resolved aesthetic properties
     * together, exactly as picking a Quick Style does in the single-item edit dialogs. Any
     * other checked field is extracted and merged in afterwards (see _extractMassEditPatch),
     * so an explicit per-field value always wins over whatever the quick style would have set.
     */
    static get MASS_EDIT_CONFIG() {
        // Small helper factory: given a customXStyles registry key, returns a lookup function
        // for "find the style with this id", shared by every type's quickStyle field below.
        const resolveStyle = (registryKey) => (app, id) => (app.uiState[registryKey] || []).find((s) => s.id === id);

        // Pins, Routes, and Regions each carry an attached label (the same `label{...}`
        // sub-object their single-item edit dialogs expose as a second "Label Properties"
        // fieldset) - Mass Edit should be able to batch those fields too, not just the
        // entity's own visual properties. Shared here since the field list and its dialog
        // context are identical for all three owning types; only the entity type they get
        // attached to differs. Every extract() returns a nested `{ label: {...} }` object,
        // the same shape `_extractLabelResultFields` already produces for the single-item
        // dialogs, so `foundry.utils.mergeObject(entity, patch)` merges it straight into
        // `entity.label` with no special-casing needed in onMassEdit. _extractMassEditPatch
        // accumulates ticked fields with mergeObject too (not a shallow Object.assign), so
        // two different label fields ticked together both land under the same `label` key
        // instead of one overwriting the other.
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
                                  maxWidth: style.maxWidth,
                                  justify: style.justify,
                              },
                          }
                        : { label: { quickStyle: "custom" } };
                },
            },
            { checkboxName: "applyLabelFontFamily", extract: (form) => ({ label: { fontFamily: form.elements["labelFontFamily"].value } }) },
            { checkboxName: "applyLabelFontSize", extract: (form) => ({ label: { fontSize: Number(form.elements["labelFontSize"].value) || 1 } }) },
            { checkboxName: "applyLabelFillColor", extract: (form) => ({ label: { fillColor: form.elements["labelFillColor"].value } }) },
            { checkboxName: "applyLabelMaxWidth", extract: (form) => ({ label: { maxWidth: Number(form.elements["labelMaxWidth"].value) || 0 } }) },
            { checkboxName: "applyLabelJustify", extract: (form) => ({ label: { justify: form.elements["labelJustify"].value } }) },
        ];

        // The dialog context (fonts, the Label Quick Style registry, and starting field
        // values) needed to render that shared fieldset - merged into each owning type's own
        // getContext() result below.
        const getLabelContext = (app) => ({
            fonts: CONFIG.fontFamilies || ["Signika", "Modesto Condensed", "Arial"],
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
                        palette: FILRODENSWMB.LABELS?.PRESETS || [],
                        ...getLabelContext(app),
                    };
                },
                onRender: (html, app) => {
                    const trigger = html.querySelector("#fwmb-mass-edit-pin-select .fwmb-select-trigger");
                    const optionsMenu = html.querySelector("#fwmb-mass-edit-pin-select .fwmb-select-options");
                    const hiddenInput = html.querySelector("#fwmb-mass-edit-pin-icon-input");
                    const triggerIcon = html.querySelector("#fwmb-mass-edit-pin-trigger-icon");

                    if (trigger && optionsMenu) {
                        trigger.addEventListener("click", () => optionsMenu.classList.toggle("fwmb-hidden"));
                        optionsMenu.querySelectorAll("button").forEach((btn) => {
                            btn.addEventListener("click", () => {
                                hiddenInput.value = btn.dataset.icon;
                                this._applyIconGlyph(triggerIcon, btn.dataset.icon, btn.dataset.path, btn.dataset.custom === "true");
                                optionsMenu.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
                                btn.classList.add("active");
                                optionsMenu.classList.add("fwmb-hidden");
                            });
                        });
                    }
                    this.bindLabelPropertiesDialog(html, app.uiState);
                },
                fields: [
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
                    ...getLabelContext(app),
                }),
                onRender: (html, app) => {
                    const quickStyleSelect = html.querySelector('select[name="massQuickStyle"]');
                    const colorInput = html.querySelector('input[name="massColor"]');
                    const thicknessInput = html.querySelector('input[name="massThickness"]');
                    const styleSelect = html.querySelector('select[name="massStyle"]');

                    quickStyleSelect?.addEventListener("change", (e) => {
                        const style = resolveStyle("customRouteStyles")(app, e.target.value);
                        if (!style) return;
                        if (colorInput) colorInput.value = style.color;
                        if (thicknessInput) thicknessInput.value = style.thickness;
                        if (styleSelect) styleSelect.value = style.style;
                    });
                    this.bindLabelPropertiesDialog(html, app.uiState);
                },
                fields: [
                    {
                        checkboxName: "applyQuickStyle",
                        extract: (form, app) => {
                            const id = form.elements["massQuickStyle"].value;
                            const style = id !== "custom" ? resolveStyle("customRouteStyles")(app, id) : null;
                            return style ? { quickStyle: id, color: style.color, thickness: style.thickness, style: style.style } : { quickStyle: "custom" };
                        },
                    },
                    { checkboxName: "applyColor", extract: (form) => ({ color: form.elements["massColor"].value }) },
                    { checkboxName: "applyThickness", extract: (form) => ({ thickness: Number(form.elements["massThickness"].value) || 3 }) },
                    { checkboxName: "applyStyle", extract: (form) => ({ style: form.elements["massStyle"].value }) },
                    ...labelFields(),
                ],
            },
            region: {
                titleKey: "FILRODENSWMB.UI.MassEditRegionsTitle",
                template: "modules/filrodens-world-map-builder/templates/dialogs/mass-edit-regions.hbs",
                getEntities: (app, ids) => app.regionLayers.flatMap((layer) => layer.regions).filter((r) => ids.has(r.id)),
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
                    const lineColorInput = html.querySelector('input[name="massLineColor"]');
                    const lineThicknessInput = html.querySelector('input[name="massLineThickness"]');
                    const lineStyleSelect = html.querySelector('select[name="massLineStyle"]');
                    const smoothingSelect = html.querySelector('select[name="massSmoothing"]');

                    quickStyleSelect?.addEventListener("change", (e) => {
                        const style = resolveStyle("customRegionStyles")(app, e.target.value);
                        if (!style) return;
                        const isTransparent = style.fillColor === "transparent";
                        if (fillTransparentCheckbox) fillTransparentCheckbox.checked = isTransparent;
                        if (fillColorInput) fillColorInput.value = isTransparent ? "#000000" : style.fillColor;
                        if (fillStyleSelect) fillStyleSelect.value = style.fillStyle;
                        if (lineColorInput) lineColorInput.value = style.lineColor;
                        if (lineThicknessInput) lineThicknessInput.value = style.lineThickness;
                        if (lineStyleSelect) lineStyleSelect.value = style.lineStyle;
                        if (smoothingSelect) smoothingSelect.value = String(style.smoothing);
                    });
                    this.bindLabelPropertiesDialog(html, app.uiState);
                },
                fields: [
                    {
                        checkboxName: "applyQuickStyle",
                        extract: (form, app) => {
                            const id = form.elements["massQuickStyle"].value;
                            const style = id !== "custom" ? resolveStyle("customRegionStyles")(app, id) : null;
                            return style
                                ? {
                                      quickStyle: id,
                                      fillColor: style.fillColor,
                                      fillStyle: style.fillStyle,
                                      lineColor: style.lineColor,
                                      lineThickness: style.lineThickness,
                                      lineStyle: style.lineStyle,
                                      smoothing: style.smoothing,
                                  }
                                : { quickStyle: "custom" };
                        },
                    },
                    {
                        checkboxName: "applyFillColor",
                        extract: (form) => ({ fillColor: form.elements["massFillTransparent"].checked ? "transparent" : form.elements["massFillColor"].value }),
                    },
                    { checkboxName: "applyFillStyle", extract: (form) => ({ fillStyle: form.elements["massFillStyle"].value }) },
                    { checkboxName: "applyLineColor", extract: (form) => ({ lineColor: form.elements["massLineColor"].value }) },
                    { checkboxName: "applyLineThickness", extract: (form) => ({ lineThickness: Number(form.elements["massLineThickness"].value) || 2 }) },
                    { checkboxName: "applyLineStyle", extract: (form) => ({ lineStyle: form.elements["massLineStyle"].value }) },
                    { checkboxName: "applySmoothing", extract: (form) => ({ smoothing: form.elements["massSmoothing"].value === "true" }) },
                    ...labelFields(),
                ],
            },
            label: {
                titleKey: "FILRODENSWMB.UI.MassEditLabelsTitle",
                template: "modules/filrodens-world-map-builder/templates/dialogs/mass-edit-labels.hbs",
                getEntities: (app, ids) => app.mapLabels.filter((l) => ids.has(l.id)),
                getContext: (app) => ({
                    customLabelStyles: app.uiState.customLabelStyles || [],
                    fonts: CONFIG.fontFamilies || ["Signika", "Modesto Condensed", "Arial"],
                    palette: FILRODENSWMB.LABELS?.PRESETS || [],
                    defaults: this.QUICK_STYLE_CONFIG.Label.getDefaults(app),
                }),
                onRender: (html, app) => {
                    const quickStyleSelect = html.querySelector('select[name="massQuickStyle"]');
                    const fontFamilySelect = html.querySelector('select[name="massFontFamily"]');
                    const fontSizeInput = html.querySelector('input[name="massFontSize"]');
                    const fontSizeOutput = html.querySelector('input[name="massFontSize"] + output');
                    const colorInput = html.querySelector('input[name="massFillColor"]');
                    const maxWidthInput = html.querySelector('input[name="massMaxWidth"]');
                    const justifySelect = html.querySelector('select[name="massJustify"]');

                    quickStyleSelect?.addEventListener("change", (e) => {
                        const style = resolveStyle("customLabelStyles")(app, e.target.value);
                        if (!style) return;
                        if (fontFamilySelect) fontFamilySelect.value = style.fontFamily;
                        if (colorInput) colorInput.value = style.fillColor;
                        if (maxWidthInput) maxWidthInput.value = style.maxWidth;
                        if (justifySelect) justifySelect.value = style.justify;
                        if (fontSizeInput) {
                            fontSizeInput.value = style.fontSize;
                            if (fontSizeOutput) fontSizeOutput.value = style.fontSize;
                        }
                    });

                    fontSizeInput?.addEventListener("input", (e) => {
                        if (fontSizeOutput) fontSizeOutput.value = e.target.value;
                    });
                },
                fields: [
                    {
                        checkboxName: "applyQuickStyle",
                        extract: (form, app) => {
                            const id = form.elements["massQuickStyle"].value;
                            const style = id !== "custom" ? resolveStyle("customLabelStyles")(app, id) : null;
                            return style
                                ? { quickStyle: id, fontFamily: style.fontFamily, fontSize: style.fontSize, fillColor: style.fillColor, maxWidth: style.maxWidth, justify: style.justify }
                                : { quickStyle: "custom" };
                        },
                    },
                    { checkboxName: "applyFontFamily", extract: (form) => ({ fontFamily: form.elements["massFontFamily"].value }) },
                    { checkboxName: "applyFontSize", extract: (form) => ({ fontSize: Number(form.elements["massFontSize"].value) || 1 }) },
                    { checkboxName: "applyFillColor", extract: (form) => ({ fillColor: form.elements["massFillColor"].value }) },
                    { checkboxName: "applyMaxWidth", extract: (form) => ({ maxWidth: Number(form.elements["massMaxWidth"].value) || 0 }) },
                    { checkboxName: "applyJustify", extract: (form) => ({ justify: form.elements["massJustify"].value }) },
                ],
            },
        };
    }

    // --- ADD ACTIONS ---

    static async onAddCustomBiome(app, event, target) {
        const defaultName = `Custom Biome ${app.uiState.customBiomes.length + 1}`;
        const name = await this._promptTextValue(game.i18n.localize("FILRODENSWMB.UI.AddCustomBiome"), game.i18n.localize("FILRODENSWMB.UI.Name"), defaultName);
        if (!name) return;

        const currentIds = app.uiState.customBiomes.map((c) => c.id);
        const nextId = currentIds.length > 0 ? Math.max(...currentIds) + 1 : FILRODENSWMB.LIMITS.CUSTOM_BIOME_START_ID;

        app.uiState.customBiomes.push({
            id: nextId,
            name: name,
            color: [128, 128, 128],
        });

        app.render({ parts: ["context"] });
        app.markDirty();
    }

    static async onAddCustomPinIcon(app, event, target) {
        const result = await this._promptPinIconDialog({ name: "", path: "" }, "FILRODENSWMB.UI.AddCustomPinIcon");
        if (!result) return;

        await addCustomPinIcon(result);
        app.render({ parts: ["context"] });
    }

    static async onToggleBuiltinPinIcon(app, event, target) {
        const key = target.dataset.key;
        if (!key) return;

        await setBuiltinPinIconDisabled(key, target.checked);
        app.render({ parts: ["context"] });
    }

    static async onHideAllBuiltinPinIcons(app, event, target) {
        await setAllBuiltinPinIconsDisabled(true);
        app.render({ parts: ["context"] });
    }

    static async onRevealAllBuiltinPinIcons(app, event, target) {
        await setAllBuiltinPinIconsDisabled(false);
        app.render({ parts: ["context"] });
    }

    static async onAddDecoration(app, event, target) {
        if (!app.canvasEngine?.isEditMode) return;

        const defaultName = `Decoration ${app.mapDecorations.length + 1}`;

        const content = await foundry.applications.handlebars.renderTemplate("modules/filrodens-world-map-builder/templates/dialogs/add-decoration.hbs", { defaultName });

        const result = await foundry.applications.api.DialogV2.prompt({
            classes: ["fwmb"],
            window: { title: game.i18n.localize("FILRODENSWMB.UI.AddDecoration") },
            content: content,
            ok: {
                callback: (evt, button) => {
                    return {
                        name: button.form.elements["fwmb-dec-name"].value.trim() || defaultName,
                        src: button.form.elements["fwmb-dec-src"].value,
                    };
                },
            },
        });

        if (!result) return;

        if (result?.src) {
            MapStateManager.pushVectorState(app);

            const spawnX = app.mapWidth / 2;
            const spawnY = app.mapHeight / 2;

            app.mapDecorations.push({
                id: foundry.utils.randomID(),
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
            app.render({ parts: ["context"] });
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
                const id = foundry.utils.randomID();
                app.uiState[config.registryKey].push({ id, ...result });
            },
        });
    }

    static onAddRegionLayer(app, event, target) {
        const id = foundry.utils.randomID();
        app.regionLayers.push({ id: id, name: `Region Layer ${app.regionLayers.length + 1}`, visibility: "all", regions: [] });
        app.activeRegionLayerId = id;
        app.render({ parts: ["context"] });
    }

    // --- DELETE ACTIONS ---

    static async onDeleteCustomBiome(app, event, target) {
        const id = Number(target.dataset.id);

        const confirmed = await this._confirmDialog(undefined, game.i18n.localize("FILRODENSWMB.UI.DeleteBiome"));
        if (!confirmed) return;

        MapStateManager.pushVectorState(app);
        app.uiState.customBiomes = app.uiState.customBiomes.filter((c) => c.id !== id);

        if (Number(app.uiState.brushBiome) === id) {
            app.uiState.brushBiome = FILRODENSWMB.BIOME_IDS.GRASSLAND;
            app.render({ parts: ["toolbar"] });
        }

        if (app.currentBiomeOverrides) {
            const len = app.currentBiomeOverrides.length;
            for (let i = 0; i < len; i++) {
                if (app.currentBiomeOverrides[i] === id) app.currentBiomeOverrides[i] = 0;
            }
        }

        if (app.brushEngine) {
            const scrubHistory = (stroke) => {
                if (stroke.layer !== "biome" || stroke.paintValue !== id) return;
                stroke.paintValue = 0;
            };
            app.brushEngine.history.forEach(scrubHistory);
            app.brushEngine.redoStack.forEach(scrubHistory);
        }

        app._repaintCanvas();
        app.render({ parts: ["toolbar", "context"] });
    }

    static async onRemoveCustomPinIcon(app, event, target) {
        const id = target.closest(".fwmb-list-item").dataset.id;
        const icon = getCustomPinIconById(id);
        if (!icon) return;

        const usage = await findPinIconUsage(id, app.mapPins);

        const content =
            usage.totalCount > 0
                ? game.i18n.format("FILRODENSWMB.UI.RemovePinIconInUseWarning", { name: icon.name, count: usage.totalCount })
                : game.i18n.format("FILRODENSWMB.UI.RemovePinIconConfirm", { name: icon.name });

        const confirmed = await this._confirmDialog(game.i18n.localize("FILRODENSWMB.UI.RemovePinIcon"), content);
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

        app.render({ parts: ["context"] });
    }

    static async onDeleteEntity(app, event, target) {
        // Strip 'delete' from the action (e.g. 'deleteRiver' -> 'river')
        const action = target.dataset.action.replace("delete", "");
        const entityType = action.charAt(0).toLowerCase() + action.slice(1);

        // Look up the unified config
        const config = FILRODENSWMB.ENTITY_CONFIG[entityType];
        if (!config) return;

        const id = config.isLayer ? target.closest(".fwmb-accordion-group").dataset.layerId : target.closest(".fwmb-list-item").dataset.id;

        const confirmed = await this._confirmDialog();
        if (!confirmed) return;

        MapStateManager.pushVectorState(app);

        app[config.stateKey] = app[config.stateKey].filter((item) => item.id !== id);

        if (config.activeKey && app[config.activeKey] === id) {
            app[config.activeKey] = null;
        }

        app._repaintVectors();
        if (config.triggersTerrain) app.debouncedGenerateTerrain();

        app.render({ parts: ["context"] });
        app.markDirty();
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
        app.render({ parts: ["context"] });
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
            app.render({ parts: ["toolbar", "context"] });
        }

        app.markDirty();
        app.render({ parts: ["context", "toolbar"] });
    }

    static async onDeleteRegion(app, event, target) {
        const layerId = target.closest(".fwmb-accordion-group").dataset.layerId;
        const regionId = target.closest(".fwmb-list-item").dataset.id;

        const layer = app.regionLayers.find((l) => l.id === layerId);
        if (!layer) return;

        const confirmed = await this._confirmDialog();
        if (!confirmed) return;

        MapStateManager.pushVectorState(app);

        layer.regions = layer.regions.filter((r) => r.id !== regionId);
        if (app.activeRegionId === regionId) app.activeRegionId = null;

        app._repaintVectors();
        app.render({ parts: ["context"] });
        app.markDirty();
    }

    // --- MASS EDIT ---

    /**
     * Wires up the opt-in checkboxes in a Mass Edit dialog. Every field row is a `.form-group`
     * containing one gate checkbox (name starting "apply...") plus the field(s) it controls;
     * this leaves every other control in that row disabled until its checkbox is ticked, which
     * both prevents an accidental submit of a field the GM never meant to touch and gives free
     * "this field is inactive" styling from the existing global `:disabled` rules. The custom
     * pin-icon picker in the Pins dialog isn't a native input, so it can't be disabled the same
     * way - it's instead toggled via the `.fwmb-mass-edit-locked` CSS class (pointer-events
     * off, dimmed), applied to any `.fwmb-custom-select` found in the same row.
     */
    static bindMassEditToggles(html) {
        html.querySelectorAll('input[type="checkbox"][name^="apply"]').forEach((gate) => {
            const row = gate.closest(".form-group");
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
            foundry.utils.mergeObject(patch, field.extract(form, app));
        }
        return patch;
    }

    /**
     * Opens the Mass Edit dialog for one entity type and applies whatever the GM confirms to
     * every currently-selected entity of that type in a single batch. Cancelling the dialog
     * leaves the selection and every entity untouched - Select mode stays active so the GM can
     * adjust their selection and try again. Confirming it (even with nothing ticked) always
     * exits Select mode and clears the selection: per the agreed design, completing the Mass
     * Edit dialog is the second way out of Select mode, alongside toggling Select off directly.
     */
    static async onMassEdit(app, event, target) {
        const type = target.dataset.type;
        const config = this.MASS_EDIT_CONFIG[type];
        if (!config) return;

        const selection = app.massEditSelection[type];
        const entities = config.getEntities(app, selection);
        if (entities.length === 0) return;

        const context = { count: entities.length, ...config.getContext(app) };
        const content = await foundry.applications.handlebars.renderTemplate(config.template, context);

        const result = await foundry.applications.api.DialogV2.prompt({
            classes: ["fwmb"],
            window: { title: game.i18n.format(config.titleKey, { count: entities.length }) },
            content: content,
            render: (event) => {
                const dialogHtml = event.target.element;
                this.bindMassEditToggles(dialogHtml);
                if (config.onRender) config.onRender(dialogHtml, app);
            },
            ok: {
                callback: (evt, button) => this._extractMassEditPatch(button.form, config.fields, app),
            },
        });

        if (!result) return;

        if (Object.keys(result).length > 0) {
            MapStateManager.pushVectorState(app);
            entities.forEach((entity) => foundry.utils.mergeObject(entity, result));
            app._repaintVectors();
            app.markDirty();
        }

        app.massEditMode[type] = false;
        app.massEditSelection[type].clear();
        app.render({ parts: ["context"] });
    }

    // --- EDIT ACTIONS ---

    static async onEditDecoration(app, event, target, explicitId = null) {
        const id = explicitId || target.closest(".fwmb-list-item").dataset.id;
        const dec = app.mapDecorations.find((d) => d.id === id);
        if (!dec) return;

        const content = `
                <div class="form-group fwmb-dialog-content">
                    <label>${game.i18n.localize("FILRODENSWMB.UI.Name")}</label>
                    <input type="text" id="fwmb-dec-name" value="${dec.name}">
                </div>
                <div class="form-group fwmb-dialog-content" style="margin-top: var(--fwmb-space-m);">
                    <label>${game.i18n.localize("FILRODENSWMB.UI.Opacity")}</label>
                    <div class="fwmb-slider-group">
                        <input type="range" id="fwmb-dec-alpha" value="${dec.opacity ?? 1}" min="0.1" max="1" step="0.1" />
                        <output>${dec.opacity ?? 1}</output>
                    </div>
                </div>
            `;

        await this._processEditDialog(app, dec, {
            titleKey: "FILRODENSWMB.UI.Edit",
            htmlContent: content,
            onRender: (dialogApp, html) => {
                const range = html.querySelector("#fwmb-dec-alpha");
                const output = html.querySelector("output");
                if (range && output) range.addEventListener("input", (e) => (output.value = e.target.value));
            },
            onExtract: (form) => ({
                name: form.querySelector("#fwmb-dec-name").value,
                opacity: Number(form.querySelector("#fwmb-dec-alpha").value),
            }),
        });
    }

    static async onEditFault(app, event, target, explicitId = null) {
        const id = explicitId || target.closest(".fwmb-list-item").dataset.id;
        const fault = app.tectonicFaults.find((f) => f.id === id);
        if (!fault) return;

        const tectonicTypes = Object.entries(FILRODENSWMB.TECTONICS?.LABELS || {}).map(([key, label]) => ({
            id: key,
            label: label,
        }));

        await this._processEditDialog(app, fault, {
            titleKey: "FILRODENSWMB.UI.EditFault",
            template: "modules/filrodens-world-map-builder/templates/dialogs/edit-tectonics.hbs",
            context: { fault, tectonicTypes },
            onExtract: (form) => ({
                name: form.elements["faultName"].value,
                description: form.elements["faultDesc"].value,
                type: form.elements["faultType"].value,
                thickness: Number(form.elements["faultThickness"].value),
                strength: Number(form.elements["faultStrength"].value),
            }),
            onSave: (entity, result) => {
                entity.color = FILRODENSWMB.TECTONICS?.COLORS?.[result.type] || 0xffffff;
                if (app.activeFaultId === id) {
                    app.uiState.faultType = result.type;
                    app.uiState.faultThickness = result.thickness;
                    app.uiState.faultStrength = result.strength;
                    app.render({ parts: ["toolbar"] });
                }
            },
            triggersTerrain: true,
        });
    }

    static async onEditLabel(app, event, target, explicitData = null) {
        const dataset = target?.closest(".fwmb-list-item")?.dataset || {};
        const id = explicitData?.id || dataset.id;
        const type = explicitData?.type || dataset.type;
        const layerId = explicitData?.layerId || dataset.layerId;

        let sourceObj = null;
        if (type === "custom") sourceObj = app.mapLabels.find((l) => l.id === id);
        else if (type === "pin") sourceObj = app.mapPins.find((p) => p.id === id);
        else if (type === "route") sourceObj = app.mapRoutes.find((r) => r.id === id);
        else if (type === "region") {
            const layer = app.regionLayers.find((l) => l.id === layerId);
            sourceObj = layer?.regions.find((r) => r.id === id);
        }

        if (!sourceObj) return;

        let labelData = { name: sourceObj.name };

        if (type === "custom") {
            foundry.utils.mergeObject(labelData, sourceObj);
        } else {
            const safeObj = this._withLabelDefaults(app, sourceObj);
            foundry.utils.mergeObject(labelData, safeObj.label);
        }

        await this._processEditDialog(app, sourceObj, {
            titleKey: "FILRODENSWMB.UI.EditLabel",
            template: "modules/filrodens-world-map-builder/templates/dialogs/edit-labels.hbs",
            context: {
                label: labelData,
                fonts: CONFIG.fontFamilies || ["Signika", "Modesto Condensed", "Arial"],
                palette: FILRODENSWMB.LABELS?.PRESETS || [],
                customLabelStyles: app.uiState.customLabelStyles || [],
            },
            onRender: (dialogApp, html) => {
                this.bindLabelPropertiesDialog(html, app.uiState);
            },
            onExtract: (form, fallbackName) => {
                const result = { name: form.elements["labelName"]?.value.trim() || fallbackName };
                if (type === "custom") Object.assign(result, this._extractLabelResultFields(form));
                else result.label = this._extractLabelResultFields(form);
                return result;
            },
        });
    }

    static async onEditCustomPinIcon(app, event, target) {
        const id = target.closest(".fwmb-list-item").dataset.id;
        const icon = getCustomPinIconById(id);
        if (!icon) return;

        const result = await this._promptPinIconDialog(icon, "FILRODENSWMB.UI.Edit");
        if (!result) return;

        await updateCustomPinIcon(id, result);
        app.render({ parts: ["context"] });
    }

    static async onEditPin(app, event, target, explicitId = null) {
        const id = explicitId || target.closest(".fwmb-list-item").dataset.id;
        const pin = app.mapPins.find((p) => p.id === id);
        if (!pin) return;

        const safePin = this._withLabelDefaults(app, pin);
        const icons = getPinIconPickerList(pin.icon).map((entry) => ({
            key: entry.key,
            localized: entry.label,
            path: entry.path,
            isCustom: entry.isCustom,
            selected: entry.key === pin.icon,
        }));
        const currentIcon = icons.find((entry) => entry.selected);

        await this._processEditDialog(app, pin, {
            titleKey: "FILRODENSWMB.UI.EditPin",
            template: "modules/filrodens-world-map-builder/templates/dialogs/edit-pins.hbs",
            context: {
                pin: safePin,
                icons,
                pinIconPath: currentIcon?.path || "",
                pinIconIsCustom: currentIcon?.isCustom || false,
                palette: FILRODENSWMB.LABELS?.PRESETS || [],
                fonts: CONFIG.fontFamilies || ["Signika", "Modesto Condensed", "Arial"],
                customLabelStyles: app.uiState.customLabelStyles || [],
            },
            onRender: (dialogApp, html) => {
                const range = html.querySelector('input[name="pinScale"]');
                const output = html.querySelector("output");
                if (range && output) range.addEventListener("input", (e) => (output.value = e.target.value));

                const trigger = html.querySelector("#fwmb-edit-pin-select .fwmb-select-trigger");
                const optionsMenu = html.querySelector("#fwmb-edit-pin-select .fwmb-select-options");
                const hiddenInput = html.querySelector("#fwmb-edit-pin-icon-input");
                const triggerIcon = html.querySelector("#fwmb-edit-pin-trigger-icon");

                if (trigger && optionsMenu) {
                    trigger.addEventListener("click", () => optionsMenu.classList.toggle("fwmb-hidden"));
                    const optionBtns = optionsMenu.querySelectorAll("button");
                    optionBtns.forEach((btn) => {
                        btn.addEventListener("click", () => {
                            const newIcon = btn.dataset.icon;
                            hiddenInput.value = newIcon;
                            this._applyIconGlyph(triggerIcon, newIcon, btn.dataset.path, btn.dataset.custom === "true");
                            optionBtns.forEach((b) => b.classList.remove("active"));
                            btn.classList.add("active");
                            optionsMenu.classList.add("fwmb-hidden");
                        });
                    });
                }
                this.bindLabelPropertiesDialog(html, app.uiState);
            },
            onExtract: (form, fallbackName) => ({
                name: form.elements["pinName"]?.value.trim() || fallbackName,
                description: form.elements["pinDesc"].value,
                icon: form.elements["pinIcon"].value,
                scale: Number(form.elements["pinScale"].value),
                color: form.elements["pinColor"].value,
                label: this._extractLabelResultFields(form),
            }),
        });
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
                if (config.onCascade) config.onCascade(app, id, result);

                if (app.uiState[config.activeStateKey] === id) {
                    if (config.onUpdateActiveUI) config.onUpdateActiveUI(app, result);
                }
            },
        });
    }

    static async onEditRegion(app, event, target, explicitData = null) {
        app.activeRegionId = null;

        const layerId = explicitData ? explicitData.layerId : target.closest(".fwmb-accordion-group").dataset.layerId;
        const regionId = explicitData ? explicitData.regionId : target.closest(".fwmb-list-item").dataset.id;

        const layer = app.regionLayers.find((l) => l.id === layerId);
        if (!layer) return;

        const region = layer.regions.find((r) => r.id === regionId);
        if (!region) return;

        const safeRegion = this._withLabelDefaults(app, region);

        await this._processEditDialog(app, region, {
            titleKey: "FILRODENSWMB.UI.EditRegion",
            template: "modules/filrodens-world-map-builder/templates/dialogs/edit-regions.hbs",
            context: {
                region: safeRegion,
                fonts: CONFIG.fontFamilies || ["Signika", "Modesto Condensed", "Arial"],
                palette: FILRODENSWMB.LABELS?.PRESETS || [],
                customLabelStyles: app.uiState.customLabelStyles || [],
                customRegionStyles: app.uiState.customRegionStyles || [],
            },
            onRender: (dialogApp, html) => {
                const quickStyleSelect = html.querySelector('select[name="regionQuickStyle"]');
                const fillTransparentCheckbox = html.querySelector('input[name="regionFillTransparent"]');
                const fillColorInput = html.querySelector('input[name="regionFillColor"]');
                const fillStyleSelect = html.querySelector('select[name="regionFillStyle"]');
                const lineColorInput = html.querySelector('input[name="regionLineColor"]');
                const lineThicknessInput = html.querySelector('input[name="regionLineThickness"]');
                const lineStyleSelect = html.querySelector('select[name="regionLineStyle"]');
                const smoothingSelect = html.querySelector('select[name="regionSmoothing"]');

                quickStyleSelect?.addEventListener("change", (e) => {
                    const styleId = e.target.value;
                    if (styleId !== "custom") {
                        const styleData = app.uiState.customRegionStyles.find((s) => s.id === styleId);
                        if (styleData) {
                            const isTransparent = styleData.fillColor === "transparent";
                            if (fillTransparentCheckbox) fillTransparentCheckbox.checked = isTransparent;
                            if (fillColorInput) fillColorInput.value = isTransparent ? "#000000" : styleData.fillColor;
                            if (fillStyleSelect) fillStyleSelect.value = styleData.fillStyle;
                            if (lineColorInput) lineColorInput.value = styleData.lineColor;
                            if (lineThicknessInput) lineThicknessInput.value = styleData.lineThickness;
                            if (lineStyleSelect) lineStyleSelect.value = styleData.lineStyle;
                            if (smoothingSelect) smoothingSelect.value = String(styleData.smoothing);
                        }
                    }
                });

                const revertToCustom = () => {
                    if (quickStyleSelect) quickStyleSelect.value = "custom";
                };
                fillTransparentCheckbox?.addEventListener("change", revertToCustom);
                fillColorInput?.addEventListener("input", revertToCustom);
                fillStyleSelect?.addEventListener("change", revertToCustom);
                lineColorInput?.addEventListener("input", revertToCustom);
                lineThicknessInput?.addEventListener("input", revertToCustom);
                lineStyleSelect?.addEventListener("change", revertToCustom);
                smoothingSelect?.addEventListener("change", revertToCustom);

                this.bindLabelPropertiesDialog(html, app.uiState);
            },
            onExtract: (form, fallbackName) => ({
                name: form.elements["regionName"]?.value.trim() || fallbackName,
                description: form.elements["regionDesc"].value,
                quickStyle: form.elements["regionQuickStyle"].value,
                fillColor: form.elements["regionFillTransparent"].checked ? "transparent" : form.elements["regionFillColor"].value,
                fillStyle: form.elements["regionFillStyle"].value,
                lineColor: form.elements["regionLineColor"].value,
                lineThickness: Number(form.elements["regionLineThickness"].value),
                lineStyle: form.elements["regionLineStyle"].value,
                smoothing: form.elements["regionSmoothing"].value === "true",
                label: this._extractLabelResultFields(form),
            }),
        });
    }

    static async onEditRegionLayer(app, event, target) {
        const id = target.closest(".fwmb-accordion-group").dataset.layerId;
        const layer = app.regionLayers.find((l) => l.id === id);
        if (!layer) return;

        const newName = await this._promptTextValue(game.i18n.localize("FILRODENSWMB.UI.EditLayer"), "Layer Name", layer.name);
        if (newName) {
            layer.name = newName;
            app.render({ parts: ["context"] });
            app.markDirty();
        }
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
                    app.render({ parts: ["toolbar"] });
                }
            },
            triggersTerrain: true,
        });
    }

    static async onEditRoute(app, event, target, explicitId = null) {
        const id = explicitId || target.closest(".fwmb-list-item").dataset.id;
        const route = app.mapRoutes.find((r) => r.id === id);
        if (!route) return;

        const safeRoute = this._withLabelDefaults(app, route);

        await this._processEditDialog(app, route, {
            titleKey: "FILRODENSWMB.UI.EditRoute",
            template: "modules/filrodens-world-map-builder/templates/dialogs/edit-routes.hbs",
            context: {
                route: safeRoute,
                customRouteStyles: app.uiState.customRouteStyles || [],
                palette: FILRODENSWMB.LABELS?.PRESETS || [],
                fonts: CONFIG.fontFamilies || ["Signika", "Modesto Condensed", "Arial"],
                customLabelStyles: app.uiState.customLabelStyles || [],
            },
            onRender: (dialogApp, html) => {
                const quickStyleSelect = html.querySelector('select[name="routeQuickStyle"]');
                const colorInput = html.querySelector('input[name="routeColor"]');
                const thicknessInput = html.querySelector('input[name="routeThickness"]');
                const styleSelect = html.querySelector('select[name="routeStyle"]');

                quickStyleSelect?.addEventListener("change", (e) => {
                    const styleId = e.target.value;
                    if (styleId !== "custom") {
                        const styleData = app.uiState.customRouteStyles.find((s) => s.id === styleId);
                        if (styleData) {
                            colorInput.value = styleData.color;
                            thicknessInput.value = styleData.thickness;
                            styleSelect.value = styleData.style;
                        }
                    }
                });

                const revertToCustom = () => {
                    if (quickStyleSelect) quickStyleSelect.value = "custom";
                };
                colorInput?.addEventListener("input", revertToCustom);
                thicknessInput?.addEventListener("input", revertToCustom);
                styleSelect?.addEventListener("change", revertToCustom);

                this.bindLabelPropertiesDialog(html, app.uiState);
            },
            onExtract: (form, fallbackName) => ({
                name: form.elements["routeName"]?.value.trim() || fallbackName,
                description: form.elements["routeDesc"].value,
                quickStyle: form.elements["routeQuickStyle"].value,
                color: form.elements["routeColor"].value,
                thickness: Number(form.elements["routeThickness"].value),
                style: form.elements["routeStyle"].value,
                label: this._extractLabelResultFields(form),
            }),
            onSave: (entity, result) => {
                if (app.activeRouteId === id) {
                    app.uiState.activeRouteQuickStyle = result.quickStyle;
                    app.uiState.routeColor = result.color;
                    app.uiState.routeThickness = result.thickness;
                    app.uiState.routeStyle = result.style;
                    app.render({ parts: ["toolbar"] });
                }
            },
        });
    }
}
