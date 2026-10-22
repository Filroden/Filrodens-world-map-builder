import { FILRODENSWMB } from "../config.js";
import { cultureId, cultureMix } from "./CultureIds.js";
import { resolveOutput } from "./GeneratorSettings.js";
import { buildPolitical, installPolitical } from "./MaterialiseRegions.js";
import { buildRoutes } from "./MaterialiseRoutes.js";

/**
 * Writes a generator run onto the map as ordinary, editable content: a political layer set
 * (MaterialiseRegions), routes (MaterialiseRoutes), and a pin for every settlement and castle.
 * Everything made carries `generated` details (the run, what it is, its tier, its index in the
 * run, its population, and the edited and locked flags a re-run reads), and nothing the map
 * already holds is changed.
 *
 * Platform-neutral: the studio passes in the localised words and how styles are found and applied
 * (see Generation.js), so this runs and is tested under Node.
 */

/**
 * The pin style tier a place takes: a realm's seat is a capital; a city is a city; a walled or
 * port town shows as such; otherwise a large town or a town; a castle is a castle.
 */
export function placeTier(place) {
    const T = FILRODENSWMB.GENERATOR.PIN_TIERS;
    if (place.kind === "castle") return T.castle;
    if (place.capital) return T.capital;
    if (place.tier === 0) return T.city;
    if (place.fortified) return T.fortifiedTown;
    if (place.port) return T.port;
    return place.tier === 1 ? T.largeTown : T.town;
}

/**
 * @param {import("../mesh/MeshSession.js").MeshSession} session - The open map's session (its mesh and terrain summaries).
 * @param {object} result - A generator run (Pipeline.runGenerator).
 * @param {object} options
 * @param {string} options.runId
 * @param {Function} options.idFactory
 * @param {Array} options.layerSets - The map's layer sets before the run (not changed).
 * @param {object} options.names - { set, levels: [3], titles: { kingdom, duchy, county }, castles: { castle, keep, hold, tower },
 *     formerCapital } (localised; titles, castle names and the former capital's name hold "{name}").
 * @param {number} options.watersPx - The realms' territorial waters, in map pixels.
 * @param {function(string, string): object|null} options.routeStyleFor
 * @param {function(object): object} options.routeStyleFields
 * @param {function(string): object|null} options.pinStyleFor - The pin style of a tier.
 * @param {function(object, object): void} options.applyPinStyle - Writes a style's look onto a pin.
 * @param {function(string): object} [options.regionLabel] - The label look of a political level's
 *     regions by kind (realm, duchy, county).
 * @param {object} [options.output] - What to write (see GeneratorSettings.resolveOutput): the levels
 *     below Realms, the settlement tiers, the kinds of route and whether names are shown.
 * @returns {{set: object, owners: Object<string, string>, routes: object[], pins: object[]}} The
 *     political set and its levels' encoded owners (already installed in the session), the routes
 *     and the pins, for the caller to add to the map.
 */
export function materialise(session, result, options) {
    const { runId, idFactory } = options;
    const output = resolveOutput(options.output);
    const political = buildPolitical(session, result, { runId, idFactory, names: options.names, watersPx: options.watersPx, regionLabel: options.regionLabel, output });
    const owners = installPolitical(session, options.layerSets, political.set, political.owners);
    const routes = buildRoutes(session, result, { runId, idFactory, styleFor: options.routeStyleFor, styleFields: options.routeStyleFields, transports: output.routes });
    const pins = buildPins(session, result, { ...options, output });
    // What the age before the present left: its ruins, abandoned castles and old roads
    if (output.history) {
        pins.push(...buildFormerPins(session, result, options));
        if (output.routes.road !== false) routes.push(...buildRoutes(session, { routes: result.oldRoads ?? [] }, { runId, idFactory, styleFor: (_transport, routeClass) => options.routeStyleFor("old", routeClass), styleFields: options.routeStyleFields, old: true }));
    }
    return { set: political.set, owners, routes, pins };
}

/** The Output switch of each settlement size tier (a place's tier 0, 1 and 2). */
const SIZE_TIERS = Object.freeze(["city", "largeTown", "town"]);

/**
 * Whether a place gets a pin: a capital always; otherwise as its kind or size tier is switched on
 * (castles; cities, large towns and towns by their tier 0, 1 and 2).
 */
function placeWanted(place, places) {
    if (place.capital) return true;
    if (place.kind === "castle") return places.castle !== false;
    return places[SIZE_TIERS[place.tier] ?? "town"] !== false;
}

/**
 * A pin for every place wanted, on its tier's style; only capitals' and cities' labels are shown
 * (none when names are switched off). Each keeps its place's index in the run as its sourceId.
 */
