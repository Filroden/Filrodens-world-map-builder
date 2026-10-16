import { FILRODENSWMB } from "../config.js";
import { Inspector } from "./Inspector.js";
import { InspectorFields } from "./InspectorFields.js";
import { MapDialogManager } from "./MapDialogManager.js";
import { MapStateManager } from "./MapStateManager.js";
import { MeshIntegration } from "./MeshIntegration.js";
import { RegionPanel } from "./RegionPanel.js";
import { RouteTool } from "./RouteTool.js";
import { repathRoute, simplifyRoute } from "../mesh/RouteEdits.js";
import { ROUTE_CLASSES, ROUTE_MODES, ROUTE_THICKNESS_STEP, roundRouteThickness } from "../mesh/Schema.js";
import { platform } from "../platform/index.js";

/** The localisation key of each leg mode, transport, class and stroke. */
const LEG_MODE_LABELS = Object.freeze({ terrain: "FILRODENSWMB.UI.RouteLegTerrain", direct: "FILRODENSWMB.UI.RouteLegDirect" });
const TRANSPORT_LABELS = Object.freeze({ road: "FILRODENSWMB.UI.TransportRoad", river: "FILRODENSWMB.UI.TransportRiver", sea: "FILRODENSWMB.UI.TransportSea" });
const CLASS_LABELS = Object.freeze({ trunk: "FILRODENSWMB.UI.RouteClassTrunk", main: "FILRODENSWMB.UI.RouteClassMain", minor: "FILRODENSWMB.UI.RouteClassMinor" });
const STROKE_LABELS = Object.freeze({ solid: "FILRODENSWMB.UI.StyleSolid", dashed: "FILRODENSWMB.UI.StyleDashed", dotted: "FILRODENSWMB.UI.StyleDotted" });

/** The line fields a route style sets, by their names in the form. */
const LINE_FIELDS = Object.freeze({ routeColor: true, routeThickness: true, routeStyle: true, routeOutline: true, routeSmoothing: true });

/**
 * A route in the inspector (see Inspector): its name, description and visibility; its path (the
 * transport, fixed since its waypoints are all on that transport's ground; the leg mode; whether a
 * road spans water; its class; and Simplify and Re-path); its line (a route style, or its own
 * colour, thickness, stroke, outline and smoothing); its label; and Focus view and Delete.
 *
 * Opening it makes its route the route being edited (its waypoint handles show). A new leg mode
 * applies to the legs drawn from then on; Re-path finds every leg again in it (after the terrain
 * changed, say, or to turn a straight route into one that follows the terrain). Simplify drops the
 * waypoints that barely bend the route, by the Trace detail (the bar's Detail, which it shares;
 * see RouteEdits.simplifyRoute), then finds the legs again. Each is one undo step.
 */
export class RouteEditor {
    /**
     * Opens the inspector on a route.
     * @param {object} app
     * @param {string} routeId
     * @returns {Promise<boolean>}
     */
    static open(app, routeId) {
        return Inspector.open(app, this.KIND, { id: routeId });
    }

