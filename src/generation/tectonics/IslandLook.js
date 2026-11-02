import { FILRODENSWMB } from "../../config.js";
import { FeatureMath } from "./FeatureMath.js";

const { smoothstep } = FeatureMath;

/**
 * How a hotspot chain's islands take on the look of the map's own land, from terrain revision 3
 * on (see TerrainVersion.usesCurrentHotspots and Volcanoes.stampShields).
 *
 * The volcanoes still decide where the islands are and how large (they stay where the chain is
 * drawn), but above the sea each island is shaped as the terrain engine shapes land
 * (ProceduralEngine#shapeLand): a coastal plain, then the volcano's own rise as the land's
 * large-scale structure, carrying the engine's own detail noise, read at the same place as the
 * land around it. Below the sea the volcano's flanks stay smooth, with a narrow shelf round
 * larger, younger islands and no continental slope, since seamounts gain none. Summits are kept
 * within the land's heights.
 *
 * Everything here is worked out once per feature pass from the map's generation settings (see
 * TectonicFeatureEngine.apply), so `key` is part of each feature's cache key. Nothing is read
 * from the map's own ground or size, so a regional map's islands match its parent's.
 */
export class IslandLook {
    /**
     * The look of the map's islands, from its generation settings.
     *
     * @param {object|null} params - The map's derived generation settings (params.terrain from
     *   TerrainVersion.getTerrainParams).
     * @param {number} seaLevel - The sea level.
     * @param {FeatureNoise} noise - The feature noise (for baseline lengths).
     */
    static of(params, seaLevel, noise) {
        const generation = FILRODENSWMB.GENERATION;
        const settings = params ?? {};
        const terrain = settings.terrain ?? {};
        const zoom = terrain.world?.zoom ?? 1;
        // Lengths the engine measures in world pixels of the baseline map, in this map's pixels
        const toMap = (terrain.resolutionScale ?? 1) * zoom;

        const look = {
            fracture: settings.coastlineFracture ?? generation.COASTLINE_FRACTURE,
            shelfRange: settings.shelfRange ?? generation.SHELF_RANGE,
            shelfDepth: generation.COASTAL_PROFILE.SHELF_DEPTH * seaLevel * generation.OCEAN_DEPTH_CAP,
            plainWidth: Math.max(0, settings.coastalPlain ?? generation.COASTAL_PLAIN) * generation.COASTAL_PROFILE.BUFFER_WIDTH * toMap,
            coastalBand: (settings.coastalBand ?? generation.COASTAL_BAND) * toMap,
            coastTexture: COAST_TEXTURE.REACH / noise.perPixel,
            // Measured against the land's full height (1), not the map's own highest ground, which
            // a regional map does not share with its parent
            room: Math.max(SUMMIT.MIN_ROOM, (1 - seaLevel) * SUMMIT.CAP),
            // The engine's detail noise as its land reads it (ProceduralEngine#applyGuidedDetail):
            // at the world position plus the map's pan, at the elevation noise's scale
            detail: {
                zoom,
                scale: (settings.noise?.elevation?.scale ?? DEFAULT_DETAIL_SCALE) * zoom,
                octaves: settings.noise?.elevation?.octaves ?? DEFAULT_DETAIL_OCTAVES,
                extra: terrain.detailOctaves ?? 0,
                panX: settings.noise?.offsetX ?? 0,
                panY: settings.noise?.offsetY ?? 0,
                amount: generation.BLEND_WEIGHTS.GUIDED_DETAIL * (1 - seaLevel) * LAND.DETAIL_SHARE,
            },
        };
        look.key = JSON.stringify(look);
        return look;
    }

