import { mulberry32 } from "../mesh/MeshBuilder.js";

/**
 * Seeded randomness for the generator. Each stage that needs chance draws from its own source,
 * seeded from the run's seed and the stage's name, so a run is reproducible from its seed and
 * settings, and a change to how much one stage draws never shifts what another stage draws.
 */

/**
 * FNV-1a hash of a string: a 32-bit seed from text such as "P0JBVA:names". Integer operations
 * only, so it gives the same value in every JavaScript engine.
 * @param {string} text
 * @returns {number}
 */
export function hashString(text) {
    let hash = 2166136261;
    for (const character of text) {
        hash ^= character.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

/**
 * The random source of one stage of a run: [0, 1) values seeded by "<seed>:<stage>".
 * @param {string} seed - The run's seed (the map's seed unless the user picked another).
 * @param {string} stage - The stage's name.
 * @returns {function(): number}
 */
export function stageRandom(seed, stage) {
    return mulberry32(hashString(`${seed}:${stage}`));
}
