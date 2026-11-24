/**
 * What kind of place a settlement is, read from its parent map: the context a local map is drawn
 * to agree with.
 *
 * A settlement is read from the one cell it was made at, never from the cells around it: a place
 * the generator's run made, from its model cell (about 25 km); an in-fill place or a hand-placed
 * pin, from its in-fill cell (about 5 km). Pins rarely lie exactly on their coast or river, so the
 * whole cell counts, not the pin's pixel.
 *
 * - **Water:** the sea and lakes in the cell. A cell with both is read as coastal, unless a water
 *   route through it runs on the lake and none on the sea. The shape comes from walking the cell's
 *   border: each unbroken stretch of sea along it, long enough to count, is one coast. No stretch
 *   of land long enough to count makes an island; two or more coasts (the land reaching the sea
 *   on both sides of it) a headland or peninsula; one coast, or sea that never reaches the border,
 *   the coast. A lake gives a shore, never a shape.
 * - **Rivers:** the drawn rivers through the cell, each with the bearings at which it enters and
 *   leaves it and its size. Water features meeting in one cell make the settlement their meeting
 *   place: a river with the sea or a lake is a river mouth (into that water), weighted above two
 *   rivers meeting (a confluence).
 * - **Routes:** the routes through the cell, with the bearing at which each leaves it.
 * - **Relief:** the only reading that looks beyond the cell, since a hill or a valley is a height
 *   against the land round it: the cell's mean height against its neighbours', and a plane
 *   through them all (the lie of the land).
 *
 * Bearings are compass degrees: 0 north (up the map), 90 east, clockwise.
 *
 * Pure: takes typed arrays and plain records, so it runs in Node, a worker or the browser alike.
 */

/** River width in metres from upstream length in km (the town prototype's rule): 2.4 x sqrt(km). */
const RIVER_WIDTH_PER_ROOT_KM = 2.4;
const RIVER_WIDTH_MIN_M = 4;
/**
 * A stretch of sea (or of land) along the cell's border counts only when it is at least this share
 * of the whole border, so a corner clipped by the sea is not a coast. Ken's readings of EXBQDK
 * (2026-10-28) agree for any value from 0.06 to 0.14.
 */
const STRETCH_MIN_SHARE = 0.1;
/** The border is walked in this many steps of bearing round the cell's middle. */
const BORDER_STEPS = 180;
/** Water in the cell counts only from this many pixels, so a speck does not make a coast or a shore. */
const WATER_MIN_PIXELS = 3;
/** Bearings closer than this (degrees) are one direction when routes are merged. */
const SAME_BEARING = 25;
/** Height against neighbours, in their own spread: above this a hill, below its negative a valley. */
const RELIEF_STANDOUT = 0.8;
/** Below this many metres of difference a site is neither on a hill nor in a valley. */
const RELIEF_MIN_M = 15;
/** Slope (metres per km) below which the land reads as level. */
const LEVEL_M_PER_KM = 3;
/** Water routes are those that travel on water. */
const WATER_TRANSPORTS = new Set(["sea", "river"]);

export const KINDS = Object.freeze(["island", "peninsula", "riverMouth", "confluence", "coastal", "lakeside", "riverTown", "inland"]);
export const LIES = Object.freeze(["hill", "valley", "slope", "level"]);

/**
 * Everything one level of cells needs prepared once per map.
 * @param {object} map
 * @param {number} map.width
 * @param {number} map.height
 * @param {number} map.kmPerPx - Effective km per map pixel.
 * @param {number} map.seaLevel
 * @param {number} map.metresPerUnit
 * @param {Float32Array} map.elevation
 * @param {Float32Array} map.waterMask - Above 0 where a pixel is lake.
 * @param {Int32Array} map.displayRaster - The display cell under each pixel.
 * @param {Float64Array|Float32Array} map.displaySites - Display sites, [x0, y0, x1, y1, ...].
 * @param {{pixelsPerBaseline: number, rivers: {id: string, mergeInto: string|object|null, path: number[][], flow: number[]|null}[]}} map.rivers
 * @param {{cells: number[], transport: string, class: string|null}[]} map.routes - Routes as display cells.
 * @param {object} level - The cells read at this level.
 * @param {Int32Array} level.of - Each display cell's cell at this level.
 * @param {Float64Array|Float32Array} level.sites - This level's sites.
 * @param {Int32Array} level.neighbourStart
 * @param {Int32Array} level.neighbourList
 */
