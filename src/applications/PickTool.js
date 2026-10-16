import { Inspector } from "./Inspector.js";
import { LabelEditor } from "./LabelEditor.js";
import { PinEditor } from "./PinEditor.js";

/** The modes of the tools that place things (pins, labels), in toolbar order. */
export const PICK_MODES = Object.freeze(["select", "place"]);

/**
 * The tools with a Select mode beside their placing mode: each names the uiState key holding its
 * mode, the canvas items it picks, how the inspector opens on one, the inspector kind it closes on
 * a click away, and its toolbar labels and icons.
 */
const PICKERS = Object.freeze({
    pin: {
        modeKey: "pinToolMode",
        entityType: "pin",
        kind: "pin",
        open: (app, hit) => PinEditor.open(app, hit.entityId),
        labels: { select: "FILRODENSWMB.UI.PinModeSelect", place: "FILRODENSWMB.UI.PinModePlace" },
        icons: { select: "select", place: "add" },
    },
    label: {
        modeKey: "labelToolMode",
        entityType: "label",
        kind: "label",
        open: (app, hit) => LabelEditor.open(app, { id: hit.entityId, type: hit.parentType ?? "custom", layerId: hit.layerId ?? null }),
        labels: { select: "FILRODENSWMB.UI.LabelModeSelect", place: "FILRODENSWMB.UI.LabelModePlace" },
        icons: { select: "select", place: "insert-text" },
    },
});

/**
 * The Select mode of the tools that place things: pins (the Infrastructure tool in Pin mode) and
 * labels (the Labels tool). Place puts a new item on the map and moves existing ones (the editing
 * mode); Select only picks: a click on an item opens it in the inspector, a click away closes it,
 * and nothing is placed or moved. Like the Select modes of Regions and Routes, it does not edit, so
 * choosing it turns editing off while the map still takes the clicks (see MapStudio#canvasInteractive).
 */
export class PickTool {
    /** Per-studio pointer tool, made once (see tool). */
    static #tools = new WeakMap();

    /** Which picker the studio's tool and mode use ("pin" or "label"), or null. */
    static which(app) {
        if (app.activeTool === "labels") return "label";
        if (app.activeTool === "infrastructure" && app.uiState.activeInfraMode === "pin") return "pin";
        return null;
    }

    /** The mode in use for a picker (one of PICK_MODES); Select unless Place was chosen. */
    static mode(app, which = this.which(app)) {
        const picker = PICKERS[which];
        if (!picker) return null;
        return app.uiState[picker.modeKey] === "place" ? "place" : "select";
    }

    /** Whether the active tool is a picker in its Select mode. */
    static selecting(app) {
        return this.mode(app) === "select";
    }

    /** Sets the active picker's mode (a toolbar button's data-mode). @returns {boolean} Whether it changed. */
    static setMode(app, mode) {
        const picker = PICKERS[this.which(app)];
        if (!picker || !PICK_MODES.includes(mode)) return false;
        app.uiState[picker.modeKey] = mode;
        return true;
    }

    /** Editing starts in Place: a picker left in Select places once editing is turned on. */
    static settleForEditing(app) {
        const picker = PICKERS[this.which(app)];
        if (picker) app.uiState[picker.modeKey] = "place";
    }

    /** The toolbar's modes for the active picker: `{ value, active, icon, label }`. */
    static toolbarModes(app) {
        const which = this.which(app);
        const picker = PICKERS[which];
        if (!picker) return [];
        const mode = this.mode(app, which);
        return PICK_MODES.map((value) => ({ value, active: value === mode, icon: picker.icons[value], label: picker.labels[value] }));
    }

    /**
     * The canvas's pointer tool while a picker is in Select mode (see StudioCanvas.pointerToolProvider),
     * or null: a press on an item of the picker's kind opens it in the inspector, a press away closes
     * the inspector if it shows that kind, and a double-click opens too. Nothing is dragged.
     */
    static tool(app) {
        if (!this.selecting(app)) return null;
        if (!this.#tools.has(app)) {
            this.#tools.set(app, {
                down: (x, y) => this.#pick(app, x, y),
                move: () => {},
                up: () => {},
                hover: (x, y) => this.#hover(app, x, y),
                doubleClick: (x, y) => this.#pick(app, x, y),
                leave: () => this.#setCursor(app, "default"),
            });
        }
        return this.#tools.get(app);
    }

    /**
     * Escape in Select mode closes the inspector when it shows the picker's kind.
     * @returns {boolean} Whether the key was used.
     */
    static handleKey(app, event) {
        if (event.key !== "Escape" || !this.selecting(app)) return false;
        const picker = PICKERS[this.which(app)];
        if (Inspector.current(app)?.kind.id !== picker.kind) return false;
        Inspector.close(app);
        return true;
    }

    /** The picker's item under a map point, or null. */
    static #itemAt(app, x, y) {
        const picker = PICKERS[this.which(app)];
        const hit = picker ? app.canvasEngine?.hitTest(x, y, picker.entityType) : null;
        return hit ? { picker, hit } : null;
    }

    static #pick(app, x, y) {
        const found = this.#itemAt(app, x, y);
        if (found) {
            found.picker.open(app, found.hit);
            return;
        }
        const picker = PICKERS[this.which(app)];
        if (picker && Inspector.current(app)?.kind.id === picker.kind) Inspector.close(app);
    }

    static #hover(app, x, y) {
        this.#setCursor(app, this.#itemAt(app, x, y) ? "pointer" : "default");
    }

    static #setCursor(app, cursor) {
        const canvas = app.canvasEngine?.app?.canvas ?? app.canvasEngine?.app?.view;
        if (canvas && canvas.style.cursor !== cursor) canvas.style.cursor = cursor;
    }
}
