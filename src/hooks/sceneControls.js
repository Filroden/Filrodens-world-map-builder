import { drawLegend, clearLegend } from "../applications/legend.js";
import { FILRODENSHEX } from "../config.js";

export function registerSceneControls() {
    Hooks.on("getSceneControlButtons", (controls) => {
        const scene = canvas?.scene;
        if (!scene) return;

        const isHexGrid = [CONST.GRID_TYPES.HEXODDQ, CONST.GRID_TYPES.HEXEVENQ, CONST.GRID_TYPES.HEXODDR, CONST.GRID_TYPES.HEXEVENR].includes(scene.grid.type);
        if (!isHexGrid) return;

        // V14 Strict: Assign directly to the Object property
        controls.hexCrafter = {
            name: "hexCrafter",
            title: "FILRODENSHEX.UI.ControlTitle",
            icon: "fhc-scene-icon hex",
            layer: "hexCrafter",

            // THE FIX: Satisfy the engine's routing requirement natively
            activeTool: "hiddenPainter",

            tools: {
                hiddenPainter: {
                    name: "hiddenPainter",
                    title: "Paint",
                    icon: "fas fa-brush",
                    visible: false, // This hides it from the UI, keeping your design perfect
                },
                toggleEditor: {
                    name: "toggleEditor",
                    title: "FILRODENSHEX.UI.ToggleEditor",
                    icon: "fhc-scene-icon elevation",
                    toggle: true,
                    active: false,
                    onChange: (event, active) => {
                        const uiInstance = game.filrodenshex.terrainGenerator;
                        if (active) uiInstance.render({ force: true });
                        else uiInstance.close();
                    },
                },
                manualEditor: {
                    name: "manualEditor",
                    title: "FILRODENSHEX.UI.ManualEditor",
                    icon: "fhc-scene-icon brush",
                    toggle: true,
                    active: false,
                    onChange: (event, active) => {
                        const uiInstance = game.filrodenshex.manualEditor;
                        if (active) uiInstance.render({ force: true });
                        else uiInstance.close();
                    },
                },
                mapManager: {
                    name: "mapManager",
                    title: "FILRODENSHEX.UI.MapManager",
                    icon: "fhc-scene-icon travel_explore",
                    toggle: true,
                    active: false,
                    onChange: (event, active) => {
                        const uiInstance = game.filrodenshex.mapManager;
                        if (active) uiInstance.render({ force: true });
                        else uiInstance.close();
                    },
                },
            },
        };
    });

    Hooks.on("renderSceneControls", (controlsUI) => {
        if (controlsUI.control?.name === "hexCrafter") {
            drawLegend();
        } else {
            clearLegend();
        }
    });

    Hooks.on("updateScene", (scene, data, options, userId) => {
        if (scene.id !== canvas.scene?.id) return;

        const flagPath = `flags.${FILRODENSHEX.ID}.${FILRODENSHEX.FLAGS.HEX_DATA}`;
        if (foundry.utils.hasProperty(data, flagPath)) {
            const hexData = scene.getFlag(FILRODENSHEX.ID, FILRODENSHEX.FLAGS.HEX_DATA);
            canvas.hexCrafter?.renderTerrain(hexData);
        }
    });
}
