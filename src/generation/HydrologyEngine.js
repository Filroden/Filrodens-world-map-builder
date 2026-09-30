import { SpatialMath } from "../tools/SpatialMath.js";
import { FILRODENSWMB } from "../config.js";
import { RiverNetwork } from "./RiverNetwork.js";

/** Spacing, in map pixels, of the points a custom river's spline is sampled at. */
const SPLINE_STEP = 0.25;

/**
 * Custom rivers: the line the user draws, the ground shaped around it, and (under the legacy
 * river rules) the spring a procedural river is traced from along it.
 *
 * Two sets of rules, chosen by the map's terrain revision (see TerrainVersion.usesCurrentRivers):
 *
 * - Legacy: a trench is carved along the line, down to a bed that never rises, and a spring is
 *   placed near its top (getRiverSources) so the procedural trace runs down the trench. The
 *   drawn river is wherever that trace goes.
 * - Current: the line itself is the river (authoredRivers, traced by ProceduralEngine before any
 *   spring), and the ground is shaped into a valley around it (#carveValley) that keeps the
 *   ground's own texture, so the river looks like any procedural river and sits where it was
 *   drawn.
 */
export class HydrologyEngine {
    static MATH = {
        PATH_STEP_SIZE: 1, // 1 pixel interval guarantees continuous carving
    };

    /**
     * Shapes the ground along every custom river.
     *
     * @param {boolean} [valley] - Shape the current valley (see #carveValley) rather than the
     *   legacy trench. Maps made before the current river rules keep the trench, so their terrain
     *   stays as it was.
     */
    static carveManualRivers(elevationData, width, height, rivers, simplex, seaLevel, activeBounds = null, valley = false) {
        if (!rivers || rivers.length === 0) return;
        for (const river of rivers) {
            if (valley) this.#carveValley(elevationData, width, height, river, seaLevel, activeBounds);
            else this.#carveSingleRiver(elevationData, width, height, river, simplex, seaLevel, activeBounds);
        }
    }

    /**
     * The custom rivers as paths of whole pixels, under the current river rules (see
     * ProceduralEngine#traceAuthored). Each follows its spline from its higher end to its lower
     * end, stopping where it leaves the map. Its inflow (see RiverNetwork.inflowForWidth) makes
     * the drawn river start MANUAL_RIVER_START_SHARE as wide as the Width it was drawn with.
     *
     * @param {Float32Array} elevationData - The terrain, with the custom rivers already carved.
     * @param {number} width
     * @param {number} height
     * @param {object[]} rivers - The custom rivers.
     * @param {number} pixelsPerBaseline - Map pixels per pixel of a BASELINE_DIMENSION map.
     * @returns {{id: string, pixels: {x: number, y: number}[], inflow: number}[]}
     */
    static authoredRivers(elevationData, width, height, rivers, pixelsPerBaseline) {
        const authored = [];
        for (const river of rivers ?? []) {
            if (!river.points || river.points.length < 2) continue;
            const path = this.#getSplinePoints(river.points, SPLINE_STEP);
            this.#ensureDownhillFlow(elevationData, width, path);
            const pixels = this.#pixelPath(path, width, height);
            if (pixels.length < 2) continue;
            const drawnWidth = river.width * (river.widthScale ?? 1) * FILRODENSWMB.HYDROLOGY.MANUAL_RIVER_START_SHARE;
            authored.push({ id: river.id, pixels, inflow: RiverNetwork.inflowForWidth(drawnWidth, pixelsPerBaseline) });
        }
        return authored;
    }

