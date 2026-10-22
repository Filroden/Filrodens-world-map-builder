// The map's detail level (DetailLevel): each item's own level, what a level shows, the level a run
// starts at for the map's scale, and a hidden region level left out of the drawn levels.
import "../mesh/foundry-stubs.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { FILRODENSWMB } from "../../src/config.js";
import { DetailLevel } from "../../src/applications/DetailLevel.js";
import { describeLevels } from "../../src/canvas/RegionLevelLayers.js";
import { RULES, clean, cleanContext } from "../../src/data/MapRules.js";

const STYLES = [
    { id: "style-city", tier: "city", detailLevel: 0 },
    { id: "style-town", tier: "town", detailLevel: 2 },
    { id: "style-hamlet", detailLevel: 3 },
];

function studio(detailLevel) {
    const political = { id: "set", kind: "political", visibility: "all", levels: [{ id: "realms" }, { id: "duchies" }, { id: "counties" }] };
    const custom = { id: "own", kind: "custom", visibility: "all", levels: [{ id: "lands" }] };
    return {
        uiState: { detailLevel, customPinStyles: STYLES },
        mapPins: [
            { id: "city", pinStyle: "style-city" },
            { id: "town", pinStyle: "style-town" },
            { id: "hamlet", pinStyle: "style-hamlet" },
            { id: "unstyled-town", pinStyle: null, generated: { tier: "town" } },
            { id: "unstyled-largeTown", pinStyle: null, generated: { tier: "largeTown" } },
            { id: "own", pinStyle: null },
        ],
        mapRoutes: [{ id: "trunk", class: "trunk" }, { id: "main", class: "main" }, { id: "minor", class: "minor" }, { id: "drawn", class: null }],
        layerSets: [political, custom],
    };
}

const ids = (items) => items.map((item) => item.id);

test("a pin takes its style's level, then its generated tier's, and is otherwise always shown", () => {
    const app = studio(3);
    assert.deepEqual(app.mapPins.map((pin) => DetailLevel.ofPin(app, pin)), [0, 2, 3, 2, 1, 0]);
});

test("each level shows what is at or below it; Everything is the arrays themselves", () => {
    const everything = studio(3);
    assert.equal(DetailLevel.shown(everything).pins, everything.mapPins);
    const world = DetailLevel.shown(studio(0));
    assert.deepEqual(ids(world.pins), ["city", "own"]);
    assert.deepEqual(ids(world.routes), ["trunk", "main", "minor", "drawn"], "routes are shown at every level");
    const province = DetailLevel.shown(studio(1));
    assert.deepEqual(ids(province.pins), ["city", "unstyled-largeTown", "own"]);
    const provincial = studio(1);
    const [political, custom] = provincial.layerSets;
    const { showsLevel } = DetailLevel.shown(provincial);
    assert.deepEqual(political.levels.map((level) => showsLevel(political, level)), [true, true, false]);
    assert.equal(showsLevel(custom, custom.levels[0]), true, "levels of other sets are always shown");
    assert.equal(DetailLevel.shows(studio(0), "region", { set: political, level: political.levels[1] }), false);
    assert.equal(DetailLevel.shows(studio(0), "route", { class: "minor" }), true);
});

test("a saved level is made valid, and a map without one shows everything", () => {
    assert.equal(DetailLevel.current({ uiState: {} }), 3);
    assert.equal(DetailLevel.valid(7), 3);
    assert.equal(DetailLevel.valid(1), 1);
    assert.deepEqual(DetailLevel.choices(studio(2)).map((choice) => [choice.value, choice.selected]), [[3, false], [2, true], [1, false], [0, false]]);
    assert.equal(clean({ detailLevel: 2 }, RULES.map, cleanContext(() => "x")).detailLevel, 2, "saved with the map");
    const hostile = clean({ detailLevel: 9 }, RULES.map, cleanContext(() => "x")).detailLevel;
    assert.ok(hostile === undefined || hostile <= 3);
});

test("a run starts at the most detailed level whose places are still far enough apart", () => {
    const [, largeTowns, towns] = FILRODENSWMB.GENERATOR.TOWNS.TIERS;
    const minimum = FILRODENSWMB.DETAIL.MIN_SPACING_PX;
    assert.equal(DetailLevel.forScale(towns.spacingKm / minimum), 3, "towns exactly far enough apart: everything");
    assert.equal(DetailLevel.forScale(towns.spacingKm / minimum + 0.1), 1, "towns too close: large towns and above");
    assert.equal(DetailLevel.forScale(largeTowns.spacingKm / minimum + 0.1), 0, "large towns too close: the world view");
    assert.equal(DetailLevel.forScale(3.2), 0, "EXBQDK's whole-globe span");
    assert.equal(DetailLevel.forScale(0), 3);
});

test("a level the detail level hides is not drawn, unless it is being painted", () => {
    const app = studio(0);
    const session = { layerSets: app.layerSets, level: (id) => app.layerSets.flatMap((set) => set.levels).find((level) => level.id === id) };
    for (const set of app.layerSets) for (const level of set.levels) Object.assign(level, { visibility: "all", regions: [], parentLevelId: null });
    const { showsLevel } = DetailLevel.shown(app);
    const all = () => true;
    assert.deepEqual(describeLevels(session, all, null, showsLevel).map((entry) => entry.level.id), ["realms", "lands"]);
    assert.deepEqual(describeLevels(session, all, "counties", showsLevel).map((entry) => entry.level.id), ["counties"]);
});

