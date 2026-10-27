// Tutorial page 10: finishing and sharing. Adds the scale bar and a border, sets the map's grid,
// exports a PNG at the recommended scale, and saves and backs up the map. Foundry's scene export
// is described rather than played, since the runner works the web studio.

/** The map's bottom left corner, where the scale bar starts. */
const CORNER = [0, 1200, 800, 1600];

/** The Red Hills, for the grid's close-up. */
const HILLS = [1000, 300, 1440, 760];

/** A map controls button, by its action and data attribute. */
const LAYER = (layer) => `.fwmb-map-btn[data-action="toggleLayer"][data-layer="${layer}"]`;
const GRID = '.fwmb-map-btn[data-action="toggleGrid"]';

export default {
    number: 10,
    slug: "finishing-and-sharing",
    title: "Finishing and sharing",
    start: "09-exploring-the-world",
    goal: "Give the map its finishing touches, export it as an image, and keep a backup of your maps.",
    intro: `The **Finish** stage of the rail has two tools. **Cartography** adds what is drawn over the map: a scale bar, a border, the grid and decorations such as a compass rose. **Export** turns the map into a PNG image, and in Foundry into a scene. An export shows the map as the map controls show it, so choosing what to include is part of exporting.`,
    narration: "In this video we finish the map with a scale bar and a border, set its grid, export it as an image, and back it up.",

    steps: [
        {
            id: "scale-bar",
            title: "Add a scale bar and a border",
            instruction: "Click **Cartography** on the rail. In **Scale bar**, tick **Enable scale bar**: it is drawn near the bottom left corner, and with **Match world scale** on it measures the world truly, here 200 km to each major tick. In **Border**, tick **Enable map border** and set **Border style** to **Ornate**. Zoom in on the bottom left corner to see them.",
            action: [
                { do: "tool", tool: "cartography", label: "Cartography" },
                { do: "set", field: 'input[name="cartographyScaleEnable"]', value: true, label: "Enable scale bar" },
                { do: "set", field: 'input[name="cartographyBorderEnable"]', value: true, label: "Enable map border" },
                { do: "set", field: 'select[name="cartographyBorderStyle"]', value: "ornate", valueLabel: "Ornate", label: "Border style" },
                { do: "expect", check: (studio) => (studio.uiState.cartographyScaleEnable && studio.uiState.cartographyBorderEnable) || "no scale bar or border", within: 30000 },
                { do: "settle" },
                { do: "frame", rect: CORNER, label: "Zoom in on the bottom left corner." },
            ],
            screenshot: { name: "scale-bar", region: { map: CORNER }, mapOnly: true },
            caption: "The scale bar and the ornate border in the map's bottom left corner.",
            note: "Choose **Move** on the bar to drag the scale bar elsewhere. **Add decoration** adds an image of your own over the map, such as a compass rose or a title cartouche; while you hold one in Move mode, scroll to turn it and Shift+Scroll to resize it.",
            narration: "Open Cartography. Turn on the scale bar, which matches the world's own scale, and an ornate border.",
            pause: 4,
        },
        {
            id: "grid",
            title: "Set the grid",
            instruction: "In **Grid**, set **Grid pattern** to **Hexagonal (columns)**. Choosing a pattern switches the grid on in the map controls, so you can see it: zoom in on the Red Hills to look. The grid is a setting of the map: in Foundry, a scene exported from the map gets the same grid, lined up with it, and each cell's biome and terrain are written onto the scene for other modules to read. Click **Grid** in the map controls to hide it again; the map keeps its pattern.",
            action: [
                { do: "set", field: 'select[name="gridType"]', value: "hexC", valueLabel: "Hexagonal (columns)", label: "Grid pattern" },
                { do: "settle" },
                { do: "frame", rect: HILLS, label: "Zoom in on the Red Hills." },
            ],
            screenshot: { name: "grid", region: { map: HILLS }, mapOnly: true },
            caption: "A hexagonal grid over the Red Hills.",
            note: "**Grid size** sets a cell's size in pixels, from 20 (the smallest Foundry allows) to 300. A PNG includes the grid only while it is shown.",
            narration: "Set the grid pattern to hexagonal. A scene exported to Foundry gets the same grid, lined up with the map.",
            pause: 3,
        },
        {
            id: "choose",
            title: "Choose what to export",
            instruction: "Click **Grid** in the map controls to hide the grid, and **Contours** to hide the sea's depth lines, for a clean player map. Then click **Reset view**. What the map controls show is what an export shows, so this is the moment to choose: the **Detail** level, the region layers and label styles in the **Regions** and **Labels** menus, and the layers on the buttons.",
            action: [
                { do: "click", target: GRID, label: "Grid in the map controls" },
                { do: "click", target: LAYER("contours"), label: "Contours in the map controls" },
                { do: "camera", view: "fit" },
            ],
            screenshot: { name: "clean", region: "studio" },
            caption: "The finished map, with the grid and contours hidden.",
            note: "Items set to **GM only** are left out of a player image. In Foundry, a scene export puts them on a hidden overlay tile that only the GM sees.",
            narration: "Hide the grid and the contour lines for a clean map. What the map controls show is what an export shows.",
            pause: 3,
        },
        {
            id: "png",
            title: "Export a PNG",
            instruction: "Click **Export** on the rail, then **Export to PNG**. The dialogue offers the image's **Scale**, from the map's own size (1×) to four times it, each with the image's size in pixels. The scale chosen at first is the **recommended** one, the smallest at which the smallest names can be read, and the line below it says why.",
            action: [
                { do: "tool", tool: "export", label: "Export" },
                { do: "click", target: '[data-region="context"] [data-action="exportPng"]', label: "Export to PNG" },
                { do: "waitForDialog" },
            ],
            settle: false,
            screenshot: { name: "png", region: "dialog", pad: 8 },
            caption: "The Export to PNG dialogue, with the recommended scale chosen.",
            narration: "Open Export and click Export to PNG. The dialogue recommends a scale at which the smallest names can be read.",
            pause: 3,
        },
        {
            id: "png-done",
            title: "Save the image",
            instruction: "Click **Confirm**. The studio draws the image at that scale and saves it to your browser's downloads, named after the map (`fwmb_tutorial_world.png`).",
            action: [{ do: "dialog", button: "ok", label: "Confirm" }],
            narration: "Confirm, and the image is saved to your downloads.",
        },
        {
            id: "save",
            title: "Save and back up",
            instruction: "Save the map. Then click **Maps** on the rail and, under **Backup**, click **Back up all maps**: every map you have saved goes into one zip file, with the images and pin icons they use. On the web your maps live in the browser, so keep a backup somewhere safe; **Restore from backup** brings them back, in the web studio or in Foundry. To share one map, use **Export JSON** in its card's **⋮** menu, which is how this tutorial's maps were made.",
            action: [
                { do: "click", target: '.fwmb-rail-btn[data-action="saveMap"]', label: "Save map" },
                { do: "expect", check: (studio) => !studio.isDirty || "the map was not saved", within: 30000 },
                { do: "tool", tool: "manage", label: "Maps" },
                { do: "click", target: '[data-region="context"] [data-action="backUpMaps"]', label: "Back up all maps" },
                { do: "settle" },
            ],
            narration: "Save the map, then back up all your maps in one file from the Maps tool. Next, a regional map.",
        },
    ],

    whatYouSee: "The map with a scale bar in the bottom left corner, an ornate border, and a hexagonal grid that is set but hidden; a PNG of it and a backup of your maps in your downloads.",
    foundry: `In Foundry, the Export tool also has **Export to scene**, which makes the map a playable scene. Its dialogue asks for the scene's name, the folder for its images and the scale (with the same recommended one), and whether to make journal pages and a GM overlay. The scene gets the map as its background, the map's grid (sized so Foundry's ruler measures true distances), a hidden tile with the GM-only items, and a journal entry with a page for each named place, route and region, among them Mostadra's description. Exporting again to the same name updates the scene and keeps the walls, lights and tokens you placed. See [[Export]].`,
    onYourOwn: `Finish every map the same way: scale bar, border, grid, then the map controls for what goes in. Make two images from one map with the view filters in the map controls: **Player view** alone for your players, **GM view** too for yourself. Raise the **Symbol size** in the **Detail** menu if names are small in a large image. Back up after every session of work on the web, since your browser can clear its storage. See [[Cartography]], [[Export]] and [[Maps]].`,
    related: ["Cartography", "Export", "Maps", "Map Canvas"],
};
