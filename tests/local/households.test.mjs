// Households and supply (L-surface step 3): the card's words for every household of two promoted
// places (no string missing), its kinds by example, the panel's figures adding up, a house's name
// by where it stands, the homes' index, and the household views in the renderer.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { inputOf } from "./helpers.mjs";
import { TASKS, footprintsOf, wallMaterialOf } from "../../src/studios/local/LocalTasks.js";
import { HouseIndex } from "../../src/studios/local/app/HouseIndex.js";
import { allTrades, cardOf, cultureRoofs, figuresOf, houseName, legendOf, panelOf, placeOfHouse, supplyOf, tradeLine, wordKey } from "../../src/studios/local/app/Households.js";
import { drawTown } from "../../src/studios/local/render/CanvasTown.js";
import { ATLAS, HOUSEHOLD_VIEWS, VIEW_COLOURS, mutedRoof, viewColour } from "../../src/studios/local/render/Styles.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const EN = JSON.parse(readFileSync(join(ROOT, "languages/en.json"), "utf8"));
/** The strings as the module reads them, a missing key marked so a test can find it. */
const t = { lang: "en", localize: (key) => EN[key] ?? `!!${key}`, format: (key, data) => (EN[key] ?? `!!${key}`).replace(/\{(\w+)\}/g, (_, name) => data?.[name] ?? `{${name}}`) };
const missing = (value) => JSON.stringify(value).match(/!!FILRODENSWMB[^"\\]*/g) ?? [];

/** A promoted place built and kept, as the worker does: its town, households, footprints and land. */
function kept(name) {
    const input = inputOf(name);
    TASKS.build({ id: `hh-${name}`, input });
    const value = TASKS.keep({ id: `hh-${name}` }).value;
    TASKS.release({ ids: [`hh-${name}`] });
    return { input, ...value };
}

const PLACES = ["Grironcairn", "Lostshearmi"];
const built = Object.fromEntries(PLACES.map((name) => [name, kept(name)]));

test("every trade, group, wealth and role the engine gives has its words", () => {
    for (const [trade, group] of allTrades()) {
        assert.ok(EN[`FILRODENSWMB.UI.HouseholdTrade.${wordKey(trade)}`], `the trade ${trade}`);
        assert.ok(EN[`FILRODENSWMB.UI.HouseholdGroup.${group}`], `the group ${group}`);
    }
    for (const role of ["servant", "apprentice", "journeyman", "miller's man", "lodger"]) assert.ok(EN[`FILRODENSWMB.UI.HouseholdRole.${wordKey(role)}`], role);
    for (const wealth of Object.keys(VIEW_COLOURS.wealth)) assert.ok(EN[`FILRODENSWMB.UI.HouseholdWealth.${wealth}`], wealth);
    for (const group of Object.keys(VIEW_COLOURS.groups)) assert.ok(EN[`FILRODENSWMB.UI.HouseholdGroup.${group}`], `a view's group ${group}`);
    assert.equal(wordKey("man-at-arms"), "manAtArms");
    assert.equal(wordKey("miller's man"), "millersMan");
});

test("every household of two promoted places reads on its card with no string missing", () => {
    for (const [name, { households, town }] of Object.entries(built)) {
        const place = { name, kind: town.kind, walled: !!town.wall, cave: false };
        for (const h of [...households.houses, ...households.farms]) {
            const card = cardOf(t, h, place);
            assert.deepEqual(missing(card), [], `${name}: ${card.title}`);
            assert.ok(card.title && card.wealth && card.line, `${name}: a card has its head and line`);
            const named = card.family.length + card.working.length + card.lodging.length;
            assert.ok(named >= 1 && named <= h.members.length, `${name}: its members are listed`);
        }
    }
});

test("the card's kinds: a farmhouse, a widowed head, a woman heading her household, workers, lodgers, another culture", () => {
    const { households, town } = built.Grironcairn;
    const place = { name: "Grironcairn", kind: town.kind, walled: !!town.wall };
    const farm = households.farms[0];
    assert.equal(cardOf(t, farm, place).title, "A farmhouse, in its country");
    assert.match(tradeLine(t, farm, place), /grain for the market of “Grironcairn”/);
    const widow = households.houses.find((h) => h.trade === "widow" || h.trade === "widower");
    if (widow) {
        const card = cardOf(t, widow, place);
        assert.match(`${card.family[0].before}${card.family[0].after}`, /head \(widowed\)/);
        assert.equal(card.trade, null, "a widowed head has no trade line");
    }
    // A stand-in household: a woman heading it with a husband, two children, a servant of another
    // culture and a lodger
    const h = {
        trade: "brewer", group: "food", wealth: "middling", culture: "Valefolk", farm: false, dMarket: 400, dQuay: 1e9, dWater: 1e9, dGate: 1e9, dWorship: 1e9, dCastle: 1e9, rank: 1, back: false, inside: true,
        members: [
            { role: "head", age: 40, sex: "f", full: "Ragna Kjerstad", given: "Ragna" },
            { role: "husband", age: 42, sex: "m", full: "Eirik Kjerstad", given: "Eirik" },
            { role: "child", age: 12, given: "Solveig" },
            { role: "child", age: 9, given: "Brand" },
            { role: "servant", age: 19, culture: "Hillfolk", full: "Thora Gimstad" },
            { role: "lodger", age: 30, full: "Ulf Brasbury" },
        ],
    };
    const card = cardOf(t, h, place);
    assert.equal(card.title, "Brewer's house, on a main street");
    assert.equal(card.line, "6 people · Valefolk.");
    const text = (line) => `${line.before}${line.name}${line.after}`;
    assert.deepEqual(card.family.map(text), ["Ragna Kjerstad, brewer, head, 40", "Eirik Kjerstad, her husband, 42", "Solveig and Brand, their children, 12 and 9"]);
    assert.deepEqual(card.working.map(text), ["Thora Gimstad, servant, 19"]);
    assert.equal(card.working[0].culture, "Hillfolk", "a member's own culture where it is not the household's");
    assert.equal(card.family[0].culture, null);
    assert.deepEqual(card.lodging.map(text), ["Ulf Brasbury, lodger, 30"]);
    assert.equal(card.family[0].name, "Ragna Kjerstad", "the name is set apart, to be drawn bold");
    assert.equal(card.trade, "Food: brewer.");
    // Children of another line than the head's (a patronymic, N3): each child's whole name
    const patronymic = { ...h, members: [h.members[0], h.members[1], { role: "child", age: 12, given: "Solveig", family: "Eiriksdottir", full: "Solveig Eiriksdottir" }, { role: "child", age: 9, given: "Brand", family: "Eiriksson", full: "Brand Eiriksson" }] };
    assert.equal(text(cardOf(t, patronymic, place).family[2]), "Solveig Eiriksdottir and Brand Eiriksson, their children, 12 and 9");
    // One person
    const alone = cardOf(t, { ...h, members: [h.members[0]] }, place);
    assert.equal(alone.line, "1 person · Valefolk.");
});

test("a house is named by its trade and by what it stands nearest", () => {
    const base = { trade: "cutler", group: "metal", farm: false, dMarket: 1e9, dQuay: 1e9, dWater: 1e9, dGate: 1e9, dWorship: 1e9, dCastle: 1e9, rank: 2, back: false, inside: true };
    assert.equal(houseName(t, { ...base, dMarket: 20 }), "Cutler's house, on the market");
    assert.equal(placeOfHouse({ ...base, dMarket: 40, dGate: 10 }), "gate", "the nearest for its distance wins");
    assert.equal(houseName(t, { ...base, rank: 1 }), "Cutler's house, on a main street");
    assert.equal(houseName(t, { ...base, back: true }), "Cutler's house, in a back lane");
    assert.equal(houseName(t, { ...base, inside: false }, { walled: true }), "Cutler's house, outside the walls");
    assert.equal(houseName(t, { ...base, inside: false }, { walled: false }), "Cutler's house");
    assert.equal(houseName(t, { ...base, trade: "labourer", group: "labour", rank: 1 }), "A house on a main street", "a laborer's house is not known by the trade");
    assert.equal(houseName(t, { ...base, trade: "labourer", group: "labour" }), "A house");
});

test("the panel's figures add up: its people, the country, the cultures, the supply", () => {
    for (const [name, { input, households, land }] of Object.entries(built)) {
        const figures = figuresOf(households, { supply: input.supply, land });
        assert.equal(figures.people, input.population, `${name}: the houses hold the place's people`);
        assert.equal(figures.country, Math.round(land.countryPeople), `${name}: the farmhouses the frame's country people`);
        assert.ok(Math.abs(figures.cultures.reduce((a, c) => a + c.share, 0) - 1) < 1e-9, `${name}: the cultures' shares make the whole`);
        assert.equal(figures.groups.reduce((a, g) => a + g.count, 0), households.houses.length, `${name}: each house in one trade group`);
        const supply = supplyOf(input.supply);
        assert.ok(Math.abs(supply.rows.reduce((a, r) => a + r.share, 0) - 1) < 1e-9, `${name}: what comes in makes the whole`);
        const panel = panelOf(t, figures);
        assert.deepEqual(missing(panel), [], name);
        assert.equal(panel.totals.length, 4);
    }
    // A map with no run: its supply a stand-in, its shortfall bought in
    const standIn = supplyOf({ need: 120, own: 30, imports: 90, exports: 0, fromPlaces: [], countryTotal: 0, withoutRun: true });
    assert.deepEqual(standIn.rows.map((r) => [r.key, r.share]), [["FILRODENSWMB.UI.SupplyOwn", 0.25], ["FILRODENSWMB.UI.SupplyBoughtIn", 0.75]]);
    assert.ok(standIn.standIn);
});

test("the homes' index finds every home inside its footprint, and none outside every home", () => {
    const { households, town, homes } = built.Grironcairn;
    assert.deepEqual([...homes.offsets], [...footprintsOf(town, households).offsets], "the footprints the worker sends");
    const index = new HouseIndex(homes);
    assert.equal(index.size, households.houses.length + households.farms.length);
    for (let k = 0; k < index.size; k++) {
        const pts = index.footprint(k);
        // A point just inside the footprint: the middle of its first corner's two neighbours and itself
        const [a, b, c] = pts;
        const p = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3];
        assert.equal(index.at(...p), k, `home ${k} at its own point`);
    }
    const [x0, y0, x1, y1] = [-town.frame.width / 2, -town.frame.height / 2, town.frame.width / 2, town.frame.height / 2];
    assert.equal(index.at(x0 - 50, y0 - 50), -1);
    assert.equal(index.at(x1 + 50, y1 + 50), -1);
});

test("each household view colours the homes' roofs and mutes the rest; None draws the map as it is", () => {
    const { town, households } = built.Lostshearmi;
    /** A context that records what each roof is filled with. */
    const recorder = () => {
        const fills = [];
        const noop = () => {};
        const ctx = new Proxy(
            { fills, set fillStyle(v) { fills.push(v); }, get fillStyle() { return fills.at(-1); }, measureText: () => ({ width: 10 }), createLinearGradient: () => ({ addColorStop: noop }), createRadialGradient: () => ({ addColorStop: noop }), createPattern: () => null, getTransform: () => ({ a: 1, d: 1 }) },
            { get: (target, key) => (key in target ? target[key] : noop), set: (target, key, value) => ((target[key] = value), true) },
        );
        return ctx;
    };
    const view = { rect: [-town.frame.width / 2, -town.frame.height / 2, town.frame.width / 2, town.frame.height / 2], mPerPx: 4, widthPx: 100, heightPx: 100 };
    const none = recorder();
    drawTown(none, town, view, ATLAS, { layers: ["buildings"] });
    const roofs = cultureRoofs(households, {});
    for (const theme of HOUSEHOLD_VIEWS) {
        const drawn = recorder();
        drawTown(drawn, town, view, ATLAS, { layers: ["buildings"], theme, cultures: roofs });
        assert.equal(drawn.fills.length, none.fills.length, `${theme}: the same shapes drawn`);
        assert.notDeepEqual(drawn.fills, none.fills, `${theme}: some roof recoloured`);
        const home = households.houses[0];
        const building = town.buildings[home.index];
        assert.ok(viewColour(theme, building, roofs), `${theme}: a home has a colour`);
    }
    assert.ok(mutedRoof(ATLAS).startsWith("#"));
    for (const view of HOUSEHOLD_VIEWS) {
        const legend = legendOf(t, view, households, {});
        assert.deepEqual(missing(legend), [], view);
        assert.ok(legend.items.length >= 1 && legend.items.every((item) => item.colour && item.label), view);
    }
    assert.deepEqual(legendOf(t, "people", households).items.map((i) => i.label), ["1 to 3", "4 to 5", "6 to 7", "8 to 10", "11 or more"]);
    assert.deepEqual(legendOf(t, "age", households).items.map((i) => i.label), ["under 30", "30 to 39", "40 to 49", "50 to 59", "60 or more"]);
});

test("wall material (step 4): earth and palisade under 3,000 people, stone from there; a city or a capital always stone", () => {
    assert.equal(wallMaterialOf({ kind: "town", tier: "town", population: 2899 }), "palisade");
    assert.equal(wallMaterialOf({ kind: "town", tier: "town", population: 3000 }), "stone");
    assert.equal(wallMaterialOf({ kind: "town", tier: "capital", population: 1200 }), "stone");
    assert.equal(wallMaterialOf({ kind: "city", tier: "city", population: 2500 }), "stone");
    assert.equal(wallMaterialOf({ kind: "village", tier: "village", population: 300 }), "palisade");
});
