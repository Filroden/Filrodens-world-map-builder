import { SpatialMath } from "./SpatialMath.js";
import { BrushLayerCache } from "./BrushLayerCache.js";
import { FILRODENSWMB } from "../config.js";

/** Brush feather is capped just below 1 so the falloff band never collapses to zero width. */
const MAX_FEATHER = 0.99;

/** The slope tools blend towards their anchored elevation by the brush influence raised to this power. */
const SLOPE_INFLUENCE_POWER = 4;

/** Smooth moves each pixel this fraction of the way towards the elevation under the stamp centre, scaled by strength and influence. */
const SMOOTH_BLEND_FACTOR = 0.5;

/**
 * Slack, in pixels, added to each row's circle chord when working out which pixels to test. See
 * BrushEngine#computeRowSpans for why it is needed.
 */
const CHORD_MARGIN_PX = 1e-3;

/** How a terrain stamp updates elevation. NONE means the stamp cannot change anything. */
const TERRAIN_MODE = Object.freeze({ NONE: 0, RAISE: 1, LOWER: 2, SMOOTH: 3, SLOPE: 4, CLAMP_ONLY: 5 });

/**
 * Two-argument Math.hypot, reproducing the algorithm V8 (Chromium, and so Foundry) implements it
 * with: divide both values by the larger, add their squares, take the square root and scale back
 * up. (V8 sums with Kahan compensation, which cannot change the result with only two terms.)
 *
 * Math.hypot is by far the most expensive call in the stamp loop, and this inline copy costs
 * about half as much. Plain sqrt(dx*dx + dy*dy) would be cheaper still, but it rounds differently
 * in roughly a third of pixels; that is invisible in the stored 32-bit elevation almost
 * everywhere, yet it is not guaranteed to be, and replayed terrain would no longer match what
 * earlier versions produced from the same strokes. This copy returns exactly what Math.hypot
 * returns in V8. Other engines may differ from it in the last bit, as they already may differ
 * from V8's own Math.hypot, which never mattered because the difference is far below the
 * precision of the stored elevation.
 */
function exactHypot(dx, dy) {
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    const max = ax > ay ? ax : ay;
    if (max === 0) return 0;

    const nx = ax / max;
    const ny = ay / max;
    return Math.sqrt(nx * nx + ny * ny) * max;
}

export class BrushEngine {
    // Per-row first and last column a stamp needs to test; reused across stamps to avoid
    // allocating for every row of every stamp. See #computeRowSpans.
    #spanStart = new Int32Array(0);
    #spanEnd = new Int32Array(0);

    // Stroke history behind the `history` accessor below.
    #history = [];

    // Set only while a stroke is being applied to the brushed layer, so that each stamp can save
    // the tiles it is about to overwrite for that stroke's undo patch.
    #footprintObserver = null;

    // The history length and last stroke the brushed layer was last brought in line with. If the
    // history no longer ends the way this says, something changed it behind the engine's back
    // (a direct push or splice on the array) and the layer cannot be trusted.
    #layerCacheStrokeCount = 0;
    #layerCacheLastStroke = null;

    constructor(mapWidth, mapHeight) {
        this.mapWidth = mapWidth;
        this.mapHeight = mapHeight;

        // The base terrain with every stroke in `history` applied, kept up to date as strokes are
        // finished, undone and redone so that rebuilding terrain does not have to replay the whole
        // history. See BrushLayerCache. Created before `history` because assigning history
        // invalidates it.
        this.layerCache = new BrushLayerCache(mapWidth, mapHeight);

        // The permanent, uncapped record of every completed brush stroke (terrain or biome).
        // MapStudioApp saves this array in full with the map and never trims it - it's not undo
        // data, it's the replay log a map's terrain/biomes get rebuilt from on load (regenerate
        // procedurally from the saved seed/params, then replayHistory() re-paints every stroke
        // here back on top). Session-scoped undo/redo bookkeeping for the Undo/Redo buttons lives
        // separately, in MapStudioApp's globalHistoryLedger/globalRedoLedger - see that class's
        // constructor for the full explanation of the split. Don't add capping logic here; it
        // belongs nowhere near this array.
        this.history = [];
        this.redoStack = [];

        this.currentStroke = null;
        this.lastX = null;
        this.lastY = null;
    }

