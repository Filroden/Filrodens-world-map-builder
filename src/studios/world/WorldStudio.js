/**
 * The World studio as the shell registers it: its definition (definition.js), the controller that
 * draws and runs it (MapStudio, for now the whole World studio in one controller), and what it
 * prepares before any studio opens: the saved maps made into worlds (WorldMigration); and its own
 * settings (the Generate guard's kept answer).
 */
import { MapStudio } from "./app/MapStudio.js";
import { WORLD_DEFINITION } from "./definition.js";
import { WorldMigration } from "./data/WorldMigration.js";
import { GenerateGuard } from "./app/GenerateGuard.js";

export const WorldStudio = Object.freeze({
    definition: WORLD_DEFINITION,
    create: (shell) => new MapStudio(shell),
    prepare: () => WorldMigration.run(),
    registerSettings: () => GenerateGuard.registerSettings(),
});
