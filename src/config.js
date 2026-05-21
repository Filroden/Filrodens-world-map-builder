export const FILRODENSHEX = {
    ID: "filrodens-hex-crafter",
    FLAGS: {
        IS_ACTIVE: "isActiveCanvas",
        HEX_DATA: "hexData",
    },
    TEMPLATES: {
        TOOLBAR: "modules/filrodens-hex-crafter/templates/toolbar.hbs",
    },
    THRESHOLDS: {
        ELEVATION_MIN: 0,
        ELEVATION_MAX: 1,
    },
    // Added for the Stage 1 TV Static test
    TESTING: {
        GRID_SIZE: 20, // Limit the test to a 20x20 grid to prevent loop lockups
        ALPHA: 0.6, // Slight transparency so the underlying native grid remains visible
    },
};
