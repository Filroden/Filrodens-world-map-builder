/**
 * The cultures the map's own regions are given (UC phase 2): a realm, duchy or county the run
 * builds round (see Generation.userRegions) may name one culture or several, in the user's order
 * (the first rules), with whole shares (percent) or none. They act in the present age only, as the
 * regions themselves:
 * - the spread seeds each chosen culture in its region, makes others' spread into it dearer by
 *   closedness, and holds given shares there (see Cultures.regionCultures);
 * - a realm, or an independent duchy or county, with cultures is ruled by its first one, whatever
 *   its capital's people (see rulerOf);
 * - the run reports each region whose first culture ended up under half its people (see
 *   minorityReport).
 *
 * The payload names each culture by the world culture's id; the run's cultures are indexed by
 * their place in the age's list, so the ids are read against that list here. A culture the list
 * does not hold (deleted from the world) is ignored.
 */

const LEVELS = ["realms", "duchies", "counties"];

/** Below this share of its region's people, a region's first culture is reported a minority. */
const MINORITY_BELOW = 0.5;

/**
 * Whether the payload's user regions give any region a culture.
 * @param {object|null} userRegions - The payload's `userRegions`.
 */
export function hasRegionCultures(userRegions) {
    return LEVELS.some((level) => (userRegions?.[level] ?? []).some((region) => cleanCultures(region.cultures).length > 0));
}

/**
 * The regions with cultures as the spread reads them (see Cultures.regionCultures): outer first,
 * each its model cells and its cultures by index in the age's `cultures` list. Null with none.
 * @param {object|null} userRegions - The payload's `userRegions`.
 * @param {{id?: string}[]} cultures - The age's cultures, as resolved for the spread.
 */
export function spreadRegions(userRegions, cultures) {
    if (!userRegions) return null;
    const indexOf = indexer(cultures);
    const regions = [];
    for (const level of LEVELS) {
        for (const region of userRegions[level] ?? []) {
            const chosen = byIndex(region.cultures, indexOf);
            if (chosen.length && Array.isArray(region.cells)) regions.push({ cells: region.cells, cultures: chosen });
        }
    }
    return regions.length ? regions : null;
}

/**
 * The ruling culture the map gives a realm (its index in `cultures`), or null when it gives none:
 * a user realm's first culture; for an independent realm (a duchy, or a county, standing alone),
 * its duchy's, else that duchy's one county's.
 * @param {object} realm - The realm as the run built it (`kind`, `user`, `duchies`).
 * @param {object} context
 * @param {object|null} context.userRegions - The payload's `userRegions`.
 * @param {{id?: string}[]} context.cultures - The present age's cultures.
 * @param {object[]} context.duchies - The run's duchies (`user`, `counties`).
 * @param {object[]} context.counties - The run's counties (`user`).
 */
export function rulerOf(realm, { userRegions, cultures, duchies, counties }) {
    if (!userRegions) return null;
    const indexOf = indexer(cultures);
    const first = (level, key) => {
        const region = (userRegions[level] ?? []).find((entry) => entry.key === key);
        return region ? (byIndex(region.cultures, indexOf)[0]?.index ?? null) : null;
    };
    if (realm.user !== undefined) return first("realms", realm.user);
    if (realm.kind !== "independent" || realm.duchies?.length !== 1) return null;
    const duchy = duchies[realm.duchies[0]];
    if (!duchy) return null;
    if (duchy.user !== undefined) return first("duchies", duchy.user);
    if (duchy.counties?.length === 1) {
        const county = counties[duchy.counties[0]];
        if (county?.user !== undefined) return first("counties", county.user);
    }
    return null;
}

/**
 * Each region with cultures whose first culture holds under half its people once the run is done:
 * `{level, key, culture, share}` (`culture` the world culture's id, `share` its share of the
 * region's people). Read from the units the run built round the regions (their `user` key) and
 * their culture mixes. Empty when there are none.
 * @param {object|null} userRegions - The payload's `userRegions`.
 * @param {{id?: string}[]} cultures - The present age's cultures.
 * @param {{realms: object[], duchies: object[], counties: object[]}} units - The run's units, each
 *     with `user` when it stands for a user region.
 * @param {{realms: [number, number][][], duchies: [number, number][][], counties: [number, number][][]}} mixes
 *     - Each unit's culture mix, by unit.
 */
export function minorityReport(userRegions, cultures, units, mixes) {
    if (!userRegions) return [];
    const indexOf = indexer(cultures);
    const out = [];
    for (const level of LEVELS) {
        (userRegions[level] ?? []).forEach((region) => {
            const ruler = byIndex(region.cultures, indexOf)[0];
            if (!ruler) return;
            const unit = units[level].findIndex((entry) => entry.user === region.key);
            if (unit < 0) return;
            const share = (mixes[level][unit] ?? []).find(([culture]) => culture === ruler.index)?.[1] ?? 0;
            if (share < MINORITY_BELOW) out.push({ level: level.slice(0, -1).replace(/ie$/, "y"), key: region.key, culture: cultures[ruler.index].id ?? null, share });
        });
    }
    return out;
}

/** A region's cultures as given, cleaned: a culture id each, no culture twice, shares or none. */
export function cleanCultures(list) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const out = [];
    for (const entry of list) {
        if (typeof entry?.culture !== "string" || seen.has(entry.culture)) continue;
        seen.add(entry.culture);
        out.push({ culture: entry.culture, share: Number.isFinite(entry.share) ? Math.max(0, Math.round(entry.share)) : null });
    }
    // Shares are all given or none
    if (out.some((entry) => entry.share === null)) for (const entry of out) entry.share = null;
    return out;
}

function indexer(cultures) {
    const map = new Map();
    (cultures ?? []).forEach((culture, index) => {
        if (culture?.id && !map.has(culture.id)) map.set(culture.id, index);
    });
    return map;
}

/** A region's cultures by index in the age's list; those the list doesn't hold are left out. */
function byIndex(list, indexOf) {
    return cleanCultures(list)
        .filter((entry) => indexOf.has(entry.culture))
        .map((entry) => ({ index: indexOf.get(entry.culture), share: entry.share }));
}
