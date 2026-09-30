import { SpatialMath } from "../tools/SpatialMath.js";
import { FILRODENSWMB } from "../config.js";
import { TectonicFeatureEngine } from "./TectonicFeatureEngine.js";

/**
 * Handles signed distance field (SDF) calculations and spatial vector deformations
 * for fault lines and hot spot island chains.
 */
export class TectonicEngine {
    static MATH = {
        NOISE_SCALE_GLOBAL: 0.02,
        NOISE_SCALE_HOTSPOT: 0.05,
        NOISE_SCALE_VOLCANO: 0.04,
        NOISE_SCALE_VARIANCE: 0.1,
        GAUSSIAN_SPREAD_STANDARD: 2,
        GAUSSIAN_SPREAD_TIGHT: 6,
        // The outer share of a convergent or divergent fault's width across which its effect
        // eases out to nothing (see #faultProfile)
        EDGE_TAPER: 0.3,
        BASE_MODIFIER: 0.6,
        NOISE_MODIFIER: 0.8,
        SLIP_BASE_MODIFIER: 0.5,
        SLIP_NOISE_MODIFIER: 0.5,
        VOLCANO_BASE: 0.5, // Restored and boosted from 0.4
        VOLCANO_NOISE: 0.6, // Restored from 0.4
        JITTER_MAX_RATIO: 0.35, // Balanced for organic drift
        JITTER_OFFSET: 1000,
    };

    /**
     * The frame a map's fault noise is read in when none is given: the map's own pixels. This is
     * also the frame of every map that was never cropped, so for those maps the world frame
     * below changes nothing.
     */
    static #MAP_FRAME = Object.freeze({ zoom: 1, originX: 0, originY: 0 });

    /**
     * Applies all tectonic deformations to the raw elevation buffer.
     *
     * `frame` places the map in the pixels of the top map it was cut from (see
     * TerrainVersion.getTerrainParams): its zoom, and the top map pixel at its own top-left
     * corner. Every noise value the faults use is read at the point's position in the top map,
     * and hotspot volcanoes are spaced in the top map's pixels, so a fault on a regional map
     * has the same texture, and the same volcanoes, as the same fault on its parent (its
     * thickness is scaled with the crop by RegionalExtractor). Without a frame, noise is read
     * in the map's own pixels, which is exactly the same for a map that was never cropped.
     *
     * @param {Float32Array} elevationData - The terrain to deform, in place.
     * @param {number} width - The map's width in pixels.
     * @param {number} height - The map's height in pixels.
     * @param {object[]} faults - The fault lines and hotspot chains, in the map's pixels. Tectonic
     *   features among them (see TectonicFeatureEngine) are skipped: they have their own engine.
     * @param {object} simplex - The map's simplex noise generator.
     * @param {object|null} [activeBounds] - Only pixels inside these bounds are changed.
     * @param {{zoom: number, originX: number, originY: number}} [frame] - See above.
     */
    static applyTectonicFaults(elevationData, width, height, faults, simplex, activeBounds = null, frame = TectonicEngine.#MAP_FRAME) {
        if (!faults || faults.length === 0) return;
        const noise = TectonicEngine.#worldNoise(simplex, frame ?? TectonicEngine.#MAP_FRAME);

        let readBuffer = null;

        for (const fault of faults) {
            if (!fault.points || fault.points.length < 2 || TectonicFeatureEngine.isFeature(fault)) continue;

            if (fault.type === FILRODENSWMB.TECTONICS.TYPES.HOTSPOT) {
                this.#applyHotspotChain(elevationData, width, height, fault, noise, activeBounds);
            } else if (fault.type === FILRODENSWMB.TECTONICS.TYPES.SLIP) {
                if (!readBuffer) readBuffer = new Float32Array(elevationData);
                else readBuffer.set(elevationData);
                this.#applySlipFault(elevationData, readBuffer, width, height, fault, noise, activeBounds);
            } else {
                this.#applyStandardFault(elevationData, width, height, fault, noise, activeBounds);
            }
        }
    }

