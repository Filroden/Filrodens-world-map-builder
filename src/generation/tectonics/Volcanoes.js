import { FILRODENSWMB } from "../../config.js";
import { FeatureMath } from "./FeatureMath.js";
import { LazyField } from "./FeatureDelta.js";
import { DetailedField } from "./FeatureNoise.js";

const { smoothstep } = FeatureMath;

/**
 * Volcanoes for the tectonic features: where they stand along a line, and their shapes.
 *
 * Two kinds:
 *   - Shield volcanoes (hotspot chains): broad islands built from the seabed. Each is sized so
 *     its young coast lies a set distance from its summit, then subsides, erodes and finally
 *     drowns with age (see #shieldSurface).
 *   - Stratovolcanoes (volcanic arcs, rifts): steep, concave cones that bury the ground they stand
 *     on (see stampStratos).
 *
 * Volcanoes are surfaces in absolute elevation, not bumps added to the ground, and overlapping
 * volcanoes combine by taking the (smoothly) highest surface, so two volcanoes side by side merge
 * into one island instead of piling up into a volcano twice the height.
 */
export class Volcanoes {
    // --- Placement along a line ---

    /**
     * Stations along a curve where volcanoes form, walked from its start.
     *
     * Each step to the next station is the spacing, varied by:
     *   - its own lognormal spread (with variation 1, some steps are a third of the spacing and
     *     some three times it);
     *   - now and then a much longer pause, leaving a wide gap;
     *   - the activity at the time (busy periods crowd stations closer, and in the quietest
     *     periods no volcano forms at all). Activity is slow noise along the line, standing in
     *     for changes in plate speed, crust thickness or magma supply;
     *   - an optional trend from one end to the other (the plate speeding up or slowing down).
     * Steps are capped at MAX_STEP spacings, so no stretch of the line is left empty only by
     * several large factors happening to multiply together.
     *
     * The step noise is read at the station's number, not its position, so the same line gives
     * the same stations on a regional map (whose line is the parent's, scaled).
     *
     * @param {{x: number, y: number}[]} curve - The line, in map pixels.
     * @param {number} length - The curve's length in map pixels.
     * @param {object} options - `spacing` and `minStep` (map pixels), `variation` (0-1), `pulses`
     *   (0-1), `pulseLength` (map pixels), optional `trend` (-1 to 1) and `keepLast` (always put a
     *   volcano at the end of the line).
     * @param {FeatureNoise} noise - The feature noise.
     * @param {number} [seed] - Offsets the noise, so two lines of volcanoes on one feature differ.
     * @returns {{x: number, y: number, dx: number, dy: number, along: number, activity: number}[]}
     *   `along` is 0 at the start of the line and 1 at its end; (dx, dy) the line's direction.
     */
    static walkStations(curve, length, options, noise, seed = 0) {
        const settings = FILRODENSWMB.TECTONICS.FEATURES.VOLCANO;
        const activityAt = (d) => Volcanoes.#activity(d / options.pulseLength + seed, noise);
        const stations = [];
        let distance = 0;
        for (let n = 0; distance <= length; n++) {
            const along = length > 0 ? distance / length : 1;
            const activity = activityAt(distance);
            if (activity >= options.pulses * settings.QUIET_ACTIVITY) stations.push({ ...Volcanoes.pointAt(curve, distance), along, activity });
            distance += Volcanoes.#stepLength(n + seed, along, activity, options, noise);
        }

        const last = stations.at(-1);
        if (options.keepLast && (!last || last.along < KEEP_LAST_FROM)) {
            stations.push({ ...Volcanoes.pointAt(curve, length), along: 1, activity: Math.max(0.5, activityAt(length)) });
        }
        return stations;
    }

