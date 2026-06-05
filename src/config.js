export const FILRODENSWMB = {
    ID: "filrodens-world-map-builder",
    FLAGS: {
        IS_ACTIVE: "isActiveCanvas",
        HEX_DATA: "hexData",
        PARAMS: "generationParams",
    },
    TEMPLATES: {
        TOOLBAR: "modules/filrodens-world-map-builder/templates/toolbar.hbs",
    },
    DISPLAY: {
        ALPHA: 0.8,
    },
    DEFAULTS: {
        SEA_LEVEL: 0.35,
        LAT_TOP: 90,
        LAT_BOTTOM: -90,
        GLOBAL_TEMP: 0.5,
        MAP_WIDTH: 1000,
        MAP_HEIGHT: 1000,
    },
    NOISE: {
        ELEVATION: { SCALE: 250, OCTAVES: 5, PERSISTENCE: 0.5, LACUNARITY: 2, EXPONENT: 1.2, STRETCH: 1.3 },
        MOISTURE: { SCALE: 12, OCTAVES: 3, PERSISTENCE: 0.6, LACUNARITY: 2, EXPONENT: 1, STRETCH: 1.2 },
        TEMPERATURE: { SCALE: 25, OCTAVES: 2, PERSISTENCE: 0.5, LACUNARITY: 2, EXPONENT: 1, STRETCH: 1 },
    },
    BIOMES: {
        // Oceans
        DEEP_OCEAN: [26, 75, 132],
        SHALLOW_OCEAN: [46, 117, 182],
        PACK_ICE: [225, 235, 240],

        // Cold
        SNOW: [240, 240, 240],
        TUNDRA: [149, 163, 164],
        TAIGA: [77, 107, 83],

        // Temperate
        GRASSLAND: [141, 163, 104],
        DECIDUOUS_FOREST: [58, 122, 70],
        TEMPERATE_RAINFOREST: [41, 92, 53],
        TEMPERATE_DESERT: [194, 178, 128],

        // Tropical
        TROPICAL_RAINFOREST: [23, 66, 32],
        SAVANNA: [196, 186, 114],
        SUBTROPICAL_DESERT: [214, 198, 137],
    },
    BIOME_IDS: {
        DEEP_OCEAN: 1,
        SHALLOW_OCEAN: 2,
        SNOW: 3,
        TUNDRA: 4,
        TAIGA: 5,
        GRASSLAND: 6,
        DECIDUOUS_FOREST: 7,
        TEMPERATE_RAINFOREST: 8,
        TEMPERATE_DESERT: 9,
        TROPICAL_RAINFOREST: 10,
        SAVANNA: 11,
        SUBTROPICAL_DESERT: 12,
        PACK_ICE: 13,
    },
    COMPENDIUM: {
        NAME: "fwmb-maps",
        LABEL: "Filroden's World Map Builder",
    },
};
