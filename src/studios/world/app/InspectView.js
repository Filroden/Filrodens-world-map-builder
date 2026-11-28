import { FILRODENSWMB } from "../../../config.js";
import { platform } from "../../../platform/index.js";
import { MapReader } from "../../../shell/MapReader.js";
import { DetailLevel } from "./DetailLevel.js";
import { Inspector } from "./Inspector.js";
import { LabelEditor } from "./LabelEditor.js";
import { PinEditor } from "./PinEditor.js";
import { RegionEditor } from "./RegionEditor.js";
import { RiverEditor } from "./FeatureEditors.js";
import { SettlementMaps } from "./SettlementMaps.js";

/**
 * The Inspect tool (EX1; templates/world/tools-inspect.hbs), the Explore stage's first: reading
 * the Surface map at a point. The shell's reader (MapReader) gathers what the World studio
 * registers (`inspect.surface`, see SurfaceKinds), shows the map card on a resting pointer and
 * holds a point on a click; this wires it to the canvas (its pointer tool, the camera's moves), and
 * draws the held list in the panel as folds, the first open, one at a time. A fold's links show
 * its feature on the map, open its settlement map, go to a region it lies in, or Edit it in its
 * own tool (not in view only). Nothing here changes the map.
 *
 * State it keeps per studio: the reader, and which fold is open.
 */
const states = new WeakMap();

/** The tool's id. */
const TOOL = "inspect";

export class InspectView {
    /** Whether the tool is open. */
    static active(app) {
        return app.activeTool === TOOL;
    }

