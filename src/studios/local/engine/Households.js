/**
 * Who lives where: a household for every house in the drawn place, and for every farmhouse in its
 * country, worked out from a few figures so that the whole adds up.
 *
 * - **People per house:** the place's people shared among its houses by floor area (footprint by
 *   storeys, softened), rounded so the houses hold exactly its population; the country people (as
 *   many as the fields were drawn for) likewise among the farmhouses.
 * - **Trades:** those the place's role in its supply calls for are counted from it (carters from
 *   the grain carted to and through it, boatmen from what comes by river, mariners, porters and
 *   shipwrights from what comes by sea, millers from the people to be fed, corn dealers from what
 *   passes through its market, chapmen from the country selling at it); the rest follow a table by
 *   kind of place. Each trade takes the houses that suit it best (the water, the market, the
 *   gates, the place of worship, the edge).
 * - **Wealth:** by trade, house size, nearness to the market, front or back, inside or outside the
 *   walls; ranked into poor, modest, middling, prosperous and wealthy.
 * - **Cultures:** quotas by the place's mix, in quarters: each minority takes the houses highest on
 *   its own smooth field, so a closed culture clusters and an open one scatters.
 * - **Members:** a head (a man or a woman, by the culture's Household heads setting), a spouse for
 *   most, servants and apprentices by wealth, children spaced as births are, an old parent now and
 *   then, then grown children, kin and lodgers to fill the house; a last pass moves the ages of the
 *   members free to move towards the age table. Every member has a sex.
 *
 * Every step has its own seeded source, so a household is the same each time it is worked out and
 * need never be stored; only a household a user edits would be saved.
 *
 * Pure: the drawn town and a few options in, records out.
 */
import { centroid, dist, makeNoise, pointInPolygon, polygonArea, stageRandom } from "./Geometry.js";

/**
 * Trades of heads of household by kind of place: [name, share of households, group, where it is
 * drawn to]. A share of 0 is a trade counted from the place's role (ROLE_TRADES) or one of a kind.
 * After the shape of medieval English poll-tax and tax-roll occupations; a proposal, not a source.
 */
const TRADES = Object.freeze({
    village: [
        ["priest", 0, "clergy", "worship"], ["reeve", 0, "office", "market"], ["miller", 0, "food", "water"], ["miner", 0, "mining", "edge"], ["smith", 0.02, "metal", "road"],
        ["alewife", 0.03, "food", "market"], ["carpenter", 0.03, "building", "any"], ["weaver", 0.04, "cloth", "any"], ["shepherd", 0.05, "land", "edge"],
        ["husbandman", 0.4, "land", "any"], ["cottar", 0.24, "land", "edge"], ["labourer", 0.12, "labour", "edge"], ["widow", 0.06, "none", "any"],
    ],
    town: [
        ["priest", 0, "clergy", "worship"], ["miller", 0, "food", "water"], ["carter", 0, "transport", "road"], ["boatman", 0, "transport", "water"],
        ["cornmonger", 0, "trade", "market"], ["chapman", 0, "trade", "market"], ["mariner", 0, "transport", "quay"], ["porter", 0, "labour", "quay"],
        ["shipwright", 0, "building", "quay"], ["miner", 0, "mining", "gate"], ["man-at-arms", 0.01, "arms", "castle"], ["watchman", 0.006, "arms", "gate"], ["bowyer", 0.004, "arms", "any"],
        ["fletcher", 0.003, "arms", "any"], ["mercer", 0.04, "trade", "market"], ["innkeeper", 0.03, "food", "market"], ["baker", 0.04, "food", "front"],
        ["butcher", 0.04, "food", "front"], ["brewer", 0.05, "food", "any"], ["fishmonger", 0.02, "food", "water"], ["weaver", 0.06, "cloth", "any"],
        ["fuller", 0.02, "cloth", "water"], ["dyer", 0.02, "cloth", "water"], ["tailor", 0.05, "cloth", "front"], ["tanner", 0.03, "leather", "water"],
        ["shoemaker", 0.05, "leather", "front"], ["saddler", 0.01, "leather", "road"], ["smith", 0.04, "metal", "road"], ["cutler", 0.01, "metal", "front"],
        ["carpenter", 0.04, "building", "any"], ["mason", 0.02, "building", "any"], ["thatcher", 0.01, "building", "edge"], ["husbandman", 0.1, "land", "edge"],
        ["labourer", 0.14, "labour", "edge"], ["widow", 0.06, "none", "any"],
    ],
    city: [
        ["cleric", 0.015, "clergy", "worship"], ["priest", 0.02, "clergy", "worship"], ["clerk", 0.02, "office", "market"], ["bailiff", 0.005, "office", "castle"],
        ["man-at-arms", 0.03, "arms", "castle"], ["watchman", 0.008, "arms", "gate"], ["bowyer", 0.004, "arms", "any"], ["fletcher", 0.003, "arms", "any"],
        ["armourer", 0.004, "arms", "gate"], ["miller", 0, "food", "water"], ["carter", 0, "transport", "gate"], ["boatman", 0, "transport", "water"],
        ["cornmonger", 0, "trade", "market"], ["chapman", 0, "trade", "market"], ["mariner", 0, "transport", "quay"], ["porter", 0, "labour", "quay"],
        ["shipwright", 0, "building", "quay"], ["miner", 0, "mining", "gate"], ["merchant", 0.05, "trade", "market"], ["mercer", 0.03, "trade", "market"], ["goldsmith", 0.01, "metal", "market"],
        ["innkeeper", 0.025, "food", "gate"], ["baker", 0.035, "food", "front"], ["butcher", 0.03, "food", "front"], ["brewer", 0.04, "food", "any"],
        ["fishmonger", 0.015, "food", "water"], ["weaver", 0.06, "cloth", "any"], ["fuller", 0.02, "cloth", "water"], ["dyer", 0.02, "cloth", "water"],
        ["tailor", 0.05, "cloth", "front"], ["tanner", 0.02, "leather", "water"], ["shoemaker", 0.045, "leather", "front"], ["glover", 0.01, "leather", "front"],
        ["smith", 0.03, "metal", "gate"], ["cutler", 0.01, "metal", "front"], ["carpenter", 0.035, "building", "any"], ["mason", 0.02, "building", "any"],
        ["tiler", 0.01, "building", "any"], ["labourer", 0.15, "labour", "edge"], ["gardener", 0.02, "land", "edge"], ["widow", 0.055, "none", "any"],
    ],
    // A cavern settlement: fungus farmers and fishers for its food, miners, tunnellers and
    // stonecutters for the rock, lamp-makers and chandlers for its light, drovers for the tunnels
    cave: [
        ["magnate", 0, "office", "hollow"], ["priest", 0, "clergy", "worship"], ["cleric", 0.01, "clergy", "worship"], ["clerk", 0.015, "office", "market"], ["warden", 0.005, "office", "gate"],
        ["man-at-arms", 0.03, "arms", "gate"], ["watchman", 0.01, "arms", "gate"], ["armourer", 0.004, "arms", "gate"], ["miller", 0, "food", "water"],
        ["carter", 0, "transport", "gate"], ["boatman", 0, "transport", "water"], ["cornmonger", 0, "trade", "market"], ["chapman", 0, "trade", "market"],
        ["mariner", 0, "transport", "quay"], ["porter", 0, "labour", "quay"], ["shipwright", 0, "building", "quay"], ["drover", 0.015, "transport", "gate"],
        ["merchant", 0.04, "trade", "market"], ["mercer", 0.02, "trade", "market"], ["goldsmith", 0.012, "metal", "market"], ["gem-cutter", 0.01, "metal", "market"],
        ["innkeeper", 0.015, "food", "gate"], ["baker", 0.025, "food", "front"], ["brewer", 0.03, "food", "any"], ["butcher", 0.015, "food", "front"],
        ["fishmonger", 0.01, "food", "water"], ["fisher", 0.02, "food", "water"], ["fungus farmer", 0.13, "land", "edge"], ["lamp-maker", 0.015, "light", "any"],
        ["chandler", 0.012, "light", "front"], ["weaver", 0.04, "cloth", "any"], ["dyer", 0.01, "cloth", "water"], ["tailor", 0.035, "cloth", "front"],
        ["tanner", 0.012, "leather", "water"], ["shoemaker", 0.03, "leather", "front"], ["smith", 0.035, "metal", "gate"], ["cutler", 0.01, "metal", "front"],
        ["miner", 0, "mining", "gate"], ["tunneller", 0.02, "mining", "gate"], ["stonecutter", 0.04, "building", "rock"], ["mason", 0.03, "building", "any"],
        ["carpenter", 0.008, "building", "any"], ["labourer", 0.11, "labour", "edge"], ["widow", 0.05, "none", "any"],
    ],
    farm: [["husbandman", 0.55, "land", "any"], ["cottar", 0.2, "land", "any"], ["shepherd", 0.08, "land", "any"], ["labourer", 0.12, "labour", "any"], ["widow", 0.05, "none", "any"]],
});

