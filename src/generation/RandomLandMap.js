import { Delaunay } from "../../vendor/d3-delaunay/d3-delaunay.js";
import { FILRODENSWMB } from "../config.js";
import { LandMaskGenerator } from "./LandMaskGenerator.js";

/**
 * Makes a random set of land masks covering the map and its canvas buffer, for Guided mode's
 * random map button.
 *
 * The area is divided into Voronoi cells, and the cells are grouped into irregular regions by
 * growing every region outwards from a random cell at its own random speed. The largest regions
 * (with some randomness) become land until a target share of the map is land, so there is
 * usually more land than sea and the landmasses are usually larger than the seas between them.
 * A share of the cells along each coast is then swapped between land and sea, which roughens the
 * coastlines and scatters small islands and lakes.
 *
 * The land cells' outlines are traced into masks. An outline around land becomes an "add" mask
 * and an outline around a lake or inland sea becomes a "subtract" mask. Masks are ordered from
 * the largest outline to the smallest: an outline always encloses a larger area than any outline
 * inside it, and the last mask covering a point decides it, so a lake inside a continent and an
 * island inside that lake both come out right.
 *
 * Everything here is pure: the caller passes the random number source, so results can be
 * reproduced and tested outside Foundry.
 */
export class RandomLandMap {
    /**
     * @param {object} options
     * @param {number} options.mapWidth - Map width in pixels.
     * @param {number} options.mapHeight - Map height in pixels.
     * @param {function(): number} [options.random] - Uniform random numbers in [0, 1).
     * @returns {Array<{operation: "add"|"subtract", points: Array<{x: number, y: number}>}>}
     *   The new masks, in the order they must be applied.
     */
    static generate({ mapWidth, mapHeight, random = Math.random }) {
        const map = { width: mapWidth, height: mapHeight, buffer: FILRODENSWMB.UI.CANVAS_BUFFER };
        const sites = RandomLandMap.#scatterSites(map, random);
        const delaunay = Delaunay.from(sites);
        const voronoi = delaunay.voronoi([-map.buffer, -map.buffer, map.width + map.buffer, map.height + map.buffer]);
        const neighbours = sites.map((_, cell) => [...delaunay.neighbors(cell)]);

        const regions = RandomLandMap.#growRegions(neighbours, random);
        const land = RandomLandMap.#chooseLand(regions, sites, map, random);
        RandomLandMap.#raggedCoasts(land, neighbours, random);

        return RandomLandMap.#traceOutlines(voronoi, land)
            .sort((a, b) => Math.abs(b.area) - Math.abs(a.area))
            .map((outline) => ({ operation: outline.area > 0 ? "add" : "subtract", points: RandomLandMap.#roundedOutline(outline.points) }))
            .filter((mask) => mask.points.length >= FILRODENSWMB.LIMITS.MIN_POLYGON_VERTICES);
    }

    // ------------------------------------------------------------------------------------------
    // Cells and regions
    // ------------------------------------------------------------------------------------------

    /**
     * Scatters one Voronoi site in every square of a grid over the map and its buffer, at a
     * random spot within its square. This spreads cells evenly (no clumps or gaps, as purely
     * random sites would give) while keeping their shapes irregular.
     *
     * @returns {Array<[number, number]>}
     */
    static #scatterSites(map, random) {
        const scale = Math.sqrt(Math.min(map.width, map.height) / FILRODENSWMB.LIMITS.BASELINE_DIMENSION);
        const spacing = FILRODENSWMB.RANDOM_LAND_MAP.CELL_SPACING * scale;
        const maxX = map.width + map.buffer;
        const maxY = map.height + map.buffer;
        const sites = [];

        for (let y = -map.buffer; y < maxY; y += spacing) {
            for (let x = -map.buffer; x < maxX; x += spacing) {
                sites.push([Math.min(maxX, x + random() * spacing), Math.min(maxY, y + random() * spacing)]);
            }
        }

        return sites;
    }

    /**
     * Groups every cell into a region. Each region starts at a random cell and repeatedly claims a
     * random unclaimed cell on its border; which region claims next is chosen at random, weighted
     * by each region's growth rate, so regions end up with irregular shapes and a wide mix of
     * sizes. The growth ends when every cell has been claimed.
     *
     * @returns {{regionOf: Int32Array, regions: Array<{cells: number}>}}
     */
    static #growRegions(neighbours, random) {
        const settings = FILRODENSWMB.RANDOM_LAND_MAP;
        const cellCount = neighbours.length;
        const regionOf = new Int32Array(cellCount).fill(-1);
        const regionCount = Math.min(cellCount, RandomLandMap.#integerBetween(random, settings.GROUPS.MIN, settings.GROUPS.MAX));

        const regions = [];
        for (let index = 0; index < regionCount; index++) {
            const start = RandomLandMap.#randomUnclaimedCell(regionOf, random);
            regionOf[start] = index;
            regions.push({ cells: 1, rate: RandomLandMap.#between(random, settings.GROWTH_RATE.MIN, settings.GROWTH_RATE.MAX), border: [...neighbours[start]] });
        }

        let unclaimed = cellCount - regionCount;
        while (unclaimed > 0) {
            const region = RandomLandMap.#pickGrowingRegion(regions, random);
            if (!region) break;
            if (RandomLandMap.#claimBorderCell(region, regions.indexOf(region), regionOf, neighbours, random)) unclaimed--;
        }

        return { regionOf, regions: regions.map((region) => ({ cells: region.cells })) };
    }

    /** A random cell no region has claimed yet (there is always one while regions are being seeded). */
    static #randomUnclaimedCell(regionOf, random) {
        let cell;
        do {
            cell = Math.floor(random() * regionOf.length);
        } while (regionOf[cell] >= 0);
        return cell;
    }

    /** Picks a region that can still grow, weighted by growth rate, or null when none can. */
    static #pickGrowingRegion(regions, random) {
        const growing = regions.filter((region) => region.border.length > 0);
        const totalRate = growing.reduce((sum, region) => sum + region.rate, 0);

        let remaining = random() * totalRate;
        for (const region of growing) {
            remaining -= region.rate;
            if (remaining <= 0) return region;
        }

        return growing.at(-1) ?? null;
    }

    /**
     * Takes a random cell off a region's border and claims it, adding its unclaimed neighbours to
     * the border. A border cell may already have been claimed by another region since it was
     * added, in which case it is simply dropped.
     *
     * @returns {boolean} Whether a cell was claimed.
     */
    static #claimBorderCell(region, index, regionOf, neighbours, random) {
        const position = Math.floor(random() * region.border.length);
        const cell = region.border[position];
        // Swap-remove: order does not matter, and it avoids shifting the whole array
        region.border[position] = region.border.at(-1);
        region.border.pop();

        if (regionOf[cell] >= 0) return false;

        regionOf[cell] = index;
        region.cells++;
        for (const next of neighbours[cell]) {
            if (regionOf[next] < 0) region.border.push(next);
        }
        return true;
    }

    /**
     * Makes regions land, largest first (each size scaled by a random factor), until the target
     * share of the map is land. Only cells whose sites lie inside the map are counted, so the
     * buffer does not affect how much of the visible map is land. A region that would overshoot
     * the target by too much is skipped in favour of smaller ones, unless nothing is land yet.
     *
     * @returns {Uint8Array} 1 for every land cell, 0 for sea.
     */
    static #chooseLand({ regionOf, regions }, sites, map, random) {
        const settings = FILRODENSWMB.RANDOM_LAND_MAP;
        const onMap = RandomLandMap.#cellsOnMapPerRegion(regionOf, regions.length, sites, map);
        const totalOnMap = onMap.reduce((sum, count) => sum + count, 0) || 1;
        const target = RandomLandMap.#between(random, settings.LAND_SHARE.MIN, settings.LAND_SHARE.MAX);

        const order = regions
            .map((region, index) => ({ index, score: region.cells * RandomLandMap.#between(random, settings.SIZE_JITTER.MIN, settings.SIZE_JITTER.MAX) }))
            .sort((a, b) => b.score - a.score);

        const isLandRegion = new Uint8Array(regions.length);
        let landOnMap = 0;
        for (const { index } of order) {
            if (landOnMap / totalOnMap >= target) break;
            const overshoots = (landOnMap + onMap[index]) / totalOnMap > target + settings.LAND_OVERSHOOT;
            if (overshoots && landOnMap > 0) continue;

            isLandRegion[index] = 1;
            landOnMap += onMap[index];
        }

        return Uint8Array.from(regionOf, (region) => isLandRegion[region]);
    }

    /** How many of each region's cells have their site inside the map. */
    static #cellsOnMapPerRegion(regionOf, regionCount, sites, map) {
        const counts = new Array(regionCount).fill(0);
        sites.forEach(([x, y], cell) => {
            if (x >= 0 && x <= map.width && y >= 0 && y <= map.height) counts[regionOf[cell]]++;
        });
        return counts;
    }

    /**
     * Swaps a random share of the coastal cells (cells with a neighbour of the other kind)
     * between land and sea. The coastal cells are all found before any is swapped, so a swap
     * cannot make its neighbour coastal and be followed by another in the same pass.
     */
    static #raggedCoasts(land, neighbours, random) {
        const share = FILRODENSWMB.RANDOM_LAND_MAP.COAST_RAGGING;
        const coastal = [];

        for (let cell = 0; cell < land.length; cell++) {
            if (neighbours[cell].some((next) => land[next] !== land[cell])) coastal.push(cell);
        }
        for (const cell of coastal) {
            if (random() < share) land[cell] ^= 1;
        }
    }

    // ------------------------------------------------------------------------------------------
    // Outlines
    // ------------------------------------------------------------------------------------------

    /**
     * Traces the outlines of the land cells.
     *
     * Every land cell's polygon is walked in the same direction (the one that gives it a positive
     * signed area), giving directed edges. An edge shared by two land cells appears once in each
     * direction, so both copies are removed; what remains are the edges between land and sea (or
     * the edge of the buffer). Chaining the remaining edges end to start gives closed outlines.
     * Outlines around land keep the cells' direction and have a positive signed area; outlines
     * around lakes run the other way and have a negative one.
     *
     * Where two land cells touch only at a corner, two outlines meet at that corner and the chain
     * may join them into one outline that passes through it twice. Masks are filled even-odd, so
     * such an outline fills exactly the same area as the two separate ones would.
     *
     * @returns {Array<{points: Array<{x: number, y: number}>, area: number}>}
     */
    static #traceOutlines(voronoi, land) {
        const edges = RandomLandMap.#coastEdges(voronoi, land);
        const edgesFrom = new Map();
        for (const edge of edges.values()) {
            if (!edgesFrom.has(edge.fromKey)) edgesFrom.set(edge.fromKey, []);
            edgesFrom.get(edge.fromKey).push(edge);
        }

        const outlines = [];
        for (const waiting of edgesFrom.values()) {
            while (waiting.length > 0) {
                const points = RandomLandMap.#followOutline(waiting.pop(), edgesFrom);
                if (points.length >= FILRODENSWMB.LIMITS.MIN_POLYGON_VERTICES) outlines.push({ points, area: RandomLandMap.#signedArea(points) });
            }
        }

        return outlines;
    }

    /**
     * The directed edges of the land cells that do not border another land cell, keyed by
     * "from|to". Corners are matched by their coordinates rounded to CORNER_PRECISION.
     *
     * @returns {Map<string, {from: number[], fromKey: string, toKey: string}>}
     */
    static #coastEdges(voronoi, land) {
        const edges = new Map();

        for (let cell = 0; cell < land.length; cell++) {
            if (!land[cell]) continue;

            const corners = RandomLandMap.#orientedCell(voronoi, cell);
            for (let i = 0; i < corners.length; i++) {
                RandomLandMap.#toggleEdge(edges, corners[i], corners[(i + 1) % corners.length]);
            }
        }

        return edges;
    }

    /**
     * Adds a directed edge, or removes its reverse when a neighbouring land cell has already
     * added it (the edge is then inside the land, not on its coast).
     */
    static #toggleEdge(edges, from, to) {
        const fromKey = RandomLandMap.#cornerKey(from);
        const toKey = RandomLandMap.#cornerKey(to);
        if (fromKey === toKey) return;

        const reverseKey = `${toKey}|${fromKey}`;
        if (edges.has(reverseKey)) edges.delete(reverseKey);
        else edges.set(`${fromKey}|${toKey}`, { from, fromKey, toKey });
    }

    /** A Voronoi cell's corners (without the repeated closing corner), ordered to give a positive signed area. */
    static #orientedCell(voronoi, cell) {
        const polygon = voronoi.cellPolygon(cell);
        if (!polygon) return [];

        const corners = polygon.slice(0, -1);
        const area = RandomLandMap.#signedArea(corners.map(([x, y]) => ({ x, y })));
        return area < 0 ? corners.reverse() : corners;
    }

