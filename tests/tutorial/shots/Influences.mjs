// The Influences page: Security painted after a run, a stretch of the western hills lowered to
// bandit country and the land round a capital raised, over the run's Danger layer.
import { MAP } from "./_common.mjs";

/** The west of the continent, from Helmenkeria to Viknesmaria. */
const WEST = [100, 380, 950, 900];

/** Back and forth along a row of the map, a stamp every 25 pixels. */
const rows = (ys, from, to) =>
    ys.map((y, row) => {
        const xs = Array.from({ length: Math.floor((to - from) / 25) + 1 }, (_, i) => from + i * 25);
        return (row % 2 ? xs.toReversed() : xs).map((x) => [x, y]);
    });

/** Bandit country in the hills south-west of Helmenker, and a quiet heartland round Viknesmar. */
const BANDITS = rows([640, 670, 700, 730], 230, 400);
const HEARTLAND = rows([545, 575, 605], 640, 760);

export default [
    {
        slug: "influences-overview",
        start: MAP.generated,
        caption: "Security painted after a run: bandit country in the western hills, lowered in red, and a safer heartland round Viknesmar, raised in blue, over the run's Danger.",
        action: [
            { do: "tool", tool: "influences" },
            { do: "click", target: '[data-action="chooseInfluenceKind"][data-kind="security"]' },
            { do: "set", field: '[data-region="editToolbar"] input[name="influenceStrength"]', value: 1 },
            { do: "set", field: '[data-region="editToolbar"] input[name="brushSize"]', value: 50 },
            { do: "frame", rect: WEST },
            { do: "mode", action: "setInfluenceMode", mode: "lower" },
            ...BANDITS.map((path) => ({ do: "brush", path })),
            { do: "mode", action: "setInfluenceMode", mode: "raise" },
            ...HEARTLAND.map((path) => ({ do: "brush", path })),
            { do: "settle" },
        ],
        screenshot: { region: "studio" },
    },
];
