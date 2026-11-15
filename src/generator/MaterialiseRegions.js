import { FILRODENSWMB } from "../config.js";
import { OwnerLayer } from "../mesh/OwnerLayer.js";
import { claimWaters } from "../mesh/RegionEdits.js";
import { UNCLAIMED, addRegion, childLevelFields, createLayerSet, createLevel } from "../mesh/Schema.js";
import { floodOwners, relaxBorders } from "../mesh/Territory.js";
import { cultureId, cultureMix } from "./CultureIds.js";

/**
 * A run's realms, duchies and counties as a "political" layer set on the display mesh: three
 * nested levels (Realms › Duchies › Counties), each a partition of the display cells.
 *
 * The counties are laid out first and the levels above are made from them, so the levels nest
 * exactly and every region keeps ground:
 * 1. Carry: every land display cell takes the county of its model cell (Mesh.parentOf).
 * 2. Coast: land display cells whose model cell was water (the model's coarser coast called them
 *    sea) join the nearest county overland. Land the model left unclaimed (the wilds) stays so.
 * 3. Relax: county borders settle onto ridges and rivers (Territory.relaxBorders), each county
 *    keeping its seat, and a county too small to have ground beyond the border band its core.
 * 4. Up: each cell's duchy is its county's duchy and its realm that duchy's realm.
 * 5. Waters: each level claims its territorial waters by its own rule (RegionEdits.claimWaters),
 *    once the set is in the session.
 *
 * Realms fill in colours chosen so that neighbouring realms differ; duchies and counties are drawn
 * as borders only (the atlas convention for child levels): duchies dashed, counties dotted.
 */

/**
 * Builds the political set and its levels' owner arrays (land only; see installPolitical for the waters).
 *
 * @param {import("../mesh/MeshSession.js").MeshSession} session - Needs mesh and aggregates.
 * @param {object} result - A generator run (Pipeline.runGenerator).
 * @param {object} options
 * @param {string} options.runId
 * @param {Function} options.idFactory
 * @param {{set: string, levels: string[], titles: {kingdom: string, duchy: string, county: string}}} options.names
 *     Localised names: the set, the three levels, and the title templates ("Kingdom of {name}"),
 *     kept on the levels. Regions take their bare names: their level's label look shows their rank,
 *     and a short name leaves room to place it (see GeneratedDetails for the full title).
 * @param {number} options.watersPx - The realms' territorial waters, in map pixels.
 * @param {function(string): object} [options.regionLabel] - The label look of a level's regions by kind
 *     (realm, duchy, county): a label style's fields and its id as quickStyle.
 * @param {{duchies?: boolean, counties?: boolean, labels?: boolean}} [options.output] - Which levels
 *     below Realms the set holds (the counties are laid out either way, since the levels above are
 *     made from them), and whether the regions' names are shown.
 * @param {{owners: ArrayLike<number>, keys: Set<number>}[]|null} [options.userRegions] - The map's own
 *     regions the run was built round (see Generation.userRegions), by depth (realms, duchies,
 *     counties): each level's owners and which of its keys are the user's. The counties are then
 *     kept to the exact painted borders (see keepToZones).
 * @returns {{set: object, owners: Object<string, Int32Array>}}
 */
export function buildPolitical(session, result, { runId, idFactory, names, watersPx, regionLabel = () => ({}), output = {}, userRegions = null }) {
    const units = politicalUnits(result);
    const set = createPoliticalSet({ names, watersPx, idFactory, output });
    const levels = set.levels;
    const withDuchies = levels.length > 1;
    const withCounties = levels.length > 2;

    // Every level's names are shown: the detail level shows a level's names with its borders
    // (duchies from Province, counties from Regional), and names with no room are not placed
    const visibility = output.labels === false ? "none" : "all";
    const label = (kind) => ({ ...regionLabel(kind), visibility });
    addRealms(levels[0], result, { runId, idFactory, label: label("realm"), duchyLabel: label("duchy") });
    if (withDuchies) addChildren(levels[1], units.duchies, units.duchyParent, { kind: "duchy", units: result.duchies }, { runId, idFactory, label: label("duchy"), result });
    if (withCounties) addChildren(levels[2], units.counties, units.countyParent, { kind: "county", units: result.counties }, { runId, idFactory, label: label("county"), result });

    const counties = carry(session, result, "county", units.countyKey);
    const zoning = userZoning(session, result, units, userRegions);
    const displaced = zoning ? keepToZones(counties, zoning) : null;
    joinCoast(session, result, counties, zoning, displaced);
    relaxBorders(session.mesh, counties, session.aggregates, {}, { anchors: units.counties.map((index) => result.counties[index].seat), allow: zoning?.allow ?? null });
    const duchies = upward(counties.owners, units.countyParent);
    const realms = upward(duchies, units.duchyParent);
    if (zoning) holdPainted(result, units, userRegions, [realms, duchies, counties.owners]);
    const owners = Object.fromEntries([realms, duchies, counties.owners].slice(0, levels.length).map((array, depth) => [levels[depth].id, array]));
    colourRealms(levels[0], result);
    return { set, owners };
}

