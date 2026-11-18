import { FILRODENSWMB } from "../../../config.js";
import { platform } from "../../../platform/index.js";
import { MAP_TYPES, WorldRecord } from "../../../kernel/worlds/WorldRecord.js";
import { WorldSettings } from "./WorldSettings.js";
import { Backup } from "./Backup.js";
import { MapPackage } from "./MapPackage.js";
import { RegionalRecord } from "../../../kernel/worlds/RegionalRecord.js";
import { ParentRunRecovery } from "../app/ParentRunRecovery.js";
import { StrokeHistory } from "../tools/StrokeHistory.js";
import { TerrainVersion } from "../tools/TerrainVersion.js";

/** The style lists a held regional map's own additions are carried up from (see #carryUp). */
const STYLE_LISTS = Object.freeze(["route", "label", "region", "pin"]);

/** The folder in the world's data that the backup made before migrating is written to (Foundry). */
const BACKUP_FOLDER = "fwmb-backups";

/**
 * Saved maps made into worlds (v5's family records): every World studio map with no world of its
 * own becomes a world, as `claude/v5-s0-shell-handoff.md` §13 step 2 sets out (Ken, 2026-11-18).
 *
 * - A map becomes a world of one Surface map, named as the map, its settings copied from the map,
 *   at `revision` and `settingsRevision` 1. The world takes the map's id, so running this again
 *   after a failure part-way writes the same records rather than new ones.
 * - A regional map becomes a regional world under its parent's world, chains kept. It is **held**
 *   (its settings, all but its World setup, read from the top of its held chain) when it holds its
 *   parent's run, or when it has no run of its own and its content came from a run its parent
 *   still holds (so ParentRunRecovery can give it that run). Otherwise it is a world of its own,
 *   only recorded as cut from its parent. A regional map whose parent is no longer saved becomes a
 *   world of its own.
 * - A held map's settings are its parent's from now on. A style or custom biome it has that the
 *   world its settings come from lacks (by id) is added to that world, so nothing on the map loses
 *   its look; anything else that differs takes the parent's, and the world's `migration` record
 *   lists which groups did, for the first opening's notice.
 * - Every world takes the custom pin icons as the host has them now.
 * - A held world gets its regional record (RegionalRecord; step 2b), marked as migrated: its crop
 *   and zoom from the two maps' places in the world where its parent is saved, the count of its
 *   strokes that are its parent's (StrokeHistory.inheritedCount), and no base or fingerprint, so
 *   it is never marked Out of date. A held world made in 2a, with only a placeholder, gets it the
 *   same way the next time this runs.
 * - Nothing is removed: a map's data keeps its copy of the settings until it is next saved, so a
 *   map not yet saved in v5 still opens in 4.3.
 *
 * It runs when the studio opens and after anything that saves a map without a world (an import,
 * a restore, a regional map cut); the first time, on Foundry, a backup of every map is written to
 * the world's data first.
 */
