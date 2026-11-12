// The Generate page: the panel after a run, the Ages section, Name all's dialogue, and Fill in on a
// regional map.
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
        caption: "The Ages list: an early medieval age of peace, then the present, troubled, open in the inspector with the Hillfolk invading.",
        action: [
            { do: "openSection", section: "generateAges" },
            { do: "click", target: '.fwmb-age-row:has-text("the present")' },
        ],
        screenshot: { region: "studio" },
        after: [{ do: "click", target: "dialog.fwmb-inspector[open] .fwmb-overlay-close" }],
    },
    {
        slug: "generate-name-all",
        start: MAP.generated,
        caption: "The Name all dialogue, with the number of items it will name.",
        action: [
            { do: "openSection", section: "generateNames" },
            { do: "click", target: '[data-region="context"] [data-action="nameAll"]' },
            { do: "waitForDialog" },
            // A generated map's names are all generated, so they are ticked to show what it would name
            { do: "set", field: 'dialog.fwmb-overlay-modal[open] input[name="nameAllSource"][value="generated"]', value: true },
        ],
        settle: false,
        screenshot: { region: "dialog", pad: 8 },
        after: [{ do: "dialog", button: "cancel" }],
    },
    {
        slug: "generate-fill-in",
        start: MAP.regional,
        caption: "Fill in on a regional map at the Local detail level: the villages, market towns and lanes between the towns it inherited.",
        action: [{ do: "tool", tool: "generate" }, { do: "openSection", section: "generateInfill" }],
        screenshot: { region: "studio" },
    },
];
