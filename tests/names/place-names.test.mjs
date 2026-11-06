// Random names for the map's own items (src/names/PlaceNames.js): the same map seed, item id and
// roll always give the same name, whatever else is named and in whatever order; another roll gives
// another; a share of names add a word that fits the item; a region's land and a pin's kind of
// place are read in their order.
import assert from "node:assert/strict";
import { test } from "node:test";
import { FILRODENSWMB } from "../../src/config.js";
import { landKind, placeName, settlementKind } from "../../src/names/PlaceNames.js";

const item = { mapSeed: "P0JBVA", itemId: "regionAAAAAAAAAA", nameBase: "English" };

test("a name depends only on the map's seed, the item's id and its roll", () => {
    const first = placeName(item);
    // Naming other items first, in other bases and contexts, changes nothing
    for (let index = 0; index < 20; index++) placeName({ mapSeed: "P0JBVA", itemId: `other${index}`, roll: index, nameBase: "Elven", context: "political" });
    assert.equal(placeName(item), first);
    assert.equal(placeName({ ...item, roll: 0 }), first, "roll 0 is the first suggestion");

    const rolls = new Set(Array.from({ length: 10 }, (_, roll) => placeName({ ...item, roll })));
    assert.ok(rolls.size >= 9, "another roll gives another name");
    assert.notEqual(placeName({ ...item, itemId: "regionBBBBBBBBBB" }), first, "another item, another name");
    assert.notEqual(placeName({ ...item, mapSeed: "EXBQDK" }), first, "another map, another name");
    assert.match(first, /^[A-Z][\p{L}' -]+$/u, "a capitalised word");
});

test("an unknown name base falls back to the default name style", () => {
    assert.equal(placeName({ ...item, nameBase: "Nonsense" }), placeName({ ...item, nameBase: FILRODENSWMB.GENERATOR.DEFAULT_NAME_BASE }));
    assert.equal(placeName({ ...item, nameBase: undefined }), placeName({ ...item, nameBase: FILRODENSWMB.GENERATOR.DEFAULT_NAME_BASE }));
});

test("about a third of names add a word that fits the item, set in one of its forms", () => {
    const rolls = Array.from({ length: 300 }, (_, roll) => roll);
    const coast = rolls.map((roll) => placeName({ ...item, roll, descriptor: { forms: ["{name} Coast", "Port {name}"], short: true } }));
    const worded = coast.filter((name) => / Coast$|^Port /.test(name)).length;
    assert.ok(worded > 70 && worded < 130, `${worded} of 300 add a word`);
    for (const name of coast) assert.doesNotMatch(name, /\{name\}/);
    // Whether a word is added is drawn first, so a name without one is the same as with no forms
    const plain = rolls.map((roll) => placeName({ ...item, roll }));
    const unchanged = coast.filter((name, roll) => name === plain[roll]).length;
    assert.equal(unchanged, 300 - worded, "a roll without a word gives the plain name");
    assert.ok(rolls.every((roll) => !/ Coast$/.test(placeName({ ...item, roll, descriptor: { forms: [] } }))), "no forms: the name alone");
    assert.ok(rolls.every((roll) => placeName({ ...item, roll, descriptor: { forms: ["Coast"] } }) === plain[roll]), "a form without the name's place is ignored");

    // A realm's form of the name (a top layer's regions)
    const realm = rolls.map((roll) => placeName({ ...item, roll, descriptor: { realm: true } }));
    const changed = realm.filter((name, roll) => name !== plain[roll]);
    assert.ok(changed.length > 20, "some rolls give a realm's form");
    for (const [roll, name] of realm.entries()) assert.equal(name.slice(0, 2), plain[roll].slice(0, 2), "built on the same name");
});

test("a region's land is read in order: island, mountains, hills, coast, then its commonest biome", () => {
    const land = { land: 100, coastal: 0, island: false, mountain: 0, hill: 0, biomes: {} };
    assert.equal(landKind({ ...land, land: 0 }), null, "no land");
    assert.equal(landKind(land), null, "nothing stands out");
    assert.equal(landKind({ ...land, island: true, mountain: 90 }), "island");
    assert.equal(landKind({ ...land, mountain: 25, coastal: 90 }), "mountains");
    assert.equal(landKind({ ...land, mountain: 10, hill: 30 }), "hills");
    assert.equal(landKind({ ...land, coastal: 50, biomes: { forest: 90 } }), "coast");
    assert.equal(landKind({ ...land, biomes: { forest: 45, plains: 50 } }), "plains");
    assert.equal(landKind({ ...land, biomes: { desert: 30, tundra: 20 } }), null, "no biome covers enough");
    for (const kind of ["island", "mountains", "hills", "coast", "forest", "plains", "desert", "tundra"]) assert.ok(FILRODENSWMB.PLACE_NAMES.FORMS[kind]?.length, `${kind} has forms`);
});

test("a pin's kind of place comes from its style's tier, else its generated tier, else its icon", () => {
    assert.equal(settlementKind({ icon: "map_pin" }, "castle"), "castle");
    assert.equal(settlementKind({ icon: "castle" }, "town"), null, "a town's name stands alone, whatever its icon");
    assert.equal(settlementKind({ generated: { tier: "port" } }), "port");
    assert.equal(settlementKind({ generated: { tier: "ruinedCity" } }), "ruin");
    assert.equal(settlementKind({ icon: "anchor" }), "port");
    assert.equal(settlementKind({ icon: "fortress" }), "castle");
    assert.equal(settlementKind({ icon: "map_pin" }), null);
    assert.equal(settlementKind({ icon: "__proto__" }), null);
    assert.equal(settlementKind({ generated: { tier: "marketTown" } }), "market");
});
