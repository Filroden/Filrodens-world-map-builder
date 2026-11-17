/**
 * A cartouche (a title panel) as a list of shapes and where its title and subtitle sit, drawn from
 * scratch: no PIXI, no DOM, so the canvas (DrawnDecoration) and the inspector's thumbnails draw the
 * same panel, and it is tested in Node. Shapes are as in CompassGeometry: paths (M, L, C, Q, Z) or
 * circles, back to front, in map pixels at scale 1, centred on the cartouche, y down.
 *
 * The panel is sized to its text: `fitTitle` decides the title's size and lines from a measure
 * function (the canvas measures in the face the title is drawn in), then `cartouche` draws the
 * design around it.
 */

/** How far a cubic's handles reach to draw a quarter circle. */
const K = 0.5522847498;

/**
 * The distance from one line's baseline to the next, as a multiple of its size: room for
 * capitals above and descenders below, so the two lines of a long title keep clear of each other.
 */
export const TITLE_LEADING = 1.3;

/** The least a title is shrunk to fit before it is broken onto two lines, as a share of its size. */
export const MIN_SHRINK = 0.6;

function polygon(points, style) {
    const path = points.map((p, i) => [i === 0 ? "M" : "L", p[0], p[1]]);
    path.push(["Z"]);
    return { path, ...style };
}

/** A rectangle with rounded corners of radius r. */
function roundRect(x, y, w, h, r) {
    return [
        ["M", x + r, y],
        ["L", x + w - r, y],
        ["C", x + w - r + r * K, y, x + w, y + r - r * K, x + w, y + r],
        ["L", x + w, y + h - r],
        ["C", x + w, y + h - r + r * K, x + w - r + r * K, y + h, x + w - r, y + h],
        ["L", x + r, y + h],
        ["C", x + r - r * K, y + h, x, y + h - r + r * K, x, y + h - r],
        ["L", x, y + r],
        ["C", x, y + r - r * K, x + r - r * K, y, x + r, y],
        ["Z"],
    ];
}

/** A rectangle whose corners are cut inwards by quarter circles of radius r. */
function notchedRect(x, y, w, h, r) {
    const x1 = x + w;
    const y1 = y + h;
    return [
        ["M", x + r, y],
        ["L", x1 - r, y],
        ["C", x1 - r, y + r * K, x1 - r * K, y + r, x1, y + r],
        ["L", x1, y1 - r],
        ["C", x1 - r * K, y1 - r, x1 - r, y1 - r * K, x1 - r, y1],
        ["L", x + r, y1],
        ["C", x + r, y1 - r * K, x + r * K, y1 - r, x, y1 - r],
        ["L", x, y + r],
        ["C", x + r * K, y + r, x + r, y + r * K, x + r, y],
        ["Z"],
    ];
}

/**
 * Fits a title in a width: at its own size if it fits; else shrunk to fit, down to MIN_SHRINK of
 * its size; else broken onto two lines at the space that leaves the longer line shortest, shrunk
 * again if need be. A title too long even then is drawn at the smallest size, its panel widened to
 * hold it rather than the text spilling out, and reported as overflowing, so the inspector can say
 * so.
 *
 * @param {function(string, number): number} measure - A text's width at a size.
 * @param {string} title
 * @param {number} size - The title's size, before fitting.
 * @param {{minWidth: number, maxWidth: number}} widths - The text's narrowest and widest.
 * @returns {{size: number, lines: string[], textWidth: number, overflow: boolean}}
 */
export function fitTitle(measure, title, size, { minWidth, maxWidth }) {
    const floor = size * MIN_SHRINK;
    const one = measure(title, size);
    if (one <= maxWidth) return { size, lines: [title], textWidth: Math.max(minWidth, one), overflow: false };
    const shrunk = (size * maxWidth) / one;
    if (shrunk >= floor) return { size: shrunk, lines: [title], textWidth: Math.max(minWidth, measure(title, shrunk)), overflow: false };
    const words = title.split(" ").filter(Boolean);
    let best = null;
    for (let i = 1; i < words.length; i++) {
        const lines = [words.slice(0, i).join(" "), words.slice(i).join(" ")];
        const widest = Math.max(...lines.map((line) => measure(line, size)));
        if (!best || widest < best.widest) best = { lines, widest };
    }
    if (!best) {
        const width = measure(title, floor);
        return { size: floor, lines: [title], textWidth: Math.max(minWidth, width), overflow: width > maxWidth + 0.5 };
    }
    const fitted = Math.max(floor, Math.min(size, (size * maxWidth) / best.widest));
    const widest = Math.max(...best.lines.map((line) => measure(line, fitted)));
    return { size: fitted, lines: best.lines, textWidth: Math.max(minWidth, widest), overflow: widest > maxWidth + 0.5 };
}

/**
 * A cartouche around a title and, if it has one, a subtitle.
 *
 * @param {object} panel
 * @param {"plaque"|"ribbon"|"frame"} panel.design
 * @param {number} panel.textWidth - The text's width (see fitTitle; widened for a subtitle).
 * @param {number} panel.titleSize - The title's size, once fitted.
 * @param {number} [panel.lines] - The title's lines (1 or 2).
 * @param {number} [panel.subtitleSize] - 0 or absent for no subtitle.
 * @param {{fill: string, line: string, accent: string, shade: string}} panel.colors
 * @returns {{shapes: object[], title: {x: number, y: number, size: number}, subtitle: {x: number, y: number, size: number}|null, width: number, height: number}}
 */
