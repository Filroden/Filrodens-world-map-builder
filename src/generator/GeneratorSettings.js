import { FILRODENSWMB } from "../config.js";

/**
 * A run's settings: what the user chooses, made valid and complete. Anything missing or out of
 * range takes its default, so a run always has a full, sensible set and the same settings always
 * resolve to the same values (a run is reproducible from its seed and settings).
 *
 * Saved shape (all optional):
 *   { seed, nameBase, world: { density, urbanisation, realmSpacing, fragmentation },
 *     ages: [{ era, strife, events }], cultures: [...] }
 * `era` is a preset id (GENERATOR.ERAS) or { development, plague } (shares, 0 to 1); `strife` a
 * preset id (GENERATOR.STRIFES) or a number (0 to 1); `events` a list of the age's events (see
 * resolveEvents). An age saved before ages held several events has `event`, one or none, which
 * reads as a list of one.
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

/** Every event kind in the Ages list's order. */
export const EVENT_ORDER = Object.freeze(Object.values(FILRODENSWMB.GENERATOR.EVENTS.GROUPS).flat());
const EVENT_KINDS = new Set(EVENT_ORDER);
const PEOPLES = new Set(FILRODENSWMB.GENERATOR.EVENTS.PEOPLES);
const PLACED = new Set(FILRODENSWMB.GENERATOR.EVENTS.PLACED);

/**
 * One event: { kind, culture } for a peoples event (a map culture's id); { kind, place } for one
 * that may act at a place ({ x, y } on the map, or null for the largest realm or town); { kind }
 * otherwise. Null when it is not a valid event.
 */
export function resolveEvent(event) {
    if (!event || typeof event !== "object" || !EVENT_KINDS.has(event.kind)) return null;
    if (PEOPLES.has(event.kind)) return typeof event.culture === "string" && event.culture ? { kind: event.kind, culture: event.culture } : null;
    if (PLACED.has(event.kind)) {
        const place = event.place && isNumber(event.place.x) && isNumber(event.place.y) ? { x: event.place.x, y: event.place.y } : null;
        return { kind: event.kind, place };
    }
    return { kind: event.kind };
}

/**
 * An age's events: its `events` list, or the single `event` of an age saved before ages held
 * several. Each valid one at most once by kind (the first kept), and a culture in at most one
 * peoples event of the age; in the order they were added. A run acts on them by stage, whatever
 * their order (see AgeEvents).
 * @param {object} [age]
 * @returns {object[]}
 */
export function resolveEvents(age) {
    const given = Array.isArray(age?.events) ? age.events : age?.event ? [age.event] : [];
    const kinds = new Set();
    const peoples = new Set();
    const list = [];
    for (const raw of given) {
        const event = resolveEvent(raw);
        if (!event || kinds.has(event.kind)) continue;
        if (event.culture) {
            if (peoples.has(event.culture)) continue;
            peoples.add(event.culture);
        }
        kinds.add(event.kind);
        list.push(event);
    }
    return list;
}

function resolveAges(ages) {
    const list = Array.isArray(ages) && ages.length ? ages.slice(0, FILRODENSWMB.GENERATOR.MAX_AGES) : [{}];
    return list.map((age) => ({ ...resolveEra(age?.era), ...resolveStrife(age?.strife), events: resolveEvents(age) }));
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
 * @returns {{duchies: boolean, counties: boolean, places: Object<string, boolean>, routes: Object<string, boolean>, labels: boolean, history: boolean, defaultStyles: boolean|null}}
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
        history: flag(output?.history, defaults.history),
        // Whether the run first sets the styles it uses back to the defaults; null until chosen
        defaultStyles: typeof output?.defaultStyles === "boolean" ? output.defaultStyles : null,
    };
}

/** An age's id as the panel keeps it: a short word of letters, digits and dashes. */
const AGE_ID = /^[A-Za-z0-9-]{1,32}$/;

/**
 * The Ages section's ages as a map keeps them, oldest first: each with its id (which the
 * inspector names it by; one given where it has none, or shares another's), an era and a strife
 * preset and its events (see resolveEvents; an older age's single event read as a list of one); at
 * least one, at most MAX_AGES. A run reads no id.
 * @param {object[]} [ages]
 * @returns {{id: string, era: string, strife: string, events: object[]}[]}
 */
export function panelAges(ages) {
    const G = FILRODENSWMB.GENERATOR;
    const list = Array.isArray(ages) && ages.length ? ages.slice(0, G.MAX_AGES) : [{}];
    const taken = new Set();
    const ids = list.map((age) => {
        const id = typeof age?.id === "string" && AGE_ID.test(age.id) && !taken.has(age.id) ? age.id : null;
        if (id) taken.add(id);
        return id;
    });
    let next = 1;
    const freeId = () => {
        while (taken.has(`age-${next}`)) next++;
        taken.add(`age-${next}`);
        return `age-${next}`;
    };
    return list.map((age, index) => ({
        id: ids[index] ?? freeId(),
        era: Object.hasOwn(G.ERAS, age?.era) ? age.era : G.DEFAULT_ERA,
        strife: Object.hasOwn(G.STRIFES, age?.strife) ? age.strife : G.DEFAULT_STRIFE,
        events: resolveEvents(age),
    }));
}

/**
 * The Generate panel's settings as a map keeps them: the seed (empty for the map's own), the name
 * style, the world multipliers, the ages and the output switches, each valid.
 * @param {object} [settings]
 * @returns {{seed: string, nameBase: string, world: object, ages: object[], output: object}}
 */
export function panelSettings(settings = {}) {
    return {
        seed: typeof settings?.seed === "string" ? settings.seed.trim() : "",
        nameBase: typeof settings?.nameBase === "string" && settings.nameBase ? settings.nameBase : FILRODENSWMB.GENERATOR.DEFAULT_NAME_BASE,
        world: resolveWorld(settings?.world),
        ages: panelAges(settings?.ages),
        output: resolveOutput(settings?.output),
    };
}
