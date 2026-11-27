/**
 * The World studio as the shell registers it: its definition (definition.js), the controller that
 * draws and runs it (MapStudio, for now the whole World studio in one controller), and what it
 * prepares before any studio opens: the saved maps made into worlds (WorldMigration); and its own
 * settings (the Generate guard's kept answer). Prepared or created, it hands the Foundry store how a
 * map is described on its journal pages.
 */
import { MapStudio } from "./app/MapStudio.js";
import { WORLD_DEFINITION } from "./definition.js";
import { WorldMigration } from "./data/WorldMigration.js";
import { GenerateGuard } from "./app/GenerateGuard.js";
import { BiomePlacement } from "./generation/BiomePlacement.js";
import { TerrainVersion } from "./tools/TerrainVersion.js";
import { platform } from "../../platform/index.js";

/**
 * How a map is described on its Foundry journal pages (see the Foundry store's setDescriber): the
 * store writes the pages, and the World studio knows its engines and biomes.
 */
const JOURNAL_DESCRIBER = Object.freeze({
    regionalZoom: (state) => TerrainVersion.resolveWorld(state).zoom,
    usesCurrentCoastline: (state) => TerrainVersion.usesCurrentCoastline(state),
    engineNameKey: (engine) => TerrainVersion.ENGINE_NAMES[engine] ?? null,
    engineVersion: (state) => TerrainVersion.getDisplayVersion(state),
    builtInPlacement: (key) => BiomePlacement.labelOf(BiomePlacement.placementOfBuiltIn(key)),
    customPlacement: (biome) => BiomePlacement.labelOf(BiomePlacement.placementOfCustom(biome)),
});

/** Hands the store the describer (the web's store writes no journal, so has no setter). */
const describeJournals = () => platform.store?.setDescriber?.(JOURNAL_DESCRIBER);

export const WorldStudio = Object.freeze({
    definition: WORLD_DEFINITION,
    create: (shell) => {
        describeJournals();
        return new MapStudio(shell);
    },
    prepare: () => {
        describeJournals();
        return WorldMigration.run();
    },
    registerSettings: () => GenerateGuard.registerSettings(),
});