    get history() {
        return this.#history;
    }

    /**
     * Replacing the whole history (loading a saved map) invalidates the brushed layer, because
     * it was built from the strokes that were there before. Changing strokes in place (scaling or
     * shifting the map) is invisible to a setter, so callers that do that must call
     * invalidateLayerCache() themselves.
     */
    set history(strokes) {
        this.#history = strokes;
        this.layerCache.invalidate();
    }

    /**
     * Replays the whole stroke history over `baseElevation` into the brushed layer and marks it
     * valid, so later rebuilds, undos and redos can reuse it. Call this whenever the base terrain
     * or the sea level may have changed, and whenever the layer is invalid.
     *
     * @param {Float32Array} baseElevation - The base terrain to replay the strokes onto.
     * @param {number} seaLevel - Sea level for biome paint, which only lands on the right kind of tile.
     */
    rebuildLayerCache(baseElevation, seaLevel) {
        const cache = this.layerCache;
        cache.reset(baseElevation, seaLevel);
        this.replayHistory(cache.elevation, cache.overrides, seaLevel);
        cache.markValid();
        this.#markLayerCacheInLineWithHistory();
    }

    /**
     * Whether the brushed layer can stand in for a full replay right now: it is valid, it was
     * built with this sea level, and the history still ends with the stroke it was last brought
     * in line with. The last check catches strokes added or removed by editing the history array
     * directly instead of through this class.
     *
     * @param {number} seaLevel - Sea level the rebuild about to happen will use.
     * @returns {boolean} True if the layer's buffers equal a full replay of the history.
     */
    isLayerCacheCurrent(seaLevel) {
        return this.layerCache.seaLevel === seaLevel && this.#layerCacheInLineWithHistory();
    }

