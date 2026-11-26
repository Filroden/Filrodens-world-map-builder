// A settlement map's record (L-surface step 2a): its rules read a record safely, field by field
// against the engine's input, and its fingerprint by part tells what changed.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { SettlementRules, SETTLEMENT_FORMAT } from "../../src/studios/local/data/SettlementRules.js";
import { SettlementRecord, PARTS } from "../../src/studios/local/data/SettlementRecord.js";
import { buildTown } from "../../src/studios/local/engine/Town.js";
import { townPrint } from "./helpers.mjs";

const INPUTS = new URL("./fixtures/inputs/", import.meta.url);
const PRINTS = JSON.parse(readFileSync(new URL("./fixtures/prints.json", import.meta.url), "utf8"));
const inputs = Object.fromEntries(readdirSync(INPUTS).map((name) => [name.replace(/\.json$/, ""), JSON.parse(readFileSync(new URL(name, INPUTS), "utf8"))]));
const recordOf = (input, extra = {}) => SettlementRecord.create({ id: "s1", pinId: input.id, sourceMapId: "m1", name: input.name, input, keptAt: "2026-11-24T00:00:00.000Z", ...extra });

test("every saved input passes the rules unchanged, and a record round trip keeps it", () => {
    for (const [name, input] of Object.entries(inputs)) {
        assert.deepEqual(SettlementRules.input(input), input, name);
        const checked = SettlementRules.check(JSON.parse(JSON.stringify(recordOf(input))));
        assert.deepEqual(checked.input, input, `${name}'s record`);
        assert.equal(checked.seed, input.seed, "the kept version's seed is the input's");
        assert.deepEqual(checked.parts, SettlementRecord.parts(input));
    }
});

test("a record rebuilds its town exactly from its input alone (the promoted places' prints)", () => {
    const input = SettlementRules.check(JSON.parse(JSON.stringify(recordOf(inputs.Grironcairn)))).input;
    assert.equal(townPrint(buildTown(input)), PRINTS.places.Grironcairn.town);
});

test("input safety: a field the engine would not make itself refuses the record", () => {
    const base = inputs.Graymoutht;
    const bad = [
        ["a frame not one of the engine's sizes", { ...base, frame: { width: 1e6, height: 1e6, widthPx: 8e5, heightPx: 8e5 } }],
        ["a population past the entry's limit", { ...base, population: 1e9 }],
        ["a fractional population", { ...base, population: 12.5 }],
        ["a negative population", { ...base, population: -1 }],
        ["a kind the engine has no plan for", { ...base, kind: "metropolis" }],
        ["a lie not one of the engine's", { ...base, relief: { ...base.relief, lie: "cliff" } }],
        ["a bearing past a turn", { ...base, roads: [{ bearing: 720, class: "minor" }] }],
        ["a road's class that is not a word", { ...base, roads: [{ bearing: 10, class: "main; drop" }] }],
        ["too many roads", { ...base, roads: Array.from({ length: 40 }, () => ({ bearing: 10, class: "minor" })) }],
        ["a non-finite number", { ...base, countryDensity: Number.POSITIVE_INFINITY }],
        ["no cultures", { ...base, cultures: [] }],
        ["a security past 1", { ...base, security: 2 }],
        ["a supply way too long", { ...base, supply: { ...base.supply, out: { ...base.supply.out, way: Array.from({ length: 600 }, () => [0, 0]) } } }],
        ["a shore of no known water", { ...base, shore: { ...base.shore, body: "lava" } }],
        ["a place id that is not an id", { ...base, id: "a.b" }],
        ["no input", null],
    ];
    for (const [what, input] of bad) assert.equal(SettlementRules.check({ format: SETTLEMENT_FORMAT, version: 1, id: "s1", pinId: "p1", input }), null, what);
});

test("input safety: the record round the input takes its defaults, or refuses without an id or pin", () => {
    const input = inputs.Sprinbell;
    const odd = SettlementRules.check({ format: SETTLEMENT_FORMAT, version: 1, id: "s1", pinId: "p1", input, settings: { walls: "moat" }, look: "neon", revision: -3, savedAt: "yesterday", keptAt: 5, sourceMapId: "../x", parts: { people: "zz", run: "0123abcd", ["__proto__"]: "0123abcd" } });
    assert.deepEqual(odd.settings, { walls: "auto" });
    assert.equal(odd.look, "atlas");
    assert.equal(odd.revision, 1);
    assert.equal(odd.savedAt, null);
    assert.equal(odd.keptAt, null);
    assert.equal(odd.sourceMapId, null);
    assert.deepEqual(odd.parts, { run: "0123abcd" });
    assert.equal(Object.getPrototypeOf(odd.parts), Object.prototype);
    for (const record of [{ format: "other", version: 1, id: "s1", pinId: "p1", input }, { format: SETTLEMENT_FORMAT, version: 2, id: "s1", pinId: "p1", input }, { format: SETTLEMENT_FORMAT, version: 1, pinId: "p1", input }, { format: SETTLEMENT_FORMAT, version: 1, id: "s1", input }]) {
        assert.equal(SettlementRules.check(record), null);
    }
    // Unsafe keys are dropped before anything is read
    const tree = JSON.parse(`{"format":"${SETTLEMENT_FORMAT}","version":1,"id":"s1","pinId":"p1","__proto__":{"polluted":true},"input":${JSON.stringify(input)}}`);
    assert.ok(SettlementRules.check(tree));
    assert.equal({}.polluted, undefined);
});

