import { FILRODENSWMB } from "../config.js";
import { MapStateManager } from "./MapStateManager.js";

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
     * Builds a safe copy of an entity inheriting the current global label defaults.
     */
    static _withLabelDefaults(app, entity) {
        const safe = { ...entity };
        if (!safe.label) {
            safe.label = {
                quickStyle: "custom",
                fontFamily: app.uiState.labelFontFamily,
                fontSize: app.uiState.labelFontSize,
                fillColor: app.uiState.labelFillColor,
                maxWidth: app.uiState.labelMaxWidth,
                justify: app.uiState.labelJustify,
            };
        }
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
        app.markDirty();
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

    static async onEditPin(app, event, target, explicitId = null) {
        const id = explicitId || target.closest(".fwmb-list-item").dataset.id;
        const pin = app.mapPins.find((p) => p.id === id);
        if (!pin) return;

        const safePin = this._withLabelDefaults(app, pin);
        const icons = Object.entries(FILRODENSWMB.INFRASTRUCTURE_ICONS)
            .map(([key, label]) => ({ key, localized: game.i18n.localize(label), selected: key === pin.icon }))
            .sort((a, b) => a.localized.localeCompare(b.localized));

        await this._processEditDialog(app, pin, {
            titleKey: "FILRODENSWMB.UI.EditPin",
            template: "modules/filrodens-world-map-builder/templates/dialogs/edit-pins.hbs",
            context: {
                pin: safePin,
                icons,
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
                        btn.addEventListener("click", (e) => {
                            const newIcon = btn.dataset.icon;
                            hiddenInput.value = newIcon;
                            triggerIcon.className = `fwmb-icon ${newIcon}`;
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
            },
            onRender: (dialogApp, html) => {
                this.bindLabelPropertiesDialog(html, app.uiState);
            },
            onExtract: (form, fallbackName) => ({
                name: form.elements["regionName"]?.value.trim() || fallbackName,
                description: form.elements["regionDesc"].value,
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
