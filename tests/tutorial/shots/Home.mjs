// The Home page: the whole studio on the finished tutorial map, and the tutorial's world map and
// regional map exported as PNGs (which the README shows too).
import { exportPng, MAP, regionRow } from "./_common.mjs";

export default [
    {
        slug: "home-studio",
        start: MAP.finished,
        caption: "The studio on a finished map: Regions open, with the realm Islemark in the inspector.",
        action: [
            { do: "tool", tool: "regions" },
            { do: "click", target: regionRow("set", "Political") },
            { do: "click", target: regionRow("region", "Islemark") },
            { do: "camera", view: "fit" },
        ],
        screenshot: { region: "studio" },
    },
    {
        slug: "home-world-map",
        start: MAP.finished,
        caption: "The tutorial's world map, P0JBVA.",
        action: exportPng("fwmb-home-world.png"),
        exported: "fwmb-home-world.png",
    },
    {
        slug: "home-regional-map",
        start: MAP.regional,
        caption: "The tutorial's regional map of the Red Hills.",
        action: exportPng("fwmb-home-regional.png"),
        exported: "fwmb-home-regional.png",
    },
];
