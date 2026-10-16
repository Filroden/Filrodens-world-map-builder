import { FILRODENSWMB } from "../config.js";
import { MapStateManager } from "./MapStateManager.js";
import { MeshIntegration } from "./MeshIntegration.js";
import { Inspector } from "./Inspector.js";
import { RouteEditor } from "./RouteEditor.js";
import { VectorHistory } from "./VectorHistory.js";
import { RouteDraft, insertWaypoint, joinRoutes, moveWaypoint, nearestLegCell, removeWaypoint, splitRoute, strokeWaypoints, waypointAt } from "../mesh/RouteEdits.js";
import { routePolyline } from "../mesh/RoutePath.js";
import { ROUTE_MODES, ROUTE_THICKNESS_STEP } from "../mesh/Schema.js";
import { uniqueName } from "../mesh/LayerTree.js";
import { platform } from "../platform/index.js";

/** The Routes tool's modes, in toolbar order. */
export const ROUTE_TOOL_MODES = Object.freeze(["select", "draw", "edit"]);

/**
 * The transports a route can be drawn for. River routes are left out: by hand, a river route
 * has no line to follow (see RouteEdits.transportCost), so only routes made by the generator
 * are river routes.
 */
export const DRAWN_TRANSPORTS = Object.freeze(["road", "sea"]);

/** The toolbar label (and tooltip) of each mode. */
const MODE_LABELS = Object.freeze({
    select: "FILRODENSWMB.UI.RouteModeSelect",
    draw: "FILRODENSWMB.UI.RouteModeDraw",
    edit: "FILRODENSWMB.UI.RouteModeEdit",
});

/** The toolbar icon for each mode. */
const MODE_ICONS = Object.freeze({ select: "select", draw: "gesture", edit: "edit" });

/** The canvas cursor for each mode while the pointer is over the map. */
const MODE_CURSORS = Object.freeze({ select: "pointer", draw: "crosshair", edit: "default" });

/** A route's line fields, with the uiState key holding the map's default for each (a route drawn with no style takes those). */
const STYLE_FIELDS = Object.freeze([
    ["routeColor", "color"],
    ["routeThickness", "thickness"],
    ["routeStyle", "style"],
    ["routeOutline", "outline"],
    ["routeSmoothing", "smoothing"],
]);

/**
 * The Routes tool: the Infrastructure tool's Route mode on the map while editing. Its modes:
 *
 * - Select: a click picks the route under the pointer (its waypoints show); a double-click opens
 *   its editor.
 * - Draw: a click places a waypoint, joined to the one before by a leg in the toolbar's leg mode
 *   for the route's transport; the leg to the pointer is previewed as it moves. A drag traces a
 *   stroke, which on release becomes waypoints at its bends (as many as the toolbar's Detail
 *   setting keeps; see RouteEdits.strokeWaypoints), each joined on like a click's. Clicks and
 *   strokes can be mixed in one route. Enter, a double-click or a right-click finishes the route
 *   (two waypoints or more); Backspace takes the last waypoint back; Escape abandons it.
 * - Edit: drag a waypoint of the picked route to move it (its two legs are found again as it
 *   moves); Shift+click a leg to make a waypoint there; Ctrl+click a waypoint to remove it;
 *   Alt+click an inner waypoint to split the route there; drag an end waypoint onto an end of
 *   another route and let go with Alt held to join the two (a plain drop only moves the
 *   waypoint there, so roads of different styles can meet at a junction and stay separate).
 *
 * A route's transport is chosen when it is drawn and never changed: a road's waypoints are all
 * on land and a sea route's all on water, so no finished route could legally become the other.
 *
 * The canvas hands the primary button to this tool while the Infrastructure tool is editing in
 * Route mode (see StudioCanvas.pointerToolProvider). Every finished change is one undo step (a
 * vector snapshot, as every change to the routes list is).
 */
export class RouteTool {
    /**
     * Per-studio state: the draft being drawn, the press under way in Draw mode (where it began,
     * and its stroke once it has moved far enough to be a trace), the waypoint drag and the preview
     * frame.
     */
    static #states = new WeakMap();

    static #state(app) {
        if (!this.#states.has(app)) this.#states.set(app, { draft: null, steps: [], press: null, drag: null, frame: 0, tool: null });
        return this.#states.get(app);
    }

