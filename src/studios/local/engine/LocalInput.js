/**
 * The one parent input of a local map: what the settlement is (its figures from the parent's run
 * or pin) and what its cell says about where it stands (the T0 reading). Everything the town
 * engine knows about the parent comes through here.
 *
 * Fixed by the parent (the local map must agree):
 * - each route through the cell leaves the frame at its bearing (roads drawn as roads; river and
 *   sea routes are the water's traffic, not roads);
 * - a river through the cell enters and leaves the frame at the bearings it enters and leaves the
 *   cell, at about the width its upstream length gives;
 * - the lie of the land: slope, downhill bearing, hill or valley.
 *
 * Free (generated for realism): the river's exact course, the terrain's detail, and lanes towards
 * neighbouring places where the parent has no road (many river towns have only river routes).
 */

import { prepareMap, readContext } from "./CellContext.js";
import { bearingOfVector } from "./Geometry.js";
import { COUNTRY_DENSITY_WITHOUT_RUN, supplyOf, supplyPlanOf, supplyWithoutRun } from "./Supply.js";

/** Settlement tiers read as the engine's three plans. */
const VILLAGE_TIERS = new Set(["village", "largeVillage", "hamlet"]);
const CITY_TIERS = new Set(["capital", "city"]);
/** Below this many people a place is planned as a village, above the second as a city. */
const VILLAGE_MAX = 800;
const CITY_MIN = 8000;

/**
 * @param {object} source
 * @param {string} source.mapSeed
 * @param {{id: string, name: string, tier: string, population: number|null, x: number, y: number}} source.place
 * @param {object} source.context - The T0 reading of the settlement's cell (CellContext.js).
 * @param {{temperature: number, moisture: number}} source.climate - At the pin, 0 to 1.
 * @param {{bearing: number, km: number, tier: string}[]} [source.neighbours] - Other places near it.
 * @param {object} [source.supply] - Its supply plan in brief (Supply.js supplyOf): its own share
 *     of its food, and where the rest comes from.
 * @param {number} [source.countryDensity] - Country people per km² in its cell (the hamlets and
 *     farms round it).
 * @param {number} [source.security] - The parent's security in its cell, 0 to 1 (the generator's
 *     feedback pass); a map with no run gives none, and a fortified place is then taken as
 *     insecure, any other as secure.
 * @param {{name: string, share: number, openness: number, nameBase: string}[]} [source.cultures] -
 *     The place's mix of cultures, each with the name base its people's names are made from.
 * @param {string} [source.biome] - The built-in biome at the pin (a GENERATOR.BIOMES key), as the
 *     parent's biome layer gives it (a custom biome as the built-in one it behaves like).
 * @param {{frameShare?: number, seed?: string}} [source.options]
 */
