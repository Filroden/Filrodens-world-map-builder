/**
 * A held regional world's record (`claude/v5-s0-shell-handoff.md` §4; why each field is kept:
 * `claude/v5-r-regional-diff.md` §6): what a later release needs to update a regional world from
 * its parent without cutting it again, and what v5 needs to tell when its parent has changed
 * something it shows.
 *
 *     regional: {
 *       version: 1,
 *       parentSettingsRevision,   // the parent world's settingsRevision at the cut, or null
 *       cutAt,                    // when it was cut (an ISO date), or null
 *       cutWith,                  // { module, terrainVersion, generatorRevision } it was cut with, or null
 *       migrated,                 // cut before v5: no base and no fingerprint, never Out of date
 *       maps: [{
 *         mapId,                  // the regional world's map
 *         sourceMapId,            // the parent's map it was cut from
 *         crop: { parent, root }, // { x, y, width, height } in the parent's pixels and the root world's
 *         zoom, rootZoom,         // the zoom from its parent, and the product of zooms from the root world
 *         size,                   // { width, height } of the map
 *         parentRevision,         // the parent map's revision and savedAt at the cut, or null
 *         parentSavedAt,
 *         cropFingerprint,        // FNV-1a hash (8 hex) of the parent's content reaching the crop, or null
 *         inheritedStrokes,       // how many strokes at the head of the map's history are the parent's
 *         cutBase,                // the hash (32 hex) of what the cut delivered, kept with the map, or null
 *       }],
 *     }
 *
 * The parent world keeps, for each regional world held by it, the fingerprint each of its maps'
 * crops has now (worked out again whenever the parent is saved changed):
 *
 *     childFingerprints: { [childWorldId]: { [childMapId]: "8 hex" } }
 *
 * A held regional world is **Out of date** (§4's three rules, see staleness) when the parent's
 * fingerprint for one of its maps differs from that map's `cropFingerprint`, when the parent's
 * settings were saved changed since the cut, or when a world above it is Out of date.
 *
 * Every function here is pure. `check` reads a record from anywhere (a saved world, an imported
 * file, a backup) and never throws: a field it cannot trust is set to null, or to 0 for the
 * inherited strokes (Undo then goes as far as it always has), and a record it cannot read at all
 * is null.
 */

/** The record's own version: a record without it is 2a's placeholder, filled in by the migration. */
export const REGIONAL_VERSION = 1;

/** A blob's hash, as MapPackage names an asset: the first 128 bits of a SHA-256, in hex. */
export const BLOB_HASH = /^[0-9a-f]{32}$/;
/** The crop fingerprint: a 32-bit FNV-1a, in hex. */
const FINGERPRINT = /^[0-9a-f]{8}$/;
/** A record id (Foundry's and the web's random ids, and ids a test gives). */
const ID = /^[A-Za-z0-9_-]{1,64}$/;
/** The largest map side, in pixels, a record may name (well past any map the module makes). */
const MAX_SIDE = 1e7;
/** The largest zoom a chain of crops may reach. */
const MAX_ZOOM = 1e6;
/** The most strokes a history may hold, for the count to be believed. */
const MAX_STROKES = 1e7;
const MAX_TEXT = 40;

export class RegionalRecord {
    /**
     * A new record.
     * @param {object} [fields]
     * @returns {object}
     */
    static create({ parentSettingsRevision = null, cutAt = null, cutWith = null, migrated = false, maps = [] } = {}) {
        return { version: REGIONAL_VERSION, parentSettingsRevision, cutAt, cutWith, migrated: migrated === true, maps: maps.map((entry) => RegionalRecord.mapEntry(entry)) };
    }

    /** One map's part of the record, every field present. */
    static mapEntry({ mapId, sourceMapId = null, crop = null, zoom = null, rootZoom = null, size = null, parentRevision = null, parentSavedAt = null, cropFingerprint = null, inheritedStrokes = 0, cutBase = null }) {
        return { mapId, sourceMapId, crop, zoom, rootZoom, size, parentRevision, parentSavedAt, cropFingerprint, inheritedStrokes, cutBase };
    }

