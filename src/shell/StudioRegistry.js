/**
 * The studios the shell can open, and what each registers: per map type, its tools by stage and
 * mode (Create or Explore), and the occasional tools at the rail's foot. The shell draws the rail
 * and the panel's frame from a studio's registration and never imports a studio's code: the hosts
 * hand it the studios (see src/studios/index.js), and the shell reaches each only through its
 * definition and its create().
 *
 * A studio is { definition, create(shell) }: the definition is made with defineStudio (below), and
 * create returns the studio's controller, which the shell mounts in its frame (see Shell).
 *
 * Later steps of S0 add what a studio registers beyond its tools (its panels and sections, canvas
 * layers, map kind, save rules and export kinds; `claude/v5-s0-shell-handoff.md` §5).
 */

/** The two modes a tool belongs to: Create (making the map) and Explore (reading it). */
export const MODES = Object.freeze(["create", "explore"]);

/**
 * @typedef {object} ToolDefinition
 * @property {string} id - The tool's id (data-tool, the panel's template name).
 * @property {string|null} stage - The stage it sits in on the rail, or null for an occasional tool.
 * @property {"create"|"explore"} mode - The mode whose rail offers it.
 * @property {string} icon - The mask icon's name (fwmb-icon--<icon>).
 * @property {string} label - The localisation key of its name.
 * @property {string[]} mapTypes - The map types that offer it.
 * @property {{tool: string, reason: string}|null} next - The Next footer: the tool that follows and why.
 * @property {string|Object<string, string>|null} stateWord - What its editing does, by name or by mode.
 * @property {string} [later] - For a part a later step builds, the localisation key of its tooltip:
 *     it is drawn in its place, disabled (S0's placeholders).
 */

/**
 * What Inspect can read on a map type (EX1): its kinds in the list's order, and the ground, the
 * list's last row. The shell's reader (MapReader) gathers every kind at a map point and draws the
 * card and the held list from their rows; the studio's tool (the World studio's InspectView)
 * draws each fold and acts on its links.
 *
 * @typedef {object} InspectKind
 * @property {string} id - The kind's id ("pins", "routes", …).
 * @property {string} icon - The mask icon's name, beside its rows.
 * @property {function(object, number, number): object[]} at - Everything of the kind at a map point,
 *     nearest first, each item carrying a `key` unique on the map (the list is compared by keys).
 * @property {function(object, object): {name: string, kind: string, figure?: string, set?: string, gmOnly?: boolean}} row - An item's line on the card.
 * @property {function(object, object, object): object} fold - An item's fold in the panel.
 * @property {function(object, object): object|null} outline - What the map draws while its fold is hovered.
 *
 * @typedef {object} InspectGround
 * @property {string} icon
 * @property {function(object, number, number): object|null} at - The point's ground, or null off the map.
 * @property {function(object, object): object} row
 * @property {function(object, object, object): object} fold
 */

/**
 * @typedef {object} StageDefinition
 * @property {string} id
 * @property {string} label - Localisation key.
 * @property {boolean} [numbered] - Whether the panel header numbers its tools ("Shape · 2 of 4").
 * @property {boolean} [optional] - Outside the order of work: no Next leads to its tools.
 */

const fail = (studio, message) => {
    throw new Error(`StudioRegistry: ${studio}: ${message}`);
};

/**
 * Checks and freezes a studio's definition, and gives it the queries the shell and the studio's
 * controller ask of it.
 *
 * @param {object} spec
 * @param {string} spec.id - The studio's id ("world", "local").
 * @param {string} spec.label - Localisation key of its name.
 * @param {string[]} spec.mapTypes - Its map types, the first being the one a new world opens on.
 * @param {StageDefinition[]} spec.stages - The rail's stages, in order.
 * @param {StageDefinition[]} [spec.worldStages] - The world's rail (v5, S0 step 4): its stages, in
 *     order. Their tools are the world's, not a map's: the rail shows them while the world, not
 *     one of its maps, is chosen in the layer switcher, in either mode.
 * @param {ToolDefinition[]} spec.tools - Its tools, in rail order within each stage.
 * @param {object[]} [spec.occasional] - The occasional entries at the rail's foot, in order: a
 *     registered tool ({tool}), a menu ({menu, icon, label}) or an action ({action, icon, label, host}).
 * @param {string[]} [spec.engineInHeader] - Tools whose panel header names the terrain engine.
 * @param {Object<string, {kinds: InspectKind[], ground: InspectGround}>} [spec.inspect] - What
 *     Inspect reads, per map type (EX1); a map type left out has nothing to inspect.
 * @returns {Readonly<object>}
 */
