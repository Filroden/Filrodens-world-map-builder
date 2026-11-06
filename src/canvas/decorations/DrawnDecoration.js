import { FILRODENSWMB } from "../../config.js";
import { compassRose, reachOf } from "./CompassGeometry.js";
import { TITLE_LEADING, cartouche, fitTitle } from "./CartoucheGeometry.js";

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

    /** Whether a kind of drawn decoration can be added. */
    static canCreate(kind) {
        return FILRODENSWMB.DECORATIONS.KINDS.includes(kind);
    }

    /**
     * A new drawn decoration of a kind, with its design's defaults, sized to the map and placed
     * where that kind usually sits: a compass near the bottom right corner, a cartouche at the top
     * centre, both inside the border. A new cartouche shows the map's name.
     *
     * @param {"compass"|"cartouche"} kind
     * @param {object} options
     * @param {string} options.id
     * @param {string} options.name
     * @param {number} options.mapWidth
     * @param {number} options.mapHeight
     * @param {number} [options.inset] - How far in from the map's edges the border reaches (see MapBorder.nameInset).
     * @returns {object}
     */
    static create(kind, { id, name, mapWidth, mapHeight, inset = 0 }) {
        const { COMPASS, CARTOUCHE, SCHEMES, DEFAULT_SCHEME } = FILRODENSWMB.DECORATIONS;
        const common = { id, type: "decoration", kind, name, rotation: 0, scale: 1, opacity: 1, visibility: "all", colors: { ...SCHEMES[DEFAULT_SCHEME] } };
        if (kind === "cartouche") {
            const size = Math.round(Math.min(mapWidth, mapHeight) * CARTOUCHE.TITLE_SHARE);
            return {
                ...common,
                x: Math.round(mapWidth / 2),
                y: Math.round(Math.min(mapHeight / 2, inset + size * CARTOUCHE.TOP_TITLES)),
                design: "plaque",
                size,
                ...CARTOUCHE.DEFAULTS.plaque,
                titleSource: "map",
                title: "",
                subtitle: "",
                subtitleSize: CARTOUCHE.SUBTITLE_SIZE.DEFAULT,
                subtitleItalic: true,
                subtitleFontFamily: CARTOUCHE.SUBTITLE_FONT,
                capitals: false,
                maxWidth: CARTOUCHE.MAX_WIDTH.DEFAULT,
            };
        }
        if (kind !== "compass") throw new Error(`No drawn decoration of kind ${kind}`);
        const radius = Math.round(Math.min(mapWidth, mapHeight) * COMPASS.RADIUS_SHARE);
        const margin = inset + radius * COMPASS.CORNER_RADII;
        return {
            ...common,
            x: Math.round(Math.max(mapWidth / 2, mapWidth - margin)),
            y: Math.round(Math.max(mapHeight / 2, mapHeight - margin)),
            design: "classic",
            size: radius,
            ...COMPASS.DEFAULTS.classic,
            letterSize: COMPASS.LETTER_SIZE.DEFAULT,
            upright: false,
            backing: true,
            backingOpacity: COMPASS.BACKING_OPACITY,
            halo: true,
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
            colors: { ...SCHEMES[DEFAULT_SCHEME], ...(decoration.colors ?? {}) },
            fontFamily: pick("fontFamily", defaults.fontFamily),
            bold: pick("bold", defaults.bold),
        };
    }

    /**
     * A cartouche's fields with every one it leaves out filled from its design's defaults and the
     * default colour scheme.
     * @param {object} decoration
     * @returns {object}
     */
    static cartoucheOf(decoration) {
        const { CARTOUCHE, SCHEMES, DEFAULT_SCHEME } = FILRODENSWMB.DECORATIONS;
        const design = CARTOUCHE.DESIGNS.includes(decoration.design) ? decoration.design : "plaque";
        const defaults = CARTOUCHE.DEFAULTS[design];
        const pick = (key, fallback) => decoration[key] ?? fallback;
        return {
            design,
            titleSize: pick("size", 40),
            titleSource: pick("titleSource", "map"),
            title: pick("title", ""),
            subtitle: pick("subtitle", ""),
            subtitleSize: pick("subtitleSize", CARTOUCHE.SUBTITLE_SIZE.DEFAULT),
            subtitleItalic: pick("subtitleItalic", true),
            subtitleFontFamily: pick("subtitleFontFamily", CARTOUCHE.SUBTITLE_FONT),
            capitals: pick("capitals", false),
            maxWidth: pick("maxWidth", CARTOUCHE.MAX_WIDTH.DEFAULT),
            colors: { ...SCHEMES[DEFAULT_SCHEME], ...(decoration.colors ?? {}) },
            fontFamily: pick("fontFamily", defaults.fontFamily),
            bold: pick("bold", defaults.bold),
        };
    }

    /**
     * The title a cartouche shows: its own, or the map's name (`mapName`; `untitled` for a map
     * not yet saved), in capitals if it asks for them. A custom title left empty shows the map's
     * name too, so a cartouche is never blank.
     * @param {object} panel - cartoucheOf's fields.
     * @param {{mapName?: string|null, untitled: string}} names
     * @returns {string}
     */
    static titleOf(panel, { mapName, untitled }) {
        const own = panel.titleSource === "custom" ? panel.title.trim() : "";
        const title = own || mapName?.trim() || untitled;
        return panel.capitals ? title.toLocaleUpperCase() : title;
    }

    /**
     * The faces a drawn decoration's text uses, as label fields (family, bold, italic), so the
     * label font machinery loads them, waits for them before an export, and reports any the host
     * lacks (see LabelFonts). An image decoration has none.
     * @param {object} decoration
     * @returns {{fontFamily: string, bold: boolean, italic: boolean}[]}
     */
    static faces(decoration) {
        if (decoration?.kind === "cartouche") {
            const panel = this.cartoucheOf(decoration);
            const faces = [{ fontFamily: panel.fontFamily, bold: panel.bold, italic: false }];
            if (panel.subtitle.trim()) faces.push({ fontFamily: panel.subtitleFontFamily, bold: false, italic: panel.subtitleItalic });
            return faces;
        }
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
     * @param {number} [options.mapWidth] - For a cartouche's widest.
     * @param {string|null} [options.mapName] - The map's name, for a cartouche that shows it.
     * @returns {{container: object, reach: number, overflow: boolean}} `overflow`: a cartouche's text does not fit its widest.
     */
    static build(PIXI, decoration, { fonts, localize, mapWidth = 0, mapName = null }) {
        if (decoration.kind === "cartouche") return this.#buildCartouche(PIXI, decoration, { fonts, localize, mapWidth, mapName });
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
                fill: rose.colors.letter,
                // A halo in the backing's colour, as names have, so letters outside the disc read
                // over the map
                ...(rose.halo ? { stroke: rose.colors.backing, strokeThickness: Math.max(2, letter.size * 0.16), lineJoin: "round" } : {}),
            });
            text.anchor.set(0.5);
            text.position.set(letter.x, letter.y);
            // Upright letters stay level on the page however the rose is turned
            text.rotation = rose.upright ? -((decoration.rotation ?? 0) * Math.PI) / 180 : 0;
            container.addChild(text);
        }
        return { container, reach: reachOf(geometry), overflow: false };
    }

    /**
     * A cartouche's layout: its title fitted (see fitTitle) in the width its maximum width leaves
     * for text, its subtitle, if any, widening the panel within that width or shrunk to fit it,
     * and the design drawn around them. Text that cannot fit even so widens the panel past its
     * widest rather than spilling out, and is reported. Measured with `measure(text, size, face)`, so it runs in
     * Node with a stand-in measure.
     *
     * @param {object} panel - cartoucheOf's fields.
     * @param {string} title - The text to show (see titleOf).
     * @param {function(string, number, object): number} measure
     * @param {{mapWidth: number, scale?: number}} map - The map's width, and the decoration's scale.
     * @returns {{geometry: object, lines: string[], subtitleSize: number, overflow: boolean, titleFace: object, subtitleFace: object}}
     */
    static layoutCartouche(panel, title, measure, { mapWidth, scale = 1 }) {
        const size = panel.titleSize;
        const titleFace = { fontFamily: panel.fontFamily, bold: panel.bold, italic: false };
        const subtitleFace = { fontFamily: panel.subtitleFontFamily, bold: false, italic: panel.subtitleItalic };
        // The panel's widest is a share of the map's width; its sides take about two title sizes
        const widest = Math.max(size * 2, (panel.maxWidth * mapWidth) / (scale || 1) - size * 2.4);
        const fit = fitTitle((text, at) => measure(text, at, titleFace), title, size, { minWidth: Math.min(widest, size * 4), maxWidth: widest });
        const subtitle = panel.subtitle.trim();
        let subtitleSize = subtitle ? panel.subtitleSize * fit.size : 0;
        let textWidth = fit.textWidth;
        let overflow = fit.overflow;
        if (subtitle) {
            const wide = measure(subtitle, subtitleSize, subtitleFace);
            if (wide > widest) {
                const shrunk = Math.max(subtitleSize * 0.6, (subtitleSize * widest) / wide);
                overflow ||= measure(subtitle, shrunk, subtitleFace) > widest + 0.5;
                subtitleSize = shrunk;
            }
            textWidth = Math.max(textWidth, measure(subtitle, subtitleSize, subtitleFace));
        }
        const geometry = cartouche({ design: panel.design, textWidth, titleSize: fit.size, lines: fit.lines.length, subtitleSize, colors: panel.colors });
        return { geometry, lines: fit.lines, subtitleSize, overflow, titleFace, subtitleFace };
    }

    /** A cartouche as a container, as build. Its text turns with it, as a title on a turned panel does. */
    static #buildCartouche(PIXI, decoration, { fonts, localize, mapWidth, mapName }) {
        const panel = this.cartoucheOf(decoration);
        const title = this.titleOf(panel, { mapName, untitled: localize("FILRODENSWMB.UI.CartoucheUntitled") });
        const style = (face, size) => new PIXI.TextStyle({ fontFamily: fonts.family(face), fontWeight: fonts.weight(face), fontStyle: fonts.style(face), fontSize: size });
        const measure = (text, size, face) => PIXI.TextMetrics.measureText(text, style(face, size)).width;
        const layout = this.layoutCartouche(panel, title, measure, { mapWidth, scale: decoration.scale });
        const { geometry } = layout;
        const container = new PIXI.Container();
        const oversample = FILRODENSWMB.DECORATIONS.OVERSAMPLE;
        const graphics = new PIXI.Graphics();
        drawShapes(graphics, geometry.shapes, oversample);
        graphics.scale.set(1 / oversample);
        container.addChild(graphics);
        // Text is centred where the layout asks by its ink: the rows its letters actually cover,
        // swashes and descenders included, read from the text's own canvas. A PIXI.Text's box also
        // holds the face's room above the capitals and below the baseline, and sets each line down
        // by part of its line height, which would push the letters off centre. Where the canvas
        // cannot be read, the face's metrics stand in
        const write = (lines, place, face) => {
            const style = new PIXI.TextStyle({
                fontFamily: fonts.family(face),
                fontWeight: fonts.weight(face),
                fontStyle: fonts.style(face),
                fontSize: place.size,
                fill: panel.colors.text,
                align: "center",
                lineHeight: place.size * TITLE_LEADING,
            });
            const shown = new PIXI.Text(lines.join("\n"), style);
            const { top, bottom } = inkRows(shown) ?? metricRows(PIXI, style, lines, place.size);
            shown.anchor.set(0.5, 0);
            shown.position.set(place.x, place.y - (top + bottom) / 2);
            container.addChild(shown);
        };
        write(layout.lines, geometry.title, layout.titleFace);
        if (geometry.subtitle) write([panel.subtitle.trim()], geometry.subtitle, layout.subtitleFace);
        return { container, reach: Math.hypot(geometry.width, geometry.height) / 2, overflow: layout.overflow };
    }
}