export function prepareMap(map, level) {
    const cellCount = level.sites.length / 2;
    const cellRaster = new Int32Array(map.displayRaster.length);
    for (let pixel = 0; pixel < cellRaster.length; pixel++) cellRaster[pixel] = level.of[map.displayRaster[pixel]];
    const cells = summariseCells(map, cellRaster, cellCount);
    const riverKm = map.rivers.pixelsPerBaseline * map.kmPerPx;
    const rivers = map.rivers.rivers.map((river) => ({
        id: river.id,
        // The river this one flows into (saved either as its id or as { id, index })
        mergeInto: river.mergeInto?.id ?? river.mergeInto ?? null,
        path: river.path,
        km: river.flow ? river.flow.map((flow) => flow * riverKm) : null,
    }));
    const prepared = { map, level, cellRaster, cellCount, cells, rivers, riversInCell: new Map(), routesInCell: new Map() };
    for (const river of rivers) {
        river.path.forEach(([x, y], point) => {
            const cell = cellOf(prepared, x, y);
            let list = prepared.riversInCell.get(cell);
            if (!list) prepared.riversInCell.set(cell, (list = new Map()));
            if (!list.has(river)) list.set(river, []);
            list.get(river).push(point);
        });
    }
    map.routes.forEach((route, index) => {
        route.cells.forEach((display, position) => {
            const cell = level.of[display];
            if (!prepared.routesInCell.has(cell)) prepared.routesInCell.set(cell, []);
            prepared.routesInCell.get(cell).push({ index, position });
        });
    });
    prepared.spacing = medianSpacing(level, cellCount);
    return prepared;
}

/** Per-cell pixel counts (sea, lake, land), mean land height in metres and bounding box. */
function summariseCells(map, cellRaster, cellCount) {
    const { width, height, elevation, waterMask, seaLevel, metresPerUnit } = map;
    const pixels = new Int32Array(cellCount);
    const sea = new Int32Array(cellCount);
    const lake = new Int32Array(cellCount);
    const land = new Int32Array(cellCount);
    const heightSum = new Float64Array(cellCount);
    const box = new Int32Array(cellCount * 4);
    for (let cell = 0; cell < cellCount; cell++) box.set([width, height, -1, -1], cell * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const pixel = y * width + x;
            const cell = cellRaster[pixel];
            pixels[cell]++;
            const at = cell * 4;
            if (x < box[at]) box[at] = x;
            if (y < box[at + 1]) box[at + 1] = y;
            if (x > box[at + 2]) box[at + 2] = x;
            if (y > box[at + 3]) box[at + 3] = y;
            if (waterMask[pixel] > 0) lake[cell]++;
            else if (elevation[pixel] < seaLevel) sea[cell]++;
            else {
                land[cell]++;
                heightSum[cell] += (elevation[pixel] - seaLevel) * metresPerUnit;
            }
        }
    }
    const heightM = new Float32Array(cellCount);
    for (let cell = 0; cell < cellCount; cell++) heightM[cell] = land[cell] ? heightSum[cell] / land[cell] : 0;
    return { pixels, sea, lake, land, heightM, box };
}

/** The median distance between neighbouring sites, in pixels (sampled). */
function medianSpacing(level, cellCount) {
    const distances = [];
    const step = Math.max(1, Math.floor(cellCount / 4000));
    for (let cell = 0; cell < cellCount; cell += step) {
        for (const next of neighbours(level, cell)) distances.push(Math.hypot(level.sites[2 * next] - level.sites[2 * cell], level.sites[2 * next + 1] - level.sites[2 * cell + 1]));
    }
    distances.sort((a, b) => a - b);
    return distances[Math.floor(distances.length / 2)];
}