export function defineStudio(spec) {
    const { id, label, mapTypes, stages, worldStages = [], tools, occasional = [], engineInHeader = [], inspect = {} } = spec;
    if (!id) fail("?", "has no id");
    if (!label) fail(id, "has no label");
    if (!mapTypes?.length) fail(id, "has no map types");
    const worldStageIds = new Set(worldStages.map((stage) => stage.id));
    const stageIds = new Set([...stages, ...worldStages].map((stage) => stage.id));
    const byId = new Map();
    for (const tool of tools) {
        if (byId.has(tool.id)) fail(id, `registers ${tool.id} twice`);
        if (tool.stage !== null && !stageIds.has(tool.stage)) fail(id, `${tool.id} is in an unknown stage (${tool.stage})`);
        if (!MODES.includes(tool.mode)) fail(id, `${tool.id} has no mode`);
        if (!tool.icon || !tool.label) fail(id, `${tool.id} has no icon or label`);
        if (!tool.mapTypes?.length || tool.mapTypes.some((type) => !mapTypes.includes(type))) fail(id, `${tool.id} names a map type the studio does not have`);
        byId.set(tool.id, Object.freeze({ next: null, stateWord: null, lede: null, ...tool, mapTypes: Object.freeze([...tool.mapTypes]) }));
    }
    for (const tool of byId.values()) {
        if (tool.next && !byId.has(tool.next.tool)) fail(id, `${tool.id}'s Next names ${tool.next.tool}, which it does not register`);
    }
    for (const entry of occasional) {
        if (entry.tool && byId.get(entry.tool)?.stage !== null) fail(id, `occasional ${entry.tool} is not an occasional tool`);
    }

    const inspectByType = checkInspect(id, mapTypes, inspect);

    // The world's tools are either mode's: the world is edited and read from the same rail
    const offered = (tool, mapType, mode) => tool.mapTypes.includes(mapType) && (mode == null || tool.mode === mode || worldStageIds.has(tool.stage));
    const freezeStage = (stage) => Object.freeze({ numbered: true, optional: false, ...stage });

    return Object.freeze({
        id,
        label,
        mapTypes: Object.freeze([...mapTypes]),
        stages: Object.freeze(stages.map(freezeStage)),
        worldStages: Object.freeze(worldStages.map((stage) => freezeStage({ numbered: false, ...stage }))),
        occasional: Object.freeze(occasional.map((entry) => Object.freeze({ ...entry }))),
        engineInHeader: Object.freeze([...engineInHeader]),

        /** Every tool the studio registers, in order. */
        tools: Object.freeze([...byId.values()]),

        /** A tool by id, or null. */
        tool(toolId) {
            return byId.get(toolId) ?? null;
        },

        /** Whether a map type offers a tool (in a mode, or in either when mode is null). */
        offers(toolId, mapType, mode = null) {
            const tool = byId.get(toolId);
            return !!tool && offered(tool, mapType, mode);
        },

        /** A stage by id (a map's or the world's), or null. */
        stage(stageId) {
            return this.stages.find((stage) => stage.id === stageId) ?? this.worldStages.find((stage) => stage.id === stageId) ?? null;
        },

        /** Whether a tool is the world's (on the world's rail) rather than a map's. */
        isWorldTool(toolId) {
            return worldStageIds.has(byId.get(toolId)?.stage);
        },

        /** The world's rail for a map type: its stages, each with its tools in order (empty ones left out). */
        worldRail(mapType) {
            return this.worldStages
                .map((stage) => ({ ...stage, tools: this.tools.filter((tool) => tool.stage === stage.id && tool.mapTypes.includes(mapType)) }))
                .filter((stage) => stage.tools.length);
        },

        /**
         * The rail's stages for a map type and mode, each with its tools in order (empty stages
         * left out). Mode null gives every mode's stages, as the rail draws them until the mode
         * switch arrives (S0 step 3).
         */
        railStages(mapType, mode = null) {
            return this.stages
                .map((stage) => ({ ...stage, tools: this.tools.filter((tool) => tool.stage === stage.id && offered(tool, mapType, mode)) }))
                .filter((stage) => stage.tools.length);
        },

        /** The tools of a tool's stage that a map type offers in a mode, in order. */
        stageTools(toolId, mapType, mode = null) {
            const tool = byId.get(toolId);
            return tool?.stage ? this.tools.filter((entry) => entry.stage === tool.stage && offered(entry, mapType, mode)) : [];
        },

        /**
         * The tool to show after switching to another map type (decision 21): the same tool where
         * the new map type offers it, else the first tool of its stage there, else the first tool
         * of the first stage.
         */
        toolForMapType(toolId, mapType, mode = null) {
            if (this.offers(toolId, mapType, mode)) return toolId;
            const tool = byId.get(toolId);
            const sameStage = tool?.stage ? this.tools.find((entry) => entry.stage === tool.stage && offered(entry, mapType, mode)) : null;
            if (sameStage) return sameStage.id;
            return this.railStages(mapType, mode)[0]?.tools[0]?.id ?? null;
        },

        /** What Inspect reads on a map type ({kinds, ground}), or null when it reads nothing there. */
        inspectFor(mapType) {
            return inspectByType.get(mapType) ?? null;
        },
    });
}

