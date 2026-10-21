import { registerModuleHelpers } from "../../ui/templateHelpers.js";

/**
 * The module's Handlebars templates on the web (the platform's `templates` service), with the
 * helpers Foundry provides that they use.
 *
 * The shared code names templates by their Foundry path ("modules/<module id>/templates/x.hbs"),
 * and templates include each other by that path too ({{> "modules/.../parts/shared-range.hbs"}}),
 * so every template is registered as a partial under its Foundry name. Each is fetched from the
 * site's own templates/ folder. Some partials are chosen at render time ({{> (lookup . "...")}}),
 * which no scan of a template can find, so all of them are loaded at start-up from a list of the
 * folder's contents (load); a template asked for that is not on the list is fetched when first
 * rendered.
 */

/**
 * The helpers Foundry registers that the module's templates use (localize, eq, or, numberFormat),
 * and the module's own (see ui/templateHelpers.js).
 *
 * @param {object} handlebars - The Handlebars instance.
 * @param {{localize: Function, format: Function}} i18n
 */
export function registerHelpers(handlebars, i18n) {
    handlebars.registerHelper("localize", (key, options) => {
        const data = options?.hash ?? {};
        return Object.keys(data).length ? i18n.format(key, data) : i18n.localize(key);
    });
    handlebars.registerHelper("eq", (a, b) => a === b);
    // The last argument is Handlebars' options object, not a value
    handlebars.registerHelper("or", (...args) => args.slice(0, -1).some(Boolean));
    handlebars.registerHelper("numberFormat", (value, options) => {
        const { decimals = 0, sign = false } = options?.hash ?? {};
        const number = Number.parseFloat(value);
        const safe = Number.isNaN(number) ? 0 : number;
        const text = safe.toFixed(decimals);
        return sign && safe >= 0 ? `+${text}` : text;
    });
    registerModuleHelpers(handlebars);
}

/**
 * @param {object} options
 * @param {object} options.handlebars - The Handlebars instance (with its compiler).
 * @param {string} options.prefix - The Foundry path the templates are named under ("modules/<id>/templates/").
 * @param {(path: string) => Promise<string>} options.fetchText - Reads a file of the site's templates/ folder by its path in it.
 */
export function createWebTemplates({ handlebars, prefix, fetchText }) {
    const compiled = new Map();

    /** The path in the templates folder of a template named by its Foundry path. */
    const localPath = (name) => (name.startsWith(prefix) ? name.slice(prefix.length) : name);

    async function add(path) {
        const name = prefix + path;
        const template = handlebars.compile(await fetchText(path));
        compiled.set(name, template);
        handlebars.registerPartial(name, template);
        return template;
    }

    return {
        /**
         * Loads and registers templates, all at once.
         *
         * @param {string[]} paths - Paths in the templates folder ("toolbar.hbs", "parts/shared-range.hbs").
         */
        async load(paths) {
            await Promise.all(paths.map(add));
        },

        /**
         * Renders a template named by its Foundry path.
         *
         * @param {string} name
         * @param {object} context
         * @returns {Promise<string>}
         */
        async render(name, context) {
            const template = compiled.get(name) ?? (await add(localPath(name)));
            return template(context);
        },
    };
}
