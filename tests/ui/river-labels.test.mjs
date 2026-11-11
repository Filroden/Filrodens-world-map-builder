// A custom river's name on the map (RiverLabels): hidden for a river drawn before rivers had
// labels and shown for one drawn since (in the River label style when the map has it), drawn along
// the traced river nearest its guide, and whether a river Name natural features finds is one a
// custom river names.
import "../mesh/foundry-stubs.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

const { FILRODENSWMB } = await import("../../src/config.js");
const { RiverLabels } = await import("../../src/applications/RiverLabels.js");

const app = (extra = {}) => ({ uiState: { customLabelStyles: [] }, manualRivers: [], currentRiverData: null, ...extra });

test("a river drawn before rivers had labels reads as hidden; a label shown or hidden by its visibility", () => {
    const old = { id: "a", name: "Old", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] };
    assert.equal(RiverLabels.shown(old), false);
    assert.equal(RiverLabels.label(app(), old).visibility, "none");
    assert.equal(RiverLabels.shown({ ...old, label: { visibility: "gm" } }), true);
    assert.equal(RiverLabels.shown({ ...old, label: { visibility: "none" } }), false);
    assert.equal(RiverLabels.label(app(), { ...old, label: {} }).visibility, "all", "a label without a visibility is shown, as every owned label");
});

test("a new river's label is shown in the River label style, which is added when the map lacks it", () => {
    const id = FILRODENSWMB.FEATURE_NAMES.STYLES.river;
    const bare = app();
    const label = RiverLabels.newLabel(bare);
    assert.equal(label.visibility, "all");
    assert.equal(label.quickStyle, id);
    const added = bare.uiState.customLabelStyles.filter((style) => style.id === id);
    assert.equal(added.length, 1, "the River style added from the defaults");
    const seed = FILRODENSWMB.LABELS.DEFAULT_STYLES.find((style) => style.id === id);
    assert.deepEqual([label.fontFamily, label.fontSize, label.italic], [seed.fontFamily, seed.fontSize, seed.italic]);
    RiverLabels.newLabel(bare);
    assert.equal(bare.uiState.customLabelStyles.length, 1, "added once");

    // The map's own River style, as the reader changed it, is the one used
    const own = { id, name: "River", fontFamily: "EB Garamond", fontSize: 1.4, fillColor: "#335577", maxChars: 0, justify: "center", bold: false, italic: true };
    const styled = RiverLabels.newLabel(app({ uiState: { customLabelStyles: [own] } }));
    assert.deepEqual([styled.quickStyle, styled.fontFamily, styled.fontSize, styled.bold], [id, "EB Garamond", 1.4, false]);
});

test("the name follows the traced river near the guide, and the guide where none is near", () => {
    // A traced river 6 px below the guide for its first half, none near its second
    const path = [];
    for (let x = 0; x <= 100; x += 2) path.push({ x, y: 106 });
    const studio = app({ currentRiverData: { vectors: [{ id: 1, path }] } });
    const river = { id: "r", name: "Silver", label: { visibility: "all" }, points: [{ x: 0, y: 100 }, { x: 200, y: 100 }] };
    studio.manualRivers = [river];
    const [{ course }] = RiverLabels.items(studio);
    assert.ok(course.length > 20);
    assert.ok(course.filter((point) => point.x <= 90).every((point) => point.y === 106), "snapped onto the traced river");
    assert.ok(course.filter((point) => point.x >= 130).every((point) => point.y === 100), "the guide where no traced river is near");
    assert.equal(RiverLabels.items(studio)[0].course, course, "worked out once while nothing changes");
    river.points.push({ x: 220, y: 100 });
    assert.notEqual(RiverLabels.items(studio)[0].course, course, "again once the guide changes");
    assert.deepEqual(RiverLabels.items(app({ manualRivers: [{ ...river, label: undefined }] })), [], "a hidden name is not drawn");
});

test("a river found by Name natural features is a custom river's when most of that river's course lies along it", () => {
    const river = { id: "r", name: "Silver", label: { visibility: "all" }, points: [{ x: 0, y: 100 }, { x: 200, y: 100 }] };
    const studio = app({ manualRivers: [river] });
    const along = { path: Array.from({ length: 101 }, (_, i) => [i * 2, 104, 0]) };
    const across = { path: Array.from({ length: 101 }, (_, i) => [100, i * 2, 0]) };
    const half = { path: Array.from({ length: 31 }, (_, i) => [i * 2, 104, 0]) };
    assert.equal(RiverLabels.covers(studio, along), true);
    assert.equal(RiverLabels.covers(studio, across), false);
    assert.equal(RiverLabels.covers(studio, half), false, "a third of its course is not enough");
    assert.equal(RiverLabels.covers(app({ manualRivers: [{ ...river, label: { visibility: "none" } }] }), along), false, "not while its name is hidden");
});
