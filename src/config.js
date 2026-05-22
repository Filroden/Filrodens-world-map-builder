export const FILRODENSHEX = {
    ID: "filrodens-hex-crafter",
    FLAGS: {
        IS_ACTIVE: "isActiveCanvas",
        HEX_DATA: "hexData",
        PARAMS: "generationParams",
    },
    TEMPLATES: {
        TOOLBAR: "modules/filrodens-hex-crafter/templates/toolbar.hbs",
    },
    DISPLAY: {
        ALPHA: 0.8,
    },
    DEFAULTS: {
        SEA_LEVEL: 0.35,
        LAT_TOP: 90,
        LAT_BOTTOM: -90,
        GLOBAL_TEMP: 0.5,
    },
    NOISE: {
        ELEVATION: { SCALE: 0.04, OCTAVES: 5, PERSISTENCE: 0.5, LACUNARITY: 2, EXPONENT: 1.2, STRETCH: 1.3 },
        MOISTURE: { SCALE: 0.08, OCTAVES: 3, PERSISTENCE: 0.6, LACUNARITY: 2, EXPONENT: 1, STRETCH: 1.2 },
        TEMPERATURE: { SCALE: 0.04, OCTAVES: 2, PERSISTENCE: 0.5, LACUNARITY: 2, EXPONENT: 1, STRETCH: 1 },
    },
    BIOMES: {
        ocean: { color: 0x1a4b84 },
        coast: { color: 0x2a72a4 },
        peak: { color: 0xffffff },
        mountain: { color: 0x7a7a7a },
        jungle: { color: 0x1e592f },
        savanna: { color: 0x8da848 },
        desert: { color: 0xd4b872 },
        swamp: { color: 0x3d523a },
        forest: { color: 0x337a3e },
        plains: { color: 0x75a152 },
        taiga: { color: 0x476356 },
        tundra: { color: 0x93a39a },
        ice: { color: 0xddeaf0 },
    },
    COMPENDIUM: {
        NAME: "fhc-maps",
        LABEL: "Hex Crafter Maps",
    },
};
