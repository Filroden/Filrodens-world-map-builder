import { drawLegend, clearLegend } from "../applications/legend.js";

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
                    toggle: true,
                    active: false,
                    onChange: (event, active) => {
                        const uiInstance = game.filrodenshex.ui;
                        if (active) {
                            uiInstance.render({ force: true });
                        } else {
                            uiInstance.close();
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
}