/**
 * An empty Political set with the levels a run makes (Realms › Duchies › Counties, or fewer as
 * `output` asks), named and drawn as a run's: realms filled and claiming `watersPx` of sea,
 * duchies dashed and counties dotted as borders only. A run writes into it (see
 * Regeneration.merge), and Move to Political set makes one when the map has none.
 * @param {object} options
 * @param {{set: string, levels: string[], titles: {kingdom: string, duchy: string, county: string}}} options.names
 * @param {number} options.watersPx
 * @param {Function} options.idFactory
 * @param {{duchies?: boolean, counties?: boolean}} [options.output]
 * @returns {object}
 */
export function createPoliticalSet({ names, watersPx, idFactory, output = {} }) {
    const set = createLayerSet({ name: names.set, kind: "political", visibility: "all", waterTint: true, opacity: 1 }, idFactory);
    const levels = [createLevel({ name: names.levels[0], titleTemplate: names.titles.kingdom, watersPx }, idFactory)];
    const withDuchies = output.duchies !== false;
    if (withDuchies) levels.push(createLevel({ name: names.levels[1], titleTemplate: names.titles.duchy, ...childLevelFields(levels[0].id) }, idFactory));
    if (withDuchies && output.counties !== false) {
        // Counties dotted, land and sea, so each of the three levels has its own line
        const fields = childLevelFields(levels[1].id);
        fields.style = { ...fields.style, lineStyle: "dotted", seaLineStyle: "dotted" };
        levels.push(createLevel({ name: names.levels[2], titleTemplate: names.titles.county, ...fields }, idFactory));
    }
    set.levels.push(...levels);
    return set;
}

/**
 * An earlier age's realms on the display mesh, for the History tool: laid out as the present's
 * counties are (carried from their model cells, the model's coarse coast joined overland, and the
 * borders relaxed onto ridges and rivers with each seat kept), with each realm's index as its key.
 * Land only; the caller claims the waters (RegionEdits.claimWaters) once the level is in a session.
 *
 * @param {import("../mesh/MeshSession.js").MeshSession} session - Needs mesh and aggregates.
 * @param {ArrayLike<number>} realmOfModelCell - Each model cell's realm in that age, or -1.
 * @param {ArrayLike<number>} modelWater - Each model cell's water flag (the run's `water`).
 * @param {number[]} seats - Each realm's seat (a model cell, which is also its site's display cell), or -1.
 * @param {object} [options]
 * @param {ArrayLike<number>} [options.parentOf] - Each display cell's run cell: the mesh's model
 *     cells for the map's own run, a regional map's copy of its parent's run's cells otherwise.
 * @param {number[]} [options.anchors] - The seats as display cells (-1 for one off the map), kept by the borders.
 * @returns {OwnerLayer}
 */
export function pastRealmLayer(session, realmOfModelCell, modelWater, seats, { parentOf = session.mesh.parentOf, anchors = seats } = {}) {
    // Each land display cell takes its run cell's realm: the map's own model cell, or on a regional
    // map the cell of its parent's run it lies in (`parentOf`; -1 for none)
    const { mesh, aggregates } = session;
    const layer = new OwnerLayer(mesh.cellCount);
    const owners = layer.owners;
    for (let cell = 0; cell < mesh.cellCount; cell++) {
        if (aggregates.land[cell] !== 1) continue;
        const unit = realmOfModelCell[parentOf[cell]];
        owners[cell] = Number.isInteger(unit) && unit >= 0 && unit < seats.length ? unit : UNCLAIMED;
    }
    // Land the run called sea (its coast is coarser) goes to the nearest realm overland
    fillFrom(session, layer, (cell) => aggregates.land[cell] === 1 && owners[cell] === UNCLAIMED && modelWater[parentOf[cell]] === 1);
    relaxBorders(mesh, layer, aggregates, {}, { anchors: anchors.filter((cell) => cell >= 0) });
    return layer;
}

