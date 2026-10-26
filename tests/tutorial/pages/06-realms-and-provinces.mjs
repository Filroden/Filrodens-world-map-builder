// Tutorial page 6: realms and provinces. Edits the generated Political set by hand (merges the
// eastern island's two realms into one, renames and recolours it) and paints a region of the
// reader's own, the Red Hills, in a set of its own over the eastern desert.

/** Strokes back and forth across the eastern desert, one stamp per point, shorter at the top and foot. */
const HILLS_STROKES = [
    [420, 1090, 1270],
    [490, 1060, 1300],
    [560, 1060, 1300],
    [630, 1090, 1240],
].map(([y, from, to], row) => {
    const xs = Array.from({ length: Math.floor((to - from) / 30) + 1 }, (_, i) => from + i * 30);
    return (row % 2 ? xs.toReversed() : xs).map((x) => [x, y]);
});

/** A row of a list, by the name it shows. */
const row = (kind, name) => `.fwmb-${kind}-row:has(:text-is("${name}"))`;

export default {
    number: 6,
    slug: "realms-and-provinces",
    title: "Realms and provinces",
    start: "05-populating-the-world",
    goal: "Make the generated realms your own, merging, renaming and recolouring them, and paint a region of your own in a set of its own.",
    intro: `The **Regions** tool shows the map's areas: kingdoms and their duchies, but also climate bands, trade zones or a campaign's explored land. Regions are painted onto the map's cells, so neighbouring regions always share their border exactly. They are organised in **layer sets** (one way of dividing the map), each holding **layers** (Realms, then Duchies below them, then Counties), each holding its **regions**.

The run on page 5 made a set called **Political**. Anything you change in it is kept when you generate again.`,
    narration: "In this video we make the generated realms our own, and paint a region of our own.",

    steps: [
        {
            id: "open",
            title: "Open Regions",
            instruction: "Click **Regions** on the rail. The **Sets** list holds two sets: **Regions**, the empty set every new map starts with, and **Political**, the run's. Click **Political**: its **Realms** list shows the seventeen realms, and choosing a realm shows its duchies in the list below, and a duchy its counties.",
            action: [
                { do: "tool", tool: "regions", label: "Regions" },
                { do: "click", target: row("set", "Political"), label: "Political" },
            ],
            screenshot: { name: "political", region: "studio" },
            caption: "The Political set: Realms, then Duchies and Counties below.",
            narration: "Open the Regions tool. The run made a layer set called Political, with realms, duchies and counties. Choose it.",
            pause: 3,
        },
        {
            id: "focus",
            title: "Find the island realms",
            instruction: "The large island east of the continent is split between two realms, **Newcestedia** in the north and **Chisted** in the south. Click **Newcestedia** in the Realms list, then its **Focus view** button: the map zooms to it, and it opens in the inspector.",
            action: [
                { do: "click", target: row("region", "Newcestedia"), label: "Newcestedia" },
                { do: "point", target: row("region", "Newcestedia"), label: "Newcestedia's row" },
                { do: "click", target: `${row("region", "Newcestedia")} [data-action="zoomToFeature"]`, label: "Focus view" },
            ],
            screenshot: { name: "island", region: "studio" },
            caption: "Newcestedia, chosen and open in the inspector.",
            narration: "The big island in the east is split between two realms. Choose Newcestedia, and Focus view zooms the map to it.",
            pause: 3,
        },
        {
            id: "merge",
            title: "Merge the realms",
            instruction: "Unite the island: open the **⋮** menu on **Chisted**'s row and choose **Merge into**. In the dialogue, choose **Newcestedia**.",
            action: [
                { do: "point", target: row("region", "Chisted"), label: "Chisted's row" },
                { do: "click", target: `${row("region", "Chisted")} .fwmb-row-menu > button`, label: "⋮ on Chisted" },
                { do: "click", target: `${row("region", "Chisted")} [data-action="mergeRegion"]`, label: "Merge into" },
                { do: "waitForDialog" },
                { do: "set", field: 'dialog[open] select[name="mergeInto"]', value: "Newcestedia", label: "Merge into" },
            ],
            settle: false,
            screenshot: { name: "merge", region: "dialog", pad: 8 },
            caption: "Merging Chisted into Newcestedia.",
            narration: "Unite the island: merge Chisted into Newcestedia.",
        },
        {
            id: "merged",
            title: "Confirm",
            instruction: "Click **Confirm**. Chisted's land goes to Newcestedia, and its duchies and counties now belong to Newcestedia, keeping their own land.",
            action: [
                { do: "dialog", button: "ok", label: "Confirm" },
                { do: "expect", check: (studio) => !studio.layerSets.find((set) => set.name === "Political").levels[0].regions.some((region) => region.name === "Chisted") || "Chisted is still a realm", within: 30000 },
            ],
            narration: "Confirm, and the island is one realm, its duchies and counties unchanged.",
        },
        {
            id: "rename",
            title: "Rename and recolour",
            instruction: "In the inspector, change **Name** to `Islemark` and press Enter, then set the **Fill** **Colour** to `#3f8f7a`, a sea green. A region you rename, repaint or restyle counts as edited: generating again keeps it, with its whole realm. (To keep a region you have not changed, click the lock on its row.)",
            action: [
                { do: "set", field: 'dialog.fwmb-inspector[open] input[name="regionName"]', value: "Islemark", commit: "Enter", label: "Name" },
                { do: "set", field: 'dialog.fwmb-inspector[open] input[name="regionFillColor"]', value: "#3f8f7a", label: "Colour" },
                { do: "expect", check: (studio) => studio.layerSets.find((set) => set.name === "Political").levels[0].regions.some((region) => region.name === "Islemark") || "no realm named Islemark", within: 30000 },
            ],
            screenshot: { name: "islemark", region: "studio" },
            caption: "Islemark, the island's one realm, in its new colour.",
            narration: "Rename the realm Islemark and give it a sea-green fill. A region you change is kept when you generate again.",
            pause: 4,
        },
        {
            id: "own-set",
            title: "A set of your own",
            instruction: "Regions are not only for realms. Click **Reset view**, then click the **Regions** set in the Sets list and open its **⋮** menu: choose **Rename**, type `Lands` and press Enter. Its layer, **Layer 1**, is ready to paint. Click **Edit layer** on the layer's heading and set **Territorial waters** to `0`, so its regions own land only.",
            action: [
                { do: "camera", view: "fit" },
                { do: "click", target: row("set", "Regions"), label: "Regions" },
                { do: "point", target: row("set", "Regions"), label: "the Regions row" },
                { do: "click", target: `${row("set", "Regions")} .fwmb-row-menu > button`, label: "⋮ on Regions" },
                { do: "click", target: `${row("set", "Regions")} [data-action="renameListEntry"]`, label: "Rename" },
                { do: "set", field: "[data-list-naming]", value: "Lands", commit: "Enter", label: "the set's name" },
                { do: "click", target: '[data-action="editLevel"]', label: "Edit layer" },
                { do: "set", field: 'dialog.fwmb-inspector[open] input[name="levelWatersPx"]', value: 0, label: "Territorial waters" },
                { do: "expect", check: (studio) => studio.layerSets.some((set) => set.name === "Lands") || "no set named Lands", within: 30000 },
            ],
            screenshot: { name: "lands", region: "studio" },
            caption: "The Lands set, with its layer open in the inspector.",
            narration: "Regions aren't only for realms. Rename the empty Regions set to Lands, and set its layer's territorial waters to nothing, so its regions own land alone.",
            pause: 3,
        },
        {
            id: "red-hills",
            title: "Paint the Red Hills",
            instruction: "Click **+ Region in Lands** at the foot of Layer 1's list, type `The Red Hills` and press Enter: the new region is the one being painted. Choose **Paint** on the bar, set **Size** to `60` px, and paint over the desert in the east of the continent; zoom in to see it closely. While you paint, only the layer you are painting is drawn, so the realms do not get in the way.",
            action: [
                { do: "click", target: '[data-region="context"] .fwmb-list-add [data-action="addRegion"], [data-region="context"] .fwmb-list-add button:has-text("Region in")', label: "+ Region in Lands" },
                { do: "set", field: "[data-list-naming]", value: "The Red Hills", commit: "Enter", label: "the region's name" },
                { do: "mode", action: "setRegionMode", mode: "paint", label: "Paint" },
                { do: "set", field: '[data-region="editToolbar"] input[name="brushSize"]', value: 60, label: "Size" },
                ...HILLS_STROKES.map((path) => ({ do: "brush", path, label: "Paint across the desert." })),
                { do: "settle" },
                { do: "frame", rect: [960, 330, 1400, 720], label: "Zoom in on the Red Hills." },
            ],
            screenshot: { name: "red-hills", region: { map: [960, 330, 1400, 720] }, mapOnly: true },
            caption: "The Red Hills painted over the eastern desert.",
            note: "**Fill** on the bar gives a whole connected area to the region in one click, and **Erase** takes cells away. On a layer below another, a region paints only inside its parent region.",
            narration: "Add a region called The Red Hills, choose Paint, and paint over the eastern desert. While you paint, only this layer is drawn.",
            pause: 4,
        },
        {
            id: "save",
            title: "Stop and save",
            instruction: "Choose **Select** on the bar to stop painting, close the inspector, and save the map.",
            action: [
                { do: "mode", action: "setRegionMode", mode: "select", label: "Select" },
                { do: "click", target: "dialog.fwmb-inspector[open] .fwmb-overlay-close", label: "Close on the inspector" },
                { do: "click", target: '.fwmb-rail-btn[data-action="saveMap"]', label: "Save map" },
                { do: "expect", check: (studio) => !studio.isDirty || "the map was not saved", within: 30000 },
            ],
            narration: "Stop painting and save. Next, the roads.",
        },
    ],

    whatYouSee: "The large eastern island is one realm, Islemark, in sea green, with its duchies and counties as they were. A Lands set holds one region, the Red Hills, over the eastern desert.",
    foundry: "Everything on this page is the same in Foundry. When the map is exported to a scene, each region the map names gets a page in the scene's journal (see [[Export]]).",
    onYourOwn: `Use the generated realms as a starting point: merge, rename and repaint them until the map tells your story, and lock the ones you like before you generate again. A set of your own can divide the map any way you need: climate bands, trade zones, a campaign's explored land. **+ Layer below** adds a layer under the last one, so you can lay out provinces inside your regions. See [[Regions]] for the layer and set settings, borders, nesting and mass edit.`,
    related: ["Regions", "Generate", "Styles and icons"],
};
