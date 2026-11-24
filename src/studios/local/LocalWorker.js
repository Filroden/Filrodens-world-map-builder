/**
 * The Local studio's background worker: builds a settlement's versions, keeps them, and draws
 * their thumbnails and tiles on an OffscreenCanvas (see LocalTasks). Started by LocalWorkers; its
 * message loop is the kernel's (WorkerHost).
 */
import { serveTasks } from "../../kernel/workers/WorkerHost.js";
import { TASKS } from "./LocalTasks.js";

serveTasks(TASKS);
