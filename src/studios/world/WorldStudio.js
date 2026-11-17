/**
 * The World studio as the shell registers it: its definition (definition.js) and the controller
 * that draws and runs it (MapStudio, for now the whole World studio in one controller).
 */
import { MapStudio } from "./app/MapStudio.js";
import { WORLD_DEFINITION } from "./definition.js";

export const WorldStudio = Object.freeze({
    definition: WORLD_DEFINITION,
    create: (shell) => new MapStudio(shell),
});
