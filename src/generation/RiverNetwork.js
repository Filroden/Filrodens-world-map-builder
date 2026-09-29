import { FILRODENSWMB } from "../config.js";
import { SpatialMath } from "../tools/SpatialMath.js";

/** Points closer than 1 / KEY_PRECISION pixels count as the same when comparing channels. */
const KEY_PRECISION = 100;
/** Seeds and primes of the two hashes a channel's key is made of (FNV-1a's, and a second pair). */
const HASH_SEED_A = 2166136261;
const HASH_PRIME_A = 16777619;
const HASH_SEED_B = 374761393;
const HASH_PRIME_B = 668265263;

/** How many times a reach's bends are redrawn after calming the ones that reach water or hills. */
const CALM_PASSES = 3;
/** Values in the pool buffer: a pool's pixel, and (only while pools are being found) a lake pixel already reached. */
const POOL = 1;
const VISITED = 2;
/** A traced river eases away from a custom river's line over 1 / AUTHORED_EASE_SHARE of the wander's wavelength. */
const AUTHORED_EASE_SHARE = 4;
/** The fewest bending points either side of a blocked one that are calmed with it. */
const MIN_CALM_SPREAD = 4;
/** Largest byte value (the river image's channels are bytes). */
const MAX_BYTE = 255;
/** A whole turn, in radians; and the range of a 32-bit seed. */
const TURN = 2 * Math.PI;
const SEED_RANGE = 2 ** 32;

/** The finer workings of a drawn river's shape, which no setting reaches. */
const SHAPE = Object.freeze({
    // Gaussian smoothing reads this many sigmas either side
    SMOOTHING_REACH: 2.5,
    // The fewest path points either side a slope is measured over
    MIN_SLOPE_WINDOW: 2,
    // The smallest River Meander value the meander slopes are scaled by (so 0 never divides by 0)
    MIN_MEANDER_REACH: 0.01,
    // The sideways direction is measured across this many points either side, of a line
    // smoothed at least MIN_GUIDE_SMOOTHING map pixels
    NORMAL_REACH: 2,
    MIN_GUIDE_SMOOTHING: 3,
    // A reach is drawn with at most this many points per point of the reach (a safety limit
    // for a steered line that never gets anywhere)
    MAX_STEER_POINTS: 20,
    // A bend is up to MEANDER_VARIETY shorter or longer, leaning this far towards longer
    BEND_LENGTH_BIAS: 0.35,
    // The wander is two waves: the second this many times as fast and this strong, so it never
    // quite repeats; both fade in over this share of a wavelength at a reach's ends
    WANDER_HARMONIC: 2.3,
    WANDER_HARMONIC_SHARE: 0.5,
    WANDER_FADE: 0.5,
    // Deltas: the fork must be at least this share of the delta's length from the mouth
    MIN_FORK_SHARE: 0.8,
    // A branch sets off between these shares of DELTA_ANGLE from the course, spread by chance
    BRANCH_SPREAD_MIN: 0.25,
    BRANCH_SPREAD_JITTER: 0.5,
    // How a branch steers, per pixel: its first turn, the random change to its turn, how much
    // of its turn it keeps, and how strongly it is pulled downhill and back towards the course
    BRANCH_FIRST_TURN: 0.04,
    BRANCH_TURN_NOISE: 0.02,
    BRANCH_TURN_KEEP: 0.95,
    BRANCH_DOWNHILL_PULL: 0.03,
    BRANCH_COURSE_PULL: 0.008,
    // The land's fall is measured this many pixels either side of a branch
    BRANCH_SLOPE_REACH: 2,
    // A branch widens by this share over the delta's length, gives up after this many delta
    // lengths, and is smoothed by this sigma (map pixels)
    BRANCH_WIDENING: 0.4,
    BRANCH_MAX_LENGTHS: 3,
    BRANCH_SMOOTHING: 2,
    // The fewest points a branch must have to be drawn
    MIN_BRANCH_POINTS: 4,
    // The shortest reach, in pixels, that is bent at all
    MIN_BENT_LENGTH: 2,
    MIN_BENT_POINTS: 4,
});

/**
 * Turns the traced rivers (whole-pixel paths, see ProceduralEngine#traceRiver) into the channels
 * that are drawn: smooth centrelines with a width at every point, and rasterises them into the
 * river image the terrain shader draws them from (see TerrainShading).
 *
 * 1. Flow. Every point of a river carries the length of river upstream of it, its own and that of
 *    every tributary that has joined it so far (a river knows which river, and which step of it,
 *    it flows into). Rivers only ever flow into rivers traced before them, so adding the flow up
 *    from the last river to the first visits each river once.
 * 2. Width, from the flow (wider as tributaries join), narrower where the river falls steeply and
 *    wider where it runs flat, and wider still in the last stretch before a flat coast.
 * 3. Centrelines: the drawn stretches of each river (not across lakes, see #reaches), smoothed,
 *    given a gentle wander so no river runs in a ruler-straight line, and meanders on flat ground.
 *    A tributary's last point is moved onto the smoothed river it joins, so the two still meet.
 *    A custom river's own line is only smoothed: it stays where the user drew it.
 * 4. The river image: per pixel, how far the pixel is from the nearest river's edge (a distance
 *    field, so the shader can draw a sharp edge at any zoom) and whether that river is frozen.
 *
 * All lengths are worked out in pixels of a BASELINE_DIMENSION map (see #scale), so the same
 * river is as wide and meanders as much in the world on a larger map or a regional crop.
 */
export class RiverNetwork {
    /** How far either side of a river's edge the distance field reaches, in map pixels. */
    static FIELD_RANGE = FILRODENSWMB.DISPLAY.RIVER.FIELD_RANGE;

