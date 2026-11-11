import { FILRODENSWMB } from "../config.js";
import { riverList } from "../generator/GeneratorInput.js";
import { GeneratorRevision } from "../generator/GeneratorRevision.js";
import { isKept } from "./Regeneration.js";
import { RunCells } from "./RunCells.js";

/**
 * A regional map's inherited ports and river towns, brought onto its own coast and rivers.
 *
 * From generator revision 2 a run stands a port's pin on its own cell's shore and a town on a
 * navigable river beside the river (see Pipeline.placeShore). A regional map is cut from its
 * parent's pixels and draws its coast and rivers again at its own, finer detail, so an inherited
 * port can stand a few km inland of the coast the regional map draws, and a river town off its
 * river. Once, as a regional map opens with its terrain and rivers drawn, each inherited port pin
 * moves to the land display cell of its parent cell nearest it that lies beside sea or lake, and
 * each other inherited town whose parent cell holds a navigable river (upstream length at least
 * GENERATOR.VALUES.NAVIGABLE_KM, as the model reads it) to the nearest land display cell there
 * beside that river. A pin already on such a cell stays; one whose parent cell has no such cell
 * on the regional map stays where it is.
 *
 * Only pins the parent's run made (generated towns, not the reader's kept, edited or locked ones,
 * nor a fill-in's) move, and only on a map following revision 2 (its parent's). The map is marked
 * (`shoresPlaced`, saved with it) and not marked as changed: until it is saved, the same pass runs
 * on every load, with the same result.
 */
export class ShoreRelay {
    /** Whether the open map's inherited ports and river towns are still to be brought onto its own shore. */
    static needed(app) {
        return !!app.currentParentId && !!app.parentRun && app.shoresPlaced !== true && !!app.meshSession?.aggregates && GeneratorRevision.rules(GeneratorRevision.of(app.uiState)).shorePins === true;
    }

    /**
     * Moves the open regional map's inherited port pins onto its coast and river towns beside their rivers.
     * @param {object} app
     * @returns {{ports: number, rivers: number}} How many of each moved.
     */
    static run(app) {
        const moved = { ports: 0, rivers: 0 };
        const session = app.meshSession;
        const mesh = session?.mesh;
        const land = session?.aggregates?.land;
        const found = RunCells.of(app);
        if (!mesh || !land || !found?.inherited) return moved;
        const parentOf = found.cells.parentOf;
        const targets = (app.mapPins ?? []).filter((pin) => pin.generated?.kind === "town" && !pin.generated.infill && !isKept(pin) && Number.isFinite(pin.x) && Number.isFinite(pin.y));
        if (!targets.length) return moved;

        const shore = (cell) => land[cell] === 1 && mesh.neighbours(cell).some((next) => land[next] !== 1);
        const river = this.#navigableCells(app, mesh);
        const beside = (cell) => land[cell] === 1 && (river.has(cell) || mesh.neighbours(cell).some((next) => river.has(next)));

        // Each parent cell's display cells, found once
        const byParent = new Map();
        for (let cell = 0; cell < mesh.cellCount; cell++) {
            const parent = parentOf[cell];
            if (parent < 0) continue;
            if (!byParent.has(parent)) byParent.set(parent, []);
            byParent.get(parent).push(cell);
        }
        for (const pin of targets) {
            const display = session.cellAt(pin.x, pin.y);
            const parent = display >= 0 ? parentOf[display] : -1;
            if (parent < 0) continue;
            const port = pin.generated.tier === FILRODENSWMB.GENERATOR.PIN_TIERS.port;
            const fits = port ? shore : beside;
            if (!port && !byParent.get(parent).some((cell) => river.has(cell))) continue;
            if (fits(display)) continue;
            let best = -1;
            let bestD = Infinity;
            for (const cell of byParent.get(parent)) {
                if (!fits(cell)) continue;
                const d = (mesh.siteX(cell) - pin.x) ** 2 + (mesh.siteY(cell) - pin.y) ** 2;
                if (d < bestD) {
                    bestD = d;
                    best = cell;
                }
            }
            if (best < 0) continue;
            pin.x = mesh.siteX(best);
            pin.y = mesh.siteY(best);
            pin.cell = best;
            if (port) moved.ports++;
            else moved.rivers++;
        }
        return moved;
    }

    /** The display cells a navigable river runs through, on the regional map's own rivers (upstream length as the model reads it). */
    static #navigableCells(app, mesh) {
        const cells = new Set();
        const { pixelsPerBaseline, list } = riverList(app.currentRiverData);
        const perFlow = (pixelsPerBaseline || 1) * mesh.kmPerPx;
        const navigableKm = FILRODENSWMB.GENERATOR.VALUES.NAVIGABLE_KM;
        for (const river of list) {
            if (!river.flow) continue;
            for (let point = 0; point < river.x.length; point++) {
                if (river.lake[point] || river.flow[point] * perFlow < navigableKm) continue;
                const [x, y] = [river.x[point], river.y[point]];
                if (x < 0 || y < 0 || x >= mesh.width || y >= mesh.height) continue;
                cells.add(mesh.cellRaster[y * mesh.width + x]);
            }
        }
        return cells;
    }
}
