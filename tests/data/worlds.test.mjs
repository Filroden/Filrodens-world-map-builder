// The world records and their maps (src/kernel/worlds), over the web host's store in memory, which
// gives the same results as Foundry's compendium store.
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { installPlatform, platform } from "../../src/platform/index.js";
import { createWebStore, MemoryRecords } from "../../src/platform/web/store.js";

let next = 0;
const newId = () => `id${String(++next).padStart(4, "0")}`;
installPlatform({ ...platform, utils: { ...platform.utils, randomID: newId } });

const { Worlds } = await import("../../src/kernel/worlds/Worlds.js");
const { WorldRecord, WORLD_FORMAT } = await import("../../src/kernel/worlds/WorldRecord.js");

let clock = 0;
Worlds.now = () => `2026-11-18T00:00:${String(clock++).padStart(2, "0")}.000Z`;

beforeEach(() => {
    installPlatform({ store: createWebStore(new MemoryRecords(), { newId }) });
});

const SETTINGS = { setup: { seed: "abc" }, cultures: { list: [{ id: "c1" }] }, styles: { pin: [{ id: "p1" }] }, icons: { custom: [], disabled: [] } };
const surface = (data = { mapWidth: 10, mapHeight: 10, mapPins: [] }, extra = {}) => ({ id: null, type: "surface", data, owners: {}, modelRun: null, changed: true, ...extra });

async function newWorld(name = "Aethoria", settings = SETTINGS) {
    return Worlds.save({ world: null, name, settings, maps: [surface()] });
}

test("a new world is saved with its settings and its Surface map at revision 1", async () => {
    const { world, maps } = await newWorld();
    assert.equal(world.formatVersion, WORLD_FORMAT);
    assert.equal(world.settingsRevision, 1);
    assert.ok(world.settingsSavedAt);
    assert.deepEqual(world.maps, [{ id: maps[0].id, type: "surface" }]);
    const meta = await platform.store.loadMapMeta(maps[0].id);
    assert.deepEqual(meta, { worldId: world.id, mapType: "surface", revision: 1, savedAt: world.settingsSavedAt });
    assert.deepEqual((await Worlds.get(world.id)).settings, SETTINGS);
    assert.equal((await Worlds.ofMap(maps[0].id)).id, world.id);
});

test("saving raises a changed map's revision and the settings' revision only when they changed", async () => {
    const first = await newWorld();
    const mapId = first.maps[0].id;
    // Unchanged map and settings: nothing raised
    const second = await Worlds.save({ world: first.world, name: "Aethoria", settings: SETTINGS, maps: [surface(undefined, { id: mapId, changed: false })] });
    assert.equal(second.world.settingsRevision, 1);
    assert.equal(second.world.settingsSavedAt, first.world.settingsSavedAt);
    const meta1 = await platform.store.loadMapMeta(mapId);
    assert.equal(meta1.revision, 1);
    assert.equal(meta1.savedAt, first.world.settingsSavedAt);
    // A changed map: its revision and time
    await Worlds.save({ world: second.world, name: "Aethoria", settings: SETTINGS, maps: [surface(undefined, { id: mapId, changed: true })] });
    const meta2 = await platform.store.loadMapMeta(mapId);
    assert.equal(meta2.revision, 2);
    assert.notEqual(meta2.savedAt, meta1.savedAt);
    // Changed settings: the settings' revision and time
    const changed = { ...SETTINGS, climate: { globalTemp: 3 } };
    const third = await Worlds.save({ world: await Worlds.get(first.world.id), name: "Aethoria", settings: changed, maps: [surface(undefined, { id: mapId, changed: false })] });
    assert.equal(third.world.settingsRevision, 2);
    assert.equal((await platform.store.loadMapMeta(mapId)).revision, 2);
});

test("a held world writes only its own World setup, and reads every other group from the top of its chain", async () => {
    const root = await newWorld("Root");
    const middle = { ...WorldRecord.create({ id: "mid", name: "Middle", parentWorldId: root.world.id, held: true, settings: { setup: { seed: "m" } } }) };
    await platform.store.saveWorld(middle);
    const saved = await Worlds.save({ world: middle, name: "Middle", settings: { ...SETTINGS, setup: { seed: "m2" }, cultures: { list: [{ id: "local" }] } }, maps: [surface()] });
    assert.deepEqual(saved.world.settings, { setup: { seed: "m2" } });
    const leaf = WorldRecord.create({ id: "leaf", name: "Leaf", parentWorldId: "mid", held: true, settings: { setup: { seed: "l" } } });
    await platform.store.saveWorld(leaf);
    const settings = await Worlds.settingsOf(leaf);
    assert.deepEqual(settings.setup, { seed: "l" });
    assert.deepEqual(settings.cultures, SETTINGS.cultures);
    assert.deepEqual(settings.styles, SETTINGS.styles);
});

