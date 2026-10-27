// The History page: the tool on the tutorial's world, in its first age.
import { MAP } from "./_common.mjs";

export default [
    {
        slug: "history-overview",
        start: MAP.explored,
        caption: "History on the tutorial's world in Age 1, with that age's realms, towns, roads and names.",
        action: [{ do: "tool", tool: "history" }, { do: "click", target: '[data-action="chooseHistoryAge"][data-age="1"]' }],
        screenshot: { region: "studio" },
    },
];
