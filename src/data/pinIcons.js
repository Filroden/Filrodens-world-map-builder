import { FILRODENSWMB } from "../config.js";

/**
 * Data layer for the pin icon registry: built-in icons (curated, shipped with the module,
 * can be individually hidden from pickers but never removed) merged with GM-registered
 * custom icons (a live reference to an SVG already somewhere in the GM's accessible Foundry
 * data - never uploaded or copied, see world settings below).
 *
 * Both registries feed the same picker lists used when placing or editing a pin, and the
 * same path resolution used when baking the raster export and creating exported Journal
 * Map Notes - see resolvePinIconPath().
 */

/**
 * Builds the module-relative path for a built-in pinhead icon.
 */
function builtinIconPath(key) {
    return `modules/${FILRODENSWMB.ID}/assets/pinhead-icons/${key}.svg`;
}

/**
 * Resolves the world compendium pack that stores saved maps, or null if it hasn't been
 * initialised yet.
 */
function getMapCompendiumPack() {
    return game.packs.get(`world.${FILRODENSWMB.COMPENDIUM.NAME}`) || null;
}

/**
 * Converts a stored custom icon path into a URL that's safe to use inside a CSS mask.
 *
 * FilePicker returns paths relative to the Foundry Data directory with no leading slash
 * (e.g. "sharedAssets/images/icons/a.svg"). That's fine for an <img src> or a PIXI texture -
 * both resolve it against the document's base URL. But every pin icon glyph is painted via
 * `mask-image: var(--fwmb-mask)`, and a *relative* url() inside a CSS custom property is
 * resolved against the stylesheet where the `var()` is read (filrodens-world-map-builder.css),
 * not against wherever the property's value was set - so a bare relative path 404s one
 * directory level too deep (under styles/). Routing it through Foundry's own getRoute() makes
 * it root-relative (and prefixes any configured route/proxy path), which resolves identically
 * regardless of which stylesheet reads it. A Forge/remote asset-library URL is already
 * absolute and is returned unchanged.
 */
