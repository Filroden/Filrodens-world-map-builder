/**
 * Starts the map studio in a web page: the web version of Filroden's World Map Builder.
 *
 * The page (index.html) loads the module's stylesheets, the web base stylesheet and Handlebars,
 * then this script, which:
 *
 * 1. loads PixiJS and makes it the global the studio's canvas code expects (Foundry provides it
 *    there);
 * 2. reads the module's manifest, picks a language from the browser's preferences and loads its
 *    strings over the English ones;
 * 3. opens the saved maps database, builds the web platform services and installs them in place of
 *    Foundry's (see src/platform);
 * 4. loads every template, draws the studio's frame (templates/studio.hbs) into the page and
 *    mounts the studio in it.
 *
 * Everything is fetched relative to the page, so the site works from any address or folder.
 */
import * as PIXI from "../vendor/pixi/pixi.min.mjs";

globalThis.PIXI = PIXI;

/** Where the templates list is (written by the web pack, or served by the development server). */
const TEMPLATE_LIST = "templates.json";

const fetchFrom = (path, read) =>
    fetch(new URL(path, document.baseURI)).then((response) => {
        if (!response.ok) throw new Error(`${path}: ${response.status} ${response.statusText}`);
        return read(response);
    });
const fetchJson = (path) => fetchFrom(path, (response) => response.json());
const fetchText = (path) => fetchFrom(path, (response) => response.text());

/**
 * The page's own light or dark theme, from the reader's system preference, kept up to date when
 * it changes. It is what the studio's "Automatic" theme follows; a theme chosen in the studio
 * overrides it (see src/ui/Theme.js).
 */
function followSystemTheme() {
    const query = globalThis.matchMedia?.("(prefers-color-scheme: light)");
    const apply = () => {
        const light = Boolean(query?.matches);
        document.body.classList.toggle("theme-light", light);
        document.body.classList.toggle("theme-dark", !light);
    };
    apply();
    query?.addEventListener?.("change", apply);
}

/** The language strings: English, with the chosen language's own strings over it. */
async function loadStrings(manifest, { chooseLanguage, flattenStrings }) {
    const preferred = navigator.languages?.length ? navigator.languages : [navigator.language ?? "en"];
    const chosen = chooseLanguage(manifest.languages ?? [], preferred) ?? { lang: "en", path: "languages/en.json" };
    const files = [await fetchJson("languages/en.json")];
    if (chosen.path !== "languages/en.json") files.push(await fetchJson(chosen.path));
    return { lang: chosen.lang, strings: flattenStrings(...files) };
}

/** Where saved maps are kept: IndexedDB, or memory for this visit when the browser refuses it. */
async function openRecords({ IndexedDbRecords, MemoryRecords }) {
    try {
        return { records: await IndexedDbRecords.open(), persistent: true };
    } catch (error) {
        console.warn(`FWMB | Saved maps cannot be kept in this browser (${error?.message ?? error}); they will last until the page is closed.`);
        return { records: new MemoryRecords(), persistent: false };
    }
}

/**
 * How a failure to start is put into words. Until the strings are loaded it can only be English
 * (the failure may be loading them); once the platform is installed, the reader's language.
 */
let describeFailure = (detail) => `The map builder could not start: ${detail}`;

async function start() {
    followSystemTheme();
    const frame = document.getElementById("fwmb-app");

    const [i18nModule, storeModule, { createWebPlatform }, { installPlatform, platform }, { FilePickerElement }, { WebTooltips }] = await Promise.all([
        import("../src/platform/web/i18n.js"),
        import("../src/platform/web/store.js"),
        import("../src/platform/web/index.js"),
        import("../src/platform/index.js"),
        import("../src/platform/web/FilePickerElement.js"),
        import("../src/platform/web/tooltips.js"),
    ]);

    const manifest = await fetchJson("module.json");
    const [{ lang, strings }, { records, persistent }] = await Promise.all([loadStrings(manifest, i18nModule), openRecords(storeModule)]);
    document.documentElement.lang = lang;

    installPlatform(
        createWebPlatform({
            strings,
            lang,
            handlebars: globalThis.Handlebars,
            fetchTemplate: (path) => fetchText(`templates/${path}`),
            records,
            frame,
            manifest,
            baseUrl: document.baseURI,
        }),
    );
    describeFailure = (detail) => platform.i18n.format("FILRODENSWMB.Web.StartFailed", { detail });
    FilePickerElement.define(customElements, { browseLabel: platform.i18n.localize("FILRODENSWMB.UI.BrowseFiles") });

    const [{ registerPinIconSettings }, { MapStudio }, { attachTheme, registerThemeSettings }] = await Promise.all([
        import("../src/data/pinIcons.js"),
        import("../src/applications/MapStudio.js"),
        import("../src/ui/Theme.js"),
    ]);
    registerPinIconSettings();
    registerThemeSettings();
    // The colour theme chosen in the studio, on the frame and on <body> (where the tooltip is)
    attachTheme(frame);
    attachTheme(document.body);

    await platform.templates.load(await fetchJson(TEMPLATE_LIST));
    frame.innerHTML = await platform.templates.render(`modules/${manifest.id}/templates/studio.hbs`, {});
    MapStudio.applyTextDirection(frame);
    new WebTooltips(frame);

    const studio = new MapStudio();
    studio.mount(frame.querySelector(".fwmb-studio"));
    if (!persistent) platform.notify.warn(platform.i18n.localize("FILRODENSWMB.Web.StorageUnavailable"), { permanent: true });

    // Leaving the page with unsaved changes asks first, as closing the studio's window does in Foundry
    globalThis.addEventListener("beforeunload", (event) => {
        if (studio.isDirty) event.preventDefault();
    });
    globalThis.fwmbStudio = studio;
}

start().catch((error) => {
    console.error("FWMB | The map builder could not start.", error);
    const status = document.createElement("p");
    status.className = "fwmb-web-status";
    status.textContent = describeFailure(error?.message ?? error);
    document.getElementById("fwmb-app")?.replaceChildren(status);
});
