import { FILRODENSWMB } from "./src/config.js";
import { registerSidebarInjection } from "./src/hooks/sidebar-injection.js";
import { initializeCompendium } from "./src/data/compendium.js";

Hooks.once("init", async () => {
    game.filrodenswmb = {
        config: FILRODENSWMB,
    };

    // Pre-load Handlebars partials so the UI can construct itself dynamically
    await foundry.applications.handlebars.loadTemplates([
        "modules/filrodens-world-map-builder/templates/parts/toolbar.hbs",
        "modules/filrodens-world-map-builder/templates/parts/context.hbs",
        "modules/filrodens-world-map-builder/templates/parts/map.hbs",
        "modules/filrodens-world-map-builder/templates/parts/tools-terrain.hbs",
        "modules/filrodens-world-map-builder/templates/parts/tools-features.hbs",
        "modules/filrodens-world-map-builder/templates/parts/tools-biomes.hbs",
        "modules/filrodens-world-map-builder/templates/parts/tools-infrastructure.hbs",
        "modules/filrodens-world-map-builder/templates/parts/tools-regions.hbs",
        "modules/filrodens-world-map-builder/templates/parts/tools-maps.hbs",
        "modules/filrodens-world-map-builder/templates/parts/tools-settings.hbs",
    ]);

    registerSidebarInjection();
});

Hooks.once("ready", async () => {
    await initializeCompendium();
});
