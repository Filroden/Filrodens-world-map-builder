import { FILRODENSWMB } from "../config.js";
import { StudioCanvas } from "../canvas/StudioCanvas.js";
import { ProceduralEngine } from "../generation/ProceduralEngine.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class MapStudioApp extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        id: "fwmb-map-studio",
        classes: ["fwmb", "fwmb-layout"],
        position: { width: 1200, height: 800 },
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
        },
    };

    // Define the application as three distinct rendering blocks.
    static PARTS = {
        toolbar: {
            template: "modules/filrodens-world-map-builder/templates/parts/toolbar.hbs",
            classes: ["fwmb-toolbar"],
        },
        context: {
            template: "modules/filrodens-world-map-builder/templates/parts/context.hbs",
            classes: ["fwmb-context-panel"],
        },
        map: {
            template: "modules/filrodens-world-map-builder/templates/parts/map.hbs",
            classes: ["fwmb-map"],
        },
    };

    constructor(options) {
        super(options);
        this.canvasEngine = null;
        this.activeTool = "terrain";

        this.mapWidth = FILRODENSWMB.DEFAULTS.MAP_WIDTH;
        this.mapHeight = FILRODENSWMB.DEFAULTS.MAP_HEIGHT;
        this.currentElevationData = null;

        this.debouncedGenerateTerrain = foundry.utils.debounce(this.generateTerrain.bind(this), 400);
    }

    /**
     * Prepares data specifically for individual parts.
     */
    async _preparePartContext(partId, context, options) {
        context = await super._preparePartContext(partId, context, options);
        context.config = FILRODENSWMB;
        context.activeTool = this.activeTool;

        if (partId === "context") {
            // Tell Handlebars which specific settings panel to load
            context.toolPartial = `modules/filrodens-world-map-builder/templates/parts/tools-${this.activeTool}.hbs`;
        }

        return context;
    }

    _onRender(context, options) {
        super._onRender(context, options);

        const container = this.element.querySelector(".fwmb-map-preview");
        if (container && !this.canvasEngine) {
            this.canvasEngine = new StudioCanvas(container);
        }

        // Delegate 'input' events to the context panel.
        const contextPanel = this.element.querySelector(".fwmb-context-panel");
        if (contextPanel && !contextPanel.dataset.hasNoiseListeners) {
            contextPanel.addEventListener("input", (event) => {
                if (event.target.matches('input[name^="noise."], input[name="mapSeed"]')) {
                    this.debouncedGenerateTerrain();
                }
            });
            contextPanel.dataset.hasNoiseListeners = "true";
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

    // --- Action Handlers ---

    static #onChangeTool(event, target) {
        const newTool = target.dataset.tool;
        if (!newTool || this.activeTool === newTool) return;

        this.activeTool = newTool;
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

    static #onRandomizeSeed(event, target) {
        const input = this.element.querySelector('input[name="mapSeed"]');
        if (!input) return;

        // Generate a random 6-character string (e.g. "K8B3F9")
        input.value = Math.random().toString(36).substring(2, 8).toUpperCase();

        // Dispatch an input event so the debouncer triggers automatically
        input.dispatchEvent(new Event("input", { bubbles: true }));
    }

    static #onToggleEditMode(event, target) {
        const toolbar = this.element.querySelector(".fwmb-edit-toolbar");
        if (!toolbar) return;

        toolbar.classList.toggle("fwmb-hidden");

        // Toggle active state on the button itself for visual feedback
        target.closest("button").classList.toggle("active");

        // We will wire up the logic here to lock the procedural sliders when edit mode is active
    }

    /**
     * Generates the procedural noise maps.
     * Called automatically via debounced input events on the sliders.
     */
    async generateTerrain() {
        const getNum = (name, fallback) => {
            const el = this.element.querySelector(`input[name="${name}"]`);
            const val = Number.parseFloat(el?.value);
            return Number.isNaN(val) ? fallback : val;
        };

        const seedInput = this.element.querySelector('input[name="mapSeed"]');
        const currentSeed = seedInput?.value || null;

        const params = {
            seaLevel: getNum("seaLevel", FILRODENSWMB.DEFAULTS.SEA_LEVEL),
            globalTemp: getNum("globalTemp", FILRODENSWMB.DEFAULTS.GLOBAL_TEMP),
            latTop: getNum("latTop", FILRODENSWMB.DEFAULTS.LAT_TOP),
            latBottom: getNum("latBottom", FILRODENSWMB.DEFAULTS.LAT_BOTTOM),
            noise: {
                offsetX: getNum("noise.offsetX", 0),
                offsetY: getNum("noise.offsetY", 0),
                elevation: {
                    scale: 1 / getNum("noise.elevation.scale", FILRODENSWMB.NOISE.ELEVATION.SCALE),
                    octaves: getNum("noise.elevation.octaves", FILRODENSWMB.NOISE.ELEVATION.OCTAVES),
                    stretch: getNum("noise.elevation.stretch", FILRODENSWMB.NOISE.ELEVATION.STRETCH),
                },
                moisture: {
                    scale: 1 / getNum("noise.moisture.scale", FILRODENSWMB.NOISE.MOISTURE.SCALE),
                    octaves: getNum("noise.moisture.octaves", FILRODENSWMB.NOISE.MOISTURE.OCTAVES),
                },
                temperature: {
                    scale: 1 / FILRODENSWMB.NOISE.TEMPERATURE.SCALE,
                    octaves: FILRODENSWMB.NOISE.TEMPERATURE.OCTAVES,
                },
            },
        };

        const engine = new ProceduralEngine(currentSeed);

        const t0 = performance.now();
        // Returns the aggregated object containing all three maps
        const terrainData = engine.generateTerrainData(this.mapWidth, this.mapHeight, params);

        // Store just the elevation for the real-time sea level slider to use
        this.currentElevationData = terrainData.elevationData;
        const t1 = performance.now();

        console.log(`World Map Builder | Topography calculated in ${Math.round(t1 - t0)}ms`);

        const pixelBuffer = engine.colorize(this.currentElevationData, this.mapWidth, this.mapHeight, params.seaLevel);

        if (this.canvasEngine) {
            this.canvasEngine.renderPixelBuffer(pixelBuffer, this.mapWidth, this.mapHeight);
        }
    }

    /**
     * Native AppV2 Real-Time Listener: Fires whenever the Sea Level slider is dragged.
     */
    static async #onUpdateSeaLevel(event, target) {
        // Guard: If we haven't generated a map yet, ignore the slider
        if (!this.currentElevationData || !this.canvasEngine) return;

        const newSeaLevel = Number(target.value);
        const engine = new ProceduralEngine();

        // Fast Colour Pass: Bypasses generation entirely
        const pixelBuffer = engine.colorize(this.currentElevationData, this.mapWidth, this.mapHeight, newSeaLevel);

        this.canvasEngine.renderPixelBuffer(pixelBuffer, this.mapWidth, this.mapHeight);
    }
}