/**
 * Puts the political set into the session beside the map's other sets, installs its owner arrays
 * and claims every level's waters. Returns each level's final owners, encoded.
 *
 * @param {import("../mesh/MeshSession.js").MeshSession} session
 * @param {Array} layerSets - The map's sets before the run (not changed).
 * @param {object} set
 * @param {Object<string, Int32Array>} owners
 * @returns {Object<string, string>}
 */
export function installPolitical(session, layerSets, set, owners) {
    session.setLayerSets([...layerSets, set]);
    for (const level of set.levels) session.restoreLevelOwners(level.id, owners[level.id]);
    for (const level of set.levels) claimWaters(session, level);
    const encoded = {};
    for (const level of set.levels) encoded[level.id] = session.layer(level.id).encode();
    return encoded;
}

// ------------------------------------------------------------------ the units and their regions

/**
 * The regions each level gets, with keys: every realm and duchy, and the counties that belong to a
 * duchy (a county whose seat no duke reached has no realm above it, so a nested level cannot hold
 * it). countyKey maps a model county to its region key (-1 for a county left out); realms and
 * duchies keep their model indices as keys.
 */
function politicalUnits(result) {
    const duchyParent = result.duchies.map((duchy) => duchy.realm);
    const counties = [];
    const countyKey = new Int32Array(result.counties.length).fill(UNCLAIMED);
    result.counties.forEach((county, index) => {
        if (county.duchy < 0) return;
        countyKey[index] = counties.length;
        counties.push(index);
    });
    return {
        duchies: result.duchies.map((_, index) => index),
        duchyParent,
        counties,
        countyParent: counties.map((index) => result.counties[index].duchy),
        countyKey,
    };
}

/** The generated details every region carries. */
function generatedFor(runId, kind, sourceId, extra = {}) {
    return { run: runId, kind, sourceId, edited: false, locked: false, ...extra };
}

/** A realm's ruling culture by the map culture's id (`rulingCulture`), or nothing for a run with no cultures or one made before it was recorded. */
function rulingOf(result, realm) {
    const id = cultureId(result, realm.rulingCulture);
    return id === null ? {} : { rulingCulture: id };
}

function addRealms(level, result, { runId, idFactory, label, duchyLabel }) {
    result.realms.forEach((realm, index) => {
        const region = addRegion(level, {
            name: realm.name,
            nameSource: "generated",
            // Each region its own label (a moved label keeps its own position); an independent
            // duchy's in the duchies' look, so a realm's look marks a kingdom
            label: { ...(realm.kind === "kingdom" ? label : duchyLabel) },
            generated: generatedFor(runId, "realm", index, { tier: realm.kind, population: realm.population, culture: cultureId(result, realm.cultures?.[0]?.[0]), ...cultureMix(result, realm.cultures), ...rulingOf(result, realm) }),
        }, idFactory);
        markStandsFor(region, realm);
    });
}

/**
 * A child level's regions: one per unit in `list` (indices into `units`), keyed in list order,
 * each with the key of its parent region and a label in the level's look.
 */
function addChildren(level, list, parentKeys, { kind, units }, { runId, idFactory, label, result }) {
    list.forEach((sourceIndex, key) => {
        const unit = units[sourceIndex];
        const region = addRegion(level, {
            name: unit.name,
            nameSource: "generated",
            parentKey: parentKeys[key],
            label: { ...label },
            generated: generatedFor(runId, kind, sourceIndex, { population: unit.population, culture: cultureId(result, unit.culture) }),
        }, idFactory);
        markStandsFor(region, unit);
    });
}

/**
 * A region made for a unit that stands for one of the map's own regions (see UserRealms) names it
 * by key in `standsFor`, so writing the run onto the map keeps the user's region in its place
 * (see Regeneration.merge, which takes the field off again).
 */
function markStandsFor(region, unit) {
    if (unit.user !== undefined) region.standsFor = unit.user;
}

// ------------------------------------------------------------------ cells

/**
 * A level's land display cells from its model cells: each takes its model cell's unit, as a
 * region key.
 */
