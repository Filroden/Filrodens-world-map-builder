import { FILRODENSWMB } from "../config.js";
import { ProceduralEngine } from "./ProceduralEngine.js";

const TAU = Math.PI * 2;

/**
 * Makes random land mask polygons for Guided mode's random shape button.
 *
 * Shapes are made by a "turning walk": a walk of random-length steps whose heading turns by a
 * random amount at every node, with the turns adding up to exactly one full circle. Because the
 * heading goes round once, the walk winds once around its middle like a coastline does, and the
 * random turns give it bays and peninsulas. A walk rarely ends exactly where it started, so the
 * gap is spread evenly over every step, which closes the outline without a visible seam.
 *
 * Alternatives that were measured and rejected: a circle with a noise-deformed radius (smooth,
 * but every shape looks alike); a free random walk with an independent heading at every step (it
 * crosses itself several times per shape, and land masks are filled even-odd, so every area it
 * loops over twice becomes sea); random angles sorted around a centre (never crosses, but gives
 * spiky stars); and grouped Voronoi cells (a jagged, fractal edge with several times the nodes,
 * which Coastline Fracture adds anyway when the terrain is generated).
 *
 * Everything here is pure: the caller passes the random number source, so results can be
 * reproduced and tested outside Foundry.
 */
export class LandMaskGenerator {
    /**
     * Makes one random polygon for a land mask of the given operation, in map pixels. Points may
     * lie in the canvas buffer around the map, never beyond it.
     *
     * An "add" shape is placed anywhere on the map, some of them straddling an edge. A "subtract"
     * shape is always centred on existing land, since a hole in open sea would change nothing;
     * when there is no land to place it on, no shape is made.
     *
     * @param {object} options
     * @param {number} options.mapWidth - Map width in pixels.
     * @param {number} options.mapHeight - Map height in pixels.
     * @param {"add"|"subtract"} options.operation - The mask operation the shape is for.
     * @param {Array<{operation: string, points: Array<{x: number, y: number}>}>} [options.existingMasks]
     *   The map's land masks, in order, used to find land for a "subtract" shape.
     * @param {function(): number} [options.random] - Uniform random numbers in [0, 1).
     * @returns {Array<{x: number, y: number}>|null} The polygon's nodes, or null when no shape could be placed.
     */
    static generatePolygon({ mapWidth, mapHeight, operation, existingMasks = [], random = Math.random }) {
        const map = { width: mapWidth, height: mapHeight, buffer: FILRODENSWMB.UI.CANVAS_BUFFER };
        const placement =
            operation === "subtract" ? LandMaskGenerator.#placeOverLand(map, existingMasks, random) : LandMaskGenerator.#placeAnywhere(map, random);
        if (!placement) return null;

        const outline = LandMaskGenerator.#bestTurningWalk(random, LandMaskGenerator.#nodeCount(map, placement.sizeRank));
        const points = LandMaskGenerator.#fitToMap(outline, placement, map);

        return points.length >= FILRODENSWMB.LIMITS.MIN_POLYGON_VERTICES ? points : null;
    }

    /**
     * Whether the land masks make a point land: each mask is filled even-odd and the last mask
     * covering the point decides it, exactly as terrain generation reads them. Masks too small to
     * enclose an area are ignored, as generation ignores them.
     */
    static isLandAt(masks, x, y) {
        let isLand = false;

        for (const mask of masks) {
            if (!LandMaskGenerator.#isUsableMask(mask)) continue;
            if (ProceduralEngine.isPointInPolygon(x, y, mask.points)) isLand = mask.operation !== "subtract";
        }

        return isLand;
    }

    /** Whether a mask encloses an area (terrain generation ignores the rest). */
    static #isUsableMask(mask) {
        return (mask.points?.length ?? 0) >= FILRODENSWMB.LIMITS.MIN_POLYGON_VERTICES;
    }

    // ------------------------------------------------------------------------------------------
    // Placement
    // ------------------------------------------------------------------------------------------

