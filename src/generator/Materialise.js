import { FILRODENSWMB } from "../config.js";
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
 * @param {object} options.names - { set, levels: [3], titles: { kingdom, duchy, county }, castles: { castle, keep, hold, tower } }
 *     (localised; titles and castle names hold "{name}").
 * @param {number} options.watersPx - The realms' territorial waters, in map pixels.
 * @param {function(string, string): object|null} options.routeStyleFor
 * @param {function(object): object} options.routeStyleFields
 * @param {function(string): object|null} options.pinStyleFor - The pin style of a tier.
 * @param {function(object, object): void} options.applyPinStyle - Writes a style's look onto a pin.
 * @param {function(string): object} [options.regionLabel] - The label look of a political level's
 *     regions by kind (realm, duchy, county).
 * @returns {{set: object, owners: Object<string, string>, routes: object[], pins: object[]}} The
 *     political set and its levels' encoded owners (already installed in the session), the routes
 *     and the pins, for the caller to add to the map.
 */
export function materialise(session, result, options) {
    const { runId, idFactory } = options;
    const political = buildPolitical(session, result, { runId, idFactory, names: options.names, watersPx: options.watersPx, regionLabel: options.regionLabel });
    const owners = installPolitical(session, options.layerSets, political.set, political.owners);
    const routes = buildRoutes(session, result, { runId, idFactory, styleFor: options.routeStyleFor, styleFields: options.routeStyleFields });
    const pins = buildPins(session, result, options);
    return { set: political.set, owners, routes, pins };
}

/** A pin for every place, on its tier's style; only capitals' and cities' labels are shown. */
function buildPins(session, result, { runId, idFactory, names, pinStyleFor, applyPinStyle }) {
    const { mesh } = session;
    const labelled = new Set(FILRODENSWMB.GENERATOR.LABELLED_TIERS);
    return result.places.map((place, index) => {
        const tier = placeTier(place);
        const pin = {
            id: idFactory(),
            name: placeName(place, names),
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
            generated: { run: runId, kind: place.kind, tier, sourceId: index, population: place.population ?? null, culture: place.culture ?? null, edited: false, locked: false },
        };
        const style = pinStyleFor(tier);
        if (style) applyPinStyle(pin, style);
        if (!labelled.has(tier)) pin.label.visibility = "none";
        return pin;
    });
}

/** A place's name: a town's own, or a castle's name with its kind of keep ("Ashford Keep"). */
function placeName(place, names) {
    if (place.kind !== "castle") return place.name;
    const template = names.castles[place.keep] ?? names.castles.castle;
    return template.replaceAll("{name}", place.name);
}