/**
 * Trades that appear as a place grows: [name, group, where it is drawn to, one household in this
 * many people, from this many people, worth (as tradeWorth)]. Each place large enough has at least
 * one. A proposal for later tuning.
 */
export const SPECIALISTS = Object.freeze([
    ["herbalist", "care", "edge", 1500, 400, -0.3],
    ["barber-surgeon", "care", "front", 1500, 1000, 0.3],
    ["schoolmaster", "learning", "worship", 2500, 1500, 0.5],
    ["scrivener", "office", "market", 2500, 2000, 0.8],
    ["apothecary", "care", "market", 3500, 2000, 1.5],
    ["bathhouse keeper", "care", "water", 5000, 4000, 0],
    ["physician", "care", "market", 6000, 5000, 2.5],
    ["notary", "office", "market", 8000, 8000, 2],
    ["moneychanger", "trade", "market", 8000, 8000, 3],
    ["bookbinder", "learning", "worship", 10000, 10000, 1],
]);

/**
 * The trades of arms (men-at-arms, the paid watch, bowyers, fletchers, armourers) grow as the
 * parent's security falls: their table shares are multiplied by ARMS_LOW + ARMS_PER × (1 −
 * security), within ARMS_RANGE. Every man keeps arms and turns out for the watch and the muster
 * wherever he lives; these are the trades that live by it.
 */
export const ARMS = Object.freeze({ LOW: 0.5, PER: 2.5, RANGE: [0.5, 2] });

/**
 * The trades a place's role calls for (households): a person eats ROLE.GRAIN_T tonnes of grain a
 * year; a carter carts CARTER_T a year, a boatman BOAT_T, a mariner SHIP_T and a porter PORTER_T
 * of cargo, of which grain is a share (GOODS_PER_GRAIN times the grain is carried by river,
 * GOODS_PER_GRAIN_SEA by sea); a mill grinds for MILL_PEOPLE (by kind of place) and its miller keeps MILL_MEN; a corn dealer handles CORN_PEOPLE a
 * year's grain; a chapman serves CHAPMAN_PEOPLE of the country selling at the market; a shipwright
 * keeps SHIPWRIGHT_MARINERS mariners afloat. A proposal: medieval carting ran to a few dozen
 * tonnes a year a cart on short hauls, and a manorial mill served a few hundred people.
 */
