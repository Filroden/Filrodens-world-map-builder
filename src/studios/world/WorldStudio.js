/**
 * The World studio as the shell registers it: its definition (definition.js), the controller that
 * draws and runs it (MapStudio, for now the whole World studio in one controller), and what it
 * prepares before any studio opens: the saved maps made into worlds (WorldMigration).
 */
import { MapStudio } from "./app/MapStudio.js";
import { WORLD_DEFINITION } from "./definition.js";
import { WorldMigration } from "./data/WorldMigration.js";

export const WorldStudio = Object.freeze({
    definition: WORLD_DEFINITION,
    create: (shell) => new MapStudio(shell),
    prepare: () => WorldMigration.run(),
});
