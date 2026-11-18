// The world file (src/studios/world/data/WorldFile.js): a world and its map written standing alone,
// and read back as a map file the import checks as it checks any.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { WorldFile, WORLD_FILE_FORMAT } from "../../src/studios/world/data/WorldFile.js";
import { WorldSettings } from "../../src/studios/world/data/WorldSettings.js";
import { MapImport } from "../../src/studios/world/data/MapImport.js";
import { ImportRefusal } from "../../src/kernel/data/Sanitize.js";
import { RegionalRecord } from "../../src/kernel/worlds/RegionalRecord.js";

const map = JSON.parse(readFileSync(new URL("./fixtures/fwmb_eldoria.json", import.meta.url), "utf8"));
const ICON = { id: "icon1", name: "Tower", path: "data:image/svg+xml;base64,PHN2Zy8+" };
const file = { name: "Eldoria", ...structuredClone(map), owners: { level1: "abc" }, pinIcons: [ICON] };
const HASH = "f".repeat(32);
const CUT_FROM = { name: "Aethoria", worldId: "worldParent00001", mapId: "mapParent0000001" };
const REGIONAL = RegionalRecord.create({ migrated: true, maps: [{ mapId: "m1", sourceMapId: "mapParent0000001", inheritedStrokes: 14, cutBase: HASH }] });
const write = (options = {}) => WorldFile.write({ name: "Eldoria", mapId: "m1", file, disabledIcons: ["anchor"], cutFrom: CUT_FROM, held: true, regional: REGIONAL, blobs: new Map([[HASH, new Uint8Array([1, 2, 3])]]), version: "5.0.0", exportedAt: new Date("2026-11-18T12:00:00Z"), ...options });

test("a world file holds the world's settings once and its map without them", () => {
    const written = write();
    assert.equal(written.format, WORLD_FILE_FORMAT);
    assert.equal(written.formatVersion, 5);
    assert.deepEqual(written.module, { version: "5.0.0" });
    assert.equal(written.world.name, "Eldoria");
    assert.deepEqual(written.world.cutFrom, CUT_FROM);
    assert.equal(written.world.held, true);
    assert.deepEqual(written.world.regional, REGIONAL);
    assert.deepEqual(Object.keys(written.world.blobs), [HASH]);
    assert.deepEqual(written.world.settings.icons, { custom: [ICON], disabled: ["anchor"] });
    assert.deepEqual(written.world.settings, { ...WorldSettings.split(map).settings, icons: written.world.settings.icons });
    const [entry] = written.maps;
    assert.deepEqual([entry.id, entry.type], ["m1", "surface"]);
    assert.ok(!("cultures" in entry.file) && !("seed" in entry.file), "the world's settings are not in the map");
    assert.ok(!("parentId" in entry.file), "the link to the parent is the world's");
    assert.ok(!("pinIcons" in entry.file) && !("name" in entry.file));
    assert.deepEqual(entry.file.owners, { level1: "abc" });
});

test("reading it gives back the map file, the world's settings merged in, and its link to the parent", () => {
    const read = WorldFile.read(JSON.parse(JSON.stringify(write())));
    assert.equal(read.name, "Eldoria");
    assert.deepEqual(read.disabledIcons, ["anchor"]);
    const [{ type, file: back }] = read.maps;
    assert.equal(type, "surface");
    const { parentId: _parentId, ...expected } = map;
    const { name: _name, owners, pinIcons, parentId, ...data } = back;
    assert.equal(parentId, CUT_FROM.mapId, "the map it was cut from, for the import to look for");
    assert.deepEqual(read.world, { id: "file", held: true, parentWorldId: CUT_FROM.worldId, maps: [{ id: "m1", type: "surface" }], regional: REGIONAL });
    assert.deepEqual(read.blobBytes(HASH), new Uint8Array([1, 2, 3]));
    assert.equal(read.blobBytes("e".repeat(32)), null);
    assert.deepEqual(data, WorldSettings.merge(WorldSettings.split(expected).settings, WorldSettings.split(expected).mapData));
    assert.deepEqual(owners, { level1: "abc" });
    assert.deepEqual(pinIcons, [ICON]);
    // And the import checks it as any map file
    const imported = MapImport.read(back, { newId: () => "x" });
    assert.equal(imported.name, "Eldoria");
    assert.equal(imported.mapData.seed, map.seed);
    assert.equal(imported.mapData.parentId, CUT_FROM.mapId);
});

test("a world not cut from anything has no link, and is never held", () => {
    const written = write({ cutFrom: null, held: true });
    assert.equal(written.world.held, false);
    assert.ok(!("cutFrom" in written.world) && !("regional" in written.world) && !("blobs" in written.world));
    const read = WorldFile.read(written);
    assert.equal(read.maps[0].file.parentId, undefined);
    assert.deepEqual([read.world.held, read.world.parentWorldId, read.world.regional], [false, null, null]);
});

test("a damaged link or record reads safely", () => {
    const written = write();
    written.world.cutFrom = { worldId: "../evil", mapId: "x" };
    let read = WorldFile.read(written);
    assert.deepEqual([read.world.held, read.world.parentWorldId, read.maps[0].file.parentId], [false, null, undefined]);
    const other = write();
    other.world.regional = { version: 1, maps: [{ mapId: "m1", cutBase: "nope", inheritedStrokes: -1 }] };
    other.world.blobs = { [HASH]: "not base64!" };
    read = WorldFile.read(other);
    assert.deepEqual([read.world.regional.maps[0].cutBase, read.world.regional.maps[0].inheritedStrokes], [null, 0]);
    assert.equal(read.blobBytes(HASH), null);
});

test("a world file this version cannot read is refused", () => {
    const refusal = (value, reason) => assert.throws(() => WorldFile.read(value), (error) => error instanceof ImportRefusal && error.reason === reason);
    refusal({ ...write(), formatVersion: 6 }, "newer");
    refusal({ ...write(), formatVersion: "5" }, "damaged");
    refusal({ ...write(), world: null }, "damaged");
    refusal({ ...write(), maps: [] }, "damaged");
    refusal({ ...write(), maps: [{ type: "geology", file: {} }] }, "damaged");
    refusal({ ...write(), maps: new Array(17).fill(write().maps[0]) }, "damaged");
    refusal({ format: "other" }, "notMap");
});

test("map types this version does not know are passed over, and a damaged icon list reads as none", () => {
    const written = write();
    written.maps.unshift({ type: "geology", file: { anything: true } });
    written.world.settings.icons = "broken";
    const read = WorldFile.read(written);
    assert.equal(read.maps.length, 1);
    assert.deepEqual(read.maps[0].file.pinIcons, []);
    assert.deepEqual(read.disabledIcons, []);
});
