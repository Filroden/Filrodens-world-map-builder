import { calculateNoise } from "../generation/noise.js";
import { determineBiome } from "../generation/biomes.js";
import { FILRODENSHEX } from "../config.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class TerrainGeneratorApp extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        id: "fhc-terrain-generator",
        classes: ["fhc", "fhc-docked-toolbar"],
        position: {
            width: 320,
            height: "auto",
        },
        window: {
            title: "FILRODENSHEX.UI.ToolbarTitle",
            resizable: false,
        },
        actions: {
            generateElevation: TerrainGeneratorApp.#onGenerateElevation,
            randomizeSeed: TerrainGeneratorApp.#onRandomizeSeed,
        },
    };

    static PARTS = {
        toolbar: {
            // Updated to the new file name
            template: "modules/filrodens-hex-crafter/templates/terrain-generator.hbs",
        },
    };

    static async #onRandomizeSeed(event, target) {
        const appElement = target.closest(".window-content");
        const seedInput = appElement.querySelector("#fhc-seed");

        if (seedInput) {
            seedInput.value = Math.random().toString(36).substring(2, 8).toUpperCase();
            TerrainGeneratorApp.#onGenerateElevation(event, target);
        }
    }

    static async #onGenerateElevation(event, target) {
        console.log("Hex Crafter | Generating fBm Procedural Terrain...");

        if (!canvas?.ready || !canvas.hexCrafter) return;

        const appElement = target.closest(".window-content");
        const seedString = appElement?.querySelector("#fhc-seed")?.value || "DEFAULT";

        const readInput = (selector, fallback) => {
            const el = appElement?.querySelector(selector);
            if (!el || el.value === "") return fallback;
            const val = Number.parseFloat(el.value);
            return Number.isNaN(val) ? fallback : val;
        };

        const seaLevel = readInput("#fhc-sea-level", FILRODENSHEX.DEFAULTS.SEA_LEVEL);
        const globalTemp = readInput("#fhc-global-temp", FILRODENSHEX.DEFAULTS.GLOBAL_TEMP);
        const latTop = readInput("#fhc-lat-top", FILRODENSHEX.DEFAULTS.LAT_TOP);
        const latBottom = readInput("#fhc-lat-bottom", FILRODENSHEX.DEFAULTS.LAT_BOTTOM);

        // Read Advanced Options, falling back to the config.js defaults if untouched
        const elScale = readInput("#fhc-el-scale", FILRODENSHEX.NOISE.ELEVATION.SCALE);
        const elStretch = readInput("#fhc-el-stretch", FILRODENSHEX.NOISE.ELEVATION.STRETCH);

        // Dynamically build the configuration objects for the noise engine
        const configElevation = { ...FILRODENSHEX.NOISE.ELEVATION, SCALE: elScale, STRETCH: elStretch };
        const configMoisture = FILRODENSHEX.NOISE.MOISTURE;
        const configTemperature = FILRODENSHEX.NOISE.TEMPERATURE;

        let hash = 0;
        for (let i = 0; i < seedString.length; i++) {
            hash = (hash << 5) - hash + seedString.codePointAt(i);
            hash = Math.trunc(hash);
        }

        const elOffsetX = (hash % 10000) * 13.7;
        const elOffsetY = (hash % 10000) * 7.3;
        const moOffsetX = elOffsetX + 100000;
        const moOffsetY = elOffsetY + 100000;
        const tempOffsetX = elOffsetX + 200000;
        const tempOffsetY = elOffsetY + 200000;

        const terrainData = {};
        const sceneRect = canvas.dimensions.sceneRect;
        const startOffset = canvas.grid.getOffset({ x: sceneRect.left, y: sceneRect.top });
        const endOffset = canvas.grid.getOffset({ x: sceneRect.right, y: sceneRect.bottom });

        for (let row = startOffset.j - 1; row <= endOffset.j + 1; row++) {
            for (let col = startOffset.i - 1; col <= endOffset.i + 1; col++) {
                const vertices = canvas.grid.getVertices({ i: col, j: row });
                const hexCenterX = vertices.reduce((sum, v) => sum + v.x, 0) / vertices.length;
                const hexCenterY = vertices.reduce((sum, v) => sum + v.y, 0) / vertices.length;

                if (sceneRect.contains(hexCenterX, hexCenterY)) {
                    const yFraction = (hexCenterY - sceneRect.top) / sceneRect.height;
                    const currentLat = latTop + yFraction * (latBottom - latTop);
                    const latTempModifier = Math.cos(currentLat * (Math.PI / 180));

                    // Inject the dynamically built configurations
                    const elevation = calculateNoise(col, row, configElevation, elOffsetX, elOffsetY);
                    const moisture = calculateNoise(col, row, configMoisture, moOffsetX, moOffsetY);
                    const rawTemp = calculateNoise(col, row, configTemperature, tempOffsetX, tempOffsetY);

                    const temperature = latTempModifier * globalTemp + rawTemp * 0.5;
                    const biomeId = determineBiome(elevation, moisture, temperature, seaLevel);

                    terrainData[`${row},${col}`] = { elevation, moisture, temperature, biome: biomeId };
                }
            }
        }

        await canvas.scene.setFlag(FILRODENSHEX.ID, FILRODENSHEX.FLAGS.HEX_DATA, terrainData);
        const savedData = canvas.scene.getFlag(FILRODENSHEX.ID, FILRODENSHEX.FLAGS.HEX_DATA);
        canvas.hexCrafter.renderTerrain(savedData);
    }
}
