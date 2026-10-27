// Finding and reverting the uses of a pin icon across saved maps, through the platform's store.
import assert from "node:assert/strict";
import { test } from "node:test";
import { installPlatform, platform } from "../../src/platform/index.js";
import { findPinIconUsage, revertPinIconUsage } from "../../src/data/pinIcons.js";

/** A store holding two saved maps, recording the field updates it is sent. */
function stubStore() {
    const maps = [
        { id: "a", name: "Aethoria", mapData: { mapPins: [{ icon: "custom_1" }, { icon: "castle" }, { icon: "custom_1" }] } },
        { id: "b", name: "Eldoria", mapData: { mapPins: [{ icon: "castle" }] } },
    ];
    const updates = [];
    return { maps, updates, store: { listMapData: async () => maps, updateMapDataFields: async (id, fields) => updates.push({ id, fields }) } };
}

test("a custom icon's uses are found in saved maps and the open map", async () => {
    const original = platform.store;
    const { store } = stubStore();
    installPlatform({ store });
    try {
        const usage = await findPinIconUsage("custom_1", [{ icon: "custom_1" }]);
        assert.deepEqual(usage.savedMaps, [{ id: "a", name: "Aethoria", count: 2 }]);
        assert.equal(usage.liveCount, 1);
        assert.equal(usage.totalCount, 3);
    } finally {
        installPlatform({ store: original });
    }
});

test("reverting a custom icon updates only the saved maps that use it, and the open map", async () => {
    const original = platform.store;
    const { store, updates } = stubStore();
    installPlatform({ store });
    try {
        const live = [{ icon: "custom_1" }, { icon: "castle" }];
        await revertPinIconUsage("custom_1", live);
        assert.equal(updates.length, 1);
        assert.equal(updates[0].id, "a");
        assert.deepEqual(Object.keys(updates[0].fields), ["mapPins"]);
        assert.ok(updates[0].fields.mapPins.every((pin) => pin.icon !== "custom_1"));
        assert.ok(live.every((pin) => pin.icon !== "custom_1"));
    } finally {
        installPlatform({ store: original });
    }
});
