// Pin and label sizes (SymbolSizes): a map or styles file saved before the current size unit is
// scaled once as it is read, so it looks as it did; one saved since is left alone; and a legacy
// pixel label width still becomes the same number of characters.
import assert from "node:assert/strict";
import { test } from "node:test";

const { FILRODENSWMB } = await import("../../src/config.js");
const { needsRebase, rebaseMap } = await import("../../src/data/SymbolSizes.js");
const { MapImport } = await import("../../src/data/MapImport.js");
const { LabelWidth } = await import("../../src/tools/LabelWidth.js");

const GROWTH = 1 / FILRODENSWMB.SYMBOLS.UNIT;

/** A map's sized things as an older version saved them. */
function olderMap() {
    return {
        mapPins: [{ scale: 0.5, label: { fontSize: 0.5 } }, { label: {} }],
        mapRoutes: [{ label: { fontSize: 0.8 } }, {}],
        mapLabels: [{ fontSize: 1.8 }, {}],
        layerSets: [{ levels: [{ regions: [{ label: { fontSize: 2 } }, { label: { visibility: "all" } }] }] }],
        regionLayers: [{ regions: [{ label: { fontSize: 1.5 } }] }],
        customPinStyles: [{ scale: 0.3, label: { fontSize: 0.3 } }],
        customLabelStyles: [{ fontSize: 1.2 }],
    };
}

test("an older map's sizes grow by the unit, and an unset size stays unset (its new default is the old one grown)", () => {
    const map = olderMap();
    assert.equal(rebaseMap(map), true);
    assert.equal(map.sizeRevision, FILRODENSWMB.SYMBOLS.REVISION);
    assert.deepEqual([map.mapPins[0].scale, map.mapPins[0].label.fontSize], [0.5 * GROWTH, 0.5 * GROWTH]);
    assert.equal(map.mapPins[1].scale, GROWTH, "a pin with no scale drew at 1, so it is given 1 grown");
    assert.equal(map.mapPins[1].label.fontSize, undefined);
    assert.equal(map.mapRoutes[0].label.fontSize, 0.8 * GROWTH);
    assert.deepEqual(map.mapLabels, [{ fontSize: 1.8 * GROWTH }, {}]);
    assert.equal(map.layerSets[0].levels[0].regions[0].label.fontSize, 2 * GROWTH);
    assert.equal(map.layerSets[0].levels[0].regions[1].label.fontSize, undefined);
    assert.equal(map.regionLayers[0].regions[0].label.fontSize, 1.5 * GROWTH);
    assert.deepEqual(map.customPinStyles[0], { scale: 0.3 * GROWTH, label: { fontSize: 0.3 * GROWTH } });
    assert.equal(map.customLabelStyles[0].fontSize, 1.2 * GROWTH);
    assert.equal(FILRODENSWMB.LABELS.UNSET_SIZE, GROWTH, "an unset label size draws as 1 did");

    assert.equal(rebaseMap(map), false, "a map already current is left alone");
    assert.equal(map.mapLabels[0].fontSize, 1.8 * GROWTH);
    assert.equal(needsRebase(undefined), true);
    assert.equal(needsRebase(FILRODENSWMB.SYMBOLS.REVISION), false);
});

test("a styles file exported before the unit has its pin and label styles grown; a current one does not", () => {
    const categories = { customPinStyles: [{ name: "Town", icon: "dot", scale: 0.2, label: { fontSize: 0.2 } }], customLabelStyles: [{ name: "Realm", fontSize: 1.8 }] };
    const older = MapImport.readStyles({ schemaVersion: 1, categories: structuredClone(categories) }).categories;
    assert.equal(older.customPinStyles[0].scale, 0.2 * GROWTH);
    assert.equal(older.customPinStyles[0].label.fontSize, 0.2 * GROWTH);
    assert.equal(older.customLabelStyles[0].fontSize, 1.8 * GROWTH);
    const current = MapImport.readStyles({ schemaVersion: 1, sizeRevision: FILRODENSWMB.SYMBOLS.REVISION, categories: structuredClone(categories) }).categories;
    assert.equal(current.customPinStyles[0].scale, 0.2);
    assert.equal(current.customLabelStyles[0].fontSize, 1.8);
});

test("a legacy pixel label width becomes the same characters whether its size is read before or after growing", () => {
    LabelWidth.setMeasurer((_family, sizePx) => sizePx * 0.6);
    const root = 16;
    const before = 0.8;
    const charsNow = LabelWidth.pixelsToChars(200, "Signika", before * GROWTH, root);
    // The width the label had: the old size in root font pixels
    const charPx = LabelWidth.charRatio("Signika") * before * root;
    assert.equal(charsNow, Math.max(1, Math.ceil(200 / charPx - 1e-6)));
    LabelWidth.setMeasurer(null);
});
