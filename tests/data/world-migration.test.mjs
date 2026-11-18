// v4.3 saved maps made into v5 worlds (src/studios/world/data/WorldMigration.js): the plan on its
// own, then a run over the web host's store in memory.
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { installPlatform, platform } from "../../src/platform/index.js";
import { createWebStore, MemoryRecords } from "../../src/platform/web/store.js";

const ICONS = { custom: [{ id: "icon1", name: "Tower", path: "towers/a.svg" }], disabled: ["anchor"] };
const settingsValues = { customPinIcons: ICONS.custom, disabledPinIcons: ICONS.disabled };
installPlatform({ ...platform, settings: { get: (key) => settingsValues[key] } });

const { WorldMigration } = await import("../../src/studios/world/data/WorldMigration.js");
const { WorldRecord } = await import("../../src/kernel/worlds/WorldRecord.js");
const { WorldSettings } = await import("../../src/studios/world/data/WorldSettings.js");
const { Backup } = await import("../../src/studios/world/data/Backup.js");

const style = (id, look = "solid") => ({ id, name: id, look });
const data = (extra = {}) => ({
    seed: "s",
    generationEngine: "tectonic",
    mapWidth: 100,
    mapHeight: 80,
    params: { latTop: 60, latBottom: 20, globalTemp: 0, noise: { moisture: { scale: 0.01, octaves: 4 } }, climate: { altCooling: 1, windDistance: 5 } },
    cultures: [{ id: "c1" }],
    generatorSettings: { nameBase: "english", ages: [{ id: "a1" }] },
    customRouteStyles: [style("r1")],
    customLabelStyles: [],
    customRegionStyles: [],
    customPinStyles: [style("p1")],
    customBiomes: [{ id: 1, name: "Bog" }],
    nextCustomBiomeId: 2,
    mapPins: [],
    ...extra,
});
const entry = (id, name, mapData, extra = {}) => ({ id, name, mapData, meta: null, hasModelRun: false, ...extra });
const generatedPin = { id: "gp", generated: { run: "run1" } };

const plan = (maps, worlds = new Map()) => WorldMigration.plan({ maps, worlds, icons: ICONS });
const byId = (records) => new Map(records.map((record) => [record.id, record]));

test("a map becomes a world of one Surface map, at revision 1, with the host's icons", () => {
    const { worlds, metas } = plan([entry("m1", "Aethoria", data())]);
    assert.equal(worlds.length, 1);
    const [world] = worlds;
    assert.equal(world.id, "m1");
    assert.equal(world.name, "Aethoria");
    assert.equal(world.formatVersion, 5);
    assert.equal(world.settingsRevision, 1);
    assert.deepEqual(world.maps, [{ id: "m1", type: "surface" }]);
    assert.equal(world.held, false);
    assert.equal(world.parentWorldId, null);
    assert.deepEqual(world.settings.icons, ICONS);
    assert.deepEqual(world.settings.cultures, { list: [{ id: "c1" }] });
    assert.deepEqual(metas, [{ mapId: "m1", meta: { worldId: "m1", mapType: "surface", revision: 1, savedAt: null } }]);
});

test("a regional map holding its parent's run becomes a held regional world, its setup its own", () => {
    const child = data({ seed: "child", parentId: "m1", parentRun: { run: "run1" } });
    const { worlds } = plan([entry("m2", "Region", child), entry("m1", "Aethoria", data())]);
    const region = byId(worlds).get("m2");
    assert.equal(region.held, true);
    assert.equal(region.parentWorldId, "m1");
    assert.deepEqual(region.regional, { sourceMapId: "m1", migrated: true });
    assert.deepEqual(Object.keys(region.settings), ["setup"]);
    assert.equal(region.settings.setup.seed, "child");
    assert.deepEqual(region.migration.changed, []);
});

test("a regional map with no copy of its parent's run is held when its content came from a run its parent holds", () => {
    const child = data({ parentId: "m1", mapPins: [generatedPin] });
    const held = plan([entry("m1", "A", data(), { hasModelRun: true }), entry("m2", "B", child)]);
    assert.equal(byId(held.worlds).get("m2").held, true);
    // ... but not when it has a run of its own, or its parent has none, or none of its content was generated
    const own = plan([entry("m1", "A", data(), { hasModelRun: true }), entry("m2", "B", child, { hasModelRun: true })]);
    assert.equal(byId(own.worlds).get("m2").held, false);
    assert.equal(byId(own.worlds).get("m2").parentWorldId, "m1");
    assert.ok(byId(own.worlds).get("m2").settings.cultures);
    const noRun = plan([entry("m1", "A", data()), entry("m2", "B", child)]);
    assert.equal(byId(noRun.worlds).get("m2").held, false);
    const nothing = plan([entry("m1", "A", data(), { hasModelRun: true }), entry("m2", "B", data({ parentId: "m1" }))]);
    assert.equal(byId(nothing.worlds).get("m2").held, false);
});

test("a regional map whose parent is no longer saved becomes a world of its own", () => {
    const { worlds } = plan([entry("m2", "B", data({ parentId: "gone", parentRun: { run: "x" } }))]);
    assert.equal(worlds[0].parentWorldId, null);
    assert.equal(worlds[0].held, false);
    assert.equal(worlds[0].regional, null);
});