    /**
     * The engine's detail noise at a map pixel, from 0 to 1 (ProceduralEngine#fbm, with the
     * same simplex generator, so it matches the land around the island exactly).
     */
    static detailAt(simplex, look, x, y) {
        const { zoom, scale, octaves, extra, panX, panY } = look.detail;
        const nx = (x + panX) / zoom;
        const ny = (y + panY) / zoom;
        let total = 0;
        let frequency = scale;
        let amplitude = 1;
        let maxAmplitude = 0;
        for (let i = 0; i < octaves + extra; i++) {
            total += simplex.noise2D(nx * frequency, ny * frequency) * amplitude;
            if (i < octaves) maxAmplitude += amplitude;
            amplitude *= 0.5;
            frequency *= 2;
        }
        return Math.max(0, (total / maxAmplitude + 1) / 2);
    }

    /**
     * A surface eased into the room above the sea, so no summit rises past SUMMIT.CAP of the
     * land's full height above the sea and low ground keeps its height.
     */
    static capSummit(surface, look, seaLevel) {
        const above = surface - seaLevel;
        return above > 0 ? seaLevel + look.room * Math.tanh(above / look.room) : surface;
    }

    /**
     * An island above the sea, shaped as the engine shapes land: within a coastal plain (no wider
     * than a share of the island) the volcano's rise is lowered towards the sea, and beyond it
     * the rise is the land's large-scale structure; over both lies the engine's detail noise,
     * faded in from the coast and partly across the plain as the engine fades it.
     *
     * @param {number} rise - The volcano's height above the sea here.
     * @param {number} reach - The distance to its coast, in map pixels.
     * @param {number} island - Its coast's distance from the summit, in map pixels.
     * @param {number} detail - The engine's detail noise here (see detailAt).
     */
    static landRelief(rise, reach, island, detail, look, seaLevel) {
        const profile = FILRODENSWMB.GENERATION.COASTAL_PROFILE;
        const plain = Math.min(look.plainWidth, island * profile.PLAIN_SHARE_OF_LANDMASS);
        const nearCoast = smoothstep(0, look.coastalBand, reach);
        const pastPlain = plain > 0 ? smoothstep(plain, plain + look.coastalBand, reach) : nearCoast;
        const structure = rise * (LAND.PLAIN_KEEP + (1 - LAND.PLAIN_KEEP) * pastPlain);
        const noiseWeight = profile.PLAIN_DETAIL * nearCoast + (1 - profile.PLAIN_DETAIL) * pastPlain;
        return seaLevel + structure + detail * noiseWeight * look.detail.amount;
    }

    /**
     * How much of the lava-flow texture a point keeps: all of it along the coast, where it gives
     * small islands their irregular outline (its wavelength is fixed, as a coastline's detail is
     * whatever the island's size), none inland (where it would read as pebbles) or deeper under
     * the sea (where it would read as a scaly ring).
     *
     * @param {number} reach - The distance inland from the coast, in map pixels (negative at sea).
     * @param {number} surface - The volcano's smooth surface here.
     */
    static coastTexture(reach, surface, look, seaLevel) {
        return (1 - smoothstep(0, look.coastTexture, reach)) * smoothstep(seaLevel - COAST_TEXTURE.BELOW, seaLevel, surface);
    }

    /**
     * A pixel's offset from a volcano's centre once its outline has wandered with Coastline
     * Fracture: the volcano is displaced by smooth noise whose wavelength and reach are shares of
     * its island's radius, so a small island wanders as a large one does for its size, and its
     * coast stays one closed line (no islets break off it). The displacement fades out beyond the
     * coast, so the seabed's contours stay smooth, and a volcano with no land is not displaced.
     *
     * @param {number} coast - The coast's distance from the summit, as a share of the footprint.
     */
    static warp(x, y, volcano, coast, look, noise) {
        const dx = x - volcano.x;
        const dy = y - volcano.y;
        if (look.fracture <= 0 || coast <= 0) return { dx, dy };
        const radius = volcano.model.footprint * Math.max(coast, WARP.MIN_COAST);
        const out = Math.hypot(dx, dy) / Math.max(1, radius);
        const amount = radius * WARP.AMOUNT * Math.sqrt(look.fracture / FILRODENSWMB.GENERATION.COASTLINE_FRACTURE) * (1 - smoothstep(WARP.FADE_FROM, WARP.FADE_TO, out));
        if (amount <= 0) return { dx, dy };
        const scale = radius * WARP.WAVELENGTH;
        // Each volcano's noise is moved apart by its place in the world (not on this map), so a
        // regional map's volcano wanders as its parent's does
        const u = dx / scale + noise.bx(volcano.x) * WARP.SEED;
        const v = dy / scale + noise.by(volcano.y) * WARP.SEED;
        return { dx: dx + amount * noise.fbm(u, v, WARP.OCTAVES), dy: dy + amount * noise.fbm(u + WARP.OTHER, v - WARP.OTHER, WARP.OCTAVES) };
    }

