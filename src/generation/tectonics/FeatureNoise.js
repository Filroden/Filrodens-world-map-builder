import { FILRODENSWMB } from "../../config.js";

/**
 * Noise for the tectonic features, read in pixels of a BASELINE_DIMENSION world.
 *
 * A feature has to look the same on maps of different sizes, and on a regional map cut from its
 * parent, so no noise is ever read at a map pixel directly. Each map pixel is first placed in the
 * top map it was cut from (the frame's zoom and top-left corner, see TerrainVersion), then scaled
 * to a BASELINE_DIMENSION map. Wavelengths are therefore set once, in baseline pixels, and hold at
 * any size. Where the map has more pixels to the world than the baseline (a large top map or a
 * zoomed regional map) finer layers are added (`detail`), one per doubling, as for the terrain.
 */
export class FeatureNoise {
    /**
     * @param {object} simplex - The map's simplex noise generator.
     * @param {{zoom: number, originX: number, originY: number, rootSize: number}} frame - The
     *   map's place in its top map, and the top map's longer side in pixels.
     */
    constructor(simplex, frame) {
        this.simplex = simplex;
        this.zoom = frame.zoom || 1;
        this.originX = frame.originX || 0;
        this.originY = frame.originY || 0;
        this.toBaseline = FILRODENSWMB.LIMITS.BASELINE_DIMENSION / frame.rootSize;
        // Baseline pixels per map pixel: converts lengths along a line or across it
        this.perPixel = this.toBaseline / this.zoom;
        const density = (this.zoom * frame.rootSize) / FILRODENSWMB.LIMITS.BASELINE_DIMENSION;
        this.detail = density > 1 ? Math.round(Math.log2(density)) : 0;
    }

    /** A map pixel's x position in baseline pixels. */
    bx(x) {
        return (this.originX + x / this.zoom) * this.toBaseline;
    }

    /** A map pixel's y position in baseline pixels. */
    by(y) {
        return (this.originY + y / this.zoom) * this.toBaseline;
    }

    /**
     * Fractal noise centred on 0, from -1 to 1: layers at double the frequency and half the
     * amplitude, extra (detail) layers left out of the normalising total so they add fine
     * variation without shrinking the coarse shape. The sum is eased through a hyperbolic tangent
     * rather than clamped, since simplex noise can pass 1 and clamping would leave flat spots.
     */
    fbm(x, y, octaves, extra = 0) {
        let total = 0;
        let amplitude = 1;
        let frequency = 1;
        let norm = 0;
        for (let i = 0; i < octaves + extra; i++) {
            total += this.simplex.noise2D(x * frequency, y * frequency) * amplitude;
            if (i < octaves) norm += amplitude;
            amplitude *= 0.5;
            frequency *= 2;
        }
        return Math.tanh(total / norm);
    }

    /**
     * Ridged multifractal from 0 to 1: sharp crests where the noise crosses 0, each layer weighted
     * by the one before so the crests carry the fine detail and the valleys stay smoother. Each
     * layer is offset so the layers' crests do not line up.
     */
    ridged(x, y, octaves, extra = 0) {
        let total = 0;
        let amplitude = 1;
        let frequency = 1;
        let norm = 0;
        let weight = 1;
        for (let i = 0; i < octaves + extra; i++) {
            let ridge = 1 - Math.abs(this.simplex.noise2D(x * frequency + RIDGE_OFFSET_X * i, y * frequency - RIDGE_OFFSET_Y * i));
            ridge *= ridge * weight;
            weight = Math.min(1, ridge * 2);
            total += ridge * amplitude;
            if (i < octaves) norm += amplitude;
            amplitude *= 0.5;
            frequency *= RIDGE_LACUNARITY;
        }
        return Math.min(1, total / norm);
    }
}

const RIDGE_OFFSET_X = 31.7;
const RIDGE_OFFSET_Y = 17.3;
const RIDGE_LACUNARITY = 2.1;

/**
 * A smooth per-pixel value (noise with no fine detail layers) worked out on a grid of points
 * `step` pixels apart and interpolated in between, each grid point only when first needed.
 *
 * Noise is the bulk of a feature's cost on a large map. A value whose finest layer is several
 * pixels across changes too little between neighbouring pixels to need reading at each of them,
 * so a grid a quarter of that finest wavelength apart reproduces it closely at a small fraction
 * of the cost. Noise with detail layers (finer the more pixels the map has) must still be read
 * per pixel.
 */
export class CoarseField {
    /**
     * @param {{minX: number, maxX: number, minY: number, maxY: number}} bounds - Where it is needed.
     * @param {number} step - Grid spacing in map pixels (1 reads every pixel).
     * @param {function(number, number): number} fn - The value at map position (x, y).
     */
    constructor(bounds, step, fn) {
        this.minX = bounds.minX;
        this.minY = bounds.minY;
        this.step = Math.max(1, step);
        this.columns = Math.ceil((bounds.maxX - bounds.minX) / this.step) + 2;
        this.rows = Math.ceil((bounds.maxY - bounds.minY) / this.step) + 2;
        this.values = new Float32Array(this.columns * this.rows).fill(Number.NaN);
        this.fn = fn;
    }

