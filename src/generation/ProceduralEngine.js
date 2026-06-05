import { SimplexNoise } from "../../vendor/simplex-noise.js";

export class ProceduralEngine {
    constructor(seed = null) {
        let seedNum = ProceduralEngine.#hashString("FILRODEN");

        // Only override the fallback if a valid string or number is provided
        if (typeof seed === "string" && seed.trim() !== "") {
            seedNum = ProceduralEngine.#hashString(seed);
        } else if (typeof seed === "number") {
            seedNum = seed;
        }

        const prng = ProceduralEngine.#mulberry32(seedNum);
        this.simplex = new SimplexNoise(prng);
    }

    static BIOME_DICTIONARY = [
        null, // 0 = Procedural
        "DEEP_OCEAN",
        "SHALLOW_OCEAN",
        "SNOW",
        "TUNDRA",
        "TAIGA",
        "GRASSLAND",
        "DECIDUOUS_FOREST",
        "TEMPERATE_RAINFOREST",
        "TEMPERATE_DESERT",
        "TROPICAL_RAINFOREST",
        "SAVANNA",
        "SUBTROPICAL_DESERT",
        "PACK_ICE",
    ];

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

    /**
     * Calculates pure geographical altitude.
     */
    generateTopography(width, height, params) {
        const totalPixels = width * height;
        const elevationData = new Float32Array(totalPixels);

        const eScale = params.noise.elevation.scale;
        const eOctaves = params.noise.elevation.octaves;
        const eStretch = params.noise.elevation.stretch || 1;
        const panX = params.noise.offsetX || 0;
        const panY = params.noise.offsetY || 0;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const worldX = x + panX;
                const worldY = y + panY;
                let elevation = this.#fbm(worldX, worldY, eOctaves, eScale);
                elevationData[y * width + x] = Math.pow(Math.max(0, elevation), eStretch);
            }
        }
        return elevationData;
    }

    /**
     * Calculates moisture and temperature based on the final topography.
     */
    generateClimateData(elevationData, width, height, params) {
        const totalPixels = width * height;
        const moistureData = new Float32Array(totalPixels);
        const temperatureData = new Float32Array(totalPixels);

        const panX = params.noise.offsetX || 0;
        const panY = params.noise.offsetY || 0;

        const mScale = params.noise.moisture.scale;
        const mOctaves = params.noise.moisture.octaves;
        const globalMoisture = params.globalMoisture || 0.5;

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

                // MOISTURE
                const moistureNoise = this.#fbm(worldX + moistureOffset, worldY + moistureOffset, mOctaves, mScale);
                // Shift moisture based on the global slider
                moistureData[index] = Math.max(0, Math.min(1, moistureNoise + (globalMoisture - 0.5)));

                // TEMPERATURE
                const tempNoise = this.#fbm(worldX + tempOffset, worldY + tempOffset, tOctaves, tScale);

                // Shift the mathematical weight to 75% Latitude and 25% Noise
                let temperature = latGradient * 0.75 + tempNoise * 0.25;

                // (The rest remains exactly the same)
                temperature += globalTemp - 0.3;

                const elevation = elevationData[index];
                if (elevation > params.seaLevel) {
                    const altitude = (elevation - params.seaLevel) / (1 - params.seaLevel);
                    temperature -= altitude * 0.4;
                }

                temperatureData[index] = Math.max(0, Math.min(1, temperature));
            }
        }
        return { moistureData, temperatureData };
    }

    colorize(elevationData, width, height, seaLevel) {
        const totalPixels = width * height;
        const pixelBuffer = new Uint8Array(totalPixels * 4);

        for (let i = 0; i < totalPixels; i++) {
            const elevation = elevationData[i];
            const bufferIndex = i * 4;

            if (elevation < seaLevel) {
                const depth = seaLevel > 0 ? (seaLevel - elevation) / seaLevel : 0;
                pixelBuffer[bufferIndex] = Math.max(20, 100 - 80 * depth);
                pixelBuffer[bufferIndex + 1] = Math.max(30, 150 - 120 * depth);
                pixelBuffer[bufferIndex + 2] = Math.max(80, 200 - 120 * depth);
            } else {
                const heightParam = seaLevel < 1 ? (elevation - seaLevel) / (1 - seaLevel) : 1;
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

    /**
     * VISUAL PASS: Converts mathematical elevation into a pure, flat, binary land/sea map.
     */
    createBaseMap(elevationData, width, height, seaLevel) {
        const totalPixels = width * height;
        const pixelBuffer = new Uint8Array(totalPixels * 4);

        for (let i = 0; i < totalPixels; i++) {
            const isLand = elevationData[i] >= seaLevel;
            const bufferIndex = i * 4;

            if (isLand) {
                // Land (Solid Tan)
                pixelBuffer[bufferIndex] = 212;
                pixelBuffer[bufferIndex + 1] = 184;
                pixelBuffer[bufferIndex + 2] = 114;
            } else {
                // Ocean (Solid Blue)
                pixelBuffer[bufferIndex] = 26;
                pixelBuffer[bufferIndex + 1] = 75;
                pixelBuffer[bufferIndex + 2] = 132;
            }

            pixelBuffer[bufferIndex + 3] = 255; // Alpha
        }

        return pixelBuffer;
    }

    /**
     * SINGLE SOURCE OF TRUTH: Evaluates elevation and climate to determine the precise Biome key.
     */
    static getBiomeKey(elevation, moisture, temp, seaLevel) {
        if (elevation < seaLevel) {
            if (temp < 0.3) return "PACK_ICE";

            const depth = seaLevel > 0 ? (seaLevel - elevation) / seaLevel : 0;
            return depth > 0.5 ? "DEEP_OCEAN" : "SHALLOW_OCEAN";
        }

        // Rebalanced thresholds to vastly expand the Temperate band and Grassland occurrence
        if (temp < 0.2) {
            return moisture > 0.5 ? "SNOW" : "TUNDRA";
        } else if (temp < 0.4) {
            if (moisture < 0.3) return "TUNDRA";
            if (moisture < 0.6) return "TAIGA";
            return "SNOW";
        } else if (temp < 0.8) {
            // Expanded Temperate band from 40% to 80%
            if (moisture < 0.25) return "TEMPERATE_DESERT";
            if (moisture < 0.6) return "GRASSLAND"; // Expanded Grassland moisture threshold
            if (moisture < 0.85) return "DECIDUOUS_FOREST";
            return "TEMPERATE_RAINFOREST";
        } else {
            if (moisture < 0.2) return "SUBTROPICAL_DESERT";
            if (moisture < 0.4) return "SAVANNA";
            if (moisture < 0.7) return "DECIDUOUS_FOREST";
            return "TROPICAL_RAINFOREST";
        }
    }

    /**
     * VISUAL PASS: Evaluates Temp and Moisture to paint a climate biome map.
     */
    createBiomesMap(elevationData, moistureData, temperatureData, biomeOverrideData, width, height, seaLevel) {
        const totalPixels = width * height;
        const pixelBuffer = new Uint8Array(totalPixels * 4);
        const { BIOMES } = globalThis.game.filrodenswmb.config;

        for (let i = 0; i < totalPixels; i++) {
            const bufferIndex = i * 4;
            const elevation = elevationData[i];

            // 1. Check for a manual brush override
            const overrideId = biomeOverrideData ? biomeOverrideData[i] : 0;
            let biomeKey;

            if (overrideId > 0) {
                biomeKey = ProceduralEngine.BIOME_DICTIONARY[overrideId];
            } else {
                // 2. Fall back to procedural math if untouched
                const temp = temperatureData[i];
                const moisture = moistureData[i];
                biomeKey = ProceduralEngine.getBiomeKey(elevation, moisture, temp, seaLevel);
            }

            // Render Transparent Oceans
            if (biomeKey === "DEEP_OCEAN" || biomeKey === "SHALLOW_OCEAN") {
                pixelBuffer[bufferIndex] = 0;
                pixelBuffer[bufferIndex + 1] = 0;
                pixelBuffer[bufferIndex + 2] = 0;
                pixelBuffer[bufferIndex + 3] = 0;
                continue;
            }

            // Render Solid Land/Ice
            const color = BIOMES[biomeKey] || BIOMES.GRASSLAND;
            pixelBuffer[bufferIndex] = color[0];
            pixelBuffer[bufferIndex + 1] = color[1];
            pixelBuffer[bufferIndex + 2] = color[2];
            pixelBuffer[bufferIndex + 3] = 255;
        }

        return pixelBuffer;
    }
}
