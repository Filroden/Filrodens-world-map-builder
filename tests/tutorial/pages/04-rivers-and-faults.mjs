// Tutorial page 4: rivers and faults. Adds a river source in the dry east of the continent (a
// river across the desert), removes one from the crowded north-west, draws a custom river across
// the southern forests and a rift across the south of the continent, then moves one of the
// rift's points and takes the move back with Undo.

/** A source on dry high ground in the east; its river runs west across the desert. */
const NEW_SOURCE = [1200, 600];

/** An automatic source in the north-west, where the rivers are thick; removing it stops its river. */
const REMOVED_SOURCE = [470, 387];

/** The custom river: from the southern hills east to the coast, downhill all the way. */
const CUSTOM_RIVER = [
    [900, 1340],
    [950, 1305],
    [1000, 1285],
    [1050, 1275],
    [1100, 1288],
    [1150, 1298],
    [1200, 1302],
    [1245, 1310],
];

/** The rift, west to east across the south of the continent, from sea to sea. */
const RIFT = [
    [690, 1530],
    [820, 1500],
    [950, 1490],
    [1080, 1475],
    [1240, 1450],
];

/** Where the rift's middle waypoint is dragged to, before Undo puts it back. */
const RIFT_MOVED = [950, 1540];

/** The south of the continent, for the rift's close-ups. */
const SOUTH = [620, 1340, 1300, 1600];

/** An empty spot above the map's top edge: right-clicking there finishes a line. */
const FINISH_AT = [1000, -100];

