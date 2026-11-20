// A held regional world's record (src/kernel/worlds/RegionalRecord.js) and blobs
// (src/kernel/data/Blobs.js): made, changed, copied, and read safely from anywhere.
import assert from "node:assert/strict";
import { test } from "node:test";
import { gzipSync, strToU8 } from "../../vendor/fflate/fflate.js";
import { REGIONAL_VERSION, RegionalRecord } from "../../src/kernel/worlds/RegionalRecord.js";
import { Blobs, MAX_BLOB_BYTES } from "../../src/kernel/data/Blobs.js";

const HASH = "0123456789abcdef0123456789abcdef";
const entry = {
    mapId: "child1",
    sourceMapId: "parent1",
    crop: { parent: { x: 10, y: 20, width: 100, height: 80 }, root: { x: 10, y: 20, width: 100, height: 80 } },
    zoom: 4,
    rootZoom: 4,
    size: { width: 400, height: 320 },
    parentRevision: 3,
    parentSavedAt: "2026-11-18T10:00:00.000Z",
    cropFingerprint: "deadbeef",
    inheritedStrokes: 12,
    cutBase: HASH,
};
const record = () => RegionalRecord.create({ parentSettingsRevision: 2, cutAt: "2026-11-18T10:00:00.000Z", cutWith: { module: "5.0.0", terrainVersion: 3, generatorRevision: 4 }, maps: [entry] });

test("a new record has every field, at the record's version", () => {
    const made = record();
    assert.equal(made.version, REGIONAL_VERSION);
    assert.equal(made.migrated, false);
    assert.deepEqual(Object.keys(made.maps[0]).sort(), Object.keys(entry).sort());
    assert.ok(RegionalRecord.isCurrent(made));
    assert.ok(!RegionalRecord.isCurrent({ sourceMapId: "p", migrated: true }));
});

test("a sound record reads back unchanged", () => {
    assert.deepEqual(RegionalRecord.check(record()), record());
});

test("a map's part is found, changed, renamed for a copy, and names its blob", () => {
    const made = record();
    assert.equal(RegionalRecord.forMap(made, "child1").zoom, 4);
    assert.equal(RegionalRecord.forMap(made, "other"), null);
    const changed = RegionalRecord.withMap(made, "child1", { inheritedStrokes: 5 });
    assert.equal(RegionalRecord.forMap(changed, "child1").inheritedStrokes, 5);
    assert.equal(made.maps[0].inheritedStrokes, 12, "the original is not changed");
    const added = RegionalRecord.withMap(made, "child2", { zoom: 2 });
    assert.equal(added.maps.length, 2);
    assert.equal(RegionalRecord.forMap(added, "child2").cutBase, null);
    const copied = RegionalRecord.remap(made, new Map([["child1", "copy1"]]));
    assert.equal(copied.maps[0].mapId, "copy1");
    assert.deepEqual(RegionalRecord.blobsOf(made, "child1"), [HASH]);
    assert.deepEqual(RegionalRecord.blobsOf(made, "other"), []);
    assert.equal(RegionalRecord.remap(null, new Map()), null);
});

test("a damaged record reads safely: what cannot be trusted is null, the strokes 0", () => {
    const damaged = {
        version: REGIONAL_VERSION,
        parentSettingsRevision: -1,
        cutAt: "not a date",
        cutWith: { module: 5, terrainVersion: "3", evil: "<script>" },
        migrated: "yes",
        maps: [
            { ...entry, crop: { parent: { x: "1", y: 0, width: 10, height: 10 }, root: { x: 0, y: 0, width: -5, height: 10 } }, zoom: Infinity, rootZoom: 0, size: { width: 1.5, height: 10 }, parentRevision: 0, cropFingerprint: "xyz", inheritedStrokes: -3, cutBase: "../../etc/passwd", extra: "dropped" },
            { ...entry },
            { mapId: "../bad" },
            "not an entry",
        ],
        extra: "dropped",
    };
    const read = RegionalRecord.check(damaged);
    assert.deepEqual(Object.keys(read).sort(), ["cutAt", "cutWith", "maps", "migrated", "parentSettingsRevision", "version"]);
    assert.equal(read.parentSettingsRevision, null);
    assert.equal(read.cutAt, null);
    assert.equal(read.cutWith, null);
    assert.equal(read.migrated, false);
    assert.equal(read.maps.length, 1, "a repeated map, a bad id and a non-object are dropped");
    const [map] = read.maps;
    assert.deepEqual([map.crop, map.zoom, map.rootZoom, map.size, map.parentRevision, map.cropFingerprint, map.inheritedStrokes, map.cutBase], [null, null, null, null, null, null, 0, null]);
    assert.ok(!("extra" in map));
    assert.equal(RegionalRecord.check({ version: 99 }), null);
    assert.equal(RegionalRecord.check([]), null);
    assert.equal(RegionalRecord.check(null), null);
});

test("2a's placeholder is kept for the migration to fill in", () => {
    assert.deepEqual(RegionalRecord.check({ sourceMapId: "parent1", migrated: true, junk: 1 }), { sourceMapId: "parent1", migrated: true });
    assert.deepEqual(RegionalRecord.check({ sourceMapId: "<bad>" }), { migrated: false });
});

