export class BrushEngine {
    constructor(mapWidth, mapHeight) {
        this.width = mapWidth;
        this.height = mapHeight;
        this.history = [];
        this.redoStack = [];
        this.activeStroke = null;
    }

    startStroke(layer, tool, size, strength, feather, value = null) {
        this.activeStroke = {
            layer, // "terrain" or "biome"
            tool, // "raise", "lower", "paint"
            size,
            strength,
            feather,
            value, // The discrete Biome ID being painted
            points: [],
        };
    }

    applyBrush(x, y, elevationData, biomeOverrideData, seaLevel) {
        if (!this.activeStroke) return false;
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) return false;

        this.activeStroke.points.push({ x, y });
        this.#mutateMapData(x, y, elevationData, biomeOverrideData, seaLevel);

        return true;
    }

    endStroke() {
        if (!this.activeStroke || this.activeStroke.points.length === 0) return;
        this.history.push(this.activeStroke);
        this.redoStack = [];
        this.activeStroke = null;
    }

    undo() {
        if (this.history.length === 0) return false;
        this.redoStack.push(this.history.pop());
        return true;
    }

    redo() {
        if (this.redoStack.length === 0) return false;
        this.history.push(this.redoStack.pop());
        return true;
    }

    replayHistory(elevationData, biomeOverrideData, seaLevel) {
        for (const stroke of this.history) {
            this.activeStroke = stroke;
            for (const point of stroke.points) {
                this.#mutateMapData(point.x, point.y, elevationData, biomeOverrideData, seaLevel);
            }
        }
        this.activeStroke = null;
    }

    #mutateMapData(centerX, centerY, elevationData, biomeOverrideData, seaLevel) {
        const { size } = this.activeStroke;

        const minX = Math.max(0, centerX - size);
        const maxX = Math.min(this.width - 1, centerX + size);
        const minY = Math.max(0, centerY - size);
        const maxY = Math.min(this.height - 1, centerY + size);

        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                this.#processPixel(x, y, centerX, centerY, elevationData, biomeOverrideData, seaLevel);
            }
        }
    }

    #processPixel(x, y, cx, cy, elevationData, biomeOverrideData, seaLevel) {
        const { layer, tool, size, strength, feather, value, points } = this.activeStroke;
        const distance = Math.hypot(x - cx, y - cy);

        if (distance > size) return;

        const index = y * this.width + x;

        // 1. Calculate the spatial influence (Feathering taper)
        const safeFeather = Math.min(feather, 0.99);
        const coreSize = size * safeFeather;
        const influence = distance > coreSize ? 1 - (distance - coreSize) / (size - coreSize) : 1;

        // --- TERRAIN LAYER ---
        if (layer === "terrain") {
            const currentElevation = elevationData[index];
            const modification = strength * influence;

            if (tool === "raise") elevationData[index] = Math.min(1, currentElevation + modification);
            else if (tool === "lower") elevationData[index] = Math.max(0, currentElevation - modification);
            else if (tool === "smooth") {
                const targetElevation = elevationData[cy * this.width + cx];
                elevationData[index] += (targetElevation - currentElevation) * (modification * 0.5);
            }
        }

        // --- BIOME LAYER (ORGANIC SCATTER BRUSH) ---
        else if (layer === "biome" && tool === "paint" && biomeOverrideData) {
            // Map the 0.01-0.05 strength slider into a 15% to 75% per-tick probability limit
            const probability = strength * 15 * influence;

            // Deterministic Pseudo-Random Generator
            // Uses the X/Y coordinates and the current length of the stroke queue as an absolute mathematical seed
            const pseudoRandom = Math.abs(Math.sin(x * 12.9898 + y * 78.233 + points.length) * 43758.5453) % 1;

            // Only paint the pixel if it survives the probability check
            if (pseudoRandom < probability) {
                const isLand = elevationData[index] >= seaLevel;
                const isWaterBiome = value === 1 || value === 2; // Deep/Shallow Ocean

                // SMART MASKING
                if (value === 13 || isLand !== isWaterBiome) {
                    biomeOverrideData[index] = value;
                }
            }
        }
    }
}
