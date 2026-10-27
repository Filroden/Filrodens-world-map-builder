// PastAge: which realm of an earlier age carried on as which later one (its seat first, else most
// of its land; each later realm once), and what changed between two ages.
import assert from "node:assert/strict";
import { test } from "node:test";
import { ageChanges, chainRoads, cultureShares, matchRealms, placeCells } from "../../src/history/PastAge.js";

test("a realm carries on as the later realm holding its seat or most of its land, each later realm once", () => {
    // Ten cells. Earlier: realm 0 on cells 0 to 4 (seat 0), realm 1 on 5 to 7 (seat 6), realm 2 on 8 and 9 (seat 9)
    const earlier = [0, 0, 0, 0, 0, 1, 1, 1, 2, 2];
    const seats = [0, 6, 9];
    // Later: realm 0 keeps cells 0 to 3; realm 1 takes 4 to 9, so it holds realm 1's land and realm 2's seat
    const later = [0, 0, 0, 0, 1, 1, 1, 1, 1, 1];
    assert.deepEqual(Array.from(matchRealms(earlier, seats, later)), [0, 1, -1], "realm 2 lost its land to realm 1, which carries realm 1 on");

    // A realm keeping its seat on a sliver of its land carries on there, not where most of its land went
    const sliver = [1, 1, 1, 1, 0, 1, 1, 1, -1, -1];
    assert.deepEqual(Array.from(matchRealms([0, 0, 0, 0, 0, -1, -1, -1, -1, -1], [4], sliver)), [0]);
    // A realm with neither its seat nor most of its land is new
    assert.deepEqual(Array.from(matchRealms([0, 0, 0, 0, -1], [0], [-1, 1, 2, 2, -1])), [-1]);
});

test("the changes between two ages: realms fallen and risen, places founded and lost, peoples' shares", () => {
    const earlier = { realm: [0, 0, 1, 1, -1], seats: [0, 2], places: placeCells([0, 0, 1, 2, 1, 0, 3, 2, 0]), culture: [0, 0, 0, 1, -1] };
    const later = { realm: [0, 0, 1, 1, 2], realmCount: 3, places: new Set([0, 3, 4]), culture: [0, 0, 1, 1, 1] };
    const changes = ageChanges({ ...earlier, realm: [0, 0, 1, 1, -1] }, later, 2);
    assert.deepEqual(changes.fell, []);
    assert.deepEqual(changes.rose, [2], "realm 2 is new");
    assert.equal(changes.founded, 1, "cell 4");
    assert.equal(changes.lost, 1, "cell 2");
    assert.deepEqual(changes.peoples.map(({ culture, from, to }) => [culture, from, to]), [[0, 0.75, 0.4], [1, 0.25, 0.6]]);

    const split = ageChanges({ realm: [0, 0, 0, 0], seats: [3], places: new Set(), culture: null }, { realm: [1, 1, 2, 2], realmCount: 3, places: new Set(), culture: null }, 1);
    assert.deepEqual(split.fell, [], "the realm holding its seat carries it on");
    assert.deepEqual(split.rose, [0, 1], "realm 0 holds nothing; realm 1 took the half without the seat");
    assert.equal(split.peoples, null, "an age without cultures has no peoples to compare");
    assert.deepEqual(Array.from(cultureShares([-1, -1], 2)), [0, 0]);
});

test("an age's roads chain between places, forks and ends, and round a loop with none", () => {
    // A line 1-2-3-4 with a town on 3, a fork at 4 to 5 and 6, and a loop 10-11-12-10
    const from = [1, 2, 3, 4, 4, 10, 11, 12];
    const to = [2, 3, 4, 5, 6, 11, 12, 10];
    const chains = chainRoads(from, to, new Set([3]));
    const key = (chain) => (chain[0] <= chain.at(-1) ? chain : [...chain].reverse()).join("-");
    assert.deepEqual(chains.map(key).sort(), ["1-2-3", "10-11-12-10", "3-4", "4-5", "4-6"].sort());
    assert.equal(chains.flat().length - chains.length, from.length, "every road once");
});
