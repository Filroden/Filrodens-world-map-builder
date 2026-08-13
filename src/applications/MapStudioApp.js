import { FILRODENSWMB } from "../config.js";
import { StudioCanvas } from "../canvas/StudioCanvas.js";
import { ProceduralEngine } from "../generation/ProceduralEngine.js";
import { HydrologyEngine } from "../generation/HydrologyEngine.js";
import { BrushEngine } from "../tools/BrushEngine.js";
import { getSavedMaps, loadMapData, saveMapData, deleteSavedMap, renameSavedMap, duplicateSavedMap } from "../data/compendium.js";
import { Scene3D } from "../canvas/Scene3D.js";
import { SceneExporter } from "./SceneExporter.js";
import { SpatialMath } from "../tools/SpatialMath.js";
import { MapStateManager } from "./MapStateManager.js";
import { MapDialogManager } from "./MapDialogManager.js";
import { RegionalExtractor } from "./RegionalExtractor.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class MapStudioApp extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        id: "fwmb-map-studio",
        classes: ["fwmb", "fwmb-layout"],
        position: { width: 1300, height: 900 },
        window: {
            title: "FILRODENSWMB.UI.ControlTitle",
            icon: "fwmb-icon map",
            resizable: true,
        },
        // prettier-ignore
        actions: {
            // --- DIALOG MANAGER: Quick Styles ---
            addLabelQuickStyle(e, t)    { MapDialogManager.onAddQuickStyle(this, e, t); },
            addRouteQuickStyle(e, t)    { MapDialogManager.onAddQuickStyle(this, e, t); },
            editLabelQuickStyle(e, t)   { MapDialogManager.onEditQuickStyle(this, e, t); },
            editRouteQuickStyle(e, t)   { MapDialogManager.onEditQuickStyle(this, e, t); },
            deleteLabelQuickStyle(e, t) { MapDialogManager.onDeleteQuickStyle(this, e, t); },
            deleteRouteQuickStyle(e, t) { MapDialogManager.onDeleteQuickStyle(this, e, t); },

            // --- DIALOG MANAGER: Entity Deletion ---
            deleteDecoration(e, t)  { MapDialogManager.onDeleteEntity(this, e, t); },
            deleteFault(e, t)       { MapDialogManager.onDeleteEntity(this, e, t); },
            deleteLabel(e, t)       { MapDialogManager.onDeleteEntity(this, e, t); },
            deletePin(e, t)         { MapDialogManager.onDeleteEntity(this, e, t); },
            deleteRegion(e, t)      { MapDialogManager.onDeleteRegion(this, e, t); },
            deleteRegionLayer(e, t) { MapDialogManager.onDeleteEntity(this, e, t); },
            deleteRiver(e, t)       { MapDialogManager.onDeleteEntity(this, e, t); },
            deleteRoute(e, t)       { MapDialogManager.onDeleteEntity(this, e, t); },

            // --- DIALOG MANAGER: Entity Editing ---
            editDecoration(e, t)  { MapDialogManager.onEditDecoration(this, e, t); },
            editFault(e, t)       { MapDialogManager.onEditFault(this, e, t); },
            editLabel(e, t)       { MapDialogManager.onEditLabel(this, e, t); },
            editPin(e, t)         { MapDialogManager.onEditPin(this, e, t); },
            editRegion(e, t)      { MapDialogManager.onEditRegion(this, e, t); },
            editRegionLayer(e, t) { MapDialogManager.onEditRegionLayer(this, e, t); },
            editRiver(e, t)       { MapDialogManager.onEditRiver(this, e, t); },
            editRoute(e, t)       { MapDialogManager.onEditRoute(this, e, t); },

            // --- DIALOG MANAGER: Custom Biomes & Misc ---
            addCustomBiome(e, t)    { MapDialogManager.onAddCustomBiome(this, e, t); },
            deleteCustomBiome(e, t) { MapDialogManager.onDeleteCustomBiome(this, e, t); },
            addDecoration(e, t)     { MapDialogManager.onAddDecoration(this, e, t); },
            addRegionLayer(e, t)    { MapDialogManager.onAddRegionLayer(this, e, t); },

            // --- MAP STUDIO APP: Internal Tooling & States ---
            adjustNoiseScale(e, t)          { this._onAdjustNoiseScale(e, t); },
            adjustReferenceScale(e, t)      { this._onAdjustReferenceScale(e, t); },
            applyFeatureMath(e, t)          { this._onApplyFeatureMath(e, t); },
            applyResolution(e, t)           { this._onApplyResolution(e, t); },
            changeTool(e, t)                { this._onChangeTool(e, t); },
            exportPng(e, t)                 { this._onExportPng(e, t); },
            exportScene(e, t)               { this._onExportScene(e, t); },
            generateRegionalMap(e, t)       { this._onGenerateRegionalMap(e, t); },
            importMapJson(e, t)             { this._onImportMapJson(e, t); },
            manageMap(e, t)                 { this._onManageMapAction(e, t); },
            nudgeNoise(e, t)                { this._onNudgeNoise(e, t); },
            nudgeReference(e, t)            { this._onNudgeReference(e, t); },
            randomizeSeed(e, t)             { this._onRandomizeSeed(e, t); },
            redoBrush(e, t)                 { this._onRedoBrush(e, t); },
            removeReferenceImage(e, t)      { this._onRemoveReferenceImage(e, t); },
            resetNoisePan(e, t)             { this._onResetNoisePan(e, t); },
            resetNoiseScale(e, t)           { this._onResetNoiseScale(e, t); },
            resetReferencePan(e, t)         { this._onResetReferencePan(e, t); },
            resetReferenceScale(e, t)       { this._onResetReferenceScale(e, t); },
            resetZoom(e, t)                 { this._onResetZoom(e, t); },
            saveMap(e, t)                   { this._onSaveMap(e, t); },
            selectRegionLayer(e, t)         { this._onSelectRegionLayer(e, t); },
            setBrushTool(e, t)              { this._onSetBrushTool(e, t); },
            setFeatureMode(e, t)            { this._onSetFeatureMode(e, t); },
            setInfraMode(e, t)              { this._onSetInfraMode(e, t); },
            setInfrastructureIcon(e, t)     { this._onSetInfrastructureIcon(e, t); },
            setRegionMode(e, t)             { this._onSetRegionMode(e, t); },
            setRegionPreset(e, t)           { this._onSetRegionPreset(e, t); },
            threeDView(e, t)                { this._onThreeDView(e, t); },
            toggleEditMode(e, t)            { this._onToggleEditMode(e, t); },
            toggleGrid(e, t)                { this._onToggleGrid(e, t); },
            toggleLayer(e, t)               { this._onToggleLayer(e, t); },
            toggleLiveFeatureUpdates(e, t)  { this._onToggleLiveFeatureUpdates(e, t); },
            togglePinDropdown(e, t)         { this._onTogglePinDropdown(e, t); },
            toggleRegionSmoothing(e, t)     { this._onToggleRegionSmoothing(e, t); },
            toggleSnapping(e, t)            { this._onToggleSnapping(e, t); },
            toggleViewFilter(e, t)          { this._onToggleViewFilter(e, t); },
            toggleVisibility(e, t)          { this._onToggleVisibility(e, t); },
            undoBrush(e, t)                 { this._onUndoBrush(e, t); },
            zoomIn(e, t)                    { this._onZoomIn(e, t); },
            zoomOut(e, t)                   { this._onZoomOut(e, t); },
            zoomToFeature(e, t)             { this._onZoomToFeature(e, t); },
        },
    };

    static PARTS = {
        toolbar: {
            template: "modules/filrodens-world-map-builder/templates/toolbar.hbs",
            classes: ["fwmb-toolbar"],
        },
        context: {
            template: "modules/filrodens-world-map-builder/templates/context.hbs",
            classes: ["fwmb-context-panel"],
            scrollable: [".fwmb-scrollable", "#fwmb-scroll-auto-labels", "#fwmb-scroll-custom-labels", "#fwmb-scroll-rivers", "#fwmb-scroll-faults", "#fwmb-scroll-pins", "#fwmb-scroll-routes"],
        },
        map: {
            template: "modules/filrodens-world-map-builder/templates/map.hbs",
            classes: ["fwmb-map"],
        },
        editToolbar: {
            template: "modules/filrodens-world-map-builder/templates/parts/edit-map-tools.hbs",
            classes: ["fwmb-edit-toolbar"],
        },
    };

    constructor(options) {
        options.position = foundry.utils.mergeObject(options.position || {}, {
            width: window.innerWidth * 0.7,
            height: window.innerHeight * 0.9,
        });

        super(options);

        this.canvasEngine = null;
        this.activeTool = "scene";
        this.viewFilters = { all: true, gm: true, none: false };

        this.mapWidth = FILRODENSWMB.DEFAULTS.MAP_WIDTH;
        this.mapHeight = FILRODENSWMB.DEFAULTS.MAP_HEIGHT;

        this.baseElevationData = null;
        this.currentElevationData = null;
        this.currentBiomeOverrides = null;
        this.currentMoistureData = null;
        this.currentTemperatureData = null;
        this.currentRiverData = null;
        this.tectonicFaults = [];
        this.activeFaultId = null;
        this.manualRivers = [];
        this.activeRiverId = null;
        this.mapPins = [];
        this.mapRoutes = [];
        this.activeRouteId = null;
        this.regionLayers = [];
        this.activeRegionLayerId = null;
        this.activeRegionId = null;
        this.mapLabels = [];
        this.mapDecorations = [];
        this.pinHistory = [];
        this.pinRedoStack = [];
        this.globalHistoryLedger = [];
        this.globalRedoLedger = [];
        this.hasPendingFeatureMath = false;
        this.pendingTerrainBounds = null;
        this.cachedMaxElevation = null;
        this.brushEngine = null;

        this.currentSaveId = null;
        this.currentSaveName = null;
        this.currentParentId = null;
        this.isDirty = false;
        this.isSaving = false;

        MapStateManager.allocateBuffers(this);
        this.hasBooted = false;

        this.defaultUiState = MapStateManager.buildDefaultUiState(this.mapWidth, this.mapHeight);

        this.uiState = foundry.utils.deepClone(this.defaultUiState);
        this.customBiomeColors = {};

        this.debouncedGenerateTerrain = foundry.utils.debounce(this.generateTerrain.bind(this), FILRODENSWMB.UI.DEBOUNCE_MS.TERRAIN);
        this.debouncedGenerateClimate = foundry.utils.debounce(this.generateClimate.bind(this), FILRODENSWMB.UI.DEBOUNCE_MS.CLIMATE);
        this.debouncedGenerateFeatures = foundry.utils.debounce(this.generateFeatures.bind(this), FILRODENSWMB.UI.DEBOUNCE_MS.FEATURES);

        this.debouncedCanvasTerrain = foundry.utils.debounce(this.generateTerrain.bind(this), FILRODENSWMB.UI.DEBOUNCE_MS.CANVAS);
        this.debouncedCanvasClimate = foundry.utils.debounce(this.generateClimate.bind(this), FILRODENSWMB.UI.DEBOUNCE_MS.CANVAS);

        this.debouncedHistoryRebuild = foundry.utils.debounce(() => {
            this.#rebuildFromHistory(true).then(() => {
                this._repaintCanvas(null);
                this.generateClimate(null);
            });
        }, FILRODENSWMB.UI.DEBOUNCE_MS.CANVAS);
    }

    markDirty() {
        this.isDirty = true;
    }

    /**
     * Dynamically calculates the click-tolerance threshold in canvas-space pixels.
     * Ensures proximity checks remain exactly 15 screen-pixels wide regardless of zoom.
     */
    get currentSnapThreshold() {
        const baseThreshold = FILRODENSWMB.LIMITS.SNAP_THRESHOLD;
        const zoomScale = this.canvasEngine?.stage?.scale?.x || 1;
        return baseThreshold / zoomScale;
    }

    /**
     * Applies RTL directionality if the active language requires it.
     */
    static #applyRTLSupport(element) {
        const rtlLanguages = FILRODENSWMB.UI.RTL_LANGUAGES || [];
        // Fallback to "en" if game.i18n is not fully initialised during early render
        const currentLang = game?.i18n?.lang || "en";

        if (!rtlLanguages.includes(currentLang)) return;

        element.setAttribute("dir", "rtl");
        element.classList.add("rtl");
    }

    async _preparePartContext(partId, context, options) {
        context = await super._preparePartContext(partId, context, options);

        context.hasPendingFeatureMath = this.hasPendingFeatureMath;
        this.uiState.isEditMode = this.canvasEngine?.isEditMode ?? false;

        context.config = FILRODENSWMB;
        context.activeTool = this.activeTool;

        const isVectorTool = FILRODENSWMB.UI.VECTOR_TOOLS.includes(this.activeTool);
        context.isLocked = this.uiState.isEditMode && !isVectorTool;

        if (partId === "editToolbar") {
            const editableTools = FILRODENSWMB.UI.EDITABLE_TOOLS;

            if (editableTools.includes(this.activeTool)) {
                context.toolbarPartial = `modules/filrodens-world-map-builder/templates/parts/toolbar-${this.activeTool}.hbs`;
            } else {
                context.toolbarPartial = `modules/filrodens-world-map-builder/templates/parts/toolbar-empty.hbs`;
            }
        }

        const rgbToHex = (rgb) => "#" + rgb.map((x) => x.toString(16).padStart(2, "0")).join("");

        context.biomeList = Object.entries(FILRODENSWMB.BIOME_IDS)
            .filter(([key, id]) => id !== 1 && id !== 2 && !key.toLowerCase().startsWith("custom"))
            .map(([key, id]) => {
                const defaultRgb = FILRODENSWMB.BIOMES[key] || [0, 0, 0];
                const currentRgb = this.customBiomeColors[key] || defaultRgb;

                return {
                    id: id,
                    key: key,
                    label: `FILRODENSWMB.BIOMES.${key}`,
                    hex: rgbToHex(currentRgb),
                    isCustom: false,
                };
            });

        // Map custom biomes and append them to the UI list
        const customBiomesMapped = (this.uiState.customBiomes || []).map((cb) => ({
            id: cb.id,
            key: `custom_${cb.id}`,
            label: cb.name,
            hex: rgbToHex(cb.color),
            isCustom: true,
        }));

        context.biomeList = [...context.biomeList, ...customBiomesMapped];

        context.tectonicTypes = Object.entries(FILRODENSWMB.TECTONICS?.LABELS || {}).map(([id, label]) => ({
            id: id,
            label: label,
        }));

        const alphaSort = (a, b) => (a.name || "").localeCompare(b.name || "", undefined, { numeric: true, sensitivity: "base" });

        context.tectonicFaults = [...(this.tectonicFaults || [])].sort(alphaSort);
        context.manualRivers = [...(this.manualRivers || [])].sort(alphaSort);

        context.uiState = this.uiState;
        context.currentSaveName = this.currentSaveName;

        context.infrastructureIcons = Object.entries(FILRODENSWMB.INFRASTRUCTURE_ICONS)
            .map(([id, label]) => ({
                id: id,
                label: label,
                _localized: game.i18n.localize(label),
            }))
            .sort((a, b) => a._localized.localeCompare(b._localized));

        context.routeStyles = (this.uiState.customRouteStyles || []).map((style) => ({
            id: style.id,
            label: style.name,
            isCustom: true,
        }));

        context.customRouteStyles = [...(this.uiState.customRouteStyles || [])].sort(alphaSort);
        context.customLabelStyles = [...(this.uiState.customLabelStyles || [])].sort(alphaSort);

        if (partId === "context") {
            context.toolPartial = `modules/filrodens-world-map-builder/templates/tools-${this.activeTool}.hbs`;
            context.mapPins = (this.mapPins || []).filter((p) => !!p.icon).sort(alphaSort);
            context.mapRoutes = [...(this.mapRoutes || [])].sort(alphaSort);
            context.mapLabels = [...(this.mapLabels || [])].sort(alphaSort);
            context.mapDecorations = [...(this.mapDecorations || [])].sort(alphaSort);

            const autoLabels = [];

            context.mapPins.forEach((p) => {
                autoLabels.push({ ...p, dataType: "pin", displayVisibility: p.label?.visibility || "all" });
            });

            context.mapRoutes.forEach((r) => {
                autoLabels.push({ ...r, dataType: "route", displayVisibility: r.label?.visibility || "all" });
            });

            (this.regionLayers || []).forEach((layer) => {
                (layer.regions || []).forEach((r) => {
                    autoLabels.push({ ...r, dataType: "region", layerId: layer.id, displayVisibility: r.label?.visibility || "all" });
                });
            });

            // Sort the unified list alphabetically by name
            context.autoLabels = autoLabels.toSorted(alphaSort);
            context.fontFamilies = CONFIG.fontFamilies || ["Signika", "Modesto Condensed", "Arial"];
            context.labelColorPalette = FILRODENSWMB.LABELS?.PRESETS || [];

            if (this.regionLayers.length > 0 && !this.activeRegionLayerId) {
                this.activeRegionLayerId = this.regionLayers[0].id;
            }

            context.regionLayers = [...(this.regionLayers || [])].sort(alphaSort).map((layer) => ({
                ...layer,
                isActive: layer.id === this.activeRegionLayerId,
                regions: [...(layer.regions || [])].sort(alphaSort),
            }));

            if (this.activeTool === "manage") {
                context.savedMaps = await getSavedMaps();
            }
        }

        return context;
    }

    _onRender(context, options) {
        super._onRender(context, options);
        MapStudioApp.#applyRTLSupport(this.element);

        this.#bindGlobalListeners();
        this.#initCanvasAndEngines();
        this.#bindToolbarListeners();
        this.#bindContextPanelListeners();
        this.#bindCanvasCallbacks();
        this.#applyInitialBootState();

        const mapContainer = this.element.querySelector(".fwmb-map-container");
        const editToolbar = this.element.querySelector(".fwmb-edit-toolbar");

        if (mapContainer && editToolbar && editToolbar.parentElement !== mapContainer) {
            mapContainer.prepend(editToolbar);
        }
    }

    #bindGlobalListeners() {
        this.element.addEventListener("input", (event) => {
            if (event.target.type === "range") {
                const output = event.target.parentElement.querySelector("output");
                if (output) output.value = event.target.value;
            }
        });

        if (!this.element.dataset.hasDblClickListener) {
            this.element.addEventListener("dblclick", (event) => {
                const target = event.target;
                if (target.tagName === "INPUT" && target.type === "range") {
                    const defaultVal = this.defaultUiState[target.name];
                    if (defaultVal !== undefined && target.value !== String(defaultVal)) {
                        target.value = defaultVal;
                        if (target.nextElementSibling?.tagName === "OUTPUT") target.nextElementSibling.value = defaultVal;
                        target.dispatchEvent(new Event("input", { bubbles: true }));
                    }
                }
            });
            this.element.dataset.hasDblClickListener = "true";
        }

        // Universal Keyboard Shortcuts
        if (!this.element.dataset.hasKeyboardListeners) {
            this.element.addEventListener("keydown", (event) => {
                // Ensure shortcuts only fire if the user is focused on this module app (bypassing text inputs)
                const activeElement = document.activeElement;
                const isInputFocused = activeElement && (activeElement.tagName === "INPUT" || activeElement.tagName === "TEXTAREA");
                if (isInputFocused) return;

                const isCtrlOrCmd = event.ctrlKey || event.metaKey;

                if (isCtrlOrCmd && event.key.toLowerCase() === "z") {
                    event.preventDefault();
                    if (event.shiftKey) {
                        this._onRedoBrush();
                    } else {
                        this._onUndoBrush();
                    }
                } else if (isCtrlOrCmd && event.key.toLowerCase() === "y") {
                    event.preventDefault();
                    this._onRedoBrush();
                }
            });
            this.element.dataset.hasKeyboardListeners = "true";
        }
    }

    #initCanvasAndEngines() {
        const container = this.element.querySelector(".fwmb-map-preview");
        if (!container || this.canvasEngine) return;

        this.canvasEngine = new StudioCanvas(container);
        this.brushEngine = new BrushEngine(this.mapWidth, this.mapHeight);
        this.#wireBrushCallbacks();

        this.canvasEngine.onCropUpdate = (cropBox) => {
            const targetWidth = this.uiState.regionalTargetWidth;
            const zoomScale = targetWidth / cropBox.width;
            const calcHeight = Math.round(cropBox.height * zoomScale);

            this.uiState.regionalTargetHeight = calcHeight;
            const heightInput = this.element.querySelector('input[name="regionalTargetHeight"]');
            if (heightInput) heightInput.value = calcHeight;

            const latRange = Math.abs(this.uiState.latTop - this.uiState.latBottom);
            const newLatTop = this.uiState.latTop - (cropBox.y / this.mapHeight) * latRange;
            const newLatBottom = this.uiState.latTop - ((cropBox.y + cropBox.height) / this.mapHeight) * latRange;

            const latTopEl = this.element.querySelector("#fwmb-readout-lat-top");
            const latBottomEl = this.element.querySelector("#fwmb-readout-lat-bottom");
            if (latTopEl) latTopEl.innerHTML = `${newLatTop.toFixed(2)}&deg;`;
            if (latBottomEl) latBottomEl.innerHTML = `${newLatBottom.toFixed(2)}&deg;`;
        };
    }

    #bindToolbarListeners() {
        const editToolbar = this.element.querySelector(".fwmb-edit-toolbar");
        if (editToolbar && !editToolbar.dataset.hasListeners) {
            editToolbar.dataset.hasListeners = "true";
            editToolbar.addEventListener("input", (e) => this.#handleToolbarInput(e));
            editToolbar.addEventListener("change", (e) => this.#handleToolbarInput(e));
        }

        if (!this.element.dataset.hasUndoListeners) {
            this.element.dataset.hasUndoListeners = "true";

            const undoBtn = this.element.querySelector('[data-action="undoBrush"]');
            const redoBtn = this.element.querySelector('[data-action="redoBrush"]');

            if (undoBtn) {
                undoBtn.addEventListener("pointerenter", () => this.#previewActionBounds("undo"));
                undoBtn.addEventListener("pointerleave", () => this.canvasEngine?.clearActionPreview());
            }
            if (redoBtn) {
                redoBtn.addEventListener("pointerenter", () => this.#previewActionBounds("redo"));
                redoBtn.addEventListener("pointerleave", () => this.canvasEngine?.clearActionPreview());
            }
        }
    }

    #handleToolbarInput(event) {
        const target = event.target;

        if ((target.type === "number" || target.type === "text") && event.type === "input") {
            return;
        }

        const name = target.name;

        if (!name || !(name in this.uiState)) return;

        this.markDirty();

        // 1. Assign Value
        if (target.type === "checkbox") this.uiState[name] = target.checked;
        else if (target.type === "number" || target.type === "range") this.uiState[name] = Number(target.value);
        else this.uiState[name] = target.value;

        // 2. Delegate to Sub-Systems
        this.#syncFaultLiveEdits(name);
        this.#syncRouteLiveEdits(name, target);
        this.#syncRegionLiveEdits(name);
        this.#syncCropLiveEdits(name);
    }

    #syncFaultLiveEdits(name) {
        if (!["faultType", "faultThickness", "faultStrength"].includes(name) || !this.activeFaultId) return;

        const fault = this.tectonicFaults.find((f) => f.id === this.activeFaultId);
        if (!fault) return;

        fault.type = this.uiState.faultType;
        fault.thickness = this.uiState.faultThickness;
        fault.strength = this.uiState.faultStrength;

        if (name === "faultType") {
            fault.color = FILRODENSWMB.TECTONICS?.COLORS?.[this.uiState.faultType] || 0xffffff;
        }

        this._repaintVectors();
        this.requestTerrainUpdate();
    }

    #syncRouteLiveEdits(name, target) {
        // Fallback to custom if a manual property is changed
        if (["routeColor", "routeThickness", "routeStyle"].includes(name)) {
            this.uiState.activeRouteQuickStyle = "custom";
            this.render({ parts: ["toolbar", "editToolbar"] });
        }

        // Apply preset if dropdown is changed
        if (name === "activeRouteQuickStyle") {
            const styleId = target.value;
            if (styleId !== "custom") {
                const styleData = this.uiState.customRouteStyles.find((s) => s.id === styleId);
                if (styleData) {
                    this.uiState.routeColor = styleData.color;
                    this.uiState.routeThickness = styleData.thickness;
                    this.uiState.routeStyle = styleData.style;
                    this.render({ parts: ["toolbar", "editToolbar"] });
                }
            }
        }

        // Apply changes to the active route currently being drawn
        if (["activeRouteQuickStyle", "routeColor", "routeThickness", "routeStyle"].includes(name) && this.activeRouteId) {
            const route = this.mapRoutes.find((r) => r.id === this.activeRouteId);
            if (route) {
                route.quickStyle = this.uiState.activeRouteQuickStyle;
                route.color = this.uiState.routeColor;
                route.thickness = this.uiState.routeThickness;
                route.style = this.uiState.routeStyle;
                this._repaintVectors();
            }
        }
    }

    #syncRegionLiveEdits(name) {
        if (!name.startsWith("region") || !this.activeRegionId || !this.activeRegionLayerId) return;

        const layer = this.regionLayers.find((l) => l.id === this.activeRegionLayerId);
        const region = layer?.regions.find((r) => r.id === this.activeRegionId);

        if (region) {
            region.fillColor = this.uiState.regionFillColor;
            region.fillStyle = this.uiState.regionFillStyle;
            region.lineColor = this.uiState.regionLineColor;
            region.lineThickness = this.uiState.regionLineThickness;
            region.lineStyle = this.uiState.regionLineStyle;
            this._repaintVectors();
        }
    }

    #syncCropLiveEdits(name) {
        if (name !== "regionalTargetWidth" || !this.canvasEngine) return;

        const cropBox = this.canvasEngine.getCropData();
        if (cropBox && cropBox.width > 0) {
            const zoomScale = this.uiState.regionalTargetWidth / cropBox.width;
            const calcHeight = Math.round(cropBox.height * zoomScale);
            this.uiState.regionalTargetHeight = calcHeight;

            const heightInput = this.element.querySelector('input[name="regionalTargetHeight"]');
            if (heightInput) heightInput.value = calcHeight;
        }
    }

    #bindContextPanelListeners() {
        const contextPanel = this.element.querySelector(".fwmb-context-panel");
        if (!contextPanel || contextPanel.dataset.hasNoiseListeners) return;

        contextPanel.dataset.hasNoiseListeners = "true";

        contextPanel.addEventListener("change", (event) => {
            if (event.target.matches('file-picker[name="referenceImage"]')) {
                this.uiState.referenceImage = event.target.value;
                this.#updateReferenceLayer();
                return; // Stop here for the file picker
            }
            // Route all other change events (like hitting Enter) to the handler
            this.#handleContextPanelInput(event);
        });

        contextPanel.addEventListener("input", (e) => this.#handleContextPanelInput(e));
    }

    #handleContextPanelInput(event) {
        const target = event.target;

        if ((target.type === "number" || target.type === "text") && event.type === "input") {
            return;
        }

        const name = target.name || "";

        // Skip marking dirty for temporary visual overlays
        if (!name.startsWith("reference")) this.markDirty();

        // 1. Route specific single-action updates
        if (name.startsWith("cartography")) return this.#updateCartography(target, name);
        if (name === "regionOpacity") return this.#updateRegionOpacity(target);
        if (name === "referenceAlpha") return this.#updateReferenceAlpha(target);
        if (name === "gridType" || name === "gridSize") return this.#updateGridSettings();
        if (name === "biomeAlphaActive" || name === "biomeAlphaInactive") return this.#updateBiomeAlphas();
        if (name === "contourInterval") return this.#updateContours();

        // 2. Custom biome color handler (uses dataset instead of name)
        if (target.type === "color" && target.dataset.biome) return this.#updateBiomeColor(target);

        // 3. Delegate debounced procedural map generation
        this.#routeProceduralGenerators(target);
    }

    #updateCartography(target, name) {
        let value = target.value;
        if (target.type === "checkbox") value = target.checked;
        else if (target.type === "number") value = Number(target.value);

        this.uiState[name] = value;
        this._repaintVectors();
    }

    #updateRegionOpacity(target) {
        this.uiState.regionOpacity = Number(target.value);
        this._repaintVectors();
    }

    #updateReferenceAlpha(target) {
        this.uiState.referenceAlpha = Number(target.value);
        this.#updateReferenceLayer();
    }

    #updateGridSettings() {
        MapStateManager.getMapParameters(this);
        this.#updateGrid();
    }

    #updateBiomeAlphas() {
        MapStateManager.getMapParameters(this);
        this.#updateBiomeOpacity();
    }

    #updateContours() {
        MapStateManager.getMapParameters(this);
        this._repaintCanvas();
    }

    #updateBiomeColor(target) {
        const biomeKey = target.dataset.biome;
        const hex = target.value;
        const rgb = [Number.parseInt(hex.slice(1, 3), 16), Number.parseInt(hex.slice(3, 5), 16), Number.parseInt(hex.slice(5, 7), 16)];

        if (biomeKey.startsWith("custom_")) {
            const id = Number.parseInt(biomeKey.split("_")[1]);
            const cb = this.uiState.customBiomes.find((c) => c.id === id);
            if (cb) cb.color = rgb;
        } else {
            this.customBiomeColors[biomeKey] = rgb;
        }

        this._repaintCanvas();
    }

    #routeProceduralGenerators(target) {
        if (target.matches('input[name="seaLevel"], input[name^="noise.elevation"], input[name^="noise.offsetX"], input[name^="noise.offsetY"]')) {
            this.debouncedGenerateTerrain();
        } else if (
            target.matches(
                'input[name^="noise.moisture"], input[name="globalTemp"], input[name="globalMoisture"], input[name="latTop"], input[name="latBottom"], input[name="seasonOffset"], input[name="altCooling"], input[name="freezingThreshold"]',
            )
        ) {
            this.debouncedGenerateClimate();
        } else if (target.matches('input[name="riverDensity"], input[name="maxLakeSize"], input[name="springAltOffset"], input[name="springMoistMin"], input[name="meanderJitter"]')) {
            this.debouncedGenerateFeatures();
        }
    }

    #bindCanvasCallbacks() {
        if (!this.canvasEngine) return;
        this.canvasEngine.onCanvasHover = (x, y) => {
            const isBrushActive = this.activeTool === "terrain" || this.activeTool === "biomes";
            const showCursor = this.canvasEngine.isEditMode && isBrushActive && !this.canvasEngine.isDragging;

            this.canvasEngine.updateBrushCursor(x, y, this.uiState.brushSize, showCursor);

            const readout = this.element.querySelector(".fwmb-canvas-readout");
            if (!readout) return;

            if (x === null || y === null || x < 0 || x >= this.mapWidth || y < 0 || y >= this.mapHeight || !this.currentElevationData) {
                readout.classList.add("fwmb-hidden");
                return;
            }

            readout.classList.remove("fwmb-hidden");

            const index = y * this.mapWidth + x;
            const elev = this.currentElevationData[index];
            const mois = this.currentMoistureData ? this.currentMoistureData[index] : 0;
            const temp = this.currentTemperatureData ? this.currentTemperatureData[index] : 0;
            const seaLevel = this.uiState["seaLevel"];

            const biomeKey = ProceduralEngine.getBiomeKey(elev, mois, temp, seaLevel);

            this.element.querySelector("#fwmb-readout-elev").textContent = Math.round(elev * 100) + "%";
            this.element.querySelector("#fwmb-readout-mois").textContent = Math.round(mois * 100) + "%";
            this.element.querySelector("#fwmb-readout-temp").textContent = Math.round(temp * 100) + "%";
            this.element.querySelector("#fwmb-readout-biome").textContent = game.i18n.localize(`FILRODENSWMB.BIOMES.${biomeKey}`);
        };
    }

    #applyInitialBootState() {
        if (this.hasBooted) return;

        this.hasBooted = true;
        const layerBtns = this.element.querySelectorAll('[data-action="toggleLayer"]');
        for (const btn of layerBtns) btn.classList.add("active");

        const activeWindow = this.element.ownerDocument.defaultView || window;
        activeWindow.setTimeout(async () => {
            await this.generateTerrain();
            this.isDirty = false;
        }, 50);
    }

    async close(options) {
        const canClose = await this.#gateUnsavedChanges();
        if (!canClose) return; // Abort closure entirely

        if (this.canvasEngine) this.canvasEngine.destroy();
        if (this.scene3D) this.scene3D.destroy();
        return super.close(options);
    }

    #wireBrushCallbacks() {
        this.canvasEngine.onBrushStart = (x, y) => this.#handleBrushStart(x, y);
        this.canvasEngine.onBrushMove = (x, y) => this.#handleBrushMove(x, y);
        this.canvasEngine.onBrushEnd = () => this.#handleBrushEnd();

        this.canvasEngine.onReferencePan = (dx, dy) => this.#handleReferencePan(dx, dy);
        this.canvasEngine.onReferenceScale = (factor) => this.#handleReferenceScale(factor);

        this.canvasEngine.onInfraDragStart = () => MapStateManager.pushVectorState(this);
        this.canvasEngine.onInfraDrag = () => this.#handleInfraDrag();
        this.canvasEngine.onInfraDragEnd = () => this.#handleInfraDragEnd();

        this.canvasEngine.onInfraInsertNode = (x, y) => this.#handleInfraInsertNode(x, y);
        this.canvasEngine.onInfraDeleteNode = (target) => this.#handleInfraDeleteNode(target);

        this.canvasEngine.onRightClick = () => this.#handleRightClick();
        this.canvasEngine.onDoubleClick = (hitData) => this.#handleCanvasDoubleClick(hitData);
    }

    #handleCanvasDoubleClick(hitData) {
        if (!hitData?.entityType || !hitData.entityId) return;

        const { entityType, entityId, parentType, layerId } = hitData;

        switch (entityType) {
            case "pin":
                MapDialogManager.onEditPin(this, null, null, entityId);
                break;
            case "route":
                MapDialogManager.onEditRoute(this, null, null, entityId);
                break;
            case "region":
                MapDialogManager.onEditRegion(this, null, null, { regionId: entityId, layerId });
                break;
            case "fault":
                MapDialogManager.onEditFault(this, null, null, entityId);
                break;
            case "river":
                MapDialogManager.onEditRiver(this, null, null, entityId);
                break;
            case "decoration":
                MapDialogManager.onEditDecoration(this, null, null, entityId);
                break;
            case "label":
                MapDialogManager.onEditLabel(this, null, null, { id: entityId, type: parentType, layerId });
                break;
        }
    }

    #handleRightClick() {
        let cleared = false;
        let requiresTerrainUpdate = false;

        for (const config of Object.values(FILRODENSWMB.ENTITY_CONFIG)) {
            if (config.isLayer) continue;
            if (this[config.activeKey]) {
                this[config.activeKey] = null;
                cleared = true;
                if (config.triggersTerrain) requiresTerrainUpdate = true;
            }
        }

        if (this.activeRegionId) {
            this.activeRegionId = null;
            cleared = true;
        }

        if (cleared) {
            this._repaintVectors();
            if (requiresTerrainUpdate) this.requestTerrainUpdate();
            return true;
        }
    }

    #handleBrushStart(x, y) {
        if (!this.canvasEngine.isEditMode) return;

        let layer = "terrain";
        if (this.activeTool === "biomes") layer = "biome";
        if (this.activeTool === "features") layer = "features";
        if (this.activeTool === "infrastructure") layer = "infrastructure";
        if (this.activeTool === "regions") layer = "regions";
        if (this.activeTool === "labels") layer = "labels";
        if (this.activeTool === "cartography") layer = "cartography";

        // 1. Immediately intercept vector-mode tools to bypass all raster brush logic
        if (layer === "features") {
            this.#handleFeatureClick(x, y);
            return;
        }

        if (layer === "infrastructure") {
            this.#handleInfrastructureClick(x, y);
            return;
        }

        if (layer === "regions") {
            this.#handleRegionClick(x, y);
            return;
        }

        if (layer === "labels") {
            this.#handleLabelClick(x, y);
            return;
        }

        if (layer === "cartography") return;

        // 2. Fall back to raster brush processing for Terrain and Biomes
        const stateKey = `${this.activeTool}BrushTool`;
        const tool = this.uiState[stateKey] || "raise";

        const size = this.uiState.brushSize || 20;
        const strength = this.uiState.brushStrength || 0.02;
        const feather = this.uiState.brushFeather || 0.4;
        const paintValue = layer === "biome" ? this.uiState.brushBiome || 6 : null;

        this.brushEngine.startStroke(layer, tool, size, strength, feather, paintValue);
        this.#applyBrushStroke(x, y);
    }

    #handleBrushMove(x, y) {
        this.#applyBrushStroke(x, y);

        const isBrushActive = this.activeTool === "terrain" || this.activeTool === "biomes";

        if (this.canvasEngine.isEditMode && isBrushActive) {
            this.canvasEngine.updateBrushCursor(x, y, this.uiState.brushSize, true);
        }
    }

    #handleBrushEnd() {
        const prevLength = this.brushEngine?.history?.length || 0;
        this.brushEngine.endStroke();

        if (this.brushEngine?.history?.length > prevLength) {
            this.globalHistoryLedger.push("raster");
            this.globalRedoLedger = [];
            if (this.globalHistoryLedger.length > FILRODENSWMB.LIMITS.HISTORY_MAX) {
                this.globalHistoryLedger.shift();
            }
        }

        this.markDirty();

        if (this.activeTool === "terrain" && this.manualRivers.length > 0) {
            this.pendingTerrainBounds = null;
            this.debouncedHistoryRebuild();
        }
    }

    #handleReferencePan(dx, dy) {
        this.uiState.referenceX += dx;
        this.uiState.referenceY += dy;
        this.#updateReferenceLayer();
    }

    #handleReferenceScale(factor) {
        this.uiState.referenceScale *= factor;
        this.uiState.referenceScale = Math.max(FILRODENSWMB.UI.REFERENCE_IMAGE.SCALE_MIN, Math.min(this.uiState.referenceScale, FILRODENSWMB.UI.REFERENCE_IMAGE.SCALE_MAX));
        this.render({ parts: ["context"] });
        this.#updateReferenceLayer();
    }

    #handleInfraDrag() {
        this.canvasEngine.clearInteractiveTargets();

        const isEdit = this.canvasEngine.isEditMode;
        const infraPins = this.mapPins.filter((p) => !!p.icon);

        const isInfraEdit = this.activeTool === "infrastructure" && isEdit;
        this.canvasEngine.renderInfrastructure(infraPins, this.mapRoutes, isInfraEdit, this.activeRouteId);

        const isRegionEdit = this.activeTool === "regions" && isEdit;
        this.canvasEngine.renderRegions(this.regionLayers, isRegionEdit, this.activeRegionId, this.uiState.regionOpacity);

        if (this.activeTool === "features") {
            this.canvasEngine.renderFeaturePins(this.mapPins, isEdit);

            if (this.currentRiverData?.vectors) {
                this.canvasEngine.renderProceduralRivers(this.currentRiverData.vectors, this.bufferWaterMask);
            }

            if (this.canvasEngine.renderFaultLines) {
                this.canvasEngine.renderFaultLines(this.tectonicFaults, isEdit, this.activeFaultId);
            }

            if (this.canvasEngine.renderManualRivers) {
                this.canvasEngine.renderManualRivers(this.manualRivers, isEdit, this.activeRiverId);
            }
        }

        if (this.activeTool === "labels") {
            this.canvasEngine.renderLabels(this.mapLabels, this.mapPins, this.mapRoutes, this.regionLayers, isEdit);
        }

        if (this.activeTool === "cartography" && this.canvasEngine.renderCartography) {
            this.canvasEngine.renderCartography(this.uiState, this.mapWidth, this.mapHeight, isEdit, this.mapDecorations);
        }
    }

    #handleInfraDragEnd() {
        this.render({ parts: ["context"] });
        this.markDirty();

        if (this.activeTool === "features") {
            this.requestTerrainUpdate();
        }
    }

    #handleInfraInsertNode(x, y) {
        if (!["infrastructure", "regions", "features"].includes(this.activeTool)) return;
        if (x < 0 || x > this.mapWidth || y < 0 || y > this.mapHeight) return;

        // 1. Prevent inserting a node inside an existing marker/node
        if (this.#isNearExistingNode(x, y)) return;

        // 2. Find the closest segment to split across all active layers
        const match = this.#findClosestSegment(x, y);
        if (!match) return; // Replaces your redundant returns!

        // 3. Execute the insertion universally
        MapStateManager.pushVectorState(this);
        match.vector.points.splice(match.insertIndex, 0, { x: match.projX, y: match.projY });

        this._repaintVectors();
        if (match.triggersTerrain) this.requestTerrainUpdate();

        this.render({ parts: ["context"] });
        this.markDirty();
    }

    #isNearExistingNode(x, y) {
        const isNear = (pt) => Math.hypot(pt.x - x, pt.y - y) < this.currentSnapThreshold;

        // Check Routes
        if (this.mapRoutes.some((route) => route.points.some(isNear))) return true;

        // Check Pins
        return this.mapPins.some((pin) => pin.visibility !== "none" && pin.icon && isNear(pin));
    }

    #findClosestSegment(x, y) {
        let bestMatch = null;

        // Check Generic Vectors (Routes, Rivers, Faults)
        for (const config of Object.values(FILRODENSWMB.ENTITY_CONFIG)) {
            if (config.toolCategory !== this.activeTool) continue;

            const segment = SpatialMath.getClosestVectorSegment(this[config.stateKey], x, y, this.currentSnapThreshold);
            if (segment && (!bestMatch || segment.dist < bestMatch.dist)) {
                bestMatch = {
                    vector: segment.vector,
                    insertIndex: segment.insertIndex,
                    projX: segment.projX,
                    projY: segment.projY,
                    dist: segment.dist,
                    triggersTerrain: config.triggersTerrain,
                };
            }
        }

        // Check Region Vectors
        if (this.activeTool === "regions") {
            const regionSegment = SpatialMath.getClosestRegionSegment(this.regionLayers, this.activeRegionId, x, y, this.currentSnapThreshold);
            if (regionSegment && (!bestMatch || regionSegment.dist < bestMatch.dist)) {
                bestMatch = {
                    vector: regionSegment.region, // Map 'region' to 'vector' for universal handling
                    insertIndex: regionSegment.insertIndex,
                    projX: regionSegment.projX,
                    projY: regionSegment.projY,
                    dist: regionSegment.dist,
                    triggersTerrain: false,
                };
            }
        }

        return bestMatch;
    }

    #handleInfraDeleteNode(target) {
        if (!["infrastructure", "regions", "features"].includes(this.activeTool)) return;
        if (target.icon && this.activeTool !== "infrastructure") return;

        // 1. Locate the target and its specific deletion instructions
        const match = this.#findNodeToDelete(target);
        if (!match) return;

        // 2. Execute the deletion universally
        MapStateManager.pushVectorState(this);

        match.array.splice(match.index, 1);
        if (match.cleanup) match.cleanup();

        // 3. Cascade updates
        if (match.repaintCanvas) this._repaintCanvas();
        else this._repaintVectors();

        if (match.triggersTerrain) {
            this.requestTerrainUpdate();
        } else if (match.triggersClimate) {
            this.debouncedCanvasClimate();
        }

        this.render({ parts: ["context"] });
        this.markDirty();
    }

    #findNodeToDelete(target) {
        // 1. Check Pins (Springs or Icons)
        const pinIndex = this.mapPins.indexOf(target);
        if (pinIndex > -1) {
            const isFeaturePin = this.activeTool === "features" && ["spring", "block_spring"].includes(target.type);
            const isInfraPin = this.activeTool === "infrastructure" && target.icon;

            if (isFeaturePin) {
                return { array: this.mapPins, index: pinIndex, triggersClimate: true, repaintCanvas: true };
            }
            if (isInfraPin) {
                return { array: this.mapPins, index: pinIndex };
            }
        }

        // 2. Check Generic Vectors (Routes, Faults, Rivers)
        for (const config of Object.values(FILRODENSWMB.ENTITY_CONFIG)) {
            if (config.toolCategory !== this.activeTool) continue;

            const vectorArray = this[config.stateKey];
            const vIndex = vectorArray.findIndex((v) => v.points.includes(target));

            if (vIndex > -1) {
                const vector = vectorArray[vIndex];
                return {
                    array: vector.points,
                    index: vector.points.indexOf(target),
                    triggersTerrain: config.triggersTerrain,
                    cleanup: () => {
                        // Orphan cleanup: destroy the vector if it has fewer than 2 points
                        if (vector.points.length < 2) {
                            vectorArray.splice(vIndex, 1);
                            if (this[config.activeKey] === vector.id) this[config.activeKey] = null;
                        }
                    },
                };
            }
        }

        // 3. Check Regions
        if (this.activeTool === "regions") {
            for (const layer of this.regionLayers) {
                const rIndex = layer.regions.findIndex((r) => r.points.includes(target));

                if (rIndex > -1) {
                    const region = layer.regions[rIndex];
                    return {
                        array: region.points,
                        index: region.points.indexOf(target),
                        cleanup: () => {
                            // Orphan cleanup: destroy region if it has fewer than 3 points (unless actively drawing)
                            if (region.points.length < 3 && this.activeRegionId !== region.id) {
                                layer.regions.splice(rIndex, 1);
                            }
                        },
                    };
                }
            }
        }

        return null;
    }

    #handleFeatureClick(x, y) {
        if (x < 0 || x > this.mapWidth || y < 0 || y > this.mapHeight) return;

        MapStateManager.pushVectorState(this);
        const finalPos = { x, y };
        let activeEntity = null;

        if (this.uiState.activeFeatureMode === "spring") {
            this.mapPins.push({
                id: foundry.utils.randomID(),
                name: "River Source",
                x: finalPos.x,
                y: finalPos.y,
                type: "spring",
                radius: 6,
                visibility: "all",
                color: "#ffffff",
            });
            this._repaintCanvas();
            this.debouncedCanvasClimate();
        } else if (this.uiState.activeFeatureMode === "fault") {
            activeEntity = this.activeFaultId ? this.tectonicFaults.find((f) => f.id === this.activeFaultId) : null;
            const oldBounds = SpatialMath.getVectorBounds(activeEntity);
            if (this.activeFaultId) {
                const fault = this.tectonicFaults.find((f) => f.id === this.activeFaultId);
                if (fault) fault.points.push(finalPos);
            } else {
                this.activeFaultId = foundry.utils.randomID();
                this.tectonicFaults.push({
                    id: this.activeFaultId,
                    name: `Fault ${this.tectonicFaults.length + 1}`,
                    description: "",
                    points: [finalPos],
                    type: this.uiState.faultType,
                    thickness: this.uiState.faultThickness,
                    strength: this.uiState.faultStrength,
                    color: FILRODENSWMB.TECTONICS?.COLORS?.[this.uiState.faultType] || 0xffffff,
                    visibility: "all",
                });
            }
            activeEntity = this.tectonicFaults.find((f) => f.id === this.activeFaultId);
            const newBounds = SpatialMath.getVectorBounds(activeEntity);
            this._repaintVectors();
            this.requestTerrainUpdate(SpatialMath.mergeBounds(oldBounds, newBounds));
        } else if (this.uiState.activeFeatureMode === "river") {
            activeEntity = this.activeRiverId ? this.manualRivers.find((r) => r.id === this.activeRiverId) : null;
            const oldBounds = SpatialMath.getVectorBounds(activeEntity);
            if (this.activeRiverId) {
                const river = this.manualRivers.find((r) => r.id === this.activeRiverId);
                if (river) river.points.push(finalPos);
            } else {
                this.activeRiverId = foundry.utils.randomID();
                this.manualRivers.push({
                    id: this.activeRiverId,
                    name: `Manual River ${this.manualRivers.length + 1}`,
                    points: [finalPos],
                    width: this.uiState.riverWidth,
                    visibility: "all",
                });
            }
            activeEntity = this.manualRivers.find((r) => r.id === this.activeRiverId);
            const newBounds = SpatialMath.getVectorBounds(activeEntity);
            this._repaintVectors();
            this.requestTerrainUpdate(SpatialMath.mergeBounds(oldBounds, newBounds));
        }

        this.render({ parts: ["context"] });
        this.markDirty();
    }

    #updateBiomeOpacity() {
        if (!this.canvasEngine) return;
        const isActive = this.activeTool === "biomes";
        const alpha = isActive ? this.uiState.biomeAlphaActive : this.uiState.biomeAlphaInactive;
        this.canvasEngine.setBiomeOpacity(alpha);
    }

    #updateGrid() {
        if (!this.canvasEngine) return;
        this.canvasEngine.drawGrid(this.uiState.gridType, this.uiState.gridSize, this.uiState.gridVisible);
    }

    async _repaintCanvas(bounds = null) {
        if (!this.currentElevationData) return;

        // If repainting the FULL map, recalculate the true peak for accurate contrast
        if (!bounds || !this.cachedMaxElevation) {
            this.cachedMaxElevation = 0;
            for (let i = 0; i < this.mapWidth * this.mapHeight; i++) {
                if (this.currentElevationData[i] > this.cachedMaxElevation) {
                    this.cachedMaxElevation = this.currentElevationData[i];
                }
            }
        }

        const seaLevel = this.uiState["seaLevel"];
        const { currentSeed, params } = MapStateManager.getMapParameters(this);
        const engine = new ProceduralEngine(currentSeed);
        const waterMask = this.bufferWaterMask;

        engine.createBaseMap(this.currentElevationData, this.mapWidth, this.mapHeight, seaLevel, this.bufferBase, bounds);
        this.canvasEngine.renderPixelBuffer("base", this.bufferBase, this.mapWidth, this.mapHeight);

        const baseBtn = this.element.querySelector('[data-layer="base"]');
        this.canvasEngine.toggleLayer("base", baseBtn ? baseBtn.classList.contains("active") : true);

        // Pass the cached peak into the coloriser
        const maxPeak = this.cachedMaxElevation || 1.0;
        engine.colorize(this.currentElevationData, this.currentTemperatureData, this.mapWidth, this.mapHeight, seaLevel, waterMask, params, this.bufferTopography, bounds, maxPeak);
        this.canvasEngine.renderPixelBuffer("topography", this.bufferTopography, this.mapWidth, this.mapHeight);

        const topoBtn = this.element.querySelector('[data-layer="topography"]');
        this.canvasEngine.toggleLayer("topography", topoBtn ? topoBtn.classList.contains("active") : true);

        if (this.currentMoistureData && this.currentTemperatureData) {
            engine.createBiomesMap(
                this.currentElevationData,
                this.currentMoistureData,
                this.currentTemperatureData,
                this.currentBiomeOverrides,
                this.mapWidth,
                this.mapHeight,
                seaLevel,
                waterMask,
                params,
                this.bufferBiomes,
                bounds,
            );
            this.canvasEngine.renderPixelBuffer("biomes", this.bufferBiomes, this.mapWidth, this.mapHeight);

            const biomesBtn = this.element.querySelector('[data-layer="biomes"]');
            this.canvasEngine.toggleLayer("biomes", biomesBtn ? biomesBtn.classList.contains("active") : true);
        }

        const contourInterval = this.uiState["contourInterval"];
        engine.createContourMap(this.currentElevationData, this.mapWidth, this.mapHeight, contourInterval, seaLevel, this.bufferContours, bounds);
        this.canvasEngine.renderPixelBuffer("contours", this.bufferContours, this.mapWidth, this.mapHeight);

        if (this.canvasEngine) {
            this.canvasEngine.clearInteractiveTargets();
        }

        this._repaintVectors();
    }

    _repaintVectors() {
        if (!this.canvasEngine) return;

        this.canvasEngine.clearInteractiveTargets();
        const isEditModeActive = this.canvasEngine.isEditMode;

        // 1. Render Rivers, Springs & Faults
        const showPins = this.activeTool === "features" && isEditModeActive;
        this.canvasEngine.renderFeaturePins(this.mapPins, showPins);

        if (this.currentRiverData?.vectors) {
            this.canvasEngine.renderProceduralRivers(this.currentRiverData.vectors, this.bufferWaterMask);
        }

        if (this.canvasEngine.renderFaultLines) {
            const isFaultEdit = this.activeTool === "features" && isEditModeActive;
            this.canvasEngine.renderFaultLines(this.tectonicFaults, isFaultEdit, this.activeFaultId);
        }

        if (this.canvasEngine.renderManualRivers) {
            const isRiverEdit = this.activeTool === "features" && isEditModeActive;
            this.canvasEngine.renderManualRivers(this.manualRivers, isRiverEdit, this.activeRiverId);
        }

        // 2. Render Infrastructure
        const isInfraEdit = this.activeTool === "infrastructure" && isEditModeActive;
        const infraPins = this.mapPins.filter((p) => !!p.icon);
        this.canvasEngine.renderInfrastructure(infraPins, this.mapRoutes, isInfraEdit, this.activeRouteId);

        // 3. Render Regions
        const isRegionEdit = this.activeTool === "regions" && isEditModeActive;
        this.canvasEngine.renderRegions(this.regionLayers, isRegionEdit, this.activeRegionId, this.uiState.regionOpacity);

        // 4. Render Labels
        const isLabelEdit = this.activeTool === "labels" && isEditModeActive;
        this.canvasEngine.renderLabels(this.mapLabels, this.mapPins, this.mapRoutes, this.regionLayers, isLabelEdit);

        // 5. Render Cartography
        const isCartographyEdit = this.activeTool === "cartography" && isEditModeActive;
        if (this.canvasEngine.renderCartography) {
            this.canvasEngine.renderCartography(this.uiState, this.mapWidth, this.mapHeight, isCartographyEdit, this.mapDecorations);
        }
    }

    #applyBrushStroke(x, y) {
        if (!this.currentElevationData) return;

        const seaLevel = this.uiState["seaLevel"];
        const strokeBounds = this.brushEngine.applyBrush(x, y, this.currentElevationData, this.currentBiomeOverrides, this.currentSpringOverrides, seaLevel);

        if (!strokeBounds) return;

        // Accumulate the bounds for the deferred procedural generation
        this.pendingTerrainBounds = SpatialMath.mergeBounds(this.pendingTerrainBounds, strokeBounds);

        // Biome overrides do not alter topography or climate math.
        if (this.activeTool === "biomes") {
            const { currentSeed, params } = MapStateManager.getMapParameters(this);
            const engine = new ProceduralEngine(currentSeed);

            engine.createBiomesMap(
                this.currentElevationData,
                this.currentMoistureData,
                this.currentTemperatureData,
                this.currentBiomeOverrides,
                this.mapWidth,
                this.mapHeight,
                seaLevel,
                this.bufferWaterMask,
                params,
                this.bufferBiomes,
                this.pendingTerrainBounds,
            );

            this.canvasEngine.renderPixelBuffer("biomes", this.bufferBiomes, this.mapWidth, this.mapHeight);
            this.pendingTerrainBounds = null;
            return;
        }

        this._repaintCanvas(strokeBounds);
        if (this.activeTool === "terrain" && this.manualRivers.length > 0) {
            this.debouncedHistoryRebuild();
        } else {
            this.debouncedCanvasClimate();
        }
    }

    async #rebuildFromHistory(showUI = false) {
        const { currentSeed, params } = MapStateManager.getMapParameters(this);
        const engine = new ProceduralEngine(currentSeed);

        // 1. Conditionally trigger the UI overlay
        if (showUI) {
            await this.#startProcessing(game.i18n.localize("FILRODENSWMB.UI.RebuildingHistory"));
        }

        try {
            // 2. Instant global array copy
            this.currentElevationData.set(this.baseElevationData);
            this.currentBiomeOverrides.fill(0);

            // 3. Global history replay
            this.brushEngine.replayHistory(this.currentElevationData, this.currentBiomeOverrides, params.seaLevel);

            // 4. Global river carving
            if (this.manualRivers && this.manualRivers.length > 0) {
                HydrologyEngine.carveManualRivers(this.currentElevationData, this.mapWidth, this.mapHeight, this.manualRivers, engine.simplex, params.seaLevel);
            }
        } finally {
            // 5. Conditionally clear the UI overlay
            if (showUI) {
                this.#endProcessing();
            }
        }
    }

    async generateTerrain() {
        const { currentSeed, params } = MapStateManager.getMapParameters(this);
        const engine = new ProceduralEngine(currentSeed);

        // Clear the accumulator so it doesn't linger
        this.pendingTerrainBounds = null;

        await this.#startProcessing(game.i18n.localize("FILRODENSWMB.UI.GeneratingTopography") || "Generating Topography...");

        try {
            console.log("World Map Builder | Generating Topography...");
            const t0 = performance.now();

            engine.generateTopography(this.mapWidth, this.mapHeight, params, this.baseElevationData, this.tectonicFaults, [], null);
            await this.#rebuildFromHistory();

            this.currentSpringOverrides.fill(0);

            const t1 = performance.now();
            console.log(`World Map Builder | Topography generated in ${(t1 - t0).toFixed(2)}ms`);

            await this.generateClimate(null);
        } finally {
            this.#endProcessing();
        }
    }

    async generateClimate(bounds = null) {
        if (!this.currentElevationData) return;
        const { currentSeed, params } = MapStateManager.getMapParameters(this);
        const engine = new ProceduralEngine(currentSeed);

        let activeBounds = bounds || this.pendingTerrainBounds;

        // Dynamically scale the wind distance relative to a baseline map resolution and map scale
        if (activeBounds) {
            const baseWind = params.climate?.windDistance ?? FILRODENSWMB.CLIMATE.WIND_DISTANCE;
            const widthScale = this.mapWidth / FILRODENSWMB.LIMITS.BASELINE_DIMENSION;

            const latTop = params.latTop ?? 90;
            const latBottom = params.latBottom ?? -90;
            const latRange = Math.max(0.1, Math.abs(latTop - latBottom)); // Prevent Infinity
            const latScale = 180 / latRange;

            const dynamicWindDistance = Math.round(baseWind * widthScale * latScale);

            activeBounds = SpatialMath.padBounds(activeBounds, dynamicWindDistance, 0, this.mapWidth, this.mapHeight);
        }

        if (!bounds && this.pendingTerrainBounds) {
            this.pendingTerrainBounds = null;
        }

        await this.#startProcessing(game.i18n.localize("FILRODENSWMB.UI.GeneratingClimate") || "Generating Climate...");

        try {
            console.log("World Map Builder | Generating Climate Data...");
            const t0 = performance.now();

            engine.generateClimateData(this.currentElevationData, this.mapWidth, this.mapHeight, params, this.currentMoistureData, this.currentTemperatureData, activeBounds);

            const t1 = performance.now();
            console.log(`World Map Builder | Climate mapped in ${(t1 - t0).toFixed(2)}ms`);

            await this.generateFeatures(activeBounds);
        } finally {
            this.#endProcessing();
        }
    }

    async generateFeatures(bounds = null) {
        if (!this.currentElevationData) return;
        const { currentSeed, params } = MapStateManager.getMapParameters(this);
        const engine = new ProceduralEngine(currentSeed);

        await this.#startProcessing(game.i18n.localize("FILRODENSWMB.UI.GeneratingFeatures") || "Generating Features...");

        try {
            console.log("World Map Builder | Generating Features...");
            const t0 = performance.now();

            // Bake procedural springs into permanent pins on first load or new map generation
            if (!this.uiState.springsBaked) {
                const newSprings = engine.bakeProceduralSprings(this.currentElevationData, this.currentMoistureData, this.mapWidth, this.mapHeight, params);
                for (const s of newSprings) {
                    this.mapPins.push({
                        id: foundry.utils.randomID(),
                        name: "River Source",
                        x: s.x,
                        y: s.y,
                        type: "spring",
                        radius: 6,
                        visibility: "all",
                    });
                }
                this.uiState.springsBaked = true;
                this.markDirty();
            }

            const dynamicPins = [...this.mapPins];

            // Ensure procedural water spawns exactly at the highest point of our manual carve
            const manualSprings = HydrologyEngine.getRiverSources(this.currentElevationData, this.mapWidth, this.manualRivers);
            dynamicPins.push(...manualSprings);

            this.currentRiverData = engine.generateRivers(
                this.currentElevationData,
                this.currentMoistureData,
                this.currentTemperatureData,
                dynamicPins,
                this.mapWidth,
                this.mapHeight,
                params,
                this.bufferRiverMap,
                this.bufferWaterMask,
            );

            const t1 = performance.now();
            console.log(`World Map Builder | Features generated in ${(t1 - t0).toFixed(2)}ms`);

            await this._repaintCanvas(bounds); // Cascade to final render
        } finally {
            this.#endProcessing();
        }
    }

    async #ingestMapPayload(rawPayload) {
        // Deep clone to sever the connection to Foundry's memory cache
        const payload = foundry.utils.deepClone(rawPayload);

        this.uiState.mapSeed = payload.seed;
        this.currentParentId = payload.parentId || null;

        this.mapWidth = payload.mapWidth;
        this.mapHeight = payload.mapHeight;

        this.uiState.mapWidth = this.mapWidth;
        this.uiState.mapHeight = this.mapHeight;
        this.uiState.gridType = payload.gridType || "square";
        this.uiState.gridSize = payload.gridSize || 100;
        this.uiState.gridVisible = payload.gridVisible ?? false;

        MapStateManager.allocateBuffers(this);

        this.brushEngine = new BrushEngine(this.mapWidth, this.mapHeight);

        const p = payload.params;
        const c = p.cartography || {};

        this.uiState.seaLevel = p.seaLevel;
        this.uiState.globalTemp = p.globalTemp;
        this.uiState.seasonOffset = p.seasonOffset;
        this.uiState.latTop = p.latTop;
        this.uiState.latBottom = p.latBottom;
        this.uiState.globalMoisture = p.globalMoisture;
        this.uiState.riverDensity = p.riverDensity;
        this.uiState.springsBaked = payload.springsBaked ?? false;

        this.uiState["noise.offsetX"] = p.noise.offsetX;
        this.uiState["noise.offsetY"] = p.noise.offsetY;
        this.uiState["noise.moistureOffset"] = p.noise.moistureOffset ?? 10000;
        this.uiState["noise.tempOffset"] = p.noise.tempOffset ?? 20000;
        this.uiState.windDistance = p.climate?.windDistance ?? 40;
        this.uiState["noise.elevation.scale"] = 1 / p.noise.elevation.scale;
        this.uiState["noise.elevation.octaves"] = p.noise.elevation.octaves;
        this.uiState["noise.elevation.stretch"] = p.noise.elevation.stretch;
        this.uiState["noise.moisture.scale"] = 1 / p.noise.moisture.scale;
        this.uiState["noise.moisture.octaves"] = p.noise.moisture.octaves;

        this.uiState["noise.temperature.scale"] = p.noise.temperature?.scale ? 1 / p.noise.temperature.scale : FILRODENSWMB.NOISE.TEMPERATURE.SCALE;

        this.uiState.customBiomes = payload.customBiomes || [];
        this.uiState.customRouteStyles = payload.customRouteStyles || [];
        this.uiState.customLabelStyles = payload.customLabelStyles || [];

        this.uiState.maxLakeSize = p.hydrology?.maxLakeSize ?? FILRODENSWMB.HYDROLOGY.MAX_LAKE_SIZE;
        this.uiState.springAltOffset = p.hydrology?.springAltOffset ?? FILRODENSWMB.HYDROLOGY.SPRING_ALTITUDE_OFFSET;
        this.uiState.springMoistMin = p.hydrology?.springMoistMin ?? FILRODENSWMB.HYDROLOGY.SPRING_MOISTURE_MIN;
        this.uiState.meanderJitter = p.hydrology?.meanderJitter ?? FILRODENSWMB.HYDROLOGY.MEANDER_JITTER;
        this.uiState.altCooling = p.climate?.altCooling ?? FILRODENSWMB.CLIMATE.ALTITUDE_COOLING;
        this.uiState.freezingThreshold = p.climate?.freezingThreshold ?? FILRODENSWMB.CLIMATE.FREEZING_THRESHOLD;
        this.uiState.contourInterval = p.display?.contourInterval ?? 0.1;
        this.uiState.biomeAlphaActive = p.display?.biomeAlphaActive ?? FILRODENSWMB.DISPLAY.BIOME_ALPHA_ACTIVE;
        this.uiState.biomeAlphaInactive = p.display?.biomeAlphaInactive ?? FILRODENSWMB.DISPLAY.BIOME_ALPHA_INACTIVE;
        this.uiState.cartographyScaleEnable = c.scaleEnable ?? this.defaultUiState.cartographyScaleEnable;
        this.uiState.cartographyScaleUnits = c.scaleUnits ?? this.defaultUiState.cartographyScaleUnits;
        this.uiState.cartographyScaleInterval = c.scaleInterval ?? this.defaultUiState.cartographyScaleInterval;
        this.uiState.cartographyScaleValue = c.scaleValue ?? this.defaultUiState.cartographyScaleValue;
        this.uiState.cartographyScaleMajorTicks = c.scaleMajorTicks ?? this.defaultUiState.cartographyScaleMajorTicks;
        this.uiState.cartographyScaleMinorTicks = c.scaleMinorTicks ?? this.defaultUiState.cartographyScaleMinorTicks;
        this.uiState.cartographyScaleX = c.scaleX ?? this.defaultUiState.cartographyScaleX;
        this.uiState.cartographyScaleY = c.scaleY ?? this.defaultUiState.cartographyScaleY;
        this.uiState.cartographyBorderEnable = c.borderEnable ?? this.defaultUiState.cartographyBorderEnable;
        this.uiState.cartographyBorderStyle = c.borderStyle ?? this.defaultUiState.cartographyBorderStyle;
        this.uiState.cartographyBorderColor = c.borderColor ?? this.defaultUiState.cartographyBorderColor;

        // Legacy Visibility Migration
        const migrateVisibility = (arr) => {
            arr.forEach((item) => {
                if (item.hidden !== undefined) {
                    item.visibility = item.hidden ? "none" : "all";
                    delete item.hidden; // Clean up old data
                }
                if (item.label?.hidden !== undefined) {
                    item.label.visibility = item.label.hidden ? "none" : "all";
                    delete item.label.hidden;
                }
            });
        };

        if (payload.mapPins) migrateVisibility(payload.mapPins);

        if (payload.mapRoutes) {
            migrateVisibility(payload.mapRoutes);
            payload.mapRoutes.forEach((route) => {
                if (!route.quickStyle) route.quickStyle = "custom"; // Flag old routes as custom overrides

                // Heal legacy routes missing visual properties
                route.color = route.color || "#ffffff";
                route.thickness = route.thickness || 3;
                route.style = route.style || "solid";
            });
        }

        if (payload.mapLabels) migrateVisibility(payload.mapLabels);

        if (payload.mapDecorations) migrateVisibility(payload.mapDecorations);

        if (payload.regionLayers) {
            payload.regionLayers.forEach((layer) => {
                if (layer.hidden !== undefined) {
                    layer.visibility = layer.hidden ? "none" : "all";
                    delete layer.hidden;
                }
                if (layer.regions) migrateVisibility(layer.regions);
            });
        }

        this.customBiomeColors = p.customColors || {};

        this.tectonicFaults = payload.tectonicFaults || [];

        this.manualRivers = payload.manualRivers || [];
        if (payload.manualRivers) {
            payload.manualRivers.forEach((river) => {
                if (river.hidden !== undefined) {
                    river.visibility = river.hidden ? "none" : "all";
                    delete river.hidden;
                }
            });
        }

        // Guarantee every pin has a valid color property, defaulting to white for legacy maps
        this.mapPins = (payload.mapPins || []).map((pin) => {
            pin.color = pin.color || "#ffffff";
            return pin;
        });

        this.mapRoutes = payload.mapRoutes || [];
        this.regionLayers = payload.regionLayers || [];
        this.mapLabels = payload.mapLabels || [];
        this.mapDecorations = payload.mapDecorations || [];

        this.brushEngine.history = payload.history || [];
        this.brushEngine.redoStack = [];
        this.pinHistory = [];
        this.pinRedoStack = [];
        this.globalHistoryLedger = this.brushEngine.history.map(() => "raster");
        this.globalRedoLedger = [];

        this.defaultUiState = foundry.utils.deepClone(this.uiState);

        this.render({ parts: ["toolbar", "context"] });
        this.#updateGrid();

        await this.generateTerrain();
        this.canvasEngine.resetCamera();
    }

    #handleInfrastructureClick(x, y) {
        if (x < 0 || x > this.mapWidth || y < 0 || y > this.mapHeight) return;

        MapStateManager.pushVectorState(this);

        const finalPos = { x, y };

        if (this.uiState.activeInfraMode === "pin") {
            const newPin = {
                id: foundry.utils.randomID(),
                name: game.i18n.localize(FILRODENSWMB.INFRASTRUCTURE_ICONS[this.uiState.activeIcon] || "Pin"),
                icon: this.uiState.activeIcon,
                x: finalPos.x,
                y: finalPos.y,
                scale: this.uiState.pinScale ?? FILRODENSWMB.PINS?.DEFAULT_SCALE ?? 1,
                visibility: "all",
                color: this.uiState.pinColor || "#ffffff",
                label: {
                    fontSize: this.uiState.pinScale ?? 1,
                },
            };
            this.mapPins.push(newPin);
        } else if (this.uiState.activeInfraMode === "route") {
            if (this.activeRouteId) {
                const route = this.mapRoutes.find((r) => r.id === this.activeRouteId);
                if (route) route.points.push(finalPos);
            } else {
                this.activeRouteId = foundry.utils.randomID();
                const newRoute = {
                    id: this.activeRouteId,
                    name: `Route ${this.mapRoutes.length + 1}`,
                    points: [finalPos],
                    quickStyle: this.uiState.activeRouteQuickStyle,
                    color: this.uiState.routeColor,
                    thickness: this.uiState.routeThickness,
                    style: this.uiState.routeStyle,
                    visibility: "all",
                    label: {
                        visibility: "none",
                        fontSize: 0.5,
                    },
                };
                this.mapRoutes.push(newRoute);
            }
        }

        this._repaintVectors();
        this.render({ parts: ["context"] });
        this.markDirty();
    }

    #handleLabelClick(x, y) {
        if (x < 0 || x > this.mapWidth || y < 0 || y > this.mapHeight) return;

        MapStateManager.pushVectorState(this);
        this.mapLabels.push({
            id: foundry.utils.randomID(),
            name: this.uiState.nextLabelText || "New Label",
            x: x,
            y: y,
            rotation: 0,
            quickStyle: this.uiState.activeLabelQuickStyle,
            fontFamily: this.uiState.labelFontFamily,
            fontSize: this.uiState.labelFontSize,
            fillColor: this.uiState.labelFillColor,
            maxWidth: this.uiState.labelMaxWidth,
            justify: this.uiState.labelJustify,
            visibility: "all",
        });

        this._repaintVectors();
        this.render({ parts: ["context"] });
        this.markDirty();
    }

    #updateReferenceLayer() {
        if (this.canvasEngine) {
            this.canvasEngine.updateReferenceImage(this.uiState.referenceImage, this.uiState.referenceX, this.uiState.referenceY, this.uiState.referenceScale, this.uiState.referenceAlpha);
        }
    }

    #handleRegionClick(x, y) {
        if (x < 0 || x > this.mapWidth || y < 0 || y > this.mapHeight) return;

        if (!this.activeRegionLayerId) {
            ui.notifications.warn(game.i18n.localize("FILRODENSWMB.UI.WarnNoRegionLayer") || "Please create or select a Region Layer first.");
            return;
        }

        const layer = this.regionLayers.find((l) => l.id === this.activeRegionLayerId);
        if (!layer) return;

        MapStateManager.pushVectorState(this);

        const finalPos = { x, y };

        if (this.activeRegionId) {
            const region = layer.regions.find((r) => r.id === this.activeRegionId);
            if (region) {
                const isNearStart = region.points.length > 2 && Math.hypot(region.points[0].x - finalPos.x, region.points[0].y - finalPos.y) < this.currentSnapThreshold;

                if (isNearStart) {
                    this.activeRegionId = null;
                } else {
                    region.points.push(finalPos);
                }
            }
        } else {
            this.activeRegionId = foundry.utils.randomID();
            layer.regions.push({
                id: this.activeRegionId,
                name: `Region ${layer.regions.length + 1}`,
                description: "",
                points: [finalPos],
                fillColor: this.uiState.regionFillColor,
                fillStyle: this.uiState.regionFillStyle,
                lineColor: this.uiState.regionLineColor,
                lineThickness: this.uiState.regionLineThickness,
                lineStyle: this.uiState.regionLineStyle,
                smoothing: this.uiState.regionSmoothing,
                visibility: "all",
            });
        }

        this._repaintVectors();
        this.render({ parts: ["context"] });
        this.markDirty();
    }

    /**
     * Intercepts destructive actions if the map state is dirty.
     * Returns true if the user saved or discarded changes; returns false if they cancelled.
     */
    async #gateUnsavedChanges() {
        if (!this.isDirty) return true;

        const choice = await foundry.applications.api.DialogV2.wait({
            window: { title: game.i18n.localize("FILRODENSWMB.UI.Warning") },
            content: `<p>${game.i18n.localize("FILRODENSWMB.UI.UnsavedChangesWarning")}</p>`,
            buttons: [
                { action: "save", label: game.i18n.localize("FILRODENSWMB.UI.Save"), icon: "fwmb-icon save", default: true },
                { action: "discard", label: game.i18n.localize("FILRODENSWMB.UI.Discard"), icon: "fwmb-icon delete" },
                { action: "cancel", label: game.i18n.localize("FILRODENSWMB.UI.Cancel"), icon: "fwmb-icon cancel" },
            ],
            close: () => "cancel",
        });

        if (choice === "cancel") return false;

        if (choice === "save") {
            const saved = await this.saveCurrentMap();
            if (!saved) return false;
        }

        if (choice === "discard") {
            this.isDirty = false;
        }

        const activeWindow = this.element.ownerDocument.defaultView || window;
        await new Promise((resolve) => activeWindow.setTimeout(resolve, 250));

        return true;
    }

    /**
     * Context-aware Quick Save.
     * Creates a new journal if none exists, otherwise overwrites the current ID.
     */
    async saveCurrentMap() {
        if (this.isSaving) return false;
        this.isSaving = true;

        let mapName = this.currentSaveName;

        try {
            // 1. Prompt the user BEFORE locking the UI
            if (!this.currentSaveId) {
                const { currentSeed } = MapStateManager.getMapParameters(this);
                const hash = currentSeed || Math.random().toString(36).substring(2, 8).toUpperCase();
                const defaultName = `Terrain Map (${hash})`;

                mapName = await MapDialogManager._promptTextValue(game.i18n.localize("FILRODENSWMB.UI.SaveAs"), game.i18n.localize("FILRODENSWMB.UI.Name"), defaultName);

                if (!mapName) return false; // User cancelled the save prompt
            }

            // 2. Lock the UI and show the spinner
            await this.#startProcessing(game.i18n.localize("FILRODENSWMB.UI.SavingMap") || "Saving Map...");
            this.currentSaveName = mapName;

            const { currentSeed, params } = MapStateManager.getMapParameters(this);
            const payload = {
                seed: currentSeed,
                springsBaked: this.uiState.springsBaked,
                mapWidth: this.mapWidth,
                mapHeight: this.mapHeight,
                gridType: this.uiState.gridType,
                gridSize: this.uiState.gridSize,
                gridVisible: this.uiState.gridVisible,
                params: params,
                customBiomes: this.uiState.customBiomes,
                customRouteStyles: this.uiState.customRouteStyles,
                customLabelStyles: this.uiState.customLabelStyles,
                history: this.brushEngine?.history || [],
                tectonicFaults: this.tectonicFaults,
                manualRivers: this.manualRivers,
                mapPins: this.mapPins,
                mapRoutes: this.mapRoutes,
                regionLayers: this.regionLayers,
                mapLabels: this.mapLabels,
                mapDecorations: this.mapDecorations,
                parentId: this.currentParentId,
            };

            const journal = await saveMapData(this.currentSaveName, payload, this.currentSaveId);

            if (journal) {
                this.currentSaveId = journal.id;
                this.isDirty = false; // Successfully saved, map is no longer dirty
                ui.notifications.info(game.i18n.format("FILRODENSWMB.UI.SaveSuccess", { name: journal.name }));
                this.render({ parts: ["toolbar"] });
                return true;
            } else {
                ui.notifications.error(game.i18n.localize("FILRODENSWMB.UI.SaveError"));
                return false;
            }
        } finally {
            this.isSaving = false;
            this.#endProcessing();
        }
    }

    /**
     * Spawns the processing overlay and forces the browser to paint the DOM
     * before executing the next synchronous JavaScript operation.
     */
    async #startProcessing(message) {
        this.processingTasks = (this.processingTasks || 0) + 1;

        const overlay = this.element.querySelector(".fwmb-processing-overlay");
        if (overlay) {
            const textEl = overlay.querySelector(".fwmb-processing-text");
            if (textEl) textEl.textContent = message;
            overlay.classList.remove("fwmb-hidden");
        }

        // Force browser to paint the DOM before locking the main thread
        const activeWindow = this.element.ownerDocument.defaultView || window;
        await new Promise((resolve) => activeWindow.requestAnimationFrame(() => activeWindow.setTimeout(resolve, 0)));
    }

    /**
     * Decrements the active task counter, hiding the overlay only when all chained tasks are complete.
     */
    #endProcessing() {
        this.processingTasks = Math.max(0, (this.processingTasks || 0) - 1);
        if (this.processingTasks > 0) return;

        const overlay = this.element.querySelector(".fwmb-processing-overlay");
        if (overlay) overlay.classList.add("fwmb-hidden");
    }

    /**
     * Intercepts all terrain modifications. Evaluates if the math should be generated
     * live, or deferred to the manual Apply button.
     */
    requestTerrainUpdate(bounds = null) {
        this.pendingTerrainBounds = SpatialMath.mergeBounds(this.pendingTerrainBounds, bounds);
        if (this.uiState.liveFeatureUpdates) {
            this.debouncedCanvasTerrain();
        } else {
            this.hasPendingFeatureMath = true;
            this.render({ parts: ["editToolbar"] });
        }
    }

    /**
     * Identifies the spatial bounds of the next Undo or Redo action.
     */
    #previewActionBounds(direction) {
        if (!this.canvasEngine) return;

        const ledger = direction === "undo" ? this.globalHistoryLedger : this.globalRedoLedger;
        const actionType = ledger.at(-1);

        if (!actionType) return;

        let targetBounds = null;
        let actionLabel = "";

        if (actionType === "raster") {
            const stack = direction === "undo" ? this.brushEngine.history : this.brushEngine.redoStack;
            const targetStroke = stack.at(-1);

            if (targetStroke?.points && targetStroke.points.length > 0) {
                targetBounds = this.#calculatePointBounds(targetStroke.points, targetStroke.size || 20);

                // Map the raster layer to its localisation key
                const isBiome = targetStroke.layer === "biome";
                const locKey = isBiome ? "FILRODENSWMB.UI.ActionBiomeBrush" : "FILRODENSWMB.UI.ActionTerrainBrush";
                const fallback = isBiome ? "Biome Brush" : "Terrain Brush";

                actionLabel = game.i18n.localize(locKey) || fallback;
            }
        } else if (actionType === "vector") {
            const stack = direction === "undo" ? this.pinHistory : this.pinRedoStack;
            const targetSnapshot = stack.at(-1);

            if (targetSnapshot) {
                const currentState = MapStateManager.getVectorStateSnapshot(this);
                const diffResult = this.#diffVectorSnapshots(currentState, targetSnapshot);

                if (diffResult) {
                    targetBounds = diffResult.bounds;
                    actionLabel = diffResult.label;
                }
            }
        }

        if (targetBounds) {
            const prefixKey = direction === "undo" ? "FILRODENSWMB.UI.ActionUndo" : "FILRODENSWMB.UI.ActionRedo";
            const prefix = game.i18n.localize(prefixKey);

            this.canvasEngine.showActionPreview(targetBounds, `${prefix} ${actionLabel}`);
        }
    }

    /**
     * Compares two global state snapshots to find the specific entity that changed.
     */
    #diffVectorSnapshots(current, target) {
        let changedEntity = null;
        let entityKey = null;

        for (const key of Object.keys(current)) {
            if (!Array.isArray(current[key]) || !Array.isArray(target[key])) continue;

            const currentMap = new Map(current[key].map((item, idx) => [item.id || `idx_${idx}`, item]));
            const targetMap = new Map(target[key].map((item, idx) => [item.id || `idx_${idx}`, item]));

            for (const [id, targetItem] of targetMap.entries()) {
                const currentItem = currentMap.get(id);

                if (!currentItem || JSON.stringify(currentItem) !== JSON.stringify(targetItem)) {
                    changedEntity = currentItem || targetItem;
                    entityKey = key;

                    if (changedEntity.regions && Array.isArray(changedEntity.regions)) {
                        const cRegs = new Map((currentItem?.regions || []).map((r, i) => [r.id || `idx_${i}`, r]));
                        const tRegs = new Map((targetItem?.regions || []).map((r, i) => [r.id || `idx_${i}`, r]));
                        let changedReg = null;

                        for (const [rId, tReg] of tRegs.entries()) {
                            const cReg = cRegs.get(rId);
                            if (!cReg || JSON.stringify(cReg) !== JSON.stringify(tReg)) {
                                changedReg = cReg || tReg;
                                break;
                            }
                        }
                        if (!changedReg) {
                            for (const [rId, cReg] of cRegs.entries()) {
                                if (!tRegs.has(rId)) {
                                    changedReg = cReg;
                                    break;
                                }
                            }
                        }
                        if (changedReg) changedEntity = changedReg;
                    }
                    break;
                }
            }

            if (!changedEntity) {
                for (const [id, currentItem] of currentMap.entries()) {
                    if (!targetMap.has(id)) {
                        changedEntity = currentItem;
                        entityKey = key;
                        break;
                    }
                }
            }

            if (changedEntity) break;
        }

        if (!changedEntity) return null;

        let points = [];
        if (changedEntity.points) {
            points = changedEntity.points;
        } else if (changedEntity.regions) {
            points = changedEntity.regions.flatMap((r) => r.points || []);
        } else if (changedEntity.x !== undefined && changedEntity.y !== undefined) {
            points = [changedEntity];
        }

        return {
            bounds: this.#calculatePointBounds(points, 50),
            label: this.#getActionLabel(entityKey, changedEntity),
        };
    }

    /**
     * Resolves the localized UI label for a modified vector entity.
     */
    #getActionLabel(key, entity) {
        if (!key) return game.i18n.localize("FILRODENSWMB.UI.ActionVectorEdit") || "Vector Edit";

        if (key === "pins") {
            const isSpring = entity?.type === "spring" || entity?.type === "block_spring";
            const pinKey = isSpring ? "FILRODENSWMB.UI.ActionRiverSpring" : "FILRODENSWMB.UI.ActionInfrastructurePin";
            return game.i18n.localize(pinKey) || (isSpring ? "River Spring" : "Infrastructure Pin");
        }

        const labelConfig = {
            tectonicFaults: ["FILRODENSWMB.UI.ActionTectonicFault", "Tectonic Fault"],
            manualRivers: ["FILRODENSWMB.UI.ActionCustomRiver", "Custom River"],
            routes: ["FILRODENSWMB.UI.ActionRoute", "Route"],
            regionLayers: ["FILRODENSWMB.UI.ActionRegion", "Region"],
            mapLabels: ["FILRODENSWMB.UI.ActionLabel", "Label"],
            mapDecorations: ["FILRODENSWMB.UI.ActionDecoration", "Decoration"],
        };

        const match = labelConfig[key];

        return match ? game.i18n.localize(match[0]) || match[1] : game.i18n.localize("FILRODENSWMB.UI.ActionVectorEdit") || "Vector Edit";
    }

    /**
     * Converts an array of {x,y} points into a spatial bounding box.
     */
    #calculatePointBounds(points, padding = 0) {
        if (!points || points.length === 0) return null;

        let minX = Infinity,
            maxX = -Infinity,
            minY = Infinity,
            maxY = -Infinity;
        for (const pt of points) {
            if (pt.x < minX) minX = pt.x;
            if (pt.x > maxX) maxX = pt.x;
            if (pt.y < minY) minY = pt.y;
            if (pt.y > maxY) maxY = pt.y;
        }

        return {
            minX: Math.max(0, minX - padding),
            maxX: Math.min(this.mapWidth, maxX + padding),
            minY: Math.max(0, minY - padding),
            maxY: Math.min(this.mapHeight, maxY + padding),
        };
    }

    async #processHistoryStep(isUndo) {
        // Dynamically assign the source and target stacks based on the direction
        const sourceLedger = isUndo ? this.globalHistoryLedger : this.globalRedoLedger;
        const targetLedger = isUndo ? this.globalRedoLedger : this.globalHistoryLedger;
        const sourcePinStack = isUndo ? this.pinHistory : this.pinRedoStack;
        const targetPinStack = isUndo ? this.pinRedoStack : this.pinHistory;

        let action = sourceLedger?.pop();

        while (action) {
            if (action === "vector") {
                if (sourcePinStack.length > 0) {
                    const previousFaults = JSON.stringify(this.tectonicFaults);
                    const previousRivers = JSON.stringify(this.manualRivers);
                    const previousFeaturePins = JSON.stringify(this.mapPins.filter((p) => !p.icon));

                    targetPinStack.push(MapStateManager.getVectorStateSnapshot(this));
                    const state = sourcePinStack.pop();
                    MapStateManager.restoreVectorStateSnapshot(this, state);

                    targetLedger.push("vector");

                    const currentFeaturePins = JSON.stringify(this.mapPins.filter((p) => !p.icon));

                    if (previousFaults !== JSON.stringify(this.tectonicFaults) || previousRivers !== JSON.stringify(this.manualRivers)) {
                        this._repaintCanvas();
                        this.debouncedGenerateTerrain();
                    } else if (previousFeaturePins !== currentFeaturePins) {
                        this._repaintCanvas();
                        this.debouncedGenerateClimate();
                    } else {
                        this._repaintVectors();
                    }
                    break;
                }
            } else if (action === "raster") {
                // Dynamically trigger the brush engine's internal undo or redo
                const brushAction = isUndo ? this.brushEngine?.undo() : this.brushEngine?.redo();

                if (this.baseElevationData && brushAction) {
                    targetLedger.push("raster");
                    await this.#rebuildFromHistory(true);
                    this._repaintCanvas();
                    this.debouncedGenerateClimate();
                    break;
                }
            }
            action = sourceLedger?.pop();
        }

        this.render({ parts: ["context"] });
        this.markDirty();
    }

    // --- Action Handlers ---

    _onAdjustNoiseScale(event, target) {
        const dir = Number(target.dataset.dir);
        const currentScale = this.uiState["noise.elevation.scale"];
        const maxScale = Math.max(this.mapWidth, this.mapHeight);
        const targetScale = Math.max(FILRODENSWMB.LIMITS.NOISE_SCALE_MIN, Math.min(currentScale + dir * FILRODENSWMB.LIMITS.NOISE_SCALE_STEP, maxScale));

        if (currentScale === targetScale) {
            ui.notifications.warn(game.i18n.localize("FILRODENSWMB.UI.WarnScaleLimit") || "Noise scale limit reached.");
            return;
        }

        MapStateManager.pushVectorState(this);
        const scaleRatio = targetScale / currentScale;
        const offsetX = this.uiState["noise.offsetX"] || 0;
        const offsetY = this.uiState["noise.offsetY"] || 0;

        const scalePoint = (pt) => {
            if (pt?.x !== undefined) {
                pt.x = (pt.x + offsetX) * scaleRatio - offsetX;
                pt.y = (pt.y + offsetY) * scaleRatio - offsetY;
            }
        };

        this.mapLabels.forEach(scalePoint);
        this.mapDecorations.forEach(scalePoint);
        this.mapPins.forEach((p) => {
            scalePoint(p);
            if (p.label) scalePoint(p.label);
        });
        this.mapRoutes.forEach((r) => {
            r.points?.forEach(scalePoint);
            if (r.label) scalePoint(r.label);
        });
        this.regionLayers.forEach((layer) => {
            layer.regions.forEach((reg) => {
                reg.points?.forEach(scalePoint);
                if (reg.label) scalePoint(reg.label);
            });
        });
        if (this.brushEngine) {
            const scaleStroke = (stroke) => {
                stroke.points.forEach(scalePoint);
                stroke.size = stroke.size * scaleRatio;
            };
            this.brushEngine.history.forEach(scaleStroke);
            this.brushEngine.redoStack.forEach(scaleStroke);
        }

        this.uiState["noise.elevation.scale"] = targetScale;
        this.render({ parts: ["context"] });
        this.markDirty();
        this.debouncedGenerateTerrain();
    }

    _onAdjustReferenceScale(event, target) {
        const dir = Number(target.dataset.dir);
        const factor = dir > 0 ? FILRODENSWMB.UI.REFERENCE_IMAGE.IN_FACTOR : FILRODENSWMB.UI.REFERENCE_IMAGE.OUT_FACTOR;

        this.uiState.referenceScale *= factor;
        this.uiState.referenceScale = Math.max(FILRODENSWMB.UI.REFERENCE_IMAGE.SCALE_MIN, Math.min(this.uiState.referenceScale, FILRODENSWMB.UI.REFERENCE_IMAGE.SCALE_MAX));

        this.#updateReferenceLayer();
    }

    async _onApplyFeatureMath(event, target) {
        if (!this.hasPendingFeatureMath) return;

        await this.generateTerrain();
        this.hasPendingFeatureMath = false;
        this.render({ parts: ["editToolbar"] });
    }

    /**
     * Highly destructive action: Rebuilds the underlying webgl canvas and spatial arrays.
     */
    async _onApplyResolution(event, target) {
        // 1. Extract all uncommitted data natively (No DOM scraping)
        const formData = new FormDataExtended(target.form).object;

        const newWidth = Number.parseInt(formData.mapWidth) || FILRODENSWMB.DEFAULTS.MAP_WIDTH;
        const newHeight = Number.parseInt(formData.mapHeight) || FILRODENSWMB.DEFAULTS.MAP_HEIGHT;
        let newSeed = formData.mapSeed?.trim();

        // 2. If the user left the seed blank, generate a random one automatically
        if (!newSeed) {
            newSeed = Math.random().toString(36).substring(2, 8).toUpperCase();
        }

        const hasBrushEdits = this.brushEngine && this.brushEngine.history.length > 0;
        const hasPinEdits = this.mapPins && this.mapPins.length > 0;

        if (hasBrushEdits || hasPinEdits) {
            const confirmed = await MapDialogManager._confirmDialog(game.i18n.localize("FILRODENSWMB.UI.Warning"), game.i18n.localize("FILRODENSWMB.UI.ResolutionWarningContent"));

            if (!confirmed) {
                this.render({ parts: ["context"] });
                return;
            }
        }

        this.mapWidth = newWidth;
        this.mapHeight = newHeight;

        MapStateManager.allocateBuffers(this);

        this.defaultUiState = MapStateManager.buildDefaultUiState(newWidth, newHeight);
        this.uiState = foundry.utils.deepClone(this.defaultUiState);
        this.uiState.mapSeed = newSeed;

        // Reset biome colors to defaults so the DOM sync catches them
        this.customBiomeColors = {};
        Object.entries(FILRODENSWMB.BIOMES).forEach(([key, rgb]) => {
            this.customBiomeColors[key] = rgb;
        });

        this.render({ parts: ["toolbar", "context"] });

        // 1. Reset all history and spatial arrays
        this.markDirty();
        this.brushEngine = new BrushEngine(this.mapWidth, this.mapHeight);
        this.manualRivers = [];
        this.tectonicFaults = [];
        this.mapPins = [];
        this.mapRoutes = [];
        this.regionLayers = [];
        this.mapLabels = [];
        this.mapDecorations = [];
        this.pinHistory = [];
        this.pinRedoStack = [];
        this.globalHistoryLedger = [];
        this.globalRedoLedger = [];

        // 2. Drop all active drawing states
        this.activeRouteId = null;
        this.activeRegionLayerId = null;
        this.activeRegionId = null;
        this.activeFaultId = null;
        this.activeRiverId = null;

        // 3. Wipe the save memory so the next save forces a "Save As" prompt
        this.currentSaveId = null;
        this.currentSaveName = null;

        await this.generateTerrain();
        this.#updateGrid();
        this.canvasEngine.resetCamera();

        // 4. Force UI to update
        this.render({ parts: ["toolbar", "context"] });
    }

    _onChangeTool(event, target) {
        if (this.hasPendingFeatureMath) {
            this.generateTerrain();
            this.hasPendingFeatureMath = false;
        }

        const newTool = target.dataset.tool;
        if (!newTool || this.activeTool === newTool) return;

        // 1. Teardown current state
        this.#clearActiveDrawingStates();
        this.#deactivateEditMode();

        // 2. Setup new state
        MapStateManager.getMapParameters(this);
        this.activeTool = newTool;

        // 3. Delegate UI & Canvas updates
        this.#ensureToolLayerVisible(newTool);
        this.#updateBiomeOpacity();
        this.#updateCanvasModes(newTool);

        // 4. Paint
        this._repaintVectors();
        this.render({ parts: ["toolbar", "context", "editToolbar"] });
    }

    #clearActiveDrawingStates() {
        for (const config of Object.values(FILRODENSWMB.ENTITY_CONFIG)) {
            this[config.activeKey] = null;
        }
        this.activeRegionId = null;
    }

    async #deactivateEditMode() {
        if (!this.uiState.isEditMode) return;

        this.uiState.isEditMode = false;
        this.brushEngine?.endStroke();
        if (this.canvasEngine) this.canvasEngine.setEditMode(false);

        await this.render({ parts: ["toolbar", "editToolbar", "context"] });
    }

    #ensureToolLayerVisible(newTool) {
        const toolLayerMap = {
            terrain: "topography",
            biomes: "biomes",
            features: "features",
            infrastructure: "infrastructure",
            regions: "regions",
            labels: "labels",
        };

        const layerId = toolLayerMap[newTool];
        if (!layerId) return; // If the tool doesn't have an auto-layer, do nothing

        const btn = this.element.querySelector(`[data-layer="${layerId}"]`);
        if (btn && !btn.classList.contains("active")) {
            btn.classList.add("active");
            this.canvasEngine?.toggleLayer(layerId, true);
        }
    }

    #updateCanvasModes(newTool) {
        if (!this.canvasEngine) return;

        this.canvasEngine.setReferenceMode(newTool === "reference");
        if (this.canvasEngine.setCropMode) {
            this.canvasEngine.setCropMode(newTool === "scene" && this.canvasEngine.isEditMode);
        }
    }

    /**
     * Extracts the currently active canvas state to a PNG.
     */
    async _onExportPng(event, target) {
        if (!this.canvasEngine || !this.currentElevationData) {
            ui.notifications.warn("No map is currently generated to export.");
            return;
        }

        const mapName = this.currentSaveName || "Unsaved Map";

        ui.notifications.info(game.i18n.format("Exporting {name} to PNG...", { name: mapName }));
        this.canvasEngine.exportToPNG(mapName);
    }

    /**
     * Prompts the user with the export configuration dialogue before triggering the async build pipeline.
     */
    async _onExportScene(event, target) {
        if (!this.canvasEngine || !this.currentElevationData) {
            ui.notifications.warn("No map is currently generated to export.");
            return;
        }

        const defaultName = this.currentSaveName || "New Map Scene";
        const defaultFolder = "fwmb-exports";

        const content = await foundry.applications.handlebars.renderTemplate("modules/filrodens-world-map-builder/templates/dialogs/export-scene.hbs", { defaultName, defaultFolder });

        const config = await foundry.applications.api.DialogV2.prompt({
            classes: ["fwmb"],
            window: { title: game.i18n.localize("FILRODENSWMB.UI.ExportScene") || "Export to Scene" },
            content: content,
            ok: {
                callback: (event, button, dialog) => {
                    return {
                        sceneName: button.form.elements["sceneName"].value.trim() || defaultName,
                        exportFolder: button.form.elements["exportFolder"].value.trim() || defaultFolder,
                        generateJournals: button.form.elements["generateJournals"].checked,
                        overwriteJournals: button.form.elements["overwriteJournals"].checked,
                        createGmOverlay: button.form.elements["createGmOverlay"].checked,
                    };
                },
            },
        });

        if (!config) return; // User cancelled

        // The user has confirmed. Hand off to the background processing pipeline.
        this.#executeSceneExportPipeline(config);
    }

    /**
     * The background orchestrator for slicing the canvas and creating the Foundry Documents.
     */
    async #executeSceneExportPipeline(config) {
        await this.#startProcessing(game.i18n.localize("FILRODENSWMB.UI.ExportingScene") || "Exporting Scene...");

        try {
            // Temporarily strip the camera transform so the PNG exports at a mathematically 1:1 scale with 0 offsets
            const origX = this.canvasEngine.stage.position.x;
            const origY = this.canvasEngine.stage.position.y;
            const origScaleX = this.canvasEngine.stage.scale.x;
            const origScaleY = this.canvasEngine.stage.scale.y;

            this.canvasEngine.stage.position.set(0, 0);
            this.canvasEngine.stage.scale.set(1, 1);

            const activeWindow = this.element.ownerDocument.defaultView || window;
            const textEl = this.element.querySelector(".fwmb-processing-text");

            // --- 1. PLAYER PASS ---
            if (textEl) textEl.textContent = "Extracting Player View...";

            this.canvasEngine.setRenderPass("player");
            this._repaintVectors(); // Rebuilds the vectors based on player visibility

            // YIELD to the browser so the newly created PIXI SVG Sprites can upload to the GPU
            await new Promise((resolve) => activeWindow.setTimeout(resolve, 250));

            const playerBlob = await this.canvasEngine.extractCanvasBlob("player");

            // --- 2. GM OVERLAY PASS ---
            let gmBlob = null;
            if (config.createGmOverlay) {
                if (textEl) textEl.textContent = "Extracting GM Overlay...";

                this.canvasEngine.setRenderPass("gm");
                this._repaintVectors(); // Rebuilds the vectors based on GM visibility

                // YIELD again for the new GM sprites
                await new Promise((resolve) => activeWindow.setTimeout(resolve, 250));

                gmBlob = await this.canvasEngine.extractCanvasBlob("gm");
            }

            if (textEl) textEl.textContent = "Building Foundry Scene...";

            // Restore the normal view and the exact camera transform the user was looking at
            this.canvasEngine.stage.position.set(origX, origY);
            this.canvasEngine.stage.scale.set(origScaleX, origScaleY);
            this.canvasEngine.setRenderPass("normal");
            this._repaintVectors();

            // Hand off the physical Blobs to the server-side Exporter utility
            await SceneExporter.run(this, config, playerBlob, gmBlob);
        } catch (err) {
            console.error("FWMB | Pipeline Error:", err);
            ui.notifications.error("Export pipeline failed. See console for details.");
        } finally {
            this.#endProcessing();
        }
    }

    /**
     * Executes the regional map extraction pipeline.
     */
    async _onGenerateRegionalMap(event, target) {
        if (!this.canvasEngine) return;

        // 1. Validate Crop Box
        const cropBox = this.canvasEngine.getCropData();
        if (!cropBox || cropBox.width <= 0 || cropBox.height <= 0) {
            ui.notifications.warn(game.i18n.localize("FILRODENSWMB.UI.WarnInvalidCrop") || "Please draw a valid crop area first.");
            return;
        }

        // 2. Prompt for save name
        const mapName = await MapDialogManager._promptTextValue(game.i18n.localize("FILRODENSWMB.UI.SaveAs"), game.i18n.localize("FILRODENSWMB.UI.Name"), `${this.currentSaveName || "Map"} (Region)`);

        if (!mapName) return;

        // 3. Lock UI
        await this.#startProcessing(game.i18n.localize("FILRODENSWMB.UI.GeneratingRegion") || "Extracting Region...");

        try {
            // 4. Delegate heavy mathematical payload extraction
            const payload = RegionalExtractor.createPayload(this, cropBox);

            // 5. Save to database
            const journal = await saveMapData(mapName, payload, null);
            if (journal) ui.notifications.info(`Regional Map '${journal.name}' created successfully.`);
        } catch (err) {
            console.error("FWMB | Regional Map Generation Failed:", err);
            ui.notifications.error(game.i18n.localize("FILRODENSWMB.UI.RegionalGenerationError") || "Failed to generate regional map.");
        } finally {
            // 6. Cleanup
            this.#endProcessing();
            this.#deactivateEditMode();
        }
    }

    /**
     * Opens a system file dialogue, validates the JSON payload, and imports it to the database.
     */
    async _onImportMapJson(event, target) {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json";

        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            await this.#startProcessing(game.i18n.localize("FILRODENSWMB.UI.ImportingMap") || "Importing Map...");

            try {
                const text = await file.text();
                const parsedData = JSON.parse(text);

                if (!parsedData.seed || !parsedData.params) {
                    throw new Error("Invalid FWMB Data Schema");
                }

                const cleanName = file.name.replace(".json", "").replace("fwmb_", "");
                await saveMapData(`${cleanName} (Imported)`, parsedData);

                ui.notifications.info(game.i18n.localize("FILRODENSWMB.UI.ImportSuccess"));
                this.render({ parts: ["toolbar", "context"] });
            } catch (err) {
                console.error("FWMB | Import Failed:", err);
                ui.notifications.error(game.i18n.localize("FILRODENSWMB.UI.ImportError"));
            } finally {
                this.#endProcessing();
            }
        };

        input.click();
    }

    /**
     * Unified router for the inline CRUD buttons on the Manage Maps cards.
     */
    async _onManageMapAction(event, target) {
        const action = target.dataset.actionType;
        const card = target.closest(".fwmb-map-card");
        if (!action || !card) return;

        const mapId = card.dataset.id;

        // Dictionary Routing Pattern
        const actionHandlers = {
            load: () => this.#handleMapLoad(mapId, card),
            delete: () => this.#handleMapDelete(mapId),
            rename: () => this.#handleMapRename(mapId, card),
            duplicate: () => this.#handleMapDuplicate(mapId),
            promote: () => this.#handleMapPromote(mapId, card),
            export: () => this.#handleMapExport(mapId, card),
        };

        if (actionHandlers[action]) {
            await actionHandlers[action]();
        }
    }

    async #handleMapLoad(mapId, card) {
        const canLoad = await this.#gateUnsavedChanges();
        if (!canLoad) return;

        const payload = await loadMapData(mapId);
        if (payload) {
            this.currentSaveId = mapId;
            this.currentSaveName = card.querySelector(".fwmb-map-card-info").textContent.trim();
            await this.#ingestMapPayload(payload);
            ui.notifications.info(game.i18n.localize("FILRODENSWMB.UI.LoadSuccess"));

            this.render({ parts: ["toolbar", "context"] });
            this.isDirty = false;
        }
    }

    async #handleMapDelete(mapId) {
        const confirmed = await MapDialogManager._confirmDialog();
        if (!confirmed) return;

        await deleteSavedMap(mapId);
        if (this.currentSaveId === mapId) this.currentSaveId = null;
        this.render({ parts: ["context"] });
    }

    async #handleMapRename(mapId, card) {
        const currentName = card.querySelector(".fwmb-map-card-info").textContent.trim();
        const newName = await MapDialogManager._promptTextValue(game.i18n.localize("FILRODENSWMB.UI.Rename"), game.i18n.localize("FILRODENSWMB.UI.Name") || "Name", currentName);

        if (newName && newName !== currentName) {
            const updatedDoc = await renameSavedMap(mapId, newName);

            if (this.currentSaveId === mapId) {
                this.currentSaveName = newName;
                if (updatedDoc?.id && updatedDoc.id !== this.currentSaveId) {
                    this.currentSaveId = updatedDoc.id;
                }
            }
            this.render({ parts: ["context"] });
        }
    }

    async #handleMapDuplicate(mapId) {
        await duplicateSavedMap(mapId);
        this.render({ parts: ["context"] });
    }

    async #handleMapPromote(mapId, card) {
        const confirmed = await MapDialogManager._confirmDialog(
            game.i18n.localize("FILRODENSWMB.UI.Promote") || "Promote Map",
            game.i18n.localize("FILRODENSWMB.UI.PromoteConfirm") || "Create a standalone copy of this regional map?",
        );
        if (!confirmed) return;

        const exportData = await loadMapData(mapId);
        if (exportData) {
            delete exportData.parentId;

            const originalName = card.querySelector(".fwmb-map-card-info").textContent.trim();
            const newName = `${originalName} (Standalone)`;

            await saveMapData(newName, exportData, null);

            ui.notifications.info(game.i18n.localize("FILRODENSWMB.UI.PromoteSuccess") || "Standalone map created successfully.");
            this.render({ parts: ["context"] });
        }
    }

    async #handleMapExport(mapId, card) {
        const exportData = await loadMapData(mapId);
        if (!exportData) return;

        const rawName = card.querySelector(".fwmb-map-card-info").textContent.trim();
        const mapName = rawName.replace(/[^a-z0-9]/gi, "_").toLowerCase();

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `fwmb_${mapName}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
    }

    _onNudgeNoise(event, target) {
        const dx = Number(target.dataset.dx);
        const dy = Number(target.dataset.dy);

        MapStateManager.pushVectorState(this);

        const translatePoint = (pt) => {
            if (pt?.x !== undefined) {
                pt.x -= dx;
                pt.y -= dy;
            }
        };

        this.mapLabels.forEach(translatePoint);
        this.mapDecorations.forEach(translatePoint);
        this.mapPins.forEach((p) => {
            translatePoint(p);
            if (p.label) translatePoint(p.label);
        });
        this.mapRoutes.forEach((r) => {
            r.points?.forEach(translatePoint);
            if (r.label) translatePoint(r.label);
        });
        this.regionLayers.forEach((layer) => {
            layer.regions.forEach((reg) => {
                reg.points?.forEach(translatePoint);
                if (reg.label) translatePoint(reg.label);
            });
        });
        if (this.brushEngine) {
            const translateStroke = (stroke) => stroke.points.forEach(translatePoint);
            this.brushEngine.history.forEach(translateStroke);
            this.brushEngine.redoStack.forEach(translateStroke);
        }

        this.uiState["noise.offsetX"] += dx;
        this.uiState["noise.offsetY"] += dy;

        this.render({ parts: ["context"] });
        this.markDirty();
        this.debouncedGenerateTerrain();
    }

    _onNudgeReference(event, target) {
        const dx = Number(target.dataset.dx);
        const dy = Number(target.dataset.dy);

        this.uiState.referenceX += dx;
        this.uiState.referenceY += dy;
        this.#updateReferenceLayer();
    }

    async _onRandomizeSeed(event, target) {
        this.uiState.mapSeed = Math.random().toString(36).substring(2, 8).toUpperCase();
        this.render({ parts: ["context"] });
    }

    async _onRedoBrush(event, target) {
        await this.#processHistoryStep(false);
    }

    _onRemoveReferenceImage(event, target) {
        this.uiState.referenceImage = "";
        this.#updateReferenceLayer();
        this.render({ parts: ["context"] });
    }

    _onResetNoisePan(event, target) {
        this.uiState["noise.offsetX"] = this.defaultUiState["noise.offsetX"];
        this.uiState["noise.offsetY"] = this.defaultUiState["noise.offsetY"];
        this.render({ parts: ["context"] });
        this.markDirty();
        this.debouncedGenerateTerrain();
    }

    _onResetNoiseScale(event, target) {
        this.uiState["noise.elevation.scale"] = this.defaultUiState["noise.elevation.scale"];
        this.render({ parts: ["context"] });
        this.markDirty();
        this.debouncedGenerateTerrain();
    }

    _onResetReferencePan(event, target) {
        this.uiState.referenceX = this.mapWidth / 2;
        this.uiState.referenceY = this.mapHeight / 2;
        this.#updateReferenceLayer();
    }

    _onResetReferenceScale(event, target) {
        this.uiState.referenceScale = 1;
        this.#updateReferenceLayer();
    }

    _onResetZoom(event, target) {
        this.canvasEngine?.resetCamera();
    }

    async _onSaveMap(event, target) {
        if (target) target.disabled = true;
        await this.saveCurrentMap();
        if (target) target.disabled = false;
    }

    _onSelectRegionLayer(event, target) {
        const id = target.closest(".fwmb-accordion-group").dataset.layerId;
        this.activeRegionLayerId = id;
        this.activeRegionId = null;
        this.render({ parts: ["context"] });
    }

    /**
     * Handles swapping between the Raise, Lower, and Smooth brush tools.
     */
    _onSetBrushTool(event, target) {
        const stateKey = `${this.activeTool}BrushTool`;
        this.uiState[stateKey] = target.dataset.tool;
        this.render({ parts: ["toolbar", "editToolbar"] });
    }

    _onSetFeatureMode(event, target) {
        this.uiState.activeFeatureMode = target.dataset.mode;
        this.activeFaultId = null; // Ends the current fault line natively
        this.render({ parts: ["toolbar", "editToolbar"] });
    }

    /**
     * Handles manual switching between Point and Route modes via the edit toolbar.
     */
    _onSetInfraMode(event, target) {
        this.uiState.activeInfraMode = target.dataset.mode;
        this.activeRouteId = null;
        this.render({ parts: ["toolbar", "editToolbar"] });
    }

    _onSetInfrastructureIcon(event, target) {
        const newIcon = target.dataset.icon;

        this.uiState.activeIcon = newIcon;
        this.uiState.activeInfraMode = "pin";
        this.activeRouteId = null;

        this.render({ parts: ["toolbar", "editToolbar"] });
    }

    _onSetRegionMode(event, target) {
        this.uiState.regionMode = target.dataset.mode;

        if (!this.activeRegionLayerId) {
            ui.notifications.warn(game.i18n.localize("FILRODENSWMB.UI.WarnNoRegionLayer") || "Please create or select a Region Layer first.");
            return;
        }

        const layer = this.regionLayers.find((l) => l.id === this.activeRegionLayerId);
        if (!layer) return;

        // Garbage collect the previous active region if it was left unfinished (less than 3 points)
        if (this.activeRegionId) {
            const activeRegion = layer.regions.find((r) => r.id === this.activeRegionId);
            if (activeRegion && activeRegion.points.length < 3) {
                layer.regions = layer.regions.filter((r) => r.id !== this.activeRegionId);
            }
        }

        // Explicitly create the new region object so it immediately appears in the sidebar accordion
        this.activeRegionId = foundry.utils.randomID();
        layer.regions.push({
            id: this.activeRegionId,
            name: `Region ${layer.regions.length + 1}`,
            description: "",
            points: [], // Starts empty until the user clicks the canvas
            fillColor: this.uiState.regionFillColor,
            fillStyle: this.uiState.regionFillStyle,
            lineColor: this.uiState.regionLineColor,
            lineThickness: this.uiState.regionLineThickness,
            lineStyle: this.uiState.regionLineStyle,
            smoothing: this.uiState.regionSmoothing,
            visibility: "all",
        });

        this._repaintVectors();
        this.render({ parts: ["toolbar", "context", "editToolbar"] });
    }

    _onSetRegionPreset(event, target) {
        const color = target.dataset.color;
        const targetProperty = target.dataset.target === "line" ? "regionLineColor" : "regionFillColor";

        this.uiState[targetProperty] = color;
        this.render({ parts: ["toolbar", "editToolbar"] });

        if (this.activeRegionId && this.activeRegionLayerId) {
            const layer = this.regionLayers.find((l) => l.id === this.activeRegionLayerId);
            const region = layer?.regions.find((r) => r.id === this.activeRegionId);
            if (region) {
                if (targetProperty === "line") region.lineColor = color;
                else region.fillColor = color;
                this._repaintVectors();
            }
        }
    }

    /**
     * Toggles the interactive 3D topography visualisation.
     */
    async _onThreeDView(event, target) {
        const overlay = this.element.querySelector("#fwmb-3d-overlay");

        if (!overlay || !this.currentElevationData) return;

        // 1. Exiting 3D Mode
        if (this.scene3D) {
            this.scene3D.destroy();
            this.scene3D = null;

            overlay.classList.add("fwmb-hidden");

            // Query the button safely to remove the active state
            const btn = this.element.querySelector('[data-action="threeDView"]');
            if (btn) btn.classList.remove("active");

            // Restore the manual layout wrappers
            const mapControls = this.element.querySelector(".fwmb-map-controls");
            const contextPanel = this.element.querySelector(".fwmb-context-panel");
            const editToolbar = this.element.querySelector(".fwmb-edit-toolbar");

            if (mapControls) mapControls.classList.remove("fwmb-hidden");
            if (contextPanel) contextPanel.style.display = "";
            if (editToolbar) editToolbar.style.display = ""; // Restores standard CSS flow

            return;
        }

        // 2. Entering 3D Mode: Teardown state
        this.#clearActiveDrawingStates();
        await this.#deactivateEditMode();

        // 3. Setup 3D overlay UI
        const mapControls = this.element.querySelector(".fwmb-map-controls");
        const contextPanel = this.element.querySelector(".fwmb-context-panel");
        const editToolbar = this.element.querySelector(".fwmb-edit-toolbar");
        const freshTarget = this.element.querySelector('[data-action="threeDView"]');

        overlay.classList.remove("fwmb-hidden");
        if (freshTarget) freshTarget.classList.add("active");

        // Manually hide layout wrappers so the 3D canvas fills the entire screen
        if (mapControls) mapControls.classList.add("fwmb-hidden");
        if (contextPanel) contextPanel.style.display = "none";
        if (editToolbar) editToolbar.style.display = "none"; // Destroys the bottom margin bug!

        // 4. Generate 3D Scene
        const { currentSeed, params } = MapStateManager.getMapParameters(this);
        const engine = new ProceduralEngine(currentSeed);
        const seaLevel = this.uiState["seaLevel"];
        const waterMask = this.currentRiverData ? this.currentRiverData.waterMask : null;

        const biomeBuffer = new Uint8Array(this.mapWidth * this.mapHeight * 4);
        engine.createBiomesMap(
            this.currentElevationData,
            this.currentMoistureData,
            this.currentTemperatureData,
            this.currentBiomeOverrides,
            this.mapWidth,
            this.mapHeight,
            seaLevel,
            waterMask,
            params,
            biomeBuffer,
        );

        this.scene3D = new Scene3D(overlay);
        const riverVectors = this.currentRiverData ? this.currentRiverData.vectors : null;

        this.scene3D.render3DMap(this.currentElevationData, biomeBuffer, this.mapWidth, this.mapHeight, seaLevel, riverVectors, waterMask);
    }

    _onToggleEditMode(event, target) {
        const toolbar = this.element.querySelector(".fwmb-edit-toolbar");
        if (!toolbar) return;

        const isActivating = !this.uiState.isEditMode;
        this.uiState.isEditMode = isActivating;

        if (isActivating) {
            const stillValid = this.regionLayers.some((l) => l.id === this.activeRegionLayerId);
            if (!stillValid) {
                this.activeRegionLayerId = this.regionLayers[0]?.id ?? null;
            }
        } else {
            if (this.hasPendingFeatureMath) {
                this.generateTerrain();
                this.hasPendingFeatureMath = false;
            }

            for (const config of Object.values(FILRODENSWMB.ENTITY_CONFIG)) {
                this[config.activeKey] = null;
            }
            this.activeRegionId = null;
        }

        if (this.canvasEngine) {
            this.canvasEngine.setEditMode(isActivating);
            if (this.canvasEngine.setCropMode) {
                this.canvasEngine.setCropMode(isActivating && this.activeTool === "scene");
            }
        }

        if (FILRODENSWMB.UI.VECTOR_TOOLS.includes(this.activeTool)) {
            this._repaintVectors();
        }

        this.render({ parts: ["context", "toolbar", "editToolbar"] });
    }

    _onToggleGrid(event, target) {
        this.uiState.gridVisible = !this.uiState.gridVisible;
        target.classList.toggle("active", this.uiState.gridVisible);
        this.#updateGrid();

        this.markDirty();
    }

    /**
     * Toggles visibility of the WebGL layers.
     */
    _onToggleLayer(event, target) {
        const layerId = target.dataset.layer;
        if (!layerId || !this.canvasEngine) return;

        const isVisible = target.classList.toggle("active");

        this.canvasEngine.toggleLayer(layerId, isVisible);
    }

    _onToggleLiveFeatureUpdates(event, target) {
        this.uiState.liveFeatureUpdates = !this.uiState.liveFeatureUpdates;

        // If turned back on while changes are pending, immediately process them
        if (this.uiState.liveFeatureUpdates && this.hasPendingFeatureMath) {
            this.generateTerrain();
            this.hasPendingFeatureMath = false;
        }
        this.render({ parts: ["editToolbar"] });
    }

    _onTogglePinDropdown(event, target) {
        const dropdown = target.closest(".fwmb-custom-select").querySelector(".fwmb-select-options");
        if (dropdown) dropdown.classList.toggle("fwmb-hidden");
    }

    _onToggleRegionSmoothing(event, target) {
        this.uiState.regionSmoothing = !this.uiState.regionSmoothing;
        target.classList.toggle("active", this.uiState.regionSmoothing);

        // Manually update the icon DOM for instant visual feedback
        const icon = target.querySelector("i");
        if (icon) {
            icon.classList.remove("gesture", "timeline");
            icon.classList.add(this.uiState.regionSmoothing ? "gesture" : "timeline");
        }

        if (this.activeRegionId && this.activeRegionLayerId) {
            const layer = this.regionLayers.find((l) => l.id === this.activeRegionLayerId);
            const region = layer?.regions.find((r) => r.id === this.activeRegionId);
            if (region) {
                region.smoothing = this.uiState.regionSmoothing;
                this._repaintVectors();
            }
        }
    }

    _onToggleSnapping(event, target) {
        this.uiState.snapToPoints = !this.uiState.snapToPoints;
        target.classList.toggle("active", this.uiState.snapToPoints);
    }

    /**
     * Toggles live canvas filters for Player, GM, and Hidden vectors.
     */
    _onToggleViewFilter(event, target) {
        if (!this.canvasEngine) return;

        const filter = target.dataset.filter; // "all", "gm", or "none"
        if (!filter) return;

        // Invert the state and visually toggle the button
        this.viewFilters[filter] = !this.viewFilters[filter];
        target.classList.toggle("active", this.viewFilters[filter]);

        // Push to canvas and redraw
        this.canvasEngine.setViewFilters(this.viewFilters);
        this._repaintVectors();
    }

    _onToggleVisibility(event, target) {
        const targetType = target.dataset.target; // "layer", "feature", or "label"
        let modified = false;

        if (targetType === "layer") {
            modified = this.#toggleLayerVisibility(target);
        } else {
            modified = this.#toggleEntityVisibility(target, targetType);
        }

        if (modified) {
            this._repaintVectors();
            this.render({ parts: ["context"] });
            this.markDirty();
        }
    }

    #toggleLayerVisibility(target) {
        const id = target.closest(".fwmb-accordion-group")?.dataset.layerId;
        const layer = this.regionLayers.find((l) => l.id === id);

        if (!layer) return false;

        MapStateManager.pushVectorState(this);
        layer.visibility = this.#cycleVisibilityState(layer.visibility);
        return true;
    }

    #toggleEntityVisibility(target, targetType) {
        const listItem = target.closest(".fwmb-list-item");
        if (!listItem) return false;

        const { id, type, layerId } = listItem.dataset;
        const obj = this.#findEntityByType(type, id, layerId);

        if (!obj) return false;

        MapStateManager.pushVectorState(this);

        if (targetType === "label") {
            if (type === "custom") {
                obj.visibility = this.#cycleVisibilityState(obj.visibility);
            } else {
                if (!obj.label) obj.label = { visibility: "all" };
                obj.label.visibility = this.#cycleVisibilityState(obj.label.visibility);
            }
        } else if (targetType === "feature") {
            obj.visibility = this.#cycleVisibilityState(obj.visibility);
        }

        return true;
    }

    #findEntityByType(type, id, layerId) {
        // The Dictionary Routing Pattern applied to data arrays
        const collections = {
            custom: this.mapLabels,
            decoration: this.mapDecorations,
            pin: this.mapPins,
            route: this.mapRoutes,
            fault: this.tectonicFaults,
        };

        if (collections[type]) {
            return collections[type].find((item) => item.id === id);
        }

        // Special handling for nested regions
        if (type === "region") {
            const layer = this.regionLayers.find((l) => l.id === layerId);
            return layer?.regions.find((r) => r.id === id);
        }

        return null;
    }

    #cycleVisibilityState(currentState) {
        const states = FILRODENSWMB.UI.VISIBILITY_STATES;
        const currentIdx = states.indexOf(currentState || "all");
        return states[(currentIdx + 1) % states.length];
    }

    async _onUndoBrush(event, target) {
        await this.#processHistoryStep(true);
    }

    _onZoomIn(event, target) {
        this.canvasEngine?.zoomCamera(FILRODENSWMB.UI.ZOOM.FACTOR);
    }

    _onZoomOut(event, target) {
        this.canvasEngine?.zoomCamera(1 / FILRODENSWMB.UI.ZOOM.FACTOR);
    }

    #getZoomTargetPoints(listItem) {
        const id = listItem.dataset.id;
        const type = listItem.dataset.type;

        switch (type) {
            case "custom": {
                const label = this.mapLabels.find((l) => l.id === id);
                return label ? [label] : [];
            }
            case "decoration": {
                const dec = this.mapDecorations.find((d) => d.id === id);
                return dec ? [dec] : [];
            }
            case "fault": {
                const fault = this.tectonicFaults.find((f) => f.id === id);
                return fault?.points || [];
            }
            case "pin": {
                const pin = this.mapPins.find((p) => p.id === id);
                return pin ? [pin] : [];
            }
            case "region": {
                const layer = this.regionLayers.find((l) => l.id === listItem.dataset.layerId);
                const region = layer?.regions.find((r) => r.id === id);
                return region?.points || [];
            }
            case "river": {
                const river = this.manualRivers.find((r) => r.id === id);
                return river?.points || [];
            }
            case "route": {
                const route = this.mapRoutes.find((r) => r.id === id);
                return route?.points || [];
            }

            default:
                return [];
        }
    }

    _onZoomToFeature(event, target) {
        const listItem = target.closest(".fwmb-list-item");
        if (!listItem) return;

        const targetPoints = this.#getZoomTargetPoints(listItem);

        if (targetPoints.length > 0 && this.canvasEngine) {
            this.canvasEngine.zoomToFeature(targetPoints);
        }
    }
}
