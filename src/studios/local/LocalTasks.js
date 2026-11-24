/**
 * The Local studio's jobs: a settlement's versions built, framed, drawn and kept. Each version is
 * built once and kept here, by id, until it is released, so its tiles can be drawn from it as the
 * canvas pans and zooms; of the version the user keeps, its households are copied back to the main
 * thread once (for the households card), and its town only where this thread cannot draw it.
 *
 * The worker (LocalWorker.js) serves these tasks; where workers cannot be used, LocalWorkers runs
 * the same tasks on the main thread. Each takes its payload and returns `{ value, transfer }`.
 *
 * Drawing needs an OffscreenCanvas (Chromium, Firefox, Foundry's Electron); without one the
 * versions are built here and the thumbnails and tiles are drawn on the main thread from the plain
 * copies instead (`canDraw` false).
 */
import { FILRODENSWMB } from "../../config.js";
import { createNamer } from "../../kernel/names/PersonNames.js";
import { hinterlandView, townView } from "./engine/Framing.js";
import { householdsOf } from "./engine/Households.js";
import { plain } from "./engine/Plain.js";
import { buildTown } from "./engine/Town.js";
import { drawTown } from "./render/CanvasTown.js";
import { ATLAS, themeStyle } from "./render/Styles.js";

/** Whether this thread can draw off screen. */
export const canDraw = () => typeof OffscreenCanvas !== "undefined";

/** The versions built here, by id: { input, town, households, view }. */
const versions = new Map();

const now = () => (globalThis.performance ? globalThis.performance.now() : Date.now());

/** The version `id`, or an error naming it. */
function versionOf(id) {
    const version = versions.get(id);
    if (!version) throw new Error(`no version ${id} is held here`);
    return version;
}

/**
 * A style from its description: the atlas, or the theme's from its tokens (plain values, read from
 * the studio's stylesheet on the main thread).
 * @param {{name?: "atlas"|"theme", tokens?: Object<string, string>, mode?: "light"|"dark"}|null} style
 */
export function styleOf(style) {
    return style?.name === "theme" && style.tokens ? themeStyle(style.tokens, style.mode ?? "light") : ATLAS;
}

/**
 * The culture records the households read: each culture's Household heads setting (Automatic until
 * the culture's Names section sets one, N3) and its lineage, as the namer resolves it from the
 * culture's name base.
 */
export function householdCultures(input, namer) {
    return (input.cultures ?? []).map((culture) => ({ ...culture, heads: culture.heads ?? "auto", lineage: namer.cultureOf(culture.name).settings.lineage }));
}

/** The namer for a settlement: its cultures, and the places near it for names from places. */
export function namerFor(input) {
    return createNamer({ cultures: input.cultures ?? [], nearby: (input.neighbours ?? []).map((n) => n.name) });
}

/** Each house and farmhouse marked with its household's culture, wealth and trade group, which the drawing reads (yards, gardens and the Culture view). */
function markBuildings(town, households) {
    for (const h of [...households.houses, ...households.farms]) {
        const building = town.buildings[h.index];
        if (!building) continue;
        building.culture = h.culture;
        building.wealth = h.wealth;
        building.group = h.group;
    }
}

/**
 * Whether a view is one a settlement map's canvas, cards and pictures ask for: no coarser than
 * VIEW_LIMITS.COARSEST of the frame's longer side a pixel, and no wider or taller than
 * VIEW_LIMITS.SPAN times it. The drawing's widths have floors in pixels, so a view of a far larger
 * area (a canvas that measured itself before it was shown asked for one 3,355 km a side) costs
 * seconds and gigabytes for a picture that shows nothing.
 * @param {object} town - Its frame, in metres.
 * @param {{rect: number[], mPerPx: number}} view
 */
export function viewFits(town, view) {
    const { COARSEST, SPAN } = FILRODENSWMB.LOCAL.VIEW_LIMITS;
    const side = Math.max(town.frame.width, town.frame.height);
    const [x0, y0, x1, y1] = view.rect;
    return view.mPerPx > 0 && view.mPerPx <= side / COARSEST && x1 - x0 <= side * SPAN && y1 - y0 <= side * SPAN;
}

/** Throws where a view does not fit (see viewFits). */
export function checkView(town, view) {
    if (!viewFits(town, view)) throw new RangeError(`a view of ${Math.round(view.rect[2] - view.rect[0])} m at ${view.mPerPx} m a pixel is outside the settlement's frame`);
}