    /**
     * @param {object[]} rivers - The traced rivers: `{ id, path, mergeInto: {id, index}|null, inflow }`.
     * @param {object} map
     * @param {Float32Array} map.elevation
     * @param {Float32Array} map.waterMask - Lake surface elevation per pixel, 0 elsewhere.
     * @param {number} map.width
     * @param {number} map.height
     * @param {number} map.seaLevel
     * @param {object} [map.world] - The map's place in its chain of crops (params.terrain.world).
     * @param {object} [options] - Overrides of FILRODENSWMB.HYDROLOGY.CHANNELS (width, meander...).
     * @param {object|null} [reuse] - A previous network of the same map, whose pool buffer is
     *   reused rather than allocating another map-sized buffer on every refresh.
     * @returns {{channels: object[], pools: Uint8Array, flows: Map<string, Float32Array>, pixelsPerBaseline: number}}
     *   The drawn channels, the pools (see #pools), and every river's flow at each step of its
     *   path (see #flows).
     */
    static build(rivers, map, options = {}, reuse = null) {
        const settings = { ...FILRODENSWMB.HYDROLOGY.CHANNELS, ...options };
        const scale = RiverNetwork.#scale(map);
        const byId = new Map(rivers.map((river) => [river.id, river]));

        const pools = RiverNetwork.#pools(map, scale, reuse?.pools);
        const water = { ...map, pools };
        const flows = RiverNetwork.#flows(rivers, byId, scale);
        const channels = [];
        const placed = new Map(); // river id -> its drawn points, by path index

        for (const river of rivers) {
            const flow = flows.get(river.id);
            const radii = RiverNetwork.#radii(river, flow, map, scale, settings);
            const positions = new Map();
            placed.set(river.id, positions);

            let last = null;
            for (const reach of RiverNetwork.#reaches(river, water)) {
                const points = RiverNetwork.#centreline(river, reach, radii, map, scale, settings, byId, placed);
                for (const point of points) if (point.index !== undefined) positions.set(point.index, point);
                channels.push({ id: river.id, points });
                last = { reach, points };
            }

            // A large river reaching the sea over flat ground splits into a delta
            if (last && last.reach.end >= river.path.length - 1 - settings.DELTA_REACH_SLACK) {
                const branches = RiverNetwork.#delta(river, flow, last.points, map, scale, settings);
                for (const points of branches) channels.push({ id: river.id, points, isDelta: true });
            }
        }
        return { channels, pools, flows, pixelsPerBaseline: scale };
    }

    /**
     * Map pixels per pixel of a BASELINE_DIMENSION map (as relief shading measures slopes): the
     * top map's longer side over the baseline, times the zoom of a regional map.
     * @param {number} width - Map width in pixels.
     * @param {number} height - Map height in pixels.
     * @param {object|null} [world] - The map's place in its chain of crops (params.terrain.world).
     * @returns {number}
     */
    static pixelsPerBaseline(width, height, world = null) {
        return RiverNetwork.#scale({ width, height, world });
    }

    /**
     * The flow (see #flows) at which a river is drawn `widthPixels` wide at the default River
     * Width, before the slope's effect: the inflow that makes a river start at that width.
     * @param {number} widthPixels - The width, in map pixels.
     * @param {number} scale - Map pixels per baseline pixel.
     * @returns {number} 0 for a width no wider than a source.
     */
    static inflowForWidth(widthPixels, scale) {
        const channels = FILRODENSWMB.HYDROLOGY.CHANNELS;
        const extra = Math.max(0, widthPixels / scale - channels.SOURCE_WIDTH);
        return (extra / channels.FLOW_WIDTH) ** 2;
    }

    /**
     * The map's river settings as options for build: River Width and River Meander.
     * @param {object} params - The map's derived parameters.
     * @returns {object}
     */
    static optionsFrom(params) {
        const channels = FILRODENSWMB.HYDROLOGY.CHANNELS;
        return {
            WIDTH: params?.hydrology?.riverWidthScale ?? channels.WIDTH,
            MEANDER: params?.hydrology?.riverMeander ?? channels.MEANDER,
        };
    }

    /**
     * Rasterises channels into the river image, RGBA per pixel:
     *   R - the distance field: (FIELD_RANGE - d) / (2 FIELD_RANGE) as a byte, where d is the
     *       distance from the nearest river's edge in map pixels (negative inside). 0 is "no river
     *       near", so a zeroed image has no rivers.
     *   G - 255 where that river is frozen, 0 where it is not (blended between).
     *   B - 255 on and around a pool (a lake too small to stop a river, see #pools), where a
     *       river is drawn over the water, 0 elsewhere.
     *   A - 255 (so the GPU's premultiplied alpha leaves the rest as it is).
     * @param {{channels: object[], pools: Uint8Array}} network - From build.
     * @param {number} width
     * @param {number} height
     * @param {Uint8Array} out - Written in full (or only inside bounds).
     * @param {{minX, minY, maxX, maxY}|null} [bounds]
     */
    static rasterise({ channels, pools }, width, height, out, bounds = null) {
        const range = RiverNetwork.FIELD_RANGE;
        const box = bounds ?? { minX: 0, minY: 0, maxX: width - 1, maxY: height - 1 };
        // Empty: every byte 0 but alpha, written as whole pixels
        const pixels = new Uint32Array(out.buffer, out.byteOffset, width * height);
        const empty = new Uint32Array(new Uint8Array([0, 0, 0, MAX_BYTE]).buffer)[0];
        for (let y = box.minY; y <= box.maxY; y++) pixels.fill(empty, y * width + box.minX, y * width + box.maxX + 1);
        // Pools and a pixel around them: a river may be drawn over their water
        for (let y = Math.max(0, box.minY - 1); y <= Math.min(height - 1, box.maxY + 1); y++) {
            for (let x = Math.max(0, box.minX - 1); x <= Math.min(width - 1, box.maxX + 1); x++) {
                if (!pools[y * width + x]) continue;
                for (let ny = Math.max(box.minY, y - 1); ny <= Math.min(box.maxY, y + 1); ny++) {
                    for (let nx = Math.max(box.minX, x - 1); nx <= Math.min(box.maxX, x + 1); nx++) out[(ny * width + nx) * 4 + 2] = MAX_BYTE;
                }
            }
        }

        const toByte = MAX_BYTE / (2 * range);
        for (const { points } of channels) {
            for (let i = 1; i < points.length; i++) {
                const a = points[i - 1];
                const b = points[i];
                const reach = Math.max(a.r, b.r) + range;
                const minX = Math.max(box.minX, Math.floor(Math.min(a.x, b.x) - reach));
                const maxX = Math.min(box.maxX, Math.ceil(Math.max(a.x, b.x) + reach));
                const minY = Math.max(box.minY, Math.floor(Math.min(a.y, b.y) - reach));
                const maxY = Math.min(box.maxY, Math.ceil(Math.max(a.y, b.y) + reach));
                if (minX > maxX || minY > maxY) continue;

                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const lengthSq = dx * dx + dy * dy;
                for (let y = minY; y <= maxY; y++) {
                    const py = y + 0.5 - a.y;
                    for (let x = minX; x <= maxX; x++) {
                        const px = x + 0.5 - a.x;
                        const t = lengthSq > 0 ? Math.min(1, Math.max(0, (px * dx + py * dy) / lengthSq)) : 0;
                        const ex = px - t * dx;
                        const ey = py - t * dy;
                        const edge = Math.sqrt(ex * ex + ey * ey) - (a.r + (b.r - a.r) * t);
                        if (edge >= range) continue;
                        const value = Math.round(Math.min(2 * range, range - edge) * toByte);
                        const o = (y * width + x) * 4;
                        if (value <= out[o]) continue;
                        out[o] = value;
                        out[o + 1] = Math.round((a.ice + (b.ice - a.ice) * t) * MAX_BYTE);
                    }
                }
            }
        }
    }