function cellOf(prepared, x, y) {
    const { map } = prepared;
    const px = Math.max(0, Math.min(map.width - 1, Math.floor(x)));
    const py = Math.max(0, Math.min(map.height - 1, Math.floor(y)));
    return prepared.cellRaster[py * map.width + px];
}

function neighbours(level, cell) {
    return level.neighbourList.subarray(level.neighbourStart[cell], level.neighbourStart[cell + 1]);
}

/** Compass bearing (0 north, clockwise) from one point to another in map pixels (y down). */
export function bearingOf(dx, dy) {
    const degrees = (Math.atan2(dx, -dy) * 180) / Math.PI;
    return (Math.round(degrees) + 360) % 360;
}

const POINTS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
export function compassPoint(bearing) {
    return POINTS[Math.round(bearing / 22.5) % 16];
}

function angleBetween(a, b) {
    const difference = Math.abs(a - b) % 360;
    return difference > 180 ? 360 - difference : difference;
}

/**
 * The context of one settlement.
 * @param {ReturnType<typeof prepareMap>} prepared
 * @param {{x: number, y: number}} place
 * @param {number} cell - The cell it is read from, at the prepared level.
 */
export function readContext(prepared, place, cell) {
    const { map, level } = prepared;
    const home = cell;
    const origin = { x: place.x, y: place.y };
    const pixels = cellPixels(prepared, home);
    const sea = readWaterBody(prepared, home, pixels, origin, (pixel) => map.waterMask[pixel] <= 0 && map.elevation[pixel] < map.seaLevel);
    const lake = readWaterBody(prepared, home, pixels, origin, (pixel) => map.waterMask[pixel] > 0);
    const routes = readRoutes(prepared, home, origin);
    const rivers = readRivers(prepared, home, origin);
    const body = chooseWater(prepared, home, sea, lake);
    const relief = readRelief(prepared, home);
    const kind = classify(body, sea, lake, rivers);
    return {
        cell: home,
        cellKm: +(prepared.spacing * map.kmPerPx).toFixed(1),
        siteOffsetKm: +(Math.hypot(level.sites[2 * home] - origin.x, level.sites[2 * home + 1] - origin.y) * map.kmPerPx).toFixed(2),
        kind: kind.primary,
        tags: kind.tags,
        water: body ? { body: body.name, chosenBy: body.why, side: body.reading.side } : null,
        sea: sea.present ? sea : null,
        lake: lake.present ? { pixels: lake.pixels, share: lake.share, side: lake.side } : null,
        mouthInto: kind.primary === "riverMouth" ? body.name : null,
        lie: relief.lie,
        rivers,
        routes,
        relief,
    };
}

/** The pixels of one cell, as indices. */
function cellPixels(prepared, cell) {
    const { map, cells, cellRaster } = prepared;
    const [x0, y0, x1, y1] = cells.box.subarray(cell * 4, cell * 4 + 4);
    const list = [];
    for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
            const pixel = y * map.width + x;
            if (cellRaster[pixel] === cell) list.push(pixel);
        }
    }
    return list;
}

/**
 * One kind of water in the cell: how much, its side (the bearing of its middle from the pin), and
 * the stretches of it and of land along the cell's border. The border is walked round the cell's
 * middle in BORDER_STEPS steps of bearing; each step is water or land by most of its border pixels,
 * and runs of like steps are measured in border pixels, as shares of the whole border.
 */
