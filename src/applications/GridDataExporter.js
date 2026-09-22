import { FILRODENSWMB } from "../config.js";
import { GridAggregator, VoteTally } from "../generation/GridAggregator.js";
import { ProceduralEngine } from "../generation/ProceduralEngine.js";
import { MapStateManager } from "./MapStateManager.js";

/**
 * Builds the per-grid-cell exploration data layer written to
 * `scene.flags["filrodens-world-map-builder"].gridData` at export time (see
 * `design/GRID-DATA-SCHEMA.md` for the full field reference this class implements).
 *
 * The payload gives every cell of the Scene's configured grid a dominant biome, terrain band,
 * moisture band, temperature band, river/coastal flags, and which regions, points of interest,
 * routes and named custom rivers overlap it - a structured summary a third-party system can read
 * straight from the Scene document to decide what happens when a token explores into a cell,
 * without needing to understand FWMB's own raster buffers or generation pipeline at all.
 *
 * This runs once, at export time, over the map's current generated state. It is not maintained
 * live during editing and is not part of the Studio's regular render pipeline.
 */
export class GridDataExporter {
    /** `uiState.gridType` value for a gridless map - see `build()`. */
    static #GRIDLESS_TYPE = "none";

    /**
     * @param {MapStudioApp} app - the live Studio application, read for its generated buffers
     * (`currentElevationData` etc.), vector entities (`regionLayers`, `mapPins`, `mapRoutes`,
     * `manualRivers`) and `uiState`.
     * @returns {object|null} The full `gridData` payload, or `null` for a gridless map - there is
     * no cell geometry to aggregate into, so the feature does not run.
     */
    static build(app) {
        if (app.uiState.gridType === GridDataExporter.#GRIDLESS_TYPE) return null;

        const grid = GridDataExporter.#buildGrid(app.uiState);
        const [i0, j0, i1, j1] = grid.getOffsetRange({ x: 0, y: 0, width: app.mapWidth, height: app.mapHeight });

        const { params } = MapStateManager.getDerivedMapParameters(app.uiState, app.customBiomeColors);
        const biomeIdToKey = GridDataExporter.#buildBiomeIdToKeyMap();
        const visibleRegions = GridDataExporter.#collectVisibleRegions(app.regionLayers);
        const visiblePins = (app.mapPins || []).filter((pin) => pin.visibility !== "none" && pin.icon);
        const visibleRoutes = (app.mapRoutes || []).filter((route) => route.visibility !== "none" && route.points?.length >= 2);
        const namedRivers = (app.manualRivers || []).filter((river) => river.points?.length >= 2);
        const rasterBounds = { minX: 0, minY: 0, maxX: app.mapWidth - 1, maxY: app.mapHeight - 1 };

        const cells = {};
        // `getOffsetRange` returns its end offsets exclusive (matching the same convention as the
        // width/height it was given), so the loops below stop short of i1/j1 - confirm this against
        // a live Foundry instance during manual verification (see the grid-data implementation plan's
        // own verification section) since it cannot be checked from this module in isolation.
        for (let i = i0; i < i1; i++) {
            for (let j = j0; j < j1; j++) {
                const polygon = grid.getVertices({ i, j });
                const cellBounds = GridAggregator.getPolygonPixelBounds(polygon);
                // A hex grid's row/column offsets don't line up neatly with a rectangular raster,
                // so some offsets in range can fall entirely outside the map image. Skip those
                // rather than emitting a cell with no real data behind it.
                if (!GridAggregator.boundsOverlap(cellBounds, rasterBounds)) continue;

                cells[`${i},${j}`] = GridDataExporter.#buildCell(app, params, polygon, cellBounds, biomeIdToKey, visibleRegions, visiblePins, visibleRoutes, namedRivers);
            }
        }

        const gridType = FILRODENSWMB.GRID_TYPES[app.uiState.gridType];
        return {
            schemaVersion: FILRODENSWMB.GRID_DATA.SCHEMA_VERSION,
            generatedAt: new Date().toISOString(),
            grid: { type: gridType.value, typeName: gridType.name, size: app.uiState.gridSize },
            bounds: { iMin: i0, iMax: i1 - 1, jMin: j0, jMax: j1 - 1 },
            cells,
        };
    }

    /**
     * Constructs a standalone Grid instance from the map's own grid settings, independent of any
     * live Scene document - the export needs the grid's cell geometry, not a placed canvas.
     */
    static #buildGrid(uiState) {
        if (uiState.gridType === "square") {
            return new foundry.grid.SquareGrid({ size: uiState.gridSize });
        }

        // FWMB only ever exports the odd-offset hex variants (HEXODDR for hexR, HEXODDQ for hexC -
        // see FILRODENSWMB.GRID_TYPES), so `even` is always false here. `columns` selects the
        // orientation: true for flat-top/column-offset hexes (hexC), false for pointy-top/
        // row-offset hexes (hexR).
        return new foundry.grid.HexagonalGrid({ size: uiState.gridSize, columns: uiState.gridType === "hexC", even: false });
    }

