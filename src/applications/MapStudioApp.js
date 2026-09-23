import { FILRODENSWMB } from "../config.js";
import { StudioCanvas } from "../canvas/StudioCanvas.js";
import { ProceduralEngine } from "../generation/ProceduralEngine.js";
import { BrushEngine } from "../tools/BrushEngine.js";
import { RenderTimer } from "../tools/RenderTimer.js";
import { getSavedMaps, loadMapData, saveMapData, deleteSavedMap, renameSavedMap, duplicateSavedMap } from "../data/compendium.js";
import { Scene3D } from "../canvas/Scene3D.js";
import { SceneExporter } from "./SceneExporter.js";
import { SpatialMath } from "../tools/SpatialMath.js";
import { ColorMath } from "../tools/ColorMath.js";
import { MapStateManager } from "./MapStateManager.js";
import { MapDialogManager } from "./MapDialogManager.js";
import { getPinIconPickerList, getBuiltinPinIconList, getCustomPinIconList, getPinIconLabel, findUnresolvedPinIcons } from "../data/pinIcons.js";
import { RegionalExtractor } from "./RegionalExtractor.js";
import { TerrainVersion } from "../tools/TerrainVersion.js";
import { ProceduralOrchestrator } from "../ProceduralOrchestrator.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

// Turns a fraction into a percentage for the timing summary
const PERCENT = 100;

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
            addLabelQuickStyle(e, t)     { MapDialogManager.onAddQuickStyle(this, e, t); },
            addRouteQuickStyle(e, t)     { MapDialogManager.onAddQuickStyle(this, e, t); },
            addRegionQuickStyle(e, t)    { MapDialogManager.onAddQuickStyle(this, e, t); },
            editLabelQuickStyle(e, t)    { MapDialogManager.onEditQuickStyle(this, e, t); },
            editRouteQuickStyle(e, t)    { MapDialogManager.onEditQuickStyle(this, e, t); },
            editRegionQuickStyle(e, t)   { MapDialogManager.onEditQuickStyle(this, e, t); },
            deleteLabelQuickStyle(e, t)  { MapDialogManager.onDeleteQuickStyle(this, e, t); },
            deleteRouteQuickStyle(e, t)  { MapDialogManager.onDeleteQuickStyle(this, e, t); },
            deleteRegionQuickStyle(e, t) { MapDialogManager.onDeleteQuickStyle(this, e, t); },

            // --- MASS EDIT ---
            toggleMassEditMode(e, t)   { this._onToggleMassEditMode(e, t); },
            toggleMassEditItem(e, t)   { this._onToggleMassEditItem(e, t); },
            massEditSelectAll(e, t)    { this._onMassEditSelectAll(e, t); },
            massEditSelectNone(e, t)   { this._onMassEditSelectNone(e, t); },
            openMassEdit(e, t)         { MapDialogManager.onMassEdit(this, e, t); },

            // --- DIALOG MANAGER: Entity Deletion ---
            deleteDecoration(e, t)  { MapDialogManager.onDeleteEntity(this, e, t); },
            deleteFault(e, t)       { MapDialogManager.onDeleteEntity(this, e, t); },
            deleteLabel(e, t)       { MapDialogManager.onDeleteEntity(this, e, t); },
            deletePin(e, t)         { MapDialogManager.onDeleteEntity(this, e, t); },
            deleteRegion(e, t)      { MapDialogManager.onDeleteRegion(this, e, t); },
            deleteRegionLayer(e, t) { MapDialogManager.onDeleteEntity(this, e, t); },
            deleteRiver(e, t)       { MapDialogManager.onDeleteEntity(this, e, t); },
            deleteRoute(e, t)       { MapDialogManager.onDeleteEntity(this, e, t); },
            deleteLandMask(e, t)    { MapDialogManager.onDeleteLandMask(this, e, t); },
            deleteAllLandMasks(e, t) { MapDialogManager.onDeleteAllLandMasks(this, e, t); },
            editLandMask(e, t)      { MapDialogManager.onEditLandMask(this, e, t); },

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
            editCustomBiome(e, t)   { MapDialogManager.onEditCustomBiome(this, e, t); },
            deleteCustomBiome(e, t) { MapDialogManager.onDeleteCustomBiome(this, e, t); },
            openBiomeRuleEditor(e, t) { MapDialogManager.onOpenBiomeRuleEditor(this, e, t); },
            addDecoration(e, t)     { MapDialogManager.onAddDecoration(this, e, t); },
            addRegionLayer(e, t)    { MapDialogManager.onAddRegionLayer(this, e, t); },

            // --- DIALOG MANAGER: Pin Icons ---
            addCustomPinIcon(e, t)     { MapDialogManager.onAddCustomPinIcon(this, e, t); },
            editCustomPinIcon(e, t)    { MapDialogManager.onEditCustomPinIcon(this, e, t); },
            removeCustomPinIcon(e, t)  { MapDialogManager.onRemoveCustomPinIcon(this, e, t); },
            toggleBuiltinPinIcon(e, t) { MapDialogManager.onToggleBuiltinPinIcon(this, e, t); },
            hideAllBuiltinPinIcons(e, t)   { MapDialogManager.onHideAllBuiltinPinIcons(this, e, t); },
            revealAllBuiltinPinIcons(e, t) { MapDialogManager.onRevealAllBuiltinPinIcons(this, e, t); },

            // --- MAP STUDIO APP: Internal Tooling & States ---
            adjustNoiseScale(e, t)          { this._onAdjustNoiseScale(e, t); },
            adjustReferenceScale(e, t)      { this._onAdjustReferenceScale(e, t); },
            applyFeatureMath(e, t)          { this._onApplyFeatureMath(e, t); },
            applyResolution(e, t)           { this._onApplyResolution(e, t); },
            changeTool(e, t)                { this._onChangeTool(e, t); },
            exportPng(e, t)                 { this._onExportPng(e, t); },
            exportScene(e, t)               { this._onExportScene(e, t); },
            exportSettings(e, t)            { this._onExportSettings(e, t); },
            generateRegionalMap(e, t)       { this._onGenerateRegionalMap(e, t); },
            importMapJson(e, t)             { this._onImportMapJson(e, t); },
            importSettings(e, t)            { this._onImportSettings(e, t); },
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
            setBrushBiome(e, t)             { this._onSetBrushBiome(e, t); },
            setBrushTool(e, t)              { this._onSetBrushTool(e, t); },
            setFeatureMode(e, t)            { this._onSetFeatureMode(e, t); },
            setInfraMode(e, t)              { this._onSetInfraMode(e, t); },
            setInfrastructureIcon(e, t)     { this._onSetInfrastructureIcon(e, t); },
            setRegionMode(e, t)             { this._onSetRegionMode(e, t); },
            setRegionPreset(e, t)           { this._onSetRegionPreset(e, t); },
            setSceneMode(e, t)              { this._onSetSceneMode(e, t); },
            threeDView(e, t)                { this._onThreeDView(e, t); },
            toggleEditMode(e, t)            { this._onToggleEditMode(e, t); },
            toggleGrid(e, t)                { this._onToggleGrid(e, t); },
            toggleLayer(e, t)               { this._onToggleLayer(e, t); },
            toggleLiveFeatureUpdates(e, t)  { this._onToggleLiveFeatureUpdates(e, t); },
            togglePinDropdown(e, t)         { this._onTogglePinDropdown(e, t); },
            toggleRegionSmoothing(e, t)     { this._onToggleRegionSmoothing(e, t); },
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

    /**
     * Mass Edit item types whose "Select" toggle lives in the same context panel fieldset
     * group. Pins and Routes both live in the Infrastructure panel - having Select mode active
     * for both at once wouldn't collide (their selections and dialogs are independent), but it
     * would leave a GM unable to tell at a glance which list an eventual Mass Edit applies to.
     * Add further arrays here if another panel ever splits into multiple mass-editable lists.
     */
    static MASS_EDIT_EXCLUSIVE_GROUPS = [["pin", "route"]];

    /**
     * The four Style Library registries a GM can bundle into a shareable settings file, in
     * export/import order. Each maps its uiState array key to the existing legend/fieldset
     * localisation key already shown in tools-library.hbs, so the export dialogue's checkboxes
     * reuse those labels rather than duplicating them under new keys. Custom Pin Icons are
     * deliberately not included - they're a world-scoped Foundry setting referencing a live
     * file path rather than a per-map uiState array, so a portable export needs to embed the
     * actual image data, which a settings file does not carry; this set covers every registry
     * that's plain, self-contained JSON.
     */
    static STYLE_LIBRARY_CATEGORIES = [
        { key: "customBiomes", labelKey: "FILRODENSWMB.UI.SettingsBiomeColors" },
        { key: "customRouteStyles", labelKey: "FILRODENSWMB.UI.SettingsRouteQuickStyles" },
        { key: "customRegionStyles", labelKey: "FILRODENSWMB.UI.SettingsRegionQuickStyles" },
        { key: "customLabelStyles", labelKey: "FILRODENSWMB.UI.SettingsLabelQuickStyles" },
    ];

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
        // Map-sized float raster that rebuilds are built and compared in; created on demand and
        // released when idle. scratchUnavailable is set if the browser refused to allocate it, so
        // refreshes fall back to covering the whole map (see ProceduralOrchestrator).
        this.bufferScratch = null;
        this.scratchUnavailable = false;
        // What the last finished full generation was computed from, and the base terrain buffer it
        // produced; lets an edit that cannot have changed the base terrain skip regenerating it
        // (see ProceduralOrchestrator.canSkipBaseRegeneration).
        this.generationInputs = null;
        this.generationBase = null;
        this.currentMoistureData = null;
        this.currentTemperatureData = null;
        this.currentRiverData = null;
        this.tectonicFaults = [];
        this.activeFaultId = null;
        this.manualRivers = [];
        this.activeRiverId = null;
        this.mapPins = [];
        // Studio-session UI state, not map data - deliberately not part of uiState (which is
        // cloned into saved map payloads) since whether this panel is expanded has nothing to
        // do with any particular map.
        this._builtinPinIconsExpanded = false;
        // Mass Edit selection tool state - also Studio-session UI state, not map data, for the
        // same reason: which items are checked for a batch edit has nothing to do with the map
        // itself, and should reset (not persist) whenever the Studio app is reopened.
        this.massEditMode = { pin: false, route: false, region: false, label: false };
        this.massEditSelection = { pin: new Set(), route: new Set(), region: new Set(), label: new Set() };
        this.mapRoutes = [];
        this.activeRouteId = null;
        this.regionLayers = [];
        this.activeRegionLayerId = null;
        this.activeRegionId = null;
        this.landMasks = [];
        this.activeLandMaskId = null;
        this.mapLabels = [];
        this.mapDecorations = [];
        // pinHistory/pinRedoStack and globalHistoryLedger/globalRedoLedger are session-only
        // undo/redo bookkeeping, not permanent data. pinHistory holds full vector-state
        // snapshots (see MapStateManager.getVectorStateSnapshot) taken immediately before a
        // vector edit - these are never saved with the map, since a saved map only stores each
        // vector feature's final current state, not a history of how it got there. They're
        // capped at FILRODENSWMB.LIMITS.HISTORY_MAX (see MapStateManager.pushVectorState) and
        // reset to empty whenever a map loads (see #handleMapLoad), so undo/redo only ever
        // covers edits made in the current session.
        //
        // globalHistoryLedger/globalRedoLedger is the single combined, ordered view across both
        // raster ("brush stroke") and vector actions that the Undo/Redo buttons actually read
        // (see #processHistoryStep, #previewActionBounds, #updateHistoryButtons) - it's what
        // decides which of the two type-specific stacks above (or brushEngine.history/
        // .redoStack) to pop next, and in what order. It's a view over recent session activity,
        // not a data store in its own right, and is deliberately treated the same as
        // pinHistory/pinRedoStack: capped at HISTORY_MAX, reset to empty on map load. Don't
        // confuse this with brushEngine.history (see BrushEngine.js) - that's the actual,
        // uncapped, permanently-saved record of every brush stroke ever painted, needed to
        // rebuild a map's terrain/biomes from its seed on load. This ledger only tracks how many
        // of the *current session's* actions are currently undoable; it says nothing about how
        // much paint history a map actually contains.
        this.pinHistory = [];
        this.pinRedoStack = [];
        this.globalHistoryLedger = [];
        this.globalRedoLedger = [];
        this.hasPendingFeatureMath = false;
        this.pendingTerrainBounds = null;
        this.cachedMaxElevation = null;

        // The lowest elevation the canvas was last shaded against, alongside cachedMaxElevation
        // above - see ProceduralOrchestrator.planRepaint. Stays null (read as 0 by #paintOceanPixel
        // until a repaint sets it) until hand-edited terrain is actually allowed to go negative.
        this.cachedMinElevation = null;
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

        // Collects per-phase timings during a full render for the summary logged when it finishes
        this.renderTimer = new RenderTimer();

        this.debouncedGenerateTerrain = foundry.utils.debounce(this.generateTerrain.bind(this), FILRODENSWMB.UI.DEBOUNCE_MS.TERRAIN);
        this.debouncedGenerateClimate = foundry.utils.debounce(this.generateClimate.bind(this), FILRODENSWMB.UI.DEBOUNCE_MS.CLIMATE);
        this.debouncedGenerateFeatures = foundry.utils.debounce(this.generateFeatures.bind(this), FILRODENSWMB.UI.DEBOUNCE_MS.FEATURES);

        this.debouncedCanvasTerrain = foundry.utils.debounce(this.generateTerrain.bind(this), FILRODENSWMB.UI.DEBOUNCE_MS.CANVAS);
        this.debouncedCanvasClimate = foundry.utils.debounce(this.generateClimate.bind(this), FILRODENSWMB.UI.DEBOUNCE_MS.CANVAS);

        this.debouncedHistoryRebuild = foundry.utils.debounce(() => this.#refreshChangedTerrain("Brush stroke rebuild"), FILRODENSWMB.UI.DEBOUNCE_MS.CANVAS);

        // Every refresh that uses the scratch buffer restarts this timer. The buffer is only ever
        // used inside single synchronous steps and refilled before each use, so it can be dropped
        // whenever the timer fires, even between the steps of a refresh.
        this.debouncedReleaseScratch = foundry.utils.debounce(() => {
            this.bufferScratch = null;
        }, FILRODENSWMB.UI.DEBOUNCE_MS.SCRATCH_RELEASE);
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

        context.biomeList = Object.entries(FILRODENSWMB.BIOME_IDS)
            .filter(([key, id]) => id !== FILRODENSWMB.BIOME_IDS.ERASER && id !== 1 && id !== 2 && !key.toLowerCase().startsWith("custom"))
            .map(([key, id]) => {
                const defaultRgb = FILRODENSWMB.BIOMES[key] || [0, 0, 0];
                const currentRgb = this.customBiomeColors[key] || defaultRgb;

                return {
                    id: id,
                    key: key,
                    label: `FILRODENSWMB.BIOMES.${key}`,
                    hex: ColorMath.rgbToHex(currentRgb),
                    isCustom: false,
                };
            });

        // Map custom biomes and append them to the UI list
        const customBiomesMapped = (this.uiState.customBiomes || []).map((cb) => ({
            id: cb.id,
            key: `custom_${cb.id}`,
            label: cb.name,
            hex: ColorMath.rgbToHex(cb.color),
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

        context.infrastructureIcons = getPinIconPickerList(this.uiState.activeIcon);
        context.builtinPinIcons = getBuiltinPinIconList();
        context.builtinPinIconsExpanded = this._builtinPinIconsExpanded;
        context.customPinIcons = getCustomPinIconList();

        const activeIconEntry = context.infrastructureIcons.find((icon) => icon.key === this.uiState.activeIcon);
        context.activeIconPath = activeIconEntry?.path || "";
        context.activeIconIsCustom = activeIconEntry?.isCustom || false;

        context.routeStyles = (this.uiState.customRouteStyles || []).map((style) => ({
            id: style.id,
            label: style.name,
            isCustom: true,
        }));

        context.regionStyles = (this.uiState.customRegionStyles || []).map((style) => ({
            id: style.id,
            label: style.name,
            isCustom: true,
        }));

        // Decorates a sorted quick-style list with how many features on this map are currently
        // using each entry, via that type's QUICK_STYLE_CONFIG.getUsageCount - the same
        // traversal onDisconnect uses when a style is deleted, just counting instead of resetting.
        const withUsageCount = (config) => (style) => ({ ...style, usageCount: config.getUsageCount(this, style.id) });

        // Custom Biomes get no usageCount badge yet (unlike the three below) - "in use" for a
        // biome would mean scanning the full currentBiomeOverrides raster rather than a small
        // vector array, a different enough cost profile that it's deliberately left for later.
        context.customBiomes = [...(this.uiState.customBiomes || [])].sort(alphaSort).map((cb) => ({ ...cb, hex: ColorMath.rgbToHex(cb.color), hasRules: !!cb.rules?.length }));

        context.customRouteStyles = [...(this.uiState.customRouteStyles || [])]
            .sort(alphaSort)
            .map(withUsageCount(MapDialogManager.QUICK_STYLE_CONFIG.Route));
        context.customLabelStyles = [...(this.uiState.customLabelStyles || [])]
            .sort(alphaSort)
            .map(withUsageCount(MapDialogManager.QUICK_STYLE_CONFIG.Label));
        context.customRegionStyles = [...(this.uiState.customRegionStyles || [])]
            .sort(alphaSort)
            .map(withUsageCount(MapDialogManager.QUICK_STYLE_CONFIG.Region));

        if (partId === "context") {
            context.toolPartial = `modules/filrodens-world-map-builder/templates/tools-${this.activeTool}.hbs`;

            context.massEditMode = { ...this.massEditMode };
            context.massEditCount = {
                pin: this.massEditSelection.pin.size,
                route: this.massEditSelection.route.size,
                region: this.massEditSelection.region.size,
                label: this.massEditSelection.label.size,
            };
            context.massEditBlocked = Object.fromEntries(Object.keys(this.massEditMode).map((type) => [type, this.#isMassEditBlocked(type)]));

            context.mapPins = (this.mapPins || [])
                .filter((p) => !!p.icon)
                .sort(alphaSort)
                .map((p) => ({ ...p, massEditSelected: this.massEditSelection.pin.has(p.id) }));
            context.mapRoutes = [...(this.mapRoutes || [])].sort(alphaSort).map((r) => ({ ...r, massEditSelected: this.massEditSelection.route.has(r.id) }));
            context.mapLabels = [...(this.mapLabels || [])].sort(alphaSort).map((l) => ({ ...l, massEditSelected: this.massEditSelection.label.has(l.id) }));
            context.mapDecorations = [...(this.mapDecorations || [])].sort(alphaSort);
            const { ADD: landColor, SUBTRACT: oceanColor } = FILRODENSWMB.DISPLAY.LAND_MASK_COLORS;
            context.landMasks = [...(this.landMasks || [])]
                .sort(alphaSort)
                .map((m) => ({ ...m, swatchColor: m.operation === "subtract" ? oceanColor : landColor }));

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
                regions: [...(layer.regions || [])].sort(alphaSort).map((r) => ({ ...r, massEditSelected: this.massEditSelection.region.has(r.id) })),
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
        this.#bindCollapsibleFieldsets();
        this.#bindCanvasCallbacks();
        this.#applyInitialBootState();
        this.#updateHistoryButtons();

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

        // Lives in tools-biomes.hbs, a per-tool-tab template part that gets torn down and
        // rebuilt on context re-renders - unlike the persistent .fwmb-edit-toolbar above, a
        // root-level "bind once ever" guard would go stale after the first rebuild. Guard on
        // the button's own dataset instead, so each fresh DOM node gets bound exactly once.
        const fallbackBtn = this.element.querySelector("#fwmb-preview-fallback-btn");
        if (fallbackBtn && !fallbackBtn.dataset.hasListeners) {
            fallbackBtn.dataset.hasListeners = "true";
            fallbackBtn.addEventListener("pointerenter", () => this.canvasEngine?.toggleLayer("biomeFallback", true));
            fallbackBtn.addEventListener("pointerleave", () => this.canvasEngine?.toggleLayer("biomeFallback", false));
        }
    }

    /**
     * Keeps the Undo/Redo buttons' disabled state and step-count tooltip in sync with
     * globalHistoryLedger/globalRedoLedger. Deliberately DOM-only rather than routed through
     * template context and a "map" part re-render: the PIXI canvas is mounted into
     * .fwmb-map-preview once by #initCanvasAndEngines and never re-attached, so re-rendering
     * the "map" part would rebuild that container from the template and orphan the canvas.
     * Called from _onRender, which covers every render() call across the app (tool switches,
     * vector edits via MapStateManager.pushVectorState, undo/redo itself), plus directly from
     * #handleBrushEnd, since ending a paint/terrain stroke changes the ledger without
     * triggering a render of its own.
     */
    #updateHistoryButtons() {
        const undoBtn = this.element.querySelector('[data-action="undoBrush"]');
        const redoBtn = this.element.querySelector('[data-action="redoBrush"]');

        const undoCount = this.globalHistoryLedger?.length ?? 0;
        const redoCount = this.globalRedoLedger?.length ?? 0;

        if (undoBtn) {
            undoBtn.disabled = undoCount === 0;
            undoBtn.dataset.tooltip =
                undoCount > 0 ? game.i18n.format("FILRODENSWMB.UI.UndoCount", { count: undoCount }) : game.i18n.localize("FILRODENSWMB.UI.Undo");
        }

        if (redoBtn) {
            redoBtn.disabled = redoCount === 0;
            redoBtn.dataset.tooltip =
                redoCount > 0 ? game.i18n.format("FILRODENSWMB.UI.RedoCount", { count: redoCount }) : game.i18n.localize("FILRODENSWMB.UI.Redo");
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
        // brushBiome's options are always numeric biome ids, never free text - and BrushEngine's
        // paint guards (and the Eraser's own active-state matching) compare it with strict
        // equality, so it has to come out of here as a real Number, not the string every other
        // <select> in this method is deliberately left as.
        else if (name === "brushBiome") this.uiState[name] = Number(target.value);
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
        // Fallback to custom if a manual property is changed
        if (["regionFillColor", "regionFillStyle", "regionLineColor", "regionLineThickness", "regionLineStyle"].includes(name)) {
            this.uiState.activeRegionQuickStyle = "custom";
            this.render({ parts: ["toolbar", "editToolbar"] });
        }

        // Apply preset if dropdown is changed
        if (name === "activeRegionQuickStyle") {
            const styleId = this.uiState.activeRegionQuickStyle;
            if (styleId !== "custom") {
                const styleData = this.uiState.customRegionStyles.find((s) => s.id === styleId);
                if (styleData) {
                    this.uiState.regionFillColor = styleData.fillColor;
                    this.uiState.regionFillStyle = styleData.fillStyle;
                    this.uiState.regionLineColor = styleData.lineColor;
                    this.uiState.regionLineThickness = styleData.lineThickness;
                    this.uiState.regionLineStyle = styleData.lineStyle;
                    this.uiState.regionSmoothing = styleData.smoothing;
                    this.render({ parts: ["toolbar", "editToolbar"] });
                }
            }
        }

        if (!this.activeRegionId || !this.activeRegionLayerId) return;
        if (name !== "activeRegionQuickStyle" && !name.startsWith("region")) return;

        const layer = this.regionLayers.find((l) => l.id === this.activeRegionLayerId);
        const region = layer?.regions.find((r) => r.id === this.activeRegionId);

        if (region) {
            region.quickStyle = this.uiState.activeRegionQuickStyle;
            region.fillColor = this.uiState.regionFillColor;
            region.fillStyle = this.uiState.regionFillStyle;
            region.lineColor = this.uiState.regionLineColor;
            region.lineThickness = this.uiState.regionLineThickness;
            region.lineStyle = this.uiState.regionLineStyle;
            region.smoothing = this.uiState.regionSmoothing;
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

    /**
     * A `<details>`-based fieldset re-renders as closed on every render (its `open` attribute
     * only ever reflects whatever the last-rendered context said), which would otherwise slam
     * it shut the moment any action inside it - a checkbox, Hide/Reveal all - triggers a
     * context re-render. Tracking `open` in JS and feeding it back through the render context
     * (see `builtinPinIconsExpanded` in _preparePartContext) keeps it open until the GM
     * actually collapses it themselves. Assigning `ontoggle` (rather than addEventListener)
     * is deliberate: re-running this after every render always replaces any previous handler,
     * so the same element never ends up with duplicate listeners.
     */
    #bindCollapsibleFieldsets() {
        const builtinIconsDetails = this.element.querySelector("#fwmb-builtin-pin-icons");
        if (!builtinIconsDetails) return;

        builtinIconsDetails.ontoggle = () => {
            this._builtinPinIconsExpanded = builtinIconsDetails.open;
        };
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

        if (target.type === "range" && event.type === "change") {
            return;
        }

        const name = target.name || "";

        // Skip marking dirty for temporary visual overlays
        if (!name.startsWith("reference")) this.markDirty();

        if (name === "generationEngine") {
            if (event.type === "input") return;

            this._onApplyResolution(event, target);
            return;
        }

        // 1. Route specific single-action updates
        if (name.startsWith("cartography")) return this.#updateCartography(target, name);
        if (name === "regionOpacity") return this.#updateRegionOpacity(target);
        if (name === "referenceAlpha") return this.#updateReferenceAlpha(target);
        if (name === "gridType" || name === "gridSize") return this.#updateGridSettings();
        if (name === "biomeAlphaActive" || name === "biomeAlphaInactive") return this.#updateBiomeAlphas();
        if (name === "contourInterval") return this.#updateContours();

        // 2. Custom biome colour handler (uses dataset instead of name)
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
        const rgb = ColorMath.hexToRgb(hex);

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
        if (
            target.matches(
                'input[name="seaLevel"], input[name="tectonicPlates"], input[name="coastlineFracture"], input[name="continentalGrouping"], input[name="shelfRange"], input[name="continentScale"], input[name^="noise.elevation"], input[name^="noise.offsetX"], input[name^="noise.offsetY"]',
            )
        ) {
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

            // Mirrors the same priority-chain lookup the biome layer itself paints with
            // (ProceduralEngine.createBiomesMap) - getBiomeKey() alone only ever computes the
            // built-in default, silently ignoring a hand-painted override or a matching custom
            // auto-generation rule, so the readout would be wrong for anything painted or
            // rule-generated. Uses getDerivedMapParameters() directly rather than the
            // DOM-syncing getMapParameters(), since this fires on every mouse move over the
            // canvas and doesn't need to re-read every input's current value to answer "what
            // biome is under the cursor right now".
            const overrideId = this.currentBiomeOverrides ? this.currentBiomeOverrides[index] : 0;
            const { params } = MapStateManager.getDerivedMapParameters(this.uiState, this.customBiomeColors);
            const { lookupKey } = ProceduralEngine.resolveBiomeLookup(
                overrideId, elev, mois, temp, seaLevel, this.bufferWaterMask, index, params.customBiomeRules, params.biomePalette,
                params.solidOverWater,
            );

            // Deliberately left uncapped: a value past 100% (or below 0%) is the honest readout for
            // elevation a user has hand-pushed past the old [0, 1] range. Normalising this against
            // the map's discovered peak/trough instead was considered and rejected, because it would
            // make the same stored elevation display as a different percentage purely because the
            // map's extremes changed somewhere else - a point the user never touched could appear to
            // move. Do not add a clamp here.
            this.element.querySelector("#fwmb-readout-elev").textContent = Math.round(elev * 100) + "%";
            this.element.querySelector("#fwmb-readout-mois").textContent = Math.round(mois * 100) + "%";
            this.element.querySelector("#fwmb-readout-temp").textContent = Math.round(temp * 100) + "%";
            this.element.querySelector("#fwmb-readout-biome").textContent = this.#getBiomeDisplayName(lookupKey);
        };
    }

    /**
     * Resolves a ProceduralEngine.resolveBiomeLookup() `lookupKey` to the text a person should
     * see. A built-in default comes back as its i18n key name (e.g. "GRASSLAND", from
     * getBiomeKey()) and localises directly. A hand-painted or rule-matched override comes back
     * as a numeric id instead, which can name either a built-in biome (still an i18n key, just
     * addressed by number rather than name here) or a custom biome (a plain name the GM typed
     * in, never localised).
     */
    #getBiomeDisplayName(lookupKey) {
        if (typeof lookupKey === "number") {
            const custom = this.uiState.customBiomes?.find((c) => c.id === lookupKey);
            if (custom) return custom.name;

            const builtInKey = Object.keys(FILRODENSWMB.BIOME_IDS).find((key) => FILRODENSWMB.BIOME_IDS[key] === lookupKey);
            return builtInKey ? game.i18n.localize(`FILRODENSWMB.BIOMES.${builtInKey}`) : "";
        }
        return game.i18n.localize(`FILRODENSWMB.BIOMES.${lookupKey}`);
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

        // The scratch buffer is recreated whenever it is needed, so it can go with the window
        this.bufferScratch = null;
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
            case "landMask":
                MapDialogManager.onEditLandMask(this, null, null, entityId);
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
            this._finishActiveRegion();
            cleared = true;
        }

        if (this.activeLandMaskId) {
            cleared = true;
            if (this._finishActiveLandMask()) requiresTerrainUpdate = true;
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
        if (this.activeTool === "scene") layer = "scene";
        if (this.activeTool === "biomes") layer = "biome";
        if (this.activeTool === "features") layer = "features";
        if (this.activeTool === "infrastructure") layer = "infrastructure";
        if (this.activeTool === "regions") layer = "regions";
        if (this.activeTool === "labels") layer = "labels";
        if (this.activeTool === "cartography") layer = "cartography";

        // 1. Immediately intercept vector-mode tools to bypass all raster brush logic
        if (layer === "scene") {
            this.#handleSceneClick(x, y);
            return;
        }

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
        // Strict nullish check, not `||`: the Eraser Biome's paint value is a genuine 0, which
        // `||` would silently coerce back to the default Grassland fallback below.
        const paintValue = layer === "biome" ? (this.uiState.brushBiome ?? FILRODENSWMB.BIOME_IDS.GRASSLAND) : null;

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
            // Only globalHistoryLedger (the session undo/redo view) is capped here -
            // brushEngine.history itself is deliberately left to grow without limit, since it's
            // the permanent stroke record the map gets rebuilt from on load, not undo data (see
            // the constructor and #handleMapLoad for the full explanation).
            this.globalHistoryLedger.push("raster");
            this.globalRedoLedger = [];
            if (this.globalHistoryLedger.length > FILRODENSWMB.LIMITS.HISTORY_MAX) {
                this.globalHistoryLedger.shift();
            }
            // No render() follows a brush stroke ending (painting stays lightweight), so the
            // Undo/Redo buttons need their own direct refresh here rather than waiting on _onRender.
            this.#updateHistoryButtons();
        }

        this.markDirty();

        // Rebuild history if vector features exist so they re-carve and re-deform the newly painted
        // terrain. The area painted so far stays in pendingTerrainBounds for that rebuild to pick up.
        if (this.activeTool === "terrain" && this.#hasVectorTerrainFeatures()) {
            this.debouncedHistoryRebuild();
        }
    }

    /**
     * Whether faults or manual rivers exist. They are carved into the terrain after the brush
     * strokes, so a stroke painted live on top of them is only correct once the terrain has been
     * rebuilt (see #refreshChangedTerrain).
     */
    #hasVectorTerrainFeatures() {
        return this.manualRivers?.length > 0 || this.tectonicFaults?.length > 0;
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

        if (this.activeTool === "scene" && this.canvasEngine.renderLandMasks) {
            const isGuided = this.uiState.generationEngine === "guided";
            this.canvasEngine.renderLandMasks(this.landMasks, isEdit, this.activeLandMaskId, isGuided);
        }

        if (this.activeTool === "cartography" && this.canvasEngine.renderCartography) {
            this.canvasEngine.renderCartography(this.uiState, this.mapWidth, this.mapHeight, isEdit, this.mapDecorations);
        }
    }

    #handleInfraDragEnd() {
        this.render({ parts: ["context"] });
        this.markDirty();

        if (this.activeTool === "features" || this.activeTool === "scene") {
            this.requestTerrainUpdate();
        }
    }

    #handleInfraInsertNode(x, y) {
        if (!["infrastructure", "regions", "features", "scene"].includes(this.activeTool)) return;

        // This only ever splits an existing line/polygon segment (scene masks, infrastructure routes,
        // regions, fault lines, manual rivers) - pins have no segments and never reach this path -
        // so all four tools may extend into the buffer here
        const buffer = FILRODENSWMB.UI.CANVAS_BUFFER;
        if (x < -buffer || x > this.mapWidth + buffer || y < -buffer || y > this.mapHeight + buffer) return;

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

            const segment = SpatialMath.getClosestVectorSegment(this[config.stateKey], x, y, this.currentSnapThreshold, !!config.smoothed);
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

        // Check Land Masks
        if (this.activeTool === "scene") {
            const mockLayer = [{ id: "mask_layer", regions: this.landMasks }];
            const maskSegment = SpatialMath.getClosestRegionSegment(mockLayer, this.activeLandMaskId, x, y, this.currentSnapThreshold);

            if (maskSegment && (!bestMatch || maskSegment.dist < bestMatch.dist)) {
                bestMatch = {
                    vector: maskSegment.region,
                    insertIndex: maskSegment.insertIndex,
                    projX: maskSegment.projX,
                    projY: maskSegment.projY,
                    dist: maskSegment.dist,
                    triggersTerrain: true,
                };
            }
        }

        return bestMatch;
    }

    #handleInfraDeleteNode(target) {
        if (!["infrastructure", "regions", "features", "scene"].includes(this.activeTool)) return;
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
                            // Orphan cleanup: destroy region if it can no longer enclose an area (unless actively drawing)
                            if (region.points.length < FILRODENSWMB.LIMITS.MIN_POLYGON_VERTICES && this.activeRegionId !== region.id) {
                                layer.regions.splice(rIndex, 1);
                            }
                        },
                    };
                }
            }
        }

        // 4. Check Land Masks
        if (this.activeTool === "scene") {
            const mIndex = this.landMasks.findIndex((m) => m.points.includes(target));
            if (mIndex > -1) {
                const mask = this.landMasks[mIndex];
                return {
                    array: mask.points,
                    index: mask.points.indexOf(target),
                    triggersTerrain: true,
                    cleanup: () => {
                        // Orphan cleanup: destroy mask if it can no longer enclose an area (unless actively drawing)
                        if (mask.points.length < FILRODENSWMB.LIMITS.MIN_POLYGON_VERTICES && this.activeLandMaskId !== mask.id) {
                            this.landMasks.splice(mIndex, 1);
                        }
                    },
                };
            }
        }

        return null;
    }

    /**
     * Removes a polygon that was abandoned before it had enough nodes to enclose an area.
     *
     * Such a shape can never be turned into a real polygon from the canvas - the only nodes it
     * offers to insert between are its own - so leaving it behind would just strand an unusable
     * entry in its list until the user deleted it by hand.
     *
     * Undo/redo history is deliberately left completely untouched: discarding neither records a
     * step of its own nor removes the polygon's earlier node-by-node steps. A polygon can end up
     * with too few nodes by being undone back from a complete shape; if finishing it then wiped
     * history, or recorded a new step (which clears the redo stack), the complete shape could no
     * longer be recovered with Redo. The cost of leaving history alone is that Undo can bring back
     * a one- or two-node fragment, which the user can delete node by node or from its list.
     *
     * @param {Array} polygons - The array the polygon lives in (this.landMasks or a region layer's regions).
     * @param {object} polygon - The incomplete polygon to remove.
     */
    #discardIncompletePolygon(polygons, polygon) {
        polygons.splice(polygons.indexOf(polygon), 1);

        this._repaintVectors();
        this.render({ parts: ["context"] });
    }

    /**
     * Ends the land mask currently being drawn (if any), discarding it if it never became a shape,
     * and reports whether the terrain now needs regenerating.
     *
     * Terrain is regenerated when a shape is finished rather than on every node, so this is the
     * moment a completed mask has to be applied. A mask with fewer than
     * FILRODENSWMB.LIMITS.MIN_POLYGON_VERTICES nodes encloses no area and is ignored by the guided
     * generator, so discarding it changes nothing and must not trigger a regeneration.
     *
     * Not private because the Land Masks edit dialogue (MapDialogManager) also has to finish an
     * in-progress mask before opening.
     *
     * @returns {boolean} True if the finished mask contributes to terrain and a regeneration is needed.
     */
    _finishActiveLandMask() {
        const mask = this.landMasks.find((m) => m.id === this.activeLandMaskId);
        const isComplete = (mask?.points.length ?? 0) >= FILRODENSWMB.LIMITS.MIN_POLYGON_VERTICES;

        this.activeLandMaskId = null;
        if (mask && !isComplete) this.#discardIncompletePolygon(this.landMasks, mask);

        return isComplete;
    }

    /**
     * Ends the region currently being drawn (if any), discarding it if it never became a shape.
     * Every path that stops a region being drawn - right-click, changing tool or region layer,
     * leaving edit mode, opening an edit dialogue - goes through here so none of them can leave an
     * unusable one- or two-node region behind.
     *
     * Not private because the region edit dialogue (MapDialogManager) also has to finish an
     * in-progress region before opening.
     */
    _finishActiveRegion() {
        const activeId = this.activeRegionId;
        if (!activeId) return;

        const layer = this.regionLayers.find((l) => l.regions.some((r) => r.id === activeId));
        const region = layer?.regions.find((r) => r.id === activeId);

        this.activeRegionId = null;
        if (region && region.points.length < FILRODENSWMB.LIMITS.MIN_POLYGON_VERTICES) {
            this.#discardIncompletePolygon(layer.regions, region);
        }
    }

    #handleSceneClick(x, y) {
        // Guard clause: Only process clicks if we are actively drawing a land/ocean masks
        if (this.uiState.sceneMode !== "addMask" && this.uiState.sceneMode !== "subtractMask") return;

        // Reject clicks outside the visual 200px buffer
        const buffer = FILRODENSWMB.UI.CANVAS_BUFFER;
        if (x < -buffer || x > this.mapWidth + buffer || y < -buffer || y > this.mapHeight + buffer) {
            return;
        }

        // Snapshot before mutating so every node - including the one that starts a new mask - is
        // its own undo step, exactly as it is for regions, routes and fault lines. Without this,
        // undo skips straight past the nodes to whichever earlier action last recorded a snapshot.
        MapStateManager.pushVectorState(this);

        // If no mask is currently active, initialise a new one
        if (!this.activeLandMaskId) {
            const isSubtract = this.uiState.sceneMode === "subtractMask";

            const newMask = {
                id: foundry.utils.randomID(),
                name: isSubtract ? `Ocean Hole ${this.landMasks.length + 1}` : `Landmass ${this.landMasks.length + 1}`,
                operation: isSubtract ? "subtract" : "add",
                points: [],
            };
            this.landMasks.push(newMask);
            this.activeLandMaskId = newMask.id;
        }

        // Locate the active mask and append the new vertex
        const mask = this.landMasks.find((m) => m.id === this.activeLandMaskId);
        if (mask) {
            mask.points.push({ x, y });
            this.markDirty();
            this._repaintVectors();
            this.render({ parts: ["context"] });
        }
    }

    #handleFeatureClick(x, y) {
        // River sources are single-point markers and stay confined to the map.
        // Manual rivers also stay strictly on-map: HydrologyEngine derives flow direction and the
        // carve depth from the elevation sampled at each node, and there is no elevation data (nor
        // any well-defined "off-map elevation") outside the actual terrain grid - see #sampleElevation.
        // Fault lines have no such dependency (TectonicEngine works purely off clamped pixel bounds
        // per segment) so they alone may extend into the buffer.
        const buffer = this.uiState.activeFeatureMode === "fault" ? FILRODENSWMB.UI.CANVAS_BUFFER : 0;
        if (x < -buffer || x > this.mapWidth + buffer || y < -buffer || y > this.mapHeight + buffer) return;

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

    /**
     * Repaints the map's pixel layers and redraws the vector layers.
     *
     * @param {object|null} requestedBounds - Area to repaint, or null for the whole map.
     * @param {object} [options] - Repaint options.
     * @param {boolean} [options.verifyPeak] - For an area-limited repaint that must leave the
     *   whole canvas correct: checks the map's highest point first and repaints the whole map if
     *   it moved, because land is shaded relative to it. The live brush leaves this off and
     *   repaints just the stamp area on every pointer move, where reading every elevation each
     *   time would be wasted work.
     */
    async _repaintCanvas(requestedBounds = null, { verifyPeak = false } = {}) {
        if (!this.currentElevationData) return;

        // Each stage is timed for the full-render summary (see RenderTimer)
        const timer = this.renderTimer;
        let mark = performance.now();

        // If repainting the FULL map, recalculate the true peak and trough for accurate contrast
        let bounds = requestedBounds;
        if (verifyPeak || !bounds || !this.cachedMaxElevation) {
            const plan = ProceduralOrchestrator.planRepaint(this.currentElevationData, this.cachedMaxElevation, this.cachedMinElevation, bounds);
            if (verifyPeak) bounds = plan.bounds;
            this.cachedMaxElevation = plan.peak;
            this.cachedMinElevation = plan.trough;
        }
        mark = timer.lap("Canvas repaint: peak scan", mark, `asked to repaint ${this.#describeRepaintArea(requestedBounds)}`);

        const seaLevel = this.uiState["seaLevel"];
        const { currentSeed, params } = MapStateManager.getMapParameters(this);
        const engine = new ProceduralEngine(currentSeed);
        const waterMask = this.bufferWaterMask;

        // Only the pixels the painters write are copied to the canvas textures and uploaded to the GPU
        const uploadBounds = ProceduralEngine.getRepaintBounds(bounds, this.mapWidth, this.mapHeight);
        mark = timer.lap("Canvas repaint: settings", mark, `repainting ${this.#describeRepaintArea(bounds)}`);

        engine.createBaseMap(this.currentElevationData, this.mapWidth, this.mapHeight, seaLevel, this.bufferBase, bounds);
        mark = timer.lap("Canvas repaint: base painter", mark);
        this.canvasEngine.renderPixelBuffer("base", this.bufferBase, this.mapWidth, this.mapHeight, uploadBounds);

        const baseBtn = this.element.querySelector('[data-layer="base"]');
        this.canvasEngine.toggleLayer("base", baseBtn ? baseBtn.classList.contains("active") : true);
        mark = timer.lap("Canvas repaint: canvas textures", mark);

        // Pass the cached peak and trough into the coloriser
        const maxPeak = this.cachedMaxElevation || 1.0;
        const minTrough = this.cachedMinElevation || 0;
        engine.colorize(this.currentElevationData, this.currentTemperatureData, this.mapWidth, this.mapHeight, seaLevel, waterMask, params, this.bufferTopography, bounds, maxPeak, minTrough);
        mark = timer.lap("Canvas repaint: topography painter", mark);
        this.canvasEngine.renderPixelBuffer("topography", this.bufferTopography, this.mapWidth, this.mapHeight, uploadBounds);

        const topoBtn = this.element.querySelector('[data-layer="topography"]');
        this.canvasEngine.toggleLayer("topography", topoBtn ? topoBtn.classList.contains("active") : true);
        mark = timer.lap("Canvas repaint: canvas textures", mark);

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
                this.bufferBiomeFallback,
            );
            mark = timer.lap("Canvas repaint: biomes painter", mark);
            this.canvasEngine.renderPixelBuffer("biomes", this.bufferBiomes, this.mapWidth, this.mapHeight, uploadBounds);
            // Kept current every repaint, but its layer stays hidden until the "Preview Rule
            // Coverage" button is hovered (see #bindToolbarListeners) - no visibility toggle here.
            this.canvasEngine.renderPixelBuffer("biomeFallback", this.bufferBiomeFallback, this.mapWidth, this.mapHeight, uploadBounds);

            const biomesBtn = this.element.querySelector('[data-layer="biomes"]');
            this.canvasEngine.toggleLayer("biomes", biomesBtn ? biomesBtn.classList.contains("active") : true);
        }
        mark = timer.lap("Canvas repaint: canvas textures", mark);

        const contourInterval = this.uiState["contourInterval"];
        engine.createContourMap(this.currentElevationData, this.mapWidth, this.mapHeight, contourInterval, seaLevel, this.bufferContours, bounds);
        mark = timer.lap("Canvas repaint: contours painter", mark);
        this.canvasEngine.renderPixelBuffer("contours", this.bufferContours, this.mapWidth, this.mapHeight, uploadBounds);
        mark = timer.lap("Canvas repaint: canvas textures", mark);

        if (this.canvasEngine) {
            this.canvasEngine.clearInteractiveTargets();
        }

        this._repaintVectors();
        timer.lap("Canvas repaint: vector layers", mark);
    }

    /**
     * Describes the area a repaint covers, for the timing summary.
     *
     * @param {object|null} bounds - The area being repainted, or nothing for the whole map.
     * @returns {string} The area and its share of the map.
     */
    #describeRepaintArea(bounds) {
        if (!SpatialMath.isValidBounds(bounds)) return "whole map";

        const pixels = (bounds.maxX - bounds.minX + 1) * (bounds.maxY - bounds.minY + 1);
        const share = (pixels / (this.mapWidth * this.mapHeight)) * PERCENT;
        return `x ${bounds.minX}-${bounds.maxX}, y ${bounds.minY}-${bounds.maxY}, ${share.toFixed(1)}% of the map`;
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

        // 5. Render Land Masks
        if (this.canvasEngine.renderLandMasks) {
            // Visible if in Guided Mode and on the Scene Tool, regardless of Edit Mode
            const isGuidedScene = this.uiState.generationEngine === "guided" && this.activeTool === "scene";

            this.canvasEngine.renderLandMasks(this.landMasks, isEditModeActive, this.activeLandMaskId, isGuidedScene);
        }

        // 6. Render Cartography
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

        // Biome overrides do not alter topography or climate math, so a biome stroke only has to
        // repaint the biome layer where it painted. It must not touch pendingTerrainBounds: that
        // records terrain painted live that the deferred generation still has to catch up with.
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
                strokeBounds,
                this.bufferBiomeFallback,
            );

            const uploadBounds = ProceduralEngine.getRepaintBounds(strokeBounds, this.mapWidth, this.mapHeight);
            this.canvasEngine.renderPixelBuffer("biomes", this.bufferBiomes, this.mapWidth, this.mapHeight, uploadBounds);
            this.canvasEngine.renderPixelBuffer("biomeFallback", this.bufferBiomeFallback, this.mapWidth, this.mapHeight, uploadBounds);
            return;
        }

        // Accumulate the bounds for the deferred procedural generation
        this.pendingTerrainBounds = SpatialMath.mergeBounds(this.pendingTerrainBounds, strokeBounds);
        this._repaintCanvas(strokeBounds);
        if (this.activeTool === "terrain" && this.#hasVectorTerrainFeatures()) {
            this.debouncedHistoryRebuild();
        } else {
            this.debouncedCanvasClimate();
        }
    }

    /**
     * Brings the terrain and everything derived from it in line with the brush history after a
     * stroke was finished, undone or redone, or after faults or manual rivers were edited, limited
     * to the area that actually changed.
     *
     * The working terrain is rebuilt from the brush engine's brushed layer (see
     * ProceduralOrchestrator.rebuildChangedTerrain), which reports where it ended up different.
     * That area, together with any area painted live since the last refresh, then goes through the
     * bounded climate, river and repaint stages instead of a whole-map refresh.
     *
     * The live-painted area has to be added because painting writes straight into the working
     * terrain: those pixels have already changed by the time of the rebuild, so a rebuild that
     * happens to give them the same value does not report them, yet the moisture, rivers and canvas
     * layers derived from them have not been updated. pendingTerrainBounds is where the live brush
     * records every area it has painted.
     *
     * @param {string} title - Names the run in the console timing summary.
     */
    async #refreshChangedTerrain(title) {
        await this.#runTimed(title, async () => {
            await this.#startProcessing(game.i18n.localize("FILRODENSWMB.UI.RebuildingHistory"));

            try {
                const rebuiltArea = ProceduralOrchestrator.rebuildChangedTerrain(this);
                const staleArea = SpatialMath.mergeBounds(rebuiltArea, this.pendingTerrainBounds);
                this.pendingTerrainBounds = null;

                if (SpatialMath.isValidBounds(staleArea)) await this.generateClimate(staleArea);
                else await this.#refreshRivers();
            } finally {
                this.#endProcessing();
                this.debouncedReleaseScratch();
            }
        });
    }

    /**
     * Reruns the river pass over the whole map and repaints wherever the water changed, for a
     * refresh that found no change to the terrain.
     *
     * The rivers depend on more than the terrain (the spring pins, and the source points of the
     * manual rivers), so they are always rerun. This costs a few tens of milliseconds, against the
     * rest of the map that is left alone.
     */
    async #refreshRivers() {
        await this.#runTimed("Features refresh (rivers only)", async () => {
            await this.#startProcessing(game.i18n.localize("FILRODENSWMB.UI.GeneratingFeatures") || "Generating Features...");

            try {
                const waterBounds = ProceduralOrchestrator.processFeaturePhase(this, true);

                if (waterBounds) await this._repaintCanvas(waterBounds);
                else this._repaintVectors();
            } finally {
                this.#endProcessing();
            }
        });
    }

    async generateTerrain() {
        // Any full generation, whichever path triggered it, satisfies changes deferred by the
        // pause toggle. Clearing before the generation reads state means an edit made while it
        // runs re-flags itself instead of being lost.
        this.#clearPendingFeatureMath();

        // If nothing the base terrain depends on has changed since the last full generation (the
        // edit was to faults, manual rivers or brush strokes), regenerating it and replaying the
        // brush strokes would only recreate what is already there. Refreshing what changed gives
        // the same result. Deciding this reads the settings the same way a generation does.
        if (ProceduralOrchestrator.canSkipBaseRegeneration(this)) {
            await this.#refreshChangedTerrain("Terrain refresh");
            return;
        }

        // A full generation covers the whole map, so the areas recorded so far need no tracking
        this.pendingTerrainBounds = null;
        const inputs = ProceduralOrchestrator.describeGenerationInputs(this);
        ProceduralOrchestrator.forgetGenerationInputs(this);

        // The run starts before the overlay's paint pause so the summary's total covers everything
        // the user waits for, not just the phases that log their own times
        await this.#runTimed("Full render", async () => {
            await this.#startProcessing(game.i18n.localize("FILRODENSWMB.UI.GeneratingTopography") || "Generating Topography...");

            try {
                // Hand off the mathematical heavy lifting to the Orchestrator
                ProceduralOrchestrator.processTopographyPhase(this);

                // The App maintains control of the Climate and Canvas rendering pipelines
                await this.generateClimate(null);

                ProceduralOrchestrator.rememberGenerationInputs(this, inputs);
            } finally {
                this.#endProcessing();
            }
        });
    }

    async generateClimate(bounds = null) {
        if (!this.currentElevationData) return;

        // Resolve active bounds before clearing pending state
        const requestedBounds = bounds || this.pendingTerrainBounds;
        const activeBounds = this.#resolveRefreshBounds(requestedBounds);
        if (!bounds && this.pendingTerrainBounds) {
            this.pendingTerrainBounds = null;
        }

        await this.#runTimed(`Climate refresh (${activeBounds ? "bounded" : "whole map"})`, async () => {
            await this.#startProcessing(game.i18n.localize("FILRODENSWMB.UI.GeneratingClimate") || "Generating Climate...");

            try {
                // The climate is recomputed over a wider area than the one that changed, and the
                // canvas has to be repainted over all of it
                const climateBounds = ProceduralOrchestrator.processClimatePhase(this, activeBounds);
                await this.generateFeatures(climateBounds);
            } finally {
                this.#endProcessing();
            }
        });
    }

    async generateFeatures(requestedBounds = null) {
        if (!this.currentElevationData) return;

        const bounds = this.#resolveRefreshBounds(requestedBounds);

        await this.#runTimed(`Features refresh (${bounds ? "bounded" : "whole map"})`, async () => {
            await this.#startProcessing(game.i18n.localize("FILRODENSWMB.UI.GeneratingFeatures") || "Generating Features...");

            try {
                // Rivers are traced over the whole map, so the water can change well outside the
                // area being refreshed and the repaint has to cover that too
                const waterBounds = ProceduralOrchestrator.processFeaturePhase(this, !!bounds);
                const repaintBounds = bounds && waterBounds ? SpatialMath.mergeBounds(bounds, waterBounds) : bounds;
                await this._repaintCanvas(repaintBounds, { verifyPeak: !!bounds });
            } finally {
                this.#endProcessing();
                this.debouncedReleaseScratch();
            }
        });
    }

    /**
     * Turns the area a refresh was asked to cover into what the stages below work with: null for
     * the whole map, or the area itself.
     *
     * Bounds that cover nothing (as merging two empty areas produces) mean the whole map. So do
     * bounds that already cover all of it: a whole-map refresh gives the same result without the
     * work of tracking what changed, which exists only to limit a refresh to part of the map.
     *
     * @param {object|null} bounds - The requested area, or null.
     * @returns {object|null} The area to refresh, or null for the whole map.
     */
    #resolveRefreshBounds(bounds) {
        if (!SpatialMath.isValidBounds(bounds)) return null;

        const coversMap = bounds.minX <= 0 && bounds.minY <= 0 && bounds.maxX >= this.mapWidth - 1 && bounds.maxY >= this.mapHeight - 1;
        return coversMap ? null : bounds;
    }

    /**
     * Runs `work` as a timed run and logs the phase-by-phase summary when the outermost run
     * finishes (see RenderTimer). The steps of a render call each other, so only the outermost of
     * them logs; and the summary is logged even if `work` throws, showing how far it got.
     */
    async #runTimed(title, work) {
        this.renderTimer.begin(title);
        try {
            return await work();
        } finally {
            const summary = this.renderTimer.end();
            if (summary) console.log(summary);
        }
    }

    async #ingestMapPayload(rawPayload) {
        // Deep clone to sever the connection to Foundry's memory cache
        const payload = foundry.utils.deepClone(rawPayload);

        this.uiState.mapSeed = payload.seed;
        this.currentParentId = payload.parentId || null;

        this.uiState.generationEngine = payload.generationEngine || "standard";

        // The terrain rules this map was built with, so it regenerates exactly as it was saved.
        // A map saved before the revision number existed has none, and reads as the legacy
        // revision (see TerrainVersion). Only regional maps carry a world description.
        this.uiState.terrainVersion = TerrainVersion.getVersion(payload);
        this.uiState.world = payload.world ?? null;

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
        this.uiState.tectonicPlates = p.tectonicPlates ?? FILRODENSWMB.GENERATION.TECTONIC_PLATES;
        this.uiState.coastlineFracture = p.coastlineFracture ?? FILRODENSWMB.GENERATION.COASTLINE_FRACTURE;
        this.uiState.continentalGrouping = p.continentalGrouping ?? FILRODENSWMB.GENERATION.CONTINENTAL_GROUPING;
        this.uiState.shelfRange = p.shelfRange ?? FILRODENSWMB.GENERATION.SHELF_RANGE;
        this.uiState.continentScale = p.continentScale ?? FILRODENSWMB.GENERATION.CONTINENT_SCALE;
        this.uiState.globalTemp = p.globalTemp;
        this.uiState.seasonOffset = p.seasonOffset;
        this.uiState.latTop = p.latTop;
        this.uiState.latBottom = p.latBottom;
        this.uiState.globalMoisture = p.globalMoisture;
        this.uiState.riverDensity = p.riverDensity;
        this.uiState.springsBaked = payload.springsBaked ?? false;

        this.uiState["noise.offsetX"] = p.noise.offsetX;
        this.uiState["noise.offsetY"] = p.noise.offsetY;
        this.uiState["noise.moistureOffset"] = p.noise.moistureOffset ?? FILRODENSWMB.NOISE.OFFSET_MOISTURE;
        this.uiState["noise.tempOffset"] = p.noise.tempOffset ?? FILRODENSWMB.NOISE.OFFSET_TEMP;
        this.uiState.windDistance = p.climate?.windDistance ?? FILRODENSWMB.CLIMATE.WIND_DISTANCE;
        this.uiState["noise.elevation.scale"] = 1 / p.noise.elevation.scale;
        this.uiState["noise.elevation.octaves"] = p.noise.elevation.octaves;
        this.uiState["noise.elevation.stretch"] = p.noise.elevation.stretch;
        this.uiState["noise.moisture.scale"] = 1 / p.noise.moisture.scale;
        this.uiState["noise.moisture.octaves"] = p.noise.moisture.octaves;

        this.uiState["noise.temperature.scale"] = p.noise.temperature?.scale ? 1 / p.noise.temperature.scale : FILRODENSWMB.NOISE.TEMPERATURE.SCALE;

        this.uiState.customBiomes = payload.customBiomes || [];
        // Falls back to undefined on a map saved before this counter existed, which
        // MapStateManager.getNextCustomBiomeId already treats as "derive it from the biomes
        // that came back above" - see that method's own doc comment for why a deleted biome's
        // ID must never come back into circulation, on a freshly loaded map any more than on
        // one that's stayed open the whole time.
        this.uiState.nextCustomBiomeId = payload.nextCustomBiomeId;
        this.uiState.customRouteStyles = payload.customRouteStyles || [];
        this.uiState.customLabelStyles = payload.customLabelStyles || [];
        this.uiState.customRegionStyles = payload.customRegionStyles || [];

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
                if (layer.regions) {
                    migrateVisibility(layer.regions);
                    layer.regions.forEach((region) => {
                        if (!region.quickStyle) region.quickStyle = "custom"; // Flag old regions as custom overrides
                    });
                }
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

        // Guarantee every pin has a valid `color` property, defaulting to white for legacy maps
        this.mapPins = (payload.mapPins || []).map((pin) => {
            pin.color = pin.color || "#ffffff";
            return pin;
        });

        // Custom pin icons are a world-local registry (see pinIcons.js) - a map authored in a
        // different world, then shared as a JSON import or a copied compendium entry, can
        // reference icon ids this world never registered. They still render (as the protected
        // default), so this is a heads-up rather than a blocker.
        const { affectedPinCount } = findUnresolvedPinIcons(this.mapPins);
        if (affectedPinCount > 0) {
            ui.notifications.warn(game.i18n.format("FILRODENSWMB.UI.UnresolvedPinIconsWarning", { count: affectedPinCount }));
        }

        this.mapRoutes = payload.mapRoutes || [];
        this.regionLayers = payload.regionLayers || [];
        this.landMasks = payload.landMasks || [];
        this.mapLabels = payload.mapLabels || [];
        this.mapDecorations = payload.mapDecorations || [];

        // brushEngine.history is loaded in full, uncapped: it's the permanent replay log this
        // map's terrain/biomes get rebuilt from (see generateTerrain() below and
        // BrushEngine#replayHistory), not session undo/redo data, so it can't be trimmed without
        // permanently losing real painted terrain/biome edits the next time this map is saved.
        //
        // globalHistoryLedger, by contrast, IS session undo/redo bookkeeping (see its
        // declaration in the constructor above for the full explanation), so it's reset to empty
        // here rather than rebuilt from brushEngine.history's length - exactly like pinHistory/
        // pinRedoStack below, which reset to empty for the same reason on the vector side.
        // Loading a map, however much paint history it carries, always starts a fresh undo
        // session: nothing is undoable until an edit is made after this load.
        this.brushEngine.history = payload.history || [];
        this.brushEngine.redoStack = [];
        this.pinHistory = [];
        this.pinRedoStack = [];
        this.globalHistoryLedger = [];
        this.globalRedoLedger = [];

        this.defaultUiState = foundry.utils.deepClone(this.uiState);

        this.render({ parts: ["toolbar", "context"] });
        await this.generateTerrain();
        this.#updateGrid();
        this.canvasEngine.resetCamera();
    }

    #handleInfrastructureClick(x, y) {
        // Route nodes may extend into the buffer so lines can run off the visible map;
        // pins are single-point markers and stay confined to the map itself
        const buffer = this.uiState.activeInfraMode === "route" ? FILRODENSWMB.UI.CANVAS_BUFFER : 0;
        if (x < -buffer || x > this.mapWidth + buffer || y < -buffer || y > this.mapHeight + buffer) return;

        MapStateManager.pushVectorState(this);

        const finalPos = { x, y };

        if (this.uiState.activeInfraMode === "pin") {
            const newPin = {
                id: foundry.utils.randomID(),
                name: getPinIconLabel(this.uiState.activeIcon),
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
        // Region nodes may extend into the buffer, matching scene masks and infrastructure routes
        const buffer = FILRODENSWMB.UI.CANVAS_BUFFER;
        if (x < -buffer || x > this.mapWidth + buffer || y < -buffer || y > this.mapHeight + buffer) return;

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
                const isNearStart = region.points.length >= FILRODENSWMB.LIMITS.MIN_POLYGON_VERTICES &&Math.hypot(region.points[0].x - finalPos.x, region.points[0].y - finalPos.y) < this.currentSnapThreshold;

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
                quickStyle: this.uiState.activeRegionQuickStyle,
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

        const choice = await MapDialogManager.promptUnsavedChanges();

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
                const hash = currentSeed || this.#generateRandomSeed();
                const defaultName = `Terrain Map (${hash})`;

                mapName = await MapDialogManager._promptTextValue(game.i18n.localize("FILRODENSWMB.UI.SaveAs"), game.i18n.localize("FILRODENSWMB.UI.Name"), defaultName);

                if (!mapName) return false; // User cancelled the save prompt
            }

            // 2. Lock the UI and show the spinner
            await this.#startProcessing(game.i18n.localize("FILRODENSWMB.UI.SavingMap"));
            this.currentSaveName = mapName;

            const { currentSeed, params } = MapStateManager.getMapParameters(this);
            const payload = {
                seed: currentSeed,
                generationEngine: this.uiState.generationEngine,
                terrainVersion: this.uiState.terrainVersion,
                world: this.uiState.world,
                springsBaked: this.uiState.springsBaked,
                mapWidth: this.mapWidth,
                mapHeight: this.mapHeight,
                gridType: this.uiState.gridType,
                gridSize: this.uiState.gridSize,
                gridVisible: this.uiState.gridVisible,
                params: params,
                customBiomes: this.uiState.customBiomes,
                nextCustomBiomeId: this.uiState.nextCustomBiomeId,
                customRouteStyles: this.uiState.customRouteStyles,
                customLabelStyles: this.uiState.customLabelStyles,
                customRegionStyles: this.uiState.customRegionStyles,
                history: this.brushEngine?.history || [],
                tectonicFaults: this.tectonicFaults,
                manualRivers: this.manualRivers,
                mapPins: this.mapPins,
                mapRoutes: this.mapRoutes,
                regionLayers: this.regionLayers,
                landMasks: this.landMasks,
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
     *
     * Undo/redo and list deletions pass their own, shorter debounce as `generate` so the
     * deferral rule stays in this one place without slowing them down.
     *
     * @param {object|null} bounds - Spatial bounds of the change, merged into any pending bounds.
     * @param {Function} generate - The debounced generator to run when updates are live.
     */
    requestTerrainUpdate(bounds = null, generate = this.debouncedCanvasTerrain) {
        this.pendingTerrainBounds = SpatialMath.mergeBounds(this.pendingTerrainBounds, bounds);
        if (this.uiState.liveFeatureUpdates) {
            generate();
        } else {
            this.hasPendingFeatureMath = true;
            this.render({ parts: ["editToolbar"] });
        }
    }

    /**
     * Turns automatic terrain generation back on and reports whether changes were deferred
     * while it was paused.
     *
     * Pausing is scoped to a single tool and edit session: the Apply button lives in that
     * tool's edit toolbar, which is unreachable once the tool changes or edit mode ends, so
     * anything deferred would otherwise stay stale with no visible way to apply it. Callers
     * must call this before finishing any in-progress drawing so that a land mask completed by
     * leaving the tool is queued through requestTerrainUpdate() rather than deferred again.
     *
     * @returns {boolean} True if deferred changes exist and the terrain needs regenerating.
     */
    #restoreLiveGeneration() {
        const hadDeferredChanges = this.hasPendingFeatureMath;
        this.uiState.liveFeatureUpdates = true;
        this.hasPendingFeatureMath = false;
        return hadDeferredChanges;
    }

    /**
     * Clears the deferred-changes flag and refreshes the Apply button, but only when the flag
     * was actually set so ordinary generations do not re-render the toolbar.
     */
    #clearPendingFeatureMath() {
        if (!this.hasPendingFeatureMath) return;

        this.hasPendingFeatureMath = false;
        this.render({ parts: ["editToolbar"] });
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
     * Resolves the localised UI label for a modified vector entity.
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
            landMasks: ["FILRODENSWMB.UI.ActionLandMask", "Land Mask"],
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

    /**
     * Serialises every vector input that feeds terrain (elevation) generation, so an undo/redo
     * step can tell whether restoring a snapshot changed anything that requires the terrain to be
     * regenerated rather than merely repainted.
     *
     * Land masks are only read by the guided engine, and there only masks that enclose an area
     * (see FILRODENSWMB.LIMITS.MIN_POLYGON_VERTICES) contribute. Just each mask's operation
     * and vertices are captured: renaming a mask, or undoing the first two nodes of a shape that
     * is still being drawn, does not alter the terrain and must not trigger a regeneration.
     *
     * @returns {string} A string that differs between two states exactly when their terrain differs.
     */
    #serialiseTerrainInputs() {
        const minVertices = FILRODENSWMB.LIMITS.MIN_POLYGON_VERTICES;
        const guidedMasks =
            this.uiState.generationEngine === "guided"
                ? this.landMasks.filter((mask) => mask.points?.length >= minVertices).map((mask) => [mask.operation, mask.points])
                : [];

        return JSON.stringify([this.tectonicFaults, this.manualRivers, guidedMasks]);
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
                    const previousTerrainInputs = this.#serialiseTerrainInputs();
                    const previousFeaturePins = JSON.stringify(this.mapPins.filter((p) => !p.icon));
                    const previousCustomBiomes = JSON.stringify(this.uiState.customBiomes);

                    targetPinStack.push(MapStateManager.getVectorStateSnapshot(this));
                    const state = sourcePinStack.pop();
                    MapStateManager.restoreVectorStateSnapshot(this, state);

                    targetLedger.push("vector");

                    const currentFeaturePins = JSON.stringify(this.mapPins.filter((p) => !p.icon));

                    // Faults, manual rivers and (in guided mode) land masks all change the
                    // elevation data, so an undo/redo that alters any of them needs a terrain
                    // regeneration, not just a repaint.
                    if (previousTerrainInputs !== this.#serialiseTerrainInputs()) {
                        // The pixel layers only change once the terrain is regenerated, so only
                        // the vector layers need redrawing now
                        this._repaintVectors();
                        this.requestTerrainUpdate(null, this.debouncedGenerateTerrain);
                    } else if (previousFeaturePins !== currentFeaturePins) {
                        this._repaintCanvas();
                        this.debouncedGenerateClimate();
                    } else if (previousCustomBiomes !== JSON.stringify(this.uiState.customBiomes)) {
                        // A custom biome's name/colour/rules changing affects only how the biome
                        // layer paints (ProceduralEngine reads uiState.customBiomes fresh every
                        // repaint via MapStateManager.getMapParameters) - no elevation/moisture/
                        // temperature data changed, so a full terrain/climate regenerate would be
                        // wasted work, unlike the fault/river/pin branches above.
                        this._repaintCanvas();
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
                    await this.#refreshChangedTerrain(isUndo ? "Brush undo" : "Brush redo");
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
            // The brushed layer was built from the strokes as they were before this change.
            this.brushEngine.invalidateLayerCache();
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

        // generateTerrain clears the pending flag itself, before it reads any state
        await this.generateTerrain();
    }

    /**
     * Highly destructive action: Rebuilds the underlying webgl canvas and spatial arrays.
     */
    async _onApplyResolution(event, target) {
        const formData = new foundry.applications.ux.FormDataExtended(target.form).object;

        const newWidth = Number.parseInt(formData.mapWidth) || FILRODENSWMB.DEFAULTS.MAP_WIDTH;
        const newHeight = Number.parseInt(formData.mapHeight) || FILRODENSWMB.DEFAULTS.MAP_HEIGHT;
        let newSeed = formData.mapSeed?.trim();

        // Extract the dropdown choice
        const newEngine = formData.generationEngine || "standard";

        // If the user left the seed blank, generate a random one automatically
        if (!newSeed) {
            newSeed = this.#generateRandomSeed();
        }

        const canProceed = await this.#gateUnsavedChanges();

        if (!canProceed) {
            // The user cancelled the action
            if (target.name === "generationEngine") {
                target.value = this.uiState.generationEngine;
            }
            this.render({ parts: ["context"] });
            return false;
        }

        // Calculate the centre-anchor offset
        const dx = (newWidth - this.mapWidth) / 2;
        const dy = (newHeight - this.mapHeight) / 2;

        this.mapWidth = newWidth;
        this.mapHeight = newHeight;

        MapStateManager.allocateBuffers(this);

        this.defaultUiState = MapStateManager.buildDefaultUiState(newWidth, newHeight);
        this.uiState = foundry.utils.deepClone(this.defaultUiState);
        this.uiState.mapSeed = newSeed;

        // Inject the engine choice into the wiped state
        this.uiState.generationEngine = newEngine;

        // Reset biome colours to defaults so the DOM sync catches them
        this.customBiomeColors = {};
        Object.entries(FILRODENSWMB.BIOMES).forEach(([key, rgb]) => {
            this.customBiomeColors[key] = rgb;
        });

        this.render({ parts: ["toolbar", "context"] });

        // 1. Reset all history and spatial arrays except for the land masks, which are preserved if switching to Guided Mode
        this.markDirty();
        this.brushEngine = new BrushEngine(this.mapWidth, this.mapHeight);
        this.manualRivers = [];
        this.tectonicFaults = [];
        this.mapPins = [];
        this.mapRoutes = [];
        this.regionLayers = [];

        // Apply the centre offset to keep masks perfectly framed
        this.landMasks =
            newEngine === "guided"
                ? this.landMasks.map((mask) => ({
                      ...mask,
                      points: mask.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
                  }))
                : [];

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
        this.activeLandMaskId = null;

        // 3. Wipe the save memory so the next save forces a "Save As" prompt
        this.currentSaveId = null;
        this.currentSaveName = null;

        // 4. If switching to Guided Mode, auto-activate the drawing tools
        if (newEngine === "guided") {
            this.activeTool = "scene";
            this.uiState.sceneMode = "addMask";
            this.uiState.isEditMode = true;
        } else {
            this.uiState.isEditMode = false;
        }

        if (this.canvasEngine) {
            this.canvasEngine.setEditMode(this.uiState.isEditMode);
        }
        this.#updateCanvasModes(this.activeTool);

        await this.generateTerrain();
        this.#updateGrid();
        this.canvasEngine.resetCamera();

        // 5. Force UI to update
        this.render({ parts: ["toolbar", "context", "editToolbar"] });
        return true;
    }

    _onChangeTool(event, target) {
        const newTool = target.dataset.tool;
        if (!newTool || this.activeTool === newTool) return;

        // 1. Teardown current state. Automatic generation always comes back on when the tool
        // changes; changes deferred by the pause toggle are generated now (which also covers a
        // land mask completed below), otherwise a completed mask is queued as usual.
        const hadDeferredChanges = this.#restoreLiveGeneration();
        const maskCompleted = this.#clearActiveDrawingStates();
        if (hadDeferredChanges) this.generateTerrain();
        else if (maskCompleted) this.requestTerrainUpdate();
        this.#deactivateEditMode();
        this.#clearMassEditState();

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

    /**
     * Ends whichever line or polygon is currently being drawn, e.g. because the user is leaving
     * the tool. Unfinished regions and land masks that never became a shape are discarded.
     *
     * Regenerating terrain is left to the caller because the right moment differs: changing tool
     * can queue it as usual, but entering 3D view must finish generating before it reads the
     * elevation data.
     *
     * @returns {boolean} True if a land mask was completed and the terrain needs regenerating.
     */
    #clearActiveDrawingStates() {
        for (const config of Object.values(FILRODENSWMB.ENTITY_CONFIG)) {
            this[config.activeKey] = null;
        }
        this._finishActiveRegion();

        return this._finishActiveLandMask();
    }

    /**
     * Ends Mass Edit Select mode for every item type when the active tool changes. Select mode
     * is scoped to the tool panel it was turned on in - a GM who switches tools has left that
     * panel behind, so leaving the selection active (and the checkboxes it would need to keep
     * showing) would be confusing when they come back. Discards the selection with no side
     * effects, same as toggling Select off directly - nothing has been edited yet.
     */
    #clearMassEditState() {
        for (const type of Object.keys(this.massEditMode)) {
            this.massEditMode[type] = false;
            this.massEditSelection[type].clear();
        }
    }

    /**
     * Whether `type`'s Select toggle should be greyed out and inert because a sibling type in
     * the same MASS_EDIT_EXCLUSIVE_GROUPS entry already has Select mode active. See that
     * constant's comment for why this matters.
     */
    #isMassEditBlocked(type) {
        const group = MapStudioApp.MASS_EDIT_EXCLUSIVE_GROUPS.find((siblings) => siblings.includes(type));
        return !!group && group.some((sibling) => sibling !== type && this.massEditMode[sibling]);
    }

    async #deactivateEditMode() {
        if (!this.uiState.isEditMode) return;

        this.uiState.isEditMode = false;
        this.brushEngine?.endStroke();
        if (this.canvasEngine) {
            this.canvasEngine.setEditMode(false);
            if (this.canvasEngine.setCropMode) this.canvasEngine.setCropMode(false);
        }

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
            const isCropAllowed = ["standard", "flat"].includes(this.uiState.generationEngine);
            this.canvasEngine.setCropMode(newTool === "scene" && this.canvasEngine.isEditMode && isCropAllowed);
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

                // Flag now, at import time, rather than waiting for the GM to load the map -
                // custom pin icons are world-local (see pinIcons.js), so a JSON export from a
                // different world commonly won't resolve here.
                const { affectedPinCount } = findUnresolvedPinIcons(parsedData.mapPins);
                if (affectedPinCount > 0) {
                    ui.notifications.warn(game.i18n.format("FILRODENSWMB.UI.UnresolvedPinIconsWarning", { count: affectedPinCount }));
                }

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
     * Prompts the GM to choose which Style Library registries to bundle into a shareable JSON
     * file, then downloads the result. Mirrors #handleMapExport's Blob-download pattern - a
     * client-side file save, no server round trip.
     */
    async _onExportSettings(event, target) {
        const categories = MapStudioApp.STYLE_LIBRARY_CATEGORIES.map(({ key, labelKey }) => {
            const count = (this.uiState[key] || []).length;

            return {
                key,
                labelKey,
                count,
                countLabel:
                    count > 0
                        ? game.i18n.format("FILRODENSWMB.UI.ExportSettingsCount", { count })
                        : game.i18n.localize("FILRODENSWMB.UI.ExportSettingsCountEmpty"),
            };
        });

        const content = await foundry.applications.handlebars.renderTemplate("modules/filrodens-world-map-builder/templates/dialogs/export-settings.hbs", { categories });

        const selectedKeys = await foundry.applications.api.DialogV2.prompt({
            classes: ["fwmb"],
            window: { title: game.i18n.localize("FILRODENSWMB.UI.ExportSettings") },
            content: content,
            ok: {
                callback: (event, button) => MapStudioApp.STYLE_LIBRARY_CATEGORIES.map(({ key }) => key).filter((key) => button.form.elements[key]?.checked),
            },
        });

        if (!selectedKeys) return; // User cancelled

        if (selectedKeys.length === 0) {
            ui.notifications.warn(game.i18n.localize("FILRODENSWMB.UI.ExportSettingsNoneSelected"));
            return;
        }

        this.#downloadStyleLibraryExport(selectedKeys);
    }

    /**
     * Builds the export payload for the chosen categories and triggers the browser download.
     * IDs are deliberately stripped from every entry - Custom Biome IDs are sequential per-map
     * integers and Quick Style IDs are random strings, and both get freshly assigned on import
     * (see #importStyleLibraryCategories) rather than trusting whatever the source map had, to
     * avoid colliding with IDs already in use on the importing map.
     */
    #downloadStyleLibraryExport(selectedKeys) {
        const categories = {};
        for (const key of selectedKeys) {
            categories[key] = (this.uiState[key] || []).map(({ id, ...rest }) => rest);
        }

        const exportData = {
            schemaVersion: 1,
            fwmbVersion: game.modules.get(FILRODENSWMB.ID)?.version || "unknown",
            categories,
        };

        const fileName = (this.currentSaveName || "fwmb-styles").replace(/[^a-z0-9]/gi, "_").toLowerCase();

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `fwmb_styles_${fileName}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
    }

    /**
     * Opens a system file dialogue, validates a Style Library export, and appends every entry
     * that isn't already on this map into the current map's registries. Additive only - never
     * replaces or renames anything already present - but an entry whose full content already
     * matches one already on the map (see #styleEntrySignature) is recognised as a duplicate
     * and silently skipped, so re-importing the same file (or two files that overlap) doesn't
     * pile up repeat copies of every style.
     */
    async _onImportSettings(event, target) {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json";

        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            try {
                const text = await file.text();
                const parsedData = JSON.parse(text);

                if (!parsedData.categories || typeof parsedData.categories !== "object") {
                    throw new Error("Invalid FWMB Style Library Schema");
                }

                const { importedCount, duplicateCount, customBiomesImported } = this.#importStyleLibraryCategories(parsedData.categories);

                if (importedCount === 0) {
                    const emptyKey = duplicateCount > 0 ? "FILRODENSWMB.UI.ImportSettingsAllDuplicates" : "FILRODENSWMB.UI.ImportSettingsEmpty";
                    ui.notifications.warn(game.i18n.localize(emptyKey));
                    return;
                }

                this.markDirty();
                this.render({ parts: ["context"] });

                // Unlike Route/Region/Label quick styles - which only affect the map once a user
                // explicitly selects one to paint or create something new with - an imported custom
                // biome's `rules` apply themselves immediately, against terrain that's already been
                // generated. Without this, an imported biome with rules silently doesn't show up
                // until something else happens to trigger a repaint (e.g. opening the Rule Editor
                // and clicking Accept unchanged).
                if (customBiomesImported) this._repaintCanvas();

                const successMessage =
                    duplicateCount > 0
                        ? game.i18n.format("FILRODENSWMB.UI.ImportSettingsSuccessWithDuplicates", { count: importedCount, duplicates: duplicateCount })
                        : game.i18n.format("FILRODENSWMB.UI.ImportSettingsSuccess", { count: importedCount });
                ui.notifications.info(successMessage);
            } catch (err) {
                console.error("FWMB | Style Library Import Failed:", err);
                ui.notifications.error(game.i18n.localize("FILRODENSWMB.UI.ImportSettingsError"));
            }
        };

        input.click();
    }

    /**
     * Builds a canonical signature for a Style Library entry's content, ignoring `id` (which is
     * always reassigned on import - see #importStyleLibraryCategories - so it must never affect
     * whether two entries count as "the same"). Most fields across all four categories (Custom
     * Biomes and the three Quick Style registries) are a primitive, a string, or a flat array
     * (Custom Biome `color`); the exception is Custom Biomes' `rules` (a nested array of rows,
     * each holding per-axis arrays of `[min, max, openMin, openMax]` segments - see
     * BiomeRuleEngine), which `JSON.stringify` still serialises correctly here since two equal
     * rule sets are always produced by the same code paths (RuleEditorDialog's row/segment
     * builders), so key order stays consistent between them - no separate deep-equality check
     * is needed for it.
     */
    #styleEntrySignature(entry) {
        const { id, ...rest } = entry;
        return JSON.stringify(Object.keys(rest).sort().map((key) => [key, rest[key]]));
    }

    /**
     * Appends every recognised category's entries into the current map's uiState, assigning
     * each a fresh ID rather than trusting the file's own (see the ID-collision note on
     * #downloadStyleLibraryExport). A category missing from the file, or whose value isn't an
     * array, is simply skipped; an entry without a string `name` is dropped rather than failing
     * the whole import, since one malformed row shouldn't block every valid one alongside it.
     * An entry whose content already matches one already on the map - or an earlier entry in
     * this same file - is recognised as a duplicate and skipped rather than appended again, so
     * importing the same file twice (or two files sharing some styles) can't duplicate a style.
     * @returns {{importedCount: number, duplicateCount: number, customBiomesImported: boolean}}
     * How many entries were actually appended, how many were recognised as duplicates and
     * skipped, across all categories, and whether the `customBiomes` category specifically got
     * any new entries - the caller uses that last flag to know whether a biome-layer repaint is
     * needed (see _onImportSettings), since an imported biome's `rules` can immediately claim
     * pixels on the already-generated map, unlike a Route/Region/Label quick style, which only
     * affects the map once a user actually selects it to paint or create something new with.
     */
    #importStyleLibraryCategories(categories) {
        let importedCount = 0;
        let duplicateCount = 0;
        let customBiomesImported = false;

        for (const { key } of MapStudioApp.STYLE_LIBRARY_CATEGORIES) {
            const entries = categories[key];
            if (!Array.isArray(entries) || entries.length === 0) continue;

            const validEntries = entries.filter((entry) => entry && typeof entry === "object" && typeof entry.name === "string");
            if (validEntries.length === 0) continue;

            const existing = this.uiState[key] || [];
            const knownSignatures = new Set(existing.map((entry) => this.#styleEntrySignature(entry)));

            const newEntries = [];
            for (const entry of validEntries) {
                const signature = this.#styleEntrySignature(entry);
                if (knownSignatures.has(signature)) {
                    duplicateCount++;
                    continue;
                }
                knownSignatures.add(signature); // also catches duplicates within this same file, not just against the map
                newEntries.push(entry);
            }
            if (newEntries.length === 0) continue;

            const idAssigned = key === "customBiomes" ? this.#assignSequentialBiomeIds(newEntries) : newEntries.map((entry) => ({ ...entry, id: foundry.utils.randomID() }));

            this.uiState[key] = [...existing, ...idAssigned];
            importedCount += idAssigned.length;
            if (key === "customBiomes") customBiomesImported = true;
        }

        return { importedCount, duplicateCount, customBiomesImported };
    }

    /**
     * Assigns sequential Custom Biome IDs to a batch of imported biomes. MapStateManager's
     * helper now reserves each ID by advancing uiState.nextCustomBiomeId as it hands it out, so
     * calling it once per entry (rather than once for the whole batch) is what gives every entry
     * a distinct ID - both from the map's existing biomes and from each other - and leaves the
     * counter correctly advanced for whatever's created or imported next.
     */
    #assignSequentialBiomeIds(entries) {
        return entries.map((entry) => ({ ...entry, id: MapStateManager.getNextCustomBiomeId(this.uiState) }));
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
            // The brushed layer was built from the strokes as they were before this change.
            this.brushEngine.invalidateLayerCache();
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
        this.uiState.mapSeed = this.#generateRandomSeed();
        this.render({ parts: ["context"] });
    }

    /**
     * Generates a random 6-character alphanumeric seed (uppercased) - the one place this logic
     * lives, so anywhere a blank or randomised map seed is needed (this button, an auto-generated
     * default map name, a blank seed left on the Create/Convert Map dialogue) goes through the same
     * approach rather than each call site inventing its own.
     */
    #generateRandomSeed() {
        return Math.random().toString(36).substring(2, 8).toUpperCase();
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
        this._finishActiveRegion();
        this.activeRegionLayerId = id;
        this.render({ parts: ["context"] });
    }

    /**
     * Handles swapping between the Raise, Lower, and Smooth brush tools - and, for the Biomes
     * tool specifically, doubles as the "stop erasing" side of the Paint/Eraser pair. Biomes
     * only ever has the one real tool ("paint"), so clicking it while the Eraser Biome is
     * active isn't a genuine tool switch; it's the natural place for a GM to expect painting a
     * real biome to resume, so it restores whatever biome was selected before Erase was clicked
     * (see _onSetBrushBiome) instead of silently leaving the brush still set to erase.
     */
    _onSetBrushTool(event, target) {
        const stateKey = `${this.activeTool}BrushTool`;
        this.uiState[stateKey] = target.dataset.tool;

        if (this.activeTool === "biomes" && this.uiState.brushBiome === FILRODENSWMB.BIOME_IDS.ERASER) {
            this.uiState.brushBiome = this.uiState.lastPaintBiome ?? FILRODENSWMB.BIOME_IDS.GRASSLAND;
        }

        this.render({ parts: ["toolbar", "editToolbar"] });
    }

    /**
     * Sets which biome id the Biomes brush paints, from a toolbar icon rather than the
     * `brushBiome` dropdown - currently only used for the Eraser Biome (id 0), which is
     * deliberately excluded from that dropdown's list. Reads target.dataset.biome as a real
     * Number rather than leaving it as the string the dropdown's own change handler stores,
     * since BrushEngine's paint guards compare paintValue with strict equality.
     *
     * Remembers the real biome that was selected before switching to Erase, in `lastPaintBiome`,
     * so _onSetBrushTool can restore it if the GM clicks back to Paint rather than picking a new
     * biome from the dropdown themselves.
     */
    _onSetBrushBiome(event, target) {
        const biome = Number(target.dataset.biome);

        if (biome === FILRODENSWMB.BIOME_IDS.ERASER && this.uiState.brushBiome !== FILRODENSWMB.BIOME_IDS.ERASER) {
            this.uiState.lastPaintBiome = this.uiState.brushBiome;
        }

        this.uiState.brushBiome = biome;
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

        // Finish the previous region first; one left with too few points to be a shape is discarded
        this._finishActiveRegion();

        // Explicitly create the new region object so it immediately appears in the sidebar accordion
        this.activeRegionId = foundry.utils.randomID();
        layer.regions.push({
            id: this.activeRegionId,
            name: `Region ${layer.regions.length + 1}`,
            description: "",
            points: [], // Starts empty until the user clicks the canvas
            quickStyle: this.uiState.activeRegionQuickStyle,
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
        this.uiState.activeRegionQuickStyle = "custom";
        this.render({ parts: ["toolbar", "editToolbar"] });

        if (this.activeRegionId && this.activeRegionLayerId) {
            const layer = this.regionLayers.find((l) => l.id === this.activeRegionLayerId);
            const region = layer?.regions.find((r) => r.id === this.activeRegionId);
            if (region) {
                region.quickStyle = "custom";
                if (targetProperty === "line") region.lineColor = color;
                else region.fillColor = color;
                this._repaintVectors();
            }
        }
    }

    /**
     * Handles switching between Add Land and Remove Land while editing guided-mode land masks.
     * Genuinely switching mode should finish whatever mask is currently being drawn first - the
     * same way _onSetFeatureMode ends the active fault and _onSetInfraMode ends the active route
     * when their own mode toggles change - otherwise clicks after switching kept extending the
     * mask already in progress under its original Add/Remove type instead of starting a new one.
     * Mirrors exactly what #handleRightClick already does to finish a land mask, since switching
     * mode is meant to have the same "I'm done with this shape" effect a right-click would.
     */
    _onSetSceneMode(event, target) {
        this.uiState.sceneMode = target.dataset.mode;

        if (this.activeLandMaskId) {
            const needsTerrain = this._finishActiveLandMask();
            this._repaintVectors();
            if (needsTerrain) this.requestTerrainUpdate();
        }

        this.render({ parts: ["toolbar", "editToolbar"] });
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

        // 2. Entering 3D Mode: Teardown state. A land mask completed by leaving the tool has to be
        // generated now, otherwise the 3D scene below would be built from the previous terrain.
        // Changes deferred by the pause toggle need generating for the same reason.
        const hadDeferredChanges = this.#restoreLiveGeneration();
        if (this.#clearActiveDrawingStates() || hadDeferredChanges) await this.generateTerrain();
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
            // Auto-activate the mask drawing tool
            if (this.uiState.generationEngine === "guided") {
                this.uiState.sceneMode = "addMask";
            }

            const stillValid = this.regionLayers.some((l) => l.id === this.activeRegionLayerId);
            if (!stillValid) {
                this.activeRegionLayerId = this.regionLayers[0]?.id ?? null;
            }
        } else {
            // Leaving edit mode ends the pause: the Apply button is hidden with the toolbar, so
            // deferred changes are generated now (covering a mask completed below) and the next
            // edit session starts with automatic generation on.
            const hadDeferredChanges = this.#restoreLiveGeneration();
            const maskCompleted = this.#clearActiveDrawingStates();

            if (hadDeferredChanges) this.generateTerrain();
            else if (maskCompleted) this.requestTerrainUpdate();
        }

        if (this.canvasEngine) {
            this.canvasEngine.setEditMode(isActivating);

            if (this.canvasEngine.setCropMode) {
                // Only enable the crop tool for standard and flat maps
                const isCropAllowed = ["standard", "flat"].includes(this.uiState.generationEngine);
                this.canvasEngine.setCropMode(isActivating && this.activeTool === "scene" && isCropAllowed);
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
        // (generateTerrain clears the pending flag itself)
        if (this.uiState.liveFeatureUpdates && this.hasPendingFeatureMath) {
            this.generateTerrain();
        }
        this.render({ parts: ["editToolbar"] });
    }

    _onTogglePinDropdown(event, target) {
        const dropdown = target.closest(".fwmb-custom-select").querySelector(".fwmb-select-options");
        if (dropdown) dropdown.classList.toggle("fwmb-hidden");
    }

    _onToggleRegionSmoothing(event, target) {
        this.uiState.regionSmoothing = !this.uiState.regionSmoothing;
        this.uiState.activeRegionQuickStyle = "custom";
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
                region.quickStyle = "custom";
                region.smoothing = this.uiState.regionSmoothing;
                this._repaintVectors();
            }
        }
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

    /**
     * Returns the ids of every entity of a given type that Mass Edit can currently offer for
     * selection. Regions are flattened out of their layers since selection is per-type, not
     * per-layer - a GM mass-editing "regions" expects to pick from all of them at once.
     */
    _getMassEditableIds(type) {
        switch (type) {
            case "pin":
                return (this.mapPins || []).filter((p) => !!p.icon).map((p) => p.id);
            case "route":
                return (this.mapRoutes || []).map((r) => r.id);
            case "label":
                return (this.mapLabels || []).map((l) => l.id);
            case "region":
                return (this.regionLayers || []).flatMap((layer) => (layer.regions || []).map((r) => r.id));
            default:
                return [];
        }
    }

    /**
     * Toggles Mass Edit "Select" mode for one item type. Turning it off discards whatever was
     * selected for that type without applying anything - selecting items is a transient UI
     * action, not an edit, so there is nothing to undo.
     */
    _onToggleMassEditMode(event, target) {
        const type = target.dataset.type;
        if (!type || !(type in this.massEditMode)) return;
        // Belt-and-braces: the template already greys out and disables this toggle while a
        // sibling type is active, but guard the handler too in case a click still reaches it.
        if (!this.massEditMode[type] && this.#isMassEditBlocked(type)) return;

        this.massEditMode[type] = !this.massEditMode[type];
        if (!this.massEditMode[type]) this.massEditSelection[type].clear();

        this.render({ parts: ["context"] });
    }

    /**
     * Handles a single item card's Mass Edit checkbox being ticked or unticked. The checkbox
     * carries its own `data-mass-type` rather than reading the list item's `data-type`,
     * because `data-type` is already overloaded for other purposes on some cards (Custom
     * Labels' list items use `data-type="custom"` to route editLabel/deleteLabel, not
     * "label"), so Mass Edit needs its own unambiguous attribute to pick the right selection.
     */
    _onToggleMassEditItem(event, target) {
        const type = target.dataset.massType;
        const id = target.closest(".fwmb-list-item")?.dataset.id;
        const selection = type && this.massEditSelection[type];
        if (!selection || !id) return;

        if (target.checked) selection.add(id);
        else selection.delete(id);

        this.render({ parts: ["context"] });
    }

    _onMassEditSelectAll(event, target) {
        const type = target.dataset.type;
        const selection = this.massEditSelection[type];
        if (!selection) return;

        this._getMassEditableIds(type).forEach((id) => selection.add(id));
        this.render({ parts: ["context"] });
    }

    _onMassEditSelectNone(event, target) {
        const type = target.dataset.type;
        const selection = this.massEditSelection[type];
        if (!selection) return;

        selection.clear();
        this.render({ parts: ["context"] });
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
            case "landMask": {
                const mask = this.landMasks.find((m) => m.id === id);
                return mask?.points || [];
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
