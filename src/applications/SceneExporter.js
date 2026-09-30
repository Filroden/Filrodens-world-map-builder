import { FILRODENSWMB } from "../config.js";
import { resolvePinIconPath } from "../data/pinIcons.js";
import { GridDataExporter } from "./GridDataExporter.js";
import { MapStateManager } from "./MapStateManager.js";

// Map note icons are one fiftieth of the map's width, kept between 32 and 96 pixels
const NOTE_ICON_WIDTH_RATIO = 50;
const NOTE_ICON_MIN_PX = 32;
const NOTE_ICON_MAX_PX = 96;

export class SceneExporter {
    /**
     * Executes the full asynchronous export pipeline.
     */
    static async run(app, config, playerBlob, gmBlob) {
        const { sceneName, exportFolder, generateJournals, overwriteJournals, createGmOverlay } = config;
        const FilePickerV2 = foundry.applications.apps.FilePicker.implementation;

        try {
            // 1. Validate and Create Server Directory
            const targetPath = await this.#ensureDirectoryExists(exportFolder);

            // 2. Extract and Upload Player Background
            ui.notifications.info(`FWMB | Extracting Player View...`);
            const playerFilename = `${sceneName.replace(/[^a-z0-9]/gi, "_").toLowerCase()}_player.png`;
            const playerFile = new File([playerBlob], playerFilename, { type: "image/png" });

            await FilePickerV2.upload("data", targetPath, playerFile);
            const playerImgPath = `${targetPath}/${playerFilename}`;

            let gmImgPath = null;

            // 3. Extract and Upload GM Overlay (If requested)
            if (createGmOverlay && gmBlob) {
                ui.notifications.info(`FWMB | Extracting GM Overlay...`);
                const gmFilename = `${sceneName.replace(/[^a-z0-9]/gi, "_").toLowerCase()}_gm.png`;
                const gmFile = new File([gmBlob], gmFilename, { type: "image/png" });

                await FilePickerV2.upload("data", targetPath, gmFile);
                gmImgPath = `${targetPath}/${gmFilename}`;
            }

            // 4. Generate Journals & Notes
            let journalObj = null;
            if (generateJournals) {
                ui.notifications.info(`FWMB | Generating Journals...`);
                journalObj = await this.#createJournals(app, sceneName, overwriteJournals);
            }

            // 5. Construct the Scene
            ui.notifications.info(`FWMB | Constructing Scene...`);
            await this.#createScene(app, sceneName, playerImgPath, gmImgPath, journalObj);

            ui.notifications.info(`FWMB | Export Complete!`);
        } catch (error) {
            console.error("FWMB | Export Failed:", error);
            ui.notifications.error(`Scene export failed: ${error.message}`);
        }
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
            ui.notifications.info(game.i18n.format("FILRODENSWMB.UI.DirectoryCreated", { path: basePath }));
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

        const syncJournalPage = async (mapElement, defaultName) => {
            if (!mapElement.name && !mapElement.description) return;

            const pageData = {
                name: mapElement.name || defaultName,
                type: "text",
                text: {
                    content: mapElement.description || "",
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

        // Execute loops using the helper
        for (const pin of app.mapPins) {
            if (pin.type === "spring" || pin.type === "block_spring") continue;

            await syncJournalPage(pin, "Unnamed Location");
        }

        for (const layer of app.regionLayers) {
            for (const region of layer.regions) {
                await syncJournalPage(region, "Unnamed Region");
            }
        }

        return parentJournal;
    }

    /**
     * Creates the Scene for the exported map, or updates the one of the same name from an earlier
     * export, then adds the GM overlay tile, the map notes and a thumbnail, and finally shows it.
     * Each extra is optional: a failure in one is logged and the rest of the export carries on.
     */
    static async #createScene(app, sceneName, bgPath, gmOverlayPath, journalObj) {
        const gridData = this.#buildGridData(app);
        const sceneData = this.#sceneData(app, sceneName, bgPath, gridData);

        const scene = await this.#saveScene(sceneName, sceneData, gridData, journalObj);
        if (!scene) return;

        this.#warnIfGridSizeChanged(scene, sceneData, gridData);
        if (gmOverlayPath) await this.#createGmOverlayTile(app, scene, gmOverlayPath);
        if (journalObj) await this.#createMapNotes(app, scene, journalObj);
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
            ui.notifications.info(`FWMB | Calculating Grid Cell Data...`);
            return GridDataExporter.build(app);
        } catch (err) {
            console.error("FWMB | Grid data export failed.", err);
            return null;
        }
    }

    /** The Scene document's data: the map as its background, its grid, and the grid data flag when there is grid data. */
    static #sceneData(app, sceneName, bgPath, gridData) {
        // Foundry's raw integer grid-type constants, shared with GridDataExporter so the Scene
        // document's own grid config and the exported grid-data payload always agree on which
        // numeric type a given uiState.gridType maps to.
        const mappedGridType = FILRODENSWMB.GRID_TYPES[app.uiState.gridType]?.value ?? 1;

        const sceneData = {
            name: sceneName,
            width: app.mapWidth,
            height: app.mapHeight,
            padding: 0,
            backgroundColor: "#222222",
            tokenVision: false,
            environment: {
                globalLight: { enabled: true },
            },
            grid: {
                type: mappedGridType,
                // The same size the grid data was built with (see MapStateManager.gridSizeOf)
                size: MapStateManager.gridSizeOf(app.uiState.gridSize),
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
                ui.notifications.info(`FWMB | Updating existing Scene data...`);
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

    /** Adds the GM overlay as a hidden, locked tile covering the whole map. */
    static async #createGmOverlayTile(app, scene, gmOverlayPath) {
        try {
            await scene.createEmbeddedDocuments("Tile", [
                {
                    texture: { src: gmOverlayPath },
                    width: app.mapWidth,
                    height: app.mapHeight,
                    x: app.mapWidth / 2,
                    y: app.mapHeight / 2,
                    hidden: true,
                    locked: true,
                },
            ]);
        } catch (err) {
            console.error("FWMB | Tile creation error:", err);
        }
    }

    /** Adds a map note for every icon pin and region that has a journal page. */
    static async #createMapNotes(app, scene, journalObj) {
        try {
            // Scale note icons with the map's width, within fixed limits
            const iconSize = Math.max(NOTE_ICON_MIN_PX, Math.min(Math.round(app.mapWidth / NOTE_ICON_WIDTH_RATIO), NOTE_ICON_MAX_PX));

            const pinNotes = app.mapPins.filter((pin) => pin.icon && pin.journalPageId).map((pin) => this.#pinNote(pin, journalObj, iconSize));
            const regionNotes = app.regionLayers.flatMap((layer) => layer.regions.filter((region) => region.journalPageId && region.points?.length > 0).map((region) => this.#regionNote(region, journalObj, iconSize)));
            const noteData = [...pinNotes, ...regionNotes];

            if (noteData.length > 0) {
                await scene.createEmbeddedDocuments("Note", noteData);
            }
        } catch (err) {
            console.error("FWMB | Map Note creation error:", err);
        }
    }

    /** A map note on an icon pin, showing the pin's icon. */
    static #pinNote(pin, journalObj, iconSize) {
        return {
            entryId: journalObj.id,
            pageId: pin.journalPageId,
            x: pin.x,
            y: pin.y,
            iconSize,
            texture: { src: resolvePinIconPath(pin.icon) },
        };
    }

    /** A map note at the centre of a region's bounding box. */
    static #regionNote(region, journalObj, iconSize) {
        let minX = Infinity,
            maxX = -Infinity,
            minY = Infinity,
            maxY = -Infinity;
        for (const p of region.points) {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
        }

        return {
            entryId: journalObj.id,
            pageId: region.journalPageId,
            x: minX + (maxX - minX) / 2,
            y: minY + (maxY - minY) / 2,
            iconSize,
        };
    }

    /** Generates the Scene's thumbnail. It is only a convenience, so a failure is skipped quietly. */
    static async #updateThumbnail(scene) {
        try {
            ui.notifications.info(`FWMB | Generating Thumbnail...`);
            const thumbData = await scene.createThumbnail();
            if (thumbData?.thumb) {
                await scene.update({ thumb: thumbData.thumb });
            }
        } catch (err) {
            console.debug("FWMB | Background thumbnail generation skipped.", err);
        }
    }
}
