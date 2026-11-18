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
