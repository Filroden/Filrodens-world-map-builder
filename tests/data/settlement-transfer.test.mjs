// A world's settlement maps (L-surface step 2a) in the world file and in backups: carried with
// their world, and read back unchecked for the Local studio's rules to check as they arrive.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const { Backup } = await import("../../src/studios/world/data/Backup.js");
const { WorldFile } = await import("../../src/studios/world/data/WorldFile.js");
const { ImportRefusal } = await import("../../src/kernel/data/Sanitize.js");
const { SettlementRules } = await import("../../src/studios/local/data/SettlementRules.js");
const { SettlementRecord } = await import("../../src/studios/local/data/SettlementRecord.js");
const { zipSync, strToU8 } = await import("../../vendor/fflate/fflate.js");

const map = JSON.parse(readFileSync(new URL("./fixtures/fwmb_eldoria.json", import.meta.url), "utf8"));
const input = JSON.parse(readFileSync(new URL("../local/fixtures/inputs/Grironcairn.json", import.meta.url), "utf8"));
const record = SettlementRecord.create({ id: "s1", pinId: input.id, sourceMapId: "m1", name: "Grironcairn", input, keptAt: "2026-11-24T00:00:00.000Z" });

test("a world file carries its world's settlement maps, read back as written for the rules to check", () => {
    const written = WorldFile.write({ name: "Eldoria", mapId: "m1", file: { name: "Eldoria", ...structuredClone(map) }, settlements: [record], version: "5.0.0" });
    assert.deepEqual(written.world.settlements, [record]);
    const read = WorldFile.read(JSON.parse(JSON.stringify(written)));
    assert.equal(read.settlements.length, 1);
    assert.deepEqual(SettlementRules.check(read.settlements[0]).input, input);
    // None: no field written, none read
    const plain = WorldFile.write({ name: "Eldoria", mapId: "m1", file: { name: "Eldoria", ...structuredClone(map) }, version: "5.0.0" });
    assert.equal("settlements" in plain.world, false);
    assert.deepEqual(WorldFile.read(JSON.parse(JSON.stringify(plain))).settlements, []);
});

test("a backup carries each world's settlement maps in a file of its own", () => {
    const bytes = Backup.pack({ maps: [{ id: "m1", name: "Eldoria", parentId: null, file: structuredClone(map) }], assets: new Map(), worlds: [{ id: "w1", name: "Eldoria", maps: [{ id: "m1", type: "surface" }], settings: {} }], settlements: new Map([["w1", [record]]]), app: "web", version: "5.0.0" });
    const read = Backup.read(bytes);
    assert.deepEqual(read.settlementsOf("w1"), [JSON.parse(JSON.stringify(record))]);
    assert.deepEqual(read.settlementsOf("w2"), [], "a world the manifest does not name has none");
    assert.deepEqual(read.settlementsOf("../w1"), []);
});

test("a backup's settlement entries are refused when misnamed, as any entry is", () => {
    const manifest = { format: Backup.FORMAT, maps: [], worlds: [], blobs: [], assets: [], settlements: ["w1"] };
    const zip = (entries) => zipSync(Object.fromEntries(Object.entries(entries).map(([name, value]) => [name, strToU8(value)])));
    assert.throws(() => Backup.read(zip({ "manifest.json": JSON.stringify(manifest), "settlements/../w1.json": "[]" })), (error) => error instanceof ImportRefusal && error.reason === "damaged");
    assert.throws(() => Backup.read(zip({ "manifest.json": JSON.stringify(manifest), "settlements/w1.txt": "[]" })), (error) => error instanceof ImportRefusal && error.reason === "damaged");
    // A settlement file that is not a list reads as none
    assert.deepEqual(Backup.read(zip({ "manifest.json": JSON.stringify(manifest), "settlements/w1.json": "{}" })).settlementsOf("w1"), []);
});
