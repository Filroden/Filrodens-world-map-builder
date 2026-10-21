import { FILRODENSWMB } from "../config.js";
import { Backup } from "../data/Backup.js";
import { MapImport } from "../data/MapImport.js";
import { MapNames } from "../data/MapNames.js";
import { MapPackage } from "../data/MapPackage.js";
import { overLimit } from "../data/MapRules.js";
import { ImportRefusal, Sanitize } from "../data/Sanitize.js";
import { addCustomPinIcon, findUnresolvedPinIcons, getCustomPinIconEntries } from "../data/pinIcons.js";
import { platform } from "../platform/index.js";
import { MapDialogManager } from "./MapDialogManager.js";

const RESTORE_TEMPLATE = "modules/filrodens-world-map-builder/templates/dialogs/restore-backup.hbs";
const BYTES_PER_MEGABYTE = 1048576;

/**
 * Maps leaving and arriving: a single map's JSON export and import, and the backup of every saved
 * map (Back up all maps, Restore from backup). Every map that arrives goes through the same steps
 * (MapImport for its data, MapPackage for its images and custom pin icons, MapNames for its name),
 * whichever file it came in, and arrives as a new saved map: nothing already saved is changed.
 *
 * The studio's processing overlay is passed in as `overlay` (`start`, `text`, `end`), since it
 * belongs to MapStudio.
 */
export class MapTransfer {
    // ------------------------------------------------------------------ one map as JSON

    /**
     * Exports a saved map as a JSON file with its images in it (see MapPackage, `embed`), so the
     * file opens the same in any world and on either host. Refused, listing what to shorten, when
     * any text is past its limit (an import would refuse the file).
     * @param {string} mapId
     * @param {string} name - The saved map's name.
     */
    static async exportMap(mapId, name) {
        const mapData = await platform.store.loadMapData(mapId);
        if (!mapData) return;
        const tooLong = overLimit(mapData, { "FILRODENSWMB.UI.LimitFieldName": name });
        if (tooLong.length) {
            await MapDialogManager.showOverLimit(tooLong);
            return;
        }
        const { file, missing } = await MapPackage.prepare({ mapData, owners: await platform.store.loadMapOwners(mapId), name, icons: getCustomPinIconEntries(), mode: "embed", read: (src) => platform.assets.read(src) });
        if (missing > 0) platform.notify.warn(platform.i18n.format("FILRODENSWMB.UI.BackupImagesLeftOut", { count: missing }));
        const safeName = name.replaceAll(/[^a-z0-9]/gi, "_").toLowerCase();
        MapTransfer.download(new Blob([JSON.stringify(file, null, 2)], { type: "application/json" }), `fwmb_${safeName}.json`);
    }

