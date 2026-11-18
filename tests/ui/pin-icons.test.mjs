// Finding and reverting the uses of a pin icon across saved maps, through the platform's store.
import assert from "node:assert/strict";
import { test } from "node:test";
import { installPlatform, platform } from "../../src/platform/index.js";
import { addCustomPinIcon, currentPinIcons, findPinIconUsage, getCustomPinIconEntries, getPinIconPickerList, resolvePinIconPath, revertPinIconUsage, setBuiltinPinIconDisabled, usePinIcons } from "../../src/kernel/data/pinIcons.js";

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

test("a world's icons are the ones every picker reads, and changing them changes that world and says so", async () => {
    const original = platform.settings;
    const written = [];
    installPlatform({ settings: { get: () => [{ id: "hostIcon", name: "Host", path: "host.svg" }], set: async (key, value) => written.push({ key, value }) }, utils: { ...platform.utils, randomID: () => "newIcon" }, i18n: { localize: (key) => key }, assets: { url: (path) => path } });
    let changes = 0;
    try {
        usePinIcons({ custom: [{ id: "worldIcon", name: "World", path: "world.svg" }], disabled: ["castle"] }, () => changes++);
        assert.deepEqual(getCustomPinIconEntries().map((icon) => icon.id), ["worldIcon"]);
        assert.equal(resolvePinIconPath("worldIcon"), "world.svg");
        assert.equal(getPinIconPickerList().some((icon) => icon.key === "castle"), false);
        await addCustomPinIcon({ name: "Tower", path: "tower.svg" });
        await setBuiltinPinIconDisabled("anchor", true);
        assert.equal(changes, 2);
        assert.deepEqual(currentPinIcons().custom.map((icon) => icon.id), ["worldIcon", "newIcon"]);
        assert.deepEqual(currentPinIcons().disabled, ["castle", "anchor"]);
        assert.equal(written.length, 0, "the host's settings are not written");
        // With no world, the host's settings, as before v5
        usePinIcons(null);
        assert.deepEqual(getCustomPinIconEntries().map((icon) => icon.id), ["hostIcon"]);
    } finally {
        usePinIcons(null);
        installPlatform({ settings: original });
    }
});

test("an icon's uses can be limited to the maps that read the open world's icons", async () => {
    const original = platform.store;
    const { store, updates } = stubStore();
    installPlatform({ store });
    try {
        const usage = await findPinIconUsage("castle", [], new Set(["b"]));
        assert.deepEqual(usage.savedMaps, [{ id: "b", name: "Eldoria", count: 1 }]);
        await revertPinIconUsage("castle", [], new Set(["b"]));
        assert.deepEqual(updates.map((update) => update.id), ["b"]);
    } finally {
        installPlatform({ store: original });
    }
});

