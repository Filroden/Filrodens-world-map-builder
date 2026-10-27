// Tutorial page 3: climate and biomes. Reads the climate at a point, adds a custom biome
// (Moorland) with a rule that places it on cool, dry uplands, and paints it on the ridge raised on
// page 2. The climate settings stay at their defaults, which are P0JBVA's.

/** Three short strokes along the crest of the ridge raised on page 2, painted with moorland. */
const DABS = [
    [
        [1546, 1044],
        [1550, 1056],
        [1554, 1066],
    ],
    [
        [1560, 1088],
        [1563, 1098],
        [1565, 1108],
    ],
    [
        [1566, 1128],
        [1566, 1138],
        [1565, 1148],
    ],
];

/** The island and its sea, for the close-up. */
const ISLAND = [1400, 920, 1720, 1280];

/** A point in the dry north-east of the continent, read in the information bar. */
const UPLAND_POINT = [1000, 420];

/** The rule editor's handle for one edge of an axis of the first custom rule. */
function handle(axis, edge) {
    return `#fwmb-rule-custom-rows .fwmb-rule-axis:has(.fwmb-rule-axis-label:text-is("${axis}")) .fwmb-rule-handle >> nth=${edge}`;
}

export default {
    number: 3,
    slug: "climate-and-biomes",
    title: "Climate and biomes",
    start: "02-shaping-the-land",
    goal: "See how the biomes are worked out from the climate, add a biome of your own with a rule for where it grows, and paint it by hand.",
    intro: `The module works out a biome for every point of the map from four things: its height, how wet it is, how warm it is, and the latitude. Moisture follows the prevailing winds, so mountains cast rain shadows; temperature falls with latitude and with height. The **Biomes** tool sets the climate these come from, and lets you add biomes of your own.`,
    narration: "In this video we look at how biomes are worked out, add a biome of our own, give it a rule so it appears by itself, and paint it by hand.",

    steps: [
        {
            id: "open-biomes",
            title: "Open Biomes",
            instruction: "Click **Biomes** on the rail, the third tool in the **Shape** group. **Climate** and **Moisture** hold the settings the biomes are worked out from: the whole world's temperature and moisture, the season, how fast it cools with height and when water freezes. The tutorial map keeps them as they are.",
            action: { do: "tool", tool: "biomes", label: "Biomes" },
            screenshot: { name: "biomes", region: "studio" },
            caption: "The Biomes tool, with the Climate and Moisture sections.",
            narration: "Open the Biomes tool, the third on the rail. Climate and Moisture set the world's temperature and rainfall. We keep them as they are.",
            pause: 3,
        },
        {
            id: "read",
            title: "Read the climate",
            instruction: "Point at the land in the north-east of the continent. The information bar at the top left of the map shows the point's **Elev**ation, **Moist**ure and **Temp**erature, each as a percentage, and the **Biome** they give: here, high, very dry, warm ground, so desert. Move around to see how they change: the land is cooler further north and higher up, and drier in the lee of hills.",
            action: { do: "hover", at: UPLAND_POINT, label: "Point at the north-east of the continent." },
            screenshot: { name: "read", region: { selector: ".fwmb-canvas-readout" }, pointer: UPLAND_POINT, pad: 6 },
            caption: "The information bar reads the point under the pointer.",
            narration: "Point at the map, and the information bar reads that point: its elevation, moisture, temperature and biome.",
        },
        {
            id: "add-biome",
            title: "Add a custom biome",
            instruction: "Open the **Edit biomes** section and click **Add custom biome** (the + beside **Custom biomes**). In the dialogue, name it `Moorland`, set its **Colour** to `#8c7a8a` (a heather mauve) and leave **Placement** at **Land only** and **Behaves like** at **The biome beneath**.",
            action: [
                { do: "openSection", section: "biomeColours", label: "Edit biomes" },
                { do: "click", target: '[data-action="addCustomBiome"]', label: "Add custom biome" },
                { do: "waitForDialog" },
                { do: "set", field: 'dialog[open] input[name="biomeName"]', value: "Moorland", label: "Name" },
                { do: "set", field: 'dialog[open] input[name="biomeColor"]', value: "#8c7a8a", label: "Colour" },
            ],
            settle: false,
            screenshot: { name: "custom-biome", region: "dialog", pad: 8 },
            caption: "The custom biome dialogue for Moorland.",
            note: "**Behaves like** tells [[Generate]] how to treat the biome's land, for farming, travel and cover. **The biome beneath** treats moorland as whatever the climate would give there.",
            narration: "Open Edit biomes and add a custom biome. Call it Moorland and give it a heather colour.",
        },
        {
            id: "confirm-biome",
            title: "Confirm",
            instruction: "Click **Confirm**. Moorland is listed under **Custom biomes**. It has no rules yet, so it only appears where you paint it.",
            action: [
                { do: "dialog", button: "ok", label: "Confirm" },
                { do: "expect", check: (studio) => (studio.uiState.customBiomes ?? []).some((biome) => biome.name === "Moorland") || "no Moorland biome" },
            ],
            narration: "Confirm. Moorland has no rules yet, so it only appears where we paint it.",
        },
        {
            id: "rule",
            title: "Give it a rule",
            instruction: `Click **Biome rule editor**, then **+ Add rule** on Moorland's row. A rule has three tracks, **Elevation**, **Moisture** and **Temperature**, from 0 to 1 (the information bar's 58% is 0.58 here), and the biome appears wherever a point falls inside all three ranges. Click **Upland** under the **Elevation** track, then drag the right-hand handle of **Moisture** to 0.45 and the right-hand handle of **Temperature** to 0.50: moorland grows on cool, fairly dry uplands.`,
            action: [
                { do: "click", target: '[data-action="openBiomeRuleEditor"]', label: "Biome rule editor" },
                { do: "waitForDialog" },
                { do: "click", target: { role: "button", name: "+ Add rule" }, label: "+ Add rule" },
                { do: "click", target: "#fwmb-rule-custom-rows .fwmb-rule-zone-chip >> text=Upland", label: "Upland" },
                { do: "slide", handle: handle("Moisture", 1), to: 0.45, label: "Drag Moisture's right-hand handle to 0.45." },
                { do: "slide", handle: handle("Temperature", 1), to: 0.5, label: "Drag Temperature's right-hand handle to 0.50." },
                {
                    do: "expect",
                    check: () => {
                        const chips = [...document.querySelectorAll("#fwmb-rule-custom-rows .fwmb-rule-chip")].map((chip) => chip.textContent.trim());
                        return chips.join(" | ") === "0.51–0.68 | 0.00–0.45 | 0.00–0.50" || `the rule's ranges are ${chips.join(" | ")}`;
                    },
                },
            ],
            settle: false,
            screenshot: { name: "rule", region: "dialog", pad: 8 },
            caption: "Moorland's rule: uplands, moisture up to 0.45, temperature up to 0.50.",
            note: "Rules run from the top: the first whose ranges all match a point wins, and the built-in biomes, listed below yours, catch every point no rule matches.",
            narration: "Open the rule editor and add a rule for Moorland. Choose the Upland band for elevation, then drag moisture and temperature down to cool, fairly dry ground.",
            pause: 4,
        },
        {
            id: "accept",
            title: "Accept",
            instruction: "Click **Accept**. The biomes are worked out again, and moorland appears on the cool, dry uplands in the north of the continent.",
            action: { do: "dialog", button: "Accept" },
            screenshot: { name: "moorland", region: { map: [400, 0, 1500, 800] }, mapOnly: true },
            caption: "Moorland on the northern uplands.",
            narration: "Accept, and moorland appears across the cool northern uplands.",
            pause: 4,
        },
        {
            id: "paint",
            title: "Paint moorland",
            instruction: "Now paint it where the rule does not reach. Click **Start painting**, choose **Moorland** in **Select biome** on the bar, and set **Size** to `10` px. Zoom in on the island to the east and paint a few short strokes along the top of the ridge you raised on page 2.",
            action: [
                { do: "click", target: { role: "button", name: "Start painting" }, label: "Start painting" },
                { do: "set", field: 'select[name="brushBiome"]', value: "Moorland", label: "Select biome" },
                { do: "set", field: 'input[name="brushSize"]', value: 10, label: "Size" },
                { do: "zoom", at: [1560, 1100], notches: 10, label: "Scroll over the island to zoom in on it." },
                ...DABS.map((path) => ({ do: "brush", path, label: "Paint a short stroke along the ridge's crest." })),
            ],
            screenshot: { name: "painted", region: { map: ISLAND }, mapOnly: true },
            caption: "Moorland painted on the crest of the island's ridge.",
            note: "The biome brush paints its whole circle at once and only where a biome's placement allows: a land biome only on land. **Erase** on the bar takes a painted biome away again.",
            narration: "Then paint it by hand. Start painting, choose Moorland, and paint a few short strokes along the top of the ridge on the eastern island.",
            camera: { zoom: 3, centre: [1560, 1100] },
            pause: 4,
        },
        {
            id: "stop",
            title: "Stop painting",
            instruction: "Click **Stop painting**, then **Save map** on the rail.",
            action: [
                { do: "click", target: { role: "button", name: "Stop painting" }, label: "Stop painting" },
                { do: "click", target: '.fwmb-rail-btn[data-action="saveMap"]', label: "Save map" },
                { do: "expect", check: (studio) => !studio.isDirty || "the map was not saved", within: 30000 },
            ],
            narration: "Stop painting and save. Next, the rivers.",
        },
    ],

    whatYouSee: "Mauve moorland on the cool, dry uplands in the north of the continent, and along the ridge of the island to the east. The rest of the map's biomes are as they were.",
    foundry: "Everything on this page is the same in Foundry.",
    onYourOwn: `Settle the climate before you add your own biomes: **Global temperature** and **Global moisture** move every biome at once, and a custom biome's rule is matched against them. Use **Preview rule coverage** (the eye beside **Biome rule editor**) to see where your map still falls back on the built-in biomes. A custom biome's **Code** is carried into the exported grid data (see [[Grid Cell Data]]), and [[Styles and icons]] shares custom biomes between maps. See [[Biomes]] for the rule editor in full.`,
    related: ["Biomes", "Terrain", "Styles and icons"],
};
