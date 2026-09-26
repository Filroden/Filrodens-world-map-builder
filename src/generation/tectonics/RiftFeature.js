import { FILRODENSWMB } from "../../config.js";
import { FeatureMath } from "./FeatureMath.js";
import { FeatureDelta } from "./FeatureDelta.js";
import { GroundRelief } from "./GroundRelief.js";
import { AlongTable, LineField } from "./LineField.js";
import { CoarseField, DetailedField } from "./FeatureNoise.js";
import { Volcanoes } from "./Volcanoes.js";

const { smoothstep } = FeatureMath;

/**
 * A rift, where plates pull apart: a sunken floor between raised shoulders, built as a chain of
 * half-grabens, as real rifts are.
 *
 * In each stretch of the rift one side is the master fault (a single steep scarp) and the other a
 * gentler ramp stepped by smaller faults, and the master side swaps from stretch to stretch. The
 * floor tilts down towards the master fault, deepens and shallows in basins along the rift, and
 * is partly buried by sediment (which smooths the ground's own relief) but textured with young
 * ground (fans, lava fields, small fault blocks) so it does not look smoothed. The shoulders are
 * highest behind the master fault and rolling rather than smooth. The rift narrows and widens
 * along its length, never wider than the width set. Optional stratovolcanoes rise on the floor
 * and shoulders.
 *
 * Where the floor sinks below sea level it floods. Its ends fade back up to the ground around
 * them, so a rift meant to open into the sea should be drawn out past the coast.
 *
 * `thickness` is the rift's half-width in map pixels, `strength` its depth as a share of the
 * land's height range, `floorTexture` (0 to 1) how rough its floor is, and `volcanoes` (0 to 1)
 * how many volcanoes rise in it.
 */
export class RiftFeature {
    static plan(fault, context) {
        const settings = FILRODENSWMB.TECTONICS.FEATURES.RIFT;
        const field = new LineField(fault.points, fault.thickness * settings.REACH, context.width, context.height);
        return { field, bounds: field.bounds };
    }

