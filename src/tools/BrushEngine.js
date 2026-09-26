import { SpatialMath } from "./SpatialMath.js";
import { BrushLayerCache } from "./BrushLayerCache.js";
import { FILRODENSWMB } from "../config.js";

/** Brush feather is capped just below 1 so the falloff band never collapses to zero width. */
const MAX_FEATHER = 0.99;

/** The slope tools blend towards their anchored elevation by the brush influence raised to this power. */
const SLOPE_INFLUENCE_POWER = 4;

/** How far a slope stroke's target elevation climbs or falls per pixel it travels, at a Strength of 1. */
const SLOPE_GRADIENT = 0.3;

/**
 * The brush maths a stroke was painted with. Strokes are saved and replayed every time a map
 * loads, so changing how a tool works would change every map already painted with it; instead a
 * stroke records the revision it was painted with and replays with that revision's maths.
 * Strokes saved without a revision are ORIGINAL.
 *   ORIGINAL - Smooth pulls each pixel towards the elevation under the stamp centre, by a
 *              share far too small to see at any strength; Level makes perfectly flat ground.
 *   CURRENT  - Smooth pulls each pixel towards the average of the ground around it (see
 *              #buildLocalMeans), by a share that reaches SMOOTH_MAX_BLEND at full Strength,
 *              without moving the coastline (see #holdCoast); Level lays the surface texture
 *              on the ground it levels.
 */
const STROKE_REVISION = Object.freeze({ ORIGINAL: 1, CURRENT: 2 });

/** ORIGINAL Smooth moves each pixel this fraction of the way towards the elevation under the stamp centre, scaled by strength and influence. */
const SMOOTH_BLEND_FACTOR = 0.5;

/**
 * CURRENT Smooth averages each pixel's surroundings out to this share of the brush radius (at
 * least one pixel). Detail smaller than that is flattened; larger shapes survive, so a stroke
 * softens a hillside rather than levelling it.
 */
const SMOOTH_KERNEL_SHARE = 0.25;

/** The Strength setting at which CURRENT Smooth works at full effect: the Strength slider's maximum (toolbar-terrain.hbs). */
const SMOOTH_FULL_STRENGTH = 0.05;

/**
 * The share of the way to its surroundings' average a pixel moves in one stamp of CURRENT
 * Smooth at full Strength and influence. A stroke stamps each pixel several times as it passes,
 * so one pass at full Strength removes most of the fine detail under the brush.
 */
const SMOOTH_MAX_BLEND = 0.5;

/**
 * Slack, in pixels, added to each row's circle chord when working out which pixels to test. See
 * BrushEngine#computeRowSpans for why it is needed.
 */
const CHORD_MARGIN_PX = 1e-3;

/** How a terrain stamp updates elevation. NONE means the stamp cannot change anything. */
const TERRAIN_MODE = Object.freeze({ NONE: 0, RAISE: 1, LOWER: 2, SMOOTH: 3, SLOPE: 4, CLAMP_ONLY: 5, ROUGHEN: 6, TEXTURED_LEVEL: 7, SMOOTH_AVERAGE: 8 });

