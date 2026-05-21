import { FILRODENSHEX } from "./src/config.js";
import { HexDataModel } from "./src/data/HexDataModel.js";
import { registerSceneControls } from "./src/hooks/sceneControls.js";
import { HexCrafterUI } from "./src/applications/ToolbarUI.js";
import { HexCrafterLayer } from "./src/canvas/CanvasLayer.js";

Hooks.once("init", () => {
    game.filrodenshex = {
        config: FILRODENSHEX,
        ui: new HexCrafterUI(),
    };

    // Register the custom PIXI layer
    CONFIG.Canvas.layers.hexCrafter = {
        group: "primary",
        layerClass: HexCrafterLayer,
    };

    registerSceneControls();
});
