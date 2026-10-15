import { FILRODENSWMB } from "../config.js";
import { MapDialogManager } from "./MapDialogManager.js";
import { MapStateManager } from "./MapStateManager.js";
import { RegionPanel } from "./RegionPanel.js";
import { RouteTool } from "./RouteTool.js";
import { repathRoute, simplifyRoute } from "../mesh/RouteEdits.js";
import { ROUTE_CLASSES, ROUTE_MODES, ROUTE_THICKNESS_STEP, roundRouteThickness } from "../mesh/Schema.js";
import { platform } from "../platform/index.js";

const TEMPLATE = "modules/filrodens-world-map-builder/templates/dialogs/edit-routes.hbs";

/** The localisation key of each leg mode, transport and class. */
const LEG_MODE_LABELS = Object.freeze({ terrain: "FILRODENSWMB.UI.RouteLegTerrain", direct: "FILRODENSWMB.UI.RouteLegDirect" });
const TRANSPORT_LABELS = Object.freeze({ road: "FILRODENSWMB.UI.TransportRoad", river: "FILRODENSWMB.UI.TransportRiver", sea: "FILRODENSWMB.UI.TransportSea" });
const CLASS_LABELS = Object.freeze({ trunk: "FILRODENSWMB.UI.RouteClassTrunk", main: "FILRODENSWMB.UI.RouteClassMain", minor: "FILRODENSWMB.UI.RouteClassMinor" });

/**
 * The route editor: a route's name, description, visibility, path (leg mode and class; the
 * transport is shown but fixed, since it was chosen when the route was drawn and its waypoints
 * are all on that transport's ground), line (its own colour, thickness, style, outline and
 * smoothing, or a route quick style) and label, with Delete, Simplify and Re-path beside Cancel
 * and Save.
 *
 * It is docked like the region editor, so the map stays usable while it is open, and opening it
 * makes its route the route being edited (its waypoint handles show). One route is edited at a
 * time: opening another route's editor closes the one open, discarding unsaved changes, as does
 * switching tool or mode.
 *
 * Nothing changes until Save, Simplify or Re-path, each one undo step. Save applies the fields.
 * Re-path saves them and then finds every leg again in the chosen leg mode (after the terrain
 * changed, say, or to turn a straight route into one that follows the terrain). Simplify saves
 * them and drops the waypoints that barely bend the route, by the Detail setting (the editor
 * shows the toolbar's and writes back to it; see RouteEdits.simplifyRoute), then finds the legs
 * again. The route is looked up again when the
 * editor closes, since an undo may have removed it meanwhile.
 */
export class RouteEditor {
    /**
     * Opens the editor for a route.
     * @param {object} app
     * @param {string} routeId
     */
    static async open(app, routeId) {
        const route = this.#find(app, routeId);
        if (!route) return;
        platform.dialogs.dismiss({ placement: "docked" });
        RouteTool.select(app, route);

        const content = await platform.templates.render(TEMPLATE, this.#context(app, route));
        const choice = await platform.dialogs.choose({
            placement: "docked",
            classes: ["fwmb", "fwmb-route-editor"],
            title: platform.i18n.format("FILRODENSWMB.UI.EditRouteTitle", { name: route.name }),
            content,
            onRender: (element) => this.#bind(app, element),
            buttons: this.#buttons(),
            dismissed: null,
        });
        await this.#finish(app, routeId, choice);
    }

    /** The template's context: the route with its label defaults filled in, and every choice list. */
    static #context(app, route) {
        const safeRoute = MapDialogManager._withLabelDefaults(app, route);
        const choices = (values, labels, selected) => values.map((value) => ({ value, label: labels[value], selected: value === selected }));
        return {
            route: safeRoute,
            visibilities: RegionPanel.visibilityChoices(route.visibility),
            legModes: choices(ROUTE_MODES, LEG_MODE_LABELS, route.mode),
            transportLabel: TRANSPORT_LABELS[route.transport] ?? TRANSPORT_LABELS.road,
            classes: choices(ROUTE_CLASSES, CLASS_LABELS, route.class),
            thicknessStep: ROUTE_THICKNESS_STEP,
            detail: { ...FILRODENSWMB.MESH.ROUTE_DRAW.DETAIL, value: RouteTool.detail(app) },
            rotationRange: FILRODENSWMB.UI.ROTATION,
            fonts: platform.fonts.list(),
            palette: FILRODENSWMB.LABELS?.PRESETS || [],
            customLabelStyles: app.uiState.customLabelStyles || [],
            customRouteStyles: app.uiState.customRouteStyles || [],
        };
    }

