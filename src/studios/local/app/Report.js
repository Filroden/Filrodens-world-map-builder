/**
 * A settlement map's report and legend (L-surface step 5b; board X3b; Ken, 2026-11-26): drawing
 * on the main thread's 2D context over the worker's picture, in the map's look (its paper, ink and
 * face); pure but for its config, so it lives here rather than in render/ (which the worker loads).
 *
 * - **The legend:** a thematic view's key in the image's top-right corner (the title is top left,
 *   the scale bar bottom left, north bottom right), sized from the image's height as the title box
 *   is: up to LEGEND.ROWS keys a column in up to LEGEND.COLUMNS columns, then "and N others".
 * - **The sheet:** the map part, and beside it a column holding the parent map inset over the
 *   information block (`layout`). The column is SIDE_PX across at least; on a larger map part it
 *   grows with everything in it (its `factor`), to SIDE_SHARE of the sheet's width, so it keeps
 *   its proportion beside a great city (Ken, 2026-11-26). The inset and block are laid out and
 *   drawn at the least size and scaled by the factor.
 * - **The information block:** its rows worked out first (`blockRows`, wrapped to the block's
 *   width), so the sheet's size is known before anything is drawn; then drawn (`drawBlock`).
 * - **The inset:** the box of the Surface map it shows (`insetBox`), and over the World studio's
 *   picture of it the frame, the country cells and the ways food comes in and goes out
 *   (`drawInset`); the places are named by the map's own labels.
 */
import { FILRODENSWMB } from "../../../config.js";

const REPORT = () => FILRODENSWMB.LOCAL.EXPORT.REPORT;

/** A colour with alpha: "#rrggbb" or "rgb(…)" as rgba. */
function rgba(colour, alpha) {
    const hex = /^#([0-9a-f]{6})$/i.exec(String(colour ?? ""));
    if (hex) {
        const n = parseInt(hex[1], 16);
        return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
    }
    const rgb = /^rgba?\(([^)]+)\)$/i.exec(String(colour ?? ""));
    if (rgb) {
        const [r, g, b] = rgb[1].split(",").map((part) => parseFloat(part));
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    return colour;
}

/** The words of a line split to fit a width (a word wider than it stays whole on its own line). */
export function wrap(text, width, measure) {
    const words = String(text ?? "").split(/\s+/).filter(Boolean);
    const lines = [];
    let line = "";
    for (const word of words) {
        const next = line ? `${line} ${word}` : word;
        if (line && measure(next) > width) {
            lines.push(line);
            line = word;
        } else line = next;
    }
    if (line) lines.push(line);
    return lines.length ? lines : [""];
}

/** A measuring function for a font on a canvas context (or on a fresh one). */
export function measurer(ctx = null) {
    const context = ctx ?? globalThis.document?.createElement("canvas").getContext("2d") ?? null;
    // Without a context that measures (a test's stand-in), about half an em a letter
    const guess = (font, text) => String(text).length * (parseFloat(/(\d+(\.\d+)?)px/.exec(font)?.[1]) || 16) * 0.52;
    return (font) => (text) => {
        if (!context) return guess(font, text);
        context.font = font;
        const width = context.measureText?.(text)?.width;
        return Number.isFinite(width) ? width : guess(font, text);
    };
}

/** A text's width in the context's font (guessed where the context can't measure). */
function textWidth(ctx, text) {
    return measurer(ctx)(ctx.font ?? "16px serif")(text);
}

