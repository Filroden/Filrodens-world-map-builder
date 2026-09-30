import { FILRODENSWMB } from "../config.js";

/**
 * Where procedural rivers rise (their springs), under the current river rules.
 *
 * Springs are not stored. They are placed afresh every time the rivers are traced, from the map's
 * seed, its current terrain and climate, and the spring settings, so they follow the land as it
 * is edited and the Spring Altitude and Spring Moisture settings take effect straight away. Only
 * the user's own changes are stored, as pins: a spring they added ("spring"), and a procedural
 * spring they removed ("block_spring", placed exactly where that spring rises).
 *
 * The candidate places are drawn in the world (the pixels of the map at the top of the chain of
 * crops, see TerrainVersion.getTerrainParams), always the same ones for a seed: RIVER_DENSITY *
 * SPRING_CANDIDATES of them, spread at random over the whole world. A candidate becomes a spring
 * where it lies on this map, on land at least Spring Altitude above sea level, and at least as
 * moist as Spring Moisture. Because the candidates belong to the world, a regional map finds the
 * same springs inside its crop as its parent map had there.
 *
 * Maps made before the current river rules baked their springs into pins once, the first time
 * the map was generated. Those pins are recognised (see retireBakedPins) and removed when such a
 * map is updated, so it gets the same springs as a map made today.
 */
export class RiverSources {
    /** Offset of the springs' random stream from the map's seed (the one the legacy bake used). */
    static #STREAM_OFFSET = 1;
    /** How close, in pixels of the top map, a removal pin must be to a candidate to remove it. */
    static #BLOCK_REACH = 1;
    /** How many places the legacy bake tried per spring it wanted. */
    static #LEGACY_ATTEMPTS_PER_SPRING = 50;