    static #find(app, { id }) {
        return app.mapRoutes?.find((route) => route.id === id) ?? null;
    }

    /** The route's kind of inspector. */
    static KIND = Object.freeze({
        id: "route",
        template: "modules/filrodens-world-map-builder/templates/parts/inspector-route.hbs",
        find: (app, ref) => RouteEditor.#find(app, ref),
        opened: (app, route) => RouteTool.select(app, route),
        header: (_app, route) => ({
            title: route.name,
            subtitle: platform.i18n.format("FILRODENSWMB.UI.InspectorSubtitleRoute", { transport: platform.i18n.localize(TRANSPORT_LABELS[route.transport] ?? TRANSPORT_LABELS.road) }),
            swatch: route.color,
        }),
        context: (app, route) => RouteEditor.#context(app, route),
        apply: (app, route, _ref, form, field) => RouteEditor.#apply(app, route, form, field),
        actions: {
            zoom: (app, route) => {
                const points = MeshIntegration.outlinePoints(app, route);
                if (points.length) app.canvasEngine?.zoomToFeature(points);
            },
            simplify: (app, route) => RouteEditor.#reshape(app, route, (session) => simplifyRoute(session, app.mapRoutes, route, RouteTool.tolerancePx(app))),
            repath: (app, route) => RouteEditor.#reshape(app, route, (session) => repathRoute(session, app.mapRoutes, route)),
            delete: (app, route) => RouteEditor.delete(app, route.id),
            saveStyle: (app, route, _ref, button) => RouteEditor.#saveStyle(app, route, button.dataset.styleType),
        },
    });

    /** The template's context: the route, every choice list, and its label with its defaults filled in. */
    static #context(app, route) {
        const choices = (values, labels, selected) => values.map((value) => ({ value, label: labels[value], selected: value === selected }));
        const label = InspectorFields.label(app, route);
        return {
            route,
            visibilities: RegionPanel.visibilityChoices(route.visibility),
            legModes: choices(ROUTE_MODES, LEG_MODE_LABELS, route.mode),
            transportLabel: TRANSPORT_LABELS[route.transport] ?? TRANSPORT_LABELS.road,
            classes: choices(ROUTE_CLASSES, CLASS_LABELS, route.class),
            strokes: choices(Object.keys(STROKE_LABELS), STROKE_LABELS, route.style ?? "solid"),
            thicknessStep: ROUTE_THICKNESS_STEP,
            detail: { ...FILRODENSWMB.MESH.ROUTE_DRAW.DETAIL, value: RouteTool.detail(app) },
            lineStyles: InspectorFields.styleChoices(app.uiState.customRouteStyles, route.quickStyle),
            lineStyleName: InspectorFields.styleName(app.uiState.customRouteStyles, route.quickStyle),
            label,
            labelChoices: InspectorFields.labelChoices(app, label),
            labelStyleName: InspectorFields.styleName(app.uiState.customLabelStyles, label.quickStyle),
            labelVisibilities: RegionPanel.visibilityChoices(label.visibility),
            palette: FILRODENSWMB.LABELS?.PRESETS || [],
        };
    }

    /** What the form holds, as route fields, once `field` has taken effect (see InspectorFields). */
    static read(app, route, form, field) {
        const elements = form.elements;
        const values = {
            name: elements.routeName.value.trim() || route.name,
            description: elements.routeDesc.value,
            visibility: elements.routeVisibility.value,
            mode: elements.routeMode.value,
            spanWater: elements.routeSpanWater.checked,
            class: elements.routeClass.value || null,
            quickStyle: elements.routeQuickStyle.value,
            color: elements.routeColor.value,
            thickness: roundRouteThickness(elements.routeThickness.value),
            style: elements.routeStyle.value,
            outline: elements.routeOutline.checked,
            smoothing: elements.routeSmoothing.checked,
        };
        InspectorFields.settleStyle(values, field, {
            pickerField: "routeQuickStyle",
            styledFields: LINE_FIELDS,
            styles: (app.uiState.customRouteStyles ?? []).map((style) => ({ id: style.id, ...MapDialogManager.routeStyleFields(style) })),
            fields: InspectorFields.STYLE_TYPES.Route.fields,
            key: "quickStyle",
        });
        values.label = InspectorFields.readLabel(form, field, app);
        return values;
    }

    /**
     * Applies the form to the route as one undo step, when anything changed. The Trace detail is
     * the bar's setting rather than the route's, so it is kept with the map's settings instead.
     */
    static #apply(app, route, form, field) {
        if (field === "routeDetail") {
            app.uiState.routeDetail = Number(form.elements.routeDetail.value);
            app.view?.render(["editToolbar"]);
            return true;
        }
        const values = this.read(app, route, form, field);
        const current = { ...route, class: route.class ?? null, spanWater: route.spanWater === true, outline: route.outline !== false, smoothing: route.smoothing === true, label: InspectorFields.label(app, route) };
        if (!InspectorFields.differs(current, values)) return false;
        MapStateManager.pushVectorState(app);
        const { label, ...fields } = values;
        Object.assign(route, fields);
        route.label = { ...route.label, ...label };
        this.#redraw(app, route);
        return true;
    }

    /** Simplify and Re-path: the path found again by `change`, one undo step. */
    static #reshape(app, route, change) {
        if (!app.meshSession) return;
        MapStateManager.pushVectorState(app);
        change(app.meshSession);
        this.#redraw(app, route);
    }

    /** Save as…: a route style from the route's line, or a label style from its label. */
    static async #saveStyle(app, route, type) {
        const source = type === "Label" ? InspectorFields.label(app, route) : MapDialogManager.routeStyleFields(route);
        const id = await InspectorFields.saveStyleAs(app, type, source);
        if (!id) return;
        MapStateManager.pushVectorState(app);
        if (type === "Label") route.label = { ...source, ...route.label, quickStyle: id };
        else route.quickStyle = id;
        this.#redraw(app, route);
    }

    static #redraw(app, route) {
        RouteTool.syncToolbar(app, route);
        app._repaintVectors();
        app.view?.render(["context", "editToolbar"]);
        app.markDirty();
    }

    /**
     * Removes a route after confirmation, one undo step. The session forgets the route's cached
     * line, and the route stops being the one edited.
     */
    static async delete(app, routeId) {
        const route = this.#find(app, { id: routeId });
        if (!route || !(await MapDialogManager._confirmDialog())) return;
        MapStateManager.pushVectorState(app);
        app.mapRoutes = app.mapRoutes.filter((candidate) => candidate !== route);
        app.meshSession?.forgetRoute(route.id);
        if (app.activeRouteId === route.id) RouteTool.select(app, null);
        app._repaintVectors();
        app.view?.render(["context", "editToolbar"]);
        app.markDirty();
    }
}
