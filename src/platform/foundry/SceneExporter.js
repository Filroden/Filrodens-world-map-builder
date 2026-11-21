import { FILRODENSWMB } from "../../config.js";
import { Sanitize } from "../../kernel/data/Sanitize.js";
import { SceneArea } from "../../kernel/export/ExportScale.js";

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

/** A scene image's file extension from its blob's type (see ImageFormat): webp or png. */
const extensionOf = (blob) => (blob?.type === "image/webp" ? "webp" : "png");

/**
 * What a scene export hands the exporter (S0 step 7b): everything already worked out by the studio,
 * so the exporter reads nothing of the studio itself.
 * @typedef {object} SceneExport
 * @property {string} name - The scene's (and its journal's) name.
 * @property {string} folder - The folder in the world's data the images go to.
 * @property {boolean} generateJournals
 * @property {boolean} overwriteJournals
 * @property {Blob} playerBlob
 * @property {Blob|null} gmBlob - The GM overlay, cut to the same area.
 * @property {number} width - The scene's size in pixels: the area at the scale.
 * @property {number} height
 * @property {{type: number, size: number, distance?: number, units?: string}} grid - Foundry's
 *     grid type, the cell in the scene's pixels, and what a cell measures.
 * @property {object|null} gridData - The grid cell data for the area, keyed from its corner.
 * @property {{pins: object[], regions: object[], routes: object[]}|null} pages - The journal
 *     pages, each `{item, text}`; an item takes the id of the page made for it.
 * @property {{x: number, y: number, width: number, height: number, scale: number}} made - The
 *     area and scale the scene was made with, kept on it so exporting again can say when they differ.
 * @property {() => Promise<unknown>} save - Saves the map once its items have their page ids.
 * @property {(key: string) => void} [onStage] - Told each stage as it starts, by its string's key
 *     (the export dialogue's progress shows it).
 */

export class SceneExporter {
    /**
     * Whether a tile's image is a GM overlay an earlier export placed, in either format (a map
     * may be exported again in another format), so a re-export replaces it rather than adding a
     * second.
     * @param {string|null|undefined} src
     * @returns {boolean}
     */
    static isOverlayTile(src) {
        return typeof src === "string" && /_gm\.(png|webp)(\?.*)?$/i.test(src);
    }

    /**
     * Makes (or updates) the scene: the images uploaded, the journal pages, the scene with its grid
     * and grid cell data, the GM overlay tile and a thumbnail; then the map saved and the scene
     * shown. A failure is not reported here: it reaches the caller (the studio's scene export),
     * which logs it and shows its own localised message, so no error text (which can carry a file
     * or scene name) is ever put into a notification.
     * @param {SceneExport} config
     */
    static async run(config) {
        const { name, folder, generateJournals, overwriteJournals, playerBlob, gmBlob } = config;
        const FilePickerV2 = foundry.applications.apps.FilePicker.implementation;
        const stage = (key) => config.onStage?.(key);
        stage("FILRODENSWMB.UI.ExportStepUpload");
        const targetPath = await this.#ensureDirectoryExists(folder);

        // Each image is named and typed as what it is: PNG or WebP (see ImageFormat)
        const stem = name.replace(/[^a-z0-9]/gi, "_").toLowerCase();
        const playerFilename = `${stem}_player.${extensionOf(playerBlob)}`;
        await FilePickerV2.upload("data", targetPath, new File([playerBlob], playerFilename, { type: playerBlob.type }));
        const playerImgPath = `${targetPath}/${playerFilename}`;

        let gmImgPath = null;
        if (gmBlob) {
            const gmFilename = `${stem}_gm.${extensionOf(gmBlob)}`;
            await FilePickerV2.upload("data", targetPath, new File([gmBlob], gmFilename, { type: gmBlob.type }));
            gmImgPath = `${targetPath}/${gmFilename}`;
        }

        if (generateJournals && config.pages) stage("FILRODENSWMB.UI.ExportStepJournals");
        const journalObj = generateJournals && config.pages ? await this.#createJournals(name, config.pages, overwriteJournals) : null;
        stage("FILRODENSWMB.UI.ExportStepScene");
        await this.#createScene(config, playerImgPath, gmImgPath, journalObj);

        // The scene's name is the GM's own text: it goes in as a format value, which Foundry's
        // notifications escape
        ui.notifications.info("FILRODENSWMB.UI.ExportSceneDone", { format: { name } });
    }

