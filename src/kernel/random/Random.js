/**
 * Seeded randomness, shared by every studio (the kernel): mulberry32, the one seeded source every
 * engine uses, and the generator's stages. Each stage that needs chance draws from its own source,
 * seeded from the run's seed and the stage's name, so a run is reproducible from its seed and
 * settings, and a change to how much one stage draws never shifts what another stage draws.
 */

/**
 * mulberry32: a small, fast, seeded generator of [0, 1) built only from 32-bit integer operations,
 * so it gives the same sequence in every engine.
 * @param {number} seed
 * @returns {function(): number}
 */
export function mulberry32(seed) {
    let state = seed | 0;
    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

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
