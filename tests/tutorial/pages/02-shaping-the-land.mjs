// Tutorial page 2: shaping the land. Sets the Guided engine's terrain settings to P0JBVA's (a new
// map starts from the defaults, so six of them differ), which makes the terrain the P0JBVA test
// fixture's exactly, then raises a ridge on the largest eastern island with Raise, and wears the mountains of the northernmost one down into hills with Smooth and Roughen.

/** The stroke along the island's spine: one stamp per point. */
const RIDGE = [
    [1540, 1030],
    [1548, 1050],
    [1556, 1070],
    [1562, 1090],
    [1566, 1110],
    [1568, 1130],
    [1566, 1150],
    [1560, 1170],
];

/** The island and its sea, for the close-ups. */
const ISLAND = [1400, 920, 1720, 1280];

/** Along the mountains of the northernmost eastern island, west to east: one stamp per point. */
const NORTH_RANGE = Array.from({ length: 13 }, (_, i) => [1750 + i * 20, Math.round(622 + i * 2.4)]);

/** The northernmost eastern island, for its close-ups. */
const NORTH_ISLAND = [1660, 470, 2000, 790];

/** Sets a Generation slider. */
function slider(name, value, label) {
    return { do: "set", field: `input[name="${name}"]`, value, label };
}

export default {
    number: 2,
    slug: "shaping-the-land",
    title: "Shaping the land",
    start: "01-new-world",
    goal: "Use the Terrain tool to set how the engine shapes the coast, the land and the sea, then sculpt the ground by hand with the terrain brushes.",
    intro: `On a Guided map your land masks decide where the land is; the **Terrain** tool decides what it looks like. Its **Generation** settings shape the coast and the rise of the land and sea floor across the whole map, and its brushes let you sculpt the ground in one place.

Each **Generation** setting rebuilds the whole map, which takes a few seconds at this size: wait for the map to update before changing the next one.`,
    narration: "In this tutorial we're going to use the Terrain tool to give our Tutorial world its final shape: a gentler coastline, broad lowlands and wide shallow seas. And then we'll sculpt a ridge by hand.",

    steps: [
        {
            id: "open-terrain",
            title: "Open Terrain",
            instruction: "Click **Terrain** on the rail, the second tool in the **Shape** group. (If you have carried on from page 1, **Terrain ▸** under **Next** at the foot of the panel does the same: every panel ends with the tool that usually comes next.) The **Generation** section holds the Guided engine's settings: **Coastal fracture**, then the **Land**, **Sea** and **Land & sea** groups.",
            action: { do: "tool", tool: "terrain", label: "Terrain" },
            screenshot: { name: "terrain", region: "studio" },
            caption: "The Terrain tool on the tutorial map, with the Guided engine's Generation settings.",
            narration: "Open the Terrain tool, the second on the rail. Its Generation section shapes the coast, the land and the sea.",
            pause: 3,
        },
        {
            id: "coast",
            title: "A smoother coast",
            instruction: "Set **Coastal fracture** to `0.1`. It bends the edges of the land: higher values break the coast into bays, inlets and small islands; lower values keep it rounder. It is the only setting here that moves the coastline itself.",
            action: slider("coastlineFracture", 0.1, "Coastal fracture"),
            narration: "Lower Coastal fracture to nought point one, for a smoother coast with fewer small islands.",
        },
        {
            id: "land",
            title: "Broad lowlands",
            instruction: "In **Land**, set **Coastal plains** to `0.2` and **Continent scale** to `400`. Coastal plains is a band of low, gently rolling land along the coast; continent scale is how far inland the land takes to reach its full height beyond it. Together they give this world wide lowlands and mountains well inland.",
            action: [slider("coastalPlain", 0.2, "Coastal plains"), slider("continentScale", 400, "Continent scale")],
            screenshot: { name: "land", region: "studio" },
            caption: "Wider coastal plains and a larger continent scale: the land rises slowly from broad lowlands.",
            narration: "In the Land group, widen the coastal plains to zero point two and raise the continent scale to four hundred. The land now rises slowly from broad lowlands.",
            pause: 3,
        },
        {
            id: "sea",
            title: "Shallow seas",
            instruction: "In **Sea**, set **Continental shelf** to `0.2` and **Ocean scale** to `200`. The continental shelf is a band of shallow sea along the coast; ocean scale is how far out the seabed then takes to fall to the deep ocean floor. Leave **Mid-ocean ridges** at 0.5.",
            action: [slider("shelfRange", 0.2, "Continental shelf"), slider("oceanScale", 200, "Ocean scale")],
            narration: "In the Sea group, widen the continental shelf to zero point two and set the ocean scale to two hundred, for broad shallow seas along the coasts.",
        },
        {
            id: "detail",
            title: "More detail",
            instruction: "In **Land & sea**, set **Detail** to `8`. Detail adds fine texture: low values give rolling hills, high values jagged, rocky ground. Leave **Erosion** at 500.",
            action: [
                slider("noise.elevation.octaves", 8, "Detail"),
                { do: "settle" },
                {
                    do: "expect",
                    check: (studio) => {
                        const state = studio.uiState;
                        const values = [state.coastlineFracture, state.coastalPlain, state.continentScale, state.shelfRange, state.oceanScale, state["noise.elevation.octaves"]].map(Number);
                        return JSON.stringify(values) === JSON.stringify([0.1, 0.2, 400, 0.2, 200, 8]) || `the terrain settings are ${values.join(", ")}`;
                    },
                },
            ],
            screenshot: { name: "detail", region: "studio" },
            caption: "The tutorial map with all its terrain settings.",
            note: "> **Tip:** a higher **Detail** takes longer to generate. On your own maps, keep it at the default while you try things out and raise it before you export.",
            narration: "Finally, raise Detail to eight, for finer, rockier ground. That is the Tutorial world's terrain. Next we'll make some fine adjustments by hand.",
            pause: 4,
        },
        {
            id: "terraform",
            title: "Start terraforming",
            instruction: "Now sculpt the ground by hand. Click **Start terraforming** in the panel: the bar's brushes come into use, with **Raise** chosen, and the **Generation** section pauses until you stop. On the bar, set **Size** to `40` px, **Strength** to `0.01` and **Feather** to `0.8`: a wide, gentle, soft-edged brush, for a rise that blends into the land around it.",
            action: [
                { do: "click", target: { role: "button", name: "Start terraforming" }, label: "Start terraforming" },
                { do: "mode", action: "setBrushTool", attr: "tool", mode: "raise", label: "Raise" },
                { do: "set", field: 'input[name="brushSize"]', value: 40, label: "Size" },
                { do: "set", field: 'input[name="brushStrength"]', value: 0.01, label: "Strength" },
                { do: "set", field: 'input[name="brushFeather"]', value: 0.8, label: "Feather" },
                { do: "expect", check: (studio) => studio.uiState.isEditMode || "terraforming did not start" },
            ],
            screenshot: { name: "brushes", region: { union: ["bar", "panel"] } },
            caption: "Terraforming: the brushes and their settings on the bar, and the paused Generation section.",
            narration: "Click Start terraforming. Terrain brushes come into use on the bar, with Raise chosen. Make the brush wide, gentle and soft: size forty, strength nought point zero one, feather nought point eight.",
            pause: 3,
        },
        {
            id: "ridge",
            title: "Raise a ridge",
            instruction: "Zoom in on the large island to the east of the continent (scroll over it). Then drag once along the length of the island, from its north end to its south, to raise a low ridge along its spine. Each stroke is one step of undo, so if you don't like it, click **Undo** and try again.",
            action: [
                { do: "zoom", at: [1560, 1100], notches: 10, label: "Scroll over the island to zoom in on it." },
                { do: "brush", path: RIDGE, label: "Drag along the island's spine with Raise." },
            ],
            screenshot: { name: "ridge", region: { map: ISLAND }, mapOnly: true },
            caption: "The island with its new ridge.",
            note: "Brush strokes are kept as strokes, laid over the generated terrain, so you can still change the **Generation** settings afterwards and the ridge stays.",
            narration: "Zoom in on the island to the east, and drag along its spine. One gentle stroke raises a low ridge that blends into the hills. Brush strokes are kept separately from the generated terrain, so you can undo them if you make a mistake.",
            camera: { zoom: 3, centre: [1560, 1100] },
            pause: 4,
        },
        {
            id: "smooth",
            title: "Wear down the mountains",
            instruction: "The northernmost of the three eastern islands has a sharp range of mountains along it. To wear them down into hills, click **Reset view**, zoom in on that island, open **More** on the bar and choose **Smooth**. Set **Size** to `40` px and **Strength** to `0.05`, then drag along the mountains from west to east, back again, and along once more. Smooth pulls the ground towards the average of the ground around it: the peaks come down, but the ground is left smooth.",
            action: [
                { do: "camera", view: "fit" },
                { do: "zoom", at: [1850, 630], notches: 5, label: "Scroll over the northern island to zoom in on it." },
                { do: "mode", action: "setBrushTool", attr: "tool", mode: "smooth", label: "Smooth (in More)" },
                { do: "set", field: 'input[name="brushSize"]', value: 40, label: "Size" },
                { do: "set", field: 'input[name="brushStrength"]', value: 0.05, label: "Strength" },
                { do: "brush", path: NORTH_RANGE, label: "Drag along the mountains from west to east." },
                { do: "brush", path: NORTH_RANGE.toReversed(), label: "Drag back along them." },
                { do: "brush", path: NORTH_RANGE, label: "Drag along them once more." },
            ],
            screenshot: { name: "smoothed", region: { map: NORTH_ISLAND }, mapOnly: true },
            caption: "The island's mountains after Smooth: lower, but too smooth.",
            note: "Smooth never moves the coastline, so you can smooth right up to and across a coast.",
            narration: "The northern island has a sharp range of mountains. Choose Smooth from the bar. It could be inside the More button if your screen is not wide enough. Once you have it selected, drag along the range a few times. You'll see the peaks reduce in height, but the ground is left far too smooth.",
            camera: { zoom: 2, centre: [1850, 630] },
            pause: 4,
        },
        {
            id: "roughen",
            title: "Bring back the texture",
            instruction: "Choose **Roughen** (also in **More**) and drag along the island once, west to east. Roughen gives the ground the same fine, natural texture as the land around it without raising it, so the worn-down range becomes rolling hills. It only adds the texture once, however often you go over the same ground.",
            action: [
                { do: "mode", action: "setBrushTool", attr: "tool", mode: "roughen", label: "Roughen (in More)" },
                { do: "brush", path: NORTH_RANGE, label: "Drag along the island with Roughen." },
            ],
            screenshot: { name: "roughened", region: { map: NORTH_ISLAND }, mapOnly: true },
            caption: "After Roughen: the range has become textured hills.",
            note: "**Strength** and **Feather** are hidden while Roughen is chosen, since it always lays the same texture.",
            narration: "To bring back some of the detail choose Roughen and drag along the island once. The texture comes back without the height, and the range becomes rolling hills. Unlike Smooth which gets stronger the more times you use it, you only need to use Roughen once over an area.",
            camera: { zoom: 2, centre: [1850, 630] },
            pause: 4,
        },
        {
            id: "stop",
            title: "Stop terraforming",
            instruction: "Click **Stop terraforming** in the panel. The **Generation** section is available again.",
            action: [
                { do: "click", target: { role: "button", name: "Stop terraforming" }, label: "Stop terraforming" },
                { do: "expect", check: (studio) => studio.brushEngine.history.length === 5 || `${studio.brushEngine.history.length} strokes on the map` },
            ],
            narration: "Now stop terraforming.",
        },
        {
            id: "save",
            title: "Save",
            instruction: "Click **Save map** on the rail. The map already has a name, so it is saved straight away.",
            action: [
                { do: "click", target: '.fwmb-rail-btn[data-action="saveMap"]', label: "Save map" },
                { do: "expect", check: (studio) => !studio.isDirty || "the map was not saved", within: 30000 },
            ],
            narration: "And save the map. Next, we're going to look at the climate and the biomes.",
        },
    ],

    whatYouSee: "The continent's coast is smoother, with broad lowlands along it and the highest ground well inland; wide, shallow seas run along every coast before the sea floor falls away. The large island to the east has a low ridge down its length, and the northernmost island has rolling hills where its sharp mountains were.",
    foundry: "Everything on this page is the same in Foundry.",
    onYourOwn: `Try each **Generation** setting on your own map before you sculpt: they apply to the whole map at once, and brush strokes stay where they are when you change them. The brushes on the bar (and in **More**) each have their own job: **Lower** digs, **Smooth** flattens fine detail without moving the coast, **Roughen** adds a natural texture, **Level** flattens to one height, and **Slope up** and **Slope down** build ramps. See [[Terrain]] for every setting and brush. On a **Standard** map you also have **Sea level** and the **Noise window**, to explore the endless terrain for a landmass you like.`,
    related: ["Terrain", "New map", "Map Canvas"],
};
