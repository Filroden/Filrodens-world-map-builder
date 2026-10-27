// The Generate page: the panel after a run, the Ages section, and Fill in on a regional map.
import { MAP } from "./_common.mjs";

export default [
    {
        slug: "generate-overview",
        start: MAP.generated,
        caption: "Generate after a run on the tutorial's world map, with its realms, roads and towns on the map.",
        action: [{ do: "tool", tool: "generate" }],
        screenshot: { region: "studio" },
    },
    {
        slug: "generate-ages",
        start: MAP.generated,
        caption: "The Ages section: an early medieval age of peace, then the present, troubled, with the Hillfolk invading.",
        action: [{ do: "openSection", section: "generateAges" }],
        screenshot: { region: { selector: 'details.fwmb-section[data-section="generateAges"]' }, pad: 8 },
    },
    {
        slug: "generate-fill-in",
        start: MAP.regional,
        caption: "Fill in on a regional map at the Local detail level: the villages, market towns and lanes between the towns it inherited.",
        action: [{ do: "tool", tool: "generate" }, { do: "openSection", section: "generateInfill" }],
        screenshot: { region: "studio" },
    },
];
