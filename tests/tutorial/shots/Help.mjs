// The Help page: Help beside the map, and its Shortcuts.
import { MAP } from "./_common.mjs";

export default [
    {
        slug: "help-panel",
        start: MAP.finished,
        caption: "Help, open beside the map, with About and Help.",
        action: [{ do: "click", target: '.fwmb-rail-btn[data-action="toggleHelp"]' }],
        screenshot: { region: "studio" },
    },
    {
        slug: "help-shortcuts",
        start: MAP.finished,
        caption: "Help's Shortcuts, with the Regions tool's actions unfolded.",
        action: [
            { do: "click", target: '[data-region="inspector"] summary:has-text("Shortcuts"), dialog[open] summary:has-text("Shortcuts")' },
            { do: "click", target: 'dialog[open] summary:has-text("Regions")' },
        ],
        screenshot: { region: "inspector" },
    },
];
