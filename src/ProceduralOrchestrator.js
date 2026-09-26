import { MapStateManager } from "./applications/MapStateManager.js";
import { ProceduralEngine } from "./generation/ProceduralEngine.js";
import { HydrologyEngine } from "./generation/HydrologyEngine.js";
import { TectonicEngine } from "./generation/TectonicEngine.js";
import { TectonicFeatureEngine } from "./generation/TectonicFeatureEngine.js";
import { SpatialMath } from "./tools/SpatialMath.js";
import { BufferDiff } from "./tools/BufferDiff.js";
import { FILRODENSWMB } from "./config.js";
import { TerrainVersion } from "./tools/TerrainVersion.js";

export class ProceduralOrchestrator {
    /**
     * Executes the topography and history phases of map generation.
     * Note: Climate generation and Canvas rendering remain handled by the App controller.
     */
    static processTopographyPhase(app) {
        const { currentSeed, params } = MapStateManager.getMapParameters(app);
        const engine = new ProceduralEngine(currentSeed);

        // A full generation is the point to try again for memory an earlier attempt could not get
        app.brushEngine?.layerCache.retryAllocation();
        app.scratchUnavailable = false;

        // 1. Route Base Topography
        this.#routeTopographyPass(app, engine, params);

        // 2. Replay History & Features
        this.rebuildFromHistory(app, engine, params, null, true);

        // 3. Reset Ephemeral Overrides
        app.currentSpringOverrides.fill(0);
    }

    /**
     * Describes everything the terrain and the layers derived from it are computed from, other
     * than the things whose effect a refresh finds by comparing results: the brush strokes,
     * faults and manual rivers (see rebuildChangedTerrain), and the pins, which only feed the
     * river pass that a refresh always reruns.
     *
     * Two descriptions are equal exactly when a generation from scratch would start from the same
     * base terrain and settings, which is what makes it safe to skip regenerating the base terrain
     * (see canSkipBaseRegeneration). It covers the engine mode, seed and map size, the sea level as
     * the sliders and the repaint read it, every derived generation parameter (climate, noise,
     * hydrology, palette and display settings), the custom biomes and their colours as they were
     * entered, and, in guided mode only, the land masks, which are the only vector shapes the base
     * terrain is built from.
     *
     * @param {object} app - The MapStudioApp instance.
     * @returns {string} A string that differs between two states exactly when their inputs differ.
     */
    static describeGenerationInputs(app) {
        const { currentSeed, params } = MapStateManager.getMapParameters(app);

        // The compiled biome rules are typed arrays built from the custom biomes, which are
        // included as entered, so they are left out rather than serialised twice
        const leaveOutCompiledRules = (key, value) => (key === "customBiomeRules" ? undefined : value);

        return JSON.stringify(
            [app.uiState.generationEngine, currentSeed, app.mapWidth, app.mapHeight, app.uiState.seaLevel, app.uiState.customBiomes, app.customBiomeColors, this.#getGuidedMaskInputs(app), params],
            leaveOutCompiledRules,
        );
    }

    /**
     * The land masks as guided mode's base terrain reads them, or nothing in any other mode,
     * where they do not affect the terrain.
     */
    static #getGuidedMaskInputs(app) {
        if (app.uiState.generationEngine !== "guided") return [];

        const minVertices = FILRODENSWMB.LIMITS.MIN_POLYGON_VERTICES;
        return (app.landMasks ?? []).filter((mask) => mask.points?.length >= minVertices).map((mask) => [mask.operation, mask.points]);
    }

    /**
     * Records that a full generation has just finished, so that a later refresh can tell whether
     * the base terrain it produced is still what the current settings would produce.
     *
     * @param {object} app - The MapStudioApp instance.
     * @param {string} inputs - The description taken when that generation started.
     */
    static rememberGenerationInputs(app, inputs) {
        app.generationInputs = inputs;
        app.generationBase = app.baseElevationData;
    }

    /**
     * Forgets the last full generation, so that nothing is skipped until the next one finishes.
     * Called when one starts, so that one that fails part-way is not mistaken for a finished one.
     */
    static forgetGenerationInputs(app) {
        app.generationInputs = null;
        app.generationBase = null;
    }