function readWaterBody(prepared, cell, pixels, origin, isWater) {
    const { map, cellRaster } = prepared;
    let cx = 0;
    let cy = 0;
    for (const pixel of pixels) {
        cx += (pixel % map.width) + 0.5;
        cy += Math.floor(pixel / map.width) + 0.5;
    }
    cx /= pixels.length || 1;
    cy /= pixels.length || 1;
    const border = new Int32Array(BORDER_STEPS);
    const borderWater = new Int32Array(BORDER_STEPS);
    const outside = (x, y) => x < 0 || y < 0 || x >= map.width || y >= map.height || cellRaster[y * map.width + x] !== cell;
    let sx = 0;
    let sy = 0;
    let count = 0;
    for (const pixel of pixels) {
        const x = pixel % map.width;
        const y = Math.floor(pixel / map.width);
        const water = isWater(pixel);
        if (water) {
            sx += x + 0.5 - origin.x;
            sy += y + 0.5 - origin.y;
            count++;
        }
        if (!(outside(x + 1, y) || outside(x - 1, y) || outside(x, y + 1) || outside(x, y - 1))) continue;
        const step = Math.floor((((Math.atan2(x + 0.5 - cx, -(y + 0.5 - cy)) * 180) / Math.PI + 360) % 360) / (360 / BORDER_STEPS)) % BORDER_STEPS;
        border[step]++;
        if (water) borderWater[step]++;
    }
    const present = count >= WATER_MIN_PIXELS;
    const { water, land } = borderStretches(border, borderWater);
    const counted = (stretches) => stretches.filter((stretch) => stretch.share >= STRETCH_MIN_SHARE);
    return {
        present,
        pixels: count,
        share: +(count / (pixels.length || 1)).toFixed(3),
        side: count ? bearingOf(sx, sy) : null,
        borderShare: +(water.reduce((sum, stretch) => sum + stretch.share, 0)).toFixed(2),
        stretches: present ? counted(water) : [],
        landStretches: counted(land),
        allStretches: water.map((stretch) => stretch.share),
    };
}

/**
 * The runs of water and of land round the border. A step with no border pixels (the cell is
 * narrow there) takes the class of the step before it.
 */
function borderStretches(border, borderWater) {
    const steps = border.length;
    const total = border.reduce((sum, n) => sum + n, 0) || 1;
    const kind = new Array(steps).fill(null);
    for (let step = 0; step < steps; step++) if (border[step]) kind[step] = borderWater[step] * 2 >= border[step];
    for (let pass = 0; pass < 2; pass++) for (let step = 0; step < steps; step++) if (kind[step] === null) kind[step] = kind[(step + steps - 1) % steps];
    const water = [];
    const land = [];
    const start = kind.findIndex((value, step) => value !== kind[(step + steps - 1) % steps]);
    if (start < 0) {
        (kind[0] ? water : land).push({ from: 0, to: 360, share: 1 });
        return { water, land };
    }
    let run = { kind: kind[start], from: start, length: 0 };
    const close = (end) => (run.kind ? water : land).push({ from: Math.round((run.from * 360) / steps), to: Math.round((end * 360) / steps) % 360, share: +(run.length / total).toFixed(3) });
    for (let k = 0; k < steps; k++) {
        const step = (start + k) % steps;
        if (kind[step] !== run.kind) {
            close(step);
            run = { kind: kind[step], from: step, length: 0 };
        }
        run.length += border[step];
    }
    close(start);
    return { water, land };
}

/**
 * The water the settlement belongs to. With both sea and lake in the cell, the sea, unless a water
 * route through the cell runs on the lake and none on the sea.
 */
function chooseWater(prepared, home, sea, lake) {
    const hasSea = sea.present;
    const hasLake = lake.present;
    if (!hasSea && !hasLake) return null;
    if (hasSea && !hasLake) return { name: "sea", reading: sea, why: "only water" };
    if (hasLake && !hasSea) return { name: "lake", reading: lake, why: "only water" };
    const on = waterRoutesOn(prepared, home);
    if (on.lake && !on.sea) return { name: "lake", reading: lake, why: "a water route crosses the lake, none the sea" };
    return { name: "sea", reading: sea, why: "sea before lake" };
}

/** Whether the water routes through a cell travel on the sea, on a lake, or both. */
function waterRoutesOn(prepared, home) {
    const { map } = prepared;
    const on = { sea: false, lake: false };
    for (const { index } of prepared.routesInCell.get(home) ?? []) {
        const route = map.routes[index];
        if (!WATER_TRANSPORTS.has(route.transport)) continue;
        for (const display of route.cells) {
            const x = Math.floor(map.displaySites[2 * display]);
            const y = Math.floor(map.displaySites[2 * display + 1]);
            const pixel = y * map.width + x;
            if (map.waterMask[pixel] > 0) on.lake = true;
            else if (map.elevation[pixel] < map.seaLevel) on.sea = true;
        }
    }
    return on;
}