    /** Whether a record is v5's (2a wrote a placeholder without a version). */
    static isCurrent(record) {
        return record?.version === REGIONAL_VERSION;
    }

    /** A map's part of a record, or null. */
    static forMap(record, mapId) {
        return (Array.isArray(record?.maps) && record.maps.find((entry) => entry?.mapId === mapId)) || null;
    }

    /** The record with one map's part changed (added if absent). */
    static withMap(record, mapId, changes) {
        const next = structuredClone(record);
        const at = next.maps.findIndex((entry) => entry.mapId === mapId);
        if (at < 0) next.maps.push(RegionalRecord.mapEntry({ mapId, ...changes }));
        else next.maps[at] = { ...next.maps[at], ...changes, mapId };
        return next;
    }

    /** The record for a copy of its world, its maps renamed (`idMap` old id → new id). */
    static remap(record, idMap) {
        if (!record) return null;
        const next = structuredClone(record);
        if (Array.isArray(next.maps)) next.maps = next.maps.filter((entry) => idMap.has(entry?.mapId)).map((entry) => ({ ...entry, mapId: idMap.get(entry.mapId) }));
        return next;
    }

    /** The blob hashes a record names for one map: what that map must keep. */
    static blobsOf(record, mapId) {
        const hash = RegionalRecord.forMap(record, mapId)?.cutBase;
        return typeof hash === "string" && BLOB_HASH.test(hash) ? [hash] : [];
    }

    /**
     * A record read safely (see the class comment), or null when it is not one. A placeholder
     * from 2a (no version) is kept as it is for the migration to fill in, its two fields checked.
     * @param {*} value
     * @returns {object|null}
     */
    static check(value) {
        if (!isObject(value)) return null;
        if (value.version === undefined) {
            const placeholder = { migrated: value.migrated === true };
            if (isId(value.sourceMapId)) placeholder.sourceMapId = value.sourceMapId;
            return placeholder;
        }
        if (value.version !== REGIONAL_VERSION) return null;
        const maps = Array.isArray(value.maps) ? value.maps.map(checkEntry).filter(Boolean) : [];
        const seen = new Set();
        return {
            version: REGIONAL_VERSION,
            parentSettingsRevision: revision(value.parentSettingsRevision),
            cutAt: text(value.cutAt),
            cutWith: checkCutWith(value.cutWith),
            migrated: value.migrated === true,
            maps: maps.filter((entry) => !seen.has(entry.mapId) && seen.add(entry.mapId)),
        };
    }

    /** The parent's fingerprints for the worlds it holds (see the class comment), read safely: {} when none. */
    static checkChildFingerprints(value) {
        const out = {}
        if (!isObject(value)) return out;
        for (const [worldId, maps] of Object.entries(value)) {
            if (!isId(worldId) || !isObject(maps)) continue;
            const kept = {}
            for (const [mapId, hash] of Object.entries(maps)) if (isId(mapId) && typeof hash === "string" && FINGERPRINT.test(hash)) kept[mapId] = hash;
            if (Object.keys(kept).length) out[worldId] = kept;
        }
        return out;
    }

