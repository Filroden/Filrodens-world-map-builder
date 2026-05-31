import { FILRODENSHEX } from "../config.js";

export class HexCrafterLayer extends foundry.canvas.layers.InteractionLayer {
    async _draw() {
        await super._draw();

        this.terrainGraphics = new PIXI.Graphics();
        this.addChild(this.terrainGraphics);

        const savedData = canvas.scene.getFlag(FILRODENSHEX.ID, FILRODENSHEX.FLAGS.HEX_DATA);
        if (savedData) this.renderTerrain(savedData);

        return this;
    }

    async _tearDown() {
        if (this.terrainGraphics) {
            this.terrainGraphics.destroy({ children: true });
        }
        this.terrainGraphics = null;
        return super._tearDown();
    }

    clearTerrain() {
        if (this.terrainGraphics) this.terrainGraphics.clear();
    }

    renderTerrain(hexData) {
        if (!hexData) return;
        this.clearTerrain();

        for (const [coordinate, data] of Object.entries(hexData)) {
            const [row, col] = coordinate.split(",").map(Number);
            const vertices = canvas.grid.getVertices({ i: col, j: row });

            const biomeConfig = FILRODENSHEX.BIOMES[data.biome];
            const hexColor = biomeConfig ? biomeConfig.color : 0xff00ff;

            this.terrainGraphics.beginFill(hexColor, FILRODENSHEX.DISPLAY.ALPHA);

            const globalPoints = [];
            for (const vertex of vertices) globalPoints.push(vertex.x, vertex.y);

            this.terrainGraphics.drawPolygon(globalPoints);
            this.terrainGraphics.endFill();
        }
    }

    /**
     * Native Foundry hook: Automatically intercepts left-clicks when this layer is active.
     */
    async _onClickLeft(event) {
        // 1. Intent Guard: Is the Manual Editor open?
        const editorApp = game.filrodenshex.manualEditor;
        if (!editorApp?.rendered) return;

        // 2. Brush Guard: Is a biome actively selected in the palette?
        const activeBrush = editorApp.activeBiome;
        if (!activeBrush) return;

        const currentData = canvas.scene.getFlag(FILRODENSHEX.ID, FILRODENSHEX.FLAGS.HEX_DATA);
        if (!currentData) return;

        // 3. INTERCEPT: Stop the click from passing to other systems.
        event.stopPropagation();

        // THE FIX: Safely fetch coordinates globally via the native event snapshot
        const position = event.interactionData.origin;
        const offset = canvas.grid.getOffset(position);
        const hexKey = `${offset.j},${offset.i}`;

        if (!currentData[hexKey]) return;

        // 5. State Mutation
        const updatedHex = { ...currentData[hexKey], biome: activeBrush };
        await canvas.scene.setFlag(FILRODENSHEX.ID, FILRODENSHEX.FLAGS.HEX_DATA, {
            [hexKey]: updatedHex,
        });

        // 6. Force Redraw
        const newData = canvas.scene.getFlag(FILRODENSHEX.ID, FILRODENSHEX.FLAGS.HEX_DATA);
        this.renderTerrain(newData);
    }
}
