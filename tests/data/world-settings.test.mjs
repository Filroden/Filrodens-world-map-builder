import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { WorldSettings, WORLD_GROUPS, LINKED_GROUPS } from "../../src/studios/world/data/WorldSettings.js";

const fixture = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const MAPS = {
    p0jbva: fixture("../mesh/fixtures/p0jbva.json"),
    aethoria: fixture("./fixtures/fwmb_aethoria.json"),
    eldoria: fixture("./fixtures/fwmb_eldoria.json"),
};

for (const [name, map] of Object.entries(MAPS)) {
    test(`${name}: split then merge gives back the map's data exactly`, () => {
        const { settings, mapData } = WorldSettings.split(map);
        assert.deepEqual(WorldSettings.merge(settings, mapData), map);
    });
}

test("the world's fields leave the map's data, and the map keeps its own", () => {
    const { settings, mapData } = WorldSettings.split(MAPS.p0jbva);
    for (const key of ["seed", "generationEngine", "mapUnit", "cultures", "customBiomes", "customRouteStyles", "customPinStyles"]) assert.equal(key in mapData, false, key);
    assert.equal(mapData.params.latTop, undefined);
    assert.equal(mapData.params.globalTemp, undefined);
    assert.equal(mapData.params.climate.altCooling, undefined);
    assert.equal(mapData.generatorSettings.ages, undefined);
    assert.equal(mapData.generatorSettings.nameBase, undefined);
    // The map's own: its size, terrain, wind and engine settings
    assert.equal(mapData.mapWidth, MAPS.p0jbva.mapWidth);
    assert.deepEqual(mapData.history, MAPS.p0jbva.history);
    assert.equal(mapData.params.climate.windDistance, MAPS.p0jbva.params.climate.windDistance);
    assert.equal(mapData.params.noise.moisture.octaves, MAPS.p0jbva.params.noise.moisture.octaves);
    assert.equal(mapData.terrainVersion, MAPS.p0jbva.terrainVersion);
    // The world's: the frame recorded beside them
    assert.equal(settings.setup.seed, MAPS.p0jbva.seed);
    assert.deepEqual(settings.setup.frame, { width: MAPS.p0jbva.mapWidth, height: MAPS.p0jbva.mapHeight });
    assert.deepEqual(settings.cultures.list, MAPS.p0jbva.cultures);
});

test("a world description holding only its area factor is not left behind as an empty object", () => {
    const map = { mapWidth: 10, mapHeight: 10, world: { areaFactor: 4 }, params: {} };
    const { settings, mapData } = WorldSettings.split(map);
    assert.equal(settings.setup.areaFactor, 4);
    assert.equal("world" in mapData, false);
    assert.deepEqual(WorldSettings.merge(settings, mapData), map);
});

test("merge takes every group from the world, whatever an older copy in the map's data says", () => {
    const { settings } = WorldSettings.split(MAPS.p0jbva);
    const stale = structuredClone(MAPS.aethoria);
    const merged = WorldSettings.merge(settings, stale);
    assert.deepEqual(merged.cultures, MAPS.p0jbva.cultures);
    assert.deepEqual(merged.customRouteStyles, MAPS.p0jbva.customRouteStyles);
    assert.equal(merged.params.globalTemp, MAPS.p0jbva.params.globalTemp);
    assert.equal(merged.seed, MAPS.p0jbva.seed);
    // ... and leaves out what the world has none of
    const merged2 = WorldSettings.merge({ ...settings, biomes: {} }, stale);
    assert.equal("customBiomes" in merged2, false);
    assert.equal("nextCustomBiomeId" in merged2, false);
});

test("split and merge copy rather than share", () => {
    const map = structuredClone(MAPS.eldoria);
    const { settings, mapData } = WorldSettings.split(map);
    settings.styles.route?.push?.({ id: "changed" });
    mapData.mapPins?.push?.({ id: "changed" });
    assert.deepEqual(map, MAPS.eldoria);
    const merged = WorldSettings.merge(settings, mapData);
    merged.cultures?.push?.({ id: "x" });
    assert.notDeepEqual(merged.cultures, settings.cultures.list ?? null);
});

