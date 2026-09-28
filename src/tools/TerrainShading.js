import { FILRODENSWMB } from "../config.js";

/**
 * How the terrain is drawn: the maths that turns the painted layers (the biome colours and one
 * packed image of relief, water depth and land height) into the colour of each pixel of the map.
 *
 * The same maths exists twice here, deliberately side by side: as GLSL (fragmentSource), which the
 * map canvas runs on the GPU (see TerrainCompositor), and as plain JavaScript (shade), which runs
 * the identical steps for one pixel on the CPU so the result can be checked and turned into images
 * outside Foundry. Any change to one must be made to the other.
 *
 * Why the GPU does it: relief shading both brightens and darkens, so it cannot be drawn as an
 * ordinary see-through layer (a multiply blend can only darken). Mixing the layers on the CPU
 * would make every layer switch, biome opacity change and relief slider move repaint the whole
 * map; as shader settings they cost nothing.
 *
 * Per pixel, in order:
 *   1. Ground: the land's grey height ramp (or the flat land colour when Elevation is off); under
 *      water (sea or lake), plain sediment.
 *   2. Biomes: the land biome on dry ground (Land Biomes), the bed's biome under water (Sea
 *      Biomes), each over the ground at the biome opacity.
 *   3. Relief shading on the result, so it shows as strongly through a biome as without one.
 *   4. Water over the sea and lakes: a colour that darkens with depth (leaning turquoise in the
 *      shallows, turned to the map's tint), itself carrying a share of the relief shading, laid
 *      over the bed more thickly the deeper it is, so shallows show the bed and the deep sea
 *      mostly the water.
 *   5. Rivers over dry ground, from the river image (see below): shallow water of the same
 *      colour and tint as the sea and lakes, deepening towards the middle of a wide river, over
 *      a sediment bed that carries the relief shading, or ice where the river is frozen. They
 *      are part of the Water layer. Where a river meets a lake or the sea the water takes over,
 *      except across a pool (a lake too small to stop a river), where the river is drawn on.
 *   6. Surface biomes (Pack Ice and the like) on top of the water (Land Biomes).
 *
 * The river image (see RiverNetwork.rasterise) holds, per pixel, as bytes:
 *   R - a distance field: how far the pixel is from the nearest river's edge. Filtered linearly
 *       and compared with the size of a screen pixel in map pixels (the footprint), it gives a
 *       river edge that is sharp and smooth at any zoom, rather than the map's pixel steps.
 *   G - how frozen the river there is (255 ice).
 *   B - 255 on and around a pool, where the river is drawn over the water.
 *   A - always 255 (as for the packed image).
 *
 * The packed image ("aux") holds, per pixel, as bytes:
 *   R - the relief: how much more or less directly the ground faces the light than flat ground
 *       does (see ProceduralEngine#reliefChange), square-root encoded so small slopes keep
 *       precision (see encodeRelief).
 *   G - the water depth: 0 on dry ground, otherwise 1-255, square-root encoded (see encodeDepth).
 *       The texture is filtered linearly when the map is zoomed in, so along a shore G blends
 *       smoothly between 0 and the first water value and the shore is soft rather than jagged.
 *   B - the land's height, 0-255 for sea level to the map's highest point (see encodeHeight).
 *   A - always 255, so the GPU's premultiplied alpha leaves the other three untouched.
 */

const TERRAIN = FILRODENSWMB.DISPLAY.TERRAIN;
const WATER = FILRODENSWMB.DISPLAY.WATER;
const RELIEF = FILRODENSWMB.DISPLAY.RELIEF;
const RIVER = FILRODENSWMB.DISPLAY.RIVER;

/** The largest relief value the packed image can hold either way; beyond it shading is clamped at any useful strength. */
const RELIEF_RANGE = 2.6;
/** Half the byte range, the relief byte's zero point. */
const BYTE_MID = 127.5;
/** Water depth bytes: 0 is dry ground, 1 to DEPTH_STEPS + 1 the depths. */
const DEPTH_STEPS = 254;
const MAX_BYTE = 255;

