import { ThematicSource } from "../thematic/ThematicData.js";
import { HistoryView } from "./HistoryView.js";
import { RunCells } from "./RunCells.js";

/** The thematic layers' source for each studio, kept while its run and mesh are the same. */
const sources = new WeakMap();

/**
 * The run the thematic layers read, for the thematic layer (ThematicView) and the Influences
 * tool's base layer (InfluenceView) alike (RF1: it was ThematicView's, which made the two import
 * each other).
 */
export class ThematicRun {
    /**
     * The source of the layers for the map's run and mesh, or null when there is no usable run.
     * While the History tool shows an earlier age, the run as that age left it (its cultures
     * alone; see HistoryView.thematicRun).
     */
    static source(app) {
        const { run: modelRun, cells: mesh } = this.runCells(app);
        const cached = sources.get(app);
        if (cached?.modelRun === modelRun && cached?.mesh === mesh) {
            cached.source?.useCultures(app.uiState?.cultures);
            return cached.source;
        }
        const source = ThematicSource.of(modelRun, mesh);
        source?.useCultures(app.uiState?.cultures);
        sources.set(app, { modelRun, mesh, source });
        return source;
    }

    /** The run the layers read and the cells it is on (see RunCells), the age shown first. */
    static runCells(app) {
        const past = HistoryView.thematicRun(app);
        if (past) {
            // An earlier age is on the run's own cells: the map's model cells, or a regional map's copy of its parent's
            const found = RunCells.of(app);
            return found?.inherited ? { run: past, cells: found.cells, inherited: true } : { run: past, cells: app.meshSession?.mesh ?? null, inherited: false };
        }
        return RunCells.of(app) ?? { run: null, cells: null, inherited: false };
    }
}
