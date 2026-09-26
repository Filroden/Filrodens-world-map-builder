import { FILRODENSWMB } from "../../config.js";
import { FeatureDelta } from "./FeatureDelta.js";
import { LineField } from "./LineField.js";
import { Volcanoes } from "./Volcanoes.js";

/**
 * A hotspot chain: a line of shield volcanoes left behind as a plate moves over a hotspot, drawn
 * from its oldest end to its youngest.
 *
 * The youngest volcanoes are tall, active islands with a summit cone and caldera. Along the chain
 * towards its oldest end they subside, round off and erode into smaller islands, are planed flat
 * at sea level into atolls, and finally sink as seamounts. The hotspot's output rises and falls
 * over time, so busy periods leave clusters of large, close-set islands (often composite islands
 * of several volcanoes, as Hawaii's are) and quiet periods leave long empty stretches.
 *
 * Settings (all optional but `thickness` and `strength`):
 *   - thickness: the width of the band the chain's volcanoes lie in, either side of the line, in
 *     map pixels; a young island's typical radius at sea level is a share of it (ISLAND_SHARE);
 *   - strength: a young summit's typical height above sea level, as a share of the land's range;
 *   - spacing: the typical gap between volcanoes, in island radii;
 *   - spacingTrend (-1 to 1): negative crowds volcanoes towards the young end, positive spreads them;
 *   - scatter (0 to 1): how far volcanoes stray either side of the line, in island radii;
 *   - reversed: lays the chain out from its last point (see TectonicFeatureEngine);
 *   - variation (0 to 1): how much island sizes and spacing vary;
 *   - pulses (0 to 1): how strongly the hotspot's output rises and falls along the chain;
 *   - vents (0 to 1): how often extra vents build composite islands;
 *   - drowned (0 to 1): the share of the chain, from its oldest end, that has sunk below the sea.
 */
export class HotspotFeature {
    static plan(fault, context) {
        const volcanoes = Volcanoes.prepareShields(HotspotFeature.#volcanoes(fault, context), context);
        const bounds = Volcanoes.boundsOf(volcanoes, context.width, context.height);
        return bounds ? { volcanoes, bounds } : null;
    }

    static render(plan, fault, context) {
        const delta = new FeatureDelta(plan.bounds);
        Volcanoes.stampShields(delta, plan.volcanoes, context);
        return delta;
    }

    static #settings(fault) {
        const defaults = FILRODENSWMB.TECTONICS.FEATURES.HOTSPOT;
        return {
            spacing: fault.spacing ?? defaults.DEFAULT_SPACING,
            trend: fault.spacingTrend ?? defaults.DEFAULT_SPACING_TREND,
            scatter: fault.scatter ?? defaults.DEFAULT_SCATTER,
            variation: fault.variation ?? defaults.DEFAULT_VARIATION,
            pulses: fault.pulses ?? defaults.DEFAULT_PULSES,
            vents: fault.vents ?? defaults.DEFAULT_VENTS,
            drowned: fault.drowned ?? defaults.DEFAULT_DROWNED,
        };
    }

    /** Every volcano of the chain (main and extra vents), before they are sized on the ground. */
    static #volcanoes(fault, context) {
        const options = HotspotFeature.#settings(fault);
        const radius = fault.thickness * FILRODENSWMB.TECTONICS.FEATURES.HOTSPOT.ISLAND_SHARE;
        const curve = LineField.splinePoints(fault.points);
        const length = curve.reduce((sum, point, i) => (i === 0 ? 0 : sum + Math.hypot(point.x - curve[i - 1].x, point.y - curve[i - 1].y)), 0);
        const stations = Volcanoes.walkStations(
            curve,
            length,
            {
                spacing: radius * options.spacing,
                minStep: radius * FILRODENSWMB.TECTONICS.FEATURES.VOLCANO.MIN_STEP,
                trend: options.trend,
                variation: options.variation,
                pulses: options.pulses,
                pulseLength: radius * FILRODENSWMB.TECTONICS.FEATURES.HOTSPOT.PULSE_LENGTH,
                keepLast: true,
            },
            context.noise,
        );

