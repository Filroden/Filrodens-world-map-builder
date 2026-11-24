/**
 * Food through the settlement hierarchy: how a place is fed.
 *
 * Every place grows a share of its own food in its own fields, by its size: a village more than
 * all of it (its surplus is sold), a market town about half, a town less, a city little (gardens,
 * orchards and market gardens at its edge). The country people between the places (the hamlets
 * and farms, and on a world map with no in-fill the villages too) grow a little more than they
 * eat, and sell the surplus at their nearest market (a market town or larger, never a village).
 * A place with more than it needs sells on to the nearest market (a village) or the nearest larger
 * place (a market town and up) within that place's reach, and so up the hierarchy: villages to the
 * market town, market towns to the town, towns to the city. River and sea carry grain much
 * further than carts, so the reach is a cost of carriage, not a distance.
 *
 * What a place cannot get this way it imports (from beyond the map, or from regions its run does
 * not trade with); what is left over at the top is exported. So the balance always closes:
 * own production + country surplus bought + bought from smaller places + imports
 *   = what its people eat + sold up + exported.
 *
 * The plan is for a normal year, and every grower (a place's own fields and the country people)
 * plants for its people and a store against a poor harvest (RESERVE): the store is what carries
 * a place through a poor year, so the plan does not model years one by one. A run of poor
 * harvests that empties the stores is a famine, and that is for a story to tell, not the map.
 *
 * Amounts are in people fed for a year. Nothing is random, so the plan is worked out again
 * whenever it is needed and never stored.
 *
 * Pure: plain arrays and records in, a record out.
 */
import { Delaunay } from "../../../../vendor/d3-delaunay/d3-delaunay.js";

/**
 * Defaults (a proposal, from the sources in the progress notes):
 * - OWN_SHARE: the share of its own food a place grows, by its people (a village's 1.25 is its
 *   need and a fifth more to sell);
 * - RESERVE: the share above what its people eat that every grower keeps in store, so a poor
 *   harvest (POOR_YIELD of a normal one) is met from the store; a bountiful one (GOOD_YIELD)
 *   refills it, less what spoils;
 * - COUNTRY_SURPLUS: the share above their own needs and store the country people grow to sell
 *   (for rents, dues and the market);
 * - RATE: cost of carriage per km against carting overland; a road (the run's road trade) halves
 *   it to a third of carting across country; rivers and the sea are the generator's own rates
 *   against a road's (GENERATOR.TRAVEL); a landing (land to
 *   water or back) costs LANDING_KM;
 * - OFF_ROUTE: between places, how much dearer carriage is off the run's routes (they keep to the
 *   roads, rivers and sea lanes wherever these join them);
 * - COUNTRY_REACH: how far (cost-km) country produce goes to its market, about a day's cart there and back;
 * - REACH: how far a place draws from smaller places, by its size (cost-km).
 */
export const SUPPLY = Object.freeze({
    OWN_SHARE: Object.freeze([
        Object.freeze({ upTo: 800, share: 1.25 }),
        Object.freeze({ upTo: 2500, share: 0.5 }),
        Object.freeze({ upTo: 8000, share: 0.3 }),
        Object.freeze({ upTo: 15000, share: 0.15 }),
        Object.freeze({ upTo: Infinity, share: 0.05 }),
    ]),
    VILLAGE_TIERS: Object.freeze(["village", "largeVillage", "hamlet"]),
    RESERVE: 0.15,
    POOR_YIELD: 0.85,
    GOOD_YIELD: 1.15,
    COUNTRY_SURPLUS: 0.2,
    RATE: Object.freeze({ land: 1.5, road: 0.5, river: 0.35, sea: 0.2 }),
    LANDING_KM: 8,
    OFF_ROUTE: 4,
    COUNTRY_REACH: 25,
    REACH: Object.freeze([
        Object.freeze({ upTo: 2500, km: 40 }),
        Object.freeze({ upTo: 8000, km: 80 }),
        Object.freeze({ upTo: 15000, km: 120 }),
        Object.freeze({ upTo: Infinity, km: 160 }),
    ]),
});

const TRADE_KINDS = ["road", "river", "sea"];

export function ownShare(place, settings = SUPPLY) {
    if (settings.VILLAGE_TIERS.includes(place.tier)) return settings.OWN_SHARE[0].share;
    return settings.OWN_SHARE.find((band) => (place.population ?? 0) <= band.upTo).share;
}

function reachOf(place, settings) {
    return settings.REACH.find((band) => (place.population ?? 0) <= band.upTo).km;
}

