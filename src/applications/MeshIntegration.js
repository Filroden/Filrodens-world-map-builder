import { FILRODENSWMB } from "../config.js";
import { MeshLoader } from "../mesh/MeshLoader.js";
import { MeshBuilder } from "../mesh/MeshBuilder.js";
import { MeshSession, SESSION_WARNINGS } from "../mesh/MeshSession.js";
import { distanceToSegment } from "../mesh/RoutePath.js";
import { resampleOwners, retraceLine, routeMarkedLine } from "../mesh/Resample.js";
import { VECTOR_SCHEMA_VERSION, createMeshBlock, createRoute, validateOwners } from "../mesh/Schema.js";
import { allLevels } from "../mesh/LayerTree.js";
import { RegionPanel } from "./RegionPanel.js";
import { DetailLevel } from "./DetailLevel.js";
import { VectorHistory } from "./VectorHistory.js";
import { platform } from "../platform/index.js";

/**
 * Connects the Map Studio to the display mesh (src/mesh/): opening a map's mesh session when the
 * map loads, keeping it in step with the map while it is open, drawing from it, and writing it back
 * when the map is saved. The Studio calls in at a handful of points with a line or two each; the
 * logic lives here so the Studio's own code changes as little as possible.
 *
 * State it keeps on the app:
 * - meshSession: the open map's MeshSession, or null while a map is opening (or when it could not
 *   be prepared).
 * - layerSets: the map's layer sets, the one list of sets, levels and regions that the region
 *   panel, the region tools, undo and saving all work on. The session is handed the same objects
 *   (see prepareRender), so it always draws what the panel shows.
 * - meshState: what the mesh code needs between calls (the load in progress, a pending terrain
 *   refresh, whether the map changed on load).
 */
export class MeshIntegration {
    static #loader = null;

