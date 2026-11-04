// The Terrain page: the panel on a Guided map and on a Legacy generation map (with its Noise
// window), and the bar while terraforming.
import { MAP } from "./_common.mjs";

export default [
    {
        slug: "terrain-panel",
        start: MAP.terrain,
        caption: "Terrain on the tutorial's Guided map, with the Generation section open.",
        action: [{ do: "tool", tool: "terrain" }],
        screenshot: { region: "studio" },
    },
    {
        slug: "terrain-panel-standard",
        start: null,
        caption: "Terrain on a Legacy generation map: Sea level, Detail and Stretch, and the Noise window's buttons to zoom and move over the endless terrain.",
        // A new map is Advanced (tectonics): choose Legacy generation first, discarding the new map
        action: [
            { do: "set", field: "#fwmb-generation-engine", value: "standard" },
            { do: "dialog", button: "Discard" },
            { do: "expect", check: (studio) => studio.uiState.generationEngine === "standard" || "the map is not Legacy generation", within: 60000 },
            { do: "settle" },
            { do: "tool", tool: "terrain" },
            { do: "openSection", section: "terrainGeneration" },
        ],
        screenshot: { region: { selector: 'details.fwmb-section[data-section="terrainGeneration"]' }, pad: 8 },
    },
    {
        slug: "terrain-bar",
        start: MAP.terrain,
        caption: "The bar while terraforming: the brush modes with Raise chosen, then Size, Strength and Feather.",
        action: [{ do: "tool", tool: "terrain" }, { do: "click", target: { role: "button", name: "Start terraforming" } }, { do: "mode", action: "setBrushTool", attr: "tool", mode: "raise" }],
        screenshot: { region: "bar" },
        after: [{ do: "click", target: { role: "button", name: "Stop terraforming" } }],
    },
];
