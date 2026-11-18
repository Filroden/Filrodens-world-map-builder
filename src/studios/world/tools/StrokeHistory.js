import { BrushEngine } from "./BrushEngine.js";

/**
 * The one owner of rewrites of a map's brush stroke history (`claude/v5-s0-shell-handoff.md` §4),
 * and of the count that goes with it on a held regional map: how many strokes at the head of its
 * history are its parent's (`inheritedStrokes` in its world's RegionalRecord), the point below
 * which its Undo stops (step 5).
 *
 * A stroke is added by painting and taken off by Undo; both go through the brush engine. Anything
 * else that changes the history goes through `rewrite`, so the count stays right: moving strokes
 * in place keeps it, removing or reordering them recounts it. Today that is moving the Standard
 * engine's noise frame (NoiseTransform.apply). The cut makes a regional map's history with
 * `translate`, and the migration recovers a v4.3 regional map's count with `inheritedCount`,
 * matching its history against its parent's translated the same way.
 */
export class StrokeHistory {
    /** How far apart a point or a size may be for two strokes to count as the same, in pixels. */
    static TOLERANCE_PX = 0.5;

    /**
     * Runs a change to the open map's stroke history (and its redo stack), keeping the count of
     * inherited strokes right: the count becomes the run of strokes at the history's head that
     * were inherited before the change, in their order, so strokes moved in place keep it, an
     * inherited stroke removed lowers it by one, and one of the map's own put among them ends it.
     * @param {object} app - The studio (its brushEngine and inheritedStrokes).
     * @param {function(): void} change
     */
    static rewrite(app, change) {
        const history = app.brushEngine?.history ?? [];
        const count = Math.min(app.inheritedStrokes ?? 0, history.length);
        const head = history.slice(0, count);
        change();
        const after = app.brushEngine?.history ?? [];
        let kept = 0;
        let from = 0;
        while (kept < after.length) {
            const at = head.indexOf(after[kept], from);
            if (at < 0) break;
            from = at + 1;
            kept++;
        }
        if (app.inheritedStrokes !== undefined) app.inheritedStrokes = kept;
    }

    /**
     * A parent's strokes in a regional map's pixels, as the cut takes them: moved and scaled into
     * the crop, and only those the crop shows kept.
     * @param {object[]} history - The parent's strokes.
     * @param {{x: number, y: number}} cropBox - The crop's corner in the parent's pixels.
     * @param {number} zoomScale - Regional pixels per parent pixel.
     * @param {number} targetWidth - The regional map's width.
     * @param {number} targetHeight - Its height.
     * @param {Map<object, *>} [anchors] - Each stroke's anchor on the regional map, by stroke.
     * @returns {object[]} New strokes; the parent's are not changed.
     */
    static translate(history, cropBox, zoomScale, targetWidth, targetHeight, anchors = new Map()) {
        const translated = [];
        for (const stroke of history ?? []) {
            const copy = structuredClone(stroke);
            if (anchors.has(stroke)) copy.anchor = anchors.get(stroke);
            if (BrushEngine.isSlope(stroke)) copy.scale = (stroke.scale ?? 1) * zoomScale;
            copy.size *= zoomScale;
            let isVisible = false;
            for (const point of copy.points ?? []) {
                point.x = (point.x - cropBox.x) * zoomScale;
                point.y = (point.y - cropBox.y) * zoomScale;
                if (point.x + copy.size >= 0 && point.x - copy.size <= targetWidth && point.y + copy.size >= 0 && point.y - copy.size <= targetHeight) isVisible = true;
            }
            if (isVisible) translated.push(copy);
        }
        return translated;
    }

    /**
     * How many strokes at the head of a regional map's history are its parent's: each counts while
     * it matches the next of the parent's strokes the crop shows (see translate; strokes the
     * parent painted after the cut are passed over). Their anchors are not compared, since working
     * one out needs the parent's terrain.
     * @param {object[]} history - The regional map's strokes.
     * @param {object[]} parentHistory - The parent's strokes.
     * @param {{crop: {x: number, y: number}, zoomScale: number}|null} frame - Where the regional
     *     map lies in its parent (ParentRunRecovery.frame), or null when unknown (the count is 0).
     * @param {{width: number, height: number}} size - The regional map's size.
     * @returns {number}
     */
    static inheritedCount(history, parentHistory, frame, size) {
        if (!frame || !Array.isArray(history) || !Array.isArray(parentHistory)) return 0;
        const parents = StrokeHistory.translate(parentHistory, frame.crop, frame.zoomScale, size.width, size.height);
        let count = 0;
        let next = 0;
        for (const stroke of history) {
            while (next < parents.length && !StrokeHistory.same(stroke, parents[next])) next++;
            if (next >= parents.length) break;
            count++;
            next++;
        }
        return count;
    }

    /** Whether two strokes are the same stroke (within TOLERANCE_PX for points and size). */
    static same(a, b) {
        if (!a || !b || a.layer !== b.layer || a.tool !== b.tool || a.strength !== b.strength || a.feather !== b.feather) return false;
        if (JSON.stringify(a.paintValue ?? null) !== JSON.stringify(b.paintValue ?? null)) return false;
        if (JSON.stringify(a.paintSides ?? null) !== JSON.stringify(b.paintSides ?? null)) return false;
        const near = (x, y) => Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) <= StrokeHistory.TOLERANCE_PX;
        if (!near(a.size, b.size)) return false;
        if (BrushEngine.isSlope(a) && Math.abs((a.scale ?? 1) - (b.scale ?? 1)) > 1e-6 * Math.max(1, Math.abs(b.scale ?? 1))) return false;
        const pa = a.points ?? [];
        const pb = b.points ?? [];
        return pa.length === pb.length && pa.every((point, i) => near(point.x, pb[i].x) && near(point.y, pb[i].y));
    }
}