    /**
     * Whether the layer is valid and the history still ends with the stroke the layer was last
     * brought in line with.
     */
    #layerCacheInLineWithHistory() {
        return this.layerCache.valid && this.#layerCacheStrokeCount === this.#history.length && this.#layerCacheLastStroke === (this.#history.at(-1) ?? null);
    }

    #markLayerCacheInLineWithHistory() {
        this.#layerCacheStrokeCount = this.#history.length;
        this.#layerCacheLastStroke = this.#history.at(-1) ?? null;
    }

    /** Marks the brushed layer as stale. Call after editing strokes in place. */
    invalidateLayerCache() {
        this.layerCache.invalidate();
    }

    startStroke(layer, tool, size, strength, feather, paintValue = null) {
        this.currentStroke = {
            layer,
            tool,
            size,
            strength,
            feather,
            paintValue,
            points: [],
        };

        this.lastX = null;
        this.lastY = null;

        // Starting a new stroke discards the redo stack for good, so its strokes can never be
        // redone and their undo patches are dead weight.
        for (const discarded of this.redoStack) {
            this.layerCache.discardPatch(discarded);
        }
        this.redoStack = [];
        this.activeSlopeElevation = null;
    }

    applyBrush(x, y, elevationData, biomeOverrideData, springOverrides, seaLevel) {
        if (!this.currentStroke) return null;
        return this.#lerpAndStamp(x, y, elevationData, biomeOverrideData, seaLevel, true);
    }

    endStroke() {
        if (!this.currentStroke || this.currentStroke.points.length === 0) {
            this.currentStroke = null;
            return;
        }

        const stroke = this.currentStroke;
        this.#appendToHistory(stroke);
        this.currentStroke = null;
        this.lastX = null;
        this.lastY = null;
    }

    /**
     * Adds a stroke to the end of the history and, if the brushed layer matched the history
     * beforehand, applies the stroke to it as well. A layer that did not match (the history was
     * edited without the engine's knowledge) is invalidated instead, because applying one more
     * stroke to it would not make it right.
     */
    #appendToHistory(stroke) {
        const layerWasInLine = this.#layerCacheInLineWithHistory();
        this.#history.push(stroke);

        if (layerWasInLine) {
            this.#applyStrokeToLayerCache(stroke);
        } else {
            this.layerCache.invalidate();
        }
    }

    undo() {
        if (this.#history.length === 0) return false;

        const layerWasInLine = this.#layerCacheInLineWithHistory();
        const stroke = this.#history.pop();
        this.redoStack.push(stroke);

        // No patch for this stroke (it was dropped to save memory) means the layer cannot be
        // wound back, so it is invalidated and the caller's next rebuild replays the history.
        if (layerWasInLine && this.layerCache.revert(stroke)) {
            this.#markLayerCacheInLineWithHistory();
        } else {
            this.layerCache.invalidate();
        }
        return true;
    }

    redo() {
        if (this.redoStack.length === 0) return false;

        this.#appendToHistory(this.redoStack.pop());
        return true;
    }

    replayHistory(elevationData, biomeOverrideData, seaLevel, activeBounds = null) {
        for (const stroke of this.#history) {
            // Fast box check to skip strokes entirely outside the active rebuild zone
            if (activeBounds) {
                const strokeBounds = SpatialMath.getVectorBounds(stroke, stroke.size);
                if (!SpatialMath.isValidBounds(SpatialMath.intersectBounds(strokeBounds, activeBounds))) continue;
            }

            this.#replayStroke(stroke, elevationData, biomeOverrideData, seaLevel, activeBounds);
        }
        this.currentStroke = null;
        this.lastX = null;
        this.lastY = null;
    }

    /**
     * Applies one recorded stroke from its stored points, exactly as a replay of the full
     * history does when it reaches that stroke. Every stroke starts with no previous position and
     * no anchored slope elevation, so the result depends only on the stroke and the buffers.
     */
    #replayStroke(stroke, elevationData, biomeOverrideData, seaLevel, activeBounds = null) {
        this.currentStroke = stroke;
        this.lastX = null;
        this.lastY = null;
        this.activeSlopeElevation = null;

        for (const pt of stroke.points) {
            // Pass activeBounds down to restrict the internal stamping loops
            this.#lerpAndStamp(pt.x, pt.y, elevationData, biomeOverrideData, seaLevel, false, activeBounds);
        }
    }

    /**
     * Brings the brushed layer up to date with a stroke that was just added to the history (by
     * finishing it or redoing it), recording an undo patch on the way. Does nothing while the
     * layer is invalid: the next full rebuild will replay the stroke along with the rest.
     *
     * The stroke is replayed from its recorded points rather than reusing what the live brush
     * painted, because the live brush paints on the working terrain (with faults and rivers
     * carved in, and un-rounded pointer positions), while the layer must equal what a replay of
     * the history produces.
     */
    #applyStrokeToLayerCache(stroke) {
        const cache = this.layerCache;
        if (!cache.valid) return;

        cache.beginPatch(stroke);
        this.#footprintObserver = (footprint) => cache.noteFootprint(footprint);

        try {
            this.#replayStroke(stroke, cache.elevation, cache.overrides, cache.seaLevel);
            cache.commitPatch();
            this.#markLayerCacheInLineWithHistory();
        } catch (error) {
            // A stroke that failed part-way leaves the layer in a state no replay would produce.
            cache.invalidate();
            throw error;
        } finally {
            this.#footprintObserver = null;
            this.currentStroke = null;
            this.lastX = null;
            this.lastY = null;
        }
    }

    // --- Private Interpolation Engine ---

    #lerpAndStamp(x, y, elevationData, biomeOverrideData, seaLevel, shouldRecord, activeBounds) {
        let dirtyBounds = SpatialMath.getEmptyBounds();

        if (this.lastX === null || this.lastY === null) {
            // Anchor the slope elevation to the exact pixel where the user first clicked
            if (this.currentStroke.tool === "slopeUp" || this.currentStroke.tool === "slopeDown" || this.currentStroke.tool === "level") {
                const tx = Math.round(x);
                const ty = Math.round(y);

                if (tx < 0 || tx >= this.mapWidth || ty < 0 || ty >= this.mapHeight) {
                    this.activeSlopeElevation = null;
                } else {
                    this.activeSlopeElevation = elevationData[ty * this.mapWidth + tx];
                }
            }

            if (shouldRecord) this.#recordControlPoint(x, y);

            const stampBounds = this.#stampBrush(x, y, elevationData, biomeOverrideData, seaLevel, activeBounds);
            dirtyBounds = SpatialMath.mergeBounds(dirtyBounds, stampBounds);

            this.lastX = x;
            this.lastY = y;
            return dirtyBounds;
        }

        const dx = x - this.lastX;
        const dy = y - this.lastY;
        const distance = Math.hypot(dx, dy);

        const radius = this.currentStroke.size;
        const stepSpacing = Math.max(1, radius * 0.25);

        // Accumulator: Required so slow mouse movements eventually trigger a stamp
        if (distance < stepSpacing) {
            return dirtyBounds; // Returns the safe 'Infinity' bounds
        }

        const steps = Math.floor(distance / stepSpacing);

        for (let i = 1; i <= steps; i++) {
            const lerpFactor = (i * stepSpacing) / distance;
            const interpX = this.lastX + dx * lerpFactor;
            const interpY = this.lastY + dy * lerpFactor;

            const gradientBoost = 0.3;

            if (this.currentStroke.tool === "slopeUp") {
                this.activeSlopeElevation += this.currentStroke.strength * stepSpacing * gradientBoost;
                this.activeSlopeElevation = Math.min(1, this.activeSlopeElevation);
            } else if (this.currentStroke.tool === "slopeDown") {
                this.activeSlopeElevation -= this.currentStroke.strength * stepSpacing * gradientBoost;
                this.activeSlopeElevation = Math.max(0, this.activeSlopeElevation);
            }

            const stampBounds = this.#stampBrush(interpX, interpY, elevationData, biomeOverrideData, seaLevel, activeBounds);
            dirtyBounds = SpatialMath.mergeBounds(dirtyBounds, stampBounds);
        }

        if (shouldRecord) {
            this.#recordControlPoint(x, y);
        }

        const finalLerp = (steps * stepSpacing) / distance;
        this.lastX = this.lastX + dx * finalLerp;
        this.lastY = this.lastY + dy * finalLerp;

        return dirtyBounds;
    }

    #recordControlPoint(x, y) {
        const pts = this.currentStroke.points;

        pts.push({ x: Number(x.toFixed(2)), y: Number(y.toFixed(2)) });
    }

    // --- Private Rasterisation & Math ---

    /**
     * Applies one brush stamp centred on (cx, cy) and returns the raw footprint it covered.
     *
     * This is the innermost loop of every replay - a large map can replay millions of stamps -
     * so it is written to do as little per pixel as possible while producing exactly the same
     * values, bit for bit, as the straightforward formulation (distance, influence, then a
     * per-tool update through a helper call for every pixel):
     *
     * - Stroke fields, the feather falloff band and the tool are resolved once per stamp, not
     *   once per pixel.
     * - The pixels each row can touch are narrowed to the chord of the brush circle, so pixels
     *   outside the circle are never visited (see #computeRowSpans).
     * - Distances come from exactHypot rather than Math.hypot, which is several times slower.
     */
    #stampBrush(cx, cy, elevationData, biomeOverrideData, seaLevel, activeBounds = null) {
        const stroke = this.currentStroke;
        const { layer, size } = stroke;

        // Calculate the raw, physical footprint of the brush
        const minX = Math.max(0, Math.floor(cx - size));
        const maxX = Math.min(this.mapWidth - 1, Math.ceil(cx + size));
        const minY = Math.max(0, Math.floor(cy - size));
        const maxY = Math.min(this.mapHeight - 1, Math.ceil(cy + size));

        // Intersect it with the restricted rebuild zone
        const b = SpatialMath.intersectBounds({ minX, maxX, minY, maxY }, activeBounds);

        // Safety Check: If the brush stroke is entirely outside the rebuild zone, abort early
        if (SpatialMath.isValidBounds(b)) {
            this.#footprintObserver?.(b);
            const shape = this.#buildStampShape(stroke, b, cx, cy);
            this.#rasteriseStamp(stroke, shape, elevationData, biomeOverrideData, seaLevel);
        }

        // Return the true footprint so the accumulator knows what was touched
        return { minX, maxX, minY, maxY };
    }

    /**
     * Resolves everything about a stamp's geometry that stays constant across its pixels, and
     * fills the per-row pixel spans. The influence falloff is 1 out to `coreSize` (the feather
     * setting is the solid fraction of the radius, capped so the falloff band never collapses to
     * zero width), then drops linearly to 0 at the brush edge across `falloff` pixels.
     */
    #buildStampShape(stroke, b, cx, cy) {
        const coreSize = stroke.size * Math.min(stroke.feather, MAX_FEATHER);

        this.#computeRowSpans(b, cx, cy, stroke.size);

        return {
            cx,
            cy,
            size: stroke.size,
            coreSize,
            falloff: stroke.size - coreSize,
            minY: b.minY,
            rows: b.maxY - b.minY + 1,
        };
    }

    /**
     * Records, for each row of the stamp's bounding box, the first and last column that can lie
     * inside the brush circle, so the pixel loops never test pixels far outside it (about a fifth
     * of the box).
     *
     * The spans are deliberately generous: each chord is widened by CHORD_MARGIN_PX, and every
     * pixel loop still applies the exact `distance > size` rejection itself, so the spans only
     * decide which pixels are worth testing and can never change which are painted. The margin
     * matters because the chord half-width is a square root, and near the top and bottom of the
     * circle it is extremely sensitive to rounding in `size * size - dy * dy`. A row is only skipped
     * outright when |dy| exceeds the radius, in which case every pixel in it is farther away
     * than the radius no matter what dx is.
     *
     * Results go into reusable typed arrays rather than a fresh object per row. An empty row is
     * stored as start 0, end -1.
     */
    #computeRowSpans(b, cx, cy, size) {
        const rows = b.maxY - b.minY + 1;
        if (this.#spanStart.length < rows) {
            this.#spanStart = new Int32Array(rows);
            this.#spanEnd = new Int32Array(rows);
        }

        const sizeSq = size * size;
        for (let row = 0; row < rows; row++) {
            const dy = b.minY + row - cy;
            const chordSq = sizeSq - dy * dy;

            if (chordSq < 0) {
                this.#spanStart[row] = 0;
                this.#spanEnd[row] = -1;
                continue;
            }

            const halfWidth = Math.sqrt(chordSq) + CHORD_MARGIN_PX;
            this.#spanStart[row] = Math.max(b.minX, Math.ceil(cx - halfWidth));
            this.#spanEnd[row] = Math.min(b.maxX, Math.floor(cx + halfWidth));
        }
    }

    /**
     * Routes a stamp to the loop for its layer: terrain strokes edit elevation, biome paint
     * strokes edit the override map, and any other layer has no raster effect.
     */
    #rasteriseStamp(stroke, shape, elevationData, biomeOverrideData, seaLevel) {
        if (stroke.layer === "terrain") {
            this.#stampTerrain(stroke, shape, elevationData);
        } else if (stroke.layer === "biome" && stroke.tool === "paint" && biomeOverrideData) {
            this.#stampBiome(stroke, shape, elevationData, biomeOverrideData, seaLevel);
        }
    }

    /**
     * Chooses the terrain update for a stroke's tool. Returns TERRAIN_MODE.NONE when the stamp
     * can have no effect at all: smooth pulls every pixel towards the elevation under the stamp
     * centre, which does nothing if that centre is off the map, and the slope tools do nothing
     * until the stroke's first click has anchored an elevation. An unrecognised tool still
     * clamps the elevation of every pixel it covers to be non-negative, like every other tool.
     */
    #resolveTerrainMode(tool, targetIndex) {
        if (tool === "raise") return TERRAIN_MODE.RAISE;
        if (tool === "lower") return TERRAIN_MODE.LOWER;
        if (tool === "smooth") return targetIndex === null ? TERRAIN_MODE.NONE : TERRAIN_MODE.SMOOTH;
        if (tool === "slopeUp" || tool === "slopeDown" || tool === "level") {
            return this.activeSlopeElevation === null ? TERRAIN_MODE.NONE : TERRAIN_MODE.SLOPE;
        }
        return TERRAIN_MODE.CLAMP_ONLY;
    }

    /**
     * Index of the pixel under the stamp centre, or null if that centre is off the map. Smooth
     * pulls every pixel in the stamp towards this pixel's elevation.
     */
    #getStampCentreIndex(cx, cy) {
        const targetX = Math.round(cx);
        const targetY = Math.round(cy);

        if (targetX < 0 || targetX >= this.mapWidth || targetY < 0 || targetY >= this.mapHeight) return null;
        return targetY * this.mapWidth + targetX;
    }

    /**
     * Terrain pixel loop. One loop serves every terrain tool, with the tool chosen by a switch on
     * a mode fixed for the whole stamp, so the switch is perfectly predictable and the row and
     * distance handling exists once.
     *
     * Every branch ends by clamping elevation to be non-negative. Writing the clamped value in
     * one step gives the same result as clamping the stored value afterwards, because rounding to
     * 32-bit float never reorders values.
     *
     * Smooth deliberately re-reads the centre pixel for every pixel it updates, instead of once
     * per stamp: the centre pixel lies inside the stamp and is itself updated part-way through
     * the loop, so the elevation later pixels are pulled towards is part of the result.
     */
    #stampTerrain(stroke, shape, elevationData) {
        const { tool, strength } = stroke;
        const { cx, cy, size, coreSize, falloff, minY, rows } = shape;
        const targetIndex = tool === "smooth" ? this.#getStampCentreIndex(cx, cy) : null;
        const mode = this.#resolveTerrainMode(tool, targetIndex);
        if (mode === TERRAIN_MODE.NONE) return;

        const slopeElevation = this.activeSlopeElevation;
        const width = this.mapWidth;

        for (let row = 0; row < rows; row++) {
            const y = minY + row;
            const dy = y - cy;
            const rowBase = y * width;
            const xEnd = this.#spanEnd[row];

            for (let x = this.#spanStart[row]; x <= xEnd; x++) {
                const distance = exactHypot(x - cx, dy);
                if (distance > size) continue;

                const influence = distance > coreSize ? 1 - (distance - coreSize) / falloff : 1;
                const index = rowBase + x;
                const current = elevationData[index];

                switch (mode) {
                    case TERRAIN_MODE.RAISE:
                        elevationData[index] = Math.max(0, Math.min(1, current + strength * influence));
                        break;
                    case TERRAIN_MODE.LOWER:
                        elevationData[index] = Math.max(0, current - strength * influence);
                        break;
                    case TERRAIN_MODE.SMOOTH:
                        elevationData[index] = Math.max(0, current + (elevationData[targetIndex] - current) * (strength * influence * SMOOTH_BLEND_FACTOR));
                        break;
                    case TERRAIN_MODE.SLOPE: {
                        const slopeInfluence = Math.pow(influence, SLOPE_INFLUENCE_POWER);
                        elevationData[index] = Math.max(0, current * (1 - slopeInfluence) + slopeElevation * slopeInfluence);
                        break;
                    }
                    default:
                        elevationData[index] = Math.max(0, current);
                }
            }
        }
    }

    /**
     * Biome paint pixel loop. Writes a biome override, but only where the paint value makes sense
     * for the tile underneath - a land biome can't be hand-painted onto water and vice versa.
     * That guard stays symmetric with ProceduralEngine.resolveBiomeLookup, which never lets a
     * custom biome reach water except via an auto-generation rule match (see that method's own
     * doc comment). Two built-in values are deliberate exceptions, both allowed to write onto
     * water: Pack Ice, which has always rendered solid over water, and the Eraser (id 0), which
     * needs to be able to clear a previous Pack-Ice-style override sitting on a water tile -
     * otherwise that override could never be erased again.
     *
     * Paint is all-or-nothing across the whole brush circle, so unlike terrain it ignores the
     * feather falloff.
     */
    #stampBiome(stroke, shape, elevationData, biomeOverrideData, seaLevel) {
        const { paintValue } = stroke;
        const { cx, cy, size, minY, rows } = shape;

        const isWaterBiome = paintValue === FILRODENSWMB.BIOME_IDS.DEEP_OCEAN || paintValue === FILRODENSWMB.BIOME_IDS.SHALLOW_OCEAN;
        const canPaintOverWater = paintValue === FILRODENSWMB.BIOME_IDS.PACK_ICE || paintValue === FILRODENSWMB.BIOME_IDS.ERASER;
        const width = this.mapWidth;

        for (let row = 0; row < rows; row++) {
            const y = minY + row;
            const dy = y - cy;
            const rowBase = y * width;
            const xEnd = this.#spanEnd[row];

            for (let x = this.#spanStart[row]; x <= xEnd; x++) {
                if (exactHypot(x - cx, dy) > size) continue;

                const index = rowBase + x;
                const isLand = elevationData[index] >= seaLevel;

                if (canPaintOverWater || isLand !== isWaterBiome) {
                    biomeOverrideData[index] = paintValue;
                }
            }
        }
    }
}
