import { FILRODENSWMB } from "../../config.js";
import { FeatureMath } from "./FeatureMath.js";
import { FeatureDelta } from "./FeatureDelta.js";
import { GroundRelief } from "./GroundRelief.js";
import { AlongTable, LineField } from "./LineField.js";
import { DetailedField } from "./FeatureNoise.js";

const { smoothstep } = FeatureMath;

/**
 * A mountain range where two plates collide: a broad uplift with steep fronts, highest along a
 * wandering crest, varying in width and height along its length and tapering at its ends.
 *
 * Its texture depends on its style:
 *   - simple: rolling hills of its own, with the land's own hills and valleys raised and
 *     enlarged on top (the ground's relief is amplified under the range), so it looks like the
 *     terrain around it, only bigger, and still has relief where the ground has none;
 *   - fold: long parallel ridges and valleys running along the range, as in a fold belt;
 *   - rugged: sharp ridges and valleys running from the crest down to each front.
 *
 * `thickness` is the range's half-width in map pixels, `strength` its height as a share of the
 * land's height range, and `style` one of the RANGE.STYLES keys.
 */
export class RangeFeature {
    static plan(fault, context) {
        const settings = FILRODENSWMB.TECTONICS.FEATURES.RANGE;
        const field = new LineField(fault.points, fault.thickness * settings.REACH, context.width, context.height);
        return { field, bounds: field.bounds };
    }

    static render(plan, fault, context) {
        const settings = FILRODENSWMB.TECTONICS.FEATURES.RANGE;
        const style = settings.STYLES[fault.style] ?? settings.STYLES[settings.DEFAULT_STYLE];
        const { field } = plan;
        const noise = context.noise;
        const delta = new FeatureDelta(plan.bounds);
        const relief = GroundRelief.measure(context.ground, context.width, context.height, plan.bounds, Math.max(1, Math.round(settings.RELIEF_RADIUS / noise.perPixel)));
        const along = RangeFeature.#alongTables(field, fault.thickness, noise);
        const front = new DetailedField(noise, plan.bounds, settings.FRONT_NOISE_LENGTH, 3, FRONT_OFFSET);
        const hills = style.hills > 0 ? new DetailedField(noise, plan.bounds, style.hillScale, HILL_OCTAVES, HILL_OFFSET) : null;
        const shape = { halfWidth: fault.thickness, height: fault.strength * (1 - context.seaLevel), style, field, along, relief, front, hills, noise };
        const line = { across: 0, along: 0 };

        for (let y = plan.bounds.minY; y <= plan.bounds.maxY; y++) {
            for (let x = plan.bounds.minX; x <= plan.bounds.maxX; x++) {
                if (!field.sample(x, y, line)) continue;
                delta.data[delta.indexOf(x, y)] = RangeFeature.#changeAt(x, y, line, shape);
            }
        }
        return delta;
    }

    /** The noise that varies only along the range, read once per baseline pixel of its length. */
    static #alongTables(field, halfWidth, noise) {
        const settings = FILRODENSWMB.TECTONICS.FEATURES.RANGE;
        return {
            wander: new AlongTable(field.length, noise.perPixel, (b) => noise.fbm(b / settings.WANDER_LENGTH + ALONG_OFFSETS.WANDER, ALONG_OFFSETS.WANDER_Y, 3) * settings.WANDER * halfWidth),
            width: new AlongTable(field.length, noise.perPixel, (b) => halfWidth * (1 + settings.WIDTH_VARIATION * noise.fbm(b / settings.WIDTH_VARIATION_LENGTH + ALONG_OFFSETS.WIDTH, ALONG_OFFSETS.WIDTH_Y, 3))),
            height: new AlongTable(field.length, noise.perPixel, (b) => 1 - settings.HEIGHT_VARIATION + settings.HEIGHT_VARIATION * noise.fbm(b / settings.HEIGHT_VARIATION_LENGTH + ALONG_OFFSETS.HEIGHT, ALONG_OFFSETS.HEIGHT_Y, 2)),
        };
    }

    static #changeAt(x, y, line, shape) {
        const settings = FILRODENSWMB.TECTONICS.FEATURES.RANGE;
        const { along, noise, style } = shape;
        const offset = line.across - along.wander.at(line.along);
        const across = Math.abs(offset) / along.width.at(line.along);
        if (across >= 1) return 0;

        const bx = noise.bx(x);
        const by = noise.by(y);
        // Broad uplift with fronts broken up by noise, so the foot is not a clean line
        const front = settings.FRONT_NOISE * shape.front.at(x, y);
        const envelope = 1 - smoothstep(settings.PLATEAU, 1, across + front);
        if (envelope <= 0) return 0;

        const crest = 1 - settings.CREST * smoothstep(0, 1, across);
        const taper = FeatureMath.endTaper(line.along, shape.field.length, shape.halfWidth * settings.END_TAPER);
        const form = envelope * taper * along.height.at(line.along);
        const texture = RangeFeature.#texture(x, y, bx, by, line.along * noise.perPixel, offset * noise.perPixel, across, shape);
        const uplift = shape.height * form * crest * (style.valleyFloor + (1 - style.valleyFloor) * texture);
        return uplift + style.amplify * form * shape.relief.at(x, y);
    }

    /**
     * The style's relief, from 0 (valley) to 1 (crest). Hills are rolling fractal noise; spurs are
     * ridged noise stretched across
     * the range so ridges run from the crest to each front (weakest on the crest itself, where
     * they meet); folds are stretched along it; peaks have no direction.
     */
    static #texture(x, y, bx, by, alongBaseline, acrossBaseline, across, shape) {
        const { style, noise } = shape;
        const total = style.spur + style.fold + style.peaks + style.hills;
        if (total <= 0) return 0;
        let sum = 0;
        if (style.hills > 0) sum += style.hills * (0.5 + 0.5 * shape.hills.at(x, y));
        if (style.spur > 0) sum += style.spur * noise.ridged(alongBaseline / style.spurAlong, acrossBaseline / style.spurAcross, 4, noise.detail) * smoothstep(SPUR_FADE.FROM, SPUR_FADE.TO, across);
        if (style.fold > 0) sum += style.fold * noise.ridged(alongBaseline / style.foldAlong, acrossBaseline / style.foldAcross, 4, noise.detail);
        if (style.peaks > 0) sum += style.peaks * noise.ridged(bx / style.peakScale, by / style.peakScale, 5, noise.detail);
        return sum / total;
    }
}

const ALONG_OFFSETS = { WANDER: 11.1, WANDER_Y: 3.3, WIDTH: -7.7, WIDTH_Y: 9.1, HEIGHT: 3.1, HEIGHT_Y: -5.2 };
const FRONT_OFFSET = 50;
const HILL_OCTAVES = 5;
const HILL_OFFSET = 170;
const SPUR_FADE = { FROM: 0.02, TO: 0.35 };