/**
 * The drawn rivers through the cell: the bearings at which each enters and leaves it, how big it
 * is there, and whether it rises or ends in the cell (in the sea, a lake or another river).
 */
function readRivers(prepared, home, origin) {
    const { map } = prepared;
    const through = [];
    for (const [river, points] of prepared.riversInCell.get(home) ?? []) {
        const first = points[0];
        const last = points[points.length - 1];
        const outside = (point) => {
            const [x, y] = river.path[point];
            return cellOf(prepared, x, y) !== home;
        };
        // The first point outside the cell upstream of where the river enters it, and downstream
        const enters = first > 0 ? first - 1 : null;
        let leaves = last + 1 < river.path.length ? last + 1 : null;
        if (leaves !== null && !outside(leaves)) leaves = null;
        const bearingTo = (point) => bearingOf(river.path[point][0] - origin.x, river.path[point][1] - origin.y);
        const nearest = points.reduce((best, point) => {
            const [x, y, lake] = river.path[point];
            const distance = Math.hypot(x - origin.x, y - origin.y);
            return !lake && (!best || distance < best.distance) ? { point, distance } : best;
        }, null) ?? { point: first, distance: Math.hypot(river.path[first][0] - origin.x, river.path[first][1] - origin.y) };
        const km = river.km ? river.km[nearest.point] : null;
        let endsIn = null;
        if (leaves === null && last === river.path.length - 1) {
            const [x, y, lake] = river.path[last];
            const pixel = Math.floor(y) * map.width + Math.floor(x);
            if (river.mergeInto) endsIn = "river";
            else if (lake || map.waterMask[pixel] > 0) endsIn = "lake";
            else endsIn = "sea";
        }
        const crossesLake = points.some((point) => river.path[point][2] === 1);
        through.push({
            id: river.id,
            from: enters === null ? null : bearingTo(enters),
            to: leaves === null ? null : bearingTo(leaves),
            rises: first === 0,
            endsIn,
            joins: endsIn === "river" ? river.mergeInto : null,
            crossesLake,
            upstreamKm: km === null ? null : Math.round(km),
            widthM: km === null ? null : Math.round(Math.max(RIVER_WIDTH_MIN_M, RIVER_WIDTH_PER_ROOT_KM * Math.sqrt(km))),
            distanceKm: +(nearest.distance * map.kmPerPx).toFixed(2),
        });
    }
    through.sort((a, b) => (b.upstreamKm ?? 0) - (a.upstreamKm ?? 0));
    const ids = new Set(through.map((river) => river.id));
    const meeting = through.some((river) => river.endsIn === "river" && ids.has(river.joins));
    return { through, confluence: meeting || through.length >= 2 };
}

/**
 * The routes through the cell, each with the bearing at which it leaves the cell either way
 * (towards the first display cell beyond it). Directions shared by several routes (they merge as
 * they near a town) are given once, at the highest class.
 */
function readRoutes(prepared, home, origin) {
    const { map, level } = prepared;
    const found = [];
    for (const { index, position } of prepared.routesInCell.get(home) ?? []) {
        const route = map.routes[index];
        for (const step of [-1, 1]) {
            let at = position;
            while (at + step >= 0 && at + step < route.cells.length && level.of[route.cells[at]] === home) at += step;
            const display = route.cells[at];
            if (level.of[display] === home) continue;
            found.push({ bearing: bearingOf(map.displaySites[2 * display] - origin.x, map.displaySites[2 * display + 1] - origin.y), transport: route.transport, class: route.class ?? "minor" });
        }
    }
    const rank = { trunk: 0, main: 1, minor: 2 };
    found.sort((a, b) => (rank[a.class] ?? 3) - (rank[b.class] ?? 3));
    const merged = [];
    for (const route of found) {
        const same = merged.find((kept) => kept.transport === route.transport && angleBetween(kept.bearing, route.bearing) < SAME_BEARING);
        if (same) same.count++;
        else merged.push({ ...route, count: 1 });
    }
    return merged.sort((a, b) => a.bearing - b.bearing);
}

