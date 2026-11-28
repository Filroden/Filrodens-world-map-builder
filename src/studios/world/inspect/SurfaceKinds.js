import { FILRODENSWMB } from "../../../config.js";
import { platform } from "../../../platform/index.js";
import { footprintHas } from "../../../kernel/names/FeatureDetection.js";
import { ContentRows } from "../app/ContentRows.js";
import { DetailLevel } from "../app/DetailLevel.js";
import { FeatureNames } from "../app/FeatureNames.js";
import { GeneratedDetails } from "../app/GeneratedDetails.js";
import { GroundReading } from "../app/GroundReading.js";
import { lineDistance, lineReach } from "../app/LineReach.js";
import { MeshIntegration } from "../app/MeshIntegration.js";
import { PinStyles } from "../app/PinStyles.js";
import { UserFigures } from "../app/UserFigures.js";
import { SettlementSource } from "../settlement/SettlementSource.js";

/**
 * What Inspect reads on the Surface map (EX1), registered with the shell in the World studio's
 * definition (`inspect.surface`): pins, routes, custom rivers, named natural features and regions,
 * in the list's order, and the ground, last. Each kind finds everything of its kind at a map
 * point that the map draws (the detail level, the Show menu's layers, the Regions and Labels
 * menus' rows and the Visibility filters decide, as the canvas decides what it draws; see
 * StudioCanvas.isDrawn), and gives its card line, its fold and what to outline while the fold is
 * hovered. Nothing here writes to the map.
 *
 * Unnamed routes of the same kind and class share one row with a count (Ken, EX1 probe): routes
 * meet at settlements, and nearly all are generated and unnamed, so one row each made the card a
 * column of near-identical lines. Each route in a fold names the next settlement the map shows
 * along it, one way or both (Ken, 2026-11-27); a direction whose next settlement the detail level
 * hides names none.
 */

/** The settlement tiers' names, from their default pin styles. */
const TIER_NAMES = new Map(FILRODENSWMB.PINS.DEFAULT_STYLES.map((style) => [style.tier, style.name]));

/** A route kind's plural, for a row of several. */
const ROUTE_PLURALS = Object.freeze({ road: "FILRODENSWMB.UI.InspectRoads", river: "FILRODENSWMB.UI.InspectRiverRoutes", sea: "FILRODENSWMB.UI.InspectSeaLanes", oldRoad: "FILRODENSWMB.UI.InspectOldRoads" });

const i18n = () => platform.i18n;
const localize = (key) => platform.i18n.localize(key);
const count = (value) => (Number.isFinite(value) ? Math.round(value).toLocaleString(platform.i18n.lang) : null);

/** The canvas's drawing rule (see StudioCanvas.isDrawn); everything is drawn without a canvas. */
function drawn(app, visibility, parent = "all", isContainer = false) {
    return app.canvasEngine?.isDrawn ? app.canvasEngine.isDrawn(visibility, parent, isContainer) : visibility !== "none";
}

/** Whether a layer of the Show menu is drawn. */
function layerShown(app, layerId) {
    return app.canvasEngine?.isLayerShown ? app.canvasEngine.isLayerShown(layerId) : true;
}

/** A visibility made GM-only by a GM-only parent, as the canvas reads it. */
function combined(visibility, parent) {
    const own = visibility || "all";
    return own !== "none" && parent === "gm" ? "gm" : own;
}

// ------------------------------------------------------------------ pins

/** A pin's drawn radius in map pixels, as the canvas draws its sprite (renderInfrastructure). */
function pinRadius(app, pin) {
    const { PIN_PX, UNIT } = FILRODENSWMB.SYMBOLS;
    const scale = app.canvasEngine?.symbolSizeScale ?? 1;
    return (PIN_PX * UNIT * scale * (pin.scale || FILRODENSWMB.PINS.DEFAULT_SCALE)) / 2;
}

/** The pins the map draws: shown at its detail level, the Routes and pins layer on, and passing the Visibility filters. */
function drawnPins(app) {
    if (!layerShown(app, "infrastructure")) return [];
    return DetailLevel.shown(app).pins.filter((pin) => drawn(app, pin.visibility));
}

/** A pin's style, or null. */
function styleOf(app, pin) {
    return PinStyles.find(app, pin.pinStyle);
}

/** A pin's tier: its style's, else what the run made it. */
function tierOf(app, pin) {
    return styleOf(app, pin)?.tier ?? pin.generated?.tier ?? null;
}

