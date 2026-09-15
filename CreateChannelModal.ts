import { App, Modal, TFile, TFolder } from "obsidian";
import { createChannel } from "./messages";

export class CreateChannelModal extends Modal {
  constructor(app: App, private group: TFolder, private created: (file: TFile) => void) { super(app); }
  onOpen(): void {
    this.contentEl.addClass("private-server-create-modal");
    this.contentEl.createEl("h2", { text: `Create channel in ${this.group.name}` });
    const form = this.contentEl.createEl("form");
    const label = form.createEl("label", { text: "Channel name" });
    const input = label.createEl("input", { attr: { type: "text", placeholder: "Channel name", maxlength: "103", required: "true" } });
    const error = form.createEl("p", { cls: "private-server-create-error", attr: { role: "alert" } });
    const submit = form.createEl("button", { text: "Create channel", attr: { type: "submit" } });
    let busy = false;
    form.onsubmit = async event => {
      event.preventDefault();
      if (busy) return;
      busy = true; submit.disabled = true; error.setText("");
      try {
        const file = await createChannel(this.app.vault, this.group, input.value);
        this.created(file); this.close();
      } catch (cause) {
        error.setText(cause instanceof Error ? cause.message : "Could not create channel. Try again.");
      } finally { busy = false; submit.disabled = false; }
    };
    input.focus();
  }
  onClose(): void { this.contentEl.empty(); }
}
