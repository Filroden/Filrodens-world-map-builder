// Eras and events (AgeEvents, GeneratorSettings.resolveEvents): an age's events read and kept
// valid (an older age's one event as a list of one); no events gives the run of before; each era
// and event changes the run as it should on the synthetic island; a realm event acts on the realm
// holding its place; several events act together.
import "../mesh/foundry-stubs.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

const { runGenerator } = await import("../../src/generator/Pipeline.js");
const { resolveEvents, resolveSettings } = await import("../../src/generator/GeneratorSettings.js");
const { syntheticMap } = await import("./synthetic.mjs");

const quiet = { pause: () => Promise.resolve() };
// Realms spaced closer, so the island holds several (a union needs a neighbour)
const WORLD = { realmSpacing: 0.4 };
const runs = new Map();
/** The run of two ages, the present with these settings (cached by them). */
const run = (present = {}, extra = {}) => {
    const key = JSON.stringify([present, extra]);
    if (!runs.has(key)) runs.set(key, runGenerator(syntheticMap().makePayload({ world: WORLD, ...extra, ages: [{}, { era: "highMedieval", strife: "troubled", ...present }] }), quiet));
    return runs.get(key);
};
const towns = (result) => result.places.filter((place) => place.kind === "town");
const urban = (result) => towns(result).reduce((sum, place) => sum + place.population, 0);
const site = (cell) => {
    const sites = syntheticMap().makePayload({}).modelSites;
    return { x: sites[2 * cell], y: sites[2 * cell + 1] };
};
/** How the present's realms hold a list of cells: each realm's share, largest first. */
const heldBy = (result, cells) => {
    const by = new Map();
    for (const cell of cells) by.set(result.modelCells.realm[cell], (by.get(result.modelCells.realm[cell]) ?? 0) + 1);
    return [...by.values()].sort((a, b) => b - a).map((count) => count / cells.length);
};
const report = (result, kind) => result.events.at(-1).find((entry) => entry.kind === kind);

test("an age's events: valid, each kind once, a culture in one peoples event, in the order added; an older age's event as a list of one", () => {
    assert.deepEqual(resolveEvents({ event: { kind: "invasion", culture: "elves" } }), [{ kind: "invasion", culture: "elves" }]);
    assert.deepEqual(resolveEvents({ event: null }), []);
    const events = resolveEvents({
        events: [
            { kind: "tradeWar", place: { x: 5, y: 6 } },
            { kind: "civilWar", place: { x: "a", y: 1 } },
            { kind: "famine", culture: "ignored" },
            { kind: "famine" },
            { kind: "arrival", culture: "elves" },
            { kind: "migration", culture: "elves" },
            { kind: "colonisation" },
            { kind: "conquest" },
            null,
        ],
    });
    assert.deepEqual(events, [{ kind: "tradeWar", place: { x: 5, y: 6 } }, { kind: "civilWar", place: null }, { kind: "famine" }, { kind: "arrival", culture: "elves" }], "in the order they were added");
    assert.deepEqual(resolveSettings({ ages: [{ events: [{ kind: "plague" }], event: { kind: "arrival", culture: "x" } }] }).ages[0].events, [{ kind: "plague" }], "events win over an older event");
    const dark = resolveSettings({ ages: [{ era: "darkAge" }] }).ages[0];
    assert.equal(dark.urbanisation, 0.6);
    assert.equal(dark.fragmentation, 1.5);
});

test("no events gives the run of before", async () => {
    const plain = await runGenerator(syntheticMap().makePayload({ world: WORLD, ages: [{}, {}] }), quiet);
    const empty = await runGenerator(syntheticMap().makePayload({ world: WORLD, ages: [{ events: [] }, { events: [] }] }), quiet);
    const { timings: _a, ...a } = plain;
    const { timings: _b, ...b } = empty;
    assert.deepEqual(b, a);
    assert.deepEqual(plain.events, [[], []]);
});

test("the eras: a dark age shrinks the people, towns and realms; advancement and expansion grow them", async () => {
    const base = await run();
    const dark = await run({ era: "darkAge" });
    const advancement = await run({ era: "advancement" });
    const expansion = await run({ era: "expansion" });
    assert.ok(dark.stats.population < 0.6 * base.stats.population, "a dark age has about half the people");
    assert.ok(towns(dark).length < towns(base).length);
    assert.ok(urban(dark) / dark.stats.population < urban(base) / base.stats.population, "a smaller share in towns");
    assert.ok(dark.ruins.length > base.ruins.length, "and leaves ruins");
    assert.ok(advancement.stats.population > 1.2 * base.stats.population, "land and sea feed more");
    assert.ok(expansion.stats.population > base.stats.population, "marginal land feeds more");
});

test("hardship: a plague and a famine take people; a disaster wrecks the land round its place and bars towns from it", async () => {
    const base = await run();
    const plague = await run({ events: [{ kind: "plague" }] });
    const famine = await run({ events: [{ kind: "famine" }] });
    assert.ok(plague.stats.population < 0.75 * base.stats.population);
    assert.ok(famine.stats.population < base.stats.population);
    const big = towns(base).sort((a, b) => b.population - a.population)[0];
    const disaster = await run({ events: [{ kind: "disaster", place: site(big.cell) }] });
    const hit = report(disaster, "disaster");
    assert.equal(hit.cell, big.cell);
    assert.equal(hit.placed, true);
    assert.ok(!towns(disaster).some((place) => place.cell === big.cell), "no town at its heart");
    const near = (result) => {
        let people = 0;
        for (const place of towns(result)) if (Math.hypot(site(place.cell).x - site(big.cell).x, site(place.cell).y - site(big.cell).y) < 20) people += place.population;
        return people;
    };
    assert.ok(near(disaster) < near(base), "fewer townspeople round it");
    const unplaced = await run({ events: [{ kind: "disaster" }] });
    assert.equal(report(unplaced, "disaster").placed, false, "with no place, the age before's largest coastal or river town");
});

