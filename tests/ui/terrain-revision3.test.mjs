// Terrain revision 3, which changes only hotspot chains and custom rivers: every rule revision 2
// brought stays gated at 2, so a revision 2 map regenerates as it did; a revision 2 map with
// neither a hotspot chain nor a custom river moves to revision 3 as it opens, and one with either
// is offered the update; a regional map takes its parent's revision from revision 2 on.
import assert from "node:assert/strict";
import { test } from "node:test";
import { installPlatform, platform } from "../../src/platform/index.js";

installPlatform({ ...platform, i18n: { localize: (key) => key, format: (key) => key, lang: "en" } });
const { FILRODENSWMB } = await import("../../src/config.js");
const { TerrainVersion } = await import("../../src/tools/TerrainVersion.js");
const { TerrainUpgrade } = await import("../../src/applications/TerrainUpgrade.js");

const { LEGACY, REVISION_2, REVISION_3, CURRENT } = FILRODENSWMB.TERRAIN_VERSION;
const HOTSPOT = { id: 1, type: FILRODENSWMB.TECTONICS.FEATURES.TYPES.HOTSPOT, revision: FILRODENSWMB.TECTONICS.FEATURES.REVISION, points: [] };
const RANGE = { id: 2, type: FILRODENSWMB.TECTONICS.FEATURES.TYPES.RANGE, revision: FILRODENSWMB.TECTONICS.FEATURES.REVISION, points: [] };
const RIVER = { id: 3, points: [] };
const map = (terrainVersion, engine = "guided") => ({ terrainVersion, generationEngine: engine, mapWidth: 1000, mapHeight: 1000, windDistance: FILRODENSWMB.CLIMATE.WIND_DISTANCE, world: null });

test("a new map is made at revision 3", () => {
    assert.equal(REVISION_3, 3);
    assert.equal(CURRENT, REVISION_3);
});

test("revision 2's rules hold at revisions 2 and 3, and revision 3's only at 3", () => {
    for (const engine of ["advanced", "guided", "flat", "standard"]) {
        for (const version of [REVISION_2, REVISION_3]) {
            const state = map(version, engine);
            assert.equal(TerrainVersion.usesCurrentRivers(state), true, `${engine} v${version} rivers`);
            assert.equal(TerrainVersion.usesCurrentCoastline(state), ["guided", "advanced"].includes(engine), `${engine} v${version} coastline`);
            assert.equal(TerrainVersion.isLegacyCoastline(state), false);
            assert.equal(TerrainVersion.canCreateRegionalMap(state), true);
        }
        assert.equal(TerrainVersion.usesCurrentHotspots(map(REVISION_2, engine)), false);
        assert.equal(TerrainVersion.usesGuidedRivers(map(REVISION_2, engine)), false);
        assert.equal(TerrainVersion.usesCurrentHotspots(map(REVISION_3, engine)), true);
        assert.equal(TerrainVersion.usesGuidedRivers(map(REVISION_3, engine)), true);
        assert.equal(TerrainVersion.usesCurrentHotspots(map(LEGACY, engine)), false);
    }
});

test("a revision 2 map with neither a hotspot chain nor a custom river settles at revision 3 as it opens", () => {
    assert.equal(TerrainVersion.settlesOnLoad(map(REVISION_2), [RANGE], []), true);
    assert.equal(TerrainVersion.isUpgradeCandidate(map(REVISION_2), [RANGE], []), false);
    assert.equal(TerrainVersion.settlesOnLoad(map(REVISION_2), [HOTSPOT], []), false);
    assert.equal(TerrainVersion.settlesOnLoad(map(REVISION_2), [], [RIVER]), false);
    // Only revision 2 settles: a legacy map is offered its own update, a current one has none to make
    assert.equal(TerrainVersion.settlesOnLoad(map(LEGACY), [], []), false);
    assert.equal(TerrainVersion.settlesOnLoad(map(REVISION_3), [], []), false);
});

test("a revision 2 map with a hotspot chain or a custom river is offered the update", () => {
    assert.deepEqual(TerrainVersion.revision3Changes(map(REVISION_2), [RANGE, HOTSPOT], []), { hotspots: true, rivers: false });
    assert.deepEqual(TerrainVersion.revision3Changes(map(REVISION_2), [], [RIVER]), { hotspots: false, rivers: true });
    assert.equal(TerrainVersion.isUpgradeCandidate(map(REVISION_2), [HOTSPOT], []), true);
    assert.equal(TerrainVersion.isUpgradeCandidate(map(REVISION_2), [], [RIVER]), true);
    assert.equal(TerrainVersion.isUpgradeCandidate(map(REVISION_3), [HOTSPOT], [RIVER]), false);
    // A legacy map's own update covers these, reported in its own terms
    assert.deepEqual(TerrainVersion.revision3Changes(map(LEGACY), [HOTSPOT], [RIVER]), { hotspots: false, rivers: false });

    const app = { uiState: map(REVISION_2), tectonicFaults: [HOTSPOT], manualRivers: [RIVER] };
    const impact = TerrainUpgrade.assess(app);
    assert.equal(impact.kind, "revision3");
    assert.equal(impact.rebuildsHotspots, true);
    assert.equal(impact.guidesRivers, true);
    assert.equal(impact.changesTerrain, false);
    assert.equal(impact.plan.terrainVersion, REVISION_3);
    // The update changes the revision and nothing else
    assert.equal(impact.plan.windDistance, app.uiState.windDistance);
    assert.equal(impact.plan.coastlineFracture, undefined);
    assert.equal(impact.plan.world, null);
});

test("a regional map takes its parent's revision from revision 2 on, and the current one under a legacy parent", () => {
    assert.equal(TerrainVersion.getRegionalVersion(map(REVISION_2)), REVISION_2);
    assert.equal(TerrainVersion.getRegionalVersion(map(REVISION_3)), REVISION_3);
    assert.equal(TerrainVersion.getRegionalVersion(map(LEGACY, "standard")), CURRENT);
    assert.equal(TerrainVersion.getRegionalVersion({}), CURRENT);
});