    /**
     * The area and scale the scene of this name was made with by an earlier export (null when there
     * is no such scene, or it was made before scenes kept them): what the export dialogue compares
     * the choice with, to warn that walls, lights and tokens stay where they were.
     * @param {string} name
     * @returns {{x: number, y: number, width: number, height: number, scale: number}|null}
     */
    static previous(name) {
        const scene = name ? game.scenes?.getName(name) : null;
        const made = scene?.getFlag?.(FILRODENSWMB.ID, FILRODENSWMB.FLAGS.EXPORT_AREA) ?? null;
        return made && ["x", "y", "width", "height", "scale"].every((key) => Number.isFinite(Number(made[key]))) ? { ...made } : null;
    }

    /** Whether a choice of area and scale differs from what the scene was made with (see previous). */
    static differs(previous, chosen) {
        return !!previous && !SceneArea.same(previous, chosen);
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

    static async #createJournals(sceneName, pages, overwriteJournals) {
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

        // The items that get a page: generated ones only where the map labels them, and only those
        // inside the export's area (see GeneratedDetails.journalPages)
        for (const { item, text } of pages.pins) {
            if (item.type === "spring" || item.type === "block_spring") continue;
            await syncJournalPage(item, game.i18n.localize("FILRODENSWMB.JOURNAL.UnnamedLocation"), text);
        }
        for (const { item, text } of pages.regions) await syncJournalPage(item, game.i18n.localize("FILRODENSWMB.JOURNAL.UnnamedRegion"), text);
        for (const { item, text } of pages.routes) await syncJournalPage(item, game.i18n.localize("FILRODENSWMB.JOURNAL.UnnamedRoute"), text);

        return parentJournal;
    }

    /**
     * Creates the Scene for the export, or updates the one of the same name from an earlier export,
     * then adds the GM overlay tile and a thumbnail, and finally shows it. Each extra is optional:
     * a failure in one is logged and the rest of the export carries on.
     *
     * The scene is the size of its images: the export's area times its scale, with a grid whose
     * cell is a whole number of pixels at that scale. Foundry fits a background to the scene's
     * size, so a 2x image on a scene of the map's own size would be shrunk back on screen and its
     * names drawn no larger than at 1x; on a 2x scene they are shown as the 2x image shows them.
     * Every cell is the same cell of the map at any scale and measures the same ground; the area's
     * corner is on a grid corner (see SceneArea.snap), so the scene's own grid falls on the map's.
     */
    static async #createScene(config, bgPath, gmOverlayPath, journalObj) {
        const sceneData = this.sceneData(config, bgPath);
        const { gridData } = config;
        if (gridData) gridData.grid.size = sceneData.grid.size;

        const scene = await this.#saveScene(config.name, sceneData, gridData, journalObj);
        if (!scene) return;

        this.#warnIfGridSizeChanged(scene, sceneData, gridData);
        if (gmOverlayPath) await this.#createGmOverlayTile(scene, sceneData, gmOverlayPath);
        await this.#updateThumbnail(scene);

        // Save the map payload so the new journalPageId links persist
        await config.save?.();
        scene.view();
    }

    /**
     * The Scene document's data: the image as its background, its size and grid, and its flags:
     * the grid cell data when there is any, and the area and scale it was made with.
     * @param {SceneExport} config
     * @param {string} bgPath
     */
    static sceneData(config, bgPath) {
        const { name, width, height, grid, gridData, made } = config;
        const flags = { [FILRODENSWMB.FLAGS.EXPORT_AREA]: { ...made } };
        if (gridData) flags[FILRODENSWMB.FLAGS.GRID_DATA] = gridData;
        return {
            name,
            width: Math.round(width),
            height: Math.round(height),
            padding: 0,
            backgroundColor: "#222222",
            tokenVision: false,
            environment: {
                globalLight: { enabled: true },
            },
            grid: {
                type: grid.type,
                size: grid.size,
                // What one cell measures in the map's own unit, so Foundry's ruler reads true
                ...(grid.distance > 0 ? { distance: grid.distance, units: grid.units } : {}),
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
            flags: { [FILRODENSWMB.ID]: flags },
        };
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
        const oldTiles = scene.tiles.filter((t) => SceneExporter.isOverlayTile(t.texture?.src)).map((t) => t.id);
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

    /** Generates the Scene's thumbnail. It is only a convenience, so a failure is skipped quietly. */
    static async #updateThumbnail(scene) {
        try {
            const thumbData = await scene.createThumbnail();
            if (thumbData?.thumb) {
                await scene.update({ thumb: thumbData.thumb });
            }
        } catch (err) {
            console.debug("FWMB | Background thumbnail generation skipped.", err);
        }
    }
}
