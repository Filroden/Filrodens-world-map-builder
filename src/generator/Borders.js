import { FILRODENSWMB } from "../config.js";
import { politicalCost } from "./CellGraph.js";
import { closedness } from "./Cultures.js";

/**
 * Border danger by neighbour: for every pair of neighbouring land cells in different realms, the
 * hostility felt on each side from the realm across it, the product of
 * - power: the weaker side of a mismatched border fears more, the stronger less (but never
 *   nothing: raids and rebels);
 * - permeability: a crossing over hard ground (mountains, marsh, dense forest) is safer than open
 *   ground, measured against the typical crossing of all the borders;
 * - culture: different cultures meeting are more hostile, the more closed either is.
 */

/**
 * @param {object} options
 * @param {import("./CellGraph.js").CellGraph} options.graph
 * @param {Int32Array} options.realmOfCell
 * @param {{pop: number}[]} options.realms
 * @param {import("./Cultures.js").CultureData} options.cultures
 * @returns {{a: number, b: number, hostilityA: number, hostilityB: number}[]} One entry per border
 *     cell pair; hostilityA is felt in cell a from b's realm.
 */
export function borderHostility({ graph, realmOfCell, realms, cultures }) {
    const ground = graph.costs(politicalCost(graph, { road: new Uint8Array(graph.edgeCount) }));
    const pairs = borderPairs(graph, realmOfCell);
    const ratio = (edge) => ground[edge] / graph.edgeKm[edge];
    const sorted = pairs.map((pair) => ratio(pair.edge)).sort((x, y) => x - y);
    const typical = sorted[Math.floor(sorted.length / 2)] || 1;
    const power = realms.map((realm) => realm.pop || 1);
    const side = (own, other, edge) => sideHostility({ power, realmOfCell, cultures, typical, ratio: ratio(edge) }, own, other);
    return pairs.map(({ a, b, edge }) => ({ a, b, hostilityA: side(a, b, edge), hostilityB: side(b, a, edge) }));
}

/** Every pair of neighbouring land cells held by different realms, once each. */
function borderPairs(graph, realmOfCell) {
    const { water } = graph.cells;
    const pairs = [];
    for (let edge = 0; edge < graph.edgeCount; edge++) {
        const a = graph.edgeA[edge];
        const b = graph.edgeB[edge];
        if (water[a] || water[b]) continue;
        if (realmOfCell[a] < 0 || realmOfCell[b] < 0 || realmOfCell[a] === realmOfCell[b]) continue;
        pairs.push({ a, b, edge });
    }
    return pairs;
}

function sideHostility({ power, realmOfCell, cultures, typical, ratio }, own, other) {
    const B = FILRODENSWMB.GENERATOR.BORDERS;
    const ownPower = power[realmOfCell[own]];
    const otherPower = power[realmOfCell[other]];
    const mismatch = Math.max(B.POWER_FLOOR, ((2 * otherPower) / (ownPower + otherPower)) ** B.POWER_EXP);
    const permeability = Math.max(B.PERMEABILITY_FLOOR, Math.min(B.PERMEABILITY_MAX, typical / ratio));
    const culture = 1 + FILRODENSWMB.GENERATOR.CULTURES.HOSTILITY * closedness(cultures.cultures, cultures.dominant[own], cultures.dominant[other]);
    return Math.min(B.HOSTILITY_MAX, mismatch * permeability * culture);
}

/** The hostility felt in each border cell (the most threatening neighbour wins), as a Map cell -> h. */
export function cellHostility(borders) {
    const felt = new Map();
    for (const { a, b, hostilityA, hostilityB } of borders) {
        felt.set(a, Math.max(felt.get(a) ?? 0, hostilityA));
        felt.set(b, Math.max(felt.get(b) ?? 0, hostilityB));
    }
    return felt;
}
