import { FILRODENSHEX } from "../config.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class ManualEditorApp extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        id: "fhc-manual-editor",
        classes: ["fhc", "fhc-docked-toolbar"],
        position: { width: 280, height: "auto" },
        window: { title: "FILRODENSHEX.UI.ManualEditor", resizable: false },
        actions: {
            selectBiome: ManualEditorApp.#onSelectBiome,
        },
    };

    static PARTS = {
        palette: { template: "modules/filrodens-hex-crafter/templates/manual-editor.hbs" },
    };

    // This property holds the currently selected tool/biome for the canvas to read
    activeBiome = null;

    /**
     * Native AppV2 Hook: Prepares dynamic data for the Handlebars template.
     */
    async _prepareContext(options) {
        const biomes = Object.entries(FILRODENSHEX.BIOMES).map(([key, config]) => {
            const hexColor = "#" + config.color.toString(16).padStart(6, "0");
            const fallback = key.charAt(0).toUpperCase() + key.slice(1);

            const label = game.i18n.has(`FILRODENSHEX.Biomes.${key}`) ? game.i18n.localize(`FILRODENSHEX.Biomes.${key}`) : fallback;

            return { id: key, hexColor, label };
        });

        return { biomes };
    }

    static async #onSelectBiome(event, target) {
        // Flat guard clause
        const biomeId = target.dataset.biome;
        if (!biomeId) return;

        // Update the active state
        const app = game.filrodenshex.manualEditor;
        app.activeBiome = biomeId;

        // Visually highlight the selected button (Native DOM manipulation)
        const appElement = target.closest(".window-content");
        appElement.querySelectorAll("[data-action='selectBiome']").forEach((btn) => btn.classList.remove("active"));
        target.classList.add("active");

        console.log(`Hex Crafter | Paintbrush loaded with: ${biomeId}`);
    }

    _onClose(options) {
        // Clear the brush state when the window closes to prevent accidental painting
        this.activeBiome = null;

        const hcControl = ui.controls.controls?.hexCrafter;
        if (hcControl?.tools?.manualEditor?.active) {
            hcControl.tools.manualEditor.active = false;
            ui.controls.render();
        }
        super._onClose(options);
    }
}
