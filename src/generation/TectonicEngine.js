import { FILRODENSWMB } from "../config.js";

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
     * Applies all tectonic deformations to the raw elevation buffer.
     */
    static applyTectonicFaults(elevationData, width, height, faults, simplex) {
        if (!faults || faults.length === 0) return;

        let readBuffer = null;

        for (const fault of faults) {
            if (!fault.points || fault.points.length < 2) continue;

            if (fault.type === FILRODENSWMB.TECTONICS.TYPES.HOTSPOT) {
                this.#applyHotspotChain(elevationData, width, height, fault, simplex);
            } else if (fault.type === FILRODENSWMB.TECTONICS.TYPES.SLIP) {
                // Take a fresh snapshot immediately before each slip fault to prevent smearing
                readBuffer = new Float32Array(elevationData);
                this.#applySlipFault(elevationData, readBuffer, width, height, fault, simplex);
            } else {
                this.#applyStandardFault(elevationData, width, height, fault, simplex);
            }
        }
    }

    static #applyStandardFault(elevationData, width, height, fault, simplex) {
        const thickness = fault.thickness || FILRODENSWMB.TECTONICS.DEFAULT_THICKNESS;
        const strength = fault.strength || FILRODENSWMB.TECTONICS.DEFAULT_STRENGTH;
        const radiusSq = thickness * thickness;

        for (let i = 0; i < fault.points.length - 1; i++) {
            const p1 = fault.points[i];
            const p2 = fault.points[i + 1];

            const bounds = this.#calculateSegmentBounds(p1, p2, thickness, width, height);

            for (let y = bounds.minY; y <= bounds.maxY; y++) {
                for (let x = bounds.minX; x <= bounds.maxX; x++) {
                    const idx = y * width + x;
                    const distSq = this.#distToSegmentSq(x, y, p1, p2);

                    if (distSq > radiusSq) continue;

                    const dist = Math.sqrt(distSq);
                    const normDist = dist / thickness;
                    const noiseFactor = simplex.noise2D(x * this.MATH.NOISE_SCALE_GLOBAL, y * this.MATH.NOISE_SCALE_GLOBAL) * 0.5 + 0.5;
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

    static #applySlipFault(elevationData, readBuffer, width, height, fault, simplex) {
        const thickness = fault.thickness || FILRODENSWMB.TECTONICS.DEFAULT_THICKNESS;
        const strength = fault.strength || FILRODENSWMB.TECTONICS.DEFAULT_STRENGTH;
        const radiusSq = thickness * thickness;

        for (let i = 0; i < fault.points.length - 1; i++) {
            const p1 = fault.points[i];
            const p2 = fault.points[i + 1];

            const bounds = this.#calculateSegmentBounds(p1, p2, thickness, width, height);

            for (let y = bounds.minY; y <= bounds.maxY; y++) {
                for (let x = bounds.minX; x <= bounds.maxX; x++) {
                    const idx = y * width + x;
                    const distSq = this.#distToSegmentSq(x, y, p1, p2);

                    if (distSq > radiusSq) continue;

                    const dist = Math.sqrt(distSq);
                    const normDist = dist / thickness;
                    const noiseFactor = simplex.noise2D(x * this.MATH.NOISE_SCALE_GLOBAL, y * this.MATH.NOISE_SCALE_GLOBAL) * 0.5 + 0.5;

                    this.#applySlip(elevationData, readBuffer, idx, x, y, width, height, normDist, p1, p2, strength, thickness, noiseFactor);
                }
            }
        }
    }

    static #applyConvergent(elevationData, idx, currentElev, normDist, strength, noiseFactor) {
        const gaussian = Math.exp(-Math.pow(normDist * this.MATH.GAUSSIAN_SPREAD_STANDARD, 2));
        const modification = gaussian * strength * (this.MATH.BASE_MODIFIER + noiseFactor * this.MATH.NOISE_MODIFIER);
        const dampened = modification * (1.0 - currentElev);
        elevationData[idx] = Math.min(1.0, currentElev + dampened);
    }

    static #applyDivergent(elevationData, idx, currentElev, normDist, strength, noiseFactor) {
        const gaussian = Math.exp(-Math.pow(normDist * this.MATH.GAUSSIAN_SPREAD_STANDARD, 2));
        const modification = gaussian * strength * (this.MATH.BASE_MODIFIER + noiseFactor * this.MATH.NOISE_MODIFIER);
        const dampened = modification * currentElev;
        elevationData[idx] = Math.max(0.0, currentElev - dampened);
    }

    static #applySlip(elevationData, readBuffer, idx, x, y, width, height, normDist, p1, p2, strength, thickness, noiseFactor) {
        const side = this.#getVectorSide(x, y, p1, p2);

        // 1. Calculate normalized direction vector of the fault line
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const len = Math.hypot(dx, dy);
        if (len === 0) return;
        const nx = dx / len;
        const ny = dy / len;

        // 2. Shift magnitude tapers off quadratically from the epicenter
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

    static #applyHotspotChain(elevationData, width, height, fault, simplex) {
        const baseRadius = fault.thickness || FILRODENSWMB.TECTONICS.DEFAULT_THICKNESS;
        const baseStrength = fault.strength || FILRODENSWMB.TECTONICS.DEFAULT_STRENGTH;
        const spacing = FILRODENSWMB.TECTONICS.HOTSPOT_SPACING;

        const rawPlumes = this.#interpolatePlumeCenters(fault.points, spacing);
        const totalPlumes = rawPlumes.length;

        for (let i = 0; i < totalPlumes; i++) {
            const rawPlume = rawPlumes[i];

            const jitterMax = spacing * this.MATH.JITTER_MAX_RATIO;
            const jitterX = simplex.noise2D(rawPlume.x * this.MATH.NOISE_SCALE_HOTSPOT, rawPlume.y * this.MATH.NOISE_SCALE_HOTSPOT) * jitterMax;
            const jitterY = simplex.noise2D(rawPlume.x * this.MATH.NOISE_SCALE_HOTSPOT + this.MATH.JITTER_OFFSET, rawPlume.y * this.MATH.NOISE_SCALE_HOTSPOT + this.MATH.JITTER_OFFSET) * jitterMax;

            const plume = {
                x: rawPlume.x + jitterX,
                y: rawPlume.y + jitterY,
            };

            const ageRatio = 1.0 - (i / totalPlumes) * (1.0 - FILRODENSWMB.TECTONICS.HOTSPOT_DECAY);
            const sizeVariance = (simplex.noise2D(plume.x * this.MATH.NOISE_SCALE_VARIANCE, plume.y * this.MATH.NOISE_SCALE_VARIANCE) + 1.0) / 2.0;

            const radius = baseRadius * ageRatio * (this.MATH.BASE_MODIFIER + sizeVariance * this.MATH.NOISE_MODIFIER);
            const strength = baseStrength * ageRatio;
            const radiusSq = radius * radius;

            const bounds = this.#calculatePointBounds(plume, radius, width, height);

            for (let y = bounds.minY; y <= bounds.maxY; y++) {
                for (let x = bounds.minX; x <= bounds.maxX; x++) {
                    const dx = x - plume.x;
                    const dy = y - plume.y;
                    const distSq = dx * dx + dy * dy;

                    if (distSq > radiusSq) continue;

                    const falloff = Math.pow(1.0 - distSq / radiusSq, 2);
                    const rawNoise = simplex.noise2D(x * this.MATH.NOISE_SCALE_VOLCANO, y * this.MATH.NOISE_SCALE_VOLCANO);
                    const mappedNoise = (rawNoise + 1.0) / 2.0;

                    const idx = y * width + x;
                    const currentElev = elevationData[idx];

                    const volcanoDome = (this.MATH.VOLCANO_BASE + mappedNoise * this.MATH.VOLCANO_NOISE) * falloff * strength;
                    const dampened = volcanoDome * (1.0 - currentElev);

                    elevationData[idx] = Math.min(1.0, currentElev + dampened);
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
