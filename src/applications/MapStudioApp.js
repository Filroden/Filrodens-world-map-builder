import { FILRODENSWMB } from "../config.js";
import { StudioCanvas } from "../canvas/StudioCanvas.js";
import { ProceduralEngine } from "../generation/ProceduralEngine.js";
import { BrushEngine } from "../tools/BrushEngine.js";
import { saveMapData } from "../data/compendium.js";

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
            updateSeaLevel: MapStudioApp.#onUpdateSeaLevel,
            randomizeSeed: MapStudioApp.#onRandomizeSeed,
            toggleEditMode: MapStudioApp.#onToggleEditMode,
            setBrushTool: MapStudioApp.#onSetBrushTool,
            undoBrush: MapStudioApp.#onUndoBrush,
            redoBrush: MapStudioApp.#onRedoBrush,
            saveMap: MapStudioApp.#onSaveMap,
            toggleLayer: MapStudioApp.#onToggleLayer,
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
        super(options);
        this.canvasEngine = null;
        this.activeTool = "terrain";

        this.mapWidth = FILRODENSWMB.DEFAULTS.MAP_WIDTH;
        this.mapHeight = FILRODENSWMB.DEFAULTS.MAP_HEIGHT;

        this.baseElevationData = null;
        this.currentElevationData = null;
        this.currentBiomeOverrides = null;
        this.currentMoistureData = null;
        this.currentTemperatureData = null;
        this.brushEngine = null;

        // Persistent cache to protect slider values when tabs unmount
        this.uiState = {
            mapSeed: null,
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
        };

        this.debouncedGenerateTerrain = foundry.utils.debounce(this.generateTerrain.bind(this), 400);
        this.debouncedGenerateClimate = foundry.utils.debounce(this.generateClimate.bind(this), 200);
    }

    /**
     * Prepares data specifically for individual parts.
     */
    async _preparePartContext(partId, context, options) {
        context = await super._preparePartContext(partId, context, options);
        context.config = FILRODENSWMB;
        context.activeTool = this.activeTool;

        context.biomeList = Object.entries(FILRODENSWMB.BIOME_IDS).map(([key, id]) => ({
            id: id,
            label: `FILRODENSWMB.BIOMES.${key}`,
        }));

        if (partId === "context") {
            context.toolPartial = `modules/filrodens-world-map-builder/templates/tools-${this.activeTool}.hbs`;

            // Build the dynamic UI legend from the core color config
            context.biomeLegend = Object.entries(FILRODENSWMB.BIOMES).map(([key, rgb]) => ({
                label: `FILRODENSWMB.BIOMES.${key}`,
                color: `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`,
            }));
        }

        return context;
    }

    _onRender(context, options) {
        super._onRender(context, options);

        // --- Universal Double-Click to Reset Sliders ---
        if (!this.element.dataset.hasDblClickListener) {
            this.element.addEventListener("dblclick", (event) => {
                const target = event.target;

                // Only intercept double-clicks on range sliders
                if (target.tagName === "INPUT" && target.type === "range") {
                    // Read the original value stamped in the HBS file
                    const defaultVal = target.defaultValue;

                    if (defaultVal !== undefined && target.value !== defaultVal) {
                        target.value = defaultVal;

                        // Update the sibling <output> text if one exists
                        if (target.nextElementSibling?.tagName === "OUTPUT") {
                            target.nextElementSibling.value = defaultVal;
                        }

                        // Dispatch a fake input event so the debouncers and cache instantly react
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
                // If they touch elevation or panning, rebuild the topography
                if (event.target.matches('input[name^="noise.elevation"], input[name^="noise.offsetX"], input[name^="noise.offsetY"], input[name="mapSeed"]')) {
                    this.debouncedGenerateTerrain();
                }
                // If they touch climate controls, skip topography and instantly rebuild biomes
                else if (
                    event.target.matches(
                        'input[name^="noise.moisture"], input[name="globalTemp"], input[name="globalMoisture"], input[name="latTop"], input[name="latBottom"], input[name="seasonOffset"]',
                    )
                ) {
                    this.debouncedGenerateClimate();
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

        // Automatically generate the initial map if the canvas is empty.
        if (!this.currentElevationData) {
            setTimeout(() => this.generateTerrain(), 50);
        }
    }

    async close(options) {
        if (this.canvasEngine) this.canvasEngine.destroy();
        return super.close(options);
    }

    /**
     * Glues the UI DOM states to the spatial Raycaster and the Data engine.
     */
    #wireBrushCallbacks() {
        const getNum = (name) => Number.parseFloat(this.element.querySelector(`input[name="${name}"]`)?.value) || 0;

        this.canvasEngine.onBrushStart = (x, y) => {
            let layer = this.activeTool === "biomes" ? "biome" : "terrain";
            let tool = "paint";
            let paintValue = null;

            if (layer === "terrain") {
                tool = this.element.querySelector(`.fwmb-brush-tools button.active[data-tool-group="terrain"]`)?.dataset.tool || "raise";
            } else if (layer === "biome") {
                const select = this.element.querySelector('select[name="brushBiome"]');
                paintValue = Number.parseInt(select?.value) || 6; // Default to Grassland
            }

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
            const input = this.element.querySelector(`input[name="${key}"]`);
            if (input) {
                // Safely update the cache, handling text (seeds) and numbers
                const parsed = Number.parseFloat(input.value);
                this.uiState[key] = key === "mapSeed" ? input.value : Number.isNaN(parsed) ? this.uiState[key] : parsed;
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
        };

        return { currentSeed: this.uiState["mapSeed"], params };
    }

    // --- Action Handlers ---

    static #onChangeTool(event, target) {
        const newTool = target.dataset.tool;
        if (!newTool || this.activeTool === newTool) return;

        this.activeTool = newTool;

        // Auto-activate the required layer for the selected tool
        if (newTool === "biomes") {
            const biomesBtn = this.element.querySelector('[data-layer="biomes"]');
            if (biomesBtn && !biomesBtn.classList.contains("active")) {
                biomesBtn.classList.add("active");
                this.canvasEngine?.toggleLayer("biomes", true);
            }
        } else if (newTool === "terrain") {
            const topoBtn = this.element.querySelector('[data-layer="topography"]');
            if (topoBtn && !topoBtn.classList.contains("active")) {
                topoBtn.classList.add("active");
                this.canvasEngine?.toggleLayer("topography", true);
            }
        }

        // Toggle visibility of specific tool clusters in the floating edit bar
        const editToolbar = this.element.querySelector(".fwmb-edit-toolbar");
        if (editToolbar) {
            editToolbar.querySelectorAll("[data-tool-group]").forEach((el) => {
                el.classList.toggle("fwmb-hidden", el.dataset.toolGroup !== newTool);
            });
        }

        this.render({ parts: ["toolbar", "context"] });
    }

    static #onToggleGrid(event, target) {
        console.log("World Map Builder | Grid toggle placeholder");
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
        const seaLevel = Number.parseFloat(this.element.querySelector('input[name="seaLevel"]')?.value) || FILRODENSWMB.DEFAULTS.SEA_LEVEL;
        const engine = new ProceduralEngine();

        // 1. Generate and paint the flat Base Map
        const baseBuffer = engine.createBaseMap(this.currentElevationData, this.mapWidth, this.mapHeight, seaLevel);
        this.canvasEngine.renderPixelBuffer("base", baseBuffer, this.mapWidth, this.mapHeight);

        // 2. Generate and paint the shaded Topography
        const topBuffer = engine.colorize(this.currentElevationData, this.mapWidth, this.mapHeight, seaLevel);
        this.canvasEngine.renderPixelBuffer("topography", topBuffer, this.mapWidth, this.mapHeight);

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
            );
            this.canvasEngine.renderPixelBuffer("biomes", biomeBuffer, this.mapWidth, this.mapHeight);

            const biomesBtn = this.element.querySelector('[data-layer="biomes"]');
            this.canvasEngine.toggleLayer("biomes", biomesBtn?.classList.contains("active"));
        }
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
        if (this.brushEngine.applyBrush(x, y, this.currentElevationData, this.currentBiomeOverrides, seaLevel)) {
            this.#repaintCanvas();
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
    }

    static #onUndoBrush(event, target) {
        if (!this.baseElevationData || !this.brushEngine) return;

        if (this.brushEngine.undo()) {
            this.#rebuildFromHistory();
        }
    }

    static #onRedoBrush(event, target) {
        if (!this.baseElevationData || !this.brushEngine) return;

        if (this.brushEngine.redo()) {
            this.#rebuildFromHistory();
        }
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
        const t1 = performance.now();

        console.log(`World Map Builder | Topography calculated in ${Math.round(t1 - t0)}ms`);

        // Chain the climate generation automatically after topography finishes
        this.generateClimate();
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

        if (this.canvasEngine) {
            this.#repaintCanvas();
        }
    }

    /**
     * Native AppV2 Real-Time Listener: Fires whenever the Sea Level slider is dragged.
     */
    static async #onUpdateSeaLevel(event, target) {
        if (!this.currentElevationData || !this.canvasEngine) return;
        this.#repaintCanvas();
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
            params: params,
            history: this.brushEngine?.history || [],
        };

        // Auto-generate a fallback name using the seed string or a random hash
        const hash = currentSeed || Math.random().toString(36).substring(2, 8).toUpperCase();
        const mapName = `Terrain Map (${hash})`;

        const journal = await saveMapData(mapName, payload);

        if (journal) {
            ui.notifications.info(game.i18n.format("FILRODENSWMB.UI.SaveSuccess", { name: journal.name }));
        } else {
            ui.notifications.error(game.i18n.localize("FILRODENSWMB.UI.SaveError"));
        }

        target.disabled = false;
    }
}
