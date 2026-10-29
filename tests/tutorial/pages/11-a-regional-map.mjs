// Tutorial page 11: a regional map. Crops the Red Hills from the world map into a regional map at
// four times the detail, filled in with villages and market towns, opens it, and steps the Detail
// level down to Local to see what the fill-in added.

/** The crop: the Red Hills and the King's Road, from Stansto to Kansmarda. */
const CROP_FROM = [1040, 300];
const CROP_TO = [1440, 740];

/** The regional map's width in pixels: about four times the crop's. */
const TARGET_WIDTH = 1600;

/** What the regional map is called. */
const REGION_NAME = "The Red Hills";

/** The regional map's card in Maps. */
const card = (name) => `.fwmb-map-card:has(> .fwmb-map-card-info:text-is("${name}"))`;

/** A close-up on the regional map round Mostadra and the King's Road (in the regional map's own pixels). */
const MOSTADRA_VIEW = [600, 900, 1200, 1400];

export default {
    number: 11,
    slug: "a-regional-map",
    title: "A regional map",
    start: "10-finishing-and-sharing",
    goal: "Cut a regional map of the Red Hills from the world map, fill it in with villages and market towns, and read it closely.",
    intro: `A world map shows a realm in a few hundred pixels. A **regional map** is a new map cut from part of another, at a higher resolution: the coastlines, terrain and biome borders gain finer detail, and everything on the parent comes with it (the realms, places, routes and names, your own and the run's). It keeps a copy of the parent's run over its area, so it can be **filled in** with the villages and market towns that lie between the parent's towns, joined to its roads by lanes.

Once made, a regional map is a map of its own: changing it doesn't change the world map, or the other way round.`,
    narration: "In this tutorial we're going to crop a regional map of the Red Hills from the world map, and fill it in with additional villages and market towns.",

    steps: [
        {
            id: "crop",
            title: "Draw the crop",
            instruction: "Click **New map** on the rail, open the panel's **Regional map** section and set **New resolution** to `1600` pixels wide. Choose **Crop** on the bar and drag on the map from north-west of Stansto to south-east of Kansmarda, round the Red Hills and the King's Road. When you let go, the crop is fitted to the map's grid at a whole zoom, here ×4: the new map shows the land four times as closely, and its height and latitudes follow from the crop. Tick **Fill in villages and market towns**.",
            action: [
                { do: "tool", tool: "scene", label: "New map" },
                { do: "openSection", section: "regionalMap", label: "Regional map" },
                { do: "set", field: 'input[name="regionalTargetWidth"]', value: TARGET_WIDTH, label: "Target width" },
                { do: "mode", action: "setSceneMode", mode: "crop", label: "Crop" },
                { do: "drag", from: CROP_FROM, to: CROP_TO, label: "Drag round the Red Hills." },
                { do: "set", field: 'input[name="regionalInfill"]', value: true, label: "Fill in villages and market towns" },
            ],
            screenshot: { name: "crop", region: "studio" },
            caption: "The crop round the Red Hills, and the Regional map section.",
            note: "Drag inside the crop to move it, and drag a corner to resize it. **Fill in villages and market towns** can be ticked once the map has a run and the crop is small enough for the new map to show the world closely.",
            narration: "Open New map and set the new map's width. Choose Crop and drag around the Red Hills: the crop fits itself to the grid at four times the detail. Tick Fill in villages and market towns.",
            pause: 4,
        },
        {
            id: "create",
            title: "Create the regional map",
            instruction: "Click **Generate map**. Name the new map `The Red Hills` and click **Confirm**. The regional map is made and saved; the world map stays open.",
            action: [
                { do: "click", target: '[data-region="context"] [data-action="generateRegionalMap"]', label: "Generate map" },
                { do: "dialog", button: "ok", input: REGION_NAME, label: "Confirm" },
            ],
            note: "A regional map is made from the map as it is saved, so if the open map has changes you haven't saved, you are asked to save it first.",
            narration: "Click Generate map, and name it The Red Hills.",
        },
        {
            id: "open",
            title: "Open it",
            instruction: "Click **Maps** on the rail. **The Red Hills** is listed under **Tutorial world**, the map it was cut from. Click its **Load** button. The first time it opens, the studio fills it in, which takes a moment. The terrain, rivers and coast are drawn at four times the world map's detail, with the realms, the King's Road, Redwatch and the rest in place.",
            action: [
                { do: "tool", tool: "manage", label: "Maps" },
                { do: "click", target: `${card(REGION_NAME)} [data-action="manageMap"][data-action-type="load"]`, label: "Load" },
                { do: "expect", check: (studio) => studio.currentSaveName === "The Red Hills" || `the open map is ${studio.currentSaveName}`, within: 180000 },
                { do: "settle" },
            ],
            screenshot: { name: "region", region: "studio" },
            caption: "The Red Hills, a regional map at four times the world map's detail.",
            narration: "Open it from Maps, where it's listed under the world it came from. The terrain is the same as the world map but is now drawn in far more detail.",
            pause: 4,
        },
        {
            id: "local",
            title: "See the villages",
            instruction: "Open the **Detail** menu in the map controls and choose **Local**. The market towns the fill-in added are shown, and its villages of 1,000 people or more, joined to the roads by lanes; the smaller villages show at **Everything**. Zoom in round Mostadra and the King's Road to see them.",
            action: [
                { do: "click", target: '[data-layer-group="detail"] > .fwmb-map-btn', label: "Detail in the map controls" },
                { do: "click", target: '[data-action="setDetailLevel"][data-detail-level="3"]', label: "Local" },
                { do: "settle" },
                { do: "frame", rect: MOSTADRA_VIEW, label: "Zoom in round Mostadra." },
            ],
            screenshot: { name: "villages", region: { map: MOSTADRA_VIEW }, mapOnly: true },
            caption: "Villages, market towns and lanes round Mostadra at the Local detail level.",
            note: "Each map keeps its own Detail level, so the world map is still at Province.",
            narration: "Set the Detail level to Local. The villages and market towns that were filled-in will appear, joined to the roads by lanes.",
            pause: 4,
        },
        {
            id: "fill-in",
            title: "Read the fill-in",
            instruction: "Click **Generate** on the rail. On a regional map its **Fill in** section counts the market towns, villages and lanes the last fill-in added. **Fill in again** replaces them, keeping any you have edited or locked; what the map inherited from the world map is never touched. The new places share out the people the world map's run put here, so filling in never adds people.",
            action: [
                { do: "tool", tool: "generate", label: "Generate" },
                { do: "openSection", section: "generateInfill", label: "Fill in" },
            ],
            screenshot: { name: "fill-in", region: { selector: 'details.fwmb-section[data-section="generateInfill"]' }, pad: 8 },
            caption: "The Fill in section, with what the fill-in added.",
            narration: "The Generate tool's Fill in section counts what the fill-in added, and can fill in again.",
            pause: 3,
        },
        {
            id: "save",
            title: "Save",
            instruction: "Save the regional map.",
            action: [
                { do: "click", target: '.fwmb-rail-btn[data-action="saveMap"]', label: "Save map" },
                { do: "expect", check: (studio) => !studio.isDirty || "the map was not saved", within: 30000 },
            ],
            narration: "Save it. Next, some tips for working on your own maps.",
        },
    ],

    whatYouSee: "A regional map, The Red Hills, listed under Tutorial world in Maps, at the Local detail level, with villages, market towns and lanes between the towns of the world map.",
    foundry: "Everything on this page is the same in Foundry. A regional map exports to a scene as any map does, with its grid lined up with the world map's: each world map cell becomes four by four cells of the regional map, each measuring a quarter of the distance.",
    onYourOwn: `Cut a regional map wherever your players are about to go: a realm, a valley, an island. Draw the crop close for a map of villages and lanes, or wider for a province. Make your changes to the world map first (a regional map is a copy, and doesn't follow later changes to its parent), and save it. A regional map can be cut again from a regional map, for a town's surroundings. The [[Travel]] tool on a regional map uses finer cells, so 1-day bands show a day's march from a town. See [[New map]] (regional maps) and [[Generate]] (fill in).`,
    related: ["New map", "Generate", "Maps", "Travel"],
};
