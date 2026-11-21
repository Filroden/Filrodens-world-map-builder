import { FILRODENSWMB } from "../../../config.js";
import { Backup } from "../data/Backup.js";
import { MapImport } from "../data/MapImport.js";
import { MapNames } from "../data/MapNames.js";
import { MapPackage } from "../data/MapPackage.js";
import { overLimit } from "../data/MapRules.js";
import { ImportRefusal, Sanitize } from "../../../kernel/data/Sanitize.js";
import { getCustomPinIconEntries } from "../../../kernel/data/pinIcons.js";
import { platform } from "../../../platform/index.js";
import { Worlds } from "../../../kernel/worlds/Worlds.js";
import { WorldMaps } from "../data/WorldMaps.js";
import { WorldMigration } from "../data/WorldMigration.js";
import { WorldFile } from "../data/WorldFile.js";
import { WorldSettings } from "../data/WorldSettings.js";
import { Blobs } from "../../../kernel/data/Blobs.js";
import { RegionalRecord } from "../../../kernel/worlds/RegionalRecord.js";
import { MapDialogManager } from "./MapDialogManager.js";
import { MAP_TYPES, WorldRecord } from "../../../kernel/worlds/WorldRecord.js";

const RESTORE_TEMPLATE = "modules/filrodens-world-map-builder/templates/world/dialogs/restore-backup.hbs";
const BYTES_PER_MEGABYTE = 1048576;

/**
 * Maps leaving and arriving: a single map's JSON export and import, and the backup of every saved
 * map (Back up all maps, Restore from backup). Every map that arrives goes through the same steps
 * (MapImport for its data, MapPackage for its images and custom pin icons, MapNames for its name),
 * whichever file it came in, and arrives as a new saved map: nothing already saved is changed.
 *
 * From v5 Export JSON writes a world file (see WorldFile): the world with the settings it reads and
 * its icons, its map, and its link to the world it was cut from. Import reads a world file or a 4.3
 * map file. Either goes back under the map it was cut from when that map is still saved here (as a
 * restore does), and is otherwise a world of its own (see WorldMigration), with the custom pin
 * icons it carried as that world's icons.
 *
 * The studio's processing overlay is passed in as `overlay` (`start`, `text`, `end`), since it
 * belongs to MapStudio.
 */
export class MapTransfer {
    // ------------------------------------------------------------------ one map as JSON

    /**
     * Exports a saved map's world as a world file (see WorldFile) with its images in it (see
     * MapPackage, `embed`), so the file opens the same in any world and on either host. Refused, listing what to shorten, when
     * any text is past its limit (an import would refuse the file).
     * @param {string} mapId
     * @param {string} name - The saved map's name.
     */
    static async exportMap(mapId, name) {
        const loaded = await WorldMaps.load(mapId);
        const mapData = loaded?.payload;
        if (!mapData) return;
        const tooLong = overLimit(mapData, { "FILRODENSWMB.UI.LimitFieldName": name });
        if (tooLong.length) {
            await MapDialogManager.showOverLimit(tooLong);
            return;
        }
        const { file, missing } = await MapPackage.prepare({ mapData, owners: await platform.store.loadMapOwners(mapId), modelRun: await platform.store.loadMapModelRun(mapId), name, icons: loaded.settings?.icons?.custom ?? getCustomPinIconEntries(), mode: "embed", read: (src) => platform.assets.read(src) });
        if (missing > 0) platform.notify.warn(platform.i18n.format("FILRODENSWMB.UI.BackupImagesLeftOut", { count: missing }));
        // Its link to the world it was cut from, so an import where that world is still saved goes back under it
        const world = loaded.world;
        const parent = world?.parentWorldId ? await Worlds.get(world.parentWorldId) : null;
        const cutFrom = parent ? { name: parent.name, worldId: parent.id, mapId: Worlds.mapOf(parent, MAP_TYPES.SURFACE) } : null;
        const blobs = new Map();
        for (const hash of RegionalRecord.blobsOf(world?.regional, mapId)) {
            const bytes = await platform.store.loadMapBlob(mapId, hash);
            if (bytes) blobs.set(hash, bytes);
        }
        const worldFile = WorldFile.write({ name: world?.name ?? name, mapId, file, disabledIcons: loaded.settings?.icons?.disabled ?? [], cutFrom, held: world?.held === true, regional: world?.regional ?? null, blobs, version: platform.module.version });
        const safeName = name.replaceAll(/[^a-z0-9]/gi, "_").toLowerCase();
        MapTransfer.download(new Blob([JSON.stringify(worldFile, null, 2)], { type: "application/json" }), `fwmb_${safeName}.json`);
    }

