import { Inspector } from "./Inspector.js";
import { LabelEditor } from "./LabelEditor.js";
import { PinEditor } from "./PinEditor.js";
import { DecorationEditor, FaultEditor, LandMaskEditor, RiverEditor } from "./FeatureEditors.js";

/** The modes of the tools that place things (pins, labels), in toolbar order. */
export const PICK_MODES = Object.freeze(["select", "place"]);

/** How near a line or outline a click must be to pick it, in screen pixels. */
const LINE_REACH_PX = 8;

/** The modes of pins and labels: the uiState key holding each one's mode, and its toolbar labels and icons. */
const PLACERS = Object.freeze({
    pin: {
        modeKey: "pinToolMode",
        labels: { select: "FILRODENSWMB.UI.PinModeSelect", place: "FILRODENSWMB.UI.PinModePlace" },
        icons: { select: "select", place: "add" },
    },
    label: {
        modeKey: "labelToolMode",
        labels: { select: "FILRODENSWMB.UI.LabelModeSelect", place: "FILRODENSWMB.UI.LabelModePlace" },
        icons: { select: "select", place: "insert-text" },
    },
});

/**
 * Every Select mode this class runs, by the tool (and mode) it belongs to: whether the studio is
 * in it, what is under a map point (`{ kind, id, hit }`), and how the inspector opens on that.
 */
const PICKERS = Object.freeze({
    pin: {
        applies: (app) => app.activeTool === "infrastructure" && app.uiState.activeInfraMode === "pin",
        selecting: (app) => app.uiState.pinToolMode !== "place",
        itemAt: (app, x, y) => wrap("pin", app.canvasEngine?.hitTest(x, y, "pin")),
        open: (app, item) => PinEditor.open(app, item.id),
    },
    label: {
        applies: (app) => app.activeTool === "labels",
        selecting: (app) => app.uiState.labelToolMode !== "place",
        itemAt: (app, x, y) => wrap("label", app.canvasEngine?.hitTest(x, y, "label")),
        open: (app, item) => LabelEditor.open(app, { id: item.id, type: item.hit.parentType ?? "custom", layerId: item.hit.layerId ?? null }),
    },
    feature: {
        applies: (app) => app.activeTool === "features",
        selecting: (app) => app.uiState.activeFeatureMode === "select",
        // A fault is drawn with its area of effect around it, so a click anywhere in that picks it
        itemAt: (app, x, y) => nearestLine(app, x, y, [["river", app.manualRivers], ["fault", app.tectonicFaults, (fault) => fault.thickness ?? 0]]),
        open: (app, item) => (item.kind === "river" ? RiverEditor : FaultEditor).open(app, item.id),
    },
    landMask: {
        applies: (app) => app.activeTool === "scene" && app.uiState.generationEngine === "guided",
        selecting: (app) => app.uiState.sceneMode === "select",
        itemAt: (app, x, y) => maskAt(app, x, y),
        open: (app, item) => LandMaskEditor.open(app, item.id),
    },
    decoration: {
        applies: (app) => app.activeTool === "cartography",
        selecting: (app) => app.uiState.cartographyMode !== "move",
        itemAt: (app, x, y) => wrap("decoration", app.canvasEngine?.hitTest(x, y, "decoration")),
        open: (app, item) => DecorationEditor.open(app, item.id),
    },
});

/** A canvas hit as a picked item. */
function wrap(kind, hit) {
    return hit ? { kind, id: hit.entityId, hit } : null;
}

/** How far a map point lies from the segment a–b. */
function segmentDistance(x, y, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / length)) : 0;
    return Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy));
}

/** The map distance LINE_REACH_PX covers at the current zoom. */
function reach(app) {
    return LINE_REACH_PX / (app.canvasEngine?.stage?.scale?.x || 1);
}

/**
 * The line (of the lists given, each with its kind and optionally how far beyond the line it
 * reaches, in map pixels) nearest a map point within reach, or null.
 */
function nearestLine(app, x, y, lists) {
    let best = null;
    let bestDistance = Infinity;
    for (const [kind, lines, extent] of lists) {
        for (const line of lines ?? []) {
            const within = Math.max(reach(app), extent?.(line) ?? 0);
            const points = line.points ?? [];
            for (let i = 1; i < points.length; i++) {
                const distance = segmentDistance(x, y, points[i - 1], points[i]);
                if (distance <= within && distance < bestDistance) {
                    bestDistance = distance;
                    best = { kind, id: line.id };
                }
            }
        }
    }
    return best;
}