function carry(session, result, field, keyOf) {
    const { mesh, aggregates } = session;
    const model = result.modelCells[field];
    const layer = new OwnerLayer(mesh.cellCount);
    const owners = layer.owners;
    for (let cell = 0; cell < mesh.cellCount; cell++) {
        if (aggregates.land[cell] !== 1) continue;
        const unit = model[mesh.parentOf[cell]];
        owners[cell] = unit < 0 ? UNCLAIMED : keyOf[unit];
    }
    return layer;
}

/**
 * Gives the land display cells the model called sea (its coast is coarser) to the nearest region
 * overland, and with the map's own regions (see keepToZones) the cells taken from a county on the
 * wrong side of a painted border, each to the nearest county of its own side.
 */
function joinCoast(session, result, layer, zoning = null, displaced = null) {
    const { mesh, aggregates } = session;
    const owners = layer.owners;
    const modelWater = result.modelCells.water;
    const isSliver = (cell) => aggregates.land[cell] === 1 && owners[cell] === UNCLAIMED && (modelWater[mesh.parentOf[cell]] === 1 || displaced?.[cell] === 1);
    fillFrom(session, layer, isSliver, zoning?.allow ?? null);
}

/** Floods owners from the owned land into the cells `open` accepts (and `allow`, when given, lets each owner take). */
function fillFrom(session, layer, open, allow = null) {
    const { mesh, aggregates } = session;
    const owners = layer.owners;
    const cells = [];
    const values = [];
    for (let cell = 0; cell < mesh.cellCount; cell++) {
        if (owners[cell] !== UNCLAIMED && aggregates.land[cell] === 1) {
            cells.push(cell);
            values.push(owners[cell]);
        }
    }
    const flood = floodOwners(mesh, cells, values, { passable: open, cost: (a, b) => mesh.distance(a, b), allow });
    const filled = [];
    const filledOwners = [];
    for (let cell = 0; cell < mesh.cellCount; cell++) {
        if (owners[cell] === UNCLAIMED && flood.owner[cell] !== UNCLAIMED && open(cell)) {
            filled.push(cell);
            filledOwners.push(flood.owner[cell]);
        }
    }
    layer.assign(filled, filledOwners);
}

// ------------------------------------------------------------------ the map's own regions

/**
 * Where the map's own regions lie on the display mesh, for keeping the run's counties to their
 * exact painted borders (the model saw them only by model cell). Each display cell's zone is the
 * user regions it lies in, written as the run writes a county's `zone` (see UserRealms): "c:<key>"
 * in a user county, else "<realm>,<duchy>,-1" by the user realm's and duchy's keys (-1 for none).
 * Null when the run was not built round any (no county carries a zone).
 *
 * `allow(cell, countyKey)` says whether a county region of the run may hold a display cell: only
 * where the cell's zone is the county's own.
 */
function userZoning(session, result, units, userRegions) {
    if (!userRegions || !result.counties.some((county) => county.zone !== undefined)) return null;
    const count = session.mesh.cellCount;
    const keyAt = (depth, cell) => {
        const level = userRegions[depth];
        const owner = level ? level.owners[cell] : UNCLAIMED;
        return owner !== UNCLAIMED && level.keys.has(owner) ? owner : -1;
    };
    const ids = new Map();
    const idOf = (zone) => {
        if (!ids.has(zone)) ids.set(zone, ids.size);
        return ids.get(zone);
    };
    const zoneOfCell = new Int32Array(count);
    for (let cell = 0; cell < count; cell++) {
        const county = keyAt(2, cell);
        zoneOfCell[cell] = idOf(county >= 0 ? `c:${county}` : `${keyAt(0, cell)},${keyAt(1, cell)},-1`);
    }
    const NO_ZONE = -2;
    const zoneOfKey = units.counties.map((index) => (result.counties[index].zone === undefined ? NO_ZONE : (ids.get(result.counties[index].zone) ?? NO_ZONE)));
    return { zoneOfCell, zoneOfKey, allow: (cell, key) => key !== UNCLAIMED && zoneOfKey[key] === zoneOfCell[cell] };
}

/**
 * Takes from each county the display cells outside its zone (its model cells reach a little past
 * a painted border, since a model cell goes whole to the region holding most of it). Returns which
 * cells were taken, for joinCoast to give to the nearest county of their own side.
 */
function keepToZones(layer, zoning) {
    const owners = layer.owners;
    const displaced = new Uint8Array(owners.length);
    const cells = [];
    for (let cell = 0; cell < owners.length; cell++) {
        if (owners[cell] === UNCLAIMED || zoning.allow(cell, owners[cell])) continue;
        displaced[cell] = 1;
        cells.push(cell);
    }
    layer.assign(cells, new Array(cells.length).fill(UNCLAIMED));
    return displaced;
}

