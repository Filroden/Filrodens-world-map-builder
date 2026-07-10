import { FILRODENSWMB } from "./src/config.js";
import { registerSidebarInjection } from "./src/hooks/sidebar-injection.js";
import { initializeCompendium } from "./src/data/compendium.js";

Hooks.once("init", async () => {
    game.filrodenswmb = {
        config: FILRODENSWMB,
    };

    game.settings.register("filrodens-world-map-builder", "themeHue", {
        name: "FILRODENSWMB.Settings.ThemeHue.Name",
        hint: "FILRODENSWMB.Settings.ThemeHue.Hint",
        scope: "client",
        config: true,
        type: String,
        choices: {
            gold: "FILRODENSWMB.Settings.ThemeHue.Gold",
            teal: "FILRODENSWMB.Settings.ThemeHue.Teal",
        },
        default: "gold",
        onChange: (value) => applyThemeHue(value),
    });

    // Fetch the saved setting and apply the CSS class on startup
    const savedHue = game.settings.get("filrodens-world-map-builder", "themeHue");
    applyThemeHue(savedHue);

    // Pre-load Handlebars partials so the UI can construct itself dynamically
    await foundry.applications.handlebars.loadTemplates([
        "modules/filrodens-world-map-builder/templates/toolbar.hbs",
        "modules/filrodens-world-map-builder/templates/context.hbs",
        "modules/filrodens-world-map-builder/templates/tools-scene.hbs",
        "modules/filrodens-world-map-builder/templates/tools-terrain.hbs",
        "modules/filrodens-world-map-builder/templates/tools-features.hbs",
        "modules/filrodens-world-map-builder/templates/tools-biomes.hbs",
        "modules/filrodens-world-map-builder/templates/tools-infrastructure.hbs",
        "modules/filrodens-world-map-builder/templates/tools-regions.hbs",
        "modules/filrodens-world-map-builder/templates/tools-cartography.hbs",
        "modules/filrodens-world-map-builder/templates/tools-labels.hbs",
        "modules/filrodens-world-map-builder/templates/tools-reference.hbs",
        "modules/filrodens-world-map-builder/templates/tools-settings.hbs",
        "modules/filrodens-world-map-builder/templates/tools-manage.hbs",
        "modules/filrodens-world-map-builder/templates/journal-summary.hbs",
        "modules/filrodens-world-map-builder/templates/parts/edit-map-tools.hbs",
        "modules/filrodens-world-map-builder/templates/dialogs/edit-pins.hbs",
        "modules/filrodens-world-map-builder/templates/dialogs/edit-routes.hbs",
        "modules/filrodens-world-map-builder/templates/dialogs/edit-regions.hbs",
    ]);

    registerSidebarInjection();
});

Hooks.once("ready", async () => {
    await initializeCompendium();
});

/**
 * Applies the selected hue class to the Foundry document body.
 * @param {string} hue - The hue string ('gold' or 'teal').
 */
function applyThemeHue(hue) {
    document.body.classList.remove("fwmb-hue-gold", "fwmb-hue-teal");
    document.body.classList.add(`fwmb-hue-${hue}`);
}
