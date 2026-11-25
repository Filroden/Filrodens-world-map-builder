// Terrain revision 4 (RW), which changes only how a regional map draws its rivers: a new map is made
// at it; a revision 3 top map moves to it as it opens, and a revision 2 one that revision 3 does not
// change moves on to it too; a revision 3 regional map stays at 3 and is offered the update, which
// lists its rivers (and lays its river trade routes again over them); a regional map cut from a
// revision 3 map is made at revision 4; and the crop fingerprint reads revision 4 as revision 3, so
// no held regional world is marked Out of date by it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { installPlatform, platform } from "../../src/platform/index.js";

installPlatform({ ...platform, i18n: { localize: (key) => key, format: (key) => key, lang: "en" } });
const { FILRODENSWMB } = await import("../../src/config.js");
const { TerrainVersion } = await import("../../src/studios/world/tools/TerrainVersion.js");
const { TerrainUpgrade } = await import("../../src/studios/world/app/TerrainUpgrade.js");

const { LEGACY, REVISION_2, REVISION_3, REVISION_4, CURRENT } = FILRODENSWMB.TERRAIN_VERSION;
const HOTSPOT = { id: 1, type: FILRODENSWMB.TECTONICS.FEATURES.TYPES.HOTSPOT, revision: FILRODENSWMB.TECTONICS.FEATURES.REVISION, points: [] };
const REGIONAL = { zoom: 4, originX: 1039, originY: 300, rootW: 2000, rootH: 1600, areaFactor: 15 };
const map = (terrainVersion, world = null) => ({ terrainVersion, generationEngine: "guided", mapWidth: 1600, mapHeight: 1760, windDistance: FILRODENSWMB.CLIMATE.WIND_DISTANCE, world });
/** A top map's world as a v5 map saves it: its area factor only. */
const TOP = { areaFactor: 15 };
const RIVERS = { vectors: [{ id: "river_0", path: [] }] };

test("a new map is made at revision 4", () => {
    assert.equal(REVISION_4, 4);
    assert.equal(CURRENT, REVISION_4);
    assert.equal(TerrainVersion.usesSymbolRivers(map(REVISION_3, REGIONAL)), false);
    assert.equal(TerrainVersion.usesSymbolRivers(map(REVISION_4, REGIONAL)), true);
    assert.equal(TerrainVersion.getTerrainParams(map(REVISION_4)).symbolRivers, true);
    assert.equal(TerrainVersion.getTerrainParams(map(REVISION_3)).symbolRivers, false);
});

test("a map moves as it opens to the latest revision that leaves it as it is", () => {
    // A top map: revision 4 changes nothing on it
    assert.equal(TerrainVersion.settledVersion(map(REVISION_3)), REVISION_4);
    assert.equal(TerrainVersion.settledVersion(map(REVISION_3, TOP)), REVISION_4);
    assert.equal(TerrainVersion.settledVersion(map(REVISION_2, TOP)), REVISION_4);
    // A revision 2 map revision 3 changes stays, offered the update
    assert.equal(TerrainVersion.settledVersion(map(REVISION_2), [HOTSPOT]), null);
    // A regional map: revision 3 if revision 3 changes nothing, never on to 4
    assert.equal(TerrainVersion.settledVersion(map(REVISION_2, REGIONAL)), REVISION_3);
    assert.equal(TerrainVersion.settledVersion(map(REVISION_3, REGIONAL)), null);
    assert.equal(TerrainVersion.settledVersion(map(REVISION_4, REGIONAL)), null);
    assert.equal(TerrainVersion.settledVersion(map(LEGACY)), null);
    assert.equal(TerrainVersion.settlesOnLoad(map(REVISION_3)), true);
    assert.equal(TerrainVersion.settlesOnLoad(map(REVISION_3, REGIONAL)), false);
});