/** A pin's population: the entered figure first, else what the run made. */
function populationOf(pin) {
    return UserFigures.population(pin) ?? UserFigures.made(pin);
}

/** What a pin is: its style's name, else its tier's. */
function pinKindName(app, pin) {
    const style = styleOf(app, pin);
    if (style?.name) return style.name;
    const tier = TIER_NAMES.get(tierOf(app, pin));
    return tier ? localize(tier) : localize("FILRODENSWMB.UI.InspectPin");
}

const PINS = Object.freeze({
    id: "pins",
    icon: "place",
    at(app, x, y) {
        const found = [];
        for (const pin of drawnPins(app)) {
            const distance = Math.hypot(pin.x - x, pin.y - y);
            if (distance <= Math.max(pinRadius(app, pin), lineReach(app))) found.push({ key: `pin:${pin.id}`, pin, distance });
        }
        return found.sort((a, b) => a.distance - b.distance);
    },
    row(app, { pin }) {
        const settlement = SettlementSource.isSettlement(app, pin);
        return {
            name: pin.name || localize("FILRODENSWMB.UI.InspectUnnamedPin"),
            kind: pinKindName(app, pin),
            figure: settlement ? count(populationOf(pin)) : null,
            gmOnly: pin.visibility === "gm",
        };
    },
    fold(app, item) {
        const { pin } = item;
        const rows = [];
        const entered = UserFigures.population(pin);
        if (entered !== null) rows.push({ label: localize("FILRODENSWMB.UI.GeneratedPopulation"), value: count(entered), entered: true });
        for (const row of GeneratedDetails.forPin(app, pin, { journal: true }) ?? []) {
            // The entered figure is shown first, marked, so the journal's own copy of it is left out
            if (entered !== null && row.label === localize("FILRODENSWMB.UI.GeneratedPopulation")) continue;
            rows.push(row);
        }
        return {
            rows,
            description: pin.description || null,
            within: regionsAt(app, pin.x, pin.y).map(regionLink),
            settlementPin: SettlementSource.isSettlement(app, pin) ? pin : null,
            edit: { kind: "pin", id: pin.id },
        };
    },
    outline(app, { pin }) {
        return { ring: { x: pin.x, y: pin.y, radius: pinRadius(app, pin) } };
    },
});

// ------------------------------------------------------------------ routes

/** A route's kind for grouping: an old road apart from other roads. */
function routeKind(route) {
    return route.generated?.oldRoad ? "oldRoad" : route.transport ?? "road";
}

/** A route's line on the display mesh as points. */
function routePoints(app, route) {
    const line = app.meshSession?.routeLine(route) ?? [];
    const points = [];
    for (let i = 0; i + 1 < line.length; i += 2) points.push({ x: line[i], y: line[i + 1] });
    return points;
}

/**
 * The next settlement the map shows along a route from a map point, each way: walked along the
 * route's line from its point nearest the given one, the first settlement pin within reach of the
 * line that is not at the point itself. A direction whose next settlement the detail level hides
 * (or the line's end) gives null.
 * @param {object} app
 * @param {object} route
 * @param {number} x
 * @param {number} y
 * @param {object[]} settlements - The settlement pins the map draws.
 * @returns {Array<object|null>} Two pins (or nulls), back along the line and on along it.
 */
export function nextSettlements(app, route, x, y, settlements) {
    const points = routePoints(app, route);
    if (points.length < 2) return [null, null];
    const reach = lineReach(app);
    let start = 0;
    let best = Infinity;
    points.forEach((point, index) => {
        const distance = Math.hypot(point.x - x, point.y - y);
        if (distance < best) {
            best = distance;
            start = index;
        }
    });
    // The pins at the point itself (the held town) are where the walk starts, not where it ends
    const here = new Set(settlements.filter((pin) => Math.hypot(pin.x - x, pin.y - y) <= Math.max(reach, pinRadius(app, pin))).map((pin) => pin.id));
    const grid = pinGrid(settlements);
    const walk = (step) => {
        for (let i = start + step; i >= 0 && i < points.length; i += step) {
            const found = grid.near(points[i].x, points[i].y, (pin) => Math.max(reach, pinRadius(app, pin))).find((pin) => !here.has(pin.id));
            if (found) return found;
        }
        return null;
    };
    return [walk(-1), walk(1)];
}

