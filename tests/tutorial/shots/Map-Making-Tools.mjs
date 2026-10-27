// The Map Making Tools page: the studio's frame, a panel, a bar, the inspector and mass edit.
import { DIALOG, INSPECTOR, MAP, listRow } from "./_common.mjs";

export default [
    {
        slug: "map-making-tools-studio",
        start: MAP.places,
        caption: "The studio: the rail (left), the Regions panel, the bar (top), the map, and the Red Hills in the inspector (right).",
        action: [
            { do: "tool", tool: "regions" },
            { do: "click", target: '.fwmb-set-row:has(:text-is("Lands"))' },
            { do: "click", target: '.fwmb-region-row:has(:text-is("The Red Hills"))' },
            { do: "camera", view: "fit" },
        ],
        screenshot: { region: "studio" },
    },
    {
        slug: "map-making-tools-panel",
        start: MAP.terrain,
        caption: "A panel: Terrain's header, its sections with their badges, the state block and Next.",
        action: [{ do: "tool", tool: "terrain" }],
        screenshot: { region: "panel" },
    },
    {
        slug: "map-making-tools-bar",
        start: MAP.routes,
        caption: "The Routes and pins bar in Route mode, while drawing.",
        action: [
            { do: "tool", tool: "infrastructure" },
            { do: "click", target: '[data-action="setInfraMode"][data-mode="route"]' },
            { do: "mode", action: "setRouteMode", mode: "draw" },
        ],
        screenshot: { region: "bar" },
    },
    {
        slug: "map-making-tools-inspector",
        start: MAP.routes,
        caption: "A route in the inspector: its header, then its Path, Line and Label groups.",
        action: [
            { do: "mode", action: "setRouteMode", mode: "select" },
            { do: "set", field: 'input[name="listSearch-route"]', value: "King" },
            { do: "click", target: listRow("route", "The King's Road") },
        ],
        screenshot: { region: "inspector" },
    },
    {
        slug: "map-making-tools-mass-edit",
        start: MAP.routes,
        caption: "Mass edit for three roads, with Thickness changed and its reset button beside it.",
        action: [
            { do: "click", target: `${INSPECTOR} .fwmb-overlay-close` },
            { do: "set", field: 'input[name="listSearch-route"]', value: "" },
            { do: "set", field: 'select[data-list-query="route"][data-query-field="kind"]', value: "road" },
            { do: "click", target: '[data-action="toggleMassEditMode"][data-type="route"]' },
            { do: "click", target: '[data-section] .fwmb-list-item[data-type="route"] >> nth=0 >> input[type="checkbox"]' },
            { do: "click", target: '[data-section] .fwmb-list-item[data-type="route"] >> nth=1 >> input[type="checkbox"]' },
            { do: "click", target: '[data-section] .fwmb-list-item[data-type="route"] >> nth=2 >> input[type="checkbox"]' },
            { do: "click", target: '[data-action="openMassEdit"][data-type="route"]' },
            { do: "waitForDialog" },
            { do: "set", field: `${DIALOG} input[name="item.thickness"]`, value: 2.5 },
        ],
        settle: false,
        screenshot: { region: "dialog", pad: 8 },
        after: [{ do: "dialog", button: "cancel" }],
    },
];
