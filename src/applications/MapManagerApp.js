import { getSavedMaps, saveCurrentMap, loadMapData } from "../data/compendium.js";
import { FILRODENSHEX } from "../config.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class MapManagerApp extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        id: "fhc-map-manager",
        classes: ["fhc", "fhc-docked-toolbar"],
        position: {
            width: 320,
            height: "auto",
        },
        window: {
            title: "FILRODENSHEX.UI.MapManager",
            resizable: false,
        },
        actions: {
            saveMap: MapManagerApp.#onSaveMap,
            loadMap: MapManagerApp.#onLoadMap,
            deleteMap: MapManagerApp.#onDeleteMap,
        },
    };

    static PARTS = {
        manager: {
            template: "modules/filrodens-hex-crafter/templates/map-manager.hbs",
        },
    };

    /**
     * Native AppV2 Hook: Prepares data for the Handlebars template.
     */
    async _prepareContext(options) {
        const maps = await getSavedMaps();
        return { maps };
    }

    static async #onSaveMap(event, target) {
        const appElement = target.closest(".window-content");
        const nameInput = appElement.querySelector("#fhc-save-name");
        const mapName = nameInput?.value || "New Map";

        await saveCurrentMap(mapName);

        // Re-render the application to instantly update the list
        game.filrodenshex.mapManager.render({ force: true });

        if (nameInput) nameInput.value = ""; // Clear the input natively
        ui.notifications.info(game.i18n.format("FILRODENSHEX.Notifications.MapSaved", { name: mapName }));
    }

    static async #onLoadMap(event, target) {
        const documentId = target.dataset.id;
        if (!documentId) return;

        // mapData now contains both .hexData and .generationParams
        const mapData = await loadMapData(documentId);
        if (!mapData?.[FILRODENSHEX.FLAGS.HEX_DATA]) {
            ui.notifications.error(game.i18n.localize("FILRODENSHEX.Notifications.LoadFailed"));
            return;
        }

        // 1. Mutate the Scene Database with both datasets natively
        await canvas.scene.update({
            [`flags.${FILRODENSHEX.ID}`]: mapData,
        });

        // 2. Instruct the layer to render the newly loaded map
        canvas.hexCrafter.renderTerrain(mapData[FILRODENSHEX.FLAGS.HEX_DATA]);

        // 3. UX: If the Terrain Generator UI is currently open, force it to redraw
        // to instantly display the loaded parameters.
        if (game.filrodenshex.terrainGenerator.rendered) {
            game.filrodenshex.terrainGenerator.render({ force: true });
        }

        ui.notifications.info(game.i18n.localize("FILRODENSHEX.Notifications.MapLoaded"));
    }

    static async #onDeleteMap(event, target) {
        const documentId = target.dataset.id;
        if (!documentId) return;

        const packName = `world.${FILRODENSHEX.COMPENDIUM.NAME}`;
        const pack = game.packs.get(packName);
        if (!pack) return;

        const document = await pack.getDocument(documentId);
        if (document) {
            await document.delete();
            game.filrodenshex.mapManager.render({ force: true });
        }
    }

    /**
     * Fires immediately before the window is destroyed.
     * Syncs the Scene Controls toggle state to prevent a visual mismatch.
     */
    _onClose(options) {
        // Safely traverse the V14 Record structure to locate our specific tool
        const hcControl = ui.controls.controls?.hexCrafter;

        if (hcControl?.tools?.mapManager?.active) {
            // Flip the state and force the left-hand toolbar to visually update
            hcControl.tools.mapManager.active = false;
            ui.controls.render();
        }

        // Execute the actual destruction of the window
        super._onClose(options);
    }
}
