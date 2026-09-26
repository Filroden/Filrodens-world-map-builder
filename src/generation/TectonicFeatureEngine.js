import { FILRODENSWMB } from "../config.js";
import { FeatureNoise } from "./tectonics/FeatureNoise.js";
import { RangeFeature } from "./tectonics/RangeFeature.js";
import { SubductionFeature } from "./tectonics/SubductionFeature.js";
import { RiftFeature } from "./tectonics/RiftFeature.js";
import { HotspotFeature } from "./tectonics/HotspotFeature.js";

/**
 * Tectonic features: mountain ranges, subduction zones, rifts and hotspot chains drawn as lines
 * (see the classes in ./tectonics). They are the fault types of maps at the current terrain
 * version; a fault saved without a current `revision` keeps the original TectonicEngine maths.
 *
 * Every feature is worked out from the ground as it was before any feature was applied (the base
 * terrain with the brush strokes), never from what another feature has already done to it, and
 * the features' changes are added together. That makes each feature's result:
 *   - independent of the order features are drawn in or applied;
 *   - the same whether the whole map or only part of it is being refreshed, since nothing a
 *     feature reads can be left stale outside the refreshed area;
 *   - reusable: a feature's change only has to be worked out again when its own settings or the
 *     ground beneath it change. Every edit to any fault, river or brush stroke reapplies all the
 *     faults to the whole map, so without this reuse one edit would recompute every feature.
 * The cost is that features do not build on each other (a volcano on a mountain range sits on the
 * range rather than rising to its own summit height above it), which reads naturally since both
 * changes still add up.
 *
 * The reusable results live in a cache object owned by the caller (one per open map), keyed by
 * fault id. An entry is reused when the feature's settings, the map frame and a fingerprint of
 * the ground under the feature's reach all match; entries for faults that no longer exist are
 * dropped on every call.
 */