test("prosperity: a trade boom grows the towns; a trade war shrinks the trade between realms", async () => {
    const base = await run();
    const boom = await run({ events: [{ kind: "tradeBoom" }] });
    assert.ok(urban(boom) > urban(base));
    const war = await run({ events: [{ kind: "tradeWar" }] });
    assert.equal(report(war, "tradeWar").realm, -1, "with no place, between all realms");
    assert.notDeepEqual(war.places, base.places);
    const seat = base.realms[0].seat;
    const one = await run({ events: [{ kind: "tradeWar", place: site(seat) }] });
    assert.equal(one.realms[report(one, "tradeWar").realm] !== undefined, true, "with a place, that realm against the rest");
});

test("realms: a civil war splits the realm at its place, a collapse breaks it up, a union absorbs its neighbour", async () => {
    const base = await run();
    const largest = base.realms.reduce((a, b) => (b.population > a.population ? b : a));
    const civil = await run({ events: [{ kind: "civilWar" }] });
    const war = report(civil, "civilWar");
    assert.equal(war.crownSeats.length, 2, "two rival crowns");
    const split = heldBy(civil, war.land);
    assert.ok(split[0] < 0.85, `the realm's land split (${split.map((share) => share.toFixed(2))})`);
    const collapse = await run({ events: [{ kind: "collapse" }] });
    const fallen = report(collapse, "collapse");
    assert.ok(heldBy(collapse, fallen.land)[0] < 0.7, "the realm's land no longer one realm");
    assert.ok(collapse.stats.independents > base.stats.independents);
    const union = await run({ events: [{ kind: "union" }] });
    const joined = report(union, "union");
    assert.ok(joined, "the realm has a neighbour");
    const home = union.modelCells.realm[joined.seat];
    const under = joined.partnerLand.filter((cell) => union.modelCells.realm[cell] === home).length / joined.partnerLand.length;
    assert.ok(under > 0.5, `the neighbour's land under the realm (${under.toFixed(2)})`);
    assert.ok(union.realms.length < base.realms.length || under > 0.8);
    // With no place, the largest realm; with a place, the realm holding it
    assert.equal(war.seat, largest.seat);
    const smaller = base.realms.filter((realm) => realm !== largest && realm.kind === "kingdom")[0];
    const placed = await run({ events: [{ kind: "collapse", place: site(smaller.seat) }] });
    assert.ok(report(placed, "collapse").land.includes(smaller.seat), "the realm holding the place");
});

test("peoples: a migration settles among others, a colonisation starts in land no realm held", async () => {
    const cultures = [{ id: "west", name: "West", homelands: [{ x: 120, y: 180 }] }, { id: "east", name: "East", homelands: [] }];
    const arrival = await run({ events: [{ kind: "arrival", culture: "east" }] }, { cultures });
    const migration = await run({ events: [{ kind: "migration", culture: "east" }] }, { cultures });
    const colonisation = await run({ events: [{ kind: "colonisation", culture: "east" }] }, { cultures });
    const land = (result) => {
        const east = result.cultures.findIndex((culture) => culture.id === "east");
        return Array.from(result.modelCells.culture).filter((culture) => culture === east).length;
    };
    for (const result of [arrival, migration, colonisation]) {
        assert.deepEqual(result.cultures.map((culture) => culture.id), ["west", "east"]);
        assert.ok(!Array.from(result.history[0].culture).includes(1), "absent from the age before");
    }
    assert.ok(land(migration) < land(arrival), "a migrant holds less land than an arrival");
    // Seated in land no realm held in the age before, or, with none such, the best land anywhere
    const home = report(colonisation, "colonisation").cell;
    const before = colonisation.history[0].realm;
    const water = colonisation.modelCells.water;
    const free = before.some((realm, cell) => realm < 0 && !water[cell]);
    assert.ok(free ? before[home] < 0 : before[home] >= 0, "seated in land no realm held, where there is any");
    assert.equal(water[home], 0);
});

test("several events together: a civil war and a famine both act, whatever their order", async () => {
    const both = await run({ events: [{ kind: "civilWar" }, { kind: "famine" }] });
    const reversed = await run({ events: [{ kind: "famine" }, { kind: "civilWar" }] });
    const { timings: _a, settings: _c, events: _e, ...a } = both;
    const { timings: _b, settings: _d, events: _f, ...b } = reversed;
    assert.deepEqual(a, b, "the same run: events act by stage, not by their order");
    const famine = await run({ events: [{ kind: "famine" }] });
    assert.ok(Math.abs(both.stats.population - famine.stats.population) < 0.1 * famine.stats.population, "the famine's people");
    assert.ok(report(both, "civilWar"), "and the civil war");
});

test("a dynastic union lasts into the ages after, while its crown does", async () => {
    const three = (events) => runGenerator(syntheticMap().makePayload({ world: WORLD, ages: [{}, { events }, {}] }), quiet);
    const union = await three([{ kind: "union" }]);
    const joined = union.events[1].find((entry) => entry.kind === "union");
    assert.ok(joined?.partnerLand?.length, "the union acts in its own age");
    const home = union.modelCells.realm[joined.seat];
    const under = joined.partnerLand.filter((cell) => union.modelCells.realm[cell] === home).length / joined.partnerLand.length;
    assert.ok(under > 0.5, `the neighbour's land still under the realm in the present (${under.toFixed(2)})`);
    assert.ok(!union.realms.some((realm) => realm.seat === joined.partnerSeat), "the partner's seat no realm's seat");
});
