import { FILRODENSHEX } from "../config.js";

const LEGEND_ID = "fwmb-legend";

/**
 * Constructs and injects the biome legend into the Foundry UI.
 */
export function drawLegend() {
    if (document.getElementById(LEGEND_ID)) return;

    const legend = document.createElement("div");
    legend.id = LEGEND_ID;

    // Add the core 'fhc' class so global CSS overrides (like scrollbars and fonts) apply automatically
    legend.className = "fwmb-legend-container fhc";
    legend.innerHTML = _buildLegendHTML();

    const uiRight = document.getElementById("ui-right");
    if (uiRight) {
        uiRight.appendChild(legend);
    } else {
        document.body.appendChild(legend);
    }
}

/**
 * Safely removes the legend from the DOM.
 */
export function clearLegend() {
    const legend = document.getElementById(LEGEND_ID);
    if (legend) legend.remove();
}

/**
 * Constructs the internal HTML structure for the legend.
 * * @returns {string} - The constructed HTML string.
 */
function _buildLegendHTML() {
    let html = `<h3 class="fwmb-legend-header">${game.i18n.localize("FILRODENSHEX.Legend.Title")}</h3>`;
    html += `<div class="fwmb-legend-biomes">`;

    for (const [key, config] of Object.entries(FILRODENSHEX.BIOMES)) {
        // Convert the PIXI numerical hex (e.g., 0x00FF00) to a standard CSS string (#00ff00)
        const hexColor = "#" + config.color.toString(16).padStart(6, "0");

        // Dynamic fallback string if the specific language key is missing
        const fallback = key.charAt(0).toUpperCase() + key.slice(1);
        const label = game.i18n.has(`FILRODENSHEX.Biomes.${key}`) ? game.i18n.localize(`FILRODENSHEX.Biomes.${key}`) : fallback;

        html += `
        <div class="fwmb-legend-row">
            <div class="fwmb-legend-swatch" style="background-color: ${hexColor};"></div>
            <span>${label}</span>
        </div>`;
    }

    html += `</div>`;
    return html;
}
