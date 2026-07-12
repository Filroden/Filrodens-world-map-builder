import { FILRODENSWMB } from "../config.js";

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

    static async #createScene(app, sceneName, bgPath, gmOverlayPath, journalObj) {
        // Map grid types to Foundry's raw integer constants for strict V14 compatibility
        const gridTypeMap = {
            square: 1, // SQUARE
            hexR: 2, // HEXODDRQ (Pointy top)
            hexC: 4, // HEXODDCQ (Flat top)
            none: 0, // GRIDLESS
        };
        const mappedGridType = gridTypeMap[app.uiState.gridType] ?? 1;

        // Base Scene Document Payload
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
                size: app.uiState.gridSize,
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

        // Safe Update vs Create
        let scene = game.scenes.getName(sceneName);
        try {
            if (scene) {
                ui.notifications.info(`FWMB | Updating existing Scene data...`);
                await scene.update(sceneData);

                // Clear old module-specific embedded documents to prevent infinite stacking
                const oldTiles = scene.tiles.filter((t) => t.texture?.src?.includes("_gm.png")).map((t) => t.id);
                if (oldTiles.length > 0) await scene.deleteEmbeddedDocuments("Tile", oldTiles);

                if (journalObj) {
                    const oldNotes = scene.notes.filter((n) => n.entryId === journalObj.id).map((n) => n.id);
                    if (oldNotes.length > 0) await scene.deleteEmbeddedDocuments("Note", oldNotes);
                }
            } else {
                scene = await Scene.create(sceneData);
            }
        } catch (err) {
            console.error("FWMB | Strict Scene creation/update failed.", err);
            if (!scene) scene = await Scene.create({ name: sceneName });
        }

        if (!scene) return;

        // Create the GM Overlay Tile (if requested)
        if (gmOverlayPath) {
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

        // Create Map Notes
        if (journalObj) {
            try {
                const noteData = [];

                app.mapPins.forEach((pin) => {
                    if (pin.icon && pin.journalPageId) {
                        noteData.push({
                            entryId: journalObj.id,
                            pageId: pin.journalPageId,
                            x: pin.x,
                            y: pin.y,
                            texture: { src: `modules/filrodens-world-map-builder/assets/pinhead-icons/${pin.icon}.svg` },
                        });
                    }
                });

                app.regionLayers.forEach((layer) => {
                    layer.regions.forEach((region) => {
                        if (!region.journalPageId || !region.points || region.points.length === 0) return;

                        let minX = Infinity,
                            maxX = -Infinity,
                            minY = Infinity,
                            maxY = -Infinity;
                        region.points.forEach((p) => {
                            if (p.x < minX) minX = p.x;
                            if (p.x > maxX) maxX = p.x;
                            if (p.y < minY) minY = p.y;
                            if (p.y > maxY) maxY = p.y;
                        });

                        noteData.push({
                            entryId: journalObj.id,
                            pageId: region.journalPageId,
                            x: minX + (maxX - minX) / 2,
                            y: minY + (maxY - minY) / 2,
                        });
                    });
                });

                if (noteData.length > 0) {
                    await scene.createEmbeddedDocuments("Note", noteData);
                }
            } catch (err) {
                console.error("FWMB | Map Note creation error:", err);
            }
        }

        // Generate thumbnail for V14 Levels architecture
        try {
            ui.notifications.info(`FWMB | Generating Thumbnail...`);
            const thumbData = await scene.createThumbnail();
            if (thumbData?.thumb) {
                await scene.update({ thumb: thumbData.thumb });
            }
        } catch (err) {
            console.debug("FWMB | Background thumbnail generation skipped.", err);
        }

        // Save the map payload so the new journalPageId links persist
        await app.saveCurrentMap();
        scene.view();
    }
}