    /** The point `distance` pixels along the curve, with the curve's unit direction there. */
    static pointAt(curve, distance) {
        let run = 0;
        for (let i = 0; i < curve.length - 1; i++) {
            const a = curve[i];
            const b = curve[i + 1];
            const length = Math.hypot(b.x - a.x, b.y - a.y);
            if (run + length >= distance || i === curve.length - 2) {
                const f = length === 0 ? 0 : Math.min(1, (distance - run) / length);
                return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, dx: (b.x - a.x) / (length || 1), dy: (b.y - a.y) / (length || 1) };
            }
            run += length;
        }
        return { x: curve[0].x, y: curve[0].y, dx: 1, dy: 0 };
    }

    static #activity(position, noise) {
        const value = 0.5 + 0.5 * ACTIVITY_CONTRAST * noise.fbm(position + ACTIVITY_OFFSET.X, ACTIVITY_OFFSET.Y, ACTIVITY_OCTAVES);
        return FeatureMath.clamp(value, 0, 1);
    }

    static #stepLength(n, along, activity, options, noise) {
        const settings = FILRODENSWMB.TECTONICS.FEATURES.VOLCANO;
        const variation = options.variation;
        const jitter = noise.fbm(n * STEP_NOISE.JITTER_RATE + STEP_NOISE.JITTER_X, STEP_NOISE.JITTER_Y, 1);
        const pause = noise.fbm(n * STEP_NOISE.PAUSE_RATE + STEP_NOISE.PAUSE_X, STEP_NOISE.PAUSE_Y, 1);
        const pauseAt = settings.PAUSE_THRESHOLD - settings.PAUSE_THRESHOLD_SPREAD * variation;
        const gap = variation > 0 && pause > pauseAt ? 1 + settings.PAUSE_LENGTH * variation : 1;
        const busy = 1 + options.pulses * (settings.BUSY_CROWDING - 2 * settings.BUSY_CROWDING * activity);
        const trend = Math.pow(2, (options.trend ?? 0) * (2 * along - 1));
        const step = options.spacing * busy * trend * Math.exp(settings.STEP_SPREAD * variation * jitter) * gap;
        return Math.max(options.minStep, Math.min(options.spacing * settings.MAX_STEP, step));
    }

    // --- Shield volcanoes ---

    /**
     * Works out the parts of each shield volcano that do not change from pixel to pixel, from the
     * ground it stands on. Volcanoes whose summit would not rise above the ground are dropped.
     *
     * Each volcano is described by `x`, `y`, `radius` (its island's radius at sea level when
     * young), `top` (its young summit elevation), `age` (0 active to 1 oldest), `drownAge` (the
     * age at which its summit reaches sea level), `arms` and `armAngle` (its rift zones).
     *
     * @returns {object[]} The volcanoes that stand, each with a `model`.
     */
    static prepareShields(volcanoes, context) {
        const standing = [];
        for (const volcano of volcanoes) {
            const centre = Volcanoes.#groundAt(context, volcano.x, volcano.y);
            const first = Volcanoes.#shieldModel(volcano, centre, context.seaLevel);
            if (!first) continue;
            // It stands on the lowest ground around its foot, so the foot never ends in a step
            // above lower ground; sized first on the ground at its centre to know where its foot is
            const model = Volcanoes.#shieldModel(volcano, Volcanoes.#lowestAround(context, volcano, first.footprint), context.seaLevel);
            if (!model) continue;
            volcano.model = model;
            volcano.lobes = Volcanoes.#lobeTable(volcano, context.noise);
            standing.push(volcano);
        }
        return standing;
    }

    /** The box every prepared volcano can reach, clipped to the map, or null. */
    static boundsOf(volcanoes, width, height) {
        let bounds = null;
        for (const volcano of volcanoes) {
            const reach = volcano.model.footprint * LOBE_REACH_MARGIN;
            const box = {
                minX: Math.max(0, Math.floor(volcano.x - reach)),
                maxX: Math.min(width - 1, Math.ceil(volcano.x + reach)),
                minY: Math.max(0, Math.floor(volcano.y - reach)),
                maxY: Math.min(height - 1, Math.ceil(volcano.y + reach)),
            };
            if (box.minX > box.maxX || box.minY > box.maxY) continue;
            bounds = bounds ? { minX: Math.min(bounds.minX, box.minX), maxX: Math.max(bounds.maxX, box.maxX), minY: Math.min(bounds.minY, box.minY), maxY: Math.max(bounds.maxY, box.maxY) } : box;
        }
        return bounds;
    }

    /**
     * Adds prepared shield volcanoes to `delta`: at each pixel, how far the smoothly highest
     * volcano surface stands above the ground (never below it: a shield only builds up).
     */
    static stampShields(delta, volcanoes, context) {
        const settings = FILRODENSWMB.TECTONICS.FEATURES.VOLCANO;
        const lift = new Float32Array(delta.data.length);
        const textures = Volcanoes.#shieldTextures(delta, context.noise);
        for (const volcano of volcanoes) {
            Volcanoes.#forEachPixel(delta, volcano, volcano.model.footprint * LOBE_REACH_MARGIN, (x, y, r, angle) => {
                if (r >= LOBE_REACH_MARGIN) return;
                const q = r / (1 + (Volcanoes.#lobeAt(volcano, angle) - 1) * smoothstep(SHIELD_LOBE_START.FROM, SHIELD_LOBE_START.TO, r));
                if (q >= 1) return;
                const surface = Volcanoes.#shieldSurface(q, x, y, volcano, textures, context.seaLevel);
                const above = surface - Volcanoes.#groundAt(context, x, y);
                if (above <= 0) return;
                const index = delta.indexOf(x, y);
                lift[index] = lift[index] > 0 ? FeatureMath.smax(lift[index], above, settings.BLEND) : above;
            });
        }
        for (let i = 0; i < lift.length; i++) delta.data[i] += lift[i];
    }

    static #shieldModel(volcano, floor, seaLevel) {
        const bottom = Math.min(floor, seaLevel - MIN_SHIELD_DEPTH);
        const rise = volcano.top - bottom;
        if (!(rise > 0)) return null;
        // Size the young volcano so its coast (sea level) lies `radius` from the summit
        const coastShare = volcano.top > seaLevel ? Volcanoes.#shieldInverse((seaLevel - bottom) / rise) : SUBMARINE_COAST_SHARE;
        const footprint = volcano.radius / Math.max(MIN_COAST_SHARE, coastShare);
        // It subsides steadily, its summit reaching sea level at drownAge, and keeps sinking
        // after, down to a limit so the oldest remain as seamounts
        const aboveSea = Math.max(0, volcano.top - seaLevel);
        const sunk = aboveSea * (volcano.age / Math.max(MIN_DROWN_AGE, volcano.drownAge));
        const subsidence = Math.min(sunk, aboveSea + MAX_SEAMOUNT_SINK * (seaLevel - bottom));
        return { footprint, floor: bottom, top: volcano.top, subsidence, coastShare };
    }

    /** The shield profile, read from a table (see #profileTables). */
    static #shieldProfile(q) {
        return Volcanoes.#lookup(Volcanoes.#profileTables().shield, q);
    }

    /** The dome profile, read from a table (see #profileTables). */
    static #domeProfile(q) {
        return Volcanoes.#lookup(Volcanoes.#profileTables().dome, q);
    }

    /**
     * The shield and dome profiles sampled across the footprint. Both are read for every pixel of
     * every volcano and are made of several powers, which dominated the cost of a hotspot chain on
     * a large map; the table is exact at its samples and smooth between them.
     */
    static #tables = null;

    static #profileTables() {
        if (Volcanoes.#tables) return Volcanoes.#tables;
        const shield = new Float32Array(PROFILE_SAMPLES + 1);
        const dome = new Float32Array(PROFILE_SAMPLES + 1);
        for (let i = 0; i <= PROFILE_SAMPLES; i++) {
            shield[i] = Volcanoes.#shieldShape(i / PROFILE_SAMPLES);
            dome[i] = Volcanoes.#domeShape(i / PROFILE_SAMPLES);
        }
        Volcanoes.#tables = { shield, dome };
        return Volcanoes.#tables;
    }

    static #lookup(table, q) {
        const position = FeatureMath.clamp(q, 0, 1) * PROFILE_SAMPLES;
        const i = Math.min(PROFILE_SAMPLES - 1, Math.floor(position));
        return table[i] + (table[i + 1] - table[i]) * (position - i);
    }

    /**
     * A convex shield over a long concave apron (the debris and lava that spread over the seabed
     * around a volcano's foot), from 1 at the summit to 0 at the foot, so the volcano meets the
     * seabed gently instead of at a sharp foot. `q` is the distance from the summit as a share of
     * the footprint.
     */
    static #shieldShape(q) {
        const settings = FILRODENSWMB.TECTONICS.FEATURES.VOLCANO;
        const shield = Math.pow(Math.max(0, 1 - Math.pow(q / settings.SHIELD_SHARE, SHIELD_EXPONENT.INNER)), SHIELD_EXPONENT.OUTER);
        const apron = Math.pow(1 - q, APRON_EXPONENT);
        return settings.SHIELD_WEIGHT * shield + (1 - settings.SHIELD_WEIGHT) * apron;
    }

    /** The profile's shape once the summit has worn to a dome. */
    static #domeShape(q) {
        const settings = FILRODENSWMB.TECTONICS.FEATURES.VOLCANO;
        const dome = Math.pow(Math.max(0, 1 - (q / settings.SHIELD_SHARE) ** 2), DOME_EXPONENT);
        return settings.SHIELD_WEIGHT * dome + (1 - settings.SHIELD_WEIGHT) * Math.pow(1 - q, APRON_EXPONENT);
    }

    /** The distance (share of the footprint) at which the shield profile falls to `p`. */
    static #shieldInverse(p) {
        let low = 0;
        let high = 1;
        for (let i = 0; i < INVERSE_ITERATIONS; i++) {
            const middle = (low + high) / 2;
            if (Volcanoes.#shieldShape(middle) > p) low = middle;
            else high = middle;
        }
        return (low + high) / 2;
    }

    /**
     * A shield volcano's surface elevation at map pixel (x, y), `q` along its footprint.
     *
     * With age its summit's point wears to a dome, its young summit cone and caldera go, it sinks
     * (model.subsidence), and valleys cut deeper into the part above the sea. Around the age it
     * reaches sea level, the waves plane its top flat and a reef grows on its old coastline: an
     * atoll. Gentle lava-flow noise over the whole volcano makes its coast wander.
     */
    static #shieldSurface(q, x, y, volcano, textures, seaLevel) {
        const model = volcano.model;
        const age = volcano.age;
        const youth = 1 - smoothstep(0, SHIELD_AGE.YOUTH_END, age);
        const worn = DOME_SHARE * smoothstep(SHIELD_AGE.DOME_FROM, SHIELD_AGE.DOME_TO, age);
        let p = Volcanoes.#shieldProfile(q) * (1 - worn) + Volcanoes.#domeProfile(q) * worn;
        p += youth * SUMMIT_CONE.HEIGHT * Math.pow(Math.max(0, 1 - (q / SUMMIT_CONE.RADIUS) ** 2), 2);
        p -= youth * CALDERA.DEPTH * (1 - smoothstep(CALDERA.INNER, CALDERA.OUTER, q));

        const settings = FILRODENSWMB.TECTONICS.FEATURES.VOLCANO;
        let surface = model.floor + (model.top - model.floor) * p - model.subsidence;
        const flowFade = 1 - smoothstep(FLOW_FADE.FROM, FLOW_FADE.TO, q);
        const flowHeight = Math.max(settings.FLOW_NOISE_MIN, settings.FLOW_NOISE * (model.top - model.floor));
        if (flowFade > 0) surface += flowHeight * textures.flows.at(x, y) * flowFade;
        surface = Volcanoes.#erode(surface, age, textures.erosion, x, y, seaLevel);
        return Volcanoes.#atoll(surface, q, age, volcano, x, y, textures, seaLevel);
    }

    /** Cuts valleys into ground above sea level, deeper with age, never down to the sea. */
    static #erode(surface, age, erosion, x, y, seaLevel) {
        const above = surface - seaLevel;
        if (above <= 0) return surface;
        const valley = (1 - Math.abs(erosion.at(x, y))) ** 3;
        const depth = (EROSION.YOUNG + EROSION.OLD * smoothstep(EROSION.AGE_FROM, EROSION.AGE_TO, age)) * valley;
        return surface - Math.min(above * EROSION.MAX_SHARE, depth * above);
    }

    /** Planes the top of a volcano near sea level and grows a reef on its old coastline. */
    static #atoll(surface, q, age, volcano, x, y, textures, seaLevel) {
        const settings = FILRODENSWMB.TECTONICS.FEATURES.VOLCANO;
        const drownAge = volcano.drownAge;
        const planing = smoothstep(drownAge * ATOLL.START_SHARE, drownAge, age) * (1 - smoothstep(drownAge + ATOLL.END_FROM, drownAge + ATOLL.END_TO, age));
        if (planing <= 0 || !volcano.model.coastShare) return surface;

        const lagoon = seaLevel - settings.LAGOON_DEPTH;
        let planed = surface > lagoon ? lagoon + (surface - lagoon) * (1 - planing) : surface;
        const coast = volcano.model.coastShare * ATOLL.RING_AT;
        const ring = FeatureMath.bump(q, coast, ATOLL.RING_WIDTH * volcano.model.coastShare + ATOLL.RING_MIN_WIDTH);
        if (ring > ATOLL.RING_CUTOFF && planed > seaLevel - ATOLL.REEF_DEPTH_LIMIT) {
            const gaps = smoothstep(ATOLL.GAPS_FROM, ATOLL.GAPS_TO, textures.reef.at(x, y));
            const reef = seaLevel + settings.REEF_HEIGHT * gaps - settings.REEF_HEIGHT / 2;
            planed = Math.max(planed, planed + (reef - planed) * ring * planing);
        }
        return planed;
    }

    /** World-space noise fields shared by every shield volcano over the feature's box. */
    static #shieldTextures(delta, noise) {
        const settings = FILRODENSWMB.TECTONICS.FEATURES.VOLCANO;
        return {
            flows: Volcanoes.#detailed(delta, noise, settings.FLOW_NOISE_LENGTH, NOISE_OFFSETS.FLOWS),
            erosion: Volcanoes.#detailed(delta, noise, settings.EROSION_NOISE_LENGTH, NOISE_OFFSETS.EROSION),
            reef: new LazyField(delta, (x, y) => noise.fbm(noise.bx(x) / REEF_NOISE_LENGTH + NOISE_OFFSETS.REEF, noise.by(y) / REEF_NOISE_LENGTH, 2)),
        };
    }

    // --- Stratovolcanoes ---

    /**
     * Stratovolcanoes on top of what `delta` already holds (a volcanic arc's raised band, a rift's
     * floor). Each cone buries the ground it stands on: inside its foot its smooth, concave flanks
     * replace the hills and valleys beneath it, blending back into the ground over its outer part.
     * Without that, on rough land a cone is only one more bump among many and does not read as a
     * volcano. Its foot sits at the average height of the ground around it, and its summit `rise`
     * above that (or at least half its rise above sea level, so a cone standing in shallow water
     * by the coast still rises out of the sea).
     *
     * Each volcano needs `x`, `y`, `radius`, `rise` and `angle` (the direction it is stretched in).
     */
    static stampStratos(delta, volcanoes, context) {
        const ground = (x, y) => Volcanoes.#groundAt(context, x, y) + Volcanoes.#deltaAt(delta, x, y);
        const best = new Float32Array(delta.data.length).fill(Number.NaN);
        const textures = Volcanoes.#stratoTextures(delta, context.noise);
        const wobbleAmount = FILRODENSWMB.TECTONICS.FEATURES.VOLCANO.STRATO_WOBBLE;
        for (const volcano of volcanoes) {
            if (!(volcano.rise > 0)) continue;
            const foot = Volcanoes.#averageAround(volcano, ground);
            const top = Math.max(foot + volcano.rise, context.seaLevel + volcano.rise * STRATO.MIN_RISE_ABOVE_SEA);
            Volcanoes.#forEachPixel(delta, volcano, volcano.radius * STRATO.REACH, (x, y, r, angle) => {
                const stretch = 1 + STRATO.STRETCH * (Math.cos(angle - volcano.angle) ** 2 - 0.5);
                const outline = wobbleAmount * textures.wobble.at(x, y) * smoothstep(STRATO.WOBBLE_FROM, STRATO.WOBBLE_TO, r);
                const q = r / (1 + (stretch - 1) * smoothstep(STRATO.WOBBLE_FROM, STRATO.WOBBLE_TO, r)) + outline;
                if (q >= 1) return;
                const cone = foot + (top - foot) * Volcanoes.#stratoProfile(q, textures.gullies.at(x, y));
                const weight = 1 - smoothstep(STRATO.BLEND_FROM, 1, q);
                const target = ground(x, y) * (1 - weight) + cone * weight;
                const index = delta.indexOf(x, y);
                if (Number.isNaN(best[index]) || target > best[index]) best[index] = target;
            });
        }
        // Written only after every cone is worked out, so each cone's foot is measured on the
        // ground before any cone was added
        for (let y = delta.bounds.minY; y <= delta.bounds.maxY; y++) {
            for (let x = delta.bounds.minX; x <= delta.bounds.maxX; x++) {
                const index = delta.indexOf(x, y);
                if (!Number.isNaN(best[index])) delta.data[index] = best[index] - Volcanoes.#groundAt(context, x, y);
            }
        }
    }

    /** A concave cone with a summit crater and shallow gullies on its middle flanks. */
    static #stratoProfile(q, gullyNoise) {
        let p = Math.pow(1 - q, STRATO.EXPONENT);
        p -= STRATO.CRATER_DEPTH * (1 - smoothstep(STRATO.CRATER_INNER, STRATO.CRATER_OUTER, q));
        const flank = smoothstep(STRATO.GULLY_FROM, STRATO.GULLY_TO, q) * (1 - smoothstep(STRATO.GULLY_FADE, 1, q));
        p -= STRATO.GULLY_DEPTH * Math.pow(1 - Math.abs(gullyNoise), 2) * flank;
        return Math.max(0, p);
    }

    static #stratoTextures(delta, noise) {
        const settings = FILRODENSWMB.TECTONICS.FEATURES.VOLCANO;
        return {
            wobble: new LazyField(delta, (x, y) => noise.fbm(noise.bx(x) / settings.STRATO_WOBBLE_LENGTH + NOISE_OFFSETS.WOBBLE, noise.by(y) / settings.STRATO_WOBBLE_LENGTH, 2)),
            gullies: Volcanoes.#detailed(delta, noise, settings.STRATO_GULLY_LENGTH, NOISE_OFFSETS.GULLIES),
        };
    }

    // --- Shared helpers ---

    /**
     * Three-layer noise with detail layers over the feature's box, its coarse layers on a grid
     * (see DetailedField) and each pixel's value kept once read, since volcanoes overlap.
     */
    static #detailed(delta, noise, wavelength, offset) {
        const field = new DetailedField(noise, delta.bounds, wavelength, 3, offset);
        return new LazyField(delta, (x, y) => field.at(x, y));
    }

    /** Calls fn(x, y, r, angle) for every pixel of `delta` within `reach` of the volcano. */
    static #forEachPixel(delta, volcano, reach, fn) {
        const { minX, maxX, minY, maxY } = delta.bounds;
        const radius = volcano.model?.footprint ?? volcano.radius;
        const x0 = Math.max(minX, Math.floor(volcano.x - reach));
        const x1 = Math.min(maxX, Math.ceil(volcano.x + reach));
        const y0 = Math.max(minY, Math.floor(volcano.y - reach));
        const y1 = Math.min(maxY, Math.ceil(volcano.y + reach));
        const reachSq = reach * reach;
        for (let y = y0; y <= y1; y++) {
            const dy = y - volcano.y;
            for (let x = x0; x <= x1; x++) {
                const dx = x - volcano.x;
                const distanceSq = dx * dx + dy * dy;
                // The box's corners lie beyond the reach, so are skipped before any other work
                if (distanceSq > reachSq) continue;
                fn(x, y, Math.sqrt(distanceSq) / radius, Math.atan2(dy, dx));
            }
        }
    }

    /**
     * How far a shield reaches in each direction, as a multiple of its footprint, sampled around
     * the circle: broad lobes along its rift zones, and a slight wobble.
     */
    static #lobeTable(volcano, noise) {
        const samples = FILRODENSWMB.TECTONICS.FEATURES.VOLCANO.ANGLE_SAMPLES;
        const table = new Float32Array(samples + 1);
        for (let i = 0; i <= samples; i++) {
            const angle = (i / samples) * Math.PI * 2 - Math.PI;
            const lobes = Math.pow(Math.cos((volcano.arms * (angle - volcano.armAngle)) / 2), 2);
            const wobble = noise.fbm(Math.cos(angle) * LOBE.WOBBLE_RADIUS + volcano.x * LOBE.WOBBLE_POSITION, Math.sin(angle) * LOBE.WOBBLE_RADIUS + volcano.y * LOBE.WOBBLE_POSITION, 1);
            table[i] = LOBE.BASE + LOBE.AMOUNT * lobes + LOBE.WOBBLE * wobble;
        }
        return table;
    }

    static #lobeAt(volcano, angle) {
        const table = volcano.lobes;
        const position = ((angle + Math.PI) / (Math.PI * 2)) * (table.length - 1);
        const i = Math.min(table.length - 2, Math.floor(position));
        return table[i] + (table[i + 1] - table[i]) * (position - i);
    }

    static #groundAt(context, x, y) {
        const cx = FeatureMath.clamp(Math.round(x), 0, context.width - 1);
        const cy = FeatureMath.clamp(Math.round(y), 0, context.height - 1);
        return context.ground[cy * context.width + cx];
    }

    static #deltaAt(delta, x, y) {
        const { minX, maxX, minY, maxY } = delta.bounds;
        const cx = FeatureMath.clamp(Math.round(x), minX, maxX);
        const cy = FeatureMath.clamp(Math.round(y), minY, maxY);
        return delta.data[delta.indexOf(cx, cy)];
    }

    static #lowestAround(context, volcano, radius) {
        const samples = FILRODENSWMB.TECTONICS.FEATURES.VOLCANO.FOOT_RING_SAMPLES;
        let lowest = Volcanoes.#groundAt(context, volcano.x, volcano.y);
        for (let k = 0; k < samples; k++) {
            const angle = (k / samples) * Math.PI * 2;
            lowest = Math.min(lowest, Volcanoes.#groundAt(context, volcano.x + Math.cos(angle) * radius, volcano.y + Math.sin(angle) * radius));
        }
        return lowest;
    }

    static #averageAround(volcano, groundAt) {
        const samples = FILRODENSWMB.TECTONICS.FEATURES.VOLCANO.FOOT_RING_SAMPLES;
        let sum = 0;
        let count = 0;
        for (let k = 0; k < samples; k++) {
            const angle = (k / samples) * Math.PI * 2;
            for (const share of STRATO.FOOT_RINGS) {
                sum += groundAt(volcano.x + Math.cos(angle) * volcano.radius * share, volcano.y + Math.sin(angle) * volcano.radius * share);
                count++;
            }
        }
        return sum / count;
    }
}