export function localInput({ mapSeed, place, context, climate, neighbours = [], supply = null, countryDensity = 0, security = null, cultures = null, biome = "GRASSLAND", options = {} }) {
    const population = place.population ?? 1000;
    const kind = planOf(place.tier, population);
    const frameShare = options.frameShare ?? FRAME.SHARE;
    const river = context.rivers.through[0] ?? null;
    return {
        id: place.id,
        name: place.name,
        // The map's seed and the place's id by default, so a place is drawn the same way every
        // time; another seed (the user's, or one picked at random) draws another version of it
        seed: options.seed ?? `${mapSeed}:${place.id}`,
        population,
        tier: place.tier,
        kind,
        walled: kind === "city" || place.tier === "fortifiedTown" || place.tier === "capital",
        capital: place.tier === "capital",
        fortified: place.tier === "fortifiedTown",
        // A port trades by sea or lake: its tier says so, or a water route leaves its cell over the water
        port: !!context.water && (place.tier === "port" || context.routes.some((route) => route.transport === "sea")),
        // A river port has quays on its river: a river route leaves its cell
        riverPort: context.routes.some((route) => route.transport === "river") && context.rivers.through.length > 0,
        // The sea or lake: its side and the stretches of the cell's border it holds
        shore: context.water
            ? {
                  body: context.water.body,
                  side: context.water.side,
                  stretches: context.water.body === "sea" ? (context.sea?.stretches ?? []).map(({ from, to, share }) => ({ from, to, share })) : null,
                  island: context.kind === "island",
              }
            : null,
        roads: context.routes.filter((route) => route.transport === "road").map((route) => ({ bearing: route.bearing, class: route.class })),
        waterRoutes: context.routes.filter((route) => route.transport !== "road").map((route) => ({ bearing: route.bearing, transport: route.transport, class: route.class })),
        river: river
            ? {
                  from: river.from,
                  to: river.to,
                  widthM: river.widthM ?? 10,
                  upstreamKm: river.upstreamKm,
                  rises: river.rises,
                  endsIn: river.endsIn,
              }
            : null,
        otherRivers: context.rivers.through.slice(1).map((other) => ({ from: other.from, to: other.to, widthM: other.widthM })),
        water: context.water,
        kindOfPlace: context.kind,
        relief: { heightM: context.relief.heightM, slopeMPerKm: context.relief.slopeMPerKm, downhill: context.relief.downhill, lie: context.lie },
        climate,
        biome,
        neighbours,
        frame: frameFor(kind, population, frameShare, { coastal: !!context.water && context.kind !== "island" }),
        frameShare,
        ownShare: supply?.ownShare ?? null,
        ownFood: supply ? supply.own : null,
        supply,
        countryDensity,
        security: security ?? (place.tier === "fortifiedTown" || place.tier === "capital" ? SECURITY_FORTIFIED : 1),
        cultures: cultures ?? [{ name: "Local", share: 1, openness: 0.5, nameBase: "English" }],
    };
}

/** The security taken for a fortified place or capital on a map with no run: below the
 * generator's line for walling a town (0.75). */
const SECURITY_FORTIFIED = 0.6;

/**
 * The frame: a fixed shape at one of a few sizes in km, the smallest (from the plan's smallest) in which the settlement as it
 * will be drawn takes no more than FRAME.SHARE of the short side, so a small place is seen with
 * its fields, woods and farms round it and a large one still fits. The drawing's detail is fixed
 * (M_PER_PX), so its size in pixels follows from the frame and a larger frame only shows more land.
 *
 * The settlement's drawn size is estimated before it is built: the built-up area's radius (the
 * 97th centile of its houses' distances from the centre) grows with the square root of its
 * people, by plan (measured on the T1 set: a street village spreads along its roads with its
 * crofts, a market town keeps compact, a walled city is dense inside its wall with its suburbs
 * round it).
 */
export const FRAME = Object.freeze({
    // The largest are for the great cities of 100,000 and more (20 × 15 and 24 × 18 km added for
    // the greatest, so they keep land round them: Ken, 2026-11-16)
    SIZES_KM: Object.freeze([Object.freeze([4, 3]), Object.freeze([6, 4.5]), Object.freeze([8, 6]), Object.freeze([12, 9]), Object.freeze([16, 12]), Object.freeze([20, 15]), Object.freeze([24, 18])]),
    SHARE: 0.4,
    // The smallest size by plan: a market town is seen with the farms of the country round it,
    // which its own fields would otherwise fill the smallest frame without
    SMALLEST: Object.freeze({ village: 0, town: 1, city: 0 }),
    M_PER_PX: 1.25,
    // (V6, Ken 2026-11-17: the plan-first core builds a city at about 0.6 of this estimate, a town at
    // about 0.9; kept, not refitted, so a city's frame is a size larger and shows the country round it)
    // (a village gathers round its green and back lanes since 2026-11-17, on narrower plots: 34 → 24)
    EXTENT_PER_ROOT_PEOPLE: Object.freeze({ village: 24, town: 5.2, city: 6 }),
    COASTAL_SPREAD: Math.SQRT2,
});

/**
 * The settlement's estimated drawn size across (m). By the water it spreads along the shore
 * rather than round its centre, about half a disc, so it reaches COASTAL_SPREAD times as far.
 */
