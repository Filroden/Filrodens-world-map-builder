import { SimplexNoise } from "../../vendor/simplex-noise/simplex-noise.js";
import { TectonicEngine } from "./TectonicEngine.js";
import { HydrologyEngine } from "./HydrologyEngine.js";
import { SpatialMath } from "../tools/SpatialMath.js";
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

        // Dedicated, isolated PRNG streams for distinct generation phases
        this.springPrng = ProceduralEngine.#mulberry32(seedNum + 1);
        this.riverPrng = ProceduralEngine.#mulberry32(seedNum + 2);
    }

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
     * Resolves bounds to the full map dimensions if none are provided.
     */
    static resolveBounds(bounds, width, height) {
        if (SpatialMath.isValidBounds(bounds)) return bounds;
        return { minX: 0, maxX: width - 1, minY: 0, maxY: height - 1 };
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

    /**
     * Extracts high-altitude, high-moisture starting points to be baked as permanent pins.
     */
    bakeProceduralSprings(elevationData, moistureData, width, height, params) {
        const springs = [];
        const targetCount = params.riverDensity || 40;
        const maxAttempts = targetCount * 50;
        let attempts = 0;

        const seaLevel = params.seaLevel || 0.35;
        const altOffset = params?.hydrology?.springAltOffset ?? FILRODENSWMB.HYDROLOGY.SPRING_ALTITUDE_OFFSET;
        const moistMin = params?.hydrology?.springMoistMin ?? FILRODENSWMB.HYDROLOGY.SPRING_MOISTURE_MIN;

        while (springs.length < targetCount && attempts < maxAttempts) {
            attempts++;
            const x = Math.floor(this.springPrng() * width);
            const y = Math.floor(this.springPrng() * height);
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
    #getLowestNeighbor(cx, cy, elevationData, width, height, params) {
        let minElev = Infinity;
        let bestTarget = null;
        const startIdx = Math.floor(this.riverPrng() * 8);
        const meanderJitter = params?.hydrology?.meanderJitter ?? FILRODENSWMB.HYDROLOGY.MEANDER_JITTER;

        for (let i = 0; i < 8; i++) {
            const dir = ProceduralEngine.ADJACENT_OFFSETS[(startIdx + i) % 8];
            const nx = cx + dir.dx;
            const ny = cy + dir.dy;

            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

            const idx = ny * width + nx;
            if (this.riverVisitedBuffer[idx] === this.riverTraceId) continue;

            const actualElev = elevationData[idx];
            const perceivedElev = actualElev + this.riverPrng() * meanderJitter;

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
    #fillBasin(startX, startY, elevationData, width, height, riverMap, params) {
        this.basinTraceId++;
        this.basinVisitedBuffer[startY * width + startX] = this.basinTraceId;

        const boundary = new MinHeap();
        boundary.push({ x: startX, y: startY, elev: elevationData[startY * width + startX] });

        const lakePixels = [];
        let surfaceElev = elevationData[startY * width + startX];
        const maxLakeSize = params?.hydrology?.maxLakeSize ?? FILRODENSWMB.HYDROLOGY.MAX_LAKE_SIZE;

        while (boundary.length > 0 && lakePixels.length < maxLakeSize) {
            const current = boundary.pop();

            lakePixels.push({ x: current.x, y: current.y, isLake: true });
            riverMap[current.y * width + current.x] = true;
            surfaceElev = Math.max(surfaceElev, current.elev);

            const spillover = this.#scanBasinNeighbors(current, elevationData, width, height, boundary);

            if (spillover) {
                return { spillover, lakePixels, surfaceElev: current.elev };
            }
        }

        return { spillover: null, lakePixels, surfaceElev };
    }

    #scanBasinNeighbors(current, elevationData, width, height, boundary) {
        for (const dir of ProceduralEngine.ADJACENT_OFFSETS) {
            const nx = current.x + dir.dx;
            const ny = current.y + dir.dy;

            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

            const idx = ny * width + nx;
            if (this.basinVisitedBuffer[idx] === this.basinTraceId) continue;
            this.basinVisitedBuffer[idx] = this.basinTraceId;

            const nElev = elevationData[idx];

            // If we found a pixel strictly lower than the one we are evaluating, it is the spillover lip.
            if (nElev < current.elev) {
                if (this.riverVisitedBuffer[idx] === this.riverTraceId) continue;
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
        const freezeLimit = params?.climate?.freezingThreshold ?? FILRODENSWMB.CLIMATE.FREEZING_THRESHOLD;

        let cx = startX;
        let cy = startY;
        let currentElev = elevationData[cy * width + cx];
        const maxLength = width * 1.5;

        while (path.length < maxLength) {
            const idx = cy * width + cx;
            const temp = temperatureData[idx];
            const isFrozen = temp < freezeLimit;

            this.riverVisitedBuffer[idx] = this.riverTraceId;
            path.push({ x: cx, y: cy, isFrozen: isFrozen });
            riverMap[idx] = true;

            const lowestNeighbor = this.#getLowestNeighbor(cx, cy, elevationData, width, height, params);

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
                const basin = this.#fillBasin(cx, cy, elevationData, width, height, riverMap, params);

                if (basin.lakePixels.length > 0) {
                    path.push({ x: cx, y: cy, isLake: true, isFrozen: isFrozen });
                    for (const lp of basin.lakePixels) {
                        this.riverVisitedBuffer[lp.y * width + lp.x] = this.riverTraceId;
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
    generateTopography(width, height, params, outBuffer, tectonicFaults = [], manualRivers = [], bounds = null) {
        const elevationData = outBuffer;
        const activeBounds = ProceduralEngine.resolveBounds(bounds, width, height);

        const eScale = params.noise.elevation.scale;
        const eOctaves = params.noise.elevation.octaves;
        const eStretch = params.noise.elevation.stretch || 1;
        const panX = params.noise.offsetX || 0;
        const panY = params.noise.offsetY || 0;
        const seaLevel = params.seaLevel || 0.35;

        // 1. Generate Base Elevation Noise
        for (let y = activeBounds.minY; y <= activeBounds.maxY; y++) {
            for (let x = activeBounds.minX; x <= activeBounds.maxX; x++) {
                const worldX = x + panX;
                const worldY = y + panY;
                elevationData[y * width + x] = this.#fbm(worldX, worldY, eOctaves, eScale);
            }
        }

        // 2. Apply Vector Deformations strictly within the active bounds
        if (tectonicFaults.length > 0) {
            TectonicEngine.applyTectonicFaults(elevationData, width, height, tectonicFaults, this.simplex, activeBounds);
        }
        if (manualRivers.length > 0) {
            HydrologyEngine.carveManualRivers(elevationData, width, height, manualRivers, this.simplex, params.seaLevel, activeBounds);
        }

        // 3. Apply Elevation Exponent & Pivot Map to Land/Sea Boundaries
        for (let y = activeBounds.minY; y <= activeBounds.maxY; y++) {
            for (let x = activeBounds.minX; x <= activeBounds.maxX; x++) {
                const i = y * width + x;
                let elevation = elevationData[i];

                if (elevation > seaLevel) {
                    const landHeight = (elevation - seaLevel) / (1 - seaLevel);
                    const stretchedLand = Math.pow(landHeight, eStretch);
                    elevationData[i] = seaLevel + stretchedLand * (1 - seaLevel);
                } else {
                    elevationData[i] = Math.max(0, elevation);
                }
            }
        }

        return elevationData;
    }

    /**
     * Calculates moisture and temperature based on the final topography.
     * Applies globally deterministic Orographic Lift via Western Horizon sampling.
     */
    generateClimateData(elevationData, width, height, params, outMoisture, outTemperature, bounds = null) {
        const moistureData = outMoisture;
        const temperatureData = outTemperature;

        const climateBounds = ProceduralEngine.resolveBounds(bounds, width, height);

        // Scale the mathematical wind distance to match the padded boundaries
        const baseWind = params.climate?.windDistance ?? FILRODENSWMB.CLIMATE.WIND_DISTANCE;
        const widthScale = width / FILRODENSWMB.LIMITS.BASELINE_DIMENSION;
        const latTop = params.latTop ?? 90;
        const latBottom = params.latBottom ?? -90;
        const latRange = Math.max(0.1, Math.abs(latTop - latBottom));
        const latScale = 180 / latRange;
        const dynamicWindDistance = Math.round(baseWind * widthScale * latScale);

        const panX = params.noise.offsetX || 0;
        const panY = params.noise.offsetY || 0;
        const mScale = params.noise.moisture.scale;
        const mOctaves = params.noise.moisture.octaves;
        const globalMoisture = params.globalMoisture || 0.5;
        const tScale = params.noise.temperature.scale || 1 / 250;
        const tOctaves = params.noise.temperature.octaves || 3;
        const globalTemp = params.globalTemp;
        const seasonOffset = params.seasonOffset || 0;
        const moistureOffset = params.noise.moistureOffset ?? 10000;
        const tempOffset = params.noise.tempOffset ?? 20000;

        for (let y = climateBounds.minY; y <= climateBounds.maxY; y++) {
            const currentLat = latTop - (y / height) * latRange;
            const latGradient = 1 - Math.abs(currentLat) / 90;
            const seasonImpact = (currentLat / 90) * seasonOffset * 0.35;

            for (let x = climateBounds.minX; x <= climateBounds.maxX; x++) {
                const index = y * width + x;
                const worldX = x + panX;
                const worldY = y + panY;

                // --- MOISTURE ---
                const moistureNoise = this.#fbm(worldX + moistureOffset, worldY + moistureOffset, mOctaves, mScale);
                let baseMoisture = moistureNoise + (globalMoisture - 0.5);
                const elevation = elevationData[index];
                const isLand = elevation > params.seaLevel;

                if (isLand) {
                    const absLat = Math.abs(currentLat);
                    const windCellBlend = Math.cos(absLat * (Math.PI / 45));

                    // Use the dynamically scaled wind distance
                    const windDirectionX = dynamicWindDistance * windCellBlend;

                    const upwindX = Math.max(0, Math.min(width - 1, Math.round(x + windDirectionX)));
                    const upwindElev = elevationData[y * width + upwindX];

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

    colorize(elevationData, temperatureData, width, height, seaLevel, waterMask, params, outBuffer, bounds = null, maxPeak = 1.0) {
        const pixelBuffer = outBuffer;
        const baseBounds = ProceduralEngine.resolveBounds(bounds, width, height);
        const renderBounds = SpatialMath.padBounds(baseBounds, 1, 1, width, height);

        for (let y = renderBounds.minY; y <= renderBounds.maxY; y++) {
            for (let x = renderBounds.minX; x <= renderBounds.maxX; x++) {
                const i = y * width + x;
                const elevation = elevationData[i];
                const bufferIndex = i * 4;

                if (elevation < seaLevel) {
                    this.#paintOceanPixel(pixelBuffer, bufferIndex, elevation, seaLevel);
                } else if (waterMask && waterMask[i] > 0) {
                    const temp = temperatureData ? temperatureData[i] : 1;
                    this.#paintLakePixel(pixelBuffer, bufferIndex, elevation, waterMask[i], temp, params);
                } else {
                    // Use the dynamic map peak instead of the hardcoded 1.0
                    this.#paintLandPixel(pixelBuffer, bufferIndex, elevation, seaLevel, maxPeak);
                }
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

    #paintLandPixel(pixelBuffer, bufferIndex, elevation, seaLevel, maxElevation) {
        // Prevent division by zero in the edge case of a completely flat map
        const safeMax = Math.max(maxElevation, seaLevel + 0.01);

        // Dynamically normalise the elevation against the true maximum peak
        const heightParam = seaLevel < safeMax ? (elevation - seaLevel) / (safeMax - seaLevel) : 1;

        const COLOR_BASE = 200;
        const COLOR_RANGE = 140;
        const MIN_BRIGHTNESS = 60;

        const grayValue = Math.max(MIN_BRIGHTNESS, COLOR_BASE - COLOR_RANGE * heightParam);

        pixelBuffer[bufferIndex] = grayValue;
        pixelBuffer[bufferIndex + 1] = grayValue;
        pixelBuffer[bufferIndex + 2] = grayValue;
        pixelBuffer[bufferIndex + 3] = 255;
    }

    #fbm(x, y, octaves, scale) {
        let total = 0;
        let frequency = scale;
        let amplitude = 1;
        let maxAmplitude = 0;

        for (let i = 0; i < octaves; i++) {
            const noiseVal = this.simplex.noise2D(x * frequency, y * frequency);
            total += noiseVal * amplitude;
            maxAmplitude += amplitude;
            amplitude *= 0.5;
            frequency *= 2;
        }

        const normalized = total / maxAmplitude;

        return Math.max(0, (normalized + 1) / 2);
    }

    /**
     * VISUAL PASS: Converts mathematical elevation into a pure, flat, binary land/sea map.
     */
    createBaseMap(elevationData, width, height, seaLevel, outBuffer, bounds = null) {
        const pixelBuffer = outBuffer;
        const activeBounds = ProceduralEngine.resolveBounds(bounds, width, height);

        for (let y = activeBounds.minY; y <= activeBounds.maxY; y++) {
            for (let x = activeBounds.minX; x <= activeBounds.maxX; x++) {
                const i = y * width + x;
                const isLand = elevationData[i] >= seaLevel;
                const bufferIndex = i * 4;

                if (isLand) {
                    pixelBuffer[bufferIndex] = 212;
                    pixelBuffer[bufferIndex + 1] = 184;
                    pixelBuffer[bufferIndex + 2] = 114;
                } else {
                    pixelBuffer[bufferIndex] = 26;
                    pixelBuffer[bufferIndex + 1] = 75;
                    pixelBuffer[bufferIndex + 2] = 132;
                }
                pixelBuffer[bufferIndex + 3] = 255;
            }
        }
        return pixelBuffer;
    }

    /**
     * Evaluates elevation and climate to determine the precise Biome key.
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
    createBiomesMap(elevationData, moistureData, temperatureData, biomeOverrideData, width, height, seaLevel, waterMask, params, outBuffer, bounds = null) {
        const pixelBuffer = outBuffer;
        const baseBounds = ProceduralEngine.resolveBounds(bounds, width, height);
        const renderBounds = SpatialMath.padBounds(baseBounds, 1, 1, width, height);

        for (let y = renderBounds.minY; y <= renderBounds.maxY; y++) {
            for (let x = renderBounds.minX; x <= renderBounds.maxX; x++) {
                const i = y * width + x;
                const bufferIndex = i * 4;
                const elevation = elevationData[i];

                const overrideId = biomeOverrideData ? biomeOverrideData[i] : 0;
                let lookupKey;
                let isWater = false;

                if (overrideId > 0) {
                    lookupKey = overrideId;
                    if (overrideId === 1 || overrideId === 2) isWater = true;
                } else {
                    const temp = temperatureData[i];
                    const moisture = moistureData[i];
                    lookupKey = ProceduralEngine.getBiomeKey(elevation, moisture, temp, seaLevel);

                    if (lookupKey === "DEEP_OCEAN" || lookupKey === "SHALLOW_OCEAN" || (waterMask && waterMask[i] > 0)) {
                        isWater = true;
                    }
                }

                if (isWater) {
                    pixelBuffer[bufferIndex] = 0;
                    pixelBuffer[bufferIndex + 1] = 0;
                    pixelBuffer[bufferIndex + 2] = 0;
                    pixelBuffer[bufferIndex + 3] = 0;
                    continue;
                }

                const color = params?.biomePalette?.[lookupKey] || [0, 0, 0];
                pixelBuffer[bufferIndex] = color[0];
                pixelBuffer[bufferIndex + 1] = color[1];
                pixelBuffer[bufferIndex + 2] = color[2];
                pixelBuffer[bufferIndex + 3] = 255;
            }
        }
        return pixelBuffer;
    }

    generateRivers(elevationData, moistureData, temperatureData, mapPins, width, height, params, outRiverMap, outWaterMask) {
        const seaLevel = params.seaLevel || 0.3;

        const rivers = [];
        const riverMap = outRiverMap;
        const waterMask = outWaterMask;

        riverMap.fill(0);
        waterMask.fill(0);

        // Intialise static buffers once per size-change to eliminate Garbage Collection spikes
        const totalPixels = width * height;
        if (this.riverVisitedBuffer?.length !== totalPixels) {
            this.riverVisitedBuffer = new Uint32Array(totalPixels);
            this.basinVisitedBuffer = new Uint32Array(totalPixels);
        }

        this.riverTraceId = 0;
        this.basinTraceId = 0;

        // 1. Setup springs purely from the baked pins array
        const finalSprings = this.#parseSpringPins(mapPins);

        // 2. Trace
        for (const spring of finalSprings) {
            const index = spring.y * width + spring.x;
            if (riverMap[index]) continue;

            this.riverTraceId++;
            const path = this.#traceRiver(spring.x, spring.y, elevationData, temperatureData, width, height, seaLevel, riverMap, waterMask, params);
            if (path) rivers.push({ id: `river_${rivers.length}`, path: path });
        }

        return { vectors: rivers, waterMask: waterMask };
    }

    #parseSpringPins(mapPins) {
        const finalSprings = [];
        if (!mapPins) return finalSprings;

        for (const pin of mapPins) {
            if (pin.type === "spring" && pin.visibility !== "none") {
                finalSprings.push({
                    x: Math.round(pin.x),
                    y: Math.round(pin.y),
                });
            }
        }
        return finalSprings;
    }

    /**
     * Extracts topographical contour lines.
     * Uses a high-performance neighbor-thresholding edge detection algorithm.
     */
    createContourMap(elevationData, width, height, interval, seaLevel, outBuffer, bounds = null) {
        if (!interval || interval <= 0) return outBuffer;

        const baseBounds = ProceduralEngine.resolveBounds(bounds, width, height);
        const contourBounds = SpatialMath.padBounds(baseBounds, 1, 1, width, height);

        // Targeted erasure of the rendering zone instead of a full buffer wipe
        for (let y = contourBounds.minY; y <= contourBounds.maxY; y++) {
            for (let x = contourBounds.minX; x <= contourBounds.maxX; x++) {
                const idx = (y * width + x) * 4;
                outBuffer[idx] = 0;
                outBuffer[idx + 1] = 0;
                outBuffer[idx + 2] = 0;
                outBuffer[idx + 3] = 0;
            }
        }

        const maxY = Math.min(contourBounds.maxY, height - 2);
        const maxX = Math.min(contourBounds.maxX, width - 2);

        for (let y = contourBounds.minY; y <= maxY; y++) {
            for (let x = contourBounds.minX; x <= maxX; x++) {
                const index = y * width + x;
                const elev = elevationData[index];

                const currentStep = Math.floor(elev / interval);
                const rightStep = Math.floor(elevationData[index + 1] / interval);
                const bottomStep = Math.floor(elevationData[index + width] / interval);

                if (currentStep !== rightStep || currentStep !== bottomStep) {
                    const isLand = elev >= seaLevel;
                    outBuffer[index * 4] = isLand ? 0 : 255;
                    outBuffer[index * 4 + 1] = isLand ? 0 : 255;
                    outBuffer[index * 4 + 2] = isLand ? 0 : 255;
                    outBuffer[index * 4 + 3] = isLand ? 60 : 40;
                }
            }
        }

        return outBuffer;
    }
}

class MinHeap {
    constructor() {
        this.heap = [];
    }

    get length() {
        return this.heap.length;
    }

    push(node) {
        this.heap.push(node);
        this.#bubbleUp(this.heap.length - 1);
    }

    pop() {
        if (this.heap.length === 0) return null;
        const top = this.heap[0];
        const bottom = this.heap.pop();
        if (this.heap.length > 0) {
            this.heap[0] = bottom;
            this.#sinkDown(0);
        }
        return top;
    }

    #bubbleUp(n) {
        while (n > 0) {
            const parent = Math.floor((n - 1) / 2);
            if (this.heap[n].elev >= this.heap[parent].elev) break;
            const tmp = this.heap[n];
            this.heap[n] = this.heap[parent];
            this.heap[parent] = tmp;
            n = parent;
        }
    }

    #sinkDown(n) {
        const length = this.heap.length;
        const element = this.heap[n];
        while (true) {
            let leftChildIdx = 2 * n + 1;
            let rightChildIdx = 2 * n + 2;
            let leftChild, rightChild;
            let swap = null;

            if (leftChildIdx < length) {
                leftChild = this.heap[leftChildIdx];
                if (leftChild.elev < element.elev) swap = leftChildIdx;
            }
            if (rightChildIdx < length) {
                rightChild = this.heap[rightChildIdx];
                if ((swap === null && rightChild.elev < element.elev) || (swap !== null && rightChild.elev < leftChild.elev)) {
                    swap = rightChildIdx;
                }
            }
            if (swap === null) break;
            this.heap[n] = this.heap[swap];
            this.heap[swap] = element;
            n = swap;
        }
    }
}
