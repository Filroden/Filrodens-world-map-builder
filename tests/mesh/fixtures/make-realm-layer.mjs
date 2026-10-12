/* global process */
// Carries the settlement prototype's final realms (a run of ./run.sh out/p0 out/c0 test-cultures.json)
// from its 25 km model mesh onto P0JBVA's display mesh, the way the generator will: each land cell
// takes the realm most of its land pixels belong to, unowned land joins the nearest realm, borders
// are relaxed onto the terrain and realms claim their territorial waters. Writes the result, RLE
// encoded, to p0jbva-realms.json for the owner and border tests.
//   node tests/mesh/fixtures/make-realm-layer.mjs <prototype out dir>   (e.g. design/prototypes/settlements/out)
// Only needed again if the mesh algorithm version changes (the fixture is tied to the mesh).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MeshBuilder } from "../../../src/mesh/MeshBuilder.js";
import { OwnerLayer } from "../../../src/mesh/OwnerLayer.js";
import { createMeshBlock } from "../../../src/mesh/Schema.js";
import { claimWaters, fillUnclaimedLand, relaxBorders } from "../../../src/mesh/Territory.js";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2];
const mapData = JSON.parse(readFileSync(join(here, "p0jbva.json"), "utf8"));
mapData.mesh = createMeshBlock(mapData);
const mesh = MeshBuilder.fromMapData(mapData);
mapData.mesh.cells = mesh.cellCount;

const f32 = (name) => new Float32Array(readFileSync(join(outDir, `p0.${name}.f32`)).buffer.slice(0));
const elevation = f32("elev");
const waterMask = f32("water");
const riverKm = f32("riverkm");
const coarseCell = new Int32Array(readFileSync(join(outDir, "p0.cellid.i32")).buffer.slice(0));
const realmOfCell = JSON.parse(readFileSync(join(outDir, "c0f.realms.json"), "utf8")).realmOfCell;
const seaLevel = mapData.params.seaLevel;
const aggregates = mesh.aggregate({ elevation, seaLevel, waterMask, riverKm });

// Majority vote of land pixels
const votes = new Map();
const raster = mesh.cellRaster;
for (let pixel = 0; pixel < raster.length; pixel++) {
    if (elevation[pixel] < seaLevel || waterMask[pixel] > 0) continue;
    const realm = realmOfCell[coarseCell[pixel]];
    if (realm < 0) continue;
    const cell = raster[pixel];
    let tally = votes.get(cell);
    if (!tally) votes.set(cell, (tally = new Map()));
    tally.set(realm, (tally.get(realm) ?? 0) + 1);
}
const layer = new OwnerLayer(mesh.cellCount);
for (const [cell, tally] of votes) {
    if (!aggregates.land[cell]) continue;
    let best = -1;
    let bestVotes = 0;
    for (const [realm, count] of tally) if (count > bestVotes || (count === bestVotes && realm < best)) [best, bestVotes] = [realm, count];
    layer.owners[cell] = best;
}
fillUnclaimedLand(mesh, layer, aggregates.land);
relaxBorders(mesh, layer, aggregates);
claimWaters(mesh, layer, aggregates.land);

const realms = new Set(layer.owners);
realms.delete(-1);
writeFileSync(join(here, "p0jbva-realms.json"), JSON.stringify({ mesh: mapData.mesh, regions: realms.size, owners: layer.encode() }, null, 1));
console.log(`${mesh.cellCount} cells, ${realms.size} realms, ${layer.encode().length} characters encoded`);