    /**
     * The procedural springs on this map, not counting those the user removed.
     * @param {object} map
     * @param {Float32Array} map.elevation
     * @param {Float32Array} map.moisture
     * @param {number} map.width
     * @param {number} map.height
     * @param {number} seedNumber - The map's numeric seed (ProceduralEngine#seedNumber).
     * @param {object} params - The map's derived parameters (sea level, hydrology, terrain.world, riverDensity).
     * @param {object[]} [pins] - The map's pins; its "block_spring" pins remove springs.
     * @returns {{id: string, x: number, y: number, homeX: number, homeY: number, candidate: number}[]}
     *   Springs, in whole pixels of this map (`homeX`, `homeY` keep where each rose, should the user
     *   drag it while editing).
     */
    static place({ elevation, moisture, width, height }, seedNumber, params, pins = []) {
        const world = RiverSources.#world(params, width, height);
        const seaLevel = params.seaLevel ?? FILRODENSWMB.DEFAULTS.SEA_LEVEL;
        const minElevation = seaLevel + (params.hydrology?.springAltOffset ?? FILRODENSWMB.HYDROLOGY.SPRING_ALTITUDE_OFFSET);
        const minMoisture = params.hydrology?.springMoistMin ?? FILRODENSWMB.HYDROLOGY.SPRING_MOISTURE_MIN;
        const blocks = RiverSources.#blocksInWorld(pins, world);
        const count = Math.round((params.riverDensity ?? FILRODENSWMB.HYDROLOGY.RIVER_DENSITY) * FILRODENSWMB.HYDROLOGY.SPRING_CANDIDATES);

        const random = RiverSources.#mulberry32(seedNumber + RiverSources.#STREAM_OFFSET);
        const springs = [];
        for (let candidate = 0; candidate < count; candidate++) {
            const worldX = random() * world.rootW;
            const worldY = random() * world.rootH;
            const x = Math.floor((worldX - world.originX) * world.zoom);
            const y = Math.floor((worldY - world.originY) * world.zoom);
            if (x < 0 || y < 0 || x >= width || y >= height) continue;

            const index = y * width + x;
            // Written as !(value > limit) on purpose: a NaN value also fails the check, whereas the
            // equivalent-looking value <= limit would let it through
            if (!(elevation[index] > minElevation) || !(moisture[index] > minMoisture)) continue; // NOSONAR
            if (RiverSources.#isBlocked(worldX, worldY, blocks)) continue;
            springs.push({ id: `source-${candidate}`, x, y, homeX: x, homeY: y, candidate });
        }
        return springs;
    }

    /**
     * The pins a map made before the current river rules baked for its springs, recognised by
     * place: the legacy bake tried places one after another from the same random stream,
     * RIVER_DENSITY * 50 of them at most, each a whole pixel of the map it was baked on (the top
     * map, since a regional map inherits its parent's pins). A spring pin that sits exactly on
     * one of those places, seen from the top map, is a baked one; a spring the user placed by
     * hand almost never does.
     *
     * @param {object[]} pins - The map's pins.
     * @param {number} seedNumber - The map's numeric seed.
     * @param {object} params - The map's derived parameters (terrain.world, riverDensity).
     * @param {number} width - This map's width in pixels.
     * @param {number} height - This map's height in pixels.
     * @returns {object[]} The baked pins (a subset of `pins`).
     */
    static findBakedPins(pins, seedNumber, params, width, height) {
        // !(inflow > 0) on purpose: springs saved before inflow existed have none, and must count as
        // having no inflow (undefined <= 0 is false, so the equivalent-looking test would drop them)
        const springs = pins.filter((pin) => pin.type === "spring" && !(pin.inflow > 0)); // NOSONAR
        if (springs.length === 0) return [];

        const world = RiverSources.#world(params, width, height);
        const rootW = Math.round(world.rootW);
        const rootH = Math.round(world.rootH);
        const attempts = (params.riverDensity ?? FILRODENSWMB.HYDROLOGY.RIVER_DENSITY) * RiverSources.#LEGACY_ATTEMPTS_PER_SPRING;
        const random = RiverSources.#mulberry32(seedNumber + RiverSources.#STREAM_OFFSET);
        const places = new Set();
        for (let attempt = 0; attempt < attempts; attempt++) {
            const x = Math.floor(random() * rootW);
            const y = Math.floor(random() * rootH);
            places.add(`${x},${y}`);
        }

        const onPlace = (pin) => {
            const worldX = world.originX + pin.x / world.zoom;
            const worldY = world.originY + pin.y / world.zoom;
            const x = Math.round(worldX);
            const y = Math.round(worldY);
            return Math.abs(worldX - x) < 1e-3 && Math.abs(worldY - y) < 1e-3 && places.has(`${x},${y}`);
        };
        return springs.filter(onPlace);
    }

    /**
     * A pin that removes a procedural spring: placed where the spring rises, so it matches that
     * spring's candidate (see place) on this map and on any regional map made from it.
     * @param {{x: number, y: number}} spring - A spring from place.
     * @returns {object} A "block_spring" pin.
     */
    static removalPin(spring) {
        return { id: foundry.utils.randomID(), name: "Removed River Source", x: spring.x + 0.5, y: spring.y + 0.5, type: "block_spring", radius: 6, visibility: "all" };
    }

    // ----------------------------------------------------------------- helpers

    /** The map's place in the world, every field filled in (see TerrainVersion.getTerrainParams). */
    static #world(params, width, height) {
        const world = params?.terrain?.world;
        const zoom = world?.zoom ?? 1;
        return {
            zoom,
            originX: world?.originX ?? 0,
            originY: world?.originY ?? 0,
            rootW: world?.rootW ?? width / zoom,
            rootH: world?.rootH ?? height / zoom,
        };
    }

    /** The removal pins, in pixels of the top map. */
    static #blocksInWorld(pins, world) {
        return pins.filter((pin) => pin.type === "block_spring").map((pin) => ({ x: world.originX + pin.x / world.zoom, y: world.originY + pin.y / world.zoom }));
    }

    /** Whether a removal pin lies within BLOCK_REACH of a candidate (both in the top map's pixels). */
    static #isBlocked(worldX, worldY, blocks) {
        return blocks.some((block) => Math.abs(block.x - worldX) <= RiverSources.#BLOCK_REACH && Math.abs(block.y - worldY) <= RiverSources.#BLOCK_REACH);
    }

    /**
     * The same small random generator ProceduralEngine seeds its streams with (mulberry32), so
     * the legacy bake's places can be reproduced exactly.
     */
    static #mulberry32(seed) {
        let a = seed;
        return function () {
            let t = (a += 0x6d2b79f5);
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
}