    /**
     * Imports a world file (its Surface map) or a 4.3 map file as a new world. A regional world
     * goes back under the map it was cut from when that map is still saved here, held again if it
     * was (Ken, 2026-11-18), as a restore does; otherwise it is a world of its own (`released` when
     * it was held). It keeps the name it was saved under (or, from a file exported before files
     * carried it, the file's name), numbered when a saved map already has it. Refusals reach the
     * caller as ImportRefusal.
     * @param {File} file
     * @returns {Promise<{name: string, corrected: number, missing: number, unresolvedIcons: number, released: boolean}>}
     */
    static async importMap(file) {
        const parsed = MapImport.parse(await MapImport.readText(file));
        const taken = MapNames.namesIn(await platform.store.getSavedMaps());
        const fallback = MapNames.fromFileName(file.name, platform.i18n.localize("FILRODENSWMB.UI.UnnamedMap"));
        // A world file's Surface map, its world's settings merged in; or a 4.3 map file as it is
        const worldFile = WorldFile.is(parsed) ? WorldFile.read(parsed) : null;
        const [first] = worldFile?.maps ?? [];
        const mapFile = worldFile ? first.file : parsed;
        // Under the map it was cut from only when that map is saved here
        const saved = new Set((await platform.store.listMaps()).map((map) => map.id));
        const result = await MapTransfer.#bringIn(mapFile, { fallback, taken, parentId: (id) => (id && saved.has(id) ? id : null), disabledIcons: worldFile?.disabledIcons ?? [] });
        let released = false;
        if (worldFile) {
            const settled = await MapTransfer.#settleWorlds({ worlds: [worldFile.world], blobBytes: worldFile.blobBytes }, new Map([[first.id, result.id]]));
            released = settled.length > 0;
        }
        return { ...result, released };
    }

    // ------------------------------------------------------------------ the backup

    /**
     * Packs every saved map, with the images and custom pin icons they use, into one zip and
     * downloads it. Shows its progress on the overlay; offers "Maps only" when the backup would be
     * larger than LIMITS.BACKUP.WARN_BYTES; refuses, listing what to shorten, when any map holds
     * text past its limit.
     * @param {{start: Function, text: Function, end: Function}} overlay
     */
    static async backUp(overlay) {
        const entries = flatten(await platform.store.getSavedMaps());
        if (!entries.length) {
            platform.notify.warn(platform.i18n.localize("FILRODENSWMB.UI.BackupNoMaps"));
            return;
        }
        try {
            const packed = await MapTransfer.#packUnder(overlay, entries, "assets");
            if (packed.tooLong.length) {
                await MapDialogManager.showOverLimit(packed.tooLong);
                return;
            }
            const backup = await MapTransfer.#chooseSize(packed, entries, overlay);
            if (!backup) return;
            await overlay.start(platform.i18n.localize("FILRODENSWMB.UI.BackupZipping"));
            try {
                const bytes = Backup.pack({ maps: backup.maps, assets: backup.assets, worlds: backup.worlds, blobs: backup.blobs, app: platform.module.host, version: platform.module.version });
                MapTransfer.download(new Blob([bytes], { type: "application/zip" }), Backup.fileName());
            } finally {
                overlay.end();
            }
            platform.notify.info(platform.i18n.format("FILRODENSWMB.UI.BackupDone", { count: backup.maps.length }));
            if (backup.missing > 0) platform.notify.warn(platform.i18n.format("FILRODENSWMB.UI.BackupImagesLeftOut", { count: backup.missing }));
        } catch (error) {
            console.error("FWMB | Backup failed:", error);
            platform.notify.error(platform.i18n.localize("FILRODENSWMB.UI.BackupFailed"));
        }
    }