export const ROLE = Object.freeze({
    GRAIN_T: 0.25,
    CARTER_T: 60,
    BOAT_T: 150,
    SHIP_T: 100,
    PORTER_T: 400,
    GOODS_PER_GRAIN: 2,
    GOODS_PER_GRAIN_SEA: 3,
    // People a mill grinds for, by kind of place: a village's one mill, a town's and a city's
    // larger mills of several wheels (Domesday's some 6,000 mills served about 300 people each)
    MILL_PEOPLE: Object.freeze({ village: 350, town: 600, city: 1000 }),
    // Millers' men in a miller's house, by kind of place
    MILL_MEN: Object.freeze({ village: 0, town: 1, city: 2 }),
    CORN_PEOPLE: 1500,
    CHAPMAN_PEOPLE: 600,
    SHIPWRIGHT_MARINERS: 10,
    // A mine's miners: hewers, hauliers and the rest, a household each, for every stope worked
    // (about 400 t of ore a year at some 50 t a hewer)
    MINERS_PER_STOPE: 12,
    // The trades a role calls for take at most this share of a place's households
    MOST: 0.3,
});

/** Each trade's group and where it is drawn to, by kind of place (the tables above), for words about a house. */
export const TRADE_TABLES = TRADES;

export const GROUP_COLOURS = Object.freeze({ clergy: "#7b5ea7", learning: "#b06fb8", care: "#d65f8a", office: "#3f6fb5", arms: "#a83232", trade: "#d4a017", food: "#e07b39", cloth: "#4fa3a5", leather: "#8c5a3c", metal: "#5c6670", building: "#a3a35a", transport: "#2f7f4f", land: "#89b35b", labour: "#c9b6a0", mining: "#4b4b7a", light: "#e8c35a", none: "#e8e0d0" });
/** The plan-first core's tiers (V2): what a house's quarter adds to its household's worth, in place
 * of nearness to the market (upper by the castle and places of worship, middle on the market and
 * the high streets, lower by the crafts and the water). */
const TIER_WORTH = Object.freeze({ upper: 3, middle: 1.3, lower: -0.2 });

export const WEALTH = Object.freeze(["poor", "modest", "middling", "prosperous", "wealthy"]);
const WEALTH_CUTS = [0.3, 0.6, 0.85, 0.96, 1];

/** The share of people in each age band (a high-mortality stable population, life at birth about
 * 30), and after a great plague (fewer children and old people). */
export const AGES = Object.freeze({
    normal: [[0, 4, 0.14], [5, 14, 0.22], [15, 29, 0.27], [30, 44, 0.19], [45, 59, 0.12], [60, 80, 0.06]],
    plague: [[0, 4, 0.1], [5, 14, 0.18], [15, 29, 0.3], [30, 44, 0.22], [45, 59, 0.14], [60, 80, 0.06]],
});
/** Floors in a hollowed pillar, and the houses of the usual size it holds as many as. */
const HOLLOW_STOREYS = 5;
const HOLLOW_HOUSES = 8;
/** Children: years between births, and the chance of twins. */
const BIRTH_GAP = [2, 3.5];
const TWINS = 0.015;
/** The youngest child at home is at most this old. */
const YOUNGEST_MOST = 7;

/**
 * Who heads a household, by the culture's setting: the share headed by women. Automatic follows
 * the culture's lineage (a father's line gives "men", a mother's "women"). Under "men" women head
 * about one household in six, as widows and in their own right, as medieval town tax lists show;
 * "women" is the mirror; "either" draws each household evenly.
 */
export const HEADS = Object.freeze({ men: 1 / 6, women: 5 / 6, either: 0.5 });
/**
 * Where the head is of the sex that heads fewer households, the household is a widow's or a
 * single person's, with no spouse ("men" and "women"); under "either" every head may marry.
 * A woman heading a household in her own right under "men" keeps one of these trades first,
 * the trades town tax lists show women heading households in.
 */
const WOMEN_TRADES = new Set(["brewer", "weaver", "innkeeper", "baker", "dyer", "herbalist", "fishmonger", "chandler", "mercer", "glover", "tailor", "gardener", "labourer", "fuller", "cottar"]);

/** The share of a culture's households headed by women. */
export function womenHeadShare(culture) {
    const setting = culture?.heads ?? "auto";
    if (setting === "auto") return culture?.lineage === "mother" ? HEADS.women : HEADS.men;
    return HEADS[setting] ?? HEADS.men;
}

/** Ages each role may take, for the last pass towards the age table. */
const ROLE_AGES = {
    servant: [12, 30], "miller's man": [16, 50], apprentice: [12, 20], journeyman: [18, 30], kinsman: [15, 80], kinswoman: [15, 80], lodger: [15, 70],
};

/**
 * The trades the place's role calls for, counted from its supply (Supply.js supplyOf) and drawn
 * waterfront, with what drives each, for the totals.
 */
