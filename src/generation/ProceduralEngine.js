import { SimplexNoise } from "../../vendor/simplex-noise/simplex-noise.js";
import { TectonicEngine } from "./TectonicEngine.js";
import { HydrologyEngine } from "./HydrologyEngine.js";
import { BiomeRuleEngine } from "./BiomeRuleEngine.js";
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

        // Seeded from the map seed, so the same seed always produces the same noise
        this.prng = ProceduralEngine.#mulberry32(seedNum);
        this.simplex = new SimplexNoise(this.prng);

        // Dedicated, isolated PRNG streams for distinct generation phases. riverPrng seeds the
        // tectonic plates; the rivers themselves use riverTracePrng, below.
        this.springPrng = ProceduralEngine.#mulberry32(seedNum + 1);
        this.riverPrng = ProceduralEngine.#mulberry32(seedNum + 2);

        // Stream that the river currently being traced draws its random choices from. It is
        // replaced at the start of every river (see generateRivers), so it is never shared.
        this.riverTracePrng = this.riverPrng;
        this.seedNumber = seedNum;
    }

    // Cardinal and ordinal directions for pathfinding to prevent array reallocation in tight loops
    // The plate mesh's value away from any boundary (see #calculateTectonicBoundaries); plate
    // relief is read relative to it
    static #PLATE_RELIEF_BASE = 0.5;

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
     * The pixels the layer painters (colorize, createBiomesMap and createContourMap) write when they
     * are asked to repaint an area: the area plus the margin they add around it. Anything that has
     * to carry a repainted layer somewhere else, such as the texture on the GPU, must cover exactly
     * this, so it is worked out here for all of them.
     *
     * @param {object|null} bounds - The area being repainted, or nothing for the whole map.
     * @param {number} width - Map width in pixels.
     * @param {number} height - Map height in pixels.
     * @returns {object|null} The pixels written, or null when the whole map is repainted.
     */
    static getRepaintBounds(bounds, width, height) {
        if (!SpatialMath.isValidBounds(bounds)) return null;

        const margin = FILRODENSWMB.DISPLAY.REPAINT_MARGIN;
        return SpatialMath.padBounds(bounds, margin, margin, width, height);
    }

    /**
     * Determines if a given pixel coordinate falls within a vector polygon.
     * Highly optimised Ray-Casting (Even-Odd) algorithm for tight generation loops.
     */
    static isPointInPolygon(x, y, points) {
        let isInside = false;
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
            const xi = points[i].x,
                yi = points[i].y;
            const xj = points[j].x,
                yj = points[j].y;

            const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
            if (intersect) isInside = !isInside;
        }
        return isInside;
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
     * Derives the seed of one river's random stream from the map seed and the river's spring.
     *
     * The seed depends on nothing but those, so a river's random choices are the same whatever
     * else is on the map. The pixel index goes through an integer finaliser (the mixing steps of
     * MurmurHash3) so that springs a pixel apart get unrelated streams, instead of the nearly
     * identical ones that seeds one apart would give.
     *
     * @param {number} seedNumber - The map's numeric seed.
     * @param {number} springIndex - Row-major pixel index of the river's spring.
     * @returns {number} An unsigned 32-bit seed for the river's stream.
     */
    static #riverSeed(seedNumber, springIndex) {
        let hash = (seedNumber + 2) ^ Math.imul(springIndex + 1, 0x9e3779b1);
        hash ^= hash >>> 16;
        hash = Math.imul(hash, 0x85ebca6b);
        hash ^= hash >>> 13;
        hash = Math.imul(hash, 0xc2b2ae35);
        hash ^= hash >>> 16;
        return hash >>> 0;
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
        const targetCount = params.riverDensity ?? FILRODENSWMB.HYDROLOGY.RIVER_DENSITY;
        const maxAttempts = targetCount * 50;
        let attempts = 0;

        const seaLevel = params.seaLevel ?? FILRODENSWMB.DEFAULTS.SEA_LEVEL;
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
        const startIdx = Math.floor(this.riverTracePrng() * 8);
        const meanderJitter = params?.hydrology?.meanderJitter ?? FILRODENSWMB.HYDROLOGY.MEANDER_JITTER;

        for (let i = 0; i < 8; i++) {
            const dir = ProceduralEngine.ADJACENT_OFFSETS[(startIdx + i) % 8];
            const nx = cx + dir.dx;
            const ny = cy + dir.dy;

            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

            const idx = ny * width + nx;
            if (this.riverVisitedBuffer[idx] === this.riverTraceId) continue;

            const actualElev = elevationData[idx];
            const perceivedElev = actualElev + this.riverTracePrng() * meanderJitter;

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
        const maxLength = width * FILRODENSWMB.HYDROLOGY.MAX_RIVER_LENGTH_MULT;

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

        return path.length > FILRODENSWMB.HYDROLOGY.MAX_PATH_LENGTH ? path : null;
    }

    /**
     * The surface texture of the whole map: fine, rolling roughness from -1 to 1 at every pixel,
     * which textured Flat ground starts with and the Roughen and Level brushes paint (scaled by
     * the texture's amplitude, see ProceduralEngine.getSurfaceTextureAmplitude).
     *
     * It belongs to the ground, not to the map's pixels: it is read at each pixel's place in the
     * top map (`params.terrain.world`), in pixels of a BASELINE_DIMENSION map, so a regional map
     * shows the same texture as its parent and a larger map the same texture as a smaller one.
     * Wherever there are more pixels to the world (a regional map, or a top map larger than the
     * baseline), finer layers are added, one per doubling, as for the coastline detail.
     *
     * @param {number} width - Map width in pixels.
     * @param {number} height - Map height in pixels.
     * @param {object} params - Derived map parameters (reads `terrain.world`).
     * @param {Float32Array} outBuffer - Receives the texture, one value per pixel.
     * @returns {Float32Array} `outBuffer`.
     */
    generateSurfaceTexture(width, height, params, outBuffer) {
        const settings = FILRODENSWMB.GENERATION.SURFACE_TEXTURE;
        const world = params?.terrain?.world ?? { zoom: 1, originX: 0, originY: 0, rootW: width, rootH: height };
        const zoom = world.zoom || 1;
        const rootSize = Math.max(world.rootW || width / zoom, world.rootH || height / zoom);
        const baselinePerWorld = FILRODENSWMB.LIMITS.BASELINE_DIMENSION / rootSize;
        const density = zoom / baselinePerWorld;
        const extraOctaves = density > 1 ? Math.round(Math.log2(density)) : 0;
        const scale = 1 / settings.WAVELENGTH;

        for (let y = 0; y < height; y++) {
            const baselineY = ((world.originY || 0) + y / zoom) * baselinePerWorld + settings.NOISE_OFFSET.Y;
            for (let x = 0; x < width; x++) {
                const baselineX = ((world.originX || 0) + x / zoom) * baselinePerWorld + settings.NOISE_OFFSET.X;
                outBuffer[y * width + x] = this.#signedFbm(baselineX, baselineY, settings.OCTAVES, scale, extraOctaves);
            }
        }

        return outBuffer;
    }

    /**
     * Fractal noise centred on 0, from -1 to 1, built like #fbm (each layer at double the
     * frequency and half the amplitude, extra layers left out of the normalising total) but
     * without #fbm's floor at 0, which would leave flat spots wherever the noise dips lowest.
     *
     * The simplex noise itself can reach about 1.5 either way, so the normalised sum passes 1 in
     * about one pixel in a hundred. Clamping would flatten those pixels into small plateaus
     * that relief shading shows as blotches; a hyperbolic tangent instead eases the extremes
     * smoothly towards -1 and 1 and never quite reaches them.
     */
    #signedFbm(x, y, octaves, scale, extraOctaves) {
        let total = 0;
        let frequency = scale;
        let amplitude = 1;
        let maxAmplitude = 0;

        for (let i = 0; i < octaves + extraOctaves; i++) {
            total += this.simplex.noise2D(x * frequency, y * frequency) * amplitude;
            if (i < octaves) maxAmplitude += amplitude;
            amplitude *= 0.5;
            frequency *= 2;
        }

        return Math.tanh(total / maxAmplitude);
    }

    /**
     * How far the surface texture moves the ground either side of it, in elevation: a share of
     * the height Flat ground sits above sea level, so textured Flat ground never dips into the sea.
     *
     * @returns {number}
     */
    static getSurfaceTextureAmplitude() {
        const generation = FILRODENSWMB.GENERATION;
        return generation.FLAT_HEIGHT * generation.SURFACE_TEXTURE.AMPLITUDE_SHARE;
    }

    /**
     * Calculates pure geographical altitude, applying exponents strictly to landmasses.
     */
    generateTopography(width, height, params, outBuffer, tectonicFaults = [], manualRivers = [], bounds = null) {
        const elevationData = outBuffer;
        const activeBounds = ProceduralEngine.resolveBounds(bounds, width, height);

        const eScale = params.noise.elevation.scale;
        const eOctaves = params.noise.elevation.octaves;
        const eStretch = params.noise.elevation.stretch ?? 1;
        const panX = params.noise.offsetX ?? 0;
        const panY = params.noise.offsetY ?? 0;
        const seaLevel = params.seaLevel ?? FILRODENSWMB.DEFAULTS.SEA_LEVEL;
        // Finer detail layers for a zoomed-in regional map; 0 for any other map
        const extraOctaves = params.terrain?.extraOctaves ?? 0;

        // 1. Generate Base Elevation Noise
        for (let y = activeBounds.minY; y <= activeBounds.maxY; y++) {
            for (let x = activeBounds.minX; x <= activeBounds.maxX; x++) {
                const worldX = x + panX;
                const worldY = y + panY;
                elevationData[y * width + x] = this.#fbm(worldX, worldY, eOctaves, eScale, extraOctaves);
            }
        }

        // 2. Apply Vector Deformations strictly within the active bounds
        if (tectonicFaults.length > 0) {
            TectonicEngine.applyTectonicFaults(elevationData, width, height, tectonicFaults, this.simplex, activeBounds, params.terrain?.faultFrame);
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
     * ADVANCED PASS:
     * Uses Voronoi vector math, low-frequency boolean masking, and domain warping
     * to generate massive, realistic continental plates and tectonic mountain ridges.
     */
    generateTectonicTopography(width, height, params, outBuffer) {
        const elevationData = outBuffer;
        const panX = params.noise.offsetX ?? 0;
        const panY = params.noise.offsetY ?? 0;
        const seaLevel = params.seaLevel ?? FILRODENSWMB.DEFAULTS.SEA_LEVEL;
        const shelfRange = params.shelfRange ?? FILRODENSWMB.GENERATION.SHELF_RANGE;

        const plateCount = params.tectonicPlates ?? FILRODENSWMB.GENERATION.TECTONIC_PLATES;
        const fracture = params.coastlineFracture ?? FILRODENSWMB.GENERATION.COASTLINE_FRACTURE;
        const maskThreshold = params.continentalGrouping ?? FILRODENSWMB.GENERATION.CONTINENTAL_GROUPING;

        // 1. Generate Tectonic Base (Low-Res Voronoi Mesh)
        // Calculated on a lightweight grid to maintain 60FPS performance
        const meshW = FILRODENSWMB.GENERATION.TECTONIC_MESH.WIDTH;
        const meshH = FILRODENSWMB.GENERATION.TECTONIC_MESH.HEIGHT;
        const tectonicMesh = this.#generateTectonicMesh(meshW, meshH, plateCount);

        const eScale = params.noise.elevation.scale;
        const eOctaves = params.noise.elevation.octaves;

        // A fixed spatial frequency anchored to the map's dimensions
        const macroScale = 1 / Math.max(width, height);

        // 2. High-Resolution Math Pass
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const worldX = x + panX;
                const worldY = y + panY;
                const i = y * width + x;

                // A. Domain Warping (Fracture)
                const warpX =
                    (this.#fbm(
                        worldX + FILRODENSWMB.GENERATION.WARP.OFFSETS.X.X,
                        worldY + FILRODENSWMB.GENERATION.WARP.OFFSETS.X.Y,
                        FILRODENSWMB.GENERATION.WARP.OCTAVES,
                        macroScale * FILRODENSWMB.GENERATION.WARP.FREQUENCY_MULT,
                    ) -
                        0.5) *
                    fracture *
                    FILRODENSWMB.GENERATION.WARP.AMPLITUDE;
                const warpY =
                    (this.#fbm(
                        worldX + FILRODENSWMB.GENERATION.WARP.OFFSETS.Y.X,
                        worldY + FILRODENSWMB.GENERATION.WARP.OFFSETS.Y.Y,
                        FILRODENSWMB.GENERATION.WARP.OCTAVES,
                        macroScale * FILRODENSWMB.GENERATION.WARP.FREQUENCY_MULT,
                    ) -
                        0.5) *
                    fracture *
                    FILRODENSWMB.GENERATION.WARP.AMPLITUDE;

                const sampleX = worldX + warpX;
                const sampleY = worldY + warpY;

                // B. Continental Masking (Low-Frequency Biasing)
                const maskNoise = this.#fbm(sampleX, sampleY, FILRODENSWMB.GENERATION.CONTINENTAL_MASKING.OCTAVES, macroScale * FILRODENSWMB.GENERATION.CONTINENTAL_MASKING.FREQUENCY_MULT);
                const maskVal = this.#smoothstep(maskThreshold - FILRODENSWMB.GENERATION.MASK_BLEND_WIDTH, maskThreshold + FILRODENSWMB.GENERATION.MASK_BLEND_WIDTH, maskNoise);

                // C. Tectonic Bilinear Upscaling
                const mx = (x / width) * (meshW - 1);
                const my = (y / height) * (meshH - 1);
                const tectonicElevation = this.#bilinearSample(tectonicMesh, meshW, meshH, mx, my);

                // D. Detail Composition
                const detailNoise = this.#fbm(sampleX, sampleY, eOctaves, eScale);
                const baseTexture = tectonicElevation * FILRODENSWMB.GENERATION.BLEND_WEIGHTS.TECTONIC_MACRO + detailNoise * FILRODENSWMB.GENERATION.BLEND_WEIGHTS.TECTONIC_DETAIL;

                // Model 1: Land generates upwards from the sea level to the maximum peak
                const landElev = seaLevel + baseTexture * (1.0 - seaLevel);

                // Model 2: Ocean generates downwards from just below sea level to the abyss
                // Capping at to prevents underwater mountains from breaching the surface as islands
                const oceanElev = baseTexture * (seaLevel * FILRODENSWMB.GENERATION.OCEAN_DEPTH_CAP);

                // Blend the two models based on the continental mask value
                let finalElev = this.#blendElevations(oceanElev, landElev, maskVal);
                finalElev = this.#applyContinentalShelf(finalElev, seaLevel, shelfRange);

                elevationData[i] = Math.max(0, Math.min(1, finalElev));
            }
        }
        return elevationData;
    }

    /**
     * Calculates continental plates and tectonic boundary elevations on a low-resolution array.
     * Refactored to eliminate object property lookups and expensive square root operations.
     */
    #generateTectonicMesh(width, height, plateCount) {
        // 1. Seed plates into a flat Typed Array: [x, y, dx, dy, x, y, dx, dy...]
        const plates = this.#seedTectonicPlates(width, height, plateCount);

        // 2. Assign Voronoi Cells using high-speed squared distance
        const cellMap = this.#mapTectonicCells(width, height, plateCount, plates);

        // 3. Calculate Boundary Physics
        const mesh = this.#calculateTectonicBoundaries(width, height, cellMap, plates);

        // 4. Box-blur the mesh to smooth the jagged mathematical Voronoi edges before upscaling
        return this.#blurMesh(mesh, width, height, FILRODENSWMB.GENERATION.TECTONIC_MESH.BLUR_RADIUS);
    }

    /**
     * Generates random starting coordinates and drift vectors for tectonic plates, drawn from
     * `prng` (the legacy tectonic engine's shared stream unless another is given).
     */
    #seedTectonicPlates(width, height, plateCount, prng = this.riverPrng) {
        const plates = new Float32Array(plateCount * 4);

        for (let i = 0; i < plateCount; i++) {
            const index = i * 4;
            plates[index] = prng() * width; // x
            plates[index + 1] = prng() * height; // y
            plates[index + 2] = (prng() - 0.5) * 2; // dx (Drift velocity X)
            plates[index + 3] = (prng() - 0.5) * 2; // dy (Drift velocity Y)
        }

        return plates;
    }

    /**
     * Determines plate ownership for each mesh coordinate.
     * Uses squared distance to completely bypass Math.hypot overhead.
     */
    #mapTectonicCells(width, height, plateCount, plates) {
        const cellMap = new Int32Array(width * height);

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let minSqDist = Infinity;
                let bestPlate = 0;

                for (let p = 0; p < plateCount; p++) {
                    const plateIndex = p * 4;
                    const px = plates[plateIndex];
                    const py = plates[plateIndex + 1];

                    const distSq = (x - px) * (x - px) + (y - py) * (y - py);

                    if (distSq < minSqDist) {
                        minSqDist = distSq;
                        bestPlate = p;
                    }
                }

                cellMap[y * width + x] = bestPlate;
            }
        }

        return cellMap;
    }

    /**
     * Applies boundary elevations (convergent ridges or divergent trenches) where plates meet.
     */
    #calculateTectonicBoundaries(width, height, cellMap, plates) {
        const mesh = new Float32Array(width * height);

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                const myPlateId = cellMap[idx];
                const foreignPlateId = this.#findAdjacentForeignPlate(x, y, width, height, cellMap, myPlateId);

                let boundaryModifier = 0;

                if (foreignPlateId !== -1) {
                    const myIndex = myPlateId * 4;
                    const foreignIndex = foreignPlateId * 4;

                    // Calculate collision by evaluating relative velocity against relative position
                    const relativePosX = plates[foreignIndex] - plates[myIndex];
                    const relativePosY = plates[foreignIndex + 1] - plates[myIndex + 1];
                    const relativeVelX = plates[foreignIndex + 2] - plates[myIndex + 2];
                    const relativeVelY = plates[foreignIndex + 3] - plates[myIndex + 3];

                    // Dot product: Negative result means plates are crashing together
                    const collision = relativePosX * relativeVelX + relativePosY * relativeVelY;
                    boundaryModifier = collision < 0 ? 0.8 : -0.4;
                }

                // Apply base elevation (0.5) modified by the boundary physics
                mesh[idx] = 0.5 + boundaryModifier;
            }
        }

        return mesh;
    }

    /**
     * Scans adjacent coordinates to identify the ID of an intersecting tectonic plate.
     */
    #findAdjacentForeignPlate(x, y, width, height, cellMap, myPlateId) {
        for (const dir of ProceduralEngine.ADJACENT_OFFSETS) {
            const nx = x + dir.dx;
            const ny = y + dir.dy;

            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                const neighbourPlateId = cellMap[ny * width + nx];
                if (neighbourPlateId !== myPlateId) {
                    return neighbourPlateId;
                }
            }
        }

        return -1;
    }

    /**
     * GUIDED PASS:
     * Builds a signed distance field to the edges of the land masks (the "macro" coastline), then
     * lets noise, domain warping and continental shelving shape the terrain from it (see
     * #applyGuidedDetail). Falls back to deep ocean if no land masks are provided.
     *
     * Everything is worked out in the pixels of the map at the top of this map's chain of crops
     * (its "world", from params.terrain), so a regional map evaluates exactly the fields its
     * parent did, only more densely. A map that was never cropped is its own top map, so for it
     * world pixels are simply map pixels.
     */
    generateGuidedTopography(width, height, params, landMasks, outBuffer) {
        const elevationData = outBuffer;
        const validMasks = (landMasks ?? []).filter((m) => m.points && m.points.length >= FILRODENSWMB.LIMITS.MIN_POLYGON_VERTICES);
        const frame = ProceduralEngine.#resolveTerrainFrame(width, height, params);
        const land = validMasks.length > 0 ? this.#maskLand(validMasks, frame) : null;
        const field = this.#buildCoastDistanceField(width, height, params, frame, land, { findRidges: true });

        this.#applyGuidedDetail(width, height, params, frame, field, elevationData);

        return elevationData;
    }

    /**
     * TECTONIC PASS (current rules): the same pipeline as guided terrain, with the land and
     * ocean decided by tectonic plates instead of drawn land masks.
     *
     * Each plate is given a buoyancy, from sinking ocean floor (-1) to buoyant continental crust
     * (+1). A point is land where low-frequency continent noise plus the buoyancy of the plates
     * around it clears the Continental Grouping threshold, so the plates set out where
     * continents lie and the noise gives them their outlines. That land is then shaped exactly
     * as guided terrain shapes land drawn by hand (coastline distance field, Coastline
     * Fracture, coastal plains and shelf, Continent and Ocean Scale), so both engines share one
     * set of controls and both can make regional maps.
     *
     * The plate boundaries also shape the relief: where plates collide they raise mountain
     * ranges on land and cut trenches at sea, and where they pull apart they open rift valleys
     * on land and raise mid-ocean ridges at sea (scaled by the Mid-Ocean Ridges setting). These
     * are read at the same warped position as the coastline, so Coastline Fracture bends the
     * mountain ranges along with the coasts.
     *
     * Everything is laid out over the map at the top of this map's chain of crops, like guided
     * terrain, so a regional map finds the same plates, continents and ranges as its parent.
     */
    generateTectonicV2Topography(width, height, params, outBuffer) {
        const frame = ProceduralEngine.#resolveTerrainFrame(width, height, params);
        const continents = this.#continentNoise(params, frame);
        const plates = this.#buildPlateModel(params, frame, continents);
        const land = this.#plateLand(frame, plates, continents);
        const field = this.#buildCoastDistanceField(width, height, params, frame, land, { findRidges: false });
        if (ProceduralEngine.#ridgeStrengthOf(params) > 0) field.ridges = this.#buildPlateRidgeField(frame, plates);

        this.#applyGuidedDetail(width, height, params, frame, field, outBuffer, plates);

        return outBuffer;
    }

    /** Land and ocean as the land masks draw them, as a test of any world position (see #plateLand). */
    #maskLand(validMasks, frame) {
        const compiledMasks = this.#compileMaskData(ProceduralEngine.#masksToWorld(validMasks, frame));
        return (worldX, worldY) => this.#resolvePixelOwnership(worldX, worldY, compiledMasks);
    }

    /**
     * The low-frequency continent noise that, with the plates, decides where land lies, and the
     * threshold it is measured against (Continental Grouping, see TECTONICS_V2.GROUPING_OFFSET).
     * The noise is read at the same noise position guided terrain uses for its detail at that
     * world point (the world position plus the map's pan), so a regional map reads exactly the
     * noise its parent did.
     *
     * @returns {{at: function(number, number): number, threshold: number}}
     */
    #continentNoise(params, frame) {
        const masking = FILRODENSWMB.GENERATION.CONTINENTAL_MASKING;
        const noiseScale = masking.FREQUENCY_MULT / Math.max(frame.rootW, frame.rootH);
        const shiftX = (params.noise.offsetX ?? 0) / frame.zoom - frame.originX;
        const shiftY = (params.noise.offsetY ?? 0) / frame.zoom - frame.originY;

        return {
            at: (worldX, worldY) => this.#fbm(worldX + shiftX, worldY + shiftY, masking.OCTAVES, noiseScale),
            threshold: (params.continentalGrouping ?? FILRODENSWMB.GENERATION.CONTINENTAL_GROUPING) + FILRODENSWMB.GENERATION.TECTONICS_V2.GROUPING_OFFSET,
        };
    }

    /**
     * The tectonic plates, laid over the map at the top of the chain of crops on the same
     * coarse mesh the legacy tectonic engine uses: where each plate lies, how buoyant it is, and
     * the relief its boundaries raise (see #calculateTectonicBoundaries).
     *
     * The plates are seeded from a random stream of their own, so nothing else drawn from the
     * map's seed (springs, rivers) shifts when the number of plates changes, and each plate keeps
     * its place when plates are added (plate n always takes the same draws from the stream).
     *
     * A plate's buoyancy leans towards what the continent noise says at the plate's centre:
     * buoyant where the noise already favours land, sinking where it favours ocean, plus a
     * random part from a hash of the seed and the plate's number. Purely random buoyancy made
     * every added plate a coin flip over the whole area it took from its neighbours, so one more
     * plate could sink or raise half a continent. Leaning on the noise means a new plate mostly
     * agrees with the land already there, so adding plates reshapes coasts and ranges rather than
     * redrawing the map, while the random part still lets some plates go against the noise.
     *
     * Both the relief and the buoyancy are blurred across the mesh, so neither turns into blocky
     * steps when read between cells.
     */
    #buildPlateModel(params, frame, continents) {
        const settings = FILRODENSWMB.GENERATION.TECTONICS_V2;
        const meshWidth = FILRODENSWMB.GENERATION.TECTONIC_MESH.WIDTH;
        const meshHeight = FILRODENSWMB.GENERATION.TECTONIC_MESH.HEIGHT;
        const blurRadius = FILRODENSWMB.GENERATION.TECTONIC_MESH.BLUR_RADIUS;
        const plateCount = params.tectonicPlates ?? FILRODENSWMB.GENERATION.TECTONIC_PLATES;

        const platePrng = ProceduralEngine.#mulberry32(this.seedNumber + settings.PLATE_SEED_OFFSET);
        const plates = this.#seedTectonicPlates(meshWidth, meshHeight, plateCount, platePrng);
        const cellMap = this.#mapTectonicCells(meshWidth, meshHeight, plateCount, plates);
        const relief = this.#blurMesh(this.#calculateTectonicBoundaries(meshWidth, meshHeight, cellMap, plates), meshWidth, meshHeight, blurRadius);

        const plateBuoyancy = Array.from({ length: plateCount }, (_, plate) => {
            const centreX = (plates[plate * 4] / (meshWidth - 1)) * frame.rootW;
            const centreY = (plates[plate * 4 + 1] / (meshHeight - 1)) * frame.rootH;
            const leaning = (continents.at(centreX, centreY) - continents.threshold) * settings.BUOYANCY_ALIGNMENT;
            const random = (ProceduralEngine.#hash01(this.seedNumber * settings.BUOYANCY_SEED_MULTIPLIER + plate * settings.BUOYANCY_PLATE_MULTIPLIER) * 2 - 1) * settings.BUOYANCY_RANDOMNESS;
            return Math.max(-1, Math.min(1, leaning + random));
        });
        const buoyancy = this.#blurMesh(Float32Array.from(cellMap, (plate) => plateBuoyancy[plate]), meshWidth, meshHeight, blurRadius);

        return { relief, buoyancy, meshWidth, meshHeight, plates, plateCount };
    }

    /**
     * Land and ocean as the plates decide them (see generateTectonicV2Topography), as a test of
     * any world position.
     */
    #plateLand(frame, plates, continents) {
        const weight = FILRODENSWMB.GENERATION.TECTONICS_V2.PLATE_WEIGHT;

        return (worldX, worldY) => {
            const buoyancy = this.#samplePlateMesh(plates, plates.buoyancy, frame, worldX, worldY);
            return continents.at(worldX, worldY) + weight * buoyancy > continents.threshold ? 1 : 0;
        };
    }

    /** Reads one of the plate model's meshes at a world position (the mesh spans the top map). */
    #samplePlateMesh(plates, mesh, frame, worldX, worldY) {
        const meshX = Math.max(0, Math.min(1, worldX / frame.rootW)) * (plates.meshWidth - 1);
        const meshY = Math.max(0, Math.min(1, worldY / frame.rootH)) * (plates.meshHeight - 1);
        return this.#bilinearSample(mesh, plates.meshWidth, plates.meshHeight, meshX, meshY);
    }

    /** A well-mixed number from 0 to 1 for an integer, the same every time for the same integer. */
    static #hash01(value) {
        let hash = value | 0;
        hash ^= hash >>> 16;
        hash = Math.imul(hash, 0x85ebca6b);
        hash ^= hash >>> 13;
        hash = Math.imul(hash, 0xc2b2ae35);
        hash ^= hash >>> 16;
        return (hash >>> 0) / 4294967296;
    }

    /**
     * Reads the revision-dependent terrain values (see TerrainVersion.getTerrainParams) with the
     * defaults that reproduce the legacy behaviour when they are absent: a map that is its own
     * top map, settings at their baseline scale, no extra octaves.
     *
     * @returns {{zoom: number, originX: number, originY: number, rootW: number, rootH: number,
     *   resolutionScale: number, detailOctaves: number, fillEnclosedCoast: boolean, coastalBuffers: boolean}}
     */
    static #resolveTerrainFrame(width, height, params) {
        const terrain = params.terrain ?? {};
        const world = terrain.world ?? {};
        const zoom = world.zoom ?? 1;

        return {
            zoom,
            originX: world.originX ?? 0,
            originY: world.originY ?? 0,
            rootW: world.rootW ?? width / zoom,
            rootH: world.rootH ?? height / zoom,
            resolutionScale: terrain.resolutionScale ?? 1,
            detailOctaves: terrain.detailOctaves ?? 0,
            fillEnclosedCoast: terrain.fillEnclosedCoast === true,
            coastalBuffers: terrain.coastalBuffers === true,
        };
    }

    /**
     * Builds the signed distance, in world pixels, from every point near this map to the nearest
     * edge of the land masks: positive on land, negative at sea. It is returned as a grid with a
     * sampler that reads it at any world position.
     *
     * The grid covers this map's footprint in the world plus a margin, because the terrain at a
     * point depends on the coastline up to Continent Scale away (and further, once the domain
     * warp moves the point being sampled). Without the margin a regional map cropped inside a
     * continent would see no coastline at all. The grid is clipped to the top map, so a regional
     * map near its parent's edge sees exactly the coastline its parent saw.
     *
     * Masks are stored in this map's own pixels, as every other vector feature is, and are
     * converted to world pixels here. On a regional map the grid can have more than one cell per
     * world pixel (up to the zoom), so masks drawn on the regional map itself keep their detail.
     *
     * For a map that was never cropped the grid is exactly the map, one cell per pixel, so the
     * field is identical to the one this pass has always built.
     *
     * Under the current coastal profile the grid also records, for every cell, how large the
     * nearest landmass is (see #measureLandmasses), so small islands can rise to proper hills.
     */
    #buildCoastDistanceField(width, height, params, frame, land, { findRidges }) {
        const margin = ProceduralEngine.#coastFieldMargin(params, frame);
        const u0 = Math.max(0, Math.floor(frame.originX - margin));
        const v0 = Math.max(0, Math.floor(frame.originY - margin));
        const u1 = Math.min(frame.rootW, Math.ceil(frame.originX + width / frame.zoom + margin));
        const v1 = Math.min(frame.rootH, Math.ceil(frame.originY + height / frame.zoom + margin));

        const worldArea = Math.max(1, (u1 - u0) * (v1 - v0));
        const maxCellsPerPixel = Math.sqrt(FILRODENSWMB.GENERATION.COAST_FIELD_MAX_CELLS / worldArea);
        const cellsPerPixel = frame.zoom <= 1 ? 1 : Math.max(1, Math.min(frame.zoom, maxCellsPerPixel));

        const grid = {
            u0,
            v0,
            cellsPerPixel,
            width: Math.max(1, Math.round((u1 - u0) * cellsPerPixel)),
            height: Math.max(1, Math.round((v1 - v0) * cellsPerPixel)),
            // Which sides of the grid cut through the world, rather than lying on the top map's
            // own edge (see #measureLandmasses)
            cutEdges: { left: u0 > 0, top: v0 > 0, right: u1 < frame.rootW, bottom: v1 < frame.rootH },
            landmassReach: null,
            ridges: null,
        };

        if (!land) {
            // Bypass JFA and flood the field with a massive negative distance to force deep ocean
            const deepOceanDistance = -Math.max(width, height);
            grid.distances = new Float32Array(grid.width * grid.height).fill(deepOceanDistance);
        } else {
            const field = this.#generateJFADistanceField(grid, land, frame.fillEnclosedCoast, frame.coastalBuffers);
            grid.distances = field.distances;
            grid.landmassReach = field.landmassReach;
            if (findRidges && frame.coastalBuffers && ProceduralEngine.#ridgeStrengthOf(params) > 0) grid.ridges = this.#buildRidgeField(frame, land);
        }

        return grid;
    }

    /**
     * How far beyond this map's edges, in world pixels, the coastline can still shape its
     * terrain: the full reach of the coastline structure (Continent Scale, or Ocean Scale if
     * larger, beyond the widest coastal band under the current coastal profile), plus the band
     * the coastline may wander
     * within, plus the furthest the domain warp can move a sample. The warp term is taken at the
     * full warp amplitude rather than the half that noise centred on 0.5 reaches in theory, since
     * simplex noise overshoots its nominal range.
     */
    static #coastFieldMargin(params, frame) {
        const generation = FILRODENSWMB.GENERATION;
        const landScale = params.continentScale ?? generation.CONTINENT_SCALE;
        const oceanScale = frame.coastalBuffers ? ProceduralEngine.#oceanScaleOf(params) : landScale;
        const continentScale = Math.max(landScale, oceanScale) * frame.resolutionScale;
        const fracture = params.coastlineFracture ?? generation.COASTLINE_FRACTURE;
        const band = ProceduralEngine.#coastlineNoiseScale(params, frame) * generation.COASTAL_VARIANCE.BAND_RATIO;
        const warpReach = fracture * generation.WARP.AMPLITUDE * frame.resolutionScale;
        const bufferReach = frame.coastalBuffers ? ProceduralEngine.#resolveCoastalProfile(params, frame).maxBufferWidth : 0;

        return Math.ceil(bufferReach + continentScale + band + warpReach);
    }

    /**
     * The size, in world pixels, that the noise moving the coastline off the drawn edge is
     * measured against (see COASTAL_VARIANCE). Legacy maps use their own Continent Scale; from
     * the current coastal profile on it is the default Continent Scale, so that slider shapes the
     * relief alone and Coastline Fracture is the one control over the coastline.
     */
    static #coastlineNoiseScale(params, frame) {
        const generation = FILRODENSWMB.GENERATION;
        const continentScale = frame.coastalBuffers ? generation.CONTINENT_SCALE : (params.continentScale ?? generation.CONTINENT_SCALE);
        return continentScale * frame.resolutionScale;
    }

    /**
     * Ocean Scale, the seaward counterpart of Continent Scale. A map saved before it existed
     * uses its Continent Scale for both.
     */
    static #oceanScaleOf(params) {
        return params.oceanScale ?? params.continentScale ?? FILRODENSWMB.GENERATION.OCEAN_SCALE;
    }

    /**
     * Everything the current coastal profile (see #shapeCoastalProfile) needs that stays the same
     * across the whole map, in world pixels, worked out once per generation.
     */
    static #resolveCoastalProfile(params, frame) {
        const generation = FILRODENSWMB.GENERATION;
        const profile = generation.COASTAL_PROFILE;
        const scale = frame.resolutionScale;
        const pixelsPerUnit = profile.BUFFER_WIDTH * scale;
        const plainWidth = Math.max(0, params.coastalPlain ?? generation.COASTAL_PLAIN) * pixelsPerUnit;
        const shelfWidth = Math.max(0, params.shelfRange ?? generation.SHELF_RANGE) * pixelsPerUnit;

        return {
            plainWidth,
            shelfWidth,
            maxBufferWidth: Math.max(plainWidth, shelfWidth) * (1 + profile.BUFFER_VARIATION),
            variesWidth: plainWidth > 0 || shelfWidth > 0,
            variationScale: 1 / (profile.BUFFER_VARIATION_LENGTH * scale),
            continentScale: (params.continentScale ?? generation.CONTINENT_SCALE) * scale,
            oceanScale: ProceduralEngine.#oceanScaleOf(params) * scale,
            minimumRise: profile.LANDMASS_MIN_RISE * scale,
            ridges: null,
            coastalBand: (params.coastalBand ?? generation.COASTAL_BAND) * scale,
            oceanDepth: (params.seaLevel ?? FILRODENSWMB.DEFAULTS.SEA_LEVEL) * generation.OCEAN_DEPTH_CAP,
        };
    }

    /**
     * Copies land masks with their points converted from this map's pixels to world pixels.
     * For a map that was never cropped the conversion leaves every point exactly as it was.
     */
    static #masksToWorld(validMasks, frame) {
        return validMasks.map((mask) => ({
            ...mask,
            points: mask.points.map((point) => ({
                x: frame.originX + point.x / frame.zoom,
                y: frame.originY + point.y / frame.zoom,
            })),
        }));
    }

    /**
     * Executes the Jump Flood Algorithm natively, eliminating Web Worker overhead.
     *
     * Works in grid cells and returns distances in world pixels. When `fillEnclosedCoast` is set,
     * a grid with no coastline anywhere in it (entirely inside, or entirely outside, the land
     * masks) is given a large distance of the right sign, so it becomes deep inland or open ocean.
     * The legacy revision left such a grid at distance zero, which put coastline noise across the
     * whole map; it is kept that way for legacy maps so they regenerate unchanged.
     *
     * When `measureLandmasses` is set it also works out how large the nearest landmass is for
     * every cell (see #measureLandmasses); otherwise `landmassReach` is null.
     *
     * @returns {{distances: Float32Array, landmassReach: Float32Array|null}}
     */
    #generateJFADistanceField(grid, land, fillEnclosedCoast, measureLandmasses = false) {
        const { width, height } = grid;
        const totalPixels = width * height;
        let seedGrid = new Int32Array(totalPixels * 2).fill(-1);
        const distanceGrid = new Float32Array(totalPixels);

        const ownershipGrid = this.#generateOwnershipGrid(grid, land);

        this.#initialiseJFABoundaries(seedGrid, ownershipGrid, width, height);
        seedGrid = this.#runJumpFlood(seedGrid, width, height);

        const enclosedDistance = fillEnclosedCoast ? Math.max(width, height) : 0;
        this.#resolveAbsoluteDistances(seedGrid, distanceGrid, ownershipGrid, width, height, enclosedDistance);

        if (grid.cellsPerPixel !== 1) {
            for (let i = 0; i < totalPixels; i++) distanceGrid[i] /= grid.cellsPerPixel;
        }

        const landmassReach = measureLandmasses ? ProceduralEngine.#measureLandmasses(grid, ownershipGrid, distanceGrid, seedGrid) : null;
        return { distances: distanceGrid, landmassReach };
    }

    /** The Mid-Ocean Ridges setting, from 0 (none) to 1. */
    static #ridgeStrengthOf(params) {
        return Math.max(0, params.oceanRidges ?? FILRODENSWMB.GENERATION.OCEAN_RIDGES);
    }

    /**
     * Works out where mid-ocean ridges run: along the line through the ocean that lies equally
     * far from two different landmasses, as real ridges run down the middle of an ocean between
     * the continents on either side of it.
     *
     * This is worked out once over the whole of the map at the top of this map's chain of crops,
     * on a coarse grid of fixed size in pixels of a BASELINE_DIMENSION map (see OCEAN_RIDGES), so
     * a regional map finds exactly the same ridges as its parent even when the landmasses that
     * place them lie far outside its own area. Ridges are broad and smooth, so the coarse grid
     * loses nothing visible; it also keeps the three flood fills involved cheap.
     *
     * Only landmasses large enough to count as continents divide the ocean (see
     * MIN_LANDMASS_REACH); otherwise every small island would sit inside its own ring of ridges.
     *
     * @returns {{u0: number, v0: number, cellsPerPixel: number, width: number, height: number, distances: Float32Array}|null}
     *   A grid holding each cell's distance, in world pixels, to the nearest ridge line, or null
     *   if no two landmasses are large enough to place a ridge between them.
     */
    #buildRidgeField(frame, land) {
        const settings = FILRODENSWMB.GENERATION.COASTAL_PROFILE.OCEAN_RIDGES;
        const grid = ProceduralEngine.#ridgeGrid(frame);

        const { distances } = this.#generateJFADistanceField(grid, land, true);
        const landmassOf = ProceduralEngine.#labelContinents(grid, distances, settings.MIN_LANDMASS_REACH * frame.resolutionScale);
        const nearestContinent = this.#findNearestContinent(grid, landmassOf);
        const differentContinents = (own, other) => own !== -1 && other !== -1 && own !== other;
        const ridgeDistances = this.#measureRidgeDistances(grid, nearestContinent, differentContinents);

        return ridgeDistances ? { ...grid, distances: ridgeDistances } : null;
    }

    /**
     * The coarse grid ridge lines are found on: the whole map at the top of the chain of crops,
     * at OCEAN_RIDGES.CELL_SIZE pixels of a baseline map per cell, whatever this map's own size
     * or zoom (see #buildRidgeField).
     */
    static #ridgeGrid(frame) {
        const cellSize = FILRODENSWMB.GENERATION.COASTAL_PROFILE.OCEAN_RIDGES.CELL_SIZE * frame.resolutionScale;
        return {
            u0: 0,
            v0: 0,
            cellsPerPixel: 1 / cellSize,
            width: Math.max(1, Math.ceil(frame.rootW / cellSize)),
            height: Math.max(1, Math.ceil(frame.rootH / cellSize)),
        };
    }

    /**
     * Where mid-ocean ridges run on tectonic terrain: along every boundary where two plates pull
     * apart, as real ridges form where the seabed spreads. The plates are the same ones that
     * place the land (see #buildPlateModel), assigned to the cells of the same coarse grid guided
     * terrain uses for its ridges, so both engines' ridges are then shaped identically by
     * #ridgeLift (a wandering crest, a rift valley, flanks easing into the abyssal plain). Only
     * the parts under deep ocean show, since #ridgeLift fades out up the continental slope;
     * where parting plates lie under land they open rift valleys instead (plate relief, see
     * #shapeLand).
     *
     * @returns {{u0: number, v0: number, cellsPerPixel: number, width: number, height: number, distances: Float32Array}|null}
     *   A grid holding each cell's distance to the nearest spreading boundary, or null if no two
     *   neighbouring plates pull apart.
     */
    #buildPlateRidgeField(frame, model) {
        const grid = ProceduralEngine.#ridgeGrid(frame);
        const cellSize = 1 / grid.cellsPerPixel;
        const plateOf = new Int32Array(grid.width * grid.height);

        for (let y = 0; y < grid.height; y++) {
            const meshY = Math.min(1, (y * cellSize) / frame.rootH) * (model.meshHeight - 1);
            for (let x = 0; x < grid.width; x++) {
                const meshX = Math.min(1, (x * cellSize) / frame.rootW) * (model.meshWidth - 1);
                plateOf[y * grid.width + x] = ProceduralEngine.#nearestPlate(model.plates, model.plateCount, meshX, meshY);
            }
        }

        const spreading = (own, other) => own !== other && !ProceduralEngine.#platesCollide(model.plates, own, other);
        const ridgeDistances = this.#measureRidgeDistances(grid, plateOf, spreading);

        return ridgeDistances ? { ...grid, distances: ridgeDistances } : null;
    }

    /** The plate whose seed point is nearest a position on the plate mesh. */
    static #nearestPlate(plates, plateCount, meshX, meshY) {
        let nearest = 0;
        let nearestDistance = Infinity;
        for (let plate = 0; plate < plateCount; plate++) {
            const dx = meshX - plates[plate * 4];
            const dy = meshY - plates[plate * 4 + 1];
            const distance = dx * dx + dy * dy;
            if (distance < nearestDistance) {
                nearestDistance = distance;
                nearest = plate;
            }
        }
        return nearest;
    }

    /**
     * Whether two plates are moving towards each other (their relative velocity points against
     * their relative position), the same test #calculateTectonicBoundaries uses to raise ranges.
     */
    static #platesCollide(plates, own, other) {
        const relativePosX = plates[other * 4] - plates[own * 4];
        const relativePosY = plates[other * 4 + 1] - plates[own * 4 + 1];
        const relativeVelX = plates[other * 4 + 2] - plates[own * 4 + 2];
        const relativeVelY = plates[other * 4 + 3] - plates[own * 4 + 3];
        return relativePosX * relativeVelX + relativePosY * relativeVelY < 0;
    }

    /**
     * Labels each land cell with the landmass it belongs to, counting only landmasses whose middle
     * lies at least `minimumReach` world pixels from their coast; every other cell is -1.
     */
    static #labelContinents(grid, distances, minimumReach) {
        const { width, height } = grid;
        const total = width * height;
        const landmassOf = new Int32Array(total).fill(-1);
        const visited = new Uint8Array(total);
        const stack = new Int32Array(total);
        let nextLandmass = 0;

        for (let start = 0; start < total; start++) {
            if (distances[start] <= 0 || visited[start]) continue;

            const members = [];
            let reach = 0;
            let top = 0;
            visited[start] = 1;
            stack[top++] = start;

            while (top > 0) {
                const index = stack[--top];
                members.push(index);
                if (distances[index] > reach) reach = distances[index];

                const x = index % width;
                for (const neighbour of ProceduralEngine.#gridNeighbours(index, x, width, height)) {
                    if (distances[neighbour] > 0 && !visited[neighbour]) {
                        visited[neighbour] = 1;
                        stack[top++] = neighbour;
                    }
                }
            }

            if (reach < minimumReach) continue;
            for (const index of members) landmassOf[index] = nextLandmass;
            nextLandmass++;
        }

        return landmassOf;
    }

    /** The up to four cells beside a grid cell (left, right, above, below), skipping the grid's edges. */
    static #gridNeighbours(index, x, width, height) {
        const neighbours = [];
        if (x > 0) neighbours.push(index - 1);
        if (x < width - 1) neighbours.push(index + 1);
        if (index >= width) neighbours.push(index - width);
        if (index < (height - 1) * width) neighbours.push(index + width);
        return neighbours;
    }

    /**
     * For every cell, the continent (see #labelContinents) whose land is nearest to it, or -1 if
     * there is none. Every continent cell seeds a jump flood, so each cell ends up holding its
     * nearest continent cell.
     */
    #findNearestContinent(grid, landmassOf) {
        const { width, height } = grid;
        const total = width * height;
        const seedGrid = new Int32Array(total * 2).fill(-1);

        for (let index = 0; index < total; index++) {
            if (landmassOf[index] === -1) continue;
            seedGrid[index * 2] = index % width;
            seedGrid[index * 2 + 1] = Math.floor(index / width);
        }

        const flooded = this.#runJumpFlood(seedGrid, width, height);
        const nearest = new Int32Array(total).fill(-1);
        for (let index = 0; index < total; index++) {
            const seedX = flooded[index * 2];
            if (seedX !== -1) nearest[index] = landmassOf[flooded[index * 2 + 1] * width + seedX];
        }

        return nearest;
    }

    /**
     * For every cell, the distance in world pixels to the nearest ridge line: the edge between
     * neighbouring cells whose labels (nearest continent, or plate) `isRidgeBetween` says a ridge
     * divides. Those edge cells seed a final jump flood.
     *
     * @param {function(number, number): boolean} isRidgeBetween - Whether a ridge runs between
     *   a cell with the first label and a neighbour with the second.
     * @returns {Float32Array|null} The distances, or null if no such edge exists.
     */
    #measureRidgeDistances(grid, labels, isRidgeBetween) {
        const { width, height } = grid;
        const total = width * height;
        const cellSize = 1 / grid.cellsPerPixel;
        const seedGrid = new Int32Array(total * 2).fill(-1);
        let hasRidge = false;

        for (let index = 0; index < total; index++) {
            const own = labels[index];
            const x = index % width;
            const onRidge = ProceduralEngine.#gridNeighbours(index, x, width, height).some((neighbour) => isRidgeBetween(own, labels[neighbour]));
            if (!onRidge) continue;

            seedGrid[index * 2] = x;
            seedGrid[index * 2 + 1] = Math.floor(index / width);
            hasRidge = true;
        }

        if (!hasRidge) return null;

        const flooded = this.#runJumpFlood(seedGrid, width, height);
        const distances = new Float32Array(total);
        for (let index = 0; index < total; index++) {
            const x = index % width;
            const y = Math.floor(index / width);
            distances[index] = Math.hypot(x - flooded[index * 2], y - flooded[index * 2 + 1]) * cellSize;
        }

        return distances;
    }

    /**
     * Spreads seeds across a grid with the Jump Flood Algorithm: afterwards every cell holds the
     * position of (very nearly) its nearest seed, as an x, y pair per cell in `seedGrid`, or -1
     * if the grid had no seeds at all. Two closing passes at a step of one clean up the few cells
     * the halving steps leave with a slightly-too-far seed.
     *
     * @returns {Int32Array} The flooded seed grid (a new array; the input is not modified).
     */
    #runJumpFlood(seedGrid, width, height) {
        let flooded = seedGrid;
        let step = Math.max(width, height) / 2;
        while (step >= 1) {
            step = Math.floor(step);
            flooded = this.#executeJFAPass(flooded, width, height, step);
            step /= 2;
        }

        flooded = this.#executeJFAPass(flooded, width, height, 1);
        return this.#executeJFAPass(flooded, width, height, 1);
    }

    /**
     * For every cell of the coastline grid, how far the middle of the nearest landmass lies from
     * its coast, in world pixels: the greatest distance from the coast anywhere on that
     * landmass. A small island measures a few pixels; a continent, hundreds.
     *
     * Landmasses are the connected areas of land in the grid. A land cell belongs to its own
     * landmass; a sea cell takes the landmass on the far side of its nearest stretch of coast
     * (from the jump flood's nearest boundary cell), so the value changes smoothly across the
     * coastline rather than jumping there.
     *
     * A landmass that runs off a side of the grid which cuts through the world (a regional map's
     * working area, not the top map's own edge) cannot be measured, since part of it is unseen.
     * It is treated as unbounded, as is every cell of a grid with no coastline at all.
     */
    static #measureLandmasses(grid, ownershipGrid, distanceGrid, seedGrid) {
        const { width, height, cutEdges } = grid;
        const total = width * height;
        const landmassOf = new Int32Array(total).fill(-1);
        const landmassSizes = [];
        const stack = new Int32Array(total);

        for (let start = 0; start < total; start++) {
            if (ownershipGrid[start] !== 1 || landmassOf[start] !== -1) continue;

            const landmass = landmassSizes.length;
            let reach = 0;
            let unseen = false;
            let top = 0;
            landmassOf[start] = landmass;
            stack[top++] = start;

            while (top > 0) {
                const index = stack[--top];
                const x = index % width;
                const y = (index - x) / width;
                if (distanceGrid[index] > reach) reach = distanceGrid[index];
                if ((x === 0 && cutEdges.left) || (y === 0 && cutEdges.top) || (x === width - 1 && cutEdges.right) || (y === height - 1 && cutEdges.bottom)) unseen = true;

                if (x > 0) top = ProceduralEngine.#joinLandmass(index - 1, landmass, ownershipGrid, landmassOf, stack, top);
                if (x < width - 1) top = ProceduralEngine.#joinLandmass(index + 1, landmass, ownershipGrid, landmassOf, stack, top);
                if (y > 0) top = ProceduralEngine.#joinLandmass(index - width, landmass, ownershipGrid, landmassOf, stack, top);
                if (y < height - 1) top = ProceduralEngine.#joinLandmass(index + width, landmass, ownershipGrid, landmassOf, stack, top);
            }

            landmassSizes.push(unseen ? Infinity : reach);
        }

        const landmassReach = new Float32Array(total);
        for (let index = 0; index < total; index++) {
            let landmass = landmassOf[index];

            if (landmass === -1) {
                // A sea cell: find the land beside its nearest boundary cell. Boundary cells are
                // marked where a cell differs from its right or lower neighbour, so the land is
                // the boundary cell itself or one of those two.
                const seedX = seedGrid[index * 2];
                const seedY = seedGrid[index * 2 + 1];
                if (seedX !== -1 && seedY !== -1) {
                    const seed = seedY * width + seedX;
                    if (landmassOf[seed] !== -1) landmass = landmassOf[seed];
                    else if (seedX < width - 1 && landmassOf[seed + 1] !== -1) landmass = landmassOf[seed + 1];
                    else if (seedY < height - 1 && landmassOf[seed + width] !== -1) landmass = landmassOf[seed + width];
                }
            }

            landmassReach[index] = landmass === -1 ? Infinity : landmassSizes[landmass];
        }

        return landmassReach;
    }

    /** Adds a neighbouring land cell to the landmass being traced, if it is not in one yet. */
    static #joinLandmass(index, landmass, ownershipGrid, landmassOf, stack, top) {
        if (ownershipGrid[index] !== 1 || landmassOf[index] !== -1) return top;
        landmassOf[index] = landmass;
        stack[top] = index;
        return top + 1;
    }

    /** How large the landmass nearest a world position is (see #measureLandmasses). */
    #sampleLandmassReach(field, worldX, worldY) {
        if (!field.landmassReach) return Infinity;
        const gridX = Math.round(Math.max(0, Math.min(field.width - 1, (worldX - field.u0) * field.cellsPerPixel)));
        const gridY = Math.round(Math.max(0, Math.min(field.height - 1, (worldY - field.v0) * field.cellsPerPixel)));
        return field.landmassReach[gridY * field.width + gridX];
    }

    /**
     * Creates a flat, memory-efficient binary map of land/ocean ownership, one entry per grid
     * cell, each cell tested at its world position.
     */
    #generateOwnershipGrid(grid, land) {
        const { width, height, u0, v0, cellsPerPixel } = grid;
        const ownership = new Uint8Array(width * height);

        for (let y = 0; y < height; y++) {
            const worldY = v0 + y / cellsPerPixel;
            for (let x = 0; x < width; x++) {
                ownership[y * width + x] = land(u0 + x / cellsPerPixel, worldY);
            }
        }

        return ownership;
    }

    /**
     * Reads the coastline distance field at a world position, between cells where it falls
     * between them. Positions beyond the field read its nearest edge.
     */
    #sampleCoastDistance(field, worldX, worldY) {
        const gridX = Math.max(0, Math.min(field.width - 1, (worldX - field.u0) * field.cellsPerPixel));
        const gridY = Math.max(0, Math.min(field.height - 1, (worldY - field.v0) * field.cellsPerPixel));
        return this.#bilinearSample(field.distances, field.width, field.height, gridX, gridY);
    }

    /**
     * Converts an array of coordinate objects into a flat Float32Array and calculates bounding boxes.
     */
    #compileMaskData(validMasks) {
        const compiledMasks = [];

        for (const mask of validMasks) {
            const vertexCount = mask.points.length;
            const flatCoordinates = new Float32Array(vertexCount * 2);
            const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };

            for (let i = 0; i < vertexCount; i++) {
                const ptX = mask.points[i].x;
                const ptY = mask.points[i].y;

                flatCoordinates[i * 2] = ptX;
                flatCoordinates[i * 2 + 1] = ptY;

                if (ptX < bounds.minX) bounds.minX = ptX;
                if (ptY < bounds.minY) bounds.minY = ptY;
                if (ptX > bounds.maxX) bounds.maxX = ptX;
                if (ptY > bounds.maxY) bounds.maxY = ptY;
            }

            compiledMasks.push({
                isAddOperation: mask.operation !== "subtract",
                coordinates: flatCoordinates,
                vertexCount: vertexCount,
                bounds: bounds,
            });
        }

        return compiledMasks;
    }

    /**
     * Evaluates a single pixel against all compiled masks, returning 1 for land or 0 for ocean.
     */
    #resolvePixelOwnership(x, y, compiledMasks) {
        let isInside = false;

        for (const mask of compiledMasks) {
            if (this.#isOutsideBounds(x, y, mask.bounds)) {
                continue;
            }

            if (this.#isPointInCompiledPolygon(x, y, mask.coordinates, mask.vertexCount)) {
                isInside = mask.isAddOperation;
            }
        }

        return isInside ? 1 : 0;
    }

    #isOutsideBounds(x, y, bounds) {
        return x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY;
    }

    /**
     * Highly optimised ray-casting algorithm operating directly on a flat Float32Array.
     */
    #isPointInCompiledPolygon(x, y, coordinates, vertexCount) {
        let isInside = false;

        for (let i = 0, j = vertexCount - 1; i < vertexCount; j = i++) {
            const indexI = i * 2;
            const indexJ = j * 2;

            const xi = coordinates[indexI];
            const yi = coordinates[indexI + 1];
            const xj = coordinates[indexJ];
            const yj = coordinates[indexJ + 1];

            const crossesY = yi > y !== yj > y;
            if (!crossesY) {
                continue;
            }

            const intersectX = ((xj - xi) * (y - yi)) / (yj - yi) + xi;
            if (x < intersectX) {
                isInside = !isInside;
            }
        }

        return isInside;
    }

    /**
     * Identifies boundary pixels using O(1) lookups against the cached ownership grid.
     */
    #initialiseJFABoundaries(seedGrid, ownershipGrid, width, height) {
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const index = y * width + x;

                const isInside = ownershipGrid[index] === 1;
                const isRightInside = x < width - 1 ? ownershipGrid[index + 1] === 1 : isInside;
                const isBelowInside = y < height - 1 ? ownershipGrid[index + width] === 1 : isInside;

                if (isInside !== isRightInside || isInside !== isBelowInside) {
                    const seedIndex = index * 2;
                    seedGrid[seedIndex] = x;
                    seedGrid[seedIndex + 1] = y;
                }
            }
        }
    }

    #executeJFAPass(inputGrid, width, height, step) {
        const outputGrid = new Int32Array(inputGrid.length);
        outputGrid.set(inputGrid);

        const offsets = [
            [-1, -1],
            [0, -1],
            [1, -1],
            [-1, 0],
            [1, 0],
            [-1, 1],
            [0, 1],
            [1, 1],
        ];

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                this.#processSingleJFAPixel(x, y, width, height, step, inputGrid, outputGrid, offsets);
            }
        }
        return outputGrid;
    }

    #processSingleJFAPixel(x, y, width, height, step, inputGrid, outputGrid, offsets) {
        const currentIndex = (y * width + x) * 2;
        let bestDist = Infinity;
        let bestX = inputGrid[currentIndex];
        let bestY = inputGrid[currentIndex + 1];

        if (bestX !== -1) {
            bestDist = (x - bestX) ** 2 + (y - bestY) ** 2;
        }

        for (const [dx, dy] of offsets) {
            const nx = x + dx * step;
            const ny = y + dy * step;

            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                const neighbourIndex = (ny * width + nx) * 2;
                const seedX = inputGrid[neighbourIndex];
                const seedY = inputGrid[neighbourIndex + 1];

                if (seedX !== -1 && seedY !== -1) {
                    const dist = (x - seedX) ** 2 + (y - seedY) ** 2;
                    if (dist < bestDist) {
                        bestDist = dist;
                        bestX = seedX;
                        bestY = seedY;
                    }
                }
            }
        }

        outputGrid[currentIndex] = bestX;
        outputGrid[currentIndex + 1] = bestY;
    }

    /**
     * Resolves final signed distances using O(1) lookups against the cached ownership grid.
     */
    #resolveAbsoluteDistances(seedGrid, distanceGrid, ownershipGrid, width, height, enclosedDistance = 0) {
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const index = y * width + x;
                const seedX = seedGrid[index * 2];
                const seedY = seedGrid[index * 2 + 1];

                // No coastline reached this cell (there is none in the whole grid)
                let distance = enclosedDistance;
                if (seedX !== -1 && seedY !== -1) {
                    distance = Math.hypot(x - seedX, y - seedY);
                }

                const isInside = ownershipGrid[index] === 1;
                distanceGrid[index] = isInside ? distance : -distance;
            }
        }
    }

    /**
     * Applies domain warping, tapered coastal noise, and continuous elevation blending.
     * Land/ocean ownership is guaranteed correct in the far field - no stray islands can appear
     * away from the drawn mask - but unlike the coastline itself, that guarantee is no longer
     * "noise is suppressed to zero exactly at the drawn edge". Instead, noise is allowed to move
     * the coastline within a tapered band either side of the edge (see
     * #computeEffectiveCoastDistance), so coastlineFracture actually shapes the coastline rather
     * than only bending a line that still traces the mask's own polygon.
     *
     * All noise is sampled at world positions (see generateGuidedTopography), so a regional map
     * reads the same noise as its parent at every point. Two values from the terrain frame
     * decide what differs between maps:
     *   - `resolutionScale` multiplies every setting measured in pixels (Continent Scale, the
     *     coastal band and the warp amplitude), so on a map twice the baseline size they span the
     *     same share of the world and a slider value has the same effect at any size.
     *     The fixed offsets that pick separate regions of the noise for the warp and the boundary
     *     noise are deliberately NOT scaled. Scaling them would make maps of different sizes draw
     *     the very same coastline from the same masks, but it would also move every map onto a
     *     different region of the noise from the one the legacy rules used, so a legacy map
     *     updated to these rules could never be brought back to its familiar coastline. Unscaled,
     *     an updated map keeps its bays and inlets where they were, and matches its old look once
     *     Coastline Fracture is divided by the scale (see TerrainVersion.planUpgrade); maps of
     *     different sizes still get coastlines of the same character, just not identical ones.
     *   - `detailOctaves` adds finer layers to the coastline and land detail noise, in step with
     *     how many more pixels per unit of the world this map has than the baseline.
     * Both are neutral (1 and 0) for a legacy map, which therefore generates exactly as before.
     *
     * A third, `coastalBuffers`, switches from the legacy coastal profile (Continent Scale ramp
     * plus the Continental Shelf terrace around sea level) to the current one (see
     * #shapeCoastalProfile), and stops Continent Scale from resizing the coastline noise (see
     * #coastlineNoiseScale).
     */
    #applyGuidedDetail(width, height, params, frame, field, elevationData, plates = null) {
        const generation = FILRODENSWMB.GENERATION;
        const seaLevel = params.seaLevel ?? FILRODENSWMB.DEFAULTS.SEA_LEVEL;
        const zoom = frame.zoom;
        const scale = frame.resolutionScale;
        const extraOctaves = frame.detailOctaves;

        // The elevation noise scale is stored per map (a regional map's is already divided by its
        // zoom); multiplying by the zoom converts it back to world pixels.
        const eScale = params.noise.elevation.scale * zoom;
        const eOctaves = params.noise.elevation.octaves;
        const eStretch = params.noise.elevation.stretch ?? 1.0;
        const panX = params.noise.offsetX ?? 0;
        const panY = params.noise.offsetY ?? 0;

        const fracture = params.coastlineFracture ?? generation.COASTLINE_FRACTURE;
        const coastalBand = (params.coastalBand ?? generation.COASTAL_BAND) * scale;
        const continentScale = (params.continentScale ?? generation.CONTINENT_SCALE) * scale;
        const shelfRange = params.shelfRange ?? generation.SHELF_RANGE;
        const macroScale = 1 / Math.max(frame.rootW, frame.rootH);

        const warp = {
            amplitude: generation.WARP.AMPLITUDE * scale,
            frequency: macroScale * generation.WARP.FREQUENCY_MULT,
            offsets: {
                xx: generation.WARP.OFFSETS.X.X,
                xy: generation.WARP.OFFSETS.X.Y,
                yx: generation.WARP.OFFSETS.Y.X,
                yy: generation.WARP.OFFSETS.Y.Y,
            },
        };

        // How far, in world pixels, either side of the drawn edge the coastline may wander - and
        // how strongly - before tapering back to the mask's own shape. Kept once here, outside
        // the per-pixel loop below, since none of these depend on x/y.
        const coastalVariance = generation.COASTAL_VARIANCE;
        const coastlineNoiseScale = ProceduralEngine.#coastlineNoiseScale(params, frame);
        const boundary = {
            band: coastlineNoiseScale * coastalVariance.BAND_RATIO,
            amplitude: coastlineNoiseScale * coastalVariance.AMPLITUDE_RATIO * fracture,
            noiseScale: macroScale * coastalVariance.FREQUENCY_MULT,
            offsetX: coastalVariance.NOISE_OFFSET.X,
            offsetY: coastalVariance.NOISE_OFFSET.Y,
            extraOctaves,
        };
        const coastalProfile = frame.coastalBuffers ? ProceduralEngine.#resolveCoastalProfile(params, frame) : null;
        if (coastalProfile && field.ridges) coastalProfile.ridges = ProceduralEngine.#resolveRidges(params, frame, field.ridges);
        if (coastalProfile && plates) coastalProfile.tectonics = true;

        // One reusable record of the point being shaped, filled in afresh for every pixel under
        // the current coastal profile, so the loop allocates nothing per pixel
        const pixel = { worldX: 0, worldY: 0, sampleX: 0, sampleY: 0, distance: 0, detailNoise: 0, landmassReach: 0, tectonic: 0 };

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                // Noise position in world pixels, including the map's pan, and the matching
                // position in the coastline field (world pixels without the pan)
                const worldX = (x + panX) / zoom;
                const worldY = (y + panY) / zoom;
                const fieldX = frame.originX + x / zoom;
                const fieldY = frame.originY + y / zoom;
                const index = y * width + x;

                // 1. Apply Domain Warping
                const warpX = (this.#fbm(worldX + warp.offsets.xx, worldY + warp.offsets.xy, generation.WARP.OCTAVES, warp.frequency) - 0.5) * fracture * warp.amplitude;
                const warpY = (this.#fbm(worldX + warp.offsets.yx, worldY + warp.offsets.yy, generation.WARP.OCTAVES, warp.frequency) - 0.5) * fracture * warp.amplitude;

                // 2. Sample the macro distance field at the warped position with true sub-pixel
                // (bilinear) precision, rather than snapping to the nearest whole pixel - this
                // keeps coastlineFracture's effect smooth instead of quantised to a single pixel.
                const sampleX = Math.max(0, Math.min(frame.rootW - 1, fieldX + warpX));
                const sampleY = Math.max(0, Math.min(frame.rootH - 1, fieldY + warpY));
                const macroDistance = this.#sampleCoastDistance(field, sampleX, sampleY);

                // 3. Let tapered, independent noise perturb that macro distance, so the actual
                // coastline can move organically near the drawn edge instead of only following
                // the (warped) shape of the mask itself.
                const effectiveDistance = this.#computeEffectiveCoastDistance(worldX, worldY, macroDistance, boundary);

                // 4. Base Noise & Suppression. The legacy profile reads the detail noise at the
                // warped position too. The warp bends over a few hundred pixels, far wider than
                // the finer octaves, so it stretches them into long parallel streaks that relief
                // shading shows as combed hillsides; the current profile reads the noise where
                // the pixel lies, and only the coastline (and the plates beneath it) are warped.
                const detailNoise = coastalProfile ? this.#fbm(worldX, worldY, eOctaves, eScale, extraOctaves) : this.#fbm(worldX + warpX, worldY + warpY, eOctaves, eScale, extraOctaves);

                if (coastalProfile) {
                    pixel.worldX = worldX;
                    pixel.worldY = worldY;
                    pixel.sampleX = sampleX;
                    pixel.sampleY = sampleY;
                    pixel.distance = effectiveDistance;
                    pixel.detailNoise = detailNoise;
                    pixel.landmassReach = this.#sampleLandmassReach(field, sampleX, sampleY);
                    pixel.tectonic = plates ? this.#samplePlateMesh(plates, plates.relief, frame, sampleX, sampleY) - ProceduralEngine.#PLATE_RELIEF_BASE : 0;
                    // Not clamped to 0..1 (see #shapeCoastalProfile)
                    elevationData[index] = this.#shapeCoastalProfile(pixel, seaLevel, eStretch, coastalProfile);
                    continue;
                }

                const noiseWeight = this.#smoothstep(0, coastalBand, Math.abs(effectiveDistance));

                // 5. Macro Structure (Ease-out curve mapped 0.0 to 1.0)
                const normalizedDist = Math.min(1.0, Math.abs(effectiveDistance) / continentScale);
                const structure = 1.0 - Math.pow(1.0 - normalizedDist, 2);

                // 6. Tapered Ownership Composition - effectiveDistance already carries the
                // boundary noise, so this crossing is the actual (organic) coastline.
                let finalElev;

                if (effectiveDistance >= 0) {
                    // LAND: Mathematically guaranteed to generate above seaLevel
                    let baseTexture = structure * generation.BLEND_WEIGHTS.GUIDED_MACRO + detailNoise * noiseWeight * generation.BLEND_WEIGHTS.GUIDED_DETAIL;
                    baseTexture = Math.pow(baseTexture, eStretch);
                    finalElev = seaLevel + baseTexture * (1.0 - seaLevel);
                } else {
                    // OCEAN: Mathematically guaranteed to generate below seaLevel
                    let baseTexture = structure * 0.5 + detailNoise * noiseWeight * 0.5;
                    // Capped to prevent breaching the absolute abyss limit
                    finalElev = seaLevel - baseTexture * (seaLevel * generation.OCEAN_DEPTH_CAP);
                }

                // 7. Continental Shelving
                finalElev = this.#applyContinentalShelf(finalElev, seaLevel, shelfRange);
                elevationData[index] = Math.max(0, Math.min(1, finalElev));
            }
        }
    }

    /**
     * The current coastal profile: the elevation at a point, from its distance to the coastline
     * (positive on land, negative at sea, in world pixels) and its detail noise.
     *
     * Along the coast lie two bands whose widths come from the sliders (see
     * FILRODENSWMB.GENERATION.COASTAL_PROFILE), each wandering a little along the coast so it
     * does not trace the coastline exactly:
     *   - On land, a coastal plain: low ground that rises only a little towards its inland edge
     *     and keeps some of its detail noise, so it reads as gently rolling lowland. Beyond it
     *     the land rises to its full height over Continent Scale, on the same curve the legacy
     *     profile uses, so a Coastal Plains width of 0 gives exactly the legacy land shape.
     *   - At sea, a continental shelf: shallow water that deepens only a little towards its
     *     outer edge. Beyond it the seabed falls steeply down the continental slope and levels
     *     out into the abyssal plain, which carries only gentle noise, so deep water stays deep.
     *
     * Continent Scale sets how quickly the land rises once past the plain, and Ocean Scale how
     * quickly the seabed falls once past the shelf; neither does anything else.
     *
     * A landmass smaller than that is never far enough from its coast to rise fully, so small
     * islands would stay almost flat. Instead the land rises over the landmass's own size when
     * that is shorter (`landmassReach`, see #measureLandmasses), and its coastal plain takes up
     * no more than a set share of it, so an island of any size has hills and a high point while a
     * continent keeps the broad slopes Continent Scale gives it.
     *
     * Out on the abyssal plain, mid-ocean ridges rise between continents (see #ridgeLift).
     *
     * The profile aims to keep terrain between 0 and 1, and guided terrain stays there (give or
     * take a hair where the detail noise peaks). It is not a hard limit, though: where tectonic
     * plates collide under land that has already reached its full height, the range they raise
     * may climb past 1, and a trench under the deepest seabed may cut below 0. Clamping instead
     * would flatten those into plateaus (which the rivers then fill as lakes). The rest of the
     * module already handles elevations outside 0 to 1, since terrain edits can take the land
     * there too.
     *
     * @param {{worldX: number, worldY: number, sampleX: number, sampleY: number, distance: number,
     *   detailNoise: number, landmassReach: number}} pixel - The point being shaped: its noise
     *   position, its warped position in the coastline fields, its distance to the coastline
     *   (positive on land), its detail noise and the size of its nearest landmass.
     */
    #shapeCoastalProfile(pixel, seaLevel, stretch, profile) {
        const settings = FILRODENSWMB.GENERATION.COASTAL_PROFILE;
        const offset = settings.BUFFER_VARIATION_OFFSET;
        const reach = Math.abs(pixel.distance);

        // Where along the coast the bands are wider or narrower than the slider says
        const widthFactor = profile.variesWidth ? 1 + (this.#fbm(pixel.worldX + offset.X, pixel.worldY + offset.Y, settings.BUFFER_VARIATION_OCTAVES, profile.variationScale) - 0.5) * 2 * settings.BUFFER_VARIATION : 1;
        const nearCoast = this.#smoothstep(0, profile.coastalBand, reach);

        if (pixel.distance >= 0) return this.#shapeLand(pixel, reach, widthFactor, nearCoast, seaLevel, stretch, profile);

        // Keep every sea pixel below sea level, however the noise falls
        const minimumDepth = 0.002;
        const depth = this.#shapeSeabed(pixel, reach, widthFactor, nearCoast, profile);
        return seaLevel - Math.max(minimumDepth, depth) * profile.oceanDepth;
    }

    /** The land side of the current coastal profile (see #shapeCoastalProfile). */
    #shapeLand(pixel, reach, widthFactor, nearCoast, seaLevel, stretch, profile) {
        const settings = FILRODENSWMB.GENERATION.COASTAL_PROFILE;
        const landmassReach = pixel.landmassReach;
        const plainWidth = Math.min(profile.plainWidth * widthFactor, landmassReach * settings.PLAIN_SHARE_OF_LANDMASS);
        const plainRise = plainWidth > 0 ? settings.PLAIN_RISE : 0;
        const riseLength = Math.min(profile.continentScale, Math.max(profile.minimumRise, (landmassReach - plainWidth) * settings.LANDMASS_RISE_FACTOR));
        let structure;

        if (reach < plainWidth) {
            const across = reach / plainWidth;
            structure = plainRise * across * across * (3 - 2 * across);
        } else {
            const beyond = riseLength > 0 ? Math.min(1, (reach - plainWidth) / riseLength) : 1;
            structure = plainRise + (1 - plainRise) * (1 - Math.pow(1 - beyond, 2));
        }

        // Detail fades in from the coast as in the legacy profile, but only partly across
        // the plain; the rest arrives once past the plain's inland edge.
        const pastPlain = this.#smoothstep(plainWidth, plainWidth + profile.coastalBand, reach);
        const noiseWeight = settings.PLAIN_DETAIL * nearCoast + (1 - settings.PLAIN_DETAIL) * pastPlain;

        // Plate boundaries (tectonic terrain only): ranges where plates collide, rift valleys
        // where they part, kept off the coastal plain like the rest of the relief
        const plateRelief = profile.tectonics ? pixel.tectonic * FILRODENSWMB.GENERATION.TECTONICS_V2.RIDGE_WEIGHT * pastPlain : 0;

        const blendWeights = FILRODENSWMB.GENERATION.BLEND_WEIGHTS;
        const baseTexture = Math.pow(Math.max(0, structure * blendWeights.GUIDED_MACRO + pixel.detailNoise * noiseWeight * blendWeights.GUIDED_DETAIL + plateRelief), stretch);

        // Keep every land pixel clearly above sea level. Right at the coast the height can be
        // so small that storing it as a 32-bit float rounds it down onto sea level, which
        // would turn it into sea; how often that happens would then depend on the band
        // widths, and they must never move the coastline.
        const minimumHeight = 0.0001;
        return seaLevel + Math.max(minimumHeight, baseTexture) * (1.0 - seaLevel);
    }

    /**
     * The sea side of the current coastal profile (see #shapeCoastalProfile), as a share of the
     * full ocean depth: shelf, then continental slope, then abyssal plain, with any mid-ocean
     * ridge rising from the abyssal plain.
     */
    #shapeSeabed(pixel, reach, widthFactor, nearCoast, profile) {
        const settings = FILRODENSWMB.GENERATION.COASTAL_PROFILE;
        const shelfWidth = profile.shelfWidth * widthFactor;
        const shelfEdgeDepth = shelfWidth > 0 ? settings.SHELF_DEPTH : 0;

        if (reach < shelfWidth) {
            return shelfEdgeDepth * (reach / shelfWidth) + (pixel.detailNoise - 0.5) * settings.SHELF_NOISE * nearCoast;
        }

        const slopeLength = profile.oceanScale * settings.SLOPE_REACH;
        const beyond = slopeLength > 0 ? Math.min(1, (reach - shelfWidth) / slopeLength) : 1;
        const descent = 1 - Math.pow(1 - beyond, settings.SLOPE_EXPONENT);
        const noise = (pixel.detailNoise - 0.5) * (settings.SHELF_NOISE + settings.ABYSS_NOISE * descent) * nearCoast;
        const depth = shelfEdgeDepth + (settings.ABYSS_DEPTH - shelfEdgeDepth) * descent + noise;

        const trench = profile.tectonics ? this.#plateTrench(pixel.tectonic, descent) : 0;
        const ridge = profile.ridges && descent > 0 ? this.#ridgeLift(pixel, descent, profile.ridges) : 0;
        return depth + trench - ridge;
    }

    /**
     * How much deeper colliding plates cut the seabed at a point, as a share of the full ocean
     * depth: a trench along the boundary, fading out up the continental slope (`descent`).
     * Plates pulling apart raise mid-ocean ridges instead, which #ridgeLift shapes.
     */
    #plateTrench(tectonic, descent) {
        const settings = FILRODENSWMB.GENERATION.TECTONICS_V2;
        const collision = Math.max(0, tectonic) / settings.CONVERGENT_RELIEF;
        return settings.TRENCH_DEPTH * collision * descent;
    }

    /**
     * Everything the mid-ocean ridges need that stays the same across the whole map, in world
     * pixels and shares of the full ocean depth, worked out once per generation.
     */
    static #resolveRidges(params, frame, field) {
        const settings = FILRODENSWMB.GENERATION.COASTAL_PROFILE.OCEAN_RIDGES;
        const scale = frame.resolutionScale;

        const hills = settings.ABYSSAL_HILLS;
        const strength = ProceduralEngine.#ridgeStrengthOf(params);

        return {
            field,
            height: strength * settings.HEIGHT,
            halfWidth: settings.HALF_WIDTH * scale,
            riftWidth: settings.RIFT_WIDTH * scale,
            wander: settings.WANDER * scale,
            wanderScale: 1 / (settings.WANDER_LENGTH * scale),
            heightScale: 1 / (settings.HEIGHT_VARIATION_LENGTH * scale),
            // Finer layers on the wander and the hills wherever there are more pixels to the
            // world (a regional map, or a top map larger than the baseline), as for the coastline
            extraOctaves: frame.detailOctaves,
            hills: {
                height: strength * hills.HEIGHT,
                reach: settings.HALF_WIDTH * hills.REACH * scale,
                acrossScale: 1 / (hills.WAVELENGTH * scale),
                alongScale: 1 / (hills.ALONG_LENGTH * scale),
            },
        };
    }

    /**
     * How far a mid-ocean ridge lifts the seabed at a point, as a share of the full ocean depth.
     *
     * The crest follows the ridge line (see #buildRidgeField), wandering from side to side with
     * noise so it is never a clean Voronoi edge (with fine layers, so it kinks as well as bends),
     * and rising higher or lower along its length. Its flanks fall away with the square root of
     * the distance from the crest (steep at first, then easing out into the abyssal plain), much
     * as a real ridge's flanks deepen as the new seabed spreading from it cools. A narrow rift
     * valley runs down the crest itself, and abyssal hills ridge the flanks and the plain beyond
     * them (see #abyssalHills).
     *
     * The lift fades out with the continental slope (`descent` from 0 at the shelf edge to 1 on
     * the abyssal plain, squared), so a ridge never climbs the slope or reaches the shelf where
     * two continents lie close together.
     */
    #ridgeLift(pixel, descent, ridges) {
        const settings = FILRODENSWMB.GENERATION.COASTAL_PROFILE.OCEAN_RIDGES;
        const offset = settings.NOISE_OFFSET;
        const extraOctaves = ridges.extraOctaves;
        const wanderX = (this.#fbm(pixel.worldX + offset.X, pixel.worldY + offset.Y, settings.WANDER_OCTAVES, ridges.wanderScale, extraOctaves) - 0.5) * 2 * ridges.wander;
        const wanderY = (this.#fbm(pixel.worldX + offset.Y, pixel.worldY - offset.X, settings.WANDER_OCTAVES, ridges.wanderScale, extraOctaves) - 0.5) * 2 * ridges.wander;
        const distance = this.#sampleCoastDistance(ridges.field, pixel.sampleX + wanderX, pixel.sampleY + wanderY);
        if (distance >= Math.max(ridges.halfWidth, ridges.hills.reach)) return 0;

        const hills = this.#abyssalHills(pixel, distance, ridges);
        if (distance >= ridges.halfWidth) return hills * descent * descent;

        const flank = 1 - Math.sqrt(distance / ridges.halfWidth);
        const rift = settings.RIFT_DEPTH * (1 - this.#smoothstep(0, ridges.riftWidth, distance));
        const heightNoise = this.#fbm(pixel.worldX - offset.X, pixel.worldY + offset.Y, settings.HEIGHT_VARIATION_OCTAVES, ridges.heightScale);
        const heightFactor = 1 + (heightNoise - 0.5) * 2 * settings.HEIGHT_VARIATION;

        return (ridges.height * Math.max(0, flank - rift) * heightFactor + hills) * descent * descent;
    }

    /**
     * Abyssal hills at a point `distance` from a ridge's crest, as a share of the full ocean depth:
     * low, narrow hills running parallel to the ridge, as real seabed breaks into long blocks
     * while it spreads away from the crest.
     *
     * The noise is read across the ridge at the distance from the crest, so its bands follow the
     * crest however it curves. Along the ridge it is read at a slowly changing second coordinate
     * (low-frequency noise over the map), so each band ends after a while and the next begins,
     * rather than running the whole length of the ridge. The hills only ever raise the seabed,
     * and fade out towards `reach` and over the rift valley at the crest.
     */
    #abyssalHills(pixel, distance, ridges) {
        const hills = ridges.hills;
        if (!(hills.height > 0) || distance >= hills.reach) return 0;

        const settings = FILRODENSWMB.GENERATION.COASTAL_PROFILE.OCEAN_RIDGES.ABYSSAL_HILLS;
        const offset = settings.NOISE_OFFSET;
        const along = (this.#fbm(pixel.worldX + offset.X, pixel.worldY + offset.Y, 2, hills.alongScale) - 0.5) * 2 * settings.ALONG_SPAN;
        // Both coordinates are in units of one hill (across) and one hill's length (along)
        const bands = this.#fbm(distance * hills.acrossScale + offset.Y, along, settings.OCTAVES, 1, ridges.extraOctaves);

        const fadeOut = 1 - this.#smoothstep(hills.reach * 0.6, hills.reach, distance);
        const fadeIn = this.#smoothstep(0, ridges.riftWidth * 2, distance);
        return hills.height * bands * fadeOut * fadeIn;
    }

    /**
     * Perturbs a macro coastline distance (from the guided-mode JFA distance field) with
     * independent, tapered noise. The perturbation is strongest exactly at the drawn edge and
     * fades to zero over `boundary.band`, via the same smoothstep-based taper used elsewhere in
     * this file - so land/ocean ownership, and the coastal shelving maths that depends on a
     * stable far-field crossing, are completely unaffected beyond that band. Only the zone
     * immediately around the drawn edge, inside and out, can actually move.
     *
     * @param {object} boundary - Band, amplitude, noise scale, noise offsets and extra octaves,
     *   all resolved once per generation by #applyGuidedDetail.
     */
    #computeEffectiveCoastDistance(worldX, worldY, macroDistance, boundary) {
        const coastalVariance = FILRODENSWMB.GENERATION.COASTAL_VARIANCE;
        const boundaryNoise = this.#fbm(worldX + boundary.offsetX, worldY + boundary.offsetY, coastalVariance.OCTAVES, boundary.noiseScale, boundary.extraOctaves);
        const boundaryTaper = 1.0 - this.#smoothstep(0, boundary.band, Math.abs(macroDistance));

        return macroDistance + (boundaryNoise - 0.5) * 2 * boundary.amplitude * boundaryTaper;
    }

    /**
     * Blending logic for seamless interpolation across tectonic generation mode.
     */
    #blendElevations(oceanElev, landElev, maskVal) {
        return oceanElev * (1.0 - maskVal) + landElev * maskVal;
    }

    /**
     * Applies terracing to the coastal shelf to flatten beaches.
     * Declared as a private class method to resolve SonarQube scope errors.
     */
    #applyContinentalShelf(elevation, seaLevel, shelfRange) {
        const MIN_SHELF = seaLevel - shelfRange;
        const MAX_SHELF = seaLevel + shelfRange;

        if (elevation > MIN_SHELF && elevation < MAX_SHELF) {
            let shelfLerp = (elevation - seaLevel) / shelfRange;
            shelfLerp = shelfLerp * shelfLerp * shelfLerp;
            return seaLevel + shelfLerp * shelfRange;
        }

        return elevation;
    }

    /**
     * How far, in pixels, the climate pass looks upwind along a row for the elevation that
     * decides how much rain a pixel gets (the "Western Horizon" sampling below). It is the wind
     * distance setting scaled to the map's width and to how much of the globe the map spans.
     *
     * The distance is also how far from a changed pixel the moisture can change: a pixel reads
     * the elevation at most this many columns away on its own row, so a bounded climate refresh
     * has to recompute that many columns beyond the edited area on either side.
     *
     * @param {number} width - Map width in pixels.
     * @param {object} params - Derived map parameters.
     * @returns {number} Maximum upwind sampling distance, in whole pixels.
     */
    static getWindDistance(width, params) {
        const baseWind = params.climate?.windDistance ?? FILRODENSWMB.CLIMATE.WIND_DISTANCE;
        const widthScale = width / FILRODENSWMB.LIMITS.BASELINE_DIMENSION;
        const latTop = params.latTop ?? FILRODENSWMB.DEFAULTS.LAT_TOP;
        const latBottom = params.latBottom ?? FILRODENSWMB.DEFAULTS.LAT_BOTTOM;
        const latRange = Math.max(0.1, Math.abs(latTop - latBottom));
        const latScale = 180 / latRange;

        return Math.round(baseWind * widthScale * latScale);
    }

    /**
     * Calculates moisture and temperature based on the final topography.
     * Applies globally deterministic Orographic Lift via Western Horizon sampling.
     *
     * The per-pixel work lives in getMoistureAt and getTemperatureAt, which read the settings
     * prepared once here by prepareClimate. The same pair lets a caller work out the climate of
     * individual pixels under different settings without allocating map-sized output buffers
     * (see TerrainUpgrade), and guarantees both paths give exactly the same numbers.
     */
    generateClimateData(elevationData, width, height, params, outMoisture, outTemperature, bounds = null) {
        const moistureData = outMoisture;
        const temperatureData = outTemperature;

        const climateBounds = ProceduralEngine.resolveBounds(bounds, width, height);
        const climate = this.prepareClimate(width, height, params);

        for (let y = climateBounds.minY; y <= climateBounds.maxY; y++) {
            for (let x = climateBounds.minX; x <= climateBounds.maxX; x++) {
                const index = y * width + x;
                moistureData[index] = this.getMoistureAt(climate, elevationData, x, y);
                temperatureData[index] = this.getTemperatureAt(climate, elevationData, x, y);
            }
        }
        return { moistureData, temperatureData };
    }

    /**
     * Resolves everything the climate of a pixel depends on that is the same for every pixel of
     * the map, so getMoistureAt and getTemperatureAt do not repeat it per pixel.
     *
     * @param {number} width - Map width in pixels.
     * @param {number} height - Map height in pixels.
     * @param {object} params - Derived map parameters.
     * @returns {object} Settings to pass to getMoistureAt and getTemperatureAt.
     */
    prepareClimate(width, height, params) {
        const latTop = params.latTop ?? FILRODENSWMB.DEFAULTS.LAT_TOP;
        const latBottom = params.latBottom ?? FILRODENSWMB.DEFAULTS.LAT_BOTTOM;

        return {
            width,
            height,
            seaLevel: params.seaLevel,
            windDistance: ProceduralEngine.getWindDistance(width, params),
            latTop,
            latRange: Math.max(0.1, Math.abs(latTop - latBottom)),
            panX: params.noise.offsetX ?? 0,
            panY: params.noise.offsetY ?? 0,
            mScale: params.noise.moisture.scale,
            mOctaves: params.noise.moisture.octaves,
            globalMoisture: params.globalMoisture ?? FILRODENSWMB.DEFAULTS.GLOBAL_MOISTURE,
            tScale: params.noise.temperature.scale ?? 1 / FILRODENSWMB.NOISE.TEMPERATURE.SCALE,
            tOctaves: params.noise.temperature.octaves ?? FILRODENSWMB.NOISE.TEMPERATURE.OCTAVES,
            globalTemp: params.globalTemp ?? FILRODENSWMB.DEFAULTS.GLOBAL_TEMP,
            seasonOffset: params.seasonOffset ?? 0,
            moistureOffset: params.noise.moistureOffset ?? FILRODENSWMB.NOISE.OFFSET_MOISTURE,
            tempOffset: params.noise.tempOffset ?? FILRODENSWMB.NOISE.OFFSET_TEMP,
            altCooling: params.climate?.altCooling ?? FILRODENSWMB.CLIMATE.ALTITUDE_COOLING,
            // Finer moisture and temperature detail for a zoomed-in regional map, matching the
            // extra terrain detail generateTopography adds, so biome borders gain detail instead
            // of being the parent map's outlines magnified; 0 for any other map
            extraOctaves: params.terrain?.extraOctaves ?? 0,
        };
    }

    /**
     * The latitude, in degrees, of a row of the map.
     */
    #latitudeAt(climate, y) {
        return climate.latTop - (y / climate.height) * climate.latRange;
    }

    /**
     * The moisture of one pixel: noise shifted by the global moisture setting, plus orographic
     * lift on land (rising ground relative to the ground upwind catches more rain, falling ground
     * lies in a rain shadow). Clamped to 0..1.
     *
     * @param {object} climate - Settings from prepareClimate.
     * @param {Float32Array} elevationData - Elevation of the whole map.
     * @param {number} x - Pixel column.
     * @param {number} y - Pixel row.
     * @returns {number} Moisture, 0..1.
     */
    getMoistureAt(climate, elevationData, x, y) {
        const worldX = x + climate.panX;
        const worldY = y + climate.panY;
        const moistureNoise = this.#fbm(worldX + climate.moistureOffset, worldY + climate.moistureOffset, climate.mOctaves, climate.mScale, climate.extraOctaves);
        let baseMoisture = moistureNoise + (climate.globalMoisture - 0.5);
        const elevation = elevationData[y * climate.width + x];

        if (elevation > climate.seaLevel) {
            const absLat = Math.abs(this.#latitudeAt(climate, y));
            const windCellBlend = Math.cos(absLat * (Math.PI / 45));

            // Use the dynamically scaled wind distance
            const windDirectionX = climate.windDistance * windCellBlend;

            const upwindX = Math.max(0, Math.min(climate.width - 1, Math.round(x + windDirectionX)));
            const upwindElev = elevationData[y * climate.width + upwindX];

            const slope = elevation - upwindElev;
            baseMoisture += slope * 3;
        }

        return Math.max(0, Math.min(1, baseMoisture));
    }

    /**
     * The temperature of one pixel: mostly latitude, varied by noise, shifted by the global
     * temperature and season settings, and cooled with altitude on land. Clamped to 0..1.
     *
     * @param {object} climate - Settings from prepareClimate.
     * @param {Float32Array} elevationData - Elevation of the whole map.
     * @param {number} x - Pixel column.
     * @param {number} y - Pixel row.
     * @returns {number} Temperature, 0..1.
     */
    getTemperatureAt(climate, elevationData, x, y) {
        const currentLat = this.#latitudeAt(climate, y);
        const latGradient = 1 - Math.abs(currentLat) / 90;
        const seasonImpact = (currentLat / 90) * climate.seasonOffset * 0.35;

        const worldX = x + climate.panX;
        const worldY = y + climate.panY;
        const tempNoise = this.#fbm(worldX + climate.tempOffset, worldY + climate.tempOffset, climate.tOctaves, climate.tScale, climate.extraOctaves);
        let temperature = latGradient * 0.75 + tempNoise * 0.25;
        temperature += climate.globalTemp - 0.3;
        temperature += seasonImpact;

        const elevation = elevationData[y * climate.width + x];
        if (elevation > climate.seaLevel) {
            const altitude = (elevation - climate.seaLevel) / (1 - climate.seaLevel);
            temperature -= altitude * climate.altCooling;
        }

        return Math.max(0, Math.min(1, temperature));
    }

    colorize(elevationData, temperatureData, width, height, seaLevel, waterMask, params, outBuffer, bounds = null, maxPeak = 1.0, minTrough = 0.0) {
        const pixelBuffer = outBuffer;
        const baseBounds = ProceduralEngine.resolveBounds(bounds, width, height);
        const renderBounds = ProceduralEngine.getRepaintBounds(baseBounds, width, height);
        const relief = ProceduralEngine.#resolveReliefShading(params, width, height);

        for (let y = renderBounds.minY; y <= renderBounds.maxY; y++) {
            for (let x = renderBounds.minX; x <= renderBounds.maxX; x++) {
                const i = y * width + x;
                const elevation = elevationData[i];
                const bufferIndex = i * 4;

                if (elevation < seaLevel) {
                    this.#paintOceanPixel(pixelBuffer, bufferIndex, elevation, seaLevel, minTrough);
                } else if (waterMask && waterMask[i] > 0) {
                    const temp = temperatureData ? temperatureData[i] : 1;
                    this.#paintLakePixel(pixelBuffer, bufferIndex, elevation, waterMask[i], temp, params);
                    // A lake's surface is flat, so it is left unshaded
                    continue;
                } else {
                    // Use the dynamic map peak instead of the hardcoded 1.0
                    this.#paintLandPixel(pixelBuffer, bufferIndex, elevation, seaLevel, maxPeak);
                }

                if (relief) ProceduralEngine.#shadeRelief(pixelBuffer, bufferIndex, elevationData, x, y, width, height, relief);
            }
        }
        return pixelBuffer;
    }

    /**
     * Everything relief shading needs that stays the same across the whole map, or null when it
     * is switched off (see #shadeRelief).
     *
     * Slopes are measured per pixel of a BASELINE_DIMENSION map rather than per pixel of this
     * map, so the same terrain is shaded equally strongly at any size or zoom: a 4000 pixel map,
     * or a x4 regional map, spreads each slope over four times as many pixels, which would
     * otherwise make it look four times flatter. The map at the top of the chain of crops sets
     * that scale (params.terrain.world); a map without one is its own top map.
     *
     * @returns {{strength: number, slopeScale: number, lightX: number, lightY: number, lightZ: number}|null}
     */
    static #resolveReliefShading(params, width, height) {
        const display = FILRODENSWMB.DISPLAY;
        const strength = params?.display?.reliefShading ?? display.RELIEF_SHADING;
        if (!(strength > 0)) return null;

        const world = params?.terrain?.world;
        const rootSize = world ? Math.max(world.rootW, world.rootH) : Math.max(width, height);
        const pixelsPerBaseline = ((world?.zoom ?? 1) * rootSize) / FILRODENSWMB.LIMITS.BASELINE_DIMENSION;

        // The light's direction is a fixed compass bearing (0 from the north, the top of the map,
        // turning clockwise), and it shines down from RELIEF.ALTITUDE degrees above the horizon
        const bearing = (display.LIGHT_DIRECTION * Math.PI) / 180;
        const altitude = (display.RELIEF.ALTITUDE * Math.PI) / 180;

        return {
            strength,
            slopeScale: display.RELIEF.EXAGGERATION * pixelsPerBaseline,
            lightX: Math.sin(bearing) * Math.cos(altitude),
            lightY: -Math.cos(bearing) * Math.cos(altitude),
            lightZ: Math.sin(altitude),
        };
    }

    /**
     * Relief shading: brightens slopes that face the light and darkens those that face away, so
     * the shape of the ground shows as well as its height. Without it, a pixel's shade depends
     * on its height alone, and hills a little higher than their surroundings are only a little
     * lighter, so fine detail blends into soft gradients.
     *
     * The slope comes from the heights either side of the pixel (clamped at the map's edges).
     * Flat ground keeps exactly its unshaded colour: the brightness is scaled by how much more
     * or less directly the ground faces the light than flat ground does, so turning shading on
     * leaves plains and still water as they were and only brings out the slopes. The sea floor
     * is shaded too, which shows its ridges, trenches and continental slopes under the water.
     */
    static #shadeRelief(pixelBuffer, bufferIndex, elevationData, x, y, width, height, relief) {
        const settings = FILRODENSWMB.DISPLAY.RELIEF;
        const row = y * width;
        const left = elevationData[row + Math.max(0, x - 1)];
        const right = elevationData[row + Math.min(width - 1, x + 1)];
        const up = elevationData[Math.max(0, y - 1) * width + x];
        const down = elevationData[Math.min(height - 1, y + 1) * width + x];

        // The surface normal of the ground, from its slope across and down the map
        const slopeX = ((right - left) / 2) * relief.slopeScale;
        const slopeY = ((down - up) / 2) * relief.slopeScale;
        const facing = (-slopeX * relief.lightX - slopeY * relief.lightY + relief.lightZ) / Math.hypot(slopeX, slopeY, 1);

        const change = ((facing - relief.lightZ) / relief.lightZ) * relief.strength;
        const factor = Math.max(settings.MIN_FACTOR, Math.min(settings.MAX_FACTOR, 1 + change));

        pixelBuffer[bufferIndex] = Math.min(255, pixelBuffer[bufferIndex] * factor);
        pixelBuffer[bufferIndex + 1] = Math.min(255, pixelBuffer[bufferIndex + 1] * factor);
        pixelBuffer[bufferIndex + 2] = Math.min(255, pixelBuffer[bufferIndex + 2] * factor);
    }

    /**
     * Shades an ocean pixel darker the deeper it is, normalised against the map's discovered
     * lowest point (minTrough) rather than a fixed floor of 0 - the same pattern #paintLandPixel
     * already uses for its ceiling, with maxPeak. On every map where nothing has carved elevation
     * below 0, minTrough is exactly 0 and this produces the same result it always has: depth
     * reaches 1 (the darkest shade) exactly at elevation 0. Once a hand-carved trench pushes
     * minTrough below 0, ordinary seafloor at elevation 0 no longer maxes out the shade - it
     * reads as partway to the discovered trough - so a deliberately deepened trench still reads
     * as visibly deeper than ordinary ocean instead of saturating to the same darkest blue as
     * everything else at or below the old floor.
     */
    #paintOceanPixel(pixelBuffer, bufferIndex, elevation, seaLevel, minTrough = 0.0) {
        // The trough tracked by ProceduralOrchestrator.planRepaint starts at 0 and is only ever
        // lowered, so it should never be positive - but a positive value here would shrink the
        // shading range instead of extending it, which is the wrong direction. Floor it at 0 as a
        // defensive guard, so a caller passing a stale or unexpected value can only ever be
        // ignored (falling back to the pre-trough range of [0, seaLevel]), never make the shading
        // range invalid. Also guards the seaLevel === trough edge case: that range would be empty,
        // but it can only arise with no actual ocean on the map, since any real ocean pixel's
        // elevation is by definition below seaLevel and no lower than the discovered trough.
        const trough = Math.min(0, minTrough);
        const range = seaLevel - trough;
        const depth = range > 0 ? (seaLevel - elevation) / range : 0;
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

    /**
     * Fractal Brownian motion: layered simplex noise, each octave at double the frequency and
     * half the amplitude of the one before, normalised to roughly 0..1 (see below for the edges).
     *
     * `extraOctaves` adds finer layers beyond `octaves` (used by regional maps to fill in terrain,
     * moisture and temperature detail, see TerrainVersion.getExtraOctaves). They are deliberately
     * left out of the normalising total: normalising by the larger total would shrink every
     * coarser layer slightly and shift the large-scale shape the parent map shows, whereas
     * excluding them keeps the coarse layers exactly as they were and lets the extra layers add
     * small variation on top.
     *
     * The result is only floored at 0, never capped at 1, with or without extra layers. The
     * simplex noise can already take the normalised sum slightly past 1 on its own, and the
     * highest peaks (and their snow) come from exactly those values, so capping the extra-layer
     * case would flatten a regional map's mountain tops that its parent map shows. With no extra
     * layers the result is exactly what it has always been.
     */
    #fbm(x, y, octaves, scale, extraOctaves = 0) {
        let total = 0;
        let frequency = scale;
        let amplitude = 1;
        let maxAmplitude = 0;

        for (let i = 0; i < octaves + extraOctaves; i++) {
            const noiseVal = this.simplex.noise2D(x * frequency, y * frequency);
            total += noiseVal * amplitude;
            if (i < octaves) maxAmplitude += amplitude;
            amplitude *= 0.5;
            frequency *= 2;
        }

        return Math.max(0, (total / maxAmplitude + 1) / 2);
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

    /**
     * Deliberately keeps depth relative to seaLevel alone, unlike #paintOceanPixel's shading,
     * which also normalises against the map's discovered lowest point. This is a binary
     * classification (past the halfway point or not), not a continuous shade, so a trench well
     * below the old floor still correctly reads past 0.5 and classifies as DEEP_OCEAN with no
     * need to know how much further down the trough actually goes.
     */
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
     * Decides which biome a pixel resolves to and whether it should render as water, in
     * priority order: a hand-painted override always wins; failing that, a matching custom
     * auto-generation rule (see BiomeRuleEngine); failing that, the built-in default via
     * getBiomeKey(). BrushEngine's own paint guard (#stampBiome) never lets a custom
     * biome be hand-painted below sea level in the first place, so a custom biome only ever
     * ends up there via a rule match here.
     *
     * By default a rule-matched custom biome below sea level still counts as water, exactly
     * like DEEP_OCEAN/SHALLOW_OCEAN below, so the biome layer stays transparent and the
     * topography layer's own elevation-based water rendering (ProceduralEngine.colorize)
     * shows through underneath, rather than the custom biome's flat colour hiding it. A biome
     * can opt out of that via its own `solidOverWater` flag (the Add/Edit Custom Biome dialogue's
     * checkbox, compiled into the sparse `solidOverWater` id->true map below by
     * MapStateManager.getDerivedMapParameters) - exactly like the built-in PACK_ICE biome,
     * which has always rendered as a solid colour over water rather than transparently. This
     * matters for a biome meant to represent something visible on top of water, like pack ice
     * or a floating landmass, rather than the water itself.
     *
     * An override only wins if `biomePalette` can still resolve it to a colour. Deleting a
     * custom biome (MapDialogManager#onDeleteCustomBiome) deliberately leaves its old ID sitting
     * in painted pixels and brush strokes rather than scrubbing it out everywhere, so undo/redo
     * only ever has to snapshot uiState.customBiomes and never needs to touch raster data at all
     * - bringing the biome back (by undo, or a fresh biome that happens to reuse the ID) makes
     * the old paint reappear on its own. The other side of that deal is here: an override ID
     * that doesn't currently resolve to anything is treated exactly like "never painted" and
     * falls through to a custom rule match or the built-in default, instead of the caller
     * falling back to a solid black square (params?.biomePalette?.[lookupKey] ?? ... ?? [0,0,0]
     * in createBiomesMap) for a colour that will never exist. Built-in water IDs (1/2) are
     * checked before consulting the palette at all, since they're never user-deletable and
     * render transparently regardless of colour (see the `isWater` short-circuit below).
     * @param {object} [biomePalette] - id/name -> RGB map for the map's current biomes (built-in
     * plus custom), as compiled fresh every repaint by MapStateManager.getDerivedMapParameters.
     * @param {object} [solidOverWater] - sparse custom-biome-id -> true map of biomes that render
     * solid rather than transparent below sea level, compiled the same way as biomePalette.
     * @returns {{lookupKey: (string|number), isWater: boolean, isFallback: boolean}} `isFallback`
     * is true only for the last branch below (getBiomeKey()'s built-in default) - a hand-painted
     * override or a matching custom rule both count as "covered" and set it false, even when the
     * matched custom biome turns out to render as water. This is what the "Preview Rule
     * Coverage" highlight (MapStudioApp's hover button, see createBiomesMap's optional
     * `outFallbackBuffer` below) tints: exactly the pixels a GM's custom rule set doesn't reach.
     */
    static resolveBiomeLookup(overrideId, elevation, moisture, temp, seaLevel, waterMask, pixelIndex, customBiomeRules, biomePalette, solidOverWater) {
        if (overrideId === 1 || overrideId === 2) {
            return { lookupKey: overrideId, isWater: true, isFallback: false };
        }
        if (overrideId > 0 && biomePalette?.[overrideId]) {
            return { lookupKey: overrideId, isWater: false, isFallback: false };
        }

        const customId = customBiomeRules ? BiomeRuleEngine.matchBiomeId(customBiomeRules, elevation, moisture, temp) : 0;
        if (customId > 0) {
            return { lookupKey: customId, isWater: solidOverWater?.[customId] ? false : elevation < seaLevel, isFallback: false };
        }

        const lookupKey = ProceduralEngine.getBiomeKey(elevation, moisture, temp, seaLevel);
        const isWater = lookupKey === "DEEP_OCEAN" || lookupKey === "SHALLOW_OCEAN" || (waterMask && waterMask[pixelIndex] > 0);
        return { lookupKey, isWater, isFallback: true };
    }

    /**
     * VISUAL PASS: Evaluates Temp and Moisture to paint a climate biome map.
     *
     * @param {Uint8Array} [outFallbackBuffer] - optional companion RGBA buffer, same dimensions
     * as `outBuffer`. When supplied, every pixel visited also gets tagged here: fully opaque in
     * FILRODENSWMB.DISPLAY.FALLBACK_HIGHLIGHT_COLOR/ALPHA where resolveBiomeLookup's `isFallback`
     * came back true (no override, no custom rule - the built-in default did the work), fully
     * transparent everywhere else. This is a free byproduct of the same per-pixel loop below, not
     * a second pass - see MapStudioApp's "Preview Rule Coverage" hover button, which just
     * toggles this buffer's own canvas layer visible/hidden rather than recomputing anything.
     * Left `null` (the default) for callers that don't need the preview - the 3D view
     * generation, for one - and costs nothing extra when omitted beyond the one `if` check.
     */
    createBiomesMap(elevationData, moistureData, temperatureData, biomeOverrideData, width, height, seaLevel, waterMask, params, outBuffer, bounds = null, outFallbackBuffer = null) {
        const pixelBuffer = outBuffer;
        const baseBounds = ProceduralEngine.resolveBounds(bounds, width, height);
        const renderBounds = ProceduralEngine.getRepaintBounds(baseBounds, width, height);
        const [fbR, fbG, fbB] = FILRODENSWMB.DISPLAY.FALLBACK_HIGHLIGHT_COLOR;
        const fbAlpha = Math.round(FILRODENSWMB.DISPLAY.FALLBACK_HIGHLIGHT_ALPHA * 255);

        for (let y = renderBounds.minY; y <= renderBounds.maxY; y++) {
            for (let x = renderBounds.minX; x <= renderBounds.maxX; x++) {
                const i = y * width + x;
                const bufferIndex = i * 4;
                const elevation = elevationData[i];

                const overrideId = biomeOverrideData ? biomeOverrideData[i] : 0;
                const { lookupKey, isWater, isFallback } = ProceduralEngine.resolveBiomeLookup(
                    overrideId, elevation, moistureData[i], temperatureData[i], seaLevel, waterMask, i, params?.customBiomeRules, params?.biomePalette,
                    params?.solidOverWater,
                );

                if (outFallbackBuffer) {
                    outFallbackBuffer[bufferIndex] = isFallback ? fbR : 0;
                    outFallbackBuffer[bufferIndex + 1] = isFallback ? fbG : 0;
                    outFallbackBuffer[bufferIndex + 2] = isFallback ? fbB : 0;
                    outFallbackBuffer[bufferIndex + 3] = isFallback ? fbAlpha : 0;
                }

                if (isWater) {
                    pixelBuffer[bufferIndex] = 0;
                    pixelBuffer[bufferIndex + 1] = 0;
                    pixelBuffer[bufferIndex + 2] = 0;
                    pixelBuffer[bufferIndex + 3] = 0;
                    continue;
                }

                const color = params?.biomePalette?.[lookupKey] ?? FILRODENSWMB.BIOMES[lookupKey] ?? [0, 0, 0];
                pixelBuffer[bufferIndex] = color[0];
                pixelBuffer[bufferIndex + 1] = color[1];
                pixelBuffer[bufferIndex + 2] = color[2];
                pixelBuffer[bufferIndex + 3] = 255;
            }
        }
        return pixelBuffer;
    }

    generateRivers(elevationData, moistureData, temperatureData, mapPins, width, height, params, outRiverMap, outWaterMask) {
        const seaLevel = params.seaLevel ?? FILRODENSWMB.DEFAULTS.SEA_LEVEL;

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

            // Every river draws from a stream of its own, seeded by its spring. With one stream
            // shared by all rivers, a river that took a different number of steps would shift the
            // stream for every river traced after it, and each of those would re-route wherever
            // the choice between equally low neighbours (or the meander jitter) went the other
            // way. One edit would then reshape rivers all over the map, and everything derived
            // from the water would have to be recomputed over that whole area.
            this.riverTracePrng = ProceduralEngine.#mulberry32(ProceduralEngine.#riverSeed(this.seedNumber, index));
            this.riverTraceId++;
            const path =this.#traceRiver(spring.x, spring.y, elevationData, temperatureData, width, height, seaLevel, riverMap, waterMask, params);
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
     * Uses a high-performance neighbour-thresholding edge detection algorithm.
     *
     * Bands a pixel by `Math.floor(elevation / interval)` and draws a line wherever a neighbour
     * falls in a different band. Math.floor (unlike the `%` operator) rounds consistently towards
     * negative infinity for a negative input, so this keeps producing one band per interval-sized
     * step with no discontinuity at 0 even once elevation can go negative or above 1 - nothing
     * here needs to change for hand-edited terrain to exceed the old [0, 1] range.
     */
    createContourMap(elevationData, width, height, interval, seaLevel, outBuffer, bounds = null) {
        if (!interval || interval <= 0) return outBuffer;

        const baseBounds = ProceduralEngine.resolveBounds(bounds, width, height);
        const contourBounds = ProceduralEngine.getRepaintBounds(baseBounds, width, height);

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

    /**
     * A highly optimised box-blur used exclusively for smoothing the low-resolution Tectonic Mesh.
     */
    #blurMesh(mesh, width, height, radius) {
        const result = new Float32Array(width * height);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let sum = 0,
                    count = 0;
                for (let dy = -radius; dy <= radius; dy++) {
                    for (let dx = -radius; dx <= radius; dx++) {
                        const nx = x + dx;
                        const ny = y + dy;
                        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                            sum += mesh[ny * width + nx];
                            count++;
                        }
                    }
                }
                result[y * width + x] = sum / count;
            }
        }
        return result;
    }

    /**
     * Bilinear interpolation for perfectly upscaling a low-resolution mesh into a high-resolution
     * grid, or for reading any full-resolution field at a continuous (sub-pixel) position.
     */
    #bilinearSample(mesh, width, height, x, y) {
        const x1 = Math.floor(x);
        const y1 = Math.floor(y);
        const x2 = Math.min(x1 + 1, width - 1);
        const y2 = Math.min(y1 + 1, height - 1);

        const dx = x - x1;
        const dy = y - y1;

        const p00 = mesh[y1 * width + x1];
        const p10 = mesh[y1 * width + x2];
        const p01 = mesh[y2 * width + x1];
        const p11 = mesh[y2 * width + x2];

        const bottom = p00 * (1 - dx) + p10 * dx;
        const top = p01 * (1 - dx) + p11 * dx;

        return bottom * (1 - dy) + top * dy;
    }

    /**
     * GLSL-style smoothstep for clamping the Continental Mask.
     */
    #smoothstep(edge0, edge1, x) {
        const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
        return t * t * (3 - 2 * t);
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
