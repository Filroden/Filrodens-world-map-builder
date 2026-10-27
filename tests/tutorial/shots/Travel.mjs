// The Travel page: by fast mount from a town on the King's Road, on the regional map.
import { ESCAPE, MAP, menuButton } from "./_common.mjs";

/** Mostadra and the next city, Kansmarda, on the regional map (in its pixels). */
const MOSTADRA = [904, 1206];
const KANSMARDA = [731, 1493];

export default [
    {
        slug: "travel-overview",
        start: MAP.regional,
        caption: "Travel on the regional map, by fast mount from Mostadra in 1-day bands with the region fills off, and the way to Kansmarda drawn to the pointer.",
        action: [
            { do: "tool", tool: "travel" },
            // Region fills tint the day bands, so they are switched off, as the Travel page advises
            { do: "click", target: menuButton("Regions") },
            { do: "click", target: '[data-action="toggleContentRow"][data-content-kind="fills"]' },
            ESCAPE,
            { do: "click", target: '[data-action="chooseTravelMode"][data-mode="mount"]' },
            { do: "set", field: 'select[name="travel.interval"]', value: "1" },
            { do: "mapClick", at: MOSTADRA },
            { do: "settle" },
            { do: "camera", view: "fit" },
            { do: "hover", at: KANSMARDA },
        ],
        screenshot: { region: "studio", pointer: KANSMARDA },
    },
];
