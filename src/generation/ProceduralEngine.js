import { SimplexNoise } from "../../vendor/simplex-noise.js";

export class ProceduralEngine {
    constructor(seed = null) {
        let seedNum = ProceduralEngine.#hashString("FILRODEN");

        if (typeof seed === "string" && seed.trim() !== "") {
            seedNum = ProceduralEngine.#hashString(seed);
        } else if (typeof seed === "number") {
            seedNum = seed;
        }

        // Store the PRNG on the instance so we can calculate deterministic rivers later
        this.prng = ProceduralEngine.#mulberry32(seedNum);
        this.simplex = new SimplexNoise(this.prng);
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

    // Cardinal and ordinal directions for pathfinding to prevent array reallocation in tight loops
    static ADJACENT_OFFSETS = [
        { dx: 0, dy: -1 },
        { dx: 1, dy: -1 },
        { dx: 1, dy: 0 },
        { dx: 1, dy: 1 },
        { dx: 0, dy: 1 },
        { dx: -1, dy: 1 },
        { dx: -1, dy: 0 },
        { dx: -1, dy: -1 },
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
     * Samples the map to find high-altitude, high-moisture starting points.
     */
    #findSprings(elevationData, moistureData, width, height, seaLevel, targetCount) {
        const springs = [];
        const maxAttempts = targetCount * 50; // Prevent infinite loops on dry/flat maps
        let attempts = 0;

        while (springs.length < targetCount && attempts < maxAttempts) {
            attempts++;

            // Deterministically pick a coordinate
            const x = Math.floor(this.prng() * width);
            const y = Math.floor(this.prng() * height);

            const index = y * width + x;
            const elevation = elevationData[index];
            const moisture = moistureData[index];

            // A valid spring requires high altitude and heavy moisture
            if (elevation > seaLevel + 0.25 && moisture > 0.45) {
                springs.push({ x, y });
            }
        }
        return springs;
    }

    /**
     * Scans the 8 surrounding pixels to locate the steepest downward slope.
     */
    #getLowestNeighbor(cx, cy, elevationData, width, height, visitedLocal) {
        let minElev = Infinity;
        let bestTarget = null;

        // Break the cardinal loop bias by starting at a random offset
        const startIdx = Math.floor(this.prng() * 8);

        for (let i = 0; i < 8; i++) {
            // Wrap around the array using modulo
            const dir = ProceduralEngine.ADJACENT_OFFSETS[(startIdx + i) % 8];
            const nx = cx + dir.dx;
            const ny = cy + dir.dy;

            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            if (visitedLocal.has(`${nx},${ny}`)) continue;

            const actualElev = elevationData[ny * width + nx];

            // Slightly stronger jitter to induce organic meandering on uniform slopes
            const jitter = this.prng() * 0.005;
            const perceivedElev = actualElev + jitter;

            if (perceivedElev < minElev) {
                minElev = perceivedElev;
                bestTarget = { x: nx, y: ny, elevation: actualElev };
            }
        }
        return bestTarget;
    }

    /**
     * Simulates water pooling in a local minimum until it overflows the basin.
     */
    #fillBasin(startX, startY, elevationData, width, height, riverMap, visitedLocal) {
        const visited = new Set();
        visited.add(`${startX},${startY}`);

        const boundary = [{ x: startX, y: startY, elev: elevationData[startY * width + startX] }];
        const lakePixels = [];
        let spillover = null;

        // Track the final resting elevation of the water's surface
        let surfaceElev = boundary[0].elev;

        const MAX_LAKE_SIZE = 8000;

        while (boundary.length > 0 && lakePixels.length < MAX_LAKE_SIZE) {
            boundary.sort((a, b) => a.elev - b.elev);
            const current = boundary.shift();

            lakePixels.push({ x: current.x, y: current.y, isLake: true });
            riverMap[current.y * width + current.x] = true;

            // As the basin fills, the surface rises
            surfaceElev = Math.max(surfaceElev, current.elev);

            for (const dir of ProceduralEngine.ADJACENT_OFFSETS) {
                const nx = current.x + dir.dx;
                const ny = current.y + dir.dy;

                if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

                const key = `${nx},${ny}`;
                if (visited.has(key)) continue;
                visited.add(key);

                const nElev = elevationData[ny * width + nx];

                if (nElev < current.elev) {
                    if (visitedLocal.has(`${nx},${ny}`)) continue;

                    spillover = { x: nx, y: ny, elevation: nElev };
                    surfaceElev = current.elev; // The water is exactly level with the lip
                    break;
                }

                boundary.push({ x: nx, y: ny, elev: nElev });
            }

            if (spillover) break;
        }

