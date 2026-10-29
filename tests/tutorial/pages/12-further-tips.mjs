// Tutorial page 12: further tips. On the regional map from page 11: finding pins with the list's
// search and filters, mass edit (the ruined towns made GM only), and how the three visibilities
// and the map controls' view filters decide what an export shows. Then a new map traced over a
// sketch with the reference image, the usual way to bring in an existing map.

/** The west of the Red Hills on the regional map: Redwatch and two ruined towns, Draxted and Pereter. */
const WEST_HILLS = [300, 420, 760, 780];

/** The sketch map (samples/tutorial/ashgrove-sketch.png) and the new map's size, the same as the sketch's. */
const SKETCH = "samples/tutorial/ashgrove-sketch.png";
const SKETCH_URL = "https://github.com/Filroden/Filrodens-world-map-builder/raw/main/samples/tutorial/ashgrove-sketch.png";
const SKETCH_SIZE = [1200, 900];

/** The sketch's outlines, in its pixels (and the new map's): the island, the isle and the lake. */
const ISLAND = [[250, 250], [420, 170], [610, 190], [780, 140], [930, 240], [960, 400], [890, 520], [940, 650], [800, 760], [600, 720], [450, 780], [300, 690], [220, 540], [170, 400]];
const ISLE = [[1010, 600], [1090, 570], [1130, 650], [1080, 730], [1000, 700]];
const LAKE = [[560, 420], [640, 400], [680, 460], [620, 510], [550, 480]];

/** The sketch's towns, placed beside the rivers this seed makes rather than exactly where the sketch has them. */
const TOWNS = [
    ["Thornby", [340, 507]],
    ["Ashcombe", [800, 439]],
    ["Wetherhold", [700, 599]],
    ["Gull Rock", [1032, 653]],
];

/** Above the new map's top edge, in its margin: a right-click there finishes a shape. */
const FINISH_AT = [600, -60];

/** The Pins list's controls. */
const PIN_LIST = (field) => `select[data-list-query="pin"][data-query-field="${field}"]`;
const PIN_SEARCH = 'input[name="listSearch-pin"]';
const pinRow = (name) => `.fwmb-list-item[data-type="pin"]:has(:text-is("${name}"))`;
const INSPECTOR = "dialog.fwmb-inspector[open]";
const VIEW = (filter) => `.fwmb-map-btn[data-action="toggleViewFilter"][data-filter="${filter}"]`;

/** Draws one land mask: the bar's mode, its points, a right-click to finish. */
const mask = (mode, points, name) => [
    { do: "mode", action: "setSceneMode", mode, label: mode === "addMask" ? "Land" : "Ocean" },
    { do: "shape", points, finishAt: FINISH_AT, fitAfterFirst: true, label: `Click round the outline of ${name} (${points.length} points), then right-click to finish it.` },
];