    /**
     * How much the shelf flattens the sea round a volcano's coast: 1 is none, more widens the
     * shallows. Larger islands get a wider shelf, up to the map's Continental Shelf setting, and
     * it narrows as the volcano ages and sinks, so a seamount has none.
     *
     * @param {number} minimumDrownAge - The smallest drowning age a volcano is given.
     */
    static shelfExponent(volcano, look, noise, minimumDrownAge) {
        const radius = volcano.radius * noise.perPixel;
        const size = smoothstep(SHELF.FROM_RADIUS, SHELF.FULL_RADIUS, radius);
        const young = 1 - smoothstep(0, Math.max(minimumDrownAge, volcano.drownAge), volcano.age);
        const setting = Math.min(SHELF.MAX_SETTING, look.shelfRange / FILRODENSWMB.GENERATION.SHELF_RANGE);
        return 1 + SHELF.STRENGTH * setting * size * young;
    }

    /**
     * A narrow shelf: water shallower than the shelf's edge is made shallower still (its depth
     * eased by the exponent), so the seabed stays near the surface for a little longer before
     * falling away.
     */
    static shelf(surface, exponent, look, seaLevel) {
        if (exponent <= 1 || surface >= seaLevel) return surface;
        const span = look.shelfDepth * SHELF.SPAN;
        const depth = seaLevel - surface;
        if (depth >= span) return surface;
        return seaLevel - span * Math.pow(depth / span, exponent);
    }
}

// Summits reach at most CAP of the land's full height above the sea, and always have MIN_ROOM
const SUMMIT = { CAP: 0.6, MIN_ROOM: 0.05 };
// The lava-flow texture along the coast: up to REACH baseline pixels inland, fading out over
// BELOW of depth under the sea
const COAST_TEXTURE = { REACH: 25, BELOW: 0.02 };
// The island's land: its rise kept to PLAIN_KEEP on the coastal plain, and DETAIL_SHARE of the
// engine's land detail noise
const LAND = { PLAIN_KEEP: 0.3, DETAIL_SHARE: 1 };
// The outline's wandering: up to AMOUNT of the island's radius (taken as at least MIN_COAST of the
// footprint) at the default Coastline Fracture, growing with the square root of the setting (so
// about twice as far at its maximum), by noise WAVELENGTH island radii long, fading out from
// FADE_FROM to FADE_TO island radii; SEED and OTHER move the noises apart
const WARP = { AMOUNT: 0.15, WAVELENGTH: 0.6, OCTAVES: 2, MIN_COAST: 0.2, FADE_FROM: 1, FADE_TO: 1.5, SEED: 0.013, OTHER: 37.1 };
// The shelf: STRENGTH at its widest, reached by islands of FULL_RADIUS baseline pixels (none below
// FROM_RADIUS) while young, at the default Continental Shelf (up to MAX_SETTING times the
// default); SPAN shelf depths of water are flattened
const SHELF = { STRENGTH: 1.2, FROM_RADIUS: 8, FULL_RADIUS: 60, MAX_SETTING: 2, SPAN: 1 };
// The engine's defaults for the elevation noise, should a map's settings lack them
const DEFAULT_DETAIL_SCALE = 0.005;
const DEFAULT_DETAIL_OCTAVES = 4;