    /**
     * Dynamically identifies the highest point of each manual river to act as a spring for the
     * procedural water algorithm (legacy river rules only).
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

    static #carveSingleRiver(elevationData, width, height, river, simplex, seaLevel, activeBounds = null) {
        if (!river.points || river.points.length < 2) return;

        const path = this.#getSplinePoints(river.points, SPLINE_STEP);
        if (path.length === 0) return;

        this.#ensureDownhillFlow(elevationData, width, path);

        const depth = FILRODENSWMB.HYDROLOGY.MANUAL_RIVER_DEPTHS?.[river.width] || 0.025;

        const targetRadius = river.width / 2;
        const startRadius = 1;

        const bedProfile = this.#buildMonotonicBedProfile(elevationData, width, path, depth, seaLevel);

        for (let i = 0; i < path.length; i++) {
            const progress = path.length > 1 ? i / (path.length - 1) : 1;
            const currentRadius = startRadius + (targetRadius - startRadius) * progress;
            const currentRadiusSq = currentRadius * currentRadius;

            this.#carveRiverCrossSection(elevationData, width, height, path[i], currentRadius, currentRadiusSq, bedProfile[i], activeBounds);
        }
    }

    /**
     * The current custom river valley. The line's floor is brought down to a bed worked out as the
     * legacy trench's is (the ground less a depth, never rising downstream, never below sea level
     * before the coast), with MANUAL_RIVER_VALLEY_DEPTH of the trench's depth, since the river is
     * drawn along the line and the valley only has to hold it; but rather than setting the ground to that bed, each point of
     * the line works out how far its own ground has to come down to reach it, and lowers the
     * ground around it by that much: fully within the channel (the river's half-width, tapering
     * from a pixel at the source as the legacy trench does), then less and less along a cosine
     * out to MANUAL_RIVER_VALLEY_SPREAD times that. Lowering by an amount, instead of blending
     * towards a flat bed, keeps the ground's own texture (the fine roughness of the terrain) all
     * the way down, and the gentle cosine keeps relief shading from drawing the valley's sides as
     * a hard dark line.
     *
     * Where the lowerings of neighbouring points overlap, the deepest is used, once. Applying
     * them one after another would lower an overlap repeatedly and dig the valley ever deeper
     * wherever the line bends.
     *
     * A regional map's custom rivers carry `widthScale` (see RegionalExtractor), so the valley is
     * as wide in the world as on the parent map.
     */
    static #carveValley(elevationData, width, height, river, seaLevel, activeBounds) {
        if (!river.points || river.points.length < 2) return;
        const path = this.#getSplinePoints(river.points, SPLINE_STEP);
        if (path.length === 0) return;
        this.#ensureDownhillFlow(elevationData, width, path);

        const hydrology = FILRODENSWMB.HYDROLOGY;
        const depth = (hydrology.MANUAL_RIVER_DEPTHS?.[river.width] || hydrology.MANUAL_RIVER_DEFAULT_DEPTH) * hydrology.MANUAL_RIVER_VALLEY_DEPTH;
        const scale = river.widthScale ?? 1;
        const bed = this.#buildMonotonicBedProfile(elevationData, width, path, depth, seaLevel);

        const lowering = this.#valleyLowering(elevationData, width, height, path, bed, (river.width / 2) * scale, scale);
        const box = SpatialMath.intersectBounds(lowering.box, activeBounds);
        if (!SpatialMath.isValidBounds(box)) return;