// --- Shape constants (shares of a volcano's footprint or rise unless stated) ---

// Station stepping noise: rates per station number and offsets, so the two draws differ
const STEP_NOISE = { JITTER_RATE: 1.37, JITTER_X: 3.3, JITTER_Y: 8.8, PAUSE_RATE: 0.93, PAUSE_X: -41.7, PAUSE_Y: 19.1 };
const ACTIVITY_OFFSET = { X: 123.4, Y: 45.6 };
const ACTIVITY_OCTAVES = 3;
// Stretches the activity noise so the busiest and quietest periods reach 0 and 1
const ACTIVITY_CONTRAST = 1.35;
// A line's last volcano is added at its very end unless one already lies this near it
const KEEP_LAST_FROM = 0.97;

// A shield reaches a little past its footprint along its rift-zone lobes
const LOBE_REACH_MARGIN = 1.35;
const LOBE = { BASE: 0.82, AMOUNT: 0.4, WOBBLE: 0.06, WOBBLE_RADIUS: 1.2, WOBBLE_POSITION: 0.1 };
// The lobes shape the flanks only; nearer the summit the shield stays round, or every direction
// would meet at the top in a faceted point
const SHIELD_LOBE_START = { FROM: 0.02, TO: 0.3 };
const SHIELD_EXPONENT = { INNER: 1.6, OUTER: 1.8 };
const APRON_EXPONENT = 2.6;
const DOME_EXPONENT = 2.2;
const DOME_SHARE = 0.4;
const SHIELD_AGE = { YOUTH_END: 0.2, DOME_FROM: 0.1, DOME_TO: 0.6 };
const SUMMIT_CONE = { HEIGHT: 0.08, RADIUS: 0.09 };
const CALDERA = { DEPTH: 0.05, INNER: 0.01, OUTER: 0.025 };
const FLOW_FADE = { FROM: 0.5, TO: 0.9 };
const EROSION = { YOUNG: 0.12, OLD: 0.5, AGE_FROM: 0.05, AGE_TO: 0.5, MAX_SHARE: 0.9 };
const ATOLL = { START_SHARE: 0.7, END_FROM: 0.25, END_TO: 0.45, RING_AT: 0.9, RING_WIDTH: 0.06, RING_MIN_WIDTH: 0.02, RING_CUTOFF: 0.01, REEF_DEPTH_LIMIT: 0.05, GAPS_FROM: -0.2, GAPS_TO: 0.3 };
const REEF_NOISE_LENGTH = 2.5;
// A shield always starts at least this far below sea level, so one built on land still has a
// coast to be sized by
const MIN_SHIELD_DEPTH = 0.02;
// Where the coast lies for a volcano whose summit never reaches the surface (it has none)
const SUBMARINE_COAST_SHARE = 0.4;
// Stops a volcano on a very deep seabed growing an enormous footprint to reach its coast
const MIN_COAST_SHARE = 0.15;
const MIN_DROWN_AGE = 0.05;
// How far below its starting depth an old seamount may sink, as a share of that depth
const MAX_SEAMOUNT_SINK = 0.6;
const INVERSE_ITERATIONS = 30;
const PROFILE_SAMPLES = 1024;

const STRATO = {
    REACH: 1.2,
    EXPONENT: 1.7,
    STRETCH: 0.25,
    WOBBLE_FROM: 0.2,
    WOBBLE_TO: 0.6,
    BLEND_FROM: 0.35,
    CRATER_DEPTH: 0.06,
    CRATER_INNER: 0.02,
    CRATER_OUTER: 0.07,
    GULLY_DEPTH: 0.02,
    GULLY_FROM: 0.3,
    GULLY_TO: 0.55,
    GULLY_FADE: 0.6,
    MIN_RISE_ABOVE_SEA: 0.5,
    FOOT_RINGS: [0.5, 0.8, 1],
};

const NOISE_OFFSETS = { FLOWS: 900, EROSION: 300, REEF: 700, WOBBLE: 1300, GULLIES: 500 };