/** Height, the slope of a plane through the cell and its neighbours, and how the cell stands out. */
function readRelief(prepared, home) {
    const { map, level, cells } = prepared;
    const landRing = Array.from(neighbours(level, home)).filter((cell) => cells.land[cell] > 0);
    const heightM = cells.heightM[home];
    const ringHeights = landRing.map((cell) => cells.heightM[cell]);
    const mean = ringHeights.length ? ringHeights.reduce((a, b) => a + b, 0) / ringHeights.length : heightM;
    const spread = ringHeights.length ? Math.sqrt(ringHeights.reduce((a, b) => a + (b - mean) ** 2, 0) / ringHeights.length) : 0;
    const higherThan = ringHeights.filter((height) => heightM > height).length;
    // Least-squares plane z = a + b dx + c dy through the cell and its land neighbours (km)
    const points = [home, ...landRing].map((cell) => ({ x: (level.sites[2 * cell] - level.sites[2 * home]) * map.kmPerPx, y: (level.sites[2 * cell + 1] - level.sites[2 * home + 1]) * map.kmPerPx, z: cells.heightM[cell] }));
    const plane = fitPlane(points);
    const slope = plane ? Math.hypot(plane.b, plane.c) : 0;
    const downhill = plane && slope > 0 ? bearingOf(-plane.b, -plane.c) : null;
    const difference = heightM - mean;
    const standout = difference / (spread + RELIEF_MIN_M);
    let lie = "level";
    if (ringHeights.length >= 2 && Math.abs(difference) >= RELIEF_MIN_M && standout >= RELIEF_STANDOUT && higherThan >= ringHeights.length - 1) lie = "hill";
    else if (ringHeights.length >= 2 && Math.abs(difference) >= RELIEF_MIN_M && standout <= -RELIEF_STANDOUT && higherThan <= 1) lie = "valley";
    else if (slope >= LEVEL_M_PER_KM) lie = "slope";
    return { heightM: Math.round(heightM), aboveNeighboursM: Math.round(difference), slopeMPerKm: +slope.toFixed(1), downhill, lie };
}

function fitPlane(points) {
    if (points.length < 3) return null;
    let sxx = 0, sxy = 0, syy = 0, sx = 0, sy = 0, sz = 0, sxz = 0, syz = 0;
    for (const { x, y, z } of points) {
        sx += x; sy += y; sz += z; sxx += x * x; sxy += x * y; syy += y * y; sxz += x * z; syz += y * z;
    }
    const n = points.length;
    const mx = sx / n, my = sy / n, mz = sz / n;
    const cxx = sxx / n - mx * mx, cxy = sxy / n - mx * my, cyy = syy / n - my * my;
    const cxz = sxz / n - mx * mz, cyz = syz / n - my * mz;
    const det = cxx * cyy - cxy * cxy;
    if (Math.abs(det) < 1e-9) return null;
    return { a: mz, b: (cxz * cyy - cyz * cxy) / det, c: (cyz * cxx - cxz * cxy) / det };
}

/**
 * The settlement's kind and every tag that applies. Shape comes first, from the coasts round the
 * cell's border (no land along the border an island, two or more coasts a headland or peninsula);
 * then water features meeting (a river with the chosen water is its mouth, weighted above rivers
 * meeting each other); then the coast or shore; then a river alone.
 */
function classify(body, sea, lake, rivers) {
    const tags = [];
    if (body?.name === "sea") {
        if (!sea.landStretches.length) tags.push("island");
        else if (sea.stretches.length >= 2) tags.push("peninsula");
    }
    if (body && rivers.through.length) tags.push("riverMouth");
    if (rivers.confluence) tags.push("confluence");
    if (sea.present) tags.push("coastal");
    if (lake.present) tags.push("lakeside");
    if (rivers.through.length) tags.push("riverTown");
    if (!tags.length) tags.push("inland");
    // The chosen water decides between coastal and lakeside when both are present
    let primary = KINDS.find((kind) => tags.includes(kind));
    if (body && (primary === "coastal" || primary === "lakeside")) primary = body.name === "sea" ? "coastal" : "lakeside";
    return { primary, tags };
}
