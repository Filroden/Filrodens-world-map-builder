import { FILRODENSWMB } from "../config.js";
import { OwnerLayer } from "../mesh/OwnerLayer.js";
import { claimWaters } from "../mesh/RegionEdits.js";
import { UNCLAIMED, addRegion, childLevelFields, createLayerSet, createLevel } from "../mesh/Schema.js";
import { floodOwners, relaxBorders } from "../mesh/Territory.js";

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
 * as borders only (the atlas convention for child levels).
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
 *     made from them), and whether the realms' names are shown.
 * @returns {{set: object, owners: Object<string, Int32Array>}}
 */
export function buildPolitical(session, result, { runId, idFactory, names, watersPx, regionLabel = () => ({}), output = {} }) {
    const units = politicalUnits(result);
    const set = createLayerSet({ name: names.set, kind: "political", visibility: "all", waterTint: true, opacity: 1 }, idFactory);
    const levels = [
        createLevel({ name: names.levels[0], titleTemplate: names.titles.kingdom, watersPx }, idFactory),
    ];
    const withDuchies = output.duchies !== false;
    const withCounties = withDuchies && output.counties !== false;
    if (withDuchies) levels.push(createLevel({ name: names.levels[1], titleTemplate: names.titles.duchy, ...childLevelFields(levels[0].id) }, idFactory));
    if (withCounties) levels.push(createLevel({ name: names.levels[2], titleTemplate: names.titles.county, ...childLevelFields(levels[1].id) }, idFactory));
    set.levels.push(...levels);

    const realmVisibility = output.labels === false ? "none" : "all";
    addRealms(levels[0], result, { runId, idFactory, label: { ...regionLabel("realm"), visibility: realmVisibility }, duchyLabel: { ...regionLabel("duchy"), visibility: realmVisibility } });
    if (withDuchies) addChildren(levels[1], units.duchies, units.duchyParent, { kind: "duchy", units: result.duchies }, { runId, idFactory, label: regionLabel("duchy") });
    if (withCounties) addChildren(levels[2], units.counties, units.countyParent, { kind: "county", units: result.counties }, { runId, idFactory, label: regionLabel("county") });

    const counties = carry(session, result, "county", units.countyKey);
    joinCoast(session, result, counties);
    relaxBorders(session.mesh, counties, session.aggregates, {}, { anchors: units.counties.map((index) => result.counties[index].seat) });
    const duchies = upward(counties.owners, units.countyParent);
    const realms = upward(duchies, units.duchyParent);
    const owners = Object.fromEntries([realms, duchies, counties.owners].slice(0, levels.length).map((array, depth) => [levels[depth].id, array]));
    colourRealms(levels[0], result);
    return { set, owners };
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

function addRealms(level, result, { runId, idFactory, label, duchyLabel }) {
    result.realms.forEach((realm, index) => {
        addRegion(level, {
            name: realm.name,
            // Each region its own label (a moved label keeps its own position); an independent
            // duchy's in the duchies' look, so a realm's look marks a kingdom
            label: { ...(realm.kind === "kingdom" ? label : duchyLabel) },
            generated: generatedFor(runId, "realm", index, { tier: realm.kind, population: realm.population, culture: realm.cultures?.[0]?.[0] ?? null }),
        }, idFactory);
    });
}

/**
 * A child level's regions: one per unit in `list` (indices into `units`), keyed in list order,
 * each with the key of its parent region and a hidden label in the level's look.
 */
function addChildren(level, list, parentKeys, { kind, units }, { runId, idFactory, label }) {
    list.forEach((sourceIndex, key) => {
        const unit = units[sourceIndex];
        addRegion(level, {
            name: unit.name,
            parentKey: parentKeys[key],
            label: { ...label, visibility: "none" },
            generated: generatedFor(runId, kind, sourceIndex, { population: unit.population }),
        }, idFactory);
    });
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

/** Gives the land display cells the model called sea (its coast is coarser) to the nearest region overland. */
function joinCoast(session, result, layer) {
    const { mesh, aggregates } = session;
    const owners = layer.owners;
    const modelWater = result.modelCells.water;
    const isSliver = (cell) => aggregates.land[cell] === 1 && owners[cell] === UNCLAIMED && modelWater[mesh.parentOf[cell]] === 1;
    fillFrom(session, layer, isSliver);
}

/** Floods owners from the owned land into the cells `open` accepts. */
function fillFrom(session, layer, open) {
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
    const flood = floodOwners(mesh, cells, values, { passable: open, cost: (a, b) => mesh.distance(a, b) });
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