    static #state(app) {
        if (!states.has(app)) states.set(app, { reader: null, open: 0, session: null, tool: null, listeners: null });
        return states.get(app);
    }

    // ------------------------------------------------------------------ the tool opening and closing

    /**
     * Brings the canvas's pointer up to date after the tool changed: while Inspect is open its
     * reader takes the map's primary button (one finger still pans on touch) and hears the camera
     * move; when it closes, the hold is let go and the pointer goes back to the map's tools.
     */
    static toolChanged(app) {
        const engine = app.canvasEngine;
        const state = this.#state(app);
        if (!engine) return;
        if (!this.active(app)) {
            this.#close(app);
            return;
        }
        const inspect = app.definition?.inspectFor?.(app.mapType ?? "surface");
        if (!inspect) return;
        this.#close(app);
        const surface = this.#surface(app);
        if (!surface) return;
        state.session = app.meshSession;
        state.reader = new MapReader({
            app,
            inspect,
            surface,
            t: platform.i18n,
            dragPx: FILRODENSWMB.UI.NODE_DRAG_THRESHOLD_PX,
            toScreen: (x, y) => this.#toSurface(app, x, y),
            onHold: (held) => this.#held(app, held),
            onLetGo: () => this.#letGone(app),
        });
        const reader = () => this.#reader(app);
        state.tool = {
            // One finger pans on touch; a tap still holds a point (Ken, EX1 answer 3)
            pansByDefault: true,
            down: (x, y, event) => reader()?.down(x, y, event),
            move: () => {},
            up: (x, y, event) => reader()?.up(x, y, event),
            hover: (x, y, event) => {
                this.#setCursor(app, "default");
                reader()?.hover(x, y, event);
            },
            doubleClick: () => {},
            leave: () => reader()?.leave(),
        };
        engine.pickPointerTool = state.tool;
        engine.onCameraMove = () => state.reader?.cameraMoved();
        this.#listen(app);
    }

    /** Ends Inspect as the studio closes: the hold let go and the panel's listeners removed. */
    static close(app) {
        this.#close(app);
    }

    /** Lets go, and gives the canvas's pointer back. */
    static #close(app) {
        const state = this.#state(app);
        const engine = app.canvasEngine;
        state.reader?.destroy();
        state.reader = null;
        if (engine && state.tool && engine.pickPointerTool === state.tool) engine.pickPointerTool = null;
        if (engine && engine.onCameraMove) engine.onCameraMove = null;
        state.tool = null;
        state.listeners?.();
        state.listeners = null;
        engine?.inspectOverlay?.setMarker(null);
        engine?.inspectOverlay?.setOutline(null);
    }

    /** The reader, made again when the map changed under it (another world or map opened). */
    static #reader(app) {
        const state = this.#state(app);
        if (state.reader && state.session !== app.meshSession) {
            state.reader.letGo();
            state.session = app.meshSession;
        }
        return state.reader;
    }

    /** The element the card is laid over: the canvas's container. */
    static #surface(app) {
        const canvas = app.canvasEngine?.app?.canvas ?? app.canvasEngine?.app?.view;
        return canvas?.parentElement ?? null;
    }

    /** A map point's place on the surface, in CSS pixels. */
    static #toSurface(app, x, y) {
        const engine = app.canvasEngine;
        const canvas = engine.app.canvas ?? engine.app.view;
        const surface = canvas.parentElement;
        const canvasRect = canvas.getBoundingClientRect();
        const surfaceRect = surface.getBoundingClientRect();
        return {
            x: canvasRect.left - surfaceRect.left + engine.stage.x + x * engine.stage.scale.x,
            y: canvasRect.top - surfaceRect.top + engine.stage.y + y * engine.stage.scale.y,
        };
    }

    static #setCursor(app, cursor) {
        const canvas = app.canvasEngine?.app?.canvas ?? app.canvasEngine?.app?.view;
        if (canvas && canvas.style.cursor !== cursor) canvas.style.cursor = cursor;
    }

    // ------------------------------------------------------------------ holding

    static #held(app, held) {
        const state = this.#state(app);
        state.open = 0;
        app.canvasEngine?.inspectOverlay?.setMarker({ x: held.x, y: held.y, color: this.#accent(app) });
        app.canvasEngine?.inspectOverlay?.setOutline(null);
        app.view?.render(["context"]);
    }

    static #letGone(app) {
        app.canvasEngine?.inspectOverlay?.setMarker(null);
        app.canvasEngine?.inspectOverlay?.setOutline(null);
        if (this.active(app)) app.view?.render(["context"]);
    }

    /** The secondary accent, the marker's colour (the design system's Map card). */
    static #accent(app) {
        const root = app.root;
        const value = root ? root.ownerDocument.defaultView.getComputedStyle(root).getPropertyValue("--fwmb-accent-secondary").trim() : "";
        return /^#[0-9a-f]{6}$/i.test(value) ? value : "#f0a8ea";
    }

    /** The held point, or null (for the checks). */
    static held(app) {
        return this.#state(app).reader?.held ?? null;
    }

    /** The reader (for the checks). */
    static reader(app) {
        return this.#state(app).reader;
    }

    /** Lets go of the held point (the panel's Clear). */
    static letGo(app) {
        this.#state(app).reader?.letGo();
    }

    // ------------------------------------------------------------------ the panel

    /**
     * The panel's context: with nothing held, what can be read (the detail level and the
     * Visibility filters); with a point held, its list as folds, the first open.
     */
    static context(app) {
        const { i18n } = platform;
        const state = this.#state(app);
        const held = state.reader?.held ?? null;
        const coarse = !!app.root?.ownerDocument.defaultView?.matchMedia?.("(pointer: coarse)")?.matches;
        if (!held) {
            const filters = app.viewFilters ?? {};
            const visibility = [filters.all && "FILRODENSWMB.UI.VisibilityEveryone", filters.gm && "FILRODENSWMB.UI.VisibilityGMOnly", filters.none && "FILRODENSWMB.UI.VisibilityNone"].filter(Boolean).map((key) => i18n.localize(key));
            const level = FILRODENSWMB.DETAIL.LEVELS.find((entry) => entry.value === DetailLevel.current(app));
            return {
                held: false,
                touch: coarse,
                reads: [
                    { label: i18n.localize("FILRODENSWMB.UI.Visibility"), value: visibility.length ? new Intl.ListFormat(i18n.lang, { type: "conjunction" }).format(visibility) : "–" },
                    ...(level ? [{ label: i18n.localize("FILRODENSWMB.UI.InspectDetail"), value: i18n.localize(level.label) }] : []),
                ],
            };
        }
        const edit = !app.viewOnly;
        const keys = held.list.map((entry) => entry.key);
        let set = null;
        const folds = held.list.map((entry, index) => {
            const { row } = entry;
            const fold = entry.kind.fold(app, entry.item, { edit }) ?? {};
            const heading = row.set && row.set !== set ? row.set : null;
            if (row.set) set = row.set;
            const card = fold.settlementPin ? SettlementMaps.pinCard(app, fold.settlementPin) : null;
            return {
                index,
                icon: entry.icon,
                name: row.name,
                kind: [row.kind, row.figure].filter(Boolean).join(" · "),
                gmOnly: !!row.gmOnly,
                heading,
                ground: !!row.ground,
                open: index === Math.min(state.open, held.list.length - 1),
                rows: fold.rows ?? [],
                leads: fold.leads ?? null,
                note: fold.note ?? null,
                description: fold.description ?? null,
                routes: (fold.routes ?? []).map((route) => ({ ...route, edit: edit && !!route.edit })),
                within: (fold.within ?? []).map((link) => ({ ...link, index: keys.indexOf(link.key) })),
                canShow: !row.ground,
                canEdit: edit && !!fold.edit,
                settlementMap: card?.id && (card.card || card.heldOwn) ? card.id : null,
            };
        });
        return {
            held: true,
            touch: coarse,
            count: held.list.length,
            countLabel: held.list.length === 1 ? i18n.localize("FILRODENSWMB.UI.InspectThingsHereOne") : i18n.format("FILRODENSWMB.UI.InspectThingsHere", { count: held.list.length }),
            folds,
        };
    }

    // ------------------------------------------------------------------ the folds' links

    /** The entry of the held list a panel element belongs to, or null. */
    static #entryOf(app, target) {
        const index = Number(target?.closest("[data-inspect-index]")?.dataset.inspectIndex);
        return Number.isInteger(index) ? this.#state(app).reader?.held?.list[index] ?? null : null;
    }

    /** Show on map: frames the fold's feature (a route of a group by its id). */
    static show(app, target) {
        const entry = this.#entryOf(app, target);
        if (!entry?.kind.outline) return;
        const routeId = target.closest("[data-inspect-route]")?.dataset.inspectRoute;
        const item = routeId ? { ...entry.item, routes: entry.item.routes.filter((route) => route.id === routeId) } : entry.item;
        const points = pointsOf(entry.kind.outline(app, item));
        if (points.length) app.canvasEngine?.zoomToFeature(points);
    }

    /** Opens the fold's settlement map (view only too). */
    static async openSettlementMap(app, target) {
        const id = target.closest("[data-settlement-id]")?.dataset.settlementId;
        if (id) await SettlementMaps.open(app, id);
    }

    /**
     * A region in a fold's In line: its own fold when it is in the list, else its centre held
     * and framed.
     */
    static goToRegion(app, target) {
        const link = target.closest("[data-inspect-region]");
        if (!link) return;
        const index = Number(link.dataset.inspectTo);
        if (Number.isInteger(index) && index >= 0) {
            this.#state(app).open = index;
            app.view?.render(["context"]);
            return;
        }
        const bounds = app.meshSession?.regionBounds(link.dataset.levelId, Number(link.dataset.regionKey));
        if (!bounds) return;
        app.canvasEngine?.zoomToFeature([{ x: bounds.minX, y: bounds.minY }, { x: bounds.maxX, y: bounds.maxY }]);
        this.#state(app).reader?.hold((bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2);
    }

    /**
     * Edit: the feature's own tool, its inspector open (Ken, EX1 answer 4); not in view only.
     */
    static async edit(app, target) {
        if (app.viewOnly) return;
        const entry = this.#entryOf(app, target);
        if (!entry) return;
        const routeId = target.closest("[data-inspect-route]")?.dataset.inspectRoute;
        const fold = entry.kind.fold(app, entry.item, { edit: true });
        const ref = routeId ? { kind: "route", id: routeId } : fold?.edit;
        if (!ref) return;
        switch (ref.kind) {
            case "pin":
                app.uiState.activeInfraMode = "pin";
                await app.switchTool("infrastructure", { force: true });
                await PinEditor.open(app, ref.id);
                break;
            case "route":
                app.uiState.activeInfraMode = "route";
                await app.switchTool("infrastructure", { force: true });
                await Inspector.openById(app, "route", { id: ref.id });
                break;
            case "river":
                await app.switchTool("features", { force: true });
                await RiverEditor.open(app, ref.id);
                break;
            case "label":
                await app.switchTool("labels", { force: true });
                await LabelEditor.open(app, { id: ref.id, type: "custom", layerId: null });
                break;
            case "region":
                await app.switchTool("regions", { force: true });
                await RegionEditor.open(app, ref.levelId, ref.id);
                break;
            default:
                break;
        }
    }

    // ------------------------------------------------------------------ the panel's own events

    /**
     * The panel's folds: one open at a time (the open one remembered across redraws), and the
     * hovered fold's feature outlined on the map while the card stays away.
     */
    static #listen(app) {
        const root = app.root;
        if (!root) return;
        const state = this.#state(app);
        const foldOf = (event) => event.target?.closest?.(".fwmb-inspect-folds [data-inspect-index]");
        const onToggle = (event) => {
            const fold = event.target;
            if (!fold?.matches?.(".fwmb-fold[data-inspect-index]") || !fold.open) return;
            state.open = Number(fold.dataset.inspectIndex);
            for (const other of root.querySelectorAll(".fwmb-fold[data-inspect-index][open]")) if (other !== fold) other.open = false;
        };
        const onOver = (event) => {
            if (!this.active(app) || !state.reader) return;
            const element = foldOf(event);
            const entry = element ? this.#entryOf(app, element) : null;
            const shape = entry?.kind.outline ? entry.kind.outline(app, entry.item) : null;
            app.canvasEngine?.inspectOverlay?.setOutline(shape);
            state.reader?.suspend(!!shape);
        };
        const onOut = (event) => {
            if (!this.active(app) || !state.reader) return;
            if (foldOf(event) && !event.relatedTarget?.closest?.(".fwmb-inspect-folds")) {
                app.canvasEngine?.inspectOverlay?.setOutline(null);
                state.reader?.suspend(false);
            }
        };
        root.addEventListener("toggle", onToggle, true);
        root.addEventListener("pointerover", onOver);
        root.addEventListener("pointerout", onOut);
        state.listeners = () => {
            root.removeEventListener("toggle", onToggle, true);
            root.removeEventListener("pointerover", onOver);
            root.removeEventListener("pointerout", onOut);
        };
    }
}

/** The points framing an outline (see InspectKind.outline). */
function pointsOf(shape) {
    if (!shape) return [];
    const points = [];
    for (const line of shape.lines ?? []) for (let i = 0; i + 1 < line.length; i += 2) points.push({ x: line[i], y: line[i + 1] });
    if (shape.ring) points.push({ x: shape.ring.x - shape.ring.radius, y: shape.ring.y - shape.ring.radius }, { x: shape.ring.x + shape.ring.radius, y: shape.ring.y + shape.ring.radius });
    if (shape.box) points.push({ x: shape.box.minX, y: shape.box.minY }, { x: shape.box.maxX, y: shape.box.maxY });
    return points;
}