export function drawnExtent(kind, population, { coastal = false } = {}) {
    return 2 * FRAME.EXTENT_PER_ROOT_PEOPLE[kind] * Math.sqrt(population) * (coastal ? FRAME.COASTAL_SPREAD : 1);
}

/** @returns {{width: number, height: number, widthPx: number, heightPx: number}} Metres and pixels. */
export function frameFor(kind, population, share = FRAME.SHARE, options = {}) {
    const extent = drawnExtent(kind, population, options);
    const sizes = FRAME.SIZES_KM.slice(FRAME.SMALLEST[kind] ?? 0);
    const [w, h] = sizes.find(([, height]) => extent <= share * height * 1000) ?? sizes[sizes.length - 1];
    return { width: w * 1000, height: h * 1000, widthPx: Math.round((w * 1000) / FRAME.M_PER_PX), heightPx: Math.round((h * 1000) / FRAME.M_PER_PX) };
}

export function planOf(tier, population) {
    if (VILLAGE_TIERS.has(tier) || population < VILLAGE_MAX) return "village";
    if (CITY_TIERS.has(tier) || population >= CITY_MIN) return "city";
    return "town";
}

// ---------------------------------------------------------------------------------------------
// A settlement source to the engine's input (the prototype's `tools/local-inputs.mjs`)

/**
 * A settlement source: what a parent map holds, as plain data, for the settlements on it (made by
 * the parent's studio; on a Surface map, the World studio's `SettlementSource`):
 * - `mapSeed`, and `map`: width, height, kmPerPx, seaLevel, metresPerUnit, elevation, waterMask,
 *   moisture and temperature (0 to 1) per pixel, displayRaster and displaySites (the display cells),
 *   rivers ({pixelsPerBaseline, rivers: [{id, mergeInto, path: [[x, y, lake]], flow}]}) and routes
 *   ([{id, transport, class, cells}], cells as display cells);
 * - `levels`: the model and in-fill cells ({of, sites, neighbourStart, neighbourList} each);
 * - `places`: every settlement ({id, name, x, y, cell, kind ("town", "castle" or "hand"), tier,
 *   population, infill, mix: [{culture, share}]});
 * - `run`: the run's cells ({sites, people, capacity, landKm2, water, security, culture (culture ids),
 *   trade: {from, to, kind}, kmPerPx}), or null for a map with no run;
 * - `cultures`: the world's ({id, name, colour, openness, nameBase}), and `nameBase`, the world's
 *   fallback name style.
 * A source is worked out once per parent map and kept while it holds: what its settlements share
 * (the cells prepared for reading, the supply plan) is kept with it.
 */

/** Neighbours within this many km are offered as directions for lanes. */
const NEIGHBOUR_KM = 80;
const NEIGHBOURS = 6;

/** Hand-placed pins that are settlements (a lane may lead to them). */
const SETTLEMENT_TIERS = new Set(["capital", "city", "largeTown", "town", "fortifiedTown", "port", "village"]);

/** What a source's settlements share, worked out once per source: its two levels' cells prepared, its supply plan. */
const prepared = new WeakMap();

function preparedOf(source) {
    let entry = prepared.get(source);
    if (!entry) {
        entry = { levels: {}, supply: undefined };
        prepared.set(source, entry);
    }
    return entry;
}

/** A level's cells prepared for reading (once per source and level). */
function levelOf(source, level) {
    const entry = preparedOf(source);
    entry.levels[level] ??= prepareMap(source.map, source.levels[level]);
    return entry.levels[level];
}

/** The source's supply plan (once per source), or null with no run. */
function supplyPlan(source) {
    const entry = preparedOf(source);
    if (entry.supply === undefined) entry.supply = supplyPlanOf(source);
    return entry.supply;
}

/**
 * The cells a settlement is read at: the cells it was made at. A place the run made (on this map or
 * inherited from the parent's run) was placed on a model cell; in-fill places and hand-placed pins
 * are read at the in-fill cell holding them.
 */
export function levelOfPlace(place) {
    return place.kind !== "hand" && !place.infill ? "model" : "infill";
}