export class WorldMigration {
    /**
     * The world records and map fields that make worlds of the maps that have none.
     *
     * @param {object} options
     * @param {Array<{id: string, name: string, mapData: object|null, meta: object|null, hasModelRun: boolean}>} options.maps
     * @param {Map<string, object>} options.worlds - The world records saved already, by id.
     * @param {{custom: object[], disabled: string[]}} options.icons - The host's pin icons now.
     * @returns {{worlds: object[], metas: Array<{mapId: string, meta: object}>}} The world records to
     *     save (new ones, and saved ones that took a held map's styles), and each map's fields.
     */
    static plan({ maps, worlds, icons }) {
        const byMap = new Map(maps.map((map) => [map.id, map]));
        const adopted = (map) => !!map.meta?.worldId && worlds.has(map.meta.worldId);
        const worldIdOf = (map) => (adopted(map) ? map.meta.worldId : map.id);
        const pending = maps.filter((map) => map.mapData && !adopted(map));
        // Copies, since a saved world may take a held map's styles
        const records = new Map([...worlds].map(([id, world]) => [id, structuredClone(world)]));
        const changed = new Set();
        const metas = [];

        for (const map of byDepth(pending, byMap)) {
            const parent = map.mapData.parentId ? byMap.get(map.mapData.parentId) : null;
            const parentWorld = parent ? records.get(worldIdOf(parent)) : null;
            const held = !!parentWorld && WorldMigration.isHeld(map, parent);
            const { settings } = WorldSettings.split(map.mapData);
            settings.icons = structuredClone(icons ?? WorldRecord.emptyIcons());

            const record = WorldRecord.create({ id: map.id, name: map.name || "", maps: [{ id: map.id, type: MAP_TYPES.SURFACE }], parentWorldId: parentWorld?.id ?? null, held, settings });
            record.regional = parentWorld ? { sourceMapId: parent.id, migrated: true } : null;
            record.migration = { from: "4.3", changed: [] };
            if (held) {
                const source = WorldRecord.settingsSource(record, (id) => records.get(id) ?? null);
                record.migration = { from: "4.3", ...WorldMigration.#carryUp(settings, source) };
                record.settings = { setup: settings.setup };
                changed.add(source.id);
            }
            records.set(record.id, record);
            changed.add(record.id);
            metas.push({ mapId: map.id, meta: { worldId: record.id, mapType: MAP_TYPES.SURFACE, revision: 1, savedAt: null } });
        }
        for (const record of records.values()) {
            if (!record.held || RegionalRecord.isCurrent(record.regional)) continue;
            record.regional = WorldMigration.regionalOf(record, records, byMap);
            changed.add(record.id);
        }
        return { worlds: [...changed].map((id) => records.get(id)), metas };
    }

    /**
     * A held world's regional record, made from what the maps hold (see the class comment).
     * @param {object} world - The held world.
     * @param {Map<string, object>} records - Every world record, by id.
     * @param {Map<string, object>} byMap - Every saved map's entry, by id.
     * @returns {object}
     */
    static regionalOf(world, records, byMap) {
        const mapId = world.maps?.find((map) => map.type === MAP_TYPES.SURFACE)?.id ?? world.maps?.[0]?.id;
        const parentWorld = records.get(world.parentWorldId);
        const sourceMapId = world.regional?.sourceMapId ?? parentWorld?.maps?.find((map) => map.type === MAP_TYPES.SURFACE)?.id ?? null;
        const own = byMap.get(mapId)?.mapData;
        const parent = sourceMapId ? byMap.get(sourceMapId)?.mapData : null;
        const entry = { mapId, sourceMapId };
        if (own) {
            const size = Number.isInteger(own.mapWidth) && Number.isInteger(own.mapHeight) ? { width: own.mapWidth, height: own.mapHeight } : null;
            const frame = parent && size ? ParentRunRecovery.frame(parent, { world: own.world, mapWidth: own.mapWidth, mapHeight: own.mapHeight }) : null;
            const place = TerrainVersion.resolveWorld(own);
            const root = size && [place.zoom, place.originX, place.originY].every(Number.isFinite) && place.zoom > 0 ? { x: place.originX, y: place.originY, width: size.width / place.zoom, height: size.height / place.zoom } : null;
            Object.assign(entry, {
                size,
                crop: frame || root ? { parent: frame?.crop ?? null, root } : null,
                zoom: frame?.zoomScale ?? null,
                rootZoom: root ? place.zoom : null,
                inheritedStrokes: size ? StrokeHistory.inheritedCount(own.history, parent?.history, frame, size) : 0,
            });
        }
        // Read back through the record's own check, so a map's odd values cannot reach the record
        return RegionalRecord.check(RegionalRecord.create({ migrated: true, maps: mapId ? [entry] : [] }));
    }

    /**
     * Whether a v4.3 regional map becomes a held regional world (see above).
     * @param {object} map - The regional map's entry.
     * @param {object} parent - Its parent's entry.
     */
    static isHeld(map, parent) {
        if (map.mapData.parentRun) return true;
        if (map.hasModelRun) return false;
        const parentHasRun = parent.hasModelRun || !!parent.mapData?.parentRun;
        return parentHasRun && inheritsRun(map.mapData);
    }

    /**
     * Saves the worlds the maps without one need (see plan). The first time a store with maps is
     * migrated, a backup of every map is written to the host's data first, where the host can keep
     * one (Foundry). A backup that cannot be written is reported and the migration goes on: it only
     * adds records, so the maps stay as they were until one is saved in v5 (Ken, 2026-11-18).
     * @returns {Promise<{worlds: number, maps: number, backup: string|null, backupFailed?: boolean}>}
     */
    static async run() {
        const [maps, saved] = await Promise.all([platform.store.listMapData(), platform.store.listWorlds()]);
        const worlds = new Map(saved.map((world) => [world.id, world]));
        const { worlds: records, metas } = WorldMigration.plan({ maps, worlds, icons: WorldMigration.hostIcons() });
        if (!metas.length && !records.length) return { worlds: 0, maps: 0, backup: null };

        let backup = null;
        let backupFailed = false;
        if (worlds.size === 0) {
            try {
                backup = await WorldMigration.#backUp(maps);
            } catch (error) {
                console.warn("FWMB | The backup before making maps into worlds could not be written:", error);
                platform.notify.warn(platform.i18n.localize("FILRODENSWMB.UI.MigrationBackupFailed"), { permanent: true });
                backupFailed = true;
            }
        }
        // The worlds first: a map is only taken as migrated once it names a world that is saved
        for (const record of records) await platform.store.saveWorld(record);
        for (const { mapId, meta } of metas) await platform.store.saveMapMeta(mapId, meta);
        return backupFailed ? { worlds: records.length, maps: metas.length, backup, backupFailed } : { worlds: records.length, maps: metas.length, backup };
    }

    /** The custom pin icons the host's settings hold (4.3 kept them there, one set for the host). */
    static hostIcons() {
        const custom = platform.settings.get(FILRODENSWMB.PIN_ICONS.SETTINGS.CUSTOM);
        const disabled = platform.settings.get(FILRODENSWMB.PIN_ICONS.SETTINGS.DISABLED);
        return { custom: Array.isArray(custom) ? structuredClone(custom) : [], disabled: Array.isArray(disabled) ? [...disabled] : [] };
    }

    /**
     * A held map's styles and custom biomes that the world its settings come from lacks, added to
     * that world; and the groups in which the two differed otherwise.
     * @returns {{changed: string[], addedStyles: number, addedBiomes: number}}
     */
    static #carryUp(own, source) {
        const target = source.settings;
        let addedStyles = 0;
        target.styles ??= {};
        for (const list of STYLE_LISTS) {
            const mine = own.styles?.[list];
            const theirs = target.styles[list];
            if (!Array.isArray(mine) || !Array.isArray(theirs)) continue;
            const ids = new Set(theirs.map((style) => style?.id));
            for (const style of mine) {
                if (style?.id && !ids.has(style.id)) {
                    theirs.push(structuredClone(style));
                    ids.add(style.id);
                    addedStyles += 1;
                }
            }
        }
        let addedBiomes = 0;
        const myBiomes = own.biomes?.custom;
        if (Array.isArray(myBiomes) && myBiomes.length) {
            target.biomes ??= {};
            target.biomes.custom ??= [];
            const ids = new Set(target.biomes.custom.map((biome) => biome?.id));
            for (const biome of myBiomes) {
                if (biome?.id !== undefined && !ids.has(biome.id)) {
                    target.biomes.custom.push(structuredClone(biome));
                    ids.add(biome.id);
                    addedBiomes += 1;
                }
            }
            const highest = Math.max(0, ...target.biomes.custom.map((biome) => (Number.isInteger(biome?.id) ? biome.id : 0)));
            const counters = [target.biomes.nextId, own.biomes?.nextId, highest + 1].filter(Number.isInteger);
            if (counters.length) target.biomes.nextId = Math.max(...counters);
        }
        const linked = WorldRecord.linked(own, target);
        const changed = WorldRecord.changedGroups({ ...own, icons: linked.icons }, linked).filter((group) => group !== "setup");
        return { changed, addedStyles, addedBiomes };
    }

