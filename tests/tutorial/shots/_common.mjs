// What the wiki's shots files share: the tutorial's checkpoints by name, and the studio's controls
// they use most.

/** The tutorial's checkpoints (samples/tutorial), by what the map is at that point. */
export const MAP = Object.freeze({
    masks: "01-new-world",
    terrain: "04-rivers-and-faults",
    generated: "05-populating-the-world",
    regions: "06-realms-and-provinces",
    routes: "07-roads-and-sea-lanes",
    places: "08-places-and-labels",
    explored: "09-exploring-the-world",
    finished: "10-finishing-and-sharing",
    regional: "11-a-regional-map",
    sketch: "12-further-tips",
});

/** The open inspector, and the open modal dialogue. */
export const INSPECTOR = "dialog.fwmb-inspector[open]";
export const DIALOG = "dialog.fwmb-overlay-modal[open]";

/** A map controls button that opens a menu, by its name, and one that toggles a layer. */
export const menuButton = (name) => `.fwmb-map-btn[data-action="toggleLayerMenu"][aria-label^="${name}"]`;
export const layerButton = (layer) => `.fwmb-map-btn[data-action="toggleLayer"][data-layer="${layer}"]`;

/** A row of a long list (pins, routes, labels), by its name. */
export const listRow = (type, name) => `.fwmb-list-item[data-type="${type}"]:has(.fwmb-name:text-is("${name}"))`;

/** A row of the Regions tool's lists, by its name. */
export const regionRow = (kind, name) => `.fwmb-${kind}-row:has(:text-is("${name}"))`;

/** Closes an open menu. */
export const ESCAPE = { do: "key", key: "Escape" };

/** The Red Hills on the world map, and the east of the continent with Islemark. */
export const HILLS = [1000, 300, 1440, 760];
export const EAST = [1000, 300, 1700, 1100];

/** Exports the open map through Export to PNG at 1× into the temporary folder, as `file`. */
export const exportPng = (file) => [
    { do: "tool", tool: "export" },
    { do: "click", target: '[data-region="context"] [data-action="exportPng"]' },
    { do: "waitForDialog" },
    { do: "set", field: `${DIALOG} select[name="exportScale"]`, value: "1" },
    { do: "download", target: `${DIALOG} [data-overlay-action="ok"]`, file },
];
