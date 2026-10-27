// The New map page: the panel on a Standard map, drawing land masks on a Guided map, and the
// regional map crop.
import { MAP } from "./_common.mjs";

export default [
    {
        slug: "new-map-panel",
        start: null,
        caption: "New map on a Standard map, with the Generation section open.",
        screenshot: { region: "studio" },
    },
    {
        slug: "new-map-land-masks",
        start: MAP.masks,
        caption: "Drawing land masks on the tutorial's Guided map: Land chosen on the bar, the masks' points on the map, and the Land masks list.",
        action: [
            { do: "tool", tool: "scene" },
            { do: "click", target: { role: "button", name: "Start drawing" } },
            { do: "mode", action: "setSceneMode", mode: "addMask" },
            { do: "camera", view: "fit" },
        ],
        screenshot: { region: "studio" },
    },
    {
        slug: "new-map-regional-crop",
        start: MAP.finished,
        caption: "Crop mode: the crop round the Red Hills, and the Regional map section with its size, zoom and latitudes.",
        action: [
            { do: "tool", tool: "scene" },
            { do: "openSection", section: "regionalMap" },
            { do: "set", field: 'input[name="regionalTargetWidth"]', value: 1600 },
            { do: "mode", action: "setSceneMode", mode: "crop" },
            { do: "drag", from: [1040, 300], to: [1440, 740] },
        ],
        screenshot: { region: "studio" },
    },
];
