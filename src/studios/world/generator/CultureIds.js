/**
 * How generated content names its cultures: by the map culture's id (see CultureInput), so a
 * culture renamed, reordered or deleted after the run is never mistaken for another. A run's own
 * cultures are counted by index; its result lists each one's id (null for the default culture).
 */

/**
 * The map culture's id of a run's culture (by its index in the run), or null for the default
 * culture (a run with no cultures) and for none.
 */
export function cultureId(result, index) {
    return Number.isInteger(index) ? (result.cultures?.[index]?.id ?? null) : null;
}

/**
 * A culture mix ([[index, share], ...]) as generated details keep it: { mix: [{ culture, share }] }
 * by the map cultures' ids, or nothing for a run with no cultures.
 */
export function cultureMix(result, mix) {
    if (!Array.isArray(mix) || !mix.length) return {};
    const entries = mix.map(([index, share]) => ({ culture: cultureId(result, index), share })).filter((entry) => entry.culture !== null);
    return entries.length ? { mix: entries } : {};
}
