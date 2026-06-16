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
            changeTool: MapStudioApp.#onChangeTool,
            toggleGrid: MapStudioApp.#onToggleGrid,
            zoomIn: MapStudioApp.#onZoomIn,
            zoomOut: MapStudioApp.#onZoomOut,
            resetZoom: MapStudioApp.#onResetZoom,
            randomizeSeed: MapStudioApp.#onRandomizeSeed,
            toggleEditMode: MapStudioApp.#onToggleEditMode,
            setBrushTool: MapStudioApp.#onSetBrushTool,
            undoBrush: MapStudioApp.#onUndoBrush,
            redoBrush: MapStudioApp.#onRedoBrush,
            exportPng: MapStudioApp.#onExportPng,
            saveMap: MapStudioApp.#onSaveMap,
            manageMap: MapStudioApp.#onManageMapAction,
            importMapJson: MapStudioApp.#onImportMapJson,
            threeDView: MapStudioApp.#onThreeDView,
            toggleLayer: MapStudioApp.#onToggleLayer,
            applyResolution: MapStudioApp.#onApplyResolution,
            adjustNoiseScale: MapStudioApp.#onAdjustNoiseScale,
            resetNoiseScale: MapStudioApp.#onResetNoiseScale,
            nudgeNoise: MapStudioApp.#onNudgeNoise,
            resetNoisePan: MapStudioApp.#onResetNoisePan,
            setInfrastructureIcon: MapStudioApp.#onSetInfrastructureIcon,
            setInfraMode: MapStudioApp.#onSetInfraMode,
            toggleSnapping: MapStudioApp.#onToggleSnapping,
            setRouteStyle: MapStudioApp.#onSetRouteStyle,
            togglePinVisibility: MapStudioApp.#onTogglePinVisibility,
            deletePin: MapStudioApp.#onDeletePin,
            toggleRouteVisibility: MapStudioApp.#onToggleRouteVisibility,
            deleteRoute: MapStudioApp.#onDeleteRoute,
            zoomToPin: MapStudioApp.#onZoomToPin,
            editPin: MapStudioApp.#onEditPin,
            zoomToRoute: MapStudioApp.#onZoomToRoute,
            editRoute: MapStudioApp.#onEditRoute,
            togglePinDropdown: MapStudioApp.#onTogglePinDropdown,
            nudgeReference: MapStudioApp.#onNudgeReference,
            resetReferencePan: MapStudioApp.#onResetReferencePan,
            removeReferenceImage: MapStudioApp.#onRemoveReferenceImage,
            adjustReferenceScale: MapStudioApp.#onAdjustReferenceScale,
            resetReferenceScale: MapStudioApp.#onResetReferenceScale,
        },
    };

    // Define the application as three distinct rendering blocks.
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
        this.pinHistory = [];
        this.pinRedoStack = [];
        this.brushEngine = null;
        this.currentSaveId = null;
        this.currentSaveName = null;

        this.#allocateBuffers();
        this.hasBooted = false;

        // Persistent cache to protect slider values when tabs unmount
        this.defaultUiState = {
            // Scene Variables
            mapWidth: FILRODENSWMB.DEFAULTS.MAP_WIDTH,
            mapHeight: FILRODENSWMB.DEFAULTS.MAP_HEIGHT,
            gridType: "square",
            gridSize: 100,
            gridVisible: false,

            // Model Variables
            mapSeed: FILRODENSWMB.DEFAULTS.SEED,
            seaLevel: FILRODENSWMB.DEFAULTS.SEA_LEVEL,
            globalTemp: FILRODENSWMB.DEFAULTS.GLOBAL_TEMP,
            seasonOffset: 0,
            latTop: FILRODENSWMB.DEFAULTS.LAT_TOP,
            latBottom: FILRODENSWMB.DEFAULTS.LAT_BOTTOM,
            globalMoisture: 0.5,
            "noise.offsetX": 0,
            "noise.offsetY": 0,
            "noise.elevation.scale": FILRODENSWMB.NOISE.ELEVATION.SCALE,
            "noise.elevation.octaves": FILRODENSWMB.NOISE.ELEVATION.OCTAVES,
            "noise.elevation.stretch": FILRODENSWMB.NOISE.ELEVATION.STRETCH,
            "noise.moisture.scale": 500,
            "noise.moisture.octaves": FILRODENSWMB.NOISE.MOISTURE.OCTAVES,
            riverDensity: 40,

            // Settings UI Cache
            contourInterval: 0.1,
            biomeAlphaActive: FILRODENSWMB.DISPLAY.BIOME_ALPHA_ACTIVE,
            biomeAlphaInactive: FILRODENSWMB.DISPLAY.BIOME_ALPHA_INACTIVE,
            maxLakeSize: FILRODENSWMB.HYDROLOGY.MAX_LAKE_SIZE,
            springAltOffset: FILRODENSWMB.HYDROLOGY.SPRING_ALTITUDE_OFFSET,
            springMoistMin: FILRODENSWMB.HYDROLOGY.SPRING_MOISTURE_MIN,
            meanderJitter: FILRODENSWMB.HYDROLOGY.MEANDER_JITTER,
            altCooling: FILRODENSWMB.CLIMATE.ALTITUDE_COOLING,
            freezingThreshold: FILRODENSWMB.CLIMATE.FREEZING_THRESHOLD,

            // Infrastructure Variables
            activeIcon: "map_pin",
            activeInfraMode: "pin",
            snapToPoints: true,
            routeColor: "#ffffff",
            routeThickness: 3,
            routeStyle: "solid",
            activeRouteQuickStyle: "custom",

            // Reference Variables
            referenceImage: "",
            referenceAlpha: 0.5,
            referenceScale: 1,
            referenceX: FILRODENSWMB.DEFAULTS.MAP_WIDTH / 2,
            referenceY: FILRODENSWMB.DEFAULTS.MAP_HEIGHT / 2,
        };

        // The dynamic cache inherits from defaults on launch
        this.uiState = foundry.utils.deepClone(this.defaultUiState);
        this.customBiomeColors = {};

        this.debouncedGenerateTerrain = foundry.utils.debounce(this.generateTerrain.bind(this), 400);
        this.debouncedGenerateClimate = foundry.utils.debounce(this.generateClimate.bind(this), 200);
        this.debouncedGenerateFeatures = foundry.utils.debounce(this.generateFeatures.bind(this), 200);
    }

    /**
     * Prepares data specifically for individual parts.
     */
    async _preparePartContext(partId, context, options) {
        context = await super._preparePartContext(partId, context, options);
        context.config = FILRODENSWMB;
        context.activeTool = this.activeTool;

        // Helper to convert [R, G, B] array to a strict #RRGGBB hex string
        const rgbToHex = (rgb) => "#" + rgb.map((x) => x.toString(16).padStart(2, "0")).join("");

        // Unify IDs, Labels, and dynamically updating Hex Colours into a single array
        context.biomeList = Object.entries(FILRODENSWMB.BIOME_IDS)
            // Exclude Deep Ocean (1) and Shallow Ocean (2) from all UI lists
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

        if (partId === "context") {
            context.toolPartial = `modules/filrodens-world-map-builder/templates/tools-${this.activeTool}.hbs`;

            // Inject the compendium list dynamically when navigating to the Manage tab
            if (this.activeTool === "manage") {
                context.savedMaps = await getSavedMaps();
            }
        }

        context.uiState = this.uiState;

        context.infrastructureIcons = Object.entries(FILRODENSWMB.INFRASTRUCTURE_ICONS)
            .map(([id, label]) => ({
                id: id,
                label: label,
                _localized: game.i18n.localize(label),
            }))
            .sort((a, b) => a._localized.localeCompare(b._localized));

        // Inject the Route Styles for dynamic button generation
        context.routeStyles = Object.entries(FILRODENSWMB.ROUTE_STYLES).map(([id, data]) => ({
            id: id,
            label: data.label,
        }));

        if (partId === "context") {
            context.toolPartial = `modules/filrodens-world-map-builder/templates/tools-${this.activeTool}.hbs`;

            // Strictly filter out river springs so they don't appear in the sidebar list
            context.mapPins = (this.mapPins || []).filter((p) => !!p.icon);
            context.mapRoutes = this.mapRoutes || [];
        }

        return context;
    }

    _onRender(context, options) {
        super._onRender(context, options);

        // --- Universal Double-Click to Reset Sliders ---
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

        if (contextPanel && !contextPanel.dataset.hasNoiseListeners) {
            // Reference Settings File-Picker Intercept
            contextPanel.addEventListener("change", (event) => {
                if (event.target.matches('file-picker[name="referenceImage"]')) {
                    this.uiState.referenceImage = event.target.value;
                    this.#updateReferenceLayer();
                }
            });

            // Delegate 'input' events to the context panel.
            contextPanel.addEventListener("input", (event) => {
                // Reference Opacity Intercept
                if (event.target.matches('input[name="referenceAlpha"]')) {
                    this.uiState.referenceAlpha = Number(event.target.value);
                    this.#updateReferenceLayer();
                    return;
                }

                // Grid Configuration Intercept
                if (event.target.matches('[name="gridType"], input[name="gridSize"]')) {
                    this.#getMapParameters(); // Sync DOM to cache
                    this.#updateGrid();
                    return;
                }

                // Color Picker Intercept (Hex to RGB)
                if (event.target.matches('input[type="color"]')) {
                    const biomeKey = event.target.dataset.biome;
                    const hex = event.target.value;
                    const rgb = [Number.parseInt(hex.slice(1, 3), 16), Number.parseInt(hex.slice(3, 5), 16), Number.parseInt(hex.slice(5, 7), 16)];
                    this.customBiomeColors[biomeKey] = rgb;
                    this.#repaintCanvas();
                    return;
                }

                // Opacity & Overlay changes (Instant Visual Update)
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

                // Custom Route Settings Intercept
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
                            this.#repaintCanvas();
                        }
                    }
                    return;
                }

                if (event.target.matches('input[name^="noise.elevation"], input[name^="noise.offsetX"], input[name^="noise.offsetY"], input[name="mapSeed"]')) {
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

        // Connect the 60fps UI Readout
        if (this.canvasEngine) {
            this.canvasEngine.onCanvasHover = (x, y) => {
                const readout = this.element.querySelector(".fwmb-canvas-readout");
                if (!readout) return;

                // Hide the panel entirely if out of bounds or missing data
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

        // Ensure all layer toggle buttons visually match the 'visible' canvas state on launch
        // Nested inside the initialisation block so it never fires on tab switches
        if (!this.hasBooted) {
            this.hasBooted = true;
            const layerBtns = this.element.querySelectorAll('[data-action="toggleLayer"]');
            for (const btn of layerBtns) {
                btn.classList.add("active");
            }

            // Automatically generate the initial map
            setTimeout(() => this.generateTerrain(), 50);
        }

        // Restore Edit Button visual state if the UI was dynamically re-rendered while editing
        if (this.canvasEngine?.isEditMode) {
            const editBtn = this.element.querySelector('[data-action="toggleEditMode"]');
            if (editBtn) editBtn.classList.add("active");
        }
    }

    async close(options) {
        if (this.canvasEngine) this.canvasEngine.destroy();
        if (this.scene3D) this.scene3D.destroy();
        return super.close(options);
    }

    /**
     * Glues the UI DOM states to the spatial Raycaster and the Data engine.
     */
    #wireBrushCallbacks() {
        const getNum = (name) => Number.parseFloat(this.element.querySelector(`input[name="${name}"]`)?.value) || 0;

        this.canvasEngine.onBrushStart = (x, y) => {
            let layer = "terrain";
            if (this.activeTool === "biomes") layer = "biome";
            if (this.activeTool === "features") layer = "features";
            if (this.activeTool === "infrastructure") layer = "infrastructure";

            let tool = this.element.querySelector(`.fwmb-brush-tools button.active[data-tool-group~="${this.activeTool}"]`)?.dataset.tool || "raise";

            // Intercept POI tools completely bypassing the pixel brush engine
            if (layer === "features" && ["addSpring", "blockSpring", "erasePin"].includes(tool)) {
                // Find if we clicked on an existing pin (within 8 pixels)
                const existingIndex = this.mapPins.findIndex((p) => Math.hypot(p.x - x, p.y - y) < 8);

                // Snapshot the current state for the Undo button
                this.pinHistory.push({ pins: foundry.utils.deepClone(this.mapPins), routes: foundry.utils.deepClone(this.mapRoutes), activeRouteId: this.activeRouteId });
                this.pinRedoStack = [];

                if (tool === "erasePin") {
                    if (existingIndex > -1) this.mapPins.splice(existingIndex, 1);
                } else {
                    const pinType = tool === "addSpring" ? "spring" : "block_spring";
                    if (existingIndex > -1) {
                        // Overwrite existing pin if clicked directly
                        this.mapPins[existingIndex].type = pinType;
                    } else {
                        // Create a brand new pin
                        this.mapPins.push({ id: foundry.utils.randomID(), x, y, type: pinType });
                    }
                }

                this.#repaintCanvas();
                this.debouncedGenerateClimate();
                return; // Abort here so the pixel brush doesn't fire
            }

            // Intercept Infrastructure tools completely
            if (layer === "infrastructure") {
                this.#handleInfrastructureClick(x, y);
                return;
            }

            // Standard Pixel Painting (Terrain/Biomes)
            let paintValue = layer === "biome" ? Number.parseInt(this.element.querySelector('select[name="brushBiome"]')?.value) || 6 : null;
            this.brushEngine.startStroke(layer, tool, getNum("brushSize"), getNum("brushStrength"), getNum("brushFeather"), paintValue);
            this.#applyBrushStroke(x, y);
        };

        // --- Reference Layer Interactions ---
        this.canvasEngine.onReferencePan = (dx, dy) => {
            this.uiState.referenceX += dx;
            this.uiState.referenceY += dy;
            this.#updateReferenceLayer();
        };

        this.canvasEngine.onReferenceScale = (factor) => {
            this.uiState.referenceScale *= factor;

            // Constrain limits and sync the slider DOM
            this.uiState.referenceScale = Math.max(0.1, Math.min(this.uiState.referenceScale, 10));
            this.#syncDOMToState();
            this.#updateReferenceLayer();
        };

        // --- Brush Move ---
        this.canvasEngine.onBrushMove = (x, y) => {
            this.#applyBrushStroke(x, y);
        };

        this.canvasEngine.onBrushEnd = () => {
            this.brushEngine.endStroke();
        };

        // ---Infrastructure Drag ---
        this.canvasEngine.onInfraDragStart = () => {
            // Snapshot the state before the drag begins
            this.pinHistory.push({
                pins: foundry.utils.deepClone(this.mapPins),
                routes: foundry.utils.deepClone(this.mapRoutes),
                activeRouteId: this.activeRouteId,
            });
            this.pinRedoStack = [];
        };

        this.canvasEngine.onInfraDrag = () => {
            const infraPins = this.mapPins.filter((p) => !!p.icon);
            this.canvasEngine.renderInfrastructure(infraPins, this.mapRoutes, this.canvasEngine.isEditMode);
        };

        this.canvasEngine.onInfraDragEnd = () => {
            this.render({ parts: ["context"] });
        };

        // --- Shift-Click Node Insertion ---
        this.canvasEngine.onInfraInsertNode = (x, y) => {
            if (this.activeTool !== "infrastructure") return;

            // Safety: Ignore clicks outside the map boundaries
            if (x < 0 || x > this.mapWidth || y < 0 || y > this.mapHeight) return;

            // 1. Prevent Node Stacking: Ignore clicks directly on existing nodes or pins
            for (const route of this.mapRoutes) {
                for (const pt of route.points) {
                    if (Math.hypot(pt.x - x, pt.y - y) < 15) return;
                }
            }
            for (const pin of this.mapPins) {
                if (!pin.hidden && pin.icon && Math.hypot(pin.x - x, pin.y - y) < 15) return;
            }

            // 2. Insert Node: Find the closest line segment
            const segment = this.#getClosestRouteSegment(x, y);
            if (segment) {
                // Snapshot clean state before insertion
                this.pinHistory.push({
                    pins: foundry.utils.deepClone(this.mapPins),
                    routes: foundry.utils.deepClone(this.mapRoutes),
                    activeRouteId: this.activeRouteId,
                });
                this.pinRedoStack = [];

                segment.route.points.splice(segment.insertIndex, 0, { x: segment.projX, y: segment.projY });

                this.#repaintCanvas();
                this.render({ parts: ["context"] });
            }
        };

        // --- Ctrl-Click Node Deletion ---
        this.canvasEngine.onInfraDeleteNode = (target) => {
            if (this.activeTool !== "infrastructure") return;

            // Safety Check: The user specifically requested NOT to delete pins via canvas clicks.
            // Since pins have an 'icon' property and route points only have 'x' and 'y', we can cleanly abort.
            if (target.icon) return;

            // Find which route contains this exact mathematical node reference
            for (let i = 0; i < this.mapRoutes.length; i++) {
                const route = this.mapRoutes[i];
                const nodeIndex = route.points.indexOf(target);

                if (nodeIndex > -1) {
                    // Snapshot clean state before deletion
                    this.pinHistory.push({
                        pins: foundry.utils.deepClone(this.mapPins),
                        routes: foundry.utils.deepClone(this.mapRoutes),
                        activeRouteId: this.activeRouteId,
                    });
                    this.pinRedoStack = [];

                    // Splice the node out of the route
                    route.points.splice(nodeIndex, 1);

                    // Structural Cleanup: A vector line requires at least 2 points to exist.
                    // If we just deleted the second-to-last node, garbage collect the dead route.
                    if (route.points.length < 2) {
                        this.mapRoutes.splice(i, 1);
                        if (this.activeRouteId === route.id) this.activeRouteId = null;
                    }

                    this.#repaintCanvas();
                    this.render({ parts: ["context"] });
                    return; // Exit the loop once found and deleted
                }
            }
        };
    }

    /**
     * Centralised data reader. Syncs visible HTML inputs into the persistent cache,
     * then transforms the cache into strict mathematical parameters.
     */
    #getMapParameters() {
        // 1. Sync visible DOM inputs into the persistent UI state cache
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

        // 2. Build the exact mathematical payload expected by ProceduralEngine
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
        };

        return { currentSeed: this.uiState["mapSeed"], params };
    }

    // --- Action Handlers ---

    #updateBiomeOpacity() {
        if (!this.canvasEngine) return;
        const isActive = this.activeTool === "biomes";
        const alpha = isActive ? this.uiState.biomeAlphaActive : this.uiState.biomeAlphaInactive;
        this.canvasEngine.setBiomeOpacity(alpha);
    }

    static #onChangeTool(event, target) {
        const newTool = target.dataset.tool;
        if (!newTool || this.activeTool === newTool) return;

        // --- Gracefully exit edit mode if active ---
        const editToolbar = this.element.querySelector(".fwmb-edit-toolbar");
        if (editToolbar && !editToolbar.classList.contains("fwmb-hidden")) {
            // Hide the toolbar and end any active strokes
            editToolbar.classList.add("fwmb-hidden");
            this.brushEngine?.endStroke();

            // Un-toggle the main edit button
            const editBtn = this.element.querySelector('[data-action="toggleEditMode"]');
            if (editBtn) editBtn.classList.remove("active");

            // Tell the canvas to drop the brush cursor
            if (this.canvasEngine) this.canvasEngine.setEditMode(false);

            // Unlock the procedural generation inputs
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

        // Auto-activate the required layer for the selected tool and dynamically adjust opacity
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

        // Tell the canvas to engage reference mode mouse listeners
        if (this.canvasEngine) {
            this.canvasEngine.setReferenceMode(newTool === "reference");
        }

        // Toggle visibility of specific tool clusters in the floating edit bar
        if (editToolbar) {
            editToolbar.querySelectorAll("[data-tool-group]").forEach((el) => {
                const allowedTools = el.dataset.toolGroup.split(" ");
                let isVisible = allowedTools.includes(newTool);

                // Special handling to display the correct styling tools based on active sub-mode
                if (newTool === "infrastructure" && allowedTools.some((t) => t.startsWith("infrastructure-"))) {
                    isVisible = allowedTools.includes(`infrastructure-${this.uiState.activeInfraMode}`);
                }

                el.classList.toggle("fwmb-hidden", !isVisible);
            });
        }

        this.#syncInfraModeButtons();

        this.render({ parts: ["toolbar", "context"] });
    }

    static #onToggleGrid(event, target) {
        this.uiState.gridVisible = !this.uiState.gridVisible;
        target.classList.toggle("active", this.uiState.gridVisible);
        this.#updateGrid();
    }

    #updateGrid() {
        if (!this.canvasEngine) return;
        this.canvasEngine.drawGrid(this.uiState.gridType, this.uiState.gridSize, this.uiState.gridVisible);
    }

    static #onZoomIn(event, target) {
        this.canvasEngine?.zoomCamera(1.25);
    }

    static #onZoomOut(event, target) {
        this.canvasEngine?.zoomCamera(0.8);
    }

    static #onResetZoom(event, target) {
        this.canvasEngine?.resetCamera();
    }

    static async #onRandomizeSeed(event, target) {
        if (this.brushEngine && this.brushEngine.history.length > 0) {
            const confirmed = await foundry.applications.api.DialogV2.confirm({
                window: { title: game.i18n.localize("FILRODENSWMB.UI.Warning") },
                content: `<p>${game.i18n.localize("FILRODENSWMB.UI.SeedWarningContent")}</p>`,
                rejectClose: false,
                modal: true,
            });

            if (!confirmed) return;

            // Clear the spatial arrays so the new seed starts with a clean slate
            this.brushEngine.history = [];
            this.brushEngine.redoStack = [];
        }

        const input = this.element.querySelector('input[name="mapSeed"]');
        if (!input) return;

        input.value = Math.random().toString(36).substring(2, 8).toUpperCase();
        input.dispatchEvent(new Event("input", { bubbles: true }));
    }

    static #onToggleEditMode(event, target) {
        const toolbar = this.element.querySelector(".fwmb-edit-toolbar");
        if (!toolbar) return;

        const isActivating = toolbar.classList.toggle("fwmb-hidden") === false;
        target.closest("button").classList.toggle("active");

        if (this.canvasEngine) {
            this.canvasEngine.setEditMode(isActivating);
        }

        // Lock or unlock the procedural generation inputs (EXCEPT for vector tools)
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

        // Force a repaint if we are on features or infrastructure so edit pins/nodes instantly appear or disappear
        if (this.activeTool === "features" || this.activeTool === "infrastructure") {
            this.#repaintCanvas();
        }
    }

    async #repaintCanvas() {
        if (!this.currentElevationData) return;

        const seaLevel = this.uiState["seaLevel"];
        const engine = new ProceduralEngine();
        const { params } = this.#getMapParameters();
        const waterMask = this.bufferWaterMask;
        const riverVectors = this.currentRiverData ? this.currentRiverData.vectors : null;

        // 1. Generate and paint the flat Base Map (The underlying foundation)
        engine.createBaseMap(this.currentElevationData, this.mapWidth, this.mapHeight, seaLevel, this.bufferBase);
        this.canvasEngine.renderPixelBuffer("base", this.bufferBase, this.mapWidth, this.mapHeight);

        const baseBtn = this.element.querySelector('[data-layer="base"]');
        this.canvasEngine.toggleLayer("base", baseBtn ? baseBtn.classList.contains("active") : true);

        // 2. Generate and paint the shaded Topography
        engine.colorize(this.currentElevationData, this.currentTemperatureData, this.mapWidth, this.mapHeight, seaLevel, waterMask, params, this.bufferTopography);
        this.canvasEngine.renderPixelBuffer("topography", this.bufferTopography, this.mapWidth, this.mapHeight);

        const topoBtn = this.element.querySelector('[data-layer="topography"]');
        this.canvasEngine.toggleLayer("topography", topoBtn ? topoBtn.classList.contains("active") : true);

        // 3. Generate and paint the Whittaker Biomes
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

        // 4 Generate and paint Cartographic Contours
        const contourInterval = this.uiState["contourInterval"];
        engine.createContourMap(this.currentElevationData, this.mapWidth, this.mapHeight, contourInterval, seaLevel, this.bufferContours);
        this.canvasEngine.renderPixelBuffer("contours", this.bufferContours, this.mapWidth, this.mapHeight);

        // 5. Draw Vector Graphics (Rivers and POI Pins)
        if (riverVectors) {
            // Only show edit pins if the tool is active AND edit mode is toggled on
            const isEditModeActive = this.element.querySelector('[data-action="toggleEditMode"]')?.classList.contains("active");
            const showPins = this.activeTool === "features" && isEditModeActive;

            this.canvasEngine.renderRiverVectors(riverVectors, this.mapPins, showPins, waterMask);

            const featuresBtn = this.element.querySelector('[data-layer="features"]');
            this.canvasEngine.toggleLayer("features", featuresBtn ? featuresBtn.classList.contains("active") : true);
        }

        // 6. Draw Infrastructure Layer
        const isEditModeActive = this.canvasEngine?.isEditMode || false;
        const infraPins = this.mapPins.filter((p) => !!p.icon);
        this.canvasEngine.renderInfrastructure(infraPins, this.mapRoutes, isEditModeActive);
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

        // Toggle Off: Destroy context and restore 2D UI
        if (this.scene3D) {
            this.scene3D.destroy();
            this.scene3D = null;
            overlay.classList.add("fwmb-hidden");
            target.classList.remove("active");

            if (mapControls) mapControls.classList.remove("fwmb-hidden");
            if (contextPanel) contextPanel.style.display = "";

            // Only restore the edit toolbar if the Edit Mode button is actually active
            const editBtn = this.element.querySelector('[data-action="toggleEditMode"]');
            if (editToolbar && editBtn?.classList.contains("active")) {
                editToolbar.classList.remove("fwmb-hidden");
            }
            return;
        }

        // Toggle On: Show 3D and hide 2D UI
        overlay.classList.remove("fwmb-hidden");
        target.classList.add("active");

        if (mapControls) mapControls.classList.add("fwmb-hidden");
        if (editToolbar) editToolbar.classList.add("fwmb-hidden");
        if (contextPanel) contextPanel.style.display = "none";

        const { params } = this.#getMapParameters();
        const engine = new ProceduralEngine();
        const seaLevel = this.uiState["seaLevel"];
        const waterMask = this.currentRiverData ? this.currentRiverData.waterMask : null;

        // Generate a pristine Biome buffer specifically for the 3D drape.
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

        // Instantiate and boot the orchestrator
        this.scene3D = new Scene3D(overlay);

        // Extract the river vectors if they exist
        const riverVectors = this.currentRiverData ? this.currentRiverData.vectors : null;

        this.scene3D.render3DMap(this.currentElevationData, biomeBuffer, this.mapWidth, this.mapHeight, seaLevel, riverVectors, waterMask);
    }

    /**
     * Toggles visibility of the WebGL layers.
     */
    static #onToggleLayer(event, target) {
        const layerId = target.dataset.layer;
        if (!layerId || !this.canvasEngine) return;

        // Toggle the UI state class
        const isVisible = target.classList.toggle("active");

        // Pass the state to the rendering engine
        this.canvasEngine.toggleLayer(layerId, isVisible);
    }

    #applyBrushStroke(x, y) {
        if (!this.currentElevationData) return;
        const seaLevel = this.uiState["seaLevel"];

        // Pass all three override arrays to the unified brush engine
        if (this.brushEngine.applyBrush(x, y, this.currentElevationData, this.currentBiomeOverrides, this.currentSpringOverrides, seaLevel)) {
            this.#repaintCanvas();
            this.debouncedGenerateClimate();
        }
    }

    /**
     * Highly performant pipeline to rebuild the canvas strictly from the event history.
     */
    async #rebuildFromHistory() {
        const { params } = this.#getMapParameters();

        this.currentElevationData.set(this.baseElevationData);
        this.currentBiomeOverrides.fill(0);
        this.brushEngine.replayHistory(this.currentElevationData, this.currentBiomeOverrides, params.seaLevel);

        this.#repaintCanvas();
        this.debouncedGenerateClimate();
    }

    static #onUndoBrush(event, target) {
        if (this.activeTool === "features" || this.activeTool === "infrastructure") {
            if (this.pinHistory.length === 0) return;

            // Push current state to redo stack
            this.pinRedoStack.push({
                pins: foundry.utils.deepClone(this.mapPins),
                routes: foundry.utils.deepClone(this.mapRoutes),
                activeRouteId: this.activeRouteId,
            });

            // Pop previous state
            const state = this.pinHistory.pop();
            this.mapPins = state.pins || state;
            this.mapRoutes = state.routes || this.mapRoutes;
            this.activeRouteId = state.activeRouteId || null;

            this.#repaintCanvas();
            this.render({ parts: ["context"] });

            if (this.activeTool === "features") this.debouncedGenerateClimate();
        } else {
            // Raster History
            if (!this.baseElevationData || !this.brushEngine) return;
            if (this.brushEngine.undo()) {
                this.#rebuildFromHistory();
            }
        }
    }

    static #onRedoBrush(event, target) {
        if (this.activeTool === "features" || this.activeTool === "infrastructure") {
            if (this.pinRedoStack.length === 0) return;

            // Push current state to undo stack
            this.pinHistory.push({
                pins: foundry.utils.deepClone(this.mapPins),
                routes: foundry.utils.deepClone(this.mapRoutes),
                activeRouteId: this.activeRouteId,
            });

            // Pop next state
            const state = this.pinRedoStack.pop();
            this.mapPins = state.pins;
            this.mapRoutes = state.routes;
            this.activeRouteId = state.activeRouteId;

            this.#repaintCanvas();
            this.render({ parts: ["context"] });

            if (this.activeTool === "features") this.debouncedGenerateClimate();
        } else {
            // Raster History
            if (!this.baseElevationData || !this.brushEngine) return;
            if (this.brushEngine.redo()) {
                this.#rebuildFromHistory();
            }
        }
    }

    /**
     * Highly destructive action: Rebuilds the underlying webgl canvas and spatial arrays.
     */
    static async #onApplyResolution(event, target) {
        const widthInput = this.element.querySelector('input[name="mapWidth"]');
        const heightInput = this.element.querySelector('input[name="mapHeight"]');

        const newWidth = Number.parseInt(widthInput?.value) || FILRODENSWMB.DEFAULTS.MAP_WIDTH;
        const newHeight = Number.parseInt(heightInput?.value) || FILRODENSWMB.DEFAULTS.MAP_HEIGHT;

        // Abort if no changes were actually made
        if (newWidth === this.mapWidth && newHeight === this.mapHeight) return;

        // Warn the GM if there is ANY custom data (brush strokes or pins) that will be annihilated
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
                // User backed out: revert the HTML inputs visually to match current reality
                if (widthInput) widthInput.value = this.mapWidth;
                if (heightInput) heightInput.value = this.mapHeight;
                return;
            }
        }

        // Apply new limits
        this.mapWidth = newWidth;
        this.mapHeight = newHeight;
        this.#allocateBuffers();

        this.uiState.mapWidth = newWidth;
        this.uiState.mapHeight = newHeight;

        // Wipe brush and pin history as spatial grid coordinates are now completely invalid
        this.brushEngine = new BrushEngine(this.mapWidth, this.mapHeight);
        this.mapPins = [];
        this.pinHistory = [];
        this.pinRedoStack = [];

        // Triggers a complete top-to-bottom recalculation
        await this.generateTerrain();
        this.#updateGrid();
        this.canvasEngine.resetCamera();
    }

    /**
     * Generates the procedural noise maps.
     * Called automatically via debounced input events on the sliders.
     */
    async generateTerrain() {
        const { params } = this.#getMapParameters();
        const engine = new ProceduralEngine();

        console.log("World Map Builder | Generating Topography...");
        const t0 = performance.now();

        // 1. Generate base mathematical topography
        engine.generateTopography(this.mapWidth, this.mapHeight, params, this.baseElevationData);

        // 2. Clone the base array and stamp all brush edits onto it
        await this.#rebuildFromHistory();

        this.currentSpringOverrides.fill(0);

        const t1 = performance.now();
        console.log(`World Map Builder | Topography generated in ${(t1 - t0).toFixed(2)}ms`);

        // 3. Proceed to climate calculation using the newly edited topography
        await this.generateClimate();
    }

    async generateClimate() {
        if (!this.currentElevationData) return;
        const { params } = this.#getMapParameters();
        const engine = new ProceduralEngine();

        console.log("World Map Builder | Generating Climate Data...");
        const t0 = performance.now();

        engine.generateClimateData(this.currentElevationData, this.mapWidth, this.mapHeight, params, this.currentMoistureData, this.currentTemperatureData);

        const t1 = performance.now();
        console.log(`World Map Builder | Climate mapped in ${(t1 - t0).toFixed(2)}ms`);

        await this.generateFeatures();
    }

    /**
     * Final step in the procedural chain. Calculates water flow and spawns vectors.
     */
    async generateFeatures() {
        if (!this.currentElevationData) return;
        const { params } = this.#getMapParameters();
        const engine = new ProceduralEngine();

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

    /**
     * Handles swapping between the Raise, Lower, and Smooth brush tools.
     */
    static #onSetBrushTool(event, target) {
        // Ensure we only toggle buttons within the brush tools cluster
        const toolContainer = target.closest(".fwmb-brush-tools");
        if (!toolContainer) return;

        // Strip the active class from all sibling tool buttons
        for (const btn of toolContainer.querySelectorAll("button")) {
            btn.classList.remove("active");
        }

        // Add the active class to the newly clicked button.
        // target.closest("button") ensures this works even if the user clicks directly on the <i> icon inside the button.
        const activeBtn = target.closest("button");
        if (activeBtn) activeBtn.classList.add("active");
    }

    /**
     * Extracts the currently active canvas state to a PNG.
     */
    static async #onExportPng(event, target) {
        if (!this.canvasEngine || !this.currentElevationData) {
            ui.notifications.warn("No map is currently generated to export.");
            return;
        }

        // Use the saved name if it exists, otherwise default to "Unsaved Map"
        const mapName = this.currentSaveName || "Unsaved Map";

        ui.notifications.info(game.i18n.format("Exporting {name} to PNG...", { name: mapName }));
        this.canvasEngine.exportToPNG(mapName);
    }

    /**
     * Context-aware Quick Save.
     * Creates a new journal if none exists, otherwise overwrites the current ID.
     */
    static async #onSaveMap(event, target) {
        target.disabled = true;

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
        };

        // If no ID exists, trigger the "Save As" flow
        if (!this.currentSaveId) {
            const hash = currentSeed || Math.random().toString(36).substring(2, 8).toUpperCase();
            const defaultName = `Terrain Map (${hash})`;

            const mapName = await foundry.applications.api.DialogV2.prompt({
                window: { title: game.i18n.localize("FILRODENSWMB.UI.SaveAs") },
                content: `<label>Map Name</label><input type="text" id="fwmb-save-name" value="${defaultName}">`,
                ok: { callback: (event, button, dialog) => button.form.elements["fwmb-save-name"].value },
            });

            if (!mapName) {
                target.disabled = false;
                return; // User cancelled
            }
            this.currentSaveName = mapName;
        }

        // Save or Overwrite
        const journal = await saveMapData(this.currentSaveName, payload, this.currentSaveId);

        if (journal) {
            this.currentSaveId = journal.id;
            ui.notifications.info(game.i18n.format("FILRODENSWMB.UI.SaveSuccess", { name: journal.name }));
        } else {
            ui.notifications.error(game.i18n.localize("FILRODENSWMB.UI.SaveError"));
        }

        target.disabled = false;
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
                const payload = await loadMapData(mapId);
                if (payload) {
                    this.currentSaveId = mapId;
                    this.currentSaveName = card.querySelector(".fwmb-map-card-info").textContent.trim();
                    await this.#ingestMapPayload(payload);
                    ui.notifications.info(game.i18n.localize("FILRODENSWMB.UI.LoadSuccess"));
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

                    // Force sync the application memory if the renamed map is the currently active one
                    if (this.currentSaveId === mapId) {
                        this.currentSaveName = newName;
                        // If the database generated a new ID during the rename, catch it
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

                // Ultra-light schema validation
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

    async #ingestMapPayload(payload) {
        // 1. Unpack the seed
        this.uiState.mapSeed = payload.seed;

        this.mapWidth = payload.mapWidth;
        this.mapHeight = payload.mapHeight;
        this.uiState.mapWidth = this.mapWidth;
        this.uiState.mapHeight = this.mapHeight;
        this.uiState.gridType = payload.gridType || "square";
        this.uiState.gridSize = payload.gridSize || 100;

        this.#allocateBuffers();

        // Rebuild the brush engine to match the newly loaded spatial coordinates
        this.brushEngine = new BrushEngine(this.mapWidth, this.mapHeight);

        // 2. Unpack the core parameters
        const p = payload.params;
        this.uiState.seaLevel = p.seaLevel;
        this.uiState.globalTemp = p.globalTemp;
        this.uiState.seasonOffset = p.seasonOffset;
        this.uiState.latTop = p.latTop;
        this.uiState.latBottom = p.latBottom;
        this.uiState.globalMoisture = p.globalMoisture;
        this.uiState.riverDensity = p.riverDensity;

        // 3. Unpack and cleanly invert the noise scales
        this.uiState["noise.offsetX"] = p.noise.offsetX;
        this.uiState["noise.offsetY"] = p.noise.offsetY;
        this.uiState["noise.elevation.scale"] = Math.round(1 / p.noise.elevation.scale);
        this.uiState["noise.elevation.octaves"] = p.noise.elevation.octaves;
        this.uiState["noise.elevation.stretch"] = p.noise.elevation.stretch;
        this.uiState["noise.moisture.scale"] = Math.round(1 / p.noise.moisture.scale);
        this.uiState["noise.moisture.octaves"] = p.noise.moisture.octaves;

        // 4. Unpack Settings UI Cache (with safe defaults for legacy saves)
        this.uiState.maxLakeSize = p.hydrology?.maxLakeSize ?? FILRODENSWMB.HYDROLOGY.MAX_LAKE_SIZE;
        this.uiState.springAltOffset = p.hydrology?.springAltOffset ?? FILRODENSWMB.HYDROLOGY.SPRING_ALTITUDE_OFFSET;
        this.uiState.springMoistMin = p.hydrology?.springMoistMin ?? FILRODENSWMB.HYDROLOGY.SPRING_MOISTURE_MIN;
        this.uiState.meanderJitter = p.hydrology?.meanderJitter ?? FILRODENSWMB.HYDROLOGY.MEANDER_JITTER;
        this.uiState.altCooling = p.climate?.altCooling ?? FILRODENSWMB.CLIMATE.ALTITUDE_COOLING;
        this.uiState.freezingThreshold = p.climate?.freezingThreshold ?? FILRODENSWMB.CLIMATE.FREEZING_THRESHOLD;
        this.uiState.contourInterval = p.display?.contourInterval ?? 0.1;
        this.uiState.biomeAlphaActive = p.display?.biomeAlphaActive ?? FILRODENSWMB.DISPLAY.BIOME_ALPHA_ACTIVE;
        this.uiState.biomeAlphaInactive = p.display?.biomeAlphaInactive ?? FILRODENSWMB.DISPLAY.BIOME_ALPHA_INACTIVE;

        // 5. Restore Spatial Arrays and Custom Styling
        this.customBiomeColors = p.customColors || {};
        this.mapPins = payload.mapPins || [];
        this.mapRoutes = payload.mapRoutes || [];

        this.brushEngine.history = payload.history || [];
        this.brushEngine.redoStack = [];
        this.pinHistory = [];
        this.pinRedoStack = [];

        // 6. Visually synchronise the HTML sliders
        this.#syncDOMToState();
        this.#updateGrid();

        // 7. Await the full mathematical rebuild. History is now automatically applied inside generateTerrain.
        await this.generateTerrain();
        this.canvasEngine.resetCamera();
    }

    #syncDOMToState() {
        for (const [key, value] of Object.entries(this.uiState)) {
            const input = this.element.querySelector(`[name="${key}"]`);
            if (!input) continue;

            input.value = value;
            if (input.nextElementSibling?.tagName === "OUTPUT") {
                input.nextElementSibling.value = value;
            }
        }

        // Specifically rebuild Hex strings for the colour pickers
        for (const [key, rgb] of Object.entries(this.customBiomeColors)) {
            const input = this.element.querySelector(`input[data-biome="${key}"]`);
            if (!input) continue;

            input.value = "#" + rgb.map((x) => x.toString(16).padStart(2, "0")).join("");
        }
    }

    static #onAdjustNoiseScale(event, target) {
        const dir = Number(target.dataset.dir);
        const input = this.element.querySelector('input[name="noise.elevation.scale"]');
        if (!input) return;

        let scale = Number(input.value);
        scale += dir * 50;
        scale = Math.max(100, Math.min(scale, 1000)); // Constrain to original slider limits

        input.value = scale;
        input.dispatchEvent(new Event("input", { bubbles: true }));
    }

    static #onResetNoiseScale(event, target) {
        const input = this.element.querySelector('input[name="noise.elevation.scale"]');
        if (input) {
            input.value = this.defaultUiState["noise.elevation.scale"];
            input.dispatchEvent(new Event("input", { bubbles: true }));
        }
    }

    static #onNudgeNoise(event, target) {
        const dx = Number(target.dataset.dx);
        const dy = Number(target.dataset.dy);

        const inputX = this.element.querySelector('input[name="noise.offsetX"]');
        const inputY = this.element.querySelector('input[name="noise.offsetY"]');
        if (!inputX || !inputY) return;

        inputX.value = Number(inputX.value) + dx;
        inputY.value = Number(inputY.value) + dy;

        // Dispatching a single event triggers the unified engine rebuild
        inputX.dispatchEvent(new Event("input", { bubbles: true }));
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

    #allocateBuffers() {
        const totalPixels = this.mapWidth * this.mapHeight;

        // 1D Mathematical Arrays
        this.baseElevationData = new Float32Array(totalPixels);
        this.currentElevationData = new Float32Array(totalPixels);
        this.currentMoistureData = new Float32Array(totalPixels);
        this.currentTemperatureData = new Float32Array(totalPixels);
        this.currentBiomeOverrides = new Uint8Array(totalPixels);
        this.currentSpringOverrides = new Uint8Array(totalPixels);
        this.bufferRiverMap = new Uint8Array(totalPixels);
        this.bufferWaterMask = new Float32Array(totalPixels);

        // RGBA Visual Rendering Buffers (4 bytes per pixel)
        this.bufferBase = new Uint8Array(totalPixels * 4);
        this.bufferTopography = new Uint8Array(totalPixels * 4);
        this.bufferBiomes = new Uint8Array(totalPixels * 4);
        this.bufferContours = new Uint8Array(totalPixels * 4);
    }

    /**
     * Finds the nearest visible pin within a 20-pixel radius for route snapping.
     */
    #getSnappedCoordinates(x, y, threshold = 20) {
        let closest = { x, y, dist: Infinity };

        for (const pin of this.mapPins) {
            // Skip hidden POIs and river springs
            if (pin.hidden || !pin.icon) continue;

            const dist = Math.hypot(pin.x - x, pin.y - y);
            if (dist < closest.dist && dist <= threshold) {
                closest = { x: pin.x, y: pin.y, dist };
            }
        }

        return closest.dist === Infinity ? { x, y } : { x: closest.x, y: closest.y };
    }

    /**
     * Routes clicks to either the Pin placement or Spline extension logic.
     */
    #handleInfrastructureClick(x, y) {
        // Prevent placing infrastructure outside the canvas boundaries
        if (x < 0 || x > this.mapWidth || y < 0 || y > this.mapHeight) return;

        this.pinHistory.push({
            pins: foundry.utils.deepClone(this.mapPins),
            routes: foundry.utils.deepClone(this.mapRoutes),
            activeRouteId: this.activeRouteId,
        });
        this.pinRedoStack = [];

        const finalPos = this.uiState.snapToPoints ? this.#getSnappedCoordinates(x, y) : { x, y };

        if (this.uiState.activeInfraMode === "pin") {
            const newPin = {
                id: foundry.utils.randomID(),
                name: game.i18n.localize(FILRODENSWMB.INFRASTRUCTURE_ICONS[this.uiState.activeIcon] || "Pin"),
                icon: this.uiState.activeIcon,
                x: finalPos.x,
                y: finalPos.y,
                hidden: false,
            };
            this.mapPins.push(newPin);
        } else if (this.uiState.activeInfraMode === "route") {
            if (this.activeRouteId) {
                // Extend the existing active route
                const route = this.mapRoutes.find((r) => r.id === this.activeRouteId);
                if (route) {
                    const lastPt = route.points[route.points.length - 1];
                    // Double-click detection (clicking within 5 pixels of the last node ends the route)
                    if (Math.hypot(lastPt.x - finalPos.x, lastPt.y - finalPos.y) < 5) {
                        this.activeRouteId = null;
                    } else {
                        route.points.push(finalPos);
                    }
                }
            } else {
                // Initiate a new route
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

        this.#repaintCanvas();
        this.render({ parts: ["context"] }); // Re-render sidebar to show the new list item
    }

    static #onToggleSnapping(event, target) {
        this.uiState.snapToPoints = !this.uiState.snapToPoints;
        target.classList.toggle("active", this.uiState.snapToPoints);
    }

    static #onSetRouteStyle(event, target) {
        const styleId = target.dataset.style;
        const styleData = FILRODENSWMB.ROUTE_STYLES[styleId];

        if (!styleData) return;

        this.uiState.activeInfraMode = "route";
        this.uiState.activeRouteQuickStyle = styleId;
        this.activeRouteId = null;

        // Apply data-driven parameters
        this.uiState.routeColor = styleData.color;
        this.uiState.routeThickness = styleData.thickness;
        this.uiState.routeStyle = styleData.style;

        this.#syncDOMToState();
        this.#syncInfraModeButtons();

        this.render({ parts: ["context"] });
    }

    static #onTogglePinVisibility(event, target) {
        const id = target.closest(".fwmb-list-item").dataset.id;
        const pin = this.mapPins.find((p) => p.id === id);
        if (pin) {
            pin.hidden = !pin.hidden;
            this.#repaintCanvas();
            this.render({ parts: ["context"] });
        }
    }

    static #onDeletePin(event, target) {
        const id = target.closest(".fwmb-list-item").dataset.id;
        this.mapPins = this.mapPins.filter((p) => p.id !== id);
        this.#repaintCanvas();
        this.render({ parts: ["context"] });
    }

    static #onToggleRouteVisibility(event, target) {
        const id = target.closest(".fwmb-list-item").dataset.id;
        const route = this.mapRoutes.find((r) => r.id === id);
        if (route) {
            route.hidden = !route.hidden;
            this.#repaintCanvas();
            this.render({ parts: ["context"] });
        }
    }

    static #onDeleteRoute(event, target) {
        const id = target.closest(".fwmb-list-item").dataset.id;
        this.mapRoutes = this.mapRoutes.filter((r) => r.id !== id);
        if (this.activeRouteId === id) this.activeRouteId = null;
        this.#repaintCanvas();
        this.render({ parts: ["context"] });
    }

    static #onZoomToPin(event, target) {
        const id = target.closest(".fwmb-list-item").dataset.id;
        const pin = this.mapPins.find((p) => p.id === id);
        if (pin && this.canvasEngine) {
            this.canvasEngine.zoomToFeature([pin]);
        }
    }

    static #onZoomToRoute(event, target) {
        const id = target.closest(".fwmb-list-item").dataset.id;
        const route = this.mapRoutes.find((r) => r.id === id);
        if (route?.points && this.canvasEngine) {
            this.canvasEngine.zoomToFeature(route.points);
        }
    }

    static async #onEditPin(event, target) {
        const id = target.closest(".fwmb-list-item").dataset.id;
        const pin = this.mapPins.find((p) => p.id === id);
        if (!pin) return;

        // Reconstruct the Icon Dictionary into an alphabetically sorted dropdown list
        const iconOptions = Object.entries(FILRODENSWMB.INFRASTRUCTURE_ICONS)
            .map(([key, label]) => ({
                key: key,
                localized: game.i18n.localize(label),
            }))
            .sort((a, b) => a.localized.localeCompare(b.localized))
            .map(({ key, localized }) => {
                const isSelected = key === pin.icon ? "selected" : "";
                return `<option value="${key}" ${isSelected}>${localized}</option>`;
            })
            .join("");

        const content = `
            <div class="form-group stacked">
                <label>${game.i18n.localize("FILRODENSWMB.UI.Name")}</label>
                <input type="text" name="pinName" value="${pin.name || ""}" />
            </div>
            <div class="form-group stacked">
                <label>${game.i18n.localize("FILRODENSWMB.UI.Description")}</label>
                <textarea class="fwmb-scrollable stable" name="pinDesc" rows="4">${pin.description || ""}</textarea>
            </div>
            <div class="form-group">
                <label>${game.i18n.localize("FILRODENSWMB.UI.SelectIcon")}</label>
                <select name="pinIcon">${iconOptions}</select>
            </div>
        `;

        const result = await foundry.applications.api.DialogV2.prompt({
            classes: ["fwmb"],
            window: { title: game.i18n.localize("FILRODENSWMB.UI.EditPin") },
            content: content,
            ok: {
                callback: (event, button, dialog) => {
                    return {
                        name: button.form.elements["pinName"].value,
                        description: button.form.elements["pinDesc"].value,
                        icon: button.form.elements["pinIcon"].value,
                    };
                },
            },
        });

        if (result) {
            this.pinHistory.push({
                pins: foundry.utils.deepClone(this.mapPins),
                routes: foundry.utils.deepClone(this.mapRoutes),
                activeRouteId: this.activeRouteId,
            });
            this.pinRedoStack = [];

            pin.name = result.name;
            pin.description = result.description;
            pin.icon = result.icon;

            this.#repaintCanvas();
            this.render({ parts: ["context"] });
        }
    }

    static async #onEditRoute(event, target) {
        const id = target.closest(".fwmb-list-item").dataset.id;
        const route = this.mapRoutes.find((r) => r.id === id);
        if (!route) return;

        const styles = [
            { value: "solid", label: "FILRODENSWMB.UI.StyleSolid" },
            { value: "dashed", label: "FILRODENSWMB.UI.StyleDashed" },
            { value: "dotted", label: "FILRODENSWMB.UI.StyleDotted" },
        ];

        const styleOptions = styles
            .map((s) => {
                const isSelected = s.value === route.style ? "selected" : "";
                return `<option value="${s.value}" ${isSelected}>${game.i18n.localize(s.label)}</option>`;
            })
            .join("");

        const content = `
            <div class="form-group stacked">
                <label>${game.i18n.localize("FILRODENSWMB.UI.Name")}</label>
                <input type="text" name="routeName" value="${route.name || ""}" />
            </div>
            <div class="form-group stacked">
                <label>${game.i18n.localize("FILRODENSWMB.UI.Description")}</label>
                <textarea class="fwmb-scrollable stable" name="routeDesc" rows="4">${route.description || ""}</textarea>
            </div>
            <div class="form-group">
                <label>${game.i18n.localize("FILRODENSWMB.UI.LineColor")}</label>
                <input type="color" name="routeColor" value="${route.color}" />
            </div>
            <div class="form-group">
                <label>${game.i18n.localize("FILRODENSWMB.UI.LineThickness")}</label>
                <input type="number" name="routeThickness" value="${route.thickness}" min="1" max="10" />
            </div>
            <div class="form-group">
                <label>${game.i18n.localize("FILRODENSWMB.UI.LineStyle")}</label>
                <select name="routeStyle">${styleOptions}</select>
            </div>
        `;

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
            this.pinHistory.push({
                pins: foundry.utils.deepClone(this.mapPins),
                routes: foundry.utils.deepClone(this.mapRoutes),
                activeRouteId: this.activeRouteId,
            });
            this.pinRedoStack = [];

            route.name = result.name;
            route.description = result.description;
            route.color = result.color;
            route.thickness = result.thickness;
            route.style = result.style;

            this.#repaintCanvas();
            this.render({ parts: ["context"] });
        }
    }

    /**
     * Updates the active classes on the edit toolbar infrastructure buttons.
     */
    #syncInfraModeButtons() {
        const mode = this.uiState.activeInfraMode;

        // 1. Toggle the explicit Mode Buttons (Pin vs Route)
        const modeBtns = this.element.querySelectorAll('.fwmb-edit-toolbar [data-action="setInfraMode"]');
        for (const btn of modeBtns) {
            btn.classList.toggle("active", btn.dataset.mode === mode);
        }

        // 2. Toggle the Quick Style Buttons
        const styleBtns = this.element.querySelectorAll('.fwmb-edit-toolbar [data-action="setRouteStyle"]');
        for (const btn of styleBtns) {
            btn.classList.toggle("active", btn.dataset.style === this.uiState.activeRouteQuickStyle);
        }

        // 3. Toggle the specific creation tools based on the active mode
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

    static #onSetInfrastructureIcon(event, target) {
        this.uiState.activeIcon = target.dataset.icon;
        this.uiState.activeInfraMode = "pin";
        this.activeRouteId = null;

        // Visually update the custom dropdown trigger to show the new selection
        const triggerImg = this.element.querySelector(".fwmb-active-icon-img");
        if (triggerImg) triggerImg.src = `modules/filrodens-world-map-builder/assets/pinhead-icons/${this.uiState.activeIcon}.svg`;

        // Automatically hide the grid dropdown once clicked
        const dropdown = this.element.querySelector("#fwmb-pin-select .fwmb-select-options");
        if (dropdown) dropdown.classList.add("fwmb-hidden");

        this.#syncInfraModeButtons();
    }

    /**
     * Handles manual switching between Point and Route modes via the edit toolbar.
     */
    static #onSetInfraMode(event, target) {
        this.uiState.activeInfraMode = target.dataset.mode;
        this.activeRouteId = null; // Drop any active line when swapping modes
        this.#syncInfraModeButtons();
    }

    static #onTogglePinDropdown(event, target) {
        const dropdown = target.closest(".fwmb-custom-select").querySelector(".fwmb-select-options");
        if (dropdown) dropdown.classList.toggle("fwmb-hidden");
    }

    /**
     * Calculates the perpendicular distance from a point to all line segments
     * to find the closest route insertion point.
     */
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

    #updateReferenceLayer() {
        if (this.canvasEngine) {
            this.canvasEngine.updateReferenceImage(this.uiState.referenceImage, this.uiState.referenceX, this.uiState.referenceY, this.uiState.referenceScale, this.uiState.referenceAlpha);
        }
    }

    static #onNudgeReference(event, target) {
        const dx = Number(target.dataset.dx);
        const dy = Number(target.dataset.dy);

        this.uiState.referenceX += dx;
        this.uiState.referenceY += dy;
        this.#updateReferenceLayer();
    }

    static #onResetReferencePan(event, target) {
        this.uiState.referenceX = this.mapWidth / 2;
        this.uiState.referenceY = this.mapHeight / 2;
        this.#updateReferenceLayer();
    }

    static #onRemoveReferenceImage(event, target) {
        this.uiState.referenceImage = "";

        // Reset the v14 file-picker UI element visually
        const filePicker = this.element.querySelector('file-picker[name="referenceImage"]');
        if (filePicker) filePicker.value = "";

        this.#updateReferenceLayer();
    }

    static #onAdjustReferenceScale(event, target) {
        const dir = Number(target.dataset.dir);
        // Apply a fine 1% scale adjustment per click
        const factor = dir > 0 ? 1.01 : 0.99;

        this.uiState.referenceScale *= factor;
        this.uiState.referenceScale = Math.max(0.1, Math.min(this.uiState.referenceScale, 10));

        this.#updateReferenceLayer();
    }

    static #onResetReferenceScale(event, target) {
        this.uiState.referenceScale = 1.0;
        this.#updateReferenceLayer();
    }
}
