import { drawLegend, clearLegend } from "../applications/legend.js";
import { FILRODENSHEX } from "../config.js";

export function registerSceneControls() {
    // 1. Hook into the initial creation of the buttons
    Hooks.on("getSceneControlButtons", (controls) => {
        const scene = canvas?.scene;

        if (!scene) return;

        const isHexGrid = [CONST.GRID_TYPES.HEXODDQ, CONST.GRID_TYPES.HEXEVENQ, CONST.GRID_TYPES.HEXODDR, CONST.GRID_TYPES.HEXEVENR].includes(scene.grid.type);

        if (!isHexGrid) return;

        controls.hexCrafter = {
            name: "hexCrafter",
            title: "FILRODENSHEX.UI.ControlTitle",
            icon: "fhc-scene-icon hex",
            layer: "hexCrafter",
            tools: {
                toggleEditor: {
                    name: "toggleEditor",
                    title: "FILRODENSHEX.UI.ToggleEditor",
                    icon: "fhc-scene-icon layers",
                    toggle: false,
                    active: false,
                    onChange: (event, active) => {
                        const uiInstance = game.filrodenshex.terrainGenerator;
                        if (active) {
                            uiInstance.render({ force: true });
                        } else {
                            uiInstance.close();
                        }
                    },
                },
                mapManager: {
                    name: "mapManager",
                    title: "FILRODENSHEX.UI.MapManager",
                    icon: "fhc-scene-icon travel_explore",
                    toggle: false,
                    active: false,
                    onChange: (event, active) => {
                        // Stub for the upcoming Map Manager App
                        if (active) {
                            console.log("Hex Crafter | Map Manager opened.");
                        } else {
                            console.log("Hex Crafter | Map Manager closed.");
                        }
                    },
                },
            },
        };
    });

    // 2. The Legend Controller: Hook directly into the UI render cycle
    Hooks.on("renderSceneControls", (controlsUI) => {
        if (controlsUI.control?.name === "hexCrafter") {
            drawLegend();
        } else {
            clearLegend();
        }
    });

    // 3. The Network Sync: Listen for remote database updates
    Hooks.on("updateScene", (scene, data, options, userId) => {
        // Guard: Only react if the updated scene is the one currently being viewed on the canvas
        if (scene.id !== canvas.scene?.id) return;

        // Guard: Only react if the database update specifically contains our Hex Data flag payload
        const flagPath = `flags.${FILRODENSHEX.ID}.${FILRODENSHEX.FLAGS.HEX_DATA}`;
        if (foundry.utils.hasProperty(data, flagPath)) {
            // Retrieve the newly synced data and instruct the canvas to render it instantly
            const hexData = scene.getFlag(FILRODENSHEX.ID, FILRODENSHEX.FLAGS.HEX_DATA);
            canvas.hexCrafter?.renderTerrain(hexData);
        }
    });
}
