// The Cartography page: the panel with two decorations, and a decoration in the inspector.
import { DIALOG, MAP } from "./_common.mjs";

/** The decorations, original images made for the wiki (samples/wiki). */
const COMPASS = "samples/wiki/compass-rose.png";
const CARTOUCHE = "samples/wiki/cartouche.png";

const addDecoration = (name, file) => [
    { do: "click", target: '[data-region="editToolbar"] [data-action="addDecoration"]' },
    { do: "waitForDialog" },
    { do: "set", field: `${DIALOG} input[name="fwmb-dec-name"]`, value: name },
    { do: "chooseFile", target: `${DIALOG} button[data-tooltip="Choose a file"]`, file },
    { do: "dialog", button: "ok" },
];

export default [
    {
        slug: "cartography-panel",
        start: MAP.finished,
        caption: "Cartography, with the scale bar, border and grid, and two decorations.",
        action: [
            { do: "tool", tool: "cartography" },
            { do: "mode", action: "setCartographyMode", mode: "move" },
            ...addDecoration("Compass rose", COMPASS),
            { do: "settle" },
            { do: "drag", from: [1000, 800], to: [1760, 1360] },
            ...addDecoration("Title", CARTOUCHE),
            { do: "settle" },
            { do: "drag", from: [1000, 800], to: [1000, 150] },
            { do: "mode", action: "setCartographyMode", mode: "select" },
            { do: "camera", view: "fit" },
        ],
        screenshot: { region: "studio" },
    },
    {
        slug: "cartography-decorations",
        start: MAP.finished,
        caption: "The compass rose, open in the inspector.",
        action: [
            { do: "click", target: '.fwmb-list-item:has(:text-is("Compass rose"))' },
            { do: "camera", view: "fit" },
        ],
        screenshot: { region: "studio" },
    },
];
