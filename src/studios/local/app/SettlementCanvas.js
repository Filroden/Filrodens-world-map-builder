import { FILRODENSWMB } from "../../../config.js";

/**
 * The settlement map's canvas (L-surface; decision record §9 answers 12 and 13): a 2D canvas that
 * pans and zooms over a built settlement, drawn in the worker that built it (LocalWorkers.tile).
 *
 * - **At once:** a coarse picture of the whole frame, so there is always something to see.
 * - **On a pan or zoom:** the last pictures stretched to the new view while sharp tiles are drawn
 *   for what is visible, nearest the centre first; tiles no longer wanted are skipped before they
 *   are asked for. Tiles come in levels, each twice the detail of the one before, down to
 *   CANVAS.FINEST_M (metres a canvas pixel), each TILE_PX a side; none is asked for at a level no
 *   sharper than the coarse picture, which shows those views as well.
 * - **Before it is shown:** while its element has no size (the frame not yet showing settlement
 *   maps), it draws nothing and asks for no tiles, and the framing it is asked to show waits until
 *   it has a size. Measured as one pixel, it would ask for tiles thousands of km a side.
 * - **Only the frame:** the pictures are clipped to the frame, since a tile at its edge runs past it
 *   and is drawn whole.
 * - **The drawing line:** a thin line along the canvas's top while visible tiles are still missing
 *   past CANVAS.LINE_DELAY_MS.
 * - **Moved by** a drag, the wheel (round the pointer), two fingers (pinch and pan), and the keys
 *   (arrows pan, + and - zoom, 0 back to the town view) while it has focus.
 * - **Views of the drawing** (step 3: a household view, or none): each has its own coarse picture
 *   and tiles, kept side by side, so going back to a view already seen shows at once.
 * - **Pointing:** a mouse or pen moving over it with no button down is told to its owner (onPoint,
 *   in metres), and a press let go where it was pressed is a tap (onTap); an overlay over the
 *   pictures is drawn by its owner (overlay), again on redrawOverlay() and after every paint.
 *
 * Views are in metres from the frame's centre, as the engine's framings are ({rect: [x0, y0, x1,
 * y1]}). The canvas tells its owner when the view moves (onView), so the settlement bar can show
 * which framing, if any, is shown.
 */
export class SettlementCanvas {
    /** @type {HTMLElement} */
    #host;
    /** @type {HTMLCanvasElement} */
    #canvas;
    #ctx;
    /** The drawing line's element. */
    #line;
    /** Draws a tile: (view) => Promise<ImageBitmap|HTMLCanvasElement>. */
    #draw;
    /** Draws over the tiles in canvas pixels (the map's title, scale bar and north arrow), or null. */
    #decorate;
    /** The frame, in metres ({width, height}). */
    #frame;
    /** The view: its centre (m from the frame's centre) and metres a CSS pixel. */
    #view = { cx: 0, cy: 0, m: 1 };
    /** The coarse picture of the whole frame, and its rectangle. */
    #coarse = null;
    /** Tiles by key: { bitmap, level, x, y } (a Map kept in use order: the oldest first). */
    #tiles = new Map();
    /** Tiles asked for and not yet back, by key. */
    #asked = new Set();
    /** How many tiles are being drawn now. */
    #drawing = 0;
    /** When visible tiles first went missing (for the drawing line), or null. */
    #missingSince = null;
    #frameRequest = null;
    #resize = null;
    #pointers = new Map();
    #onView;
    #destroyed = false;
    /** The framings, for the keys (0: the town view). */
    #home = null;
    /** A framing asked for before the canvas had a size, shown once it has one. */
    #pending = null;
    /** The view of the drawing shown (null: the map as it is); its pictures are kept apart. */
    #variant = null;
    /** Each view's coarse picture, by view. */
    #coarses = new Map();
    /** The overlay's canvas, and what draws on it: (ctx, toCanvas) => void. */
    #overlay = null;
    #drawOverlay = null;
    #onPoint;
    #onTap;
    /** A press that may be a tap: where and when it went down. */
    #press = null;

