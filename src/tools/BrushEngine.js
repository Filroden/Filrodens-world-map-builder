export class BrushEngine {
    constructor(mapWidth, mapHeight) {
        this.mapWidth = mapWidth;
        this.mapHeight = mapHeight;

        this.history = [];
        this.redoStack = [];

        this.currentStroke = null;
        this.lastX = null;
        this.lastY = null;
    }

    /**
     * Initialises a new continuous brush stroke.
     */
    startStroke(layer, tool, size, strength, feather, paintValue = null) {
        this.currentStroke = {
            layer,
            tool,
            size,
            strength,
            feather,
            paintValue,
            points: [],
        };

        this.lastX = null;
        this.lastY = null;
        this.redoStack = []; // A new action permanently destroys the redo future
    }

    /**
     * Evaluates a mouse movement and interpolates intermediate points.
     */
    applyBrush(x, y, elevationData, biomeOverrideData, springOverrides, seaLevel) {
        if (!this.currentStroke) return false;

        // Perform the interpolation and commit the control point
        this.#lerpAndStamp(x, y, elevationData, biomeOverrideData, seaLevel, true);
        return true;
    }

    /**
     * Finalises the stroke and commits it to the database history log.
     */
    endStroke() {
        if (!this.currentStroke || this.currentStroke.points.length === 0) {
            this.currentStroke = null;
            return;
        }

        this.history.push(this.currentStroke);
        this.currentStroke = null;
        this.lastX = null;
        this.lastY = null;
    }

    // --- History Management ---

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

    /**
     * Rebuilds the mathematical arrays from the exact sequence of saved control points.
     */
    replayHistory(elevationData, biomeOverrideData, seaLevel) {
        for (const stroke of this.history) {
            this.currentStroke = stroke;
            this.lastX = null;
            this.lastY = null;

            for (const pt of stroke.points) {
                // Replay the interpolation between control points but do NOT record them again
                this.#lerpAndStamp(pt.x, pt.y, elevationData, biomeOverrideData, seaLevel, false);
            }
        }

        this.currentStroke = null;
        this.lastX = null;
        this.lastY = null;
    }

    // --- Private Interpolation Engine ---

    /**
     * Calculates intermediate coordinates to ensure a solid, unbroken stroke.
     */
    #lerpAndStamp(x, y, elevationData, biomeOverrideData, seaLevel, shouldRecord) {
        if (this.lastX === null || this.lastY === null) {
            if (shouldRecord) this.#recordControlPoint(x, y);
            this.#stampBrush(x, y, elevationData, biomeOverrideData, seaLevel);
            this.lastX = x;
            this.lastY = y;
            return;
        }

        const dx = x - this.lastX;
        const dy = y - this.lastY;
        const distance = Math.hypot(dx, dy);

        // Step at 25% of the brush radius to ensure perfectly dense overlap
        const radius = this.currentStroke.size / 2;
        const stepSpacing = Math.max(1, radius * 0.25);
        const steps = Math.floor(distance / stepSpacing);

        if (steps > 0) {
            for (let i = 1; i <= steps; i++) {
                const lerpFactor = i / steps;
                const interpX = this.lastX + dx * lerpFactor;
                const interpY = this.lastY + dy * lerpFactor;

                this.#stampBrush(interpX, interpY, elevationData, biomeOverrideData, seaLevel);
            }
        }

        if (shouldRecord) this.#recordControlPoint(x, y);
        this.lastX = x;
        this.lastY = y;
    }

    #recordControlPoint(x, y) {
        const pts = this.currentStroke.points;

        // Optimise memory: Only save the control point if it has moved at least 5 pixels
        if (pts.length > 0) {
            const lastPt = pts[pts.length - 1];
            const dist = Math.hypot(x - lastPt.x, y - lastPt.y);
            if (dist < 5) return;
        }

        pts.push({ x: Math.round(x), y: Math.round(y) });
    }

    // --- Private Rasterisation & Math ---

    /**
     * Extracts a bounding box and delegates pixels to their respective layer mathematics.
     */
    #stampBrush(cx, cy, elevationData, biomeOverrideData, seaLevel) {
        const { layer, size } = this.currentStroke;

        const minX = Math.max(0, Math.floor(cx - size));
        const maxX = Math.min(this.mapWidth - 1, Math.ceil(cx + size));
        const minY = Math.max(0, Math.floor(cy - size));
        const maxY = Math.min(this.mapHeight - 1, Math.ceil(cy + size));

        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                const distance = Math.hypot(x - cx, y - cy);
                if (distance > size) continue;

                const index = y * this.mapWidth + x;
                const influence = this.#calculateInfluence(distance, size, this.currentStroke.feather);

                if (layer === "terrain") {
                    this.#applyTerrainMath(index, cx, cy, influence, elevationData);
                } else if (layer === "biome" && this.currentStroke.tool === "paint" && biomeOverrideData) {
                    this.#applyBiomeMath(index, x, y, influence, elevationData, biomeOverrideData, seaLevel);
                }
            }
        }
    }

    #calculateInfluence(distance, size, feather) {
        const safeFeather = Math.min(feather, 0.99);
        const coreSize = size * safeFeather;
        return distance > coreSize ? 1 - (distance - coreSize) / (size - coreSize) : 1;
    }

    #applyTerrainMath(index, cx, cy, influence, elevationData) {
        const { tool, strength } = this.currentStroke;
        const currentElevation = elevationData[index];
        const modification = strength * influence;

        if (tool === "raise") {
            elevationData[index] = Math.min(1, currentElevation + modification);
        } else if (tool === "lower") {
            elevationData[index] = Math.max(0, currentElevation - modification);
        } else if (tool === "smooth") {
            // Target the absolute center of the brush to pull surrounding pixels towards it
            const targetX = Math.max(0, Math.min(this.mapWidth - 1, Math.round(cx)));
            const targetY = Math.max(0, Math.min(this.mapHeight - 1, Math.round(cy)));
            const targetElevation = elevationData[targetY * this.mapWidth + targetX];

            elevationData[index] += (targetElevation - currentElevation) * (modification * 0.5);
        }
    }

    #applyBiomeMath(index, x, y, influence, elevationData, biomeOverrideData, seaLevel) {
        const { strength, paintValue, points } = this.currentStroke;

        // Map the 0.01-0.05 strength slider into a 15% to 75% per-tick probability limit
        const probability = strength * 15 * influence;

        // Deterministic Pseudo-Random Generator based on the exact saved state
        const pseudoRandom = Math.abs(Math.sin(x * 12.9898 + y * 78.233 + points.length) * 43758.5453) % 1;

        if (pseudoRandom < probability) {
            const isLand = elevationData[index] >= seaLevel;
            const isWaterBiome = paintValue === 1 || paintValue === 2;

            if (paintValue === 13 || isLand !== isWaterBiome) {
                biomeOverrideData[index] = paintValue;
            }
        }
    }
}
