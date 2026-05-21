export function registerSceneControls() {
    Hooks.on("getSceneControlButtons", (controls) => {
        const scene = canvas?.scene;

        // 1. Guard: Ensure the canvas is initialized with a scene
        if (!scene) return;

        // 2. Guard: Ensure the scene is a valid hex grid layout
        const isHexGrid = [CONST.GRID_TYPES.HEXODDQ, CONST.GRID_TYPES.HEXEVENQ, CONST.GRID_TYPES.HEXODDR, CONST.GRID_TYPES.HEXEVENR].includes(scene.grid.type);

        if (!isHexGrid) return;

        // 3. State Mutation: Assign our custom control layer as an object property
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
                    onChange: (toggled) => {
                        const uiInstance = game.filrodenshex.ui;
                        if (toggled) {
                            uiInstance.render({ force: true });
                        } else {
                            uiInstance.close();
                        }
                    },
                },
            },
        };
    });
}
