// The Export page: the panel, the Export image dialogue, and from Foundry (supplied) the scene dialogue.
import { MAP } from "./_common.mjs";

export default [
    {
        slug: "export-panel",
        start: MAP.regional,
        caption: "Export on the web, with its Image section. In Foundry the panel also has Foundry scene.",
        action: [{ do: "tool", tool: "export" }],
        screenshot: { region: "panel" },
    },
    {
        slug: "export-png-dialogue",
        start: MAP.regional,
        caption: "Export image on a regional map, with the recommended scale, the reason for it, and each format's estimated size.",
        action: [
            { do: "click", target: '[data-region="context"] [data-action="exportPng"]' },
            { do: "waitForDialog" },
            {
                do: "expect",
                check: () => [...document.querySelectorAll('dialog.fwmb-overlay-modal[open] select[name="exportFormat"] option')].every((option) => !option.dataset.estimating && !/working/i.test(option.textContent)),
                message: "every format's size was worked out",
                within: 60000,
            },
        ],
        settle: false,
        screenshot: { region: "dialog", pad: 8 },
        after: [{ do: "dialog", button: "cancel" }],
    },
    { slug: "export-scene-dialogue", provided: true, caption: "Export to scene in Foundry, with its default choices." },
];