    /** Reverse lookup from a built-in biome's numeric id (FILRODENSWMB.BIOME_IDS) back to its string key. */
    static #buildBiomeIdToKeyMap() {
        const map = new Map();
        for (const [key, id] of Object.entries(FILRODENSWMB.BIOME_IDS)) {
            map.set(id, key);
        }
        return map;
    }

    /**
     * Flattens every region across every layer into a single list, pre-computing what stays
     * constant per region for the rest of the export (its bounding box, and its *effective*
     * visibility) so the per-cell pass below doesn't repeat that work for every cell.
     */
    static #collectVisibleRegions(regionLayers) {
        const visible = [];
        for (const layer of regionLayers || []) {
            if (layer.visibility === "none") continue;

            for (const region of layer.regions || []) {
                if (!region.points || region.points.length < FILRODENSWMB.LIMITS.MIN_POLYGON_VERTICES) continue;

                const regionVisibility = region.visibility || "all";
                if (regionVisibility === "none") continue;

                visible.push({
                    id: region.id,
                    name: region.name,
                    // A region under a GM-only layer is never shown to players even if the region
                    // itself is marked "all" - matching the same elevation rule StudioCanvas
                    // already applies when rendering regions on-canvas (see its region visibility
                    // pass), so the exported flag agrees with what a GM actually sees toggled.
                    visibility: layer.visibility === "gm" ? "gm" : regionVisibility,
                    layer: { id: layer.id, name: layer.name },
                    polygon: region.points,
                    bounds: GridAggregator.getPolygonPixelBounds(region.points),
                });
            }
        }
        return visible;
    }

    /** Builds every field for a single grid cell, sampling the map's raster buffers across the cell's polygon. */
    static #buildCell(app, params, polygon, cellBounds, biomeIdToKey, visibleRegions, visiblePins, visibleRoutes, namedRivers) {
        const rasterWidth = app.mapWidth;
        const rasterHeight = app.mapHeight;
        const tallies = GridDataExporter.#createTallies();
        const candidateRegions = visibleRegions.filter((region) => GridAggregator.boundsOverlap(cellBounds, region.bounds));
        const regionInsideCounts = candidateRegions.map(() => 0);

        let sampleStats = GridDataExporter.#samplePolygon(app, params, polygon, cellBounds, rasterWidth, rasterHeight, tallies, candidateRegions, regionInsideCounts);
        if (sampleStats.sampleCount === 0) {
            // A polygon this thin can only happen at a hex grid's map-edge cells, where the cell's
            // true shape is clipped by the raster bounds tightly enough that no pixel *centre*
            // (the point every other cell is sampled at) happens to fall inside it. The cell still
            // needs every field populated - the schema guarantees complete coverage, never a
            // sparse or missing cell - so fall back to a single sample at the cell's own centre.
            sampleStats = GridDataExporter.#sampleFallbackCenter(app, params, polygon, rasterWidth, rasterHeight, tallies, candidateRegions, regionInsideCounts);
        }

        return {
            biome: GridDataExporter.#resolveBiomeInfo(tallies.biome.winner.value, biomeIdToKey, app.uiState.customBiomes),
            terrainBand: tallies.terrain.winner.value,
            moistureBand: tallies.moisture.winner.value,
            temperatureBand: tallies.temperature.winner.value,
            hasRiver: sampleStats.hasRiver,
            rivers: GridDataExporter.#collectRiversInCell(polygon, cellBounds, namedRivers),
            isCoastal: sampleStats.hasOceanSample && sampleStats.hasLandSample,
            regions: GridDataExporter.#finalizeRegions(candidateRegions, regionInsideCounts, sampleStats.sampleCount),
            infrastructure: {
                pins: GridDataExporter.#collectPinsInCell(polygon, visiblePins),
                routes: GridDataExporter.#collectRoutesInCell(polygon, cellBounds, visibleRoutes),
            },
        };
    }

    static #createTallies() {
        return {
            biome: new VoteTally(),
            terrain: new VoteTally(),
            moisture: new VoteTally(),
            temperature: new VoteTally(),
        };
    }

    /** Walks every pixel centre inside `polygon` (clipped to the raster) and tallies it. */
    static #samplePolygon(app, params, polygon, bounds, rasterWidth, rasterHeight, tallies, candidateRegions, regionInsideCounts) {
        const minX = Math.max(0, bounds.minX);
        const minY = Math.max(0, bounds.minY);
        const maxX = Math.min(rasterWidth - 1, bounds.maxX);
        const maxY = Math.min(rasterHeight - 1, bounds.maxY);

        const stats = { sampleCount: 0, hasRiver: false, hasOceanSample: false, hasLandSample: false };

        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                const px = x + 0.5;
                const py = y + 0.5;
                if (!GridAggregator.pointInPolygon(px, py, polygon)) continue;

                GridDataExporter.#accumulatePixel(app, params, x, y, px, py, rasterWidth, tallies, candidateRegions, regionInsideCounts, stats);
            }
        }
        return stats;
    }

    /** Single-pixel fallback for a cell whose polygon sampled nothing (see #buildCell). */
    static #sampleFallbackCenter(app, params, polygon, rasterWidth, rasterHeight, tallies, candidateRegions, regionInsideCounts) {
        const center = GridDataExporter.#getClampedPolygonCenter(polygon, rasterWidth, rasterHeight);
        const stats = { sampleCount: 0, hasRiver: false, hasOceanSample: false, hasLandSample: false };
        GridDataExporter.#accumulatePixel(app, params, center.x, center.y, center.x + 0.5, center.y + 0.5, rasterWidth, tallies, candidateRegions, regionInsideCounts, stats);
        return stats;
    }

    /**
     * Resolves one source pixel's biome, terrain band, moisture band and temperature band, tallies
     * each, and checks it against every region candidate for the cell it belongs to - one pass
     * over the pixel does all of this together rather than a separate scan per field.
     */
    static #accumulatePixel(app, params, x, y, px, py, rasterWidth, tallies, candidateRegions, regionInsideCounts, stats) {
        const pixelIndex = y * rasterWidth + x;
        const elevation = app.currentElevationData[pixelIndex];
        const moisture = app.currentMoistureData[pixelIndex];
        const temperature = app.currentTemperatureData[pixelIndex];
        const overrideId = app.currentBiomeOverrides[pixelIndex];

        // Reuses the exact same priority chain (paint override -> custom rule match -> built-in
        // default) that already resolves the biome for the live biome layer and the on-canvas
        // hover readout, so the exported biome can never disagree with what's visibly on the map.
        // Its own `isWater` flag isn't used here - it also covers lakes (via the water mask), but
        // `isCoastal` below is specifically about the ocean shoreline (see the schema doc), which
        // the terrain band below already answers precisely.
        const { lookupKey } = ProceduralEngine.resolveBiomeLookup(
            overrideId,
            elevation,
            moisture,
            temperature,
            params.seaLevel,
            app.bufferWaterMask,
            pixelIndex,
            params.customBiomeRules,
            params.biomePalette,
            params.solidOverWater
        );
        const terrainBand = GridDataExporter.#classifyTerrainBand(elevation, params.seaLevel);
        const isOceanPixel = terrainBand === "deepOcean" || terrainBand === "shallowOcean";

        tallies.biome.add(lookupKey);
        tallies.terrain.add(terrainBand);
        tallies.moisture.add(GridDataExporter.#classifyMoistureBand(moisture));
        tallies.temperature.add(GridDataExporter.#classifyTemperatureBand(temperature));

        for (let r = 0; r < candidateRegions.length; r++) {
            if (GridAggregator.pointInPolygon(px, py, candidateRegions[r].polygon)) regionInsideCounts[r]++;
        }

        stats.sampleCount++;
        if (isOceanPixel) stats.hasOceanSample = true;
        else stats.hasLandSample = true;
        if (app.bufferRiverMap?.[pixelIndex]) stats.hasRiver = true;
    }

    /** Integer pixel coordinates of a polygon's vertex average, clamped onto the raster. */
    static #getClampedPolygonCenter(polygon, rasterWidth, rasterHeight) {
        let sumX = 0,
            sumY = 0;
        for (const point of polygon) {
            sumX += point.x;
            sumY += point.y;
        }
        const x = Math.min(rasterWidth - 1, Math.max(0, Math.floor(sumX / polygon.length)));
        const y = Math.min(rasterHeight - 1, Math.max(0, Math.floor(sumY / polygon.length)));
        return { x, y };
    }

    /**
     * Converts each candidate region's raw inside/total pixel count into its `coverage` fraction,
     * drops any region that didn't actually overlap the cell's sampled pixels, and sorts the
     * result by coverage descending so the first entry is always the cell's dominant region.
     */
    static #finalizeRegions(candidateRegions, regionInsideCounts, sampleCount) {
        return candidateRegions
            .map((region, index) => ({ region, coverage: regionInsideCounts[index] / sampleCount }))
            .filter(({ coverage }) => coverage > 0)
            .sort((a, b) => b.coverage - a.coverage)
            .map(({ region, coverage }) => ({
                id: region.id,
                name: region.name,
                layer: region.layer,
                visibility: region.visibility,
                coverage: Math.round(coverage * 1000) / 1000,
            }));
    }

    static #collectPinsInCell(polygon, visiblePins) {
        const pins = [];
        for (const pin of visiblePins) {
            if (!GridAggregator.pointInPolygon(pin.x, pin.y, polygon)) continue;
            pins.push({ id: pin.id, name: pin.name, icon: pin.icon, visibility: pin.visibility });
        }
        return pins;
    }

    static #collectRoutesInCell(cellPolygon, cellBounds, visibleRoutes) {
        const routes = [];
        for (const route of visibleRoutes) {
            if (!GridDataExporter.#linestringCrossesCell(route.points, cellPolygon, cellBounds)) continue;
            routes.push({ id: route.id, name: route.name, visibility: route.visibility });
        }
        return routes;
    }

    /**
     * Named custom (hand-drawn) rivers passing through this cell - not procedural rivers, which
     * are traced automatically from spring pins at generation time and never get a name of their
     * own, only rasterised into `bufferRiverMap` alongside everything else `hasRiver` reports.
     * `hasRiver` can be true here with `rivers` empty (a procedural river, or a lake overflow
     * channel, with no custom river drawn through this particular cell); the reverse - a custom
     * river listed here while `hasRiver` is false - shouldn't normally happen (drawing a custom
     * river always carves its path into the terrain), but the two are computed independently (a
     * raster sample vs. this vector intersection test) rather than one being derived from the
     * other, so it isn't treated as a hard invariant.
     */
    static #collectRiversInCell(cellPolygon, cellBounds, namedRivers) {
        const rivers = [];
        for (const river of namedRivers) {
            if (!GridDataExporter.#linestringCrossesCell(river.points, cellPolygon, cellBounds)) continue;
            rivers.push({ id: river.id, name: river.name });
        }
        return rivers;
    }

    /** True if any segment of a poly-line (a route or a custom river) crosses, touches, or lies inside the cell's polygon. */
    static #linestringCrossesCell(points, cellPolygon, cellBounds) {
        for (let i = 1; i < points.length; i++) {
            const p1 = points[i - 1];
            const p2 = points[i];
            const segmentBounds = {
                minX: Math.min(p1.x, p2.x),
                maxX: Math.max(p1.x, p2.x),
                minY: Math.min(p1.y, p2.y),
                maxY: Math.max(p1.y, p2.y),
            };
            if (!GridAggregator.boundsOverlap(cellBounds, segmentBounds)) continue;
            if (GridAggregator.segmentIntersectsPolygon(p1, p2, cellPolygon)) return true;
        }
        return false;
    }

    /**
     * Classifies elevation into a terrain band relative to sea level. Ocean cells are split by the
     * exact same depth formula `ProceduralEngine`'s own `#getOceanBiome` uses (deep below 50% of
     * the way from sea level to the map's lowest point convention, shallow above), so a cell's
     * terrain band ocean/land boundary and deep/shallow split always agree with what the biome
     * layer actually renders for the same pixel - this is why the ocean split doesn't need to
     * inspect the resolved biome at all. Land bands have a lower threshold only, open-ended at the
     * top, since hand-edited terrain can push elevation arbitrarily far past 1.0.
     */
    static #classifyTerrainBand(elevation, seaLevel) {
        if (elevation < seaLevel) {
            const depth = seaLevel > 0 ? (seaLevel - elevation) / seaLevel : 0;
            return depth > 0.5 ? "deepOcean" : "shallowOcean";
        }

        const offsets = FILRODENSWMB.GRID_DATA.TERRAIN_BAND_OFFSETS;
        const heightAboveSeaLevel = elevation - seaLevel;
        if (heightAboveSeaLevel >= offsets.MOUNTAIN) return "mountain";
        if (heightAboveSeaLevel >= offsets.HIGHLAND) return "highland";
        if (heightAboveSeaLevel >= offsets.UPLAND) return "upland";
        return "lowland";
    }

    static #classifyMoistureBand(moisture) {
        const cutoffs = FILRODENSWMB.GRID_DATA.MOISTURE_CUTOFFS;
        if (moisture < cutoffs.DRY) return "dry";
        if (moisture < cutoffs.WET) return "moderate";
        return "wet";
    }

    static #classifyTemperatureBand(temperature) {
        const cutoffs = FILRODENSWMB.GRID_DATA.TEMPERATURE_CUTOFFS;
        if (temperature < cutoffs.FRIGID) return "frigid";
        if (temperature < cutoffs.COLD) return "cold";
        if (temperature < cutoffs.TEMPERATE) return "temperate";
        if (temperature < cutoffs.WARM) return "warm";
        return "scorching";
    }

    /**
     * Normalises a winning `resolveBiomeLookup` key - a built-in biome's string key, a built-in
     * biome's numeric id (from a hand-painted override), or a custom biome's numeric id - into the
     * schema's uniform `{id, name, code}` shape. `id` is always written out as a string (per
     * design/GRID-DATA-SCHEMA.md's id-format note), even though a custom biome's real internal id
     * is numeric, so a consumer never has to branch on whether `biome.id` happens to be a number
     * or a string depending on which kind of biome a cell resolved to. Only ever called once per
     * cell, on the vote's winning value, not once per sampled pixel.
     */
    static #resolveBiomeInfo(lookupKey, biomeIdToKey, customBiomes) {
        if (lookupKey === null || lookupKey === undefined) {
            // Unreachable in practice - #buildCell's fallback centre sample always yields a real
            // lookupKey - but kept as a defined result rather than left to throw, in case a future
            // change to the sampling path ever leaves a cell with no votes at all.
            return { id: null, name: "", code: null };
        }

        if (typeof lookupKey === "string") {
            return { id: lookupKey, name: game.i18n.localize(`FILRODENSWMB.BIOMES.${lookupKey}`), code: null };
        }

        // Built-in and custom biome ids never collide: built-in ids run 0-13 (FILRODENSWMB.BIOME_IDS)
        // and custom ids are always issued starting at FILRODENSWMB.LIMITS.CUSTOM_BIOME_START_ID (14).
        if (lookupKey < FILRODENSWMB.LIMITS.CUSTOM_BIOME_START_ID) {
            const builtInKey = biomeIdToKey.get(lookupKey) ?? null;
            return {
                id: builtInKey ?? String(lookupKey),
                name: builtInKey ? game.i18n.localize(`FILRODENSWMB.BIOMES.${builtInKey}`) : "",
                code: null,
            };
        }

        const customBiome = (customBiomes || []).find((biome) => biome.id === lookupKey);
        return { id: String(lookupKey), name: customBiome?.name ?? "", code: customBiome?.code ?? null };
    }
}
