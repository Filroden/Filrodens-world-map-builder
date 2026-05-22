import { FILRODENSHEX } from "./src/config.js";
import { HexDataModel } from "./src/data/HexDataModel.js";
import { registerSceneControls } from "./src/hooks/sceneControls.js";
import { TerrainGeneratorApp } from "./src/applications/TerrainGeneratorApp.js";
import { HexCrafterLayer } from "./src/canvas/CanvasLayer.js";
import { initializeCompendium } from "./src/data/compendium.js";
import { MapManagerApp } from "./src/applications/MapManagerApp.js";

Hooks.once("init", () => {
    game.filrodenshex = {
        config: FILRODENSHEX,
        terrainGenerator: new TerrainGeneratorApp(),
        mapManager: new MapManagerApp(),
    };

    // Register the custom PIXI layer
    CONFIG.Canvas.layers.hexCrafter = {
        group: "primary",
        layerClass: HexCrafterLayer,
    };

    registerSceneControls();
});

Hooks.once("ready", async () => {
    // Ensure the compendium exists on world load
    await initializeCompendium();
});