export function roleTrades(input, town, houses) {
    const kind = input.kind;
    // A cavern's own supply is worked out as it is drawn (its spill bought in)
    const s = town.supply ?? input.supply;
    const out = {};
    if (kind === "village") return { counts: { miller: 1, ...(input.mine ? { miner: Math.min(input.mine.stopes * ROLE.MINERS_PER_STOPE, Math.round(ROLE.MOST * houses)) } : {}) }, drivers: {} };
    // Grain (tonnes a year) to, from and through the place, by how it travels
    const by = { cart: 0, river: 0, sea: 0 };
    const add = (people, modes) => {
        const t = people * ROLE.GRAIN_T;
        const km = modes ? (modes.road ?? 0) + (modes.land ?? 0) + (modes.river ?? 0) + (modes.sea ?? 0) : 0;
        if (!km) {
            by.cart += t;
            return;
        }
        by.cart += (t * ((modes.road ?? 0) + (modes.land ?? 0))) / km;
        by.river += (t * (modes.river ?? 0)) / km;
        by.sea += (t * (modes.sea ?? 0)) / km;
    };
    const overseas = input.port ? "sea" : input.riverPort ? "river" : "cart";
    if (s) {
        add(s.countryTotal ?? 0, null);
        for (const flow of s.fromPlaces ?? []) add(flow.amount, flow.modes);
        if (s.out) add(s.out.amount, s.out.modes);
        by[overseas] += ((s.imports ?? 0) + (s.exports ?? 0)) * ROLE.GRAIN_T;
    }
    const traded = s ? (s.countryTotal ?? 0) + (s.fromPlaces ?? []).reduce((a, f) => a + f.amount, 0) + (s.out?.amount ?? 0) + (s.imports ?? 0) + (s.exports ?? 0) : 0;
    out.carter = by.cart / ROLE.CARTER_T;
    out.boatman = (by.river * ROLE.GOODS_PER_GRAIN) / ROLE.BOAT_T;
    out.mariner = input.port && town.shore ? (by.sea * ROLE.GOODS_PER_GRAIN_SEA) / ROLE.SHIP_T : 0;
    out.porter = ((input.port && town.shore ? by.sea * ROLE.GOODS_PER_GRAIN_SEA : 0) + by.river * ROLE.GOODS_PER_GRAIN) / ROLE.PORTER_T;
    out.shipwright = out.mariner / ROLE.SHIPWRIGHT_MARINERS;
    out.miller = Math.max(1, (input.population * 1.15) / ROLE.MILL_PEOPLE[kind]);
    out.cornmonger = traded / ROLE.CORN_PEOPLE;
    out.chapman = (s?.countryTotal ?? 0) / ROLE.CHAPMAN_PEOPLE;
    // A place with a mine has miners by its size; one without has none
    out.miner = input.mine ? input.mine.stopes * ROLE.MINERS_PER_STOPE : 0;
    // No more than ROLE.MOST of the households
    const total = Object.values(out).reduce((a, b) => a + b, 0);
    const scale = Math.min(1, (ROLE.MOST * houses) / Math.max(1, total));
    const counts = Object.fromEntries(Object.entries(out).map(([name, n]) => [name, Math.round(n * scale)]));
    return { counts, drivers: { grainTonnes: { cart: Math.round(by.cart), river: Math.round(by.river), sea: Math.round(by.sea) }, tradedPeopleFed: Math.round(traded), scaled: +scale.toFixed(2) } };
}

/**
 * @param {object} town - A drawn place (Town.js buildTown).
 * @param {{cultures?: {name: string, share: number, openness: number, nameBase?: string, heads?: string, lineage?: string}[], era?: "normal"|"plague", namer?: {household: function(string, object): (string|null)}}} [options] -
 *     The cultures default to the input's (each culture's Household heads setting and lineage
 *     decide who heads its households). `namer` is a namer of personal names
 *     (`PersonNames.createNamer`); without it there are no names.
 */
