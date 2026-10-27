import { FILRODENSWMB } from "../config.js";
import { chaikin } from "../mesh/BorderArcs.js";
import { joinSegments } from "../travel/TravelTime.js";

/**
 * Draws the Travel tool's lines (see TravelView): the day rings, each labelled once with its day,
 * the way from the start to the pointer, each stretch in its way of travel's colour, and a mark at
 * the start. The rings are drawn again only when they change; the way follows the pointer.
 */
export class TravelLayer {
    #pixi;
    #container;
    #rings;
    #labels;
    #way;
    #start;
    #ringSource = null;

    constructor(pixi, container) {
        this.#pixi = pixi;
        this.#container = container;
        this.#rings = new pixi.Graphics();
        this.#labels = new pixi.Container();
        this.#way = new pixi.Graphics();
        this.#start = new pixi.Graphics();
        container.addChild(this.#rings, this.#labels, this.#way, this.#start);
    }

    /**
     * Shows the rings, or none.
     * @param {{day: number, segments: number[]}[]|null} rings - See TravelTime.dayRings.
     * @param {number} resScale - The map's size against the baseline.
     * @param {{x: number, y: number}|null} [start] - Where the journey starts, which the ring names turn round.
     */
    showRings(rings, resScale, start = null) {
        const T = FILRODENSWMB.TRAVEL_TIME;
        this.#container.visible = !!rings;
        if (!rings || rings === this.#ringSource) return;
        this.#ringSource = rings;
        this.#rings.clear();
        for (const child of this.#labels.removeChildren()) child.destroy();
        const color = Number.parseInt(T.RING_COLOR.slice(1), 16);
        // Each ring as a few long lines (many short ones cost far more to draw), each smoothed once
        // so the coarse network's corners do not show
        const lines = rings.flatMap(({ segments }) => joinSegments(segments)).map((line) => {
            const closed = line.length > 6 && Math.hypot(line[0] - line.at(-2), line[1] - line.at(-1)) < 1e-3;
            return chaikin(line, closed);
        });
        const trace = () => {
            for (const line of lines) {
                this.#rings.moveTo(line[0], line[1]);
                for (let at = 2; at + 1 < line.length; at += 2) this.#rings.lineTo(line[at], line[at + 1]);
            }
        };
        const join = this.#pixi.LINE_JOIN.ROUND;
        // The halo first, so every dark line sits on it
        this.#rings.lineStyle({ width: T.RING_HALO_WIDTH * resScale, color: Number.parseInt(T.RING_HALO.slice(1), 16), alpha: T.RING_HALO_ALPHA, join });
        trace();
        this.#rings.lineStyle({ width: T.RING_WIDTH * resScale, color, alpha: T.RING_ALPHA, join });
        trace();
        // Each ring is named once, the names turning round the start ring by ring (rather than all
        // above it, where they would stack): at the point furthest in that ring's direction
        rings.forEach(({ day, segments }, index) => {
            if (!segments.length) return;
            const angle = -Math.PI / 2 + index * T.LABEL_TURN;
            const [dx, dy] = [Math.cos(angle), Math.sin(angle)];
            const [ox, oy] = start ? [start.x, start.y] : [segments[0], segments[1]];
            let best = 0;
            let bestReach = -Infinity;
            for (let at = 0; at + 1 < segments.length; at += 2) {
                const reach = (segments[at] - ox) * dx + (segments[at + 1] - oy) * dy;
                if (reach > bestReach) {
                    bestReach = reach;
                    best = at;
                }
            }
            const label = new this.#pixi.Text(String(day), { fontFamily: "sans-serif", fontSize: 11 * resScale, fontWeight: "700", fill: 0xffffff, stroke: color, strokeThickness: 3 * resScale });
            label.anchor.set(0.5, 0.5);
            label.position.set(segments[best], segments[best + 1]);
            this.#labels.addChild(label);
        });
    }

    /**
     * Shows the way to the pointer, or none.
     * @param {{points: number[], kinds: string[]}|null} way - Its points (x, y pairs) and each stretch's way of travel.
     * @param {number} resScale
     */
    showWay(way, resScale) {
        this.#way.clear();
        if (!way || way.points.length < 4) return;
        const colours = Object.fromEntries(FILRODENSWMB.THEMATIC.TRADE.TRANSPORTS.map((transport) => [transport.id, Number.parseInt(transport.color.slice(1), 16)]));
        const width = FILRODENSWMB.TRAVEL_TIME.WAY_WIDTH * resScale;
        for (let step = 0; step < way.kinds.length; step++) {
            const kind = way.kinds[step] === "land" ? "road" : way.kinds[step];
            this.#way.lineStyle({ width: width + 2 * resScale, color: 0x000000, alpha: 0.5, cap: this.#pixi.LINE_CAP.ROUND });
            this.#way.moveTo(way.points[step * 2], way.points[step * 2 + 1]);
            this.#way.lineTo(way.points[step * 2 + 2], way.points[step * 2 + 3]);
            this.#way.lineStyle({ width, color: colours[kind] ?? 0xffffff, alpha: 1, cap: this.#pixi.LINE_CAP.ROUND });
            this.#way.moveTo(way.points[step * 2], way.points[step * 2 + 1]);
            this.#way.lineTo(way.points[step * 2 + 2], way.points[step * 2 + 3]);
        }
    }

    /**
     * Marks the start (a dark ring on a pale disc, so it reads on any band), or none.
     * @param {{x: number, y: number}|null} start
     * @param {number} resScale
     */
    showStart(start, resScale) {
        this.#start.clear();
        if (!start) return;
        const T = FILRODENSWMB.TRAVEL_TIME;
        const radius = T.START_RADIUS * resScale;
        this.#start.lineStyle({ width: 2 * resScale, color: Number.parseInt(T.RING_COLOR.slice(1), 16), alpha: 1 });
        this.#start.beginFill(Number.parseInt(T.RING_HALO.slice(1), 16), 1);
        this.#start.drawCircle(start.x, start.y, radius);
        this.#start.endFill();
        this.#start.lineStyle(0);
        this.#start.beginFill(Number.parseInt(T.RING_COLOR.slice(1), 16), 1);
        this.#start.drawCircle(start.x, start.y, radius * 0.35);
        this.#start.endFill();
    }

    destroy() {
        this.#container.removeChildren();
        this.#rings.destroy();
        this.#labels.destroy({ children: true });
        this.#way.destroy();
        this.#start.destroy();
    }
}