test("a held regional world keeps its own setup and links every other group", () => {
    const own = WorldSettings.split(MAPS.eldoria).settings;
    const source = { ...WorldSettings.split(MAPS.p0jbva).settings, icons: { custom: [{ id: "a", name: "A", path: "a.svg" }], disabled: [] } };
    const linked = WorldSettings.linked(own, source);
    assert.deepEqual(linked.setup, own.setup);
    for (const group of LINKED_GROUPS) assert.deepEqual(linked[group], source[group], group);
    assert.deepEqual(WorldSettings.linked(own, {}).icons, WorldSettings.emptyIcons());
});

test("changedGroups names the groups that differ", () => {
    const a = WorldSettings.split(MAPS.p0jbva).settings;
    const b = structuredClone(a);
    assert.deepEqual(WorldSettings.changedGroups(a, b), []);
    b.climate.globalTemp = (b.climate.globalTemp ?? 0) + 1;
    b.icons = { custom: [], disabled: ["castle"] };
    assert.deepEqual(WorldSettings.changedGroups(a, b), ["climate", "icons"]);
    assert.equal(WORLD_GROUPS.length, 8);
});

/** A map with homelands on its cultures and places on its events, as the studio builds them. */
const withPoints = () => {
    const map = structuredClone(MAPS.p0jbva);
    map.cultures = [
        { id: "hill", name: "Hillfolk", homelands: [{ x: 4, y: 5 }] },
        { id: "sea", name: "Sea folk", homelands: [] },
        { id: "plain", name: "Plainsfolk" },
    ];
    map.generatorSettings = { ...map.generatorSettings, ages: [{ id: "age-1", era: "early", strife: "calm", events: [{ kind: "realmEvent", place: { x: 7, y: 8 } }, { kind: "migration", culture: "hill" }] }] };
    return map;
};

test("homelands and events' places are the map's (S0 step 4c-2): out of the world's cultures and ages, back on load", () => {
    const map = withPoints();
    const { settings, mapData } = WorldSettings.split(map);
    assert.deepEqual(settings.cultures.list.map((culture) => "homelands" in culture), [false, false, false], "the world holds no homelands");
    assert.equal("place" in settings.ages.list[0].events[0], false, "nor events' places");
    assert.deepEqual(mapData.homelands, { hill: [{ x: 4, y: 5 }], sea: [] }, "kept by culture id; a culture with none given has no entry");
    assert.deepEqual(mapData.eventPlaces, { "age-1": { realmEvent: { x: 7, y: 8 } } }, "by age id, then by the event's kind");
    assert.deepEqual(WorldSettings.merge(settings, mapData), map, "merged back where the studio reads them");
    // Two maps of one world, each with its own homelands for the same cultures
    const other = { ...mapData, homelands: { hill: [{ x: 1, y: 1 }] }, eventPlaces: {} };
    const merged = WorldSettings.merge(settings, other);
    assert.deepEqual(merged.cultures.map((culture) => culture.homelands), [[{ x: 1, y: 1 }], undefined, undefined]);
    assert.equal("place" in merged.generatorSettings.ages[0].events[0], false);
    assert.equal("homelands" in merged || "eventPlaces" in merged, false, "the map's entries are not left in the payload");
});

test("a world saved before step 4c-2 keeps its inline homelands until its map's next save, but a held world reads none of its parent's", () => {
    const map = withPoints();
    // The world as it was saved before: its cultures and ages with their points inline
    const old = WorldSettings.split(MAPS.p0jbva).settings;
    old.cultures = { list: structuredClone(map.cultures) };
    old.ages = { list: structuredClone(map.generatorSettings.ages) };
    const mapData = WorldSettings.split(MAPS.p0jbva).mapData;
    delete mapData.homelands;
    delete mapData.eventPlaces;
    const merged = WorldSettings.merge(old, mapData);
    assert.deepEqual(merged.cultures[0].homelands, [{ x: 4, y: 5 }], "read through");
    assert.deepEqual(merged.generatorSettings.ages[0].events[0].place, { x: 7, y: 8 });
    // Its next save moves them to the map
    const again = WorldSettings.split(merged);
    assert.deepEqual(again.mapData.homelands.hill, [{ x: 4, y: 5 }]);
    assert.equal("homelands" in again.settings.cultures.list[0], false);
    const held = WorldSettings.merge(old, mapData, { inline: false });
    assert.equal("homelands" in held.cultures[0], false, "a held world's cultures are its parent's, in the parent's pixels");
    assert.equal("place" in held.generatorSettings.ages[0].events[0], false);
});
