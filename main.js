import { FILRODENSHEX } from "./src/config.js";
import { registerSceneControls } from "./src/hooks/sceneControls.js";
import { TerrainGeneratorApp } from "./src/applications/TerrainGeneratorApp.js";
import { HexCrafterLayer } from "./src/canvas/CanvasLayer.js";
import { initializeCompendium } from "./src/data/compendium.js";
import { MapManagerApp } from "./src/applications/MapManagerApp.js";
import { ManualEditorApp } from "./src/applications/ManualEditorApp.js";

Hooks.once("init", () => {
    game.filrodenshex = {
        config: FILRODENSHEX,
        terrainGenerator: new TerrainGeneratorApp(),
        mapManager: new MapManagerApp(),
        manualEditor: new ManualEditorApp(),
    };

    // Register the custom PIXI layer
    CONFIG.Canvas.layers.hexCrafter = {
        group: "interface",
        layerClass: HexCrafterLayer,
    };

    registerSceneControls();
});

Hooks.once("ready", async () => {
    // Ensure the compendium exists on world load
    await initializeCompendium();
});