    /**
     * Restores maps from a backup file: the file is read and checked, the user chooses which maps
     * to restore (all are offered, those already saved marked), and each chosen map is added as a
     * new saved map, regional maps under the copies of their parents. A summary says what was
     * restored, which were copies of maps already saved, and which could not be.
     * @param {File} file
     * @param {{start: Function, text: Function, end: Function}} overlay
     * @returns {Promise<boolean>} Whether any map was restored.
     */
    static async restore(file, overlay) {
        await overlay.start(platform.i18n.localize("FILRODENSWMB.UI.RestoreReading"));
        let backup;
        try {
            if (file.size > FILRODENSWMB.LIMITS.BACKUP.BYTES) throw new ImportRefusal("tooLarge", { detail: `${file.size} bytes` });
            backup = Backup.read(new Uint8Array(await file.arrayBuffer()));
        } finally {
            overlay.end();
        }
        if (!backup.maps.length) {
            platform.notify.warn(platform.i18n.localize("FILRODENSWMB.UI.RestoreNothing"));
            return false;
        }
        const saved = flatten(await platform.store.getSavedMaps());
        const chosen = await MapTransfer.#choose(backup, saved);
        if (!chosen?.length) return false;

        const summary = await MapTransfer.#restoreChosen(backup, chosen, saved, overlay);
        if (summary.released.length) platform.notify.warn(platform.i18n.format("FILRODENSWMB.UI.RestoreReleasedNotice", { count: summary.released.length }));
        await MapTransfer.#showSummary(summary);
        return summary.restored > 0;
    }

