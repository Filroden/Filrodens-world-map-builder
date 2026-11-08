/**
 * A compass rose as a list of shapes and letter placements, drawn from scratch: no PIXI, no DOM,
 * so the canvas (DrawnDecoration) and the inspector's thumbnails draw the same rose, and it is
 * tested in Node.
 *
 * A shape is `{ path: [[command, ...numbers]], fill?, stroke?, width?, alpha? }`, the commands
 * M, L, C, Q and Z as in SVG, or `{ circle: [cx, cy, r], fill?, stroke?, width?, alpha? }`. Shapes
 * are listed back to front. Coordinates are map pixels at scale 1, centred on the rose, y down; a
 * bearing is degrees clockwise from north.
 */

/** A point at a bearing and a distance from the centre. */
function polar(r, bearing) {
    const a = (bearing * Math.PI) / 180;
    return [r * Math.sin(a), -r * Math.cos(a)];
}

function polygon(points, style) {
    const path = points.map((p, i) => [i === 0 ? "M" : "L", p[0], p[1]]);
    path.push(["Z"]);
    return { path, ...style };
}

/**
 * The tiers of points a rose can have, largest first: a rose of n points draws every tier up to
 * n, the smaller tiers first so the larger lie on top. `tip` is a point's length and `side` the
 * distance at which its sides meet the hub, both in radii; `spread` is the bearing either side of
 * the point at which they meet.
 */
const TIERS = Object.freeze([
    Object.freeze({ count: 4, offset: 0, tip: 0.9, side: 0.14, spread: 45 }),
    Object.freeze({ count: 4, offset: 45, tip: 0.64, side: 0.11, spread: 45 }),
    Object.freeze({ count: 8, offset: 22.5, tip: 0.5, side: 0.06, spread: 22.5 }),
    Object.freeze({ count: 16, offset: 11.25, tip: 0.4, side: 0.035, spread: 11.25 }),
]);

const TIERS_FOR_POINTS = Object.freeze({ 4: 1, 8: 2, 16: 3, 32: 4 });

/** The letters a rose may carry, by bearing; their text comes from the caller (the interface's language). */
const CARDINALS = Object.freeze([
    ["N", 0],
    ["E", 90],
    ["S", 180],
    ["W", 270],
]);
const INTERCARDINALS = Object.freeze([
    ["NE", 45],
    ["SE", 135],
    ["SW", 225],
    ["NW", 315],
]);

/** A point in two tones: the half on its clockwise side in the dark tone, as roses are shaded. */
function twoTonePoint(bearing, tier, radius, colors, width) {
    const tip = polar(tier.tip * radius, bearing);
    const left = polar(tier.side * radius, bearing - tier.spread);
    const right = polar(tier.side * radius, bearing + tier.spread);
    const stroke = { stroke: colors.line, width };
    return [polygon([[0, 0], tip, left], { fill: colors.light, ...stroke }), polygon([[0, 0], tip, right], { fill: colors.dark, ...stroke })];
}

/** A fleur-de-lis standing on (cx, cy), `size` tall, upright; drawn from scratch. */
function fleurDeLis(cx, cy, size, style) {
    const petal = [
        ["M", 0.07, -0.3],
        ["C", 0.12, -0.5, 0.3, -0.66, 0.44, -0.6],
        ["C", 0.54, -0.55, 0.52, -0.38, 0.4, -0.36],
        ["C", 0.32, -0.35, 0.3, -0.42, 0.34, -0.46],
        ["C", 0.24, -0.44, 0.2, -0.36, 0.2, -0.3],
        ["Z"],
    ];
    const centre = [
        ["M", 0, -1],
        ["C", 0.16, -0.82, 0.2, -0.56, 0.08, -0.3],
        ["L", -0.08, -0.3],
        ["C", -0.2, -0.56, -0.16, -0.82, 0, -1],
        ["Z"],
    ];
    const band = [["M", -0.24, -0.31], ["L", 0.24, -0.31], ["L", 0.24, -0.22], ["L", -0.24, -0.22], ["Z"]];
    const foot = [
        ["M", -0.07, -0.22],
        ["L", 0.07, -0.22],
        ["C", 0.08, -0.12, 0.14, -0.06, 0.2, -0.02],
        ["L", -0.2, -0.02],
        ["C", -0.14, -0.06, -0.08, -0.12, -0.07, -0.22],
        ["Z"],
    ];
    const mirror = (path) => path.map(([command, ...numbers]) => [command, ...numbers.map((value, i) => (i % 2 === 0 ? -value : value))]);
    const place = (path) => ({ path: path.map(([command, ...numbers]) => [command, ...numbers.map((value, i) => (i % 2 === 0 ? cx + value * size : cy + value * size))]), ...style });
    return [place(petal), place(mirror(petal)), place(centre), place(foot), place(band)];
}

/**
 * The shapes and letters of a compass rose.
 *
 * @param {object} rose
 * @param {number} rose.radius - In map pixels at scale 1.
 * @param {"classic"|"mariner"|"arrow"} rose.design
 * @param {4|8|16|32} [rose.points]
 * @param {0|1|2} [rose.rings]
 * @param {boolean} [rose.degreeRing]
 * @param {"letter"|"fleur"} [rose.north] - The north marker: its letter or a fleur-de-lis.
 * @param {"none"|"cardinal"|"all"} [rose.letters]
 * @param {number} [rose.letterSize] - The cardinal letters' height, in radii.
 * @param {boolean} [rose.backing] - A disc behind the rose, so it reads over a busy map.
 * @param {number} [rose.backingOpacity]
 * @param {{light: string, dark: string, line: string, accent: string, letter: string, backing: string}} rose.colors
 * @param {Object<string, string>} [letterText] - Each letter's text by its key (N, E, S, W, NE...).
 * @returns {{shapes: object[], letters: {key: string, text: string, x: number, y: number, size: number, bearing: number}[]}}
 */