    /**
     * Whether a pixel's centre lies inside a drawn river channel, from the river image (see
     * rasterise): its distance byte puts the channel's edge beyond the centre (a byte over half
     * way, since the byte is (FIELD_RANGE - d) / (2 FIELD_RANGE) and d is negative inside).
     *
     * This is the channel as drawn, at its width, with its meanders and deltas, whether or not
     * it is over water; the terrain shader only draws it on dry ground or across a pool (see
     * TerrainShading), so a caller asking what the map shows applies that rule itself.
     *
     * @param {Uint8Array} image - The river image (RGBA per pixel).
     * @param {number} index - The pixel's index (y * width + x).
     * @returns {boolean}
     */
    static isInChannel(image, index) {
        return image[index * 4] > MAX_BYTE / 2;
    }

    /**
     * Whether a pixel is on or around a pool, where a river is drawn over the water (the river
     * image's pool byte, see rasterise).
     *
     * @param {Uint8Array} image - The river image (RGBA per pixel).
     * @param {number} index - The pixel's index (y * width + x).
     * @returns {boolean}
     */
    static isOverPool(image, index) {
        return image[index * 4 + 2] > 0;
    }

    /**
     * The area where two networks' river images differ: the box around every channel found in
     * one but not the other (a channel counts as the same only if every point matches), grown
     * by each channel's width and the distance field's reach.
     * @param {object[]|null} before - The previous channels, or null if there were none drawn.
     * @param {object[]} after - The new channels.
     * @param {number} width - Map width in pixels.
     * @param {number} height - Map height in pixels.
     * @returns {{minX, minY, maxX, maxY}|null} Null when nothing differs.
     */
    static changedBounds(before, after, width, height) {
        const keysBefore = new Map((before ?? []).map((channel) => [RiverNetwork.#channelKey(channel), channel]));
        const keysAfter = new Map(after.map((channel) => [RiverNetwork.#channelKey(channel), channel]));
        let bounds = null;
        const include = (channel) => {
            const box = RiverNetwork.#channelBounds(channel, width, height);
            bounds = bounds ? SpatialMath.mergeBounds(bounds, box) : box;
        };
        for (const [key, channel] of keysBefore) if (!keysAfter.has(key)) include(channel);
        for (const [key, channel] of keysAfter) if (!keysBefore.has(key)) include(channel);
        return bounds;
    }

    /** A channel's identity: its points and widths, rounded well below a pixel. */
    static #channelKey({ points }) {
        // Two independent 32-bit hashes of every rounded value, so channels that differ are all
        // but certain to get different keys, without building a string of every point
        let a = HASH_SEED_A;
        let b = HASH_SEED_B;
        const mix = (value) => {
            a = Math.imul(a ^ value, HASH_PRIME_A);
            b = Math.imul(b ^ value, HASH_PRIME_B) + 1;
        };
        mix(points.length);
        for (const p of points) {
            mix(Math.round(p.x * KEY_PRECISION));
            mix(Math.round(p.y * KEY_PRECISION));
            mix(Math.round(p.r * KEY_PRECISION));
            mix(Math.round(p.ice * KEY_PRECISION));
        }
        return `${a >>> 0}:${b >>> 0}`;
    }

    /** The pixels a channel's distance field reaches. */
    static #channelBounds({ points }, width, height) {
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const p of points) {
            const reach = p.r + RiverNetwork.FIELD_RANGE + 1;
            minX = Math.min(minX, p.x - reach);
            minY = Math.min(minY, p.y - reach);
            maxX = Math.max(maxX, p.x + reach);
            maxY = Math.max(maxY, p.y + reach);
        }
        return {
            minX: Math.max(0, Math.floor(minX)),
            minY: Math.max(0, Math.floor(minY)),
            maxX: Math.min(width - 1, Math.ceil(maxX)),
            maxY: Math.min(height - 1, Math.ceil(maxY)),
        };
    }

    // ----------------------------------------------------------------- scale and flow

    /** Map pixels per pixel of a BASELINE_DIMENSION map (as relief shading measures slopes). */
    static #scale({ width, height, world }) {
        const rootSize = world?.rootW && world?.rootH ? Math.max(world.rootW, world.rootH) : Math.max(width, height);
        return ((world?.zoom ?? 1) * rootSize) / FILRODENSWMB.LIMITS.BASELINE_DIMENSION;
    }

    /**
     * The flow at every point of every river: river upstream of it, in baseline pixels.
     * @returns {Map<string, Float32Array>}
     */
    static #flows(rivers, byId, scale) {
        const inflows = new Map(rivers.map((river) => [river.id, []]));
        const flows = new Map();

        for (let k = rivers.length - 1; k >= 0; k--) {
            const river = rivers[k];
            const path = river.path;
            const joins = inflows.get(river.id).sort((a, b) => a.index - b.index);
            const flow = new Float32Array(path.length);
            let total = river.inflow ?? 0;
            let next = 0;
            for (let i = 0; i < path.length; i++) {
                if (i > 0) total += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y) / scale;
                while (next < joins.length && joins[next].index <= i) total += joins[next++].flow;
                flow[i] = total;
            }
            flows.set(river.id, flow);

            const target = river.mergeInto && byId.get(river.mergeInto.id);
            if (target && target !== river) inflows.get(target.id).push({ index: river.mergeInto.index, flow: total });
        }
        return flows;
    }