    /** Saves a file to the user's computer through a link to it (in Foundry as on the web). */
    static download(blob, fileName) {
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = fileName;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), DOWNLOAD_RELEASE_MS);
    }

    // ------------------------------------------------------------------ steps

    /**
     * One map file read in and saved: its data through MapImport, its images and icons through
     * MapPackage, its name made unique, its parent found.
     * @returns {Promise<{id: string, name: string, corrected: number, missing: number, unresolvedIcons: number}>}
     */
    static async #bringIn(parsed, { fallback, taken, parentId, assetBytes = () => null, disabledIcons = [] }) {
        const { mapData, owners, modelRun, name: savedName, pinIcons, corrected } = MapImport.read(parsed, { newId: () => platform.utils.randomID() });
        // The icons the file carries become the new world's own (not the open world's)
        const icons = importedIcons();
        const { missing } = await MapPackage.resolve({ mapData, pinIcons, assetBytes, keep: (bytes, type, hash) => platform.assets.keep(bytes, type, hash), icons });
        mapData.parentId = parentId(mapData.parentId ?? null) ?? null;
        const name = MapNames.unique(savedName ?? fallback, taken, numberedName);
        const saved = await platform.store.saveMapData(name, mapData, null, { owners, modelRun });
        if (!saved) throw new Error("The map could not be saved.");
        // The saved map made a world, with the file's icons
        await WorldMigration.run();
        const world = await Worlds.ofMap(saved.id);
        if (world && !world.held) await platform.store.saveWorld({ ...world, settings: { ...world.settings, icons: { custom: icons.list(), disabled: [...disabledIcons] } } });
        return { id: saved.id, name, corrected, missing, unresolvedIcons: unresolvedPins(mapData.mapPins, icons.list()) };
    }

    /** Every map written out under the overlay (see #pack). */
    static async #packUnder(overlay, entries, mode) {
        await overlay.start(platform.i18n.format("FILRODENSWMB.UI.BackupPacking", { index: 1, count: entries.length }));
        try {
            return await MapTransfer.#pack(entries, overlay, mode);
        } finally {
            overlay.end();
        }
    }

    /**
     * Every map written out without its world's settings, with the world records they belong to
     * and the blobs those name (backup format 2); text past its limit is gathered rather than
     * written.
     */
    static async #pack(entries, overlay, mode) {
        const assets = new Map();
        const maps = [];
        const tooLong = [];
        const worlds = new Map();
        const blobs = new Map();
        let missing = 0;
        for (const [index, entry] of entries.entries()) {
            overlay.text(platform.i18n.format("FILRODENSWMB.UI.BackupPacking", { index: index + 1, count: entries.length }));
            // The map with its world's settings, and its world's icons
            const loaded = await WorldMaps.load(entry.id);
            const mapData = loaded?.payload;
            if (!mapData) continue;
            const icons = loaded.settings?.icons?.custom ?? getCustomPinIconEntries();
            for (const problem of overLimit(mapData, { "FILRODENSWMB.UI.LimitFieldName": entry.name })) tooLong.push({ ...problem, map: entry.name });
            const owners = await platform.store.loadMapOwners(entry.id);
            const modelRun = await platform.store.loadMapModelRun(entry.id);
            const prepared = await MapPackage.prepare({ mapData, owners, modelRun, name: entry.name, icons, mode, read: (src) => platform.assets.read(src), assets });
            missing += prepared.missing;
            let file = prepared.file;
            const world = loaded.world;
            if (world) {
                // The world's settings are written once, in its record; a restore merges them back
                const { pinIcons, ...rest } = file;
                file = { ...WorldSettings.split(rest).mapData, ...(pinIcons ? { pinIcons } : {}) };
                if (!worlds.has(world.id)) {
                    const { migration: _migration, ...record } = structuredClone(world);
                    worlds.set(world.id, record);
                }
                for (const hash of RegionalRecord.blobsOf(world.regional, entry.id)) {
                    const bytes = blobs.has(hash) ? null : await platform.store.loadMapBlob(entry.id, hash);
                    if (bytes) blobs.set(hash, bytes);
                }
            }
            maps.push({ id: entry.id, name: entry.name, parentId: entry.parentId, file });
        }
        // A map without a world (not migrated, which the studio's opening prevents) keeps its settings
        return { maps, assets, missing, tooLong, worlds: [...worlds.values()], blobs };
    }

    /**
     * The backup as packed, or (when it is larger than WARN_BYTES and the user chooses Maps only)
     * packed again without its images; null when the user cancels.
     */
    static async #chooseSize(packed, entries, overlay) {
        const bytes = [...packed.assets.values()].reduce((sum, asset) => sum + asset.bytes.length, 0) + packed.maps.reduce((sum, map) => sum + JSON.stringify(map.file).length, 0);
        if (bytes <= FILRODENSWMB.LIMITS.BACKUP.WARN_BYTES) return packed;
        const choice = await platform.dialogs.choose({
            classes: ["fwmb"],
            title: platform.i18n.localize("FILRODENSWMB.UI.BackupLargeTitle"),
            content: `<p>${Sanitize.escapeHtml(platform.i18n.format("FILRODENSWMB.UI.BackupLargeContent", { size: Math.round(bytes / BYTES_PER_MEGABYTE) }))}</p>`,
            buttons: [
                { action: "cancel", label: platform.i18n.localize("FILRODENSWMB.UI.Cancel") },
                { action: "mapsOnly", label: platform.i18n.localize("FILRODENSWMB.UI.BackupMapsOnly") },
                { action: "everything", label: platform.i18n.localize("FILRODENSWMB.UI.BackupEverything"), default: true },
            ],
            dismissed: "cancel",
        });
        if (choice === "everything") return packed;
        return choice === "mapsOnly" ? MapTransfer.#packUnder(overlay, entries, "keep") : null;
    }

    /** The restore dialogue: the backup's maps as a tree, all ticked, those already saved marked. */
    static async #choose(backup, saved) {
        const savedIds = new Set(saved.map((entry) => entry.id));
        const savedNames = new Set(saved.map((entry) => entry.name));
        const nodes = new Map(backup.maps.map((map) => [map.id, { ...map, already: savedIds.has(map.id) || savedNames.has(map.name), children: [] }]));
        const roots = [];
        for (const node of nodes.values()) (nodes.get(node.parentId)?.children ?? roots).push(node);
        const exportedAt = backup.exportedAt ? new Date(backup.exportedAt) : null;
        const content = await platform.templates.render(RESTORE_TEMPLATE, { maps: roots, madeOn: exportedAt && !Number.isNaN(exportedAt.getTime()) ? exportedAt.toLocaleString(platform.i18n.lang) : null });
        return platform.dialogs.choose({
            classes: ["fwmb", "fwmb-restore-dialog"],
            title: platform.i18n.localize("FILRODENSWMB.UI.RestoreFromBackup"),
            content,
            onRender: (element) => bindParentTicks(element),
            buttons: [
                { action: "cancel", label: platform.i18n.localize("FILRODENSWMB.UI.Cancel"), callback: () => null },
                { action: "restore", label: platform.i18n.localize("FILRODENSWMB.UI.RestoreButton"), icon: "fwmb-icon fwmb-icon--upload-file", default: true, callback: (form) => [...form.querySelectorAll('input[name="restoreMap"]:checked')].map((input) => input.value) },
            ],
            dismissed: null,
        });
    }

    /** The chosen maps restored, parents before their children, each as a new saved map. */
    static async #restoreChosen(backup, chosen, saved, overlay) {
        const chosenIds = new Set(chosen);
        const ordered = byDepth(backup.maps).filter((map) => chosenIds.has(map.id));
        const savedIds = new Set(saved.map((entry) => entry.id));
        const savedNames = new Set(saved.map((entry) => entry.name));
        const taken = new Set(savedNames);
        const newIds = new Map();
        const summary = { restored: 0, copies: [], failed: [], missing: 0, released: [] };
        await overlay.start(platform.i18n.format("FILRODENSWMB.UI.RestoreProgress", { index: 1, count: ordered.length }));
        try {
            for (const [index, map] of ordered.entries()) {
                overlay.text(platform.i18n.format("FILRODENSWMB.UI.RestoreProgress", { index: index + 1, count: ordered.length }));
                // A regional map goes under the copy of its parent; a parent left out of the restore
                // is used when it is still saved here, else the map stands on its own
                const parentId = (id) => newIds.get(id) ?? (savedIds.has(id) ? id : null);
                try {
                    const result = await MapTransfer.#bringIn(backup.mapFile(map.id), { fallback: map.name, taken, parentId, assetBytes: backup.assetBytes });
                    newIds.set(map.id, result.id);
                    taken.add(result.name);
                    summary.restored += 1;
                    summary.missing += result.missing;
                    if (savedIds.has(map.id) || savedNames.has(map.name)) summary.copies.push({ original: map.name, copy: result.name });
                } catch (error) {
                    console.error(`FWMB | Restoring ${map.name} failed:`, error);
                    const reason = error instanceof ImportRefusal ? Sanitize.refusalMessage(error, platform.i18n) : platform.i18n.localize("FILRODENSWMB.UI.ImportError");
                    summary.failed.push({ name: map.name, reason });
                }
            }
            if (backup.worlds?.length) summary.released = await MapTransfer.#settleWorlds(backup, newIds);
        } finally {
            overlay.end();
        }
        return summary;
    }

    /**
     * The worlds of a format 2 backup set up again over the maps restored (each restored map was
     * made a world of its own as it arrived, see #bringIn): each world's parent and whether it is
     * held, its regional record and blobs, and each map's card. A held world is held again under its
     * parent's restored copy, or under its parent when that is still saved here; with neither, it
     * is released as a world of its own with the settings it read (as deleting its parent would),
     * and named in the summary (Ken, 2026-11-18).
     * @param {object} backup - As Backup.read gives it.
     * @param {Map<string, string>} newIds - Each restored map's new id, by its id in the backup.
     * @returns {Promise<string[]>} The names of the worlds released.
     */
    static async #settleWorlds(backup, newIds) {
        const released = [];
        const newWorldIds = new Map();
        const backupById = new Map(backup.worlds.map((world) => [world.id, world]));
        const depth = (world, seen = new Set()) => (world?.parentWorldId && backupById.has(world.parentWorldId) && !seen.has(world.id) ? 1 + depth(backupById.get(world.parentWorldId), seen.add(world.id)) : 0);
        const ordered = [...backup.worlds].sort((a, b) => depth(a) - depth(b));
        for (const world of ordered) {
            const restoredMaps = world.maps.filter((map) => newIds.has(map.id));
            if (!restoredMaps.length) continue;
            const arrived = await Worlds.ofMap(newIds.get(restoredMaps[0].id));
            if (!arrived) continue;
            newWorldIds.set(world.id, arrived.id);
            const parentId = newWorldIds.get(world.parentWorldId) ?? ((await Worlds.get(world.parentWorldId)) ? world.parentWorldId : null);
            const held = world.held && !!parentId;
            // Named as its map arrived (made unique among the maps saved here)
            const record = { ...arrived, parentWorldId: parentId, held };
            delete record.migration;
            // Each map's card as the backup kept it (its thumbnail, its run), on its restored copy
            const cards = new Map(restoredMaps.map((map) => [newIds.get(map.id), WorldRecord.mapCard(map)]));
            record.maps = (arrived.maps ?? []).map((map) => ({ ...map, ...cards.get(map.id), id: map.id, type: map.type }));
            if (held) {
                record.settings = { setup: structuredClone(arrived.settings?.setup ?? {}) };
                const renamed = new Map(restoredMaps.map((map) => [map.id, newIds.get(map.id)]));
                record.regional = await MapTransfer.#restoredRegional(world.regional, renamed, newIds, backup);
            } else {
                // Its own settings, as the map that arrived holds them (a world the migration held reads them from above)
                record.settings = await Worlds.settingsOf(arrived);
                record.regional = null;
                if (world.held) released.push(record.name);
            }
            await platform.store.saveWorld(record);
            if (!held) for (const map of record.maps ?? []) await platform.store.keepMapBlobs?.(map.id, []);
        }
        return released;
    }

    /**
     * A held world's regional record for its restored maps: their ids and their sources' ids moved
     * to the restored copies, and each blob it names kept with its map, or dropped from the record
     * when the backup does not hold it intact.
     */
    static async #restoredRegional(regional, renamed, newIds, backup) {
        if (!RegionalRecord.isCurrent(regional)) return regional ?? null;
        let record = RegionalRecord.remap(regional, renamed);
        for (const entry of record.maps) {
            const changes = { sourceMapId: entry.sourceMapId ? (newIds.get(entry.sourceMapId) ?? entry.sourceMapId) : null };
            if (entry.cutBase) {
                const bytes = backup.blobBytes(entry.cutBase);
                const intact = bytes && (await Blobs.unpack(bytes, entry.cutBase)) !== null;
                if (intact) await platform.store.saveMapBlob(entry.mapId, entry.cutBase, bytes);
                else changes.cutBase = null;
            }
            record = RegionalRecord.withMap(record, entry.mapId, changes);
        }
        return record;
    }

    /** What the restore did: how many maps, the copies of maps already saved, any that failed, and the worlds released. */
    static async #showSummary({ restored, copies, failed, missing, released = [] }) {
        const { i18n } = platform;
        const escape = Sanitize.escapeHtml;
        const list = (items) => `<ul class="fwmb-limit-list">${items.map((item) => `<li>${escape(item)}</li>`).join("")}</ul>`;
        const parts = [`<p>${escape(i18n.format("FILRODENSWMB.UI.RestoreSummaryRestored", { count: restored }))}</p>`];
        if (copies.length) parts.push(`<p>${escape(i18n.localize("FILRODENSWMB.UI.RestoreSummaryCopies"))}</p>`, list(copies.map((entry) => i18n.format("FILRODENSWMB.UI.RestoreSummaryCopy", entry))));
        if (failed.length) parts.push(`<p>${escape(i18n.localize("FILRODENSWMB.UI.RestoreSummaryFailed"))}</p>`, list(failed.map((entry) => i18n.format("FILRODENSWMB.UI.RestoreSummaryFailure", entry))));
        if (missing > 0) parts.push(`<p>${escape(i18n.format("FILRODENSWMB.UI.RestoreSummaryImages", { count: missing }))}</p>`);
        if (released.length) parts.push(`<p>${escape(i18n.localize("FILRODENSWMB.UI.RestoreSummaryReleased"))}</p>`, list(released));
        await platform.dialogs.choose({
            classes: ["fwmb"],
            title: i18n.localize("FILRODENSWMB.UI.RestoreSummaryTitle"),
            content: parts.join(""),
            buttons: [{ action: "close", label: i18n.localize("FILRODENSWMB.UI.Close"), default: true }],
        });
    }
}

