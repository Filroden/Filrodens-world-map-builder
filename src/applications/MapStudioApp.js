import { FILRODENSWMB } from "../config.js";
import { StudioCanvas } from "../canvas/StudioCanvas.js";
import { ProceduralEngine } from "../generation/ProceduralEngine.js";
import { BrushEngine } from "../tools/BrushEngine.js";
import { getSavedMaps, loadMapData, saveMapData } from "../data/compendium.js";
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
            saveMap: MapStudioApp.#onSaveMap,
            loadMap: MapStudioApp.#onLoadMapDialog,
            threeDView: MapStudioApp.#onThreeDView,
            toggleLayer: MapStudioApp.#onToggleLayer,
            applyResolution: MapStudioApp.#onApplyResolution,
            adjustNoiseScale: MapStudioApp.#onAdjustNoiseScale,
            resetNoiseScale: MapStudioApp.#onResetNoiseScale,
            nudgeNoise: MapStudioApp.#onNudgeNoise,
            resetNoisePan: MapStudioApp.#onResetNoisePan,
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
        this.pinHistory = [];
        this.pinRedoStack = [];
        this.brushEngine = null;

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
        }

        context.uiState = this.uiState;

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

        // Delegate 'input' events to the context panel.
        const contextPanel = this.element.querySelector(".fwmb-context-panel");
        if (contextPanel && !contextPanel.dataset.hasNoiseListeners) {
            contextPanel.addEventListener("input", (event) => {
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
        if (!this.currentElevationData) {
            const layerBtns = this.element.querySelectorAll('[data-action="toggleLayer"]');
            for (const btn of layerBtns) {
                btn.classList.add("active");
            }

            // Automatically generate the initial map
            setTimeout(() => this.generateTerrain(), 50);
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

            let tool = this.element.querySelector(`.fwmb-brush-tools button.active[data-tool-group~="${this.activeTool}"]`)?.dataset.tool || "raise";

            // Intercept POI tools completely bypassing the pixel brush engine
            if (layer === "features" && ["addSpring", "blockSpring", "erasePin"].includes(tool)) {
                // Find if we clicked on an existing pin (within 8 pixels)
                const existingIndex = this.mapPins.findIndex((p) => Math.hypot(p.x - x, p.y - y) < 8);

                // Snapshot the current state for the Undo button
                this.pinHistory.push(foundry.utils.deepClone(this.mapPins));
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

            // Standard Pixel Painting (Terrain/Biomes)
            let paintValue = layer === "biome" ? Number.parseInt(this.element.querySelector('select[name="brushBiome"]')?.value) || 6 : null;
            this.brushEngine.startStroke(layer, tool, getNum("brushSize"), getNum("brushStrength"), getNum("brushFeather"), paintValue);
            this.#applyBrushStroke(x, y);
        };

        this.canvasEngine.onBrushMove = (x, y) => {
            this.#applyBrushStroke(x, y);
        };

        this.canvasEngine.onBrushEnd = () => {
            this.brushEngine.endStroke();
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

        // Toggle visibility of specific tool clusters in the floating edit bar
        const editToolbar = this.element.querySelector(".fwmb-edit-toolbar");
        if (editToolbar) {
            editToolbar.querySelectorAll("[data-tool-group]").forEach((el) => {
                const allowedTools = el.dataset.toolGroup.split(" ");
                el.classList.toggle("fwmb-hidden", !allowedTools.includes(newTool));
            });
        }

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

        // Lock or unlock the procedural generation inputs
        const panel = this.element.querySelector(".fwmb-context-panel");
        if (panel) {
            const controls = panel.querySelectorAll("fieldset input, fieldset button");
            for (const control of controls) {
                control.disabled = isActivating;
            }
            // Apply a visual dimming class to the fieldsets
            panel.classList.toggle("fwmb-locked", isActivating);
        }
    }

    #repaintCanvas() {
        const seaLevel = this.uiState["seaLevel"];
        const engine = new ProceduralEngine();
        const { params } = this.#getMapParameters();

        // Safely extract the features
        const waterMask = this.currentRiverData ? this.currentRiverData.waterMask : null;
        const riverVectors = this.currentRiverData ? this.currentRiverData.vectors : null;

        // 1. Generate and paint the flat Base Map (The underlying foundation)
        const baseBuffer = engine.createBaseMap(this.currentElevationData, this.mapWidth, this.mapHeight, seaLevel);
        this.canvasEngine.renderPixelBuffer("base", baseBuffer, this.mapWidth, this.mapHeight);

        const baseBtn = this.element.querySelector('[data-layer="base"]');
        this.canvasEngine.toggleLayer("base", baseBtn ? baseBtn.classList.contains("active") : true);

        // 2. Generate and paint the shaded Topography
        const topBuffer = engine.colorize(this.currentElevationData, this.currentTemperatureData, this.mapWidth, this.mapHeight, seaLevel, waterMask, params);
        this.canvasEngine.renderPixelBuffer("topography", topBuffer, this.mapWidth, this.mapHeight);

        const topoBtn = this.element.querySelector('[data-layer="topography"]');
        this.canvasEngine.toggleLayer("topography", topoBtn ? topoBtn.classList.contains("active") : true);

        // 3. Generate and paint the Whittaker Biomes
        if (this.currentMoistureData && this.currentTemperatureData) {
            const biomeBuffer = engine.createBiomesMap(
                this.currentElevationData,
                this.currentMoistureData,
                this.currentTemperatureData,
                this.currentBiomeOverrides,
                this.mapWidth,
                this.mapHeight,
                seaLevel,
                waterMask,
                params,
            );
            this.canvasEngine.renderPixelBuffer("biomes", biomeBuffer, this.mapWidth, this.mapHeight);

            const biomesBtn = this.element.querySelector('[data-layer="biomes"]');
            this.canvasEngine.toggleLayer("biomes", biomesBtn ? biomesBtn.classList.contains("active") : true);
        }

        // 4 Generate and paint Cartographic Contours
        const contourInterval = this.uiState["contourInterval"];
        if (contourInterval > 0) {
            const contourBuffer = engine.createContourMap(this.currentElevationData, this.mapWidth, this.mapHeight, contourInterval, seaLevel);
            this.canvasEngine.renderPixelBuffer("contours", contourBuffer, this.mapWidth, this.mapHeight);

            const contourBtn = this.element.querySelector('[data-layer="contours"]');
            this.canvasEngine.toggleLayer("contours", contourBtn ? contourBtn.classList.contains("active") : true);
        }

        // 5. Draw Vector Graphics (Rivers and POI Pins)
        if (riverVectors) {
            const showPins = this.activeTool === "features";
            this.canvasEngine.renderRiverVectors(riverVectors, this.mapPins, showPins, waterMask);

            const featuresBtn = this.element.querySelector('[data-layer="features"]');
            this.canvasEngine.toggleLayer("features", featuresBtn ? featuresBtn.classList.contains("active") : true);
        }
    }

    /**
     * Toggles the interactive 3D topography visualisation.
     */
    static async #onThreeDView(event, target) {
        const overlay = this.element.querySelector("#fwmb-3d-overlay");
        const mapControls = this.element.querySelector(".fwmb-map-controls");
        const editToolbar = this.element.querySelector(".fwmb-edit-toolbar");

        if (!overlay || !this.currentElevationData) return;

        // Toggle Off: Destroy context and restore 2D UI
        if (this.scene3D) {
            this.scene3D.destroy();
            this.scene3D = null;
            overlay.classList.add("fwmb-hidden");
            target.classList.remove("active");

            if (mapControls) mapControls.classList.remove("fwmb-hidden");

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

        const { params } = this.#getMapParameters();
        const engine = new ProceduralEngine();
        const seaLevel = this.uiState["seaLevel"];
        const waterMask = this.currentRiverData ? this.currentRiverData.waterMask : null;

        // Generate a pristine Biome buffer specifically for the 3D drape.
        const biomeBuffer = engine.createBiomesMap(
            this.currentElevationData,
            this.currentMoistureData,
            this.currentTemperatureData,
            this.currentBiomeOverrides,
            this.mapWidth,
            this.mapHeight,
            seaLevel,
            waterMask,
            params,
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
    #rebuildFromHistory() {
        this.currentElevationData = new Float32Array(this.baseElevationData);
        this.currentBiomeOverrides = new Uint8Array(this.mapWidth * this.mapHeight);
        this.brushEngine.replayHistory(this.currentElevationData, this.currentBiomeOverrides, this.uiState["seaLevel"]);

        this.#repaintCanvas();
        this.debouncedGenerateClimate();
    }

    static #onUndoBrush(event, target) {
        if (this.activeTool === "features") {
            // Route to Vector History
            if (this.pinHistory.length === 0) return;
            this.pinRedoStack.push(foundry.utils.deepClone(this.mapPins));
            this.mapPins = this.pinHistory.pop();

            this.#repaintCanvas();
            this.debouncedGenerateClimate();
        } else {
            // Route to Raster History
            if (!this.baseElevationData || !this.brushEngine) return;
            if (this.brushEngine.undo()) {
                this.#rebuildFromHistory();
            }
        }
    }

    static #onRedoBrush(event, target) {
        if (this.activeTool === "features") {
            if (this.pinRedoStack.length === 0) return;
            this.pinHistory.push(foundry.utils.deepClone(this.mapPins));
            this.mapPins = this.pinRedoStack.pop();

            this.#repaintCanvas();
            this.debouncedGenerateClimate();
        } else {
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
        this.uiState.mapWidth = newWidth;
        this.uiState.mapHeight = newHeight;

        // Wipe brush and pin history as spatial grid coordinates are now completely invalid
        this.brushEngine = new BrushEngine(this.mapWidth, this.mapHeight);
        this.mapPins = [];
        this.pinHistory = [];
        this.pinRedoStack = [];

        // Triggers a complete top-to-bottom recalculation
        this.generateTerrain();
        this.#updateGrid();
    }

    /**
     * Generates the procedural noise maps.
     * Called automatically via debounced input events on the sliders.
     */
    async generateTerrain() {
        const { currentSeed, params } = this.#getMapParameters();
        const engine = new ProceduralEngine(currentSeed);

        const t0 = performance.now();
        this.baseElevationData = engine.generateTopography(this.mapWidth, this.mapHeight, params);
        this.currentElevationData = new Float32Array(this.baseElevationData);
        this.currentBiomeOverrides = new Uint8Array(this.mapWidth * this.mapHeight);
        this.currentSpringOverrides = new Uint8Array(this.mapWidth * this.mapHeight);
        const t1 = performance.now();

        console.log(`World Map Builder | Topography calculated in ${Math.round(t1 - t0)}ms`);

        // Chain the climate generation automatically after topography finishes
        await this.generateClimate();
    }

    async generateClimate() {
        if (!this.currentElevationData) return;

        const { currentSeed, params } = this.#getMapParameters();
        const engine = new ProceduralEngine(currentSeed);

        const t0 = performance.now();
        const climateData = engine.generateClimateData(this.currentElevationData, this.mapWidth, this.mapHeight, params);

        this.currentMoistureData = climateData.moistureData;
        this.currentTemperatureData = climateData.temperatureData;
        const t1 = performance.now();

        console.log(`World Map Builder | Climate calculated in ${Math.round(t1 - t0)}ms`);

        // Chain the final features generation automatically
        await this.generateFeatures();
    }

    /**
     * Final step in the procedural chain. Calculates water flow and spawns vectors.
     */
    async generateFeatures() {
        if (!this.currentElevationData || !this.currentMoistureData || !this.currentTemperatureData) return;

        const { currentSeed, params } = this.#getMapParameters();
        const engine = new ProceduralEngine(currentSeed);

        const t0 = performance.now();
        this.currentRiverData = engine.generateRivers(this.currentElevationData, this.currentMoistureData, this.currentTemperatureData, this.mapPins, this.mapWidth, this.mapHeight, params);
        const t1 = performance.now();

        console.log(`World Map Builder | Rivers calculated in ${Math.round(t1 - t0)}ms`);

        if (this.canvasEngine) {
            this.#repaintCanvas();
        }
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
     * Packages the current mathematical state and brush history, and saves it to the compendium.
     */
    static async #onSaveMap(event, target) {
        // Prevent spam-clicking while the database operation resolves
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
        };

        // Auto-generate a fallback name using the seed string or a random hash
        const hash = currentSeed || Math.random().toString(36).substring(2, 8).toUpperCase();

        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, "0");
        const day = String(now.getDate()).padStart(2, "0");
        const hours = String(now.getHours()).padStart(2, "0");
        const mins = String(now.getMinutes()).padStart(2, "0");
        const timestamp = `${year}${month}${day} ${hours}:${mins}`;

        const mapName = `Terrain Map (${hash}) ${timestamp}`;

        const journal = await saveMapData(mapName, payload);

        if (journal) {
            ui.notifications.info(game.i18n.format("FILRODENSWMB.UI.SaveSuccess", { name: journal.name }));
        } else {
            ui.notifications.error(game.i18n.localize("FILRODENSWMB.UI.SaveError"));
        }

        target.disabled = false;
    }

    static async #onLoadMapDialog(event, target) {
        // Warn the GM if they are about to overwrite unsaved canvas data
        const hasBrushEdits = this.brushEngine && this.brushEngine.history.length > 0;
        const hasPinEdits = this.mapPins && this.mapPins.length > 0;

        if (hasBrushEdits || hasPinEdits) {
            const confirmed = await foundry.applications.api.DialogV2.confirm({
                window: { title: game.i18n.localize("FILRODENSWMB.UI.Warning") },
                content: `<p>${game.i18n.localize("FILRODENSWMB.UI.LoadWarningContent")}</p>`,
                rejectClose: false,
                modal: true,
            });
            if (!confirmed) return;
        }

        const maps = await getSavedMaps();
        if (maps.length === 0) {
            ui.notifications.warn(game.i18n.localize("FILRODENSWMB.UI.NoSavedMaps"));
            return;
        }

        const optionsHtml = maps.map((m) => `<option value="${m.id}">${m.name}</option>`).join("");
        const content = `
            <div class="form-group" style="display: flex; flex-direction: column; gap: 8px;">
                <label>${game.i18n.localize("FILRODENSWMB.UI.SelectMap")}</label>
                <select id="fwmb-map-select" style="width: 100%; padding: 4px;">${optionsHtml}</select>
            </div>
        `;

        const selectedId = await foundry.applications.api.DialogV2.prompt({
            window: { title: game.i18n.localize("FILRODENSWMB.UI.LoadMap") },
            content: content,
            ok: {
                label: game.i18n.localize("FILRODENSWMB.UI.Load"),
                callback: (event, button, dialog) => document.getElementById("fwmb-map-select").value,
            },
        });

        if (selectedId) {
            const payload = await loadMapData(selectedId);
            if (payload) {
                await this.#ingestMapPayload(payload);
                ui.notifications.info(game.i18n.localize("FILRODENSWMB.UI.LoadSuccess"));
            }
        }
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

        this.brushEngine.history = payload.history || [];
        this.brushEngine.redoStack = [];
        this.pinHistory = [];
        this.pinRedoStack = [];

        // 6. Visually synchronise the HTML sliders
        this.#syncDOMToState();
        this.#updateGrid();

        // 7. Await the full mathematical rebuild, then repaint history over the top
        await this.generateTerrain();

        if (this.brushEngine.history.length > 0) {
            this.#rebuildFromHistory();
        }
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
}
