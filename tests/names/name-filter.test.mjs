// The name filter (roadmap decision 45; kernel/names/NameFilter): common rude words kept out of
// generated names, by where each word is rude; real names checked like any other, an allowlist
// apart; every caller draws a blocked name again; the world run and Fill in only from generator
// revision 3, so an older map keeps its names.
import "../mesh/foundry-stubs.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

const { FILRODENSWMB } = await import("../../src/config.js");
const { NamesGenerator } = await import("../../vendor/azgaar-names/names-generator.js");
const { mulberry32 } = await import("../../src/kernel/random/Random.js");
const { blockedWordIn, cleanFromList, drawName, isBlockedName, readName } = await import("../../src/kernel/names/NameFilter.js");
const { ALLOWED, BLOCKED_WORDS } = await import("../../src/kernel/names/data/BlockedWords.js");
const { placeName } = await import("../../src/kernel/names/PlaceNames.js");
const { nameEverything } = await import("../../src/studios/world/generator/Names.js");
const { GeneratorRevision } = await import("../../src/studios/world/generator/GeneratorRevision.js");

test("a word is blocked where it is rude, and innocent elsewhere", () => {
    for (const name of ["Arsereacht", "Asses", "Titsa", "Putesh", "Shitari", "Pûtesh", "ARSEREACHT", "Kut", "Kut-Tiga", "Old Arseford", "Port-Slutsa", "Seamerden", "Nob"]) assert.ok(isBlockedName(name), name);
    for (const name of ["Lasse", "Saltwatch", "Dawnpass", "Quickpass", "Concord", "Culoz", "Aquincum", "Huichnamatit", "Yakarse", "Glassby", "Kutno", "Noble", "Lulworth", "Bumble"]) assert.ok(!isBlockedName(name), name);
    assert.equal(blockedWordIn("Old Arseford"), "arse");
    assert.equal(blockedWordIn("Lasse"), null);
});

test("names are read without accents and case, with the letters NFD keeps", () => {
    assert.equal(readName("Pûtésh"), "putesh");
    assert.equal(readName("Scheißberg"), "scheissberg");
    assert.ok(isBlockedName("Scheißberg"));
    assert.ok(isBlockedName("Kurwa Łąka"));
});

test("the list's words are in the form the filter reads them, each in one place", () => {
    const all = Object.values(BLOCKED_WORDS).flat();
    for (const word of all) assert.equal(readName(word), word, word);
    for (const [position, list] of Object.entries(BLOCKED_WORDS)) assert.deepEqual([...list], [...new Set(list)].sort(), position);
});

test("real names are checked like any other; the allowlist's pass", () => {
    const blocked = ["Cockermouth", "Slutsk", "Titisee", "Tithoraea", "Shitara", "Assenceira", "Assamer", "Assif", "Tittawan", "Assur", "Wankawillka", "Nij'ass"];
    for (const name of blocked) assert.ok(isBlockedName(name), name);
    // "bum" is rude only as a whole word (Korean names begin with Bum-), so Bumahen stays
    assert.ok(!isBlockedName("Bumahen"));
    // "shit" is rude at a word's start or end only (Japanese and Swahili names hold it inside)
    assert.ok(!isBlockedName("Szilshith"));
    for (const name of Object.keys(ALLOWED)) assert.ok(!isBlockedName(name), name);
    assert.deepEqual(Object.keys(ALLOWED).sort(), ["Dickson", "Titilayo", "Titu", "Titus", "Yoshitsune"]);
    for (const reason of Object.values(ALLOWED)) assert.ok(typeof reason === "string" && reason.length > 10);
});

