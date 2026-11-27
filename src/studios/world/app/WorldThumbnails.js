import { platform } from "../../../platform/index.js";
import { Sanitize } from "../../../kernel/data/Sanitize.js";
import { Worlds } from "../../../kernel/worlds/Worlds.js";
import { WorldAccess } from "../../../kernel/worlds/WorldAccess.js";

/**
 * Draw thumbnails, in Worlds' foot (S0 step 8d; `claude/v5-s0-step8-plan.md` §8d): a picture for
 * every world whose Surface map's card has none, as a world made from a 4.3 map has until it is
 * saved in v5. A saved map holds no picture of its terrain, so each such world is opened in turn,
 * quietly, and its picture drawn from the canvas (see Worlds.setThumbnail): nothing of the world is
 * saved, and what its opening would ask or do (the first-opening notice, a fill-in, a terrain
 * update) waits for its next real opening.
 *
 * The studio's part is handed in, so the run can be followed here without the studio:
 *
 *     {
 *       gate(),                  // asks about the open world's unsaved changes; false to stop
 *       open(),                  // the open world, {worldId, mapId, name}, or null
 *       drawOpen(),              // draws the open world's picture from its canvas; true when written
 *       openQuietly(mapId, name), // opens a world only to draw its picture; true when written
 *       hold(text),              // keeps the overlay's line (null lets it go)
 *       restore(open, left),     // the world that was open again (when left), and Worlds shown
 *     }
 */
export class WorldThumbnails {
    /**
     * The worlds with a Surface map whose card has no thumbnail, regional worlds included, in
     * Worlds' order (each world before the regional worlds cut from it).
     * @param {object[]} tree - Worlds.tree().
     * @returns {Array<{id: string, name: string, mapId: string}>}
     */
    static missing(tree) {
        const out = [];
        const walk = (nodes) => {
            for (const node of nodes ?? []) {
                if (node.mapId && !node.thumbnail) out.push({ id: node.id, name: node.name, mapId: node.mapId });
                walk(node.children);
            }
        };
        walk(tree);
        return out;
    }

