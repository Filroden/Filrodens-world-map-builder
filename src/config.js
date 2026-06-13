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
    DEFAULTS: {
        SEED: "FILRODEN",
        SEA_LEVEL: 0.35,
        LAT_TOP: 90,
        LAT_BOTTOM: -90,
        GLOBAL_TEMP: 0.5,
        MAP_WIDTH: 1000,
        MAP_HEIGHT: 1000,
    },
    DISPLAY: {
        ALPHA: 0.8,
        BIOME_ALPHA_ACTIVE: 0.85,
        BIOME_ALPHA_INACTIVE: 0.65,
        RIVER_WIDTH: 2,
        RIVER_ALPHA: 0.9,
        PIN_RADIUS: 6,
        PIN_ALPHA: 0.4,
    },
    HYDROLOGY: {
        MAX_LAKE_SIZE: 8000,
        SPRING_ALTITUDE_OFFSET: 0.25,
        SPRING_MOISTURE_MIN: 0.45,
        MEANDER_JITTER: 0.005,
    },
    CLIMATE: {
        ALTITUDE_COOLING: 0.4,
        FREEZING_THRESHOLD: 0.2,
        THRESHOLDS: {
            TEMPERATURE: {
                ARCTIC: 0.2,
                SUBARCTIC: 0.4,
                TEMPERATE: 0.8,
            },
            MOISTURE: {
                ARCTIC: {
                    SNOW: 0.5,
                },
                SUBARCTIC: {
                    TUNDRA: 0.3,
                    TAIGA: 0.6,
                },
                TEMPERATE: {
                    DESERT: 0.25,
                    GRASSLAND: 0.6,
                    DECIDUOUS: 0.85,
                },
                TROPICAL: {
                    DESERT: 0.2,
                    SAVANNA: 0.4,
                    DECIDUOUS: 0.7,
                },
            },
        },
    },
    NOISE: {
        ELEVATION: { SCALE: 250, OCTAVES: 5, PERSISTENCE: 0.5, LACUNARITY: 2, EXPONENT: 1.2, STRETCH: 1.75 },
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