    /** Follows coast edges from `edge` until the outline closes, consuming them as it goes. */
    static #followOutline(edge, edgesFrom) {
        const points = [];
        let current = edge;

        while (current) {
            points.push({ x: current.from[0], y: current.from[1] });
            current = edgesFrom.get(current.toKey)?.pop() ?? null;
        }

        return points;
    }

    static #cornerKey([x, y]) {
        const precision = FILRODENSWMB.RANDOM_LAND_MAP.CORNER_PRECISION;
        return `${x.toFixed(precision)},${y.toFixed(precision)}`;
    }

    /** An outline with its nodes rounded to whole pixels and its unneeded nodes removed. */
    static #roundedOutline(points) {
        return LandMaskGenerator.tidyOutline(points.map((point) => ({ x: Math.round(point.x), y: Math.round(point.y) })));
    }

    /** The signed area of a closed outline (shoelace formula); its sign gives the outline's direction. */
    static #signedArea(points) {
        let doubled = 0;
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
            doubled += points[j].x * points[i].y - points[i].x * points[j].y;
        }
        return doubled / 2;
    }

    // ------------------------------------------------------------------------------------------
    // Number helpers
    // ------------------------------------------------------------------------------------------

    /** A uniform random number between `min` and `max`. */
    static #between(random, min, max) {
        return min + (max - min) * random();
    }

    /** A uniform random whole number from `min` to `max`, both included. */
    static #integerBetween(random, min, max) {
        return min + Math.floor(random() * (max - min + 1));
    }
}
