/**
 * Notifications on the web (the platform's `notify` service): short messages stacked at the top
 * of the page, as Foundry shows its own. Each fades after a few seconds, or stays until closed when
 * asked for with `{ permanent: true }`. Errors are also written to the console.
 */

/** How long a message stays, in milliseconds. */
const SHOW_MS = 5000;
/** The most messages shown at once; older ones make way. */
const MAX_SHOWN = 5;

/**
 * @param {HTMLElement} frame - The element the messages are drawn in (the page's .fwmb frame).
 * @param {object} [options]
 * @param {string} [options.closeLabel] - The close control's accessible name.
 */
export function createNotifications(frame, { closeLabel = "Close" } = {}) {
    const doc = frame.ownerDocument;
    const list = doc.createElement("ol");
    list.className = "fwmb-notifications";
    list.setAttribute("aria-live", "polite");
    frame.append(list);

    function show(kind, text, { permanent = false } = {}) {
        const item = doc.createElement("li");
        item.className = `fwmb-notification ${kind}`;
        item.setAttribute("role", kind === "error" ? "alert" : "status");

        const message = doc.createElement("span");
        message.textContent = text;
        const close = doc.createElement("button");
        close.type = "button";
        close.className = "fwmb-notification-close";
        close.setAttribute("aria-label", closeLabel);
        close.innerHTML = '<i class="fwmb-icon cancel"></i>';
        close.addEventListener("click", () => item.remove());

        item.append(message, close);
        list.append(item);
        while (list.children.length > MAX_SHOWN) list.firstElementChild.remove();
        if (!permanent) setTimeout(() => item.remove(), SHOW_MS);
        return item;
    }

    return {
        info: (text, options) => show("info", text, options),
        warn: (text, options) => show("warning", text, options),
        error: (text, options) => {
            console.error(`FWMB | ${text}`);
            return show("error", text, options);
        },
    };
}
