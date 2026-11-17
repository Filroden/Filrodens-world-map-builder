/**
 * Small numeric helpers shared by the tectonic features.
 */
export class FeatureMath {
    /** Hermite ease from 0 at `from` to 1 at `to` (either direction). */
    static smoothstep(from, to, value) {
        const t = Math.max(0, Math.min(1, (value - from) / (to - from)));
        return t * t * (3 - 2 * t);
    }

    static clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    /**
     * Smooth maximum: like Math.max, but rounds the crease where two surfaces meet over a band
     * `k` wide, so relief shading does not show a hard line where one volcano's flank meets
     * another's.
     */
    static smax(a, b, k) {
        const h = FeatureMath.clamp(0.5 + (0.5 * (a - b)) / k, 0, 1);
        return b + (a - b) * h + k * h * (1 - h);
    }

    /**
     * Fades a feature in over its first and out over its last `taper` pixels along a line, so
     * it ends gradually instead of in a cliff across the line.
     */
    static endTaper(along, length, taper) {
        return FeatureMath.smoothstep(0, taper, along) * FeatureMath.smoothstep(0, taper, length - along);
    }

    /** A Gaussian bump of height 1 centred on `centre`, `width` wide (its standard spread). */
    static bump(value, centre, width) {
        const t = (value - centre) / width;
        return Math.exp(-t * t);
    }

    /**
     * A width factor that narrows a feature along its line by up to `variation` of its width and
     * never widens it past the width set, from a noise value between -1 and 1.
     */
    static narrowing(noiseValue, variation) {
        return 1 - variation * (0.5 + 0.5 * noiseValue);
    }
}
