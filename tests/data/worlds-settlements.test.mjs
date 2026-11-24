// A world's settlement maps (L-surface step 2a): part of their world, not saved maps. Over the web
// host's store in memory, which gives the same results as Foundry's (a page each of the world's
// journal there). Step 2b: what is Out of date kept on each card at a save, and Clone as new of a
// held regional world taking its parents' settlement maps of the pins on its map.
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { installPlatform, platform } from "../../src/platform/index.js";
import { createWebStore, MemoryRecords } from "../../src/platform/web/store.js";

let next = 0;
const newId = () => `id${String(++next).padStart(4, "0")}`;
installPlatform({ ...platform, utils: { ...platform.utils, randomID: newId } });

const { Worlds } = await import("../../src/kernel/worlds/Worlds.js");
const { WorldRecord } = await import("../../src/kernel/worlds/WorldRecord.js");

let clock = 0;
Worlds.now = () => `2026-11-24T00:00:${String(clock++).padStart(2, "0")}.000Z`;
Worlds.newSettlementId = () => `st${String(++next).padStart(4, "0")}`;
Worlds.pageOf = async (record) => ({ name: record.name, html: `<p>${record.name}</p>` });

let records;
beforeEach(() => {
    records = new MemoryRecords();
    installPlatform({ store: createWebStore(records, { newId }) });
});

const SETTINGS = { setup: { seed: "abc" }, icons: { custom: [], disabled: [] } };
const surface = (extra = {}) => ({ id: null, type: "surface", data: { mapWidth: 10, mapHeight: 10, mapPins: [] }, owners: {}, modelRun: null, changed: true, ...extra });
const settlement = (id, pinId, name, sourceMapId = null) => {
    const record = { format: "fwmb-settlement", version: 1, id, pinId, sourceMapId, name, seed: `S:${pinId}`, input: { tier: "town", population: 2500 }, parts: { people: "0123abcd" } };
    return { record, card: { id, pinId, sourceMapId, name, tier: "town", people: 2500, parts: { people: "0123abcd" }, stale: [] }, page: { name, html: `<p>${name}</p>` } };
};

test("a world's first save writes its settlement maps, made from its Surface map, and cards for them", async () => {
    const { world, maps, settlements } = await Worlds.save({ world: null, name: "Aethoria", settings: SETTINGS, maps: [surface()], settlements: { saved: [settlement("sA", "p1", "Castford"), settlement("sB", "p2", "Kingsbridge")] } });
    const surfaceId = maps[0].id;
    assert.deepEqual(settlements, [{ from: "sA", id: "sA" }, { from: "sB", id: "sB" }]);
    assert.deepEqual(world.settlements.map((card) => [card.id, card.pinId, card.sourceMapId, card.revision]), [["sA", "p1", surfaceId, 1], ["sB", "p2", surfaceId, 1]]);
    const stored = await platform.store.listSettlementMaps(world.id);
    assert.deepEqual(stored.map((record) => [record.id, record.sourceMapId, record.revision]).sort(), [["sA", surfaceId, 1], ["sB", surfaceId, 1]]);
    // Never saved maps: the saved maps' lists and the migration never see them
    assert.deepEqual((await platform.store.listMaps()).map((map) => map.id), [surfaceId]);
    assert.equal((await platform.store.getSavedMaps()).length, 1);
    assert.deepEqual(await Worlds.tree().then((tree) => tree[0].settlements), 2);
});

test("a later save writes only the settlement maps changed, deletes those deleted, keeps the rest", async () => {
    const first = await Worlds.save({ world: null, name: "Aethoria", settings: SETTINGS, maps: [surface()], settlements: { saved: [settlement("sA", "p1", "Castford"), settlement("sB", "p2", "Kingsbridge"), settlement("sC", "p3", "Oakham")] } });
    const writes = [];
    const store = platform.store;
    installPlatform({ store: { ...store, saveSettlementMap: (worldId, record, page) => (writes.push(record.id), store.saveSettlementMap(worldId, record, page)) } });
    const changed = settlement("sB", "p2", "Kingsbridge");
    changed.record.seed = "S:other";
    const { world } = await Worlds.save({ world: first.world, name: "Aethoria", settings: SETTINGS, maps: [surface({ id: first.maps[0].id, changed: false })], settlements: { saved: [changed, settlement("sD", "p4", "Holloway")], deleted: ["sC"] } });
    assert.deepEqual(writes, ["sB", "sD"], "one write each, the others left alone");
    assert.deepEqual(world.settlements.map((card) => [card.id, card.revision]), [["sA", 1], ["sB", 2], ["sD", 1]]);
    const stored = new Map((await platform.store.listSettlementMaps(world.id)).map((record) => [record.id, record]));
    assert.deepEqual([...stored.keys()].sort(), ["sA", "sB", "sD"]);
    assert.equal(stored.get("sB").seed, "S:other");
});

test("Save as copies the world's settlement maps under new ids, made from the copy's Surface map", async () => {
    const first = await Worlds.save({ world: null, name: "Aethoria", settings: SETTINGS, maps: [surface()], settlements: { saved: [settlement("sA", "p1", "Castford"), settlement("sB", "p2", "Kingsbridge")] } });
    const kept = settlement("sB", "p2", "Kingsbridge", first.maps[0].id);
    const { world, maps, settlements } = await Worlds.save({ world: first.world, name: "Aethoria II", settings: SETTINGS, maps: [surface({ id: first.maps[0].id })], asNew: true, settlements: { saved: [kept] } });
    assert.notEqual(world.id, first.world.id);
    assert.equal(settlements.length, 2);
    assert.ok(settlements.every(({ from, id }) => from !== id), "every copy has a new id");
    const copies = await platform.store.listSettlementMaps(world.id);
    assert.deepEqual(copies.map((record) => record.sourceMapId), [maps[0].id, maps[0].id]);
    assert.deepEqual(copies.map((record) => record.pinId).sort(), ["p1", "p2"], "the copy's pins keep their ids");
    // The original keeps its own
    assert.equal((await platform.store.listSettlementMaps(first.world.id)).length, 2);
    // A world rename leaves them their names
    await Worlds.rename(world.id, "Renamed");
    assert.deepEqual((await Worlds.get(world.id)).settlements.map((card) => card.name).sort(), ["Castford", "Kingsbridge"]);
});

