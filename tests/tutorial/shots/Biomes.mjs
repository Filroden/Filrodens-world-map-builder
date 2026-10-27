// The Biomes page: the panel, Edit biomes with the tutorial's Moorland, and the rule editor.
import { MAP } from "./_common.mjs";

export default [
    {
        slug: "biomes-panel",
        start: MAP.terrain,
        caption: "Biomes, with the Climate and Moisture sections, and the bar while painting.",
        action: [
            { do: "tool", tool: "biomes" },
            { do: "click", target: { role: "button", name: "Start painting" } },
            { do: "set", field: 'select[name="brushBiome"]', value: "Moorland" },
        ],
        screenshot: { region: "studio" },
    },
    {
        slug: "biomes-edit-biomes",
        start: MAP.terrain,
        caption: "Edit biomes: the built-in biomes' colours, and a custom biome.",
        action: [
            { do: "click", target: { role: "button", name: "Stop painting" } },
            { do: "openSection", section: "biomeColours" },
        ],
        screenshot: { region: { selector: 'details.fwmb-section[data-section="biomeColours"]' }, pad: 8 },
    },
    {
        slug: "biomes-rule-editor",
        start: MAP.terrain,
        caption: "The Biome rule editor, with Moorland's rule.",
        action: [{ do: "click", target: '[data-action="openBiomeRuleEditor"]' }, { do: "waitForDialog" }],
        settle: false,
        screenshot: { region: "dialog", pad: 8 },
        after: [{ do: "dialog", button: "cancel" }],
    },
];
