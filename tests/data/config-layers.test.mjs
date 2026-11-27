// FILRODENSWMB split by layer (RF1): src/config.js puts the layers' parts back together. Every
// layer's groups reach it once and as they are (the same objects, so a value changed in one is the
// value every reader sees), and each setting kept in one layer for a group of another's is the one
// that group holds, so nothing is defined twice.
import assert from "node:assert/strict";
import { test } from "node:test";

const { FILRODENSWMB } = await import("../../src/config.js");
const { KERNEL_CONFIG, KERNEL_PARTS } = await import("../../src/kernel/config.js");
const { SHELL_CONFIG, SHELL_PARTS } = await import("../../src/shell/config.js");
const { PLATFORM_CONFIG } = await import("../../src/platform/config.js");
const { WORLD_CONFIG, WORLD_PARTS } = await import("../../src/studios/world/config.js");
const { LOCAL_CONFIG } = await import("../../src/studios/local/config.js");

const LAYERS = { kernel: KERNEL_CONFIG, shell: SHELL_CONFIG, platform: PLATFORM_CONFIG, world: WORLD_CONFIG, local: LOCAL_CONFIG };

test("every layer's groups reach FILRODENSWMB once, as the same objects", () => {
    const owners = new Map();
    for (const [layer, config] of Object.entries(LAYERS)) {
        for (const key of Object.keys(config)) {
            assert.ok(!owners.has(key), `${key} is in both ${owners.get(key)} and ${layer}`);
            owners.set(key, layer);
        }
    }
    assert.deepEqual([...owners.keys()].sort(), Object.keys(FILRODENSWMB).sort(), "the barrel holds every layer's groups and nothing else");
    for (const [key, layer] of owners) {
        if (key === "LOCAL") continue;
        assert.equal(FILRODENSWMB[key], LAYERS[layer][key], `${key} is ${layer}'s own object`);
    }
    assert.equal(FILRODENSWMB.TEMPLATES, undefined, "the unused TEMPLATES is gone");
});

test("LOCAL is the Local studio's group with the World studio's two settings for it", () => {
    const { LOCAL } = FILRODENSWMB;
    assert.ok(Object.isFrozen(LOCAL));
    for (const [key, value] of Object.entries(LOCAL_CONFIG.LOCAL)) assert.equal(LOCAL[key], value, key);
    for (const [key, value] of Object.entries(WORLD_PARTS)) assert.equal(LOCAL[key], value, key);
    assert.equal(Object.keys(LOCAL).length, Object.keys(LOCAL_CONFIG.LOCAL).length + Object.keys(WORLD_PARTS).length, "nothing else");
});

test("a setting kept in one layer for another's group is the one that group holds", () => {
    assert.equal(FILRODENSWMB.LABELS.UNSET_SIZE, KERNEL_PARTS.LABEL_UNSET_SIZE);
    assert.equal(FILRODENSWMB.LABELS.HALO, KERNEL_PARTS.LABEL_HALO);
    assert.equal(FILRODENSWMB.GENERATOR.DEFAULT_NAME_BASE, KERNEL_PARTS.DEFAULT_NAME_BASE);
    assert.equal(FILRODENSWMB.GENERATOR.NAME_RETRIES, KERNEL_PARTS.NAME_RETRIES);
    assert.equal(FILRODENSWMB.GENERATOR.USER_FIGURES, KERNEL_PARTS.USER_FIGURES);
    assert.equal(FILRODENSWMB.LOCAL.MAX_SETTLEMENTS, KERNEL_PARTS.MAX_SETTLEMENTS);
    assert.equal(FILRODENSWMB.UI.RTL_LANGUAGES, SHELL_PARTS.RTL_LANGUAGES);
    for (const parts of [KERNEL_PARTS, SHELL_PARTS, WORLD_PARTS]) assert.ok(Object.isFrozen(parts));
});