    static #state(app) {
        app.meshState ??= { token: 0, load: null, terrainStale: false, changedOnLoad: false, unavailable: false, notified: false };
        return app.meshState;
    }

    static async #meshLoader() {
        this.#loader ??= MeshLoader.create();
        return this.#loader;
    }

    // ------------------------------------------------------------------ opening a map

    /**
     * Starts opening a loaded map's mesh: forgets the previous map's session and starts building
     * (or reading from the cache) the mesh the map's stored block describes, while the terrain
     * generates. Called from the Studio's payload ingest, before the terrain is generated.
     *
     * The map's layer sets are listed straight away from what was saved (none for a map saved
     * before layer sets existed, whose region layers become a set once the session migrates them).
     *
     * @param {object} app
     * @param {object} payload - The map data being loaded (the Studio's own clone).
     * @param {Object<string, string>} owners - Its encoded owner arrays.
     */
    static beginLoad(app, payload, owners) {
        const state = this.#state(app);
        state.token += 1;
        state.changedOnLoad = false;
        state.unavailable = false;
        app.meshSession = null;
        app.layerSets = payload.layerSets ?? [];
        state.load = { token: state.token, payload, owners: owners ?? {}, prefetch: this.#prefetch(payload) };
    }

    /**
     * The mesh data of the map's stored block, being built (or read) already. Only a block that
     * will be used as it is can be fetched ahead; any other case is built when the session opens.
     */
    static #prefetch(payload) {
        const isCurrent = (payload.vectorSchemaVersion ?? 0) >= VECTOR_SCHEMA_VERSION;
        const fits = payload.mesh && payload.mesh.version === FILRODENSWMB.MESH.ALGORITHM_VERSION && (payload.mesh.width ?? payload.mapWidth) === payload.mapWidth && (payload.mesh.height ?? payload.mapHeight) === payload.mapHeight;
        if (isCurrent && !fits) return null;

        const block = isCurrent ? payload.mesh : createMeshBlock(payload);
        const params = MeshBuilder.paramsFor({ ...payload, mesh: block });
        const promise = this.#meshLoader().then((loader) => loader.load(params));
        // A failed prefetch is retried when the session opens; nobody else awaits it
        promise.catch(() => null);
        return { params, promise };
    }

    /**
     * Finishes opening the map once its terrain exists: opens the mesh session (migrating a map
     * saved before vector schema version 4, or rebuilding a mesh that no longer fits), adopts the
     * session's layer sets, routes and pins, and redraws. Shows its progress on the processing
     * overlay and reports a migration or rebuild once.
     *
     * If the session cannot be prepared, the map's vector data stays exactly as it was loaded and is
     * saved back unchanged (see preparePayload), so nothing is lost.
     *
     * @param {object} app
     * @param {object} overlay - The Studio's processing overlay: { start(text), end(), text(text) }.
     */
    static async finishLoad(app, overlay) {
        const state = this.#state(app);
        const load = state.load;
        if (!load || load.token !== state.token) return;
        state.load = null;

        await overlay.start(platform.i18n.localize("FILRODENSWMB.UI.PreparingMap"));
        try {
            const result = await MeshSession.open(load.payload, {
                owners: load.owners,
                buffers: this.terrainBuffers(app),
                loadMeshData: (params) => this.#loadMeshData(params, load.prefetch, overlay),
                onProgress: (progress) => overlay.text(this.#progressText(progress)),
                idFactory: () => platform.utils.randomID(),
                setName: platform.i18n.localize("FILRODENSWMB.UI.MigratedRegionsSet"),
            });
            if (state.token !== load.token) return;
            this.#adopt(app, result);
            this.#report(result);
        } catch (error) {
            console.error("FWMB | The map's mesh could not be prepared:", error);
            state.unavailable = true;
            platform.notify.error(platform.i18n.localize("FILRODENSWMB.UI.MeshLoadFailed"));
        } finally {
            overlay.end();
        }
        app._repaintVectors();
        app.view?.render(["context"]);
    }

    static async #loadMeshData(params, prefetch, overlay) {
        const sameParams = prefetch && ["width", "height", "spacing", "modelSpacing", "seed"].every((key) => prefetch.params[key] === params[key]);
        if (sameParams) {
            const data = await prefetch.promise.catch(() => null);
            if (data) return data;
        }
        const loader = await this.#meshLoader();
        return loader.load(params, { onProgress: (progress) => overlay.text(this.#progressText(progress)) });
    }

    static #progressText({ stage, pct }) {
        const keys = { migrate: "FILRODENSWMB.UI.PreparingMapMigrate", rebuild: "FILRODENSWMB.UI.PreparingMapRebuild", aggregates: "FILRODENSWMB.UI.PreparingMap" };
        const text = platform.i18n.localize(keys[stage] ?? "FILRODENSWMB.UI.PreparingMapMesh");
        return Number.isFinite(pct) && !keys[stage] ? `${text} ${pct}%` : text;
    }

    static #adopt(app, { session, mapData, changed }) {
        const state = this.#state(app);
        app.meshSession = session;
        app.layerSets = mapData.layerSets ?? [];
        app.mapRoutes = mapData.mapRoutes ?? [];
        app.mapPins = mapData.mapPins ?? [];
        app.uiState.world = mapData.world ?? app.uiState.world ?? null;
        state.changedOnLoad = changed;
        // A migrated map's vector history describes the old shapes; it starts afresh
        if (changed) {
            app.pinHistory = [];
            app.pinRedoStack = [];
            app.globalHistoryLedger = (app.globalHistoryLedger ?? []).filter((entry) => entry !== "vector");
        }
    }

    static #report({ migrated, warnings }) {
        if (migrated) platform.notify.info(platform.i18n.localize("FILRODENSWMB.UI.MapUpgraded"), { permanent: true });
        for (const { key, detail } of warnings) {
            if (key === SESSION_WARNINGS.REBUILT) platform.notify.warn(platform.i18n.localize("FILRODENSWMB.UI.MeshRebuilt"), { permanent: true });
            else if (key === SESSION_WARNINGS.OWNERS_LOST || key === SESSION_WARNINGS.OWNERS_MISSING) platform.notify.warn(platform.i18n.format("FILRODENSWMB.UI.MeshOwnersLost", { detail }));
            else console.warn(`FWMB | Map data check: ${detail}`);
        }
    }

    /**
     * Whether the map changed as it was opened (migrated or rebuilt), so the Studio leaves it
     * marked unsaved.
     */
    static changedOnLoad(app) {
        return this.#state(app).changedOnLoad === true;
    }

    /**
     * Gives a new map (a fresh canvas, or one created from the resolution dialogue) an empty mesh
     * session once its terrain exists. Runs in the background: an empty map draws nothing from
     * its mesh, and a map loaded meanwhile takes precedence (the token check).
     *
     * The map's layer sets are left as they are: the Studio empties them when it starts the new
     * map, and any level or region added while the terrain was generating (the panel can be used
     * by then) belongs to this map and is kept for the session.
     */
    static startNewMap(app) {
        const state = this.#state(app);
        state.token += 1;
        state.load = null;
        state.changedOnLoad = false;
        state.unavailable = false;
        const token = state.token;
        app.meshSession = null;
        // A new map starts with one set and its first layer, ready for regions (S12)
        if (!app.layerSets?.length) app.layerSets = RegionPanel.starterLayerSets();

        const mapData = { mapWidth: app.mapWidth, mapHeight: app.mapHeight, seed: app.uiState.mapSeed, params: { latTop: app.uiState.latTop, latBottom: app.uiState.latBottom }, world: app.uiState.world };
        this.#meshLoader()
            .then((loader) => MeshSession.create(mapData, { buffers: this.terrainBuffers(app), loadMeshData: (params) => loader.load(params) }))
            .then((session) => {
                if (state.token === token) app.meshSession = session;
            })
            .catch((error) => console.error("FWMB | The new map's mesh could not be built:", error));
    }

    // ------------------------------------------------------------------ while the map is open

    /**
     * Moves everything on the mesh with the terrain when the map's noise is panned or rescaled:
     * every level's regions are resampled (each cell takes the owner of the cell that was where
     * it now is), and every route's line is moved and traced again, so regions and routes stay
     * over the same ground. A route moved partly off the map comes back as the pieces still on it
     * (the first keeps the route's identity, the others are new routes); one moved wholly off is
     * gone. Pins and labels are plain points the caller moves itself.
     *
     * A cell whose source point lies just beyond the map's edge (within one cell spacing) takes
     * the owner of the nearest cell on the edge; further out it is unclaimed, as the map never
     * showed that ground. The one-cell allowance is for the cells' jitter: a region painted up to
     * the edge and moved inwards would otherwise lose its border cells (those whose source points
     * fall a fraction of a cell outside the map), and have a ragged, part-unclaimed border when
     * moved back. With it, the region keeps a fringe one cell wide over the revealed strip and is
     * whole again on the way back, without spreading over the strip.
     *
     * @param {object} app
     * @param {function(number, number): [number, number]} toTarget - Where a map point goes.
     * @param {function(number, number): [number, number]} toSource - Where a map point came from (the inverse).
     * @returns {Array} History entries restoring each level's owners (the routes are covered by a vector snapshot).
     */
    static transformContent(app, toTarget, toSource) {
        const session = app.meshSession;
        if (!session) return [];
        const mesh = session.mesh;
        const reach = mesh.spacing;
        const within = (value, size) => Math.min(Math.max(value, 0), size - 1);
        const fromEdge = (x, y) => {
            const [sourceX, sourceY] = toSource(x, y);
            const near = sourceX >= -reach && sourceY >= -reach && sourceX <= mesh.width - 1 + reach && sourceY <= mesh.height - 1 + reach;
            return near ? [within(sourceX, mesh.width), within(sourceY, mesh.height)] : [sourceX, sourceY];
        };
        const entries = [];
        for (const level of allLevels(app.layerSets ?? [])) {
            const layer = session.layer(level.id);
            if (!layer) continue;
            const before = layer.encode();
            session.restoreLevelOwners(level.id, resampleOwners(mesh, layer.owners, mesh, fromEdge));
            entries.push(VectorHistory.levelOwners(level.id, before, session.layer(level.id).encode()));
        }
        app.mapRoutes = (app.mapRoutes ?? []).flatMap((route) => this.#movedRoute(session, route, toTarget));
        return entries;
    }

    /** A route traced again along its moved line: itself for the first piece on the map, a new route for each other piece. */
    static #movedRoute(session, route, toTarget) {
        const pieces = retraceLine(routeMarkedLine(route, session.mesh), session.mesh, toTarget);
        session.forgetRoute(route.id);
        return pieces.map((piece, index) => {
            if (index === 0) return Object.assign(route, piece);
            const label = route.label ? structuredClone(route.label) : null;
            return createRoute({ ...route, id: undefined, label, waypoints: piece.waypoints, legs: piece.legs, generated: null });
        });
    }

    /** The terrain buffers the per-cell summaries read (see Mesh.aggregate), or null before the terrain exists. */
    static terrainBuffers(app) {
        if (!app.currentElevationData) return null;
        return { elevation: app.currentElevationData, seaLevel: app.uiState.seaLevel, waterMask: app.bufferWaterMask ?? null, riverMap: app.bufferRiverMap ?? null };
    }

    /**
     * Records that the terrain, water or rivers are being regenerated, so the per-cell summaries
     * are refreshed before the vectors are next drawn (see prepareRender). Called as each refresh
     * of the Studio's refresh queue starts.
     */
    static markTerrainChanged(app) {
        this.#state(app).terrainStale = true;
    }

    /**
     * Brings the session in line with the map before a draw: the layer sets (which the panel,
     * the tools and undo may have changed or replaced), and the per-cell summaries with the
     * terrain if it has been regenerated since the last draw.
     */
    static prepareRender(app) {
        const session = app.meshSession;
        if (!session) return;
        session.setLayerSets(app.layerSets);
        const state = this.#state(app);
        const buffers = state.terrainStale ? this.terrainBuffers(app) : null;
        if (!buffers) return;
        state.terrainStale = false;
        session.refreshAggregates(buffers);
    }

    /**
     * Draws the region levels (see StudioCanvas.renderRegionLevels): each level at its own opacity
     * multiplied by its layer set's, or, while the Regions tool is painting a level, that level and
     * its ancestors alone, drawn for painting (see RegionLevelLayers.describeLevels), unless the
     * toolbar's Show Everything is on. The outline of the region being edited follows (see updateOutline).
     */
    static renderRegions(app) {
        const painting = app.activeTool === "regions" && app.uiState.isEditMode && !app.uiState.regionShowAll;
        app.canvasEngine.renderRegionLevels(app.meshSession, { focusLevelId: painting ? app.activeLevelId : null });
        this.updateOutline(app);
    }

    /**
     * Outlines the region being edited while the Regions tool is in use: the border arcs it shares
     * with its neighbours, unclaimed ground and the sea. Nothing is outlined in other tools. While
     * a paint stroke is under way the borders are those from before it (they are rebuilt when it
     * ends), so the outline catches up on release.
     */
    static updateOutline(app) {
        const overlays = app.canvasEngine?.regionOverlays;
        if (!overlays) return;
        const found = app.activeTool === "regions" && app.activeRegionId ? app.meshSession?.findRegion(app.activeRegionId) : null;
        if (!found) {
            overlays.setOutline([]);
            return;
        }
        const key = found.region.key;
        overlays.setOutline(app.meshSession.arcsFor(found.level.id).filter((arc) => arc.a === key || arc.b === key));
    }

    /**
     * Wires the canvas's hit test for what is drawn from the mesh: in the Regions tool, the region
     * of the topmost visible level under the pointer; in the Infrastructure tool, a route whose
     * line passes within `radius` of it. Either can be double-clicked to edit, not dragged.
     */
    static bindHitTest(app) {
        if (!app.canvasEngine) return;
        app.canvasEngine.meshHitTest = (x, y, radius) => {
            if (!app.meshSession) return null;
            if (app.activeTool === "regions") return this.#regionHit(app, x, y);
            if (app.activeTool === "infrastructure") return this.#routeHit(app, x, y, radius);
            return null;
        };
    }

    /**
     * The region under the pointer: on the level being edited when there is one (so a level
     * below others can still be picked), otherwise on the topmost visible level that has a
     * region there. A level the map's detail level hides is not picked.
     */
    static #regionHit(app, x, y) {
        const active = app.activeLevelId ? app.meshSession.level(app.activeLevelId) : null;
        const detailed = app.meshSession.layerSets.flatMap((set) => set.levels.filter((level) => DetailLevel.shows(app, "region", { set, level })));
        const visible = detailed.filter((level) => this.#shown(app, level.visibility)).reverse();
        const levels = active ? [active] : visible;
        for (const level of levels) {
            const region = app.meshSession.regionAt(level.id, x, y);
            if (region && this.#shown(app, region.visibility)) return { target: region, x, y, radius: 0, entityType: "region", entityId: region.id, layerId: level.id, selectOnly: true };
        }
        return null;
    }

    /** Whether an item of a visibility can be picked: a hidden one only while the Hidden view filter shows it. */
    static #shown(app, visibility) {
        return visibility !== "none" || app.viewFilters?.none === true;
    }

    static #routeHit(app, x, y, radius) {
        const route = this.routeAt(app, x, y, radius);
        return route ? { target: route, x, y, radius: 0, entityType: "route", entityId: route.id, selectOnly: true } : null;
    }

    /**
     * The visible route whose line passes nearest a map point, within `radius` map pixels, or null.
     * @param {object} app
     * @param {number} x
     * @param {number} y
     * @param {number} radius
     * @returns {object|null}
     */
    static routeAt(app, x, y, radius) {
        if (!app.meshSession) return null;
        let best = null;
        for (const route of app.mapRoutes ?? []) {
            if (!this.#shown(app, route.visibility)) continue;
            const distance = distanceToLine(app.meshSession.routeLine(route), x, y, radius);
            if (distance <= radius && (!best || distance < best.distance)) best = { route, distance };
        }
        return best?.route ?? null;
    }

    // ------------------------------------------------------------------ geometry for the Studio

    /**
     * Points outlining a region or route drawn from the mesh (the corners of its bounds), for
     * zooming to it and outlining it in an undo preview. Empty when it is not on the mesh.
     * @param {object} app
     * @param {object} entity - A region, a level or layer set (its regions together) or a route.
     * @returns {Array<{x: number, y: number}>}
     */
    static outlinePoints(app, entity) {
        const session = app.meshSession;
        if (!session || !entity) return [];
        if (Array.isArray(entity.legs)) return boxCorners(lineBounds(session.routeLine(entity)));
        if (Array.isArray(entity.levels)) return entity.levels.flatMap((level) => this.outlinePoints(app, level));
        if (Array.isArray(entity.regions)) return entity.regions.flatMap((region) => this.outlinePoints(app, region));
        const found = session.findRegion(entity.id);
        return found ? boxCorners(session.regionBounds(found.level.id, found.region.key)) : [];
    }

    // ------------------------------------------------------------------ saving

    /**
     * Puts the mesh data into a save payload: vector schema version, mesh block, layer sets (in
     * place of region layers), routes in the mesh shape and pins with their cells. Returns the
     * encoded owner arrays to save beside it.
     *
     * A map whose mesh could not be prepared is saved exactly as it was loaded (its old region
     * layers and routes), so a failure never loses data.
     *
     * @param {object} app
     * @param {object} payload - The save payload (updated in place).
     * @returns {Object<string, string>|null} The owners, or null to leave stored owners alone.
     */
    static preparePayload(app, payload) {
        const state = this.#state(app);
        if (state.unavailable) return null;

        const session = app.meshSession;
        if (session) {
            session.setLayerSets(app.layerSets);
            this.#checkOwners(session);
            session.assignPinCells(payload.mapPins);
        }
        delete payload.regionLayers;
        payload.vectorSchemaVersion = VECTOR_SCHEMA_VERSION;
        payload.mesh = session ? { ...session.meshBlock } : createMeshBlock(payload);
        payload.layerSets = app.layerSets ?? [];
        return session ? session.encodeOwners() : {};
    }

    /**
     * The last check before owners are saved: every level's owner array fits the mesh and names
     * only the level's own regions. A mismatch means a bug elsewhere; it is logged rather than
     * refused, since the save then writes unclaimed cells for the keys no region has (see
     * MeshSession.encodeOwners) and loses nothing a region holds.
     */
    static #checkOwners(session) {
        const problems = [...session.levels()].flatMap((level) => validateOwners(session.layer(level.id).owners, level, session.mesh.cellCount));
        if (problems.length) console.warn(`FWMB | Region data check before saving: ${problems.join("; ")}`);
    }
}

