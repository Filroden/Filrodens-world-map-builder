import { FILRODENSWMB } from "../../config.js";
import { platform } from "../../platform/index.js";
import { formatDistance } from "../data/MapUnit.js";
import { AreaControl } from "./AreaControl.js";
import { ExportArea, ExportScale, SceneArea } from "./ExportScale.js";
import { ImageFormat } from "./ImageFormat.js";

const TEMPLATE = "modules/filrodens-world-map-builder/templates/shell/dialogs/export.hbs";

/** How long the estimates wait after the area or scale last changed. */
const ESTIMATE_WAIT_MS = 250;

/** How long the scene's name waits after typing before the dialogue looks for a scene of that name. */
const NAME_WAIT_MS = 300;

/** The preview's longest side, in pixels drawn (its CSS size at twice the pixels). */
const PREVIEW_SIDE = 1200;

/** Below these sizes of the studio, the dialogue takes one column, and its preview less height. */
const ONE_COLUMN_BELOW = 900;
const SHORT_BELOW = 760;

/**
 * The export dialogue (S0 step 7; the decision record's §9, DE; boards X1a, X1b, X2a, X2b, X4): one
 * dialogue for every image export and for Export to scene. The **Area** (presets, Aspect, the map
 * as it shows now with the area over it, see AreaControl), **Scale** (one slider in steps of 0.05
 * from 0.25× to the map type's ceiling, the recommendation flagged, the terrain line, and at the
 * ceiling the steer to Cut regional world…), the image's size or **Too large** with its two
 * nearest fits, **Image format and quality** with each format's size estimated from sample tiles
 * inside the area, and **File name**. Export draws the image in tiles, one a frame, with its
 * progress and Cancel in the dialogue; **Close and keep drawing** leaves a toast with Cancel, and
 * the studio is held meanwhile (see the source's `hold`). The preset, aspect and format are
 * remembered for each kind of export; a drawn area never is.
 *
 * **Export to scene** (step 7b) snaps the area to the grid on release (whole cells, its corner on
 * a grid corner; see SceneArea), takes a scale at which a cell is whole pixels, offers the journal
 * and GM overlay choices and the scene's name and folder, and warns when the scene of that name
 * was made with another area or scale.
 *
 * The studio hands it a **source**: what it needs of the map, and how to draw it.
 *
 * @typedef {object} ExportSource
 * @property {"png"|"scene"} kind - The kind of export, whose choices are remembered.
 * @property {string} title - The dialogue's title (Export image, Export this age…).
 * @property {string} name - What the file is named from (the map's, the age's, the journey's).
 * @property {{width: number, height: number}} map - The map's size in pixels.
 * @property {{x: number, y: number, width: number, height: number}|null} view - What is on screen, in map pixels.
 * @property {number|null} smallestLabelPx - The smallest name shown, in map pixels.
 * @property {number} kmPerPx - The ground a map pixel covers, in km.
 * @property {string} unit - The map's unit of distance.
 * @property {number|null} rasterPx - The terrain's own pixels across (null: no raster terrain).
 * @property {number} ceiling - The largest scale offered.
 * @property {number} tileLimit - The largest tile drawn at once.
 * @property {(side: number) => HTMLCanvasElement|null|Promise<HTMLCanvasElement|null>} drawPreview - The map as it shows now, its longest side `side` (drawn now, or later).
 * @property {(area: object, scale: number, choice?: {kind: string|null, options: object}) => {tiles: HTMLCanvasElement[], pixels: number}|Promise<object>} samples
 * @property {(area: object, scale: number, options: {onTile: Function, signal: AbortSignal}) => Promise<HTMLCanvasElement|null>} [draw] - An image export's drawing.
 * @property {(() => string|null)} [cutOff] - Why a regional world cannot be cut (null when it can).
 *
 * A map type may give the dialogue its own parts (a settlement map, L-surface step 5); the World
 * studio gives none of these, and the dialogue is as S0 built it:
 * @property {Array<{id: string, label: string, what: string, area: object}>} [presets] - The Area's
 *   presets in place of Whole map and What's on screen, the first the default: each its label, the
 *   image line's key ("of the town view at {scale}") and its area in map pixels.
 * @property {Array<{stop: number, label: string, minor?: boolean}>} [stops] - The slider's stops, labelled.
 * @property {(scale: number) => string|null} [scaleName] - A scale's name in place of "2×" (Finest), or null.
 * @property {{lengths: (width: number, height: number) => {width: string, height: string, unit: string}, pixel: (scale: number) => {distance: string, unit: string}}} [measure]
 *   - The ground an area and a pixel cover, in the map type's own units (in place of the map's unit and km a pixel).
 * @property {{scale: number, reason: string}} [recommended] - The scale recommended and why (in place of
 *   the smallest names'); the scale starts there, or at the largest that fits when it does not.
 * @property {string} [scaleNote] - A line under the slider.
 * @property {{preset: string, aspect: string}} [settings] - The settings the preset and aspect are remembered in.
 * @property {(choice: {preset: string, scale: number, kind: string|null}) => string} [fileName] - The file name from the choices.
 * @property {Array<{id: string, label: string, action: string, settings: {preset: string, aspect: string}, off?: string|null, sheet?: (part: {width: number, height: number}) => {width: number, height: number, below: boolean, side?: number}}>} [kinds]
 *   - The What row (a settlement map's Map only and Report): each kind's label, its action's label,
 *   the settings its preset and aspect are remembered in, why it is off (or null), and for a sheet
 *   (the report) the whole image from the area's part; shown when there are two or more.
 * @property {string} [kindSetting] - The setting the What chosen is remembered in.
 * @property {Array<{id: string, label: string, hint?: string, setting: string}>} [options] - Checkboxes
 *   under the image (a settlement map's Legend, while a thematic view is on), on by default and
 *   remembered; their values go to draw, samples and fileName as `options`.
 * @property {((area: object) => void)} [cut] - Opens Cut regional world… on the area.
 * @property {((on: boolean) => void)} [hold] - Holds the studio while the export draws, and frees it.
 * @property {{type: string, size: number}} [grid] - A scene's: the map's grid type and size.
 * @property {number} [minCell] - A scene's: the least grid size, in the scene's pixels.
 * @property {number} [maxSide] - A scene's: the graphics card's largest texture.
 * @property {string} [sceneName] - A scene's: the name it is first offered.
 * @property {string} [folder] - A scene's: the folder it is first offered.
 * @property {(area: object) => number} [pageCount] - A scene's: the journal pages the area gives.
 * @property {(name: string) => Promise<object|null>} [previous] - A scene's: the area and scale the scene of that name was made with.
 * @property {(choice: object, progress: {onTile: Function, onStage: Function, signal: AbortSignal}) => Promise<boolean>} [exportScene] - Makes the scene.
 */
export class ExportDialog {
    /**
     * Opens the dialogue. Resolves once it has closed and any drawing left going has ended: true
     * when the image was saved (or the scene made).
     * @param {ExportSource} source
     * @returns {Promise<boolean>}
     */
    static async open(source) {
        const dialog = new ExportDialog(source);
        return dialog.#open();
    }