/** A coarse grid of pins, to find those near a point quickly. */
function pinGrid(pins, cell = 64) {
    const cells = new Map();
    for (const pin of pins) {
        const key = `${Math.floor(pin.x / cell)},${Math.floor(pin.y / cell)}`;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(pin);
    }
    return {
        near(x, y, reachOf) {
            const found = [];
            const span = 1;
            const cx = Math.floor(x / cell);
            const cy = Math.floor(y / cell);
            for (let gx = cx - span; gx <= cx + span; gx++) {
                for (let gy = cy - span; gy <= cy + span; gy++) {
                    for (const pin of cells.get(`${gx},${gy}`) ?? []) {
                        const distance = Math.hypot(pin.x - x, pin.y - y);
                        if (distance <= reachOf(pin)) found.push({ pin, distance });
                    }
                }
            }
            return found.sort((a, b) => a.distance - b.distance).map((entry) => entry.pin);
        },
    };
}

/** "To X", "Between X and Y", or null, for the settlements found each way (see nextSettlements). */
function endsText(ends) {
    const named = ends.filter(Boolean).map((pin) => pin.name || localize("FILRODENSWMB.UI.InspectUnnamedSettlement"));
    if (named.length === 2) return i18n().format("FILRODENSWMB.UI.InspectRouteBetween", { a: named[0], b: named[1] });
    if (named.length === 1) return i18n().format("FILRODENSWMB.UI.InspectRouteTo", { name: named[0] });
    return null;
}

/** A route's one line in a fold: its kind and class, length and where it leads. */
function routeLine(app, route, ends) {
    return {
        id: route.id,
        name: route.name || null,
        detail: [GeneratedDetails.routeKindName(route), GeneratedDetails.routeClassName(route), GeneratedDetails.lengthOf(app, route), endsText(ends)].filter(Boolean).join(" · "),
        gmOnly: route.visibility === "gm",
        edit: { kind: "route", id: route.id },
    };
}

const ROUTES = Object.freeze({
    id: "routes",
    icon: "timeline",
    at(app, x, y) {
        if (!layerShown(app, "infrastructure")) return [];
        const reach = FILRODENSWMB.MESH.ROUTE_HIT_PX / (app.canvasEngine?.stage?.scale?.x || 1);
        const found = MeshIntegration.routesAt(app, x, y, reach, (visibility) => drawn(app, visibility));
        // A named route keeps its own row; unnamed routes of the same kind and class share one
        const groups = new Map();
        for (const entry of found) {
            const { route } = entry;
            const key = route.name ? `route:${route.id}` : `routes:${routeKind(route)}/${route.class ?? ""}`;
            if (!groups.has(key)) groups.set(key, { key, routes: [], distance: entry.distance, x, y });
            groups.get(key).routes.push(entry.route);
        }
        return [...groups.values()];
    },
    row(app, item) {
        const [route] = item.routes;
        const many = item.routes.length > 1;
        const kindName = many ? localize(ROUTE_PLURALS[routeKind(route)] ?? ROUTE_PLURALS.road) : GeneratedDetails.routeKindName(route);
        return {
            name: route.name || kindName,
            kind: route.name ? kindName : GeneratedDetails.routeClassName(route) ?? kindName,
            figure: many ? count(item.routes.length) : GeneratedDetails.lengthOf(app, route),
            gmOnly: item.routes.every((each) => each.visibility === "gm"),
        };
    },
    fold(app, item) {
        const settlements = drawnPins(app).filter((pin) => SettlementSource.isSettlement(app, pin));
        const ends = (route) => nextSettlements(app, route, item.x, item.y, settlements);
        if (item.routes.length > 1) return { routes: item.routes.map((route) => routeLine(app, route, ends(route))), description: null, edit: null };
        const [route] = item.routes;
        return {
            rows: GeneratedDetails.forRoute(app, route, { journal: true }),
            leads: endsText(ends(route)),
            description: route.description || null,
            edit: { kind: "route", id: route.id },
        };
    },
    outline(app, item) {
        return { lines: item.routes.map((route) => app.meshSession?.routeLine(route) ?? []) };
    },
});

// ------------------------------------------------------------------ custom rivers

/** A custom river's visibility is its name's: the guide itself is drawn only while editing (EX1 probe). */
function riverVisibility(river) {
    return river?.label ? river.label.visibility ?? "all" : "none";
}

/** Points as a flat array, for the overlay. */
function flat(points) {
    return (points ?? []).flatMap((point) => [point.x, point.y]);
}

