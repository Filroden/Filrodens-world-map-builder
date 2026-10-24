// Names by detail level (DetailLevel.ofName): each pin style's name level, the defaults by tier,
// what each level names, the one-off pass that gives older runs' hidden names back to their styles
// (NameLevels), and what is saved.
import "../mesh/foundry-stubs.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { FILRODENSWMB } from "../../src/config.js";
import { DetailLevel } from "../../src/applications/DetailLevel.js";
import { PinStyles } from "../../src/applications/PinStyles.js";
import { showNamesOnce } from "../../src/data/NameLevels.js";
import { RULES, clean, cleanContext } from "../../src/data/MapRules.js";

const STYLES = [
    { id: "style-city", tier: "city", detailLevel: 0, label: { visibility: "all", detailLevel: 0 } },
    { id: "style-large", tier: "largeTown", detailLevel: 1, label: { visibility: "all", detailLevel: 2 } },
    // Saved before styles had a name level: its tier's default (Everything for a town)
    { id: "style-town", tier: "town", detailLevel: 2, label: { visibility: "gm" } },
    // A style of the user's own with no name level: the name shows with the pin
    { id: "style-own", detailLevel: 1, label: { visibility: "all" } },
    // A name level below the pin's own: never before the pin
    { id: "style-early", detailLevel: 2, label: { visibility: "all", detailLevel: 0 } },
];

function studio(detailLevel) {
    return {
        uiState: { detailLevel, customPinStyles: STYLES },
        mapPins: [
            { id: "city", pinStyle: "style-city" },
            { id: "large", pinStyle: "style-large" },
            { id: "town", pinStyle: "style-town" },
            { id: "own", pinStyle: "style-own" },
            { id: "early", pinStyle: "style-early" },
            { id: "off-style", pinStyle: null, generated: { tier: "fortifiedTown" } },
            { id: "hand", pinStyle: null },
        ],
    };
}

test("the default styles name capitals and cities from World, the middling tiers from Regional, the rest from Local and villages from Everything, never before their pins", () => {
    const byTier = Object.fromEntries(PinStyles.defaults().map((style) => [style.tier, style]));
    const levels = Object.fromEntries(Object.entries(byTier).map(([tier, style]) => [tier, style.label.detailLevel]));
    assert.deepEqual(levels, {
        capital: 0, city: 0, largeTown: 2, town: 3, marketTown: 3, largeVillage: 4, village: 4, castle: 2, fortifiedTown: 2, port: 2, ruin: 3,
        ruinedCapital: 3, ruinedCity: 3, ruinedLargeTown: 3, ruinedTown: 3, abandonedCastle: 3, landmark: 2,
    });
    for (const style of Object.values(byTier)) assert.ok(style.label.detailLevel >= style.detailLevel, style.tier);
});

test("a pin's name level is its style's, else its tier's default, else its own level; never below the pin's", () => {
    const app = studio(3);
    assert.deepEqual(app.mapPins.map((pin) => DetailLevel.ofName(app, pin)), [0, 2, 3, 1, 2, 2, 0]);
    assert.equal(PinStyles.nameLevel(STYLES[2]), 3, "a style saved before name levels takes its tier's");
});

test("each level names the pins whose name level it reaches; Everything names all", () => {
    const names = (level) => {
        const app = studio(level);
        const { pins, showsName } = DetailLevel.shown(app);
        return pins.filter(showsName).map((pin) => pin.id);
    };
    assert.deepEqual(names(0), ["city", "hand"]);
    assert.deepEqual(names(1), ["city", "own", "hand"]);
    assert.deepEqual(names(2), ["city", "large", "own", "early", "off-style", "hand"]);
    assert.deepEqual(names(3), ["city", "large", "town", "own", "early", "off-style", "hand"]);
});

/** A map saved by an older run: towns' labels hidden, the capital's shown. */
function olderMap() {
    const gen = (id, tier, run, visibility, extra = {}) => ({ id, pinStyle: `style-${tier}`, label: { visibility }, generated: { run, tier, edited: false, ...extra } });
    return {
        customPinStyles: [{ id: "style-town", tier: "town", label: { visibility: "gm" } }],
        mapPins: [
            gen("capital", "capital", "named", "all"),
            gen("city", "city", "named", "none"),
            gen("town", "town", "named", "none"),
            gen("ruin", "ruinedTown", "named", "none"),
            gen("edited", "town", "named", "none", { edited: true }),
            gen("silent-capital", "capital", "silent", "none"),
            gen("silent-town", "town", "silent", "none"),
            { id: "hand", label: { visibility: "none" } },
        ],
    };
}

test("once, a run's hidden names below a city are given back to their styles; edited pins, cities and a run made with names off are left alone", () => {
    const map = olderMap();
    assert.equal(showNamesOnce(map), 2);
    const visibility = Object.fromEntries(map.mapPins.map((pin) => [pin.id, pin.label.visibility]));
    assert.deepEqual(visibility, { capital: "all", city: "none", town: "gm", ruin: "all", edited: "none", "silent-capital": "none", "silent-town": "none", hand: "none" });
    assert.equal(map.nameLevels, true);
    map.mapPins[2].label.visibility = "none";
    assert.equal(showNamesOnce(map), 0, "a map already passed is left as it is");
    assert.equal(map.mapPins[2].label.visibility, "none");
});

test("name levels and the pass's mark are saved, and hostile values cleaned", () => {
    const context = cleanContext(() => "x");
    const style = clean({ id: "abcdefghijklmnop", name: "Town", icon: "dot", scale: 1, color: "#ffffff", detailLevel: 2, label: { fontSize: 1, visibility: "all", detailLevel: 3 } }, RULES.pinStyle, context);
    assert.equal(style.label.detailLevel, 3);
    assert.equal(clean({ label: { detailLevel: "lots" } }, RULES.pinStyle, context).label.detailLevel, undefined);
    assert.equal(clean({ nameLevels: true }, RULES.map, context).nameLevels, true);
    assert.equal(clean({ nameLevels: "yes" }, RULES.map, context).nameLevels, undefined);
});

test("the default styles carry their name levels", () => {
    for (const seed of FILRODENSWMB.PINS.DEFAULT_STYLES) assert.ok(Number.isInteger(seed.labelDetailLevel), seed.tier);
});
