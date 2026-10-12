/**
 * The web host's <file-picker> element, standing in for Foundry's element of the same name, which
 * four of the module's templates use (the reference image, a custom pin icon, a decoration and the
 * scene export folder). Foundry's browses the files on its server; there is no server here, so
 * this one takes a URL typed into its field, or an image chosen from the reader's computer, which
 * is read into a data URL. The chosen image then travels inside the map or setting that holds it,
 * and needs nothing else to be shown again later.
 *
 * It behaves as Foundry's element does where the shared code relies on it: it is a form field
 * (form.elements[name] finds it, and its value is the path), its `value` can be set as a property
 * or an attribute, and it fires input and change events of its own when the value changes (the
 * events of the field inside it stop at the element). A picker of type "folder" has the field
 * only, since folders mean nothing here.
 */

/** Inputs of the field inside the picker that are re-sent from the picker itself. */
const FORWARDED_EVENTS = ["input", "change"];

export class FilePickerElement extends HTMLElement {
    static formAssociated = true;
    static observedAttributes = ["value"];

    /** The browse button's accessible name, set when the element is defined (see define). */
    static browseLabel = "Choose a file";

    /**
     * Defines the element under its Foundry name, once.
     *
     * @param {CustomElementRegistry} registry
     * @param {{browseLabel?: string}} [options]
     */
    static define(registry, { browseLabel } = {}) {
        if (browseLabel) FilePickerElement.browseLabel = browseLabel;
        if (!registry.get("file-picker")) registry.define("file-picker", FilePickerElement);
    }

    #internals = this.attachInternals?.() ?? null;
    #field = null;
    #value = "";

    connectedCallback() {
        if (this.#field) return;
        this.#value = this.getAttribute("value") ?? this.#value;
        this.#build();
    }

    #build() {
        const doc = this.ownerDocument;
        this.#field = doc.createElement("input");
        this.#field.type = "text";
        this.#field.value = this.#value;
        for (const type of FORWARDED_EVENTS) this.#field.addEventListener(type, this.#forward);
        this.append(this.#field);

        if (this.getAttribute("type") === "folder") return;
        const button = doc.createElement("button");
        button.type = "button";
        button.className = "fwmb-btn";
        button.setAttribute("aria-label", FilePickerElement.browseLabel);
        button.dataset.tooltip = FilePickerElement.browseLabel;
        button.innerHTML = '<i class="fwmb-icon folder-open"></i>';
        button.addEventListener("click", () => this.#browse());
        this.append(button);
    }

    /** The field's own events stop here; the picker sends its own, with itself as the target. */
    #forward = (event) => {
        event.stopPropagation();
        this.#setValue(this.#field.value);
        this.#emit(event.type);
    };

    /** Sends an event from the picker, made by the picker's own window (it may not be this script's). */
    #emit(type) {
        const { Event: WindowEvent } = this.ownerDocument.defaultView;
        this.dispatchEvent(new WindowEvent(type, { bubbles: true }));
    }

    #setValue(value) {
        this.#value = value ?? "";
        if (this.#field && this.#field.value !== this.#value) this.#field.value = this.#value;
        this.#internals?.setFormValue(this.#value);
    }

    /** Opens the browser's file chooser for an image, and takes the chosen file as a data URL. */
    #browse() {
        const chooser = this.ownerDocument.createElement("input");
        chooser.type = "file";
        chooser.accept = "image/*";
        chooser.addEventListener("change", async () => {
            const file = chooser.files?.[0];
            if (!file) return;
            this.value = await FilePickerElement.readAsDataUrl(file);
            for (const type of FORWARDED_EVENTS) this.#emit(type);
        });
        chooser.click();
    }

    /** @param {Blob} file */
    static readAsDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
        });
    }

    attributeChangedCallback(name, _old, value) {
        if (name === "value") this.#setValue(value);
    }

    get value() {
        return this.#value;
    }

    set value(value) {
        this.#setValue(value);
    }

    get name() {
        return this.getAttribute("name") ?? "";
    }

    get type() {
        return this.getAttribute("type") ?? "any";
    }

    get form() {
        return this.#internals?.form ?? null;
    }
}