    /** A backup of every map, written to the host's data before the first migration (Foundry). */
    static async #backUp(maps) {
        if (typeof platform.store.keepWorldFile !== "function") return null;
        const files = [];
        for (const map of maps) {
            if (!map.mapData) continue;
            const [owners, modelRun] = await Promise.all([platform.store.loadMapOwners(map.id), platform.store.loadMapModelRun(map.id)]);
            const { file } = await MapPackage.prepare({ mapData: map.mapData, owners, modelRun, name: map.name, mode: "keep" });
            files.push({ id: map.id, name: map.name, parentId: map.mapData.parentId ?? null, file });
        }
        // JSON: Foundry refuses a zip uploaded into the world's data. Restore reads either.
        const bytes = Backup.packJson({ maps: files, app: platform.module.host, version: platform.module.version });
        const stamp = new Date().toISOString().slice(0, 10);
        return platform.store.keepWorldFile(BACKUP_FOLDER, `before-5.0.0-${stamp}.json`, bytes, "application/json");
    }
}

/** Whether a map holds content generated by a run (each item's `generated.run`). */
function inheritsRun(mapData) {
    const regions = (mapData.layerSets ?? []).flatMap((set) => set.levels ?? []).flatMap((level) => level.regions ?? []);
    return [...(mapData.mapPins ?? []), ...(mapData.mapRoutes ?? []), ...regions].some((item) => !!item?.generated?.run);
}

/** Maps ordered parents before their children (a loop, which only a damaged store holds, ends where it closes). */
function byDepth(maps, byMap) {
    const depth = (map) => {
        let count = 0;
        const seen = new Set([map.id]);
        for (let node = map; node?.mapData?.parentId && byMap.has(node.mapData.parentId) && !seen.has(node.mapData.parentId); count++) {
            seen.add(node.mapData.parentId);
            node = byMap.get(node.mapData.parentId);
        }
        return count;
    };
    return [...maps].sort((a, b) => depth(a) - depth(b));
}
