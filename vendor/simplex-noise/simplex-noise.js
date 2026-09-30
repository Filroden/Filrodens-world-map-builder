/**
 * A fast, standalone ES6 implementation of 2D Simplex Noise.
 */
const F2 = 0.5 * (Math.sqrt(3.0) - 1.0);
const G2 = (3.0 - Math.sqrt(3.0)) / 6.0;
const G2x2 = 2.0 * G2;

// The eight gradients #grad3 picks from (hash & 7), as (x, y) multipliers: bit 2 swaps which
// coordinate gets the factor 2, bit 0 negates the first term and bit 1 the second.
const GRAD = new Float64Array(16);
for (let h = 0; h < 8; h++) {
    const first = h & 1 ? -1 : 1;
    const second = h & 2 ? -2 : 2;
    GRAD[h * 2] = h < 4 ? first : second;
    GRAD[h * 2 + 1] = h < 4 ? second : first;
}

export class SimplexNoise {
    constructor(random = Math.random) {
        this.p = new Uint8Array(256);
        this.perm = new Uint8Array(512);
        this.permMod12 = new Uint8Array(512);
        for (let i = 0; i < 256; i++) {
            this.p[i] = Math.floor(random() * 256);
        }
        for (let i = 0; i < 512; i++) {
            this.perm[i] = this.p[i & 255];
            this.permMod12[i] = this.perm[i] % 12;
        }

        // Index into GRAD of the gradient each permuted hash picks: (perm % 12) & 7, doubled
        this.gradIndex = new Uint8Array(512);
        for (let i = 0; i < 512; i++) this.gradIndex[i] = (this.permMod12[i] & 7) << 1;
    }

    noise2D(xin, yin) {
        // Same arithmetic, in the same order, as the textbook version this replaced, so every
        // value is bit-for-bit what it was; only the per-call overheads are gone: the skew
        // constants are worked out once, and each corner's gradient is two multiplications by
        // ±1 or ±2 from a table rather than a method call with branches.
        const s = (xin + yin) * F2;
        const i = Math.floor(xin + s);
        const j = Math.floor(yin + s);
        const t = (i + j) * G2;
        const x0 = xin - (i - t);
        const y0 = yin - (j - t);

        const i1 = x0 > y0 ? 1 : 0;
        const j1 = 1 - i1;

        const x1 = x0 - i1 + G2;
        const y1 = y0 - j1 + G2;
        const x2 = x0 - 1.0 + G2x2;
        const y2 = y0 - 1.0 + G2x2;

        const perm = this.perm;
        const gradIndex = this.gradIndex;
        const ii = i & 255;
        const jj = j & 255;

        let n = 0;
        let t0 = 0.5 - x0 * x0 - y0 * y0;
        if (t0 >= 0) {
            const g = gradIndex[ii + perm[jj]];
            t0 *= t0;
            n = t0 * t0 * (GRAD[g] * x0 + GRAD[g + 1] * y0);
        }

        let n1 = 0;
        let t1 = 0.5 - x1 * x1 - y1 * y1;
        if (t1 >= 0) {
            const g = gradIndex[ii + i1 + perm[jj + j1]];
            t1 *= t1;
            n1 = t1 * t1 * (GRAD[g] * x1 + GRAD[g + 1] * y1);
        }

        let n2 = 0;
        let t2 = 0.5 - x2 * x2 - y2 * y2;
        if (t2 >= 0) {
            const g = gradIndex[ii + 1 + perm[jj + 1]];
            t2 *= t2;
            n2 = t2 * t2 * (GRAD[g] * x2 + GRAD[g + 1] * y2);
        }

        return 70.0 * (n + n1 + n2);
    }
}