    /**
     * Draws every missing thumbnail (see the class comment), once the user has been told it opens
     * each world in turn, then says what was done: a notice, or a dialogue naming the worlds that
     * could not be opened.
     * @param {object} app - The studio (its isDirty and runCancellable).
     * @param {object} studio - The studio's part (see the class comment).
     * @returns {Promise<{drawn: number, failed: string[], total: number, cancelled: boolean}|null>} Null when stopped before it began.
     */
    static async run(app, studio) {
        const { i18n } = platform;
        // Changes discarded at the gate are still on the canvas: that world is opened again instead
        const wasDirty = !!app.isDirty;
        // It can take minutes: said first, unless only the open world's picture is to be drawn
        // (Ken, 2026-11-22)
        const before = studio.open();
        // A world open for editing elsewhere, or view only here, is left for next time (WL)
        const writable = async (worlds) => {
            const refused = new Set(await WorldAccess.refused(worlds.map((world) => world.id)));
            return worlds.filter((world) => !refused.has(world.id));
        };
        const toOpen = (await writable(WorldThumbnails.missing(await Worlds.tree()))).filter((world) => wasDirty || !before?.mapId || world.id !== before.worldId);
        if (toOpen.length && !(await WorldThumbnails.#confirm(toOpen.length))) return null;
        if (!(await studio.gate())) return null;
        const open = studio.open();
        const missing = WorldThumbnails.missing(await Worlds.tree());
        let queue = await writable(missing);
        const skipped = missing.length - queue.length;
        const total = queue.length;
        let drawn = 0;
        const failed = [];
        let cancelled = false;

        // The open world, unchanged since it was opened or saved, is drawn from its canvas as it is
        if (open?.mapId && !wasDirty && queue.some((world) => world.id === open.worldId)) {
            const world = queue.find((entry) => entry.id === open.worldId);
            if (await WorldThumbnails.#safely(() => studio.drawOpen())) drawn++;
            else failed.push(world.name);
            queue = queue.filter((entry) => entry.id !== open.worldId);
        }

        let left = false;
        if (queue.length) {
            const offset = total - queue.length;
            const line = (index) => i18n.format("FILRODENSWMB.UI.DrawingThumbnails", { index: offset + index + 1, count: total });
            await app.runCancellable(line(0), async (signal, overlay) => {
                try {
                    for (const [index, world] of queue.entries()) {
                        if (signal.aborted) {
                            cancelled = true;
                            break;
                        }
                        studio.hold(line(index));
                        overlay.detail(world.name);
                        overlay.progress((offset + index) / total);
                        left = true;
                        if (await WorldThumbnails.#safely(() => studio.openQuietly(world.mapId, world.name))) drawn++;
                        else failed.push(world.name);
                    }
                    if (left) {
                        overlay.detail(null);
                        overlay.progress(null);
                        if (open) studio.hold(i18n.format("FILRODENSWMB.UI.OpeningWorld", { name: open.name || "" }));
                    }
                    await studio.restore(open, left);
                } finally {
                    studio.hold(null);
                }
            });
        } else {
            await studio.restore(open, false);
        }

        await WorldThumbnails.#report({ drawn, failed, total, cancelled });
        if (skipped) platform.notify.info(skipped === 1 ? i18n.localize("FILRODENSWMB.UI.DrawThumbnailsSkippedOne") : i18n.format("FILRODENSWMB.UI.DrawThumbnailsSkipped", { count: skipped }));
        return { drawn, failed, total, cancelled };
    }

    /**
     * What Draw thumbnails will do before it starts (Ken, 2026-11-22): each world opened in turn,
     * which can take minutes, and needed only once. Cancel is the default.
     * @param {number} count - The worlds it will open.
     * @returns {Promise<boolean>} Whether to go on.
     */
    static async #confirm(count) {
        const { i18n } = platform;
        const escape = (text) => Sanitize.escapeHtml(text);
        const what = count === 1 ? i18n.localize("FILRODENSWMB.UI.DrawThumbnailsConfirmOne") : i18n.format("FILRODENSWMB.UI.DrawThumbnailsConfirm", { count });
        return !!(await platform.dialogs.confirm({
            title: i18n.localize("FILRODENSWMB.UI.DrawThumbnailsTitle"),
            icon: "fwmb-icon fwmb-icon--image",
            content: `<p>${escape(what)}</p><p>${escape(i18n.localize("FILRODENSWMB.UI.DrawThumbnailsOnce"))}</p>`,
            confirmLabel: i18n.localize("FILRODENSWMB.UI.DrawThumbnailsTitle"),
            confirmIcon: "fwmb-icon fwmb-icon--image",
            destructive: false,
        }));
    }

    /** A step's answer, false when it throws (a world that cannot be opened is skipped). */
    static async #safely(step) {
        try {
            return !!(await step());
        } catch (error) {
            console.warn("FWMB | A world could not be opened to draw its thumbnail:", error);
            return false;
        }
    }

    /** What the run did (Ken, 2026-11-22): a notice, or a dialogue naming the worlds not opened. */
    static async #report({ drawn, failed, total, cancelled }) {
        const { i18n } = platform;
        const done = cancelled
            ? i18n.format("FILRODENSWMB.UI.ThumbnailsDrawnCancelled", { count: drawn, total })
            : drawn === 1
              ? i18n.localize("FILRODENSWMB.UI.ThumbnailsDrawnOne")
              : i18n.format("FILRODENSWMB.UI.ThumbnailsDrawn", { count: drawn });
        if (!failed.length) {
            platform.notify.info(done);
            return;
        }
        const escape = (text) => Sanitize.escapeHtml(text);
        const unnamed = i18n.localize("FILRODENSWMB.UI.UnnamedWorld");
        await platform.dialogs.choose({
            title: i18n.localize("FILRODENSWMB.UI.DrawThumbnailsTitle"),
            icon: "fwmb-icon fwmb-icon--image",
            content: `<p>${escape(done)}</p><p>${escape(i18n.localize("FILRODENSWMB.UI.ThumbnailsFailed"))}</p><ul class="fwmb-dialog-list">${failed.map((name) => `<li>${escape(name || unnamed)}</li>`).join("")}</ul>`,
            buttons: [{ action: "close", label: i18n.localize("FILRODENSWMB.UI.Close"), default: true }],
            dismissed: "close",
        });
    }
}