// ------------------------------------------------------------------ geometry helpers

/** The bounds of a flat polyline, or null when it is empty. */
function lineBounds(line) {
    if (!line.length) return null;
    const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (let i = 0; i < line.length; i += 2) {
        box.minX = Math.min(box.minX, line[i]);
        box.maxX = Math.max(box.maxX, line[i]);
        box.minY = Math.min(box.minY, line[i + 1]);
        box.maxY = Math.max(box.maxY, line[i + 1]);
    }
    return box;
}

function boxCorners(box) {
    return box ? [{ x: box.minX, y: box.minY }, { x: box.maxX, y: box.maxY }] : [];
}

/**
 * Distance from a point to a flat polyline, skipping segments whose bounding box (widened by
 * `radius`) does not hold the point, so most of a long route costs a comparison or two.
 */
function distanceToLine(line, x, y, radius) {
    if (line.length === 2) return Math.hypot(line[0] - x, line[1] - y);
    let best = Infinity;
    for (let i = 0; i + 3 < line.length; i += 2) {
        const [ax, ay, bx, by] = [line[i], line[i + 1], line[i + 2], line[i + 3]];
        if (x < Math.min(ax, bx) - radius || x > Math.max(ax, bx) + radius || y < Math.min(ay, by) - radius || y > Math.max(ay, by) + radius) continue;
        best = Math.min(best, distanceToSegment(x, y, ax, ay, bx, by));
    }
    return best;
}