        const volcanoes = [];
        stations.forEach((station, index) => {
            const main = HotspotFeature.#mainVolcano(station, index, radius, fault.strength * (1 - context.seaLevel), options, context);
            volcanoes.push(main, ...HotspotFeature.#extraVents(main, station, options, context));
        });
        return volcanoes;
    }

    static #mainVolcano(station, index, radius, height, options, context) {
        const noise = context.noise;
        const bx = noise.bx(station.x);
        const by = noise.by(station.y);
        // Volcanoes fall along two loose parallel lines, as Hawaii's Loa and Kea trends do, plus noise
        const trendSide = noise.fbm(index * SIDE_NOISE.RATE + SIDE_NOISE.X, SIDE_NOISE.Y, 1) > 0 ? 1 : -1;
        const side = options.scatter * radius * (SIDE_NOISE.TREND * trendSide + (1 - SIDE_NOISE.TREND) * noise.fbm(bx / SIDE_NOISE.LENGTH, by / SIDE_NOISE.LENGTH, 2));
        // Sizes spread both ways (lognormally: some islands twice the typical size, some half),
        // and follow the hotspot's output at the time
        const output = 1 + options.pulses * (SIZE.BUSY * station.activity - SIZE.QUIET);
        const size = Math.max(SIZE.MIN, Math.exp(options.variation * SIZE.SPREAD * noise.fbm(bx / SIZE.LENGTH + SIZE.X, by / SIZE.LENGTH, 2)) * output);
        return {
            // The side offset is along the line's clockwise normal (-dy, dx)
            x: station.x - station.dy * side,
            y: station.y + station.dx * side,
            radius: radius * size,
            top: context.seaLevel + height * Math.sqrt(size),
            age: 1 - station.along,
            drownAge: 1 - options.drowned,
            arms: noise.fbm(bx / ARMS.LENGTH + ARMS.X, by / ARMS.LENGTH, 1) > 0 ? 3 : 2,
            armAngle: Math.PI * noise.fbm(bx / ARMS.LENGTH - ARMS.X, by / ARMS.LENGTH, 1),
        };
    }

    /**
     * Up to two extra vents on a volcano's flanks, a little younger and lower, merging with it
     * into one composite island. Busy periods build them more often.
     */
    static #extraVents(main, station, options, context) {
        const noise = context.noise;
        const bx = noise.bx(station.x);
        const by = noise.by(station.y);
        const vents = [];
        for (let k = 0; k < VENTS.MAX; k++) {
            const roll = 0.5 + 0.5 * noise.fbm(bx / VENTS.LENGTH + VENTS.X * (k + 1), by / VENTS.LENGTH, 1);
            const chance = options.vents * (k === 0 ? 1 : VENTS.SECOND_CHANCE) * (VENTS.QUIET_CHANCE + VENTS.BUSY_CHANCE * station.activity);
            if (roll > chance) continue;
            const turn = Math.PI * 2 * (0.5 + 0.5 * noise.fbm(bx / VENTS.LENGTH - VENTS.X * (k + 1), by / VENTS.LENGTH + VENTS.Y, 1));
            const reach = main.radius * (VENTS.REACH + VENTS.REACH_SPREAD * roll);
            vents.push({
                ...main,
                x: main.x + Math.cos(turn) * reach,
                y: main.y + Math.sin(turn) * reach,
                radius: main.radius * VENTS.SIZE,
                top: context.seaLevel + (main.top - context.seaLevel) * VENTS.HEIGHT,
                age: Math.max(0, main.age - VENTS.YOUNGER),
                armAngle: main.armAngle + turn,
            });
        }
        return vents;
    }
}

const SIDE_NOISE = { RATE: 0.9, X: 17, Y: 2.2, TREND: 0.55, LENGTH: 9 };
const SIZE = { BUSY: 0.9, QUIET: 0.4, MIN: 0.3, SPREAD: 0.75, LENGTH: 6, X: 90 };
const ARMS = { LENGTH: 4, X: 20 };
const VENTS = { MAX: 2, LENGTH: 3, X: 40, Y: 5, SECOND_CHANCE: 0.6, QUIET_CHANCE: 0.6, BUSY_CHANCE: 0.6, REACH: 0.7, REACH_SPREAD: 0.4, SIZE: 0.7, HEIGHT: 0.75, YOUNGER: 0.02 };
