/**
 * The notice a world made from a 4.3 map shows the first time it is opened (board W8, S0 step 3):
 * what being a world means for the map, from the world's `migration` record (see WorldMigration).
 * Shown once a world (Ken, 2026-11-18); MapStudio marks it seen in the world's record.
 *
 * The board's lines about the Geology map, Add a map and settlement maps wait for the tracks that
 * build them.
 */
export class FirstOpening {
    /** The settings groups a migration can list as taken from the parent, by its group names. */
    static GROUP_KEYS = Object.freeze({
        cultures: "FILRODENSWMB.UI.WorldCultures",
        ages: "FILRODENSWMB.UI.WorldAges",
        nameStyle: "FILRODENSWMB.UI.WorldNameStyle",
        styles: "FILRODENSWMB.UI.ToolLibrary",
        biomes: "FILRODENSWMB.UI.WorldBiomes",
        climate: "FILRODENSWMB.UI.WorldClimate",
        icons: "FILRODENSWMB.UI.ToolLibrary",
    });

    /**
     * The notice's text, for templates/world/dialogs/first-opening.hbs.
     * @param {object} world - The world record (its migration, whether it is held).
     * @param {{explore: boolean, source: string|null, link: string}} options - Whether it opened in
     *     Explore; for a held world, the name of the world its settings come from; the migration page.
     * @param {{localize: Function, format: Function, lang?: string}} i18n
     * @returns {{intro: string, items: string[], link: string, linkLabel: string}}
     */
    static context(world, { explore, source, link }, i18n) {
        const items = [i18n.localize("FILRODENSWMB.UI.FirstOpeningSurface")];
        const migration = world?.migration ?? {};
        if (world?.held && source) {
            items.push(i18n.format("FILRODENSWMB.UI.FirstOpeningHeld", { source }));
            const groups = [...new Set((migration.changed ?? []).map((group) => FirstOpening.GROUP_KEYS[group]).filter(Boolean))].map((key) => i18n.localize(key));
            if (groups.length) items.push(i18n.format("FILRODENSWMB.UI.FirstOpeningHeldChanged", { source, groups: list(groups, i18n) }));
            const added = [];
            if (migration.addedStyles > 0) added.push(i18n.format("FILRODENSWMB.UI.FirstOpeningStyles", { count: migration.addedStyles }));
            if (migration.addedBiomes > 0) added.push(i18n.format("FILRODENSWMB.UI.FirstOpeningBiomes", { count: migration.addedBiomes }));
            if (added.length) items.push(i18n.format("FILRODENSWMB.UI.FirstOpeningAdded", { source, added: list(added, i18n) }));
        } else {
            items.push(i18n.localize("FILRODENSWMB.UI.FirstOpeningSettings"));
        }
        if (explore) items.push(i18n.localize("FILRODENSWMB.UI.FirstOpeningExplore"));
        return { intro: i18n.localize("FILRODENSWMB.UI.FirstOpeningIntro"), items, link, linkLabel: i18n.localize("FILRODENSWMB.UI.FirstOpeningLink") };
    }
}

/** Words joined as a list in the reader's language ("A, B and C"). */
function list(words, i18n) {
    try {
        return new Intl.ListFormat(i18n.lang || "en", { type: "conjunction" }).format(words);
    } catch {
        return words.join(", ");
    }
}
