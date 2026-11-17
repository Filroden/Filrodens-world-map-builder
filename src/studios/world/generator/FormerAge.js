import { EDGE } from "./CellGraph.js";

/**
 * What the age before the present leaves on the map (see Pipeline's ages):
 *
 * - **Ruins:** its towns with no town or castle on their cell now. A ruin keeps the name its people
 *   gave it (their culture's name base then, so possibly another people's names).
 * - **Abandoned castles:** its castles with no castle or town on their cell now.
 * - **Former capitals:** its realm seats that are no realm's seat now, whether a town still stands
 *   there (the place is marked) or a ruin.
 * - **Old roads:** the land edges that carried its trade and carry none now (sea lanes and river
 *   trade leave nothing behind).
 *
 * Platform-neutral, run in the worker with the rest of the run.
 */

/**
 * @param {import("./CellGraph.js").CellGraph} graph
 * @param {object} before - The age before: { cultures, feedback, finalTrade, finalRealms }.
 * @param {object} now - The present, likewise.
 * @param {string} nameBase - The run's name style, for the default culture.
 * @returns {{ruins: object[], castles: object[], formerSeats: Set<number>, oldTraffic: Float64Array}}
 */
export function formerAge(graph, before, now, nameBase) {
    const townsNow = new Set(now.finalTrade.towns.map((town) => town.cell));
    const castlesNow = new Set(now.feedback.castles.map((castle) => castle.cell));
    const seatsNow = new Set(now.finalRealms.realms.map((realm) => realm.seat));
    const seatsThen = new Set(before.finalRealms.realms.map((realm) => realm.seat));
    const baseAt = (cell, culture = -1) => {
        const index = culture >= 0 ? culture : before.cultures.dominant[cell];
        return before.cultures.cultures[index]?.nameBase ?? nameBase;
    };
    const ruins = before.finalTrade.towns
        .filter((town) => !townsNow.has(town.cell) && !castlesNow.has(town.cell))
        .map((town) => ({ cell: town.cell, formerTier: town.tier, formerCapital: seatsThen.has(town.cell), population: town.population, nameBase: baseAt(town.cell, town.culture ?? -1) }));
    const castles = before.feedback.castles
        .filter((castle) => !castlesNow.has(castle.cell) && !townsNow.has(castle.cell))
        .map((castle) => ({ cell: castle.cell, nameBase: baseAt(castle.cell) }));
    const formerSeats = new Set([...seatsThen].filter((cell) => !seatsNow.has(cell)));
    const oldTraffic = new Float64Array(graph.edgeCount);
    const thenTraffic = before.finalTrade.traffic;
    const nowTraffic = now.finalTrade.traffic;
    for (let edge = 0; edge < graph.edgeCount; edge++) {
        if (thenTraffic[edge] > 0 && !(nowTraffic[edge] > 0) && graph.edgeKind[edge] === EDGE.LAND) oldTraffic[edge] = thenTraffic[edge];
    }
    return { ruins, castles, formerSeats, oldTraffic };
}
