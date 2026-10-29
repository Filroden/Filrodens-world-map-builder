// Tutorial page 9: exploring the world. Reads the run's thematic layers (population, culture and
// trade), steps back to the world's first age in History with the culture layer on, and times a
// journey from Kansmarda to Newcested with Travel.

/** Mostadra and the land round it, where the population is read. */
const MOSTADRA_LAND = [1250, 625];

/** The Red Hills, where the culture is read. */
const HILLS_LAND = [1150, 500];

/** The journey's start and end: the capitals Kansmarda and Newcested. */
const KANSMARDA = [1222, 673];
const NEWCESTED = [1471, 1006];

/** The east of the continent and Islemark, for the trade close-up. */
const EAST = [1000, 300, 1700, 1100];

/** A button of the map controls, by its name, and an item of the menu it opens. */
const mapButton = (name) => `.fwmb-map-btn[data-action="toggleLayerMenu"][aria-label="${name}"]`;
const thematic = (layer) => `[data-action="setThematicFill"][data-thematic-layer="${layer}"]`;
const FILLS = '[data-action="toggleContentRow"][data-content-kind="fills"]';
const TRADE = '[data-action="toggleThematicLine"][data-thematic-line="trade"]';

/** Closes an open map controls menu. */
const CLOSE_MENU = { do: "key", key: "Escape", label: "Press Escape to close the menu." };

