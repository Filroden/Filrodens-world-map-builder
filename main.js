import { FILRODENSHEX } from "./src/config.js";
import { HexDataModel } from "./src/data/HexDataModel.js";
// import { registerInitHooks } from "./src/hooks/init.js";
// import { registerSceneControls } from "./src/hooks/sceneControls.js";

Hooks.once("init", () => {
    // 1. Register the namespace
    game.filrodenshex = {
        config: FILRODENSHEX,
    };

    // 2. Register the strict data models (Wait for V13 specific implementation details here)
    // CONFIG.Scene.dataModels[FILRODENSHEX.ID] = ...

    // 3. Delegate to dedicated hook files
    // registerInitHooks();
});
