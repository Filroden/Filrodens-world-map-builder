/**
 * A compact, self-contained 2D Perlin Noise implementation.
 */
const PERMUTATION = [
    151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194, 233, 7, 225, 140, 36, 103, 30, 69, 142, 8, 99, 37, 240, 21, 10, 23, 190, 6, 148, 247, 120, 234, 75, 0, 26, 197, 62, 94, 252, 219, 203,
    117, 35, 11, 32, 57, 177, 33, 88, 237, 149, 56, 87, 174, 20, 125, 136, 171, 168, 68, 175, 74, 165, 71, 134, 139, 48, 27, 166, 77, 146, 158, 231, 83, 111, 229, 122, 60, 211, 133, 230, 220, 105, 92,
    41, 55, 46, 245, 40, 244, 102, 143, 54, 65, 25, 63, 161, 1, 216, 80, 73, 209, 76, 132, 187, 208, 89, 18, 169, 200, 196, 135, 130, 116, 188, 159, 86, 164, 100, 109, 198, 173, 186, 3, 64, 52, 217,
    226, 250, 124, 123, 5, 202, 38, 147, 118, 126, 255, 82, 85, 212, 207, 206, 59, 227, 47, 16, 58, 17, 182, 189, 28, 42, 223, 183, 170, 213, 119, 248, 152, 2, 44, 154, 163, 70, 221, 153, 101, 155,
    167, 43, 172, 9, 129, 22, 39, 253, 19, 98, 108, 110, 79, 113, 224, 232, 178, 185, 112, 104, 218, 246, 97, 228, 251, 34, 242, 193, 238, 210, 144, 12, 191, 179, 162, 241, 81, 51, 145, 235, 249, 14,
    239, 107, 49, 192, 214, 31, 181, 199, 106, 157, 184, 84, 204, 176, 115, 121, 50, 45, 127, 4, 150, 254, 138, 236, 205, 93, 222, 114, 67, 29, 24, 72, 243, 141, 128, 195, 78, 66, 215, 61, 156, 180,
];
const p = new Array(512);
for (let i = 0; i < 256; i++) p[i] = p[i + 256] = PERMUTATION[i];

function fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
}
function lerp(t, a, b) {
    return a + t * (b - a);
}
function grad(hash, x, y) {
    const h = hash & 15;
    const u = h < 8 ? x : y;

    let v;
    if (h < 4) {
        v = y;
    } else if (h === 12 || h === 14) {
        v = x;
    } else {
        v = 0;
    }

    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

function perlin2D(x, y) {
    let X = Math.floor(x) & 255;
    let Y = Math.floor(y) & 255;
    x -= Math.floor(x);
    y -= Math.floor(y);
    let u = fade(x);
    let v = fade(y);
    let A = p[X] + Y,
        B = p[X + 1] + Y;
    return lerp(v, lerp(u, grad(p[A], x, y), grad(p[B], x - 1, y)), lerp(u, grad(p[A + 1], x, y - 1), grad(p[B + 1], x - 1, y - 1)));
}

/**
 * Executes Fractal Brownian Motion (fBm) to generate normalized [0.0 - 1.0] noise floats.
 * Extracted config parameter allows reuse for Elevation, Moisture, and Temperature.
 */
export function calculateNoise(col, row, config, offsetX = 0, offsetY = 0) {
    let x = (col + offsetX) * config.SCALE;
    let y = (row * 0.866 + offsetY) * config.SCALE;

    let amplitude = 1;
    let frequency = 1;
    let noiseValue = 0;
    let maxAmplitude = 0;

    for (let i = 0; i < config.OCTAVES; i++) {
        const rawNoise = (perlin2D(x * frequency, y * frequency) + 1) / 2;

        noiseValue += rawNoise * amplitude;
        maxAmplitude += amplitude;

        amplitude *= config.PERSISTENCE;
        frequency *= config.LACUNARITY;
    }

    // 1. Initial mathematical normalization (squashed bell curve)
    let normalized = noiseValue / maxAmplitude;

    // 2. Apply the configuration stretch, anchored at the median (0.5)
    const stretchFactor = config.STRETCH || 1;
    let stretched = (normalized - 0.5) * stretchFactor + 0.5;

    // 3. Flatten the extremes safely back within strict 0 - 1 bounds
    stretched = Math.min(Math.max(stretched, 0), 1);

    return Math.pow(stretched, config.EXPONENT);
}
