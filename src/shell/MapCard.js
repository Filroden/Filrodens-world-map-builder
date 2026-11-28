/**
 * The map card (EX1; the design system's Map card): everything Inspect reads at a point, one line
 * per row, beside the resting pointer; and on touch the same list as a sheet at the canvas's foot,
 * with Close. Built from the rows MapReader gathers ({icon, name, kind, figure, set, ground,
 * gmOnly}); its text is set as text, never as markup, since names are the reader's own.
 */

/**
 * The card's element.
 * @param {Document} doc
 * @param {Array<{icon: string, row: object}>} list - The rows in the list's order.
 * @param {object} options
 * @param {{localize: function(string): string}} options.t - The host's strings.
 * @param {boolean} [options.sheet] - The touch sheet: placed at the canvas's foot, with Close.
 * @param {function(): void} [options.onClose] - The sheet's Close.
 * @returns {HTMLElement}
 */
export function buildMapCard(doc, list, { t, sheet = false, onClose = null }) {
    const make = (tag, className, text) => {
        const element = doc.createElement(tag);
        if (className) element.className = className;
        if (text != null) element.textContent = text;
        return element;
    };
    const root = make("div", `fwmb-mc${sheet ? " fwmb-mc--sheet" : ""}`);
    if (sheet) {
        root.setAttribute("role", "dialog");
        root.setAttribute("aria-label", t.localize("FILRODENSWMB.UI.InspectHeld"));
        const head = make("div", "fwmb-mc-head");
        head.append(make("b", null, t.localize("FILRODENSWMB.UI.InspectHeld")));
        const close = make("button", "fwmb-btn fwmb-btn--square fwmb-mc-close");
        close.type = "button";
        close.setAttribute("aria-label", t.localize("FILRODENSWMB.UI.Close"));
        const icon = make("span", "fwmb-icon fwmb-icon--cancel");
        icon.setAttribute("aria-hidden", "true");
        close.append(icon);
        close.addEventListener("click", () => onClose?.());
        head.append(close);
        root.append(head);
    } else {
        // A card following the pointer is not a dialogue: the held list in the panel is what is read
        root.setAttribute("role", "tooltip");
        root.setAttribute("aria-hidden", "true");
    }
    const body = make("div", "fwmb-mc-body");
    let set = null;
    list.forEach(({ icon, row }, index) => {
        if (row.set && row.set !== set) body.append(make("div", "fwmb-mc-set", row.set));
        set = row.set ?? set;
        const classes = ["fwmb-mc-row"];
        if (index === 0 && !row.ground) classes.push("fwmb-mc-row--first");
        if (row.set) classes.push("fwmb-mc-row--region");
        if (row.ground) classes.push("fwmb-mc-row--ground");
        const line = make("div", classes.join(" "));
        const mark = make("span", `fwmb-icon fwmb-icon--${icon}`);
        mark.setAttribute("aria-hidden", "true");
        const kind = make("span", "fwmb-kind");
        if (row.kind) kind.append(doc.createTextNode(row.kind));
        if (row.figure) {
            if (row.kind) kind.append(doc.createTextNode(" · "));
            kind.append(make("span", "fwmb-num", row.figure));
        }
        if (row.gmOnly) kind.append(make("span", "fwmb-mc-gm", t.localize("FILRODENSWMB.UI.InspectGmOnly")));
        line.append(mark, make("b", null, row.name), kind);
        body.append(line);
    });
    root.append(body);
    if (!sheet) root.append(make("div", "fwmb-mc-foot", t.localize(touchless(doc) ? "FILRODENSWMB.UI.InspectCardFoot" : "FILRODENSWMB.UI.InspectCardFootTouch")));
    return root;
}

/** Whether the page's main pointer is fine (a mouse or a pen), for the card's foot. */
function touchless(doc) {
    return !doc.defaultView?.matchMedia?.("(pointer: coarse)")?.matches;
}

/**
 * Places a card beside a point on the surface (CSS pixels from its top left): to its right when
 * there is room, else its left, below, above, or else over it, never across the surface's edges.
 * @param {HTMLElement} card
 * @param {HTMLElement} surface
 * @param {{x: number, y: number}} point
 * @param {number} gap - The gap kept from the point and the edges.
 */
export function placeMapCard(card, surface, point, gap) {
    const W = surface.clientWidth;
    const H = surface.clientHeight;
    const w = card.offsetWidth;
    const h = card.offsetHeight;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const cy = clamp(point.y - h / 2, gap, H - h - gap);
    const cx = clamp(point.x - w / 2, gap, W - w - gap);
    let x;
    let y;
    if (point.x + gap + w <= W - gap) [x, y] = [point.x + gap, cy];
    else if (point.x - gap - w >= gap) [x, y] = [point.x - gap - w, cy];
    else if (point.y + gap + h <= H - gap) [x, y] = [cx, point.y + gap];
    else if (point.y - gap - h >= gap) [x, y] = [cx, point.y - gap - h];
    else [x, y] = [cx, cy];
    card.style.left = `${Math.round(clamp(x, gap, Math.max(gap, W - w - gap)))}px`;
    card.style.top = `${Math.round(clamp(y, gap, Math.max(gap, H - h - gap)))}px`;
}