export function householdsOf(town, { cultures = town.input.cultures ?? [{ name: "Local", share: 1, openness: 0.5 }], era = "normal", namer = null } = {}) {
    const { input } = town;
    const kind = input.kind;
    const R = (stage) => stageRandom(input.seed, `people:${stage}`);
    const mix = [...cultures].sort((a, b) => b.share - a.share);
    const W = town.frame.width;
    const H = town.frame.height;
    const { NX, NY, g, riverDist, seaDist } = town.terrain;
    const cell = (p) => {
        const i = Math.floor((p[0] + W / 2) / g);
        const j = Math.floor((p[1] + H / 2) / g);
        return i < 0 || j < 0 || i >= NX || j >= NY ? -1 : j * NX + i;
    };
    // In a cavern the "sea" is the rock: its water is the lake and the stream, and the rock has a
    // pull of its own (stonecutters by the wall)
    const waters = town.shore?.cave?.waters ?? null;
    const toWater = (p) => {
        const k = cell(p);
        if (k < 0) return 1e9;
        if (waters) return Math.min(riverDist[k] - town.river.width / 2, ...waters.map((w) => dist(p, w.c) - w.r));
        return Math.min(riverDist[k] - town.river.width / 2, seaDist ? seaDist[k] : 1e9);
    };
    const toRock = (p) => {
        const k = cell(p);
        return k < 0 || !waters || !seaDist ? 1e9 : seaDist[k];
    };
    const quayPoints = (town.quays ?? []).flatMap((q) => q.points);
    const market = centroid(town.market.polygon);
    const gates = [...(town.wall?.gates ?? []), ...(town.outerWall?.gates ?? []), ...(town.forts ?? [])].map((gate) => gate.p);
    const worship = town.worship.map((w) => centroid(w.yard));
    const castle = town.castle?.centre ?? null;

    const all = town.buildings.map((b, index) => ({ b, index })).filter(({ b }) => b.kind === "house" || b.kind === "farmhouse");
    const homes = all.map(({ b, index }) => ({ index, farm: b.kind === "farmhouse", rank: b.rank ?? 1, back: !!b.back, hollow: !!b.hollow, rockCut: !!b.rockCut, tier: b.tier ?? null, c: centroid(b.poly), area: polygonArea(b.poly) }));
    const houses = homes.filter((h) => !h.farm);
    const farms = homes.filter((h) => h.farm);
    const far = houses.reduce((m, h) => Math.max(m, dist(h.c, market)), 1);

    // ------------------------------------------------------------ where each house stands
    for (const h of homes) {
        h.dMarket = dist(h.c, market);
        h.dWater = toWater(h.c);
        h.dRock = h.rockCut ? 0 : toRock(h.c);
        h.dQuay = quayPoints.length ? Math.min(...quayPoints.map((q) => dist(q, h.c))) : h.dWater + 400;
        h.dGate = gates.length ? Math.min(...gates.map((q) => dist(q, h.c))) : h.dMarket;
        h.dWorship = worship.length ? Math.min(...worship.map((q) => dist(q, h.c))) : 1e9;
        h.dCastle = castle ? dist(castle, h.c) : 1e9;
        h.inside = town.wall ? pointInPolygon(h.c, town.wall.polygon) : true;
        // Tall near a city's market within the walls, two storeys on a town's main streets and a
        // city's suburban high streets, one elsewhere
        // A hollowed pillar is a great house of many floors
        h.storeys = h.hollow ? HOLLOW_STOREYS : h.farm ? 1 : kind === "city" ? (h.inside ? (h.back ? 2 : h.dMarket < 300 ? 3 : 2) : h.rank <= 1 ? 2 : 1) : kind === "town" ? (h.dMarket < 150 && h.rank <= 1 ? 2 : 1) : 1;
        h.floor = Math.pow(h.area * h.storeys, 0.6);
    }

    // A hollowed pillar holds as many as HOLLOW_HOUSES houses of the usual size, not as many as its
    // whole round of rock would by floor area
    const usual = houses.filter((h) => !h.hollow).map((h) => h.floor).sort((a, b) => a - b);
    const median = usual[Math.floor(usual.length / 2)] ?? 1;
    for (const h of houses) if (h.hollow) h.floor = median * HOLLOW_HOUSES;
    // ------------------------------------------------------------ people per house, exact totals
    share(houses, input.population);
    share(farms, Math.round(town.land?.countryPeople ?? 0));

    // ------------------------------------------------------------ trades
    const rt = R("trades");
    for (const h of homes) h.jitter = rt.range(0, 120);
    const pull = {
        worship: (h) => -h.dWorship,
        castle: (h) => -Math.min(h.dCastle, h.dGate * 1.5),
        market: (h) => -h.dMarket + (h.rank === 0 ? 60 : 0),
        water: (h) => -h.dWater,
        quay: (h) => -h.dQuay,
        gate: (h) => -h.dGate - h.dMarket * 0.2,
        road: (h) => (h.rank <= 1 ? 80 : 0) - h.dMarket * 0.15 - h.dGate * 0.1,
        front: (h) => (h.back ? -200 : 0) + (h.rank <= 1 ? 50 : 0) - h.dMarket * 0.3,
        edge: (h) => h.dMarket - (h.inside ? 0 : -150),
        rock: (h) => -h.dRock,
        hollow: (h) => (h.hollow ? 1e6 : -1e6),
        any: () => 0,
    };
    const roles = roleTrades(input, town, houses.length);
    const security = input.security ?? 1;
    const arms = Math.max(ARMS.RANGE[0], Math.min(ARMS.RANGE[1], ARMS.LOW + ARMS.PER * (1 - security)));
    const table = [
        ...(input.cave ? TRADES.cave : TRADES[kind]).map((t) => (t[2] === "arms" ? [t[0], t[1] * arms, t[2], t[3]] : t)),
        ...SPECIALISTS.filter((t) => input.population >= t[4]).map(([name, group, where]) => [name, 0, group, where]),
    ];
    const specialists = Object.fromEntries(SPECIALISTS.filter((t) => input.population >= t[4]).map(([name, , , oneIn]) => [name, Math.max(1, Math.round(input.population / oneIn))]));
    // A cavern's hollowed pillars are its great houses, each the house of a magnate
    const magnates = input.cave ? { magnate: houses.filter((h) => h.hollow).length } : {};
    assignTrades(houses, table, { ...roles.counts, ...specialists, ...magnates }, pull, { worship: worship.length, kind });
    assignTrades(farms, TRADES.farm, {}, pull, { worship: 0, kind: "farm" });

    // ------------------------------------------------------------ wealth
    const tradeWorth = { ...Object.fromEntries(SPECIALISTS.map((t) => [t[0], t[5]])), watchman: -0.3, bowyer: 0, fletcher: 0, armourer: 0.8, cleric: 2, magnate: 4, merchant: 3, mercer: 2.5, goldsmith: 3, clerk: 1.5, bailiff: 2, reeve: 1, innkeeper: 1, priest: 1, miller: 1.2, cornmonger: 1.5, shipwright: 0.5, mariner: 0, "man-at-arms": 0.5, labourer: -1.5, cottar: -1, porter: -1.2, widow: -1, widower: -1, gardener: -0.5, carter: -0.3, chapman: -0.2 };
    const rank = (list, worthOf) => {
        for (const h of list) h.worth = worthOf(h);
        const ordered = [...list].sort((a, b) => a.worth - b.worth);
        ordered.forEach((h, k) => (h.wealth = WEALTH[WEALTH_CUTS.findIndex((c) => (k + 1) / ordered.length <= c)]));
    };
    rank(houses, (h) => (tradeWorth[h.trade] ?? 0) + Math.log(h.floor / 60) + (h.tier ? TIER_WORTH[h.tier] : (1 - h.dMarket / far) * 1.5) + (h.back ? -0.7 : 0) + (h.inside ? 0 : -0.6) + rt.range(-0.6, 0.6));
    rank(farms, (h) => (tradeWorth[h.trade] ?? 0) + Math.log(h.floor / 60) + rt.range(-0.8, 0.8));

    // ------------------------------------------------------------ cultures by quota, in quarters
    const rc = R("cultures");
    for (const h of homes) h.culture = mix[0].name;
    for (const list of [houses, farms]) {
        const left = new Set(list);
        for (const culture of mix.slice(1)) {
            const field = makeNoise(`${input.seed}:culture:${culture.name}`);
            const score = (h) => (1 - culture.openness) * field.fbm(h.c[0] / 260, h.c[1] / 260, 3) + culture.openness * rc.next();
            const quota = Math.round(culture.share * list.length);
            const ranked = [...left].map((h) => [score(h), h]).sort((a, b) => b[0] - a[0]);
            for (const [, h] of ranked.slice(0, quota)) {
                h.culture = culture.name;
                left.delete(h);
            }
        }
    }

    // ------------------------------------------------------------ members
    const bands = AGES[era];
    const ra = R("ages");
    const sampleAge = (lo, hi) => {
        const ok = bands.filter(([a, b]) => b >= lo && a <= hi);
        const weight = ok.reduce((s, b) => s + b[2] * (Math.min(b[1], hi) - Math.max(b[0], lo) + 1) / (b[1] - b[0] + 1), 0);
        let r = ra.next() * weight;
        for (const [a, b, w] of ok) {
            const lo2 = Math.max(a, lo);
            const hi2 = Math.min(b, hi);
            r -= (w * (hi2 - lo2 + 1)) / (b - a + 1);
            if (r <= 0) return lo2 + Math.floor(ra.next() * (hi2 - lo2 + 1));
        }
        return lo;
    };
    // Who heads each household, from a stream of its own so nothing else moves: the widowed
    // households take the sex that heads fewer, and the rest are drawn so the culture's share holds
    const rh = R("heads");
    for (const list of [houses, farms]) {
        for (const culture of mix) {
            const own = list.filter((h) => h.culture === culture.name);
            const share = womenHeadShare(culture);
            const minority = share < 0.5 ? "f" : share > 0.5 ? "m" : null;
            const widowed = own.filter((h) => h.trade === "widow");
            for (const h of widowed) h.headSex = minority ?? (rh.chance(0.5) ? "f" : "m");
            const women = widowed.filter((h) => h.headSex === "f").length;
            const rest = own.filter((h) => h.trade !== "widow");
            const want = Math.max(0, Math.min(rest.length, Math.round(share * own.length) - women));
            // Under "men", the women heading households in their own right keep the trades women
            // headed households in; otherwise any household may be one of them
            const order = rest.map((h) => [rh.next() + (minority === "f" && WOMEN_TRADES.has(h.trade) ? 1 : 0), h]).sort((a, b) => b[0] - a[0]);
            order.forEach(([, h], k) => (h.headSex = k < want ? "f" : "m"));
            for (const h of widowed) if (h.headSex === "m") h.trade = "widower";
            for (const h of own) h.minorityHead = minority !== null && h.headSex === minority;
        }
    }
    for (const h of homes) {
        const members = [];
        const widow = h.trade === "widow" || h.trade === "widower";
        const headSex = h.headSex ?? "m";
        const headAge = widow ? sampleAge(40, 80) : ["man-at-arms", "labourer", "mariner", "porter", "carter"].includes(h.trade) ? sampleAge(18, 50) : sampleAge(22, 64);
        members.push({ role: widow ? (headSex === "f" ? "widow, head" : "widower, head") : "head", age: headAge, sex: headSex });
        let room = h.people - 1;
        // The head of the sex that heads fewer households is single or widowed; any other head
        // has a spouse for most, the spouse of the other sex, the head the elder by the usual gap
        const spouseChance = h.minorityHead ? 0 : 0.85;
        if (room > 0 && !widow && headAge < 62 && ra.chance(spouseChance)) {
            const female = headSex === "m";
            members.push({ role: female ? "wife" : "husband", age: Math.max(16, headAge - Math.round(ra.range(-2, 9))), sex: female ? "f" : "m" });
            room--;
        }
        // Servants, apprentices and journeymen in well-off households, each their own age; a fifth
        // from another culture where the place has more than one
        const kept = h.wealth === "wealthy" ? 3 : h.wealth === "prosperous" ? 2 : h.wealth === "middling" ? (ra.chance(0.4) ? 1 : 0) : 0;
        const roles = h.farm ? ["servant", "servant", "servant"] : ["apprentice", "servant", "journeyman"];
        for (let k = 0; k < kept && room > 1; k++) {
            const role = roles[k % 3];
            const [lo, hi] = ROLE_AGES[role];
            const other = mix.length > 1 && ra.chance(0.2) ? mix[Math.floor(ra.next() * mix.length)].name : null;
            members.push({ role, age: sampleAge(lo, hi), ...(other && other !== h.culture ? { culture: other } : {}) });
            room--;
        }
        // A mill's men live in the miller's house
        for (let k = 0; h.trade === "miller" && k < ROLE.MILL_MEN[kind] && room > 1; k++) {
            members.push({ role: "miller's man", age: sampleAge(...ROLE_AGES["miller's man"]) });
            room--;
        }
        if (room > 1 && headAge > 30 && ra.chance(0.18)) {
            const parent = ra.chance(0.7) ? "mother" : "father";
            members.push({ role: parent, age: Math.min(85, headAge + Math.round(ra.range(20, 30))), sex: parent === "mother" ? "f" : "m" });
            room--;
        }
        h.members = members;
        h.room = room;
    }
    // Children: as many as the age table asks for overall, shared among the mothers by the room
    // in their houses, spaced as births are and never more than the mother's age allows
    const childShare = bands.filter(([a]) => a < 15).reduce((s, b) => s + b[2], 0);
    const totalPeople = homes.reduce((a, h) => a + h.people, 0);
    // The mother is the wife, or a woman heading the household (with or without a husband)
    const motherOf = (h) => h.members.find((m) => m.role === "wife" || ((m.role === "head" || m.role === "widow, head") && m.sex === "f"));
    const capOf = (h) => {
        const mother = motherOf(h);
        return mother ? Math.max(0, Math.min(h.room, 7, Math.floor((mother.age - 16) / 2.2))) : 0;
    };
    const mothers = homes.filter((h) => h.room > 0 && motherOf(h));
    const wanted = mothers.reduce((s, h) => s + capOf(h), 0);
    const ratio = Math.min(1, (childShare * totalPeople) / Math.max(1, wanted));
    for (const h of mothers) {
        const mother = motherOf(h);
        const count = Math.min(capOf(h), Math.round(capOf(h) * ratio + ra.range(-0.5, 0.5)));
        const oldest = Math.min(14, mother.age - 16);
        // The youngest is any age that leaves room for the rest below the oldest a mother of her
        // age can have at home, so not every family has a baby
        const span = (count - 1) * (BIRTH_GAP[0] + BIRTH_GAP[1]) / 2;
        let age = Math.floor(ra.range(0, Math.max(1, Math.min(YOUNGEST_MOST, oldest - span) + 1)));
        for (let k = 0; k < count && age <= oldest; k++) {
            h.members.push({ role: "child", age });
            h.room--;
            // The next older, born a couple of years before (now and then a twin)
            if (!ra.chance(TWINS)) age += Math.round(ra.range(BIRTH_GAP[0], BIRTH_GAP[1]));
        }
    }
    // Little children against the table: a family's children are moved older or younger together
    // (their spacing kept, within what their mother's age allows) until the under-fives are as many
    // as the table asks for, give or take a family
    const little = bands[0];
    const wantLittle = little[2] * totalPeople;
    const families = mothers.map((h) => ({ h, kids: h.members.filter((m) => m.role === "child") })).filter((f) => f.kids.length);
    for (let k = families.length - 1; k > 0; k--) {
        const j = Math.floor(ra.next() * (k + 1));
        [families[k], families[j]] = [families[j], families[k]];
    }
    let littleNow = families.reduce((a, f) => a + f.kids.filter((m) => m.age <= little[1]).length, 0);
    for (const f of families) {
        const excess = littleNow - wantLittle;
        if (Math.abs(excess) < 2) break;
        const ages = f.kids.map((m) => m.age);
        const youngest = Math.min(...ages);
        const oldest = Math.max(...ages);
        const limit = Math.min(14, motherOf(f.h).age - 16);
        const under = ages.filter((a) => a <= little[1]).length;
        const shift = excess > 0 ? little[1] + 1 - youngest : little[1] - youngest;
        if (excess > 0 ? youngest > little[1] || oldest + shift > limit || under > excess + 1 : youngest <= little[1] || youngest + shift < 0) continue;
        for (const m of f.kids) m.age += shift;
        littleNow += f.kids.filter((m) => m.age <= little[1]).length - under;
    }
    // Whoever else lives there: grown children, kin, and lodgers in poor city houses
    for (const h of homes) {
        const headAge = h.members[0].age;
        const well = h.wealth === "wealthy" || h.wealth === "prosperous";
        while (h.room > 0) {
            const lodgers = kind === "city" && !h.farm ? ({ poor: 0.6, modest: 0.5, middling: 0.3 }[h.wealth] ?? 0) : 0;
            const role = ra.chance(lodgers) ? "lodger" : well && ra.chance(0.5) ? "servant" : headAge >= 36 && ra.chance(0.6) ? "grown child" : ra.chance(0.5) ? "kinsman" : "kinswoman";
            const age = role === "grown child" ? Math.max(15, Math.min(headAge - 18, sampleAge(15, 29))) : sampleAge(...(ROLE_AGES[role] ?? [15, 59]));
            h.members.push({ role, age, ...(role === "grown child" ? { maxAge: headAge - 18 } : {}) });
            h.room--;
        }
    }
    towardsTable(homes, bands, ra);

    // ------------------------------------------------------------ sex
    // Every member has one: by role where the role sets it, otherwise even odds, each from the
    // member's own stream so no other draw moves
    const BY_ROLE = { kinsman: "m", kinswoman: "f", mother: "f", father: "m", wife: "f", husband: "m" };
    for (const h of homes) {
        h.members.forEach((m, j) => {
            m.sex ??= BY_ROLE[m.role] ?? (stageRandom(input.seed, `people:sex:${h.index}:${j}`).next() < 0.5 ? "m" : "f");
        });
    }

    // ------------------------------------------------------------ names
    // Every member named by the culture's conventions (personal names N2, `PersonNames`): given
    // names, the household's family name or byname, patronymics or a clan as the culture names
    // its people. Each household from its own seed, so names never move another field.
    if (namer) homes.forEach((h, k) => (h.family = namer.household(`${input.seed}:people:h${k}`, h) ?? null));

    // ------------------------------------------------------------ totals
    const people = homes.flatMap((h) => h.members);
    const count = (list, key) => list.reduce((acc, x) => ((acc[key(x)] = (acc[key(x)] ?? 0) + 1), acc), {});
    const totals = {
        people: houses.reduce((a, h) => a + h.members.length, 0),
        countryPeople: farms.reduce((a, h) => a + h.members.length, 0),
        houses: houses.length,
        farmhouses: farms.length,
        ageBands: bands.map(([a, b, want]) => ({ band: `${a} to ${b}`, want, got: +(people.filter((p) => p.age >= a && p.age <= b).length / Math.max(1, people.length)).toFixed(3) })),
        cultures: count(houses, (h) => h.culture),
        groups: count(houses, (h) => h.group),
        trades: count(houses, (h) => h.trade),
        wealth: count(houses, (h) => h.wealth),
        roleTrades: roles,
        specialists,
        security,
        armsFactor: +arms.toFixed(2),
    };
    for (const h of homes) h.culture ??= mix[0].name;
    return { houses, farms, totals };
}