/**
 * Draws a rectangle of a town onto a new canvas.
 * @param {object} town
 * @param {{rect: number[], mPerPx: number, widthPx: number, heightPx: number}} view
 * @param {object} [options] - style (see styleOf), cultures ({[name]: {roof, wall, wallMaterial}}),
 *     theme (null or "culture"), layers, and makeCanvas (width, height) for a thread with no
 *     OffscreenCanvas.
 */
export function drawView(town, view, { style = null, cultures = {}, theme = null, layers, makeCanvas = (w, h) => new OffscreenCanvas(w, h) } = {}) {
    const canvas = makeCanvas(view.widthPx, view.heightPx);
    const options = { cultures, theme, now };
    if (layers) options.layers = layers;
    drawTown(canvas.getContext("2d"), town, view, styleOf(style), options);
    return canvas;
}

/** A canvas as something to send: an ImageBitmap off screen, the canvas itself on the main thread. */
function picture(canvas) {
    return typeof canvas.transferToImageBitmap === "function" ? canvas.transferToImageBitmap() : canvas;
}

/** The town view drawn at a size, its whole width (a version's card). */
function thumbnailOf(town, view, { widthPx, heightPx }, options) {
    const mPerPx = Math.max(view.width / widthPx, view.height / heightPx);
    const cx = (view.rect[0] + view.rect[2]) / 2;
    const cy = (view.rect[1] + view.rect[3]) / 2;
    const rect = [cx - (widthPx * mPerPx) / 2, cy - (heightPx * mPerPx) / 2, cx + (widthPx * mPerPx) / 2, cy + (heightPx * mPerPx) / 2];
    return drawView(town, { rect, mPerPx, widthPx, heightPx }, options);
}

export const TASKS = {
    /** What this thread can do. */
    hello() {
        return { value: { canDraw: canDraw() } };
    },

    /**
     * Builds a version and keeps it: its framings, figures and timings back, with the thumbnail
     * of its town view where a size is asked for and this thread can draw (else the plain town, for
     * the main thread to draw it).
     * @param {{id: string, input: object, thumbnail?: {widthPx: number, heightPx: number, style?: object, layers?: string[]}}} payload
     */
    build({ id, input, thumbnail = null }) {
        const started = now();
        const town = buildTown(input);
        const builtMs = now() - started;
        const framed = now();
        const view = townView(town);
        const framingMs = now() - framed;
        versions.set(id, { input, town, households: null, view });
        // What the map's own title, scale bar and north arrow read (the renderer's labels layer),
        // so the canvas can draw them once over its tiles
        const label = { name: town.name, kind: town.kind, wall: !!town.wall, shore: !!town.shore };
        const value = { id, frame: { ...town.frame }, kind: town.kind, label, townView: view, hinterlandView: hinterlandView(town), stats: town.stats, engineRevision: town.engineRevision, timings: { buildMs: builtMs, framingMs } };
        const transfer = [];
        if (thumbnail && canDraw()) {
            const drawn = now();
            const bitmap = picture(thumbnailOf(town, view, thumbnail, { style: thumbnail.style, layers: thumbnail.layers }));
            value.timings.thumbnailMs = now() - drawn;
            value.thumbnail = bitmap;
            transfer.push(bitmap);
        } else if (thumbnail) {
            value.town = plain(town);
        }
        return { value, transfer };
    },

    /**
     * The version kept: its households worked out (named by its cultures), its houses marked for
     * the drawing, and its households copied back once, with its town where it is asked for (a
     * thread that cannot draw it; the town is tens of MB, most of it its terrain).
     */
    keep({ id, town = true }) {
        const version = versionOf(id);
        const started = now();
        if (!version.households) {
            const namer = namerFor(version.input);
            version.households = householdsOf(version.town, { cultures: householdCultures(version.input, namer), namer });
            markBuildings(version.town, version.households);
        }
        const value = { id, households: plain(version.households), ms: now() - started };
        if (town) value.town = plain(version.town);
        return { value };
    },

    /**
     * A rectangle of a version drawn at a resolution.
     * @param {{id: string, view: {rect: number[], mPerPx: number, widthPx: number, heightPx: number}, style?: object, cultures?: object, theme?: string|null, layers?: string[]}} payload
     */
    tile({ id, view, style = null, cultures = {}, theme = null, layers }) {
        const version = versionOf(id);
        checkView(version.town, view);
        const started = now();
        const bitmap = picture(drawView(version.town, view, { style, cultures, theme, layers }));
        return { value: { id, bitmap, ms: now() - started }, transfer: [bitmap] };
    },

    /** Versions dropped. */
    release({ ids }) {
        for (const id of ids) versions.delete(id);
        return { value: { held: versions.size } };
    },
};
