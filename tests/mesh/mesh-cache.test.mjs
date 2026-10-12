// The mesh raster cache: keys, hits and misses, and least-recently-used eviction (IndexedDB is
// stood in for by the Map-backed MemoryStore, which has the same four methods).
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMeshData } from "../../src/mesh/MeshBuilder.js";
import { MemoryStore, MeshCache, meshCacheKey } from "../../src/mesh/MeshCache.js";

const params = (seed) => ({ width: 120, height: 90, spacing: 4, modelSpacing: 12, seed, kmPerPx: 2 });

test("the key names every parameter the mesh depends on and the algorithm version", () => {
    assert.equal(meshCacheKey(params(7), 1), "7:4:12:120:90:1");
    assert.notEqual(meshCacheKey(params(7), 1), meshCacheKey({ ...params(7), modelSpacing: 13 }, 1));
});

test("a written mesh reads back; other parameters miss", async () => {
    const cache = new MeshCache(new MemoryStore());
    const data = await buildMeshData(params(1));
    assert.equal(await cache.read(params(1)), null);
    assert.equal(await cache.write(params(1), data), true);
    const back = await cache.read(params(1));
    assert.deepEqual(back.cellRaster, data.cellRaster);
    assert.deepEqual(back.sites, data.sites);
    assert.equal(await cache.read(params(2)), null);
    assert.equal(await cache.read({ ...params(1), width: 121 }), null);
});

test("only the most recently used entries are kept", async () => {
    let now = 0;
    const cache = new MeshCache(new MemoryStore(), { maxEntries: 3, clock: () => ++now });
    const data = await buildMeshData(params(1));
    for (const seed of [1, 2, 3]) await cache.write(params(seed), data);
    await cache.read(params(1)); // 1 is now the most recent
    await cache.write(params(4), data); // evicts 2, the least recent
    assert.deepEqual(await cache.keys(), [4, 1, 3].map((seed) => meshCacheKey(params(seed))));
    assert.equal(await cache.read(params(2)), null);
});

test("a store that fails behaves as a miss and a skipped write", async () => {
    const broken = { get: async () => { throw new Error("disk full"); }, put: async () => { throw new Error("disk full"); }, delete: async () => {}, keys: async () => [] };
    const cache = new MeshCache(broken);
    const warn = console.warn;
    console.warn = () => {};
    try {
        assert.equal(await cache.read(params(1)), null);
        assert.equal(await cache.write(params(1), await buildMeshData(params(1))), false);
    } finally {
        console.warn = warn;
    }
});