    #source;
    #scene;
    #overlay = null;
    #parts = {};
    #control = null;
    #formats = [];
    #area;
    #cells = null;
    #drawnOutline = null;
    #preset;
    #lastPreset;
    #aspect;
    #scale;
    #recommend;
    #format;
    #typedName = null;
    #estimates = new Map();
    #estimateTimer = null;
    #previous = null;
    #nameTimer = null;
    #drawing = null;
    #running = null;
    #kept = false;
    #toast = null;
    #resize = null;
    #kindId = null;
    #options = {};

    constructor(source) {
        this.#source = source;
        this.#scene = source.kind === "scene";
    }

    /** The What chosen (a map type's own kinds), or null. */
    get #kind() {
        return this.#source.kinds?.find((kind) => kind.id === this.#kindId) ?? null;
    }

    /** The setting keys of this kind's remembered preset and aspect. */
    get #settings() {
        if (this.#kind?.settings) return this.#kind.settings;
        if (this.#source.settings) return this.#source.settings;
        const { SETTINGS } = FILRODENSWMB.EXPORT_PNG;
        return this.#scene ? { preset: SETTINGS.PRESET_SCENE, aspect: SETTINGS.ASPECT_SCENE } : { preset: SETTINGS.PRESET_PNG, aspect: SETTINGS.ASPECT_PNG };
    }

    /** Whether the area snaps to a grid (a scene's, on a map with one). */
    get #snaps() {
        return this.#scene && !!SceneArea.geometry(this.#source.grid ?? {});
    }

    async #open() {
        const { i18n } = platform;
        const source = this.#source;
        const { ASPECTS, SCALE } = FILRODENSWMB.EXPORT_PNG;
        const available = await ImageFormat.available();
        this.#formats = available.map((id) => ({ id, label: i18n.localize(ImageFormat.byId(id).label) }));
        this.#format = ImageFormat.remembered(source.kind, available);
        if (source.kinds?.length) {
            const open = source.kinds.filter((kind) => !kind.off).map((kind) => kind.id);
            this.#kindId = source.kindSetting ? this.#setting(source.kindSetting, open.length ? open : [source.kinds[0].id]) : (open[0] ?? source.kinds[0].id);
        }
        this.#options = Object.fromEntries((source.options ?? []).map((option) => [option.id, this.#flag(option.setting)]));
        this.#preset = this.#setting(this.#settings.preset, this.#presetIds());
        this.#lastPreset = this.#preset;
        this.#aspect = this.#setting(this.#settings.aspect, ASPECTS.map((aspect) => aspect.id));
        this.#setArea(this.#presetArea(this.#preset));
        this.#recommend = source.recommended ? { scale: source.recommended.scale, kind: "given" } : ExportArea.recommend(source.smallestLabelPx, source.ceiling);
        this.#scale = this.#sceneScale(this.#recommend.scale);
        // A recommendation of the map type's own starts at the largest scale that fits, when it does not
        if (source.recommended && !this.#plan().fits && this.#plan().fitScale) this.#scale = this.#sceneScale(this.#plan().fitScale, { fit: true });

        const stops = source.stops ?? [...SCALE.STOPS.filter((stop) => stop <= source.ceiling).map((stop) => ({ stop, label: `${stop}×` })), ...SCALE.MINOR.map((stop) => ({ stop, minor: true }))];
        const content = await platform.templates.render(TEMPLATE, {
            presets: this.#presetIds().map((id) => ({ id, label: this.#presetLabel(id) })),
            kinds: source.kinds?.length > 1 ? source.kinds.map(({ id, label, off = null }) => ({ id, label, off })) : null,
            kindCount: source.kinds?.length ?? 0,
            sheets: !!source.kinds?.some((kind) => kind.sheet),
            options: (source.options ?? []).map(({ id, label, hint = "" }) => ({ id, label, hint, checked: this.#options[id] })),
            aspects: ASPECTS.map(({ id }) => ({ id, label: i18n.localize(ASPECT_LABELS[id]) })),
            ratio: source.map.width / source.map.height,
            min: SCALE.MIN,
            ceiling: source.ceiling,
            stops: stops.map(({ stop, minor = false, label = "" }) => ({ minor, pos: this.#position(stop) * 100, label })),
            note: source.scaleNote ?? null,
            formats: this.#formats,
            scene: this.#scene,
            snaps: this.#snaps,
            sceneName: source.sceneName ?? "",
            folder: source.folder ?? "",
        });

        const action = this.#scene ? { label: i18n.localize("FILRODENSWMB.UI.ExportScene"), icon: "fwmb-icon fwmb-icon--map" } : { label: this.#kind?.action ?? i18n.localize("FILRODENSWMB.UI.ExportPNG"), icon: "fwmb-icon fwmb-icon--png" };
        this.#overlay = platform.dialogs.show({
            title: source.title,
            content,
            classes: ["fwmb", "fwmb-export"],
            footer: "split",
            dismissed: false,
            buttons: [
                { action: "cancel", label: i18n.localize("FILRODENSWMB.UI.Cancel"), start: true, callback: () => false },
                { action: "keep", label: i18n.localize("FILRODENSWMB.UI.ExportKeepDrawing"), stays: true, callback: () => this.#keepDrawing() },
                { action: "export", label: action.label, icon: action.icon, default: true, stays: true, callback: () => this.#export() },
            ],
            onRender: (element) => this.#bind(element),
        });
        this.#overlay.button("keep").hidden = true;
        this.#overlay.button("keep").dataset.tooltip = i18n.localize(this.#scene ? "FILRODENSWMB.UI.ExportKeepDrawingSceneHint" : "FILRODENSWMB.UI.ExportKeepDrawingHint");
        // The footer is drawn with the dialogue: its start line and Export follow the choice now
        this.#update();
        if (this.#scene) this.#lookForScene();

        const closed = await this.#overlay.closed;
        clearTimeout(this.#estimateTimer);
        clearTimeout(this.#nameTimer);
        this.#resize?.disconnect();
        this.#control?.destroy();
        // Closed while drawing: Close and keep drawing leaves it going; Cancel and Escape stop it
        if (closed !== "kept") this.#drawing?.abort();
        const saved = this.#running ? await this.#running : closed === true;
        return saved === true;
    }

    /** A remembered choice for this kind of export, if it is still one of `allowed`; the first otherwise. */
    #setting(key, allowed) {
        let value = null;
        try {
            value = platform.settings.get(key);
        } catch {
            // Not registered (a host without the settings): the default
        }
        return allowed.includes(value) ? value : allowed[0];
    }

    /** A remembered checkbox (on unless it was turned off). */
    #flag(key) {
        try {
            return platform.settings.get(key) !== false;
        } catch {
            return true;
        }
    }

    /** The choice drawn: the What and the checkboxes. */
    #choice() {
        return { kind: this.#kindId, options: { ...this.#options } };
    }

    /** The What row: another kind, the dialogue changed in place (its action, the sheet, the size). */
    #chooseKind(id) {
        const kind = this.#source.kinds?.find((each) => each.id === id);
        if (!kind || kind.off || id === this.#kindId || this.#drawing) return;
        this.#kindId = id;
        const button = this.#overlay?.button("export");
        if (button?.lastChild) button.lastChild.textContent = kind.action;
        this.#update({ estimate: true });
    }

    /** The Area's presets: the map type's own, or Whole map and What's on screen. */
    #presetIds() {
        return this.#source.presets?.map((preset) => preset.id) ?? FILRODENSWMB.EXPORT_PNG.PRESETS;
    }

    #presetLabel(id) {
        const own = this.#source.presets?.find((preset) => preset.id === id);
        return own ? own.label : platform.i18n.localize(PRESET_LABELS[id]);
    }

    #presetArea(preset) {
        const { map, view } = this.#source;
        const own = this.#source.presets?.find((each) => each.id === preset);
        const area = own ? ExportArea.clip(own.area, map) : ExportArea.preset(preset, map, view);
        return ExportArea.withAspect(area, ExportArea.ratio(this.#aspect, map), map);
    }

    /** The area, snapped to the grid for a scene (see SceneArea.snap). */
    #setArea(area, { fit = false } = {}) {
        if (this.#snaps) {
            const snapped = SceneArea.snap(area, this.#source.grid, this.#source.map, { fit });
            this.#area = snapped.area;
            this.#cells = snapped.cells;
        } else {
            this.#area = ExportArea.clip(area, this.#source.map);
            this.#cells = null;
        }
        if (this.#control) this.#control.area = this.#area;
    }

    /** A scale offered: in the slider's steps, and for a scene one that makes each cell whole pixels. */
    #sceneScale(value, { fit = false } = {}) {
        const stepped = ExportArea.snapScale(value, this.#source.ceiling);
        if (!this.#snaps) return stepped;
        return SceneArea.scale(fit ? value : stepped, this.#source.grid, this.#source.minCell ?? FILRODENSWMB.LIMITS.MIN_GRID_SIZE, { fit }).scale;
    }

    // ------------------------------------------------------------------ the parts

    #bind(element) {
        const body = element.querySelector(".fwmb-overlay-body");
        body.classList.add("fwmb-export-body");
        const find = (selector) => element.querySelector(selector);
        this.#parts = {
            element,
            presets: [...element.querySelectorAll("[data-export-preset]")],
            drawn: find("[data-export-drawn]"),
            aspect: find('[name="exportAspect"]'),
            preview: find("[data-export-preview]"),
            areaHint: find("[data-export-area-hint]"),
            areaRead: find("[data-export-area-read]"),
            progress: find("[data-export-progress]"),
            tile: find("[data-export-tile]"),
            then: find("[data-export-then]"),
            bar: find("[data-export-bar]"),
            stop: find("[data-export-stop]"),
            track: find("[data-export-track]"),
            rec: find("[data-export-rec]"),
            scaleField: find('[name="exportScale"]'),
            scaleRead: find("[data-export-scale-read]"),
            ground: find("[data-export-ground]"),
            reason: find("[data-export-reason]"),
            floor: find("[data-export-floor]"),
            terrain: find("[data-export-terrain]"),
            note: find("[data-export-note]"),
            steer: find("[data-export-steer]"),
            cut: find("[data-export-cut]"),
            result: find("[data-export-result]"),
            size: find("[data-export-size]"),
            what: find("[data-export-what]"),
            tooLarge: find("[data-export-toolarge]"),
            limit: find("[data-export-limit]"),
            fitScale: find('[data-export-fit="scale"]'),
            fitArea: find('[data-export-fit="area"]'),
            formatRows: [...element.querySelectorAll("[data-export-format]")],
            fileName: find('[name="exportFileName"]'),
            ext: find("[data-export-ext]"),
            pages: find("[data-export-pages]"),
            sceneName: find('[name="sceneName"]'),
            folder: find('[name="exportFolder"]'),
            journals: find('[name="generateJournals"]'),
            overwrite: find('[name="overwriteJournals"]'),
            overlay: find('[name="createGmOverlay"]'),
            warn: find("[data-export-warn]"),
            warnText: find("[data-export-warn-text]"),
            useMade: find("[data-export-use-made]"),
            kinds: [...element.querySelectorAll("[data-export-kind]")],
            sheet: find("[data-export-sheet]"),
            sheetBox: find("[data-export-sheet-box]"),
            sheetMap: find("[data-export-sheet-map]"),
            options: [...element.querySelectorAll("[data-export-option]")],
        };
        const parts = this.#parts;
        parts.aspect.value = this.#aspect;

        // The map as it shows now, once (drawn now, or by a worker and shown when it comes)
        const shown = (picture) => {
            if (!picture || !parts.element.isConnected) return;
            parts.preview.prepend(picture);
            this.#showSheet(this.#plan());
        };
        const failed = (error) => console.warn("FWMB | The export's preview could not be drawn:", error);
        try {
            const picture = this.#source.drawPreview(PREVIEW_SIDE);
            if (typeof picture?.then === "function") picture.then(shown, failed);
            else shown(picture);
        } catch (error) {
            failed(error);
        }
        this.#showGrid();
        this.#control = new AreaControl(parts.preview, {
            map: this.#source.map,
            area: this.#area,
            label: platform.i18n.localize("FILRODENSWMB.UI.ExportArea"),
            onChange: (area, { final }) => this.#onAreaChange(area, final),
        });
        this.#control.ratio = ExportArea.ratio(this.#aspect, this.#source.map);
        parts.rec.style.left = `${this.#position(this.#recommend.scale) * 100}%`;

        for (const button of parts.presets) button.addEventListener("click", () => this.#choosePreset(button.dataset.exportPreset));
        parts.aspect.addEventListener("change", () => this.#chooseAspect(parts.aspect.value));
        parts.track.addEventListener("pointerdown", this.#onTrackDown);
        parts.track.addEventListener("keydown", this.#onTrackKey);
        parts.scaleField.addEventListener("change", () => this.#setScale(this.#typedScale(parts.scaleField.value)));
        parts.scaleField.addEventListener("keydown", (event) => {
            if (event.key !== "Enter") return;
            // Enter takes the number typed, rather than exporting
            event.preventDefault();
            event.stopPropagation();
            parts.scaleField.dispatchEvent(new Event("change"));
        });
        parts.cut.addEventListener("click", () => this.#cut());
        parts.fitScale.addEventListener("click", () => this.#useFit("scale"));
        parts.fitArea.addEventListener("click", () => this.#useFit("area"));
        for (const row of parts.formatRows) row.addEventListener("click", () => this.#chooseFormat(row.dataset.exportFormat));
        parts.formatRows[0]?.parentElement.addEventListener("keydown", this.#onFormatKey);
        parts.fileName?.addEventListener("input", () => {
            this.#typedName = parts.fileName.value.trim() || null;
        });
        parts.stop.addEventListener("click", () => this.#drawing?.abort());
        parts.sceneName?.addEventListener("input", () => {
            clearTimeout(this.#nameTimer);
            this.#nameTimer = setTimeout(() => this.#lookForScene(), NAME_WAIT_MS);
        });
        parts.sceneName?.addEventListener("keydown", (event) => {
            // Enter in the name exports, once the name has been looked for
            if (event.key === "Enter") this.#lookForScene();
        });
        parts.useMade?.addEventListener("click", () => this.#useMade());
        for (const button of parts.kinds) button.addEventListener("click", () => this.#chooseKind(button.dataset.exportKind));
        parts.kinds[0]?.parentElement.addEventListener("keydown", this.#onKindKey);
        for (const box of parts.options) {
            box.addEventListener("change", () => {
                this.#options[box.dataset.exportOption] = box.checked;
                this.#update({ estimate: true });
            });
        }

        // Two columns while the studio has room, one below that; the preview shorter on a short studio
        const host = element.parentElement;
        if (host && typeof ResizeObserver === "function") {
            this.#resize = new ResizeObserver(() => this.#fit(host));
            this.#resize.observe(host);
        }
        if (host) this.#fit(host);
        this.#update({ estimate: true });
    }

    #fit(host) {
        const element = this.#parts.element;
        element.classList.toggle("fwmb-export--one-column", host.clientWidth < ONE_COLUMN_BELOW);
        element.classList.toggle("fwmb-export--short", host.clientHeight < SHORT_BELOW);
    }

    /** A square grid's lines over the preview while the area snaps to it (board X4). */
    #showGrid() {
        if (!this.#snaps || this.#source.grid.type !== "square") return;
        const { map, grid } = this.#source;
        const lines = this.#parts.element.ownerDocument.createElement("span");
        lines.className = "fwmb-export-grid";
        lines.style.setProperty("--cell-x", `${(grid.size / map.width) * 100}%`);
        lines.style.setProperty("--cell-y", `${(grid.size / map.height) * 100}%`);
        this.#parts.preview.append(lines);
    }

    /** The dashed outline of the area as drawn, beside the snapped one, until the area next changes. */
    #showDrawn(area) {
        this.#drawnOutline?.remove();
        this.#drawnOutline = null;
        if (!area) return;
        const map = this.#source.map;
        const outline = this.#parts.element.ownerDocument.createElement("span");
        outline.className = "fwmb-crop-drawn";
        Object.assign(outline.style, {
            left: `${(area.x / map.width) * 100}%`,
            top: `${(area.y / map.height) * 100}%`,
            width: `${(area.width / map.width) * 100}%`,
            height: `${(area.height / map.height) * 100}%`,
        });
        this.#parts.preview.append(outline);
        this.#drawnOutline = outline;
    }

    // ------------------------------------------------------------------ choices

    #onAreaChange(area, final) {
        this.#preset = "drawn";
        if (!final) {
            // While it is dragged the area follows the pointer; it snaps when let go
            this.#area = area;
            this.#showDrawn(null);
            this.#update();
            return;
        }
        this.#setArea(area);
        this.#showDrawn(this.#snaps ? area : null);
        this.#update({ estimate: true });
    }

    #choosePreset(preset) {
        if (this.#drawing) return;
        this.#preset = preset;
        this.#lastPreset = preset;
        this.#setArea(this.#presetArea(preset));
        this.#showDrawn(null);
        this.#update({ estimate: true });
    }

    #chooseAspect(aspect) {
        this.#aspect = aspect;
        const ratio = ExportArea.ratio(aspect, this.#source.map);
        this.#control.ratio = ratio;
        // A preset is reshaped from its own area; a drawn one about its centre
        this.#setArea(this.#preset === "drawn" ? ExportArea.withAspect(this.#area, ratio, this.#source.map) : this.#presetArea(this.#preset));
        this.#showDrawn(null);
        this.#update({ estimate: true });
    }

    #setScale(value, { estimate = true } = {}) {
        if (this.#drawing) return;
        // A number that cannot be read leaves the scale as it was (and the field shows it again)
        if (Number.isFinite(value)) this.#scale = this.#sceneScale(value);
        this.#update({ estimate });
    }

    #chooseFormat(id) {
        if (this.#drawing || !this.#formats.some((format) => format.id === id)) return;
        this.#format = id;
        this.#update();
    }

    #useFit(which) {
        const plan = this.#plan();
        if (which === "scale" && plan.fitScale) this.#scale = this.#sceneScale(plan.fitScale, { fit: true });
        if (which === "area" && plan.fitArea) {
            this.#preset = "drawn";
            this.#setArea(plan.fitArea, { fit: true });
            this.#showDrawn(null);
        }
        this.#update({ estimate: true });
    }

    /** The steer's Go: closes the dialogue and opens Cut regional world… on the area. */
    #cut() {
        if (this.#drawing || this.#source.cutOff?.()) return;
        const area = { ...this.#area };
        this.#overlay.close(false);
        this.#source.cut?.(area);
    }

    /** Looks for a scene of the name given, made by an earlier export (see the warning). */
    async #lookForScene() {
        const name = this.#sceneNameChosen();
        let previous = null;
        try {
            previous = (await this.#source.previous?.(name)) ?? null;
        } catch (error) {
            console.warn("FWMB | The scene's earlier export could not be read:", error);
        }
        if (name !== this.#sceneNameChosen()) return;
        this.#previous = previous;
        this.#update();
    }

    #sceneNameChosen() {
        return this.#parts.sceneName?.value.trim() || this.#source.sceneName || "";
    }

    /** The warning's Use the scene's area and scale. */
    #useMade() {
        const made = this.#previous;
        if (!made || this.#drawing) return;
        this.#preset = "drawn";
        this.#setArea(made);
        this.#scale = this.#sceneScale(made.scale);
        this.#showDrawn(null);
        this.#update({ estimate: true });
    }

    // ------------------------------------------------------------------ the slider

    /** Where a scale sits along the slider, 0 to 1: by its square root, so the low scales have room. */
    #position(scale) {
        const { MIN } = FILRODENSWMB.EXPORT_PNG.SCALE;
        const low = Math.sqrt(MIN);
        return Math.min(Math.max((Math.sqrt(scale) - low) / (Math.sqrt(this.#source.ceiling) - low), 0), 1);
    }

    #fromPosition(position) {
        const { MIN } = FILRODENSWMB.EXPORT_PNG.SCALE;
        const low = Math.sqrt(MIN);
        const root = low + Math.min(Math.max(position, 0), 1) * (Math.sqrt(this.#source.ceiling) - low);
        return root * root;
    }

    #onTrackDown = (event) => {
        if (event.button !== 0 || this.#drawing) return;
        event.preventDefault();
        const track = this.#parts.track;
        track.focus({ preventScroll: true });
        const box = track.getBoundingClientRect();
        const rtl = getComputedStyle(track).direction === "rtl";
        const at = (pointer) => {
            const share = (pointer.clientX - box.left) / Math.max(box.width, 1);
            return this.#fromPosition(rtl ? 1 - share : share);
        };
        this.#setScale(at(event), { estimate: false });
        const move = (pointer) => this.#setScale(at(pointer), { estimate: false });
        const up = () => {
            track.removeEventListener("pointermove", move);
            track.removeEventListener("pointerup", up);
            track.removeEventListener("pointercancel", up);
            this.#update({ estimate: true });
        };
        track.setPointerCapture?.(event.pointerId);
        track.addEventListener("pointermove", move);
        track.addEventListener("pointerup", up);
        track.addEventListener("pointercancel", up);
    };

    #onTrackKey = (event) => {
        const { STOPS, MIN } = FILRODENSWMB.EXPORT_PNG.SCALE;
        const ceiling = this.#source.ceiling;
        const stops = this.#source.stops ? this.#source.stops.filter((each) => !each.minor).map((each) => each.stop) : STOPS.filter((stop) => stop <= ceiling);
        let next = null;
        if (event.key === "ArrowRight" || event.key === "ArrowUp") next = this.#nextStep(1);
        else if (event.key === "ArrowLeft" || event.key === "ArrowDown") next = this.#nextStep(-1);
        else if (event.key === "PageUp") next = stops.find((stop) => stop > this.#scale + 1e-9) ?? ceiling;
        else if (event.key === "PageDown") next = [...stops].reverse().find((stop) => stop < this.#scale - 1e-9) ?? MIN;
        else if (event.key === "Home") next = MIN;
        else if (event.key === "End") next = ceiling;
        if (next === null) return;
        event.preventDefault();
        event.stopPropagation();
        this.#setScale(next);
    };

    /** The next scale along the slider that differs from this one (a scene's whole cells may need more than one step). */
    #nextStep(direction) {
        const { STEP, MIN } = FILRODENSWMB.EXPORT_PNG.SCALE;
        for (let value = this.#scale + direction * STEP; value >= MIN - 1e-9 && value <= this.#source.ceiling + 1e-9; value += direction * STEP) {
            if (Math.abs(this.#sceneScale(value) - this.#scale) > 1e-9) return value;
        }
        return this.#scale;
    }

    #onFormatKey = (event) => {
        const rows = this.#parts.formatRows;
        const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
        if (!step || this.#drawing) return;
        event.preventDefault();
        event.stopPropagation();
        const index = rows.findIndex((row) => row.dataset.exportFormat === this.#format);
        const next = rows[(index + step + rows.length) % rows.length];
        this.#chooseFormat(next.dataset.exportFormat);
        next.focus();
    };

    // ------------------------------------------------------------------ drawing the parts

    #plan() {
        return ExportArea.plan(this.#source.map, this.#area, this.#scale, { maxSide: this.#scene ? (this.#source.maxSide ?? Infinity) : Infinity, sheet: this.#kind?.sheet ?? null });
    }

    /** The What row's arrow keys: the next or previous kind that is on. */
    #onKindKey = (event) => {
        const kinds = (this.#source.kinds ?? []).filter((kind) => !kind.off);
        const at = kinds.findIndex((kind) => kind.id === this.#kindId);
        const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
        if (!step || at < 0) return;
        event.preventDefault();
        const next = kinds[(at + step + kinds.length) % kinds.length];
        this.#chooseKind(next.id);
        this.#parts.kinds.find((button) => button.dataset.exportKind === next.id)?.focus();
    };

    #km(px) {
        return formatDistance(px * this.#source.kmPerPx);
    }

    /** An area's size on the ground: "1.6 × 1.2 km" (in the map type's own units where it gives them). */
    #ground(width, height) {
        const own = this.#source.measure?.lengths(width, height);
        const values = own ?? { width: this.#km(width), height: this.#km(height), unit: this.#source.unit };
        return platform.i18n.format("FILRODENSWMB.UI.ExportAreaGround", values);
    }

    #scaleText(scale = this.#scale) {
        return this.#source.scaleName?.(scale) ?? `${scale.toLocaleString(undefined, { maximumFractionDigits: 2 })}×`;
    }

    /** The scale typed: a number ("2", "1,5×"), or the name of one (Finest). NaN when neither. */
    #typedScale(text) {
        const typed = String(text).trim();
        const named = this.#source.stops?.find((each) => each.label && each.label.toLowerCase() === typed.toLowerCase());
        if (named) return named.stop;
        return parseFloat(typed.replace(",", "."));
    }

    /** The scene's cell at the scale, in its pixels (null on a gridless map). */
    #cell() {
        return this.#snaps ? Math.round(this.#source.grid.size * this.#scale) : null;
    }

    #update({ estimate = false } = {}) {
        const parts = this.#parts;
        if (!parts.element?.isConnected) return;
        const { i18n } = platform;
        const source = this.#source;
        const number = (value) => value.toLocaleString();
        const plan = this.#plan();
        const scale = this.#scale;
        const scaleText = this.#scaleText();
        const cell = this.#cell();

        // What
        for (const button of parts.kinds) {
            const chosen = button.dataset.exportKind === this.#kindId;
            button.setAttribute("aria-checked", String(chosen));
            button.tabIndex = chosen ? 0 : -1;
        }
        this.#showSheet(plan);

        // The Area
        for (const button of parts.presets) button.setAttribute("aria-pressed", String(button.dataset.exportPreset === this.#preset));
        parts.drawn.hidden = this.#preset !== "drawn";
        const ground = this.#ground(this.#area.width, this.#area.height);
        if (this.#snaps) {
            parts.areaRead.textContent = i18n.format("FILRODENSWMB.UI.ExportAreaMapPixels", { width: number(Math.round(this.#area.width)), height: number(Math.round(this.#area.height)) });
            this.#control.setLabel(this.#cells ? i18n.format("FILRODENSWMB.UI.ExportSnappedCells", { across: this.#cells.across, down: this.#cells.down }) : ground);
        } else {
            parts.areaRead.textContent = this.#preset === "drawn" ? ground : i18n.format("FILRODENSWMB.UI.ExportAreaPresetGround", { preset: this.#presetLabel(this.#preset), ground });
            this.#control.setLabel(ground);
        }
        this.#control.setOver(!plan.fits);
        if (parts.pages) parts.pages.textContent = this.#pagesText();

        // Scale
        const position = this.#position(scale);
        parts.track.style.setProperty("--pos", `${position * 100}%`);
        parts.track.setAttribute("aria-valuenow", String(scale));
        const groundPx = i18n.format("FILRODENSWMB.UI.ExportGroundPixel", source.measure?.pixel(scale) ?? { distance: formatDistance(source.kmPerPx / scale), unit: source.unit });
        const groundLine = cell ? i18n.format("FILRODENSWMB.UI.ExportGroundCells", { ground: groundPx, cell }) : groundPx;
        parts.track.setAttribute("aria-valuetext", `${scaleText}, ${groundLine}`);
        if (parts.element.ownerDocument.activeElement !== parts.scaleField) parts.scaleField.value = scaleText;
        parts.scaleRead.textContent = scaleText;
        parts.ground.textContent = groundLine;
        parts.reason.textContent = this.#reasonText();
        const floor = this.#snaps ? SceneArea.scale(1, source.grid, source.minCell ?? FILRODENSWMB.LIMITS.MIN_GRID_SIZE).floor : 0;
        parts.floor.hidden = !(floor > FILRODENSWMB.EXPORT_PNG.SCALE.MIN);
        if (!parts.floor.hidden) parts.floor.textContent = i18n.format("FILRODENSWMB.UI.ExportSceneFloor", { cell: source.minCell ?? FILRODENSWMB.LIMITS.MIN_GRID_SIZE, scale: this.#scaleText(floor) });
        const atCeiling = source.rasterPx > 0 && scale >= source.ceiling - 1e-9;
        parts.terrain.hidden = !(source.rasterPx > 0 && scale > 1 && !atCeiling);
        if (!parts.terrain.hidden) parts.terrain.textContent = i18n.format("FILRODENSWMB.UI.ExportTerrainLine", { scale: scaleText, px: number(source.rasterPx) });
        parts.steer.hidden = !(atCeiling && source.cut);
        if (parts.note) parts.note.hidden = !source.scaleNote;
        if (!parts.steer.hidden) {
            const off = source.cutOff?.() ?? null;
            parts.cut.setAttribute("aria-disabled", String(!!off));
            if (off) parts.cut.dataset.tooltip = off;
            else delete parts.cut.dataset.tooltip;
        }

        // The image, or Too large
        parts.result.hidden = !plan.fits;
        parts.tooLarge.hidden = plan.fits;
        const sizeText = i18n.format("FILRODENSWMB.UI.ExportPixels", { width: number(plan.width), height: number(plan.height) });
        if (plan.fits) {
            parts.size.textContent = sizeText;
            const what = this.#whatText(scaleText, cell);
            // A sheet's line names its map part too: "map part 3,440 × 2,580, of the town view at 2×"
            parts.what.textContent = this.#kind?.sheet ? i18n.format("FILRODENSWMB.UI.ExportSheetPart", { size: i18n.format("FILRODENSWMB.UI.ExportPixels", { width: number(plan.part.width), height: number(plan.part.height) }), what }) : what;
        } else {
            this.#tooLarge(plan, scaleText, sizeText);
        }

        // Formats, with their estimates
        const sizes = this.#estimates.get(this.#estimateKey());
        for (const row of parts.formatRows) {
            const chosen = row.dataset.exportFormat === this.#format;
            row.setAttribute("aria-checked", String(chosen));
            row.tabIndex = chosen ? 0 : -1;
            row.setAttribute("aria-disabled", String(!plan.fits));
            const size = row.querySelector(".fwmb-format-size");
            if (!plan.fits) size.textContent = i18n.localize("FILRODENSWMB.UI.ExportTooLargeShort");
            else if (sizes) size.textContent = i18n.format("FILRODENSWMB.UI.ExportAbout", { size: ImageFormat.sizeText(sizes[row.dataset.exportFormat] ?? 0) });
            else size.textContent = i18n.localize("FILRODENSWMB.UI.ExportEstimating");
        }

        // File name (an image's), and the warning (a scene's)
        if (parts.fileName) {
            if (this.#typedName === null) parts.fileName.value = this.#fileName();
            parts.ext.textContent = `.${ImageFormat.byId(this.#format).extension}`;
        }
        if (parts.warn) {
            const differs = !!this.#previous && !SceneArea.same(this.#previous, { ...this.#area, scale });
            parts.warn.hidden = !differs;
            if (differs) parts.warnText.innerHTML = this.#warnText();
        }

        // The footer: how many tiles, and Export only while the choice fits
        if (!this.#drawing) {
            const tiles = ExportScale.tiles(plan.part.width, plan.part.height, source.tileLimit).length;
            this.#overlay?.setFooterStart(plan.fits && tiles > 1 ? i18n.format("FILRODENSWMB.UI.ExportTiles", { count: tiles }) : "");
            const exportButton = this.#overlay?.button("export");
            if (exportButton) exportButton.disabled = !plan.fits;
        }

        if (estimate && plan.fits) this.#scheduleEstimate();
    }

    /**
     * The sheet (a report's, board X3b): its layout drawn small, the map part the area as the
     * preview shows it, beside its side (or below it), the two in the widths the sheet gives them.
     * Hidden for a kind with no sheet.
     */
    #showSheet(plan) {
        const parts = this.#parts;
        if (!parts.sheet) return;
        const sheet = this.#kind?.sheet;
        parts.sheet.hidden = !sheet;
        if (!sheet) return;
        const layout = sheet(plan.part);
        parts.sheetBox.classList.toggle("fwmb-report-sheet--below", !!layout.below);
        // The side's width in proportion to the map part's, as on the sheet
        if (!layout.below && layout.side > 0) parts.sheetBox.style.gridTemplateColumns = `minmax(0, ${plan.part.width}fr) minmax(4rem, ${layout.side}fr)`;
        else parts.sheetBox.style.removeProperty("grid-template-columns");
        parts.sheetMap.style.setProperty("--ar", String(plan.part.width / plan.part.height));
        const picture = parts.preview.querySelector("canvas");
        const canvas = parts.sheetMap.querySelector("canvas");
        if (!picture || !canvas) return;
        const map = this.#source.map;
        const sx = picture.width / map.width;
        const sy = picture.height / map.height;
        const width = Math.max(1, Math.round(this.#area.width * sx));
        const height = Math.max(1, Math.round(this.#area.height * sy));
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d")?.drawImage(picture, this.#area.x * sx, this.#area.y * sy, this.#area.width * sx, this.#area.height * sy, 0, 0, width, height);
    }

    #whatText(scaleText, cell) {
        const { i18n } = platform;
        if (this.#scene && cell && this.#cells) return i18n.format("FILRODENSWMB.UI.ExportSceneCells", { across: this.#cells.across, down: this.#cells.down, cell });
        const own = this.#source.presets?.find((preset) => preset.id === this.#preset)?.what;
        const key = own ?? (this.#preset === "whole" ? "FILRODENSWMB.UI.ExportOfTheMap" : this.#preset === "screen" ? "FILRODENSWMB.UI.ExportOfTheView" : "FILRODENSWMB.UI.ExportOfTheArea");
        return i18n.format(key, { scale: scaleText });
    }

    #tooLarge(plan, scaleText, sizeText) {
        const { i18n } = platform;
        const parts = this.#parts;
        const source = this.#source;
        const number = (value) => value.toLocaleString();
        const { MAX_SIDE, MAX_PIXELS } = FILRODENSWMB.EXPORT_PNG;
        const side = this.#scene ? Math.min(MAX_SIDE, source.maxSide ?? MAX_SIDE) : MAX_SIDE;
        const key = this.#scene && side < MAX_SIDE ? "FILRODENSWMB.UI.ExportTooLargeSceneLine" : "FILRODENSWMB.UI.ExportTooLargeLine";
        parts.limit.innerHTML = i18n.format(key, { scale: `<b>${scaleText}</b>`, size: `<b>${sizeText}</b>`, side: number(side), pixels: number(MAX_PIXELS / 1e6) });
        const fitScale = plan.fitScale ? this.#sceneScale(plan.fitScale, { fit: true }) : null;
        this.#fitButton(parts.fitScale, fitScale, () => {
            const size = ExportArea.size(this.#area, fitScale);
            return [i18n.format("FILRODENSWMB.UI.ExportFitScale", { scale: this.#scaleText(fitScale) }), i18n.format("FILRODENSWMB.UI.ExportFitScaleLine", { size: i18n.format("FILRODENSWMB.UI.ExportPixels", { width: number(size.width), height: number(size.height) }) })];
        });
        this.#fitButton(parts.fitArea, plan.fitArea, () => [
            i18n.localize("FILRODENSWMB.UI.ExportFitArea"),
            i18n.format("FILRODENSWMB.UI.ExportFitAreaLine", { ground: this.#ground(plan.fitArea.width, plan.fitArea.height), scale: scaleText }),
        ]);
    }

    #fitButton(button, fit, text) {
        button.hidden = !fit;
        if (!fit) return;
        const [lead, line] = text();
        button.querySelector(".fwmb-fit-text b").textContent = lead;
        button.querySelector(".fwmb-fit-text span").textContent = line;
    }

    #reasonText() {
        const { i18n } = platform;
        if (this.#source.recommended) return this.#source.recommended.reason;
        const reason = this.#recommend;
        const px = (value) => Math.round(value);
        const scale = `${reason.scale}×`;
        if (reason.kind === "none") return i18n.format("FILRODENSWMB.UI.ExportReasonNone", { scale });
        if (reason.kind === "enough") return i18n.format("FILRODENSWMB.UI.ExportReasonEnough", { scale, px: px(reason.px) });
        if (reason.kind === "reaches") return i18n.format("FILRODENSWMB.UI.ExportReasonReaches", { scale, px: px(reason.px), scaledPx: px(reason.scaledPx) });
        return i18n.format("FILRODENSWMB.UI.ExportReasonShort", { scale, px: px(reason.px), scaledPx: px(reason.scaledPx) });
    }

    /** Generate journals, with how many pages the area gives. */
    #pagesText() {
        const { i18n } = platform;
        const count = this.#source.pageCount?.(this.#area);
        return Number.isFinite(count) ? i18n.format(count === 1 ? "FILRODENSWMB.UI.ExportScenePage" : "FILRODENSWMB.UI.ExportScenePages", { count }) : i18n.localize("FILRODENSWMB.UI.GenerateJournals");
    }

    /** The warning's text: what the scene was made with (escaped), and what a different choice leaves. */
    #warnText() {
        const { i18n, utils } = platform;
        const made = this.#previous;
        const name = `<b>${utils.escapeHtml(this.#sceneNameChosen())}</b>`;
        const whole = SceneArea.same({ ...made, scale: 1 }, { ...SceneArea.snap({ x: 0, y: 0, ...this.#source.map }, this.#source.grid ?? {}, this.#source.map).area, scale: 1 });
        const scale = this.#scaleText(Number(made.scale));
        const first = whole ? i18n.format("FILRODENSWMB.UI.ExportSceneWarnWhole", { name, scale }) : i18n.format("FILRODENSWMB.UI.ExportSceneWarnArea", { name, scale, width: Math.round(made.width).toLocaleString(), height: Math.round(made.height).toLocaleString() });
        return `${first} ${i18n.localize("FILRODENSWMB.UI.ExportSceneWarnLine")}`;
    }

    #fileName() {
        if (this.#source.fileName) return this.#source.fileName({ preset: this.#preset, scale: this.#scale, kind: this.#kindId, options: { ...this.#options } });
        return ExportArea.fileName({ name: this.#source.name, preset: this.#preset, scale: this.#scale });
    }

    // ------------------------------------------------------------------ the estimates

    #estimateKey() {
        const { x, y, width, height } = this.#area;
        return `${x},${y},${width},${height}@${this.#scale}:${this.#kindId ?? ""}:${JSON.stringify(this.#options)}`;
    }

    #scheduleEstimate() {
        clearTimeout(this.#estimateTimer);
        const key = this.#estimateKey();
        if (this.#estimates.has(key)) return;
        const area = { ...this.#area };
        const scale = this.#scale;
        const choice = this.#choice();
        this.#estimateTimer = setTimeout(async () => {
            if (!this.#parts.element?.isConnected || this.#drawing) return;
            try {
                const { tiles, pixels } = await this.#source.samples(area, scale, choice);
                if (!this.#parts.element?.isConnected) return;
                this.#estimates.set(key, await ImageFormat.estimate(tiles, pixels, this.#formats.map((format) => format.id)));
            } catch (error) {
                console.warn("FWMB | Export size estimate failed", error);
                return;
            }
            if (key === this.#estimateKey()) this.#update();
        }, ESTIMATE_WAIT_MS);
    }

    // ------------------------------------------------------------------ export

    /** Export: the image drawn in tiles with its progress, then saved (or the scene made); the dialogue closes when done. */
    #export() {
        const plan = this.#plan();
        if (!plan.fits || this.#drawing) return;
        this.#running = this.#run(plan);
    }

    async #run(plan) {
        const { i18n } = platform;
        const parts = this.#parts;
        const source = this.#source;
        const area = { ...this.#area };
        const scale = this.#scale;
        const format = this.#format;
        const fileName = this.#scene ? null : (this.#typedName ?? this.#fileName()).replace(/[\\/:*?"<>|]+/g, "_");
        const tiles = ExportScale.tiles(plan.part.width, plan.part.height, source.tileLimit);
        const drawn = this.#choice();
        const formatLabel = this.#formats.find((each) => each.id === format)?.label ?? format;
        const choice = this.#scene ? this.#sceneChoice(area, scale, format) : null;
        const drawing = new AbortController();
        this.#drawing = drawing;
        clearTimeout(this.#estimateTimer);
        const marks = this.#showTiles(area, tiles);
        this.#setDrawing(true, tiles.length * (choice?.gmOverlay ? 2 : 1));
        parts.then.textContent = i18n.format(tiles.length > 1 ? "FILRODENSWMB.UI.ExportThenJoined" : "FILRODENSWMB.UI.ExportThenSaved", { format: formatLabel });
        const stage = (text) => {
            parts.tile.textContent = text;
            this.#toastLine(text);
        };
        // Tile n of m (a scene drawn twice, the player image then the GM overlay, counts both)
        const progress = (done, total = tiles.length) => {
            const shown = Math.min(done + 1, total);
            stage(i18n.format("FILRODENSWMB.UI.ExportTileOf", { number: shown, count: total }));
            parts.bar.style.setProperty("--p", `${(done / total) * 100}%`);
            // The tiles of the pass being drawn: those before the one now are done
            const at = done % tiles.length;
            marks.forEach((mark, index) => {
                mark.classList.toggle("fwmb-is-done", done >= total || index < at);
                mark.classList.toggle("fwmb-is-now", done < total && index === at);
            });
        };
        source.hold?.(true);
        progress(0);
        let saved = false;
        try {
            if (this.#scene) {
                saved = await source.exportScene(choice, { signal: drawing.signal, onTile: progress, onStage: (key) => stage(i18n.localize(key)) });
            } else {
                const canvas = await source.draw(area, scale, { signal: drawing.signal, onTile: progress, ...drawn });
                if (canvas && !drawing.signal.aborted) {
                    stage(i18n.format("FILRODENSWMB.UI.ExportSaving", { format: formatLabel }));
                    parts.bar.style.setProperty("--p", "100%");
                    const { blob, format: written } = await ImageFormat.encode(canvas, format);
                    if (!drawing.signal.aborted) {
                        ImageFormat.download(blob, `${fileName}.${written.extension}`);
                        platform.notify.info(i18n.format("FILRODENSWMB.UI.ExportSaved", { name: `${fileName}.${written.extension}` }));
                        saved = true;
                    }
                }
            }
        } catch (error) {
            console.error("FWMB | Failed to export:", error);
            platform.notify.error(i18n.localize(this.#scene ? "FILRODENSWMB.UI.ExportSceneFailed" : "FILRODENSWMB.UI.ExportPngFailed"));
        } finally {
            this.#drawing = null;
            marks[0]?.parentElement?.remove();
            source.hold?.(false);
            this.#toast?.remove();
            this.#toast = null;
        }
        if (saved) {
            await this.#remember();
            this.#overlay.close(true);
            return true;
        }
        if (this.#kept) return false;
        this.#setDrawing(false);
        this.#update();
        return false;
    }

    /** What a scene export makes, from the dialogue's fields. */
    #sceneChoice(area, scale, format) {
        const parts = this.#parts;
        return {
            area,
            scale,
            format,
            cell: this.#cell(),
            name: this.#sceneNameChosen() || platform.i18n.localize("FILRODENSWMB.UI.DefaultSceneName"),
            folder: parts.folder?.value?.trim() || this.#source.folder || "fwmb-exports",
            generateJournals: !!parts.journals?.checked,
            overwriteJournals: !!parts.overwrite?.checked,
            gmOverlay: !!parts.overlay?.checked,
        };
    }

    #setDrawing(on, total = 0) {
        const parts = this.#parts;
        const { i18n } = platform;
        parts.element.classList.toggle("fwmb-is-drawing", on);
        parts.progress.hidden = !on;
        this.#control.disabled = on;
        if (parts.areaHint) parts.areaHint.textContent = i18n.localize(on ? "FILRODENSWMB.UI.ExportDrawingHint" : this.#snaps ? "FILRODENSWMB.UI.ExportSceneSnapHint" : "FILRODENSWMB.UI.ExportAreaHint");
        // Board X2b: while it draws, the footer offers only Close and keep drawing (Cancel is in the progress)
        this.#overlay.button("cancel").hidden = on;
        this.#overlay.button("export").hidden = on;
        this.#overlay.button("keep").hidden = !on;
        if (on) {
            this.#overlay.setFooterStart(i18n.format("FILRODENSWMB.UI.ExportDrawingTiles", { count: total }));
            parts.stop.focus();
        } else {
            this.#overlay.button("export").disabled = !this.#plan().fits;
        }
    }

    /**
     * Close and keep drawing: the dialogue goes, the drawing goes on with a toast (its line and
     * Cancel) at the studio's foot, and the studio stays held until it ends.
     */
    #keepDrawing() {
        if (!this.#drawing) return;
        const host = this.#parts.element.parentElement;
        this.#kept = true;
        this.#overlay.close("kept");
        if (!host) return;
        const doc = host.ownerDocument;
        const { i18n } = platform;
        const toast = doc.createElement("div");
        toast.className = "fwmb-toast fwmb-export-toast";
        toast.setAttribute("role", "status");
        toast.dataset.fwmbHoldFree = "";
        const dot = doc.createElement("span");
        dot.className = "fwmb-dot";
        const text = doc.createElement("span");
        text.className = "fwmb-export-toast-text";
        const title = doc.createElement("b");
        title.textContent = this.#source.title;
        const line = doc.createElement("span");
        line.dataset.exportToastLine = "";
        line.textContent = this.#parts.tile.textContent;
        text.append(title, line);
        const cancel = doc.createElement("button");
        cancel.type = "button";
        cancel.className = "fwmb-btn";
        cancel.textContent = i18n.localize("FILRODENSWMB.UI.Cancel");
        cancel.dataset.tooltip = i18n.localize("FILRODENSWMB.UI.ExportStopHint");
        cancel.addEventListener("click", () => this.#drawing?.abort());
        toast.append(dot, text, cancel);
        host.append(toast);
        this.#toast = toast;
    }

    #toastLine(text) {
        const line = this.#toast?.querySelector("[data-export-toast-line]");
        if (line) line.textContent = text;
    }

    /** The tiles over the area on the preview, marked as they are drawn (board X2b). */
    #showTiles(area, tiles) {
        if (tiles.length < 2) return [];
        const map = this.#source.map;
        const doc = this.#parts.element.ownerDocument;
        const grid = doc.createElement("div");
        grid.className = "fwmb-export-tiles";
        const columns = [...new Set(tiles.map((tile) => tile.x))].map((x) => tiles.find((tile) => tile.x === x).width);
        const rows = [...new Set(tiles.map((tile) => tile.y))].map((y) => tiles.find((tile) => tile.y === y).height);
        Object.assign(grid.style, {
            left: `${(area.x / map.width) * 100}%`,
            top: `${(area.y / map.height) * 100}%`,
            width: `${(area.width / map.width) * 100}%`,
            height: `${(area.height / map.height) * 100}%`,
            gridTemplateColumns: columns.map((width) => `${width}fr`).join(" "),
            gridTemplateRows: rows.map((height) => `${height}fr`).join(" "),
        });
        const marks = tiles.map(() => doc.createElement("i"));
        grid.append(...marks);
        this.#parts.preview.append(grid);
        return marks;
    }

    /** The preset, aspect and format, for the next export of this kind (never a drawn area). */
    async #remember() {
        try {
            await ImageFormat.remember(this.#source.kind, this.#format);
            await platform.settings.set(this.#settings.preset, this.#lastPreset);
            await platform.settings.set(this.#settings.aspect, this.#aspect);
            if (this.#source.kindSetting && this.#kindId) await platform.settings.set(this.#source.kindSetting, this.#kindId);
            for (const option of this.#source.options ?? []) await platform.settings.set(option.setting, !!this.#options[option.id]);
        } catch (error) {
            console.warn("FWMB | The export's choices could not be remembered:", error);
        }
    }
}

const PRESET_LABELS = { whole: "FILRODENSWMB.UI.ExportPresetWhole", screen: "FILRODENSWMB.UI.ExportPresetScreen", drawn: "FILRODENSWMB.UI.ExportDrawn" };

const ASPECT_LABELS = {
    free: "FILRODENSWMB.UI.ExportAspectFree",
    map: "FILRODENSWMB.UI.ExportAspectMap",
    "4:3": "FILRODENSWMB.UI.ExportAspect43",
    "16:9": "FILRODENSWMB.UI.ExportAspect169",
    square: "FILRODENSWMB.UI.ExportAspectSquare",
};
