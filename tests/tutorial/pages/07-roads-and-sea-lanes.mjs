// Tutorial page 7: roads and sea lanes. Draws a road by waypoints through the Red Hills, names
// and styles it, moves one of its waypoints, and draws a sea lane from the continent's east coast
// to Islemark.

/** The road's waypoints, south to north: Kansmarda, Mostadra, Stansto. */
const ROAD = [
    [1222, 673],
    [1265, 602],
    [1283, 425],
];

/** Where the road's middle waypoint is dragged to. */
const ROAD_MOVED = [1240, 540];

/** The sea lane's waypoints, on the water off the east coast and off Newcested. */
const SEA_LANE = [
    [1395, 770],
    [1440, 1000],
];

/** The Red Hills, for the road's close-ups. */
const HILLS = [1120, 360, 1400, 720];

/** Finishes a route being drawn, as Enter does. */
const FINISH = { do: "key", key: "Enter", label: "Press Enter to finish the route." };

export default {
    number: 7,
    slug: "roads-and-sea-lanes",
    title: "Roads and sea lanes",
    start: "06-realms-and-provinces",
    goal: "Draw a road and a sea lane of your own by their waypoints, and reshape a route by moving a waypoint.",
    intro: `The **Routes and pins** tool places the lines and points of the map: **routes** (roads, sea lanes and the river trade the run made) and **pins** (places). A route is a chain of **waypoints**, and the module finds the way between each pair for you over the map's cells: a road keeps to land and winds round steep ground, a sea lane keeps to water.`,
    narration: "In this tutorial we're going to draw routes of our own: a road through the Red Hills, and a sea lane to the island realm.",

    steps: [
        {
            id: "open",
            title: "Open Routes and pins",
            instruction: "Click **Routes and pins** on the rail and choose **Route** at the start of the bar. The panel lists every pin and every route on the map; the run on page 5 made thousands of each. The search field and filters above each list narrow it.",
            action: [
                { do: "tool", tool: "infrastructure", label: "Routes and pins" },
                { do: "click", target: '[data-action="setInfraMode"][data-mode="route"]', label: "Route" },
            ],
            screenshot: { name: "routes", region: "studio" },
            caption: "Routes and pins, in Route mode.",
            narration: "Open Routes and pins, and choose Route on the bar. The panel lists every pin and route on the map.",
            pause: 3,
        },
        {
            id: "road",
            title: "Draw a road",
            instruction: "Choose **Draw** on the bar. Leave **Path** at **Follow terrain** and **Transport** at **Road**, and set **Style** to **Trunk road**. Zoom in on the Red Hills, then click three waypoints through them, south to north: the capital **Kansmarda**, the city **Mostadra**, and the city **Stansto**. As you move, the leg the next click adds is previewed. Press Enter (or right-click) to finish the road; it opens in the inspector.",
            action: [
                { do: "mode", action: "setRouteMode", mode: "draw", label: "Draw" },
                { do: "set", field: '[data-region="editToolbar"] select[name="activeRouteQuickStyle"]', value: "Trunk road", label: "Style" },
                { do: "frame", rect: HILLS, label: "Zoom in on the Red Hills." },
                ...ROAD.map((at) => ({ do: "mapClick", at, label: "Click a waypoint." })),
                FINISH,
                { do: "expect", check: (studio) => studio.mapRoutes.some((route) => !route.generated && route.transport === "road") || "no road of your own", within: 60000 },
            ],
            screenshot: { name: "road", region: { map: HILLS }, mapOnly: true },
            caption: "The new road, found over the terrain between its three waypoints.",
            note: "Drag instead of clicking to trace a stretch: when you let go, the stroke's bends become waypoints. Backspace, Ctrl+Z or **Undo** takes the last click back while you draw.",
            narration: "Choose Draw, set the style to Trunk road, and click three towns through the Red Hills. The road between them is drawn based on the terrain, finding the easiest way between them. Press Enter to finish.",
            pause: 4,
        },
        {
            id: "name",
            title: "Name it",
            instruction: "In the inspector, change **Name** to `The King's Road` and press Enter.",
            action: [
                { do: "set", field: 'dialog.fwmb-inspector[open] input[name="routeName"]', value: "The King's Road", commit: "Enter", label: "Name" },
                { do: "expect", check: (studio) => studio.mapRoutes.some((route) => route.name === "The King's Road") || "no route named The King's Road", within: 30000 },
            ],
            screenshot: { name: "inspector", region: "inspector" },
            caption: "The King's Road in the route inspector.",
            narration: "Now let's name it The King's Road.",
        },
        {
            id: "waypoint",
            title: "Move a waypoint",
            instruction: "Choose **Waypoints** on the bar (in **More** on a narrow bar). The road's waypoints show as handles. Drag the middle one, at Mostadra, a little west: its two legs are found again as you move it.",
            action: [
                { do: "mode", action: "setRouteMode", mode: "edit", label: "Waypoints" },
                { do: "drag", from: ROAD[1], to: ROAD_MOVED, label: "Drag the middle waypoint west." },
            ],
            screenshot: { name: "waypoint", region: { map: HILLS }, mapOnly: true },
            caption: "The road after its middle waypoint was moved west.",
            note: "In Waypoints mode, Shift+Click a route to add a waypoint, Ctrl+Click a waypoint to remove it, and Alt+Click an inner waypoint to split the route in two there.",
            narration: "Choose Waypoints on the bar, and drag the middle waypoint west. The road finds its way again.",
            pause: 4,
        },
        {
            id: "sea-lane",
            title: "Draw a sea lane",
            instruction: "Click **Reset view**, choose **Draw**, set **Transport** to **Sea** and **Style** to **Sea lane**. Click the water off the east coast of the continent, south of the Red Hills, then the water off **Newcested**, Islemark's capital, and press Enter. A sea lane keeps to the water, rounding the coast. In the inspector, change **Name** to `The Islemark Crossing` and press Enter (a new route is called **Route** until you name it).",
            action: [
                { do: "camera", view: "fit" },
                { do: "mode", action: "setRouteMode", mode: "draw", label: "Draw" },
                { do: "set", field: '[data-region="editToolbar"] select[name="routeTransport"]', value: "sea", valueLabel: "Sea", label: "Transport" },
                { do: "set", field: '[data-region="editToolbar"] select[name="activeRouteQuickStyle"]', value: "Sea lane", label: "Style" },
                ...SEA_LANE.map((at) => ({ do: "mapClick", at, label: "Click a waypoint on the water." })),
                FINISH,
                { do: "expect", check: (studio) => studio.mapRoutes.some((route) => !route.generated && route.transport === "sea") || "no sea lane of your own", within: 60000 },
                { do: "set", field: 'dialog.fwmb-inspector[open] input[name="routeName"]', value: "The Islemark Crossing", commit: "Enter", label: "Name" },
                { do: "expect", check: (studio) => studio.mapRoutes.some((route) => route.name === "The Islemark Crossing") || "no route named The Islemark Crossing", within: 30000 },
                { do: "settle" },
                { do: "frame", rect: [1300, 700, 1560, 1060], label: "Zoom in to look at the sea lane." },
            ],
            screenshot: { name: "sea-lane", region: { map: [1300, 700, 1560, 1060] }, mapOnly: true },
            caption: "The Islemark Crossing, from the continent to Islemark.",
            narration: "Now we're going to add a sea lane. Set the transport to Sea and the style to Sea lane, and click the water off the coast, then off Islemark's capital. The lane keeps to the water. Name it The Islemark Crossing.",
            pause: 4,
        },
        {
            id: "save",
            title: "Stop and save",
            instruction: "Choose **Select** on the bar, close the inspector, and save the map.",
            action: [
                { do: "mode", action: "setRouteMode", mode: "select", label: "Select" },
                { do: "click", target: "dialog.fwmb-inspector[open] .fwmb-overlay-close", label: "Close on the inspector" },
                { do: "click", target: '.fwmb-rail-btn[data-action="saveMap"]', label: "Save map" },
                { do: "expect", check: (studio) => !studio.isDirty || "the map was not saved", within: 30000 },
            ],
            narration: "Stop drawing and save. Next, we're going to look at places and their names.",
        },
    ],

    whatYouSee: "A trunk road, The King's Road, from Kansmarda north through the Red Hills to Stansto, bending west where you moved its waypoint, and a sea lane, The Islemark Crossing, from the continent's east coast to Newcested on Islemark.",
    foundry: "Everything on this page is the same in Foundry.",
    onYourOwn: `Route names are placed after the names of places and regions, so on a crowded map a route's name may have no room and is left out; page 8 shows how to place one yourself. A road you draw near an existing road tends to join it rather than run beside it, which is usually what a road network wants; add a waypoint where it should keep its distance. **Span water** lets a road bridge a strait or river where going round would be longer. To restyle every road of a kind at once, change its route style in [[Styles and icons]]. The [[Travel]] tool times journeys along the map's routes, yours and the run's alike. See [[Routes and pins]] for every mode, the inspector and mass edit.`,
    related: ["Routes and pins", "Styles and icons", "Travel"],
};