export default {
    number: 12,
    slug: "further-tips",
    title: "Further tips",
    start: "11-a-regional-map",
    goal: "Find and change many items at once, control what your players see, and trace a map of your own from an existing image.",
    intro: `This last page answers the questions asked most often. Its first part carries on with the regional map from page 11: finding items in the long lists, changing many at once, and deciding what your players see. Its second part starts a new map, traced over an image of an existing map with the **Reference image** tool.`,
    narration: "In this last tutorial we're going to look at finding and changing many places at once, keeping secrets from your players, and tracing a map from an existing image.",

    steps: [
        {
            id: "search",
            title: "Search the lists",
            instruction: "With **The Red Hills** open, click **Routes and pins** on the rail. The **Pins** list holds every place on the map, nearly eight hundred after the fill-in. Type `ford` in its **Search by name** field: the list keeps the pins whose names contain it, and says how many match.",
            action: [
                { do: "tool", tool: "infrastructure", label: "Routes and pins" },
                { do: "set", field: PIN_SEARCH, value: "ford", label: "Search by name" },
            ],
            screenshot: { name: "search", region: "panel" },
            caption: "The Pins list searched for \"ford\".",
            narration: "Open Routes and pins. The pins list is long, so search it: type ford, and only the matching places are shown.",
            pause: 3,
        },
        {
            id: "filter",
            title: "Filter the lists",
            instruction: "Clear the search. Set **Made by** to **Generated** and **Kind of pin** to **Ruined town**: the list keeps the ruined towns the run left behind. Every long list has filters like these: routes by transport, labels by kind (including those with no room, as on page 8), regions by layer.",
            action: [
                { do: "set", field: PIN_SEARCH, value: "", label: "Search by name" },
                { do: "set", field: PIN_LIST("origin"), value: "generated", valueLabel: "Generated", label: "Made by" },
                { do: "set", field: PIN_LIST("kind"), value: "ruinedTown", valueLabel: "Ruined town", label: "Kind of pin" },
            ],
            narration: "Clear the search, and filter instead: select generated pins of the kind Ruined town.",
        },
        {
            id: "mass-edit",
            title: "Change them all at once",
            instruction: "Click **Select items for mass edit** in the Pins section's title (the pencil). A tick box appears on each row: click **Select all**, which ticks every pin the list shows, then **Mass edit (13)**. The dialogue shows the pins' fields, each with the value they share or **Mixed**. Set **Visibility** to **GM only**: the ruins are secret until your players find them.",
            action: [
                { do: "click", target: '[data-action="toggleMassEditMode"][data-type="pin"]', label: "Select items for mass edit" },
                { do: "click", target: '[data-action="massEditSelectAll"][data-type="pin"]', label: "Select all" },
                { do: "click", target: '[data-action="openMassEdit"][data-type="pin"]', label: "Mass edit" },
                { do: "waitForDialog" },
                { do: "set", field: 'dialog.fwmb-overlay-modal[open] select[name="item.visibility"]', value: "gm", valueLabel: "GM only", label: "Visibility" },
            ],
            settle: false,
            screenshot: { name: "mass-edit", region: "dialog", pad: 8 },
            caption: "Mass edit for the thirteen ruined towns, with Visibility changed to GM only.",
            note: "Only the fields you change are written; the rest stay as each pin has them. **Delete** beside **Mass edit** deletes the ticked items instead, after asking.",
            narration: "Now we will select items for mass edit. So select all, and open Mass edit. Set the visibility to GM only.",
        },
        {
            id: "mass-done",
            title: "Confirm",
            instruction: "Click **Confirm**. The thirteen ruined towns are GM only, in one step of undo.",
            action: [
                { do: "dialog", button: "ok", label: "Confirm" },
                { do: "expect", check: (studio) => studio.mapPins.filter((pin) => pin.generated?.tier === "ruinedTown").every((pin) => pin.visibility === "gm") || "the ruined towns are not all GM only", within: 30000 },
            ],
            narration: "Confirm, and all thirteen pins that were filtered will change at once.",
        },
        {
            id: "views",
            title: "Visibility and the views",
            instruction: "Everything on the map (pins, routes, regions, labels and decorations) is visible to **Everyone**, **GM only**, or **Hidden**. The first three buttons of the map controls, **Player view**, **GM view** and **Hidden**, choose which of them the map shows; at first the first two are on. Zoom in on the west of the Red Hills, where Redwatch stands with two of the ruins, Draxted and Pereter, marked in red.",
            action: [{ do: "frame", rect: WEST_HILLS, label: "Zoom in on the west of the Red Hills." }],
            screenshot: { name: "gm-view", region: { map: WEST_HILLS }, mapOnly: true },
            caption: "Player view and GM view on: Redwatch, and the ruined towns Draxted and Pereter.",
            narration: "Everything on the map can either be visible to everyone, to the GM only, or hidden from everyone. The first three buttons of the map controls choose which you see. Here, with the GM view on, the ruins show.",
            pause: 3,
        },
        {
            id: "gm-view",
            title: "See what your players see",
            instruction: "Click **GM view** in the map controls to turn it off: the ruins vanish, and the map shows what your players will see.",
            action: [{ do: "click", target: VIEW("gm"), label: "GM view" }],
            screenshot: { name: "player-view", region: { map: WEST_HILLS }, mapOnly: true },
            caption: "Player view alone: the ruined towns are left out.",
            note: "An export shows the map as these buttons do. With **GM view** off, a PNG is a player's map; with it on, a GM's. In Foundry, **Export to scene** makes both at once: the scene's image holds what is visible to Everyone, and a hidden tile over it, seen only by the GM, holds the GM-only items.",
            narration: "Turn off GM view, and the ruins disappear: this is your players' map, and what an export shows.",
            pause: 4,
        },
        {
            id: "hidden",
            title: "Hide something",
            instruction: "Turn **GM view** back on. Now hide Redwatch, a castle the story hasn't reached yet: type `Redwatch` in the Pins list's search, click its row, and set **Visibility** to **Hidden** in the inspector. It disappears even from the GM's view. Click **Hidden** in the map controls to show hidden items while you work; a hidden item is never exported, whatever these buttons show.",
            action: [
                { do: "click", target: VIEW("gm"), label: "GM view" },
                { do: "set", field: PIN_LIST("kind"), value: "all", valueLabel: "All kinds", label: "Kind of pin" },
                { do: "set", field: PIN_LIST("origin"), value: "all", valueLabel: "Any origin", label: "Made by" },
                { do: "set", field: PIN_SEARCH, value: "Redwatch", label: "Search by name" },
                { do: "click", target: `${pinRow("Redwatch")} .fwmb-name`, label: "Redwatch" },
                { do: "set", field: `${INSPECTOR} select[name="pinVisibility"]`, value: "none", valueLabel: "Hidden", label: "Visibility" },
                { do: "click", target: VIEW("none"), label: "Hidden" },
            ],
            screenshot: { name: "hidden", region: "studio" },
            caption: "Redwatch hidden, shown while the Hidden view is on.",
            note: "The eye on each list row cycles the item's visibility: Everyone, GM only, Hidden. A region's or route's label has a visibility of its own, so you can hide a name and keep what it names.",
            narration: "Turn GM view back on, and hide Redwatch from everyone. The Hidden button shows hidden things while you work, but they're never exported.",
            pause: 4,
        },
        {
            id: "save-region",
            title: "Save the regional map",
            instruction: "Click **Hidden** in the map controls again to turn it off, close the inspector, and save the map.",
            action: [
                { do: "click", target: VIEW("none"), label: "Hidden" },
                { do: "click", target: `${INSPECTOR} .fwmb-overlay-close`, label: "Close on the inspector" },
                { do: "click", target: '.fwmb-rail-btn[data-action="saveMap"]', label: "Save map" },
                { do: "expect", check: (studio) => !studio.isDirty || "the map was not saved", within: 30000 },
            ],
            narration: "Turn the Hidden view off, and save.",
        },
        {
            id: "new-map",
            title: "Start a map to trace",
            instruction: `Now bring in an existing map. Download the sketch [ashgrove-sketch.png](${SKETCH_URL}), an island drawn by hand, 1,200 × 900 pixels. Click **New map** on the rail, set **Size** to \`1200\` × \`900\`, the same as the image, so the image lies over the map pixel for pixel, and click **Create new map**. A new map keeps the land masks of the map that was open (you'll see why below), so to start from a clean view, click **Delete all land masks** in the **Land masks** section and **Yes**: the map is all ocean.`,
            action: [
                { do: "tool", tool: "scene", label: "New map" },
                { do: "set", field: 'input[name="mapWidth"]', value: SKETCH_SIZE[0], label: "the map's width" },
                { do: "set", field: 'input[name="mapHeight"]', value: SKETCH_SIZE[1], label: "the map's height" },
                { do: "click", target: '[data-region="context"] [data-action="applyResolution"]', label: "Create new map" },
                { do: "expect", check: (studio, size) => (studio.mapWidth === size[0] && studio.mapHeight === size[1]) || "the new map was not made", args: SKETCH_SIZE, within: 120000 },
                { do: "settle" },
                { do: "click", target: '[data-region="context"] [data-action="deleteAllLandMasks"]', label: "Delete all land masks" },
                { do: "dialog", button: "Yes", label: "Yes" },
                { do: "expect", check: (studio) => studio.landMasks.length === 0 || "the land masks are still there", within: 60000 },
            ],
            note: "The engine matters: **Guided**, used here, makes terrain inside the outlines you draw. **Flat** makes a flat land a little above the sea, to sculpt by hand with the terrain brushes. See [[New map]].",
            narration: "Now a new map, the same size as the sketch we'll trace. Create it, and delete the land masks it kept from our first map, so it starts as open sea.",
        },
        {
            id: "reference",
            title: "Show the sketch",
            instruction: "Open **Reference image** (in **More** at the foot of the rail). Click **Choose a file** beside **Image source** and choose the sketch. It is shown over the map at half **Opacity**, at its own size, in the middle of the map. Please make sure you have permission to use any map you trace.",
            action: [
                { do: "tool", tool: "reference", label: "Reference image" },
                { do: "chooseFile", target: '[data-region="context"] button[data-tooltip="Choose a file"]', file: SKETCH, label: "Choose a file" },
                { do: "expect", check: (studio) => !!studio.uiState.referenceImage || "no reference image", within: 60000 },
                { do: "camera", view: "fit" },
            ],
            screenshot: { name: "reference", region: "studio" },
            caption: "The sketch as the reference image over the new map.",
            note: "Drag the image to move it, and Shift+Scroll to resize it; the **Image position** buttons nudge it a pixel at a time. The image is saved with the map, and never exported.",
            narration: "Open the Reference image tool and choose the sketch. It sits over the map as a guide.",
            pause: 3,
        },
        {
            id: "trace",
            title: "Trace it",
            instruction: "Click **New map** on the rail. With **Land** chosen on the bar, click round the island's coast and right-click to finish; do the same for the small isle to the east. Choose **Ocean** and draw round the lake. The engine makes hills, rivers and coasts inside your outlines.",
            action: [{ do: "tool", tool: "scene", label: "New map" }, ...mask("addMask", ISLAND, "the island"), ...mask("addMask", ISLE, "the isle"), ...mask("subtractMask", LAKE, "the lake"), { do: "settle" }],
            screenshot: { name: "traced", region: "studio" },
            caption: "The island, the isle and the lake traced as land masks.",
            note: "Pause regeneration on the bar (as on page 1) lets you place many points without waiting for the map after each.",
            narration: "Back in New map, click around the island's coast and the isle, and draw the lake as ocean. The engine fills in the land and creates the lake inside it.",
            pause: 4,
        },
        {
            id: "seed",
            title: "Try another seed",
            instruction: "Click **Stop drawing** and close the inspector. The outlines are right, but the hills and valleys inside them are the seed's choice. In the **Generation** section, change **Map seed** to `51745D` and click **Create new map**. The studio asks about the map you haven't saved: click **Discard**. The new map keeps your land masks, so the island's outline stays and only the terrain inside it changes; with this seed the hills sit nearer where the sketch draws them. Try a few seeds until one suits you.",
            action: [
                { do: "click", target: { role: "button", name: "Stop drawing" }, label: "Stop drawing" },
                { do: "click", target: `${INSPECTOR} .fwmb-overlay-close`, label: "Close on the inspector" },
                { do: "set", field: "#fwmb-map-seed", value: "51745D", label: "Map seed" },
                { do: "click", target: '[data-region="context"] [data-action="applyResolution"]', label: "Create new map" },
                { do: "dialog", button: "Discard", label: "Discard" },
                { do: "expect", check: (studio) => (studio.uiState.mapSeed === "51745D" && studio.landMasks.length === 3) || "the new map did not keep the land masks with the new seed", within: 120000 },
                { do: "settle" },
            ],
            note: "This is why a new map keeps the open map's land masks: trying seeds, or a new size, on the same outlines is one click. To start from open sea, click **Delete all land masks**, as above.",
            narration: "The outline is right, but the hills inside it are the seed's choice. Change the seed and create a new map: the land masks stay, and only the terrain changes.",
        },
        {
            id: "coast",
            title: "Smooth the coast",
            instruction: "Click **Terrain** on the rail and lower **Coastal fracture** to `0.1`: the coast breaks up less into islets and inlets, nearer the sketch's simple outline. Then turn off **Reference image** in the map controls and click **Reset view** to see the island on its own.",
            action: [
                { do: "tool", tool: "terrain", label: "Terrain" },
                { do: "set", field: 'input[name="coastlineFracture"]', value: 0.1, label: "Coastal fracture" },
                { do: "expect", check: (studio) => Number(studio.uiState.coastlineFracture) === 0.1 || "coastal fracture is not 0.1", within: 30000 },
                { do: "settle" },
                { do: "click", target: '.fwmb-map-btn[data-action="toggleLayer"][data-layer="reference"]', label: "Reference image in the map controls" },
                { do: "camera", view: "fit" },
            ],
            screenshot: { name: "coast", region: { map: [0, 0, SKETCH_SIZE[0], SKETCH_SIZE[1]] }, mapOnly: true },
            caption: "The island with the new seed and a smoother coast.",
            narration: "In Terrain, lower the coastal fracture for a smoother coast, closer to the sketch, and then hide the reference image.",
            pause: 4,
        },
        {
            id: "towns",
            title: "Place the towns",
            instruction: "Click **Routes and pins** on the rail, choose **Place** on the bar and set **Pin style** to **Town**. Place the sketch's four towns, each beside a river or on the coast near where the sketch has it, naming each in the inspector as you go: **Thornby** in the west, **Ashcombe** in the east, **Wetherhold** in the south and **Gull Rock** on the isle.",
            action: [
                { do: "tool", tool: "infrastructure", label: "Routes and pins" },
                { do: "mode", action: "setPickMode", mode: "place", label: "Place" },
                { do: "set", field: '[data-region="editToolbar"] select[name="activePinStyle"]', value: "Town", label: "Pin style" },
                ...TOWNS.flatMap(([name, at]) => [
                    { do: "camera", view: "fit" },
                    { do: "mapClick", at, label: `Click the map to place ${name}.` },
                    { do: "set", field: `${INSPECTOR} input[name="pinName"]`, value: name, commit: "Enter", label: "Name" },
                ]),
                { do: "expect", check: (studio, names) => names.every((name) => studio.mapPins.some((pin) => pin.name === name)) || "not every town was placed", args: TOWNS.map(([name]) => name), within: 30000 },
            ],
            note: "The sketch's river runs straight from the hills to the south coast; the engine's rivers follow the land instead. To have the sketch's river exactly, draw it as a custom river in **Rivers and faults** (page 4), though a river that ignores the lie of the land can look out of place.",
            narration: "Place the sketch's four towns, each beside a river, and name them.",
        },
        {
            id: "town-size",
            title: "Make them larger",
            instruction: "On a map this size the Town style's pins and names are small. Make all four larger at once: set the Pins list's **Made by** filter to **Hand-made**, click **Select items for mass edit**, **Select all**, then **Mass edit (4)**. Set **Scale** to `2.2`, and in **Label**, set **Style** to **Place** and **Size** to `2.2`. Click **Confirm**.",
            action: [
                { do: "set", field: PIN_SEARCH, value: "", label: "Search by name" },
                { do: "set", field: PIN_LIST("origin"), value: "handmade", valueLabel: "Hand-made", label: "Made by" },
                { do: "click", target: '[data-action="toggleMassEditMode"][data-type="pin"]', label: "Select items for mass edit" },
                { do: "click", target: '[data-action="massEditSelectAll"][data-type="pin"]', label: "Select all" },
                { do: "click", target: '[data-action="openMassEdit"][data-type="pin"]', label: "Mass edit" },
                { do: "waitForDialog" },
                { do: "set", field: 'dialog.fwmb-overlay-modal[open] input[name="item.scale"]', value: 2.2, label: "Scale" },
                { do: "set", field: 'dialog.fwmb-overlay-modal[open] select[name="label.quickStyle"]', value: "label-style-place", valueLabel: "Place", label: "Label style" },
                { do: "set", field: 'dialog.fwmb-overlay-modal[open] input[name="label.fontSize"]', value: 2.2, label: "Label size" },
                { do: "dialog", button: "ok", label: "Confirm" },
                { do: "expect", check: (studio, names) => names.every((name) => studio.mapPins.find((pin) => pin.name === name)?.scale === 2.2) || "the towns were not made larger", args: TOWNS.map(([name]) => name), within: 30000 },
                { do: "mode", action: "setPickMode", mode: "select", label: "Select" },
            ],
            narration: "Their pins and names are small on a map this size, so mass edit all four: a larger scale, and the Place label style at a larger size.",
        },
        {
            id: "save",
            title: "Save it",
            instruction: "Save the map, naming it `The Isle of Ashgrove`. A sketch has become a map with real terrain, climate and rivers; from here everything in this tutorial applies to it, from generating its people (page 5) to exporting it (page 10).",
            action: [
                { do: "click", target: '.fwmb-rail-btn[data-action="saveMap"]', label: "Save map" },
                { do: "dialog", button: "ok", input: "The Isle of Ashgrove", label: "Confirm" },
                { do: "expect", check: (studio) => (!!studio.currentSaveId && !studio.isDirty) || "the map was not saved", within: 30000 },
                { do: "camera", view: "fit" },
            ],
            screenshot: { name: "ashgrove", region: { map: [0, 0, SKETCH_SIZE[0], SKETCH_SIZE[1]] }, mapOnly: true },
            caption: "The Isle of Ashgrove, made from the sketch.",
            narration: "Save it. A sketch on paper has become a map with real terrain, and everything in this tutorial now applies to it.",
            pause: 4,
        },
    ],

    whatYouSee: "Two saved maps besides Tutorial world: The Red Hills, with its ruined towns GM only and Redwatch hidden, and The Isle of Ashgrove, traced from the sketch, with the seed 51745D, a smoother coast and its four towns.",
    foundry: "Everything on this page is the same in Foundry, apart from where the sketch comes from: in Foundry, **Image source** opens Foundry's file picker, so upload the image to your world's data first.",
    onYourOwn: `Use the filters and **Select all** whenever you want to change a kind of thing everywhere, and think about styles too: a change to a pin, route or label style reaches every item that follows it. Decide early what your players should not see, and set it GM only as you go; check with **GM view** off before you export. To recreate a map you already have, make the new map the same shape as the image, trace the coasts as land masks, and lower the image's **Opacity** to check the terrain against it. See [[Map Making Tools]] (mass edit), [[Map Canvas]] (view filters), [[Export]] and [[Reference image]].`,
    related: ["Map Making Tools", "Map Canvas", "Export", "Reference image"],
};