    /**
     * Whether the base terrain, and everything derived from it that is not covered by comparing
     * results, is still what a full generation with the current settings would produce, so that
     * regenerating the base terrain and the whole map can be skipped.
     *
     * This is the case after edits that only touch faults, manual rivers, land masks outside
     * guided mode and the brush strokes, which is most edits. It is not the case for anything
     * else (the seed, any slider, the map size, a loaded map), and the description also differs
     * if a generation never finished or the buffers were replaced, so any doubt means a full
     * generation.
     *
     * @param {object} app - The MapStudioApp instance.
     * @returns {boolean} True if only a refresh of what actually changed is needed.
     */
    static canSkipBaseRegeneration(app) {
        if (!app.generationInputs || !app.currentElevationData) return false;
        if (app.generationBase !== app.baseElevationData) return false;

        return app.generationInputs === this.describeGenerationInputs(app);
    }

    /**
     * Flat ground just above sea level, carrying the full surface texture if the map was created
     * with it (see getBaseRoughness).
     */
    static #generateFlatTopography(app, params) {
        const flatHeight = params.seaLevel + FILRODENSWMB.GENERATION.FLAT_HEIGHT;
        app.baseElevationData.fill(flatHeight);
        if (this.getBaseRoughness(app) === 0) return;

        const texture = this.getSurfaceTexture(app);
        if (!texture) return;