        return { spillover, lakePixels, surfaceElev }; // Include surfaceElev in return
    }

    /**
     * Executes the Greedy Downhill algorithm to plot a vector path to the ocean.
     */
    #traceRiver(startX, startY, elevationData, temperatureData, width, height, seaLevel, riverMap, waterMask) {
        const path = [];
        const visitedLocal = new Set();

        let cx = startX;
        let cy = startY;
        let currentElev = elevationData[cy * width + cx];

        const maxLength = width * 1.5;

        while (path.length < maxLength) {
            const temp = temperatureData[cy * width + cx];
            const isFrozen = temp < 0.2;

            visitedLocal.add(`${cx},${cy}`);

            path.push({ x: cx, y: cy, isFrozen: isFrozen });
            riverMap[cy * width + cx] = true;

            const lowestNeighbor = this.#getLowestNeighbor(cx, cy, elevationData, width, height, visitedLocal);

            if (!lowestNeighbor) break;

            if (lowestNeighbor.elevation <= seaLevel) {
                path.push({ x: lowestNeighbor.x, y: lowestNeighbor.y });
                break;
            }

            if (riverMap[lowestNeighbor.y * width + lowestNeighbor.x]) {
                path.push({ x: lowestNeighbor.x, y: lowestNeighbor.y, isMerge: true });
                break;
            }

            if (lowestNeighbor.elevation >= currentElev) {
                const basin = this.#fillBasin(cx, cy, elevationData, width, height, riverMap, visitedLocal);

                if (basin.lakePixels.length > 0) {
                    path.push({ x: cx, y: cy, isLake: true, isFrozen: isFrozen });

                    for (const lp of basin.lakePixels) {
                        visitedLocal.add(`${lp.x},${lp.y}`);
                        waterMask[lp.y * width + lp.x] = basin.surfaceElev;
                    }
                }

                if (basin.spillover) {
                    cx = basin.spillover.x;
                    cy = basin.spillover.y;
                    currentElev = basin.spillover.elevation;
                    continue;
                } else {
                    break;
                }
            }

            cx = lowestNeighbor.x;
            cy = lowestNeighbor.y;
            currentElev = lowestNeighbor.elevation;
        }

        return path.length > 5 ? path : null;
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
        const seasonOffset = params.seasonOffset || 0;

        const latTop = params.latTop;
        const latBottom = params.latBottom;
        const latRange = Math.abs(latTop - latBottom);

        const moistureOffset = 10000;
        const tempOffset = 20000;

        for (let y = 0; y < height; y++) {
            const currentLat = latTop - (y / height) * latRange;
            const latGradient = 1 - Math.abs(currentLat) / 90;
            const seasonImpact = (currentLat / 90) * seasonOffset * 0.35;

            for (let x = 0; x < width; x++) {
                const index = y * width + x;
                const worldX = x + panX;
                const worldY = y + panY;

                // MOISTURE
                const moistureNoise = this.#fbm(worldX + moistureOffset, worldY + moistureOffset, mOctaves, mScale);
                moistureData[index] = Math.max(0, Math.min(1, moistureNoise + (globalMoisture - 0.5)));

                // TEMPERATURE
                const tempNoise = this.#fbm(worldX + tempOffset, worldY + tempOffset, tOctaves, tScale);

                let temperature = latGradient * 0.75 + tempNoise * 0.25;
                temperature += globalTemp - 0.3;
                temperature += seasonImpact;

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

    colorize(elevationData, temperatureData, width, height, seaLevel, waterMask) {
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
            } else if (waterMask && waterMask[i] > 0) {
                const surfaceElev = waterMask[i];
                const depth = surfaceElev > 0 ? (surfaceElev - elevation) / surfaceElev : 0;
                const temp = temperatureData ? temperatureData[i] : 1;

                if (temp < 0.2) {
                    pixelBuffer[bufferIndex] = Math.max(200, 255 - 50 * depth);
                    pixelBuffer[bufferIndex + 1] = Math.max(220, 255 - 30 * depth);
                    pixelBuffer[bufferIndex + 2] = 255;
                } else {
                    pixelBuffer[bufferIndex] = Math.max(40, 120 - 80 * depth);
                    pixelBuffer[bufferIndex + 1] = Math.max(80, 170 - 120 * depth);
                    pixelBuffer[bufferIndex + 2] = Math.max(120, 210 - 120 * depth);
                }
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
    createBiomesMap(elevationData, moistureData, temperatureData, biomeOverrideData, width, height, seaLevel, waterMask) {
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
            if (biomeKey === "DEEP_OCEAN" || biomeKey === "SHALLOW_OCEAN" || (waterMask && waterMask[i] > 0)) {
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

    /**
     * Evaluates geography and climate to calculate procedural water features.
     * Returns an array of vector paths, not a pixel buffer.
     */
    generateRivers(elevationData, moistureData, temperatureData, width, height, params) {
        const riverDensity = params.riverDensity || 40;
        const seaLevel = params.seaLevel || 0.3;

        const rivers = [];
        const riverMap = new Uint8Array(width * height);
        const waterMask = new Float32Array(width * height);

        const springs = this.#findSprings(elevationData, moistureData, width, height, seaLevel, riverDensity);

        for (const spring of springs) {
            const index = spring.y * width + spring.x;
            if (riverMap[index]) continue;

            const path = this.#traceRiver(spring.x, spring.y, elevationData, temperatureData, width, height, seaLevel, riverMap, waterMask);

            if (path) rivers.push({ id: `river_${rivers.length}`, path: path });
        }

        return { vectors: rivers, waterMask: waterMask };
    }
}