    /**
     * The grid spacing (in map pixels) for noise whose finest layer has the given wavelength in
     * baseline pixels: a quarter of that wavelength, and never below one pixel.
     */
    static stepFor(finestWavelength, noise) {
        return Math.max(1, Math.floor(finestWavelength / COARSE_SAMPLES_PER_WAVELENGTH / noise.perPixel));
    }

    at(x, y) {
        if (this.step === 1) return this.fn(x, y);
        const gx = (x - this.minX) / this.step;
        const gy = (y - this.minY) / this.step;
        const column = Math.floor(gx);
        const row = Math.floor(gy);
        const fx = gx - column;
        const fy = gy - row;
        const i00 = row * this.columns + column;
        const i01 = i00 + this.columns;
        const top = this.node(i00, column, row) * (1 - fx) + this.node(i00 + 1, column + 1, row) * fx;
        const bottom = this.node(i01, column, row + 1) * (1 - fx) + this.node(i01 + 1, column + 1, row + 1) * fx;
        return top * (1 - fy) + bottom * fy;
    }

    /** The value at grid point (column, row), whose index is `index`, worked out on first use. */
    node(index, column, row) {
        const value = this.values[index];
        if (value === value) return value; // not NaN
        const computed = this.fn(this.minX + column * this.step, this.minY + row * this.step);
        this.values[index] = computed;
        return computed;
    }
}

const COARSE_SAMPLES_PER_WAVELENGTH = 4;

/**
 * Fractal noise over a box (FeatureNoise.fbm with detail layers), with its coarse layers worked
 * out on a grid and only its detail layers read at every pixel.
 *
 * The layers are summed before the result is eased, so the sum splits exactly into the coarse
 * layers (smooth, interpolated from a grid a quarter of their finest wavelength apart) and the
 * detail layers (read per pixel, since they are finer the more pixels the map has). On a map with
 * no detail layers every layer is coarse; on a 4000 pixel map most of the cost moves onto the grid.
 */
export class DetailedField {
    /**
     * @param {FeatureNoise} noise - The feature noise.
     * @param {{minX: number, maxX: number, minY: number, maxY: number}} bounds - Where it is needed.
     * @param {number} wavelength - The coarsest layer's wavelength in baseline pixels.
     * @param {number} octaves - The number of coarse layers (detail layers are added on top).
     * @param {number} offsetX - Offsets the noise, in wavelengths, so fields differ.
     * @param {number} offsetY - As offsetX.
     */
    constructor(noise, bounds, wavelength, octaves, offsetX = 0, offsetY = 0) {
        this.noise = noise;
        this.wavelength = wavelength;
        this.octaves = octaves;
        this.offsetX = offsetX;
        this.offsetY = offsetY;
        let norm = 0;
        for (let i = 0, amplitude = 1; i < octaves; i++, amplitude *= 0.5) norm += amplitude;
        this.norm = norm;
        // The first detail layer continues the coarse layers' halving amplitude and doubling frequency
        this.detailAmplitude = 0.5 ** octaves;
        this.detailFrequency = 2 ** octaves;
        const finest = wavelength / 2 ** (octaves - 1);
        this.coarse = new CoarseField(bounds, CoarseField.stepFor(finest, noise), (x, y) => this.#coarseLayers(x, y));
    }

    /** The noise at map pixel (x, y), from -1 to 1 (as FeatureNoise.fbm). */
    at(x, y) {
        const noise = this.noise;
        let total = this.coarse.at(x, y);
        if (noise.detail > 0) {
            const px = noise.bx(x) / this.wavelength + this.offsetX;
            const py = noise.by(y) / this.wavelength + this.offsetY;
            let amplitude = this.detailAmplitude;
            let frequency = this.detailFrequency;
            for (let i = 0; i < noise.detail; i++) {
                total += noise.simplex.noise2D(px * frequency, py * frequency) * amplitude;
                amplitude *= 0.5;
                frequency *= 2;
            }
        }
        return Math.tanh(total / this.norm);
    }

    /** The sum of the coarse layers at map position (x, y). */
    #coarseLayers(x, y) {
        const px = this.noise.bx(x) / this.wavelength + this.offsetX;
        const py = this.noise.by(y) / this.wavelength + this.offsetY;
        let total = 0;
        let amplitude = 1;
        let frequency = 1;
        for (let i = 0; i < this.octaves; i++) {
            total += this.noise.simplex.noise2D(px * frequency, py * frequency) * amplitude;
            amplitude *= 0.5;
            frequency *= 2;
        }
        return total;
    }
}
