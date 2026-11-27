// FILRODENSWMB split by layer (RF1): this file holds the shell's settings.
// src/config.js puts every layer's part back together in the shape the module has always read,
// so code importing it is unchanged.

/** Settings the shell reads that sit in the World studio's group (UI), which takes them from here. */
export const SHELL_PARTS = Object.freeze({
    RTL_LANGUAGES: ["ar", "he", "fa", "ur"],
});

/** The shell's own groups of FILRODENSWMB. */
export const SHELL_CONFIG = {
    // The studio shell's own settings. The World studio's tools, stages, occasional tools, Next
    // footers and state words are its registration (src/studios/world/definition.js).
    STUDIO: {
        // The localisation keys of each state word: its name, the state block's start and stop
        // buttons, and the line in a section its editing pauses
        STATE_WORDS: {
            terraforming: "Terraforming",
            painting: "Painting",
            drawing: "Drawing",
            placing: "Placing",
        },
        // The bar's modes that fold into More when the bar runs short (see BarFold), per tool and
        // group, least used first. Modes not listed stay on the bar at every width, as does the
        // mode in use.
        FOLD_RANK: {
            terrain: ["slopeDown", "slopeUp", "level", "roughen", "smooth"],
            features: ["spring"],
            regions: ["fill", "erase"],
            route: ["edit"],
        },
        // The map controls' layer toggles after the Terrain and Biomes groups, in their order: the
        // layers drawn on the map, then those drawn over it (the grid is a setting of the map, so it
        // has its own action)
        VIEW_LAYERS: [
            { id: "infrastructure", icon: "location-city", label: "FILRODENSWMB.UI.LayerInfrastructure" },
            // Regions and Labels open a menu of their levels and label styles (see ContentRows)
            { id: "regions", icon: "pentagon", label: "FILRODENSWMB.UI.LayerRegions", rows: true },
            { id: "labels", icon: "insert-text", label: "FILRODENSWMB.UI.LayerLabels", rows: true },
            { id: "cartography", icon: "explore", label: "FILRODENSWMB.UI.LayerCartography" },
        ],
        OVERLAY_LAYERS: [
            { id: "contours", action: "toggleLayer", icon: "scatter-plot", label: "FILRODENSWMB.UI.LayerContours" },
            { id: null, action: "toggleGrid", icon: "grid-on", label: "FILRODENSWMB.UI.ToggleGrid" },
            { id: "reference", action: "toggleLayer", icon: "image", label: "FILRODENSWMB.UI.LayerReference" },
        ],
    },
};