test("a revision 3 regional map is offered the update, which narrows its rivers and changes nothing else", () => {
    assert.deepEqual(TerrainVersion.revision4Changes(map(REVISION_3, REGIONAL)), { rivers: true });
    assert.deepEqual(TerrainVersion.revision4Changes(map(REVISION_3, TOP)), { rivers: false });
    assert.deepEqual(TerrainVersion.revision4Changes(map(REVISION_4, REGIONAL)), { rivers: false });
    assert.equal(TerrainVersion.isUpgradeCandidate(map(REVISION_3, REGIONAL)), true);
    assert.equal(TerrainVersion.isUpgradeCandidate(map(REVISION_3, TOP)), false);
    assert.equal(TerrainVersion.isUpgradeCandidate(map(REVISION_4, REGIONAL)), false);

    const app = { uiState: map(REVISION_3, REGIONAL), tectonicFaults: [], manualRivers: [], currentRiverData: RIVERS };
    const impact = TerrainUpgrade.assess(app);
    assert.equal(impact.kind, "revision4");
    assert.equal(impact.narrowsRivers, true);
    assert.equal(impact.changesTerrain, false);
    assert.equal(impact.changesBiomes, false);
    assert.equal(impact.plan.terrainVersion, REVISION_4);
    assert.equal(impact.plan.windDistance, app.uiState.windDistance);
    assert.deepEqual(impact.plan.world, REGIONAL);
    assert.equal(impact.plan.coastlineFracture, undefined);

    // With no river drawn there is nothing to offer
    assert.equal(TerrainUpgrade.assess({ ...app, currentRiverData: { vectors: [] } }), null);
});

test("an older regional map's own update lists its rivers too", () => {
    const app = { uiState: map(REVISION_2, REGIONAL), tectonicFaults: [HOTSPOT], manualRivers: [], currentRiverData: RIVERS };
    const impact = TerrainUpgrade.assess(app);
    assert.equal(impact.kind, "revision3");
    assert.equal(impact.narrowsRivers, true);
    assert.equal(impact.plan.terrainVersion, REVISION_4);
    // A top map's update does not
    assert.equal(TerrainUpgrade.assess({ ...app, uiState: map(REVISION_2) }).narrowsRivers, false);
});

test("the update lays a regional map's river trade routes again over its narrower rivers", async () => {
    let relayed = 0;
    const app = {
        uiState: map(REVISION_3, REGIONAL),
        tectonicFaults: [],
        manualRivers: [],
        // Imported without its parent: the update lays its routes again all the same
        currentParentId: null,
        riverRoutesLaid: true,
        mapRoutes: [],
        meshSession: { aggregates: {}, riverChannel: () => (relayed++, null) },
        generateTerrain: async () => {},
        markDirty: () => {},
    };
    await TerrainUpgrade.apply(app, TerrainVersion.planUpgrade(app.uiState));
    assert.equal(app.uiState.terrainVersion, REVISION_4);
    assert.equal(relayed, 1, "the relay read the rivers as drawn now");
    assert.equal(app.riverRoutesLaid, true);

    // A top map's update leaves its routes alone
    relayed = 0;
    const top = { ...app, uiState: map(REVISION_2, TOP), riverRoutesLaid: true };
    await TerrainUpgrade.apply(top, TerrainVersion.planUpgrade(top.uiState));
    assert.equal(relayed, 0);
});

test("a regional map cut from a revision 3 map is made at revision 4, and its fingerprint reads it as revision 3", () => {
    assert.equal(TerrainVersion.getRegionalVersion(map(REVISION_3)), REVISION_4);
    assert.equal(TerrainVersion.getRegionalVersion(map(REVISION_3, REGIONAL)), REVISION_4);
    assert.equal(TerrainVersion.getRegionalVersion(map(REVISION_4)), REVISION_4);
    assert.equal(TerrainVersion.getRegionalVersion(map(REVISION_2)), REVISION_2);
    assert.equal(TerrainVersion.cutContentRevision(REVISION_4), REVISION_3);
    assert.equal(TerrainVersion.cutContentRevision(REVISION_3), REVISION_3);
    assert.equal(TerrainVersion.cutContentRevision(REVISION_2), REVISION_2);
});