/** The land mask whose outline is nearest a map point within reach, or else the last one drawn that holds it. */
function maskAt(app, x, y) {
    const masks = app.landMasks ?? [];
    const closed = masks.map((mask) => ({ ...mask, points: [...(mask.points ?? []), ...(mask.points?.length ? [mask.points[0]] : [])] }));
    const outline = nearestLine(app, x, y, [["landMask", closed]]);
    if (outline) return outline;
    for (let i = masks.length - 1; i >= 0; i--) {
        if (contains(masks[i].points ?? [], x, y)) return { kind: "landMask", id: masks[i].id };
    }
    return null;
}

/** Whether a polygon holds a point (even-odd rule). */
function contains(points, x, y) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const a = points[i];
        const b = points[j];
        if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
}

/**
 * The Select modes of the tools whose objects the inspector shows and which have no pointer tool
 * of their own: pins (Pin mode) and labels, with Place beside it; rivers and faults; land masks
 * (a Guided map's New map); and decorations (Cartography, with Move beside it). Regions and
 * routes have their own (RegionPainter, RouteTool).
 *
 * Select does not edit: a click on an object opens it in the inspector, a click away or Escape
 * closes it, and nothing is placed, drawn or moved. The map still takes the clicks while editing
 * is off (see MapStudio#canvasInteractive). Every tool is in Select while nothing is being edited
 * (see MapStudio#returnToSelect).
 */
export class PickTool {
    /** Per-studio pointer tool, made once (see tool). */
    static #tools = new WeakMap();

    /** The picker for the studio's tool and mode, or null. */
    static #picker(app) {
        return Object.values(PICKERS).find((picker) => picker.applies(app)) ?? null;
    }

    /** Which of pins and labels the studio's tool places ("pin" or "label"), or null. */
    static which(app) {
        if (PICKERS.label.applies(app)) return "label";
        if (PICKERS.pin.applies(app)) return "pin";
        return null;
    }

    /** The mode of pins or labels (one of PICK_MODES); Select unless Place was chosen. */
    static mode(app, which = this.which(app)) {
        const placer = PLACERS[which];
        if (!placer) return null;
        return app.uiState[placer.modeKey] === "place" ? "place" : "select";
    }

    /** Whether the active tool is in a Select mode this class runs. */
    static selecting(app) {
        const picker = this.#picker(app);
        return !!picker && picker.selecting(app);
    }

    /** Sets the mode of pins or labels (a toolbar button's data-mode). @returns {boolean} Whether it was theirs to set. */
    static setMode(app, mode) {
        const placer = PLACERS[this.which(app)];
        if (!placer || !PICK_MODES.includes(mode)) return false;
        app.uiState[placer.modeKey] = mode;
        return true;
    }

    /** Editing starts in an editing mode: pins and labels in Place, Rivers and faults in River. */
    static settleForEditing(app) {
        const placer = PLACERS[this.which(app)];
        if (placer) app.uiState[placer.modeKey] = "place";
        if (PICKERS.feature.applies(app) && app.uiState.activeFeatureMode === "select") app.uiState.activeFeatureMode = "river";
    }

    /** The toolbar's modes for pins or labels: `{ value, active, icon, label }`. */
    static toolbarModes(app) {
        const which = this.which(app);
        const placer = PLACERS[which];
        if (!placer) return [];
        const mode = this.mode(app, which);
        return PICK_MODES.map((value) => ({ value, active: value === mode, icon: placer.icons[value], label: placer.labels[value] }));
    }

    /**
     * The canvas's pointer tool while a Select mode is on (see StudioCanvas.pointerToolProvider),
     * or null: a press on an object opens it in the inspector, a press away closes the inspector,
     * and a double-click opens too. Nothing is dragged.
     */
    static tool(app) {
        if (!this.selecting(app)) return null;
        if (!this.#tools.has(app)) {
            this.#tools.set(app, {
                down: (x, y) => this.#pick(app, x, y),
                move: () => {},
                up: () => {},
                hover: (x, y) => this.#setCursor(app, this.#picker(app)?.itemAt(app, x, y) ? "pointer" : "default"),
                doubleClick: (x, y) => this.#pick(app, x, y),
                leave: () => this.#setCursor(app, "default"),
            });
        }
        return this.#tools.get(app);
    }

    /**
     * Escape in a Select mode closes the inspector.
     * @returns {boolean} Whether the key was used.
     */
    static handleKey(app, event) {
        if (event.key !== "Escape" || !this.selecting(app) || !Inspector.current(app)) return false;
        Inspector.close(app);
        return true;
    }

    static #pick(app, x, y) {
        const picker = this.#picker(app);
        const item = picker?.itemAt(app, x, y);
        if (item) picker.open(app, item);
        else Inspector.close(app);
    }

    static #setCursor(app, cursor) {
        const canvas = app.canvasEngine?.app?.canvas ?? app.canvasEngine?.app?.view;
        if (canvas && canvas.style.cursor !== cursor) canvas.style.cursor = cursor;
    }
}
