import { FILRODENSWMB } from "../config.js";

/**
 * Draws the trade layer (see ThematicData.tradeLines): one PIXI.Graphics holding every line, its
 * width by class and its colour by transport. Lines come quietest first, so the busiest lie on
 * top. The Graphics is rebuilt only when what it shows changes (the run's lines, or the map's
 * size, which scales the widths), since a run has thousands of lines and redrawing them on every
 * repaint of the vectors would cost more than everything else drawn then.
 */
export class TradeFlowLayer {
    #pixi;
    #graphics;
    #source = null;
    #scale = 0;

    /**
     * @param {object} pixi - The PIXI namespace.
     * @param {object} container - The canvas layer it is drawn in.
     */
    constructor(pixi, container) {
        this.#pixi = pixi;
        this.#graphics = new pixi.Graphics();
        container.addChild(this.#graphics);
    }

    /**
     * Shows the lines, or none.
     * @param {{points: number[], kind: number, cls: number}[]|null} lines
     * @param {number} resScale - The map's size against the baseline (widths grow with it, as pins do).
     */
    show(lines, resScale) {
        this.#graphics.visible = !!lines;
        if (!lines || (lines === this.#source && resScale === this.#scale)) return;
        this.#source = lines;
        this.#scale = resScale;
        const { CLASSES, TRANSPORTS, ALPHA } = FILRODENSWMB.THEMATIC.TRADE;
        const colors = TRANSPORTS.map((transport) => Number.parseInt(transport.color.slice(1), 16));
        const graphics = this.#graphics;
        graphics.clear();
        for (const line of lines) {
            graphics.lineStyle({ width: CLASSES[line.cls].widthPx * resScale, color: colors[line.kind] ?? colors[0], alpha: ALPHA, cap: this.#pixi.LINE_CAP.ROUND, join: this.#pixi.LINE_JOIN.ROUND });
            graphics.moveTo(line.points[0], line.points[1]);
            for (let at = 2; at + 1 < line.points.length; at += 2) graphics.lineTo(line.points[at], line.points[at + 1]);
        }
    }

    destroy() {
        this.#graphics.destroy();
    }
}