export function compassRose(rose, letterText = {}) {
    const radius = rose.radius;
    const colors = rose.colors;
    const width = Math.max(0.6, radius * 0.012);
    const size = (rose.letterSize ?? 0.22) * radius;
    const shapes = [];
    const letters = [];
    const letter = (key, bearing, distance, letterSize) => letters.push({ key, text: letterText[key] ?? key, ...xy(polar(distance, bearing)), size: letterSize, bearing });

    if (rose.design === "arrow") {
        // A single north arrow, notched at its base, in two tones
        const tip = [0, -radius];
        const left = [-0.32 * radius, 0.42 * radius];
        const right = [0.32 * radius, 0.42 * radius];
        const notch = [0, 0.2 * radius];
        if (rose.backing) shapes.push({ circle: [0, 0.05 * radius, 0.66 * radius], fill: colors.backing, alpha: rose.backingOpacity ?? 0.85 });
        if (rose.rings >= 1) shapes.push({ circle: [0, 0.05 * radius, 0.62 * radius], stroke: colors.line, width: width * 1.5 });
        shapes.push(polygon([tip, left, notch], { fill: colors.light, stroke: colors.line, width: width * 1.5 }));
        shapes.push(polygon([tip, notch, right], { fill: colors.dark, stroke: colors.line, width: width * 1.5 }));
        if (rose.letters !== "none") letter("N", 0, 1.24 * radius, size * 1.6);
        return { shapes, letters };
    }

    const tiers = TIERS_FOR_POINTS[rose.points] ?? 2;
    const ring = 0.93 * radius;
    const outerRing = ring + 0.045 * radius;

    if (rose.backing) shapes.push({ circle: [0, 0, rose.rings >= 2 ? outerRing : ring], fill: colors.backing, alpha: rose.backingOpacity ?? 0.85 });
    // Rings and the degree ring lie behind the points
    if (rose.rings >= 1) shapes.push({ circle: [0, 0, ring], stroke: colors.line, width: width * 2 });
    if (rose.rings >= 2) shapes.push({ circle: [0, 0, outerRing], stroke: colors.line, width });
    if (rose.degreeRing) {
        const inner = ring - 0.06 * radius;
        shapes.push({ circle: [0, 0, inner], stroke: colors.line, width });
        for (let bearing = 0; bearing < 360; bearing += 5) {
            const length = bearing % 45 === 0 ? 1 : bearing % 15 === 0 ? 0.7 : 0.45;
            shapes.push({ path: [["M", ...polar(inner, bearing)], ["L", ...polar(inner + (ring - inner) * length, bearing)]], stroke: colors.line, width });
        }
    }

    for (let t = tiers - 1; t >= 0; t--) {
        const tier = TIERS[t];
        const step = 360 / tier.count;
        for (let i = 0; i < tier.count; i++) {
            const bearing = tier.offset + i * step;
            if (t >= 2) {
                // The small winds, in one tone: the accent
                const tip = polar(tier.tip * radius, bearing);
                const left = polar(tier.side * radius, bearing - tier.spread);
                const right = polar(tier.side * radius, bearing + tier.spread);
                shapes.push(polygon([[0, 0], left, tip, right], { fill: colors.accent, stroke: colors.line, width: width * 0.6 }));
            } else {
                // A mariner's rose alternates which tone leads, as old roses did
                const swap = rose.design === "mariner" && t === 1;
                shapes.push(...twoTonePoint(bearing, tier, radius, swap ? { ...colors, light: colors.dark, dark: colors.light } : colors, width));
            }
        }
    }

    // The hub
    shapes.push({ circle: [0, 0, 0.07 * radius], fill: colors.accent, stroke: colors.line, width: width * 1.5 });

    const distance = (rose.degreeRing || rose.rings >= 2 ? 1.12 : 1.1) * radius;
    if (rose.north === "fleur") {
        // The fleur-de-lis stands in for the N, so it takes the letters' colour and, under it, the
        // same halo in the backing's colour, to read over land or sea outside the disc
        const fleur = (style) => fleurDeLis(0, -0.985 * radius, 0.34 * radius, style);
        if (rose.halo) shapes.push(...fleur({ fill: colors.backing, stroke: colors.backing, width: Math.max(2, size * 0.16), join: "round" }));
        shapes.push(...fleur({ fill: colors.letter, stroke: colors.line, width }));
    }
    if (rose.letters !== "none") {
        for (const [key, bearing] of CARDINALS) {
            if (key === "N" && rose.north === "fleur") continue;
            letter(key, bearing, distance, size);
        }
    }
    if (rose.letters === "all") for (const [key, bearing] of INTERCARDINALS) letter(key, bearing, 0.8 * radius, size * 0.5);
    return { shapes, letters };
}

function xy([x, y]) {
    return { x, y };
}

/**
 * How far the rose reaches from its centre, in map pixels at scale 1, letters included: for its
 * hit radius and its box among the names (letters are counted as squares of their size).
 * @param {{shapes: object[], letters: object[]}} geometry
 * @returns {number}
 */
export function reachOf({ shapes, letters }) {
    let reach = 0;
    for (const shape of shapes) {
        if (shape.circle) reach = Math.max(reach, Math.hypot(shape.circle[0], shape.circle[1]) + shape.circle[2]);
        else for (const [, ...numbers] of shape.path) for (let i = 0; i + 1 < numbers.length; i += 2) reach = Math.max(reach, Math.hypot(numbers[i], numbers[i + 1]));
    }
    for (const letter of letters) reach = Math.max(reach, Math.hypot(letter.x, letter.y) + letter.size * 0.75);
    return reach;
}
