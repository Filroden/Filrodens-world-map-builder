/**
 * Lists whose order means something (a guided map's land masks: later masks lie on top), put in
 * order by a grab handle on each row: drag the handle up or down the list and drop it where the
 * row should go, or focus the handle and press Up or Down to move the row one place. While a row is
 * dragged it follows the pointer and a line shows where it would land; Escape, or a drop outside
 * the list, leaves the order as it was.
 *
 * Marks: the list is `[data-reorder="<name>"]`, each row `[data-reorder-item]` with `data-id`, and
 * each handle `[data-reorder-handle]` inside its row. A move is passed to the studio's
 * `onMove(name, id, toIndex)` (the row's new place among the list's rows), which applies it and
 * redraws the list.
 */
export class ListReorder {
    /** The drag under way, or null. */
    static #drag = null;

    /**
     * Starts listening on the studio's root.
     * @param {HTMLElement} root
     * @param {function(string, string, number): void} onMove
     */
    static bind(root, onMove) {
        root.addEventListener("pointerdown", (event) => ListReorder.#start(event, onMove));
    }

    /**
     * A key on a handle: Up and Down move its row one place. Returns whether the key was the
     * handle's, so the studio leaves it alone.
     * @param {KeyboardEvent} event
     * @param {function(string, string, number): void} onMove
     * @returns {boolean}
     */
    static handleKey(event, onMove) {
        if (ListReorder.#drag && event.key === "Escape") {
            ListReorder.#end(false);
            return true;
        }
        const handle = event.target?.closest?.("[data-reorder-handle]");
        if (!handle || event.altKey || event.ctrlKey || event.metaKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return false;
        const { list, row, rows } = ListReorder.#placeOf(handle);
        if (!list) return false;
        const to = rows.indexOf(row) + (event.key === "ArrowUp" ? -1 : 1);
        if (to < 0 || to >= rows.length) return true;
        const id = row.dataset.id;
        onMove(list.dataset.reorder, id, to);
        // The list is drawn again: focus the moved row's handle in its new place
        queueMicrotask(() => list.ownerDocument.querySelector(`[data-reorder="${list.dataset.reorder}"] [data-reorder-item][data-id="${CSS.escape(id)}"] [data-reorder-handle]`)?.focus());
        return true;
    }

    static #placeOf(handle) {
        const row = handle.closest("[data-reorder-item]");
        const list = row?.closest("[data-reorder]");
        return { list, row, rows: list ? [...list.querySelectorAll("[data-reorder-item]")] : [] };
    }

    static #start(event, onMove) {
        const handle = event.target?.closest?.("[data-reorder-handle]");
        if (!handle || event.button !== 0) return;
        const { list, row, rows } = ListReorder.#placeOf(handle);
        if (!list || rows.length < 2) return;
        event.preventDefault();
        handle.setPointerCapture?.(event.pointerId);
        const marker = list.ownerDocument.createElement("div");
        marker.className = "fwmb-reorder-marker";
        list.appendChild(marker);
        row.classList.add("fwmb-is-dragged");
        const drag = { handle, list, row, rows, marker, onMove, startY: event.clientY, to: rows.indexOf(row), pointerId: event.pointerId };
        drag.moved = (move) => ListReorder.#follow(move);
        drag.dropped = (up) => ListReorder.#end(up.type === "pointerup");
        handle.addEventListener("pointermove", drag.moved);
        handle.addEventListener("pointerup", drag.dropped);
        handle.addEventListener("pointercancel", drag.dropped);
        ListReorder.#drag = drag;
        ListReorder.#follow(event);
    }

    /** Moves the dragged row with the pointer, and the marker to where it would land. */
    static #follow(event) {
        const drag = ListReorder.#drag;
        if (!drag) return;
        drag.row.style.transform = `translateY(${event.clientY - drag.startY}px)`;
        const others = drag.rows.filter((row) => row !== drag.row);
        // The row lands before the first other row whose middle lies below the pointer
        let to = others.findIndex((row) => {
            const box = row.getBoundingClientRect();
            return event.clientY < box.top + box.height / 2;
        });
        if (to < 0) to = others.length;
        drag.to = to;
        const listBox = drag.list.getBoundingClientRect();
        const edge = to < others.length ? others[to].getBoundingClientRect().top : others.at(-1).getBoundingClientRect().bottom;
        drag.marker.style.top = `${edge - listBox.top + drag.list.scrollTop}px`;
        drag.inside = event.clientX >= listBox.left && event.clientX <= listBox.right;
    }

    /** Ends the drag, applying the move when the row was dropped on the list somewhere new. */
    static #end(apply) {
        const drag = ListReorder.#drag;
        if (!drag) return;
        ListReorder.#drag = null;
        drag.handle.removeEventListener("pointermove", drag.moved);
        drag.handle.removeEventListener("pointerup", drag.dropped);
        drag.handle.removeEventListener("pointercancel", drag.dropped);
        if (drag.handle.hasPointerCapture?.(drag.pointerId)) drag.handle.releasePointerCapture(drag.pointerId);
        drag.marker.remove();
        drag.row.classList.remove("fwmb-is-dragged");
        drag.row.style.transform = "";
        if (apply && drag.inside && drag.to !== drag.rows.indexOf(drag.row)) drag.onMove(drag.list.dataset.reorder, drag.row.dataset.id, drag.to);
    }
}