const RIVERS = Object.freeze({
    id: "rivers",
    icon: "water",
    at(app, x, y) {
        const reach = lineReach(app);
        const found = [];
        for (const river of app.manualRivers ?? []) {
            if (!drawn(app, riverVisibility(river))) continue;
            const distance = lineDistance(river.points, x, y);
            if (distance <= reach) found.push({ key: `river:${river.id}`, river, distance });
        }
        return found.sort((a, b) => a.distance - b.distance);
    },
    row(app, { river }) {
        return { name: river.name || localize("FILRODENSWMB.UI.InspectRiver"), kind: localize("FILRODENSWMB.UI.InspectRiver"), figure: GeneratedDetails.lengthOf(app, river), gmOnly: riverVisibility(river) === "gm" };
    },
    fold(app, { river }) {
        const length = GeneratedDetails.lengthOf(app, river);
        return {
            rows: length ? [{ label: localize("FILRODENSWMB.UI.GeneratedLength"), value: length }] : [],
            description: river.description || null,
            edit: { kind: "river", id: river.id },
        };
    },
    outline(_app, { river }) {
        return { lines: [flat(river.points)] };
    },
});

// ------------------------------------------------------------------ named natural features

/** A natural feature's kind as a reader names it ("Forest"). */
function featureKindName(kind) {
    return localize(`FILRODENSWMB.UI.FeatureKind${kind.charAt(0).toUpperCase()}${kind.slice(1)}`);
}

/** The box round a feature's footprint (its cells' runs), in map pixels. */
function footprintBox(feature) {
    const { cell, runs } = feature;
    if (!cell || !runs?.length) return null;
    const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (let i = 0; i + 2 < runs.length; i += 3) {
        box.minY = Math.min(box.minY, runs[i] * cell);
        box.maxY = Math.max(box.maxY, (runs[i] + 1) * cell);
        box.minX = Math.min(box.minX, runs[i + 1] * cell);
        box.maxX = Math.max(box.maxX, (runs[i + 1] + runs[i + 2]) * cell);
    }
    return box;
}

const FEATURES = Object.freeze({
    id: "features",
    icon: "landscape",
    at(app, x, y) {
        if (!layerShown(app, "labels")) return [];
        const styleShown = ContentRows.labelShown(app);
        const reach = lineReach(app);
        const found = [];
        for (const label of app.mapLabels ?? []) {
            if (!FeatureNames.isFeatureLabel(label) || !styleShown(label) || !drawn(app, label.visibility)) continue;
            const { feature } = label;
            // A named river's course is a line, reached within the screen's reach at any zoom
            // (footprintHas's own reach is fixed in map pixels; EX1 probe)
            const hit = feature.path ? lineDistance(feature.path, x, y) <= reach : footprintHas(feature, x, y);
            if (hit) found.push({ key: `feature:${label.id}`, label });
        }
        return found;
    },
    row(_app, { label }) {
        return { name: label.name || featureKindName(label.feature.kind), kind: featureKindName(label.feature.kind), figure: null, gmOnly: label.visibility === "gm" };
    },
    fold(_app, { label }) {
        return {
            rows: [{ label: localize("FILRODENSWMB.UI.GeneratedRouteKind"), value: featureKindName(label.feature.kind) }],
            note: i18n().format("FILRODENSWMB.UI.InspectNamedBy", { tool: localize("FILRODENSWMB.UI.FeatureNamesRun") }),
            description: null,
            edit: { kind: "label", id: label.id },
        };
    },
    outline(_app, { label }) {
        const { feature } = label;
        if (feature.path) return { lines: [flat(feature.path)] };
        const box = footprintBox(feature);
        return box ? { box } : null;
    },
});

// ------------------------------------------------------------------ regions

/** The region sets in the Regions panel's order, the Political set first. */
function setsInOrder(app) {
    const sets = app.meshSession?.layerSets ?? [];
    return [...sets.filter((set) => set.kind === "political"), ...sets.filter((set) => set.kind !== "political")];
}

/**
 * Every region the map draws at a map point: set by set (the Political set first), each set's
 * levels deepest first, a region per level at most.
 * @returns {{key: string, region: object, set: object, level: object, depth: number}[]}
 */
export function regionsAt(app, x, y) {
    const session = app.meshSession;
    if (!session || !layerShown(app, "regions")) return [];
    const levelOn = ContentRows.levelShown(app);
    const found = [];
    for (const set of setsInOrder(app)) {
        if (!drawn(app, set.visibility, "all", true)) continue;
        for (let depth = set.levels.length - 1; depth >= 0; depth--) {
            const level = set.levels[depth];
            if (!DetailLevel.shows(app, "region", { set, level }) || !levelOn(level)) continue;
            const levelVisibility = combined(level.visibility, set.visibility);
            if (!drawn(app, levelVisibility, "all", true)) continue;
            const region = session.regionAt(level.id, x, y);
            if (!region || !drawn(app, region.visibility, levelVisibility)) continue;
            found.push({ key: `region:${region.id}`, region, set, level, depth, gmOnly: combined(region.visibility, levelVisibility) === "gm" });
        }
    }
    return found;
}

