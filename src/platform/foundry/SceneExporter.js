import { FILRODENSWMB } from "../../config.js";
import { Sanitize } from "../../data/Sanitize.js";
import { GridDataExporter } from "../../applications/GridDataExporter.js";
import { MapStateManager } from "../../applications/MapStateManager.js";
import { GeneratedDetails } from "../../applications/GeneratedDetails.js";
import { cleanUnit, kmPerPxOf } from "../../data/MapUnit.js";

/**
 * A description as a journal page's HTML. Descriptions are plain text (typed into a textarea, or
 * brought in by an import), so every character is escaped and only line breaks become markup
 * (see Sanitize.textToHtml); markup typed into a description shows as the characters typed. The
 * result then goes through Foundry's own HTML cleaner as well, so the page holds nothing Foundry
 * would not allow even if a description reached here by some other route.
 * @param {string} [description]
 * @returns {string}
 */
function journalHtml(description) {
    return foundry.utils.cleanHTML(Sanitize.textToHtml(description ?? ""));
}

/** Significant figures kept in a scene's grid distance: enough for the ruler, without a long tail of digits. */
const GRID_DISTANCE_FIGURES = 3;

export class SceneExporter {
    /**
     * Executes the full asynchronous export pipeline. A failure is not reported here: it reaches
     * the caller (MapStudio's scene export), which logs it and shows its own localised message,
     * so no error text (which can carry a file or scene name) is ever put into a notification.
     */
    static async run(app, config, playerBlob, gmBlob) {
        const { sceneName, exportFolder, generateJournals, overwriteJournals, createGmOverlay } = config;
        const FilePickerV2 = foundry.applications.apps.FilePicker.implementation;

        // 1. Validate and Create Server Directory
        const targetPath = await this.#ensureDirectoryExists(exportFolder);

        // 2. Extract and Upload Player Background
        ui.notifications.info(game.i18n.localize("FILRODENSWMB.UI.ExportStepPlayer"));
        const playerFilename = `${sceneName.replace(/[^a-z0-9]/gi, "_").toLowerCase()}_player.png`;
        const playerFile = new File([playerBlob], playerFilename, { type: "image/png" });

        await FilePickerV2.upload("data", targetPath, playerFile);
        const playerImgPath = `${targetPath}/${playerFilename}`;

        let gmImgPath = null;

        // 3. Extract and Upload GM Overlay (If requested)
        if (createGmOverlay && gmBlob) {
            ui.notifications.info(game.i18n.localize("FILRODENSWMB.UI.ExportStepGm"));
            const gmFilename = `${sceneName.replace(/[^a-z0-9]/gi, "_").toLowerCase()}_gm.png`;
            const gmFile = new File([gmBlob], gmFilename, { type: "image/png" });

            await FilePickerV2.upload("data", targetPath, gmFile);
            gmImgPath = `${targetPath}/${gmFilename}`;
        }

        // 4. Generate Journals
        let journalObj = null;
        if (generateJournals) {
            ui.notifications.info(game.i18n.localize("FILRODENSWMB.UI.ExportStepJournals"));
            journalObj = await this.#createJournals(app, sceneName, overwriteJournals);
        }

        // 5. Construct the Scene
        ui.notifications.info(game.i18n.localize("FILRODENSWMB.UI.ExportStepScene"));
        await this.#createScene(app, sceneName, playerImgPath, gmImgPath, journalObj, this.sceneScale(config.scale));

        // The scene's name is the GM's own text: it goes in as a format value, which Foundry's
        // notifications escape
        ui.notifications.info("FILRODENSWMB.UI.ExportSceneDone", { format: { name: sceneName } });
    }

    /**
     * Safely checks if a directory exists in the active world data, and creates it if not.
     */
    static async #ensureDirectoryExists(folderName) {
        const basePath = `worlds/${game.world.id}/${folderName}`;
        const FilePickerV2 = foundry.applications.apps.FilePicker.implementation;

