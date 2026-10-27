// The Maps page: saved maps with regional maps nested under their parent, the Restore from backup
// dialogue, and from Foundry (supplied) a saved map's journal.
import { MAP } from "./_common.mjs";

/** Cuts a regional map of a crop and names it (New map's Regional map section). */
const cut = (from, to, name) => [
    { do: "tool", tool: "scene" },
    { do: "openSection", section: "regionalMap" },
    { do: "set", field: 'input[name="regionalTargetWidth"]', value: 1600 },
    { do: "mode", action: "setSceneMode", mode: "crop" },
    { do: "drag", from, to },
    { do: "click", target: '[data-region="context"] [data-action="generateRegionalMap"]' },
    { do: "dialog", button: "ok", input: name },
    { do: "settle" },
];

export default [
    {
        slug: "maps-panel",
        start: MAP.finished,
        caption: "Maps, with two regional maps listed under the world they were cut from, and a map's actions menu open.",
        action: [
            ...cut([1040, 300], [1440, 740], "The Red Hills"),
            ...cut([1420, 940], [1760, 1260], "Islemark"),
            { do: "tool", tool: "manage" },
            { do: "click", target: '.fwmb-map-card:has(> .fwmb-map-card-info:text-is("Tutorial world")) .fwmb-dropdown > button' },
        ],
        settle: false,
        // The menu closes when focus leaves it, so the screenshot keeps it
        screenshot: { region: "panel", keepFocus: true, pointer: "keep" },
    },
    {
        slug: "restore-backup",
        start: MAP.finished,
        caption: "Restore from backup, listing the backup's maps; those already saved here are marked.",
        action: [
            { do: "key", key: "Escape" },
            { do: "download", target: '[data-region="context"] [data-action="backUpMaps"]', file: "fwmb-wiki-backup.zip" },
            { do: "chooseFile", target: '[data-region="context"] [data-action="restoreBackup"]', file: "tmp:fwmb-wiki-backup.zip" },
            { do: "waitForDialog" },
        ],
        settle: false,
        screenshot: { region: "dialog", pad: 8 },
        after: [{ do: "dialog", button: "cancel" }],
    },
    { slug: "maps-journal", provided: true, caption: "In Foundry, a saved map is a journal: its first page lists the settings it was made with." },
];
