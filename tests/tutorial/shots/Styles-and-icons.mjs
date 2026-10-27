// The Styles and icons page: the panel, and a style row's menu.
import { MAP } from "./_common.mjs";

export default [
    {
        slug: "styles-and-icons-panel",
        start: MAP.places,
        caption: "Styles and icons: the Pin styles and Route styles, each with a preview and how many items use it.",
        action: [{ do: "tool", tool: "library" }],
        screenshot: { region: "panel" },
    },
    {
        slug: "styles-and-icons-row-menu",
        start: MAP.places,
        caption: "A route style's More options menu: Rename, Duplicate and Delete.",
        action: [
            { do: "point", target: '.fwmb-list-item[data-style-type="Route"]:has(:text-is("Main road"))' },
            { do: "click", target: '.fwmb-list-item[data-style-type="Route"]:has(:text-is("Main road")) button[data-tooltip="More options"]' },
        ],
        settle: false,
        // The menu closes when focus leaves it, so the screenshot keeps it
        screenshot: { region: "studio", keepFocus: true, pointer: "keep" },
    },
];
