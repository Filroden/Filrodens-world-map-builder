/**
 * The host the module is running in, as a set of services.
 *
 * The studio, its dialogues and the map engine are shared between hosts: Foundry VTT (the module)
 * and a plain web page. Everything they need from their host goes through `platform` instead of
 * reaching for the host's globals directly (`game`, `ui`, `foundry`, `CONFIG`, `Handlebars`):
 * translated text, notifications, templates, dialogues, saved maps, settings and so on. Each host
 * supplies one implementation of each service; src/platform/foundry/ holds Foundry's.
 *
 * Code outside src/platform/ reads a service at the moment it needs it (`platform.i18n.localize`),
 * never holds on to one, so a host can install its services at start-up and every caller sees
 * them. ESLint enforces the boundary: the Foundry globals are only allowed in src/platform/foundry/
 * and the Foundry entry points (see eslint.config.js).
 *
 * Foundry's services are installed by default. They only touch Foundry's globals when a method is
 * called, never when this file is loaded, so the default costs nothing on another host; a host
 * that is not Foundry calls installPlatform() with its own services before the studio starts, and
 * anything it does not supply would fail the first time it was used, which makes a gap obvious.
 *
 * The services, and what each must provide:
 *
 * - `i18n`: `localize(key)`, `format(key, data)` (`{name}` placeholders), `lang` (language code).
 * - `notify`: `info(text, options)`, `warn(...)`, `error(...)`; `options.permanent` keeps the
 *   message until it is dismissed.
 * - `utils`: `randomID()` (16 characters), `deepClone(value)`, `debounce(fn, ms)`,
 *   `mergeObject(target, source)` (Foundry's semantics: a deep merge into `target`, which is
 *   returned, with dotted keys in `source` expanded), `escapeHtml(text)`, `readForm(form)` (a
 *   form's named fields as a flat object, checkboxes as booleans and number inputs as numbers).
 * - `templates`: `render(path, context)` resolving to an HTML string; templates are named by
 *   their Foundry path ("modules/filrodens-world-map-builder/templates/...").
 * - `fonts`: `list()`, the font family names offered for labels.
 * - `dialogs`: `confirm`, `prompt` and `choose`, `show(options)` for a dialogue its caller drives
 *   (returning the Overlay), `dismiss({ placement })` to close open ones, and
 *   `attach(element)` for where they are drawn (see src/shell/dialogs.js for the options; every host
 *   can use createOverlayDialogs from there).
 * - `settings`: `register(key, config)`, `get(key)`, `set(key, value)` for the module's settings.
 * - `store`: the saved maps (see foundry/store.js for the methods and what they return).
 * - `worldLocks`: one window per world (WL; see kernel/worlds/WorldAccess.js, its only reader).
 *   `available` (false where the host cannot lock); `claim(worldId)` resolving to `{ release() }`,
 *   or null when another tab or client holds the world; `whenFree(worldId, callback)`, called
 *   once when the holder lets go (returns a function that stops waiting); `held()`, the ids held
 *   anywhere; `exclusive(name, fn)`, `fn` run while no other tab runs one of that name; `tell({
 *   kind, worldId })`, what was done to a world told to the other tabs (never this one), and
 *   `listen(callback)` to hear them (returns a function that stops listening). A host that gives
 *   none claims every world, as before WL.
 * - `assets`: `url(path)`, a stored asset path as a URL that resolves the same from any page or
 *   stylesheet; `read(src)`, an image's bytes (or null); `keep(bytes, type, hash)`, a checked image
 *   stored the host's way, resolving with the source to save (see MapPackage).
 * - `module`: `version`, the module's version string; `host`, "foundry" or "web"; `hostVersion`,
 *   Foundry's version (null on the web).
 * - `grid`: `create({ type, size })`, a grid offering `getOffsetRange(rect)` and
 *   `getVertices({ i, j })` for "square", "hexR" and "hexC".
 * - `scene`: `available` (whether maps can be exported to a scene), `run(config)` with what the
 *   studio has made (see foundry/SceneExporter.js), and `previous(name)`, the area and scale the
 *   scene of that name was made with (null on the web, or for no such scene).
 * - `frame`: `setTitle(text)`, the title of what holds the studio (Foundry's window, or the web
 *   page), and `idLength`, how many characters of a saved map's id the title shows (undefined
 *   for all of them). On the web only, `fullscreen`: `enabled()` (whether the page can go full
 *   screen), `active()`, `toggle()`, and `onChange(callback)` (returns a function that stops it).
 *   Foundry offers none, so the studio shows no full-screen toggle there.
 */
import { foundryPlatform } from "./foundry/index.js";

/** The services in use. Replaced as a whole by installPlatform(), never one at a time by callers. */
export const platform = { ...foundryPlatform };

/**
 * Installs a host's services in place of the current ones. Call once, before the studio opens.
 *
 * @param {object} services - Any of the services listed above; those not given are left as they are.
 */
export function installPlatform(services) {
    Object.assign(platform, services);
}
