// FILRODENSWMB split by layer (RF1): this file holds the platform's settings (Foundry's flags, grid
// types and compendiums).
// src/config.js puts every layer's part back together in the shape the module has always read,
// so code importing it is unchanged.

/** The platform's own groups of FILRODENSWMB. */
export const PLATFORM_CONFIG = {
    FLAGS: {
        IS_ACTIVE: "isActiveCanvas",
        // The area and scale a scene was exported with (S0 step 7b), so exporting again can say
        // when a different choice would leave its walls, lights and tokens out of line
        EXPORT_AREA: "exportArea",
        HEX_DATA: "hexData",
        PARAMS: "generationParams",
        // Where GridDataExporter writes the per-grid-cell exploration data layer at export time
        // (see GRID_DATA below for the thresholds that classify it). Named "gridData" rather than
        // reusing HEX_DATA above because the schema covers every grid shape FWMB supports (square
        // and both hex orientations), not hexes specifically.
        GRID_DATA: "gridData",
    },
    // Foundry's own CONST.GRID_TYPES numeric values (and a human-readable label for each) for the
    // three grid shapes FWMB supports, keyed by uiState.gridType. FWMB only ever exports the
    // odd-offset hex variants (HEXODDR/HEXODDQ) - Foundry's even-offset variants are never used -
    // so this is a fixed, small map rather than the full GRID_TYPES enum. Shared by SceneExporter
    // (which writes `type` onto the Scene document's own grid config) and GridDataExporter (which
    // writes both `type` and `name` into the exported grid-data payload's `grid` object), so the
    // mapping only exists in one place.
    GRID_TYPES: {
        none: { value: 0, name: "GRIDLESS" },
        square: { value: 1, name: "SQUARE" },
        hexR: { value: 2, name: "HEXODDR" },
        hexC: { value: 4, name: "HEXODDQ" },
    },
    COMPENDIUM: {
        NAME: "fwmb-maps",
        LABEL: "Filroden's World Map Builder",
        // v5's world records (see Worlds), in a compendium of their own so that 4.3, reading the
        // maps compendium, still finds only maps there
        WORLDS_NAME: "fwmb-worlds",
        WORLDS_LABEL: "Filroden's World Map Builder: worlds",
    },
};
