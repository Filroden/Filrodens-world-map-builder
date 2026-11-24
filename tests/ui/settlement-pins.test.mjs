// A settlement map follows its place through a re-run (L-surface step 2b; Ken, 2026-11-24;
// SettlementPins): the new pin for the same place takes the replaced pin's id, on its cell first,
// then its model cell, then the nearest new settlement within reach; each taken once, the closest
// first; a pin with no settlement map, a castle, and a place too far away left as they are.
import "../mesh/foundry-stubs.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { SettlementPins } from "../../src/studios/world/settlement/SettlementPins.js";

// A 100 × 100 map of 100 model cells (10 px apart); display cells 0 to 199, each's model cell its index halved
const app = { mapWidth: 100, mapHeight: 100, meshSession: { mesh: { modelCount: 100, parentOf: Array.from({ length: 200 }, (_, cell) => Math.floor(cell / 2)) } } };
const town = (id, cell, x, y) => ({ id, cell, x, y, generated: { kind: "town" } });

test("the new pin on the same cell takes the old pin's id", () => {
    const placed = [town("new1", 40, 50, 50), town("new2", 41, 52, 50)];
    assert.equal(SettlementPins.follow(app, [town("old1", 40, 50, 50)], placed, new Set(["old1"])), 1);
    assert.deepEqual(placed.map((pin) => pin.id), ["old1", "new2"]);
});

test("then the same model cell, then the nearest within reach; each pin taken once, the closest first", () => {
    const replaced = [town("old1", 60, 30, 30), town("old2", 80, 70, 70)];
    // old1's cell 60 is gone, but cell 61 shares its model cell (30); old2 has only a pin 12 px away
    const placed = [town("a", 61, 32, 31), town("b", 150, 80, 76), town("c", 199, 99, 99)];
    assert.equal(SettlementPins.follow(app, replaced, placed, new Set(["old1", "old2"])), 2);
    assert.deepEqual(placed.map((pin) => pin.id), ["old1", "old2", "c"]);
});

test("a pin with no settlement map, a castle, and a place too far away are left as they are", () => {
    const placed = [{ ...town("castle", 20, 10, 10), generated: { kind: "castle" } }, town("far", 199, 99, 99)];
    assert.equal(SettlementPins.follow(app, [town("old1", 20, 10, 10), town("old2", 30, 15, 15)], placed, new Set(["old1"])), 0);
    assert.deepEqual(placed.map((pin) => pin.id), ["castle", "far"]);
});
