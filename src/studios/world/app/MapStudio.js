import { FILRODENSWMB } from "../../../config.js";
import { StudioCanvas } from "../canvas/StudioCanvas.js";
import { CanvasHints } from "../canvas/CanvasHints.js";
import { LabelFonts } from "../../../kernel/util/LabelFonts.js";
import { LabelWidth } from "../../../kernel/util/LabelWidth.js";
import { RangeDisplay } from "../../../kernel/util/RangeDisplay.js";
import { RangeCurve } from "../../../kernel/util/RangeCurve.js";
import { ListNav } from "../../../shell/ListNav.js";
import { ListReorder } from "../../../shell/ListReorder.js";
import { ProceduralEngine } from "../generation/ProceduralEngine.js";
import { BiomePlacement } from "../generation/BiomePlacement.js";
import { BrushEngine } from "../tools/BrushEngine.js";
import { RenderTimer } from "../../../kernel/util/RenderTimer.js";
import { MapImport } from "../data/MapImport.js";
import { MapTransfer } from "./MapTransfer.js";
import { ImportRefusal, Sanitize } from "../../../kernel/data/Sanitize.js";
import { Scene3D } from "../canvas/Scene3D.js";
import { SpatialMath } from "../../../kernel/util/SpatialMath.js";
import { RefreshQueue } from "../../../kernel/util/RefreshQueue.js";
import { ColorMath } from "../../../kernel/util/ColorMath.js";
import { MapStateManager } from "./MapStateManager.js";
import { MapDialogManager } from "./MapDialogManager.js";
import { bindDropdownMenus, positionPopoverMenu } from "../../../shell/dropdowns.js";
import { getPinIconPickerList, getBuiltinPinIconList, getCustomPinIconList, getPinIconLabel, findUnresolvedPinIcons, usePinIcons, currentPinIcons } from "../../../kernel/data/pinIcons.js";
import { RegionalExtractor } from "./RegionalExtractor.js";
import { ParentRunRecovery } from "./ParentRunRecovery.js";
import { RiverRelay } from "./RiverRelay.js";
import { ShoreRelay } from "./ShoreRelay.js";
import { RunCells } from "./RunCells.js";
import { FirstOpening } from "./FirstOpening.js";
import { RunInputs } from "./RunInputs.js";
import { Infilling } from "./Infilling.js";
import { RandomNames } from "./RandomNames.js";
import { FeatureNames } from "./FeatureNames.js";
import { InfillInput } from "./InfillInput.js";
import { TerrainVersion } from "../tools/TerrainVersion.js";
import { FaultThickness } from "../tools/FaultThickness.js";
import { clampAreaFactor } from "../mesh/Schema.js";
import { gridDistanceOf, kmPerPxOf, scaleBarOnMap, scaleBarTick } from "../data/MapScale.js";
import { cleanUnit, formatDistance, unitFromSaved } from "../../../kernel/data/MapUnit.js";
import { ThematicView } from "./ThematicView.js";
import { HistoryView } from "./HistoryView.js";
import { TravelView } from "./TravelView.js";
import { TerrainUpgrade } from "./TerrainUpgrade.js";
import { RiverSources } from "../generation/RiverSources.js";
import { ProceduralOrchestrator } from "../ProceduralOrchestrator.js";
import { LandMaskGenerator } from "../generation/LandMaskGenerator.js";
import { RandomLandMap } from "../generation/RandomLandMap.js";
import { TectonicFeatureEngine } from "../generation/TectonicFeatureEngine.js";
import { LayerPainting } from "../canvas/LayerPainting.js";
import { MeshIntegration } from "./MeshIntegration.js";
import { NoiseTransform } from "./NoiseTransform.js";
import { VectorHistory } from "./VectorHistory.js";
import { RegionPanel } from "./RegionPanel.js";
import { RegionLists } from "./RegionLists.js";
import { StyleEditors } from "./StyleEditors.js";
import { StyleLists } from "./StyleLists.js";
import { CultureEditor } from "./CultureEditor.js";
import { BiomeEditor } from "./BiomeEditor.js";
import { CultureLists } from "./CultureLists.js";
import { AgeEditor } from "./AgeEditor.js";
import { AgeEventRows } from "./AgeEventRows.js";
import { CultureMarkers } from "./CultureMarkers.js";
import { RegionPainter } from "./RegionPainter.js";
import { InfluencePainter } from "./InfluencePainter.js";
import { InfluenceView } from "./InfluenceView.js";
import { Inspector } from "./Inspector.js";
import { CULTURE_LIST } from "./RegionCultureCard.js";
import { RegionEditor } from "./RegionEditor.js";
import { RouteTool } from "./RouteTool.js";
import { InspectorFields } from "./InspectorFields.js";
import { RouteEditor } from "./RouteEditor.js";
import { PinEditor } from "./PinEditor.js";
import { LabelEditor } from "./LabelEditor.js";
import { PickTool } from "./PickTool.js";
import { DecorationEditor, FaultEditor, LandMaskEditor, RiverEditor } from "./FeatureEditors.js";
import { RiverLabels } from "./RiverLabels.js";
import { LayerSetEditor, LevelEditor } from "./LayerEditors.js";
import { PinStyles } from "./PinStyles.js";
import { GeneratePanel } from "./GeneratePanel.js";
import { ListQuery } from "./ListQuery.js";
import { GeneratorRevision } from "../generator/GeneratorRevision.js";
import { panelSettings } from "../generator/GeneratorSettings.js";
import { allLevels } from "../mesh/LayerTree.js";
import { platform } from "../../../platform/index.js";
import { StudioView } from "../../../shell/StudioView.js";
import { syncMapControls, VIEW_LAYERS } from "../../../shell/MapControls.js";
import { StudioLayout } from "../../../shell/StudioLayout.js";
import { moveAlongModes } from "../../../shell/BarFold.js";
import { AppearanceMenu } from "../../../shell/AppearanceMenu.js";
import { HelpPanel } from "./HelpPanel.js";
import { WorldEditor, WorldsPanel } from "./WorldsPanel.js";
import { WorldThumbnails } from "./WorldThumbnails.js";
import { MapMarks } from "./MapMarks.js";
import { WorldEditors } from "./WorldEditors.js";
import { WorldMapCard, WorldOverview } from "./WorldOverview.js";
import { GenerateAll } from "./GenerateAll.js";
import { DetailLevel } from "./DetailLevel.js";
import { ContentRows } from "./ContentRows.js";
import { GeneratedEdits } from "./GeneratedEdits.js";
import { MaskSettings } from "../generation/MaskSettings.js";
import { rebaseMap } from "../data/SymbolSizes.js";
import { addLocalLevelOnce } from "../data/LocalLevel.js";
import { refreshWaterRoutesOnce } from "../data/WaterRouteStyles.js";
import { showNamesOnce } from "../data/NameLevels.js";
import { SymbolScale } from "../../../kernel/util/SymbolScale.js";
import { nameInset } from "../canvas/MapBorder.js";
import { DrawnDecoration } from "../../../kernel/decorations/DrawnDecoration.js";
import { ExportScale, SceneArea } from "../../../kernel/export/ExportScale.js";
import { ImageFormat } from "../../../kernel/export/ImageFormat.js";
import { GeneratedDetails } from "./GeneratedDetails.js";
import { GridDataExporter } from "./GridDataExporter.js";
import { ExportDialog } from "../../../kernel/export/ExportDialog.js";
import { WORLD_DEFINITION } from "../definition.js";
import { Worlds } from "../../../kernel/worlds/Worlds.js";
import { RegionalRecord } from "../../../kernel/worlds/RegionalRecord.js";
import { MAP_TYPES, WorldRecord } from "../../../kernel/worlds/WorldRecord.js";
import { WorldSettings } from "../data/WorldSettings.js";
import { CropFingerprint } from "./CropFingerprint.js";
import { Blobs } from "../../../kernel/data/Blobs.js";
import { WorldMaps } from "../data/WorldMaps.js";
import { WorldMigration } from "../data/WorldMigration.js";
import { SettlementMaps } from "./SettlementMaps.js";

// Turns a fraction into a percentage for the timing summary
const PERCENT = 100;

/**
 * Longest the processing overlay waits for the browser to paint it before the work it announces
 * starts anyway (see #startProcessing). A browser can stop producing frames for a while (a window
 * minimised or covered, or a graphics card under strain), and refreshes run one at a time, so
 * waiting for a frame alone could hold every later refresh and save up for as long as that lasts.
 */
const OVERLAY_PAINT_WAIT_MAX_MS = 250;

// Brush size assumed when outlining an Undo/Redo preview for a stroke recorded without one
const DEFAULT_STROKE_PREVIEW_SIZE = 20;

// Margin (in map pixels) around a vector entity's points in an Undo/Redo preview, so a single
// pin or a thin line still gets a visible outline
const VECTOR_PREVIEW_PADDING = 50;

/** Where the module's templates are served from (they are named by this path). */
const TEMPLATE_ROOT = "modules/filrodens-world-map-builder/templates/";

/**
 * The kinds of refresh the map runs through its refresh queue (see RefreshQueue):
 *   TERRAIN         - generateTerrain: a full generation, or a refresh of what changed when nothing
 *                     the base terrain depends on has changed.
 *   CHANGED_TERRAIN - a refresh of what changed after brush strokes, undo or redo, or edits to
 *                     faults and rivers (see #refreshChangedTerrain).
 *   CLIMATE         - generateClimate: the climate, then the rivers and the canvas.
 *   FEATURES        - generateFeatures: the rivers, then the canvas.
 */
const REFRESH = Object.freeze({ TERRAIN: "terrain", CHANGED_TERRAIN: "changedTerrain", CLIMATE: "climate", FEATURES: "features" });

/** The icon and name of each kind of decoration in the Decorations list (no kind: an image). */
const DECORATION_ICONS = Object.freeze({ image: "image", compass: "explore", cartouche: "insert-text" });
const DECORATION_LABELS = Object.freeze({ image: "FILRODENSWMB.UI.DecorationKindImage", compass: "FILRODENSWMB.UI.DecorationKindCompass", cartouche: "FILRODENSWMB.UI.DecorationKindCartouche" });

/**
 * The World studio's controller: its state, its regions (the toolbar, the context panel, the map
 * and the edit toolbar), its actions and the map engines behind them. The shell (see Shell) makes
 * it from the World studio's registration and mounts it in the studio's frame with mount(), asks
 * canClose() before the host closes (which may ask about unsaved changes), and calls destroy()
 * when it does. Its tools, stages and their order come from its definition (definition.js), the
 * shell's registration. Everything the studio needs from the host's environment goes through the
 * platform services (see src/platform/index.js).
 *
 * The frame should sit inside an element carrying the "fwmb" class (which the module's styles are
 * scoped to) and carry the studio frame's class, "fwmb-studio".
 */
export class MapStudio {
    /**
     * The studio's action handlers, by the data-action name its templates use. Each is called with
     * the click event and the element carrying the data-action, with the studio as `this` (see
     * StudioView, which dispatches them). They belong to the studio, not to the window around it: a
     * Foundry window given them as its own actions as well would run every handler twice.
     */
    // prettier-ignore
    static ACTIONS = {
        // --- SETTLEMENT MAPS (L-surface): the Local studio's own actions, and opening one ---
        local(e, t)                { SettlementMaps.existing(this)?.act(t.dataset.local, t, e); },
        openSettlementMap(_e, t)   { SettlementMaps.open(this, t.dataset.settlementId); },
        deleteSettlementMap(_e, t) { SettlementMaps.deleteMap(this, t.dataset.settlementId); },
        regenerateSettlementMap(_e, t) { SettlementMaps.regenerate(this, t.dataset.settlementId); },

        // --- STYLES AND ICONS: the map's styles (see StyleLists) ---
        openCulture(e, t)       { if (!MapStudio.#fromRowControl(e, t)) CultureEditor.open(this, t.dataset.id, MapStudio.#FROM_LIST); },
        addCulture(_e, _t)      { CultureLists.startAdding(this); },
        renameCulture(_e, t)    { CultureLists.startRename(this, t.closest("[data-id]")?.dataset.id); },
        duplicateCulture(_e, t) { CultureLists.duplicate(this, t.closest("[data-id]")?.dataset.id); },
        deleteCulture(_e, t)    { CultureLists.delete(this, t.closest("[data-id]")?.dataset.id); },
        openStyle(e, t)      { if (!MapStudio.#fromRowControl(e, t)) StyleEditors.open(this, t.dataset.styleType, t.dataset.id, MapStudio.#FROM_LIST); },
        addStyle(_e, t)      { StyleLists.startAdding(this, t.dataset.styleType); },
        renameStyle(_e, t)   { const row = t.closest("[data-style-type][data-id]"); StyleLists.startRename(this, row?.dataset.styleType, row?.dataset.id); },
        duplicateStyle(_e, t) { const row = t.closest("[data-style-type][data-id]"); StyleLists.duplicate(this, row?.dataset.styleType, row?.dataset.id); },
        deleteStyle(_e, t)   { const row = t.closest("[data-style-type][data-id]"); StyleLists.delete(this, row?.dataset.styleType, row?.dataset.id); },

        // --- MASS EDIT ---
        toggleMassEditMode(e, t)   { this._onToggleMassEditMode(e, t); },
        toggleMassEditItem(e, t)   { this._onToggleMassEditItem(e, t); },
        massEditSelectAll(e, t)    { this._onMassEditSelectAll(e, t); },
        massEditSelectNone(e, t)   { this._onMassEditSelectNone(e, t); },
        openMassEdit(e, t)         { MapDialogManager.onMassEdit(this, e, t); },
        massDelete(_e, t)          { MapDialogManager.massDelete(this, t.dataset.type); },

        // --- DIALOG MANAGER: Entity Deletion ---
        deleteDecoration(e, t)  { MapDialogManager.onDeleteEntity(this, e, t); },
        deleteFault(e, t)       { MapDialogManager.onDeleteEntity(this, e, t); },
        deleteLabel(e, t)       { MapDialogManager.onDeleteEntity(this, e, t); },
        deletePin(e, t)         { MapDialogManager.onDeleteEntity(this, e, t); },
        deleteRegion(_e, t)     { RegionPanel.deleteRegion(this, ...RegionPanel.regionIdsOf(t)); },
        deleteRiver(e, t)       { MapDialogManager.onDeleteEntity(this, e, t); },
        deleteRoute(e, t)       { MapDialogManager.onDeleteEntity(this, e, t); },
        deleteLandMask(e, t)    { MapDialogManager.onDeleteLandMask(this, e, t); },
        deleteAllLandMasks(e, t) { MapDialogManager.onDeleteAllLandMasks(this, e, t); },
        editLandMask(e, t)      { if (!MapStudio.#fromRowControl(e, t)) LandMaskEditor.open(this, MapStudio.#rowId(t), MapStudio.#FROM_LIST); },

        // --- DIALOG MANAGER: Entity Editing ---
        // Each is a list row's action: a click on the row (but not on one of its controls), or Enter
        // on it, opens its object in the inspector, focus staying in the list (see ListNav)
        editDecoration(e, t)  { if (!MapStudio.#fromRowControl(e, t)) DecorationEditor.open(this, MapStudio.#rowId(t), MapStudio.#FROM_LIST); },
        editFault(e, t)       { if (!MapStudio.#fromRowControl(e, t)) FaultEditor.open(this, MapStudio.#rowId(t), MapStudio.#FROM_LIST); },
        editLabel(e, t)       { if (!MapStudio.#fromRowControl(e, t)) LabelEditor.open(this, MapStudio.#labelRef(t), MapStudio.#FROM_LIST); },
        editPin(e, t)         { if (!MapStudio.#fromRowControl(e, t)) PinEditor.open(this, t.closest(".fwmb-list-item").dataset.id, MapStudio.#FROM_LIST); },
        editRegion(_e, t)     { RegionEditor.open(this, ...RegionPanel.regionIdsOf(t)); },
        editRiver(e, t)       { if (!MapStudio.#fromRowControl(e, t)) RiverEditor.open(this, MapStudio.#rowId(t), MapStudio.#FROM_LIST); },
        editRoute(e, t)       { if (!MapStudio.#fromRowControl(e, t)) RouteEditor.open(this, t.closest(".fwmb-list-item").dataset.id, MapStudio.#FROM_LIST); },

        // --- Custom biomes, in the inspector (see BiomeEditor), and the dialogues ---
        addCustomBiome()        { BiomeEditor.add(this); },
        editCustomBiome(e, t)   { if (!MapStudio.#fromRowControl(e, t)) BiomeEditor.open(this, MapStudio.#rowId(t), MapStudio.#FROM_LIST); },
        editBuiltInBiome(_e, t) { BiomeEditor.openBuiltIn(this, t.dataset.biomeKey, MapStudio.#FROM_LIST); },
        deleteCustomBiome(_e, t) { BiomeEditor.delete(this, MapStudio.#rowId(t)); },
        openBiomeRuleEditor(e, t) { MapDialogManager.onOpenBiomeRuleEditor(this, e, t); },
        // Add decoration's menu: an image of the user's (a dialogue) or one the module draws
        addDecoration(e, t)     { if (DrawnDecoration.canCreate(t.dataset.kind)) DecorationEditor.add(this, t.dataset.kind); else MapDialogManager.onAddDecoration(this, e, t); },

        // --- REGIONS PANEL: the cascading lists of sets and levels (see RegionPanel, RegionLists) ---
        // A row opens in the inspector when clicked anywhere but its own controls; every list ends
        // with an add row, whose entry is named in a row of its own first
        addLayerSet()               { RegionLists.startNaming(this, "set"); },
        addRegion(_e, t)            { RegionLists.startNaming(this, "region", { levelId: RegionPanel.levelIdOf(t), parentId: t.closest("[data-parent-id]")?.dataset.parentId ?? null }); },
        addLayer(_e, t)             { RegionLists.addLayer(this, { setId: t.dataset.setId || null, levelId: t.dataset.levelId || null }); },
        renameListEntry(_e, t)      { RegionLists.startRename(this, t.closest("[data-list-key]")?.dataset.listKey); },
        toggleUnassigned(_e, t)     { RegionLists.toggleUnassigned(this, t.closest("[data-level-id]")?.dataset.levelId); },
        selectLayerSet(e, t)        { if (!MapStudio.#fromRowControl(e, t)) LayerSetEditor.open(this, RegionPanel.setIdOf(t), MapStudio.#FROM_LIST); },
        deleteLayerSet(_e, t)       { RegionPanel.deleteSet(this, t); },
        moveLayerSetUp(_e, t)       { RegionPanel.moveSet(this, t, -1); },
        moveLayerSetDown(_e, t)     { RegionPanel.moveSet(this, t, 1); },
        toggleSetVisibility(_e, t)  { RegionPanel.toggleSetVisibility(this, t); },
        editLevel(_e, t)            { LevelEditor.open(this, RegionPanel.levelIdOf(t)); },
        deleteLevel(_e, t)          { RegionPanel.deleteLevel(this, t); },
        autoAssignLevel(_e, t)      { RegionPanel.autoAssign(this, t); },
        fixLevelNesting(_e, t)      { RegionPanel.fixNesting(this, t); },
        massEditLevel(_e, t)        { this.#massEditLevel(RegionPanel.levelIdOf(t)); },
        selectRegion(e, t)          { if (!MapStudio.#fromRowControl(e, t)) this.#selectRegionRow(t); },
        mergeRegion(_e, t)          { RegionPanel.mergeRegion(this, ...RegionPanel.regionIdsOf(t)); },
        moveRegionToPolitical(_e, t) { const [levelId, regionId] = RegionPanel.regionIdsOf(t); RegionPanel.moveToPolitical(this, levelId, [regionId]); },
        changeRegionRank(_e, t)     { RegionPanel.changeRank(this, ...RegionPanel.regionIdsOf(t)); },
        moveLevelToPolitical(_e, t) { RegionPanel.moveToPolitical(this, RegionPanel.levelIdOf(t), null); },
        // --- INFLUENCES (see InfluenceView, InfluencePainter) ---
        chooseInfluenceKind(_e, t)  { InfluenceView.chooseKind(this, t.dataset.kind); },
        clearInfluences(_e, t)      { InfluenceView.clear(this, t.dataset.kind, (title, message) => MapDialogManager._confirmDialog(title, message, { confirmLabel: platform.i18n.localize("FILRODENSWMB.UI.ActionClear") })); },
        // --- GENERATE ---
        generateWorld()             { GeneratePanel.generate(this); },
        generateAll()               { if (this.surfaceMade) GenerateAll.open(this); },
        removeGenerated()           { GeneratePanel.removeGenerated(this); },
        randomizeGeneratorSeed()    { GeneratePanel.randomizeSeed(this); },
        addAge()                    { GeneratePanel.editAges(this, "add"); },
        openAge(e, t)               { if (!MapStudio.#fromRowControl(e, t)) AgeEditor.open(this, t.dataset.id, MapStudio.#FROM_LIST); },
        removeAge(_e, t)            { GeneratePanel.editAges(this, "remove", Number(t.dataset.age)); },
        moveAgeUp(_e, t)            { GeneratePanel.editAges(this, "up", Number(t.dataset.age)); },
        moveAgeDown(_e, t)          { GeneratePanel.editAges(this, "down", Number(t.dataset.age)); },

        // --- DIALOG MANAGER: Pin Icons ---
        addCustomPinIcon(e, t)     { MapDialogManager.onAddCustomPinIcon(this, e, t); },
        editCustomPinIcon(e, t)    { if (!MapStudio.#fromRowControl(e, t)) MapDialogManager.onEditCustomPinIcon(this, e, t); },
        removeCustomPinIcon(e, t)  { MapDialogManager.onRemoveCustomPinIcon(this, e, t); },
        toggleBuiltinPinIcon(e, t) { MapDialogManager.onToggleBuiltinPinIcon(this, e, t); },
        hideAllBuiltinPinIcons(e, t)   { MapDialogManager.onHideAllBuiltinPinIcons(this, e, t); },
        revealAllBuiltinPinIcons(e, t) { MapDialogManager.onRevealAllBuiltinPinIcons(this, e, t); },

        // --- MAP STUDIO APP: Internal Tooling & States ---
        adjustNoiseScale(e, t)          { this._onAdjustNoiseScale(e, t); },
        adjustReferenceScale(e, t)      { this._onAdjustReferenceScale(e, t); },
        applyFeatureMath(e, t)          { this._onApplyFeatureMath(e, t); },
        makeSurfaceMap(e, t)            { this._onMakeSurfaceMap(e, t); },
        createWorld(e, t)               { this._onCreateWorld(e, t); },
        cancelNewWorld(e, t)            { this._onCancelNewWorld(e, t); },
        cancelProcessing()              { this.#cancelRunning?.abort(); },
        keepProcessing()                { this.#keepRunning?.(); },
        changeTool(e, t)                { this._onChangeTool(e, t); },
        // The panel's Next footer: the following tool in the order of work (each tool's registered next)
        nextTool(e, t)                  { this._onChangeTool(e, t); },
        exportPng(e, t)                 { this._onExportPng(e, t); },
        exportScene(e, t)               { this._onExportScene(e, t); },
        // The keyboard shortcuts sheet; also opened with "?" (the About tool will offer it too)
        openShortcuts()                 { this.#openShortcuts(); },
        exportSettings(e, t)            { this._onExportSettings(e, t); },
        generateRandomLandMap(e, t)     { this._onGenerateRandomLandMap(e, t); },
        generateRandomLandMask(e, t)    { this._onGenerateRandomLandMask(e, t); },
        // Cut regional world… (S0 step 5): its foot's Cut and Cancel, Cut again…, and a held
        // regional world's Open parent world settings with the world bar's Back to
        cutRegionalWorld()              { this._onCutRegionalWorld(); },
        cancelCut()                     { this.#cancelCut(); },
        cutAgain(_e, t)                 { this.cutAgain(t.dataset.worldId ?? this.world?.id); },
        openParentSettings()            { this.openParentSettings(); },
        backToRegional()                { this.backToRegional(); },
        importMapJson(e, t)             { this._onImportMapJson(e, t); },
        backUpMaps(e, t)                { this._onBackUpMaps(e, t); },
        restoreBackup(e, t)             { this._onRestoreBackup(e, t); },
        drawThumbnails()                { this._onDrawThumbnails(); },
        importSettings(e, t)            { this._onImportSettings(e, t); },
        selectWorld(e, t)               { this._onSelectWorld(e, t); },
        closeWorlds()                   { this._onCloseWorlds(); },
        showWorld()                     { this.showWorld(); },
        showMap()                       { this.showMap(); },
        selectMapCard(e)                { this.#selectMapCard(e); },
        openWorldTool(_e, t)            { this.openWorldTool(t.dataset.tool, t.dataset.section); },
        revertWorldGroup(_e, t)         { this.revertWorldGroup(t.dataset.tool); },
        goToMapTool(_e, t)              { this.goToMapTool(t.dataset.tool, t.dataset.section); },
        placeHomeland(_e, t)            { this.#placeHomeland(t.dataset.cultureId); },
        removeHomeland(_e, t)           { CultureMarkers.remove(this, t.dataset.cultureId, Number(t.dataset.index)); },
        autoHomelands(_e, t)            { CultureMarkers.clear(this, t.dataset.cultureId); },
        stopWorldPick()                 { this.#stopWorldPick(); },
        nudgeNoise(e, t)                { this._onNudgeNoise(e, t); },
        nudgeReference(e, t)            { this._onNudgeReference(e, t); },
        randomizeSeed(e, t)             { this._onRandomizeSeed(e, t); },
        redoBrush(e, t)                 { if (this.inSettlement) this.#settlementHistory("redo"); else this._onRedoBrush(e, t); },
        removeReferenceImage(e, t)      { this._onRemoveReferenceImage(e, t); },
        resetNoisePan(e, t)             { this._onResetNoisePan(e, t); },
        resetNoiseScale(e, t)           { this._onResetNoiseScale(e, t); },
        resetReferencePan(e, t)         { this._onResetReferencePan(e, t); },
        resetReferenceScale(e, t)       { this._onResetReferenceScale(e, t); },
        resetZoom(e, t)                 { if (this.inSettlement) SettlementMaps.existing(this).resetView(); else this._onResetZoom(e, t); },
        saveMap(e, t)                   { this._onSaveMap(e, t); },
        saveMapAs(e, t)                 { this._onSaveMapAs(e, t); },
        setBrushBiome(e, t)             { this._onSetBrushBiome(e, t); },
        setBrushTool(e, t)              { this._onSetBrushTool(e, t); },
        setFeatureMode(e, t)            { this._onSetFeatureMode(e, t); },
        setInfraMode(e, t)              { this._onSetInfraMode(e, t); },
        setRegionMode(_e, t)            { RegionPainter.setMode(this, t); this.#modeChosen(RegionPainter.mode(this) !== "select"); },
        setInfluenceMode(_e, t)         { InfluencePainter.setMode(this, t); this.#modeChosen(true); },
        toggleRegionShowAll()           { RegionPainter.toggleShowAll(this); },
        setRouteMode(_e, t)             { RouteTool.setMode(this, t); this.#modeChosen(RouteTool.mode(this) !== "select"); },
        setInfrastructureIcon(_e, t)    { this.#choosePinIcon(t.dataset.icon); },
        togglePinDropdown(_e, t)        { this.#togglePinIcons(t); },
        setPickMode(_e, t)              { if (PickTool.setMode(this, t.dataset.mode)) this.#modeChosen(t.dataset.mode !== "select"); },
        setSceneMode(e, t)              { this._onSetSceneMode(e, t); },
        setCartographyMode(_e, t)       { this.uiState.cartographyMode = t.dataset.mode === "move" ? "move" : "select"; this.#modeChosen(false); },
        threeDZoom(_e, t)               { this.scene3D?.zoomBy(t.dataset.zoom === "in" ? MapStudio.#THREE_D_ZOOM : 1 / MapStudio.#THREE_D_ZOOM); },
        threeDResetView()               { this.scene3D?.resetView(); },
        newWorld(e, t)                  { this._onNewWorld(e, t); },
        exportOpenWorld(e, t)           { this._onExportOpenWorld(e, t); },
        toggleAppearance(_e, t)         { AppearanceMenu.toggle(this.root, t); },
        chooseAppearance(_e, t)         { AppearanceMenu.choose(this.root, t); },
        toggleFullscreen()              { platform.frame?.fullscreen?.toggle(); },
        toggleHelp()                    { HelpPanel.toggle(this); },
        toggleEditMode(e, t)            { this._onToggleEditMode(e, t); },
        toggleGrid(e, t)                { this._onToggleGrid(e, t); },
        setDetailLevel(_e, t)           { this.setDetailLevel(Number(t.dataset.detailLevel)); },
        setThematicFill(_e, t)          { this.#setThematic(ThematicView.withFill(this, t.dataset.thematicLayer)); },
        toggleThematicLine(_e, t)       { this.#setThematic(ThematicView.withLine(this, t.dataset.thematicLine)); },
        toggleThematicLegend(_e, t)     { ThematicView.toggleLegend(this, t.dataset.thematicLegendId); },
        chooseHistoryAge(_e, t)         { this.#chooseHistoryAge(Number(t.dataset.age)); },
        focusHistoryRealm(_e, t)        { HistoryView.focusRealm(this, Number(t.dataset.realm)); },
        chooseTravelMode(_e, t)         { TravelView.chooseMode(this, t.dataset.mode); },
        chooseTravelSeason(_e, t)       { TravelView.chooseSeason(this, t.dataset.season); },
        toggleTravelWay()               { TravelView.toggleWay(this); },
        resetTravelSpeeds()             { TravelView.resetSpeeds(this); },
        clearTravelStart()              { TravelView.clearStart(this); },
        fillIn()                        { Infilling.run(this); },
        nameAll()                       { RandomNames.openNameAll(this); },
        nameFeatures()                  { FeatureNames.run(this); },
        toggleLabelOverlaps()           { this.#toggleLabelOverlaps(); },
        setSymbolSize(_e, t)            { this.#setSymbolSize(t.dataset.symbolSize); },
        toggleContentRow(_e, t)         { this.#toggleContentRow(t); },
        toggleLayer(e, t)               { this._onToggleLayer(e, t); },
        toggleLayerMenu(e, t)           { this._onToggleLayerMenu(e, t); },
        openShowPart(_e, t)             { this.#openShowPart(t, { focus: true }); },
        closeShowPart()                 { this.#backToShow(); },
        toggleLiveFeatureUpdates(e, t)  { this._onToggleLiveFeatureUpdates(e, t); },
        toggleTerrainLayer(e, t)        { this._onToggleTerrainLayer(e, t); },
        toggleViewFilter(e, t)          { this._onToggleViewFilter(e, t); },
        toggleLock(e, t)                { this._onToggleLock(e, t); },
        toggleVisibility(e, t)          { this._onToggleVisibility(e, t); },
        undoBrush(e, t)                 { if (this.inSettlement) this.#settlementHistory("undo"); else this._onUndoBrush(e, t); },
        updateMapTerrain(e, t)          { this._onUpdateMapTerrain(e, t); },
        zoomIn(e, t)                    { if (this.inSettlement) SettlementMaps.existing(this).zoomIn(); else this._onZoomIn(e, t); },
        zoomOut(e, t)                   { if (this.inSettlement) SettlementMaps.existing(this).zoomOut(); else this._onZoomOut(e, t); },
        zoomToFeature(e, t)             { this._onZoomToFeature(e, t); },
    };

    /**
     * The studio's regions, in drawing order, for StudioView. Each template draws one root element,
     * which is given the region's classes. The map is drawn once: the PIXI canvas lives in it, and
     * drawing it again would rebuild its container and leave the canvas behind. The edit toolbar is
     * drawn at the top of the map's container, inside the map region.
     */
    static #REGIONS = Object.freeze({
        worldbar: { template: `${TEMPLATE_ROOT}shell/worldbar.hbs`, classes: ["fwmb-worldbar"] },
        // A settlement map's bar, under the world bar (L-surface): empty while none is open
        mapbar: { template: `${TEMPLATE_ROOT}shell/mapbar.hbs`, classes: ["fwmb-mapbar"] },
        toolbar: { template: `${TEMPLATE_ROOT}shell/toolbar.hbs`, classes: ["fwmb-toolbar"] },
        context: { template: `${TEMPLATE_ROOT}shell/context.hbs`, classes: ["fwmb-panel", "fwmb-context-panel"] },
        map: { template: `${TEMPLATE_ROOT}world/map.hbs`, classes: ["fwmb-map"], once: true },
        editToolbar: { template: `${TEMPLATE_ROOT}shell/parts/edit-map-tools.hbs`, classes: ["fwmb-edit-toolbar"], slot: ".fwmb-map-container" },
    });

    /** The element the studio is drawn in (see mount); null before it is mounted and once destroyed. */
    root = null;

    /** Draws and redraws the studio's regions in the root (null until the studio is mounted). */
    view = null;

    /** Whether closing has started, and may still be asking about unsaved changes (see canClose). */
    #closing = false;

    /**
     * Whether the studio has been destroyed (see destroy), with its canvas. Work that was already
     * running when it closed (a refresh part-way through, say) checks this before it draws, since
     * there is nothing left to draw on.
     */
    #shutDown = false;

    /** Stops following the page's full screen (see platform.frame.fullscreen). */
    #stopFullscreenWatch = null;

    /** The save under way, or null (see saveCurrentMap). */
    #activeSave = null;

    /** The open map's saved id and name (null for a map never saved), and whether it has unsaved changes (see the accessors below). */
    #saveId = null;
    #saveName = null;
    #dirty = false;

    /**
     * Whether the open tool edits the map (Create) or reads it (Explore: History, Travel, the 3D
     * view, their panels tagged read only). One rail holds both since S0 step 6 (Ken, 2026-11-20:
     * the Explore stage after Finish, as v4), so the mode is the open tool's.
     */
    get mode() {
        return this.definition.tool(this.activeTool)?.mode === "explore" ? "explore" : "create";
    }

    /**
     * The map tool last open, which the layer switcher's map and an aside's Close go back to; and
     * each world's, for the session only (Ken, 2026-11-18), so reopening a world returns to the
     * tool it was left on.
     */
    #mapTool = null;
    #worldMapTools = new Map();
    // The world the tool is kept for: the one last opened, so a world being opened is not given
    // the last one's while it loads
    #mapToolWorldId = null;

    /** The tool a map opens on when none of its tools has been open yet. */
    static #FIRST_MAP_TOOL = "scene";

    /**
     * The terrain's layers and the two map-control buttons that group them. Each group button
     * opens a list of its layers. The layers are terrain shader settings (see TerrainShading),
     * so switching one redraws without repainting. The keys are the setting names the shader
     * takes; the values are the localisation keys of their names.
     */
    static #TERRAIN_LAYER_GROUPS = Object.freeze({
        terrain: {
            icon: "elevation",
            tooltip: "FILRODENSWMB.UI.LayerTerrain",
            layers: { elevation: "FILRODENSWMB.UI.LayerElevation", relief: "FILRODENSWMB.UI.LayerRelief", water: "FILRODENSWMB.UI.LayerWater" },
        },
        biomes: {
            icon: "forest",
            tooltip: "FILRODENSWMB.UI.LayerBiomes",
            layers: { landBiomes: "FILRODENSWMB.UI.LayerLandBiomes", seaBiomes: "FILRODENSWMB.UI.LayerSeaBiomes" },
        },
    });

    /** The terrain layer (or layers) each tool switches on when it is picked, so its work is visible. */
    static #TOOL_TERRAIN_LAYERS = Object.freeze({
        terrain: ["elevation"],
        biomes: ["landBiomes", "seaBiomes"],
        // Rivers are drawn as part of the Water layer
        features: ["water"],
    });

    /**
     * Which terrain layers are shown. They are not saved with the map: every map opens with all
     * of them on, so a layer switched off for an export can never look like lost work the next
     * time the map is opened.
     */
    #terrainLayers = MapStudio.#allTerrainLayers(true);

    /**
     * Which of the map controls' single layers are shown (see MapControls.VIEW_LAYERS). Like the
     * terrain layers they are not saved with the map; the canvas keeps its layers between maps, so
     * these do too.
     */
    #layerVisibility = Object.fromEntries(VIEW_LAYERS.map((id) => [id, true]));

    /** The terrain layer list that is open, or null (see _onToggleLayerMenu). */
    #openLayerMenu = null;

    /** Measures the studio for its room-dependent layout rules (see StudioLayout); null until mounted. */
    #layout = null;

    /** Runs the refreshes one at a time (see RefreshQueue and #createRefreshQueue). */
    #refreshes;

    /** Paints the pixel layers, sharing whole-map repaints between workers (see LayerPainting). */
    #layerPainting = new LayerPainting();

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
        { key: "customBiomes", labelKey: "FILRODENSWMB.UI.SettingsCustomBiomes" },
        { key: "customPinStyles", labelKey: "FILRODENSWMB.UI.SettingsPinQuickStyles" },
        { key: "customRouteStyles", labelKey: "FILRODENSWMB.UI.SettingsRouteQuickStyles" },
        { key: "customRegionStyles", labelKey: "FILRODENSWMB.UI.SettingsRegionQuickStyles" },
        { key: "customLabelStyles", labelKey: "FILRODENSWMB.UI.SettingsLabelQuickStyles" },
    ];

    /**
     * @param {import("../../../shell/Shell.js").Shell} [shell] - The shell that opened it (none in
     *     tests, which take the World studio's definition as it is).
     */
    constructor(shell = null) {
        this.shell = shell;
        // The studio's registration: its tools, stages and their order (see StudioRegistry)
        this.definition = shell?.definition ?? WORLD_DEFINITION;
        // Settlement maps arriving with a world (a file, a backup) are read by the Local studio's rules
        MapTransfer.local = shell?.registry?.get("local") ?? MapTransfer.local;
        // The map type in view: a world has its Surface map only until Layers 1
        this.mapType = this.definition.mapTypes[0];
        this.canvasEngine = null;
        // The studio opens on Worlds (Ken, 2026-11-19): its Back to goes to the new world it made,
        // on Map setup (see #mapTool), as the studio opened before
        this.activeTool = "manage";
        // Whether a world is open (S0 step 4c-2, board N5: the studio opens with none, on Worlds),
        // and whether its Surface map is made (a world can have no maps, board N3). The canvas and
        // its buffers are made either way, at the default frame, so its code never meets a missing
        // engine; only what is shown depends on these.
        this.worldOpen = false;
        this.surfaceMade = false;
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
        // Each tectonic feature's last worked-out change to the terrain, reused while neither it
        // nor the ground under it changes (see TectonicFeatureEngine). Emptied whenever another
        // map is loaded or created, so it never holds a previous map's features.
        this.tectonicFeatureCache = {};
        this.activeFaultId = null;
        this.manualRivers = [];
        this.activeRiverId = null;
        this.mapPins = [];
        // Studio-session UI state, not map data - deliberately not part of uiState (which is
        // cloned into saved map payloads) since whether this panel is expanded has nothing to
        // do with any particular map.
        // Panel sections the reader has opened that start closed (see the section partial)
        this._expandedSections = new Set();
        // Which collapsible list sections in the tool panels the GM has collapsed, by their
        // data-section key (see #bindCollapsibleFieldsets). Studio-session UI state like the flag
        // above: every section starts open whenever the Studio is opened.
        this._collapsedSections = new Set();
        // Mass Edit selection tool state - also Studio-session UI state, not map data, for the
        // same reason: which items are checked for a batch edit has nothing to do with the map
        // itself, and should reset (not persist) whenever the Studio app is reopened.
        this.massEditMode = { pin: false, route: false, region: false, label: false, river: false };
        this.massEditSelection = { pin: new Set(), route: new Set(), region: new Set(), label: new Set(), river: new Set() };
        // The level whose regions Mass Edit is choosing from (see #massEditLevel)
        this.massEditLevelId = null;
        // The Regions lists: the region chosen in each level's list, the levels whose Unassigned row
        // is open, and the entry being named (see RegionPanel, RegionLists)
        this.regionPath = new Map();
        this.regionUnassignedOpen = new Set();
        this.regionNaming = null;
        // The style being named in Styles and icons (see StyleLists)
        this.styleNaming = null;
        // The culture being named in the Generate panel (see CultureLists)
        this.cultureNaming = null;
        // Each long list's search, filters and page (see ListQuery), for the session
        this.listQueries = {};
        this.mapRoutes = [];
        this.activeRouteId = null;
        // The map's layer sets (see MeshIntegration), and the set, level and region being edited
        this.layerSets = [];
        this.activeLayerSetId = null;
        this.activeLevelId = null;
        this.activeRegionId = null;
        // The generator's saved model-cell outputs (see ModelRun), or null for a map with no run
        this.modelRun = null;
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
        // above (see ProceduralOrchestrator.planRepaint). Sea depth is measured down to it, so a
        // trench below 0 reads as the deepest water. Null until the first repaint, and read as 0
        // until then.
        this.cachedMinElevation = null;
        this.brushEngine = null;

        this.currentSaveId = null;
        this.currentSaveName = null;
        this.currentParentId = null;
        // The open map's world record as last saved (v5; see Worlds), or null for a world not saved
        // yet; and its settings as they stood once the map had loaded (with the defaults a load
        // fills in), which a save compares to say whether they changed (see #worldSettingsNow)
        this.#world = null;
        this.worldSettingsOpened = null;
        // On a held regional map, how many strokes at the head of its history are its parent's
        // (see StrokeHistory and RegionalRecord); undefined on any other map
        this.inheritedStrokes = undefined;
        // A new world's pin icons: the built-ins only, until a saved world is opened
        this.#useWorldIcons(WorldRecord.emptyIcons());

        // What updating the open map to the current terrain rules would change, or null if it is
        // already current or would not change (see TerrainUpgrade). Drives the Update Map button.
        this.terrainUpgrade = null;
        // Size of the map at the top of the open map's chain of crops, when the open map is a
        // legacy regional map (which did not record it) and it could be found by following its
        // parent maps. Used to correct its wind distance, and passed on to regional maps cut from it.
        this.legacyRootSize = null;
        // The parent map's ground beyond a regional map's left and right edges, which its climate
        // reads when it looks upwind past its own edge (see UpwindMargin); null for any other map.
        // Kept as saved, and passed on (and extended) to regional maps cut from this one.
        this.upwindMargin = null;
        // A regional map's copy of the run of the map it was cut from (see ParentRun), which its
        // figures read until it has a run of its own; null for any other map.
        this.parentRun = null;
        // A regional map asked to be filled in when it was cut, until it has been (see Infilling)
        this.infillPending = false;
        // What the last fill-in read, for its Out of date (see Infilling.inputs); null with none
        this.infillInputs = null;
        // Whether a regional map's inherited river routes have been laid over its own rivers (see RiverRelay)
        this.riverRoutesLaid = false;
        // Whether a regional map's inherited ports and river towns stand on its own shore (see ShoreRelay)
        this.shoresPlaced = false;
        this.isDirty = false;

        MapStateManager.allocateBuffers(this);
        this.hasBooted = false;

        this.defaultUiState = MapStateManager.buildDefaultUiState(this.mapWidth, this.mapHeight);

        this.uiState = platform.utils.deepClone(this.defaultUiState);
        PinStyles.ensure(this);
        this.customBiomeColors = {};

        // Collects per-phase timings during a full render for the summary logged when it finishes
        this.renderTimer = new RenderTimer();

        this.#refreshes = this.#createRefreshQueue();

        // Each of these runs a moment after the edit that scheduled it, by which time the studio
        // may have been closed; see #whileOpen
        this.debouncedGenerateTerrain = platform.utils.debounce(this.#whileOpen(() => this.generateTerrain()), FILRODENSWMB.UI.DEBOUNCE_MS.TERRAIN);
        this.debouncedGenerateClimate = platform.utils.debounce(this.#whileOpen((bounds) => this.generateClimate(bounds)), FILRODENSWMB.UI.DEBOUNCE_MS.CLIMATE);
        this.debouncedGenerateFeatures = platform.utils.debounce(this.#whileOpen((bounds) => this.generateFeatures(bounds)), FILRODENSWMB.UI.DEBOUNCE_MS.FEATURES);

        this.debouncedCanvasTerrain = platform.utils.debounce(this.#whileOpen(() => this.generateTerrain()), FILRODENSWMB.UI.DEBOUNCE_MS.CANVAS);
        this.debouncedCanvasClimate = platform.utils.debounce(this.#whileOpen((bounds) => this.generateClimate(bounds)), FILRODENSWMB.UI.DEBOUNCE_MS.CANVAS);

        this.debouncedRepaintCanvas = platform.utils.debounce(this.#whileOpen(() => this._repaintCanvas()), FILRODENSWMB.UI.DEBOUNCE_MS.DISPLAY);

        this.debouncedHistoryRebuild = platform.utils.debounce(this.#whileOpen(() => this.#requestChangedTerrain("Brush stroke rebuild")), FILRODENSWMB.UI.DEBOUNCE_MS.CANVAS);

        // Every refresh that uses the scratch buffer restarts this timer. The buffer is only ever
        // used inside single synchronous steps and refilled before each use, so it can be dropped
        // whenever the timer fires, even between the steps of a refresh.
        this.debouncedReleaseScratch = platform.utils.debounce(() => {
            this.bufferScratch = null;
        }, FILRODENSWMB.UI.DEBOUNCE_MS.SCRATCH_RELEASE);
    }

    /**
     * The queue every refresh of the terrain, climate, rivers and canvas goes through, so that
     * only one runs at a time (see RefreshQueue). The public generate methods and
     * #requestChangedTerrain put requests on it; each kind runs the matching private method,
     * which runs its later stages directly rather than through the queue.
     */
    #createRefreshQueue() {
        const latest = (_waiting, next) => next;
        // Every refresh can change land, water or rivers, which the display mesh summarises per
        // cell: it is told before the refresh runs, and catches up before the vectors are redrawn
        const tracked = (run) => (request) => {
            MeshIntegration.markTerrainChanged(this);
            return run(request);
        };
        return new RefreshQueue(
            {
                [REFRESH.TERRAIN]: { run: tracked(() => this.#generateTerrainNow()), merge: latest },
                [REFRESH.CHANGED_TERRAIN]: { run: tracked(({ title }) => this.#refreshChangedTerrain(title)), merge: latest },
                [REFRESH.CLIMATE]: { run: tracked(({ bounds }) => this.#generateClimateNow(bounds)), merge: (waiting, next) => this.#mergeClimateRequests(waiting, next) },
                [REFRESH.FEATURES]: { run: tracked(({ bounds }) => this.#generateFeaturesNow(bounds)), merge: (waiting, next) => ({ bounds: waiting.bounds && next.bounds ? SpatialMath.mergeBounds(waiting.bounds, next.bounds) : null }) },
            },
            { isStopped: () => this.#shutDown },
        );
    }

    /**
     * Merges two waiting climate refreshes. Both with an area: the area covering both. Otherwise
     * the merged refresh has no area of its own, which means the area painted since the last
     * refresh (pendingTerrainBounds), or the whole map if none was recorded (see
     * #generateClimateNow). The other request's area is added to that record, so it is covered
     * either way.
     */
    #mergeClimateRequests(waiting, next) {
        if (waiting.bounds && next.bounds) return { bounds: SpatialMath.mergeBounds(waiting.bounds, next.bounds) };

        const area = waiting.bounds ?? next.bounds;
        if (area) this.pendingTerrainBounds = SpatialMath.mergeBounds(this.pendingTerrainBounds, area);
        return { bounds: null };
    }

    /**
     * Asks for the terrain to be brought in line with the brush history and the vector features
     * (see #refreshChangedTerrain), after any refresh already running.
     *
     * @param {string} title - Names the run in the console timing summary.
     * @returns {Promise<void>}
     */
    #requestChangedTerrain(title) {
        return this.#refreshes.request(REFRESH.CHANGED_TERRAIN, { title });
    }

    /** Whether the studio is mounted and its canvas can still be drawn on. */
    get #isOpen() {
        return this.root !== null && !this.#shutDown;
    }

    /*
     * The open map's saved id and name and its unsaved state are shown in the host's title (see
     * #showTitle), so each is an accessor that updates the title when it changes. Every place that
     * loads, saves, renames, starts a new map or marks a change goes through them.
     */

    /** The saved map's id, or null for a map that has never been saved. */
    get currentSaveId() {
        return this.#saveId;
    }

    set currentSaveId(id) {
        if (id === this.#saveId) return;
        this.#saveId = id;
        this.#showTitle();
        // The world bar names the world and offers Export world once it is saved
        this.view?.render(["worldbar"]);
    }

    /** The saved map's name, or null for a map that has never been saved. */
    get currentSaveName() {
        return this.#saveName;
    }

    set currentSaveName(name) {
        if (name === this.#saveName) return;
        this.#saveName = name;
        this.#showTitle();
        this.view?.render(["worldbar"]);
        // A cartouche showing the map's name follows it
        this.canvasEngine?.setMapName?.(name);
    }

    /**
     * Makes a world's pin icons the ones the pickers and drawing read (see usePinIcons): a change to
     * them is a change to the world, so the map is marked unsaved.
     * @param {{custom: object[], disabled: string[]}} icons
     */
    #useWorldIcons(icons) {
        usePinIcons(structuredClone(icons ?? WorldRecord.emptyIcons()), () => {
            this.isDirty = true;
        });
    }

    /**
     * The saved maps that read the open world's pin icons (its own and its held regional worlds'),
     * or, for a world not saved yet, none: what removing a custom icon reverts (see pinIcons).
     * @returns {Promise<Set<string>>}
     */
    async _mapsReadingWorldIcons() {
        if (!this.world) return new Set();
        const worlds = await Worlds.all();
        const source = WorldRecord.settingsSource(worlds.get(this.world.id) ?? this.world, (id) => worlds.get(id) ?? null);
        return WorldMaps.readingSettingsOf(source.id);
    }

    /**
     * Whether the open world has changes that are not saved: its Surface map's or settings', or its
     * settlement maps' (kept, changed or deleted since the last save; see SettlementMaps).
     */
    get isDirty() {
        return this.#dirty || !!SettlementMaps.existing(this)?.isDirty;
    }

    /**
     * Raised by every change to the Surface map or the world's settings (each markDirty), so what
     * is drawn from the map can be kept until it changes again: the overview's thumbnail of it
     * (L-surface step 4b; a settlement map's change does not raise it).
     */
    get surfaceStamp() {
        return this.#surfaceStamp;
    }

    #surfaceStamp = 0;

    set isDirty(dirty) {
        // A change to the Surface map is one the settlement maps' source reads
        if (dirty) {
            this.#surfaceStamp++;
            SettlementMaps.invalidate(this);
        }
        // Saved or given up: the settlement maps' changes go with the rest
        else SettlementMaps.existing(this)?.forgetChanges();
        if (dirty === this.#dirty) {
            this.#showDirty();
            return;
        }
        this.#dirty = dirty;
        this.#showTitle();
        this.#showDirty();
    }

    /**
     * The open world (its record as last saved; see Worlds), or null for a world not saved yet.
     * Another world opened (or none) closes the settlement map open in this one, and ends its
     * settlement maps' workers.
     */
    get world() {
        return this.#world;
    }

    set world(next) {
        if ((next?.id ?? null) !== (this.#world?.id ?? null)) {
            if (this.inSettlement) this.leaveSettlement({ render: false });
            SettlementMaps.reset(this);
        }
        this.#world = next;
    }

    #world = null;

    /** The settlement maps were kept, changed or deleted: Save world's mark and the window's title. */
    settlementsChanged() {
        this.#showTitle();
        this.#showDirty();
        this.#updateHistoryButtons();
        this.view?.render(["worldbar"]);
    }

    // ------------------------------------------------------------------ settlement maps (L-surface)

    /** Whether a settlement map (or Make settlement map's choice) is open in the frame. */
    get inSettlement() {
        return SettlementMaps.isOpen(this);
    }

    /**
     * Mounts the Local studio's settlement map in the frame (`claude/v5-l-surface-step2-plan.md`
     * §2): what the Surface map's tool was doing ends, the inspector closes, the PIXI canvas gives
     * way to the settlement's (the frame's fwmb-is-settlement), and the rail, panel, bar and top line
     * become the settlement map's. The Surface map stays loaded, unchanged.
     * @param {() => Promise<*>} open - Opens the settlement map (or the choice) in the controller.
     */
    async enterSettlement(open) {
        const controller = SettlementMaps.controller(this);
        if (!controller) return false;
        if (this.scene3D) await this._onThreeDView();
        this.#restoreLiveGeneration();
        this.#clearActiveDrawingStates();
        await this.#deactivateEditMode();
        this.#clearMassEditState();
        CultureMarkers.stopPick(this);
        AgeEventRows.stopPick(this);
        HelpPanel.forget(this);
        Inspector.close(this);
        platform.dialogs.dismiss({ placement: "docked" });
        const preview = this.root?.querySelector(".fwmb-map-preview");
        if (preview) controller.mountCanvas(preview);
        // The frame shows settlement maps before one opens, so its canvas is measured as shown
        // (measured hidden, as nothing, it asked for tiles thousands of km a side)
        this.root?.classList.add("fwmb-is-settlement");
        let opened;
        try {
            opened = await open();
        } finally {
            this.root?.classList.toggle("fwmb-is-settlement", controller.isOpen);
        }
        this.#applyCanvasInteractivity();
        await this.view?.render(["worldbar", "mapbar", "toolbar", "context", "editToolbar"]);
        return opened;
    }

    /** The ids of the pins with a settlement map of this world's (a re-run's new pins follow them; see SettlementPins). */
    settlementPinIds() {
        return SettlementMaps.linkedPinIds(this);
    }

    /** Undo or Redo on the open settlement map (its own: its Generate again steps). */
    async #settlementHistory(direction) {
        const controller = SettlementMaps.existing(this);
        if (!controller) return;
        await (direction === "redo" ? controller.redo() : controller.undo());
        this.#updateHistoryButtons();
    }

    /** Whether a key is going into a field. */
    static #isTyping(target) {
        return !!target?.closest?.("input, textarea, select, [contenteditable='true']");
    }

    /**
     * Opens another world and, there, a pin in its inspector or one of its settlement maps: a held
     * regional world's Open in <parent world> and Make settlement map in <parent world>… (L-surface
     * step 2b). The open world's unsaved changes are asked about first, as opening any world does.
     * @param {string} worldId
     * @param {{pinId?: string, settlementId?: string}} [where]
     * @returns {Promise<boolean>} Whether it opened.
     */
    async openWorldAt(worldId, { pinId = null, settlementId = null } = {}) {
        const world = await Worlds.get(worldId);
        const mapId = world ? Worlds.mapOf(world) : null;
        if (!mapId) return false;
        await this.openWorld(mapId, world.name, world.id);
        if (this.world?.id !== worldId) return false;
        if (settlementId) await SettlementMaps.open(this, settlementId);
        else if (pinId) await this.leaveSettlementForPin(pinId);
        return true;
    }

    /** Back to the Surface map from a settlement map: the frame shows the Surface map's tool again. */
    leaveSettlement({ render = true } = {}) {
        SettlementMaps.existing(this)?.close();
        this.root?.classList.remove("fwmb-is-settlement");
        this.#applyCanvasInteractivity();
        // The bars always: what follows (a tool opening) draws the rail and panel itself
        this.view?.render(render ? ["worldbar", "mapbar", "toolbar", "context", "editToolbar"] : ["worldbar", "mapbar"]);
        this.#updateHistoryButtons();
    }

    /** The settlement bar's way back: the Surface map in Routes and pins, the pin in its inspector. */
    async leaveSettlementForPin(pinId) {
        this.leaveSettlement({ render: false });
        await this.switchTool("infrastructure", { force: true });
        if (pinId && this.mapPins?.some((pin) => pin.id === pinId)) await PinEditor.open(this, pinId);
    }

    /**
     * The Save button's name for the open map: the map's name when it has one, and that it has
     * unsaved changes when it does.
     */
    #saveLabel(groups = []) {
        const { i18n } = platform;
        if (!this.isDirty) return i18n.localize("FILRODENSWMB.UI.SaveWorld");
        if (!groups.length) return i18n.localize("FILRODENSWMB.UI.SaveWorldUnsaved");
        return i18n.format("FILRODENSWMB.UI.SaveWorldUnsavedGroups", { groups: new Intl.ListFormat(i18n.lang, { type: "conjunction" }).format(groups) });
    }

    /**
     * Marks the rail's Save button with the unsaved-changes dot, in place: the dot comes and goes
     * with every edit, which is no reason to redraw the rail. Save in More (a very short studio)
     * follows, its text the same name, and More shows the dot while it holds Save.
     */
    #showDirty() {
        const button = this.root?.querySelector('.fwmb-worldbar [data-action="saveMap"]');
        if (!button) return;
        const label = this.#saveLabel();
        button.classList.toggle("fwmb-is-dirty", this.isDirty);
        button.setAttribute("aria-label", label);
        button.dataset.tooltip = label;
    }

    /**
     * Save world's name as the pointer or focus reaches it: what is unsaved, the world's settings
     * groups that changed since it opened named (see #saveLabel). Worked out then rather than at
     * every edit, since it reads the whole map's settings.
     */
    #nameUnsaved(event) {
        const button = event.target.closest?.('.fwmb-worldbar [data-action="saveMap"]');
        if (!button || !this.isDirty) return;
        const label = this.#saveLabel(this.#changedGroupNames());
        button.setAttribute("aria-label", label);
        button.dataset.tooltip = label;
    }

    /** The names of the world settings groups changed since the world opened, in the editors' order. */
    #changedGroupNames() {
        if (!this.worldSettingsOpened) return [];
        try {
            const now = this.#worldSettingsNow();
            const changed = new Set(WorldRecord.changedGroups(this.worldSettingsOpened, now));
            // Pin icons are edited with the styles, so they are named as Styles and icons
            if (changed.delete("icons")) changed.add("styles");
            // The terrain engine and seed are kept with World setup's but edited in the Surface
            // map's Map setup (S0 step 4c-2), so they are named as that
            if (changed.has("setup")) {
                const { engine: e1, seed: s1, ...rest1 } = this.worldSettingsOpened.setup ?? {};
                const { engine: e2, seed: s2, ...rest2 } = now.setup ?? {};
                if (e1 !== e2 || s1 !== s2) changed.add("terrain");
                if (WorldRecord.changedGroups({ setup: rest1 }, { setup: rest2 }).length === 0) changed.delete("setup");
            }
            const order = ["terrain", "setup", "cultures", "ages", "nameStyle", "styles", "biomes", "climate"];
            return order.filter((group) => changed.has(group)).map((group) => platform.i18n.localize(MapStudio.#GROUP_NAMES[group]));
        } catch (error) {
            console.warn("FWMB | The world's settings could not be compared:", error);
            return [];
        }
    }

    /** The world settings groups' names, as the World menu names their editors. */
    static #GROUP_NAMES = Object.freeze({
        terrain: "FILRODENSWMB.UI.ToolCreateMap",
        setup: "FILRODENSWMB.UI.WorldSetup",
        cultures: "FILRODENSWMB.UI.WorldCultures",
        ages: "FILRODENSWMB.UI.WorldAges",
        nameStyle: "FILRODENSWMB.UI.WorldNameStyle",
        styles: "FILRODENSWMB.UI.ToolLibrary",
        biomes: "FILRODENSWMB.UI.WorldBiomes",
        climate: "FILRODENSWMB.UI.ToolClimate",
    });

    /** The rail's groups and buttons, for toolbar.hbs (see the studio's definition). */
    #railContext() {
        const { definition } = this;
        // Full screen only where the host offers it and the page may use it (see platform.frame)
        const fullscreen = platform.frame?.fullscreen;
        const occasional = definition.occasional.filter((entry) => entry.host !== "fullscreen" || fullscreen?.enabled()).map((entry) => {
            if (entry.tool) return { ...definition.tool(entry.tool), tool: entry.tool };
            if (entry.menu) return { ...entry, appearance: AppearanceMenu.context() };
            if (entry.host === "fullscreen") return { ...entry, ...this.#fullscreenState() };
            return { ...entry, pressed: false };
        });
        // The world's rail while the world is being worked on (S0 step 4): its tools open through
        // openWorldTool, and the parts a later step builds are drawn disabled with their tooltips
        const { i18n } = platform;
        const worldRail = () => definition.worldRail(this.mapType).map((stage) => ({
            ...stage,
            tools: stage.tools.map((tool) => ({
                ...tool,
                // Generate all acts at once (its dialogue); the others open their panel
                action: tool.act ?? "openWorldTool",
                disabled: !!tool.later,
                tooltip: !tool.later ? i18n.localize(tool.label) : tool.later === tool.label ? i18n.format("FILRODENSWMB.UI.NotBuiltYet", { name: i18n.localize(tool.label) }) : i18n.localize(tool.later),
            })),
        }));
        const inWorld = this.inWorld;
        let railStages = inWorld ? worldRail() : definition.railStages(this.mapType);
        // A world being made has its World setup alone (board N2); a Surface map not made yet its
        // Map setup alone (board N4); a world with no maps has nothing yet for All maps to act on
        const only = (keep) => railStages.map((stage) => ({ ...stage, tools: stage.tools.filter((tool) => keep(tool.id)) })).filter((stage) => stage.tools.length);
        if (this.#creatingWorld) railStages = only((id) => id === "worldSetup");
        else if (!this.surfaceMade && !inWorld) railStages = only((id) => id === "scene");
        else if (!this.surfaceMade && inWorld) railStages = railStages.map((stage) => ({ ...stage, tools: stage.tools.map((tool) => (tool.id === "worldGenerateAll" ? { ...tool, disabled: true, tooltip: i18n.localize("FILRODENSWMB.UI.NeedsSurfaceMap") } : tool)) }));
        // Cut regional world… needs a Surface map the cut can read
        const cutOff = this.cutOff();
        if (inWorld && cutOff) railStages = railStages.map((stage) => ({ ...stage, tools: stage.tools.map((tool) => (tool.id === "worldCut" ? { ...tool, disabled: true, tooltip: cutOff } : tool)) }));
        const unmade = !this.surfaceMade || this.#creatingWorld;
        return {
            railWorld: inWorld,
            railStages,
            // A map's occasional tools are its own; the menus and toggles are on both rails
            railOccasional: inWorld || unmade ? occasional.filter((entry) => !entry.tool) : occasional,
            railOccasionalActive: occasional.some((entry) => entry.tool === this.activeTool),
            helpOpen: HelpPanel.shows(this),
        };
    }

    /**
     * The world bar (worldbar.hbs): the world's name and its menu, Save world, the layer switcher
     * (the Surface map, with Geology and Add a map drawn for the tracks that build them), the mode
     * and the World menu (its items drawn for S0 step 4, which builds them).
     */
    #worldBarContext() {
        const { i18n } = platform;
        const notBuilt = (name) => i18n.format("FILRODENSWMB.UI.NotBuiltYet", { name });
        // No world open (board N5); a world being made (N2); a world whose Surface map is not made (N3, N4)
        const noWorld = !this.worldOpen;
        const creating = this.#creatingWorld;
        const unmade = !noWorld && !this.surfaceMade;
        const name = noWorld ? i18n.localize("FILRODENSWMB.UI.NoWorldOpen") : (creating ? this.#newWorldName : null) || this.world?.name || this.#saveName || i18n.localize("FILRODENSWMB.UI.UnnamedWorld");
        // World, then the world's maps: the switcher says what is being worked on (S0 step 4)
        // In Worlds no world is being worked on yet, so neither is lit
        const inWorld = this.inWorld;
        const inWorlds = this.activeTool === "manage";
        const worldName = i18n.localize("FILRODENSWMB.UI.LayerWorld");
        // A settlement map open: neither World nor the Surface map is worked on, and both lead back,
        // World to the world's tool, the Surface map to its tool (Ken, 2026-11-25: World stayed lit
        // over a settlement map opened from the overview, so choosing it did nothing)
        const inSettlement = this.inSettlement;
        const world = { id: "world", icon: "public", full: worldName, short: worldName, tooltip: i18n.localize("FILRODENSWMB.UI.LayerWorldHint"), current: inWorld && !inSettlement, action: inWorld && !inSettlement ? null : "showWorld" };
        const surface = { id: "surface", icon: unmade ? "add" : "landscape", full: i18n.localize("FILRODENSWMB.UI.LayerSurfaceFull"), short: i18n.localize("FILRODENSWMB.UI.LayerSurface"), current: !inWorld && !inWorlds && !inSettlement, action: inWorld || inWorlds || inSettlement ? "showMap" : null, unmade };
        // Its marks (MapMarks): icons on the segment, the words in its tooltip and the folded menu
        surface.marks = unmade || noWorld ? [] : MapMarks.named(MapMarks.of(MapMarks.state(this, { regionalStale: !!this.world?.held && this.#staleLines.length > 0 })));
        surface.markWords = surface.marks.map((mark) => mark.label).join(", ");
        this.#surfaceMarksDrawn = surface.markWords;
        surface.tooltip = unmade ? i18n.localize("FILRODENSWMB.UI.LayerSurfaceUnmade") : surface.markWords ? i18n.format("FILRODENSWMB.UI.LayerWithMarks", { map: surface.full, marks: surface.markWords }) : surface.full;
        // Nothing to switch to with no world open, nor while one is being made
        if (noWorld || creating) {
            const off = i18n.localize(noWorld ? "FILRODENSWMB.UI.NoWorldOpenHint" : "FILRODENSWMB.UI.CreatingWorldHint");
            Object.assign(world, { action: null, disabled: !world.current, tooltip: world.current ? world.tooltip : off });
            Object.assign(surface, { action: null, disabled: true, tooltip: off });
        }
        const geologyName = i18n.localize("FILRODENSWMB.UI.LayerGeologyFull");
        const geology = { id: "geology", icon: "strata", full: geologyName, short: i18n.localize("FILRODENSWMB.UI.LayerGeology"), disabled: true, tooltip: notBuilt(geologyName) };
        const current = inWorld && !inSettlement ? world : surface;
        return {
            name,
            nameMenuLabel: i18n.format("FILRODENSWMB.UI.WorldNameMenuHint", { name }),
            saved: !!this.#saveId,
            dirty: this.isDirty,
            saveLabel: this.#saveLabel(),
            layers: [world, surface, geology],
            current,
            layerMenuLabel: i18n.format("FILRODENSWMB.UI.LayerMenuHint", { map: current.full }),
            addMap: notBuilt(i18n.localize("FILRODENSWMB.UI.AddMap")),
            settlementMaps: notBuilt(i18n.localize("FILRODENSWMB.UI.SettlementMaps")),
            // The world's settlement maps (L-surface): a searchable menu, naming the one open
            settlements: noWorld || creating ? null : SettlementMaps.menuContext(this),
            noWorld,
            // Save world and Save as have nothing to save with no world open or while one is made
            savesOff: noWorld || creating ? i18n.localize(noWorld ? "FILRODENSWMB.UI.NoWorldOpenHint" : "FILRODENSWMB.UI.CreatingWorldHint") : null,
            fold: this.root?.querySelector(":scope > .fwmb-worldbar")?.dataset.fold ?? "1",
            // A held regional world Out of date (S0 step 5): the mark beside its name, saying why
            stale: !noWorld && this.#staleLines.length ? this.#staleLines.join(" ") : null,
            // Open parent world settings from a regional world: whose settings these are, and the way back
            backTo: this.#backTo ? { label: i18n.format("FILRODENSWMB.UI.WorldsBackTo", { name: this.#backTo.name }), line: i18n.format("FILRODENSWMB.UI.ChangingSettingsLine", { name: this.#backTo.name }) } : null,
        };
    }

    /** The full-screen toggle as it stands: pressed, its icon and its name. */
    #fullscreenState() {
        const pressed = !!platform.frame?.fullscreen?.active();
        return { pressed, icon: pressed ? "fullscreen_exit" : "fullscreen", label: pressed ? "FILRODENSWMB.UI.ExitFullScreen" : "FILRODENSWMB.UI.FullScreen" };
    }

    /** Shows full screen's state on its rail button and its More item, in place (see fullscreenchange). */
    #syncFullscreen() {
        const { pressed, icon, label } = this.#fullscreenState();
        const name = platform.i18n.localize(label);
        for (const control of this.root?.querySelectorAll('[data-action="toggleFullscreen"]') ?? []) {
            if (control.getAttribute("role") === "menuitemcheckbox") control.setAttribute("aria-checked", String(pressed));
            else {
                control.setAttribute("aria-pressed", String(pressed));
                control.setAttribute("aria-label", name);
                control.dataset.tooltip = name;
            }
            const glyph = control.querySelector(".fwmb-icon");
            if (glyph) glyph.className = `fwmb-icon fwmb-icon--${icon}`;
            const text = control.querySelector(".fwmb-menu-text");
            if (text) text.textContent = name;
        }
    }

    /** The engines' short names, for the panel header (the definition's engineInHeader). */
    static #ENGINE_NAMES = Object.freeze({
        standard: "FILRODENSWMB.UI.EngineShortStandard",
        flat: "FILRODENSWMB.UI.EngineShortFlat",
        advanced: "FILRODENSWMB.UI.EngineShortAdvanced",
        guided: "FILRODENSWMB.UI.EngineShortGuided",
    });

    /**
     * The state word of what the active tool's editing does now (its registered stateWord), as the key
     * its strings are named by ("Terraforming"), or null for a tool that cannot edit the map.
     */
    #stateWordKey() {
        const { STATE_WORDS } = FILRODENSWMB.STUDIO;
        const entry = this.definition.tool(this.activeTool)?.stateWord;
        if (!entry) return null;
        if (typeof entry === "string") return STATE_WORDS[entry];
        const mode = {
            scene: this.#sceneModeKey(),
            features: this.uiState.activeFeatureMode,
            infrastructure: this.uiState.activeInfraMode,
        }[this.activeTool];
        return STATE_WORDS[entry[mode]] ?? null;
    }

    /**
     * What Map setup's editing does: a guided map's mask drawing (its scene mode); null for any
     * other map, which has nothing to edit there (the crop is Cut regional world…'s, S0 step 5).
     */
    #sceneModeKey() {
        if (this.uiState.generationEngine !== "guided") return null;
        return ["addMask", "subtractMask", "coastMask"].includes(this.uiState.sceneMode) ? this.uiState.sceneMode : "addMask";
    }

    /**
     * The object the active tool is working on, for the state block and the bar's readout: the
     * region being painted, the route picked, the land mask, river or fault being drawn.
     *
     * @returns {{name: string, swatch?: string}|null}
     */
    #workingObject() {
        switch (this.activeTool) {
            case "regions": {
                const region = RegionPanel.activeRegion(this);
                return region ? { name: region.name, swatch: RegionPainter.toolbarContext(this).activeRegion?.swatch } : null;
            }
            case "infrastructure": {
                if (!this.#isRouteMode()) return null;
                const route = RouteTool.activeRoute(this);
                return route ? { name: route.name, swatch: route.color } : null;
            }
            case "scene": {
                const mask = this.landMasks?.find((entry) => entry.id === this.activeLandMaskId);
                return mask ? { name: mask.name } : null;
            }
            case "features": {
                const line = this.manualRivers?.find((entry) => entry.id === this.activeRiverId) ?? this.tectonicFaults?.find((entry) => entry.id === this.activeFaultId);
                return line ? { name: line.name } : null;
            }
            default:
                return null;
        }
    }

    /**
     * The panel's frame (context.hbs): its header (the tool's name, its stage and step, and the
     * engine where it matters), the state block, and the Next footer.
     */
    #panelContext() {
        const { i18n } = platform;
        const { definition } = this;
        const tool = this.activeTool;
        const entry = definition.tool(tool);

        let meta = "";
        const stage = entry?.stage ? definition.stage(entry.stage) : null;
        if (stage) {
            const stageName = i18n.localize(stage.label);
            const tools = definition.stageTools(tool, this.mapType).map((each) => each.id);
            meta = stage.numbered ? i18n.format("FILRODENSWMB.UI.PanelStep", { stage: stageName, step: tools.indexOf(tool) + 1, count: tools.length }) : stageName;
        }
        if (definition.engineInHeader.includes(tool)) {
            const engine = i18n.localize(MapStudio.#ENGINE_NAMES[this.uiState.generationEngine] ?? MapStudio.#ENGINE_NAMES.standard);
            meta = meta ? i18n.format("FILRODENSWMB.UI.PanelMetaEngine", { meta, engine }) : engine;
        }

        const next = entry?.next;
        return {
            title: i18n.localize(entry?.label ?? ""),
            // What the tool does on this map, under its title (Appearance › Tool descriptions hides it)
            lede: entry?.lede ? i18n.localize(entry.lede) : null,
            // A state of the map that needs action, at the head of every one of its tools
            notice: this.#isMapTool(tool) && this.surfaceMade ? this.#actionNotice() : null,
            // Explore's tools read the map and change nothing on it
            tag: entry?.mode === "explore" ? i18n.localize("FILRODENSWMB.UI.ExploreReadOnly") : null,
            // A world settings editor's: what it edits is the world's, not this map's (board W2);
            // it is drawn as a page with no canvas (round 4c), but while a homeland or an event's
            // place is picked on the map
            worldTag: WorldEditors.isEditor(tool),
            page: WorldEditors.isEditor(tool) && !this.#worldPicking(),
            picking: WorldEditors.isEditor(tool) && this.#worldPicking(),
            meta,
            // Worlds is off every rail and closes from its own header; the world's tools are left by
            // choosing a map in the layer switcher
            closes: WorldEditors.isAside(tool) ? "closeWorlds" : null,
            // Nothing to edit on a Surface map not made yet
            state: this.surfaceMade ? this.#stateBlockContext() : null,
            // No Next while the Surface map is not made: Map setup is all its rail holds
            next: next && this.surfaceMade ? { tool: next.tool, name: i18n.localize(definition.tool(next.tool).label), reason: i18n.localize(next.reason) } : null,
        };
    }

    /** The Surface segment's marks as the world bar last drew them (see #refreshSurfaceMarks). */
    #surfaceMarksDrawn = "";

    /**
     * Redraws the world bar when the Surface map's marks (MapMarks) have changed since it was drawn:
     * a run made or edited since, an undo, a save that makes a regional world Out of date. Whatever
     * changed them redraws a panel, so this follows every redraw that leaves the bar out.
     */
    #refreshSurfaceMarks(regions) {
        // The Surface map cannot change while a settlement map is open: its marks stay as drawn
        if (regions.includes("worldbar") || !this.worldOpen || !this.surfaceMade || this.#creatingWorld || this.inSettlement) return;
        const marks = MapMarks.named(MapMarks.of(MapMarks.state(this, { regionalStale: !!this.world?.held && this.#staleLines.length > 0 })));
        if (marks.map((mark) => mark.label).join(", ") !== this.#surfaceMarksDrawn) this.view?.render(["worldbar"]);
    }

    /**
     * The action notice (S0 step 6; the GoAndNotices card): a state of the open map that needs
     * action, at the head of every one of its tools' panels, or null. In S0 (Refresh from surface is
     * Layers 1's): a held regional world Out of date, with Cut again… and Open parent world
     * settings; and a map whose terrain would change under the latest engine, with the update (once
     * its offer was turned down for good, the update is Map setup's button alone). A run edited
     * since it was made is not one: it shows as a mark (MapMarks).
     * @returns {{title: string, icon: string, lines: string[], actions: Array<{action: string, label: string, icon: string, off?: string, data?: object}>}|null}
     */
    #actionNotice() {
        const { i18n } = platform;
        if (this.world?.held && this.#staleLines.length) {
            // Off, with why, when it cannot run (WorldEditor.cutAgain), as Worlds last drew the world;
            // not yet drawn this sitting, it is offered and Cut again… says why if it cannot
            const node = WorldsPanel.find(this, this.world.id);
            const again = node ? WorldEditor.cutAgain(this, node) : null;
            return {
                title: i18n.localize("FILRODENSWMB.UI.MarkOutOfDate"),
                icon: "sync",
                lines: [...this.#staleLines, i18n.localize("FILRODENSWMB.UI.NoticeStaleHint")],
                actions: [
                    { action: "cutAgain", label: i18n.localize("FILRODENSWMB.UI.WorldCutAgain"), icon: "crop", off: again?.off ?? null, data: { worldId: this.world.id } },
                    { action: "openParentSettings", label: i18n.localize("FILRODENSWMB.UI.OpenParentSettings"), icon: "open-in-new" },
                ],
            };
        }
        if (this.terrainUpgrade && !this.uiState.terrainUpgradeDismissed) {
            return {
                title: i18n.localize("FILRODENSWMB.UI.NoticeOlderTerrain"),
                icon: "warning-mark",
                lines: [i18n.localize("FILRODENSWMB.UI.UpdateMapHint")],
                actions: [{ action: "updateMapTerrain", label: i18n.localize("FILRODENSWMB.UI.UpdateMap"), icon: "sync" }],
            };
        }
        return null;
    }

    /**
     * The state block: the tool's state word, whether it is editing, the object it is working on
     * (or "on"), and the start and stop buttons' names. Cartography has no edit toggle, and tools
     * that cannot edit the map have no block.
     */
    #stateBlockContext() {
        if (this.activeTool === "cartography") return null;
        const word = this.#stateWordKey();
        if (!word) return null;
        const localize = (key) => platform.i18n.localize(key);
        return {
            on: !!this.uiState.isEditMode,
            word: localize(`FILRODENSWMB.UI.StateWord${word}`),
            start: localize(`FILRODENSWMB.UI.StateStart${word}`),
            stop: localize(`FILRODENSWMB.UI.StateStop${word}`),
            badge: this.#workingObject()?.name ?? localize("FILRODENSWMB.UI.StateOn"),
        };
    }

    /** One of the bar's modes (see parts/bar-modes.hbs). */
    static #barMode(action, attr, value, label, tooltip, icon, checked, extra = {}) {
        return { action, attr, value, label, tooltip, icon, checked, ...extra };
    }

    /**
     * The bar's mode groups for the active tool. Modes listed in STUDIO.FOLD_RANK for their group
     * fold into More when the bar runs short (their rank: least used first).
     */
    #barModeGroups() {
        const mode = MapStudio.#barMode;
        const s = this.uiState;
        const foldable = (group, value) => {
            const index = (FILRODENSWMB.STUDIO.FOLD_RANK[group] ?? []).indexOf(value);
            return index === -1 ? 0 : index + 1;
        };
        const group = (label, key, modes) => {
            for (const entry of modes) entry.foldable = foldable(key, entry.value);
            return { label, modes, hasFoldable: modes.some((entry) => entry.foldable) };
        };
        const ui = (suffix) => `FILRODENSWMB.UI.${suffix}`;

        switch (this.activeTool) {
            case "terrain": {
                const tool = s.terrainBrushTool;
                const brush = (value, label, tooltip, icon, iconClass) => mode("setBrushTool", "tool", value, ui(label), ui(tooltip), icon, tool === value, iconClass ? { iconClass } : {});
                return [
                    group(ui("ModesBrush"), "terrain", [
                        brush("raise", "ModeRaise", "ToolRaise", "edit-arrow-up"),
                        brush("lower", "ModeLower", "ToolLower", "edit-arrow-down"),
                        brush("smooth", "ModeSmooth", "ToolSmooth", "landscape"),
                        brush("roughen", "ModeRoughen", "ToolRoughen", "scatter-plot"),
                        brush("slopeUp", "ModeSlopeUp", "ToolSlopeUp", "slope"),
                        brush("level", "ModeLevel", "ToolLevel", "plateau"),
                        brush("slopeDown", "ModeSlopeDown", "ToolSlopeDown", "slope", "fwmb-icon--reverse"),
                    ]),
                ];
            }
            case "biomes": {
                const erasing = s.brushBiome === FILRODENSWMB.BIOME_IDS.ERASER;
                return [
                    group(ui("ModesBrush"), "biomes", [
                        mode("setBrushTool", "tool", "paint", ui("ModePaint"), ui("ToolPaint"), "format-paint", !erasing),
                        mode("setBrushBiome", "biome", String(FILRODENSWMB.BIOME_IDS.ERASER), ui("ModeErase"), ui("ToolEraseBiome"), "ink-eraser", erasing),
                    ]),
                ];
            }
            case "features": {
                const current = s.activeFeatureMode;
                const feature = (value, label, tooltip, icon) => mode("setFeatureMode", "mode", value, ui(label), ui(tooltip), icon, current === value);
                return [group(ui("ModesFeatures"), "features", [feature("select", "ModeSelect", "FeatureModeSelect", "select"), feature("spring", "ModeSource", "ToolAddSpring", "water-drop"), feature("river", "ModeRiver", "ToolDrawRiver", "water"), feature("fault", "ModeFault", "ToolDrawFault", "timeline")])];
            }
            case "scene": {
                if (s.generationEngine !== "guided") return [];
                const current = s.sceneMode;
                return [
                    group(ui("ModesMask"), "scene", [
                        mode("setSceneMode", "mode", "select", ui("ModeSelect"), ui("MaskModeSelect"), "select", current === "select"),
                        mode("setSceneMode", "mode", "addMask", ui("ModeLand"), ui("DrawLandMaskHint"), "add", current === "addMask"),
                        mode("setSceneMode", "mode", "subtractMask", ui("ModeOcean"), ui("DrawOceanMaskHint"), "remove", current === "subtractMask"),
                        // Coast only masks exist only where masks have coast settings (see MaskSettings)
                        ...(TerrainVersion.usesCurrentCoastline(s) ? [mode("setSceneMode", "mode", "coastMask", ui("ModeCoast"), ui("DrawCoastMaskHint"), "tune", current === "coastMask")] : []),
                    ]),
                ];
            }
            case "influences":
                return [group(ui("ModesInfluence"), "influences", InfluencePainter.toolbarContext(this).modes.map((entry) => mode("setInfluenceMode", "mode", entry.value, ui(`Mode${entry.value.charAt(0).toUpperCase()}${entry.value.slice(1)}`), entry.label, entry.icon, entry.active)))];
            case "regions":
                return [group(ui("ModesRegion"), "regions", RegionPainter.toolbarContext(this).modes.map((entry) => mode("setRegionMode", "mode", entry.value, ui(`Mode${entry.value.charAt(0).toUpperCase()}${entry.value.slice(1)}`), entry.label, entry.icon, entry.active)))];
            case "infrastructure": {
                const groups = [
                    group(ui("ModesPlace"), "place", [
                        mode("setInfraMode", "mode", "pin", ui("ModePinShort"), ui("ModePin"), "place", s.activeInfraMode === "pin"),
                        mode("setInfraMode", "mode", "route", ui("ModeRouteShort"), ui("ModeRoute"), "timeline", s.activeInfraMode === "route"),
                    ]),
                ];
                if (this.#isRouteMode()) {
                    const labels = { select: "ModeSelect", draw: "ModeDraw", edit: "ModeWaypoints" };
                    groups.push(group(ui("ModesRoute"), "route", RouteTool.toolbarContext(this).modes.map((entry) => mode("setRouteMode", "mode", entry.value, ui(labels[entry.value]), entry.label, entry.icon, entry.active))));
                } else {
                    groups.push(this.#pickModeGroup(group, "pin", ui("ModesPin")));
                }
                return groups;
            }
            case "labels":
                return [this.#pickModeGroup(group, "label", ui("ModesLabel"))];
            case "cartography": {
                const moving = s.cartographyMode === "move";
                return [
                    group(ui("ModesCartography"), "cartography", [
                        mode("setCartographyMode", "mode", "select", ui("ModeSelect"), ui("DecorationModeSelect"), "select", !moving),
                        mode("setCartographyMode", "mode", "move", ui("ModeMove"), ui("DecorationModeMove"), "open-with", moving),
                    ]),
                ];
            }
            default:
                return [];
        }
    }

    /** The Select and Place modes of a tool that places things (pins, labels; see PickTool). */
    #pickModeGroup(group, key, label) {
        const short = { select: "FILRODENSWMB.UI.ModeSelect", place: "FILRODENSWMB.UI.ModePlace" };
        return group(label, key, PickTool.toolbarModes(this).map((entry) => MapStudio.#barMode("setPickMode", "mode", entry.value, short[entry.value], entry.label, entry.icon, entry.active)));
    }

    /**
     * The bar's own context: its name, its mode groups and the state readout (the state word and
     * the object being worked on while editing, or Viewing).
     */
    #barContext() {
        const localize = (key) => platform.i18n.localize(key);
        const word = this.#stateWordKey();
        const working = this.#workingObject();
        const editing = word && (this.uiState.isEditMode || this.activeTool === "cartography");
        return {
            label: localize("FILRODENSWMB.UI.BarLabel"),
            modeGroups: this.#barModeGroups(),
            state: {
                editing: !!editing,
                word: editing ? localize(`FILRODENSWMB.UI.StateWord${word}`) : localize("FILRODENSWMB.UI.StateViewing"),
                object: working?.name ?? null,
                swatch: working?.swatch ?? null,
            },
        };
    }

    /** The map controls' single toggles, for map.hbs (the terrain groups come from #layerGroupsContext). */
    static #mapControlsContext() {
        return { viewLayers: FILRODENSWMB.STUDIO.VIEW_LAYERS, overlayLayers: FILRODENSWMB.STUDIO.OVERLAY_LAYERS, detailLevels: FILRODENSWMB.DETAIL.LEVELS, symbolSizes: FILRODENSWMB.SYMBOLS.SIZES.map((size) => ({ value: String(size), percent: Math.round(size * 100) })) };
    }

    /**
     * The arrow keys move focus along the rail: down and up (and, as in any toolbar, the inline
     * arrows) to the next and previous button, Home and End to the first and last. Buttons the
     * studio's height has hidden (the folded occasional tools, or More while they show) are skipped.
     *
     * @param {KeyboardEvent} event
     * @returns {boolean} Whether the key was used.
     */
    #moveAlongRail(event) {
        const rail = event.target.closest?.(".fwmb-toolbar");
        if (!rail || event.target.closest(".fwmb-dropdown-menu, .fwmb-appearance-menu")) return false;
        const rtl = rail.ownerDocument.defaultView.getComputedStyle(rail).direction === "rtl";
        const steps = { ArrowDown: 1, ArrowUp: -1, ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 };
        if (!(event.key in steps) && event.key !== "Home" && event.key !== "End") return false;

        const buttons = [...rail.querySelectorAll(".fwmb-rail-btn")].filter((button) => button.offsetParent !== null);
        const index = buttons.indexOf(event.target.closest(".fwmb-rail-btn"));
        let next;
        if (event.key === "Home") next = 0;
        else if (event.key === "End") next = buttons.length - 1;
        else next = (index + steps[event.key] + buttons.length) % buttons.length;
        buttons[next]?.focus();
        return true;
    }

    /** Opens the keyboard shortcuts sheet (Help's Show all shortcuts). */
    openShortcuts() {
        return this.#openShortcuts();
    }

    /** Opens the keyboard shortcuts sheet (see CanvasHints.sheet). */
    async #openShortcuts() {
        const { i18n } = platform;
        const content = await platform.templates.render(`${TEMPLATE_ROOT}shell/dialogs/shortcuts.hbs`, { tools: CanvasHints.sheet((key) => i18n.localize(key)) });
        await platform.dialogs.choose({
            title: i18n.localize("FILRODENSWMB.UI.ShortcutsTitle"),
            content,
            classes: ["fwmb-shortcuts-dialog"],
            resizable: true,
            buttons: [{ action: "close", label: i18n.localize("FILRODENSWMB.UI.Close"), default: true }],
        });
    }

    /**
     * Shows the module's name in the host's title (the window's title in Foundry, the page's on
     * the web), followed by the saved map's name and id when one is open, and marked unsaved
     * while it has unsaved changes.
     */
    #showTitle() {
        if (!this.#isOpen) return;
        const { i18n, frame } = platform;
        let title = i18n.localize("FILRODENSWMB.UI.ControlTitle");
        if (this.#saveId) {
            const id = this.#saveId.slice(0, frame.idLength);
            title = i18n.format("FILRODENSWMB.UI.WindowTitleMap", { title, name: this.#saveName ?? "", id });
        }
        if (this.isDirty) title = i18n.format("FILRODENSWMB.UI.WindowTitleUnsaved", { title });
        frame.setTitle(title);
    }

    /**
     * Wraps work scheduled for later (a debounced refresh) so that it only runs while the studio
     * is open. Closing the studio lets go of its element and destroys its canvas, so a refresh that
     * fires afterwards would fail part-way, and there is nothing left for it to update.
     *
     * @param {Function} work - The work to run, given whatever arguments the wrapper receives.
     * @returns {Function} A function that runs `work` if the studio is still open.
     */
    #whileOpen(work) {
        return (...args) => (this.#isOpen ? work(...args) : undefined);
    }

    markDirty() {
        this.isDirty = true;
    }

    /** Every level of every layer set, in drawing order (the levels the region panel lists). */
    get regionLevels() {
        return allLevels(this.layerSets);
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
     * The template context for one of the studio's regions (see #REGIONS). Most of it is shared by
     * every region; the edit toolbar and the context panel each add their own.
     *
     * @param {string} regionId
     * @returns {Promise<object>}
     */
    async #buildRegionContext(regionId) {
        const context = {};

        context.hasPendingFeatureMath = this.hasPendingFeatureMath;

        context.config = FILRODENSWMB;
        context.activeTool = this.activeTool;
        // Whether the host can export to a scene (Foundry can; the web version cannot)
        context.sceneExport = platform.scene.available;

        if (regionId === "toolbar") Object.assign(context, this.#railContext());
        if (regionId === "worldbar") context.worldBar = this.#worldBarContext();
        if (regionId === "map") Object.assign(context, MapStudio.#mapControlsContext());
        // The settlement map's bar is drawn only while one is open (see SettlementMaps.regionContext)
        if (regionId === "mapbar") {
            SettlementMaps.regionContext(this, regionId, context);
            return context;
        }

        const isVectorTool = FILRODENSWMB.UI.VECTOR_TOOLS.includes(this.activeTool);
        context.isLocked = !!this.uiState.isEditMode && !isVectorTool;
        // The line a paused section shows: "Paused while terraforming."
        const word = this.#stateWordKey();
        context.pausedLine = context.isLocked && word ? platform.i18n.localize(`FILRODENSWMB.UI.StatePaused${word}`) : null;
        if (regionId === "context") context.panel = this.#panelContext();
        if (regionId === "editToolbar") context.bar = this.#barContext();
        // Fault line thickness's range on this map (see FaultThickness), holding the bar's value
        if (regionId === "editToolbar") context.faultThickness = FaultThickness.limits(this.mapWidth, this.uiState.faultThickness);

        if (regionId === "editToolbar") {
            const editableTools = FILRODENSWMB.UI.EDITABLE_TOOLS;

            if (!this.surfaceMade && this.#isMapTool(this.activeTool)) {
                // The Surface map before it is made (board N4): the bar says so, and has no modes
                context.toolbarPartial = `${TEMPLATE_ROOT}world/parts/toolbar-unmade.hbs`;
                context.bar.state = null;
            } else if (this.activeTool === "worldCut") {
                // The crop of a regional world being cut (board W7)
                context.toolbarPartial = `${TEMPLATE_ROOT}world/parts/toolbar-cut.hbs`;
                context.bar.state = null;
                context.cut = this.#cutContext();
            } else if (editableTools.includes(this.activeTool)) {
                context.toolbarPartial = `${TEMPLATE_ROOT}world/parts/toolbar-${this.activeTool}.hbs`;
            } else if (this.activeTool === "generate" && CultureMarkers.picking(this)) {
                // A homeland being placed from Peoples and realms (board C10)
                context.toolbarPartial = `${TEMPLATE_ROOT}world/parts/toolbar-world.hbs`;
                context.bar.state = null;
                context.worldPick = this.#worldPickContext();
            } else if (WorldEditors.isEditor(this.activeTool) && this.#worldPicking()) {
                // A world page giving way to the map while a homeland or an event's place is picked
                context.toolbarPartial = `${TEMPLATE_ROOT}world/parts/toolbar-world.hbs`;
                context.bar.state = null;
                context.worldPick = this.#worldPickContext();
            } else {
                context.toolbarPartial = `${TEMPLATE_ROOT}world/parts/toolbar-empty.hbs`;
            }
        }

        // Every paintable biome, built-in (Deep and Shallow Ocean included, now that they are
        // drawn as the sea bed) then custom, each with its placement
        const builtInBiomes = Object.entries(FILRODENSWMB.BIOME_IDS)
            .filter(([key, id]) => id !== FILRODENSWMB.BIOME_IDS.ERASER && !key.toLowerCase().startsWith("custom"))
            .map(([key, id]) => {
                const defaultRgb = FILRODENSWMB.BIOMES[key] || [0, 0, 0];
                const currentRgb = this.customBiomeColors[key] || defaultRgb;

                return {
                    id: id,
                    key: key,
                    label: `FILRODENSWMB.BIOMES.${key}`,
                    hex: ColorMath.rgbToHex(currentRgb),
                    isCustom: false,
                    placement: BiomePlacement.placementOfBuiltIn(key),
                };
            });

        const customBiomesMapped = (this.uiState.customBiomes || []).map((cb) => ({
            id: cb.id,
            key: `custom_${cb.id}`,
            label: cb.name,
            hex: ColorMath.rgbToHex(cb.color),
            isCustom: true,
            placement: BiomePlacement.placementOfCustom(cb),
        }));

        context.biomeList = [...builtInBiomes, ...customBiomesMapped];
        if (this.activeTool === "worldBiomes") context.biomeTable = BiomeEditor.table(this, context.biomeList);
        context.biomeGroups = MapStudio.#groupBiomesByPlacement(context.biomeList);
        context.layerGroups = this.#layerGroupsContext();

        // The fault types on offer depend on the map's terrain version (see
        // TectonicFeatureEngine.typeOptions); a type left over from a map of the other version is
        // replaced by that version's default, so the toolbar never draws a type it cannot offer
        context.tectonicTypes = TectonicFeatureEngine.typeOptions(this.#isCurrentTerrain());
        this.uiState.faultType = this.#resolveFaultType();
        context.faultIsRange = this.uiState.faultType === FILRODENSWMB.TECTONICS.FEATURES.TYPES.RANGE;
        context.rangeStyles = Object.entries(FILRODENSWMB.TECTONICS.FEATURES.RANGE_STYLES).map(([id, label]) => ({ id, label }));

        const alphaSort = (a, b) => (a.name || "").localeCompare(b.name || "", undefined, { numeric: true, sensitivity: "base" });

        context.tectonicFaults = [...(this.tectonicFaults || [])].sort(alphaSort);
        context.manualRivers = [...(this.manualRivers || [])].sort(alphaSort);
        // The custom rivers Mass Edit has chosen, by id (see tools-features.hbs)
        context.riverSelection = Object.fromEntries([...this.massEditSelection.river].map((id) => [id, true]));

        context.uiState = this.uiState;
        context.worldAreaFactor = clampAreaFactor(this.uiState.world?.areaFactor);
        context.areaFactorRange = { min: FILRODENSWMB.MESH.AREA_FACTOR_RANGE[0], max: FILRODENSWMB.MESH.AREA_FACTOR_RANGE[1] };
        context.mapUnit = cleanUnit(this.uiState.mapUnit);
        // The map controls' Thematic views menu (the map region is drawn once; see ThematicView)
        context.thematic = ThematicView.menuContext();
        // A settlement map's own Thematic views, from the studio that draws them (L-surface step 3)
        context.settlementViews = this.shell?.registry?.get("local")?.views ?? [];
        context.pixelScale = this.#pixelScaleText();
        // The value per tick a bar matching the world draws (a number field, so unformatted)
        context.scaleBarValue = scaleBarTick(this.uiState, this.mapHeight).value;
        context.currentSaveName = this.currentSaveName;
        // Map setup's own Update button once the notice's offer was turned down for good
        context.terrainUpgradeAvailable = this.terrainUpgrade !== null && this.uiState.terrainUpgradeDismissed === true;
        context.usesCurrentCoastline = TerrainVersion.usesCurrentCoastline(this.uiState);
        context.engineLabels = this.#getEngineLabels();
        if (this.activeTool === "scene") context.terrainChoice = this.#terrainChoiceContext();
        // The Coastline Fracture slider's position on its power curve (see RangeCurve)
        context.fractureCurve = FILRODENSWMB.GENERATION.COASTLINE_FRACTURE_CURVE;
        context.fracturePosition = RangeCurve.positionOf(this.uiState.coastlineFracture ?? FILRODENSWMB.GENERATION.COASTLINE_FRACTURE, context.fractureCurve);

        // The object the inspector shows, whose row the lists mark as selected
        context.inspected = Inspector.inspected(this);
        context.infrastructureIcons = getPinIconPickerList(this.uiState.activeIcon);
        const activeIconEntry = context.infrastructureIcons.find((icon) => icon.key === this.uiState.activeIcon);
        context.activeIconPath = activeIconEntry?.path || "";
        context.activeIconIsCustom = activeIconEntry?.isCustom || false;
        context.builtinPinIcons = getBuiltinPinIconList();
        // Read by the templates as collapsedSections.<key>, so a section drawn again stays as the
        // GM left it rather than springing open
        context.collapsedSections = Object.fromEntries([...this._collapsedSections].map((key) => [key, true]));
        // Sections that start closed but were opened (see the section partial)
        context.expandedSections = Object.fromEntries([...this._expandedSections].map((key) => [key, true]));
        context.customPinIcons = getCustomPinIconList();

        // The bar's next-route style: the styles for the bar's transport (and those for any),
        // keeping the one chosen
        const offeredRouteStyle = InspectorFields.forTransport(RouteTool.transport(this));
        context.routeStyles = (this.uiState.customRouteStyles || [])
            .filter((style) => style.id === this.uiState.activeRouteQuickStyle || offeredRouteStyle(style))
            .map((style) => ({
                id: style.id,
                label: style.name,
                isCustom: true,
            }));
        context.pinStyles = PinStyles.choices(this, this.uiState.activePinStyle);

        if (this.activeTool === "regions") context.regionToolbar = RegionPainter.toolbarContext(this);
        if (this.activeTool === "influences") context.influenceToolbar = InfluencePainter.toolbarContext(this);
        if (this.activeTool === "infrastructure") context.routeToolbar = RouteTool.toolbarContext(this);

        context.regionStyles = (this.uiState.customRegionStyles || []).map((style) => ({
            id: style.id,
            label: style.name,
            isCustom: true,
        }));

        // Custom Biomes get no usage count (unlike the styles): "in use" for a biome would mean
        // scanning the biome raster rather than a small vector array.
        context.customBiomes = [...(this.uiState.customBiomes || [])].sort(alphaSort).map((cb) => ({ ...cb, hex: ColorMath.rgbToHex(cb.color), hasRules: !!cb.rules?.length }));
        // The map's styles, as the bar's and the mass edit dialogues' choices read them
        context.customRouteStyles = [...(this.uiState.customRouteStyles || [])].sort(alphaSort);
        context.customLabelStyles = [...(this.uiState.customLabelStyles || [])].sort(alphaSort);
        context.customRegionStyles = [...(this.uiState.customRegionStyles || [])].sort(alphaSort);
        // Styles and icons' style lists
        if (this.activeTool === "library") {
            context.styleLists = StyleLists.context(this);
            context.styleCount = context.styleLists.reduce((sum, list) => sum + list.count, 0);
        }

        if (regionId === "context") {
            context.toolPartial = `${TEMPLATE_ROOT}world/tools-${this.activeTool}.hbs`;
            // A head and a foot kept above and below the panel's scroll: Worlds' search and view, and
            // its New world, Import world and backups
            context.panelHeadPartial = this.activeTool === "manage" ? `${TEMPLATE_ROOT}world/tools-manage-head.hbs` : null;
            context.panelFootPartial = this.activeTool === "manage" ? `${TEMPLATE_ROOT}world/tools-manage-foot.hbs` : null;
            // Make Surface map at Map setup's foot while the map is not made (board N4)
            if (this.activeTool === "scene" && !this.surfaceMade) context.panelFootPartial = `${TEMPLATE_ROOT}world/tools-scene-foot.hbs`;
            // Cut regional world…'s Cancel and Cut at its foot (board W7)
            if (this.activeTool === "worldCut") {
                context.cut = this.#cutContext();
                context.panelFootPartial = `${TEMPLATE_ROOT}world/tools-worldCut-foot.hbs`;
            }

            context.massEditMode = { ...this.massEditMode };
            context.massEditCount = {
                pin: this.massEditSelection.pin.size,
                route: this.massEditSelection.route.size,
                region: this.massEditSelection.region.size,
                label: this.massEditSelection.label.size,
                river: this.massEditSelection.river.size,
            };
            context.massEditBlocked = Object.fromEntries(Object.keys(this.massEditMode).map((type) => [type, this.#isMassEditBlocked(type)]));

            // The long lists, searched and filtered, their rows rendered only when they change (see ListQuery)
            if (this.activeTool === "infrastructure") {
                context.pinList = await this.#listContext("pin", context);
                context.routeList = await this.#listContext("route", context);
            }
            if (this.activeTool === "labels") {
                context.labelList = await this.#listContext("label", context);
                context.featureReport = FeatureNames.lastReport(this);
            }
            // Each row shows what kind of decoration it is: an image of the user's, or one the module draws
            context.mapDecorations = [...(this.mapDecorations || [])].sort(alphaSort).map((decoration) => ({ ...decoration, kindIcon: DECORATION_ICONS[decoration.kind] ?? DECORATION_ICONS.image, kindLabel: DECORATION_LABELS[decoration.kind] ?? DECORATION_LABELS.image }));
            const { ADD: landColor, SUBTRACT: oceanColor, COAST: coastColor } = FILRODENSWMB.DISPLAY.LAND_MASK_COLORS;
            // In their own order, not by name: later masks lie on top (see ListReorder)
            context.landMasks = [...(this.landMasks || [])].map((m) => {
                const operation = LandMaskEditor.operationOf(m);
                const swatchColor = { subtract: oceanColor, settings: coastColor }[operation] ?? landColor;
                return { ...m, swatchColor, typeLabel: LandMaskEditor.typeLabel(m), coastOnly: operation === "settings", isActive: m.id === this.activeLandMaskId };
            });
            context.landMasksReorderable = context.landMasks.length > 1;

            context.labelColorPalette = FILRODENSWMB.LABELS?.PRESETS || [];

            if (this.activeTool === "regions") context.regionPanel = RegionPanel.context(this, context.inspected);
            if (this.activeTool === "history") context.history = HistoryView.context(this);
            if (this.activeTool === "travel") context.travel = TravelView.context(this);
            if (this.activeTool === "influences") context.influences = InfluenceView.context(this);
            // The climate is the world's: a held regional world reads its parent's, read only
            if (this.activeTool === "climate" && this.world?.held) context.climateHeld = platform.i18n.format("FILRODENSWMB.UI.ClimateHeld", { name: (await this.#heldSourceName()) ?? "" });
            if (this.activeTool === "generate") {
                context.generate = { ...GeneratePanel.context(this), infill: Infilling.context(this), fromWorld: this.#readFromWorld(), generateAllLabel: GenerateAll.buttonLabel(this), homelands: CultureMarkers.rows(this) };
            }
            // The world's cultures and ages (S0 step 4b), as Peoples and realms drew them before
            if (this.activeTool === "worldCultures") context.cultureList = CultureLists.context(this);
            if (this.activeTool === "worldAges") context.generate = GeneratePanel.context(this);

            if (WorldEditors.isEditor(this.activeTool)) await this.#worldEditorContext(context);
            // A world page fills the body beside the world's rail, in the panel and map's place
            if (context.panel.page) {
                context.panel.board = true;
                context.panel.boardRail = true;
            }
            if (this.activeTool === "worldOverview") {
                context.overview = await WorldOverview.context(this, { dirtyGroups: this.#unsavedGroupNames() });
                // A page beside the world's rail, with no canvas (board C3): the world's name as its
                // crumb and its line as the lede
                context.panel.board = true;
                context.panel.boardRail = true;
                context.panel.page = true;
                context.panel.overview = true;
                context.panel.crumb = this.world?.name || this.#saveName || platform.i18n.localize("FILRODENSWMB.UI.UnnamedWorld");
                context.panel.worldEditor = { lede: context.overview.line };
            }
            if (this.activeTool === "manage") {
                context.worlds = await WorldsPanel.context(this);
                // Worlds fills the studio's body beside the inspector (board W9)
                context.panel.board = true;
                context.panel.meta = context.worlds.summary;
                // With no world open (board N5) there is nothing to go back to
                if (!this.worldOpen) context.panel.closes = null;
                context.panel.back = !this.worldOpen ? null : this.world?.name ? platform.i18n.format("FILRODENSWMB.UI.WorldsBackTo", { name: this.world.name }) : platform.i18n.localize("FILRODENSWMB.UI.WorldsBackToMap");
            }
        }

        // A settlement map open: its rail, panel, bar and top line in the Surface map's (L-surface)
        SettlementMaps.regionContext(this, regionId, context);
        return context;
    }

    /**
     * Draws the studio into the host's element, once: a StudioView draws its regions there and
     * redraws them in place from then on (see StudioView and #REGIONS). The first draw also sets up
     * the canvas and generates the first map.
     *
     * @param {HTMLElement} root - The studio's frame (an empty element with the "fwmb-studio" class).
     */
    mount(root) {
        if (this.root) throw new Error("MapStudio: already mounted");
        this.root = root;
        this.view = new StudioView({
            root,
            regions: MapStudio.#REGIONS,
            renderTemplate: (path, context) => platform.templates.render(path, context),
            buildContext: (regionId) => this.#buildRegionContext(regionId),
            actions: MapStudio.ACTIONS,
            controller: this,
            afterRender: (regions) => this.#afterRegionsDrawn(regions),
            listRows: (list) => this.listHtml?.[list]?.html ?? "",
        });
        this.#bindStudioListeners(root);
        // Full screen on the web: its toggle follows the page going in and out of it (Esc included)
        this.#stopFullscreenWatch = platform.frame?.fullscreen?.onChange(() => this.#syncFullscreen()) ?? null;
        this.view.render();
        this.#showTitle();
    }

    /**
     * What has to follow a redraw of any of the studio's regions, straight on the page rather than
     * through the templates (see StudioView's afterRender).
     *
     * @param {string[]} regions - The regions just drawn.
     */
    #afterRegionsDrawn(regions) {
        if (this.#shutDown) return;
        this.#refreshSurfaceMarks(regions);
        if (regions.includes("map")) this.#onMapDrawn();
        // Every redraw can change what the layout measures (the bar's folding, the rail's More
        // menu), and may have replaced an element it watches
        this.#layout?.start();
        this.#bindCollapsibleFieldsets();
        this.#bindCanvasCallbacks();
        this.#applyInitialBootState();
        this.#updateHistoryButtons();
        this.#updateCanvasHint();
        MeshIntegration.updateOutline(this);
        RouteTool.updateOverlays(this);
        // An event's place is picked only while a tool marking them is open (see CultureMarkers.TOOLS)
        if (!CultureMarkers.TOOLS.has(this.activeTool)) AgeEventRows.stopPick(this);
        CultureMarkers.update(this, AgeEventRows.markers(this));
        // The inspector shows the object as it is now: a change made in the panel, the bar or by
        // an undo redraws the panel, and the inspector with it (or closes it, if the object went)
        if (regions.includes("context")) Inspector.refresh(this);
        // Worlds keeps the inspector's column (S0 step 8c): its cards never move when one is chosen
        if (regions.includes("context")) WorldsPanel.reserve(this, this.activeTool === "manage");
        // Each list is one tab stop, its rows' controls none (see ListNav)
        if (regions.includes("context")) {
            ListQuery.settle(this, this.root);
            ListNav.settle(this.root);
        }
    }

    /**
     * A click on a region's row: the region is chosen in its list, becomes the one painted and
     * opens in the inspector (see RegionEditor's `opened`).
     */
    #selectRegionRow(target) {
        const [levelId, regionId] = RegionPanel.regionIdsOf(target);
        if (levelId && regionId) RegionEditor.open(this, levelId, regionId, MapStudio.#FROM_LIST);
    }

    /** The kinds the pin, route and label lists can be narrowed to (value to localisation key). */
    static #PIN_KINDS = Object.freeze({ ...Object.fromEntries(FILRODENSWMB.PINS.DEFAULT_STYLES.map((style) => [style.tier, style.name])), other: "FILRODENSWMB.UI.ListKindOther" });
    static #ROUTE_KINDS = Object.freeze({ road: "FILRODENSWMB.UI.TransportRoad", river: "FILRODENSWMB.UI.TransportRiver", sea: "FILRODENSWMB.UI.TransportSea" });
    static #LABEL_KINDS = Object.freeze({ custom: "FILRODENSWMB.UI.LabelFilter_custom", pin: "FILRODENSWMB.UI.LabelFilter_pin", route: "FILRODENSWMB.UI.LabelFilter_route", region: "FILRODENSWMB.UI.LabelFilter_region", river: "FILRODENSWMB.UI.LabelFilter_river", feature: "FILRODENSWMB.UI.LabelFilter_feature", noRoom: "FILRODENSWMB.UI.LabelFilter_noRoom" });

    /**
     * Each long list's kinds, rows template, and the fields of a row its template shows (a row's
     * tick is marked after each draw, so it is not among them; see ListQuery.settle).
     */
    static #LISTS = Object.freeze({
        pin: { kinds: MapStudio.#PIN_KINDS, template: "world/parts/list-rows-pin.hbs", shown: (row) => [row.id, row.name, row.icon, row.color, row.visibility, row.generated, row.locked, row.edited] },
        route: { kinds: MapStudio.#ROUTE_KINDS, template: "world/parts/list-rows-route.hbs", shown: (row) => [row.id, row.name, row.color, row.thickness, row.style, row.visibility, row.generated, row.locked, row.edited] },
        label: { kinds: MapStudio.#LABEL_KINDS, template: "world/parts/list-rows-label.hbs", shown: (row) => [row.id, row.name, row.type, row.layerId, row.meta, row.visibility, row.noRoom] },
    });

    /**
     * A long list's context: its rows' version (their HTML is kept in listHtml, for the view to put
     * in when it changes), the row in the inspector, its controls and its count.
     */
    async #listContext(type, context) {
        const { kinds, template, shown } = MapStudio.#LISTS[type];
        const view = ListQuery.view(this, type, this.#listRows(type), kinds);
        const rowsContext = { rows: view.rows, massEdit: !!this.massEditMode[type], noMatches: view.controls.noMatches };
        const { version } = await ListQuery.html(this, type, `${TEMPLATE_ROOT}${template}`, rowsContext, shown);
        const inspected = context.inspected ?? {};
        const selected = type === "label" ? view.rows.find((row) => row.id === inspected[row.labelKey])?.id : inspected[type];
        return { ...view, rows: null, version, selected: selected ?? "" };
    }

    /**
     * Every row of a long list, by name, each with whether a run made it and its kind (see
     * ListQuery): the pins (their tier, or their style's), the routes (their transport) and the
     * labels (standalone, and those of pins, routes and regions that have a name).
     */
    #listRows(type) {
        const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
        const byName = (a, b) => collator.compare(a.name || "", b.name || "");
        const selected = this.massEditSelection[type];
        // Whether a run made it, and its Lock (see GeneratedEdits.toggleLock)
        const lockOf = (item) => ({ generated: !!item.generated, locked: item.generated?.locked === true, edited: item.generated?.edited === true });
        if (type === "pin") {
            const tierOf = (pin) => pin.generated?.tier ?? PinStyles.find(this, pin.pinStyle)?.tier ?? "other";
            return (this.mapPins || []).filter((pin) => !!pin.icon).map((pin) => ({ ...pin, ...lockOf(pin), kind: tierOf(pin), massEditSelected: selected.has(pin.id) })).sort(byName);
        }
        if (type === "route") return (this.mapRoutes || []).map((route) => ({ ...route, ...lockOf(route), kind: route.transport ?? "road", massEditSelected: selected.has(route.id) })).sort(byName);
        return this.#labelRows(selected).sort(byName);
    }

    /**
     * The Labels list's rows: every label with a name, each with what it belongs to as its meta. A
     * natural feature's name is a standalone label also found by Of natural features, and made by
     * the map (see FeatureNames.listRowFields).
     */
    #labelRows(selected) {
        const owner = (key) => platform.i18n.localize(key);
        const named = (item) => !!item.name;
        const ownerMeta = { pin: owner("FILRODENSWMB.UI.InspectorOwnerPin"), route: owner("FILRODENSWMB.UI.InspectorOwnerRoute"), river: owner("FILRODENSWMB.UI.InspectorOwnerRiver") };
        // A name the map had no room for at its last draw is marked, and found with the No room filter
        const withoutRoom = this.canvasEngine?.labelsWithoutRoom ?? new Set();
        const marked = (row) => (withoutRoom.has(`${row.type}:${row.id}`) ? { ...row, noRoom: true, also: [...(row.also ?? []), "noRoom"] } : row);
        return [
            ...(this.mapLabels || []).filter(named).map((label) => ({ id: label.id, name: label.name, type: "custom", kind: "custom", ...FeatureNames.listRowFields(label), labelKey: "labelcustom", standalone: true, visibility: label.visibility ?? "all", massEditSelected: selected.has(label.id) })),
            ...(this.mapPins || []).filter((pin) => !!pin.icon && named(pin)).map((pin) => ({ id: pin.id, name: pin.name, type: "pin", kind: "pin", generated: !!pin.generated, labelKey: "labelpin", meta: ownerMeta.pin, visibility: pin.label?.visibility ?? "all" })),
            ...(this.mapRoutes || []).filter(named).map((route) => ({ id: route.id, name: route.name, type: "route", kind: "route", generated: !!route.generated, labelKey: "labelroute", meta: ownerMeta.route, visibility: route.label?.visibility ?? "all" })),
            ...this.regionLevels.flatMap((level) =>
                level.regions.filter(named).map((region) => ({ id: region.id, name: region.name, type: "region", kind: "region", generated: !!region.generated, labelKey: "labelregion", layerId: level.id, meta: platform.i18n.format("FILRODENSWMB.UI.LabelOwnerRegionMeta", { kind: owner("FILRODENSWMB.UI.InspectorOwnerRegion"), level: level.name }), visibility: region.label?.visibility ?? "all" })),
            ),
            // Custom rivers' names (see RiverLabels), hidden until shown for a river drawn before they had labels
            ...(this.manualRivers || []).filter(named).map((river) => ({ id: river.id, name: river.name, type: "river", kind: "river", labelKey: "labelriver", meta: ownerMeta.river, visibility: RiverLabels.label(this, river).visibility })),
        ].map(marked);
    }

    /**
     * "Edit several regions…" in a level's menu: Mass Edit for that level's regions, its bar above
     * the tree and a tick on each of its region rows.
     */
    #massEditLevel(levelId) {
        const level = RegionPanel.objectOf(this, `level:${levelId}`);
        if (!level?.regions.length || this.#isMassEditBlocked("region")) return;
        this.massEditSelection.region.clear();
        this.massEditLevelId = levelId;
        this.massEditMode.region = true;
        this.view?.render(["context"]);
    }

    /**
     * Whether a click on a row came from one of the row's own controls (its menu, a tick box)
     * rather than from the row itself, which opens the row's object in the inspector.
     */
    /** How a list's row opens its object in the inspector: focus stays on the row (see ListNav). */
    static #FROM_LIST = Object.freeze({ keepFocus: true });

    static #fromRowControl(event, row) {
        const control = event?.target?.closest?.("button, input, select, a, .fwmb-dropdown, .fwmb-tw");
        return !!control && control !== row && row.contains(control);
    }

    /**
     * The fields of every label on the map: standalone labels, the labels of pins, routes and
     * regions, and the faces of the decorations the module draws (their letters and titles).
     */
    #labelFields(levels = this.regionLevels) {
        const owned = [...this.mapPins, ...this.mapRoutes, ...(levels ?? []).flatMap((level) => level.regions ?? [])].map((owner) => owner.label ?? {});
        const decorations = (this.mapDecorations ?? []).flatMap((decoration) => DrawnDecoration.faces(decoration));
        return [...this.mapLabels, ...owned, ...decorations];
    }

    /**
     * Before an export: every label's face has loaded (or failed), and the labels are drawn in
     * them, so no label is exported in a fallback face (see LabelFonts).
     */
    async #labelFacesReady() {
        await LabelFonts.ready(this.#labelFields());
        this._repaintVectors();
    }

    /**
     * When a map opens, one notice names the label fonts it uses that this host lacks (a Foundry
     * world's font opened on the web, say): those labels are drawn in the default label font, and
     * keep their own, so they come back on a host that has it.
     */
    #reportMissingFonts(levels) {
        const missing = LabelFonts.missing(this.#labelFields(levels));
        if (missing.length === 0) return;
        platform.notify.warn(platform.i18n.format("FILRODENSWMB.UI.LabelFontsMissing", { fonts: missing.join(", "), fallback: FILRODENSWMB.LABELS.DEFAULT_FONT }));
    }

    /**
     * Measures the studio's layout again (see StudioLayout), after something it watches came or
     * went outside a redraw of the regions: the inspector opening or closing.
     */
    refreshLayout() {
        this.#layout?.start();
    }

    /**
     * Sets up what lives in the map region, which is drawn once: the canvas and its engines, and the
     * Undo/Redo buttons' preview of what they would change.
     */
    #onMapDrawn() {
        // The processing overlay covers the whole studio, not only the map (S0 step 4c-2): opening
        // a world from Worlds shows it from the first step, while the map is hidden behind Worlds'
        // board. The map region is drawn once, so the overlay is moved out of it once.
        const overlay = this.root.querySelector(".fwmb-map .fwmb-processing-overlay");
        if (overlay) this.root.append(overlay);
        this.#initCanvasAndEngines();
        this.#syncMapControls();
        this.#layout = new StudioLayout(this.root);
        this.#layout.start();

        for (const [action, direction] of [["undoBrush", "undo"], ["redoBrush", "redo"]]) {
            const button = this.view.root.querySelector(`.fwmb-map [data-action="${action}"]`);
            button?.addEventListener("pointerenter", () => this.#previewActionBounds(direction));
            button?.addEventListener("pointerleave", () => this.canvasEngine?.clearActionPreview());
        }
    }

    /**
     * The studio's listeners, all on its root element so they keep working however its regions
     * are redrawn (an element inside a region can be replaced by a redraw; the root never is).
     *
     * @param {HTMLElement} root
     */
    #bindStudioListeners(root) {
        root.addEventListener("dblclick", (event) => this.#resetSliderToMapDefault(event));
        root.addEventListener("keydown", (event) => this.#handleStudioKeydown(event));
        root.addEventListener("focusout", (event) => {
            RegionLists.handleFocusOut(this, event);
            StyleLists.handleFocusOut(this, event);
            CultureLists.handleFocusOut(this, event);
        });
        root.addEventListener("input", (event) => {
            RegionLists.handleInput(this, event);
            StyleLists.handleInput(this, event);
            CultureLists.handleInput(this, event);
        });
        root.addEventListener("input", (event) => this.#routeFieldEvent(event));
        root.addEventListener("change", (event) => this.#routeFieldEvent(event));
        // A world settings editor's head says whether this sitting changed its group (Revert
        // changes), so a change there draws the panel again once the change has been applied
        root.addEventListener("change", (event) => {
            if (event.target.closest?.(".fwmb-world-editor")) setTimeout(() => this.view?.render(["context"]), 0);
        });
        root.addEventListener("pointerover", (event) => this.#togglePreviewFallback(event, true));
        root.addEventListener("pointerover", (event) => this.#nameUnsaved(event));
        root.addEventListener("focusin", (event) => this.#nameUnsaved(event));
        root.addEventListener("pointerout", (event) => this.#togglePreviewFallback(event, false));
        ListReorder.bind(root, (list, id, to) => this.#moveListItem(list, id, to));
        bindDropdownMenus(root);
    }

    /**
     * A double-clicked slider in the studio's panels or toolbar returns to the map default for its
     * setting. Range sliders' value displays and filled tracks follow through the input event (see
     * StudioView and RangeDisplay), which also triggers regeneration as a drag would. Sliders in a
     * dialogue are not map settings, so they are left alone.
     */
    #resetSliderToMapDefault(event) {
        const target = event.target;
        if (target.tagName !== "INPUT" || target.type !== "range" || target.closest("dialog")) return;

        const defaultVal = this.defaultUiState[target.name];
        if (defaultVal === undefined || RangeCurve.read(target) === String(defaultVal)) return;

        if (RangeCurve.isCurved(target)) RangeCurve.setValue(target, defaultVal);
        else target.value = defaultVal;
        target.dispatchEvent(new Event("input", { bubbles: true }));
    }

    /**
     * The studio's keyboard shortcuts (Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z and Ctrl/Cmd+Y redo),
     * outside text fields.
     *
     * Tab is kept within the page's own handling: Foundry's keybindings listen on the window and
     * act on Tab whenever focus is not in a text field (cycling through tokens on the canvas behind
     * the window), cancelling the browser's move to the next control. Stopping the key here leaves
     * Tab to move focus through the studio's controls as it does anywhere else.
     */
    /** An arrow key, Home, End, Page Up or Page Down, or W, A, S or D without a modifier. */
    static #isMovementKey(event) {
        if (/^(Arrow(Up|Down|Left|Right)|Home|End|PageUp|PageDown)$/.test(event.key)) return true;
        return !event.ctrlKey && !event.metaKey && !event.altKey && /^[wasd]$/i.test(event.key);
    }

    #handleStudioKeydown(event) {
        if (event.key === "Tab") {
            event.stopPropagation();
            return;
        }
        // Keys that move go no further than the studio: in Foundry the arrows (and W, A, S and D)
        // would otherwise reach the window and pan the scene behind it
        if (MapStudio.#isMovementKey(event)) event.stopPropagation();
        // While an export draws, the map's shortcuts wait with its controls (see #holdForExport)
        if (this.view?.held) return;
        // A settlement map has its own keys (its canvas's) and its own undo (Generate again)
        if (this.inSettlement) {
            const ctrl = event.ctrlKey || event.metaKey;
            const key = event.key.toLowerCase();
            if (ctrl && !event.altKey && (key === "z" || key === "y") && !MapStudio.#isTyping(event.target)) {
                event.preventDefault();
                this.#settlementHistory(key === "y" || event.shiftKey ? "redo" : "undo");
                return;
            }
            if (AppearanceMenu.handleKey(this.root, event) || ListNav.handleKey(event) || this.#moveAlongRail(event)) event.preventDefault();
            return;
        }
        // The Regions lists' keys: moving through a list, Unassigned, and naming
        if (
            AppearanceMenu.handleKey(this.root, event) ||
            RegionLists.handleKey(this, event) ||
            StyleLists.handleKey(this, event) ||
            CultureLists.handleKey(this, event) ||
            ListReorder.handleKey(event, (list, id, to) => this.#moveListItem(list, id, to)) ||
            ListNav.handleKey(event)
        ) {
            event.preventDefault();
            return;
        }

        // Shortcuts only fire while the user is not typing into a field
        const activeElement = document.activeElement;
        const isInputFocused = activeElement && (activeElement.tagName === "INPUT" || activeElement.tagName === "TEXTAREA");
        if (isInputFocused) return;

        // The Regions tool takes Escape: a stroke left hanging, or the region being edited
        if (this.activeTool === "regions" && RegionPainter.handleKey(this, event)) {
            event.preventDefault();
            return;
        }
        // The Influences tool takes Escape for a stroke left hanging
        if (this.activeTool === "influences" && InfluencePainter.handleKey(this, event)) {
            event.preventDefault();
            return;
        }
        // The Routes tool takes Enter, Backspace and Escape while a route is placed or picked
        if (this.#isRouteMode() && RouteTool.handleKey(this, event)) {
            event.preventDefault();
            return;
        }
        // Escape leaves Cut regional world… for where it was opened from
        if (event.key === "Escape" && this.activeTool === "worldCut") {
            event.preventDefault();
            this.#cancelCut();
            return;
        }
        // A homeland or event place pick takes Escape, ending it; pins' and labels' Select mode takes it, closing the
        // inspector on what it picked
        if (CultureMarkers.handleKey(this, event) || AgeEventRows.handleKey(this, event) || PickTool.handleKey(this, event)) {
            event.preventDefault();
            return;
        }

        const isCtrlOrCmd = event.ctrlKey || event.metaKey;

        // Arrow keys move between the bar's modes, and along the rail, as along any toolbar
        if (moveAlongModes(event) || this.#moveAlongRail(event)) {
            event.preventDefault();
            return;
        }
        // "?" opens the keyboard shortcuts sheet
        if (event.key === "?" && !isCtrlOrCmd && !event.altKey) {
            event.preventDefault();
            this.#openShortcuts();
            return;
        }

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
    }

    /**
     * Sends a field's input or change event to the handler for the region it is in: the edit
     * toolbar's brush settings, or the context panel's map settings. The reference image's file
     * picker reports its new path with a change event of its own.
     */
    #routeFieldEvent(event) {
        const target = event.target;
        // A settlement maps list's search (the world bar's menu, the overview's table)
        if (SettlementMaps.filter(event)) return;
        // A settlement map's fields are the Local studio's
        if (this.inSettlement) {
            if (target.closest(".fwmb-context-panel, .fwmb-mapbar")) SettlementMaps.existing(this).field(event);
            return;
        }
        if (target.closest(".fwmb-edit-toolbar")) {
            this.#handleToolbarInput(event);
            return;
        }
        // The 3D view's Relief Emphasis: live while it is dragged, a change of the map once let go
        if (target.closest(".fwmb-3d-controls")) {
            if (target.name !== "reliefEmphasis") return;
            this.uiState.reliefEmphasis = Number(target.value);
            if (event.type === "input") this.scene3D?.setReliefEmphasis(this.uiState.reliefEmphasis);
            else this.markDirty();
            return;
        }
        // The thematic layer's opacity, in the map controls: live while it is dragged
        if (target.matches("[data-thematic-opacity]")) {
            this.#setThematic(ThematicView.withOpacity(this, target.value), { save: event.type === "change" });
            return;
        }
        if (!target.closest(".fwmb-context-panel")) return;
        // A long list's search field and filters (see ListQuery)
        if (ListQuery.handleInput(this, event)) return;
        // Fields that only steer the panel itself (a list's filter, a name being typed in the
        // Regions tree, a Mass Edit tick) are not map settings
        if (target.closest("[data-panel-ui]")) return;
        // The Generate panel's settings (see GeneratePanel), and the Travel tool's speeds
        if (GeneratePanel.handleInput(this, event)) return;
        if (TravelView.handleInput(this, event)) return;

        if (event.type === "change" && target.matches('file-picker[name="referenceImage"]')) {
            // Only a source the studio accepts reaches the canvas (see Sanitize.imageSource)
            this.uiState.referenceImage = Sanitize.imageSource(target.value, { remote: true }) ?? "";
            this.#updateReferenceLayer();
            return;
        }
        this.#handleContextPanelInput(event);
    }

    /**
     * While the pointer is over the Biomes panel's fallback preview button, the canvas shows where
     * the fallback biome would be used. The pointer moving between the button's own children is not
     * leaving it.
     */
    #togglePreviewFallback(event, isOver) {
        const button = event.target.closest?.("#fwmb-preview-fallback-btn");
        if (!button || button.contains(event.relatedTarget)) return;
        this.canvasEngine?.toggleLayer("biomeFallback", isOver);
    }

    #initCanvasAndEngines() {
        const container = this.root.querySelector(".fwmb-map-preview");
        if (!container || this.canvasEngine) return;

        this.canvasEngine = new StudioCanvas(container);
        this.brushEngine = this.#createBrushEngine();
        this.#wireBrushCallbacks();

        this.canvasEngine.onCropUpdate = (cropBox) => this.#showCropReadouts(cropBox);
        this.canvasEngine.onCropRelease = (cropBox) => this.#snapCrop(cropBox);
        this.canvasEngine.onLabelsPlaced = (withoutRoom) => this.#labelsPlaced(withoutRoom);
        this.canvasEngine.setLabelOverlapAvoidance(this.uiState.avoidLabelOverlaps);
        this.canvasEngine.setMapName(this.#saveName);
    }

    /** The names with no room at the last draw (see LabelLayout), as a key that changes when they do. */
    #withoutRoomKey = "";

    /** After the labels are drawn: the Labels list marks those with no room, so it is drawn again when they change. */
    #labelsPlaced(withoutRoom) {
        const key = [...withoutRoom].sort().join("|");
        if (key === this.#withoutRoomKey) return;
        this.#withoutRoomKey = key;
        if (this.activeTool === "labels") this.view?.render(["context"]);
    }

    /**
     * Moves the crop to the one the regional map will actually use (see
     * RegionalExtractor.planCrop): snapped to the parent's grid so the two grids line up, and
     * sized for the requested width. Done when a drag of the crop ends, when the crop tool opens
     * and when the requested width changes, so the outline always shows what will be made.
     */
    #snapCrop(cropBox) {
        // Written as !(value > 0) on purpose: a missing or NaN value also fails the check,
        // whereas the equivalent-looking value <= 0 would let it through
        if (!this.canvasEngine || !cropBox || !(cropBox.width > 0) || !(cropBox.height > 0)) return; // NOSONAR
        this.canvasEngine.setCropBox(this.#planCrop(cropBox).cropBox);
    }

    /** The regional map the crop makes (see RegionalExtractor.planCrop). */
    #planCrop(cropBox) {
        return RegionalExtractor.planCrop(cropBox, this.uiState.regionalTargetWidth, { type: this.uiState.gridType, size: this.uiState.gridSize }, this.mapWidth, this.mapHeight, { align: this.uiState.regionalAlignGrid !== false });
    }

    /**
     * Shows the height and latitude range of the regional map the crop will make, as
     * RegionalExtractor.planCrop works them out, for the crop as it will be snapped. While a
     * crop is being dragged these show where it will snap to when released.
     */
    #showCropReadouts(cropBox) {
        // Written as !(value > 0) on purpose: a missing or NaN value also fails the check,
        // whereas the equivalent-looking value <= 0 would let it through
        if (!cropBox || !(cropBox.width > 0) || !(cropBox.height > 0)) return; // NOSONAR
        const plan = this.#planCrop(cropBox);

        this.uiState.regionalTargetHeight = plan.targetHeight;
        const heightInput = this.root.querySelector('input[name="regionalTargetHeight"]');
        if (heightInput) heightInput.value = plan.targetHeight;

        const latRange = Math.abs(this.uiState.latTop - this.uiState.latBottom);
        const newLatTop = this.uiState.latTop - (plan.cropBox.y / this.mapHeight) * latRange;
        const newLatBottom = this.uiState.latTop - ((plan.cropBox.y + plan.cropBox.height) / this.mapHeight) * latRange;

        // A whole number on a map with a grid (see RegionalExtractor.planCrop); a gridless map's
        // zoom is whatever the crop gives, shown to one decimal place
        const zoomEl = this.root.querySelector("#fwmb-readout-regional-zoom");
        if (zoomEl) zoomEl.textContent = platform.i18n.format("FILRODENSWMB.UI.RegionalZoomValue", { zoom: new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(plan.zoomScale) });

        const latTopEl = this.root.querySelector("#fwmb-readout-lat-top");
        const latBottomEl = this.root.querySelector("#fwmb-readout-lat-bottom");
        if (latTopEl) latTopEl.innerHTML = `${newLatTop.toFixed(2)}&deg;`;
        if (latBottomEl) latBottomEl.innerHTML = `${newLatBottom.toFixed(2)}&deg;`;

        const infillBox = this.root.querySelector("[data-regional-infill]");
        if (infillBox) infillBox.disabled = !this.#regionalInfillOffered(cropBox, plan);

        // The ground a pixel on the regional world, and the limit finer than which it is refused
        const scaleEl = this.root.querySelector("#fwmb-readout-regional-scale");
        if (scaleEl) scaleEl.textContent = this.#cropScaleText(plan);
        const tooFine = this.#cropTooFine(plan);
        const limit = this.root.querySelector("[data-crop-limit]");
        if (limit) limit.hidden = !tooFine;
        const cut = this.root.querySelector('.fwmb-panel-foot [data-action="cutRegionalWorld"]');
        if (cut) {
            if (tooFine) {
                cut.setAttribute("aria-disabled", "true");
                cut.dataset.tooltip = this.#cropLimitText();
            } else {
                cut.removeAttribute("aria-disabled");
                delete cut.dataset.tooltip;
            }
        }
    }

    /**
     * Whether the regional map a crop makes could be filled in when first opened: this map has a
     * run for it to inherit, whose cells lie at least INFILL.MIN_PARENT_PX apart on the regional
     * map (see InfillInput.offered, which asks the same of the regional map once made).
     */
    #regionalInfillOffered(cropBox, plan = null) {
        if (!cropBox || !(cropBox.width > 0) || !(cropBox.height > 0)) return false;
        const spacing = RunCells.regionSpacingPx(this);
        if (!(spacing > 0)) return false;
        const { zoomScale } = plan ?? this.#planCrop(cropBox);
        return spacing * zoomScale >= FILRODENSWMB.INFILL.MIN_PARENT_PX;
    }

    /**
     * Keeps the Undo/Redo buttons' disabled state and step-count tooltip in sync with
     * globalHistoryLedger/globalRedoLedger. Deliberately DOM-only rather than routed through
     * template context and a redraw of the map region: the PIXI canvas is mounted into
     * .fwmb-map-preview once by #initCanvasAndEngines and never re-attached, so the map region is
     * drawn only once (see #REGIONS). Called after every redraw of the studio's regions (see
     * #afterRegionsDrawn: tool switches, vector edits via MapStateManager.pushVectorState,
     * undo/redo itself), plus directly from
     * #handleBrushEnd, since ending a paint/terrain stroke changes the ledger without
     * triggering a render of its own.
     */
    /** The Undo and Redo buttons brought up to date outside a redraw (a route's waypoints placed or taken back). */
    refreshHistoryButtons() {
        this.#updateHistoryButtons();
    }

    /**
     * Undo and Redo, wherever they are drawn: the canvas's overlay, and the head of Styles and
     * icons' page (S0 step 4c-1), which has no canvas but whose changes are undo steps of the map.
     */
    #updateHistoryButtons() {
        // A settlement map's undo is its own (its Generate again steps)
        const settlement = this.inSettlement;
        const counts = settlement ? (SettlementMaps.existing(this)?.historyCounts ?? { undo: 0, redo: 0 }) : null;
        const undoCount = settlement ? counts.undo : (this.globalHistoryLedger?.length ?? 0);
        const redoCount = settlement ? counts.redo : (this.globalRedoLedger?.length ?? 0);
        // While its export draws, a settlement map's Undo and Redo wait, saying why (L-surface step 5)
        const waiting = settlement ? (counts.waiting ?? null) : null;
        // While a route is being placed, Undo takes its last waypoint back (see #processHistoryStep)
        const drafting = !settlement && RouteTool.drafting(this);
        for (const undoBtn of this.root.querySelectorAll('[data-action="undoBrush"]')) {
            undoBtn.disabled = (undoCount === 0 && !drafting) || !!waiting;
            if (drafting) undoBtn.dataset.tooltip = platform.i18n.localize("FILRODENSWMB.UI.UndoWaypoint");
            else if (waiting && undoCount > 0) undoBtn.dataset.tooltip = waiting;
            else undoBtn.dataset.tooltip = undoCount > 0 ? platform.i18n.format("FILRODENSWMB.UI.UndoCount", { count: undoCount }) : platform.i18n.localize("FILRODENSWMB.UI.Undo");
        }
        for (const redoBtn of this.root.querySelectorAll('[data-action="redoBrush"]')) {
            redoBtn.disabled = redoCount === 0 || !!waiting;
            if (waiting && redoCount > 0) redoBtn.dataset.tooltip = waiting;
            else redoBtn.dataset.tooltip = redoCount > 0 ? platform.i18n.format("FILRODENSWMB.UI.RedoCount", { count: redoCount }) : platform.i18n.localize("FILRODENSWMB.UI.Redo");
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
        // <select> in this method is deliberately left as. riverWidth's options are pixel widths:
        // a new river takes the number, which the bar's select compares with and a map file keeps.
        else if (name === "brushBiome" || name === "riverWidth") this.uiState[name] = Number(target.value);
        else this.uiState[name] = target.value;

        // 2. Delegate to Sub-Systems
        this.#syncFaultLiveEdits(name);
        this.#syncPinStyle(name);
        this.#syncCropLiveEdits(name);
        // The next-route style offers the styles for the transport chosen
        if (name === "routeTransport") this.view?.render(["editToolbar"]);
    }

    /**
     * The bar's pin style and icon: choosing a style shows its icon (the one the next pin gets);
     * choosing an icon leaves the style for "no style", so the next pin is the default pin in that icon.
     */
    #syncPinStyle(name) {
        if (name !== "activePinStyle") return;
        const style = PinStyles.active(this);
        if (style) this.uiState.activeIcon = style.icon;
        this.view?.render(["editToolbar"]);
    }

    /** The pin icons grids that close themselves on an outside press or Escape (see #togglePinIcons). */
    #pinIconGrids = new WeakSet();

    /**
     * Opens or closes the bar's pin icon grid. It opens as a popover placed against its trigger,
     * drawn in the top layer: the bar clips anything that overflows it, so the grid could not show
     * inside it. A press outside the picker, or Escape, closes it.
     */
    #togglePinIcons(trigger) {
        const menu = trigger.closest(".fwmb-custom-select")?.querySelector(".fwmb-select-options");
        if (!menu?.showPopover) return;
        if (menu.matches(":popover-open")) {
            menu.hidePopover();
            return;
        }
        if (!this.#pinIconGrids.has(menu)) {
            this.#pinIconGrids.add(menu);
            const document = menu.ownerDocument;
            const onPointerDown = (event) => {
                if (!trigger.contains(event.target) && !menu.contains(event.target) && menu.matches(":popover-open")) menu.hidePopover();
            };
            const onKeyDown = (event) => {
                if (event.key !== "Escape" || !menu.matches(":popover-open")) return;
                menu.hidePopover();
                event.stopPropagation();
            };
            menu.addEventListener("toggle", (event) => {
                const listen = event.newState === "open" ? "addEventListener" : "removeEventListener";
                document[listen]("pointerdown", onPointerDown, true);
                document[listen]("keydown", onKeyDown, true);
            });
        }
        menu.showPopover();
        positionPopoverMenu(trigger, menu);
    }

    #choosePinIcon(icon) {
        if (!icon) return;
        const grid = this.root?.querySelector("#fwmb-pin-select .fwmb-select-options");
        if (grid?.matches?.(":popover-open")) grid.hidePopover();
        this.uiState.activeIcon = icon;
        this.uiState.activePinStyle = PinStyles.NONE;
        this.view?.render(["editToolbar"]);
    }

    #syncFaultLiveEdits(name) {
        if (!["faultType", "faultThickness", "faultStrength", "faultStyle"].includes(name)) return;
        // The range style only shows while a range is chosen, so switching to or from one redraws the toolbar
        if (name === "faultType") this.view?.render(["editToolbar"]);
        if (!this.activeFaultId) return;

        const fault = this.tectonicFaults.find((f) => f.id === this.activeFaultId);
        if (!fault) return;

        fault.type = this.uiState.faultType;
        fault.thickness = this.uiState.faultThickness;
        fault.strength = this.uiState.faultStrength;
        MapStudio.#applyFeatureFields(fault, this.uiState);

        if (name === "faultType") {
            fault.color = TectonicFeatureEngine.colorOf(this.uiState.faultType);
        }

        this._repaintVectors();
        this.requestTerrainUpdate();
    }

    /**
     * Marks a fault as a tectonic feature (see TectonicFeatureEngine) when its type is one, and
     * gives a mountain range its style; a fault of an original type keeps the original maths.
     */
    static #applyFeatureFields(fault, uiState) {
        if (!TectonicFeatureEngine.isFeatureType(fault.type)) {
            delete fault.revision;
            return;
        }
        fault.revision = FILRODENSWMB.TECTONICS.FEATURES.REVISION;
        if (fault.type === FILRODENSWMB.TECTONICS.FEATURES.TYPES.RANGE) fault.style = uiState.faultStyle ?? FILRODENSWMB.TECTONICS.FEATURES.RANGE.DEFAULT_STYLE;
    }

    /** Whether the open map is at the current terrain version, which draws tectonic features. */
    #isCurrentTerrain() {
        return TerrainVersion.getVersion(this.uiState) >= FILRODENSWMB.TERRAIN_VERSION.REVISION_2;
    }

    /**
     * The fault type new faults are drawn with: the one chosen in the toolbar if this map's
     * version offers it, otherwise that version's default (a range on a current map, a convergent
     * fault on an older one).
     */
    #resolveFaultType() {
        const current = this.#isCurrentTerrain();
        const offered = TectonicFeatureEngine.typeOptions(current).map((option) => option.id);
        if (offered.includes(this.uiState.faultType)) return this.uiState.faultType;
        return current ? FILRODENSWMB.TECTONICS.FEATURES.DEFAULT_TYPE : FILRODENSWMB.TECTONICS.TYPES.CONVERGENT;
    }

    #syncCropLiveEdits(name) {
        if (name !== "regionalTargetWidth" || !this.canvasEngine) return;

        this.#snapCrop(this.canvasEngine.getCropData());
    }

    /**
     * A `<details>`-based fieldset re-renders as closed on every render (its `open` attribute
     * only ever reflects whatever the last-rendered context said), which would otherwise slam
     * it shut the moment any action inside it - a checkbox, Hide/Reveal all - triggers a
     * context re-render. Tracking `open` in JS and feeding it back through the render context
     * (see `builtinPinIconsExpanded` and `collapsedSections` in #buildRegionContext) keeps it as
     * the GM left it until they toggle it themselves. Assigning `ontoggle` and `onclick`
     * (rather than addEventListener) is deliberate: re-running this after every render always
     * replaces any previous handler, so the same element never ends up with duplicate listeners.
     *
     * The collapsible list sections (tool panel lists and region layers) are marked with
     * data-section. They are open by default, so only the collapsed ones are remembered.
     */
    #bindCollapsibleFieldsets() {
        for (const section of this.root.querySelectorAll("details[data-section]")) {
            section.ontoggle = () => this.#rememberSectionState(section);
            section.querySelector(":scope > summary").onclick = MapStudio.#keepSummaryControlsFromToggling;
        }
    }

    /** Records whether a collapsible list section is collapsed (see #bindCollapsibleFieldsets). */
    #rememberSectionState(section) {
        const key = section.dataset.section;
        if (section.open) {
            this._collapsedSections.delete(key);
            this._expandedSections.add(key);
        } else {
            this._collapsedSections.add(key);
            this._expandedSections.delete(key);
        }
    }

    /**
     * A click anywhere in a <summary> toggles its <details>, including a click on a button or
     * link inside it (a list's Add button or its Mass Edit toggle) or on the info icon explaining the list. Those
     * controls should only do their own job, so their clicks have the toggle cancelled. Cancelling
     * the default does not stop the click reaching the application's own data-action handling,
     * which listens further up the page.
     */
    static #keepSummaryControlsFromToggling(event) {
        if (event.target.closest("[data-action], button, a, input, .fwmb-legend-info")) event.preventDefault();
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

        // Map setup's terrain engine and seed are held until the map is made (again) from them
        if (MapStudio.#TERRAIN_CHOICE_INPUTS.has(name)) return this.#recordTerrainChoice(target, name, event);
        // A new world's name, kept until Create world
        if (name === "newWorldName") {
            this.#newWorldName = target.value;
            return;
        }
        // The resolution fields describe the frame a world with no maps will make its Surface map
        // in, not the open map, so changing them neither marks the map unsaved nor regenerates
        if (MapStudio.#NEW_MAP_SIZE_INPUTS.has(name)) return this.#recordNewMapSize(target, name);
        // The regional world's width is Cut regional world…'s; the crop on the map follows it.
        // Like the resolution fields, it describes the next map (the cut), not the open one,
        // so it doesn't mark the map unsaved: cutting would otherwise ask to save the map first
        if (name === "regionalTargetWidth") return this.#recordRegionalWidth(event, target);
        // Filling in a regional map when first opened is an option for the cut, not part of this map
        if (name === "regionalInfill") {
            this.uiState.regionalInfill = target.checked;
            return;
        }
        // Lining the crop up with the grid is the cut's too: the crop is fitted again, and the panel says what it snaps to
        if (name === "regionalAlignGrid") {
            this.uiState.regionalAlignGrid = target.checked;
            this.#syncCropLiveEdits("regionalTargetWidth");
            this.view?.render(["context", "editToolbar"]);
            return;
        }

        // Skip marking dirty for temporary visual overlays
        if (!name.startsWith("reference")) this.markDirty();

        // 1. Route specific single-action updates
        if (name === "mapUnitName") return this.#updateMapUnit(target);
        if (name.startsWith("cartography")) return this.#updateCartography(target, name);
        if (name === "referenceAlpha") return this.#updateReferenceAlpha(target);
        if (name === "gridType" || name === "gridSize") return this.#updateGridSettings();
        if (name === "worldAreaFactor") return this.#updateAreaFactor(target);
        if (name === "biomeAlphaActive" || name === "biomeAlphaInactive") return this.#updateBiomeAlphas();
        if (name === "contourInterval") return this.debouncedRepaintCanvas();
        // Relief strength and the water settings are terrain shader settings, so moving them
        // redraws without repainting
        if (MapStudio.#TERRAIN_SHADER_INPUTS.has(name)) return this.#updateTerrainShaderInputs();

        // The latitudes set the map's height in km, so they change its scale as the area factor does
        if (name === "latTop" || name === "latBottom") this.#updateLatitudeScale(target, name);

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
        // A bar turned on, or made longer, stays wholly on the map
        if (name.startsWith("cartographyScale")) this.#keepScaleBarOnMap();
        this.#syncScaleBarFields();
        this._repaintVectors();
    }

    /** Moves the scale bar in just far enough that all of it is on the map (see MapUnit.scaleBarOnMap). */
    #keepScaleBarOnMap() {
        const { x, y } = scaleBarOnMap(this.uiState, this.mapWidth, this.mapHeight);
        this.uiState.cartographyScaleX = x;
        this.uiState.cartographyScaleY = y;
    }

    /**
     * The map's unit (see MapUnit): only a name, so nothing is worked out again; the scale bar's
     * label and the scale shown beside the area factor take it. An emptied field goes back to the
     * default, since every distance needs a name.
     */
    #updateMapUnit(target) {
        const unit = cleanUnit(target.value);
        target.value = unit;
        this.uiState.mapUnit = unit;
        this.#syncPixelScale();
        this._repaintVectors();
    }

    /**
     * A latitude changed: it is taken into the state at once (as a save would read it), so that
     * the open mesh, the scale beside the area factor and a scale bar that matches the world all
     * follow the map's new scale before the climate is generated again.
     */
    #updateLatitudeScale(target, name) {
        const value = Number.parseFloat(target.value);
        if (!Number.isFinite(value)) return;
        this.uiState[name] = value;
        this.#applyWorldScale();
        if (this.uiState.cartographyScaleMatchWorld) {
            this.#syncScaleBarFields();
            this._repaintVectors();
        }
    }

    /**
     * Gives the open mesh the map's km scale (it was built with the scale the map had then, and
     * would keep it until the map is next loaded) and shows the new scale beside the area factor.
     */
    #applyWorldScale() {
        if (this.meshSession) this.meshSession.mesh.kmPerPx = kmPerPxOf(this.uiState, this.mapHeight);
        this.#syncPixelScale();
    }

    /** "1 pixel is about 3.2 km": what one map pixel measures, in the map's unit. */
    #pixelScaleText() {
        return platform.i18n.format("FILRODENSWMB.UI.PixelScale", { distance: formatDistance(kmPerPxOf(this.uiState, this.mapHeight)), unit: cleanUnit(this.uiState.mapUnit) });
    }

    /** Writes the scale beside the area factor in place (the panel is not drawn again while typing). */
    #syncPixelScale() {
        const element = this.root?.querySelector("[data-pixel-scale]");
        if (element) element.textContent = this.#pixelScaleText();
    }

    /**
     * Keeps the scale bar's fields in step with Match world scale: while the bar matches the world
     * its value per tick is worked out (see MapUnit.scaleBarTick), so the field shows that value
     * and cannot be typed in. Written in place, so a field being typed in keeps its focus.
     */
    #syncScaleBarFields() {
        const valueInput = this.root?.querySelector('input[name="cartographyScaleValue"]');
        if (!valueInput) return;
        const matching = this.uiState.cartographyScaleMatchWorld === true;
        valueInput.disabled = matching;
        if (matching) valueInput.value = String(scaleBarTick(this.uiState, this.mapHeight).value);
    }

    #updateReferenceAlpha(target) {
        this.uiState.referenceAlpha = Number(target.value);
        this.#updateReferenceLayer();
    }

    /**
     * The grid's type or size changed: the grid is turned on to show it (a changed grid that stays
     * hidden would look like nothing happened), unless the type is now no grid at all.
     */
    #updateGridSettings() {
        MapStateManager.getMapParameters(this);
        if (this.uiState.gridType !== "none") this.uiState.gridVisible = true;
        this.#updateGrid();
        this.#syncMapControls();
    }

    /**
     * The map's area factor (see Schema.effectiveKmPerPx): it changes what a pixel measures in km
     * and nothing that is drawn, except a scale bar that matches the world, which is drawn again.
     * It is written into a full description of the map's world (a top map's own, or the regional
     * one it already has), the open mesh takes the new km scale at once (see #applyWorldScale),
     * and the generator's outputs are marked stale, since every km-based figure they were made
     * with has changed.
     */
    #updateAreaFactor(target) {
        const areaFactor = clampAreaFactor(target.value);
        target.value = areaFactor;
        this.uiState.world = { ...TerrainVersion.resolveWorld(this.uiState), areaFactor };
        this.#markGeneratorStale();
        this.#applyWorldScale();
        if (this.uiState.cartographyScaleMatchWorld) {
            this.#syncScaleBarFields();
            this._repaintVectors();
        }
    }

    #updateBiomeAlphas() {
        MapStateManager.getMapParameters(this);
        this.#updateBiomeOpacity();
    }

    /** The Create New Map resolution fields (see #recordNewMapSize). */
    static #NEW_MAP_SIZE_INPUTS = new Set(["mapWidth", "mapHeight"]);

    /**
     * Keeps a typed resolution in the UI state as soon as it is entered.
     *
     * The context panel is drawn from the UI state, so any redraw before Create New Map (a new
     * random seed, switching tools and back) would otherwise put the fields back to the size of
     * the open map and lose what was typed. The open map's real size lives in mapWidth and
     * mapHeight on the app itself, which is what saves and the canvas use, so holding the typed
     * size here changes nothing about the open map. A field left blank or unreadable is ignored;
     * Create New Map falls back to the default size for it.
     */
    #recordNewMapSize(target, name) {
        const size = Number.parseInt(target.value, 10);
        if (Number.isNaN(size)) return;
        this.uiState[name] = size;
        // The frame of a world with no maps yet (World setup, board N2): its Surface map is made at it
        if (!this.surfaceMade) {
            const clamped = Math.min(4000, Math.max(500, size));
            if (name === "mapWidth") this.mapWidth = clamped;
            else this.mapHeight = clamped;
            if (this.world) this.markDirty();
            this.#showUnmade();
        }
    }

    /** The regional map's width, once the field is left (not per keystroke), and the crop fitted to it. */
    #recordRegionalWidth(event, target) {
        if (event.type === "input") return;
        const width = Number(target.value);
        if (!Number.isFinite(width)) return;
        this.uiState.regionalTargetWidth = width;
        this.#syncCropLiveEdits("regionalTargetWidth");
    }

    /** The map settings the terrain shader reads directly (see #syncTerrainSettings). */
    static #TERRAIN_SHADER_INPUTS = new Set(["reliefShading", "seabedRelief", "waterClarity", "waterHue", "waterSaturation"]);

    #updateTerrainShaderInputs() {
        MapStateManager.getMapParameters(this);
        this.#syncTerrainSettings();
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
        if (target.matches(MapStudio.#GENERATOR_INPUTS)) this.#markGeneratorStale();
        if (
            target.matches(
                'input[name="seaLevel"], input[name="tectonicPlates"], input[name="coastlineFracture"], input[name="continentalGrouping"], input[name="shelfRange"], input[name="coastalPlain"], input[name="continentScale"], input[name="oceanScale"], input[name="oceanRidges"], input[name^="noise.elevation"], input[name^="noise.offsetX"], input[name^="noise.offsetY"]',
            )
        ) {
            this.debouncedGenerateTerrain();
        } else if (
            target.matches(
                'input[name^="noise.moisture"], input[name="globalTemp"], input[name="globalMoisture"], input[name="latTop"], input[name="latBottom"], input[name="seasonOffset"], input[name="altCooling"], input[name="freezingThreshold"]',
            )
        ) {
            this.debouncedGenerateClimate();
        } else if (target.matches('input[name="riverDensity"], input[name="springAltOffset"], input[name="springMoistMin"], input[name="riverMeander"], input[name="riverWidthScale"]')) {
            this.debouncedGenerateFeatures();
        }
    }

    #bindCanvasCallbacks() {
        if (!this.canvasEngine) return;
        MeshIntegration.bindHitTest(this);
        // While the Regions tool is editing, the primary button paints (see RegionPainter); while
        // the Infrastructure tool is in Route mode, it places and edits routes (see RouteTool)
        this.canvasEngine.pointerToolProvider = () => {
            if (this.activeTool === "regions") return RegionPainter.tool(this);
            if (this.activeTool === "influences") return InfluencePainter.tool(this);
            if (this.#isRouteMode()) return RouteTool.tool(this);
            return PickTool.tool(this);
        };
        this.canvasEngine.onCanvasHover = (x, y) => {
            const isBrushActive = this.activeTool === "terrain" || this.activeTool === "biomes";
            const showCursor = this.canvasEngine.isEditMode && isBrushActive && !this.canvasEngine.isDragging;

            this.canvasEngine.updateBrushCursor(x, y, this.uiState.brushSize, showCursor);

            const readout = this.root.querySelector(".fwmb-canvas-readout");
            if (!readout) return;

            // The information bar stays on the canvas; off the map it shows a dash for every value
            if (x === null || y === null || x < 0 || x >= this.mapWidth || y < 0 || y >= this.mapHeight || !this.currentElevationData) {
                for (const value of readout.querySelectorAll('[id^="fwmb-readout-"]')) value.textContent = "–";
                ThematicView.readout(this, null, null);
                HistoryView.readout(this, null, null);
                TravelView.readout(this, null, null);
                return;
            }
            ThematicView.readout(this, x, y);
            HistoryView.readout(this, x, y);
            TravelView.readout(this, x, y);

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
            // The biome seen from above: under water that is the surface biome (such as Pack
            // Ice) when there is one, otherwise the bed's
            const { visible: lookupKey } = ProceduralEngine.resolveBiomeLookup(
                overrideId, elev, mois, temp, seaLevel, this.bufferWaterMask, index, params.customBiomeRules, params.biomePalette,
                params.biomeSides,
            );

            // Deliberately left uncapped: a value past 100% (or below 0%) is the honest readout for
            // elevation a user has hand-pushed past the old [0, 1] range. Normalising this against
            // the map's discovered peak/trough instead was considered and rejected, because it would
            // make the same stored elevation display as a different percentage purely because the
            // map's extremes changed somewhere else - a point the user never touched could appear to
            // move. Do not add a clamp here.
            this.root.querySelector("#fwmb-readout-elev").textContent = Math.round(elev * 100) + "%";
            this.root.querySelector("#fwmb-readout-mois").textContent = Math.round(mois * 100) + "%";
            this.root.querySelector("#fwmb-readout-temp").textContent = Math.round(temp * 100) + "%";
            this.root.querySelector("#fwmb-readout-biome").textContent = this.#getBiomeDisplayName(lookupKey);
        };
    }

    /**
     * Splits a biome list into one group per placement (for the brush's biome select, one
     * optgroup each), in the order the placements are listed in FILRODENSWMB.BIOME_PLACEMENT.
     * Biomes keep their order within a group (built-in first, then custom); a placement with no
     * biomes is left out.
     * @param {Array<{placement: string}>} biomeList
     * @returns {Array<{label: string, biomes: object[]}>} `label` is a localisation key.
     */
    static #groupBiomesByPlacement(biomeList) {
        return Object.values(FILRODENSWMB.BIOME_PLACEMENT)
            .map((placement) => ({
                label: BiomePlacement.labelOf(placement),
                biomes: biomeList.filter((biome) => biome.placement === placement),
            }))
            .filter((group) => group.biomes.length > 0);
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
            return builtInKey ? platform.i18n.localize(`FILRODENSWMB.BIOMES.${builtInKey}`) : "";
        }
        return platform.i18n.localize(`FILRODENSWMB.BIOMES.${lookupKey}`);
    }

    #applyInitialBootState() {
        if (this.hasBooted) return;

        this.hasBooted = true;
        this.#syncMapControls();

        const activeWindow = this.root.ownerDocument.defaultView || window;
        activeWindow.setTimeout(async () => {
            // The studio opens with no world (board N5): nothing is made behind Worlds
            if (!this.surfaceMade) {
                this.#showUnmade();
                return;
            }
            await this.generateTerrain();
            this.isDirty = false;
            // Unless a map was loaded meanwhile, the new map gets its (empty) display mesh
            if (!this.currentSaveId) {
                MeshIntegration.startNewMap(this);
                this.#captureEditorBaseline();
            }
        }, 50);
    }

    /**
     * Asks whether the studio may close, which asks about unsaved changes when there are any. The
     * host calls this before closing, and closes only on true, then calls destroy(). Once it has
     * answered true, any later call answers false, so a second close request while the first is
     * still asking, or still closing, never shuts the studio down twice.
     *
     * @returns {Promise<boolean>}
     */
    async canClose() {
        if (this.#closing) return false;
        this.#closing = true;

        let allowed = false;
        try {
            // A save already under way decides whether there are unsaved changes left, so it is
            // allowed to finish before the user is asked about them
            if (this.#activeSave) await this.#activeSave;
            allowed = await this.#gateUnsavedChanges();
        } finally {
            if (!allowed) this.#closing = false;
        }
        return allowed;
    }

    /**
     * Shuts the studio down as its host closes: stops its redraws, its dialogues and its canvas,
     * and lets go of the root. Called once, after canClose() has answered true.
     */
    destroy() {
        this.#shutDown = true;
        this.#closeLayerMenu();
        this.#layout?.stop();
        this.#layout = null;
        this.#stopFullscreenWatch?.();
        this.#stopFullscreenWatch = null;
        AppearanceMenu.close(this.root);
        // A redraw still queued would draw into a window that is going away
        this.view?.destroy();
        if (this.canvasEngine) this.canvasEngine.destroy();
        if (this.scene3D) this.scene3D.destroy();

        // The scratch buffer is recreated whenever it is needed, so it can go with the studio
        this.bufferScratch = null;
        this.root = null;
    }

    /**
     * A brush engine for the open map's size, given the map's surface texture for the Roughen
     * and Level brushes (see ProceduralOrchestrator.getSurfaceTexture). The texture is only
     * worked out where one of those brushes needs it, when it first does.
     */
    #createBrushEngine() {
        const brushEngine = new BrushEngine(this.mapWidth, this.mapHeight);
        brushEngine.surfaceTexture = (bounds) => ProceduralOrchestrator.getSurfaceTexture(this, bounds);
        brushEngine.surfaceTextureAmplitude = ProceduralEngine.getSurfaceTextureAmplitude();
        return brushEngine;
    }

    #wireBrushCallbacks() {
        this.canvasEngine.onBrushStart = (x, y) => this.#handleBrushStart(x, y);
        this.canvasEngine.onBrushMove = (x, y) => this.#handleBrushMove(x, y);
        this.canvasEngine.onBrushEnd = () => this.#handleBrushEnd();

        this.canvasEngine.onReferencePan = (dx, dy) => this.#handleReferencePan(dx, dy);
        this.canvasEngine.onReferenceScale = (factor) => this.#handleReferenceScale(factor);

        this.canvasEngine.onInfraDragStart = () => MapStateManager.pushVectorState(this);
        this.canvasEngine.onInfraDrag = () => this.#handleInfraDrag();
        // A generated pin moved or resized by hand is the reader's own (its label dragged is not; see GeneratedEdits)
        this.canvasEngine.onInfraDragEnd = (drag) => {
            if (drag?.entityType === "pin") GeneratedEdits.mark(drag.target);
            this.#handleInfraDragEnd();
        };

        this.canvasEngine.onInfraInsertNode = (x, y) => this.#handleInfraInsertNode(x, y);
        this.canvasEngine.onInfraDeleteNode = (target) => this.#handleInfraDeleteNode(target);

        this.canvasEngine.onRightClick = () => this.#handleRightClick();
        this.canvasEngine.onDoubleClick = (hitData) => this.#handleCanvasDoubleClick(hitData);
        this.canvasEngine.onHeldItemChange = () => this.#updateCanvasHint();
    }

    /**
     * Refreshes the list of canvas actions in the map's corner (see CanvasHints) for the current
     * tool, mode, and whatever the pointer holds. Called after every render, since tool and mode
     * changes all end in one, and whenever the pointer picks up or lets go of an item.
     */
    #updateCanvasHint() {
        const element = this.root?.querySelector(".fwmb-map-hint");
        if (!element) return;

        const context = CanvasHints.resolveContext({
            is3DView: !!this.scene3D,
            // Cartography and the Select modes take clicks without editing (see #canvasInteractive)
            isEditMode: this.#canvasInteractive(),
            activeTool: this.activeTool,
            isCropMode: !!this.canvasEngine?.isCropMode,
            isReferenceMode: !!this.canvasEngine?.isReferenceMode,
            featureMode: this.uiState.activeFeatureMode,
            infraMode: this.uiState.activeInfraMode,
            regionMode: RegionPainter.mode(this),
            influenceMode: InfluencePainter.mode(this),
            routeMode: RouteTool.mode(this),
            pickMode: PickTool.mode(this),
            selecting: PickTool.selecting(this),
            isMaskDrawing: this.#isMaskDrawingMode(),
            heldItem: this.canvasEngine?.heldItem ?? null,
            pickingHomeland: CultureMarkers.picking(this),
            pickingEventPlace: AgeEventRows.picking(this),
            travelPicking: TravelView.picking(this),
        });

        const touch = CanvasHints.isTouchScreen(element.ownerDocument.defaultView ?? globalThis);
        CanvasHints.render(element, CanvasHints.getItems(context, { touch }), (key) => platform.i18n.localize(key));
    }

    /**
     * The list of canvas actions brought up to date outside a redraw (a culture's homeland pick, or
     * an event's place, starting or ending). On a world page the pick also swaps the page for the
     * map and back (see #worldPicking).
     */
    refreshCanvasHint() {
        this.#updateCanvasHint();
        if (WorldEditors.isEditor(this.activeTool)) this.view?.render(["context", "editToolbar"]);
    }

    /** The id of the list row an action's button sits in. */
    static #rowId(target) {
        return target.closest(".fwmb-list-item, tr[data-list-item]")?.dataset.id ?? null;
    }

    /** The label a Labels list row names: its id, its owner's type ("custom" for a standalone label) and level. */
    static #labelRef(target) {
        const row = target.closest(".fwmb-list-item");
        return { id: row?.dataset.id, type: row?.dataset.type || "custom", layerId: row?.dataset.layerId ?? null };
    }

    #handleCanvasDoubleClick(hitData) {
        if (!hitData?.entityType || !hitData.entityId) return;

        const { entityType, entityId, parentType, layerId } = hitData;

        switch (entityType) {
            case "pin":
                PinEditor.open(this, entityId);
                break;
            case "route":
                RouteEditor.open(this, entityId);
                break;
            case "region":
                RegionEditor.open(this, layerId, entityId);
                break;
            case "landMask":
                LandMaskEditor.open(this, entityId);
                break;
            case "fault":
                FaultEditor.open(this, entityId);
                break;
            case "river":
                RiverEditor.open(this, entityId);
                break;
            case "decoration":
                DecorationEditor.open(this, entityId);
                break;
            case "label":
                LabelEditor.open(this, { id: entityId, type: parentType, layerId });
                break;
        }
    }

    /** Whether the Infrastructure tool is in Route mode, so the Routes tool has the map. */
    #isRouteMode() {
        return this.activeTool === "infrastructure" && this.uiState.activeInfraMode === "route";
    }

    #handleRightClick() {
        // A route being placed is finished by a right-click, as a line is
        if (RouteTool.finishDraft(this)) return true;

        let cleared = false;
        let requiresTerrainUpdate = false;

        for (const config of Object.values(FILRODENSWMB.ENTITY_CONFIG)) {
            if (config.activeKey && this[config.activeKey]) {
                this[config.activeKey] = null;
                cleared = true;
                if (config.triggersTerrain) requiresTerrainUpdate = true;
            }
        }

        if (this.activeLandMaskId) {
            cleared = true;
            if (this._finishActiveLandMask()) requiresTerrainUpdate = true;
        }

        if (cleared) {
            this._repaintVectors();
            RouteTool.updateOverlays(this);
            this.view?.render(["editToolbar"]);
            if (requiresTerrainUpdate) this.requestTerrainUpdate();
            return true;
        }
    }

    #handleBrushStart(x, y) {
        if (!this.canvasEngine.isEditMode) return;

        let layer = "terrain";
        if (this.activeTool === "scene") layer = "scene";
        if (this.activeTool === "biomes" || this.activeTool === "worldBiomes") layer = "biome";
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
        // Where the painted biome may appear (land, sea or both), recorded on the stroke so it
        // replays the same way whatever later happens to the biome's placement
        const paintSides = layer === "biome" ? BiomePlacement.buildSidesTable(this.uiState.customBiomes)[paintValue] : null;

        this.brushEngine.startStroke(layer, tool, size, strength, feather, paintValue, paintSides);
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
            // No redraw follows a brush stroke ending (painting stays lightweight), so the Undo/Redo
            // buttons need their own direct refresh here rather than waiting for one.
            this.#updateHistoryButtons();
        }

        this.markDirty();
        // A terrain or biome stroke changes what the generator reads
        if (this.brushEngine?.history?.length > prevLength) this.#markGeneratorStale();

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
        this.view?.render(["context"]);
        this.#updateReferenceLayer();
    }

    #handleInfraDrag() {
        this.canvasEngine.clearInteractiveTargets();

        const isEdit = this.canvasEngine.isEditMode;

        // Only the layer being worked on is drawn again while something is dragged: a map with
        // thousands of generated pins and routes would otherwise redraw them at every move
        const shown = DetailLevel.shown(this);
        this.canvasEngine.setLabelFilter(ContentRows.labelShown(this));
        this.canvasEngine.setNameFilter(shown.showsName);
        this.canvasEngine.setSymbolScale(SymbolScale.of(this.uiState));
        this.canvasEngine.setNameInset?.(nameInset(this.uiState));
        if (this.activeTool === "infrastructure") {
            const infraPins = shown.pins.filter((p) => !!p.icon);
            this.canvasEngine.renderInfrastructure(infraPins, shown.routes, isEdit, this.meshSession);
        }
        if (this.activeTool === "regions") MeshIntegration.renderRegions(this);

        if (this.activeTool === "features") {
            this.canvasEngine.renderFeaturePins(this.mapPins, isEdit, this.proceduralSprings);

            if (this.canvasEngine.renderFaultLines) {
                this.canvasEngine.renderFaultLines(this.tectonicFaults, isEdit, this.activeFaultId, isEdit, TerrainVersion.usesCentripetalLines(this.uiState));
            }

            if (this.canvasEngine.renderManualRivers) {
                this.canvasEngine.renderManualRivers(this.manualRivers, isEdit, this.activeRiverId, isEdit, TerrainVersion.usesCentripetalLines(this.uiState));
            }
        }

        if (this.activeTool === "labels") {
            this.canvasEngine.renderLabels(this.mapLabels, shown.pins, shown.routes, isEdit, this.meshSession, RiverLabels.items(this));
        }

        if (this.activeTool === "scene" && this.canvasEngine.renderLandMasks) {
            const isGuided = this.uiState.generationEngine === "guided";
            this.canvasEngine.renderLandMasks(this.landMasks, isEdit, this.activeLandMaskId, isGuided);
        }

        if (this.activeTool === "cartography" && this.canvasEngine.renderCartography) {
            this.canvasEngine.renderCartography(this.uiState, this.mapWidth, this.mapHeight, isEdit, this.mapDecorations);
        }
    }

    /**
     * Removes a procedural spring (see RiverSources) by adding a pin that removes it, since
     * procedural springs are placed afresh on every refresh and are not stored themselves.
     * @returns {boolean} Whether `target` was a procedural spring.
     */
    #removeProceduralSpring(target) {
        const index = this.proceduralSprings?.indexOf(target) ?? -1;
        if (index < 0 || this.activeTool !== "features") return false;

        MapStateManager.pushVectorState(this);
        this.mapPins.push(RiverSources.removalPin(target));
        this.proceduralSprings.splice(index, 1);
        this._repaintVectors();
        this.debouncedCanvasClimate();
        this.view?.render(["context"]);
        this.markDirty();
        return true;
    }

    /**
     * Turns every procedural spring the user dragged into their own spring where they dropped
     * it, and removes the procedural one from where it was (see #removeProceduralSpring).
     */
    #adoptMovedSprings() {
        for (const spring of this.proceduralSprings ?? []) {
            if (spring.x === spring.homeX && spring.y === spring.homeY) continue;
            this.mapPins.push(RiverSources.removalPin({ x: spring.homeX, y: spring.homeY }));
            this.mapPins.push({ id: platform.utils.randomID(), name: "River Source", x: spring.x, y: spring.y, type: "spring", radius: FILRODENSWMB.DISPLAY.PIN_RADIUS, visibility: "all" });
            spring.homeX = spring.x;
            spring.homeY = spring.y;
        }
    }

    #handleInfraDragEnd() {
        if (this.activeTool === "features") this.#adoptMovedSprings();

        // A region's label is drawn on the labels layer, which the drag itself does not redraw
        // outside the Labels tool (see #handleInfraDrag). A label not yet placed sits at its
        // region's centre, so redrawing once on release brings it to the region's new centre.
        // Likewise a decoration moved, turned or resized in the Cartography tool: names keep clear
        // of where it now is once it is let go.
        if (this.activeTool === "regions" || this.activeTool === "cartography") this._repaintVectors();

        this.view?.render(["context"]);
        this.markDirty();

        if (this.activeTool === "features" || this.activeTool === "scene") {
            this.requestTerrainUpdate();
        }
    }

    #handleInfraInsertNode(x, y) {
        if (!["features", "scene"].includes(this.activeTool)) return;

        // This only ever splits an existing line/polygon segment (land masks, fault lines, manual
        // rivers), since pins have no segments and never reach this path, so both tools may extend
        // into the buffer here
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

        this.view?.render(["context"]);
        this.markDirty();
    }

    #isNearExistingNode(x, y) {
        const isNear = (pt) => Math.hypot(pt.x - x, pt.y - y) < this.currentSnapThreshold;
        return this.mapPins.some((pin) => pin.visibility !== "none" && pin.icon && isNear(pin));
    }

    #findClosestSegment(x, y) {
        let bestMatch = null;

        // Check Generic Vectors (Rivers, Faults)
        for (const config of Object.values(FILRODENSWMB.ENTITY_CONFIG)) {
            if (config.toolCategory !== this.activeTool) continue;

            const segment = SpatialMath.getClosestVectorSegment(this[config.stateKey], x, y, this.currentSnapThreshold, !!config.smoothed, TerrainVersion.usesCentripetalLines(this.uiState));
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
        if (!["infrastructure", "features", "scene"].includes(this.activeTool)) return;
        if (target.icon && this.activeTool !== "infrastructure") return;
        if (this.#removeProceduralSpring(target)) return;

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

        this.view?.render(["context"]);
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

        // 2. Check Generic Vectors (Faults, Rivers)
        for (const config of Object.values(FILRODENSWMB.ENTITY_CONFIG)) {
            if (config.toolCategory !== this.activeTool) continue;

            const vectorArray = this[config.stateKey];
            const vIndex = vectorArray.findIndex((v) => v.points?.includes(target));

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

        // 3. Check Land Masks
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
     * @param {Array} polygons - The array the polygon lives in (this.landMasks).
     * @param {object} polygon - The incomplete polygon to remove.
     */
    #discardIncompletePolygon(polygons, polygon) {
        polygons.splice(polygons.indexOf(polygon), 1);

        this._repaintVectors();
        this.view?.render(["context"]);
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

    #handleSceneClick(x, y) {
        // Guard clause: Only process clicks if we are actively drawing a land/ocean masks
        if (!this.#isMaskDrawingMode()) return;

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
            const newMask = this.#createLandMask(this.#selectedMaskOperation(), []);
            this.landMasks.push(newMask);
            this.activeLandMaskId = newMask.id;
            // A new object opens in the inspector, focus staying on the map
            LandMaskEditor.open(this, newMask.id, { created: true });
        }

        // Locate the active mask and append the new vertex
        const mask = this.landMasks.find((m) => m.id === this.activeLandMaskId);
        if (mask) {
            mask.points.push({ x, y });
            this.markDirty();
            this._repaintVectors();
            this.view?.render(["context"]);
        }
    }

    /** The land mask operation the bar's Land, Ocean or Coast only mode selects. */
    #selectedMaskOperation() {
        return { subtractMask: "subtract", coastMask: MaskSettings.COAST_ONLY }[this.uiState.sceneMode] ?? "add";
    }

    /**
     * Builds a new land mask with the default name for its operation ("Landmass n", "Ocean
     * Hole n" or "Coast n", numbered by the masks already on the map). It is not added to the map.
     *
     * @param {"add"|"subtract"|"settings"} operation
     * @param {Array<{x: number, y: number}>} points
     */
    #createLandMask(operation, points) {
        const number = this.landMasks.length + 1;
        return {
            id: platform.utils.randomID(),
            name: { subtract: `Ocean Hole ${number}`, settings: `Coast ${number}` }[operation] ?? `Landmass ${number}`,
            operation,
            points,
        };
    }

    /**
     * Adds one random land mask of the type the Add Land / Remove Land toggle selects (see
     * LandMaskGenerator). The new mask is added to the existing ones as a single undo step, so it
     * can be undone, edited node by node, or built on like a hand-drawn mask.
     *
     * A mask being drawn is finished first (or discarded if it is not yet a shape), exactly as
     * switching mode does, so the random mask never joins it. A Remove Land shape is only made
     * over existing land, since a hole in open sea would change nothing; with no land on the map
     * the user is told why nothing happened instead.
     */
    _onGenerateRandomLandMask(_event, _target) {
        if (!this.#isMaskDrawingMode()) return;

        const finishedMaskNeedsTerrain = this.activeLandMaskId ? this._finishActiveLandMask() : false;
        const operation = this.#selectedMaskOperation();
        const points = LandMaskGenerator.generatePolygon({
            mapWidth: this.mapWidth,
            mapHeight: this.mapHeight,
            operation,
            existingMasks: this.landMasks,
        });

        if (!points) {
            platform.notify.info(platform.i18n.localize("FILRODENSWMB.UI.RandomLandMaskNoLand"));
            this.#refreshAfterLandMaskChange(finishedMaskNeedsTerrain);
            return;
        }

        MapStateManager.pushVectorState(this);
        const mask = this.#createLandMask(operation, points);
        this.landMasks.push(mask);
        this.#refreshAfterLandMaskChange(true);
        LandMaskEditor.open(this, mask.id, { created: true });
    }

    /**
     * Adds a random set of land masks covering the whole map (see RandomLandMap): landmasses as
     * Add Land masks and the lakes and inland seas inside them as Remove Land masks. They are
     * added after the existing masks as a single undo step, so they can be undone, edited node by
     * node, or built on like hand-drawn masks. As the new masks come last, they decide the land
     * wherever they cover it; existing land elsewhere stays.
     *
     * A mask being drawn is finished first (or discarded if it is not yet a shape), exactly as
     * switching mode does.
     */
    _onGenerateRandomLandMap(_event, _target) {
        if (!this.#isMaskDrawingMode()) return;
        if (this.activeLandMaskId) this._finishActiveLandMask();

        const masks = RandomLandMap.generate({ mapWidth: this.mapWidth, mapHeight: this.mapHeight });

        MapStateManager.pushVectorState(this);
        for (const { operation, points } of masks) {
            this.landMasks.push(this.#createLandMask(operation, points));
        }
        this.#refreshAfterLandMaskChange(true);
    }

    /** Whether a mask drawing mode (Land, Ocean or Coast only) is selected, rather than Select or Crop. */
    #isMaskDrawingMode() {
        return ["addMask", "subtractMask", "coastMask"].includes(this.uiState.sceneMode);
    }

    /**
     * Moves an item of a list in order (see ListReorder) to its new place, as one undo step: the
     * land masks (later masks lie on top, so a move shapes the land again), and a region's cultures
     * in its inspector.
     */
    #moveListItem(list, id, to) {
        // A region's cultures in its inspector: the top card rules (see RegionCultureCard)
        if (list === CULTURE_LIST) return RegionEditor.moveCulture(this, id, to);
        if (list !== "landMasks") return;
        const from = this.landMasks.findIndex((mask) => mask.id === id);
        if (from < 0 || from === to || to < 0 || to >= this.landMasks.length) return;
        MapStateManager.pushVectorState(this);
        const [mask] = this.landMasks.splice(from, 1);
        this.landMasks.splice(to, 0, mask);
        this.#refreshAfterLandMaskChange(true);
    }

    /** Redraws the land masks and their list, and regenerates the terrain when asked to. */
    #refreshAfterLandMaskChange(needsTerrain) {
        this._repaintVectors();
        if (needsTerrain) {
            this.requestTerrainUpdate();
            this.markDirty();
        }
        this.view?.render(["context"]);
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
        let activeEntity;

        if (this.uiState.activeFeatureMode === "spring") {
            this.mapPins.push({
                id: platform.utils.randomID(),
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
                const existing = this.tectonicFaults.find((f) => f.id === this.activeFaultId);
                if (existing) existing.points.push(finalPos);
            } else {
                this.activeFaultId = platform.utils.randomID();
                const type = this.#resolveFaultType();
                const fault = {
                    id: this.activeFaultId,
                    name: `Fault ${this.tectonicFaults.length + 1}`,
                    description: "",
                    points: [finalPos],
                    type,
                    thickness: this.uiState.faultThickness,
                    strength: this.uiState.faultStrength,
                    color: TectonicFeatureEngine.colorOf(type),
                    visibility: "all",
                };
                MapStudio.#applyFeatureFields(fault, this.uiState);
                this.tectonicFaults.push(fault);
                FaultEditor.open(this, fault.id, { created: true });
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
                this.activeRiverId = platform.utils.randomID();
                const river = {
                    id: this.activeRiverId,
                    name: "",
                    points: [finalPos],
                    width: this.uiState.riverWidth,
                    visibility: "all",
                    // Its name is drawn along it (see RiverLabels), in the River label style when the map has it
                    label: RiverLabels.newLabel(this),
                };
                // A name in the language of the people living there, as Random name gives
                // (its number in the list only when none can be made)
                river.name = RandomNames.suggest(this, "river", river) || platform.i18n.format("FILRODENSWMB.UI.RiverDefaultName", { number: this.manualRivers.length + 1 });
                river.nameSource = "random";
                river.nameRoll = 0;
                this.manualRivers.push(river);
                RiverEditor.open(this, this.activeRiverId, { created: true });
            }
            activeEntity = this.manualRivers.find((r) => r.id === this.activeRiverId);
            const newBounds = SpatialMath.getVectorBounds(activeEntity);
            this._repaintVectors();
            this.requestTerrainUpdate(SpatialMath.mergeBounds(oldBounds, newBounds));
        }

        this.view?.render(["context"]);
        this.markDirty();
    }

    /** Every terrain layer, all on or all off. */
    static #allTerrainLayers(isOn) {
        const layers = {};
        for (const group of Object.values(MapStudio.#TERRAIN_LAYER_GROUPS)) {
            for (const key of Object.keys(group.layers)) layers[key] = isOn;
        }
        return layers;
    }

    /** The terrain images the painters fill, as the canvas's terrain shader takes them. */
    #terrainBuffers() {
        return { surface: this.bufferSurfaceBiomes, underwater: this.bufferUnderwaterBiomes, aux: this.bufferTerrainAux, rivers: this.bufferRivers };
    }

    /**
     * Sends the terrain shader the settings that come from the app rather than from the painted
     * images: which terrain layers are shown, the relief strength and the map's water settings.
     * (Biome opacity is sent by #updateBiomeOpacity, since it also depends on the active tool.)
     */
    #syncTerrainSettings() {
        this.canvasEngine?.setTerrainSettings(this.#terrainSettings());
    }

    /** The terrain shading settings that come from the app (see TerrainShading.defaultSettings). */
    #terrainSettings() {
        const water = FILRODENSWMB.DISPLAY.WATER;
        const hue = Math.min(water.HUE_MAX, Math.max(water.HUE_MIN, this.uiState.waterHue ?? water.HUE));
        return {
            ...this.#terrainLayers,
            reliefStrength: this.uiState.reliefShading ?? FILRODENSWMB.DISPLAY.RELIEF_SHADING,
            seabedRelief: this.uiState.seabedRelief ?? water.SEABED_RELIEF,
            clarity: this.uiState.waterClarity ?? water.CLARITY,
            hueShift: hue - water.BASE_HUE,
            saturation: this.uiState.waterSaturation ?? water.SATURATION,
        };
    }

    /**
     * Whether all, some or none of a group's layers are on.
     * @returns {"on"|"partial"|"off"}
     */
    #layerGroupState(groupId) {
        const keys = Object.keys(MapStudio.#TERRAIN_LAYER_GROUPS[groupId].layers);
        const onCount = keys.filter((key) => this.#terrainLayers[key]).length;
        if (onCount === keys.length) return "on";
        return onCount === 0 ? "off" : "partial";
    }

    /** The map controls' terrain layer groups, for map.hbs. */
    #layerGroupsContext() {
        const ariaChecked = { on: "true", partial: "mixed", off: "false" };
        return Object.entries(MapStudio.#TERRAIN_LAYER_GROUPS).map(([id, group]) => {
            const state = this.#layerGroupState(id);
            return {
                id,
                icon: group.icon,
                tooltip: group.tooltip,
                state,
                allChecked: ariaChecked[state],
                items: Object.entries(group.layers).map(([key, label]) => ({ key, label, checked: this.#terrainLayers[key] ? "true" : "false" })),
            };
        });
    }

    /**
     * Writes every view's state onto the map controls, in place, so an open list stays open while
     * it is being ticked (see MapControls). The map region is drawn once, so this is the only way
     * its controls change: every action that changes a view calls it (a test checks this), which
     * is what keeps a toggle from disagreeing with what the map shows.
     */
    /** The Labels and Regions menus' rows as last written onto the map controls, to tell when they change. */
    #contentSignature = "";

    static #signatureOf(groups) {
        return groups.map((group) => group.rows.map((row) => `${row.kind}:${row.key}:${row.label}:${row.on ? 1 : 0}`).join("|")).join("/");
    }

    /**
     * The Labels and Regions menus' rows, and the thematic layers' menu, brought up to date after
     * the map changed (a new label style or level; a run made, undone or opened, which makes the
     * thematic layers available or not).
     */
    #syncContentRows() {
        if (this.#menuSignature(ContentRows.groups(this), ThematicView.controlState(this)) !== this.#contentSignature) this.#syncMapControls();
    }

    /** What the map controls' changing menus hold, to tell when they must be marked again. */
    #menuSignature(contentGroups, thematic) {
        return `${MapStudio.#signatureOf(contentGroups)}#${JSON.stringify(thematic)}`;
    }

    #syncMapControls() {
        if (!this.root) return;
        const terrainGroups = Object.entries(MapStudio.#TERRAIN_LAYER_GROUPS).map(([id, group]) => ({
            id,
            items: Object.keys(group.layers).map((key) => ({ key, on: !!this.#terrainLayers[key] })),
        }));
        // The Labels and Regions menus' rows (see ContentRows); each counts as shown unless all its rows are off
        const contentGroups = ContentRows.groups(this);
        const thematic = ThematicView.controlState(this);
        this.#contentSignature = this.#menuSignature(contentGroups, thematic);
        const state = {
            viewFilters: this.viewFilters,
            layers: { ...this.#layerVisibility, ...Object.fromEntries(contentGroups.map((group) => [group.id, group.state !== "off"])) },
            grid: !!this.uiState.gridVisible,
            detailLevel: DetailLevel.current(this),
            avoidOverlaps: this.uiState.avoidLabelOverlaps !== false,
            symbolSizes: SymbolScale.choices(this.uiState),
            contentGroups,
            terrainGroups,
            threeD: !!this.scene3D,
            thematic,
        };
        const detailName = (level) => platform.i18n.localize(FILRODENSWMB.DETAIL.LEVELS.find((choice) => choice.value === level).label);
        syncMapControls(this.root, state, detailName, (percent) => platform.i18n.format("FILRODENSWMB.UI.SymbolSizeAutoValue", { percent }));
        // Thematic views' button grows and shrinks with the view's name; the controls may fold differently
        this.#layout?.update();
    }

    /**
     * Shows or hides terrain layers and redraws.
     * @param {object} changes - Layer key -> whether it is shown.
     */
    #setTerrainLayers(changes) {
        this.#terrainLayers = { ...this.#terrainLayers, ...changes };
        this.#syncTerrainSettings();
        this.#syncMapControls();
    }

    /** Opens or closes a terrain layer group's list (a click on the group's button). */
    _onToggleLayerMenu(_event, target) {
        const container = target.closest(".fwmb-layer-group");
        if (!container) return;
        if (this.#openLayerMenu === container) {
            this.#closeLayerMenu();
            return;
        }

        this.#closeLayerMenu();
        const menu = container.querySelector(":scope > .fwmb-layer-menu:not(.fwmb-layer-submenu)");
        menu?.classList.remove("fwmb-hidden");
        target.setAttribute("aria-expanded", "true");
        this.#openLayerMenu = container;

        const doc = this.root.ownerDocument;
        doc.addEventListener("pointerdown", this.#onPointerDownOutsideMenu, true);
        doc.addEventListener("keydown", this.#onMenuKeyDown, true);
        // Show's rows open their submenus under a fine pointer as it passes over them
        container.addEventListener("pointerover", this.#onMenuPointerOver);
        // A list of choices opens on the one chosen; a list of switches on its first
        (menu?.querySelector('[role="menuitemradio"][aria-checked="true"]') ?? menu?.querySelector(MapStudio.#MENU_ROWS))?.focus();
    }

    /** The rows of the map controls' menus the arrow keys move between. */
    static #MENU_ROWS = '[role="menuitemcheckbox"]:not([aria-disabled="true"]), [role="menuitemradio"], [role="menuitem"]';

    /** Show's open submenu, and the row that opened it. */
    #openSubmenu = null;

    /**
     * Opens one of Show's submenus beside the menu, from its row (a click, Enter or the arrow key
     * toward it, or a fine pointer passing over the row), closing any other. Bottom-aligned with the
     * menu, on its start side (the controls sit at the canvas's end).
     */
    #openShowPart(row, { focus = false, hover = false } = {}) {
        const container = row?.closest(".fwmb-layer-group");
        const panel = container?.querySelector(`[data-show-panel="${row.dataset.showPart}"]`);
        if (!panel) return;
        if (this.#openSubmenu?.row !== row) {
            const menu = row.closest(".fwmb-layer-menu");
            // No room beside the menu on the canvas (a narrow window): the submenu takes the
            // menu's place, with a way back at its head; then only a click opens it, never a
            // pointer passing over the row (it would cover the rows the pointer is heading for)
            const preview = container.closest(".fwmb-map-preview")?.getBoundingClientRect();
            const box = menu.getBoundingClientRect();
            const rtl = container.ownerDocument.defaultView.getComputedStyle(container).direction === "rtl";
            const room = preview ? (rtl ? preview.right - box.right : box.left - preview.left) : Infinity;
            panel.classList.remove("fwmb-hidden");
            const over = panel.offsetWidth + 8 > room;
            if (over && hover) {
                panel.classList.add("fwmb-hidden");
                this.#closeSubmenu();
                return;
            }
            this.#closeSubmenu();
            panel.classList.remove("fwmb-hidden");
            container.style.setProperty("--fwmb-submenu-offset", `${menu.offsetWidth + 4}px`);
            container.toggleAttribute("data-submenu-over", over);
            row.setAttribute("aria-expanded", "true");
            row.classList.add("fwmb-menu-item--open");
            this.#openSubmenu = { row, panel };
        }
        if (focus) (panel.querySelector('[role="menuitemradio"][aria-checked="true"]') ?? [...panel.querySelectorAll(MapStudio.#MENU_ROWS)].find((each) => each.offsetParent !== null))?.focus();
    }

    #closeSubmenu() {
        const open = this.#openSubmenu;
        if (!open) return;
        open.panel.closest(".fwmb-layer-group")?.removeAttribute("data-submenu-over");
        open.panel.classList.add("fwmb-hidden");
        open.row.setAttribute("aria-expanded", "false");
        open.row.classList.remove("fwmb-menu-item--open");
        this.#openSubmenu = null;
    }

    /** Back from a submenu to its row in Show (the submenu's Back, when it took the menu's place). */
    #backToShow() {
        const row = this.#openSubmenu?.row;
        this.#closeSubmenu();
        row?.focus();
    }

    /** A fine pointer over Show's rows: a row with parts opens its submenu, any other closes it. */
    #onMenuPointerOver = (event) => {
        if (event.pointerType && event.pointerType !== "mouse") return;
        const row = event.target.closest?.(".fwmb-layer-menu:not(.fwmb-layer-submenu) > [role]");
        if (!row || row.closest("[data-submenu-over]")) return;
        if (row.dataset.action === "openShowPart") this.#openShowPart(row, { hover: true });
        else this.#closeSubmenu();
    };

    /** Closes the open terrain layer list, if any. */
    #closeLayerMenu() {
        const container = this.#openLayerMenu;
        if (!container) return;

        this.#closeSubmenu();
        container.removeEventListener("pointerover", this.#onMenuPointerOver);
        container.querySelector(":scope > .fwmb-layer-menu:not(.fwmb-layer-submenu)")?.classList.add("fwmb-hidden");
        container.querySelector('[data-action="toggleLayerMenu"]')?.setAttribute("aria-expanded", "false");
        this.#openLayerMenu = null;

        const doc = container.ownerDocument;
        doc.removeEventListener("pointerdown", this.#onPointerDownOutsideMenu, true);
        doc.removeEventListener("keydown", this.#onMenuKeyDown, true);
    }

    /** A click anywhere outside the open list (its button included, which toggles it itself) closes it. */
    #onPointerDownOutsideMenu = (event) => {
        if (this.#openLayerMenu && !this.#openLayerMenu.contains(event.target)) this.#closeLayerMenu();
    };

    /**
     * Escape closes the open submenu, else the open list, returning focus to what opened it; the
     * arrow keys move along the list the focus is in. Across (either way: the convention's
     * ArrowRight, or toward the submenu, which is drawn on the start side) a Show row opens its
     * submenu, and a submenu gives the focus back to its row.
     */
    #onMenuKeyDown = (event) => {
        if (!this.#openLayerMenu) return;
        const panel = event.target.closest?.(".fwmb-layer-menu");
        // The arrow keys move between the list's rows, wrapping round at either end
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            const rows = [...(panel ?? this.#openLayerMenu).querySelectorAll(MapStudio.#MENU_ROWS)].filter((row) => row.offsetParent !== null);
            const index = rows.indexOf(event.target);
            if (index === -1) return;
            event.preventDefault();
            event.stopPropagation();
            const next = rows[(index + (event.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length];
            next.focus();
            // Moving along Show's rows closes the submenu of the row left
            if (!panel?.classList.contains("fwmb-layer-submenu") && next.dataset.action !== "openShowPart") this.#closeSubmenu();
            return;
        }
        // Either way across: the menu convention's ArrowRight, or toward the submenu as it is drawn
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            if (event.target.dataset?.action === "openShowPart") {
                event.preventDefault();
                event.stopPropagation();
                this.#openShowPart(event.target, { focus: true });
            } else if (panel?.classList.contains("fwmb-layer-submenu") && this.#openSubmenu) {
                event.preventDefault();
                event.stopPropagation();
                this.#backToShow();
            }
            return;
        }
        if (event.key !== "Escape") return;
        event.stopPropagation();
        if (panel?.classList.contains("fwmb-layer-submenu") && this.#openSubmenu) {
            this.#backToShow();
            return;
        }
        const button = this.#openLayerMenu.querySelector('[data-action="toggleLayerMenu"]');
        this.#closeLayerMenu();
        button?.focus();
    };

    /** Ticks or unticks a layer in a terrain layer list, or all of the group's layers ("all"). */
    _onToggleTerrainLayer(_event, target) {
        const layer = target.dataset.terrainLayer;
        const group = MapStudio.#TERRAIN_LAYER_GROUPS[target.dataset.layerGroup];
        if (!layer || !group) return;

        if (layer === "all") {
            // "All" turns every layer of the group on, unless they already are, in which case it turns them all off
            const turnOn = this.#layerGroupState(target.dataset.layerGroup) !== "on";
            this.#setTerrainLayers(Object.fromEntries(Object.keys(group.layers).map((key) => [key, turnOn])));
            return;
        }
        this.#setTerrainLayers({ [layer]: !this.#terrainLayers[layer] });
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
     * @param {boolean} [options.vectors] - Whether to redraw the vector layers (pins, routes,
     *   regions, labels) as well. The live brush leaves this off: painting changes none of
     *   them, and redrawing them rebuilds every label's text and every pin's icon, which on every
     *   pointer move creates canvases and GPU textures far faster than the browser frees them.
     */
    async _repaintCanvas(requestedBounds = null, { verifyPeak = false, vectors = true } = {}) {
        if (!this.currentElevationData || !this.#isOpen) return;

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

        const { currentSeed, params } = MapStateManager.getMapParameters(this);

        // Only the pixels the painters write are copied to the canvas textures and uploaded to the GPU
        const uploadBounds = ProceduralEngine.getRepaintBounds(bounds, this.mapWidth, this.mapHeight);
        mark = timer.lap("Canvas repaint: settings", mark, `repainting ${this.#describeRepaintArea(bounds)}`);

        // The terrain's packed relief, depth and height are shaded relative to the cached peak and
        // trough. A whole-map repaint may be shared between workers and finish later (see
        // LayerPainting), so everything it paints into is taken now.
        const target = this.#paintingTarget(currentSeed, params);
        const painting = await this.#layerPainting.paint(target, bounds);
        mark = this.#recordPainting(timer, mark, painting);

        if (!this.#isOpen) return;

        // Nothing is uploaded if a newer whole-map repaint took over while this one ran (it uploads
        // its own layers) or the map's buffers were replaced meanwhile (by loading another map)
        if (painting.current && target.outputs.terrainAux === this.bufferTerrainAux) {
            this.#uploadLayers(uploadBounds, target, timer, mark);
            mark = performance.now();
        }

        if (!vectors) return;

        if (this.canvasEngine) {
            this.canvasEngine.clearInteractiveTargets();
        }

        this._repaintVectors();
        timer.lap("Canvas repaint: vector layers", mark);
    }

    /**
     * Everything a repaint of the pixel layers paints from and into (see LayerPainting): the
     * map's inputs and layer buffers as they are now, and the settings the painters read.
     */
    #paintingTarget(seed, params) {
        const hasClimate = Boolean(this.currentMoistureData && this.currentTemperatureData);
        return {
            engine: new ProceduralEngine(seed),
            seed,
            width: this.mapWidth,
            height: this.mapHeight,
            settings: {
                params,
                seaLevel: this.uiState["seaLevel"],
                contourInterval: this.uiState["contourInterval"],
                maxPeak: this.cachedMaxElevation || 1.0,
                minTrough: this.cachedMinElevation || 0,
            },
            inputs: {
                elevation: this.currentElevationData,
                waterMask: this.bufferWaterMask,
                moisture: hasClimate ? this.currentMoistureData : null,
                temperature: hasClimate ? this.currentTemperatureData : null,
                overrides: this.currentBiomeOverrides,
            },
            outputs: {
                terrainAux: this.bufferTerrainAux,
                surfaceBiomes: this.bufferSurfaceBiomes,
                biomeFallback: this.bufferBiomeFallback,
                underwaterBiomes: this.bufferUnderwaterBiomes,
                contours: this.bufferContours,
            },
        };
    }

    /**
     * Records how long the painters took in the timing summary: each painter for a repaint on the
     * main thread, or the three together for one shared between workers.
     *
     * @returns {number} The time to measure the next stage from.
     */
    #recordPainting(timer, mark, painting) {
        if (painting.shared) return timer.lap("Canvas repaint: painters (shared)", mark);

        timer.record("Canvas repaint: terrain painter", painting.timings.terrain);
        timer.record("Canvas repaint: biomes painter", painting.timings.biomes);
        timer.record("Canvas repaint: contours painter", painting.timings.contours);
        return performance.now();
    }

    /**
     * Copies the painted layers to the canvas and uploads them to the GPU (only `uploadBounds`,
     * or everything when it is null). The rule-coverage preview is kept current every repaint,
     * but its layer stays hidden until the "Preview Rule Coverage" button is hovered (see
     * #togglePreviewFallback), so no visibility changes here.
     */
    #uploadLayers(uploadBounds, target, timer, mark) {
        let since = mark;
        if (target.inputs.moisture) {
            this.canvasEngine.renderPixelBuffer("biomeFallback", this.bufferBiomeFallback, this.mapWidth, this.mapHeight, uploadBounds);
        }

        this.#syncTerrainSettings();
        this.canvasEngine.renderTerrain(this.#terrainBuffers(), this.mapWidth, this.mapHeight, uploadBounds);
        since = timer.lap("Canvas repaint: canvas textures", since);

        this.canvasEngine.renderPixelBuffer("contours", this.bufferContours, this.mapWidth, this.mapHeight, uploadBounds);
        timer.lap("Canvas repaint: canvas textures", since);
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
        if (!this.canvasEngine || !this.#isOpen) return;

        this.canvasEngine.clearInteractiveTargets();
        const isEditModeActive = this.canvasEngine.isEditMode;
        MeshIntegration.prepareRender(this);

        // Select modes pick objects without editing them, so no points or handles are drawn
        const picking = PickTool.selecting(this);

        // 1. Render Springs, Faults and custom river guides
        const showPins = this.activeTool === "features" && isEditModeActive && !picking;
        this.canvasEngine.renderFeaturePins(this.mapPins, showPins, this.proceduralSprings);

        if (this.canvasEngine.renderFaultLines) {
            const isFaultEdit = this.activeTool === "features" && isEditModeActive;
            this.canvasEngine.renderFaultLines(this.tectonicFaults, isFaultEdit, this.activeFaultId, isFaultEdit && !picking, TerrainVersion.usesCentripetalLines(this.uiState));
        }

        if (this.canvasEngine.renderManualRivers) {
            const isRiverEdit = this.activeTool === "features" && isEditModeActive;
            this.canvasEngine.renderManualRivers(this.manualRivers, isRiverEdit, this.activeRiverId, isRiverEdit && !picking, TerrainVersion.usesCentripetalLines(this.uiState));
        }

        // 2. Render Infrastructure, at the map's detail level (as are the regions and labels). While
        // the History tool shows an earlier age, the present's regions, pins and routes give way
        // to that age's (see HistoryView), drawn by the same rules
        const past = HistoryView.pastMap(this);
        const shown = DetailLevel.shown(this);
        this.canvasEngine.setDetailFilter(past ? HistoryView.levelFilter(past, shown.showsLevel) : shown.showsLevel);
        this.canvasEngine.setLabelFilter(ContentRows.labelShown(this));
        this.canvasEngine.setNameFilter(shown.showsName);
        this.canvasEngine.setSymbolScale(SymbolScale.of(this.uiState));
        this.canvasEngine.setNameInset?.(nameInset(this.uiState));
        const isInfraEdit = this.activeTool === "infrastructure" && isEditModeActive;
        const pastContent = past ? HistoryView.pastContent(this) : null;
        const shownPins = past ? DetailLevel.pinsShown(this, pastContent.pins) : shown.pins;
        // In the History tool the present's roads are drawn as the earlier ages' are, for likeness
        const shownRoutes = past ? pastContent.routes : HistoryView.presentRoutes(this) ?? shown.routes;
        this.canvasEngine.renderInfrastructure(shownPins.filter((p) => !!p.icon), shownRoutes, isInfraEdit, past ? past.session : this.meshSession);

        // 3. Render Regions, from the display mesh, and the thematic layer under them
        if (past) {
            this.canvasEngine.renderRegionLevels(past.session, { fills: ContentRows.fillsShown(this) });
            MeshIntegration.updateOutline(this);
        } else {
            MeshIntegration.renderRegions(this);
        }
        ThematicView.render(this);
        // The realm under the pointer is read while an earlier age is shown, and hidden otherwise
        HistoryView.readout(this, null, null);
        // The Travel tool's day rings (its bands are drawn with the thematic layer)
        TravelView.render(this);
        TravelView.readout(this, null, null);

        // 4. Render Cartography, before the labels, which keep clear of its decorations and scale bar
        const isCartographyEdit = this.activeTool === "cartography" && isEditModeActive;
        if (this.canvasEngine.renderCartography) {
            this.canvasEngine.renderCartography(this.uiState, this.mapWidth, this.mapHeight, isCartographyEdit, this.mapDecorations);
        }

        // 5. Render Labels
        const isLabelEdit = this.activeTool === "labels" && isEditModeActive;
        this.canvasEngine.renderLabels(this.mapLabels, shownPins, shownRoutes, isLabelEdit, past ? past.session : this.meshSession, RiverLabels.items(this));

        // 6. Render Land Masks
        if (this.canvasEngine.renderLandMasks) {
            // Visible if in Guided Mode and on the Scene Tool, regardless of Edit Mode
            const isGuidedScene = this.uiState.generationEngine === "guided" && this.activeTool === "scene";

            this.canvasEngine.renderLandMasks(this.landMasks, isEditModeActive && !picking, this.activeLandMaskId, isGuidedScene);
        }

        // 7. The Labels and Regions menus follow the map's styles and levels
        this.#syncContentRows();
    }

    #applyBrushStroke(x, y) {
        if (!this.currentElevationData) return;

        const seaLevel = this.uiState["seaLevel"];
        const strokeBounds = this.brushEngine.applyBrush(x, y, this.currentElevationData, this.currentBiomeOverrides, this.currentSpringOverrides, seaLevel, this.currentRoughness);

        // A pointer move shorter than the brush's step spacing stamps nothing yet (the brush
        // waits until it has travelled a full step) and reports that as empty bounds. Nothing
        // changed, so nothing is repainted: the painters read empty bounds as the whole map, so
        // on a large map every short pointer move used to repaint all of it.
        if (!SpatialMath.isValidBounds(strokeBounds)) return;

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
                this.bufferSurfaceBiomes,
                strokeBounds,
                this.bufferBiomeFallback,
                this.bufferUnderwaterBiomes,
            );

            const uploadBounds = ProceduralEngine.getRepaintBounds(strokeBounds, this.mapWidth, this.mapHeight);
            this.canvasEngine.renderTerrain(this.#terrainBuffers(), this.mapWidth, this.mapHeight, uploadBounds);
            this.canvasEngine.renderPixelBuffer("biomeFallback", this.bufferBiomeFallback, this.mapWidth, this.mapHeight, uploadBounds);
            return;
        }

        // Accumulate the bounds for the deferred procedural generation
        this.pendingTerrainBounds = SpatialMath.mergeBounds(this.pendingTerrainBounds, strokeBounds);
        this._repaintCanvas(strokeBounds, { vectors: false });
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
            await this.#startProcessing(platform.i18n.localize("FILRODENSWMB.UI.RebuildingHistory"));

            try {
                const rebuiltArea = ProceduralOrchestrator.rebuildChangedTerrain(this);
                const staleArea = SpatialMath.mergeBounds(rebuiltArea, this.pendingTerrainBounds);
                this.pendingTerrainBounds = null;

                if (SpatialMath.isValidBounds(staleArea)) await this.#generateClimateNow(staleArea);
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
            await this.#startProcessing(platform.i18n.localize("FILRODENSWMB.UI.GeneratingFeatures"));

            try {
                const waterBounds = ProceduralOrchestrator.processFeaturePhase(this, true);

                if (waterBounds) await this._repaintCanvas(waterBounds);
                else this._repaintVectors();
            } finally {
                this.#endProcessing();
            }
        });
    }

    /**
     * Regenerates the map from its settings, or refreshes only what changed when nothing the base
     * terrain depends on has changed, after any refresh already running (see RefreshQueue).
     *
     * @returns {Promise<void>} Settles once the generation has run.
     */
    generateTerrain() {
        return this.#refreshes.request(REFRESH.TERRAIN);
    }

    /**
     * Whether a terrain, climate or feature refresh is running or waiting. Scripted runs of the
     * studio (the tutorial's) read it to know when the map has settled after an edit.
     */
    get refreshing() {
        return this.#refreshes?.busy ?? false;
    }

    /**
     * Recomputes the climate over an area (or, with none, over the area painted since the last
     * refresh, or else the whole map), then the rivers and the canvas, after any refresh already
     * running (see RefreshQueue).
     *
     * @param {object|null} [bounds] - The area to refresh.
     * @returns {Promise<void>}
     */
    generateClimate(bounds = null) {
        return this.#refreshes.request(REFRESH.CLIMATE, { bounds });
    }

    /**
     * Retraces the rivers and repaints the canvas over an area (or, with none, the whole map),
     * after any refresh already running (see RefreshQueue).
     *
     * @param {object|null} [bounds] - The area to refresh.
     * @returns {Promise<void>}
     */
    generateFeatures(bounds = null) {
        return this.#refreshes.request(REFRESH.FEATURES, { bounds });
    }

    async #generateTerrainNow() {
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
            await this.#startProcessing(platform.i18n.localize("FILRODENSWMB.UI.GeneratingTopography"));

            try {
                // Hand off the mathematical heavy lifting to the Orchestrator
                await ProceduralOrchestrator.processTopographyPhase(this);

                // The App maintains control of the Climate and Canvas rendering pipelines
                await this.#generateClimateNow(null);

                ProceduralOrchestrator.rememberGenerationInputs(this, inputs);
            } finally {
                this.#endProcessing();
            }
        });
    }

    async #generateClimateNow(bounds = null) {
        if (!this.currentElevationData) return;

        // Resolve active bounds before clearing pending state
        const requestedBounds = bounds || this.pendingTerrainBounds;
        const activeBounds = this.#resolveRefreshBounds(requestedBounds);
        if (!bounds && this.pendingTerrainBounds) {
            this.pendingTerrainBounds = null;
        }

        await this.#runTimed(`Climate refresh (${activeBounds ? "bounded" : "whole map"})`, async () => {
            await this.#startProcessing(platform.i18n.localize("FILRODENSWMB.UI.GeneratingClimate"));

            try {
                // The climate is recomputed over a wider area than the one that changed, and the
                // canvas has to be repainted over all of it
                const climateBounds = await ProceduralOrchestrator.processClimatePhase(this, activeBounds);
                await this.#generateFeaturesNow(climateBounds);
            } finally {
                this.#endProcessing();
            }
        });
    }

    async #generateFeaturesNow(requestedBounds = null) {
        if (!this.currentElevationData) return;

        const bounds = this.#resolveRefreshBounds(requestedBounds);

        await this.#runTimed(`Features refresh (${bounds ? "bounded" : "whole map"})`, async () => {
            await this.#startProcessing(platform.i18n.localize("FILRODENSWMB.UI.GeneratingFeatures"));

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

    /**
     * Loads a saved map into the Studio and generates it.
     *
     * @param {object} rawPayload - The map data.
     * @param {Object<string, string>} [rawOwners] - Its encoded owner arrays (see platform.store.loadMapOwners).
     * @param {object|null} [modelRun] - The generator's saved outputs (see platform.store.loadMapModelRun).
     */
    async #ingestMapPayload(rawPayload, rawOwners = {}, modelRun = null, { generate = true, report = true } = {}) {
        // Deep clone to sever the connection to Foundry's memory cache
        const payload = platform.utils.deepClone(rawPayload);
        // A map loaded is its world's Surface map, made; a world with no maps reads its settings
        // through here without one (see #openMaplessWorld)
        this.worldOpen = true;
        this.surfaceMade = generate;
        this.#creatingWorld = false;
        this.#terrainChoice = null;
        // Pin and label sizes saved before the current size unit are scaled to it (see SymbolSizes).
        // The map is not marked as changed: until it is saved, the same scaling runs on every load.
        rebaseMap(payload);
        // Generated names that older runs hid are given back to their styles, once (see NameLevels)
        showNamesOnce(payload);
        // A map saved before the Local detail level keeps what Everything showed (see LocalLevel)
        addLocalLevelOnce(payload);
        // Water route styles still on their old defaults take the new look (see WaterRouteStyles)
        refreshWaterRoutesOnce(payload);
        this.modelRun = modelRun ?? null;
        // Regions and routes come from the display mesh, whose session opens once the terrain
        // exists (see the end of this method)
        MeshIntegration.beginLoad(this, payload, rawOwners);
        this.activeLayerSetId = null;
        this.activeLevelId = null;
        this.activeRegionId = null;

        this.uiState.mapSeed = payload.seed;
        this.currentParentId = payload.parentId || null;

        this.uiState.generationEngine = payload.generationEngine || "standard";

        // The terrain rules this map was built with, so it regenerates exactly as it was saved.
        // A map saved before the revision number existed has none, and reads as the legacy
        // revision (see TerrainVersion). Only regional maps carry a world description.
        this.uiState.terrainVersion = TerrainVersion.getVersion(payload);
        this.uiState.world = payload.world ?? null;
        this.uiState.generatorStale = payload.generatorStale === true;
        // The generator rules the map follows; a map saved before they were recorded reads as the
        // oldest (see GeneratorRevision)
        this.uiState.generatorRevision = GeneratorRevision.of(payload);
        this.uiState.generatorSettings = panelSettings(payload.generatorSettings);
        this.uiState.cultures = Array.isArray(payload.cultures) ? payload.cultures : [];
        this.upwindMargin = payload.upwindMargin ?? null;
        this.parentRun = payload.parentRun ?? null;
        this.infillPending = payload.infillPending === true;
        this.infillInputs = payload.infillInputs ?? null;
        this.riverRoutesLaid = payload.riverRoutes === true;
        this.shoresPlaced = payload.shoresPlaced === true;
        this.uiState.terrainUpgradeDismissed = payload.terrainUpgradeDismissed === true;
        this.terrainUpgrade = null;

        this.mapWidth = payload.mapWidth;
        this.mapHeight = payload.mapHeight;

        this.uiState.mapWidth = this.mapWidth;
        this.uiState.mapHeight = this.mapHeight;
        // New faults on this map start at its own default thickness (see FaultThickness)
        this.uiState.faultThickness = FaultThickness.limits(this.mapWidth).default;
        this.uiState.gridType = payload.gridType || "square";
        // Raised to the smallest grid Foundry allows: a map saved with a smaller grid (the slider
        // used to go down to 10) would otherwise export a scene whose grid Foundry enlarges, while
        // its grid data describes the smaller cells
        this.uiState.gridSize = MapStateManager.gridSizeOf(payload.gridSize || 100);
        this.uiState.gridVisible = payload.gridVisible ?? false;
        this.uiState.detailLevel = DetailLevel.valid(payload.detailLevel);
        this.uiState.avoidLabelOverlaps = payload.avoidLabelOverlaps !== false;
        this.uiState.symbolSize = SymbolScale.valid(payload.symbolSize);
        this.uiState.hiddenLabelStyles = Array.isArray(payload.hiddenLabelStyles) ? [...payload.hiddenLabelStyles] : [];
        this.uiState.hiddenLevels = Array.isArray(payload.hiddenLevels) ? [...payload.hiddenLevels] : [];
        this.uiState.hideRegionFills = payload.hideRegionFills === true;
        this.uiState.thematic = ThematicView.valid(payload.thematic);
        this.canvasEngine?.setLabelOverlapAvoidance(this.uiState.avoidLabelOverlaps);

        MapStateManager.allocateBuffers(this);
        // Every terrain layer is on when a map opens (see #terrainLayers)
        this.#setTerrainLayers(MapStudio.#allTerrainLayers(true));

        this.brushEngine = this.#createBrushEngine();

        const p = payload.params;
        const c = p.cartography || {};

        this.uiState.seaLevel = p.seaLevel;
        this.uiState.tectonicPlates = p.tectonicPlates ?? FILRODENSWMB.GENERATION.TECTONIC_PLATES;
        this.uiState.coastlineFracture = p.coastlineFracture ?? FILRODENSWMB.GENERATION.COASTLINE_FRACTURE;
        this.uiState.continentalGrouping = p.continentalGrouping ?? FILRODENSWMB.GENERATION.CONTINENTAL_GROUPING;
        this.uiState.shelfRange = p.shelfRange ?? FILRODENSWMB.GENERATION.SHELF_RANGE;
        this.uiState.coastalPlain = p.coastalPlain ?? FILRODENSWMB.GENERATION.COASTAL_PLAIN;
        this.uiState.flatTexture = p.flatTexture === true;
        this.uiState.continentScale = p.continentScale ?? FILRODENSWMB.GENERATION.CONTINENT_SCALE;
        // Maps saved before Ocean Scale existed used Continent Scale for the sea too, so an
        // updated map starts with the same value on both sides.
        this.uiState.oceanScale = p.oceanScale ?? this.uiState.continentScale;
        this.uiState.oceanRidges = p.oceanRidges ?? FILRODENSWMB.GENERATION.OCEAN_RIDGES;
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

        // Read after the wind distance, which is what identifies a legacy regional map
        this.legacyRootSize = TerrainVersion.isLegacyRegional(this.uiState) ? await TerrainUpgrade.resolveLegacyRootSize(payload) : null;

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
        // A map saved before pin styles existed gets the default set; a map that has the key keeps its own, even emptied
        this.uiState.customPinStyles = Array.isArray(payload.customPinStyles) ? payload.customPinStyles : null;
        PinStyles.ensure(this);

        this.uiState.maxLakeSize = p.hydrology?.maxLakeSize ?? FILRODENSWMB.HYDROLOGY.MAX_LAKE_SIZE;
        this.uiState.springAltOffset = p.hydrology?.springAltOffset ?? FILRODENSWMB.HYDROLOGY.SPRING_ALTITUDE_OFFSET;
        this.uiState.springMoistMin = p.hydrology?.springMoistMin ?? FILRODENSWMB.HYDROLOGY.SPRING_MOISTURE_MIN;
        this.uiState.meanderJitter = p.hydrology?.meanderJitter ?? FILRODENSWMB.HYDROLOGY.MEANDER_JITTER;
        this.uiState.riverMeander = p.hydrology?.riverMeander ?? MapStateManager.riverMeanderFromJitter(this.uiState.meanderJitter);
        this.uiState.riverWidthScale = p.hydrology?.riverWidthScale ?? FILRODENSWMB.HYDROLOGY.CHANNELS.WIDTH;
        this.uiState.altCooling = p.climate?.altCooling ?? FILRODENSWMB.CLIMATE.ALTITUDE_COOLING;
        this.uiState.freezingThreshold = p.climate?.freezingThreshold ?? FILRODENSWMB.CLIMATE.FREEZING_THRESHOLD;
        this.uiState.contourInterval = p.display?.contourInterval ?? 0.1;
        this.uiState.reliefShading = p.display?.reliefShading ?? FILRODENSWMB.DISPLAY.RELIEF_SHADING;
        // Maps saved before Relief Emphasis take its default
        this.uiState.reliefEmphasis = p.display?.reliefEmphasis ?? FILRODENSWMB.DISPLAY.THREE_D.RELIEF.EMPHASIS;
        // Its slider is in the map region, drawn once, and a save reads the value back from it
        this.#syncReliefEmphasisSlider();
        this.uiState.seabedRelief = p.display?.seabedRelief ?? FILRODENSWMB.DISPLAY.WATER.SEABED_RELIEF;
        this.uiState.waterClarity = p.display?.waterClarity ?? FILRODENSWMB.DISPLAY.WATER.CLARITY;
        this.uiState.waterHue = p.display?.waterHue ?? FILRODENSWMB.DISPLAY.WATER.HUE;
        this.uiState.waterSaturation = p.display?.waterSaturation ?? FILRODENSWMB.DISPLAY.WATER.SATURATION;
        this.uiState.biomeAlphaActive = p.display?.biomeAlphaActive ?? FILRODENSWMB.DISPLAY.BIOME_ALPHA_ACTIVE;
        this.uiState.biomeAlphaInactive = p.display?.biomeAlphaInactive ?? FILRODENSWMB.DISPLAY.BIOME_ALPHA_INACTIVE;
        this.uiState.regionOpacity = p.display?.regionOpacity ?? FILRODENSWMB.DISPLAY.REGION_OPACITY;
        this.uiState.cartographyScaleEnable = c.scaleEnable ?? this.defaultUiState.cartographyScaleEnable;
        // A map saved before it had a unit takes it from its scale bar's text, and keeps its
        // hand-set bar (see MapUnit.unitFromSaved)
        this.uiState.mapUnit = unitFromSaved(payload).unit;
        this.uiState.cartographyScaleMatchWorld = c.scaleMatchWorld === true;
        this.uiState.cartographyScaleInterval = c.scaleInterval ?? this.defaultUiState.cartographyScaleInterval;
        this.uiState.cartographyScaleValue = c.scaleValue ?? this.defaultUiState.cartographyScaleValue;
        this.uiState.cartographyScaleMajorTicks = c.scaleMajorTicks ?? this.defaultUiState.cartographyScaleMajorTicks;
        this.uiState.cartographyScaleMinorTicks = c.scaleMinorTicks ?? this.defaultUiState.cartographyScaleMinorTicks;
        this.uiState.cartographyScaleX = c.scaleX ?? this.defaultUiState.cartographyScaleX;
        this.uiState.cartographyScaleY = c.scaleY ?? this.defaultUiState.cartographyScaleY;
        // A bar left off the map (by a regional map cut before bars were brought onto it) comes back
        this.#keepScaleBarOnMap();
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
        this.tectonicFeatureCache = {};

        this.manualRivers = payload.manualRivers || [];
        if (payload.manualRivers) {
            payload.manualRivers.forEach((river) => {
                if (river.hidden !== undefined) {
                    river.visibility = river.hidden ? "none" : "all";
                    delete river.hidden;
                }
            });
        }
        // A map that a later revision would not change moves to it now (a revision 2 map with no
        // hotspot chain or custom river to revision 3, a revision 3 top map to revision 4; see
        // TerrainVersion.settledVersion), so anything added from here on is built by the current
        // rules. It looks exactly as it did, so the map is not marked as changed: the move is kept
        // with its next save, and until then it is made again on every load.
        const settled = TerrainVersion.settledVersion(this.uiState, this.tectonicFaults, this.manualRivers);
        if (settled !== null) this.uiState.terrainVersion = settled;

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
            platform.notify.warn(platform.i18n.format("FILRODENSWMB.UI.UnresolvedPinIconsWarning", { count: affectedPinCount }));
        }

        this.mapRoutes = payload.mapRoutes || [];
        this.landMasks = payload.landMasks || [];
        this.mapLabels = payload.mapLabels || [];
        this.mapDecorations = payload.mapDecorations || [];
        // The last Name natural features report was the map before's
        FeatureNames.forget(this);

        // Label widths saved in pixels (before widths were measured in characters) become
        // characters, rounded up so no label wraps earlier than before (see LabelWidth). The map
        // is not marked as changed: until it is saved, the same conversion runs on every load.
        LabelWidth.migrateMap(
            // A map saved before layer sets existed still has its region layers here; they become
            // levels when the map's mesh session opens, keeping the labels converted now
            { mapLabels: this.mapLabels, mapPins: this.mapPins, mapRoutes: this.mapRoutes, regionLayers: payload.regionLayers ?? this.regionLevels, customLabelStyles: this.uiState.customLabelStyles },
            LabelWidth.rootFontSize(),
        );
        this.#reportMissingFonts(payload.regionLayers ?? this.regionLevels);

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

        // The map's own reference image, or none for a map saved without one (or before maps
        // kept it), so the previous map's image is not left behind on this one
        this.#applyReferenceData(payload.reference);

        this.defaultUiState = platform.utils.deepClone(this.uiState);

        this.view?.render(["toolbar", "context"]);
        this.#showUnmade();
        if (!generate) return;
        await this.generateTerrain();
        await MeshIntegration.finishLoad(this, this.#processingOverlay(), { report });
        this.#updateGrid();
        this.#updateReferenceLayer({ changed: false });
        this.canvasEngine.resetCamera();
    }

    /** The reference image as a save writes it (see _buildSavePayload), or null when there is none. */
    #referenceData() {
        const { referenceImage, referenceAlpha, referenceScale, referenceX, referenceY } = this.uiState;
        return referenceImage ? { src: referenceImage, alpha: referenceAlpha, scale: referenceScale, x: referenceX, y: referenceY } : null;
    }

    /**
     * Sets the reference image from a loaded map's saved one, or clears it (centred, full size,
     * half opacity) when the map has none.
     * @param {{src: string, alpha?: number, scale?: number, x?: number, y?: number}|null|undefined} reference
     */
    #applyReferenceData(reference) {
        const defaults = MapStateManager.buildDefaultUiState(this.mapWidth, this.mapHeight);
        const src = reference?.src ? Sanitize.imageSource(reference.src, { remote: true }) : null;
        this.uiState.referenceImage = src ?? "";
        this.uiState.referenceAlpha = Number.isFinite(reference?.alpha) && src ? reference.alpha : defaults.referenceAlpha;
        this.uiState.referenceScale = Number.isFinite(reference?.scale) && src ? reference.scale : defaults.referenceScale;
        this.uiState.referenceX = Number.isFinite(reference?.x) && src ? reference.x : defaults.referenceX;
        this.uiState.referenceY = Number.isFinite(reference?.y) && src ? reference.y : defaults.referenceY;
    }

    /** Stops the cancellable work under way (see runCancellable); null when there is none. */
    #cancelRunning = null;

    /** Ends the work under way keeping what it has finished (the overlay's keep button; see runCancellable). */
    #keepRunning = null;

    /**
     * Runs long work under the processing overlay with a Cancel button. The work is handed an
     * AbortSignal, which Cancel aborts; work that checks it between chunks can stop part-way and
     * resolve with whatever it uses to mean "cancelled" (null for RegionEdits.autoAssign). One
     * cancellable piece of work runs at a time: a second one is refused (resolving null) rather
     * than sharing a Cancel button that would stop both.
     *
     * @param {string} message - The overlay's text, already localised.
     * @param {(signal: AbortSignal, overlay: {text: function(string): void, detail: function(?string): void, progress: function(?number): void, keep: function(?string, function(): void=): void}) => Promise<*>} work - Also
     *     handed the overlay, whose text it may change as it goes (to show its progress), with a
     *     line under it (detail; null hides it), a bar (progress, 0 to 1; null hides it) and a
     *     button beside Cancel for ending the work keeping what it has finished (keep: its label
     *     and what it does; a null label hides it).
     * @returns {Promise<*>} What the work resolves with, or null when it could not start.
     */
    async runCancellable(message, work) {
        if (this.#cancelRunning) return null;
        const controller = new AbortController();
        this.#cancelRunning = controller;
        this.#showCancelButton(true);
        await this.#startProcessing(message);
        try {
            const overlay = this.#processingOverlay();
            return await work(controller.signal, { text: overlay.text, detail: overlay.detail, progress: overlay.progress, keep: (label, action) => this.#setKeepButton(label, action) });
        } finally {
            const overlay = this.#processingOverlay();
            overlay.detail(null);
            overlay.progress(null);
            this.#setKeepButton(null);
            this.#cancelRunning = null;
            this.#showCancelButton(false);
            this.#endProcessing();
        }
    }

    /** The overlay's keep button: its label and what it does, or hidden (a null label). */
    #setKeepButton(label, action = null) {
        const button = this.root?.querySelector('[data-action="keepProcessing"]');
        this.#keepRunning = label ? action : null;
        if (!button) return;
        button.textContent = label ?? "";
        button.classList.toggle("fwmb-hidden", !label);
    }

    #showCancelButton(visible) {
        this.root?.querySelector(".fwmb-processing-cancel")?.classList.toggle("fwmb-hidden", !visible);
    }

    /**
     * The overlay's line kept while a run of several pieces of work goes on (Draw thumbnails' "world
     * 3 of 12"), so each piece's own messages do not replace it; null when none is kept.
     */
    #heldProcessingText = null;

    /** Keeps the overlay's line (see #heldProcessingText), or lets it go (null). */
    #holdProcessingText(text) {
        this.#heldProcessingText = null;
        if (text === null) return;
        this.#processingOverlay().text(text);
        this.#heldProcessingText = text;
    }

    /** The processing overlay, for work done outside this class (see MeshIntegration.finishLoad). */
    #processingOverlay() {
        return {
            start: (message) => this.#startProcessing(message),
            end: () => this.#endProcessing(),
            text: (message) => {
                const textEl = this.root?.querySelector(".fwmb-processing-text");
                if (textEl && this.#heldProcessingText === null) textEl.textContent = message;
            },
            detail: (message) => {
                const detailEl = this.root?.querySelector(".fwmb-processing-detail");
                if (!detailEl) return;
                detailEl.textContent = message ?? "";
                detailEl.classList.toggle("fwmb-hidden", !message);
            },
            progress: (fraction) => {
                const bar = this.root?.querySelector(".fwmb-processing .fwmb-progress");
                if (!bar) return;
                const shown = Number.isFinite(fraction);
                bar.classList.toggle("fwmb-hidden", !shown);
                if (!shown) return;
                const percent = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
                bar.style.setProperty("--done", `${percent}%`);
                bar.setAttribute("aria-valuenow", String(percent));
            },
        };
    }

    /**
     * A click with the Infrastructure tool's Pin mode places a pin. Routes are made by the route
     * modes, which take their clicks before this is reached.
     */
    #handleInfrastructureClick(x, y) {
        // Pins are single-point markers and stay confined to the map itself
        if (this.uiState.activeInfraMode !== "pin" || x < 0 || x > this.mapWidth || y < 0 || y > this.mapHeight) return;

        MapStateManager.pushVectorState(this);
        // A pin made with a style is named after the style (a "Town", say) and takes its look from
        // it; with no style it is the default pin in the bar's icon, changed in the inspector
        const style = PinStyles.active(this);
        const { DEFAULT_ICON, DEFAULT_SCALE, DEFAULT_COLOR } = FILRODENSWMB.PINS;
        const icon = this.uiState.activeIcon || DEFAULT_ICON;
        const pin = {
            id: platform.utils.randomID(),
            name: style?.name ?? getPinIconLabel(icon),
            nameSource: "default",
            icon,
            x,
            y,
            scale: DEFAULT_SCALE,
            visibility: "all",
            color: DEFAULT_COLOR,
            pinStyle: null,
            label: { fontSize: DEFAULT_SCALE },
        };
        if (style) PinStyles.apply(this, pin, style);
        this.mapPins.push(pin);

        this._repaintVectors();
        this.view?.render(["context"]);
        this.markDirty();
        PinEditor.open(this, pin.id, { created: true });
    }

    #handleLabelClick(x, y) {
        if (x < 0 || x > this.mapWidth || y < 0 || y > this.mapHeight) return;

        MapStateManager.pushVectorState(this);
        // A new label takes the bar's style (with no style, the map's label defaults) and is
        // given its text in the inspector
        const style = (this.uiState.customLabelStyles ?? []).find((candidate) => candidate.id === this.uiState.activeLabelQuickStyle) ?? null;
        const look = (field, key) => style?.[field] ?? this.uiState[key];
        const id = platform.utils.randomID();
        this.mapLabels.push({
            id,
            name: platform.i18n.localize(FILRODENSWMB.LABELS.DEFAULT_TEXT),
            x: x,
            y: y,
            rotation: 0,
            quickStyle: style?.id ?? "custom",
            fontFamily: look("fontFamily", "labelFontFamily"),
            fontSize: look("fontSize", "labelFontSize"),
            fillColor: look("fillColor", "labelFillColor"),
            maxChars: look("maxChars", "labelMaxChars"),
            justify: look("justify", "labelJustify"),
            bold: look("bold", "labelBold") !== false,
            italic: look("italic", "labelItalic") === true,
            visibility: "all",
        });

        this._repaintVectors();
        this.view?.render(["context"]);
        this.markDirty();
        // Its text is given in the inspector, which opens on it with focus left on the map
        LabelEditor.open(this, { type: "custom", id }, { created: true });
    }

    /**
     * Draws the reference image as uiState describes it. It is saved with the map, so a change to
     * it is a change to the map; a map opening with its own image (`changed: false`) is not.
     * @param {{changed?: boolean}} [options]
     */
    #updateReferenceLayer({ changed = true } = {}) {
        if (this.canvasEngine) {
            this.canvasEngine.updateReferenceImage(this.uiState.referenceImage, this.uiState.referenceX, this.uiState.referenceY, this.uiState.referenceScale, this.uiState.referenceAlpha);
        }
        if (changed) this.markDirty();
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

        const activeWindow = this.root.ownerDocument.defaultView || window;
        await new Promise((resolve) => activeWindow.setTimeout(resolve, 250));

        return true;
    }

    /**
     * Saves the map to the compendium.
     *
     * A plain save overwrites the saved map that is open, or asks for a name and creates a new
     * saved map when the open map has never been saved. "Save as" always asks for a name and
     * creates a new saved map, which then becomes the one that is open: the map it was loaded
     * from is left exactly as it was last saved, and later plain saves go to the new copy.
     *
     * Only one save runs at a time; asking again while one is under way does nothing and reports
     * no save. The save under way is kept so that closing the studio can wait for it.
     *
     * @param {object} [options]
     * @param {boolean} [options.asNew=false] - Save as a new saved map ("Save as").
     * @param {string|null} [options.promptTitle=null] - Title for the name prompt, when there is
     *   one, in place of "Save As..." (so a save asked for as one step of something else says so).
     * @returns {Promise<boolean>} True if the map was saved.
     */
    async saveCurrentMap({ asNew = false, promptTitle = null } = {}) {
        if (this.#activeSave) return false;

        this.#activeSave = this.#performSave(asNew, promptTitle);
        try {
            return await this.#activeSave;
        } finally {
            this.#activeSave = null;
        }
    }

    /**
     * The name offered when a map is saved under a new name: the open map's name marked as a
     * copy (so accepting it cannot be confused with the original in the saved maps list), or a
     * name made from the seed for a map that has never been saved.
     */
    #defaultSaveName() {
        if (this.currentSaveName) return platform.i18n.format("FILRODENSWMB.UI.SaveAsCopyName", { name: this.currentSaveName });

        const { currentSeed } = MapStateManager.getMapParameters(this);
        const hash = currentSeed || this.#generateRandomSeed();
        return `Terrain Map (${hash})`;
    }

    /**
     * The map as a save writes it: its data (the generation settings, every vector list, the
     * styles and the display mesh's block and layer sets), its encoded owner arrays by level id, and
     * the generator's saved outputs (null when the map has no run). Reads the panel's fields first,
     * as every save does (see MapStateManager.getMapParameters). Shared by saving and by the check
     * that a saved map passes the importer unchanged.
     * @returns {{payload: object, owners: Object<string, string>, modelRun: object|null}}
     */
    _buildSavePayload() {
        const { currentSeed, params } = MapStateManager.getMapParameters(this);
        const payload = {
            seed: currentSeed,
            generationEngine: this.uiState.generationEngine,
            terrainVersion: this.uiState.terrainVersion,
            sizeRevision: FILRODENSWMB.SYMBOLS.REVISION,
            nameLevels: true,
            localLevel: true,
            waterRoutes: true,
            world: this.uiState.world,
            mapUnit: cleanUnit(this.uiState.mapUnit),
            generatorStale: this.uiState.generatorStale === true,
            generatorRevision: GeneratorRevision.of(this.uiState),
            generatorSettings: panelSettings(this.uiState.generatorSettings),
            cultures: platform.utils.deepClone(this.uiState.cultures ?? []),
            upwindMargin: this.upwindMargin ?? null,
            parentRun: this.parentRun ?? null,
            infillPending: this.infillPending === true,
            infillInputs: this.infillInputs ?? null,
            riverRoutes: this.riverRoutesLaid === true,
            shoresPlaced: this.shoresPlaced === true,
            terrainUpgradeDismissed: this.uiState.terrainUpgradeDismissed === true,
            springsBaked: this.uiState.springsBaked,
            mapWidth: this.mapWidth,
            mapHeight: this.mapHeight,
            gridType: this.uiState.gridType,
            gridSize: this.uiState.gridSize,
            gridVisible: this.uiState.gridVisible,
            detailLevel: DetailLevel.current(this),
            avoidLabelOverlaps: this.uiState.avoidLabelOverlaps !== false,
            symbolSize: SymbolScale.valid(this.uiState.symbolSize),
            hiddenLabelStyles: [...(this.uiState.hiddenLabelStyles ?? [])],
            hiddenLevels: [...(this.uiState.hiddenLevels ?? [])],
            hideRegionFills: this.uiState.hideRegionFills === true,
            thematic: ThematicView.setting(this),
            params: params,
            customBiomes: this.uiState.customBiomes,
            nextCustomBiomeId: this.uiState.nextCustomBiomeId,
            customRouteStyles: this.uiState.customRouteStyles,
            customLabelStyles: this.uiState.customLabelStyles,
            customRegionStyles: this.uiState.customRegionStyles,
            customPinStyles: this.uiState.customPinStyles,
            history: this.brushEngine?.history || [],
            tectonicFaults: this.tectonicFaults,
            manualRivers: this.manualRivers,
            mapPins: this.mapPins,
            mapRoutes: this.mapRoutes,
            landMasks: this.landMasks,
            mapLabels: this.mapLabels,
            mapDecorations: this.mapDecorations,
            // The reference image with its place, size and opacity, so it is there again when the
            // map is opened; null when the map has none
            reference: this.#referenceData(),
            parentId: this.currentParentId,
        };

        // The display mesh's block, layer sets and owner arrays (see MeshIntegration)
        const owners = MeshIntegration.preparePayload(this, payload);
        return { payload, owners, modelRun: this.modelRun ?? null };
    }

    /**
     * Saves the map (see saveCurrentMap).
     *
     * @param {boolean} asNew - Create a new saved map rather than overwrite the open one.
     * @param {string|null} [promptTitle] - Title for the name prompt, or null for "Save As...".
     */
    async #performSave(asNew, promptTitle = null) {
        if (!this.worldOpen || this.#creatingWorld) return false;
        let mapName = this.currentSaveName;
        const createsNewMap = asNew || !this.currentSaveId;

        // 1. Ask for the name BEFORE locking the UI. This sits outside the try block below: its
        // finally releases the processing overlay, and a cancelled prompt has not claimed it, so
        // releasing it here would hide the overlay of a refresh that is still running. A world
        // saved already keeps its name when its Surface map is first saved with it.
        if (asNew || (createsNewMap && !this.world)) {
            mapName = (await MapDialogManager._promptTextValue(promptTitle ?? platform.i18n.localize("FILRODENSWMB.UI.SaveAs"), platform.i18n.localize("FILRODENSWMB.UI.Name"), this.#defaultSaveName()))?.trim();

            if (!mapName) return false; // User cancelled the save prompt (or left the name blank)
        }

        try {
            // 2. Lock the UI and show the spinner
            await this.#startProcessing(platform.i18n.localize("FILRODENSWMB.UI.SavingMap"));
            this.currentSaveName = mapName;

            const saved = await this.#saveWorld(createsNewMap, asNew);

            if (saved) {
                this.currentSaveId = saved.mapId;
                this.isDirty = false; // Successfully saved, map is no longer dirty
                platform.notify.info(platform.i18n.format("FILRODENSWMB.UI.SaveSuccess", { name: saved.name }));
                // A new saved map also belongs in the saved maps list, if it is showing
                this.view?.render(createsNewMap && this.activeTool === "manage" ? ["toolbar", "context"] : ["toolbar"]);
                return true;
            } else {
                platform.notify.error(platform.i18n.localize("FILRODENSWMB.UI.SaveError"));
                return false;
            }
        } finally {
            this.#endProcessing();
        }
    }

    /**
     * Writes the open world (see Worlds.save): the map's own data, and its world's settings split
     * from it (see WorldSettings) with the world's pin icons. Save world in v5's words: the map's
     * revision rises when it has changed, the settings' when they have. A held regional world
     * writes only its own World setup; until its world editors are read only (S0 step 5), any
     * other setting changed on it is not kept.
     *
     * @param {boolean} createsNewMap - Whether the map is saved as a new one.
     * @param {boolean} asNew - Whether this is Save as (a copy of the open world).
     * @returns {Promise<{mapId: string, name: string}|null>}
     */
    /**
     * What Worlds shows of the map being saved (WorldRecord.mapCard): a thumbnail drawn afresh when
     * the map changed or has none yet, whether it has a run, whether an older generator made it.
     */
    #mapCard(payload, modelRun, changed) {
        const kept = this.world?.maps?.find((map) => map.type === MAP_TYPES.SURFACE)?.thumbnail ?? null;
        const thumbnail = changed || !kept ? (this.canvasEngine?.thumbnail?.() ?? kept) : kept;
        return { ...(thumbnail ? { thumbnail } : {}), run: !!(modelRun || payload?.parentRun), older: GeneratorRevision.isOlder(payload) };
    }

    async #saveWorld(createsNewMap, asNew) {
        // A map saved before v5 that was opened before it had a world (one imported while the
        // studio was open, say) is given one first, so its save does not make a second map
        if (!this.world && this.currentSaveId && !createsNewMap) {
            await WorldMigration.run();
            this.world = await Worlds.ofMap(this.currentSaveId);
        }
        const { payload, owners, modelRun } = this._buildSavePayload();
        const { settings, mapData } = WorldSettings.split(payload);
        settings.icons = structuredClone(currentPinIcons() ?? WorldRecord.emptyIcons());
        const opened = this.worldSettingsOpened;
        // A held regional map's count of inherited strokes, if a rewrite of its history changed it
        const entry = !createsNewMap && this.world?.held && RegionalRecord.isCurrent(this.world.regional) ? RegionalRecord.forMap(this.world.regional, this.currentSaveId) : null;
        const regional = entry && this.inheritedStrokes !== undefined && entry.inheritedStrokes !== this.inheritedStrokes ? RegionalRecord.withMap(this.world.regional, this.currentSaveId, { inheritedStrokes: this.inheritedStrokes }) : undefined;
        // The settlement maps kept, changed or deleted since the last save (L-surface)
        const settlementsOpen = SettlementMaps.existing(this);
        const settlements = settlementsOpen ? await settlementsOpen.changes(this.shell?.registry?.get("local")?.page) : {};
        const result = await Worlds.save({
            world: this.world,
            name: this.currentSaveName,
            settings,
            // A world with no maps saves its settings alone (board N3)
            maps: this.surfaceMade ? [{ id: createsNewMap ? null : this.currentSaveId, type: MAP_TYPES.SURFACE, data: mapData, owners, modelRun, summary: payload, changed: this.#dirty || createsNewMap, card: this.#mapCard(payload, modelRun, this.#dirty || createsNewMap) }] : [],
            settlements,
            asNew: asNew && !!this.world,
            // A held world writes only its own World setup, so only that can change its revision
            settingsChanged: opened ? WorldRecord.changedGroups(this.world?.held ? { setup: opened.setup } : opened, this.world?.held ? { setup: settings.setup } : settings).length > 0 : undefined,
            regional,
        });
        if (!result) return null;
        // The regional worlds it holds learn whether it changed inside their crops (rule 1)
        const mapId = result.maps[0]?.id ?? null;
        if (mapId && (this.#dirty || createsNewMap) && !asNew && (await this.#updateChildFingerprints(result.world, mapId))) await platform.store.saveWorld(result.world);
        // The same world (Save as gives it a new id, its settlement maps with it): the settlement
        // map open stays open, under its saved id
        this.#world = result.world;
        settlementsOpen?.saved(result.settlements ?? []);
        await this.#refreshStale();
        this.worldSettingsOpened = settings;
        this.#captureEditorBaseline();
        this.view?.render(["worldbar"]);
        return { mapId: result.maps[0]?.id ?? null, name: this.currentSaveName };
    }

    /**
     * Spawns the processing overlay and forces the browser to paint the DOM
     * before executing the next synchronous JavaScript operation.
     */
    async #startProcessing(message) {
        this.processingTasks = (this.processingTasks || 0) + 1;

        // A task already under way (a save, say) can reach here after the studio has closed,
        // when there is no overlay left to show
        const overlay = this.root?.querySelector(".fwmb-processing-overlay");
        if (overlay) {
            const textEl = overlay.querySelector(".fwmb-processing-text");
            if (textEl && this.#heldProcessingText === null) textEl.textContent = message;
            overlay.classList.remove("fwmb-hidden");
        }

        // Give the browser the chance to paint the overlay before the main thread is locked: the
        // frame after next is when it has been painted. The wait is capped (see
        // OVERLAY_PAINT_WAIT_MAX_MS), since without frames it would never end.
        const activeWindow = this.root?.ownerDocument.defaultView || window;
        await new Promise((resolve) => {
            let settled = false;
            const finish = (painted) => {
                if (settled) return;
                settled = true;
                if (!painted) console.warn(`FWMB | The window did not repaint within ${OVERLAY_PAINT_WAIT_MAX_MS}ms, so "${message}" is going ahead without waiting for it.`);
                resolve();
            };
            activeWindow.requestAnimationFrame(() => activeWindow.setTimeout(() => finish(true), 0));
            activeWindow.setTimeout(() => finish(false), OVERLAY_PAINT_WAIT_MAX_MS);
        });
    }

    /**
     * Decrements the active task counter, hiding the overlay only when all chained tasks are complete.
     */
    #endProcessing() {
        this.processingTasks = Math.max(0, (this.processingTasks || 0) - 1);
        if (this.processingTasks > 0) return;

        const overlay = this.root?.querySelector(".fwmb-processing-overlay");
        if (overlay) overlay.classList.add("fwmb-hidden");
        this.#showRunInputs();
    }

    /**
     * Brings what says a run is out of date up to date once a refresh has finished. The rivers are
     * traced again in the refresh, after the edit or undo that asked for it has already drawn the
     * Generate panel and the legends, and a run is out of date by its rivers (see RunInputs), so
     * without this an undo that restores them would leave Out of date showing until the panel is
     * next drawn.
     */
    #showRunInputs() {
        if (!this.modelRun) return;
        if (CultureMarkers.TOOLS.has(this.activeTool)) this.view?.render(["context"]);
        ThematicView.renderLegend(this);
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
        // Every change routed here is to the drawn features (faults, custom rivers, land masks, river
        // sources). A run that keeps their fingerprint shows out of date by it, so undoing the change
        // clears it again; an older run needs the lasting flag
        this.#markGeneratorStale({ lasting: !RunInputs.tracksFeatures(this) });
        this.pendingTerrainBounds = SpatialMath.mergeBounds(this.pendingTerrainBounds, bounds);
        if (this.uiState.liveFeatureUpdates) {
            generate();
        } else {
            this.hasPendingFeatureMath = true;
            this.view?.render(["editToolbar"]);
        }
    }

    /**
     * The panel settings that change what the generator reads (the land, the climate and the
     * rivers), so a run made before them is out of date.
     */
    static #GENERATOR_INPUTS = 'input[name="seaLevel"], input[name="tectonicPlates"], input[name="coastlineFracture"], input[name="continentalGrouping"], input[name="shelfRange"], input[name="coastalPlain"], input[name="continentScale"], input[name="oceanScale"], input[name="oceanRidges"], input[name^="noise."], input[name="globalTemp"], input[name="globalMoisture"], input[name="latTop"], input[name="latBottom"], input[name="seasonOffset"], input[name="altCooling"], input[name="freezingThreshold"], input[name="riverDensity"], input[name="springAltOffset"], input[name="springMoistMin"], input[name="riverMeander"], input[name="riverWidthScale"]';

    /**
     * Marks the last generator run out of date (the Generate panel says so) once what it read has
     * changed. A map without a run has nothing to be out of date.
     * @param {{lasting?: boolean}} [options] - lasting: false when the run's fingerprint of the
     *     map's own items already shows the change (see RunInputs), so only Travel's input moves.
     */
    #markGeneratorStale({ lasting = true } = {}) {
        // The Travel tool's network is built from the same input (see TravelNetwork)
        this.travelInputs = (this.travelInputs ?? 0) + 1;
        if (!lasting) {
            if (CultureMarkers.TOOLS.has(this.activeTool)) this.view?.render(["context"]);
            return;
        }
        if (!this.modelRun || this.uiState.generatorStale) return;
        this.uiState.generatorStale = true;
        if (CultureMarkers.TOOLS.has(this.activeTool)) this.view?.render(["context"]);
    }

    /** The same, for what changes the generator's input outside the studio's own handlers (a custom biome's Behaves like, the cultures). */
    markGeneratorStale() {
        this.#markGeneratorStale();
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
        this.view?.render(["editToolbar"]);
    }

    /**
     * Outlines on the canvas the area the next Undo or Redo would change, labelled with what it
     * would undo or redo.
     */
    #previewActionBounds(direction) {
        if (!this.canvasEngine) return;
        // Undo while a route is being placed takes back its last waypoint, which the draft shows
        if (direction === "undo" && RouteTool.drafting(this)) return;

        const ledger = direction === "undo" ? this.globalHistoryLedger : this.globalRedoLedger;
        const actionType = ledger.at(-1);

        let preview = null;
        if (actionType === "raster") preview = this.#rasterActionPreview(direction);
        else if (actionType === "vector") preview = this.#vectorActionPreview(direction);
        if (!preview?.bounds) return;

        const prefixKey = direction === "undo" ? "FILRODENSWMB.UI.ActionUndo" : "FILRODENSWMB.UI.ActionRedo";
        const prefix = platform.i18n.localize(prefixKey);
        this.canvasEngine.showActionPreview(preview.bounds, `${prefix} ${preview.label}`);
    }

    /**
     * The area and label of the brush stroke the next Undo or Redo would step through.
     *
     * @returns {{bounds: object, label: string}|null} Null when there is no stroke to step through.
     */
    #rasterActionPreview(direction) {
        const stack = direction === "undo" ? this.brushEngine.history : this.brushEngine.redoStack;
        const targetStroke = stack.at(-1);
        if (!targetStroke?.points?.length) return null;

        // Map the raster layer to its localisation key
        const isBiome = targetStroke.layer === "biome";
        const locKey = isBiome ? "FILRODENSWMB.UI.ActionBiomeBrush" : "FILRODENSWMB.UI.ActionTerrainBrush";

        return {
            bounds: this.#calculatePointBounds(targetStroke.points, targetStroke.size || DEFAULT_STROKE_PREVIEW_SIZE),
            label: platform.i18n.localize(locKey),
        };
    }

    /**
     * The area and label of the vector edit the next Undo or Redo would restore, found by
     * comparing the map's current vector state with the snapshot it would restore.
     *
     * @returns {{bounds: object|null, label: string}|null} Null when there is no snapshot to restore or nothing differs.
     */
    #vectorActionPreview(direction) {
        const stack = direction === "undo" ? this.pinHistory : this.pinRedoStack;
        const entry = stack.at(-1);
        if (!entry) return null;

        // Painted cells: their bounds, labelled as a region edit
        const painted = VectorHistory.patchBounds(this, entry);
        if (painted) return { bounds: this.#calculatePointBounds([{ x: painted.minX, y: painted.minY }, { x: painted.maxX, y: painted.maxY }], VECTOR_PREVIEW_PADDING), label: this.#getActionLabel(VectorHistory.touchesInfluences(entry) ? "influences" : "layerSets") };

        const targetSnapshot = VectorHistory.snapshotOf(entry);
        if (!targetSnapshot) return null;
        return this.#diffVectorSnapshots(MapStateManager.getVectorStateSnapshot(this), targetSnapshot);
    }

    /**
     * Compares two global state snapshots to find the specific entity that changed.
     *
     * @returns {{bounds: object|null, label: string}|null} The changed entity's padded bounds and its label, or null when nothing differs.
     */
    #diffVectorSnapshots(current, target) {
        const change = MapStudio.#firstChangedEntity(current, target);
        if (!change) return null;

        // Regions and routes on the display mesh have no points: their cells' bounds stand in
        const points = MapStudio.#entityPoints(change.entity);
        return {
            bounds: this.#calculatePointBounds(points.length ? points : MeshIntegration.outlinePoints(this, change.entity), VECTOR_PREVIEW_PADDING),
            label: this.#getActionLabel(change.key, change.entity),
        };
    }

    /**
     * Finds the first entity that differs between two vector state snapshots. The snapshots'
     * lists (pins, rivers, region layers and so on) are compared in order, and the first list
     * holding a difference decides the result.
     *
     * @returns {{key: string, entity: object}|null} The list the change is in and the changed entity, or null when nothing differs.
     */
    static #firstChangedEntity(current, target) {
        for (const key of Object.keys(current)) {
            if (!Array.isArray(current[key]) || !Array.isArray(target[key])) continue;

            const change = MapStudio.#firstChangedItem(current[key], target[key]);
            if (change) return { key, entity: MapStudio.#narrowToRegion(change) };
        }
        return null;
    }

    /**
     * Finds the first item that differs between two versions of a list. Items are matched by id
     * (or, lacking one, by position). An item in `target` that is missing from `current` or
     * differs from it is found first, and the current version is reported where both exist, since
     * that is what is on the canvas now. Failing that, an item in `current` that `target` no longer
     * has is reported.
     *
     * @returns {{item: object, currentItem: object|undefined, targetItem: object|undefined}|null}
     *   The item to report and both versions of it (either may be missing), or null when the lists match.
     */
    static #firstChangedItem(currentItems, targetItems) {
        const currentById = MapStudio.#itemsById(currentItems);
        const targetById = MapStudio.#itemsById(targetItems);

        for (const [id, targetItem] of targetById) {
            const currentItem = currentById.get(id);
            if (!currentItem || JSON.stringify(currentItem) !== JSON.stringify(targetItem)) {
                return { item: currentItem || targetItem, currentItem, targetItem };
            }
        }
        for (const [id, currentItem] of currentById) {
            if (!targetById.has(id)) return { item: currentItem, currentItem, targetItem: undefined };
        }
        return null;
    }

    /** Keys a list's items by id, or by position for an item without one. */
    static #itemsById(items) {
        return new Map(items.map((item, index) => [item.id || `idx_${index}`, item]));
    }

    /**
     * When the changed item is a layer set or a level that exists in the target snapshot, narrows
     * the change to the level and then the region inside it that differs, so the preview outlines
     * that region rather than the whole set. A set or level the target no longer has at all is left
     * whole: everything in it would go, so the whole of it is the area affected.
     */
    static #narrowToRegion({ item, currentItem, targetItem }) {
        if (!targetItem) return item;
        if (Array.isArray(item.levels)) {
            const level = MapStudio.#firstChangedItem(currentItem?.levels || [], targetItem.levels || []);
            return level ? MapStudio.#narrowToRegion(level) : item;
        }
        if (!Array.isArray(item.regions)) return item;

        return MapStudio.#firstChangedItem(currentItem?.regions || [], targetItem.regions || [])?.item ?? item;
    }

    /** The points that outline a vector entity: its own points, its regions' points, or the entity itself when it is a single point. */
    static #entityPoints(entity) {
        if (entity.points) return entity.points;
        if (entity.regions) return entity.regions.flatMap((region) => region.points || []);
        if (entity.x !== undefined && entity.y !== undefined) return [entity];
        return [];
    }

    /**
     * Resolves the localised UI label for a modified vector entity.
     */
    #getActionLabel(key, entity) {
        if (!key) return platform.i18n.localize("FILRODENSWMB.UI.ActionVectorEdit");

        if (key === "pins") {
            const isSpring = entity?.type === "spring" || entity?.type === "block_spring";
            const pinKey = isSpring ? "FILRODENSWMB.UI.ActionRiverSpring" : "FILRODENSWMB.UI.ActionInfrastructurePin";
            return platform.i18n.localize(pinKey);
        }

        const labelKeys = {
            tectonicFaults: "FILRODENSWMB.UI.ActionTectonicFault",
            manualRivers: "FILRODENSWMB.UI.ActionCustomRiver",
            routes: "FILRODENSWMB.UI.ActionRoute",
            layerSets: "FILRODENSWMB.UI.ActionRegion",
            influences: "FILRODENSWMB.UI.ActionInfluence",
            landMasks: "FILRODENSWMB.UI.ActionLandMask",
            mapLabels: "FILRODENSWMB.UI.ActionLabel",
            mapDecorations: "FILRODENSWMB.UI.ActionDecoration",
        };

        return platform.i18n.localize(labelKeys[key] ?? "FILRODENSWMB.UI.ActionVectorEdit");
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
     * (see FILRODENSWMB.LIMITS.MIN_POLYGON_VERTICES) contribute. Just each mask's operation,
     * vertices and coast settings (see MaskSettings.inputsOf) are captured: renaming a mask, or
     * undoing the first two nodes of a shape that is still being drawn, does not alter the
     * terrain and must not trigger a regeneration.
     *
     * @returns {string} A string that differs between two states exactly when their terrain differs.
     */
    #serialiseTerrainInputs() {
        const minVertices = FILRODENSWMB.LIMITS.MIN_POLYGON_VERTICES;
        const guidedMasks =
            this.uiState.generationEngine === "guided"
                ? this.landMasks.filter((mask) => mask.points?.length >= minVertices).map((mask) => [mask.operation, mask.points, ...MaskSettings.inputsOf(mask)])
                : [];

        return JSON.stringify([this.tectonicFaults, this.manualRivers, guidedMasks]);
    }

    /**
     * Steps one action back (undo) or forward (redo) through the global history. The ledger
     * records the order of vector and brush (raster) actions, each of which keeps its own stack of
     * states. An entry whose stack has nothing left to step through is dropped and the next one
     * tried, so a single Undo or Redo always changes something while anything is left.
     */
    async #processHistoryStep(isUndo) {
        // A route being placed is not in the history until it is finished: Undo takes its last
        // press back first, rather than the history's last step under it
        if (isUndo && RouteTool.undoDraftStep(this)) return;

        // Dynamically assign the source and target ledgers based on the direction
        const sourceLedger = isUndo ? this.globalHistoryLedger : this.globalRedoLedger;
        const targetLedger = isUndo ? this.globalRedoLedger : this.globalHistoryLedger;

        let action = sourceLedger?.pop();
        while (action) {
            const stepped = await this.#stepHistoryAction(action, isUndo, targetLedger);
            // Undo has reached a held regional world's inherited strokes: it stops there
            if (stepped === null) {
                sourceLedger.push(action);
                break;
            }
            if (stepped) break;
            action = sourceLedger?.pop();
        }

        this.view?.render(["context"]);
        this.markDirty();
    }

    /**
     * Steps one ledger entry, recording it on `targetLedger` when it changed something.
     *
     * @returns {Promise<boolean|null>} Whether anything was stepped through; null when Undo stops
     *     at a held regional world's inherited strokes (see #stepRasterHistory).
     */
    async #stepHistoryAction(action, isUndo, targetLedger) {
        if (action === "vector") return this.#stepVectorHistory(isUndo, targetLedger);
        if (action === "raster") return this.#stepRasterHistory(isUndo, targetLedger);
        return false;
    }

    /**
     * Steps one vector history entry back (undo) or forward (redo; see VectorHistory), then
     * refreshes whatever the change affects (see #refreshAfterVectorStep).
     *
     * @returns {boolean} Whether there was an entry to step through.
     */
    #stepVectorHistory(isUndo, targetLedger) {
        const before = this.#vectorRefreshInputs();
        if (!VectorHistory.step(this, isUndo)) return false;
        targetLedger.push("vector");

        this.#refreshAfterVectorStep(before, this.#vectorRefreshInputs());
        return true;
    }

    /**
     * Serialises the parts of the vector state that decide how much must be refreshed after it
     * changes (see #refreshAfterVectorStep), so a before and after can be compared.
     */
    #vectorRefreshInputs() {
        return {
            terrain: this.#serialiseTerrainInputs() + JSON.stringify(NoiseTransform.current(this)),
            featurePins: JSON.stringify(this.mapPins.filter((p) => !p.icon)),
            customBiomes: JSON.stringify(this.uiState.customBiomes),
        };
    }

    /**
     * Refreshes the map after a vector undo/redo, doing only as much work as the change needs.
     * The checks run from the most to the least expensive refresh, and the first that applies
     * covers the ones after it.
     */
    #refreshAfterVectorStep(before, after) {
        // Faults, manual rivers, (in guided mode) land masks and the noise frame all change the
        // elevation data, so an undo/redo that alters any of them needs a terrain regeneration, not
        // just a repaint.
        if (before.terrain !== after.terrain) {
            // The pixel layers only change once the terrain is regenerated, so only the vector
            // layers need redrawing now
            this._repaintVectors();
            this.requestTerrainUpdate(null, this.debouncedGenerateTerrain);
            return;
        }

        // Feature pins (those without an icon) shape the climate
        if (before.featurePins !== after.featurePins) {
            this._repaintCanvas();
            this.debouncedGenerateClimate();
            return;
        }

        // A custom biome's name, colour or rules changing affects only how the biome layer
        // paints (ProceduralEngine reads uiState.customBiomes fresh on every repaint through
        // MapStateManager.getMapParameters). No elevation, moisture or temperature data changed,
        // so regenerating the terrain or climate would be wasted work.
        if (before.customBiomes !== after.customBiomes) {
            this._repaintCanvas();
            return;
        }

        this._repaintVectors();
    }

    /**
     * Steps the brush engine's own undo or redo, then regenerates the terrain it affects. The
     * brush engine steps even when no terrain exists yet, so its stacks stay in line with the
     * ledger, but the entry only counts as stepped through when there is terrain to refresh.
     *
     * @returns {Promise<boolean>} Whether a stroke was stepped through onto existing terrain.
     */
    async #stepRasterHistory(isUndo, targetLedger) {
        // A held regional world's inherited strokes are its parent's: Undo stops above them
        if (this.brushEngine) this.brushEngine.undoFloor = this.inheritedStrokes ?? 0;
        if (isUndo && this.brushEngine && !this.brushEngine.canUndo() && this.brushEngine.history.length > 0) {
            platform.notify.info(platform.i18n.localize("FILRODENSWMB.UI.UndoInheritedStrokes"));
            return null;
        }
        const brushAction = isUndo ? this.brushEngine?.undo() : this.brushEngine?.redo();
        if (!this.baseElevationData || !brushAction) return false;

        targetLedger.push("raster");
        await this.#requestChangedTerrain(isUndo ? "Brush undo" : "Brush redo");
        return true;
    }

    // --- Action Handlers ---

    _onAdjustNoiseScale(event, target) {
        const dir = Number(target.dataset.dir);
        const frame = NoiseTransform.current(this);
        const maxScale = Math.max(this.mapWidth, this.mapHeight);
        const targetScale = Math.max(FILRODENSWMB.LIMITS.NOISE_SCALE_MIN, Math.min(frame.scale + dir * FILRODENSWMB.LIMITS.NOISE_SCALE_STEP, maxScale));

        if (frame.scale === targetScale) {
            platform.notify.warn(platform.i18n.localize("FILRODENSWMB.UI.WarnScaleLimit"));
            return;
        }
        this.#moveNoiseFrame({ ...frame, scale: targetScale });
    }

    /**
     * Pans or rescales the Standard engine's noise: the terrain moves under the map, and
     * everything placed on it is carried along so it stays over the same ground. Pins, labels and
     * decorations are moved here; the brush strokes by NoiseTransform.apply (they belong to the
     * terrain); the regions and routes by MeshIntegration.transformContent. All of it, the noise
     * frame included, is one undo step, so Undo brings the terrain back along with everything on
     * it rather than leaving the content over terrain that has not moved (see VectorHistory).
     * @param {{offsetX: number, offsetY: number, scale: number}} frame - The noise frame to move to.
     */
    #moveNoiseFrame(frame) {
        const before = NoiseTransform.current(this);
        if (before.offsetX === frame.offsetX && before.offsetY === frame.offsetY && before.scale === frame.scale) return;
        const snapshot = VectorHistory.snapshot(this);
        const { toTarget, toSource } = NoiseTransform.between(before, frame);
        const movePoint = (pt) => {
            if (pt?.x !== undefined) [pt.x, pt.y] = toTarget(pt.x, pt.y);
        };

        this.mapLabels.forEach(movePoint);
        this.mapDecorations.forEach(movePoint);
        this.mapPins.forEach((p) => {
            movePoint(p);
            if (p.label) movePoint(p.label);
        });
        this.mapRoutes.forEach((r) => {
            if (r.label) movePoint(r.label);
        });
        for (const level of this.regionLevels) {
            for (const reg of level.regions) if (reg.label) movePoint(reg.label);
        }
        const levelEntries = MeshIntegration.transformContent(this, toTarget, toSource);
        NoiseTransform.apply(this, frame);
        VectorHistory.push(this, VectorHistory.composite([snapshot, VectorHistory.noise(before, frame), ...levelEntries]));

        this.view?.render(["context"]);
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

    async _onApplyFeatureMath(_event, _target) {
        if (!this.hasPendingFeatureMath) return;

        // generateTerrain clears the pending flag itself, before it reads any state
        await this.generateTerrain();
    }

    /** Map setup's terrain fields, which are held until the map is made (again) from them. */
    static #TERRAIN_CHOICE_INPUTS = new Set(["terrainEngine", "terrainSeed", "terrainFlatTexture"]);

    /**
     * The terrain engine, seed and Flat's textured ground Map setup will make the Surface map from
     * (S0 step 4c-2): null while they are the open map's. A made map takes a new engine or seed only
     * by being made again (Make the Surface map again…), so a change waits here.
     */
    #terrainChoice = null;

    /** The open map's terrain engine, seed and textured ground, as Map setup's fields start. */
    #currentTerrainChoice() {
        return { engine: this.uiState.generationEngine ?? FILRODENSWMB.DEFAULTS.ENGINE, seed: String(this.uiState.mapSeed ?? ""), flatTexture: this.uiState.flatTexture === true };
    }

    #recordTerrainChoice(target, name, event) {
        const choice = { ...(this.#terrainChoice ?? this.#currentTerrainChoice()) };
        if (name === "terrainEngine") choice.engine = target.value;
        else if (name === "terrainSeed") choice.seed = target.value;
        else choice.flatTexture = target.checked === true;
        this.#terrainChoice = choice;
        // The engine decides which fields show; any change decides whether Make the Surface map again is on
        if (name !== "terrainSeed" || event?.type === "change") this.view?.render(["context"]);
    }

    /** Map setup's Terrain section: the fields, whether the map is made, and whether they differ from it. */
    #terrainChoiceContext() {
        const now = this.#currentTerrainChoice();
        const choice = this.#terrainChoice ?? now;
        const made = this.surfaceMade !== false;
        const changed = choice.engine !== now.engine || (choice.engine !== "flat" && choice.seed.trim() !== now.seed) || (choice.engine === "flat" && choice.flatTexture !== now.flatTexture);
        return { ...choice, made, changed, held: !!this.world?.held, badge: made ? "FILRODENSWMB.UI.BadgeMakesMapAgain" : null };
    }

    /**
     * Make Surface map, or Make the Surface map again… (Map setup, S0 step 4c-2). Again asks first,
     * naming what is lost; both make the map from Map setup's terrain fields in the world's frame.
     */
    async _onMakeSurfaceMap(_event, target) {
        if (target?.getAttribute?.("aria-disabled") === "true" || this.world?.held) return false;
        const choice = this.#terrainChoice ?? this.#currentTerrainChoice();
        const again = this.surfaceMade !== false;
        if (again && !(await this.#confirmMakeAgain())) return false;
        const made = await this.#makeSurfaceMap({ ...choice, again });
        // The world is saved with its new map, so it is in Worlds whatever happens next
        if (made && !again && this.world) await this.saveCurrentMap();
        return made;
    }

    /** Asks before Make the Surface map again…: what is drawn on the map is lost; the world's settings are kept. */
    async #confirmMakeAgain() {
        const { i18n } = platform;
        const choice = await platform.dialogs.choose({
            title: i18n.localize("FILRODENSWMB.UI.MakeMapAgainTitle"),
            icon: "fwmb-icon fwmb-icon--sync",
            content: `<p>${Sanitize.escapeHtml(i18n.localize("FILRODENSWMB.UI.MakeMapAgainLost"))}</p><p>${Sanitize.escapeHtml(i18n.localize("FILRODENSWMB.UI.MakeMapAgainKept"))}</p>`,
            buttons: [
                { action: "cancel", label: i18n.localize("FILRODENSWMB.UI.Cancel"), default: true },
                { action: "again", label: i18n.localize("FILRODENSWMB.UI.MakeMapAgainButton"), tone: "negative" },
            ],
        });
        return choice === "again";
    }

    /**
     * The studio's map state made empty, in the frame it has (mapWidth, mapHeight): the defaults,
     * with `world` (a captureWorld) written back if given, and nothing drawn: no strokes, masks,
     * rivers, faults, pins, routes, regions, labels, decorations or run, and no undo. Shared by
     * making the Surface map, New world and opening a world with no maps.
     * @param {object|null} [world]
     */
    #clearMap(world = null) {
        this.#forgetPanel();
        MapStateManager.allocateBuffers(this);
        // A new map opens with every terrain layer on (see #terrainLayers)
        this.#setTerrainLayers(MapStudio.#allTerrainLayers(true));
        this.defaultUiState = MapStateManager.buildDefaultUiState(this.mapWidth, this.mapHeight);
        this.uiState = platform.utils.deepClone(this.defaultUiState);
        // The built-in biomes' colours at their defaults, so the panel's fields read them (a world's
        // changed colours come back with its settings below)
        this.customBiomeColors = {};
        Object.entries(FILRODENSWMB.BIOMES).forEach(([key, rgb]) => {
            this.customBiomeColors[key] = rgb;
        });
        if (world) WorldEditors.restoreWorld(this, world);
        PinStyles.ensure(this);
        this.#syncMapControls();
        this.#syncReliefEmphasisSlider();
        this.#terrainChoice = null;

        // A new map is built with the current terrain rules, so there is nothing to update
        this.terrainUpgrade = null;
        this.legacyRootSize = null;
        // A new map is not a crop of anything, so has no parent ground beyond its edges, nor a
        // parent's run
        this.upwindMargin = null;
        this.parentRun = null;
        this.infillPending = false;
        this.infillInputs = null;
        this.riverRoutesLaid = false;
        this.shoresPlaced = false;

        this.brushEngine = this.#createBrushEngine();
        this.manualRivers = [];
        this.tectonicFaults = [];
        this.tectonicFeatureCache = {};
        this.mapPins = [];
        this.mapRoutes = [];
        this.layerSets = [];
        this.modelRun = null;
        this.landMasks = [];
        this.mapLabels = [];
        this.mapDecorations = [];
        FeatureNames.forget(this);
        this.pinHistory = [];
        this.pinRedoStack = [];
        this.globalHistoryLedger = [];
        this.globalRedoLedger = [];

        this.activeRouteId = null;
        this.activeLayerSetId = null;
        this.activeLevelId = null;
        this.activeRegionId = null;
        this.activeFaultId = null;
        this.activeRiverId = null;
        this.activeLandMaskId = null;
    }

    /**
     * Makes the world's Surface map from a terrain engine and seed, in the world's frame (S0 step
     * 4c-2). Everything drawn on the map goes: strokes, masks (kept only when the map stays Guided),
     * rivers, faults, pins, routes, regions, labels, decorations, its homelands and events' places,
     * and the run. The world's settings stay as they are (Ken, 2026-11-20: a new map, not a new
     * world), and so do the world, its save and the mode; the engine's own settings start at its
     * defaults. It has no undo.
     *
     * @param {object} options
     * @param {string} options.engine
     * @param {string} [options.seed] - Blank for a random one.
     * @param {boolean} [options.flatTexture]
     * @param {boolean} [options.again] - Whether the map was made before (its masks are kept when
     *     it stays Guided).
     * @returns {Promise<boolean>}
     */
    async #makeSurfaceMap({ engine, seed = "", flatTexture = false, again = true }) {
        const newEngine = engine || FILRODENSWMB.DEFAULTS.ENGINE;
        const newSeed = String(seed ?? "").trim() || this.#generateRandomSeed();
        // Made in the world's frame (mapWidth, mapHeight): a world with no maps yet sets it in World setup
        const keptMasks = again && newEngine === "guided" && this.uiState.generationEngine === "guided" ? this.landMasks : [];
        // The world's settings, and the climate shown on the map, are kept as they are
        const world = WorldEditors.captureWorld(this);

        this.#clearMap(world);
        this.landMasks = keptMasks;
        this.uiState.mapSeed = newSeed;
        this.uiState.generationEngine = newEngine;
        // Textured ground is chosen when a Flat map is made
        this.uiState.flatTexture = newEngine === "flat" && flatTexture === true;
        this.surfaceMade = true;
        this.worldOpen = true;
        this.#showUnmade();
        this.markDirty();

        // Made from Map setup, which stays open; a Guided map starts drawing its masks
        this.#mapTool = "scene";
        this.activeTool = "scene";
        if (newEngine === "guided" && !keptMasks.length) {
            this.uiState.sceneMode = "addMask";
            this.uiState.isEditMode = true;
        } else {
            this.uiState.isEditMode = false;
        }
        this.#updateCanvasModes(this.activeTool);
        this.view?.render(["worldbar", "toolbar", "context", "editToolbar"]);

        await this.generateTerrain();
        MeshIntegration.startNewMap(this);
        this.#updateGrid();
        this.canvasEngine.resetCamera();
        this.view?.render(["worldbar", "toolbar", "context", "editToolbar"]);
        return true;
    }

    _onChangeTool(event, target) {
        // A settlement map's rail is the Local studio's
        if (this.inSettlement) return SettlementMaps.existing(this).changeTool(target.dataset.tool);
        // A tool that is no longer on the rail (the Settings tool, now the Appearance menu) opens New map
        const newTool = this.definition.offers(target.dataset.tool, this.mapType) ? target.dataset.tool : "scene";
        return this.switchTool(newTool);
    }

    /** How far one press of the 3D view's zoom buttons moves the camera. */
    static #THREE_D_ZOOM = 0.8;

    /**
     * The tool open when an aside was opened (Worlds, the world overview, a world settings editor:
     * tools off the rail, see WorldEditors.isAside), which its Close or Back to goes back to. Going
     * from one aside to another keeps it.
     */
    #toolBeforeAside = null;


    /**
     * The world's settings as they were when the world was opened, made or last saved, for each
     * editor's Revert changes: the state the editors write (WorldEditors.capture) and the settings
     * as the world record holds them (to tell whether a group has changed since).
     */
    #editorBaseline = null;

    /** A card or chip in Worlds: chosen, it shows in the inspector; a second click opens the world. */
    _onSelectWorld(event, target) {
        const worldId = target.dataset.worldId;
        const world = WorldsPanel.find(this, worldId);
        if (!world) return;
        if (event?.detail === 2 && world.mapId) return this.openWorld(world.mapId, world.name);
        return WorldsPanel.select(this, worldId);
    }

    /**
     * An aside's Close or Back to (Worlds, the overview, a world settings editor): the tool it was
     * opened from, else the map tool last open, else Map setup.
     */
    _onCloseWorlds() {
        const kept = this.#toolBeforeAside;
        const tool = kept && !WorldEditors.isAside(kept) && this.definition.offers(kept, this.mapType) ? kept : (this.#mapTool ?? MapStudio.#FIRST_MAP_TOOL);
        return this.switchTool(tool);
    }

    /** Whether the world, not one of its maps, is being worked on: a tool of the world's rail is open. */
    get inWorld() {
        return this.definition.isWorldTool(this.activeTool);
    }

    /** What the layer switcher shows as worked on: the world, a map, or neither (in Worlds). */
    #workingOn() {
        if (this.inSettlement) return "settlement";
        if (this.inWorld) return "world";
        return this.activeTool === "manage" ? "worlds" : "map";
    }

    /** The world's tool last open, which choosing World in the layer switcher opens again. */
    #worldTool = "worldOverview";

    /** World in the layer switcher: the world's rail, on the world tool last open (the overview at first). */
    showWorld() {
        if (this.inSettlement) {
            // Opened from one of the world's tools: back to it, drawn again
            if (this.inWorld) return this.leaveSettlement();
            this.leaveSettlement({ render: false });
        }
        if (this.inWorld) return;
        if (this.activeTool === "manage") Inspector.close(this);
        return this.openWorldTool(this.#worldTool);
    }

    /** A map in the layer switcher (S0: the Surface map): its rail, on the tool last open there. */
    showMap() {
        if (this.inSettlement) {
            // Opened from the map: back to it; opened from the world's tools: on to the map
            if (!this.inWorld && this.activeTool !== "manage") return this.leaveSettlement();
            this.leaveSettlement({ render: false });
        }
        if (!this.inWorld && this.activeTool !== "manage") return;
        Inspector.close(this);
        const kept = this.#mapTool;
        return this.switchTool(this.#isMapTool(kept) ? kept : MapStudio.#FIRST_MAP_TOOL);
    }

    /** Whether a tool is one of a map's, on its rail by stage: not the world's, nor Worlds. */
    #isMapTool(tool) {
        return !!tool && !!this.definition.tool(tool)?.stage && !this.definition.isWorldTool(tool);
    }

    /**
     * A map's card in the overview: chosen, the map shows in the inspector (WorldMapCard); a second
     * click goes to the map, as a world's card in Worlds opens the world.
     */
    #selectMapCard(event) {
        if (event?.detail === 2) return this.showMap();
        return Inspector.open(this, WorldMapCard, { id: "surface" }, { keepFocus: true });
    }

    /**
     * Opens one of the world's tools from the World menu, the overview or a Go block: the overview,
     * a world settings editor, or (until S0 step 4b) the tool that still holds a world setting, at
     * its section.
     * @param {string} tool
     * @param {string} [section] - A section of the tool's panel to open and show.
     */
    async openWorldTool(tool, section) {
        if (!tool || !this.definition.tool(tool) || this.definition.tool(tool).later) return;
        // Cut regional world… goes back to where it was opened from, not to the tool Create opens on
        const from = this.activeTool;
        await this.switchTool(tool);
        if (tool === "worldCut" && this.activeTool === "worldCut" && from !== "worldCut") this.#cutReturn = from;
        if (!section) return;
        await this.view?.render(["context"]);
        const details = this.root?.querySelector(`.fwmb-context-panel details[data-section="${section}"]`);
        if (!details) return;
        details.open = true;
        details.scrollIntoView({ block: "start" });
    }

    /**
     * A world settings editor's context: its head (what a change reaches, whether this sitting
     * has changed it, the held banner) and what its sections read.
     */
    async #worldEditorContext(context) {
        const editor = WorldEditors.of(this.activeTool);
        const node = this.world ? await WorldOverview.nodeOf(this.world.id) : null;
        const parent = node?.parentId ? await WorldOverview.nodeOf(node.parentId) : null;
        context.worldEditor = WorldEditors.head(this, {
            tool: this.activeTool,
            changed: editor.groups.some((group) => this.worldGroupChanged(group)),
            heldCount: (node?.children ?? []).filter((child) => child.held).length,
            heldBy: this.world?.held ? WorldsPanel.named(parent ?? { name: "" }) : null,
            readBy: this.#readByChips(editor.readBy),
        });
        // Why a held regional world is Out of date, on its held banner (S0 step 5)
        context.worldEditor.stale = this.world?.held ? this.#staleLines : [];
        if (context.panel?.page) {
            context.panel.crumb = (this.#creatingWorld ? this.#newWorldName : null) || this.world?.name || this.#saveName || platform.i18n.localize("FILRODENSWMB.UI.UnnamedWorld");
            context.panel.worldEditor = context.worldEditor;
        }
        if (this.activeTool === "worldCultures") context.generate = { nameBases: GeneratePanel.nameBaseChoices(GeneratePanel.settings(this).nameBase) };
        // The world's frame: its size set while the world has no maps, fixed once one is made; its
        // name too while it is being made (board N2)
        if (this.activeTool === "worldSetup") {
            context.worldSetup = {
                creating: this.#creatingWorld,
                name: this.#newWorldName,
                sizeFixed: this.surfaceMade || !!this.world?.held,
                width: this.mapWidth,
                height: this.mapHeight,
                badge: this.surfaceMade ? "FILRODENSWMB.UI.BadgeRebuildsClimate" : null,
            };
            // Nothing is made until Create world: its page says so, and has nothing to revert yet
            if (this.#creatingWorld && context.worldEditor) {
                context.worldEditor.lede = platform.i18n.localize("FILRODENSWMB.UI.WorldSetupNewLede");
                context.worldEditor.changes = "";
                context.worldEditor.canRevert = false;
                context.worldEditor.creating = true;
                context.worldEditor.readBy = [];
            }
        }
    }

    /**
     * A world page's Read by (round 4c): a chip for each map tool that reads it, on each map that
     * has the tool (S0: the Surface map), with a Go that switches to that map and opens the tool.
     * An Explore tool needs a run to show anything, so its Go waits for one.
     * @param {string[]} tools
     */
    #readByChips(tools = []) {
        const { i18n } = platform;
        const map = i18n.localize("FILRODENSWMB.UI.LayerSurfaceFull");
        const hasRun = !!(this.modelRun || this.parentRun);
        return tools
            .map((id) => this.definition.tool(id))
            .filter((entry) => entry && this.#isMapTool(entry.id) && this.definition.offers(entry.id, this.mapType, entry.mode))
            .map((entry) => {
                const name = i18n.localize(entry.label);
                const explore = entry.mode === "explore";
                return {
                    tool: entry.id,
                    icon: entry.icon,
                    name,
                    map: explore ? i18n.format("FILRODENSWMB.UI.ReadByExplore", { map }) : map,
                    goLabel: i18n.format("FILRODENSWMB.UI.GoToOn", { name, map }),
                    // With no Surface map made yet there is no map tool to go to
                    disabled: !this.surfaceMade || (explore && !hasRun),
                    tooltip: !this.surfaceMade ? i18n.localize("FILRODENSWMB.UI.NeedsSurfaceMap") : explore && !hasRun ? i18n.localize("FILRODENSWMB.UI.ReadByNeedsRun") : null,
                };
            });
    }

    /**
     * A Read by chip's Go: the map that has the tool (S0: the Surface map), with the tool open. The World segment returns to the page left.
     * @param {string} tool
     */
    async goToMapTool(tool, section = null) {
        const entry = this.definition.tool(tool);
        if (!entry || !this.#isMapTool(tool) || !this.definition.offers(tool, this.mapType)) return;
        if (entry.mode === "explore" && !(this.modelRun || this.parentRun)) return;
        // A Surface map not made yet has its Map setup alone
        if (!this.surfaceMade && tool !== "scene") return;
        Inspector.close(this);
        await this.switchTool(tool, { force: true });
        await this.view?.render(["worldbar", "toolbar", "context"]);
        if (!section) return;
        const details = this.root?.querySelector(`.fwmb-context-panel details[data-section="${section}"]`);
        if (!details) return;
        details.open = true;
        details.scrollIntoView({ block: "start" });
    }

    /** Place in Peoples and realms' Homelands (board C10): the next click on the map's land adds one. */
    #placeHomeland(cultureId) {
        if (!cultureId || WorldEditors.readOnly(this)) return;
        CultureMarkers.togglePick(this, cultureId);
        this.view?.render(["context", "editToolbar"]);
    }

    /**
     * Whether a homeland or an event's place is being picked on the map from a world page: the page
     * gives way to the Surface map's canvas until the pick ends (until step 4c-2 moves both to each
     * map's Peoples and realms).
     */
    #worldPicking() {
        return CultureMarkers.picking(this) || AgeEventRows.picking(this);
    }

    /** What the picking bar names: what is being placed, and for which culture or event. */
    #worldPickContext() {
        const { i18n } = platform;
        // From a world page, the page comes back once the pick ends; from a map tool, nothing does
        const hint = i18n.localize(WorldEditors.isEditor(this.activeTool) ? "FILRODENSWMB.UI.PickingHint" : "FILRODENSWMB.UI.PickingHintMap");
        const culture = CultureMarkers.pickingName(this);
        if (culture) return { label: i18n.localize("FILRODENSWMB.UI.PickingHomeland"), name: culture, hint };
        return { label: i18n.localize("FILRODENSWMB.UI.PickingEventPlace"), name: AgeEventRows.pickingName(this) ?? "", hint };
    }

    /** The picking bar's Done: the pick ends with nothing placed, and the page comes back. */
    #stopWorldPick() {
        CultureMarkers.stopPick(this);
        AgeEventRows.stopPick(this);
        this.view?.render(["context", "editToolbar"]);
        Inspector.refresh(this);
    }

    /**
     * Peoples and realms' Read from the world (S0 step 4b; board S2): what this map's run reads
     * from the world's settings, each with what it holds and a Go to its editor.
     */
    #readFromWorld() {
        const { i18n } = platform;
        const count = (n, one, many) => i18n.format(n === 1 ? one : many, { count: n });
        const nameBase = GeneratePanel.nameBaseChoices(GeneratePanel.settings(this).nameBase).find((choice) => choice.selected);
        const row = (tool, icon, label, summary) => ({ tool, icon, label: i18n.localize(label), summary, goLabel: i18n.format("FILRODENSWMB.UI.GoTo", { name: i18n.localize(label) }) });
        return [
            // The cultures and the default naming style are one page (round 4c, board C10)
            row("worldCultures", "groups", "FILRODENSWMB.UI.WorldCultures", i18n.format("FILRODENSWMB.UI.ReadCulturesNaming", { cultures: count((this.uiState.cultures ?? []).length, "FILRODENSWMB.UI.ReadCulturesOne", "FILRODENSWMB.UI.ReadCultures"), naming: nameBase?.label ?? "" })),
            row("worldAges", "history", "FILRODENSWMB.UI.WorldAges", count((this.uiState.generatorSettings?.ages ?? []).length, "FILRODENSWMB.UI.ReadAgesOne", "FILRODENSWMB.UI.ReadAges")),
        ];
    }

    /** The names of the settings groups changed since the world opened, for the overview's line. */
    #unsavedGroupNames() {
        const opened = this.worldSettingsOpened;
        if (!opened) return [];
        const names = { setup: "WorldSetup", cultures: "WorldCultures", ages: "WorldAges", nameStyle: "WorldNameStyle", styles: "ToolLibrary", biomes: "WorldBiomes", climate: "ToolClimate", icons: "ToolLibrary" };
        return [...new Set(WorldRecord.changedGroups(opened, this.#worldSettingsNow()).map((group) => names[group]).filter(Boolean))].map((key) => platform.i18n.localize(`FILRODENSWMB.UI.${key}`));
    }

    /** Takes the world's settings as they are now as each editor's point to revert to (see #editorBaseline). */
    #captureEditorBaseline() {
        this.#editorBaseline = { values: WorldEditors.capture(this), settings: this.#worldSettingsNow() };
    }

    /** Whether a settings group has changed since the world was opened, made or last saved. */
    worldGroupChanged(group) {
        if (!this.#editorBaseline) return false;
        return JSON.stringify(this.#editorBaseline.settings?.[group] ?? null) !== JSON.stringify(this.#worldSettingsNow()[group] ?? null);
    }

    /**
     * Revert changes (a world page): its groups as they were before the first change in this
     * sitting, in one step, then what they reach drawn again. Like any change it marks the runs
     * that read them out of date, and the world unsaved until saved.
     * @param {string} tool - The page's tool id.
     */
    async revertWorldGroup(tool) {
        const editor = WorldEditors.of(tool);
        const groups = (editor?.groups ?? []).filter((group) => this.worldGroupChanged(group));
        if (this.world?.held || editor?.undo || !groups.length) return;
        // Revert changes cannot itself be taken back, and a sitting's work can be long, so it asks
        // first, naming the page and that everything since the world was opened or saved goes
        if (!(await this.#confirmRevert(editor))) return;
        for (const group of groups) {
            if (!WorldEditors.restore(this, this.#editorBaseline.values, group)) continue;
            this.#showRestoredFields(group);
            switch (group) {
                case "setup":
                    this.#applyWorldScale();
                    this._repaintVectors();
                    this.debouncedGenerateClimate();
                    this.#markGeneratorStale();
                    break;
                case "biomes":
                    this._repaintCanvas();
                    this.#markGeneratorStale();
                    break;
                default:
                    break;
            }
        }
        this.markDirty();
        await this.view?.render(["context", "worldbar", "editToolbar"]);
    }

    /**
     * Asks before Revert changes (Ken, 2026-11-20): it cannot be undone, so the page's whole sitting
     * of work would otherwise go at one click. Cancel is the default.
     * @param {object} editor - The page's entry in WORLD_EDITORS.
     * @returns {Promise<boolean>} Whether to revert.
     */
    async #confirmRevert(editor) {
        const { i18n } = platform;
        const page = i18n.localize(editor.label);
        const choice = await platform.dialogs.choose({
            title: i18n.format("FILRODENSWMB.UI.WorldRevertTitle", { page }),
            icon: "fwmb-icon fwmb-icon--history",
            content: `<p>${Sanitize.escapeHtml(i18n.format("FILRODENSWMB.UI.WorldRevertConfirm", { page }))}</p>`,
            buttons: [
                { action: "cancel", label: i18n.localize("FILRODENSWMB.UI.Cancel"), default: true },
                { action: "revert", label: i18n.localize("FILRODENSWMB.UI.WorldRevert"), icon: "fwmb-icon fwmb-icon--history", tone: "negative" },
            ],
            dismissed: "cancel",
        });
        return choice === "revert";
    }

    /**
     * Puts a reverted group's values in the panel's fields at once. The map's parameters are read
     * from the open fields (see MapStateManager.getMapParameters), so a field still showing the
     * change would write it back before the panel is drawn again.
     * @param {string} group
     */
    #showRestoredFields(group) {
        for (const key of Object.keys(this.#editorBaseline.values[group] ?? {})) {
            const input = Object.hasOwn(this.uiState, key) ? this.root?.querySelector(`[name="${key}"]`) : null;
            if (!input) continue;
            if (RangeCurve.isCurved(input)) RangeCurve.setValue(input, this.uiState[key]);
            else input.value = this.uiState[key];
        }
    }

    /**
     * Opens a world from Worlds (its Surface map). The load leaves Worlds for the tool it was opened
     * from, as Close does, once any unsaved changes have been settled (see #handleMapLoad).
     * @param {string} mapId
     * @param {string} name
     */
    async openWorld(mapId, name, worldId = null) {
        await this.worldAction("load", mapId, name, undefined, worldId);
    }

    /** Keeps the open world's map tool for the session (see #mapTool). */
    #rememberMapTool() {
        const id = this.world?.id ?? this.#saveId;
        if (id && id === this.#mapToolWorldId && this.#mapTool) this.#worldMapTools.set(id, this.#mapTool);
    }

    /**
     * The tool a world opens on: the map tool it was left on this session, else the map tool open
     * now, else Map setup (Ken, 2026-11-20: a world with a run no longer opens on History).
     */
    async #openWorldOnItsTool() {
        this.#mapToolWorldId = this.world?.id ?? this.#saveId;
        const kept = this.#worldMapTools.get(this.#mapToolWorldId);
        const offered = (tool) => this.#isMapTool(tool) && this.definition.offers(tool, this.mapType);
        const tool = [kept, this.activeTool, this.#mapTool].find(offered) ?? MapStudio.#FIRST_MAP_TOOL;
        this.#mapTool = tool;
        // A world opens on its map (S0 step 4c-2): leaving Worlds may have shown the world tool
        // left, which the opening's overlay hid
        if (this.activeTool !== tool || !offered(this.activeTool)) await this.switchTool(tool, { force: true });
        this.#rememberMapTool();
        this.view?.render(["worldbar", "toolbar"]);
    }

    /**
     * Opens a tool: the one open is left (its drawing ended, its inspector closed, the 3D view
     * closed when it is the 3D view), and the new one is set up and drawn.
     * @param {string} newTool
     * @param {{force?: boolean}} [options] - Draw again even when the tool is the one open (a mode change).
     */
    async switchTool(newTool, { force = false } = {}) {
        // Anything that opens a tool of the world's or the Surface map's leaves a settlement map
        if (this.inSettlement) {
            this.leaveSettlement({ render: false });
            force = true;
        }
        if (this.activeTool === newTool && !force) return;
        const wasOn = this.#workingOn();
        // Worlds' Close goes back to the tool it was opened from
        if (WorldEditors.isAside(newTool) && !WorldEditors.isAside(this.activeTool)) this.#toolBeforeAside = this.activeTool;
        // While a world is being made, only its World setup is open (board N2); Open world (Worlds)
        // gives it up, as Cancel does
        if (this.#creatingWorld && newTool === "manage") this.#closeWorld();
        else if (this.#creatingWorld && newTool !== "worldSetup") return;
        // With no world open there is only Worlds (board N5); with no Surface map made, its Map
        // setup is all its rail holds (board N4)
        if (!this.worldOpen && newTool !== "manage") return;
        if (this.worldOpen && !this.surfaceMade && this.#isMapTool(newTool) && newTool !== "scene") return;
        // Cut regional world… needs a Surface map it can cut from; Cancel goes back where it was opened
        if (newTool === "worldCut" && this.cutOff()) return;
        if (newTool === "worldCut" && this.activeTool !== "worldCut") this.#cutReturn = this.activeTool;
        // The 3D view closes as its tool is left, and opens as it is chosen (it has no panel)
        if (this.scene3D && newTool !== "threeD") await this._onThreeDView();
        // The World segment goes back to the world's page last open, not to the cut
        if (this.definition.isWorldTool(newTool)) this.#worldTool = newTool === "worldCut" ? this.#worldTool : newTool;
        else if (this.#isMapTool(newTool)) this.#mapTool = newTool;
        this.#rememberMapTool();

        // 1. Teardown current state. Automatic generation always comes back on when the tool
        // changes; changes deferred by the pause toggle are generated now (which also covers a
        // land mask completed below), otherwise a completed mask is queued as usual.
        const hadDeferredChanges = this.#restoreLiveGeneration();
        const maskCompleted = this.#clearActiveDrawingStates();
        if (hadDeferredChanges) this.generateTerrain();
        else if (maskCompleted) this.requestTerrainUpdate();
        this.#deactivateEditMode();
        this.#clearMassEditState();
        RegionLists.reset(this);
        StyleLists.reset(this);
        CultureLists.reset(this);
        // A homeland's or an event's place being picked ends with the tool or the layer it was
        // started in: left running, it would keep the map's clicks, and hide a world page's panel
        // behind its picking bar, until Done
        CultureMarkers.stopPick(this);
        AgeEventRows.stopPick(this);
        // Help closes with the inspector below, and what it covered belongs to the tool being left
        HelpPanel.forget(this);
        // The inspector belongs to the tool its object was opened from
        platform.dialogs.dismiss({ placement: "docked" });

        // 2. Setup new state
        MapStateManager.getMapParameters(this);
        this.activeTool = newTool;

        // 3. Delegate UI & Canvas updates
        this.#ensureToolLayerVisible(newTool);
        this.#updateBiomeOpacity();
        this.#updateCanvasModes(newTool);

        // The Travel tool takes the map's clicks for its start while it is open
        TravelView.toolChanged(this);

        // 4. Paint (the world bar too when the world or a map comes to be worked on: its switcher)
        this._repaintVectors();
        const drawn = this.view?.render(["toolbar", "context", "editToolbar", ...(wasOn !== this.#workingOn() ? ["worldbar"] : [])]);
        this.#updateCanvasHint();
        if (newTool === "threeD" && !this.scene3D) await this._onThreeDView();
        // Worlds opens with the open world chosen (board W9), its inspector filling the column kept
        // for it (WorldsPanel.reserve)
        if (newTool === "manage" && wasOn !== "worlds" && this.world?.id) {
            await drawn;
            if (this.activeTool === "manage" && !Inspector.current(this)) WorldsPanel.select(this, this.world.id);
        }
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
            if (config.activeKey) this[config.activeKey] = null;
        }
        RegionPainter.cancel(this);
        InfluencePainter.cancel(this);
        RouteTool.cancel(this);
        RouteTool.updateOverlays(this);

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
        const group = MapStudio.MASS_EDIT_EXCLUSIVE_GROUPS.find((siblings) => siblings.includes(type));
        return !!group && group.some((sibling) => sibling !== type && this.massEditMode[sibling]);
    }

    async #deactivateEditMode() {
        this.#returnToSelect();
        if (!this.uiState.isEditMode) return;

        this.uiState.isEditMode = false;
        this.brushEngine?.endStroke();
        if (this.canvasEngine) {
            this.canvasEngine.setEditMode(false);
            if (this.canvasEngine.setCropMode) this.canvasEngine.setCropMode(false);
        }

        await this.view?.render(["toolbar", "editToolbar", "context"]);
    }

    #ensureToolLayerVisible(newTool) {
        const terrainLayers = MapStudio.#TOOL_TERRAIN_LAYERS[newTool];
        if (terrainLayers) {
            this.#setTerrainLayers(Object.fromEntries(terrainLayers.map((key) => [key, true])));
            return;
        }

        const toolLayerMap = {
            infrastructure: "infrastructure",
            regions: "regions",
            labels: "labels",
        };

        const layerId = toolLayerMap[newTool];
        // The Labels and Regions menus: every row back on if all were off
        if ((layerId === "labels" || layerId === "regions") && ContentRows.ensureShown(this, layerId)) {
            this.#syncMapControls();
            this._repaintVectors();
            return;
        }
        if (!layerId || this.#layerVisibility[layerId]) return;

        this.#layerVisibility[layerId] = true;
        this.canvasEngine?.toggleLayer(layerId, true);
        this.#syncMapControls();
    }

    #updateCanvasModes(newTool) {
        if (!this.canvasEngine) return;

        this.canvasEngine.setReferenceMode(newTool === "reference");
        this.#applyCanvasInteractivity();
    }

    /** Whether the export dialogue is open, or its export still drawing (a second waits for it). */
    #exporting = false;

    /**
     * What stays free while an export draws (S0 step 7b; Ken, 2026-11-21): moving the camera,
     * Save world, Help, Appearance and the keyboard shortcuts. The tiles are drawn from the canvas
     * as it shows the map, so everything else that would change the map, or what it shows, waits.
     */
    static #FREE_WHILE_EXPORTING = Object.freeze(["zoomIn", "zoomOut", "resetZoom", "saveMap", "toggleHelp", "openShortcuts", "toggleFullscreen", "toggleAppearance", "chooseAppearance", "cancelProcessing", "keepProcessing"]);

    /** Holds the studio while an export draws, or frees it (see StudioView.hold). */
    #holdForExport(on) {
        this.view?.hold(on ? { reason: platform.i18n.localize("FILRODENSWMB.UI.ExportHeld"), allowed: MapStudio.#FREE_WHILE_EXPORTING } : null);
        this.#applyCanvasInteractivity();
    }

    /**
     * Export image (Export's, History's Export this age, Travel's Export this journey): the export
     * dialogue (S0 step 7; see ExportDialog) on the map as it shows now, named with the age or
     * the journey while either is shown.
     */
    async _onExportPng(_event, _target) {
        if (!this.canvasEngine || !this.currentElevationData) {
            platform.notify.warn(platform.i18n.localize("FILRODENSWMB.UI.ExportNoMap"));
            return;
        }
        if (this.#exporting) return;
        this.#exporting = true;
        try {
            await this.#labelFacesReady();
            const { i18n } = platform;
            const base = this.currentSaveName || i18n.localize("FILRODENSWMB.UI.UnsavedMapName");
            const aged = HistoryView.exportName(this, base);
            const name = TravelView.exportName(this, aged);
            const title = name !== aged ? "FILRODENSWMB.UI.ExportThisJourney" : aged !== base ? "FILRODENSWMB.UI.ExportThisAge" : "FILRODENSWMB.UI.ExportPNG";
            const engine = this.canvasEngine;
            await ExportDialog.open({
                ...this.#exportSource(),
                kind: "png",
                title: i18n.localize(title),
                name,
                samples: (area, scale) => engine.exportSamples(scale, { area }),
                draw: (area, scale, options) => engine.drawExport(area, scale, options),
            });
        } finally {
            this.#exporting = false;
        }
    }

    /** What every export's dialogue reads of the map (see ExportDialog's ExportSource). */
    #exportSource() {
        const engine = this.canvasEngine;
        return {
            map: { width: this.mapWidth, height: this.mapHeight },
            view: engine.viewRect(),
            smallestLabelPx: engine.smallestLabelPx(),
            kmPerPx: kmPerPxOf(this.uiState, this.mapHeight),
            unit: cleanUnit(this.uiState.mapUnit),
            // Every World studio map has raster terrain, drawn at the map's own pixels
            rasterPx: this.mapWidth,
            ceiling: FILRODENSWMB.EXPORT_PNG.SCALE.CEILING,
            tileLimit: engine.exportTileLimit(),
            drawPreview: (side) => engine.exportPreview(side),
            cutOff: () => this.cutOff(),
            cut: (area) => this.#cutFromArea(area),
            hold: (on) => this.#holdForExport(on),
        };
    }

    /**
     * The export's steer at 4× (DE): Cut regional world… opened on the export's area, which its
     * crop snaps as any crop it is given.
     * @param {{x: number, y: number, width: number, height: number}} area
     */
    async #cutFromArea(area) {
        if (this.cutOff()) return;
        await this.openWorldTool("worldCut");
        if (this.activeTool !== "worldCut" || !this.canvasEngine) return;
        this.canvasEngine.setCropBox(area);
        this.canvasEngine.onCropRelease?.({ ...area });
    }

    /**
     * Export to scene (Foundry; S0 step 7b, board X4): the export dialogue with the scene's
     * choices, its area snapped to the map's grid and its scale giving whole cells. The scene is made
     * from the area (see #exportScene).
     */
    async _onExportScene(_event, _target) {
        if (!this.canvasEngine || !this.currentElevationData) {
            platform.notify.warn(platform.i18n.localize("FILRODENSWMB.UI.ExportNoMap"));
            return;
        }
        if (this.#exporting) return;
        this.#exporting = true;
        try {
            await this.#labelFacesReady();
            const { i18n } = platform;
            const engine = this.canvasEngine;
            await ExportDialog.open({
                ...this.#exportSource(),
                kind: "scene",
                title: i18n.localize("FILRODENSWMB.UI.ExportScene"),
                name: this.currentSaveName || i18n.localize("FILRODENSWMB.UI.UnsavedMapName"),
                sceneName: this.currentSaveName || i18n.localize("FILRODENSWMB.UI.DefaultSceneName"),
                folder: "fwmb-exports",
                grid: this.#exportGrid(),
                minCell: FILRODENSWMB.LIMITS.MIN_GRID_SIZE,
                // A scene's background must fit the graphics card's largest texture to be shown
                maxSide: engine.maxTextureSize(),
                samples: (area, scale) => engine.exportSamples(scale, { area, forScene: true }),
                pageCount: (area) => MapStudio.#pageCount(GeneratedDetails.journalPages(this, { area })),
                previous: (name) => platform.scene.previous?.(name) ?? null,
                exportScene: (choice, progress) => this.#exportScene(choice, progress),
            });
        } finally {
            this.#exporting = false;
        }
    }

    /** The map's grid as the scene export snaps to it: its type ("none" for gridless) and size in map pixels. */
    #exportGrid() {
        return { type: this.uiState.gridType ?? "none", size: MapStateManager.gridSizeOf(this.uiState.gridSize) };
    }

    /** The journal pages a scene export makes (springs have none). */
    static #pageCount(pages) {
        return pages.pins.filter((page) => page.item.type !== "spring" && page.item.type !== "block_spring").length + pages.regions.length + pages.routes.length;
    }

    /**
     * Makes the scene from the export dialogue's choice: the player image, then the GM overlay,
     * drawn in tiles from the area (each pass's vectors rebuilt first, as the canvas shows them for
     * that pass), the images encoded, the grid cell data and journal pages for the area worked out,
     * and the scene made by the host (see SceneExporter). Resolves false when cancelled.
     * @param {{area: object, scale: number, format: string, cell: number|null, name: string, folder: string, generateJournals: boolean, overwriteJournals: boolean, gmOverlay: boolean}} choice
     * @param {{onTile: (done: number, total: number) => void, onStage: (key: string) => void, signal: AbortSignal}} progress
     * @returns {Promise<boolean>}
     */
    async #exportScene(choice, { onTile, onStage, signal }) {
        const engine = this.canvasEngine;
        const { area, scale, format } = choice;
        const width = Math.max(1, Math.round(area.width * scale));
        const height = Math.max(1, Math.round(area.height * scale));
        const perPass = ExportScale.tiles(width, height, engine.exportTileLimit()).length;
        const total = perPass * (choice.gmOverlay ? 2 : 1);
        const activeWindow = this.root?.ownerDocument.defaultView || window;
        // Each pass rebuilds the vectors for who sees them; the new sprites need a moment to reach the GPU
        const pass = async (mode, first) => {
            engine.setRenderPass(mode);
            this._repaintVectors();
            await new Promise((resolve) => activeWindow.setTimeout(resolve, 250));
            if (signal.aborted) return null;
            return engine.drawExport(area, scale, { signal, pass: mode, onTile: (done) => onTile(first + Math.min(done, perPass), total) });
        };
        let player;
        let gm = null;
        try {
            onStage("FILRODENSWMB.UI.ExportStepPlayer");
            player = await pass("player", 0);
            if (player && choice.gmOverlay) {
                onStage("FILRODENSWMB.UI.ExportStepGm");
                gm = await pass("gm", perPass);
                if (!gm) player = null;
            }
        } finally {
            engine.setRenderPass("normal");
            this._repaintVectors();
        }
        if (!player || signal.aborted) return false;

        onStage("FILRODENSWMB.UI.ExportStepEncoding");
        const { blob: playerBlob } = await ImageFormat.encode(player, format);
        const gmBlob = gm ? (await ImageFormat.encode(gm, format)).blob : null;
        onStage("FILRODENSWMB.UI.ExportStepGridData");
        const grid = this.#exportGrid();
        let gridData = null;
        if (grid.type !== "none") {
            try {
                gridData = GridDataExporter.build(this, { area, offset: SceneArea.offset(area, grid) });
            } catch (error) {
                // The grid data is an extra: the scene is still made without it
                console.error("FWMB | Grid data export failed.", error);
            }
        }
        if (signal.aborted) return false;
        await platform.scene.run({
            name: choice.name,
            folder: choice.folder,
            generateJournals: choice.generateJournals,
            overwriteJournals: choice.overwriteJournals,
            playerBlob,
            gmBlob,
            width,
            height,
            grid: {
                type: FILRODENSWMB.GRID_TYPES[grid.type]?.value ?? FILRODENSWMB.GRID_TYPES.square.value,
                // A gridless scene still needs a size for Foundry's measuring; the map's own at the scale
                size: choice.cell ?? Math.max(FILRODENSWMB.LIMITS.MIN_GRID_SIZE, Math.round(grid.size * scale)),
                // What one cell measures in the map's own unit, the same at any scale
                ...gridDistanceOf(this.uiState, this.mapHeight, grid.size),
            },
            gridData,
            pages: choice.generateJournals ? GeneratedDetails.journalPages(this, { area }) : null,
            made: { x: area.x, y: area.y, width: area.width, height: area.height, scale },
            save: () => this.saveCurrentMap(),
            onStage,
        });
        return true;
    }

    /**
     * Why Cut regional world… is off, or null when a regional world can be cut from the open world
     * (S0 step 5): it needs the world's Surface map made, with terrain the cut can read
     * (TerrainVersion.canCreateRegionalMap).
     * @returns {string|null}
     */
    cutOff() {
        const { i18n } = platform;
        if (!this.worldOpen || this.#creatingWorld) return i18n.localize("FILRODENSWMB.UI.NoWorldOpenHint");
        if (!this.surfaceMade) return i18n.localize("FILRODENSWMB.UI.NeedsSurfaceMap");
        if (!TerrainVersion.canCreateRegionalMap(this.uiState)) return i18n.localize("FILRODENSWMB.UI.RegionalMapNeedsUpdate");
        return null;
    }

    /** The tool Cut regional world… was opened from, which Cancel and Escape go back to. */
    #cutReturn = null;

    /** Cancel (the panel's foot, the bar, Escape): back to the world page or map tool the cut was opened from. */
    async #cancelCut() {
        if (this.activeTool !== "worldCut") return;
        const back = this.#cutReturn && this.#cutReturn !== "worldCut" ? this.#cutReturn : "worldOverview";
        this.#cutReturn = null;
        if (this.#isMapTool(back)) return this.goToMapTool(back);
        return this.switchTool(back);
    }

    /**
     * Whether a crop would cut a regional world finer than a world map can show (FILRODENSWMB.UI.
     * REGIONAL_CROP.MIN_KM_PER_PX): its effective km a pixel is this map's divided by the zoom.
     * @param {{zoomScale: number}|null} plan - From #planCrop.
     */
    #cropTooFine(plan) {
        if (!plan || !(plan.zoomScale > 0)) return false;
        return kmPerPxOf(this.uiState, this.mapHeight) / plan.zoomScale < FILRODENSWMB.UI.REGIONAL_CROP.MIN_KM_PER_PX;
    }

    /** Why a crop finer than the limit is refused, the limit in the map's unit. */
    #cropLimitText() {
        return platform.i18n.format("FILRODENSWMB.UI.CropTooFine", { distance: formatDistance(FILRODENSWMB.UI.REGIONAL_CROP.MIN_KM_PER_PX), unit: cleanUnit(this.uiState.mapUnit) });
    }

    /** The crop's ground a pixel on the regional world, as its readout shows it ("1 pixel is about 0.4 km"). */
    #cropScaleText(plan) {
        const km = kmPerPxOf(this.uiState, this.mapHeight) / plan.zoomScale;
        return platform.i18n.format("FILRODENSWMB.UI.PixelScale", { distance: formatDistance(km), unit: cleanUnit(this.uiState.mapUnit) });
    }

    /** What Cut regional world…'s panel, foot and bar read (board W7). */
    #cutContext() {
        const { i18n } = platform;
        const box = this.canvasEngine?.cropBox ?? null;
        const plan = box && box.width > 0 && box.height > 0 ? this.#planCrop(box) : null;
        const tooFine = this.#cropTooFine(plan);
        const name = this.world?.name || this.#saveName || i18n.localize("FILRODENSWMB.UI.UnnamedWorld");
        const grid = { square: "FILRODENSWMB.UI.GridSquare", hexR: "FILRODENSWMB.UI.GridHexRows", hexC: "FILRODENSWMB.UI.GridHexCols" }[this.uiState.gridType];
        return {
            world: name,
            bar: i18n.format("FILRODENSWMB.UI.CutBar", { name }),
            barHint: i18n.localize(grid && this.uiState.regionalAlignGrid !== false ? "FILRODENSWMB.UI.CutBarHint" : "FILRODENSWMB.UI.CutBarHintFree"),
            height: plan?.targetHeight ?? this.uiState.regionalTargetHeight,
            scale: plan ? this.#cropScaleText(plan) : "--",
            gridGo: i18n.format("FILRODENSWMB.UI.GoTo", { name: i18n.localize("FILRODENSWMB.UI.ToolCartography") }),
            // A map with a grid offers to keep the crop where it is drawn instead (Ken, 2026-11-20)
            hasGrid: !!grid,
            align: this.uiState.regionalAlignGrid !== false,
            grid: !grid ? i18n.localize("FILRODENSWMB.UI.CutGridNone") : this.uiState.regionalAlignGrid === false ? i18n.format("FILRODENSWMB.UI.CutGridFree", { name }) : i18n.format("FILRODENSWMB.UI.CutGridLine", { grid: i18n.localize(grid), size: this.uiState.gridSize }),
            limit: this.#cropLimitText(),
            tooFine,
            infillOffered: this.#regionalInfillOffered(box, plan),
            held: i18n.format("FILRODENSWMB.UI.CutHeldLine", { name }),
            off: !plan ? i18n.localize("FILRODENSWMB.UI.WarnInvalidCrop") : tooFine ? this.#cropLimitText() : null,
        };
    }

    /**
     * Cut regional world… at the panel's foot (board W7): the world is saved first if it has never
     * been or has unsaved changes (the regional world is cut from the world as it is now, which
     * must be what was saved); then the regional world's name; then the cut (#cutWorld), and the
     * new regional world opens.
     */
    async _onCutRegionalWorld() {
        if (!this.canvasEngine || this.activeTool !== "worldCut") return;
        const box = this.canvasEngine.getCropData();
        if (!box || !(box.width > 0) || !(box.height > 0)) {
            platform.notify.warn(platform.i18n.localize("FILRODENSWMB.UI.WarnInvalidCrop"));
            return;
        }
        const plan = this.#planCrop(box);
        if (this.#cropTooFine(plan)) {
            platform.notify.warn(this.#cropLimitText());
            return;
        }
        const neverSaved = !this.currentSaveId;
        if (neverSaved || this.isDirty) {
            if (!(await MapDialogManager.promptSaveBeforeRegionalMap(neverSaved))) return;
            if (!(await this.saveCurrentMap({ promptTitle: platform.i18n.localize("FILRODENSWMB.UI.SaveUnsavedMap") }))) return;
        }
        const parentName = this.world?.name || this.currentSaveName || platform.i18n.localize("FILRODENSWMB.UI.MapNameFallback");
        const name = (await MapDialogManager._promptTextValue(platform.i18n.localize("FILRODENSWMB.UI.CutRegionalWorldName"), platform.i18n.localize("FILRODENSWMB.UI.Name"), platform.i18n.format("FILRODENSWMB.UI.RegionalMapName", { name: parentName }), "name", platform.i18n.localize("FILRODENSWMB.UI.ActionCut")))?.trim();
        if (!name) return;
        this.#cutReturn = null;
        const cut = await this.#cutWorld({ crop: plan.cropBox, width: plan.targetWidth, name, infill: this.uiState.regionalInfill === true, align: this.uiState.regionalAlignGrid !== false });
        if (cut) await this.#openCutWorld(cut);
    }

    /**
     * Cuts a regional world from the open world (saved, with no unsaved changes): a new world, held
     * by the open one, with its Surface map cut from the crop (RegionalExtractor.createPayload) and
     * its full record (RegionalRecord: the crop, the zoom, the inherited strokes, the crop
     * fingerprint and the cut's base, kept as the map's blob). The open world records the new
     * world's fingerprint (its childFingerprints), so a later save can tell when it changes.
     *
     * @param {object} options
     * @param {{x: number, y: number, width: number, height: number}} options.crop - In this map's pixels.
     * @param {number} options.width - The regional world's width in pixels.
     * @param {string} options.name
     * @param {boolean} options.infill - Fill it in when it first opens (where it is offered).
     * @param {boolean} [options.align] - Fit the crop to this map's grid (see RegionalExtractor.planCrop).
     * @returns {Promise<{worldId: string, mapId: string, name: string}|null>}
     */
    async #cutWorld({ crop, width, name, infill, align = true }) {
        const parent = this.world;
        const sourceMapId = this.currentSaveId;
        if (!parent || !sourceMapId) return null;
        await this.#startProcessing(platform.i18n.localize("FILRODENSWMB.UI.GeneratingRegion"));
        try {
            const askedInfill = this.uiState.regionalInfill;
            this.uiState.regionalInfill = infill;
            let cut;
            try {
                cut = RegionalExtractor.createPayload(this, crop, { targetWidth: width, align });
            } finally {
                this.uiState.regionalInfill = askedInfill;
            }
            const { payload, owners, plan } = cut;
            const fingerprint = CropFingerprint.of(this, { crop: plan.cropBox, width: plan.targetWidth, align });
            const base = await Blobs.pack(RegionalExtractor.cutBase(payload, owners));

            const { settings, mapData } = WorldSettings.split(payload);
            const result = await Worlds.save({
                world: { parentWorldId: parent.id, held: true, regional: null },
                asNew: true,
                name,
                settings: { setup: settings.setup },
                maps: [{ id: null, type: MAP_TYPES.SURFACE, data: mapData, owners, modelRun: null, summary: payload, changed: true, card: { run: !!payload.parentRun, older: GeneratorRevision.isOlder(payload) } }],
            });
            const mapId = result?.maps[0]?.id;
            if (!mapId) throw new Error("the regional world could not be saved");

            // The parent map's revision and save time as its store holds them
            const source = (await platform.store.loadMapMeta(sourceMapId)) ?? (parent.maps ?? []).find((map) => map.id === sourceMapId) ?? null;
            const place = TerrainVersion.resolveWorld(payload);
            const rootZoom = Number.isFinite(place.zoom) && place.zoom > 0 ? place.zoom : null;
            const size = { width: plan.targetWidth, height: plan.targetHeight };
            const world = result.world;
            world.regional = RegionalRecord.check(
                RegionalRecord.create({
                    parentSettingsRevision: parent.settingsRevision ?? null,
                    cutAt: Worlds.now(),
                    cutWith: { module: platform.module?.version, terrainVersion: payload.terrainVersion, generatorRevision: payload.generatorRevision },
                    maps: [
                        {
                            mapId,
                            sourceMapId,
                            crop: { parent: plan.cropBox, root: rootZoom && Number.isFinite(place.originX) ? { x: place.originX, y: place.originY, width: size.width / rootZoom, height: size.height / rootZoom } : null },
                            zoom: plan.zoomScale,
                            rootZoom,
                            size,
                            parentRevision: source?.revision ?? null,
                            parentSavedAt: source?.savedAt ?? null,
                            cropFingerprint: fingerprint,
                            inheritedStrokes: (payload.history ?? []).length,
                            cutBase: base.hash,
                            gridAligned: align,
                        },
                    ],
                }),
            );
            await platform.store.saveMapBlob?.(mapId, base.hash, base.bytes);
            await platform.store.saveWorld(world);

            // The world it was cut from keeps the fingerprint, to tell when it changes there
            const saved = (await Worlds.get(parent.id)) ?? parent;
            saved.childFingerprints = { ...RegionalRecord.checkChildFingerprints(saved.childFingerprints), [world.id]: { [mapId]: fingerprint } };
            await platform.store.saveWorld(saved);
            this.world = saved;
            platform.notify.info(platform.i18n.format("FILRODENSWMB.UI.RegionalWorldCut", { name }));
            return { worldId: world.id, mapId, name };
        } catch (err) {
            console.error("FWMB | Cutting the regional world failed:", err);
            platform.notify.error(platform.i18n.localize("FILRODENSWMB.UI.RegionalGenerationError"));
            return null;
        } finally {
            this.#endProcessing();
        }
    }

    /** Opens a regional world just cut, on its Surface map (it fills in then, when asked). */
    async #openCutWorld({ mapId, name }) {
        this.isDirty = false;
        await this.#startProcessing(platform.i18n.format("FILRODENSWMB.UI.OpeningWorld", { name }));
        try {
            await this.#loadMap(mapId, name);
        } finally {
            this.#endProcessing();
        }
    }

    /**
     * Each held regional world's crop fingerprint as the open world now gives it (see
     * CropFingerprint), kept on the world's record as childFingerprints: worked out when the world
     * is saved with its map changed, so a regional world can tell its parent changed inside its
     * crop (RegionalRecord.staleness, rule 1). A world cut before v5 has no fingerprint to compare.
     * @param {object} world - The world just saved (changed in place).
     * @param {string} mapId - Its map just saved.
     * @returns {Promise<boolean>} Whether any fingerprint was worked out.
     */
    async #updateChildFingerprints(world, mapId) {
        const children = [...(await Worlds.all()).values()].filter((child) => child.parentWorldId === world.id && child.held && RegionalRecord.isCurrent(child.regional) && !child.regional.migrated);
        if (!children.length) return false;
        // Only the worlds it holds now: one deleted or released has no crop to compare
        const kept = RegionalRecord.checkChildFingerprints(world.childFingerprints);
        const prints = Object.fromEntries(children.filter((child) => kept[child.id]).map((child) => [child.id, kept[child.id]]));
        for (const child of children) {
            for (const entry of child.regional.maps) {
                if (entry.sourceMapId !== mapId || !entry.cropFingerprint || !entry.crop?.parent || !entry.size) continue;
                prints[child.id] = { ...prints[child.id], [entry.mapId]: CropFingerprint.of(this, { crop: entry.crop.parent, width: entry.size.width, align: entry.gridAligned !== false }) };
            }
        }
        world.childFingerprints = prints;
        return true;
    }

    /**
     * Why the open world is Out of date, a sentence a rule (see WorldsPanel.staleLines), as last
     * read from the store: refreshed as a world opens and after each save.
     */
    #staleLines = [];

    async #refreshStale() {
        if (!this.world?.held) {
            this.#staleLines = [];
            return;
        }
        const worlds = await Worlds.all();
        const world = worlds.get(this.world.id) ?? this.world;
        this.#staleLines = WorldsPanel.staleLines({ stale: RegionalRecord.staleness(world, (id) => worlds.get(id) ?? null) });
    }

    /**
     * Cut again… (Worlds' inspector, a held world's overview; Ken, 2026-11-20): the regional
     * world is cut afresh from the same crop of the world it was cut from, as a new world with its
     * name; the old one is kept, renamed "<name> (old, <date>)", with its edits and the regional
     * worlds cut from it (their crops came from it). Asks first; the open world's unsaved changes
     * are asked about as any close does.
     * @param {string} worldId
     */
    async cutAgain(worldId) {
        const worlds = await Worlds.all();
        const old = worlds.get(worldId);
        const parent = old?.parentWorldId ? worlds.get(old.parentWorldId) : null;
        const entry = RegionalRecord.forMap(old?.regional, Worlds.mapOf(old));
        if (!old?.held || !parent || !entry?.crop?.parent || !entry.size) return;
        const name = old.name || platform.i18n.localize("FILRODENSWMB.UI.UnnamedWorld");
        const oldName = MapStudio.#oldWorldName(name, new Set([...worlds.values()].map((world) => world.name)));
        if (!(await MapDialogManager.promptCutAgain(name, parent.name || "", oldName))) return;
        // Changes discarded here are still in the studio, so the world is opened again from its save
        const wasDirty = this.isDirty;
        if (!(await this.#closeWorldFirst())) return;
        const parentMapId = entry.sourceMapId && (parent.maps ?? []).some((map) => map.id === entry.sourceMapId) ? entry.sourceMapId : Worlds.mapOf(parent);
        if (!parentMapId) return;

        Inspector.close(this);
        // The studio covered throughout (Ken, 2026-11-20): the parent opens only to be cut from,
        // so it is never seen between the regional world closing and its new cut opening
        this.#cover(platform.i18n.format("FILRODENSWMB.UI.CuttingAgain", { name }));
        try {
            // The world it was cut from, open as it was saved
            if (this.world?.id !== parent.id || wasDirty) {
                this.isDirty = false;
                await this.#startProcessing(platform.i18n.format("FILRODENSWMB.UI.OpeningWorld", { name: parent.name || "" }));
                try {
                    if (!(await this.#loadMap(parentMapId, parent.name))) return;
                } finally {
                    this.#endProcessing();
                }
            }
            await Worlds.rename(old.id, oldName);
            const cut = await this.#cutWorld({ crop: entry.crop.parent, width: entry.size.width, name, infill: this.uiState.regionalInfill === true, align: entry.gridAligned !== false });
            if (cut) await this.#openCutWorld(cut);
            else await Worlds.rename(old.id, name);
        } finally {
            this.#uncover();
        }
    }

    /**
     * Covers the whole studio (world bar, rail, panel and map) with an opaque sheet saying what is
     * happening, for a sequence whose middle steps are not for the user to see (Cut again…).
     * Dialogues still show above it. The map's own processing overlay keeps working under it.
     */
    #cover(message) {
        this.root?.setAttribute("data-fwmb-covering", message);
    }

    #uncover() {
        this.root?.removeAttribute("data-fwmb-covering");
    }

    /** "<name> (old, <date>)", numbered when that name is taken ("… (old, 20/11/2026) 2"). */
    static #oldWorldName(name, taken) {
        const date = new Intl.DateTimeFormat(platform.i18n.lang, { dateStyle: "short" }).format(new Date());
        const base = platform.i18n.format("FILRODENSWMB.UI.CutAgainOldName", { name, date });
        let candidate = base;
        for (let n = 2; taken.has(candidate); n++) candidate = `${base} ${n}`;
        return candidate;
    }

    /**
     * A held regional world's way to its parent's settings (Open parent world settings, on its
     * world pages' held banner and Climate; Ken, 2026-11-20), signposted at each stage: a dialogue
     * says the regional world closes and the world its settings come from (the top of its held
     * chain) opens, asking about unsaved changes too; that world opens on the same page, the world
     * bar showing whose settings are being changed with Back to; Back to returns.
     */
    async openParentSettings() {
        if (!this.world?.held) return;
        const worlds = await Worlds.all();
        const source = WorldRecord.settingsSource(this.world, (id) => worlds.get(id) ?? null);
        const sourceMapId = Worlds.mapOf(source);
        if (!source || source.id === this.world.id || !sourceMapId) return;
        const regionalName = this.world.name || platform.i18n.localize("FILRODENSWMB.UI.UnnamedWorld");
        const choice = await MapDialogManager.promptOpenParentSettings(regionalName, source.name || "", this.isDirty);
        if (choice === "cancel") return;
        if (choice === "save" && !(await this.saveCurrentMap())) return;
        const back = { worldId: this.world.id, mapId: this.currentSaveId, name: regionalName, tool: this.activeTool };
        // The same page or map tool (Climate) on the parent; the overview from anywhere else
        const tool = this.activeTool;
        const onPage = this.inWorld && tool !== "worldCut";
        const onMapTool = !this.inWorld && this.#isMapTool(tool);
        this.isDirty = false;
        Inspector.close(this);
        await this.#startProcessing(platform.i18n.format("FILRODENSWMB.UI.OpeningWorld", { name: source.name || "" }));
        try {
            if (!(await this.#loadMap(sourceMapId, source.name))) return;
        } finally {
            this.#endProcessing();
        }
        this.#backTo = back;
        if (onMapTool) await this.goToMapTool(tool);
        else await this.openWorldTool(onPage ? tool : "worldOverview");
        this.view?.render(["worldbar"]);
        platform.notify.info(platform.i18n.format("FILRODENSWMB.UI.ChangingSettingsFor", { name: regionalName, parent: source.name || "" }));
    }

    /** Where Back to returns (see openParentSettings), until another world is opened. */
    #backTo = null;

    /** Back to <regional world> in the world bar: the open world's changes asked about, then the regional world, on the tool left there. */
    async backToRegional() {
        const back = this.#backTo;
        if (!back) return;
        if (!(await this.#closeWorldFirst())) return;
        this.isDirty = false;
        await this.#startProcessing(platform.i18n.format("FILRODENSWMB.UI.OpeningWorld", { name: back.name }));
        try {
            if (!(await this.#loadMap(back.mapId, back.name))) return;
        } finally {
            this.#endProcessing();
        }
        if (this.definition.isWorldTool(back.tool)) await this.openWorldTool(back.tool);
        else if (this.#isMapTool(back.tool)) await this.goToMapTool(back.tool);
    }

    /**
     * Opens a system file dialogue and imports the chosen map file as a new saved map (see
     * MapTransfer.importMap: the file's data through MapImport, its images and custom pin icons
     * through MapPackage). A file that is refused is reported with the reason, localised.
     */
    async _onImportMapJson(_event, _target) {
        const file = await MapStudio.#chooseFile(".json");
        if (!file) return;

        await this.#startProcessing(platform.i18n.localize("FILRODENSWMB.UI.ImportingMap"));
        try {
            const { name, corrected, missing, unresolvedIcons, released } = await MapTransfer.importMap(file);
            platform.notify.info(platform.i18n.format("FILRODENSWMB.UI.ImportSuccess", { name }));
            // A held regional world whose parent is not saved here arrives as a world of its own
            if (released) platform.notify.info(platform.i18n.format("FILRODENSWMB.UI.ImportReleased", { name }));
            if (corrected > 0) platform.notify.warn(platform.i18n.format("FILRODENSWMB.UI.ImportCorrected", { count: corrected }));
            if (missing > 0) platform.notify.warn(platform.i18n.format("FILRODENSWMB.UI.ImportImagesLeftOut", { count: missing }));
            // Pins on a custom icon the file did not carry (from an older export) fall back to the default
            if (unresolvedIcons > 0) platform.notify.warn(platform.i18n.format("FILRODENSWMB.UI.UnresolvedPinIconsWarning", { count: unresolvedIcons }));
            this.view?.render(["toolbar", "context"]);
        } catch (err) {
            console.error("FWMB | Import Failed:", err);
            platform.notify.error(err instanceof ImportRefusal ? Sanitize.refusalMessage(err, platform.i18n) : platform.i18n.localize("FILRODENSWMB.UI.ImportError"));
        } finally {
            this.#endProcessing();
        }
    }

    /** Back up all maps: every saved map, with its images and custom pin icons, in one zip (see MapTransfer.backUp). */
    async _onBackUpMaps(_event, _target) {
        await MapTransfer.backUp(this.#processingOverlay());
    }

    /** Restore from backup: maps from a backup zip added as new saved maps (see MapTransfer.restore). */
    async _onRestoreBackup(_event, _target) {
        // A zip from Back up all, or the JSON the migration to v5 wrote into the world's data
        const file = await MapStudio.#chooseFile(".zip,.json");
        if (!file) return;
        try {
            if (await MapTransfer.restore(file, this.#processingOverlay())) this.view?.render(["toolbar", "context"]);
        } catch (err) {
            console.error("FWMB | Restore Failed:", err);
            platform.notify.error(err instanceof ImportRefusal ? Sanitize.refusalMessage(err, platform.i18n) : platform.i18n.localize("FILRODENSWMB.UI.ImportError"));
        }
    }

    /**
     * Opens the browser's file chooser and resolves with the chosen file, or null. A chooser
     * closed without a choice fires no event in every browser, so that case simply never resolves
     * the caller's work; nothing is left waiting on it but this promise.
     * @param {string} accept
     * @returns {Promise<File|null>}
     */
    static #chooseFile(accept) {
        return new Promise((resolve) => {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = accept;
            input.addEventListener("change", () => resolve(input.files?.[0] ?? null));
            input.addEventListener("cancel", () => resolve(null));
            input.click();
        });
    }

    /**
     * Prompts the GM to choose which Style Library registries to bundle into a shareable JSON
     * file, then downloads the result. Mirrors #handleMapExport's Blob-download pattern - a
     * client-side file save, no server round trip.
     */
    async _onExportSettings(_event, _target) {
        const categories = MapStudio.STYLE_LIBRARY_CATEGORIES.map(({ key, labelKey }) => {
            const count = (this.uiState[key] || []).length;

            return {
                key,
                labelKey,
                count,
                countLabel:
                    count > 0
                        ? platform.i18n.format("FILRODENSWMB.UI.ExportSettingsCount", { count })
                        : platform.i18n.localize("FILRODENSWMB.UI.ExportSettingsCountEmpty"),
            };
        });

        const content = await platform.templates.render("modules/filrodens-world-map-builder/templates/world/dialogs/export-settings.hbs", { categories });

        const selectedKeys = await platform.dialogs.prompt({
            classes: ["fwmb"],
            title: platform.i18n.localize("FILRODENSWMB.UI.ExportSettings"),
            content: content,
            confirmLabel: platform.i18n.localize("FILRODENSWMB.UI.ActionExport"),
            confirmIcon: "fwmb-icon fwmb-icon--file-export",
            onSubmit: (form) => MapStudio.STYLE_LIBRARY_CATEGORIES.map(({ key }) => key).filter((key) => form.elements[key]?.checked),
        });

        if (!selectedKeys) return; // User cancelled

        if (selectedKeys.length === 0) {
            platform.notify.warn(platform.i18n.localize("FILRODENSWMB.UI.ExportSettingsNoneSelected"));
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
            sizeRevision: FILRODENSWMB.SYMBOLS.REVISION,
            localLevel: true,
            fwmbVersion: platform.module.version,
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
    async _onImportSettings(_event, _target) {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json";

        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            try {
                // The file goes through the same rules as a map's own styles and biomes (see MapImport)
                const { categories, corrected } = MapImport.readStyles(MapImport.parse(await MapImport.readText(file), "notStyles"));
                if (corrected > 0) platform.notify.warn(platform.i18n.format("FILRODENSWMB.UI.ImportCorrected", { count: corrected }));

                const { importedCount, duplicateCount, customBiomesImported } = this.#importStyleLibraryCategories(categories);

                if (importedCount === 0) {
                    const emptyKey = duplicateCount > 0 ? "FILRODENSWMB.UI.ImportSettingsAllDuplicates" : "FILRODENSWMB.UI.ImportSettingsEmpty";
                    platform.notify.warn(platform.i18n.localize(emptyKey));
                    return;
                }

                this.markDirty();
                this.view?.render(["context"]);

                // Unlike Route/Region/Label quick styles - which only affect the map once a user
                // explicitly selects one to paint or create something new with - an imported custom
                // biome's `rules` apply themselves immediately, against terrain that's already been
                // generated. Without this, an imported biome with rules silently doesn't show up
                // until something else happens to trigger a repaint (e.g. opening the Rule Editor
                // and clicking Accept unchanged).
                if (customBiomesImported) this._repaintCanvas();

                const successMessage =
                    duplicateCount > 0
                        ? platform.i18n.format("FILRODENSWMB.UI.ImportSettingsSuccessWithDuplicates", { count: importedCount, duplicates: duplicateCount })
                        : platform.i18n.format("FILRODENSWMB.UI.ImportSettingsSuccess", { count: importedCount });
                platform.notify.info(successMessage);
            } catch (err) {
                console.error("FWMB | Style Library Import Failed:", err);
                platform.notify.error(err instanceof ImportRefusal ? Sanitize.refusalMessage(err, platform.i18n) : platform.i18n.localize("FILRODENSWMB.UI.ImportSettingsError"));
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

        for (const { key } of MapStudio.STYLE_LIBRARY_CATEGORIES) {
            const entries = categories[key];
            if (!Array.isArray(entries) || entries.length === 0) continue;

            const validEntries = entries.filter((entry) => entry && typeof entry === "object" && typeof entry.name === "string");
            if (validEntries.length === 0) continue;

            // A settings file exported before label widths were measured in characters holds
            // pixel widths; convert them first, so they also compare correctly as duplicates
            if (key === "customLabelStyles") validEntries.forEach((entry) => LabelWidth.migrateLabel(entry, LabelWidth.rootFontSize()));

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

            const idAssigned = key === "customBiomes" ? this.#assignSequentialBiomeIds(newEntries) : newEntries.map((entry) => ({ ...entry, id: platform.utils.randomID() }));

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
    /**
     * A world's action, from Worlds' rows and cards or the world inspector (WorldEditor): on the
     * world whose Surface map is `mapId`, named `name`; or, for a world with no maps yet (board
     * N3), the world `worldId` (a map's world is found from it when not given).
     * @param {"load"|"rename"|"duplicate"|"promote"|"export"|"delete"} action
     */
    async worldAction(action, mapId, name, value, worldId = null) {
        const handlers = {
            load: () => (mapId ? this.#handleMapLoad(mapId, name) : this.#handleMaplessLoad(worldId)),
            delete: () => this.#handleMapDelete(mapId, worldId),
            rename: () => this.#handleMapRename(mapId, name, value, worldId),
            duplicate: () => this.#handleMapDuplicate(mapId, name, worldId),
            promote: () => this.#handleMapPromote(mapId, name, worldId),
            // A world with no maps has nothing a world file could hold yet
            export: () => (mapId ? this.#handleMapExport(mapId, name) : null),
        };
        await handlers[action]?.();
    }

    async #handleMapLoad(mapId, name) {
        const canLoad = await this.#gateUnsavedChanges();
        if (!canLoad) return;
        // One processing overlay over the whole opening, the world and its map (Ken, 2026-11-20):
        // the steps between (leaving Worlds, the map's tool, its generation) are not shown
        await this.#startProcessing(platform.i18n.format("FILRODENSWMB.UI.OpeningWorld", { name: name || "" }));
        let opened;
        try {
            opened = await this.#loadMap(mapId, name);
        } finally {
            this.#endProcessing();
        }
        // What asks the user comes once the world is open and shown
        if (opened) {
            await this.#offerFirstOpeningNotice();
            await this.#offerTerrainUpgrade();
        }
    }

    /**
     * The open map's card thumbnail, when its world's record has none (a world made from a 4.3
     * map; S0 step 8d): drawn from the canvas and written to the world's record only (see
     * Worlds.setThumbnail), so the map is not saved and nothing is marked unsaved.
     * @returns {Promise<boolean>} Whether one was written.
     */
    async #drawMissingThumbnail() {
        const world = this.world;
        const entry = world?.maps?.find((map) => map.id === this.currentSaveId && map.type === MAP_TYPES.SURFACE);
        if (!entry || entry.thumbnail) return false;
        const thumbnail = this.canvasEngine?.thumbnail?.();
        if (!thumbnail) return false;
        try {
            const written = await Worlds.setThumbnail(world.id, entry.id, thumbnail);
            if (!written) return false;
            // The open world's record as written, so a later write of it (the first-opening
            // notice's, a save's) keeps the picture
            if (this.world?.id === written.id) this.world = { ...this.world, maps: written.maps };
            return true;
        } catch (error) {
            console.warn("FWMB | The world's thumbnail could not be written:", error);
            return false;
        }
    }

    /**
     * Draw thumbnails, in Worlds' foot (S0 step 8d; see WorldThumbnails): each world without a
     * thumbnail opened in turn to draw one, then the world that was open opened again and Worlds
     * shown.
     */
    async _onDrawThumbnails() {
        const toolBeforeAside = this.#toolBeforeAside;
        await WorldThumbnails.run(this, {
            gate: () => this.#gateUnsavedChanges(),
            open: () => (this.worldOpen && this.world?.id ? { worldId: this.world.id, mapId: this.surfaceMade ? this.currentSaveId : null, name: this.world.name || this.currentSaveName || "" } : null),
            drawOpen: () => this.#drawMissingThumbnail(),
            openQuietly: (mapId, name) => this.#loadMap(mapId, name, { thumbnailOnly: true }),
            hold: (text) => this.#holdProcessingText(text),
            restore: async (open, left) => {
                if (left) {
                    let reopened = false;
                    if (open?.mapId) reopened = await this.#loadMap(open.mapId, open.name, { announce: false });
                    else if (open?.worldId) {
                        const world = await Worlds.get(open.worldId);
                        if (world) {
                            await this.#openMapless(world, { announce: false });
                            reopened = true;
                        }
                    }
                    if (!reopened) {
                        this.#clearMap();
                        this.#closeWorld();
                    }
                }
                await this.switchTool("manage", { force: true });
                // Worlds' Close goes back where it would have before the run
                if (this.worldOpen && toolBeforeAside) this.#toolBeforeAside = toolBeforeAside;
                this.view?.render(["worldbar", "toolbar", "context", "editToolbar"]);
            },
        });
    }

    /**
     * Loads a saved map and its world (see #handleMapLoad); true once it is open.
     * @param {string} mapId
     * @param {string} name
     * @param {{thumbnailOnly?: boolean, announce?: boolean}} [options] - `thumbnailOnly`: opened
     *     only to draw its card's missing thumbnail (Draw thumbnails, see WorldThumbnails), so it
     *     stops there, true only when one was written; `announce`: whether "map loaded" and what
     *     the load converted are said (not when Draw thumbnails opens the world open before it again).
     */
    async #loadMap(mapId, name, { thumbnailOnly = false, announce = true } = {}) {
        // Opened from Worlds: leave it first, so the load draws on the map in view and not on Worlds
        // and its inspector redrawn at every step (which slowed a load to tens of seconds)
        if (this.activeTool === "manage") {
            Inspector.close(this);
            await this._onCloseWorlds();
        }

        this.#forgetPanel();
        // Back to (a held regional world's Open parent world settings) goes once another world opens
        this.#backTo = null;
        // The map's data with its world's settings merged in (see WorldMaps)
        const loaded = await WorldMaps.load(mapId);
        if (loaded) {
            const { payload, world, settings } = loaded;
            this.currentSaveId = mapId;
            this.currentSaveName = name;
            this.world = world;
            this.worldSettingsOpened = settings;
            this.#useWorldIcons(settings?.icons ?? WorldMigration.hostIcons());
            await this.#ingestMapPayload(payload, await platform.store.loadMapOwners(mapId), await platform.store.loadMapModelRun(mapId), { report: announce && !thumbnailOnly });
            // The settings as loaded (the defaults a load fills in included): a save that leaves
            // them so does not raise their revision. Nothing below changes them.
            this.worldSettingsOpened = this.#worldSettingsNow();
            this.#captureEditorBaseline();
            this.inheritedStrokes = world?.held && RegionalRecord.isCurrent(world.regional) ? (RegionalRecord.forMap(world.regional, mapId)?.inheritedStrokes ?? 0) : undefined;
            await this.#refreshStale();
            // A world made from a 4.3 map has no thumbnail until its first save in v5: one is drawn
            // now, from the map as saved, before anything below changes it (S0 step 8d)
            const drawn = await this.#drawMissingThumbnail();
            if (thumbnailOnly) {
                // Nothing of it was changed or is to be asked: what its opening does waits for the
                // next time it is opened
                this.isDirty = false;
                return drawn;
            }
            if (announce) platform.notify.info(platform.i18n.localize("FILRODENSWMB.UI.LoadSuccess"));

            this.view?.render(["toolbar", "context"]);
            // A map migrated or given a new mesh as it opened has changes to save
            this.isDirty = MeshIntegration.changedOnLoad(this);
            // A regional map cut before regional maps carried their parent's run reads it from its
            // parent, so its thematic layers and farmland have figures (kept with its next save)
            if (await ParentRunRecovery.recover(this)) this._repaintVectors();
            // A regional map's inherited river trade routes are laid again over its own rivers,
            // once (kept with its next save), before a fill-in reads them
            if (RiverRelay.needed(this)) {
                this.riverRoutesLaid = true;
                const { laid, removed } = RiverRelay.run(this);
                if (laid + removed) this._repaintVectors();
            }
            // Its inherited ports onto its own coast, and river towns beside its own rivers, once
            // (kept with its next save), before a fill-in reads them
            if (ShoreRelay.needed(this)) {
                this.shoresPlaced = true;
                const { ports, rivers } = ShoreRelay.run(this);
                if (ports + rivers) this._repaintVectors();
            }
            // Filled in now when asked for as it was cut; the map then has changes to save
            if (this.infillPending) {
                this.infillPending = false;
                if (InfillInput.offered(this)) await Infilling.run(this, { ask: false });
            }

            // Offered only once the map is fully generated and marked clean: the check reads the
            // generated climate, and an update applied here must leave the map marked unsaved.
            // The tool it was left on, then, for a world made from a 4.3 map, the notice saying what
            // that means, once
            await this.#openWorldOnItsTool();
            return true;
        }
        return false;
    }

    /**
     * New world… (the world name menu, Worlds, the empty state; S0 step 4c-2, boards N1 and N2):
     * the open world is closed first, asking about its unsaved changes (Close <world> first?);
     * then World setup alone on the world's rail makes the new world's frame, with Create world.
     */
    async _onNewWorld() {
        if (this.#creatingWorld) return;
        if (!(await this.#closeWorldFirst())) return;
        Inspector.close(this);
        this.mapWidth = FILRODENSWMB.DEFAULTS.MAP_WIDTH;
        this.mapHeight = FILRODENSWMB.DEFAULTS.MAP_HEIGHT;
        this.#clearMap();
        this.#closeWorld();
        this.worldOpen = true;
        this.#creatingWorld = true;
        this.#newWorldName = platform.i18n.localize("FILRODENSWMB.UI.NewWorldName");
        this.#worldTool = "worldSetup";
        await this.switchTool("worldSetup", { force: true });
        this.view?.render(["worldbar", "toolbar", "context", "editToolbar"]);
        this.root?.querySelector('.fwmb-context-panel input[name="newWorldName"]')?.focus({ preventScroll: true });
    }

    /** The world being made by New world (board N2): World setup alone, until Create world or Cancel. */
    #creatingWorld = false;

    /** The name a world being made is given at Create world. */
    #newWorldName = "";

    /**
     * Empties the panel as a world is left. It still shows the world being left (a world page's
     * fields, from Open parent world settings, Back to or New world), and nothing of it may be read
     * into the world opening: each tool switch and save reads the panel's fields into the state
     * (MapStateManager.getMapParameters). The next draw fills it for the world opened.
     */
    #forgetPanel() {
        this.root?.querySelector(".fwmb-context-panel")?.replaceChildren();
    }

    /**
     * Closes the open world's state: no world record, no map, no save (the map's state is
     * #clearMap's). Nothing is open after it until a world is opened or made.
     */
    #closeWorld() {
        this.currentSaveId = null;
        this.currentSaveName = null;
        this.currentParentId = null;
        this.world = null;
        this.worldSettingsOpened = null;
        this.inheritedStrokes = undefined;
        this.#useWorldIcons(WorldRecord.emptyIcons());
        this.worldOpen = false;
        this.surfaceMade = false;
        this.#creatingWorld = false;
        this.isDirty = false;
        this.#mapTool = "scene";
        this.#worldTool = "worldOverview";
        this.#toolBeforeAside = null;
        this.#backTo = null;
        this.#staleLines = [];
        this.#showUnmade();
    }

    /**
     * Asks before the open world is closed for a new one (board N1), when it has unsaved changes:
     * Save and close, Discard changes, or Cancel.
     * @returns {Promise<boolean>} Whether to go on.
     */
    async #closeWorldFirst() {
        if (!this.worldOpen || !this.isDirty) return true;
        const name = this.world?.name || this.#saveName || platform.i18n.localize("FILRODENSWMB.UI.UnnamedWorld");
        const choice = await MapDialogManager.promptCloseWorld(name, this.#changedGroupNames());
        if (choice === "save") return await this.saveCurrentMap();
        if (choice === "discard") {
            this.isDirty = false;
            return true;
        }
        return false;
    }

    /**
     * Create world (World setup while a world is being made, board N2): the world is made with its
     * name and frame and no maps, and saved at once, so it is in Worlds whatever happens next; its
     * overview follows, offering to make its Surface map (board N3).
     */
    async _onCreateWorld() {
        if (!this.#creatingWorld) return;
        const { i18n } = platform;
        const name = String(this.root?.querySelector('.fwmb-context-panel input[name="newWorldName"]')?.value ?? this.#newWorldName).trim() || i18n.localize("FILRODENSWMB.UI.NewWorldName");
        const settings = this.#worldSettingsNow();
        await this.#startProcessing(i18n.localize("FILRODENSWMB.UI.SavingMap"));
        let result;
        try {
            result = await Worlds.save({ world: null, name, settings, maps: [] });
        } finally {
            this.#endProcessing();
        }
        if (!result) {
            platform.notify.error(i18n.localize("FILRODENSWMB.UI.SaveError"));
            return;
        }
        this.world = result.world;
        this.currentSaveName = name;
        this.worldSettingsOpened = settings;
        this.#creatingWorld = false;
        this.isDirty = false;
        this.#mapToolWorldId = this.world.id;
        this.#captureEditorBaseline();
        platform.notify.info(i18n.format("FILRODENSWMB.UI.SaveSuccess", { name }));
        await this.switchTool("worldOverview", { force: true });
        this.view?.render(["worldbar", "toolbar", "context"]);
    }

    /** Cancel while a world is being made: nothing was made, and Worlds opens again. */
    async _onCancelNewWorld() {
        if (!this.#creatingWorld) return;
        this.#closeWorld();
        await this.switchTool("manage", { force: true });
        this.view?.render(["worldbar", "toolbar", "context", "editToolbar"]);
    }

    /**
     * Opens a world with no maps yet (Worlds' Open, board N3): its settings in the studio's state,
     * in its frame, with no map made, on its overview.
     * @param {string|null} worldId
     */
    async #handleMaplessLoad(worldId) {
        const world = worldId ? await Worlds.get(worldId) : null;
        if (!world) return;
        if (!(await this.#gateUnsavedChanges())) return;
        await this.#startProcessing(platform.i18n.format("FILRODENSWMB.UI.OpeningWorld", { name: world.name || "" }));
        try {
            await this.#openMapless(world);
        } finally {
            this.#endProcessing();
        }
    }

    async #openMapless(world, { announce = true } = {}) {
        Inspector.close(this);
        const settings = await Worlds.settingsOf(world);
        const frame = settings?.setup?.frame;
        this.mapWidth = Number.isInteger(frame?.width) ? frame.width : FILRODENSWMB.DEFAULTS.MAP_WIDTH;
        this.mapHeight = Number.isInteger(frame?.height) ? frame.height : FILRODENSWMB.DEFAULTS.MAP_HEIGHT;
        this.#closeWorld();
        this.#clearMap();
        // The world's settings read in as a map's load reads them, from an empty map in its frame
        const base = WorldSettings.split(this._buildSavePayload().payload).mapData;
        const payload = WorldSettings.merge(settings, base, { inline: false });
        this.world = world;
        this.currentSaveName = world.name;
        this.worldSettingsOpened = settings;
        this.#useWorldIcons(settings?.icons ?? WorldRecord.emptyIcons());
        await this.#ingestMapPayload(payload, {}, null, { generate: false });
        this.worldSettingsOpened = this.#worldSettingsNow();
        this.#captureEditorBaseline();
        this.isDirty = false;
        this.#mapToolWorldId = world.id;
        await this.switchTool("worldOverview", { force: true });
        this.view?.render(["worldbar", "toolbar", "context", "editToolbar"]);
        if (announce) platform.notify.info(platform.i18n.localize("FILRODENSWMB.UI.LoadSuccess"));
    }

    /**
     * Shows whether the Surface map is made (board N4): with no map, the canvas gives way to a
     * dashed frame in the world's aspect, its size in pixels and km (fwmb-is-unmade on the studio).
     */
    #showUnmade() {
        const root = this.root;
        if (!root) return;
        const unmade = !this.surfaceMade;
        root.classList.toggle("fwmb-is-unmade", unmade);
        const frame = root.querySelector(".fwmb-unmade-frame");
        if (!frame || !unmade) return;
        const width = this.mapWidth;
        const height = this.mapHeight;
        // As large as the map area allows, in the frame's aspect
        frame.style.setProperty("--fwmb-unmade-ratio", String(width / height));
        const size = frame.querySelector("[data-unmade-size]");
        if (size) {
            const { i18n } = platform;
            const km = Math.round(width * kmPerPxOf(this.uiState, height));
            const number = (value) => Number(value).toLocaleString(i18n.lang);
            size.textContent = i18n.format("FILRODENSWMB.UI.UnmadeFrameSize", { width: number(width), height: number(height), distance: Number.isFinite(km) ? number(km) : "?", unit: cleanUnit(this.uiState.mapUnit) });
        }
    }

    /** Export world (the world bar's name menu): the open world as last saved, in a world file (see MapTransfer). */
    async _onExportOpenWorld() {
        if (!this.#saveId) return;
        if (this.isDirty) platform.notify.info(platform.i18n.localize("FILRODENSWMB.UI.ExportWorldSavedOnly"));
        await MapTransfer.exportMap(this.#saveId, this.#saveName ?? this.world?.name ?? "");
    }

    /**
     * The first opening of a world made from a 4.3 map (board W8): what changed, once a world (Ken,
     * 2026-11-18). Seeing it is written to the world's record at once, so the map is not marked
     * unsaved for it. A world with a run opened in Explore; the notice offers Create.
     */
    async #offerFirstOpeningNotice() {
        const world = this.world;
        if (!world?.migration || world.migration.noticed) return;
        const { i18n } = platform;
        const noticed = { ...world, migration: { ...world.migration, noticed: true } };
        this.world = noticed;
        try {
            await platform.store.saveWorld(noticed);
        } catch (error) {
            console.warn("FWMB | The world's first-opening notice could not be marked seen:", error);
        }
        const source = noticed.held ? await this.#heldSourceName() : null;
        const content = await platform.templates.render(`${TEMPLATE_ROOT}world/dialogs/first-opening.hbs`, FirstOpening.context(noticed, { source, link: FILRODENSWMB.HELP.UPDATING_5 }, i18n));
        await platform.dialogs.choose({
            classes: ["fwmb", "fwmb-first-opening"],
            title: i18n.format("FILRODENSWMB.UI.FirstOpeningTitle", { name: noticed.name || this.#saveName || "" }),
            icon: "fwmb-icon fwmb-icon--public",
            content,
            buttons: [{ action: "close", label: i18n.localize("FILRODENSWMB.UI.Close"), default: true }],
            dismissed: "close",
        });
    }

    /** The name of the world a held regional world reads its settings from (the top of its chain). */
    async #heldSourceName() {
        const worlds = await Worlds.all();
        return WorldRecord.settingsSource(worlds.get(this.world.id) ?? this.world, (id) => worlds.get(id) ?? null)?.name ?? null;
    }

    /** The open world's settings as a save would write them (see WorldSettings), with its pin icons. */
    #worldSettingsNow() {
        const { settings } = WorldSettings.split(this._buildSavePayload().payload);
        settings.icons = structuredClone(currentPinIcons() ?? WorldRecord.emptyIcons());
        return settings;
    }

    /**
     * Works out whether the map just loaded would change under the current terrain rules and, if
     * so, offers to update it. A map whose owner chose "don't ask again" is not asked, but the
     * Update Map button (see _onUpdateMapTerrain) stays available for it.
     */
    async #offerTerrainUpgrade() {
        this.terrainUpgrade = await this.#assessTerrainUpgrade();
        if (!this.terrainUpgrade) return;

        this.view?.render(["context"]);
        if (this.uiState.terrainUpgradeDismissed) return;

        const choice = await MapDialogManager.promptTerrainUpgrade(this.terrainUpgrade, true);
        if (choice.apply) await this.#applyTerrainUpgrade();
        else if (choice.dismiss) {
            await TerrainUpgrade.dismiss(this);
            // The notice goes; Map setup's Update button stays for it
            this.view?.render(["context"]);
        }
    }

    /**
     * What updating the open map would change (see TerrainUpgrade.assess), with the processing
     * overlay shown while it is measured. Only the maps TerrainVersion.isUpgradeCandidate names
     * can change, so every other map is answered at once without measuring anything.
     */
    async #assessTerrainUpgrade() {
        if (!TerrainVersion.isUpgradeCandidate(this.uiState, this.tectonicFaults, this.manualRivers)) return null;

        await this.#startProcessing(platform.i18n.localize("FILRODENSWMB.UI.CheckingTerrainUpdate"));
        try {
            return TerrainUpgrade.assess(this);
        } finally {
            this.#endProcessing();
        }
    }

    /**
     * Updates the open map to the current terrain rules, regenerates it and leaves it marked as
     * unsaved, so the update is kept only if the map is saved.
     */
    async #applyTerrainUpgrade() {
        const { plan } = this.terrainUpgrade;
        this.terrainUpgrade = null;

        await TerrainUpgrade.apply(this, plan);
        this.view?.render(["context"]);
        platform.notify.info(platform.i18n.localize("FILRODENSWMB.UI.TerrainUpdateApplied"));
    }

    /**
     * The Update Map button: the same offer as on load, without the "don't ask again" option.
     */
    async _onUpdateMapTerrain(_event, _target) {
        if (!this.terrainUpgrade) return;

        const choice = await MapDialogManager.promptTerrainUpgrade(this.terrainUpgrade, false);
        if (choice.apply) await this.#applyTerrainUpgrade();
    }

    /** The world a saved map belongs to, by its id (null for a map without one). */
    static async #worldIdOf(mapId) {
        return (await platform.store.loadMapMeta(mapId))?.worldId ?? null;
    }

    /**
     * Deletes a saved world and its maps. Its regional worlds stay, each keeping its own: held ones
     * move up to its parent when it is held itself, and are otherwise released as worlds of their
     * own with a copy of the settings they read (see Worlds.delete). The confirmation names them.
     */
    async #handleMapDelete(mapId, knownWorldId = null) {
        const worldId = knownWorldId ?? (await MapStudio.#worldIdOf(mapId));
        const plan = worldId ? await Worlds.deletePlan(worldId) : { movedUp: [], released: [], unlinked: [] };
        const names = (worlds) => worlds.map((world) => world.name).join(", ");
        const notes = [];
        if (plan.released.length) notes.push(platform.i18n.format("FILRODENSWMB.UI.DeleteWorldReleases", { names: names(plan.released) }));
        if (plan.movedUp.length) notes.push(platform.i18n.format("FILRODENSWMB.UI.DeleteWorldMovesUp", { names: names(plan.movedUp) }));
        // Plain text: the dialogue escapes it (see MapDialogManager._confirmDialog)
        const content = notes.length ? [platform.i18n.localize("FILRODENSWMB.UI.DeleteConfirm"), ...notes].join(" ") : undefined;
        const confirmed = await MapDialogManager._confirmDialog(undefined, content, { confirmLabel: platform.i18n.localize("FILRODENSWMB.UI.ActionDeleteWorld") });
        if (!confirmed) return;

        // Deleting the world the inspector shows (Ken, 2026-11-20): the inspector stays open, on
        // the world it was cut from, else on a regional world it held; closed only with neither
        const shown = worldId && Inspector.inspected(this).world === worldId ? WorldsPanel.find(this, worldId) : null;
        const showNext = shown ? (shown.parentId ?? plan.released[0]?.id ?? plan.movedUp[0]?.id ?? null) : null;

        if (worldId) await Worlds.delete(worldId);
        else await platform.store.deleteSavedMap(mapId);
        if ((mapId && this.currentSaveId === mapId) || (worldId && this.world?.id === worldId)) {
            this.currentSaveId = null;
            this.world = null;
            // The open world is gone: nothing is open, and Worlds has nothing to go back to
            this.worldOpen = false;
            this.isDirty = false;
            this.view?.render(["worldbar"]);
        } else if (this.world) {
            // The open world may be one of those moved up or released
            this.world = (await Worlds.get(this.world.id)) ?? this.world;
        }
        await this.view?.render(["context"]);
        if (showNext && (!Inspector.current(this) || Inspector.inspected(this).world === worldId)) WorldsPanel.select(this, showNext);
    }

    /** Renames a world: to the name given (Worlds' inspector), else to one asked for. */
    async #handleMapRename(mapId, name, given, knownWorldId = null) {
        const currentName = name;
        const newName = given ?? (await MapDialogManager._promptTextValue(platform.i18n.localize("FILRODENSWMB.UI.Rename"), platform.i18n.localize("FILRODENSWMB.UI.Name"), currentName, "name", platform.i18n.localize("FILRODENSWMB.UI.Rename")));

        if (newName && newName !== currentName) {
            // The world and its maps (see Worlds.rename)
            const worldId = knownWorldId ?? (await MapStudio.#worldIdOf(mapId));
            if (worldId) await Worlds.rename(worldId, newName);
            else await platform.store.renameSavedMap(mapId, newName);

            const isOpen = (!!mapId && this.currentSaveId === mapId) || (!!worldId && this.world?.id === worldId);
            if (isOpen) {
                this.currentSaveName = newName;
                if (this.world) this.world = { ...this.world, name: newName };
            }
            this.view?.render(isOpen ? ["context", "worldbar"] : ["context"]);
        }
    }

    async #handleMapDuplicate(mapId, name, knownWorldId = null) {
        const copyName = platform.i18n.format("FILRODENSWMB.UI.CopyMapName", { name });
        // The world and its maps, not its regional worlds (see Worlds.copy)
        const worldId = knownWorldId ?? (await MapStudio.#worldIdOf(mapId));
        const copy = worldId ? await Worlds.copy(worldId, copyName) : await platform.store.duplicateSavedMap(mapId, copyName);
        if (!copy) return;
        // Nothing on screen says it was done, so say so, and show the copy where Worlds is open
        platform.notify.info(platform.i18n.format("FILRODENSWMB.UI.DuplicatedAs", { name: copyName }));
        await this.#showMadeWorld(worldId ? copy.id : null);
    }

    /** Draws Worlds again and, where it is open, shows a world just made (a copy, a clone) in the inspector. */
    async #showMadeWorld(worldId) {
        await this.view?.render(["context"]);
        if (worldId && this.activeTool === "manage") WorldsPanel.select(this, worldId);
    }

    async #handleMapPromote(mapId, name, knownWorldId = null) {
        const confirmed = await MapDialogManager._confirmDialog(
            platform.i18n.localize("FILRODENSWMB.UI.Promote"),
            platform.i18n.localize("FILRODENSWMB.UI.PromoteConfirm"),
            { confirmLabel: platform.i18n.localize("FILRODENSWMB.UI.Promote"), destructive: false },
        );
        if (!confirmed) return;

        // Clone as new: a world of its own, with a copy of the settings it read, no longer held or
        // cut from its parent (see Worlds.cloneAsNew); its map no longer names the parent's map
        const worldId = knownWorldId ?? (await MapStudio.#worldIdOf(mapId));
        if (!worldId) return;
        const originalName = name;
        const newName = platform.i18n.format("FILRODENSWMB.UI.StandaloneMapName", { name: originalName });
        const clone = await Worlds.cloneAsNew(worldId, newName);
        if (clone) {
            for (const map of clone.maps) await platform.store.updateMapDataFields(map.id, { parentId: null });
            platform.notify.info(platform.i18n.format("FILRODENSWMB.UI.PromoteSuccess", { name: newName }));
            await this.#showMadeWorld(clone.id);
        }
    }

    /** Export JSON: the map in one file, with its images and custom pin icons (see MapTransfer.exportMap). */
    async #handleMapExport(mapId, name) {
        await MapTransfer.exportMap(mapId, name);
    }

    _onNudgeNoise(event, target) {
        const frame = NoiseTransform.current(this);
        this.#moveNoiseFrame({ ...frame, offsetX: frame.offsetX + Number(target.dataset.dx), offsetY: frame.offsetY + Number(target.dataset.dy) });
    }

    _onNudgeReference(event, target) {
        const dx = Number(target.dataset.dx);
        const dy = Number(target.dataset.dy);

        this.uiState.referenceX += dx;
        this.uiState.referenceY += dy;
        this.#updateReferenceLayer();
    }

    async _onRandomizeSeed(_event, _target) {
        // A seed for the map Map setup makes next, not the open map's (see #terrainChoice)
        this.#terrainChoice = { ...(this.#terrainChoice ?? this.#currentTerrainChoice()), seed: this.#generateRandomSeed() };
        this.view?.render(["context"]);
    }

    /**
     * Generates a random 6-character alphanumeric seed (uppercased). This is the one place this
     * logic lives, so anywhere a blank or randomised map seed is needed (this button, an auto-generated
     * default map name, a blank seed left on the Create/Convert Map dialogue) goes through the same
     * approach rather than each call site inventing its own.
     */
    #generateRandomSeed() {
        // Math.random() is enough here: a seed only needs to differ from map to map, and nothing
        // depends on it being unpredictable
        return Math.random().toString(36).substring(2, 8).toUpperCase(); // NOSONAR
    }

    async _onRedoBrush(_event, _target) {
        await this.#processHistoryStep(false);
    }

    _onRemoveReferenceImage(_event, _target) {
        this.uiState.referenceImage = "";
        this.#updateReferenceLayer();
        this.view?.render(["context"]);
    }

    /** Resetting the pan is a move back to the original offsets, so the content and the undo step follow (see #moveNoiseFrame). */
    _onResetNoisePan(_event, _target) {
        this.#moveNoiseFrame({ ...NoiseTransform.current(this), offsetX: this.defaultUiState["noise.offsetX"], offsetY: this.defaultUiState["noise.offsetY"] });
    }

    /** Resetting the scale is a rescale back to the original, so the content and the undo step follow (see #moveNoiseFrame). */
    _onResetNoiseScale(_event, _target) {
        this.#moveNoiseFrame({ ...NoiseTransform.current(this), scale: this.defaultUiState["noise.elevation.scale"] });
    }

    _onResetReferencePan(_event, _target) {
        this.uiState.referenceX = this.mapWidth / 2;
        this.uiState.referenceY = this.mapHeight / 2;
        this.#updateReferenceLayer();
    }

    _onResetReferenceScale(_event, _target) {
        this.uiState.referenceScale = 1;
        this.#updateReferenceLayer();
    }

    _onResetZoom(_event, _target) {
        this.canvasEngine?.resetCamera();
    }

    async _onSaveMap(event, target) {
        if (target) target.disabled = true;
        await this.saveCurrentMap();
        if (target) target.disabled = false;
    }

    async _onSaveMapAs(event, target) {
        if (target) target.disabled = true;
        await this.saveCurrentMap({ asNew: true });
        if (target) target.disabled = false;
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

        this.#modeChosen(true);
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
        this.#modeChosen(true);
    }

    _onSetFeatureMode(event, target) {
        this.uiState.activeFeatureMode = target.dataset.mode;
        this.activeFaultId = null; // Ends the current fault line natively
        // Select only picks rivers and faults, so it does not edit
        this.#modeChosen(target.dataset.mode !== "select");
    }

    /**
     * Handles manual switching between Point and Route modes via the edit toolbar.
     */
    _onSetInfraMode(event, target) {
        this.uiState.activeInfraMode = target.dataset.mode;
        this.#leaveRouteMode();
        // Switching between Pin and Route keeps editing as it was: while editing, the other one
        // starts in its editing mode (Draw, Place); while viewing, it stays in Select
        const editing = !!this.uiState.isEditMode;
        if (editing && this.#isRouteMode() && RouteTool.mode(this) === "select") this.uiState.routeToolMode = "draw";
        if (editing && PickTool.selecting(this)) PickTool.settleForEditing(this);
        this.#modeChosen(editing);
    }

    /**
     * Leaving Route mode (for Pin mode, or another tool) abandons the route being placed, lets go
     * of the picked route and closes the inspector, so nothing of the Routes tool stays on the
     * map or in the toolbar.
     */
    #leaveRouteMode() {
        RouteTool.cancel(this);
        this.activeRouteId = null;
        RouteTool.updateOverlays(this);
        platform.dialogs.dismiss({ placement: "docked" });
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

        // Select only picks land masks, so it does not edit
        this.#modeChosen(target.dataset.mode !== "select");
    }

    /**
     * Toggles the interactive 3D topography visualisation.
     */
    async _onThreeDView(_event, _target) {
        const overlay = this.root.querySelector("#fwmb-3d-overlay");

        if (!overlay || !this.currentElevationData) return;

        // 1. Exiting 3D Mode
        if (this.scene3D) {
            this.scene3D.destroy();
            this.scene3D = null;

            overlay.classList.add("fwmb-hidden");
            overlay.closest(".fwmb-map-preview")?.classList.remove("fwmb-is-3d");
            this.#syncMapControls();
            this.#applyCanvasInteractivity();

            // The panel and the context bar come back (see the stylesheet's fwmb-is-3d-view)
            this.root.classList.remove("fwmb-is-3d-view");
            this.root.querySelector(".fwmb-map-controls")?.classList.remove("fwmb-hidden");

            this.#updateCanvasHint();
            return;
        }

        // 2. Entering 3D Mode: Teardown state. A land mask completed by leaving the tool has to be
        // generated now, otherwise the 3D scene below would be built from the previous terrain.
        // Changes deferred by the pause toggle need generating for the same reason.
        const hadDeferredChanges = this.#restoreLiveGeneration();
        if (this.#clearActiveDrawingStates() || hadDeferredChanges) await this.generateTerrain();
        await this.#deactivateEditMode();

        // 3. Setup 3D overlay UI
        const mapControls = this.root.querySelector(".fwmb-map-controls");
        overlay.classList.remove("fwmb-hidden");
        // The canvas's overlays (information bar, map controls, undo and redo) belong to the flat
        // map and are hidden while the 3D view covers it; the hint stays, with the 3D view's own
        // gestures, and the 3D view's settings (Relief Emphasis) show in the top-start corner
        overlay.closest(".fwmb-map-preview")?.classList.add("fwmb-is-3d");
        this.#syncReliefEmphasisSlider();

        // The 3D view has no panel and no context bar, so its canvas fills the body beside the rail:
        // a class on the studio (rather than the parts' own styles) so a redraw of either keeps it
        if (mapControls) mapControls.classList.add("fwmb-hidden");
        this.root.classList.add("fwmb-is-3d-view");

        // 4. Generate 3D Scene. The terrain images the flat map was last painted from are
        // current (any pending generation has just run), so the 3D view is built from the same
        // images and settings and matches the flat map's layers and water.
        this.scene3D = new Scene3D(overlay);
        this.scene3D.render3DMap({
            elevation: this.currentElevationData,
            width: this.mapWidth,
            height: this.mapHeight,
            seaLevel: this.uiState["seaLevel"],
            waterMask: this.bufferWaterMask,
            terrain: this.#terrainBuffers(),
            settings: this.#terrainSettings(),
            reliefEmphasis: this.uiState.reliefEmphasis ?? FILRODENSWMB.DISPLAY.THREE_D.RELIEF.EMPHASIS,
            pixelsPerBaseline: ProceduralEngine.pixelsPerBaseline(TerrainVersion.getTerrainParams(this.uiState).world, this.mapWidth, this.mapHeight),
        });
        this.#syncMapControls();

        // The 3D view has its own camera gestures; no render follows this, so refresh directly
        this.#updateCanvasHint();
    }

    /**
     * The 3D view's Relief Emphasis slider shows the map's value (when a map opens, and when the
     * view does): the map region is drawn once, so the slider is set in place rather than by a
     * redraw, and a save reads the value back from it (see MapStateManager.getMapParameters).
     */
    #syncReliefEmphasisSlider() {
        const slider = this.root?.querySelector('.fwmb-3d-controls input[name="reliefEmphasis"]');
        if (!slider) return;
        slider.value = String(this.uiState.reliefEmphasis ?? FILRODENSWMB.DISPLAY.THREE_D.RELIEF.EMPHASIS);
        RangeDisplay.sync(slider);
    }

    /** The state block's Start and Stop button. */
    _onToggleEditMode(_event, _target) {
        this.#setEditing(!this.uiState.isEditMode);
    }

    /**
     * Turns the active tool's editing on or off (uiState.isEditMode): the state block's button, or
     * choosing a mode on the bar (see #modeChosen).
     *
     * @param {boolean} on
     */
    #setEditing(on) {
        if (!this.root?.querySelector(".fwmb-edit-toolbar")) return;
        this.uiState.isEditMode = on;

        if (on) {
            // A guided map's Map setup draws land masks (a crop mode left from 4.3 included)
            if (this.uiState.generationEngine === "guided" && !["addMask", "subtractMask", "coastMask"].includes(this.uiState.sceneMode)) {
                this.uiState.sceneMode = "addMask";
            }

            // Editing starts in an editing mode: a tool left in its Select mode paints or draws
            if (this.activeTool === "regions" && RegionPainter.mode(this) === "select") this.uiState.regionPaintMode = "paint";
            if (this.#isRouteMode() && RouteTool.mode(this) === "select") this.uiState.routeToolMode = "draw";
            if (PickTool.selecting(this)) PickTool.settleForEditing(this);

            RegionPanel.settleActive(this);
        } else {
            this.#returnToSelect();

            // Leaving edit mode ends the pause: the Apply button goes with the editing, so
            // deferred changes are generated now (covering a mask completed below) and the next
            // edit session starts with automatic generation on.
            const hadDeferredChanges = this.#restoreLiveGeneration();
            const maskCompleted = this.#clearActiveDrawingStates();

            if (hadDeferredChanges) this.generateTerrain();
            else if (maskCompleted) this.requestTerrainUpdate();
        }

        this.#applyCanvasInteractivity();

        if (FILRODENSWMB.UI.VECTOR_TOOLS.includes(this.activeTool)) {
            this._repaintVectors();
        }

        this.view?.render(["context", "toolbar", "editToolbar"]);
    }

    /**
     * A mode was chosen on the bar. An editing mode turns editing on; a view mode (Select) turns it
     * off, and the map still takes the clicks that pick objects (see #canvasInteractive).
     *
     * @param {boolean} editing - Whether the chosen mode edits the map.
     */
    #modeChosen(editing) {
        if (editing !== !!this.uiState.isEditMode) {
            this.#setEditing(editing);
            return;
        }
        this.#applyCanvasInteractivity();
        if (FILRODENSWMB.UI.VECTOR_TOOLS.includes(this.activeTool)) this._repaintVectors();
        this.view?.render(["context", "toolbar", "editToolbar"]);
    }

    /**
     * Viewing is the Select mode: when editing stops (or the tool changes), every tool with a
     * Select mode (Regions, Routes, Pins, Labels, Rivers and faults, land masks, Cartography)
     * goes back to it, so the map still picks what is
     * clicked, and the bar never shows an editing mode while nothing is being edited.
     */
    #returnToSelect() {
        this.uiState.regionPaintMode = "select";
        this.uiState.routeToolMode = "select";
        this.uiState.pinToolMode = "select";
        this.uiState.labelToolMode = "select";
        this.uiState.activeFeatureMode = "select";
        this.uiState.sceneMode = "select";
        this.uiState.cartographyMode = "select";
    }

    /**
     * Whether the map takes pointer input for the active tool: while it is editing; always in
     * Cartography (which has no edit toggle: its decorations and scale bar can be moved whenever it
     * is open); and in the Select mode of Regions and of Routes, which pick objects without editing.
     */
    #canvasInteractive() {
        // While an export draws, the map takes no edits: only the camera moves
        if (this.view?.held) return false;
        // A settlement map hides the Surface map's canvas (it has its own)
        if (this.inSettlement) return false;
        if (this.uiState.isEditMode) return true;
        // Cut regional world…'s crop takes the map's drags
        if (this.activeTool === "worldCut") return true;
        if (this.activeTool === "cartography") return true;
        if (this.activeTool === "regions") return RegionPainter.mode(this) === "select";
        if (this.#isRouteMode()) return RouteTool.mode(this) === "select";
        return PickTool.selecting(this);
    }

    /** Brings the canvas's pointer handling (and the regional crop) in line with the tool and mode. */
    #applyCanvasInteractivity() {
        if (!this.canvasEngine) return;
        this.canvasEngine.setEditMode(this.#canvasInteractive());
        // The crop takes over canvas clicks while it is showing, so only in its own mode while editing
        this.canvasEngine.setCropMode?.(this.activeTool === "worldCut");
    }

    _onToggleGrid(_event, _target) {
        this.uiState.gridVisible = !this.uiState.gridVisible;
        this.#updateGrid();
        this.#syncMapControls();

        this.markDirty();
    }

    /**
     * Toggles visibility of the WebGL layers.
     */
    /**
     * The names shown in the engine list, each with its terrain version (for example "Guided v2";
     * see TerrainVersion.getDisplayVersion). The open map's own engine shows the version the map
     * was made with; any other engine shows the version a new map would get, since choosing it
     * creates a new map.
     */
    #getEngineLabels() {
        const current = FILRODENSWMB.TERRAIN_VERSION.CURRENT;
        const labelFor = (engine) => {
            const version = this.uiState.generationEngine === engine ? TerrainVersion.getDisplayVersion(this.uiState) : current;
            return platform.i18n.format("FILRODENSWMB.UI.EngineVersion", { name: platform.i18n.localize(TerrainVersion.ENGINE_NAMES[engine]), version });
        };
        return Object.fromEntries(Object.keys(TerrainVersion.ENGINE_NAMES).map((engine) => [engine, labelFor(engine)]));
    }

    _onToggleLayer(_event, target) {
        const layerId = target.dataset.layer;
        if (!(layerId in this.#layerVisibility) || !this.canvasEngine) return;

        this.#layerVisibility[layerId] = !this.#layerVisibility[layerId];
        this.canvasEngine.toggleLayer(layerId, this.#layerVisibility[layerId]);
        this.#syncMapControls();
    }

    _onToggleLiveFeatureUpdates(_event, _target) {
        this.uiState.liveFeatureUpdates = !this.uiState.liveFeatureUpdates;

        // If turned back on while changes are pending, immediately process them
        // (generateTerrain clears the pending flag itself)
        if (this.uiState.liveFeatureUpdates && this.hasPendingFeatureMath) {
            this.generateTerrain();
        }
        this.view?.render(["editToolbar"]);
    }

    /**
     * Sets the map's detail level (the Detail menu, and a run's starting level): what it hides is
     * neither drawn, picked nor exported. Saved with the map.
     * @param {number} level - One of FILRODENSWMB.DETAIL.LEVELS' values.
     * @param {{repaint?: boolean}} [options] - repaint false when the caller redraws the map itself.
     */
    setDetailLevel(level, { repaint = true } = {}) {
        const valid = DetailLevel.valid(level);
        this.#closeLayerMenu();
        if (valid === DetailLevel.current(this)) return;
        this.uiState.detailLevel = valid;
        this.#syncMapControls();
        if (repaint) this._repaintVectors();
        this.markDirty();
    }

    /**
     * The thematic layer shown and its opacity (see ThematicView), a view saved with the map. The
     * menu stays open, so a layer can be chosen and its opacity set in one visit. Only the
     * thematic layer is drawn again: nothing else on the canvas depends on it.
     * @param {{fill: string|null, opacity: number}|null} next - The new setting, or null for no change.
     * @param {{save?: boolean}} [options] - save: false while the opacity slider is being dragged,
     *     so the map is marked changed once, when it is let go.
     */
    /**
     * Chooses the age the History tool shows (see HistoryView) and draws it. Saved with the map,
     * as a view is.
     */
    #chooseHistoryAge(age) {
        if (!HistoryView.choose(this, age)) return;
        this.markDirty();
        this._repaintVectors();
        this.view?.render(["context"]);
    }

    #setThematic(next, { save = true } = {}) {
        if (next) {
            this.uiState.thematic = next;
            ThematicView.render(this);
            this.#syncMapControls();
        }
        if (save && next) this.markDirty();
    }

    /**
     * A row of the Labels or Regions menu (see ContentRows): All, a label style, a set or a level.
     * Saved with the map; what it hides is neither drawn nor exported.
     */
    #toggleContentRow(target) {
        const { contentGroup, contentKind, contentRow } = target.dataset;
        if (!ContentRows.toggle(this, contentGroup, contentKind, contentRow)) return;
        this.#syncMapControls();
        this._repaintVectors();
        this.markDirty();
    }

    /**
     * The Detail menu's Avoid overlaps: names are placed so they do not cover each other or the
     * pins (see LabelLayout), or drawn at their first place whatever they cover. Saved with the map.
     */
    #toggleLabelOverlaps() {
        this.uiState.avoidLabelOverlaps = this.uiState.avoidLabelOverlaps === false;
        this.canvasEngine?.setLabelOverlapAvoidance(this.uiState.avoidLabelOverlaps);
        this.#syncMapControls();
        this._repaintVectors();
        this.markDirty();
    }

    /**
     * The Detail menu's symbol size: "auto", or one of SYMBOLS.SIZES (see SymbolScale). Every pin
     * and label is drawn again at it. Saved with the map, as the detail level is.
     */
    #setSymbolSize(value) {
        const size = value === "auto" ? null : SymbolScale.valid(value);
        this.#closeLayerMenu();
        if (size === SymbolScale.valid(this.uiState.symbolSize)) return;
        this.uiState.symbolSize = size;
        this.#syncMapControls();
        this._repaintVectors();
        this.markDirty();
    }

    /**
     * Toggles live canvas filters for Player, GM, and Hidden vectors.
     */
    _onToggleViewFilter(event, target) {
        if (!this.canvasEngine) return;

        const filter = target.dataset.filter; // "all", "gm", or "none"
        if (!filter) return;

        this.viewFilters[filter] = !this.viewFilters[filter];
        this.#syncMapControls();

        // Push to canvas and redraw
        this.canvasEngine.setViewFilters(this.viewFilters);
        this._repaintVectors();
    }

    /**
     * Returns the ids of every entity of a given type that Mass Edit can currently offer for
     * selection. For regions that is the regions of the level whose menu started it (see
     * #massEditLevel).
     */
    _getMassEditableIds(type) {
        switch (type) {
            // Every row that matches the list's search and filters, drawn or not (see ListQuery)
            case "pin":
            case "route":
                return ListQuery.matching(this.#listRows(type), ListQuery.of(this, type)).map((row) => row.id);
            case "label":
                return ListQuery.matching(this.#listRows(type), ListQuery.of(this, type))
                    .filter((row) => row.standalone)
                    .map((row) => row.id);
            case "region":
                return RegionPanel.listedRegionIds(this, this.massEditLevelId);
            case "river":
                return (this.manualRivers ?? []).map((river) => river.id);
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

        this.view?.render(["context"]);
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

        this.view?.render(["context"]);
    }

    _onMassEditSelectAll(event, target) {
        const type = target.dataset.type;
        const selection = this.massEditSelection[type];
        if (!selection) return;

        this._getMassEditableIds(type).forEach((id) => selection.add(id));
        this.view?.render(["context"]);
    }

    _onMassEditSelectNone(event, target) {
        const type = target.dataset.type;
        const selection = this.massEditSelection[type];
        if (!selection) return;

        selection.clear();
        this.view?.render(["context"]);
    }

    _onToggleVisibility(event, target) {
        const targetType = target.dataset.target; // "feature" or "label"
        const modified = this.#toggleEntityVisibility(target, targetType);

        if (modified) {
            this._repaintVectors();
            this.view?.render(["context"]);
            this.markDirty();
        }
    }

    /** A generated item's Lock in its list row (see GeneratedEdits.toggleLock): one undo step. */
    _onToggleLock(_event, target) {
        const row = target.closest(".fwmb-list-item");
        if (!row) return;
        const { id, type, layerId } = row.dataset;
        const item = this.#findEntityByType(type, id, layerId);
        if (!item?.generated) return;
        GeneratedEdits.toggleLock(this, item);
        this.view?.render(["context"]);
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
                // A custom river with no label yet (drawn before rivers had labels) has its name hidden
                if (!obj.label && type === "river") obj.label = { visibility: "none" };
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
            river: this.manualRivers,
        };

        if (collections[type]) {
            return collections[type].find((item) => item.id === id);
        }

        // Special handling for nested regions
        if (type === "region") {
            const layer = this.regionLevels.find((l) => l.id === layerId);
            return layer?.regions.find((r) => r.id === id);
        }

        return null;
    }

    #cycleVisibilityState(currentState) {
        const states = FILRODENSWMB.UI.VISIBILITY_STATES;
        const currentIdx = states.indexOf(currentState || "all");
        return states[(currentIdx + 1) % states.length];
    }

    async _onUndoBrush(_event, _target) {
        await this.#processHistoryStep(true);
    }

    _onZoomIn(_event, _target) {
        this.canvasEngine?.zoomCamera(FILRODENSWMB.UI.ZOOM.FACTOR);
    }

    _onZoomOut(_event, _target) {
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
                const layer = this.regionLevels.find((l) => l.id === listItem.dataset.layerId);
                const region = layer?.regions.find((r) => r.id === id);
                // A region on the display mesh has no points: its cells' bounds stand in
                return MeshIntegration.outlinePoints(this, region);
            }
            case "river": {
                const river = this.manualRivers.find((r) => r.id === id);
                return river?.points || [];
            }
            case "route": {
                const route = this.mapRoutes.find((r) => r.id === id);
                return MeshIntegration.outlinePoints(this, route);
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