    /** The mode in use (one of ROUTE_TOOL_MODES). */
    static mode(app) {
        const mode = app.uiState.routeToolMode;
        return ROUTE_TOOL_MODES.includes(mode) ? mode : "draw";
    }

    /** A mode button in the edit toolbar. */
    static setMode(app, target) {
        const mode = target?.dataset.mode;
        if (!ROUTE_TOOL_MODES.includes(mode)) return;
        this.cancel(app);
        app.uiState.routeToolMode = mode;
        app.view?.render(["editToolbar"]);
    }

    /** The transport new routes are drawn for (one of DRAWN_TRANSPORTS). */
    static transport(app) {
        return DRAWN_TRANSPORTS.includes(app.uiState.routeTransport) ? app.uiState.routeTransport : DRAWN_TRANSPORTS[0];
    }

    /** The Detail setting: how closely a traced stroke is kept, in mesh cells (see RouteEdits.strokeWaypoints). */
    static detail(app) {
        const { MIN, MAX, DEFAULT } = FILRODENSWMB.MESH.ROUTE_DRAW.DETAIL;
        const value = Number(app.uiState.routeDetail);
        return Number.isFinite(value) ? Math.min(MAX, Math.max(MIN, value)) : DEFAULT;
    }

    /** The stroke-thinning tolerance in map pixels: the Detail setting in cell spacings. */
    static tolerancePx(app) {
        return this.detail(app) * app.meshSession.mesh.spacing;
    }

    /** The longest run of a stroke between two waypoints, in map pixels (see RouteEdits.fillGaps). */
    static maxGapPx(app) {
        return this.tolerancePx(app) * FILRODENSWMB.MESH.ROUTE_DRAW.DETAIL.GAP_FACTOR;
    }

