// Tutorial page 8: places and labels. Finds a generated city and keeps it, places a castle of the
// reader's own, changes the Castle pin style so every castle's name shows, names a sea with a
// standalone label, and drags a duchy's name that had no room into place.

/** Where the castle goes: in the Red Hills, west of the King's Road. */
const CASTLE = [1130, 455];

/** Where the sea's name goes: the open water between the continent's east coast and Thetfield. */
const SEA = [1540, 800];

/** Southamney's name: where it would go (its duchy's label point), and where it is dragged to. */
const SOUTHAMNEY_FROM = [1349, 582];
const SOUTHAMNEY_TO = [1345, 612];

/** The Islemark Crossing's name: where it would go (above the middle of its line), and where it is dragged to. */
const CROSSING_FROM = [1393, 873];
const CROSSING_TO = [1460, 930];

/** The Red Hills and the sea, for the close-ups. */
const HILLS = [1000, 300, 1440, 760];
const SEA_VIEW = [1380, 600, 1700, 1000];

/** A row of the Pins list, by its name. */
const pinRow = (name) => `.fwmb-list-item[data-type="pin"]:has(:text-is("${name}"))`;

/** The open inspector. */
const INSPECTOR = "dialog.fwmb-inspector[open]";

export default {
    number: 8,
    slug: "places-and-labels",
    title: "Places and labels",
    start: "07-roads-and-sea-lanes",
    goal: "Keep a generated place, add a place of your own, change a pin style, name a sea, and place a name that had no room.",
    intro: `Places are **pins**: a point on the map with an icon, a name and a description. The run on page 5 placed nearly two thousand, from capitals to villages, each on a **pin style** (Capital, City, Town, Castle and so on) that sets its look and the **detail levels** at which it and its name are shown.

Every name on the map is a **label**: the labels of pins, routes and regions follow their owner's name, and **standalone** labels name anything else, such as a sea or a mountain range. Names are placed so they don't cover each other; a name with no room is left out until you place it yourself.`,
    narration: "In this video we work with the map's places and names: we keep a generated city, add a castle of our own, name a sea, and place a name the map had no room for.",

    steps: [
        {
            id: "find",
            title: "Find a place",
            instruction: "Click **Routes and pins** on the rail. **Pin** is chosen at the start of the bar. Type `Mostadra` in the Pins list's search field, click the row that is left, and click its **Focus view** button: the map zooms to the city on the King's Road, and it opens in the inspector. Open the inspector's **Generated** section to read what the run recorded about it: its place in the world, its population, its people and its history.",
            action: [
                { do: "tool", tool: "infrastructure", label: "Routes and pins" },
                { do: "set", field: 'input[name="listSearch-pin"]', value: "Mostadra", label: "Search by name" },
                { do: "click", target: pinRow("Mostadra"), label: "Mostadra" },
                { do: "point", target: pinRow("Mostadra"), label: "Mostadra's row" },
                { do: "click", target: `${pinRow("Mostadra")} [data-action="zoomToFeature"]`, label: "Focus view" },
                { do: "click", target: `${INSPECTOR} summary:has-text("Generated")`, label: "Generated" },
            ],
            screenshot: { name: "generated", region: "inspector" },
            caption: "Mostadra in the inspector, with what the run recorded about it.",
            narration: "Search the pins for Mostadra, and focus the map on it. The Generated section shows what the run recorded: a city of about twenty-six thousand people, nearly all Hillfolk.",
            pause: 4,
        },
        {
            id: "keep",
            title: "Describe it and keep it",
            instruction: "Type a **Description**: `A walled city where the hill roads meet the King's Road.` Then tick **Lock** in the Generated section. Generating again replaces a generated place you have not changed; a place you have changed (as the description does) or locked is kept.",
            action: [
                { do: "set", field: `${INSPECTOR} textarea[name="pinDesc"]`, value: "A walled city where the hill roads meet the King's Road.", label: "Description" },
                { do: "click", target: `${INSPECTOR} input[data-inspector-action="lock"]`, label: "Lock" },
                { do: "expect", check: (studio) => studio.mapPins.find((pin) => pin.name === "Mostadra")?.generated?.locked === true || "Mostadra is not locked", within: 30000 },
            ],
            note: "In Foundry, a pin's name and description become a page of the scene's journal when the map is exported to a scene (see [[Export]]).",
            narration: "Give it a description, and lock it, so generating again keeps it.",
        },
        {
            id: "castle",
            title: "Place a castle of your own",
            instruction: "Choose **Place** on the bar and set **Pin style** to **Castle**. Zoom in on the Red Hills and click the hills west of the King's Road, north-west of the words **The Red Hills**. The new pin is called **Castle** and opens in the inspector: change **Name** to `Redwatch` and press Enter. Its icon is on the map, but not its name: the Castle style shows castles' names only from the **Regional** detail level, and the map is at **Province**.",
            action: [
                { do: "mode", action: "setPickMode", mode: "place", label: "Place" },
                { do: "set", field: '[data-region="editToolbar"] select[name="activePinStyle"]', value: "Castle", label: "Pin style" },
                { do: "frame", rect: HILLS, label: "Zoom in on the Red Hills." },
                { do: "mapClick", at: CASTLE, label: "Click the hills to place the castle." },
                { do: "set", field: `${INSPECTOR} input[name="pinName"]`, value: "Redwatch", commit: "Enter", label: "Name" },
                { do: "expect", check: (studio) => studio.mapPins.some((pin) => pin.name === "Redwatch" && !pin.generated) || "no pin named Redwatch", within: 30000 },
            ],
            note: "With **No style**, **Select icon** on the bar chooses the icon of a plain pin, whose name always shows. A pin's colour and size are set in its inspector; changing them by hand sets its **Style** to **Custom**.",
            narration: "Choose Place, set the pin style to Castle, and click the hills to place a castle. Name it Redwatch. Its name doesn't show yet: castles' names show only from the Regional detail level.",
            pause: 3,
        },
        {
            id: "style",
            title: "Change the Castle style",
            instruction: "Open **Styles and icons** (in **More** at the foot of the rail) and click **Castle** in the **Pin styles** list. In the inspector's **Label** group, set **Name detail level** to **Province**. Every pin on the Castle style follows the change at once: Redwatch's name shows, and so do the names of the run's castles.",
            action: [
                { do: "tool", tool: "library", label: "Styles and icons" },
                { do: "click", target: '.fwmb-list-item[data-style-type="Pin"]:has(:text-is("Castle"))', label: "Castle" },
                { do: "set", field: `${INSPECTOR} select[name="styleLabelDetailLevel"]`, value: "1", valueLabel: "Province", label: "Name detail level" },
                { do: "settle" },
                { do: "frame", rect: HILLS, label: "Zoom in on the Red Hills." },
            ],
            screenshot: { name: "castles", region: { map: HILLS }, mapOnly: true },
            caption: "Redwatch, west of the King's Road, with the names of the run's castles now shown.",
            note: "A style changes every pin that follows it, so making every town larger, or every ruin red, is one edit. **Save as…** in a pin's inspector makes a new style from a pin you have tuned.",
            narration: "Open Styles and icons, choose the Castle style, and show its names from the Province level. Every castle follows the style, Redwatch with them.",
            pause: 4,
        },
        {
            id: "sea",
            title: "Name a sea",
            instruction: "Click **Labels** on the rail. Choose **Place** on the bar and set **Style** to **Water**. Zoom in on the sea east of the continent and click the open water between the continent and the island of Thetfield. The new label opens in the inspector: change **Text** to `The Morning Sea` and press Enter, then set **Rotation** to `-30` degrees so the name runs up the channel.",
            action: [
                { do: "tool", tool: "labels", label: "Labels" },
                { do: "mode", action: "setPickMode", mode: "place", label: "Place" },
                { do: "set", field: '[data-region="editToolbar"] select[name="activeLabelQuickStyle"]', value: "Water", label: "Style" },
                { do: "frame", rect: SEA_VIEW, label: "Zoom in on the sea." },
                { do: "mapClick", at: SEA, label: "Click the open water." },
                { do: "set", field: `${INSPECTOR} input[name="labelName"]`, value: "The Morning Sea", commit: "Enter", label: "Text" },
                { do: "set", field: `${INSPECTOR} input[name="labelRotation"]`, value: -30, label: "Rotation" },
                { do: "expect", check: (studio) => studio.mapLabels.some((label) => label.name === "The Morning Sea") || "no label The Morning Sea", within: 30000 },
            ],
            screenshot: { name: "sea", region: { map: SEA_VIEW }, mapOnly: true },
            caption: "The Morning Sea, in the Water label style.",
            note: "While you hold a label in Place mode, scroll to turn it and Shift+Scroll to resize it. To make every sea name look alike, give them all the Water style and change the style.",
            narration: "Open Labels, choose Place and the Water style, and click the open sea. Call it The Morning Sea, and turn it to follow the channel.",
            pause: 4,
        },
        {
            id: "no-room",
            title: "Find the names with no room",
            instruction: "Set the Labels list's **Kind of label** filter to **With no room**: it lists the names the map has no room for, here a few duchies and the names of your two routes (route names are placed last). While you are placing labels, each shows faintly where it would go. Zoom in on the Red Hills: the duchy name **Southamney** lies faintly across the town names east of Mostadra.",
            action: [
                { do: "set", field: 'select[data-list-query="label"][data-query-field="kind"]', value: "noRoom", valueLabel: "With no room", label: "Kind of label" },
                { do: "frame", rect: HILLS, label: "Zoom in on the Red Hills." },
            ],
            screenshot: { name: "no-room", region: "studio" },
            caption: "The names with no room, listed, and shown faintly on the map while you place labels.",
            narration: "Filter the labels to those with no room. While you place labels, they show faintly where they would go, like the duchy name Southamney here.",
            pause: 3,
        },
        {
            id: "drag",
            title: "Place it yourself",
            instruction: "Drag the faint **Southamney** a little south, below the town names, and let go. A name you have dragged keeps its place, and is always drawn; the smaller names around it make room.",
            action: [
                { do: "drag", from: SOUTHAMNEY_FROM, to: SOUTHAMNEY_TO, label: "Drag Southamney south." },
                { do: "expect", check: (studio) => Number.isFinite(studio.regionLevels.flatMap((level) => level.regions).find((region) => region.name === "Southamney")?.label?.x) || "Southamney's name was not placed", within: 30000 },
            ],
            screenshot: { name: "placed", region: { map: HILLS }, mapOnly: true },
            caption: "Southamney, dragged into a place of its own.",
            narration: "Drag it a little south, below the town names. A name you've placed yourself stays where you put it.",
            pause: 4,
        },
        {
            id: "route-name",
            title: "Place a route's name",
            instruction: "Your sea lane's name had no room either. Zoom in on the sea again: **The Islemark Crossing** shows faintly above the middle of its line, near the coast. Drag it out into the open water south of The Morning Sea.",
            action: [
                { do: "frame", rect: SEA_VIEW, label: "Zoom in on the sea." },
                { do: "drag", from: CROSSING_FROM, to: CROSSING_TO, label: "Drag The Islemark Crossing into the open water." },
                { do: "expect", check: (studio) => Number.isFinite(studio.mapRoutes.find((route) => route.name === "The Islemark Crossing")?.label?.x) || "the sea lane's name was not placed", within: 30000 },
            ],
            screenshot: { name: "crossing", region: { map: SEA_VIEW }, mapOnly: true },
            caption: "The Islemark Crossing, placed in the open sea.",
            narration: "The sea lane's name had no room either. Drag it out into the open water.",
            pause: 3,
        },
        {
            id: "save",
            title: "Stop and save",
            instruction: "Choose **Select** on the bar to stop placing, close the inspector, and save the map.",
            action: [
                { do: "mode", action: "setPickMode", mode: "select", label: "Select" },
                { do: "click", target: `${INSPECTOR} .fwmb-overlay-close`, label: "Close on the inspector" },
                { do: "click", target: '.fwmb-rail-btn[data-action="saveMap"]', label: "Save map" },
                { do: "expect", check: (studio) => !studio.isDirty || "the map was not saved", within: 30000 },
            ],
            narration: "Stop placing and save. Next, the world's history.",
        },
    ],

    whatYouSee: "Mostadra, locked, with its description. A castle of your own, Redwatch, in the Red Hills, its name shown with every castle's. The Morning Sea named in the water east of the continent, and the names of the duchy Southamney and The Islemark Crossing placed by hand.",
    foundry: "Everything on this page is the same in Foundry. When the map is exported to a scene, Mostadra's name and description become a page of the scene's journal; give Redwatch a description and it gets one too.",
    onYourOwn: `Lock the generated places your story needs before you generate again, and describe them as you go: the description travels with the pin to Foundry's journal. Mark places the run doesn't make (a ruin, a shrine, a lair) with a style of your own, made with **Save as…** or in [[Styles and icons]], so you can change them all at once. Name the seas, forests and mountain ranges with standalone labels; a label style for each kind keeps them alike. If the map is crowded, check the **With no room** filter before you export, and place the names that matter. See [[Routes and pins]], [[Labels]] and [[Styles and icons]].`,
    related: ["Routes and pins", "Labels", "Styles and icons", "Map Canvas"],
};
