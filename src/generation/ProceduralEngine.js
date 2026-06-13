import { SimplexNoise } from "../../vendor/simplex-noise/simplex-noise.js";
import { FILRODENSWMB } from "../config.js";

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
    #findSprings(elevationData, moistureData, width, height, seaLevel, targetCount, params) {
        const springs = [];
        const maxAttempts = targetCount * 50;
        let attempts = 0;

        const altOffset = params?.hydrology?.springAltOffset ?? FILRODENSWMB.HYDROLOGY.SPRING_ALTITUDE_OFFSET;
        const moistMin = params?.hydrology?.springMoistMin ?? FILRODENSWMB.HYDROLOGY.SPRING_MOISTURE_MIN;

        while (springs.length < targetCount && attempts < maxAttempts) {
            attempts++;
            const x = Math.floor(this.prng() * width);
            const y = Math.floor(this.prng() * height);
            const index = y * width + x;

            if (elevationData[index] > seaLevel + altOffset && moistureData[index] > moistMin) {
                springs.push({ x, y });
            }
        }
        return springs;
    }

    /**
     * Scans the 8 surrounding pixels to locate the steepest downward slope.
     */
    #getLowestNeighbor(cx, cy, elevationData, width, height, visitedLocal, params) {
        let minElev = Infinity;
        let bestTarget = null;
        const startIdx = Math.floor(this.prng() * 8);
        const meanderJitter = params?.hydrology?.meanderJitter ?? FILRODENSWMB.HYDROLOGY.MEANDER_JITTER;

        for (let i = 0; i < 8; i++) {
            const dir = ProceduralEngine.ADJACENT_OFFSETS[(startIdx + i) % 8];
            const nx = cx + dir.dx;
            const ny = cy + dir.dy;

            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            if (visitedLocal.has(`${nx},${ny}`)) continue;

            const actualElev = elevationData[ny * width + nx];
            const perceivedElev = actualElev + this.prng() * meanderJitter;

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
    #fillBasin(startX, startY, elevationData, width, height, riverMap, visitedLocal, params) {
        const visited = new Set([`${startX},${startY}`]);
        const boundary = [{ x: startX, y: startY, elev: elevationData[startY * width + startX] }];
        const lakePixels = [];

        let surfaceElev = boundary[0].elev;
        const maxLakeSize = params?.hydrology?.maxLakeSize ?? FILRODENSWMB.HYDROLOGY.MAX_LAKE_SIZE;

        while (boundary.length > 0 && lakePixels.length < maxLakeSize) {
            boundary.sort((a, b) => a.elev - b.elev);
            const current = boundary.shift();

            lakePixels.push({ x: current.x, y: current.y, isLake: true });
            riverMap[current.y * width + current.x] = true;
            surfaceElev = Math.max(surfaceElev, current.elev);

            const spillover = this.#scanBasinNeighbors(current, elevationData, width, height, visited, visitedLocal, boundary);

            if (spillover) {
                return { spillover, lakePixels, surfaceElev: current.elev };
            }
        }

        return { spillover: null, lakePixels, surfaceElev };
    }

    #scanBasinNeighbors(current, elevationData, width, height, visited, visitedLocal, boundary) {
        for (const dir of ProceduralEngine.ADJACENT_OFFSETS) {
            const nx = current.x + dir.dx;
            const ny = current.y + dir.dy;

            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

            const key = `${nx},${ny}`;
            if (visited.has(key)) continue;
            visited.add(key);

            const nElev = elevationData[ny * width + nx];

            // If we found a pixel strictly lower than the one we are evaluating, it is the spillover lip.
            if (nElev < current.elev) {
                if (visitedLocal.has(`${nx},${ny}`)) continue;
                return { x: nx, y: ny, elevation: nElev };
            }

            boundary.push({ x: nx, y: ny, elev: nElev });
        }
        return null;
    }

    /**
     * Executes the Greedy Downhill algorithm to plot a vector path to the ocean.
     */
    #traceRiver(startX, startY, elevationData, temperatureData, width, height, seaLevel, riverMap, waterMask, params) {
        const path = [];
        const visitedLocal = new Set();
        const freezeLimit = params?.climate?.freezingThreshold ?? FILRODENSWMB.CLIMATE.FREEZING_THRESHOLD;

        let cx = startX;
        let cy = startY;
        let currentElev = elevationData[cy * width + cx];
        const maxLength = width * 1.5;

        while (path.length < maxLength) {
            const temp = temperatureData[cy * width + cx];
            const isFrozen = temp < freezeLimit;

            visitedLocal.add(`${cx},${cy}`);
            path.push({ x: cx, y: cy, isFrozen: isFrozen });
            riverMap[cy * width + cx] = true;

            const lowestNeighbor = this.#getLowestNeighbor(cx, cy, elevationData, width, height, visitedLocal, params);

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
                const basin = this.#fillBasin(cx, cy, elevationData, width, height, riverMap, visitedLocal, params);

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
     * Calculates pure geographical altitude, applying exponents strictly to landmasses.
     */
    generateTopography(width, height, params) {
        const totalPixels = width * height;
        const elevationData = new Float32Array(totalPixels);

        const eScale = params.noise.elevation.scale;
        const eOctaves = params.noise.elevation.octaves;
        const eStretch = params.noise.elevation.stretch || 1;
        const panX = params.noise.offsetX || 0;
        const panY = params.noise.offsetY || 0;

        // THE FIX: Pull seaLevel to use as the mathematical pivot point
        const seaLevel = params.seaLevel || 0.35;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const worldX = x + panX;
                const worldY = y + panY;
                let elevation = this.#fbm(worldX, worldY, eOctaves, eScale);

                if (elevation > seaLevel) {
                    // 1. Isolate just the land and normalise it to a 0.0 - 1.0 scale
                    const landHeight = (elevation - seaLevel) / (1 - seaLevel);

                    // 2. Apply the exponent stretch (creates flat plains and sharp peaks)
                    const stretchedLand = Math.pow(landHeight, eStretch);

                    // 3. Map the stretched land back into the real geographical altitude range
                    elevationData[y * width + x] = seaLevel + stretchedLand * (1 - seaLevel);
                } else {
                    // Leave the ocean floor entirely unaffected by the land stretch
                    elevationData[y * width + x] = Math.max(0, elevation);
                }
            }
        }
        return elevationData;
    }

    /**
     * Calculates moisture and temperature based on the final topography.
     * Applies globally deterministic Orographic Lift via Western Horizon sampling.
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

        // Fetch elevation parameters to calculate geographical slope
        const eScale = params.noise.elevation.scale;
        const eOctaves = params.noise.elevation.octaves;
        const eStretch = params.noise.elevation.stretch || 1;

        for (let y = 0; y < height; y++) {
            const currentLat = latTop - (y / height) * latRange;
            const latGradient = 1 - Math.abs(currentLat) / 90;
            const seasonImpact = (currentLat / 90) * seasonOffset * 0.35;

            for (let x = 0; x < width; x++) {
                const index = y * width + x;
                const worldX = x + panX;
                const worldY = y + panY;

                // --- MOISTURE ---
                const moistureNoise = this.#fbm(worldX + moistureOffset, worldY + moistureOffset, mOctaves, mScale);
                let baseMoisture = moistureNoise + (globalMoisture - 0.5);

                const elevation = elevationData[index];
                const isLand = elevation > params.seaLevel;

                if (isLand) {
                    // GLOBALLY DETERMINISTIC OROGRAPHIC LIFT (SMOOTH CORIOLIS)
                    // A continuous wave simulating the Hadley, Ferrel, and Polar circulation cells.
                    // This smoothly transitions from 1 (Easterlies) to -1 (Westerlies) to 1 (Polar Easterlies).
                    // The 0-crossings naturally simulate the windless Horse Latitudes and Doldrums.
                    const absLat = Math.abs(currentLat);
                    const windCellBlend = Math.cos(absLat * (Math.PI / 45));

                    // The sampling distance now smoothly scales, rather than instantly snapping
                    const windDirectionX = 40 * windCellBlend;

                    // 1. Calculate the raw noise upwind
                    const upwindNoise = this.#fbm(worldX + windDirectionX, worldY, eOctaves, eScale);

                    // 2. Apply the exact same stretch math the topography uses
                    let upwindElev = Math.max(0, upwindNoise);
                    if (upwindNoise > params.seaLevel) {
                        const landHeight = (upwindNoise - params.seaLevel) / (1 - params.seaLevel);
                        upwindElev = params.seaLevel + Math.pow(landHeight, eStretch) * (1 - params.seaLevel);
                    }

                    // 3. Calculate true geographical slope and apply to moisture
                    // Upward slope = Rain dump. Downward slope = Rain shadow desert.
                    // Because windDirectionX shrinks to 0 at the cell boundaries, the slope
                    // inherently approaches 0, creating a perfectly smooth transition!
                    const slope = elevation - upwindElev;
                    baseMoisture += slope * 3;
                }

                moistureData[index] = Math.max(0, Math.min(1, baseMoisture));

                // --- TEMPERATURE ---
                const tempNoise = this.#fbm(worldX + tempOffset, worldY + tempOffset, tOctaves, tScale);

                let temperature = latGradient * 0.75 + tempNoise * 0.25;
                temperature += globalTemp - 0.3;
                temperature += seasonImpact;

                if (isLand) {
                    const altitude = (elevation - params.seaLevel) / (1 - params.seaLevel);
                    const altCooling = params.climate?.altCooling ?? FILRODENSWMB.CLIMATE.ALTITUDE_COOLING;
                    temperature -= altitude * altCooling;
                }

                temperatureData[index] = Math.max(0, Math.min(1, temperature));
            }
        }
        return { moistureData, temperatureData };
    }

    colorize(elevationData, temperatureData, width, height, seaLevel, waterMask, params) {
        const totalPixels = width * height;
        const pixelBuffer = new Uint8Array(totalPixels * 4);

        for (let i = 0; i < totalPixels; i++) {
            const elevation = elevationData[i];
            const bufferIndex = i * 4;

            if (elevation < seaLevel) {
                this.#paintOceanPixel(pixelBuffer, bufferIndex, elevation, seaLevel);
            } else if (waterMask && waterMask[i] > 0) {
                const temp = temperatureData ? temperatureData[i] : 1;
                this.#paintLakePixel(pixelBuffer, bufferIndex, elevation, waterMask[i], temp, params);
            } else {
                this.#paintLandPixel(pixelBuffer, bufferIndex, elevation, seaLevel);
            }
        }
        return pixelBuffer;
    }

    #paintOceanPixel(pixelBuffer, bufferIndex, elevation, seaLevel) {
        const depth = seaLevel > 0 ? (seaLevel - elevation) / seaLevel : 0;
        pixelBuffer[bufferIndex] = Math.max(20, 100 - 80 * depth);
        pixelBuffer[bufferIndex + 1] = Math.max(30, 150 - 120 * depth);
        pixelBuffer[bufferIndex + 2] = Math.max(80, 200 - 120 * depth);
        pixelBuffer[bufferIndex + 3] = 255;
    }

    #paintLakePixel(pixelBuffer, bufferIndex, elevation, surfaceElev, temp, params) {
        const depth = surfaceElev > 0 ? (surfaceElev - elevation) / surfaceElev : 0;
        const freezeLimit = params?.climate?.freezingThreshold ?? FILRODENSWMB.CLIMATE.FREEZING_THRESHOLD;

        if (temp < freezeLimit) {
            pixelBuffer[bufferIndex] = Math.max(200, 255 - 50 * depth);
            pixelBuffer[bufferIndex + 1] = Math.max(220, 255 - 30 * depth);
            pixelBuffer[bufferIndex + 2] = 255;
        } else {
            pixelBuffer[bufferIndex] = Math.max(40, 120 - 80 * depth);
            pixelBuffer[bufferIndex + 1] = Math.max(80, 170 - 120 * depth);
            pixelBuffer[bufferIndex + 2] = Math.max(120, 210 - 120 * depth);
        }
        pixelBuffer[bufferIndex + 3] = 255;
    }

    #paintLandPixel(pixelBuffer, bufferIndex, elevation, seaLevel) {
        const heightParam = seaLevel < 1 ? (elevation - seaLevel) / (1 - seaLevel) : 1;
        const grayValue = Math.max(60, 200 - 140 * heightParam);

        pixelBuffer[bufferIndex] = grayValue;
        pixelBuffer[bufferIndex + 1] = grayValue;
        pixelBuffer[bufferIndex + 2] = grayValue;
        pixelBuffer[bufferIndex + 3] = 255;
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
        const tempLimits = FILRODENSWMB.CLIMATE.THRESHOLDS.TEMPERATURE;

        if (elevation < seaLevel) return ProceduralEngine.#getOceanBiome(elevation, temp, seaLevel);
        if (temp < tempLimits.ARCTIC) return ProceduralEngine.#getArcticBiome(moisture);
        if (temp < tempLimits.SUBARCTIC) return ProceduralEngine.#getSubArcticBiome(moisture);
        if (temp < tempLimits.TEMPERATE) return ProceduralEngine.#getTemperateBiome(moisture);

        return ProceduralEngine.#getTropicalBiome(moisture);
    }

    static #getOceanBiome(elevation, temp, seaLevel) {
        if (temp < FILRODENSWMB.CLIMATE.FREEZING_THRESHOLD) return "PACK_ICE";
        const depth = seaLevel > 0 ? (seaLevel - elevation) / seaLevel : 0;
        return depth > 0.5 ? "DEEP_OCEAN" : "SHALLOW_OCEAN";
    }

    static #getArcticBiome(moisture) {
        const limit = FILRODENSWMB.CLIMATE.THRESHOLDS.MOISTURE.ARCTIC;
        return moisture > limit.SNOW ? "SNOW" : "TUNDRA";
    }

    static #getSubArcticBiome(moisture) {
        const limit = FILRODENSWMB.CLIMATE.THRESHOLDS.MOISTURE.SUBARCTIC;
        if (moisture < limit.TUNDRA) return "TUNDRA";
        if (moisture < limit.TAIGA) return "TAIGA";
        return "SNOW";
    }

    static #getTemperateBiome(moisture) {
        const limit = FILRODENSWMB.CLIMATE.THRESHOLDS.MOISTURE.TEMPERATE;
        if (moisture < limit.DESERT) return "TEMPERATE_DESERT";
        if (moisture < limit.GRASSLAND) return "GRASSLAND";
        if (moisture < limit.DECIDUOUS) return "DECIDUOUS_FOREST";
        return "TEMPERATE_RAINFOREST";
    }

    static #getTropicalBiome(moisture) {
        const limit = FILRODENSWMB.CLIMATE.THRESHOLDS.MOISTURE.TROPICAL;
        if (moisture < limit.DESERT) return "SUBTROPICAL_DESERT";
        if (moisture < limit.SAVANNA) return "SAVANNA";
        if (moisture < limit.DECIDUOUS) return "DECIDUOUS_FOREST";
        return "TROPICAL_RAINFOREST";
    }

    /**
     * VISUAL PASS: Evaluates Temp and Moisture to paint a climate biome map.
     */
    createBiomesMap(elevationData, moistureData, temperatureData, biomeOverrideData, width, height, seaLevel, waterMask, params) {
        const totalPixels = width * height;
        const pixelBuffer = new Uint8Array(totalPixels * 4);
        const BIOMES = FILRODENSWMB.BIOMES;

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

            // Render Solid Land/Ice using custom UI overrides if they exist
            const color = params?.customColors?.[biomeKey] || BIOMES[biomeKey] || BIOMES.GRASSLAND;
            pixelBuffer[bufferIndex] = color[0];
            pixelBuffer[bufferIndex + 1] = color[1];
            pixelBuffer[bufferIndex + 2] = color[2];
            pixelBuffer[bufferIndex + 3] = 255;
        }

        return pixelBuffer;
    }

    generateRivers(elevationData, moistureData, temperatureData, mapPins, width, height, params) {
        const riverDensity = params.riverDensity || 40;
        const seaLevel = params.seaLevel || 0.3;

        const rivers = [];
        const riverMap = new Uint8Array(width * height);
        const waterMask = new Float32Array(width * height);

        // 1. Setup springs
        const { finalSprings, overrideSet, blockedSet } = this.#parseSpringPins(mapPins);
        const proceduralSprings = this.#findSprings(elevationData, moistureData, width, height, seaLevel, riverDensity, params);

        this.#mergeProceduralSprings(finalSprings, proceduralSprings, overrideSet, blockedSet);

        // 2. Trace
        for (const spring of finalSprings) {
            const index = spring.y * width + spring.x;
            if (riverMap[index]) continue;

            const path = this.#traceRiver(spring.x, spring.y, elevationData, temperatureData, width, height, seaLevel, riverMap, waterMask, params);
            if (path) rivers.push({ id: `river_${rivers.length}`, path: path });
        }

        return { vectors: rivers, waterMask: waterMask };
    }

    #parseSpringPins(mapPins) {
        const finalSprings = [];
        const overrideSet = new Set();
        const blockedSet = new Set();

        if (!mapPins) return { finalSprings, overrideSet, blockedSet };

        for (const pin of mapPins) {
            if (pin.type === "spring") {
                finalSprings.push({ x: pin.x, y: pin.y });
                overrideSet.add(`${pin.x},${pin.y}`);
            } else if (pin.type === "block_spring") {
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        blockedSet.add(`${pin.x + dx},${pin.y + dy}`);
                    }
                }
            }
        }
        return { finalSprings, overrideSet, blockedSet };
    }

    #mergeProceduralSprings(finalSprings, proceduralSprings, overrideSet, blockedSet) {
        for (const spring of proceduralSprings) {
            if (blockedSet.has(`${spring.x},${spring.y}`)) continue;
            if (!overrideSet.has(`${spring.x},${spring.y}`)) {
                finalSprings.push(spring);
            }
        }
    }

    /**
     * Generates a flat RGBA buffer containing topographical contour lines.
     * Uses a high-performance neighbor-thresholding edge detection algorithm.
     */
    createContourMap(elevationData, width, height, interval, seaLevel) {
        const buffer = new Uint8Array(width * height * 4);
        if (!interval || interval <= 0) return buffer;

        for (let y = 0; y < height - 1; y++) {
            for (let x = 0; x < width - 1; x++) {
                const index = y * width + x;
                const elev = elevationData[index];

                // Determine the mathematical "contour step" for this pixel
                const currentStep = Math.floor(elev / interval);

                // Sample the Right and Bottom neighbors
                const rightStep = Math.floor(elevationData[index + 1] / interval);
                const bottomStep = Math.floor(elevationData[index + width] / interval);

                // If a boundary is crossed, color the pixel
                if (currentStep !== rightStep || currentStep !== bottomStep) {
                    const isLand = elev >= seaLevel;

                    // Cartographic styling: Dark lines on land, bright lines underwater
                    buffer[index * 4] = isLand ? 0 : 255; // R
                    buffer[index * 4 + 1] = isLand ? 0 : 255; // G
                    buffer[index * 4 + 2] = isLand ? 0 : 255; // B
                    buffer[index * 4 + 3] = isLand ? 60 : 40; // A (Alpha)
                }
            }
        }
        return buffer;
    }
}
