import { FILRODENSHEX } from "../config.js";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class HexCrafterUI extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        id: "fhc-toolbar",
        classes: ["fhc", "fhc-docked-toolbar"],
        position: {
            width: 480,
            height: "auto",
        },
        window: {
            title: "FILRODENSHEX.UI.ToolbarTitle",
            resizable: false,
        },
        actions: {
            generateElevation: HexCrafterUI.#onGenerateElevation,
        },
    };

    static PARTS = {
        toolbar: {
            template: "modules/filrodens-hex-crafter/templates/toolbar.hbs",
        },
    };

    static async #onGenerateElevation(event, target) {
        console.log("Hex Crafter | Generating TV static dummy data...");

        if (!canvas?.ready || !canvas.hexCrafter) {
            console.error("Hex Crafter | Canvas or HexCrafterLayer is not initialized.");
            return;
        }

        const dummyData = {};
        const limit = FILRODENSHEX.TESTING.GRID_SIZE;
        const sceneRect = canvas.dimensions.sceneRect;

        // Find the top-left pixel of the playable scene
        const sceneTopLeft = { x: sceneRect.x, y: sceneRect.y };

        // Convert that pixel into the corresponding starting grid coordinate
        const startOffset = canvas.grid.getOffset(sceneTopLeft);
        const startCol = startOffset.i;
        const startRow = startOffset.j;

        // State Mutation: Generate random floats, filtering out the staggered overlap
        for (let row = startRow; row < startRow + limit; row++) {
            for (let col = startCol; col < startCol + limit; col++) {
                // Retrieve the absolute canvas geometry for this specific hex
                const vertices = canvas.grid.getVertices({ i: col, j: row });

                // Calculate the centroid by averaging the x and y of all 6 vertices
                const hexCenterX = vertices.reduce((sum, v) => sum + v.x, 0) / vertices.length;
                const hexCenterY = vertices.reduce((sum, v) => sum + v.y, 0) / vertices.length;

                // Guard: Only add the data if the calculated center is strictly inside the playable area
                if (sceneRect.contains(hexCenterX, hexCenterY)) {
                    const coordinateKey = `${row},${col}`;
                    dummyData[coordinateKey] = {
                        elevation: Math.random(),
                    };
                }
            }
        }

        // Execution: Pass the filtered data to the canvas layer
        canvas.hexCrafter.renderTVStatic(dummyData);
    }
}