    static render(plan, fault, context) {
        const settings = FILRODENSWMB.TECTONICS.FEATURES.RIFT;
        const noise = context.noise;
        const { field } = plan;
        const delta = new FeatureDelta(plan.bounds);
        const depth = fault.strength * (1 - context.seaLevel);
        const shape = {
            halfWidth: fault.thickness,
            depth,
            floorTexture: (fault.floorTexture ?? settings.DEFAULT_FLOOR_TEXTURE) * depth * settings.FLOOR_TEXTURE_HEIGHT,
            relief: GroundRelief.measure(context.ground, context.width, context.height, plan.bounds, Math.max(1, Math.round(settings.RELIEF_RADIUS / noise.perPixel))),
            along: RiftFeature.#alongTables(field, fault.thickness, noise),
            texture: new DetailedField(noise, plan.bounds, settings.FLOOR_TEXTURE_LENGTH, 4, FLOOR_TEXTURE_OFFSET),
            shoulderTexture: new DetailedField(noise, plan.bounds, settings.SHOULDER_TEXTURE_LENGTH, 4, SHOULDER_TEXTURE_OFFSET),
            walls: [RiftFeature.#wallFields(plan.bounds, 0, noise), RiftFeature.#wallFields(plan.bounds, SIDE_SEED, noise)],
            field,
            noise,
        };
        const line = { across: 0, along: 0 };

        for (let y = plan.bounds.minY; y <= plan.bounds.maxY; y++) {
            for (let x = plan.bounds.minX; x <= plan.bounds.maxX; x++) {
                if (!field.sample(x, y, line)) continue;
                delta.data[delta.indexOf(x, y)] = RiftFeature.#changeAt(x, y, line, shape);
            }
        }

        if (fault.volcanoes > 0) Volcanoes.stampStratos(delta, RiftFeature.#volcanoes(field, fault, depth, context), context);
        return delta;
    }

    static #alongTables(field, halfWidth, noise) {
        const settings = FILRODENSWMB.TECTONICS.FEATURES.RIFT;
        const table = (fn) => new AlongTable(field.length, noise.perPixel, fn);
        return {
            wander: table((b) => noise.fbm(b / settings.WANDER_LENGTH + ALONG_OFFSETS.WANDER, ALONG_OFFSETS.WANDER_Y, 3) * settings.WANDER * halfWidth),
            width: table((b) => halfWidth * FeatureMath.narrowing(noise.fbm(b / settings.WIDTH_VARIATION_LENGTH + ALONG_OFFSETS.WIDTH, ALONG_OFFSETS.WIDTH_Y, 3), settings.WIDTH_VARIATION)),
            // Which side the master fault is on: -1 (clockwise side) to 1 (anticlockwise side).
            // The walls swap sharply; the shoulders and floor tilt follow a gentler version, since a
            // sharp swap in their height shows as a step across the whole shoulder.
            master: table((b) => Math.tanh(MASTER_SHARPNESS * RiftFeature.#masterNoise(b, noise))),
            masterSoft: table((b) => RiftFeature.#masterNoise(b, noise)),
            basin: table((b) => 1 - settings.BASIN_VARIATION + settings.BASIN_VARIATION * noise.fbm(b / settings.BASIN_LENGTH + ALONG_OFFSETS.BASIN, ALONG_OFFSETS.BASIN_Y, 2)),
        };
    }

    static #masterNoise(b, noise) {
        const settings = FILRODENSWMB.TECTONICS.FEATURES.RIFT;
        return noise.fbm(b / settings.SEGMENT_LENGTH + ALONG_OFFSETS.MASTER, ALONG_OFFSETS.MASTER_Y, 2);
    }

    static #changeAt(x, y, line, shape) {
        const settings = FILRODENSWMB.TECTONICS.FEATURES.RIFT;
        const { along } = shape;
        const offset = line.across - along.wander.at(line.along);
        const halfWidth = along.width.at(line.along);
        const across = Math.abs(offset) / halfWidth;
        if (across >= MAX_ACROSS) return 0;

        const side = Math.sign(offset || 1);
        const onMaster = 0.5 + 0.5 * along.master.at(line.along) * side; // 1 on the master fault's side
        const softMaster = along.masterSoft.at(line.along);
        const onMasterSoft = 0.5 + 0.5 * softMaster * side;
        const walls = RiftFeature.#walls(x, y, across, shape.walls[offset > 0 ? 0 : 1]);
        const drop = walls.master * onMaster + walls.ramp * (1 - onMaster);
        const tilt = 1 + settings.TILT * softMaster * Math.tanh(offset / (halfWidth * settings.FLOOR));

        const floor = 1 - smoothstep(settings.FLOOR * FLOOR_EDGE, settings.FLOOR, across);
        const shoulderShape = FeatureMath.bump(across, settings.WALL_END + SHOULDER_PEAK, SHOULDER_WIDTH) * smoothstep(settings.FLOOR, settings.WALL_END, across) * (1 - smoothstep(SHOULDER_FADE.FROM, SHOULDER_FADE.TO, across));
        const shoulderHills = shoulderShape > 0 ? settings.SHOULDER_TEXTURE * (0.5 + 0.5 * shape.shoulderTexture.at(x, y)) : 0;
        const shoulder = shoulderShape * (settings.SHOULDER * (SHOULDER_BASE + SHOULDER_MASTER * onMasterSoft) + shoulderHills);
        const textureFade = 1 - smoothstep(settings.FLOOR * TEXTURE_FADE, settings.WALL_END, across);
        const texture = textureFade > 0 ? shape.floorTexture * textureFade * shape.texture.at(x, y) : 0;

        const change = shape.depth * (shoulder - drop * along.basin.at(line.along) * tilt) - settings.INFILL * floor * shape.relief.at(x, y) + texture;
        return change * FeatureMath.endTaper(line.along, shape.field.length, shape.halfWidth * settings.END_TAPER);
    }

    /**
     * The noise that moves one side's walls: where its master wall stands, and where each of its
     * ramp's steps stands. It is read at the pixel's world position, not along the line, since
     * the distance along can jump on the inside of a bend and would leave seams across the walls.
     * It has no detail layers, so it is worked out on a coarse grid (see CoarseField).
     */
    static #wallFields(bounds, sideSeed, noise) {
        const settings = FILRODENSWMB.TECTONICS.FEATURES.RIFT;
        const field = (length, offsetX, offsetY) => new CoarseField(bounds, CoarseField.stepFor(length / WALL_FINEST_SHARE, noise), (x, y) => noise.fbm(noise.bx(x) / length + offsetX, noise.by(y) / length + offsetY, 3));
        const stepLength = settings.WALL_NOISE_LENGTH * RAMP_NOISE_STRETCH;
        const ramp = [];
        for (let n = 0; n < settings.RAMP_STEPS; n++) ramp.push(field(stepLength, n * RAMP_STEP_OFFSET + sideSeed, sideSeed));
        return { master: field(settings.WALL_NOISE_LENGTH, sideSeed, 0), ramp };
    }

    /**
     * How far the ground has dropped at `across` (0 outside the walls, 1 on the floor), on the
     * master side (one steep wall) and on the ramp side (smaller steps spread wider).
     */
    static #walls(x, y, across, fields) {
        const settings = FILRODENSWMB.TECTONICS.FEATURES.RIFT;
        const wallAt = settings.FLOOR + settings.WALL_NOISE * fields.master.at(x, y);
        const master = 1 - smoothstep(wallAt - settings.MASTER_WALL_WIDTH, wallAt + settings.MASTER_WALL_WIDTH, across);

        let ramp = 0;
        const steps = settings.RAMP_STEPS;
        for (let n = 0; n < steps; n++) {
            const at = settings.FLOOR + ((settings.WALL_END - settings.FLOOR) * (n + 0.5)) / steps + settings.WALL_NOISE * fields.ramp[n].at(x, y);
            ramp += (1 - smoothstep(at - settings.RAMP_STEP_WIDTH, at + settings.RAMP_STEP_WIDTH, across)) / steps;
        }
        return { master, ramp };
    }

