// Tutorial page 1: a new world. Creates the tutorial map, P0JBVA, from its seed, size and
// latitudes, and draws its land masks, the same points as the P0JBVA test fixture, so a reader
// who imports this page's checkpoint has exactly the map the rest of the tutorial uses.
import { readFileSync } from "node:fs";

const P0JBVA = JSON.parse(readFileSync(new URL("../../mesh/fixtures/p0jbva.json", import.meta.url), "utf8"));
const masks = P0JBVA.landMasks.map((mask) => ({ name: mask.name, land: mask.operation === "add", points: mask.points.map(({ x, y }) => [x, y]) }));
const [continent, ...rest] = masks;
const islands = rest.filter((mask) => mask.land);
const inlandSea = rest.find((mask) => !mask.land);

/** An empty spot above the map's top edge, inside its margin: right-clicking there finishes a shape. */
const FINISH_AT = [1000, -100];

/** Draws one land mask: the bar's mode, its points, a right-click to finish. */
function drawMask(mask, { fitAfterFirst = true } = {}) {
    return [
        { do: "mode", action: "setSceneMode", mode: mask.land ? "addMask" : "subtractMask", label: mask.land ? "Land" : "Ocean" },
        { do: "shape", points: mask.points, finishAt: FINISH_AT, fitAfterFirst, label: `Click round the outline of ${mask.name} (${mask.points.length} points), then right-click to finish it.` },
    ];
}

