import { FILRODENSWMB } from "./src/config.js";
import { registerSidebarInjection } from "./src/hooks/sidebar-injection.js";
import { initializeCompendium } from "./src/platform/foundry/store.js";
import { registerPinIconSettings } from "./src/data/pinIcons.js";
import { attachTheme, registerThemeSettings } from "./src/ui/Theme.js";
import { registerModuleHelpers } from "./src/ui/templateHelpers.js";

Hooks.once("init", async () => {
    game.filrodenswmb = {
        config: FILRODENSWMB,
    };

    // The colour theme is chosen in the studio's Appearance menu; <body> carries it so the tooltip
    // (which Foundry draws there) follows it too. The studio's window carries it as well.
    registerThemeSettings();
    attachTheme(document.body);

    registerPinIconSettings();

    // The module's own template helpers (a free-text field's maxlength), beside Foundry's
    registerModuleHelpers(Handlebars);

    // Pre-load Handlebars partials so the UI can construct itself dynamically
    await foundry.applications.handlebars.loadTemplates([
        // Every template drawn as a partial must be here (tests/ui/templates.test.mjs checks): the
        // studio's regions, the tools' panels, and the panel and bar parts
        "modules/filrodens-world-map-builder/templates/context.hbs",
        "modules/filrodens-world-map-builder/templates/journal-summary.hbs",
        "modules/filrodens-world-map-builder/templates/map.hbs",
        "modules/filrodens-world-map-builder/templates/studio.hbs",
        "modules/filrodens-world-map-builder/templates/toolbar.hbs",
        "modules/filrodens-world-map-builder/templates/tools-biomes.hbs",
        "modules/filrodens-world-map-builder/templates/tools-cartography.hbs",
        "modules/filrodens-world-map-builder/templates/tools-export.hbs",
        "modules/filrodens-world-map-builder/templates/tools-features.hbs",
        "modules/filrodens-world-map-builder/templates/tools-infrastructure.hbs",
        "modules/filrodens-world-map-builder/templates/tools-labels.hbs",
        "modules/filrodens-world-map-builder/templates/tools-library.hbs",
        "modules/filrodens-world-map-builder/templates/tools-manage.hbs",
        "modules/filrodens-world-map-builder/templates/tools-reference.hbs",
        "modules/filrodens-world-map-builder/templates/tools-generate.hbs",
        "modules/filrodens-world-map-builder/templates/tools-history.hbs",
        "modules/filrodens-world-map-builder/templates/tools-travel.hbs",
        "modules/filrodens-world-map-builder/templates/tools-regions.hbs",
        "modules/filrodens-world-map-builder/templates/tools-scene.hbs",
        "modules/filrodens-world-map-builder/templates/tools-terrain.hbs",

        "modules/filrodens-world-map-builder/templates/dialogs/add-decoration.hbs",
        "modules/filrodens-world-map-builder/templates/dialogs/biome-rule-editor.hbs",
        "modules/filrodens-world-map-builder/templates/dialogs/edit-biome.hbs",
        "modules/filrodens-world-map-builder/templates/dialogs/edit-pin-icon.hbs",
        "modules/filrodens-world-map-builder/templates/dialogs/export-scene.hbs",
        "modules/filrodens-world-map-builder/templates/dialogs/export-settings.hbs",
        "modules/filrodens-world-map-builder/templates/dialogs/mass-edit.hbs",
        "modules/filrodens-world-map-builder/templates/dialogs/merge-region.hbs",
        "modules/filrodens-world-map-builder/templates/dialogs/shortcuts.hbs",
        "modules/filrodens-world-map-builder/templates/dialogs/terrain-upgrade.hbs",

        "modules/filrodens-world-map-builder/templates/parts/bar-modes.hbs",
        "modules/filrodens-world-map-builder/templates/parts/bar-pause.hbs",
        "modules/filrodens-world-map-builder/templates/parts/bar-range.hbs",
        "modules/filrodens-world-map-builder/templates/parts/bar-state.hbs",
        "modules/filrodens-world-map-builder/templates/parts/edit-map-tools.hbs",
        "modules/filrodens-world-map-builder/templates/parts/face-fields.hbs",
        "modules/filrodens-world-map-builder/templates/parts/font-picker.hbs",
        "modules/filrodens-world-map-builder/templates/parts/inspector-culture.hbs",
        "modules/filrodens-world-map-builder/templates/parts/inspector-decoration.hbs",
        "modules/filrodens-world-map-builder/templates/parts/inspector-fault.hbs",
        "modules/filrodens-world-map-builder/templates/parts/inspector-help.hbs",
        "modules/filrodens-world-map-builder/templates/parts/inspector-label-style.hbs",
        "modules/filrodens-world-map-builder/templates/parts/inspector-label.hbs",
        "modules/filrodens-world-map-builder/templates/parts/inspector-land-mask.hbs",
        "modules/filrodens-world-map-builder/templates/parts/inspector-level.hbs",
        "modules/filrodens-world-map-builder/templates/parts/inspector-pin-style.hbs",
        "modules/filrodens-world-map-builder/templates/parts/inspector-pin.hbs",
        "modules/filrodens-world-map-builder/templates/parts/inspector-generated.hbs",
        "modules/filrodens-world-map-builder/templates/parts/inspector-region-style.hbs",
        "modules/filrodens-world-map-builder/templates/parts/inspector-region.hbs",
        "modules/filrodens-world-map-builder/templates/parts/inspector-river.hbs",
        "modules/filrodens-world-map-builder/templates/parts/inspector-route-style.hbs",
        "modules/filrodens-world-map-builder/templates/parts/inspector-route.hbs",
        "modules/filrodens-world-map-builder/templates/parts/inspector-set.hbs",
        "modules/filrodens-world-map-builder/templates/parts/label-fields.hbs",
        "modules/filrodens-world-map-builder/templates/parts/list-rows-label.hbs",
        "modules/filrodens-world-map-builder/templates/parts/list-rows-pin.hbs",
        "modules/filrodens-world-map-builder/templates/parts/list-rows-route.hbs",
        "modules/filrodens-world-map-builder/templates/parts/list-query.hbs",
        "modules/filrodens-world-map-builder/templates/parts/next.hbs",
        "modules/filrodens-world-map-builder/templates/parts/panel-header.hbs",
        "modules/filrodens-world-map-builder/templates/parts/range-band.hbs",
        "modules/filrodens-world-map-builder/templates/parts/section.hbs",
        "modules/filrodens-world-map-builder/templates/parts/shared-range.hbs",
        "modules/filrodens-world-map-builder/templates/parts/state-block.hbs",
        "modules/filrodens-world-map-builder/templates/parts/style-picker.hbs",
        "modules/filrodens-world-map-builder/templates/parts/thematic-menu.hbs",
        "modules/filrodens-world-map-builder/templates/parts/toolbar-biomes.hbs",
        "modules/filrodens-world-map-builder/templates/parts/toolbar-cartography.hbs",
        "modules/filrodens-world-map-builder/templates/parts/toolbar-empty.hbs",
        "modules/filrodens-world-map-builder/templates/parts/toolbar-features.hbs",
        "modules/filrodens-world-map-builder/templates/parts/toolbar-infrastructure.hbs",
        "modules/filrodens-world-map-builder/templates/parts/toolbar-labels.hbs",
        "modules/filrodens-world-map-builder/templates/parts/toolbar-regions.hbs",
        "modules/filrodens-world-map-builder/templates/parts/toolbar-scene.hbs",
        "modules/filrodens-world-map-builder/templates/parts/toolbar-shared-brush-size.hbs",
        "modules/filrodens-world-map-builder/templates/parts/toolbar-terrain.hbs",
    ]);

    // Enforce custom styling classes on tooltips generated by FWMB elements
    document.addEventListener(
        "pointerover",
        (event) => {
            const target = event.target.closest("[data-tooltip]");
            if (target?.closest(".fwmb")) {
                if (!Object.hasOwn(target.dataset, "tooltipClass")) {
                    target.dataset.tooltipClass = "fwmb-tooltip";
                }
            }
        },
        { capture: true, passive: true },
    );

    registerSidebarInjection();
});

Hooks.once("ready", async () => {
    await initializeCompendium();
});
