import { Delaunay } from "../../vendor/d3-delaunay/d3-delaunay.js";

/**
 * The cells the Travel tool times journeys over. The generator works on model cells a fixed
 * distance apart (MESH.MODEL_SPACING_KM), which suits a world map but leaves a regional map with
 * only a few dozen cells across, so its day rings come out as plain polygons and a start lands far
 * from where it was clicked. Where the model cells lie further apart on the map than
 * TRAVEL_TIME.CELL_PX, the travel cells are a finer set of the display mesh's own sites, about that
 * far apart (one per square of a grid, the site nearest the square's centre), and never more than
 * TRAVEL_TIME.MAX_CELLS of them. Otherwise they are the model cells themselves.
 *
 * Shape: { coarse, count, sites (x, y pairs), siteCell (the display cell of each site), of (the
 * travel cell holding each display cell), delaunay, spacingPx }, with the fields ThematicData's
 * blendWeights reads (cellCount, parentOf, modelDelaunay, modelSpacing, siteX, siteY), so the day
 * bands blend between travel cells as the thematic layers blend between model cells.
 *
 * @param {import("../mesh/MeshBuilder.js").Mesh} mesh - The map's display mesh.
 * @param {{cellPx: number, maxCells: number}} options
 * @returns {object}
 */
export function travelGrid(mesh, { cellPx, maxCells }) {
    let spacing = Math.max(cellPx, Math.sqrt((mesh.width * mesh.height) / maxCells));
    // Part squares at the right and bottom edges count too
    while (Math.ceil(mesh.width / spacing) * Math.ceil(mesh.height / spacing) > maxCells) spacing *= 1.02;
    if (spacing >= mesh.modelSpacing) return coarseGrid(mesh);
    const columns = Math.ceil(mesh.width / spacing);
    const rows = Math.ceil(mesh.height / spacing);
    const best = new Int32Array(columns * rows).fill(-1);
    const bestDistance = new Float64Array(columns * rows).fill(Infinity);
    for (let cell = 0; cell < mesh.cellCount; cell++) {
        const x = mesh.siteX(cell);
        const y = mesh.siteY(cell);
        const column = Math.min(columns - 1, Math.floor(x / spacing));
        const row = Math.min(rows - 1, Math.floor(y / spacing));
        const square = row * columns + column;
        const distance = (x - (column + 0.5) * spacing) ** 2 + (y - (row + 0.5) * spacing) ** 2;
        if (distance < bestDistance[square]) {
            bestDistance[square] = distance;
            best[square] = cell;
        }
    }
    const siteCell = Int32Array.from(best.filter((cell) => cell >= 0));
    const sites = new Float64Array(siteCell.length * 2);
    siteCell.forEach((cell, at) => {
        sites[at * 2] = mesh.siteX(cell);
        sites[at * 2 + 1] = mesh.siteY(cell);
    });
    const delaunay = new Delaunay(sites);
    const of = new Int32Array(mesh.cellCount);
    // Display cells close on the map are close in number, so the last answer starts each search
    let hint = 0;
    for (let cell = 0; cell < mesh.cellCount; cell++) {
        hint = delaunay.find(mesh.siteX(cell), mesh.siteY(cell), hint);
        of[cell] = hint;
    }
    return gridOf(mesh, { coarse: false, sites, siteCell, of, delaunay, spacingPx: spacing });
}

/** The model cells as travel cells. */
function coarseGrid(mesh) {
    const sites = Float64Array.from(mesh.sites.subarray(0, 2 * mesh.modelCount));
    // Model sites are the first display sites, so each is its own display cell
    const siteCell = Int32Array.from({ length: mesh.modelCount }, (_, cell) => cell);
    return gridOf(mesh, { coarse: true, sites, siteCell, of: mesh.parentOf, delaunay: mesh.modelDelaunay, spacingPx: mesh.modelSpacing });
}

function gridOf(mesh, { coarse, sites, siteCell, of, delaunay, spacingPx }) {
    return {
        coarse,
        count: siteCell.length,
        sites,
        siteCell,
        of,
        delaunay,
        spacingPx,
        cellCount: mesh.cellCount,
        parentOf: of,
        modelDelaunay: delaunay,
        modelSpacing: spacingPx,
        siteX: (cell) => mesh.siteX(cell),
        siteY: (cell) => mesh.siteY(cell),
    };
}

/** The travel cell under each pixel (for the network's build; see TravelNetwork). */
export function travelCellOfPixels(mesh, grid) {
    const raster = mesh.cellRaster;
    const out = new Int32Array(raster.length);
    for (let pixel = 0; pixel < raster.length; pixel++) out[pixel] = grid.of[raster[pixel]];
    return out;
}
