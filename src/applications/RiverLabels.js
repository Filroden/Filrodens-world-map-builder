import { FILRODENSWMB } from "../config.js";
import { InspectorFields } from "./InspectorFields.js";
import { platform } from "../platform/index.js";

/**
 * A custom river's name on the map (a river guide drawn in Rivers and faults): its label, drawn
 * along the river's course as Name natural features draws a river's (see LabelLayout), with the
 * same look fields, Place automatically and mass edit as a pin's, route's or region's.
 *
 * A custom river is a guide: the terrain is carved along it and the river is traced from the
 * terrain, so the river drawn follows the guide closely but not exactly. The name follows the
 * traced river: each point along the guide (every COURSE_STEP_PX) moves to the nearest traced
 * river point within SNAP_PX, or stays where none is that near.
 *
 * **Shown or not:** a river drawn before rivers had labels has no `label`, and reads as hidden
 * (visibility "none"), so no map changes as it opens and labels made by hand for its rivers are
 * not doubled; a river drawn since starts shown, in the River label style (added when the map lacks it).
 * Where a custom river shows its name, Name natural features leaves that river to it (see
 * covers): the reader chooses between naming a river themselves and letting the map do it.
 */

const { RIVER_LABELS } = FILRODENSWMB;

/** Each traced river set's points, indexed once (see #tracedIndex); each river's course, with what it was worked out from. */
const traced = new WeakMap();
const courses = new WeakMap();

export class RiverLabels {
    /** Whether a custom river's name is drawn: it has a label, and the label is not hidden. */
    static shown(river) {
        return !!river?.label && (river.label.visibility ?? "all") !== "none";
    }

    /** A custom river's label fields as the inspector shows them (see InspectorFields.label), hidden when it has none. */
    static label(app, river) {
        const label = InspectorFields.label(app, river);
        return { ...label, visibility: river?.label ? (river.label.visibility ?? "all") : "none" };
    }

    /**
     * The label a newly drawn river starts with: shown, in the River label style
     * (FEATURE_NAMES.STYLES.river), which is added from the defaults when the map lacks it (as Name
     * natural features adds it; undone with the river). Only a river drawn now: an older river's
     * label, shown later, keeps the look the reader gives it.
     * @param {object} app
     */
    static newLabel(app) {
        const styles = (app.uiState.customLabelStyles ??= []);
        const id = FILRODENSWMB.FEATURE_NAMES.STYLES.river;
        let style = styles.find((candidate) => candidate.id === id);
        if (!style) {
            const { nameKey, ...seed } = FILRODENSWMB.LABELS.DEFAULT_STYLES.find((candidate) => candidate.id === id);
            style = { ...seed, name: platform.i18n.localize(nameKey) };
            styles.push(style);
        }
        const fields = Object.fromEntries(InspectorFields.LABEL_STYLE_FIELDS.map((name) => [name, name === "bold" ? style.bold !== false : name === "italic" ? style.italic === true : style[name]]));
        return { visibility: "all", quickStyle: style.id, ...fields };
    }

    /**
     * The labels to draw: each custom river whose name is shown, with its course.
     * @param {object} app
     * @returns {{river: object, course: {x: number, y: number}[]}[]}
     */
    static items(app) {
        const rivers = (app.manualRivers ?? []).filter((river) => river.name && this.shown(river) && river.points?.length > 1);
        if (!rivers.length) return [];
        const data = app.currentRiverData ?? null;
        return rivers.map((river) => {
            // Worked out again only when the traced rivers or the guide's points change
            const cached = courses.get(river);
            const first = river.points[0];
            const last = river.points.at(-1);
            const shape = `${river.points.length}:${first.x},${first.y}:${last.x},${last.y}`;
            if (cached && cached.data === data && cached.shape === shape && cached.points === river.points) return { river, course: cached.course };
            const course = this.course(river, this.#tracedIndex(data));
            courses.set(river, { data, shape, points: river.points, course });
            return { river, course };
        });
    }

    /**
     * A river's course for its name: the guide, every COURSE_STEP_PX, each point moved onto the
     * nearest traced river point within SNAP_PX.
     * @param {object} river
     * @param {object|null} traced - The traced rivers' points (see #tracedIndex), or null for the guide alone.
     * @returns {{x: number, y: number}[]}
     */
    static course(river, traced) {
        const course = [];
        for (const point of densify(river.points ?? [], RIVER_LABELS.COURSE_STEP_PX)) {
            const snapped = traced?.nearest(point.x, point.y) ?? point;
            const last = course.at(-1);
            if (!last || last.x !== snapped.x || last.y !== snapped.y) course.push({ x: snapped.x, y: snapped.y });
        }
        return course;
    }

    /**
     * Whether a river feature found by Name natural features (its `path`) is a custom river's
     * whose name is shown: at least COVER_SHARE of that river's course lies within SNAP_PX of it.
     * @param {object} app
     * @param {{path?: ({x: number, y: number}|number[])[]}} feature
     * @param {{river: object, course: {x: number, y: number}[]}[]} [items] - The shown rivers (see items).
     */
    static covers(app, feature, items = this.items(app)) {
        if (!feature?.path?.length || !items.length) return false;
        // Found features' paths are [x, y, lake] triples; a saved label's, points
        const path = feature.path.map((point) => (Array.isArray(point) ? { x: point[0], y: point[1] } : point));
        const index = pointIndex(path, RIVER_LABELS.SNAP_PX);
        return items.some(({ course }) => course.length > 0 && course.filter((point) => index.nearest(point.x, point.y)).length / course.length >= RIVER_LABELS.COVER_SHARE);
    }

    /** The traced rivers' points (lakes left out), for the nearest within SNAP_PX; null with none. */
    static #tracedIndex(riverData) {
        if (riverData && traced.has(riverData)) return traced.get(riverData);
        const points = [];
        for (const vector of riverData?.vectors ?? []) for (const point of vector.path ?? []) if (!point.isLake && Number.isFinite(point.x) && Number.isFinite(point.y)) points.push(point);
        const index = points.length ? pointIndex(points, RIVER_LABELS.SNAP_PX) : null;
        if (riverData) traced.set(riverData, index);
        return index;
    }
}

/** A line's points every `step` pixels (its own points kept). */
function densify(points, step) {
    const out = [];
    points.forEach((point, index) => {
        if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return;
        const previous = out.at(-1);
        if (index > 0 && previous) {
            const length = Math.hypot(point.x - previous.x, point.y - previous.y);
            const steps = Math.floor(length / step);
            for (let at = 1; at < steps; at++) out.push({ x: previous.x + ((point.x - previous.x) * at) / steps, y: previous.y + ((point.y - previous.y) * at) / steps });
        }
        out.push({ x: point.x, y: point.y });
    });
    return out;
}

/** Points in a grid of `radius` cells: the nearest point within `radius` of a place, or null. */
function pointIndex(points, radius) {
    const cells = new Map();
    const key = (cx, cy) => `${cx},${cy}`;
    for (const point of points) {
        const at = key(Math.floor(point.x / radius), Math.floor(point.y / radius));
        if (!cells.has(at)) cells.set(at, []);
        cells.get(at).push(point);
    }
    return {
        nearest(x, y) {
            const cx = Math.floor(x / radius);
            const cy = Math.floor(y / radius);
            let best = null;
            let bestDistance = radius;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    for (const point of cells.get(key(cx + dx, cy + dy)) ?? []) {
                        const distance = Math.hypot(point.x - x, point.y - y);
                        if (distance <= bestDistance) {
                            bestDistance = distance;
                            best = point;
                        }
                    }
                }
            }
            return best;
        },
    };
}