    /** The waypoints a stroke becomes at the Detail setting (see RouteEdits.strokeWaypoints). */
    static #strokeCells(app, stroke) {
        return strokeWaypoints(app.meshSession, stroke, this.tolerancePx(app), this.maxGapPx(app));
    }

    /** The route being edited (the picked route), or null. */
    static activeRoute(app) {
        return app.mapRoutes?.find((route) => route.id === app.activeRouteId) ?? null;
    }

    /** What the edit toolbar shows (see toolbar-infrastructure.hbs). */
    static toolbarContext(app) {
        const mode = this.mode(app);
        const route = this.activeRoute(app);
        const state = app.uiState;
        return {
            modes: ROUTE_TOOL_MODES.map((value) => ({ value, active: value === mode, icon: MODE_ICONS[value], label: MODE_LABELS[value] })),
            legModes: ROUTE_MODES.filter((value) => value !== "trace").map((value) => ({ value, selected: value === state.routeMode, label: `FILRODENSWMB.UI.RouteLeg${capitalise(value)}` })),
            transports: DRAWN_TRANSPORTS.map((value) => ({ value, selected: value === this.transport(app), label: `FILRODENSWMB.UI.Transport${capitalise(value)}` })),
            activeRoute: route ? { id: route.id, name: route.name } : null,
            thicknessStep: ROUTE_THICKNESS_STEP,
            detail: { ...FILRODENSWMB.MESH.ROUTE_DRAW.DETAIL, value: this.detail(app) },
        };
    }

    /**
     * The canvas's pointer tool for a studio (see StudioCanvas.pointerToolProvider): one object per
     * studio, whose methods read the mode on every event.
     */
    static tool(app) {
        const state = this.#state(app);
        state.tool ??= {
            down: (x, y, event) => this.#down(app, x, y, event),
            move: (x, y, event) => this.#move(app, x, y, event),
            up: (x, y, event) => this.#up(app, x, y, event),
            hover: (x, y) => this.#hover(app, x, y),
            doubleClick: (x, y, event) => this.#doubleClick(app, x, y, event),
            leave: () => this.#leave(app),
        };
        return state.tool;
    }

    /**
     * Keys while drawing a route: Enter finishes it; Backspace, or the undo shortcut, takes the
     * last press back (a click's waypoint, or every waypoint a stroke added), so undo works on
     * the route being drawn before it reaches the map's history; and Escape abandons it (or a
     * drag, or lets go of the picked route).
     * @returns {boolean} Whether the key was used.
     */
    static handleKey(app, event) {
        const state = this.#state(app);
        if (event.key === "Enter" && state.draft) return this.finishDraft(app);
        const undo = (event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "z";
        if ((event.key === "Backspace" || undo) && state.draft) {
            this.#undoStep(state);
            this.#drawDraft(app, state, null);
            return true;
        }
        if (event.key !== "Escape") return false;
        if (state.draft || state.press || state.drag) {
            this.cancel(app);
            return true;
        }
        if (!app.activeRouteId) return false;
        if (Inspector.current(app)?.kind.id === "route") Inspector.close(app);
        this.select(app, null);
        return true;
    }

    /** Takes the last press back: as many waypoints as it added (the draft ends with its last one). */
    static #undoStep(state) {
        const count = state.steps.pop() ?? 1;
        for (let i = 0; i < count; i++) state.draft.undoLast();
        if (!state.draft.route.waypoints.length) state.draft = null;
    }

    /** Abandons the route being placed, the stroke being traced or the drag under way. */
    static cancel(app) {
        const state = this.#state(app);
        if (state.drag) this.#endDrag(app, state, null, null, false);
        state.draft = null;
        state.steps = [];
        state.press = null;
        this.#drawDraft(app, state, null);
    }

    /**
     * Finishes the route being placed (a right-click, Enter or a double-click): it joins the map's
     * routes as the picked route, one undo step. A draft with one waypoint is abandoned.
     * @returns {boolean} Whether a route was being placed.
     */
    static finishDraft(app) {
        const state = this.#state(app);
        if (!state.draft) return false;
        const route = state.draft.finish();
        state.draft = null;
        state.steps = [];
        this.#drawDraft(app, state, null);
        if (route) this.#addRoute(app, route);
        return true;
    }

    /** Draws the picked route's waypoint handles and the draft (after any redraw of the map). */
    static updateOverlays(app) {
        const state = this.#state(app);
        this.#drawHandles(app, state);
        this.#drawDraft(app, state, null);
    }

    // ------------------------------------------------------------------ pointer input

    static #down(app, x, y, event) {
        if (!app.meshSession) return;
        switch (this.mode(app)) {
            case "select": {
                // The route under the pointer is picked and opens in the inspector; a click away
                // from every route lets go and closes it
                const route = MeshIntegration.routeAt(app, x, y, this.#hitRadius(app));
                if (route) RouteEditor.open(app, route.id);
                else {
                    if (Inspector.current(app)?.kind.id === "route") Inspector.close(app);
                    this.select(app, null);
                }
                break;
            }
            case "draw":
                this.#state(app).press = { x, y, stroke: null };
                break;
            default:
                this.#editPress(app, x, y, event);
        }
    }

    static #move(app, x, y) {
        const state = this.#state(app);
        if (state.drag) this.#dragTo(app, state, x, y);
        else if (state.press) this.#pressMove(app, state, x, y);
        else this.#hover(app, x, y);
    }

    static #up(app, x, y, event) {
        const state = this.#state(app);
        if (state.drag) this.#endDrag(app, state, x, y, event?.altKey === true);
        else if (state.press) this.#endPress(app, state);
    }

    static #hover(app, x, y) {
        const state = this.#state(app);
        const mode = this.mode(app);
        const engine = app.canvasEngine;
        if (!engine) return;
        let cursor = MODE_CURSORS[mode];
        if (mode === "edit" && this.activeRoute(app) && this.#waypointUnder(app, this.activeRoute(app), x, y) >= 0) cursor = "grab";
        this.#setCursor(engine, cursor);
        if (mode === "draw" && state.draft) this.#drawDraft(app, state, app.meshSession.cellAt(x, y));
    }

    static #leave(app) {
        const state = this.#state(app);
        if (state.draft) this.#drawDraft(app, state, null);
    }

    /** A double-click finishes the route being drawn, or (in Select mode) opens the route under the pointer. */
    static #doubleClick(app, x, y) {
        const mode = this.mode(app);
        if (mode === "draw") {
            this.finishDraft(app);
            return;
        }
        if (mode !== "select" && mode !== "edit") return;
        const route = MeshIntegration.routeAt(app, x, y, this.#hitRadius(app));
        if (route) RouteEditor.open(app, route.id);
    }

    // ------------------------------------------------------------------ select and new

    /**
     * Makes a route the picked route (null lets go of it): its waypoint handles show. The bar's
     * settings are for the next route drawn; the picked route's own are in its inspector.
     * @param {object} app
     * @param {object|null} route
     */
    static select(app, route) {
        const id = route?.id ?? null;
        if (id === app.activeRouteId) return;
        app.activeRouteId = id;
        this.#drawHandles(app, this.#state(app));
        app.view?.render(["editToolbar", "context"]);
    }

    // ------------------------------------------------------------------ draw

    /**
     * A press in Draw mode that moves further than DRAG_PX (at the current zoom) becomes a traced
     * stroke; while it is traced, the stroke and the waypoints it would keep are drawn.
     */
    static #pressMove(app, state, x, y) {
        const press = state.press;
        if (!press.stroke) {
            const dragPx = FILRODENSWMB.MESH.ROUTE_DRAW.DRAG_PX / this.#scale(app);
            if (Math.hypot(x - press.x, y - press.y) < dragPx) return;
            press.stroke = [press.x, press.y];
        }
        press.stroke.push(x, y);
        this.#drawDraft(app, state, null);
    }

    /** Letting go of a press in Draw mode: a click places a waypoint; a stroke places the waypoints at its bends. */
    static #endPress(app, state) {
        const press = state.press;
        state.press = null;
        const cells = press.stroke ? this.#strokeCells(app, press.stroke) : [app.meshSession.cellAt(press.x, press.y)];
        this.#place(app, state, cells, press.stroke !== null);
    }

    /**
     * Adds waypoints to the route being drawn (the first starts it). A cell the route's transport
     * cannot reach is left out: a click on one says so, and a stroke that crossed such ground says
     * how many of its bends were left out. The second press of a double-click lands on the last
     * waypoint's cell, which adds nothing and says nothing.
     */
    static #place(app, state, cells, traced) {
        state.draft ??= new RouteDraft(app.meshSession, app.mapRoutes, this.#newRouteFields(app), () => platform.utils.randomID());
        let skipped = 0;
        let added = 0;
        for (const cell of cells) {
            if (cell < 0 || cell === state.draft.last) continue;
            if (state.draft.add(cell)) added++;
            else skipped++;
        }
        if (added) state.steps.push(added);
        if (skipped && !traced) platform.notify.warn(platform.i18n.localize("FILRODENSWMB.UI.WarnRouteUnreachable"));
        if (skipped && traced) platform.notify.warn(platform.i18n.format("FILRODENSWMB.UI.WarnRouteStrokeSkipped", { count: skipped }));
        if (!state.draft.route.waypoints.length) state.draft = null;
        this.#drawDraft(app, state, null);
    }

    /**
     * The fields a route drawn now starts with: the bar's style (its line fields; with no style,
     * the map's default line), leg mode and transport.
     */
    static #newRouteFields(app) {
        const state = app.uiState;
        const style = (state.customRouteStyles ?? []).find((candidate) => candidate.id === state.activeRouteQuickStyle) ?? null;
        const line = Object.fromEntries(STYLE_FIELDS.map(([key, field]) => [field, style?.[field] ?? state[key]]));
        return {
            name: uniqueName(platform.i18n.localize("FILRODENSWMB.UI.NewRouteName"), app.mapRoutes ?? []),
            quickStyle: style?.id ?? "custom",
            color: line.color,
            thickness: line.thickness,
            style: line.style,
            outline: line.outline !== false,
            smoothing: line.smoothing === true,
            mode: state.routeMode,
            spanWater: state.routeSpanWater === true,
            transport: this.transport(app),
            visibility: "all",
        };
    }

    /**
     * Adds a finished route to the map as the picked route, one undo step, and opens it in the
     * inspector (focus staying on the map, so the next route can be drawn at once).
     */
    static #addRoute(app, route) {
        MapStateManager.pushVectorState(app);
        app.mapRoutes.push(route);
        app.activeRouteId = route.id;
        app._repaintVectors();
        app.view?.render(["context", "editToolbar"]);
        app.markDirty();
        RouteEditor.open(app, route.id, { created: true });
    }

    // ------------------------------------------------------------------ edit

    /** Edit mode: a press takes hold of a waypoint, inserts, removes or splits with a modifier, or picks another route. */
    static #editPress(app, x, y, event) {
        const route = this.activeRoute(app);
        if (!route) {
            this.select(app, MeshIntegration.routeAt(app, x, y, this.#hitRadius(app)));
            return;
        }
        const index = this.#waypointUnder(app, route, x, y);
        if (index >= 0 && (event.ctrlKey || event.metaKey)) {
            this.#change(app, () => removeWaypoint(app.meshSession, app.mapRoutes, route, index));
            return;
        }
        if (index >= 0 && event.altKey) {
            this.#splitAt(app, route, index);
            return;
        }
        if (index >= 0) {
            this.#beginDrag(app, route, index);
            return;
        }
        if (event.shiftKey) {
            this.#insertAt(app, route, x, y);
            return;
        }
        const other = MeshIntegration.routeAt(app, x, y, this.#hitRadius(app));
        if (other && other !== route) this.select(app, other);
    }

    /** Shift+click on a leg: the leg's cell nearest the click becomes a waypoint, held for dragging. */
    static #insertAt(app, route, x, y) {
        const near = nearestLegCell(app.meshSession, route, x, y);
        if (!near || near.distance > this.#hitRadius(app)) return;
        const state = this.#state(app);
        const before = VectorHistory.snapshot(app);
        const index = insertWaypoint(route, near.legIndex, near.cell);
        if (index < 0) return;
        this.#drawHandles(app, state);
        this.#beginDrag(app, route, index, { before, inserted: true });
    }

    /** Alt+click on an inner waypoint: the route splits there into two. */
    static #splitAt(app, route, index) {
        const name = uniqueName(route.name || platform.i18n.localize("FILRODENSWMB.UI.NewRouteName"), app.mapRoutes);
        this.#change(app, () => {
            const second = splitRoute(route, index, () => platform.utils.randomID(), name);
            if (second) app.mapRoutes.push(second);
            return !!second;
        });
    }

    /**
     * Takes hold of a waypoint. `before` is the vector state to restore on undo (taken before an
     * insertion, when the press inserted the waypoint it holds; otherwise now).
     */
    static #beginDrag(app, route, index, { before = VectorHistory.snapshot(app), inserted = false } = {}) {
        const state = this.#state(app);
        state.drag = { route, index, before, inserted, moved: false };
        this.#drawHandles(app, state);
        this.#setCursor(app.canvasEngine, "grabbing");
    }

    /** A held waypoint follows the pointer, its legs found again once per frame. */
    static #dragTo(app, state, x, y) {
        const cell = app.meshSession.cellAt(x, y);
        if (cell < 0) return;
        state.drag.target = cell;
        if (state.frame) return;
        const view = app.root?.ownerDocument.defaultView;
        const apply = () => {
            state.frame = 0;
            if (!state.drag || state.drag.target === undefined) return;
            if (moveWaypoint(app.meshSession, app.mapRoutes, state.drag.route, state.drag.index, state.drag.target)) {
                state.drag.moved = true;
                this.#redrawRoutes(app);
                this.#drawHandles(app, state);
            }
        };
        if (view) state.frame = view.requestAnimationFrame(apply);
        else apply();
    }

    /**
     * Lets go of the held waypoint. An end waypoint dropped on an end of another route with Alt
     * held joins the two routes into the held one; without Alt it simply shares the cell, as two
     * roads meeting at a junction do. A waypoint that moved (or was inserted) is one undo step; a
     * press let go without moving is not.
     */
    static #endDrag(app, state, x, y, join) {
        const drag = state.drag;
        state.drag = null;
        if (state.frame) {
            app.root?.ownerDocument.defaultView?.cancelAnimationFrame(state.frame);
            state.frame = 0;
        }
        if (drag.target !== undefined && moveWaypoint(app.meshSession, app.mapRoutes, drag.route, drag.index, drag.target)) drag.moved = true;
        const joined = join && x !== null && this.#tryJoin(app, drag.route, drag.index, x, y);
        const changed = drag.moved || joined || drag.inserted;
        if (changed) VectorHistory.push(app, drag.before);
        this.#redrawRoutes(app);
        this.#drawHandles(app, state);
        if (changed) {
            app.view?.render(["context"]);
            app.markDirty();
        }
        this.#setCursor(app.canvasEngine, MODE_CURSORS.edit);
    }

    /** Whether an end waypoint of `route`, dropped at a point, meets an end of another route; if so they are joined. */
    static #tryJoin(app, route, index, x, y) {
        const isEnd = index === 0 || index === route.waypoints.length - 1;
        if (!isEnd) return false;
        const reach = this.#hitRadius(app);
        for (const other of app.mapRoutes) {
            if (other === route) continue;
            const at = waypointAt(app.meshSession, other, x, y, reach);
            if (at !== 0 && at !== other.waypoints.length - 1) continue;
            const held = route.waypoints[index];
            if (other.waypoints[at] !== held) continue;
            // The held route is turned so its held end is its last waypoint, then the other joins it
            if (index === 0) reverseRoute(route);
            if (!joinRoutes(route, other)) continue;
            app.mapRoutes.splice(app.mapRoutes.indexOf(other), 1);
            app.meshSession.forgetRoute(other.id);
            return true;
        }
        return false;
    }

    /** Applies an edit to the picked route as one undo step, when it changed anything. */
    static #change(app, edit) {
        const before = VectorHistory.snapshot(app);
        if (!edit()) return;
        VectorHistory.push(app, before);
        this.#redrawRoutes(app);
        this.#drawHandles(app, this.#state(app));
        app.view?.render(["context"]);
        app.markDirty();
    }

    // ------------------------------------------------------------------ drawing

    /**
     * Draws the route being drawn: its legs so far, the leg to `previewCell` (the pointer), the
     * stroke being traced, and handles at its waypoints and at the bends the stroke would keep.
     */
    static #drawDraft(app, state, previewCell) {
        const overlays = app.canvasEngine?.routeOverlays;
        const session = app.meshSession;
        if (!overlays || !session) return;
        const stroke = state.press?.stroke ?? null;
        const route = state.draft?.route ?? null;
        if (!route && !stroke) {
            overlays.setDraft(null);
            this.#drawHandles(app, state);
            return;
        }
        const line = route?.legs.length ? routePolyline(session.mesh, route.legs, route.smoothing) : null;
        const leg = route && !stroke && previewCell !== null && previewCell >= 0 ? state.draft.preview(previewCell) : null;
        const preview = leg ? routePolyline(session.mesh, [leg], false) : null;
        const fields = route ?? this.#newRouteFields(app);
        overlays.setDraft({ line, preview, stroke, color: fields.color, thickness: fields.thickness });
        const cells = [...(route?.waypoints ?? []), ...(stroke ? this.#strokeCells(app, stroke) : [])];
        overlays.setHandles({ points: cells.flatMap((cell) => [session.mesh.siteX(cell), session.mesh.siteY(cell)]), held: -1 });
    }

    /** Draws the picked route's waypoint handles (in Edit and Select modes). */
    static #drawHandles(app, state) {
        const overlays = app.canvasEngine?.routeOverlays;
        const session = app.meshSession;
        if (!overlays || !session) return;
        const route = this.activeRoute(app);
        const showing = route && app.activeTool === "infrastructure" && app.uiState.isEditMode && app.uiState.activeInfraMode === "route" && !state.draft && !state.press?.stroke;
        if (!showing) {
            overlays.setHandles(null);
            return;
        }
        overlays.setHandles({ points: route.waypoints.flatMap((cell) => [session.mesh.siteX(cell), session.mesh.siteY(cell)]), held: state.drag?.index ?? -1 });
    }

    /** Redraws the routes after a change to one (the whole infrastructure layer, as the studio does). */
    static #redrawRoutes(app) {
        app._repaintVectors();
    }

    /** The waypoint of a route under a map point, within the handles' reach at the current zoom, or -1. */
    static #waypointUnder(app, route, x, y) {
        return waypointAt(app.meshSession, route, x, y, FILRODENSWMB.MESH.ROUTE_HANDLES.REACH_PX / this.#scale(app));
    }

    /** How near (in map pixels) a press must be to pick a route's line at the current zoom. */
    static #hitRadius(app) {
        return FILRODENSWMB.MESH.ROUTE_HIT_PX / this.#scale(app);
    }

    static #scale(app) {
        return app.canvasEngine?.stage?.scale?.x || 1;
    }

    static #setCursor(engine, cursor) {
        const canvas = engine?.app?.canvas ?? engine?.app?.view;
        if (canvas && canvas.style.cursor !== cursor) canvas.style.cursor = cursor;
    }
}

/** Turns a route round, so its last waypoint becomes its first. */
function reverseRoute(route) {
    route.waypoints = route.waypoints.slice().reverse();
    route.legs = route.legs.map((leg) => leg.slice().reverse()).reverse();
}

function capitalise(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
}
