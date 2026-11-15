// The Cartography page: the panel with a compass rose and a cartouche, Add decoration's menu, a
// compass rose in the inspector, and a cartouche in the inspector.
import { INSPECTOR, MAP } from "./_common.mjs";

/** Add decoration's menu on the bar. */
const ADD_MENU = '[data-region="editToolbar"] .fwmb-bar-add > button';

/** A design's thumbnail in the inspector, by its value. */
const design = (name, value) => `${INSPECTOR} .fwmb-design-option:has(input[name="${name}"][value="${value}"])`;

/** The compass rose's corner and the cartouche's place at the top, on the finished world map. */
const ROSE_VIEW = [1450, 1050, 2000, 1600];
const TITLE_VIEW = [600, 0, 1400, 900];

export default [
    {
        slug: "cartography-panel",
        start: MAP.finished,
        caption: "Cartography, with the scale bar, border and grid, a compass rose and a cartouche.",
        // The tutorial's page 10 adds the compass rose and the cartouche, so the finished map has both
        action: [
            { do: "tool", tool: "cartography" },
            { do: "camera", view: "fit" },
        ],
        screenshot: { region: "studio" },
    },
    {
        slug: "cartography-decorations",
        start: MAP.finished,
        caption: "Add decoration's menu: an image of your own, a compass rose or a cartouche.",
        action: [{ do: "click", target: ADD_MENU }],
        settle: false,
        // The menu shows while its button has focus
        screenshot: { region: "studio", keepFocus: true },
        after: [{ do: "key", key: "Escape" }],
    },
    {
        slug: "cartography-compass",
        start: MAP.finished,
        caption: "A mariner's compass rose in the Sea chart colours, open in the inspector.",
        action: [
            { do: "click", target: '.fwmb-list-item:has(:text-is("Compass rose"))' },
            { do: "click", target: design("compassDesign", "mariner") },
            { do: "set", field: `${INSPECTOR} select[name="compassScheme"]`, value: "seaChart" },
            { do: "frame", rect: ROSE_VIEW },
        ],
        screenshot: { region: "studio" },
    },
    {
        slug: "cartography-cartouche",
        start: MAP.finished,
        caption: "A ribbon cartouche with the map's name and a subtitle, open in the inspector.",
        action: [
            { do: "click", target: `${INSPECTOR} .fwmb-overlay-close` },
            { do: "click", target: '.fwmb-list-item:has(:text-is("Cartouche"))' },
            { do: "click", target: design("cartoucheDesign", "ribbon") },
            { do: "set", field: `${INSPECTOR} input[name="cartoucheSubtitle"]`, value: "The known lands" },
            { do: "openSection", section: "inspectorCartoucheTitle" },
            { do: "frame", rect: TITLE_VIEW },
        ],
        screenshot: { region: "studio" },
    },
];
