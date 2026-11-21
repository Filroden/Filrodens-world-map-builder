import { FILRODENSWMB } from "../../config.js";
import { platform } from "../../platform/index.js";
import { formatDistance } from "../data/MapUnit.js";
import { AreaControl } from "./AreaControl.js";
import { ExportArea, ExportScale } from "./ExportScale.js";
import { ImageFormat } from "./ImageFormat.js";

const TEMPLATE = "modules/filrodens-world-map-builder/templates/shell/dialogs/export.hbs";

/** How long the estimates wait after the area or scale last changed. */
const ESTIMATE_WAIT_MS = 250;

/** The preview's longest side, in pixels drawn (its CSS size at twice the pixels). */
const PREVIEW_SIDE = 1200;

/** Below these sizes of the studio, the dialogue takes one column, and its preview less height. */
const ONE_COLUMN_BELOW = 900;
const SHORT_BELOW = 760;

/**
 * The export dialogue (S0 step 7; the decision record's §9, DE; boards X1a, X1b, X2a, X2b): one
 * dialogue for every image export. The **Area** (presets, Aspect, the map as it shows now with
 * the area over it, see AreaControl), **Scale** (one slider in steps of 0.05 from 0.25× to the
 * map type's ceiling, the recommendation flagged, the terrain line, and at the ceiling the steer
 * to Cut regional world…), the image's size or **Too large** with its two nearest fits, **Image
 * format and quality** with each format's size estimated from sample tiles inside the area, and
 * **File name**. Export draws the image in tiles, one a frame, with its progress and Cancel in the
 * dialogue, then saves it and closes. The preset, aspect and format are remembered for each kind
 * of export; a drawn area never is.
 *
 * The studio hands it a **source**: what it needs of the map, and how to draw it.
 *
 * @typedef {object} ExportSource
 * @property {"png"} kind - The kind of export, whose choices are remembered.
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
 * @property {(side: number) => HTMLCanvasElement|null} drawPreview - The map as it shows now, its longest side `side`.
 * @property {(area: object, scale: number) => {tiles: HTMLCanvasElement[], pixels: number}} samples
 * @property {(area: object, scale: number, options: {onTile: Function, signal: AbortSignal}) => Promise<HTMLCanvasElement|null>} draw
 * @property {(() => string|null)} [cutOff] - Why a regional world cannot be cut (null when it can).
 * @property {((area: object) => void)} [cut] - Opens Cut regional world… on the area.
 */
export class ExportDialog {
    /**
     * Opens the dialogue. Resolves once it has closed: true when the image was saved.
     * @param {ExportSource} source
     * @returns {Promise<boolean>}
     */
    static async open(source) {
        const dialog = new ExportDialog(source);
        return dialog.#open();
    }

    #source;
    #overlay = null;
    #parts = {};
    #control = null;
    #formats = [];
    #area;
    #preset;
    #lastPreset;
    #aspect;
    #scale;
    #recommend;
    #format;
    #typedName = null;
    #estimates = new Map();
    #estimateTimer = null;
    #drawing = null;
    #resize = null;

    constructor(source) {
        this.#source = source;
    }

    async #open() {
        const { i18n } = platform;
        const source = this.#source;
        const { PRESETS, ASPECTS, SCALE, SETTINGS } = FILRODENSWMB.EXPORT_PNG;
        const available = await ImageFormat.available();
        this.#formats = available.map((id) => ({ id, label: i18n.localize(ImageFormat.byId(id).label) }));
        this.#format = ImageFormat.remembered(source.kind, available);
        this.#preset = this.#setting(SETTINGS.PRESET_PNG, PRESETS);
        this.#lastPreset = this.#preset;
        this.#aspect = this.#setting(SETTINGS.ASPECT_PNG, ASPECTS.map((aspect) => aspect.id));
        this.#area = this.#presetArea(this.#preset);
        this.#recommend = ExportArea.recommend(source.smallestLabelPx, source.ceiling);
        this.#scale = this.#recommend.scale;