    /**
     * @param {HTMLElement} host - The element the canvas fills.
     * @param {object} options
     * @param {{width: number, height: number}} options.frame - The frame, in metres.
     * @param {(view: {rect: number[], mPerPx: number, widthPx: number, heightPx: number}) => Promise<*>} options.draw
     * @param {(view: object) => void} [options.onView] - Told when the view moves, with its rectangle.
     * @param {(ctx: CanvasRenderingContext2D, view: object) => void} [options.decorate] - Draws over
     *     the tiles, given the view in canvas pixels (rect, mPerPx, widthPx, heightPx).
     * @param {string} [options.label] - The canvas's accessible name.
     * @param {(ctx: CanvasRenderingContext2D, toCanvas: (x: number, y: number) => number[]) => void} [options.overlay] -
     *     Draws over everything on a canvas of its own, given where a point in metres falls on it
     *     (in its pixels).
     * @param {(point: {x: number, y: number, px: number, py: number}|null) => void} [options.onPoint] -
     *     A mouse or pen over the canvas with no button down (null as it leaves), in metres and in
     *     CSS pixels from the canvas's corner.
     * @param {(point: {x: number, y: number, px: number, py: number, touch: boolean}) => void} [options.onTap] -
     *     A press let go where it went down.
     * @param {*} [options.variant] - The view of the drawing shown at first (draw is given it).
     */
    constructor(host, { frame, draw, onView = () => {}, decorate = null, label = "", overlay = null, onPoint = () => {}, onTap = () => {}, variant = null }) {
        this.#host = host;
        this.#frame = frame;
        this.#draw = draw;
        this.#decorate = decorate;
        this.#onView = onView;
        this.#drawOverlay = overlay;
        this.#onPoint = onPoint;
        this.#onTap = onTap;
        this.#variant = variant;
        this.#canvas = host.ownerDocument.createElement("canvas");
        this.#canvas.className = "fwmb-settlement-canvas";
        this.#canvas.tabIndex = 0;
        this.#canvas.setAttribute("role", "img");
        if (label) this.#canvas.setAttribute("aria-label", label);
        this.#ctx = this.#canvas.getContext("2d");
        this.#line = host.ownerDocument.createElement("span");
        this.#line.className = "fwmb-drawline fwmb-hidden";
        this.#line.setAttribute("aria-hidden", "true");
        this.#overlay = host.ownerDocument.createElement("canvas");
        this.#overlay.className = "fwmb-settlement-overlay";
        this.#overlay.setAttribute("aria-hidden", "true");
        host.append(this.#canvas, this.#overlay, this.#line);
        this.#listen();
        if (typeof ResizeObserver !== "undefined") {
            this.#resize = new ResizeObserver(() => this.#fit());
            this.#resize.observe(host);
        }
        this.#fit();
    }

    /** The canvas element (for focus). */
    get element() {
        return this.#canvas;
    }

    /** The view's rectangle in metres, and its metres a CSS pixel. */
    get view() {
        const { width, height } = this.#sizeOrOne();
        const { cx, cy, m } = this.#view;
        return { rect: [cx - (width * m) / 2, cy - (height * m) / 2, cx + (width * m) / 2, cy + (height * m) / 2], mPerPx: m };
    }

    /** The coarse picture of the whole frame for the view shown, drawn at once (see the class comment). */
    async drawCoarse() {
        const variant = this.#variant;
        const { width, height } = this.#frame;
        const { COARSE_PX } = FILRODENSWMB.LOCAL.CANVAS;
        const mPerPx = Math.max(width, height) / COARSE_PX;
        const view = { rect: [-width / 2, -height / 2, width / 2, height / 2], mPerPx, widthPx: Math.round(width / mPerPx), heightPx: Math.round(height / mPerPx) };
        const bitmap = await this.#draw(view, variant);
        if (this.#destroyed) return;
        this.#coarses.set(variant, { bitmap, rect: view.rect });
        if (variant === this.#variant) this.#coarse = this.#coarses.get(variant);
        this.#schedule();
    }

    /** The view of the drawing shown (see the class comment). */
    get variant() {
        return this.#variant;
    }

    /**
     * Shows another view of the drawing: its pictures where they are kept, else its coarse picture
     * drawn (the last view's stretched meanwhile) and its tiles asked for.
     * @returns {Promise<void>} Once its coarse picture is shown.
     */
    async setVariant(variant) {
        if (variant === this.#variant) return;
        this.#variant = variant;
        const coarse = this.#coarses.get(variant);
        if (coarse) {
            this.#coarse = coarse;
            this.#schedule();
            return;
        }
        this.#schedule();
        await this.drawCoarse();
    }

    /** Where a point in metres falls on the canvas, in CSS pixels from its corner. */
    toCss(x, y) {
        const { rect, mPerPx } = this.view;
        return [(x - rect[0]) / mPerPx, (y - rect[1]) / mPerPx];
    }

    /** The point in metres at a place on the canvas, in CSS pixels from its corner. */
    fromCss(px, py) {
        const { rect, mPerPx } = this.view;
        return [rect[0] + px * mPerPx, rect[1] + py * mPerPx];
    }

    /** Draws the overlay again (its owner's picture changed). */
    redrawOverlay() {
        if (this.#destroyed || !this.#sized()) return;
        const ctx = this.#overlay.getContext("2d");
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, this.#overlay.width, this.#overlay.height);
        if (!this.#drawOverlay) return;
        const ratio = this.#overlay.width / Math.max(1, this.#size().width);
        ctx.save();
        this.#drawOverlay(ctx, (x, y) => this.toCss(x, y).map((v) => v * ratio));
        ctx.restore();
    }

    /**
     * Shows a rectangle of the frame (a framing), as large as fits.
     * @param {number[]} rect - [x0, y0, x1, y1] in metres.
     * @param {object} [options]
     * @param {boolean} [options.home] - The view the 0 key and Reset view go back to.
     */
    show(rect, { home = false } = {}) {
        if (home) this.#home = rect;
        if (!this.#sized()) {
            this.#pending = rect;
            this.#view = { ...this.#view, cx: (rect[0] + rect[2]) / 2, cy: (rect[1] + rect[3]) / 2 };
            return;
        }
        this.#pending = null;
        const { width, height } = this.#size();
        const m = Math.max((rect[2] - rect[0]) / width, (rect[3] - rect[1]) / height);
        this.#view = { cx: (rect[0] + rect[2]) / 2, cy: (rect[1] + rect[3]) / 2, m: this.#clampM(m) };
        this.#settle(false);
    }

    /** Zooms by a factor round the view's centre (or a point in CSS pixels on the canvas). */
    zoom(factor, at = null) {
        if (!this.#sized()) return;
        const { width, height } = this.#size();
        const point = at ?? { x: width / 2, y: height / 2 };
        const { cx, cy, m } = this.#view;
        const next = this.#clampM(m / factor);
        // The point under the pointer stays where it is
        const wx = cx + (point.x - width / 2) * m;
        const wy = cy + (point.y - height / 2) * m;
        this.#view = { cx: wx - (point.x - width / 2) * next, cy: wy - (point.y - height / 2) * next, m: next };
        this.#settle(true);
    }

    /** Pans by a distance in CSS pixels. */
    pan(dx, dy) {
        this.#view.cx -= dx * this.#view.m;
        this.#view.cy -= dy * this.#view.m;
        this.#settle(true);
    }

    /** Drops every picture (the settlement was drawn again) and draws afresh. */
    clear() {
        this.#tiles.clear();
        this.#asked.clear();
        this.#coarse = null;
        this.#coarses.clear();
        this.#schedule();
    }

    destroy() {
        this.#destroyed = true;
        this.#resize?.disconnect();
        if (this.#frameRequest !== null) cancelAnimationFrame(this.#frameRequest);
        this.#canvas.remove();
        this.#overlay.remove();
        this.#line.remove();
        this.#tiles.clear();
        this.#coarses.clear();
    }

    // ------------------------------------------------------------------ the view

    /** The element's size in CSS pixels (either may be 0 while it is not shown). */
    #size() {
        return { width: this.#host.clientWidth, height: this.#host.clientHeight };
    }

    /** Whether the element is shown with a size, so the view can be measured against it. */
    #sized() {
        const { width, height } = this.#size();
        return width > 0 && height > 0;
    }

    #sizeOrOne() {
        const { width, height } = this.#size();
        return { width: width || 1, height: height || 1 };
    }

    /** Metres a CSS pixel kept between the finest detail and the whole frame with room round it. */
    #clampM(m) {
        if (!this.#sized()) return m;
        const { FINEST_M, ROOM } = FILRODENSWMB.LOCAL.CANVAS;
        const { width, height } = this.#size();
        const ratio = globalThis.devicePixelRatio || 1;
        const coarsest = Math.max(this.#frame.width / width, this.#frame.height / height) * ROOM;
        return Math.min(coarsest, Math.max(FINEST_M * ratio, m));
    }

    /** Keeps the view's centre on the frame, then draws. */
    #settle(moved) {
        const halfW = this.#frame.width / 2;
        const halfH = this.#frame.height / 2;
        this.#view.cx = Math.min(halfW, Math.max(-halfW, this.#view.cx));
        this.#view.cy = Math.min(halfH, Math.max(-halfH, this.#view.cy));
        this.#schedule();
        this.#onView({ ...this.view, moved });
    }

    #fit() {
        if (!this.#sized()) return;
        const { width, height } = this.#size();
        const ratio = globalThis.devicePixelRatio || 1;
        this.#canvas.width = Math.max(1, Math.round(width * ratio));
        this.#canvas.height = Math.max(1, Math.round(height * ratio));
        this.#canvas.style.width = `${width}px`;
        this.#canvas.style.height = `${height}px`;
        this.#overlay.width = this.#canvas.width;
        this.#overlay.height = this.#canvas.height;
        this.#overlay.style.width = `${width}px`;
        this.#overlay.style.height = `${height}px`;
        if (this.#pending) {
            this.show(this.#pending);
            return;
        }
        this.#view.m = this.#clampM(this.#view.m);
        this.#schedule();
    }

    // ------------------------------------------------------------------ drawing

    #schedule() {
        if (this.#destroyed || this.#frameRequest !== null) return;
        this.#frameRequest = requestAnimationFrame(() => {
            this.#frameRequest = null;
            this.#paint();
        });
    }

    /** The level whose detail is at least the view's: the finest level no finer than needed. */
    #levelFor(mPerDevicePx) {
        const { FINEST_M } = FILRODENSWMB.LOCAL.CANVAS;
        return Math.max(0, Math.floor(Math.log2(Math.max(FINEST_M, mPerDevicePx) / FINEST_M)));
    }

    /** A level's tile: its side in metres. */
    #tileMetres(level) {
        return FILRODENSWMB.LOCAL.CANVAS.FINEST_M * 2 ** level * FILRODENSWMB.LOCAL.TILE_PX;
    }

    #paint() {
        if (this.#destroyed || !this.#sized() || this.#pending) return;
        const ctx = this.#ctx;
        const ratio = this.#canvas.width / Math.max(1, this.#size().width);
        const { rect, mPerPx } = this.view;
        // Canvas pixels a metre, and where a point in metres falls on the canvas
        const scale = ratio / mPerPx;
        const place = (x0, y0, x1, y1) => [(x0 - rect[0]) * scale, (y0 - rect[1]) * scale, (x1 - x0) * scale, (y1 - y0) * scale];
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, this.#canvas.width, this.#canvas.height);
        ctx.imageSmoothingEnabled = true;
        // Only the frame: a tile at its edge runs past it, drawn whole (the wild land filling it)
        ctx.save();
        ctx.beginPath();
        ctx.rect(...place(...this.#frameRect()));
        ctx.clip();
        if (this.#coarse) ctx.drawImage(this.#coarse.bitmap, ...place(...this.#coarse.rect));
        const want = this.#levelFor(mPerPx / ratio);
        // The view's tiles held, coarse to fine, so the sharpest of what is held lies on top
        const held = [...this.#tiles.values()].filter((tile) => tile.variant === this.#variant && tile.level >= want && this.#overlaps(tile, rect)).sort((a, b) => b.level - a.level);
        for (const tile of held) ctx.drawImage(tile.bitmap, ...place(...tile.rect));
        ctx.restore();
        // The map's own title, scale bar and north arrow, once over the whole view
        if (this.#decorate) {
            ctx.save();
            this.#decorate(ctx, { rect, mPerPx: mPerPx / ratio, widthPx: this.#canvas.width, heightPx: this.#canvas.height });
            ctx.restore();
        }
        // What is missing at the level wanted, nearest the centre first; none where the coarse
        // picture is as sharp as that level's tiles
        const sharper = FILRODENSWMB.LOCAL.CANVAS.FINEST_M * 2 ** want < this.#coarseM();
        const missing = sharper ? this.#visibleTiles(want, rect).filter((tile) => !this.#tiles.has(tile.key)) : [];
        this.#showLine(missing.length > 0);
        this.#ask(missing);
        this.redrawOverlay();
    }

    /** The frame's rectangle in metres, round the centre. */
    #frameRect() {
        const { width, height } = this.#frame;
        return [-width / 2, -height / 2, width / 2, height / 2];
    }

    /** The coarse picture's metres a pixel. */
    #coarseM() {
        return Math.max(this.#frame.width, this.#frame.height) / FILRODENSWMB.LOCAL.CANVAS.COARSE_PX;
    }

    #overlaps(tile, rect) {
        return tile.rect[0] < rect[2] && tile.rect[2] > rect[0] && tile.rect[1] < rect[3] && tile.rect[3] > rect[1];
    }

    /** The tiles of a level the view shows, within the frame, nearest its centre first. */
    #visibleTiles(level, rect) {
        const side = this.#tileMetres(level);
        const halfW = this.#frame.width / 2;
        const halfH = this.#frame.height / 2;
        const x0 = Math.floor((Math.max(rect[0], -halfW) + halfW) / side);
        const x1 = Math.ceil((Math.min(rect[2], halfW) + halfW) / side);
        const y0 = Math.floor((Math.max(rect[1], -halfH) + halfH) / side);
        const y1 = Math.ceil((Math.min(rect[3], halfH) + halfH) / side);
        const cx = (rect[0] + rect[2]) / 2;
        const cy = (rect[1] + rect[3]) / 2;
        const tiles = [];
        for (let y = y0; y < y1; y++) {
            for (let x = x0; x < x1; x++) {
                const tileRect = [x * side - halfW, y * side - halfH, (x + 1) * side - halfW, (y + 1) * side - halfH];
                const d = Math.hypot((tileRect[0] + tileRect[2]) / 2 - cx, (tileRect[1] + tileRect[3]) / 2 - cy);
                tiles.push({ key: `${this.#variant ?? ""}:${level}:${x}:${y}`, level, x, y, rect: tileRect, d, variant: this.#variant });
            }
        }
        return tiles.sort((a, b) => a.d - b.d);
    }

    /** Asks for missing tiles, a few at a time; those no longer wanted when a turn comes are skipped. */
    #ask(missing) {
        const { AT_ONCE } = FILRODENSWMB.LOCAL.CANVAS;
        for (const tile of missing) {
            if (this.#drawing >= AT_ONCE) return;
            if (this.#asked.has(tile.key)) continue;
            this.#asked.add(tile.key);
            this.#drawing++;
            const side = FILRODENSWMB.LOCAL.TILE_PX;
            const view = { rect: tile.rect, mPerPx: (tile.rect[2] - tile.rect[0]) / side, widthPx: side, heightPx: side };
            this.#draw(view, tile.variant)
                .then((bitmap) => {
                    if (this.#destroyed) return;
                    this.#keep(tile, bitmap);
                })
                .catch((error) => {
                    if (!this.#destroyed) console.warn("FWMB | A settlement map tile could not be drawn:", error);
                })
                .finally(() => {
                    this.#drawing--;
                    this.#asked.delete(tile.key);
                    this.#schedule();
                });
        }
    }

    /** Keeps a tile, dropping the oldest past CANVAS.KEEP_TILES. */
    #keep(tile, bitmap) {
        this.#tiles.delete(tile.key);
        this.#tiles.set(tile.key, { key: tile.key, level: tile.level, rect: tile.rect, variant: tile.variant, bitmap });
        const { KEEP_TILES } = FILRODENSWMB.LOCAL.CANVAS;
        while (this.#tiles.size > KEEP_TILES) {
            const [oldest, entry] = this.#tiles.entries().next().value;
            entry.bitmap?.close?.();
            this.#tiles.delete(oldest);
        }
    }

    /** The drawing line, shown once tiles have been missing past its delay. */
    #showLine(missing) {
        if (!missing) {
            this.#missingSince = null;
            this.#line.classList.add("fwmb-hidden");
            return;
        }
        const now = performance.now();
        this.#missingSince ??= now;
        const late = now - this.#missingSince >= FILRODENSWMB.LOCAL.CANVAS.LINE_DELAY_MS;
        this.#line.classList.toggle("fwmb-hidden", !late);
        // Look again once the delay has passed
        if (!late) setTimeout(() => this.#schedule(), FILRODENSWMB.LOCAL.CANVAS.LINE_DELAY_MS);
    }

    // ------------------------------------------------------------------ moving it

    #listen() {
        const canvas = this.#canvas;
        const at = (event) => {
            const box = canvas.getBoundingClientRect();
            const px = event.clientX - box.left;
            const py = event.clientY - box.top;
            const [x, y] = this.fromCss(px, py);
            return { x, y, px, py };
        };
        canvas.addEventListener("pointerdown", (event) => {
            // A pointer already let go (or one the browser does not track) cannot be captured
            try {
                canvas.setPointerCapture?.(event.pointerId);
            } catch {
                // the drag is still followed while the pointer stays over the canvas
            }
            this.#pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
            this.#press = this.#pointers.size === 1 ? { id: event.pointerId, x: event.clientX, y: event.clientY, at: performance.now() } : null;
        });
        canvas.addEventListener("pointermove", (event) => {
            const last = this.#pointers.get(event.pointerId);
            if (!last) {
                if (event.pointerType !== "touch" && !event.buttons) this.#onPoint(at(event));
                return;
            }
            const { TAP_PX } = FILRODENSWMB.LOCAL.CANVAS;
            if (this.#press && Math.hypot(event.clientX - this.#press.x, event.clientY - this.#press.y) > TAP_PX) this.#press = null;
            const now = { x: event.clientX, y: event.clientY };
            if (this.#pointers.size === 1) {
                this.pan(now.x - last.x, now.y - last.y);
            } else if (this.#pointers.size === 2) {
                const [a, b] = [...this.#pointers.entries()];
                const other = a[0] === event.pointerId ? b[1] : a[1];
                const before = Math.hypot(last.x - other.x, last.y - other.y);
                const after = Math.hypot(now.x - other.x, now.y - other.y);
                const box = canvas.getBoundingClientRect();
                const mid = { x: (now.x + other.x) / 2 - box.left, y: (now.y + other.y) / 2 - box.top };
                if (before > 0 && after > 0) this.zoom(after / before, mid);
                this.pan((now.x - last.x) / 2, (now.y - last.y) / 2);
            }
            this.#pointers.set(event.pointerId, now);
        });
        const up = (event) => {
            this.#pointers.delete(event.pointerId);
        };
        canvas.addEventListener("pointerup", (event) => {
            const press = this.#press;
            this.#press = null;
            up(event);
            const { TAP_PX, TAP_MS } = FILRODENSWMB.LOCAL.CANVAS;
            if (press?.id === event.pointerId && Math.hypot(event.clientX - press.x, event.clientY - press.y) <= TAP_PX && performance.now() - press.at <= TAP_MS) {
                this.#onTap({ ...at(event), touch: event.pointerType === "touch" });
            }
        });
        canvas.addEventListener("pointercancel", (event) => {
            this.#press = null;
            up(event);
        });
        canvas.addEventListener("pointerleave", (event) => {
            if (event.pointerType !== "touch") this.#onPoint(null);
        });
        canvas.addEventListener(
            "wheel",
            (event) => {
                event.preventDefault();
                const box = canvas.getBoundingClientRect();
                this.zoom(Math.exp(-event.deltaY * FILRODENSWMB.LOCAL.CANVAS.WHEEL), { x: event.clientX - box.left, y: event.clientY - box.top });
            },
            { passive: false },
        );
        canvas.addEventListener("keydown", (event) => {
            const step = FILRODENSWMB.LOCAL.CANVAS.KEY_PAN_PX;
            const moves = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
            if (moves[event.key]) this.pan(...moves[event.key]);
            else if (event.key === "+" || event.key === "=") this.zoom(FILRODENSWMB.LOCAL.CANVAS.ZOOM_STEP);
            else if (event.key === "-" || event.key === "_") this.zoom(1 / FILRODENSWMB.LOCAL.CANVAS.ZOOM_STEP);
            else if (event.key === "0" && this.#home) this.show(this.#home);
            else return;
            event.preventDefault();
            event.stopPropagation();
        });
    }
}
