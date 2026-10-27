// The Rivers and faults page: the panel with the tutorial's river and rift, river sources, and the
// four tectonic features side by side on the sketch map from the tutorial's last page.
import { MAP } from "./_common.mjs";

/** Above the sketch map's top edge: a right-click there finishes a shape. */
const SKETCH_FINISH = [600, -60];

/** The tutorial's own river source and the one it removed, and the land between. */
const SOURCES = [430, 330, 1250, 650];

/** One of each tectonic feature, west to east, on the Isle of Ashgrove and the sea round it. */
const FEATURES = [
    ["Mountain range", [[260, 330], [330, 260], [420, 230]]],
    ["Subduction zone", [[1150, 120], [1170, 300], [1150, 480]]],
    ["Rift", [[600, 560], [680, 640], [760, 700]]],
    ["Hotspot chain", [[1000, 820], [1090, 860], [1180, 880]]],
];

const draw = ([type, points], finishAt) => [
    { do: "set", field: '[data-region="editToolbar"] select[name="faultType"]', value: type },
    { do: "shape", points, finishAt, fitAfterFirst: true },
    { do: "settle" },
];

export default [
    {
        slug: "rivers-and-faults-panel",
        start: MAP.terrain,
        caption: "Rivers and faults with the tutorial's custom river and rift listed, and the bar in Fault mode.",
        action: [
            { do: "tool", tool: "features" },
            { do: "mode", action: "setFeatureMode", mode: "fault" },
            { do: "camera", view: "fit" },
        ],
        screenshot: { region: "studio" },
    },
    {
        slug: "rivers-and-faults-sources",
        start: MAP.terrain,
        caption: "Source mode: the river sources as rings, the tutorial's own source in the desert (right), and the source it removed (left).",
        action: [{ do: "mode", action: "setFeatureMode", mode: "spring" }, { do: "frame", rect: SOURCES }],
        screenshot: { region: { map: SOURCES }, mapOnly: true },
    },
    {
        slug: "rivers-and-faults-features",
        start: MAP.sketch,
        caption: "The four tectonic features: a mountain range, a subduction zone, a rift and a hotspot chain, with the hotspot chain in the inspector.",
        action: [
            { do: "tool", tool: "features" },
            { do: "mode", action: "setFeatureMode", mode: "fault" },
            ...FEATURES.flatMap((feature) => draw(feature, SKETCH_FINISH)),
            { do: "camera", view: "fit" },
        ],
        screenshot: { region: "studio" },
    },
];