    static #buttons() {
        const localize = (key) => platform.i18n.localize(key);
        return [
            { action: "delete", label: localize("FILRODENSWMB.UI.Delete"), icon: "fwmb-icon fwmb-icon--delete", tone: "negative", callback: () => ({ action: "delete" }) },
            { action: "simplify", label: localize("FILRODENSWMB.UI.SimplifyRoute"), icon: "fwmb-icon fwmb-icon--remove", tone: "caution", callback: (form) => ({ action: "simplify", values: this.#read(form), detail: Number(form.elements.routeDetail.value) }) },
            { action: "repath", label: localize("FILRODENSWMB.UI.RepathRoute"), icon: "fwmb-icon fwmb-icon--sync", tone: "caution", callback: (form) => ({ action: "repath", values: this.#read(form) }) },
            { action: "cancel", label: localize("FILRODENSWMB.UI.Cancel"), icon: "fwmb-icon fwmb-icon--cancel", tone: "negative", callback: () => null },
            { action: "save", label: localize("FILRODENSWMB.UI.Save"), icon: "fwmb-icon fwmb-icon--accept", tone: "positive", default: true, callback: (form) => ({ action: "save", values: this.#read(form) }) },
        ];
    }

    static async #finish(app, routeId, choice) {
        if (!choice) return;
        if (choice.action === "delete") {
            await this.delete(app, routeId);
            return;
        }
        const route = this.#find(app, routeId);
        if (!route) return;
        MapStateManager.pushVectorState(app);
        platform.utils.mergeObject(route, choice.values);
        if (choice.action === "repath") repathRoute(app.meshSession, app.mapRoutes, route);
        if (choice.action === "simplify") {
            // The editor's Detail is the toolbar's, so the two never disagree
            app.uiState.routeDetail = choice.detail;
            simplifyRoute(app.meshSession, app.mapRoutes, route, RouteTool.tolerancePx(app));
        }
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
        const route = this.#find(app, routeId);
        if (!route || !(await MapDialogManager._confirmDialog())) return;
        MapStateManager.pushVectorState(app);
        app.mapRoutes = app.mapRoutes.filter((candidate) => candidate !== route);
        app.meshSession?.forgetRoute(route.id);
        if (app.activeRouteId === route.id) RouteTool.select(app, null);
        app._repaintVectors();
        app.view?.render(["context", "editToolbar"]);
        app.markDirty();
    }

    static #find(app, routeId) {
        return app.mapRoutes?.find((route) => route.id === routeId) ?? null;
    }

    /** What the editor's fields hold, as route fields. */
    static #read(form) {
        const elements = form.elements;
        return {
            name: elements.routeName.value.trim() || elements.routeName.defaultValue,
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
            label: MapDialogManager._extractLabelResultFields(form),
        };
    }

    /**
     * Choosing a quick style fills the line fields from it; changing a line field by hand leaves the
     * quick style for Custom. The label fields work as in every other editor.
     */
    static #bind(app, element) {
        const quickStyle = element.querySelector('select[name="routeQuickStyle"]');
        const fields = {
            color: element.querySelector('input[name="routeColor"]'),
            thickness: element.querySelector('input[name="routeThickness"]'),
            style: element.querySelector('select[name="routeStyle"]'),
            outline: element.querySelector('input[name="routeOutline"]'),
            smoothing: element.querySelector('input[name="routeSmoothing"]'),
        };

        quickStyle?.addEventListener("change", () => {
            const chosen = (app.uiState.customRouteStyles ?? []).find((candidate) => candidate.id === quickStyle.value);
            if (!chosen) return;
            MapDialogManager.applyRouteStyleToFields(chosen, fields);
        });
        const toCustom = () => {
            if (quickStyle) quickStyle.value = "custom";
        };
        for (const [name, field] of Object.entries(fields)) field?.addEventListener(name === "color" || name === "thickness" ? "input" : "change", toCustom);

        MapDialogManager.bindLabelPropertiesDialog(element, app.uiState);
    }
}
