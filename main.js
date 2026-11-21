import { FILRODENSWMB } from "./src/config.js";
import { registerSidebarInjection } from "./src/hooks/sidebar-injection.js";
import { initializeCompendium } from "./src/platform/foundry/store.js";
import { registerPinIconSettings } from "./src/kernel/data/pinIcons.js";
import { registerExportFormatSettings } from "./src/kernel/export/ImageFormat.js";
import { attachTheme, registerThemeSettings } from "./src/shell/Theme.js";
import { registerModuleHelpers } from "./src/shell/templateHelpers.js";
import { Shell } from "./src/shell/Shell.js";
import { STUDIOS } from "./src/studios/index.js";

Hooks.once("init", async () => {
    game.filrodenswmb = {
        config: FILRODENSWMB,
    };

    // The colour theme is chosen in the studio's Appearance menu; <body> carries it so the tooltip
    // (which Foundry draws there) follows it too. The studio's window carries it as well.
    registerThemeSettings();
    attachTheme(document.body);

    registerPinIconSettings();
    registerExportFormatSettings();
    Shell.registerSettings(STUDIOS);

    // The module's own template helpers (a free-text field's maxlength), beside Foundry's
    registerModuleHelpers(Handlebars);

    // Pre-load Handlebars partials so the UI can construct itself dynamically
    await foundry.applications.handlebars.loadTemplates([
        // Every template drawn as a partial must be here (tests/ui/templates.test.mjs checks): the
        // studio's regions, the tools' panels, and the panel and bar parts
        "modules/filrodens-world-map-builder/templates/shell/context.hbs",
        "modules/filrodens-world-map-builder/templates/world/journal-summary.hbs",
        "modules/filrodens-world-map-builder/templates/world/world-summary.hbs",
        "modules/filrodens-world-map-builder/templates/world/map.hbs",
        "modules/filrodens-world-map-builder/templates/shell/studio.hbs",
        "modules/filrodens-world-map-builder/templates/shell/toolbar.hbs",
        "modules/filrodens-world-map-builder/templates/shell/worldbar.hbs",
        "modules/filrodens-world-map-builder/templates/world/tools-biomes.hbs",
        "modules/filrodens-world-map-builder/templates/world/tools-cartography.hbs",
        "modules/filrodens-world-map-builder/templates/world/tools-export.hbs",
        "modules/filrodens-world-map-builder/templates/world/tools-features.hbs",
        "modules/filrodens-world-map-builder/templates/world/tools-influences.hbs",
        "modules/filrodens-world-map-builder/templates/world/tools-infrastructure.hbs",
        "modules/filrodens-world-map-builder/templates/world/tools-labels.hbs",
        "modules/filrodens-world-map-builder/templates/world/tools-library.hbs",
        "modules/filrodens-world-map-builder/templates/world/tools-manage.hbs",
        "modules/filrodens-world-map-builder/templates/world/tools-reference.hbs",
        "modules/filrodens-world-map-builder/templates/world/tools-generate.hbs",
        "modules/filrodens-world-map-builder/templates/world/tools-history.hbs",
        "modules/filrodens-world-map-builder/templates/world/tools-travel.hbs",
        "modules/filrodens-world-map-builder/templates/world/tools-threeD.hbs",
        "modules/filrodens-world-map-builder/templates/world/tools-regions.hbs",
        "modules/filrodens-world-map-builder/templates/world/tools-scene.hbs",
        "modules/filrodens-world-map-builder/templates/world/tools-terrain.hbs",

        "modules/filrodens-world-map-builder/templates/world/dialogs/add-decoration.hbs",
        "modules/filrodens-world-map-builder/templates/world/dialogs/biome-rule-editor.hbs",
        "modules/filrodens-world-map-builder/templates/world/dialogs/culture-zones-editor.hbs",
        "modules/filrodens-world-map-builder/templates/world/dialogs/edit-pin-icon.hbs",
        "modules/filrodens-world-map-builder/templates/world/dialogs/export-settings.hbs",
        "modules/filrodens-world-map-builder/templates/world/dialogs/mass-edit.hbs",
        "modules/filrodens-world-map-builder/templates/world/dialogs/merge-region.hbs",
        "modules/filrodens-world-map-builder/templates/world/dialogs/move-to-political.hbs",
        "modules/filrodens-world-map-builder/templates/world/dialogs/name-all.hbs",
        "modules/filrodens-world-map-builder/templates/shell/dialogs/shortcuts.hbs",
        "modules/filrodens-world-map-builder/templates/shell/dialogs/export.hbs",
        "modules/filrodens-world-map-builder/templates/world/dialogs/terrain-upgrade.hbs",
        "modules/filrodens-world-map-builder/templates/world/dialogs/first-opening.hbs",
        "modules/filrodens-world-map-builder/templates/world/dialogs/generate-all.hbs",
        "modules/filrodens-world-map-builder/templates/world/dialogs/generate-guard.hbs",

        "modules/filrodens-world-map-builder/templates/shell/parts/bar-modes.hbs",
        "modules/filrodens-world-map-builder/templates/shell/parts/bar-pause.hbs",
        "modules/filrodens-world-map-builder/templates/shell/parts/bar-range.hbs",
        "modules/filrodens-world-map-builder/templates/shell/parts/bar-state.hbs",
        "modules/filrodens-world-map-builder/templates/shell/parts/edit-map-tools.hbs",
        "modules/filrodens-world-map-builder/templates/world/parts/face-fields.hbs",
        "modules/filrodens-world-map-builder/templates/world/parts/font-picker.hbs",
        "modules/filrodens-world-map-builder/templates/world/parts/inspector-culture.hbs",
        "modules/filrodens-world-map-builder/templates/world/parts/inspector-age.hbs",
        "modules/filrodens-world-map-builder/templates/world/parts/inspector-decoration.hbs",
        "modules/filrodens-world-map-builder/templates/world/parts/inspector-fault.hbs",
        "modules/filrodens-world-map-builder/templates/world/parts/inspector-help.hbs",
        "modules/filrodens-world-map-builder/templates/world/parts/inspector-label-style.hbs",
        "modules/filrodens-world-map-builder/templates/world/parts/inspector-label.hbs",
        "modules/filrodens-world-map-builder/templates/world/parts/inspector-land-mask.hbs",
        "modules/filrodens-world-map-builder/templates/world/parts/inspector-level.hbs",
        "modules/filrodens-world-map-builder/templates/world/parts/inspector-biome.hbs",
        "modules/filrodens-world-map-builder/templates/world/parts/inspector-biome-builtin.hbs",
        "modules/filrodens-world-map-builder/templates/world/parts/inspector-pin-style.hbs",
        "modules/filrodens-world-map-builder/templates/world/parts/inspector-pin.hbs",
        "modules/filrodens-world-map-builder/templates/world/parts/inspector-generated.hbs",
        "modules/filrodens-world-map-builder/templates/world/parts/inspector-region-style.hbs",
        "modules/filrodens-world-map-builder/templates/world/parts/inspector-region.hbs",
        "modules/filrodens-world-map-builder/templates/world/parts/inspector-river.hbs",
        "modules/filrodens-world-map-builder/templates/world/parts/inspector-route-style.hbs",
        "modules/filrodens-world-map-builder/templates/world/parts/inspector-route.hbs",
        "modules/filrodens-world-map-builder/templates/world/parts/inspector-set.hbs",
        "modules/filrodens-world-map-builder/templates/world/parts/inspector-world.hbs",
        "modules/filrodens-world-map-builder/templates/world/parts/inspector-world-map.hbs",
        "modules/filrodens-world-map-builder/templates/world/tools-manage-foot.hbs",
        "modules/filrodens-world-map-builder/templates/world/tools-scene-foot.hbs",
        "modules/filrodens-world-map-builder/templates/world/tools-manage-head.hbs",
        "modules/filrodens-world-map-builder/templates/world/tools-worldOverview.hbs",
        "modules/filrodens-world-map-builder/templates/world/tools-worldSetup.hbs",
        "modules/filrodens-world-map-builder/templates/world/tools-worldCut.hbs",
        "modules/filrodens-world-map-builder/templates/world/tools-worldCut-foot.hbs",
        "modules/filrodens-world-map-builder/templates/world/tools-worldBiomes.hbs",
        "modules/filrodens-world-map-builder/templates/world/tools-climate.hbs",
        "modules/filrodens-world-map-builder/templates/world/tools-worldCultures.hbs",
        "modules/filrodens-world-map-builder/templates/world/tools-worldAges.hbs",
        "modules/filrodens-world-map-builder/templates/world/parts/world-editor-head.hbs",
        "modules/filrodens-world-map-builder/templates/world/parts/label-fields.hbs",
        "modules/filrodens-world-map-builder/templates/world/parts/list-rows-label.hbs",
        "modules/filrodens-world-map-builder/templates/world/parts/list-rows-pin.hbs",
        "modules/filrodens-world-map-builder/templates/world/parts/list-rows-route.hbs",
        "modules/filrodens-world-map-builder/templates/shell/parts/list-query.hbs",
        "modules/filrodens-world-map-builder/templates/shell/parts/next.hbs",
        "modules/filrodens-world-map-builder/templates/shell/parts/panel-header.hbs",
        "modules/filrodens-world-map-builder/templates/shell/parts/page-head.hbs",
        "modules/filrodens-world-map-builder/templates/shell/parts/range-band.hbs",
        "modules/filrodens-world-map-builder/templates/shell/parts/section.hbs",
        "modules/filrodens-world-map-builder/templates/shell/parts/shared-range.hbs",
        "modules/filrodens-world-map-builder/templates/world/parts/state-block.hbs",
        "modules/filrodens-world-map-builder/templates/world/parts/style-picker.hbs",
        "modules/filrodens-world-map-builder/templates/world/parts/thematic-menu.hbs",
        "modules/filrodens-world-map-builder/templates/world/parts/toolbar-biomes.hbs",
        "modules/filrodens-world-map-builder/templates/world/parts/toolbar-cartography.hbs",
        "modules/filrodens-world-map-builder/templates/world/parts/toolbar-empty.hbs",
        "modules/filrodens-world-map-builder/templates/world/parts/toolbar-world.hbs",
        "modules/filrodens-world-map-builder/templates/world/parts/toolbar-unmade.hbs",
        "modules/filrodens-world-map-builder/templates/world/parts/toolbar-cut.hbs",
        "modules/filrodens-world-map-builder/templates/world/parts/world-cultures.hbs",
        "modules/filrodens-world-map-builder/templates/world/parts/world-ages.hbs",
        "modules/filrodens-world-map-builder/templates/world/parts/toolbar-features.hbs",
        "modules/filrodens-world-map-builder/templates/world/parts/toolbar-influences.hbs",
        "modules/filrodens-world-map-builder/templates/world/parts/toolbar-infrastructure.hbs",
        "modules/filrodens-world-map-builder/templates/world/parts/toolbar-labels.hbs",
        "modules/filrodens-world-map-builder/templates/world/parts/toolbar-regions.hbs",
        "modules/filrodens-world-map-builder/templates/world/parts/toolbar-scene.hbs",
        "modules/filrodens-world-map-builder/templates/world/parts/toolbar-shared-brush-size.hbs",
        "modules/filrodens-world-map-builder/templates/world/parts/toolbar-terrain.hbs",
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
    // Only the GM writes the compendiums: the studios prepare (saved maps made into worlds) for them
    if (game.user.isGM) await Shell.prepare(STUDIOS);
});