export default {
    number: 4,
    slug: "rivers-and-faults",
    title: "Rivers and faults",
    start: "03-climate-and-biomes",
    // The map at the end of this page, with the land finished, is the tests' P0JBVA
    fixture: "tests/mesh/fixtures/p0jbva.json",
    goal: "Add and remove river sources, draw a river of your own, and open a rift valley with a tectonic feature, reshaping it by its points and with Undo.",
    intro: `Rivers are worked out by themselves: they rise where the land is high and wet enough, and run downhill to the sea or into another river, pooling into lakes in hollows on the way. The **Rivers and faults** tool lets you move where they rise, draw rivers of your own, and draw tectonic features that reshape the land around a line.`,
    narration: "In this tutorial we're going to finish shaping the land: we'll add a river where there was none, remove another, draw a river of our own, and open a rift valley across the continent.",

    steps: [
        {
            id: "open",
            title: "Open Rivers and faults",
            instruction: "Click **Rivers and faults** on the rail, the last tool in the **Shape** group, then choose **Source** on the bar. Every river source the module placed is shown as a ring: a river rises at each one.",
            action: [
                { do: "tool", tool: "features", label: "Rivers and faults" },
                { do: "mode", action: "setFeatureMode", mode: "spring", label: "Source" },
            ],
            screenshot: { name: "sources", region: "studio" },
            caption: "Source mode: a ring marks every river source.",
            narration: "Open Rivers and faults, the last tool in the Shape group on the rail, and choose Source on the bar. A ring marks each place a river rises from the ground.",
            pause: 3,
        },
        {
            id: "add-source",
            title: "Add a river source",
            instruction: "The dry east of the continent has no rivers. Zoom in on it, and click the high ground in the middle of the desert, south-east of the inland sea's eastern bay: a river source is added there, and its river runs west across the desert to join the river flowing into the bay.",
            action: [
                { do: "zoom", at: [1150, 560], notches: 6, label: "Scroll over the desert to zoom in." },
                { do: "mapClick", at: NEW_SOURCE, label: "Click the desert's high ground to add a river source." },
            ],
            screenshot: { name: "desert-river", region: { map: [930, 380, 1370, 760] }, mapOnly: true },
            caption: "The new river crossing the desert.",
            note: "A river source you add makes a river whatever the land and climate are like there. Drag a source to move it.",
            narration: "The desert in the east has no rivers. Click its high ground to add a river source, and a river will automatically be drawn that follows the terrain and runs west across the desert.",
            pause: 4,
        },
        {
            id: "remove-source",
            title: "Remove a river source",
            instruction: "The north-west is crowded with rivers. Click **Reset view** and zoom in there, then Ctrl+Click (Cmd+Click on macOS) the middle ring of the three in a row south of the two snow-capped peaks. Its river is gone, and a black marker shows where it was removed; Ctrl+Click the marker to bring it back.",
            action: [
                { do: "camera", view: "fit" },
                { do: "zoom", at: REMOVED_SOURCE, notches: 10, label: "Scroll over the north-west to zoom in." },
                { do: "mapClick", at: REMOVED_SOURCE, modifiers: ["Control"], label: "Ctrl+Click a ring to remove its river source." },
            ],
            screenshot: { name: "removed", region: { map: [340, 290, 600, 480] }, mapOnly: true },
            caption: "A removed river source, marked in black.",
            narration: "In the crowded north-west, Ctrl-click a ring to remove a river source. Its river is now gone, and a marker remembers where it was.",
            pause: 3,
        },
        {
            id: "custom-river",
            title: "Draw a river",
            instruction: "The southern forests have no rivers. Choose **River** on the bar and set **River width** to **Medium**. Then click from the hills in the south of the continent eastwards to the coast, and right-click to finish. A custom river runs exactly along your line, from its higher end to its lower, and the ground is lowered into a gentle valley around it.",
            action: [
                { do: "mode", action: "setFeatureMode", mode: "river", label: "River" },
                { do: "set", field: '[data-region="editToolbar"] select[name="riverWidth"]', value: "Medium", label: "River width" },
                { do: "shape", points: CUSTOM_RIVER, finishAt: FINISH_AT, fitAfterFirst: true, label: `Click ${CUSTOM_RIVER.length} points from the southern hills to the east coast, then right-click.` },
                { do: "expect", check: (studio) => studio.manualRivers.length === 1 || `${studio.manualRivers.length} custom rivers` },
                { do: "settle" },
                { do: "zoom", at: [1070, 1300], notches: 10, label: "Zoom in to look at the river." },
            ],
            screenshot: { name: "custom-river", region: { map: [840, 1180, 1300, 1420] }, mapOnly: true },
            caption: "The custom river across the southern forests.",
            note: "The new river opens in the inspector as you place its first point; **Reset view** in the map controls shows the whole map beside it. If your line ends on land, the river carries on downhill from its end by itself.",
            narration: "The southern forests have no rivers either, so draw one. Choose River, set a medium width, and click from the hills east to the coast. Right-click to finish, and the river follows your line in a valley of its own.",
            pause: 4,
        },
        {
            id: "rift",
            title: "Open a rift",
            instruction: "Now a tectonic feature. Choose **Fault** on the bar, set **Tectonic fault type** to **Rift**, **Fault line thickness** to `90` and **Fault line strength** to `0.15`, for a shallow rift that floods only in places. Click across the south of the continent from the west coast to the east coast, starting and ending a little out to sea, and right-click to finish. A rift is land being pulled apart: a valley of tilted blocks with raised shoulders, its floor flooding where it drops below sea level. Drawing it on past both coasts lets it open into the sea, since a rift rises back to the ground level at its ends.",
            action: [
                { do: "mode", action: "setFeatureMode", mode: "fault", label: "Fault" },
                { do: "set", field: '[data-region="editToolbar"] select[name="faultType"]', value: "Rift", label: "Tectonic fault type" },
                { do: "set", field: '[data-region="editToolbar"] input[name="faultThickness"]', value: 90, label: "Fault line thickness" },
                { do: "set", field: '[data-region="editToolbar"] input[name="faultStrength"]', value: 0.15, label: "Fault line strength" },
                { do: "shape", points: RIFT, finishAt: FINISH_AT, fitAfterFirst: true, label: `Click ${RIFT.length} points across the south of the continent, coast to coast, then right-click.` },
                { do: "expect", check: (studio) => (studio.tectonicFaults.length === 1 && studio.tectonicFaults[0].points.length === 5) || `${studio.tectonicFaults.length} tectonic features` },
                { do: "settle" },
                { do: "zoom", at: [960, 1470], notches: 6, label: "Zoom in on the south of the continent." },
            ],
            screenshot: { name: "rift", region: { map: SOUTH }, mapOnly: true },
            caption: "The rift across the south of the continent, open to the sea at both ends.",
            note: "> **Tip:** draw a tectonic feature where the land or seabed suits it: a rift across a continent, a mountain range along high ground, a subduction zone along a coast facing the ocean, a hotspot chain across open sea. See [[Rivers and faults]] for each feature's settings, which open in the inspector.",
            narration: "Now let's add a tectonic feature. Choose Fault, set the type to Rift, the thickness to ninety and the strength to nought point one five, and draw a line across the south of the continent, from sea to sea. The land is pulled apart into a rift valley.",
            pause: 5,
        },
        {
            id: "move-waypoint",
            title: "Move a waypoint",
            instruction: "Every line you draw keeps its points, so you can reshape it afterwards. Drag the rift's middle point a little south: the rift is worked out again along its new line.",
            action: [
                { do: "drag", from: RIFT[2], to: RIFT_MOVED, label: "Drag the rift's middle point south." },
                { do: "expect", check: (studio, at) => (studio.tectonicFaults[0].points[2].x === at[0] && studio.tectonicFaults[0].points[2].y === at[1]) || `the middle point is at ${JSON.stringify(studio.tectonicFaults[0].points[2])}`, args: RIFT_MOVED, within: 10000 },
            ],
            screenshot: { name: "rift-moved", region: { map: SOUTH }, mapOnly: true },
            caption: "The rift with its middle point dragged south.",
            note: "While drawing, Shift+Click the line to add a point and Ctrl+Click a point to delete it.",
            narration: "Lines show their points, so you can reshape them. Drag the rift's middle point south, and the rift will follow.",
            pause: 3,
        },
        {
            id: "undo",
            title: "Undo",
            instruction: "Click **Undo** (top right of the map, or press Ctrl+Z). The point goes back where it was, and the rift with it. Every change you make is one step of undo, and **Redo** beside it puts the change back.",
            action: [
                { do: "click", target: '.fwmb-map-btn[data-action="undoBrush"]', label: "Undo" },
                { do: "expect", check: (studio, at) => (studio.tectonicFaults[0].points[2].x === at[0] && studio.tectonicFaults[0].points[2].y === at[1]) || `the middle point is at ${JSON.stringify(studio.tectonicFaults[0].points[2])}`, args: RIFT[2], within: 10000 },
            ],
            screenshot: { name: "rift-undone", region: { map: SOUTH }, mapOnly: true },
            caption: "After Undo: the rift is back on its first line.",
            narration: "Changed your mind? Click Undo, and the point and the rift go back. Every change is one step of undo, and Redo puts it back again. Both will show you the area of the map where the change will happen.",
            pause: 3,
        },
        {
            id: "done",
            title: "Stop and save",
            instruction: "Choose **Select** on the bar to stop drawing, close the inspector, click **Reset view**, and save the map. That completes the land: the next tools populate it.",
            action: [
                { do: "mode", action: "setFeatureMode", mode: "select", label: "Select" },
                { do: "click", target: "dialog.fwmb-inspector[open] .fwmb-overlay-close", label: "Close on the inspector" },
                { do: "camera", view: "fit" },
                { do: "click", target: '.fwmb-rail-btn[data-action="saveMap"]', label: "Save map" },
                { do: "expect", check: (studio) => !studio.isDirty || "the map was not saved", within: 30000 },
            ],
            narration: "Stop drawing and save. The land is finished; next, we're going to populate it.",
            pause: 4,
        },
    ],

    whatYouSee: "A new river across the desert in the east, one river fewer in the north-west, a river of your own across the southern forests to the east coast, and a rift valley across the south of the continent, open to the sea at both ends.",
    foundry: "Everything on this page is the same in Foundry.",
    onYourOwn: `Check the rivers once the terrain and climate are settled: a terrain edit can change their course. The **Hydrology** section sets how high and how wet the land must be for a river to rise, and how wide and winding rivers are. Tectonic features take on the character of the ground they cross, so look at it first: a **Mountain range** along hills, a **Subduction zone** along a coast facing the ocean, a **Rift** across a continent, a **Hotspot chain** across open sea. On a large map, **Pause regeneration** on the bar lets you place several points before the terrain is worked out again.`,
    related: ["Rivers and faults", "Terrain", "FAQ"],
};