/** Checks and freezes a studio's `inspect` registration (see InspectKind), by map type. */
function checkInspect(studio, mapTypes, inspect) {
    const byType = new Map();
    for (const [mapType, entry] of Object.entries(inspect)) {
        if (!mapTypes.includes(mapType)) fail(studio, `inspect names a map type the studio does not have (${mapType})`);
        if (!entry?.kinds?.length) fail(studio, `inspect for ${mapType} has no kinds`);
        const ids = new Set();
        for (const kind of entry.kinds) {
            if (!kind?.id) fail(studio, `an inspect kind for ${mapType} has no id`);
            if (ids.has(kind.id)) fail(studio, `inspect for ${mapType} registers ${kind.id} twice`);
            ids.add(kind.id);
            if (!kind.icon) fail(studio, `inspect kind ${kind.id} has no icon`);
            for (const part of ["at", "row", "fold", "outline"]) {
                if (typeof kind[part] !== "function") fail(studio, `inspect kind ${kind.id} has no ${part}()`);
            }
        }
        const ground = entry.ground;
        if (!ground?.icon) fail(studio, `inspect for ${mapType} has no ground`);
        for (const part of ["at", "row", "fold"]) {
            if (typeof ground[part] !== "function") fail(studio, `inspect's ground for ${mapType} has no ${part}()`);
        }
        byType.set(mapType, Object.freeze({ kinds: Object.freeze(entry.kinds.map((kind) => Object.freeze({ ...kind }))), ground: Object.freeze({ id: "ground", ...ground }) }));
    }
    return byType;
}

/** The studios the shell can open, by id. */
export class StudioRegistry {
    #studios = new Map();

    /** @param {Array<{definition: object, create: Function}>} [studios] */
    constructor(studios = []) {
        for (const studio of studios) this.register(studio);
    }

    /** Adds a studio ({definition, create}). */
    register(studio) {
        const id = studio?.definition?.id;
        if (!id || typeof studio.create !== "function") throw new Error("StudioRegistry: a studio needs a definition and a create()");
        if (this.#studios.has(id)) throw new Error(`StudioRegistry: ${id} is registered twice`);
        this.#studios.set(id, studio);
        return this;
    }

    /** A studio by id, or null. */
    get(id) {
        return this.#studios.get(id) ?? null;
    }

    /** Every studio's id, in registration order. */
    ids() {
        return [...this.#studios.keys()];
    }
}