    /** Places an Add Land shape: centred inside the map, or on one of its edges. */
    static #placeAnywhere(map, random) {
        const settings = FILRODENSWMB.RANDOM_LAND_MASK;
        const sizeRank = Math.pow(random(), settings.RADIUS_SKEW);
        const radius = LandMaskGenerator.#radiusFor(map, sizeRank);
        const centre = random() < settings.EDGE_SHARE ? LandMaskGenerator.#edgeCentre(map, radius, random) : LandMaskGenerator.#interiorCentre(map, random);

        return LandMaskGenerator.#completePlacement(centre, radius, sizeRank, random);
    }

    /**
     * Places a Remove Land shape centred on existing land inside the map, or returns null when
     * none can be found. Candidate points are drawn from the bounding boxes of the "add" masks
     * (clipped to the map) rather than from the whole map, so even a small island is found
     * quickly; each candidate is then checked against every mask, since a later mask may already
     * have turned it into sea.
     */
    static #placeOverLand(map, masks, random) {
        const settings = FILRODENSWMB.RANDOM_LAND_MASK;
        const landBoxes = masks
            .filter((mask) => mask.operation !== "subtract" && LandMaskGenerator.#isUsableMask(mask))
            .map((mask) => LandMaskGenerator.#clipToMap(LandMaskGenerator.#boundsOf(mask.points), map))
            .filter(Boolean);
        if (landBoxes.length === 0) return null;

        for (let attempt = 0; attempt < settings.MAX_LAND_SEARCH_ATTEMPTS; attempt++) {
            const box = landBoxes[Math.floor(random() * landBoxes.length)];
            const centre = { x: LandMaskGenerator.#between(random, box.minX, box.maxX), y: LandMaskGenerator.#between(random, box.minY, box.maxY) };
            if (!LandMaskGenerator.isLandAt(masks, centre.x, centre.y)) continue;

            const sizeRank = Math.pow(random(), settings.RADIUS_SKEW);
            const radius = LandMaskGenerator.#radiusFor(map, sizeRank) * settings.SUBTRACT_RADIUS_SCALE;
            return LandMaskGenerator.#completePlacement(centre, radius, sizeRank, random);
        }

        return null;
    }

    /** Adds a random rotation and stretch to a shape's centre and size. */
    static #completePlacement(centre, radius, sizeRank, random) {
        return {
            x: centre.x,
            y: centre.y,
            radius,
            sizeRank,
            rotation: random() * TAU,
            // The product of two random numbers favours values near 0, so most shapes stay round
            stretch: 1 + random() * random() * FILRODENSWMB.RANDOM_LAND_MASK.MAX_STRETCH,
        };
    }

    /** A shape's radius in pixels for its size rank (0 = smallest, 1 = largest). */
    static #radiusFor(map, sizeRank) {
        const { MIN_RADIUS, RADIUS_RANGE } = FILRODENSWMB.RANDOM_LAND_MASK;
        return Math.min(map.width, map.height) * (MIN_RADIUS + RADIUS_RANGE * sizeRank);
    }

    /** A centre inside the map, away from its edges. */
    static #interiorCentre(map, random) {
        const { MIN, MAX } = FILRODENSWMB.RANDOM_LAND_MASK.INTERIOR_SPAN;
        return { x: LandMaskGenerator.#between(random, MIN, MAX) * map.width, y: LandMaskGenerator.#between(random, MIN, MAX) * map.height };
    }

    /**
     * A centre on a random edge of the map, set just beyond or just inside it, so the shape runs
     * off the map into the canvas buffer.
     */
    static #edgeCentre(map, radius, random) {
        const settings = FILRODENSWMB.RANDOM_LAND_MASK;
        const along = LandMaskGenerator.#between(random, settings.EDGE_SPAN.MIN, settings.EDGE_SPAN.MAX);
        // Negative offsets put the centre beyond the edge
        const inset = LandMaskGenerator.#between(random, settings.EDGE_OFFSET.MIN, settings.EDGE_OFFSET.MAX) * radius;
        const edges = [
            () => ({ x: along * map.width, y: inset }),
            () => ({ x: map.width - inset, y: along * map.height }),
            () => ({ x: along * map.width, y: map.height - inset }),
            () => ({ x: inset, y: along * map.height }),
        ];

        return edges[Math.floor(random() * edges.length)]();
    }

    /**
     * How many nodes a shape gets: more for larger shapes, and more on larger maps, growing with
     * the square root of the map's size (see RANDOM_LAND_MASK.NODES).
     */
    static #nodeCount(map, sizeRank) {
        const { NODES, MIN_NODES } = FILRODENSWMB.RANDOM_LAND_MASK;
        const mapScale = Math.sqrt(Math.min(map.width, map.height) / FILRODENSWMB.LIMITS.BASELINE_DIMENSION);
        return Math.max(MIN_NODES, Math.round((NODES.MIN + (NODES.MAX - NODES.MIN) * sizeRank) * mapScale));
    }

    // ------------------------------------------------------------------------------------------
    // Shape
    // ------------------------------------------------------------------------------------------

    /**
     * Makes turning walks until one does not cross itself, keeping the last one if none of the
     * attempts manage it. A crossing is valid for a land mask, but any area the outline loops
     * over twice is filled as sea, which is not what a single random shape should do.
     */
    static #bestTurningWalk(random, nodeCount) {
        let walk = null;

        for (let attempt = 0; attempt < FILRODENSWMB.RANDOM_LAND_MASK.MAX_SHAPE_ATTEMPTS; attempt++) {
            walk = LandMaskGenerator.#turningWalk(random, nodeCount);
            if (!LandMaskGenerator.#crossesItself(walk)) break;
        }

        return walk;
    }

    /**
     * A closed turning walk of `nodeCount` nodes, centred on (0, 0) with its furthest node at
     * distance 1 (see the class description).
     */
    static #turningWalk(random, nodeCount) {
        const turns = LandMaskGenerator.#fullCircleTurns(random, nodeCount);
        const { STEP_LENGTH } = FILRODENSWMB.RANDOM_LAND_MASK;

        let heading = random() * TAU;
        const steps = turns.map((turn) => {
            heading += turn;
            const length = LandMaskGenerator.#between(random, STEP_LENGTH.MIN, STEP_LENGTH.MAX);
            return { x: Math.cos(heading) * length, y: Math.sin(heading) * length };
        });

        return LandMaskGenerator.#normalise(LandMaskGenerator.#closeWalk(steps));
    }

    /**
     * Random turning angles that add up to exactly one full circle: each is an even share of the
     * circle plus a normally distributed deviation, and whatever the deviations add up to is then
     * taken back off every turn equally.
     */
    static #fullCircleTurns(random, count) {
        const { TURN_DEVIATION } = FILRODENSWMB.RANDOM_LAND_MASK;
        const deviation = LandMaskGenerator.#between(random, TURN_DEVIATION.MIN, TURN_DEVIATION.MAX);
        const turns = Array.from({ length: count }, () => TAU / count + deviation * LandMaskGenerator.#gaussian(random));

        const correction = (TAU - turns.reduce((sum, turn) => sum + turn, 0)) / count;
        return turns.map((turn) => turn + correction);
    }

    /**
     * Turns steps into nodes, taking an equal share of the distance between the walk's start and
     * end off every step so the last step lands back on the first node.
     */
    static #closeWalk(steps) {
        const gapX = steps.reduce((sum, step) => sum + step.x, 0) / steps.length;
        const gapY = steps.reduce((sum, step) => sum + step.y, 0) / steps.length;

        let x = 0;
        let y = 0;
        return steps.map((step) => {
            const node = { x, y };
            x += step.x - gapX;
            y += step.y - gapY;
            return node;
        });
    }

    /** Moves nodes so their average sits on (0, 0), then scales them so the furthest is at distance 1. */
    static #normalise(nodes) {
        const centreX = nodes.reduce((sum, node) => sum + node.x, 0) / nodes.length;
        const centreY = nodes.reduce((sum, node) => sum + node.y, 0) / nodes.length;
        const reach = Math.max(...nodes.map((node) => Math.hypot(node.x - centreX, node.y - centreY))) || 1;

        return nodes.map((node) => ({ x: (node.x - centreX) / reach, y: (node.y - centreY) / reach }));
    }

    /**
     * Places a unit outline on the map: stretched (keeping its area), rotated, scaled to the
     * shape's radius and moved to its centre. Nodes beyond the canvas buffer are pulled back onto
     * its edge, where clicks can no longer place nodes either, and the result is tidied.
     */
    static #fitToMap(outline, placement, map) {
        const cos = Math.cos(placement.rotation);
        const sin = Math.sin(placement.rotation);
        const stretchX = Math.sqrt(placement.stretch) * placement.radius;
        const stretchY = placement.radius / Math.sqrt(placement.stretch);

        const placed = outline.map((node) => {
            const x = node.x * stretchX;
            const y = node.y * stretchY;
            return {
                x: Math.round(LandMaskGenerator.#clamp(placement.x + x * cos - y * sin, -map.buffer, map.width + map.buffer)),
                y: Math.round(LandMaskGenerator.#clamp(placement.y + x * sin + y * cos, -map.buffer, map.height + map.buffer)),
            };
        });

        return LandMaskGenerator.#dropStraightRuns(LandMaskGenerator.#dropDuplicates(placed));
    }

    /** Removes nodes that sit on (or within MIN_NODE_SPACING of) the node before them, around the loop. */
    static #dropDuplicates(nodes) {
        const spacing = FILRODENSWMB.RANDOM_LAND_MASK.MIN_NODE_SPACING;
        const isSame = (a, b) => Math.abs(a.x - b.x) < spacing && Math.abs(a.y - b.y) < spacing;

        const kept = [];
        for (const node of nodes) {
            if (kept.length === 0 || !isSame(kept.at(-1), node)) kept.push(node);
        }
        if (kept.length > 1 && isSame(kept[0], kept.at(-1))) kept.pop();

        return kept;
    }

    /**
     * Removes nodes that lie on a straight line between their neighbours, as nodes clamped onto
     * the buffer's edge do. They add nothing to the shape and would only be extra handles to edit.
     */
    static #dropStraightRuns(nodes) {
        if (nodes.length <= FILRODENSWMB.LIMITS.MIN_POLYGON_VERTICES) return nodes;

        const kept = nodes.filter((node, i) => {
            const previous = nodes[(i - 1 + nodes.length) % nodes.length];
            const next = nodes[(i + 1) % nodes.length];
            return (node.x - previous.x) * (next.y - node.y) - (node.y - previous.y) * (next.x - node.x) !== 0;
        });

        return kept.length >= FILRODENSWMB.LIMITS.MIN_POLYGON_VERTICES ? kept : nodes;
    }

    // ------------------------------------------------------------------------------------------
    // Geometry and number helpers
    // ------------------------------------------------------------------------------------------

    /** Whether any two edges of a closed outline cross (edges that share a node are not compared). */
    static #crossesItself(nodes) {
        const count = nodes.length;

        for (let i = 0; i < count; i++) {
            for (let j = i + 2; j < count; j++) {
                const sharesNode = i === 0 && j === count - 1;
                if (!sharesNode && LandMaskGenerator.#segmentsCross(nodes[i], nodes[(i + 1) % count], nodes[j], nodes[(j + 1) % count])) return true;
            }
        }

        return false;
    }

    /** Whether segment a-b and segment c-d cross at a point inside both. */
    static #segmentsCross(a, b, c, d) {
        const side = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
        return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
    }

    /** The bounding box of a set of points. */
    static #boundsOf(points) {
        const xs = points.map((point) => point.x);
        const ys = points.map((point) => point.y);
        return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
    }

    /** A bounding box clipped to the map, or null when it lies wholly outside it. */
    static #clipToMap(box, map) {
        const clipped = { minX: Math.max(0, box.minX), maxX: Math.min(map.width, box.maxX), minY: Math.max(0, box.minY), maxY: Math.min(map.height, box.maxY) };
        return clipped.minX < clipped.maxX && clipped.minY < clipped.maxY ? clipped : null;
    }

    /** A normally distributed random number (mean 0, standard deviation 1), by the Box-Muller transform. */
    static #gaussian(random) {
        const u = 1 - random(); // (0, 1], so the logarithm is finite
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * random());
    }

    /** A uniform random number between `min` and `max`. */
    static #between(random, min, max) {
        return min + (max - min) * random();
    }

    static #clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }
}