        const stops = [...SCALE.STOPS.filter((stop) => stop <= source.ceiling).map((stop) => ({ stop, minor: false })), ...SCALE.MINOR.map((stop) => ({ stop, minor: true }))];
        const content = await platform.templates.render(TEMPLATE, {
            presets: PRESETS.map((id) => ({ id, label: i18n.localize(PRESET_LABELS[id]) })),
            aspects: ASPECTS.map(({ id }) => ({ id, label: i18n.localize(ASPECT_LABELS[id]) })),
            ratio: source.map.width / source.map.height,
            min: SCALE.MIN,
            ceiling: source.ceiling,
            stops: stops.map(({ stop, minor }) => ({ minor, pos: this.#position(stop) * 100, label: `${stop}×` })),
            formats: this.#formats,
        });

        this.#overlay = platform.dialogs.show({
            title: source.title,
            content,
            classes: ["fwmb", "fwmb-export"],
            footer: "split",
            dismissed: false,
            buttons: [
                { action: "cancel", label: i18n.localize("FILRODENSWMB.UI.Cancel"), start: true, callback: () => false },
                { action: "export", label: i18n.localize("FILRODENSWMB.UI.ExportPNG"), icon: "fwmb-icon fwmb-icon--png", default: true, stays: true, callback: () => this.#export() },
            ],
            onRender: (element) => this.#bind(element),
        });
        // The footer is drawn with the dialogue: its start line and Export follow the choice now
        this.#update();
        const saved = await this.#overlay.closed;
        this.#drawing?.abort();
        clearTimeout(this.#estimateTimer);
        this.#resize?.disconnect();
        this.#control?.destroy();
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

    #presetArea(preset) {
        const { map, view } = this.#source;
        const area = ExportArea.preset(preset, map, view);
        return ExportArea.withAspect(area, ExportArea.ratio(this.#aspect, map), map);
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
            terrain: find("[data-export-terrain]"),
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
        };
        const parts = this.#parts;
        parts.aspect.value = this.#aspect;

        // The map as it shows now, once
        try {
            const picture = this.#source.drawPreview(PREVIEW_SIDE);
            if (picture) parts.preview.prepend(picture);
        } catch (error) {
            console.warn("FWMB | The export's preview could not be drawn:", error);
        }
        this.#control = new AreaControl(parts.preview, {
            map: this.#source.map,
            area: this.#area,
            label: platform.i18n.localize("FILRODENSWMB.UI.ExportArea"),
            onChange: (area, { final }) => {
                this.#area = area;
                this.#preset = "drawn";
                this.#update({ estimate: final });
            },
        });
        this.#control.ratio = ExportArea.ratio(this.#aspect, this.#source.map);
        parts.rec.style.left = `${this.#position(this.#recommend.scale) * 100}%`;

        for (const button of parts.presets) button.addEventListener("click", () => this.#choosePreset(button.dataset.exportPreset));
        parts.aspect.addEventListener("change", () => this.#chooseAspect(parts.aspect.value));
        parts.track.addEventListener("pointerdown", this.#onTrackDown);
        parts.track.addEventListener("keydown", this.#onTrackKey);
        parts.scaleField.addEventListener("change", () => this.#setScale(parseFloat(parts.scaleField.value.replace(",", "."))));
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
        parts.fileName.addEventListener("input", () => {
            this.#typedName = parts.fileName.value.trim() || null;
        });
        parts.stop.addEventListener("click", () => this.#drawing?.abort());

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

    // ------------------------------------------------------------------ choices

    #choosePreset(preset) {
        if (this.#drawing) return;
        this.#preset = preset;
        this.#lastPreset = preset;
        this.#area = this.#presetArea(preset);
        this.#control.area = this.#area;
        this.#update({ estimate: true });
    }

    #chooseAspect(aspect) {
        this.#aspect = aspect;
        const ratio = ExportArea.ratio(aspect, this.#source.map);
        this.#control.ratio = ratio;
        // A preset is reshaped from its own area; a drawn one about its centre
        this.#area = this.#preset === "drawn" ? ExportArea.withAspect(this.#area, ratio, this.#source.map) : this.#presetArea(this.#preset);
        this.#control.area = this.#area;
        this.#update({ estimate: true });
    }

    #setScale(value, { estimate = true } = {}) {
        if (this.#drawing) return;
        // A number that cannot be read leaves the scale as it was (and the field shows it again)
        if (Number.isFinite(value)) this.#scale = ExportArea.snapScale(value, this.#source.ceiling);
        this.#update({ estimate });
    }

    #chooseFormat(id) {
        if (this.#drawing || !this.#formats.some((format) => format.id === id)) return;
        this.#format = id;
        this.#update();
    }

    #useFit(which) {
        const plan = this.#plan();
        if (which === "scale" && plan.fitScale) this.#scale = plan.fitScale;
        if (which === "area" && plan.fitArea) {
            this.#area = plan.fitArea;
            this.#preset = "drawn";
            this.#control.area = this.#area;
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

    // ------------------------------------------------------------------ the slider

    /** Where a scale sits along the slider, 0 to 1: by its square root, so the low scales have room. */
    #position(scale) {
        const { MIN } = FILRODENSWMB.EXPORT_PNG.SCALE;
        const low = Math.sqrt(MIN);
        return (Math.sqrt(scale) - low) / (Math.sqrt(this.#source.ceiling) - low);
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
        const { STEP, STOPS, MIN } = FILRODENSWMB.EXPORT_PNG.SCALE;
        const ceiling = this.#source.ceiling;
        const stops = STOPS.filter((stop) => stop <= ceiling);
        let next = null;
        if (event.key === "ArrowRight" || event.key === "ArrowUp") next = this.#scale + STEP;
        else if (event.key === "ArrowLeft" || event.key === "ArrowDown") next = this.#scale - STEP;
        else if (event.key === "PageUp") next = stops.find((stop) => stop > this.#scale + 1e-9) ?? ceiling;
        else if (event.key === "PageDown") next = [...stops].reverse().find((stop) => stop < this.#scale - 1e-9) ?? MIN;
        else if (event.key === "Home") next = MIN;
        else if (event.key === "End") next = ceiling;
        if (next === null) return;
        event.preventDefault();
        event.stopPropagation();
        this.#setScale(next);
    };

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
        return ExportArea.plan(this.#source.map, this.#area, this.#scale);
    }

    #km(px) {
        return formatDistance(px * this.#source.kmPerPx);
    }

    #update({ estimate = false } = {}) {
        const parts = this.#parts;
        if (!parts.element?.isConnected) return;
        const { i18n } = platform;
        const source = this.#source;
        const number = (value) => value.toLocaleString();
        const plan = this.#plan();
        const scale = this.#scale;
        const scaleText = `${scale.toLocaleString(undefined, { maximumFractionDigits: 2 })}×`;

        // The Area
        for (const button of parts.presets) button.setAttribute("aria-pressed", String(button.dataset.exportPreset === this.#preset));
        parts.drawn.hidden = this.#preset !== "drawn";
        const ground = i18n.format("FILRODENSWMB.UI.ExportAreaGround", { width: this.#km(this.#area.width), height: this.#km(this.#area.height), unit: source.unit });
        parts.areaRead.textContent = this.#preset === "drawn" ? ground : i18n.format("FILRODENSWMB.UI.ExportAreaPresetGround", { preset: i18n.localize(PRESET_LABELS[this.#preset]), ground });
        this.#control.setLabel(ground);
        this.#control.setOver(!plan.fits);

        // Scale
        const position = this.#position(scale);
        parts.track.style.setProperty("--pos", `${position * 100}%`);
        parts.track.setAttribute("aria-valuenow", String(scale));
        const groundPx = i18n.format("FILRODENSWMB.UI.ExportGroundPixel", { distance: formatDistance(source.kmPerPx / scale), unit: source.unit });
        parts.track.setAttribute("aria-valuetext", `${scaleText}, ${groundPx}`);
        if (parts.element.ownerDocument.activeElement !== parts.scaleField) parts.scaleField.value = scaleText;
        parts.scaleRead.textContent = scaleText;
        parts.ground.textContent = groundPx;
        parts.reason.textContent = this.#reasonText();
        const atCeiling = source.rasterPx > 0 && scale >= source.ceiling - 1e-9;
        parts.terrain.hidden = !(source.rasterPx > 0 && scale > 1 && !atCeiling);
        if (!parts.terrain.hidden) parts.terrain.textContent = i18n.format("FILRODENSWMB.UI.ExportTerrainLine", { scale: scaleText, px: number(source.rasterPx) });
        parts.steer.hidden = !(atCeiling && source.cut);
        if (!parts.steer.hidden) {
            const off = source.cutOff?.() ?? null;
            parts.cut.setAttribute("aria-disabled", String(!!off));
            if (off) parts.cut.dataset.tooltip = off;
            else delete parts.cut.dataset.tooltip;
        }

        // The image, or Too large
        parts.result.hidden = !plan.fits;
        parts.tooLarge.hidden = plan.fits;
        const what = i18n.format(this.#preset === "whole" ? "FILRODENSWMB.UI.ExportOfTheMap" : this.#preset === "screen" ? "FILRODENSWMB.UI.ExportOfTheView" : "FILRODENSWMB.UI.ExportOfTheArea", { scale: scaleText });
        const sizeText = i18n.format("FILRODENSWMB.UI.ExportPixels", { width: number(plan.width), height: number(plan.height) });
        if (plan.fits) {
            parts.size.textContent = sizeText;
            parts.what.textContent = what;
        } else {
            const { MAX_SIDE, MAX_PIXELS } = FILRODENSWMB.EXPORT_PNG;
            parts.limit.innerHTML = i18n.format("FILRODENSWMB.UI.ExportTooLargeLine", {
                scale: `<b>${scaleText}</b>`,
                size: `<b>${sizeText}</b>`,
                side: number(MAX_SIDE),
                pixels: number(MAX_PIXELS / 1e6),
            });
            this.#fitButton(parts.fitScale, plan.fitScale, () => {
                const size = ExportArea.size(this.#area, plan.fitScale);
                return [i18n.format("FILRODENSWMB.UI.ExportFitScale", { scale: `${plan.fitScale}×` }), i18n.format("FILRODENSWMB.UI.ExportFitScaleLine", { size: i18n.format("FILRODENSWMB.UI.ExportPixels", { width: number(size.width), height: number(size.height) }) })];
            });
            this.#fitButton(parts.fitArea, plan.fitArea, () => [
                i18n.localize("FILRODENSWMB.UI.ExportFitArea"),
                i18n.format("FILRODENSWMB.UI.ExportFitAreaLine", { width: this.#km(plan.fitArea.width), height: this.#km(plan.fitArea.height), unit: source.unit, scale: scaleText }),
            ]);
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

        // File name
        if (this.#typedName === null) parts.fileName.value = this.#fileName();
        parts.ext.textContent = `.${ImageFormat.byId(this.#format).extension}`;

        // The footer: how many tiles, and Export only while the choice fits
        const tiles = ExportScale.tiles(plan.width, plan.height, source.tileLimit).length;
        this.#overlay?.setFooterStart(plan.fits && tiles > 1 ? i18n.format("FILRODENSWMB.UI.ExportTiles", { count: tiles }) : "");
        const exportButton = this.#overlay?.button("export");
        if (exportButton) exportButton.disabled = !plan.fits || !!this.#drawing;

        if (estimate && plan.fits) this.#scheduleEstimate();
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
        const reason = this.#recommend;
        const px = (value) => Math.round(value);
        const scale = `${reason.scale}×`;
        if (reason.kind === "none") return i18n.format("FILRODENSWMB.UI.ExportReasonNone", { scale });
        if (reason.kind === "enough") return i18n.format("FILRODENSWMB.UI.ExportReasonEnough", { scale, px: px(reason.px) });
        if (reason.kind === "reaches") return i18n.format("FILRODENSWMB.UI.ExportReasonReaches", { scale, px: px(reason.px), scaledPx: px(reason.scaledPx) });
        return i18n.format("FILRODENSWMB.UI.ExportReasonShort", { scale, px: px(reason.px), scaledPx: px(reason.scaledPx) });
    }

    #fileName() {
        return ExportArea.fileName({ name: this.#source.name, preset: this.#preset, scale: this.#scale });
    }

    // ------------------------------------------------------------------ the estimates

    #estimateKey() {
        const { x, y, width, height } = this.#area;
        return `${x},${y},${width},${height}@${this.#scale}`;
    }

    #scheduleEstimate() {
        clearTimeout(this.#estimateTimer);
        const key = this.#estimateKey();
        if (this.#estimates.has(key)) return;
        const area = { ...this.#area };
        const scale = this.#scale;
        this.#estimateTimer = setTimeout(async () => {
            if (!this.#parts.element?.isConnected || this.#drawing) return;
            try {
                const { tiles, pixels } = this.#source.samples(area, scale);
                this.#estimates.set(key, await ImageFormat.estimate(tiles, pixels, this.#formats.map((format) => format.id)));
            } catch (error) {
                console.warn("FWMB | Export size estimate failed", error);
                return;
            }
            if (key === this.#estimateKey()) this.#update();
        }, ESTIMATE_WAIT_MS);
    }

    // ------------------------------------------------------------------ export

    /** Export: the image drawn in tiles with its progress, then saved; the dialogue closes when done. */
    async #export() {
        const plan = this.#plan();
        if (!plan.fits || this.#drawing) return;
        const { i18n } = platform;
        const parts = this.#parts;
        const area = { ...this.#area };
        const scale = this.#scale;
        const format = this.#format;
        const fileName = (this.#typedName ?? this.#fileName()).replace(/[\\/:*?"<>|]+/g, "_");
        const tiles = ExportScale.tiles(plan.width, plan.height, this.#source.tileLimit);
        const formatLabel = this.#formats.find((each) => each.id === format)?.label ?? format;
        const drawing = new AbortController();
        this.#drawing = drawing;
        clearTimeout(this.#estimateTimer);
        const marks = this.#showTiles(area, plan, tiles);
        this.#setDrawing(true);
        parts.then.textContent = i18n.format(tiles.length > 1 ? "FILRODENSWMB.UI.ExportThenJoined" : "FILRODENSWMB.UI.ExportThenSaved", { format: formatLabel });
        const progress = (done) => {
            const shown = Math.min(done + 1, tiles.length);
            parts.tile.textContent = i18n.format("FILRODENSWMB.UI.ExportTileOf", { number: shown, count: tiles.length });
            parts.bar.style.setProperty("--p", `${(done / tiles.length) * 100}%`);
            marks.forEach((mark, index) => {
                mark.classList.toggle("fwmb-is-done", index < done);
                mark.classList.toggle("fwmb-is-now", index === done);
            });
        };
        progress(0);
        let saved = false;
        try {
            const canvas = await this.#source.draw(area, scale, { signal: drawing.signal, onTile: progress });
            if (canvas && !drawing.signal.aborted) {
                parts.tile.textContent = i18n.format("FILRODENSWMB.UI.ExportSaving", { format: formatLabel });
                parts.bar.style.setProperty("--p", "100%");
                const { blob, format: written } = await ImageFormat.encode(canvas, format);
                if (!drawing.signal.aborted) {
                    ImageFormat.download(blob, `${fileName}.${written.extension}`);
                    saved = true;
                }
            }
        } catch (error) {
            console.error("FWMB | Failed to export the image:", error);
            platform.notify.error(i18n.localize("FILRODENSWMB.UI.ExportPngFailed"));
        } finally {
            this.#drawing = null;
            marks[0]?.parentElement?.remove();
        }
        if (saved) {
            await this.#remember();
            this.#overlay.close(true);
            return;
        }
        this.#setDrawing(false);
        this.#update();
    }

    #setDrawing(on) {
        const parts = this.#parts;
        parts.element.classList.toggle("fwmb-is-drawing", on);
        parts.progress.hidden = !on;
        this.#control.disabled = on;
        const exportButton = this.#overlay.button("export");
        if (exportButton) exportButton.disabled = on || !this.#plan().fits;
        if (on) parts.stop.focus();
    }

    /** The tiles over the area on the preview, marked as they are drawn (board X2b). */
    #showTiles(area, plan, tiles) {
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
        const { SETTINGS } = FILRODENSWMB.EXPORT_PNG;
        try {
            await ImageFormat.remember(this.#source.kind, this.#format);
            await platform.settings.set(SETTINGS.PRESET_PNG, this.#lastPreset);
            await platform.settings.set(SETTINGS.ASPECT_PNG, this.#aspect);
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