/**
 * Everything the plan needs from the parent, prepared once per map.
 * @param {object} parent
 * @param {{sites: ArrayLike<number>, people: ArrayLike<number>, landKm2: ArrayLike<number>, water: ArrayLike<number>, trade: {from: number[], to: number[], kind: number[]}}} parent.run
 * @param {{start: Int32Array, list: Int32Array}} parent.neighbours - The run's cells' Delaunay neighbours.
 * @param {number} parent.kmPerPx
 * @param {{id: string, name: string, x: number, y: number, population: number, tier: string}[]} parent.places
 */
export function prepareSupply({ run, neighbours, kmPerPx, places }, settings = SUPPLY) {
    const count = run.people.length;
    const sites = run.sites;
    // Each place stands in the cell whose site is nearest it
    const cellOfPlace = places.map((place) => nearestCell(sites, count, place.x, place.y));
    const townsPeople = places.reduce((a, p) => a + (p.population ?? 0), 0);
    const allPeople = Array.from(run.people).reduce((a, b) => a + b, 0);
    const urban = Math.min(0.9, townsPeople / Math.max(1, allPeople));
    // Edges: the trade's transport where the run carried trade, else by ground and water
    const tradeKind = new Map();
    for (let k = 0; k < run.trade.from.length; k++) tradeKind.set(edgeKey(run.trade.from[k], run.trade.to[k]), TRADE_KINDS[run.trade.kind[k]]);
    const edgeCost = (a, b) => {
        const km = Math.hypot(sites[2 * a] - sites[2 * b], sites[2 * a + 1] - sites[2 * b + 1]) * kmPerPx;
        const kind = tradeKind.get(edgeKey(a, b));
        const wa = run.water[a] > 0;
        const wb = run.water[b] > 0;
        let rate = settings.RATE.land;
        let mode = "land";
        if (kind) {
            rate = settings.RATE[kind];
            mode = kind;
        } else if (wa && wb) {
            rate = settings.RATE.sea;
            mode = "sea";
        }
        const landing = wa !== wb ? settings.LANDING_KM : 0;
        if (wa !== wb && !kind) mode = "sea";
        return { cost: km * rate + landing, km, mode, onRoute: !!kind };
    };
    return { run, neighbours, kmPerPx, places, cellOfPlace, urban, edgeCost, settings, count };
}

/**
 * The supply plan of every place on the map, and of one in detail.
 * @param {ReturnType<typeof prepareSupply>} prepared
 */
export function planSupply(prepared) {
    const { run, places, cellOfPlace, urban, settings, count } = prepared;
    // 1. Each cell's country people sell at the nearest place within a day's cart
    const isMarket = (index) => !settings.VILLAGE_TIERS.includes(places[index].tier);
    const markets = searchFrom(prepared, places.map((_, index) => index).filter(isMarket).sort((a, b) => (places[a].population ?? 0) - (places[b].population ?? 0) || a - b).map((index) => ({ cell: cellOfPlace[index], source: index })), settings.COUNTRY_REACH);
    const country = new Float64Array(places.length);
    const countryCells = places.map(() => []);
    for (let cell = 0; cell < count; cell++) {
        const at = markets.owner[cell];
        if (at < 0) continue;
        const people = run.people[cell] * (1 - urban);
        // Their store is kept at home; only the surplus comes to market
        const surplus = people * settings.COUNTRY_SURPLUS;
        if (surplus <= 0) continue;
        country[at] += surplus;
        countryCells[at].push({ cell, amount: surplus, cost: markets.cost[cell] });
    }
    // 2. Up the hierarchy, smallest first: what a place has beyond its needs goes to the nearest
    //    larger place within that place's reach
    // Villages first (they sell to markets of any size), then the markets smallest first
    const village = (index) => (settings.VILLAGE_TIERS.includes(places[index].tier) ? 0 : 1);
    const order = places.map((_, index) => index).sort((a, b) => village(a) - village(b) || (places[a].population ?? 0) - (places[b].population ?? 0) || a - b);
    const fromPlaces = new Float64Array(places.length);
    const ledgers = places.map((place, index) => ({
        // What its people eat and what it keeps in store against a poor harvest
        need: (place.population ?? 0) * (1 + settings.RESERVE),
        eaten: place.population ?? 0,
        reserve: (place.population ?? 0) * settings.RESERVE,
        own: (place.population ?? 0) * (1 + settings.RESERVE) * ownShare(place, settings),
        ownShare: ownShare(place, settings),
        country: country[index],
        fromPlaces: [],
        out: null,
        imports: 0,
        exports: 0,
    }));
    const maxReach = Math.max(...settings.REACH.map((band) => band.km));
    for (const index of order) {
        const ledger = ledgers[index];
        const balance = ledger.own + ledger.country + fromPlaces[index] - ledger.need;
        if (balance < 0) {
            ledger.imports = -balance;
            continue;
        }
        if (balance === 0) continue;
        const buyer = nearestLarger(prepared, index, maxReach);
        if (!buyer) {
            ledger.exports = balance;
            continue;
        }
        fromPlaces[buyer.place] += balance;
        const flow = { from: index, to: buyer.place, amount: balance, cost: buyer.cost, path: buyer.path, modes: buyer.modes };
        ledger.out = flow;
        ledgers[buyer.place].fromPlaces.push(flow);
    }
    return { ledgers, countryCells, markets, urban };
}

