import { compassRose } from "./CompassGeometry.js";
import { cartouche } from "./CartoucheGeometry.js";

/**
 * A drawn decoration's shapes as data for an SVG thumbnail (the inspector's design picker): each
 * shape a circle or a path's `d`, with its fill, stroke and width. The template writes them as
 * attributes, which Handlebars escapes, so no markup is built here; and every value is a number
 * or a colour checked to be "#rrggbb" ("none" otherwise), so nothing else can reach the page.
 */

const HEX = /^#[0-9a-f]{6}$/i;
const paint = (value) => (typeof value === "string" && HEX.test(value) ? value : "none");
const number = (value) => (Number.isFinite(value) ? Math.round(value * 100) / 100 : 0);

/**
 * A shape list (see CompassGeometry) as thumbnail data.
 * @param {object[]} shapes
 * @param {number|{width: number, height: number}} reach - How far the shapes reach from their
 *   centre, for a square view box; or the box's width and height, centred.
 * @returns {{viewBox: string, shapes: {circle: {cx: number, cy: number, r: number}|null, d: string|null, fill: string, stroke: string, width: number, join: string, opacity: number}[]}}
 */
export function svgShapes(shapes, reach) {
    const width = number(typeof reach === "number" ? reach * 2 : reach.width);
    const height = number(typeof reach === "number" ? reach * 2 : reach.height);
    return {
        viewBox: `${number(-width / 2)} ${number(-height / 2)} ${width} ${height}`,
        shapes: shapes.map((shape) => ({
            circle: shape.circle ? { cx: number(shape.circle[0]), cy: number(shape.circle[1]), r: number(shape.circle[2]) } : null,
            d: shape.path ? shape.path.map(([command, ...values]) => ("MLCQZ".includes(command) ? command : "") + values.map(number).join(" ")).join(" ") : null,
            fill: paint(shape.fill),
            stroke: paint(shape.stroke),
            width: shape.stroke ? number(shape.width) : 0,
            join: shape.join === "round" ? "round" : "miter",
            opacity: number(shape.alpha ?? 1),
        })),
    };
}

/**
 * A compass rose's thumbnail: its shapes without letters (too small to read), drawn at a radius
 * of 24 in a view box that holds the whole rose.
 * @param {object} rose - DrawnDecoration.compassOf's fields.
 */
export function compassThumbnail(rose) {
    const { shapes } = compassRose({ ...rose, radius: 24, letters: "none" });
    return svgShapes(shapes, 34);
}

/**
 * A cartouche's thumbnail: its design around a stand-in title (a rule in the text's colour, as
 * a title too small to read would look), in a view box that holds the whole panel.
 * @param {object} panel - DrawnDecoration.cartoucheOf's fields.
 */
export function cartoucheThumbnail(panel) {
    const textWidth = 44;
    const geometry = cartouche({ design: panel.design, textWidth, titleSize: 12, lines: 1, subtitleSize: 0, colors: panel.colors });
    const y = geometry.title.y;
    const title = { path: [["M", -textWidth / 2, y], ["L", textWidth / 2, y]], stroke: panel.colors.text, width: 3.5 };
    const pad = 2;
    return svgShapes([...geometry.shapes, title], { width: geometry.width + pad * 2, height: geometry.height + pad * 2 });
}
