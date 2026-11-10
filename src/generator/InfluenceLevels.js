import { FILRODENSWMB } from "../config.js";

/**
 * The generator's reading of the influences painted on a map (see the mesh's Influences): each
 * pixel's value for a kind, from -MAX_LEVEL to MAX_LEVEL (0 for none), as the payload carries them
 * (see GeneratorInput). A value stands for a relative intention ("more fertile here", "safer
 * here"), never an absolute figure, so it keeps its meaning whatever the terrain, cultures or
 * ages: a value v (as a share of MAX_LEVEL) is the factor INFLUENCES.MAX_FACTOR to the power v.
 *
 * Nothing here touches the DOM or Foundry, so it runs in the worker and in Node.
 */

const INFLUENCES = FILRODENSWMB.GENERATOR.INFLUENCES;

/** The largest value either way. */
export const MAX_LEVEL = INFLUENCES.LEVELS;

/**
 * The factor of each value, indexed by value + MAX_LEVEL (so index MAX_LEVEL, value 0, is exactly 1).
 * @returns {Float64Array}
 */
export function levelFactors() {
    return Float64Array.from({ length: 2 * MAX_LEVEL + 1 }, (_, index) => (index === MAX_LEVEL ? 1 : INFLUENCES.MAX_FACTOR ** ((index - MAX_LEVEL) / MAX_LEVEL)));
}

/**
 * A kind's values from a payload, when they are usable: one per pixel of the map. Anything else
 * (absent, the wrong length, not a typed array) is no influence, so a damaged payload gives the
 * run without it rather than reading past the map.
 * @param {object} input - The payload (or the cells' input built from it).
 * @param {string} kind - One of INFLUENCES.KINDS.
 * @returns {Int8Array|null}
 */
export function influenceLevels(input, kind) {
    const levels = input.influences?.[kind];
    return levels instanceof Int8Array && levels.length === input.width * input.height ? levels : null;
}

/** A value kept within the range, for a pixel whose value came from outside the module. */
export function clampLevel(level) {
    return Math.max(-MAX_LEVEL, Math.min(MAX_LEVEL, level | 0));
}
