import { NamesGenerator } from "../../vendor/azgaar-names/names-generator.js";
import { FILRODENSWMB } from "../config.js";
import { stageRandom } from "../generator/Random.js";

/**
 * Names for the map's own items (regions, pins, routes): one suggestion per item, drawn from a
 * stream seeded by the map's seed, the item's id and how many times it has been rerolled. The same
 * three always give the same name, whatever else is on the map and in whatever order items are
 * named, so a suggestion can be reproduced from what the item saves (`nameRoll`).
 *
 * The proper names come from Azgaar's Markov-chain generator and its name bases
 * (vendor/azgaar-names), as the generator's own names do. The words around them ("{name} Coast",
 * "Port {name}") are the interface's, passed in already translated as `descriptor.forms`, so this
 * module holds no language of its own.
 *
 * The generator's names (Names.js) draw from one stream for the whole run and are unchanged by this.
 */

/** One generator for every suggestion: its chains are worked out once per name base and kept. */
const generator = new NamesGenerator(() => 0);

/**
 * The random source of one suggestion.
 * @param {string} mapSeed
 * @param {string} itemId
 * @param {number} roll
 * @returns {function(): number}
 */
export function nameStream(mapSeed, itemId, roll) {
    return stageRandom(String(mapSeed ?? ""), `place:${itemId}:${Math.max(0, Math.floor(roll) || 0)}`);
}

/**
 * A name for one item: a place name, or for a share of rolls (PLACE_NAMES.FORM_SHARE) one with a
 * word that fits the item, when one does: the name set in one of `descriptor.forms` ("{name}
 * Coast", "Port {name}"), or with `descriptor.realm` a realm's form of the name by the name base's
 * own rule (Ashford gives Ashfordia or Ashland; a fantasy base keeps it as it is), as the generator
 * names kingdoms. With `descriptor.short`, a name set in a form is a short one, as features'
 * names are.
 *
 * @param {object} item
 * @param {string} item.mapSeed - The map's seed.
 * @param {string} item.itemId - The item's id.
 * @param {number} [item.roll] - How many times it has been rerolled (0 for the first suggestion).
 * @param {string} [item.nameBase] - A name base's name; an unknown one takes the default.
 * @param {{forms?: string[], realm?: boolean, short?: boolean}|null} [item.descriptor]
 * @returns {string}
 */
export function placeName({ mapSeed, itemId, roll = 0, nameBase, descriptor = null }) {
    generator.rng = nameStream(mapSeed, itemId, roll);
    const base = baseIndex(nameBase);
    const forms = (descriptor?.forms ?? []).filter((form) => typeof form === "string" && form.includes("{name}"));
    const words = forms.length + (descriptor?.realm ? 1 : 0);
    // Drawn first, so whether a word is added never shifts the name drawn after it
    const worded = generator.rng() < FILRODENSWMB.PLACE_NAMES.FORM_SHARE;
    const pick = Math.floor(generator.rng() * Math.max(1, words));
    if (!worded || !words) return generator.getBase(base);
    if (pick >= forms.length) return generator.getState(generator.getBase(base), base);
    const proper = descriptor.short ? generator.getBaseShort(base) : generator.getBase(base);
    return forms[pick].replace("{name}", proper);
}

/** A name base's index: the one named, else the default name style, else the first. */
function baseIndex(nameBase) {
    const index = generator.indexOf(nameBase);
    if (index >= 0) return index;
    return Math.max(0, generator.indexOf(FILRODENSWMB.GENERATOR.DEFAULT_NAME_BASE));
}

/**
 * What kind of land a region is, for its geographic name, from a summary of its land cells:
 * an island first, then mountains, hills, a mostly coastal region, and last its commonest kind of
 * biome (see PLACE_NAMES.GEOGRAPHIC). Null when nothing stands out, or the region has no land.
 *
 * @param {{land: number, coastal: number, island: boolean, mountain: number, hill: number, biomes: Object<string, number>}} summary -
 *     Counts of land cells: in all, beside the sea, in the mountain band, in the highland and upland
 *     bands, and by land kind (PLACE_NAMES.BIOME_KINDS's values).
 * @returns {string|null} A key of PLACE_NAMES.FORMS.
 */
export function landKind({ land = 0, coastal = 0, island = false, mountain = 0, hill = 0, biomes = {} }) {
    if (!(land > 0)) return null;
    const share = FILRODENSWMB.PLACE_NAMES.GEOGRAPHIC;
    if (island && land >= share.MIN_ISLAND_CELLS) return "island";
    if (mountain / land >= share.MOUNTAINS) return "mountains";
    if ((mountain + hill) / land >= share.HILLS) return "hills";
    if (coastal / land >= share.COAST) return "coast";
    let best = null;
    for (const [kind, count] of Object.entries(biomes)) if (count / land >= share.BIOME && (!best || count > biomes[best] || (count === biomes[best] && kind < best))) best = kind;
    return best;
}

/**
 * What kind of place a pin is, for its settlement name: by its style's tier, else the tier the
 * generator gave it, else its icon (see PLACE_NAMES.SETTLEMENT_TIERS and SETTLEMENT_ICONS). Null
 * for a place whose name stands alone (a city, town or village).
 * @param {{icon?: string, generated?: {tier?: string}}} pin
 * @param {string|null} [styleTier]
 * @returns {string|null} A key of PLACE_NAMES.FORMS.
 */
export function settlementKind(pin, styleTier = null) {
    const { SETTLEMENT_TIERS, SETTLEMENT_ICONS } = FILRODENSWMB.PLACE_NAMES;
    const tier = styleTier ?? pin?.generated?.tier ?? null;
    if (tier) return Object.hasOwn(SETTLEMENT_TIERS, tier) ? SETTLEMENT_TIERS[tier] : null;
    return Object.hasOwn(SETTLEMENT_ICONS, pin?.icon ?? "") ? SETTLEMENT_ICONS[pin.icon] : null;
}
