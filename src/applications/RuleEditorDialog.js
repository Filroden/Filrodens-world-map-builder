import { FILRODENSWMB } from "../config.js";
import { BiomeRuleEngine } from "../generation/BiomeRuleEngine.js";
import { ColorMath } from "../tools/ColorMath.js";

/**
 * The "Biome Rule Stacker" - a dedicated, large DialogV2 window (not one of the module's
 * usual small single-purpose dialogs) where a GM reviews auto-generation rules for their
 * custom biomes against the built-in defaults. Ported from the agreed mockup at
 * https://claude.ai/artifact/UxXan2t7gAGdPxPjfVpBZ6 (see custom-biomes-v2.3-scoping.md,
 * "UI design" section) - the row/track/chip DOM-building methods below are close to a
 * direct port of that mockup's own vanilla JS, just reading real customBiomes data instead
 * of illustrative samples, and computing the "Default biomes" table live from
 * BiomeRuleEngine.getDefaultBiomeReferenceRows() instead of hand-copied numbers.
 *
 * Kept in its own file (rather than folded into MapDialogManager.js, already the module's
 * largest file) because - once 4b-ii/4b-iii land - this will grow into the single largest
 * piece of interactive UI in the module, matching how RegionalExtractor.js and
 * SceneExporter.js already carve substantial single-feature logic out of MapStudioApp.js.
 *
 * SUB-PHASE 4b-i (this pass): renders an accurate, data-driven READ-ONLY snapshot - the
 * map's real custom biome rules (if any exist yet) plus the live-computed defaults table -
 * in the mockup's visual layout. Nothing is interactive yet: no dragging, no add/remove, no
 * reordering, and no Save. The dialog has a single Close button and never reads from or
 * writes to app.uiState.customBiomes beyond the initial read used to render it. Every
 * custom biome saved so far has `rules: []` (see MapDialogManager.onAddCustomBiome), so the
 * very first time this opens every custom biome will show the "no rules yet" empty state
 * below rather than a track - that's expected, not a bug in this pass.
 *
 * Interactivity (drag handles, per-axis add/remove, row add/remove, priority reordering)
 * lands in 4b-ii. Save/Cancel wiring back into app.uiState.customBiomes, plus a CSS polish
 * pass, lands in 4b-iii.
 */
export class RuleEditorDialog {
    /**
     * Opens the Rule Editor for the given MapStudioApp instance.
     * @param {object} app - The MapStudioApp instance.
     */
    static async open(app) {
        const customBiomes = foundry.utils.deepClone(app.uiState.customBiomes || []);
        const seaLevel = app.uiState.seaLevel ?? FILRODENSWMB.DEFAULTS.SEA_LEVEL;
        const defaultBiomes = BiomeRuleEngine.getDefaultBiomeReferenceRows(seaLevel);

        const content = await foundry.applications.handlebars.renderTemplate("modules/filrodens-world-map-builder/templates/dialogs/biome-rule-editor.hbs", {});

        // A formal two-button Accept/Cancel pair (DialogV2.wait, not the single-button
        // .prompt) rather than one ambiguous "Close" - matching promptUnsavedChanges's own
        // multi-button pattern above. Both currently do the same thing (nothing is editable
        // yet in this pass), but the distinction is what 4b-iii's real Save/discard wiring
        // will hook into, so it's worth settling the chrome now rather than swapping it
        // again later. The window's own close (X) button is treated the same as Cancel.
        await foundry.applications.api.DialogV2.wait({
            classes: ["fwmb", "fwmb-rule-editor-dialog"],
            window: { title: game.i18n.localize("FILRODENSWMB.UI.RuleEditorTitle"), icon: "fwmb-icon tune" },
            position: { width: 1040 },
            content,
            buttons: [
                { action: "accept", label: game.i18n.localize("FILRODENSWMB.UI.Accept"), icon: "fwmb-icon accept", default: true },
                { action: "cancel", label: game.i18n.localize("FILRODENSWMB.UI.Cancel"), icon: "fwmb-icon cancel" },
            ],
            close: () => "cancel",
            render: (event) => RuleEditorDialog.#renderContent(event.target.element, customBiomes, defaultBiomes, seaLevel),
        });
    }

