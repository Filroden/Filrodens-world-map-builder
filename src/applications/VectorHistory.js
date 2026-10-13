import { FILRODENSWMB } from "../config.js";
import { MapStateManager } from "./MapStateManager.js";

/**
 * The vector side of the studio's undo and redo: everything except brush strokes on the terrain
 * and biomes (which the brush engine keeps itself). Each step is an entry of one of four kinds:
 *
 * - `{ kind: "vector", snapshot }`: the vector state as it was (see
 *   MapStateManager.getVectorStateSnapshot). Stepping through it restores the snapshot and keeps
 *   the state it replaced, for stepping back.
 * - `{ kind: "owners", levelId, patch }`: cells of one level that changed owner (an
 *   OwnerLayer patch, which holds each cell's owner before and after). Undo applies it backwards,
 *   redo forwards; the entry is the same both ways. A brush stroke on a region level is one such
 *   entry, however long the stroke, so region painting costs memory in proportion to what was
 *   painted, never a copy of the level.
 * - `{ kind: "levelOwners", levelId, before, after }`: a level's whole owner array, encoded (or
 *   null where the level has none), before and after a change too wide for a patch to be small
 *   (a level deleted, or every cell resampled). Undo puts `before` back, redo `after`.
 * - `{ kind: "composite", entries }`: several of the above made by one action (deleting a region
 *   changes the layer sets and its cells). Undo steps its entries backwards, redo forwards.
 *
 * Entries live in the studio's `pinHistory` (undo) and `pinRedoStack` (redo), and each counts as
 * one "vector" step in the studio's combined ledger, so a composite action is one Undo however
 * many entries it holds. HISTORY_MAX counts entries, as it always has.
 */
export class VectorHistory {
    static KIND = Object.freeze({ VECTOR: "vector", OWNERS: "owners", LEVEL_OWNERS: "levelOwners", COMPOSITE: "composite" });

    /** An entry restoring the vector state as it is now. Take it before changing anything. */
    static snapshot(app) {
        return { kind: this.KIND.VECTOR, snapshot: MapStateManager.getVectorStateSnapshot(app) };
    }

    /** An entry for a patch of one level's owners (null for a patch that changed nothing). */
    static owners(levelId, patch) {
        return patch?.cells.length ? { kind: this.KIND.OWNERS, levelId, patch } : null;
    }

    /** An entry replacing a level's whole owner array (encoded, or null for none). */
    static levelOwners(levelId, before, after) {
        return { kind: this.KIND.LEVEL_OWNERS, levelId, before, after };
    }

    /** One entry for several, leaving out empty ones; a single entry stands on its own. */
    static composite(entries) {
        const kept = entries.filter(Boolean);
        return kept.length === 1 ? kept[0] : { kind: this.KIND.COMPOSITE, entries: kept };
    }

    /**
     * Records an undo step: the entry goes onto the undo stack (the oldest is dropped past
     * HISTORY_MAX), the redo stack is cleared, and the combined ledger gains a vector step.
     * @param {object} app
     * @param {object} entry
     */
    static push(app, entry) {
        if (!entry || (entry.kind === this.KIND.COMPOSITE && entry.entries.length === 0)) return;
        app.pinHistory.push(entry);
        if (app.pinHistory.length > FILRODENSWMB.LIMITS.HISTORY_MAX) app.pinHistory.shift();
        app.pinRedoStack = [];

        app.globalHistoryLedger ??= [];
        app.globalHistoryLedger.push("vector");
        app.globalRedoLedger = [];
        if (app.globalHistoryLedger.length > FILRODENSWMB.LIMITS.HISTORY_MAX) app.globalHistoryLedger.shift();
    }

    /**
     * Steps one entry back (undo) or forward (redo): takes it from one stack, applies it, and puts
     * what reverses it on the other.
     * @param {object} app
     * @param {boolean} isUndo
     * @returns {boolean} Whether there was an entry to step through.
     */
    static step(app, isUndo) {
        const source = isUndo ? app.pinHistory : app.pinRedoStack;
        const target = isUndo ? app.pinRedoStack : app.pinHistory;
        if (!source.length) return false;
        target.push(this.#apply(app, source.pop(), isUndo));
        return true;
    }

    /**
     * Applies an entry in one direction and returns the entry that reverses it.
     * @returns {object}
     */
    static #apply(app, entry, isUndo) {
        switch (entry.kind) {
            case this.KIND.OWNERS:
                return this.#applyOwners(app, entry, isUndo);
            case this.KIND.LEVEL_OWNERS:
                app.meshSession?.restoreLevelOwners(entry.levelId, isUndo ? entry.before : entry.after);
                return entry;
            case this.KIND.COMPOSITE: {
                const order = isUndo ? [...entry.entries].reverse() : entry.entries;
                const reversed = order.map((inner) => this.#apply(app, inner, isUndo));
                return { kind: this.KIND.COMPOSITE, entries: isUndo ? reversed.reverse() : reversed };
            }
            default: {
                const current = this.snapshot(app);
                MapStateManager.restoreVectorStateSnapshot(app, entry.snapshot);
                return current;
            }
        }
    }

    static #applyOwners(app, entry, isUndo) {
        const session = app.meshSession;
        if (!session) return entry;
        const layer = session.layer(entry.levelId);
        if (isUndo) layer.revert(entry.patch);
        else layer.apply(entry.patch);
        session.ownersChanged(entry.levelId, entry.patch);
        return entry;
    }

    /**
     * Whether an entry changes any owner array (so the regions must be redrawn even if no vector
     * snapshot differs).
     */
    static touchesOwners(entry) {
        if (!entry) return false;
        if (entry.kind === this.KIND.COMPOSITE) return entry.entries.some((inner) => this.touchesOwners(inner));
        return entry.kind === this.KIND.OWNERS || entry.kind === this.KIND.LEVEL_OWNERS;
    }

    /**
     * The vector snapshot an entry would restore, if it holds one (a composite's first), for the
     * undo preview's comparison with the state now.
     */
    static snapshotOf(entry) {
        if (!entry) return null;
        if (entry.kind === this.KIND.VECTOR) return entry.snapshot;
        if (entry.kind === this.KIND.COMPOSITE) return entry.entries.map((inner) => this.snapshotOf(inner)).find(Boolean) ?? null;
        return null;
    }

    /**
     * The bounds of the cells an entry's owner patches change, for the undo preview: the sites of
     * the changed cells widened by a cell's reach. Null when the entry changes no cells in place
     * (or the session is gone).
     * @returns {{minX: number, minY: number, maxX: number, maxY: number}|null}
     */
    static patchBounds(app, entry) {
        const mesh = app.meshSession?.mesh;
        if (!mesh || !entry) return null;
        const patches = this.#patches(entry);
        let box = null;
        for (const patch of patches) {
            for (const cell of patch.cells) {
                const x = mesh.siteX(cell);
                const y = mesh.siteY(cell);
                if (!box) box = { minX: x, minY: y, maxX: x, maxY: y };
                else {
                    box.minX = Math.min(box.minX, x);
                    box.minY = Math.min(box.minY, y);
                    box.maxX = Math.max(box.maxX, x);
                    box.maxY = Math.max(box.maxY, y);
                }
            }
        }
        return box;
    }

    static #patches(entry) {
        if (entry.kind === this.KIND.OWNERS) return [entry.patch];
        if (entry.kind === this.KIND.COMPOSITE) return entry.entries.flatMap((inner) => this.#patches(inner));
        return [];
    }
}