    // ----------------------------------------------------------------- width

    /**
     * The half-width, in map pixels, at every point of a river, and how flat the ground is there
     * (see #slopeShares).
     * @returns {{radius: Float32Array, flatness: Float32Array, lowland: Float32Array}}
     */
    static #radii(river, flow, map, scale, settings) {
        const { path } = river;
        const n = path.length;
        const cumulative = new Float32Array(n);
        for (let i = 1; i < n; i++) cumulative[i] = cumulative[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);

        const { flatness, lowland } = RiverNetwork.#slopeShares(path, cumulative, map, scale, settings);

        const radius = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            const base = settings.SOURCE_WIDTH + settings.FLOW_WIDTH * Math.sqrt(flow[i]);
            const slopeFactor = settings.STEEP_FACTOR + (settings.FLAT_FACTOR - settings.STEEP_FACTOR) * flatness[i];
            radius[i] = (base * slopeFactor * settings.WIDTH * scale) / 2;
        }

        RiverNetwork.#widenMouth(radius, path, cumulative, flatness, map, scale, settings);
        for (let i = 0; i < n; i++) radius[i] = Math.max(radius[i], settings.MIN_RADIUS);
        return { radius, flatness, lowland };
    }

    /**
     * How flat the ground is at every point of a path, from 0 (steep) to 1 (flat), twice: for the
     * river's width (`flatness`, between FLAT_SLOPE and STEEP_SLOPE) and for its meanders
     * (`lowland`, between the flatter MEANDER_FLAT_SLOPE and MEANDER_STEEP_SLOPE, both scaled
     * by River Meander so a stronger setting lets meanders onto steeper ground).
     *
     * The slope is the fall over about SLOPE_WINDOW baseline pixels either side, in elevation per
     * baseline pixel, with the sea counted as sea level (a mouth is not a cliff). Both are then
     * smoothed along the river so its width and meanders change gradually.
     */
    static #slopeShares(path, cumulative, { elevation, width, seaLevel }, scale, settings) {
        const n = path.length;
        const flatness = new Float32Array(n);
        const lowland = new Float32Array(n);
        const window = Math.max(SHAPE.MIN_SLOPE_WINDOW, Math.round(settings.SLOPE_WINDOW * scale));
        const height = (p) => Math.max(elevation[p.y * width + p.x], seaLevel);
        const meanderReach = Math.max(settings.MEANDER, SHAPE.MIN_MEANDER_REACH);
        const share = (drop, flat, steep) => 1 - Math.min(1, Math.max(0, (drop - flat) / (steep - flat)));

        for (let i = 0; i < n; i++) {
            const a = Math.max(0, i - window);
            const b = Math.min(n - 1, i + window);
            const run = (cumulative[b] - cumulative[a]) / scale;
            const drop = run > 0 ? (height(path[a]) - height(path[b])) / run : 0;
            flatness[i] = share(drop, settings.FLAT_SLOPE, settings.STEEP_SLOPE);
            lowland[i] = share(drop, settings.MEANDER_FLAT_SLOPE * meanderReach, settings.MEANDER_STEEP_SLOPE * meanderReach);
        }
        RiverNetwork.#smoothArray(flatness, window);
        RiverNetwork.#smoothArray(lowland, window * 2);
        return { flatness, lowland };
    }

    /** Widens a river reaching the sea over its last MOUTH_LENGTH, the more the flatter its coast. */
    static #widenMouth(radius, path, cumulative, flatness, { elevation, width, seaLevel }, scale, settings) {
        const n = path.length;
        const last = path[n - 1];
        if (elevation[last.y * width + last.x] > seaLevel) return;

        const stretch = settings.MOUTH_LENGTH * scale;
        const mouthFlat = flatness[n - 1];
        for (let i = n - 1; i >= 0 && cumulative[n - 1] - cumulative[i] < stretch; i--) {
            const t = 1 - (cumulative[n - 1] - cumulative[i]) / stretch;
            radius[i] *= 1 + settings.MOUTH_WIDENING * mouthFlat * t * t;
        }
    }

    // ----------------------------------------------------------------- centrelines

    /**
     * The stretches of a river that are drawn. A step is drawn if it joins neighbouring pixels
     * and at least one of its ends is clear of the sea and of lakes (dry, with no such water on
     * its four sides), so rivers stop at lake shores and at the coast and are not drawn inside a
     * lake, around the odd dry pixel left in one. A pool (see #pools) does not count as a lake:
     * the river is drawn straight across it, including the jump from where it entered the pool
     * to where it spilled out.
     * @returns {{start: number, end: number}[]} Inclusive path indices.
     */
    static #reaches(river, map) {
        const { path } = river;
        const { width, height, waterMask, elevation, seaLevel, pools } = map;
        const isWater = (x, y) => {
            if (x < 0 || y < 0 || x >= width || y >= height) return false;
            const i = y * width + x;
            return (waterMask[i] > 0 && !pools[i]) || elevation[i] <= seaLevel;
        };
        const isClear = ({ x, y }) => !isWater(x, y) && !isWater(x - 1, y) && !isWater(x + 1, y) && !isWater(x, y - 1) && !isWater(x, y + 1);
        const isShown = (a, b) => {
            const isNeighbour = Math.abs(b.x - a.x) <= 1 && Math.abs(b.y - a.y) <= 1;
            if (!isNeighbour) return !!a.isLake && pools[a.y * width + a.x] === 1;
            return isClear(a) || isClear(b);
        };

        const reaches = [];
        let start = -1;
        for (let i = 1; i < path.length; i++) {
            const shown = isShown(path[i - 1], path[i]);
            if (shown && start < 0) start = i - 1;
            if (!shown && start >= 0) {
                reaches.push({ start, end: i - 1 });
                start = -1;
            }
        }
        if (start >= 0) reaches.push({ start, end: path.length - 1 });
        return reaches.filter((reach) => reach.end > reach.start);
    }

    /**
     * Marks the pools: lakes smaller than POOL_AREA square baseline pixels, or nowhere more
     * than POOL_WIDTH baseline pixels from their shore. The trace fills every hollow a river runs
     * into; on rough ground many are a few pixels across, and in a valley they join into a
     * string of water a pixel or two wide along the river. A river that stopped at each would be
     * drawn as a string of dashes, so it is drawn across them.
     * @returns {Uint8Array} 1 on a pool's pixels, 0 elsewhere.
     */
    static #pools({ waterMask, width, height }, scale, reuse) {
        const limit = FILRODENSWMB.HYDROLOGY.POOL_AREA * scale * scale;
        const narrow = FILRODENSWMB.HYDROLOGY.POOL_WIDTH * scale;
        const pools = reuse?.length === width * height ? reuse.fill(0) : new Uint8Array(width * height);

        // While labelling, the buffer also records which lake pixels have been reached (VISITED),
        // so no second map-sized buffer is needed; lakes that are not pools are cleared at the end
        const lakes = [];
        const stack = [];
        for (let start = 0; start < waterMask.length; start++) {
            if (!(waterMask[start] > 0) || pools[start]) continue;
            const members = RiverNetwork.#collectLake(start, waterMask, width, height, pools, stack);
            const isPool = members.length < limit || RiverNetwork.#isNarrow(members, waterMask, width, height, narrow);
            if (isPool) for (const i of members) pools[i] = POOL;
            else lakes.push(members);
        }
        for (const members of lakes) for (const i of members) pools[i] = 0;
        return pools;
    }

    /** The pixels of the lake that `start` belongs to (8-connected), each marked VISITED in `marks`. */
    static #collectLake(start, waterMask, width, height, marks, stack) {
        const members = [];
        stack.push(start);
        marks[start] = VISITED;
        while (stack.length) {
            const i = stack.pop();
            members.push(i);
            const x = i % width;
            const y = (i - x) / width;
            for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1); ny++) {
                for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx++) {
                    const n = ny * width + nx;
                    if (waterMask[n] > 0 && !marks[n]) {
                        marks[n] = VISITED;
                        stack.push(n);
                    }
                }
            }
        }
        return members;
    }

    /** Whether no pixel of a lake is more than `limit` pixels from its shore (8-neighbour steps). */
    static #isNarrow(members, waterMask, width, height, limit) {
        const isLake = (x, y) => x >= 0 && y >= 0 && x < width && y < height && waterMask[y * width + x] > 0;
        const distance = new Map();
        let frontier = [];
        for (const i of members) {
            const x = i % width;
            const y = (i - x) / width;
            if (!isLake(x - 1, y) || !isLake(x + 1, y) || !isLake(x, y - 1) || !isLake(x, y + 1)) {
                distance.set(i, 1);
                frontier.push(i);
            }
        }
        for (let step = 2; frontier.length; step++) {
            if (step > limit + 1) return false;
            const next = [];
            for (const i of frontier) {
                const x = i % width;
                const y = (i - x) / width;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (!isLake(x + dx, y + dy)) continue;
                        const n = (y + dy) * width + x + dx;
                        if (distance.has(n)) continue;
                        distance.set(n, step);
                        next.push(n);
                    }
                }
            }
            frontier = next;
        }
        return true;
    }

    /**
     * One reach's drawn points: pixel centres, smoothed, wandering and meandering, with the
     * width, flatness and frozen state carried along.
     */
    static #centreline(river, reach, { radius, lowland }, map, scale, settings, byId, placed) {
        const { path } = river;
        const points = [];
        for (let i = reach.start; i <= reach.end; i++) {
            const p = path[i];
            const authored = i < (river.authored ?? 0);
            points.push({ x: p.x + 0.5, y: p.y + 0.5, r: radius[i], flat: authored ? 0 : lowland[i], ice: RiverNetwork.#frozen(path, i) ? 1 : 0, index: i, authored });
        }

        // Where this reach ends by joining another river, it ends on that river's drawn line
        const endsInMerge = reach.end === path.length - 1 && path[reach.end].isMerge && river.mergeInto;
        if (endsInMerge) {
            const joined = placed.get(river.mergeInto.id)?.get(river.mergeInto.index);
            const tail = points[points.length - 1];
            if (joined) {
                tail.x = joined.x;
                tail.y = joined.y;
            }
            tail.r = Math.min(tail.r, points[points.length - 2]?.r ?? tail.r);
            tail.index = undefined; // not a point others can join
        }

        const smoothed = RiverNetwork.#smoothPath(points, settings.SMOOTHING * scale);
        const prng = RiverNetwork.#prng(`${path[0].x},${path[0].y}`, reach.start);
        const bent = RiverNetwork.#bend(RiverNetwork.#resample(smoothed, settings.SPACING), map, scale, settings, prng);
        return RiverNetwork.#thin(bent, settings.DRAWN_SPACING);
    }

    /**
     * The branches of a river's delta, if it has one: a river carrying at least DELTA_MIN_FLOW
     * that reaches the sea across flat ground (its meander measure, averaged over the last
     * stretch, at least DELTA_FLATNESS) splits DELTA_LENGTH * sqrt(flow) from its mouth into
     * distributaries that fan out to the sea on either side of it. Each branch sets off at an
     * angle from the river's course and runs on, bending gently and turning downhill, until it
     * reaches the sea; one that climbs above the fork or wanders too long is dropped.
     * @returns {object[][]} The branches' drawn points.
     */
    static #delta(river, flow, points, map, scale, settings) {
        const total = flow[flow.length - 1];
        const { elevation, width, seaLevel } = map;
        const last = river.path[river.path.length - 1];
        if (settings.DELTA <= 0 || total < settings.DELTA_MIN_FLOW || elevation[last.y * width + last.x] > seaLevel) return [];

        const length = settings.DELTA_LENGTH * Math.sqrt(total) * scale * settings.DELTA;
        const fork = RiverNetwork.#findFork(points, length);
        if (!fork || fork.flatness < settings.DELTA_FLATNESS) return [];

        const apex = points[fork.index];
        const course = RiverNetwork.#deltaCourse(apex, points[points.length - 1], length, map);
        const prng = RiverNetwork.#prng(`${river.path[0].x},${river.path[0].y}`, -1);
        const count = Math.min(settings.DELTA_BRANCHES, 2 + Math.floor(total / (settings.DELTA_MIN_FLOW * 2)));
        const pairs = Math.ceil(count / 2);

        const branches = [];
        for (let b = 0; b < count; b++) {
            const side = b % 2 === 0 ? 1 : -1;
            const share = SHAPE.BRANCH_SPREAD_MIN + ((1 - SHAPE.BRANCH_SPREAD_MIN) * (Math.floor(b / 2) + 1 - SHAPE.BRANCH_SPREAD_JITTER + SHAPE.BRANCH_SPREAD_JITTER * prng())) / pairs;
            const branch = RiverNetwork.#traceBranch(apex, course, course + side * settings.DELTA_ANGLE * share, length, map, settings, prng);
            if (branch) branches.push(branch);
        }
        return branches;
    }

    /**
     * Where a delta forks: the drawn point `length` back from the mouth, and the average meander
     * measure of the stretch below it. Null if the river is too short to fork that far back.
     */
    static #findFork(points, length) {
        let travelled = 0;
        let index = points.length - 1;
        let flatSum = 0;
        while (index > 0 && travelled < length) {
            travelled += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
            flatSum += points[index].flat;
            index--;
        }
        if (travelled < length * SHAPE.MIN_FORK_SHARE) return null;
        return { index, flatness: flatSum / (points.length - 1 - index) };
    }

    /**
     * The direction a delta fans out around: halfway between the river's own course from the fork
     * to its mouth and the fall of the land at the fork, measured over half the delta's length.
     */
    static #deltaCourse(apex, mouth, length, { elevation, width, height, seaLevel }) {
        const elevationAt = (x, y) => Math.max(elevation[RiverNetwork.#pixelAt(x, y, width, height)], seaLevel);
        const reach = Math.max(SHAPE.BRANCH_SLOPE_REACH, Math.round(length / 2));
        const fallX = elevationAt(apex.x - reach, apex.y) - elevationAt(apex.x + reach, apex.y);
        const fallY = elevationAt(apex.x, apex.y - reach) - elevationAt(apex.x, apex.y + reach);
        const toMouth = Math.atan2(mouth.y - apex.y, mouth.x - apex.x);
        if (Math.hypot(fallX, fallY) === 0) return toMouth;
        const downhill = Math.atan2(fallY, fallX);
        return Math.atan2(Math.sin(toMouth) + Math.sin(downhill), Math.cos(toMouth) + Math.cos(downhill));
    }

    /**
     * One delta branch, from the fork towards the sea: it sets off on `heading`, then steers a
     * pixel at a time, turning a little at random, pulled downhill and gently back towards the
     * delta's course. It is dropped (null) if it climbs above the fork or has not reached the sea
     * (or a lake) within BRANCH_MAX_LENGTHS delta lengths.
     * @returns {object[]|null} The branch's points, smoothed.
     */
    static #traceBranch(apex, course, heading, length, { elevation, waterMask, width, height, seaLevel }, settings, prng) {
        const at = (x, y) => RiverNetwork.#pixelAt(x, y, width, height);
        const reach = SHAPE.BRANCH_SLOPE_REACH;
        const apexHeight = elevation[at(apex.x, apex.y)];
        const startRadius = apex.r * settings.DELTA_BRANCH_WIDTH;
        const branch = [{ x: apex.x, y: apex.y, r: startRadius, ice: apex.ice, flat: 0 }];
        let { x, y } = apex;
        let turn = (prng() - 0.5) * SHAPE.BRANCH_FIRST_TURN;

        for (let step = 0; step < length * SHAPE.BRANCH_MAX_LENGTHS; step++) {
            const gx = elevation[at(x + reach, y)] - elevation[at(x - reach, y)];
            const gy = elevation[at(x, y + reach)] - elevation[at(x, y - reach)];
            const pull = Math.hypot(gx, gy) > 0 ? Math.sin(Math.atan2(-gy, -gx) - heading) * SHAPE.BRANCH_DOWNHILL_PULL : 0;
            turn = (turn + (prng() - 0.5) * SHAPE.BRANCH_TURN_NOISE) * SHAPE.BRANCH_TURN_KEEP;
            heading += turn + pull + Math.sin(course - heading) * SHAPE.BRANCH_COURSE_PULL;
            x += Math.cos(heading);
            y += Math.sin(heading);

            const pixel = at(x, y);
            if (elevation[pixel] > apexHeight + settings.MEANDER_CLIMB) return null;
            branch.push({ x, y, r: startRadius * (1 + SHAPE.BRANCH_WIDENING * Math.min(1, step / length)), ice: apex.ice, flat: 0 });
            if (elevation[pixel] <= seaLevel || waterMask[pixel] > 0) {
                return branch.length >= SHAPE.MIN_BRANCH_POINTS ? RiverNetwork.#smoothPath(branch, SHAPE.BRANCH_SMOOTHING) : null;
            }
        }
        return null;
    }

    /** The index of the pixel a point lies in, clamped to the map. */
    static #pixelAt(x, y, width, height) {
        return Math.min(height - 1, Math.max(0, Math.floor(y))) * width + Math.min(width - 1, Math.max(0, Math.floor(x)));
    }

    /** Whether step i is frozen: its own flag, or its neighbour's where it has none (merge, sea). */
    static #frozen(path, i) {
        return path[i].isFrozen ?? path[i - 1]?.isFrozen ?? false;
    }

    /**
     * Gaussian smoothing along the path, sigma in map pixels. The window is cut short near each
     * end, symmetrically, so the ends stay exactly where they are.
     */
    static #smoothPath(points, sigma) {
        const n = points.length;
        if (n < 3 || sigma <= 0) return points.map((p) => ({ ...p }));
        const reachOf = Math.ceil(sigma * SHAPE.SMOOTHING_REACH);
        const out = [];
        for (let i = 0; i < n; i++) {
            const half = Math.min(reachOf, i, n - 1 - i);
            let sx = 0;
            let sy = 0;
            let sw = 0;
            for (let k = -half; k <= half; k++) {
                const w = Math.exp((-k * k) / (2 * sigma * sigma));
                sx += points[i + k].x * w;
                sy += points[i + k].y * w;
                sw += w;
            }
            out.push({ ...points[i], x: sx / sw, y: sy / sw });
        }
        return out;
    }

    /**
     * Bends a reach: meanders where the ground is flat, and a gentle wander everywhere (so a
     * river on an even slope does not run in a ruler-straight line).
     *
     * Meanders are drawn by steering, not by pushing the line sideways: a point travels along
     * the reach turning left and right by an angle that swings back and forth (a Kinoshita
     * curve, the usual model of a meandering river), up to MEANDER_ANGLE on flat ground, so
     * strong meanders close into loops. Its progress along the reach and its distance to one
     * side are laid out along the reach's smoothed line. The swing's wavelength grows with the
     * river's width, and both it and the angle drift a little so bends are not all alike. Bends
     * fade in and out at the reach's ends, so joins stay where they are. Where a bend would reach
     * into the sea or a lake, or up onto ground much higher than the river's own, the bends
     * around there are made gentler (the reach is drawn twice: once to find those places).
     */
    static #bend(points, map, scale, settings, prng) {
        const n = points.length;
        if (n < SHAPE.MIN_BENT_POINTS) return points;

        const base = new Float32Array(n);
        for (let i = 1; i < n; i++) base[i] = base[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
        const total = base[n - 1];
        if (total < SHAPE.MIN_BENT_LENGTH) return points;

        const guide = RiverNetwork.#smoothPath(points, Math.max(SHAPE.MIN_GUIDE_SMOOTHING, settings.GUIDE_SMOOTHING * scale));
        const normals = guide.map((_, i) => {
            const a = guide[Math.max(0, i - SHAPE.NORMAL_REACH)];
            const b = guide[Math.min(n - 1, i + SHAPE.NORMAL_REACH)];
            const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
            return { x: -(b.y - a.y) / length, y: (b.x - a.x) / length };
        });

        const seeds = { phase: prng() * TURN, wander: prng() * TURN, drift: prng() * TURN, skew: prng() - 0.5, bends: Math.floor(prng() * SEED_RANGE) };
        const allowed = RiverNetwork.#authoredAllowance(points, scale, settings);
        let drawn = RiverNetwork.#steer(points, base, normals, allowed, scale, settings, seeds);

        // Find where the bends reach into water or up hills, and calm them there. Calming one
        // place can shift the bends just past it, so this is repeated a few times.
        const spread = Math.max(MIN_CALM_SPREAD, Math.round((settings.MEANDER_WAVELENGTH * 2 * points[0].r) / settings.SPACING / 2));
        for (let pass = 0; pass < CALM_PASSES && RiverNetwork.#calmBlocked(drawn, allowed, map, settings); pass++) {
            RiverNetwork.#minFilter(allowed, spread);
            RiverNetwork.#smoothArray(allowed, Math.round(spread / 2));
            drawn = RiverNetwork.#steer(points, base, normals, allowed, scale, settings, seeds);
        }
        return drawn;
    }

    /**
     * How far each point of a reach may be moved sideways (1 fully, 0 not at all), before any
     * bend is calmed. A custom river's own line (`authored` points, see
     * ProceduralEngine#traceAuthored) is where the user drew it, so it is not moved; where the
     * river is traced on beyond the line's end, the allowance rises gradually over a quarter of
     * the wander's wavelength, so the river leaves the line smoothly.
     */
    static #authoredAllowance(points, scale, settings) {
        const allowed = new Float32Array(points.length).fill(1);
        if (!points.some((p) => p.authored)) return allowed;

        points.forEach((p, i) => {
            if (p.authored) allowed[i] = 0;
        });
        const half = Math.max(1, Math.round((settings.WANDER_WAVELENGTH * scale) / AUTHORED_EASE_SHARE / settings.SPACING / 2));
        RiverNetwork.#minFilter(allowed, half);
        RiverNetwork.#smoothArray(allowed, half);
        points.forEach((p, i) => {
            if (p.authored) allowed[i] = 0;
        });
        return allowed;
    }

    /**
     * Marks, in `allowed`, the reach points whose drawn bend lands in the sea or a lake (from dry
     * ground) or on ground more than MEANDER_CLIMB above the river's own.
     * @returns {boolean} Whether any was marked.
     */
    static #calmBlocked(drawn, allowed, { elevation, waterMask, width, height, seaLevel }, settings) {
        const pixel = (x, y) => RiverNetwork.#pixelAt(x, y, width, height);
        const isWater = (i) => waterMask[i] > 0 || elevation[i] <= seaLevel;
        let marked = false;
        for (const point of drawn) {
            if (point.offset === 0) continue;
            const at = pixel(point.x, point.y);
            const home = pixel(point.baseX, point.baseY);
            const blocked = (isWater(at) && !isWater(home)) || elevation[at] > Math.max(elevation[home], seaLevel) + settings.MEANDER_CLIMB;
            if (!blocked || allowed[point.baseIndex] === 0) continue;
            allowed[point.baseIndex] = 0;
            marked = true;
        }
        return marked;
    }

    /**
     * Steers along a reach (see #bend) and returns the drawn points, each knowing the point of
     * the reach it was laid out from (baseIndex, baseX, baseY) and its sideways offset. A point
     * of the reach that others can join (it has a path index) is also placed on the drawn line.
     */
    static #steer(points, base, normals, allowed, scale, settings, seeds) {
        const n = points.length;
        const total = base[n - 1];
        const step = settings.SPACING;
        const wanderLength = settings.WANDER_WAVELENGTH * scale;
        const out = [];

        let along = 0; // progress along the reach
        let side = 0; // distance to one side
        let phase = seeds.phase;
        let i = 0; // the reach point at or before `along`
        let nextIndexed = 0;

        const at = (j, t, key) => points[j][key] + (points[Math.min(n - 1, j + 1)][key] - points[j][key]) * t;

        // Each bend (half a swing) gets its own size and length, changed as the swing crosses
        // the middle, where the heading does not depend on them, so the line stays smooth
        const bendRandom = RiverNetwork.#prng(String(seeds.bends), 0);
        const newBend = () => ({ size: 1 - settings.MEANDER_VARIETY * bendRandom(), length: 1 + settings.MEANDER_VARIETY * (bendRandom() - SHAPE.BEND_LENGTH_BIAS) });
        let bend = newBend();
        let halfSwing = Math.floor(phase / Math.PI);

        while (along < total && out.length < n * SHAPE.MAX_STEER_POINTS) {
            while (i < n - 2 && base[i + 1] <= along) i++;
            const t = Math.min(1, Math.max(0, (along - base[i]) / (base[i + 1] - base[i] || 1)));
            const r = at(i, t, "r");
            const flat = at(i, t, "flat");
            const wavelength = Math.max(settings.MEANDER_MIN_WAVELENGTH * scale, settings.MEANDER_WAVELENGTH * 2 * r);
            const wobble = bend.length;
            const fade = RiverNetwork.#smoothstep(Math.min(along, total - along) / wavelength);
            const angle = Math.min(1, settings.MEANDER) * RiverNetwork.#smoothstep(flat) * settings.MEANDER_ANGLE * bend.size * fade * (allowed[i] + (allowed[Math.min(n - 1, i + 1)] - allowed[i]) * t);

            // Kinoshita: sin, plus a little of the third harmonic to fatten and skew the loops;
            // a slight pull back towards the middle keeps the line from drifting to one side
            const heading = angle * (Math.sin(phase) + settings.MEANDER_ROUNDNESS * Math.cos(3 * phase) * seeds.skew * 2) - (side / wavelength) * settings.MEANDER_RETURN;
            along += Math.cos(heading) * step;
            side += Math.sin(heading) * step;
            phase += (TURN * step) / (wavelength * wobble);
            if (Math.floor(phase / Math.PI) !== halfSwing) {
                halfSwing = Math.floor(phase / Math.PI);
                bend = newBend();
            }

            const wander = RiverNetwork.#wander(along, total, wanderLength, settings.WANDER * scale, seeds);
            const k = Math.min(Math.max(0, along), total);
            while (i > 0 && base[i] > k) i--;
            while (i < n - 2 && base[i + 1] <= k) i++;
            const u = Math.min(1, Math.max(0, (k - base[i]) / (base[i + 1] - base[i] || 1)));
            const baseX = at(i, u, "x");
            const baseY = at(i, u, "y");
            const nx = normals[i].x + (normals[Math.min(n - 1, i + 1)].x - normals[i].x) * u;
            const ny = normals[i].y + (normals[Math.min(n - 1, i + 1)].y - normals[i].y) * u;
            const offset = (side * fade + wander) * (allowed[i] + (allowed[Math.min(n - 1, i + 1)] - allowed[i]) * u);
            const point = { x: baseX + nx * offset, y: baseY + ny * offset, r: at(i, u, "r"), ice: at(i, u, "ice"), flat: at(i, u, "flat"), baseIndex: u < 0.5 ? i : Math.min(n - 1, i + 1), baseX, baseY, offset };
            while (nextIndexed < n && base[nextIndexed] <= k) {
                if (points[nextIndexed].index !== undefined && point.index === undefined) point.index = points[nextIndexed].index;
                nextIndexed++;
            }
            out.push(point);
        }

        // The ends are exactly where they were (the first point, and the last: a join or a shore)
        const first = { ...points[0], baseIndex: 0, baseX: points[0].x, baseY: points[0].y, offset: 0 };
        const last = { ...points[n - 1], baseIndex: n - 1, baseX: points[n - 1].x, baseY: points[n - 1].y, offset: 0 };
        if (out.length && out[out.length - 1].index === last.index) delete out[out.length - 1].index;
        return [first, ...out.filter((p) => Math.hypot(p.x - last.x, p.y - last.y) > step * 0.5), last];
    }

    /**
     * The gentle wander's sideways offset at `along` on a reach `total` long: two waves, the second
     * faster and weaker so the pattern never quite repeats, fading in and out at the reach's ends.
     */
    static #wander(along, total, wavelength, size, seeds) {
        const wave = Math.sin((TURN * along) / wavelength + seeds.wander) + SHAPE.WANDER_HARMONIC_SHARE * Math.sin((TURN * SHAPE.WANDER_HARMONIC * along) / wavelength + seeds.drift);
        return size * wave * RiverNetwork.#smoothstep(Math.min(along, total - along) / (wavelength * SHAPE.WANDER_FADE));
    }

    /**
     * Drops points closer than `spacing` to the last one kept (never the ends, or a point others
     * join), which the rasteriser then draws as fewer, longer segments.
     */
    static #thin(points, spacing) {
        if (points.length < 3) return points;
        const out = [points[0]];
        for (let i = 1; i < points.length - 1; i++) {
            const p = points[i];
            const kept = out[out.length - 1];
            if (p.index !== undefined || Math.hypot(p.x - kept.x, p.y - kept.y) >= spacing) out.push(p);
        }
        out.push(points[points.length - 1]);
        return out;
    }

    /** Resamples to points about `spacing` map pixels apart, carrying the other values along. */
    static #resample(points, spacing) {
        if (points.length < 2) return points;
        const out = [points[0]];
        for (let i = 1; i < points.length; i++) {
            const a = points[i - 1];
            const b = points[i];
            const length = Math.hypot(b.x - a.x, b.y - a.y);
            const steps = Math.max(1, Math.round(length / spacing));
            for (let k = 1; k <= steps; k++) {
                const t = k / steps;
                const point = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, r: a.r + (b.r - a.r) * t, ice: a.ice + (b.ice - a.ice) * t, flat: a.flat + (b.flat - a.flat) * t, authored: a.authored && b.authored };
                if (k === steps) point.index = b.index;
                out.push(point);
            }
        }
        return out;
    }

    // ----------------------------------------------------------------- helpers

    static #smoothstep(t) {
        const c = Math.min(1, Math.max(0, t));
        return c * c * (3 - 2 * c);
    }

    /** Box-blurs an array in place, `half` either side, ends included. */
    static #smoothArray(values, half) {
        const copy = Float32Array.from(values);
        for (let i = 0; i < values.length; i++) {
            let sum = 0;
            let count = 0;
            for (let k = Math.max(0, i - half); k <= Math.min(values.length - 1, i + half); k++) {
                sum += copy[k];
                count++;
            }
            values[i] = sum / count;
        }
    }

    /** Replaces each value with the smallest within `half` either side. */
    static #minFilter(values, half) {
        const copy = Float32Array.from(values);
        for (let i = 0; i < values.length; i++) {
            let min = Infinity;
            for (let k = Math.max(0, i - half); k <= Math.min(values.length - 1, i + half); k++) min = Math.min(min, copy[k]);
            values[i] = min;
        }
    }

    /** A small seeded random stream (mulberry32) per reach, so a river's bends are the same every time. */
    static #prng(id, start) {
        let seed = HASH_SEED_A;
        for (const ch of `${id}:${start}`) seed = Math.imul(seed ^ ch.charCodeAt(0), HASH_PRIME_A);
        return () => {
            seed = (seed + 0x6d2b79f5) | 0;
            let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / SEED_RANGE;
        };
    }
}