/** Roughness of ground carrying all of the surface texture (0 is none of it). */
const FULL_ROUGHNESS = FILRODENSWMB.GENERATION.SURFACE_TEXTURE.FULL_ROUGHNESS;

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

    // Working space for CURRENT Smooth's neighbourhood averages (see #buildLocalMeans), reused
    // across stamps and grown as needed
    #summedArea = new Float64Array(0);
    #localMeans = new Float32Array(0);

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

        // Supplies the map's surface texture (see ProceduralEngine.generateSurfaceTexture) to the
        // strokes that paint it, as a function given the pixels needed (inclusive bounds) and
        // returning a map-sized Float32Array that holds the texture at least there, or null if
        // there is none. Set by the owner of the engine, which may work the texture out only
        // where it is asked for, so a stamp must only read the pixels it asked for.
        this.surfaceTexture = null;
        this.surfaceTextureAmplitude = 0;
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
     * @param {number} [baseRoughness] - How much surface texture the base terrain already carries
     *   (see BrushLayerCache.reset).
     * @returns {boolean} False if there was not enough memory for the layer. Nothing was replayed
     *   and the layer stays invalid, so the caller has to replay the history some other way.
     */
    rebuildLayerCache(baseElevation, seaLevel, baseRoughness = 0) {
        const cache = this.layerCache;
        if (!cache.reset(baseElevation, seaLevel, baseRoughness)) return false;

        this.replayHistory(cache.elevation, cache.overrides, seaLevel, null, cache.roughness);
        cache.markValid();
        this.#markLayerCacheInLineWithHistory();
        return true;
    }

    /**
     * Whether the brushed layer can stand in for a full replay right now: it is valid, it was
     * built with this sea level, and the history still ends with the stroke it was last brought
     * in line with. The last check catches strokes added or removed by editing the history array
     * directly instead of through this class.
     *
     * @param {number} seaLevel - Sea level the rebuild about to happen will use.
     * @param {number} [baseRoughness] - Roughness the base terrain starts with (see BrushLayerCache.reset).
     * @returns {boolean} True if the layer's buffers equal a full replay of the history.
     */
    isLayerCacheCurrent(seaLevel, baseRoughness = 0) {
        return this.layerCache.seaLevel === seaLevel && this.layerCache.baseRoughness === baseRoughness && this.#layerCacheInLineWithHistory();
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

        // New terrain strokes use the current brush maths; strokes saved before it replay with
        // the maths they were painted with (see STROKE_REVISION)
        if (layer === "terrain") this.currentStroke.revision = STROKE_REVISION.CURRENT;

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

    /**
     * Paints the current stroke live, from its last position to (x, y).
     *
     * @param {Float32Array|null} [roughnessData] - The working roughness (see BrushLayerCache),
     *   which the Roughen, Level and Smooth brushes update. Without it they leave the texture alone.
     */
    applyBrush(x, y, elevationData, biomeOverrideData, springOverrides, seaLevel, roughnessData = null) {
        if (!this.currentStroke) return null;
        return this.#lerpAndStamp(x, y, elevationData, biomeOverrideData, seaLevel, true, null, roughnessData);
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

    /**
     * Replays every stroke in the history onto the buffers, in order.
     *
     * @param {Float32Array|null} [roughnessData] - Roughness to replay alongside the terrain (see
     *   applyBrush), holding the base terrain's roughness beforehand.
     */
    replayHistory(elevationData, biomeOverrideData, seaLevel, activeBounds = null, roughnessData = null) {
        for (const stroke of this.#history) {
            // Fast box check to skip strokes entirely outside the active rebuild zone
            if (activeBounds) {
                const strokeBounds = SpatialMath.getVectorBounds(stroke, stroke.size);
                if (!SpatialMath.isValidBounds(SpatialMath.intersectBounds(strokeBounds, activeBounds))) continue;
            }

            this.#replayStroke(stroke, elevationData, biomeOverrideData, seaLevel, activeBounds, roughnessData);
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
    #replayStroke(stroke, elevationData, biomeOverrideData, seaLevel, activeBounds = null, roughnessData = null, onAnchor = null) {
        this.currentStroke = stroke;
        this.lastX = null;
        this.lastY = null;
        this.activeSlopeElevation = null;

        stroke.points.forEach((pt, index) => {
            // Pass activeBounds down to restrict the internal stamping loops
            this.#lerpAndStamp(pt.x, pt.y, elevationData, biomeOverrideData, seaLevel, false, activeBounds, roughnessData);
            // The first point anchors a slope or Level stroke (see resolveAnchors)
            if (index === 0 && onAnchor && BrushEngine.#isAnchored(stroke)) onAnchor(this.activeSlopeElevation);
        });
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
            this.#replayStroke(stroke, cache.elevation, cache.overrides, cache.seaLevel, null, cache.roughness);
            cache.commitPatch();
            this.#markLayerCacheInLineWithHistory();
        } catch (error) {
            // A stroke that failed part-way leaves the layer in a state no replay would produce.
            cache.invalidate();

            // Running out of memory while saving the undo data only costs the shortcut: the
            // stroke is already in the history, and the next rebuild replays it with the rest.
            // Anything else is a bug and must not be hidden.
            if (!(error instanceof RangeError)) throw error;
            console.warn(`FWMB | Could not keep the brushed layer up to date (${error.message}). The next rebuild will replay the whole brush history instead.`);
        } finally {
            this.#footprintObserver = null;
            this.currentStroke = null;
            this.lastX = null;
            this.lastY = null;
        }
    }

    // --- Private Interpolation Engine ---

    #lerpAndStamp(x, y, elevationData, biomeOverrideData, seaLevel, shouldRecord, activeBounds, roughnessData = null) {
        let dirtyBounds = SpatialMath.getEmptyBounds();

        if (this.lastX === null || this.lastY === null) {
            // Anchor the slope elevation to the exact pixel where the user first clicked, unless
            // the stroke carries the elevation it anchored to on the map it was painted on (see
            // resolveAnchors)
            if (BrushEngine.#isAnchored(this.currentStroke)) {
                const saved = this.currentStroke.anchor;
                this.activeSlopeElevation = Number.isFinite(saved) ? saved : this.#anchorElevation(x, y, elevationData, roughnessData, seaLevel);
            }

            if (shouldRecord) this.#recordControlPoint(x, y);

            const stampBounds = this.#stampBrush(x, y, elevationData, biomeOverrideData, seaLevel, activeBounds, roughnessData);
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

            // activeSlopeElevation is the target the SLOPE stamp blends terrain towards (see
            // #stampTerrain); it is not itself written into elevationData here, but it ends up
            // in the stored elevation the moment a stamp uses it, so it is bound by the same
            // "no [0, 1] ceiling or floor" rule as everything else this brush writes. Without
            // that, dragging slopeUp across terrain already raised past 1 would silently cap the
            // slope's target back at 1 and start levelling the peak instead of continuing to climb it.
            if (this.currentStroke.tool === "slopeUp") {
                this.activeSlopeElevation += this.#slopeStep(stepSpacing);
            } else if (this.currentStroke.tool === "slopeDown") {
                this.activeSlopeElevation -= this.#slopeStep(stepSpacing);
            }

            const stampBounds = this.#stampBrush(interpX, interpY, elevationData, biomeOverrideData, seaLevel, activeBounds, roughnessData);
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

    /**
     * How far a slope stroke's target elevation moves over one step of `stepSpacing` pixels.
     *
     * The change is proportional to the distance travelled, so a slope's gradient is a height per
     * pixel of the map it was painted on. A regional map replays its parent's strokes at `scale`
     * times their size and length (see RegionalExtractor), so the same stroke travels `scale`
     * times as many of its pixels; dividing by the scale keeps the gradient per pixel of the
     * parent, and the slope climbs to the same height over the same stretch of the world. A stroke
     * painted on the map itself has no scale and moves exactly as it always has.
     */
    #slopeStep(stepSpacing) {
        return (this.currentStroke.strength * stepSpacing * SLOPE_GRADIENT) / BrushEngine.#scaleOf(this.currentStroke);
    }

    /** How many of this map's pixels one pixel of the map a stroke was painted on spans (1 if not recorded). */
    static #scaleOf(stroke) {
        return Number.isFinite(stroke.scale) && stroke.scale > 0 ? stroke.scale : 1;
    }

    /** Whether a stroke's tool climbs or falls as it travels (Slope Up and Slope Down). */
    static isSlope(stroke) {
        return stroke.tool === "slopeUp" || stroke.tool === "slopeDown";
    }

    /**
     * The elevation a slope or Level stroke anchors to: the ground under the pixel where the
     * stroke starts, or null if that is off the map.
     *
     * A textured Level stroke levels to the ground's height without its surface texture, since it
     * lays the texture back on top (see #stampTerrain); otherwise the level would sit up to the
     * texture's amplitude above or below the ground, depending on the exact pixel clicked.
     */
    #anchorElevation(x, y, elevationData, roughnessData, seaLevel) {
        const tx = Math.round(x);
        const ty = Math.round(y);
        if (tx < 0 || tx >= this.mapWidth || ty < 0 || ty >= this.mapHeight) return null;

        const index = ty * this.mapWidth + tx;
        const elevation = elevationData[index];
        const texture = BrushEngine.#isCurrent(this.currentStroke) && roughnessData ? this.surfaceTexture?.({ minX: tx, maxX: tx, minY: ty, maxY: ty }) : null;
        if (!texture) return elevation;

        return elevation - this.#textureAmplitudeAt(elevation, seaLevel) * texture[index] * (roughnessData[index] / FULL_ROUGHNESS);
    }

    /** Whether a stroke's tool anchors to the elevation where the stroke starts (slopes and Level). */
    static #isAnchored(stroke) {
        return BrushEngine.isSlope(stroke) || stroke.tool === "level";
    }

    /**
     * The elevation each slope and Level stroke in the history anchors to, found by replaying the
     * history from the base terrain exactly as a rebuild does.
     *
     * A regional map replays its parent's strokes on its own terrain, so it has to be given these:
     * a stroke that starts outside the crop has no ground to anchor to on the regional map (and so
     * would level nothing at all), and one that starts inside would anchor to the regional map's
     * slightly different ground rather than the parent's. RegionalExtractor saves each anchor on
     * the regional map's copy of the stroke (`anchor`), which a replay then uses in place of
     * sampling the ground.
     *
     * @param {Float32Array} baseElevation - The map's base terrain (not changed).
     * @param {number} seaLevel - The map's sea level.
     * @param {number} baseRoughness - The base terrain's roughness (see ProceduralOrchestrator.getBaseRoughness).
     * @returns {Map<object, number>} Each anchored stroke's anchor, for strokes that found one.
     */
    resolveAnchors(baseElevation, seaLevel, baseRoughness) {
        const anchors = new Map();
        if (!this.#history.some((stroke) => BrushEngine.#isAnchored(stroke))) return anchors;

        const elevation = new Float32Array(baseElevation);
        const roughness = new Uint8Array(elevation.length).fill(baseRoughness);
        for (const stroke of this.#history) {
            this.#replayStroke(stroke, elevation, null, seaLevel, null, roughness, (anchor) => {
                if (Number.isFinite(anchor)) anchors.set(stroke, anchor);
            });
        }
        this.currentStroke = null;
        this.lastX = null;
        this.lastY = null;
        return anchors;
    }

    /** Whether a stroke was painted with the current brush maths (see STROKE_REVISION). */
    static #isCurrent(stroke) {
        return (stroke.revision ?? STROKE_REVISION.ORIGINAL) >= STROKE_REVISION.CURRENT;
    }

    /**
     * How far the surface texture may move ground at `elevation` either side of it: its full
     * amplitude, but never more than a set share of the ground's height above, or depth below, sea
     * level (SURFACE_TEXTURE.COAST_SHARE). Near the coast the texture therefore fades out rather
     * than pushing land under the sea or seabed above it, and the coastline stays where it was.
     */
    #textureAmplitudeAt(elevation, seaLevel) {
        const coastShare = FILRODENSWMB.GENERATION.SURFACE_TEXTURE.COAST_SHARE;
        return Math.min(this.surfaceTextureAmplitude, coastShare * Math.abs(elevation - seaLevel));
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
    #stampBrush(cx, cy, elevationData, biomeOverrideData, seaLevel, activeBounds = null, roughnessData = null) {
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
            this.#rasteriseStamp(stroke, shape, elevationData, biomeOverrideData, seaLevel, roughnessData);
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
            minX: b.minX,
            minY: b.minY,
            cols: b.maxX - b.minX + 1,
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
    #rasteriseStamp(stroke, shape, elevationData, biomeOverrideData, seaLevel, roughnessData) {
        if (stroke.layer === "terrain") {
            this.#stampTerrain(stroke, shape, elevationData, roughnessData, seaLevel);
        } else if (stroke.layer === "biome" && stroke.tool === "paint" && biomeOverrideData) {
            this.#stampBiome(stroke, shape, elevationData, biomeOverrideData, seaLevel);
        }
    }

    /**
     * Chooses the terrain update for a stroke's tool. Returns TERRAIN_MODE.NONE when the stamp
     * can have no effect at all: smooth pulls every pixel towards the elevation under the stamp
     * centre, which does nothing if that centre is off the map, the slope tools do nothing
     * until the stroke's first click has anchored an elevation, and Roughen does nothing without
     * a surface texture and roughness to paint. A CURRENT Smooth averages the ground around each
     * pixel, and a CURRENT Level lays the texture on the ground it levels when both are
     * available; ORIGINAL strokes work as they always have (see STROKE_REVISION). An unrecognised tool falls through to TERRAIN_MODE.CLAMP_ONLY, whose
     * branch in #stampTerrain writes each pixel's elevation back unchanged - a safe no-op rather
     * than a guess at what an unknown tool should do to the terrain.
     */
    #resolveTerrainMode(stroke, targetIndex, canTexture) {
        const tool = stroke.tool;
        if (tool === "raise") return TERRAIN_MODE.RAISE;
        if (tool === "lower") return TERRAIN_MODE.LOWER;
        if (tool === "smooth") {
            if (BrushEngine.#isCurrent(stroke)) return TERRAIN_MODE.SMOOTH_AVERAGE;
            return targetIndex === null ? TERRAIN_MODE.NONE : TERRAIN_MODE.SMOOTH;
        }
        if (tool === "roughen") return canTexture ? TERRAIN_MODE.ROUGHEN : TERRAIN_MODE.NONE;
        if (tool === "slopeUp" || tool === "slopeDown" || tool === "level") {
            if (this.activeSlopeElevation === null) return TERRAIN_MODE.NONE;
            return tool === "level" && BrushEngine.#isCurrent(stroke) && canTexture ? TERRAIN_MODE.TEXTURED_LEVEL : TERRAIN_MODE.SLOPE;
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
     * No branch clamps elevation to [0, 1]. Hand-authored terrain (this brush, tectonic faults,
     * carved rivers) is deliberately allowed to exceed the range procedural generation itself
     * aims for, so a user has headroom to push a mountain higher than sea level's compression
     * would otherwise leave room for, or carve a trench deeper than the seafloor - without
     * needing to touch sea level to get it. The stored value is the real one; every place that
     * turns elevation into something on screen (colour, a contour line, the elevation readout, a
     * biome lookup) is responsible for clamping or saturating at the point it is actually used,
     * never here. Writing an unclamped value in one step gives the same result as clamping
     * later, because rounding to 32-bit float never reorders values.
     *
     * Smooth deliberately re-reads the centre pixel for every pixel it updates, instead of once
     * per stamp: the centre pixel lies inside the stamp and is itself updated part-way through
     * the loop, so the elevation later pixels are pulled towards is part of the result.
     *
     * Surface texture (see ProceduralEngine.generateSurfaceTexture) is part of the elevation
     * itself, and `roughnessData` records how much of it each pixel carries, from 0 to
     * FULL_ROUGHNESS. That record is what keeps the texture from building up:
     * - Roughen raises a pixel's roughness to its brush influence (full inside, fading across the
     *   brush's outer edge, see #roughenInfluence) and adds only the texture it was missing, so
     *   roughening ground that is already rough changes nothing. It ignores strength and feather.
     * - Smooth flattens the texture along with everything else, so it lowers the roughness by
     *   the same share it moves the pixel, and Roughen can later put the texture back.
     * - A textured Level blends each pixel towards the levelled height plus the full texture,
     *   so it makes flat, textured ground, and raises the roughness by the same share.
     * - Raise, Lower and the slope tools move the ground and whatever texture it carries alike,
     *   so they leave the roughness as it is.
     * The texture's height is limited near the coast (see #textureAmplitudeAt), so Roughen and
     * Level never move the coastline by laying it; a CURRENT Smooth is held back from the
     * coastline in the same way (see #holdCoast).
     */
    #stampTerrain(stroke, shape, elevationData, roughnessData = null, seaLevel = 0) {
        const { tool, strength } = stroke;
        const { cx, cy, size, coreSize, falloff, minY, rows } = shape;
        const targetIndex = tool === "smooth" ? this.#getStampCentreIndex(cx, cy) : null;
        const usesTexture = roughnessData && (tool === "roughen" || (tool === "level" && BrushEngine.#isCurrent(stroke)));
        const texture = usesTexture ? this.surfaceTexture?.(BrushEngine.#stampArea(shape)) : null;
        const mode = this.#resolveTerrainMode(stroke, targetIndex, texture !== null && texture !== undefined);
        if (mode === TERRAIN_MODE.NONE) return;

        const slopeElevation = this.activeSlopeElevation;
        const levelAmplitude = mode === TERRAIN_MODE.TEXTURED_LEVEL ? this.#textureAmplitudeAt(slopeElevation, seaLevel) : 0;
        const roughenEdge = size * (1 - FILRODENSWMB.GENERATION.SURFACE_TEXTURE.EDGE);
        const means = mode === TERRAIN_MODE.SMOOTH_AVERAGE ? this.#buildLocalMeans(elevationData, shape) : null;
        const smoothStrength = Math.min(1, strength / SMOOTH_FULL_STRENGTH) * SMOOTH_MAX_BLEND;
        const width = this.mapWidth;

        for (let row = 0; row < rows; row++) {
            const y = minY + row;
            const dy = y - cy;
            const rowBase = y * width;
            const meansRow = row * shape.cols - shape.minX;
            const xEnd = this.#spanEnd[row];

            for (let x = this.#spanStart[row]; x <= xEnd; x++) {
                const distance = exactHypot(x - cx, dy);
                if (distance > size) continue;

                const influence = distance > coreSize ? 1 - (distance - coreSize) / falloff : 1;
                const index = rowBase + x;
                const current = elevationData[index];

                switch (mode) {
                    case TERRAIN_MODE.RAISE:
                        elevationData[index] = current + strength * influence;
                        break;
                    case TERRAIN_MODE.LOWER:
                        elevationData[index] = current - strength * influence;
                        break;
                    case TERRAIN_MODE.SMOOTH: {
                        const share = strength * influence * SMOOTH_BLEND_FACTOR;
                        elevationData[index] = current + (elevationData[targetIndex] - current) * share;
                        if (roughnessData) roughnessData[index] = Math.round(roughnessData[index] * (1 - share));
                        break;
                    }
                    case TERRAIN_MODE.SMOOTH_AVERAGE: {
                        const share = smoothStrength * influence;
                        elevationData[index] = BrushEngine.#holdCoast(current, (means[meansRow + x] - current) * share, seaLevel);
                        if (roughnessData) roughnessData[index] = Math.round(roughnessData[index] * (1 - share));
                        break;
                    }
                    case TERRAIN_MODE.SLOPE: {
                        const slopeInfluence = Math.pow(influence, SLOPE_INFLUENCE_POWER);
                        elevationData[index] = current * (1 - slopeInfluence) + slopeElevation * slopeInfluence;
                        break;
                    }
                    case TERRAIN_MODE.TEXTURED_LEVEL: {
                        const levelInfluence = Math.pow(influence, SLOPE_INFLUENCE_POWER);
                        const texturedLevel = slopeElevation + levelAmplitude * texture[index];
                        const roughness = roughnessData[index];
                        elevationData[index] = current * (1 - levelInfluence) + texturedLevel * levelInfluence;
                        roughnessData[index] = Math.round(roughness + (FULL_ROUGHNESS - roughness) * levelInfluence);
                        break;
                    }
                    case TERRAIN_MODE.ROUGHEN: {
                        const target = Math.round(FULL_ROUGHNESS * BrushEngine.#roughenInfluence(distance, size, roughenEdge));
                        const roughness = roughnessData[index];
                        if (target > roughness) {
                            const amplitude = this.#textureAmplitudeAt(current, seaLevel);
                            elevationData[index] = current + ((target - roughness) / FULL_ROUGHNESS) * amplitude * texture[index];
                            roughnessData[index] = target;
                        }
                        break;
                    }
                    default:
                        elevationData[index] = current;
                }
            }
        }
    }

    /**
     * A pixel's elevation after a change, limited so that the change cannot move the coastline:
     * a change towards sea level moves the pixel at most SURFACE_TEXTURE.COAST_SHARE of the way
     * there, the same limit the surface texture keeps to (see #textureAmplitudeAt), so land stays
     * land and sea stays sea however many times a brush passes. A change away from sea level is
     * made in full. Land is ground at or above sea level, as everywhere else.
     *
     * Elevations are stored as 32-bit floats, so ground that repeated passes have brought within
     * rounding distance of sea level could still round onto the other side; such a pixel is left
     * where it is.
     *
     * Without this, smoothing a coast averages land and sea together and pulls the coastline
     * about, which is rarely what smoothing a coast is for.
     *
     * @param {number} current - The pixel's elevation.
     * @param {number} change - The change the brush would make.
     * @param {number} seaLevel - The map's sea level.
     * @returns {number} The pixel's new elevation.
     */
    static #holdCoast(current, change, seaLevel) {
        const isLand = current >= seaLevel;
        const towardsSea = isLand ? change < 0 : change > 0;
        if (!towardsSea) return current + change;

        const limit = FILRODENSWMB.GENERATION.SURFACE_TEXTURE.COAST_SHARE * Math.abs(current - seaLevel);
        const next = current + Math.sign(change) * Math.min(Math.abs(change), limit);
        return Math.fround(next) >= seaLevel === isLand ? next : current;
    }

    /** The pixels a stamp's box covers, as inclusive bounds. */
    static #stampArea(shape) {
        return { minX: shape.minX, maxX: shape.minX + shape.cols - 1, minY: shape.minY, maxY: shape.minY + shape.rows - 1 };
    }

    /**
     * The average elevation around every pixel of a stamp's box, over a square reaching
     * SMOOTH_KERNEL_SHARE of the brush radius each way (clipped at the map's edges), read before
     * the stamp changes anything so the result does not depend on the order pixels are visited.
     * A summed-area table over the box plus that reach gives each average in four lookups.
     *
     * @returns {Float32Array} Averages for the stamp's box, row by row (`shape.cols` per row).
     */
    #buildLocalMeans(elevationData, shape) {
        const reach = Math.max(1, Math.round(shape.size * SMOOTH_KERNEL_SHARE));
        const width = this.mapWidth;
        const left = Math.max(0, shape.minX - reach);
        const top = Math.max(0, shape.minY - reach);
        const right = Math.min(width - 1, shape.minX + shape.cols - 1 + reach);
        const bottom = Math.min(this.mapHeight - 1, shape.minY + shape.rows - 1 + reach);
        const areaWidth = right - left + 2;
        const areaHeight = bottom - top + 2;

        if (this.#summedArea.length < areaWidth * areaHeight) this.#summedArea = new Float64Array(areaWidth * areaHeight);
        if (this.#localMeans.length < shape.cols * shape.rows) this.#localMeans = new Float32Array(shape.cols * shape.rows);
        const summed = this.#summedArea;
        const means = this.#localMeans;

        // summed[(y + 1) * areaWidth + (x + 1)] holds the sum of every elevation above and left of
        // (x, y) inclusive, relative to the area's corner; row and column 0 are zero
        summed.fill(0, 0, areaWidth);
        for (let y = top; y <= bottom; y++) {
            const row = (y - top + 1) * areaWidth;
            summed[row] = 0;
            let rowSum = 0;
            for (let x = left; x <= right; x++) {
                rowSum += elevationData[y * width + x];
                summed[row + x - left + 1] = summed[row - areaWidth + x - left + 1] + rowSum;
            }
        }

        for (let row = 0; row < shape.rows; row++) {
            const y = shape.minY + row;
            const y0 = Math.max(top, y - reach) - top;
            const y1 = Math.min(bottom, y + reach) - top + 1;
            for (let col = 0; col < shape.cols; col++) {
                const x = shape.minX + col;
                const x0 = Math.max(left, x - reach) - left;
                const x1 = Math.min(right, x + reach) - left + 1;
                const total = summed[y1 * areaWidth + x1] - summed[y0 * areaWidth + x1] - summed[y1 * areaWidth + x0] + summed[y0 * areaWidth + x0];
                means[row * shape.cols + col] = total / ((x1 - x0) * (y1 - y0));
            }
        }

        return means;
    }

    /**
     * How much of the surface texture the Roughen brush lays at a distance from its centre: all
     * of it out to `edge`, then easing out to none at the brush's edge (a smooth curve, so the
     * border of a roughened patch shows no ridge or step). Fixed, rather than following the
     * feather setting, so every Roughen stroke gives ground the same texture.
     */
    static #roughenInfluence(distance, size, edge) {
        if (distance <= edge) return 1;
        if (size <= edge) return 0;

        const across = (size - distance) / (size - edge);
        return across * across * (3 - 2 * across);
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