/** How long a download's object URL is kept before it is let go. */
const DOWNLOAD_RELEASE_MS = 60000;

/** The host's custom pin icons, for MapPackage.resolve. */
/**
 * The pin icons an arriving map brings, as MapPackage.resolve adds them: a list of its own, given
 * to the world the map becomes (each world's icons are its own from v5).
 */
function importedIcons() {
    const entries = [];
    return {
        list: () => entries.map((entry) => ({ ...entry })),
        add: async (entry) => {
            const added = { id: platform.utils.randomID(), ...entry };
            entries.push(added);
            return added;
        },
    };
}

/** How many pins name an icon that is neither built in nor one of `icons`. */
function unresolvedPins(pins = [], icons = []) {
    const ids = new Set(icons.map((entry) => entry.id));
    return pins.filter((pin) => pin?.icon && !Object.hasOwn(FILRODENSWMB.INFRASTRUCTURE_ICONS, pin.icon) && !ids.has(pin.icon)).length;
}

const numberedName = (name, number) => platform.i18n.format("FILRODENSWMB.UI.NumberedMapName", { name, number });

/** The saved maps' tree as a list, each parent before its children. */
function flatten(tree, parentId = null) {
    return (tree ?? []).flatMap((entry) => [{ id: entry.id, name: entry.name, parentId: entry.parentId ?? parentId }, ...flatten(entry.children, entry.id)]);
}

/** The backup's maps ordered so a parent always comes before its children. */
function byDepth(maps) {
    const byId = new Map(maps.map((map) => [map.id, map]));
    const depth = (map, seen = new Set()) => {
        const parent = byId.get(map.parentId);
        if (!parent || seen.has(map.id)) return 0;
        seen.add(map.id);
        return 1 + depth(parent, seen);
    };
    return maps.map((map, index) => ({ map, index, depth: depth(map) })).sort((a, b) => a.depth - b.depth || a.index - b.index).map(({ map }) => map);
}

/** In the restore dialogue, unticking a map unticks the regional maps under it. */
function bindParentTicks(element) {
    element.addEventListener("change", (event) => {
        const input = event.target;
        if (input?.name !== "restoreMap" || input.checked) return;
        for (const child of input.closest("li")?.querySelectorAll('ul input[name="restoreMap"]') ?? []) child.checked = false;
    });
}
