// A map's marks (MapMarks, S0 step 6): one function from a map's state to its marks, read by the
// layer switcher's Surface segment, the overview's Surface map card and Peoples and realms' Run heading.
import assert from "node:assert/strict";
import { test } from "node:test";

const { installPlatform } = await import("../../src/platform/index.js");
installPlatform({ i18n: { localize: (key) => `[${key}]`, format: (key) => key, lang: "en" } });
const { MapMarks } = await import("../../src/studios/world/app/MapMarks.js");

const kinds = (state, options) => MapMarks.of(state, options).map((mark) => mark.label);

test("a map with no run is marked No run, unless a line says so already", () => {
    assert.deepEqual(kinds({ hasRun: false }), ["FILRODENSWMB.UI.MarkNoRun"]);
    assert.deepEqual(kinds({ hasRun: false }, { noRun: false }), []);
    assert.deepEqual(kinds({ hasRun: false, runEdited: true, older: true }, { noRun: false }), [], "without a run there is nothing to be out of date or older");
});

test("a run edited since is Out of date, and one by an older generator is Older generator, Out of date first", () => {
    assert.deepEqual(kinds({ hasRun: true }), []);
    assert.deepEqual(kinds({ hasRun: true, runEdited: true }), ["FILRODENSWMB.UI.MarkOutOfDate"]);
    assert.deepEqual(kinds({ hasRun: true, older: true }), ["FILRODENSWMB.UI.MarkOlderGenerator"]);
    assert.deepEqual(kinds({ hasRun: true, runEdited: true, older: true }), ["FILRODENSWMB.UI.MarkOutOfDate", "FILRODENSWMB.UI.MarkOlderGenerator"]);
});

test("a held regional world out of date with its parent leads, whatever its run", () => {
    assert.deepEqual(kinds({ hasRun: true, runEdited: true, regionalStale: true }), ["FILRODENSWMB.UI.MarkRegionalOutOfDate", "FILRODENSWMB.UI.MarkOutOfDate"]);
    assert.deepEqual(kinds({ hasRun: false, regionalStale: true }, { noRun: false }), ["FILRODENSWMB.UI.MarkRegionalOutOfDate"]);
});

test("named marks carry their words; the marks themselves are frozen", () => {
    const [mark] = MapMarks.named(MapMarks.of({ hasRun: true, older: true }));
    assert.equal(mark.label, "[FILRODENSWMB.UI.MarkOlderGenerator]");
    assert.equal(mark.kind, "older");
    assert.ok(Object.isFrozen(MapMarks.MARKS.older));
});