export const Report = Object.freeze({
    // ------------------------------------------------------------------ the legend

    /**
     * The legend's keys in columns: up to ROWS a column, up to COLUMNS columns, filled a column at
     * a time; the rest counted ("and N others").
     * @param {{title: string, items: {colour: string, label: string}[]}} legend
     */
    legendColumns(legend) {
        const { ROWS, COLUMNS } = FILRODENSWMB.LOCAL.EXPORT.LEGEND;
        const shown = legend.items.slice(0, ROWS * COLUMNS);
        const columns = [];
        for (let at = 0; at < shown.length; at += ROWS) columns.push(shown.slice(at, at + ROWS));
        return { columns, more: Math.max(0, legend.items.length - shown.length) };
    },

    /**
     * Draws the legend in the top-right corner of a canvas, sized from its height (as the title box).
     * @param {CanvasRenderingContext2D} ctx
     * @param {{title: string, items: {colour: string, label: string}[]}} legend
     * @param {object} style - The look: paper, ink, font.
     * @param {string} [othersText] - "and 3 others", when some are left out.
     */
    drawLegend(ctx, legend, style, othersText = "") {
        if (!legend?.items?.length) return;
        const wPx = ctx.canvas.width;
        const hPx = ctx.canvas.height;
        const fs = hPx / 42;
        const { columns, more } = this.legendColumns(legend);
        const key = fs * 0.62;
        const row = fs * 0.95;
        const swatch = fs * 0.62;
        const gap = fs * 0.4;
        const pad = fs * 0.7;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.font = `${fs * 0.75}px ${style.font}`;
        const titleW = textWidth(ctx, legend.title);
        ctx.font = `${key}px ${style.font}`;
        const widths = columns.map((items) => swatch + gap + Math.max(...items.map((item) => textWidth(ctx, item.label))));
        ctx.font = `italic ${key}px ${style.font}`;
        const othersW = more ? textWidth(ctx, othersText) : 0;
        const keysW = widths.reduce((a, b) => a + b, 0) + fs * 1.1 * (widths.length - 1);
        const boxW = Math.min(wPx - 2 * fs, Math.max(titleW, keysW, othersW) + 2 * pad);
        const rows = Math.max(...columns.map((items) => items.length));
        const boxH = pad + fs * 1.05 + rows * row + (more ? row : 0) + pad * 0.6;
        const x = wPx - fs - boxW;
        const y = fs * 0.8;
        ctx.fillStyle = rgba(style.paper, 0.9);
        ctx.strokeStyle = style.ink;
        ctx.lineWidth = 1;
        ctx.fillRect(x, y, boxW, boxH);
        ctx.strokeRect(x, y, boxW, boxH);
        ctx.fillStyle = style.ink;
        ctx.textBaseline = "alphabetic";
        ctx.font = `${fs * 0.75}px ${style.font}`;
        ctx.fillText(legend.title, x + pad, y + pad + fs * 0.6);
        ctx.font = `${key}px ${style.font}`;
        let left = x + pad;
        columns.forEach((items, column) => {
            items.forEach((item, index) => {
                const top = y + pad + fs * 1.05 + index * row;
                ctx.fillStyle = item.colour;
                ctx.fillRect(left, top + (row - swatch) / 2, swatch, swatch);
                ctx.strokeStyle = rgba(style.ink, 0.6);
                ctx.strokeRect(left, top + (row - swatch) / 2, swatch, swatch);
                ctx.fillStyle = style.ink;
                ctx.fillText(item.label, left + swatch + gap, top + row * 0.7);
            });
            left += widths[column] + fs * 1.1;
        });
        if (more) {
            ctx.font = `italic ${key}px ${style.font}`;
            ctx.fillText(othersText, x + pad, y + pad + fs * 1.05 + rows * row + row * 0.7);
        }
        ctx.restore();
    },

    // ------------------------------------------------------------------ the sheet

    /**
     * How much the side column grows beside a map part: 1 at the least, up to SIDE_SHARE of the
     * sheet's width, but never taller than the map part.
     * @param {{width: number, height: number}} part
     * @param {number} blockHeight - The block's height at the least size.
     */
    factor(part, blockHeight) {
        const { SIDE_PX, INSET_PX, GAP_PX, MARGIN_PX, SIDE_SHARE } = REPORT();
        // The column's share of the sheet: SIDE × f = share × (part + f × (2 × MARGIN + GAP + SIDE))
        const byShare = (SIDE_SHARE * part.width) / (SIDE_PX - SIDE_SHARE * (2 * MARGIN_PX + GAP_PX + SIDE_PX));
        const byHeight = part.height / (INSET_PX + GAP_PX + blockHeight);
        return Math.max(1, Math.min(byShare, byHeight));
    },

    /**
     * The sheet's layout: the map part, and beside it the inset over the block, in pixels, with
     * the column's factor (see `factor`). `below` is kept for the dialogue's small drawing (always
     * beside since Ken, 2026-11-26).
     * @param {{width: number, height: number}} part - The map part.
     * @param {number} blockHeight - The information block's height at the least size.
     */
    layout(part, blockHeight) {
        const { SIDE_PX, INSET_PX, GAP_PX, MARGIN_PX } = REPORT();
        const factor = this.factor(part, blockHeight);
        const grow = (px) => Math.round(px * factor);
        const margin = grow(MARGIN_PX);
        const gap = grow(GAP_PX);
        const side = { width: grow(SIDE_PX), inset: grow(INSET_PX), block: grow(blockHeight) };
        const column = side.inset + gap + side.block;
        const inner = Math.max(part.height, column);
        const left = margin + part.width + gap;
        return {
            below: false,
            factor,
            side: side.width,
            width: left + side.width + margin,
            height: 2 * margin + inner,
            map: { x: margin, y: margin + Math.round((inner - part.height) / 2), ...part },
            inset: { x: left, y: margin, width: side.width, height: side.inset },
            block: { x: left, y: margin + side.inset + gap, width: side.width, height: side.block },
        };
    },

    /**
     * The sheet drawn: the paper, the map part, the inset and the block, each edged in ink.
     * @param {CanvasRenderingContext2D} ctx - Of a canvas of the layout's size.
     * @param {object} layout
     * @param {{map: CanvasImageSource, inset: (ctx, box) => void, block: (ctx, box) => void}} parts
     * @param {object} style
     */
    drawSheet(ctx, layout, parts, style) {
        const factor = layout.factor ?? 1;
        ctx.save();
        ctx.fillStyle = style.paper;
        ctx.fillRect(0, 0, layout.width, layout.height);
        ctx.drawImage(parts.map, layout.map.x, layout.map.y);
        // The inset and the block drawn at the least size, scaled up with the column
        for (const [draw, box] of [
            [parts.inset, layout.inset],
            [parts.block, layout.block],
        ]) {
            ctx.save();
            ctx.translate(box.x, box.y);
            ctx.scale(factor, factor);
            draw(ctx, { x: 0, y: 0, width: box.width / factor, height: box.height / factor });
            ctx.restore();
        }
        ctx.strokeStyle = style.ink;
        ctx.lineWidth = Math.max(1, Math.round(factor));
        for (const box of [layout.map, layout.inset, layout.block]) ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.width - 1, box.height - 1);
        ctx.restore();
    },

    // ------------------------------------------------------------------ the information block

    /**
     * The information block's rows, wrapped to its width: the heading, the totals, the cultures,
     * the trade groups, the supply in a normal year and the foot.
     * @param {object} words
     * @param {string} words.heading - "Castford".
     * @param {string} words.sub - "market town of 2,900 people".
     * @param {object} words.panel - Households.js panelOf.
     * @param {{totals: string, cultures: string, trades: string, supply: string}} words.titles
     * @param {string|null} [words.standIn] - The supply's stand-in line, if it is one.
     * @param {string} words.foot - "Seed … · kept …".
     * @param {string} face - The look's face.
     * @param {(font: string) => (text: string) => number} measure
     */
    blockRows({ heading, sub, panel, titles, standIn = null, foot }, face, measure) {
        const { SIDE_PX, PAD_PX, TYPE } = REPORT();
        const width = SIDE_PX - 2 * PAD_PX;
        const body = `${TYPE.body}px ${face}`;
        const rows = [];
        const text = (value, font = body, kind = "text") => {
            for (const line of wrap(value, kind === "swatch" ? width - TYPE.body * 1.3 : width, measure(font))) rows.push({ kind, text: line, font, height: TYPE.line });
        };
        rows.push({ kind: "heading", text: heading, font: `${TYPE.heading}px ${face}`, height: TYPE.heading * 1.35 });
        for (const line of wrap(sub, width, measure(`italic ${TYPE.sub}px ${face}`))) rows.push({ kind: "text", text: line, font: `italic ${TYPE.sub}px ${face}`, height: TYPE.line });
        const title = (value) => rows.push({ kind: "title", text: value, font: `bold ${TYPE.title}px ${face}`, height: TYPE.line + 10 });
        title(titles.totals);
        text(panel.totals.map((total) => `${total.value} ${total.label}`).join(" · "));
        if (panel.country) text(panel.country);
        if (panel.cultures.length) {
            title(titles.cultures);
            for (const culture of panel.cultures) {
                const lines = wrap(culture.label, width - TYPE.body * 1.3, measure(body));
                lines.forEach((line, index) => rows.push({ kind: "swatch", text: line, colour: index === 0 ? culture.colour : null, font: body, height: TYPE.line }));
            }
        }
        const groups = [...panel.groups, ...(panel.moreGroups ?? [])];
        if (groups.length) {
            title(titles.trades);
            for (let at = 0; at < groups.length; at += 2) rows.push({ kind: "pairs", cells: groups.slice(at, at + 2).map((group) => [group.label, group.count]), font: body, height: TYPE.line });
        }
        if (panel.supply) {
            title(titles.supply);
            if (standIn) text(standIn, `italic ${TYPE.body}px ${face}`);
            for (const row of panel.supply.rows) rows.push({ kind: "pair", cells: [[row.label, row.value]], font: body, height: TYPE.line });
        }
        rows.push({ kind: "rule", height: 18 });
        for (const line of wrap(foot, width, measure(`italic ${TYPE.foot}px ${face}`))) rows.push({ kind: "text", text: line, font: `italic ${TYPE.foot}px ${face}`, height: TYPE.foot * 1.6 });
        return rows;
    },

    /** The block's height: its rows and its padding. */
    blockHeight(rows) {
        const { PAD_PX } = REPORT();
        return Math.ceil(2 * PAD_PX + rows.reduce((sum, row) => sum + row.height, 0));
    },

    /** Draws the block's rows in its box, in the map's look. */
    drawBlock(ctx, rows, box, style) {
        const { PAD_PX, TYPE } = REPORT();
        ctx.save();
        ctx.fillStyle = style.paper;
        ctx.fillRect(box.x, box.y, box.width, box.height);
        ctx.textBaseline = "alphabetic";
        const left = box.x + PAD_PX;
        const right = box.x + box.width - PAD_PX;
        const half = (right - left - PAD_PX) / 2;
        let y = box.y + PAD_PX;
        for (const row of rows) {
            const base = y + row.height * 0.72;
            ctx.font = row.font ?? "";
            ctx.fillStyle = style.ink;
            if (row.kind === "heading" || row.kind === "text") ctx.fillText(row.text, left, base);
            else if (row.kind === "title") {
                ctx.fillText(row.text.toLocaleUpperCase(), left, base + 4);
                ctx.fillStyle = rgba(style.ink, 0.35);
                ctx.fillRect(left, base + 9, right - left, 1);
            } else if (row.kind === "swatch") {
                const side = TYPE.body * 0.85;
                if (row.colour) {
                    ctx.fillStyle = row.colour;
                    ctx.fillRect(left, base - side + 2, side, side);
                    ctx.strokeStyle = rgba(style.ink, 0.6);
                    ctx.strokeRect(left, base - side + 2, side, side);
                }
                ctx.fillStyle = style.ink;
                ctx.fillText(row.text, left + TYPE.body * 1.3, base);
            } else if (row.kind === "pair" || row.kind === "pairs") {
                row.cells.forEach(([label, value], index) => {
                    const start = row.kind === "pair" ? left : left + index * (half + PAD_PX);
                    const end = row.kind === "pair" ? right : start + half;
                    ctx.textAlign = "left";
                    ctx.fillText(label, start, base);
                    ctx.textAlign = "right";
                    ctx.fillText(value, end, base);
                });
                ctx.textAlign = "left";
            } else if (row.kind === "rule") {
                ctx.fillStyle = rgba(style.ink, 0.35);
                ctx.fillRect(left, y + row.height / 2, right - left, 1);
            }
            y += row.height;
        }
        ctx.restore();
    },

    // ------------------------------------------------------------------ the inset

    /**
     * The box of the Surface map the inset shows, in its pixels: the frame, its country cells and
     * the ways its food comes and goes along, padded, at least INSET_FRAMES frames across and wide
     * enough not to be drawn past INSET_MAX_SCALE, of the inset's aspect.
     * @param {{x: number, y: number}} at - The settlement (its pin).
     * @param {{width: number, height: number}} frame - The frame in the map's pixels.
     * @param {number[][]} points - The cells' and the ways' points, [x, y].
     */
    insetBox(at, frame, points = []) {
        const { SIDE_PX, INSET_PX, INSET_FRAMES, INSET_PAD, INSET_MAX_SCALE } = REPORT();
        let x0 = at.x - frame.width / 2;
        let x1 = at.x + frame.width / 2;
        let y0 = at.y - frame.height / 2;
        let y1 = at.y + frame.height / 2;
        for (const [x, y] of points) {
            if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
            x0 = Math.min(x0, x);
            x1 = Math.max(x1, x);
            y0 = Math.min(y0, y);
            y1 = Math.max(y1, y);
        }
        const cx = (x0 + x1) / 2;
        const cy = (y0 + y1) / 2;
        let width = Math.max((x1 - x0) * (1 + 2 * INSET_PAD), frame.width * INSET_FRAMES, SIDE_PX / INSET_MAX_SCALE);
        let height = Math.max((y1 - y0) * (1 + 2 * INSET_PAD), frame.height * INSET_FRAMES);
        const aspect = SIDE_PX / INSET_PX;
        if (width / height > aspect) height = width / aspect;
        else width = height * aspect;
        return { x: cx - width / 2, y: cy - height / 2, width, height };
    },

    /**
     * Draws the inset in its box: the World studio's picture of the map, then over it the frame,
     * the country cells (soft dots by what they give), the ways food comes in and goes out (by
     * colour, each line's width by its amount) and a key; or a line saying where the supply lines
     * are when they can't be drawn here. The places are named by the map's own labels.
     * @param {CanvasRenderingContext2D} ctx
     * @param {object} box - The inset's box on the sheet.
     * @param {object} inset
     * @param {CanvasImageSource|null} inset.picture - The map's picture of `inset.area`, drawn at
     *   `inset.density` of its pixels to one of the box's (the column's factor; 1 by default).
     * @param {{x: number, y: number, width: number, height: number}} inset.area - In the map's pixels.
     * @param {number} inset.scale
     * @param {{x: number, y: number}} inset.at - The settlement.
     * @param {{width: number, height: number}} inset.frame - In the map's pixels.
     * @param {{x: number, y: number, amount: number}[]} [inset.cells]
     * @param {{name: string, amount: number, way: number[][]}[]} [inset.ways] - Food coming in.
     * @param {{name: string, amount: number, way: number[][]}|null} [inset.out] - Food sold on.
     * @param {object} style
     * @param {{foodIn: string, soldOn: string, note?: string|null}} words
     */
    drawInset(ctx, box, inset, style, words) {
        const COLOURS = { in: "#2f6c9e", out: "#b0532a", cells: "rgba(78, 128, 60, 0.42)" };
        ctx.save();
        ctx.beginPath();
        ctx.rect(box.x, box.y, box.width, box.height);
        ctx.clip();
        ctx.fillStyle = "#dfe3d2";
        ctx.fillRect(box.x, box.y, box.width, box.height);
        const { picture, area, scale } = inset;
        const density = inset.density ?? 1;
        // The picture centred in the box (a map smaller than the box leaves paper round it)
        const shownW = picture ? picture.width / density : 0;
        const shownH = picture ? picture.height / density : 0;
        const offX = box.x + (picture ? (box.width - shownW) / 2 : 0);
        const offY = box.y + (picture ? (box.height - shownH) / 2 : 0);
        if (picture) ctx.drawImage(picture, offX, offY, shownW, shownH);
        const to = ([x, y]) => [offX + (x - area.x) * scale, offY + (y - area.y) * scale];
        if (area) {
            // The country cells, sized by what they give
            const cells = inset.cells ?? [];
            const most = Math.max(1e-9, ...cells.map((cell) => cell.amount ?? 0));
            ctx.fillStyle = COLOURS.cells;
            for (const cell of cells) {
                const [x, y] = to([cell.x, cell.y]);
                ctx.beginPath();
                ctx.arc(x, y, 2 + 5 * Math.sqrt(Math.max(0, cell.amount ?? 0) / most), 0, Math.PI * 2);
                ctx.fill();
            }
            // The ways, by their amounts
            const lines = [...(inset.ways ?? []).map((way) => ({ ...way, colour: COLOURS.in })), ...(inset.out ? [{ ...inset.out, colour: COLOURS.out }] : [])].filter((way) => way.way?.length > 1);
            const biggest = Math.max(1e-9, ...lines.map((way) => Math.abs(way.amount ?? 0)));
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            for (const way of lines) {
                ctx.strokeStyle = way.colour;
                ctx.lineWidth = 1.5 + 4.5 * Math.sqrt(Math.abs(way.amount ?? 0) / biggest);
                ctx.beginPath();
                way.way.forEach((point, index) => {
                    const [x, y] = to(point);
                    if (index === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                });
                ctx.stroke();
            }
            // The frame (at least FRAME_MIN_PX across, so a small town's still shows), in ink on a paper edge
            const FRAME_MIN_PX = 12;
            const [cx, cy] = to([inset.at.x, inset.at.y]);
            const fw = Math.max(FRAME_MIN_PX, inset.frame.width * scale);
            const fh = Math.max(FRAME_MIN_PX * 0.75, inset.frame.height * scale);
            ctx.strokeStyle = rgba(style.paper, 0.9);
            ctx.lineWidth = 4;
            ctx.strokeRect(cx - fw / 2, cy - fh / 2, fw, fh);
            ctx.strokeStyle = style.ink;
            ctx.lineWidth = 2;
            ctx.strokeRect(cx - fw / 2, cy - fh / 2, fw, fh);
        }
        // The key, or where the supply lines are
        ctx.textBaseline = "middle";
        ctx.font = `14px ${style.font}`;
        const bottom = box.y + box.height - 14;
        if (words.note) {
            const tw = textWidth(ctx, words.note);
            ctx.fillStyle = rgba(style.paper, 0.9);
            ctx.fillRect(box.x + 8, bottom - 12, tw + 16, 24);
            ctx.fillStyle = style.ink;
            ctx.fillText(words.note, box.x + 16, bottom);
        } else if ((inset.ways ?? []).length || inset.out) {
            const keys = [
                [COLOURS.in, words.foodIn],
                ...(inset.out ? [[COLOURS.out, words.soldOn]] : []),
            ];
            const widths = keys.map(([, label]) => 26 + textWidth(ctx, label) + 16);
            ctx.fillStyle = rgba(style.paper, 0.9);
            ctx.fillRect(box.x + 8, bottom - 12, widths.reduce((a, b) => a + b, 0) + 8, 24);
            let x = box.x + 16;
            keys.forEach(([colour, label], index) => {
                ctx.strokeStyle = colour;
                ctx.lineWidth = 4;
                ctx.beginPath();
                ctx.moveTo(x, bottom);
                ctx.lineTo(x + 20, bottom);
                ctx.stroke();
                ctx.fillStyle = style.ink;
                ctx.fillText(label, x + 26, bottom);
                x += widths[index];
            });
        }
        ctx.restore();
    },
});
