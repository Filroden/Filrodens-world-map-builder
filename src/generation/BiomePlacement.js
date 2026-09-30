import { FILRODENSWMB } from "../config.js";

/**
 * The three places a biome can be drawn. A pixel of dry land has one place (LAND); a pixel under
 * water (the sea, or a lake) has two, the bed under the water (UNDERWATER) and the surface of the
 * water (OVERWATER), and can show a biome in each at once (Pack Ice floating over Deep Ocean, for
 * example). Values are bit flags so a placement can allow more than one side.
 */
export const BIOME_SIDE = Object.freeze({ LAND: 1, UNDERWATER: 2, OVERWATER: 4 });

/** Every side a water pixel has. */
const WATER_SIDES = BIOME_SIDE.UNDERWATER | BIOME_SIDE.OVERWATER;

/** Every side at once: the eraser, which has to be able to clear paint wherever it lies. */
const ALL_SIDES = BIOME_SIDE.LAND | WATER_SIDES;

/** Biome ids are stored in a Uint8Array override raster, so no id can exceed this. */
const MAX_BIOME_ID = 255;

const PLACEMENT = FILRODENSWMB.BIOME_PLACEMENT;

/** The sides each placement allows. */
const SIDES_BY_PLACEMENT = Object.freeze({
    [PLACEMENT.LAND]: BIOME_SIDE.LAND,
    [PLACEMENT.UNDERWATER]: BIOME_SIDE.UNDERWATER,
    [PLACEMENT.OVERWATER]: BIOME_SIDE.OVERWATER,
    [PLACEMENT.LAND_UNDERWATER]: BIOME_SIDE.LAND | BIOME_SIDE.UNDERWATER,
    [PLACEMENT.LAND_OVERWATER]: BIOME_SIDE.LAND | BIOME_SIDE.OVERWATER,
});

/** The localisation key naming each placement, as offered in the custom biome dialogue. */
const LABEL_BY_PLACEMENT = Object.freeze({
    [PLACEMENT.LAND]: "FILRODENSWMB.UI.BiomePlacementLand",
    [PLACEMENT.UNDERWATER]: "FILRODENSWMB.UI.BiomePlacementUnderwater",
    [PLACEMENT.OVERWATER]: "FILRODENSWMB.UI.BiomePlacementOverwater",
    [PLACEMENT.LAND_UNDERWATER]: "FILRODENSWMB.UI.BiomePlacementLandUnderwater",
    [PLACEMENT.LAND_OVERWATER]: "FILRODENSWMB.UI.BiomePlacementLandOverwater",
});

/**
 * Where each biome may appear. Placement is the one rule that painting, auto-generation rules
 * and rendering all obey, so a forest can never show under the sea and Deep Ocean can never show
 * on dry land, whatever a rule or a brush stroke asks for.
 */
export class BiomePlacement {
    /**
     * The sides a placement allows. An unknown or missing placement is treated as land-only,
     * which is what every biome was before placements existed.
     * @param {string} placement - One of FILRODENSWMB.BIOME_PLACEMENT.
     * @returns {number} BIOME_SIDE flags.
     */
    static sidesOf(placement) {
        return SIDES_BY_PLACEMENT[placement] ?? BIOME_SIDE.LAND;
    }

    /**
     * The localisation key naming a placement.
     * @param {string} placement - One of FILRODENSWMB.BIOME_PLACEMENT.
     * @returns {string}
     */
    static labelOf(placement) {
        return LABEL_BY_PLACEMENT[placement] ?? LABEL_BY_PLACEMENT[PLACEMENT.LAND];
    }

    /**
     * A custom biome's placement. Biomes saved before placements existed have none; they carry
     * the older `solidOverWater` flag instead, which meant "shows over water as well as on
     * land", so it reads as land and overwater. Without the flag they were land biomes (they
     * could only be painted on land, and a rule match below sea level drew nothing).
     * @param {{placement?: string, solidOverWater?: boolean}} biome
     * @returns {string} One of FILRODENSWMB.BIOME_PLACEMENT.
     */
    static placementOfCustom(biome) {
        if (biome?.placement && SIDES_BY_PLACEMENT[biome.placement]) return biome.placement;
        return biome?.solidOverWater ? PLACEMENT.LAND_OVERWATER : PLACEMENT.LAND;
    }

    /**
     * A built-in biome's placement, by its key in FILRODENSWMB.BIOME_IDS.
     * @param {string} key
     * @returns {string} One of FILRODENSWMB.BIOME_PLACEMENT.
     */
    static placementOfBuiltIn(key) {
        return FILRODENSWMB.BUILT_IN_BIOME_PLACEMENT[key] ?? PLACEMENT.LAND;
    }

    /**
     * A lookup from biome id to the sides it may appear on, for the per-pixel hot paths (the
     * biome painters and the brush). Index 0 is the eraser and allows every side. An id with no
     * biome behind it (a deleted custom biome whose paint is still on the map) allows none.
     * @param {Array<{id: number, placement?: string, solidOverWater?: boolean}>} customBiomes
     * @returns {Uint8Array} BIOME_SIDE flags indexed by biome id.
     */
    static buildSidesTable(customBiomes = []) {
        const table = new Uint8Array(MAX_BIOME_ID + 1);
        table[FILRODENSWMB.BIOME_IDS.ERASER] = ALL_SIDES;
        for (const [key, id] of Object.entries(FILRODENSWMB.BIOME_IDS)) {
            if (id === FILRODENSWMB.BIOME_IDS.ERASER) continue;
            table[id] = BiomePlacement.sidesOf(BiomePlacement.placementOfBuiltIn(key));
        }
        for (const biome of customBiomes) {
            if (biome.id > 0 && biome.id <= MAX_BIOME_ID) table[biome.id] = BiomePlacement.sidesOf(BiomePlacement.placementOfCustom(biome));
        }
        return table;
    }

    /**
     * Whether a biome allowed on these sides can be painted on a pixel. A brush only knows
     * whether a pixel is below sea level (lakes come from the rivers, which are worked out after
     * the brush strokes are replayed), so the sea counts as water and everything else as land.
     * @param {number} sides - BIOME_SIDE flags of the biome being painted.
     * @param {boolean} isSea - Whether the pixel is below sea level.
     * @returns {boolean}
     */
    static canPaint(sides, isSea) {
        return isSea ? (sides & WATER_SIDES) !== 0 : (sides & BIOME_SIDE.LAND) !== 0;
    }
}