/**
 * Every display cell a user region holds goes, at its level and the levels above, to the regions
 * the run made for it and its parents, even where the model gave its model cell to a neighbour
 * (a model cell goes to the region holding most of it): the user's region keeps all its painted
 * cells when the run is written into the map, and whatever the run put above it covers them too.
 * `levels` are the made owners by depth (realms, duchies, counties), changed in place.
 */
function holdPainted(result, units, userRegions, levels) {
    // The made key standing for each user region, and each made key's parent, by depth
    const standing = [new Map(), new Map(), new Map()];
    result.realms.forEach((realm, index) => realm.user !== undefined && standing[0].set(realm.user, index));
    result.duchies.forEach((duchy, index) => duchy.user !== undefined && standing[1].set(duchy.user, index));
    units.counties.forEach((index, key) => result.counties[index].user !== undefined && standing[2].set(result.counties[index].user, key));
    const parents = [null, units.duchyParent, units.countyParent];
    const deepest = Math.min(levels.length, userRegions.length);
    for (let cell = 0; cell < levels[0].length; cell++) {
        for (let depth = deepest - 1; depth >= 0; depth--) {
            const owner = userRegions[depth].owners[cell];
            const made = userRegions[depth].keys.has(owner) ? standing[depth].get(owner) : undefined;
            if (made === undefined) continue;
            // This region and the regions the run put above it
            let key = made;
            for (let up = depth; up >= 0 && key !== undefined && key !== UNCLAIMED; up--) {
                levels[up][cell] = key;
                key = up > 0 ? parents[up][key] : undefined;
            }
            break;
        }
    }
}

/** The owners of the level above: each cell's region's parent (UNCLAIMED stays so). */
function upward(owners, parentOfKey) {
    const out = new Int32Array(owners.length).fill(UNCLAIMED);
    for (let cell = 0; cell < owners.length; cell++) if (owners[cell] !== UNCLAIMED) out[cell] = parentOfKey[owners[cell]] ?? UNCLAIMED;
    return out;
}

// ------------------------------------------------------------------ colours

/**
 * Realm fill colours: realms largest first take the preset least used so far among those no
 * realm within COLOUR_RINGS model steps already has, so neighbours (and realms parted by a thin
 * strip of wilds) always differ.
 */
function colourRealms(level, result) {
    const presets = FILRODENSWMB.REGIONS.PRESETS;
    const near = realmNeighbours(result);
    const order = result.realms.map((_, index) => index).sort((a, b) => result.realms[b].population - result.realms[a].population || a - b);
    const used = new Map(presets.map((colour) => [colour, 0]));
    const colourOf = new Map();
    for (const realm of order) {
        const taken = new Set([...(near.get(realm) ?? [])].map((other) => colourOf.get(other)).filter(Boolean));
        const free = presets.filter((colour) => !taken.has(colour));
        const choice = (free.length ? free : presets).reduce((best, colour) => (used.get(colour) < used.get(best) ? colour : best));
        colourOf.set(realm, choice);
        used.set(choice, used.get(choice) + 1);
    }
    for (const region of level.regions) region.fillColor = colourOf.get(region.generated.sourceId) ?? null;
}

/** Each realm's neighbours within COLOUR_RINGS model cell steps, over land and water. */
function realmNeighbours(result) {
    const realm = result.modelCells.realm;
    const { neighbourStart, neighbourList } = result.modelGraph;
    const rings = FILRODENSWMB.GENERATOR.MATERIALISE.COLOUR_RINGS;
    const near = new Map();
    const link = (a, b) => {
        if (a < 0 || b < 0 || a === b) return;
        if (!near.has(a)) near.set(a, new Set());
        near.get(a).add(b);
    };
    for (let cell = 0; cell < realm.length; cell++) {
        if (realm[cell] < 0) continue;
        let frontier = [cell];
        const seen = new Set(frontier);
        for (let step = 0; step < rings; step++) {
            const next = [];
            for (const at of frontier) {
                for (let slot = neighbourStart[at]; slot < neighbourStart[at + 1]; slot++) {
                    const other = neighbourList[slot];
                    if (seen.has(other)) continue;
                    seen.add(other);
                    next.push(other);
                    link(realm[cell], realm[other]);
                }
            }
            frontier = next;
        }
    }
    return near;
}
