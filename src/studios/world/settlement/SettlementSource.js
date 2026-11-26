/**
 * The parent reader (`claude/v5-l-surface-handoff.md` §2): what a Surface map holds, as plain data,
 * for the settlement maps made from its pins. The World studio reads its own data here; the Local
 * studio turns a source into a settlement's engine input (its LocalInput.inputFrom), so neither
 * studio imports the other: the source is handed over through the studios' registrations.
 *
 * A source holds the map's terrain and climate per pixel, its display cells and the two levels of
 * cells settlements are read at (the model cells and the in-fill cells), its rivers and routes, its
 * settlements, its run's cells and the world's cultures (see LocalInput for the shape). Rasters are
 * the map's own arrays, not copies: the source is read on the main thread, and only the input made
 * from it goes on to a worker.
 *
 * - **Settlements:** every pin a run made a town or castle of, and every hand-placed pin on a
 *   settlement style; a pin's tier and roles come from its style (a generated pin's tier where its
 *   style has none), its population from its entered figure before the run's (UserFigures).
 * - **The run:** the map's own run on its model cells, or a regional world's copy of its parent's
 *   (RunCells), each cell's people, capacity, land, water, security, main culture (as the world
 *   culture's id) and the trade among them, as every run since v4.0.0 keeps them. A map with no
 *   run has none, and its settlements are given a stand-in supply.
 *
 * Nothing here touches Foundry globals or the DOM, so it can be exercised directly from Node.
 */
import { FILRODENSWMB } from "../../../config.js";
import { MapStateManager } from "../app/MapStateManager.js";
import { RunCells } from "../app/RunCells.js";
import { UserFigures } from "../app/UserFigures.js";
import { ProceduralEngine } from "../generation/ProceduralEngine.js";
import { decodeModelRun } from "../generator/ModelRun.js";
import { parentRunSites } from "../generator/ParentRun.js";
import { travelGrid } from "../travel/TravelGrid.js";

/** Pin style tiers that are settlements a settlement map can be made of. */
const SETTLEMENT_TIERS = new Set(["capital", "city", "largeTown", "town", "marketTown", "largeVillage", "village", "fortifiedTown", "port", "castle"]);

/** Built-in biomes by their id, for the biome a pixel shows. */
const BIOME_KEYS = new Map(Object.entries(FILRODENSWMB.BIOME_IDS).map(([key, value]) => [value, key]));

export class SettlementSource {
    /**
     * The map's settlement source, worked out now. The caller keeps it while the map is unchanged
     * (the Local studio keeps what its settlements share with it).
     * @param {object} app - The World studio's controller (MapStudio) or a stand-in with its fields.
     * @returns {object|null} null while the map has no mesh.
     */
    static of(app) {
        const mesh = app.meshSession?.mesh;
        if (!mesh) return null;
        const map = {
            width: app.mapWidth,
            height: app.mapHeight,
            kmPerPx: mesh.kmPerPx,
            seaLevel: app.uiState.seaLevel,
            metresPerUnit: FILRODENSWMB.MESH.METRES_PER_UNIT,
            elevation: app.currentElevationData,
            waterMask: app.bufferWaterMask,
            moisture: app.currentMoistureData,
            temperature: app.currentTemperatureData,
            displayRaster: mesh.cellRaster,
            displaySites: mesh.sites,
            rivers: riverRecord(app.currentRiverData),
            routes: (app.mapRoutes ?? []).map(routeOf),
        };
        const styles = new Map((app.uiState.customPinStyles ?? []).map((style) => [style.id, style]));
        const places = [];
        for (const pin of app.mapPins ?? []) {
            const place = placeOf(pin, styles, app.meshSession);
            if (place) places.push(place);
        }
        return {
            mapSeed: app.uiState.mapSeed,
            map,
            levels: { model: modelLevel(mesh), infill: infillLevel(mesh) },
            places,
            run: runOf(app, mesh),
            cultures: (app.uiState.cultures ?? []).map((c) => ({ id: c.id, name: c.name, colour: c.color, openness: c.openness ?? 0.5, nameBase: c.nameBase, names: c.names ?? null, heads: c.households?.heads ?? null })),
            nameBase: app.uiState.generatorSettings?.nameBase ?? "English",
        };
    }

    /**
     * Whether a pin is a settlement a settlement map can be made of: one the source reads as a
     * settlement (its style's tier, or a run's town), with people of its own.
     * @param {object} app
     * @param {object} pin
     * @returns {boolean}
     */
    static isSettlement(app, pin) {
        const styles = new Map((app.uiState?.customPinStyles ?? []).map((style) => [style.id, style]));
        const tier = styles.get(pin?.pinStyle)?.tier ?? pin?.generated?.tier ?? null;
        // A castle's or a ruin's has no people of its own, so no settlement map (Ken, board L1)
        return !!pin && !!placeOf(pin, styles, { cellAt: () => 0 }) && UserFigures.takes(tier);
    }

    /**
     * A settlement pin as the Local studio asks for it: its id and the built-in biome the map shows
     * at it (a painted biome, a custom rule's, or the climate's; a custom biome as the built-in one
     * it behaves like). Null for a pin that is not one of the source's settlements.
     * @param {object} app
     * @param {string} pinId
     */
    static pin(app, pinId) {
        const pin = (app.mapPins ?? []).find((p) => p.id === pinId);
        if (!pin) return null;
        return { id: pin.id, biome: biomeAt(app, pin.x, pin.y) };
    }
}