/**
 * The engine's input for one of a source's settlements: the reading of its cell, its climate and
 * biome, the places near it, its supply plan and the country round it, its cultures.
 * @param {object} source - A settlement source (above).
 * @param {{id: string, biome?: string}} pin - The settlement: its id, and the built-in biome the
 *     map shows at it (a custom biome as the one it behaves like).
 * @param {{seed?: string, frameShare?: number}} [options] - As localInput's.
 */
export function inputFrom(source, pin, options = {}) {
    const place = source.places.find((p) => p.id === pin?.id);
    if (!place) throw new Error(`no settlement ${pin?.id} on this map`);
    const level = levelOfPlace(place);
    const context = readContext(levelOf(source, level), place, source.levels[level].of[place.cell]);
    const { map } = source;
    const pixel = Math.floor(place.y) * map.width + Math.floor(place.x);
    const climate = { temperature: map.temperature[pixel], moisture: map.moisture[pixel] };
    const neighbours = source.places
        .filter((other) => other.id !== place.id && (other.kind !== "hand" || SETTLEMENT_TIERS.has(other.tier)))
        .map((other) => ({ name: other.name, tier: other.tier, km: Math.hypot(other.x - place.x, other.y - place.y) * map.kmPerPx, bearing: bearingOfVector([other.x - place.x, other.y - place.y]) }))
        .filter((other) => other.km < NEIGHBOUR_KM)
        .sort((a, b) => a.km - b.km)
        .slice(0, NEIGHBOURS);
    // Its supply plan, and the country people per km² round it (its run cell's people less the
    // share in towns, over the cell's land); a map with no run has neither
    let supply;
    let countryDensity;
    let security = null;
    let runCulture = null;
    const plan = supplyPlan(source);
    if (!plan) {
        supply = supplyWithoutRun(place);
        countryDensity = COUNTRY_DENSITY_WITHOUT_RUN;
    } else {
        const { run } = source;
        const index = plan.places.findIndex((p) => p.id === place.id);
        supply = index >= 0 ? supplyOf(plan.prepared, plan.plan, index) : null;
        let nearest = 0;
        let best = Infinity;
        for (let cell = 0; cell < run.people.length; cell++) {
            const d = (run.sites[2 * cell] - place.x) ** 2 + (run.sites[2 * cell + 1] - place.y) ** 2;
            if (d < best) {
                best = d;
                nearest = cell;
            }
        }
        security = run.security ? run.security[nearest] : null;
        runCulture = run.culture ? (run.culture[nearest] ?? null) : null;
        countryDensity = run.landKm2[nearest] > 0 ? (run.people[nearest] * (1 - plan.prepared.urban)) / run.landKm2[nearest] : 0;
    }
    const biome = pin.biome ?? "GRASSLAND";
    return localInput({ mapSeed: source.mapSeed, place, context, climate, neighbours, supply, countryDensity, security, cultures: culturesOf(source, place, runCulture), biome, options });
}

/**
 * The place's mix of cultures (its own, or its cell's main culture in the run), named and with
 * each culture's openness and name base from the world; a single local culture where it has none.
 */
function culturesOf(source, place, runCulture) {
    const known = new Map((source.cultures ?? []).map((c) => [c.id, c]));
    const mix = place.mix?.length ? place.mix : runCulture ? [{ culture: runCulture, share: 1 }] : [];
    // The world's name style where a culture names none (and English where the world has none)
    const fallback = source.nameBase ?? "English";
    const named = mix.filter((m) => known.has(m.culture)).map((m) => ({ name: known.get(m.culture).name, colour: known.get(m.culture).colour, openness: known.get(m.culture).openness ?? 0.5, nameBase: known.get(m.culture).nameBase ?? fallback, share: m.share }));
    if (!named.length) return [{ name: "Local", colour: "#9a8f7a", openness: 0.5, nameBase: fallback, share: 1 }];
    const sum = named.reduce((a, c) => a + c.share, 0);
    return named.map((c) => ({ ...c, share: c.share / sum }));
}
