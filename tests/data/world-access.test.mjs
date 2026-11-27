// One window per world (WL): the guard on world writes (WorldAccess, checked by Worlds) and the
// news between tabs, with two fake tabs over one store (tests/support/world-locks.mjs plays the
// browser's Web Locks and BroadcastChannel); the web host's locks without a secure context; and
// the world migration run by one tab at a time.
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { installPlatform, platform } from "../../src/platform/index.js";
import { createWebStore, MemoryRecords } from "../../src/platform/web/store.js";
import { createWebWorldLocks } from "../../src/platform/web/worldLocks.js";
import { createLockHub } from "../support/world-locks.mjs";

let next = 0;
const newId = () => `id${String(++next).padStart(4, "0")}`;
installPlatform({ ...platform, utils: { ...platform.utils, randomID: newId }, settings: { get: () => null } });

const { Worlds } = await import("../../src/kernel/worlds/Worlds.js");
const { WorldAccess } = await import("../../src/kernel/worlds/WorldAccess.js");
const { WorldMigration } = await import("../../src/studios/world/data/WorldMigration.js");

const SETTINGS = { setup: { seed: "abc" }, icons: { custom: [], disabled: [] } };
const surface = (extra = {}) => ({ id: null, type: "surface", data: { mapWidth: 10, mapHeight: 10, mapPins: [] }, owners: {}, modelRun: null, changed: true, ...extra });

let hub;
let store;
let tabA;
let tabB;
const news = { A: [], B: [] };
/** Acts as a tab: its locks installed, the one store shared. */
const as = (tab) => installPlatform({ store, worldLocks: tab });

beforeEach(() => {
    store = createWebStore(new MemoryRecords(), { newId });
    hub = createLockHub();
    tabA = hub.tab("A");
    tabB = hub.tab("B");
    news.A = [];
    news.B = [];
    tabA.listen((item) => news.A.push(item));
    tabB.listen((item) => news.B.push(item));
    as(tabA);
});

async function newWorld(name = "Aethoria") {
    return (await Worlds.save({ world: null, name, settings: SETTINGS, maps: [surface()] })).world;
}

test("a world claimed in one tab opens view only in the other, whose writes are refused", async () => {
    const world = await newWorld();
    assert.deepEqual(news.B, [{ kind: "created", worldId: world.id }], "a new world is told");
    assert.equal(await WorldAccess.claim(world.id), true);
    assert.deepEqual(news.B.at(-1), { kind: "opened", worldId: world.id });

    as(tabB);
    assert.equal(await WorldAccess.claim(world.id), false, "held by A");
    assert.equal(WorldAccess.viewing(world.id), true);
    assert.deepEqual([...(await WorldAccess.elsewhere())], [world.id]);
    assert.equal(await Worlds.save({ world, name: "Aethoria", settings: SETTINGS, maps: [surface({ id: world.maps[0].id })] }), null, "Save world refused");
    assert.equal(await Worlds.rename(world.id, "Other"), null, "Rename refused");
    assert.equal(await Worlds.setThumbnail(world.id, world.maps[0].id, "data:image/webp;base64,UklGRg=="), null, "no thumbnail written");
    assert.equal(await Worlds.delete(world.id), false, "Delete refused");
    assert.equal((await Worlds.get(world.id)).name, "Aethoria", "nothing written");

    as(tabA);
    const saved = await Worlds.save({ world, name: "Aethoria", settings: SETTINGS, maps: [surface({ id: world.maps[0].id })] });
    assert.ok(saved, "the holder saves");
    assert.deepEqual(news.B.at(-1), { kind: "saved", worldId: world.id }, "and the other tab is told");
    assert.ok(await Worlds.rename(world.id, "Aethoria Major"));
    assert.deepEqual(news.B.at(-1), { kind: "renamed", worldId: world.id });
});

test("a world no tab holds may be written by any; letting go is told and frees it for Edit here", async () => {
    const world = await newWorld();
    as(tabB);
    assert.ok(await Worlds.rename(world.id, "Renamed"), "free: B may rename it from Worlds");

    as(tabA);
    await WorldAccess.claim(world.id);
    as(tabB);
    await WorldAccess.claim(world.id);
    let freed = 0;
    WorldAccess.whenFree(world.id, () => freed++);

    as(tabA);
    WorldAccess.release(world.id);
    await Promise.resolve();
    assert.equal(freed, 1, "Edit here is offered");
    assert.deepEqual(news.B.at(-1), { kind: "closed", worldId: world.id });
    as(tabB);
    assert.equal(await WorldAccess.claim(world.id), true, "Edit here claims it");
    assert.equal(WorldAccess.viewing(world.id), false);
});

test("a tab that closes or crashes lets its worlds go", async () => {
    const world = await newWorld();
    await WorldAccess.claim(world.id);
    as(tabB);
    assert.equal(await WorldAccess.claim(world.id), false);
    let freed = false;
    WorldAccess.whenFree(world.id, () => (freed = true));
    tabA.close();
    await Promise.resolve();
    assert.equal(freed, true);
    assert.equal(await WorldAccess.claim(world.id), true);
});

