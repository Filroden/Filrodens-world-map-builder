/**
 * Filroden's World Map Builder - Grid Cell Lookup (example macro)
 *
 * Demonstrates how a macro, module, or game system can read the grid-cell exploration data FWMB
 * writes to a Scene at export time. See design/GRID-DATA-SCHEMA.md in the FWMB repository for the
 * full field reference - this macro only reads a handful of the available fields to keep the
 * example short; there's more in there (regions, infrastructure, bands) than what's shown here.
 *
 * This is a template, not a finished tool: it's meant to be copied into your own macro, module,
 * or system and adapted, not run unmodified as a real piece of game tooling. Paste this into a
 * new Foundry macro of type "Script" and run it with a Scene FWMB has exported open, and exactly
 * one token selected on it.
 *
 * What it does:
 *   1. Confirms the current Scene actually carries FWMB grid data, so it does nothing on a scene
 *      FWMB never exported (or exported before this feature existed, or exported gridless).
 *   2. Confirms exactly one token is selected - the lookup is "where is this token", so zero or
 *      several selected tokens is treated as a user error rather than guessed at.
 *   3. Converts that token's canvas position into the same {i, j} grid offset FWMB's data is
 *      keyed by, and looks up the matching cell.
 *   4. Posts a formatted table of that cell's data to chat, as that token's speaker.
 *
 * Note: gridData reflects the map as of its last FWMB export. If the GM has changed the grid size
 * or regenerated the map in FWMB since exporting, re-export before trusting this data.
 */

// --- 1. The current Scene must carry FWMB grid data ---------------------------------------------

const FWMB_MODULE_ID = "filrodens-world-map-builder";
const FWMB_GRID_DATA_FLAG = "gridData";

const scene = canvas.scene;
const gridData = scene?.getFlag(FWMB_MODULE_ID, FWMB_GRID_DATA_FLAG);

if (!gridData) {
    ui.notifications.warn(`"${scene?.name ?? "This scene"}" has no Filroden's World Map Builder grid data. Export the map from FWMB with a grid enabled, then try again.`);
    return;
}

// --- 2. Exactly one token must be selected -------------------------------------------------------

const selectedTokens = canvas.tokens.controlled;

if (selectedTokens.length === 0) {
    ui.notifications.warn("Select a token first.");
    return;
}
if (selectedTokens.length > 1) {
    ui.notifications.warn("Select only one token.");
    return;
}

const token = selectedTokens[0];

// --- 3. Resolve the token's grid cell --------------------------------------------------------------

// canvas.grid is the Scene's own live Grid instance - the same {i, j} offset system gridData's
// cells are keyed by, whatever the grid's shape (square or either hex orientation).
const offset = canvas.grid.getOffset(token.center);
const cellKey = `${offset.i},${offset.j}`;
const cell = gridData.cells[cellKey];

if (!cell) {
    ui.notifications.warn(`${token.document.name} is at grid cell ${cellKey}, which has no data (outside the map's grid bounds).`);
    return;
}

// --- 4. Build and post the chat table ----------------------------------------------------------

const formatVisibility = (visibility) => (visibility === "gm" ? "GM only" : "All players");

// Every list field (regions, pins, routes) follows the same shape: an array that's empty when
// nothing overlaps the cell, so one small helper renders all three consistently.
const formatEntityList = (entities, describe) => (entities.length ? entities.map(describe).join("<br>") : "—");

const regionsHtml = formatEntityList(cell.regions, (region) => `${region.name} <i>(${region.layer.name}, ${Math.round(region.coverage * 100)}% of cell, ${formatVisibility(region.visibility)})</i>`);
const pinsHtml = formatEntityList(cell.infrastructure.pins, (pin) => `${pin.name} <i>(${pin.icon}, ${formatVisibility(pin.visibility)})</i>`);
const routesHtml = formatEntityList(cell.infrastructure.routes, (route) => `${route.name} <i>(${formatVisibility(route.visibility)})</i>`);
// Only named (hand-drawn) rivers show up here - a procedural river traced automatically from a
// spring pin is never named, so it's only ever reflected in the "Has river" row above.
const riversHtml = formatEntityList(cell.rivers, (river) => river.name);

const rows = [
    ["Grid cell", `{ i: ${offset.i}, j: ${offset.j} }`],
    ["Biome", cell.biome.code ? `${cell.biome.name} (${cell.biome.code})` : cell.biome.name],
    ["Terrain", cell.terrainBand],
    ["Moisture", cell.moistureBand],
    ["Temperature", cell.temperatureBand],
    ["Has river", cell.hasRiver ? "Yes" : "No"],
    ["Named rivers", riversHtml],
    ["Coastal", cell.isCoastal ? "Yes" : "No"],
    ["Regions", regionsHtml],
    ["Points of interest", pinsHtml],
    ["Routes", routesHtml],
];

const tableRows = rows.map(([label, value]) => `<tr><td style="font-weight: bold; padding: 2px 10px 2px 0; vertical-align: top; white-space: nowrap;">${label}</td><td style="padding: 2px 0;">${value}</td></tr>`).join("");

const content = `
    <div style="border: 1px solid #782e22; border-radius: 4px; padding: 4px 8px;">
        <h3 style="margin: 4px 0; border-bottom: 1px groove #782e22;">${token.document.name} — Grid Cell Data</h3>
        <table style="width: 100%; border-collapse: collapse;">${tableRows}</table>
    </div>
`;

ChatMessage.create({
    content,
    speaker: ChatMessage.getSpeaker({ token: token.document }),
});