/** Multi-source search over the run's cells by cost of carriage, to `limit`. */
function searchFrom(prepared, sources, limit) {
    const { neighbours, edgeCost, count } = prepared;
    const cost = new Float64Array(count).fill(Infinity);
    const owner = new Int32Array(count).fill(-1);
    const previous = new Int32Array(count).fill(-1);
    const heap = new Heap();
    for (const { cell, source } of sources) {
        if (cost[cell] === 0) continue;
        cost[cell] = 0;
        owner[cell] = source;
        heap.push(0, cell);
    }
    while (heap.size) {
        const [c, cell] = heap.pop();
        if (c > cost[cell]) continue;
        for (let slot = neighbours.start[cell]; slot < neighbours.start[cell + 1]; slot++) {
            const next = neighbours.list[slot];
            const step = edgeCost(cell, next).cost;
            const total = c + step;
            if (total > limit || total >= cost[next]) continue;
            cost[next] = total;
            owner[next] = owner[cell];
            previous[next] = cell;
            heap.push(total, next);
        }
    }
    return { cost, owner, previous };
}

/** The nearest place larger than `index` within that place's own reach, with the way there. */
function nearestLarger(prepared, index, limit) {
    const { places, cellOfPlace, neighbours, edgeCost, count, settings } = prepared;
    const me = places[index];
    const start = cellOfPlace[index];
    const larger = new Map();
    places.forEach((place, other) => {
        if (other === index) return;
        // Villages sell to markets, never to each other
        if (settings.VILLAGE_TIERS.includes(place.tier)) return;
        const bigger = settings.VILLAGE_TIERS.includes(me.tier) || (place.population ?? 0) > (me.population ?? 0) || ((place.population ?? 0) === (me.population ?? 0) && other > index);
        if (!bigger) return;
        const cell = cellOfPlace[other];
        if (!larger.has(cell)) larger.set(cell, []);
        larger.get(cell).push(other);
    });
    const cost = new Map([[start, 0]]);
    const previous = new Map();
    const heap = new Heap();
    heap.push(0, start);
    while (heap.size) {
        const [c, cell] = heap.pop();
        if (c > (cost.get(cell) ?? Infinity)) continue;
        for (const other of larger.get(cell) ?? []) {
            if (c <= reachOf(places[other], settings)) return { place: other, cost: c, ...wayBack(prepared, previous, start, cell) };
        }
        for (let slot = neighbours.start[cell]; slot < neighbours.start[cell + 1]; slot++) {
            const next = neighbours.list[slot];
            // Goods between places go by the run's roads, rivers and sea lanes wherever they join;
            // off them the carts are slow (OFF_ROUTE times dearer)
            const edge = edgeCost(cell, next);
            const total = c + edge.cost * (edge.onRoute ? 1 : settings.OFF_ROUTE);
            if (total > limit || total >= (cost.get(next) ?? Infinity)) continue;
            cost.set(next, total);
            previous.set(next, cell);
            heap.push(total, next);
        }
    }
    void count;
    return null;
}

/** The cells from `start` to `end`, and the km carried by each mode and on the run's trade. */
function wayBack(prepared, previous, start, end) {
    const path = [end];
    while (path[path.length - 1] !== start) path.push(previous.get(path[path.length - 1]));
    path.reverse();
    const modes = { land: 0, road: 0, river: 0, sea: 0, km: 0, onRouteKm: 0 };
    for (let k = 0; k + 1 < path.length; k++) {
        const edge = prepared.edgeCost(path[k], path[k + 1]);
        modes[edge.mode] += edge.km;
        modes.km += edge.km;
        if (edge.onRoute) modes.onRouteKm += edge.km;
    }
    return { path, modes };
}