    /**
     * Imports a map file as a new saved map. The map keeps the name it was saved under (or, from a
     * file exported before files carried it, the file's name), numbered when a saved map already
     * has it. Refusals reach the caller as ImportRefusal.
     * @param {File} file
     * @returns {Promise<{name: string, corrected: number, missing: number, unresolvedIcons: number}>}
     */
    static async importMap(file) {
        const parsed = MapImport.parse(await MapImport.readText(file));
        const taken = MapNames.namesIn(await platform.store.getSavedMaps());
        const fallback = MapNames.fromFileName(file.name, platform.i18n.localize("FILRODENSWMB.UI.UnnamedMap"));
        const result = await MapTransfer.#bringIn(parsed, { fallback, taken, parentId: (id) => id });
        return result;
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
                const bytes = Backup.pack({ maps: backup.maps, assets: backup.assets, app: platform.module.host, version: platform.module.version });
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
    static async #bringIn(parsed, { fallback, taken, parentId, assetBytes = () => null }) {
        const { mapData, owners, name: savedName, pinIcons, corrected } = MapImport.read(parsed, { newId: () => platform.utils.randomID() });
        const { missing } = await MapPackage.resolve({ mapData, pinIcons, assetBytes, keep: (bytes, type, hash) => platform.assets.keep(bytes, type, hash), icons: ICONS });
        mapData.parentId = parentId(mapData.parentId ?? null) ?? null;
        const name = MapNames.unique(savedName ?? fallback, taken, numberedName);
        const saved = await platform.store.saveMapData(name, mapData, null, { owners });
        if (!saved) throw new Error("The map could not be saved.");
        return { id: saved.id, name, corrected, missing, unresolvedIcons: findUnresolvedPinIcons(mapData.mapPins).affectedPinCount };
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

    /** Every map written out; text past its limit is gathered rather than written. */
    static async #pack(entries, overlay, mode) {
        const assets = new Map();
        const icons = getCustomPinIconEntries();
        const maps = [];
        const tooLong = [];
        let missing = 0;
        for (const [index, entry] of entries.entries()) {
            overlay.text(platform.i18n.format("FILRODENSWMB.UI.BackupPacking", { index: index + 1, count: entries.length }));
            const mapData = await platform.store.loadMapData(entry.id);
            if (!mapData) continue;
            for (const problem of overLimit(mapData, { "FILRODENSWMB.UI.LimitFieldName": entry.name })) tooLong.push({ ...problem, map: entry.name });
            const owners = await platform.store.loadMapOwners(entry.id);
            const prepared = await MapPackage.prepare({ mapData, owners, name: entry.name, icons, mode, read: (src) => platform.assets.read(src), assets });
            missing += prepared.missing;
            maps.push({ id: entry.id, name: entry.name, parentId: entry.parentId, file: prepared.file });
        }
        return { maps, assets, missing, tooLong };
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
                { action: "cancel", label: platform.i18n.localize("FILRODENSWMB.UI.Cancel"), icon: "fwmb-icon fwmb-icon--cancel", tone: "negative" },
                { action: "mapsOnly", label: platform.i18n.localize("FILRODENSWMB.UI.BackupMapsOnly") },
                { action: "everything", label: platform.i18n.localize("FILRODENSWMB.UI.BackupEverything"), tone: "positive", default: true },
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
                { action: "cancel", label: platform.i18n.localize("FILRODENSWMB.UI.Cancel"), icon: "fwmb-icon fwmb-icon--cancel", tone: "negative", callback: () => null },
                { action: "restore", label: platform.i18n.localize("FILRODENSWMB.UI.RestoreButton"), icon: "fwmb-icon fwmb-icon--upload-file", tone: "positive", default: true, callback: (form) => [...form.querySelectorAll('input[name="restoreMap"]:checked')].map((input) => input.value) },
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
        const summary = { restored: 0, copies: [], failed: [], missing: 0 };
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
        } finally {
            overlay.end();
        }
        return summary;
    }

    /** What the restore did: how many maps, the copies of maps already saved, and any that failed. */
    static async #showSummary({ restored, copies, failed, missing }) {
        const { i18n } = platform;
        const escape = Sanitize.escapeHtml;
        const list = (items) => `<ul class="fwmb-limit-list">${items.map((item) => `<li>${escape(item)}</li>`).join("")}</ul>`;
        const parts = [`<p>${escape(i18n.format("FILRODENSWMB.UI.RestoreSummaryRestored", { count: restored }))}</p>`];
        if (copies.length) parts.push(`<p>${escape(i18n.localize("FILRODENSWMB.UI.RestoreSummaryCopies"))}</p>`, list(copies.map((entry) => i18n.format("FILRODENSWMB.UI.RestoreSummaryCopy", entry))));
        if (failed.length) parts.push(`<p>${escape(i18n.localize("FILRODENSWMB.UI.RestoreSummaryFailed"))}</p>`, list(failed.map((entry) => i18n.format("FILRODENSWMB.UI.RestoreSummaryFailure", entry))));
        if (missing > 0) parts.push(`<p>${escape(i18n.format("FILRODENSWMB.UI.RestoreSummaryImages", { count: missing }))}</p>`);
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
const ICONS = Object.freeze({
    list: () => getCustomPinIconEntries(),
    add: (entry) => addCustomPinIcon(entry),
});

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
