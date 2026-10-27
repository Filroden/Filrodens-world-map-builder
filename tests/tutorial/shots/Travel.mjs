// The Travel page: by wagon from a town on the King's Road, on the regional map.
import { MAP } from "./_common.mjs";

/** Mostadra and the next city, Kansmarda, on the regional map (in its pixels). */
const MOSTADRA = [904, 1206];
const KANSMARDA = [731, 1493];

export default [
    {
        slug: "travel-overview",
        start: MAP.regional,
        caption: "Travel on the regional map, by wagon from Mostadra in 1-day bands, with the way to Kansmarda drawn to the pointer.",
        action: [
            { do: "tool", tool: "travel" },
            { do: "click", target: '[data-action="chooseTravelMode"][data-mode="wagon"]' },
            { do: "set", field: 'select[name="travel.interval"]', value: "1" },
            { do: "mapClick", at: MOSTADRA },
            { do: "settle" },
            { do: "camera", view: "fit" },
            { do: "hover", at: KANSMARDA },
        ],
        screenshot: { region: "studio", pointer: KANSMARDA },
    },
];