test("drawName: off, the plain retry for duplicates; on, a blocked name counts as used and is never returned", () => {
    const drawer = (names) => {
        let at = 0;
        const make = () => names[Math.min(at++, names.length - 1)];
        make.calls = () => at;
        return make;
    };
    // Off: the same draws as a loop on duplicates alone
    const plain = drawer(["Arseford", "Lowby"]);
    assert.equal(drawName(plain, { used: new Set(), retries: 12 }), "Arseford");
    assert.equal(plain.calls(), 1);
    // On: drawn again until clean and unused
    const onBlocked = drawer(["Arseford", "Ashby", "Lowby"]);
    assert.equal(drawName(onBlocked, { used: new Set(["Ashby"]), clean: true, retries: 12 }), "Lowby");
    // Every try blocked or used: the last clean draw (a repeat), else the fallback, never a blocked one
    assert.equal(drawName(drawer(["Ashby", "Arseford"]), { used: new Set(["Ashby"]), clean: true, retries: 3 }), "Ashby");
    assert.equal(drawName(drawer(["Arseford"]), { clean: true, retries: 3, fallback: () => "Lowby" }), "Lowby");
    assert.equal(cleanFromList(["Assur", "Ashby"], () => 0), "Ashby");
    assert.equal(cleanFromList(["Assur"], () => 0), null);
});

test("each name base loses few of its names (the cap, held by the probe's 20,000 a base)", () => {
    // 2,000 a base here, so twice the cap allows for the smaller sample; scripts/name-probe.mjs holds
    // the cap itself on 20,000
    const generator = new NamesGenerator(mulberry32(45));
    const cap = FILRODENSWMB.NAME_FILTER.CAP * 2;
    for (let base = 0; base < generator.nameBases.length; base++) {
        let blocked = 0;
        for (let i = 0; i < 2000; i++) if (isBlockedName(i % 4 === 3 ? generator.getBaseShort(base) : generator.getBase(base))) blocked++;
        assert.ok(blocked / 2000 <= cap, `${generator.nameBases[base].name}: ${blocked} of 2000`);
    }
});

test("suggestions are never blocked, and the same seed, item and roll give the same name", () => {
    const generator = new NamesGenerator(() => 0);
    let seen = 0;
    for (const { name: nameBase } of generator.nameBases) {
        for (let i = 0; i < 300; i++) {
            const item = { mapSeed: "FILTER", itemId: `pin${i}`, roll: i % 3, nameBase };
            const name = placeName(item);
            assert.ok(!isBlockedName(name), `${nameBase}: ${name}`);
            if (i < 20) assert.equal(placeName(item), name);
            seen++;
        }
    }
    assert.equal(seen, 300 * generator.nameBases.length);
});

test("the world run filters only from revision 3; then a blocked town is named again, the rest as before", () => {
    const { REVISION_2, REVISION_3 } = FILRODENSWMB.GENERATOR.REVISIONS;
    assert.equal(GeneratorRevision.rules(REVISION_2).cleanNames, false);
    assert.equal(GeneratorRevision.rules(REVISION_3).cleanNames, true);
    // Ruthenian draws the most blocked names (Slutsk, Putesh)
    const count = 3000;
    const cultures = { cultures: [{ nameBase: "Ruthenian" }], dominant: new Int32Array(count).fill(0) };
    const towns = Array.from({ length: count }, (_, cell) => ({ cell, population: count - cell, tier: 2 }));
    const run = (cleanNames) => nameEverything({ seed: "FILTER", nameBase: "Ruthenian", cultures, towns, castles: [], realms: { counties: [], duchies: [], realms: [] }, idNames: true, cleanNames });
    const before = run(false).towns;
    const after = run(true).towns;
    const blocked = [...before].filter(([, name]) => isBlockedName(name));
    assert.ok(blocked.length > 0, "the sample draws some blocked names");
    assert.ok([...after.values()].every((name) => !isBlockedName(name)), "none after");
    for (const [cell] of blocked) assert.notEqual(after.get(cell), before.get(cell));
    const same = [...before].filter(([cell, name]) => after.get(cell) === name).length;
    assert.ok(same >= count - blocked.length * 2, `${same} of ${count} unchanged, ${blocked.length} blocked`);
});