        const amplitude = ProceduralEngine.getSurfaceTextureAmplitude();
        for (let i = 0; i < texture.length; i++) app.baseElevationData[i] = flatHeight + amplitude * texture[i];
    }

    /**
     * How much surface texture the open map's base terrain carries, as a roughness from 0 to 255
     * (see BrushLayerCache.reset): all of it on a Flat map created with textured ground, none on
     * any other map, whose own detail is its texture.
     *
     * @param {object} app - The MapStudioApp instance.
     * @returns {number}
     */
    static getBaseRoughness(app) {
        const textured = app.uiState.generationEngine === "flat" && app.uiState.flatTexture === true;
        return textured ? FILRODENSWMB.GENERATION.SURFACE_TEXTURE.FULL_ROUGHNESS : 0;
    }

    /**
     * The open map's surface texture (see ProceduralEngine.generateSurfaceTexture), holding at
     * least the pixels in `bounds`.
     *
     * The texture is worked out in tiles (SURFACE_TEXTURE.TILE_SIZE), each the first time
     * something asks for part of it, and kept until something it depends on changes: the seed,
     * the map's size, or its place in the top map. A brush stamp asks only for the pixels under
     * it, so a Roughen or Level stroke works out the texture where it paints and nowhere else,
     * instead of making its first stamp wait for the whole map (several seconds on a large map).
     * Only maps that use it (textured Flat ground, or the Roughen or Level brush) ever pay for it.
     *
     * The buffer covers the whole map, but only the tiles asked for so far hold the texture;
     * callers must only read pixels inside the bounds they asked for.
     *
     * @param {object} app - The MapStudioApp instance.
     * @param {object|null} [bounds] - The pixels needed (inclusive), or null for the whole map.
     * @returns {Float32Array|null} The texture, or null if the browser had no memory for it, in
     *   which case the brushes that paint it leave the ground as it is.
     */
    static getSurfaceTexture(app, bounds = null) {
        const texture = this.#surfaceTextureFor(app);
        if (!texture) return null;

        this.#fillSurfaceTextureTiles(app, texture, ProceduralEngine.resolveBounds(bounds, app.mapWidth, app.mapHeight));
        return texture.buffer;
    }

    /**
     * Works out the texture's tiles that overlap `area` and have not been worked out yet.
     */
    static #fillSurfaceTextureTiles(app, texture, area) {
        const tileSize = FILRODENSWMB.GENERATION.SURFACE_TEXTURE.TILE_SIZE;
        const params = { terrain: { world: texture.world } };

        for (let tileY = Math.floor(area.minY / tileSize); tileY <= Math.floor(area.maxY / tileSize); tileY++) {
            for (let tileX = Math.floor(area.minX / tileSize); tileX <= Math.floor(area.maxX / tileSize); tileX++) {
                const tile = tileY * texture.tilesAcross + tileX;
                if (texture.filled[tile]) continue;

                const tileBounds = {
                    minX: tileX * tileSize,
                    minY: tileY * tileSize,
                    maxX: Math.min(app.mapWidth, (tileX + 1) * tileSize) - 1,
                    maxY: Math.min(app.mapHeight, (tileY + 1) * tileSize) - 1,
                };
                texture.engine.generateSurfaceTexture(app.mapWidth, app.mapHeight, params, texture.buffer, tileBounds);
                texture.filled[tile] = 1;
            }
        }
    }

    /**
     * The open map's texture record (`app.surfaceTexture`): its buffer, which tiles have been
     * worked out, and what it was worked out for. A new record, with no tiles worked out, is made
     * whenever something the texture depends on has changed (reusing the old buffer if the size
     * still fits, since every tile is written before it is read).
     *
     * @returns {object|null} The record, or null if the browser had no memory for it.
     */
    static #surfaceTextureFor(app) {
        const world = TerrainVersion.getTerrainParams(app.uiState).world;
        const key = [app.uiState.mapSeed, app.mapWidth, app.mapHeight, world.zoom, world.originX, world.originY, world.rootW, world.rootH].join("|");
        if (app.surfaceTexture?.key === key) return app.surfaceTexture;
        if (app.surfaceTextureUnavailable) return null;

        try {
            const tileSize = FILRODENSWMB.GENERATION.SURFACE_TEXTURE.TILE_SIZE;
            const pixels = app.mapWidth * app.mapHeight;
            const tilesAcross = Math.ceil(app.mapWidth / tileSize);
            const buffer = app.surfaceTexture?.buffer?.length === pixels ? app.surfaceTexture.buffer : new Float32Array(pixels);
            app.surfaceTexture = {
                key,
                buffer,
                world,
                tilesAcross,
                filled: new Uint8Array(tilesAcross * Math.ceil(app.mapHeight / tileSize)),
                engine: new ProceduralEngine(app.uiState.mapSeed),
            };
            return app.surfaceTexture;
        } catch (error) {
            if (!(error instanceof RangeError)) throw error;

            app.surfaceTexture = null;
            app.surfaceTextureUnavailable = true;
            console.warn(`FWMB | Not enough memory for the surface texture (${error.message}). Textured ground and the Roughen brush are unavailable until the map is reloaded.`);
            return null;
        }
    }

    /**
     * Directs the topography generation based on the active engine mode.
     */
    static #routeTopographyPass(app, engine, params) {
        const mode = app.uiState.generationEngine || "standard";

        const t0 = performance.now();

        if (mode === "flat") {
            this.#generateFlatTopography(app, params);
        } else if (mode === "advanced") {
            // Tectonic maps made under the current rules share guided terrain's pipeline; older
            // ones keep the original tectonic engine until they are updated (see TerrainVersion)
            if (TerrainVersion.usesCurrentCoastline(app.uiState)) {
                engine.generateTectonicV2Topography(app.mapWidth, app.mapHeight, params, app.baseElevationData);
            } else {
                engine.generateTectonicTopography(app.mapWidth, app.mapHeight, params, app.baseElevationData);
            }
        } else if (mode === "guided") {
            // Synchronous like every other mode. This pass is not awaited by its caller, so making
            // it async would defer the render-timer record below until after the brush history
            // replay and report that time as topography, and turn any error into an unhandled
            // rejection.
            engine.generateGuidedTopography(app.mapWidth, app.mapHeight, params, app.landMasks, app.baseElevationData);
        } else {
            engine.generateTopography(app.mapWidth, app.mapHeight, params, app.baseElevationData, [], [], null);
        }

        const t1 = performance.now();
        app.renderTimer.record("Base topography", t1 - t0, mode);
    }

    /**
     * Reconstructs currentElevationData: the brushed layer (base terrain with every raster brush
     * stroke applied) with the vector deformations on top.
     *
     * The brushed layer is kept by the brush engine and updated as strokes are finished, undone
     * and redone, so a rebuild normally just copies it and re-applies the vector features. It is
     * replayed from the base terrain, which is the slow part, only when it cannot be trusted: on a
     * full generation (the base terrain may have changed), or after something invalidated it.
     *
     * @param {object} app - The MapStudioApp instance.
     * @param {ProceduralEngine|null} engine - Engine to take the noise source from; created if omitted.
     * @param {object|null} params - Derived map parameters; derived from the UI state if omitted.
     * @param {object|null} bounds - Restricts the rebuild to a rectangle; null rebuilds the whole map.
     * @param {boolean} baseChanged - True when the base terrain was just regenerated, so the
     *   brushed layer must be replayed from it whatever state the layer is in.
     */
    static rebuildFromHistory(app, engine = null, params = null, bounds = null, baseChanged = false) {
        const activeEngine = engine ?? new ProceduralEngine(app.uiState.mapSeed);
        const activeParams = params ?? MapStateManager.getDerivedMapParameters(app.uiState, app.customBiomeColors).params;
        const activeBounds = ProceduralEngine.resolveBounds(bounds, app.mapWidth, app.mapHeight);

        // 1. Bring the brushed layer up to date, replaying the whole history only if it has to be
        const strokeCount = app.brushEngine?.history?.length ?? 0;
        let brushed = { replayed: false, cached: false };
        const refreshMs = this.#measureMs(() => {
            brushed = this.#refreshBrushedLayer(app, activeParams.seaLevel, baseChanged);
        });

        // 2-3. Reset the working terrain and biome overrides to the brushed layer. If there is no
        // layer (the browser had no memory for it) the strokes are replayed straight into the
        // working terrain, which is what a rebuild did before the layer existed.
        const mergeMs = this.#measureMs(() => this.#resetToBrushedLayer(app, activeBounds, brushed.cached));
        const directReplayMs = this.#measureMs(() => this.#replayIntoWorkingTerrain(app, activeParams.seaLevel, activeBounds, brushed.cached));
        const replayed = brushed.replayed || !brushed.cached;
        const replayMs = brushed.cached ? refreshMs : directReplayMs;

        // 4-5. Deform the brushed terrain with the vector features
        const vectorMs = this.#measureMs(() => this.#applyVectorDeformations(app, app.currentElevationData, activeEngine, activeParams, activeBounds));

        // Reported separately from the base topography time logged elsewhere, because on a map with
        // a long brush history the replay is usually the largest part of a rebuild.
        app.renderTimer.record(replayed ? "Brush history replay" : "Brush layer reused", replayMs, `${strokeCount} strokes`);
        app.renderTimer.record("Brush layer merge", mergeMs);
        app.renderTimer.record("Faults and rivers", vectorMs);
    }

    /**
     * Rebuilds the working terrain from the brushed layer like rebuildFromHistory(), but instead
     * of overwriting the whole map it works out which pixels actually ended up different and
     * reports where, so the stages that follow (climate, rivers, repaint) can be limited to that
     * area.
     *
     * The rebuilt terrain is built off to the side (the brushed layer with faults and rivers
     * carved on top) and compared with the working terrain, and only the differences are copied
     * in. Comparing, instead of assuming the change is where the last stroke was, is what makes
     * this exact: a manual river's bed follows the terrain along its whole length, so editing
     * terrain near one end can change the carved elevation far from the edit, and this finds that
     * too. It also means anything painted live onto the working terrain since the last rebuild is
     * replaced by what a full rebuild would produce, whether or not it was different.
     *
     * The comparison cannot see one thing: pixels that were painted live have already changed in
     * the working terrain, but the moisture, temperature, rivers and canvas layers derived from
     * it have not been updated yet. If the rebuild leaves such a pixel as it already was, it is
     * not reported as changed, so the caller must add the area painted live to the result.
     *
     * @param {object} app - The MapStudioApp instance.
     * @param {ProceduralEngine|null} engine - Engine to take the noise source from; created if omitted.
     * @param {object|null} params - Derived map parameters; derived from the UI state if omitted.
     * @returns {{minX: number, maxX: number, minY: number, maxY: number}|null} Box around every
     *   pixel of the working terrain or the biome overrides that changed, or null if none did.
     *   If the browser had no memory for the brushed layer or the scratch buffer, the terrain is
     *   rebuilt in place without comparing, and the box covers the whole map.
     */
    static rebuildChangedTerrain(app, engine = null, params = null) {
        const activeEngine = engine ?? new ProceduralEngine(app.uiState.mapSeed);
        const activeParams = params ?? MapStateManager.getDerivedMapParameters(app.uiState, app.customBiomeColors).params;
        const wholeMap = ProceduralEngine.resolveBounds(null, app.mapWidth, app.mapHeight);
        const layer = app.brushEngine?.layerCache;
        const strokeCount = app.brushEngine?.history?.length ?? 0;

        let brushed = { replayed: false, cached: false };
        const refreshMs = this.#measureMs(() => {
            brushed = this.#refreshBrushedLayer(app, activeParams.seaLevel, false);
        });

        // Both the layer and the scratch buffer are extra memory. If the browser cannot supply
        // either, rebuild the whole terrain in place instead, which needs none, and report the
        // whole map as changed since there is nothing to compare with.
        const rebuilt = brushed.cached ? this.#tryGetScratchBuffer(app) : null;
        if (!rebuilt) {
            this.rebuildFromHistory(app, activeEngine, activeParams, null, false);
            return wholeMap;
        }

        const replayed = brushed.replayed;
        const mergeMs = this.#measureMs(() => rebuilt.set(layer?.elevation ?? app.baseElevationData));
        const vectorMs = this.#measureMs(() => this.#applyVectorDeformations(app, rebuilt, activeEngine, activeParams, wholeMap));

        let changed = null;
        const diffMs = this.#measureMs(() => {
            const elevationChanged = BufferDiff.adoptChanges(app.currentElevationData, rebuilt, app.mapWidth, app.mapHeight);
            const overridesChanged = layer && app.currentBiomeOverrides ? BufferDiff.adoptChanges(app.currentBiomeOverrides, layer.overrides, app.mapWidth, app.mapHeight) : null;
            changed = elevationChanged && overridesChanged ? SpatialMath.mergeBounds(elevationChanged, overridesChanged) : elevationChanged || overridesChanged;

            // Roughness only matters to the brushes, not to anything drawn or derived, so it is
            // copied rather than compared
            if (layer && app.currentRoughness) app.currentRoughness.set(layer.roughness);
        });

        app.renderTimer.record(replayed ? "Brush history replay" : "Brush layer reused", refreshMs, `${strokeCount} strokes`);
        app.renderTimer.record("Brush layer merge", mergeMs);
        app.renderTimer.record("Faults and rivers", vectorMs);
        app.renderTimer.record("Change detection", diffMs);

        return changed;
    }

    /**
     * Decides what a canvas repaint has to cover, given the area the caller believes changed.
     *
     * Land is shaded relative to the map's highest point, and ocean relative to its lowest, so if
     * either has moved, every affected pixel's colour has changed and the whole map must be
     * repainted, whatever area the caller asked for. Finding both means reading every elevation,
     * which is much cheaper than the repaint it can save - tracking the lowest point alongside the
     * highest is one extra comparison per pixel in a scan this already has to do.
     *
     * The trough starts at 0 and is never raised, so on any map where nothing has carved elevation
     * below 0 it stays exactly 0 - every current write path (all three generation engines, every
     * brush tool, every tectonic fault type, and river carving) floors at 0, so this is inert until
     * hand-edited terrain is actually allowed to go negative.
     *
     * @param {Float32Array} elevationData - Current elevation of the whole map.
     * @param {number} cachedPeak - The highest elevation the canvas was last shaded against.
     * @param {number} cachedTrough - The lowest elevation the canvas was last shaded against.
     * @param {object|null} bounds - Area to repaint, or null for the whole map.
     * @returns {{bounds: (object|null), peak: number, trough: number}} The area to repaint (null
     *   meaning the whole map), and the current highest and lowest elevation, to remember for
     *   next time.
     */
    static planRepaint(elevationData, cachedPeak, cachedTrough, bounds) {
        let peak = 0;
        let trough = 0;
        for (let i = 0; i < elevationData.length; i++) {
            const elevation = elevationData[i];
            if (elevation > peak) peak = elevation;
            if (elevation < trough) trough = elevation;
        }

        const extremesChanged = peak !== cachedPeak || trough !== cachedTrough;
        return { bounds: extremesChanged ? null : bounds, peak, trough };
    }

    /**
     * Makes sure the brush engine's brushed layer equals a full replay of the stroke history,
     * replaying it from the base terrain if it does not.
     *
     * @returns {{replayed: boolean, cached: boolean}} Whether the history had to be replayed into
     *   the layer, and whether the layer can be used: it cannot if the browser had no memory for
     *   it, and the caller must then replay the history some other way. Without a brush engine
     *   there are no strokes, so there is nothing to replay and nothing to cache.
     */
    static #refreshBrushedLayer(app, seaLevel, baseChanged) {
        const brushEngine = app.brushEngine;
        if (!brushEngine) return { replayed: false, cached: true };

        const baseRoughness = this.getBaseRoughness(app);
        if (!baseChanged && brushEngine.isLayerCacheCurrent(seaLevel, baseRoughness)) return { replayed: false, cached: true };

        const cached = brushEngine.rebuildLayerCache(app.baseElevationData, seaLevel, baseRoughness);
        return { replayed: cached, cached };
    }

    /**
     * Overwrites the working elevation and biome overrides, within the bounds, with the brushed
     * layer, discarding whatever vector deformations and live brush strokes they held. Without a
     * usable layer (there are no strokes, or the browser had no memory for it) they are set to
     * the base terrain with no painted biomes, ready for the strokes to be replayed onto them
     * (see #replayIntoWorkingTerrain).
     *
     * @param {boolean} layerUsable - Whether the brush engine's layer holds the brushed terrain.
     */
    static #resetToBrushedLayer(app, bounds, layerUsable) {
        const layer = layerUsable ? app.brushEngine?.layerCache : null;
        const elevationSource = layer?.elevation ?? app.baseElevationData;

        this.#forEachBoundsRow(bounds, app.mapWidth, (start, end) => {
            app.currentElevationData.set(elevationSource.subarray(start, end), start);
        });

        // The working roughness follows the working terrain, so the brushes painted live start
        // from the same texture record a replay does
        if (app.currentRoughness) {
            const baseRoughness = this.getBaseRoughness(app);
            this.#forEachBoundsRow(bounds, app.mapWidth, (start, end) => {
                if (layer) {
                    app.currentRoughness.set(layer.roughness.subarray(start, end), start);
                } else {
                    app.currentRoughness.fill(baseRoughness, start, end);
                }
            });
        }

        // Painted biomes have no separate "base" layer: 0 is the sentinel createBiomesMap()
        // already treats as "no override, compute the biome normally", so with no strokes the
        // overrides are cleared. Without this reset, undoing a paint stroke would leave its
        // override sitting on pixels no remaining stroke touches.
        if (!app.currentBiomeOverrides) return;

        this.#forEachBoundsRow(bounds, app.mapWidth, (start, end) => {
            if (layer) {
                app.currentBiomeOverrides.set(layer.overrides.subarray(start, end), start);
            } else {
                app.currentBiomeOverrides.fill(0, start, end);
            }
        });
    }

    /**
     * Replays the stroke history straight onto the working terrain, which #resetToBrushedLayer has
     * just set to the base terrain. It needs no extra memory but takes time in proportion to the
     * number of strokes, so it is only used when the layer could not be allocated.
     *
     * @param {boolean} layerUsable - Whether the layer was used; nothing is replayed if it was.
     */
    static #replayIntoWorkingTerrain(app, seaLevel, bounds, layerUsable) {
        if (layerUsable) return;
        app.brushEngine?.replayHistory(app.currentElevationData, app.currentBiomeOverrides, seaLevel, bounds, app.currentRoughness ?? null);
    }

    /**
     * Applies the vector features that deform terrain on top of the replayed brush strokes: the
     * tectonic features (see TectonicFeatureEngine), then any original fault lines, both across
     * base and brushed terrain, then manual rivers carved into the final deformed topography. The
     * order matters because rivers must cut the terrain faults have already reshaped.
     *
     * The features' results are kept in `app.tectonicFeatureCache` between rebuilds, so an edit
     * only works out again the features it affects.
     */
    static #applyVectorDeformations(app, elevationData, engine, params, bounds) {
        if (app.tectonicFaults?.length > 0) {
            this.#applyTectonicFeatures(app, elevationData, engine, params, bounds);
            TectonicEngine.applyTectonicFaults(elevationData, app.mapWidth, app.mapHeight, app.tectonicFaults, engine.simplex, bounds, params.terrain?.faultFrame);
        }

        if (app.manualRivers?.length > 0) {
            HydrologyEngine.carveManualRivers(elevationData, app.mapWidth, app.mapHeight, app.manualRivers, engine.simplex, params.seaLevel, bounds);
        }
    }

    /**
     * Adds the tectonic features to `elevationData`.
     *
     * The features are worked out from the ground (the brushed terrain) around them, not only
     * inside the bounds. When the whole map is being rebuilt, `elevationData` has just been reset
     * to that ground everywhere, so it serves as the ground itself (the engine works out every
     * change before adding any). A rebuild limited to part of the map leaves the rest of
     * `elevationData` holding the previous faults, so the brushed layer is read instead.
     */
    static #applyTectonicFeatures(app, elevationData, engine, params, bounds) {
        const terrain = params.terrain ?? {};
        const world = terrain.world ?? { rootW: app.mapWidth, rootH: app.mapHeight };
        const wholeMap = !bounds || (bounds.minX <= 0 && bounds.minY <= 0 && bounds.maxX >= app.mapWidth - 1 && bounds.maxY >= app.mapHeight - 1);
        const ground = wholeMap ? elevationData : (app.brushEngine?.layerCache?.elevation ?? app.baseElevationData);
        app.tectonicFeatureCache ??= {};
        TectonicFeatureEngine.apply(elevationData, ground, app.tectonicFaults, {
            width: app.mapWidth,
            height: app.mapHeight,
            simplex: engine.simplex,
            seaLevel: params.seaLevel,
            frame: { ...(terrain.faultFrame ?? { zoom: 1, originX: 0, originY: 0 }), rootSize: Math.max(world.rootW ?? app.mapWidth, world.rootH ?? app.mapHeight) },
            bounds,
            cache: app.tectonicFeatureCache,
        });
    }

    /**
     * A map-sized float buffer for building results off to the side before they are compared
     * with, or copied over, the live ones. It is created on first use and reused, so maps that
     * never need it do not pay for it, and it is replaced if the map's size changes.
     */
    static #getScratchBuffer(app) {
        const pixels = app.mapWidth * app.mapHeight;
        if (app.bufferScratch?.length !== pixels) {
            app.bufferScratch = new Float32Array(pixels);
        }
        return app.bufferScratch;
    }

    /**
     * The scratch buffer, or null if the browser has no memory for it. Running out of memory is
     * not something the module can prevent, so callers fall back to work that needs no extra
     * buffer. After a failure it is not tried again until the next full generation (see
     * processTopographyPhase), since each failed allocation costs time.
     */
    static #tryGetScratchBuffer(app) {
        if (app.scratchUnavailable) return null;

        try {
            return this.#getScratchBuffer(app);
        } catch (error) {
            if (!(error instanceof RangeError)) throw error;

            app.bufferScratch = null;
            app.scratchUnavailable = true;
            console.warn(`FWMB | Not enough memory for the rebuild scratch buffer (${error.message}). Refreshes will cover the whole map instead of just the changed area.`);
            return null;
        }
    }

    /**
     * Runs `work` and returns how long it took, in milliseconds.
     */
    static #measureMs(work) {
        const start = performance.now();
        work();
        return performance.now() - start;
    }

    /**
     * Walks each row of a rectangular bounds region on a flattened 1D raster buffer, invoking
     * `rowFn(rowStart, rowEndExclusive)` with the touched span of that row. Shared by the
     * elevation and biome-override reset passes above, which both need to walk the same
     * region of their respective same-sized buffers.
     */
    static #forEachBoundsRow(bounds, mapWidth, rowFn) {
        for (let y = bounds.minY; y <= bounds.maxY; y++) {
            const rowOffset = y * mapWidth;
            rowFn(rowOffset + bounds.minX, rowOffset + bounds.maxX + 1);
        }
    }

    /**
     * Executes the climate simulation phase.
     *
     * A bounded run recomputes the moisture and temperature of a wider area than the one it is
     * given. Moisture depends on the elevation a fixed distance upwind on the same row (see
     * ProceduralEngine.getWindDistance), so an elevation change alters the moisture of pixels up
     * to that distance to its left and right, and those pixels have to be recomputed too.
     *
     * @param {object} app - The MapStudioApp instance.
     * @param {object|null} bounds - Area whose elevation changed, or null for the whole map.
     * @returns {object|null} The area the climate was actually recomputed over, which is where
     *   moisture and temperature may have changed; null when the whole map was recomputed.
     */
    static processClimatePhase(app, bounds = null) {
        const { currentSeed, params } = MapStateManager.getMapParameters(app);
        const engine = new ProceduralEngine(currentSeed);

        let activeBounds = bounds;
        if (activeBounds) {
            const windDistance = ProceduralEngine.getWindDistance(app.mapWidth, params);
            activeBounds = SpatialMath.padBounds(activeBounds, windDistance, 0, app.mapWidth, app.mapHeight);
        }

        const t0 = performance.now();

        engine.generateClimateData(app.currentElevationData, app.mapWidth, app.mapHeight, params, app.currentMoistureData, app.currentTemperatureData, activeBounds);

        const t1 = performance.now();
        app.renderTimer.record("Climate", t1 - t0);

        return activeBounds;
    }

    /**
     * Executes the hydrological feature generation phase.
     *
     * Rivers and lakes are always traced over the whole map, because a change in one place can
     * send a river somewhere quite different a long way downstream. That means the water can
     * change far from the edit that caused it, so when the caller is limiting its repaint to an
     * area it asks for the water changes to be tracked, and gets back where the water differs from
     * before so the repaint can include it.
     *
     * @param {object} app - The MapStudioApp instance.
     * @param {boolean} trackWaterChanges - Whether to report where the water changed.
     * @returns {object|null} Box around every pixel whose water depth changed, or null if
     *   none did or tracking was not requested. If tracking was requested but the browser had no
     *   memory for the previous water to compare with, the box covers the whole map.
     */
    static processFeaturePhase(app, trackWaterChanges = false) {
        const { currentSeed, params } = MapStateManager.getMapParameters(app);
        const engine = new ProceduralEngine(currentSeed);

        const t0 = performance.now();

        // Bake procedural springs into permanent pins on first load or new map generation
        if (!app.uiState.springsBaked) {
            if (app.uiState.generationEngine !== "flat") {
                const newSprings = engine.bakeProceduralSprings(app.currentElevationData, app.currentMoistureData, app.mapWidth, app.mapHeight, params);
                for (const s of newSprings) {
                    app.mapPins.push({
                        id: foundry.utils.randomID(),
                        name: "River Source",
                        x: s.x,
                        y: s.y,
                        type: "spring",
                        radius: 6,
                        visibility: "all",
                    });
                }
            }
            app.uiState.springsBaked = true;
            app.markDirty();
        }

        const dynamicPins = [...app.mapPins];

        // Ensure procedural water spawns exactly at the highest point of our manual carve
        const manualSprings = HydrologyEngine.getRiverSources(app.currentElevationData, app.mapWidth, app.manualRivers);
        dynamicPins.push(...manualSprings);

        // generateRivers rewrites the water mask from scratch, so the previous one has to be
        // kept aside to compare with. It goes in the shared scratch buffer, which nothing else
        // is using at this point.
        const previousWater = trackWaterChanges ? this.#tryGetScratchBuffer(app) : null;
        previousWater?.set(app.bufferWaterMask);

        app.currentRiverData = engine.generateRivers(
            app.currentElevationData,
            app.currentMoistureData,
            app.currentTemperatureData,
            dynamicPins,
            app.mapWidth,
            app.mapHeight,
            params,
            app.bufferRiverMap,
            app.bufferWaterMask,
        );

        const t1 = performance.now();
        app.renderTimer.record("Features (springs and rivers)", t1 - t0);

        if (!trackWaterChanges) return null;

        // Without the scratch buffer the old water is gone, so all that can be said is that any of
        // it may have changed; the repaint then covers the whole map.
        return previousWater ? BufferDiff.changedBounds(previousWater, app.bufferWaterMask, app.mapWidth, app.mapHeight) : ProceduralEngine.resolveBounds(null, app.mapWidth, app.mapHeight);
    }
}
