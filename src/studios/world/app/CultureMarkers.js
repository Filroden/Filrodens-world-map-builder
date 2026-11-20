import { WorldEditors } from "./WorldEditors.js";
import { FILRODENSWMB } from "../../../config.js";
import { platform } from "../../../platform/index.js";

/**
 * The cultures' homelands on the map, and picking one there.
 *
 * - **Markers** (see HomelandMarkers): while the Generate tool is open, each culture's homelands
 *   show in its colour, filled where the reader put them and hollow where the last run placed one
 *   for a culture given none (its Auto homeland), so the reader sees where each people starts.
 * - **Pick on map** (Peoples and realms' Homelands, Place; S0 step 4c-2): each click on the map's
 *   land adds a homeland to the culture, until Done, Escape or the culture's limit ends the pick. A click on water is refused with
 *   a notice (the run would leave it out). Escape, Add homeland again, or the inspector closing
 *   ends it with nothing added. The pick takes the click whether or not the map is being edited
 *   (StudioCanvas.pickPointerTool).
 */
export class CultureMarkers {
    /** The culture whose homeland the next click adds, by studio. */
    static #picking = new WeakMap();

    /**
     * The tools that mark the homelands and the events' places on the map: Peoples and realms,
     * where homelands are placed (S0 step 4c-2), and the world's Ages and events, whose events'
     * places are picked on the map.
     */
    static TOOLS = Object.freeze(new Set(["generate", "worldAges"]));

    /**
     * Shows the markers those tools show, or none in any other tool, with `extra` markers beside
     * the homelands (the ages' events' places; see AgeEventRows.markers).
     */
    static update(app, extra = []) {
        const layer = app.canvasEngine?.homelandMarkers;
        if (!layer) return;
        layer.set(CultureMarkers.TOOLS.has(app.activeTool) ? [...this.markers(app), ...extra] : []);
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

    /** The name of the culture whose homeland the next click adds, or null. */
    static pickingName(app) {
        const id = this.#picking.get(app) ?? null;
        return id ? ((app.uiState.cultures ?? []).find((each) => each.id === id)?.name ?? null) : null;
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
        if (WorldEditors.readOnly(app)) return false;
        culture.homelands = [...(culture.homelands ?? []), { x: Math.round(x), y: Math.round(y) }];
        // Placed from Peoples and realms, each click adds one until Done, Escape or the limit (Ken,
        // 2026-11-20: a culture may start in several places); elsewhere one click places one
        const full = culture.homelands.length >= FILRODENSWMB.GENERATOR.CULTURES.MAX_HOMELANDS;
        if (app.activeTool !== "generate" || full) this.stopPick(app);
        app.markGeneratorStale?.();
        app.markDirty();
        app.view?.render(["context", "editToolbar"]);
    }

    /**
     * Peoples and realms' Homelands (S0 step 4c-2, board C10): a row for each culture, with its
     * homelands on this map (each removable), or Auto when it has none, and Place. The homelands are
     * each map's own (see WorldSettings), so they are placed here, on the map, not on the Cultures
     * page. Read only on a held regional world.
     * @param {object} app
     * @returns {{readOnly: boolean, rows: object[]}}
     */
    static rows(app) {
        const { i18n } = platform;
        const max = FILRODENSWMB.GENERATOR.CULTURES.MAX_HOMELANDS;
        const readOnly = WorldEditors.readOnly(app);
        const rows = (app.uiState?.cultures ?? []).map((culture) => {
            const points = culture.homelands ?? [];
            return {
                id: culture.id,
                name: culture.name,
                color: culture.color ?? FILRODENSWMB.GENERATOR.CULTURES.DEFAULT.color,
                count: points.length ? i18n.format(points.length === 1 ? "FILRODENSWMB.UI.HomelandsOnMapOne" : "FILRODENSWMB.UI.HomelandsOnMap", { count: points.length }) : i18n.localize("FILRODENSWMB.UI.HomelandsAuto"),
                points: points.map((point, index) => ({ index, label: i18n.format("FILRODENSWMB.UI.CultureHomelandAt", { number: index + 1, x: Math.round(point.x), y: Math.round(point.y) }) })),
                picking: this.picking(app, culture.id),
                canPlace: !readOnly && points.length < max,
                canAuto: !readOnly && points.length > 0,
            };
        });
        return { readOnly, rows };
    }

    /** One homeland taken away from a culture on this map. */
    static remove(app, cultureId, index) {
        if (WorldEditors.readOnly(app)) return;
        const culture = (app.uiState.cultures ?? []).find((each) => each.id === cultureId);
        if (!culture || !Number.isInteger(index) || !culture.homelands?.[index]) return;
        culture.homelands = culture.homelands.filter((_, at) => at !== index);
        app.markGeneratorStale?.();
        app.markDirty();
        app.view?.render(["context"]);
    }

    /** Auto: a culture's homelands on this map go, and a run places one. */
    static clear(app, cultureId) {
        if (WorldEditors.readOnly(app)) return;
        const culture = (app.uiState.cultures ?? []).find((each) => each.id === cultureId);
        if (!culture || !(culture.homelands ?? []).length) return;
        culture.homelands = [];
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
