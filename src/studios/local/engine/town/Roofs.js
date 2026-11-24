// What each building is roofed with (pre-sign-off, Ken, 2026-11-17): not the culture of its
// household, which is a thematic view the renderer can add, but the place and the spot. Villages
// and small towns roof in straw and tile; towns in tile and slate, with straw out in the country;
// a city's middle in slate and tile. Each roof is drawn by chance from shares that change smoothly
// from the middle of the place out to the country, so streets mix their roofs rather than
// falling into styled quarters; the great houses and the upper tier lean to slate.
import { centroid, dist, makeNoise } from "../Geometry.js";

/** Roofing materials, as the renderer's styles name them. */
export const ROOF_MATERIALS = Object.freeze(["thatch", "tile", "slate"]);

/**
 * Shares of thatch and slate (the rest tile) at the middle of a place and out in its country, by
 * the kind of place. A town under SMALL_TOWN people roofs as a village does at its middle.
 */
export const ROOFS = Object.freeze({
    village: Object.freeze({ middle: { thatch: 0.45, slate: 0.02 }, country: { thatch: 0.7, slate: 0.02 } }),
    smallTown: Object.freeze({ middle: { thatch: 0.25, slate: 0.08 }, country: { thatch: 0.55, slate: 0.05 } }),
    town: Object.freeze({ middle: { thatch: 0.04, slate: 0.34 }, country: { thatch: 0.4, slate: 0.1 } }),
    city: Object.freeze({ middle: { thatch: 0, slate: 0.5 }, country: { thatch: 0.3, slate: 0.15 } }),
    SMALL_TOWN: 2500,
    /** The upper tier and the great houses: more slate (a share added), no thatch. */
    UPPER_SLATE: 0.3,
    /** How far beyond the built middle (m, and a share of its radius) the country's shares are reached. */
    COUNTRY_M: 250,
    COUNTRY_SHARE: 0.6,
    /** Neighbouring roofs lean together a little: a stretch's shares of straw and slate move by up to
     * this share, by a smooth noise (m across). */
    NEIGHBOURS: 0.35,
    NEIGHBOUR_M: 70,
});

/** Buildings that take a roofing material (barns, warehouses and the landmarks keep their own). */
const ROOFED = new Set(["house", "farmhouse", "range", "inn", "hall", "workshop", "stable", "shed"]);

/** Gives each roofed building of a surface place its `roof`: "thatch", "tile" or "slate". */
export function chooseRoofs(T) {
    if (T.input.cave) return;
    const pop = T.input.population;
    const shares = T.kind === "village" ? ROOFS.village : T.kind === "city" ? ROOFS.city : pop < ROOFS.SMALL_TOWN ? ROOFS.smallTown : ROOFS.town;
    const radius = T.coreRadius ?? Math.sqrt(pop) * 3;
    const reach = ROOFS.COUNTRY_M + radius * ROOFS.COUNTRY_SHARE;
    const noise = makeNoise(`${T.input.seed}:roofs`);
    const random = T.R("roofs");
    const own = new Array(T.buildings.length).fill(null);
    T.buildings.forEach((b, k) => {
        if (!ROOFED.has(b.kind) || b.rockCut || b.hollow) return;
        // A range is roofed as its house is
        if (b.kind === "range" && Number.isInteger(b.house) && !b.estate) return;
        const c = centroid(b.poly);
        const beyond = Math.max(0, dist(c, T.centre) - radius);
        const out = b.kind === "farmhouse" ? 1 : Math.min(1, beyond / reach);
        let thatch = shares.middle.thatch + (shares.country.thatch - shares.middle.thatch) * out;
        let slate = shares.middle.slate + (shares.country.slate - shares.middle.slate) * out;
        if (b.tier === "upper" || b.estate) {
            slate = Math.min(1, slate + ROOFS.UPPER_SLATE);
            thatch = 0;
        }
        // (a stretch leans a little to straw or to slate)
        const lean = (noise.value(c[0] / ROOFS.NEIGHBOUR_M, c[1] / ROOFS.NEIGHBOUR_M) - 0.5) * 2 * ROOFS.NEIGHBOURS;
        thatch = Math.min(1, thatch * (1 + lean));
        slate = Math.min(1 - thatch, slate * (1 - lean));
        const r = random.next();
        own[k] = b.roof = r < thatch ? "thatch" : r > 1 - slate ? "slate" : "tile";
    });
    for (const b of T.buildings) if (b.kind === "range" && !b.roof && Number.isInteger(b.house)) b.roof = own[b.house] ?? T.buildings[b.house]?.roof ?? "tile";
}
