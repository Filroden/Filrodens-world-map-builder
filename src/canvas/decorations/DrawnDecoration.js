import { FILRODENSWMB } from "../../config.js";
import { compassRose, reachOf } from "./CompassGeometry.js";

/**
 * Decorations the module draws itself (a compass rose; a cartouche), rather than an image the
 * user supplied. Each is an entry of the map's decorations with a `kind`, so it is saved, undone,
 * moved, turned, hidden and carried into files and regional maps as image decorations are.
 *
 * Shapes are drawn as vectors (PIXI.Graphics) and letters as text (PIXI.Text) in the label fonts,
 * so both are drawn afresh at an export's scale rather than enlarged, and the letters use the
 * module's own faces. A decoration that leaves a field out takes its design's default, so fields
 * added later need no migration.
 */
export class DrawnDecoration {
    /** Whether a decoration is drawn by the module (it has a kind) rather than an image. */
    static isDrawn(decoration) {
        return FILRODENSWMB.DECORATIONS.KINDS.includes(decoration?.kind);
    }

    /** Whether a kind of drawn decoration can be added yet (the cartouche comes later). */
    static canCreate(kind) {
        return kind === "compass";
    }

    /**
     * A new drawn decoration of a kind, with its design's defaults, sized to the map and placed
     * where that kind usually sits: a compass near the bottom right corner, inside the border.
     *
     * @param {"compass"} kind
     * @param {object} options
     * @param {string} options.id
     * @param {string} options.name
     * @param {number} options.mapWidth
     * @param {number} options.mapHeight
     * @param {number} [options.inset] - How far in from the map's edges the border reaches (see MapBorder.nameInset).
     * @returns {object}
     */
    static create(kind, { id, name, mapWidth, mapHeight, inset = 0 }) {
        const { COMPASS, SCHEMES, DEFAULT_SCHEME } = FILRODENSWMB.DECORATIONS;
        if (kind !== "compass") throw new Error(`No drawn decoration of kind ${kind}`);
        const radius = Math.round(Math.min(mapWidth, mapHeight) * COMPASS.RADIUS_SHARE);
        const margin = inset + radius * COMPASS.CORNER_RADII;
        return {
            id,
            type: "decoration",
            kind,
            name,
            x: Math.round(Math.max(mapWidth / 2, mapWidth - margin)),
            y: Math.round(Math.max(mapHeight / 2, mapHeight - margin)),
            rotation: 0,
            scale: 1,
            opacity: 1,
            visibility: "all",
            design: "classic",
            size: radius,
            ...COMPASS.DEFAULTS.classic,
            letterSize: COMPASS.LETTER_SIZE.DEFAULT,
            upright: false,
            backing: true,
            backingOpacity: COMPASS.BACKING_OPACITY,
            halo: true,
            colours: { ...SCHEMES[DEFAULT_SCHEME] },
        };
    }

    /**
     * A compass rose's fields with every one it leaves out filled from its design's defaults and
     * the default colour scheme.
     * @param {object} decoration
     * @returns {object}
     */
    static compassOf(decoration) {
        const { COMPASS, SCHEMES, DEFAULT_SCHEME } = FILRODENSWMB.DECORATIONS;
        const design = COMPASS.DESIGNS.includes(decoration.design) ? decoration.design : "classic";
        const defaults = COMPASS.DEFAULTS[design];
        const pick = (key, fallback) => decoration[key] ?? fallback;
        return {
            design,
            radius: pick("size", 100),
            points: pick("points", defaults.points),
            rings: pick("rings", defaults.rings),
            degreeRing: pick("degreeRing", defaults.degreeRing),
            north: pick("north", defaults.north),
            letters: pick("letters", defaults.letters),
            letterSize: pick("letterSize", COMPASS.LETTER_SIZE.DEFAULT),
            upright: pick("upright", false),
            backing: pick("backing", true),
            backingOpacity: pick("backingOpacity", COMPASS.BACKING_OPACITY),
            halo: pick("halo", true),
            colours: { ...SCHEMES[DEFAULT_SCHEME], ...(decoration.colours ?? {}) },
            fontFamily: pick("fontFamily", defaults.fontFamily),
            bold: pick("bold", defaults.bold),
        };
    }

