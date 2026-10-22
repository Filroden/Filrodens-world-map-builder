import { FILRODENSWMB } from "../config.js";
import { MapStateManager } from "./MapStateManager.js";
import { platform } from "../platform/index.js";

/**
 * The cultures' homelands on the map, and picking one there.
 *
 * - **Markers** (see HomelandMarkers): while the Generate tool is open, each culture's homelands
 *   show in its colour, filled where the reader put them and hollow where the last run placed one
 *   for a culture given none (its Auto homeland), so the reader sees where each people starts.
 * - **Pick on map** (the culture inspector's Add homeland): the next click on the map's land adds a
 *   homeland to the culture, as one undo step, and ends the pick. A click on water is refused with
 *   a notice (the run would leave it out). Escape, Add homeland again, or the inspector closing
 *   ends it with nothing added. The pick takes the click whether or not the map is being edited
 *   (StudioCanvas.pickPointerTool).
 */
export class CultureMarkers {
    /** The culture whose homeland the next click adds, by studio. */
    static #picking = new WeakMap();

    /** Shows the markers the Generate tool shows, or none in any other tool. */
    static update(app) {
        const layer = app.canvasEngine?.homelandMarkers;
        if (!layer) return;
        layer.set(app.activeTool === "generate" ? this.markers(app) : []);
    }

    /**
     * The homelands to mark: each culture's own points (filled), and the last run's placed
     * homeland of each culture given none (hollow, at its model cell's site).
     * @param {object} app
     * @returns {{x: number, y: number, color: string, filled: boolean}[]}
     */
    static markers(app) {
        const cultures = app.uiState?.cultures ?? [];
        const markers = [];
        const mesh = app.meshSession?.mesh ?? null;
        const run = new Map((app.modelRun?.cultures ?? []).filter((entry) => entry.id).map((entry) => [entry.id, entry]));
        for (const culture of cultures) {
            const color = culture.color ?? FILRODENSWMB.GENERATOR.CULTURES.DEFAULT.color;
            const points = culture.homelands ?? [];
            for (const point of points) markers.push({ x: point.x, y: point.y, color, filled: true });
            const placed = run.get(culture.id);
            if (points.length || !placed?.homelandsAuto || !mesh) continue;
            for (const cell of placed.homelands ?? []) {
                if (Number.isInteger(cell) && cell >= 0 && cell < mesh.cellCount) markers.push({ x: mesh.siteX(cell), y: mesh.siteY(cell), color, filled: false });
            }
        }
        return markers;
    }

    /** Whether the next click adds a homeland to this culture (or to any, without one given). */
    static picking(app, cultureId = null) {
        const current = this.#picking.get(app) ?? null;
        return cultureId ? current === cultureId : current !== null;
    }

    /** Add homeland: the next click on the map's land adds one; pressed again, it stops. */
    static togglePick(app, cultureId) {
        if (this.picking(app, cultureId)) this.stopPick(app);
        else this.#startPick(app, cultureId);
    }

    static #startPick(app, cultureId) {
        if (!app.canvasEngine) return;
        this.#picking.set(app, cultureId);
        app.canvasEngine.pickPointerTool = {
            down: (x, y) => this.#place(app, x, y),
            move: () => {},
            up: () => {},
            hover: () => this.#setCursor(app, "crosshair"),
            doubleClick: () => {},
            leave: () => this.#setCursor(app, "default"),
        };
        this.#setCursor(app, "crosshair");
        app.refreshCanvasHint?.();
    }

    /** Ends a pick, adding nothing. */
    static stopPick(app) {
        if (!this.#picking.has(app)) return;
        this.#picking.delete(app);
        if (app.canvasEngine) app.canvasEngine.pickPointerTool = null;
        this.#setCursor(app, "default");
        app.refreshCanvasHint?.();
    }

    /** Escape ends a pick. Returns whether the key was used. */
    static handleKey(app, event) {
        if (event.key !== "Escape" || !this.picking(app)) return false;
        this.stopPick(app);
        app.view?.render(["context"]);
        return true;
    }

    /** A click while picking: a homeland on land, as one undo step; on water, a notice and nothing. */
    static #place(app, x, y) {
        const id = this.#picking.get(app);
        const culture = (app.uiState.cultures ?? []).find((each) => each.id === id);
        if (!culture) {
            this.stopPick(app);
            return;
        }
        if (!this.isLand(app, x, y)) {
            platform.notify.warn(platform.i18n.localize("FILRODENSWMB.UI.CultureHomelandOnWater"));
            return;
        }
        if ((culture.homelands ?? []).length >= FILRODENSWMB.GENERATOR.CULTURES.MAX_HOMELANDS) {
            platform.notify.warn(platform.i18n.format("FILRODENSWMB.UI.CultureHomelandsFull", { count: FILRODENSWMB.GENERATOR.CULTURES.MAX_HOMELANDS }));
            this.stopPick(app);
            return;
        }
        MapStateManager.pushVectorState(app);
        culture.homelands = [...(culture.homelands ?? []), { x: Math.round(x), y: Math.round(y) }];
        this.stopPick(app);
        app.markGeneratorStale?.();
        app.markDirty();
        app.view?.render(["context"]);
    }

    /** Whether a map point is land: on the map, above the sea and not in a lake. */
    static isLand(app, x, y) {
        const px = Math.floor(x);
        const py = Math.floor(y);
        if (px < 0 || py < 0 || px >= app.mapWidth || py >= app.mapHeight) return false;
        const index = py * app.mapWidth + px;
        const elevation = app.currentElevationData?.[index];
        if (!Number.isFinite(elevation) || elevation < Number(app.uiState.seaLevel ?? 0)) return false;
        return !(app.bufferWaterMask?.[index] > 0);
    }

    static #setCursor(app, cursor) {
        const canvas = app.canvasEngine?.app?.canvas ?? app.canvasEngine?.app?.view;
        if (canvas && canvas.style.cursor !== cursor) canvas.style.cursor = cursor;
    }
}