        try {
            await FilePickerV2.browse("data", basePath);
        } catch (err) {
            console.debug(`FWMB | Expected missing directory. Creating new at: ${basePath}`, err);

            await FilePickerV2.createDirectory("data", basePath);
            ui.notifications.info("FILRODENSWMB.UI.DirectoryCreated", { format: { path: basePath } });
        }
        return basePath;
    }

    static async #createJournals(app, sceneName, overwriteJournals) {
        const folderName = `${FILRODENSWMB.COMPENDIUM.LABEL}`;
        let folder = game.folders.find((f) => f.type === "JournalEntry" && f.name === folderName);
        if (!folder) {
            folder = await Folder.create({ name: folderName, type: "JournalEntry", color: "#1a4b84" });
        }

        let parentJournal = game.journal.getName(sceneName);
        if (parentJournal) {
            if (parentJournal.folder?.id !== folder.id) {
                await parentJournal.update({ folder: folder.id });
            }

            // Overwrite & Garbage Collection
            if (overwriteJournals) {
                const allPageIds = parentJournal.pages.map((p) => p.id);
                if (allPageIds.length > 0) {
                    await parentJournal.deleteEmbeddedDocuments("JournalEntryPage", allPageIds);
                    console.debug(`FWMB | Flushed ${allPageIds.length} old pages for a clean update.`);
                }
            }
        } else {
            parentJournal = await JournalEntry.create({ name: sceneName, folder: folder.id });
        }

        const syncJournalPage = async (mapElement, defaultName, text) => {
            const pageData = {
                name: mapElement.name || defaultName,
                type: "text",
                text: {
                    content: journalHtml(text),
                    format: 1,
                },
            };

            // 1. UPDATE PATH
            if (mapElement.journalPageId) {
                const existingPage = parentJournal.pages.get(mapElement.journalPageId);

                if (existingPage) {
                    if (overwriteJournals) {
                        try {
                            await existingPage.update(pageData);
                            console.log(`FWMB | SUCCESS: Overwrote journal page: ${existingPage.name}`);
                        } catch (err) {
                            console.error(`FWMB | DATABASE ERROR: Failed to overwrite ${existingPage.name}`, err);
                        }
                    } else {
                        console.log(`FWMB | SKIPPED: Overwrite disabled for page: ${existingPage.name}`);
                    }
                    return; // Early return for existing pages
                }
            }

            // 2. CREATION PATH (Page ID was missing, or the page was deleted)
            try {
                const newPage = await JournalEntryPage.create(pageData, { parent: parentJournal });
                mapElement.journalPageId = newPage.id;
                console.log(`FWMB | SUCCESS: Created new journal page: ${newPage.name}`);
            } catch (err) {
                console.error(`FWMB | DATABASE ERROR: Failed to create page ${pageData.name}`, err);
            }
        };

        // The items that get a page: generated ones only where the map labels them (see GeneratedDetails)
        const pages = GeneratedDetails.journalPages(app);
        for (const { item, text } of pages.pins) {
            if (item.type === "spring" || item.type === "block_spring") continue;
            await syncJournalPage(item, game.i18n.localize("FILRODENSWMB.JOURNAL.UnnamedLocation"), text);
        }
        for (const { item, text } of pages.regions) await syncJournalPage(item, game.i18n.localize("FILRODENSWMB.JOURNAL.UnnamedRegion"), text);
        for (const { item, text } of pages.routes) await syncJournalPage(item, game.i18n.localize("FILRODENSWMB.JOURNAL.UnnamedRoute"), text);

        return parentJournal;
    }

    /**
     * The export's scale as a whole number from 1 (the scales offered are whole; see ExportScale).
     * @param {*} value
     * @returns {number}
     */
    static sceneScale(value) {
        const scale = Math.round(Number(value));
        return scale >= 1 ? scale : 1;
    }

    /**
     * Creates the Scene for the exported map, or updates the one of the same name from an earlier
     * export, then adds the GM overlay tile and a thumbnail, and finally shows it.
     * Each extra is optional: a failure in one is logged and the rest of the export carries on.
     *
     * The scene is the size of its images: the map's size times the export's scale, with the grid
     * scaled alike. Foundry fits a background to the scene's size, so a 2x image on a scene of the
     * map's own size would be shrunk back on screen and its names drawn no larger than at 1x; on a
     * 2x scene they are shown as the 2x PNG shows them. Every cell is the same cell of the map at
     * any scale (the grid data is keyed by cell, not by pixel), and measures the same ground.
     */
    static async #createScene(app, sceneName, bgPath, gmOverlayPath, journalObj, scale = 1) {
        const gridData = this.#buildGridData(app);
        const sceneData = this.#sceneData(app, sceneName, bgPath, gridData, scale);
        if (gridData) gridData.grid.size = sceneData.grid.size;

        const scene = await this.#saveScene(sceneName, sceneData, gridData, journalObj);
        if (!scene) return;

        this.#warnIfGridSizeChanged(scene, sceneData, gridData);
        if (gmOverlayPath) await this.#createGmOverlayTile(scene, sceneData, gmOverlayPath);
        await this.#updateThumbnail(scene);

        // Save the map payload so the new journalPageId links persist
        await app.saveCurrentMap();
        scene.view();
    }

    /**
     * Computes the grid-cell exploration data layer. This happens before the Scene document
     * exists, since it only needs the map's own generation buffers and grid settings, not a live
     * placed Scene. A failure here should not abort the whole export (the background, journals
     * and the Scene itself matter more), so it is logged and treated as "no grid data" rather
     * than thrown.
     *
     * @returns {object|null} The grid data, or null when there is none or it could not be built.
     */
    static #buildGridData(app) {
        try {
            ui.notifications.info(game.i18n.localize("FILRODENSWMB.UI.ExportStepGridData"));
            return GridDataExporter.build(app);
        } catch (err) {
            console.error("FWMB | Grid data export failed.", err);
            return null;
        }
    }

    /** The Scene document's data: the map as its background, its grid, and the grid data flag when there is grid data. */
    static #sceneData(app, sceneName, bgPath, gridData, scale = 1) {
        // Foundry's raw integer grid-type constants, shared with GridDataExporter so the Scene
        // document's own grid config and the exported grid-data payload always agree on which
        // numeric type a given uiState.gridType maps to.
        const mappedGridType = FILRODENSWMB.GRID_TYPES[app.uiState.gridType]?.value ?? 1;
        const gridSize = MapStateManager.gridSizeOf(app.uiState.gridSize);

        const sceneData = {
            name: sceneName,
            width: Math.round(app.mapWidth * scale),
            height: Math.round(app.mapHeight * scale),
            padding: 0,
            backgroundColor: "#222222",
            tokenVision: false,
            environment: {
                globalLight: { enabled: true },
            },
            grid: {
                type: mappedGridType,
                // The same size the grid data was built with (see MapStateManager.gridSizeOf)
                size: gridSize * scale,
                // What one cell measures in the map's own unit, so Foundry's ruler reads true (the
                // same at any export scale: a cell is the same piece of the map)
                ...this.gridScale(app, gridSize),
                color: "#000000",
                alpha: 0.4, // Fixed opacity to guarantee visibility in Foundry
            },
            levels: [
                {
                    _id: "defaultLevel0000",
                    name: "Level",
                    background: { src: bgPath },
                },
            ],
        };
        if (gridData) {
            sceneData.flags = { [FILRODENSWMB.ID]: { [FILRODENSWMB.FLAGS.GRID_DATA]: gridData } };
        }
        return sceneData;
    }

    /**
     * Updates the Scene of the same name from an earlier export (clearing what that export
     * added, see #clearPreviousExport), or creates a new one. If that fails, a bare Scene is
     * created instead so the export can still finish, unless one already existed.
     *
     * @returns {Promise<Scene|null>} The Scene to finish the export in.
     */
    static async #saveScene(sceneName, sceneData, gridData, journalObj) {
        let scene = game.scenes.getName(sceneName);
        try {
            if (scene) {
                ui.notifications.info(game.i18n.localize("FILRODENSWMB.UI.ExportStepSceneUpdate"));
                await scene.update(sceneData);
                await this.#clearPreviousExport(scene, gridData, journalObj);
            } else {
                scene = await Scene.create(sceneData);
            }
        } catch (err) {
            console.error("FWMB | Strict Scene creation/update failed.", err);
            if (!scene) scene = await Scene.create({ name: sceneName });
        }
        return scene;
    }

    /** Removes from a re-exported Scene what the previous export added and this one replaces. */
    static async #clearPreviousExport(scene, gridData, journalObj) {
        // A map switched to gridless since its last export would otherwise leave the previous
        // export's now-stale grid data flag behind, so clear it explicitly rather than only ever
        // adding or replacing it.
        if (!gridData && scene.getFlag(FILRODENSWMB.ID, FILRODENSWMB.FLAGS.GRID_DATA)) {
            await scene.unsetFlag(FILRODENSWMB.ID, FILRODENSWMB.FLAGS.GRID_DATA);
        }

        // Clear old module-specific embedded documents to prevent infinite stacking
        const oldTiles = scene.tiles.filter((t) => t.texture?.src?.includes("_gm.png")).map((t) => t.id);
        if (oldTiles.length > 0) await scene.deleteEmbeddedDocuments("Tile", oldTiles);

        // The scene gets no map notes (at map scale they cover the map, and a scene offers no
        // easy way to hide them); notes an earlier export made for this map's journal go, so a
        // re-export leaves the scene clear. The journal is reached through its own sidebar.
        if (!journalObj) return;
        const oldNotes = scene.notes.filter((n) => n.entryId === journalObj.id).map((n) => n.id);
        if (oldNotes.length > 0) await scene.deleteEmbeddedDocuments("Note", oldNotes);
    }

    /**
     * The grid data describes cells of the size sent; if Foundry stored a different grid, every
     * cell would be the wrong one, so say so rather than leave it silently wrong.
     */
    static #warnIfGridSizeChanged(scene, sceneData, gridData) {
        if (!gridData || scene.grid?.size === sceneData.grid.size) return;

        console.warn(`FWMB | The scene's grid is ${scene.grid?.size} px but its grid data was built for ${sceneData.grid.size} px cells; the grid data will not line up.`);
        ui.notifications.warn(game.i18n.localize("FILRODENSWMB.UI.GridDataSizeMismatch"));
    }

    /** Adds the GM overlay as a hidden, locked tile covering the whole scene. */
    static async #createGmOverlayTile(scene, sceneData, gmOverlayPath) {
        try {
            await scene.createEmbeddedDocuments("Tile", [
                {
                    texture: { src: gmOverlayPath },
                    width: sceneData.width,
                    height: sceneData.height,
                    x: sceneData.width / 2,
                    y: sceneData.height / 2,
                    hidden: true,
                    locked: true,
                },
            ]);
        } catch (err) {
            console.error("FWMB | Tile creation error:", err);
        }
    }

    /**
     * The ground one grid cell covers, as Foundry's grid distance and units: the cell's width at
     * the map's scale (see MapUnit.kmPerPxOf), to three significant figures, in the map's unit. A
     * regional map keeps its parent's grid size in pixels, so its cells measure less.
     *
     * @param {object} app - Reads uiState (latitudes, world, map unit) and mapHeight.
     * @param {number} gridSize - The grid's size in pixels.
     * @returns {{distance: number, units: string}|{}} Nothing when the scale cannot be worked out.
     */
    static gridScale(app, gridSize) {
        const distance = gridSize * kmPerPxOf(app.uiState, app.mapHeight);
        if (!(distance > 0) || !Number.isFinite(distance)) return {};
        return { distance: Number(distance.toPrecision(GRID_DISTANCE_FIGURES)), units: cleanUnit(app.uiState.mapUnit) };
    }

    /** Generates the Scene's thumbnail. It is only a convenience, so a failure is skipped quietly. */
    static async #updateThumbnail(scene) {
        try {
            ui.notifications.info(game.i18n.localize("FILRODENSWMB.UI.ExportStepThumbnail"));
            const thumbData = await scene.createThumbnail();
            if (thumbData?.thumb) {
                await scene.update({ thumb: thumbData.thumb });
            }
        } catch (err) {
            console.debug("FWMB | Background thumbnail generation skipped.", err);
        }
    }
}