export default {
    number: 1,
    slug: "new-world",
    title: "A new world",
    goal: "Create the map the whole tutorial builds on: a Guided map with the seed P0JBVA, 2,000 by 1,600 pixels, from 60° north to 60° south, with one large continent, three islands and an inland sea.",
    startText: "Nothing: this page makes the map. If the studio already has a map open that you want to keep, save it first.",
    intro: `Over these ten pages you build one complete map, using nearly every tool in the studio. Each page ends with the map saved, and the next page starts from it, so you can follow the whole tutorial on one map. If you skip a page, or your map has drifted from the pictures, each page links the map as it should be at its start.

The tutorial's map uses the **Guided** engine: you draw where the land goes and the engine makes the terrain inside your shapes. Your shapes will not match the pictures exactly, and that is fine. To have exactly the tutorial's map, import the file in **Start from** at the top of the next page.`,
    narration: "In this first video we create the map the whole tutorial builds on: a Guided map, where we draw where the land goes and the engine does the rest.",

    steps: [
        {
            id: "open-studio",
            title: "Open the studio",
            instruction: "Open the map builder. On the web, go to [fwmb.filroden.com](https://fwmb.filroden.com). In Foundry, open the **Scenes** sidebar and click **Map builder** at its top. The studio opens on **New map**, the first tool on the rail, with a random map to start from.",
            screenshot: { name: "studio", region: "studio" },
            caption: "The studio as it opens: the rail on the left, the New map panel beside it, and the map.",
            narration: "Open the map builder: on the web at fwmb.filroden.com, or in Foundry from the Map builder button at the top of the Scenes sidebar. It opens on New map, the first tool on the rail.",
            pause: 3,
        },
        {
            id: "seed",
            title: "The seed",
            instruction: "In the **Generation** section, type `P0JBVA` in **Map seed** (the second character is a zero). The seed decides every random choice the engine makes, so the same seed, engine and settings always give the same map.",
            action: { do: "set", field: "#fwmb-map-seed", value: "P0JBVA", label: "Map seed" },
            narration: "Type the seed, P zero J B V A. The same seed and settings always give the same map, which is how you can follow along exactly.",
        },
        {
            id: "size",
            title: "The size",
            instruction: "Set **Size** to `2000` × `1600` pixels. A larger map takes longer to generate each time the whole map is worked out again; this size is quick enough to experiment with and big enough for a detailed world.",
            action: [
                { do: "set", field: 'input[name="mapWidth"]', value: 2000, label: "the map's width" },
                { do: "set", field: 'input[name="mapHeight"]', value: 1600, label: "the map's height" },
            ],
            narration: "Set the size to two thousand by sixteen hundred pixels.",
        },
        {
            id: "latitude",
            title: "The latitudes",
            instruction: "Set **Latitude** to `60` to `-60`: the map's top edge is 60° north and its bottom edge 60° south. The latitudes shape the climate, so this world runs from cold northern lands through the tropics to cold southern ones. Leave **Area factor** at 15 and **Map unit** at km: the line under them says what one pixel measures.",
            action: [
                { do: "set", field: 'input[name="latTop"]', value: 60, label: "the top latitude" },
                { do: "set", field: 'input[name="latBottom"]', value: -60, label: "the bottom latitude" },
            ],
            screenshot: { name: "generation", region: { selector: '[data-region="context"] details[data-section="generation"]' }, pad: 8 },
            caption: "The Generation section with the tutorial map's seed, size and latitudes.",
            camera: "panel's Generation section",
            narration: "Set the latitudes to sixty north and sixty south. They shape the climate, and so the biomes. Leave the area factor and the unit as they are.",
            pause: 3,
        },
        {
            id: "engine",
            title: "Choose Guided",
            instruction: "Choose **Guided v2** in **Generation engine**. Choosing an engine creates a new map with it at once, so the studio asks what to do with the map that is open. It has never been saved, so there is nothing to keep.",
            action: [
                { do: "set", field: "#fwmb-generation-engine", value: "guided", valueLabel: "Guided v2", label: "Generation engine" },
                { do: "waitForDialog" },
            ],
            settle: false,
            screenshot: { name: "discard", region: "studio" },
            caption: "Choosing an engine asks about the open map's unsaved changes.",
            narration: "Now choose Guided in the generation engine list. A new map is made straight away, so the studio asks about the open one. We don't need it.",
        },
        {
            id: "discard",
            title: "Discard the open map",
            instruction: "Click **Discard**. The new map is all ocean: on a Guided map nothing is land until you draw it. The bar above the map now shows **Land** chosen and the state reads **Drawing**, ready for your first land mask.",
            action: [
                { do: "dialog", button: "Discard" },
                {
                    do: "expect",
                    check: (studio, seed) => (studio.uiState.generationEngine === "guided" && studio.mapWidth === 2000 && studio.mapHeight === 1600 && studio.uiState.mapSeed === seed && studio.uiState.isEditMode) || "the new Guided map was not made as asked",
                    args: P0JBVA.seed,
                    within: 60000,
                },
            ],
            screenshot: { name: "empty", region: "studio" },
            caption: "A new Guided map before any land is drawn, with Land chosen on the bar.",
            narration: "Discard it. The new map is all ocean, and the bar is ready to draw land.",
        },
        {
            id: "continent",
            title: "Draw the continent",
            instruction: `Draw the continent. With **Land** chosen on the bar, click on the map to place the points of its outline, going round the shape in the picture below. You can click a little outside the map's edge: the land then runs off the map. The new land mask opens in the inspector on the right as you place its first point; click **Reset view** in the map controls (bottom right) to see the whole map beside it. Right-click to finish the shape. The engine then makes the terrain inside it.`,
            action: drawMask(continent),
            screenshot: { name: "continent", region: "studio" },
            caption: "The continent's land mask, with the terrain the engine made inside it.",
            note: "Your outline does not need to match. Drag a point to move it, Shift+Click the outline to add a point, and Ctrl+Click a point to delete it; Undo takes back the last point.",
            narration: "Now draw the continent. Click round its outline; you can go a little past the edge of the map. Right-click to finish, and the engine fills the shape with land.",
            pause: 4,
        },
        {
            id: "islands",
            title: "Draw the islands",
            instruction: "Draw the three islands to the east the same way: click round each one and right-click to finish it, before starting the next. Each land mask is listed in the panel's **Land masks** section.",
            action: [
                ...islands.flatMap((mask) => drawMask(mask)),
                {
                    do: "expect",
                    check: (studio, count) => studio.landMasks.filter((mask) => mask.operation === "add").length === count || `${studio.landMasks.length} land masks drawn`,
                    args: islands.length + 1,
                },
            ],
            screenshot: { name: "islands", region: "studio" },
            caption: "The continent and the three islands, listed under Land masks.",
            note: "> **Tip:** each point you place makes the engine build the whole map again, which takes a few seconds at this size. To place several points without waiting, click **Pause regeneration** on the bar (the toggle beside **Random map**) before you draw; your changes are collected, and applied when you click **Apply changes**, turn the toggle back on, or stop drawing.",
            narration: "Add the three islands to the east the same way, finishing each one with a right-click.",
            pause: 3,
        },
        {
            id: "inland-sea",
            title: "Cut the inland sea",
            instruction: "Choose **Ocean** on the bar and draw the inland sea in the middle of the continent. An ocean mask cuts water out of the land beneath it.",
            action: drawMask(inlandSea),
            screenshot: { name: "inland-sea", region: "studio" },
            caption: "The ocean mask cuts an inland sea out of the continent.",
            narration: "Choose Ocean on the bar and draw the inland sea. An ocean mask cuts water out of the land.",
            pause: 3,
        },
        {
            id: "stop",
            title: "Stop drawing",
            instruction: "Click **Stop drawing** in the panel, close the inspector with its **Close** button (top right), and click **Reset view** in the map controls to see the whole map. The bar goes back to **Select**: while **New map** is open the masks stay faintly outlined, and clicking one opens it in the inspector again.",
            action: [
                { do: "click", target: { role: "button", name: "Stop drawing" }, label: "Stop drawing" },
                { do: "click", target: "dialog.fwmb-inspector[open] .fwmb-overlay-close", label: "Close on the inspector" },
                { do: "camera", view: "fit" },
                {
                    do: "expect",
                    check: (studio, expected) => {
                        const drawn = studio.landMasks.map((mask) => ({ operation: mask.operation, points: mask.points.map(({ x, y }) => [x, y]) }));
                        return JSON.stringify(drawn) === JSON.stringify(expected) || "the land masks are not P0JBVA's";
                    },
                    args: P0JBVA.landMasks.map((mask) => ({ operation: mask.operation, points: mask.points.map(({ x, y }) => [x, y]) })),
                    message: "land masks",
                },
            ],
            screenshot: { name: "map", region: { map: [0, 0, 2000, 1600] }, mapOnly: true },
            caption: "The tutorial's map at the end of this page.",
            narration: "Stop drawing, and there is our world.",
            pause: 4,
        },
        {
            id: "save",
            title: "Save the map",
            instruction: "Click **Save map** on the rail (the disk icon near its foot). The map has never been saved, so the studio asks for its name: type `Tutorial world` and click **Confirm**. On the web the map is saved in your browser; in Foundry, in the world. The saved map is listed in **Maps**.",
            action: [
                { do: "click", target: '.fwmb-rail-btn[data-action="saveMap"]', label: "Save map" },
                { do: "dialog", button: "ok", input: "Tutorial world", label: "Confirm" },
                { do: "expect", check: (studio) => (!!studio.currentSaveId && !studio.isDirty) || "the map was not saved", within: 30000 },
            ],
            narration: "Finally, save the map, and call it Tutorial world. Next, we shape the land.",
        },
    ],

    whatYouSee: `A map of one large continent running from the north-west corner down to the south, three islands to the east and an inland sea, all with hills, mountains and coasts the engine made. The map is saved as **Tutorial world**. The colours come from the biomes the module has worked out from the terrain and climate; later pages change both.`,
    foundry: "Everything on this page is the same in Foundry, apart from opening the studio (from the **Scenes** sidebar) and where the map is saved (in the world, where every GM can open it).",
    onYourOwn: `Choose the engine that fits what you have in mind (see [[New map]] for the four engines): **Guided** when you know the shape of your world, **Standard** or **Advanced (tectonics)** to browse random worlds by changing the seed. Set the latitudes before you go further, since they decide the climate. Leave the size modest while you experiment: you can make a larger regional map of any part later (page 9).`,
    related: ["New map", "Getting Started", "Maps"],
};