test("the input's parts: one changes with its fields; the place's name, the places' names and what the engine works out from them change none", () => {
    const input = inputs.Grironcairn;
    const parts = SettlementRecord.parts(input);
    assert.deepEqual(Object.keys(parts), Object.keys(PARTS));
    const changes = {
        people: { population: input.population + 100 },
        style: { tier: input.tier === "town" ? "largeTown" : "town" },
        routes: { roads: [...input.roads, { bearing: 180, class: "main" }] },
        rivers: { river: { from: 10, to: 190, widthM: 12, upstreamKm: 40, rises: false, endsIn: "sea" } },
        ground: { biome: "TAIGA" },
        cultures: { cultures: [{ ...input.cultures[0], share: 0.5 }, { name: "Hillfolk", colour: "#3f7fbf", openness: 0.5, nameBase: "English", share: 0.5 }] },
        run: { security: 0.5 },
    };
    for (const [part, change] of Object.entries(changes)) assert.deepEqual(SettlementRecord.changed(parts, SettlementRecord.parts({ ...input, ...change })), [part], part);
    const renamed = { ...input, name: "Newtown", neighbours: input.neighbours.map((n) => ({ ...n, name: `${n.name}by` })), supply: { ...input.supply, name: "Newtown" } };
    assert.deepEqual(SettlementRecord.changed(parts, SettlementRecord.parts(renamed)), []);
    // What the engine works out from its people and tier (its plan, walls, frame, own share) is in no part: the cause is named once
    const derived = { ...input, kind: "city", walled: !input.walled, frame: { ...input.frame, width: input.frame.width * 2 }, frameShare: 0.9, ownShare: 0.9, ownFood: 1 };
    assert.deepEqual(SettlementRecord.changed(parts, SettlementRecord.parts(derived)), []);
    // A part a saved record has no print of is not counted as changed
    assert.deepEqual(SettlementRecord.changed({ people: parts.people }, SettlementRecord.parts({ ...input, security: 0.1 })), []);
});

test("a record's card: what the world keeps of it", () => {
    const record = recordOf(inputs.Ambergarde);
    assert.deepEqual(SettlementRecord.card(record), { id: "s1", pinId: inputs.Ambergarde.id, sourceMapId: "m1", name: "Ambergarde", tier: "port", people: 5975, parts: record.parts, stale: [], revision: 1, savedAt: null, supply: SettlementRecord.supplyOf(inputs.Ambergarde) });
});

test("its supply is compared by its main figures, within the tolerance: a change elsewhere moving it a little marks nothing", () => {
    const input = inputs.Ambergarde;
    const saved = SettlementRecord.supplyOf(input);
    assert.deepEqual(Object.keys(saved), ["density", "country", "bought", "imports", "exports"]);
    const tolerance = { SHARE: 0.1, DENSITY: 0.25 };
    const nudged = { ...input, countryDensity: input.countryDensity * 1.1, supply: { ...input.supply, countryTotal: input.supply.countryTotal * 1.05 } };
    assert.equal(SettlementRecord.supplyChanged(saved, SettlementRecord.supplyOf(nudged), tolerance), false, "moved a little");
    const moved = { ...input, supply: { ...input.supply, countryTotal: input.supply.countryTotal + input.supply.need * 0.2 } };
    assert.equal(SettlementRecord.supplyChanged(saved, SettlementRecord.supplyOf(moved), tolerance), true, "a fifth more of its need from its country");
    assert.equal(SettlementRecord.supplyChanged(saved, SettlementRecord.supplyOf({ ...input, countryDensity: input.countryDensity * 2 + 10 }), tolerance), true, "its country twice as full");
    assert.equal(SettlementRecord.supplyChanged(null, saved, tolerance), false, "a card kept before its figures were");
});

test("a culture's names settings (N3) in the input: the chosen ones kept, an unknown one left out as Automatic, refusing nothing", () => {
    const base = inputs.Grironcairn;
    const culture = { ...base.cultures[0], names: { form: "patronymic", order: "family-first", lineage: "mother", wife: "keeps" }, heads: "either" };
    const chosen = { ...base, cultures: [culture] };
    assert.deepEqual(SettlementRules.input(chosen), chosen);
    const odd = { ...base, cultures: [{ ...base.cultures[0], names: { form: "<script>", order: "family-first", lineage: 3, extra: "x" }, heads: "kings" }] };
    assert.deepEqual(SettlementRules.input(odd).cultures[0], { ...base.cultures[0], names: { order: "family-first" } });
    const none = { ...base, cultures: [{ ...base.cultures[0], names: "patronymic", heads: null }] };
    assert.deepEqual(SettlementRules.input(none).cultures[0], base.cultures[0]);
    // Only the culture's part moves
    const changed = SettlementRecord.changed(SettlementRecord.parts(base), SettlementRecord.parts(chosen));
    assert.deepEqual(changed, ["cultures"]);
});
