// The Routes and pins page: the tool in Route mode, placing a pin, and a route's inspector.
import { INSPECTOR, MAP, listRow } from "./_common.mjs";

/** The Red Hills, where the King's Road runs. */
const HILLS = [1000, 300, 1440, 760];

export default [
    {
        slug: "routes-and-pins-overview",
        start: MAP.places,
        caption: "Routes and pins in Route mode: the Pins and Routes lists, the roads of the Red Hills, and the King's Road in the inspector.",
        action: [
            { do: "tool", tool: "infrastructure" },
            { do: "click", target: '[data-action="setInfraMode"][data-mode="route"]' },
            { do: "set", field: 'input[name="listSearch-route"]', value: "King" },
            { do: "click", target: listRow("route", "The King's Road") },
            { do: "frame", rect: HILLS },
        ],
        screenshot: { region: "studio" },
    },
    {
        slug: "routes-and-pins-route-inspector",
        start: MAP.places,
        caption: "The King's Road in Waypoints mode, its waypoints as handles, and its inspector with the Path, Line and Label groups.",
        action: [{ do: "mode", action: "setRouteMode", mode: "edit" }, { do: "frame", rect: HILLS }],
        screenshot: { region: "studio" },
    },
    {
        slug: "routes-and-pins-pin-place",
        start: MAP.places,
        caption: "Pin mode with Place chosen, the Pin style and Select icon on the bar, and a new Landmark open in the inspector.",
        action: [
            { do: "mode", action: "setRouteMode", mode: "select" },
            { do: "click", target: `${INSPECTOR} .fwmb-overlay-close` },
            { do: "click", target: '[data-action="setInfraMode"][data-mode="pin"]' },
            { do: "mode", action: "setPickMode", mode: "place" },
            { do: "set", field: '[data-region="editToolbar"] select[name="activePinStyle"]', value: "Landmark" },
            { do: "frame", rect: HILLS },
            { do: "mapClick", at: [1180, 560] },
        ],
        screenshot: { region: "studio" },
    },
];
