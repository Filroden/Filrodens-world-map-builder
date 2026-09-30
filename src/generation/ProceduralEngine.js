import { SimplexNoise } from "../../vendor/simplex-noise/simplex-noise.js";
import { TectonicEngine } from "./TectonicEngine.js";
import { HydrologyEngine } from "./HydrologyEngine.js";
import { BiomeRuleEngine } from "./BiomeRuleEngine.js";
import { BIOME_SIDE } from "./BiomePlacement.js";
import { TerrainShading } from "../tools/TerrainShading.js";
import { SpatialMath } from "../tools/SpatialMath.js";
import { UpwindMargin } from "../tools/UpwindMargin.js";
import { FILRODENSWMB } from "../config.js";

/**
 * Rows of every input and output a band of the layer painters needs beyond the band itself, above
 * and below: the repaint margin they write around any area they paint (DISPLAY.REPAINT_MARGIN),
 * plus the one row either side of every pixel they write that relief shading, the contour lines
 * and the shoreline read (see LayerPainting). The two halos are part of the painters' design, so
 * both must grow together if either reach ever does.
 */
export const PAINT_HALO_ROWS = FILRODENSWMB.DISPLAY.REPAINT_MARGIN + 1;

// Extra rows of the coastline field kept either side of those a band of the detail pass can
// read (see ProceduralEngine.detailJobForRows), covering the interpolation's second row and the
// rounding of the landmass lookup
const DETAIL_BAND_MARGIN_CELLS = 2;