    /** Populates the dialog's two (otherwise empty) host elements once it's in the DOM. */
    static #renderContent(root, customBiomes, defaultBiomes, seaLevel) {
        const customHost = root.querySelector("#fwmb-rule-custom-rows");
        const defaultHost = root.querySelector("#fwmb-rule-default-rows");
        const countEl = root.querySelector("#fwmb-rule-custom-count");

        const totalCustomRules = customBiomes.reduce((sum, biome) => sum + (biome.rules?.length || 0), 0);
        countEl.textContent = game.i18n.format("FILRODENSWMB.UI.RuleEditorCustomCount", {
            biomes: customBiomes.length,
            rules: totalCustomRules,
        });

        customHost.replaceChildren();
        for (const biome of customBiomes) {
            customHost.appendChild(
                RuleEditorDialog.#buildBiomeGroup({
                    color: ColorMath.rgbToHex(biome.color),
                    name: biome.name,
                    code: biome.code,
                    rows: biome.rules || [],
                    locked: false,
                    seaLevel,
                }),
            );
        }

        defaultHost.replaceChildren();
        for (const biome of defaultBiomes) {
            defaultHost.appendChild(
                RuleEditorDialog.#buildBiomeGroup({
                    color: ColorMath.rgbToHex(biome.color),
                    name: game.i18n.localize(`FILRODENSWMB.BIOMES.${biome.key}`),
                    code: null,
                    rows: biome.rows,
                    locked: true,
                    seaLevel,
                }),
            );
        }
    }

    /**
     * Builds one biome's card: its label (swatch/name/code) plus one row per rule, or a
     * single "no rules yet" placeholder row when a custom biome has none. Every element
     * built here is inert in this pass - see the class doc comment.
     */
    static #buildBiomeGroup({ color, name, code, rows, locked, seaLevel }) {
        const group = document.createElement("div");
        group.className = "fwmb-rule-group" + (locked ? " locked" : "");

        if (rows.length === 0) {
            group.appendChild(RuleEditorDialog.#buildEmptyRow({ color, name, code }));
            return group;
        }

        rows.forEach((row, index) => {
            group.appendChild(
                RuleEditorDialog.#buildRuleRow(row, {
                    seaLevel,
                    labelContent: index === 0 ? RuleEditorDialog.#buildGroupLabel({ color, name, code, locked }) : null,
                }),
            );
        });

        return group;
    }

    /** A custom biome with an empty `rules` array - nothing to draw a track for yet. */
    static #buildEmptyRow({ color, name, code }) {
        const row = document.createElement("div");
        row.className = "fwmb-rule-row fwmb-rule-row-empty";

        const labelCell = document.createElement("div");
        labelCell.className = "fwmb-rule-row-label";
        labelCell.appendChild(RuleEditorDialog.#buildGroupLabel({ color, name, code, locked: false }));
        row.appendChild(labelCell);

        const hint = document.createElement("div");
        hint.className = "fwmb-rule-row-empty-hint";
        hint.textContent = game.i18n.localize("FILRODENSWMB.UI.RuleEditorNoRulesYet");
        row.appendChild(hint);

        return row;
    }

    /** One rule row: a label cell (only populated for the first row of a biome) plus the three axis tracks. */
    static #buildRuleRow(rule, { seaLevel, labelContent }) {
        const row = document.createElement("div");
        row.className = "fwmb-rule-row";

        const labelCell = document.createElement("div");
        labelCell.className = "fwmb-rule-row-label";
        if (labelContent) {
            labelCell.appendChild(labelContent);
        } else {
            const mark = document.createElement("span");
            mark.className = "fwmb-rule-continuation";
            mark.textContent = "+"; // `+` this row is an additional rule for the biome above
            labelCell.appendChild(mark);
        }
        row.appendChild(labelCell);

        for (const axis of RuleEditorDialog.#AXES) {
            row.appendChild(RuleEditorDialog.#buildAxisTrack(axis, rule[axis.key] || [], seaLevel));
        }

        return row;
    }

    /** The label cell's contents: swatch, name, optional code badge. Steppers/remove/add controls arrive in 4b-ii. */
    static #buildGroupLabel({ color, name, code }) {
        const wrap = document.createElement("span");
        wrap.className = "fwmb-rule-label-content";

        const swatch = document.createElement("span");
        swatch.className = "fwmb-rule-swatch";
        swatch.style.background = color;
        wrap.appendChild(swatch);

        const nameEl = document.createElement("span");
        nameEl.className = "fwmb-rule-name";
        nameEl.textContent = name;
        nameEl.title = name;
        wrap.appendChild(nameEl);

        if (code) {
            const codeEl = document.createElement("span");
            codeEl.className = "fwmb-rule-code";
            codeEl.textContent = code;
            wrap.appendChild(codeEl);
        }

        return wrap;
    }

    /**
     * One axis's chip readout plus its track. Every segment is drawn as a static fill bar
     * with inert handles (no pointer listeners) - dragging lands in 4b-ii. The elevation
     * axis additionally gets a dashed sea-level reference line, purely visual, exactly as
     * agreed in the mockup (custom ranges are never restricted by it).
     */
    static #buildAxisTrack(axisDef, segments, seaLevel) {
        const wrap = document.createElement("div");
        wrap.className = "fwmb-rule-axis";

        const top = document.createElement("div");
        top.className = "fwmb-rule-axis-top";
        const label = document.createElement("span");
        label.className = "fwmb-rule-axis-label";
        label.textContent = axisDef.label;
        top.appendChild(label);

        const chipRow = document.createElement("div");
        chipRow.className = "fwmb-rule-chip-row";
        for (const seg of segments) {
            chipRow.appendChild(RuleEditorDialog.#buildChip(seg));
        }
        top.appendChild(chipRow);
        wrap.appendChild(top);

        const track = document.createElement("div");
        track.className = "fwmb-rule-track";

        if (axisDef.key === "elevation") {
            const seaLine = document.createElement("div");
            seaLine.className = "fwmb-rule-sea-level-line";
            seaLine.style.left = seaLevel * 100 + "%";
            seaLine.title = game.i18n.localize("FILRODENSWMB.UI.RuleEditorSeaLevelTooltip");
            track.appendChild(seaLine);
        }

        for (const seg of segments) {
            track.appendChild(RuleEditorDialog.#buildTrackSegment(seg));
        }

        wrap.appendChild(track);
        return wrap;
    }

    /** A single "min–max" chip, matching a segment's stored open/closed edges. */
    static #buildChip([min, max, openMin, openMax]) {
        const chip = document.createElement("span");
        chip.className = "fwmb-rule-chip";

        const minEl = document.createElement("span");
        minEl.textContent = min.toFixed(2);
        if (openMin) minEl.className = "fwmb-rule-chip-edge";
        chip.appendChild(minEl);

        chip.appendChild(document.createTextNode("–")); // en dash

        const maxEl = document.createElement("span");
        maxEl.textContent = max.toFixed(2);
        if (openMax) maxEl.className = "fwmb-rule-chip-edge";
        chip.appendChild(maxEl);

        return chip;
    }

    /** The filled portion of the track for one segment, with inert (non-draggable) end handles. */
    static #buildTrackSegment([min, max]) {
        const fragment = document.createDocumentFragment();

        const fill = document.createElement("div");
        fill.className = "fwmb-rule-fill";
        fill.style.left = min * 100 + "%";
        fill.style.width = Math.max(0, max - min) * 100 + "%";
        fragment.appendChild(fill);

        for (const pct of [min, max]) {
            const handle = document.createElement("div");
            handle.className = "fwmb-rule-handle";
            handle.style.left = pct * 100 + "%";
            fragment.appendChild(handle);
        }

        return fragment;
    }

    /**
     * The three axes every rule row tracks, in display order. Elevation intentionally has
     * no "floor" or restriction tied to sea level - see custom-biomes-v2.3-scoping.md,
     * "Elevation and sea level". A getter (not a static field) so localize() only ever runs
     * once i18n is actually ready, not at module-import time.
     */
    static get #AXES() {
        return [
            { key: "elevation", label: game.i18n.localize("FILRODENSWMB.UI.RuleEditorElevation") },
            { key: "moisture", label: game.i18n.localize("FILRODENSWMB.UI.RuleEditorMoisture") },
            { key: "temperature", label: game.i18n.localize("FILRODENSWMB.UI.RuleEditorTemperature") },
        ];
    }
}