test("a blob packs, unpacks, and is known by its content", async () => {
    const value = { strokes: [{ x: 1, y: 2 }], name: "base" };
    const { hash, bytes } = await Blobs.pack(value);
    assert.match(hash, /^[0-9a-f]{32}$/);
    assert.deepEqual(await Blobs.unpack(bytes), value);
    assert.deepEqual(await Blobs.unpack(bytes, hash), value);
    assert.equal((await Blobs.pack(value)).hash, hash, "the same content, the same hash");
    assert.equal(await Blobs.unpack(bytes, "0".repeat(32)), null, "a hash that does not match");
    assert.equal(await Blobs.unpack(new Uint8Array([1, 2, 3, 4, 5, 6])), null);
    assert.equal(await Blobs.unpack("text"), null);
    const text = Blobs.toBase64(bytes);
    assert.deepEqual(Blobs.fromBase64(text), bytes);
    assert.equal(Blobs.fromBase64("not base64!"), null);
});

test("a blob claiming to unpack past the limit is refused before it is inflated", async () => {
    const bytes = gzipSync(strToU8("{}"));
    const size = MAX_BLOB_BYTES + 1;
    bytes.set([size & 0xff, (size >> 8) & 0xff, (size >> 16) & 0xff, (size >>> 24) & 0xff], bytes.length - 4);
    assert.equal(await Blobs.unpack(bytes), null);
});

// ------------------------------------------------------------------ Out of date (S0 step 5)

/** A chain: Aethoria, Westmarch cut from it (x4), Westmarch coast cut from Westmarch (x2), all held. */
function chain({ printTop = "aaaaaaaa", printMiddle = "bbbbbbbb", migrated = false } = {}) {
    const cut = (mapId, sourceMapId, fingerprint) => RegionalRecord.create({ parentSettingsRevision: 2, cutAt: "2026-11-18T10:00:00.000Z", migrated, maps: [{ ...entry, mapId, sourceMapId, cropFingerprint: fingerprint }] });
    const top = { id: "top", name: "Aethoria", held: false, settingsRevision: 2, settingsSavedAt: "2026-11-19T09:00:00.000Z", maps: [{ id: "mTop", type: "surface", savedAt: "2026-11-20T09:00:00.000Z" }], childFingerprints: { middle: { mMiddle: printTop } } };
    const middle = { id: "middle", name: "Westmarch", held: true, parentWorldId: "top", settingsRevision: 2, maps: [{ id: "mMiddle", type: "surface", savedAt: null }], regional: cut("mMiddle", "mTop", "aaaaaaaa"), childFingerprints: { coast: { mCoast: printMiddle } } };
    const coast = { id: "coast", name: "Westmarch coast", held: true, parentWorldId: "middle", settingsRevision: 1, maps: [{ id: "mCoast", type: "surface" }], regional: cut("mCoast", "mMiddle", "bbbbbbbb") };
    const worlds = new Map([top, middle, coast].map((world) => [world.id, world]));
    return { top, middle, coast, byId: (id) => worlds.get(id) ?? null };
}

test("a regional world cut and unchanged since is not Out of date", () => {
    const { top, middle, coast, byId } = chain();
    for (const world of [top, middle, coast]) assert.deepEqual(RegionalRecord.staleness(world, byId), [], world.name);
});

test("rule 1: the parent saved with changes inside the crop marks it, and every world below (rule 3)", () => {
    const { middle, coast, byId } = chain({ printTop: "cccccccc" });
    assert.deepEqual(RegionalRecord.staleness(middle, byId), [{ rule: "crop", parentId: "top", parentName: "Aethoria", at: "2026-11-20T09:00:00.000Z" }]);
    assert.deepEqual(RegionalRecord.staleness(coast, byId), [{ rule: "above", parentId: "middle", parentName: "Westmarch", at: null }]);
});

test("rule 1 on the middle world marks only the world cut from it", () => {
    const { middle, coast, byId } = chain({ printMiddle: "cccccccc" });
    assert.deepEqual(RegionalRecord.staleness(middle, byId), []);
    assert.deepEqual(RegionalRecord.staleness(coast, byId).map((reason) => reason.rule), ["crop"]);
});

test("rule 2: the parent's settings saved changed since the cut", () => {
    const { top, middle, byId } = chain();
    top.settingsRevision = 3;
    assert.deepEqual(RegionalRecord.staleness(middle, byId), [{ rule: "settings", parentId: "top", parentName: "Aethoria", at: "2026-11-19T09:00:00.000Z" }]);
});

test("a world cut before v5 is never Out of date, nor makes one below it so", () => {
    const { middle, coast, top, byId } = chain({ printTop: "cccccccc", migrated: true });
    top.settingsRevision = 9;
    assert.deepEqual(RegionalRecord.staleness(middle, byId), []);
    assert.deepEqual(RegionalRecord.staleness(coast, byId), []);
});

test("a parent with no fingerprint for the world (none worked out yet) does not mark it; a lost parent ends the climb", () => {
    const { middle, coast, top, byId } = chain();
    delete top.childFingerprints;
    assert.deepEqual(RegionalRecord.staleness(middle, byId), []);
    assert.deepEqual(RegionalRecord.staleness({ ...coast, parentWorldId: "gone" }, byId), []);
    assert.deepEqual(RegionalRecord.staleness({ ...middle, held: false }, byId), [], "only a held world");
});

test("a chain that loops back on itself is read without end", () => {
    const { middle, top, byId } = chain({ printTop: "cccccccc" });
    Object.assign(top, { held: true, parentWorldId: "middle", regional: middle.regional });
    assert.ok(Array.isArray(RegionalRecord.staleness(middle, byId)));
});

test("the parent's fingerprints read safely", () => {
    assert.deepEqual(RegionalRecord.checkChildFingerprints({ w1: { m1: "deadbeef", m2: "nothex!!", "bad id!": "deadbeef" }, "bad id!": { m1: "deadbeef" }, w2: "x", w3: {} }), { w1: { m1: "deadbeef" } });
    assert.deepEqual(RegionalRecord.checkChildFingerprints(null), {});
});
