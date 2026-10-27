// The Regions page: painting a region, the bar in Fill mode, and a lower layer's inspector.
import { MAP, regionRow } from "./_common.mjs";

/** The east of the continent's desert, round the Red Hills. */
const HILLS = [960, 330, 1400, 720];

export default [
    {
        slug: "regions-overview",
        start: MAP.places,
        caption: "Regions with the Lands set chosen, the Red Hills being painted and open in the inspector.",
        action: [
            { do: "tool", tool: "regions" },
            { do: "click", target: regionRow("set", "Lands") },
            { do: "click", target: regionRow("region", "The Red Hills") },
            { do: "mode", action: "setRegionMode", mode: "paint" },
            { do: "frame", rect: HILLS },
            { do: "hover", at: [1160, 520] },
        ],
        screenshot: { region: "studio", pointer: [1160, 520] },
    },
    {
        slug: "regions-bar-fill",
        start: MAP.places,
        caption: "Fill mode: the bar without a brush size, and the area a click would fill outlined on the map.",
        action: [{ do: "mode", action: "setRegionMode", mode: "fill" }, { do: "hover", at: [1060, 600] }],
        screenshot: { region: { union: ["bar", { map: HILLS }] }, pointer: [1060, 600] },
    },
    {
        slug: "regions-layer-inspector",
        start: MAP.places,
        caption: "The inspector for the Political set's Duchies layer, a layer below Realms: its parent, nesting, territorial waters and borders.",
        action: [
            { do: "mode", action: "setRegionMode", mode: "select" },
            { do: "click", target: regionRow("set", "Political") },
            { do: "click", target: '[data-action="editLevel"] >> nth=1' },
        ],
        screenshot: { region: "inspector" },
    },
];
