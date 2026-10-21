import { FILRODENSWMB } from "../config.js";

/**
 * A run's settings: what the user chooses, made valid and complete. Anything missing or out of
 * range takes its default, so a run always has a full, sensible set and the same settings always
 * resolve to the same values (a run is reproducible from its seed and settings).
 *
 * Saved shape (all optional):
 *   { seed, nameBase, world: { density, urbanisation, realmSpacing, fragmentation },
 *     ages: [{ era, strife }], cultures: [...] }
 * `era` is a preset id (GENERATOR.ERAS) or { development, plague } (shares, 0 to 1); `strife` a
 * preset id (GENERATOR.STRIFES) or a number (0 to 1).
 */

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const isNumber = (value) => typeof value === "number" && Number.isFinite(value);

/** The world settings, each within its range. */
function resolveWorld(world = {}) {
    const resolved = {};
    for (const [key, range] of Object.entries(FILRODENSWMB.GENERATOR.WORLD)) {
        resolved[key] = isNumber(world?.[key]) ? clamp(world[key], range.min, range.max) : range.default;
    }
    return resolved;
}

/** An era: { era (preset id or "custom"), development, plague }. */
export function resolveEra(era) {
    const G = FILRODENSWMB.GENERATOR;
    if (typeof era === "string" && Object.hasOwn(G.ERAS, era)) return { era, ...G.ERAS[era] };
    if (era && isNumber(era.development)) {
        return { era: "custom", development: clamp(era.development, 0, 1), plague: isNumber(era.plague) ? clamp(era.plague, 0, 1) : 0 };
    }
    return { era: G.DEFAULT_ERA, ...G.ERAS[G.DEFAULT_ERA] };
}

/** A strife: { strifeName (preset id or "custom"), strife (0 to 1) }. */
export function resolveStrife(strife) {
    const G = FILRODENSWMB.GENERATOR;
    if (typeof strife === "string" && Object.hasOwn(G.STRIFES, strife)) return { strifeName: strife, strife: G.STRIFES[strife] };
    if (isNumber(strife)) return { strifeName: "custom", strife: clamp(strife, 0, 1) };
    return { strifeName: G.DEFAULT_STRIFE, strife: G.STRIFES[G.DEFAULT_STRIFE] };
}

function resolveAges(ages) {
    const list = Array.isArray(ages) && ages.length ? ages.slice(0, FILRODENSWMB.GENERATOR.MAX_AGES) : [{}];
    return list.map((age) => ({ ...resolveEra(age?.era), ...resolveStrife(age?.strife) }));
}

/**
 * @param {object} [settings] - What the user chose.
 * @param {string} mapSeed - The map's seed, the run's seed unless the user picked another.
 * @returns {{seed: string, nameBase: string, world: object, ages: object[], cultures: object[]}}
 */
export function resolveSettings(settings = {}, mapSeed = "") {
    const seed = typeof settings?.seed === "string" && settings.seed.trim() ? settings.seed.trim() : String(mapSeed);
    const nameBase = typeof settings?.nameBase === "string" && settings.nameBase ? settings.nameBase : FILRODENSWMB.GENERATOR.DEFAULT_NAME_BASE;
    return {
        seed,
        nameBase,
        world: resolveWorld(settings?.world),
        ages: resolveAges(settings?.ages),
        cultures: Array.isArray(settings?.cultures) ? settings.cultures : [],
    };
}

/**
 * What a run writes onto the map (see GENERATOR.OUTPUT): each switch as given, or its default.
 * @param {object} [output]
 * @returns {{duchies: boolean, counties: boolean, places: Object<string, boolean>, routes: Object<string, boolean>, labels: boolean, defaultStyles: boolean|null}}
 */
export function resolveOutput(output = {}) {
    const defaults = FILRODENSWMB.GENERATOR.OUTPUT;
    const flag = (value, fallback) => (typeof value === "boolean" ? value : fallback);
    const flags = (given, fallbacks) => Object.fromEntries(Object.entries(fallbacks).map(([key, fallback]) => [key, flag(given?.[key], fallback)]));
    return {
        duchies: flag(output?.duchies, defaults.duchies),
        // Counties sit below duchies, so there are none without them
        counties: flag(output?.duchies, defaults.duchies) && flag(output?.counties, defaults.counties),
        places: flags(output?.places, defaults.places),
        routes: flags(output?.routes, defaults.routes),
        labels: flag(output?.labels, defaults.labels),
        // Whether the run first sets the styles it uses back to the defaults; null until chosen
        defaultStyles: typeof output?.defaultStyles === "boolean" ? output.defaultStyles : null,
    };
}

/**
 * The Generate panel's settings as a map keeps them: the seed (empty for the map's own), the name
 * style, the world multipliers and the output switches, each valid.
 * @param {object} [settings]
 * @returns {{seed: string, nameBase: string, world: object, output: object}}
 */
export function panelSettings(settings = {}) {
    return {
        seed: typeof settings?.seed === "string" ? settings.seed.trim() : "",
        nameBase: typeof settings?.nameBase === "string" && settings.nameBase ? settings.nameBase : FILRODENSWMB.GENERATOR.DEFAULT_NAME_BASE,
        world: resolveWorld(settings?.world),
        output: resolveOutput(settings?.output),
    };
}
