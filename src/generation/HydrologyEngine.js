import { FILRODENSWMB } from "../config.js";

/**
 * Dedicated engine to manage manual hydrological vector deformations,
 * enforcing monotonic downhill flow and organic bank generation.
 */
export class HydrologyEngine {
    static MATH = {
        DROP_PER_STEP: 0.005, // Maximum elevation drop per path step to avoid unnatural aqueducts
        BANK_BLEND_POWER: 2,
        JITTER_SCALE: 0.05,
        JITTER_STRENGTH: 2,
        PATH_STEP_SIZE: 1, // 1 pixel interval guarantees continuous carving
    };

    /**
     * Iterates through all manual rivers and carves their physical trenches into the elevation data.
     */
    static carveManualRivers(elevationData, width, height, rivers, simplex, seaLevel) {
        if (!rivers || rivers.length === 0) return;
        for (const river of rivers) {
            this.#carveSingleRiver(elevationData, width, height, river, simplex, seaLevel);
        }
    }

    /**
     * Dynamically identifies the highest point of each manual river to act as a spring for the procedural water algorithm.
     */
    static getRiverSources(elevationData, width, rivers) {
        const sources = [];
        if (!rivers || rivers.length === 0) return sources;

        for (const river of rivers) {
            if (!river.points || river.points.length < 2) continue;

            const startNode = river.points[0];
            const endNode = river.points[river.points.length - 1];

            const startElev = this.#sampleElevation(elevationData, width, startNode);
            const endElev = this.#sampleElevation(elevationData, width, endNode);

            // Determine correct flow direction
            const isDownhill = startElev >= endElev;
            const trueStart = isDownhill ? startNode : endNode;
            const trueNext = isDownhill ? river.points[1] : river.points[river.points.length - 2];

            // Calculate a point 5 pixels downstream to ensure the spring spawns inside the trench
            const dx = trueNext.x - trueStart.x;
            const dy = trueNext.y - trueStart.y;
            const dist = Math.hypot(dx, dy);
            const ratio = Math.min(5 / dist, 0.5);

            sources.push({
                x: trueStart.x + dx * ratio,
                y: trueStart.y + dy * ratio,
                type: "spring",
                isManualRiver: true,
            });
        }
        return sources;
    }

    static #carveSingleRiver(elevationData, width, height, river, simplex, seaLevel) {
        if (!river.points || river.points.length < 2) return;

        const path = this.#getSplinePoints(river.points, this.MATH.PATH_STEP_SIZE);
        if (path.length === 0) return;

        this.#ensureDownhillFlow(elevationData, width, path);

        const depth = FILRODENSWMB.HYDROLOGY.MANUAL_RIVER_DEPTHS?.[river.width] || 0.025;
        const radius = river.width / 2;
        const radiusSq = radius * radius;

        const startElev = this.#sampleElevation(elevationData, width, path[0]);
        let currentBedElev = startElev - depth;

        for (const pt of path) {
            currentBedElev = this.#carveRiverCrossSection(elevationData, width, height, pt, radius, radiusSq, currentBedElev, depth, simplex, seaLevel);
        }
    }

    static #carveRiverCrossSection(elevationData, width, height, pt, radius, radiusSq, previousBedElev, targetDepth, simplex, seaLevel) {
        const cx = Math.floor(pt.x);
        const cy = Math.floor(pt.y);

        // 1. Enforce monotonic downward flow
        const originalElev = this.#sampleElevation(elevationData, width, pt);

        // Calculate the theoretical downhill depth
        let desiredBed = Math.min(originalElev - targetDepth, previousBedElev - this.MATH.DROP_PER_STEP);
        const currentBedElev = Math.max(desiredBed, Math.min(seaLevel, originalElev));

        // 2. Define a tight mathematical bounding box for the cross-section
        const bounds = this.#calculateBounds(cx, cy, radius + this.MATH.JITTER_STRENGTH, width, height);

        // 3. Carve the banks using quadratic falloff
        for (let y = bounds.minY; y <= bounds.maxY; y++) {
            for (let x = bounds.minX; x <= bounds.maxX; x++) {
                const idx = y * width + x;
                const distSq = this.#calculateJitteredDistanceSq(x, y, pt.x, pt.y, simplex);

                if (distSq > radiusSq) continue;

                const normDist = Math.sqrt(distSq) / radius;
                const blendFactor = Math.pow(normDist, this.MATH.BANK_BLEND_POWER);

                const terrainElev = elevationData[idx];
                const carvedElev = currentBedElev + (terrainElev - currentBedElev) * blendFactor;

                // Protect against creating aqueducts by strictly carving downwards
                if (carvedElev < terrainElev) {
                    elevationData[idx] = Math.max(0, carvedElev);
                }
            }
        }

        return currentBedElev;
    }

    // --- Spatial Math Helpers ---

    static #sampleElevation(elevationData, width, pt) {
        const idx = Math.floor(pt.y) * width + Math.floor(pt.x);
        return elevationData[idx] || 0;
    }

    static #ensureDownhillFlow(elevationData, width, path) {
        const startElev = this.#sampleElevation(elevationData, width, path[0]);
        const endElev = this.#sampleElevation(elevationData, width, path[path.length - 1]);

        if (endElev > startElev) {
            path.reverse();
        }
    }

    static #calculateBounds(cx, cy, pad, width, height) {
        return {
            minX: Math.max(0, Math.floor(cx - pad)),
            maxX: Math.min(width - 1, Math.ceil(cx + pad)),
            minY: Math.max(0, Math.floor(cy - pad)),
            maxY: Math.min(height - 1, Math.ceil(cy + pad)),
        };
    }

    static #calculateJitteredDistanceSq(x, y, cx, cy, simplex) {
        const jitterX = simplex.noise2D(x * this.MATH.JITTER_SCALE, y * this.MATH.JITTER_SCALE) * this.MATH.JITTER_STRENGTH;
        const jitterY = simplex.noise2D(x * this.MATH.JITTER_SCALE + 1000, y * this.MATH.JITTER_SCALE + 1000) * this.MATH.JITTER_STRENGTH;

        return Math.pow(x + jitterX - cx, 2) + Math.pow(y + jitterY - cy, 2);
    }

    /**
     * Generates a Catmull-Rom spline array from sparse points.
     */
    static #getSplinePoints(points, stepSize) {
        if (points.length < 2) return [];

        const curve = [];
        const padded = [points[0], ...points, points[points.length - 1]];

        for (let i = 1; i < padded.length - 2; i++) {
            const p0 = padded[i - 1];
            const p1 = padded[i];
            const p2 = padded[i + 1];
            const p3 = padded[i + 2];

            const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
            const steps = Math.max(1, Math.floor(dist / stepSize));

            for (let t = 0; t < 1; t += 1 / steps) {
                const t2 = t * t;
                const t3 = t2 * t;

                const x = 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);

                const y = 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);

                curve.push({ x, y });
            }
        }

        curve.push(points[points.length - 1]);
        return curve;
    }
}
