// The Reference image page: the sketch traced in the tutorial, under its map.
import { MAP } from "./_common.mjs";

export default [
    {
        slug: "reference-image-panel",
        start: MAP.sketch,
        caption: "Reference image, with the tutorial's sketch of Ashgrove at half opacity over its map.",
        action: [
            { do: "tool", tool: "reference" },
            { do: "chooseFile", target: '[data-region="context"] button[data-tooltip="Choose a file"]', file: "samples/tutorial/ashgrove-sketch.png" },
            { do: "camera", view: "fit" },
        ],
        screenshot: { region: "studio" },
    },
];
