// The Cultures page: the Generate tool's Cultures section with the tutorial's two peoples.
import { MAP } from "./_common.mjs";

export default [
    {
        slug: "cultures-overview",
        start: MAP.generated,
        caption: "Generate's Cultures section with the Hillfolk and the Valefolk, and the Hillfolk in the inspector, their homeland marked on the map.",
        action: [
            { do: "tool", tool: "generate" },
            { do: "openSection", section: "generateCultures" },
            { do: "click", target: '[data-section="generateCultures"] .fwmb-list-item:has(:text-is("Hillfolk"))' },
        ],
        screenshot: { region: "studio" },
    },
];