    /**
     * Why a held regional world is Out of date (§4's three rules), most direct first, or an empty
     * list when it is not. A record made by the migration is never Out of date (v5 cannot tell what
     * its parent changed), and a world above that is migrated never makes one below it so.
     *
     *     { rule: "crop", parentId, parentName, at }      // the parent was saved with changes inside its crop
     *     { rule: "settings", parentId, parentName, at }  // the parent's settings were saved changed
     *     { rule: "above", parentId, parentName, at }     // the world it was cut from is Out of date
     *
     * @param {object} world - The world record.
     * @param {function(string): (object|null)} byId - Any world record by id.
     * @returns {Array<{rule: string, parentId: string, parentName: string, at: string|null}>}
     */
    static staleness(world, byId, seen = new Set()) {
        const record = world?.regional;
        if (!world?.held || !RegionalRecord.isCurrent(record) || record.migrated || seen.has(world.id)) return [];
        seen.add(world.id);
        const parent = world.parentWorldId ? byId(world.parentWorldId) : null;
        if (!parent) return [];
        const about = { parentId: parent.id, parentName: parent.name ?? "" }
        const reasons = [];
        const prints = parent.childFingerprints?.[world.id] ?? {}
        const moved = record.maps.find((entry) => entry.cropFingerprint && typeof prints[entry.mapId] === "string" && prints[entry.mapId] !== entry.cropFingerprint);
        if (moved) reasons.push({ rule: "crop", ...about, at: (parent.maps ?? []).find((map) => map.id === moved.sourceMapId)?.savedAt ?? null });
        if (Number.isInteger(record.parentSettingsRevision) && Number.isInteger(parent.settingsRevision) && parent.settingsRevision > record.parentSettingsRevision) {
            reasons.push({ rule: "settings", ...about, at: parent.settingsSavedAt ?? null });
        }
        if (RegionalRecord.staleness(parent, byId, seen).length) reasons.push({ rule: "above", ...about, at: null });
        return reasons;
    }

}

function checkEntry(entry) {
    if (!isObject(entry) || !isId(entry.mapId)) return null;
    const crop = isObject(entry.crop) ? { parent: rect(entry.crop.parent), root: rect(entry.crop.root) } : null;
    return RegionalRecord.mapEntry({
        mapId: entry.mapId,
        sourceMapId: isId(entry.sourceMapId) ? entry.sourceMapId : null,
        crop: crop && (crop.parent || crop.root) ? crop : null,
        zoom: positive(entry.zoom, MAX_ZOOM),
        rootZoom: positive(entry.rootZoom, MAX_ZOOM),
        size: checkSize(entry.size),
        parentRevision: revision(entry.parentRevision),
        parentSavedAt: text(entry.parentSavedAt),
        cropFingerprint: typeof entry.cropFingerprint === "string" && FINGERPRINT.test(entry.cropFingerprint) ? entry.cropFingerprint : null,
        inheritedStrokes: Number.isInteger(entry.inheritedStrokes) && entry.inheritedStrokes >= 0 && entry.inheritedStrokes <= MAX_STROKES ? entry.inheritedStrokes : 0,
        cutBase: typeof entry.cutBase === "string" && BLOB_HASH.test(entry.cutBase) ? entry.cutBase : null,
    });
}

function checkCutWith(value) {
    if (!isObject(value)) return null;
    const out = {};
    if (typeof value.module === "string" && value.module.length <= MAX_TEXT) out.module = value.module;
    for (const key of ["terrainVersion", "generatorRevision"]) if (Number.isInteger(value[key]) && value[key] >= 0 && value[key] <= MAX_STROKES) out[key] = value[key];
    return Object.keys(out).length ? out : null;
}

function rect(value) {
    if (!isObject(value)) return null;
    const { x, y, width, height } = value;
    if (![x, y].every((n) => Number.isFinite(n) && Math.abs(n) <= MAX_SIDE)) return null;
    if (![width, height].every((n) => Number.isFinite(n) && n > 0 && n <= MAX_SIDE)) return null;
    return { x, y, width, height };
}

function checkSize(value) {
    if (!isObject(value)) return null;
    const { width, height } = value;
    return [width, height].every((n) => Number.isInteger(n) && n > 0 && n <= MAX_SIDE) ? { width, height } : null;
}

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const isId = (value) => typeof value === "string" && ID.test(value);
const positive = (value, max) => (Number.isFinite(value) && value > 0 && value <= max ? value : null);
const revision = (value) => (Number.isInteger(value) && value >= 1 && value <= Number.MAX_SAFE_INTEGER ? value : null);
const text = (value) => (typeof value === "string" && value.length > 0 && value.length <= MAX_TEXT && !Number.isNaN(Date.parse(value)) ? value : null);
