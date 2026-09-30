import { FILRODENSWMB } from "../../config.js";
import { FeatureMath } from "./FeatureMath.js";
import { FeatureDelta } from "./FeatureDelta.js";
import { AlongTable, LineField } from "./LineField.js";
import { Volcanoes } from "./Volcanoes.js";
import { DetailedField } from "./FeatureNoise.js";

const { smoothstep, bump } = FeatureMath;

/**
 * A subduction zone: one plate sliding under another along the drawn line.
 *
 * The drawing direction sets which plate is which. The overriding plate lies on the side
 * anticlockwise from the direction of drawing (the left-hand side on screen); the subducting
 * plate on the other. Across the line, from the subducting side:
 *   - a gentle outer rise, where the plate flexes before it bends down;
 *   - the trench, deepest just off the line, steeper on the overriding side;
 *   - the forearc, a slope rising from the trench, lined with ridges along it;
 *   - the volcanic arc, a raised band `arcDistance` of the width from the line, carrying a line
 *     of stratovolcanoes with irregular spacing and sizes (see Volcanoes.walkStations).
 * In the ocean this makes an island arc; along a continent's edge, a volcanic mountain chain.
 *
 * `thickness` is the width from the line to the far side of the arc in map pixels, `strength`
 * the arc's height as a share of the land's height range, `trenchDepth` the trench's depth as a
 * share of the sea level, and `arcDistance` where the arc lies as a share of the width.
 */
export class SubductionFeature {
    static plan(fault, context) {
        const settings = FILRODENSWMB.TECTONICS.FEATURES.SUBDUCTION;
        const field = new LineField(fault.points, fault.thickness * settings.REACH, context.width, context.height);
        return { field, bounds: field.bounds };
    }

    static render(plan, fault, context) {
        const settings = FILRODENSWMB.TECTONICS.FEATURES.SUBDUCTION;
        const noise = context.noise;
        const { field } = plan;
        const delta = new FeatureDelta(plan.bounds);
        const shape = {
            width: fault.thickness,
            height: fault.strength * (1 - context.seaLevel),
            trenchDepth: (fault.trenchDepth ?? settings.DEFAULT_TRENCH_DEPTH) * context.seaLevel,
            arcAt: fault.arcDistance ?? settings.DEFAULT_ARC_DISTANCE,
            wander: new AlongTable(field.length, noise.perPixel, (b) => noise.fbm(b / settings.WANDER_LENGTH + ALONG_OFFSETS.WANDER, ALONG_OFFSETS.WANDER_Y, 3) * settings.WANDER * fault.thickness),
            // The zone narrows along its length (never past the width set), and everything across
            // it (trench, forearc, arc and its volcanoes) narrows with it
            widthFactor: new AlongTable(field.length, noise.perPixel, (b) => FeatureMath.narrowing(noise.fbm(b / settings.WIDTH_VARIATION_LENGTH + ALONG_OFFSETS.WIDTH, ALONG_OFFSETS.WIDTH_Y, 3), settings.WIDTH_VARIATION)),
            trenchNoise: new AlongTable(field.length, noise.perPixel, (b) => 1 - settings.TRENCH.NOISE + settings.TRENCH.NOISE * noise.fbm(b / settings.TRENCH.NOISE_LENGTH, ALONG_OFFSETS.TRENCH_Y, 3)),
            roughness: new DetailedField(noise, plan.bounds, settings.ARC.NOISE_LENGTH, 4, ARC_NOISE_OFFSET),
            field,
            noise,
        };
        const line = { across: 0, along: 0 };

        for (let y = plan.bounds.minY; y <= plan.bounds.maxY; y++) {
            for (let x = plan.bounds.minX; x <= plan.bounds.maxX; x++) {
                if (!field.sample(x, y, line)) continue;
                delta.data[delta.indexOf(x, y)] = SubductionFeature.#changeAt(x, y, line, shape);
            }
        }

        Volcanoes.stampStratos(delta, SubductionFeature.#arcVolcanoes(field, fault, shape, context), context);
        return delta;
    }

    static #changeAt(x, y, line, shape) {
        const settings = FILRODENSWMB.TECTONICS.FEATURES.SUBDUCTION;
        // Distance across as a share of the width: positive on the overriding plate
        const sigma = (line.across - shape.wander.at(line.along)) / (shape.width * shape.widthFactor.at(line.along));
        if (sigma < -1 || sigma > 1) return 0;

        const rise = settings.OUTER_RISE;
        const trench = settings.TRENCH;
        let change = rise.HEIGHT * shape.trenchDepth * bump(sigma, rise.AT, rise.WIDTH);
        const trenchWidth = sigma < trench.AT ? trench.OUTER_WIDTH : trench.INNER_WIDTH;
        change -= shape.trenchDepth * shape.trenchNoise.at(line.along) * bump(sigma, trench.AT, trenchWidth);
        if (sigma > 0) change += SubductionFeature.#overridingPlate(x, y, sigma, line, shape);
        return change * FeatureMath.endTaper(line.along, shape.field.length, shape.width * settings.END_TAPER);
    }

