import { FILRODENSHEX } from "../config.js";

export class HexCrafterLayer extends foundry.canvas.layers.InteractionLayer {
    /**
     * Called automatically when the scene canvas is drawn or re-drawn.
     */
    async _draw() {
        await super._draw();

        // Safely create the graphics object and add it to the layer
        this.terrainGraphics = new PIXI.Graphics();
        this.addChild(this.terrainGraphics);

        // Native First: Check if the Scene already has a generated continent saved in its flags
        const savedData = canvas.scene.getFlag(FILRODENSHEX.ID, FILRODENSHEX.FLAGS.HEX_DATA);
        if (savedData) {
            this.renderTerrain(savedData);
        }

        return this;
    }

    /**
     * Called automatically when the canvas is being destroyed.
     */
    async _tearDown() {
        if (this.terrainGraphics && !this.terrainGraphics.destroyed) {
            this.terrainGraphics.destroy({ children: true });
        }
        this.terrainGraphics = null;

        return super._tearDown();
    }

    clearTerrain() {
        if (this.terrainGraphics) {
            this.terrainGraphics.clear();
        }
    }

    /**
     * Renders the classified biome data to the canvas.
     */
    renderTerrain(hexData) {
        if (!hexData) return;

        this.clearTerrain();
        const alpha = FILRODENSHEX.DISPLAY.ALPHA;

        for (const [coordinate, data] of Object.entries(hexData)) {
            const [row, col] = coordinate.split(",").map(Number);
            const vertices = canvas.grid.getVertices({ i: col, j: row });

            // Lookup the specific colour for the classified biome, with a fallback magenta if undefined
            const biomeConfig = FILRODENSHEX.BIOMES[data.biome];
            const hexColor = biomeConfig ? biomeConfig.color : 0xff00ff;

            this.terrainGraphics.beginFill(hexColor, alpha);

            const globalPoints = [];
            for (const vertex of vertices) {
                globalPoints.push(vertex.x, vertex.y);
            }

            this.terrainGraphics.drawPolygon(globalPoints);
            this.terrainGraphics.endFill();
        }

        console.log("Hex Crafter | Terrain generation and rendering complete.");
    }
}