export default {
    number: 9,
    slug: "exploring-the-world",
    title: "Exploring the world",
    start: "08-places-and-labels",
    goal: "Read what the generator worked out about your world, see it as it was in an earlier age, and time a journey across it.",
    intro: `A run of **Generate** works out more than it places on the map: how many people live on every part of the land, which people they are, how much trade passes along each route, and what the world was like in each of its ages. The **thematic layers**, in the map controls, draw those figures over the map. The **History** and **Travel** tools, in the **Explore** stage of the rail, are for looking at a finished world: History shows it as it was in an earlier age, and Travel shows how long journeys take. None of them changes the map.`,
    narration: "In this tutorial we're going to explore the world the generator made: its people and trade, its history, and how long it takes to travel.",

    steps: [
        {
            id: "population",
            title: "Show the population",
            instruction: "In the map controls at the foot of the map, open the **Regions** menu and untick **Fills**, so the realms' colours don't tint what comes next. Then open the **Thematic layers** menu and choose **Population**. The land is coloured by how many people live on it, from the empty wilds (palest) to the crowded farmland round the cities (darkest red). Point at the land near Mostadra: the information bar reads the population there, and the legend marks it on its scale.",
            action: [
                { do: "click", target: mapButton("Regions"), label: "Regions in the map controls" },
                { do: "click", target: FILLS, label: "Fills" },
                CLOSE_MENU,
                { do: "click", target: mapButton("Thematic layers"), label: "Thematic layers in the map controls" },
                { do: "click", target: thematic("population"), label: "Population" },
                CLOSE_MENU,
                { do: "hover", at: MOSTADRA_LAND, label: "Point at the land near Mostadra." },
            ],
            screenshot: { name: "population", region: "studio", pointer: MOSTADRA_LAND },
            caption: "Population, with the information bar and the legend reading the land near Mostadra.",
            note: "**Capacity** shows how many people the land could feed, on the same scale, so where Capacity is darker than Population there is room for more. **Cleared land** and **Danger** show the farmland and the toll of raiding and strife. **Opacity**, at the foot of the menu, sets how strongly a layer covers the map.",
            narration: "Turn off the region fills, and show the Population layer. The darker the red, the more people live there. The information bar and the legend show the value under your mouse pointer.",
            pause: 4,
        },
        {
            id: "culture",
            title: "Show the peoples",
            instruction: "In the **Thematic layers** menu, choose **Culture**. Each part of the land takes the colour of the people most of its folk belong to: the Hillfolk's blue across the north, the west and the hills, the Valefolk's gold in the east and the south, paler where the two live together. Point at the Red Hills: the information bar names the people and their share.",
            action: [
                { do: "click", target: mapButton("Thematic layers"), label: "Thematic layers" },
                { do: "click", target: thematic("culture"), label: "Culture" },
                CLOSE_MENU,
                { do: "hover", at: HILLS_LAND, label: "Point at the Red Hills." },
            ],
            screenshot: { name: "culture", region: "studio", pointer: HILLS_LAND },
            caption: "Culture: the Hillfolk and the Valefolk, with the information bar reading the Red Hills.",
            narration: "Now choose Culture. The land takes the colour of its people: Hillfolk blue in the north, the west and the hills, Valefolk gold in the east and the south.",
            pause: 4,
        },
        {
            id: "trade",
            title: "Show the trade",
            instruction: "In the **Thematic layers** menu, tick **Trade**. The trade the run carried is drawn along its routes: the wider the line, the busier the route, and its colour shows how the goods travel (orange by road, green by river, purple by sea). Zoom in on the east of the continent to see the trade between the Red Hills, the coast and Islemark.",
            action: [
                { do: "click", target: mapButton("Thematic layers"), label: "Thematic layers" },
                { do: "click", target: TRADE, label: "Trade" },
                CLOSE_MENU,
                { do: "frame", rect: EAST, label: "Zoom in on the east of the continent." },
            ],
            screenshot: { name: "trade", region: { map: EAST }, mapOnly: true },
            caption: "Trade over the Culture layer: roads in orange, rivers in green, the sea in purple.",
            note: "Trade can be shown beside a colour layer, as here, or on its own with the colour layer set to **None**.",
            narration: "Tick Trade. The busier the route, the wider its line: orange by road, green by river, purple by sea.",
            pause: 4,
        },
        {
            id: "history",
            title: "Step back an age",
            instruction: "Untick **Trade** in the **Thematic layers** menu. Then click **Reset view**, and click **History** in the **Explore** stage of the rail. The world was made in two ages, and History opens on the first, **Age 1**, early medieval and peaceful: the map shows that age's realms, towns, roads and names, and the Culture layer shows its peoples. The whole land is Valefolk: the Hillfolk only arrive with their invasion in the present age.",
            action: [
                { do: "click", target: mapButton("Thematic layers"), label: "Thematic layers" },
                { do: "click", target: TRADE, label: "Trade" },
                CLOSE_MENU,
                { do: "camera", view: "fit" },
                { do: "tool", tool: "history", label: "History" },
                { do: "click", target: '[data-action="chooseHistoryAge"][data-age="1"]', label: "Age 1" },
            ],
            screenshot: { name: "age-1", region: "studio" },
            caption: "The world in Age 1, with its realms, places and peoples.",
            narration: "Open History. It shows the world in its first age: its original realms, towns and roads, and its peoples. In this age the whole land is Valefolk; the Hillfolk don't arrive until the second age.",
            pause: 4,
        },
        {
            id: "present",
            title: "Back to the present",
            instruction: "Click **Age 2: the present** in the **Ages** list, and compare: the invading Hillfolk now hold the north, the west and the hills. Scroll the panel down to **What changed**, which lists, since the age before, the realms that fell and rose, the places founded and lost, and each people's share of the land: the Hillfolk from none of it to 64%.",
            action: [{ do: "click", target: '[data-action="chooseHistoryAge"][data-age="2"]', label: "Age 2: the present" }],
            screenshot: { name: "what-changed", region: { union: ["map", { selector: 'details.fwmb-section:has(summary:has-text("What changed"))' }] } },
            caption: "The present, with what changed since Age 1.",
            note: "**Export to PNG** at the foot of the panel saves the map of the age shown, named with the age, so a set of images can tell your world's story.",
            narration: "Choose the present age and compare it. The Hillfolk invaded and now hold most of the land. What changed lists the realms that fell and rose, and how each people's share of the land grew or shrank.",
            pause: 4,
        },
        {
            id: "travel",
            title: "Time a journey",
            instruction: "Click **Travel** in the **Explore** stage of the rail; the first time, it takes a moment to work out the map's travel network. Choose **By wagon** under **Way of travel**, then click **Kansmarda** on the map to start the journey there. The land is coloured by the days it takes to reach, in bands of ten days, and a numbered line marks the edge of each band. Point at **Newcested** on Islemark: the way there is drawn on the map, by road to the coast and then by ship, and the information bar gives the time: a little over 33 days. A world map is large, and a wagon is slow.",
            action: [
                { do: "tool", tool: "travel", label: "Travel" },
                { do: "click", target: '[data-action="chooseTravelMode"][data-mode="wagon"]', label: "By wagon" },
                { do: "mapClick", at: KANSMARDA, label: "Click Kansmarda to start the journey." },
                { do: "expect", check: (studio) => !!studio.uiState.travel?.start || "no journey start", within: 60000 },
                { do: "hover", at: NEWCESTED, label: "Point at Newcested." },
            ],
            screenshot: { name: "journey", region: "studio", pointer: NEWCESTED },
            caption: "By wagon from Kansmarda: the day bands, and the way to Newcested.",
            note: "Try **On foot**: a wagon is quick on the roads and slow off them, so its bands stretch along the roads, while a walker's spread more evenly. While Travel is open, its day bands take the colour layer's place, and **Opacity** in the Thematic layers menu sets how strongly they cover the map.",
            narration: "Open Travel, choose By wagon, and click Kansmarda to start. The bands show the days to reach every part of the land. Point at Newcested, and the way is drawn: by road to the coast, and then by ship.",
            pause: 5,
        },
        {
            id: "save",
            title: "Tidy up and save",
            instruction: "Set the **Thematic layers** menu back to **None**, tick **Fills** again in the **Regions** menu, and save the map. The layers, the age you chose and the journey are saved with the map, so each opens where you left it.",
            action: [
                { do: "click", target: mapButton("Thematic layers"), label: "Thematic layers" },
                { do: "click", target: thematic("none"), label: "None" },
                CLOSE_MENU,
                { do: "click", target: mapButton("Regions"), label: "Regions" },
                { do: "click", target: FILLS, label: "Fills" },
                CLOSE_MENU,
                { do: "click", target: '.fwmb-rail-btn[data-action="saveMap"]', label: "Save map" },
                { do: "expect", check: (studio) => !studio.isDirty || "the map was not saved", within: 30000 },
            ],
            narration: "Turn the layers off and the region fills back on, and save. Next, we're going to finish the map and export it.",
        },
    ],

    whatYouSee: "The map as it was at the end of page 8, with the region fills on and no thematic layer. The Travel tool opens on the journey from Kansmarda by wagon.",
    foundry: "Everything on this page is the same in Foundry. A thematic layer that is on when the map is exported to a scene is drawn into the scene's image.",
    onYourOwn: `The thematic layers come from the last run, so generate again after big changes to the land (the Generate panel says when the map is out of date). For a world with history, give the run several ages and a culture event, then step through them in History with the Culture layer on, and export each age for your players. Use Travel to set the pace of a campaign: a 10-day band on a world map shows how long a realm takes to cross, a 1-day band on a regional map a day's march from a town. A road you draw counts at once, so Travel also shows what a new road would change. See [[Map Canvas]] (thematic layers), [[History]] and [[Travel]].`,
    related: ["Map Canvas", "History", "Travel", "Cultures"],
};