// The eight neighbours a jump flood pass reads, in the order it reads them (see
// ProceduralEngine#executeJFAPass): the row above left to right, the two sides, the row below
const JFA_ORDER_COL = Int8Array.of(-1, 0, 1, -1, 1, -1, 0, 1);
const JFA_ORDER_ROW = Int8Array.of(-1, -1, -1, 0, 0, 1, 1, 1);

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

    // What #isSea found a pixel below sea level to be (0: not yet looked at)
    static #OPEN_SEA = 1;
    static #INLAND_HOLLOW = 2;

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
     * The pixels the layer painters (paintTerrainAux, createBiomesMap and createContourMap) write when they
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
        // The legacy River Meander value: random noise on each neighbour's height, which nudges a
        // river's route. The current river rules draw meanders instead (see RiverNetwork), so it
        // only still applies to maps made before them, keeping their rivers where they were.
        const meanderJitter = this.currentRiverRules ? 0 : (params?.hydrology?.meanderJitter ?? FILRODENSWMB.HYDROLOGY.MEANDER_JITTER);

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
     *
     * The lake grows from its lowest shore pixel upwards until one of them has a lower neighbour
     * to spill into. It never grows past the largest lake (see #maxLakePixels). Under the legacy
     * rules a lake that reaches that size has no outflow and its river ends there.
     *
     * The current rules also flood the river's own earlier course (see #scanBasinNeighbors), and
     * a lake that does so is one the river has wandered back into on flat ground, where its
     * pools run together. Such a lake is kept to LOOP_LAKE_AREA. A lake that reaches its limit
     * is breached rather than ending the river (see #breachBasin).
     *
     * @returns {{spillover: object|null, lakePixels: object[], surfaceElev: number, channel: {x: number, y: number}[]}}
     *   `channel` is the breach the river cuts from the lake to the spillover (current rules only).
     */
    #fillBasin(startX, startY, elevationData, width, height, riverMap) {
        this.basinTraceId++;
        this.basinVisitedBuffer[startY * width + startX] = this.basinTraceId;
        this.basinFloodsOwnRiver = false;
        // Under the current rules, which pixel each shore pixel was reached from, for #breachBasin
        this.basinCameFrom = this.currentRiverRules ? new Map() : null;

        const boundary = new MinHeap();
        boundary.push({ x: startX, y: startY, elev: elevationData[startY * width + startX] });

        const lakePixels = [];
        let surfaceElev = elevationData[startY * width + startX];
        const limit = () => (this.basinFloodsOwnRiver ? Math.min(this.loopLakePixels, this.maxLakePixels) : this.maxLakePixels);

        while (boundary.length > 0 && lakePixels.length < limit()) {
            const current = boundary.pop();

            lakePixels.push({ x: current.x, y: current.y, isLake: true });
            riverMap[current.y * width + current.x] = true;
            surfaceElev = Math.max(surfaceElev, current.elev);

            const spillover = this.#scanBasinNeighbors(current, elevationData, width, height, boundary);

            if (spillover) {
                return { spillover, lakePixels, surfaceElev: current.elev, channel: [] };
            }
        }

        if (!this.currentRiverRules || boundary.length === 0) return { spillover: null, lakePixels, surfaceElev, channel: [] };
        return { ...this.#breachBasin(boundary, lakePixels, surfaceElev, elevationData, width, height), lakePixels, surfaceElev };
    }

    /**
     * Where a full lake breaks out (current rules only): the river wears a channel through the
     * lowest ground around it rather than flooding a whole plain. The search carries on from the
     * lake's shore exactly as the flood did, always from the lowest pixel reached so far, but
     * without adding to the lake, until a pixel has a neighbour lower than the lake's surface
     * that the river has not been through. The channel is the way the search reached that pixel
     * from the lake, so it crosses the lowest rim there is, and the river flows on from the lower
     * neighbour. Leaving only for ground below the lake keeps a river on a wide flat plain from
     * breaking out into the next hollow, and the next, wandering round the plain for ever.
     *
     * The search reaching the edge of the map also lets the river out: the land goes on beyond
     * the map, and the river leaves the map there.
     *
     * The search looks at no more than BREACH_AREA (square pixels of a BASELINE_DIMENSION map).
     * A basin still closed after that (a wide hollow with no outlet for a long way) keeps the
     * river, which ends in its lake.
     *
     * @returns {{spillover: object|null, channel: {x: number, y: number}[], leavesMap: boolean}}
     */
    #breachBasin(boundary, lakePixels, surfaceElev, elevationData, width, height) {
        const lake = new Set(lakePixels.map((p) => p.y * width + p.x));
        const channelTo = (pixel) => {
            const channel = [];
            for (let index = pixel.y * width + pixel.x; index !== undefined && !lake.has(index); index = this.basinCameFrom.get(index)) {
                channel.push({ x: index % width, y: Math.floor(index / width) });
            }
            return channel.reverse();
        };

        // A lake already at the edge spills off the map there, rather than along the edge
        const onEdge = (p) => p.x === 0 || p.y === 0 || p.x === width - 1 || p.y === height - 1;
        if (lakePixels.some(onEdge)) return { spillover: null, channel: [], leavesMap: true };

        for (let searched = 0; boundary.length > 0 && searched < this.breachPixels; searched++) {
            const current = boundary.pop();
            if (onEdge(current)) {
                return { spillover: null, channel: channelTo(current), leavesMap: true };
            }
            const spillover = this.#scanBasinNeighbors(current, elevationData, width, height, boundary, Math.min(current.elev, surfaceElev));
            if (spillover) return { spillover, channel: channelTo(current), leavesMap: false };
        }
        return { spillover: null, channel: [], leavesMap: false };
    }

    /**
     * Whether a pixel below sea level is the sea a river ends in (current rules only; under the
     * legacy rules every such pixel is). A small hollow below sea level inland, cut off from the
     * sea, is not: a river runs into it and on out of it as it does through a lake. Pixels below
     * sea level count as open sea when, joined up, they cover more than the largest lake, or reach
     * the edge of the map. Each group is looked at once, the first time a river reaches it.
     */
    #isSea(x, y, elevationData, width, height, seaLevel) {
        if (!this.currentRiverRules) return true;
        const start = y * width + x;
        if (this.seaKind[start]) return this.seaKind[start] === ProceduralEngine.#OPEN_SEA;

        const group = [start];
        this.seaKind[start] = ProceduralEngine.#INLAND_HOLLOW;
        let isOpen = false;
        for (let i = 0; i < group.length && !isOpen; i++) {
            const index = group[i];
            const px = index % width;
            const py = (index - px) / width;
            if (px === 0 || py === 0 || px === width - 1 || py === height - 1 || group.length > this.maxLakePixels) {
                isOpen = true;
                break;
            }
            for (const dir of ProceduralEngine.ADJACENT_OFFSETS) {
                const next = (py + dir.dy) * width + px + dir.dx;
                if (this.seaKind[next] === ProceduralEngine.#OPEN_SEA) {
                    isOpen = true;
                    break;
                }
                if (this.seaKind[next] || elevationData[next] > seaLevel) continue;
                this.seaKind[next] = ProceduralEngine.#INLAND_HOLLOW;
                group.push(next);
            }
        }
        if (isOpen) for (const index of group) this.seaKind[index] = ProceduralEngine.#OPEN_SEA;
        return isOpen;
    }

    #scanBasinNeighbors(current, elevationData, width, height, boundary, below = current.elev) {
        for (const dir of ProceduralEngine.ADJACENT_OFFSETS) {
            const nx = current.x + dir.dx;
            const ny = current.y + dir.dy;

            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

            const idx = ny * width + nx;
            if (this.basinVisitedBuffer[idx] === this.basinTraceId) continue;
            this.basinVisitedBuffer[idx] = this.basinTraceId;

            const nElev = elevationData[idx];

            // If we found a pixel strictly lower than the one we are evaluating, it is the spillover lip,
            // unless the river has already been there
            if (nElev < below) {
                const isOwnRiver = this.riverVisitedBuffer[idx] === this.riverTraceId;
                if (!isOwnRiver) return { x: nx, y: ny, elevation: nElev };
                // The legacy rules pass over it. On flat ground a river can wander back past its
                // own course; skipping those pixels could then wall the lake in completely, and
                // the river ended in a pool a few pixels across. The current rules flood them as
                // part of the lake (see #fillBasin).
                if (!this.currentRiverRules) continue;
                this.basinFloodsOwnRiver = true;
            }

            this.basinCameFrom?.set(idx, current.y * width + current.x);
            boundary.push({ x: nx, y: ny, elev: nElev });
        }
        return null;
    }

    /**
     * Executes the Greedy Downhill algorithm to plot a vector path to the ocean.
     *
     * Every pixel the river takes (and every pixel of a lake it fills) is marked with the river's
     * number in the owner buffer, and its place in the path is recorded, so a later river that
     * runs into it knows which river and which step it joined (see `record.mergeInto`), which is
     * what the river network's flow is added up from (see RiverNetwork).
     *
     * Under the current river rules (see TerrainVersion.usesCurrentRivers) two more things
     * apply. A river joins another as soon as it runs alongside it: if any of its eight
     * neighbours is another river's pixel no higher than where it stands, it flows into that one.
     * Without this, two rivers running down the same even slope a pixel apart never meet (each
     * steps straight down, never onto the other), which drew them as two parallel lines. And a
     * river running downhill follows the slope's own direction (see #followSlope). Maps made
     * before these rules keep the plain steepest-neighbour trace, so their rivers and lakes stay
     * where they were.
     */
    #traceRiver(startX, startY, elevationData, temperatureData, width, height, seaLevel, riverMap, waterMask, params, record, resume = false) {
        const map = { elevationData, temperatureData, width, height, seaLevel, riverMap, waterMask, params };
        const freezeLimit = params?.climate?.freezingThreshold ?? FILRODENSWMB.CLIMATE.FREEZING_THRESHOLD;
        const maxLength = width * FILRODENSWMB.HYDROLOGY.MAX_RIVER_LENGTH_MULT;

        // Where the river is, and where it would be if it could run in any direction rather
        // than only to a neighbour (see #followSlope)
        const at = { x: startX, y: startY, elevation: elevationData[startY * width + startX] };
        const ideal = { x: startX, y: startY };

        // When resuming, the starting pixel is already the last step of the path
        let isStartRecorded = resume;
        while (record.path.length < maxLength) {
            const index = at.y * width + at.x;
            const isFrozen = temperatureData[index] < freezeLimit;
            if (!isStartRecorded) this.#recordRiverStep(record, at.x, at.y, isFrozen, width, riverMap);
            // Cleared on every pass, though only the first can find it set: stepping on always reaches
            // a pixel not yet recorded
            isStartRecorded = false; // NOSONAR

            const next = this.#nextRiverStep(record, at, ideal, isFrozen, map);
            if (!next) break;
            at.x = next.x;
            at.y = next.y;
            at.elevation = next.elevation;
            if (next.resetsIdeal) {
                ideal.x = next.x;
                ideal.y = next.y;
            }
        }

        return record.path.length > FILRODENSWMB.HYDROLOGY.MAX_PATH_LENGTH ? record.path : null;
    }

    /**
     * Where a river goes from the pixel it has just reached, or null where it ends (at the sea,
     * joining another river, or in a basin with no way out). The steps that end it are added to
     * its path here.
     * @returns {{x: number, y: number, elevation: number, resetsIdeal: boolean}|null}
     */
    #nextRiverStep(record, at, ideal, isFrozen, map) {
        const { elevationData, width, height, seaLevel, riverMap, params } = map;

        const alongside = this.currentRiverRules ? this.#findAdjacentRiver(at.x, at.y, at.elevation, elevationData, width, height, riverMap, record.ownerId) : null;
        if (alongside) return this.#mergeRiverAt(record, alongside.x, alongside.y, width);

        const lowestNeighbor = this.#getLowestNeighbor(at.x, at.y, elevationData, width, height, params);
        // Hemmed in by its own course or lakes: under the current rules the river pools there
        // and breaches its way out like any other basin, rather than ending on dry land
        if (!lowestNeighbor) return this.currentRiverRules ? this.#spillFromBasin(record, at, isFrozen, map) : null;

        if (lowestNeighbor.elevation <= seaLevel && this.#isSea(lowestNeighbor.x, lowestNeighbor.y, elevationData, width, height, seaLevel)) {
            record.path.push({ x: lowestNeighbor.x, y: lowestNeighbor.y });
            return null;
        }

        if (riverMap[lowestNeighbor.y * width + lowestNeighbor.x]) return this.#mergeRiverAt(record, lowestNeighbor.x, lowestNeighbor.y, width);

        // Going downhill, follow the slope's own direction rather than always the steepest of
        // the eight neighbours (see #followSlope)
        if (this.currentRiverRules && lowestNeighbor.elevation < at.elevation) {
            const next = this.#followSlope(ideal, at.x, at.y, at.elevation, elevationData, width, height, riverMap);
            if (next) return { ...next, resetsIdeal: false };
        }

        if (lowestNeighbor.elevation >= at.elevation) return this.#spillFromBasin(record, at, isFrozen, map);

        return { ...lowestNeighbor, resetsIdeal: true };
    }

    /**
     * Fills the basin a river has run into as a lake (see #fillBasin), records its pixels as the
     * river's, and returns where the lake spills over, or null if it never does.
     */
    #spillFromBasin(record, at, isFrozen, { elevationData, width, height, riverMap, waterMask }) {
        const basin = this.#fillBasin(at.x, at.y, elevationData, width, height, riverMap);

        if (basin.lakePixels.length > 0) {
            record.path.push({ x: at.x, y: at.y, isLake: true, isFrozen });
            const lakeIndex = record.path.length - 1;
            for (const lp of basin.lakePixels) {
                const lakePixel = lp.y * width + lp.x;
                this.riverVisitedBuffer[lakePixel] = this.riverTraceId;
                waterMask[lakePixel] = basin.surfaceElev;
                this.riverOwnerBuffer[lakePixel] = record.ownerId;
                record.indexOf.set(lakePixel, lakeIndex);
            }
        }

        if (!basin.spillover && !basin.leavesMap) return null;

        // The breach the river cuts out of the lake, if it had to (see #breachBasin). It can
        // open onto another river, which the river then joins, or lead off the map.
        for (const step of basin.channel ?? []) {
            const index = step.y * width + step.x;
            if (riverMap[index] && this.riverOwnerBuffer[index] !== record.ownerId) return this.#mergeRiverAt(record, step.x, step.y, width);
            this.#recordRiverStep(record, step.x, step.y, isFrozen, width, riverMap);
        }
        if (basin.leavesMap) return null;

        const spill = basin.spillover;
        const spillIndex = spill.y * width + spill.x;
        if (this.currentRiverRules && riverMap[spillIndex] && this.riverOwnerBuffer[spillIndex] !== record.ownerId) return this.#mergeRiverAt(record, spill.x, spill.y, width);
        return { ...spill, resetsIdeal: true };
    }

    /** Adds a pixel to a river's path and marks it as the river's. */
    #recordRiverStep(record, x, y, isFrozen, width, riverMap) {
        const index = y * width + x;
        this.riverVisitedBuffer[index] = this.riverTraceId;
        record.path.push({ x, y, isFrozen });
        this.#claimRiverPixel(record, index, record.path.length - 1);
        riverMap[index] = true;
    }

    /**
     * A custom river under the current river rules (see HydrologyEngine.authoredRivers): its path
     * is the line the user drew, pixel by pixel, rather than a trace. It ends early where that
     * line reaches the sea or runs into another river (joining it). Where the line ends on land,
     * the river is traced on from there like any other, so it still finds its way to the sea.
     *
     * Custom rivers are laid down before any spring is traced, so procedural rivers that reach
     * one join it. `record.authored` is how many steps of the path follow the user's line.
     */
    #traceAuthored(authored, record, elevationData, temperatureData, width, height, seaLevel, riverMap, waterMask, params) {
        const freezeLimit = params?.climate?.freezingThreshold ?? FILRODENSWMB.CLIMATE.FREEZING_THRESHOLD;
        const endsAt = (length) => {
            record.authored = length;
            return record.path.length > FILRODENSWMB.HYDROLOGY.MAX_PATH_LENGTH;
        };

        for (const { x, y } of authored.pixels) {
            const index = y * width + x;
            if (elevationData[index] <= seaLevel && this.#isSea(x, y, elevationData, width, height, seaLevel)) {
                record.path.push({ x, y });
                return endsAt(record.path.length);
            }
            if (riverMap[index] && this.riverOwnerBuffer[index] !== record.ownerId) {
                this.#mergeRiverAt(record, x, y, width);
                return endsAt(record.path.length);
            }
            if (this.riverVisitedBuffer[index] === this.riverTraceId) continue;
            this.#recordRiverStep(record, x, y, temperatureData[index] < freezeLimit, width, riverMap);
        }

        record.authored = record.path.length;
        const last = record.path.at(-1);
        if (!last) return false;
        return !!this.#traceRiver(last.x, last.y, elevationData, temperatureData, width, height, seaLevel, riverMap, waterMask, params, record, true);
    }

    /** Marks a pixel as the river's and remembers the step of its path it is (the first time only). */
    #claimRiverPixel(record, index, pathIndex) {
        this.riverOwnerBuffer[index] = record.ownerId;
        if (!record.indexOf.has(index)) record.indexOf.set(index, pathIndex);
    }

    /**
     * Ends a river by joining it to the river whose pixel it steps onto, recording which river and
     * which step of it (see RiverNetwork, which adds the flow up from these joins).
     * @returns {null} The river ends here.
     */
    #mergeRiverAt(record, x, y, width) {
        const index = y * width + x;
        record.path.push({ x, y, isMerge: true });
        const target = this.riverRecords[this.riverOwnerBuffer[index] - 1];
        if (target && target !== record) record.mergeInto = { record: target, index: target.indexOf.get(index) ?? target.path.length - 1 };
        return null;
    }

    /**
     * The next pixel of a river running downhill, following the slope's direction.
     *
     * Always stepping to the steepest of the eight neighbours makes a river on an even slope run
     * in a dead straight line at 0 or 45 degrees, however the slope actually faces, then turn
     * sharply when another neighbour becomes steeper. Instead the river carries a point that
     * moves one pixel at a time straight down the slope (measured over a few pixels, bilinearly),
     * and steps to whichever lower, unvisited neighbour is closest to it, so over several steps
     * the pixels follow the slope at any angle. The point is kept within STREAM_SLACK pixels of
     * the pixel actually taken.
     *
     * @param {{x: number, y: number}} ideal - The carried point, moved in place.
     * @returns {{x: number, y: number, elevation: number}|null} Null when no neighbour is lower.
     */
    #followSlope(ideal, cx, cy, currentElev, elevationData, width, height, riverMap) {
        const reach = FILRODENSWMB.HYDROLOGY.STREAM_GRADIENT_REACH;
        const sample = (x, y) => {
            const px = Math.min(width - 1, Math.max(0, x));
            const py = Math.min(height - 1, Math.max(0, y));
            const x0 = Math.floor(px);
            const y0 = Math.floor(py);
            const x1 = Math.min(width - 1, x0 + 1);
            const y1 = Math.min(height - 1, y0 + 1);
            const fx = px - x0;
            const fy = py - y0;
            const top = elevationData[y0 * width + x0] * (1 - fx) + elevationData[y0 * width + x1] * fx;
            const bottom = elevationData[y1 * width + x0] * (1 - fx) + elevationData[y1 * width + x1] * fx;
            return top * (1 - fy) + bottom * fy;
        };
        const gx = sample(ideal.x + reach, ideal.y) - sample(ideal.x - reach, ideal.y);
        const gy = sample(ideal.x, ideal.y + reach) - sample(ideal.x, ideal.y - reach);
        const length = Math.hypot(gx, gy);
        if (length === 0) return null;
        const tx = ideal.x - gx / length;
        const ty = ideal.y - gy / length;

        let best = null;
        let bestDistance = Infinity;
        for (const dir of ProceduralEngine.ADJACENT_OFFSETS) {
            const nx = cx + dir.dx;
            const ny = cy + dir.dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            const idx = ny * width + nx;
            if (this.riverVisitedBuffer[idx] === this.riverTraceId || riverMap[idx]) continue;
            const elevation = elevationData[idx];
            if (elevation >= currentElev) continue;
            const distance = (nx - tx) ** 2 + (ny - ty) ** 2;
            if (distance < bestDistance) {
                bestDistance = distance;
                best = { x: nx, y: ny, elevation };
            }
        }
        if (!best) return null;

        const slack = FILRODENSWMB.HYDROLOGY.STREAM_SLACK;
        ideal.x = best.x + Math.max(-slack, Math.min(slack, tx - best.x));
        ideal.y = best.y + Math.max(-slack, Math.min(slack, ty - best.y));
        return best;
    }

    /**
     * The lowest pixel of another river among a pixel's eight neighbours that is no higher than
     * the pixel itself, or null.
     */
    #findAdjacentRiver(cx, cy, currentElev, elevationData, width, height, riverMap, ownerId) {
        let best = null;
        for (const dir of ProceduralEngine.ADJACENT_OFFSETS) {
            const nx = cx + dir.dx;
            const ny = cy + dir.dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            const idx = ny * width + nx;
            if (!riverMap[idx] || this.riverOwnerBuffer[idx] === ownerId || this.riverOwnerBuffer[idx] === 0) continue;
            const elevation = elevationData[idx];
            if (elevation > currentElev) continue;
            if (!best || elevation < best.elevation) best = { x: nx, y: ny, elevation };
        }
        return best;
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
     * @param {object|null} [bounds] - Only the pixels in this area (inclusive) are worked out and
     *   written; the rest of `outBuffer` is left as it is. Every pixel's value depends only on its
     *   position, so an area comes out exactly as it would in a whole-map pass.
     * @param {number} [rowOffset] - The map row `outBuffer` starts at: 0 for a whole-map buffer,
     *   or the first row of a band worked out apart from the rest (see GenerationWorkers).
     * @returns {Float32Array} `outBuffer`.
     */
    generateSurfaceTexture(width, height, params, outBuffer, bounds = null, rowOffset = 0) {
        const settings = FILRODENSWMB.GENERATION.SURFACE_TEXTURE;
        const world = params?.terrain?.world ?? { zoom: 1, originX: 0, originY: 0, rootW: width, rootH: height };
        const zoom = world.zoom || 1;
        const rootSize = Math.max(world.rootW || width / zoom, world.rootH || height / zoom);
        const baselinePerWorld = FILRODENSWMB.LIMITS.BASELINE_DIMENSION / rootSize;
        const density = zoom / baselinePerWorld;
        const extraOctaves = density > 1 ? Math.round(Math.log2(density)) : 0;
        const scale = 1 / settings.WAVELENGTH;
        const area = ProceduralEngine.resolveBounds(bounds, width, height);

        for (let y = area.minY; y <= area.maxY; y++) {
            const baselineY = ((world.originY || 0) + y / zoom) * baselinePerWorld + settings.NOISE_OFFSET.Y;
            for (let x = area.minX; x <= area.maxX; x++) {
                const baselineX = ((world.originX || 0) + x / zoom) * baselinePerWorld + settings.NOISE_OFFSET.X;
                outBuffer[(y - rowOffset) * width + x] = this.#signedFbm(baselineX, baselineY, settings.OCTAVES, scale, extraOctaves);
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

        // 1. Generate Base Elevation Noise
        this.#standardNoise(width, params, elevationData, activeBounds, 0);

        // 2. Apply Vector Deformations strictly within the active bounds
        if (tectonicFaults.length > 0) {
            TectonicEngine.applyTectonicFaults(elevationData, width, height, tectonicFaults, this.simplex, activeBounds, params.terrain?.faultFrame);
        }
        if (manualRivers.length > 0) {
            HydrologyEngine.carveManualRivers(elevationData, width, height, manualRivers, this.simplex, params.seaLevel, activeBounds, params.terrain?.currentRivers === true);
        }

        // 3. Apply Elevation Exponent & Pivot Map to Land/Sea Boundaries
        this.#stretchLand(width, params, elevationData, activeBounds, 0);

        return elevationData;
    }

    /**
     * Whole rows `rowStart` to `rowEnd` (exclusive) of the standard base terrain with no faults or
     * rivers (as generateTopography makes it), into `outRows`, which holds just those rows. For
     * one band of a whole-map pass shared between workers (see GenerationWorkers); every pixel
     * depends only on its own position, so the band comes out exactly as in a whole-map pass.
     */
    generateTopographyRows(width, params, outRows, rowStart, rowEnd) {
        const band = { minX: 0, maxX: width - 1, minY: rowStart, maxY: rowEnd - 1 };
        this.#standardNoise(width, params, outRows, band, rowStart);
        this.#stretchLand(width, params, outRows, band, rowStart);
        return outRows;
    }

    /** Step 1 of generateTopography: the elevation noise over `bounds`, into a buffer starting at row `rowOffset`. */
    #standardNoise(width, params, elevationData, bounds, rowOffset) {
        const eScale = params.noise.elevation.scale;
        const eOctaves = params.noise.elevation.octaves;
        const panX = params.noise.offsetX ?? 0;
        const panY = params.noise.offsetY ?? 0;
        // Finer detail layers for a zoomed-in regional map; 0 for any other map
        const extraOctaves = params.terrain?.extraOctaves ?? 0;

        for (let y = bounds.minY; y <= bounds.maxY; y++) {
            for (let x = bounds.minX; x <= bounds.maxX; x++) {
                const worldX = x + panX;
                const worldY = y + panY;
                elevationData[(y - rowOffset) * width + x] = this.#fbm(worldX, worldY, eOctaves, eScale, extraOctaves);
            }
        }
    }

    /** Step 3 of generateTopography: stretches land above sea level and floors the sea bed at 0. */
    #stretchLand(width, params, elevationData, bounds, rowOffset) {
        const eStretch = params.noise.elevation.stretch ?? 1;
        const seaLevel = params.seaLevel ?? FILRODENSWMB.DEFAULTS.SEA_LEVEL;

        for (let y = bounds.minY; y <= bounds.maxY; y++) {
            for (let x = bounds.minX; x <= bounds.maxX; x++) {
                const i = (y - rowOffset) * width + x;
                const elevation = elevationData[i];

                if (elevation > seaLevel) {
                    const landHeight = (elevation - seaLevel) / (1 - seaLevel);
                    const stretchedLand = Math.pow(landHeight, eStretch);
                    elevationData[i] = seaLevel + stretchedLand * (1 - seaLevel);
                } else {
                    elevationData[i] = Math.max(0, elevation);
                }
            }
        }
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
        const job = this.prepareGuidedDetail(width, height, params, landMasks);
        return this.generateDetailRows(width, height, params, job, 0, height, outBuffer);
    }

    /**
     * The first, map-wide part of generateGuidedTopography: the coastline distance field (and,
     * under the current coastal profile, the mid-ocean ridges) that the per-pixel pass reads (see
     * generateDetailRows). Plain data only, so it can be handed to workers.
     *
     * @returns {{frame: object, field: object, plates: null}} A detail job.
     */
    prepareGuidedDetail(width, height, params, landMasks) {
        const validMasks = (landMasks ?? []).filter((m) => m.points && m.points.length >= FILRODENSWMB.LIMITS.MIN_POLYGON_VERTICES);
        const frame = ProceduralEngine.#resolveTerrainFrame(width, height, params);
        const land = validMasks.length > 0 ? this.#maskLand(validMasks, frame) : null;
        const field = this.#buildCoastDistanceField(width, height, params, frame, land, { findRidges: true });
        return { frame, field, plates: null };
    }

    /**
     * The per-pixel pass of guided and current tectonic terrain for whole rows `rowStart` to
     * `rowEnd` (exclusive), from a detail job (see prepareGuidedDetail and
     * prepareTectonicV2Detail). `outRows` holds just those rows, the first row first. Every pixel
     * depends only on its position and the job, so a band comes out exactly as it does in a
     * whole-map pass, which is what lets bands be shared between workers (see GenerationWorkers).
     *
     * @returns {Float32Array} `outRows`.
     */
    generateDetailRows(width, height, params, job, rowStart, rowEnd, outRows) {
        this.#applyGuidedDetail(width, height, params, job.frame, job.field, outRows, job.plates, rowStart, rowEnd);
        return outRows;
    }

    /**
     * A copy of a detail job holding only the rows of its coastline field that rows `rowStart` to
     * `rowEnd` (exclusive) of the map can read, for handing one band to a worker without copying
     * the whole field (tens of megabytes on a large map) to every worker.
     *
     * A pixel reads the field where its position lands after the domain warp moves it, so the
     * rows kept reach beyond the band's own by the furthest the warp can move a sample, taken at
     * twice what the noise can reach in theory, plus a couple of cells for the interpolation. The
     * cells keep their row numbers (`rowOffset` records the first one kept), so every sample is
     * computed exactly as it is from the whole field.
     *
     * @returns {object} A detail job for the band.
     */
    static detailJobForRows(job, params, rowStart, rowEnd) {
        const { frame, field } = job;
        const fracture = params.coastlineFracture ?? FILRODENSWMB.GENERATION.COASTLINE_FRACTURE;
        const warpReach = FILRODENSWMB.GENERATION.WARP.AMPLITUDE * frame.resolutionScale * Math.abs(fracture);
        const firstY = frame.originY + rowStart / frame.zoom - warpReach;
        const lastY = frame.originY + (rowEnd - 1) / frame.zoom + warpReach;
        const offset = field.rowOffset ?? 0;
        const firstRow = Math.max(offset, Math.floor((firstY - field.v0) * field.cellsPerPixel) - DETAIL_BAND_MARGIN_CELLS);
        const lastRow = Math.min(offset + field.distances.length / field.width - 1, Math.floor((lastY - field.v0) * field.cellsPerPixel) + DETAIL_BAND_MARGIN_CELLS);
        const rows = (array) => array?.slice((firstRow - offset) * field.width, (lastRow - offset + 1) * field.width) ?? null;

        return {
            ...job,
            field: { ...field, distances: rows(field.distances), landmassReach: rows(field.landmassReach), rowOffset: firstRow },
        };
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
        const job = this.prepareTectonicV2Detail(width, height, params);
        return this.generateDetailRows(width, height, params, job, 0, height, outBuffer);
    }

    /**
     * The first, map-wide part of generateTectonicV2Topography: the plates, the coastline
     * distance field and the ridge field that the per-pixel pass reads (see generateDetailRows).
     * Plain data only, so it can be handed to workers.
     *
     * @returns {{frame: object, field: object, plates: object}} A detail job.
     */
    prepareTectonicV2Detail(width, height, params) {
        const frame = ProceduralEngine.#resolveTerrainFrame(width, height, params);
        const continents = this.#continentNoise(params, frame);
        const plates = this.#buildPlateModel(params, frame, continents);
        const land = this.#plateLand(frame, plates, continents);
        const field = this.#buildCoastDistanceField(width, height, params, frame, land, { findRidges: false });
        if (ProceduralEngine.#ridgeStrengthOf(params) > 0) field.ridges = this.#buildPlateRidgeField(frame, plates);
        return { frame, field, plates };
    }

    /**
     * Land and ocean as the land masks draw them, as a land sampler (see #generateOwnershipGrid).
     *
     * `at` tests a single world position. `fillRow` decides a whole row of the ownership grid at
     * once by scanline: it finds where each mask's edges cross the row, then fills the spans
     * between them. Testing cell by cell costs every edge of every mask whose bounding box holds
     * the cell, so a large, detailed mask (a continent's bounding box covers most of the map)
     * made generation time grow with the number of nodes. The scanline costs one pass over the
     * edges per row plus one write per cell, whatever the node count, and gives exactly the same
     * answer as `at` for every cell (see #fillMaskRow).
     *
     * @returns {{at: function(number, number): number, fillRow: function(object): void}}
     */
    #maskLand(validMasks, frame) {
        const compiledMasks = this.#compileMaskData(ProceduralEngine.#masksToWorld(validMasks, frame));
        // One buffer for the edge crossings of any row, sized for the mask with the most edges
        const crossings = new Float64Array(Math.max(...compiledMasks.map((mask) => mask.vertexCount)));

        return {
            at: (worldX, worldY) => this.#resolvePixelOwnership(worldX, worldY, compiledMasks),
            fillRow: (row) => ProceduralEngine.#fillMaskRow(row, compiledMasks, crossings),
        };
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
     * Land and ocean as the plates decide them (see generateTectonicV2Topography), as a land
     * sampler (see #generateOwnershipGrid) that tests one world position at a time.
     */
    #plateLand(frame, plates, continents) {
        const weight = FILRODENSWMB.GENERATION.TECTONICS_V2.PLATE_WEIGHT;

        return {
            at: (worldX, worldY) => {
                const buoyancy = this.#samplePlateMesh(plates, plates.buoyancy, frame, worldX, worldY);
                return continents.at(worldX, worldY) + weight * buoyancy > continents.threshold ? 1 : 0;
            },
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
     *   resolutionScale: number, detailOctaves: number, fillEnclosedCoast: boolean, coastalBuffers: boolean,
     *   exactDistances: boolean}}
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
            exactDistances: terrain.exactDistances === true,
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
            // Whether nearest coastline cells are found exactly (see #nearestSeeds)
            exactDistances: frame.exactDistances,
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
     * Finds the signed distance from every grid cell to the nearest coastline cell (see
     * #nearestSeeds).
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
        seedGrid = ProceduralEngine.#nearestSeeds(seedGrid, width, height, grid.exactDistances);

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
            exactDistances: frame.exactDistances,
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

        const flooded = ProceduralEngine.#nearestSeeds(seedGrid, width, height, grid.exactDistances);
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

        const flooded = ProceduralEngine.#nearestSeeds(seedGrid, width, height, grid.exactDistances);
        const distances = new Float32Array(total);
        for (let index = 0; index < total; index++) {
            const x = index % width;
            const y = Math.floor(index / width);
            distances[index] = Math.hypot(x - flooded[index * 2], y - flooded[index * 2 + 1]) * cellSize;
        }

        return distances;
    }

    /**
     * For every cell of a grid, the position of its nearest seed, as an x, y pair per cell (or -1
     * if the grid has no seeds at all). `seedGrid` holds each seed cell's own position and -1
     * elsewhere; it is not modified.
     *
     * Maps of the current terrain revision use an exact distance transform (see
     * #exactNearestSeeds), which is both exact and several times faster. Legacy maps keep the
     * jump flood (see #runJumpFlood), which very occasionally settles on a seed slightly farther
     * than the nearest; switching them over would move their terrain by those near misses, so they
     * keep it and regenerate exactly as they always have.
     *
     * @param {boolean} exact - Whether to use the exact transform.
     * @returns {Int32Array} The nearest seed of every cell (a new array).
     */
    static #nearestSeeds(seedGrid, width, height, exact) {
        return exact ? ProceduralEngine.#exactNearestSeeds(seedGrid, width, height) : ProceduralEngine.#runJumpFlood(seedGrid, width, height);
    }

    /**
     * The exact nearest seed of every cell, by the two-pass Euclidean distance transform of
     * Felzenszwalb and Huttenlocher, keeping track of which seed each distance comes from. It
     * takes time in proportion to the number of cells (the jump flood takes that times the
     * number of halving steps, around fourteen passes on a large map).
     *
     * 1. Down each column, the nearest seed in that column (#nearestInColumns).
     * 2. Along each row, the nearest seed overall: a cell's squared distance to the seed nearest
     *    column q is (x - q)^2 + (column distance at q)^2, a parabola in x for every column
     *    holding a seed, and the nearest seed comes from the lowest parabola at x
     *    (#nearestInRow).
     *
     * On an exact tie between two seeds the one in the lower column is kept, then (within a
     * column) the one above, so the result never depends on anything but the seeds.
     */
    static #exactNearestSeeds(seedGrid, width, height) {
        const { squared, seedRow } = ProceduralEngine.#nearestInColumns(seedGrid, width, height);
        const flooded = new Int32Array(width * height * 2).fill(-1);
        const envelope = { columns: new Int32Array(width), starts: new Float64Array(width + 1) };

        for (let y = 0; y < height; y++) {
            ProceduralEngine.#nearestInRow(y, width, squared, seedRow, envelope, flooded);
        }

        return flooded;
    }

    /**
     * First pass of #exactNearestSeeds: for every cell, the row of the nearest seed in its own
     * column and the squared distance to it (Infinity, with row -1, if the column has no seed).
     * One sweep down each column finds the nearest seed above, one sweep up the nearest below;
     * the one above is kept on a tie.
     */
    static #nearestInColumns(seedGrid, width, height) {
        const total = width * height;
        const squared = new Float64Array(total);
        const seedRow = new Int32Array(total);

        for (let x = 0; x < width; x++) {
            let above = -1;
            for (let y = 0; y < height; y++) {
                const index = y * width + x;
                if (seedGrid[index * 2] !== -1) above = y;
                seedRow[index] = above;
            }

            let below = -1;
            for (let y = height - 1; y >= 0; y--) {
                const index = y * width + x;
                if (seedGrid[index * 2] !== -1) below = y;
                const fromAbove = seedRow[index] === -1 ? Infinity : y - seedRow[index];
                const fromBelow = below === -1 ? Infinity : below - y;
                if (fromBelow < fromAbove) seedRow[index] = below;
                const nearest = Math.min(fromAbove, fromBelow);
                squared[index] = nearest * nearest;
            }
        }

        return { squared, seedRow };
    }

    /**
     * Second pass of #exactNearestSeeds for row `y`: builds the lower envelope of the parabolas of
     * the columns that hold a seed (`columns` lists them left to right; parabola k is lowest from
     * `starts[k]` to `starts[k + 1]`), then reads each cell's nearest seed from it. A row whose
     * columns hold no seed at all is left at -1.
     */
    static #nearestInRow(y, width, squared, seedRow, envelope, flooded) {
        const row = y * width;
        const { columns, starts } = envelope;
        let last = -1;

        for (let q = 0; q < width; q++) {
            const columnSquared = squared[row + q];
            if (columnSquared === Infinity) continue;

            if (last === -1) {
                last = 0;
                columns[0] = q;
                starts[0] = -Infinity;
                starts[1] = Infinity;
                continue;
            }

            // Where this column's parabola drops below the lowest so far, discarding every
            // parabola it is already below from where that one took over
            let crossing = ProceduralEngine.#parabolaCrossing(squared, row, columns[last], q, columnSquared);
            while (crossing <= starts[last]) {
                last--;
                crossing = ProceduralEngine.#parabolaCrossing(squared, row, columns[last], q, columnSquared);
            }

            last++;
            columns[last] = q;
            starts[last] = crossing;
            starts[last + 1] = Infinity;
        }

        if (last === -1) return;

        let k = 0;
        for (let x = 0; x < width; x++) {
            while (starts[k + 1] < x) k++;
            const seedX = columns[k];
            flooded[(row + x) * 2] = seedX;
            flooded[(row + x) * 2 + 1] = seedRow[row + seedX];
        }
    }

    /** Where, along a row, the parabola of column `q` (height `heightQ`) crosses that of column `p` < `q`. */
    static #parabolaCrossing(squared, row, p, q, heightQ) {
        return (heightQ + q * q - (squared[row + p] + p * p)) / (2 * (q - p));
    }

    /**
     * Spreads seeds across a grid with the Jump Flood Algorithm: afterwards every cell holds the
     * position of (very nearly) its nearest seed, as an x, y pair per cell in `seedGrid`, or -1
     * if the grid had no seeds at all. Two closing passes at a step of one clean up the few cells
     * the halving steps leave with a slightly-too-far seed.
     *
     * @returns {Int32Array} The flooded seed grid (a new array; the input is not modified).
     */
    static #runJumpFlood(seedGrid, width, height) {
        // Two working grids, written in turn, so a pass never allocates and the input is never
        // written to
        const buffers = [new Int32Array(seedGrid.length), new Int32Array(seedGrid.length)];
        let flooded = seedGrid;
        let pass = 0;
        const runPass = (step) => {
            const output = buffers[pass++ % 2];
            ProceduralEngine.#executeJFAPass(flooded, output, width, height, step);
            flooded = output;
        };

        let step = Math.max(width, height) / 2;
        while (step >= 1) {
            step = Math.floor(step);
            runPass(step);
            step /= 2;
        }

        runPass(1);
        runPass(1);
        return flooded;
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
     *
     * Both steps (tracing each landmass, then giving every cell its landmass's reach) run over
     * every cell of the grid, so their tests are written inline in the loops rather than moved
     * into helpers called once per cell.
     */
    static #measureLandmasses(grid, ownershipGrid, distanceGrid, seedGrid) { // NOSONAR
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
        return field.landmassReach[(gridY - (field.rowOffset ?? 0)) * field.width + gridX];
    }

    /**
     * Creates a flat, memory-efficient binary map of land/ocean ownership, one entry per grid
     * cell, each cell decided at its world position.
     *
     * `land` is a land sampler: `at(worldX, worldY)` returns 1 for land and 0 for ocean, and an
     * optional `fillRow(row)` decides a whole row at once when the sampler has a faster way to do
     * so than testing each cell (land masks do, see #maskLand). Both must agree cell for cell.
     */
    #generateOwnershipGrid(grid, land) {
        const { width, height, u0, v0, cellsPerPixel } = grid;
        const ownership = new Uint8Array(width * height);

        for (let y = 0; y < height; y++) {
            const row = { ownership, offset: y * width, width, worldY: v0 + y / cellsPerPixel, u0, cellsPerPixel };
            if (land.fillRow) land.fillRow(row);
            else ProceduralEngine.#sampleOwnershipRow(row, land);
        }

        return ownership;
    }

    /** Decides one row of the ownership grid by testing each cell at its world position. */
    static #sampleOwnershipRow(row, land) {
        const { ownership, offset, width, worldY, u0, cellsPerPixel } = row;
        for (let x = 0; x < width; x++) {
            ownership[offset + x] = land.at(u0 + x / cellsPerPixel, worldY);
        }
    }

    /**
     * Decides one row of the ownership grid from the land masks by scanline, giving exactly the
     * result #resolvePixelOwnership gives cell by cell.
     *
     * A cell is inside a mask (even-odd rule) when an odd number of the mask's edges cross the row
     * strictly to the right of it (#isPointInCompiledPolygon). With the crossings sorted, that is
     * true exactly for cells from the 1st crossing up to (not including) the 2nd, from the 3rd up
     * to the 4th, and so on, so each such span is filled with the mask's value. Masks are applied
     * in order and each overwrites its spans, so the last mask covering a cell decides it, as it
     * does cell by cell. A row outside a mask's bounding box has no crossings, and a cell beyond
     * its left or right edge lies outside every span, which matches the bounding-box skip in
     * #resolvePixelOwnership.
     *
     * The crossings use the same formula, on the same Float32Array coordinates, as
     * #isPointInCompiledPolygon, and span ends are compared against each cell's world position
     * computed the same way as #sampleOwnershipRow, so no cell can land on the other side of an
     * edge through rounding. Do not "simplify" either to a different but equivalent-looking form.
     */
    static #fillMaskRow(row, compiledMasks, crossings) {
        for (const mask of compiledMasks) {
            if (row.worldY < mask.bounds.minY || row.worldY > mask.bounds.maxY) continue;

            const count = ProceduralEngine.#collectRowCrossings(mask, row.worldY, crossings);
            const sorted = crossings.subarray(0, count).sort();
            ProceduralEngine.#fillCrossingSpans(row, sorted, mask.isAddOperation ? 1 : 0);
        }
    }

    /**
     * Writes into `crossings` the world x of every edge of a mask that crosses the row at `y`,
     * with the edge test and intersection formula of #isPointInCompiledPolygon.
     *
     * @returns {number} How many crossings were written (always even for a closed polygon).
     */
    static #collectRowCrossings(mask, y, crossings) {
        const { coordinates, vertexCount } = mask;
        let count = 0;

        for (let i = 0, j = vertexCount - 1; i < vertexCount; j = i++) {
            const yi = coordinates[i * 2 + 1];
            const yj = coordinates[j * 2 + 1];
            if ((yi > y) === (yj > y)) continue;

            const xi = coordinates[i * 2];
            const xj = coordinates[j * 2];
            crossings[count++] = ((xj - xi) * (y - yi)) / (yj - yi) + xi;
        }

        return count;
    }

    /** Fills the spans between sorted pairs of crossings (1st to 2nd, 3rd to 4th...) with `value`. */
    static #fillCrossingSpans(row, sorted, value) {
        for (let k = 0; k + 1 < sorted.length; k += 2) {
            const start = ProceduralEngine.#firstCellFrom(row, sorted[k]);
            const end = ProceduralEngine.#firstCellFrom(row, sorted[k + 1]);
            if (end > start) row.ownership.fill(value, row.offset + start, row.offset + end);
        }
    }

    /**
     * The first cell of the row whose world position is at or beyond `worldX` (the row's width if
     * there is none). The division gives a first guess; the two loops then settle it against each
     * cell's actual world position, so it agrees exactly with a cell-by-cell comparison.
     */
    static #firstCellFrom(row, worldX) {
        const { width, u0, cellsPerPixel } = row;
        let x = Math.min(width, Math.max(0, Math.ceil((worldX - u0) * cellsPerPixel)));

        while (x > 0 && u0 + (x - 1) / cellsPerPixel >= worldX) x--;
        while (x < width && u0 + x / cellsPerPixel < worldX) x++;

        return x;
    }

    /**
     * Reads the coastline distance field at a world position, between cells where it falls
     * between them. Positions beyond the field read its nearest edge.
     */
    #sampleCoastDistance(field, worldX, worldY) {
        const gridX = Math.max(0, Math.min(field.width - 1, (worldX - field.u0) * field.cellsPerPixel));
        const gridY = Math.max(0, Math.min(field.height - 1, (worldY - field.v0) * field.cellsPerPixel));
        return this.#bilinearSample(field.distances, field.width, field.height, gridX, gridY, field.rowOffset ?? 0);
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

    /**
     * One pass of the jump flood: every cell takes, of its own seed and the seeds of the eight
     * cells `step` away (in the order below), the nearest, keeping the earlier one on a tie.
     *
     * This is the innermost loop of every guided and tectonic generation (a 4000 x 2400 map runs
     * fourteen passes over 9.6 million cells), so the eight neighbours are unrolled and the
     * bounds tests are only made for the cells near the grid's edge. The result is exactly that of
     * testing each neighbour in turn with its own bounds test.
     *
     * Its length and branching are the price of that speed, so it is deliberately left as one
     * function: moving the neighbour tests into helpers would add a call per neighbour per cell.
     */
    static #executeJFAPass(input, output, width, height, step) { // NOSONAR
        for (let y = 0; y < height; y++) {
            const rowInside = y - step >= 0 && y + step < height;
            for (let x = 0; x < width; x++) {
                const current = (y * width + x) * 2;
                let bestX = input[current];
                let bestY = input[current + 1];
                let bestDist = bestX !== -1 ? (x - bestX) * (x - bestX) + (y - bestY) * (y - bestY) : Infinity;

                if (rowInside && x - step >= 0 && x + step < width) {
                    // Every neighbour is on the grid
                    const up = current - step * width * 2;
                    const down = current + step * width * 2;
                    const side = step * 2;
                    for (let k = 0; k < 8; k++) {
                        // Kept as one nested conditional inside this per-pixel loop rather than a separate
                        // statement or helper: it picks the row above, below or the pixel's own
                        const neighbour = JFA_ORDER_ROW[k] < 0 ? up : JFA_ORDER_ROW[k] > 0 ? down : current; // NOSONAR
                        const index = neighbour + JFA_ORDER_COL[k] * side;
                        const seedX = input[index];
                        const seedY = input[index + 1];
                        if (seedX !== -1 && seedY !== -1) {
                            const dist = (x - seedX) * (x - seedX) + (y - seedY) * (y - seedY);
                            if (dist < bestDist) {
                                bestDist = dist;
                                bestX = seedX;
                                bestY = seedY;
                            }
                        }
                    }
                } else {
                    for (let k = 0; k < 8; k++) {
                        const nx = x + JFA_ORDER_COL[k] * step;
                        const ny = y + JFA_ORDER_ROW[k] * step;
                        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

                        const index = (ny * width + nx) * 2;
                        const seedX = input[index];
                        const seedY = input[index + 1];
                        if (seedX !== -1 && seedY !== -1) {
                            const dist = (x - seedX) * (x - seedX) + (y - seedY) * (y - seedY);
                            if (dist < bestDist) {
                                bestDist = dist;
                                bestX = seedX;
                                bestY = seedY;
                            }
                        }
                    }
                }

                output[current] = bestX;
                output[current + 1] = bestY;
            }
        }
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
    #applyGuidedDetail(width, height, params, frame, field, elevationData, plates = null, rowStart = 0, rowEnd = height) {
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

        for (let y = rowStart; y < rowEnd; y++) {
            for (let x = 0; x < width; x++) {
                // Noise position in world pixels, including the map's pan, and the matching
                // position in the coastline field (world pixels without the pan)
                const worldX = (x + panX) / zoom;
                const worldY = (y + panY) / zoom;
                const fieldX = frame.originX + x / zoom;
                const fieldY = frame.originY + y / zoom;
                // elevationData holds rows from rowStart on (see generateDetailRows)
                const index = (y - rowStart) * width + x;

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
        // Written as !(value > 0) on purpose: a missing or NaN value also fails the check,
        // whereas the equivalent-looking value <= 0 would let it through
        if (!(hills.height > 0) || distance >= hills.reach) return 0; // NOSONAR

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
        const boundaryTaper = 1.0 - this.#smoothstep(0, boundary.band, Math.abs(macroDistance));

        // Beyond the band the noise is multiplied by 0 and the distance comes back unchanged
        // (it is not 0 there, so adding a zero cannot change its sign), so the noise, the most
        // expensive part, is only read inside the band. About half of a typical map lies outside it.
        if (boundaryTaper === 0) return macroDistance;

        const boundaryNoise = this.#fbm(worldX + boundary.offsetX, worldY + boundary.offsetY, coastalVariance.OCTAVES, boundary.noiseScale, boundary.extraOctaves);
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
     * Near the map's left or right edge the point upwind can lie beyond the map. A regional map
     * then reads its parent's ground there (see UpwindMargin); any other map reads its edge column.
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
     *
     * @param {object|null} [upwindMargin] - A regional map's record of its parent's ground beyond
     *   its left and right edges (see UpwindMargin), as saved with the map, or null.
     */
    generateClimateData(elevationData, width, height, params, outMoisture, outTemperature, bounds = null, upwindMargin = null) {
        const climateBounds = ProceduralEngine.resolveBounds(bounds, width, height);
        const climate = this.prepareClimate(width, height, params, upwindMargin);
        this.#climateRows(climate, elevationData, outMoisture, outTemperature, climateBounds);
        return { moistureData: outMoisture, temperatureData: outTemperature };
    }

    /**
     * The climate of whole rows `rowStart` to `rowEnd` (exclusive), as generateClimateData
     * computes it, for one band of a whole-map pass shared between workers (see
     * GenerationWorkers). Moisture reads elevation only along its own row, so a band needs only
     * its own rows of elevation. `elevationRows` and both outputs hold just those rows, the band's
     * first row first.
     *
     * @param {Float32Array} elevationRows - Elevation of the band's rows.
     * @param {number} width - Map width in pixels.
     * @param {number} height - Map height in pixels (latitude runs over the whole map).
     * @param {object} params - Derived map parameters.
     * @param {Float32Array} outMoisture - Receives the band's moisture.
     * @param {Float32Array} outTemperature - Receives the band's temperature.
     * @param {number} rowStart - First row of the band.
     * @param {number} rowEnd - Row after the band's last.
     * @param {object|null} [upwindMargin] - As for generateClimateData.
     */
    generateClimateRows(elevationRows, width, height, params, outMoisture, outTemperature, rowStart, rowEnd, upwindMargin = null) {
        const climate = { ...this.prepareClimate(width, height, params, upwindMargin), rowOffset: rowStart };
        this.#climateRows(climate, elevationRows, outMoisture, outTemperature, { minX: 0, maxX: width - 1, minY: rowStart, maxY: rowEnd - 1 });
    }

    /** Fills moisture and temperature over `bounds`; buffers hold rows from `climate.rowOffset` on. */
    #climateRows(climate, elevationData, outMoisture, outTemperature, bounds) {
        for (let y = bounds.minY; y <= bounds.maxY; y++) {
            const rowBase = (y - climate.rowOffset) * climate.width;
            for (let x = bounds.minX; x <= bounds.maxX; x++) {
                outMoisture[rowBase + x] = this.getMoistureAt(climate, elevationData, x, y);
                outTemperature[rowBase + x] = this.getTemperatureAt(climate, elevationData, x, y);
            }
        }
    }

    /**
     * Resolves everything the climate of a pixel depends on that is the same for every pixel of
     * the map, so getMoistureAt and getTemperatureAt do not repeat it per pixel.
     *
     * @param {number} width - Map width in pixels.
     * @param {number} height - Map height in pixels.
     * @param {object} params - Derived map parameters.
     * @param {object|null} [upwindMargin] - A regional map's record of its parent's ground beyond
     *   its left and right edges (see UpwindMargin), as saved with the map, or null.
     * @returns {object} Settings to pass to getMoistureAt and getTemperatureAt.
     */
    prepareClimate(width, height, params, upwindMargin = null) {
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
            // The parent's ground beyond a regional map's left and right edges, read when the
            // point upwind lies off the map; null for any other map, which reads its edge column
            upwindMargin: UpwindMargin.decode(upwindMargin),
            // The row the elevation buffer starts at: 0 for a whole map, the band's first row for
            // one band of a pass shared between workers (see generateClimateRows)
            rowOffset: 0,
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
     * When the point upwind lies beyond the map's left or right edge, a regional map reads its
     * parent's ground there (see UpwindMargin), as its parent did; any other map reads its own
     * edge column.
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
        const elevation = elevationData[(y - climate.rowOffset) * climate.width + x];

        if (elevation > climate.seaLevel) {
            const absLat = Math.abs(this.#latitudeAt(climate, y));
            const windCellBlend = Math.cos(absLat * (Math.PI / 45));

            // Use the dynamically scaled wind distance
            const windDirectionX = climate.windDistance * windCellBlend;

            const upwindX = Math.round(x + windDirectionX);
            const offMap = upwindX < 0 || upwindX >= climate.width;
            const upwindElev = offMap && climate.upwindMargin ? UpwindMargin.sampleAt(climate.upwindMargin, upwindX, y) : elevationData[(y - climate.rowOffset) * climate.width + Math.max(0, Math.min(climate.width - 1, upwindX))];

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

        const elevation = elevationData[(y - climate.rowOffset) * climate.width + x];
        if (elevation > climate.seaLevel) {
            const altitude = (elevation - climate.seaLevel) / (1 - climate.seaLevel);
            temperature -= altitude * climate.altCooling;
        }

        return Math.max(0, Math.min(1, temperature));
    }

    /**
     * Paints the terrain's packed image (see TerrainShading): per pixel the relief, the water
     * depth and the land's height, which the terrain shader turns into the elevation colours,
     * the relief shading and the water. Colour itself is worked out on the GPU, so the relief
     * strength, the water settings and the layer switches never need a repaint.
     *
     * Water is the sea (below sea level) and lakes (the water mask). The sea's depth is measured
     * against the map's discovered lowest point (minTrough) rather than a fixed floor of 0, the
     * same pattern the land's height uses with maxPeak. On every map where nothing has carved
     * elevation below 0, minTrough is exactly 0 and depth reaches 1 exactly at elevation 0. Once
     * a hand-carved trench pushes minTrough below 0, ordinary seafloor at elevation 0 no longer
     * reads as the deepest water, so a deliberately deepened trench still reads as deeper than
     * the ordinary ocean instead of every point past the old floor looking the same. A lake is
     * measured down from its own surface and scaled by WATER.LAKE_DEPTH_SCALE, since lakes are
     * only a few thousandths of the elevation range deep.
     *
     * @param {Float32Array} elevationData - Elevation of the whole map.
     * @param {number} width - Map width in pixels.
     * @param {number} height - Map height in pixels.
     * @param {number} seaLevel - The map's sea level.
     * @param {Float32Array|null} waterMask - Lake surface elevation per pixel (0 where there is no lake).
     * @param {object} params - Map parameters (for the relief's scale on regional maps).
     * @param {Uint8Array} outBuffer - RGBA buffer of the whole map to paint into.
     * @param {object|null} [bounds] - Area to repaint, or null for the whole map.
     * @param {number} [maxPeak] - The map's highest elevation.
     * @param {number} [minTrough] - The map's lowest elevation (0 unless something went below it).
     * @param {number} [rowOffset] - The map row the buffers start at: 0 when they hold the whole
     *   map, or the first row of a band painted apart from the rest (see LayerPainting). A band's
     *   buffers must also hold the rows its painting reads and writes around it (see
     *   PAINT_HALO_ROWS).
     * @returns {Uint8Array} outBuffer.
     */
    paintTerrainAux(elevationData, width, height, seaLevel, waterMask, params, outBuffer, bounds = null, maxPeak = 1.0, minTrough = 0.0, rowOffset = 0) {
        const baseBounds = ProceduralEngine.resolveBounds(bounds, width, height);
        const renderBounds = ProceduralEngine.getRepaintBounds(baseBounds, width, height);
        const light = ProceduralEngine.#resolveReliefLight(params, width, height);

        // Prevent division by zero in the edge case of a completely flat map. The trough is only
        // ever lowered from 0 (see ProceduralOrchestrator.planRepaint), so a positive value could
        // only be a stale one; it is floored at 0 so it can never shrink the depth range.
        const safePeak = Math.max(maxPeak, seaLevel + ProceduralEngine.#MIN_LAND_RANGE);
        const landRange = safePeak - seaLevel;
        const seaRange = seaLevel - Math.min(0, minTrough);
        const lakeScale = FILRODENSWMB.DISPLAY.WATER.LAKE_DEPTH_SCALE;

        for (let y = renderBounds.minY; y <= renderBounds.maxY; y++) {
            for (let x = renderBounds.minX; x <= renderBounds.maxX; x++) {
                const i = (y - rowOffset) * width + x;
                const elevation = elevationData[i];
                const lakeSurface = waterMask ? waterMask[i] : 0;
                const isSea = elevation < seaLevel;
                const isWater = isSea || lakeSurface > 0;

                let depth = 0;
                if (isSea) depth = seaRange > 0 ? (seaLevel - elevation) / seaRange : 0;
                else if (isWater) depth = seaLevel > 0 ? ((lakeSurface - elevation) / seaLevel) * lakeScale : 0;

                const o = i * 4;
                outBuffer[o] = TerrainShading.encodeRelief(ProceduralEngine.#reliefChange(elevationData, x, y, width, height, light, rowOffset));
                outBuffer[o + 1] = TerrainShading.encodeDepth(depth, isWater);
                outBuffer[o + 2] = isWater ? 0 : TerrainShading.encodeHeight((elevation - seaLevel) / landRange);
                outBuffer[o + 3] = 255;
            }
        }
        return outBuffer;
    }

    /** The smallest range of land height the height shading is spread over, so a flat map does not divide by zero. */
    static #MIN_LAND_RANGE = 0.01;

    /**
     * The light that relief shading is worked out with, the same across the whole map.
     *
     * Slopes are measured per pixel of a BASELINE_DIMENSION map rather than per pixel of this
     * map, so the same terrain is shaded equally strongly at any size or zoom: a 4000 pixel map,
     * or a x4 regional map, spreads each slope over four times as many pixels, which would
     * otherwise make it look four times flatter. The map at the top of the chain of crops sets
     * that scale (params.terrain.world); a map without one is its own top map.
     *
     * @returns {{slopeScale: number, lightX: number, lightY: number, lightZ: number}}
     */
    static #resolveReliefLight(params, width, height) {
        const display = FILRODENSWMB.DISPLAY;
        const world = params?.terrain?.world;
        const rootSize = world ? Math.max(world.rootW, world.rootH) : Math.max(width, height);
        const pixelsPerBaseline = ((world?.zoom ?? 1) * rootSize) / FILRODENSWMB.LIMITS.BASELINE_DIMENSION;

        // The light's direction is a fixed compass bearing (0 from the north, the top of the map,
        // turning clockwise), and it shines down from RELIEF.ALTITUDE degrees above the horizon
        const bearing = (display.LIGHT_DIRECTION * Math.PI) / 180;
        const altitude = (display.RELIEF.ALTITUDE * Math.PI) / 180;

        return {
            slopeScale: display.RELIEF.EXAGGERATION * pixelsPerBaseline,
            lightX: Math.sin(bearing) * Math.cos(altitude),
            lightY: -Math.cos(bearing) * Math.cos(altitude),
            lightZ: Math.sin(altitude),
        };
    }

    /**
     * Relief shading's measure of one pixel: how much more or less directly the ground faces the
     * light than flat ground does, as a share of flat ground's lighting (0 on flat ground,
     * positive on slopes facing the light, negative on those facing away). The terrain shader
     * multiplies the pixel's colour by 1 + this x the relief strength (within the limits in
     * DISPLAY.RELIEF), so shading brings out the shape of the ground as well as its height
     * while leaving plains and still water exactly their own colour. Without it, a pixel's
     * shade depends on its height alone, and hills a little higher than their surroundings are
     * only a little lighter, so fine detail blends into soft gradients.
     *
     * The slope comes from the heights either side of the pixel (clamped at the map's edges).
     * The sea floor and lake beds are measured too, which shows their ridges, trenches and
     * slopes through the water. `elevationData` starts at map row `rowOffset` (see
     * paintTerrainAux).
     */
    static #reliefChange(elevationData, x, y, width, height, light, rowOffset) {
        const row = (y - rowOffset) * width;
        const left = elevationData[row + Math.max(0, x - 1)];
        const right = elevationData[row + Math.min(width - 1, x + 1)];
        const up = elevationData[(Math.max(0, y - 1) - rowOffset) * width + x];
        const down = elevationData[(Math.min(height - 1, y + 1) - rowOffset) * width + x];

        // The surface normal of the ground, from its slope across and down the map
        const slopeX = ((right - left) / 2) * light.slopeScale;
        const slopeY = ((down - up) / 2) * light.slopeScale;
        const facing = (-slopeX * light.lightX - slopeY * light.lightY + light.lightZ) / Math.hypot(slopeX, slopeY, 1);

        return (facing - light.lightZ) / light.lightZ;
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
     * Evaluates elevation and climate to determine the precise Biome key. Below sea level this is
     * the biome seen from above: Pack Ice where the surface freezes, otherwise the sea bed's
     * biome (see getOverwaterBiomeKey and getUnderwaterBiomeKey, which resolve the two apart).
     */
    static getBiomeKey(elevation, moisture, temp, seaLevel) {
        const tempLimits = FILRODENSWMB.CLIMATE.THRESHOLDS.TEMPERATURE;

        if (elevation < seaLevel) return ProceduralEngine.getOverwaterBiomeKey(temp) ?? ProceduralEngine.getUnderwaterBiomeKey(elevation, seaLevel);
        if (temp < tempLimits.ARCTIC) return ProceduralEngine.#getArcticBiome(moisture);
        if (temp < tempLimits.SUBARCTIC) return ProceduralEngine.#getSubArcticBiome(moisture);
        if (temp < tempLimits.TEMPERATE) return ProceduralEngine.#getTemperateBiome(moisture);

        return ProceduralEngine.#getTropicalBiome(moisture);
    }

    /**
     * The built-in biome of the bed under the water: Deep Ocean past CLIMATE.DEEP_OCEAN_DEPTH of
     * the sea level, Shallow Ocean above it, at every temperature (ice, where there is any, lies
     * on the surface over it; see getOverwaterBiomeKey).
     *
     * Deliberately keeps depth relative to seaLevel alone, unlike the water's shading (see
     * paintTerrainAux), which also normalises against the map's discovered lowest point. This is a binary
     * classification (past the split or not), not a continuous shade, so a trench well below
     * the old floor still correctly reads as deep and classifies as DEEP_OCEAN with no need to
     * know how much further down the trough actually goes. A lake bed lies above sea level, so
     * its depth here is never positive and it is always Shallow Ocean.
     * @param {number} elevation
     * @param {number} seaLevel
     * @returns {string} A key of FILRODENSWMB.BIOMES.
     */
    static getUnderwaterBiomeKey(elevation, seaLevel) {
        const depth = seaLevel > 0 ? (seaLevel - elevation) / seaLevel : 0;
        return depth > FILRODENSWMB.CLIMATE.DEEP_OCEAN_DEPTH ? "DEEP_OCEAN" : "SHALLOW_OCEAN";
    }

    /**
     * The built-in biome on the surface of the water: Pack Ice where the water freezes, and
     * nothing (open water) elsewhere.
     * @param {number} temp
     * @returns {string|null} A key of FILRODENSWMB.BIOMES, or null for open water.
     */
    static getOverwaterBiomeKey(temp) {
        return temp < FILRODENSWMB.CLIMATE.FREEZING_THRESHOLD ? "PACK_ICE" : null;
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
     * The result resolveBiomeLookup fills in. One object is reused for every call (the biome
     * painters call it for every pixel of the map), so a caller must read what it needs before
     * the next call.
     */
    static #lookup = { land: null, underwater: null, overwater: null, visible: null, isFallback: false };

    /**
     * Decides which biomes a pixel shows. A pixel of dry land shows one biome. A pixel under
     * water (below sea level, or part of a lake) shows two independently: the biome of the bed
     * under the water and, optionally, one on the water's surface (Pack Ice over Deep Ocean, for
     * example; open water leaves the surface empty).
     *
     * Each is resolved in priority order: a hand-painted override always wins; failing that, a
     * matching custom auto-generation rule (see BiomeRuleEngine); failing that, the built-in
     * default (getBiomeKey on land, getUnderwaterBiomeKey and getOverwaterBiomeKey under and over
     * water). Every step obeys the biome's placement (see BiomePlacement): an override or rule
     * biome that may not appear on a side is passed over there, so a land biome never shows
     * under water and a sea biome never shows on dry land. An override that does not fit is
     * ignored rather than erased, so if the ground is later raised or lowered back across sea
     * level, the paint shows again. A pixel holds one override, so painting Pack Ice over painted
     * coral replaces the coral; the bed under the ice then falls back to its rule or default.
     *
     * An override only wins if `biomePalette` can still resolve it to a colour and it has a
     * placement in `biomeSides`. Deleting a custom biome (MapDialogManager#onDeleteCustomBiome)
     * deliberately leaves its old ID sitting in painted pixels and brush strokes rather than
     * scrubbing it out everywhere, so undo/redo only ever has to snapshot uiState.customBiomes
     * and never needs to touch raster data at all - bringing the biome back (by undo, or a fresh
     * biome that happens to reuse the ID) makes the old paint reappear on its own. The other side
     * of that deal is here: an override ID that doesn't currently resolve to anything is treated
     * exactly like "never painted" and falls through to a custom rule match or the built-in
     * default, instead of the caller falling back to a solid black square for a colour that will
     * never exist.
     * @param {object} [biomePalette] - id/name -> RGB map for the map's current biomes (built-in
     * plus custom), as compiled fresh every repaint by MapStateManager.getDerivedMapParameters.
     * @param {Uint8Array} biomeSides - BIOME_SIDE flags by biome id (BiomePlacement.buildSidesTable),
     * compiled the same way as biomePalette.
     * @returns {{land: (string|number|null), underwater: (string|number|null), overwater: (string|number|null), visible: (string|number), isFallback: boolean}}
     * `land` is set only on dry land, `underwater` only under water, `overwater` only where the
     * water's surface has a biome. `visible` is the one seen from above (the surface biome if
     * there is one, otherwise the bed's or the land's), which is what the hover readout and the
     * grid data export report. `isFallback` is true when `visible` came from the built-in
     * default - a hand-painted override or a matching custom rule both count as "covered". This
     * is what the "Preview Rule Coverage" highlight (MapStudioApp's hover button, see
     * createBiomesMap's optional `outFallbackBuffer` below) tints: exactly the pixels a GM's
     * custom rule set doesn't reach. The returned object is reused (see #lookup).
     */
    static resolveBiomeLookup(overrideId, elevation, moisture, temp, seaLevel, waterMask, pixelIndex, customBiomeRules, biomePalette, biomeSides) {
        const result = ProceduralEngine.#lookup;
        result.land = null;
        result.underwater = null;
        result.overwater = null;
        result.isFallback = false;

        const overrideSides = overrideId > 0 && biomePalette?.[overrideId] ? (biomeSides?.[overrideId] ?? 0) : 0;
        const isWater = elevation < seaLevel || (waterMask ? waterMask[pixelIndex] > 0 : false);

        if (isWater) {
            ProceduralEngine.#resolveWaterBiomes(result, overrideId, overrideSides, elevation, moisture, temp, seaLevel, customBiomeRules);
        } else {
            ProceduralEngine.#resolveLandBiome(result, overrideId, overrideSides, elevation, moisture, temp, seaLevel, customBiomeRules);
        }
        return result;
    }

    /** The land side of resolveBiomeLookup: override, then rule, then default. */
    static #resolveLandBiome(result, overrideId, overrideSides, elevation, moisture, temp, seaLevel, customBiomeRules) {
        if (overrideSides & BIOME_SIDE.LAND) {
            result.land = overrideId;
        } else {
            const ruleId = customBiomeRules ? BiomeRuleEngine.matchBiomeId(customBiomeRules, elevation, moisture, temp, BIOME_SIDE.LAND) : 0;
            result.land = ruleId > 0 ? ruleId : ProceduralEngine.getBiomeKey(elevation, moisture, temp, seaLevel);
            result.isFallback = ruleId === 0;
        }
        result.visible = result.land;
    }

    /**
     * The water side of resolveBiomeLookup: the bed and the surface, each by override, then
     * rule, then default. The surface default is often empty (open water), in which case the bed
     * is what is seen from above.
     */
    static #resolveWaterBiomes(result, overrideId, overrideSides, elevation, moisture, temp, seaLevel, customBiomeRules) {
        let bedFromDefault = false;
        if (overrideSides & BIOME_SIDE.UNDERWATER) {
            result.underwater = overrideId;
        } else {
            const ruleId = customBiomeRules ? BiomeRuleEngine.matchBiomeId(customBiomeRules, elevation, moisture, temp, BIOME_SIDE.UNDERWATER) : 0;
            result.underwater = ruleId > 0 ? ruleId : ProceduralEngine.getUnderwaterBiomeKey(elevation, seaLevel);
            bedFromDefault = ruleId === 0;
        }

        let surfaceFromDefault = false;
        if (overrideSides & BIOME_SIDE.OVERWATER) {
            result.overwater = overrideId;
        } else {
            const ruleId = customBiomeRules ? BiomeRuleEngine.matchBiomeId(customBiomeRules, elevation, moisture, temp, BIOME_SIDE.OVERWATER) : 0;
            result.overwater = ruleId > 0 ? ruleId : ProceduralEngine.getOverwaterBiomeKey(temp);
            surfaceFromDefault = ruleId === 0;
        }

        const hasSurface = result.overwater !== null;
        result.visible = hasSurface ? result.overwater : result.underwater;
        result.isFallback = hasSurface ? surfaceFromDefault : bedFromDefault;
    }

    /**
     * VISUAL PASS: paints the biome layers from temperature, moisture, painted biomes and rules.
     *
     * `outBuffer` receives what lies on top: the land's biome on dry ground, and on water the
     * biome on the water's surface (such as Pack Ice), transparent over open water.
     * `outUnderwaterBuffer`, when given, receives the biome of the bed under the water,
     * transparent on dry ground. The terrain shader (see TerrainShading) draws the bed under the
     * water and the surface biome over it.
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
     * @param {Uint8Array} [outUnderwaterBuffer] - optional RGBA buffer for the beds' biomes.
     * @param {number} [rowOffset] - The map row the buffers start at: 0 when they hold the whole
     *   map, or the first row of a band painted apart from the rest (see LayerPainting). A band's
     *   buffers must also hold the rows its painting reads and writes around it (see
     *   PAINT_HALO_ROWS).
     */
    createBiomesMap(elevationData, moistureData, temperatureData, biomeOverrideData, width, height, seaLevel, waterMask, params, outBuffer, bounds = null, outFallbackBuffer = null, outUnderwaterBuffer = null, rowOffset = 0) {
        const baseBounds = ProceduralEngine.resolveBounds(bounds, width, height);
        const renderBounds = ProceduralEngine.getRepaintBounds(baseBounds, width, height);
        const [fbR, fbG, fbB] = FILRODENSWMB.DISPLAY.FALLBACK_HIGHLIGHT_COLOR;
        const fbAlpha = Math.round(FILRODENSWMB.DISPLAY.FALLBACK_HIGHLIGHT_ALPHA * 255);
        const palette = params?.biomePalette;

        for (let y = renderBounds.minY; y <= renderBounds.maxY; y++) {
            for (let x = renderBounds.minX; x <= renderBounds.maxX; x++) {
                const i = (y - rowOffset) * width + x;
                const bufferIndex = i * 4;

                const overrideId = biomeOverrideData ? biomeOverrideData[i] : 0;
                const { land, underwater, overwater, isFallback } = ProceduralEngine.resolveBiomeLookup(
                    overrideId, elevationData[i], moistureData[i], temperatureData[i], seaLevel, waterMask, i, params?.customBiomeRules, palette,
                    params?.biomeSides,
                );

                if (outFallbackBuffer) {
                    outFallbackBuffer[bufferIndex] = isFallback ? fbR : 0;
                    outFallbackBuffer[bufferIndex + 1] = isFallback ? fbG : 0;
                    outFallbackBuffer[bufferIndex + 2] = isFallback ? fbB : 0;
                    outFallbackBuffer[bufferIndex + 3] = isFallback ? fbAlpha : 0;
                }

                ProceduralEngine.#writeBiomeColour(outBuffer, bufferIndex, land ?? overwater, palette);
                if (outUnderwaterBuffer) ProceduralEngine.#writeBiomeColour(outUnderwaterBuffer, bufferIndex, underwater, palette);
            }
        }
        return outBuffer;
    }

    /** Writes a biome's colour into an RGBA buffer, or transparency for no biome (null). */
    static #writeBiomeColour(buffer, bufferIndex, lookupKey, palette) {
        if (lookupKey === null) {
            buffer[bufferIndex] = 0;
            buffer[bufferIndex + 1] = 0;
            buffer[bufferIndex + 2] = 0;
            buffer[bufferIndex + 3] = 0;
            return;
        }

        const color = palette?.[lookupKey] ?? FILRODENSWMB.BIOMES[lookupKey] ?? [0, 0, 0];
        buffer[bufferIndex] = color[0];
        buffer[bufferIndex + 1] = color[1];
        buffer[bufferIndex + 2] = color[2];
        buffer[bufferIndex + 3] = 255;
    }

    /**
     * Traces every river: first the custom rivers drawn under the current river rules
     * (`authoredRivers`, see #traceAuthored), then one from every spring pin.
     *
     * @param {object[]} [authoredRivers] - From HydrologyEngine.authoredRivers: `{ pixels, inflow }`.
     * @returns {{vectors: object[], waterMask: Float32Array}} The rivers (`{ id, path, mergeInto,
     *   inflow, authored }`, where `authored` is how many steps follow a custom river's line) and
     *   the water mask.
     */
    generateRivers(elevationData, moistureData, temperatureData, mapPins, width, height, params, outRiverMap, outWaterMask, authoredRivers = []) {
        const seaLevel = params.seaLevel ?? FILRODENSWMB.DEFAULTS.SEA_LEVEL;

        const riverMap = outRiverMap;
        const waterMask = outWaterMask;

        riverMap.fill(0);
        waterMask.fill(0);

        // Intialise static buffers once per size-change to eliminate Garbage Collection spikes
        const totalPixels = width * height;
        if (this.riverVisitedBuffer?.length !== totalPixels) {
            this.riverVisitedBuffer = new Uint32Array(totalPixels);
            this.basinVisitedBuffer = new Uint32Array(totalPixels);
            this.riverOwnerBuffer = new Int32Array(totalPixels);
        } else {
            this.riverOwnerBuffer.fill(0);
        }

        this.riverTraceId = 0;
        this.basinTraceId = 0;
        this.riverRecords = [];
        // Which trace rules this map uses (see TerrainVersion.usesCurrentRivers), and the largest
        // lake they allow (see HYDROLOGY.MAX_LAKE_AREA)
        this.currentRiverRules = params?.terrain?.currentRivers === true;
        this.maxLakePixels = this.#maxLakePixels(params, width, height);
        this.loopLakePixels = this.#loopLakePixels(params, width, height);
        this.breachPixels = ProceduralEngine.#worldArea(FILRODENSWMB.HYDROLOGY.BREACH_AREA, params, width, height);
        // Which pixels below sea level are open sea (see #isSea), worked out as rivers reach them
        this.seaKind = this.currentRiverRules ? new Uint8Array(totalPixels) : null;

        // 1. Custom rivers drawn under the current river rules, before any spring
        for (const authored of authoredRivers) {
            if (!authored.pixels?.length) continue;
            const first = authored.pixels[0];
            this.riverTracePrng = ProceduralEngine.#mulberry32(ProceduralEngine.#riverSeed(this.seedNumber, first.y * width + first.x));
            this.riverTraceId++;
            const record = { ownerId: this.riverRecords.length + 1, path: [], indexOf: new Map(), mergeInto: null, inflow: authored.inflow ?? 0 };
            this.riverRecords.push(record);
            record.kept = this.#traceAuthored(authored, record, elevationData, temperatureData, width, height, seaLevel, riverMap, waterMask, params);
        }

        // 2. Springs, from the pins
        const finalSprings = this.#parseSpringPins(mapPins, width, height);

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
            const record = { ownerId: this.riverRecords.length + 1, path: [], indexOf: new Map(), mergeInto: null, inflow: spring.inflow ?? 0 };
            this.riverRecords.push(record);
            record.kept = !!this.#traceRiver(spring.x, spring.y, elevationData, temperatureData, width, height, seaLevel, riverMap, waterMask, params, record);
        }

        // 3. The rivers kept, each knowing the river (and the step of it) it flows into
        const rivers = [];
        for (const record of this.riverRecords) {
            if (!record.kept) continue;
            record.id = `river_${rivers.length}`;
            rivers.push(record);
        }
        const vectors = rivers.map((record) => {
            const target = record.mergeInto?.record;
            const mergeInto = target?.kept ? { id: target.id, index: record.mergeInto.index } : null;
            return { id: record.id, path: record.path, mergeInto, inflow: record.inflow, authored: record.authored ?? 0 };
        });
        this.riverRecords = null;

        return { vectors, waterMask: waterMask };
    }

    /**
     * The largest lake in this map's pixels. The current river rules measure it in the world
     * (MAX_LAKE_AREA square pixels of a BASELINE_DIMENSION map), so a regional map, whose basins
     * cover more pixels, allows lakes of the same size in the world as its parent. Maps made
     * before them keep the pixel limit they saved.
     */
    #maxLakePixels(params, width, height) {
        if (!this.currentRiverRules) return params?.hydrology?.maxLakeSize ?? FILRODENSWMB.HYDROLOGY.MAX_LAKE_SIZE;
        return ProceduralEngine.#worldArea(FILRODENSWMB.HYDROLOGY.MAX_LAKE_AREA, params, width, height);
    }

    /** The largest lake that floods its river's own course (see #fillBasin), in this map's pixels. */
    #loopLakePixels(params, width, height) {
        return ProceduralEngine.#worldArea(FILRODENSWMB.HYDROLOGY.LOOP_LAKE_AREA, params, width, height);
    }

    /** An area in square pixels of a BASELINE_DIMENSION map, in this map's pixels. */
    static #worldArea(area, params, width, height) {
        const world = params?.terrain?.world;
        const rootSize = world?.rootW && world?.rootH ? Math.max(world.rootW, world.rootH) : Math.max(width, height);
        const pixelsPerBaseline = ((world?.zoom ?? 1) * rootSize) / FILRODENSWMB.LIMITS.BASELINE_DIMENSION;
        return Math.round(area * pixelsPerBaseline * pixelsPerBaseline);
    }

    /**
     * The springs to trace from. A pin outside the map is left out: a regional map keeps the
     * pins just beyond its edge (see RegionalExtractor), but a river traced from outside the map
     * has no ground to run on.
     */
    #parseSpringPins(mapPins, width, height) {
        const finalSprings = [];
        if (!mapPins) return finalSprings;

        for (const pin of mapPins) {
            if (pin.type !== "spring" || pin.visibility === "none") continue;
            const x = Math.round(pin.x);
            const y = Math.round(pin.y);
            if (x < 0 || y < 0 || x >= width || y >= height) continue;
            finalSprings.push({ x, y, inflow: pin.inflow ?? 0 });
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
     *
     * The coast's shoreline is drawn on the same layer (see #drawShoreline), so it follows the
     * Contours switch. It is drawn even when the contour interval is off.
     *
     * @param {number} [rowOffset] - The map row the buffers start at: 0 when they hold the whole
     *   map, or the first row of a band painted apart from the rest (see LayerPainting). A band's
     *   buffers must also hold the rows its painting reads and writes around it (see
     *   PAINT_HALO_ROWS).
     */
    createContourMap(elevationData, width, height, interval, seaLevel, outBuffer, bounds = null, rowOffset = 0) {
        const baseBounds = ProceduralEngine.resolveBounds(bounds, width, height);
        const contourBounds = ProceduralEngine.getRepaintBounds(baseBounds, width, height);

        // Targeted erasure of the rendering zone instead of a full buffer wipe
        for (let y = contourBounds.minY; y <= contourBounds.maxY; y++) {
            for (let x = contourBounds.minX; x <= contourBounds.maxX; x++) {
                const idx = ((y - rowOffset) * width + x) * 4;
                outBuffer[idx] = 0;
                outBuffer[idx + 1] = 0;
                outBuffer[idx + 2] = 0;
                outBuffer[idx + 3] = 0;
            }
        }

        if (interval > 0) ProceduralEngine.#drawContourLines(elevationData, width, height, interval, seaLevel, outBuffer, contourBounds, rowOffset);
        ProceduralEngine.#drawShoreline(elevationData, width, height, seaLevel, outBuffer, contourBounds, rowOffset);
        return outBuffer;
    }

    /** The contour lines themselves (see createContourMap). */
    static #drawContourLines(elevationData, width, height, interval, seaLevel, outBuffer, contourBounds, rowOffset) {
        const maxY = Math.min(contourBounds.maxY, height - 2);
        const maxX = Math.min(contourBounds.maxX, width - 2);

        for (let y = contourBounds.minY; y <= maxY; y++) {
            for (let x = contourBounds.minX; x <= maxX; x++) {
                const index = (y - rowOffset) * width + x;
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
     * The shoreline: where dry ground meets the sea, the dry pixel is darkened and the sea pixel
     * lightened (DISPLAY.SHORELINE), so the coast reads clearly against the relief-shaded land and
     * the see-through shallows. Contour lines only mark multiples of the contour interval, which
     * sea level is usually not, so without this the coast has no line of its own. A pixel is on
     * the shore when one of its four direct neighbours is on the other side; the shoreline is
     * drawn over any contour line there.
     *
     * Lakes get no shoreline. Rivers run into and out of them, and a line around a lake cut
     * across the river at both ends, so the lake read as a break in the river rather than part
     * of it.
     *
     * Every pixel it writes lies inside `contourBounds`, and a pixel's shore status depends only
     * on its direct neighbours, which the repaint margin (DISPLAY.REPAINT_MARGIN) covers.
     */
    static #drawShoreline(elevationData, width, height, seaLevel, outBuffer, contourBounds, rowOffset) {
        const shore = FILRODENSWMB.DISPLAY.SHORELINE;
        const dryAlpha = Math.round(shore.DRY_ALPHA * 255);
        const wetAlpha = Math.round(shore.WET_ALPHA * 255);
        const water = { elevationData, seaLevel };

        for (let y = contourBounds.minY; y <= contourBounds.maxY; y++) {
            for (let x = contourBounds.minX; x <= contourBounds.maxX; x++) {
                const index = (y - rowOffset) * width + x;
                const wet = ProceduralEngine.#isWaterAt(water, index);
                if (!ProceduralEngine.#isShore(water, width, height, x, y, wet, index)) continue;

                const colour = wet ? shore.WET_COLOUR : shore.DRY_COLOUR;
                const o = index * 4;
                outBuffer[o] = colour[0];
                outBuffer[o + 1] = colour[1];
                outBuffer[o + 2] = colour[2];
                outBuffer[o + 3] = wet ? wetAlpha : dryAlpha;
            }
        }
    }

    /** Whether a pixel is in the sea (below sea level). */
    static #isWaterAt(water, index) {
        return water.elevationData[index] < water.seaLevel;
    }

    /**
     * Whether any of a pixel's four direct neighbours (inside the map) is on the other side of the
     * water's edge. `index` is the pixel's place in the elevation buffer, which may start at a
     * later row than the map (see createContourMap).
     */
    static #isShore(water, width, height, x, y, wet, index) {
        if (x > 0 && ProceduralEngine.#isWaterAt(water, index - 1) !== wet) return true;
        if (x < width - 1 && ProceduralEngine.#isWaterAt(water, index + 1) !== wet) return true;
        if (y > 0 && ProceduralEngine.#isWaterAt(water, index - width) !== wet) return true;
        return y < height - 1 && ProceduralEngine.#isWaterAt(water, index + width) !== wet;
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
     *
     * `rowOffset` is the grid row `mesh` starts at, for a field holding only some of its rows (see
     * detailJobForRows); positions are still given in rows of the whole grid, so the result is
     * exactly what the whole grid gives.
     */
    #bilinearSample(mesh, width, height, x, y, rowOffset = 0) {
        const x1 = Math.floor(x);
        const y1 = Math.floor(y);
        const x2 = Math.min(x1 + 1, width - 1);
        const y2 = Math.min(y1 + 1, height - 1);

        const dx = x - x1;
        const dy = y - y1;

        const row1 = (y1 - rowOffset) * width;
        const row2 = (y2 - rowOffset) * width;
        const p00 = mesh[row1 + x1];
        const p10 = mesh[row1 + x2];
        const p01 = mesh[row2 + x1];
        const p11 = mesh[row2 + x2];

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
