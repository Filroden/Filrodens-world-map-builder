// Foundry's world locks (WL): two GM clients over one world setting, as Foundry gives every client
// a world setting's change; and a lock left behind by a page load that has gone (Foundry closed
// with a world open), which must never keep the world locked. Foundry's settings, users and hooks
// are played here; the checks with real GM clients are Ken's, on his test world.
import assert from "node:assert/strict";
import { test } from "node:test";

/** One Foundry world: its settings (every client hears a change) and its users. */
const values = new Map();
const configs = new Map();
const users = new Map([
    ["gm1", { id: "gm1", active: true, isGM: true }],
    ["gm2", { id: "gm2", active: true, isGM: true }],
]);
const hooks = new Map();
let self = "gm1";
globalThis.game = {
    get user() {
        return users.get(self);
    },
    users: {
        get: (id) => users.get(id),
        get activeGM() {
            return { isSelf: self === "gm1" };
        },
    },
    settings: {
        register: (scope, key, config) => configs.set(`${scope}.${key}`, config),
        get: (scope, key) => values.get(`${scope}.${key}`) ?? structuredClone(configs.get(`${scope}.${key}`)?.default ?? null),
        async set(scope, key, value) {
            values.set(`${scope}.${key}`, structuredClone(value));
            configs.get(`${scope}.${key}`)?.onChange?.(structuredClone(value));
            return value;
        },
    },
};
globalThis.Hooks = { on: (name, fn) => hooks.set(name, fn), once: (name, fn) => hooks.set(name, fn) };

const { foundryWorldLocks: locks, registerWorldLocks, tidyAtStart } = await import("../../src/platform/foundry/worldLocks.js");
registerWorldLocks();
const ID = "filrodens-world-map-builder";
const holdersNow = () => game.settings.get(ID, "worldLocks");
/** Writes a holder as another page load (or another client) left it. */
async function leave(worldId, user, client) {
    const holders = holdersNow();
    holders[worldId] = { user, client, at: 1 };
    await game.settings.set(ID, "worldLocks", holders);
}

test("a world claimed is held; a claim of it by another user's client is refused until released", async () => {
    const claim = await locks.claim("w1");
    assert.ok(claim);
    assert.deepEqual(await locks.held(), ["w1"]);
    // Another client, by its holder entry: the setting as GM 2's client would write it
    const holders = game.settings.get("filrodens-world-map-builder", "worldLocks");
    holders.w2 = { user: "gm2", client: "other", at: 1 };
    await game.settings.set("filrodens-world-map-builder", "worldLocks", holders);
    assert.equal(await locks.claim("w2"), null, "held by GM 2's client");
    let freed = 0;
    locks.whenFree("w2", () => freed++);
    await Promise.resolve();
    assert.equal(freed, 0);
    // GM 2 leaves: its holder goes, and Edit here is offered
    users.get("gm2").active = false;
    hooks.get("userConnected")(users.get("gm2"), false);
    assert.equal(freed, 1);
    assert.deepEqual(await locks.held(), ["w1"]);
    assert.equal(game.settings.get("filrodens-world-map-builder", "worldLocks").w2, undefined, "dropped by the active GM");
    claim.release();
    assert.deepEqual(await locks.held(), []);
    users.get("gm2").active = true;
});

test("news is told through its own setting and heard by the other clients, not the teller", async () => {
    const heard = [];
    const stop = locks.listen((news) => heard.push(news));
    locks.tell({ kind: "saved", worldId: "w1" });
    await Promise.resolve();
    assert.deepEqual(heard, [], "the teller does not hear itself");
    await game.settings.set("filrodens-world-map-builder", "worldNews", { kind: "renamed", worldId: "w1", client: "other", at: "2" });
    assert.deepEqual(heard, [{ kind: "renamed", worldId: "w1" }]);
    stop();
});

test("a lock left by this GM's earlier page load (Foundry closed with a world open) never blocks", async () => {
    // Foundry allows one login a user, so the same GM under another page load has gone
    await leave("w5", "gm1", "earlier-page-load");
    assert.deepEqual(await locks.held(), [], "not counted: Worlds shows no Open elsewhere mark");
    const claim = await locks.claim("w5");
    assert.ok(claim, "the world opens for editing");
    assert.equal(holdersNow().w5.user, "gm1");
    assert.notEqual(holdersNow().w5.client, "earlier-page-load", "the holder is this page load now");
    claim.release();
    assert.equal(holdersNow().w5, undefined);
});

test("at start the GM clears its own old locks, and the active GM those of GMs not connected", async () => {
    await leave("w6", "gm1", "earlier-page-load");
    await leave("w7", "gm2", "gm2-client");
    users.get("gm2").active = false; // GM 2's Foundry closed with nobody there to see it
    assert.equal(hooks.has("ready"), true, "registered for Foundry's ready hook");
    assert.equal(await tidyAtStart(), true);
    assert.deepEqual(Object.keys(holdersNow()), [], "both cleared");
    users.get("gm2").active = true;
});

test("a GM coming back clears its own old lock, and another connected GM's lock still blocks", async () => {
    await leave("w8", "gm2", "gm2-earlier-load");
    await leave("w9", "gm2", "gm2-now");
    assert.equal(await locks.claim("w9"), null, "GM 2 is connected and holds it: view only here");
    // GM 2's own start, as GM 2 (not the active GM): its earlier page loads' locks go
    self = "gm2";
    try {
        await game.settings.set(ID, "worldLocks", { ...holdersNow(), w9: { user: "gm1", client: "gm1-other", at: 1 } });
        assert.equal(await tidyAtStart(), true);
        assert.equal(holdersNow().w8, undefined, "GM 2's earlier lock cleared");
        assert.equal(holdersNow().w9.user, "gm1", "a connected GM's lock is left alone");
    } finally {
        self = "gm1";
    }
    await game.settings.set(ID, "worldLocks", {});
});

test("a player's client clears nothing", async () => {
    users.set("player", { id: "player", active: true, isGM: false });
    await leave("w10", "gm2", "gm2-client");
    users.get("gm2").active = false;
    self = "player";
    try {
        assert.equal(await tidyAtStart(), false);
        assert.ok(holdersNow().w10);
    } finally {
        self = "gm1";
        users.get("gm2").active = true;
        await game.settings.set(ID, "worldLocks", {});
    }
});
