import { SpatialMath } from "./SpatialMath.js";

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
        this.redoStack = [];
        this.activeSlopeElevation = null;
    }

    applyBrush(x, y, elevationData, biomeOverrideData, springOverrides, seaLevel) {
        if (!this.currentStroke) return null;
        return this.#lerpAndStamp(x, y, elevationData, biomeOverrideData, seaLevel, true);
    }

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

    replayHistory(elevationData, biomeOverrideData, seaLevel, activeBounds = null) {
        for (const stroke of this.history) {
            // Fast box check to skip strokes entirely outside the active rebuild zone
            if (activeBounds) {
                const strokeBounds = SpatialMath.getVectorBounds(stroke, stroke.size);
                if (!SpatialMath.isValidBounds(SpatialMath.intersectBounds(strokeBounds, activeBounds))) continue;
            }

            this.currentStroke = stroke;
            this.lastX = null;
            this.lastY = null;
            this.activeSlopeElevation = null;

            for (const pt of stroke.points) {
                // Pass activeBounds down to restrict the internal stamping loops
                this.#lerpAndStamp(pt.x, pt.y, elevationData, biomeOverrideData, seaLevel, false, activeBounds);
            }
        }
        this.currentStroke = null;
        this.lastX = null;
        this.lastY = null;
    }

    // --- Private Interpolation Engine ---

    #lerpAndStamp(x, y, elevationData, biomeOverrideData, seaLevel, shouldRecord, activeBounds) {
        let dirtyBounds = SpatialMath.getEmptyBounds();

        if (this.lastX === null || this.lastY === null) {
            // Anchor the slope elevation to the exact pixel where the user first clicked
            if (this.currentStroke.tool === "slopeUp" || this.currentStroke.tool === "slopeDown" || this.currentStroke.tool === "level") {
                const tx = Math.round(x);
                const ty = Math.round(y);

                if (tx < 0 || tx >= this.mapWidth || ty < 0 || ty >= this.mapHeight) {
                    this.activeSlopeElevation = null;
                } else {
                    this.activeSlopeElevation = elevationData[ty * this.mapWidth + tx];
                }
            }

            if (shouldRecord) this.#recordControlPoint(x, y);

            const stampBounds = this.#stampBrush(x, y, elevationData, biomeOverrideData, seaLevel);
            dirtyBounds = SpatialMath.mergeBounds(dirtyBounds, stampBounds);

            this.lastX = x;
            this.lastY = y;
            return dirtyBounds;
        }

        const dx = x - this.lastX;
        const dy = y - this.lastY;
        const distance = Math.hypot(dx, dy);

        const radius = this.currentStroke.size;
        const stepSpacing = Math.max(1, radius * 0.25);

        // Accumulator: Required so slow mouse movements eventually trigger a stamp
        if (distance < stepSpacing) {
            return dirtyBounds; // Returns the safe 'Infinity' bounds
        }

        const steps = Math.floor(distance / stepSpacing);

        for (let i = 1; i <= steps; i++) {
            const lerpFactor = (i * stepSpacing) / distance;
            const interpX = this.lastX + dx * lerpFactor;
            const interpY = this.lastY + dy * lerpFactor;

            const gradientBoost = 0.3;

            if (this.currentStroke.tool === "slopeUp") {
                this.activeSlopeElevation += this.currentStroke.strength * stepSpacing * gradientBoost;
                this.activeSlopeElevation = Math.min(1, this.activeSlopeElevation);
            } else if (this.currentStroke.tool === "slopeDown") {
                this.activeSlopeElevation -= this.currentStroke.strength * stepSpacing * gradientBoost;
                this.activeSlopeElevation = Math.max(0, this.activeSlopeElevation);
            }

            const stampBounds = this.#stampBrush(interpX, interpY, elevationData, biomeOverrideData, seaLevel);
            dirtyBounds = SpatialMath.mergeBounds(dirtyBounds, stampBounds);
        }

        if (shouldRecord) {
            this.#recordControlPoint(x, y);
        }

        const finalLerp = (steps * stepSpacing) / distance;
        this.lastX = this.lastX + dx * finalLerp;
        this.lastY = this.lastY + dy * finalLerp;

        return dirtyBounds;
    }

    #recordControlPoint(x, y) {
        const pts = this.currentStroke.points;

        pts.push({ x: Number(x.toFixed(2)), y: Number(y.toFixed(2)) });
    }

    // --- Private Rasterisation & Math ---

    #stampBrush(cx, cy, elevationData, biomeOverrideData, seaLevel, activeBounds = null) {
        const { layer, size } = this.currentStroke;

        // Calculate the raw, physical footprint of the brush
        const minX = Math.max(0, Math.floor(cx - size));
        const maxX = Math.min(this.mapWidth - 1, Math.ceil(cx + size));
        const minY = Math.max(0, Math.floor(cy - size));
        const maxY = Math.min(this.mapHeight - 1, Math.ceil(cy + size));

        // Intersect it with the restricted rebuild zone
        const b = SpatialMath.intersectBounds({ minX, maxX, minY, maxY }, activeBounds);

        // Safety Check: If the brush stroke is entirely outside the rebuild zone, abort early
        if (!SpatialMath.isValidBounds(b)) {
            return { minX, maxX, minY, maxY };
        }

        // Run the mathematical loops strictly within the intersected bounds 'b'
        for (let y = b.minY; y <= b.maxY; y++) {
            for (let x = b.minX; x <= b.maxX; x++) {
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

        // Return the true footprint so the accumulator knows what was touched
        return { minX, maxX, minY, maxY };
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
            const targetX = Math.round(cx);
            const targetY = Math.round(cy);

            if (targetX < 0 || targetX >= this.mapWidth || targetY < 0 || targetY >= this.mapHeight) return;

            const targetElevation = elevationData[targetY * this.mapWidth + targetX];
            elevationData[index] += (targetElevation - currentElevation) * (modification * 0.5);
        } else if (tool === "slopeUp" || tool === "slopeDown" || tool === "level") {
            if (this.activeSlopeElevation === null) return;

            const slopeInfluence = Math.pow(influence, 4);
            elevationData[index] = currentElevation * (1 - slopeInfluence) + this.activeSlopeElevation * slopeInfluence;
        }

        elevationData[index] = Math.max(0, elevationData[index]);
    }

    #applyBiomeMath(index, x, y, influence, elevationData, biomeOverrideData, seaLevel) {
        const { paintValue } = this.currentStroke;

        const isLand = elevationData[index] >= seaLevel;
        const isWaterBiome = paintValue === 1 || paintValue === 2;

        if (paintValue === 13 || isLand !== isWaterBiome) {
            biomeOverrideData[index] = paintValue;
        }
    }
}
