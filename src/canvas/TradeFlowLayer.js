import { FILRODENSWMB } from "../config.js";

/**
 * Draws the trade layer (see ThematicData.tradeLines): one PIXI.Graphics holding every line, its
 * width by class and its colour by transport. Lines come quietest first, so the busiest lie on
 * top. The Graphics is rebuilt only when what it shows changes (the run's lines, or the map's
 * size, which scales the widths), since a run has thousands of lines and redrawing them on every
 * repaint of the vectors would cost more than everything else drawn then.
 *
 * While the lines are shown the routes beneath are drawn fainter (TRADE.ROUTE_ALPHA), hand-placed
 * and generated alike: trade follows only the generated routes, so a hand-placed route would
 * otherwise be the one road on the map with nothing over it.
 */
export class TradeFlowLayer {
    #pixi;
    #graphics;
    #routes;
    #source = null;
    #scale = 0;

    /**
     * @param {object} pixi - The PIXI namespace.
     * @param {object} container - The canvas layer it is drawn in.
     * @param {object} [routes] - The routes' display object, made fainter while the lines show.
     */
    constructor(pixi, container, routes = null) {
        this.#pixi = pixi;
        this.#routes = routes;
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
        if (this.#routes) this.#routes.alpha = lines ? FILRODENSWMB.THEMATIC.TRADE.ROUTE_ALPHA : 1;
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
