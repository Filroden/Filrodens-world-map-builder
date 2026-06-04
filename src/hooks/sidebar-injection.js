// We will build this class next
import { MapStudioApp } from "../applications/MapStudioApp.js";

export function registerSidebarInjection() {
    Hooks.on("renderSceneDirectory", injectSidebarButton);
}

function injectSidebarButton(app, html) {
    if (!game.user.isGM) return;

    // Guard against jQuery wrappers to ensure native DOM manipulation
    const directoryElement = html[0] || html;

    // Target the native action buttons container in the Scene Directory header
    const headerActions = directoryElement.querySelector(".directory-header .action-buttons");
    if (!headerActions) return;

    // Prevent duplicate injections during partial re-renders
    if (headerActions.querySelector(".fwmb-sidebar-btn")) return;

    const button = createMapBuilderButton();
    headerActions.appendChild(button);
}

function createMapBuilderButton() {
    const button = document.createElement("button");
    button.type = "button";
    // Native Foundry class "create-document" helps it match the height of sibling buttons
    button.className = "fwmb-sidebar-btn fwmb-btn create-document";
    button.dataset.tooltip = game.i18n.localize("FILRODENSWMB.UI.ControlTitle");

    const icon = document.createElement("i");
    icon.className = "fwmb-icon map";

    // Add text label with a leading space for padding, natively localised
    const buttonText = " " + game.i18n.localize("FILRODENSWMB.UI.SidebarButton");
    const label = document.createTextNode(buttonText);

    button.appendChild(icon);
    button.appendChild(label);

    button.addEventListener("click", handleMapBuilderButtonClick);

    return button;
}

function handleMapBuilderButtonClick(event) {
    event.preventDefault();
    // Instantiate our new standalone Map Studio Application
    const app = new MapStudioApp();
    app.render({ force: true });
}
