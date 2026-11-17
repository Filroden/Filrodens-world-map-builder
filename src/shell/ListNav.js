/**
 * The keys of the panel's lists (a `[data-list-nav]` listbox of `[data-list-item]` rows, and the
 * Regions lists, which use the same marks): each list is one tab stop, Up and Down move through its
 * rows (and its add row), Home and End go to the first and last, Enter opens the row (as a click
 * does: its inspector or its dialogue). Moving never opens anything, so the reader can arrow
 * through a list and open what they want. A row's own controls (visibility, Zoom to, its menu…) keep
 * their own tab stops, so Tab goes from the list's row through its controls to the next list.
 *
 * Every key the lists take stops there: in Foundry the window's keys would otherwise pan the scene
 * behind the studio (see MapStudio's keydown).
 */
export class ListNav {
    /** The rows and add buttons of a list, in order. */
    static items(list) {
        return [...list.querySelectorAll("[data-list-item]")];
    }

    /**
     * After a redraw: each list has one tab stop among its rows (the row the template marked, else
     * its selected row, else its first).
     * @param {ParentNode} root
     */
    static settle(root) {
        for (const list of root.querySelectorAll("[data-list-nav]")) {
            const items = this.items(list);
            if (!items.length) continue;
            if (!items.some((item) => item.getAttribute("tabindex") === "0")) {
                const stop = items.find((item) => item.getAttribute("aria-selected") === "true") ?? items[0];
                for (const item of items) item.tabIndex = item === stop ? 0 : -1;
            }
        }
    }

    /**
     * A key on a list's row. Returns whether it was the list's, so the studio leaves it alone.
     * @param {KeyboardEvent} event
     * @returns {boolean}
     */
    static handleKey(event) {
        const item = event.target;
        if (!item?.matches?.("[data-list-item]") || event.altKey || event.ctrlKey || event.metaKey) return false;
        const list = item.closest("[data-list-nav], .fwmb-region-list");
        if (!list) return false;
        const items = this.items(list);
        const index = items.indexOf(item);
        switch (event.key) {
            case "ArrowDown":
                if (index < items.length - 1) this.moveTo(list, items[index + 1]);
                return true;
            case "ArrowUp":
                if (index > 0) this.moveTo(list, items[index - 1]);
                return true;
            case "Home":
                this.moveTo(list, items[0]);
                return true;
            case "End":
                this.moveTo(list, items.at(-1));
                return true;
            case "Enter":
                // An add button is a button: the browser presses it
                if (item.localName === "button") return false;
                item.click();
                return true;
            default:
                return false;
        }
    }

    /** Makes an item its list's tab stop and focuses it. */
    static moveTo(list, item) {
        for (const other of list.querySelectorAll('[data-list-item][tabindex="0"]')) if (other !== item) other.tabIndex = -1;
        item.tabIndex = 0;
        item.focus();
        item.scrollIntoView?.({ block: "nearest" });
    }
}
