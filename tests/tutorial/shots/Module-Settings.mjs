// The Module Settings page: the Appearance menu.
import { MAP } from "./_common.mjs";

export default [
    {
        slug: "module-settings-appearance",
        start: MAP.finished,
        caption: "Appearance, here in the rail's More menu (on a taller window it has a button of its own), with Mode set to Dark and Hue to Teal.",
        action: [{ do: "click", target: ".fwmb-rail-more > .fwmb-rail-btn" }],
        settle: false,
        // The menu closes when focus leaves it, so the screenshot keeps it
        screenshot: { region: "studio", keepFocus: true, pointer: "keep" },
    },
];