/** A region as a link in a fold's In line. */
function regionLink({ region, level }) {
    return { key: `region:${region.id}`, name: region.name || localize("FILRODENSWMB.UI.InspectUnnamedRegion"), levelId: level.id, regionId: region.id, regionKey: region.key };
}

/** A region's parents in its set, nearest first, as links. */
function parentsOf(set, depth, region) {
    const parents = [];
    let key = region.parentKey;
    for (let up = depth - 1; up >= 0 && key !== undefined && key !== null; up--) {
        const parent = set.levels[up].regions.find((candidate) => candidate.key === key);
        if (!parent) break;
        parents.push(regionLink({ region: parent, level: set.levels[up] }));
        key = parent.parentKey;
    }
    return parents;
}

/** A set's heading: Political for the Political set, else its own name. */
function setHeading(set) {
    return set.kind === "political" ? localize("FILRODENSWMB.UI.InspectPolitical") : set.name || localize("FILRODENSWMB.UI.InspectRegionSet");
}

const REGIONS = Object.freeze({
    id: "regions",
    icon: "pentagon",
    at: (app, x, y) => regionsAt(app, x, y),
    row(_app, { region, set, level, gmOnly }) {
        const generated = region.generated ?? region.modelled;
        return {
            name: region.name || localize("FILRODENSWMB.UI.InspectUnnamedRegion"),
            kind: level.name || "",
            figure: count(generated?.population),
            set: setHeading(set),
            setId: set.id,
            gmOnly,
        };
    },
    fold(app, { region, set, level, depth }) {
        const rows = [...(GeneratedDetails.forRegion(app, region, { journal: true }) ?? [])];
        if (set.kind !== "political") rows.push(...GeneratedDetails.regionPlace(set, level));
        return {
            rows,
            description: region.description || null,
            within: parentsOf(set, depth, region),
            edit: { kind: "region", id: region.id, levelId: level.id },
        };
    },
    outline(app, { region, level }) {
        const arcs = app.meshSession?.arcsFor(level.id).filter((arc) => arc.a === region.key || arc.b === region.key) ?? [];
        return { lines: arcs.map((arc) => arc.points) };
    },
});

// ------------------------------------------------------------------ the ground

const GROUND = Object.freeze({
    icon: "elevation",
    at(app, x, y) {
        const reading = GroundReading.at(app, x, y, { people: true });
        return reading ? { key: "ground", reading } : null;
    },
    row(app, { reading }) {
        return {
            name: reading.biome || localize("FILRODENSWMB.UI.InspectGroundKind"),
            kind: i18n().format("FILRODENSWMB.UI.InspectElevation", { value: GroundReading.percentText(reading.elevation) }),
            figure: reading.culture?.name ?? null,
            ground: true,
        };
    },
    fold(app, { reading }) {
        const row = (label, value) => (value === null || value === undefined ? null : { label: localize(label), value });
        // With no run, the biome and elevation only, with no note (Ken, EX1 answer 6)
        const run = !!app.meshSession && !!(app.modelRun || app.parentRun);
        return {
            rows: [
                row("FILRODENSWMB.UI.ReadoutBiome", reading.biome),
                row("FILRODENSWMB.UI.InspectElevationLabel", GroundReading.percentText(reading.elevation)),
                run ? row("FILRODENSWMB.UI.InspectTemperature", GroundReading.percentText(reading.temperature)) : null,
                run ? row("FILRODENSWMB.UI.InspectMoisture", GroundReading.percentText(reading.moisture)) : null,
                run ? row("FILRODENSWMB.UI.InspectPeople", GroundReading.cultureText(reading.culture)) : null,
                run ? row("FILRODENSWMB.UI.InspectDensity", GroundReading.densityText(app, reading.density)) : null,
            ].filter(Boolean),
            description: null,
            edit: null,
        };
    },
});

/** Inspect's registration for the Surface map (see StudioRegistry's InspectKind). */
export const SURFACE_INSPECT = Object.freeze({
    kinds: [PINS, ROUTES, RIVERS, FEATURES, REGIONS],
    ground: GROUND,
});
