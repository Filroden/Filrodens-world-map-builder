import { FILRODENSWMB } from "./src/config.js";
import { registerSidebarInjection } from "./src/hooks/sidebar-injection.js";
import { initializeCompendium } from "./src/data/compendium.js";

Hooks.once("init", async () => {
    game.filrodenswmb = {
        config: FILRODENSWMB,
    };

    // Pre-load Handlebars partials so the UI can construct itself dynamically
    await foundry.applications.handlebars.loadTemplates([
        "modules/filrodens-world-map-builder/templates/toolbar.hbs",
        "modules/filrodens-world-map-builder/templates/context.hbs",
        "modules/filrodens-world-map-builder/templates/map.hbs",
        "modules/filrodens-world-map-builder/templates/tools-scene.hbs",
        "modules/filrodens-world-map-builder/templates/tools-terrain.hbs",
        "modules/filrodens-world-map-builder/templates/tools-features.hbs",
        "modules/filrodens-world-map-builder/templates/tools-biomes.hbs",
        "modules/filrodens-world-map-builder/templates/tools-infrastructure.hbs",
        "modules/filrodens-world-map-builder/templates/tools-regions.hbs",
        "modules/filrodens-world-map-builder/templates/tools-cartography.hbs",
        "modules/filrodens-world-map-builder/templates/tools-labels.hbs",
        "modules/filrodens-world-map-builder/templates/tools-reference.hbs",
        "modules/filrodens-world-map-builder/templates/tools-maps.hbs",
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