// ------------------------------------------------------------------ generated details

const { installPlatform, platform } = await import("../../src/platform/index.js");
const { GeneratedDetails } = await import("../../src/applications/GeneratedDetails.js");
installPlatform({ i18n: { ...platform.i18n, localize: (key) => key, lang: "en" } });

/** A generated Political set: one kingdom of two duchies, holding three counties between them. */
function generatedMap(detailLevel) {
    const made = (kind, population, extra = {}) => ({ run: "run", kind, sourceId: 0, population, edited: false, locked: false, ...extra });
    const region = (key, name, parentKey, generated) => ({ id: `r${key}`, key, name, parentKey, description: "", generated, visibility: "all" });
    const set = {
        id: "set",
        kind: "political",
        levels: [
            { id: "realms", titleTemplate: "Kingdom of {name}", regions: [region(1, "Ashford", null, made("realm", 120000, { tier: "kingdom" })), region(8, "Grange", null, made("realm", 9000, { tier: "independent" }))] },
            { id: "duchies", titleTemplate: "Duchy of {name}", regions: [region(2, "Brill", 1, made("duchy", 70000)), region(3, "Crewe", 1, made("duchy", 50000))] },
            { id: "counties", titleTemplate: "County of {name}", regions: [region(4, "Dent", 2, made("county", 30000)), region(5, "Eske", 2, made("county", 40000)), region(6, "Ford", 3, made("county", 50000))] },
        ],
    };
    const own = { id: "own", kind: "custom", levels: [{ id: "lands", regions: [region(7, "", null, null)] }] };
    return {
        uiState: { detailLevel, customPinStyles: STYLES },
        layerSets: [set, own],
        mapPins: [
            { id: "city", name: "Ashford", description: "On the river.", pinStyle: "style-city", generated: made("town", 15234.4, { tier: "city" }) },
            { id: "town", name: "Brill", pinStyle: "style-town", generated: made("town", 2000, { tier: "town" }) },
            { id: "inn", name: "The Bell", description: "", pinStyle: null },
        ],
        mapRoutes: [{ id: "road", name: "", class: "minor", generated: made("route", null) }],
    };
}

test("a generated place's section gives its place, population and the level it is shown from", () => {
    const app = generatedMap(3);
    assert.deepEqual(GeneratedDetails.forPin(app, app.mapPins[0]), [
        { label: "FILRODENSWMB.UI.GeneratedPlace", value: "FILRODENSWMB.UI.PinStyleCity" },
        { label: "FILRODENSWMB.UI.GeneratedPopulation", value: "15,234" },
        { label: "FILRODENSWMB.UI.GeneratedShownFrom", value: "FILRODENSWMB.UI.DetailWorld" },
    ]);
    assert.equal(GeneratedDetails.forPin(app, app.mapPins[2]), null, "a hand-made pin has none");
});

test("a generated region's section counts the duchies and counties beneath it", () => {
    const app = generatedMap(3);
    const [realms, duchies, counties] = app.layerSets[0].levels;
    const values = (rows) => Object.fromEntries(rows.map((row) => [row.label.replace("FILRODENSWMB.UI.Generated", ""), row.value]));
    assert.deepEqual(values(GeneratedDetails.forRegion(app, realms.regions[0])), { Title: "Kingdom of Ashford", Rank: "FILRODENSWMB.UI.GeneratedRankKingdom", Population: "120,000", Duchies: "2", Counties: "3", ShownFrom: "FILRODENSWMB.UI.DetailWorld" });
    assert.equal(values(GeneratedDetails.forRegion(app, realms.regions[1])).Title, "Duchy of Grange", "an independent duchy takes the duchy title");
    assert.deepEqual(values(GeneratedDetails.forRegion(app, duchies.regions[0])), { Title: "Duchy of Brill", Population: "70,000", Counties: "2", ShownFrom: "FILRODENSWMB.UI.DetailProvince" });
    assert.deepEqual(values(GeneratedDetails.forRegion(app, counties.regions[2])), { Title: "County of Ford", Population: "50,000", ShownFrom: "FILRODENSWMB.UI.DetailRegional" });
    assert.equal(GeneratedDetails.forRegion(app, app.layerSets[1].levels[0].regions[0]), null);
});

test("a scene export gives generated items pages only at the map's detail level, with their figures", () => {
    const world = GeneratedDetails.journalPages(generatedMap(0));
    assert.deepEqual(world.pins.map((page) => page.item.id), ["city", "inn"], "the town is below the detail level; the hand-made pin keeps its page");
    assert.deepEqual(world.regions.map((page) => page.item.name), ["Ashford", "Grange"]);
    assert.deepEqual(world.routes, [], "an unnamed route has no page");
    assert.equal(world.pins[0].text, "On the river.\n\nFILRODENSWMB.UI.GeneratedPlace: FILRODENSWMB.UI.PinStyleCity\nFILRODENSWMB.UI.GeneratedPopulation: 15,234\nFILRODENSWMB.UI.GeneratedShownFrom: FILRODENSWMB.UI.DetailWorld");
    const everything = GeneratedDetails.journalPages(generatedMap(3));
    assert.equal(everything.pins.length, 3);
    assert.equal(everything.regions.length, 7);
});