/** Bounds of the water's share of the bed seen through it (FLOOR scaled by clarity may not reach 1). */
const MAX_FLOOR = 0.9;
const MIN_CLARITY = 0.1;
/** The narrowest a river's soft edge gets when zoomed far in, in map pixels. */
const MIN_FOOTPRINT = 0.05;

/** RGB to YIQ and back, for turning the water's hue and saturation (see #tint). */
const YIQ = Object.freeze({
    Y: [0.299, 0.587, 0.114],
    I: [0.596, -0.274, -0.322],
    Q: [0.211, -0.523, 0.312],
    R: [1, 0.956, 0.621],
    G: [1, -0.272, -0.647],
    B: [1, -1.106, 1.703],
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const mix = (a, b, t) => a + (b - a) * t;

export class TerrainShading {
    // ----------------------------------------------------------------- packing (CPU side)

    /**
     * The relief byte for a relief value. Square-root encoding spends most of the 256 steps on
     * gentle slopes, where a step would otherwise show as banding; steep slopes are clamped by
     * the shading limits long before their precision matters.
     * @param {number} change - See ProceduralEngine#reliefChange.
     * @returns {number} 0-255.
     */
    static encodeRelief(change) {
        const scaled = Math.sqrt(Math.min(Math.abs(change), RELIEF_RANGE) / RELIEF_RANGE);
        return clamp(Math.round(BYTE_MID + BYTE_MID * Math.sign(change) * scaled), 0, MAX_BYTE);
    }

    /** The relief value a relief byte holds (the inverse of encodeRelief). */
    static decodeRelief(byte) {
        const s = (byte - BYTE_MID) / BYTE_MID;
        return Math.sign(s) * s * s * RELIEF_RANGE;
    }

    /**
     * The depth byte: 0 for dry ground, otherwise 1 + the square root of the depth (0-1) spread
     * over the remaining steps, so the shallows (where the water's look changes fastest) get the
     * finest steps.
     * @param {number} depth - 0 at the shore to 1 at the deepest.
     * @param {boolean} isWater
     * @returns {number} 0-255.
     */
    static encodeDepth(depth, isWater) {
        if (!isWater) return 0;
        return 1 + Math.round(Math.sqrt(clamp(depth, 0, 1)) * DEPTH_STEPS);
    }

    /** How wet a depth byte is: 0 on dry ground, 1 under water (fractional only where the GPU blends a shore). */
    static wetness(byte) {
        return clamp(byte, 0, 1);
    }

    /** The depth a depth byte holds (the inverse of encodeDepth), 0 on dry ground. */
    static decodeDepth(byte) {
        const t = Math.max(byte - 1, 0) / DEPTH_STEPS;
        return t * t;
    }

    /**
     * How far a point is from the nearest river's edge, in map pixels (negative inside the
     * river), from the river image's distance byte (see RiverNetwork.rasterise).
     * @param {number} byte - 0-255, may be fractional where the GPU blends.
     * @returns {number}
     */
    static riverEdge(byte) {
        return RIVER.FIELD_RANGE - (2 * RIVER.FIELD_RANGE * byte) / MAX_BYTE;
    }

    /**
     * The height byte: the land's height as a share of the way from sea level to the map's
     * highest point.
     * @param {number} share - 0 to 1.
     * @returns {number} 0-255.
     */
    static encodeHeight(share) {
        return Math.round(clamp(share, 0, 1) * MAX_BYTE);
    }

    // ----------------------------------------------------------------- settings

    /**
     * The shading settings with every layer on and the module's default water.
     * @param {object} [overrides] - Values to use instead.
     * @returns {{elevation: boolean, relief: boolean, water: boolean, landBiomes: boolean, seaBiomes: boolean, biomeAlpha: number, reliefStrength: number, seabedRelief: number, clarity: number, hueShift: number, saturation: number}}
     */
    static defaultSettings(overrides = {}) {
        return {
            elevation: true,
            relief: true,
            water: true,
            landBiomes: true,
            seaBiomes: true,
            biomeAlpha: FILRODENSWMB.DISPLAY.BIOME_ALPHA_INACTIVE,
            reliefStrength: FILRODENSWMB.DISPLAY.RELIEF_SHADING,
            seabedRelief: WATER.SEABED_RELIEF,
            clarity: WATER.CLARITY,
            hueShift: WATER.HUE - WATER.BASE_HUE,
            saturation: WATER.SATURATION,
            ...overrides,
        };
    }

    // ----------------------------------------------------------------- CPU reference

    /**
     * The colour of one pixel, by exactly the steps the GPU takes (see fragmentSource). Inputs
     * are straight (not premultiplied) bytes.
     * @param {number[]} aux - The packed bytes [relief, depth, height].
     * @param {number[]} surface - RGBA of the land or surface biome (alpha 0 for none).
     * @param {number[]} underwater - RGBA of the bed's biome (alpha 0 for none).
     * @param {object} settings - See defaultSettings.
     * @param {number[]|null} [river] - The river image's bytes [distance, ice, pool], or null for none.
     * @param {number} [footprint] - How many map pixels one screen pixel covers.
     * @returns {number[]} RGB, 0-255.
     */
    static shade(aux, surface, underwater, settings, river = null, footprint = 1) {
        const wet = TerrainShading.wetness(aux[1]);
        const depth = TerrainShading.decodeDepth(aux[1]);
        const change = TerrainShading.decodeRelief(aux[0]);
        const on = (flag) => (flag ? 1 : 0);

        // 1. Ground
        const grey = Math.max(TERRAIN.GREY_MIN, TERRAIN.GREY_LOW - TERRAIN.GREY_RANGE * (aux[2] / MAX_BYTE)) / MAX_BYTE;
        const landGround = TERRAIN.BASE_LAND.map((c) => mix(c / MAX_BYTE, grey, on(settings.elevation)));
        let colour = landGround.map((c, i) => mix(c, TERRAIN.SEDIMENT[i] / MAX_BYTE, wet));

        // 2. Biomes
        const surfaceAlpha = (surface[3] / MAX_BYTE) * settings.biomeAlpha * on(settings.landBiomes);
        const underAlpha = (underwater[3] / MAX_BYTE) * settings.biomeAlpha * on(settings.seaBiomes);
        colour = colour.map((c, i) => mix(c, surface[i] / MAX_BYTE, surfaceAlpha * (1 - wet)));
        colour = colour.map((c, i) => mix(c, underwater[i] / MAX_BYTE, underAlpha * wet));

        // 3. Relief
        const factor = TerrainShading.#reliefFactor(change * settings.reliefStrength * on(settings.relief));
        colour = colour.map((c) => Math.min(1, c * factor));

        // 4. Water
        const waterFactor = TerrainShading.#reliefFactor(change * settings.reliefStrength * settings.seabedRelief * on(settings.relief));
        const depthColour = TerrainShading.waterRamp(depth);
        const flatColour = TERRAIN.BASE_SEA.map((c) => c / MAX_BYTE);
        const water = TerrainShading.#tint(
            depthColour.map((c, i) => mix(flatColour[i], c, on(settings.elevation))),
            settings.hueShift,
            settings.saturation,
        ).map((c) => Math.min(1, c * waterFactor));
        const waterAlpha = mix(TERRAIN.FLAT_WATER_ALPHA, TerrainShading.waterAlpha(depth, settings.clarity), on(settings.elevation));
        colour = colour.map((c, i) => mix(c, water[i], waterAlpha * wet * on(settings.water)));

        // 5. Rivers, on dry ground (and across pools)
        if (river) colour = TerrainShading.#shadeRiver(colour, river, { wet, footprint, factor, waterFactor, settings });

        // 6. Surface biomes over the water
        colour = colour.map((c, i) => mix(c, surface[i] / MAX_BYTE, surfaceAlpha * wet));

        return colour.map((c) => Math.round(clamp(c, 0, 1) * MAX_BYTE));
    }

    /**
     * Step 5 of shade: a colour with the river drawn over it, if there is one at this point.
     * @param {number[]} colour - The colour so far (0-1 each channel).
     * @param {number[]} river - The river image's bytes [distance, ice, pool].
     * @param {{wet: number, footprint: number, factor: number, waterFactor: number, settings: object}} at -
     *   How wet the point is, the footprint in map pixels, the ground's and the water's relief
     *   factors, and the shading settings.
     * @returns {number[]}
     */
    static #shadeRiver(colour, river, { wet, footprint, factor, waterFactor, settings }) {
        const on = (flag) => (flag ? 1 : 0);
        const edge = TerrainShading.riverEdge(river[0]);
        const overWater = river[2] / MAX_BYTE;
        const coverage = clamp(0.5 - edge / Math.max(footprint, MIN_FOOTPRINT), 0, 1) * (1 - wet * (1 - overWater)) * on(settings.water);
        if (coverage <= 0) return colour;

        const depth = mix(RIVER.DEPTH_SHALLOW, RIVER.DEPTH_DEEP, clamp(-edge / RIVER.DEPTH_RANGE, 0, 1));
        const riverColour = TerrainShading.riverColour(depth, river[1] / MAX_BYTE, factor, waterFactor, settings);
        return colour.map((c, i) => mix(c, riverColour[i], coverage));
    }

    /**
     * A river's own colour: water of the given depth over a sediment bed, or ice.
     * @param {number} depth - The river's depth at this point (on the lakes' depth scale).
     * @param {number} ice - 0 open water to 1 frozen.
     * @param {number} factor - The ground's relief factor (1 without relief shading).
     * @param {number} waterFactor - The water surface's relief factor.
     * @param {object} settings - See defaultSettings.
     * @returns {number[]} RGB, 0-1.
     */
    static riverColour(depth, ice, factor, waterFactor, settings) {
        const elevation = settings.elevation ? 1 : 0;
        const flatColour = TERRAIN.BASE_SEA.map((c) => c / MAX_BYTE);
        const bed = TERRAIN.SEDIMENT.map((c) => Math.min(1, (c / MAX_BYTE) * factor));
        const water = TerrainShading.#tint(
            TerrainShading.waterRamp(depth).map((c, i) => mix(flatColour[i], c, elevation)),
            settings.hueShift,
            settings.saturation,
        ).map((c) => Math.min(1, c * waterFactor));
        const alpha = mix(TERRAIN.FLAT_WATER_ALPHA, Math.max(RIVER.MIN_ALPHA, TerrainShading.waterAlpha(depth, settings.clarity)), elevation);
        const frozen = RIVER.ICE_COLOUR.map((c) => Math.min(1, (c / MAX_BYTE) * factor));
        return bed.map((c, i) => mix(mix(c, water[i], alpha), frozen[i], ice));
    }

    /**
     * The colours of a whole image for the 3D view to lay over its terrain: the same steps as
     * shade (rivers included) with the biomes at full opacity and no relief shading (the 3D scene's own light
     * shades the slopes). Without relief the water's colour and coverage depend only on the
     * depth byte, and the ground's grey only on the height byte, so both are worked out once
     * per byte value rather than once per pixel.
     * @param {Uint8Array} aux - The packed image (see the class comment).
     * @param {Uint8Array} surface - RGBA of the land and surface biomes.
     * @param {Uint8Array} underwater - RGBA of the beds' biomes.
     * @param {object} settings - See defaultSettings; biomeAlpha and relief are ignored.
     * @param {Uint8Array} out - RGBA, written with alpha 255.
     * @param {Uint8Array|null} [rivers] - The river image (see the class comment), drawn at one
     *   screen pixel per map pixel (the drape's own resolution), or null for none.
     */
    static drape(aux, surface, underwater, settings, out, rivers = null) {
        const on = (flag) => (flag ? 1 : 0);
        const elevation = on(settings.elevation);
        const flatColour = TERRAIN.BASE_SEA.map((c) => c / MAX_BYTE);
        const sediment = TERRAIN.SEDIMENT.map((c) => c / MAX_BYTE);

        // Per height byte, the dry ground; per depth byte, the water's colour and coverage
        const ground = new Float32Array((MAX_BYTE + 1) * 3);
        const water = new Float32Array((MAX_BYTE + 1) * 3);
        const coverage = new Float32Array(MAX_BYTE + 1);
        for (let byte = 0; byte <= MAX_BYTE; byte++) {
            const grey = Math.max(TERRAIN.GREY_MIN, TERRAIN.GREY_LOW - TERRAIN.GREY_RANGE * (byte / MAX_BYTE)) / MAX_BYTE;
            const depth = TerrainShading.decodeDepth(byte);
            const colour = TerrainShading.#tint(
                TerrainShading.waterRamp(depth).map((c, i) => mix(flatColour[i], c, elevation)),
                settings.hueShift,
                settings.saturation,
            );
            for (let i = 0; i < 3; i++) {
                ground[byte * 3 + i] = mix(TERRAIN.BASE_LAND[i] / MAX_BYTE, grey, elevation);
                water[byte * 3 + i] = colour[i];
            }
            coverage[byte] = mix(TERRAIN.FLAT_WATER_ALPHA, TerrainShading.waterAlpha(depth, settings.clarity), elevation) * on(settings.water);
        }

        const landOn = on(settings.landBiomes) / MAX_BYTE;
        const seaOn = on(settings.seaBiomes) / MAX_BYTE;
        const riverTable = rivers ? TerrainShading.#riverTable(settings) : null;
        const colour = [0, 0, 0];
        for (let p = 0; p < out.length; p += 4) {
            const depthByte = aux[p + 1];
            const wet = depthByte > 0;
            const surfaceAlpha = surface[p + 3] * landOn;
            let biome = surface;
            let biomeAlpha = surfaceAlpha;
            if (wet) {
                biome = underwater;
                biomeAlpha = underwater[p + 3] * seaOn;
            }
            const groundAt = aux[p + 2] * 3;
            const waterAt = depthByte * 3;
            const waterAlpha = wet ? coverage[depthByte] : 0;
            for (let i = 0; i < 3; i++) {
                colour[i] = mix(wet ? sediment[i] : ground[groundAt + i], biome[p + i] / MAX_BYTE, biomeAlpha);
                colour[i] = mix(colour[i], water[waterAt + i], waterAlpha);
            }
            if (riverTable && rivers[p] > 0) TerrainShading.#drapeRiver(colour, rivers, p, wet, riverTable, settings);
            for (let i = 0; i < 3; i++) {
                const final = wet ? mix(colour[i], surface[p + i] / MAX_BYTE, surfaceAlpha) : colour[i];
                out[p + i] = Math.round(clamp(final, 0, 1) * MAX_BYTE);
            }
            out[p + 3] = MAX_BYTE;
        }
    }

    /**
     * Per distance byte of the river image, the colour of open water and of ice there (no relief,
     * as in the drape), and the edge distance, so the drape works each out once rather than per pixel.
     * @returns {{open: Float32Array, frozen: Float32Array, edge: Float32Array}}
     */
    static #riverTable(settings) {
        const open = new Float32Array((MAX_BYTE + 1) * 3);
        const frozen = new Float32Array((MAX_BYTE + 1) * 3);
        const edge = new Float32Array(MAX_BYTE + 1);
        for (let byte = 0; byte <= MAX_BYTE; byte++) {
            edge[byte] = TerrainShading.riverEdge(byte);
            const depth = mix(RIVER.DEPTH_SHALLOW, RIVER.DEPTH_DEEP, clamp(-edge[byte] / RIVER.DEPTH_RANGE, 0, 1));
            const water = TerrainShading.riverColour(depth, 0, 1, 1, settings);
            const ice = TerrainShading.riverColour(depth, 1, 1, 1, settings);
            for (let i = 0; i < 3; i++) {
                open[byte * 3 + i] = water[i];
                frozen[byte * 3 + i] = ice[i];
            }
        }
        return { open, frozen, edge };
    }

    /** Step 5 of the drape: draws the river at pixel offset p over `colour`, in place (see #shadeRiver). */
    static #drapeRiver(colour, rivers, p, wet, table, settings) {
        const byte = rivers[p];
        const overWater = rivers[p + 2] / MAX_BYTE;
        const coverage = clamp(0.5 - table.edge[byte], 0, 1) * (wet ? overWater : 1) * (settings.water ? 1 : 0);
        if (coverage <= 0) return;
        const ice = rivers[p + 1] / MAX_BYTE;
        for (let i = 0; i < 3; i++) {
            const riverColour = mix(table.open[byte * 3 + i], table.frozen[byte * 3 + i], ice);
            colour[i] = mix(colour[i], riverColour, coverage);
        }
    }

    /**
     * The water's colour at a depth with the map's tint (0-1 each channel), as the shader draws
     * it where there is no relief.
     * @param {number} depth - 0 at the shore to 1 at the deepest.
     * @param {object} settings - See defaultSettings.
     */
    static waterColour(depth, settings) {
        return TerrainShading.#tint(TerrainShading.waterRamp(depth), settings.hueShift, settings.saturation);
    }

    static #reliefFactor(scaledChange) {
        return clamp(1 + scaledChange, RELIEF.MIN_FACTOR, RELIEF.MAX_FACTOR);
    }

    /** The water's own colour at a depth (0-1 each channel), before the tint. */
    static waterRamp(depth) {
        const turquoise = clamp(1 - depth / WATER.TURQUOISE_DEPTH, 0, 1) * WATER.TURQUOISE_MIX;
        return WATER.SHALLOW_COLOUR.map((shallow, i) => {
            const ramp = Math.max(WATER.DEEP_COLOUR[i], shallow - WATER.DEEP_SLOPE[i] * depth) / MAX_BYTE;
            return mix(ramp, WATER.TURQUOISE[i] / MAX_BYTE, turquoise);
        });
    }

    /** How thickly the water covers the bed at a depth (1 - the share of the bed seen through it). */
    static waterAlpha(depth, clarity) {
        const safeClarity = Math.max(clarity, MIN_CLARITY);
        const floor = Math.min(WATER.FLOOR * safeClarity, MAX_FLOOR);
        const seen = (1 - WATER.VEIL) * (floor + (1 - floor) * Math.exp((-WATER.ABSORPTION / safeClarity) * depth));
        return 1 - seen;
    }

    /**
     * Turns a colour's hue by hueShift degrees and scales its saturation, keeping its brightness.
     * Done in YIQ, where hue is an angle and brightness a separate axis, so the water's depth
     * shading is untouched. The angle is negated because YIQ's angle runs the opposite way round
     * to the colour wheel's hue (a positive shift turns blue towards violet, as on the wheel).
     * YIQ's angle only roughly follows the colour wheel's, which is close enough for a tint.
     */
    static #tint(rgb, hueShift, saturation) {
        const dot = (row) => row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2];
        const angle = (-hueShift * Math.PI) / 180;
        const y = dot(YIQ.Y);
        const i0 = dot(YIQ.I);
        const q0 = dot(YIQ.Q);
        const i = (i0 * Math.cos(angle) - q0 * Math.sin(angle)) * saturation;
        const q = (i0 * Math.sin(angle) + q0 * Math.cos(angle)) * saturation;
        return [YIQ.R, YIQ.G, YIQ.B].map((row) => clamp(row[0] * y + row[1] * i + row[2] * q, 0, 1));
    }

    // ----------------------------------------------------------------- GPU

    /**
     * The fragment shader for TerrainCompositor. Constants come from the same config values the
     * CPU reference reads, so the two cannot drift apart on numbers; the steps are kept in step
     * by hand (see the class comment). Written in GLSL ES 1.00 so it runs on WebGL 1 and 2.
     * The biome textures arrive premultiplied (the GPU's default for colour with transparency),
     * so they are divided back by their alpha before mixing.
     * @returns {string}
     */
    static fragmentSource() {
        const vec3 = (rgb) => `vec3(${rgb.map((c) => (c / MAX_BYTE).toFixed(6)).join(", ")})`;
        const num = (n) => Number(n).toFixed(6);
        const row = (r) => `vec3(${r.map(num).join(", ")})`;

        return `
precision highp float;
varying vec2 vUvs;

uniform sampler2D uSurface;
uniform sampler2D uUnderwater;
uniform sampler2D uAux;
uniform sampler2D uRivers;

uniform float uElevationOn;
uniform float uReliefOn;
uniform float uWaterOn;
uniform float uLandOn;
uniform float uSeaOn;
uniform float uBiomeAlpha;
uniform float uReliefStrength;
uniform float uSeabedRelief;
uniform float uClarity;
uniform float uHueShift;
uniform float uSaturation;
uniform float uRiverFootprint;

const vec3 BASE_LAND = ${vec3(TERRAIN.BASE_LAND)};
const vec3 BASE_SEA = ${vec3(TERRAIN.BASE_SEA)};
const vec3 SEDIMENT = ${vec3(TERRAIN.SEDIMENT)};
const vec3 SHALLOW_COLOUR = ${vec3(WATER.SHALLOW_COLOUR)};
const vec3 DEEP_SLOPE = ${vec3(WATER.DEEP_SLOPE)};
const vec3 DEEP_COLOUR = ${vec3(WATER.DEEP_COLOUR)};
const vec3 TURQUOISE = ${vec3(WATER.TURQUOISE)};

const float GREY_LOW = ${num(TERRAIN.GREY_LOW / MAX_BYTE)};
const float GREY_RANGE = ${num(TERRAIN.GREY_RANGE / MAX_BYTE)};
const float GREY_MIN = ${num(TERRAIN.GREY_MIN / MAX_BYTE)};
const float FLAT_WATER_ALPHA = ${num(TERRAIN.FLAT_WATER_ALPHA)};
const float TURQUOISE_DEPTH = ${num(WATER.TURQUOISE_DEPTH)};
const float TURQUOISE_MIX = ${num(WATER.TURQUOISE_MIX)};
const float VEIL = ${num(WATER.VEIL)};
const float FLOOR = ${num(WATER.FLOOR)};
const float ABSORPTION = ${num(WATER.ABSORPTION)};
const float MAX_FLOOR = ${num(MAX_FLOOR)};
const float MIN_CLARITY = ${num(MIN_CLARITY)};
const float MIN_FACTOR = ${num(RELIEF.MIN_FACTOR)};
const float MAX_FACTOR = ${num(RELIEF.MAX_FACTOR)};
const float RELIEF_RANGE = ${num(RELIEF_RANGE)};
const float BYTE_MID = ${num(BYTE_MID)};
const float DEPTH_STEPS = ${num(DEPTH_STEPS)};
const float RIVER_RANGE = ${num(RIVER.FIELD_RANGE)};
const float RIVER_SHALLOW = ${num(RIVER.DEPTH_SHALLOW)};
const float RIVER_DEEP = ${num(RIVER.DEPTH_DEEP)};
const float RIVER_DEPTH_RANGE = ${num(RIVER.DEPTH_RANGE)};
const float RIVER_MIN_ALPHA = ${num(RIVER.MIN_ALPHA)};
const float MIN_FOOTPRINT = ${num(MIN_FOOTPRINT)};
const vec3 RIVER_ICE = ${vec3(RIVER.ICE_COLOUR)};

const vec3 YIQ_Y = ${row(YIQ.Y)};
const vec3 YIQ_I = ${row(YIQ.I)};
const vec3 YIQ_Q = ${row(YIQ.Q)};
const vec3 YIQ_R = ${row(YIQ.R)};
const vec3 YIQ_G = ${row(YIQ.G)};
const vec3 YIQ_B = ${row(YIQ.B)};

vec3 straight(vec4 premultiplied) {
    return premultiplied.a > 0.0 ? premultiplied.rgb / premultiplied.a : vec3(0.0);
}

float decodeRelief(float value) {
    float s = (value * 255.0 - BYTE_MID) / BYTE_MID;
    return sign(s) * s * s * RELIEF_RANGE;
}

float decodeDepth(float value) {
    float t = max(value * 255.0 - 1.0, 0.0) / DEPTH_STEPS;
    return t * t;
}

float reliefFactor(float scaledChange) {
    return clamp(1.0 + scaledChange, MIN_FACTOR, MAX_FACTOR);
}

vec3 waterRamp(float depth) {
    float turquoise = clamp(1.0 - depth / TURQUOISE_DEPTH, 0.0, 1.0) * TURQUOISE_MIX;
    vec3 ramp = max(DEEP_COLOUR, SHALLOW_COLOUR - DEEP_SLOPE * depth);
    return mix(ramp, TURQUOISE, turquoise);
}

float waterAlpha(float depth, float clarity) {
    float safeClarity = max(clarity, MIN_CLARITY);
    float floorShare = min(FLOOR * safeClarity, MAX_FLOOR);
    float seen = (1.0 - VEIL) * (floorShare + (1.0 - floorShare) * exp((-ABSORPTION / safeClarity) * depth));
    return 1.0 - seen;
}

vec3 tint(vec3 rgb, float hueShift, float saturation) {
    float angle = radians(-hueShift);
    float y = dot(YIQ_Y, rgb);
    float i0 = dot(YIQ_I, rgb);
    float q0 = dot(YIQ_Q, rgb);
    float i = (i0 * cos(angle) - q0 * sin(angle)) * saturation;
    float q = (i0 * sin(angle) + q0 * cos(angle)) * saturation;
    vec3 yiq = vec3(y, i, q);
    return clamp(vec3(dot(YIQ_R, yiq), dot(YIQ_G, yiq), dot(YIQ_B, yiq)), 0.0, 1.0);
}

void main() {
    vec4 aux = texture2D(uAux, vUvs);
    vec4 surface = texture2D(uSurface, vUvs);
    vec4 underwater = texture2D(uUnderwater, vUvs);

    float wet = clamp(aux.g * 255.0, 0.0, 1.0);
    float depth = decodeDepth(aux.g);
    float change = decodeRelief(aux.r);

    // 1. Ground
    float grey = max(GREY_MIN, GREY_LOW - GREY_RANGE * aux.b);
    vec3 landGround = mix(BASE_LAND, vec3(grey), uElevationOn);
    vec3 colour = mix(landGround, SEDIMENT, wet);

    // 2. Biomes
    float surfaceAlpha = surface.a * uBiomeAlpha * uLandOn;
    float underAlpha = underwater.a * uBiomeAlpha * uSeaOn;
    colour = mix(colour, straight(surface), surfaceAlpha * (1.0 - wet));
    colour = mix(colour, straight(underwater), underAlpha * wet);

    // 3. Relief
    float factor = reliefFactor(change * uReliefStrength * uReliefOn);
    colour = min(vec3(1.0), colour * factor);

    // 4. Water
    float waterFactor = reliefFactor(change * uReliefStrength * uSeabedRelief * uReliefOn);
    vec3 water = tint(mix(BASE_SEA, waterRamp(depth), uElevationOn), uHueShift, uSaturation);
    water = min(vec3(1.0), water * waterFactor);
    float coverage = mix(FLAT_WATER_ALPHA, waterAlpha(depth, uClarity), uElevationOn);
    colour = mix(colour, water, coverage * wet * uWaterOn);

    // 5. Rivers, on dry ground (and across pools)
    vec4 river = texture2D(uRivers, vUvs);
    float edge = RIVER_RANGE - 2.0 * RIVER_RANGE * river.r;
    float riverCover = clamp(0.5 - edge / max(uRiverFootprint, MIN_FOOTPRINT), 0.0, 1.0) * (1.0 - wet * (1.0 - river.b)) * uWaterOn;
    float riverDepth = mix(RIVER_SHALLOW, RIVER_DEEP, clamp(-edge / RIVER_DEPTH_RANGE, 0.0, 1.0));
    vec3 riverBed = min(vec3(1.0), SEDIMENT * factor);
    vec3 riverWater = min(vec3(1.0), tint(mix(BASE_SEA, waterRamp(riverDepth), uElevationOn), uHueShift, uSaturation) * waterFactor);
    float riverAlpha = mix(FLAT_WATER_ALPHA, max(RIVER_MIN_ALPHA, waterAlpha(riverDepth, uClarity)), uElevationOn);
    vec3 riverColour = mix(mix(riverBed, riverWater, riverAlpha), min(vec3(1.0), RIVER_ICE * factor), river.g);
    colour = mix(colour, riverColour, riverCover);

    // 6. Surface biomes over the water
    colour = mix(colour, straight(surface), surfaceAlpha * wet);

    gl_FragColor = vec4(clamp(colour, 0.0, 1.0), 1.0);
}
`;
    }

    /** The vertex shader for TerrainCompositor: a textured quad in PIXI's usual transforms. */
    static vertexSource() {
        return `
precision highp float;
attribute vec2 aVertexPosition;
attribute vec2 aUvs;
uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
varying vec2 vUvs;

void main() {
    vUvs = aUvs;
    gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
}
`;
    }
}