test("Duplicate and Clone as new take the settlement maps along; deleting a world deletes them", async () => {
    const first = await Worlds.save({ world: null, name: "Aethoria", settings: SETTINGS, maps: [surface()], settlements: { saved: [settlement("sA", "p1", "Castford")] } });
    const copy = await Worlds.copy(first.world.id, "Copy");
    const [copied] = await platform.store.listSettlementMaps(copy.id);
    assert.equal(copied.pinId, "p1");
    assert.equal(copied.sourceMapId, Worlds.mapOf(copy));
    assert.deepEqual(copy.settlements.map((card) => card.id), [copied.id]);
    const clone = await Worlds.cloneAsNew(first.world.id, "Clone");
    assert.equal((await platform.store.listSettlementMaps(clone.id)).length, 1);
    await Worlds.delete(first.world.id);
    assert.deepEqual(await platform.store.listSettlementMaps(first.world.id), []);
    assert.equal((await platform.store.listSettlementMaps(copy.id)).length, 1, "a copy's stay");
});

test("many settlement maps in one world, each stored on its own", async () => {
    const saved = Array.from({ length: 120 }, (_, i) => settlement(`s${i}`, `p${i}`, `Town ${i}`));
    const { world } = await Worlds.save({ world: null, name: "Many", settings: SETTINGS, maps: [surface()], settlements: { saved } });
    assert.equal(world.settlements.length, 120);
    assert.equal((await platform.store.listSettlementMaps(world.id)).length, 120);
    assert.equal((await platform.store.loadSettlementMap(world.id, "s77")).name, "Town 77");
    assert.equal(await platform.store.loadSettlementMap("another", "s77"), null, "found only in its own world");
});

test("a settlement card is read safely", () => {
    assert.equal(WorldRecord.settlementCard({ name: "x" }), null, "no id");
    assert.deepEqual(WorldRecord.settlementCard({ id: "s1", pinId: "../p", name: " Castford ", tier: "town<b>", people: -3, parts: { people: "0123abcd", run: "nope", evil: "0123abcd" }, stale: ["people", "toString"], revision: 0, savedAt: "soon" }), { id: "s1", name: "Castford", parts: { people: "0123abcd" }, stale: ["people"] });
    assert.deepEqual(WorldRecord.settlementCards({ settlements: [{ id: "a" }, { id: "a" }, null, { id: "b" }] }).map((card) => card.id), ["a", "b"]);
});

test("a save keeps what is Out of date on each card, changed or not; a save that does not say leaves them as they were", async () => {
    const first = await Worlds.save({ world: null, name: "Aethoria", settings: SETTINGS, maps: [surface()], settlements: { saved: [settlement("sA", "p1", "Castford"), settlement("sB", "p2", "Kingsbridge")] } });
    const { world } = await Worlds.save({ world: first.world, name: "Aethoria", settings: SETTINGS, maps: [surface({ id: first.maps[0].id, changed: false })], settlements: { saved: [], stale: { sA: ["people", "routes"], sB: [] } } });
    assert.deepEqual(world.settlements.map((card) => [card.id, card.stale]), [["sA", ["people", "routes"]], ["sB", []]]);
    const again = await Worlds.save({ world, name: "Aethoria", settings: SETTINGS, maps: [surface({ id: first.maps[0].id, changed: false })], settlements: {} });
    assert.deepEqual(again.world.settlements.map((card) => card.stale), [["people", "routes"], []]);
});

test("Clone as new of a held regional world takes its parents' settlement maps of the pins on its map, with its own", async () => {
    const parent = await Worlds.save({ world: null, name: "Parent", settings: SETTINGS, maps: [surface()], settlements: { saved: [settlement("sA", "p1", "Castford"), settlement("sB", "p2", "Kingsbridge")] } });
    // A held world cut from it: p1 is on its map (its id kept by the cut), p2 is not; p9 is Fill in's, with its own map
    const held = WorldRecord.create({ id: "held", name: "Held", parentWorldId: parent.world.id, held: true, settings: { setup: { seed: "h" } } });
    await platform.store.saveWorld(held);
    const pins = [{ id: "p1", name: "Castford" }, { id: "p9", name: "Newfield", generated: { infill: true } }];
    const saved = await Worlds.save({ world: held, name: "Held", settings: { setup: { seed: "h" } }, maps: [surface({ data: { mapWidth: 10, mapHeight: 10, mapPins: pins } })], settlements: { saved: [settlement("sF", "p9", "Newfield")] } });
    const clone = await Worlds.cloneAsNew(saved.world.id, "Clone");
    const copies = await platform.store.listSettlementMaps(clone.id);
    assert.deepEqual(copies.map((record) => record.pinId).sort(), ["p1", "p9"], "its own, and the parent's on its map");
    assert.ok(copies.every((record) => record.sourceMapId === Worlds.mapOf(clone)), "made from the clone's Surface map");
    assert.ok(copies.every((record) => !["sA", "sF"].includes(record.id)), "each under a new id");
    assert.deepEqual(clone.settlements.map((card) => card.pinId).sort(), ["p1", "p9"]);
    // The parent keeps its own
    assert.equal((await platform.store.listSettlementMaps(parent.world.id)).length, 2);
});