/**
 * The first and last rows a PIXI.Text's letters cover, in its own units from the top of its box;
 * null when its canvas cannot be read or holds nothing.
 */
function inkRows(text) {
    try {
        text.updateText(true);
        const { canvas, context } = text;
        const { width, height } = canvas;
        if (!width || !height) return null;
        const alpha = context.getImageData(0, 0, width, height).data;
        const inked = (row) => {
            for (let i = row * width * 4 + 3; i < (row + 1) * width * 4; i += 4) if (alpha[i] > 24) return true;
            return false;
        };
        let first = 0;
        while (first < height && !inked(first)) first++;
        if (first === height) return null;
        let last = height - 1;
        while (last > first && !inked(last)) last--;
        const resolution = text.resolution || 1;
        return { top: first / resolution, bottom: (last + 1) / resolution };
    } catch {
        return null;
    }
}

/** The rows a text's letters cover, from its face's metrics: from the top of its capitals to its last baseline, or its descenders when it has any. */
function metricRows(PIXI, style, lines, size) {
    const { ascent, descent, fontSize } = PIXI.TextMetrics.measureFont(style.toFontString());
    // PIXI sets each line down by half of what its line height adds to the face's own
    const shift = Math.max(0, (style.lineHeight - fontSize) / 2);
    return {
        top: shift + ascent - size * CAP_HEIGHT,
        bottom: shift + (lines.length - 1) * style.lineHeight + ascent + (DESCENDERS.test(lines.at(-1)) ? descent : 0),
    };
}

/** About how tall capitals stand, as a share of a face's size. */
const CAP_HEIGHT = 0.7;

/** Letters that reach below the baseline (in the scripts the label faces are mostly used for). */
const DESCENDERS = /[gjpqyQ,;()[\]{}]/;

/** Packs "#rrggbb" into a number, as PIXI takes colours. */
const packed = (colour) => Number.parseInt(String(colour).slice(1), 16) || 0;

/**
 * Draws shapes (see CompassGeometry) into a Graphics, every coordinate multiplied by `k`, so a
 * Graphics scaled back by 1 / k keeps k times as many segments on its curves.
 */
export function drawShapes(graphics, shapes, k = 1) {
    for (const shape of shapes) {
        if (shape.stroke) graphics.lineStyle({ width: shape.width * k, color: packed(shape.stroke), alpha: 1, alignment: 0.5, join: shape.join === "round" ? "round" : "miter" });
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
