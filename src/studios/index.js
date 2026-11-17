/**
 * The studios the hosts offer, in the order the shell registers them (the first is the one it
 * opens). The shell never imports a studio itself: the hosts hand it this list.
 */
import { LocalStudio } from "./local/LocalStudio.js";
import { WorldStudio } from "./world/WorldStudio.js";

export const STUDIOS = Object.freeze([WorldStudio, LocalStudio]);
