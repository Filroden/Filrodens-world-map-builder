/**
 * What the History tool works out from a run's ages, without the studio: which realm of one age
 * carries on as which realm of a later one, and what changed between two ages. Ages are compared
 * on the run's model cells, so the work is small whatever the map's size.
 */

/**
 * Matches each realm of an earlier age to the realm of a later age it carried on as, or -1.
 *
 * A realm carries on as the later realm holding its seat, or failing that the one holding most
 * of its land. Each later realm is matched once: seats first, then the largest overlaps, so when a
 * realm split, the part keeping its seat carries it on and the rest are new, and when two realms
 * became one, the one whose seat it kept (or else whose land it holds most of) carries on.
 *
 * @param {ArrayLike<number>} earlierRealm - Each model cell's realm in the earlier age, or -1.
 * @param {ArrayLike<number>} earlierSeats - Each earlier realm's seat (a model cell), or -1.
 * @param {ArrayLike<number>} laterRealm - Each model cell's realm in the later age, or -1.
 * @returns {Int32Array} For each earlier realm, its later realm, or -1.
 */
export function matchRealms(earlierRealm, earlierSeats, laterRealm) {
    const count = earlierSeats.length;
    const size = new Float64Array(count);
    const overlap = new Map();
    for (let cell = 0; cell < earlierRealm.length; cell++) {
        const from = earlierRealm[cell];
        if (!(from >= 0) || from >= count) continue;
        size[from] += 1;
        const to = laterRealm[cell];
        if (!(to >= 0)) continue;
        const key = from * 0x100000 + to;
        overlap.set(key, (overlap.get(key) ?? 0) + 1);
    }
    const pairs = [...overlap].map(([key, cells]) => {
        const from = Math.floor(key / 0x100000);
        const to = key % 0x100000;
        const seat = earlierSeats[from];
        return { from, to, cells, keepsSeat: seat >= 0 && laterRealm[seat] === to };
    });
    pairs.sort((a, b) => Number(b.keepsSeat) - Number(a.keepsSeat) || b.cells - a.cells || a.from - b.from || a.to - b.to);
    const match = new Int32Array(count).fill(-1);
    const taken = new Set();
    for (const { from, to, cells, keepsSeat } of pairs) {
        if (match[from] >= 0 || taken.has(to)) continue;
        if (!keepsSeat && cells / size[from] <= 0.5) continue;
        match[from] = to;
        taken.add(to);
    }
    return match;
}

/** The model cells a list of places stands on (cell, tier, seat triples). */
export function placeCells(places) {
    const cells = new Set();
    for (let index = 0; index + 2 < places.length; index += 3) cells.add(places[index]);
    return cells;
}

/**
 * Each culture's share of the peopled land: the model cells it is the main culture of, against
 * all the cells any culture is.
 * @param {ArrayLike<number>} cultureOfCell - Each model cell's main culture, or -1.
 * @param {number} cultureCount
 * @returns {Float64Array}
 */
export function cultureShares(cultureOfCell, cultureCount) {
    const cells = new Float64Array(cultureCount);
    let all = 0;
    for (const culture of cultureOfCell) {
        if (!(culture >= 0) || culture >= cultureCount) continue;
        cells[culture] += 1;
        all += 1;
    }
    return all ? cells.map((count) => count / all) : cells;
}

/**
 * What changed from one age to the next: the realms that fell (earlier realms carried on by none)
 * and rose (later realms carrying on none), how many places were founded and lost, and each
 * culture's share of the land then and after, for the cultures that hold any in either age.
 *
 * @param {{realm: ArrayLike<number>, seats: ArrayLike<number>, places: Set<number>, culture: ArrayLike<number>|null}} earlier
 * @param {{realm: ArrayLike<number>, realmCount: number, places: Set<number>, culture: ArrayLike<number>|null}} later
 * @param {number} cultureCount - The run's cultures.
 * @returns {{fell: number[], rose: number[], founded: number, lost: number, peoples: {culture: number, from: number, to: number}[]|null}}
 */
export function ageChanges(earlier, later, cultureCount) {
    const match = matchRealms(earlier.realm, earlier.seats, later.realm);
    const carried = new Set(match);
    const fell = [];
    match.forEach((to, from) => {
        if (to < 0) fell.push(from);
    });
    const rose = [];
    for (let realm = 0; realm < later.realmCount; realm++) if (!carried.has(realm)) rose.push(realm);
    let founded = 0;
    for (const cell of later.places) if (!earlier.places.has(cell)) founded += 1;
    let lost = 0;
    for (const cell of earlier.places) if (!later.places.has(cell)) lost += 1;
    let peoples = null;
    if (earlier.culture && later.culture) {
        const from = cultureShares(earlier.culture, cultureCount);
        const to = cultureShares(later.culture, cultureCount);
        peoples = [];
        for (let culture = 0; culture < cultureCount; culture++) if (from[culture] > 0 || to[culture] > 0) peoples.push({ culture, from: from[culture], to: to[culture] });
    }
    return { fell, rose, founded, lost, peoples };
}

/**
 * An age's roads as chains of model cells, for drawing as routes: each runs between two ends,
 * where an end is a place (a road's town), a junction or a road's end, so a chain never runs
 * through a town or a fork. Roads closing a loop with no end on it make one chain round it.
 *
 * @param {ArrayLike<number>} from - Each road's first model cell.
 * @param {ArrayLike<number>} to - Each road's other model cell.
 * @param {Set<number>} places - The age's place cells.
 * @returns {number[][]} Each chain's cells, in order.
 */
export function chainRoads(from, to, places) {
    const links = new Map();
    const link = (a, b, road) => {
        if (!links.has(a)) links.set(a, []);
        links.get(a).push({ next: b, road });
    };
    for (let road = 0; road < from.length; road++) {
        if (from[road] === to[road]) continue;
        link(from[road], to[road], road);
        link(to[road], from[road], road);
    }
    const isEnd = (cell) => places.has(cell) || links.get(cell).length !== 2;
    const used = new Uint8Array(from.length);
    const chains = [];
    const walk = (start, first) => {
        const cells = [start];
        let { next, road } = first;
        while (!used[road]) {
            used[road] = 1;
            cells.push(next);
            if (isEnd(next)) break;
            const onward = links.get(next).find((step) => !used[step.road]);
            if (!onward) break;
            ({ next, road } = onward);
        }
        return cells;
    };
    // Ends first, in cell order so the chains come out the same each time
    const cells = [...links.keys()].sort((a, b) => a - b);
    for (const cell of cells) {
        if (!isEnd(cell)) continue;
        for (const step of links.get(cell)) if (!used[step.road]) chains.push(walk(cell, step));
    }
    for (const cell of cells) for (const step of links.get(cell)) if (!used[step.road]) chains.push(walk(cell, step));
    return chains;
}