    /** The forearc slope and the arc's raised band, on the overriding plate. */
    static #overridingPlate(x, y, sigma, line, shape) {
        const settings = FILRODENSWMB.TECTONICS.FEATURES.SUBDUCTION;
        const { noise, arcAt } = shape;
        const forearc = settings.FOREARC;
        const arc = settings.ARC;
        // Noise is only read where the slope or band it textures is there at all
        const slope = smoothstep(FOREARC_RISE.FROM, arcAt - FOREARC_RISE.BEFORE_ARC, sigma) * (1 - smoothstep(arcAt + FOREARC_RISE.AFTER_ARC, 1, sigma));
        const ridges = slope > 0 ? noise.ridged((line.along * noise.perPixel) / forearc.RIDGE_ALONG, (sigma * shape.width * noise.perPixel) / forearc.RIDGE_ACROSS, 3, noise.detail) : 0;
        const band = bump(sigma, arcAt, arc.WIDTH);
        const roughness = band > MIN_BAND ? shape.roughness.at(x, y) : 0;
        return shape.height * (forearc.HEIGHT * slope * (1 - forearc.RIDGES + forearc.RIDGES * ridges) + arc.HEIGHT * band * (ARC_BASE + arc.NOISE * roughness));
    }

    /**
     * Stratovolcanoes along a line parallel to the drawn one, through the arc. Their spacing,
     * sizes and quiet stretches vary as a hotspot chain's do, since the supply of magma along an
     * arc varies too; bigger volcanoes grow in its busier stretches.
     */
    static #arcVolcanoes(field, fault, shape, context) {
        const settings = FILRODENSWMB.TECTONICS.FEATURES.SUBDUCTION;
        const noise = context.noise;
        const radius = shape.width * settings.VOLCANO_RADIUS;
        const curve = field.offsetCurve((along) => shape.arcAt * shape.width * shape.widthFactor.at(along) + shape.wander.at(along));
        const length = curve.reduce((sum, point, i) => (i === 0 ? 0 : sum + Math.hypot(point.x - curve[i - 1].x, point.y - curve[i - 1].y)), 0);
        const stations = Volcanoes.walkStations(
            curve,
            length,
            {
                spacing: radius * settings.VOLCANO_SPACING,
                minStep: radius * FILRODENSWMB.TECTONICS.FEATURES.VOLCANO.MIN_STEP,
                variation: fault.variation ?? FILRODENSWMB.TECTONICS.FEATURES.HOTSPOT.DEFAULT_VARIATION,
                pulses: settings.VOLCANO_PULSES,
                pulseLength: radius * settings.VOLCANO_PULSE_LENGTH,
            },
            noise,
            ARC_STATION_SEED,
        );

        const volcanoes = [];
        for (const station of stations) {
            const fade = FeatureMath.endTaper(station.along * length, length, shape.width * settings.END_TAPER);
            if (fade <= MIN_VOLCANO_FADE) continue;
            const bx = noise.bx(station.x);
            const by = noise.by(station.y);
            // A little either side of the arc's line (its left normal is (dy, -dx))
            const offset = noise.fbm(bx / VOLCANO_NOISE.OFFSET_LENGTH, by / VOLCANO_NOISE.OFFSET_LENGTH, 2) * radius * VOLCANO_NOISE.OFFSET;
            const size = Math.max(VOLCANO_NOISE.MIN_SIZE, Math.exp(VOLCANO_NOISE.SIZE_SPREAD * noise.fbm(bx / VOLCANO_NOISE.SIZE_LENGTH + VOLCANO_NOISE.SIZE_X, by / VOLCANO_NOISE.SIZE_LENGTH, 2)) * (VOLCANO_NOISE.QUIET_SIZE + VOLCANO_NOISE.BUSY_SIZE * station.activity));
            volcanoes.push({
                x: station.x + station.dy * offset,
                y: station.y - station.dx * offset,
                radius: radius * size,
                rise: shape.height * settings.VOLCANO_HEIGHT * size * fade,
                angle: Math.PI * noise.fbm(bx / VOLCANO_NOISE.ANGLE_LENGTH + VOLCANO_NOISE.ANGLE_X, by / VOLCANO_NOISE.ANGLE_LENGTH, 1),
            });
        }
        return volcanoes;
    }
}

const ALONG_OFFSETS = { WANDER: 21.1, WANDER_Y: 1.3, TRENCH_Y: 7.7, WIDTH: -13.3, WIDTH_Y: 6.6 };
// Where the forearc starts rising, and how far short of and beyond the arc it levels off
const FOREARC_RISE = { FROM: 0.02, BEFORE_ARC: 0.1, AFTER_ARC: 0.15 };
const ARC_BASE = 0.75;
// Below this the arc's band adds too little for its roughness to matter
const MIN_BAND = 0.002;
const ARC_NOISE_OFFSET = 60;
const ARC_STATION_SEED = 500;
const MIN_VOLCANO_FADE = 0.05;
const VOLCANO_NOISE = {
    OFFSET: 0.8,
    OFFSET_LENGTH: 20,
    SIZE_SPREAD: 0.5,
    SIZE_LENGTH: 9,
    SIZE_X: 40,
    MIN_SIZE: 0.4,
    QUIET_SIZE: 0.7,
    BUSY_SIZE: 0.5,
    ANGLE_LENGTH: 4,
    ANGLE_X: -20,
};