export function cartouche(panel) {
    const c = panel.colors;
    const s = panel.titleSize;
    const sub = panel.subtitleSize || 0;
    // The text is stacked by what shows of it (see DrawnDecoration: from the top of the capitals
    // to the descenders, about a size high a line): the title's lines, a line apart, then a gap
    // (where the frame's rule sits), then the subtitle; with room around them inside the
    // panel's inner rule
    const titleBlock = s * (1 + ((panel.lines ?? 1) - 1) * TITLE_LEADING);
    const subtitleBlock = sub;
    const gap = sub ? s * 0.5 : 0;
    const pad = s * 0.5;
    const H = pad * 2 + titleBlock + gap + subtitleBlock;
    const lw = Math.max(0.8, s * 0.06);
    const shapes = [];
    // The middle of the title, of the gap, and of the subtitle
    const titleY = -H / 2 + pad + titleBlock / 2;
    const gapY = titleY + titleBlock / 2 + gap / 2;
    const subtitleY = sub ? gapY + gap / 2 + subtitleBlock / 2 : 0;

    if (panel.design === "ribbon") {
        // The band's long edges bow upwards like a scroll held at both ends, so the straight text
        // has less room at the top corners and the bottom middle: the band is taller by its bow,
        // which leaves the text its padding at both
        const bow = H * 0.12;
        const B = H + bow;
        const W = panel.textWidth + s * 1.6;
        const drop = B * 0.38; // How far the tails hang below the band
        const tail = B * 1.05; // How far each tail reaches past the band
        const tuck = B * 0.4; // The part of each tail behind the band
        const notch = B * 0.35;
        for (const side of [-1, 1]) {
            const inner = side * (W / 2 - tuck);
            const outer = side * (W / 2 + tail);
            const top = -B / 2 + drop;
            const bottom = B / 2 + drop;
            // The tail, swallow-tailed at its end
            shapes.push(
                polygon(
                    [
                        [inner, top],
                        [outer, top],
                        [outer - side * notch, (top + bottom) / 2],
                        [outer, bottom],
                        [inner, bottom],
                    ],
                    { fill: c.shade, stroke: c.line, width: lw },
                ),
            );
            // The fold where the band turns back into the tail
            shapes.push(
                polygon(
                    [
                        [side * (W / 2), B / 2],
                        [side * (W / 2 - tuck), B / 2],
                        [side * (W / 2 - tuck), bottom],
                    ],
                    { fill: c.line, stroke: c.line, width: lw },
                ),
            );
        }
        // The band (no inner rules: the text is straight, and curved rules beside it would clash)
        shapes.push({
            path: [
                ["M", -W / 2, -B / 2],
                ["Q", 0, -B / 2 - bow * 2, W / 2, -B / 2],
                ["L", W / 2, B / 2],
                ["Q", 0, B / 2 - bow * 2, -W / 2, B / 2],
                ["Z"],
            ],
            fill: c.fill,
            stroke: c.line,
            width: lw * 1.4,
        });
        // The tails hang below
        return finish(W + tail * 2, B + drop * 2);
    }

    if (panel.design === "frame") {
        const padX = s * 0.9;
        const W = panel.textWidth + padX * 2;
        const r = Math.min(H * 0.28, s * 0.5);
        shapes.push({ path: notchedRect(-W / 2, -H / 2, W, H, r), fill: c.fill, stroke: c.line, width: lw * 1.6 });
        const inset = s * 0.16;
        shapes.push({ path: notchedRect(-W / 2 + inset, -H / 2 + inset, W - inset * 2, H - inset * 2, Math.max(0, r - inset * 0.6)), stroke: c.accent, width: lw * 0.8 });
        const d = s * 0.32;
        for (const side of [-1, 1]) {
            const x = side * (W / 2);
            shapes.push(
                polygon(
                    [
                        [x, -d],
                        [x + side * d * 1.1, 0],
                        [x, d],
                        [x - side * d * 1.1, 0],
                    ],
                    { fill: c.accent, stroke: c.line, width: lw },
                ),
            );
        }
        if (sub) {
            const ruleY = gapY;
            const half = Math.min(panel.textWidth * 0.35, W / 2 - padX);
            shapes.push({ path: [["M", -half, ruleY], ["L", half, ruleY]], stroke: c.accent, width: lw * 0.7 });
        }
        return finish(W + d * 2.2, H);
    }

    // A plaque: a rounded panel with an inner rule and a knob at each end
    const W = panel.textWidth + s * 1.8;
    shapes.push({ path: roundRect(-W / 2, -H / 2, W, H, s * 0.3), fill: c.fill, stroke: c.line, width: lw * 1.4 });
    const inset = s * 0.18;
    shapes.push({ path: roundRect(-W / 2 + inset, -H / 2 + inset, W - inset * 2, H - inset * 2, s * 0.2), stroke: c.accent, width: lw * 0.8 });
    const knob = s * 0.42;
    for (const side of [-1, 1]) shapes.push({ circle: [(side * W) / 2, 0, knob], fill: c.fill, stroke: c.line, width: lw * 1.4 });
    return finish(W + knob * 2, H);

    function finish(width, height, dy = 0) {
        return {
            shapes,
            title: { x: 0, y: titleY + dy, size: s },
            subtitle: sub ? { x: 0, y: subtitleY + dy, size: sub } : null,
            width,
            height,
        };
    }
}