export class TectonicFeatureEngine {
    static #KINDS = {
        [FILRODENSWMB.TECTONICS.FEATURES.TYPES.RANGE]: RangeFeature,
        [FILRODENSWMB.TECTONICS.FEATURES.TYPES.SUBDUCTION]: SubductionFeature,
        [FILRODENSWMB.TECTONICS.FEATURES.TYPES.RIFT]: RiftFeature,
        [FILRODENSWMB.TECTONICS.FEATURES.TYPES.HOTSPOT]: HotspotFeature,
    };

    /** Fault fields that do not change the terrain, left out of a feature's cache key. */
    static #DISPLAY_FIELDS = new Set(["id", "name", "description", "color", "visibility"]);

    /** Whether a saved fault is a tectonic feature rather than an original fault line. */
    static isFeature(fault) {
        return (fault?.revision ?? 0) >= FILRODENSWMB.TECTONICS.FEATURES.REVISION && Object.hasOwn(TectonicFeatureEngine.#KINDS, fault.type);
    }

    /**
     * Adds every tectonic feature among `faults` to `elevation`.
     *
     * @param {Float32Array} elevation - The terrain to change, in place. Within `bounds` (or the
     *   whole map) it must hold the same values as `ground` when this is called.
     * @param {Float32Array} ground - The whole map's ground before any fault: the base terrain
     *   with every brush stroke. Read anywhere near a feature, so it must be up to date
     *   everywhere, not only within `bounds`. It may be `elevation` itself when that holds the
     *   ground everywhere (every change is worked out before any is added).
     * @param {object[]} faults - The map's faults; only tectonic features are applied.
     * @param {object} options - `width` and `height` (the map's size), `simplex` (the map's noise
     *   generator), `seaLevel`, `frame` ({zoom, originX, originY, rootSize}: the map's place in
     *   its top map and that map's longer side), optional `bounds` (only pixels inside change)
     *   and `cache` (an object kept between calls for the same map, see above).
     */
    static apply(elevation, ground, faults, options) {
        const features = (faults ?? []).filter((fault) => TectonicFeatureEngine.isFeature(fault) && fault.points?.length >= 2);
        const cache = options.cache ?? null;
        if (cache) TectonicFeatureEngine.#pruneCache(cache, features);
        if (features.length === 0) return;

        const context = {
            ground,
            width: options.width,
            height: options.height,
            seaLevel: options.seaLevel,
            noise: new FeatureNoise(options.simplex, options.frame),
        };
        const frameKey = JSON.stringify([options.seaLevel, options.frame]);

        // Every change is worked out before any is added, so `ground` may be `elevation` itself
        const deltas = features.map((fault) => TectonicFeatureEngine.#deltaFor(fault, context, frameKey, cache));
        for (const delta of deltas) delta?.addTo(elevation, options.width, options.bounds ?? null);
    }

    /** Whether `type` is one of the tectonic feature types. */
    static isFeatureType(type) {
        return Object.hasOwn(TectonicFeatureEngine.#KINDS, type);
    }

    /**
     * How far a fault can change the terrain from its line, in map pixels: a tectonic feature's
     * reach, or an original fault's thickness.
     */
    static reachOf(fault) {
        const thickness = fault.thickness || FILRODENSWMB.TECTONICS.DEFAULT_THICKNESS;
        if (!TectonicFeatureEngine.isFeature(fault)) return thickness;
        return thickness * (FILRODENSWMB.TECTONICS.FEATURES.REACH[fault.type] ?? 1);
    }

    /**
     * The fault types to offer: the tectonic features on a map at the current terrain version,
     * the original types on an older one. An existing fault of an original type on a current map
     * (one copied onto a regional map cut from an older map) keeps its own type in the list, so
     * editing it does not force it to change.
     *
     * @param {boolean} currentMap - Whether the map is at the current terrain version.
     * @param {string|null} [existingType] - The type of the fault being edited, if any.
     * @returns {{id: string, label: string}[]}
     */
    static typeOptions(currentMap, existingType = null) {
        const labels = currentMap ? FILRODENSWMB.TECTONICS.FEATURES.LABELS : FILRODENSWMB.TECTONICS.LABELS;
        const options = Object.entries(labels).map(([id, label]) => ({ id, label }));
        const legacyLabel = FILRODENSWMB.TECTONICS.LABELS[existingType];
        if (currentMap && legacyLabel && !TectonicFeatureEngine.isFeatureType(existingType)) options.push({ id: existingType, label: legacyLabel });
        return options;
    }

    /** The colour a fault of `type` is drawn in. */
    static colorOf(type) {
        return FILRODENSWMB.TECTONICS.FEATURES.COLORS[type] ?? FILRODENSWMB.TECTONICS.COLORS[type] ?? DEFAULT_COLOR;
    }

    /**
     * The tectonic feature an original fault becomes when its map is updated to the current
     * terrain version, or null for a type with no equivalent (slip faults, which are removed).
     *
     * The feature keeps the fault's id, name, description, visibility and line. An original
     * hotspot chain shrinks from its first point, so its first point is its youngest volcano;
     * a feature chain is drawn from its oldest, so the points are reversed.
     *
     * @param {object} fault - An original fault.
     * @returns {object|null} A new fault object, or null.
     */
    static convertLegacyFault(fault) {
        const conversion = FILRODENSWMB.TECTONICS.FEATURES.CONVERSION[fault.type];
        if (!conversion) return null;
        const points = (fault.points ?? []).map((point) => ({ ...point }));
        return {
            ...fault,
            type: conversion.type,
            revision: FILRODENSWMB.TECTONICS.FEATURES.REVISION,
            thickness: (fault.thickness || FILRODENSWMB.TECTONICS.DEFAULT_THICKNESS) * conversion.thicknessScale,
            color: TectonicFeatureEngine.colorOf(conversion.type),
            points: conversion.reverse ? points.reverse() : points,
        };
    }

    /**
     * The feature's change to the ground: reused from the cache when nothing it depends on has
     * changed, worked out afresh (and cached) otherwise. Null when it changes nothing.
     */
    static #deltaFor(fault, context, frameKey, cache) {
        const kind = TectonicFeatureEngine.#KINDS[fault.type];
        const shaped = TectonicFeatureEngine.#directed(fault);
        const plan = kind.plan(shaped, context);
        if (!plan) return null;

        const settingsKey = JSON.stringify(fault, (key, value) => (TectonicFeatureEngine.#DISPLAY_FIELDS.has(key) ? undefined : value)) + frameKey;
        const groundKey = TectonicFeatureEngine.#fingerprint(context.ground, context.width, plan.bounds);
        const cached = cache?.[fault.id];
        if (cached && cached.settingsKey === settingsKey && cached.groundKey === groundKey) return cached.delta;

        const delta = kind.render(plan, shaped, context);
        if (cache && fault.id) cache[fault.id] = { settingsKey, groundKey, delta };
        return delta;
    }

    /**
     * The fault with its points in the direction the feature is laid out in.
     *
     * A feature's direction decides which side a subduction zone's volcanoes rise on (the side
     * anticlockwise from the direction of travel) and which end of a hotspot chain is youngest
     * (the last). `reversed` turns that direction round without changing the points as drawn,
     * so it is a setting of the feature (on or off) rather than an action applied to its line.
     */
    static #directed(fault) {
        return fault.reversed ? { ...fault, points: [...fault.points].reverse() } : fault;
    }

    /** A fault's points in the direction its feature is laid out in (see #directed). */
    static directedPoints(fault) {
        return TectonicFeatureEngine.#directed(fault).points;
    }

    static #pruneCache(cache, features) {
        const live = new Set(features.map((fault) => fault.id));
        for (const id of Object.keys(cache)) {
            if (!live.has(id)) delete cache[id];
        }
    }

    /**
     * FNV-1a over the raw bits of the ground within `bounds`, so any change to the ground a
     * feature stands on (a brush stroke, a regenerated base terrain) makes it be worked out again.
     */
    static #fingerprint(ground, width, bounds) {
        const bits = new Uint32Array(ground.buffer, ground.byteOffset, ground.length);
        let hash = FNV_OFFSET;
        for (let y = bounds.minY; y <= bounds.maxY; y++) {
            const end = y * width + bounds.maxX;
            for (let i = y * width + bounds.minX; i <= end; i++) hash = Math.imul(hash ^ bits[i], FNV_PRIME);
        }
        return `${bounds.minX},${bounds.minY},${bounds.maxX},${bounds.maxY}:${hash >>> 0}`;
    }
}

const DEFAULT_COLOR = "#ffffff";
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