/** Shares `total` people among `list` by floor area, at least one each, by largest remainder. */
function share(list, total) {
    if (!list.length) return;
    const sum = list.reduce((a, h) => a + h.floor, 0);
    let given = 0;
    const rest = list.map((h) => {
        const want = (total * h.floor) / sum;
        h.people = Math.max(1, Math.floor(want));
        given += h.people;
        return [want - Math.floor(want), h];
    });
    rest.sort((a, b) => b[0] - a[0]);
    for (let k = 0; given < total; k = (k + 1) % rest.length) {
        rest[k][1].people++;
        given++;
    }
    for (let k = rest.length - 1; given > total && k >= 0; k--) {
        if (rest[k][1].people > 1) {
            rest[k][1].people--;
            given--;
        }
    }
}

/** Trades: the counted ones and the one-of-a-kind first, each taking the houses that suit it best;
 * the table's shares fill what is left. */
function assignTrades(list, table, counts, pull, { worship, kind }) {
    if (!list.length) return;
    const open = new Set(list);
    const fixed = Object.values(counts).reduce((a, b) => a + b, 0);
    const shared = table.filter((t) => t[1] > 0).reduce((a, t) => a + t[1], 0);
    const scale = Math.max(0, list.length - fixed) / Math.max(1, shared * list.length);
    const quotaOf = ([name, share]) => {
        if (counts[name] != null) return counts[name];
        if (name === "priest") return kind === "village" ? 1 : Math.max(worship, Math.round(share * scale * list.length));
        if (name === "reeve") return 1;
        return Math.round(share * scale * list.length);
    };
    const order = [...table].sort((a, b) => (a[3] === "any") - (b[3] === "any") || (counts[b[0]] != null) - (counts[a[0]] != null) || a[1] - b[1]);
    for (const trade of order) {
        const [name, , group, where] = trade;
        const quota = quotaOf(trade);
        if (quota <= 0) continue;
        const ranked = [...open].sort((a, b) => pull[where](b) + b.jitter - (pull[where](a) + a.jitter));
        for (const h of ranked.slice(0, quota)) {
            h.trade = name;
            h.group = group;
            open.delete(h);
        }
    }
    const fallback = table.find((t) => t[0] === (kind === "village" || kind === "farm" ? "husbandman" : "labourer"));
    for (const h of open) {
        h.trade = fallback[0];
        h.group = fallback[2];
    }
}