test("a held map's own styles and custom biomes are added to the world its settings come from; what else differed is listed", () => {
    const child = data({
        parentId: "m1",
        parentRun: { run: "run1" },
        customRouteStyles: [style("r1", "dashed"), style("r2")],
        customBiomes: [{ id: 1, name: "Changed bog" }, { id: 4, name: "Moor" }],
        nextCustomBiomeId: 5,
        params: { ...data().params, globalTemp: 3 },
    });
    const { worlds } = plan([entry("m1", "A", data()), entry("m2", "B", child)]);
    const root = byId(worlds).get("m1");
    assert.deepEqual(root.settings.styles.route.map((s) => [s.id, s.look]), [["r1", "solid"], ["r2", "solid"]]);
    assert.deepEqual(root.settings.biomes.custom.map((b) => [b.id, b.name]), [[1, "Bog"], [4, "Moor"]]);
    assert.equal(root.settings.biomes.nextId, 5);
    const region = byId(worlds).get("m2");
    assert.equal(region.migration.addedStyles, 1);
    assert.equal(region.migration.addedBiomes, 1);
    assert.deepEqual(region.migration.changed, ["styles", "biomes", "climate"]);
});

test("in a chain, the top of the held chain takes a grandchild's styles; a middle map that is not held is the top", () => {
    const root = entry("m1", "Root", data(), { hasModelRun: true });
    const middle = entry("m2", "Middle", data({ parentId: "m1", parentRun: { run: "run1" } }));
    const leaf = entry("m3", "Leaf", data({ parentId: "m2", parentRun: { run: "run1" }, customPinStyles: [style("p1"), style("p9")] }));
    const held = byId(plan([leaf, middle, root]).worlds);
    assert.deepEqual(held.get("m1").settings.styles.pin.map((s) => s.id), ["p1", "p9"]);
    assert.equal(held.get("m3").parentWorldId, "m2");
    assert.deepEqual(Object.keys(held.get("m2").settings), ["setup"]);

    const freeMiddle = entry("m2", "Middle", data({ parentId: "m1" }), { hasModelRun: true });
    const free = byId(plan([leaf, freeMiddle, root]).worlds);
    assert.equal(free.get("m2").held, false);
    assert.deepEqual(free.get("m2").settings.styles.pin.map((s) => s.id), ["p1", "p9"]);
    assert.deepEqual(free.get("m1").settings.styles.pin.map((s) => s.id), ["p1"]);
});

test("maps with a world are left alone; a map cut later goes under its parent's world", () => {
    const existing = WorldRecord.create({ id: "w1", name: "A", maps: [{ id: "m1", type: "surface" }], settings: WorldSettings.split(data()).settings });
    const worlds = new Map([["w1", existing]]);
    const maps = [entry("m1", "A", data(), { meta: { worldId: "w1", mapType: "surface", revision: 3 } }), entry("m9", "Cut", data({ parentId: "m1", parentRun: { run: "r" } }))];
    const result = plan(maps, worlds);
    assert.deepEqual(result.metas.map((m) => m.mapId), ["m9"]);
    const cut = byId(result.worlds).get("m9");
    assert.equal(cut.parentWorldId, "w1");
    assert.equal(cut.held, true);
    assert.equal(existing.settings.styles.route.length, 1, "the saved world passed in is not changed");
});

// --- the run

let store;
beforeEach(() => {
    store = createWebStore(new MemoryRecords());
    installPlatform({ store, module: { host: "web", version: "5.0.0" } });
});

test("run saves the worlds and each map's fields, and leaves the map's data as it was", async () => {
    const saved = await store.saveMapData("Aethoria", data(), null, {});
    const before = await store.loadMapData(saved.id);
    const result = await WorldMigration.run();
    assert.deepEqual([result.worlds, result.maps, result.backup], [1, 1, null]);
    assert.equal((await store.loadMapMeta(saved.id)).worldId, saved.id);
    assert.equal((await store.loadWorld(saved.id)).name, "Aethoria");
    assert.deepEqual(await store.loadMapData(saved.id), before);
    // Running again does nothing
    assert.deepEqual(await WorldMigration.run(), { worlds: 0, maps: 0, backup: null });
});

test("on a host that keeps files, the first run writes a backup of every map first", async () => {
    const kept = [];
    installPlatform({ store: { ...store, keepWorldFile: async (folder, name, bytes) => kept.push({ folder, name, size: bytes.length, bytes }) && `${folder}/${name}` } });
    await store.saveMapData("Aethoria", data(), null, {});
    const result = await WorldMigration.run();
    assert.equal(kept.length, 1);
    assert.equal(kept[0].folder, "fwmb-backups");
    assert.match(kept[0].name, /^before-5\.0\.0-\d{4}-\d{2}-\d{2}\.json$/);
    assert.ok(kept[0].size > 0);
    assert.ok(result.backup);
    // Restore reads it: the map and its data as they were before the migration
    const backup = Backup.read(kept[0].bytes);
    assert.deepEqual(backup.maps.map((map) => map.name), ["Aethoria"]);
    assert.equal(backup.mapFile(backup.maps[0].id).seed, "s");
    // Later runs (a map imported) write no backup
    await store.saveMapData("Imported", data(), null, {});
    await WorldMigration.run();
    assert.equal(kept.length, 1);
});

test("a backup that cannot be written is reported and the migration goes on", async () => {
    const warnings = [];
    const notify = { info() {}, warn: (text, options) => warnings.push({ text, options }), error() {} };
    const i18n = { localize: (key) => key, format: (key) => key, lang: "en" };
    const quiet = console.warn;
    console.warn = () => {};
    try {
        installPlatform({ notify, i18n, store: { ...store, keepWorldFile: async () => { throw new Error("refused"); } } });
        const saved = await store.saveMapData("Aethoria", data(), null, {});
        const result = await WorldMigration.run();
        assert.deepEqual(result, { worlds: 1, maps: 1, backup: null, backupFailed: true });
        assert.equal((await store.loadMapMeta(saved.id)).worldId, saved.id);
        assert.deepEqual(warnings, [{ text: "FILRODENSWMB.UI.MigrationBackupFailed", options: { permanent: true } }]);
    } finally {
        console.warn = quiet;
    }
});