/** A pin as a settlement, or null for one that is not a settlement. */
function placeOf(pin, styles, session) {
    if (!Number.isFinite(pin.x) || !Number.isFinite(pin.y)) return null;
    const generated = pin.generated ?? null;
    const tier = styles.get(pin.pinStyle)?.tier ?? generated?.tier ?? null;
    const settlement = generated ? generated.kind === "town" || generated.kind === "castle" : SETTLEMENT_TIERS.has(tier);
    if (!settlement) return null;
    const culture = generated?.culture ?? pin.culture ?? null;
    return {
        id: pin.id,
        name: pin.name ?? "",
        x: pin.x,
        y: pin.y,
        cell: pin.cell ?? session.cellAt(pin.x, pin.y),
        kind: generated?.kind ?? "hand",
        tier,
        population: UserFigures.takes(tier) ? UserFigures.shown(pin) : null,
        infill: !!generated?.infill,
        mix: generated?.mix ?? (culture ? [{ culture, share: 1 }] : []),
    };
}

/** A route as its transport, class and display cells in order (its legs joined). */
function routeOf(route) {
    let cells = route.waypoints ?? [];
    if (route.legs?.length) {
        cells = [];
        for (const leg of route.legs) for (const cell of leg) if (cells[cells.length - 1] !== cell) cells.push(cell);
    }
    return { id: route.id, transport: route.transport ?? "road", class: route.class ?? null, cells };
}

/** The traced rivers: id, the river it joins, path as [x, y, lake] and flow per point. */
function riverRecord(riverData) {
    const flows = riverData?.network?.flows;
    return {
        pixelsPerBaseline: riverData?.network?.pixelsPerBaseline ?? 1,
        rivers: (riverData?.vectors ?? []).map((river) => ({
            id: river.id,
            mergeInto: river.mergeInto ?? null,
            path: river.path.map((point) => [point.x, point.y, point.isLake ? 1 : 0]),
            flow: flows?.get(river.id) ? Array.from(flows.get(river.id)) : null,
        })),
    };
}

/** The generator's model cells: each display cell's model cell, the model sites and their neighbours. */
function modelLevel(mesh) {
    return { of: mesh.parentOf, sites: mesh.sites.subarray(0, 2 * mesh.modelCount), ...neighbourRows(mesh.modelDelaunay, mesh.modelCount) };
}

/**
 * The in-fill cells, made as regional in-fill makes them (about INFILL.CELL_KM apart, at most
 * TRAVEL_TIME.MAX_CELLS of them); on a map whose model cells are finer, the model cells.
 */
function infillLevel(mesh) {
    const grid = travelGrid(mesh, { cellPx: FILRODENSWMB.INFILL.CELL_KM / mesh.kmPerPx, maxCells: FILRODENSWMB.TRAVEL_TIME.MAX_CELLS });
    return { of: grid.of, sites: grid.sites, ...neighbourRows(grid.delaunay, grid.count) };
}

function neighbourRows(delaunay, count) {
    const start = new Int32Array(count + 1);
    const list = [];
    for (let cell = 0; cell < count; cell++) {
        for (const next of delaunay.neighbors(cell)) list.push(next);
        start[cell + 1] = list.length;
    }
    return { neighbourStart: start, neighbourList: Int32Array.from(list) };
}

/** The run's cells, or null with no run. */
function runOf(app, mesh) {
    const found = RunCells.of(app);
    if (!found) return null;
    const { run, inherited } = found;
    const arrays = decodeModelRun(run);
    if (!arrays.population) return null;
    let sites;
    if (inherited) {
        const s = parentRunSites(run);
        if (s.x) {
            sites = new Float64Array(s.x.length * 2);
            for (let k = 0; k < s.x.length; k++) {
                sites[2 * k] = s.x[k];
                sites[2 * k + 1] = s.y[k];
            }
        } else {
            sites = Float64Array.from(s);
        }
    } else {
        sites = mesh.sites.subarray(0, 2 * mesh.modelCount);
    }
    const cultures = run.cultures ?? [];
    return {
        kmPerPx: mesh.kmPerPx,
        sites,
        people: arrays.population,
        capacity: arrays.capacity,
        landKm2: arrays.landArea,
        water: arrays.water,
        security: arrays.security ?? null,
        culture: arrays.culture ? Array.from(arrays.culture, (index) => (index >= 0 ? (cultures[index]?.id ?? null) : null)) : null,
        trade: { from: arrays.tradeFrom ?? [], to: arrays.tradeTo ?? [], kind: arrays.tradeKind ?? [] },
    };
}

/** The built-in biome a map point shows, or null where the terrain is not loaded. */
function biomeAt(app, x, y) {
    const { currentElevationData: elevation, currentMoistureData: moisture, currentTemperatureData: temperature, currentBiomeOverrides: overrides } = app;
    if (!elevation || !moisture || !temperature || !app.mapWidth) return null;
    const index = Math.floor(y) * app.mapWidth + Math.floor(x);
    if (!(index >= 0 && index < elevation.length)) return null;
    const { params } = MapStateManager.getDerivedMapParameters(app.uiState, app.customBiomeColors ?? {});
    const { visible } = ProceduralEngine.resolveBiomeLookup(overrides?.[index] ?? 0, elevation[index], moisture[index], temperature[index], params.seaLevel, app.bufferWaterMask, index, params.customBiomeRules, params.biomePalette, params.biomeSides);
    if (typeof visible === "string") return visible;
    if (BIOME_KEYS.has(visible)) return BIOME_KEYS.get(visible);
    // A custom biome (painted or a rule's), as the built-in biome it behaves like
    const custom = (app.uiState.customBiomes ?? []).find((biome) => biome.id === visible);
    return custom?.behavesLike && FILRODENSWMB.BIOME_IDS[custom.behavesLike] !== undefined ? custom.behavesLike : null;
}