    /**
     * Noise read at a map pixel's position in the top map's pixels (see applyTectonicFaults).
     *
     * `scale` is applied to the top map position and `offset` added afterwards, in that order,
     * so for a map that was never cropped (zoom 1, origin 0) every value is bit-identical to
     * reading the noise at the map pixel directly.
     *
     * @returns {{at: function(number, number, number, number=): number, zoom: number}} `at(x, y, scale, offset)`
     *   gives simplex noise in -1..1 for map pixel (x, y); `zoom` is the frame's zoom.
     */
    static #worldNoise(simplex, frame) {
        const { zoom, originX, originY } = frame;
        return {
            zoom,
            at: (x, y, scale, offset = 0) => simplex.noise2D((originX + x / zoom) * scale + offset, (originY + y / zoom) * scale + offset),
        };
    }

    static #applyStandardFault(elevationData, width, height, fault, noise, activeBounds = null) {
        const thickness = fault.thickness || FILRODENSWMB.TECTONICS.DEFAULT_THICKNESS;
        const strength = fault.strength || FILRODENSWMB.TECTONICS.DEFAULT_STRENGTH;
        const radiusSq = thickness * thickness;

        for (let i = 0; i < fault.points.length - 1; i++) {
            const p1 = fault.points[i];
            const p2 = fault.points[i + 1];

            const faultBounds = this.#calculateSegmentBounds(p1, p2, thickness, width, height);
            const bounds = SpatialMath.intersectBounds(faultBounds, activeBounds);
            if (!SpatialMath.isValidBounds(bounds)) continue;

            for (let y = bounds.minY; y <= bounds.maxY; y++) {
                for (let x = bounds.minX; x <= bounds.maxX; x++) {
                    const idx = y * width + x;
                    const distSq = this.#distToSegmentSq(x, y, p1, p2);

                    if (distSq > radiusSq) continue;

                    const dist = Math.sqrt(distSq);
                    const normDist = dist / thickness;
                    const noiseFactor = noise.at(x, y, this.MATH.NOISE_SCALE_GLOBAL) * 0.5 + 0.5;
                    const currentElev = elevationData[idx];

                    if (fault.type === FILRODENSWMB.TECTONICS.TYPES.CONVERGENT) {
                        this.#applyConvergent(elevationData, idx, currentElev, normDist, strength, noiseFactor);
                    } else {
                        this.#applyDivergent(elevationData, idx, currentElev, normDist, strength, noiseFactor);
                    }
                }
            }
        }
    }

    static #applySlipFault(elevationData, readBuffer, width, height, fault, noise, activeBounds = null) {
        const thickness = fault.thickness || FILRODENSWMB.TECTONICS.DEFAULT_THICKNESS;
        const strength = fault.strength || FILRODENSWMB.TECTONICS.DEFAULT_STRENGTH;
        const radiusSq = thickness * thickness;

        for (let i = 0; i < fault.points.length - 1; i++) {
            const p1 = fault.points[i];
            const p2 = fault.points[i + 1];

            // 1. Calculate the native physical footprint of the fault segment
            const faultBounds = this.#calculateSegmentBounds(p1, p2, thickness, width, height);

            // 2. Intersect it with the active processing zone
            const bounds = SpatialMath.intersectBounds(faultBounds, activeBounds);

            // 3. Skip the heavy math loop entirely if this segment is outside the rebuild zone
            if (!SpatialMath.isValidBounds(bounds)) continue;

            for (let y = bounds.minY; y <= bounds.maxY; y++) {
                for (let x = bounds.minX; x <= bounds.maxX; x++) {
                    const idx = y * width + x;
                    const distSq = this.#distToSegmentSq(x, y, p1, p2);

                    if (distSq > radiusSq) continue;

                    const dist = Math.sqrt(distSq);
                    const normDist = dist / thickness;
                    const noiseFactor = noise.at(x, y, this.MATH.NOISE_SCALE_GLOBAL) * 0.5 + 0.5;

                    this.#applySlip(elevationData, readBuffer, idx, x, y, width, height, normDist, p1, p2, strength, thickness, noiseFactor);
                }
            }
        }
    }

    /**
     * Raises elevation towards a ceiling of 1, tapering the effect off smoothly as terrain
     * nears that ceiling instead of letting it hit an abrupt wall - the "damping factor" (`room`)
     * is how much headroom is left below 1.
     *
     * `room` is clamped to [0, 1] on its own, separately from the output. That matters once
     * `currentElev` can already be above 1 (hand-raised past the old ceiling by the brush, or by
     * an earlier fault): without the clamp, `1.0 - currentElev` goes negative and `dampened`
     * follows it negative, which would make a convergent fault *lower* an already-tall peak -
     * exactly backwards for a fault whose whole purpose is to raise terrain. Clamping `room`
     * instead makes the fault do nothing further once terrain is already at or past the ceiling,
     * which is the correct "no more room to push into" behaviour, and leaves elevation itself
     * unclamped so a peak already above 1 stays exactly where it was. For any `currentElev`
     * already inside [0, 1] - everything reachable before hand-edited terrain could overflow -
     * `room` equals what `1.0 - currentElev` always computed, so this changes nothing there.
     */
    static #applyConvergent(elevationData, idx, currentElev, normDist, strength, noiseFactor) {
        const gaussian = this.#faultProfile(normDist);
        const modification = gaussian * strength * (this.MATH.BASE_MODIFIER + noiseFactor * this.MATH.NOISE_MODIFIER);
        const room = Math.max(0, Math.min(1, 1.0 - currentElev));
        const dampened = modification * room;
        elevationData[idx] = currentElev + dampened;
    }

    /**
     * Lowers elevation towards a floor of 0, the mirror image of #applyConvergent above: `room`
     * is how much depth is left above 0, clamped to [0, 1] independently of the output for the
     * same reason - without the clamp, a hand-carved trench already below 0 would make `room`
     * negative and the fault would raise the trench instead of deepening it. See #applyConvergent
     * for the full reasoning; it applies here with the floor and ceiling swapped.
     */
    static #applyDivergent(elevationData, idx, currentElev, normDist, strength, noiseFactor) {
        const gaussian = this.#faultProfile(normDist);
        const modification = gaussian * strength * (this.MATH.BASE_MODIFIER + noiseFactor * this.MATH.NOISE_MODIFIER);
        const room = Math.max(0, Math.min(1, currentElev));
        const dampened = modification * room;
        elevationData[idx] = currentElev - dampened;
    }

    /**
     * The cross-section of a convergent or divergent fault: a bell curve, 1 on the fault line,
     * eased out to exactly 0, with no slope, at its thickness (`normDist` 1).
     *
     * A plain bell curve is still about 2% of its height at the fault's edge, and the fault stops
     * being applied beyond its thickness, so it used to end in a small step all the way along
     * both sides, which relief shading shows as a line. Across the outer EDGE_TAPER share of the
     * width the curve is multiplied down to 0 along a smooth S-curve, so neither the height nor
     * the slope jumps at the edge; the rest of the cross-section is unchanged.
     */
    static #faultProfile(normDist) {
        const bell = Math.exp(-Math.pow(normDist * this.MATH.GAUSSIAN_SPREAD_STANDARD, 2));
        const taperStart = 1 - this.MATH.EDGE_TAPER;
        if (normDist <= taperStart) return bell;
        if (normDist >= 1) return 0;

        const across = (1 - normDist) / this.MATH.EDGE_TAPER;
        return bell * across * across * (3 - 2 * across);
    }

    static #applySlip(elevationData, readBuffer, idx, x, y, width, height, normDist, p1, p2, strength, thickness, noiseFactor) {
        const side = this.#getVectorSide(x, y, p1, p2);

        // 1. Calculate normalised direction vector of the fault line
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const len = Math.hypot(dx, dy);
        if (len === 0) return;
        const nx = dx / len;
        const ny = dy / len;

        // 2. Shift magnitude tapers off quadratically from the epicentre
        const shiftMag = Math.pow(1.0 - normDist, 2) * strength * thickness * side;

        // 3. Modulate the shift with noise so the tear isn't perfectly surgical
        const jaggedShift = shiftMag * (this.MATH.SLIP_BASE_MODIFIER + noiseFactor * this.MATH.SLIP_NOISE_MODIFIER);

        let readX = Math.round(x - nx * jaggedShift);
        let readY = Math.round(y - ny * jaggedShift);

        // 4. Clamp to map boundaries to prevent array overflow
        readX = Math.max(0, Math.min(width - 1, readX));
        readY = Math.max(0, Math.min(height - 1, readY));

        // 5. Read from the pristine snapshot buffer
        elevationData[idx] = readBuffer[readY * width + readX];
    }

    static #applyHotspotChain(elevationData, width, height, fault, noise, activeBounds = null) {
        const baseRadius = fault.thickness || FILRODENSWMB.TECTONICS.DEFAULT_THICKNESS;
        const baseStrength = fault.strength || FILRODENSWMB.TECTONICS.DEFAULT_STRENGTH;
        // The spacing is in the top map's pixels, so a regional map places the same volcanoes
        // along the chain as its parent rather than more, smaller ones
        const spacing = FILRODENSWMB.TECTONICS.HOTSPOT_SPACING * noise.zoom;

        const rawPlumes = this.#interpolatePlumeCenters(fault.points, spacing);
        const totalPlumes = rawPlumes.length;

        for (let i = 0; i < totalPlumes; i++) {
            const rawPlume = rawPlumes[i];

            const jitterMax = spacing * this.MATH.JITTER_MAX_RATIO;
            const jitterX = noise.at(rawPlume.x, rawPlume.y, this.MATH.NOISE_SCALE_HOTSPOT) * jitterMax;
            const jitterY = noise.at(rawPlume.x, rawPlume.y, this.MATH.NOISE_SCALE_HOTSPOT, this.MATH.JITTER_OFFSET) * jitterMax;

            const plume = {
                x: rawPlume.x + jitterX,
                y: rawPlume.y + jitterY,
            };

            const ageRatio = 1.0 - (i / totalPlumes) * (1.0 - FILRODENSWMB.TECTONICS.HOTSPOT_DECAY);
            const sizeVariance = (noise.at(plume.x, plume.y, this.MATH.NOISE_SCALE_VARIANCE) + 1.0) / 2.0;

            const radius = baseRadius * ageRatio * (this.MATH.BASE_MODIFIER + sizeVariance * this.MATH.NOISE_MODIFIER);
            const strength = baseStrength * ageRatio;
            const radiusSq = radius * radius;

            // 1. Calculate the native physical footprint of the volcanic plume
            const plumeBounds = this.#calculatePointBounds(plume, radius, width, height);

            // 2. Intersect it with the active processing zone
            const bounds = SpatialMath.intersectBounds(plumeBounds, activeBounds);

            // 3. Skip the heavy math loop entirely if this plume is outside the rebuild zone
            if (!SpatialMath.isValidBounds(bounds)) continue;

            for (let y = bounds.minY; y <= bounds.maxY; y++) {
                for (let x = bounds.minX; x <= bounds.maxX; x++) {
                    const dx = x - plume.x;
                    const dy = y - plume.y;
                    const distSq = dx * dx + dy * dy;

                    if (distSq > radiusSq) continue;

                    const falloff = Math.pow(1.0 - distSq / radiusSq, 2);
                    const rawNoise = noise.at(x, y, this.MATH.NOISE_SCALE_VOLCANO);
                    const mappedNoise = (rawNoise + 1.0) / 2.0;

                    const idx = y * width + x;
                    const currentElev = elevationData[idx];

                    const volcanoDome = (this.MATH.VOLCANO_BASE + mappedNoise * this.MATH.VOLCANO_NOISE) * falloff * strength;

                    // Same damping-factor clamp as #applyConvergent, and for the same reason: a
                    // hotspot plume raises terrain towards a ceiling of 1, so `room` (not the
                    // output) is what has to stop going negative once currentElev is already
                    // past 1, or the plume would start lowering an already-tall hand-raised peak.
                    const room = Math.max(0, Math.min(1, 1.0 - currentElev));
                    const dampened = volcanoDome * room;

                    elevationData[idx] = currentElev + dampened;
                }
            }
        }
    }

    // --- Spatial Math Helpers ---

    static #calculateSegmentBounds(p1, p2, pad, width, height) {
        return {
            minX: Math.max(0, Math.floor(Math.min(p1.x, p2.x) - pad)),
            maxX: Math.min(width - 1, Math.ceil(Math.max(p1.x, p2.x) + pad)),
            minY: Math.max(0, Math.floor(Math.min(p1.y, p2.y) - pad)),
            maxY: Math.min(height - 1, Math.ceil(Math.max(p1.y, p2.y) + pad)),
        };
    }

    static #calculatePointBounds(p, pad, width, height) {
        return {
            minX: Math.max(0, Math.floor(p.x - pad)),
            maxX: Math.min(width - 1, Math.ceil(p.x + pad)),
            minY: Math.max(0, Math.floor(p.y - pad)),
            maxY: Math.min(height - 1, Math.ceil(p.y + pad)),
        };
    }

    static #distToSegmentSq(px, py, p1, p2) {
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const lenSq = dx * dx + dy * dy;

        if (lenSq === 0) return Math.pow(px - p1.x, 2) + Math.pow(py - p1.y, 2);

        let t = ((px - p1.x) * dx + (py - p1.y) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));

        const projX = p1.x + t * dx;
        const projY = p1.y + t * dy;

        return Math.pow(px - projX, 2) + Math.pow(py - projY, 2);
    }

    static #getVectorSide(px, py, p1, p2) {
        const cross = (p2.x - p1.x) * (py - p1.y) - (p2.y - p1.y) * (px - p1.x);
        return cross >= 0 ? 1 : -1;
    }

    static #interpolatePlumeCenters(points, stepSize) {
        const plumes = [];
        for (let i = 0; i < points.length - 1; i++) {
            const p1 = points[i];
            const p2 = points[i + 1];
            const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
            const steps = Math.floor(dist / stepSize);

            for (let s = 0; s <= steps; s++) {
                const t = steps === 0 ? 0 : s / steps;
                plumes.push({
                    x: p1.x + t * (p2.x - p1.x),
                    y: p1.y + t * (p2.y - p1.y),
                });
            }
        }
        return plumes;
    }
}
