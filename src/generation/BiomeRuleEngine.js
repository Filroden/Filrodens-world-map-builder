import { FILRODENSWMB } from "../config.js";

/**
 * Compiles user-defined custom biome rules into a flat, allocation-free structure and
 * matches individual pixels against them during procedural generation.
 *
 * A custom biome's rule set is a list of ROWS, evaluated first-match-wins in the biome's
 * own (user-reorderable) priority order. Each row constrains all three climate axes -
 * elevation, moisture, temperature - but each axis holds a LIST of one or more ranges
 * ("segments"): a pixel satisfies a row if it falls inside at least one segment on EVERY
 * axis (segments within an axis are OR'd together, the three axes are AND'd). A biome
 * matches a pixel if ANY of its rows match. Biomes themselves are evaluated in their
 * stored array order (index 0 = highest priority), so the very first matching row, in the
 * first matching biome, wins. Segment ranges are plain numbers already resolved to their
 * true boundary (0/1, or wherever a handle was dragged) - there is no separate "open ended"
 * state to interpret here, that distinction only matters to the rule editor UI.
 *
 * Defaults are NOT represented here - ProceduralEngine.getBiomeKey remains the guaranteed
 * fallback for any pixel no custom rule claims, so total climate-space coverage is
 * unaffected by whatever custom rules do or don't exist (see custom-biomes-v2.3-scoping.md).
 *
 * createBiomesMap() runs the matcher below for every pixel in the generated buffer, so the
 * compiled form is a set of flat typed arrays (struct-of-arrays) built ONCE per generation
 * from the nested biome/row/segment objects the rule editor UI works with, rather than
 * walking those nested objects again for every pixel.
 */

/**
 * @typedef {[number, number, boolean, boolean]} RuleSegment
 * A single range on one axis: [min, max, openMin, openMax]. openMin/openMax record
 * whether that end was dragged to the true edge of the axis (0 or 1) purely so the rule
 * editor UI can style it - matching itself only ever needs min/max, since an "open" end
 * already stores the real boundary value there.
 *
 * @typedef {{elevation: RuleSegment[], moisture: RuleSegment[], temperature: RuleSegment[]}} RuleRow
 *
 * @typedef {{id: number, rules: RuleRow[]}} CustomBiome
 */

const SEGMENT_STRIDE = 2; // each segment occupies [min, max] in the flat segment arrays

export class BiomeRuleEngine {
    /**
     * Flattens an array of custom biomes (already in priority order) into the compiled
     * form matchBiomeId() evaluates per pixel. Call this once per generation - e.g. from
     * MapStateManager.getDerivedMapParameters, alongside its other once-per-generation
     * compilation work - never per pixel.
     * @param {CustomBiome[]} customBiomes
     * @returns {object} Compiled rule set (opaque to callers other than matchBiomeId()).
     */
    static compile(customBiomes = []) {
        const working = BiomeRuleEngine.#buildWorkingArrays(customBiomes);
        return BiomeRuleEngine.#toTypedArrays(working);
    }

    /**
     * Returns the id of the first custom biome whose rules match this pixel, or 0 if none
     * do. 0 is the same "no override" sentinel already used elsewhere (e.g. the biome
     * override raster) - callers can fall through to ProceduralEngine.getBiomeKey()
     * whenever this returns 0, no separate "was there a match" check needed.
     * @param {object} compiled Result of compile().
     */
    static matchBiomeId(compiled, elevation, moisture, temperature) {
        for (let row = 0; row < compiled.rowCount; row++) {
            if (!BiomeRuleEngine.#axisMatches(compiled.elevSegments, compiled.rowElevStart[row], compiled.rowElevCount[row], elevation)) continue;
            if (!BiomeRuleEngine.#axisMatches(compiled.moistSegments, compiled.rowMoistStart[row], compiled.rowMoistCount[row], moisture)) continue;
            if (!BiomeRuleEngine.#axisMatches(compiled.tempSegments, compiled.rowTempStart[row], compiled.rowTempCount[row], temperature)) continue;
            return compiled.rowBiomeId[row];
        }
        return 0;
    }

    /**
     * Builds the working (plain-array) form of the compiled rule set by walking every
     * biome's rows in priority order. Kept separate from #toTypedArrays() because the
     * final length of each flat array isn't known until every row has been appended.
     */
    static #buildWorkingArrays(customBiomes) {
        const working = {
            rowCount: 0,
            rowBiomeId: [],
            rowElevStart: [],
            rowElevCount: [],
            rowMoistStart: [],
            rowMoistCount: [],
            rowTempStart: [],
            rowTempCount: [],
            elevSegments: [],
            moistSegments: [],
            tempSegments: [],
        };

        for (const biome of customBiomes) {
            for (const row of biome.rules ?? []) {
                BiomeRuleEngine.#appendRow(working, biome.id, row);
            }
        }

        return working;
    }

    /** Appends one rule row's three axes to the working arrays. */
    static #appendRow(working, biomeId, row) {
        working.rowBiomeId.push(biomeId);

        const elevation = BiomeRuleEngine.#appendAxisSegments(working.elevSegments, row.elevation);
        working.rowElevStart.push(elevation.start);
        working.rowElevCount.push(elevation.count);

        const moisture = BiomeRuleEngine.#appendAxisSegments(working.moistSegments, row.moisture);
        working.rowMoistStart.push(moisture.start);
        working.rowMoistCount.push(moisture.count);

        const temperature = BiomeRuleEngine.#appendAxisSegments(working.tempSegments, row.temperature);
        working.rowTempStart.push(temperature.start);
        working.rowTempCount.push(temperature.count);

        working.rowCount += 1;
    }

    /**
     * Appends one axis's segments (a list of [min, max, openMin, openMax] tuples) onto the
     * shared flat segment list for that axis, recording where they landed.
     */
    static #appendAxisSegments(segmentList, segments = []) {
        const start = segmentList.length;
        for (const [min, max] of segments) {
            segmentList.push(min, max);
        }
        return { start, count: segments.length };
    }