test("a world that is not held reads its own settings, even when cut from another", async () => {
    await newWorld("Root");
    const free = WorldRecord.create({ id: "free", name: "Free", parentWorldId: "nope", held: false, settings: { setup: {}, cultures: { list: [] } } });
    assert.deepEqual((await Worlds.settingsOf(free)).cultures, { list: [] });
});

test("Save as copies the world and its maps; a held world's copy is held by the same parent", async () => {
    const root = await newWorld("Root");
    const held = WorldRecord.create({ id: "held", name: "Held", parentWorldId: root.world.id, held: true, settings: { setup: { seed: "h" } } });
    await platform.store.saveWorld(held);
    const copy = await Worlds.save({ world: held, name: "Held copy", settings: { setup: { seed: "h" } }, maps: [surface()], asNew: true });
    assert.notEqual(copy.world.id, "held");
    assert.equal(copy.world.held, true);
    assert.equal(copy.world.parentWorldId, root.world.id);
    assert.equal((await platform.store.loadMapMeta(copy.maps[0].id)).worldId, copy.world.id);
});

test("Duplicate copies a saved world and its maps, not its regional worlds", async () => {
    const root = await newWorld("Root");
    await platform.store.saveWorld(WorldRecord.create({ id: "kid", name: "Kid", parentWorldId: root.world.id, held: true }));
    const copy = await Worlds.copy(root.world.id, "Root (copy)");
    assert.equal(copy.name, "Root (copy)");
    assert.notEqual(copy.maps[0].id, root.maps[0].id);
    const meta = await platform.store.loadMapMeta(copy.maps[0].id);
    assert.equal(meta.worldId, copy.id);
    assert.equal(meta.revision, 1);
    const tree = await Worlds.tree();
    assert.deepEqual(tree.map((node) => [node.name, node.children.map((child) => child.name)]), [["Root", ["Kid"]], ["Root (copy)", []]]);
});

test("Clone as new copies the settings it reads and is no longer held or cut", async () => {
    const root = await newWorld("Root");
    await platform.store.saveWorld({ ...WorldRecord.create({ id: "kid", name: "Kid", parentWorldId: root.world.id, held: true, settings: { setup: { seed: "k" } } }), maps: [] });
    const clone = await Worlds.cloneAsNew("kid", "Kid (own)");
    assert.equal(clone.held, false);
    assert.equal(clone.parentWorldId, null);
    assert.deepEqual(clone.settings.cultures, SETTINGS.cultures);
    assert.deepEqual(clone.settings.setup, { seed: "k" });
});

test("rename renames the world and its maps", async () => {
    const root = await newWorld("Root");
    await Worlds.rename(root.world.id, "Renamed");
    assert.equal((await Worlds.get(root.world.id)).name, "Renamed");
    assert.equal((await platform.store.listMaps()).find((map) => map.id === root.maps[0].id).name, "Renamed");
});

test("deleting a top-level world releases its held regional worlds, each keeping its own", async () => {
    const root = await newWorld("Root");
    const kid = { ...WorldRecord.create({ id: "kid", name: "Kid", parentWorldId: root.world.id, held: true, settings: { setup: { seed: "k" } } }) };
    await platform.store.saveWorld(kid);
    await platform.store.saveWorld(WorldRecord.create({ id: "grandkid", name: "Grandkid", parentWorldId: "kid", held: true }));
    await platform.store.saveWorld(WorldRecord.create({ id: "cut", name: "Only cut", parentWorldId: root.world.id, held: false }));
    const plan = await Worlds.deletePlan(root.world.id);
    assert.deepEqual([plan.movedUp.map((w) => w.id), plan.released.map((w) => w.id), plan.unlinked.map((w) => w.id)], [[], ["kid"], ["cut"]]);
    assert.equal(await Worlds.delete(root.world.id), true);
    const released = await Worlds.get("kid");
    assert.equal(released.held, false);
    assert.equal(released.parentWorldId, null);
    assert.deepEqual(released.settings.cultures, SETTINGS.cultures);
    assert.equal((await Worlds.get("grandkid")).parentWorldId, "kid");
    assert.equal((await Worlds.settingsOf(await Worlds.get("grandkid"))).cultures.list[0].id, "c1");
    assert.equal((await Worlds.get("cut")).parentWorldId, null);
    assert.equal(await platform.store.loadMapData(root.maps[0].id), null);
});

test("deleting a middle world moves its held regional worlds up to its parent, still held", async () => {
    const root = await newWorld("Root");
    await platform.store.saveWorld(WorldRecord.create({ id: "mid", name: "Middle", parentWorldId: root.world.id, held: true }));
    await platform.store.saveWorld(WorldRecord.create({ id: "leaf", name: "Leaf", parentWorldId: "mid", held: true }));
    const plan = await Worlds.deletePlan("mid");
    assert.deepEqual(plan.movedUp.map((w) => w.id), ["leaf"]);
    await Worlds.delete("mid");
    const leaf = await Worlds.get("leaf");
    assert.equal(leaf.held, true);
    assert.equal(leaf.parentWorldId, root.world.id);
});
