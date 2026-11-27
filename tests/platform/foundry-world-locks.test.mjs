// Foundry's world locks (WL): two GM clients over one world setting, as Foundry gives every client
// a world setting's change. Foundry's settings, users and hooks are played here; the check with two
// real GM clients is Ken's, on his test world.
import assert from "node:assert/strict";
import { test } from "node:test";

/** One Foundry world: its settings (every client hears a change) and its users. */
const values = new Map();
const configs = new Map();
const users = new Map([
    ["gm1", { id: "gm1", active: true }],
    ["gm2", { id: "gm2", active: true }],
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
globalThis.Hooks = { on: (name, fn) => hooks.set(name, fn) };

const { foundryWorldLocks: locks, registerWorldLocks } = await import("../../src/platform/foundry/worldLocks.js");
registerWorldLocks();

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