/**
 * The last pass: members free to be of other ages (servants, kin, lodgers) are moved, one at a
 * time, from the age band furthest over the table to the one furthest under it that their role
 * allows; where no one in an over band may take the age wanted, one from a band in balance takes
 * it and one from the over band takes theirs. Until no move helps.
 */
function towardsTable(homes, bands, random) {
    const flexible = homes.flatMap((h) => h.members.filter((m) => ROLE_AGES[m.role]));
    const all = homes.flatMap((h) => h.members);
    const bandOf = (age) => bands.findIndex(([a, b]) => age >= a && age <= b);
    const counts = bands.map(() => 0);
    for (const m of all) counts[bandOf(m.age)]++;
    const want = bands.map(([, , w]) => w * all.length);
    const byBand = bands.map(() => []);
    for (const m of flexible) byBand[bandOf(m.age)].push(m);
    // A member moves only into a band their role allows a few years of, so they are not all
    // pressed to the one age where the two just meet
    const fits = (m, to) => Math.min(bands[to][1], ROLE_AGES[m.role][1]) - Math.max(bands[to][0], ROLE_AGES[m.role][0]) >= 3;
    const move = (from, at, to) => {
        const m = byBand[from].splice(at, 1)[0];
        const a = Math.max(bands[to][0], ROLE_AGES[m.role][0]);
        const b = Math.min(bands[to][1], ROLE_AGES[m.role][1]);
        m.age = a + Math.floor(random.next() * (b - a + 1));
        counts[from]--;
        counts[to]++;
        byBand[to].push(m);
    };
    for (let guard = 0; guard < all.length; guard++) {
        const over = counts.map((c, k) => [c - want[k], k]).filter(([d]) => d > 1).sort((a, b) => b[0] - a[0]);
        const under = counts.map((c, k) => [want[k] - c, k]).filter(([d]) => d > 1).sort((a, b) => b[0] - a[0]);
        let moved = false;
        for (const [, to] of under) {
            for (const [, from] of over) {
                const at = byBand[from].findIndex((m) => fits(m, to));
                if (at < 0) continue;
                move(from, at, to);
                moved = true;
                break;
            }
            if (moved) break;
            // By way of a band in balance
            for (let mid = 0; mid < bands.length && !moved; mid++) {
                if (counts[mid] - want[mid] < -1 || over.some(([, k]) => k === mid) || mid === to) continue;
                const at = byBand[mid].findIndex((m) => fits(m, to));
                if (at < 0) continue;
                for (const [, from] of over) {
                    const at2 = byBand[from].findIndex((m) => fits(m, mid));
                    if (at2 < 0) continue;
                    move(mid, at, to);
                    move(from, at2, mid);
                    moved = true;
                    break;
                }
            }
            if (moved) break;
        }
        if (!moved) break;
    }
}

/** The hover card for a home, as plain text. */
export function describe(h) {
    const head = h.members[0];
    const others = h.members.slice(1);
    const kids = others.filter((m) => m.role === "child").map((m) => m.age).sort((a, b) => a - b);
    const rest = others.filter((m) => m.role !== "child").map((m) => `${m.role} ${m.age}${m.family ? ` ${m.family}` : ""}${m.culture ? ` (${m.culture})` : ""}`);
    const parts = [`${h.family ? `${h.family}, ` : ""}${h.trade}, ${head.age}`, ...rest];
    if (kids.length) parts.push(`${kids.length} ${kids.length === 1 ? "child" : "children"} (${kids.join(", ")})`);
    return `${h.people} ${h.people === 1 ? "person" : "people"} · ${h.culture} · ${h.wealth} · ${parts.join("; ")}`;
}

