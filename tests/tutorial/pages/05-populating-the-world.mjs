// Tutorial page 5: populating the world. Adds two cultures (Hillfolk on the uplands of the north,
// Valefolk on the lowlands of the south), gives the map two ages with the Hillfolk invading in the
// present one, and runs Generate: realms, duchies, counties, towns, castles, roads, river trade,
// sea lanes, ruins and names. The rest of the tutorial edits and adds to what this run makes.

/** Where each culture starts from. */
const HILLFOLK_HOME = [950, 330];
const VALEFOLK_HOME = [850, 1050];

/** Adds a culture through the Cultures section's naming row, and sets its name style, colour, height band and homeland. */
function culture({ name, nameStyle, colour, band, upToTop, homeland }) {
    return [
        { do: "click", target: '[data-action="addCulture"]', label: "+ Culture" },
        { do: "set", field: "[data-culture-naming]", value: name, commit: "Enter", label: "the new culture's name" },
        { do: "set", field: 'dialog[open] select[name="cultureNameBase"]', value: nameStyle, label: "Name style" },
        { do: "set", field: 'dialog[open] input[name="cultureColor"]', value: colour, label: "Colour" },
        { do: "click", target: `dialog[open] [data-band-zone]:text-is("${band}")`, label: band },
        ...(upToTop ? [{ do: "slide", handle: 'dialog[open] [role="slider"][aria-label="Height, to"]', to: 1, label: "Drag Height's right-hand handle to the end." }] : []),
        { do: "click", target: 'dialog[open] [data-inspector-action="addHomeland"]', label: "Add homeland" },
        { do: "mapClick", at: homeland, label: `Click the map to place ${name}'s homeland.` },
    ];
}