    /** Stratovolcanoes on the rift floor and shoulders, `volcanoes` (0 to 1) setting how many. */
    static #volcanoes(field, fault, depth, context) {
        const settings = FILRODENSWMB.TECTONICS.FEATURES.RIFT;
        const noise = context.noise;
        const radius = fault.thickness * settings.VOLCANO_RADIUS;
        const stations = Volcanoes.walkStations(
            field.curve,
            field.length,
            { spacing: fault.thickness * settings.VOLCANO_SPACING, minStep: radius * FILRODENSWMB.TECTONICS.FEATURES.VOLCANO.MIN_STEP, variation: 1, pulses: 0, pulseLength: radius },
            noise,
            RIFT_STATION_SEED,
        );

        const volcanoes = [];
        for (const station of stations) {
            const bx = noise.bx(station.x);
            const by = noise.by(station.y);
            if (0.5 + 0.5 * noise.fbm(bx / VOLCANO_NOISE.CHANCE_LENGTH + VOLCANO_NOISE.CHANCE_X, by / VOLCANO_NOISE.CHANCE_LENGTH, 1) > fault.volcanoes) continue;
            const fade = FeatureMath.endTaper(station.along * field.length, field.length, fault.thickness * settings.END_TAPER);
            const offset = fault.thickness * VOLCANO_NOISE.OFFSET * noise.fbm(bx / VOLCANO_NOISE.OFFSET_LENGTH + VOLCANO_NOISE.OFFSET_X, by / VOLCANO_NOISE.OFFSET_LENGTH, 1);
            const size = VOLCANO_NOISE.MIN_SIZE + VOLCANO_NOISE.SIZE_RANGE * (0.5 + 0.5 * noise.fbm(bx / VOLCANO_NOISE.SIZE_LENGTH, by / VOLCANO_NOISE.SIZE_LENGTH + VOLCANO_NOISE.SIZE_Y, 1));
            volcanoes.push({
                x: station.x + station.dy * offset,
                y: station.y - station.dx * offset,
                radius: radius * size,
                rise: depth * settings.VOLCANO_HEIGHT * fade,
                angle: Math.PI * noise.fbm(bx / VOLCANO_NOISE.ANGLE_LENGTH, by / VOLCANO_NOISE.ANGLE_LENGTH + VOLCANO_NOISE.ANGLE_Y, 1),
            });
        }
        return volcanoes;
    }
}

const ALONG_OFFSETS = { WANDER: 5.5, WANDER_Y: 2.2, WIDTH: -3.3, WIDTH_Y: 4.4, MASTER: 77.7, MASTER_Y: 0.5, BASIN: 9.9, BASIN_Y: 3.1 };
// Sharpens the swap between master sides so each stretch clearly has one
const MASTER_SHARPNESS = 3;
// Noise offset for the clockwise side's walls, so the two walls wander independently
const SIDE_SEED = 50;
// Beyond this (as a share of the half-width) the rift changes nothing
const MAX_ACROSS = 1.6;
// The floor proper (buried by sediment) begins at this share of the floor's width
const FLOOR_EDGE = 0.6;
const TEXTURE_FADE = 0.8;
const FLOOR_TEXTURE_OFFSET = 210;
const SHOULDER_TEXTURE_OFFSET = 330;
const RAMP_NOISE_STRETCH = 1.1;
// The wall noise has three layers, so its finest is a quarter of its wavelength
const WALL_FINEST_SHARE = 4;
const RAMP_STEP_OFFSET = 13;
const SHOULDER_BASE = 0.6;
const SHOULDER_MASTER = 0.8;
const SHOULDER_PEAK = 0.15;
const SHOULDER_WIDTH = 0.35;
// The shoulders fade to nothing before MAX_ACROSS, so the rift's edge leaves no line
const SHOULDER_FADE = { FROM: 1.2, TO: 1.5 };
const RIFT_STATION_SEED = 800;
const VOLCANO_NOISE = {
    CHANCE_LENGTH: 5,
    CHANCE_X: 11,
    OFFSET: 0.9,
    OFFSET_LENGTH: 7,
    OFFSET_X: -11,
    MIN_SIZE: 0.7,
    SIZE_RANGE: 0.6,
    SIZE_LENGTH: 3,
    SIZE_Y: 9,
    ANGLE_LENGTH: 4,
    ANGLE_Y: 20,
};