    /**
     * The faces a drawn decoration's text uses, as label fields (family, bold, italic), so the
     * label font machinery loads them, waits for them before an export, and reports any the host
     * lacks (see LabelFonts). An image decoration has none.
     * @param {object} decoration
     * @returns {{fontFamily: string, bold: boolean, italic: boolean}[]}
     */
    static faces(decoration) {
        if (decoration?.kind !== "compass") return [];
        const rose = this.compassOf(decoration);
        return rose.letters === "none" ? [] : [{ fontFamily: rose.fontFamily, bold: rose.bold, italic: false }];
    }

    /** The compass letters' localisation keys, by the letter each stands for. */
    static LETTER_KEYS = Object.freeze({
        N: "FILRODENSWMB.UI.CompassN",
        E: "FILRODENSWMB.UI.CompassE",
        S: "FILRODENSWMB.UI.CompassS",
        W: "FILRODENSWMB.UI.CompassW",
        NE: "FILRODENSWMB.UI.CompassNE",
        SE: "FILRODENSWMB.UI.CompassSE",
        SW: "FILRODENSWMB.UI.CompassSW",
        NW: "FILRODENSWMB.UI.CompassNW",
    });

    /**
     * A drawn decoration as a PIXI container centred on (0, 0), unplaced, unturned and at scale
     * 1, and how far it reaches from its centre (for picking it, and for keeping names clear).
     *
     * @param {object} PIXI
     * @param {object} decoration
     * @param {object} options
     * @param {{family: function(object): string, weight: function(object): string}} options.fonts - LabelFonts.
     * @param {function(string): string} options.localize
     * @returns {{container: object, reach: number}}
     */
    static build(PIXI, decoration, { fonts, localize }) {
        const rose = this.compassOf(decoration);
        const letterText = Object.fromEntries(Object.entries(this.LETTER_KEYS).map(([key, i18n]) => [key, localize(i18n)]));
        const geometry = compassRose(rose, letterText);
        const container = new PIXI.Container();
        const oversample = FILRODENSWMB.DECORATIONS.OVERSAMPLE;
        const graphics = new PIXI.Graphics();
        drawShapes(graphics, geometry.shapes, oversample);
        graphics.scale.set(1 / oversample);
        container.addChild(graphics);
        const face = { fontFamily: rose.fontFamily, bold: rose.bold };
        for (const letter of geometry.letters) {
            const text = new PIXI.Text(letter.text, {
                fontFamily: fonts.family(face),
                fontWeight: fonts.weight(face),
                fontSize: letter.size,
                fill: rose.colours.letter,
                // A halo in the backing's colour, as names have, so letters outside the disc read
                // over the map
                ...(rose.halo ? { stroke: rose.colours.backing, strokeThickness: Math.max(2, letter.size * 0.16), lineJoin: "round" } : {}),
            });
            text.anchor.set(0.5);
            text.position.set(letter.x, letter.y);
            // Upright letters stay level on the page however the rose is turned
            text.rotation = rose.upright ? -((decoration.rotation ?? 0) * Math.PI) / 180 : 0;
            container.addChild(text);
        }
        return { container, reach: reachOf(geometry) };
    }
}

/** Packs "#rrggbb" into a number, as PIXI takes colours. */
const packed = (colour) => Number.parseInt(String(colour).slice(1), 16) || 0;

/**
 * Draws shapes (see CompassGeometry) into a Graphics, every coordinate multiplied by `k`, so a
 * Graphics scaled back by 1 / k keeps k times as many segments on its curves.
 */
export function drawShapes(graphics, shapes, k = 1) {
    for (const shape of shapes) {
        if (shape.stroke) graphics.lineStyle(shape.width * k, packed(shape.stroke), 1, 0.5);
        else graphics.lineStyle(0);
        if (shape.fill) graphics.beginFill(packed(shape.fill), shape.alpha ?? 1);
        if (shape.circle) {
            const [x, y, r] = shape.circle;
            graphics.drawCircle(x * k, y * k, r * k);
        } else {
            for (const [command, ...numbers] of shape.path) {
                const v = numbers.map((n) => n * k);
                if (command === "M") graphics.moveTo(...v);
                else if (command === "L") graphics.lineTo(...v);
                else if (command === "C") graphics.bezierCurveTo(...v);
                else if (command === "Q") graphics.quadraticCurveTo(...v);
                else if (command === "Z") graphics.closePath();
            }
        }
        if (shape.fill) graphics.endFill();
    }
}
