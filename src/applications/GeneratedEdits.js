import { MapStateManager } from "./MapStateManager.js";

/**
 * Marking generated items as the reader's own (generated.edited), so Generate again keeps them
 * (see Regeneration). Only a substantive change counts: a name, a description, the item's shape or
 * place, or its look and style. Moving or restyling an item's label, and its visibility, do not;
 * nor does editing a style itself (which changes every item using it). Each caller marks inside
 * its own undo step, so undoing the change unmarks the item too.
 */

export class GeneratedEdits {
    /**
     * Lock (the Generated section): a locked item is kept by Generate again, as an edited one is.
     * One undo step.
     * @param {object} app
     * @param {object} item
     */
    static toggleLock(app, item) {
        if (!item?.generated) return;
        MapStateManager.pushVectorState(app);
        item.generated.locked = !item.generated.locked;
        app.markDirty?.();
    }

    /**
     * Marks a generated item edited. Returns whether it was generated (so the caller knows the
     * mark was made); hand-made items are left alone.
     * @param {object} item
     * @returns {boolean}
     */
    static mark(item) {
        if (!item?.generated) return false;
        item.generated.edited = true;
        return true;
    }

    /**
     * Marks a generated item edited when the inspector field just committed is substantive: not
     * its visibility (pinVisibility, routeVisibility, regionVisibility) and not one of its label's
     * fields (label…).
     * @param {object} item
     * @param {string} field - The committed field's name in the inspector's form.
     */
    static markIfSubstantive(item, field) {
        if (!field || field.endsWith("Visibility") || field.startsWith("label")) return;
        this.mark(item);
    }

    /**
     * Marks the regions an owner change touched: in each level, every generated region that lost
     * or gained cells (see OwnerLayer's patches: cells with their owners before and after).
     * @param {object} app
     * @param {Iterable<[string, {before: ArrayLike<number>, after: ArrayLike<number>}]>} patches - By level id.
     * @returns {string[]} The ids of the regions newly marked (for VectorHistory.edited, so undo unmarks them).
     */
    static markPatched(app, patches) {
        const marked = [];
        for (const [levelId, patch] of patches) {
            const level = app.meshSession?.level(levelId);
            if (!level || !patch) continue;
            const keys = new Set([...(patch.before ?? []), ...(patch.after ?? [])]);
            for (const region of level.regions) {
                if (!keys.has(region.key) || !region.generated || region.generated.edited) continue;
                this.mark(region);
                marked.push(region.id);
            }
        }
        return marked;
    }
}
