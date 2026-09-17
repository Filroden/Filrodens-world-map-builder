import { FILRODENSWMB } from "../config.js";
import { BiomeRuleEngine } from "../generation/BiomeRuleEngine.js";
import { ColorMath } from "../tools/ColorMath.js";

/**
 * The "Biome Rule Stacker" - a dedicated, large DialogV2 window (not one of the module's
 * usual small single-purpose dialogs) where a GM builds up auto-generation rules for their
 * custom biomes against the built-in defaults. Ported from the agreed mockup at
 * https://claude.ai/artifact/UxXan2t7gAGdPxPjfVpBZ6 (see custom-biomes-v2.3-scoping.md,
 * "UI design" section) - the row/track/chip DOM-building methods below are close to a
 * direct port of that mockup's own vanilla JS, just reading real customBiomes data instead
 * of illustrative samples, and computing the "Default biomes" table live from
 * BiomeRuleEngine.getDefaultBiomeReferenceRows() instead of hand-copied numbers.
 *
 * Kept in its own file (rather than folded into MapDialogManager.js, already the module's
 * largest file) because this is the single largest piece of interactive UI in the module,
 * matching how RegionalExtractor.js and SceneExporter.js already carve substantial
 * single-feature logic out of MapStudioApp.js.
 *
 * SUB-PHASE 4b-i (shipped): a read-only, data-driven snapshot - no interactivity.
 *
 * SUB-PHASE 4b-ii (shipped): the custom-biome half of the dialog is now fully
 * interactive - dragging a segment's ends, adding/removing a range on one axis, adding/
 * removing a whole rule row, reordering a biome's priority, and the elevation zone
 * quick-picks. All of it mutates the `customBiomes` array `open()` deep-cloned from
 * `app.uiState.customBiomes` - a working copy that lived only for the dialog's lifetime
 * in this pass. The "Default biomes" section stays exactly as it was in 4b-i: read-only,
 * never re-rendered, no listeners.
 *
 * SUB-PHASE 4b-iii (this pass): Accept now actually commits the working copy - see
 * `open()`. Cancel (and the window's own close button, mapped to the same action) still
 * just discards it, leaving `app.uiState.customBiomes` untouched.
 */
export class RuleEditorDialog {
    /** How close a dragged handle has to get to 0 or 1 before it's treated as touching that true edge (see RuleSegment's openMin/openMax). */
    static #EPS = 0.008;