        for (let y = box.minY; y <= box.maxY; y++) {
            for (let x = box.minX; x <= box.maxX; x++) {
                const amount = lowering.values[(y - lowering.box.minY) * lowering.boxWidth + (x - lowering.box.minX)];
                // Only ever lowers, and never clamps (see #carveRiverCrossSection)
                if (amount > 0) elevationData[y * width + x] -= amount;
            }
        }
    }

    /**
     * How far every pixel near a custom river's line comes down (see #carveValley), in a buffer
     * covering just the valley's box.
     * @returns {{values: Float32Array, box: object, boxWidth: number}}
     */
    static #valleyLowering(elevationData, width, height, path, bed, targetRadius, scale) {
        const spread = FILRODENSWMB.HYDROLOGY.MANUAL_RIVER_VALLEY_SPREAD;
        const startRadius = scale;
        const radii = path.map((_, i) => startRadius + (targetRadius - startRadius) * (path.length > 1 ? i / (path.length - 1) : 1));
        const reach = Math.max(...radii) * spread;
        const box = {
            minX: Math.max(0, Math.floor(Math.min(...path.map((p) => p.x)) - reach)),
            minY: Math.max(0, Math.floor(Math.min(...path.map((p) => p.y)) - reach)),
            maxX: Math.min(width - 1, Math.ceil(Math.max(...path.map((p) => p.x)) + reach)),
            maxY: Math.min(height - 1, Math.ceil(Math.max(...path.map((p) => p.y)) + reach)),
        };
        const boxWidth = box.maxX - box.minX + 1;
        const values = new Float32Array(boxWidth * (box.maxY - box.minY + 1));

        for (let i = 0; i < path.length; i++) {
            const drop = this.#sampleElevation(elevationData, width, path[i]) - bed[i];
            if (drop > 0) this.#stampLowering(values, box, boxWidth, path[i], radii[i], radii[i] * spread, drop);
        }
        return { values, box, boxWidth };
    }

    /** Records one point's lowering: `drop` within `core` of it, easing to 0 at `outer` (pixel centres). */
    static #stampLowering(values, box, boxWidth, pt, core, outer, drop) {
        const minX = Math.max(box.minX, Math.floor(pt.x - outer));
        const maxX = Math.min(box.maxX, Math.ceil(pt.x + outer));
        const minY = Math.max(box.minY, Math.floor(pt.y - outer));
        const maxY = Math.min(box.maxY, Math.ceil(pt.y + outer));
        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                const distance = Math.hypot(x + 0.5 - pt.x, y + 0.5 - pt.y);
                if (distance >= outer) continue;
                const t = Math.max(0, (distance - core) / (outer - core));
                const amount = drop * 0.5 * (1 + Math.cos(Math.PI * t));
                const at = (y - box.minY) * boxWidth + (x - box.minX);
                if (amount > values[at]) values[at] = amount;
            }
        }
    }

    /** The pixels a sampled spline passes through, in order, from its start until it leaves the map. */
    static #pixelPath(path, width, height) {
        const pixels = [];
        for (const point of path) {
            const x = Math.floor(point.x);
            const y = Math.floor(point.y);
            const inside = x >= 0 && y >= 0 && x < width && y < height;
            if (!inside) {
                if (pixels.length > 0) break;
                continue;
            }
            const last = pixels.at(-1);
            if (last?.x === x && last.y === y) continue;
            pixels.push({ x, y });
        }
        return pixels;
    }

    /**
     * Builds a strictly non-increasing target bed elevation for every point on the path,
     * following the natural terrain (so it dips into gorges and drops at waterfalls)
     * but never rising, and never dropping below sea level.
     */
    static #buildMonotonicBedProfile(elevationData, width, path, depth, seaLevel) {
        const EPSILON = 0.000001;
        const SAFE_COASTAL_ELEVATION = seaLevel + 0.0001;

        const profile = new Array(path.length);
        const startElev = this.#sampleElevation(elevationData, width, path[0]);

        let runningBed = startElev - depth;

        for (let i = 0; i < path.length; i++) {
            const terrainElev = this.#sampleElevation(elevationData, width, path[i]);

            let naturalBed = terrainElev - depth;

            // If on land, mathematically guarantee to budget enough
            // remaining distance to never drop below sea level prematurely.
            if (terrainElev >= seaLevel) {
                const remainingSteps = path.length - 1 - i;
                const minRequiredBed = SAFE_COASTAL_ELEVATION + remainingSteps * EPSILON;

                naturalBed = Math.max(naturalBed, minRequiredBed);
                runningBed = Math.min(naturalBed, runningBed - EPSILON);
                runningBed = Math.max(runningBed, minRequiredBed);
            } else {
                runningBed = Math.min(naturalBed, runningBed - EPSILON);
            }

            profile[i] = runningBed;
        }

        return profile;
    }

    static #carveRiverCrossSection(elevationData, width, height, pt, radius, radiusSq, bedElev, activeBounds = null) {
        const cx = Math.floor(pt.x);
        const cy = Math.floor(pt.y);

        let bounds = this.#calculateBounds(cx, cy, radius, width, height);
        bounds = SpatialMath.intersectBounds(bounds, activeBounds);

        if (!SpatialMath.isValidBounds(bounds)) return;

        const coreRadius = Math.max(1, radius * 0.5);
        const coreRadiusSq = coreRadius * coreRadius;

        for (let y = bounds.minY; y <= bounds.maxY; y++) {
            for (let x = bounds.minX; x <= bounds.maxX; x++) {
                const idx = y * width + x;

                const dx = x - pt.x;
                const dy = y - pt.y;
                const trueDistSq = dx * dx + dy * dy;

                if (trueDistSq > radiusSq) continue;

                const distFromCenter = Math.sqrt(trueDistSq);
                let blendFactor = 0;

                if (trueDistSq > coreRadiusSq) {
                    const normDist = (distFromCenter - coreRadius) / (radius - coreRadius);
                    const clampedDist = Math.max(0, Math.min(1, normDist));
                    blendFactor = clampedDist * clampedDist; // Replaced Math.pow
                }

                const terrainElev = elevationData[idx];
                const carvedElev = bedElev + (terrainElev - bedElev) * blendFactor;

                // Compare and write the same, unclamped value. Carving only ever lowers terrain
                // (the check below is the whole "only if this is actually deeper" guard), so
                // there is no ceiling to worry about; and there must be no floor, because a river
                // routed through a hand-carved trench already below 0 has to be able to deepen it
                // further. Clamping the write to a floor of 0 while comparing against the
                // unclamped value here would let this check decide "yes, deepen it" and then write
                // a value that is actually *higher* than the already-negative terrain it was
                // supposed to deepen, raising the riverbed instead of carving it.
                if (carvedElev < elevationData[idx]) {
                    elevationData[idx] = carvedElev;
                }
            }
        }
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