    /** Converts the working plain-array structure into typed arrays for the per-pixel hot path. */
    static #toTypedArrays(working) {
        return {
            rowCount: working.rowCount,
            rowBiomeId: Int32Array.from(working.rowBiomeId),
            rowElevStart: Int32Array.from(working.rowElevStart),
            rowElevCount: Int32Array.from(working.rowElevCount),
            rowMoistStart: Int32Array.from(working.rowMoistStart),
            rowMoistCount: Int32Array.from(working.rowMoistCount),
            rowTempStart: Int32Array.from(working.rowTempStart),
            rowTempCount: Int32Array.from(working.rowTempCount),
            elevSegments: Float32Array.from(working.elevSegments),
            moistSegments: Float32Array.from(working.moistSegments),
            tempSegments: Float32Array.from(working.tempSegments),
        };
    }

    /** True if `value` falls within any of the `count` [min, max] segments starting at `start`. */
    static #axisMatches(segments, start, count, value) {
        const end = start + count * SEGMENT_STRIDE;
        for (let i = start; i < end; i += SEGMENT_STRIDE) {
            if (value >= segments[i] && value <= segments[i + 1]) return true;
        }
        return false;
    }

    /**
     * Builds a read-only reference table describing the 13 built-in biomes' coverage in the
     * exact same {elevation, moisture, temperature} row/segment shape a custom biome's own
     * `rules` use - for the Rule Editor's "Default biomes" section only. This is NEVER
     * consulted for actual pixel matching (ProceduralEngine.getBiomeKey / resolveBiomeLookup
     * don't call it and are completely unaffected by it); it exists purely so the Rule Editor
     * can show a GM where their custom ranges sit relative to the defaults.
     *
     * Every value here is read live from FILRODENSWMB.CLIMATE and the map's current sea
     * level, mirroring getBiomeKey()'s branches one-for-one (ocean split via
     * #getOceanBiome, then the four temperature bands and their moisture cutoffs via
     * #get*Biome) rather than hand-copied numbers, so this table can never drift from what
     * getBiomeKey actually does. If getBiomeKey's branches or FILRODENSWMB.CLIMATE.THRESHOLDS
     * ever change, update this alongside it. Note this intentionally reads the same fixed
     * FILRODENSWMB.CLIMATE.FREEZING_THRESHOLD constant #getOceanBiome itself reads, not the
     * map's adjustable "Freezing Threshold" setting (state.freezingThreshold /
     * params.climate.freezingThreshold) - getBiomeKey doesn't currently receive that setting
     * either, so matching its actual behaviour here means matching that same constant.
     * @param {number} seaLevel - The map's current sea level (app.uiState.seaLevel).
     * @returns {Array<{key: string, color: number[], rows: RuleRow[]}>} One entry per
     *   built-in biome, keyed the same way as FILRODENSWMB.BIOMES, in a stable cold-to-hot
     *   display order (oceans first).
     */
    static getDefaultBiomeReferenceRows(seaLevel) {
        const temperatureLimits = FILRODENSWMB.CLIMATE.THRESHOLDS.TEMPERATURE;
        const moistureLimits = FILRODENSWMB.CLIMATE.THRESHOLDS.MOISTURE;
        const freezingThreshold = FILRODENSWMB.CLIMATE.FREEZING_THRESHOLD;

        // A segment's openMin/openMax are purely a "does this touch the true 0/1 edge of the
        // axis" styling hint (see the RuleSegment typedef above) - safe to derive from the
        // plain min/max here rather than tracking it by hand for every branch below.
        const segment = (min, max) => [min, max, min <= 0, max >= 1];
        const land = [seaLevel, 1, seaLevel <= 0, true];

        // Mirrors getBiomeKey's #getArcticBiome/#getSubArcticBiome/#getTemperateBiome/
        // #getTropicalBiome branches exactly, one temperature band per entry and one moisture
        // cutoff per biome within that band, in the same order those methods check them.
        const temperatureBands = [
            { temperature: segment(0, temperatureLimits.ARCTIC), cutoffs: [["TUNDRA", 0, moistureLimits.ARCTIC.SNOW], ["SNOW", moistureLimits.ARCTIC.SNOW, 1]] },
            { temperature: segment(temperatureLimits.ARCTIC, temperatureLimits.SUBARCTIC), cutoffs: [["TUNDRA", 0, moistureLimits.SUBARCTIC.TUNDRA], ["TAIGA", moistureLimits.SUBARCTIC.TUNDRA, moistureLimits.SUBARCTIC.TAIGA], ["SNOW", moistureLimits.SUBARCTIC.TAIGA, 1]] },
            { temperature: segment(temperatureLimits.SUBARCTIC, temperatureLimits.TEMPERATE), cutoffs: [["TEMPERATE_DESERT", 0, moistureLimits.TEMPERATE.DESERT], ["GRASSLAND", moistureLimits.TEMPERATE.DESERT, moistureLimits.TEMPERATE.GRASSLAND], ["DECIDUOUS_FOREST", moistureLimits.TEMPERATE.GRASSLAND, moistureLimits.TEMPERATE.DECIDUOUS], ["TEMPERATE_RAINFOREST", moistureLimits.TEMPERATE.DECIDUOUS, 1]] },
            { temperature: segment(temperatureLimits.TEMPERATE, 1), cutoffs: [["SUBTROPICAL_DESERT", 0, moistureLimits.TROPICAL.DESERT], ["SAVANNA", moistureLimits.TROPICAL.DESERT, moistureLimits.TROPICAL.SAVANNA], ["DECIDUOUS_FOREST", moistureLimits.TROPICAL.SAVANNA, moistureLimits.TROPICAL.DECIDUOUS], ["TROPICAL_RAINFOREST", moistureLimits.TROPICAL.DECIDUOUS, 1]] },
        ];

        const rowsByKey = new Map();
        const addRow = (key, row) => {
            if (!rowsByKey.has(key)) rowsByKey.set(key, []);
            rowsByKey.get(key).push(row);
        };

        for (const band of temperatureBands) {
            for (const [key, moistMin, moistMax] of band.cutoffs) {
                addRow(key, { elevation: [land], moisture: [segment(moistMin, moistMax)], temperature: [band.temperature] });
            }
        }

        // Ocean branch - see #getOceanBiome. These elevation ranges are relative to the
        // current map's sea level (not fixed constants), since #getOceanBiome computes depth
        // as a fraction of seaLevel itself.
        addRow("PACK_ICE", { elevation: [segment(0, seaLevel)], moisture: [segment(0, 1)], temperature: [segment(0, freezingThreshold)] });
        addRow("DEEP_OCEAN", { elevation: [segment(0, seaLevel * 0.5)], moisture: [segment(0, 1)], temperature: [segment(freezingThreshold, 1)] });
        addRow("SHALLOW_OCEAN", { elevation: [segment(seaLevel * 0.5, seaLevel)], moisture: [segment(0, 1)], temperature: [segment(freezingThreshold, 1)] });

        // Stable display order: oceans first, then the same cold-to-hot progression
        // getBiomeKey itself branches through.
        const displayOrder = [
            "PACK_ICE", "DEEP_OCEAN", "SHALLOW_OCEAN",
            "TUNDRA", "SNOW", "TAIGA",
            "TEMPERATE_DESERT", "GRASSLAND", "DECIDUOUS_FOREST", "TEMPERATE_RAINFOREST",
            "SUBTROPICAL_DESERT", "SAVANNA", "TROPICAL_RAINFOREST",
        ];

        return displayOrder.map((key) => ({
            key,
            color: FILRODENSWMB.BIOMES[key],
            rows: rowsByKey.get(key) || [],
        }));
    }
}
