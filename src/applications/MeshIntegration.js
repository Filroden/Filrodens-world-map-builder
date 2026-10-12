import { FILRODENSWMB } from "../config.js";
import { MeshLoader } from "../mesh/MeshLoader.js";
import { MeshBuilder } from "../mesh/MeshBuilder.js";
import { MeshSession, SESSION_WARNINGS } from "../mesh/MeshSession.js";
import { distanceToSegment } from "../mesh/RoutePath.js";
import { VECTOR_SCHEMA_VERSION, createLayerSet, createLevel, createMeshBlock } from "../mesh/Schema.js";
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
 * - layerSets: the map's layer sets. Their levels are also what the region panel lists, as
 *   app.regionLayers (see regionLayersView), so the existing list, visibility and edit dialogues
 *   work on them unchanged; reconcile keeps the two in step.
 * - meshState: what the mesh code needs between calls (the load in progress, a pending terrain
 *   refresh, whether the map changed on load).
 *
 * With FILRODENSWMB.MESH_NATIVE off none of this runs and the Studio behaves as before, which is
 * what makes a side-by-side comparison possible (see legacyView).
 */
export class MeshIntegration {
    static #loader = null;

    /** Whether regions and routes are drawn from the mesh. */
    static get enabled() {
        return FILRODENSWMB.MESH_NATIVE === true;
    }

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
     * The map's region layers are listed straight away from what was saved (the old region layers,
     * or the levels of the layer sets), so label width migration and the panel see them; they are
     * replaced by the session's levels once it opens.
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
                // The map's region opacity applies over every level (see renderVectors), as it did
                // over every region layer, so migrated levels add none of their own
                levelOpacity: 1,
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
        app.render({ parts: ["context"] });
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
        app.regionLayers = this.regionLayersView(app.layerSets);
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
        return this.enabled && this.#state(app).changedOnLoad === true;
    }

    /**
     * Gives a new map (a fresh canvas, or one created from the resolution dialogue) an empty mesh
     * session once its terrain exists. Runs in the background: an empty map draws nothing from
     * its mesh, and a map loaded meanwhile takes precedence (the token check).
     */
    static startNewMap(app) {
        if (!this.enabled) return;
        const state = this.#state(app);
        state.token += 1;
        state.load = null;
        state.changedOnLoad = false;
        state.unavailable = false;
        const token = state.token;
        app.meshSession = null;
        app.layerSets = [];
        app.regionLayers = [];

        const mapData = { mapWidth: app.mapWidth, mapHeight: app.mapHeight, seed: app.uiState.mapSeed, params: { latTop: app.uiState.latTop, latBottom: app.uiState.latBottom }, world: app.uiState.world };
        this.#meshLoader()
            .then((loader) => MeshSession.create(mapData, { buffers: this.terrainBuffers(app), loadMeshData: (params) => loader.load(params) }))
            .then((session) => {
                if (state.token === token) app.meshSession = session;
            })
            .catch((error) => console.error("FWMB | The new map's mesh could not be built:", error));
    }

    // ------------------------------------------------------------------ while the map is open

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
        if (this.enabled) this.#state(app).terrainStale = true;
    }

    /**
     * Brings the session in line with the map before a draw: the layer sets with the region
     * panel's list (see reconcile), and the per-cell summaries with the terrain if it has been
     * regenerated since the last draw.
     */
    static prepareRender(app) {
        const session = app.meshSession;
        if (!session) return;
        this.reconcile(app);
        const state = this.#state(app);
        const buffers = state.terrainStale ? this.terrainBuffers(app) : null;
        if (!buffers) return;
        state.terrainStale = false;
        session.refreshAggregates(buffers);
    }

    /**
     * The levels of the layer sets, as the list the region panel and its dialogues work on
     * (app.regionLayers). A level has the fields an old region layer had (id, name, visibility,
     * regions), so the panel needs no change to list, rename, hide, edit or delete them.
     */
    static regionLayersView(layerSets) {
        return (layerSets ?? []).flatMap((set) => set.levels);
    }

    /**
     * Makes the layer sets match app.regionLayers, which the panel and undo change directly: a
     * level the panel deleted leaves its set, a level an undo restored (as a copy) replaces its
     * namesake, and a layer added from the panel becomes a level of the first custom set (made if
     * there is none). The session then adopts the result.
     */
    static reconcile(app) {
        if (!app.meshSession) return;
        const listed = new Map((app.regionLayers ?? []).map((layer) => [layer.id, layer]));
        const placed = new Set();
        for (const set of app.layerSets ?? []) {
            set.levels = set.levels.filter((level) => listed.has(level.id)).map((level) => listed.get(level.id));
            for (const level of set.levels) placed.add(level.id);
        }
        const added = [...listed.values()].filter((layer) => !placed.has(layer.id));
        if (added.length) this.#adoptAddedLayers(app, added);
        app.meshSession.setLayerSets(app.layerSets);
    }

    static #adoptAddedLayers(app, layers) {
        app.layerSets ??= [];
        let set = app.layerSets.find((candidate) => candidate.kind === "custom");
        if (!set) {
            set = createLayerSet({ name: platform.i18n.localize("FILRODENSWMB.UI.MigratedRegionsSet"), kind: "custom" }, () => platform.utils.randomID());
            app.layerSets.push(set);
        }
        for (const layer of layers) {
            // The listed object itself becomes the level, so the panel keeps working on it
            Object.assign(layer, createLevel({ ...layer, opacity: layer.opacity ?? 1 }, () => platform.utils.randomID()), { id: layer.id });
            set.levels.push(layer);
        }
    }

    /**
     * Draws the region levels (see StudioCanvas.renderRegionLevels). The map's region opacity
     * applies over each level's own, as it applied over each region layer before.
     */
    static renderRegions(app) {
        app.canvasEngine.renderRegionLevels(app.meshSession, app.uiState.regionOpacity ?? FILRODENSWMB.DISPLAY.REGION_OPACITY);
    }

    /**
     * Wires the canvas's hit test for what is drawn from the mesh: in the Regions tool, the region
     * of the topmost visible level under the pointer; in the Infrastructure tool, a route whose
     * line passes within `radius` of it. Either can be double-clicked to edit, not dragged.
     */
    static bindHitTest(app) {
        if (!this.enabled || !app.canvasEngine) return;
        app.canvasEngine.meshHitTest = (x, y, radius) => {
            if (!app.meshSession) return null;
            if (app.activeTool === "regions") return this.#regionHit(app, x, y);
            if (app.activeTool === "infrastructure") return this.#routeHit(app, x, y, radius);
            return null;
        };
    }

    static #regionHit(app, x, y) {
        const levels = [...app.meshSession.levels()].filter((level) => level.visibility !== "none").reverse();
        for (const level of levels) {
            const region = app.meshSession.regionAt(level.id, x, y);
            if (region && region.visibility !== "none") return { target: region, x, y, radius: 0, entityType: "region", entityId: region.id, layerId: level.id, selectOnly: true };
        }
        return null;
    }

    static #routeHit(app, x, y, radius) {
        let best = null;
        for (const route of app.mapRoutes ?? []) {
            if (route.visibility === "none") continue;
            const distance = distanceToLine(app.meshSession.routeLine(route), x, y, radius);
            if (distance <= radius && (!best || distance < best.distance)) best = { route, distance };
        }
        return best ? { target: best.route, x, y, radius: 0, entityType: "route", entityId: best.route.id, selectOnly: true } : null;
    }

    /**
     * Whether a region or route edit of the polygon kind is refused because regions and routes are
     * on the mesh (their tools come later). Tells the user once per map.
     */
    static refusesLegacyEdit(app) {
        if (!this.enabled || this.#state(app).unavailable) return false;
        const state = this.#state(app);
        if (!state.notified) {
            state.notified = true;
            platform.notify.info(platform.i18n.localize("FILRODENSWMB.UI.RegionEditingUnavailable"));
        }
        return true;
    }

    // ------------------------------------------------------------------ geometry for the Studio

    /**
     * Points outlining a region or route drawn from the mesh (the corners of its bounds), for
     * zooming to it and outlining it in an undo preview. Empty when it is not on the mesh.
     * @param {object} app
     * @param {object} entity - A region, a level (its regions together) or a route.
     * @returns {Array<{x: number, y: number}>}
     */
    static outlinePoints(app, entity) {
        const session = app.meshSession;
        if (!this.enabled || !session || !entity) return [];
        if (Array.isArray(entity.legs)) return boxCorners(lineBounds(session.routeLine(entity)));
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
        if (!this.enabled || state.unavailable) return null;

        const session = app.meshSession;
        if (session) {
            this.reconcile(app);
            session.assignPinCells(payload.mapPins);
        }
        delete payload.regionLayers;
        payload.vectorSchemaVersion = VECTOR_SCHEMA_VERSION;
        payload.mesh = session ? { ...session.meshBlock } : createMeshBlock(payload);
        payload.layerSets = app.layerSets ?? [];
        return session ? session.encodeOwners() : {};
    }

    /**
     * A map at vector schema version 4 shown the way earlier versions drew it, for comparison with
     * MESH_NATIVE off: its levels as region layers whose regions have their migrated polygons
     * back, and its routes with their old points. Regions and routes made after migration have no
     * polygon and do not show.
     * @param {object} payload - Updated in place.
     */
    static legacyView(payload) {
        if ((payload.vectorSchemaVersion ?? 0) < VECTOR_SCHEMA_VERSION || payload.regionLayers) return;
        payload.regionLayers = this.regionLayersView(payload.layerSets).map((level) => ({
            id: level.id,
            name: level.name,
            visibility: level.visibility,
            regions: level.regions.filter((region) => region.legacy?.points).map((region) => ({ ...region.legacy, ...region, points: region.legacy.points, lineColor: region.legacy.lineColor ?? level.style.lineColor, lineThickness: region.legacy.lineThickness ?? level.style.lineThickness, lineStyle: region.legacy.lineStyle ?? level.style.lineStyle })),
        }));
        payload.mapRoutes = (payload.mapRoutes ?? []).filter((route) => route.legacy?.points).map((route) => ({ ...route, points: route.legacy.points }));
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