test("a third tab opens view only too: no limit", async () => {
    const world = await newWorld();
    await WorldAccess.claim(world.id);
    const tabC = hub.tab("C");
    as(tabB);
    assert.equal(await WorldAccess.claim(world.id), false);
    as(tabC);
    assert.equal(await WorldAccess.claim(world.id), false);
    assert.equal(WorldAccess.viewing(world.id), true);
});

test("deleting a parent is refused while a regional world it would rewrite is open for editing elsewhere", async () => {
    const parent = await newWorld("Aethoria");
    const child = await newWorld("Westmarch");
    await store.saveWorld({ ...child, parentWorldId: parent.id, held: true });
    as(tabB);
    await WorldAccess.claim(child.id);

    as(tabA);
    assert.deepEqual(await WorldAccess.refused([parent.id, child.id]), [child.id]);
    assert.equal(await Worlds.delete(parent.id), false);
    assert.ok(await Worlds.get(parent.id), "the parent is kept");
    assert.equal((await Worlds.get(child.id)).parentWorldId, parent.id, "the child is not released");

    as(tabB);
    WorldAccess.release(child.id);
    as(tabA);
    news.B = [];
    assert.equal(await Worlds.delete(parent.id), true);
    assert.deepEqual(news.B, [
        { kind: "saved", worldId: child.id },
        { kind: "deleted", worldId: parent.id },
    ]);
});

test("viewing on purpose (decision 42's viewer) claims nothing and writes nothing", async () => {
    const world = await newWorld();
    WorldAccess.view(world.id);
    assert.equal(WorldAccess.viewing(world.id), true);
    assert.equal(WorldAccess.holds(world.id), false);
    assert.equal(await Worlds.rename(world.id, "Other"), null);
    as(tabB);
    assert.equal(await WorldAccess.claim(world.id), true, "another tab may edit it");
});

test("a host with no locks claims every world, as before WL", async () => {
    installPlatform({ store, worldLocks: undefined });
    const world = await newWorld();
    assert.equal(WorldAccess.available, false);
    assert.equal(await WorldAccess.claim(world.id), true);
    assert.equal(await WorldAccess.claim(world.id), true);
    assert.deepEqual(await WorldAccess.refused([world.id]), []);
});

test("the web host's locks without a secure context claim everything, saying so once; news goes on a channel", async () => {
    const said = [];
    const info = console.info;
    console.info = (text) => said.push(text);
    try {
        const posted = [];
        class Channel {
            constructor(name) {
                this.name = name;
            }
            postMessage(data) {
                posted.push([this.name, data]);
            }
        }
        const locks = createWebWorldLocks({ locks: null, Channel });
        assert.equal(locks.available, false);
        assert.ok(await locks.claim("w1"));
        assert.ok(await locks.claim("w1"), "a second claim succeeds too");
        assert.deepEqual(await locks.held(), []);
        assert.equal(said.length, 1);
        locks.tell({ kind: "saved", worldId: "w1", extra: true });
        assert.deepEqual(posted, [["fwmb", { kind: "saved", worldId: "w1" }]]);
        assert.equal(await locks.exclusive("migration", () => 7), 7);
    } finally {
        console.info = info;
    }
});

test("the web host's Web Locks: a claim held until released, refused meanwhile, and waited for", async () => {
    // A lock manager as the browser's, enough for one origin: exclusive and shared requests in order
    const held = new Map();
    const queue = [];
    const grant = () => {
        for (const entry of [...queue]) {
            const holding = held.get(entry.name);
            if (holding && (holding.mode === "exclusive" || entry.mode === "exclusive")) continue;
            queue.splice(queue.indexOf(entry), 1);
            held.set(entry.name, { mode: entry.mode });
            Promise.resolve(entry.fn({ name: entry.name, mode: entry.mode })).then((value) => {
                held.delete(entry.name);
                entry.resolve(value);
                grant();
            });
        }
    };
    const locks = {
        request(name, options, fn) {
            if (typeof options === "function") [fn, options] = [options, {}];
            const mode = options.mode ?? "exclusive";
            if (options.ifAvailable && held.has(name)) return Promise.resolve(fn(null));
            return new Promise((resolve) => {
                queue.push({ name, mode, fn, resolve });
                grant();
            });
        },
        async query() {
            return { held: [...held].map(([name, { mode }]) => ({ name, mode })) };
        },
    };
    const tab1 = createWebWorldLocks({ locks, Channel: null });
    const tab2 = createWebWorldLocks({ locks, Channel: null });
    const claim = await tab1.claim("w1");
    assert.ok(claim);
    assert.equal(await tab2.claim("w1"), null);
    assert.deepEqual(await tab2.held(), ["w1"]);
    let freed = false;
    tab2.whenFree("w1", () => (freed = true));
    claim.release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(freed, true);
    assert.ok(await tab2.claim("w1"));
});

test("two tabs migrating at once: one runs it, the other finds it done", async () => {
    installPlatform({ settings: { get: () => null } });
    await store.saveMapData("Old map", { seed: "s", mapWidth: 10, mapHeight: 10, mapPins: [] }, null, {});
    as(tabA);
    const first = WorldMigration.run();
    as(tabB);
    const second = WorldMigration.run();
    const [a, b] = await Promise.all([first, second]);
    assert.equal(a.worlds + b.worlds, 1, "the world made once");
    assert.equal((await store.listWorlds()).length, 1);
});
