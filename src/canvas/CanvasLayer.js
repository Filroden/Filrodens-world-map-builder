import { FILRODENSHEX } from "../config.js";

export class HexCrafterLayer extends InteractionLayer {
    constructor() {
        super();

        // The master container for all procedural hex art
        this.terrainGraphics = new PIXI.Graphics();
        this.addChild(this.terrainGraphics);
    }

    /**
     * Required native Foundry hook.
     * Called automatically when the scene canvas is drawn or re-drawn.
     */
    async _draw() {
        await super._draw();
        this.clearTerrain();
        return this;
    }

    /**
     * Wipes the WebGL graphics object clean.
     */
    clearTerrain() {
        this.terrainGraphics.clear();
    }

    /**
     * Renders the dummy elevation data to the canvas.
     */
    renderTVStatic(hexData) {
        if (!hexData) return;

        this.clearTerrain();
        const alpha = FILRODENSHEX.TESTING.ALPHA;

        for (const [coordinate, data] of Object.entries(hexData)) {
            const [row, col] = coordinate.split(",").map(Number);

            // Let Foundry calculate the absolute vertices for this exact hex
            const vertices = canvas.grid.getVertices({ i: col, j: row });

            // Calculate a grayscale PIXI color (0x000000 to 0xFFFFFF) based on the float
            const colorIntensity = Math.floor(data.elevation * 255);
            const hexColor = (colorIntensity << 16) + (colorIntensity << 8) + colorIntensity;

            this.terrainGraphics.beginFill(hexColor, alpha);

            // getVertices returns an array of {x, y} objects. Flatten them for PIXI.drawPolygon
            const globalPoints = [];
            for (const vertex of vertices) {
                globalPoints.push(vertex.x, vertex.y);
            }

            this.terrainGraphics.drawPolygon(globalPoints);
            this.terrainGraphics.endFill();
        }

        console.log("Hex Crafter | TV Static render complete.");
    }

    /**
     * Renders a specific hex based on the DataModel coordinates.
     * Potential Pitfall: Do not instantiate new PIXI.Graphics objects for every hex.
     * Always draw to the single master this.terrainGraphics object to maintain performance.
     */
    renderHex(q, r, elevation) {
        // Stage 1 math will go here to translate hex (q,r) coordinates
        // into exact screen (x,y) pixels and draw the polygon.
    }
}
