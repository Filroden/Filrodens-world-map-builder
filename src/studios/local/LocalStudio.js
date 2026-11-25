/**
 * The Local studio: settlement maps, made from a settlement pin (L-surface). It registers its map
 * type's rail with the shell, as the World studio does, and its controller (LocalController), which
 * the open world mounts in its frame while one of its settlement maps is open (`claude/v5-l-surface
 * -handoff.md` §2, §9 answer 4): the World studio stays the host, keeping the world, its world bar
 * and Save world, and hands the controller what it needs of the world as plain functions, so
 * neither studio imports the other.
 *
 * Besides its definition and create(), it gives what other code needs of a settlement map without
 * opening one: `rules` (a record read safely, for the world file and backups), `card` (what the
 * world's record keeps of one) and `page` (the readable page Foundry keeps in the world's journal).
 */
import { platform } from "../../platform/index.js";
import { defineStudio } from "../../shell/StudioRegistry.js";
import { Worlds } from "../../kernel/worlds/Worlds.js";
import { LocalController, tierName } from "./app/LocalController.js";
import { SettlementRules } from "./data/SettlementRules.js";
import { SettlementRecord } from "./data/SettlementRecord.js";
import { HOUSEHOLD_VIEWS } from "./render/Styles.js";

const SETTLEMENT = ["settlement"];

export const LOCAL_DEFINITION = defineStudio({
    id: "local",
    label: "FILRODENSWMB.UI.StudioLocal",
    mapTypes: SETTLEMENT,
    // The boards' rail (L3): Map setup, then Export, then Explore's Households and supply
    stages: [
        { id: "shape", label: "FILRODENSWMB.UI.StageShape" },
        { id: "finish", label: "FILRODENSWMB.UI.StageFinish" },
        { id: "explore", label: "FILRODENSWMB.UI.StageExplore", numbered: false, optional: true },
    ],
    tools: [
        { id: "mapSetup", stage: "shape", mode: "create", icon: "grid-on", label: "FILRODENSWMB.UI.ToolCreateMap", mapTypes: SETTLEMENT, lede: "FILRODENSWMB.UI.LedeSettlementSetup" },
        // Export is built by L-surface's step 5: drawn in its place until then, as S0's were
        { id: "export", stage: "finish", mode: "create", icon: "png", label: "FILRODENSWMB.UI.ToolExport", mapTypes: SETTLEMENT, later: "FILRODENSWMB.UI.ToolExport" },
        { id: "households", stage: "explore", mode: "explore", icon: "groups", label: "FILRODENSWMB.UI.ToolHouseholds", mapTypes: SETTLEMENT, lede: "FILRODENSWMB.UI.LedeHouseholds" },
    ],
});

/** A settlement map's readable page (Foundry keeps it in its world's journal). */
async function page(record) {
    const lang = platform.i18n.lang;
    const html = await platform.templates.render("modules/filrodens-world-map-builder/templates/local/journal-page.hbs", {
        name: record.name,
        people: (record.input?.population ?? 0).toLocaleString(lang),
        tier: tierName(record.input?.tier),
        seed: record.seed,
        keptAt: record.keptAt ? new Date(record.keptAt).toLocaleDateString(lang) : null,
    });
    return { name: record.name, html };
}

/** A settlement map's Thematic views in the map controls (step 3): the household views, by id and label. */
const VIEWS = Object.freeze(HOUSEHOLD_VIEWS.map((id) => Object.freeze({ id, label: `FILRODENSWMB.UI.SettlementView.${id}` })));

export const LocalStudio = Object.freeze({
    definition: LOCAL_DEFINITION,
    views: VIEWS,
    create: (shell, host) => new LocalController(shell, host, LOCAL_DEFINITION),
    rules: SettlementRules,
    // What the world keeps of a record (WorldRecord.settlementCard reads it safely)
    card: (record) => SettlementRecord.card(record),
    page,
    // A copy of a world made without the studio open (Duplicate, Clone as new) writes its
    // settlement maps' pages too
    prepare: () => {
        Worlds.pageOf = page;
        return null;
    },
});
