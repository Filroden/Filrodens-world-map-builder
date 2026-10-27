// The Labels page: the list with a standalone label in the inspector, and a label held and turned.
import { MAP } from "./_common.mjs";

/** The tutorial's standalone label, The Morning Sea, and the sea round it. */
const SEA = [1540, 800];
const SEA_VIEW = [1380, 600, 1700, 1000];

export default [
    {
        slug: "labels-overview",
        start: MAP.places,
        caption: "Labels, searched for \"mo\": standalone and owned labels, each owned one with what it belongs to, and The Morning Sea in the inspector.",
        action: [
            { do: "tool", tool: "labels" },
            { do: "set", field: 'input[name="listSearch-label"]', value: "mo" },
            { do: "click", target: '.fwmb-list-item:has(.fwmb-name:text-is("The Morning Sea"))' },
        ],
        screenshot: { region: "studio" },
    },
    {
        slug: "labels-place-rotate",
        start: MAP.places,
        caption: "In Place mode, The Morning Sea held and turned with the mouse wheel; the hint lists what a held label can do.",
        action: [
            { do: "click", target: "dialog.fwmb-inspector[open] .fwmb-overlay-close" },
            { do: "mode", action: "setPickMode", mode: "place" },
            { do: "frame", rect: SEA_VIEW },
            { do: "press", at: SEA },
            { do: "wheel", notches: 3 },
        ],
        settle: false,
        screenshot: { region: "studio", pointer: "keep" },
        after: [{ do: "release" }],
    },
];
