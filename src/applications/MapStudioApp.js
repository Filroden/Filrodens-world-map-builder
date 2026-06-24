import { FILRODENSWMB } from "../config.js";
import { StudioCanvas } from "../canvas/StudioCanvas.js";
import { ProceduralEngine } from "../generation/ProceduralEngine.js";
import { BrushEngine } from "../tools/BrushEngine.js";
import { getSavedMaps, loadMapData, saveMapData, deleteSavedMap, renameSavedMap, duplicateSavedMap } from "../data/compendium.js";
import { Scene3D } from "../canvas/Scene3D.js";

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
        actions: {
            addDecoration: MapStudioApp.#onAddDecoration,
            addRegionLayer: MapStudioApp.#onAddRegionLayer,
            adjustNoiseScale: MapStudioApp.#onAdjustNoiseScale,
            adjustReferenceScale: MapStudioApp.#onAdjustReferenceScale,
            applyResolution: MapStudioApp.#onApplyResolution,
            changeTool: MapStudioApp.#onChangeTool,
            deleteDecoration: MapStudioApp.#onDeleteDecoration,
            deleteLabel: MapStudioApp.#onDeleteLabel,
            deletePin: MapStudioApp.#onDeletePin,
            deleteRegion: MapStudioApp.#onDeleteRegion,
            deleteRegionLayer: MapStudioApp.#onDeleteRegionLayer,
            deleteRoute: MapStudioApp.#onDeleteRoute,
            editDecoration: MapStudioApp.#onEditDecoration,
            editLabel: MapStudioApp.#onEditLabel,
            editPin: MapStudioApp.#onEditPin,
            editRegion: MapStudioApp.#onEditRegion,
            editRegionLayer: MapStudioApp.#onEditRegionLayer,
            editRoute: MapStudioApp.#onEditRoute,
            exportPng: MapStudioApp.#onExportPng,
            importMapJson: MapStudioApp.#onImportMapJson,
            manageMap: MapStudioApp.#onManageMapAction,
            nudgeNoise: MapStudioApp.#onNudgeNoise,
            nudgeReference: MapStudioApp.#onNudgeReference,
            randomizeSeed: MapStudioApp.#onRandomizeSeed,
            redoBrush: MapStudioApp.#onRedoBrush,
            removeReferenceImage: MapStudioApp.#onRemoveReferenceImage,
            resetNoisePan: MapStudioApp.#onResetNoisePan,
            resetNoiseScale: MapStudioApp.#onResetNoiseScale,
            resetReferencePan: MapStudioApp.#onResetReferencePan,
            resetReferenceScale: MapStudioApp.#onResetReferenceScale,
            resetZoom: MapStudioApp.#onResetZoom,
            saveMap: MapStudioApp.#onSaveMap,
            selectRegionLayer: MapStudioApp.#onSelectRegionLayer,
            setBrushTool: MapStudioApp.#onSetBrushTool,
            setInfraMode: MapStudioApp.#onSetInfraMode,
            setInfrastructureIcon: MapStudioApp.#onSetInfrastructureIcon,
            setRegionMode: MapStudioApp.#onSetRegionMode,
            setRegionPreset: MapStudioApp.#onSetRegionPreset,
            setRouteStyle: MapStudioApp.#onSetRouteStyle,
            threeDView: MapStudioApp.#onThreeDView,
            toggleEditMode: MapStudioApp.#onToggleEditMode,
            toggleGrid: MapStudioApp.#onToggleGrid,
            toggleLayer: MapStudioApp.#onToggleLayer,
            togglePinDropdown: MapStudioApp.#onTogglePinDropdown,
            toggleRegionSmoothing: MapStudioApp.#onToggleRegionSmoothing,
            toggleSnapping: MapStudioApp.#onToggleSnapping,
            toggleVisibility: MapStudioApp.#onToggleVisibility,
            undoBrush: MapStudioApp.#onUndoBrush,
            zoomIn: MapStudioApp.#onZoomIn,
            zoomOut: MapStudioApp.#onZoomOut,
            zoomToFeature: MapStudioApp.#onZoomToFeature,
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
        },
        map: {
            template: "modules/filrodens-world-map-builder/templates/map.hbs",
            classes: ["fwmb-map"],
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

        this.mapWidth = FILRODENSWMB.DEFAULTS.MAP_WIDTH;
        this.mapHeight = FILRODENSWMB.DEFAULTS.MAP_HEIGHT;

        this.baseElevationData = null;
        this.currentElevationData = null;
        this.currentBiomeOverrides = null;
        this.currentMoistureData = null;
        this.currentTemperatureData = null;
        this.currentRiverData = null;
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
        this.brushEngine = null;

        this.currentSaveId = null;
        this.currentSaveName = null;
        this.isDirty = false;
        this.isSaving = false;

        this.#allocateBuffers();
        this.hasBooted = false;

        this.defaultUiState = {
            mapWidth: FILRODENSWMB.DEFAULTS.MAP_WIDTH,
            mapHeight: FILRODENSWMB.DEFAULTS.MAP_HEIGHT,
            gridType: "square",
            gridSize: 50,
            gridVisible: false,
            brushSize: 20,
            brushStrength: 0.02,
            brushFeather: 0.4,
            brushBiome: 6,

            mapSeed: FILRODENSWMB.DEFAULTS.SEED,
            seaLevel: FILRODENSWMB.DEFAULTS.SEA_LEVEL,
            globalTemp: FILRODENSWMB.DEFAULTS.GLOBAL_TEMP,
            seasonOffset: 0,
            latTop: FILRODENSWMB.DEFAULTS.LAT_TOP,
            latBottom: FILRODENSWMB.DEFAULTS.LAT_BOTTOM,
            globalMoisture: FILRODENSWMB.DEFAULTS.GLOBAL_MOISTURE,
            "noise.offsetX": 0,
            "noise.offsetY": 0,
            "noise.elevation.scale": FILRODENSWMB.NOISE.ELEVATION.SCALE,
            "noise.elevation.octaves": FILRODENSWMB.NOISE.ELEVATION.OCTAVES,
            "noise.elevation.stretch": FILRODENSWMB.NOISE.ELEVATION.STRETCH,
            "noise.moisture.scale": FILRODENSWMB.NOISE.MOISTURE.SCALE,
            "noise.moisture.octaves": FILRODENSWMB.NOISE.MOISTURE.OCTAVES,
            riverDensity: FILRODENSWMB.HYDROLOGY.RIVER_DENSITY,

            contourInterval: FILRODENSWMB.DISPLAY.CONTOUR_INTERVAL,
            biomeAlphaActive: FILRODENSWMB.DISPLAY.BIOME_ALPHA_ACTIVE,
            biomeAlphaInactive: FILRODENSWMB.DISPLAY.BIOME_ALPHA_INACTIVE,
            maxLakeSize: FILRODENSWMB.HYDROLOGY.MAX_LAKE_SIZE,
            springAltOffset: FILRODENSWMB.HYDROLOGY.SPRING_ALTITUDE_OFFSET,
            springMoistMin: FILRODENSWMB.HYDROLOGY.SPRING_MOISTURE_MIN,
            meanderJitter: FILRODENSWMB.HYDROLOGY.MEANDER_JITTER,
            altCooling: FILRODENSWMB.CLIMATE.ALTITUDE_COOLING,
            freezingThreshold: FILRODENSWMB.CLIMATE.FREEZING_THRESHOLD,

            activeIcon: "map_pin",
            activeInfraMode: "pin",
            snapToPoints: true,
            routeColor: "#ffffff",
            routeThickness: 3,
            routeStyle: "solid",
            activeRouteQuickStyle: "custom",

            referenceImage: "",
            referenceAlpha: 0.5,
            referenceScale: 1,
            referenceX: FILRODENSWMB.DEFAULTS.MAP_WIDTH / 2,
            referenceY: FILRODENSWMB.DEFAULTS.MAP_HEIGHT / 2,

            regionPresets: FILRODENSWMB.REGIONS.PRESETS,
            regionFillColor: "#c6af53",
            regionFillStyle: "solid",
            regionLineColor: "#ffffff",
            regionLineThickness: 2,
            regionLineStyle: "solid",
            regionSmoothing: false,
            regionOpacity: 0.5,

            labelFontFamily: FILRODENSWMB.LABELS?.DEFAULT_FONT,
            labelFontSize: FILRODENSWMB.LABELS?.DEFAULT_SIZE,
            labelFillColor: FILRODENSWMB.LABELS?.DEFAULT_COLOR,

            cartographyScaleEnable: false,
            cartographyScaleUnits: "Miles",
            cartographyScaleValue: 1,
            cartographyScaleInterval: 100,
            cartographyScaleMajorTicks: 4,
            cartographyScaleMinorTicks: 4,
            cartographyBorderEnable: false,
            cartographyBorderStyle: "solid",
            cartographyBorderColor: "#000000",
            cartographyScaleX: 50,
            cartographyScaleY: FILRODENSWMB.DEFAULTS.MAP_HEIGHT - 50,
        };

        this.uiState = foundry.utils.deepClone(this.defaultUiState);
        this.customBiomeColors = {};

        this.debouncedGenerateTerrain = foundry.utils.debounce(this.generateTerrain.bind(this), 400);
        this.debouncedGenerateClimate = foundry.utils.debounce(this.generateClimate.bind(this), 200);
        this.debouncedGenerateFeatures = foundry.utils.debounce(this.generateFeatures.bind(this), 200);
    }

    markDirty() {
        this.isDirty = true;
    }

    /**
     * Captures the current state of all non-destructive vector arrays and pushes them to the history stack.
     * Automatically clears the redo stack, as any new action invalidates future redos.
     */
    #pushVectorState() {
        this.pinHistory.push({
            pins: foundry.utils.deepClone(this.mapPins),
            routes: foundry.utils.deepClone(this.mapRoutes),
            regionLayers: foundry.utils.deepClone(this.regionLayers),
            mapLabels: foundry.utils.deepClone(this.mapLabels),
            mapDecorations: foundry.utils.deepClone(this.mapDecorations),
            activeRouteId: this.activeRouteId,
            activeRegionId: this.activeRegionId,
        });
        this.pinRedoStack = [];
    }

    /**
     * Applies RTL directionality if the active language requires it.
     */
    static #applyRTLSupport(element) {
        const rtlLanguages = ["ar", "he", "fa", "ur"];
        // Fallback to "en" if game.i18n is not fully initialised during early render
        const currentLang = game?.i18n?.lang || "en";

        if (!rtlLanguages.includes(currentLang)) return;

        element.setAttribute("dir", "rtl");
        element.classList.add("rtl");
    }

    async _preparePartContext(partId, context, options) {
        context = await super._preparePartContext(partId, context, options);
        context.config = FILRODENSWMB;
        context.activeTool = this.activeTool;

        const rgbToHex = (rgb) => "#" + rgb.map((x) => x.toString(16).padStart(2, "0")).join("");

        context.biomeList = Object.entries(FILRODENSWMB.BIOME_IDS)
            .filter(([key, id]) => id !== 1 && id !== 2)
            .map(([key, id]) => {
                const defaultRgb = FILRODENSWMB.BIOMES[key] || [0, 0, 0];
                const currentRgb = this.customBiomeColors[key] || defaultRgb;

                return {
                    id: id,
                    key: key,
                    label: `FILRODENSWMB.BIOMES.${key}`,
                    hex: rgbToHex(currentRgb),
                };
            });

        context.uiState = this.uiState;
        context.currentSaveName = this.currentSaveName;

        context.infrastructureIcons = Object.entries(FILRODENSWMB.INFRASTRUCTURE_ICONS)
            .map(([id, label]) => ({
                id: id,
                label: label,
                _localized: game.i18n.localize(label),
            }))
            .sort((a, b) => a._localized.localeCompare(b._localized));

        context.routeStyles = Object.entries(FILRODENSWMB.ROUTE_STYLES).map(([id, data]) => ({
            id: id,
            label: data.label,
        }));

        if (partId === "context") {
            context.toolPartial = `modules/filrodens-world-map-builder/templates/tools-${this.activeTool}.hbs`;
            context.mapPins = (this.mapPins || []).filter((p) => !!p.icon);
            context.mapRoutes = this.mapRoutes || [];
            context.mapLabels = this.mapLabels || [];
            context.mapDecorations = this.mapDecorations || [];

            // Extract native Foundry fonts for the UI dropdown
            context.fontFamilies = CONFIG.fontFamilies || ["Signika", "Modesto Condensed", "Arial"];

            // --- Auto-select the first layer if none are currently active ---
            if (this.regionLayers.length > 0 && !this.activeRegionLayerId) {
                this.activeRegionLayerId = this.regionLayers[0].id;
            }

            // Map the layers and inject a boolean flag for the 'active' highlighted state
            context.regionLayers = this.regionLayers.map((layer) => ({
                ...layer,
                isActive: layer.id === this.activeRegionLayerId,
            }));

            // Inject the compendium list dynamically when navigating to the Manage tab
            if (this.activeTool === "manage") {
                context.savedMaps = await getSavedMaps();
            }
        }

        return context;
    }

    _onRender(context, options) {
        super._onRender(context, options);
        MapStudioApp.#applyRTLSupport(this.element);

        if (!this.element.dataset.hasDblClickListener) {
            this.element.addEventListener("dblclick", (event) => {
                const target = event.target;

                if (target.tagName === "INPUT" && target.type === "range") {
                    const defaultVal = this.defaultUiState[target.name];

                    if (defaultVal !== undefined && target.value !== String(defaultVal)) {
                        target.value = defaultVal;

                        if (target.nextElementSibling?.tagName === "OUTPUT") {
                            target.nextElementSibling.value = defaultVal;
                        }

                        target.dispatchEvent(new Event("input", { bubbles: true }));
                    }
                }
            });
            this.element.dataset.hasDblClickListener = "true";
        }

        const container = this.element.querySelector(".fwmb-map-preview");
        if (container && !this.canvasEngine) {
            this.canvasEngine = new StudioCanvas(container);
            this.brushEngine = new BrushEngine(this.mapWidth, this.mapHeight);
            this.#wireBrushCallbacks();
        }

        const contextPanel = this.element.querySelector(".fwmb-context-panel");
        const editToolbar = this.element.querySelector(".fwmb-edit-toolbar");

        if (editToolbar && !editToolbar.dataset.hasListeners) {
            editToolbar.dataset.hasListeners = "true";

            const syncToolbarState = (event) => {
                const target = event.target;
                const name = target.name;

                // Ignore clicks that don't have a specific input name
                if (!name || !(name in this.uiState)) return;

                // 1. Update the central Application State
                if (target.type === "checkbox") {
                    this.uiState[name] = target.checked;
                } else if (target.type === "number" || target.type === "range") {
                    this.uiState[name] = Number(target.value);
                } else {
                    this.uiState[name] = target.value;
                }

                // 2. Live-Update the Active Region
                if (name.startsWith("region") && this.activeRegionId && this.activeRegionLayerId) {
                    const layer = this.regionLayers.find((l) => l.id === this.activeRegionLayerId);
                    const region = layer?.regions.find((r) => r.id === this.activeRegionId);

                    if (region) {
                        region.fillColor = this.uiState.regionFillColor;
                        region.fillStyle = this.uiState.regionFillStyle;
                        region.lineColor = this.uiState.regionLineColor;
                        region.lineThickness = this.uiState.regionLineThickness;
                        region.lineStyle = this.uiState.regionLineStyle;
                        this.#repaintVectors();
                    }
                }

                // 3. Live-Update Region Layer Opacity
                if (name === "regionOpacity" && this.activeRegionLayerId) {
                    const layer = this.regionLayers.find((l) => l.id === this.activeRegionLayerId);
                    if (layer) {
                        layer.opacity = this.uiState.regionOpacity;
                        this.#repaintVectors();
                    }
                }

                // 4. Live-Update the Active Route
                if (name.startsWith("route") && this.activeRouteId) {
                    const route = this.mapRoutes.find((r) => r.id === this.activeRouteId);
                    if (route) {
                        route.color = this.uiState.routeColor;
                        route.thickness = this.uiState.routeThickness;
                        route.style = this.uiState.routeStyle;
                        this.#repaintVectors();
                    }
                }
            };

            // Bind the listener to both continuous slides (input) and final clicks (change)
            editToolbar.addEventListener("input", syncToolbarState);
            editToolbar.addEventListener("change", syncToolbarState);
        }

        if (contextPanel && !contextPanel.dataset.hasNoiseListeners) {
            contextPanel.addEventListener("change", (event) => {
                if (event.target.matches('file-picker[name="referenceImage"]')) {
                    this.uiState.referenceImage = event.target.value;
                    this.#updateReferenceLayer();
                }
            });

            contextPanel.addEventListener("input", (event) => {
                if (event.target.matches('[name^="cartography"]')) {
                    const t = event.target;
                    this.uiState[t.name] = t.type === "checkbox" ? t.checked : t.type === "number" ? Number(t.value) : t.value;
                    this.#repaintVectors();
                    this.markDirty();
                    return;
                }

                if (event.target.matches('input[name="referenceAlpha"]')) {
                    this.uiState.referenceAlpha = Number(event.target.value);
                    this.#updateReferenceLayer();
                    return;
                }

                if (event.target.matches('[name="gridType"], input[name="gridSize"]')) {
                    this.#getMapParameters();
                    this.#updateGrid();
                    return;
                }

                if (event.target.matches('input[type="color"]')) {
                    const biomeKey = event.target.dataset.biome;
                    const hex = event.target.value;
                    const rgb = [Number.parseInt(hex.slice(1, 3), 16), Number.parseInt(hex.slice(3, 5), 16), Number.parseInt(hex.slice(5, 7), 16)];
                    this.customBiomeColors[biomeKey] = rgb;
                    this.#repaintCanvas();
                    return;
                }

                if (event.target.matches('input[name="biomeAlphaActive"], input[name="biomeAlphaInactive"]')) {
                    this.#getMapParameters();
                    this.#updateBiomeOpacity();
                    return;
                }

                if (event.target.matches('input[name="contourInterval"]')) {
                    this.#getMapParameters();
                    this.#repaintCanvas();
                    return;
                }

                if (event.target.matches('input[name="routeColor"], input[name="routeThickness"], select[name="routeStyle"]')) {
                    this.uiState.activeInfraMode = "route";
                    this.uiState.activeRouteQuickStyle = "custom";
                    this.#syncInfraModeButtons();
                    this.#getMapParameters();

                    if (this.activeRouteId) {
                        const activeRoute = this.mapRoutes.find((r) => r.id === this.activeRouteId);
                        if (activeRoute) {
                            activeRoute.color = this.uiState.routeColor;
                            activeRoute.thickness = this.uiState.routeThickness;
                            activeRoute.style = this.uiState.routeStyle;
                            this.#repaintVectors();
                        }
                    }
                    return;
                }

                if (event.target.matches('input[name^="noise.elevation"], input[name^="noise.offsetX"], input[name^="noise.offsetY"]')) {
                    this.debouncedGenerateTerrain();
                } else if (
                    event.target.matches(
                        'input[name="seaLevel"], input[name^="noise.moisture"], input[name="globalTemp"], input[name="globalMoisture"], input[name="latTop"], input[name="latBottom"], input[name="seasonOffset"], input[name="altCooling"], input[name="freezingThreshold"]',
                    )
                ) {
                    this.debouncedGenerateClimate();
                } else if (event.target.matches('input[name="riverDensity"], input[name="maxLakeSize"], input[name="springAltOffset"], input[name="springMoistMin"], input[name="meanderJitter"]')) {
                    this.debouncedGenerateFeatures();
                }
            });
            contextPanel.dataset.hasNoiseListeners = "true";
        }

        if (this.canvasEngine) {
            this.canvasEngine.onCanvasHover = (x, y) => {
                const isBrushActive = this.activeTool === "terrain" || this.activeTool === "biomes" || this.activeTool === "features";
                const showCursor = this.canvasEngine.isEditMode && isBrushActive && !this.canvasEngine.isDragging;
                this.canvasEngine.updateBrushCursor(x, y, this.uiState.brushSize, showCursor);

                // --- Update Canvas Readout ---
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

        if (!this.hasBooted) {
            this.hasBooted = true;
            const layerBtns = this.element.querySelectorAll('[data-action="toggleLayer"]');
            for (const btn of layerBtns) {
                btn.classList.add("active");
            }

            setTimeout(() => this.generateTerrain(), 50);
        }

        if (this.canvasEngine?.isEditMode) {
            const editBtn = this.element.querySelector('[data-action="toggleEditMode"]');
            if (editBtn) editBtn.classList.add("active");
        }
    }

    async close(options) {
        const canClose = await this.#gateUnsavedChanges();
        if (!canClose) return; // Abort closure entirely

        if (this.canvasEngine) this.canvasEngine.destroy();
        if (this.scene3D) this.scene3D.destroy();
        return super.close(options);
    }

    #wireBrushCallbacks() {
        const getNum = (name) => Number.parseFloat(this.element.querySelector(`input[name="${name}"]`)?.value) || 0;

        this.canvasEngine.onBrushStart = (x, y) => {
            let layer = "terrain";
            if (this.activeTool === "biomes") layer = "biome";
            if (this.activeTool === "features") layer = "features";
            if (this.activeTool === "infrastructure") layer = "infrastructure";
            if (this.activeTool === "regions") layer = "regions";
            if (this.activeTool === "labels") layer = "labels";
            if (this.activeTool === "cartography") layer = "cartography";

            let tool = this.element.querySelector(`.fwmb-brush-tools button.active[data-tool-group~="${this.activeTool}"]`)?.dataset.tool || "raise";

            if (layer === "features" && ["addSpring", "blockSpring", "erasePin"].includes(tool)) {
                // Allow clicking massive block zones, but keep a minimum 8px target for tiny pins
                const clickedIndex = this.mapPins.findIndex((p) => {
                    const r = p.radius || 6;
                    return Math.hypot(p.x - x, p.y - y) <= Math.max(r, 8);
                });

                this.#pushVectorState();

                if (tool === "erasePin") {
                    if (clickedIndex > -1) this.mapPins.splice(clickedIndex, 1);
                } else {
                    const pinType = tool === "addSpring" ? "spring" : "block_spring";
                    const radius = tool === "blockSpring" ? getNum("brushSize") : 6;

                    // Don't overwrite if placing a blocker, allow overlapping blockers for coverage
                    if (clickedIndex > -1 && tool !== "blockSpring") {
                        this.mapPins[clickedIndex].type = pinType;
                        this.mapPins[clickedIndex].radius = radius;
                    } else {
                        this.mapPins.push({ id: foundry.utils.randomID(), x, y, type: pinType, radius: radius });
                    }
                }

                this.#repaintCanvas();
                this.debouncedGenerateClimate();
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
                if (!this.canvasEngine.isEditMode) return;

                this.#pushVectorState();

                this.mapLabels.push({
                    id: foundry.utils.randomID(),
                    name: "New Label",
                    x: x,
                    y: y,
                    rotation: 0,
                    fontFamily: this.uiState.labelFontFamily,
                    fontSize: this.uiState.labelFontSize,
                    fillColor: this.uiState.labelFillColor,
                    hidden: false,
                });

                this.#repaintVectors();
                this.render({ parts: ["context"] });
                this.markDirty();
                return;
            }

            if (layer === "cartography") {
                return;
            }

            let paintValue = layer === "biome" ? Number.parseInt(this.element.querySelector('select[name="brushBiome"]')?.value) || 6 : null;
            this.brushEngine.startStroke(layer, tool, getNum("brushSize"), getNum("brushStrength"), getNum("brushFeather"), paintValue);
            this.#applyBrushStroke(x, y);
        };

        this.canvasEngine.onReferencePan = (dx, dy) => {
            this.uiState.referenceX += dx;
            this.uiState.referenceY += dy;
            this.#updateReferenceLayer();
        };

        this.canvasEngine.onReferenceScale = (factor) => {
            this.uiState.referenceScale *= factor;
            this.uiState.referenceScale = Math.max(0.1, Math.min(this.uiState.referenceScale, 10));
            this.#syncDOMToState();
            this.#updateReferenceLayer();
        };

        this.canvasEngine.onBrushMove = (x, y) => {
            this.#applyBrushStroke(x, y);

            // Track the mouse while actively painting
            const isBrushActive = this.activeTool === "terrain" || this.activeTool === "biomes" || this.activeTool === "features";
            if (this.canvasEngine.isEditMode && isBrushActive) {
                this.canvasEngine.updateBrushCursor(x, y, this.uiState.brushSize, true);
            }
        };

        this.canvasEngine.onBrushEnd = () => {
            this.brushEngine.endStroke();
            this.markDirty();
        };

        this.canvasEngine.onInfraDragStart = () => {
            this.#pushVectorState();
        };

        this.canvasEngine.onInfraDrag = () => {
            this.canvasEngine.clearInteractiveTargets();

            const isEdit = this.canvasEngine.isEditMode;
            const infraPins = this.mapPins.filter((p) => !!p.icon);

            // --- Isolate the edit state to the active tool ---
            const isInfraEdit = this.activeTool === "infrastructure" && isEdit;
            this.canvasEngine.renderInfrastructure(infraPins, this.mapRoutes, isInfraEdit);

            const isRegionEdit = this.activeTool === "regions" && isEdit;
            this.canvasEngine.renderRegions(this.regionLayers, isRegionEdit, this.activeRegionId);

            if (this.activeTool === "features") {
                this.canvasEngine.renderRiverVectors(this.currentRiverData?.vectors, this.mapPins, isEdit, this.bufferWaterMask);
            }

            if (this.activeTool === "labels") {
                this.canvasEngine.renderLabels(this.mapLabels, this.mapPins, this.mapRoutes, this.regionLayers, isEdit);
            }

            if (this.activeTool === "cartography" && this.canvasEngine.renderCartography) {
                this.canvasEngine.renderCartography(this.mapDecorations, this.uiState, this.mapWidth, this.mapHeight, isEdit);
            }
        };
        this.canvasEngine.onInfraDragEnd = () => {
            this.render({ parts: ["context"] });
            this.markDirty();

            if (this.activeTool === "features") this.debouncedGenerateClimate();
        };

        this.canvasEngine.onInfraInsertNode = (x, y) => {
            if (this.activeTool !== "infrastructure" && this.activeTool !== "regions") return;
            if (x < 0 || x > this.mapWidth || y < 0 || y > this.mapHeight) return;

            for (const route of this.mapRoutes) {
                for (const pt of route.points) {
                    if (Math.hypot(pt.x - x, pt.y - y) < 15) return;
                }
            }
            for (const pin of this.mapPins) {
                if (!pin.hidden && pin.icon && Math.hypot(pin.x - x, pin.y - y) < 15) return;
            }

            // 1. Try to insert into a Route
            const routeSegment = this.#getClosestRouteSegment(x, y);
            if (routeSegment && this.activeTool === "infrastructure") {
                this.#pushVectorState();
                routeSegment.route.points.splice(routeSegment.insertIndex, 0, { x: routeSegment.projX, y: routeSegment.projY });
                this.#repaintVectors();
                this.render({ parts: ["context"] });
                this.markDirty();
                return;
            }

            // 2. Try to insert into a Region
            const regionSegment = this.#getClosestRegionSegment(x, y);
            if (regionSegment && this.activeTool === "regions") {
                this.#pushVectorState();
                regionSegment.region.points.splice(regionSegment.insertIndex, 0, { x: regionSegment.projX, y: regionSegment.projY });
                this.#repaintVectors();
                this.render({ parts: ["context"] });
                this.markDirty();
            }
        };

        this.canvasEngine.onInfraDeleteNode = (target) => {
            if (this.activeTool !== "infrastructure" && this.activeTool !== "regions" && this.activeTool !== "features") return;
            if (target.icon && this.activeTool !== "infrastructure") return;

            // 1. Check Routes
            if (this.activeTool === "infrastructure") {
                for (let i = 0; i < this.mapRoutes.length; i++) {
                    const route = this.mapRoutes[i];
                    const nodeIndex = route.points.indexOf(target);

                    if (nodeIndex > -1) {
                        this.#pushVectorState();
                        route.points.splice(nodeIndex, 1);
                        if (route.points.length < 2) {
                            this.mapRoutes.splice(i, 1);
                            if (this.activeRouteId === route.id) this.activeRouteId = null;
                        }
                        this.#repaintVectors();
                        this.render({ parts: ["context"] });
                        this.markDirty();
                        return;
                    }
                }
            }

            // 2. Check Regions
            if (this.activeTool === "regions") {
                for (const layer of this.regionLayers) {
                    for (let j = 0; j < layer.regions.length; j++) {
                        const region = layer.regions[j];
                        const nodeIndex = region.points.indexOf(target);

                        if (nodeIndex > -1) {
                            this.#pushVectorState();
                            region.points.splice(nodeIndex, 1);

                            // Garbage collect empty/invalid polygons
                            if (region.points.length < 3 && this.activeRegionId !== region.id) {
                                layer.regions.splice(j, 1);
                            }

                            this.#repaintVectors();
                            this.render({ parts: ["context"] });
                            this.markDirty();
                            return;
                        }
                    }
                }
            }

            // 3. Check Features
            if (this.activeTool === "features" && (target.type === "spring" || target.type === "block_spring")) {
                const nodeIndex = this.mapPins.indexOf(target);
                if (nodeIndex > -1) {
                    this.#pushVectorState();
                    this.mapPins.splice(nodeIndex, 1);
                    this.#repaintCanvas();
                    this.debouncedGenerateClimate();
                    this.markDirty();
                    return;
                }
            }

            // 4. Check Custom Labels
            if (this.activeTool === "labels") {
                const nodeIndex = this.mapLabels.indexOf(target);
                if (nodeIndex > -1) {
                    this.#pushVectorState();
                    this.mapLabels.splice(nodeIndex, 1);
                    this.#repaintVectors();
                    this.render({ parts: ["context"] });
                    this.markDirty();
                    return;
                }
            }

            this.markDirty();
        };
    }

    #getMapParameters() {
        for (const key of Object.keys(this.uiState)) {
            const input = this.element.querySelector(`[name="${key}"]`);
            if (!input) continue;

            if (key === "mapSeed" || key === "gridType") {
                this.uiState[key] = input.value;
            } else {
                const parsed = Number.parseFloat(input.value);
                if (!Number.isNaN(parsed)) {
                    this.uiState[key] = parsed;
                }
            }
        }

        const params = {
            seaLevel: this.uiState["seaLevel"],
            globalTemp: this.uiState["globalTemp"],
            seasonOffset: this.uiState["seasonOffset"],
            latTop: this.uiState["latTop"],
            latBottom: this.uiState["latBottom"],
            globalMoisture: this.uiState["globalMoisture"],
            riverDensity: this.uiState["riverDensity"],
            noise: {
                offsetX: this.uiState["noise.offsetX"],
                offsetY: this.uiState["noise.offsetY"],
                elevation: {
                    scale: 1 / this.uiState["noise.elevation.scale"],
                    octaves: this.uiState["noise.elevation.octaves"],
                    stretch: this.uiState["noise.elevation.stretch"],
                },
                moisture: {
                    scale: 1 / this.uiState["noise.moisture.scale"],
                    octaves: this.uiState["noise.moisture.octaves"],
                },
                temperature: {
                    scale: 1 / FILRODENSWMB.NOISE.TEMPERATURE.SCALE,
                    octaves: FILRODENSWMB.NOISE.TEMPERATURE.OCTAVES,
                },
            },
            hydrology: {
                maxLakeSize: this.uiState["maxLakeSize"],
                springAltOffset: this.uiState["springAltOffset"],
                springMoistMin: this.uiState["springMoistMin"],
                meanderJitter: this.uiState["meanderJitter"],
            },
            climate: {
                altCooling: this.uiState["altCooling"],
                freezingThreshold: this.uiState["freezingThreshold"],
            },
            customColors: this.customBiomeColors,
            display: {
                contourInterval: this.uiState["contourInterval"],
                biomeAlphaActive: this.uiState["biomeAlphaActive"],
                biomeAlphaInactive: this.uiState["biomeAlphaInactive"],
            },
            cartography: {
                scaleEnable: this.uiState.cartographyScaleEnable,
                scaleUnits: this.uiState.cartographyScaleUnits,
                scaleInterval: this.uiState.cartographyScaleInterval,
                scaleValue: this.uiState.cartographyScaleValue,
                scaleMajorTicks: this.uiState.cartographyScaleMajorTicks,
                scaleMinorTicks: this.uiState.cartographyScaleMinorTicks,
                scaleX: this.uiState.cartographyScaleX,
                scaleY: this.uiState.cartographyScaleY,
                borderEnable: this.uiState.cartographyBorderEnable,
                borderStyle: this.uiState.cartographyBorderStyle,
                borderColor: this.uiState.cartographyBorderColor,
            },
        };

        return { currentSeed: this.uiState["mapSeed"], params };
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

    async #repaintCanvas() {
        if (!this.currentElevationData) return;

        const seaLevel = this.uiState["seaLevel"];
        const { currentSeed, params } = this.#getMapParameters();
        const engine = new ProceduralEngine(currentSeed);
        const waterMask = this.bufferWaterMask;

        engine.createBaseMap(this.currentElevationData, this.mapWidth, this.mapHeight, seaLevel, this.bufferBase);
        this.canvasEngine.renderPixelBuffer("base", this.bufferBase, this.mapWidth, this.mapHeight);

        const baseBtn = this.element.querySelector('[data-layer="base"]');
        this.canvasEngine.toggleLayer("base", baseBtn ? baseBtn.classList.contains("active") : true);

        engine.colorize(this.currentElevationData, this.currentTemperatureData, this.mapWidth, this.mapHeight, seaLevel, waterMask, params, this.bufferTopography);
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
            );
            this.canvasEngine.renderPixelBuffer("biomes", this.bufferBiomes, this.mapWidth, this.mapHeight);

            const biomesBtn = this.element.querySelector('[data-layer="biomes"]');
            this.canvasEngine.toggleLayer("biomes", biomesBtn ? biomesBtn.classList.contains("active") : true);
        }

        const contourInterval = this.uiState["contourInterval"];
        engine.createContourMap(this.currentElevationData, this.mapWidth, this.mapHeight, contourInterval, seaLevel, this.bufferContours);
        this.canvasEngine.renderPixelBuffer("contours", this.bufferContours, this.mapWidth, this.mapHeight);

        if (this.canvasEngine) {
            this.canvasEngine.clearInteractiveTargets();
        }

        // Render all non-destructive vector layers on top of the pixel maps
        this.#repaintVectors();
    }

    #repaintVectors() {
        if (!this.canvasEngine) return;

        // Clear old interactive targets before redrawing
        this.canvasEngine.clearInteractiveTargets();
        const isEditModeActive = this.canvasEngine.isEditMode;

        // 1. Render Rivers & Springs
        if (this.currentRiverData?.vectors) {
            const showPins = this.activeTool === "features" && isEditModeActive;
            this.canvasEngine.renderRiverVectors(this.currentRiverData.vectors, this.mapPins, showPins, this.bufferWaterMask);
        }

        // 2. Render Infrastructure
        const isInfraEdit = this.activeTool === "infrastructure" && isEditModeActive;
        const infraPins = this.mapPins.filter((p) => !!p.icon);
        this.canvasEngine.renderInfrastructure(infraPins, this.mapRoutes, isInfraEdit);

        // 3. Render Regions
        const isRegionEdit = this.activeTool === "regions" && isEditModeActive;
        this.canvasEngine.renderRegions(this.regionLayers, isRegionEdit, this.activeRegionId);

        // 4. Render Labels
        const isLabelEdit = this.activeTool === "labels" && isEditModeActive;
        this.canvasEngine.renderLabels(this.mapLabels, this.mapPins, this.mapRoutes, this.regionLayers, isLabelEdit);

        // 5. Render Cartography
        const isCartographyEdit = this.activeTool === "cartography" && isEditModeActive;
        if (this.canvasEngine.renderCartography) {
            this.canvasEngine.renderCartography(this.mapDecorations, this.uiState, this.mapWidth, this.mapHeight, isCartographyEdit);
        }
    }

    #applyBrushStroke(x, y) {
        if (!this.currentElevationData) return;
        const seaLevel = this.uiState["seaLevel"];

        if (this.brushEngine.applyBrush(x, y, this.currentElevationData, this.currentBiomeOverrides, this.currentSpringOverrides, seaLevel)) {
            this.#repaintCanvas();
            this.debouncedGenerateClimate();
        }
    }

    async #rebuildFromHistory() {
        const { params } = this.#getMapParameters();

        this.currentElevationData.set(this.baseElevationData);
        this.currentBiomeOverrides.fill(0);
        this.brushEngine.replayHistory(this.currentElevationData, this.currentBiomeOverrides, params.seaLevel);
    }

    async generateTerrain() {
        const { currentSeed, params } = this.#getMapParameters();
        const engine = new ProceduralEngine(currentSeed);

        console.log("World Map Builder | Generating Topography...");
        const t0 = performance.now();

        engine.generateTopography(this.mapWidth, this.mapHeight, params, this.baseElevationData);

        await this.#rebuildFromHistory();

        this.currentSpringOverrides.fill(0);

        const t1 = performance.now();
        console.log(`World Map Builder | Topography generated in ${(t1 - t0).toFixed(2)}ms`);

        await this.generateClimate();
    }

    async generateClimate() {
        if (!this.currentElevationData) return;
        const { currentSeed, params } = this.#getMapParameters();
        const engine = new ProceduralEngine(currentSeed);

        console.log("World Map Builder | Generating Climate Data...");
        const t0 = performance.now();

        engine.generateClimateData(this.currentElevationData, this.mapWidth, this.mapHeight, params, this.currentMoistureData, this.currentTemperatureData);

        const t1 = performance.now();
        console.log(`World Map Builder | Climate mapped in ${(t1 - t0).toFixed(2)}ms`);

        await this.generateFeatures();
    }

    async generateFeatures() {
        if (!this.currentElevationData) return;
        const { currentSeed, params } = this.#getMapParameters();
        const engine = new ProceduralEngine(currentSeed);

        console.log("World Map Builder | Generating Features...");
        const t0 = performance.now();

        this.currentRiverData = engine.generateRivers(
            this.currentElevationData,
            this.currentMoistureData,
            this.currentTemperatureData,
            this.mapPins,
            this.mapWidth,
            this.mapHeight,
            params,
            this.bufferRiverMap,
            this.bufferWaterMask,
        );

        const t1 = performance.now();
        console.log(`World Map Builder | Features generated in ${(t1 - t0).toFixed(2)}ms`);

        await this.#repaintCanvas();
    }

    async #ingestMapPayload(payload) {
        this.uiState.mapSeed = payload.seed;

        this.mapWidth = payload.mapWidth;
        this.mapHeight = payload.mapHeight;
        this.uiState.mapWidth = this.mapWidth;
        this.uiState.mapHeight = this.mapHeight;
        this.uiState.gridType = payload.gridType || "square";
        this.uiState.gridSize = payload.gridSize || 100;

        this.#allocateBuffers();

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

        this.uiState["noise.offsetX"] = p.noise.offsetX;
        this.uiState["noise.offsetY"] = p.noise.offsetY;
        this.uiState["noise.elevation.scale"] = Math.round(1 / p.noise.elevation.scale);
        this.uiState["noise.elevation.octaves"] = p.noise.elevation.octaves;
        this.uiState["noise.elevation.stretch"] = p.noise.elevation.stretch;
        this.uiState["noise.moisture.scale"] = Math.round(1 / p.noise.moisture.scale);
        this.uiState["noise.moisture.octaves"] = p.noise.moisture.octaves;

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

        this.customBiomeColors = p.customColors || {};
        this.mapPins = payload.mapPins || [];
        this.mapRoutes = payload.mapRoutes || [];
        this.regionLayers = payload.regionLayers || [];
        this.mapLabels = payload.mapLabels || [];
        this.mapDecorations = payload.mapDecorations || [];

        this.brushEngine.history = payload.history || [];
        this.brushEngine.redoStack = [];
        this.pinHistory = [];
        this.pinRedoStack = [];

        this.#syncDOMToState();
        this.#updateGrid();

        await this.generateTerrain();
        this.canvasEngine.resetCamera();
    }

    #syncDOMToState() {
        for (const [key, value] of Object.entries(this.uiState)) {
            const input = this.element.querySelector(`[name="${key}"]`);
            if (!input) continue;

            // --- Safely route specific input types ---
            if (input.type === "color" && value === "transparent") {
                input.value = "#000000"; // Fallback to silence browser warning
            } else if (input.type === "checkbox") {
                input.checked = Boolean(value);
            } else {
                input.value = value;
            }

            if (input.nextElementSibling?.tagName === "OUTPUT") {
                input.nextElementSibling.value = value;
            }
        }

        for (const [key, rgb] of Object.entries(this.customBiomeColors)) {
            const input = this.element.querySelector(`input[data-biome="${key}"]`);
            if (!input) continue;

            input.value = "#" + rgb.map((x) => x.toString(16).padStart(2, "0")).join("");
        }
    }

    #allocateBuffers() {
        const totalPixels = this.mapWidth * this.mapHeight;

        this.baseElevationData = new Float32Array(totalPixels);
        this.currentElevationData = new Float32Array(totalPixels);
        this.currentMoistureData = new Float32Array(totalPixels);
        this.currentTemperatureData = new Float32Array(totalPixels);
        this.currentBiomeOverrides = new Uint8Array(totalPixels);
        this.currentSpringOverrides = new Uint8Array(totalPixels);
        this.bufferRiverMap = new Uint8Array(totalPixels);
        this.bufferWaterMask = new Float32Array(totalPixels);

        this.bufferBase = new Uint8Array(totalPixels * 4);
        this.bufferTopography = new Uint8Array(totalPixels * 4);
        this.bufferBiomes = new Uint8Array(totalPixels * 4);
        this.bufferContours = new Uint8Array(totalPixels * 4);
    }

    #getSnappedCoordinates(x, y, threshold = 20) {
        let closest = { x, y, dist: Infinity };

        for (const pin of this.mapPins) {
            if (pin.hidden || !pin.icon) continue;

            const dist = Math.hypot(pin.x - x, pin.y - y);
            if (dist < closest.dist && dist <= threshold) {
                closest = { x: pin.x, y: pin.y, dist };
            }
        }

        return closest.dist === Infinity ? { x, y } : { x: closest.x, y: closest.y };
    }

    #handleInfrastructureClick(x, y) {
        if (x < 0 || x > this.mapWidth || y < 0 || y > this.mapHeight) return;

        this.#pushVectorState();

        const finalPos = this.uiState.snapToPoints ? this.#getSnappedCoordinates(x, y) : { x, y };

        if (this.uiState.activeInfraMode === "pin") {
            const newPin = {
                id: foundry.utils.randomID(),
                name: game.i18n.localize(FILRODENSWMB.INFRASTRUCTURE_ICONS[this.uiState.activeIcon] || "Pin"),
                icon: this.uiState.activeIcon,
                x: finalPos.x,
                y: finalPos.y,
                scale: FILRODENSWMB.PINS?.DEFAULT_SCALE,
                hidden: false,
            };
            this.mapPins.push(newPin);
        } else if (this.uiState.activeInfraMode === "route") {
            if (this.activeRouteId) {
                const route = this.mapRoutes.find((r) => r.id === this.activeRouteId);
                if (route) {
                    const lastPt = route.points[route.points.length - 1];
                    if (Math.hypot(lastPt.x - finalPos.x, lastPt.y - finalPos.y) < 5) {
                        this.activeRouteId = null;
                    } else {
                        route.points.push(finalPos);
                    }
                }
            } else {
                this.activeRouteId = foundry.utils.randomID();
                const newRoute = {
                    id: this.activeRouteId,
                    name: `Route ${this.mapRoutes.length + 1}`,
                    points: [finalPos],
                    color: this.uiState.routeColor,
                    thickness: this.uiState.routeThickness,
                    style: this.uiState.routeStyle,
                    hidden: false,
                };
                this.mapRoutes.push(newRoute);
            }
        }

        this.#repaintVectors();
        this.render({ parts: ["context"] });
        this.markDirty();
    }

    #syncInfraModeButtons() {
        const mode = this.uiState.activeInfraMode;

        const modeBtns = this.element.querySelectorAll('.fwmb-edit-toolbar [data-action="setInfraMode"]');
        for (const btn of modeBtns) {
            btn.classList.toggle("active", btn.dataset.mode === mode);
        }

        const styleBtns = this.element.querySelectorAll('.fwmb-edit-toolbar [data-action="setRouteStyle"]');
        for (const btn of styleBtns) {
            btn.classList.toggle("active", btn.dataset.style === this.uiState.activeRouteQuickStyle);
        }

        if (this.activeTool === "infrastructure") {
            const toolGroups = this.element.querySelectorAll(".fwmb-edit-toolbar [data-tool-group]");
            for (const group of toolGroups) {
                const allowed = group.dataset.toolGroup.split(" ");
                if (allowed.some((a) => a.startsWith("infrastructure-"))) {
                    group.classList.toggle("fwmb-hidden", !allowed.includes(`infrastructure-${mode}`));
                }
            }
        }
    }

    #getClosestRouteSegment(x, y, threshold = 15) {
        let closest = { route: null, insertIndex: -1, dist: Infinity };

        for (const route of this.mapRoutes) {
            if (route.hidden || !route.points || route.points.length < 2) continue;

            for (let i = 0; i < route.points.length - 1; i++) {
                const p1 = route.points[i];
                const p2 = route.points[i + 1];

                const lengthSquared = Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2);
                let t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((x - p1.x) * (p2.x - p1.x) + (y - p1.y) * (p2.y - p1.y)) / lengthSquared));

                const projX = p1.x + t * (p2.x - p1.x);
                const projY = p1.y + t * (p2.y - p1.y);
                const dist = Math.hypot(x - projX, y - projY);

                if (dist < closest.dist && dist <= threshold) {
                    closest = { route, insertIndex: i + 1, dist, projX, projY };
                }
            }
        }
        return closest.route ? closest : null;
    }

    #getClosestRegionSegment(x, y, threshold = 15) {
        let closest = { region: null, insertIndex: -1, dist: Infinity };

        for (const layer of this.regionLayers) {
            if (layer.hidden) continue;

            for (const region of layer.regions) {
                if (region.hidden || !region.points || region.points.length < 2) continue;

                // Closed polygons check the segment returning to the start node
                const isClosed = region.points.length >= 3 && region.id !== this.activeRegionId;
                const limit = isClosed ? region.points.length : region.points.length - 1;

                for (let i = 0; i < limit; i++) {
                    const p1 = region.points[i];
                    const p2 = region.points[(i + 1) % region.points.length];

                    const lengthSquared = Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2);
                    let t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((x - p1.x) * (p2.x - p1.x) + (y - p1.y) * (p2.y - p1.y)) / lengthSquared));

                    const projX = p1.x + t * (p2.x - p1.x);
                    const projY = p1.y + t * (p2.y - p1.y);
                    const dist = Math.hypot(x - projX, y - projY);

                    if (dist < closest.dist && dist <= threshold) {
                        closest = { region, insertIndex: i + 1, dist, projX, projY };
                    }
                }
            }
        }
        return closest.region ? closest : null;
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

        this.#pushVectorState();

        const finalPos = this.uiState.snapToPoints ? this.#getSnappedCoordinates(x, y) : { x, y };

        if (this.activeRegionId) {
            const region = layer.regions.find((r) => r.id === this.activeRegionId);
            if (region) {
                if (region.points.length > 2 && Math.hypot(region.points[0].x - finalPos.x, region.points[0].y - finalPos.y) < 15) {
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
                hidden: false,
            });
        }

        this.#repaintVectors();
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

        return true;
    }

    /**
     * Context-aware Quick Save.
     * Creates a new journal if none exists, otherwise overwrites the current ID.
     */
    async saveCurrentMap() {
        if (this.isSaving) return false;
        this.isSaving = true;

        // Visually lock the application to prevent array mutation during serialisation
        this.element.style.pointerEvents = "none";
        this.element.style.filter = "brightness(0.7)";
        this.element.style.cursor = "wait";

        let success = false;
        try {
            const { currentSeed, params } = this.#getMapParameters();
            const payload = {
                seed: currentSeed,
                mapWidth: this.mapWidth,
                mapHeight: this.mapHeight,
                gridType: this.uiState.gridType,
                gridSize: this.uiState.gridSize,
                params: params,
                history: this.brushEngine?.history || [],
                mapPins: this.mapPins,
                mapRoutes: this.mapRoutes,
                regionLayers: this.regionLayers,
                mapLabels: this.mapLabels,
                mapDecorations: this.mapDecorations,
            };

            if (!this.currentSaveId) {
                const hash = currentSeed || Math.random().toString(36).substring(2, 8).toUpperCase();
                const defaultName = `Terrain Map (${hash})`;

                const mapName = await foundry.applications.api.DialogV2.prompt({
                    window: { title: game.i18n.localize("FILRODENSWMB.UI.SaveAs") || "Save As" },
                    content: `<label>Map Name</label><input type="text" id="fwmb-save-name" value="${defaultName}">`,
                    ok: { callback: (event, button, dialog) => button.form.elements["fwmb-save-name"].value },
                });

                if (!mapName) return false; // User cancelled the save prompt
                this.currentSaveName = mapName;
            }

            const journal = await saveMapData(this.currentSaveName, payload, this.currentSaveId);

            if (journal) {
                this.currentSaveId = journal.id;
                this.isDirty = false; // Successfully saved, map is no longer dirty
                success = true;
                ui.notifications.info(game.i18n.format("FILRODENSWMB.UI.SaveSuccess", { name: journal.name }));
                this.render({ parts: ["toolbar"] });
            } else {
                ui.notifications.error(game.i18n.localize("FILRODENSWMB.UI.SaveError"));
            }
        } finally {
            // Guarantee the UI unlocks even if an unexpected error occurs
            this.isSaving = false;
            this.element.style.pointerEvents = "auto";
            this.element.style.filter = "none";
            this.element.style.cursor = "default";
        }
        return success;
    }

    // --- Action Handlers ---

    static async #onAddDecoration(event, target) {
        if (!this.canvasEngine?.isEditMode) return;

        const content = `
            <div class="form-group fwmb-dialog-content">
                <label>${game.i18n.localize("FILRODENSWMB.UI.Name")}</label>
                <input type="text" id="fwmb-dec-name" value="New Decoration">
            </div>
            <div class="form-group fwmb-dialog-content" style="margin-top: var(--filroden-space-m);">
                <label>${game.i18n.localize("FILRODENSWMB.UI.ImageSource")}</label>
                <file-picker id="fwmb-dec-src" type="image" value=""></file-picker>
            </div>
        `;

        const result = await foundry.applications.api.DialogV2.prompt({
            classes: ["fwmb"],
            window: { title: game.i18n.localize("FILRODENSWMB.UI.AddDecoration") },
            content: content,
            ok: {
                callback: (evt, button) => {
                    return {
                        name: button.form.querySelector("#fwmb-dec-name").value,
                        src: button.form.querySelector("#fwmb-dec-src").value,
                    };
                },
            },
        });

        if (result?.src) {
            this.#pushVectorState();

            // Default to spawning in the absolute mathematical center of the map
            const spawnX = this.mapWidth / 2;
            const spawnY = this.mapHeight / 2;

            this.mapDecorations.push({
                id: foundry.utils.randomID(),
                type: "decoration",
                name: result.name || "Unnamed Decoration",
                src: result.src,
                x: spawnX,
                y: spawnY,
                rotation: 0,
                scale: 1, // Default PIXI Sprite scale
                hidden: false,
            });

            this.#repaintVectors();
            this.render({ parts: ["context"] });
            this.markDirty();
        }
    }

    static #onAddRegionLayer(event, target) {
        const id = foundry.utils.randomID();
        this.regionLayers.push({ id: id, name: `Region Layer ${this.regionLayers.length + 1}`, hidden: false, opacity: this.uiState.regionOpacity, regions: [] });
        this.activeRegionLayerId = id;
        this.render({ parts: ["context"] });
    }

    static #onAdjustNoiseScale(event, target) {
        const dir = Number(target.dataset.dir);
        const inputScale = this.element.querySelector('input[name="noise.elevation.scale"]');
        const inputOffsetX = this.element.querySelector('input[name="noise.offsetX"]');
        const inputOffsetY = this.element.querySelector('input[name="noise.offsetY"]');

        if (!inputScale) return;

        const currentScale = Number(inputScale.value);

        // Dynamically calculate the maximum bound based on the current map resolution
        const maxScale = Math.max(this.mapWidth, this.mapHeight);
        const targetScale = Math.max(100, Math.min(currentScale + dir * 50, maxScale));

        if (currentScale === targetScale) {
            ui.notifications.warn(game.i18n.localize("FILRODENSWMB.UI.WarnScaleLimit") || "Noise scale limit reached.");
            return;
        }

        // 1. Capture vector history before transforming the points
        this.#pushVectorState();

        // 2. Calculate the exact mathematical scaling ratio
        const scaleRatio = targetScale / currentScale;
        const offsetX = inputOffsetX ? Number(inputOffsetX.value) : 0;
        const offsetY = inputOffsetY ? Number(inputOffsetY.value) : 0;

        // 3. Apply the scale transformation (accounting for pan offset and nested labels)
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

        // 4. Update the DOM and trigger the procedural rebuild
        inputScale.value = targetScale;
        inputScale.dispatchEvent(new Event("input", { bubbles: true }));
        this.markDirty();
    }

    static #onAdjustReferenceScale(event, target) {
        const dir = Number(target.dataset.dir);
        const factor = dir > 0 ? 1.01 : 0.99;

        this.uiState.referenceScale *= factor;
        this.uiState.referenceScale = Math.max(0.1, Math.min(this.uiState.referenceScale, 10));

        this.#updateReferenceLayer();
    }

    /**
     * Highly destructive action: Rebuilds the underlying webgl canvas and spatial arrays.
     */
    static async #onApplyResolution(event, target) {
        const widthInput = this.element.querySelector('input[name="mapWidth"]');
        const heightInput = this.element.querySelector('input[name="mapHeight"]');
        const seedInput = this.element.querySelector('input[name="mapSeed"]'); // <-- NEW

        const newWidth = Number.parseInt(widthInput?.value) || FILRODENSWMB.DEFAULTS.MAP_WIDTH;
        const newHeight = Number.parseInt(heightInput?.value) || FILRODENSWMB.DEFAULTS.MAP_HEIGHT;
        let newSeed = seedInput?.value?.trim(); // <-- NEW

        // If the user left the seed blank, generate a random one automatically
        if (!newSeed) {
            newSeed = Math.random().toString(36).substring(2, 8).toUpperCase();
        }

        const hasBrushEdits = this.brushEngine && this.brushEngine.history.length > 0;
        const hasPinEdits = this.mapPins && this.mapPins.length > 0;

        if (hasBrushEdits || hasPinEdits) {
            const confirmed = await foundry.applications.api.DialogV2.confirm({
                window: { title: game.i18n.localize("FILRODENSWMB.UI.Warning") },
                content: `<p>${game.i18n.localize("FILRODENSWMB.UI.ResolutionWarningContent")}</p>`,
                rejectClose: false,
                modal: true,
            });

            if (!confirmed) {
                if (widthInput) widthInput.value = this.mapWidth;
                if (heightInput) heightInput.value = this.mapHeight;
                if (seedInput) seedInput.value = this.uiState.mapSeed; // Revert visually
                return;
            }
        }

        this.mapWidth = newWidth;
        this.mapHeight = newHeight;
        this.uiState.mapSeed = newSeed;
        if (seedInput) seedInput.value = newSeed;

        this.#allocateBuffers();

        this.uiState.mapWidth = newWidth;
        this.uiState.mapHeight = newHeight;

        // Revert Cartography to clean defaults
        Object.keys(this.defaultUiState).forEach((k) => {
            if (k.startsWith("cartography")) this.uiState[k] = this.defaultUiState[k];
        });

        // 1. Reset all history and spatial arrays
        this.markDirty();
        this.brushEngine = new BrushEngine(this.mapWidth, this.mapHeight);
        this.mapPins = [];
        this.mapRoutes = [];
        this.regionLayers = [];
        this.mapLabels = [];
        this.pinHistory = [];
        this.pinRedoStack = [];

        // 2. Drop all active drawing states
        this.activeRouteId = null;
        this.activeRegionLayerId = null;
        this.activeRegionId = null;

        // 3. Wipe the save memory so the next save forces a "Save As" prompt
        this.currentSaveId = null;
        this.currentSaveName = null;

        await this.generateTerrain();
        this.#updateGrid();
        this.canvasEngine.resetCamera();

        // 4. Force UI to update (clears old layers from the sidebar and map name from the save tooltip)
        this.render({ parts: ["toolbar", "context"] });
    }

    static #onChangeTool(event, target) {
        const newTool = target.dataset.tool;
        if (!newTool || this.activeTool === newTool) return;

        const editToolbar = this.element.querySelector(".fwmb-edit-toolbar");
        if (editToolbar && !editToolbar.classList.contains("fwmb-hidden")) {
            editToolbar.classList.add("fwmb-hidden");
            this.brushEngine?.endStroke();

            const editBtn = this.element.querySelector('[data-action="toggleEditMode"]');
            if (editBtn) editBtn.classList.remove("active");

            if (this.canvasEngine) this.canvasEngine.setEditMode(false);

            const panel = this.element.querySelector(".fwmb-context-panel");
            if (panel) {
                const controls = panel.querySelectorAll("fieldset input, fieldset button");
                for (const control of controls) {
                    control.disabled = false;
                }
                panel.classList.remove("fwmb-locked");
            }
        }

        this.#getMapParameters();
        this.activeTool = newTool;

        if (newTool === "biomes") {
            const biomesBtn = this.element.querySelector('[data-layer="biomes"]');
            if (biomesBtn && !biomesBtn.classList.contains("active")) {
                biomesBtn.classList.add("active");
                this.canvasEngine?.toggleLayer("biomes", true);
            }
            this.#updateBiomeOpacity();
        } else if (newTool === "terrain") {
            const topoBtn = this.element.querySelector('[data-layer="topography"]');
            if (topoBtn && !topoBtn.classList.contains("active")) {
                topoBtn.classList.add("active");
                this.canvasEngine?.toggleLayer("topography", true);
            }
            this.#updateBiomeOpacity();
        } else if (newTool === "features") {
            const featuresBtn = this.element.querySelector('[data-layer="features"]');
            if (featuresBtn && !featuresBtn.classList.contains("active")) {
                featuresBtn.classList.add("active");
                this.canvasEngine?.toggleLayer("features", true);
            }
            this.#updateBiomeOpacity();
        }

        if (this.canvasEngine) {
            this.canvasEngine.setReferenceMode(newTool === "reference");
        }

        if (editToolbar) {
            editToolbar.querySelectorAll("[data-tool-group]").forEach((el) => {
                const allowedTools = el.dataset.toolGroup.split(" ");
                let isVisible = allowedTools.includes(newTool);

                if (newTool === "infrastructure" && allowedTools.some((t) => t.startsWith("infrastructure-"))) {
                    isVisible = allowedTools.includes(`infrastructure-${this.uiState.activeInfraMode}`);
                }

                el.classList.toggle("fwmb-hidden", !isVisible);
            });
        }

        this.#syncInfraModeButtons();
        this.#repaintVectors();
        this.render({ parts: ["toolbar", "context"] });
    }

    static async #onDeleteDecoration(event, target) {
        const id = target.closest(".fwmb-list-item").dataset.id;
        const confirmed = await foundry.applications.api.DialogV2.confirm({
            window: { title: game.i18n.localize("FILRODENSWMB.UI.Delete") },
            content: `<p>${game.i18n.localize("FILRODENSWMB.UI.DeleteConfirm")}</p>`,
            rejectClose: false,
            modal: true,
        });

        if (!confirmed) return;

        this.#pushVectorState();
        this.mapDecorations = this.mapDecorations.filter((d) => d.id !== id);
        this.#repaintVectors();
        this.render({ parts: ["context"] });
        this.markDirty();
    }

    static async #onDeleteLabel(event, target) {
        const id = target.closest(".fwmb-list-item").dataset.id;
        const confirmed = await foundry.applications.api.DialogV2.confirm({
            window: { title: game.i18n.localize("FILRODENSWMB.UI.Delete") },
            content: `<p>${game.i18n.localize("FILRODENSWMB.UI.DeleteConfirm")}</p>`,
            rejectClose: false,
            modal: true,
        });
        if (!confirmed) return;

        this.#pushVectorState();
        this.mapLabels = this.mapLabels.filter((l) => l.id !== id);
        this.#repaintVectors();
        this.render({ parts: ["context"] });
        this.markDirty();
    }

    static #onDeletePin(event, target) {
        const id = target.closest(".fwmb-list-item").dataset.id;
        this.#pushVectorState();
        this.mapPins = this.mapPins.filter((p) => p.id !== id);
        this.#repaintVectors();
        this.render({ parts: ["context"] });
        this.markDirty();
    }

    static async #onDeleteRegion(event, target) {
        const layerId = target.closest(".fwmb-accordion-group").dataset.layerId;
        const regionId = target.closest(".fwmb-list-item").dataset.id;

        const layer = this.regionLayers.find((l) => l.id === layerId);
        if (!layer) return;

        const confirmed = await foundry.applications.api.DialogV2.confirm({
            window: { title: game.i18n.localize("FILRODENSWMB.UI.Delete") },
            content: `<p>${game.i18n.localize("FILRODENSWMB.UI.DeleteConfirm")}</p>`,
            rejectClose: false,
            modal: true,
        });

        if (!confirmed) return;

        this.#pushVectorState();

        layer.regions = layer.regions.filter((r) => r.id !== regionId);
        if (this.activeRegionId === regionId) this.activeRegionId = null;

        this.#repaintVectors();
        this.render({ parts: ["context"] });
        this.markDirty();
    }

    static async #onDeleteRegionLayer(event, target) {
        const id = target.closest(".fwmb-accordion-group").dataset.layerId;
        const confirmed = await foundry.applications.api.DialogV2.confirm({
            window: { title: game.i18n.localize("FILRODENSWMB.UI.Delete") },
            content: `<p>${game.i18n.localize("FILRODENSWMB.UI.DeleteConfirm")}</p>`,
            rejectClose: false,
            modal: true,
        });
        if (confirmed) {
            this.#pushVectorState();
            this.regionLayers = this.regionLayers.filter((l) => l.id !== id);
            if (this.activeRegionLayerId === id) this.activeRegionLayerId = null;
            this.#repaintVectors();
            this.render({ parts: ["context"] });
            this.markDirty();
        }
    }

    static #onDeleteRoute(event, target) {
        const id = target.closest(".fwmb-list-item").dataset.id;
        this.#pushVectorState();
        this.mapRoutes = this.mapRoutes.filter((r) => r.id !== id);
        if (this.activeRouteId === id) this.activeRouteId = null;
        this.#repaintVectors();
        this.render({ parts: ["context"] });
        this.markDirty();
    }

    static async #onEditDecoration(event, target) {
        const id = target.closest(".fwmb-list-item").dataset.id;
        const dec = this.mapDecorations.find((d) => d.id === id);
        if (!dec) return;

        const content = `
            <div class="form-group fwmb-dialog-content">
                <label>${game.i18n.localize("FILRODENSWMB.UI.Name")}</label>
                <input type="text" id="fwmb-dec-name" value="${dec.name}">
            </div>
            <div class="form-group fwmb-dialog-content" style="margin-top: var(--filroden-space-m);">
                <label>${game.i18n.localize("FILRODENSWMB.UI.Opacity")}</label>
                <div class="fwmb-slider-group">
                    <input type="range" id="fwmb-dec-alpha" value="${dec.opacity ?? 1}" min="0.1" max="1" step="0.1" oninput="this.nextElementSibling.value = this.value" />
                    <output>${dec.opacity ?? 1}</output>
                </div>
            </div>
        `;

        const result = await foundry.applications.api.DialogV2.prompt({
            classes: ["fwmb"],
            window: { title: game.i18n.localize("FILRODENSWMB.UI.Edit") || "Edit Decoration" },
            content: content,
            render: (event) => {
                const app = event.target;
                const html = app.element;
                const range = html.querySelector("#fwmb-dec-alpha");
                const output = html.querySelector("output");
                if (range && output) {
                    range.addEventListener("input", (e) => (output.value = e.target.value));
                }
            },
            ok: {
                callback: (evt, button) => {
                    return {
                        name: button.form.querySelector("#fwmb-dec-name").value,
                        opacity: Number(button.form.querySelector("#fwmb-dec-alpha").value),
                    };
                },
            },
        });

        if (result) {
            this.#pushVectorState();
            dec.name = result.name;
            dec.opacity = result.opacity;
            this.#repaintVectors();
            this.render({ parts: ["context"] });
            this.markDirty();
        }
    }

    static async #onEditLabel(event, target) {
        const listItem = target.closest(".fwmb-list-item");
        const id = listItem.dataset.id;
        const type = listItem.dataset.type;

        let labelData = {};
        let sourceObj = null;

        // Extract existing data
        if (type === "custom") {
            sourceObj = this.mapLabels.find((l) => l.id === id);
            if (!sourceObj) return;
            labelData = { ...sourceObj };
        } else {
            // Auto-generated extraction
            if (type === "pin") sourceObj = this.mapPins.find((p) => p.id === id);
            if (type === "route") sourceObj = this.mapRoutes.find((r) => r.id === id);
            if (type === "region") {
                const layer = this.regionLayers.find((l) => l.id === listItem.dataset.layerId);
                sourceObj = layer?.regions.find((r) => r.id === id);
            }
            if (!sourceObj) return;

            // Merge defaults for auto labels if they haven't been edited yet
            labelData = {
                name: sourceObj.name,
                fontFamily: sourceObj.label?.fontFamily || this.uiState.labelFontFamily,
                fontSize: sourceObj.label?.fontSize || this.uiState.labelFontSize,
                fillColor: sourceObj.label?.fillColor || this.uiState.labelFillColor,
            };
        }

        const fonts = CONFIG.fontFamilies || ["Signika", "Modesto Condensed", "Arial"];
        const palette = FILRODENSWMB.LABELS?.PRESETS || [];

        const content = await foundry.applications.handlebars.renderTemplate("modules/filrodens-world-map-builder/templates/dialogs/edit-labels.hbs", { label: labelData, fonts, palette });

        const result = await foundry.applications.api.DialogV2.prompt({
            classes: ["fwmb"],
            window: { title: game.i18n.localize("FILRODENSWMB.UI.EditLabel") || "Edit Label" },
            content: content,
            render: (event) => {
                const app = event.target;
                const html = app.element;

                // 1. Bind Font Size Slider
                const range = html.querySelector('input[name="labelFontSize"]');
                const output = html.querySelector("output");
                if (range && output) {
                    range.addEventListener("input", (e) => (output.value = e.target.value));
                }

                // 2. Bind Preset Color Swatches
                const colorInput = html.querySelector('input[name="labelFillColor"]');
                const swatches = html.querySelectorAll(".fwmb-preset-swatch");
                if (colorInput && swatches.length) {
                    swatches.forEach((swatch) => {
                        swatch.addEventListener("click", (e) => {
                            // Apply the preset hex to the native color picker
                            colorInput.value = e.target.dataset.color;
                        });
                    });
                }
            },
            ok: {
                callback: (evt, button) => {
                    return {
                        name: button.form.elements["labelName"].value,
                        fontFamily: button.form.elements["labelFontFamily"].value,
                        fontSize: Number(button.form.elements["labelFontSize"].value),
                        fillColor: button.form.elements["labelFillColor"].value,
                    };
                },
            },
        });

        if (result) {
            this.#pushVectorState();
            if (type === "custom") {
                sourceObj.name = result.name;
                sourceObj.fontFamily = result.fontFamily;
                sourceObj.fontSize = result.fontSize;
                sourceObj.fillColor = result.fillColor;
            } else {
                sourceObj.name = result.name; // Crucial: Syncs the name back to the core object
                if (!sourceObj.label) sourceObj.label = {};
                sourceObj.label.fontFamily = result.fontFamily;
                sourceObj.label.fontSize = result.fontSize;
                sourceObj.label.fillColor = result.fillColor;
            }

            this.#repaintVectors();
            this.render({ parts: ["context"] });
            this.markDirty();
        }
    }

    static async #onEditPin(event, target) {
        const id = target.closest(".fwmb-list-item").dataset.id;
        const pin = this.mapPins.find((p) => p.id === id);
        if (!pin) return;

        const icons = Object.entries(FILRODENSWMB.INFRASTRUCTURE_ICONS)
            .map(([key, label]) => ({
                key: key,
                localized: game.i18n.localize(label),
                selected: key === pin.icon,
            }))
            .sort((a, b) => a.localized.localeCompare(b.localized));

        const safePin = { ...pin, scale: pin.scale ?? 1 };

        const content = await foundry.applications.handlebars.renderTemplate("modules/filrodens-world-map-builder/templates/dialogs/edit-pins.hbs", { pin: safePin, icons });

        const result = await foundry.applications.api.DialogV2.prompt({
            classes: ["fwmb"],
            window: { title: game.i18n.localize("FILRODENSWMB.UI.EditPin") },
            content: content,
            render: (event) => {
                const app = event.target;
                const html = app.element;
                const range = html.querySelector('input[name="pinScale"]');
                const output = html.querySelector("output");
                if (range && output) range.addEventListener("input", (e) => (output.value = e.target.value));
            },
            ok: {
                callback: (event, button, dialog) => {
                    return {
                        name: button.form.elements["pinName"].value,
                        description: button.form.elements["pinDesc"].value,
                        icon: button.form.elements["pinIcon"].value,
                        scale: Number(button.form.elements["pinScale"].value),
                    };
                },
            },
        });

        if (result) {
            this.#pushVectorState();
            pin.name = result.name;
            pin.description = result.description;
            pin.icon = result.icon;
            pin.scale = result.scale;

            this.#repaintVectors();
            this.render({ parts: ["context"] });
            this.markDirty();
        }
    }

    static async #onEditRegion(event, target) {
        this.activeRegionId = null;

        const layerId = target.closest(".fwmb-accordion-group").dataset.layerId;
        const regionId = target.closest(".fwmb-list-item").dataset.id;

        const layer = this.regionLayers.find((l) => l.id === layerId);
        if (!layer) return;

        const region = layer.regions.find((r) => r.id === regionId);
        if (!region) return;

        const content = await foundry.applications.handlebars.renderTemplate("modules/filrodens-world-map-builder/templates/dialogs/edit-regions.hbs", { region });

        const result = await foundry.applications.api.DialogV2.prompt({
            classes: ["fwmb"],
            window: { title: game.i18n.localize("FILRODENSWMB.UI.EditRegion") },
            content: content,
            ok: {
                callback: (event, button, dialog) => {
                    return {
                        name: button.form.elements["regionName"].value,
                        description: button.form.elements["regionDesc"].value,
                        fillColor: button.form.elements["regionFillTransparent"].checked ? "transparent" : button.form.elements["regionFillColor"].value,
                        fillStyle: button.form.elements["regionFillStyle"].value,
                        lineColor: button.form.elements["regionLineColor"].value,
                        lineThickness: Number(button.form.elements["regionLineThickness"].value),
                        lineStyle: button.form.elements["regionLineStyle"].value,
                        smoothing: button.form.elements["regionSmoothing"].value === "true",
                    };
                },
            },
        });

        if (!result) return;

        this.#pushVectorState();

        region.name = result.name;
        region.description = result.description;
        region.fillColor = result.fillColor;
        region.fillStyle = result.fillStyle;
        region.lineColor = result.lineColor;
        region.lineThickness = result.lineThickness;
        region.lineStyle = result.lineStyle;
        region.smoothing = result.smoothing;

        this.#repaintVectors();
        this.render({ parts: ["context"] });
        this.markDirty();
    }

    static async #onEditRegionLayer(event, target) {
        const id = target.closest(".fwmb-accordion-group").dataset.layerId;
        const layer = this.regionLayers.find((l) => l.id === id);
        if (!layer) return;

        const newName = await foundry.applications.api.DialogV2.prompt({
            window: { title: game.i18n.localize("FILRODENSWMB.UI.EditLayer") },
            content: `<input type="text" id="fwmb-rename-layer" value="${layer.name}">`,
            ok: { callback: (e, b) => b.form.elements["fwmb-rename-layer"].value },
        });

        if (newName) {
            layer.name = newName;
            this.render({ parts: ["context"] });
            this.markDirty();
        }
    }

    static async #onEditRoute(event, target) {
        const id = target.closest(".fwmb-list-item").dataset.id;
        const route = this.mapRoutes.find((r) => r.id === id);
        if (!route) return;

        const content = await foundry.applications.handlebars.renderTemplate("modules/filrodens-world-map-builder/templates/dialogs/edit-routes.hbs", { route });

        const result = await foundry.applications.api.DialogV2.prompt({
            classes: ["fwmb"],
            window: { title: game.i18n.localize("FILRODENSWMB.UI.EditRoute") },
            content: content,
            ok: {
                callback: (event, button, dialog) => {
                    return {
                        name: button.form.elements["routeName"].value,
                        description: button.form.elements["routeDesc"].value,
                        color: button.form.elements["routeColor"].value,
                        thickness: Number(button.form.elements["routeThickness"].value),
                        style: button.form.elements["routeStyle"].value,
                    };
                },
            },
        });

        if (result) {
            this.#pushVectorState();

            route.name = result.name;
            route.description = result.description;
            route.color = result.color;
            route.thickness = result.thickness;
            route.style = result.style;

            this.#repaintVectors();
            this.render({ parts: ["context"] });
            this.markDirty();
        }
    }

    /**
     * Extracts the currently active canvas state to a PNG.
     */
    static async #onExportPng(event, target) {
        if (!this.canvasEngine || !this.currentElevationData) {
            ui.notifications.warn("No map is currently generated to export.");
            return;
        }

        const mapName = this.currentSaveName || "Unsaved Map";

        ui.notifications.info(game.i18n.format("Exporting {name} to PNG...", { name: mapName }));
        this.canvasEngine.exportToPNG(mapName);
    }

    /**
     * Opens a system file dialogue, validates the JSON payload, and imports it to the database.
     */
    static async #onImportMapJson(event, target) {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json";

        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            try {
                const text = await file.text();
                const parsedData = JSON.parse(text);

                if (!parsedData.seed || !parsedData.params) {
                    throw new Error("Invalid FWMB Data Schema");
                }

                const cleanName = file.name.replace(".json", "").replace("fwmb_", "");
                await saveMapData(`${cleanName} (Imported)`, parsedData);

                ui.notifications.info(game.i18n.localize("FILRODENSWMB.UI.ImportSuccess"));
                this.render({ parts: ["context"] });
            } catch (err) {
                console.error("FWMB | Import Failed:", err);
                ui.notifications.error(game.i18n.localize("FILRODENSWMB.UI.ImportError"));
            }
        };

        input.click();
    }

    /**
     * Unified router for the inline CRUD buttons on the Manage Maps cards.
     */
    static async #onManageMapAction(event, target) {
        const action = target.dataset.actionType;
        const card = target.closest(".fwmb-map-card");
        if (!action || !card) return;

        const mapId = card.dataset.id;

        switch (action) {
            case "load": {
                const canLoad = await this.#gateUnsavedChanges();
                if (!canLoad) return;

                const payload = await loadMapData(mapId);
                if (payload) {
                    this.currentSaveId = mapId;
                    this.currentSaveName = card.querySelector(".fwmb-map-card-info").textContent.trim();
                    await this.#ingestMapPayload(payload);
                    ui.notifications.info(game.i18n.localize("FILRODENSWMB.UI.LoadSuccess"));
                    this.render({ parts: ["toolbar"] });
                    this.isDirty = false;
                }
                break;
            }

            case "delete": {
                const confirmed = await foundry.applications.api.DialogV2.confirm({
                    window: { title: game.i18n.localize("FILRODENSWMB.UI.Delete") },
                    content: `<p>${game.i18n.localize("FILRODENSWMB.UI.DeleteConfirm")}</p>`,
                    rejectClose: false,
                    modal: true,
                });
                if (!confirmed) return;

                await deleteSavedMap(mapId);
                if (this.currentSaveId === mapId) this.currentSaveId = null;
                this.render({ parts: ["context"] });
                break;
            }

            case "rename": {
                const currentName = card.querySelector(".fwmb-map-card-info").textContent.trim();
                const newName = await foundry.applications.api.DialogV2.prompt({
                    window: { title: game.i18n.localize("FILRODENSWMB.UI.Rename") },
                    content: `<input type="text" id="fwmb-rename" value="${currentName}">`,
                    ok: { callback: (event, button, dialog) => button.form.elements["fwmb-rename"].value },
                });

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
                break;
            }

            case "duplicate": {
                await duplicateSavedMap(mapId);
                this.render({ parts: ["context"] });
                break;
            }

            case "export": {
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
                break;
            }
        }
    }

    static #onNudgeNoise(event, target) {
        const dx = Number(target.dataset.dx);
        const dy = Number(target.dataset.dy);

        const inputX = this.element.querySelector('input[name="noise.offsetX"]');
        const inputY = this.element.querySelector('input[name="noise.offsetY"]');
        if (!inputX || !inputY) return;

        // 1. Capture vector history before moving the world
        this.#pushVectorState();

        // 2. Translate all vector nodes and their associated label offsets
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

        // 3. Shift the procedural window
        inputX.value = Number(inputX.value) + dx;
        inputY.value = Number(inputY.value) + dy;

        inputX.dispatchEvent(new Event("input", { bubbles: true }));
        this.markDirty();
    }

    static #onNudgeReference(event, target) {
        const dx = Number(target.dataset.dx);
        const dy = Number(target.dataset.dy);

        this.uiState.referenceX += dx;
        this.uiState.referenceY += dy;
        this.#updateReferenceLayer();
    }

    static async #onRandomizeSeed(event, target) {
        const input = this.element.querySelector('input[name="mapSeed"]');
        if (!input) return;

        input.value = Math.random().toString(36).substring(2, 8).toUpperCase();
    }

    static #onRedoBrush(event, target) {
        if (["features", "infrastructure", "regions", "labels"].includes(this.activeTool)) {
            if (this.pinRedoStack.length === 0) return;

            this.pinHistory.push({
                pins: foundry.utils.deepClone(this.mapPins),
                routes: foundry.utils.deepClone(this.mapRoutes),
                regionLayers: foundry.utils.deepClone(this.regionLayers),
                mapLabels: foundry.utils.deepClone(this.mapLabels),
                mapDecorations: foundry.utils.deepClone(this.mapDecorations),
                activeRouteId: this.activeRouteId,
                activeRegionId: this.activeRegionId,
            });

            const state = this.pinRedoStack.pop();
            this.mapPins = state.pins;
            this.mapRoutes = state.routes;
            this.regionLayers = state.regionLayers;
            this.mapLabels = state.mapLabels || this.mapLabels;
            this.mapDecorations = state.mapDecorations || this.mapDecorations;
            this.activeRouteId = state.activeRouteId;
            this.activeRegionId = state.activeRegionId;

            if (this.activeTool === "features") {
                this.#repaintCanvas();
                this.debouncedGenerateClimate();
            } else {
                this.#repaintVectors();
            }
            this.render({ parts: ["context"] });
        } else {
            if (!this.baseElevationData || !this.brushEngine) return;
            if (this.brushEngine.redo()) {
                this.#rebuildFromHistory();
                this.#repaintCanvas();
                this.debouncedGenerateClimate();
            }
        }

        this.markDirty();
    }

    static #onRemoveReferenceImage(event, target) {
        this.uiState.referenceImage = "";

        const filePicker = this.element.querySelector('file-picker[name="referenceImage"]');
        if (filePicker) filePicker.value = "";

        this.#updateReferenceLayer();
    }

    static #onResetNoisePan(event, target) {
        const inputX = this.element.querySelector('input[name="noise.offsetX"]');
        const inputY = this.element.querySelector('input[name="noise.offsetY"]');
        if (inputX && inputY) {
            inputX.value = this.defaultUiState["noise.offsetX"];
            inputY.value = this.defaultUiState["noise.offsetY"];
            inputX.dispatchEvent(new Event("input", { bubbles: true }));
        }
    }

    static #onResetNoiseScale(event, target) {
        const input = this.element.querySelector('input[name="noise.elevation.scale"]');
        if (input) {
            input.value = this.defaultUiState["noise.elevation.scale"];
            input.dispatchEvent(new Event("input", { bubbles: true }));
        }
    }

    static #onResetReferencePan(event, target) {
        this.uiState.referenceX = this.mapWidth / 2;
        this.uiState.referenceY = this.mapHeight / 2;
        this.#updateReferenceLayer();
    }

    static #onResetReferenceScale(event, target) {
        this.uiState.referenceScale = 1;
        this.#updateReferenceLayer();
    }

    static #onResetZoom(event, target) {
        this.canvasEngine?.resetCamera();
    }

    static async #onSaveMap(event, target) {
        if (target) target.disabled = true;
        await this.saveCurrentMap();
        if (target) target.disabled = false;
    }

    static #onSelectRegionLayer(event, target) {
        const id = target.closest(".fwmb-accordion-group").dataset.layerId;
        this.activeRegionLayerId = id;
        this.activeRegionId = null;
        this.render({ parts: ["context"] });
    }

    /**
     * Handles swapping between the Raise, Lower, and Smooth brush tools.
     */
    static #onSetBrushTool(event, target) {
        const toolContainer = target.closest(".fwmb-brush-tools");
        if (!toolContainer) return;

        for (const btn of toolContainer.querySelectorAll("button")) {
            btn.classList.remove("active");
        }

        const activeBtn = target.closest("button");
        if (activeBtn) activeBtn.classList.add("active");
    }

    /**
     * Handles manual switching between Point and Route modes via the edit toolbar.
     */
    static #onSetInfraMode(event, target) {
        this.uiState.activeInfraMode = target.dataset.mode;
        this.activeRouteId = null;
        this.#syncInfraModeButtons();
    }

    static #onSetInfrastructureIcon(event, target) {
        this.uiState.activeIcon = target.dataset.icon;
        this.uiState.activeInfraMode = "pin";
        this.activeRouteId = null;

        const triggerImg = this.element.querySelector(".fwmb-active-icon-img");
        if (triggerImg) triggerImg.src = `modules/filrodens-world-map-builder/assets/pinhead-icons/${this.uiState.activeIcon}.svg`;

        const dropdown = this.element.querySelector("#fwmb-pin-select .fwmb-select-options");
        if (dropdown) dropdown.classList.add("fwmb-hidden");

        this.#syncInfraModeButtons();
    }

    static #onSetRegionMode(event, target) {
        const toolContainer = target.closest(".fwmb-edit-toolbar");
        if (!toolContainer) return;

        for (const btn of toolContainer.querySelectorAll('[data-action="setRegionMode"]')) {
            btn.classList.remove("active");
        }
        target.classList.add("active");

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
            hidden: false,
        });

        this.#repaintVectors();
        this.render({ parts: ["context"] });
    }

    static #onSetRegionPreset(event, target) {
        const color = target.dataset.color;
        const targetProperty = target.dataset.target === "line" ? "regionLineColor" : "regionFillColor";

        this.uiState[targetProperty] = color;
        this.#syncDOMToState();

        if (this.activeRegionId && this.activeRegionLayerId) {
            const layer = this.regionLayers.find((l) => l.id === this.activeRegionLayerId);
            const region = layer?.regions.find((r) => r.id === this.activeRegionId);
            if (region) {
                if (targetProperty === "line") region.lineColor = color;
                else region.fillColor = color;
                this.#repaintVectors();
            }
        }
    }

    static #onSetRouteStyle(event, target) {
        const styleId = target.dataset.style;
        const styleData = FILRODENSWMB.ROUTE_STYLES[styleId];

        if (!styleData) return;

        this.uiState.activeInfraMode = "route";
        this.uiState.activeRouteQuickStyle = styleId;
        this.activeRouteId = null;

        this.uiState.routeColor = styleData.color;
        this.uiState.routeThickness = styleData.thickness;
        this.uiState.routeStyle = styleData.style;

        this.#syncDOMToState();
        this.#syncInfraModeButtons();

        this.render({ parts: ["context"] });
    }

    /**
     * Toggles the interactive 3D topography visualisation.
     */
    static async #onThreeDView(event, target) {
        const overlay = this.element.querySelector("#fwmb-3d-overlay");
        const mapControls = this.element.querySelector(".fwmb-map-controls");
        const editToolbar = this.element.querySelector(".fwmb-edit-toolbar");
        const contextPanel = this.element.querySelector(".fwmb-context-panel");

        if (!overlay || !this.currentElevationData) return;

        if (this.scene3D) {
            this.scene3D.destroy();
            this.scene3D = null;
            overlay.classList.add("fwmb-hidden");
            target.classList.remove("active");

            if (mapControls) mapControls.classList.remove("fwmb-hidden");
            if (contextPanel) contextPanel.style.display = "";

            const editBtn = this.element.querySelector('[data-action="toggleEditMode"]');
            if (editToolbar && editBtn?.classList.contains("active")) {
                editToolbar.classList.remove("fwmb-hidden");
            }
            return;
        }

        overlay.classList.remove("fwmb-hidden");
        target.classList.add("active");

        if (mapControls) mapControls.classList.add("fwmb-hidden");
        if (editToolbar) editToolbar.classList.add("fwmb-hidden");
        if (contextPanel) contextPanel.style.display = "none";

        const { currentSeed, params } = this.#getMapParameters();
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

    static #onToggleEditMode(event, target) {
        const toolbar = this.element.querySelector(".fwmb-edit-toolbar");
        if (!toolbar) return;

        const isActivating = toolbar.classList.toggle("fwmb-hidden") === false;
        target.closest("button").classList.toggle("active");

        if (this.canvasEngine) {
            this.canvasEngine.setEditMode(isActivating);
        }

        if (this.activeTool !== "infrastructure" && this.activeTool !== "labels") {
            const panel = this.element.querySelector(".fwmb-context-panel");
            if (panel) {
                const controls = panel.querySelectorAll("fieldset input, fieldset button");
                for (const control of controls) {
                    control.disabled = isActivating;
                }
                panel.classList.toggle("fwmb-locked", isActivating);
            }
        }

        if (["features", "infrastructure", "regions", "labels", "cartography"].includes(this.activeTool)) {
            this.#repaintVectors();
        }
    }

    static #onToggleGrid(event, target) {
        this.uiState.gridVisible = !this.uiState.gridVisible;
        target.classList.toggle("active", this.uiState.gridVisible);
        this.#updateGrid();
    }

    /**
     * Toggles visibility of the WebGL layers.
     */
    static #onToggleLayer(event, target) {
        const layerId = target.dataset.layer;
        if (!layerId || !this.canvasEngine) return;

        const isVisible = target.classList.toggle("active");

        this.canvasEngine.toggleLayer(layerId, isVisible);
    }

    static #onTogglePinDropdown(event, target) {
        const dropdown = target.closest(".fwmb-custom-select").querySelector(".fwmb-select-options");
        if (dropdown) dropdown.classList.toggle("fwmb-hidden");
    }

    static #onToggleRegionSmoothing(event, target) {
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
                this.#repaintVectors();
            }
        }
    }

    static #onToggleSnapping(event, target) {
        this.uiState.snapToPoints = !this.uiState.snapToPoints;
        target.classList.toggle("active", this.uiState.snapToPoints);
    }

    static #onToggleVisibility(event, target) {
        const targetType = target.dataset.target; // "layer", "feature", or "label"

        // 1. Handle Region Layers (Accordion Groups)
        if (targetType === "layer") {
            const id = target.closest(".fwmb-accordion-group").dataset.layerId;
            const layer = this.regionLayers.find((l) => l.id === id);
            if (layer) {
                this.#pushVectorState();
                layer.hidden = !layer.hidden;
            }
        }
        // 2. Handle Individual List Items (Pins, Routes, Regions, Custom Labels, Decorations)
        else {
            const listItem = target.closest(".fwmb-list-item");
            if (!listItem) return;

            const id = listItem.dataset.id;
            const type = listItem.dataset.type; // "pin", "route", "region", "decoration", "custom"

            let obj = null;
            if (type === "custom") obj = this.mapLabels.find((l) => l.id === id);
            else if (type === "decoration") obj = this.mapDecorations.find((d) => d.id === id);
            else if (type === "pin") obj = this.mapPins.find((p) => p.id === id);
            else if (type === "route") obj = this.mapRoutes.find((r) => r.id === id);
            else if (type === "region") {
                const layer = this.regionLayers.find((l) => l.id === listItem.dataset.layerId);
                obj = layer?.regions.find((r) => r.id === id);
            }

            if (obj) {
                this.#pushVectorState();

                // If the user clicked the hide button on the Labels tab
                if (targetType === "label") {
                    if (type === "custom") {
                        obj.hidden = !obj.hidden;
                    } else {
                        if (!obj.label) obj.label = { hidden: false };
                        obj.label.hidden = !obj.label.hidden;
                    }
                }
                // If the user clicked the hide button on the Infrastructure or Regions tab
                else if (targetType === "feature") {
                    obj.hidden = !obj.hidden;
                }
            }
        }

        this.#repaintVectors();
        this.render({ parts: ["context"] });
        this.markDirty();
    }

    static #onUndoBrush(event, target) {
        if (["features", "infrastructure", "regions", "labels"].includes(this.activeTool)) {
            if (this.pinHistory.length === 0) return;

            this.pinRedoStack.push({
                pins: foundry.utils.deepClone(this.mapPins),
                routes: foundry.utils.deepClone(this.mapRoutes),
                regionLayers: foundry.utils.deepClone(this.regionLayers),
                mapLabels: foundry.utils.deepClone(this.mapLabels),
                mapDecorations: foundry.utils.deepClone(this.mapDecorations),
                activeRouteId: this.activeRouteId,
                activeRegionId: this.activeRegionId,
            });

            const state = this.pinHistory.pop();
            this.mapPins = state.pins || state;
            this.mapRoutes = state.routes || this.mapRoutes;
            this.regionLayers = state.regionLayers || this.regionLayers;
            this.mapLabels = state.mapLabels || this.mapLabels;
            this.mapDecorations = state.mapDecorations || this.mapDecorations;
            this.activeRouteId = state.activeRouteId || null;
            this.activeRegionId = state.activeRegionId || null;

            if (this.activeTool === "features") {
                this.#repaintCanvas();
                this.debouncedGenerateClimate();
            } else {
                this.#repaintVectors();
            }
            this.render({ parts: ["context"] });
        } else {
            if (!this.baseElevationData || !this.brushEngine) return;
            if (this.brushEngine.undo()) {
                this.#rebuildFromHistory();
                this.#repaintCanvas();
                this.debouncedGenerateClimate();
            }
        }

        this.markDirty();
    }

    static #onZoomIn(event, target) {
        this.canvasEngine?.zoomCamera(1.25);
    }

    static #onZoomOut(event, target) {
        this.canvasEngine?.zoomCamera(0.8);
    }

    static #onZoomToFeature(event, target) {
        const listItem = target.closest(".fwmb-list-item");
        const id = listItem.dataset.id;
        const type = listItem.dataset.type;

        let targetPoints = [];

        if (type === "custom") {
            const label = this.mapLabels.find((l) => l.id === id);
            if (label) targetPoints = [label];
        } else if (type === "decoration") {
            const dec = this.mapDecorations.find((d) => d.id === id);
            if (dec) targetPoints = [dec];
        } else if (type === "pin") {
            const pin = this.mapPins.find((p) => p.id === id);
            if (pin) targetPoints = [pin];
        } else if (type === "route") {
            const route = this.mapRoutes.find((r) => r.id === id);
            if (route?.points) targetPoints = route.points;
        } else if (type === "region") {
            const layer = this.regionLayers.find((l) => l.id === listItem.dataset.layerId);
            const region = layer?.regions.find((r) => r.id === id);
            if (region?.points) targetPoints = region.points;
        }

        if (targetPoints.length > 0 && this.canvasEngine) {
            this.canvasEngine.zoomToFeature(targetPoints);
        }
    }
}