/**
 * One place's supply in brief: its need, its own fields' share, the country it buys from
 * (grouped by direction), the places that sell to it, where its surplus goes, and its imports
 * and exports. The balance error should be nought.
 */
export function supplyOf(prepared, plan, index) {
    const { run, places, kmPerPx } = prepared;
    const place = places[index];
    const ledger = plan.ledgers[index];
    const sx = place.x;
    const sy = place.y;
    const sectors = new Map();
    for (const { cell, amount, cost } of plan.countryCells[index]) {
        const dx = run.sites[2 * cell] - sx;
        const dy = run.sites[2 * cell + 1] - sy;
        const km = Math.hypot(dx, dy) * kmPerPx;
        const sector = km < 3 ? "here" : SECTORS[Math.round((((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360) / 45) % 8];
        const entry = sectors.get(sector) ?? { sector, amount: 0, cells: 0, nearestKm: Infinity, farthestKm: 0, cost: 0 };
        entry.amount += amount;
        entry.cells++;
        entry.nearestKm = Math.min(entry.nearestKm, km);
        entry.farthestKm = Math.max(entry.farthestKm, km);
        entry.cost = Math.max(entry.cost, cost);
        sectors.set(sector, entry);
    }
    const way = (path) => path.map((cell) => [run.sites[2 * cell], run.sites[2 * cell + 1]]);
    const fromPlaces = ledger.fromPlaces.map((flow) => ({ name: places[flow.from].name, tier: places[flow.from].tier, people: places[flow.from].population, amount: flow.amount, km: flow.modes.km, modes: flow.modes, way: way(flow.path) }));
    const totalIn = ledger.own + ledger.country + fromPlaces.reduce((a, f) => a + f.amount, 0) + ledger.imports;
    const totalOut = ledger.need + (ledger.out?.amount ?? 0) + ledger.exports;
    return {
        name: place.name,
        tier: place.tier,
        need: ledger.need,
        eaten: ledger.eaten,
        reserve: ledger.reserve,
        own: ledger.own,
        ownShare: ledger.ownShare,
        country: [...sectors.values()].sort((a, b) => b.amount - a.amount),
        countryTotal: ledger.country,
        fromPlaces: fromPlaces.sort((a, b) => b.amount - a.amount),
        out: ledger.out ? { name: places[ledger.out.to].name, tier: places[ledger.out.to].tier, amount: ledger.out.amount, km: ledger.out.modes.km, modes: ledger.out.modes, way: way(ledger.out.path) } : null,
        countryCells: plan.countryCells[index].map(({ cell, amount }) => ({ x: run.sites[2 * cell], y: run.sites[2 * cell + 1], amount })),
        imports: ledger.imports,
        exports: ledger.exports,
        balanceError: Math.abs(totalIn - totalOut) / Math.max(1, ledger.need),
    };
}

/**
 * A place on a map with no generator run (hand-placed pins and routes): its own fields' share as
 * usual, and the rest of its food simply from beyond its fields, since there is no run to trace
 * who sells it. The country round it is taken at COUNTRY_DENSITY_WITHOUT_RUN people per km².
 */
export const COUNTRY_DENSITY_WITHOUT_RUN = 20;

export function supplyWithoutRun(place, settings = SUPPLY) {
    const people = place.population ?? 0;
    const need = people * (1 + settings.RESERVE);
    const share = ownShare(place, settings);
    const own = need * share;
    return {
        name: place.name,
        tier: place.tier,
        need,
        eaten: people,
        reserve: people * settings.RESERVE,
        own,
        ownShare: share,
        country: [],
        countryTotal: 0,
        fromPlaces: [],
        out: null,
        countryCells: [],
        imports: Math.max(0, need - own),
        exports: Math.max(0, own - need),
        balanceError: 0,
        withoutRun: true,
    };
}

const SECTORS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

function nearestCell(sites, count, x, y) {
    let best = 0;
    let bestD = Infinity;
    for (let cell = 0; cell < count; cell++) {
        const d = (sites[2 * cell] - x) ** 2 + (sites[2 * cell + 1] - y) ** 2;
        if (d < bestD) {
            bestD = d;
            best = cell;
        }
    }
    return best;
}

function edgeKey(a, b) {
    return a < b ? a * 1048576 + b : b * 1048576 + a;
}

/** A small binary heap of [priority, value] pairs. */
class Heap {
    constructor() {
        this.items = [];
    }

    get size() {
        return this.items.length;
    }

    push(priority, value) {
        const items = this.items;
        items.push([priority, value]);
        let k = items.length - 1;
        while (k > 0) {
            const parent = (k - 1) >> 1;
            if (items[parent][0] <= items[k][0]) break;
            [items[parent], items[k]] = [items[k], items[parent]];
            k = parent;
        }
    }

    pop() {
        const items = this.items;
        const top = items[0];
        const last = items.pop();
        if (items.length) {
            items[0] = last;
            let k = 0;
            for (;;) {
                const l = 2 * k + 1;
                const r = l + 1;
                let m = k;
                if (l < items.length && items[l][0] < items[m][0]) m = l;
                if (r < items.length && items[r][0] < items[m][0]) m = r;
                if (m === k) break;
                [items[m], items[k]] = [items[k], items[m]];
                k = m;
            }
        }
        return top;
    }
}

/**
 * The supply plan of every place a settlement source holds (its run, its places), worked out once
 * per source: the run's cells and their neighbours, the places on them, the plan through the
 * hierarchy. A regional world's villages stand a few km apart, far finer than its parent's 25 km
 * cells, so its supply is worked over the in-fill cells, each holding its share of its parent
 * cell's people (the prototype's `tools/supply-inputs.mjs`).
 * @param {object} source - A settlement source (see LocalInput.inputFrom).
 * @returns {{prepared: object, plan: object, places: object[]}|null} null for a map with no run.
 */
export function supplyPlanOf(source) {
    if (!source.run) return null;
    const regional = source.places.some((place) => place.infill);
    const run = regional ? infillRun(source, source.run) : source.run;
    const delaunay = new Delaunay(Float64Array.from(run.sites));
    const count = run.people.length;
    const start = new Int32Array(count + 1);
    const list = [];
    for (let cell = 0; cell < count; cell++) {
        for (const next of delaunay.neighbors(cell)) list.push(next);
        start[cell + 1] = list.length;
    }
    const places = source.places.filter((place) => place.kind === "town" && place.population);
    const prepared = prepareSupply({ run, neighbours: { start, list: Int32Array.from(list) }, kmPerPx: run.kmPerPx, places });
    return { prepared, plan: planSupply(prepared), places };
}

/**
 * The run spread over a regional map's in-fill cells: each parent cell's people shared equally
 * among the land in-fill cells nearest its site; water from the pixel under each site; the map's
 * own routes as the trade edges.
 */
function infillRun(source, parent) {
    const { map, levels } = source;
    const level = levels.infill;
    const count = level.sites.length / 2;
    const parentCount = parent.people.length;
    const water = new Array(count).fill(0);
    const parentOf = new Int32Array(count);
    const children = new Int32Array(parentCount);
    for (let cell = 0; cell < count; cell++) {
        const x = level.sites[2 * cell];
        const y = level.sites[2 * cell + 1];
        const pixel = Math.min(map.height - 1, Math.floor(y)) * map.width + Math.min(map.width - 1, Math.floor(x));
        water[cell] = map.waterMask[pixel] > 0 || map.elevation[pixel] < map.seaLevel ? 1 : 0;
        let best = 0;
        let bestD = Infinity;
        for (let p = 0; p < parentCount; p++) {
            const d = (parent.sites[2 * p] - x) ** 2 + (parent.sites[2 * p + 1] - y) ** 2;
            if (d < bestD) {
                bestD = d;
                best = p;
            }
        }
        parentOf[cell] = best;
        if (!water[cell]) children[best]++;
    }
    const people = Array.from({ length: count }, (_, cell) => (water[cell] ? 0 : parent.people[parentOf[cell]] / Math.max(1, children[parentOf[cell]])));
    const from = [];
    const to = [];
    const kind = [];
    const seen = new Set();
    for (const route of map.routes) {
        const k = ["road", "river", "sea"].indexOf(route.transport);
        let last = -1;
        for (const display of route.cells) {
            const cell = level.of[display];
            if (last >= 0 && cell !== last) {
                const key = last < cell ? `${last},${cell}` : `${cell},${last}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    from.push(last);
                    to.push(cell);
                    kind.push(Math.max(0, k));
                }
            }
            last = cell;
        }
    }
    return { kmPerPx: parent.kmPerPx, spacingKm: null, sites: Array.from(level.sites), people, landKm2: people.map(() => 0), water, trade: { from, to, kind } };
}