function toIconUrl(path) {
    if (!path || /^https?:\/\//i.test(path)) return path;
    return foundry.utils.getRoute(path);
}

/**
 * Registers the two world settings backing the custom pin icon registry. Both are
 * `config: false` - they're managed entirely through the Pin Icons fieldsets in
 * tools-settings.hbs, not Foundry's native settings sheet.
 */
export function registerPinIconSettings() {
    game.settings.register(FILRODENSWMB.ID, FILRODENSWMB.PIN_ICONS.SETTINGS.DISABLED, {
        scope: "world",
        config: false,
        type: Array,
        default: [],
    });

    game.settings.register(FILRODENSWMB.ID, FILRODENSWMB.PIN_ICONS.SETTINGS.CUSTOM, {
        scope: "world",
        config: false,
        type: Array,
        default: [],
    });
}

/**
 * The built-in icon keys a GM has hidden from the pickers.
 */
function getDisabledPinIcons() {
    return game.settings.get(FILRODENSWMB.ID, FILRODENSWMB.PIN_ICONS.SETTINGS.DISABLED) || [];
}

/**
 * The GM's registered custom icons, each `{ id, name, path }`.
 */
function getCustomPinIcons() {
    return game.settings.get(FILRODENSWMB.ID, FILRODENSWMB.PIN_ICONS.SETTINGS.CUSTOM) || [];
}

/**
 * Built-in icons for the "Built-in Icons" settings fieldset: every icon, each flagged with
 * its current disabled state so the row can render a checkbox rather than filter itself out.
 */
export function getBuiltinPinIconList() {
    const disabled = new Set(getDisabledPinIcons());

    return Object.entries(FILRODENSWMB.INFRASTRUCTURE_ICONS)
        .map(([key, labelKey]) => ({
            key,
            label: game.i18n.localize(labelKey),
            isDisabled: disabled.has(key),
            isProtected: key === FILRODENSWMB.PIN_ICONS.DEFAULT,
        }))
        .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Custom icons for the "Custom Icons" settings fieldset, alphabetical by name. `path` is
 * resolved to a mask-safe URL (see toIconUrl) - this list is for rendering only.
 */
export function getCustomPinIconList() {
    return getCustomPinIcons()
        .map((entry) => ({ ...entry, path: toIconUrl(entry.path) }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * A single custom icon's raw stored entry, exactly as FilePicker returned its path - used to
 * prefill the add/edit dialogue, where the native `<file-picker>` element needs the original
 * Data-relative path rather than the mask-safe URL getCustomPinIconList() exposes.
 */
export function getCustomPinIconById(id) {
    return getCustomPinIcons().find((entry) => entry.id === id) || null;
}

/**
 * The merged, filtered list used by every icon picker (edit-pins.hbs, the infrastructure
 * toolbar's pin mode). Built-ins are listed first, then customs, both alphabetical - a
 * disabled built-in is hidden unless it's `currentKey`, so re-opening a pin never makes its
 * own icon vanish from the picker even after a GM has since disabled it.
 */
export function getPinIconPickerList(currentKey = null) {
    const disabled = new Set(getDisabledPinIcons());

    const builtins = Object.entries(FILRODENSWMB.INFRASTRUCTURE_ICONS)
        .filter(([key]) => !disabled.has(key) || key === currentKey)
        .map(([key, labelKey]) => ({
            key,
            label: game.i18n.localize(labelKey),
            path: builtinIconPath(key),
            isCustom: false,
        }))
        .sort((a, b) => a.label.localeCompare(b.label));

    const customs = getCustomPinIcons()
        .map((entry) => ({
            key: entry.id,
            label: entry.name,
            path: toIconUrl(entry.path),
            isCustom: true,
        }))
        .sort((a, b) => a.label.localeCompare(b.label));

    return [...builtins, ...customs];
}

/**
 * Resolves any pin icon key (built-in or custom) to a display label - used as the default
 * name for a newly-placed pin. Falls back to the literal word "Pin" for a key that resolves
 * in neither registry, matching the pre-existing fallback behaviour for an unrecognised icon.
 */
export function getPinIconLabel(key) {
    const labelKey = FILRODENSWMB.INFRASTRUCTURE_ICONS[key];
    if (labelKey) return game.i18n.localize(labelKey);

    const custom = getCustomPinIcons().find((entry) => entry.id === key);
    return custom?.name || "Pin";
}

/**
 * Resolves any pin icon key (built-in or custom) to the path its texture should load from -
 * used by both the raster bake (StudioCanvas) and the exported Journal Map Notes
 * (SceneExporter). Falls back to the protected default's path for a key that no longer
 * resolves in either registry (e.g. a custom icon removed since a pin last referenced it),
 * so a stale reference degrades to a known-good icon rather than a broken texture.
 */
export function resolvePinIconPath(key) {
    if (Object.hasOwn(FILRODENSWMB.INFRASTRUCTURE_ICONS, key)) return builtinIconPath(key);

    const custom = getCustomPinIcons().find((entry) => entry.id === key);
    if (custom) return custom.path;

    return builtinIconPath(FILRODENSWMB.PIN_ICONS.DEFAULT);
}

/**
 * Registers a new custom icon and returns the stored entry (including its generated id).
 */
export async function addCustomPinIcon({ name, path }) {
    const entry = { id: foundry.utils.randomID(), name, path };
    await game.settings.set(FILRODENSWMB.ID, FILRODENSWMB.PIN_ICONS.SETTINGS.CUSTOM, [...getCustomPinIcons(), entry]);
    return entry;
}

/**
 * Updates an existing custom icon's name and/or path in place (its id, and therefore every
 * pin already referencing it, is unaffected).
 */
export async function updateCustomPinIcon(id, { name, path }) {
    const icons = getCustomPinIcons().map((entry) => (entry.id === id ? { ...entry, name, path } : entry));
    await game.settings.set(FILRODENSWMB.ID, FILRODENSWMB.PIN_ICONS.SETTINGS.CUSTOM, icons);
}

/**
 * Removes a custom icon's registry entry. Deliberately does not touch the referenced file -
 * it was never uploaded or owned by the module (see the "live reference, not a copy" design
 * decision) - and does not check usage; call findPinIconUsage()/revertPinIconUsage() first.
 */
export async function removeCustomPinIconEntry(id) {
    const icons = getCustomPinIcons().filter((entry) => entry.id !== id);
    await game.settings.set(FILRODENSWMB.ID, FILRODENSWMB.PIN_ICONS.SETTINGS.CUSTOM, icons);
}

/**
 * Hides or restores a built-in icon from the pickers. The protected default is silently
 * ignored - it can never be disabled.
 */
export async function setBuiltinPinIconDisabled(key, isDisabled) {
    if (key === FILRODENSWMB.PIN_ICONS.DEFAULT) return;

    const current = new Set(getDisabledPinIcons());
    if (isDisabled) current.add(key);
    else current.delete(key);

    await game.settings.set(FILRODENSWMB.ID, FILRODENSWMB.PIN_ICONS.SETTINGS.DISABLED, [...current]);
}

/**
 * Checks a set of pins against both icon registries and reports any that won't resolve in
 * this world - i.e. would silently render as the protected default via resolvePinIconPath().
 * A custom icon key is only ever meaningful within the world that registered it, so this is
 * how a GM finds out a map arrived (via JSON import, or a compendium map authored elsewhere)
 * referencing custom icons their own world doesn't have.
 * @param {Array} pins - Pins to check, each with an `icon` key.
 * @returns {{unresolvedKeys: string[], affectedPinCount: number}}
 */
export function findUnresolvedPinIcons(pins = []) {
    const customIds = new Set(getCustomPinIcons().map((entry) => entry.id));
    const unresolvedKeys = new Set();
    let affectedPinCount = 0;

    for (const pin of pins) {
        const key = pin?.icon;
        if (!key || Object.hasOwn(FILRODENSWMB.INFRASTRUCTURE_ICONS, key) || customIds.has(key)) continue;

        unresolvedKeys.add(key);
        affectedPinCount++;
    }

    return { unresolvedKeys: [...unresolvedKeys], affectedPinCount };
}

/**
 * Bulk-hides or bulk-reveals every built-in icon in one settings write. The protected default
 * is always excluded, exactly as setBuiltinPinIconDisabled() excludes it one at a time.
 */
export async function setAllBuiltinPinIconsDisabled(isDisabled) {
    if (!isDisabled) {
        await game.settings.set(FILRODENSWMB.ID, FILRODENSWMB.PIN_ICONS.SETTINGS.DISABLED, []);
        return;
    }

    const keys = Object.keys(FILRODENSWMB.INFRASTRUCTURE_ICONS).filter((key) => key !== FILRODENSWMB.PIN_ICONS.DEFAULT);
    await game.settings.set(FILRODENSWMB.ID, FILRODENSWMB.PIN_ICONS.SETTINGS.DISABLED, keys);
}

/**
 * Scans every saved map in the world compendium, plus the pins of a currently open (and
 * possibly unsaved) Studio session, for pins using the given icon key.
 * @param {string} key - The icon key to search for.
 * @param {Array} livePins - The currently open session's `app.mapPins`, or [] if none.
 * @returns {Promise<{savedMaps: Array<{id: string, name: string, count: number}>, liveCount: number, totalCount: number}>}
 */
export async function findPinIconUsage(key, livePins = []) {
    const savedMaps = [];
    const pack = getMapCompendiumPack();

    if (pack) {
        const documents = await pack.getDocuments();

        for (const doc of documents) {
            const pins = doc.flags?.[FILRODENSWMB.ID]?.mapData?.pins || [];
            const count = pins.filter((pin) => pin.icon === key).length;
            if (count > 0) savedMaps.push({ id: doc.id, name: doc.name, count });
        }
    }

    const liveCount = livePins.filter((pin) => pin.icon === key).length;
    const totalCount = savedMaps.reduce((sum, map) => sum + map.count, 0) + liveCount;

    return { savedMaps, liveCount, totalCount };
}

/**
 * Bulk-reverts every pin using `key` (across every saved map in the compendium, and the
 * live session's pins if provided) to the protected default icon. Call before removing a
 * custom icon's registry entry whenever findPinIconUsage() reports it's in use.
 * @param {string} key - The icon key being removed.
 * @param {Array} livePins - The currently open session's `app.mapPins`, mutated in place.
 */
export async function revertPinIconUsage(key, livePins = []) {
    const fallback = FILRODENSWMB.PIN_ICONS.DEFAULT;
    const pack = getMapCompendiumPack();

    if (pack) {
        const documents = await pack.getDocuments();

        for (const doc of documents) {
            const pins = doc.flags?.[FILRODENSWMB.ID]?.mapData?.pins;
            if (!pins?.some((pin) => pin.icon === key)) continue;

            const revertedPins = pins.map((pin) => (pin.icon === key ? { ...pin, icon: fallback } : pin));
            await doc.update({ [`flags.${FILRODENSWMB.ID}.mapData.pins`]: revertedPins });
        }
    }

    for (const pin of livePins) {
        if (pin.icon === key) pin.icon = fallback;
    }
}
