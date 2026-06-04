import { SimplexNoise } from "../../vendor/simplex-noise.js";

export class ProceduralEngine {
    constructor(seed = null) {
        // Default to non-deterministic native browser random
        let prng = Math.random;

        // Strictly evaluate the parameter type and assign the deterministic PRNG directly
        if (typeof seed === "string" && seed.trim() !== "") {
            prng = ProceduralEngine.#mulberry32(ProceduralEngine.#hashString(seed));
        } else if (typeof seed === "number") {
            prng = ProceduralEngine.#mulberry32(seed);
        }

        this.simplex = new SimplexNoise(prng);
    }

    /**
     * A highly performant, 32-bit Pseudo-Random Number Generator.
     */
    static #mulberry32(a) {
        return function () {
            let t = (a += 0x6d2b79f5);
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    /**
     * cyrb53: A highly efficient 53-bit string hashing algorithm.
     */
    static #hashString(str, seed = 0) {
        let h1 = 0xdeadbeef ^ seed,
            h2 = 0x41c6ce57 ^ seed;

        for (const char of str) {
            const ch = char.codePointAt(0);
            h1 = Math.imul(h1 ^ ch, 2654435761);
            h2 = Math.imul(h2 ^ ch, 1597334677);
        }

        h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
        h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
        return 4294967296 * (2097151 & h2) + (h1 >>> 0);
    }

    generateTerrainData(width, height, params) {
        const totalPixels = width * height;
        const elevationData = new Float32Array(totalPixels);
        const moistureData = new Float32Array(totalPixels);
        const temperatureData = new Float32Array(totalPixels);

        const eScale = params.noise.elevation.scale;
        const eOctaves = params.noise.elevation.octaves;
        const eStretch = params.noise.elevation.stretch || 1;

        const panX = params.noise.offsetX || 0;
        const panY = params.noise.offsetY || 0;

        const mScale = params.noise.moisture.scale;
        const mOctaves = params.noise.moisture.octaves;
        const tScale = params.noise.temperature.scale || 1 / 250;
        const tOctaves = params.noise.temperature.octaves || 3;

        const globalTemp = params.globalTemp;
        const latTop = params.latTop;
        const latBottom = params.latBottom;
        const latRange = Math.abs(latTop - latBottom);

        const moistureOffset = 10000;
        const tempOffset = 20000;

        for (let y = 0; y < height; y++) {
            const currentLat = latTop - (y / height) * latRange;
            const latGradient = 1 - Math.abs(currentLat) / 90;

            for (let x = 0; x < width; x++) {
                const index = y * width + x;

                const worldX = x + panX;
                const worldY = y + panY;

                // 1. ELEVATION
                let elevation = this.#fbm(worldX, worldY, eOctaves, eScale);
                elevation = Math.pow(elevation, eStretch);
                elevationData[index] = elevation;

                // 2. MOISTURE
                const moisture = this.#fbm(worldX + moistureOffset, worldY + moistureOffset, mOctaves, mScale);
                moistureData[index] = moisture;

                // 3. TEMPERATURE
                const tempNoise = this.#fbm(worldX + tempOffset, worldY + tempOffset, tOctaves, tScale);
                let temperature = latGradient * 0.5 + tempNoise * 0.5;
                temperature += globalTemp - 0.5;

                if (elevation > params.seaLevel) {
                    const altitude = (elevation - params.seaLevel) / (1 - params.seaLevel);
                    temperature -= altitude * 0.4;
                }

                temperatureData[index] = Math.max(0, Math.min(1, temperature));
            }
        }

        return { elevationData, moistureData, temperatureData };
    }

    colorize(elevationData, width, height, seaLevel) {
        const totalPixels = width * height;
        const pixelBuffer = new Uint8Array(totalPixels * 4);

        for (let i = 0; i < totalPixels; i++) {
            const elevation = elevationData[i];
            const bufferIndex = i * 4;

            if (elevation < seaLevel) {
                const depth = (seaLevel - elevation) / seaLevel;
                pixelBuffer[bufferIndex] = Math.max(20, 100 - 80 * depth);
                pixelBuffer[bufferIndex + 1] = Math.max(30, 150 - 120 * depth);
                pixelBuffer[bufferIndex + 2] = Math.max(80, 200 - 120 * depth);
            } else {
                const heightParam = (elevation - seaLevel) / (1 - seaLevel);
                const grayValue = Math.max(60, 200 - 140 * heightParam);

                pixelBuffer[bufferIndex] = grayValue;
                pixelBuffer[bufferIndex + 1] = grayValue;
                pixelBuffer[bufferIndex + 2] = grayValue;
            }

            pixelBuffer[bufferIndex + 3] = 255;
        }

        return pixelBuffer;
    }

    #fbm(x, y, octaves, scale) {
        let total = 0;
        let frequency = scale;
        let amplitude = 1;
        let maxValue = 0;

        for (let i = 0; i < octaves; i++) {
            const noiseVal = (this.simplex.noise2D(x * frequency, y * frequency) + 1) / 2;
            total += noiseVal * amplitude;

            maxValue += amplitude;
            amplitude *= 0.5;
            frequency *= 2;
        }

        return total / maxValue;
    }
}