function buildPins(session, result, { runId, idFactory, names, pinStyleFor, applyPinStyle, output }) {
    const { mesh } = session;
    const labelled = new Set(output.labels ? FILRODENSWMB.GENERATOR.LABELLED_TIERS : []);
    const pins = [];
    result.places.forEach((place, index) => {
        if (!placeWanted(place, output.places)) return;
        const tier = placeTier(place);
        // A former capital keeps its own style, and says what it was after its name
        const former = Number.isInteger(place.formerCapital) && output.history;
        const pin = {
            id: idFactory(),
            name: former ? formerCapitalName(placeName(place, names), names) : placeName(place, names),
            description: "",
            icon: FILRODENSWMB.PINS.DEFAULT_ICON,
            x: mesh.siteX(place.cell),
            y: mesh.siteY(place.cell),
            scale: FILRODENSWMB.PINS.DEFAULT_SCALE,
            color: FILRODENSWMB.PINS.DEFAULT_COLOR,
            visibility: "all",
            pinStyle: null,
            label: { fontSize: FILRODENSWMB.PINS.DEFAULT_SCALE },
            cell: place.cell,
            generated: { run: runId, kind: place.kind, tier, sourceId: index, population: place.population ?? null, culture: cultureId(result, place.culture), ...cultureMix(result, place.mix), ...pastOf(place), edited: false, locked: false },
        };
        const style = pinStyleFor(tier);
        if (style) applyPinStyle(pin, style);
        if (!labelled.has(tier)) pin.label.visibility = "none";
        pins.push(pin);
    });
    return pins;
}

/** A place's past, as its generated details keep it (with more than one age): its tier in each age, and when it was last a realm's seat. */
function pastOf(place) {
    const past = {};
    if (Array.isArray(place.ages)) past.ages = place.ages;
    if (Number.isInteger(place.formerCapital)) past.formerCapital = place.formerCapital;
    return past;
}

/** A living former capital's name: its own, with what it was after it ("Brill (former capital)"). */
function formerCapitalName(name, names) {
    return (names.formerCapital ?? "{name}").replaceAll("{name}", name);
}

/** The ruins' style tier of each size tier then (a place's tier 0, 1 and 2). */
const RUINED_TIERS = Object.freeze(["ruinedCity", "ruinedLargeTown", "ruinedTown"]);

/** A ruin's tier: a ruined capital when it was a realm's seat, else by its size then. */
export function ruinTier(ruin) {
    const T = FILRODENSWMB.GENERATOR.PIN_TIERS;
    if (Number.isInteger(ruin.formerCapital)) return T.ruinedCapital;
    return T[RUINED_TIERS[ruin.formerTier] ?? "ruinedTown"];
}

/**
 * A pin for each ruin and abandoned castle the age before the present left, named as its people
 * named it then, each on its ruined tier's style (the tier's own icon in the ruins' colour; see
 * ruinTier). Their labels are hidden, as lesser places' are. Each keeps its index among its kind
 * as its sourceId.
 */
function buildFormerPins(session, result, { runId, idFactory, names, pinStyleFor, applyPinStyle }) {
    const { mesh } = session;
    const T = FILRODENSWMB.GENERATOR.PIN_TIERS;
    const pin = (place, index, kind, tier, name, extra) => {
        const made = {
            id: idFactory(),
            name,
            description: "",
            icon: FILRODENSWMB.PINS.DEFAULT_ICON,
            x: mesh.siteX(place.cell),
            y: mesh.siteY(place.cell),
            scale: FILRODENSWMB.PINS.DEFAULT_SCALE,
            color: FILRODENSWMB.PINS.DEFAULT_COLOR,
            visibility: "all",
            pinStyle: null,
            label: { fontSize: FILRODENSWMB.PINS.DEFAULT_SCALE },
            cell: place.cell,
            generated: { run: runId, kind, tier, sourceId: index, population: null, culture: null, formerAge: place.formerAge, ...extra, edited: false, locked: false },
        };
        const style = pinStyleFor(tier);
        if (style) applyPinStyle(made, style);
        made.label.visibility = "none";
        return made;
    };
    const ruins = (result.ruins ?? []).map((ruin, index) => pin(ruin, index, "ruin", ruinTier(ruin), ruin.name, {
        formerTier: ruin.formerTier,
        formerPopulation: ruin.population,
        ages: ruin.ages,
        ...(Number.isInteger(ruin.formerCapital) ? { formerCapital: ruin.formerCapital } : {}),
    }));
    const castles = (result.abandonedCastles ?? []).map((castle, index) => pin(castle, index, "abandonedCastle", T.abandonedCastle, placeName({ ...castle, kind: "castle" }, names), {}));
    return [...ruins, ...castles];
}

/** A place's name: a town's own, or a castle's name with its kind of keep ("Ashford Keep"). */
function placeName(place, names) {
    if (place.kind !== "castle") return place.name;
    const template = names.castles[place.keep] ?? names.castles.castle;
    return template.replaceAll("{name}", place.name);
}