    /**
     * DialogV2's content is one static HTML blob, not an ApplicationV2 subclass with its own
     * `PARTS`/`scrollable: [...]` declarations, so none of ApplicationV2's built-in scroll-
     * position restoration applies here - every full or partial rebuild below (`renderCustom`,
     * `renderAxisBody`) tears down and recreates DOM nodes, which on its own leaves the
     * `.fwmb-rule-editor` scroll container's `scrollTop` untouched, but a rebuild that changes
     * the *content above the viewport*'s height (a row/segment being added or removed) shifts
     * what that same scrollTop value is pointing at, which reads as "the scroll position
     * reset." Wrapping every rebuild in this saves/restores scrollTop across it - `anchorEl`
     * just needs to be any element inside (or about to be inside) the scrollable container;
     * during initial construction (before a node is attached to the document) `closest()`
     * finds nothing and this is a safe no-op.
     */
    static #preserveScroll(anchorEl, rebuild) {
        const scrollEl = anchorEl.closest(".fwmb-rule-editor");
        const scrollTop = scrollEl?.scrollTop;
        rebuild();
        if (scrollEl) scrollEl.scrollTop = scrollTop;
    }

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
        // multi-button pattern above. The window's own close (X) button is treated the same
        // as Cancel. See below for what each resolved action actually does.
        const action = await foundry.applications.api.DialogV2.wait({
            classes: ["fwmb", "fwmb-rule-editor-dialog"],
            window: { title: game.i18n.localize("FILRODENSWMB.UI.RuleEditorTitle"), icon: "fwmb-icon tune", resizable: true },
            content,
            buttons: [
                { action: "cancel", label: game.i18n.localize("FILRODENSWMB.UI.Cancel"), icon: "fwmb-icon cancel" },
                { action: "accept", label: game.i18n.localize("FILRODENSWMB.UI.Accept"), icon: "fwmb-icon accept", default: true },
            ],
            close: () => "cancel",
            render: (event) => RuleEditorDialog.#renderContent(event.target.element, customBiomes, defaultBiomes, seaLevel),
        });

        if (action !== "accept") return; // Cancel (or the window's X) - discard the working copy, touch nothing.

        // Deliberately NOT MapStateManager.pushVectorState(app) here (an earlier version of
        // this method did push one, so Ctrl+Z would undo a rule edit like a manual map edit).
        // Ken's call after using it in practice: rules aren't a manual edit to the map the way
        // painting or placing a pin is - they're a generation SETTING, changing what the
        // engines produce, exactly like the terrain/climate sliders in tools-context.hbs
        // (#handleContextPanelInput calls markDirty() for those too, but never
        // pushVectorState() - see #routeProceduralGenerators). Leaving the push in here made
        // a rule edit accidentally consume a step in the same undo stack as paint strokes and
        // vector edits, which is confusing when the two are unrelated actions. Rules still
        // mark the map dirty (a save is still needed), they just don't occupy an undo slot.
        app.uiState.customBiomes = customBiomes;
        app._repaintCanvas(); // customBiomeRules is recompiled fresh from uiState.customBiomes on every repaint (see MapStateManager.getDerivedMapParameters) - no separate cache to invalidate.
        app.render({ parts: ["context"] });
        app.markDirty();
    }

    /** Populates the dialog's two (otherwise empty) host elements once it's in the DOM. */
    static #renderContent(root, customBiomes, defaultBiomes, seaLevel) {
        const customHost = root.querySelector("#fwmb-rule-custom-rows");
        const defaultHost = root.querySelector("#fwmb-rule-default-rows");
        const countEl = root.querySelector("#fwmb-rule-custom-count");

        const renderCustom = () =>
            RuleEditorDialog.#preserveScroll(customHost, () => RuleEditorDialog.#renderCustomSection(customHost, countEl, customBiomes, seaLevel, renderCustom));
        renderCustom();

        defaultHost.replaceChildren();
        for (const biome of defaultBiomes) {
            defaultHost.appendChild(
                RuleEditorDialog.#buildDefaultGroup({
                    color: ColorMath.rgbToHex(biome.color),
                    name: game.i18n.localize(`FILRODENSWMB.BIOMES.${biome.key}`),
                    rows: biome.rows,
                    seaLevel,
                }),
            );
        }
    }

    // =========================================================================================
    // CUSTOM (interactive) section
    // =========================================================================================

    /**
     * Fully rebuilds the custom-rules section from the current in-memory `customBiomes`
     * array. Passed to every button below as `rerender` - every STRUCTURAL change (add/
     * remove a range, add/remove a row, reorder a biome) calls it, exactly like the agreed
     * mockup's own renderCustom(). Dragging a handle deliberately does NOT call this (see
     * #buildInteractiveSegment) - rebuilding mid-drag would tear down the very handle the
     * user has pointer-captured.
     */
    static #renderCustomSection(customHost, countEl, customBiomes, seaLevel, rerender) {
        customHost.replaceChildren();

        const totalCustomRules = customBiomes.reduce((sum, biome) => sum + (biome.rules?.length || 0), 0);
        countEl.textContent = game.i18n.format("FILRODENSWMB.UI.RuleEditorCustomCount", {
            biomes: customBiomes.length,
            rules: totalCustomRules,
        });

        customBiomes.forEach((biome, index) => {
            customHost.appendChild(RuleEditorDialog.#buildCustomGroup(biome, index, customBiomes, seaLevel, rerender));
        });
    }

    /** One custom biome's card: priority stepper + label, then one row per rule (or the empty-state row), then the "add independent rule" strip. */
    static #buildCustomGroup(biome, index, customBiomes, seaLevel, rerender) {
        const group = document.createElement("div");
        group.className = "fwmb-rule-group";

        const stepper = RuleEditorDialog.#buildPriorityStepper(index, customBiomes, rerender);
        const buildLabel = () =>
            RuleEditorDialog.#buildGroupLabel({
                color: ColorMath.rgbToHex(biome.color),
                name: biome.name,
                code: biome.code,
                stepper,
                rank: index + 1,
            });

        if (!biome.rules || biome.rules.length === 0) {
            group.appendChild(
                RuleEditorDialog.#buildCustomEmptyRow(buildLabel(), () => {
                    biome.rules = [RuleEditorDialog.#defaultRow(seaLevel)];
                    rerender();
                }),
            );
            return group;
        }

        biome.rules.forEach((rule, rowIndex) => {
            group.appendChild(
                RuleEditorDialog.#buildCustomRuleRow(rule, {
                    seaLevel,
                    rerender,
                    labelContent: rowIndex === 0 ? buildLabel() : null,
                    // Removing a biome's last rule is allowed - it just falls back to the
                    // empty-state row above (rules: [] is already a valid, meaningful state:
                    // the biome simply never matches and falls through to defaults, exactly
                    // like a freshly-created custom biome before any rule has been added).
                    onRemoveRow: () => {
                        biome.rules.splice(rowIndex, 1);
                        rerender();
                    },
                }),
            );
        });

        group.appendChild(
            RuleEditorDialog.#buildAddRuleStrip("FILRODENSWMB.UI.RuleEditorAddIndependentRule", "FILRODENSWMB.UI.RuleEditorAddIndependentRuleHint", () => {
                biome.rules.push(RuleEditorDialog.#defaultRow(seaLevel));
                rerender();
            }),
        );

        return group;
    }

    /** The ▲▼ pair that reorders a custom biome's priority (biomes only - a biome's own rows always move together as a unit). */
    static #buildPriorityStepper(index, customBiomes, rerender) {
        const up = document.createElement("button");
        up.type = "button";
        up.className = "fwmb-rule-step-btn";
        up.textContent = "▲";
        up.disabled = index === 0;
        up.title = game.i18n.localize("FILRODENSWMB.UI.RuleEditorPriorityUp");
        up.addEventListener("click", () => {
            [customBiomes[index - 1], customBiomes[index]] = [customBiomes[index], customBiomes[index - 1]];
            rerender();
        });

        const down = document.createElement("button");
        down.type = "button";
        down.className = "fwmb-rule-step-btn";
        down.textContent = "▼";
        down.disabled = index === customBiomes.length - 1;
        down.title = game.i18n.localize("FILRODENSWMB.UI.RuleEditorPriorityDown");
        down.addEventListener("click", () => {
            [customBiomes[index], customBiomes[index + 1]] = [customBiomes[index + 1], customBiomes[index]];
            rerender();
        });

        return { up, down };
    }

    /** A custom biome with an empty `rules` array - nothing to draw a track for yet, just a hint and a way to add the first one. */
    static #buildCustomEmptyRow(labelContent, onAddFirstRule) {
        const row = document.createElement("div");
        row.className = "fwmb-rule-row fwmb-rule-row-empty";

        const labelCell = document.createElement("div");
        labelCell.className = "fwmb-rule-row-label";
        labelCell.appendChild(labelContent);
        row.appendChild(labelCell);

        const body = document.createElement("div");
        body.className = "fwmb-rule-row-empty-body";

        const hint = document.createElement("span");
        hint.className = "fwmb-rule-row-empty-hint";
        hint.textContent = game.i18n.localize("FILRODENSWMB.UI.RuleEditorNoRulesYet");
        body.appendChild(hint);

        const addBtn = document.createElement("button");
        addBtn.type = "button";
        addBtn.className = "fwmb-rule-add-row-btn";
        addBtn.textContent = "+ " + game.i18n.localize("FILRODENSWMB.UI.RuleEditorAddRule");
        addBtn.addEventListener("click", onAddFirstRule);
        body.appendChild(addBtn);

        row.appendChild(body);
        return row;
    }

    /** One interactive rule row: a label cell (only populated for a biome's first row), the three axis tracks, and a remove-row button. */
    static #buildCustomRuleRow(rule, { seaLevel, labelContent, onRemoveRow, rerender }) {
        const row = document.createElement("div");
        row.className = "fwmb-rule-row fwmb-rule-row-custom";

        const labelCell = document.createElement("div");
        labelCell.className = "fwmb-rule-row-label";
        if (labelContent) {
            labelCell.appendChild(labelContent);
        } else {
            const mark = document.createElement("span");
            mark.className = "fwmb-rule-continuation";
            mark.textContent = "+"; // an additional, independent rule for the biome above
            labelCell.appendChild(mark);
        }
        row.appendChild(labelCell);

        for (const axis of RuleEditorDialog.#AXES) {
            row.appendChild(RuleEditorDialog.#buildInteractiveAxis(axis, rule[axis.key], seaLevel, rerender));
        }

        row.appendChild(RuleEditorDialog.#buildRemoveRowButton(onRemoveRow));
        return row;
    }

    /** Always enabled - a biome's last rule can be removed too, see the comment above #buildCustomRuleRow's caller. */
    static #buildRemoveRowButton(onClick) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "fwmb-rule-remove-row";
        btn.innerHTML = "&times;";
        btn.title = game.i18n.localize("FILRODENSWMB.UI.RuleEditorRemoveRule");
        btn.addEventListener("click", onClick);
        return btn;
    }

    static #buildAddRuleStrip(labelKey, hintKey, onClick) {
        const strip = document.createElement("div");
        strip.className = "fwmb-rule-add-strip";

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "fwmb-rule-add-row-btn";
        btn.textContent = "+ " + game.i18n.localize(labelKey);
        btn.title = game.i18n.localize(hintKey);
        btn.addEventListener("click", onClick);

        strip.appendChild(btn);
        return strip;
    }

    /**
     * One axis's chip readout plus its track, fully interactive: dragging either end of a
     * segment, adding another segment, removing one (once there's more than one), and - for
     * elevation only - the zone quick-picks. `rerender` is the full custom-section rebuild,
     * called after every structural change (segment count, zone-pick) but never during a
     * drag - see #buildInteractiveSegment.
     */
    static #buildInteractiveAxis(axisDef, segments, seaLevel, rerender) {
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
        top.appendChild(chipRow);

        const track = document.createElement("div");
        track.className = "fwmb-rule-track";

        const rebuildAxisBody = () => {
            chipRow.replaceChildren();
            track.replaceChildren();

            if (axisDef.key === "elevation") {
                track.appendChild(RuleEditorDialog.#buildSeaLevelLine(seaLevel));
            }

            segments.forEach((segment, segmentIndex) => {
                RuleEditorDialog.#buildInteractiveSegment(segment, {
                    chipRow,
                    track,
                    removableChip: segments.length > 1,
                    onRemoveSegment: () => {
                        segments.splice(segmentIndex, 1);
                        renderAxisBody();
                    },
                });
            });

            chipRow.appendChild(
                RuleEditorDialog.#buildAddSegmentButton(axisDef, () => {
                    segments.push([0.3, 0.7, false, false]);
                    renderAxisBody();
                }),
            );
        };
        // Adding/removing a range only rebuilds this one axis's own chips/track, not the whole
        // custom section - but it's still a rebuild, so it gets the same scroll-preservation
        // treatment as the outer `renderCustom` (see #preserveScroll's doc comment).
        const renderAxisBody = () => RuleEditorDialog.#preserveScroll(track, rebuildAxisBody);
        renderAxisBody();

        wrap.appendChild(top);
        wrap.appendChild(track);

        if (axisDef.key === "elevation") {
            wrap.appendChild(RuleEditorDialog.#buildZonePicker(segments, seaLevel, rerender));
        }

        return wrap;
    }

    /** One segment's chip + fill + drag handles, wired together so a drag updates all three without rebuilding any of them. */
    static #buildInteractiveSegment(segment, { chipRow, track, removableChip, onRemoveSegment }) {
        const chip = document.createElement("span");
        chip.className = "fwmb-rule-chip";
        const minEl = document.createElement("span");
        const maxEl = document.createElement("span");
        chip.append(minEl, document.createTextNode("–"), maxEl);
        if (removableChip) {
            const remove = document.createElement("span");
            remove.className = "fwmb-rule-chip-remove";
            remove.textContent = "×";
            remove.title = game.i18n.localize("FILRODENSWMB.UI.RuleEditorRemoveRange");
            remove.addEventListener("click", onRemoveSegment);
            chip.appendChild(remove);
        }
        chipRow.appendChild(chip);

        const fill = document.createElement("div");
        fill.className = "fwmb-rule-fill";
        const handleMin = document.createElement("div");
        handleMin.className = "fwmb-rule-handle";
        handleMin.tabIndex = 0;
        const handleMax = document.createElement("div");
        handleMax.className = "fwmb-rule-handle";
        handleMax.tabIndex = 0;
        track.append(fill, handleMin, handleMax);

        const syncVisual = () => {
            const [min, max, openMin, openMax] = segment;
            fill.style.left = min * 100 + "%";
            fill.style.width = Math.max(0, max - min) * 100 + "%";
            handleMin.style.left = min * 100 + "%";
            handleMax.style.left = max * 100 + "%";
            minEl.textContent = min.toFixed(2);
            minEl.className = openMin ? "fwmb-rule-chip-edge" : "";
            maxEl.textContent = max.toFixed(2);
            maxEl.className = openMax ? "fwmb-rule-chip-edge" : "";
        };
        syncVisual();

        RuleEditorDialog.#wireDragHandle(handleMin, track, segment, 0, syncVisual);
        RuleEditorDialog.#wireDragHandle(handleMax, track, segment, 1, syncVisual);
    }

    /**
     * Wires one handle's pointer drag. `edgeIndex` is 0 for the min end, 1 for the max end -
     * each end is clamped so it can never cross the other. Updates `segment` in place and
     * calls `syncVisual()` on every move; deliberately never calls the full `rerender`,
     * since that would destroy this very handle mid-drag (its pointer capture included).
     */
    static #wireDragHandle(handle, track, segment, edgeIndex, syncVisual) {
        handle.addEventListener("pointerdown", (event) => {
            event.preventDefault();
            handle.setPointerCapture(event.pointerId);

            const onMove = (moveEvent) => {
                const rect = track.getBoundingClientRect();
                let pct = rect.width > 0 ? (moveEvent.clientX - rect.left) / rect.width : segment[edgeIndex];
                pct = Math.max(0, Math.min(1, pct));

                if (edgeIndex === 0) {
                    pct = Math.min(pct, segment[1]);
                    segment[0] = pct;
                    segment[2] = pct <= RuleEditorDialog.#EPS;
                } else {
                    pct = Math.max(pct, segment[0]);
                    segment[1] = pct;
                    segment[3] = pct >= 1 - RuleEditorDialog.#EPS;
                }
                syncVisual();
            };

            const onUp = (upEvent) => {
                handle.releasePointerCapture(upEvent.pointerId);
                window.removeEventListener("pointermove", onMove);
                window.removeEventListener("pointerup", onUp);
            };

            window.addEventListener("pointermove", onMove);
            window.addEventListener("pointerup", onUp);
        });
    }

    static #buildAddSegmentButton(axisDef, onClick) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "fwmb-rule-seg-add";
        btn.textContent = "+";
        btn.title = game.i18n.format("FILRODENSWMB.UI.RuleEditorAddRange", { axis: axisDef.label });
        btn.addEventListener("click", onClick);
        return btn;
    }

    /**
     * Elevation-only quick pick: snaps a range onto a named sea-level-relative zone
     * (including "Underwater", for custom water biomes) instead of dragging it by hand.
     * Overwrites the range when there's just one (the common case); adds a new one
     * alongside existing ranges otherwise, same as the per-axis "+" control, so it never
     * silently clobbers a range the user kept. Not an enforcement mechanism - see
     * custom-biomes-v2.3-scoping.md, "Elevation and sea level".
     */
    static #buildZonePicker(segments, seaLevel, rerender) {
        const picker = document.createElement("div");
        picker.className = "fwmb-rule-zone-picker";

        for (const zone of RuleEditorDialog.#elevationZones(seaLevel)) {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "fwmb-rule-zone-chip";
            btn.textContent = zone.label;
            btn.title = game.i18n.format("FILRODENSWMB.UI.RuleEditorZoneTooltip", { zone: zone.label, from: zone.from.toFixed(2), to: zone.to.toFixed(2) });
            btn.addEventListener("click", () => {
                const openMin = zone.from <= RuleEditorDialog.#EPS;
                const openMax = zone.to >= 1 - RuleEditorDialog.#EPS;
                if (segments.length === 1) {
                    segments[0][0] = zone.from;
                    segments[0][1] = zone.to;
                    segments[0][2] = openMin;
                    segments[0][3] = openMax;
                } else {
                    segments.push([zone.from, zone.to, openMin, openMax]);
                }
                rerender();
            });
            picker.appendChild(btn);
        }

        return picker;
    }

    /**
     * The five named sea-level-relative bands (Underwater, then the land above sea level
     * split into four equal quarters) for the elevation zone quick-picks. Illustrative
     * bands only, not tuned thresholds - see custom-biomes-v2.3-scoping.md, "Elevation and
     * sea level", which also notes these boundaries are expected to be revisited once
     * sea-level rebasing lands.
     */
    static #elevationZones(seaLevel) {
        const span = (1 - seaLevel) / 4;
        const bounds = [0, seaLevel, seaLevel + span, seaLevel + span * 2, seaLevel + span * 3, 1];
        const keys = ["Underwater", "Lowland", "Upland", "Highland", "Mountain"];

        return keys.map((key, i) => ({
            key,
            label: game.i18n.localize(`FILRODENSWMB.UI.RuleEditorZone${key}`),
            from: bounds[i],
            to: bounds[i + 1],
        }));
    }

    /** A fresh rule row for a newly added independent rule: land-only elevation, full moisture/temperature - a reasonable starting box the user then narrows. */
    static #defaultRow(seaLevel) {
        return {
            elevation: [[seaLevel, 1, false, true]],
            moisture: [[0, 1, true, true]],
            temperature: [[0, 1, true, true]],
        };
    }

    // =========================================================================================
    // DEFAULT (read-only) section - unchanged since 4b-i: no listeners, never re-rendered.
    // =========================================================================================

    /** Builds one default biome's card: its label plus one row per (always ≥1) reference row. */
    static #buildDefaultGroup({ color, name, rows, seaLevel }) {
        const group = document.createElement("div");
        group.className = "fwmb-rule-group locked";

        rows.forEach((row, index) => {
            group.appendChild(
                RuleEditorDialog.#buildDefaultRuleRow(row, {
                    seaLevel,
                    labelContent: index === 0 ? RuleEditorDialog.#buildGroupLabel({ color, name, code: null }) : null,
                }),
            );
        });

        return group;
    }

    static #buildDefaultRuleRow(rule, { seaLevel, labelContent }) {
        const row = document.createElement("div");
        row.className = "fwmb-rule-row";

        const labelCell = document.createElement("div");
        labelCell.className = "fwmb-rule-row-label";
        if (labelContent) {
            labelCell.appendChild(labelContent);
        } else {
            const mark = document.createElement("span");
            mark.className = "fwmb-rule-continuation";
            mark.textContent = "+";
            labelCell.appendChild(mark);
        }
        row.appendChild(labelCell);

        for (const axis of RuleEditorDialog.#AXES) {
            row.appendChild(RuleEditorDialog.#buildStaticAxisTrack(axis, rule[axis.key] || [], seaLevel));
        }

        return row;
    }

    /**
     * The label cell's contents shared by both sections: swatch, name, optional code
     * badge, and - only for a custom biome - the priority stepper and its rank pill.
     */
    static #buildGroupLabel({ color, name, code, stepper, rank }) {
        const wrap = document.createElement("span");
        wrap.className = "fwmb-rule-label-content";

        if (stepper) {
            const stepperWrap = document.createElement("span");
            stepperWrap.className = "fwmb-rule-stepper";
            stepperWrap.append(stepper.up, stepper.down);
            wrap.appendChild(stepperWrap);

            const rankEl = document.createElement("span");
            rankEl.className = "fwmb-rule-rank";
            rankEl.textContent = "#" + rank;
            wrap.appendChild(rankEl);
        }

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

    /** Non-interactive axis track for the defaults section: static fill bars, inert handles, no listeners. */
    static #buildStaticAxisTrack(axisDef, segments, seaLevel) {
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
            chipRow.appendChild(RuleEditorDialog.#buildStaticChip(seg));
        }
        top.appendChild(chipRow);
        wrap.appendChild(top);

        const track = document.createElement("div");
        track.className = "fwmb-rule-track";

        if (axisDef.key === "elevation") {
            track.appendChild(RuleEditorDialog.#buildSeaLevelLine(seaLevel));
        }

        for (const seg of segments) {
            track.appendChild(RuleEditorDialog.#buildStaticSegment(seg));
        }

        wrap.appendChild(track);
        return wrap;
    }

    static #buildStaticChip([min, max, openMin, openMax]) {
        const chip = document.createElement("span");
        chip.className = "fwmb-rule-chip";

        const minEl = document.createElement("span");
        minEl.textContent = min.toFixed(2);
        if (openMin) minEl.className = "fwmb-rule-chip-edge";
        chip.appendChild(minEl);

        chip.appendChild(document.createTextNode("–"));

        const maxEl = document.createElement("span");
        maxEl.textContent = max.toFixed(2);
        if (openMax) maxEl.className = "fwmb-rule-chip-edge";
        chip.appendChild(maxEl);

        return chip;
    }

    static #buildStaticSegment([min, max]) {
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

    /** The dashed sea-level reference marker shared by both the interactive and static elevation tracks - visual only, never restricts a range. */
    static #buildSeaLevelLine(seaLevel) {
        const seaLine = document.createElement("div");
        seaLine.className = "fwmb-rule-sea-level-line";
        seaLine.style.left = seaLevel * 100 + "%";
        seaLine.title = game.i18n.localize("FILRODENSWMB.UI.RuleEditorSeaLevelTooltip");
        return seaLine;
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
