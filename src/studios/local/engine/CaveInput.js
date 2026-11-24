/**
 * The cavern settlements' figures the surface engine reads too: the town engine's cave mode
 * (`town/Cave.js`, the plan's carved chambers) is part of every build, so its constants come into
 * the module with the surface engine. The cavern's parent input itself (`caveInput`) comes with
 * L-under, with the underground places, floors and mines.
 */
export const CAVE = Object.freeze({
    /** People per hectare of built floor (houses, lanes, yards), as a city's suburbs. */
    DENSITY: 180,
    /** The plaza, places of worship, pillars and lake as a share more floor. */
    FLOOR_EXTRA: 0.2,
    /**
     * Fungus beds that feed one person for a year (m²): about 3,600 kg a year at some 2,200 kcal
     * a day, from beds yielding about 150 kg a m² (several flushes a year, as in intensive
     * mushroom growing). The ground they take is BED_GROUND times as much, for paths and compost.
     */
    FUNGUS_M2_PER_FED: 25,
    BED_GROUND: 1.5,
    /** Fish ponds take this share of the farmed ground, and feed this many times what beds on
     * the same ground would (the fish are fed on the beds' waste). */
    POND_SHARE: 0.1,
    POND_YIELD: 0.3,
    /** The store a cavern keeps above its people's need, as on the surface. */
    RESERVE: 0.15,
    /** Shares of the food ground the main cavern and the side caverns make room for. */
    FOOD_ON_FLOOR: 0.35,
    SIDE_SHARE: 0.65,
    /**
     * A settlement aims to feed itself, and buys in for variety (and what it cannot grow): this
     * share of its need, rising with its size by the logarithm of its people (BASE at 1,000, PER
     * each tenfold more), within MOST. It buys from its neighbours above and below ground.
     */
    IMPORT: Object.freeze({ BASE: 0.03, PER: 0.12, LEAST: 0.02, MOST: 0.35 }),
    /**
     * The plans a cavern settlement is laid out on: one great chamber with side caverns round it;
     * winding galleries that are its streets, with halls where they meet (as the dwarf-halls of
     * legend); or a chamber with galleries snaking out from it. By plan: the share of the houses
     * in the chamber (the rest along galleries), of the chamber's room for beds, and of the houses
     * cut into the rock.
     */
    PLANS: Object.freeze({
        chamber: Object.freeze({ inChamber: 1, bedsInChamber: 1, rockCut: 0.12 }),
        hybrid: Object.freeze({ inChamber: 0.55, bedsInChamber: 0.6, rockCut: 0.2 }),
        streets: Object.freeze({ inChamber: 0, bedsInChamber: 0, rockCut: 0.4 }),
        // Two great chambers side by side, joined by a broad way, the houses and beds in both
        twin: Object.freeze({ inChamber: 1, bedsInChamber: 1, rockCut: 0.14 }),
    }),
    /** A galleried place's hub: its plaza and great place of worship, for a city of 20,000 (m²),
     * scaled by the square root of the people, and at least HUB_LEAST. */
    HUB_M2: 70000,
    HUB_LEAST: 15000,
    /** Gallery wall each house takes (m, on both sides), and the share of it built along. */
    GALLERY_FRONTAGE: 9,
    GALLERY_FILL: 0.7,
    /** Of a cavern's free floor, this share takes whole bed plots (the rest is edges, gaps and
     * corners too small for one), so caverns are sized for the beds by it. */
    PACKING: 0.65,
    /** A side cavern, smaller and more broken by its pool and edges, packs fewer. */
    SIDE_PACKING: 0.4,
    /** The frame's short side is at least this many times the cavern's width. */
    FRAME_REACH: 2.0,
    /** Half the width of a main way (m), and of the passage to a side cavern. */
    TUNNEL_HALF: 11,
    BRANCH_HALF: 6,
});
