import { App, Modal, Notice, Platform } from "obsidian";
import { fitMobileEditModal } from "./MobileEditModal";
import { Message, messageText } from "./messages";

export class MessageActions extends Modal {
  constructor(app: App, private reply: () => Promise<void>, private edit: () => void, private remove: () => void) { super(app); }
  onOpen(): void {
    this.contentEl.addClass("private-server-actions");
    this.contentEl.createEl("h2", { text: "Message actions" });
    for (const [label, action] of [["Reply", () => { void this.reply().catch(error => new Notice(String(error))); }],
      ["Edit", this.edit], ["Delete", this.remove]] as const) {
      this.contentEl.createEl("button", { text: label, attr: { type: "button" } }).onclick = () => { this.close(); action(); };
    }
  }
  onClose(): void { this.contentEl.empty(); }
}

export class EditMessage extends Modal {
  private cleanupViewport?: () => void;
  constructor(app: App, private message: Message, private save: (text: string) => Promise<void>) { super(app); }
  onOpen(): void {
    this.cleanupViewport?.();
    this.contentEl.addClass("private-server-edit");
    this.contentEl.createEl("h2", { text: "Edit message" });
    const body = Platform.isMobile ? this.contentEl.createDiv("private-server-edit-body") : this.contentEl;
    const input = body.createEl("textarea", { attr: { rows: "5", "aria-label": "Edit message text" } });
    input.value = messageText(this.message);
    body.createEl("p", { text: "Existing images will be kept." });
    const error = body.createEl("p", { attr: { role: "alert" } });
    const actions = Platform.isMobile ? this.contentEl.createDiv("private-server-edit-footer") : this.contentEl;
    const cancel = actions.createEl("button", { text: "Cancel" });
    cancel.onclick = () => this.close();
    const save = actions.createEl("button", { text: "Save", cls: "mod-cta" });
    save.onclick = async () => {
      save.disabled = true; cancel.disabled = true; input.disabled = true;
      try { await this.save(input.value); this.close(); }
      catch (cause) { error.setText(cause instanceof Error ? cause.message : "Could not save. Your edit is preserved."); }
      finally { save.disabled = false; cancel.disabled = false; input.disabled = false; }
    };
    if (Platform.isMobile) this.cleanupViewport = fitMobileEditModal(this.containerEl, this.modalEl);
    input.focus();
  }
  onClose(): void {
    this.cleanupViewport?.(); this.cleanupViewport = undefined;
    this.contentEl.empty();
  }
}

export class DeleteMessage extends Modal {
  constructor(app: App, private remove: () => Promise<void>) { super(app); }
  onOpen(): void {
    this.contentEl.addClass("private-server-actions");
    this.contentEl.createEl("h2", { text: "Delete message?" });
    this.contentEl.createEl("p", { text: "This will remove the message from the channel. Attached files will be left in Attachments." });
    const error = this.contentEl.createEl("p", { attr: { role: "alert" } });
    const cancel = this.contentEl.createEl("button", { text: "Cancel" }); cancel.onclick = () => this.close();
    const remove = this.contentEl.createEl("button", { text: "Delete", cls: "mod-warning" });
    remove.onclick = async () => {
      remove.disabled = true; cancel.disabled = true;
      try { await this.remove(); this.close(); }
      catch (cause) { error.setText(cause instanceof Error ? cause.message : "Could not delete the message."); }
      finally { remove.disabled = false; cancel.disabled = false; }
    };
    cancel.focus();
  }
  onClose(): void { this.contentEl.empty(); }
}

/** No pointer capture or preventDefault while tracking: ordinary scrolling/taps stay native. */
export function bindMessageActions(element: HTMLElement, mobile: boolean, open: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let x = 0, y = 0, pointer = -1, suppressClick = false;
  const cancel = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
  element.oncontextmenu = event => { event.preventDefault(); cancel(); if (!mobile || !suppressClick) open(); };
  if (mobile) {
    element.onpointerdown = event => {
      cancel(); suppressClick = false;
      if (!event.isPrimary || event.pointerType === "mouse") return;
      x = event.clientX; y = event.clientY; pointer = event.pointerId;
      timer = setTimeout(() => { timer = undefined; suppressClick = true; open(); }, 500);
    };
    element.onpointermove = event => {
      if (event.pointerId !== pointer || Math.hypot(event.clientX - x, event.clientY - y) > 10) cancel();
    };
    element.onpointerup = cancel; element.onpointercancel = cancel; element.onpointerleave = cancel;
    const click = (event: MouseEvent) => { if (suppressClick) { event.preventDefault(); event.stopPropagation(); suppressClick = false; } };
    element.addEventListener("click", click, true);
    return () => { cancel(); element.removeEventListener("click", click, true); };
  }
  return cancel;
}
