// The Labels page: Name natural features and its counts, the list with a standalone label in the
// inspector, and a label held and turned.
import { MAP } from "./_common.mjs";

/** The tutorial's standalone label, The Morning Sea, and the sea round it. */
const SEA = [1540, 800];
const SEA_VIEW = [1380, 600, 1700, 1000];

/** The sea east of the continent, where several natural features' names show at once. */
const EAST_SEA = [1150, 400, 1950, 1050];

/** The Labels list's Kind of label filter. */
const KIND_FILTER = 'select[data-list-query="label"][data-query-field="kind"]';

export default [
    {
        slug: "labels-natural-features",
        start: MAP.places,
        caption: "The Natural features section after a run, the list showing the names it gave, and some of them on the map east of the continent.",
        action: [
            { do: "tool", tool: "labels" },
            { do: "openSection", section: "featureNames" },
            { do: "click", target: '[data-region="context"] [data-action="nameFeatures"]' },
            {
                do: "expect",
                check: () => document.querySelectorAll('details.fwmb-section[data-section="featureNames"] .fwmb-generate-results').length > 0,
                message: "Name natural features reported its counts",
                within: 60000,
            },
            { do: "set", field: KIND_FILTER, value: "feature" },
            { do: "settle" },
            { do: "frame", rect: EAST_SEA },
        ],
        screenshot: { region: "studio" },
    },
    {
        slug: "labels-overview",
        start: MAP.places,
        caption: "Labels, searched for \"mo\": standalone and owned labels, each owned one with what it belongs to, and The Morning Sea in the inspector.",
        action: [
            { do: "set", field: KIND_FILTER, value: "all" },
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