export default {
    number: 5,
    slug: "populating-the-world",
    title: "Populating the world",
    start: "04-rivers-and-faults",
    goal: "Give the world two peoples and a history, and let Generate settle it: towns, castles, roads, sea lanes, realms, duchies and counties, all named.",
    intro: `With the land finished, the **Generate** tool works out where people would live on it and populates the whole map in one run. It reads the land you have shaped (the height and ruggedness of the ground, the climate, the biomes, the rivers and the coast), founds towns where the land can feed them, traces the trade between them, and divides the land into realms. Everything it makes is ordinary map content, which the next pages edit and add to by hand.`,
    narration: "In this tutorial we're going to populate the world: give it two cultures, a short history, and one run of the generator.",

    steps: [
        {
            id: "open",
            title: "Open Generate",
            instruction: "Click **Generate** on the rail, the first tool in the **Populate** group. Leave **Seed** empty: the run then uses the map's own seed, P0JBVA, so your run matches the tutorial's. **World** scales how many people the land feeds, how many live in towns, and how large realms and duchies grow; the tutorial keeps them at 1.",
            action: { do: "tool", tool: "generate", label: "Generate" },
            screenshot: { name: "generate", region: "studio" },
            caption: "The Generate tool before its first run.",
            narration: "Open Generate, the first tool in the Populate group. Leave the seed empty, so the run uses the map's own seed, and keep the World settings as they are.",
            pause: 3,
        },
        {
            id: "hillfolk",
            title: "The Hillfolk",
            instruction: `A map with no cultures has one people, everywhere. This world has two. Click **+ Culture** in the **Cultures** section, type \`Hillfolk\` and press Enter. The culture opens in the inspector:

- **Name style:** **Nordic**, the language their places are named in.
- **Colour:** \`#5b7fa6\`.
- **Habitat**, **Height:** click **Upland**, then drag the track's right-hand handle to the end: they suit the uplands and everything above.
- **Homelands:** click **Add homeland**, then click the uplands in the north of the continent, south-east of the snow-capped peaks. The culture spreads from there.`,
            action: culture({ name: "Hillfolk", nameStyle: "Nordic", colour: "#5b7fa6", band: "Upland", upToTop: true, homeland: HILLFOLK_HOME }),
            screenshot: { name: "hillfolk", region: "studio" },
            caption: "The Hillfolk in the culture inspector, with their homeland marked on the map.",
            narration: "This world has two cultures. Add a culture called Hillfolk with these settings: Nordic names, a slate-blue colour, the uplands and above, and place a homeland in the northern uplands.",
            pause: 4,
        },
        {
            id: "valefolk",
            title: "The Valefolk",
            instruction: "Add a second culture the same way: `Valefolk`, **Name style** **English**, **Colour** `#c9a227`, **Height** **Lowland**, and a homeland in the forests of the south of the continent. Then close the inspector.",
            action: [
                ...culture({ name: "Valefolk", nameStyle: "English", colour: "#c9a227", band: "Lowland", upToTop: false, homeland: VALEFOLK_HOME }),
                { do: "click", target: "dialog.fwmb-inspector[open] .fwmb-overlay-close", label: "Close on the inspector" },
                { do: "expect", check: (studio) => (studio.uiState.cultures ?? []).map((each) => each.name).join(", ") === "Hillfolk, Valefolk" || `the cultures are ${(studio.uiState.cultures ?? []).map((each) => each.name).join(", ")}` },
            ],
            narration: "Add a second culture, the Valefolk with these settings: English names, a golden colour, the lowlands, and a homeland in the southern forests.",
        },
        {
            id: "ages",
            title: "Two ages",
            instruction: "A run can pass through several ages, so the map has a history. In **Ages**, click **+ Age**: the map now has **Age 1** and **Age 2: the present**. Set Age 1's **Era** to **Early medieval** and its **Strife** to **Peaceful**, and the present's **Event** to **Hillfolk invade**: in the present age the Hillfolk come down from the hills and take land from the Valefolk.",
            action: [
                { do: "click", target: '[data-action="addAge"]', label: "+ Age" },
                { do: "set", field: 'select[name="generator.ages.0.era"]', value: "earlyMedieval", valueLabel: "Early medieval", label: "Age 1's Era" },
                { do: "set", field: 'select[name="generator.ages.0.strife"]', value: "peaceful", valueLabel: "Peaceful", label: "Age 1's Strife" },
                { do: "set", field: 'select[name="generator.ages.1.event"]', value: "Hillfolk invade", label: "the present's Event" },
            ],
            screenshot: { name: "ages", region: { selector: '[data-region="context"] details[data-section="generateAges"]' }, pad: 8 },
            caption: "Two ages: a peaceful early medieval age, then the present, with the Hillfolk invading.",
            note: "Each age starts from the one before: towns tend to grow where towns stood, and roads and realms carry on where they can. What the age before leaves behind (ruins, abandoned castles and old roads) appears on the map, and page 9 looks back at it.",
            narration: "Now give the world a history. Add a second age. Make the first age early medieval and peaceful, and in the present, add an event where the Hillfolk invade.",
            pause: 4,
        },
        {
            id: "generate",
            title: "Generate",
            instruction: "Click **Generate** at the top of the panel. The map is covered while the run works through its stages, age by age; it takes a few seconds to a minute, depending on your computer. When it finishes, the map has its realms, towns, castles and routes, all named.",
            action: [
                { do: "click", target: '[data-action="generateWorld"]', label: "Generate" },
                { do: "settle" },
                { do: "expect", check: (studio) => (studio.modelRun && studio.layerSets.some((set) => set.name === "Political")) || "the run made no Political set", within: 600000 },
            ],
            screenshot: { name: "generated", region: "studio" },
            caption: "The world after its run: realms coloured, duchies and counties outlined, towns, castles and roads named.",
            narration: "Click Generate. The run works through its stages, age by age, and the world is settled: realms, towns, castles and roads are all created and all except roads are named.",
            pause: 5,
        },
        {
            id: "detail",
            title: "Choose the detail",
            instruction: "A world map holds a lot. The **Detail** menu in the map controls (the first of the middle group) chooses how much is shown: **World** shows realms, capitals and cities; **Province** adds duchies and large towns; **Regional** counties and towns; **Local** and **Everything** the smallest places. Choose **Province**.",
            action: [
                { do: "click", target: '[data-layer-group="detail"] > [data-action="toggleLayerMenu"]', label: "Detail" },
                { do: "click", target: '[data-action="setDetailLevel"][data-detail-level="1"]', label: "Province" },
            ],
            screenshot: { name: "province", region: { map: [0, 0, 2000, 1600] }, mapOnly: true },
            caption: "The map at the Province detail level.",
            narration: "A world map holds a lot of information, so choose how much you want to show. The Detail menu in the map controls goes from World to Everything; pick Province which shows the realms, their duchies, and the larger towns.",
            pause: 4,
        },
        {
            id: "results",
            title: "Read the results",
            instruction: "Scroll to the foot of the panel. **Results** counts what the run left on the map (realms, duchies, counties, places of each kind, routes, ruins and old roads), its population, and each culture's share of it. The Hillfolk's invasion has given them more than half the people.",
            action: { do: "openSection", section: "generateResults", label: "Results" },
            screenshot: { name: "results", region: { selector: '[data-region="context"] details[data-section="generateResults"]' }, pad: 8 },
            caption: "The run's results.",
            narration: "The Results section counts everything the run made, and how the population is shared between the cultures.",
            pause: 4,
        },
        {
            id: "save",
            title: "Save",
            instruction: "Save the map. Everything the run made is ordinary map content: the next pages change and add to it with the other tools.",
            action: [
                { do: "click", target: '.fwmb-rail-btn[data-action="saveMap"]', label: "Save map" },
                { do: "expect", check: (studio) => !studio.isDirty || "the map was not saved", within: 30000 },
            ],
            narration: "Save the map. Next, we're going to customise the realms.",
        },
    ],

    whatYouSee: "The whole map divided into realms, with their duchies and counties, towns and castles across the land, roads between them, river trade along the rivers and sea lanes along the coasts. Names in the north are Nordic, the Hillfolk's; in the south, English, the Valefolk's.",
    foundry: "Everything on this page is the same in Foundry.",
    onYourOwn: `Shape the land first: the run reads it, and changing the terrain, climate or rivers afterwards marks the run out of date. Try a few seeds with the same settings: each gives a different but equally plausible world. When you generate again, anything you have edited or locked is kept and the rest is replaced, so lock the realms and towns you like before trying another seed. See [[Generate]] and [[Cultures]] for every setting, including the cultures' openness, density, coast and river preferences, and the **Output** switches that leave out duchies, counties, kinds of place or route.`,
    related: ["Generate", "Cultures", "Map Canvas"],
};
